-- Migração segura para bancos já criados do Portal ITR.
-- Rode este arquivo no banco ITRengenhariaLOGIN em vez de rodar o schema completo novamente.
-- Ele NÃO usa DROP DATABASE.

USE ITRengenhariaLOGIN;

DELIMITER $$

DROP PROCEDURE IF EXISTS add_col_if_missing $$
CREATE PROCEDURE add_col_if_missing(
    IN p_table VARCHAR(64),
    IN p_column VARCHAR(64),
    IN p_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table
          AND COLUMN_NAME = p_column
    ) THEN
        SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN ', p_definition);
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END $$

DROP PROCEDURE IF EXISTS add_index_if_missing $$
CREATE PROCEDURE add_index_if_missing(
    IN p_table VARCHAR(64),
    IN p_index VARCHAR(64),
    IN p_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table
          AND INDEX_NAME = p_index
    ) THEN
        SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD ', p_definition);
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END $$

DELIMITER ;

CALL add_col_if_missing('usuarios_cnpj', 'tipo_documento', "`tipo_documento` ENUM('CPF','CNPJ') NULL AFTER `documento`");
CALL add_col_if_missing('usuarios_cnpj', 'nome_empresa', '`nome_empresa` VARCHAR(200) NULL AFTER `senha_hash`');
CALL add_col_if_missing('usuarios_cnpj', 'reset_token', '`reset_token` VARCHAR(255) NULL AFTER `airtable_client_id`');
CALL add_col_if_missing('usuarios_cnpj', 'reset_expires', '`reset_expires` TIMESTAMP NULL AFTER `reset_token`');
CALL add_col_if_missing('usuarios_cnpj', 'ultimo_login', '`ultimo_login` TIMESTAMP NULL AFTER `reset_expires`');
CALL add_col_if_missing('usuarios_cnpj', 'tentativas_login', '`tentativas_login` INT DEFAULT 0 AFTER `ultimo_login`');
CALL add_col_if_missing('usuarios_cnpj', 'bloqueado_ate', '`bloqueado_ate` TIMESTAMP NULL AFTER `tentativas_login`');
CALL add_col_if_missing('usuarios_cnpj', 'data_exclusao', '`data_exclusao` TIMESTAMP NULL AFTER `bloqueado_ate`');
CALL add_col_if_missing('usuarios_cnpj', 'status_conta', "`status_conta` ENUM('Ativo','Inativo','Bloqueado') DEFAULT 'Ativo' AFTER `data_exclusao`");

UPDATE usuarios_cnpj
SET tipo_documento = CASE WHEN CHAR_LENGTH(documento) = 11 THEN 'CPF' ELSE 'CNPJ' END
WHERE tipo_documento IS NULL;

ALTER TABLE usuarios_cnpj
    MODIFY tipo_documento ENUM('CPF','CNPJ') NOT NULL;

CREATE TABLE IF NOT EXISTS relatorios_baixados (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT NOT NULL,
    record_id_trabalho VARCHAR(50) NOT NULL,
    baixado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_usuario_trabalho (usuario_id, record_id_trabalho),
    FOREIGN KEY (usuario_id) REFERENCES usuarios_cnpj(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS historico_logins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT NULL,
    sucesso BOOLEAN NOT NULL,
    ip_origem VARCHAR(45),
    navegador VARCHAR(255),
    motivo_falha VARCHAR(100) NULL,
    data_tentativa TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios_cnpj(id) ON DELETE SET NULL
);

CALL add_index_if_missing('usuarios_cnpj', 'idx_reset_token', 'INDEX `idx_reset_token` (`reset_token`)');
CALL add_index_if_missing('relatorios_baixados', 'idx_baixados_usuario', 'INDEX `idx_baixados_usuario` (`usuario_id`)');
CALL add_index_if_missing('historico_logins', 'idx_historico_usuario', 'INDEX `idx_historico_usuario` (`usuario_id`)');

DROP PROCEDURE IF EXISTS add_col_if_missing;
DROP PROCEDURE IF EXISTS add_index_if_missing;
