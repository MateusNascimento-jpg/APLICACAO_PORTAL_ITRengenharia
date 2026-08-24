'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const airtable = fs.readFileSync(path.join(root, 'airtable.js'), 'utf8');

const legacyRoutes = [
  '/api/cadastro', '/cadastro', '/api/login', '/api/perfil', '/perfil', '/api/meus-dados',
  '/api/trabalhos', '/api/trabalho/:id/download', '/api/relatorio/:id', '/api/diretor/clientes',
  '/api/clientes', '/api/diretor/trabalhos/:clienteId', '/api/cliente/:id/trabalhos',
  '/api/trabalho/:id/aprovacao', '/api/diretor/downloads', '/api/esqueci-senha', '/api/redefinir-senha'
];

test('contratos de rota do baseline permanecem reconhecidos', () => {
  for (const route of legacyRoutes) assert.ok(server.includes(route), `rota ausente: ${route}`);
});

test('campos Airtable essenciais do fluxo atual permanecem reconhecidos', () => {
  for (const field of [
    'CNPJ', 'Email', 'Cliente', 'ID Trabalho', 'Aprovação', 'Relatórios_Aprovados',
    'Relatórios', 'OS', 'Ensaio', 'Amostra'
  ]) {
    assert.ok(airtable.includes(field), `campo Airtable esperado ausente: ${field}`);
  }
});

test('cadastro e reset legados falham fechados em vez de serem reativados', () => {
  assert.match(server, /app\.post\(\['\/api\/cadastro', '\/cadastro'\]/);
  assert.match(server, /410/);
  assert.ok(!fs.existsSync(path.join(root, 'public', 'cadastro.html')));
});
