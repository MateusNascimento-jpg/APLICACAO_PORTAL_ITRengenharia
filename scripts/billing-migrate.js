'use strict';
// Execução manual. Sem argumentos só mostra o plano e não abre conexão.
//   --verificar                    confere tabelas e colunas, somente leitura
//   --aplicar --backup-confirmado  aplica a migration 006 e confere o resultado
const { plan, migrate, verify } = require('../lib/billing/migrate');
async function run(args, open, write = text => process.stdout.write(text + '\n')) {
    const applying = args.includes('--aplicar'), checking = args.includes('--verificar');
    if (applying && !args.includes('--backup-confirmado')) throw new Error('BACKUP_CONFIRMATION_REQUIRED');
    if (!applying && !checking) { write(JSON.stringify({ mode: 'plan', ...plan() }, null, 2)); return 0; }
    const connection = await open();
    try {
        const applied = applying ? await migrate(connection) : null;
        const result = await verify(connection);
        write(JSON.stringify({ mode: applying ? 'apply' : 'verify', applied, ...result }, null, 2));
        return result.ok ? 0 : 2;
    } finally { connection.release(); }
}
if (require.main === module) {
    const args = process.argv.slice(2);
    let pool;
    const open = () => { pool = require('../db'); return pool.getConnection(); };
    run(args, open).then(code => { process.exitCode = code; }).catch(error => {
        console.error(/^[A-Z0-9_]{1,64}$/.test(error.message) ? error.message : 'BILLING_MIGRATION_FAILED');
        process.exitCode = 1;
    }).finally(() => pool?.end());
}
module.exports = { run };
