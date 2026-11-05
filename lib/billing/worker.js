'use strict';
const { headers, canonical } = require('./protocol');
const { code, transient, HELD } = require('./service');
const ROUTE = '/internal/billing/v1/events';
const RETRY_LIMIT = 8, TRANSPORT_RETRY_LIMIT = 24, HOLD_MS = 300000;
// The receiver writes its `sending` record before SMTP and answers these codes only ahead of it.
const CANCELLED_BEFORE_SMTP = ['EVENT_CONFLICT', 'OBSOLETE', 'COLLECTION_STOPPED'];
const RETRY_BEFORE_SMTP = ['PORTAL_VALIDATION_FAILED', 'BUSY', 'DISABLED'];
function classify(status, raw, event, clock) {
    let receipt = null;
    try { receipt = JSON.parse(raw); } catch { /* A gateway may answer with any body. */ }
    const code = receipt?.code;
    if (status === 200 && receipt?.ok === true && ['SENT', 'ALREADY_SENT'].includes(code) && receipt.eventId === event.eventId)
        return { status: 'sent', reason: code, receipt: { code, eventId: receipt.eventId, at: clock() } };
    if (status === 409 && CANCELLED_BEFORE_SMTP.includes(code)) return { status: 'cancelled', reason: code, noSmtp: true };
    if (status === 409 && code === 'DELIVERY_UNCERTAIN') return { status: 'uncertain', reason: code };
    if (status === 429) return { status: 'retry', reason: 'RATE_LIMIT', noSmtp: true };
    if (status === 503 && RETRY_BEFORE_SMTP.includes(code)) return { status: 'retry', reason: code, noSmtp: true };
    // An error after SMTP may surface as storage failure: retry is safe, but it proves nothing.
    if (status === 503 && code === 'STORAGE_UNAVAILABLE') return { status: 'retry', reason: code };
    if (status === 401) return { status: 'retry', reason: 'AUTH_REJECTED', transport: true, noSmtp: true };
    if ([413, 422].includes(status)) return { status: 'blocked', reason: 'PROTOCOL_REJECTED', noSmtp: true };
    if (status === 404 || status >= 500) return { status: 'retry', reason: 'HTTP_TRANSPORT', transport: true };
    return { status: 'uncertain', reason: 'HTTP_UNCERTAIN' };
}
async function readLimited(response, limit) {
    if (!response.body || Number(response.headers.get('content-length')) > limit) throw new Error('HTTP_BODY_INVALID');
    let size = 0; const chunks = [];
    for await (const chunk of response.body) {
        size += chunk.length;
        if (size > limit) { await response.body.cancel?.().catch(() => {}); throw new Error('HTTP_BODY_INVALID'); }
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}
function createWorker({ config, store, service, fetcher = fetch, clock = Date.now, random = Math.random }) {
    let stopped = false, timer, running, nextScanAt = 0, scanFailures = 0;
    const scanInterval = config.scanIntervalMs ?? 0;
    async function deliver(candidate) {
        let event = candidate.payload;
        if (!config.enabled || stopped) return;
        try { await service.validate(event); }
        catch (error) {
            await store.locked('invoice:' + event.invoiceId, async repo => repo.transaction(async () => {
                const e = await repo.event(event.eventId);
                if (!e || !['pending', 'retry', 'sending'].includes(e.status)) return;
                e.status = e.status === 'sending' || (e.leaseId && !transient(error)) ? 'uncertain' : transient(error) ? 'retry' : 'cancelled'; e.reason = code(error);
                const held = e.reason === HELD;
                e.nextAt = clock() + (held ? HOLD_MS : 60000);
                await repo.saveEvent(e);
                if (held) await repo.auditOnce(event.eventId, e.reason, clock());
                else await repo.audit(event.eventId, e.reason, clock());
            }));
            return;
        }
        const claimed = await store.locked('invoice:' + event.invoiceId, async repo => repo.transaction(async () => {
            const e = await repo.event(event.eventId);
            if (!e || !['pending', 'retry', 'sending'].includes(e.status) || e.nextAt > clock()) return false;
            if (e.status === 'sending') {
                e.status = 'uncertain'; e.reason = 'ORPHANED_DISPATCH';
                await repo.saveEvent(e); await repo.audit(event.eventId, e.reason, clock()); return false;
            }
            if (e.invalidated) return false;
            e.status = 'sending'; e.attempts++; e.nextAt = clock() + 120000;
            e.attemptStartedAt = clock();
            await repo.saveEvent(e); await repo.audit(event.eventId, 'HTTP_ATTEMPT', clock());
            return true;
        }));
        if (!claimed) return;
        let outcome;
        try {
            const body = canonical(event);
            const response = await fetcher(config.origin + ROUTE, { method: 'POST', body,
                headers: headers(config.secret, 'POST', ROUTE, body, clock()), redirect: 'error', signal: AbortSignal.timeout(60000) });
            outcome = classify(response.status, await readLimited(response, 16384), event, clock);
        } catch {
            // Lost connection or ack: the same event is safe to repeat, because the receiver
            // answers from its durable receipts or from its installment lock before any SMTP.
            outcome = { status: 'retry', reason: 'HTTP_TRANSPORT', transport: true };
        }
        if (outcome.reason === 'AUTH_REJECTED') console.warn('[billing] AUTH_REJECTED');
        await store.locked('invoice:' + event.invoiceId, async repo => repo.transaction(async () => {
            const e = await repo.event(event.eventId), state = await repo.state(event.invoiceId);
            if (!e || e.status !== 'sending') return;
            const { noSmtp, transport, ...result } = outcome;
            if (result.status === 'sent' || noSmtp) {
                e.leaseId = null;
                if (state?.leases?.some(l => l.eventId === event.eventId)) {
                    state.leases = state.leases.filter(l => l.eventId !== event.eventId);
                    await repo.saveState(event.invoiceId, state);
                }
            }
            if (result.status === 'retry' && (e.invalidated || e.attempts >= (transport ? TRANSPORT_RETRY_LIMIT : RETRY_LIMIT))) {
                // Without a lease the receiver never held a proof, so no SMTP can have started.
                Object.assign(result, e.leaseId ? { status: 'uncertain', reason: 'SMTP_LEASE_UNCERTAIN' }
                    : { status: 'blocked', reason: e.invalidated ? 'STATE_CHANGED' : 'RETRY_EXHAUSTED' });
            }
            const backoff = (transport ? 60000 : 1000) * 2 ** e.attempts;
            Object.assign(e, result, { finishedAt: clock(), nextAt: clock() + Math.min(3600000, backoff) + Math.floor(random() * 1000) });
            await repo.saveEvent(e); await repo.audit(event.eventId, e.reason, clock());
        }));
    }
    async function tick() {
        if (!config.enabled || !config.worker || stopped || running) return;
        running = (async () => {
            // Scans are spaced out; deliveries and retries still run on every tick.
            if (clock() >= nextScanAt) {
                try {
                    await service.scan({ shouldStop: () => stopped });
                    scanFailures = 0; nextScanAt = clock() + scanInterval;
                } catch (error) {
                    scanFailures++; nextScanAt = clock() + Math.min(scanInterval, 60000 * 2 ** scanFailures);
                    throw error;
                }
            }
            if (stopped) return;
            for (const e of await store.due(clock())) {
                if (stopped) return;
                try { await deliver(e); }
                catch (error) { if (code(error) !== 'BUSY') throw error; }
            }
        })();
        try { await running; } finally { running = null; }
    }
    function start() {
        if (!config.enabled || !config.worker || timer) return;
        stopped = false;
        const loop = async () => {
            try { await tick(); } catch { console.warn('[billing] TICK_FAILED'); }
            if (!stopped) { timer = setTimeout(loop, 60000); timer.unref(); }
        };
        timer = setTimeout(loop, 1000); timer.unref();
    }
    async function stop() { stopped = true; clearTimeout(timer); timer = null; await running?.catch(() => {}); }
    return { deliver, tick, start, stop };
}
module.exports = { createWorker, readLimited, ROUTE };
