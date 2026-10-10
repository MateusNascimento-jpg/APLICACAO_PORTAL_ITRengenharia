
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
Object.assign(process.env, {NODE_ENV:'test',AIRTABLE_TOKEN:'fake',AIRTABLE_BASE_ID:'appFake',DB_HOST:'localhost',DB_USER:'fake',DB_NAME:'fake',PORTAL_SECURITY_PEPPER:Buffer.alloc(32,1).toString('base64'),PORTAL_NOTIFICATIONS_URL:'http://localhost:3999',PORTAL_NOTIFICATIONS_HMAC_SECRET:Buffer.alloc(32,2).toString('base64'),CLIENT_AUTH_MODE:'generated'});
const identity={id:'recAAAAAAAAAAAAAA',cnpj:'12345678000190',idCliente:'Teste',accessPassword:'EX123456',emails:['a@example.test','b@example.test'],emailLogin:'a@example.test'};
const sent=[],created=[],resets=[],queries=[];let limited=false;
const mockPool={query:async (...args)=>{queries.push(args);return [[],[]];},verificarBanco:async()=>true,encerrarBanco:async()=>{}};
const realLoad=Module._load;
Module._load=function(request,parent,isMain){
 if ((request==='./db'||request==='../db')&&parent.filename.startsWith(require('node:path').resolve(__dirname, '..') + require('node:path').sep)) return mockPool;
 if(request==='./airtable'&&parent.filename.endsWith('server.js')) return {buscarIdentidadeAcesso:async d=>d===identity.cnpj?identity:null,recordIdValido:()=>true};
 if(request==='./lib/sessions') return {loadSession:async()=>null,createSession:async(_q,_r,data)=>{created.push(data);return {csrfToken:'test-csrf'};},destroySession:async()=>{},verifyCsrf:()=>false};
 if(request==='./lib/rate-limit') return {consume:async()=>({ok:!limited}),reset:async(...a)=>resets.push(a),defensiveDelay:async()=>{}};
 if(request==='./lib/audit') return {audit:async()=>{}};
 if(request==='./lib/notifications') return {sendSecurityNotification:async(type,payload)=>sent.push({type,...payload})};
 return realLoad.call(this,request,parent,isMain);
};
const {app}=require('../server');Module._load=realLoad;
test('HTTP: credencial, recuperação, origem, logout expirado e aposentadoria de tokens',async()=>{
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const post=(url,body,customOrigin=origin)=>fetch(origin+url,{method:'POST',headers:{'Content-Type':'application/json',Origin:customOrigin},body:JSON.stringify(body)});
 try {
  let r=await post('/api/login',{documento:identity.cnpj,senha:identity.accessPassword});assert.equal(r.status,200);assert.equal((await r.json()).csrfToken,'test-csrf');assert.equal(created[0].role,'GeneratedClient');assert.equal(created[0].airtableId,identity.id);assert.equal(sent.length,0);assert.ok(!resets.some(a=>a[0]==='client-login-ip'));
  r=await post('/api/login',{documento:identity.cnpj,senha:identity.emailLogin});assert.equal(r.status,401);
  r=await post('/api/login',{documento:identity.cnpj,senha:identity.accessPassword},'https://attacker.invalid');assert.equal(r.status,403);
  r=await post('/api/auth/password-reset/request',{documento:identity.cnpj,email:'attacker@example.test'});assert.equal(r.status,202);const known=await r.json();assert.equal(sent.length,1);assert.deepEqual(sent[0].client.emails,identity.emails);assert.equal(sent[0].client.accessPassword,'EX123456');assert.equal(sent[0].type,'ACCESS_REQUEST');assert.equal(created.length,1);
  r=await post('/api/auth/password-reset/request',{documento:'99999999999999'});assert.equal(r.status,202);assert.deepEqual(await r.json(),known);assert.equal(sent.length,1);
  r=await post('/api/logout',{});assert.equal(r.status,200);
  r=await post('/api/auth/password/activate',{});assert.equal(r.status,410);
  limited=true;r=await post('/api/login',{documento:identity.cnpj,senha:identity.accessPassword});assert.equal(r.status,429);
  assert.ok(!queries.some(([sql])=>/DELETE FROM portal_sessions|portal_password_tokens/i.test(sql)));
 } finally {await new Promise(r=>server.close(r));}
});
