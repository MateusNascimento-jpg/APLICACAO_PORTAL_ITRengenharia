-- ATENÇÃO: este arquivo recria o banco do zero e contém DROP DATABASE.
-- Use apenas em ambiente novo/limpo. Para banco já existente, use migrations/001_corrigir_portal_itr.sql.

DROP DATABASE IF EXISTS ITRengenhariaLOGIN;
CREATE DATABASE ITRengenhariaLOGIN;
USE ITRengenhariaLOGIN;

-- PARTE 1: TABELA PRINCIPAL DE USUÁRIOS
CREATE TABLE usuarios_cnpj (
    id                 INT AUTO_INCREMENT PRIMARY KEY,
    documento          VARCHAR(14) NOT NULL,
    tipo_documento     ENUM('CPF', 'CNPJ') NOT NULL,
    email              VARCHAR(150) NULL,
    senha_hash         VARCHAR(255) NOT NULL,
    nome_empresa       VARCHAR(200) NULL,
    perfil             ENUM('Cliente', 'Funcionario', 'Gerente_TI', 'Diretor') DEFAULT 'Cliente',
    airtable_client_id VARCHAR(50) NULL,
    reset_token        VARCHAR(255) NULL,
    reset_expires      TIMESTAMP NULL,
    ultimo_login       TIMESTAMP NULL,
    tentativas_login   INT DEFAULT 0,
    bloqueado_ate      TIMESTAMP NULL,
    data_exclusao      TIMESTAMP NULL,
    status_conta       ENUM('Ativo', 'Inativo', 'Bloqueado') DEFAULT 'Ativo',
    data_cadastro      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ultima_atualizacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_documento (documento),
    UNIQUE KEY uk_email (email)
);

CREATE INDEX idx_usuarios_documento  ON usuarios_cnpj(documento);
CREATE INDEX idx_usuarios_email      ON usuarios_cnpj(email);
CREATE INDEX idx_usuarios_perfil     ON usuarios_cnpj(perfil);
CREATE INDEX idx_reset_token         ON usuarios_cnpj(reset_token);

-- PARTE 2: PERMISSÕES POR PERFIL
CREATE TABLE permissoes_perfil (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    perfil       ENUM('Cliente', 'Funcionario', 'Gerente_TI', 'Diretor') NOT NULL,
    pode_ler     BOOLEAN DEFAULT FALSE,
    pode_criar   BOOLEAN DEFAULT FALSE,
    pode_editar  BOOLEAN DEFAULT FALSE,
    pode_excluir BOOLEAN DEFAULT FALSE,
    descricao    VARCHAR(255),
    UNIQUE KEY uk_perfil (perfil)
);

INSERT INTO permissoes_perfil (perfil, pode_ler, pode_criar, pode_editar, pode_excluir, descricao) VALUES
('Cliente',     TRUE,  FALSE, FALSE, FALSE, 'Visualiza apenas seus próprios relatórios'),
('Funcionario', TRUE,  TRUE,  TRUE,  FALSE, 'Pode ler, criar e editar — não pode excluir'),
('Gerente_TI',  TRUE,  TRUE,  TRUE,  TRUE,  'Acesso total ao sistema'),
('Diretor',     TRUE,  TRUE,  TRUE,  TRUE,  'Acesso total ao sistema');

-- PARTE 3: AUDITORIA
CREATE TABLE auditoria_usuarios (
    `ID da Auditoria`     INT AUTO_INCREMENT PRIMARY KEY,
    `ID do Usuário`       INT,
    `Documento Afetado`   VARCHAR(14),
    `Tipo Documento`      VARCHAR(10),
    `Perfil do Usuário`   VARCHAR(50),
    `Ação Realizada`      VARCHAR(100),
    `Operador do Sistema` VARCHAR(100),
    `Data e Hora da Ação` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- PARTE 4: SESSÕES ATIVAS
CREATE TABLE sessoes_ativas (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id      INT NOT NULL,
    token_sessao    VARCHAR(255) NOT NULL UNIQUE,
    ip_origem       VARCHAR(45),
    navegador       VARCHAR(255),
    criada_em       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expira_em       TIMESTAMP NOT NULL,
    revogada        BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (usuario_id) REFERENCES usuarios_cnpj(id) ON DELETE CASCADE
);

CREATE INDEX idx_sessao_token   ON sessoes_ativas(token_sessao);
CREATE INDEX idx_sessao_usuario ON sessoes_ativas(usuario_id);

-- PARTE 5: HISTÓRICO DE LOGINS
CREATE TABLE historico_logins (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id      INT NULL,
    sucesso         BOOLEAN NOT NULL,
    ip_origem       VARCHAR(45),
    navegador       VARCHAR(255),
    motivo_falha    VARCHAR(100) NULL,
    data_tentativa  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios_cnpj(id) ON DELETE SET NULL
);

CREATE INDEX idx_historico_usuario ON historico_logins(usuario_id);
CREATE INDEX idx_historico_data    ON historico_logins(data_tentativa);

-- PARTE 6: FUNÇÃO VALIDAR CPF
DELIMITER $$
CREATE FUNCTION fn_validar_cpf(p_cpf VARCHAR(11))
RETURNS BOOLEAN DETERMINISTIC
BEGIN
    DECLARE i INT DEFAULT 1; DECLARE soma INT DEFAULT 0;
    DECLARE digito1 INT DEFAULT 0; DECLARE digito2 INT DEFAULT 0; DECLARE resto INT DEFAULT 0;
    IF LENGTH(p_cpf) <> 11 THEN RETURN FALSE; END IF;
    IF p_cpf REGEXP '^([0-9])\\1{10}$' THEN RETURN FALSE; END IF;
    WHILE i <= 9 DO SET soma = soma + (CAST(SUBSTRING(p_cpf,i,1) AS UNSIGNED) * (11-i)); SET i=i+1; END WHILE;
    SET resto=soma%11; SET digito1=IF(resto<2,0,11-resto);
    IF digito1 <> CAST(SUBSTRING(p_cpf,10,1) AS UNSIGNED) THEN RETURN FALSE; END IF;
    SET soma=0; SET i=1;
    WHILE i <= 10 DO SET soma=soma+(CAST(SUBSTRING(p_cpf,i,1) AS UNSIGNED)*(12-i)); SET i=i+1; END WHILE;
    SET resto=soma%11; SET digito2=IF(resto<2,0,11-resto);
    IF digito2 <> CAST(SUBSTRING(p_cpf,11,1) AS UNSIGNED) THEN RETURN FALSE; END IF;
    RETURN TRUE;
END $$
DELIMITER ;

-- PARTE 7: FUNÇÃO VALIDAR CNPJ
DELIMITER $$
CREATE FUNCTION fn_validar_cnpj(p_cnpj VARCHAR(14))
RETURNS BOOLEAN DETERMINISTIC
BEGIN
    DECLARE i INT DEFAULT 1; DECLARE soma INT DEFAULT 0; DECLARE peso INT DEFAULT 5;
    DECLARE digito1 INT DEFAULT 0; DECLARE digito2 INT DEFAULT 0; DECLARE resto INT DEFAULT 0;
    IF LENGTH(p_cnpj) <> 14 THEN RETURN FALSE; END IF;
    IF p_cnpj REGEXP '^([0-9])\\1{13}$' THEN RETURN FALSE; END IF;
    WHILE i <= 12 DO SET soma=soma+(CAST(SUBSTRING(p_cnpj,i,1) AS UNSIGNED)*peso); SET peso=IF(peso=2,9,peso-1); SET i=i+1; END WHILE;
    SET resto=soma%11; SET digito1=IF(resto<2,0,11-resto);
    IF digito1 <> CAST(SUBSTRING(p_cnpj,13,1) AS UNSIGNED) THEN RETURN FALSE; END IF;
    SET soma=0; SET peso=6; SET i=1;
    WHILE i <= 13 DO SET soma=soma+(CAST(SUBSTRING(p_cnpj,i,1) AS UNSIGNED)*peso); SET peso=IF(peso=2,9,peso-1); SET i=i+1; END WHILE;
    SET resto=soma%11; SET digito2=IF(resto<2,0,11-resto);
    IF digito2 <> CAST(SUBSTRING(p_cnpj,14,1) AS UNSIGNED) THEN RETURN FALSE; END IF;
    RETURN TRUE;
END $$
DELIMITER ;

-- PARTE 8: PROCEDURES DE CADASTRO
DELIMITER $$
DROP PROCEDURE IF EXISTS procedure_cadastrar_usuario_cnpj $$
CREATE PROCEDURE procedure_cadastrar_usuario_cnpj(
    IN p_documento VARCHAR(20), IN p_tipo_documento VARCHAR(10),
    IN p_email VARCHAR(100), IN p_senha VARCHAR(255),
    IN p_nome_empresa VARCHAR(150), IN p_perfil VARCHAR(50),
    IN p_airtable_client_id VARCHAR(100), IN p_operador VARCHAR(50))
BEGIN
    DECLARE EXIT HANDLER FOR 1062 BEGIN ROLLBACK; SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ERRO: Este CPF/CNPJ ou E-mail já encontra-se cadastrado no sistema.'; END;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
    START TRANSACTION;
    INSERT INTO usuarios_cnpj (documento,tipo_documento,email,senha_hash,nome_empresa,perfil,airtable_client_id)
    VALUES (p_documento,p_tipo_documento,p_email,p_senha,p_nome_empresa,p_perfil,p_airtable_client_id);
    COMMIT;
END $$

DROP PROCEDURE IF EXISTS procedure_cadastrar_usuario $$
CREATE PROCEDURE procedure_cadastrar_usuario(
    IN p_documento VARCHAR(20), IN p_tipo_documento VARCHAR(10),
    IN p_email VARCHAR(100), IN p_senha VARCHAR(255),
    IN p_nome_empresa VARCHAR(150), IN p_perfil VARCHAR(50),
    IN p_airtable_client_id VARCHAR(100), IN p_operador VARCHAR(50))
BEGIN
    DECLARE EXIT HANDLER FOR 1062 BEGIN ROLLBACK; SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ERRO: Este CPF/CNPJ ou E-mail já encontra-se cadastrado no sistema.'; END;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN DECLARE msg_erro VARCHAR(255); GET DIAGNOSTICS CONDITION 1 msg_erro = MESSAGE_TEXT; ROLLBACK; SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = msg_erro; END;
    START TRANSACTION;
    INSERT INTO usuarios_cnpj (documento,tipo_documento,email,senha_hash,nome_empresa,perfil,airtable_client_id)
    VALUES (p_documento,p_tipo_documento,p_email,p_senha,p_nome_empresa,p_perfil,p_airtable_client_id);
    COMMIT;
END $$
DELIMITER ;

-- PARTE 11: SOFT DELETE
DELIMITER $$
CREATE PROCEDURE procedure_soft_delete_usuario(IN p_documento VARCHAR(14), IN p_operador VARCHAR(100))
BEGIN
    SET @usuario_sessao = p_operador;
    UPDATE usuarios_cnpj SET data_exclusao=CURRENT_TIMESTAMP, status_conta='Inativo' WHERE documento=p_documento AND data_exclusao IS NULL;
    UPDATE sessoes_ativas SET revogada=TRUE WHERE usuario_id=(SELECT id FROM usuarios_cnpj WHERE documento=p_documento);
END $$
DELIMITER ;

-- PARTE 12: TRIGGERS
DROP TRIGGER IF EXISTS tg_auditoria_inserir;
DROP TRIGGER IF EXISTS tg_auditoria_atualizar;
DROP TRIGGER IF EXISTS tg_auditoria_excluir;

DELIMITER $$
CREATE TRIGGER tg_auditoria_inserir AFTER INSERT ON usuarios_cnpj FOR EACH ROW
BEGIN
    IF NEW.tipo_documento = 'CNPJ' THEN
        INSERT INTO auditoria_usuarios (`ID do Usuário`,`Documento Afetado`,`Tipo Documento`,`Perfil do Usuário`,`Ação Realizada`,`Operador do Sistema`)
        VALUES (NEW.id,NEW.documento,NEW.tipo_documento,NEW.perfil,'CADASTRO DE USUÁRIO',COALESCE(@usuario_sessao,USER()));
    END IF;
END$$

CREATE TRIGGER tg_auditoria_atualizar AFTER UPDATE ON usuarios_cnpj FOR EACH ROW
BEGIN
    IF NEW.tipo_documento = 'CNPJ' THEN
        INSERT INTO auditoria_usuarios (`ID do Usuário`,`Documento Afetado`,`Tipo Documento`,`Perfil do Usuário`,`Ação Realizada`,`Operador do Sistema`)
        VALUES (NEW.id,NEW.documento,NEW.tipo_documento,NEW.perfil,
            CASE
                WHEN OLD.data_exclusao IS NULL AND NEW.data_exclusao IS NOT NULL THEN 'SOFT DELETE - CONTA MARCADA COMO EXCLUÍDA'
                WHEN OLD.status_conta <> NEW.status_conta THEN CONCAT('STATUS: ',OLD.status_conta,' -> ',NEW.status_conta)
                WHEN OLD.perfil <> NEW.perfil THEN CONCAT('PERFIL: ',OLD.perfil,' -> ',NEW.perfil)
                WHEN COALESCE(OLD.airtable_client_id,'') <> COALESCE(NEW.airtable_client_id,'') THEN 'VÍNCULO AIRTABLE ATUALIZADO'
                WHEN NEW.bloqueado_ate IS NOT NULL AND OLD.bloqueado_ate IS NULL THEN 'CONTA BLOQUEADA POR EXCESSO DE TENTATIVAS'
                ELSE 'ATUALIZAÇÃO DE DADOS'
            END,
            COALESCE(@usuario_sessao,USER()));
    END IF;
END$$

CREATE TRIGGER tg_auditoria_excluir AFTER DELETE ON usuarios_cnpj FOR EACH ROW
BEGIN
    IF OLD.tipo_documento = 'CNPJ' THEN
        INSERT INTO auditoria_usuarios (`ID do Usuário`,`Documento Afetado`,`Tipo Documento`,`Perfil do Usuário`,`Ação Realizada`,`Operador do Sistema`)
        VALUES (OLD.id,OLD.documento,OLD.tipo_documento,OLD.perfil,'EXCLUSÃO DEFINITIVA DA CONTA',COALESCE(@usuario_sessao,USER()));
    END IF;
END$$
DELIMITER ;

USE ITRengenhariaLOGIN;

CREATE TABLE relatorios_baixados (
    id                   INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id           INT NOT NULL,
    record_id_trabalho   VARCHAR(50) NOT NULL,
    baixado_em           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_usuario_trabalho (usuario_id, record_id_trabalho),
    FOREIGN KEY (usuario_id) REFERENCES usuarios_cnpj(id) ON DELETE CASCADE
);

CREATE INDEX idx_baixados_usuario ON relatorios_baixados(usuario_id);


-- PARTE 14: PROCEDURES DE LIMPEZA
DELIMITER $$
CREATE PROCEDURE procedure_limpar_sessoes_expiradas() BEGIN DELETE FROM sessoes_ativas WHERE expira_em < NOW() OR (revogada=TRUE AND criada_em < DATE_SUB(NOW(),INTERVAL 30 DAY)); END $$
CREATE PROCEDURE procedure_limpar_historico_antigo() BEGIN DELETE FROM historico_logins WHERE data_tentativa < DATE_SUB(NOW(),INTERVAL 3 MONTH); END $$
CREATE PROCEDURE procedure_limpar_auditoria_antiga() BEGIN DELETE FROM auditoria_usuarios WHERE `Data e Hora da Ação` < DATE_SUB(NOW(),INTERVAL 6 MONTH); END $$
CREATE PROCEDURE procedure_limpar_tokens_reset() BEGIN UPDATE usuarios_cnpj SET reset_token=NULL,reset_expires=NULL WHERE reset_expires IS NOT NULL AND reset_expires < NOW(); END $$
DELIMITER ;

-- PARTE 15: EVENTOS AGENDADOS
SET GLOBAL event_scheduler = ON;

DROP EVENT IF EXISTS evento_limpar_sessoes;
CREATE EVENT evento_limpar_sessoes ON SCHEDULE EVERY 1 HOUR DO CALL procedure_limpar_sessoes_expiradas();

DROP EVENT IF EXISTS evento_limpar_historico;
CREATE EVENT evento_limpar_historico ON SCHEDULE EVERY 1 DAY STARTS (TIMESTAMP(CURRENT_DATE) + INTERVAL 27 HOUR) DO CALL procedure_limpar_historico_antigo();

DROP EVENT IF EXISTS evento_limpar_auditoria;
CREATE EVENT evento_limpar_auditoria ON SCHEDULE EVERY 1 DAY STARTS (TIMESTAMP(CURRENT_DATE) + INTERVAL 27 HOUR) DO CALL procedure_limpar_auditoria_antiga();

DROP EVENT IF EXISTS evento_limpar_tokens;
CREATE EVENT evento_limpar_tokens ON SCHEDULE EVERY 30 MINUTE DO CALL procedure_limpar_tokens_reset();



USE ITRengenhariaLOGIN;

-- Tabela de ultimo acesso por cliente (chave = CNPJ limpo, 14 digitos).
-- Gravada a cada login bem-sucedido. Usada para exibir "ultimo acesso" no
-- portal (aba Minha conta) sem depender do cadastro antigo de usuarios.
CREATE TABLE IF NOT EXISTS ultimo_acesso_cliente (
    cnpj               VARCHAR(14)  NOT NULL,
    airtable_client_id VARCHAR(32)  DEFAULT NULL,
    ultimo_acesso      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    primeiro_acesso    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (cnpj)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Observacao: o INSERT do login usa
--   ON DUPLICATE KEY UPDATE ultimo_acesso = NOW()
-- entao "primeiro_acesso" fica com a data da 1a vez e "ultimo_acesso" atualiza
-- a cada entrada. Se a tabela nao existir, o login ignora o erro e segue
-- normalmente (o registro de ultimo acesso e best-effort, nao bloqueia login).


-- ----------------------------------------------------------------------------
-- TRACKING DE DOWNLOAD por CNPJ (antes era por usuario_id do MySQL)
-- ----------------------------------------------------------------------------
-- No login novo nao existe mais usuario no MySQL, entao o tracking de download
-- (tabela relatorios_baixados) nao pode mais usar usuario_id + FK. Passamos a
-- rastrear por CNPJ. Esta secao adiciona a coluna cnpj de forma idempotente e
-- cria a UNIQUE por (cnpj, record_id_trabalho) para manter o "baixou ou nao".
-- A coluna usuario_id antiga fica (nullable) para nao perder o historico.

-- 1) Torna usuario_id opcional (para novos registros sem MySQL) e remove a FK
--    que exigia usuario existente. (Se a FK ja nao existir, ignore o erro.)
DELIMITER $$
DROP PROCEDURE IF EXISTS _ajustar_baixados $$
CREATE PROCEDURE _ajustar_baixados()
BEGIN
    -- adiciona coluna cnpj se faltar
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'relatorios_baixados'
                   AND COLUMN_NAME = 'cnpj') THEN
        ALTER TABLE relatorios_baixados ADD COLUMN cnpj VARCHAR(14) DEFAULT NULL AFTER usuario_id;
    END IF;

    -- torna usuario_id nullable (novos downloads nao tem usuario no MySQL)
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'relatorios_baixados'
               AND COLUMN_NAME = 'usuario_id' AND IS_NULLABLE = 'NO') THEN
        ALTER TABLE relatorios_baixados MODIFY usuario_id INT NULL;
    END IF;

    -- remove a FK antiga (usuario_id -> usuarios_cnpj), se existir, para o
    -- tracking nao depender mais da tabela de usuarios. Busca o nome real da
    -- constraint (pode variar) e faz o DROP dinamico.
    SET @fk := (SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'relatorios_baixados'
                AND COLUMN_NAME = 'usuario_id' AND REFERENCED_TABLE_NAME IS NOT NULL
                LIMIT 1);
    IF @fk IS NOT NULL THEN
        SET @sql := CONCAT('ALTER TABLE relatorios_baixados DROP FOREIGN KEY `', @fk, '`');
        PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
    END IF;

    -- cria UNIQUE por (cnpj, record) se faltar, garantindo "baixou ou nao"
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'relatorios_baixados'
                   AND INDEX_NAME = 'uk_cnpj_trabalho') THEN
        ALTER TABLE relatorios_baixados ADD UNIQUE KEY uk_cnpj_trabalho (cnpj, record_id_trabalho);
    END IF;
END $$
CALL _ajustar_baixados() $$
DROP PROCEDURE IF EXISTS _ajustar_baixados $$
DELIMITER ;

-- Consulta util para o chefe ver quem baixou (via phpMyAdmin):
--   SELECT cnpj, record_id_trabalho, baixado_em FROM relatorios_baixados ORDER BY baixado_em DESC;


-- ----------------------------------------------------------------------------
-- HISTORICO DE LOGINS: adicionar coluna cnpj_tentado
-- ----------------------------------------------------------------------------
-- O login novo registra o CNPJ tentado (nao ha mais usuario_id do MySQL).
-- Adiciona a coluna de forma idempotente; a coluna usuario_id antiga (se
-- existir) fica intacta para nao perder historico.
DELIMITER $$
DROP PROCEDURE IF EXISTS _ajustar_historico $$
CREATE PROCEDURE _ajustar_historico()
BEGIN
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'historico_logins'
                   AND COLUMN_NAME = 'cnpj_tentado') THEN
        ALTER TABLE historico_logins ADD COLUMN cnpj_tentado VARCHAR(14) NULL AFTER id;
        ALTER TABLE historico_logins ADD INDEX idx_historico_cnpj (cnpj_tentado);
    END IF;
    -- se usuario_id existir e for NOT NULL com FK, torna nullable para nao travar
    -- inserts do login novo (que nao tem usuario_id).
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'historico_logins'
               AND COLUMN_NAME = 'usuario_id' AND IS_NULLABLE = 'NO') THEN
        ALTER TABLE historico_logins MODIFY usuario_id INT NULL;
    END IF;
END $$
CALL _ajustar_historico() $$
DROP PROCEDURE IF EXISTS _ajustar_historico $$
DELIMITER ;


-- ----------------------------------------------------------------------------
-- FEEDBACK / REPORTAR PROBLEMA (nova tabela, escopo do portal)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback_clientes (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    cnpj        VARCHAR(14)  NULL,
    categoria   ENUM('Bug', 'Sugestao', 'Duvida') NOT NULL DEFAULT 'Duvida',
    mensagem    TEXT         NOT NULL,
    url_pagina  VARCHAR(255) NULL,
    status      ENUM('Novo', 'Lido', 'Resolvido') NOT NULL DEFAULT 'Novo',
    criado_em   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;



-- ============================================================================
-- Migration 002 - Login novo (CNPJ + e-mail do Airtable)
-- ----------------------------------------------------------------------------
-- O login deixou de usar senha/MySQL para autenticar. Agora o cliente entra
-- com CNPJ + primeiro e-mail cadastrado no Airtable. O MySQL continua util
-- para: (1) tracking de download (tabela relatorios_baixados, ja existe) e
-- (2) registrar o ULTIMO ACESSO de cada cliente (esta tabela nova).
--
-- Rode este arquivo no banco de login do Portal ITR. Ele e idempotente:
-- so cria a tabela se ainda nao existir. NAO apaga nada.
-- ============================================================================

USE ITRengenhariaLOGIN;

-- Tabela de ultimo acesso por cliente (chave = CNPJ limpo, 14 digitos).
-- Gravada a cada login bem-sucedido. Usada para exibir "ultimo acesso" no
-- portal (aba Minha conta) sem depender do cadastro antigo de usuarios.
CREATE TABLE IF NOT EXISTS ultimo_acesso_cliente (
    cnpj               VARCHAR(14)  NOT NULL,
    airtable_client_id VARCHAR(32)  DEFAULT NULL,
    ultimo_acesso      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    primeiro_acesso    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (cnpj)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Observacao: o INSERT do login usa
--   ON DUPLICATE KEY UPDATE ultimo_acesso = NOW()
-- entao "primeiro_acesso" fica com a data da 1a vez e "ultimo_acesso" atualiza
-- a cada entrada. Se a tabela nao existir, o login ignora o erro e segue
-- normalmente (o registro de ultimo acesso e best-effort, nao bloqueia login).


-- ----------------------------------------------------------------------------
-- TRACKING DE DOWNLOAD por CNPJ (antes era por usuario_id do MySQL)
-- ----------------------------------------------------------------------------
-- No login novo nao existe mais usuario no MySQL, entao o tracking de download
-- (tabela relatorios_baixados) nao pode mais usar usuario_id + FK. Passamos a
-- rastrear por CNPJ. Esta secao adiciona a coluna cnpj de forma idempotente e
-- cria a UNIQUE por (cnpj, record_id_trabalho) para manter o "baixou ou nao".
-- A coluna usuario_id antiga fica (nullable) para nao perder o historico.

-- 1) Torna usuario_id opcional (para novos registros sem MySQL) e remove a FK
--    que exigia usuario existente. (Se a FK ja nao existir, ignore o erro.)
DELIMITER $$
DROP PROCEDURE IF EXISTS _ajustar_baixados $$
CREATE PROCEDURE _ajustar_baixados()
BEGIN
    -- adiciona coluna cnpj se faltar
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'relatorios_baixados'
                   AND COLUMN_NAME = 'cnpj') THEN
        ALTER TABLE relatorios_baixados ADD COLUMN cnpj VARCHAR(14) DEFAULT NULL AFTER usuario_id;
    END IF;

    -- torna usuario_id nullable (novos downloads nao tem usuario no MySQL)
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'relatorios_baixados'
               AND COLUMN_NAME = 'usuario_id' AND IS_NULLABLE = 'NO') THEN
        ALTER TABLE relatorios_baixados MODIFY usuario_id INT NULL;
    END IF;

    -- remove a FK antiga (usuario_id -> usuarios_cnpj), se existir, para o
    -- tracking nao depender mais da tabela de usuarios. Busca o nome real da
    -- constraint (pode variar) e faz o DROP dinamico.
    SET @fk := (SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'relatorios_baixados'
                AND COLUMN_NAME = 'usuario_id' AND REFERENCED_TABLE_NAME IS NOT NULL
                LIMIT 1);
    IF @fk IS NOT NULL THEN
        SET @sql := CONCAT('ALTER TABLE relatorios_baixados DROP FOREIGN KEY `', @fk, '`');
        PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
    END IF;

    -- cria UNIQUE por (cnpj, record) se faltar, garantindo "baixou ou nao"
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'relatorios_baixados'
                   AND INDEX_NAME = 'uk_cnpj_trabalho') THEN
        ALTER TABLE relatorios_baixados ADD UNIQUE KEY uk_cnpj_trabalho (cnpj, record_id_trabalho);
    END IF;
END $$
CALL _ajustar_baixados() $$
DROP PROCEDURE IF EXISTS _ajustar_baixados $$
DELIMITER ;

-- Consulta util para o chefe ver quem baixou (via phpMyAdmin):
--   SELECT cnpj, record_id_trabalho, baixado_em FROM relatorios_baixados ORDER BY baixado_em DESC;


-- ----------------------------------------------------------------------------
-- HISTORICO DE LOGINS: adicionar coluna cnpj_tentado
-- ----------------------------------------------------------------------------
-- O login novo registra o CNPJ tentado (nao ha mais usuario_id do MySQL).
-- Adiciona a coluna de forma idempotente; a coluna usuario_id antiga (se
-- existir) fica intacta para nao perder historico.
DELIMITER $$
DROP PROCEDURE IF EXISTS _ajustar_historico $$
CREATE PROCEDURE _ajustar_historico()
BEGIN
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'historico_logins'
                   AND COLUMN_NAME = 'cnpj_tentado') THEN
        ALTER TABLE historico_logins ADD COLUMN cnpj_tentado VARCHAR(14) NULL AFTER id;
        ALTER TABLE historico_logins ADD INDEX idx_historico_cnpj (cnpj_tentado);
    END IF;
    -- se usuario_id existir e for NOT NULL com FK, torna nullable para nao travar
    -- inserts do login novo (que nao tem usuario_id).
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'historico_logins'
               AND COLUMN_NAME = 'usuario_id' AND IS_NULLABLE = 'NO') THEN
        ALTER TABLE historico_logins MODIFY usuario_id INT NULL;
    END IF;
END $$
CALL _ajustar_historico() $$
DROP PROCEDURE IF EXISTS _ajustar_historico $$
DELIMITER ;


-- ----------------------------------------------------------------------------
-- FEEDBACK / REPORTAR PROBLEMA (nova tabela, escopo do portal)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback_clientes (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    cnpj        VARCHAR(14)  NULL,
    categoria   ENUM('Bug', 'Sugestao', 'Duvida') NOT NULL DEFAULT 'Duvida',
    mensagem    TEXT         NOT NULL,
    url_pagina  VARCHAR(255) NULL,
    status      ENUM('Novo', 'Lido', 'Resolvido') NOT NULL DEFAULT 'Novo',
    criado_em   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================================
-- Migration 002 - Login novo (CNPJ + e-mail do Airtable)
-- ----------------------------------------------------------------------------
-- O login deixou de usar senha/MySQL para autenticar. Agora o cliente entra
-- com CNPJ + primeiro e-mail cadastrado no Airtable. O MySQL continua util
-- para: (1) tracking de download (tabela relatorios_baixados, ja existe) e
-- (2) registrar o ULTIMO ACESSO de cada cliente (esta tabela nova).
--
-- Rode este arquivo no banco de login do Portal ITR. Ele e idempotente:
-- so cria a tabela se ainda nao existir. NAO apaga nada.
-- ============================================================================

USE ITRengenhariaLOGIN;

-- Tabela de ultimo acesso por cliente (chave = CNPJ limpo, 14 digitos).
-- Gravada a cada login bem-sucedido. Usada para exibir "ultimo acesso" no
-- portal (aba Minha conta) sem depender do cadastro antigo de usuarios.
CREATE TABLE IF NOT EXISTS ultimo_acesso_cliente (
    cnpj               VARCHAR(14)  NOT NULL,
    airtable_client_id VARCHAR(32)  DEFAULT NULL,
    ultimo_acesso      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    primeiro_acesso    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (cnpj)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Observacao: o INSERT do login usa
--   ON DUPLICATE KEY UPDATE ultimo_acesso = NOW()
-- entao "primeiro_acesso" fica com a data da 1a vez e "ultimo_acesso" atualiza
-- a cada entrada. Se a tabela nao existir, o login ignora o erro e segue
-- normalmente (o registro de ultimo acesso e best-effort, nao bloqueia login).


-- ----------------------------------------------------------------------------
-- TRACKING DE DOWNLOAD por CNPJ (antes era por usuario_id do MySQL)
-- ----------------------------------------------------------------------------
-- No login novo nao existe mais usuario no MySQL, entao o tracking de download
-- (tabela relatorios_baixados) nao pode mais usar usuario_id + FK. Passamos a
-- rastrear por CNPJ. Esta secao adiciona a coluna cnpj de forma idempotente e
-- cria a UNIQUE por (cnpj, record_id_trabalho) para manter o "baixou ou nao".
-- A coluna usuario_id antiga fica (nullable) para nao perder o historico.

-- 1) Torna usuario_id opcional (para novos registros sem MySQL) e remove a FK
--    que exigia usuario existente. (Se a FK ja nao existir, ignore o erro.)
DELIMITER $$
DROP PROCEDURE IF EXISTS _ajustar_baixados $$
CREATE PROCEDURE _ajustar_baixados()
BEGIN
    -- adiciona coluna cnpj se faltar
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'relatorios_baixados'
                   AND COLUMN_NAME = 'cnpj') THEN
        ALTER TABLE relatorios_baixados ADD COLUMN cnpj VARCHAR(14) DEFAULT NULL AFTER usuario_id;
    END IF;

    -- torna usuario_id nullable (novos downloads nao tem usuario no MySQL)
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'relatorios_baixados'
               AND COLUMN_NAME = 'usuario_id' AND IS_NULLABLE = 'NO') THEN
        ALTER TABLE relatorios_baixados MODIFY usuario_id INT NULL;
    END IF;

    -- remove a FK antiga (usuario_id -> usuarios_cnpj), se existir, para o
    -- tracking nao depender mais da tabela de usuarios. Busca o nome real da
    -- constraint (pode variar) e faz o DROP dinamico.
    SET @fk := (SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'relatorios_baixados'
                AND COLUMN_NAME = 'usuario_id' AND REFERENCED_TABLE_NAME IS NOT NULL
                LIMIT 1);
    IF @fk IS NOT NULL THEN
        SET @sql := CONCAT('ALTER TABLE relatorios_baixados DROP FOREIGN KEY `', @fk, '`');
        PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
    END IF;

    -- cria UNIQUE por (cnpj, record) se faltar, garantindo "baixou ou nao"
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'relatorios_baixados'
                   AND INDEX_NAME = 'uk_cnpj_trabalho') THEN
        ALTER TABLE relatorios_baixados ADD UNIQUE KEY uk_cnpj_trabalho (cnpj, record_id_trabalho);
    END IF;
END $$
CALL _ajustar_baixados() $$
DROP PROCEDURE IF EXISTS _ajustar_baixados $$
DELIMITER ;

-- Consulta util para o chefe ver quem baixou (via phpMyAdmin):
--   SELECT cnpj, record_id_trabalho, baixado_em FROM relatorios_baixados ORDER BY baixado_em DESC;


-- ----------------------------------------------------------------------------
-- HISTORICO DE LOGINS: adicionar coluna cnpj_tentado
-- ----------------------------------------------------------------------------
-- O login novo registra o CNPJ tentado (nao ha mais usuario_id do MySQL).
-- Adiciona a coluna de forma idempotente; a coluna usuario_id antiga (se
-- existir) fica intacta para nao perder historico.
DELIMITER $$
DROP PROCEDURE IF EXISTS _ajustar_historico $$
CREATE PROCEDURE _ajustar_historico()
BEGIN
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'historico_logins'
                   AND COLUMN_NAME = 'cnpj_tentado') THEN
        ALTER TABLE historico_logins ADD COLUMN cnpj_tentado VARCHAR(14) NULL AFTER id;
        ALTER TABLE historico_logins ADD INDEX idx_historico_cnpj (cnpj_tentado);
    END IF;
    -- se usuario_id existir e for NOT NULL com FK, torna nullable para nao travar
    -- inserts do login novo (que nao tem usuario_id).
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'historico_logins'
               AND COLUMN_NAME = 'usuario_id' AND IS_NULLABLE = 'NO') THEN
        ALTER TABLE historico_logins MODIFY usuario_id INT NULL;
    END IF;
END $$
CALL _ajustar_historico() $$
DROP PROCEDURE IF EXISTS _ajustar_historico $$
DELIMITER ;


-- ----------------------------------------------------------------------------
-- FEEDBACK / REPORTAR PROBLEMA (nova tabela, escopo do portal)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS feedback_clientes (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    cnpj        VARCHAR(14)  NULL,
    categoria   ENUM('Bug', 'Sugestao', 'Duvida') NOT NULL DEFAULT 'Duvida',
    mensagem    TEXT         NOT NULL,
    url_pagina  VARCHAR(255) NULL,
    status      ENUM('Novo', 'Lido', 'Resolvido') NOT NULL DEFAULT 'Novo',
    criado_em   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- =============================================================
-- COMANDOS DE TESTE REMOVIDOS/COMENTADOS
-- Os DELETE/UPDATE de usuários específicos que existiam aqui foram removidos
-- para evitar alteração acidental de dados reais.
-- Crie usuários de teste manualmente ou por script separado em ambiente local.
-- =============================================================

