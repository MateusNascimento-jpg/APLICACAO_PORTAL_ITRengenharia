(function(){
  'use strict';
  var token=ITRAuth.tokenDoFragmento();
  var form=document.getElementById('formCriarSenha');
  var senha=document.getElementById('novaSenha');
  var confirmar=document.getElementById('confirmarSenha');
  var btn=document.getElementById('btnCriarSenha');
  ITRAuth.togglePassword(document.getElementById('mostrarNovaSenha'),senha);
  ITRAuth.togglePassword(document.getElementById('mostrarConfirmacao'),confirmar);

  if(!token){
    form.hidden=true;
    ITRAuth.alerta('alertaAuth','Este link de primeiro acesso está incompleto. Solicite um novo link na tela de recuperação.',false);
    return;
  }

  ITRAuth.configPublica().then(function(c){
    var min=Number(c.passwordMinLength)||12;
    document.getElementById('requisitosSenha').textContent='Use pelo menos '+min+' caracteres. Uma frase longa e fácil de lembrar é uma boa opção.';
  }).catch(function(){});

  form.addEventListener('submit',async function(e){
    e.preventDefault(); ITRAuth.alerta('alertaAuth','',false);
    if(senha.value!==confirmar.value){ ITRAuth.alerta('alertaAuth','As duas senhas precisam ser iguais.',false); return; }
    btn.disabled=true; btn.textContent='Criando senha...';
    try{
      var resp=await fetch('/api/auth/password/activate',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:token,password:senha.value,confirmation:confirmar.value})});
      var dados=await ITR.jsonSeguro(resp)||{};
      if(!resp.ok||!dados.sucesso) throw new Error(dados.erro||'Não foi possível criar sua senha.');
      if(dados.csrfToken) ITR.setCsrfToken(dados.csrfToken);
      ITRAuth.limparFragmento();
      ITRAuth.alerta('alertaAuth','Senha criada. Sua conta está protegida; a partir de agora, entre com CNPJ + sua senha pessoal.',true);
      setTimeout(function(){ window.location.replace(dados.redirectTo||'/portal.html'); },1000);
    }catch(error){ ITRAuth.alerta('alertaAuth',error.message||'Não foi possível criar sua senha.',false); }
    finally{ btn.disabled=false; btn.textContent='Criar minha senha'; }
  });
})();
