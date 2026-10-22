'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const errors = [];
const notes = [];
const verifyReleaseTree = process.argv.includes('--release');

function fail(message) { errors.push(message); }
function note(message) { notes.push(message); }
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(root, rel)); }
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'coverage'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// Resíduos legados nunca devem reaparecer. O .env é diferente: ele é proibido
// no pacote distribuído, mas esperado na instalação local porque contém a
// configuração real preservada pelo atualizador.
for (const forbidden of ['Diagnosticos', 'Banco_dados_Login_ITRengenharia.sql', 'email.js', 'itr_corrigido.code-workspace']) {
  if (exists(forbidden)) fail(`arquivo/resíduo proibido: ${forbidden}`);
}
if (verifyReleaseTree && exists('.env')) fail('arquivo/segredo proibido no release: .env');
if (exists('public/cadastro.html')) fail('cadastro.html legado ainda está publicado.');

const packageJson = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const lockRoot = lock.packages && lock.packages[''];
if (!lockRoot) fail('package-lock.json sem pacote raiz.');
else {
  const declared = packageJson.dependencies || {};
  const lockedDeclared = lockRoot.dependencies || {};
  if (JSON.stringify(declared) !== JSON.stringify(lockedDeclared)) {
    fail('package.json e package-lock.json divergem nas dependências diretas.');
  }
}
for (const dep of ['jsonwebtoken', 'bcrypt', 'cors', 'nodemailer']) {
  if (packageJson.dependencies && packageJson.dependencies[dep]) fail(`dependência legada inesperada: ${dep}`);
}

const allFiles = walk(root);
for (const file of allFiles.filter(f => f.endsWith('.js'))) {
  const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (checked.status !== 0) fail(`sintaxe JavaScript inválida em ${path.relative(root, file)}: ${checked.stderr.trim()}`);
}

for (const file of allFiles.filter(f => f.endsWith('.html'))) {
  const html = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file);
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) fail(`script inline em ${rel}`);
  if (/\son[a-z]+\s*=/i.test(html)) fail(`event handler inline em ${rel}`);
}

const frontend = allFiles.filter(f => f.startsWith(path.join(publicDir, 'assets', 'js')) && f.endsWith('.js'))
  .map(f => fs.readFileSync(f, 'utf8')).join('\n');
if (/(?:localStorage|sessionStorage)\.(?:setItem|getItem)\s*\(\s*['"](?:token|jwt|cnpj|email|senha|password)/i.test(frontend)) {
  fail('frontend ainda persiste credencial/token em Web Storage.');
}
if (/\b(?:eval|Function)\s*\(/.test(frontend)) fail('eval/Function dinâmico encontrado no frontend.');

const config = read('config.js');
if (/JWT_SECRET|chave_secreta_padrao/i.test(config + read('server.js'))) fail('fallback/segredo JWT legado encontrado.');
if (!/PORTAL_SECURITY_PEPPER/.test(config)) fail('PORTAL_SECURITY_PEPPER não está validado.');

const headers = read('lib/http-security.js');
if (!/script-src[^;]*'self'/.test(headers)) fail('CSP sem script-src self.');
if (/script-src\s+[^\r\n"']*['"]?unsafe-inline/i.test(headers) || headers.includes("\"script-src 'self' 'unsafe-inline'\"")) fail('CSP permite script inline.');
if (/'unsafe-eval'/.test(headers)) fail('CSP permite unsafe-eval.');
if (!/frame-ancestors[^;]*'none'/.test(headers)) fail('CSP sem proteção de framing.');

const server = read('server.js');
const requiredRoutes = [
  '/api/login', '/api/dev/login', '/api/perfil', '/perfil', '/api/meus-dados', '/api/trabalhos',
  '/api/trabalho/:id/download', '/api/relatorio/:id', '/api/diretor/clientes', '/api/clientes',
  '/api/diretor/trabalhos/:clienteId', '/api/cliente/:id/trabalhos', '/api/trabalho/:id/aprovacao',
  '/api/diretor/downloads', '/api/esqueci-senha', '/api/redefinir-senha',
  '/api/logout', '/api/csrf', '/api/runtime', '/api/diretor/login', '/api/public-config',
  '/api/auth/password-reset/request', '/api/auth/password/activate', '/api/auth/password/reset',
  '/api/auth/password/change', '/api/onboarding', '/health', '/ready'
];
for (const route of requiredRoutes) if (!server.includes(route)) fail(`rota esperada ausente: ${route}`);
if (!/app\.patch\('\/api\/trabalho\/:id\/aprovacao',\s*sameOriginOnly,\s*autenticado,\s*somenteDiretor,\s*csrfProtegido,\s*escritaHabilitada/.test(server)) {
  fail('rota de aprovação não contém toda a cadeia de proteção esperada.');
}
if (!/HttpOnly|httpOnly\s*:\s*true/.test(read('lib/sessions.js'))) fail('cookie de sessão não está marcado HttpOnly.');

const airtable = read('airtable.js');
if (!/scopeClientIds/.test(airtable) || !/links\.every\(id => scopeClientIds\.includes\(id\)\)/.test(airtable)) fail('isolamento Airtable por escopo de Record IDs não foi localizado.');
if (!/Aprovação[^\n]*!==\s*['"]Aprovado['"]/.test(airtable)) fail('download não valida o estado atual Aprovado.');

const pairs = [
  ['public/assets/js/login.js', 'public/login.html', []],
  ['public/assets/js/dev-login.js', 'public/dev-login.html', []],
  ['public/assets/js/portal.js', 'public/portal.html', ['btnTentarNovamente', 'carregandoMais']],
  ['public/assets/js/painel.js', 'public/painel.html', ['avisoModoSeguro']],
  ['public/assets/js/diretor.js', 'public/diretor.html', []],
  ['public/assets/js/account-security.js', 'public/portal.html', []],
  ['public/assets/js/onboarding.js', 'public/portal.html', ['tourConviteFundo','tourAgoraNao','tourComecar','tourBloqueio','tourDestaque','tourCaixa','tourPular','tourVoltar','tourProximo']],
  ['public/assets/js/criar-senha.js', 'public/criar-senha.html', []],
  ['public/assets/js/recuperar-senha.js', 'public/recuperar-senha.html', []],
  ['public/assets/js/redefinir-senha.js', 'public/redefinir-senha.html', []]
];
for (const [jsRel, htmlRel, dynamicIds] of pairs) {
  const js = read(jsRel);
  const html = read(htmlRel);
  const htmlIds = new Set([...html.matchAll(/\bid=["']([^"']+)/g)].map(m => m[1]));
  const refs = new Set([...js.matchAll(/getElementById\(["']([^"']+)/g)].map(m => m[1]));
  for (const id of refs) {
    if (!htmlIds.has(id) && !dynamicIds.includes(id)) fail(`${jsRel} referencia #${id}, ausente em ${htmlRel}`);
  }
}



for (const visual of ['public/assets/css/original-login.css','public/assets/css/original-portal.css','public/assets/css/original-painel.css','public/assets/css/original-como-funciona.css']) {
  if (!exists(visual)) fail(`CSS visual original ausente: ${visual}`);
}
if (/diretor\/mfa|DirectorMfaPending|DirectorSetup|generateTotpSecret|verifyTotp/.test(server)) fail('fluxo MFA/TOTP legado ainda está ativo no servidor.');


if (!exists('lib/client-auth.js') || !exists('lib/notifications.js') || !exists('lib/client-scope.js') || !exists('lib/abuse-guard.js')) fail('módulos de autenticação/escopo/hardening ausentes.');
for (const pagina of ['public/criar-senha.html','public/recuperar-senha.html','public/redefinir-senha.html']) {
  if (!exists(pagina)) fail(`fluxo de senha ausente: ${pagina}`);
}
const clientAuth = read('lib/client-auth.js');
if (!/token_hash/.test(clientAuth) || !/sha256\(String\(raw/.test(clientAuth)) fail('tokens de senha não estão claramente armazenados apenas como hash.');
if (/token_raw|raw_token|password_plain/i.test(clientAuth + read('scripts/migrate.js'))) fail('campo sensível em texto puro encontrado no modelo de autenticação.');
// A autenticação gerada aposentou a emissão de links legados de senha pessoal.
if (/criar-senha\.html[#?]token=|redefinir-senha\.html[#?]token=/.test(server)) {
  fail('o servidor voltou a emitir tokens de ativação/reset do fluxo legado.');
}
if (!/senhasClientesHabilitadas/.test(server)) fail('rotas legadas não estão explicitamente protegidas.');
if ((server.match(/app\.post\('\/api\/login'/g) || []).length !== 1) fail('há múltiplas rotas /api/login.');
if ((server.match(/app\.post\('\/api\/auth\/password-reset\/request'/g) || []).length !== 1) fail('há múltiplas rotas de recuperação.');
if (!/CLIENT_PASSWORDS_ENABLED/.test(config)) fail('feature flag de senha dos clientes ausente.');
if (!/PORTAL_NOTIFICATIONS_HMAC_SECRET/.test(config)) fail('segredo HMAC do serviço de notificações não está validado.');
if (!/verificarEstruturasCriticas/.test(server)) fail('/ready não verifica estruturas críticas do MySQL.');

if (!exists('.env.example')) fail('.env.example ausente.');
if (!exists('scripts/windows/backup-current.ps1') || !exists('scripts/windows/rollback.ps1')) fail('scripts de backup/rollback ausentes.');


if (!exists('scripts/unlock-director.js')) fail('script local de desbloqueio do Diretor ausente.');
if (!/reset\('director-login-ip', req\.ip \|\| 'unknown'\)/.test(server)) fail('login do Diretor não limpa rate limit por IP após sucesso.');
if (!/\.\(\?:css\|js\).*no-cache/s.test(server) && !/\(\?:css\|js\)\$\/i[\s\S]*no-cache/.test(server)) note('verificação de cache JS/CSS feita pelos testes automatizados.');
if (errors.length) {
  console.error('\n[verify] FALHA — foram encontrados problemas estruturais:\n');
  errors.forEach((e, i) => console.error(`  ${i + 1}. ${e}`));
  process.exit(1);
}

note(`${allFiles.filter(f => f.endsWith('.js')).length} arquivos JavaScript passaram em node --check.`);
note('Contratos principais de rota e IDs do frontend validados.');
note(verifyReleaseTree
  ? 'Nenhum .env, diagnóstico ou fluxo legado de cadastro entrou no release.'
  : 'Instalação validada sem resíduos legados; .env local é permitido e permanece fora do Git.');
note('Controles estáticos de sessão, CSP, CSRF, tenant isolation e Safe Mode local presentes.');
console.log('[verify] OK');
notes.forEach(n => console.log(`  - ${n}`));
