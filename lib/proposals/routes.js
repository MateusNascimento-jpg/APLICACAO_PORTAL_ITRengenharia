'use strict';

const { disposition, readPdf } = require('./pdf');
const { verify } = require('./protocol');

const MESSAGES = {
    SAFE_MODE: 'Alterações bloqueadas pelo modo seguro.',
    PROPOSALS_DISABLED: 'O fluxo de confirmação ainda não está habilitado.',
    PROPOSAL_NOT_FOUND: 'Proposta não encontrada para esta empresa.',
    PROPOSAL_TERMINAL: 'Esta proposta não está disponível para decisão.',
    PROPOSAL_CHANGED:
        'A proposta foi atualizada. Consulte a versão atual no Portal e solicite um novo código.',
    CHALLENGE_INVALID:
        'Este código ou link expirou, foi substituído ou atingiu o limite de tentativas. Solicite um novo código no Portal.',
    CODE_INVALID:
        'Código inválido. Confira os oito dígitos. Após cinco erros será necessário solicitar outro.',
    CODE_REQUIRED: 'Valide o código antes de confirmar o aceite.',
    RECIPIENT_INVALID: 'O contato selecionado não está autorizado para esta proposta.',
    RECIPIENT_MISSING: 'Não há contato comercial cadastrado. Entre em contato com a ITR.',
    PDF_AMBIGUOUS:
        'A proposta precisa ter um único PDF vigente para esta operação. Entre em contato com a ITR.',
    FEEDBACK_INVALID:
        'Informe um motivo de 5 a 1.000 caracteres. Os detalhes podem ter até 3.000 caracteres.',
    REQUEST_TOO_SOON: 'Aguarde um minuto antes de solicitar outro código.',
    DECISION_EXISTS: 'Já existe uma decisão registrada ou em processamento. Atualize a proposta.',
    DECISION_UNCERTAIN:
        'A decisão está em conferência. Aguarde a atualização antes de tentar novamente.',
    CONSENT_REQUIRED: 'Confirme expressamente o aceite da proposta.',
    CSRF_INVALID: 'Reabra a página de confirmação para renovar a proteção da solicitação.',
    PROPOSAL_INCOMPLETE:
        'Os dados comerciais da proposta estão incompletos. Entre em contato com a ITR.',
    PROPOSAL_BUSY: 'Há outra operação em andamento. Aguarde alguns instantes.',
};

function registerRoutes(
    app,
    { service, store, secrets, worker, config, auth, client, csrf, origin, write, consume, audit },
) {
    const cookieName = config.production ? '__Host-itr_proposal' : 'itr_proposal';
    const readCookie = (req) => {
        const pair = String(req.headers.cookie || '')
            .split(';')
            .map((item) => item.trim())
            .find((item) => item.startsWith(cookieName + '='));
        try {
            return pair ? decodeURIComponent(pair.slice(cookieName.length + 1)) : '';
        } catch (_) {
            return '';
        }
    };
    const actor = (req) => ({
        ipHash: secrets.codeHash('actor-ip', req.ip || ''),
        userAgent: String(req.headers['user-agent'] || '').slice(0, 255),
        role: req.session?.role || 'ProposalConfirmation',
    });
    const noViewer = (req, res, next) => {
        if (!['Cliente', 'GeneratedClient'].includes(req.session?.role))
            return res
                .status(403)
                .json({ sucesso: false, erro: 'Este acesso permite somente visualização.' });
        next();
    };
    const wrap = (fn) => async (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.set('Referrer-Policy', 'no-referrer');
        try {
            await fn(req, res);
        } catch (error) {
            const code = error.code || error.message;
            const status =
                code === 'PROPOSAL_NOT_FOUND'
                    ? 404
                    : code === 'CSRF_INVALID'
                      ? 403
                      : MESSAGES[code]
                        ? 409
                        : 503;
            await audit(req, 'proposal_operation', {
                outcome: 'denied',
                metadata: { code: MESSAGES[code] ? code : 'UNAVAILABLE' },
            });
            res.status(status).json({
                sucesso: false,
                codigo: MESSAGES[code] ? code : 'PROPOSALS_UNAVAILABLE',
                erro:
                    MESSAGES[code] ||
                    'Não foi possível concluir agora. Se a decisão já foi enviada, aguarde sua conferência e atualize a proposta.',
            });
        }
    };
    const limit = async (req, res, scope, key, count, windowMs) => {
        const result = await consume(scope, key, { limit: count, windowMs });
        if (result.ok) return true;
        res.set('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
        res.status(429).json({
            sucesso: false,
            erro: 'Muitas tentativas. Aguarde antes de continuar.',
        });
        return false;
    };
    const guards = [origin, auth, client, noViewer, csrf, write];

    app.get(
        '/api/propostas/:id/contatos-aceite',
        auth,
        client,
        noViewer,
        wrap(async (req, res) => {
            const contacts = await service.options(req.session.documento, req.params.id);
            res.json({ sucesso: true, contacts });
        }),
    );

    app.post(
        '/api/propostas/:id/aceite/solicitar',
        ...guards,
        wrap(async (req, res) => {
            if (!(await limit(req, res, 'proposal-request-ip', req.ip, 20, 1800000))) return;
            if (
                !(await limit(
                    req,
                    res,
                    'proposal-request',
                    req.session.documento + ':' + req.params.id,
                    3,
                    1800000,
                ))
            )
                return;
            const result = await service.request(
                req.session.documento,
                req.params.id,
                req.body.recipientKey,
                actor(req),
            );
            await audit(req, 'proposal_accept_requested', {
                outcome: 'success',
                metadata: { proposalId: req.params.id },
            });
            res.json({ sucesso: true, ...result });
            worker.wake();
        }),
    );

    app.post(
        '/api/propostas/:id/rejeitar',
        ...guards,
        wrap(async (req, res) => {
            if (!(await limit(req, res, 'proposal-reject', req.session.documento, 10, 900000)))
                return;
            const result = await service.reject(
                req.session.documento,
                req.params.id,
                req.body.reason,
                req.body.details || '',
                actor(req),
            );
            await audit(req, 'proposal_rejected', {
                outcome: 'success',
                metadata: { proposalId: req.params.id },
            });
            res.json({ sucesso: true, ...result });
        }),
    );

    app.post(
        '/api/propostas/confirmacao/abrir',
        origin,
        write,
        wrap(async (req, res) => {
            if (!(await limit(req, res, 'proposal-open', req.ip, 30, 900000))) return;
            const result = await service.open(req.body.token);
            res.cookie(cookieName, result.cookie, {
                httpOnly: true,
                secure: config.production,
                sameSite: 'strict',
                path: '/',
                maxAge: Math.max(0, result.expiresAt - Date.now()),
            });
            const { cookie, ...publicResult } = result;
            res.json({ sucesso: true, ...publicResult });
        }),
    );

    app.get(
        '/api/propostas/confirmacao/contexto',
        wrap(async (req, res) => {
            if (!(await limit(req, res, 'proposal-context', req.ip, 60, 900000))) return;
            res.json({ sucesso: true, ...(await service.context(readCookie(req))) });
        }),
    );

    app.post(
        '/api/propostas/confirmacao/validar',
        origin,
        write,
        wrap(async (req, res) => {
            if (!(await limit(req, res, 'proposal-code-ip', req.ip, 20, 900000))) return;
            res.json({
                sucesso: true,
                ...(await service.validate(
                    readCookie(req),
                    req.get('x-csrf-token'),
                    req.body.code,
                )),
            });
        }),
    );

    app.post(
        '/api/propostas/confirmacao/concluir',
        origin,
        write,
        wrap(async (req, res) => {
            if (!(await limit(req, res, 'proposal-confirm-ip', req.ip, 20, 900000))) return;
            const result = await service.confirm(
                readCookie(req),
                req.get('x-csrf-token'),
                req.body.consent,
                actor(req),
            );
            await audit(req, 'proposal_accepted', { outcome: 'success' });
            res.json({ sucesso: true, ...result });
            worker.wake();
        }),
    );

    // Optional Airtable webhook: authenticated notification only wakes the reconciler.
    // The periodic scan remains authoritative, including after outages or expired webhooks.
    app.post(
        '/internal/proposals/airtable-webhook',
        wrap(async (req, res) => {
            const settings = await service.active();
            if (!settings.webhookSecret || !Buffer.isBuffer(req.proposalsRawBody))
                return res.sendStatus(503);
            const crypto = require('node:crypto');
            const expected = crypto
                .createHmac('sha256', Buffer.from(secrets.open(settings.webhookSecret), 'base64'))
                .update(req.proposalsRawBody)
                .digest('hex');
            const received = String(req.get('x-airtable-content-mac') || '').replace(
                /^hmac-sha256=/,
                '',
            );
            if (!secrets.equal(expected, received)) return res.sendStatus(401);
            const timestamp = Date.parse(req.body.timestamp);
            if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 300000)
                return res.sendStatus(401);
            const nonce = secrets.hash(req.proposalsRawBody).slice(0, 32);
            if (!(await store.nonce(nonce))) return res.sendStatus(204);
            if (req.body.base?.id !== config.financeAirtable.baseId) return res.sendStatus(422);
            if (!(await limit(req, res, 'proposal-webhook', 'base', 10, 60000))) return;
            res.sendStatus(204);
            worker.rescan();
        }),
    );

    app.get(
        '/internal/proposals/pdf/:eventId',
        wrap(async (req, res) => {
            const path = req.path;
            if (
                !verify(config.notifications.secret, 'GET', path, req.headers) ||
                !(await store.nonce(req.get('x-itr-nonce')))
            ) {
                return res.status(401).json({ sucesso: false });
            }
            if (!/^[a-f0-9]{64}$/.test(req.params.eventId)) return res.sendStatus(404);
            const row = await store.event(req.params.eventId);
            if (!row || row.status !== 'pending') return res.sendStatus(404);
            const payload = secrets.open(row.payload);
            if (payload.type !== 'NEW') return res.sendStatus(404);
            const proposal = await service.checkEvent(payload);
            const document = await readPdf(proposal.anexos[0].url);
            if (document.hash !== payload.snapshot.pdfHash) return res.sendStatus(409);
            res.set('Content-Type', 'application/pdf');
            res.set('Content-Disposition', disposition(payload.snapshot.filename, 'attachment'));
            res.send(document.bytes);
        }),
    );
}

module.exports = { registerRoutes };
