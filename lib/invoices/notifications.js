'use strict';

// Autorização financeira: NF -> Contrato -> Proposta -> Cliente único.
// O Portal mantém a origem dos documentos; o serviço SMTP não recebe URLs Airtable.
const S = require('../financeiro/schema');
const { readPdf } = require('../proposals/pdf');
const { documento, emails } = require('../portal-access');
const crypto = require('node:crypto');

const fields = [S.NOTAS_FISCAIS.CONTRATO, S.NOTAS_FISCAIS.STATUS_PAGAMENTO,
    S.NOTAS_FISCAIS.PARCELA, S.NOTAS_FISCAIS.NFSE, S.NOTAS_FISCAIS.BOLETO,
    S.NOTAS_FISCAIS.VENCIMENTO];
const validId = (v,prefix='rec')=>new RegExp('^'+prefix+'[A-Za-z0-9]{14}$').test(String(v||''));
const links = v=>Array.isArray(v) ? v.map(x=>typeof x==='string'?x:x?.id).filter(x=>validId(x)):[];
const choice = v=>typeof v==='object'&&v?String(v.name||''):String(v||'');
const digest = v=>crypto.createHash('sha256').update(v).digest('hex');

function createInvoiceNotifications({store, airtable, service, secrets, enabled = () => process.env.PORTAL_NF_NOTIFICACOES_ATIVAS === 'true', pdfReader = readPdf}) {
    async function verifyChain(nf, {requireStatus=true}={}) {
        const f=nf.fields||{};
        if(requireStatus && choice(f[S.NOTAS_FISCAIS.STATUS_PAGAMENTO])!==S.STATUS_FATURA.A_VENCER)
            throw new Error('INVOICE_STATUS_CHANGED');
        const contracts=links(f[S.NOTAS_FISCAIS.CONTRATO]);
        if(contracts.length!==1)throw new Error('INVOICE_LINK_INVALID');
        const contract=await airtable.obterRegistro(S.TABELAS.CONTRATOS,contracts[0]);
        if(!contract || contract.id!==contracts[0] ||
            links(contract.fields?.[S.CONTRATOS.PROPOSTA]).length!==1)
            throw new Error('INVOICE_LINK_INVALID');
        const proposalId=links(contract.fields?.[S.CONTRATOS.PROPOSTA])[0];
        const proposal=await airtable.carregarPropostaAtual(proposalId);
        const owner=await airtable.buscarClienteFinanceiroPorCnpj(proposal.cnpj);
        if(!owner || owner.id!==proposal.clienteId) throw new Error('INVOICE_CLIENT_AMBIGUOUS');
        if(choice(contract.fields?.[S.CONTRATOS.STATUS])===S.STATUS_CONTRATO.CANCELADO)
            throw new Error('INVOICE_CANCELLED_CONTRACT');
        if(proposal.status!=='Aceita'||!documento(proposal.cnpj))throw new Error('INVOICE_PROPOSAL_INVALID');
        const linked=await airtable.obterRegistro(S.TABELAS.PROPOSTA,proposalId);
        if(links(linked?.fields?.[S.PROPOSTA.CONTRATOS]).length!==1 ||
            links(linked.fields[S.PROPOSTA.CONTRATOS])[0]!==contract.id)
            throw new Error('INVOICE_RELATION_MISMATCH');
        const linkedFaturas=links(contract.fields?.[S.CONTRATOS.PARCELAS]);
        if(!linkedFaturas.includes(nf.id))throw new Error('INVOICE_RELATION_MISMATCH');
        return {proposal,contract,invoice:nf};
    }
    function docs(nf) {
        const f=nf.fields||{};
        const entries=[];
        for(const [tipo,campo] of [['nfse',S.NOTAS_FISCAIS.NFSE],['boleto',S.NOTAS_FISCAIS.BOLETO]]) {
            const items=Array.isArray(f[campo])?f[campo]:[];
            for(const a of items) {
                if (!validId(a.id,'att') || a.type!=='application/pdf' || typeof a.url!=='string') continue;
                entries.push({id:a.id,tipo,url:a.url,name:String(a.filename||tipo+'.pdf').slice(0,160)});
            }
        }
        const nfCount=entries.filter(x=>x.tipo==='nfse').length;
        if (nfCount===0 || entries.length>3) throw new Error('INVOICE_DOCS_INVALID');
        return entries;
    }
    function fingerprint(nf) {
        const entries=docs(nf);
        const v=nf.fields || {};
        return secrets.hash(JSON.stringify({status:choice(v[S.NOTAS_FISCAIS.STATUS_PAGAMENTO]),
            id:nf.id, attachments:entries.map(a=>[a.id,a.name]),
            due:v[S.NOTAS_FISCAIS.VENCIMENTO]||null}));
    }
    async function queue(nf, previous, cutoff) {
        if(!validId(nf.id))return;
        const status=choice(nf.fields?.[S.NOTAS_FISCAIS.STATUS_PAGAMENTO]);
        const eligible=status===S.STATUS_FATURA.A_VENCER;
        const sameVersion=(()=>{try{return fingerprint(nf);}catch(_){return null;}})();
        const isNew=Date.parse(nf.createdTime)>=cutoff;
        return store.withLock('nf:'+nf.id,async repo=>{
            const state=await repo.invoiceState(nf.id);
            if (!state) {
                // Registros antigos servem como baseline: não disparam retroativos.
                await repo.saveInvoiceState(nf.id,{status,observed:sameVersion,notified:null,baselineAt:Date.now()});
                if(!isNew)return;
            }
            const current=state||{status:null,observed:null,notified:null};
            if(!eligible || !sameVersion || current.notified===sameVersion ||
                (current.status===status && current.observed===sameVersion)) {
                await repo.saveInvoiceState(nf.id,{...current,status,observed:sameVersion});
                return;
            }
            const {proposal,contract}=await verifyChain(nf);
            if(!Array.isArray(proposal.emails) || proposal.emails.length===0)return;
            const attachments=[];
            for(const att of docs(nf)) {
                const pdf=await pdfReader(att.url);
                attachments.push({id:att.id,tipo:att.tipo,filename:att.name,sha256:pdf.hash});
            }
            const snap=await service.snapshot(proposal);
            const invoice={ id:nf.id,contractId:contract.id,
                contractName:String(contract.fields?.[S.CONTRATOS.NOME]||'Contrato').slice(0,100),
                parcela:String(nf.fields?.[S.NOTAS_FISCAIS.PARCELA]||'').slice(0,140),
                vencimento:String(nf.fields?.[S.NOTAS_FISCAIS.VENCIMENTO]||'').slice(0,20),
                documentVersion:sameVersion,attachments};
            await repo.transaction(async()=>{
                for(const recipient of emails(proposal.emails.join(','))) {
                    const id=secrets.hash(JSON.stringify(['INVOICE',nf.id,sameVersion,recipient]));
                    await repo.enqueue({id,proposalId:proposal.id,priority:2,
                        payload:secrets.seal({eventId:id,type:'INVOICE',recipient,snapshot:snap,invoice})});
                }
                await repo.saveInvoiceState(nf.id,{status,observed:sameVersion,notified:sameVersion,queuedAt:Date.now()});
            });
        });
    }
    async function scan(settings) {
        if(!enabled())return;
        const records=await airtable.listarRegistros(S.TABELAS.NOTAS_FISCAIS,fields);
        if (records.length>3000) throw new Error('INVOICE_SCAN_LIMIT');
        for(const record of records){
            try { await queue(record, null, settings.cutoff); }
            catch(_) { /* Registro inconsistente é ignorado e diagnosticado sem PII. */ }
        }
    }
    async function checkEvent(payload) {
        if(payload?.type!=='INVOICE'||!validId(payload.invoice?.id)||!validId(payload.invoice?.contractId)||
            !/^[a-f0-9]{64}$/.test(payload.invoice?.documentVersion||''))throw new Error('INVOICE_EVENT_INVALID');
        const nf=await airtable.obterRegistro(S.TABELAS.NOTAS_FISCAIS,payload.invoice.id);
        if(!nf || fingerprint(nf)!==payload.invoice.documentVersion)
            throw new Error('EVENT_OBSOLETE');
        const {proposal,contract}=await verifyChain(nf);
        if(proposal.id!==payload.snapshot.proposal.id||contract.id!==payload.invoice.contractId||
            proposal.cnpj!==payload.snapshot.proposal.cnpj||
            !proposal.emails.includes(payload.recipient))throw new Error('EVENT_OBSOLETE');
        if((await service.snapshot(proposal)).version!==payload.snapshot.version)throw new Error('EVENT_OBSOLETE');
        const current=docs(nf);
        if(current.length!==payload.invoice.attachments.length||current.some(a=>
            !payload.invoice.attachments.some(b=>b.id===a.id && b.tipo===a.tipo)))throw new Error('EVENT_OBSOLETE');
        return {proposal,invoice:nf,attachments:current};
    }
    return {scan,checkEvent,docs,fingerprint,verifyChain};
}
module.exports={createInvoiceNotifications};
