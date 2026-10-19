(() => {
  'use strict';
  const persona = location.pathname === '/painel.html' ? 'director' : 'client';
  const message = 'Ação indisponível na prévia. Nenhum dado foi enviado ou alterado.';
  const demoRoutes = new Map([
    ['formLogin', '/portal.html'],
    ['formDiretor', '/painel.html']
  ]);
  const notify = () => {
    window.alert(message);
  };
  const sessionKey = 'itr-preview-session';
  const session = () => { try { return JSON.parse(sessionStorage.getItem(sessionKey) || 'null'); } catch { return null; } };
  const startSession = profile => {
    const value = { profile, issuedAt: Date.now() };
    sessionStorage.setItem(sessionKey, JSON.stringify(value));
    document.cookie = `itr_preview_session=${profile}; Path=/; SameSite=Strict`;
  };
  const endSession = () => {
    sessionStorage.removeItem(sessionKey);
    document.cookie = 'itr_preview_session=; Path=/; Max-Age=0; SameSite=Strict';
  };
  const loginResponse = profile => new Response(JSON.stringify({ sucesso: true, redirectTo: profile === 'director' ? '/painel.html' : '/portal.html', usuario: { perfil: profile === 'director' ? 'Director' : 'Cliente', visualizacaoDev: true } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, options = {}) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    const method = String(options.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (url.pathname === '/api/login' && method === 'POST') {
      startSession('client');
      return Promise.resolve(loginResponse('client'));
    }
    if (url.pathname === '/api/login-diretor' && method === 'POST') {
      startSession('director');
      return Promise.resolve(loginResponse('director'));
    }
    if (url.origin !== location.origin || !['GET', 'HEAD'].includes(method)) {
      notify();
      return Promise.resolve(new Response(JSON.stringify({ sucesso: false, erro: message }), { status: 423, headers: { 'Content-Type': 'application/json' } }));
    }
    const headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));
    headers.set('X-ITR-Preview-Persona', session()?.profile || persona);
    return originalFetch(input, { ...options, headers, credentials: 'same-origin' });
  };
  const originalOpen = window.open.bind(window);
  window.open = (url, ...args) => {
    if (!url || new URL(url, location.href).origin !== location.origin) { notify(); return null; }
    return originalOpen(url, ...args);
  };
  document.addEventListener('submit', event => {
    event.preventDefault(); event.stopImmediatePropagation();
    const destination = demoRoutes.get(event.target.id);
    if (destination) {
      startSession(event.target.id === 'formDiretor' ? 'director' : 'client');
      location.assign(destination);
      return;
    }
    notify();
  }, true);
  document.addEventListener('click', event => {
    if (event.target.closest('#btnSair')) {
      event.preventDefault(); event.stopImmediatePropagation(); endSession(); location.assign('/login.html'); return;
    }
    const anchor = event.target.closest('a');
    if (anchor && (anchor.hasAttribute('data-preview-blocked') || new URL(anchor.href, location.href).origin !== location.origin)) {
      event.preventDefault(); event.stopImmediatePropagation(); notify();
    }
    const action = event.target.closest('[data-download-id], [data-acao="aceitar"], [data-acao="rejeitar"]');
    if (action) { event.preventDefault(); event.stopImmediatePropagation(); notify(); }
  }, true);
  document.addEventListener('DOMContentLoaded', () => {
    const examples = { documento: '00.000.000/0000-00', senha: 'demonstracao', diretorUsuario: 'visitante', diretorSenha: 'demonstracao' };
    document.querySelectorAll('form input').forEach(input => {
      if (['checkbox', 'radio', 'submit', 'button'].includes(input.type)) return;
      input.readOnly = true;
      input.autocomplete = 'off';
      input.title = 'Dados fictícios. Não informe credenciais reais nesta prévia.';
      if (Object.hasOwn(examples, input.id)) input.value = examples[input.id];
    });
  });
})();
