'use strict';

const pool = require('../db');

async function main() {
  const [before] = await pool.query(
    `SELECT scope, attempts, blocked_until
     FROM portal_rate_limits
     WHERE scope LIKE 'director-login-%'
     ORDER BY scope`
  );

  const [result] = await pool.query(
    `DELETE FROM portal_rate_limits WHERE scope LIKE 'director-login-%'`
  );

  const [after] = await pool.query(
    `SELECT scope, attempts, blocked_until
     FROM portal_rate_limits
     WHERE scope LIKE 'director-login-%'
     ORDER BY scope`
  );

  console.log(`[director] Bloqueios administrativos removidos: ${result.affectedRows}`);
  console.log(`[director] Registros antes: ${before.length}; depois: ${after.length}`);
  if (after.length !== 0) throw new Error('Ainda existem bloqueios administrativos após a limpeza.');
}

main()
  .then(() => pool.end())
  .catch(async error => {
    console.error('[director] Falha ao liberar acesso:', error.message);
    try { await pool.end(); } catch (_) {}
    process.exitCode = 1;
  });
