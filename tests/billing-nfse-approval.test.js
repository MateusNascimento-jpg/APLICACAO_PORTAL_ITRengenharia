'use strict';
// Toda NFSe cadastrada no Airtable já foi conferida e aprovada; as verificações técnicas continuam. Sem rede.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { fixture, S } = require('./helpers/billing-fixtures');
const { CLIENT_EMAIL } = require('../lib/billing/source');
const { createWorker } = require('../lib/billing/worker');
const { register } = require('../lib/billing/routes');
const { configuration } = require('../lib/billing/config');
const { hash } = require('../lib/billing/protocol');
const { valid } = require('../lib/billing/contract');
const N = S.NOTAS_FISCAIS;
const cfg = { enabled: true, worker: true, origin: 'https://notifications.example.test', secret: Buffer.alloc(32, 3).toString('base64') };
const noFetch = async () => { throw new Error('must not send'); };
const worker = (f, fetcher = noFetch) => createWorker({ config: cfg, store: f.store, service: f.service, clock: f.clock, fetcher, random: () => 0 });
const types = f => f.events().map(e => e.payload.type);
const find = (f, type) => f.events().find(e => e.payload.type === type);
const notifications = process.env.BILLING_NOTIFICATIONS_REPO || path.resolve(__dirname, '../../Emails_diarios_ITRengenharia');
const available = fs.existsSync(path.join(notifications, 'billing/receiver.js'));

test('registered NFSe is queued and authorized with no additional approval', async () => {
    const f = fixture(); const e = await f.ready('nfse');
    assert.equal(e.payload.type, 'NFSE_AVAILABLE'); assert.equal(valid(e.payload), true);
    const { proof, bytes } = await f.service.validate(e.payload);
    assert.equal(proof.authorized, true); assert.deepEqual(bytes.nfse, f.pdfs.nfse);
});
test('the proof makes no payment claim about a fiscal document', async () => {
    const f = fixture(); const e = await f.ready('nfse');
    const { proof } = await f.service.validate(e.payload);
    assert.equal(proof.documentPayable, false); assert.equal(proof.payableAfterDue, false);
});
test('NFSe is independent of boleto, due date and payment', async t => {
    await t.test('sem boleto', async () => {
        const f = fixture(); await f.ready('nfse'); assert.equal(f.invoice.fields[N.BOLETO], undefined); assert.deepEqual(types(f), ['NFSE_AVAILABLE']);
    });
    await t.test('apos o vencimento', async () => {
        const f = fixture(); await f.service.scan(); f.setNow('2026-11-20T12:00:00Z'); f.attach('nfse'); await f.service.scan();
        await f.service.validate(find(f, 'NFSE_AVAILABLE').payload);
    });
    await t.test('parcela paga', async () => {
        const f = fixture(); await f.service.scan(); f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago'; f.attach('nfse'); await f.service.scan();
        await f.service.validate(find(f, 'NFSE_AVAILABLE').payload);
    });
    await t.test('status Vencido', async () => {
        const f = fixture(); await f.service.scan(); f.invoice.fields[N.STATUS_PAGAMENTO] = 'Vencido'; f.attach('nfse'); await f.service.scan();
        await f.service.validate(find(f, 'NFSE_AVAILABLE').payload);
    });
});

// Sem retroativos.
test('NFSe already present at the baseline is never sent', async () => {
    const f = fixture(); f.attach('nfse'); await f.service.scan(); await f.service.scan();
    f.setNow('2026-11-20T12:00:00Z'); await f.service.scan();
    assert.equal(f.events().length, 0);
});
test('old invoice first seen after the baseline does not send its existing NFSe', async () => {
    const f = fixture(); await f.service.scan();
    const old = { id: 'recYYYYYYYYYYYYYY', createdTime: '2020-01-01T00:00:00Z', fields: structuredClone(f.invoice.fields) };
    old.fields[N.NFSE] = [{ id: f.ids.nfse, type: 'application/pdf', size: f.pdfs.nfse.length, url: 'https://v5.airtableusercontent.com/nfse' }];
    f.tables[S.TABELAS.NOTAS_FISCAIS].push(old); f.contract.fields[S.CONTRATOS.PARCELAS].push(old.id);
    await f.service.scan(); await f.service.scan();
    assert.equal(f.events().length, 0);
});
test('a contact added later does not receive an NFSe already issued', async () => {
    const f = fixture(); await f.ready('nfse'); f.client.fields[CLIENT_EMAIL] += ';novo@example.test'; await f.service.scan();
    assert.equal(f.events().length, 1);
});
test('a cancelled NFSe event is not recreated', async () => {
    const f = fixture(); const e = await f.ready('nfse'); f.client.fields[CLIENT_EMAIL] = 'outro@example.test';
    await worker(f).deliver(e); assert.equal(f.store.data.events.get(e.payload.eventId).status, 'cancelled');
    f.client.fields[CLIENT_EMAIL] = 'financeiro@example.test'; await f.service.scan();
    assert.equal(f.events().length, 1); assert.equal(f.events()[0].status, 'cancelled');
});

// Verificações técnicas preservadas.
test('technical checks still deny an NFSe', async t => {
    const changes = {
        contentSwapped: f => { f.pdfs.nfse = Buffer.from(f.pdfs.nfse.toString().replace('NFSe', 'XXXX')); },
        sizeChanged: f => { f.pdfs.nfse = Buffer.from('%PDF-1.4\nOutra nota fiscal\n%%EOF'); },
        notPdfMime: f => { f.invoice.fields[N.NFSE][0].type = 'application/xml'; },
        badAttachmentId: f => { f.invoice.fields[N.NFSE][0].id = 'x'; },
        twoAttachments: f => { f.invoice.fields[N.NFSE].push({ ...f.invoice.fields[N.NFSE][0], id: 'attGGGGGGGGGGGGGG' }); },
        removed: f => { f.invoice.fields[N.NFSE] = []; },
        installmentCancelled: f => { f.invoice.fields[N.STATUS_PAGAMENTO] = 'Cancelado'; },
        unknownStatus: f => { f.invoice.fields[N.STATUS_PAGAMENTO] = 'Outro'; },
        contractCancelled: f => { f.contract.fields[S.CONTRATOS.STATUS] = 'Cancelado'; },
        proposalNotAccepted: f => { f.proposal.fields[S.PROPOSTA.STATUS] = 'Enviada'; },
        invalidCnpj: f => { f.client.fields[S.CLIENTES.CNPJ] = '123'; },
        duplicateCnpj: f => { f.tables[S.TABELAS.CLIENTES].push({ ...f.client, id: 'recZZZZZZZZZZZZZZ' }); },
        otherClient: f => { f.proposal.fields[S.PROPOSTA.CLIENTE] = ['recZZZZZZZZZZZZZZ']; },
        brokenChain: f => { f.contract.fields[S.CONTRATOS.PARCELAS] = []; },
        recipientRemoved: f => { f.client.fields[CLIENT_EMAIL] = 'other@example.test'; },
        installmentChanged: f => { f.invoice.fields[N.PARCELA] = 'Parcela 2'; }
    };
    for (const [name, change] of Object.entries(changes)) await t.test(name, async () => {
        const f = fixture(); const e = await f.ready('nfse'); change(f);
        await assert.rejects(f.service.validate(e.payload));
    });
});
test('API failure on authorization: no send, intent stays retryable', async () => {
    const f = fixture(); const e = await f.ready('nfse'); f.airtable.obterRegistro = async () => { throw new Error('network offline'); };
    await worker(f).deliver(e); assert.equal(f.store.data.events.get(e.payload.eventId).status, 'retry');
});
test('an NFSe replaced before anything was sent follows the new document', async () => {
    const f = fixture(); await f.ready('nfse'); f.pdfs.nfse = Buffer.from('%PDF-1.4\nNota substituta\n%%EOF'); f.attach('nfse'); f.invoice.fields[N.NFSE][0].id = 'attGGGGGGGGGGGGGG'; await f.service.scan();
    assert.deepEqual(f.events().map(e => e.status), ['cancelled', 'pending']);
    assert.deepEqual(f.store.data.states.get(f.ids.invoice).blockedKinds, []);
});
test('idempotence: same NFSe keeps one event across scans and URL changes', async () => {
    const f = fixture(); const e = await f.ready('nfse');
    for (let i = 0; i < 5; i++) await f.service.scan();
    f.invoice.fields[N.NFSE][0].url += '?novo-token'; await f.service.scan();
    assert.equal(f.events().length, 1); assert.equal(f.events()[0].payload.eventId, e.payload.eventId);
    assert.equal(f.events()[0].payload.document.sha256, hash(f.pdfs.nfse));
});

// NFSe e cobrança seguem independentes após o vencimento.
test('an overdue installment sends its NFSe and its boleto as separate messages', async () => {
    const f = fixture(); await f.service.scan(); f.setNow('2026-11-11T12:00:00Z'); f.attach('boleto'); f.attach('nfse'); await f.service.scan();
    assert.ok(types(f).includes('NFSE_AVAILABLE')); assert.ok(types(f).includes('BOLETO_AVAILABLE'));
    assert.equal(find(f, 'NFSE_AVAILABLE').payload.document.kind, 'nfse'); assert.equal(find(f, 'BOLETO_AVAILABLE').payload.document.kind, 'boleto');
});
test('the shared contract still requires a document on the reminder', async () => {
    const f = fixture(); await f.ready(); f.setNow('2026-11-11T12:00:00Z'); await f.service.scan();
    assert.equal(valid({ ...find(f, 'BOLETO_OVERDUE_REMINDER').payload, document: null }), false);
});

// Receptor real, sem alterar as Notificações.
test('real receiver sends the exact NFSe PDF, once, separate from the boleto', { skip: !available }, async t => {
    const { createReceiver, ROUTE } = require(path.join(notifications, 'billing/receiver.js'));
    const f = fixture(); await f.service.scan(); f.attach('boleto'); f.attach('nfse'); await f.service.scan();
    const app = express(); register(app, express, { config: cfg, store: f.store, service: f.service, clock: f.clock });
    const srv = app.listen(0, '127.0.0.1'); await new Promise(resolve => srv.once('listening', resolve));
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'itr-billing-test-'));
    t.after(async () => { await new Promise(resolve => { srv.closeAllConnections(); srv.close(resolve); }); fs.rmSync(directory, { recursive: true, force: true }); });
    const sent = [];
    const receiver = createReceiver({ config: { enabled: true, secret: cfg.secret, origin: 'https://portal.example.test', directory }, clock: f.clock,
        fetcher: (url, options) => fetch(`http://127.0.0.1:${srv.address().port}${new URL(url).pathname}`, options),
        send: async args => { sent.push(args); return { ok: true }; } });
    const w = worker(f, async (url, options) => {
        const r = await receiver.handle({ method: 'POST', path: ROUTE, headers: options.headers }, Buffer.from(options.body));
        return new Response(JSON.stringify(r.body), { status: r.status });
    });
    for (const e of f.events()) await w.deliver(e);
    for (const e of f.events()) await w.deliver(e);
    assert.equal(sent.length, 2);
    const nfse = sent.find(s => s.event.type === 'NFSE_AVAILABLE');
    assert.equal(nfse.pdfs.length, 1); assert.equal(nfse.pdfs[0].filename, 'NFSe.pdf'); assert.deepEqual(nfse.pdfs[0].content, f.pdfs.nfse);
});

// Sem caminho paralelo; migration e flags preservadas.
test('no attestation path remains in the code; migration 006 is preserved', () => {
    const dir = path.join(__dirname, '../lib/billing');
    assert.ok(!fs.existsSync(path.join(dir, 'evidence.js')));
    for (const file of fs.readdirSync(dir)) assert.doesNotMatch(fs.readFileSync(path.join(dir, file), 'utf8'), /portal_billing_documents|repo\.document|attestation|validateEvidence|DOCUMENT_UNVERIFIED/, file);
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../scripts/billing-local.js'), 'utf8'), /evidence|portal_billing_documents/i);
    const sql = fs.readFileSync(path.join(__dirname, '../migrations/006_billing_automation.sql'), 'utf8');
    assert.match(sql, /CREATE TABLE IF NOT EXISTS portal_billing_documents/); assert.doesNotMatch(sql, /DROP|TRUNCATE|DELETE/i);
});
test('flags stay off, and the legacy NF flow still cannot run together with billing', () => {
    assert.deepEqual(configuration({}), { enabled: false, worker: false });
    const env = { PORTAL_BILLING_ENABLED: 'true', BILLING_HMAC_SECRET: cfg.secret, PORTAL_BILLING_STORAGE_KEY: Buffer.alloc(32, 9).toString('base64'), PORTAL_BILLING_NOTIFICATIONS_ORIGIN: cfg.origin, PORTAL_NF_NOTIFICACOES_ATIVAS: 'true' };
    assert.throws(() => configuration(env), /BILLING_LEGACY_NF_CONFLICT/);
});
