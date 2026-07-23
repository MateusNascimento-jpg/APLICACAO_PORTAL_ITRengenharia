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

**O que falta no GitHub = camada VISUAL.** `portal.html` e `login.html` ainda estão na
versão antiga (fundo `#2b2e31`, com glass/`backdrop-filter`, sem abas de navegação, sem
faixa de confiança). O redesign Midnight/LTEC ainda NÃO foi aplicado ao repositório.
Abordagem combinada: **transformar o código atual por fases, preservando 100% dos IDs e
da lógica** — nunca reescrever do zero nem trocar os arquivos por outros.

**Onde estão os textos:** o texto antigo do hero ("Geotecnia de solos... transparência
radical") está no `login.html` (~linha 325, `<p class="lead">`). O `portal.html` tem sua
própria saudação (`#saudacao`: "Olá, seja muito bem-vindo(a)" + sub "Acompanhe aqui o
andamento dos seus ensaios..."). WhatsApp flutuante já existe no `login.html`, mas NÃO no
`portal.html`.

---

## ETAPA 1 — FUNCIONALIDADES (fazer agora) — 9 tarefas

Decisão do Mateus (jul/2026): **só funcionalidades por enquanto; visual depois, sob pedido
explícito.** Ordem sugerida (as duas primeiras exigem diagnóstico read-only antes de codar):

1. **Ordem de Serviço não aparece** — campo lido é `Ordem de Serviço`, o correto é
   `Link Ordem de Serviço`. Ver "Armadilha: Ordem de Serviço não aparece".
2. **Trazer a(s) Norma(s)** da tabela Ensaios para o JSON do trabalho (múltiplas separadas
   por vírgula). Ver "Funcionalidade: exibir Norma ao lado da Ordem de Serviço".
3. **Exibir `OS / Norma(s)`** no badge do card (só o texto; sem mexer em CSS).
4. **Norma entra na busca livre** (junto de ensaio, amostra, código e OS).
5. **Relatório antigo continua aparecendo** — anti-cache + download com URL fresca + flag
   `relatorio_desatualizado`. Ver "Armadilha: relatório antigo aparece após troca do PDF".
6. **E-mail com `;` ou `,` quebra o login** — `.split(/[\r\n]+/)` → `.split(/[\r\n;,]+/)`.
7. **Trocar o texto do hero** no `login.html` — ver "Texto oficial do hero".
8. **WhatsApp flutuante no `portal.html`** — copiar o `.wa-flutuante` que já existe no login.
9. **Link "Como funciona o portal?"** abaixo do botão Entrar → `/como-funciona.html`.
   Ver "Funcionalidade: guia Como funciona o portal".

### Texto oficial do hero
Substituir:
> "Geotecnia de solos e pavimentação com transparência radical. Acompanhe em tempo real o ciclo de vida das suas amostras, desde o ensaio até a análise técnica:"

Por:
> "Acompanhe cada etapa dos seus ensaios com total transparência. Consulte, em tempo real, o status das suas amostras, desde o recebimento no laboratório até a emissão dos relatórios técnicos. Mais agilidade, rastreabilidade e confiança em todas as etapas do processo."

---

## ETAPA 2 — Redesign visual Midnight/LTEC — ⛔ CONGELADO

> **NÃO EXECUTAR NADA DESTA SEÇÃO.** Decisão do Mateus (jul/2026): trabalhar **apenas
> funcionalidades** por enquanto. O visual só entra quando ele pedir explicitamente.
> Se uma tarefa de funcionalidade tocar num arquivo desta seção, mexer SÓ no que a
> funcionalidade exige — não aproveitar a visita para aplicar estilo.

### (referência para quando for liberado)

Transformar `portal.html` e `login.html` no visual Midnight/LTEC, por fases, preservando
toda a lógica. (Comandos detalhados serão passados quando a Etapa 1 estiver no ar.)
Resumo das decisões travadas abaixo.

### Navegação
Abas horizontais no topo: **Relatórios · Minha conta · Ajuda · Site ITR** (Site ITR =
link externo `https://itr.eng.br`, nova aba). Aba ativa = texto azul-claro + borda inferior
azul 3px. **Financeiro** adiado. Mobile: abas viram hambúrguer; desktop é prioridade.

### Paleta Midnight (cores exatas — CSS vars, tema escuro é o padrão)
```
--bg:#0e1116; --bg-deep:#0a0d12; --card:#151a21; --card-2:#1b212a;
--hero:#12161d; --faixa:#0a0d12;
--line:rgba(120,150,200,0.12); --line-soft:rgba(120,150,200,0.09);
--azul:#3d7be0; --azul-claro:#6fa0f0; --azul-link:#8fb6ec; --azul-bg:rgba(61,123,224,0.14);
--txt:#eef2f8; --txt-2:#b8c2d0; --txt-3:#7a879a; --txt-4:#5a6675;
--field:#0d1015; --verde-tx:#7fd6a4; --amarelo-tx:#e0c074; --raio:6px;
```
Tema claro (toggle lua/sol persistido em localStorage): `--bg:#eef1f5; --card:#fff;
--azul:#2f6bd0; --hero:#f7f9fc; --faixa:#e6eaf0`, textos escuros; logo ganha
`filter:invert(1) brightness(.25)` no claro. **Azul `#3d7be0`/`#2f6bd0` é cor de marca —
nunca mudar.** Tema padrão ao abrir = ESCURO.

### Linguagem visual (regras)
Sem glass/`backdrop-filter`; fundos sólidos. Cantos quadrados (`--raio:6px`; era 10-20px).
Bolha da timeline vira **marco QUADRADO** (radius 4px). Cards quadrados e arejados,
separação por linha/espaço, não por sombra pesada. Animação ao rolar (fade+slide-up)
PENDENTE — Mateus quer ver opções antes; respeitar `prefers-reduced-motion`.

### Estrutura do portal.html (de cima para baixo)
1. Topbar sticky (`--faixa`): logo à esquerda; à direita toggle de tema + "Sair".
2. Abas de navegação (mesma faixa) — ver Navegação.
3. Hero (largura total, `--hero`): eyebrow "PORTAL DO CLIENTE" (azul, uppercase) + `<h1>`
   "Acompanhe o andamento dos seus relatórios" (sans forte) preservando `#nomeTexto`/
   `#nomeCliente` (saudação personalizada vira eyebrow/subtítulo, sem perder IDs) +
   subtítulo com o texto oficial do hero + `#freshness` logo abaixo.
4. Seção "Resumo dos seus ensaios": 4 KPIs quadrados clicáveis que FILTRAM (Total,
   Relatórios disponíveis, Em andamento, Aguardando). Badge "X novos" no de disponíveis.
5. Seção "Seus ensaios": busca + botão Filtrar (com contador) + select de ordenação.
6. Lista de cards (`#lista`): amostra + ensaio + OS + data + timeline horizontal de 5
   etapas (marcos quadrados) + rodapé com PDF (baixar) ou status de aguardando.
7. Faixa de confiança (`--faixa`, largura total): "POR QUE A ITR / Confiança em cada laudo"
   + 4 itens: Ensaios normatizados, Dados protegidos (LGPD), Status em tempo real, Laudo oficial.
8. Rodapé institucional (3 colunas): (1) logo + descrição + redes; (2) links do Portal;
   (3) Contato (endereço, WhatsApp, e-mail, horário). Linha inferior: copyright + Sobre ·
   Política de Privacidade (LGPD). **NÃO exibir CNPJ.**
9. Botão WhatsApp flutuante (canto inf. direito, verde `#25d366`, SVG).

### Timeline — 5 etapas (nomes confirmados)
`Amostra Recebida → Ensaio em Andamento → Ensaio Concluído → Relatório em Andamento →
Relatório Disponível`. Feita = azul preenchido; atual = destaque; futura = cinza.

### Login.html (redesign)
Mateus GOSTA do login atual (a "vitrine") e quer MANTÊ-LO, só aplicando Midnight e
preenchendo o vazio à direita. Esquerda = vitrine (pill "Portal do Cliente" + `<h1>`
"Acompanhe já o recebimento de seus relatórios!" + lead com o texto oficial + timeline
vertical com marcadores quadrados + endereço). Direita = formulário "Entrar" + campo
"CNPJ de cadastro" (placeholder "Somente números") + campo "E-mail de acesso" (input
mantém `id="senha"` por compatibilidade com o JS) + "Manter conectado" + botão "Entrar".
**Remover:** "ou CPF", "Esqueci minha senha", botão de olho, "Criar conta com CNPJ".
**Adicionar (bloco de contato à direita):** "Possui alguma dúvida? / Entre em contato por
algum de nossos chats" + botão WhatsApp + linha "Conexão segura · Dados protegidos (LGPD)".
Texto de ajuda: "Acesse com o CNPJ e o e-mail cadastrados na ITR. Não é necessário criar conta."

---

## Funcionalidades a PRESERVAR (não quebrar em nenhuma etapa)

Header com logo + toggle de tema + logout + saudação personalizada + freshness indicator;
4 KPIs clicáveis que filtram + barra de progresso; busca livre por ensaio/amostra/código;
ordenação (recentes/antigos/fase); painel de filtros avançados (etapa cumulativa, tipo de
ensaio com busca interna, OS, intervalo de datas, contador de ativos, limpar); scroll
infinito (`#sentinela`, IntersectionObserver); aviso "últimos 3 meses" + "ver histórico
completo"; voltar ao topo; download de PDF aprovado com tracking em `relatorios_baixados`.

---

## Roadmap de funcionalidades (aprovadas, a implementar depois do visual)

Badge "Novo"/não-baixado nos cards + contador no KPI (dura ~7 dias, some sozinho); painel
lateral de **detalhe do trabalho deslizando da direita** (não modal/página; sem fotos do
ensaio ao cliente); exportar lista visível em **.xlsx**; baixar aprovados em lote (um a um,
trocar por ZIP se o navegador bloquear); legenda de status na Ajuda + tooltip "?" nos cards;
**toast** no lugar de `alert()` (reaproveitar de `painel.html`); último acesso na aba Minha
conta (grava MySQL `ultimo_acesso_cliente`); permalink (rola até o trabalho + destaque azul
~2s); aba **Minha conta** só leitura (email, empresa, CNPJ, último acesso, telefone); aba
**Ajuda** (FAQ + contato + legenda + changelog); **Reportar problema** (Bug/Sugestão/Dúvida)
→ `POST /api/feedback` (rota ainda não existe; tabela `feedback_clientes` já criada); página
**404** Midnight; favicon + título "Portal do Cliente — ITR Engenharia"; estado vazio (ícone
+ mensagem + botão de contato). **Cortado:** painel do diretor (não remover `painel.html`);
troca de senha pelo cliente (não há senha).

---

## Autenticação (modelo novo — já implementado no backend)

Login = CNPJ + **primeiro** e-mail do campo "Email Cliente" (Airtable, tabela Clientes,
multiline). Sem cadastro, sem "esqueci senha". `/api/login` valida contra Airtable com rate
limit por IP (20/15min). Rotas antigas → HTTP 410. JWT carrega `documento` (CNPJ).
**Decisão de segurança (Mateus ciente):** relatórios pouco sensíveis; priorizou simplicidade;
CNPJ+e-mail é menos blindado que senha, aceito conscientemente. NÃO reabrir.

**Pendências bloqueantes / de produção:**
- E-mails dos clientes ainda NÃO preenchidos no Airtable (sem isso ninguém loga). Plano
  faseado: preencher (1ª linha = e-mail oficial) → testar em paralelo → só então trocar.
- Migration `002_login_airtable.sql` rodada só no LOCAL; falta rodar na produção (HostGator).
- `JWT_SECRET` com fallback inseguro no `server.js` → configurar a env real na produção.
- Telas órfãs `cadastro.html`/`esqueci-senha.html`/`redefinir-senha.html` ainda existem
  (apontam pra rotas 410; decidir se deleta).

---

## Dados de contato (rodapé / WhatsApp / bloco do login)
- **WhatsApp:** +55 61 99564-8450 (confirmado, com o 9º dígito).
  Link: `https://api.whatsapp.com/send/?phone=5561995648450&text&type=phone_number&app_absent=0`
  (equivalente a `https://wa.me/5561995648450`).
- **E-mail:** comercial@itr.eng.br
- **Endereço:** SCIA Quadra 14 Conjunto 6 Lote 05 – Parte A, Zona Industrial, Brasília-DF, 71250-130
- **Horário:** Segunda a Sexta, 08:00–18:00
- **Instagram:** https://www.instagram.com/itr_engenharia/
- **LinkedIn:** https://www.linkedin.com/company/itr-engenharia
- **Site institucional:** itr.eng.br (botão "Site ITR", nova aba)
- Sem telefone fixo. **NÃO exibir CNPJ no rodapé.**

---

## Airtable (fonte do negócio) — IDs e armadilhas conhecidas

Base 1 — token `AIRTABLE_TOKEN`, base `AIRTABLE_BASE_ID`. Tabelas: Clientes
`tblkQxQ6q7cBKXZ3C` (campos `CNPJ` 14 díg. limpos, `Email Cliente` multiline com 1ª linha =
login, `ID Cliente` guarda NOME da empresa — dirty, `Nome Cliente` guarda descrições);
Novos Trabalhos `tblJAP4Av9sWm8SmL` (view "Resumo Diário" `viwNqYOxtZ6T8MCAJ`); Ensaios
`tblYtVM2crMxpxHgG`.

Armadilhas: campo `Nome_Completo_Ensaios ` tem **espaço no final** do nome real. Isolamento
por cliente = filtro OR `{Cliente}` + `LEFT({ID Trabalho},N)` (só o prefixo perdia 2
registros). Airtable API não ordena por `createdTime` → buscar página inteira e ordenar em
memória. HostGator MySQL sem privilégio SUPER → eventos agendados não rodam em produção.
Status real `"Relatório em Andamento"` é exibido como `"Ensaio Concluído"` (só label —
pode ser revisto com os textos novos de status; tratar como tarefa separada, é lógica/JS).

Base 2 (financeira, `appI163NTfZrDtw22`, 13 tabelas): entendida, NÃO construída. Liga à
Base 1 por **CNPJ** (14 díg., limpo, casa nos dois lados). Aba Financeiro futura, interna.

---

## Sistema irmão (contexto, não mexer)
`Emails_diarios_ITRengenharia` — app Node/Express no Render, envia e-mails diários 8h
(Brasília) por OS por cliente, lê a view "Resumo Diário". Suporta múltiplos e-mails via
`separarEmails()` (`;`/`,`). Env `MODO_TESTE` redireciona tudo para endereço de teste.
Separado do portal, compartilha o Airtable.

---

## Armadilha: relatório antigo aparece após troca do PDF (diagnosticado jul/2026)

**Sintoma:** cliente exclui o relatório antigo e anexa um novo, mas o portal continua
mostrando/baixando o PDF ANTIGO.

**Raiz:** o portal lê o PDF SÓ do campo `Relatórios_Aprovados` (função `montarTrabalho` +
`primeiroPdf` em `airtable.js`). Esse campo é preenchido por uma AUTOMAÇÃO do Airtable que
copia o PDF quando o diretor aprova. Se o anexo é trocado DEPOIS de já aprovado, a automação
não re-dispara → `Relatórios_Aprovados` fica com o PDF velho enquanto `Relatórios` já tem o
novo. O portal, lendo só o aprovado, mostra o antigo.

**Agravantes no código:** (1) respostas da API não tinham header anti-cache
(`Cache-Control: no-store`) → navegador/CDN podiam servir lista antiga; (2) links de anexo
do Airtable expiram — `urlRelatorioAprovado()` já rebusca no clique (bom), mas a lista pode
carregar URL velha.

**Correção no código (robustez):** header `Cache-Control: no-store` nas rotas de dados;
garantir que o download sempre passe pela rota que rebusca a URL fresca; flag
`relatorio_desatualizado` quando `Relatórios` for mais novo que `Relatórios_Aprovados`.

**Correção operacional (Airtable — resolve o caso na hora):** abrir o registro, limpar o
campo `Relatórios_Aprovados` e recolocar o PDF novo, OU re-disparar a aprovação (desmarcar/
remarcar `Aprovação`). Avaliar mudar o gatilho da automação para rodar também quando o campo
`Relatórios` muda, não só na aprovação.

---

## Armadilha: Ordem de Serviço não aparece (diagnosticado jul/2026)

**Sintoma:** ao abrir um cliente, a Ordem de Serviço não é exibida no card do trabalho.

**Raiz:** em `airtable.js` (~linha 287, dentro de `montarTrabalho`) o código lê
`f['Ordem de Serviço']`, mas o campo real na tabela **Novos Trabalhos** chama-se
**`Link Ordem de Serviço`** (com o prefixo `Link`, igual a `Link Ensaios` e `Link Amostras`).
Como o campo lido não existe, `traduzirOS()` recebe `undefined`, retorna `{os:null}` e a OS
some silenciosamente. Confirmado pelo Mateus: o nome exato do campo é `Link Ordem de Serviço`.

**Lição (repetida neste projeto):** os campos de vínculo em Novos Trabalhos usam o prefixo
`Link`. Nunca presumir o nome do campo — conferir no Airtable antes.

---

## Funcionalidade: exibir Norma ao lado da Ordem de Serviço

**Objetivo:** no card do trabalho, onde hoje aparece só a OS (ex.: `54-2026`), passar a
exibir `OS / Norma` (ex.: `54-2026 / NBR 6459`).

**Origem do dado:** campo **`Norma`** da tabela **Ensaios** (`tblYtVM2crMxpxHgG`). Hoje o
`mapaEnsaios` (em `carregarMapaEnsaios`, ~linha 59-60) só guarda `ID Ensaio` → `Nome do
Ensaio`; a `Norma` NÃO é lida. Precisa passar a guardar também a norma por sigla e expor no
JSON do trabalho (campo `norma`), casando pela sigla de `Link Ensaios` — mesma lógica de
fallback já usada para o nome do ensaio (chave exata + chave normalizada).

**Múltiplas normas:** se o trabalho tiver mais de um ensaio vinculado (ou o campo `Norma`
trouxer mais de um valor), juntar TODAS separadas por vírgula (ex.: `NBR 6459, NBR 7180`),
sem repetir valores iguais e ignorando vazios. Vale tanto para a exibição quanto para o filtro.

**Filtro:** adicionar a Norma como critério no filtro/busca do portal (junto de ensaio,
amostra, código e OS).

---

## Funcionalidade: guia "Como funciona o portal?" (página estática)

**O que é:** página HTML explicativa para o cliente (título "Portal do Cliente | ITR
Engenharia"), com 5 seções: acesso com dados já cadastrados; as cinco etapas de
acompanhamento; como encontrar o que precisa; relatórios aprovados no portal; CTA final.

**Características do arquivo:** 100% autocontido — CSS inline, **zero JavaScript**, sem
CDN nem dependências externas. As imagens estão embutidas em base64 (11 ocorrências).
Tamanho ~295 KB. Basta servir como arquivo estático.

**Onde colocar:** `public/como-funciona.html` (o Express já serve a pasta `public/`, então
a página fica acessível em `/como-funciona.html` sem precisar de rota nova).

**Onde linkar:** em `public/login.html`, **abaixo do botão "Entrar"**, um link com o texto
**"Como funciona o portal?"** apontando para `/como-funciona.html`.

**⚠️ Correções JÁ APLICADAS no arquivo entregue (não refazer):**
1. WhatsApp corrigido de `wa.me/5561995648480` (errado, termina em 80) para
   `wa.me/5561995648450` (correto, termina em 50) — 3 ocorrências.
2. **Legibilidade no celular:** o guia já era responsivo (viewport correto, media queries
   1000px/760px, `prefers-reduced-motion`), mas as fontes estavam quase todas abaixo de
   1rem (12-15px), pequenas demais para leitura em tela pequena; a media query de 760px
   não ajustava fonte. Foi adicionado um bloco CSS ao final do `<style>` com: corpo a 17px
   e `line-height 1.65`; `p/li/td` em 1rem; títulos redimensionados (h1 1.75rem, h2 1.4rem,
   h3 1.15rem); alvo de toque mínimo de 44px em links/botões; `img{max-width:100%}`;
   tabelas com rolagem horizontal; e um segundo breakpoint em 420px para celulares menores.
3. **Logo com fundo preto corrigida:** a logo do cabeçalho estava em WebP no modo RGB
   **sem canal alpha** — o "fundo transparente" era na verdade preto sólido `#000000`
   embutido na imagem, o que criava um retângulo preto visível sobre o fundo da página
   (`--bg:#171b20`). Foi convertida para **PNG com transparência real**: o fundo escuro
   virou alpha 0 (via limiar de luminância, com recuperação de cor nas bordas para não
   acinzentar o contorno). Agora a logo mescla com qualquer fundo, claro ou escuro.
   As outras 10 imagens do guia (prints de tela em WebP) não têm esse problema e ficaram
   inalteradas. Arquivo final ~332 KB.