
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('visualizador DEV usa rota separada e usa papel próprio e reaproveita a tela Cliente', () => {
  const server = read('server.js');
  assert.match(server, /app\.post\('\/api\/dev\/login',\s*sameOriginOnly/);
  assert.match(server, /credenciaisDevValidas/);
  assert.match(server, /role:\s*'DevViewer'[\s\S]*airtableId:\s*cliente\.id/);
  assert.match(server, /redirectTo:\s*'\/portal\.html'/);
  assert.match(server, /buscarClientePorCnpj\(documento\)/);
});

test('credenciais DEV ficam somente em variaveis de ambiente', () => {
  const config = read('config.js');
  const envExample = read('.env.example');
  assert.match(config, /DEV_VIEWER_ENABLED/);
  assert.match(config, /DEV_VIEWER_USERNAME/);
  assert.match(config, /DEV_VIEWER_PASSWORD/);
  assert.match(config, /username:\s*String\(process\.env\.DEV_VIEWER_USERNAME/);
  assert.match(config, /password:\s*String\(process\.env\.DEV_VIEWER_PASSWORD/);
  assert.match(envExample, /DEV_VIEWER_ENABLED=false/);
  assert.match(envExample, /DEV_VIEWER_USERNAME=\s*$/m);
  assert.match(envExample, /DEV_VIEWER_PASSWORD=\s*$/m);
});

test('pagina DEV usa o mesmo visual do login e envia CNPJ + credenciais para rota DEV', () => {
  const html = read('public/dev-login.html');
  const js = read('public/assets/js/dev-login.js');
  assert.match(html, /assets\/css\/original-login\.css/);
  assert.match(html, /id="usuarioDev"/);
  assert.match(html, /id="senhaDev"/);
  assert.match(html, /id="documento"/);
  assert.match(html, /<form id="formDevLogin"[^>]*autocomplete="off"/);
  assert.match(html, /id="usuarioDev"[^>]*autocomplete="off"/);
  assert.match(html, /id="senhaDev"[^>]*autocomplete="new-password"/);
  assert.match(js, /fetch\('\/api\/dev\/login'/);
  assert.match(js, /senha enviada tinha '\+tamanhoSenha\+' caracteres/);
  assert.match(js, /senha\.value=''/);
  assert.match(js, /window\.location\.replace\(result\.data\.redirectTo\|\|'\/portal\.html'\)/);
});
