(function(){
  'use strict';
  var token=ITRAuth.tokenDoFragmento();
  var form=document.getElementById('formRedefinirSenha');
  var senha=document.getElementById('novaSenha');
  var confirmar=document.getElementById('confirmarSenha');
  var btn=document.getElementById('btnRedefinirSenha');
  ITRAuth.togglePassword(document.getElementById('mostrarNovaSenha'),senha);
  ITRAuth.togglePassword(document.getElementById('mostrarConfirmacao'),confirmar);
  if(!token){ form.hidden=true; ITRAuth.alerta('alertaAuth','Este link de recuperação está incompleto ou já foi removido. Solicite um novo link.',false); return; }
  ITRAuth.configPublica().then(function(c){ document.getElementById('requisitosSenha').textContent='Use pelo menos '+(Number(c.passwordMinLength)||12)+' caracteres e escolha uma senha diferente da anterior.'; }).catch(function(){});
  form.addEventListener('submit',async function(e){
    e.preventDefault(); ITRAuth.alerta('alertaAuth','',false);
    if(senha.value!==confirmar.value){ ITRAuth.alerta('alertaAuth','As duas senhas precisam ser iguais.',false); return; }
    btn.disabled=true; btn.textContent='Redefinindo...';
    try{
      var resp=await fetch('/api/auth/password/reset',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:token,password:senha.value,confirmation:confirmar.value})});
      var dados=await ITR.jsonSeguro(resp)||{};
      if(!resp.ok||!dados.sucesso) throw new Error(dados.erro||'Não foi possível redefinir sua senha.');
      if(dados.csrfToken) ITR.setCsrfToken(dados.csrfToken);
      ITRAuth.limparFragmento();
      ITRAuth.alerta('alertaAuth','Senha redefinida. Você já pode continuar no Portal.',true);
      setTimeout(function(){ window.location.replace(dados.redirectTo||'/portal.html'); },1000);
    }catch(error){ ITRAuth.alerta('alertaAuth',error.message||'Não foi possível redefinir sua senha.',false); }
    finally{ btn.disabled=false; btn.textContent='Salvar nova senha'; }
  });
})();
