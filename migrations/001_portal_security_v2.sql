-- Portal ITR v2 — referência do schema de segurança.
-- A execução oficial é feita por `npm run migrate` (scripts/migrate.js),
-- que também adapta de forma idempotente tabelas auxiliares já existentes.
-- Nenhum DROP de tabela ou remoção de dados é executado.

CREATE TABLE IF NOT EXISTS portal_sessions (
  session_hash CHAR(64) PRIMARY KEY,
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
  KEY idx_portal_sessions_expires (expires_at),
  KEY idx_portal_sessions_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portal_director (
  id TINYINT UNSIGNED PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash CHAR(128) NOT NULL,
  password_salt CHAR(32) NOT NULL,
  totp_secret_enc TEXT NULL,
  totp_pending_enc TEXT NULL,
  mfa_enabled TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  last_login_at DATETIME(3) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portal_director_recovery_codes (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  director_id TINYINT UNSIGNED NOT NULL,
  code_hash CHAR(64) NOT NULL UNIQUE,
  used_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_portal_recovery_director (director_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portal_rate_limits (
  scope VARCHAR(64) NOT NULL,
  key_hash CHAR(64) NOT NULL,
  window_started_at DATETIME(3) NOT NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  blocked_until DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (scope,key_hash),
  KEY idx_portal_rate_blocked (blocked_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portal_audit_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
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
  KEY idx_portal_audit_created (created_at),
  KEY idx_portal_audit_event (event_type,created_at),
  KEY idx_portal_audit_actor (actor_type,actor_id,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
