(function(){
  'use strict';
  var form=document.getElementById('formRecuperar');
  var documento=document.getElementById('documento');
  var btn=document.getElementById('btnRecuperar');
  documento.addEventListener('input',function(){
    var d=documento.value.replace(/\D/g,'').slice(0,14);
    documento.value=d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2})$/,function(_,a,b,c,e,f){ return a+'.'+b+'.'+c+'/'+e+(f?'-'+f:''); })||d;
  });
  form.addEventListener('submit',async function(e){
    e.preventDefault(); ITRAuth.alerta('alertaAuth','',false);
    var doc=documento.value.replace(/\D/g,'');
    if(doc.length!==14){
      ITRAuth.alerta('alertaAuth','Confira o CNPJ informado.',false); return;
    }
    btn.disabled=true; btn.textContent='Solicitando dados de acesso...';
    try{
      var resp=await fetch('/api/auth/password-reset/request',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({documento:doc})});
      var dados=await ITR.jsonSeguro(resp)||{};
      if(resp.status===429) throw new Error(dados.erro||'Muitas solicitações. Aguarde alguns minutos.');
      if(!resp.ok || dados.sucesso !== true) throw new Error(dados.erro||'Não foi possível processar a solicitação agora.');
      ITRAuth.alerta('alertaAuth',dados.mensagem||'Solicitação recebida. Se o CNPJ estiver cadastrado com e-mails válidos, enviaremos os dados de acesso para esses contatos. Confira sua caixa de entrada e a pasta de spam ou lixo eletrônico. O envio pode levar alguns minutos. Se não receber, confira o CNPJ informado ou entre em contato com a ITR. Sua senha atual continua a mesma.',true);
      form.reset();
    }catch(error){ ITRAuth.alerta('alertaAuth',error.message||'Não foi possível processar a solicitação agora.',false); }
    finally{ btn.disabled=false; btn.textContent='Enviar dados de acesso'; }
  });
})();
