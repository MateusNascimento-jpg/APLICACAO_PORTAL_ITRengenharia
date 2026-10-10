'use strict';

const crypto = require('node:crypto');
const { readPdf } = require('./pdf');

const ELIGIBLE = new Set(['Enviada', 'Em Análise pelo Cliente']);
const TTL = 30 * 60 * 1000;

function fail(code) {
    throw Object.assign(new Error(code), { code });
}

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

    function event(type, snap, recipient, extra = {}) {
        const identity = [type, snap.proposal.id, snap.version, recipient, extra.challengeId || ''];
        const id = secrets.hash(JSON.stringify(identity));
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
            state.activeChallenge !== challenge.id ||
            challenge.expiresAt <= now() ||
            challenge.attempts >= 5
        ) {
            fail('CHALLENGE_INVALID');
        }
        if (state.decision) fail('DECISION_EXISTS');
    }

    async function options(cnpj, id) {
        await active();
        const proposal = await airtable.carregarPropostaAtual(id, cnpj);
        if (!ELIGIBLE.has(proposal.status)) fail('PROPOSAL_TERMINAL');
        if (!proposal.emails.length) fail('RECIPIENT_MISSING');
        return proposal.emails.map((email) => ({
            key: secrets.codeHash(id, email),
            label: email.replace(/^(.{1,2})[^@]*@/, '$1***@'),
        }));
    }

    async function request(cnpj, id, recipientKey, actor) {
        await active();
        return store.withLock(id, async (repo) => {
            const state = await repo.state(id);
            if (state.decision) fail('DECISION_EXISTS');
            if (state.requestedAt && now() - state.requestedAt < 60000) fail('REQUEST_TOO_SOON');
            const proposal = await airtable.carregarPropostaAtual(id, cnpj);
            if (!ELIGIBLE.has(proposal.status)) fail('PROPOSAL_TERMINAL');
            const recipient = proposal.emails.find((email) =>
                secrets.equal(secrets.codeHash(id, email), recipientKey),
            );
            if (!recipient) fail('RECIPIENT_INVALID');
            const snap = await snapshot(proposal);
            const code = secrets.code();
            const token = secrets.token();
            const challenge = {
                id: crypto.randomUUID(),
                proposalId: id,
                cnpj,
                recipient,
                tokenHash: secrets.hash(token),
                snapshot: snap,
                expiresAt: now() + TTL,
                attempts: 0,
                createdAt: now(),
                actor,
            };
            challenge.codeHash = secrets.codeHash(challenge.id, code);
            await repo.transaction(async () => {
                await repo.saveChallenge(challenge);
                await repo.saveState(id, {
                    ...state,
                    activeChallenge: challenge.id,
                    requestedAt: now(),
                });
                await repo.enqueue(
                    event('VERIFY', snap, recipient, {
                        challengeId: challenge.id,
                        expiresAt: challenge.expiresAt,
                        actionUrl: `${origin}/confirmar-proposta.html#${token}`,
                    }),
                );
            });
            return { code, expiresAt: challenge.expiresAt };
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

    async function finish(repo, state, proposal) {
        const decision = state.decision;
        if (proposal.status !== decision.status || proposal.cnpj !== decision.cnpj)
            fail('DECISION_UNCERTAIN');
        if (decision.status === 'Rejeitada' && proposal.feedback !== decision.feedback)
            fail('DECISION_UNCERTAIN');
        const snap = await snapshot(proposal);
        if (snap.version !== decision.snapshot.version) fail('PROPOSAL_CHANGED');
        await repo.transaction(async () => {
            decision.state = 'done';
            decision.completedAt = now();
            state.activeChallenge = null;
            await repo.saveState(proposal.id, state);
            if (decision.status === 'Aceita') {
                // Freeze original intended recipients; remove contacts revoked since confirmation.
                for (const recipient of decision.recipients.filter((email) =>
                    proposal.emails.includes(email),
                )) {
                    await repo.enqueue(event('ACCEPTED', decision.snapshot, recipient));
                }
            }
        });
        return { status: decision.status, numero: proposal.numero };
    }

    async function apply(repo, state, proposal, decision) {
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
            if (!proposal.emails.includes(challenge.recipient)) fail('RECIPIENT_INVALID');
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
        const snap = await snapshot(proposal);
        if (snap.version !== payload.snapshot.version) fail('EVENT_OBSOLETE');
        const state = await store.state(proposal.id);
        if (payload.type === 'VERIFY') {
            validChallenge(await store.challenge(payload.challengeId), state);
            if (!ELIGIBLE.has(proposal.status)) fail('EVENT_OBSOLETE');
        } else if (payload.type === 'NEW') {
            if (!ELIGIBLE.has(proposal.status) || state.decision) fail('EVENT_OBSOLETE');
        } else if (payload.type === 'ACCEPTED') {
            if (
                proposal.status !== 'Aceita' ||
                state.decision?.state !== 'done' ||
                state.decision.status !== 'Aceita'
            )
                fail('EVENT_OBSOLETE');
        } else fail('EVENT_INVALID');
        return proposal;
    }

    return {
        active,
        options,
        request,
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

module.exports = { createService, ELIGIBLE, TTL };
