# Handoff: automação financeira ITR

Atualizado em 05/11/2026. Substitui o conteúdo de 04/11. Confira o estado com `git status` e `git log`.

## Resumo

A automação **não está ativa**, e as flags financeiras estão desligadas. As regras D1 a D6, D8 e D9 estão implementadas, e a D7 está parcial. A validação foi offline, mais a persistência em um MySQL local descartável. **Nada rodou em banco de homologação ou produção, Airtable real, SMTP ou com clientes reais.**

## Repositórios

| | Portal | Notificações |
|---|---|---|
| Diretório | `C:\Users\itr_l\Projetos\APLICACAO_PORTAL_ITRengenharia` | `C:\Users\itr_l\Projetos\Emails_diarios_ITRengenharia` |
| Branch | `feature/itr-billing-portal-20261104` | `feature/itr-billing-email-receiver-20261104` |
| Código | `lib/billing/` | `billing/` |

Nenhuma das branches foi enviada ao remoto. A integração prevista é direta na `main`, conforme `BILLING_PUBLICACAO.md`. Esses arquivos ficam fora do Git de propósito: `billing/review/`, `billing/VALIDACAO_D5.md` e `billing/VALIDACAO_ETAPA1.md`.

## Como testar

Use **Node.js 22.22.0**, pelo caminho completo. O `node` do PATH é o 24, e seus resultados não valem para homologação.

```bash
NODE22=/c/Users/itr_l/AppData/Local/ITR/Node22/node-v22.22.0-win-x64/node.exe
export NODE_OPTIONS=--require=./tests/offline-guard.cjs NODE_ENV=test
"$NODE22" --test tests/*.test.js    # nos dois repositórios
```

`contract.js` e `protocol.js` precisam continuar idênticos nos dois serviços.

## Fluxo

1. O worker do Portal roda a cada 60 s e faz a varredura do Airtable, somente leitura, a cada `PORTAL_BILLING_SCAN_INTERVAL_SECONDS`.
2. Os eventos ficam na fila cifrada do MySQL e seguem por HMAC para `POST /internal/billing/v1/events`.
3. O receptor pede prova ao Portal (`authorize`), baixa o PDF, pede a segunda prova, grava `sending`, envia por SMTP e grava `sent`.
4. Cada prova relê o Airtable.

## Decisões em vigor

| Tema | Regra |
|---|---|
| D1, destinatários | E-mails do campo `fldtqo76edbzzQcNz`, separados por `;`, revalidados antes de cada envio |
| D2 e NFSe | Documento cadastrado no Airtable já está aprovado, com as verificações técnicas mantidas |
| Boleto vencido | D+5, D+10… com o PDF original; acréscimos só citados, nunca calculados |
| Dados de pagamento | Data ou valor sem status `Pago` suspendem a cobrança, sem bloqueio permanente |
| D3, correções | Sem envio anterior, correção silenciosa. Com envio, `BOLETO_UPDATED` após 15 minutos sem edições; o texto depende de o SHA-256 do PDF ter mudado |
| D4, baseline | Boletos existentes na ativação não geram mensagens |
| D5 | `Inadimplente` segue na cobrança, na NFSe e na confirmação |
| D6 | Envio das 08:00 às 18:00 em São Paulo, todos os dias, conferido nos dois serviços |
| D7 | Estorno mantém a cobrança parada, com auditoria. **Sem alerta entregue e sem retomada** |
| D8 | Lembrete só é suprimido com recibo de entrega do mesmo dia para o destinatário |
| D9 | `BILLING_FINANCE_CONTACT_EMAIL` opcional, só nas Notificações; endereço oficial pendente |
| Piloto | `PORTAL_BILLING_PILOT_CLIENTS`: IDs exatos, lista vazia por padrão |
| PDF | Sem leitor ou OCR, por decisão da ITR |

## Situação

**Implementado e testado offline:** as regras acima, a rotina `npm run billing:report` e o caminho `npm run billing:migrate`.

**Testado em MySQL 8.0.46 local e descartável:** migration, cifragem, locks, transações, nonces e recuperação (`tests/billing-mysql.test.js`, 7/7).

**Depende de ambiente real:**
- paridade com o Airtable real;
- migration no banco de destino;
- múltiplas instâncias e volume de recibos;
- vazão às 08:00 e revisão dos e-mails em clientes reais.

**Depende de decisão da ITR:**
- senha derivada do CNPJ;
- aceite do risco do PDF;
- responsável pela rotina diária;
- clientes do piloto;
- endereço financeiro;
- identificação do operador para retomar cobrança após estorno;
- canal de monitoramento.

## Restrições permanentes

Airtable somente leitura. Sem push, merge, deploy, acesso à produção, migrations reais ou e-mails reais sem autorização específica. Cada commit também exige autorização.

## Documentos

Todos em `docs/`:
- `BILLING_BLOQUEADORES_ATIVACAO.md`: regras e condições para ativar
- `BILLING_PUBLICACAO.md`: publicação e rollback
- `BILLING_ROTINA_DIARIA.md`: acompanhamento diário
- `BILLING_MIGRATION_006.md`: migration e teste em MySQL
- `BILLING_D7_ESTORNO_ESPECIFICACAO.md`: pendências do estorno
- `BILLING_SEGURANCA_SENHA.md`: análise da senha
- `BILLING_RISCO_CONTEUDO_PDF.md`: risco residual do PDF

O contrato entre os serviços está em `billing/README.md`, nas Notificações.
