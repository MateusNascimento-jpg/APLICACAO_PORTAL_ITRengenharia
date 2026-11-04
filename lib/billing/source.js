'use strict';
const S = require('../financeiro/schema');
const { readPdf } = require('../proposals/pdf');
const { hash, canonical } = require('./protocol');
const { date, email, MAX_PDF } = require('./contract');
const CLIENT_PROPOSALS = 'fldVMUZcwtKKrrpDN';
const CLIENT_EMAIL = 'fldtqo76edbzzQcNz';
const id = value => typeof value === 'string' && /^rec[A-Za-z0-9]{14}$/.test(value);
function links(value) {
    if (!Array.isArray(value) || !value.every(id) || new Set(value).size !== value.length) throw new Error('CHAIN_INVALID');
    return value;
}
function one(value) { const items = links(value); if (items.length !== 1) throw new Error('CHAIN_AMBIGUOUS'); return items[0]; }
function civil(value) {
    if (value == null || value === '') return null;
    if (date(value)) return value;
    if (typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}T00:00:00(?:\.000)?Z$/.test(value) && date(value.slice(0, 10))) return value.slice(0, 10);
    throw new Error('DUE_DATE_INVALID');
}
function cents(value) {
    if (value == null || value === '') return null;
    if (typeof value !== 'number' || value < 0 || !Number.isSafeInteger(Math.round(value * 100)) || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001)
        throw new Error('INSTALLMENT_AMOUNT_INVALID');
    return Math.round(value * 100);
}
function createSource({ airtable, cipher, pdfReader = readPdf }) {
    // Keep only GET capabilities; never call carregarPropostaAtual (cached identity) or PATCH.
    const get = async (table, key) => {
        if (!id(key)) throw new Error('CHAIN_INVALID');
        const r = await airtable.obterRegistro(table, key);
        if (!r || r.id !== key || !r.fields) throw new Error('CHAIN_INVALID');
        return r;
    };
    async function read(invoiceId, repo) {
        const nf = await get(S.TABELAS.NOTAS_FISCAIS, invoiceId), f = nf.fields;
        const contract = await get(S.TABELAS.CONTRATOS, one(f[S.NOTAS_FISCAIS.CONTRATO]));
        const proposal = await get(S.TABELAS.PROPOSTA, one(contract.fields[S.CONTRATOS.PROPOSTA]));
        const client = await get(S.TABELAS.CLIENTES, one(proposal.fields[S.PROPOSTA.CLIENTE]));
        if (one(proposal.fields[S.PROPOSTA.CONTRATOS]) !== contract.id || !links(contract.fields[S.CONTRATOS.PARCELAS]).includes(nf.id) ||
            !links(client.fields[CLIENT_PROPOSALS]).includes(proposal.id)) throw new Error('CHAIN_RECIPROCAL_INVALID');
        const cnpj = String(client.fields[S.CLIENTES.CNPJ] || '').replace(/[.\-/\s]/g, '');
        if (!/^\d{14}$/.test(cnpj)) throw new Error('CNPJ_INVALID');
        const clients = await airtable.listarRegistros(S.TABELAS.CLIENTES, [S.CLIENTES.CNPJ]);
        const matches = clients.filter(c => String(c.fields?.[S.CLIENTES.CNPJ] || '').replace(/[.\-/\s]/g, '') === cnpj);
        if (matches.length !== 1 || matches[0].id !== client.id) throw new Error('CNPJ_AMBIGUOUS');
        const registered = String(client.fields[CLIENT_EMAIL] || '').split(/[;,\n]/).map(e => e.trim().toLowerCase()).filter(email);
        const grants = (await repo.grants(client.id)).sort((a, b) => a.id.localeCompare(b.id));
        const documents = {}, documentErrors = {}, bytes = {};
        for (const [kind, field] of [['boleto', S.NOTAS_FISCAIS.BOLETO], ['nfse', S.NOTAS_FISCAIS.NFSE]]) {
            documents[kind] = null;
            try {
            const attachments = f[field] || [];
            if (!Array.isArray(attachments) || attachments.length > 1) throw new Error('DOCUMENT_AMBIGUOUS');
            if (!attachments.length) { documents[kind] = null; continue; }
            const a = attachments[0];
            if (!/^att[A-Za-z0-9]{14}$/.test(a.id || '') || a.type !== 'application/pdf' || !Number.isInteger(a.size) || a.size < 5 || a.size > MAX_PDF)
                throw new Error('DOCUMENT_METADATA_INVALID');
            const pdf = await pdfReader(a.url);
            if (pdf.bytes.length !== a.size || hash(pdf.bytes) !== pdf.hash) throw new Error('DOCUMENT_INTEGRITY');
            const sha256 = pdf.hash;
            const version = hash(canonical([client.id, proposal.id, contract.id, nf.id, kind, sha256]));
            documents[kind] = { id: a.id, kind, version, sha256, size: pdf.bytes.length };
            bytes[kind] = pdf.bytes;
            } catch (error) {
                if (!/^(DOCUMENT_|PDF_(CONTENT_INVALID|TYPE_INVALID|TOO_LARGE|DESTINATION_DENIED|REDIRECT_LIMIT)$)/.test(error.message))
                    throw new Error('SOURCE_UNAVAILABLE');
                documentErrors[kind] = /^[A-Z0-9_]{1,64}$/.test(error.message) ? error.message : 'DOCUMENT_UNAVAILABLE';
            }
        }
        const snapshot = {
            clientId: client.id, proposalId: proposal.id, contractId: contract.id, invoiceId: nf.id,
            cnpjTag: cipher.tag(cnpj), registered: [...new Set(registered)].sort(), grants,
            proposalStatus: proposal.fields[S.PROPOSTA.STATUS], contractStatus: contract.fields[S.CONTRATOS.STATUS],
            paymentStatus: f[S.NOTAS_FISCAIS.STATUS_PAGAMENTO],
            contractName: contract.fields[S.CONTRATOS.NOME], installment: f[S.NOTAS_FISCAIS.PARCELA],
            amountCents: cents(f[S.NOTAS_FISCAIS.VALOR_PARCELA]), dueDate: civil(f[S.NOTAS_FISCAIS.VENCIMENTO]), documents, documentErrors
        };
        snapshot.stateVersion = hash(canonical(snapshot));
        return { snapshot, bytes, cnpj, createdAt: Date.parse(nf.createdTime) };
    }
    return {
        read,
        async list() {
            const records = await airtable.listarRegistros(S.TABELAS.NOTAS_FISCAIS, [S.NOTAS_FISCAIS.CONTRATO]);
            if (!Array.isArray(records) || records.length > 3000 || records.some(r => !id(r.id)) || new Set(records.map(r => r.id)).size !== records.length)
                throw new Error('SCAN_INVALID');
            return records.map(r => r.id).sort();
        }
    };
}
module.exports = { createSource, civil, cents, CLIENT_PROPOSALS, CLIENT_EMAIL };
