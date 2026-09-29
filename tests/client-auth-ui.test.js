'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');

test('login pede somente CNPJ e senha gerada',()=>{
  const html=read('public/login.html');
  const js=read('public/assets/js/login.js');
  assert.match(html,/Esqueci minha senha/);
  assert.doesNotMatch(js,/primeiroAcesso/);
  assert.match(html,/placeholder="Senha"/);
});

test('onboarding é opcional, pulável e guarda só preferência neste navegador',()=>{
  const js=read('public/assets/js/onboarding.js');
  const server=read('server.js');
  assert.match(js,/Quer conhecer o Portal em 1 minuto/);
  assert.match(js,/Agora não/);
  assert.match(js,/Pular tutorial/);
  assert.match(js,/itr-tour-version/);
  assert.match(server,/markOnboarding/);
});

test('conta orienta recuperação e mantém o tour disponível',()=>{
  const html=read('public/portal.html');
  const js=read('public/assets/js/account-security.js');
  assert.doesNotMatch(html,/id="formAlterarSenha"/);
  assert.match(html,/id="btnRefazerTour"/);
  assert.match(html,/Receber dados de acesso/);
  assert.doesNotMatch(js,/fetch\(/);
});
