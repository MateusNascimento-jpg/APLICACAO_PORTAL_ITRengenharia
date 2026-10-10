-- Migration exclusiva de Propostas. Não executa a migration legada de segurança.
CREATE TABLE IF NOT EXISTS portal_proposal_state (
    id VARCHAR(32) NOT NULL PRIMARY KEY,
    data JSON NOT NULL,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS portal_proposal_challenges (
    id CHAR(36) NOT NULL PRIMARY KEY,
    token_hash CHAR(64) NOT NULL UNIQUE,
    proposal_id VARCHAR(32) NOT NULL,
    expires_at BIGINT NOT NULL,
    data JSON NOT NULL,
    INDEX idx_proposal_challenge_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS portal_proposal_outbox (
    id CHAR(64) NOT NULL PRIMARY KEY,
    proposal_id VARCHAR(32) NOT NULL,
    priority TINYINT NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    attempts INT NOT NULL DEFAULT 0,
    next_at BIGINT NOT NULL DEFAULT 0,
    payload MEDIUMTEXT NOT NULL,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    INDEX idx_proposal_outbox_due (status, next_at, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS portal_proposal_settings (
    id TINYINT NOT NULL PRIMARY KEY,
    data JSON NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS portal_proposal_nonces (
    id VARCHAR(32) NOT NULL PRIMARY KEY,
    expires_at BIGINT NOT NULL,
    INDEX idx_proposal_nonce_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO portal_proposal_settings (id, data)
VALUES (1, '{"enabled":false,"cutoff":null}');
