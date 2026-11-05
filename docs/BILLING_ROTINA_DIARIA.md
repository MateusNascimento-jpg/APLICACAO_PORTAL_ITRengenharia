# Automação financeira: rotina diária

Enquanto não houver monitoramento, esta consulta é o único aviso de falhas. **Nenhum alerta chega sozinho, e um log não monitorado não conta como alerta.** Se ninguém rodar a rotina, ninguém fica sabendo.

## Como rodar

Uma vez por dia, depois das 08:30 em São Paulo, em ambiente com acesso ao banco do Portal:

```bash
npm run billing:report
```

A consulta é somente leitura e usa apenas códigos, contagens e IDs de parcela ou evento. O conteúdo cifrado não é lido, então a saída não traz e-mails, CNPJ nem valores.

| Código de saída | Significado | O que fazer |
|---|---|---|
| `0` | Sem pendências | Registrar a data e o `digest` |
| `2` | Há pendências | Tratar conforme a tabela abaixo e registrar |
| `1` | A consulta não terminou | Tratar como incidente; o dia **não** foi verificado |

O campo `digest` é o SHA-256 do relatório e serve para conferir que o registro é o da saída original. O campo `alertDelivered` é sempre `false`.

## O que tratar

| Seção | Códigos | Ação |
|---|---|---|
| `reversals` | `PAYMENT_REVERSAL_REVIEW` | Estorno. O Financeiro avalia a parcela. A cobrança dela segue parada, e **não existe retomada** (ver `BILLING_D7_ESTORNO_ESPECIFICACAO.md`) |
| `uncertainDeliveries`, `openEvents` | `DELIVERY_UNCERTAIN`, `ORPHANED_DISPATCH`, `SMTP_LEASE_UNCERTAIN`, `HTTP_UNCERTAIN`, `LEASE_RECONCILIATION_REQUIRED`, ou status `uncertain` ou `blocked` | Conferir no provedor de e-mail se houve aceitação, usando o `eventId`. Não reenviar à mão |
| `stuckEvents` | Status `sending` com prazo vencido | Normalmente se resolve na abertura seguinte. Se repetir, verificar se o worker está ativo |
| `held` | `PAYMENT_DATA_INCONSISTENT`, `DOCUMENT_HELD`, `INSTALLMENT_AMOUNT_MISSING`, `BOLETO_VERSION_INCOMPLETE` | O Financeiro corrige o cadastro no Airtable; a parcela volta sozinha |
| `held` | `RECONCILIATION_REQUIRED`, `BOLETO_VERSION_REVIEW`, `NFSE_REPLACED_REVIEW` | Revisão manual. Troca de cliente ou CNPJ não volta sozinha |
| `held` | `RECIPIENT_UNAUTHORIZED`, `RECIPIENT_INVALID` | Corrigir os e-mails do cliente no Airtable |
| `errors` | Qualquer outro código | Investigar. Código desconhecido entra aqui de propósito, para não ficar escondido |

`baselineComplete: false` ou `truncated: true` também pedem atenção: no primeiro caso, o baseline ainda não terminou; no segundo, a lista foi cortada em 500 linhas.

## Registro

Anote data, responsável, código de saída, `digest` e ações tomadas. A ITR precisa definir um responsável e um substituto antes da ativação.
