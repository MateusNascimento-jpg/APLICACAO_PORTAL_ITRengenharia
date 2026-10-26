-- Estado monotônico de varredura NF; a outbox existente mantém eventos imutáveis.
-- Execute somente após backup e homologação do banco.
CREATE TABLE IF NOT EXISTS portal_nf_notification_state (
    nf_id VARCHAR(32) NOT NULL PRIMARY KEY,
    data JSON NOT NULL,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
