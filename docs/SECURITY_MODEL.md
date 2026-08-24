# Modelo de segurança

O design visual original foi preservado. O hardening atua em autenticação, sessão, autorização e operação.

- Sessão opaca em MySQL; cookie HttpOnly, SameSite e Secure em produção.
- Cliente autenticado por CNPJ + e-mail cadastrado, com resposta genérica e rate limiting.
- Diretor único autenticado por usuário `diretor` + senha scrypt forte.
- CSRF em mutações e verificação de origem.
- Isolamento multi-tenant por Airtable Record ID, com fail-closed.
- Download exige vínculo com cliente e aprovação atual.
- CSP sem scripts inline/eval. CSS visual original foi externalizado sem alterar suas regras.
- Safe Mode bloqueia escrita operacional no localhost por padrão.
- Auditoria registra eventos administrativos sem salvar credenciais.
