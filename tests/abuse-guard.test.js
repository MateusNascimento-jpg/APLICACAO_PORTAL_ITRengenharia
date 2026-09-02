
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const { createInMemoryGuard }=require('../lib/abuse-guard');

test('burst excessivo e bloqueado antes de DB/scrypt',()=>{
  const guard=createInMemoryGuard({limit:20,windowMs:60000,maxKeys:100});
  let ok=0,blocked=0;
  for(let i=0;i<100;i++){ const r=guard.consume('203.0.113.10',1000); if(r.ok)ok++; else blocked++; }
  assert.equal(ok,20); assert.equal(blocked,80);
});

test('janela expirada libera novamente',()=>{
  const guard=createInMemoryGuard({limit:2,windowMs:1000});
  assert.equal(guard.consume('x',0).ok,true); assert.equal(guard.consume('x',0).ok,true); assert.equal(guard.consume('x',0).ok,false); assert.equal(guard.consume('x',1001).ok,true);
});

test('mapa de IPs permanece limitado sob cardinalidade hostil',()=>{
  const guard=createInMemoryGuard({limit:1,windowMs:60000,maxKeys:50});
  for(let i=0;i<500;i++) guard.consume(`198.51.100.${i}`,1000);
  assert.ok(guard.size()<=50);
});
