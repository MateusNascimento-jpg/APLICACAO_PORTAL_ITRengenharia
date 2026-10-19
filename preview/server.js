const { assertAllowed, root } = require('./guard');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { response } = require('./fixtures');
const blocked = { sucesso: false, erro: 'Indisponível na prévia visual. Nenhuma operação real foi executada.' };
function createApp() {
  assertAllowed();
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; form-action 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; worker-src 'none'" });
    if (!['GET', 'HEAD'].includes(req.method)) return res.status(423).json(blocked);
    next();
  });
  app.use('/api', (req, res) => {
    const data = response(req.path === '/' ? '/api' : '/api' + req.path, req.get('X-ITR-Preview-Persona'));
    if (!data) return res.status(423).json(blocked);
    res.json(data);
  });
  app.get('/__preview/adapter.js', (req, res) => res.sendFile(path.join(__dirname, 'adapter.js')));
  app.get('/__preview/style.css', (req, res) => res.sendFile(path.join(__dirname, 'style.css')));
  const publicDir = path.join(root, 'public');
  const pages = new Set(fs.readdirSync(publicDir).filter(name => name.endsWith('.html')));
  app.use((req, res, next) => {
    const name = req.path === '/' ? 'login.html' : req.path.slice(1);
    if (!pages.has(name)) return next();
    let html = fs.readFileSync(path.join(publicDir, name), 'utf8');
    html = html.replace(/href="https:\/\/portal\.itr\.eng\.br\/"/g, 'href="/login.html"');
    html = html.replace(/href="(?:https?:\/\/|mailto:|tel:)[^"]*"/g, 'href="#" data-preview-blocked="true"');
    html = html.replace(/<head([^>]*)>/i, '<head$1><link rel="stylesheet" href="/__preview/style.css"><script src="/__preview/adapter.js"></script>');
    html = html.replace(/<title>/i, '<title>[Prévia demonstrativa] ');
    res.type('html').send(html);
  });
  // HTML must always pass through the adapter injection above.
  app.use((req, res, next) => /\.html?$/i.test(req.path) ? res.sendStatus(404) : next());
  app.use(express.static(publicDir, { index: false, redirect: false, dotfiles: 'deny' }));
  app.use((req, res) => res.status(404).json(blocked));
  return app;
}
if (require.main === module) {
  createApp().listen(Number(process.env.PORT || 3000), '0.0.0.0', (error) => {
    if (error) { console.error('Não foi possível iniciar a prévia:', error.message); process.exitCode = 1; return; }
    console.log('Prévia visual isolada iniciada. Integrações reais não são carregadas.');
  });
}
module.exports = { createApp };
