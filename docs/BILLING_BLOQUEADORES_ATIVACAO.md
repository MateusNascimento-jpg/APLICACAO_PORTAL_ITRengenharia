# Automação financeira: condições para ativar

Nenhum item abaixo está resolvido. As flags financeiras devem continuar desligadas até que todos sejam concluídos.

## Bloqueador de segurança

**Credencial derivada do CNPJ: impede a liberação geral a clientes reais.** A senha gerada do Portal é a sigla do cliente seguida dos 6 primeiros dígitos do CNPJ (`lib/portal-access.js`, `senhaGerada`).

Por decisão de 06/11/2026, o corpo dos e-mails financeiros não exibe mais o CNPJ. **Isso reduz a exposição, mas não torna a senha segura:** a fórmula continua previsível, e boletos e NFSe anexados normalmente trazem o CNPJ do cliente. A correção é a senha pessoal por cliente, e o login não foi alterado. Risco residual e correção em `BILLING_SEGURANCA_SENHA.md`.

## Aprovações de documentos

Todo boleto e toda NFSe cadastrados no Airtable já foram conferidos e aprovados pelas equipes responsáveis, sem atestado adicional. Com isso, **as flags são a barreira que impede o envio real de boleto disponível, D−1, D0, lembretes após o vencimento, NFSe e confirmação de pagamento.** As verificações técnicas continuam: integridade, anexos, vínculo com cliente/CNPJ, status, idempotência e ausência de envios retroativos.

## Boleto vencido

A ITR confirmou que o PDF original continua pagável após o vencimento, com os encargos do contrato tratados pelo banco. Os lembretes D+5, D+10, D+15… anexam esse PDF enquanto a parcela estiver ativa e sem pagamento registrado. O sistema não calcula encargos nem altera valores ou boletos. O e-mail informa, sem percentual, que o pagamento após o vencimento está sujeito aos acréscimos previstos em contrato.

**Dados de pagamento sem status `Pago`.** Data ou valor de pagamento preenchidos com outro status suspendem as mensagens de cobrança da parcela (boleto disponível, D−1, D0 e lembretes), e a inconsistência fica na auditoria só como código. A suspensão não é durável: corrigido o cadastro, a parcela volta a ser avaliada. Ocorrências de dias já passados não são recuperadas. Valor pago igual a zero não conta como pagamento. NFSe e confirmação de pagamento não são afetadas. Um pagamento parcial também suspende a cobrança até a revisão do cadastro.

## Correções de boleto (D3)

Cada mensagem registra o que informou: conteúdo do PDF (SHA-256), vencimento e valor. Na varredura, o Portal compara esses dados com o Airtable:

- **Nada foi tentado ainda:** a correção é silenciosa; as mensagens pendentes são substituídas e a agenda segue os dados atuais.
- **Valor preenchido pela primeira vez:** não é correção.
- **Já houve tentativa de envio e o PDF, o vencimento ou o valor mudaram:** as mensagens da versão anterior são canceladas. Depois de 15 minutos sem novas alterações, sai um único `BOLETO_UPDATED` por destinatário cadastrado, com o PDF vigente. Só depois a agenda continua nos dados novos, sem recuperar dias passados.
- **Texto do aviso:** o evento carrega a versão anterior (`previous`), protegida pelo `eventId`. SHA-256 diferente anuncia a substituição do documento. SHA-256 igual informa só o vencimento ou o valor alterados, sem anunciar documento novo, e pede contato com o Financeiro se o impresso divergir.
- **Mesmo conteúdo em outro anexo:** não é nova versão e nada é reenviado.

A parada por pagamento, a revalidação de destinatários e do CNPJ e a baseline continuam valendo. Boleto da baseline substituído não gera mensagem.

**Continuam retidos, com auditoria:** troca de cliente, contrato, proposta ou CNPJ (permanente, exige conciliação), outro conteúdo no mesmo anexo (até surgir um novo anexo), PDF ausente ou ilegível, novos valores vazios, volta a uma versão já anunciada e NFSe substituída depois da tentativa de envio.

**Limite conhecido:** uma divergência entre o impresso no PDF e os dados do Airtable não é detectada nem retida; somente dados vazios ou inválidos são.

## Contrato inadimplente (D5)

O status `Inadimplente` é aceito no Portal e no receptor, para cobrança, NFSe e confirmação. Pagamento registrado, cancelamento e dados inconsistentes continuam impedindo envios.

## Janela de envio (D6)

Os e-mails financeiros saem das 08:00 às 18:00 em São Paulo, todos os dias. Portal e receptor conferem a janela de forma independente. As varreduras continuam fora dela, então um pagamento registrado à noite cancela a mensagem da manhã. Fora da janela, o evento fica retido até as 08:00, com auditoria `OUTSIDE_SEND_WINDOW`. Lembrete do dia não enviado até as 18:00 é cancelado na manhã seguinte como `OBSOLETE`; disponibilidade, atualização, NFSe e confirmação saem na próxima abertura. Os mecanismos legados não têm essa janela.

## E-mails no mesmo dia (D8)

Disponibilidade ou atualização com entrega confirmada pelo receptor no dia substitui o lembrete desse dia para aquele destinatário (`REMINDER_CONSOLIDATED`). Enquanto estiver pendente, o lembrete apenas espera. Entrega incerta, bloqueada ou cancelada não suprime nada. A disponibilidade com vencimento passado informa a data e os acréscimos previstos em contrato. Atualização, NFSe e confirmação nunca são suprimidas.

**Limite conhecido:** se a disponibilidade pendente só sair em outro dia, o lembrete daquele dia não é criado, e o e-mail que sair traz o vencimento correto.

## Estorno (D7)

A cobrança continua parada depois de um estorno, com auditoria diária. **Não há alerta entregue nem forma de retomar a cobrança**, porque o Portal não tem mecanismo de monitoramento nem identidade de operador financeiro. Ver `docs/BILLING_D7_ESTORNO_ESPECIFICACAO.md`.

## Canal financeiro (D9)

Configuração opcional no serviço de Notificações (`BILLING_FINANCE_CONTACT_EMAIL`). Sem o endereço oficial, nenhum Reply-To ou contato é usado, e os e-mails continuam orientando a procurar a equipe financeira.

## Conteúdo do PDF

O sistema não lê o conteúdo do PDF nem usa OCR, por decisão da ITR: a equipe financeira confere os documentos antes de cadastrá-los. Continuam valendo as verificações de integridade (SHA-256), vínculo com cliente/CNPJ, pagamento e idempotência. O risco residual está em `BILLING_RISCO_CONTEUDO_PDF.md`.

## Boletos existentes na ativação (D4)

A baseline é preservada: boletos existentes na ativação não recebem disponibilidade, D−1, D0 nem lembretes, ainda que vencidos. **Decisão futura:** a eventual inclusão controlada de parcelas antigas exige liberação específica. Disparos históricos não estão autorizados.

## Piloto

`PORTAL_BILLING_PILOT_CLIENTS` lista os IDs exatos dos clientes liberados. A lista começa vazia, então ninguém é elegível, e um formato inválido impede a subida. A conferência acontece no agendamento e em cada prova de envio. Documentos e pagamentos vistos antes da liberação nunca geram mensagens. Um cliente retirado tem as mensagens pendentes canceladas; se voltar, recebe só as próximas ocorrências.

## Modo geral

`PORTAL_BILLING_MODE=general` dispensa a lista, depois de um marco durável gravado por uma passagem silenciosa completa. Só parcelas criadas depois do marco iniciam o fluxo; as anteriores ficam em silêncio, inclusive para boleto, NFSe e confirmação de pagamento. O padrão continua `pilot`, e as validações não mudam. Procedimento e efeitos em `BILLING_PUBLICACAO.md`. **O modo geral amplia a todos os clientes o alcance do bloqueador de segurança acima.**

## Homologação obrigatória

1. Verificar por acesso somente leitura o campo `fldVMUZcwtKKrrpDN` e a paridade com o Airtable real.
2. Validar as migrations e a persistência real no MySQL.
3. Avaliar o controle de requisições entre múltiplas instâncias.
4. Homologar a recuperação de falhas e a proteção contra duplicidades.
5. Confirmar que nenhuma otimização utiliza autorização financeira obsoleta.

## Migration 006

Caminho de aplicação em `BILLING_MIGRATION_006.md`.

As tabelas `portal_billing_grants` e `portal_billing_documents` continuam na migration porque não se sabe se ela foi aplicada em algum ambiente. O código não lê nem grava essas tabelas. Qualquer remoção exige uma decisão separada.
