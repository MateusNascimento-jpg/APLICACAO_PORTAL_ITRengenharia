# Portal ITR 3.6.0 — token de aceite: retomada, reenvio proporcional e contrato VERIFY v1

Base: 3.5.1 (`main` 9446926, idêntica ao snapshot `CODIGO_PORTAL_RECEBIDO_2026-10-26`).
Sem migração de banco. Financeiro, Comprovante de Contrato, PDF e layout geral **não foram alterados**.

## Comportamento novo

| Antes (3.5.1) | Agora (3.6.0) |
| --- | --- |
| Fechar o modal descartava o campo do código; reabrir obrigava a pedir outro código. | `GET /api/propostas/:id/aceite/estado` retoma o desafio vigente: contato mascarado, validade, tentativas restantes e situação do envio. Nenhum código, hash ou e-mail completo vai ao navegador. |
| 3 pedidos / 30 min por CNPJ+proposta e, ao exceder, **mais 30 min** de bloqueio. 20 pedidos/IP. | Política por proposta, persistida no estado e só contada em pedido bem-sucedido: 1º imediato; reenvios após 1, 2, 5 e 10 min; no máximo 6 por 2 h. Limites de proteção por CNPJ (30/30 min) e por IP amplos (120/30 min, NAT). Bloqueio termina no fim da janela, sem penalidade extra. |
| 429 só com `Retry-After`; tela mostrava "Muitas tentativas. Aguarde antes de continuar." | 429 com `Retry-After` **e** corpo `{codigo, retryAfterSeconds, erro: "… Tente novamente em X min YY s."}`. A tela mostra contagem regressiva, desabilita só o botão de pedir código e o reabilita sozinha. |
| Envio só "encaminhado à fila"; falha de entrega invisível e consumindo cota. | Situação real da outbox: fila → enviado / em conferência / falha. Se o e-mail do código vigente for recusado, o cliente pode pedir outro na hora, sem consumir cota. |
| Repetir a confirmação após resposta perdida devolvia conflito. | Repetição do MESMO desafio devolve o resultado gravado (`repetido: true`) sem novo PATCH, sem novo e-mail e sem nova auditoria. Decisão ainda `applying` responde `DECISION_UNCERTAIN`. O navegador consulta o estado real antes de sugerir nova tentativa. |
| Janela do rate limit gravada com `NOW(3)` do MySQL e comparada com o relógio do Node (fusos diferentes congelavam a janela por horas). | Todas as datas do rate limit saem do relógio da aplicação; leitura e gravação usam o mesmo fuso da conexão. Chamadores existentes (login etc.) mantêm a penalidade padrão. |
| Worker cancelava VERIFY recusado (422) em silêncio. | Log `[Propostas] Serviço de e-mails recusou …`; diagnóstico (`npm run diagnose:notifications` e boot) exige que o serviço de e-mails declare `proposalsContract: 'verify-v1'`. |

Inalterado e reforçado por testes: código de 8 dígitos (zeros à esquerda), validade de 120 min para validar **e** confirmar, 5 erros por desafio (inclusive concorrentes), consentimento explícito separado, código apenas na outbox selada (AES-256-GCM).

## Arquivos
`lib/proposals/service.js`, `lib/proposals/routes.js`, `lib/proposals/worker.js`, `lib/rate-limit.js`, `lib/notifications.js`, `server.js`, `scripts/diagnose-notifications.js`, `public/assets/js/proposal-actions.js`, `public/assets/css/proposals-actions.css`.
Testes: `tests/proposals-token-20261026.test.js`, `tests/proposals-http-token-20261026.test.js`, `tests/rate-limit-timezone-20261026.test.js`, `tests/verify-contract-v1.test.js`, `tests/fixtures/verify-event-v1.json` (cópia idêntica no serviço de e-mails). Ajustados: `tests/proposals-http.test.js` (mock no contrato real: sem `code`, 120 min) e `tests/proposals-service.test.js` (repetição idempotente).
QA de navegador: `node scripts/qa-aceite-token-browser.js <pasta>` (requer Playwright).

## Ordem de implantação
Publicar **primeiro** o serviço de e-mails 2.7.0, depois o Portal 3.6.0, e rodar `npm run diagnose:notifications`.
