'use strict';

const pool = require('../db');

async function columnExists(table, column) {
  const [rows] = await pool.query(
    `SELECT COLUMN_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [table, column]
  );
  return rows[0] || null;
}

async function indexExists(table, index) {
  const [rows] = await pool.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, index]
  );
  return rows.length > 0;
}

async function addColumnIfMissing(table, column, definition) {
  if (await columnExists(table, column)) return;
  await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN ${definition}`);
  console.log(`[migration] coluna adicionada: ${table}.${column}`);
}

async function addIndexIfMissing(table, index, definition) {
  if (await indexExists(table, index)) return;
  await pool.query(`ALTER TABLE \`${table}\` ADD ${definition}`);
  console.log(`[migration] índice adicionado: ${table}.${index}`);
}

async function migrate() {
  const conn = await pool.getConnection();
  let lock = false;
  try {
    const [lockRows] = await conn.query("SELECT GET_LOCK('itr_portal_security_v2', 30) AS acquired");
    lock = Number(lockRows[0]?.acquired) === 1;
    if (!lock) throw new Error('Não foi possível obter o lock de migration. Tente novamente em instantes.');

    // Novas tabelas. Todas são aditivas: nenhum dado legado é removido.
    await conn.query(`CREATE TABLE IF NOT EXISTS portal_sessions (
      session_hash CHAR(64) NOT NULL,
      role VARCHAR(32) NOT NULL,
      airtable_client_id VARCHAR(32) NULL,
      documento VARCHAR(32) NULL,
      email VARCHAR(254) NULL,
      nome_empresa VARCHAR(255) NULL,
      remember TINYINT(1) NOT NULL DEFAULT 0,
      csrf_hash CHAR(64) NOT NULL,
      ip_hash CHAR(64) NULL,
      user_agent VARCHAR(255) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      expires_at DATETIME(3) NOT NULL,
      PRIMARY KEY (session_hash),
      KEY idx_portal_sessions_expires (expires_at),
      KEY idx_portal_sessions_role (role)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await conn.query(`CREATE TABLE IF NOT EXISTS portal_director (
      id TINYINT UNSIGNED NOT NULL DEFAULT 1,
      username VARCHAR(64) NOT NULL,
      password_hash CHAR(128) NOT NULL,
      password_salt CHAR(32) NOT NULL,
      totp_secret_enc TEXT NULL,
      totp_pending_enc TEXT NULL,
      mfa_enabled TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      last_login_at DATETIME(3) NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_portal_director_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await conn.query(`CREATE TABLE IF NOT EXISTS portal_director_recovery_codes (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      director_id TINYINT UNSIGNED NOT NULL,
      code_hash CHAR(64) NOT NULL,
      used_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY uq_portal_recovery_hash (code_hash),
      KEY idx_portal_recovery_director (director_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await conn.query(`CREATE TABLE IF NOT EXISTS portal_rate_limits (
      scope VARCHAR(64) NOT NULL,
      key_hash CHAR(64) NOT NULL,
      window_started_at DATETIME(3) NOT NULL,
      attempts INT UNSIGNED NOT NULL DEFAULT 0,
      blocked_until DATETIME(3) NULL,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (scope, key_hash),
      KEY idx_portal_rate_blocked (blocked_until)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    await conn.query(`CREATE TABLE IF NOT EXISTS portal_audit_events (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      event_type VARCHAR(80) NOT NULL,
      actor_type VARCHAR(32) NULL,
      actor_id VARCHAR(128) NULL,
      target_type VARCHAR(64) NULL,
      target_id VARCHAR(128) NULL,
      outcome VARCHAR(32) NOT NULL,
      ip_hash CHAR(64) NULL,
      user_agent VARCHAR(255) NULL,
      metadata_json JSON NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      KEY idx_portal_audit_created (created_at),
      KEY idx_portal_audit_event (event_type, created_at),
      KEY idx_portal_audit_actor (actor_type, actor_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    // Compatibilidade com as tabelas auxiliares já usadas pelo Portal antigo.
    await conn.query(`CREATE TABLE IF NOT EXISTS ultimo_acesso_cliente (
      cnpj VARCHAR(20) NOT NULL,
      airtable_client_id VARCHAR(32) NULL,
      ultimo_acesso DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      primeiro_acesso DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (cnpj)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await addColumnIfMissing('ultimo_acesso_cliente', 'airtable_client_id', '`airtable_client_id` VARCHAR(32) NULL');

    await conn.query(`CREATE TABLE IF NOT EXISTS relatorios_baixados (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      cnpj VARCHAR(20) NULL,
      record_id_trabalho VARCHAR(50) NOT NULL,
      baixado_em DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_cnpj_trabalho (cnpj, record_id_trabalho),
      KEY idx_relatorios_baixados_data (baixado_em)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await addColumnIfMissing('relatorios_baixados', 'cnpj', '`cnpj` VARCHAR(20) NULL');
    const usuarioId = await columnExists('relatorios_baixados', 'usuario_id');
    if (usuarioId && usuarioId.IS_NULLABLE === 'NO') {
      await pool.query(`ALTER TABLE relatorios_baixados MODIFY COLUMN usuario_id ${usuarioId.COLUMN_TYPE} NULL`);
      console.log('[migration] usuario_id tornou-se opcional em relatorios_baixados');
    }
    if (!await indexExists('relatorios_baixados', 'uk_cnpj_trabalho')) {
      const [duplicates] = await pool.query(`
        SELECT 1
        FROM relatorios_baixados
        WHERE cnpj IS NOT NULL
        GROUP BY cnpj, record_id_trabalho
        HAVING COUNT(*) > 1
        LIMIT 1
      `);
      if (duplicates.length === 0) {
        await addIndexIfMissing('relatorios_baixados', 'uk_cnpj_trabalho', 'UNIQUE KEY `uk_cnpj_trabalho` (`cnpj`,`record_id_trabalho`)');
      } else {
        console.warn('[migration] histórico de downloads contém duplicidades antigas; o índice UNIQUE foi preservado como pendência não destrutiva.');
      }
    }
    await addIndexIfMissing('relatorios_baixados', 'idx_relatorios_baixados_data', 'INDEX `idx_relatorios_baixados_data` (`baixado_em`)');

    // MFA foi retirado do produto. Em bancos que passaram pela V2, limpamos apenas
    // segredos temporários/antigos; a estrutura fica para manter a migration não destrutiva.
    try {
      await conn.query('UPDATE portal_director SET mfa_enabled = 0, totp_secret_enc = NULL, totp_pending_enc = NULL WHERE id = 1');
      await conn.query('DELETE FROM portal_director_recovery_codes WHERE director_id = 1');
      await conn.query("DELETE FROM portal_sessions WHERE role IN ('DirectorMfaPending','DirectorSetup')");
    } catch (_) {}
    console.log('[migration] Portal ITR seguro: banco pronto. Nenhum dado operacional foi removido.');
  } finally {
    if (lock) {
      try { await conn.query("SELECT RELEASE_LOCK('itr_portal_security_v2')"); } catch (_) {}
    }
    conn.release();
  }
}

migrate()
  .then(() => pool.end())
  .catch(async error => {
    console.error('[migration] FALHA:', error.message);
    try { await pool.end(); } catch (_) {}
    process.exitCode = 1;
  });
