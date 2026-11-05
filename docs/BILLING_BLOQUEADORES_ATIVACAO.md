# Automação financeira: condições para ativar

Nenhum item abaixo está resolvido. As flags financeiras devem continuar desligadas até que todos sejam concluídos.

## Bloqueador de segurança

**Credencial inicial derivada do CNPJ.** A senha gerada do Portal é a sigla do cliente seguida dos 6 primeiros dígitos do CNPJ (`lib/portal-access.js`, `senhaGerada`). Os e-mails financeiros exibem o CNPJ completo, e a decisão D1 os envia a todos os endereços cadastrados. Cada destinatário recebe a parte numérica da credencial; somente a sigla fica fora do e-mail.

Resolver antes da ativação. Os templates e a presença do CNPJ não foram alterados.

## Aprovações de documentos

Todo boleto e toda NFSe cadastrados no Airtable já foram conferidos e aprovados pelas equipes responsáveis, sem atestado adicional. Com isso, **as flags são a barreira que impede o envio real de boleto disponível, D−1, D0, lembretes após o vencimento, NFSe e confirmação de pagamento.** As verificações técnicas continuam: integridade, anexos, vínculo com cliente/CNPJ, status, idempotência e ausência de envios retroativos.

## Boleto vencido

A ITR confirmou que o PDF original continua pagável após o vencimento, com os encargos do contrato tratados pelo banco. Os lembretes D+5, D+10, D+15… anexam esse PDF enquanto a parcela estiver ativa e sem pagamento registrado. O sistema não calcula encargos nem altera valores ou boletos. O e-mail informa, sem percentual, que o pagamento após o vencimento está sujeito aos acréscimos previstos em contrato.

**Dados de pagamento sem status `Pago`.** Data ou valor de pagamento preenchidos com outro status suspendem as mensagens de cobrança da parcela (boleto disponível, D−1, D0 e lembretes), e a inconsistência fica na auditoria só como código. A suspensão não é durável: corrigido o cadastro, a parcela volta a ser avaliada. Ocorrências de dias já passados não são recuperadas. Valor pago igual a zero não conta como pagamento. NFSe e confirmação de pagamento não são afetadas. Um pagamento parcial também suspende a cobrança até a revisão do cadastro.

## Boletos existentes na ativação (D4)

A baseline é preservada: boletos existentes na ativação não recebem disponibilidade, D−1, D0 nem lembretes, ainda que vencidos. **Decisão futura:** a eventual inclusão controlada de parcelas antigas exige liberação específica. Disparos históricos não estão autorizados.

## Homologação obrigatória

1. Verificar por acesso somente leitura o campo `fldVMUZcwtKKrrpDN` e a paridade com o Airtable real.
2. Validar as migrations e a persistência real no MySQL.
3. Avaliar o controle de requisições entre múltiplas instâncias.
4. Homologar a recuperação de falhas e a proteção contra duplicidades.
5. Confirmar que nenhuma otimização utiliza autorização financeira obsoleta.

## Migration 006

As tabelas `portal_billing_grants` e `portal_billing_documents` continuam na migration porque não se sabe se ela foi aplicada em algum ambiente. O código não lê nem grava essas tabelas. Qualquer remoção exige uma decisão separada.
