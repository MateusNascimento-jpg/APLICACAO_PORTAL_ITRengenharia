const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { allowed, root } = require('../preview/guard');
test('prévia exige marcador local e recusa deployments', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itr-preview-'));
  const file = path.join(dir, 'marker.json');
  try {
    assert.equal(allowed({ NODE_ENV: 'development' }, file), false);
    fs.writeFileSync(file, JSON.stringify({ root, isolatedPreview: true }));
    assert.equal(allowed({ NODE_ENV: 'development' }, file), true);
    for (const env of [{}, { NODE_ENV: 'production' }, { NODE_ENV: 'test' }, { NODE_ENV: 'development', VERCEL: '1' }, { NODE_ENV: 'development', VERCEL_ENV: 'preview' }, { NODE_ENV: 'development', RENDER: 'true' }]) assert.equal(allowed(env, file), false);
    fs.writeFileSync(file, JSON.stringify({ root: '/outro', isolatedPreview: true }));
    assert.equal(allowed({ NODE_ENV: 'development' }, file), false);
  } finally { fs.rmSync(dir, { recursive: true }); }
});
test('HTTP isolado: páginas, personas, escritas e arquivos privados', async (t) => {
  if (!allowed({ ...process.env, NODE_ENV: 'development' })) return t.skip('Teste HTTP requer autorização local do sandbox.');
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  const { createApp } = require('../preview/server');
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const page of ['/', '/portal.html', '/painel.html', '/recuperar-senha.html']) {
      const res = await fetch(base + page);
      assert.equal(res.status, 200);
      assert.match(await res.text(), /__preview\/adapter.js/);
      assert.match(res.headers.get('content-security-policy'), /connect-src 'self'/);
    }
    for (const persona of ['director', 'client']) {
      const res = await fetch(base + '/api/perfil', { headers: { 'X-ITR-Preview-Persona': persona } });
      assert.equal((await res.json()).usuario.perfil, persona === 'director' ? 'Director' : 'Cliente');
      assert.equal(res.headers.get('set-cookie'), null);
    }
    for (const route of ['/api/login', '/api/logout', '/api/auth/password/reset', '/api/trabalho/demo-1/aprovacao']) {
      for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal((await fetch(base + route, { method })).status, 423);
    }
    assert.equal((await fetch(base + '/api/trabalho/demo-1/download')).status, 423);
    for (const file of ['/config.js', '/server.js', '/.env', '/.itr-preview-local.json']) assert.equal((await fetch(base + file)).status, 404);
    const imports = Object.keys(require.cache);
    for (const file of ['server.js', 'config.js', 'db.js']) assert.equal(imports.includes(path.join(root, file)), false);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (before === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = before;
  }
});
