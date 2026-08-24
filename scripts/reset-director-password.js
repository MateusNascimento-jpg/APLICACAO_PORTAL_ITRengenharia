'use strict';

const readline = require('readline/promises');
const { stdin, stdout } = require('process');
const pool = require('../db');
const { randomPassword, scryptHash } = require('../lib/security-crypto');

async function main() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const resposta = (await rl.question('Gerar uma nova senha para o único Diretor? Digite RESETAR para confirmar: ')).trim();
  rl.close();
  if (resposta !== 'RESETAR') {
    console.log('[director] Operação cancelada.');
    return;
  }

  const password = randomPassword(28);
  const { salt, hash } = await scryptHash(password);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      'UPDATE portal_director SET password_hash = ?, password_salt = ? WHERE id = 1',
      [hash, salt]
    );
    if (result.affectedRows !== 1) throw new Error('Conta do Diretor ainda não foi criada. Rode npm run bootstrap:director.');
    await conn.query(`DELETE FROM portal_sessions WHERE role IN ('Director','DirectorMfaPending','DirectorSetup')`);
    await conn.query(`DELETE FROM portal_rate_limits WHERE scope LIKE 'director-login-%'`);
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }

  console.log('');
  console.log('============================================================');
  console.log(' NOVA CREDENCIAL DO DIRETOR — GUARDE EM LOCAL SEGURO');
  console.log('============================================================');
  console.log(' Usuário: diretor');
  console.log(` Senha: ${password}`);
  console.log('============================================================');
  console.log('');
}

main().then(() => pool.end()).catch(async error => {
  console.error('[director] Falha:', error.message);
  try { await pool.end(); } catch (_) {}
  process.exitCode = 1;
});
