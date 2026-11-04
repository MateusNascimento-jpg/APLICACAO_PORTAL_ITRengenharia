'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { hash } = require('./protocol');
async function migrate(connection) {
    const sql = fs.readFileSync(path.join(__dirname, '../../migrations/006_billing_automation.sql'), 'utf8');
    const statements = sql.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean);
    if (statements.some(s => !/^CREATE TABLE IF NOT EXISTS portal_billing_[a-z_]+\s*\(/.test(s))) throw new Error('MIGRATION_UNSAFE');
    const [rows] = await connection.query("SELECT GET_LOCK('itr_billing_migration_006', 0) AS acquired");
    if (Number(rows[0]?.acquired) !== 1) throw new Error('BUSY');
    try {
        for (const statement of statements) await connection.query(statement);
        return { version: '006', sha256: hash(sql), tables: statements.length };
    } finally { await connection.query("SELECT RELEASE_LOCK('itr_billing_migration_006')"); }
}
module.exports = { migrate };
