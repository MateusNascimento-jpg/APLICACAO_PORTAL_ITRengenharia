(function(){
  'use strict';
  function svg(nome){
    if(nome==='sol') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M3 12h1M20 12h1M12 3v1M12 20v1M5.6 5.6l.7.7M17.7 17.7l.7.7M18.4 5.6l-.7.7M6.3 17.7l-.7.7"/></svg>';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z"/></svg>';
  }
  function atualizarTema(){
    var el=document.getElementById('iconeTema');
    if(!el) return;
    el.innerHTML=svg(document.documentElement.getAttribute('data-tema')==='escuro'?'sol':'lua');
  }
  function alerta(id,texto,sucesso){
    var el=document.getElementById(id);
    if(!el) return;
    el.textContent=texto||'';
    el.classList.toggle('sucesso',Boolean(sucesso));
    el.classList.toggle('ver',Boolean(texto));
  }
  function tokenDoFragmento(){
    var hash=String(location.hash||'').replace(/^#/,'');
    var params=new URLSearchParams(hash);
    return params.get('token')||'';
  }
  function limparFragmento(){
    try{ history.replaceState(null,'',location.pathname); }catch(_){}
  }
  function togglePassword(button,input){
    if(!button||!input) return;
    button.addEventListener('click',function(){
      var mostrar=input.type==='password';
      input.type=mostrar?'text':'password';
      button.textContent=mostrar?'Ocultar':'Mostrar';
      button.setAttribute('aria-label',mostrar?'Ocultar senha':'Mostrar senha');
    });
  }
  async function configPublica(){
    var resp=await fetch('/api/public-config',{credentials:'same-origin',cache:'no-store'});
    return resp.ok ? (await ITR.jsonSeguro(resp)||{}) : {};
  }
  document.getElementById('btnTema')?.addEventListener('click',function(){ ITR.alternarTema(); });
  document.addEventListener('itr:tema',atualizarTema);
  atualizarTema();
  window.ITRAuth=Object.freeze({alerta:alerta,tokenDoFragmento:tokenDoFragmento,limparFragmento:limparFragmento,togglePassword:togglePassword,configPublica:configPublica});
})();
