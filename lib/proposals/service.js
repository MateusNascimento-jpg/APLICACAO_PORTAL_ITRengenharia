'use strict';

const crypto = require('node:crypto');
const { readPdf } = require('./pdf');
const { generate: generateComprovante } = require('./comprovante');

const ELIGIBLE = new Set(['Enviada', 'Em Análise pelo Cliente']);
const TTL = 2 * 60 * 60 * 1000; // Token de aceite: 120 minutos.

// Política de emissão por proposta (persistida no estado, sob lock):
// o 1º pedido é imediato; reenvios exigem intervalo crescente desde o anterior
// e há um teto de pedidos por janela móvel. Só pedidos efetivamente
// registrados contam; envio cancelado pela fila não pune o cliente.
const REQUEST_WINDOW = TTL;
const REQUEST_MAX = 6;
const REQUEST_COOLDOWNS = [60000, 120000, 300000, 600000];

function fail(code, extra) {
    throw Object.assign(new Error(code), { code }, extra);
}

function mask(email) {
    return email.replace(/^(.{1,2})[^@]*@/, '$1***@');
}

// Estado público do envio do VERIFY, derivado da outbox real.
const DELIVERY = { pending: 'queued', sent: 'sent', cancelled: 'failed', uncertain: 'uncertain' };

function summary(proposal) {
    return {
        id: proposal.id,
        numero: proposal.numero,
        cnpj: proposal.cnpj,
        clienteId: proposal.clienteId,
        nomeCliente: proposal.nomeCliente,
        valor: proposal.valor,
        formaPagamento: proposal.formaPagamento,
        prazoPagamentoDias: proposal.prazoPagamentoDias,
        observacoes: proposal.observacoes,
        descricao: proposal.descricao || null,
        emailContato: Array.isArray(proposal.emails) ? proposal.emails.join(', ') : null,
        dataEnvio: proposal.dataEnvio,
    };
}

function createService({
    store,
    airtable,
    secrets,
    origin,
    enabled,
    pdf = readPdf,
    now = Date.now,
    authorizedContacts,
}) {
    async function active() {
        if (!enabled()) fail('SAFE_MODE');
        const settings = await store.settings();
        if (!settings.enabled || !settings.cutoff) fail('PROPOSALS_DISABLED');
        return settings;
    }

    function fingerprint(proposal, hash) {
        return secrets.hash(
            JSON.stringify({
                ...summary(proposal),
                attachmentId: proposal.anexos[0]?.id,
                pdfHash: hash,
            }),
        );
    }

    async function snapshot(proposal) {
        if (
            !Number.isFinite(proposal.valor) ||
            proposal.valor < 0 ||
            proposal.numero == null ||
            String(proposal.numero).length > 100 ||
            /[\r\n]/.test(String(proposal.numero))
        )
            fail('PROPOSAL_INCOMPLETE');
        if (proposal.anexos.length !== 1) fail('PDF_AMBIGUOUS');
        const attachment = proposal.anexos[0];
        const result = await pdf(attachment.url);
        return {
            version: fingerprint(proposal, result.hash),
            pdfHash: result.hash,
            attachmentId: attachment.id,
            filename: attachment.filename || 'Proposta.pdf',
            proposal: summary(proposal),
        };
    }

    function eventId(type, snap, recipient, challengeId = '') {
        return secrets.hash(JSON.stringify([type, snap.proposal.id, snap.version, recipient, challengeId]));
    }

    function event(type, snap, recipient, extra = {}) {
        const id = eventId(type, snap, recipient, extra.challengeId);
        const payload = { eventId: id, type, recipient, snapshot: snap, ...extra };
        return {
            id,
            proposalId: snap.proposal.id,
            priority: type === 'VERIFY' ? 0 : 1,
            payload: secrets.seal(payload),
        };
    }

    function validChallenge(challenge, state) {
        if (
            !challenge ||
            !(Array.isArray(state.activeChallenges)
                ? state.activeChallenges.includes(challenge.id)
                : state.activeChallenge === challenge.id) ||
            challenge.expiresAt <= now() ||
            challenge.attempts >= 5
        ) {
            fail('CHALLENGE_INVALID');
        }
        if (state.decision) fail('DECISION_EXISTS');
    }

    async function authorized(proposal) {
        if (!authorizedContacts) fail('AUTHORIZATIONS_UNAVAILABLE');
        const allowed = await authorizedContacts.forProposal(proposal);
        if (!Array.isArray(allowed) || !allowed.length) fail('RECIPIENT_MISSING');
        return allowed;
    }

    async function options(cnpj, id) {
        await active();
        const proposal = await airtable.carregarPropostaAtual(id, cnpj);
        if (!ELIGIBLE.has(proposal.status)) fail('PROPOSAL_TERMINAL');
        return (await authorized(proposal)).map((email) => ({
            key: secrets.codeHash(id, email),
            label: mask(email),
        }));
    }

    // Pedidos que contam para a política: os registrados na janela móvel.
    // Exceção única: se o VERIFY do desafio VIGENTE foi cancelado pela fila
    // (entrega recusada), esse pedido não consome cota nem impõe espera.
    // Desafios substituídos continuam contando, mesmo que nunca entregues.
    async function requestHistory(repo, state) {
        const log = (Array.isArray(state.requestLog) ? state.requestLog
            : state.requestedAt ? [{ at: state.requestedAt }] : [])
            .filter((item) => Number.isFinite(item?.at) && now() - item.at < REQUEST_WINDOW);
        const last = log[log.length - 1];
        const failed = last?.eventId && (await repo.event(last.eventId))?.status === 'cancelled';
        return { log, counted: failed ? log.slice(0, -1) : log };
    }

    function nextRequestAt(counted) {
        if (!counted.length) return 0;
        if (counted.length >= REQUEST_MAX) return counted[counted.length - REQUEST_MAX].at + REQUEST_WINDOW;
        const last = counted[counted.length - 1].at;
        return last + REQUEST_COOLDOWNS[Math.min(counted.length - 1, REQUEST_COOLDOWNS.length - 1)];
    }

    async function delivery(repo, challenge) {
        const id = challenge.eventId ||
            eventId('VERIFY', challenge.snapshot, challenge.recipient, challenge.id);
        const row = await repo.event(id);
        return row ? DELIVERY[row.status] || 'queued' : 'queued';
    }

    // Retomada do modal: nada de código, hash ou endereço completo.
    // A posse é verificada pelo CNPJ gravado no próprio desafio/decisão,
    // sem consultar o Airtable a cada atualização da tela.
    async function status(cnpj, id) {
        await active();
        const state = await store.state(id);
        const decision = state.decision?.cnpj === cnpj
            ? { status: state.decision.status, state: state.decision.state } : null;
        const challengeId = state.activeChallenge || state.activeChallenges?.[0];
        const challenge = challengeId ? await store.challenge(challengeId) : null;
        const owned = challenge && challenge.cnpj === cnpj;
        if (!decision && !owned) return { now: now(), decision: null, challenge: null, nextRequestAt: 0 };
        const { counted } = await requestHistory(store, state);
        const usable = owned && !state.decision && challenge.expiresAt > now() && challenge.attempts < 5;
        return {
            now: now(),
            decision,
            challenge: usable ? {
                recipientKey: secrets.codeHash(id, challenge.recipient),
                recipientLabel: mask(challenge.recipient),
                expiresAt: challenge.expiresAt,
                attemptsRemaining: 5 - challenge.attempts,
                delivery: await delivery(store, challenge),
            } : null,
            nextRequestAt: decision ? 0 : nextRequestAt(counted),
            requestsRemaining: Math.max(0, REQUEST_MAX - counted.length),
        };
    }

    // Oito dígitos são enviados somente ao contato comercial selecionado.
    // O frontend jamais recebe o código em resposta ao pedido.
    async function request(cnpj, id, actor, recipientKey) {
        await active();
        return store.withLock(id, async (repo) => {
            const state = await repo.state(id);
            if (state.decision) fail('DECISION_EXISTS');
            const { counted } = await requestHistory(repo, state);
            const allowedAt = nextRequestAt(counted);
            if (allowedAt > now()) fail('REQUEST_TOO_SOON', { retryAfterMs: allowedAt - now() });
            const previousId = state.activeChallenge || state.activeChallenges?.[0];
            const previous = previousId ? await repo.challenge(previousId) : null;
            const proposal = await airtable.carregarPropostaAtual(id, cnpj);
            if (!ELIGIBLE.has(proposal.status)) fail('PROPOSAL_TERMINAL');
            const recipients = await authorized(proposal);
            const recipient = recipients.find((email) => secrets.equal(secrets.codeHash(id, email), recipientKey));
            if (!recipient) fail('RECIPIENT_INVALID');
            const snap = await snapshot(proposal);
            const code = secrets.code();
            const expiresAt = now() + TTL;
            const challenge = {
                id: crypto.randomUUID(), proposalId: id, cnpj, recipient,
                // A coluna token_hash é mantida por compatibilidade com o schema vigente.
                tokenHash: secrets.hash(secrets.token()),
                snapshot: snap, expiresAt, attempts: 0, createdAt: now(), actor,
            };
            challenge.codeHash = secrets.codeHash(challenge.id, code);
            const notification = event('VERIFY', snap, recipient, {
                challengeId: challenge.id, expiresAt, code,
            });
            challenge.eventId = notification.id;
            const entry = { at: now(), eventId: notification.id };
            const requested = [...counted, entry];
            await repo.transaction(async () => {
                await repo.saveChallenge(challenge);
                await repo.enqueue(notification); // conteúdo selado (AES-256-GCM) na outbox
                await repo.saveState(id, {
                    ...state, activeChallenge: challenge.id, activeChallenges: [challenge.id],
                    requestedAt: now(),
                    requestLog: requested.slice(-REQUEST_MAX),
                });
            });
            return {
                expiresAt, recipientsCount: 1, recipientLabel: mask(recipient),
                replaced: Boolean(previous && previous.expiresAt > now() && previous.attempts < 5),
                delivery: 'queued',
                nextRequestAt: nextRequestAt(requested),
                requestsRemaining: Math.max(0, REQUEST_MAX - requested.length),
            };
        });
    }

    async function validateForClient(cnpj, id, code) {
        await active();
        return store.withLock(id, async (repo) => {
            const state = await repo.state(id);
            if (state.decision) fail('DECISION_EXISTS');
            const challenge = await repo.challenge(state.activeChallenge || state.activeChallenges?.[0]);
            validChallenge(challenge, state);
            const proposal = await airtable.carregarPropostaAtual(id, cnpj);
            if (challenge.cnpj !== cnpj || !ELIGIBLE.has(proposal.status)) fail('CHALLENGE_INVALID');
            if (!(await authorized(proposal)).includes(challenge.recipient)) fail('RECIPIENT_INVALID');
            const snap = await snapshot(proposal);
            if (snap.version !== challenge.snapshot.version) fail('PROPOSAL_CHANGED');
            if (!/^\d{8}$/.test(code || '') ||
                !secrets.equal(challenge.codeHash, secrets.codeHash(challenge.id, code))) {
                challenge.attempts += 1;
                await repo.saveChallenge(challenge);
                fail('CODE_INVALID');
            }
            const nonce = secrets.token();
            challenge.verifiedGrant = secrets.hash(nonce);
            challenge.verifiedAt = now();
            await repo.saveChallenge(challenge);
            return {
                confirmation: secrets.seal({ purpose: 'proposal-accept', id, cnpj,
                    challengeId: challenge.id, nonce, expiresAt: challenge.expiresAt }),
                expiresAt: challenge.expiresAt,
                proposal: challenge.snapshot.proposal,
            };
        });
    }

    async function confirmForClient(cnpj, id, confirmation, consent, actor) {
        await active();
        if (consent !== true) fail('CONSENT_REQUIRED');
        let grant;
        try { grant = secrets.open(confirmation); } catch (_) { fail('CHALLENGE_INVALID'); }
        if (grant?.purpose !== 'proposal-accept' || grant.id !== id ||
            grant.cnpj !== cnpj) fail('CHALLENGE_INVALID');
        return store.withLock(id, async (repo) => {
            const state = await repo.state(id);
            // Repetição (resposta perdida): o MESMO desafio já concluído devolve o
            // resultado gravado, sem novo PATCH nem nova notificação.
            if (state.decision?.challengeId === grant.challengeId && state.decision.cnpj === cnpj) {
                if (state.decision.state !== 'done') fail('DECISION_UNCERTAIN');
                return { status: state.decision.status,
                    numero: state.decision.snapshot.proposal.numero, repetido: true };
            }
            if (grant.expiresAt <= now()) fail('CHALLENGE_INVALID');
            const challenge = await repo.challenge(grant.challengeId);
            validChallenge(challenge, state);
            if (!secrets.equal(challenge.verifiedGrant, secrets.hash(grant.nonce))) fail('CODE_REQUIRED');
            const proposal = await airtable.carregarPropostaAtual(id, cnpj);
            if (!ELIGIBLE.has(proposal.status)) fail('PROPOSAL_TERMINAL');
            if (!(await authorized(proposal)).includes(challenge.recipient)) fail('RECIPIENT_INVALID');
            const snap = await snapshot(proposal);
            if (snap.version !== challenge.snapshot.version) fail('PROPOSAL_CHANGED');
            return apply(repo, state, proposal, {
                status: 'Aceita', cnpj, challengeId: challenge.id, snapshot: snap,
                recipients: proposal.emails, verifiedAt: challenge.verifiedAt,
                consentAt: now(), actor, requestedBy: challenge.actor,
            });
        });
    }

    async function open(token) {
        await active();
        if (!/^[\w-]{43}$/.test(token || '')) fail('CHALLENGE_INVALID');
        const challenge = await store.token(secrets.hash(token));
        if (!challenge) fail('CHALLENGE_INVALID');
        const state = await store.state(challenge.proposalId);
        validChallenge(challenge, state);
        const grant = {
            purpose: 'proposal-confirmation',
            id: challenge.id,
            csrf: secrets.token(),
            nonce: secrets.token(),
            expiresAt: challenge.expiresAt,
        };
        return {
            cookie: secrets.seal(grant),
            csrf: grant.csrf,
            expiresAt: grant.expiresAt,
            proposal: challenge.snapshot.proposal,
        };
    }

    function grant(cookie) {
        try {
            const result = secrets.open(cookie);
            if (result.purpose !== 'proposal-confirmation' || result.expiresAt <= now())
                fail('CHALLENGE_INVALID');
            return result;
        } catch (_) {
            fail('CHALLENGE_INVALID');
        }
    }

    async function context(cookie) {
        await active();
        const session = grant(cookie);
        const challenge = await store.challenge(session.id);
        if (!challenge) fail('CHALLENGE_INVALID');
        validChallenge(challenge, await store.state(challenge.proposalId));
        return {
            csrf: session.csrf,
            expiresAt: session.expiresAt,
            proposal: challenge.snapshot.proposal,
        };
    }

    async function validate(cookie, csrf, code) {
        await active();
        const session = grant(cookie);
        if (!secrets.equal(session.csrf, csrf)) fail('CSRF_INVALID');
        const found = await store.challenge(session.id);
        if (!found) fail('CHALLENGE_INVALID');
        return store.withLock(found.proposalId, async (repo) => {
            const challenge = await repo.challenge(session.id);
            validChallenge(challenge, await repo.state(found.proposalId));
            if (
                !/^\d{8}$/.test(code || '') ||
                !secrets.equal(challenge.codeHash, secrets.codeHash(challenge.id, code))
            ) {
                challenge.attempts += 1;
                await repo.saveChallenge(challenge);
                fail('CODE_INVALID');
            }
            challenge.verifiedGrant = secrets.hash(session.nonce);
            challenge.verifiedAt = now();
            await repo.saveChallenge(challenge);
            return { proposal: challenge.snapshot.proposal, expiresAt: challenge.expiresAt };
        });
    }

    // Gera comprovante e preserva o PDF exato ANTES do PATCH de aceite no Airtable.
    // Um documento preparado isoladamente não é publicável até a decisão ficar done.
    async function prepareAcceptedArtifact(repo, decision, proposal) {
        const original = await pdf(proposal.anexos[0].url);
        if (original.hash !== decision.snapshot.pdfHash) fail('PROPOSAL_CHANGED');
        const artifact = generateComprovante({
            proposal: decision.snapshot.proposal,
            version: decision.snapshot.version,
            pdfHash: original.hash,
            origin,
            attachmentId: decision.snapshot.attachmentId,
            acceptedAt: decision.consentAt,
        });
        const saved = {
            proposalId: proposal.id, cnpj: decision.cnpj,
            version: decision.snapshot.version, originalHash: original.hash,
            proofHash: artifact.hash, filename: decision.snapshot.filename,
            original: original.bytes, proof: artifact.bytes,
            acceptedAt: decision.consentAt,
        };
        await repo.saveArtifact(saved);
        return { originalHash: saved.originalHash, proofHash: saved.proofHash };
    }

    async function finish(repo, state, proposal) {
        const decision = state.decision;
        if (proposal.status !== decision.status || proposal.cnpj !== decision.cnpj)
            fail('DECISION_UNCERTAIN');
        if (decision.status === 'Rejeitada' && proposal.feedback !== decision.feedback)
            fail('DECISION_UNCERTAIN');
        const snap = await snapshot(proposal);
        if (snap.version !== decision.snapshot.version) fail('PROPOSAL_CHANGED');
        if (decision.status === 'Aceita') {
            const saved = await repo.artifact(proposal.id);
            if (!saved || saved.version !== decision.snapshot.version ||
                saved.cnpj !== decision.cnpj || saved.original_sha256 !== decision.snapshot.pdfHash)
                fail('ARTIFACT_MISSING');
            decision.documentHash = saved.comprovante_sha256;
        }
        await repo.transaction(async () => {
            decision.state = 'done';
            decision.completedAt = now();
            state.activeChallenge = null;
            state.activeChallenges = [];
            await repo.saveState(proposal.id, state);
            if (decision.status === 'Aceita') {
                // Preservar destinatários originais; ignorar contatos removidos do cadastro.
                for (const recipient of decision.recipients.filter((email) =>
                    proposal.emails.includes(email),
                )) {
                    await repo.enqueue(event('ACCEPTED', decision.snapshot, recipient, { documentHash: decision.documentHash }));
                }
            }
        });
        return { status: decision.status, numero: proposal.numero };
    }

    async function apply(repo, state, proposal, decision) {
        if (decision.status === 'Aceita') await prepareAcceptedArtifact(repo, decision, proposal);
        state.decision = { ...decision, state: 'applying', preparedAt: now() };
        await repo.saveState(proposal.id, state);
        // Persist intention BEFORE external I/O. Unknown outcomes are never blindly retried.
        await airtable.atualizarDecisao(proposal.id, decision.status, decision.feedback);
        return finish(
            repo,
            state,
            await airtable.carregarPropostaAtual(proposal.id, proposal.cnpj),
        );
    }

    async function confirm(cookie, csrf, consent, actor) {
        await active();
        const session = grant(cookie);
        if (!secrets.equal(session.csrf, csrf)) fail('CSRF_INVALID');
        if (consent !== true) fail('CONSENT_REQUIRED');
        const found = await store.challenge(session.id);
        if (!found) fail('CHALLENGE_INVALID');
        return store.withLock(found.proposalId, async (repo) => {
            const state = await repo.state(found.proposalId);
            const challenge = await repo.challenge(session.id);
            if (state.decision?.state === 'done' && state.decision.challengeId === session.id) {
                return {
                    status: state.decision.status,
                    numero: state.decision.snapshot.proposal.numero,
                };
            }
            validChallenge(challenge, state);
            if (!secrets.equal(challenge.verifiedGrant, secrets.hash(session.nonce)))
                fail('CODE_REQUIRED');
            const proposal = await airtable.carregarPropostaAtual(found.proposalId, found.cnpj);
            if (!ELIGIBLE.has(proposal.status)) fail('PROPOSAL_TERMINAL');
            if (!(await authorized(proposal)).includes(challenge.recipient)) fail('RECIPIENT_INVALID');
            const snap = await snapshot(proposal);
            if (snap.version !== challenge.snapshot.version) fail('PROPOSAL_CHANGED');
            // The TTL covers code validation AND the final explicit decision.
            if (challenge.expiresAt <= now()) fail('CHALLENGE_INVALID');
            return apply(repo, state, proposal, {
                status: 'Aceita',
                cnpj: found.cnpj,
                challengeId: challenge.id,
                snapshot: snap,
                recipients: proposal.emails,
                verifiedAt: challenge.verifiedAt,
                consentAt: now(),
                actor,
                requestedBy: challenge.actor,
            });
        });
    }

    async function reject(cnpj, id, reason, details, actor) {
        await active();
        if (
            typeof reason !== 'string' ||
            reason.trim().length < 5 ||
            reason.length > 1000 ||
            typeof details !== 'string' ||
            details.length > 3000 ||
            /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(reason + details)
        )
            fail('FEEDBACK_INVALID');
        return store.withLock(id, async (repo) => {
            const state = await repo.state(id);
            if (state.decision) fail('DECISION_EXISTS');
            const proposal = await airtable.carregarPropostaAtual(id, cnpj);
            if (!ELIGIBLE.has(proposal.status)) fail('PROPOSAL_TERMINAL');
            const snap = await snapshot(proposal);
            const feedback = `Motivo: ${reason.trim()}${details.trim() ? '\n\nDetalhes: ' + details.trim() : ''}`;
            return apply(repo, state, proposal, {
                status: 'Rejeitada',
                cnpj,
                feedback,
                snapshot: snap,
                actor,
                consentAt: now(),
            });
        });
    }

    async function reconcile(id) {
        await active();
        return store.withLock(id, async (repo) => {
            const state = await repo.state(id);
            if (state.decision?.state !== 'applying') return;
            return finish(
                repo,
                state,
                await airtable.carregarPropostaAtual(id, state.decision.cnpj),
            );
        });
    }

    async function publish(id) {
        const settings = await active();
        return store.withLock(id, async (repo) => {
            const state = await repo.state(id);
            if (state.publication || state.decision) return;
            const proposal = await airtable.carregarPropostaAtual(id);
            if (
                Date.parse(proposal.createdTime) < settings.cutoff ||
                !Number.isFinite(Date.parse(proposal.createdTime))
            )
                return;
            if (!ELIGIBLE.has(proposal.status) || !proposal.emails.length) return;
            const snap = await snapshot(proposal);
            await repo.transaction(async () => {
                for (const recipient of proposal.emails)
                    await repo.enqueue(event('NEW', snap, recipient));
                state.publication = { version: snap.version, queuedAt: now() };
                await repo.saveState(id, state);
            });
        });
    }

    async function checkEvent(payload) {
        await active();
        const proposal = await airtable.carregarPropostaAtual(
            payload.snapshot.proposal.id,
            payload.snapshot.proposal.cnpj,
        );
        if (!proposal.emails.includes(payload.recipient)) fail('EVENT_OBSOLETE');
        // NEW/VERIFY pertencem à versão VIGENTE; ACCEPTED pertence à versão
        // IMUTÁVEL aceita. Uma edição posterior no Airtable não a apaga.
        if (payload.type !== 'ACCEPTED') {
            const snap = await snapshot(proposal);
            if (snap.version !== payload.snapshot.version) fail('EVENT_OBSOLETE');
        }
        const state = await store.state(proposal.id);
        if (payload.type === 'VERIFY') {
            const challenge = await store.challenge(payload.challengeId);
            validChallenge(challenge, state);
            if (!(await authorized(proposal)).includes(challenge.recipient) ||
                challenge.recipient !== payload.recipient) fail('EVENT_OBSOLETE');
            if (!ELIGIBLE.has(proposal.status)) fail('EVENT_OBSOLETE');
        } else if (payload.type === 'NEW') {
            if (!ELIGIBLE.has(proposal.status) || state.decision) fail('EVENT_OBSOLETE');
        } else if (payload.type === 'ACCEPTED') {
            if (
                proposal.status !== 'Aceita' ||
                state.decision?.state !== 'done' ||
                state.decision.status !== 'Aceita' ||
                state.decision.snapshot.version !== payload.snapshot.version ||
                state.decision.documentHash !== payload.documentHash
            )
                fail('EVENT_OBSOLETE');
        } else fail('EVENT_INVALID');
        return proposal;
    }

    return {
        active,
        options,
        request,
        status,
        validateForClient,
        confirmForClient,
        open,
        context,
        validate,
        confirm,
        reject,
        reconcile,
        publish,
        checkEvent,
        snapshot,
        grant,
    };
}

module.exports = { createService, ELIGIBLE, TTL, REQUEST_MAX, REQUEST_COOLDOWNS, REQUEST_WINDOW };
