-- Additive, idempotent. Never run with production credentials during local work.
-- MySQL 8 / InnoDB. Encrypted data includes recipients; audit contains only codes/IDs.
CREATE TABLE IF NOT EXISTS portal_billing_meta (
    id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    data MEDIUMTEXT NOT NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS portal_billing_states (
    id CHAR(17) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    data MEDIUMTEXT NOT NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS portal_billing_versions (
    id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    invoice_id CHAR(17) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    data MEDIUMTEXT NOT NULL,
    KEY billing_versions_invoice (invoice_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS portal_billing_grants (
    id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    client_id CHAR(17) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    data MEDIUMTEXT NOT NULL,
    KEY billing_grants_client (client_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS portal_billing_documents (
    id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    invoice_id CHAR(17) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    data MEDIUMTEXT NOT NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS portal_billing_outbox (
    id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    invoice_id CHAR(17) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    status VARCHAR(16) NOT NULL,
    next_at BIGINT NOT NULL DEFAULT 0,
    data MEDIUMTEXT NOT NULL,
    KEY billing_outbox_due (status, next_at),
    KEY billing_outbox_invoice (invoice_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS portal_billing_nonces (
    id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    seen_at BIGINT NOT NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS portal_billing_audit (
    seq BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    at_ms BIGINT NOT NULL,
    subject VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    KEY billing_audit_subject (subject, at_ms)
) ENGINE=InnoDB;
