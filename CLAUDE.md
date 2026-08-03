<!--
═══════════════════════════════════════════════════════════════════════
COMO CRIAR E USAR ESTE ARQUIVO (passo a passo)
═══════════════════════════════════════════════════════════════════════
1. Salve este arquivo com o nome EXATO  CLAUDE.md  (maiúsculas + .md)
   na RAIZ do repositório — mesma pasta do package.json e do server.js.
2. Commite normalmente:
       git add CLAUDE.md
       git commit -m "docs: adiciona CLAUDE.md com contexto do projeto"
   (fica versionado no GitHub; NÃO faça push se não quiser, ele funciona local igual.)
3. Abra o projeto no VS Code e abra o painel do Claude Code. Ele lê este
   arquivo automaticamente como contexto inicial — não precisa configurar nada.
4. IMPORTANTE: antes de rodar os comandos, DESLIGUE o "Auto mode" do Claude Code
   (canto inferior do painel). Assim ele mostra cada diff e espera sua aprovação —
   essencial porque o portal está em produção.
5. Documento vivo: edite conforme surgirem decisões novas. NUNCA coloque
   segredos aqui (senhas, JWT_SECRET, tokens, credenciais de banco).
6. Se algo der errado ao aplicar mudanças, o Git te salva:
       git checkout .              (desfaz o que não foi commitado)
       git reset --hard origin/main (volta ao que está no GitHub)
   Como o Claude Code trabalha numa BRANCH, a main em produção fica intacta.
═══════════════════════════════════════════════════════════════════════
-->

# CLAUDE.md — Portal do Cliente ITR Engenharia

Contexto para o Claude Code continuar o projeto. Você está assumindo um projeto em
andamento, trabalhado com o Mateus ao longo de vários chats. Aja como dev sênior
full-stack que conhece este projeto de cor. Mateus é de TI (não é iniciante), mas
valoriza didática nos pontos delicados de infra/deploy/banco. Respostas objetivas,
em tópicos, em português do Brasil.

---

## Sobre o projeto

Portal web onde os **clientes** da ITR Engenharia (laboratório de ensaios geotécnicos,
Brasília/DF) acompanham o ciclo de vida dos seus ensaios (timeline de 5 fases) e baixam
os relatórios técnicos (PDFs) quando aprovados. Repo:
`MateusNascimento-jpg/APLICACAO_PORTAL_ITRengenharia`, branch `main`.

- **Backend:** Node.js + Express (`server.js`). Auth por JWT (Bearer, não cookie).
- **Frontend:** HTML/CSS/JS vanilla, sem framework. Uma tela por `.html` em `public/`.
  CSS e JS inline em cada HTML. Ícones = Tabler Icons em SVG inline. Fonte Segoe UI.
- **Bancos:** MySQL (HostGator, produção) só para apoio (tracking de download, último
  acesso, histórico, feedback — NÃO guarda senha). Airtable = fonte da verdade do negócio.
- **Deploy:** Render (free tier, Ohio), auto-deploy do GitHub (branch `main`),
  `npm start`. UptimeRobot pinga a cada 5 min. Domínio `portal.itr.eng.br`.
- **Ambiente de dev:** Windows, VS Code, Git Bash, GitHub Desktop.

### Fluxo de trabalho (regras de ouro — portal em PRODUÇÃO)
- **Diagnóstico antes de código.** Toda tarefa que toca Airtable: rodar script de
  diagnóstico read-only e conferir o resultado ANTES de escrever feature. Os nomes/
  formatos de campos do Airtable divergem repetidamente do esperado. Nunca presumir nome.
- **Preservar o que funciona.** Ao redesenhar, manter 100% dos IDs e da lógica que já
  roda. Mudança visual não pode quebrar funcionalidade.
- **Uma coisa de cada vez, testável.** Fases isoladas, nunca big-bang.
- **Trabalhar em branch, mostrar diff, esperar aprovação, testar local, só então push.**
- Editar arquivo no VS Code NÃO muda produção. Editar `.sql` no VS Code NÃO muda o banco.
  São passos separados (PC → GitHub via push → Render → ar).

---

## Estado atual do código (o que já está no ar vs o que falta)

**Backend JÁ está no ar e validado — NÃO mexer.** `server.js` e `airtable.js` já têm o
login novo completo: CNPJ + 1º e-mail do Airtable, rate limit por IP (20/15min), rotas
antigas (cadastro/esqueci-senha/redefinir) em HTTP 410, `documento` (CNPJ) no JWT. O login
por CNPJ+e-mail já funciona em produção.

**Etapa 1 de funcionalidades:** CONCLUÍDA e mergeada na `main` (OS via `Link Ordem de
Serviço`, Norma no badge `OS | Norma`, busca por norma, anti-cache do relatório, split de
e-mail com `;`/`,`, hero novo no login, WhatsApp flutuante no portal, link "Como funciona").
Página `como-funciona.html` no ar. Cache eterno de OS/Ensaios corrigido (TTL 5 min).

**O que estamos fazendo AGORA = ETAPA 2 (visual, ADITIVA).** Ver seção abaixo.

---

## ⭐ ETAPA 2 (ATUAL) — Sidebar + Rodapé institucional + aba Conta — ADITIVA

> **REGRA MESTRA DESTA ETAPA (decisão explícita do Mateus, jul/2026):**
> **NÃO mudar NADA na estrutura existente, nas cores atuais, nem nas relações do
> projeto — tudo já funciona.** Esta etapa é 100% ADITIVA: só ACRESCENTA uma barra
> lateral (sidebar) de navegação, um rodapé institucional e uma aba "Conta". A paleta
> **Midnight fica CONGELADA** (não aplicar). Preservar as cores atuais do portal.
> Preservar 100% dos IDs, classes, CSS e JS já existentes.

### O que ACRESCENTAR (e só isto)

1. **Sidebar (menu lateral)** ao lado do conteúdo atual, SEM alterar o conteúdo:
   - Itens: **Relatórios** (ativo — é a tela atual/home), **Conta** (abre painel de
     dados mascarados), **Ajuda** (link para `/como-funciona.html`), **Site ITR**
     (link externo `https://itr.eng.br`, nova aba).
   - Usa as MESMAS variáveis de cor/tema já existentes no `portal.html` (respeita o
     toggle `data-tema="claro"`; padrão escuro). NÃO introduzir a paleta Midnight.
   - Ícones no mesmo padrão do projeto (Tabler `<i class="ti ...">`).
   - No mobile: a sidebar vira menu hambúrguer (botão abre/fecha; overlay). Desktop é
     prioridade. Fechar ao clicar num item ou no overlay.

2. **Rodapé institucional (3 colunas)** ao final do conteúdo, ANTES de fechar `.conteudo`
   (pode substituir/englobar a atual `.marca-rodape`, mantendo a frase de marca):
   - Col 1: logo + descrição curta + ícones de redes (Instagram, LinkedIn).
   - Col 2: links do Portal (Relatórios, Conta, Ajuda, Site ITR).
   - Col 3: Contato — endereço, WhatsApp, e-mail, horário.
   - Linha inferior: copyright + "Sobre · Política de Privacidade (LGPD)".
   - **NÃO exibir CNPJ no rodapé.** Cores = as atuais (variáveis de tema já existentes).

3. **Aba "Conta"** (clique em Conta na sidebar) — painel/seção só-leitura com os dados de
   login **MASCARADOS/censurados**: **CNPJ** e **e-mail**.
   - **SEM rota nova, SEM tocar no backend.** Os dados já estão disponíveis no front:
     - `nomeEmpresa` e `documento` (CNPJ) vêm de `GET /api/perfil` (rota já existe,
       devolve `req.usuario`) — ou do JWT já guardado.
     - O **e-mail** é o que o cliente digitou no login: guardar no `login.html` em
       `localStorage`/`sessionStorage` (espelhando o token) no momento do submit, e ler
       no `portal.html`. Nada disso muda relação nem backend.
   - **Máscara sugerida (só exibição):**
     - CNPJ `12345678000190` → `12.***.***/**90` (mostra começo e 2 últimos díg.).
     - E-mail `contato@empresa.com` → `co****@e*****.com` (1ª letra do usuário + 1ª do
       domínio; preserva o TLD). Ajustar o padrão com o Mateus se ele quiser outro.
   - Campos exibidos: Empresa (nome), CNPJ (mascarado), E-mail de acesso (mascarado).
     "Último acesso" e "telefone" ficam para depois (exigiriam MySQL/Airtable).

4. **Logo do topo → volta para a tela de login (SEM deslogar).**
   - No `portal.html`, o logo do cabeçalho é `<a id="logoLink" href="#">` e hoje só volta
     ao topo da página. Alterar para navegar até `login.html` **mantendo a sessão**
     (NÃO limpar o token; isso é diferente do botão "Sair", que faz logout).
   - Basta `window.location.href = 'login.html';` (ou `href="login.html"`), sem tocar em
     `localStorage`/`sessionStorage`. O botão "Sair" (`#btnSair`) continua igual: limpa o
     token e vai para `login.html`.
   - `login.html` NÃO tem auto-redirect por token (só redireciona após login bem-sucedido),
     então a tela de login abre normalmente e a sessão permanece ativa em segundo plano.

### O que NÃO fazer nesta etapa (limites rígidos)
- NÃO aplicar a paleta Midnight (continua congelada).
- NÃO trocar cores, fontes, cantos, sombras, glass ou qualquer estilo existente.
- NÃO mexer em `server.js`, `airtable.js`, `db.js` nem em nenhuma rota/relação.
- NÃO renomear/remover IDs, classes ou funções já existentes.
- NÃO alterar KPIs, filtros, busca, ordenação, scroll infinito, download nem timeline.
- NÃO criar rota `/api/minha-conta` agora (a aba Conta é 100% front nesta fase).

### IDs/estruturas que DEVEM continuar intactos no `portal.html`
`.conteudo` (max-width 1080px), `header.topo` (logo + `#btnTema`/`#iconeTema` + `#btnSair`),
`.saudacao` com `#saudacao #nomeCliente #nomeTexto`, `#freshness`/`#freshnessTxt`,
`section.resumo` (`#kpiTotal #kpiProntos #kpiAndamento #kpiAguardando`), filtros,
`#lista`, `#sentinela`, `#aoTopo`, `#logoLink` (mantém o ID; só muda o destino do clique
para `login.html`), o canvas `#campo` e `#vinheta` do fundo animado,
e todo o `<script>` atual (iniciar, IntersectionObserver, toggle de tema).
No `login.html`: preservar `id="senha"` (é o campo de e-mail) e o fluxo do `fetch('/api/login')`.

---

## ⭐ TAREFA AVULSA (ATUAL) — Construir painel.html do diretor (do zero) + login + downloads

> Objetivo do Mateus (nova semana): (1) ao logar com a conta do DIRETOR, cair
> direto no `painel.html` (a "tela do diretor"), e (2) o diretor conseguir ver
> **quem baixou os relatórios** — selo por trabalho + lista dedicada. É ADITIVO:
> NÃO mudar o fluxo do cliente, o login do cliente, o download em si, nem as
> relações do Airtable.

### Contexto do que JÁ existe (não refazer)
- O download JÁ é registrado: `registrarDownload(cnpj, recordIdTrabalho)` grava em
  MySQL `relatorios_baixados (cnpj, record_id_trabalho, baixado_em)`, com UNIQUE
  `(cnpj, record_id_trabalho)` — ou seja, "baixou ou não" + quando. NÃO alterar.
- Backend do diretor JÁ existe: `somenteDiretor` (middleware), `/api/diretor/clientes`,
  `/api/diretor/trabalhos/:clienteId`, `PATCH /api/trabalho/:id/aprovacao`.
- **`public/painel.html` está VAZIO (0 linhas).** O arquivo foi criado mas nunca
  preenchido. Portanto o painel do diretor será CONSTRUÍDO DO ZERO (não é edição). Todo
  o backend do diretor já existe (rotas abaixo); só falta o front. Espelhe o visual do
  `portal.html` (mesmas variáveis de tema/cores, fundo blueprint, toggle de tema) para
  manter coerência — SEM paleta Midnight.
- Funções de Airtable reutilizáveis p/ enriquecer: `listarClientes()` (nome da empresa
  por registro/CNPJ), `carregarMapaOS()` + `traduzirOS()` (record → "OS 28"),
  `formatar()` (monta trabalho com `id_trabalho` e OS, mesma lógica do portal).

### Contratos das rotas que o painel consome (já existem, salvo /downloads)
- `GET /api/perfil` → `{ sucesso, usuario:{ perfil, documento, airtableId, nomeEmpresa } }`.
  Usar para barrar quem não é Diretor (redireciona p/ login).
- `GET /api/diretor/clientes` → `{ sucesso, clientes:[{ id, nome, idCliente }] }` (as bolhas).
- `GET /api/diretor/trabalhos/:clienteId?modo=todos` (ou `?modo=recente`, default 6 meses)
  → `{ sucesso, trabalhos:[{ id, id_trabalho, os, aprovacao, ... }], offset }`.
- `PATCH /api/trabalho/:id/aprovacao` body `{ valor:"Aprovado"|"Refazer"|"Em Andamento" }`
  → `{ sucesso, aprovacao }`. A automação do Airtable copia o PDF ao virar "Aprovado".
- `GET /api/diretor/downloads` (A CRIAR nesta tarefa).
Auth: todas exigem header `Authorization: Bearer <token>` (mesmo padrão do portal.html).

### Como o DIRETOR passa a logar no painel (decisão de arquitetura)
Problema: o login novo (`POST /api/login`) devolve `perfil: 'Cliente'` FIXO (server.js
~linha 198). Logo, ninguém loga como Diretor hoje, e o `destinoPorPerfil()` do
`login.html` (que já manda `Diretor → painel.html`) nunca dispara.

Solução (sem senha nova, sem e-mail hardcoded, Airtable continua validando):
- Adicionar env var **`DIRETOR_CNPJ`** (ex.: `43736713000120`). NUNCA commitar valor
  real; vai no `.env` local e nas Environment Variables do Render.
- No `/api/login`, DEPOIS de validar CNPJ + e-mail contra o Airtable normalmente
  (o e-mail do diretor continua sendo conferido no Airtable como qualquer cliente),
  se `documento === process.env.DIRETOR_CNPJ`, montar `usuario.perfil = 'Diretor'`
  em vez de `'Cliente'`. Nada mais muda: `criarToken` já coloca `perfil` no JWT, e o
  `login.html` já roteia Diretor → `painel.html`.
- Credencial de teste do diretor: CNPJ `43736713000120`, e-mail `naoresponda@itr.eng.br`
  (esse e-mail precisa estar no campo "Email Cliente" do registro correspondente no
  Airtable para a validação passar). Diretor histórico: Vinícius Levay.
- Consequência: o `somenteDiretor` (que checa `perfil === 'Diretor'`) passa a funcionar
  de verdade para essa conta, liberando as rotas do painel.

### O que ACRESCENTAR / CONSTRUIR
0. **Painel base** (`painel.html` do zero): guarda de acesso (só Diretor, senão volta a
   login), bolhas de clientes (`/api/diretor/clientes`), ao clicar carrega os trabalhos
   (`/api/diretor/trabalhos/:id`), cada trabalho com botões de aprovação três-estados
   (`PATCH .../aprovacao` → Aprovado/Refazer/Em Andamento). Header com logo + toggle de
   tema + sair, no mesmo estilo do portal.
1. **Rota de leitura** `GET /api/diretor/downloads` (middlewares `[autenticado,
   somenteDiretor]`): `SELECT cnpj, record_id_trabalho, baixado_em FROM
   relatorios_baixados ORDER BY baixado_em DESC` (aceitar `?limit=`, default 500).
   Enriquecer cada linha cruzando com Airtable (empresa via `listarClientes()`; OS/id
   via mapa OS + `formatar`). Fallback para valor cru se o cruzamento falhar — nunca
   derrubar a rota. Responder `{ sucesso, downloads:[{cnpj, empresa, record_id, os,
   id_trabalho, baixado_em}] }`.
2. **Selo por trabalho** no `painel.html`: em cada trabalho do cliente aberto, mostrar
   "Baixado ✓" (verde, com data no tooltip) ou "Não baixado" (cinza), cruzando no front
   por `cnpj + record_id` com `/api/diretor/downloads`. Não mexer nos botões de aprovação.
3. **Aba/lista "Downloads"** no `painel.html`: histórico completo (Empresa | Relatório
   (OS/id) | Data-hora pt-BR), mais recente primeiro, com busca simples no front.

### Limites rígidos desta tarefa
- NÃO tocar em `registrarDownload` nem nas rotas de download existentes.
- NÃO alterar o login/roteamento do CLIENTE (só ADICIONAR o ramo do Diretor).
- NÃO hardcodar CNPJ nem e-mail no código — CNPJ do diretor só via `DIRETOR_CNPJ`.
- Reusar as cores/estilo atuais do `painel.html`; não introduzir paleta nova.
- Paleta Midnight continua CONGELADA.

---

## ETAPA 3 (futura) — Redesign visual Midnight/LTEC — ⛔ CONGELADO

> **NÃO EXECUTAR.** A paleta Midnight (cards sólidos, cantos retos 4px, timeline quadrada,
> tema escuro reformulado) só entra quando o Mateus pedir explicitamente. Se uma tarefa
> tocar num arquivo aqui, mexer SÓ no que a tarefa da Etapa 2 exige — não aplicar estilo.

### (referência para quando for liberado)
Paleta Midnight, abas horizontais no topo, faixa de confiança, hero full-width, etc.
Ver histórico do projeto para as cores exatas e a estrutura completa. **Azul `#3d7be0`/
`#2f6bd0` é cor de marca — nunca mudar.**

---

## Funcionalidades a PRESERVAR (não quebrar em nenhuma etapa)

Header com logo + toggle de tema + logout + saudação personalizada + freshness indicator;
4 KPIs clicáveis que filtram + barra de progresso; busca livre por ensaio/amostra/código/
OS/norma; ordenação (recentes/antigos/fase); painel de filtros avançados (etapa cumulativa,
tipo de ensaio com busca interna, OS, intervalo de datas, contador de ativos, limpar);
scroll infinito (`#sentinela`, IntersectionObserver); aviso "últimos 3 meses" + "ver
histórico completo"; voltar ao topo; download de PDF aprovado com tracking em
`relatorios_baixados`.

---

## Roadmap de funcionalidades (aprovadas, a implementar depois)

Badge "Novo"/não-baixado nos cards + contador no KPI (dura ~7 dias, some sozinho); painel
lateral de **detalhe do trabalho deslizando da direita** (não modal/página; sem fotos do
ensaio ao cliente); exportar lista visível em **.xlsx**; baixar aprovados em lote (um a um,
trocar por ZIP se o navegador bloquear); legenda de status na Ajuda + tooltip "?" nos cards;
**toast** no lugar de `alert()` (reaproveitar de `painel.html`); **último acesso** na aba
Conta (grava MySQL `ultimo_acesso_cliente` — fase separada, exige rota); permalink (rola até
o trabalho + destaque azul ~2s); aba **Ajuda** completa (FAQ + contato + legenda +
changelog); **Reportar problema** (Bug/Sugestão/Dúvida) → `POST /api/feedback` (rota ainda
não existe; tabela `feedback_clientes` já criada); página **404**; favicon + título "Portal
do Cliente — ITR Engenharia"; estado vazio (ícone + mensagem + botão de contato).
**Cortado:** painel do diretor (não remover `painel.html`); troca de senha pelo cliente
(não há senha).

---

## Autenticação (modelo novo — já implementado no backend, NÃO reabrir)

Login = CNPJ + **primeiro** e-mail do campo "Email Cliente" (Airtable, tabela Clientes,
multiline). Sem cadastro, sem "esqueci senha". `/api/login` valida contra Airtable com rate
limit por IP (20/15min). Rotas antigas → HTTP 410. JWT carrega `documento` (CNPJ),
`airtableId`, `nomeEmpresa`, `perfil`. Rota `GET /api/perfil` devolve `req.usuario`.
**Decisão de segurança (Mateus ciente):** relatórios pouco sensíveis; priorizou
simplicidade; CNPJ+e-mail é aceito conscientemente. NÃO reabrir.

**Pendências bloqueantes / de produção:**
- E-mails dos clientes ainda NÃO preenchidos no Airtable (sem isso ninguém loga). Plano
  faseado: preencher (1ª linha = e-mail oficial) → testar em paralelo → só então trocar.
- Migration `002_login_airtable.sql` rodada só no LOCAL; falta rodar na produção (HostGator).
- `JWT_SECRET` com fallback inseguro no `server.js` → configurar a env real na produção.
- **`DIRETOR_CNPJ`** (novo): definir no `.env` local e no Render para o diretor cair no
  painel. Sem ela, ninguém loga como Diretor (login novo devolve 'Cliente' por padrão).
- Telas órfãs `cadastro.html`/`esqueci-senha.html`/`redefinir-senha.html` ainda existem
  (apontam pra rotas 410; decidir se deleta).

---

## Dados de contato (rodapé / WhatsApp / sidebar)
- **WhatsApp:** +55 61 99564-8450 (confirmado, com o 9º dígito). Link: `https://wa.me/5561995648450`.
- **E-mail:** comercial@itr.eng.br
- **Endereço:** SCIA Quadra 14 Conjunto 6 Lote 05 – Parte A, Zona Industrial, Brasília-DF, 71250-130
- **Horário:** Segunda a Sexta, 08:00–18:00
- **Instagram:** https://www.instagram.com/itr_engenharia/
- **LinkedIn:** https://www.linkedin.com/company/itr-engenharia
- **Site institucional:** itr.eng.br (item "Site ITR", nova aba)
- Sem telefone fixo. **NÃO exibir CNPJ no rodapé.**

---

## Airtable (fonte do negócio) — IDs e armadilhas conhecidas

Base 1 — token `AIRTABLE_TOKEN`, base `AIRTABLE_BASE_ID`. Tabelas: Clientes
`tblkQxQ6q7cBKXZ3C` (campos `CNPJ` 14 díg. limpos, `Email Cliente` multiline com 1ª linha =
login, `ID Cliente` guarda NOME da empresa — dirty); Novos Trabalhos `tblJAP4Av9sWm8SmL`
(view "Resumo Diário" `viwNqYOxtZ6T8MCAJ`); Ensaios `tblYtVM2crMxpxHgG`.

Armadilhas: campo `Nome_Completo_Ensaios ` tem **espaço no final**. Campos de vínculo em
Novos Trabalhos usam prefixo `Link` (`Link Ordem de Serviço`, `Link Ensaios`, `Link
Amostras`). Isolamento por cliente = filtro OR `{Cliente}` + `LEFT({ID Trabalho},N)`.
Airtable API não ordena por `createdTime` → buscar tudo e ordenar em memória. HostGator
MySQL sem SUPER → eventos agendados não rodam em produção. Cache de OS/Ensaios agora tem
TTL de 5 min (era eterno). Nunca presumir nome de campo — conferir no Airtable antes.

Base 2 (financeira, `appI163NTfZrDtw22`, 13 tabelas): entendida, NÃO construída. Liga à
Base 1 por **CNPJ** (14 díg.). Aba Financeiro futura, interna.

---

## Sistema irmão (contexto, não mexer)
`Emails_diarios_ITRengenharia` — app Node/Express no Render, envia e-mails diários 8h
(Brasília) por OS por cliente, lê a view "Resumo Diário". Múltiplos e-mails via
`separarEmails()` (`;`/`,`). Env `MODO_TESTE`. Separado do portal, compartilha o Airtable.