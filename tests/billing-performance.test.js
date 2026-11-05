'use strict';
// Incremento 2: limites de chamadas, paridade do lote e frescor das autorizações. Sem rede.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture, S } = require('./helpers/billing-fixtures');
const { memoryStore } = require('./helpers/billing-memory');
const { createSource, CATALOG_FIELDS, CLIENT_EMAIL, CLIENT_PROPOSALS } = require('../lib/billing/source');
const { createService } = require('../lib/billing/service');
const { createWorker } = require('../lib/billing/worker');
const { createBudget, readOnlyAirtable } = require('../lib/billing/budget');
const { configuration } = require('../lib/billing/config');
const { hash } = require('../lib/billing/protocol');
const N = S.NOTAS_FISCAIS;
const cfg = { enabled: true, worker: true, origin: 'https://notifications.example.test', secret: Buffer.alloc(32, 3).toString('base64') };
const rec = (prefix, i) => 'rec' + prefix + String(i).padStart(13, '0');
const att = (prefix, i) => 'att' + prefix + String(i).padStart(13, '0');

// Base sintética que devolve só os campos pedidos e pagina como a API (100 por página).
function syntheticBase(size) {
    const pdf = Buffer.from('%PDF-1.4\nsintetico\n%%EOF');
    const tables = { [S.TABELAS.CLIENTES]: [], [S.TABELAS.PROPOSTA]: [], [S.TABELAS.CONTRATOS]: [], [S.TABELAS.NOTAS_FISCAIS]: [] };
    for (let i = 0; i < size; i++) {
        const attachment = (p, name) => [{ id: att(p, i), type: 'application/pdf', size: pdf.length, url: 'https://v5.airtableusercontent.com/' + name }];
        tables[S.TABELAS.CLIENTES].push({ id: rec('C', i), createdTime: '2020-01-01T00:00:00Z', fields: {
            [S.CLIENTES.CNPJ]: String(10000000000000 + i), [CLIENT_EMAIL]: `c${i}@example.test`, [CLIENT_PROPOSALS]: [rec('P', i)] } });
        tables[S.TABELAS.PROPOSTA].push({ id: rec('P', i), createdTime: '2020-01-01T00:00:00Z', fields: {
            [S.PROPOSTA.CLIENTE]: [rec('C', i)], [S.PROPOSTA.CONTRATOS]: [rec('K', i)], [S.PROPOSTA.STATUS]: 'Aceita' } });
        tables[S.TABELAS.CONTRATOS].push({ id: rec('K', i), createdTime: '2020-01-01T00:00:00Z', fields: {
            [S.CONTRATOS.PROPOSTA]: [rec('P', i)], [S.CONTRATOS.PARCELAS]: [rec('N', i)], [S.CONTRATOS.STATUS]: 'Ativo', [S.CONTRATOS.NOME]: 'C' + i } });
        tables[S.TABELAS.NOTAS_FISCAIS].push({ id: rec('N', i), createdTime: '2020-01-01T00:00:00Z', fields: {
            [N.CONTRATO]: [rec('K', i)], [N.PARCELA]: 'Parcela 1', [N.VALOR_PARCELA]: 100.5, [N.VENCIMENTO]: '2026-12-20',
            [N.STATUS_PAGAMENTO]: 'A Vencer', [N.BOLETO]: attachment('B', 'boleto'), [N.NFSE]: attachment('F', 'nfse') } });
    }
    const counters = { gets: 0, lists: 0, pages: 0, pdfs: 0 };
    const project = (record, fields) => ({ id: record.id, createdTime: record.createdTime, fields: Object.fromEntries(fields.filter(k => k in record.fields).map(k => [k, record.fields[k]])) });
    const airtable = {
        async obterRegistro(table, id) { counters.gets++; return structuredClone(tables[table].find(r => r.id === id) || null); },
        async listarRegistros(table, fields) {
            counters.lists++; counters.pages += Math.max(1, Math.ceil(tables[table].length / 100));
            return tables[table].map(r => project(structuredClone(r), fields));
        }
    };
    const store = memoryStore();
    const pdfReader = async () => { counters.pdfs++; return { bytes: pdf, hash: hash(pdf) }; };
    const source = createSource({ airtable, cipher: store.cipher, pdfReader });
    const service = createService({ store, source, clock: () => Date.parse('2026-11-04T12:00:00Z') });
    const reset = () => Object.keys(counters).forEach(k => { counters[k] = 0; });
    return { tables, counters, reset, airtable, store, source, service };
}

test('scan of 300 invoices: four listings, no record GET, PDFs only once', async () => {
    const b = syntheticBase(300);
    await b.service.scan();
    assert.deepEqual(b.counters, { gets: 0, lists: 4, pages: 12, pdfs: 600 }, 'baseline hashes each document once');
    b.reset(); await b.service.scan();
    assert.deepEqual(b.counters, { gets: 0, lists: 4, pages: 12, pdfs: 0 }, 'steady scan downloads nothing');
});
test('API pages grow with base size, not with invoices times clients', async () => {
    const b = syntheticBase(1000); await b.service.scan(); b.reset(); await b.service.scan();
    assert.equal(b.counters.pages, 40); assert.equal(b.counters.gets, 0);
});
test('a new or replaced attachment costs exactly one download', async () => {
    const b = syntheticBase(50); await b.service.scan(); b.reset();
    b.tables[S.TABELAS.NOTAS_FISCAIS][7].fields[N.NFSE][0].id = att('Z', 7);
    await b.service.scan(); assert.equal(b.counters.pdfs, 1);
    b.reset(); await b.service.scan(); assert.equal(b.counters.pdfs, 0);
});
test('same attachment id with another size is downloaded again, never reused', async () => {
    const b = syntheticBase(5); await b.service.scan(); b.reset();
    b.tables[S.TABELAS.NOTAS_FISCAIS][2].fields[N.NFSE][0].size += 1;
    await b.service.scan();
    assert.equal(b.counters.pdfs, 1);
    assert.equal(b.store.data.audit.at(-1).code, 'DOCUMENT_INTEGRITY');
});
test('catalog read and fresh read build the identical snapshot and state version', async () => {
    const b = syntheticBase(3); await b.service.scan(); const repo = b.store.repo;
    const catalog = await b.source.catalog();
    for (const id of catalog.ids) {
        const listed = await b.source.read(id, repo, { catalog }), fresh = await b.source.read(id, repo);
        assert.deepEqual(listed.snapshot, fresh.snapshot); assert.equal(listed.createdAt, fresh.createdAt);
    }
});
test('catalog requests every field the source reads, and nothing about values or proposals PDF', () => {
    assert.deepEqual(CATALOG_FIELDS[S.TABELAS.NOTAS_FISCAIS].slice().sort(), [N.CONTRATO, N.PARCELA, N.VALOR_PARCELA, N.VENCIMENTO, N.STATUS_PAGAMENTO, N.BOLETO, N.NFSE].sort());
    assert.ok(!CATALOG_FIELDS[S.TABELAS.PROPOSTA].includes(S.PROPOSTA.VALOR)); assert.ok(!CATALOG_FIELDS[S.TABELAS.PROPOSTA].includes(S.PROPOSTA.ARQUIVOS));
});

// Frescor: nenhuma otimização alcança a autorização.
test('every authorization re-reads chain, identity list and its own PDF, for each phase', async () => {
    const f = fixture(); const e = await f.ready(); f.attach('nfse'); await f.service.scan();
    const counts = { get: 0, list: 0 }; const { obterRegistro: g, listarRegistros: l } = f.airtable;
    f.airtable.obterRegistro = (...a) => { counts.get++; return g(...a); }; f.airtable.listarRegistros = (...a) => { counts.list++; return l(...a); };
    let current = f.store.data.events.get(e.payload.eventId); current.status = 'sending'; await f.store.repo.saveEvent(current);
    for (const phase of ['prepare', 'pdf', 'smtp']) {
        counts.get = counts.list = 0;
        const { bytes } = await f.service.validate(e.payload, phase);
        assert.deepEqual(counts, { get: 4, list: 1 }, phase);
        assert.deepEqual(bytes.boleto, f.pdfs.boleto, 'own PDF freshly downloaded in ' + phase);
        assert.equal(bytes.nfse, undefined, 'other document is not downloaded');
    }
});
test('changes right after a scan are denied without another scan', async t => {
    const changes = {
        paid: f => { f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago'; },
        cancelled: f => { f.invoice.fields[N.STATUS_PAGAMENTO] = 'Cancelado'; },
        contractCancelled: f => { f.contract.fields[S.CONTRATOS.STATUS] = 'Cancelado'; },
        proposalRevoked: f => { f.proposal.fields[S.PROPOSTA.STATUS] = 'Enviada'; },
        recipientRemoved: f => { f.client.fields[CLIENT_EMAIL] = 'other@example.test'; },
        duplicatedCnpj: f => { f.tables[S.TABELAS.CLIENTES].push({ ...f.client, id: 'recZZZZZZZZZZZZZZ' }); },
        relinked: f => { f.client.fields[CLIENT_PROPOSALS] = []; }
    };
    for (const [name, change] of Object.entries(changes)) await t.test(name, async () => {
        const f = fixture(); const e = await f.ready(); await f.service.scan();
        change(f);
        await assert.rejects(f.service.validate(e.payload));
    });
});
test('own PDF swapped with same attachment id and size is detected by the proof', async () => {
    const f = fixture(); const e = await f.ready(); const original = f.pdfs.boleto;
    f.pdfs.boleto = Buffer.from(original.toString().replace('Boleto', 'Fraude'));
    assert.equal(f.pdfs.boleto.length, original.length);
    await assert.rejects(f.service.validate(e.payload));
    assert.ok(f.store.data.states.get(f.ids.invoice).blockedKinds.includes('boleto'));
});
test('a reused digest never enters a proof as if it were this event document', async () => {
    const f = fixture(); await f.ready('nfse'); await f.service.scan(); f.attach('boleto'); await f.service.scan();
    const boleto = f.events().find(e => e.payload.type === 'BOLETO_AVAILABLE');
    const { bytes, proof } = await f.service.validate(boleto.payload);
    assert.ok(bytes.boleto); assert.equal(bytes.nfse, undefined); assert.equal(proof.authorized, true);
});
test('catalog does not survive between scans', async () => {
    const f = fixture(); await f.ready(); let lists = 0; const l = f.airtable.listarRegistros;
    f.airtable.listarRegistros = (...a) => { lists++; return l(...a); };
    await f.service.scan(); await f.service.scan();
    assert.equal(lists, 8, 'four tables on each scan');
});

// Falhas e paginação.
test('a listing failure in any table changes nothing and cancels nothing', async t => {
    for (const table of Object.values(S.TABELAS)) await t.test(table, async () => {
        const f = fixture(); const e = await f.ready(); const l = f.airtable.listarRegistros, audit = f.store.data.audit.length;
        f.airtable.listarRegistros = async (name, ...rest) => { if (name === table) throw new Error('AIRTABLE_PAGINATION_INVALID'); return l(name, ...rest); };
        await assert.rejects(f.service.scan());
        assert.equal(f.store.data.events.get(e.payload.eventId).status, 'pending'); assert.equal(f.store.data.audit.length, audit);
        f.airtable.listarRegistros = l; f.invoice.fields[N.STATUS_PAGAMENTO] = 'A Vencer'; await f.service.scan();
        assert.equal(f.store.data.events.get(e.payload.eventId).status, 'pending');
    });
});
test('duplicated ids and a non-array listing are rejected as a whole', async t => {
    for (const [name, bad] of [['duplicate', r => [...r, r[0]]], ['not array', () => ({})], ['bad id', r => [...r, { id: 'x', fields: {} }]]]) await t.test(name, async () => {
        const f = fixture(); await f.service.scan(); const l = f.airtable.listarRegistros;
        f.airtable.listarRegistros = async (table, ...rest) => { const r = await l(table, ...rest); return table === S.TABELAS.CONTRATOS ? bad(r) : r; };
        await assert.rejects(f.service.scan(), /SCAN_INVALID/);
    });
});
test('more than 3000 invoices is refused', async () => {
    const f = fixture(); const l = f.airtable.listarRegistros;
    f.airtable.listarRegistros = async (table, ...rest) => table === S.TABELAS.NOTAS_FISCAIS
        ? Array.from({ length: 3001 }, (_, i) => ({ id: rec('N', i), fields: {} })) : l(table, ...rest);
    await assert.rejects(f.service.scan(), /SCAN_INVALID/);
});
test('catalog taken mid-edit does not cancel a healthy pending event', async () => {
    const f = fixture(); const e = await f.ready(); const l = f.airtable.listarRegistros; let gets = 0; const g = f.airtable.obterRegistro;
    f.airtable.obterRegistro = (...a) => { gets++; return g(...a); };
    f.airtable.listarRegistros = async (table, ...rest) => {
        const r = await l(table, ...rest);
        if (table === S.TABELAS.CONTRATOS) r[0].fields[S.CONTRATOS.PARCELAS] = [];
        return r;
    };
    await f.service.scan();
    assert.equal(f.store.data.events.get(e.payload.eventId).status, 'pending'); assert.ok(gets >= 4);
});
test('an invalid chain confirmed by fresh reads still cancels', async () => {
    const f = fixture(); const e = await f.ready(); f.contract.fields[S.CONTRATOS.PARCELAS] = []; await f.service.scan();
    assert.equal(f.store.data.events.get(e.payload.eventId).status, 'cancelled');
});
test('rows never seen healthy cost no record GET on each scan', async () => {
    const f = fixture(); await f.service.scan();
    f.tables[S.TABELAS.NOTAS_FISCAIS].push({ id: 'recYYYYYYYYYYYYYY', createdTime: '2020-01-01T00:00:00Z', fields: {} });
    let gets = 0; const g = f.airtable.obterRegistro; f.airtable.obterRegistro = (...a) => { gets++; return g(...a); };
    await f.service.scan(); await f.service.scan(); assert.equal(gets, 0);
});

// Orçamento.
function virtual(options) {
    let now = 1000; const waits = [];
    const clock = () => now, advance = ms => { now += ms; };
    const budget = createBudget({ clock, sleep: async ms => { waits.push(ms); now += ms; }, ...options });
    return { budget, clock, advance, waits };
}
test('budget spaces call starts and runs one call at a time', async () => {
    const v = virtual({ minIntervalMs: 250 }); const starts = []; let active = 0, peak = 0;
    await Promise.all(Array.from({ length: 5 }, () => v.budget.run(async () => {
        starts.push(v.clock()); active++; peak = Math.max(peak, active);
        await new Promise(resolve => setImmediate(resolve)); v.advance(50); active--;
    })));
    assert.equal(peak, 1);
    for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 250);
});
test('budget does not add a wait when latency already used the interval', async () => {
    const v = virtual({ minIntervalMs: 250 });
    await v.budget.run(async () => v.advance(400)); await v.budget.run(async () => v.advance(400));
    assert.deepEqual(v.waits, []);
});
test('a 429 stops new calls for the penalty period and then recovers', async () => {
    const v = virtual({ cooldownMs: 30000 }); let calls = 0;
    await assert.rejects(v.budget.run(async () => { calls++; throw Object.assign(new Error('x'), { status: 429 }); }), /RATE_LIMITED/);
    await assert.rejects(v.budget.run(async () => { calls++; }), /RATE_LIMITED/); assert.equal(calls, 1);
    v.advance(30001); await v.budget.run(async () => { calls++; }); assert.equal(calls, 2);
});
test('other errors pass through and do not wedge the queue', async () => {
    const v = virtual();
    await assert.rejects(v.budget.run(async () => { throw new Error('boom'); }), /boom/);
    assert.equal(await v.budget.run(async () => 'ok'), 'ok');
});
test('rate limiting is transient: event is retried, never cancelled', async () => {
    const f = fixture(); const e = await f.ready(); const g = f.airtable.obterRegistro;
    f.airtable.obterRegistro = async () => { throw new Error('RATE_LIMITED'); };
    await createWorker({ config: cfg, store: f.store, service: f.service, clock: f.clock, fetcher: async () => { throw new Error('must not send'); } }).deliver(e);
    assert.equal(f.store.data.events.get(e.payload.eventId).status, 'retry');
    f.airtable.obterRegistro = g;
});

// Airtable somente leitura.
test('billing receives only the two read operations', async () => {
    const budget = createBudget({ minIntervalMs: 0 }); const called = [];
    const writes = new Proxy({}, { get: (_, name) => (...args) => { called.push(name); return name === 'listarRegistros' ? [] : null; } });
    const facade = readOnlyAirtable(writes, budget);
    assert.deepEqual(Object.keys(facade).sort(), ['listarRegistros', 'obterRegistro']); assert.ok(Object.isFrozen(facade));
    await facade.listarRegistros('t', []); assert.deepEqual(called, ['listarRegistros']);
    assert.equal(facade.atualizarDecisao, undefined);
});
test('billing source has no Airtable write path', () => {
    const dir = path.join(__dirname, '../lib/billing');
    for (const file of fs.readdirSync(dir)) {
        const code = fs.readFileSync(path.join(dir, file), 'utf8');
        assert.doesNotMatch(code, /atualizarDecisao|api\.airtable\.com|['"]PATCH['"]|['"]PUT['"]|['"]DELETE['"]/, file);
    }
});

// Intervalo.
test('scan interval config: default, bounds and fail closed', () => {
    const env = { PORTAL_BILLING_ENABLED: 'true', BILLING_HMAC_SECRET: cfg.secret, PORTAL_BILLING_STORAGE_KEY: Buffer.alloc(32, 9).toString('base64'), PORTAL_BILLING_NOTIFICATIONS_ORIGIN: cfg.origin };
    assert.equal(configuration(env).scanIntervalMs, 300000);
    assert.equal(configuration({ ...env, PORTAL_BILLING_SCAN_INTERVAL_SECONDS: '60' }).scanIntervalMs, 60000);
    for (const value of ['59', '3601', 'abc', '90.5']) assert.throws(() => configuration({ ...env, PORTAL_BILLING_SCAN_INTERVAL_SECONDS: value }), /BILLING_SCAN_INTERVAL_INVALID/);
});
test('scans follow the interval while deliveries run on every tick', async () => {
    let now = 0, scans = 0, dues = 0;
    const w = createWorker({ config: { ...cfg, scanIntervalMs: 300000 }, clock: () => now, fetcher: async () => {},
        store: { due: async () => { dues++; return []; } }, service: { scan: async () => { scans++; } } });
    for (let i = 0; i < 10; i++) { await w.tick(); now += 60000; }
    assert.equal(scans, 2); assert.equal(dues, 10);
});
test('a failed scan retries with backoff up to the interval', async () => {
    let now = 0, scans = 0;
    const w = createWorker({ config: { ...cfg, scanIntervalMs: 300000 }, clock: () => now, fetcher: async () => {},
        store: { due: async () => [] }, service: { scan: async () => { scans++; throw new Error('RATE_LIMITED'); } } });
    const moments = [];
    for (let i = 0; i < 12; i++) { const before = scans; await w.tick().catch(() => {}); if (scans > before) moments.push(now / 60000); now += 60000; }
    assert.deepEqual(moments, [0, 2, 6, 11]);
});
test('payment between scans stops a queued reminder at the proof', async () => {
    const f = fixture(); await f.ready(); f.setNow('2026-11-05T12:00:00Z'); await f.service.scan();
    const reminder = f.events().find(e => e.payload.type === 'BOLETO_D_MINUS_1');
    f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago';
    await createWorker({ config: cfg, store: f.store, service: f.service, clock: f.clock, fetcher: async () => { throw new Error('must not send'); } }).deliver(reminder);
    assert.equal(f.store.data.events.get(reminder.payload.eventId).status, 'cancelled');
});
