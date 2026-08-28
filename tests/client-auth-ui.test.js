'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');

test('login explica a migração para senha pessoal sem remover compatibilidade inicial',()=>{
  const html=read('public/login.html');
  const js=read('public/assets/js/login.js');
  assert.match(html,/Esqueci minha senha/);
  assert.match(js,/No primeiro acesso/);
  assert.match(js,/clientPasswordsEnabled/);
});

test('onboarding é opcional, pulável e persistido no servidor',()=>{
  const js=read('public/assets/js/onboarding.js');
  const server=read('server.js');
  assert.match(js,/Quer conhecer o Portal em 1 minuto/);
  assert.match(js,/Agora não/);
  assert.match(js,/Pular tutorial/);
  assert.match(js,/\/api\/onboarding/);
  assert.match(server,/markOnboarding/);
});

test('conta permite troca de senha e replay do tour',()=>{
  const html=read('public/portal.html');
  const js=read('public/assets/js/account-security.js');
  assert.match(html,/id="formAlterarSenha"/);
  assert.match(html,/id="btnRefazerTour"/);
  assert.match(js,/\/api\/auth\/password\/change/);
});
