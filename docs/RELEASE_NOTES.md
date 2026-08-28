# Release 3.1.0 — senhas dos clientes + onboarding

- Design original preservado.
- Feature flag `CLIENT_PASSWORDS_ENABLED=false` por padrão; instalar a 3.1 não muda automaticamente o login atual.
- Primeiro acesso seguro: CNPJ + e-mail confirma o cadastro e envia link; não libera sessão antes da criação da senha.
- Login definitivo: CNPJ + senha pessoal scrypt.
- Recuperação anti-enumeração com token hash, TTL e uso único.
- Alteração de senha dentro de `Minha conta`, invalidando outras sessões.
- Tutorial guiado opcional, pulável e replayable, com estado por versão no MySQL.
- Integração com o serviço ITR de e-mail/WhatsApp por HMAC + timestamp + nonce.
- WhatsApp de segurança opcional não recebe token de recuperação.
- `/ready` passa a validar também as tabelas críticas.
- Bootstrap do Diretor torna-se idempotente: senha existente é preservada; rotação só pelo comando explícito `npm run reset:director-password`.
