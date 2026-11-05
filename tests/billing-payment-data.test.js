'use strict';
// Data ou valor de pagamento preenchidos sem status Pago: não cobra, audita e reavalia. Sem rede.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { fixture, S } = require('./helpers/billing-fixtures');
const { CATALOG_FIELDS, CLIENT_EMAIL } = require('../lib/billing/source');
const { createWorker } = require('../lib/billing/worker');
const { register } = require('../lib/billing/routes');
const N = S.NOTAS_FISCAIS;
const CODE = 'PAYMENT_DATA_INCONSISTENT';
const cfg = { enabled: true, worker: true, origin: 'https://notifications.example.test', secret: Buffer.alloc(32, 3).toString('base64') };
const sentOk = id => new Response(JSON.stringify({ ok: true, code: 'SENT', eventId: id }), { status: 200 });
const worker = (f, fetcher = async () => { throw new Error('must not send'); }) => createWorker({ config: cfg, store: f.store, service: f.service, clock: f.clock, fetcher, random: () => 0 });
const of = (f, type) => f.events().filter(e => e.payload.type === type);
const reminders = f => of(f, 'BOLETO_OVERDUE_REMINDER');
const audits = (f, code = CODE) => f.store.data.audit.filter(a => a.code === code);
const stored = (f, e) => f.store.data.events.get(e.payload.eventId);
const notifications = process.env.BILLING_NOTIFICATIONS_REPO || path.resolve(__dirname, '../../Emails_diarios_ITRengenharia');
const available = fs.existsSync(path.join(notifications, 'billing/receiver.js'));
const paidDate = f => { f.invoice.fields[N.DATA_PAGAMENTO] = '2026-11-10'; };
const paidValue = f => { f.invoice.fields[N.VALOR_PAGO] = 1500.5; };
const correct = f => { delete f.invoice.fields[N.DATA_PAGAMENTO]; delete f.invoice.fields[N.VALOR_PAGO]; };

test('date, amount or a linked amount without status Pago generate no reminder and are audited', async t => {
    const changes = { data: paidDate, valor: paidValue, valorVinculado: f => { f.invoice.fields[N.VALOR_PAGO] = [1500.5]; }, valorParcial: f => { f.invoice.fields[N.VALOR_PAGO] = 0.01; } };
    for (const [name, change] of Object.entries(changes)) await t.test(name, async () => {
        const f = fixture(); await f.ready(); await f.sent(); change(f); f.setNow('2026-11-11T12:00:00Z'); await f.service.scan();
        assert.equal(reminders(f).length, 0); assert.equal(audits(f).length, 1);
    });
});
test('an empty payment field is not a payment', async t => {
    const empties = { nulo: null, texto: '', espacos: '  ', zero: 0, lista: [], listaZero: [0] };
    for (const [name, value] of Object.entries(empties)) await t.test(name, async () => {
        const f = fixture(); await f.ready(); await f.sent(); f.invoice.fields[N.VALOR_PAGO] = value; f.invoice.fields[N.DATA_PAGAMENTO] = name === 'zero' ? null : value;
        f.setNow('2026-11-11T12:00:00Z'); await f.service.scan();
        assert.equal(reminders(f).length, 1); assert.equal(audits(f).length, 0);
    });
});
test('the audit holds only the code, with no payment data, and repeats at most daily', async () => {
    const f = fixture(); await f.ready(); await f.sent(); paidDate(f); paidValue(f); f.setNow('2026-11-11T12:00:00Z');
    for (let i = 0; i < 5; i++) await f.service.scan();
    assert.equal(audits(f).length, 1);
    assert.deepEqual(Object.keys(audits(f)[0]).sort(), ['code', 'now', 'subject']); assert.equal(audits(f)[0].subject, f.ids.invoice);
    f.setNow('2026-11-12T13:00:00Z'); await f.service.scan();
    assert.equal(audits(f).length, 2);
});
test('corrected on the same day, the occurrence arises with no durable stop', async () => {
    const f = fixture(); await f.ready(); await f.sent(); paidDate(f); f.setNow('2026-11-11T12:00:00Z'); await f.service.scan();
    const state = f.store.data.states.get(f.ids.invoice);
    assert.equal(state.stopped, false); assert.deepEqual(state.blockedKinds, []);
    correct(f); await f.service.scan();
    assert.deepEqual(reminders(f).map(e => e.payload.scheduledFor), ['2026-11-11']);
    await f.service.validate(reminders(f)[0].payload);
});
test('while held, no occurrence arises: a contact added meanwhile receives it after the correction', async () => {
    const f = fixture(); await f.ready(); await f.sent(); paidDate(f); f.setNow('2026-11-11T12:00:00Z'); await f.service.scan();
    f.client.fields[CLIENT_EMAIL] += ';novo@example.test'; await f.service.scan();
    correct(f); await f.service.scan();
    assert.equal(reminders(f).length, 2);
});
test('corrected later, reminders resume on the next occurrence and missed days are not recovered', async () => {
    const f = fixture(); await f.ready(); await f.sent(); paidDate(f); f.setNow('2026-11-11T12:00:00Z'); await f.service.scan();
    correct(f); f.setNow('2026-11-12T12:00:00Z'); await f.service.scan();
    assert.equal(reminders(f).length, 0);
    f.setNow('2026-11-16T12:00:00Z'); await f.service.scan();
    assert.deepEqual(reminders(f).map(e => e.payload.scheduledFor), ['2026-11-16']);
});
test('an event already queued is held without HTTP, not cancelled, and goes out once corrected', async () => {
    const f = fixture(); await f.ready(); await f.sent(); f.setNow('2026-11-11T12:00:00Z'); await f.service.scan();
    const e = reminders(f)[0]; paidDate(f); await f.service.scan();
    assert.equal(stored(f, e).status, 'pending');
    let calls = 0; const w = worker(f, async () => { calls++; return sentOk(e.payload.eventId); });
    await assert.rejects(f.service.validate(e.payload), new RegExp(CODE));
    await w.deliver(stored(f, e));
    assert.equal(stored(f, e).status, 'retry'); assert.equal(stored(f, e).reason, CODE); assert.equal(calls, 0);
    assert.equal(stored(f, e).nextAt, f.clock() + 300000, 'no reading the source every tick');
    for (let i = 0; i < 3; i++) await w.deliver(stored(f, e));
    assert.equal(audits(f).filter(a => a.subject === e.payload.eventId).length, 1, 'a held event does not flood the audit');
    correct(f); f.setNow(f.clock() + 300000); await w.deliver(stored(f, e));
    assert.equal(stored(f, e).status, 'sent'); assert.equal(calls, 1);
});
test('a held event past its day ends as obsolete, with no late send', async () => {
    const f = fixture(); await f.ready(); await f.sent(); f.setNow('2026-11-11T12:00:00Z'); await f.service.scan();
    const e = reminders(f)[0]; paidDate(f); await worker(f).deliver(stored(f, e));
    correct(f); f.setNow('2026-11-12T12:00:00Z'); await worker(f).deliver(stored(f, e));
    assert.equal(stored(f, e).status, 'cancelled'); assert.equal(stored(f, e).reason, 'OBSOLETE');
});
test('filled between prepare and SMTP: no lease', async () => {
    const f = fixture(); await f.ready(); await f.sent(); f.setNow('2026-11-11T12:00:00Z'); await f.service.scan();
    const e = reminders(f)[0], current = stored(f, e); current.status = 'sending'; await f.store.repo.saveEvent(current);
    await f.service.validate(e.payload, 'prepare'); paidValue(f);
    await assert.rejects(f.service.validate(e.payload, 'smtp'), new RegExp(CODE));
    assert.deepEqual(f.store.data.states.get(f.ids.invoice).leases, []);
});
test('every collection message respects it: availability, D-1 and D0', async t => {
    await t.test('BOLETO_AVAILABLE', async () => {
        const f = fixture(); await f.service.scan(); paidDate(f); f.attach('boleto'); await f.service.scan();
        assert.equal(of(f, 'BOLETO_AVAILABLE').length, 0);
        correct(f); await f.service.scan();
        assert.equal(of(f, 'BOLETO_AVAILABLE').length, 1);
    });
    for (const [type, day] of Object.entries({ BOLETO_D_MINUS_1: '2026-11-05', BOLETO_DUE_TODAY: '2026-11-06' })) await t.test(type, async () => {
        const f = fixture(); await f.ready(); await f.sent(); paidDate(f); f.setNow(day + 'T12:00:00Z'); await f.service.scan();
        assert.equal(of(f, type).length, 0);
        correct(f); await f.service.scan();
        assert.equal(of(f, type).length, 1);
    });
});
test('with status Pago the payment data is consistent: stop and confirmation as usual', async () => {
    const f = fixture(); await f.ready(); await f.sent(); paidDate(f); paidValue(f); f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago';
    await f.service.scan(); await f.service.scan();
    assert.equal(audits(f).length, 0); assert.equal(of(f, 'BOLETO_PAYMENT_RECORDED').length, 1);
    await f.service.validate(of(f, 'BOLETO_PAYMENT_RECORDED')[0].payload);
});
test('the NFSe is not affected', async () => {
    const f = fixture(); await f.service.scan(); paidDate(f); f.attach('nfse'); await f.service.scan();
    assert.equal(of(f, 'NFSE_AVAILABLE').length, 1); await f.service.validate(of(f, 'NFSE_AVAILABLE')[0].payload);
});
test('a record inconsistent at the baseline is audited and nothing is sent retroactively', async () => {
    const f = fixture(); paidDate(f); f.attach('boleto'); await f.service.scan();
    assert.equal(audits(f).length, 1); correct(f); f.setNow('2026-11-11T12:00:00Z'); await f.service.scan();
    assert.equal(f.events().length, 0);
});
test('the scan requests both payment fields, read-only', async () => {
    for (const field of [N.DATA_PAGAMENTO, N.VALOR_PAGO]) assert.ok(CATALOG_FIELDS[S.TABELAS.NOTAS_FISCAIS].includes(field));
    const f = fixture(); assert.deepEqual(Object.keys(f.airtable).sort(), ['listarRegistros', 'obterRegistro']);
});

// Item 6: parcela sem valor é dado inconsistente para um lembrete.
test('a reminder needs a positive installment amount', async t => {
    for (const [name, value] of Object.entries({ vazio: undefined, zero: 0 })) await t.test(name, async () => {
        const f = fixture(); f.invoice.fields[N.VALOR_PARCELA] = value; await f.ready(); await f.sent(); f.setNow('2026-11-11T12:00:00Z'); await f.service.scan();
        assert.equal(reminders(f).length, 0); assert.equal(audits(f, 'INSTALLMENT_AMOUNT_MISSING').length, 1);
    });
});
test('unreadable data stops the reminder, without inventing values', async t => {
    const changes = { vencimentoInvalido: f => { f.invoice.fields[N.VENCIMENTO] = 'amanha'; }, valorInvalido: f => { f.invoice.fields[N.VALOR_PARCELA] = 'mil'; } };
    for (const [name, change] of Object.entries(changes)) await t.test(name, async () => {
        const f = fixture(); await f.ready(); await f.sent(); change(f); f.setNow('2026-11-11T12:00:00Z'); await f.service.scan();
        assert.equal(reminders(f).length, 0);
    });
});

test('real receiver: filled after the worker check, no SMTP; corrected, one send', { skip: !available }, async t => {
    const { createReceiver, ROUTE } = require(path.join(notifications, 'billing/receiver.js'));
    const f = fixture(); await f.ready(); await f.sent(); f.setNow('2026-11-11T12:00:00Z'); await f.service.scan();
    const app = express(); register(app, express, { config: cfg, store: f.store, service: f.service, clock: f.clock });
    const srv = app.listen(0, '127.0.0.1'); await new Promise(resolve => srv.once('listening', resolve));
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'itr-billing-test-'));
    t.after(async () => { await new Promise(resolve => { srv.closeAllConnections(); srv.close(resolve); }); fs.rmSync(directory, { recursive: true, force: true }); });
    const sent = [];
    const receiver = createReceiver({ config: { enabled: true, secret: cfg.secret, origin: 'https://portal.example.test', directory }, clock: f.clock,
        fetcher: (url, options) => fetch(`http://127.0.0.1:${srv.address().port}${new URL(url).pathname}`, options),
        send: async args => { sent.push(args); return { ok: true }; } });
    let race = true;
    const w = worker(f, async (url, options) => {
        if (race) { paidDate(f); race = false; }
        const r = await receiver.handle({ method: 'POST', path: ROUTE, headers: options.headers }, Buffer.from(options.body));
        return new Response(JSON.stringify(r.body), { status: r.status });
    });
    const e = reminders(f)[0];
    await w.deliver(stored(f, e));
    assert.equal(sent.length, 0); assert.equal(stored(f, e).status, 'retry');
    correct(f); f.setNow(f.clock() + 60000); await w.deliver(stored(f, e));
    assert.equal(sent.length, 1); assert.equal(stored(f, e).status, 'sent');
});
