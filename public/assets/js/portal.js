(function(){try{if(localStorage.getItem('sidebar_colapsada')==='1'){var shell=document.querySelector('.layout-shell');if(shell)shell.classList.add('sidebar-mini');}}catch(e){}})();

/* ---- bloco original seguinte ---- */

/* =========================================================================
   ÍCONES SVG INLINE (sem dependência de CDN/rede)
   Cada ícone <i class="ti ti-NOME"> é trocado pelo SVG correspondente ao
   carregar a página. Assim os ícones SEMPRE aparecem, mesmo sem internet
   ou com o CDN bloqueado. Paths originais da biblioteca Tabler (MIT).
   ========================================================================= */
var TI_SVG = {
  'sol':'<circle cx="12" cy="12" r="4"/><path d="M3 12h1M20 12h1M12 3v1M12 20v1M5.6 5.6l.7 .7M17.7 17.7l.7 .7M18.4 5.6l-.7 .7M6.3 17.7l-.7 .7"/>',
  'lua':'<path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z"/>',
  'loader-2':'<path d="M12 3a9 9 0 1 0 9 9"/>',
  'search':'<circle cx="10" cy="10" r="7"/><path d="M21 21l-6 -6"/>',
  'refresh':'<path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/>',
  'wifi-off':'<path d="M12 18l.01 0"/><path d="M9.172 15.172a4 4 0 0 1 5.656 0"/><path d="M6.343 12.343a8 8 0 0 1 11.314 0"/><path d="M3.515 9.515c4.686 -4.687 12.284 -4.687 17 0"/><path d="M3 3l18 18"/>',
  'test-pipe':'<path d="M20 8.04l-12.122 12.124a2.857 2.857 0 1 1 -4.041 -4.04l12.122 -12.124"/><path d="M7 13h8"/><path d="M19 15l1.5 1.6a2 2 0 1 1 -3 0l1.5 -1.6z"/><path d="M15 3l6 6"/>',
  'search-off':'<path d="M3 3l18 18"/><path d="M18.5 11.5a6.5 6.5 0 0 0 -9 -9m-2.42 1.57a6.5 6.5 0 0 0 9.27 9.19"/><path d="M21 21l-6 -6"/>',
  'logout':'<path d="M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2"/><path d="M9 12h12l-3 -3"/><path d="M18 15l3 -3"/>',
  'history':'<path d="M12 8l0 4l2 2"/><path d="M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5"/>',
  'folder-open':'<path d="M5 19l2.757 -7.351a1 1 0 0 1 .936 -.649h12.307a1 1 0 0 1 .986 1.164l-.996 5.211a2 2 0 0 1 -1.964 1.625h-14.026a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v2"/>',
  'flask':'<path d="M9 3l6 0"/><path d="M10 9l4 0"/><path d="M10 3v6l-4 11a.7 .7 0 0 0 .5 1h11a.7 .7 0 0 0 .5 -1l-4 -11v-6"/>',
  'eraser':'<path d="M19 20h-10.5l-4.21 -4.3a1 1 0 0 1 0 -1.41l10 -10a1 1 0 0 1 1.41 0l5 5a1 1 0 0 1 0 1.41l-9.2 9.3"/><path d="M18 13.3l-6.3 -6.3"/>',
  'clock-pause':'<path d="M20.942 13.018a9 9 0 1 0 -8.942 7.982"/><path d="M12 7v5l2 2"/><path d="M17 17v5"/><path d="M21 17v5"/>',
  'clock':'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  'clipboard-text':'<path d="M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2"/><path d="M9 3m0 2a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v0a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2z"/><path d="M9 12h6"/><path d="M9 16h6"/>',
  'chevron-down':'<path d="M6 9l6 6l6 -6"/>',
  'check':'<path d="M5 12l5 5l10 -10"/>',
  'calendar-event':'<path d="M4 5m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z"/><path d="M16 3v4"/><path d="M8 3v4"/><path d="M4 11h16"/><path d="M8 15h2v2h-2z"/>',
  'calendar-clock':'<path d="M11.795 21h-6.795a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v4"/><path d="M18 18m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"/><path d="M15 3v4"/><path d="M7 3v4"/><path d="M3 11h16"/><path d="M18 16.496v1.504l1 1"/>',
  'building':'<path d="M3 21l18 0"/><path d="M9 8l1 0"/><path d="M9 12l1 0"/><path d="M9 16l1 0"/><path d="M14 8l1 0"/><path d="M14 12l1 0"/><path d="M14 16l1 0"/><path d="M5 21v-16a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v16"/>',
  'arrow-up':'<path d="M12 5l0 14"/><path d="M16 9l-4 -4"/><path d="M8 9l4 -4"/>',
  'adjustments-horizontal':'<path d="M14 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M4 6l8 0"/><path d="M16 6l4 0"/><path d="M8 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M4 12l2 0"/><path d="M10 12l10 0"/><path d="M17 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M4 18l11 0"/><path d="M19 18l1 0"/>',
  'user':'<path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"/><path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/>',
  'help':'<path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/><path d="M12 17l0 .01"/><path d="M12 13.5a1.5 1.5 0 0 1 1 -1.5a2.6 2.6 0 1 0 -3 -4"/>',
  'external-link':'<path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6"/><path d="M11 13l9 -9"/><path d="M15 4h5v5"/>',
  'file-description':'<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"/><path d="M9 17h6"/><path d="M9 13h6"/>',
  'menu-2':'<path d="M4 6l16 0"/><path d="M4 12l16 0"/><path d="M4 18l16 0"/>',
  'stack-2':'<path d="M12 4l-8 4l8 4l8 -4l-8 -4"/><path d="M4 12l8 4l8 -4"/><path d="M4 16l8 4l8 -4"/>',
  'mail':'<path d="M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10z"/><path d="M3 7l9 6l9 -6"/>',
  'brand-instagram':'<path d="M4 4m0 4a4 4 0 0 1 4 -4h8a4 4 0 0 1 4 4v8a4 4 0 0 1 -4 4h-8a4 4 0 0 1 -4 -4z"/><path d="M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"/><path d="M16.5 7.5l0 .01"/>',
  'brand-linkedin':'<path d="M4 4m0 2a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z"/><path d="M8 11l0 5"/><path d="M8 8l0 .01"/><path d="M12 16l0 -5"/><path d="M16 16v-3a2 2 0 0 0 -4 0"/>',
  'send':'<path d="M3 20l18 -8l-18 -8l4 8z"/><path d="M7 12h14"/>',
  'hourglass':'<path d="M6 3h12"/><path d="M6 21h12"/><path d="M8 3c0 5 8 5 8 9s-8 4-8 9"/>',
  'circle-check':'<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3l5 -6"/>',
  'circle-x':'<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6"/><path d="M15 9l-6 6"/>',
  'clock-x':'<circle cx="12" cy="12" r="9"/><path d="M12 7v5"/><path d="M15 15l3 3"/><path d="M18 15l-3 3"/>',
  /* Financeiro (nav e documentos) */
  'file-invoice':'<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"/><path d="M9 7l1 0"/><path d="M9 13l6 0"/><path d="M13 17l2 0"/>',
  'barcode':'<path d="M4 7v-1a2 2 0 0 1 2 -2h2"/><path d="M4 17v1a2 2 0 0 0 2 2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v1"/><path d="M16 20h2a2 2 0 0 0 2 -2v-1"/><path d="M5 11h1v2h-1z"/><path d="M10 11l0 2"/><path d="M14 11h1v2h-1z"/><path d="M19 11l0 2"/>',
  'download':'<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"/><path d="M7 11l5 5l5 -5"/><path d="M12 4l0 12"/>'
};
function svgIcone(nome){
  var corpo = TI_SVG[nome];
  if(!corpo) return '';
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+corpo+'</svg>';
}
/* Troca todos os <i class="ti ti-NOME"> da página pelo SVG correspondente.
   Mantém as classes (para o CSS de animação girar etc. continuar valendo). */
function aplicarIcones(raiz){
  (raiz||document).querySelectorAll('i.ti').forEach(function(el){
    if(el.getAttribute('data-svg-ok')) return;
    var nome = '';
    el.classList.forEach(function(c){ if(c.indexOf('ti-')===0) nome=c.slice(3); });
    var svg = svgIcone(nome);
    if(svg){ el.innerHTML = svg; el.setAttribute('data-svg-ok','1'); }
  });
}
if(document.readyState!=='loading') aplicarIcones();
else document.addEventListener('DOMContentLoaded', function(){ aplicarIcones(); });

/* =========================================================================
   PORTAL DO CLIENTE — ITR Engenharia
   A interface usa exclusivamente os endpoints reais do Portal. A camada
   visual fica separada para manter a integração legível e fácil de testar.
   ========================================================================= */

/* O fundo técnico agora é um SVG estático e discreto aplicado pelo CSS. */

/* ---- As 4 etapas oficiais da timeline (ordem e grafia exatas) ---- */
/* ---- As 4 etapas: 'valor' = texto REAL do Airtable | 'rotulo' = texto exibido ----
   Tradução pedida: "Relatório em Andamento" (Airtable) aparece como "Ensaio Concluído".
   Cada etapa também aponta qual campo de DATA do Airtable a representa. */
var ETAPAS = [
  { valor:'Amostra Recebida',       rotulo:'Amostra Recebida',       campoData:'Data de Chegada' },
  { valor:'Ensaio em Andamento',    rotulo:'Ensaio em Andamento',    campoData:'Data Início Ensaio' },
  { valor:'Ensaio Concluído',       rotulo:'Ensaio Concluído',       campoData:'Data de Conclusão do Ensaio' },
  { valor:'Relatório em Andamento', rotulo:'Relatório em Andamento', campoData:null },
  { valor:'Relatório Disponível',   rotulo:'Relatório Disponível',   campoData:'Data de Envio do Relatório' }
];
var VALORES_ETAPA = ETAPAS.map(function(e){ return e.valor; });

/* ---- DADOS DE EXEMPLO (fictícios — só para o preview visual) ----
   Cobrem todos os casos: aprovado c/ PDF, preparando PDF, em andamento,
   aguardando (timeline vazia) e cancelado. */


var NOME_CLIENTE = 'Sua empresa';

/* ---- Estado ---- */
var TODOS = [];          // todos os trabalhos carregados
var filtroEtapas = new Set();
var filtroEnsaios = new Set();
var filtroOS = new Set();
var filtroBusca = '';
var filtroDe = '', filtroAte = '';
var filtroKpi = '';   // '', 'prontos', 'andamento', 'aguardando' (atalho dos cards de cima)
var ordem = 'recentes';
var visiveis = [];       // após aplicar filtros
var mostrados = 0;       // quantos já estão na tela (scroll infinito)
var LOTE = 20;

/* ---- Utilidades ---- */
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function normalizar(s){ return String(s==null?'':s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }
function formatarData(iso){
  if(!iso) return '—';
  var p = String(iso).slice(0,10).split('-');
  if(p.length!==3) return '—';
  return p[2]+'/'+p[1]+'/'+p[0];
}
// Mapeia o status REAL do Airtable + flags para o índice da etapa (0..4).
// O Airtable usa "Relatório em Andamento" para o que o cliente vê como
// "Ensaio Concluído". A nova etapa real "Relatório em Andamento" (índice 3)
// vem do flag relatorio_em_andamento (tem relatório gerado, sem aprovação).
function indiceEtapaDe(t){
  if(!t) return -1;
  if(t.pdf) return 4;                          // Relatório Disponível (aprovado)
  if(t.relatorio_em_andamento) return 3;       // Relatório em Andamento (gerado, não aprovado)
  var s = t.status_cliente || '';
  if(s === 'Relatório Disponível') return 4;
  if(s === 'Relatório em Andamento') return 2; // (Airtable) = Ensaio Concluído p/ cliente
  if(s === 'Ensaio Concluído') return 2;
  if(s === 'Ensaio em Andamento') return 1;
  if(s === 'Amostra Recebida') return 0;
  return -1; // vazio/aguardando
}
// Compatibilidade: versão antiga que recebia só o status (usada em alguns pontos)
function indiceEtapa(statusCliente){
  if(typeof statusCliente === 'object') return indiceEtapaDe(statusCliente);
  return indiceEtapaDe({ status_cliente: statusCliente });
}

/* ---- Contadores (sempre TOTAL geral, não mudam com filtro) ---- */
function atualizarContadores(){
  var total = TODOS.length;
  var prontos = TODOS.filter(function(t){ return t.pdf; }).length;
  var aguardando = TODOS.filter(function(t){ return indiceEtapaDe(t)<0 && !t.cancelado; }).length;
  var andamento = total - prontos - aguardando; // o resto está em alguma fase intermediária
  if(andamento<0) andamento=0;
  document.getElementById('kpiTotal').textContent = total;
  document.getElementById('kpiProntos').textContent = prontos;
  document.getElementById('kpiAndamento').textContent = andamento;
  document.getElementById('kpiAguardando').textContent = aguardando;

  // barras de progresso (proporção sobre o total) + micro-info
  function pct(n){ return total>0 ? Math.round(n/total*100) : 0; }
  var bP=document.getElementById('barProntos'), bA=document.getElementById('barAndamento'), bG=document.getElementById('barAguardando');
  if(bP) bP.style.width = pct(prontos)+'%';
  if(bA) bA.style.width = pct(andamento)+'%';
  if(bG) bG.style.width = pct(aguardando)+'%';
  var sP=document.getElementById('subProntos'), sA=document.getElementById('subAndamento'), sG=document.getElementById('subAguardando');
  if(sP) sP.textContent = pct(prontos)+'% do total · prontos';
  if(sA) sA.textContent = pct(andamento)+'% do total · em análise';
  if(sG) sG.textContent = pct(aguardando)+'% do total · na fila';
}

/* ---- Atualização e atividade recente: derivadas dos dados já carregados. ---- */
function dataValida(valor){
  var d = valor ? new Date(valor) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}
function atualizarFreshness(trabalhos){
  var el = document.getElementById('freshnessTxt');
  if(!el) return;
  var datas = (trabalhos || []).map(function(t){ return dataValida(t.data_ordenacao || t.data); }).filter(Boolean);
  if(!datas.length){ el.textContent = 'Dados sincronizados com o laboratório'; return; }
  var ultima = new Date(Math.max.apply(null, datas.map(function(d){ return d.getTime(); })));
  el.textContent = 'Última movimentação em ' + ultima.toLocaleDateString('pt-BR') + ' às ' + ultima.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
}
/* ---- Monta os chips de "tipo de ensaio" a partir dos dados ---- */
var LIMITE_CHIPS_RECOLHIDO = 8; // quantos chips mostrar antes do "ver todos"
function montarChipsEnsaio(){
  var nomes = {};
  // Ignora os marcados como "lixo" (ID de trabalho vazado / "a 3" etc.).
  // Siglas legítimas sem nome completo CONTINUAM aparecendo.
  TODOS.forEach(function(t){ if(!t.ensaio_lixo && t.ensaio) nomes[t.ensaio]=true; });
  var box = document.getElementById('chipsEnsaio');
  box.innerHTML = '';
  Object.keys(nomes).sort(function(a,b){ return a.localeCompare(b,'pt',{sensitivity:'base'}); }).forEach(function(nome){
    var b = document.createElement('button');
    b.className='chip'; b.textContent=nome; b.setAttribute('data-ensaio', nome);
    b.setAttribute('type','button');
    if(filtroEnsaios.has(nome)) b.classList.add('on');
    b.addEventListener('click', function(){
      if(filtroEnsaios.has(nome)){ filtroEnsaios.delete(nome); b.classList.remove('on'); }
      else { filtroEnsaios.add(nome); b.classList.add('on'); }
      aplicarFiltros();
    });
    box.appendChild(b);
  });
  aplicarBuscaEnsaio(); // aplica o estado de busca/recolhimento atual
}

/* Filtra os chips de ensaio pela busca interna e controla o "ver todos" */
var ensaioJaInicializado = false;
function aplicarBuscaEnsaio(){
  var termo = normalizar(document.getElementById('buscaEnsaio').value);
  var box = document.getElementById('chipsEnsaio');
  var btn = document.getElementById('verTodosEnsaio');
  var chips = Array.prototype.slice.call(box.querySelectorAll('.chip'));

  // 1) aplica a busca: esconde os que não casam
  var visiveisBusca = [];
  chips.forEach(function(c){
    var casa = !termo || normalizar(c.textContent).indexOf(termo) >= 0;
    c.classList.toggle('oculto', !casa);
    if(casa) visiveisBusca.push(c);
  });

  // 2) mensagem se nada casar
  var msg = box.parentNode.querySelector('.sem-chip');
  if(visiveisBusca.length === 0){
    if(!msg){ msg=document.createElement('div'); msg.className='sem-chip'; box.parentNode.insertBefore(msg, btn); }
    msg.textContent = 'Nenhum tipo encontrado.';
  } else if(msg){ msg.remove(); }

  // 3) na primeira montagem, começa RECOLHIDO quando há muitos chips
  if(!ensaioJaInicializado){
    if(chips.length > LIMITE_CHIPS_RECOLHIDO) box.classList.remove('expandido');
    else box.classList.add('expandido');
    ensaioJaInicializado = true;
  }

  // 4) recolhimento: só faz sentido quando NÃO há busca ativa
  var expandido = box.classList.contains('expandido');
  if(termo){
    // buscando: mostra todos os que casam, sem recolher, esconde o botão
    box.classList.add('expandido');
    btn.style.display = 'none';
  } else {
    if(chips.length > LIMITE_CHIPS_RECOLHIDO){
      btn.style.display = 'flex';
      var span = btn.querySelector('span');
      span.textContent = expandido ? 'Ver menos' : ('Ver todos ('+chips.length+')');
      btn.classList.toggle('aberto', expandido);
    } else {
      btn.style.display = 'none';
      box.classList.add('expandido'); // poucos: mostra todos sem recolher
    }
  }
}

/* ---- Monta os chips de Ordem de Serviço a partir dos dados ---- */
function montarChipsOS(){
  var nomes = {};
  TODOS.forEach(function(t){ if(t.os) nomes[t.os]=true; });
  var box = document.getElementById('chipsOS');
  box.innerHTML = '';
  Object.keys(nomes).sort(function(a,b){ return a.localeCompare(b, 'pt', {numeric:true}); }).forEach(function(nome){
    var b = document.createElement('button');
    b.className='chip'; b.textContent=nome; b.setAttribute('data-os', nome);
    b.addEventListener('click', function(){
      if(filtroOS.has(nome)){ filtroOS.delete(nome); b.classList.remove('on'); }
      else { filtroOS.add(nome); b.classList.add('on'); }
      aplicarFiltros();
    });
    box.appendChild(b);
  });
}
/* ---- Aplica filtros + ordenação ---- */
function aplicarFiltros(){
  var termos = normalizar(filtroBusca).split(/\s+/).filter(Boolean);
  visiveis = TODOS.filter(function(t){
    // busca multi-palavra em ensaio + sigla + amostra + OS + norma
    if(termos.length){
      var alvo = normalizar(t.ensaio+' '+t.sigla+' '+t.amostra+' '+(t.os||'')+' '+(t.norma||''));
      for(var i=0;i<termos.length;i++){ if(alvo.indexOf(termos[i])<0) return false; }
    }
    // etapa (CUMULATIVO): marcar "Amostra Recebida" mostra todos que JÁ
    // passaram por essa fase (todos, no fundo); marcar "Relatório Disponível"
    // mostra só os que CHEGARAM lá. A regra: o trabalho aparece se já alcançou
    // PELO MENOS UMA das etapas marcadas (índice atual >= índice da etapa).
    if(filtroEtapas.size){
      var idxAtual = indiceEtapaDe(t); // -1 se vazio/aguardando
      var passouEmAlguma = false;
      filtroEtapas.forEach(function(etValor){
        var idxFiltro = VALORES_ETAPA.indexOf(etValor);
        if(idxFiltro >= 0 && idxAtual >= idxFiltro) passouEmAlguma = true;
      });
      if(!passouEmAlguma) return false;
    }
    // tipo de ensaio
    if(filtroEnsaios.size && !filtroEnsaios.has(t.ensaio)) return false;
    // ordem de serviço
    if(filtroOS.size && !filtroOS.has(t.os)) return false;
    // datas
    if(filtroDe && (!t.data || t.data < filtroDe)) return false;
    if(filtroAte && (!t.data || t.data > filtroAte)) return false;
    // atalho dos cards de cima (KPI) — usa as MESMAS regras dos contadores
    if(filtroKpi){
      if(filtroKpi==='prontos' && !t.pdf) return false;
      if(filtroKpi==='aguardando' && !(indiceEtapaDe(t)<0 && !t.cancelado)) return false;
      if(filtroKpi==='andamento'){
        // "em andamento" = nem pronto (PDF), nem aguardando, nem cancelado
        var ehAguardando = indiceEtapaDe(t)<0 && !t.cancelado;
        if(t.pdf || ehAguardando || t.cancelado) return false;
      }
    }
    return true;
  });

  // ordenação — usa a data de ATUALIZAÇÃO (mais recente = mexido por último),
  // com fallback na data principal do card se faltar.
  function chaveOrd(t){ return t.data_ordenacao || t.data || ''; }
  visiveis.sort(function(a,b){
    if(ordem==='recentes') return chaveOrd(b).localeCompare(chaveOrd(a));
    if(ordem==='antigos') return chaveOrd(a).localeCompare(chaveOrd(b));
    if(ordem==='fase'){
      var ia=indiceEtapaDe(a), ib=indiceEtapaDe(b);
      if(ib!==ia) return ib-ia; // mais avançadas primeiro
      return chaveOrd(b).localeCompare(chaveOrd(a));
    }
    return 0;
  });

  // marcador de filtros ativos
  var n = filtroEtapas.size + filtroEnsaios.size + filtroOS.size + (filtroDe?1:0) + (filtroAte?1:0);
  var tag = document.getElementById('tagFiltros');
  if(n>0){ tag.style.display='inline-block'; tag.textContent=n; }
  else tag.style.display='none';

  mostrados = 0;
  document.getElementById('lista').innerHTML='';
  renderizarMais();
  atualizarContagem();
}

function atualizarContagem(){
  var c = document.getElementById('contagem');
  var n = visiveis.length;
  c.textContent = n===0 ? '' : (n===1 ? '1 ensaio' : n+' ensaios');
}

/* ---- Monta o HTML de um card ---- */
function montarCard(t){
  var idx = indiceEtapaDe(t);

  // Pré-cálculo das datas coerentes: percorre as etapas em ordem e só aceita
  // uma data se ela for >= à última data válida anterior. Datas que "voltam no
  // tempo" (ex.: conclusão ANTES da chegada — comum quando a Data de Chegada
  // vem de outra tabela e foi cadastrada depois) são DESCARTADAS, para o
  // cliente não ver uma cronologia impossível. O dado real no Airtable não muda.
  var datasCoerentes = {};
  var ultimaValida = null;
  ETAPAS.forEach(function(et){
    var bruta = (t.datas && t.datas[et.campoData]) ? String(t.datas[et.campoData]).slice(0,10) : null;
    if(!bruta){ datasCoerentes[et.campoData] = null; return; }
    if(ultimaValida && bruta < ultimaValida){
      // data fora de ordem -> esconde (não atualiza ultimaValida)
      datasCoerentes[et.campoData] = null;
    } else {
      datasCoerentes[et.campoData] = bruta;
      ultimaValida = bruta;
    }
  });

  var tlHtml = '';
  if(idx<0 && !t.cancelado){
    tlHtml = '<div class="tl-vazia"><i class="ti ti-clock-pause" aria-hidden="true"></i>Aguardando início do processo</div>';
  } else {
    var ets = ETAPAS.map(function(et,i){
      var cls = i<idx ? 'feito' : (i===idx ? 'atual' : '');
      if(idx<0) cls='';
      var ico = i<idx ? '<i class="ti ti-check"></i>' : (i===idx ? '<i class="ti ti-loader-2"></i>' : (i+1));
      // data só nas etapas concluídas (índice < idx) E que sejam cronologicamente coerentes
      var dataEt = '';
      if(i<idx && datasCoerentes[et.campoData]){
        dataEt = '<div class="lbl-data">'+formatarData(datasCoerentes[et.campoData])+'</div>';
      }
      return '<div class="et '+cls+'"><div class="bolha">'+ico+'</div><div class="lbl">'+et.rotulo+'</div>'+dataEt+'</div>';
    }).join('');
    tlHtml = '<div class="tl">'+ets+'</div>';
  }

  // rodapé do card (PDF)
  var acao = '';
  if(t.pdf){
    acao = '<div class="acao"><div class="pdf-pronto">'
      + '<div class="pdf-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4"/><path d="M5 18h1.5a1.5 1.5 0 0 0 0 -3h-1.5v6"/><path d="M17 18h2"/><path d="M20 15h-3v6"/><path d="M11 15v6h1a2 2 0 0 0 2 -2v-2a2 2 0 0 0 -2 -2h-1z"/></svg></div>'
      + '<div class="pdf-txt"><div class="t">Relatório técnico</div><div class="s">Disponível para download</div></div>'
      + '</div>'
      + '<a class="btn-baixar" href="#" data-download-id="' + esc(t.id) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:17px;height:17px"><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"/><path d="M7 11l5 5l5 -5"/><path d="M12 4l0 12"/></svg>Baixar relatório</a></div>';
  } else if(t.preparando){
    acao = '<div class="acao"><div class="aguardando-pdf"><i class="ti ti-loader-2" aria-hidden="true"></i>Aprovado — preparando o PDF…</div></div>';
  } else if(!t.cancelado){
    acao = '<div class="acao"><div class="sem-pdf"><i class="ti ti-clock" aria-hidden="true"></i>O relatório ficará disponível aqui assim que for concluído.</div></div>';
  }

  // AMOSTRA: agora é o TÍTULO do card (com ícone de tubo de ensaio).
  // Nome completo; "+N" se houver mais de uma amostra no trabalho.
  var amostraTxt = t.amostra || '—';
  var amostraHtml = '<span class="amostra-nome-completo">'+esc(amostraTxt)+'</span>';
  var extraHtml = (t.amostra_extra && t.amostra_extra > 0)
    ? '<span class="extra" title="Mais '+t.amostra_extra+' amostra(s) neste trabalho">+'+t.amostra_extra+'</span>'
    : '';

  // OS / NORMA: etiqueta na linha de apoio (junto do ensaio). "+N" se houver mais de uma OS.
  // Com OS e norma -> "OS | Norma(s)"; só OS -> só a OS; só norma -> só a norma; nenhum -> nada.
  // Separador "|" (não "/"): muitas normas já têm barra no próprio nome (ex.: "DNIT 134/2018-ME"),
  // e usar "/" também como separador OS/Norma virava ambíguo (parecia 3 OS em vez de 1 OS + 1 norma).
  var osExtra = (t.os_extra && t.os_extra > 0) ? ' +'+t.os_extra : '';
  var osNormaTxt = (t.os && t.norma) ? (t.os+' | '+t.norma) : (t.os || t.norma || '');
  var osHtml = osNormaTxt ? '<span class="os-tag"><i class="ti ti-clipboard-text" aria-hidden="true"></i>'+esc(osNormaTxt)+esc(osExtra)+'</span>' : '';

  var card = document.createElement('div');
  card.className = 'work'+(t.cancelado?' cancelado':'');
  card.innerHTML =
    '<div class="cab"><div style="min-width:0">'
    + '<div class="amostra-titulo"><i class="ti ti-test-pipe" aria-hidden="true"></i><span style="min-width:0">'+amostraHtml+'</span>'+extraHtml+'</div>'
    + '<div class="ensaio"><i class="ti ti-flask" aria-hidden="true"></i><span>'+esc(t.ensaio)+'</span>'+osHtml+'</div>'
    + '</div>'
    + '<div class="data"><i class="ti ti-calendar-event" aria-hidden="true"></i>'+formatarData(t.data)+'</div></div>'
    + tlHtml + acao;
  return card;
}

function expandir(el){
  var span = el.previousElementSibling;
  span.textContent = span.getAttribute('data-full');
  el.remove();
}
window.expandir = expandir;

/* ---- Baixar/abrir relatório aprovado. A sessão fica no cookie HttpOnly. ---- */
function baixarRelatorio(ev, idTrabalho){
  if(ev) ev.preventDefault();
  if(!idTrabalho) return false;
  var botao = ev && ev.target && ev.target.closest('[data-download-id]');
  if(botao && botao.getAttribute('aria-busy') === 'true') return false;
  if(botao) botao.setAttribute('aria-busy', 'true');
  var trabalho = TODOS.find(function(t){ return t.id === idTrabalho; });
  var quantidade = trabalho && Number.isInteger(trabalho.relatorios_quantidade) && trabalho.relatorios_quantidade > 0 ? trabalho.relatorios_quantidade : 1;
  var abas = [];
  function mostrarArquivos(titulo, arquivos, mensagem){
    var antigo = document.querySelector('.relatorios-dialog');
    if(antigo) antigo.remove();
    var dialog = document.createElement('dialog');
    dialog.className = 'relatorios-dialog';
    var heading = document.createElement('h2');
    heading.textContent = titulo;
    dialog.setAttribute('aria-label', titulo);
    dialog.appendChild(heading);
    if(mensagem){ var texto = document.createElement('p'); texto.textContent = mensagem; dialog.appendChild(texto); }
    if(arquivos && arquivos.length){
      var lista = document.createElement('ul');
      lista.className = 'relatorios-lista';
      arquivos.forEach(function(a, index){
        var item = document.createElement('li');
        var nome = document.createElement('span');
        nome.textContent = a.arquivo || ('Relatório ' + (index + 1) + '.pdf');
        var link = document.createElement('a');
        link.href = a.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.className = 'relatorios-abrir'; link.textContent = 'Abrir PDF';
        link.setAttribute('aria-label', 'Abrir PDF: ' + nome.textContent);
        item.appendChild(nome); item.appendChild(link); lista.appendChild(item);
      });
      dialog.appendChild(lista);
    }
    var fecharBotao = document.createElement('button');
    fecharBotao.type = 'button'; fecharBotao.className = 'relatorios-fechar'; fecharBotao.textContent = 'Fechar';
    fecharBotao.addEventListener('click', function(){ dialog.close(); });
    dialog.appendChild(fecharBotao);
    dialog.addEventListener('close', function(){ dialog.remove(); if(botao) botao.focus(); });
    document.body.appendChild(dialog);
    dialog.showModal();
  }
  function fechar(aba){ try{ if(aba && !aba.closed) aba.close(); }catch(_){} }
  // Abre durante o clique, antes do fetch. noopener como feature impediria obter a referência.
  for(var i=0; i<quantidade; i++){
    var aba = null;
    try{
      aba = window.open('', '_blank');
      if(aba){
        aba.opener = null;
        aba.document.title = 'Preparando PDF — ITR';
        aba.document.body.textContent = 'Preparando seu relatório. Aguarde alguns instantes…';
      }
    }catch(_){ fechar(aba); aba = null; }
    abas.push(aba);
  }
  fetch('/api/trabalho/' + encodeURIComponent(idTrabalho) + '/download', {
    credentials: 'same-origin', cache: 'no-store'
  }).then(function(resp){
    if(resp.status === 401){ throw new Error('Sua sessão expirou. Entre novamente no Portal para abrir os relatórios.'); }
    if(resp.status === 403){ throw new Error('Você não tem permissão para abrir estes relatórios.'); }
    return resp.json().then(function(dados){
      if(!resp.ok || !dados.sucesso) throw new Error(dados.erro || 'Os relatórios não estão disponíveis para download.');
      return dados;
    });
  }).then(function(dados){
    var arquivos = Array.isArray(dados.arquivos) ? dados.arquivos : (dados.url ? [{url:dados.url,arquivo:dados.arquivo}] : []);
    if(!arquivos.length) throw new Error('Nenhum PDF aprovado foi encontrado.');
    arquivos.forEach(function(a){
      // Só navega para o proxy autenticado deste trabalho, nunca URLs fornecidas pelo cliente.
      var u = new URL(a.url, window.location.origin);
      if(u.origin !== window.location.origin || u.pathname !== '/api/relatorio/' + encodeURIComponent(idTrabalho)) throw new Error('Não foi possível validar o endereço do relatório.');
    });
    var pendentes = [];
    arquivos.forEach(function(a, index){
      var aba = abas[index];
      if(aba && !aba.closed){
        try{ aba.location.replace(a.url); abas[index] = null; }
        catch(_){ fechar(aba); abas[index] = null; pendentes.push(a); }
      }else{ pendentes.push(a); }
    });
    abas.forEach(fechar);
    if(pendentes.length){
      mostrarArquivos('Relatórios disponíveis', pendentes, 'Abra os PDFs abaixo em novas guias.');
    }
  }).catch(function(error){
    abas.forEach(fechar);
    mostrarArquivos('Não foi possível abrir os relatórios', [], error.message || 'Tente novamente em alguns instantes.');
  }).finally(function(){ if(botao) botao.removeAttribute('aria-busy'); });
  return false;
}

// Conteúdo dos cards é dinâmico; delegação evita atributos onclick e mantém a CSP forte.
document.getElementById('lista').addEventListener('click', function(ev){
  var baixar = ev.target.closest('[data-download-id]');
  if(baixar){ baixarRelatorio(ev, baixar.getAttribute('data-download-id')); return; }
  var ler = ev.target.closest('[data-expandir]');
  if(ler){ expandir(ler); }
});

/* ---- Scroll infinito: renderiza o próximo lote ---- */
function renderizarMais(){
  var lista = document.getElementById('lista');
  var fim = Math.min(mostrados+LOTE, visiveis.length);
  for(var i=mostrados;i<fim;i++){
    var card = montarCard(visiveis[i]);
    card.style.animationDelay = ((i-mostrados)*0.04)+'s';
    lista.appendChild(card);
  }
  mostrados = fim;

  // estado vazio
  if(visiveis.length===0){
    lista.innerHTML = estadoVazio();
  }
  aplicarIcones(lista); // converte os ícones recém-inseridos em SVG
}

function estadoVazio(){
  var temFiltro = filtroEtapas.size || filtroEnsaios.size || filtroBusca || filtroDe || filtroAte;
  if(temFiltro){
    return '<div class="estado"><div class="ico-grande"><i class="ti ti-search-off"></i></div>'
      + '<h2>Nenhum ensaio encontrado</h2><p>Tente ajustar a busca ou limpar os filtros para ver mais resultados.</p></div>';
  }
  return '<div class="estado"><div class="ico-grande"><i class="ti ti-folder-open"></i></div>'
    + '<h2>Ainda não há relatórios disponíveis</h2><p>Assim que seus ensaios forem concluídos, eles aparecerão aqui.</p></div>';
}

function mostrarErro(){
  document.getElementById('lista').innerHTML =
    '<div class="estado erro"><div class="ico-grande"><i class="ti ti-wifi-off"></i></div>'
    + '<h2>Não foi possível carregar seus dados</h2><p>Verifique sua conexão e tente novamente.</p>'
    + '<button class="btn-baixar" id="btnTentarNovamente" type="button"><i class="ti ti-refresh"></i>Tentar de novo</button></div>';
  var tentar = document.getElementById('btnTentarNovamente');
  if(tentar) tentar.addEventListener('click', iniciar);
}

/* ---- Esqueleto de carregamento (cards-fantasma) ---- */
function mostrarFantasmas(){
  var lista = document.getElementById('lista');
  lista.innerHTML='';
  for(var i=0;i<4;i++){
    lista.innerHTML += '<div class="ghost"><div class="bar l1"></div><div class="bar l2"></div><div class="bar l3"></div></div>';
  }
}

/* ---- CARREGAR DADOS (servidor real) ----
   Busca os trabalhos do cliente em /api/meus-dados, seguindo o 'offset' do
   Airtable até trazer todas as páginas do modo pedido ('recente' ou 'todos').
   Assim os filtros funcionam sobre tudo que foi carregado. */
var MODO_ATUAL = 'recente';

async function carregarDados(modo, aoChegarPagina){
  var todos = [];
  var offset = null;
  var nome = null;
  var paginas = 0;
  do {
    var url = '/api/meus-dados?modo=' + encodeURIComponent(modo);
    if(offset) url += '&offset=' + encodeURIComponent(offset);
    var resp = await fetch(url, { credentials:'same-origin', cache:'no-store' });
    if(resp.status === 401 || resp.status === 403){ window.location.replace('/login.html'); return []; }
    if(!resp.ok) throw new Error('Falha ao carregar dados');
    var dados = await resp.json();
    if(!dados.sucesso) throw new Error(dados.erro || 'Falha ao carregar dados');
    nome = dados.nome_cliente || nome;
    (dados.trabalhos || []).forEach(function(t){ todos.push(t); });
    offset = dados.offset || null;
    paginas += 1;
    NOME_CLIENTE = nome || NOME_CLIENTE;
    if(typeof aoChegarPagina === 'function') aoChegarPagina(todos.slice(), !!offset, paginas);
  } while(offset && paginas < 120);
  return todos;
}

function iniciar(){
  mostrarFantasmas();
  var primeiraLeva = true;
  carregarDados(MODO_ATUAL, function(acumulado, temMais, paginas){
    // Atualiza a tela a cada página que chega — o cliente vê os primeiros
    // cards quase na hora, e a lista vai "crescendo" enquanto o resto carrega.
    TODOS = acumulado;
    var _nt=document.getElementById('nomeTexto'); if(_nt) _nt.textContent = NOME_CLIENTE;
    atualizarContadores();
    sincronizarKpis();
    montarChipsEnsaio();
    montarChipsOS();
    // só re-renderiza a lista inteira na 1ª leva e quando terminar; nas páginas
    // intermediárias, atualiza contadores/chips sem destruir o scroll do usuário.
    if(primeiraLeva){
      aplicarFiltros();
      primeiraLeva = false;
    } else {
      // atualiza a contagem e, se o usuário ainda não rolou, mantém a lista fluida
      atualizarContagem();
    }
    mostrarIndicadorCarregando(temMais);
  }).then(function(dados){
    TODOS = dados;
    atualizarContadores();
    sincronizarKpis();
    montarChipsEnsaio();
    montarChipsOS();
    aplicarFiltros();          // render final completo (filtros sobre TUDO)
    mostrarIndicadorCarregando(false);
    atualizarBotaoHistorico();
    atualizarFreshness(TODOS);
  }).catch(function(){ mostrarErro(); });
}
window.iniciar = iniciar;

/* Indicador discreto de "ainda carregando o restante" no fim da lista */
function mostrarIndicadorCarregando(ativo){
  var el = document.getElementById('carregandoMais');
  if(!el){
    el = document.createElement('div');
    el.id = 'carregandoMais';
    el.style.cssText = 'text-align:center;color:var(--txt-4);font-size:12.5px;padding:14px 0;display:flex;align-items:center;justify-content:center;gap:7px;';
    el.innerHTML = '<i class="ti ti-loader-2" style="animation:girar 1s linear infinite"></i> Carregando o restante dos seus ensaios...';
    var lista = document.getElementById('lista');
    lista.parentNode.insertBefore(el, lista.nextSibling);
    aplicarIcones(el);
  }
  el.style.display = ativo ? 'flex' : 'none';
}

/* ---- Botão "ver histórico completo" ---- */
function atualizarBotaoHistorico(){
  var area = document.getElementById('areaHistorico');
  if(MODO_ATUAL === 'recente'){
    area.style.display = 'block';
  } else {
    area.style.display = 'none';
  }
}
document.getElementById('btnHistorico').addEventListener('click', function(){
  var btn = this;
  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader-2" aria-hidden="true"></i>Carregando histórico...';
  aplicarIcones(btn);
  MODO_ATUAL = 'todos';
  mostrarFantasmas();
  carregarDados('todos').then(function(dados){
    TODOS = dados;
    atualizarContadores();
    montarChipsEnsaio();
    montarChipsOS();
    aplicarFiltros();
    atualizarBotaoHistorico();
    atualizarFreshness(TODOS);
  }).catch(function(){ mostrarErro(); });
});

/* ---- Eventos ---- */
document.getElementById('btnFiltrar').addEventListener('click', function(){
  var p = document.getElementById('painelFiltros');
  p.classList.toggle('aberto');
  this.classList.toggle('ativo', p.classList.contains('aberto'));
});
document.getElementById('busca').addEventListener('input', function(){ filtroBusca=this.value; aplicarFiltros(); });
document.getElementById('buscaEnsaio').addEventListener('input', function(){ aplicarBuscaEnsaio(); });
document.getElementById('verTodosEnsaio').addEventListener('click', function(){
  var box = document.getElementById('chipsEnsaio');
  box.classList.toggle('expandido');
  aplicarBuscaEnsaio();
});
document.getElementById('ordenar').addEventListener('change', function(){ ordem=this.value; aplicarFiltros(); });
document.getElementById('dataDe').addEventListener('change', function(){ filtroDe=this.value; aplicarFiltros(); });
document.getElementById('dataAte').addEventListener('change', function(){ filtroAte=this.value; aplicarFiltros(); });
document.querySelectorAll('#chipsEtapa .chip').forEach(function(b){
  b.addEventListener('click', function(){
    var et=this.getAttribute('data-etapa');
    if(filtroEtapas.has(et)){ filtroEtapas.delete(et); this.classList.remove('on'); }
    else { filtroEtapas.add(et); this.classList.add('on'); }
    aplicarFiltros();
  });
});

/* ---- Cards de cima (KPI) como filtro rápido ---- */
function sincronizarKpis(){
  document.querySelectorAll('.kpi').forEach(function(k){
    var tipo = k.getAttribute('data-kpi');
    var ativo = (tipo === filtroKpi) || (tipo === 'todos' && !filtroKpi);
    // "Total de ensaios" só fica aceso quando NÃO há filtro de KPI (estado neutro)
    if(tipo === 'todos') ativo = !filtroKpi;
    k.classList.toggle('ativo', ativo);
    k.setAttribute('aria-pressed', ativo ? 'true' : 'false');
  });
}
document.querySelectorAll('.kpi').forEach(function(k){
  k.addEventListener('click', function(){
    var tipo = this.getAttribute('data-kpi');
    if(tipo === 'todos'){
      filtroKpi = '';               // "Total" limpa o atalho (mostra tudo)
    } else if(filtroKpi === tipo){
      filtroKpi = '';               // clicar de novo no mesmo desliga
    } else {
      filtroKpi = tipo;             // ativa o atalho escolhido
    }
    sincronizarKpis();
    aplicarFiltros();
  });
});
document.getElementById('btnLimpar').addEventListener('click', function(){
  filtroEtapas.clear(); filtroEnsaios.clear(); filtroOS.clear(); filtroDe=''; filtroAte=''; filtroBusca='';
  filtroKpi='';
  document.getElementById('busca').value='';
  document.getElementById('buscaEnsaio').value='';
  document.getElementById('dataDe').value=''; document.getElementById('dataAte').value='';
  document.querySelectorAll('.chip.on').forEach(function(c){ c.classList.remove('on'); });
  aplicarBuscaEnsaio();
  sincronizarKpis();
  aplicarFiltros();
});
document.getElementById('btnSair').addEventListener('click', function(){ ITR.sair('/login.html'); });
document.getElementById('logoLink').addEventListener('click', function(e){ e.preventDefault(); ativarViewRelatorios(); window.scrollTo({top:0,behavior:'smooth'}); });

/* ---- Tema claro/escuro; claro é o padrão da identidade Enterprise. ---- */
function atualizarIconeTema(){
  var icone = document.getElementById('iconeTema');
  if(!icone) return;
  var escuro = document.documentElement.getAttribute('data-tema') === 'escuro';
  icone.innerHTML = svgIcone(escuro ? 'sol' : 'lua');
}
atualizarIconeTema();
document.addEventListener('itr:tema', atualizarIconeTema);
document.getElementById('btnTema').addEventListener('click', function(){ ITR.alternarTema(); });

/* ---- Sidebar de navegação (ETAPA 2 — aditivo) ---- */
(function(){
  var sidebar = document.getElementById('sidebar');
  var overlay = document.getElementById('sidebarOverlay');
  var btnMenu = document.getElementById('btnMenuSidebar');
  if(!sidebar || !overlay || !btnMenu) return;
  function abrirSidebar(){ sidebar.classList.add('aberta'); overlay.classList.add('ativo'); }
  function fecharSidebar(){ sidebar.classList.remove('aberta'); overlay.classList.remove('ativo'); }
  btnMenu.addEventListener('click', function(){
    if(sidebar.classList.contains('aberta')) fecharSidebar(); else abrirSidebar();
  });
  overlay.addEventListener('click', fecharSidebar);
  sidebar.querySelectorAll('.sidebar-item').forEach(function(item){
    item.addEventListener('click', fecharSidebar);
  });
  var navRelatorios = document.getElementById('navRelatorios');
  if(navRelatorios) navRelatorios.addEventListener('click', function(){
    ativarViewRelatorios();
    window.scrollTo({top:0,behavior:'smooth'});
  });
  var navConta = document.getElementById('navConta');
  if(navConta) navConta.addEventListener('click', function(){ ativarViewConta(); });

  var navPropostas = document.getElementById('navPropostas');
  if(navPropostas) navPropostas.addEventListener('click', function(){ ativarViewPropostas(); });

  /* ---- Colapso desktop (mini-sidebar) — ETAPA 2.1 ---- */
  var btnSidebarToggle = document.getElementById('btnSidebarToggle');
  var layoutShell = document.querySelector('.layout-shell');
  if(btnSidebarToggle && layoutShell){
    function aplicarEstadoMini(mini){
      layoutShell.classList.toggle('sidebar-mini', mini);
      var rotulo = mini ? 'Expandir menu' : 'Recolher menu';
      btnSidebarToggle.setAttribute('aria-pressed', mini ? 'true' : 'false');
      btnSidebarToggle.setAttribute('title', rotulo);
      btnSidebarToggle.setAttribute('aria-label', rotulo);
    }
    aplicarEstadoMini(layoutShell.classList.contains('sidebar-mini'));
    btnSidebarToggle.addEventListener('click', function(){
      var mini = !layoutShell.classList.contains('sidebar-mini');
      aplicarEstadoMini(mini);
      try{ localStorage.setItem('sidebar_colapsada', mini ? '1' : '0'); }catch(e){}
    });
  }
})();

/* ---- Rodapé institucional (ETAPA 2 — aditivo) ---- */
(function(){
  var ano = document.getElementById('rodapeAno');
  if(ano) ano.textContent = new Date().getFullYear();
  var rodapeRelatorios = document.getElementById('rodapeRelatorios');
  if(rodapeRelatorios) rodapeRelatorios.addEventListener('click', function(e){
    e.preventDefault();
    ativarViewRelatorios();
    window.scrollTo({top:0,behavior:'smooth'});
  });
  var rodapeConta = document.getElementById('rodapeConta');
  if(rodapeConta) rodapeConta.addEventListener('click', function(){ ativarViewConta(); });
})();

/* ---- Aba Conta: contatos carregados sob demanda, sem atrasar os relatórios. ---- */
var PERFIL_ATUAL = null;
var CONTA_ATUAL = null;
var contaCarregadaEm = 0;
var contaEmVoo = null;
function formatarCnpj(cnpj){
  var d = String(cnpj||'').replace(/\D/g,'');
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d || '—';
}
function formatarWhatsapp(valor){
  var d = String(valor || '').replace(/\D/g, '');
  if(/^55\d{10,11}$/.test(d)){
    var local = d.slice(2);
    return '+55 (' + local.slice(0,2) + ') ' + local.slice(2,-4) + '-' + local.slice(-4);
  }
  return valor;
}
function preencherListaContatos(id, valores, check){
  var el = document.getElementById(id);
  if(!el) return;
  el.replaceChildren();
  if(!valores.length){ el.textContent = 'Nenhum cadastrado.'; return; }
  valores.forEach(function(valor){
    var linha = document.createElement('div');
    linha.className = 'conta-contato';
    var texto = document.createElement('span');
    texto.textContent = check ? valor : formatarWhatsapp(valor);
    linha.appendChild(texto);
    if(check){
      var selo = document.createElement('span');
      selo.className = 'conta-contato-check';
      selo.textContent = '✓';
      selo.title = 'E-mail cadastrado';
      selo.setAttribute('aria-label', 'E-mail cadastrado');
      linha.appendChild(selo);
    }
    el.appendChild(linha);
  });
}
function preencherConta(){
  var elEmpresa = document.getElementById('contaEmpresa');
  var elCnpj = document.getElementById('contaCnpj');
  if(elEmpresa) elEmpresa.textContent = (PERFIL_ATUAL && PERFIL_ATUAL.nomeEmpresa) || NOME_CLIENTE || '—';
  if(elCnpj) elCnpj.textContent = formatarCnpj(PERFIL_ATUAL && PERFIL_ATUAL.documento);
  if(CONTA_ATUAL){
    preencherListaContatos('contaEmail', CONTA_ATUAL.emails || [], true);
    preencherListaContatos('contaWhatsapp', CONTA_ATUAL.whatsapps || [], false);
  }
}
function carregarContatosConta(){
  if(!PERFIL_ATUAL || contaEmVoo) return contaEmVoo;
  if(CONTA_ATUAL && Date.now() - contaCarregadaEm < 60000) return;
  var estado = document.getElementById('contaEstado');
  var tentar = document.getElementById('contaTentar');
  estado.textContent = 'Carregando contatos…';
  tentar.hidden = true;
  var controller = new AbortController();
  var timer = setTimeout(function(){ controller.abort(); }, 20000);
  contaEmVoo = fetch('/api/conta', {credentials:'same-origin', cache:'no-store', signal:controller.signal})
    .then(function(resp){
      if(resp.status === 401){ window.location.replace('/login.html'); throw new Error('Sessão encerrada'); }
      if(!resp.ok) throw new Error('Contatos indisponíveis');
      return resp.json();
    }).then(function(dados){
      if(!dados.sucesso || !dados.conta) throw new Error('Resposta inválida');
      CONTA_ATUAL = dados.conta;
      contaCarregadaEm = Date.now();
      preencherConta();
      estado.textContent = '';
    }).catch(function(){
      estado.textContent = CONTA_ATUAL ? 'Não foi possível atualizar os contatos. Exibindo a última consulta.' : 'Não foi possível carregar os contatos. Tente novamente.';
      tentar.hidden = false;
    }).finally(function(){ clearTimeout(timer); contaEmVoo = null; });
  return contaEmVoo;
}
document.getElementById('contaTentar').addEventListener('click', carregarContatosConta);

function limparNavAtiva(){
  ['navRelatorios','navConta','navPropostas','navFinanceiro'].forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.classList.remove('ativo');
  });
}
function ocultarViewsPortal(){
  var viewRel = document.getElementById('viewRelatorios');
  var painelConta = document.getElementById('painelConta');
  var painelPropostas = document.getElementById('painelPropostas');
  var painelFinanceiro = document.getElementById('painelFinanceiro');
  if(viewRel) viewRel.hidden = true;
  if(painelConta) painelConta.hidden = true;
  if(painelPropostas) painelPropostas.hidden = true;
  if(painelFinanceiro) painelFinanceiro.hidden = true;
}
function ativarViewConta(){
  ocultarViewsPortal();
  var painelConta = document.getElementById('painelConta');
  if(painelConta) painelConta.hidden = false;
  limparNavAtiva();
  var navCta = document.getElementById('navConta');
  if(navCta) navCta.classList.add('ativo');
  document.body.classList.add('conta-ativa');
  preencherConta();
  carregarContatosConta();
  window.scrollTo({top:0,behavior:'smooth'});
}
function ativarViewRelatorios(){
  if (!NAVEGACAO_ATUAL.relatorios) return ativarViewInicial();
  ocultarViewsPortal();
  var viewRel = document.getElementById('viewRelatorios');
  if(viewRel) viewRel.hidden = false;
  limparNavAtiva();
  var navRel = document.getElementById('navRelatorios');
  if(navRel) navRel.classList.add('ativo');
  document.body.classList.remove('conta-ativa');
}

/* ---- Aba Propostas: base financeira separada, carregada somente ao abrir. ---- */
var PROPOSTAS_ATUAIS = [];
var propostasCarregadasEm = 0;
var propostasEmVoo = null;
var propostasRuntime = null;
var propostaAbertaId = null;

function moedaBR(valor){
  if(typeof valor !== 'number' || !isFinite(valor)) return '—';
  try{ return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(valor); }
  catch(e){ return 'R$ ' + valor.toFixed(2).replace('.',','); }
}
function statusClasseProposta(status){
  if(status === 'Aceita') return 'aprovada';
  if(status === 'Rejeitada') return 'rejeitada';
  if(status === 'Em Análise pelo Cliente') return 'analise';
  if(status === 'Expirada') return 'expirada';
  return '';
}
function statusRotuloProposta(status){
  if(status === 'Aceita') return '✓ PROPOSTA APROVADA';
  if(status === 'Rejeitada') return '✕ PROPOSTA REJEITADA';
  return status || 'Pendente';
}
function statusFaixaTextoProposta(status){
  if(status === 'Aceita') return 'Aprovada';
  if(status === 'Rejeitada') return 'Rejeitada';
  if(status === 'Em Análise pelo Cliente') return 'Em análise';
  if(status === 'Expirada') return 'Expirada';
  return '';
}
function fluxoProposta(status){
  var analise = ['Em Análise pelo Cliente','Aceita','Rejeitada','Expirada'].includes(status);
  var enviada = ['Enviada','Em Análise pelo Cliente','Aceita','Rejeitada','Expirada'].includes(status);
  var finalClasse = status === 'Aceita' ? 'concluida final-aprovada' : status === 'Rejeitada' ? 'concluida final-rejeitada' : status === 'Expirada' ? 'final-expirada' : '';
  var finalTexto = status === 'Aceita' ? 'Aceita' : status === 'Rejeitada' ? 'Rejeitada' : status === 'Expirada' ? 'Expirada' : 'Decisão';
  var finalIconeHtml = status === 'Aceita'
    ? '<i class="ti ti-circle-check" aria-hidden="true"></i>'
    : status === 'Rejeitada'
      ? '<i class="ti ti-circle-x" aria-hidden="true"></i>'
      : status === 'Expirada'
        ? '<i class="ti ti-clock-x" aria-hidden="true"></i>'
        : '<svg class="proposta-ampulheta" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2h12"/><path d="M6 22h12"/><path d="M7 2c0 5 2.3 7.4 5 10-2.7 2.6-5 5-5 10"/><path d="M17 2c0 5-2.3 7.4-5 10 2.7 2.6 5 5 5 10"/></svg>';
  return '<div class="proposta-fluxo" aria-label="Andamento da proposta">'+
    '<div class="proposta-etapa '+(enviada?'concluida':'')+'"><span class="proposta-etapa-marca"><i class="ti ti-send" aria-hidden="true"></i></span><span class="proposta-etapa-texto">Enviada</span></div>'+
    '<div class="proposta-etapa '+(analise?'concluida':'')+'"><span class="proposta-etapa-marca"><i class="ti ti-search" aria-hidden="true"></i></span><span class="proposta-etapa-texto">Em análise</span></div>'+
    '<div class="proposta-etapa '+finalClasse+'"><span class="proposta-etapa-marca">'+finalIconeHtml+'</span><span class="proposta-etapa-texto">'+esc(finalTexto)+'</span></div>'+
  '</div>';
}
function podeAceitarProposta(status){
  return ['Enviada', 'Em Análise pelo Cliente'].includes(status);
}
function documentosProposta(p){
  var docs = Array.isArray(p.documentos) ? p.documentos : [];
  if(!docs.length) return '<div class="proposta-documento-destaque"><div class="proposta-documento-cabecalho"><span class="proposta-documento-kicker">Documento</span></div><div class="proposta-documento-vazio"><i class="ti ti-file-off" aria-hidden="true"></i><span>Documento não disponível.</span></div></div>';
  return '<div class="proposta-documento-destaque"><div class="proposta-documento-cabecalho"><span class="proposta-documento-kicker">Documento</span></div><div class="proposta-documentos">' + docs.map(function(d){
    var url = '/api/propostas/'+encodeURIComponent(p.id)+'/documento/'+encodeURIComponent(d.id);
    return '<div class="proposta-documento"><div class="proposta-documento-nome"><span class="proposta-documento-icone"><i class="ti ti-file-description" aria-hidden="true"></i></span><span>'+esc(d.nome || 'Proposta.pdf')+'</span></div><a href="'+url+'" target="_blank" rel="noopener">Visualizar PDF <i class="ti ti-arrow-up-right" aria-hidden="true"></i></a></div>';
  }).join('') + '</div></div>';
}
function blocoAceiteProposta(p){
  if(p.status === 'Aceita') return '<div class="proposta-info proposta-acao proposta-acao-final"><div class="proposta-info-rotulo">Decisão</div><div class="proposta-selo aprovada"><i class="ti ti-check" aria-hidden="true"></i> Proposta aprovada</div></div>';
  if(p.status === 'Rejeitada') return '<div class="proposta-info proposta-acao proposta-acao-final"><div class="proposta-info-rotulo">Decisão</div><div class="proposta-selo rejeitada"><i class="ti ti-x" aria-hidden="true"></i> Proposta rejeitada</div></div>';
  if(!podeAceitarProposta(p.status)) return '<div class="proposta-info proposta-acao"><div class="proposta-info-rotulo">Decisão</div><div class="proposta-info-valor">Nenhuma ação disponível.</div></div>';
  var seguro = (propostasRuntime && propostasRuntime.safeMode) || (PERFIL_ATUAL && PERFIL_ATUAL.visualizacaoDev);
  return '<div class="proposta-info proposta-acao">'+
    '<div class="proposta-info-rotulo">Decisão</div>'+
    '<div class="proposta-decisao-botoes">'+
    '<button type="button" class="proposta-btn-aceitar" data-acao="aceitar" data-id="'+esc(p.id)+'" '+(seguro?'disabled':'')+'><span class="proposta-btn-icone"><i class="ti ti-check" aria-hidden="true"></i></span><span>Aceitar proposta</span></button>'+
    '<button type="button" class="proposta-btn-rejeitar" data-acao="rejeitar" data-id="'+esc(p.id)+'" '+(seguro?'disabled':'')+'>Rejeitar proposta</button></div>'+
    (seguro?'<span class="proposta-safe-note">Decisões indisponíveis neste modo de visualização.</span>':'')+
  '</div>';
}
function renderizarPropostas(){
  var lista = document.getElementById('propostasLista');
  var estado = document.getElementById('propostasEstado');
  if(!lista) return;
  lista.innerHTML = '';
  if(estado){
    estado.hidden = true;
    estado.classList.remove('carregando');
  }
  if(!PROPOSTAS_ATUAIS.length){
    lista.innerHTML = '<div class="propostas-vazio"><strong>Nenhuma proposta disponível.</strong><span>Quando a ITR enviar uma proposta para sua empresa, ela aparecerá aqui.</span></div>';
    return;
  }
  PROPOSTAS_ATUAIS.forEach(function(p){
    var classe = statusClasseProposta(p.status);
    var aberta = propostaAbertaId === p.id;
    var rotuloFaixa = statusFaixaTextoProposta(p.status);
    var artigo = document.createElement('article');
    artigo.className = 'proposta-card '+classe+(aberta?' aberta':'')+(rotuloFaixa?' com-faixa':'');
    artigo.setAttribute('data-proposta-id', p.id);
    artigo.innerHTML =
      '<button class="proposta-resumo" type="button" data-acao="toggle" data-id="'+esc(p.id)+'" aria-expanded="'+(aberta?'true':'false')+'">'+
      (rotuloFaixa ? '<span class="proposta-faixa '+classe+'">'+esc(rotuloFaixa)+'</span>' : '')+
        '<span class="proposta-resumo-icone" aria-hidden="true"><i class="ti ti-mail"></i></span>'+
        '<div class="proposta-identificacao"><div class="proposta-numero">Proposta '+esc(p.numero || '—')+'</div><div class="proposta-meta"><span><i class="ti ti-calendar" aria-hidden="true"></i> Enviada em '+esc(formatarData(p.dataEnvio))+'</span></div></div>'+
        '<div class="proposta-valor-resumo">'+esc(moedaBR(p.valor))+'</div>'+
        '<div class="proposta-direita">'+
          (rotuloFaixa ? '' : '<span class="proposta-status '+classe+'">'+esc(statusRotuloProposta(p.status))+'</span>')+
          '<span class="proposta-chevron"><i class="ti ti-chevron-down" aria-hidden="true"></i></span></div>'+
      '</button>'+
      '<div class="proposta-detalhes" '+(aberta?'':'hidden')+'>'+
        '<div class="proposta-fluxo-wrap">'+fluxoProposta(p.status)+'</div>'+
        documentosProposta(p)+
        '<div class="proposta-info-grid">'+
          '<div class="proposta-info valor-destaque"><div class="proposta-info-rotulo">Valor da proposta</div><div class="proposta-info-valor">'+esc(moedaBR(p.valor))+'</div></div>'+
          '<div class="proposta-info"><div class="proposta-info-rotulo">Forma de pagamento</div><div class="proposta-info-valor">'+esc(p.formaPagamento || '—')+'</div></div>'+
          '<div class="proposta-info"><div class="proposta-info-rotulo">Prazo para pagamento</div><div class="proposta-info-valor">'+esc(p.prazoPagamentoDias == null ? '—' : p.prazoPagamentoDias+' dias após emissão da NF')+'</div></div>'+
          blocoAceiteProposta(p)+
        '</div>'+
      '</div>';
    lista.appendChild(artigo);
  });
  aplicarIcones(lista);
}
function mostrarEstadoPropostas(texto, carregando){
  var estado = document.getElementById('propostasEstado');
  if(!estado) return;

  estado.hidden = false;
  estado.classList.toggle('carregando', Boolean(carregando));

  if(carregando){
    estado.setAttribute('aria-label', 'Carregando propostas');
    estado.innerHTML =
      '<span class="visualmente-oculto">Carregando propostas…</span>'+
      '<div class="propostas-skeleton" aria-hidden="true">'+
        '<span class="portal-skeleton-linha portal-skeleton-nome"></span>'+
        '<span class="portal-skeleton-linha portal-skeleton-data"></span>'+
        '<span class="portal-skeleton-linha portal-skeleton-conteudo"></span>'+
      '</div>';
    return;
  }

  estado.removeAttribute('aria-label');
  estado.textContent = texto;
}
function carregarPropostas(forcar){
  if(propostasEmVoo) return propostasEmVoo;
  if(!forcar && propostasCarregadasEm && Date.now()-propostasCarregadasEm < 30000){ renderizarPropostas(); return Promise.resolve(); }
  var tentar = document.getElementById('propostasTentar');
  if(tentar) tentar.hidden = true;
  mostrarEstadoPropostas('Carregando propostas…', true);
  propostasEmVoo = Promise.all([
    fetch('/api/propostas',{credentials:'same-origin',cache:'no-store'}),
    ITR.runtime().catch(function(){ return null; })
  ]).then(function(result){
    var resp = result[0]; propostasRuntime = result[1];
    if(resp.status === 401){ window.location.replace('/login.html'); throw new Error('Sessão encerrada'); }
    return ITR.jsonSeguro(resp).then(function(dados){
      if(!resp.ok || !dados || !dados.sucesso) throw new Error((dados && dados.erro) || 'Propostas indisponíveis');
      PROPOSTAS_ATUAIS = Array.isArray(dados.propostas) ? dados.propostas : [];
      propostasCarregadasEm = Date.now();
      renderizarPropostas();
    });
  }).catch(function(err){
    mostrarEstadoPropostas(err.message || 'Não foi possível carregar as propostas. Tente novamente.', false);
    if(tentar) tentar.hidden = false;
  }).finally(function(){ propostasEmVoo = null; });
  return propostasEmVoo;
}
function ativarViewPropostas(){
  if (!NAVEGACAO_ATUAL.propostas) return ativarViewInicial();
  ocultarViewsPortal();
  var painel = document.getElementById('painelPropostas');
  if(painel) painel.hidden = false;
  limparNavAtiva();
  var nav = document.getElementById('navPropostas');
  if(nav) nav.classList.add('ativo');
  document.body.classList.remove('conta-ativa');
  carregarPropostas(false);
  window.scrollTo({top:0,behavior:'smooth'});
}

var propostasListaEl = document.getElementById('propostasLista');
if(propostasListaEl) propostasListaEl.addEventListener('click', function(e){
  var botao = e.target.closest('[data-acao]');
  if(!botao) return;
  var acao = botao.getAttribute('data-acao');
  var id = botao.getAttribute('data-id');
  if(acao === 'toggle'){
    propostaAbertaId = propostaAbertaId === id ? null : id;
    renderizarPropostas();
    return;
  }
  var proposta = PROPOSTAS_ATUAIS.find(function (item) { return item.id === id; });
  if (!proposta || botao.disabled) return;
  if (acao === 'aceitar') ITRProposals.accept(proposta, botao);
  if (acao === 'rejeitar') ITRProposals.reject(proposta, botao, function () { carregarPropostas(true); });
});
var propostasTentar = document.getElementById('propostasTentar');
if(propostasTentar) propostasTentar.addEventListener('click', function(){ carregarPropostas(true); });


/* ---- Scroll infinito via IntersectionObserver ---- */
var obs = new IntersectionObserver(function(entradas){
  if(entradas[0].isIntersecting && mostrados < visiveis.length){ renderizarMais(); }
}, { rootMargin:'300px' });
obs.observe(document.getElementById('sentinela'));

/* ---- Voltar ao topo ---- */
var btnTopo = document.getElementById('aoTopo');
window.addEventListener('scroll', function(){
  if(window.scrollY > 500) btnTopo.classList.add('ver'); else btnTopo.classList.remove('ver');
});
btnTopo.addEventListener('click', function(){ window.scrollTo({top:0,behavior:'smooth'}); });

var NAVEGACAO_ATUAL = { propostas: false, relatorios: false };
var navegacaoEmVoo = null;

function ativarViewInicial() {
  if (NAVEGACAO_ATUAL.propostas) return ativarViewPropostas();
  if (NAVEGACAO_ATUAL.relatorios) return ativarViewRelatorios();
  ativarViewConta();
}

function concluirCarregamentoNavegacao() {
  var skeleton = document.getElementById('portalSkeleton');
  if(skeleton) skeleton.hidden = true;
  document.body.classList.remove('portal-carregando');
}

function carregarNavegacao() {
  if (navegacaoEmVoo) return navegacaoEmVoo;

  var estado = document.getElementById('navegacaoEstado');
  var tentar = document.getElementById('navegacaoTentar');
  tentar.hidden = true;
  estado.hidden = true;

  // O retry usa o mesmo estado de carregamento da abertura inicial.
  document.body.classList.add('portal-carregando');
  document.getElementById('portalSkeleton').hidden = false;
  ocultarViewsPortal();
  limparNavAtiva();

  navegacaoEmVoo = fetch('/api/navegacao', { credentials: 'same-origin', cache: 'no-store' })
    .then(function(response) {
      if (!response.ok) throw new Error('Navegação indisponível');
      return response.json();
    }).then(function(data) {
      NAVEGACAO_ATUAL = { propostas: data.propostas === true, relatorios: data.relatorios === true, financeiro: data.financeiro === true };
      document.getElementById('navPropostas').hidden = !NAVEGACAO_ATUAL.propostas;
      document.getElementById('navRelatorios').hidden = !NAVEGACAO_ATUAL.relatorios;
      document.getElementById('navFinanceiro').hidden = !NAVEGACAO_ATUAL.financeiro;

      concluirCarregamentoNavegacao();
      if (NAVEGACAO_ATUAL.relatorios) iniciar();
      ativarViewInicial();
    }).catch(function() {
      // Em caso de falha, mantém os módulos condicionais ocultos.
      NAVEGACAO_ATUAL = { propostas: false, relatorios: false };
      document.getElementById('navPropostas').hidden = true;
      document.getElementById('navRelatorios').hidden = true;
      document.getElementById('navFinanceiro').hidden = true;
      document.getElementById('navegacaoMensagem').textContent = 'Não foi possível carregar o portal.';

      concluirCarregamentoNavegacao();
      estado.hidden = false;
      tentar.hidden = false;
      ativarViewConta();
    }).finally(function() { navegacaoEmVoo = null; });
  return navegacaoEmVoo;
}

document.getElementById('navegacaoTentar').addEventListener('click', carregarNavegacao);
// Ao retornar da confirmação por e-mail, atualizar status e timeline no Portal.
window.addEventListener('focus', function() {
  if (PERFIL_ATUAL && !document.getElementById('painelPropostas').hidden) carregarPropostas(true);
});

/* ---- Start: valida a sessão antes de carregar dados do cliente. ---- */
ITR.perfil().then(function(perfil){
  if(!perfil || perfil.perfil !== 'Cliente'){
    window.location.replace(perfil && perfil.perfil === 'Director' ? '/painel.html' : '/login.html');
    return;
  }
  PERFIL_ATUAL = perfil;
  if(document.body.classList.contains('conta-ativa')){ preencherConta(); carregarContatosConta(); }
  document.dispatchEvent(new CustomEvent('itr:perfil-carregado', { detail: perfil }));
  carregarNavegacao();
}).catch(function(){ window.location.replace('/login.html'); });
