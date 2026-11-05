'use strict';
// Consulta diária, somente leitura. Saída: 0 sem pendências, 2 com pendências, 1 consulta não concluída.
const { buildReport } = require('../lib/billing/report');
async function run(pool, write = text => process.stdout.write(text + '\n'), clock = Date.now) {
    const connection = await pool.getConnection();
    try {
        const report = await buildReport(connection, clock());
        write(JSON.stringify(report, null, 2));
        return report.attention ? 2 : 0;
    } finally { connection.release(); }
}
if (require.main === module) {
    const pool = require('../db');
    run(pool).then(code => { process.exitCode = code; }).catch(() => {
        console.error('BILLING_REPORT_FAILED');
        process.exitCode = 1;
    }).finally(() => pool.end());
}
module.exports = { run };
