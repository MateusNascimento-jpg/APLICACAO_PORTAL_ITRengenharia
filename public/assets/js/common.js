/* ITR Portal — utilidades compartilhadas do frontend.
   Autenticação vive em cookie HttpOnly; JavaScript nunca armazena credenciais. */
(function () {
  'use strict';

  var csrfCache = null;

  function lerTema() {
    try { return localStorage.getItem('itr_tema') || 'claro'; }
    catch (_) { return 'claro'; }
  }

  function aplicarTema(tema) {
    var valor = tema === 'escuro' ? 'escuro' : 'claro';
    document.documentElement.setAttribute('data-tema', valor);
    try { localStorage.setItem('itr_tema', valor); } catch (_) {}
    document.dispatchEvent(new CustomEvent('itr:tema', { detail: { tema: valor } }));
    return valor;
  }

  function alternarTema() {
    return aplicarTema(document.documentElement.getAttribute('data-tema') === 'escuro' ? 'claro' : 'escuro');
  }

  async function jsonSeguro(resp) {
    try { return await resp.json(); }
    catch (_) { return null; }
  }

  function setCsrfToken(token) {
    csrfCache = typeof token === 'string' && token.length >= 20 ? token : null;
  }

  async function csrfToken(forcar) {
    if (csrfCache && !forcar) return csrfCache;
    var resp = await fetch('/api/csrf', { credentials: 'same-origin', cache: 'no-store' });
    if (resp.status === 401) throw Object.assign(new Error('Sessão encerrada.'), { sessionExpired: true });
    if (!resp.ok) throw new Error('Não foi possível renovar a sessão de segurança.');
    var dados = await jsonSeguro(resp);
    if (!dados || !dados.csrfToken) throw new Error('Resposta de segurança inválida.');
    csrfCache = dados.csrfToken;
    return csrfCache;
  }

  async function apiFetch(url, options) {
    options = Object.assign({}, options || {});
    options.credentials = 'same-origin';
    options.headers = Object.assign({}, options.headers || {});
    var metodo = String(options.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(metodo)) {
      options.headers['X-CSRF-Token'] = await csrfToken(false);
    }
    var resp = await fetch(url, options);
    if (resp.status === 403) {
      var copia = resp.clone();
      var dados = await jsonSeguro(copia);
      if (dados && dados.codigo === 'CSRF_INVALID' && !options.__csrfRetry) {
        csrfCache = null;
        options.__csrfRetry = true;
        options.headers['X-CSRF-Token'] = await csrfToken(true);
        delete options.__csrfRetry;
        return fetch(url, options);
      }
    }
    return resp;
  }

  async function perfil() {
    var resp = await fetch('/api/perfil', { credentials: 'same-origin', cache: 'no-store' });
    if (!resp.ok) return null;
    var dados = await jsonSeguro(resp);
    return dados && dados.sucesso ? dados.usuario : null;
  }

  async function sair(destino) {
    try {
      var resp = await apiFetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!resp.ok) throw new Error('logout recusado');
      csrfCache = null;
      window.location.replace(destino || '/login.html');
    } catch (error) {
      if (error.sessionExpired) { csrfCache = null; window.location.replace(destino || '/login.html'); return; }
      // Não simulamos um logout quando o servidor não confirmou a revogação.
      // Isso evita deixar uma sessão HttpOnly ativa em um computador compartilhado.
      window.alert('Não foi possível encerrar a sessão agora. Verifique sua conexão e tente novamente.');
    }
  }

  async function runtime() {
    var resp = await fetch('/api/runtime', { credentials: 'same-origin', cache: 'no-store' });
    if (!resp.ok) return null;
    return jsonSeguro(resp);
  }

  aplicarTema(lerTema());

  window.ITR = Object.freeze({
    aplicarTema: aplicarTema,
    alternarTema: alternarTema,
    csrfToken: csrfToken,
    setCsrfToken: setCsrfToken,
    apiFetch: apiFetch,
    perfil: perfil,
    sair: sair,
    runtime: runtime,
    jsonSeguro: jsonSeguro
  });
})();
