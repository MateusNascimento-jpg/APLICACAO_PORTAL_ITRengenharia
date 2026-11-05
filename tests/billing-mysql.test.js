'use strict';
// Persistência real. Só roda em MySQL local e isolado; sem as variáveis abaixo, fica como teste pulado:
//   BILLING_LOCAL_DB_NAME=itr_billing_test_<nome>, BILLING_LOCAL_DB_USER, BILLING_LOCAL_DB_PASSWORD
//   BILLING_LOCAL_DB_HOST (127.0.0.1 ou ::1) e BILLING_LOCAL_DB_PORT (opcionais)
const test = require('node:test');
const assert = require('node:assert/strict');
const { localOptions } = require('../scripts/billing-local');
const { fixture } = require('./helpers/billing-fixtures');
const { createStore } = require('../lib/billing/store');
const { createSource } = require('../lib/billing/source');
const { createService } = require('../lib/billing/service');
const { createWorker } = require('../lib/billing/worker');
const { migrate, verify, plan } = require('../lib/billing/migrate');
const { buildReport } = require('../lib/billing/report');
const { hash } = require('../lib/billing/protocol');
let options = null;
try { options = localOptions({ ...process.env, NODE_ENV: 'test' }); } catch { /* No isolated database configured. */ }
const skip = options ? false : 'MySQL isolado não configurado';
const key = Buffer.alloc(32, 9).toString('base64');
const cfg = { enabled: true, worker: true, origin: 'https://n.example.test', secret: Buffer.alloc(32, 3).toString('base64') };

async function setup(t) {
    const mysql = require('mysql2/promise'), pool = mysql.createPool({ ...options, connectionLimit: 8 });
    t.after(() => pool.end());
    const conn = await pool.getConnection();
    try {
        for (const table of Object.keys(plan().tables)) {
            if (!/^portal_billing_[a-z_]+$/.test(table)) throw new Error('UNSAFE_TABLE');
            await conn.query(`DROP TABLE IF EXISTS ${table}`);
        }
        await migrate(conn);
    } finally { conn.release(); }
    const f = fixture(), store = createStore(pool, key);
    const source = createSource({ airtable: f.airtable, cipher: store.cipher, pdfReader: async url => { const bytes = f.pdfs[url.includes('nfse') ? 'nfse' : 'boleto']; return { bytes, hash: hash(bytes) }; } });
    const service = () => createService({ store, source, clock: f.clock, pilotClients: [f.ids.client] });
    return { pool, f, store, service, events: async () => { const [rows] = await pool.query('SELECT data FROM portal_billing_outbox'); return rows.map(r => store.cipher.open(r.data)); } };
}
test('the safety check refuses anything but a local test database', () => {
    for (const env of [{}, { BILLING_LOCAL_DB_NAME: 'portal', NODE_ENV: 'test' }, { BILLING_LOCAL_DB_NAME: 'itr_billing_test_a', NODE_ENV: 'production' }, { BILLING_LOCAL_DB_NAME: 'itr_billing_test_a', BILLING_LOCAL_DB_HOST: 'db.example.test', NODE_ENV: 'test' }])
        assert.throws(() => localOptions(env), /LOCAL_TEST_DATABASE_REQUIRED/);
});
test('migration: repeatable and verified on a real server', { skip }, async t => {
    const { pool } = await setup(t), conn = await pool.getConnection();
    try { await migrate(conn); await migrate(conn); const r = await verify(conn); assert.equal(r.ok, true, JSON.stringify(r)); } finally { conn.release(); }
});
test('store: encrypted at rest, no plain address or value in the tables', { skip }, async t => {
    const { pool, f, service } = await setup(t), s = service(); await s.scan(); f.attach('boleto'); await s.scan();
    const [rows] = await pool.query('SELECT data, status FROM portal_billing_outbox'); assert.equal(rows.length, 1); assert.equal(rows[0].status, 'pending');
    assert.doesNotMatch(rows[0].data, /financeiro@example\.test|150050/);
});
test('store: an immutable event, a rolled back transaction and a replayed nonce', { skip }, async t => {
    const { pool, f, store, service, events } = await setup(t), s = service(); await s.scan(); f.attach('boleto'); await s.scan();
    const [event] = await events();
    await assert.rejects(store.locked('x', repo => repo.saveEvent({ ...event, payload: { ...event.payload, amountCents: 1 } })), /EVENT_CONFLICT/);
    await assert.rejects(store.locked('y', repo => repo.transaction(async () => { await repo.audit('rollback-test', 'QUEUED', 1); throw new Error('stop'); })), /stop/);
    const [audit] = await pool.query("SELECT 1 FROM portal_billing_audit WHERE subject = 'rollback-test'"); assert.equal(audit.length, 0);
    assert.equal(await store.nonce('n1', 1), true); assert.equal(await store.nonce('n1', 2), false);
});
test('locks: a second holder of the same scope is refused, across connections', { skip }, async t => {
    const { store } = await setup(t);
    await store.locked('invoice:1', async () => { await assert.rejects(store.locked('invoice:1', async () => {}), /BUSY/); await store.locked('invoice:2', async () => {}); });
    await store.locked('invoice:1', async () => {});
});
test('recovery: a restart keeps the state, and repeated scans and deliveries send once', { skip }, async t => {
    const { pool, f, store, service, events } = await setup(t); await service().scan(); f.attach('boleto');
    await service().scan(); await service().scan(); assert.equal((await events()).length, 1);
    let calls = 0; const fetcher = async (u, o) => { calls++; return new Response(JSON.stringify({ ok: true, code: 'SENT', eventId: JSON.parse(o.body).eventId }), { status: 200 }); };
    const w = createWorker({ config: cfg, store, service: service(), clock: f.clock, fetcher, random: () => 0 });
    for (const e of await store.due(f.clock())) await w.deliver(e);
    assert.equal(calls, 1); assert.equal((await store.due(f.clock())).length, 0);
    await service().scan(); assert.equal((await events())[0].status, 'sent'); assert.equal((await events()).length, 1);
    const conn = await pool.getConnection();
    try { const r = await buildReport(conn, f.clock()); assert.equal(r.baselineComplete, true); assert.equal(r.outbox.sent, 1); } finally { conn.release(); }
});
test('recovery: a failure in the middle of a delivery leaves the event retryable', { skip }, async t => {
    const { f, store, service, events } = await setup(t), s = service(); await s.scan(); f.attach('boleto'); await s.scan();
    const w = createWorker({ config: cfg, store, service: s, clock: f.clock, fetcher: async () => { throw new TypeError('fetch failed'); }, random: () => 0 });
    for (const e of await store.due(f.clock())) await w.deliver(e);
    assert.equal((await events())[0].status, 'retry');
});
