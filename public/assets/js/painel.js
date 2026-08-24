/* =========================================================================
   ÍCONES SVG INLINE (mesmo esquema do portal.html — sem CDN)
   ========================================================================= */
var TI_SVG = {
  'sol':'<circle cx="12" cy="12" r="4"/><path d="M3 12h1M20 12h1M12 3v1M12 20v1M5.6 5.6l.7 .7M17.7 17.7l.7 .7M18.4 5.6l-.7 .7M6.3 17.7l-.7 .7"/>',
  'lua':'<path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z"/>',
  'loader-2':'<path d="M12 3a9 9 0 1 0 9 9"/>',
  'logout':'<path d="M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2"/><path d="M9 12h12l-3 -3"/><path d="M18 15l3 -3"/>',
  'building':'<path d="M3 21l18 0"/><path d="M9 8l1 0"/><path d="M9 12l1 0"/><path d="M9 16l1 0"/><path d="M14 8l1 0"/><path d="M14 12l1 0"/><path d="M14 16l1 0"/><path d="M5 21v-16a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v16"/>',
  'arrow-left':'<path d="M5 12l14 0"/><path d="M5 12l6 6"/><path d="M5 12l6 -6"/>',
  'search':'<circle cx="10" cy="10" r="7"/><path d="M21 21l-6 -6"/>',
  'check':'<path d="M5 12l5 5l10 -10"/>',
  'download':'<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"/><path d="M7 11l5 5l5 -5"/><path d="M12 4l0 12"/>'
};
function svgIcone(nome){
  var corpo = TI_SVG[nome];
  if(!corpo) return '';
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+corpo+'</svg>';
}
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

/* O fundo técnico é estático e aplicado pelo CSS: menos ruído e menos trabalho no navegador. */

/* ---- Tema e sessão administrativa ---- */
function atualizarIconeTema(){
  var icone = document.getElementById('iconeTema');
  if(!icone) return;
  var escuro = document.documentElement.getAttribute('data-tema') === 'escuro';
  icone.innerHTML = svgIcone(escuro ? 'sol' : 'lua');
}
atualizarIconeTema();
document.addEventListener('itr:tema', atualizarIconeTema);
document.getElementById('btnTema').addEventListener('click', function(){ ITR.alternarTema(); });
document.getElementById('btnSair').addEventListener('click', function(){ ITR.sair('/diretor.html'); });

function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function normalizar(s){ return String(s==null?'':s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }

var MODO_SEGURO = true;
async function verificarSessaoDiretor(){
  try {
    var perfil = await ITR.perfil();
    if(!perfil || perfil.perfil !== 'Director'){
      window.location.replace('/diretor.html');
      return;
    }
    var runtime = await ITR.runtime();
    MODO_SEGURO = !runtime || Boolean(runtime.safeMode);
    aplicarAvisoModoSeguro();
    var guard = document.getElementById('guard');
    if(guard) guard.remove();
    document.getElementById('abasPainel').style.display = '';
    document.getElementById('visaoClientes').style.display = '';
    carregarClientes();
  } catch(e){
    window.location.replace('/diretor.html');
  }
}

function aplicarAvisoModoSeguro(){
  var existente = document.getElementById('avisoModoSeguro');
  if(!MODO_SEGURO){ if(existente) existente.remove(); return; }
  if(existente) return;
  var aviso = document.createElement('div');
  aviso.id = 'avisoModoSeguro';
  aviso.className = 'aviso-modo-seguro';
  aviso.setAttribute('role','status');
  aviso.textContent = 'Modo seguro de validação ativo — consultas liberadas e alterações de aprovação bloqueadas.';
  var abas = document.getElementById('abasPainel');
  if(abas && abas.parentNode) abas.parentNode.insertBefore(aviso, abas);
}
verificarSessaoDiretor();

/* =========================================================================
   VISÃO 1: bolhas de clientes (GET /api/diretor/clientes)
   ========================================================================= */
var TODOS_CLIENTES = []; // cache em memória: a busca filtra local, sem refetch

function renderBolhas(clientes){
  var box = document.getElementById('bolhas');
  var contagem = document.getElementById('contagemClientes');
  contagem.textContent = clientes.length + ' cliente' + (clientes.length === 1 ? '' : 's');
  if(clientes.length === 0){
    box.innerHTML = '<div class="msg-vazio">Nenhum cliente encontrado.</div>';
    return;
  }
  box.innerHTML = clientes.map(function(c){
    return '<button class="bolha" data-id="'+esc(c.id)+'" data-nome="'+esc(c.nome)+'" data-cnpj="'+esc(c.cnpj||'')+'">'
      + '<span class="ico"><i class="ti ti-building" aria-hidden="true"></i></span>'
      + '<span class="nome">'+esc(c.nome)+'</span>'
      + '</button>';
  }).join('');
  aplicarIcones(box);
  box.querySelectorAll('.bolha').forEach(function(b){
    b.addEventListener('click', function(){
      abrirTrabalhosCliente(this.getAttribute('data-id'), this.getAttribute('data-nome'), this.getAttribute('data-cnpj'));
    });
  });
}

async function carregarClientes(){
  var box = document.getElementById('bolhas');
  var contagem = document.getElementById('contagemClientes');
  box.innerHTML = '';
  contagem.textContent = 'Carregando clientes...';
  try {
    var resp = await fetch('/api/diretor/clientes', { credentials:'same-origin', cache:'no-store' });
    if(resp.status === 401 || resp.status === 403){ window.location.replace('/diretor.html'); return; }
    var dados = await resp.json();
    if(!dados.sucesso) throw new Error(dados.erro || 'Falha ao carregar clientes');
    TODOS_CLIENTES = dados.clientes || [];
    renderBolhas(TODOS_CLIENTES);
  } catch(e){
    contagem.textContent = '';
    box.innerHTML = '<div class="msg-vazio">Não foi possível carregar os clientes. Tente recarregar a página.</div>';
  }
}

document.getElementById('buscaClientes').addEventListener('input', function(){
  var termo = normalizar(this.value);
  if(!termo){ renderBolhas(TODOS_CLIENTES); return; }
  renderBolhas(TODOS_CLIENTES.filter(function(c){ return normalizar(c.nome).indexOf(termo) !== -1; }));
});

/* =========================================================================
   VISÃO 2: trabalhos do cliente selecionado (GET /api/diretor/trabalhos/:id)
   ========================================================================= */
var ROTULO_APROVACAO = {
  'Aprovado': { classe:'aprovado', texto:'Aprovado' },
  'Refazer': { classe:'refazer', texto:'Refazer' },
  'Em Andamento': { classe:'andamento', texto:'Em Andamento' }
};
function badgeAprovacao(valor){
  var info = ROTULO_APROVACAO[valor] || { classe:'indefinido', texto: valor || 'Sem aprovação definida' };
  return '<span class="badge '+info.classe+'">'+esc(info.texto)+'</span>';
}

var TRABALHOS_ATUAIS = []; // cache do cliente aberto no momento (busca filtra local)
var CNPJ_ATUAL = null;     // CNPJ do cliente aberto (para cruzar com /api/diretor/downloads)
var MAPA_DOWNLOADS_ATUAL = {}; // record_id -> baixado_em, so' do cliente aberto

/* Os TRÊS valores exatos aceitos por PATCH /api/trabalho/:id/aprovacao (APROVACAO_VALIDAS) */
var OPCOES_APROVACAO = [
  { valor:'Aprovado', classe:'aprovado', texto:'Aprovado' },
  { valor:'Refazer', classe:'refazer', texto:'Refazer' },
  { valor:'Em Andamento', classe:'andamento', texto:'Em Andamento' }
];

function formatarDataHora(iso){
  if(!iso) return '';
  try { return new Date(iso).toLocaleString('pt-BR'); } catch(e){ return String(iso); }
}

function seloDownload(idTrabalho){
  var baixadoEm = MAPA_DOWNLOADS_ATUAL[idTrabalho];
  if(baixadoEm){
    return '<span class="selo-download baixado" title="Baixado em '+esc(formatarDataHora(baixadoEm))+'">'
      + '<i class="ti ti-check" aria-hidden="true"></i>Baixado</span>';
  }
  return '<span class="selo-download nao-baixado">Não baixado</span>';
}

function renderTrabalhos(trabalhos){
  var lista = document.getElementById('listaTrabalhos');
  if(trabalhos.length === 0){
    lista.innerHTML = '<div class="msg-vazio">Nenhum trabalho encontrado.</div>';
    return;
  }
  lista.innerHTML = trabalhos.map(function(t){
    var osTxto = t.os ? (t.os + (t.os_extra ? ' +'+t.os_extra : '')) : 'Sem OS';
    var botoes = OPCOES_APROVACAO.map(function(op){
      var ativo = (t.aprovacao === op.valor) ? ' ativo' : '';
      return '<button class="btn-aprovacao '+op.classe+ativo+'" data-id="'+esc(t.id)+'" data-valor="'+esc(op.valor)+'"'+(MODO_SEGURO?' disabled title="Modo seguro: alterações bloqueadas"':'')+'>'+esc(op.texto)+'</button>';
    }).join('');
    return '<div class="trabalho" data-id="'+esc(t.id)+'">'
      + '<div class="cab-trabalho">'
        + '<div class="info">'
          + '<div class="id-trabalho">'+esc(t.id_trabalho || '(sem ID)')+'</div>'
          + '<div class="os">'+esc(osTxto)+'</div>'
        + '</div>'
        + '<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">'
          + seloDownload(t.id)
          + badgeAprovacao(t.aprovacao)
        + '</div>'
      + '</div>'
      + '<div class="acoes-aprovacao">'+botoes+'</div>'
      + '</div>';
  }).join('');
}

/* ---- Toast simples de feedback ---- */
var _toastTimer = null;
function mostrarToast(msg, ehErro){
  var el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.toggle('erro', !!ehErro);
  el.classList.add('ver');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function(){ el.classList.remove('ver'); }, 3000);
}

/* ---- Clique nos botões Aprovado/Refazer/Em Andamento (delegação de evento) ---- */
document.getElementById('listaTrabalhos').addEventListener('click', function(e){
  var btn = e.target.closest('.btn-aprovacao');
  if(!btn) return;
  definirAprovacao(btn.getAttribute('data-id'), btn.getAttribute('data-valor'));
});

async function definirAprovacao(idTrabalho, valor){
  var grupo = document.querySelectorAll('.trabalho[data-id="'+CSS.escape(idTrabalho)+'"] .btn-aprovacao');
  grupo.forEach(function(b){ b.setAttribute('disabled', 'disabled'); });
  try {
    var resp = await ITR.apiFetch('/api/trabalho/' + encodeURIComponent(idTrabalho) + '/aprovacao', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valor: valor })
    });
    if(resp.status === 401 || resp.status === 403){ window.location.replace('/diretor.html'); return; }
    var dados = await resp.json();
    if(resp.status === 423){ MODO_SEGURO = true; aplicarAvisoModoSeguro(); renderTrabalhos(TRABALHOS_ATUAIS); throw new Error(dados.erro || 'Alterações estão bloqueadas no modo seguro.'); }
    if(!resp.ok || !dados.sucesso) throw new Error(dados.erro || 'Falha ao atualizar aprovação.');

    var alvo = TRABALHOS_ATUAIS.find(function(t){ return t.id === idTrabalho; });
    if(alvo) alvo.aprovacao = valor;
    document.getElementById('buscaTrabalhos').dispatchEvent(new Event('input'));
    mostrarToast(dados.mensagem || 'Status atualizado.');
  } catch(e){
    mostrarToast(e.message || 'Não foi possível atualizar o status.', true);
    grupo.forEach(function(b){ b.removeAttribute('disabled'); });
  }
}

async function carregarMapaDownloadsDoCliente(cnpj){
  MAPA_DOWNLOADS_ATUAL = {};
  if(!cnpj) return;
  try {
    var resp = await fetch('/api/diretor/downloads', { credentials:'same-origin', cache:'no-store' });
    if(!resp.ok) return; // selo so' nao aparece; nao trava a tela de trabalhos
    var dados = await resp.json();
    if(!dados.sucesso) return;
    (dados.downloads || []).forEach(function(d){
      if(d.cnpj === cnpj) MAPA_DOWNLOADS_ATUAL[d.record_id] = d.baixado_em;
    });
  } catch(e){ /* selo fica "Não baixado" por padrão; nao e' critico */ }
}

async function abrirTrabalhosCliente(idCliente, nomeCliente, cnpjCliente){
  document.getElementById('visaoClientes').style.display = 'none';
  document.getElementById('visaoTrabalhos').style.display = '';
  document.getElementById('nomeClienteAtual').textContent = nomeCliente || '';
  document.getElementById('buscaTrabalhos').value = '';
  CNPJ_ATUAL = cnpjCliente || null;
  var lista = document.getElementById('listaTrabalhos');
  lista.innerHTML = '<div class="msg-vazio">Carregando trabalhos...</div>';

  try {
    var resp = await fetch('/api/diretor/trabalhos/' + encodeURIComponent(idCliente) + '?modo=todos', { credentials:'same-origin', cache:'no-store' });
    if(resp.status === 401 || resp.status === 403){ window.location.replace('/diretor.html'); return; }
    var dados = await resp.json();
    if(!dados.sucesso) throw new Error(dados.erro || 'Falha ao carregar trabalhos');
    TRABALHOS_ATUAIS = dados.trabalhos || [];
    await carregarMapaDownloadsDoCliente(CNPJ_ATUAL);
    renderTrabalhos(TRABALHOS_ATUAIS);
  } catch(e){
    lista.innerHTML = '<div class="msg-vazio">Não foi possível carregar os trabalhos deste cliente.</div>';
  }
}

document.getElementById('buscaTrabalhos').addEventListener('input', function(){
  var termo = normalizar(this.value);
  if(!termo){ renderTrabalhos(TRABALHOS_ATUAIS); return; }
  renderTrabalhos(TRABALHOS_ATUAIS.filter(function(t){
    var alvo = normalizar((t.id_trabalho||'') + ' ' + (t.os||'') + ' ' + (t.aprovacao||''));
    return alvo.indexOf(termo) !== -1;
  }));
});

document.getElementById('btnVoltarClientes').addEventListener('click', function(){
  document.getElementById('visaoTrabalhos').style.display = 'none';
  document.getElementById('visaoClientes').style.display = '';
});

/* =========================================================================
   ABAS: Clientes / Downloads
   ========================================================================= */
function mostrarAba(nome){
  document.getElementById('abaClientes').classList.toggle('ativa', nome === 'clientes');
  document.getElementById('abaDownloads').classList.toggle('ativa', nome === 'downloads');
  document.getElementById('visaoClientes').style.display = (nome === 'clientes') ? '' : 'none';
  document.getElementById('visaoTrabalhos').style.display = 'none';
  document.getElementById('visaoDownloads').style.display = (nome === 'downloads') ? '' : 'none';
  if(nome === 'downloads') carregarDownloads();
}
document.getElementById('abaClientes').addEventListener('click', function(){ mostrarAba('clientes'); });
document.getElementById('abaDownloads').addEventListener('click', function(){ mostrarAba('downloads'); });

/* =========================================================================
   VISÃO 3: histórico completo de downloads (GET /api/diretor/downloads)
   ========================================================================= */
var TODOS_DOWNLOADS = []; // cache em memória: a busca filtra local, sem refetch

function renderDownloads(downloads){
  var lista = document.getElementById('listaDownloads');
  var contagem = document.getElementById('contagemDownloads');
  contagem.textContent = downloads.length + ' download' + (downloads.length === 1 ? '' : 's');
  if(downloads.length === 0){
    lista.innerHTML = '<div class="msg-vazio">Nenhum download registrado ainda.</div>';
    return;
  }
  lista.innerHTML = downloads.map(function(d){
    var osTxto = d.os ? '<span class="dl-os">'+esc(d.os)+'</span>' : '';
    var idTxto = esc(d.id_trabalho || d.record_id);
    return '<div class="download-row">'
      + '<div class="dl-empresa"><span class="chip-empresa"><i class="ti ti-building" aria-hidden="true"></i>'+esc(d.empresa || d.cnpj || '(empresa não identificada)')+'</span></div>'
      + '<div class="dl-relatorio">'+osTxto+idTxto+'</div>'
      + '<div class="dl-data">'+esc(formatarDataHora(d.baixado_em))+'</div>'
      + '</div>';
  }).join('');
  aplicarIcones(lista);
}

async function carregarDownloads(){
  var lista = document.getElementById('listaDownloads');
  var contagem = document.getElementById('contagemDownloads');
  lista.innerHTML = '<div class="msg-vazio">Carregando downloads...</div>';
  contagem.textContent = '';
  try {
    var resp = await fetch('/api/diretor/downloads', { credentials:'same-origin', cache:'no-store' });
    if(resp.status === 401 || resp.status === 403){ window.location.replace('/diretor.html'); return; }
    var dados = await resp.json();
    if(!dados.sucesso) throw new Error(dados.erro || 'Falha ao carregar downloads');
    TODOS_DOWNLOADS = dados.downloads || []; // ja' vem ordenado (mais recente primeiro) do servidor
    renderDownloads(TODOS_DOWNLOADS);
  } catch(e){
    lista.innerHTML = '<div class="msg-vazio">Não foi possível carregar o histórico de downloads.</div>';
  }
}

document.getElementById('buscaDownloads').addEventListener('input', function(){
  var termo = normalizar(this.value);
  if(!termo){ renderDownloads(TODOS_DOWNLOADS); return; }
  renderDownloads(TODOS_DOWNLOADS.filter(function(d){
    var alvo = normalizar((d.empresa||'') + ' ' + (d.os||''));
    return alvo.indexOf(termo) !== -1;
  }));
});
