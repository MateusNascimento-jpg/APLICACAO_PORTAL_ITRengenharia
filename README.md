> **Portal 3.3.2:** restaura as regras de relatórios anteriores à mudança de login. Consulte [RESTAURACAO_RELATORIOS_3.3.2.md](RESTAURACAO_RELATORIOS_3.3.2.md). Instruções históricas de escopo estrito da 3.3.1 foram revertidas.

> **Versão consolidada 3.3.1:** consulte [RELEASE_CONSOLIDADO.md](RELEASE_CONSOLIDADO.md). Esta referência substitui as instruções antigas de senha pessoal.

> **Versão 3.3.0:** consulte [RELEASE_3.3.0.md](RELEASE_3.3.0.md). O acesso atual é CNPJ + senha gerada; instruções antigas de ativação/e-mail como senha não se aplicam.

# Portal ITR Engenharia — 3.1.0 final

Esta versão preserva o **design original** e mantém o hardening da 3.0.1. A 3.1 adiciona, atrás de feature flag, senha pessoal para clientes, recuperação segura e onboarding guiado opcional.

## Segurança primeiro

- Sessões opacas em MySQL via cookie HttpOnly, SameSite e Secure em produção.
- CSRF e validação de origem em mutações autenticadas.
- Tenant isolation por Airtable Record ID e downloads revalidados no backend.
- Rate limiting persistente, auditoria, CSP sem JavaScript inline/eval e readiness com verificação das tabelas críticas.
- Diretor separado (`/diretor.html`), usuário `diretor` + senha forte. O bootstrap 3.1 **não rotaciona uma senha administrativa que já existe**.
- Tokens de primeiro acesso/reset: 32 bytes aleatórios; o banco guarda somente SHA-256; expiram e são de uso único.
- Links de ativação/reset carregam o token no fragmento `#token=...`, reduzindo exposição em logs e Referer.
- Recuperação responde de forma genérica para evitar enumeração de contas.
- O Portal não envia e-mail diretamente: chama o serviço ITR de notificações por HMAC-SHA256 + timestamp + nonce.

## Migração de login dos clientes

`CLIENT_PASSWORDS_ENABLED=false` preserva o login atual **CNPJ + e-mail**. É o padrão da release para rollout seguro.

Quando a flag for habilitada:

1. Cliente sem senha informa **CNPJ + e-mail cadastrado**.
2. Isso não abre o Portal. O e-mail recebe um link temporário de primeiro acesso.
3. O cliente cria uma senha pessoal.
4. A partir daí, entra com **CNPJ + senha**; o e-mail deixa de autenticar.
5. “Esqueci minha senha” envia um link de uso único ao e-mail cadastrado.
6. Em `Minha conta`, o cliente pode alterar a senha; outras sessões são encerradas.

## Tutorial guiado

Depois da criação da senha, o cliente pode aceitar ou recusar um tour curto pelo Portal. O estado e a versão do onboarding ficam no MySQL. O tour pode ser reaberto em `Minha conta`.

## Rollout

Leia `docs/AUTENTICACAO_CLIENTES_3_1.md` antes de habilitar a feature em produção. Use `scripts/windows/` para backup, atualização, localhost e rollback.
