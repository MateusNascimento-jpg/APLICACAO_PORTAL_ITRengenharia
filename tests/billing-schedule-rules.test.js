'use strict';
// D5 (Inadimplente), D6 (janela 08:00-18:00 em São Paulo) e D8 (mesmo dia). Sem rede; SMTP simulado.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { fixture, S } = require('./helpers/billing-fixtures');
const { CLIENT_EMAIL } = require('../lib/billing/source');
const { createWorker } = require('../lib/billing/worker');
const { register } = require('../lib/billing/routes');
const { withinWindow, nextOpening } = require('../lib/billing/contract');
const { UPDATE_SETTLE_MS } = require('../lib/billing/service');
const N = S.NOTAS_FISCAIS;
const cfg = { enabled: true, worker: true, origin: 'https://notifications.example.test', secret: Buffer.alloc(32, 3).toString('base64') };
const notifications = process.env.BILLING_NOTIFICATIONS_REPO || path.resolve(__dirname, '../../Emails_diarios_ITRengenharia');
const available = fs.existsSync(path.join(notifications, 'billing/receiver.js'));
const of = (f, type) => f.events().filter(e => e.payload.type === type);
const stored = (f, e) => f.store.data.events.get(e.payload.eventId);
const audits = (f, code) => f.store.data.audit.filter(a => a.code === code);
const ok = async (url, options) => new Response(JSON.stringify({ ok: true, code: 'SENT', eventId: JSON.parse(options.body).eventId }), { status: 200 });
const worker = (f, fetcher = ok) => createWorker({ config: cfg, store: f.store, service: f.service, clock: f.clock, fetcher, random: () => 0 });
const none = async () => { throw new Error('must not send'); };
async function deliverAll(f) { const w = worker(f); for (const e of await f.store.due(f.clock())) await w.deliver(e); }
// A boleto delivered on registration, so later days are plain reminder days.
async function delivered() { const f = fixture(); await f.ready(); await deliverAll(f); return f; }
// São Paulo is UTC-3 on these dates.
const sp = (day, time) => Date.parse(`${day}T${time}:00-03:00`);

// D5
test('D5: a delinquent contract keeps every reminder going', async () => {
    const f = await delivered(); f.contract.fields[S.CONTRATOS.STATUS] = 'Inadimplente';
    for (const day of ['05', '06', '11', '16', '21']) { f.setNow(`2026-11-${day}T12:00:00Z`); await f.service.scan(); await deliverAll(f); }
    assert.equal(of(f, 'BOLETO_D_MINUS_1')[0].status, 'sent'); assert.equal(of(f, 'BOLETO_DUE_TODAY')[0].status, 'sent');
    assert.deepEqual(of(f, 'BOLETO_OVERDUE_REMINDER').map(e => [e.payload.scheduledFor, e.status]), [['2026-11-11', 'sent'], ['2026-11-16', 'sent'], ['2026-11-21', 'sent']]);
});
test('D5: NFSe, availability and confirmation are not blocked by the status alone', async () => {
    const f = fixture(); f.contract.fields[S.CONTRATOS.STATUS] = 'Inadimplente'; await f.service.scan();
    f.attach('boleto'); f.attach('nfse'); await f.service.scan();
    for (const type of ['BOLETO_AVAILABLE', 'NFSE_AVAILABLE']) await f.service.validate(of(f, type)[0].payload);
    f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago'; await f.service.scan(); await f.service.scan();
    const { proof } = await f.service.validate(of(f, 'BOLETO_PAYMENT_RECORDED')[0].payload);
    assert.equal(proof.contractStatus, 'Inadimplente');
});
test('D5: payment, cancellation and inconsistency still stop a delinquent contract', async t => {
    const changes = { pago: f => { f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago'; }, parcelaCancelada: f => { f.invoice.fields[N.STATUS_PAGAMENTO] = 'Cancelado'; },
        dadosDePagamento: f => { f.invoice.fields[N.DATA_PAGAMENTO] = '2026-11-10'; }, valorVazio: f => { delete f.invoice.fields[N.VALOR_PARCELA]; } };
    for (const [name, change] of Object.entries(changes)) await t.test(name, async () => {
        const f = await delivered(); f.contract.fields[S.CONTRATOS.STATUS] = 'Inadimplente'; change(f);
        f.setNow('2026-11-11T12:00:00Z'); await f.service.scan();
        assert.equal(of(f, 'BOLETO_OVERDUE_REMINDER').length, 0);
    });
});
test('D5: other contract statuses are still refused', async t => {
    for (const status of ['Cancelado', 'Suspenso', 'Outro']) await t.test(status, async () => {
        const f = await delivered(); f.contract.fields[S.CONTRATOS.STATUS] = status;
        f.setNow('2026-11-11T12:00:00Z'); await f.service.scan();
        assert.equal(of(f, 'BOLETO_OVERDUE_REMINDER').length, 0);
    });
});

// D6
test('D6: the window is 08:00 inclusive to 18:00 exclusive, in São Paulo, every day', () => {
    for (const [day, time, expected] of [['2026-11-04', '07:59', false], ['2026-11-04', '08:00', true], ['2026-11-04', '12:00', true], ['2026-11-04', '17:59', true], ['2026-11-04', '18:00', false], ['2026-11-04', '23:59', false], ['2026-11-04', '00:00', false],
        ['2026-11-07', '09:00', true], ['2026-11-08', '09:00', true], ['2026-11-08', '19:00', false]])
        assert.equal(withinWindow(sp(day, time)), expected, `${day} ${time}`);
    assert.equal(withinWindow(sp('2026-11-04', '17:59') + 59999), true); assert.equal(withinWindow(sp('2026-11-04', '18:00')), false);
});
test('D6: the next opening is always 08:00 in São Paulo', () => {
    assert.equal(nextOpening(sp('2026-11-04', '00:05')), sp('2026-11-04', '08:00'));
    assert.equal(nextOpening(sp('2026-11-04', '07:59') + 30000), sp('2026-11-04', '08:00'));
    assert.equal(nextOpening(sp('2026-11-04', '18:00')), sp('2026-11-05', '08:00'));
    assert.equal(nextOpening(sp('2026-12-31', '23:30')), sp('2027-01-01', '08:00'));
});
test('D6: a message arising at midnight waits for 08:00 with the same identity and goes out once', async () => {
    const f = await delivered(); f.setNow(sp('2026-11-06', '00:01')); await f.service.scan();
    const e = of(f, 'BOLETO_DUE_TODAY')[0]; assert.equal(e.status, 'pending');
    let calls = 0; const w = worker(f, async (u, o) => { calls++; return ok(u, o); });
    await w.deliver(e);
    assert.equal(calls, 0); assert.equal(stored(f, e).status, 'pending'); assert.equal(stored(f, e).nextAt, sp('2026-11-06', '08:00')); assert.equal(stored(f, e).attempts, 0);
    assert.deepEqual(await f.store.due(sp('2026-11-06', '07:59')), []);
    f.setNow(sp('2026-11-06', '08:00')); assert.equal((await f.store.due(f.clock())).length, 1);
    await w.deliver(stored(f, e)); await w.deliver(stored(f, e));
    assert.equal(calls, 1); assert.equal(stored(f, e).status, 'sent');
});
test('D6: being outside the window is audited once, with no source reads', async () => {
    const f = await delivered(); f.setNow(sp('2026-11-06', '00:01')); await f.service.scan();
    const e = of(f, 'BOLETO_DUE_TODAY')[0]; let reads = 0; const read = f.airtable.obterRegistro;
    f.airtable.obterRegistro = async (...a) => { reads++; return read(...a); };
    const w = worker(f); for (let i = 0; i < 4; i++) await w.deliver(stored(f, e));
    assert.equal(audits(f, 'OUTSIDE_SEND_WINDOW').length, 1); assert.deepEqual(Object.keys(audits(f, 'OUTSIDE_SEND_WINDOW')[0]).sort(), ['code', 'now', 'subject']);
    assert.equal(reads, 0);
});
test('D6: scans keep observing outside the window: payment at night stops the morning message', async () => {
    const f = await delivered(); f.setNow(sp('2026-11-06', '00:01')); await f.service.scan();
    const e = of(f, 'BOLETO_DUE_TODAY')[0]; await worker(f).deliver(e);
    f.setNow(sp('2026-11-06', '02:00')); f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago'; await f.service.scan();
    assert.equal(stored(f, e).status, 'cancelled');
});
test('D6: a dated message not sent by 18:00 is cancelled next morning, not sent late', async () => {
    const f = await delivered(); f.setNow(sp('2026-11-06', '19:00')); await f.service.scan();
    const e = of(f, 'BOLETO_DUE_TODAY')[0]; let calls = 0; const w = worker(f, async (u, o) => { calls++; return ok(u, o); });
    await w.deliver(e); f.setNow(sp('2026-11-07', '08:00')); await w.deliver(stored(f, e));
    assert.equal(calls, 0); assert.equal(stored(f, e).status, 'cancelled'); assert.equal(stored(f, e).reason, 'OBSOLETE');
});
test('D6: an undated message waits for the next window', async () => {
    const f = fixture(); await f.service.scan(); f.setNow(sp('2026-11-04', '22:00')); f.attach('boleto'); await f.service.scan();
    const e = of(f, 'BOLETO_AVAILABLE')[0]; await deliverAll(f);
    assert.equal(stored(f, e).status, 'pending'); assert.equal(stored(f, e).nextAt, sp('2026-11-05', '08:00'));
    f.setNow(sp('2026-11-05', '08:00')); await deliverAll(f);
    assert.equal(stored(f, e).status, 'sent');
});
test('D6: a retry falling outside the window also waits, and a held message too', async () => {
    const f = await delivered(); f.setNow(sp('2026-11-06', '17:58')); await f.service.scan();
    const e = of(f, 'BOLETO_DUE_TODAY')[0]; const down = worker(f, async () => { throw new Error('offline'); });
    await down.deliver(e); assert.equal(stored(f, e).status, 'retry');
    f.setNow(sp('2026-11-06', '18:30')); await worker(f).deliver(stored(f, e));
    assert.equal(stored(f, e).nextAt, sp('2026-11-07', '08:00')); assert.equal(stored(f, e).status, 'retry');
});
test('D6: an event already in dispatch is resolved only inside the window, never resent', async () => {
    const f = await delivered(); f.setNow(sp('2026-11-06', '17:59')); await f.service.scan();
    const e = stored(f, of(f, 'BOLETO_DUE_TODAY')[0]); e.status = 'sending'; e.attempts = 1; await f.store.repo.saveEvent(e);
    f.setNow(sp('2026-11-06', '23:00')); await worker(f, none).deliver(stored(f, e));
    assert.equal(stored(f, e).status, 'sending');
    f.setNow(sp('2026-11-07', '08:00')); await worker(f, none).deliver(stored(f, e));
    assert.equal(stored(f, e).status, 'uncertain');
});
test('D6: a receiver refusing outside the window leaves the event retryable, with no lease and no doubt', async () => {
    const f = await delivered(); f.setNow(sp('2026-11-06', '17:59')); await f.service.scan(); const e = of(f, 'BOLETO_DUE_TODAY')[0];
    await worker(f, async (url, options) => { await f.service.validate(JSON.parse(options.body), 'smtp'); f.setNow(sp('2026-11-06', '18:00')); return new Response(JSON.stringify({ ok: false, code: 'OUTSIDE_SEND_WINDOW', eventId: e.payload.eventId }), { status: 503 }); }).deliver(e);
    assert.equal(stored(f, e).status, 'retry'); assert.equal(stored(f, e).reason, 'OUTSIDE_SEND_WINDOW'); assert.equal(stored(f, e).leaseId, null);
    assert.deepEqual(f.store.data.states.get(f.ids.invoice).leases, []);
});
test('D6: disabled flags still do nothing', async () => {
    const f = await delivered(); f.setNow(sp('2026-11-06', '00:01')); await f.service.scan();
    const e = of(f, 'BOLETO_DUE_TODAY')[0], before = stored(f, e);
    await createWorker({ config: { ...cfg, enabled: false }, store: f.store, service: f.service, clock: f.clock, fetcher: none }).deliver(e);
    assert.deepEqual(stored(f, e), before);
});

// D8
test('D8: availability and reminder on the same day: reminder waits while availability is pending', async () => {
    const f = fixture(); await f.service.scan(); f.setNow('2026-11-06T12:00:00Z'); f.attach('boleto'); await f.service.scan(); await f.service.scan();
    assert.equal(of(f, 'BOLETO_AVAILABLE')[0].status, 'pending'); assert.equal(of(f, 'BOLETO_DUE_TODAY').length, 0);
    assert.equal(audits(f, 'REMINDER_CONSOLIDATED').length, 0, 'a pending event proves nothing');
});
test('D8: once delivered, the reminder of that day is consolidated and audited', async t => {
    for (const [name, day, type] of [['D-1', '05', 'BOLETO_D_MINUS_1'], ['D0', '06', 'BOLETO_DUE_TODAY'], ['D+5', '11', 'BOLETO_OVERDUE_REMINDER']]) await t.test(name, async () => {
        const f = fixture(); await f.service.scan(); f.setNow(`2026-11-${day}T12:00:00Z`); f.attach('boleto'); await f.service.scan();
        await deliverAll(f); await f.service.scan(); await f.service.scan();
        assert.equal(of(f, type).length, 0); assert.equal(of(f, 'BOLETO_AVAILABLE')[0].status, 'sent'); assert.equal(audits(f, 'REMINDER_CONSOLIDATED').length, 1);
    });
});
test('D8: without proof of delivery the reminder is not lost', async t => {
    const states = {
        cancelada: e => { e.status = 'cancelled'; },
        incerta: e => { e.status = 'uncertain'; e.attempts = 1; },
        bloqueada: e => { e.status = 'blocked'; e.attempts = 1; },
        enviadaSemRecibo: e => { e.status = 'sent'; e.attempts = 1; delete e.receipt; }
    };
    for (const [name, change] of Object.entries(states)) await t.test(name, async () => {
        const f = fixture(); await f.service.scan(); f.setNow('2026-11-06T12:00:00Z'); f.attach('boleto'); await f.service.scan();
        const e = stored(f, of(f, 'BOLETO_AVAILABLE')[0]); change(e); await f.store.repo.saveEvent(e);
        await f.service.scan();
        assert.equal(of(f, 'BOLETO_DUE_TODAY').length, 1); assert.equal(audits(f, 'REMINDER_CONSOLIDATED').length, 0);
    });
});
test('D8: availability delivered on another day does not suppress the reminder', async () => {
    const f = await delivered(); f.setNow('2026-11-06T12:00:00Z'); await f.service.scan();
    assert.equal(of(f, 'BOLETO_DUE_TODAY').length, 1); assert.equal(audits(f, 'REMINDER_CONSOLIDATED').length, 0);
});
test('D8: each recipient is judged alone', async () => {
    const f = fixture(); f.client.fields[CLIENT_EMAIL] = 'a@example.test;b@example.test'; await f.service.scan();
    f.setNow('2026-11-06T12:00:00Z'); f.attach('boleto'); await f.service.scan();
    const [a, b] = of(f, 'BOLETO_AVAILABLE').sort((x, y) => x.payload.recipient.localeCompare(y.payload.recipient));
    await worker(f).deliver(a); const e = stored(f, b); e.status = 'cancelled'; await f.store.repo.saveEvent(e);
    await f.service.scan();
    assert.deepEqual(of(f, 'BOLETO_DUE_TODAY').map(x => x.payload.recipient), ['b@example.test']);
});
test('D8: availability after the window goes out next morning, alone, with the correct date', async () => {
    const f = fixture(); await f.service.scan(); f.setNow(sp('2026-11-06', '19:00')); f.attach('boleto'); await f.service.scan();
    f.setNow(sp('2026-11-07', '08:00')); await deliverAll(f); await f.service.scan();
    assert.equal(of(f, 'BOLETO_AVAILABLE')[0].status, 'sent'); assert.equal(of(f, 'BOLETO_DUE_TODAY').length, 0);
});
test('D8: the next reminder occurrence comes normally', async () => {
    const f = fixture(); await f.service.scan(); f.setNow('2026-11-11T12:00:00Z'); f.attach('boleto'); await f.service.scan(); await deliverAll(f); await f.service.scan();
    f.setNow('2026-11-16T12:00:00Z'); await f.service.scan();
    assert.deepEqual(of(f, 'BOLETO_OVERDUE_REMINDER').map(e => e.payload.scheduledFor), ['2026-11-16']);
});
test('D8: the update delivered today replaces the reminder, a pending one only delays it', async () => {
    const f = await delivered(); f.setNow('2026-11-06T12:00:00Z'); f.invoice.fields[N.VALOR_PARCELA] = 1600; await f.service.scan(); f.setNow(f.clock() + UPDATE_SETTLE_MS); await f.service.scan();
    assert.equal(of(f, 'BOLETO_UPDATED')[0].status, 'pending'); await f.service.scan();
    assert.equal(of(f, 'BOLETO_DUE_TODAY').length, 0);
    await deliverAll(f); await f.service.scan();
    assert.equal(of(f, 'BOLETO_UPDATED')[0].status, 'sent'); assert.equal(of(f, 'BOLETO_DUE_TODAY').length, 0);
    assert.equal(audits(f, 'REMINDER_CONSOLIDATED').length, 1);
});
test('D8: an update whose delivery failed does not take the reminder away', async () => {
    const f = await delivered(); f.setNow('2026-11-06T12:00:00Z'); f.invoice.fields[N.VALOR_PARCELA] = 1600; await f.service.scan(); f.setNow(f.clock() + UPDATE_SETTLE_MS); await f.service.scan();
    const e = stored(f, of(f, 'BOLETO_UPDATED')[0]); e.status = 'uncertain'; e.attempts = 1; await f.store.repo.saveEvent(e);
    await f.service.scan();
    assert.equal(of(f, 'BOLETO_DUE_TODAY').length, 1);
});
test('D8: update, NFSe and confirmation are never suppressed by another message of the day', async () => {
    const f = fixture(); await f.service.scan(); f.setNow('2026-11-06T12:00:00Z'); f.attach('boleto'); f.attach('nfse'); await f.service.scan(); await deliverAll(f);
    assert.equal(of(f, 'NFSE_AVAILABLE')[0].status, 'sent');
    f.invoice.fields[N.VALOR_PARCELA] = 1600; await f.service.scan(); f.setNow(f.clock() + UPDATE_SETTLE_MS); await f.service.scan();
    assert.equal(of(f, 'BOLETO_UPDATED').length, 1);
    await deliverAll(f); f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago'; await f.service.scan(); await f.service.scan();
    assert.equal(of(f, 'BOLETO_PAYMENT_RECORDED').length, 1); await f.service.validate(of(f, 'BOLETO_PAYMENT_RECORDED')[0].payload);
});
test('D8: consolidation creates no historical message', async () => {
    const f = fixture(); f.attach('boleto'); await f.service.scan();
    f.setNow('2026-11-11T12:00:00Z'); await f.service.scan();
    assert.equal(f.events().length, 0); assert.equal(audits(f, 'REMINDER_CONSOLIDATED').length, 0);
});

test('real receiver: consolidated availability states the due date and charges; outside the window nothing is sent', { skip: !available }, async t => {
    const { createReceiver, ROUTE } = require(path.join(notifications, 'billing/receiver.js'));
    const { render } = require(path.join(notifications, 'billing/template.js'));
    const f = fixture(); f.contract.fields[S.CONTRATOS.STATUS] = 'Inadimplente'; await f.service.scan();
    f.setNow(sp('2026-11-11', '19:00')); f.attach('boleto'); await f.service.scan();
    const app = express(); register(app, express, { config: cfg, store: f.store, service: f.service, clock: f.clock });
    const srv = app.listen(0, '127.0.0.1'); await new Promise(resolve => srv.once('listening', resolve));
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'itr-billing-test-'));
    t.after(async () => { await new Promise(resolve => { srv.closeAllConnections(); srv.close(resolve); }); fs.rmSync(directory, { recursive: true, force: true }); });
    const sent = [];
    const receiver = createReceiver({ config: { enabled: true, secret: cfg.secret, origin: 'https://portal.example.test', directory }, clock: f.clock,
        fetcher: (url, options) => fetch(`http://127.0.0.1:${srv.address().port}${new URL(url).pathname}`, options),
        send: async args => { sent.push(args); return { ok: true }; } });
    const relay = async (url, options) => {
        const r = await receiver.handle({ method: 'POST', path: ROUTE, headers: options.headers }, Buffer.from(options.body));
        return new Response(JSON.stringify(r.body), { status: r.status });
    };
    const e = of(f, 'BOLETO_AVAILABLE')[0];
    // Worker clock inside the window, receiver clock outside: the receiver holds the line on its own.
    const raw = Buffer.from(JSON.stringify(e.payload)), { headers } = require('../lib/billing/protocol');
    const refused = await receiver.handle({ method: 'POST', path: ROUTE, headers: headers(cfg.secret, 'POST', ROUTE, raw, f.clock()) }, raw);
    assert.equal(refused.status, 503); assert.equal(refused.body.code, 'OUTSIDE_SEND_WINDOW'); assert.equal(sent.length, 0);
    f.setNow(sp('2026-11-12', '08:00')); await worker(f, relay).deliver(stored(f, e));
    assert.equal(sent.length, 1); assert.equal(stored(f, e).status, 'sent');
    const { texto } = render(sent[0].event, sent[0].now, null);
    assert.match(texto, /O vencimento desta parcela ocorreu em 06\/11\/2026\. Aplicam-se os acréscimos previstos em contrato\./);
    assert.doesNotMatch(texto, /%|juros de|multa de/i);
});
