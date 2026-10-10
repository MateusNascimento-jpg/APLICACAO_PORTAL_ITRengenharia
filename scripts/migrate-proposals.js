'use strict';

const fs = require('node:fs');
const path = require('node:path');
const pool = require('../db');

async function main() {
    if (!process.argv.includes('--aplicar'))
        throw new Error('Use --aplicar somente no banco autorizado, após o backup.');
    const connection = await pool.getConnection();
    try {
        const [rows] = await connection.query(
            "SELECT GET_LOCK('itr-proposals-migration', 5) AS acquired",
        );
        if (Number(rows[0].acquired) !== 1) throw new Error('Outra migration está em execução.');
        const sql = fs.readFileSync(
            path.join(__dirname, '../migrations/003_proposals.sql'),
            'utf8',
        );
        for (const statement of sql
            .split(';')
            .map((item) => item.trim())
            .filter(Boolean)) {
            await connection.query(statement);
        }
        console.log('Migration de Propostas concluída. Automação permanece desativada.');
    } finally {
        await connection.query("SELECT RELEASE_LOCK('itr-proposals-migration')").catch(() => {});
        connection.release();
    }
}

main()
    .catch(() => {
        console.error(
            'Migration de Propostas falhou; confira a conexão/permissões e preserve o backup.',
        );
        process.exitCode = 1;
    })
    .finally(() => pool.end());
