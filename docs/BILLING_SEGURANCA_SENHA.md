# Senha do Portal derivada do CNPJ: análise e proposta

**Situação:** Fase 1 implementada em 06/11/2026, só nos templates financeiros. A Fase 2 não foi feita, e **sem ela a liberação geral a clientes reais continua impedida**. O login e os e-mails comerciais não foram alterados.

## O problema

A senha do cliente é a sigla seguida dos 6 primeiros dígitos do CNPJ (`lib/portal-access.js`, `senhaGerada`).

- **Previsível:** os 6 primeiros dígitos do CNPJ são públicos. Quem souber ou adivinhar a sigla obtém a senha.
- **Não pode ser trocada:** as rotas de troca de senha estão desativadas e respondem HTTP 410. `config.js` recusa outro valor em `CLIENT_AUTH_MODE`.
- **Mesma para toda a empresa:** não há como revogar o acesso de uma só pessoa.
- **Enviada por e-mail:** a recuperação manda a senha em texto (`access_email_template.js`).
- **A automação ampliaria a exposição:** os e-mails financeiros exibiam o CNPJ completo a todos os endereços do cadastro (D1). A Fase 1 retirou essa linha.

Existem proteções: limite de tentativas por IP e por conta, atraso nas falhas e auditoria. Elas dificultam a tentativa, mas a senha continua previsível.

## Proposta em duas fases

### Fase 1: retirar o CNPJ dos e-mails financeiros

- **Mudança:** remover a linha "CNPJ" de `billing/template.js`. O cliente já conhece o próprio CNPJ, e o e-mail continua com o link do Portal.
- **Não muda:** login, senha, recuperação e demais e-mails.
- **Resultado:** o e-mail financeiro deixa de entregar parte da senha. **O problema não é resolvido**, porque a fórmula continua previsível.
- **Tamanho:** pequeno, com ajuste de testes e previews.

### Fase 2: senha pessoal, adotada por cliente

- **Mudança:** se o cliente já tiver senha pessoal, só ela vale; sem ela, a senha atual continua funcionando. Assim nenhum cliente perde o acesso de uma vez.
- **Reaproveita:** a tabela `portal_client_accounts` e o fluxo de ativação por link, já presentes em `lib/client-auth.js` e hoje desativados.
- **Afeta:** `/api/login`, a trava de `config.js`, a recuperação e o e-mail de acesso nas Notificações. As sessões do cliente seriam revogadas na troca.
- **Precisa conferir:** se as telas de criação e redefinição de senha ainda funcionam, porque hoje são redirecionadas, e como comunicar os clientes.
- **Regressão:** exige nova homologação do login, por isso depende da sua aprovação.

## Risco residual depois da Fase 1

Ocultar o CNPJ não torna a senha segura:

- **Anexos:** boletos e NFSe normalmente trazem o CNPJ do cliente, e o sistema não lê nem altera esses PDFs. Quem recebe o e-mail continua vendo o número no anexo.
- **Fórmula:** os 6 primeiros dígitos do CNPJ são públicos, e a sigla pode ser conhecida ou adivinhada.
- **Outros canais:** os e-mails comerciais e os mecanismos homologados, como a recuperação com senha em texto, não mudaram.
- **Dado interno:** o CNPJ continua na prova autenticada entre Portal e Notificações, exigida pelo contrato, mas não aparece no e-mail nem nos recibos.

## Recomendação

A Fase 1 está aplicada. A Fase 2 é a correção necessária e **deve ser concluída antes da liberação geral a clientes reais**. Ela altera a autenticação e exige aprovação e homologação próprias.
