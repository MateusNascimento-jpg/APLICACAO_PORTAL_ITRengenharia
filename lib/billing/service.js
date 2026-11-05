'use strict';
const crypto = require('node:crypto');
const { hash, canonical } = require('./protocol');
const { valid, eventId, today } = require('./contract');
const { collection, eligible, eventVersion } = require('./policy');
const active = e => ['pending', 'retry', 'sending'].includes(e.status);
const code = error => /^[A-Z0-9_]{1,64}$/.test(error.message) ? error.message : 'SOURCE_UNAVAILABLE';
const transient = error => ['SOURCE_UNAVAILABLE', 'SOURCE_TOO_SLOW', 'RATE_LIMITED', 'BUSY', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(code(error));
function makeEvent(s, type, recipient, transitionId = null, scheduledFor) {
    const p = { protocol: 'itr-billing-v1', eventId: '', type, recipient,
        clientId: s.clientId, proposalId: s.proposalId, contractId: s.contractId, invoiceId: s.invoiceId,
        contractName: s.contractName, installment: s.installment, amountCents: s.amountCents,
        dueDate: s.dueDate, stateVersion: eventVersion(s, type), transitionId,
        document: type === 'BOLETO_PAYMENT_RECORDED' ? null : s.documents[type === 'NFSE_AVAILABLE' ? 'nfse' : 'boleto'] };
    if (type === 'BOLETO_OVERDUE_REMINDER') p.scheduledFor = scheduledFor;
    p.eventId = eventId(p);
    if (!valid(p)) throw new Error('INVALID_EVENT');
    return p;
}
function initial(s, now) {
    return { baselineAt: now, snapshot: s, stopped: s.paymentStatus === 'Pago', transitionId: null,
        stoppedAt: s.paymentStatus === 'Pago' ? now : null,
        armed: { boleto: false, nfse: false }, seen: { boleto: !!s.documents.boleto || !!s.documentErrors?.boleto, nfse: !!s.documents.nfse || !!s.documentErrors?.nfse }, blockedKinds: [], leases: [], audiences: {} };
}
// Identifies one occurrence of a message, regardless of who receives it.
function occurrence(s, type, state, day) {
    const kind = type === 'NFSE_AVAILABLE' ? 'nfse' : 'boleto';
    if (type === 'BOLETO_PAYMENT_RECORDED') return { key: hash(canonical([type, state.transitionId])), day: null };
    if (['NFSE_AVAILABLE', 'BOLETO_AVAILABLE'].includes(type)) return { key: hash(canonical([type, s.documents[kind].sha256])), day: null };
    return { key: hash(canonical([type, s.documents.boleto.sha256, s.dueDate, day])), day };
}
// overdueBoletoPayable has no configuration path on purpose: it stays false until the rule is decided.
function createService({ store, source, clock = Date.now, overdueBoletoPayable = false }) {
    async function cancel(repo, invoiceId, predicate, reason) {
        for (const e of await repo.events(invoiceId)) {
            if (!active(e) || !predicate(e)) continue;
            e.invalidated = true; e.reason = reason;
            if (e.status !== 'sending') e.status = 'cancelled';
            await repo.saveEvent(e);
            await repo.audit(e.payload.eventId, reason, clock());
        }
    }
    async function observe(repo, s, previous) {
        const now = clock(), state = previous || initial(s, now);
        const old = state.snapshot;
        if (previous) {
            for (const kind of ['boleto', 'nfse']) {
                const a = old.documents[kind], b = s.documents[kind];
                if (b && !a && !state.seen[kind]) { state.armed[kind] = true; state.seen[kind] = true; }
                else if ((a && !b) || (a && b && a.sha256 !== b.sha256)) state.blockedKinds.push(kind);
            }
            if (old.dueDate !== null && old.dueDate !== s.dueDate || old.amountCents !== s.amountCents ||
                old.clientId !== s.clientId || old.contractId !== s.contractId || old.proposalId !== s.proposalId || old.cnpjTag !== s.cnpjTag)
                state.blockedKinds.push('boleto', 'nfse');
            if (s.paymentStatus === 'Pago') {
                state.stopped = true;
                // Two independent observations, never a transition from baseline Pago.
                if (old.paymentStatus !== 'Pago' && !state.paymentCandidate && !state.transitionId && !previous.stoppedAt)
                    state.paymentCandidate = hash(canonical([s.invoiceId, old.stateVersion, s.stateVersion, now]));
                else if (old.paymentStatus === 'Pago' && state.paymentCandidate && !state.transitionId) {
                    state.transitionId = state.paymentCandidate; state.paymentCandidate = null;
                }
                state.stoppedAt ||= now;
            } else if (state.paymentCandidate) state.paymentCandidate = null;
            if (old.stateVersion !== s.stateVersion) await cancel(repo, s.invoiceId, e => eventVersion(s, e.payload.type) !== e.payload.stateVersion, 'STATE_CHANGED');
        }
        state.blockedKinds = [...new Set(state.blockedKinds)];
        state.snapshot = s;
        for (const reason of Object.values(s.documentErrors || {})) await repo.auditOnce(s.invoiceId, reason, now);
        if (s.invalidRecipients) await repo.auditOnce(s.invoiceId, 'RECIPIENT_INVALID', now);
        if (state.stopped) await cancel(repo, s.invoiceId, e => collection(e.payload.type), 'COLLECTION_STOPPED');
        await repo.version(s);
        await repo.saveState(s.invoiceId, state);
        return state;
    }
    async function queue(repo, state) {
        const s = state.snapshot, now = clock(), types = [];
        if (state.armed.nfse && s.documents.nfse) types.push('NFSE_AVAILABLE');
        if (state.transitionId && s.paymentStatus === 'Pago') types.push('BOLETO_PAYMENT_RECORDED');
        if (!state.stopped && state.armed.boleto && s.documents.boleto) {
            types.push('BOLETO_AVAILABLE');
            const days = s.dueDate ? (Date.parse(today(now)) - Date.parse(s.dueDate)) / 86400000 : NaN;
            if (days === -1) types.push('BOLETO_D_MINUS_1');
            if (days === 0) types.push('BOLETO_DUE_TODAY');
            if (days > 0 && days % 5 === 0) types.push('BOLETO_OVERDUE_REMINDER');
        }
        if (!s.registered.length && types.length) await repo.auditOnce(s.invoiceId, 'RECIPIENT_UNAUTHORIZED', now);
        // Each occurrence goes to the addresses registered when it first arises, so a contact added
        // later only receives what comes next. This list only narrows: the current registry still decides.
        const civilDay = today(now), audiences = Object.fromEntries(Object.entries(state.audiences || {}).filter(([, a]) => !a.day || a.day >= civilDay));
        for (const type of types) {
            const { key, day } = occurrence(s, type, state, civilDay);
            if (!audiences[key] && s.registered.length) audiences[key] = { day, recipients: s.registered };
        }
        if (canonical(audiences) !== canonical(state.audiences || {})) {
            state.audiences = audiences;
            await repo.saveState(s.invoiceId, state);
        }
        for (const type of types) for (const recipient of (audiences[occurrence(s, type, state, civilDay).key]?.recipients || []).filter(r => s.registered.includes(r))) {
            try {
                const p = makeEvent(s, type, recipient, type === 'BOLETO_PAYMENT_RECORDED' ? state.transitionId : null, today(now));
                const existing = await repo.event(p.eventId);
                // An immutable intent is never resurrected with a different payload.
                if (existing) continue;
                await eligible(s, state, p, now, { overdueBoletoPayable });
                await repo.saveEvent({ payload: p, status: 'pending', attempts: 0, nextAt: now, createdAt: now });
                await repo.audit(p.eventId, 'QUEUED', now);
            } catch (error) { await repo.auditOnce(s.invoiceId, code(error), now); }
        }
    }
    async function scan({ shouldStop = () => false } = {}) {
        return store.locked('scan', async root => {
            const catalog = await source.catalog(), ids = catalog.ids;
            const meta = await root.meta();
            if (!meta) {
                // A source outage aborts before the first durable transaction. A record that is
                // itself invalid stays out; it joins the baseline silently once it becomes readable.
                const snapshots = [], quarantined = [];
                for (const id of ids) {
                    if (shouldStop()) return { baseline: false, stopped: true, count: 0 };
                    try { snapshots.push((await source.read(id, root, { catalog })).snapshot); }
                    catch (error) {
                        if (transient(error)) throw error;
                        quarantined.push({ id, reason: code(error) });
                    }
                }
                if (shouldStop()) return { baseline: false, stopped: true, count: 0 };
                await root.transaction(async () => {
                    for (const s of snapshots) {
                        await root.saveState(s.invoiceId, initial(s, clock())); await root.version(s);
                        for (const reason of Object.values(s.documentErrors || {})) await root.auditOnce(s.invoiceId, reason, clock());
                        if (s.invalidRecipients) await root.auditOnce(s.invoiceId, 'RECIPIENT_INVALID', clock());
                    }
                    for (const { id, reason } of quarantined) await root.auditOnce(id, reason, clock());
                    await root.saveMeta({ completedAt: clock(), count: snapshots.length, quarantined: quarantined.length, protocol: 'itr-billing-v1' });
                    await root.audit('baseline', 'BASELINE_COMPLETE', clock());
                });
                return { baseline: true, count: ids.length };
            }
            for (const id of ids) {
                if (shouldStop()) return { baseline: false, stopped: true, count: ids.length };
                await store.locked('invoice:' + id, async repo => {
                    try {
                        const { snapshot: s, createdAt } = await source.read(id, repo, { catalog });
                        await repo.transaction(async () => {
                            const previous = await repo.state(id);
                            const state = await observe(repo, s, previous);
                            // Creation time is only proof for a genuinely new record, never upload time on an old record.
                            const newRecord = !previous && createdAt > meta.completedAt && createdAt <= clock();
                            if (newRecord) {
                                state.armed = { boleto: !!s.documents.boleto, nfse: !!s.documents.nfse };
                                // A document that could not be read yet was not delivered: keep it eligible.
                                state.seen = { boleto: !!s.documents.boleto, nfse: !!s.documents.nfse };
                                await repo.saveState(id, state);
                            }
                            if (previous || newRecord) await queue(repo, state);
                        });
                    } catch (error) {
                        await repo.transaction(async () => {
                            if (!transient(error)) await cancel(repo, id, () => true, code(error));
                            await repo.auditOnce(id, code(error), clock());
                        });
                    }
                });
            }
            return { baseline: false, count: ids.length };
        });
    }
    async function validate(event, phase = 'prepare') {
        if (!valid(event) || !['prepare', 'smtp', 'pdf'].includes(phase)) throw new Error('INVALID_EVENT');
        return store.locked('invoice:' + event.invoiceId, async repo => {
            const start = clock();
            // Authorization never uses a catalog: chain, statuses and its own PDF are read now.
            const loaded = await source.read(event.invoiceId, repo, { freshKind: event.document?.kind ?? null });
            // Freshness counts from the end of the read, so its duration does not consume the proof window.
            const checkedAt = clock();
            if (checkedAt - start > 4500) throw new Error('SOURCE_TOO_SLOW');
            let result, denial;
            await repo.transaction(async () => {
                if (!await repo.meta()) throw new Error('BASELINE_REQUIRED');
                const previous = await repo.state(event.invoiceId);
                if (!previous) throw new Error('BASELINE_REQUIRED');
                const state = await observe(repo, loaded.snapshot, previous);
                // Commit observed payment/revocation even when authorization is refused.
                try {
                    const e = await repo.event(event.eventId), s = loaded.snapshot;
                    if (!e || !active(e) || e.invalidated || canonical(e.payload) !== canonical(event) || eventVersion(s, event.type) !== event.stateVersion)
                        throw new Error('EVENT_OBSOLETE');
                    if (phase === 'smtp' && e.status !== 'sending') throw new Error('DISPATCH_REQUIRED');
                    const approval = await eligible(s, state, event, clock(), { overdueBoletoPayable });
                    const expiresAt = checkedAt + 9000;
                    let leaseId;
                    if (phase === 'smtp') {
                        // An unresolved lease holds only its own event; other recipients and events go on.
                        const current = clock(), leases = state.leases || [];
                        if (e.leaseId || leases.some(l => l.eventId === event.eventId)) throw new Error('LEASE_RECONCILIATION_REQUIRED');
                        if (leases.some(l => l.recipient === event.recipient && l.expiresAt > current)) throw new Error('LEASE_BUSY');
                        leaseId = hash(crypto.randomBytes(32));
                        state.leases = [...leases.filter(l => l.expiresAt > current),
                            { id: leaseId, eventId: event.eventId, recipient: event.recipient, digest: hash(canonical(event)), expiresAt }];
                        e.leaseId = leaseId;
                        await repo.saveEvent(e); await repo.saveState(event.invoiceId, state);
                        await repo.audit(event.eventId, 'SMTP_LEASE', clock());
                    }
                    result = { bytes: loaded.bytes, proof: {
                        protocol: 'itr-billing-v1', eventDigest: hash(canonical(event)), phase,
                        authorized: true, eligible: true, chainVerified: true, baselineVerified: true,
                        proposalStatus: s.proposalStatus, contractStatus: s.contractStatus, paymentStatus: s.paymentStatus,
                        checkedAt, expiresAt, collectionStopped: state.stopped,
                        documentPayable: approval?.payable === true, payableAfterDue: approval?.payableAfterDue === true,
                        newPaymentTransition: event.type === 'BOLETO_PAYMENT_RECORDED',
                        ...(leaseId ? { leaseId } : {}),
                        access: { clientId: s.clientId, recipient: event.recipient, cnpj: loaded.cnpj }
                    } };
                } catch (error) { denial = error; await repo.audit(event.eventId, code(error), clock()); }
            });
            if (denial) throw denial;
            return result;
        });
    }
    return { scan, validate, cancel };
}
module.exports = { createService, makeEvent, initial, code, transient };
