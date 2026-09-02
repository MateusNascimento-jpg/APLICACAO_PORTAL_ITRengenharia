
'use strict';
// Simulacao LOCAL; nao envia trafego para Render/Airtable.
const { performance } = require('node:perf_hooks');
const { createInMemoryGuard } = require('../lib/abuse-guard');
const { buildClientScopes } = require('../lib/client-scope');

const guard=createInMemoryGuard({limit:120,windowMs:60000,maxKeys:10000});
let allowed=0,blocked=0; const t0=performance.now();
for(let i=0;i<100000;i++){ const r=guard.consume(`ip-${i%500}`,1000); if(r.ok)allowed++; else blocked++; }
const guardMs=performance.now()-t0;

const clients=[]; const works=[];
for(let c=0;c<30;c++){ const id=`rec${String(c).padStart(14,'0')}`; clients.push({id,fields:{'ID Cliente':`Empresa ${c}`,'Nome Cliente':`Empresa ${c}`,CNPJ:String(10000000000000+c),'Email Cliente':`c${c}@example.com`}}); for(let w=0;w<90;w++) works.push({id:`rec${String(c*100+w).padStart(14,'1')}`.slice(0,17),fields:{Cliente:[id],'ID Trabalho':`Empresa ${c}_Amostra ${w}`,'Link Amostras':`Amostra ${c} projeto ${w}`}}); }
const t1=performance.now(); const model=buildClientScopes(clients,works); const scopeMs=performance.now()-t1;
console.log(JSON.stringify({simulationOnly:true,requests:100000,allowed,blocked,guardMs:Number(guardMs.toFixed(2)),clients:clients.length,works:works.length,scopes:model.scopes.length,scopeBuildMs:Number(scopeMs.toFixed(2))},null,2));
if(guardMs>5000 || scopeMs>5000) process.exitCode=1;
