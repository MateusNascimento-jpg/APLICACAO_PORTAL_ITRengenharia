'use strict';

const pool = require('../db');
const { randomPassword, scryptHash } = require('../lib/security-crypto');

async function main() {
  const username = 'diretor';
  const password = randomPassword(28);
  const { salt, hash } = await scryptHash(password);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT id FROM portal_director WHERE id = 1 LIMIT 1');
    if (rows[0]) {
      await conn.query('UPDATE portal_director SET username = ?, password_hash = ?, password_salt = ?, mfa_enabled = 0, totp_secret_enc = NULL, totp_pending_enc = NULL WHERE id = 1', [username, hash, salt]);
    } else {
      await conn.query('INSERT INTO portal_director (id, username, password_hash, password_salt, mfa_enabled) VALUES (1, ?, ?, ?, 0)', [username, hash, salt]);
    }
    // A nova credencial invalida qualquer sessão administrativa anterior.
    await conn.query("DELETE FROM portal_sessions WHERE role IN ('Director','DirectorMfaPending','DirectorSetup')");
    try { await conn.query('DELETE FROM portal_director_recovery_codes WHERE director_id = 1'); } catch (_) {}
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally { conn.release(); }

  await pool.query(`DELETE FROM portal_rate_limits WHERE scope LIKE 'director-login-%'`);

  console.log('');
  console.log('============================================================');
  console.log(' CREDENCIAL DO DIRETOR — GUARDE EM LOCAL SEGURO');
  console.log('============================================================');
  console.log(` Usuário: ${username}`);
  console.log(` Senha: ${password}`);
  console.log('');
  console.log(' A senha foi gerada localmente e não é salva em texto puro.');
  console.log(' Uma credencial administrativa anterior foi invalidada.');
  console.log('============================================================');
  console.log('');
}

main().then(() => pool.end()).catch(async error => {
  console.error('[director] Não foi possível preparar a credencial:', error.message);
  try { await pool.end(); } catch (_) {}
  process.exitCode = 1;
});
