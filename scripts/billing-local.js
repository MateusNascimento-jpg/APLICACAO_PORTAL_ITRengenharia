'use strict';
// Explicit laboratory tool. Does not import config.js / db.js / dotenv.
const fs = require('node:fs');
const { migrate } = require('../lib/billing/migrate');
const { createCipher } = require('../lib/billing/crypto');
const { validateEvidence } = require('../lib/billing/evidence');
function localOptions(env) {
    const host = env.BILLING_LOCAL_DB_HOST || '127.0.0.1', database = env.BILLING_LOCAL_DB_NAME;
    if (!['127.0.0.1', '::1'].includes(host) || !/^itr_billing_test_[a-z0-9_]+$/.test(database || '') || env.NODE_ENV !== 'test')
        throw new Error('LOCAL_TEST_DATABASE_REQUIRED');
    return { host, database, user: env.BILLING_LOCAL_DB_USER, password: env.BILLING_LOCAL_DB_PASSWORD,
        port: Number(env.BILLING_LOCAL_DB_PORT || 3306), multipleStatements: false };
}
async function run(args, env = process.env) {
    const options = localOptions(env);
    const action = args[0];
    if (!['migrate', 'evidence'].includes(action)) throw new Error('USE_MIGRATE_OR_EVIDENCE');
    const cipher = action === 'evidence' ? createCipher(env.PORTAL_BILLING_STORAGE_KEY || '') : null;
    const evidence = action === 'evidence' ? validateEvidence(JSON.parse(fs.readFileSync(args[1], 'utf8')), cipher) : null;
    const conn = await require('mysql2/promise').createConnection(options);
    try {
        if (action === 'migrate') return await migrate(conn);
        // Test provision only, with workers stopped. Production provisioning needs an audited operator flow.
        await conn.beginTransaction();
        try {
            const table = evidence.type === 'grant' ? 'grants' : 'documents';
            const column = evidence.type === 'grant' ? 'client_id' : 'invoice_id';
            await conn.query(`INSERT INTO portal_billing_${table} (id, ${column}, data) VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE data=VALUES(data)`,
            [evidence.id, evidence.type === 'grant' ? evidence.clientId : evidence.invoiceId, cipher.seal(evidence)]);
            await conn.query('INSERT INTO portal_billing_audit (at_ms, subject, code) VALUES (?, ?, ?)', [Date.now(), evidence.id, 'LOCAL_EVIDENCE_IMPORTED']);
            await conn.commit();
        } catch (error) { await conn.rollback(); throw error; }
        return { code: 'LOCAL_EVIDENCE_IMPORTED', id: evidence.id };
    } finally { await conn.end(); }
}
if (require.main === module) run(process.argv.slice(2)).then(r => console.log(JSON.stringify(r))).catch(() => {
    console.error('BILLING_LOCAL_OPERATION_FAILED'); process.exitCode = 1;
});
module.exports = { localOptions, run };
