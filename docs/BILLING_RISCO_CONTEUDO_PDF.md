# Risco residual: conteúdo do PDF e dados do Airtable

**Decisão da ITR:** sem leitor de PDF ou OCR. A conferência operacional dos documentos ocorre antes de sua inclusão no Airtable. **Essa conferência não constitui verificação automatizada do conteúdo interno do PDF.**

## O que o sistema confere

- O arquivo é um PDF íntegro, e o conteúdo enviado é o mesmo que foi cadastrado (SHA-256 dos bytes).
- A parcela está vinculada ao cliente e ao CNPJ corretos no Airtable.
- A situação de pagamento e os destinatários são relidos antes de cada envio.

## O que o sistema não confere

O conteúdo impresso no PDF. Valor, vencimento, beneficiário, pagador e linha digitável não são comparados com o Airtable.

| Cenário | Efeito | Proteção restante |
|---|---|---|
| PDF de outro cliente anexado à parcela | **O boleto vai para o cliente errado, com dados de terceiros** | Conferência do Financeiro |
| PDF com valor ou vencimento diferente do Airtable | O e-mail mostra um dado e o anexo mostra outro | Conferência do Financeiro; o aviso de atualização só de dados pede contato em caso de divergência |
| Beneficiário ou linha digitável incorretos, por erro ou fraude | O cliente pode pagar a conta errada | Conferência do Financeiro e controle de quem edita o Airtable |
| Vencimento alterado no Airtable sem novo PDF | O e-mail informa a nova data, e o PDF mantém a antiga | Texto do aviso de atualização só de dados |

Esses cenários não geram retenção nem auditoria, porque o sistema não tem como percebê-los.

## Como reduzir o risco, sem leitor de PDF

- Restringir quem pode editar as tabelas financeiras no Airtable.
- Manter a conferência antes do cadastro como procedimento formal.
- Começar pelo piloto, com poucos clientes.

**Pendente:** aceite formal da ITR sobre este risco.
