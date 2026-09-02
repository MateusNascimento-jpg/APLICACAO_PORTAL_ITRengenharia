
'use strict';
const fs=require('fs');
const path=require('path');
const test=require('node:test');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const read=r=>fs.readFileSync(path.join(root,r),'utf8');

test('PDF e trabalhos autorizam pelo escopo de Record IDs, nao por texto',()=>{
  const a=read('airtable.js');
  assert.match(a,/resolverEscopoCliente/);
  assert.match(a,/links\.some\(id => scopeClientIds\.includes\(id\)\)/);
  assert.doesNotMatch(a,/\{Cliente\}\s*=\s*'\$\{escaparFormula\(.*Cliente/);
});

test('login usa conta existente em qualquer membro do escopo',()=>{
  const s=read('server.js');
  assert.match(s,/verifyPasswordInScope\(cliente\.scopeClientIds/);
  assert.match(s,/findScopeAccount\(cliente\.scopeClientIds/);
});

test('hardening anti-abuso inclui cheap guard, limite scrypt e timeouts do servidor',()=>{
  const server=read('server.js'); const crypto=read('lib/security-crypto.js');
  assert.match(server,/apiBurstGuard/); assert.match(server,/loginBurstGuard/);
  assert.match(server,/headersTimeout\s*=\s*15000/); assert.match(server,/requestTimeout\s*=\s*30000/);
  assert.match(crypto,/scryptQueue/); assert.match(crypto,/AUTH_BUSY/);
});
