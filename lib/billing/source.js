'use strict';
const S = require('../financeiro/schema');
const { readPdf } = require('../proposals/pdf');
const { hash, canonical } = require('./protocol');
const { date, email, MAX_PDF } = require('./contract');
const CLIENT_PROPOSALS = 'fldVMUZcwtKKrrpDN';
const CLIENT_EMAIL = 'fldtqo76edbzzQcNz';
// Every field the snapshot reads. A listing carries only what is requested here.
const CATALOG_FIELDS = Object.freeze({
    [S.TABELAS.NOTAS_FISCAIS]: [S.NOTAS_FISCAIS.CONTRATO, S.NOTAS_FISCAIS.PARCELA, S.NOTAS_FISCAIS.VALOR_PARCELA, S.NOTAS_FISCAIS.VENCIMENTO,
        S.NOTAS_FISCAIS.STATUS_PAGAMENTO, S.NOTAS_FISCAIS.BOLETO, S.NOTAS_FISCAIS.NFSE],
    [S.TABELAS.CONTRATOS]: [S.CONTRATOS.PROPOSTA, S.CONTRATOS.PARCELAS, S.CONTRATOS.STATUS, S.CONTRATOS.NOME],
    [S.TABELAS.PROPOSTA]: [S.PROPOSTA.CLIENTE, S.PROPOSTA.CONTRATOS, S.PROPOSTA.STATUS],
    [S.TABELAS.CLIENTES]: [S.CLIENTES.CNPJ, CLIENT_EMAIL, CLIENT_PROPOSALS]
});
const id = value => typeof value === 'string' && /^rec[A-Za-z0-9]{14}$/.test(value);
const digits = value => String(value || '').replace(/[.\-/\s]/g, '');
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
    const freshRecord = async (table, key) => {
        if (!id(key)) throw new Error('CHAIN_INVALID');
        const r = await airtable.obterRegistro(table, key);
        if (!r || r.id !== key || !r.fields) throw new Error('CHAIN_INVALID');
        return r;
    };
    const listedClients = records => records.map(c => ({ id: c.id, cnpj: digits(c.fields?.[S.CLIENTES.CNPJ]) }));
    async function resolveChain(invoiceId, get, clients) {
        const nf = await get(S.TABELAS.NOTAS_FISCAIS, invoiceId), f = nf.fields;
        const contract = await get(S.TABELAS.CONTRATOS, one(f[S.NOTAS_FISCAIS.CONTRATO]));
        const proposal = await get(S.TABELAS.PROPOSTA, one(contract.fields[S.CONTRATOS.PROPOSTA]));
        const client = await get(S.TABELAS.CLIENTES, one(proposal.fields[S.PROPOSTA.CLIENTE]));
        if (one(proposal.fields[S.PROPOSTA.CONTRATOS]) !== contract.id || !links(contract.fields[S.CONTRATOS.PARCELAS]).includes(nf.id) ||
            !links(client.fields[CLIENT_PROPOSALS]).includes(proposal.id)) throw new Error('CHAIN_RECIPROCAL_INVALID');
        const cnpj = digits(client.fields[S.CLIENTES.CNPJ]);
        if (!/^\d{14}$/.test(cnpj)) throw new Error('CNPJ_INVALID');
        const matches = (await clients()).filter(c => c.cnpj === cnpj);
        if (matches.length !== 1 || matches[0].id !== client.id) throw new Error('CNPJ_AMBIGUOUS');
        return { nf, contract, proposal, client, cnpj };
    }
    const freshClients = async () => listedClients(await airtable.listarRegistros(S.TABELAS.CLIENTES, [S.CLIENTES.CNPJ]));
    // A catalog holds one scan only and is never used by an authorization. Its tables are read
    // one after another, so a chain failure on a known invoice is confirmed with fresh reads
    // before it can cancel anything.
    async function chainFor(invoiceId, catalog, previous) {
        if (!catalog) return resolveChain(invoiceId, freshRecord, freshClients);
        const listed = async (table, key) => {
            const r = id(key) ? catalog.records[table].get(key) : null;
            if (!r || !r.fields) throw new Error('CHAIN_INVALID');
            return r;
        };
        try { return await resolveChain(invoiceId, listed, async () => catalog.clients); }
        catch (error) {
            if (!previous) throw error;
            return resolveChain(invoiceId, freshRecord, async () => catalog.clients);
        }
    }
    // freshKind: the document this authorization will attest, always downloaded. Any other PDF
    // reuses the digest persisted for the same immutable attachment and size.
    async function read(invoiceId, repo, { catalog = null, freshKind = null } = {}) {
        const previous = await repo.state(invoiceId);
        const { nf, contract, proposal, client, cnpj } = await chainFor(invoiceId, catalog, previous);
        const f = nf.fields;
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
                const known = previous?.snapshot?.documents?.[kind];
                let sha256, size;
                if (kind !== freshKind && known && known.id === a.id && known.size === a.size) ({ sha256, size } = known);
                else {
                    const pdf = await pdfReader(a.url);
                    if (pdf.bytes.length !== a.size || hash(pdf.bytes) !== pdf.hash) throw new Error('DOCUMENT_INTEGRITY');
                    sha256 = pdf.hash; size = pdf.bytes.length; bytes[kind] = pdf.bytes;
                }
                const version = hash(canonical([client.id, proposal.id, contract.id, nf.id, kind, sha256]));
                documents[kind] = { id: a.id, kind, version, sha256, size };
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
        // Listing helpers fail as a whole: any page error aborts the scan before it acts.
        async catalog() {
            const records = {};
            for (const [table, fields] of Object.entries(CATALOG_FIELDS)) {
                const listed = await airtable.listarRegistros(table, fields);
                if (!Array.isArray(listed) || listed.some(r => !id(r.id)) || new Set(listed.map(r => r.id)).size !== listed.length) throw new Error('SCAN_INVALID');
                records[table] = listed;
            }
            const invoices = records[S.TABELAS.NOTAS_FISCAIS];
            if (invoices.length > 3000) throw new Error('SCAN_INVALID');
            return {
                ids: invoices.map(r => r.id).sort(),
                records: Object.fromEntries(Object.entries(records).map(([table, listed]) => [table, new Map(listed.map(r => [r.id, r]))])),
                clients: listedClients(records[S.TABELAS.CLIENTES])
            };
        }
    };
}
module.exports = { createSource, civil, cents, CLIENT_PROPOSALS, CLIENT_EMAIL, CATALOG_FIELDS };
