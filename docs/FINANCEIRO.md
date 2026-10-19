# Financeiro — contratos e faturas (somente leitura)

Área do Portal do Cliente para consultar contratos gerados a partir de propostas
aceitas, suas parcelas (tabela **Notas Fiscais**) e os documentos anexados.
Não há escrita: nenhum endpoint altera Airtable, MySQL ou envia notificações.

## Arquivos

| Arquivo | Papel |
|---|---|
| `lib/financeiro/schema.js` | IDs reais de tabelas/campos da base `ITR Financeiro` e enumerações oficiais |
| `lib/financeiro/mapper.js` | Funções puras: normalização de valores, classificação das abas, ordenação e JSON público |
| `lib/financeiro/service.js` | Cadeia de autorização e consultas por Record ID, refeita a cada pedido (sem cache) |
| `lib/financeiro/documentos.js` | Download seguro de anexos (allowlist de host, redirect, tipo, assinatura, tamanho) e limitador de downloads simultâneos/memória |
| `lib/financeiro/routes.js` | `GET /api/financeiro` e `GET /api/financeiro/documentos/:tipo/:registroId/:anexoId` |
| `public/assets/js/financeiro.js` / `public/assets/css/financeiro.css` | Interface (abas, tabela, expansão inline, estados) |

`finance-airtable.js` ganhou apenas dois exports de leitura (`listarRegistros`,
`obterRegistro`); a lógica de Propostas não mudou.

## Autorização (falha fechada)

Somente sessões `GeneratedClient` e `Cliente`. Visualização DEV e Diretor não
acessam o Financeiro. A cada pedido:

1. CNPJ da sessão → registro **único** em `Clientes` (duplicado = negado).
2. Propostas ligadas **somente** a esse cliente com `Status` exatamente `Aceita`,
   relidas no Airtable (o cache da lista de propostas não basta).
3. Contratos alcançados por essas propostas e cujo campo `Proposta` aponta para
   **exatamente uma** delas.
4. Notas Fiscais listadas em `Contratos.Parcelas` **e** cujo campo `Contrato`
   aponta de volta para o mesmo contrato.

Lookups (`Cliente`, `Status do Contrato`, `Anexo Contrato` da NF) não são usados
para autorizar. Qualquer quebra remove o registro e gera log com código e
Record ID (sem CNPJ, nome, valor ou URL): `FIN_CLIENTE_DUPLICADO`,
`FIN_CLIENTE_DIVERGENTE`, `FIN_PROPOSTA_VINCULO_CONTRATO_INVALIDO`,
`FIN_CONTRATO_AUSENTE`, `FIN_CONTRATO_VINCULO_AMBIGUO`,
`FIN_CONTRATO_PROPOSTA_NAO_AUTORIZADA`, `FIN_CONTRATO_PARCELAS_INVALIDAS`,
`FIN_FATURA_AUSENTE`, `FIN_FATURA_VINCULO_INCONSISTENTE`,
`FIN_PARCELA_NAO_CLASSIFICADA`, `FIN_CONTRATO_SEM_PARCELAS_INCONSISTENTE`.

Documentos refazem a cadeia inteira; o registro da fatura só é lido depois de
confirmado que pertence a um contrato autorizado. Negações respondem 404
genérico. O arquivo é baixado pelo servidor e entregue com `Cache-Control:
no-store`; a URL do Airtable nunca chega ao navegador.

## Abas

| Aba | Status do Pagamento | Regra do contrato |
|---|---|---|
| Próximas | `Aguardando Emissão da NF` | contrato `Ativo` |
| A pagar | `A Vencer`, `Vencido` | exclui contrato `Cancelado` |
| Pagas | `Pago` | qualquer status |
| Canceladas | `Cancelado`, ou qualquer parcela não paga de contrato `Cancelado` | agrupada por contrato |

Parcela `A Vencer`/`Vencido` de contrato cancelado aparece em Canceladas como
**Pendente de revisão**, com o status de origem. Status fora das listas oficiais
(ou `Aguardando Emissão da NF` em contrato `Concluído`, `Inadimplente` ou sem status) ficam fora das abas e
entram no estado "em conferência" (ver Estados).

## Documentos

| Tipo | Origem |
|---|---|
| `nfse` | `Notas Fiscais.NFSe` |
| `boleto` | `Notas Fiscais.Boleto` |
| `proposta` | `Proposta.Proposta` da proposta do contrato (rotulada **Proposta comercial**) |

Não existe tipo "contrato formal": o schema atual não comprova um arquivo de
contrato assinado (`Anexo Contrato` é lookup do PDF da proposta). Tipos de
arquivo aceitos: PDF, PNG, JPEG (abrir) e XML (baixar).

## Estados da área (campo `estado` da API)

| Estado | Quando | Tela |
|---|---|---|
| `disponivel` | há ao menos uma linha nas abas | abas + avisos de preparação/conferência |
| `conferencia` | registros existem mas foram recusados ou não são classificáveis (vínculo inválido, status fora da lista, contrato Concluído/Inadimplente sem parcelas) | "Informações em conferência" |
| `processamento` | proposta aceita sem contrato, ou contrato Ativo sem parcelas | "Preparando informações financeiras" (texto aprovado) |
| `vazio` | nada aplicável | "Nenhuma fatura disponível no momento." |

`conferencia` tem prioridade sobre `processamento`: dado inconsistente nunca é
apresentado como "em preparação". O cliente vê só contagens; os Record IDs
vão para o log do servidor.

## Cache e consistência

* **Sem cache de dados financeiros**: cada `GET /api/financeiro` e cada documento
  relê cliente, propostas, contratos e faturas. O navegador também não reaproveita
  dados (cada abertura da área consulta a API) e usa `Cache-Control: no-store`.
* `finance-airtable.js` mantém seus caches existentes (lista de clientes 60 s,
  lista de propostas 30 s). No Financeiro eles só **sugerem candidatos**: o
  cadastro do cliente e cada proposta são relidos e conferidos. Efeito residual:
  um segundo cadastro com o mesmo CNPJ criado há menos de 60 s só passa a ser
  detectado (e negado) quando a lista de clientes é recarregada.
* Sem polling. O menu Financeiro é reavaliado quando a guia volta ao foco (no
  máximo a cada 30 s), para refletir um aceite confirmado em outra guia.
* A automação do Airtable não é chamada.

## Downloads simultâneos e memória

O arquivo é lido inteiro para validar a assinatura antes de responder. Limites
(`lib/financeiro/documentos.js`): 15 MiB por arquivo, 6 downloads simultâneos no
servidor, 2 por conta (CNPJ) e orçamento global de 48 MiB em memória. Excedeu:
`429` (conta) ou `503` (servidor/orçamento) com `Retry-After: 5`. Com
`Content-Length` o arquivo vai direto para um único buffer (sem cópia extra).

## Eventos futuros de e-mail (NÃO implementados)

Candidatos para uma fase própria no serviço de Notificações (HMAC já existente):
NFSe disponibilizada, boleto disponibilizado, vencimento próximo e parcela paga.
Antes de implementar: chave de idempotência por `NotaFiscal + evento + anexo`,
consentimento e destinatários do cadastro financeiro, auditoria de envio e
nenhum disparo a partir de consultas do Portal.
