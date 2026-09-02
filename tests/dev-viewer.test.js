
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('visualizador DEV usa rota separada e reaproveita a sessao/tela Cliente', () => {
  const server = read('server.js');
  assert.match(server, /app\.post\('\/api\/dev\/login',\s*sameOriginOnly/);
  assert.match(server, /credenciaisDevValidas/);
  assert.match(server, /role:\s*'Cliente'[\s\S]*airtableId:\s*cliente\.id/);
  assert.match(server, /redirectTo:\s*'\/portal\.html'/);
  assert.match(server, /buscarClientePorCnpj\(documento\)/);
});

test('credenciais DEV ficam somente em variaveis de ambiente', () => {
  const config = read('config.js');
  const envExample = read('.env.example');
  const server = read('server.js');
  assert.match(config, /DEV_VIEWER_ENABLED/);
  assert.match(config, /DEV_VIEWER_USERNAME/);
  assert.match(config, /DEV_VIEWER_PASSWORD/);
  assert.match(envExample, /DEV_VIEWER_ENABLED=false/);
  assert.doesNotMatch(server, /dev_itr_2rphat|eU@v\*3VJ!akDG9%e7VI8L2sJ/);
});

test('pagina DEV usa o mesmo visual do login e envia CNPJ + credenciais para rota DEV', () => {
  const html = read('public/dev-login.html');
  const js = read('public/assets/js/dev-login.js');
  assert.match(html, /assets\/css\/original-login\.css/);
  assert.match(html, /id="usuarioDev"/);
  assert.match(html, /id="senhaDev"/);
  assert.match(html, /id="documento"/);
  assert.match(js, /fetch\('\/api\/dev\/login'/);
  assert.match(js, /window\.location\.replace\(result\.data\.redirectTo\|\|'\/portal\.html'\)/);
});
