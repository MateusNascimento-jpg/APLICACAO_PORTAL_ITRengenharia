# Portal ITR Engenharia — 3.5.0 (24/10/2026)

Base: entrega de desenvolvimento de 23/10/2026 (3.4.1). **Não publicado.** Pronto
para revisão técnica e homologação isolada; sem E2E com MySQL/Airtable/SMTP reais.

## Financeiro — uma linha por contrato (ADR-002)
- `GET /api/financeiro` devolve **um item por contrato** (`contratos[]`) com
  `situacao`, `revisao`, `status` (contratual), `valorTotal`, `prazoPagamentoDias`,
  `proposta` e `documentos`. A coleção `faturas` **deixou de ser enviada** ao navegador.
- Situação consolidada a partir de `Notas Fiscais.Status do Pagamento`
  (`lib/financeiro/mapper.js → situacaoContrato`): Vencido > A Vencer > Aguardando
  Emissão da NF > Pago (só com todas as aplicáveis pagas); Cancelado pelo contrato;
  "Em preparação" (contrato ativo sem notas) e "Em conferência" (dado sem base
  segura). Regra completa em `docs/FINANCEIRO.md`.
- Valor total vem de `Proposta.Valor da Proposta` (`fld2lqgkDOpeKYJF5`); ausente = "—".
- Tela: tabela original preservada; colunas Contrato · Condição de pagamento · Valor
  total · Prazo para pagamento · Situação · Detalhes. Abas removidas do DOM e do CSS.
  Detalhes (recolhidos por padrão) mostram só dados gerais + Documentos.
  Separador de 14 px entre contratos. Proposta aceita ainda sem contrato aparece
  como aviso, não como linha.
- Documentos do contrato em pilha: Proposta (versão congelada) → Comprovante de
  Contrato → NFSe/boletos. A rota mantém NFSe/boletos depois dos artefatos do aceite.
- Autorização inalterada (CNPJ → Proposta Aceita → Contrato → Notas Fiscais, nos dois
  sentidos). Problemas de parcela deixam o contrato "Em conferência" em vez de ocultá-lo.

## Propostas / documentos
- Após o aceite, a seção Documentos mostra o **nome da versão congelada**
  (`nomePropostaAceita`) — não o anexo atual do Airtable — e o Comprovante.
- Ícone `file-check` adicionado ao conjunto SVG (o Comprovante aparecia sem ícone).

## Comprovante de Contrato (PDF)
- Selo "Condições comerciais" à direita do título (linguagem do modelo institucional).
- Seções curtas (Condições, Acompanhamento, Atenção, Documentos Integrais,
  Integridade) nunca se dividem entre páginas; bloco institucional continua indivisível.
- Rótulos com mais contraste, CNPJ formatado, valor ausente = "Conforme proposta".
- Aplica-se a comprovantes NOVOS; os já gravados em `portal_proposal_artifacts` são imutáveis.

## Testes e QA
- `npm run check`: 202/202 (Node 22.22.0). Testes por comportamento:
  `tests/financeiro-contrato-unico.test.js` (executa o `financeiro.js` real sobre
  `tests/helpers/mini-dom.js`), `tests/comprovante-layout-20261024.test.js`.
- Testes de 23/10 que fixavam a regra rejeitada (linha por parcela, abas) foram
  reescritos para a regra final; nenhuma defesa de segurança foi afrouxada.
- `scripts/qa-visual-portal.js` (requer Playwright instalado à parte): prova visual
  com rotas reais do Financeiro e base fictícia, sem rede externa.

## Sem migração nova
Nenhuma alteração de banco nesta versão. 004/005 (já existentes na base 23/10)
continuam pendentes de aplicação em ambiente isolado.
