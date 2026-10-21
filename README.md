# Manutenção de confluência — 3.4.1

Ver `docs/CONFLUENCIA_ATUAL.md`. Correções de confluência compatíveis com a release 3.4.0. **Adendo visual de 21/10/2026:** cabeçalhos de Relatórios, Conta, Propostas e Financeiro e ajuste de tokens do tema escuro em `public/portal.html` e `public/assets/css/itr-ux-composicao.css`, sem alterações de lógica de frontend/backend.

# Atualização Propostas — 3.4.0

Esta entrega acrescenta o fluxo comercial seguro. Consulte `docs/PROPOSTAS_OPERACAO.md` antes da aplicação: migração 003 no Portal, recibos persistentes em Notificações e ativação explícita são necessários. Nenhum `.env` é distribuído ou alterado. Os comandos e textos históricos abaixo são preservados como referência; para Propostas prevalece o guia novo (ao entrar no site).

> **Portal 3.3.2:** restaura as regras de relatórios anteriores à mudança de login. Consulte [RESTAURACAO_RELATORIOS_3.3.2.md](RESTAURACAO_RELATORIOS_3.3.2.md). Instruções históricas de escopo estrito da 3.3.1 foram revertidas.

> **Versão consolidada 3.3.1:** consulte [RELEASE_CONSOLIDADO.md](RELEASE_CONSOLIDADO.md). Esta referência substitui as instruções antigas de senha pessoal.

> **Versão 3.3.0:** consulte [RELEASE_3.3.0.md](RELEASE_3.3.0.md). O acesso atual é CNPJ + senha gerada; instruções antigas de ativação/e-mail como senha não se aplicam.

## Estado vigente de autenticação e confluência — 3.4.0

- **Único login de cliente ativo:** `CLIENT_AUTH_MODE=generated`, CNPJ + senha calculada por `trim(Sigla Cliente) + seis primeiros dígitos do CNPJ`, obtidos no Airtable. O e-mail não autentica. Os demais fluxos de senha pessoal descritos abaixo são históricos/desativados.
- **Recuperação vigente:** `POST /api/auth/password-reset/request` solicita o envio de `ACCESS_REQUEST` pelo serviço de notificações. Não altera a senha; a resposta é genérica para evitar enumeração.
- As rotas descontinuadas de ativação, reset e mudança de senha permanecem respondendo HTTP 410 por compatibilidade, mas **não estão ativas**.
- **Configuração compartilhada:** `AIRTABLE_BASE_ID`, `AIRTABLE_CLIENTES_TABLE_ID` e `AIRTABLE_CLIENT_SIGLA_FIELD` devem corresponder ao serviço de notificações. `PORTAL_NOTIFICATIONS_HMAC_SECRET` e `PORTAL_INTERNAL_HMAC_SECRET` devem conter o **mesmo segredo Base64**, apesar dos nomes distintos. Ambos precisam de relógios sincronizados (NTP).
- **Verificação sem envio:** `npm run diagnose:notifications`. O Portal verifica HMAC, resposta, contrato e relógio de forma não bloqueante ao iniciar. Uma falha no diagnóstico deve gerar alerta operacional, mas não derruba a área de relatórios.
- **Risco residual de autenticação:** essa fórmula é previsível; rate limit não substitui uma credencial robusta. Não trocar unilateralmente a fórmula: a atualização exige migração coordenada, canais de distribuição, revogação de sessões e planejamento com a ITR.
- O frontend, rotas de propostas, arquivos PDF, diretor e relatórios não foram alterados nesta correção. Procedimento: `docs/CONFLUENCIA_ATUAL.md`.

---

# Portal ITR Engenharia — 3.1.0 final (documentação histórica, NÃO vigente)


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
