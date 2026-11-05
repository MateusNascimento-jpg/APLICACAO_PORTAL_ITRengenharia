'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, S } = require('./helpers/billing-fixtures');
const { createService } = require('../lib/billing/service');
const { createWorker } = require('../lib/billing/worker');
const { calendar, eventId, today } = require('../lib/billing/contract');
const { civil, cents } = require('../lib/billing/source');
const { configuration } = require('../lib/billing/config');
const { canonical, hash } = require('../lib/billing/protocol');
const cfg = { enabled: true, worker: true, origin: 'https://notifications.example.test', secret: Buffer.alloc(32, 3).toString('base64') };
const worker = (f, fetcher) => createWorker({ config: cfg, store: f.store, service: f.service, clock: f.clock, fetcher, random: () => 0 });
const ack = e => new Response(JSON.stringify({ ok: true, code: 'SENT', eventId: e.payload.eventId }));

test('flags are off by default; invalid keys/origin and legacy NF ownership fail closed', () => {
    assert.deepEqual(configuration({}), { enabled: false, worker: false });
    assert.throws(() => configuration({ PORTAL_BILLING_ENABLED: 'yes' }));
    const env = { PORTAL_BILLING_ENABLED: 'true', BILLING_HMAC_SECRET: cfg.secret, PORTAL_BILLING_STORAGE_KEY: Buffer.alloc(32, 9).toString('base64'), PORTAL_BILLING_NOTIFICATIONS_ORIGIN: cfg.origin };
    assert.equal(configuration(env).worker, false);
    for (const patch of [{ PORTAL_NF_NOTIFICACOES_ATIVAS: 'true' }, { PORTAL_BILLING_NOTIFICATIONS_ORIGIN: 'http://127.0.0.1' }, { BILLING_HMAC_SECRET: 'short' }]) assert.throws(() => configuration({ ...env, ...patch }));
});
test('baseline persists existing PDFs and Pago, with no historical availability, reminders or confirmation after restart', async () => {
    const f = fixture(); f.attach('boleto'); f.attach('nfse'); f.invoice.fields[S.NOTAS_FISCAIS.STATUS_PAGAMENTO] = 'Pago';
    await f.service.scan();
    const restarted = createService({ store: f.store, source: f.source, clock: f.clock, pilotClients: [f.ids.client] });
    await restarted.scan(); f.setNow('2026-11-11T12:00:00Z'); await restarted.scan();
    assert.equal(f.events().length, 0); assert.ok(f.store.data.meta); assert.equal(f.store.data.states.get(f.ids.invoice).stopped, true);
    f.invoice.fields[S.NOTAS_FISCAIS.STATUS_PAGAMENTO] = 'A Vencer'; await restarted.scan();
    f.invoice.fields[S.NOTAS_FISCAIS.STATUS_PAGAMENTO] = 'Pago'; await restarted.scan(); await restarted.scan();
    assert.equal(f.events().length, 0);
});
test('failed Airtable and failed MySQL baseline leave no partial cutoff or outbox', async () => {
    const f = fixture(); f.fail(true); await assert.rejects(f.service.scan()); assert.equal(f.store.data.meta, null);
    f.fail(false); f.store.failCommit(true); await assert.rejects(f.service.scan());
    assert.equal(f.store.data.meta, null); assert.equal(f.store.data.states.size, 0); assert.equal(f.events().length, 0);
    f.store.failCommit(false); await f.service.scan(); assert.ok(f.store.data.meta);
});
test('boleto without NFSe and without due date; only installment value, idempotency across URL changes', async () => {
    const f = fixture(); f.invoice.fields[S.NOTAS_FISCAIS.VENCIMENTO] = '';
    const e = await f.ready(); assert.equal(e.payload.amountCents, 150050); assert.equal(e.payload.dueDate, null);
    assert.equal(e.payload.type, 'BOLETO_AVAILABLE'); assert.equal(e.payload.document.kind, 'boleto');
    for (let i = 0; i < 10; i++) await f.service.scan();
    f.invoice.fields[S.NOTAS_FISCAIS.BOLETO][0].url += '?new-token'; await f.service.scan();
    assert.equal(f.events().length, 1);
    assert.doesNotMatch(canonical(e.payload), /cnpj|senha|password|https|999999/);
});
test('NFSe independent of boleto and payment, with its own PDF', async () => {
    const f = fixture(); f.invoice.fields[S.NOTAS_FISCAIS.STATUS_PAGAMENTO] = 'Pago';
    const e = await f.ready('nfse'); assert.equal(e.payload.type, 'NFSE_AVAILABLE');
    const result = await f.service.validate(e.payload); assert.equal(result.proof.paymentStatus, 'Pago');
    assert.deepEqual(result.bytes.nfse, f.pdfs.nfse); assert.equal(e.payload.document.kind, 'nfse');
});
test('D−1, D0, D+5/D+10/D+15/D+20; no D+1, D+6 or catch-up, Sao Paulo midnight', async () => {
    const f = fixture(); await f.ready(); await f.sent();
    for (const day of [5, 6, 7, 11, 12, 16, 21, 26]) {
        f.setNow(`2026-11-${String(day).padStart(2, '0')}T12:00:00Z`); await f.service.scan();
    }
    assert.deepEqual(f.events().map(e => e.payload.type), ['BOLETO_AVAILABLE', 'BOLETO_D_MINUS_1', 'BOLETO_DUE_TODAY', ...Array(4).fill('BOLETO_OVERDUE_REMINDER')]);
    assert.deepEqual(f.events().filter(e => e.payload.scheduledFor).map(e => e.payload.scheduledFor), ['2026-11-11', '2026-11-16', '2026-11-21', '2026-11-26']);
    const p = f.events()[3].payload;
    assert.equal(calendar(p, Date.parse('2026-11-12T02:59:59Z')), true);
    assert.equal(calendar(p, Date.parse('2026-11-12T03:00:00Z')), false);
    assert.equal(today(Date.parse('2027-01-01T02:00:00Z')), '2026-12-31');
    const missed = fixture(); await missed.ready(); await missed.sent(); missed.setNow('2026-11-16T12:00:00Z'); await missed.service.scan();
    assert.deepEqual(missed.events().map(e => e.payload.type), ['BOLETO_AVAILABLE', 'BOLETO_OVERDUE_REMINDER']);
});
test('valid civil dates/leap year; invalid dates, timestamp offsets and contract values never guessed', () => {
    assert.equal(civil('2028-02-29'), '2028-02-29'); assert.equal(civil('2026-11-06T00:00:00.000Z'), '2026-11-06');
    for (const d of ['2026-02-29', '2026-11-31', '06/11/2026', '2026-11-06T03:00:00Z', [], 0]) assert.throws(() => civil(d));
    assert.equal(cents(null), null); assert.equal(cents(0), 0);
    for (const n of ['100', -1, NaN, 1.001]) assert.throws(() => cents(n));
});
test('payment before queue and after scheduling cancels pending collection; two observations confirm once and stop forever', async () => {
    const f = fixture(); const e = await f.ready();
    f.setNow('2026-11-05T12:00:00Z'); await f.service.scan();
    f.invoice.fields[S.NOTAS_FISCAIS.STATUS_PAGAMENTO] = 'Pago';
    await assert.rejects(f.service.validate(e.payload), /EVENT_OBSOLETE/);
    assert.ok(f.events().every(e => e.status === 'cancelled'));
    await f.service.scan();
    let payments = f.events().filter(e => e.payload.type === 'BOLETO_PAYMENT_RECORDED');
    assert.equal(payments.length, 1); assert.equal(payments[0].payload.document, null);
    await f.service.validate(payments[0].payload);
    f.invoice.fields[S.NOTAS_FISCAIS.STATUS_PAGAMENTO] = 'A Vencer'; await f.service.scan();
    f.invoice.fields[S.NOTAS_FISCAIS.STATUS_PAGAMENTO] = 'Pago'; await f.service.scan(); await f.service.scan();
    assert.equal(f.events().filter(e => e.payload.type === 'BOLETO_PAYMENT_RECORDED').length, 1);
    const paid = fixture(); await paid.service.scan(); paid.invoice.fields[S.NOTAS_FISCAIS.STATUS_PAGAMENTO] = 'Pago'; paid.attach('boleto');
    await paid.service.scan(); assert.equal(paid.events().length, 0);
});
test('unconfirmed payment oscillation never generates payment event and still stops collections', async () => {
    const f = fixture(); await f.ready(); f.invoice.fields[S.NOTAS_FISCAIS.STATUS_PAGAMENTO] = 'Pago'; await f.service.scan();
    f.invoice.fields[S.NOTAS_FISCAIS.STATUS_PAGAMENTO] = 'A Vencer'; await f.service.scan();
    assert.ok(f.events().every(e => e.status === 'cancelled'));
    assert.equal(f.store.data.states.get(f.ids.invoice).stopped, true);
});
test('recipient revocation, CNPJ mismatch, cross-client and broken reciprocal chains deny current intent', async t => {
    const changes = {
        removed: f => { f.client.fields[require('../lib/billing/source').CLIENT_EMAIL] = 'second@example.test;third@example.test'; },
        wrongRecipient: f => { f.client.fields[require('../lib/billing/source').CLIENT_EMAIL] = 'other@example.test'; },
        wrongCnpj: f => { f.client.fields[S.CLIENTES.CNPJ] = '98765432000198'; },
        duplicateCnpj: f => { f.tables[S.TABELAS.CLIENTES].push({ ...f.client, id: 'recZZZZZZZZZZZZZZ' }); },
        wrongProposal: f => { f.contract.fields[S.CONTRATOS.PROPOSTA] = ['recZZZZZZZZZZZZZZ']; },
        multipleClients: f => { f.proposal.fields[S.PROPOSTA.CLIENTE].push('recZZZZZZZZZZZZZZ'); },
        missingBacklink: f => { f.client.fields[require('../lib/billing/source').CLIENT_PROPOSALS] = []; },
        unaccepted: f => { f.proposal.fields[S.PROPOSTA.STATUS] = 'Enviada'; },
        cancelled: f => { f.invoice.fields[S.NOTAS_FISCAIS.STATUS_PAGAMENTO] = 'Cancelado'; },
        unknown: f => { f.invoice.fields[S.NOTAS_FISCAIS.STATUS_PAGAMENTO] = 'Desconhecido'; },
        contractCancelled: f => { f.contract.fields[S.CONTRATOS.STATUS] = 'Cancelado'; }
    };
    for (const [name, change] of Object.entries(changes)) await t.test(name, async () => {
        const f = fixture(); const e = await f.ready(); change(f); await assert.rejects(f.service.validate(e.payload));
    });
});
test('individual recipients: one immutable event per registered address', async () => {
    const f = fixture(); const field = require('../lib/billing/source').CLIENT_EMAIL;
    f.client.fields[field] += ';second@example.test;invalido';
    await f.ready(); assert.deepEqual(f.events().map(e => e.payload.recipient).sort(), ['financeiro@example.test', 'second@example.test']);
    assert.equal(new Set(f.events().map(e => e.payload.eventId)).size, 2);
});
test('tampered, substituted or revised boleto cannot be authorized', async t => {
    const changes = {
        tampered: f => { f.pdfs.boleto = Buffer.from('%PDF-1.4\nOutro conteudo\n%%EOF'); },
        replaced: f => { f.pdfs.boleto = Buffer.from('%PDF-1.4\nNovo boleto\n%%EOF'); f.attach('boleto'); },
        removed: f => { f.invoice.fields[S.NOTAS_FISCAIS.BOLETO] = []; },
        multiple: f => { f.invoice.fields[S.NOTAS_FISCAIS.BOLETO].push({ ...f.invoice.fields[S.NOTAS_FISCAIS.BOLETO][0], id: f.ids.nfse }); },
        revisedDue: f => { f.invoice.fields[S.NOTAS_FISCAIS.VENCIMENTO] = '2026-11-07'; },
        revisedAmount: f => { f.invoice.fields[S.NOTAS_FISCAIS.VALOR_PARCELA] = 1200; }
    };
    for (const [name, change] of Object.entries(changes)) await t.test(name, async () => {
        const f = fixture(); const e = await f.ready(); change(f); await assert.rejects(f.service.validate(e.payload));
        await f.service.scan(); await assert.rejects(f.service.validate(e.payload));
    });
});
test('past due keeps the charge going with the original boleto', async () => {
    const f = fixture(); await f.ready(); await f.sent(); f.setNow('2026-11-11T12:00:00Z');
    await f.service.scan(); assert.deepEqual(f.events().map(e => e.payload.type), ['BOLETO_AVAILABLE', 'BOLETO_OVERDUE_REMINDER']);
});
test('changing attachment ID with same content never generates another availability and keeps the message', async () => {
    const f = fixture(); await f.ready(); f.invoice.fields[S.NOTAS_FISCAIS.BOLETO][0].id = 'attGGGGGGGGGGGGGG'; await f.service.scan();
    assert.equal(f.events().length, 1); assert.equal(f.events()[0].status, 'pending');
});
test('two scanners, two workers and restart produce one HTTP dispatch', async () => {
    const f = fixture(); await f.service.scan(); f.attach('boleto');
    const scans = await Promise.allSettled([f.service.scan(), f.service.scan()]);
    assert.equal(scans.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.events().length, 1);
    let calls = 0; const e = f.events()[0];
    const fetcher = async () => { calls++; return ack(e); };
    await Promise.allSettled([worker(f, fetcher).deliver(e), worker(f, fetcher).deliver(e)]);
    assert.equal(calls, 1); assert.equal(f.events()[0].status, 'sent');
    await worker(f, fetcher).deliver(e); assert.equal(calls, 1);
});
test('SMTP uncertain, orphan sending and bad receipt never automatically resend', async t => {
    for (const mode of ['smtp', 'malformed', 'orphan']) await t.test(mode, async () => {
        const f = fixture(); const e = await f.ready(); let calls = 0;
        if (mode === 'orphan') { e.status = 'sending'; e.nextAt = f.clock(); await f.store.repo.saveEvent(e); }
        const w = worker(f, async () => {
            calls++;
            if (mode === 'smtp') return new Response(JSON.stringify({ code: 'DELIVERY_UNCERTAIN' }), { status: 409 });
            return new Response('{}');
        });
        await w.deliver(e); assert.equal(f.events()[0].status, 'uncertain');
        f.setNow(f.clock() + 3600000); await w.deliver(e); assert.equal(calls, mode === 'orphan' ? 0 : 1);
    });
});
test('known pre-SMTP 503/429 retries same bytes and identity with new nonce; source outage does not send', async () => {
    const f = fixture(); const e = await f.ready(); const requests = [];
    const w = worker(f, async (url, options) => { requests.push(options); return requests.length === 1 ? new Response(JSON.stringify({ code: 'BUSY' }), { status: 503 }) : ack(e); });
    await w.deliver(e); assert.equal(f.events()[0].status, 'retry');
    f.setNow(f.clock() + 10000); await w.deliver(e); assert.equal(f.events()[0].status, 'sent');
    assert.equal(requests[0].body, requests[1].body); assert.notEqual(requests[0].headers['x-itr-nonce'], requests[1].headers['x-itr-nonce']);
    const outage = fixture(); const pending = await outage.ready(); outage.fail(true);
    await worker(outage, () => { throw new Error('must not send'); }).deliver(pending);
    assert.equal(outage.events()[0].status, 'retry');
});
test('event identity includes scheduled date for recurring reminder and rejects changed immutable payload', async () => {
    const f = fixture(); const e = await f.ready();
    await assert.rejects(f.store.repo.saveEvent({ ...e, payload: { ...e.payload, amountCents: 100 } }), /EVENT_CONFLICT/);
    const p = { ...e.payload, type: 'BOLETO_OVERDUE_REMINDER', scheduledFor: '2026-11-11' };
    const first = eventId(p); p.scheduledFor = '2026-11-16'; assert.notEqual(first, eventId(p));
    assert.equal(hash(canonical(e.payload)).length, 64);
});
