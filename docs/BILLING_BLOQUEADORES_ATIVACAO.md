# Automação financeira: condições para ativar

Nenhum item abaixo está resolvido. As flags financeiras devem continuar desligadas até que todos sejam concluídos.

## Bloqueador de segurança

**Credencial inicial derivada do CNPJ.** A senha gerada do Portal é a sigla do cliente seguida dos 6 primeiros dígitos do CNPJ (`lib/portal-access.js`, `senhaGerada`). Os e-mails financeiros exibem o CNPJ completo, e a decisão D1 os envia a todos os endereços cadastrados. Cada destinatário recebe a parte numérica da credencial; somente a sigla fica fora do e-mail.

Resolver antes da ativação. Os templates e a presença do CNPJ não foram alterados.

## Aprovações de documentos

Todo boleto e toda NFSe cadastrados no Airtable já foram conferidos e aprovados pelas equipes responsáveis, sem atestado adicional. Com isso, **as flags são a barreira que impede o envio real de boleto disponível, D−1, D0, NFSe e confirmação de pagamento.** As verificações técnicas continuam: integridade, anexos, vínculo com cliente/CNPJ, status, idempotência e ausência de envios retroativos.

## Decisão pendente: boleto vencido

A cobrança continua válida após o vencimento, sujeita aos encargos contratuais. Falta confirmar se o banco liquida o PDF original.

Até lá, o bloqueio é mantido: nenhum boleto vencido é enviado, nem como lembrete D+5, D+10, D+15…, nem como "boleto disponível". O código de auditoria é `BOLETO_OVERDUE_RULE_PENDING`. Ocorrências passadas e eventos cancelados não são recriados.

## Homologação obrigatória

1. Verificar por acesso somente leitura o campo `fldVMUZcwtKKrrpDN` e a paridade com o Airtable real.
2. Validar as migrations e a persistência real no MySQL.
3. Avaliar o controle de requisições entre múltiplas instâncias.
4. Homologar a recuperação de falhas e a proteção contra duplicidades.
5. Confirmar que nenhuma otimização utiliza autorização financeira obsoleta.

## Migration 006

As tabelas `portal_billing_grants` e `portal_billing_documents` continuam na migration porque não se sabe se ela foi aplicada em algum ambiente. O código não lê nem grava essas tabelas. Qualquer remoção exige uma decisão separada.
