/* =========================================================================
   LOGIN — ITR Engenharia — Portal do Cliente
   Estilo B (idêntico ao portal.html). Conversa com POST /api/login do server.js.
   ========================================================================= */

/* ---- Ícones SVG inline (mesmo mapa do portal.html + alguns novos) ---- */
var TI_SVG = {
  'check':'<path d="M5 12l5 5l10 -10"/>',
  'clock':'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  'folder-open':'<path d="M5 19l2.757 -7.351a1 1 0 0 1 .936 -.649h12.307a1 1 0 0 1 .986 1.164l-.996 5.211a2 2 0 0 1 -1.964 1.625h-14.026a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v2"/>',
  'test-pipe':'<path d="M20 8.04l-12.122 12.124a2.857 2.857 0 1 1 -4.041 -4.04l12.122 -12.124"/><path d="M7 13h8"/><path d="M19 15l1.5 1.6a2 2 0 1 1 -3 0l1.5 -1.6z"/><path d="M15 3l6 6"/>',
  'building':'<path d="M3 21l18 0"/><path d="M9 8l1 0"/><path d="M9 12l1 0"/><path d="M9 16l1 0"/><path d="M14 8l1 0"/><path d="M14 12l1 0"/><path d="M14 16l1 0"/><path d="M5 21v-16a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v16"/>',
  'id':'<path d="M3 5m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z"/><path d="M9 10m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/><path d="M15 8l2 0"/><path d="M15 12l2 0"/><path d="M7 16l10 0"/>',
  'lock':'<path d="M5 11m0 2a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z"/><path d="M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0"/><path d="M8 11v-4a4 4 0 1 1 8 0v4"/>',
  'eye':'<path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6"/>',
  'eye-off':'<path d="M10.585 10.587a2 2 0 0 0 2.829 2.828"/><path d="M16.681 16.673a8.717 8.717 0 0 1 -4.681 1.327c-3.6 0 -6.6 -2 -9 -6c1.272 -2.12 2.712 -3.678 4.32 -4.674m2.86 -1.146a9.055 9.055 0 0 1 1.82 -.18c3.6 0 6.6 2 9 6c-.666 1.11 -1.379 2.067 -2.138 2.87"/><path d="M3 3l18 18"/>',
  'alert-circle':'<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16l.01 0"/>',
  'loader-2':'<path d="M12 3a9 9 0 1 0 9 9"/>',
  'sol':'<circle cx="12" cy="12" r="4"/><path d="M3 12h1M20 12h1M12 3v1M12 20v1M5.6 5.6l.7 .7M17.7 17.7l.7 .7M18.4 5.6l-.7 .7M6.3 17.7l-.7 .7"/>',
  'lua':'<path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z"/>'
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

/* ---- Tema: claro por padrão, preferência visual local apenas. ---- */
var iconeTemaEl = document.getElementById('iconeTema');
function atualizarIconeTema(){
  if(!iconeTemaEl) return;
  var escuro = document.documentElement.getAttribute('data-tema') === 'escuro';
  iconeTemaEl.innerHTML = svgIcone(escuro ? 'sol' : 'lua');
}
atualizarIconeTema();
document.addEventListener('itr:tema', atualizarIconeTema);
document.getElementById('btnTema').addEventListener('click', function(){ ITR.alternarTema(); });

document.getElementById('logoLink').addEventListener('click', function(e){ e.preventDefault(); window.scrollTo({top:0,behavior:'smooth'}); });

/* ---- Botão de mostrar/ocultar senha ---- */
// Campo de acesso: agora e o E-MAIL do cliente (nao ha mais senha/olho).
var campoSenha = document.getElementById('senha');

/* ---- Máscara leve de CNPJ (só visual; o servidor já limpa não-dígitos) ---- */
var campoDocumento = document.getElementById('documento');
campoDocumento.addEventListener('input', function(){
  var digitos = campoDocumento.value.replace(/\D/g,'').slice(0,14);
  // CNPJ: 00.000.000/0000-00
  var formatado = digitos.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2})$/, function(_,a,b,c,d,e){
    return a+'.'+b+'.'+c+'/'+d+(e?'-'+e:'');
  });
  campoDocumento.value = formatado || digitos;
});

/* ---- Validação e envio do formulário ---- */
var formLogin = document.getElementById('formLogin');
var btnEntrar = document.getElementById('btnEntrar');
var textoBotao = document.getElementById('textoBotao');
var iconeBotao = document.getElementById('iconeBotao');
var alertaForm = document.getElementById('alertaForm');
var alertaFormTexto = document.getElementById('alertaFormTexto');
var grupoDocumento = document.getElementById('grupoDocumento');
var grupoSenha = document.getElementById('grupoSenha');
var erroDocumento = document.getElementById('erroDocumento');
var erroSenha = document.getElementById('erroSenha');

function limparDocumento(v){ return String(v||'').replace(/\D/g,''); }

function mostrarErroCampo(grupo, erroEl, mostrar){
  grupo.classList.toggle('invalido', !!mostrar);
  erroEl.classList.toggle('ver', !!mostrar);
}

function mostrarAlertaForm(msg){
  alertaFormTexto.textContent = msg;
  alertaForm.classList.add('ver');
}
function esconderAlertaForm(){ alertaForm.classList.remove('ver'); }

function setCarregando(carregando){
  btnEntrar.disabled = carregando;
  if(carregando){
    iconeBotao.innerHTML = '<i class="ti ti-loader-2"></i>';
    aplicarIcones(iconeBotao);
    textoBotao.textContent = 'Entrando...';
  } else {
    iconeBotao.innerHTML = '';
    textoBotao.textContent = 'Entrar';
  }
}

/* O login desta página é exclusivo para clientes. O Diretor usa /diretor.html. */

formLogin.addEventListener('submit', function(e){
  e.preventDefault();
  esconderAlertaForm();

  var documento = limparDocumento(campoDocumento.value);
  var email = String(campoSenha.value || '').trim();

  // Login novo: CNPJ (14 dígitos) + e-mail de acesso.
  var docInvalido = (documento.length !== 14);
  var emailInvalido = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  mostrarErroCampo(grupoDocumento, erroDocumento, docInvalido);
  mostrarErroCampo(grupoSenha, erroSenha, emailInvalido);
  if(docInvalido || emailInvalido) return;

  setCarregando(true);

  fetch('/api/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      documento: documento,
      email: email,
      remember: document.getElementById('lembrar').checked
    })
  })
  .then(function(resp){ return resp.json().then(function(dados){ return { status: resp.status, dados: dados }; }); })
  .then(function(res){
    setCarregando(false);
    if(!res.dados || !res.dados.sucesso){
      mostrarAlertaForm((res.dados && res.dados.erro) || 'Não foi possível validar os dados informados.');
      return;
    }
    window.location.replace('/portal.html');
  })
  .catch(function(){
    setCarregando(false);
    mostrarAlertaForm('Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.');
  });
});

/* Limpa erro do campo assim que a pessoa volta a digitar */
campoDocumento.addEventListener('input', function(){ mostrarErroCampo(grupoDocumento, erroDocumento, false); esconderAlertaForm(); });
campoSenha.addEventListener('input', function(){ mostrarErroCampo(grupoSenha, erroSenha, false); esconderAlertaForm(); });
