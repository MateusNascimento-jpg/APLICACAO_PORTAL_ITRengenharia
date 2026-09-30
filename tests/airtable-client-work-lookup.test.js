'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalModuleLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'dotenv') return { config() { return {}; } };
  return originalModuleLoad.call(this, request, parent, isMain);
};
process.env.PORTAL_NOTIFICATIONS_URL = 'http://localhost:3001';
process.env.PORTAL_NOTIFICATIONS_HMAC_SECRET = Buffer.alloc(32, 1).toString('base64');
process.on('exit', () => { Module._load = originalModuleLoad; });

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async text() { return JSON.stringify(body); } };
}
function env() {
  process.env.AIRTABLE_TOKEN = 'test-token';
  process.env.AIRTABLE_BASE_ID = 'appTESTBASE12345';
  process.env.DB_HOST = 'localhost'; process.env.DB_USER = 'test'; process.env.DB_PASS = 'test'; process.env.DB_NAME = 'test';
  process.env.PORTAL_SECURITY_PEPPER = Buffer.alloc(32, 7).toString('base64');
  process.env.CLIENT_PASSWORDS_ENABLED = 'false';
  process.env.PORTAL_SCOPE_PAGE_PACE_MS = '120';
}

async function runScenario({ clients, works, seedId, modo = 'todos' }) {
  env();
  const originalFetch = global.fetch;
  global.fetch = async url => {
    const parsed = new URL(String(url));
    if (parsed.pathname.endsWith('/tblkQxQ6q7cBKXZ3C')) return jsonResponse({ records: clients });
    if (parsed.pathname.endsWith('/tblJAP4Av9sWm8SmL')) return jsonResponse({ records: works });
    if (parsed.pathname.endsWith('/tblYtVM2crMxpxHgG')) return jsonResponse({ records: [] });
    if (decodeURIComponent(parsed.pathname).endsWith('/Ordem de Serviço')) return jsonResponse({ records: [] });
    throw new Error(`URL nao prevista: ${url}`);
  };
  try {
    for (const rel of ['../config', '../lib/client-scope', '../airtable']) delete require.cache[require.resolve(rel)];
    const { buscarTrabalhosDoCliente } = require('../airtable');
    return await buscarTrabalhosDoCliente(seedId, null, modo, 3);
  } finally { global.fetch = originalFetch; }
}

test('escopo empresarial une dois Record IDs e continua excluindo terceiro tenant', async () => {
  const A=`rec${'A'.repeat(14)}`, B=`rec${'B'.repeat(14)}`, C=`rec${'C'.repeat(14)}`;
  const clients=[
    {id:A,fields:{'ID Cliente':'Grupo Aterpa','Nome Cliente':'Grupo Aterpa',CNPJ:'17162983000165','Email Cliente':'a@aterpa.com.br'}},
    {id:B,fields:{'ID Cliente':'Aterpa - Macae','Nome Cliente':'Grupo Aterpa',CNPJ:'17162983005124','Email Cliente':'b@aterpa.com.br'}},
    {id:C,fields:{'ID Cliente':'Outro Cliente','Nome Cliente':'Outro Cliente',CNPJ:'99999999999999','Email Cliente':'outro@example.com'}}
  ];
  const works=[];
  for(let i=0;i<4;i++) works.push({id:`rec${('D'+String(i)).padEnd(14,'D')}`,createdTime:'2026-09-01T12:00:00.000Z',fields:{Cliente:[A],'ID Trabalho':`Grupo Aterpa_A-${i}`,'Link Amostras':`Amostra A ${i}`,'Status Cliente':'Amostra Recebida'}});
  for(let i=0;i<4;i++) works.push({id:`rec${('E'+String(i)).padEnd(14,'E')}`,createdTime:'2026-09-01T12:00:00.000Z',fields:{Cliente:[B],'ID Trabalho':`Grupo Aterpa_B-${i}`,'Link Amostras':`Amostra B ${i}`,'Status Cliente':'Amostra Recebida'}});
  works.push({id:`rec${'F'.repeat(14)}`,createdTime:'2026-09-01T12:00:00.000Z',fields:{Cliente:[C],'ID Trabalho':'Outro_X','Link Amostras':'Segredo outro tenant','Status Cliente':'Amostra Recebida'}});
  const result=await runScenario({clients,works,seedId:A});
  assert.equal(result.trabalhos.length,8);
  assert.ok(result.trabalhos.every(t=>t.id!==`rec${'F'.repeat(14)}`));
});

test('uma amostra igual isolada nao rompe tenant isolation', async () => {
  const A=`rec${'G'.repeat(14)}`, B=`rec${'H'.repeat(14)}`;
  const clients=[
    {id:A,fields:{'ID Cliente':'Empresa A','Nome Cliente':'Empresa A',CNPJ:'11111111111111','Email Cliente':'a@a.com'}},
    {id:B,fields:{'ID Cliente':'Empresa B','Nome Cliente':'Empresa B',CNPJ:'22222222222222','Email Cliente':'b@b.com'}}
  ];
  const works=[
    {id:`rec${'I'.repeat(14)}`,createdTime:'2026-09-01T12:00:00.000Z',fields:{Cliente:[A],'ID Trabalho':'Empresa A_X','Link Amostras':'Brita 0 Pedreira Comum','Status Cliente':'Amostra Recebida'}},
    {id:`rec${'J'.repeat(14)}`,createdTime:'2026-09-01T12:00:00.000Z',fields:{Cliente:[B],'ID Trabalho':'Empresa B_X','Link Amostras':'Brita 0 Pedreira Comum','Status Cliente':'Amostra Recebida'}}
  ];
  const result=await runScenario({clients,works,seedId:A});
  assert.equal(result.trabalhos.length,1);
  assert.equal(result.trabalhos[0].id,`rec${'I'.repeat(14)}`);
});

test('identidade por CNPJ não consulta trabalhos e reúne só seus contatos', async () => {
  env(); const previous=global.fetch;let requests=0;
  const records=[
    {id:'recAAAAAAAAAAAAAA',fields:{CNPJ:'12345678000190','Sigla Cliente':'EX','Email Cliente':'a@example.test;b@example.test'}},
    {id:'recBBBBBBBBBBBBBB',fields:{CNPJ:'12345678000190','Sigla Cliente':'EX','Email Cliente':'c@example.test'}},
    {id:'recCCCCCCCCCCCCCC',fields:{CNPJ:'99999999000190','Sigla Cliente':'OUT','Email Cliente':'outsider@example.test'}}
  ];
  global.fetch=async url=>{assert.match(String(url),/tblkQxQ6q7cBKXZ3C/);requests++;return jsonResponse({records});};
  try{
    delete require.cache[require.resolve('../airtable')];const api=require('../airtable');
    const [a,b]=await Promise.all([api.buscarIdentidadeAcesso('12345678000190'),api.buscarIdentidadeAcesso('12345678000190')]);
    assert.equal(requests,1);assert.equal(a.accessPassword,'EX123456');assert.equal(a.id,b.id);assert.deepEqual(a.emails,['a@example.test','b@example.test','c@example.test']);
    assert.equal(await api.buscarIdentidadeAcesso('00000000000000'),null);
    records[1].fields['Sigla Cliente']='BAD';delete require.cache[require.resolve('../airtable')];await assert.rejects(require('../airtable').buscarIdentidadeAcesso('12345678000190'),{code:'ACCESS_DATA_INVALID'});
  }finally{global.fetch=previous;}
});


test('listagem restaura PDF publicado sem exigir novamente aprovacao ou nome do rascunho', async () => {
 const A='recAAAAAAAAAAAAAA';
 const clients=[{id:A,fields:{CNPJ:'12345678000190','ID Cliente':'Teste'}}];
 const pdf={url:'https://dl.airtable.com/publicado.pdf',filename:'publicado.pdf',type:'application/pdf'};
 const works=[{id:'recBBBBBBBBBBBBBB',createdTime:'2026-09-01T12:00:00Z',fields:{Cliente:[A],'Relatórios_Aprovados':[pdf],'Relatórios':[{...pdf,filename:'rascunho.pdf'}],'Aprovação':'Em Andamento'}}];
 const result=await runScenario({clients,works,seedId:A});
 assert.equal(result.trabalhos.length,1);
 assert.equal(result.trabalhos[0].pdf,true);
});

test('download preserva aprovacao e nome do publicado conforme baseline', async () => {
 env(); const previous=global.fetch;
 const pdf={url:'https://dl.airtable.com/publicado.pdf',filename:'publicado.pdf',type:'application/pdf'};
 let fields={'Aprovação':'Aprovado','Relatórios_Aprovados':[pdf],'Relatórios':[pdf]};
 global.fetch=async url=>{assert.match(String(url),/tblJAP4Av9sWm8SmL\/recBBBBBBBBBBBBBB$/);return jsonResponse({id:'recBBBBBBBBBBBBBB',fields});};
 try {
  delete require.cache[require.resolve('../airtable')];const api=require('../airtable');
  assert.equal((await api.urlRelatorioAprovado('recBBBBBBBBBBBBBB')).url,pdf.url);
  fields={...fields,'Aprovação':'Em Andamento'};assert.equal(await api.urlRelatorioAprovado('recBBBBBBBBBBBBBB'),null);
  fields={...fields,'Aprovação':'Aprovado','Relatórios':[{...pdf,filename:'novo.pdf'}]};assert.equal(await api.urlRelatorioAprovado('recBBBBBBBBBBBBBB'),null);
 } finally {global.fetch=previous;}
});

test('historico consulta IDs individuais sem carregar snapshot de todos os clientes', async () => {
 env();const previous=global.fetch;let detailCalls=0;
 global.fetch=async url=>{
  const parsed=new URL(String(url));
  if(parsed.pathname.endsWith('/tblJAP4Av9sWm8SmL/recBBBBBBBBBBBBBB')){detailCalls++;return jsonResponse({id:'recBBBBBBBBBBBBBB',fields:{'ID Trabalho':'TRABALHO HISTORICO'}});}
  if(decodeURIComponent(parsed.pathname).endsWith('/Ordem de Serviço')) return jsonResponse({records:[]});
  throw new Error('Consulta fora do contrato do historico');
 };
 try{
  delete require.cache[require.resolve('../airtable')];const api=require('../airtable');
  const result=await api.detalhesTrabalhosPorIds(['recBBBBBBBBBBBBBB','recBBBBBBBBBBBBBB']);
  assert.equal(detailCalls,1);assert.equal(result.get('recBBBBBBBBBBBBBB').id_trabalho,'TRABALHO HISTORICO');
 }finally{global.fetch=previous;}
});
