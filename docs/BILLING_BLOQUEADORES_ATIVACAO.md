# Automação financeira: condições para ativar

Nenhum item abaixo está resolvido. As flags financeiras devem continuar desligadas até que todos sejam concluídos.

## Bloqueador de segurança

**Credencial inicial derivada do CNPJ.** A senha gerada do Portal é a sigla do cliente seguida dos 6 primeiros dígitos do CNPJ (`lib/portal-access.js`, `senhaGerada`). Os e-mails financeiros exibem o CNPJ completo, e a decisão D1 os envia a todos os endereços cadastrados. Cada destinatário recebe a parte numérica da credencial; somente a sigla fica fora do e-mail.

Resolver antes da ativação. Os templates e a presença do CNPJ não foram alterados.

## Decisões pendentes

A D2 aprovou os boletos cadastrados no Airtable, sem atestado adicional. Com isso, **as flags passam a ser a barreira que impede o envio de boleto disponível, D−1, D0 e confirmação de pagamento.** Duas regras continuam em aberto:

- **Boleto vencido.** Não se presume que continue pagável. Enquanto a regra não for definida, boleto vencido não é enviado, nem como lembrete D+5, D+10, D+15…, nem como "boleto disponível". O código de auditoria é `BOLETO_OVERDUE_RULE_PENDING`. Ocorrências passadas não são recuperadas depois.
- **NFSe.** A aprovação da D2 não a cobre. Ela continua exigindo atestado, e o único fluxo para criá-lo hoje é a ferramenta de laboratório, então nenhuma NFSe sai em produção até haver uma decisão específica.

## Homologação obrigatória

1. Verificar por acesso somente leitura o campo `fldVMUZcwtKKrrpDN` e a paridade com o Airtable real.
2. Validar as migrations e a persistência real no MySQL.
3. Avaliar o controle de requisições entre múltiplas instâncias.
4. Homologar a recuperação de falhas e a proteção contra duplicidades.
5. Confirmar que nenhuma otimização utiliza autorização financeira obsoleta.

## Migration 006

A tabela `portal_billing_grants` continua na migration porque não se sabe se ela foi aplicada em algum ambiente. Desde a D1, o código não lê nem grava essa tabela. Qualquer remoção exige uma decisão separada.
