-- Comprovantes e PDFs efetivamente aceitos, preservados no MySQL.
-- É necessário configurar max_allowed_packet acima do maior PDF permitido.
-- A tabela não guarda senhas nem tokens de acesso.
CREATE TABLE IF NOT EXISTS portal_proposal_artifacts (
    proposal_id VARCHAR(32) NOT NULL PRIMARY KEY,
    cnpj CHAR(14) NOT NULL,
    version CHAR(64) NOT NULL,
    original_sha256 CHAR(64) NOT NULL,
    comprovante_sha256 CHAR(64) NOT NULL,
    original_name VARCHAR(160) NOT NULL,
    original_pdf MEDIUMBLOB NOT NULL,
    comprovante_pdf MEDIUMBLOB NOT NULL,
    accepted_at BIGINT NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_artifact_cnpj (cnpj)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
