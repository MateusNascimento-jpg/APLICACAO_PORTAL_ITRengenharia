(() => {
  'use strict';
  const persona = location.pathname === '/painel.html' ? 'director' : 'client';
  const message = 'Ação indisponível na prévia. Nenhum dado foi enviado ou alterado.';
  const notify = () => {
    const el = document.getElementById('itr-preview-message');
    if (el) el.textContent = message;
  };
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, options = {}) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    const method = String(options.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (url.origin !== location.origin || !['GET', 'HEAD'].includes(method)) {
      notify();
      return Promise.resolve(new Response(JSON.stringify({ sucesso: false, erro: message }), { status: 423, headers: { 'Content-Type': 'application/json' } }));
    }
    const headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));
    headers.set('X-ITR-Preview-Persona', persona);
    return originalFetch(input, { ...options, headers, credentials: 'omit' });
  };
  const originalOpen = window.open.bind(window);
  window.open = (url, ...args) => {
    if (!url || new URL(url, location.href).origin !== location.origin) { notify(); return null; }
    return originalOpen(url, ...args);
  };
  document.addEventListener('submit', event => { event.preventDefault(); event.stopImmediatePropagation(); notify(); }, true);
  document.addEventListener('click', event => {
    if (event.target.closest('#btnSair')) {
      event.preventDefault(); event.stopImmediatePropagation(); location.assign('/login.html'); return;
    }
    const anchor = event.target.closest('a');
    if (anchor && (anchor.hasAttribute('data-preview-blocked') || new URL(anchor.href, location.href).origin !== location.origin)) {
      event.preventDefault(); event.stopImmediatePropagation(); notify();
    }
    const action = event.target.closest('[data-download-id], [data-acao="aceitar"], [data-acao="rejeitar"]');
    if (action) { event.preventDefault(); event.stopImmediatePropagation(); notify(); }
  }, true);
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('form input').forEach(input => { input.readOnly = true; input.title = 'Use a navegação da prévia; não informe credenciais reais.'; });
  });
})();
