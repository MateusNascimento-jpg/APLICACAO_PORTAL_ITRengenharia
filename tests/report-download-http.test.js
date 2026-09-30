'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const Module=require('node:module');
Object.assign(process.env,{NODE_ENV:'test',AIRTABLE_TOKEN:'fake',AIRTABLE_BASE_ID:'appFake',DB_HOST:'localhost',DB_USER:'fake',DB_NAME:'fake',PORTAL_SECURITY_PEPPER:Buffer.alloc(32,1).toString('base64'),PORTAL_NOTIFICATIONS_URL:'http://localhost:3999',PORTAL_NOTIFICATIONS_HMAC_SECRET:Buffer.alloc(32,2).toString('base64'),CLIENT_AUTH_MODE:'generated'});
let session=null;const calls=[];const id='recAAAAAAAAAAAAAA';
const attachments=[{id:'attA',nome:'a.pdf',url:'https://dl.airtable.com/a.pdf'},{id:'attB',nome:'b.pdf',url:'https://dl.airtable.com/b.pdf'}];
const originalLoad=Module._load;
Module._load=function(request,parent,isMain){
 if((request==='./db'||request==='../db')&&parent.filename.includes('APLICACAO_PORTAL'))return {query:async()=>[[],[]],verificarBanco:async()=>true};
 if(request==='./airtable'&&parent.filename.endsWith('server.js')) return {
  recordIdValido:x=>/^rec[A-Za-z0-9]{14}$/.test(x),
  relatoriosAprovados:async(work,client)=>{calls.push({work,client,list:true});return attachments;},
  urlRelatorioAprovado:async(work,client,file)=>{calls.push({work,client,file});return file==null?attachments[0]:attachments.find(a=>a.id===file)||null;}
 };
 if(request==='./lib/sessions')return {loadSession:async()=>session};
 if(request==='./lib/audit')return {audit:async()=>{}};
 return originalLoad.call(this,request,parent,isMain);
};
const {app}=require('../server');Module._load=originalLoad;
test('HTTP: lista varios PDFs, seleciona por ID e exige sessao no proxy',async()=>{
 const realFetch=global.fetch;
 global.fetch=(url,opts)=>String(url).startsWith('https://dl.airtable.com/')?Promise.resolve(new Response('%PDF-1.4\nTEST',{headers:{'content-type':'application/pdf'}})):realFetch(url,opts);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
 try{
  assert.equal((await realFetch(origin+'/api/trabalho/'+id+'/download')).status,401);
  session={role:'GeneratedClient',airtableId:'recBBBBBBBBBBBBBB',documento:'12345678000190'};
  let response=await realFetch(origin+'/api/trabalho/'+id+'/download');assert.equal(response.status,200);const data=await response.json();assert.equal(data.arquivos.length,2);assert.equal(data.url,data.arquivos[0].url);assert.ok(data.arquivos[1].url.endsWith('?arquivo=attB'));assert.equal(calls.at(-1).client,session.airtableId);
  response=await realFetch(origin+data.arquivos[1].url);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/application\/pdf/);assert.match(await response.text(),/^%PDF/);assert.equal(calls.at(-1).file,'attB');assert.equal(calls.at(-1).client,session.airtableId);
  assert.equal((await realFetch(origin+'/api/relatorio/'+id+'?arquivo=removed')).status,404);
  session=null;assert.equal((await realFetch(origin+data.arquivos[0].url)).status,401);
 }finally{global.fetch=realFetch;await new Promise(r=>server.close(r));}
});
