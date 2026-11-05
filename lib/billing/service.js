'use strict';
const crypto = require('node:crypto');
const { hash, canonical } = require('./protocol');
const { valid, eventId, today } = require('./contract');
const { collection, eligible, eventVersion } = require('./policy');
const active = e => ['pending', 'retry', 'sending'].includes(e.status);
const code = error => /^[A-Z0-9_]{1,64}$/.test(error.message) ? error.message : 'SOURCE_UNAVAILABLE';
// Recoverable by correcting the registry: the event waits instead of being cancelled.
const HELD = ['PAYMENT_DATA_INCONSISTENT', 'DOCUMENT_HELD'];
// Corrections often take several edits, so one version must hold still before it is announced.
const UPDATE_SETTLE_MS = 900000;
const transient = error => ['SOURCE_UNAVAILABLE', 'SOURCE_TOO_SLOW', 'RATE_LIMITED', 'BUSY', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', ...HELD].includes(code(error));
function makeEvent(s, type, recipient, transitionId = null, scheduledFor, previous) {
    const p = { protocol: 'itr-billing-v1', eventId: '', type, recipient,
        clientId: s.clientId, proposalId: s.proposalId, contractId: s.contractId, invoiceId: s.invoiceId,
        contractName: s.contractName, installment: s.installment, amountCents: s.amountCents,
        dueDate: s.dueDate, stateVersion: eventVersion(s, type), transitionId,
        document: type === 'BOLETO_PAYMENT_RECORDED' ? null : s.documents[type === 'NFSE_AVAILABLE' ? 'nfse' : 'boleto'] };
    if (type === 'BOLETO_OVERDUE_REMINDER') p.scheduledFor = scheduledFor;
    if (type === 'BOLETO_UPDATED') p.previous = previous;
    p.eventId = eventId(p);
    if (!valid(p)) throw new Error('INVALID_EVENT');
    return p;
}
function initial(s, now) {
    return { baselineAt: now, snapshot: s, stopped: s.paymentStatus === 'Pago', transitionId: null,
        stoppedAt: s.paymentStatus === 'Pago' ? now : null,
        armed: { boleto: false, nfse: false }, seen: { boleto: !!s.documents.boleto || !!s.documentErrors?.boleto, nfse: !!s.documents.nfse || !!s.documentErrors?.nfse }, blockedKinds: [], leases: [], audiences: {} };
}
// What a boleto message states to the client. Never includes the attachment id or URL.
const material = s => ({ sha256: s.documents.boleto.sha256, dueDate: s.dueDate, amountCents: s.amountCents });
const stated = p => ({ sha256: p.document.sha256, dueDate: p.dueDate, amountCents: p.amountCents });
const told = a => a && ({ sha256: a.sha256, dueDate: a.dueDate, amountCents: a.amountCents });
const differs = (before, now) => before.sha256 !== now.sha256 || before.dueDate !== now.dueDate || before.amountCents !== now.amountCents;
// Any attempt may have reached the client, so it counts as notified.
const attempted = (events, match) => events.filter(e => e.attempts > 0 && match(e.payload)).sort((a, b) => a.createdAt - b.createdAt);
// Reminders that a message carrying the same document can stand in for on the same day.
const DATED = ['BOLETO_D_MINUS_1', 'BOLETO_DUE_TODAY', 'BOLETO_OVERDUE_REMINDER'];
// Only a receipt from the receiver proves delivery. A pending message delays the reminder and takes nothing away.
function sameDay(events, recipient, now) {
    const covering = events.filter(e => ['BOLETO_AVAILABLE', 'BOLETO_UPDATED'].includes(e.payload.type) && e.payload.recipient === recipient);
    if (covering.some(active)) return 'wait';
    return covering.some(e => e.status === 'sent' && e.receipt?.at && today(e.receipt.at) === today(now)) ? 'covered' : 'send';
}
// Identifies one occurrence of a message, regardless of who receives it.
function occurrence(s, type, state, day) {
    const kind = type === 'NFSE_AVAILABLE' ? 'nfse' : 'boleto';
    if (type === 'BOLETO_PAYMENT_RECORDED') return { key: hash(canonical([type, state.transitionId])), day: null };
    if (['NFSE_AVAILABLE', 'BOLETO_AVAILABLE'].includes(type)) return { key: hash(canonical([type, s.documents[kind].sha256])), day: null };
    if (type === 'BOLETO_UPDATED') return { key: hash(canonical([type, material(s), told(state.announced)])), day: null };
    return { key: hash(canonical([type, s.documents.boleto.sha256, s.dueDate, day])), day };
}
function createService({ store, source, clock = Date.now, pilotClients = [] }) {
    const pilot = new Set(pilotClients);
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
        const now = clock(), state = previous || initial(s, now), released = pilot.has(s.clientId);
        const old = state.snapshot;
        if (previous) {
            state.suspect ||= {};
            for (const kind of ['boleto', 'nfse']) {
                const a = old.documents[kind], b = s.documents[kind];
                // Outside the pilot a document is only seen, so a later release sends nothing about it.
                if (b && !a && !state.seen[kind]) { state.armed[kind] = released; state.seen[kind] = true; }
                // An attachment is immutable: other content under its id is an anomaly, not a correction. Only a new attachment goes on.
                if (a && b && a.id === b.id && a.sha256 !== b.sha256) state.suspect[kind] = b.id;
            }
            // Data and documents can be corrected. A different owner never continues on its own.
            if (old.clientId !== s.clientId || old.contractId !== s.contractId || old.proposalId !== s.proposalId || old.cnpjTag !== s.cnpjTag)
                state.blockedKinds.push('boleto', 'nfse');
            if (s.paymentStatus === 'Pago') {
                state.stopped = true;
                if (!released) state.paymentCandidate = null;
                // Two independent observations, never a transition from baseline Pago.
                if (released && old.paymentStatus !== 'Pago' && !state.paymentCandidate && !state.transitionId && !previous.stoppedAt)
                    state.paymentCandidate = hash(canonical([s.invoiceId, old.stateVersion, s.stateVersion, now]));
                else if (old.paymentStatus === 'Pago' && state.paymentCandidate && !state.transitionId) {
                    state.transitionId = state.paymentCandidate; state.paymentCandidate = null;
                }
                state.stoppedAt ||= now;
            } else if (state.paymentCandidate) state.paymentCandidate = null;
            if (old.stateVersion !== s.stateVersion) await cancel(repo, s.invoiceId, e => (!e.payload.document || s.documents[e.payload.document.kind]) && eventVersion(s, e.payload.type) !== e.payload.stateVersion, 'STATE_CHANGED');
        }
        state.blockedKinds = [...new Set(state.blockedKinds)];
        if (state.blockedKinds.length || Object.keys(state.suspect || {}).length) await repo.auditOnce(s.invoiceId, 'RECONCILIATION_REQUIRED', now);
        state.snapshot = s;
        for (const reason of Object.values(s.documentErrors || {})) await repo.auditOnce(s.invoiceId, reason, now);
        if (s.invalidRecipients) await repo.auditOnce(s.invoiceId, 'RECIPIENT_INVALID', now);
        if (s.paymentDataInconsistent) await repo.auditOnce(s.invoiceId, HELD[0], now);
        // A reversal never restarts collection. No monitoring channel exists yet, so the alert is recorded as undelivered.
        if (state.stopped && s.paymentStatus !== 'Pago') {
            await repo.auditOnce(s.invoiceId, 'PAYMENT_REVERSAL_REVIEW', now);
            await repo.auditOnce(s.invoiceId, 'OPERATIONAL_ALERT_UNDELIVERED', now);
        }
        if (state.stopped) await cancel(repo, s.invoiceId, e => collection(e.payload.type), 'COLLECTION_STOPPED');
        await repo.version(s);
        await repo.saveState(s.invoiceId, state);
        return state;
    }
    // Decides which boleto messages apply now. The events are the record of what was notified, so a restart loses nothing.
    async function boletoTypes(repo, state, events, now) {
        const s = state.snapshot, current = material(s), before = canonical([state.announced, state.candidate]);
        const last = attempted(events, p => p.document?.kind === 'boleto').at(-1);
        if (last && last.payload.eventId !== state.announced?.eventId) state.announced = { eventId: last.payload.eventId, ...stated(last.payload) };
        const announced = state.announced;
        // A value filled in for the first time corrects nothing the client was told.
        if (announced?.sha256 === current.sha256) {
            announced.dueDate ??= current.dueDate;
            announced.amountCents ??= current.amountCents;
        }
        const types = [], days = s.dueDate ? (Date.parse(today(now)) - Date.parse(s.dueDate)) / 86400000 : NaN;
        const schedule = () => {
            if (days === -1) types.push('BOLETO_D_MINUS_1');
            if (days === 0) types.push('BOLETO_DUE_TODAY');
            if (days > 0 && days % 5 === 0) types.push('BOLETO_OVERDUE_REMINDER');
        };
        const updates = events.filter(e => e.payload.type === 'BOLETO_UPDATED' && canonical(stated(e.payload)) === canonical(current));
        if (!announced) {
            // Nothing reached the client: corrections stay silent and the agenda simply follows the current data.
            state.candidate = null;
            types.push('BOLETO_AVAILABLE');
            schedule();
        } else if (!differs(announced, current)) {
            state.candidate = null;
            schedule();
        } else {
            // Until the new version is announced, nothing about the old one goes out.
            const key = hash(canonical(current));
            if (state.candidate?.key !== key) state.candidate = { key, since: now };
            await repo.auditOnce(s.invoiceId, 'BOLETO_VERSION_CHANGED', now);
            if (!current.dueDate || !current.amountCents) await repo.auditOnce(s.invoiceId, 'BOLETO_VERSION_INCOMPLETE', now);
            else if (updates.some(e => canonical(e.payload.previous) === canonical(told(announced))) && !updates.some(e => active(e))) await repo.auditOnce(s.invoiceId, 'BOLETO_VERSION_REVIEW', now);
            else if (now - state.candidate.since >= UPDATE_SETTLE_MS) types.push('BOLETO_UPDATED');
        }
        if (canonical([state.announced, state.candidate]) !== before) await repo.saveState(s.invoiceId, state);
        return types;
    }
    async function queue(repo, state) {
        const s = state.snapshot, now = clock(), types = [];
        if (!pilot.has(s.clientId)) return;
        const clear = kind => state.armed[kind] && s.documents[kind] && state.suspect?.[kind] !== s.documents[kind].id;
        const wantsBoleto = !state.stopped && !s.paymentDataInconsistent && clear('boleto');
        const wantsNfse = clear('nfse'), wantsPayment = state.transitionId && s.paymentStatus === 'Pago';
        const events = wantsBoleto || wantsNfse || wantsPayment ? await repo.events(s.invoiceId) : [];
        if (wantsNfse) {
            const sent = attempted(events, p => p.document?.kind === 'nfse').at(-1);
            if (!sent) types.push('NFSE_AVAILABLE');
            // Replacing a fiscal document already delivered has no approved message yet.
            else if (sent.payload.document.sha256 !== s.documents.nfse.sha256) await repo.auditOnce(s.invoiceId, 'NFSE_REPLACED_REVIEW', now);
        }
        if (wantsPayment && !attempted(events, p => p.transitionId === state.transitionId).length) types.push('BOLETO_PAYMENT_RECORDED');
        if (wantsBoleto) types.push(...await boletoTypes(repo, state, events, now));
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
        // Read once the messages of this pass exist, since they run before the reminders.
        let current;
        for (const type of types) for (const recipient of (audiences[occurrence(s, type, state, civilDay).key]?.recipients || []).filter(r => s.registered.includes(r))) {
            try {
                const p = makeEvent(s, type, recipient, type === 'BOLETO_PAYMENT_RECORDED' ? state.transitionId : null, today(now), told(state.announced));
                const existing = await repo.event(p.eventId);
                // An immutable intent is never resurrected with a different payload.
                if (existing) continue;
                if (DATED.includes(type)) {
                    current ||= await repo.events(s.invoiceId);
                    const verdict = sameDay(current, recipient, now);
                    if (verdict === 'covered') await repo.auditOnce(p.eventId, 'REMINDER_CONSOLIDATED', now);
                    if (verdict !== 'send') continue;
                }
                await eligible(s, state, p, now);
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
                        if (s.paymentDataInconsistent) await root.auditOnce(s.invoiceId, HELD[0], clock());
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
                            const newRecord = !previous && createdAt > meta.completedAt && createdAt <= clock() && pilot.has(s.clientId);
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
                    if (!e || !active(e) || e.invalidated || canonical(e.payload) !== canonical(event)) throw new Error('EVENT_OBSOLETE');
                    if (!pilot.has(s.clientId)) throw new Error('CLIENT_NOT_RELEASED');
                    // Removed or unreadable: it waits, because the same document may come back.
                    if (event.document && !s.documents[event.document.kind]) throw new Error('DOCUMENT_HELD');
                    if (eventVersion(s, event.type) !== event.stateVersion) throw new Error('EVENT_OBSOLETE');
                    if (phase === 'smtp' && e.status !== 'sending') throw new Error('DISPATCH_REQUIRED');
                    const approval = await eligible(s, state, event, clock());
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
                } catch (error) {
                    denial = error;
                    // A held event is checked again until the registry is corrected: one record per day is enough.
                    if (HELD.includes(code(error))) await repo.auditOnce(event.eventId, code(error), clock());
                    else await repo.audit(event.eventId, code(error), clock());
                }
            });
            if (denial) throw denial;
            return result;
        });
    }
    return { scan, validate, cancel };
}
module.exports = { createService, makeEvent, initial, code, transient, HELD, UPDATE_SETTLE_MS };
