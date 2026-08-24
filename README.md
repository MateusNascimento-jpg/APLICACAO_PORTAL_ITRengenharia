# Portal ITR Engenharia — versão segura com design original

Esta versão preserva o design original das páginas de Cliente e aplica o hardening estrutural no backend e no fluxo de autenticação.

- Cliente: CNPJ + e-mail, preservando compatibilidade.
- Diretor: usuário `diretor` + senha forte gerada localmente.
- Sessões persistentes em MySQL via cookie HttpOnly.
- CSRF, CSP, rate limiting, auditoria, Safe Mode local e isolamento por Record ID.
- Downloads revalidados no backend.
- Render hoje, sem acoplamento que impeça migração futura para AWS.

Use os scripts em `scripts/windows/` para backup, atualização, localhost e rollback.

Ao aplicar a release, a credencial do Diretor é gerada/rotacionada localmente e exibida uma única vez no terminal.
