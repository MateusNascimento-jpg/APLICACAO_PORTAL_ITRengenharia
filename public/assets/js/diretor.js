/* Acesso administrativo separado do login dos clientes. */
(function () {
  'use strict';
  var form = document.getElementById('formDiretor');
  var btn = document.getElementById('btnDiretorEntrar');
  var alerta = document.getElementById('alertaSenha');

  function mensagem(texto) {
    alerta.textContent = texto || '';
    alerta.hidden = !texto;
    alerta.classList.toggle('ver', Boolean(texto));
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    mensagem('');
    btn.disabled = true;
    btn.textContent = 'Entrando...';
    try {
      var resp = await fetch('/api/diretor/login', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('diretorUsuario').value.trim().toLowerCase(),
          password: document.getElementById('diretorSenha').value
        })
      });
      var dados = await ITR.jsonSeguro(resp) || {};
      if (!resp.ok || !dados.sucesso) throw new Error(dados.erro || 'Credenciais administrativas inválidas.');
      ITR.setCsrfToken(dados.csrfToken);
      window.location.replace('/painel.html');
    } catch (error) {
      mensagem(error.message || 'Não foi possível concluir o acesso.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Entrar no painel';
    }
  });

  document.getElementById('btnTema').addEventListener('click', function () { ITR.alternarTema(); });
  document.addEventListener('itr:tema', function () {
    var escuro = document.documentElement.getAttribute('data-tema') === 'escuro';
    document.getElementById('iconeTema').textContent = escuro ? '☀' : '☾';
  });
  document.getElementById('iconeTema').textContent = document.documentElement.getAttribute('data-tema') === 'escuro' ? '☀' : '☾';

  ITR.perfil().then(function (perfil) {
    if (perfil && perfil.perfil === 'Director') window.location.replace('/painel.html');
  }).catch(function () {});
})();
