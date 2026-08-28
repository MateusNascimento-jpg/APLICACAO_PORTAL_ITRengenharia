'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'public');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const pairs = [
  ['assets/js/login.js', 'login.html', []],
  ['assets/js/portal.js', 'portal.html', ['btnTentarNovamente', 'carregandoMais']],
  ['assets/js/painel.js', 'painel.html', ['avisoModoSeguro']],
  ['assets/js/diretor.js', 'diretor.html', []],
  ['assets/js/account-security.js', 'portal.html', []],
  ['assets/js/onboarding.js', 'portal.html', ['tourConviteFundo','tourAgoraNao','tourComecar','tourBloqueio','tourDestaque','tourCaixa','tourPular','tourVoltar','tourProximo']],
  ['assets/js/criar-senha.js', 'criar-senha.html', []],
  ['assets/js/recuperar-senha.js', 'recuperar-senha.html', []],
  ['assets/js/redefinir-senha.js', 'redefinir-senha.html', []]
];

for (const [jsRel, htmlRel, dynamic] of pairs) {
  test(`${jsRel} só usa IDs existentes ou criados dinamicamente`, () => {
    const js = read(jsRel);
    const html = read(htmlRel);
    const ids = new Set([...html.matchAll(/\bid=["']([^"']+)/g)].map(m => m[1]));
    const refs = new Set([...js.matchAll(/getElementById\(["']([^"']+)/g)].map(m => m[1]));
    const missing = [...refs].filter(id => !ids.has(id) && !dynamic.includes(id));
    assert.deepEqual(missing, []);
  });
}

test('links históricos do Portal continuam presentes', () => {
  assert.ok(fs.existsSync(path.join(root, 'login.html')));
  assert.ok(fs.existsSync(path.join(root, 'portal.html')));
  assert.ok(fs.existsSync(path.join(root, 'painel.html')));
  assert.ok(fs.existsSync(path.join(root, 'como-funciona.html')));
  assert.ok(fs.existsSync(path.join(root, 'criar-senha.html')));
  assert.ok(fs.existsSync(path.join(root, 'recuperar-senha.html')));
  assert.ok(fs.existsSync(path.join(root, 'redefinir-senha.html')));
});
