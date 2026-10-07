'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
Object.assign(process.env,{NODE_ENV:'test',AIRTABLE_TOKEN:'fake',AIRTABLE_BASE_ID:'appFake',DB_HOST:'localhost',DB_USER:'fake',DB_NAME:'fake',PORTAL_SECURITY_PEPPER:Buffer.alloc(32,1).toString('base64'),PORTAL_NOTIFICATIONS_URL:'http://localhost:3999',PORTAL_NOTIFICATIONS_HMAC_SECRET:Buffer.alloc(32,2).toString('base64'),CLIENT_AUTH_MODE:'generated'});
let session=null, calls=[], queries=[], unavailable=false;
const originalLoad=Module._load;
Module._load=function(request,parent,isMain){
 if((request==='./db'||request==='../db')&&parent.filename.includes('APLICACAO_PORTAL')) return {query:async(sql,params)=>{queries.push({sql,params});return [[{cnpj:'12345678000190',record_id_trabalho:'recAAAAAAAAAAAAAA',baixado_em:'2026-10-06'}],[]];}};
 if(request==='./airtable'&&parent.filename.endsWith('server.js')) return {
  buscarContatosConta:async(cnpj,id)=>{calls.push({cnpj,id});if(unavailable)throw new Error('unavailable');return {documento:cnpj,emails:['a@example.test','b@example.test'],whatsapps:['61999999999']};},
  listarClientes:async()=>{throw new Error('Resumo não deve consultar Airtable');},
  detalhesTrabalhosPorIds:async()=>{throw new Error('Resumo não deve consultar detalhes');}
 };
 if(request==='./lib/sessions') return {loadSession:async()=>session};
 return originalLoad.call(this,request,parent,isMain);
};
const {app}=require('../server');Module._load=originalLoad;
test('HTTP Conta: sessão obrigatória, identidade da sessão, falha explícita e ausência de cache público',async()=>{
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
 try {
  assert.equal((await fetch(origin+'/api/conta')).status,401);
  session={role:'Director'};assert.equal((await fetch(origin+'/api/conta')).status,403);
  session={role:'GeneratedClient',documento:'12345678000190',airtableId:'recAAAAAAAAAAAAAA'};
  let response=await fetch(origin+'/api/conta?cnpj=99999999000190');
  assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);
  assert.deepEqual(calls.at(-1),{cnpj:session.documento,id:session.airtableId});
  assert.equal((await response.json()).conta.emails.length,2);
  unavailable=true;assert.equal((await fetch(origin+'/api/conta')).status,503);unavailable=false;
  assert.equal((await fetch(origin+'/api/diretor/downloads?resumo=1&cnpj=12345678000190')).status,403);
  session={role:'Director'};
  response=await fetch(origin+'/api/diretor/downloads?resumo=1&cnpj=12345678000190');
  assert.equal(response.status,200);assert.equal((await response.json()).downloads.length,1);
  assert.match(queries.at(-1).sql,/WHERE cnpj = \?/);assert.deepEqual(queries.at(-1).params,['12345678000190',500]);
  assert.equal((await fetch(origin+'/api/diretor/downloads?resumo=1&cnpj=invalid')).status,400);
 } finally {await new Promise(r=>server.close(r));}
});
