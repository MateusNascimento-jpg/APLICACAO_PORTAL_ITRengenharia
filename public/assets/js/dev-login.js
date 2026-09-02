/* Visualização DEV — abre a mesma sessão/tela do Portal do Cliente. */
(function(){
'use strict';
var SVG={
 'check':'<path d="M5 12l5 5l10 -10"/>',
 'eye':'<path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0"/><path d="M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6"/>',
 'test-pipe':'<path d="M20 8.04l-12.122 12.124a2.857 2.857 0 1 1 -4.041 -4.04l12.122 -12.124"/><path d="M7 13h8"/><path d="M15 3l6 6"/>',
 'building':'<path d="M3 21l18 0"/><path d="M5 21v-16a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v16"/>',
 'id':'<path d="M3 5m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z"/><path d="M7 16l10 0"/>',
 'lock':'<path d="M5 11m0 2a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2z"/><path d="M8 11v-4a4 4 0 1 1 8 0v4"/>',
 'alert-circle':'<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16l.01 0"/>',
 'loader-2':'<path d="M12 3a9 9 0 1 0 9 9"/>',
 'sol':'<circle cx="12" cy="12" r="4"/><path d="M3 12h1M20 12h1M12 3v1M12 20v1"/>',
 'lua':'<path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z"/>'
};
function icon(name){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(SVG[name]||'')+'</svg>';}
function applyIcons(){document.querySelectorAll('i.ti').forEach(function(el){if(el.dataset.svgOk)return;var n='';el.classList.forEach(function(c){if(c.indexOf('ti-')===0)n=c.slice(3);});if(SVG[n]){el.innerHTML=icon(n);el.dataset.svgOk='1';}});}
function themeIcon(){var el=document.getElementById('iconeTema');if(el)el.innerHTML=icon(document.documentElement.getAttribute('data-tema')==='escuro'?'sol':'lua');}
applyIcons(); themeIcon();
document.addEventListener('itr:tema',themeIcon);
document.getElementById('btnTema').addEventListener('click',function(){ITR.alternarTema();});
document.getElementById('logoLink').addEventListener('click',function(e){e.preventDefault();window.scrollTo({top:0,behavior:'smooth'});});

var form=document.getElementById('formDevLogin');
var usuario=document.getElementById('usuarioDev');
var senha=document.getElementById('senhaDev');
var documento=document.getElementById('documento');
var btn=document.getElementById('btnEntrar');
var texto=document.getElementById('textoBotao');
var icone=document.getElementById('iconeBotao');
var alerta=document.getElementById('alertaForm');
var alertaTexto=document.getElementById('alertaFormTexto');

function digits(v){return String(v||'').replace(/\D/g,'');}
function field(groupId,errorId,bad){document.getElementById(groupId).classList.toggle('invalido',!!bad);document.getElementById(errorId).classList.toggle('ver',!!bad);}
function showError(msg){alertaTexto.textContent=msg;alerta.classList.add('ver');}
function clearError(){alerta.classList.remove('ver');}
function busy(on){btn.disabled=on;icone.innerHTML=on?'<i class="ti ti-loader-2"></i>':'';if(on)applyIcons();texto.textContent=on?'Abrindo...':'Visualizar cliente';}

documento.addEventListener('input',function(){var d=digits(documento.value).slice(0,14);documento.value=d.length===14?d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5'):d;field('grupoDocumento','erroDocumento',false);clearError();});
[usuario,senha].forEach(function(el){el.addEventListener('input',function(){clearError();});});

form.addEventListener('submit',function(e){
 e.preventDefault(); clearError();
 var u=String(usuario.value||'').trim(); var p=String(senha.value||''); var d=digits(documento.value);
 var bu=u.length<3, bp=p.length<1, bd=d.length!==14;
 field('grupoUsuario','erroUsuario',bu); field('grupoSenha','erroSenha',bp); field('grupoDocumento','erroDocumento',bd);
 if(bu||bp||bd)return;
 busy(true);
 fetch('/api/dev/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p,documento:d})})
  .then(function(resp){return ITR.jsonSeguro(resp).then(function(data){return {status:resp.status,data:data||{}};});})
  .then(function(result){busy(false);if(!result.data.sucesso){showError(result.data.erro||'Não foi possível abrir esse cliente.');return;}if(result.data.csrfToken)ITR.setCsrfToken(result.data.csrfToken);window.location.replace(result.data.redirectTo||'/portal.html');})
  .catch(function(){busy(false);showError('Não foi possível conectar ao servidor.');});
});
})();
