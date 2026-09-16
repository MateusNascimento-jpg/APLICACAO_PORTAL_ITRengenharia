## 3.2.2 — Correção do login DEV no navegador

- reduz interferência de autofill/gerenciadores de senha no formulário DEV;
- em credencial inválida, informa apenas a quantidade de caracteres enviada e limpa o campo de senha;
- mantém a senha DEV exclusivamente em `DEV_VIEWER_PASSWORD`, sem segredo no Git;
- remove do teste uma credencial histórica literal e reforça o contrato de configuração por ambiente.

## 3.2.1 — Visualização DEV simples

- adiciona `/dev-login.html` com o mesmo visual do login do cliente;
- credenciais DEV ficam somente em `DEV_VIEWER_USERNAME` / `DEV_VIEWER_PASSWORD`;
- o DEV informa um CNPJ e recebe uma sessão normal de Cliente daquele escopo;
- redireciona diretamente para `/portal.html`, reutilizando o mesmo payload, escopo empresarial e autorização de relatórios;
- não altera Airtable nem schema MySQL e não interfere no `/api/login` normal dos clientes.

# 3.2.0 — Escopo empresarial code-only e hardening

- Client Scope Resolver para multiplos Record IDs/CNPJs/e-mails sem alterar Airtable.
- Uniao segura de trabalhos com deduplicacao por Record ID.
- PDF autorizado pelo mesmo escopo empresarial.
- Cache global/single-flight do snapshot Airtable.
- Cheap burst guard, gate de scrypt, readiness cache e timeouts anti-abuso.
- Testes de isolamento, graph poisoning, bursts e carga local.

# Release 3.1.1 — correção crítica de amostras do cliente

- Corrige a consulta de trabalhos/amostras após autenticação do cliente.
- O pré-filtro do campo vinculado `Cliente` passa a considerar `ID Cliente` (identificador operacional/primário da base) e mantém compatibilidade com `Nome Cliente` legado.
- A autorização continua fail-closed pelo Airtable Record ID da sessão; texto de cliente nunca concede acesso.
- Adiciona testes de regressão para cliente com `Nome Cliente` vazio e para impedir vazamento de registros de outro cliente.

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
