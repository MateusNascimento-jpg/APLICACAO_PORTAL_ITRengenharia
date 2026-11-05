# Automação financeira: condições para ativar

Nenhum item abaixo está resolvido. As flags financeiras devem continuar desligadas até que todos sejam concluídos.

## Bloqueador de segurança

**Credencial inicial derivada do CNPJ.** A senha gerada do Portal é a sigla do cliente seguida dos 6 primeiros dígitos do CNPJ (`lib/portal-access.js`, `senhaGerada`). Os e-mails financeiros exibem o CNPJ completo, e a decisão D1 os envia a todos os endereços cadastrados. Cada destinatário recebe a parte numérica da credencial; somente a sigla fica fora do e-mail.

Resolver antes da ativação. Os templates e a presença do CNPJ não foram alterados.

## Decisão pendente

**D2:** atestado dos boletos. Enquanto não for decidida, a exigência de atestado por documento continua impedindo qualquer envio financeiro.

## Homologação obrigatória

1. Verificar por acesso somente leitura o campo `fldVMUZcwtKKrrpDN` e a paridade com o Airtable real.
2. Validar as migrations e a persistência real no MySQL.
3. Avaliar o controle de requisições entre múltiplas instâncias.
4. Homologar a recuperação de falhas e a proteção contra duplicidades.
5. Confirmar que nenhuma otimização utiliza autorização financeira obsoleta.

## Migration 006

A tabela `portal_billing_grants` continua na migration porque não se sabe se ela foi aplicada em algum ambiente. Desde a D1, o código não lê nem grava essa tabela. Qualquer remoção exige uma decisão separada.
