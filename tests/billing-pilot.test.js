'use strict';
// Piloto: lista exata de clientes liberados. Vazia por padrão. Sem rede.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, S } = require('./helpers/billing-fixtures');
const { createService } = require('../lib/billing/service');
const { createWorker } = require('../lib/billing/worker');
const { configuration } = require('../lib/billing/config');
const N = S.NOTAS_FISCAIS;
const cfg = { enabled: true, worker: true, origin: 'https://notifications.example.test', secret: Buffer.alloc(32, 3).toString('base64') };
const key = n => Buffer.alloc(32, n).toString('base64');
const env = extra => ({ PORTAL_BILLING_ENABLED: 'true', BILLING_HMAC_SECRET: key(1), PORTAL_BILLING_STORAGE_KEY: key(2), PORTAL_BILLING_NOTIFICATIONS_ORIGIN: 'https://n.example.test', ...extra });
const A = 'recAAAAAAAAAAAAAA', B = 'recBBBBBBBBBBBBBB';
const of = (f, type) => f.events().filter(e => e.payload.type === type);
const stored = (f, e) => f.store.data.events.get(e.payload.eventId);
const audits = (f, code) => f.store.data.audit.filter(a => a.code === code);
const ok = async (u, o) => new Response(JSON.stringify({ ok: true, code: 'SENT', eventId: JSON.parse(o.body).eventId }), { status: 200 });
const none = async () => { throw new Error('must not send'); };
// A scanner with a chosen list over the same data, as after a restart with another configuration.
const withList = (f, pilotClients) => createService({ store: f.store, source: f.source, clock: f.clock, pilotClients });
const worker = (f, service, fetcher = ok) => createWorker({ config: cfg, store: f.store, service, clock: f.clock, fetcher, random: () => 0 });

// Configuração.
test('the list is empty by default, and flags off ignore it', () => {
    assert.deepEqual(configuration(env({})).pilotClients, []);
    assert.deepEqual(configuration(env({ PORTAL_BILLING_PILOT_CLIENTS: '' })).pilotClients, []);
    assert.deepEqual(configuration(env({ PORTAL_BILLING_PILOT_CLIENTS: '   ' })).pilotClients, []);
    assert.deepEqual(configuration({ PORTAL_BILLING_PILOT_CLIENTS: 'qualquer' }), { enabled: false, worker: false });
});
test('exact record ids are accepted', () => {
    assert.deepEqual(configuration(env({ PORTAL_BILLING_PILOT_CLIENTS: A })).pilotClients, [A]);
    assert.deepEqual(configuration(env({ PORTAL_BILLING_PILOT_CLIENTS: ` ${A} , ${B} ` })).pilotClients, [A, B]);
});
test('anything else stops the boot', () => {
    for (const bad of ['*', 'all', 'todos', 'rec*', 'recAAAA', `${A},`, `,${A}`, `${A},,${B}`, `${A};${B}`, `${A} ${B}`, `${A},${A}`, 'cli' + A.slice(3), A + 'X', 'RECAAAAAAAAAAAAAA', '12345678000195', 'cliente@example.test'])
        assert.throws(() => configuration(env({ PORTAL_BILLING_PILOT_CLIENTS: bad })), /BILLING_PILOT_INVALID/, bad);
});

// Agendamento.
test('an empty list queues nothing, for any client', async () => {
    const f = fixture(); const s = withList(f, []); await s.scan(); f.attach('boleto'); f.attach('nfse'); await s.scan();
    f.setNow('2026-11-11T12:00:00Z'); await s.scan();
    assert.equal(f.events().length, 0);
});
test('a listed client follows the normal flow', async () => {
    const f = fixture(); await f.ready(); assert.equal(of(f, 'BOLETO_AVAILABLE').length, 1);
    await f.service.validate(of(f, 'BOLETO_AVAILABLE')[0].payload);
});
test('a client outside the list queues nothing, and a similar id does not match', async t => {
    for (const list of [[B], ['recAAAAAAAAAAAAAB'], ['recaaaaaaaaaaaaaa'], []]) await t.test(list.join() || 'vazia', async () => {
        const f = fixture(); const s = withList(f, list); await s.scan(); f.attach('boleto'); await s.scan();
        assert.equal(f.events().length, 0);
    });
});
test('a client outside the list is still observed: documents, stop and integrity audit', async () => {
    const f = fixture(); const s = withList(f, []); await s.scan(); f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago'; await s.scan();
    assert.equal(f.store.data.states.get(f.ids.invoice).stopped, true);
    f.invoice.fields[N.BOLETO] = [{ id: 'attGGGGGGGGGGGGGG', type: 'image/png', size: 10, url: 'https://v5.airtableusercontent.com/boleto' }]; await s.scan();
    assert.equal(audits(f, 'DOCUMENT_METADATA_INVALID').length, 1);
});

// Autorização imediatamente antes do envio.
test('removed from the list: the proof refuses, the event ends cancelled and nothing is sent', async () => {
    const f = fixture(); await f.ready(); const e = of(f, 'BOLETO_AVAILABLE')[0], s = withList(f, []);
    await assert.rejects(s.validate(e.payload), /CLIENT_NOT_RELEASED/);
    await assert.rejects(s.validate(e.payload, 'smtp'), /CLIENT_NOT_RELEASED/);
    await worker(f, s, none).deliver(stored(f, e));
    assert.equal(stored(f, e).status, 'cancelled'); assert.equal(stored(f, e).reason, 'CLIENT_NOT_RELEASED');
});
test('the proof judges the client read now, not the one in the event', async () => {
    const f = fixture(); await f.ready(); const p = structuredClone(of(f, 'BOLETO_AVAILABLE')[0].payload);
    const other = withList(f, [B]); p.clientId = B;
    await assert.rejects(other.validate(p));
});
test('removed between prepare and SMTP: no lease', async () => {
    const f = fixture(); await f.ready(); const e = of(f, 'BOLETO_AVAILABLE')[0], current = stored(f, e); current.status = 'sending'; await f.store.repo.saveEvent(current);
    await f.service.validate(e.payload, 'prepare');
    await assert.rejects(withList(f, []).validate(e.payload, 'smtp'), /CLIENT_NOT_RELEASED/);
    assert.deepEqual(f.store.data.states.get(f.ids.invoice).leases, []);
});
test('removed: no new occurrence arises', async () => {
    const f = fixture(); await f.ready(); await f.sent(); const s = withList(f, []);
    f.setNow('2026-11-11T12:00:00Z'); await s.scan();
    assert.equal(of(f, 'BOLETO_OVERDUE_REMINDER').length, 0);
});

// Sem envios históricos.
test('released later: what arrived before the release is never sent', async () => {
    const f = fixture(); const before = withList(f, []); await before.scan(); f.attach('boleto'); f.attach('nfse'); await before.scan();
    const after = withList(f, [A]); await after.scan();
    for (const day of ['05', '06', '11', '16']) { f.setNow(`2026-11-${day}T12:00:00Z`); await after.scan(); }
    assert.equal(f.events().length, 0);
});
test('released later: a document arriving after the release follows the normal flow', async () => {
    const f = fixture(); const before = withList(f, []); await before.scan(); f.attach('boleto'); await before.scan();
    const after = withList(f, [A]); await after.scan(); f.attach('nfse'); await after.scan();
    assert.deepEqual(f.events().map(e => e.payload.type), ['NFSE_AVAILABLE']);
});
test('a payment seen outside the list never produces a late confirmation', async () => {
    const f = fixture(); const before = withList(f, []); await before.scan(); f.attach('boleto'); await before.scan();
    f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago'; await before.scan(); await before.scan();
    const after = withList(f, [A]); await after.scan(); await after.scan();
    assert.equal(f.events().length, 0); assert.equal(f.store.data.states.get(f.ids.invoice).transitionId, null);
});
test('a payment seen once outside the list is not confirmed after the release', async () => {
    const f = fixture(); const before = withList(f, []); await before.scan(); f.attach('boleto'); await before.scan();
    f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago'; await before.scan();
    assert.equal(f.store.data.states.get(f.ids.invoice).paymentCandidate ?? null, null);
    const after = withList(f, [A]); await after.scan(); await after.scan();
    assert.equal(f.events().length, 0);
});
test('a payment being confirmed when the client is removed is not confirmed later', async () => {
    const f = fixture(); await f.ready(); await f.sent(); f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago'; await f.service.scan();
    const s = withList(f, []); await s.scan(); await f.service.scan(); await f.service.scan();
    assert.equal(of(f, 'BOLETO_PAYMENT_RECORDED').length, 0);
});
test('a record created while outside the list stays out after the release', async () => {
    const f = fixture(); const before = withList(f, []); await before.scan();
    f.invoice.createdTime = '2026-11-05T00:00:00Z'; f.attach('boleto'); f.store.data.states.delete(f.ids.invoice);
    f.setNow('2026-11-05T12:00:00Z'); await before.scan();
    const after = withList(f, [A]); await after.scan();
    assert.equal(f.events().length, 0);
});
test('returning to the list: only future occurrences, nothing cancelled comes back', async () => {
    const f = fixture(); await f.ready(); await f.sent(); f.setNow('2026-11-11T12:00:00Z'); await f.service.scan();
    const e = of(f, 'BOLETO_OVERDUE_REMINDER')[0], s = withList(f, []);
    await worker(f, s, none).deliver(stored(f, e));
    await f.service.scan();
    assert.deepEqual(of(f, 'BOLETO_OVERDUE_REMINDER').map(x => x.status), ['cancelled']);
    f.setNow('2026-11-14T12:00:00Z'); await s.scan();
    f.setNow('2026-11-16T12:00:00Z'); await f.service.scan();
    assert.deepEqual(of(f, 'BOLETO_OVERDUE_REMINDER').map(x => [x.payload.scheduledFor, x.status]), [['2026-11-11', 'cancelled'], ['2026-11-16', 'pending']]);
});

// O resto continua igual.
test('idempotence and recipients are unchanged for a listed client', async () => {
    const { CLIENT_EMAIL } = require('../lib/billing/source');
    const f = fixture(); await f.ready(); for (let i = 0; i < 3; i++) await f.service.scan();
    assert.equal(of(f, 'BOLETO_AVAILABLE').length, 1);
    f.client.fields[CLIENT_EMAIL] = 'outro@example.test';
    await assert.rejects(f.service.validate(of(f, 'BOLETO_AVAILABLE')[0].payload), /RECIPIENT_UNAUTHORIZED/);
});
