# D7: estorno ou reversão de pagamento

**Situação:** bloqueio e auditoria implementados. Alerta entregue e retomada estão pendentes, porque dependem de mecanismos que o Portal não tem.

## O que está implementado

Depois que uma parcela é vista como `Pago`, `state.stopped` fica verdadeiro e o Portal não o limpa. Se o status voltar a outro valor:

- nenhuma mensagem de cobrança é criada ou autorizada, inclusive `BOLETO_UPDATED`;
- mensagens já na fila continuam canceladas;
- pagar de novo não gera segunda confirmação;
- a NFSe continua independente;
- o bloqueio sobrevive a reinícios;
- `portal_billing_audit` recebe, no máximo uma vez por dia e por parcela, `PAYMENT_REVERSAL_REVIEW` e `OPERATIONAL_ALERT_UNDELIVERED`, só com o código e o ID da parcela.

`tests/billing-payment-reversal.test.js` demonstra esses pontos.

## Pendência 1: alerta operacional

**Hoje nenhum alerta é entregue.** O Portal e as Notificações não têm mecanismo de monitoramento. O canal de Integridade aceita só eventos `INTEGRITY_RECORD_CREATED` e não foi reaproveitado, para não alterar um fluxo homologado. Um log não monitorado não conta como alerta.

O código `OPERATIONAL_ALERT_UNDELIVERED` deixa isso visível. Até existir um canal, a consulta precisa ser manual:

```sql
SELECT subject, code, at_ms FROM portal_billing_audit
WHERE code IN ('PAYMENT_REVERSAL_REVIEW', 'OPERATIONAL_ALERT_UNDELIVERED') ORDER BY at_ms DESC;
```

Quando houver um canal, o alerta deve trazer o ID da parcela e o código, sem CNPJ, e-mail ou valor, e repetir no máximo uma vez por dia. `OPERATIONAL_ALERT_SENT` só pode ser gravado com confirmação do canal.

## Pendência 2: retomada controlada

**Hoje não existe retomada, e a cobrança da parcela estornada continua bloqueada.** O Portal só tem sessões de cliente e a conta única `Director`, sem identificar operadores financeiros. As ferramentas de linha de comando dependem do acesso ao ambiente e não comprovam quem as executa.

Requisitos para implementar, sem nova interface nem alteração do frontend:

| Requisito | Regra |
|---|---|
| Autorização | Operador financeiro autorizado, com identidade comprovada por um mecanismo seguro |
| Registro | Identificação, data e motivo em auditoria durável (`COLLECTION_RESUMED`) |
| Pré-condições, lidas do Airtable no momento | Status diferente de `Pago`; sem data ou valor de pagamento; vínculo com cliente e CNPJ válido; PDF íntegro; destinatários válidos |
| Agenda | Continua na próxima ocorrência vigente, sem mensagens retroativas |
| Airtable | Nenhuma escrita |
| Novo pagamento | Segunda confirmação só após nova transição comprovada, por duas observações, com identidade própria |

Para isso, será preciso decidir como identificar o operador financeiro.
