'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { hash } = require('./protocol');
function parse(sql) {
    const statements = sql.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean);
    if (statements.some(s => !/^CREATE TABLE IF NOT EXISTS portal_billing_[a-z_]+\s*\(/.test(s))) throw new Error('MIGRATION_UNSAFE');
    return { sql, statements };
}
const read = () => parse(fs.readFileSync(path.join(__dirname, '../../migrations/006_billing_automation.sql'), 'utf8'));
// What the migration creates, read from the file itself. Opens no connection.
function plan() {
    const { sql, statements } = read(), tables = {};
    for (const statement of statements) {
        const [, table] = statement.match(/^CREATE TABLE IF NOT EXISTS (portal_billing_[a-z_]+)/);
        tables[table] = statement.split('\n').map(line => line.trim().match(/^([a-z_]+) [A-Z]/)?.[1]).filter(Boolean);
    }
    return { version: '006', sha256: hash(sql), statements: statements.length, tables };
}
// A table that already existed with another shape passes CREATE IF NOT EXISTS, so the columns are checked too.
async function verify(connection) {
    const { sha256, tables } = plan();
    const [rows] = await connection.query("SELECT table_name AS table_name, column_name AS column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name LIKE 'portal\\_billing\\_%'");
    const present = new Set(rows.map(r => r.table_name + '.' + r.column_name)), existing = new Set(rows.map(r => r.table_name));
    const missingTables = Object.keys(tables).filter(t => !existing.has(t)).sort();
    const missingColumns = Object.entries(tables).filter(([t]) => existing.has(t)).flatMap(([t, cols]) => cols.filter(c => !present.has(t + '.' + c)).map(c => t + '.' + c));
    return { ok: !missingTables.length && !missingColumns.length, missingTables, missingColumns, sha256 };
}
async function migrate(connection) {
    const { sql, statements } = read();
    const [rows] = await connection.query("SELECT GET_LOCK('itr_billing_migration_006', 0) AS acquired");
    if (Number(rows[0]?.acquired) !== 1) throw new Error('BUSY');
    try {
        for (const statement of statements) await connection.query(statement);
        return { version: '006', sha256: hash(sql), tables: statements.length };
    } finally { await connection.query("SELECT RELEASE_LOCK('itr_billing_migration_006')"); }
}
module.exports = { migrate, plan, verify, parse };
