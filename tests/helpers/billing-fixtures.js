'use strict';
const S = require('../../lib/financeiro/schema');
const { createSource, CLIENT_EMAIL, CLIENT_PROPOSALS } = require('../../lib/billing/source');
const { createService } = require('../../lib/billing/service');
const { hash } = require('../../lib/billing/protocol');
const { memoryStore } = require('./billing-memory');
const ids = { client: 'recAAAAAAAAAAAAAA', proposal: 'recBBBBBBBBBBBBBB', contract: 'recCCCCCCCCCCCCCC', invoice: 'recDDDDDDDDDDDDDD', boleto: 'attEEEEEEEEEEEEEE', nfse: 'attFFFFFFFFFFFFFF' };
function fixture() {
    let now = Date.parse('2026-11-04T12:00:00Z'), failure = false;
    const store = memoryStore(), clock = () => now;
    const pdfs = { boleto: Buffer.from('%PDF-1.4\nBoleto ficticio\n%%EOF'), nfse: Buffer.from('%PDF-1.4\nNFSe ficticia\n%%EOF') };
    const client = { id: ids.client, fields: { [S.CLIENTES.CNPJ]: '12345678000195', [CLIENT_EMAIL]: 'financeiro@example.test', [CLIENT_PROPOSALS]: [ids.proposal] } };
    const proposal = { id: ids.proposal, fields: { [S.PROPOSTA.CLIENTE]: [ids.client], [S.PROPOSTA.CONTRATOS]: [ids.contract], [S.PROPOSTA.STATUS]: 'Aceita', [S.PROPOSTA.VALOR]: 999999 } };
    const contract = { id: ids.contract, fields: { [S.CONTRATOS.PROPOSTA]: [ids.proposal], [S.CONTRATOS.PARCELAS]: [ids.invoice], [S.CONTRATOS.STATUS]: 'Ativo', [S.CONTRATOS.NOME]: 'C-TESTE' } };
    const invoice = { id: ids.invoice, createdTime: '2020-01-01T00:00:00Z', fields: {
        [S.NOTAS_FISCAIS.CONTRATO]: [ids.contract], [S.NOTAS_FISCAIS.PARCELA]: 'Parcela Única',
        [S.NOTAS_FISCAIS.VALOR_PARCELA]: 1500.50, [S.NOTAS_FISCAIS.VENCIMENTO]: '2026-11-06',
        [S.NOTAS_FISCAIS.STATUS_PAGAMENTO]: 'Aguardando Emissão da NF'
    } };
    const tables = { [S.TABELAS.CLIENTES]: [client], [S.TABELAS.PROPOSTA]: [proposal], [S.TABELAS.CONTRATOS]: [contract], [S.TABELAS.NOTAS_FISCAIS]: [invoice] };
    const airtable = {
        async obterRegistro(table, id) { if (failure) throw new Error('network offline'); return structuredClone(tables[table].find(r => r.id === id)); },
        async listarRegistros(table) { if (failure) throw new Error('network offline'); return structuredClone(tables[table]); }
    };
    const source = createSource({ airtable, cipher: store.cipher, pdfReader: async url => {
        const kind = url.includes('nfse') ? 'nfse' : 'boleto', bytes = pdfs[kind];
        return { bytes, hash: hash(bytes) };
    } });
    const service = createService({ store, source, clock, pilotClients: [ids.client] });
    function attach(kind) {
        invoice.fields[S.NOTAS_FISCAIS[kind.toUpperCase()]] = [{ id: ids[kind], type: 'application/pdf', size: pdfs[kind].length, url: 'https://v5.airtableusercontent.com/' + kind }];
    }
    return { store, source, service, clock, ids, tables, invoice, proposal, contract, client, pdfs, attach, airtable,
        setNow: v => { now = typeof v === 'number' ? v : Date.parse(v); }, fail: v => { failure = v; },
        // Records what is queued as delivered, with a receipt, so later days are plain reminder days.
        async sent() {
            for (const e of store.data.events.values()) if (['pending', 'retry'].includes(e.status)) {
                await store.repo.saveEvent({ ...structuredClone(e), status: 'sent', attempts: 1, receipt: { code: 'SENT', eventId: e.payload.eventId, at: now } });
            }
        },
        events: () => [...store.data.events.values()], async ready(kind = 'boleto') { await service.scan(); attach(kind); await service.scan(); return this.events()[0]; }
    };
}
module.exports = { fixture, ids, S };
