# Portal ITR — Refinamento visual (16/10/2026)

## Base e escopo

Este pacote foi preparado a partir do artefato `APLICACAO_PORTAL_ITRengenharia-3.4.0_PROPOSTAS.zip`, que contém o Portal 3.4.0. Trata-se de uma revisão **exclusivamente de interface**, sem alterações em backend, banco MySQL, Airtable, autenticação, sessão, API ou configuração de e-mails.

As mudanças não foram implantadas em produção. Antes de mesclar qualquer branch ao `main`, comparar com o estado corrente do repositório e validar em ambiente isolado: o deployment do Portal é automático a partir de `main`.

## O que mudou

1. Substituída a mensagem `Verificando funcionalidades disponíveis…` por um skeleton responsivo e sem texto técnico visível. O skeleton permanece até a resolução da consulta de navegação. O rodapé não aparece sozinho durante a consulta.
2. Navegação continua fail-closed: `navPropostas` e `navRelatorios` começam ocultos e só são revelados após autorização real da API. Em falha, os módulos permanecem ocultos e aparece erro discreto com `Tentar novamente`. O retry reinicia o skeleton.
3. Carregamento da lista de propostas exibe skeleton antes do resultado, mantendo feedback de erro e retry.
4. O card **expandido** de proposta ganha um halo azul difuso e borda discreta; cards fechados mantêm estilo neutro. Estados aprovados/rejeitados preservam marcadores.
5. Compactados espaçamentos de cabeçalho, timeline, documento, blocos comerciais e rodapé, inclusive em mobile; conteúdo e campos comerciais continuam iguais.
6. Skeleton sem animação quando a preferência do dispositivo é `prefers-reduced-motion: reduce`. Estados de carregamento comunicados a tecnologia assistiva, foco visível preservado.

## Arquivos funcionais alterados

- `public/portal.html`
- `public/assets/js/portal.js`
- `public/assets/css/original-portal.css`

Arquivos adicionais de documentação/testes/manifests de distribuição:

- `tests/portal-ui-refinement.test.js`
- `docs/UI_REFINAMENTO_2026-10-16.md`
- `MANIFESTO_APLICACAO.json` (atualização de hashes da revisão)
- `.itr-release.json` (integridade SHA-256 do artefato atualizado)

## Validação local realizada

- `node scripts/verify.js`: aprovado, 81 arquivos `.js` passaram em `node --check`.
- `node --test tests/portal-ui-refinement.test.js`: quatro testes aprovados.
- Chromium headless com HTML/CSS/JS locais e APIs simuladas: desktop 1440px, mobile 390px, falha `/api/navegacao`: cenários aprovados sem erros JavaScript e sem rolagem horizontal nos cenários normais testados.
- Os testes funcionais completos (`npm test`) **não foram concluídos** neste ambiente: `npm ci` falhou e a dependência `express` não estava instalada. Em execução parcial, 94/99 passaram e 5 falharam por dependências indisponíveis. Rodar `npm ci` e `npm test` em ambiente com rede/Node 22 antes de qualquer merge.
- Não foram testados login real, PDFs reais, navegação contra Airtable ou ações comerciais em produção.

## Estratégia de homologação e rollback

1. Na cópia local da aplicação atual, conferir que os arquivos-alvo correspondem à base 3.4.0.
2. Fazer backup dos arquivos que serão substituídos; preservar `.env`, `.git` e demais recursos não alterados.
3. Aplicar apenas os arquivos do patch e executar `node scripts/verify.js`, `node scripts/verify-release-manifest.js`, `node --test tests/portal-ui-refinement.test.js` e `npm test` (dependências instaladas).
4. Abrir o Portal em localhost nos temas claro e escuro, desktop/tablet/celular, cobrindo erro/retry, Conta, Propostas, Relatórios e PDF.
5. Publicar em **branch de revisão**, nunca fazer merge automático no `main` antes da homologação. Em caso de falha, repor o backup dos arquivos visuais.

**Variáveis de ambiente:** nenhuma mudança necessária. **Migrações SQL:** nenhuma.
