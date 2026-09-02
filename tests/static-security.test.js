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
  assert.match(airtable, /links\.some\(id => scopeClientIds\.includes\(id\)\)/);
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

test('senhas de clientes ficam atrás de feature flag e tokens de uso único são armazenados como hash', () => {
  const config = read('config.js');
  const auth = read('lib/client-auth.js');
  const migration = read('scripts/migrate.js');
  assert.match(config, /CLIENT_PASSWORDS_ENABLED/);
  assert.match(auth, /sha256\(String\(raw/);
  assert.match(migration, /portal_password_tokens/);
  assert.match(migration, /token_hash CHAR\(64\)/);
  assert.doesNotMatch(migration, /token_raw|raw_token|password_plain/i);
});

test('ativação e redefinição usam token no fragmento, não em query string', () => {
  const server = read('server.js');
  const shared = read('public/assets/js/auth-shared.js');
  assert.match(server, /criar-senha\.html#token=/);
  assert.match(server, /redefinir-senha\.html#token=/);
  assert.match(shared, /location\.hash/);
  assert.match(shared, /history\.replaceState/);
  assert.doesNotMatch(server, /criar-senha\.html\?token=|redefinir-senha\.html\?token=/);
});

test('alteração de senha autenticada exige origem, cliente e CSRF', () => {
  const server = read('server.js');
  assert.match(server, /app\.post\('\/api\/auth\/password\/change',\s*sameOriginOnly,\s*autenticado,\s*somenteCliente,\s*senhasClientesHabilitadas,\s*csrfProtegido/);
  assert.match(read('lib/client-auth.js'), /DELETE FROM portal_sessions WHERE airtable_client_id = \?/);
});

test('recuperação evita enumeração e o envio de e-mail não faz parte do tempo da resposta pública', () => {
  const server = read('server.js');
  assert.match(server, /respostaRecuperacaoGenerica/);
  assert.match(server, /setImmediate\(\(\) => \{[\s\S]*sendSecurityNotification/);
  assert.match(server, /await defensiveDelay\(\);[\s\S]*return respostaRecuperacaoGenerica\(res\)/);
});

test('notificações do Portal são assinadas com HMAC, timestamp e nonce', () => {
  const notification = read('lib/notifications.js');
  assert.match(notification, /createHmac\('sha256'/);
  assert.match(notification, /X-ITR-Timestamp/);
  assert.match(notification, /X-ITR-Nonce/);
  assert.match(notification, /X-ITR-Signature/);
  assert.match(read('config.js'), /PORTAL_NOTIFICATIONS_HMAC_SECRET/);
});

test('readiness verifica tabelas críticas antes de declarar a produção pronta', () => {
  const server = read('server.js');
  assert.match(server, /verificarEstruturasCriticas/);
  assert.match(server, /portal_client_accounts/);
  assert.match(server, /portal_password_tokens/);
  assert.match(server, /INFORMATION_SCHEMA\.TABLES/);
});
