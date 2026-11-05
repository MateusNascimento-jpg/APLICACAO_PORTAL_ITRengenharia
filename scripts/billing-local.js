'use strict';
// Explicit laboratory tool. Does not import config.js / db.js / dotenv.
const { migrate } = require('../lib/billing/migrate');
function localOptions(env) {
    const host = env.BILLING_LOCAL_DB_HOST || '127.0.0.1', database = env.BILLING_LOCAL_DB_NAME;
    if (!['127.0.0.1', '::1'].includes(host) || !/^itr_billing_test_[a-z0-9_]+$/.test(database || '') || env.NODE_ENV !== 'test')
        throw new Error('LOCAL_TEST_DATABASE_REQUIRED');
    return { host, database, user: env.BILLING_LOCAL_DB_USER, password: env.BILLING_LOCAL_DB_PASSWORD,
        port: Number(env.BILLING_LOCAL_DB_PORT || 3306), multipleStatements: false };
}
async function run(args, env = process.env) {
    const options = localOptions(env);
    if (args[0] !== 'migrate') throw new Error('USE_MIGRATE');
    const conn = await require('mysql2/promise').createConnection(options);
    try { return await migrate(conn); }
    finally { await conn.end(); }
}
if (require.main === module) run(process.argv.slice(2)).then(r => console.log(JSON.stringify(r))).catch(() => {
    console.error('BILLING_LOCAL_OPERATION_FAILED'); process.exitCode = 1;
});
module.exports = { localOptions, run };
