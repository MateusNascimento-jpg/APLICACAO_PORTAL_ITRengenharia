'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('sessão não depende de JWT ou Web Storage com credenciais', () => {
  const server = read('server.js');
  const common = read('public/assets/js/common.js');
  assert.doesNotMatch(server, /jsonwebtoken|JWT_SECRET|chave_secreta_padrao/i);
  assert.doesNotMatch(common, /(?:localStorage|sessionStorage).*?(?:token|cnpj|email|senha|password)/i);
  assert.match(read('lib/sessions.js'), /httpOnly\s*:\s*true/);
});

test('mutação administrativa exige origem, Diretor, CSRF e escrita habilitada', () => {
  const server = read('server.js');
  assert.match(
    server,
    /app\.patch\('\/api\/trabalho\/:id\/aprovacao',\s*sameOriginOnly,\s*autenticado,\s*somenteDiretor,\s*csrfProtegido,\s*escritaHabilitada/
  );
});

test('relatório exige vínculo do cliente e aprovação atual', () => {
  const airtable = read('airtable.js');
  assert.match(airtable, /includes\(recordIdCliente\)/);
  assert.match(airtable, /Aprovação[^\n]*!==\s*['"]Aprovado['"]/);
  assert.match(read('server.js'), /validarUrlAirtable/);
});

test('CSP não habilita scripts inline ou eval', () => {
  const security = read('lib/http-security.js');
  assert.match(security, /script-src[^;]*'self'/);
  assert.ok(!security.includes("\"script-src 'self' 'unsafe-inline'\""));
  assert.doesNotMatch(security, /'unsafe-eval'/);
  assert.match(security, /frame-ancestors[^;]*'none'/);
});

test('páginas não possuem script nem handlers inline', () => {
  for (const name of fs.readdirSync(path.join(root, 'public')).filter(n => n.endsWith('.html'))) {
    const html = read(`public/${name}`);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, name);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, name);
  }
});


test('Diretor usa somente senha forte e não expõe fluxo TOTP/MFA', () => {
  const server = read('server.js');
  assert.match(server, /app\.post\('\/api\/diretor\/login'/);
  assert.doesNotMatch(server, /\/api\/diretor\/mfa\//);
  assert.doesNotMatch(server, /DirectorMfaPending|DirectorSetup|verifyTotp|generateTotpSecret/);
});


test('login administrativo libera rate limit de conta e IP após sucesso', () => {
  const server = read('server.js');
  assert.match(server, /reset\('director-login-account', username\)/);
  assert.match(server, /reset\('director-login-ip', req\.ip \|\| 'unknown'\)/);
});

test('reset de senha também libera bloqueio administrativo', () => {
  const script = read('scripts/reset-director-password.js');
  assert.match(script, /DELETE FROM portal_rate_limits WHERE scope LIKE 'director-login-%'/);
});

test('assets JS e CSS revalidam para evitar mistura de versões após atualização', () => {
  const server = read('server.js');
  assert.match(server, /css\|js/);
  assert.ok(server.includes("res.setHeader('Cache-Control', 'no-cache')"), 'JS/CSS não usam revalidação');
});
