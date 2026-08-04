<!--
COMO USAR: salve como CLAUDE.md na raiz do repo (mesma pasta do server.js).
Este arquivo é ADITIVO ao CLAUDE.md que você já tem — cole esta seção nova nele,
ou substitua se preferir manter só a tarefa atual. Não commite segredos.
Desligue o "Auto" do Claude Code: modo manual, aprovação diff a diff.
-->

# CLAUDE.md — Tarefa: Sidebar retrátil + enquadramento responsivo

Contexto: Portal do Cliente ITR Engenharia. Node/Express + HTML/CSS/JS vanilla,
sem framework. Frontend em public/ (portal.html, login.html, painel.html). Deploy
Render (auto-deploy da branch main). Windows + VS Code + Git Bash. Português do Brasil,
respostas objetivas. Projeto EM PRODUÇÃO — cuidado, nada de quebrar o que funciona.

## Estado atual da sidebar (JÁ EXISTE — não recriar)
No public/portal.html a Etapa 2 já entregou a sidebar. Estrutura confirmada:
- `.layout-shell` (flex) contém `.sidebar#sidebar` + `.conteudo-wrap > .conteudo`.
- `.sidebar` tem 4 itens `.sidebar-item`: `#navRelatorios` (ativo), `#navConta`,
  `#navAjuda` (link como-funciona.html), `#navSiteItr` (link externo).
- Cada item = `<i class="ti ...">` + `<span>texto</span>`.
- MOBILE já funciona: `.sidebar.aberta` (translateX), `.sidebar-overlay#sidebarOverlay`,
  botão hambúrguer `#btnMenuSidebar`, funções `abrirSidebar()`/`fecharSidebar()` (JS ~1624-1636).
  Breakpoint mobile por volta de `@media (max-width: ~760-900px)` (CSS ~590).
- DESKTOP: sidebar é fixa e sempre expandida — NÃO há retração hoje. É o que vamos add.
- Cores: usa variáveis de tema já definidas (`--azul-claro`, `--field`, `--txt`, etc.).
  NÃO introduzir paleta nova (Midnight continua congelada).
- IDs a preservar 100%: sidebar, sidebarOverlay, btnMenuSidebar, navRelatorios,
  navConta, navAjuda, navSiteItr, layout-shell, conteudo-wrap, conteudo, logoLink,
  btnTema, btnSair, painelConta, viewRelatorios, e toda a lógica de lista/filtros/KPIs.

## O que ACRESCENTAR (tarefa desta sessão) — ADITIVO
1. **Botão de colapso no DESKTOP** (ícone de "livros empilhados" = Tabler `ti-stack-2`
   ou `ti-books`; usar `ti-stack-2`). Fica no topo da própria sidebar (ou no header,
   à esquerda do logo). Ao clicar, alterna a sidebar entre EXPANDIDA e MINI (só ícones):
   - MINI: some o `<span>` de texto de cada item, ficam só os ícones; largura da sidebar
     encolhe (ex.: de ~230px para ~64px); o `.conteudo-wrap` reflui ganhando o espaço.
   - Transição suave (CSS transition na largura). Respeitar `prefers-reduced-motion`.
   - Tooltip nos ícones quando MINI (title=texto) pra manter usabilidade.
2. **Lembrar o estado** em `localStorage` (chave ex.: `sidebar_colapsada` = "1"/"0").
   Ao carregar o portal, aplicar o último estado salvo ANTES de mostrar (evitar “pulo”).
3. **Enquadramento responsivo perfeito (PC + mobile)** — sem forçar zoom:
   - Manter a meta viewport atual (`width=device-width, initial-scale=1.0`). NÃO usar
     `maximum-scale`/`user-scalable=no` (quebra acessibilidade).
   - Garantir que NADA corte ou cause scroll horizontal em nenhuma largura: usar
     `box-sizing:border-box`, larguras fluidas (%, minmax, clamp), imagens `max-width:100%`.
   - O colapso desktop e o hambúrguer mobile NÃO podem conflitar: em telas mobile,
     manter o comportamento atual (drawer + overlay); o botão de colapso mini é só desktop
     (acima do breakpoint). Abaixo do breakpoint, o botão de colapso pode ficar oculto.
   - Testar em larguras: ~360px (mobile), ~768px (tablet), ~1024px, ~1440px (desktop).

## Limites rígidos
- NÃO alterar a lógica de relatórios/KPIs/filtros/scroll/download/aba Conta.
- NÃO mexer no backend (server.js, airtable.js, db.js) — é só CSS/HTML/JS do front.
- NÃO recriar a sidebar nem o mobile drawer — só ADICIONAR o colapso desktop + o storage.
- Reusar as variáveis de tema; sem paleta nova.
- Aplicar as mesmas melhorias de enquadramento no login.html se fizer sentido (sem
  reestruturar o login — só evitar corte/scroll horizontal).

## Fluxo de trabalho
Branch nova; uma fase por vez; mostrar diff; esperar aprovação; testar `npm start`
local; NÃO dar git push (o Mateus publica depois). Auto do Claude Code DESLIGADO.