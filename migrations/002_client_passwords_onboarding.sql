-- Portal ITR 3.1.0 — contas de clientes, tokens de uso único e onboarding.
-- Migration aditiva: não remove nem altera dados operacionais do Airtable.

CREATE TABLE IF NOT EXISTS portal_client_accounts (
  airtable_client_id VARCHAR(32) NOT NULL PRIMARY KEY,
  password_hash CHAR(128) NOT NULL,
  password_salt CHAR(32) NOT NULL,
  password_created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  password_changed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  onboarding_version INT UNSIGNED NOT NULL DEFAULT 0,
  onboarding_completed_at DATETIME(3) NULL,
  onboarding_dismissed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  last_login_at DATETIME(3) NULL,
  KEY idx_portal_client_accounts_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portal_password_tokens (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  airtable_client_id VARCHAR(32) NOT NULL,
  purpose VARCHAR(16) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  used_at DATETIME(3) NULL,
  requested_ip_hash CHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_portal_password_tokens_client (airtable_client_id, created_at),
  KEY idx_portal_password_tokens_expiry (expires_at, used_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
