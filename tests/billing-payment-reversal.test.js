'use strict';
// D7: depois de um pagamento, a cobrança só retoma por processo controlado, que ainda não existe. Sem rede.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, S } = require('./helpers/billing-fixtures');
const { createService, UPDATE_SETTLE_MS } = require('../lib/billing/service');
const { createWorker } = require('../lib/billing/worker');
const N = S.NOTAS_FISCAIS;
const cfg = { enabled: true, worker: true, origin: 'https://notifications.example.test', secret: Buffer.alloc(32, 3).toString('base64') };
const of = (f, type) => f.events().filter(e => e.payload.type === type);
const COLLECTION = ['BOLETO_AVAILABLE', 'BOLETO_D_MINUS_1', 'BOLETO_DUE_TODAY', 'BOLETO_OVERDUE_REMINDER', 'BOLETO_UPDATED'];
const ok = async (url, options) => new Response(JSON.stringify({ ok: true, code: 'SENT', eventId: JSON.parse(options.body).eventId }), { status: 200 });
async function deliverAll(f) {
    const w = createWorker({ config: cfg, store: f.store, service: f.service, clock: f.clock, fetcher: ok, random: () => 0 });
    for (const e of await f.store.due(f.clock())) await w.deliver(e);
}
async function paid() {
    const f = fixture(); await f.ready(); await deliverAll(f);
    f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago'; await f.service.scan(); await f.service.scan(); await deliverAll(f);
    return f;
}
const collectionAfter = (f, before) => f.events().filter(e => COLLECTION.includes(e.payload.type)).length - before;

test('a reversal keeps collection stopped across later dates', async t => {
    for (const status of ['Vencido', 'A Vencer', 'Aguardando Emissão da NF']) await t.test(status, async () => {
        const f = await paid(), before = f.events().filter(e => COLLECTION.includes(e.payload.type)).length;
        f.invoice.fields[N.STATUS_PAGAMENTO] = status;
        for (const day of ['05', '06', '11', '16']) { f.setNow(`2026-11-${day}T12:00:00Z`); await f.service.scan(); }
        assert.equal(collectionAfter(f, before), 0);
        assert.equal(f.store.data.states.get(f.ids.invoice).stopped, true);
    });
});
test('the stop survives a restart', async () => {
    const f = await paid(), before = f.events().filter(e => COLLECTION.includes(e.payload.type)).length;
    f.invoice.fields[N.STATUS_PAGAMENTO] = 'Vencido';
    const restarted = createService({ store: f.store, source: f.source, clock: f.clock });
    f.setNow('2026-11-11T12:00:00Z'); await restarted.scan();
    assert.equal(collectionAfter(f, before), 0);
});
test('a boleto attached or corrected after the reversal generates nothing', async () => {
    const f = await paid(), before = f.events().filter(e => COLLECTION.includes(e.payload.type)).length;
    f.invoice.fields[N.STATUS_PAGAMENTO] = 'Vencido'; await f.service.scan();
    f.pdfs.boleto = Buffer.from('%PDF-1.4\nSegunda via\n%%EOF'); f.attach('boleto'); f.invoice.fields[N.BOLETO][0].id = 'attGGGGGGGGGGGGGG';
    f.invoice.fields[N.VALOR_PARCELA] = 1600; await f.service.scan(); f.setNow(f.clock() + UPDATE_SETTLE_MS); await f.service.scan();
    assert.equal(collectionAfter(f, before), 0);
});
test('a message queued before the payment is refused even if the status reverts', async () => {
    const f = fixture(); await f.ready(); await deliverAll(f); f.setNow('2026-11-05T12:00:00Z'); await f.service.scan();
    const reminder = of(f, 'BOLETO_D_MINUS_1')[0];
    f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago'; await f.service.scan();
    f.invoice.fields[N.STATUS_PAGAMENTO] = 'A Vencer'; await f.service.scan();
    await assert.rejects(f.service.validate(reminder.payload));
    assert.equal(f.store.data.events.get(reminder.payload.eventId).status, 'cancelled');
});
test('paying again does not send a second confirmation', async () => {
    const f = await paid(); f.invoice.fields[N.STATUS_PAGAMENTO] = 'Vencido'; await f.service.scan();
    f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago'; await f.service.scan(); await f.service.scan();
    assert.equal(of(f, 'BOLETO_PAYMENT_RECORDED').length, 1);
});
test('the NFSe is not part of the stop', async () => {
    const f = await paid(); f.invoice.fields[N.STATUS_PAGAMENTO] = 'Vencido'; await f.service.scan(); f.attach('nfse'); await f.service.scan();
    assert.equal(of(f, 'NFSE_AVAILABLE').length, 1); await f.service.validate(of(f, 'NFSE_AVAILABLE')[0].payload);
});
test('no code path clears the stop: there is no automatic resumption', () => {
    const source = require('node:fs').readFileSync(require.resolve('../lib/billing/service'), 'utf8');
    assert.doesNotMatch(source, /stopped\s*=\s*false/); assert.doesNotMatch(source, /stoppedAt\s*=\s*null(?!,)/);
});

// Auditoria durável e alerta. Não há mecanismo de monitoramento nem de autorização de operador.
const audits = (f, code) => f.store.data.audit.filter(a => a.code === code);
test('a reversal is audited, at most daily, with only the code and the installment', async () => {
    const f = await paid(); assert.equal(audits(f, 'PAYMENT_REVERSAL_REVIEW').length, 0);
    f.invoice.fields[N.STATUS_PAGAMENTO] = 'Vencido';
    for (let i = 0; i < 4; i++) await f.service.scan();
    assert.equal(audits(f, 'PAYMENT_REVERSAL_REVIEW').length, 1);
    assert.deepEqual(Object.keys(audits(f, 'PAYMENT_REVERSAL_REVIEW')[0]).sort(), ['code', 'now', 'subject']);
    assert.equal(audits(f, 'PAYMENT_REVERSAL_REVIEW')[0].subject, f.ids.invoice);
    f.setNow(f.clock() + 86400000 + 1000); await f.service.scan();
    assert.equal(audits(f, 'PAYMENT_REVERSAL_REVIEW').length, 2);
});
test('with no monitoring mechanism the alert is recorded as undelivered, never as sent', async () => {
    const f = await paid(), warn = console.warn; const logged = []; console.warn = (...a) => logged.push(a);
    try { f.invoice.fields[N.STATUS_PAGAMENTO] = 'Vencido'; await f.service.scan(); } finally { console.warn = warn; }
    assert.equal(audits(f, 'OPERATIONAL_ALERT_UNDELIVERED').length, 1); assert.equal(audits(f, 'OPERATIONAL_ALERT_SENT').length, 0);
    assert.deepEqual(logged, [], 'a log line does not stand in for an alert');
});
test('the proof also records a reversal it observes, and refuses', async () => {
    const f = fixture(); await f.ready(); await f.sent(); f.setNow('2026-11-05T12:00:00Z'); await f.service.scan();
    const reminder = of(f, 'BOLETO_D_MINUS_1')[0];
    f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago'; await f.service.scan();
    f.invoice.fields[N.STATUS_PAGAMENTO] = 'A Vencer';
    await assert.rejects(f.service.validate(reminder.payload)); assert.equal(audits(f, 'PAYMENT_REVERSAL_REVIEW').length, 1);
});
test('a boleto paid at the baseline and reversed later is audited and stays stopped', async () => {
    const f = fixture(); f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago'; f.attach('boleto'); await f.service.scan();
    f.invoice.fields[N.STATUS_PAGAMENTO] = 'Vencido'; f.setNow('2026-11-11T12:00:00Z'); await f.service.scan();
    assert.equal(audits(f, 'PAYMENT_REVERSAL_REVIEW').length, 1); assert.equal(f.events().length, 0);
});
test('a paid installment or one never paid is not reported as a reversal', async () => {
    const paidOne = await paid(); await paidOne.service.scan(); assert.equal(audits(paidOne, 'PAYMENT_REVERSAL_REVIEW').length, 0);
    const open = fixture(); await open.ready(); open.invoice.fields[N.STATUS_PAGAMENTO] = 'Vencido'; await open.service.scan();
    assert.equal(audits(open, 'PAYMENT_REVERSAL_REVIEW').length, 0);
});
test('the audit changes nothing: stop, transition and confirmation stay as they were', async () => {
    const f = await paid(), before = f.store.data.states.get(f.ids.invoice);
    f.invoice.fields[N.STATUS_PAGAMENTO] = 'Vencido'; await f.service.scan();
    const after = f.store.data.states.get(f.ids.invoice);
    assert.equal(after.stopped, true); assert.equal(after.transitionId, before.transitionId); assert.equal(after.stoppedAt, before.stoppedAt);
    assert.equal(of(f, 'BOLETO_PAYMENT_RECORDED')[0].status, 'sent');
});
test('no resume path exists: nothing in the service, routes or scripts', () => {
    const fs = require('node:fs'), path = require('node:path');
    const f = fixture(); assert.deepEqual(Object.keys(f.service).sort(), ['cancel', 'scan', 'validate']);
    for (const file of ['lib/billing/routes.js', 'lib/billing/worker.js', 'lib/billing/service.js', 'lib/billing/store.js', 'scripts/billing-local.js'])
        assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), /resume|retomar|COLLECTION_RESUMED/i, file);
});
