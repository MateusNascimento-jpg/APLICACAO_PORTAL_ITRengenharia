'use strict';
// Modo geral: libera clientes novos depois de um marco durável, sem mensagens antigas. Sem rede.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, S } = require('./helpers/billing-fixtures');
const { createService } = require('../lib/billing/service');
const { createWorker } = require('../lib/billing/worker');
const { configuration } = require('../lib/billing/config');
const { CLIENT_EMAIL, CLIENT_PROPOSALS } = require('../lib/billing/source');
const N = S.NOTAS_FISCAIS;
const cfg = { enabled: true, worker: true, origin: 'https://notifications.example.test', secret: Buffer.alloc(32, 3).toString('base64') };
const key = n => Buffer.alloc(32, n).toString('base64');
const env = extra => ({ PORTAL_BILLING_ENABLED: 'true', BILLING_HMAC_SECRET: key(1), PORTAL_BILLING_STORAGE_KEY: key(2), PORTAL_BILLING_NOTIFICATIONS_ORIGIN: 'https://n.example.test', ...extra });
const service = (f, mode, pilotClients = []) => createService({ store: f.store, source: f.source, clock: f.clock, mode, pilotClients });
const general = (f, list) => service(f, 'general', list), pilotOnly = (f, list) => service(f, 'pilot', list);
const of = (f, type) => f.events().filter(e => e.payload.type === type);
const stored = (f, e) => f.store.data.events.get(e.payload.eventId);
const audits = (f, code) => f.store.data.audit.filter(a => a.code === code);
const tick = (f, ms = 60000) => f.setNow(f.clock() + ms);
const state = f => f.store.data.states.get(f.ids.invoice);
const pdf = (f, kind, id) => [{ id, type: 'application/pdf', size: f.pdfs[kind].length, url: 'https://v5.airtableusercontent.com/' + kind }];
const iso = ms => new Date(ms).toISOString();
const NEW_BOLETO = 'attHHHHHHHHHHHHHH', NEW_NFSE = 'attIIIIIIIIIIIIII';
// Baseline concluído em produção, sem ninguém liberado.
async function baselined() { const f = fixture(); await pilotOnly(f, []).scan(); tick(f); return f; }
// A primeira varredura em modo geral grava o marco.
async function activated(f, list) { const s = general(f, list); assert.equal((await s.scan()).general, 'activated'); tick(f); return s; }
// Um cadastro completo, como a equipe financeira faria: cliente, proposta, contrato e parcela.
function register(f, createdTime = iso(f.clock())) {
    const ids = { client: 'recKKKKKKKKKKKKKK', proposal: 'recLLLLLLLLLLLLLL', contract: 'recMMMMMMMMMMMMMM', invoice: 'recOOOOOOOOOOOOOO' };
    const client = { id: ids.client, fields: { [S.CLIENTES.CNPJ]: '98765432000110', [CLIENT_EMAIL]: 'financeiro@novo.example.test', [CLIENT_PROPOSALS]: [ids.proposal] } };
    const proposal = { id: ids.proposal, fields: { [S.PROPOSTA.CLIENTE]: [ids.client], [S.PROPOSTA.CONTRATOS]: [ids.contract], [S.PROPOSTA.STATUS]: 'Aceita' } };
    const contract = { id: ids.contract, fields: { [S.CONTRATOS.PROPOSTA]: [ids.proposal], [S.CONTRATOS.PARCELAS]: [ids.invoice], [S.CONTRATOS.STATUS]: 'Ativo', [S.CONTRATOS.NOME]: 'C-NOVO' } };
    const invoice = { id: ids.invoice, createdTime, fields: { [N.CONTRATO]: [ids.contract], [N.PARCELA]: 'Parcela Única', [N.VALOR_PARCELA]: 900, [N.VENCIMENTO]: '2026-11-20', [N.STATUS_PAGAMENTO]: 'A Vencer' } };
    f.tables[S.TABELAS.CLIENTES].push(client); f.tables[S.TABELAS.PROPOSTA].push(proposal); f.tables[S.TABELAS.CONTRATOS].push(contract); f.tables[S.TABELAS.NOTAS_FISCAIS].push(invoice);
    return { ids, client, proposal, contract, invoice };
}

// Configuração.
test('the mode defaults to pilot, and only exact values are accepted', () => {
    assert.equal(configuration(env({})).mode, 'pilot');
    assert.equal(configuration(env({ PORTAL_BILLING_MODE: '' })).mode, 'pilot');
    assert.equal(configuration(env({ PORTAL_BILLING_MODE: 'pilot' })).mode, 'pilot');
    assert.equal(configuration(env({ PORTAL_BILLING_MODE: 'general' })).mode, 'general');
    for (const bad of ['geral', 'GENERAL', 'General', ' general', 'general ', 'all', 'true', '*'])
        assert.throws(() => configuration(env({ PORTAL_BILLING_MODE: bad })), /BILLING_MODE_INVALID/, bad);
});
test('disabled stays disabled, whatever the mode says', () => {
    assert.deepEqual(configuration({ PORTAL_BILLING_MODE: 'general' }), { enabled: false, worker: false });
});
test('the general mode needs no client list, and a list present is still validated', () => {
    assert.deepEqual(configuration(env({ PORTAL_BILLING_MODE: 'general' })).pilotClients, []);
    assert.throws(() => configuration(env({ PORTAL_BILLING_MODE: 'general', PORTAL_BILLING_PILOT_CLIENTS: '*' })), /BILLING_PILOT_INVALID/);
});
test('the pilot mode is unchanged: an empty list blocks everybody, even with a mark left behind', async () => {
    const f = await baselined(); await activated(f); const s = pilotOnly(f, []); await s.scan();
    f.attach('boleto'); await s.scan();
    assert.equal(f.events().length, 0);
});

// Marco durável.
test('the first general scan only records the mark, and nothing goes out', async () => {
    const f = await baselined(), s = general(f), at = f.clock();
    assert.equal(f.store.data.general, null);
    assert.equal((await s.scan()).general, 'activated');
    assert.equal(f.store.data.general.activatedAt, at); assert.equal(f.events().length, 0);
    assert.equal(audits(f, 'GENERAL_MODE_ACTIVATED').length, 1);
});
test('the baseline is preserved as it was', async () => {
    const f = await baselined(), before = structuredClone(f.store.data.meta);
    await activated(f); await general(f).scan();
    assert.deepEqual(f.store.data.meta, before); assert.equal(audits(f, 'BASELINE_COMPLETE').length, 1);
});
test('without a baseline, the baseline comes first and the mark after it', async () => {
    const f = fixture(), s = general(f);
    assert.equal((await s.scan()).baseline, true); assert.equal(f.store.data.general, null);
    tick(f); assert.equal((await s.scan()).general, 'activated');
});
test('the mark survives a restart and is not taken again', async () => {
    const f = await baselined(); await activated(f); const mark = structuredClone(f.store.data.general);
    tick(f, 3600000); await general(f).scan(); await general(f).scan();
    assert.deepEqual(f.store.data.general, mark); assert.equal(audits(f, 'GENERAL_MODE_ACTIVATED').length, 1);
});
test('a commit failure leaves no mark, and the next scan activates', async () => {
    const f = await baselined(), s = general(f);
    f.store.failCommit(true); await assert.rejects(s.scan()); f.store.failCommit(false);
    assert.equal(f.store.data.general, null);
    assert.equal((await s.scan()).general, 'activated');
});
test('an interrupted pass leaves no mark', async () => {
    const f = await baselined();
    assert.equal((await general(f).scan({ shouldStop: () => true })).stopped, true);
    assert.equal(f.store.data.general, null);
});
test('a source failure in the pass leaves no mark, and what it missed stays silent', async () => {
    const f = await baselined(), s = general(f); f.attach('boleto');
    const read = f.source.read; let down = true;
    f.source.read = async (...a) => { if (down) throw new Error('SOURCE_UNAVAILABLE'); return read(...a); };
    assert.equal((await s.scan()).general, 'incomplete'); assert.equal(f.store.data.general, null);
    assert.equal(audits(f, 'GENERAL_ACTIVATION_INCOMPLETE').length, 1);
    down = false; assert.equal((await s.scan()).general, 'activated'); tick(f); await s.scan();
    assert.equal(f.events().length, 0);
});

// Nada antigo sai na ativação.
test('activation over existing boletos and NFSe sends nothing, on any later day', async () => {
    const f = fixture(); f.attach('boleto'); f.attach('nfse'); await pilotOnly(f, []).scan(); tick(f);
    const s = await activated(f);
    for (const day of ['05', '06', '11', '16', '21', '26']) { f.setNow(`2026-11-${day}T12:00:00Z`); await s.scan(); }
    assert.equal(f.events().length, 0);
});
test('a document attached before the mark, with the worker off, is never sent', async () => {
    const f = await baselined(); f.attach('boleto'); f.attach('nfse'); tick(f);
    const s = await activated(f);
    for (const day of ['05', '06', '11']) { f.setNow(`2026-11-${day}T12:00:00Z`); await s.scan(); }
    assert.equal(f.events().length, 0);
});
test('a payment recorded before the mark, with the worker off, is never confirmed', async () => {
    const f = await baselined(); f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago'; tick(f);
    const s = await activated(f); await s.scan(); tick(f); await s.scan();
    assert.equal(f.events().length, 0); assert.equal(state(f).transitionId, null); assert.equal(state(f).stopped, true);
});
test('a parcel created before the mark, with the worker off, stays silent', async () => {
    const f = await baselined(), n = register(f); n.invoice.fields[N.BOLETO] = pdf(f, 'boleto', NEW_BOLETO); tick(f);
    const s = await activated(f); await s.scan(); tick(f); await s.scan();
    assert.equal(f.events().length, 0); assert.equal(f.store.data.states.get(n.ids.invoice).armed.boleto, false);
});
test('a parcel with a broken chain at the mark, fixed afterwards, stays silent', async () => {
    const f = await baselined(), n = register(f); n.invoice.fields[N.BOLETO] = pdf(f, 'boleto', NEW_BOLETO);
    const link = n.invoice.fields[N.CONTRATO]; delete n.invoice.fields[N.CONTRATO]; tick(f);
    const s = await activated(f); assert.equal(f.store.data.general.quarantined, 1);
    n.invoice.fields[N.CONTRATO] = link; await s.scan(); tick(f); await s.scan();
    assert.equal(f.events().length, 0);
});
test('a known parcel unreadable at the mark stays silent once it is readable again', async () => {
    const f = await baselined(); f.attach('boleto'); const link = f.invoice.fields[N.CONTRATO]; delete f.invoice.fields[N.CONTRATO]; tick(f);
    const s = await activated(f);
    f.invoice.fields[N.CONTRATO] = link; await s.scan(); tick(f); f.attach('nfse'); await s.scan();
    assert.equal(f.events().length, 0);
});
test('a document unreadable at the mark does not go out once it becomes readable', async () => {
    const f = await baselined(); f.invoice.fields[N.BOLETO] = [{ id: 'attGGGGGGGGGGGGGG', type: 'image/png', size: 10, url: 'https://v5.airtableusercontent.com/boleto' }]; tick(f);
    const s = await activated(f); assert.equal(state(f).seen.boleto, true);
    f.attach('boleto'); await s.scan(); tick(f); await s.scan();
    assert.equal(f.events().length, 0);
});
test('a pending event from before the mark is refused and cancelled, not delivered', async () => {
    const f = fixture(), s0 = pilotOnly(f, [f.ids.client]); await s0.scan(); f.attach('boleto'); await s0.scan(); tick(f);
    const e = of(f, 'BOLETO_AVAILABLE')[0]; assert.equal(e.status, 'pending');
    const s = await activated(f); await s.scan();
    await assert.rejects(s.validate(e.payload), /CLIENT_NOT_RELEASED/);
    const w = createWorker({ config: cfg, store: f.store, service: s, clock: f.clock, random: () => 0, fetcher: async () => { throw new Error('must not send'); } });
    await w.deliver(stored(f, e));
    assert.equal(stored(f, e).status, 'cancelled'); assert.equal(stored(f, e).reason, 'CLIENT_NOT_RELEASED');
    await s.scan(); assert.equal(f.events().length, 1, 'never resurrected');
});
test('a client that left the pilot does not restart its old reminders', async () => {
    const f = fixture(), s0 = pilotOnly(f, [f.ids.client]); await s0.scan(); f.attach('boleto'); await s0.scan(); await f.sent();
    const count = f.events().length; tick(f);
    const s = await activated(f); assert.equal(state(f).armed.boleto, false);
    for (const day of ['05', '06', '11']) { f.setNow(`2026-11-${day}T12:00:00Z`); await s.scan(); }
    assert.equal(f.events().length, count);
});
test('a client kept on the list continues its flow across the activation', async () => {
    const f = fixture(), list = [f.ids.client], s0 = pilotOnly(f, list); await s0.scan(); f.attach('boleto'); await s0.scan(); await f.sent(); tick(f);
    const s = await activated(f, list); assert.equal(state(f).armed.boleto, true);
    f.setNow('2026-11-05T12:00:00Z'); await s.scan();
    assert.equal(of(f, 'BOLETO_D_MINUS_1').length, 1);
    await s.validate(of(f, 'BOLETO_D_MINUS_1')[0].payload);
});
test('existing boletos are not processed again: same digest, no download, not armed', async () => {
    const f = fixture(); f.attach('boleto'); await pilotOnly(f, []).scan(); tick(f);
    const before = structuredClone(state(f).snapshot.documents.boleto); let downloads = 0;
    const counting = require('../lib/billing/source').createSource({ airtable: f.airtable, cipher: f.store.cipher, pdfReader: async () => { downloads++; throw new Error('must not download'); } });
    const s = createService({ store: f.store, source: counting, clock: f.clock, mode: 'general' });
    assert.equal((await s.scan()).general, 'activated'); tick(f); await s.scan();
    assert.equal(downloads, 0); assert.deepEqual(state(f).snapshot.documents.boleto, before);
    assert.equal(state(f).armed.boleto, false); assert.equal(f.events().length, 0);
});

// Depois do marco.
test('after the mark: client, proposal, contract, parcel and documents created in Airtable just work', async () => {
    const f = await baselined(), s = await activated(f), n = register(f); await s.scan();
    assert.equal(f.events().length, 0, 'no document yet');
    n.invoice.fields[N.BOLETO] = pdf(f, 'boleto', NEW_BOLETO); await s.scan();
    const [e] = of(f, 'BOLETO_AVAILABLE');
    assert.equal(e.payload.clientId, n.ids.client); assert.equal(e.payload.recipient, 'financeiro@novo.example.test');
    await s.validate(e.payload); await f.sent();
    n.invoice.fields[N.NFSE] = pdf(f, 'nfse', NEW_NFSE); await s.scan();
    assert.equal(of(f, 'NFSE_AVAILABLE').length, 1);
    await f.sent(); f.setNow('2026-11-19T12:00:00Z'); await s.scan();
    assert.equal(of(f, 'BOLETO_D_MINUS_1').length, 1);
});
test('after the mark: a parcel that already carries its boleto when first seen goes out, once', async () => {
    const f = await baselined(), s = await activated(f), n = register(f); n.invoice.fields[N.BOLETO] = pdf(f, 'boleto', NEW_BOLETO); await s.scan();
    assert.equal(of(f, 'BOLETO_AVAILABLE').length, 1);
    await s.scan(); assert.equal(of(f, 'BOLETO_AVAILABLE').length, 1);
});
test('after the mark: an incomplete chain stays blocked and goes out once complete', async () => {
    const f = await baselined(), s = await activated(f), n = register(f); n.invoice.fields[N.BOLETO] = pdf(f, 'boleto', NEW_BOLETO);
    const link = n.client.fields[CLIENT_PROPOSALS]; n.client.fields[CLIENT_PROPOSALS] = []; await s.scan();
    assert.equal(f.events().length, 0); assert.equal(audits(f, 'CHAIN_RECIPROCAL_INVALID').length, 1);
    n.client.fields[CLIENT_PROPOSALS] = link; await s.scan();
    assert.equal(of(f, 'BOLETO_AVAILABLE').length, 1);
});
test('after the mark: the validations still hold for a client nobody listed', async t => {
    const cases = {
        'CNPJ duplicado': n => { n.client.fields[S.CLIENTES.CNPJ] = '12345678000195'; },
        'CNPJ inválido': n => { n.client.fields[S.CLIENTES.CNPJ] = '123'; },
        'proposta não aceita': n => { n.proposal.fields[S.PROPOSTA.STATUS] = 'Recusada'; },
        'contrato cancelado': n => { n.contract.fields[S.CONTRATOS.STATUS] = 'Cancelado'; },
        'sem e-mail financeiro': n => { n.client.fields[CLIENT_EMAIL] = ''; },
        'pagamento inconsistente': n => { n.invoice.fields[N.DATA_PAGAMENTO] = '2026-11-01'; },
        'já paga': n => { n.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago'; },
        'documento que não é PDF': (n, f) => { n.invoice.fields[N.BOLETO] = [{ ...pdf(f, 'boleto', NEW_BOLETO)[0], type: 'image/png' }]; }
    };
    for (const [name, spoil] of Object.entries(cases)) await t.test(name, async () => {
        const f = await baselined(), s = await activated(f), n = register(f); n.invoice.fields[N.BOLETO] = pdf(f, 'boleto', NEW_BOLETO); spoil(n, f); await s.scan();
        assert.equal(f.events().length, 0);
    });
});
test('after the mark: only the addresses registered in Airtable receive, and a removed one is refused', async () => {
    const f = await baselined(), s = await activated(f), n = register(f);
    n.client.fields[CLIENT_EMAIL] = 'a@novo.example.test; b@novo.example.test; invalido'; n.invoice.fields[N.BOLETO] = pdf(f, 'boleto', NEW_BOLETO); await s.scan();
    assert.deepEqual(of(f, 'BOLETO_AVAILABLE').map(e => e.payload.recipient).sort(), ['a@novo.example.test', 'b@novo.example.test']);
    const e = of(f, 'BOLETO_AVAILABLE').find(x => x.payload.recipient.startsWith('b'));
    n.client.fields[CLIENT_EMAIL] = 'a@novo.example.test';
    await assert.rejects(s.validate(e.payload), /RECIPIENT_UNAUTHORIZED/);
});
test('after the mark: a new parcel of an old client goes out, and its old parcel stays silent', async () => {
    const f = fixture(); f.attach('boleto'); await pilotOnly(f, []).scan(); tick(f);
    const s = await activated(f), old = f.invoice;
    const fresh = { id: 'recPPPPPPPPPPPPPP', createdTime: iso(f.clock()), fields: { ...old.fields, [N.BOLETO]: pdf(f, 'boleto', NEW_BOLETO), [N.VENCIMENTO]: '2026-12-01' } };
    f.tables[S.TABELAS.NOTAS_FISCAIS].push(fresh); f.contract.fields[S.CONTRATOS.PARCELAS] = [old.id, fresh.id]; await s.scan();
    assert.deepEqual(f.events().map(e => [e.payload.type, e.payload.invoiceId]), [['BOLETO_AVAILABLE', fresh.id]]);
});
test('after the mark: an old parcel stays silent, for a replaced boleto, a new NFSe and a payment', async () => {
    const f = fixture(); f.attach('boleto'); await pilotOnly(f, []).scan(); tick(f);
    const s = await activated(f);
    f.invoice.fields[N.BOLETO] = pdf(f, 'boleto', NEW_BOLETO); await s.scan(); tick(f, 1000000); await s.scan();
    f.attach('nfse'); await s.scan();
    f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago'; await s.scan(); await s.scan();
    assert.equal(f.events().length, 0); assert.equal(state(f).transitionId, null); assert.equal(state(f).stopped, true);
});
test('after the mark: an old parcel without a boleto stays silent when it receives its first one', async () => {
    const f = await baselined(), s = await activated(f); f.attach('boleto'); await s.scan();
    for (const day of ['05', '06', '11']) { f.setNow(`2026-11-${day}T12:00:00Z`); await s.scan(); }
    assert.equal(f.events().length, 0);
});
test('after the mark: an old parcel of a client that also has new parcels stays silent', async () => {
    const f = await baselined(), s = await activated(f);
    const fresh = { id: 'recPPPPPPPPPPPPPP', createdTime: iso(f.clock()), fields: { ...f.invoice.fields, [N.BOLETO]: pdf(f, 'boleto', NEW_BOLETO), [N.VENCIMENTO]: '2026-12-01' } };
    f.tables[S.TABELAS.NOTAS_FISCAIS].push(fresh); f.contract.fields[S.CONTRATOS.PARCELAS] = [f.invoice.id, fresh.id]; f.attach('boleto'); await s.scan();
    assert.deepEqual(f.events().map(e => e.payload.invoiceId), [fresh.id]);
});
test('a parcel created at the exact mark, or without a valid date, does not start the flow', async t => {
    for (const [name, created] of [['no marco', f => iso(f.store.data.general.activatedAt)], ['sem data', () => undefined], ['data inválida', () => 'ontem']]) await t.test(name, async () => {
        const f = await baselined(), s = await activated(f), n = register(f); n.invoice.createdTime = created(f); n.invoice.fields[N.BOLETO] = pdf(f, 'boleto', NEW_BOLETO); await s.scan();
        n.invoice.fields[N.NFSE] = pdf(f, 'nfse', NEW_NFSE); await s.scan();
        assert.equal(f.events().length, 0);
    });
});
test('the proof refuses an old parcel, even for an event that claims to be new', async () => {
    const f = await baselined(), s = await activated(f), n = register(f); n.invoice.fields[N.BOLETO] = pdf(f, 'boleto', NEW_BOLETO); await s.scan();
    const [e] = f.events(); await s.validate(e.payload);
    n.invoice.createdTime = '2020-01-01T00:00:00Z';
    await assert.rejects(s.validate(e.payload), /CLIENT_NOT_RELEASED/);
});
test('after the mark: a new parcel keeps its legitimate events: update, reminders and payment', async () => {
    const f = await baselined(), s = await activated(f), n = register(f); n.invoice.fields[N.BOLETO] = pdf(f, 'boleto', NEW_BOLETO); await s.scan(); await f.sent();
    n.invoice.fields[N.VENCIMENTO] = '2026-11-25'; await s.scan(); tick(f, 1000000); await s.scan();
    assert.equal(of(f, 'BOLETO_UPDATED').length, 1); await f.sent();
    f.setNow('2026-11-24T12:00:00Z'); await s.scan(); assert.equal(of(f, 'BOLETO_D_MINUS_1').length, 1); await f.sent();
    f.setNow('2026-11-25T12:00:00Z'); await s.scan(); assert.equal(of(f, 'BOLETO_DUE_TODAY').length, 1); await f.sent();
    f.setNow('2026-11-30T12:00:00Z'); await s.scan(); assert.equal(of(f, 'BOLETO_OVERDUE_REMINDER').length, 1); await f.sent();
    n.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago'; await s.scan(); await s.scan();
    assert.equal(of(f, 'BOLETO_PAYMENT_RECORDED').length, 1);
    await s.validate(of(f, 'BOLETO_PAYMENT_RECORDED')[0].payload);
});
test('the proof for a new client carries the same guarantees', async () => {
    const f = await baselined(), s = await activated(f), n = register(f); n.invoice.fields[N.BOLETO] = pdf(f, 'boleto', NEW_BOLETO); await s.scan();
    const [e] = f.events(), { proof } = await s.validate(e.payload);
    assert.equal(proof.access.clientId, n.ids.client); assert.equal(proof.access.cnpj, '98765432000110');
    assert.equal(proof.baselineVerified, true); assert.equal(proof.chainVerified, true);
});

// Pausa e volta ao piloto.
test('back to the pilot: new clients are refused and the mark is spent, once', async () => {
    const f = await baselined(), s = await activated(f), n = register(f); n.invoice.fields[N.BOLETO] = pdf(f, 'boleto', NEW_BOLETO); await s.scan();
    const [e] = f.events(), back = pilotOnly(f, []);
    await assert.rejects(back.validate(e.payload), /CLIENT_NOT_RELEASED/);
    await back.scan(); await back.scan();
    assert.ok(f.store.data.general.revokedAt); assert.equal(audits(f, 'GENERAL_MODE_REVOKED').length, 1);
});
test('general again: a new mark, and what happened in between stays silent', async () => {
    const f = await baselined(), s = await activated(f), n = register(f); n.invoice.fields[N.BOLETO] = pdf(f, 'boleto', NEW_BOLETO); await s.scan();
    const [pending] = f.events(), first = f.store.data.general.activatedAt;
    tick(f); await pilotOnly(f, []).scan(); tick(f); f.attach('boleto');
    const again = await activated(f);
    assert.ok(f.store.data.general.activatedAt > first); assert.equal(f.store.data.general.revokedAt, undefined);
    await assert.rejects(again.validate(pending.payload), /CLIENT_NOT_RELEASED/);
    await again.scan(); tick(f); await again.scan();
    assert.deepEqual(f.events().map(e => e.payload.eventId), [pending.payload.eventId]);
});
test('a pause of the worker in general mode keeps the mark and does not recover past reminder days', async () => {
    const f = await baselined(), s = await activated(f), n = register(f); n.invoice.fields[N.BOLETO] = pdf(f, 'boleto', NEW_BOLETO); await s.scan(); await f.sent();
    const mark = structuredClone(f.store.data.general);
    f.setNow('2026-11-27T12:00:00Z'); await general(f).scan();
    assert.deepEqual(f.store.data.general, mark);
    for (const type of ['BOLETO_D_MINUS_1', 'BOLETO_DUE_TODAY', 'BOLETO_OVERDUE_REMINDER']) assert.equal(of(f, type).length, 0, type);
});
