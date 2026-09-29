'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const Module=require('node:module');
let role='Cliente';const cfg={production:false,clientAuth:{mode:'generated'},devViewer:{enabled:false},security:{cookieName:'session',pepper:Buffer.alloc(32,1).toString('base64')}};
const loader=Module._load;Module._load=function(request,parent,isMain){
 if(request==='../config'&&parent.filename.endsWith('sessions.js'))return cfg;
 if(request==='../db'&&parent.filename.endsWith('sessions.js'))return {query:async()=>[[{role,last_seen_at:new Date(),session_hash:'hash'}]]};
 if(request==='./security-crypto'&&parent.filename.endsWith('sessions.js'))return {sha256:x=>x};
 return loader.call(this,request,parent,isMain);
};
const {loadSession}=require('../lib/sessions');Module._load=loader;
test('migração rejeita sessões Cliente antigas e DEV desativado; mantém sessões geradas',async()=>{
 const req={headers:{cookie:'session=token'}};
 assert.equal(await loadSession(req),null);role='DevViewer';assert.equal(await loadSession(req),null);role='GeneratedClient';assert.equal((await loadSession(req)).role,'GeneratedClient');role='Director';assert.equal((await loadSession(req)).role,'Director');
});
