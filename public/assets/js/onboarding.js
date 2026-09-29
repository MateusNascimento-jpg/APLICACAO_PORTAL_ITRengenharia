(function(){
  'use strict';
  var perfil=null;
  var tourAberto=false;
  var passos=[
    { seletor:'#resumo', titulo:'Resumo dos ensaios', texto:'Aqui você vê rapidamente quantos ensaios estão prontos, em andamento ou aguardando alguma etapa.' },
    { seletor:'.barra', titulo:'Busca e filtros', texto:'Use a busca, os filtros e a ordenação para encontrar um trabalho sem precisar procurar manualmente na lista.' },
    { seletor:'#lista', titulo:'Seus trabalhos', texto:'Cada trabalho mostra o andamento do ensaio. Quando o relatório estiver aprovado, o download fica disponível no próprio item.' },
    { seletor:'#navConta', titulo:'Sua conta', texto:'Em Conta você confere seus dados e pode iniciar este tour novamente. Para receber sua senha, use Recuperar acesso na tela de login.' },
    { seletor:'#waFlutuante', titulo:'Fale com a ITR', texto:'Se tiver qualquer dúvida, este botão abre o WhatsApp da ITR. Você não precisa resolver tudo sozinho.' }
  ];

  function visivel(el){
    if(!el) return false;
    var css=getComputedStyle(el),r=el.getBoundingClientRect();
    return css.display!=='none'&&css.visibility!=='hidden'&&r.width>0&&r.height>0;
  }
  function perfilTemTour(p){
    var s=p&&p.seguranca;
    if (!p || p.visualizacaoDev || p.perfil !== 'Cliente') return false;
    try { return localStorage.getItem('itr-tour-version') !== String(s&&s.onboardingTargetVersion||1); }
    catch (_) { return false; }
  }
  async function salvarEstado(action){
    try { localStorage.setItem('itr-tour-version', String(perfil&&perfil.seguranca&&perfil.seguranca.onboardingTargetVersion||1)); }
    catch (_) { /* Sem armazenamento local, o tour manual permanece disponível. */ }
  }

  function remover(id){ var el=document.getElementById(id); if(el) el.remove(); }
  function fecharConvite(){ remover('tourConviteFundo'); }
  function convite(){
    if(document.getElementById('tourConviteFundo')||tourAberto) return;
    var fundo=document.createElement('div'); fundo.id='tourConviteFundo'; fundo.className='tour-convite-fundo';
    fundo.innerHTML='<section class="tour-convite" role="dialog" aria-modal="true" aria-labelledby="tourConviteTitulo">'+
      '<div class="tour-convite-icone"><i class="ti ti-route"></i></div>'+
      '<h2 id="tourConviteTitulo">Quer conhecer o Portal em 1 minuto?</h2>'+
      '<p>Vamos mostrar onde acompanhar seus ensaios, usar filtros, encontrar relatórios e pedir ajuda. Você pode pular e fazer o tour depois.</p>'+
      '<div class="tour-convite-acoes"><button class="btn-sec" id="tourAgoraNao" type="button">Agora não</button><button class="btn-prim" id="tourComecar" type="button">Fazer tour</button></div></section>';
    document.body.appendChild(fundo);
    if(window.aplicarIcones) aplicarIcones(fundo);
    document.getElementById('tourAgoraNao').addEventListener('click',function(){ fecharConvite(); salvarEstado('dismissed'); });
    document.getElementById('tourComecar').addEventListener('click',function(){ fecharConvite(); iniciarTour(false); });
  }

  function passosDisponiveis(){ return passos.filter(function(p){ return visivel(document.querySelector(p.seletor)); }); }
  function iniciarTour(manual){
    if(tourAberto) return;
    fecharConvite();
    var disponiveis=passosDisponiveis();
    if(!disponiveis.length) return;
    tourAberto=true; document.body.classList.add('tour-ativo');
    var bloqueio=document.createElement('div'); bloqueio.id='tourBloqueio'; bloqueio.className='tour-bloqueio';
    var destaque=document.createElement('div'); destaque.id='tourDestaque'; destaque.className='tour-destaque';
    var caixa=document.createElement('section'); caixa.id='tourCaixa'; caixa.className='tour-caixa'; caixa.setAttribute('role','dialog'); caixa.setAttribute('aria-modal','true');
    document.body.appendChild(bloqueio); document.body.appendChild(destaque); document.body.appendChild(caixa);
    var indice=0;

    function encerrar(completo){
      document.removeEventListener('keydown',esc);
      tourAberto=false; document.body.classList.remove('tour-ativo'); remover('tourBloqueio'); remover('tourDestaque'); remover('tourCaixa');
      if(!manual) salvarEstado(completo?'completed':'dismissed');
      else if(completo) salvarEstado('completed');
    }
    function posicionarCaixa(rect){
      var largura=Math.min(360,window.innerWidth-28),margem=14;
      var esquerda=Math.max(margem,Math.min(rect.left,window.innerWidth-largura-margem));
      var altura=caixa.offsetHeight||210;
      var abaixo=rect.bottom+12;
      var topo=abaixo+altura<=window.innerHeight-margem ? abaixo : Math.max(margem,rect.top-altura-12);
      caixa.style.left=esquerda+'px'; caixa.style.top=topo+'px';
    }
    function render(){
      var passo=disponiveis[indice],alvo=document.querySelector(passo.seletor);
      if(!visivel(alvo)){ disponiveis=passosDisponiveis(); indice=Math.min(indice,Math.max(0,disponiveis.length-1)); if(!disponiveis.length){encerrar(false);return;} passo=disponiveis[indice]; alvo=document.querySelector(passo.seletor); }
      alvo.scrollIntoView({block:'center',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
      setTimeout(function(){
        var r=alvo.getBoundingClientRect(),pad=7;
        destaque.style.left=Math.max(5,r.left-pad)+'px'; destaque.style.top=Math.max(5,r.top-pad)+'px';
        destaque.style.width=Math.min(window.innerWidth-10,r.width+pad*2)+'px'; destaque.style.height=Math.min(window.innerHeight-10,r.height+pad*2)+'px';
        caixa.innerHTML='<div class="tour-caixa-topo"><strong>'+passo.titulo+'</strong><span class="tour-contador">'+(indice+1)+' de '+disponiveis.length+'</span></div><p>'+passo.texto+'</p><div class="tour-caixa-acoes"><button class="tour-pular" id="tourPular" type="button">Pular tutorial</button><div class="tour-caixa-nav">'+(indice?'<button class="btn-sec" id="tourVoltar" type="button">Voltar</button>':'')+'<button class="btn-prim" id="tourProximo" type="button">'+(indice===disponiveis.length-1?'Concluir':'Próximo')+'</button></div></div>';
        posicionarCaixa(r);
        document.getElementById('tourPular').addEventListener('click',function(){encerrar(false);});
        var voltar=document.getElementById('tourVoltar'); if(voltar) voltar.addEventListener('click',function(){indice-=1;render();});
        document.getElementById('tourProximo').addEventListener('click',function(){ if(indice===disponiveis.length-1) encerrar(true); else {indice+=1;render();} });
      },220);
    }
    bloqueio.addEventListener('click',function(e){e.preventDefault();});
    function esc(e){ if(e.key==='Escape'){ document.removeEventListener('keydown',esc); encerrar(false); } }
    document.addEventListener('keydown',esc);
    render();
  }

  function preparar(p){
    perfil=p;
    var refazer=document.getElementById('btnRefazerTour');
    if(refazer&&!refazer.dataset.tourLigado){ refazer.dataset.tourLigado='1'; refazer.addEventListener('click',function(){ ativarRelatoriosSePossivel(); setTimeout(function(){ iniciarTour(true); },220); }); }
    if(perfilTemTour(p)) setTimeout(convite,1100);
  }
  function ativarRelatoriosSePossivel(){ if(typeof window.ativarViewRelatorios==='function') window.ativarViewRelatorios(); else { var nav=document.getElementById('navRelatorios'); if(nav) nav.click(); } }
  document.addEventListener('itr:perfil-carregado',function(event){ preparar(event.detail); });
  if(window.PERFIL_ATUAL) preparar(window.PERFIL_ATUAL);
})();
