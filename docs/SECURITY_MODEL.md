# Modelo de segurança — Portal ITR 3.1

O design visual original permanece. A segurança é tratada no backend e nas bordas entre Portal, MySQL, Airtable e serviço de notificações.

## Sessão e autorização

- Sessão opaca em MySQL; cookie HttpOnly, SameSite e Secure em produção.
- CSRF em mutações autenticadas e validação de origem.
- Cliente vinculado ao Airtable pelo Record ID imutável; autorização fail-closed.
- Download exige vínculo do cliente e aprovação atual do relatório.
- Diretor usa fluxo separado e senha scrypt forte; não existe TOTP/MFA nesta versão.

## Senhas dos clientes

O rollout é controlado por `CLIENT_PASSWORDS_ENABLED`.

- `false`: compatibilidade 3.0.1 (CNPJ + e-mail).
- `true`: cliente sem senha usa CNPJ + e-mail somente para iniciar a ativação por e-mail; nenhum acesso aos dados é liberado antes de abrir o link e criar a senha.
- Senhas usam scrypt + salt e nunca são armazenadas/registradas em texto puro.
- Política: 12+ caracteres por padrão, limite de tamanho, bloqueio de senhas comuns e de senha contendo CNPJ/e-mail.
- Troca/reset invalida outras sessões e tokens pendentes.

## Primeiro acesso e recuperação

- Token aleatório de 32 bytes.
- Apenas `SHA-256(token)` é salvo no MySQL.
- Finalidade separada: `ACTIVATE` ou `RESET`.
- TTL curto, uso único e consumo transacional com `SELECT ... FOR UPDATE`.
- O link usa `#token=...`, que não é enviado ao servidor em requisições HTTP normais nem em Referer.
- Solicitação de recuperação usa resposta genérica e rate limits por IP/conta para reduzir enumeração/abuso.

## Notificações

O Portal não possui credenciais SMTP/Meta. Ele chama o serviço `Emails_diarios_ITRengenharia` em um endpoint interno autenticado por:

- HMAC-SHA256;
- segredo compartilhado Base64 de 32+ bytes;
- timestamp com janela curta;
- nonce com bloqueio de replay;
- JSON limitado e tipos de evento fechados.

E-mail é o canal que contém o link de ativação/reset. WhatsApp de segurança é opcional e funciona como aviso; não recebe token de reset.

## Onboarding

O tutorial é opcional e não interfere na autorização. Seu estado é salvo no MySQL por versão. Nenhuma preferência de segurança depende de localStorage.

## Operação

- CSP sem scripts inline/eval.
- Safe Mode continua bloqueando mutações operacionais do Airtable no localhost por padrão.
- `/ready` verifica conectividade e estruturas críticas do banco, evitando repetir o incidente em que o serviço estava conectado ao MySQL mas faltavam tabelas da migration.
