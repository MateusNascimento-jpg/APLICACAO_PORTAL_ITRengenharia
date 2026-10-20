# Portal ITR — composição UX 20/10/2026 (proposta para revisão)

## Objetivo

Melhor aproveitamento de espaço e hierarquia editorial nas áreas autenticadas **Propostas**, **Relatórios** e, por compartilhamento de layout, **Financeiro**. A direção é institucional, superfícies opacas e sem glow/glassmorphism. Não há reconstrução do sistema, nem mudança deliberada de backend, sessão, APIs, autorização ou banco de dados.

## Alterações no código

- `public/portal.html`: títulos e textos operacionais mais concisos, cabeçalho de relatórios com empresa e atualização em posições mais úteis, indicador de quantidade de propostas, rodapé compacto com endereço do site, Privacidade, Ajuda e contato. IDs essenciais dos módulos permanecem. A página de login e o painel do Diretor não foram modificados.
- `public/assets/js/portal.js`: propostas abertas por padrão quando houver de 1 a 3; com 4+ abre apenas a de envio mais recente. Usuário pode expandir/recolher **cada uma** de forma independente. O evento mantém foco no botão. Contagem real de propostas, sem indicadores inventados. Removido apenas o código de navegação relativo aos links descartados do rodapé.
- `public/assets/css/itr-ux-composicao.css`: nova folha de estilos final, independente e reversível. Fundo e painéis sólidos em ambos os temas; layout mais largo, cabeçalhos mais fortes, cartões de proposta sem halo/blur, indicadores dos relatórios integrados em uma faixa operacional, controles e lista compactos, rodapé discreto e adaptações mobile.
- `tests/composicao-20261020.test.js`: testes específicos da abertura inicial, abertura manual e contratos do HTML.
- `tests/financeiro-frontend.test.js`: atualizada exclusivamente a expectativa do subtítulo do Financeiro para refletir a nova redação aprovada visualmente; as demais invariantes seguem intactas.

## Não alterado

- `server.js`, `config.js`, banco de dados, rotas, APIs, autenticação, recuperação de senha, arquivos de login, aceite/rejeição e downloads de relatório.
- Lógica dos KPIs/filtros de relatórios, carregamento paginado do Airtable, filtros financeiros e permissões por empresa.
- **Nenhum** envio ao GitHub, deploy ou alteração de produção foi realizado.

## Validação realizada

- `node --check public/assets/js/portal.js`: OK.
- `node --test tests/composicao-20261020.test.js tests/financeiro-frontend.test.js tests/frontend-contracts.test.js tests/original-design.test.js tests/portal-ui-refinement.test.js tests/report-tabs.test.js`: **32 aprovados / 0 falhas**.
- CSS analisado sintaticamente: **82 regras, 0 erros de parsing**.
- HTML validado quanto à duplicação de IDs e estrutura de prévia.
- A execução geral de `node --test tests/*.test.js` retornou 143 aprovações e 7 falhas antes da atualização de expectativa de texto: **6 suítes HTTP não conseguiram carregar `express`**, porque o ZIP não inclui `node_modules` e dependências não foram instaladas neste ambiente; a sétima era a expectativa antiga de redação no teste do Financeiro, corrigida e validada na suíte focada.
- A navegação automatizada do navegador foi **bloqueada pelo ambiente**, não houve confirmação visual por captura de tela automatizada. Testes ponta a ponta com backend/Airtable reais não foram realizados.

## Como revisar sem iniciar nenhum servidor

Abra `ITR_PREVIA_VISUAL_PROPOSTAS_RELATORIOS.html` em seu Chrome. É um único arquivo independente: alterna entre Propostas e Relatórios, aceita recolhimento manual e alternância de tema. **Dados fictícios**; não conecta serviços reais. A prévia ilustra o layout, mas não substitui homologação com o Portal real.

## Como testar a cópia integral sem tocar produção

1. Extraia `PORTAL_ITR_UX_PROPOSTAS_RELATORIOS_20261020.zip` numa pasta **nova** (não sobreponha sua pasta atual).
2. Preserve seu `.env` original fora do ZIP e não compartilhe tokens.
3. Use o procedimento de desenvolvimento que você já utiliza no Portal, fornecendo as configurações locais necessárias. **Não** faça `git push`, merge ou deploy antes de testar.
4. Teste login, seleção de empresa/perfil, Propostas (1, 2, 3, 4+), documentos, aceite/rejeição, Relatórios (KPIs, busca, filtros, histórico, PDF), Financeiro, Conta e responsividade.
5. Em caso de reprovação, descarte a pasta de cópia: nenhum arquivo de produção foi tocado.

## Escopo adicional sugerido — somente após aprovação visual

- Revisão fina de cabeçalho institucional e densidade da tela Financeiro.
- Ajustes finais de tipografia e espaçamento nos painéis internos após prints reais de desktop e mobile.


## Ajustes finais de aprovação (20/10/2026)

- Em `public/assets/css/itr-ux-composicao.css`, foi restaurada a pulsação da etapa final **Relatório Disponível**, usando a animação `pulsar` já existente na folha original. O efeito não se aplica às demais etapas e é desativado com `prefers-reduced-motion: reduce`.
- O título **Minha conta** passou a usar a mesma escala dos cabeçalhos Propostas e Relatórios (`clamp(27px, 2.2vw, 36px)`, peso 700).
- Dois testes de regressão CSS acrescentados a `tests/composicao-20261020.test.js`.
- Não foram alterados login, backend, APIs, sessão, Airtable, MySQL ou regras de negócio nesta revisão final.
- A suíte dirigida apresentou **34 testes aprovados**. Requer homologação visual/funcional local antes de qualquer merge/deploy.
