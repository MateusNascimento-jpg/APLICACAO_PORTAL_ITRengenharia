'use strict';

const pool = require('../db');
const { randomPassword, scryptHash } = require('../lib/security-crypto');

async function main() {
  const [rows] = await pool.query('SELECT id, username FROM portal_director WHERE id = 1 LIMIT 1');
  if (rows[0]) {
    await pool.query("DELETE FROM portal_rate_limits WHERE scope LIKE 'director-login-%'");
    console.log(`[director] Conta administrativa já existe: ${rows[0].username || 'diretor'}.`);
    console.log('[director] A senha existente foi preservada. Use npm run reset:director-password somente quando quiser rotacioná-la.');
    return;
  }

  const username = 'diretor';
  const password = randomPassword(28);
  const { salt, hash } = await scryptHash(password);
  await pool.query(
    'INSERT INTO portal_director (id, username, password_hash, password_salt, mfa_enabled) VALUES (1, ?, ?, ?, 0)',
    [username, hash, salt]
  );
  await pool.query("DELETE FROM portal_rate_limits WHERE scope LIKE 'director-login-%'");

  console.log('');
  console.log('============================================================');
  console.log(' CREDENCIAL INICIAL DO DIRETOR — GUARDE EM LOCAL SEGURO');
  console.log('============================================================');
  console.log(` Usuário: ${username}`);
  console.log(` Senha: ${password}`);
  console.log('');
  console.log(' A senha foi gerada localmente e não é salva em texto puro.');
  console.log('============================================================');
  console.log('');
}

main().then(() => pool.end()).catch(async error => {
  console.error('[director] Não foi possível preparar a credencial:', error.message);
  try { await pool.end(); } catch (_) {}
  process.exitCode = 1;
});
