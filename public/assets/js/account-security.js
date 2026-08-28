(function(){
  'use strict';
  var painel=document.getElementById('contaSeguranca');
  var form=document.getElementById('formAlterarSenha');
  var abrir=document.getElementById('btnMostrarAlterarSenha');
  var cancelar=document.getElementById('btnCancelarAlterarSenha');
  var salvar=document.getElementById('btnSalvarNovaSenha');
  var msg=document.getElementById('mensagemSeguranca');
  if(!painel||!form||!abrir||!cancelar||!salvar||!msg) return;

  function mostrarMensagem(texto,tipo){
    msg.textContent=texto||'';
    msg.hidden=!texto;
    msg.classList.toggle('sucesso',tipo==='sucesso');
    msg.classList.toggle('erro',tipo==='erro');
  }
  function fechar(){ form.hidden=true; abrir.setAttribute('aria-expanded','false'); form.reset(); }
  function configurar(perfil){
    var ativa=Boolean(perfil&&perfil.seguranca&&perfil.seguranca.senhaPessoalAtiva);
    painel.hidden=!ativa;
    if(!ativa) fechar();
  }

  abrir.setAttribute('aria-expanded','false');
  abrir.addEventListener('click',function(){
    form.hidden=!form.hidden;
    abrir.setAttribute('aria-expanded',form.hidden?'false':'true');
    mostrarMensagem('',null);
    if(!form.hidden) document.getElementById('senhaAtual').focus();
  });
  cancelar.addEventListener('click',function(){ mostrarMensagem('',null); fechar(); });

  form.addEventListener('submit',async function(event){
    event.preventDefault(); mostrarMensagem('',null);
    var atual=document.getElementById('senhaAtual').value;
    var nova=document.getElementById('novaSenhaConta').value;
    var confirmar=document.getElementById('confirmarSenhaConta').value;
    if(!atual||!nova||nova!==confirmar){ mostrarMensagem('Confira a senha atual e digite a nova senha duas vezes, exatamente igual.','erro'); return; }
    salvar.disabled=true; salvar.textContent='Salvando...';
    try{
      var resp=await ITR.apiFetch('/api/auth/password/change',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({currentPassword:atual,newPassword:nova,confirmation:confirmar})
      });
      var dados=await ITR.jsonSeguro(resp)||{};
      if(!resp.ok||!dados.sucesso) throw new Error(dados.erro||'Não foi possível alterar sua senha.');
      if(dados.csrfToken) ITR.setCsrfToken(dados.csrfToken);
      form.reset(); form.hidden=true; abrir.setAttribute('aria-expanded','false');
      mostrarMensagem('Senha alterada. As outras sessões foram encerradas por segurança.','sucesso');
    }catch(error){
      if(/sessão expirou/i.test(error.message||'')) window.location.replace('/login.html');
      else mostrarMensagem(error.message||'Não foi possível alterar sua senha agora.','erro');
    }finally{ salvar.disabled=false; salvar.textContent='Salvar nova senha'; }
  });

  document.addEventListener('itr:perfil-carregado',function(event){ configurar(event.detail); });
  if(window.PERFIL_ATUAL) configurar(window.PERFIL_ATUAL);
})();
