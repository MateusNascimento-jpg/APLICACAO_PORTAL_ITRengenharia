'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {generate}=require('../lib/proposals/comprovante');
const {createInvoiceNotifications}=require('../lib/invoices/notifications');
const {createSecrets}=require('../lib/proposals/crypto');
const {memoryStore}=require('./helpers/proposals-memory');
const S=require('../lib/financeiro/schema');

const ID={proposal:'recAAAAAAAAAAAAAA',client:'recBBBBBBBBBBBBBB',contract:'recCCCCCCCCCCCCCC',invoice:'recDDDDDDDDDDDDDD',file:'attEEEEEEEEEEEEEE'};
const hash=crypto.createHash('sha256').update('PDF de origem').digest('hex');
const evidence={proposal:{id:ID.proposal,cnpj:'12345678000199',numero:'03',nomeCliente:'Empresa Exemplo',valor:2300,
    emailContato:'contato@example.test',formaPagamento:'Entrada e parcela final',prazoPagamentoDias:10},version:'f'.repeat(64),pdfHash:hash,
    attachmentId:ID.file,acceptedAt:Date.parse('2026-10-23T11:00:00Z'),origin:'https://portal.example.test/'};

test('comprovante é PDF A4 independente, com link autenticado para proposta e dados da ITR',()=>{
    const {bytes,hash:proofHash}=generate(evidence);
    assert.ok(bytes.toString('binary').startsWith('%PDF-1.4'));
    assert.match(bytes.toString('binary'),/Comprovante de contrato comercial/);
    assert.match(bytes.toString('binary'),/Documentos Integrais/);
    assert.match(bytes.toString('binary'),/\/Subtype \/Link/);
    assert.match(bytes.toString('binary'),/\/api\/propostas\/recAAAAAAAAAAAAAA\/proposta-aceita/);
    assert.match(bytes.toString('binary'),/Vin.cius S\. Levay/);
    assert.match(proofHash,/^[a-f0-9]{64}$/);
});

function fixture(createdTime='2026-10-01T10:00:00Z'){
    const store=memoryStore(),secrets=createSecrets(Buffer.alloc(32,9).toString('base64'));
    const pdfBuffer=Buffer.from('%PDF-1.4\nT\n%%EOF');
    const proposal={id:ID.proposal,cnpj:evidence.proposal.cnpj,clienteId:ID.client,emails:['contato@example.test'],anexos:[{id:ID.file,url:'https://dl.airtable.com/proposta.pdf'}],status:'Aceita'};
    const contract={id:ID.contract,fields:{[S.CONTRATOS.PROPOSTA]:[ID.proposal],[S.CONTRATOS.PARCELAS]:[ID.invoice],[S.CONTRATOS.NOME]:'C03'}};
    const pRecord={id:ID.proposal,fields:{[S.PROPOSTA.CONTRATOS]:[ID.contract]}};
    const invoice={id:ID.invoice,createdTime,fields:{
        [S.NOTAS_FISCAIS.CONTRATO]:[ID.contract],
        [S.NOTAS_FISCAIS.STATUS_PAGAMENTO]:'Aguardando Emissão da NF',
        [S.NOTAS_FISCAIS.PARCELA]:'Parcela 1',
        [S.NOTAS_FISCAIS.NFSE]:[{id:ID.file,type:'application/pdf',url:'https://dl.airtable.com/nfse.pdf',filename:'nota.pdf'}],
        [S.NOTAS_FISCAIS.VENCIMENTO]:'2026-11-20'
    }};
    const airtable={
        async listarRegistros(table){assert.equal(table,S.TABELAS.NOTAS_FISCAIS);return [invoice];},
        async obterRegistro(table,id){return table===S.TABELAS.CONTRATOS?contract:table===S.TABELAS.PROPOSTA?pRecord:invoice;},
        async carregarPropostaAtual(){return proposal;},
        async buscarClienteFinanceiroPorCnpj(){return {id:ID.client};},
    };
    const service={async snapshot(){return {version:evidence.version,pdfHash:hash,filename:'Proposta.pdf',attachmentId:ID.file,proposal:evidence.proposal};}};
    const notifier=createInvoiceNotifications({store,airtable,service,secrets,enabled:()=>true,
        pdfReader:async()=>({bytes:pdfBuffer,hash:crypto.createHash('sha256').update(pdfBuffer).digest('hex')})});
    return {notifier,store,invoice,secrets,proposal};
}

test('NF histórica cria baseline e não dispara mensagem retroativa', async()=>{
    const {notifier,store}=fixture();
    await notifier.scan({cutoff:Date.parse('2026-10-23T00:00:00Z')});
    assert.equal(store.events.size,0);
});

test('status A Vencer com NF dispara uma vez; mesma versão não repete', async()=>{
    const {notifier,store,invoice,secrets}=fixture();
    const cutoff=Date.parse('2026-10-23T00:00:00Z');
    await notifier.scan({cutoff});
    invoice.fields[S.NOTAS_FISCAIS.STATUS_PAGAMENTO]='A Vencer';
    await notifier.scan({cutoff});
    assert.equal(store.events.size,1);
    const event=secrets.open([...store.events.values()][0].payload);
    assert.equal(event.type,'INVOICE');
    assert.equal(event.invoice.contractName,'C03');
    await notifier.checkEvent(event);
    await notifier.scan({cutoff});
    assert.equal(store.events.size,1);
    invoice.fields[S.NOTAS_FISCAIS.STATUS_PAGAMENTO]='Pago';
    await assert.rejects(notifier.checkEvent(event),/EVENT_OBSOLETE/);
});

test('NF anterior ao cutoff já em A Vencer não recebe disparo retroativo',async()=>{
    const {notifier,store,invoice}=fixture();
    invoice.fields[S.NOTAS_FISCAIS.STATUS_PAGAMENTO]='A Vencer';
    await notifier.scan({cutoff:Date.parse('2026-10-23T00:00:00Z')});
    assert.equal(store.events.size,0);
});
