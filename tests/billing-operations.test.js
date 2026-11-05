'use strict';
// Rotina diária e caminho da migration, sem banco: conexões simuladas registram cada comando.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildReport, sectionOf } = require('../lib/billing/report');
const { run: runReport } = require('../scripts/billing-report');
const { run: runMigrate } = require('../scripts/billing-migrate');
const { plan, migrate, verify } = require('../lib/billing/migrate');
const NOW = Date.parse('2026-11-05T12:00:00Z');
const sqlFile = fs.readFileSync(path.join(__dirname, '../migrations/006_billing_automation.sql'), 'utf8');

function reportConn({ meta = [{ id: 'baseline' }], counts = [], open = [], stuck = [], audit = [], fail = null } = {}) {
    const sql = [];
    return { sql, async query(text, params) {
        sql.push(text);
        if (fail && text.includes(fail)) throw new Error('offline');
        if (text.includes('portal_billing_meta')) return [meta];
        if (text.includes('GROUP BY status')) return [counts];
        if (text.includes("status IN ('uncertain', 'blocked')")) return [open];
        if (text.includes("status = 'sending'")) return [stuck];
        if (text.includes('portal_billing_audit')) return [audit.filter(a => a.last_at >= params[0])];
        return [[]];
    } };
}
const row = (code, subject = 'recDDDDDDDDDDDDDD', total = 1, last_at = NOW - 3600000) => ({ code, subject, total, last_at });

test('report: a quiet day needs no attention', async () => {
    const r = await buildReport(reportConn({ counts: [{ status: 'sent', total: 3 }], audit: [row('QUEUED'), row('SENT'), row('REMINDER_CONSOLIDATED')] }), NOW);
    assert.equal(r.attention, false); assert.deepEqual(r.outbox, { sent: 3 }); assert.deepEqual(r.sections, { reversals: [], uncertainDeliveries: [], held: [], errors: [] });
});
test('report: reversals, uncertain deliveries, held items and errors each appear in their section', async () => {
    const r = await buildReport(reportConn({ audit: [row('PAYMENT_REVERSAL_REVIEW'), row('ORPHANED_DISPATCH', 'a'.repeat(64)), row('PAYMENT_DATA_INCONSISTENT'), row('RETRY_EXHAUSTED', 'b'.repeat(64))] }), NOW);
    assert.equal(r.attention, true);
    assert.deepEqual(Object.fromEntries(Object.entries(r.sections).map(([k, v]) => [k, v.map(x => x.code)])), { reversals: ['PAYMENT_REVERSAL_REVIEW'], uncertainDeliveries: ['ORPHANED_DISPATCH'], held: ['PAYMENT_DATA_INCONSISTENT'], errors: ['RETRY_EXHAUSTED'] });
});
test('report: every code the code base can audit is classified on purpose or falls into errors', () => {
    for (const code of ['UNKNOWN_NEW_FAILURE', 'CHAIN_INVALID', 'CNPJ_AMBIGUOUS', 'DOCUMENT_INTEGRITY', 'AUTH_REJECTED', 'PROTOCOL_REJECTED', 'BLOCKED', 'INTERNAL_FAILURE', 'SOURCE_UNAVAILABLE', 'STATUS_INELIGIBLE']) assert.equal(sectionOf(code), 'errors', code);
    assert.equal(sectionOf('OUTSIDE_SEND_WINDOW'), null); assert.equal(sectionOf('OPERATIONAL_ALERT_UNDELIVERED'), null);
});
test('report: uncertain, blocked and stuck events are listed by id even without a recent audit', async () => {
    const event = { id: 'a'.repeat(64), invoice_id: 'recDDDDDDDDDDDDDD', status: 'uncertain' };
    const a = await buildReport(reportConn({ open: [event] }), NOW);
    assert.equal(a.attention, true); assert.deepEqual(a.openEvents, [{ eventId: event.id, invoiceId: event.invoice_id, status: 'uncertain' }]);
    const b = await buildReport(reportConn({ stuck: [{ ...event, status: 'sending' }] }), NOW);
    assert.equal(b.attention, true); assert.equal(b.stuckEvents.length, 1);
});
test('report: a missing baseline and a truncated list need attention', async () => {
    assert.equal((await buildReport(reportConn({ meta: [] }), NOW)).attention, true);
    const many = Array.from({ length: 500 }, (_, i) => row('QUEUED', 'r' + i));
    const r = await buildReport(reportConn({ audit: many }), NOW);
    assert.equal(r.truncated, true); assert.equal(r.attention, true);
});
test('report: the window covers once-a-day audit codes, and older rows drop out', async () => {
    const r = await buildReport(reportConn({ audit: [row('PAYMENT_REVERSAL_REVIEW', 'recAAAAAAAAAAAAAA', 1, NOW - 24.5 * 3600000), row('RETRY_EXHAUSTED', 'recBBBBBBBBBBBBBB', 1, NOW - 26 * 3600000)] }), NOW);
    assert.equal(r.sections.reversals.length, 1); assert.equal(r.sections.errors.length, 0);
});
test('report: read only, and it never reads encrypted data', async () => {
    const c = reportConn({ audit: [row('QUEUED')] }); await buildReport(c, NOW);
    assert.equal(c.sql[0], 'START TRANSACTION READ ONLY'); assert.equal(c.sql.at(-1), 'ROLLBACK');
    for (const text of c.sql.slice(1, -1)) { assert.match(text, /^SELECT /); assert.doesNotMatch(text, /\bdata\b/); }
});
test('report: says plainly that it is not an alert, and its digest is verifiable', async () => {
    const { hash, canonical } = require('../lib/billing/protocol');
    const { digest, ...body } = await buildReport(reportConn({ audit: [row('PAYMENT_REVERSAL_REVIEW')] }), NOW);
    assert.equal(body.alertDelivered, false); assert.equal(digest, hash(canonical(body)));
});
test('report: a failed query rolls back and surfaces as failure', async () => {
    const c = reportConn({ fail: 'portal_billing_audit' });
    await assert.rejects(buildReport(c, NOW)); assert.equal(c.sql.at(-1), 'ROLLBACK');
});
test('report script: exit codes tell the three outcomes apart and the connection is released', async () => {
    let released = 0, output = '';
    const pool = conn => ({ async getConnection() { return { ...conn, query: conn.query, release() { released++; } }; } });
    assert.equal(await runReport(pool(reportConn()), t => { output = t; }, () => NOW), 0); assert.equal(JSON.parse(output).attention, false);
    assert.equal(await runReport(pool(reportConn({ audit: [row('PAYMENT_REVERSAL_REVIEW')] })), () => {}, () => NOW), 2);
    await assert.rejects(runReport(pool(reportConn({ fail: 'portal_billing_meta' })), () => {}, () => NOW));
    assert.equal(released, 3);
});

// Migration.
const TABLES = ['portal_billing_audit', 'portal_billing_documents', 'portal_billing_grants', 'portal_billing_meta', 'portal_billing_nonces', 'portal_billing_outbox', 'portal_billing_states', 'portal_billing_versions'];
function migrationConn({ lock = 1, columns = null } = {}) {
    const sql = [], expected = plan().tables;
    const present = columns || Object.fromEntries(Object.entries(expected).map(([t, c]) => [t, c]));
    return { sql, released: 0, release() { this.released++; }, async query(text) {
        sql.push(text);
        if (text.includes('GET_LOCK')) return [[{ acquired: lock }]];
        if (text.includes('information_schema')) return [Object.entries(present).flatMap(([t, cols]) => cols.map(c => ({ table_name: t, column_name: c, TABLE_NAME: t, COLUMN_NAME: c })))];
        return [[]];
    } };
}
test('migration: additive only, and the plan lists the eight tables', () => {
    assert.doesNotMatch(sqlFile, /\b(DROP|ALTER|TRUNCATE|DELETE|UPDATE|RENAME)\b/i);
    const p = plan(); assert.deepEqual(Object.keys(p.tables).sort(), TABLES); assert.equal(p.statements, 8); assert.match(p.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(p.tables.portal_billing_audit, ['seq', 'at_ms', 'subject', 'code']);
});
test('migration: any other command is refused before reaching the database', () => {
    const { parse } = require('../lib/billing/migrate');
    for (const bad of ['DROP TABLE portal_billing_audit;', 'ALTER TABLE portal_billing_audit ADD x INT;', 'CREATE TABLE portal_billing_audit (x INT);', 'CREATE TABLE IF NOT EXISTS portal_clients (x INT);', 'CREATE TABLE IF NOT EXISTS portal_billing_a (x INT); DELETE FROM portal_billing_a;'])
        assert.throws(() => parse(bad), /MIGRATION_UNSAFE/, bad);
    assert.equal(parse(sqlFile).statements.length, 8);
});
test('migration: runs only CREATE TABLE IF NOT EXISTS under a lock, and is repeatable', async () => {
    const c = migrationConn(); await migrate(c); await migrate(c);
    const creates = c.sql.filter(s => s.startsWith('CREATE'));
    assert.equal(creates.length, 16); assert.ok(creates.every(s => /^CREATE TABLE IF NOT EXISTS portal_billing_/.test(s)));
    assert.equal(c.sql.filter(s => s.includes('GET_LOCK')).length, 2); assert.equal(c.sql.filter(s => s.includes('RELEASE_LOCK')).length, 2);
});
test('migration: another run in progress stops it', async () => {
    const c = migrationConn({ lock: 0 }); await assert.rejects(migrate(c), /BUSY/);
    assert.equal(c.sql.filter(s => s.startsWith('CREATE')).length, 0);
});
test('migration: verification finds missing tables and missing columns, and only reads', async () => {
    const full = plan().tables;
    assert.deepEqual(await verify(migrationConn()), { ok: true, missingTables: [], missingColumns: [], sha256: plan().sha256 });
    const { portal_billing_audit: _a, ...withoutAudit } = full;
    const a = await verify(migrationConn({ columns: withoutAudit })); assert.equal(a.ok, false); assert.deepEqual(a.missingTables, ['portal_billing_audit']);
    const b = await verify(migrationConn({ columns: { ...full, portal_billing_outbox: full.portal_billing_outbox.filter(x => x !== 'next_at') } }));
    assert.equal(b.ok, false); assert.deepEqual(b.missingColumns, ['portal_billing_outbox.next_at']);
    const c = migrationConn(); await verify(c); assert.ok(c.sql.every(s => /^SELECT /.test(s)));
});
test('migration script: no arguments opens no connection; applying requires the backup confirmation', async () => {
    let opened = 0, output = ''; const open = async () => { opened++; return migrationConn(); };
    assert.equal(await runMigrate([], open, t => { output = t; }), 0); assert.equal(opened, 0); assert.equal(JSON.parse(output).mode, 'plan');
    await assert.rejects(runMigrate(['--aplicar'], open), /BACKUP_CONFIRMATION_REQUIRED/); assert.equal(opened, 0);
});
test('migration script: verify does not create, apply creates and verifies, and the exit code tells a gap', async () => {
    const v = migrationConn(); assert.equal(await runMigrate(['--verificar'], async () => v, () => {}), 0);
    assert.equal(v.sql.filter(s => s.startsWith('CREATE')).length, 0); assert.equal(v.released, 1);
    const a = migrationConn(); assert.equal(await runMigrate(['--aplicar', '--backup-confirmado'], async () => a, () => {}), 0);
    assert.equal(a.sql.filter(s => s.startsWith('CREATE')).length, 8); assert.ok(a.sql.at(-1).includes('information_schema'));
    const gap = migrationConn({ columns: {} }); assert.equal(await runMigrate(['--verificar'], async () => gap, () => {}), 2);
});
test('migration script: the plan runs for real without touching the database', () => {
    const r = spawnSync(process.execPath, [path.join(__dirname, '../scripts/billing-migrate.js')], { encoding: 'utf8', env: { PATH: process.env.PATH, NODE_ENV: 'test' } });
    assert.equal(r.status, 0, r.stderr); assert.equal(JSON.parse(r.stdout).statements, 8);
});
test('the application itself never applies the migration', () => {
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8'), index = fs.readFileSync(path.join(__dirname, '../lib/billing/index.js'), 'utf8');
    assert.doesNotMatch(server + index, /migrate/);
});
