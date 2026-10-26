'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createService, TTL } = require('../lib/proposals/service');
const { createSecrets } = require('../lib/proposals/crypto');
const { memoryStore } = require('./helpers/proposals-memory');
const { createAuthorizedContacts, commercialRecipients } = require('../lib/proposals/authorized-contacts');

function fixture() {
    let time = Date.parse('2026-10-23T10:00:00Z');
    const store = memoryStore();
    const secrets = createSecrets(Buffer.alloc(32, 7).toString('base64'));
    const proposal = {
        id:'recAAAAAAAAAAAAAA', cnpj:'12345678000199', clienteId:'recBBBBBBBBBBBBBB',
        numero:'03', status:'Enviada', nomeCliente:'Empresa teste', valor:1200,
        formaPagamento:'Entrada + Parcela Final', prazoPagamentoDias:10, createdTime: new Date(time).toISOString(),
        emails:['financeiro@example.test','permitido@example.test'],
        anexos:[{id:'att12345678901234', url:'https://v5.airtableusercontent.com/test.pdf', filename:'proposta.pdf'}],
    };
    const authorized = proposal.emails;
    let writes=0;
    const airtable = {
        async carregarPropostaAtual(id,cnpj) {
            if(id!==proposal.id||(cnpj && cnpj!==proposal.cnpj)) throw new Error('PROPOSAL_NOT_FOUND');
            return structuredClone(proposal);
        },
        async atualizarDecisao(id,status) {writes++; proposal.status=status;},
    };
    const deps = { store, secrets, airtable,
        authorizedContacts: createAuthorizedContacts(),
        origin:'https://portal.example.test',enabled:()=>true,
        pdf:async()=>({hash:secrets.hash('pdf-version'),bytes:Buffer.from('%PDF-stub')}), now:()=>time };
    const service = createService(deps);
    const events=()=>[...store.events.values()].map(e=>secrets.open(e.payload));
    const advance=ms=>{time+=ms};
    return {store, secrets, service, proposal, authorized, advance,events,
        written:()=>writes, deps};
}

test('token exclusivo de aceite: 120 minutos, código somente na fila criptografada',async()=>{
    const f=fixture();
    assert.equal(TTL,120*60*1000);
    const contacts=await f.service.options(f.proposal.cnpj,f.proposal.id);
    assert.equal(contacts.length,2);
    await assert.rejects(f.service.request(f.proposal.cnpj,f.proposal.id,{},'invalido'),/RECIPIENT_INVALID/);
    const result=await f.service.request(f.proposal.cnpj,f.proposal.id,{},contacts[0].key);
    assert.equal(result.code,undefined);
    assert.equal(result.recipientsCount,1);
    const event=f.events().find(e=>e.type==='VERIFY');
    assert.match(event.code,/^\d{8}$/);
    assert.equal(event.recipient,'financeiro@example.test');
    assert.equal(event.expiresAt-result.expiresAt,0);
    assert.equal(result.expiresAt-Date.parse('2026-10-23T10:00:00Z'),120*60*1000);
    assert.ok(!JSON.stringify([...f.store.challenges.values()]).includes(event.code));
    assert.ok(!JSON.stringify([...f.store.events.values()]).includes(event.code));
});

test('validação e consentimento no próprio Portal, sem código na tela de solicitação',async()=>{
    const f=fixture();
    const opt=(await f.service.options(f.proposal.cnpj,f.proposal.id))[0];
    await f.service.request(f.proposal.cnpj,f.proposal.id,{},opt.key);
    const code=f.events().find(e=>e.type==='VERIFY').code;
    await assert.rejects(f.service.validateForClient('99999999000199',f.proposal.id,code),/PROPOSAL_NOT_FOUND|CHALLENGE_INVALID/);
    const proof=await f.service.validateForClient(f.proposal.cnpj,f.proposal.id,code);
    assert.ok(proof.confirmation);
    assert.equal(f.written(),0);
    await assert.rejects(f.service.confirmForClient(f.proposal.cnpj,f.proposal.id,proof.confirmation,false,{}),/CONSENT_REQUIRED/);
    const result=await f.service.confirmForClient(f.proposal.cnpj,f.proposal.id,proof.confirmation,true,{role:'Cliente'});
    assert.equal(result.status,'Aceita');
    assert.ok(await f.store.artifact(f.proposal.id));
    assert.equal(f.events().filter(e=>e.type==='ACCEPTED').length,2);
    assert.equal(f.written(),1);
    await assert.rejects(f.service.validateForClient(f.proposal.cnpj,f.proposal.id,code),/DECISION_EXISTS/);
});

test('expiração, cinco tentativas e revogação operam no backend',async()=>{
    const f=fixture();
    const opt=(await f.service.options(f.proposal.cnpj,f.proposal.id))[0];
    await f.service.request(f.proposal.cnpj,f.proposal.id,{},opt.key);
    const code=f.events().find(e=>e.type==='VERIFY').code;
    for(let i=0;i<5;i++) await assert.rejects(f.service.validateForClient(f.proposal.cnpj,f.proposal.id,'0000000x'),/CODE_INVALID/);
    await assert.rejects(f.service.validateForClient(f.proposal.cnpj,f.proposal.id,code),/CHALLENGE_INVALID/);
    const g=fixture(); const k=(await g.service.options(g.proposal.cnpj,g.proposal.id))[0];
    await g.service.request(g.proposal.cnpj,g.proposal.id,{},k.key);
    g.advance(2*3600000);
    await assert.rejects(g.service.validateForClient(g.proposal.cnpj,g.proposal.id,g.events()[0].code),/CHALLENGE_INVALID/);
    const h=fixture();const o=(await h.service.options(h.proposal.cnpj,h.proposal.id))[0];
    await h.service.request(h.proposal.cnpj,h.proposal.id,{},o.key);
    h.authorized.length=0;
    await assert.rejects(h.service.validateForClient(h.proposal.cnpj,h.proposal.id,h.events()[0].code),/RECIPIENT_MISSING|RECIPIENT_INVALID/);
});

test('elegibilidade usa contatos comerciais da proposta, sem tabela auxiliar',async()=>{
    const p={id:'recAAAAAAAAAAAAAA', clienteId:'recBBBBBBBBBBBBBB',
        cnpj:'12.345.678/0001-99', emails:['a@example.test','B@example.test','a@example.test','invalido']};
    assert.deepEqual(commercialRecipients(p),['a@example.test','b@example.test']);
    assert.deepEqual(await createAuthorizedContacts().forProposal(p),['a@example.test','b@example.test']);
    assert.deepEqual(commercialRecipients({...p,clienteId:'outra-empresa'}),[]);
    assert.deepEqual(commercialRecipients({...p,cnpj:'invalido'}),[]);
    assert.deepEqual(commercialRecipients({...p,emails:[]}),[]);
});
