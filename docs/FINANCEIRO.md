# Financeiro — uma linha por contrato (somente leitura)

Área do Portal do Cliente para consultar os contratos gerados a partir de
propostas aceitas e seus documentos. **A tabela mantém UM registro por
contrato. Os vencimentos individuais das parcelas aparecem somente nos
Detalhes expandidos.** As parcelas (tabela **Notas Fiscais**) são lidas e
validadas no servidor para consolidar a situação do contrato, oferecer
NFSe/boleto e expor apenas identificação normalizada e vencimento.
Não há escrita: nenhum endpoint altera Airtable, MySQL ou envia notificações.

## Arquivos

| Arquivo | Papel |
|---|---|
| `lib/financeiro/schema.js` | IDs reais de tabelas/campos da base `ITR Financeiro` e enumerações oficiais |
| `lib/financeiro/mapper.js` | Funções puras: normalização de valores, situação consolidada do contrato (`situacaoContrato`), documentos e JSON público |
| `lib/financeiro/service.js` | Cadeia de autorização e consultas por Record ID, refeita a cada pedido (sem cache) |
| `lib/financeiro/documentos.js` | Download seguro de anexos (allowlist de host, redirect, tipo, assinatura, tamanho) e limitador de downloads simultâneos/memória |
| `lib/financeiro/routes.js` | `GET /api/financeiro` e `GET /api/financeiro/documentos/:tipo/:registroId/:anexoId` |
| `public/assets/js/financeiro.js` / `public/assets/css/financeiro.css` | Interface (tabela original por contrato, Detalhes inline, estados); sem abas |

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

## Tabela por contrato

Colunas (mesma tabela e densidade do layout original): **Contrato**,
**Condição de pagamento** (`Proposta.Forma de Pagamento`), **Valor total**
(`Proposta.Valor da Proposta`, nunca valor ou soma de parcela; ausente = "—"),
**Prazo para pagamento** (`Contratos.Prazo de pagamento`, senão o da proposta)
e **Situação**. "Detalhes" preserva as informações gerais — Contrato, Proposta,
Situação do contrato (`Contratos.Status do Contrato`), Condição, Prazo, Valor
total — e a coluna Documentos. Logo abaixo de Prazo/Valor total, os vencimentos
aparecem em duas colunas no desktop e uma em telas pequenas, com o tema e
estilo existentes. Contratos começam recolhidos e há um pequeno
respiro (14 px) entre eles. Contrato válido sem nenhuma nota aparece na lista.

### Parcelas no JSON público

`GET /api/financeiro` preserva os campos existentes e acrescenta
`contratos[].parcelas`, com apenas `identificacao` e `vencimento` de cada nota
autorizada com status oficial não cancelado. Não há novos Record IDs,
valores individuais, URLs de origem ou dados de pagamento. Os identificadores
que já existiam nos contratos e documentos permanecem para as rotas autenticadas.

```json
{
  "parcelas": [
    { "identificacao": "Parcela de Entrada", "vencimento": "2026-11-20" },
    { "identificacao": "Parcela 2", "vencimento": null }
  ]
}
```

O vencimento vem exclusivamente de `Notas Fiscais.Vencimento`. Datas ausentes
ou inválidas viram `null`, exibido como "Vencimento não informado"; nenhuma
data é calculada a partir do prazo ou da emissão. Datas válidas são de
calendário (`AAAA-MM-DD` na API, `DD/MM/AAAA` na tela), sem conversão de fuso.

`Notas Fiscais.Parcela` reconhece Entrada, Única e números explícitos, incluindo
`- Parcela Entrada`, `- Parcela 2`, `- Parcela Única`,
`C232 - Parcela Única` e `C113-2026 - Parcela Entrada`. Apenas um separador
inicial válido seguido de "Parcela" é removido. Valores ambíguos, malformados
ou conflitantes continuam indisponíveis (`identificacao: null`), sem inventar
numeração pela posição ou pela data.

A ordenação comercial determinística mantém Entrada primeiro, números em ordem
numérica, Única como categoria própria e identificações desconhecidas ao final.
Record IDs existentes são usados apenas para desempate interno. A ordenação
não altera a fatura de origem dos dados ou a ordem consolidada dos documentos.

### Situação consolidada (`mapper.situacaoContrato`)

`Status do Contrato` e `Status do Pagamento` são fontes distintas; a coluna
Situação deriva das Notas Fiscais e só usa o contrato para cancelamento:

1. contrato `Cancelado` → **Cancelado** (com nota "Cobrança em revisão pela ITR" se houver nota `A Vencer`/`Vencido`);
2. nota fora do enum oficial, nota listada mas recusada pelo vínculo, ou lista de parcelas malformada → **Em conferência**;
3. sem notas: contrato `Ativo`/sem status → **Em preparação**; `Concluído`/`Inadimplente` → **Em conferência**;
4. notas aplicáveis = todas exceto `Cancelado`; nenhuma aplicável → **Em conferência**;
5. alguma `Vencido` → **Vencido**; senão alguma `A Vencer` → **A Vencer**; senão alguma `Aguardando Emissão da NF` → **Aguardando Emissão da NF**;
6. todas as aplicáveis `Pago` → **Pago**.

Uma nota paga nunca torna o contrato "Pago" (ex.: `Pago` + `A Vencer` = **A Vencer**).

## Documentos

Uma pilha vertical por contrato, nesta ordem: **Proposta comercial** →
**Comprovante de Contrato** → NFSe/boletos (cronológicos; notas canceladas ou
sem status oficial não oferecem documento).

NFSe e boleto recebem identificação normalizada da **mesma Nota Fiscal**
autorizada que contém o anexo, por exemplo "NFSe - Parcela de Entrada",
"Boleto - Parcela 2" e "NFSe - Parcela Única". Sem identificação inequívoca,
o rótulo indica "Parcela não identificada". Nunca se associa um documento por
posição visual ou apenas pela data. O nome original do arquivo, a ordem dos
documentos, as rotas autenticadas e a revalidação de autorização a cada download
permanecem preservados, assim como a proposta aceita e o comprovante imutáveis.

| Tipo | Origem |
|---|---|
| `proposta-aceita` | versão congelada do aceite (`portal_proposal_artifacts`), servida por `/api/propostas/:id/proposta-aceita`; substitui o anexo atual do Airtable quando existe |
| `comprovante` | `Comprovante de Contrato.pdf` do aceite, servido por `/api/propostas/:id/comprovante` |
| `proposta` | `Proposta.Proposta` da proposta do contrato (aceites legados, sem artefato) |
| `nfse` | `Notas Fiscais.NFSe` |
| `boleto` | `Notas Fiscais.Boleto` |

Não existe tipo "contrato formal": o schema atual não comprova um arquivo de
contrato assinado (`Anexo Contrato` é lookup do PDF da proposta). Tipos de
arquivo aceitos: PDF, PNG, JPEG (abrir) e XML (baixar).

## Estados da área (campo `estado` da API)

| Estado | Quando | Tela |
|---|---|---|
| `disponivel` | há ao menos um contrato listável | tabela + avisos (itens recusados; proposta aceita aguardando cadastro do contrato) |
| `conferencia` | nenhum contrato listável e há proposta/contrato recusado por vínculo inválido | "Informações em conferência" |
| `processamento` | só há proposta aceita sem contrato cadastrado (o contrato é criado manualmente pela equipe) | "Preparando informações financeiras" (texto aprovado) |
| `vazio` | nada aplicável | "Nenhum contrato disponível no momento." |

Problemas de parcela não escondem o contrato: ele aparece com a situação
**Em conferência** (o código vai para o log). A API não devolve mais a
coleção `faturas`.

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
