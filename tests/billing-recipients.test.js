'use strict';
// D1: destinatários financeiros vêm somente do cadastro existente no Airtable. Sem rede.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { fixture, S } = require('./helpers/billing-fixtures');
const { parseRecipients, CLIENT_EMAIL, CLIENT_PROPOSALS } = require('../lib/billing/source');
const { createWorker } = require('../lib/billing/worker');
const { register } = require('../lib/billing/routes');
const { validateEvidence } = require('../lib/billing/evidence');
const { configuration } = require('../lib/billing/config');
const { eventId, valid } = require('../lib/billing/contract');
const { emails } = require('../lib/portal-access');
const N = S.NOTAS_FISCAIS;
const cfg = { enabled: true, worker: true, origin: 'https://notifications.example.test', secret: Buffer.alloc(32, 3).toString('base64') };
const noFetch = async () => { throw new Error('must not send'); };
const worker = (f, fetcher = noFetch) => createWorker({ config: cfg, store: f.store, service: f.service, clock: f.clock, fetcher, random: () => 0 });
const setEmails = (f, value) => { f.client.fields[CLIENT_EMAIL] = value; };
const of = (f, type) => f.events().filter(e => e.payload.type === type).map(e => e.payload.recipient).sort();
const A = 'a@example.test', B = 'b@example.test', C = 'c@example.test';
const notifications = process.env.BILLING_NOTIFICATIONS_REPO || path.resolve(__dirname, '../../Emails_diarios_ITRengenharia');
const available = fs.existsSync(path.join(notifications, 'billing/receiver.js'));

test('parser: multiple addresses separated by semicolon', () => {
    assert.deepEqual(parseRecipients(`${B};${A};${C}`), { recipients: [A, B, C], invalid: 0 });
});
test('parser: trim, case and duplicates', () => {
    assert.deepEqual(parseRecipients(`  ${A} ; A@EXAMPLE.TEST;${B}\t; ${A};`), { recipients: [A, B], invalid: 0 });
});
test('parser: invalid addresses are counted, never returned', () => {
    assert.deepEqual(parseRecipients(`${A};invalido;x@y;@example.test;a b@example.test`), { recipients: [A], invalid: 4 });
});
test('parser: semicolon is the only separator', () => {
    assert.deepEqual(parseRecipients(`${A}, ${B}`), { recipients: [], invalid: 1 });
    assert.deepEqual(parseRecipients(`${A}\n${B}`), { recipients: [], invalid: 1 });
});
test('parser: empty and non-text values', () => {
    for (const value of [undefined, null, '', '   ', ';;', ' ; ; ']) assert.deepEqual(parseRecipients(value), { recipients: [], invalid: 0 });
    for (const value of [[A], { email: A }, 5]) assert.deepEqual(parseRecipients(value), { recipients: [], invalid: 1 });
});
test('every accepted address satisfies the contract with Notifications', async () => {
    const f = fixture(); setEmails(f, ` ${A.toUpperCase()} ; ${B} `); await f.ready();
    assert.deepEqual(of(f, 'BOLETO_AVAILABLE'), [A, B]);
    for (const e of f.events()) assert.equal(valid(e.payload), true);
});

test('one event per address, with independent identities', async () => {
    const f = fixture(); setEmails(f, `${A};${B};${C}`); await f.ready();
    assert.deepEqual(of(f, 'BOLETO_AVAILABLE'), [A, B, C]);
    assert.equal(new Set(f.events().map(e => e.payload.eventId)).size, 3);
});
test('invalid addresses stay out and are audited without exposing them', async () => {
    const f = fixture(); setEmails(f, `${A};segredo-invalido`); await f.ready();
    assert.deepEqual(of(f, 'BOLETO_AVAILABLE'), [A]);
    assert.ok(f.store.data.audit.some(a => a.code === 'RECIPIENT_INVALID'));
    assert.doesNotMatch(JSON.stringify(f.store.data.audit), /segredo-invalido/);
});
test('an address that turns invalid after the baseline is audited once a day', async () => {
    const f = fixture(); setEmails(f, A); await f.service.scan();
    assert.ok(!f.store.data.audit.some(a => a.code === 'RECIPIENT_INVALID'));
    setEmails(f, `${A};segredo-invalido`); await f.service.scan(); await f.service.scan();
    assert.equal(f.store.data.audit.filter(a => a.code === 'RECIPIENT_INVALID').length, 1);
    assert.doesNotMatch(JSON.stringify(f.store.data.audit), /segredo-invalido/);
});
test('a comma-joined cell sends to nobody until it is corrected', async () => {
    const f = fixture(); setEmails(f, `${A}, ${B}`); await f.ready();
    assert.equal(f.events().length, 0); assert.ok(f.store.data.audit.some(a => a.code === 'RECIPIENT_INVALID'));
});
test('empty list blocks the send without losing the occurrence', async t => {
    for (const value of ['', undefined, 'invalido']) await t.test(String(value), async () => {
        const f = fixture(); setEmails(f, value); await f.ready();
        assert.equal(f.events().length, 0); assert.ok(f.store.data.audit.some(a => a.code === 'RECIPIENT_UNAUTHORIZED'));
        setEmails(f, A); await f.service.scan();
        assert.deepEqual(of(f, 'BOLETO_AVAILABLE'), [A], 'nobody had received it yet');
    });
});

test('inconsistent CNPJ or relationships never authorize or queue', async t => {
    const changes = {
        invalidCnpj: f => { f.client.fields[S.CLIENTES.CNPJ] = '123'; },
        missingCnpj: f => { delete f.client.fields[S.CLIENTES.CNPJ]; },
        duplicateCnpj: f => { f.tables[S.TABELAS.CLIENTES].push({ ...f.client, id: 'recZZZZZZZZZZZZZZ' }); },
        twoClients: f => { f.proposal.fields[S.PROPOSTA.CLIENTE].push('recZZZZZZZZZZZZZZ'); },
        otherClient: f => { f.proposal.fields[S.PROPOSTA.CLIENTE] = ['recZZZZZZZZZZZZZZ']; },
        noBacklink: f => { f.client.fields[CLIENT_PROPOSALS] = []; },
        contractOfOtherProposal: f => { f.contract.fields[S.CONTRATOS.PROPOSTA] = ['recZZZZZZZZZZZZZZ']; },
        invoiceNotInContract: f => { f.contract.fields[S.CONTRATOS.PARCELAS] = []; }
    };
    for (const [name, change] of Object.entries(changes)) await t.test(name, async () => {
        const pending = fixture(); const e = await pending.ready(); change(pending);
        await assert.rejects(pending.service.validate(e.payload));
        await worker(pending).deliver(e);
        assert.equal(pending.store.data.events.get(e.payload.eventId).status, 'cancelled');
        const future = fixture(); await future.service.scan(); change(future); future.attach('boleto'); await future.service.scan();
        assert.equal(future.events().length, 0);
    });
});

test('removal before delivery: no HTTP call and the event is cancelled', async () => {
    const f = fixture(); setEmails(f, `${A};${B}`); await f.ready();
    const removed = f.events().find(e => e.payload.recipient === B); setEmails(f, A);
    await worker(f).deliver(removed);
    assert.equal(f.store.data.events.get(removed.payload.eventId).status, 'cancelled');
    assert.ok(f.store.data.audit.some(a => a.subject === removed.payload.eventId && a.code === 'RECIPIENT_UNAUTHORIZED'));
});
test('removal between prepare and SMTP denies the final proof and takes no lease', async () => {
    const f = fixture(); const e = await f.ready(); const current = f.store.data.events.get(e.payload.eventId);
    current.status = 'sending'; await f.store.repo.saveEvent(current);
    await f.service.validate(e.payload, 'prepare'); setEmails(f, 'other@example.test');
    await assert.rejects(f.service.validate(e.payload, 'smtp'), /RECIPIENT_UNAUTHORIZED/);
    assert.deepEqual(f.store.data.states.get(f.ids.invoice).leases, []);
});
test('removal is read at the source, without a scan, and the PDF is refused too', async () => {
    const f = fixture(); const e = await f.ready(); await f.service.validate(e.payload);
    setEmails(f, 'other@example.test');
    await assert.rejects(f.service.validate(e.payload, 'pdf'), /RECIPIENT_UNAUTHORIZED/);
});
test('a removed address gets no future occurrence; the others continue', async () => {
    const f = fixture(); setEmails(f, `${A};${B}`); await f.ready(); setEmails(f, A);
    f.setNow('2026-11-05T12:00:00Z'); await f.service.scan();
    assert.deepEqual(of(f, 'BOLETO_D_MINUS_1'), [A]);
});
test('an address removed after the audience was formed is not authorized by it', async () => {
    const f = fixture(); setEmails(f, `${A};${B}`); await f.service.scan(); f.attach('boleto');
    const proofs = new Map(f.store.data.documents); f.store.data.documents.clear();
    await f.service.scan(); assert.equal(f.events().length, 0);
    setEmails(f, A); f.store.data.documents = proofs; await f.service.scan();
    assert.deepEqual(of(f, 'BOLETO_AVAILABLE'), [A]);
});

test('new contact: no historical boleto', async () => {
    const f = fixture(); setEmails(f, A); await f.ready(); setEmails(f, `${A};${B}`); await f.service.scan(); await f.service.scan();
    assert.deepEqual(of(f, 'BOLETO_AVAILABLE'), [A]);
});
test('new contact: no historical NFSe', async () => {
    const f = fixture(); setEmails(f, A); await f.ready('nfse'); setEmails(f, `${A};${B}`); await f.service.scan();
    assert.deepEqual(of(f, 'NFSE_AVAILABLE'), [A]);
});
test('new contact: no historical payment confirmation', async () => {
    const f = fixture(); setEmails(f, A); await f.ready(); f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago';
    await f.service.scan(); await f.service.scan(); assert.deepEqual(of(f, 'BOLETO_PAYMENT_RECORDED'), [A]);
    setEmails(f, `${A};${B}`); await f.service.scan();
    assert.deepEqual(of(f, 'BOLETO_PAYMENT_RECORDED'), [A]);
});
test('new contact: skips the occurrence already formed today, joins the next ones', async () => {
    const f = fixture(); setEmails(f, A); await f.ready(); f.setNow('2026-11-05T12:00:00Z'); await f.service.scan();
    setEmails(f, `${A};${B}`); await f.service.scan();
    assert.deepEqual(of(f, 'BOLETO_D_MINUS_1'), [A]);
    f.setNow('2026-11-06T12:00:00Z'); await f.service.scan();
    assert.deepEqual(of(f, 'BOLETO_DUE_TODAY'), [A, B]);
    f.setNow('2026-11-11T12:00:00Z'); await f.service.scan();
    assert.deepEqual(of(f, 'BOLETO_OVERDUE_REMINDER'), [A, B]);
    assert.deepEqual(of(f, 'BOLETO_AVAILABLE'), [A]);
});
test('new contact: receives a document first seen after being added', async () => {
    const f = fixture(); setEmails(f, A); await f.ready(); setEmails(f, `${A};${B}`); await f.service.scan();
    f.attach('nfse'); await f.service.scan();
    assert.deepEqual(of(f, 'NFSE_AVAILABLE'), [A, B]); assert.deepEqual(of(f, 'BOLETO_AVAILABLE'), [A]);
});
test('contact added before the document is detected is part of that occurrence', async () => {
    const f = fixture(); setEmails(f, A); await f.service.scan(); setEmails(f, `${A};${B}`); f.attach('boleto'); await f.service.scan();
    assert.deepEqual(of(f, 'BOLETO_AVAILABLE'), [A, B]);
});
test('removing and re-adding an address does not resend', async () => {
    const f = fixture(); setEmails(f, `${A};${B}`); await f.ready(); const count = f.events().length;
    setEmails(f, A); await f.service.scan(); setEmails(f, `${A};${B}`); await f.service.scan();
    assert.equal(f.events().length, count);
});
test('per-day audiences are discarded and do not grow with time', async () => {
    const f = fixture(); await f.ready();
    for (let day = 11; day <= 30; day += 5) { f.setNow(`2026-11-${day}T12:00:00Z`); await f.service.scan(); }
    const keys = Object.keys(f.store.data.states.get(f.ids.invoice).audiences);
    assert.equal(keys.length, 2, 'availability plus the occurrence of today');
});

test('API failure on authorization: no send, intent stays retryable', async () => {
    const f = fixture(); const e = await f.ready(); const g = f.airtable.obterRegistro;
    f.airtable.obterRegistro = async () => { throw new Error('network offline'); };
    await assert.rejects(f.service.validate(e.payload));
    await worker(f).deliver(e); assert.equal(f.store.data.events.get(e.payload.eventId).status, 'retry');
    f.airtable.obterRegistro = g;
});
test('API failure listing clients on authorization: no send', async () => {
    const f = fixture(); const e = await f.ready(); const l = f.airtable.listarRegistros;
    f.airtable.listarRegistros = async () => { throw new Error('network offline'); };
    await assert.rejects(f.service.validate(e.payload));
    await worker(f).deliver(e); assert.equal(f.store.data.events.get(e.payload.eventId).status, 'retry');
    f.airtable.listarRegistros = l;
});
test('client record gone (404): denied and never sent', async () => {
    const f = fixture(); const e = await f.ready(); const g = f.airtable.obterRegistro;
    f.airtable.obterRegistro = async (table, id) => table === S.TABELAS.CLIENTES ? null : g(table, id);
    await worker(f).deliver(e); assert.equal(f.store.data.events.get(e.payload.eventId).status, 'cancelled');
});
test('API failure during a scan does not invent or remove recipients', async () => {
    const f = fixture(); setEmails(f, `${A};${B}`); const e = await f.ready(); const l = f.airtable.listarRegistros;
    f.airtable.listarRegistros = async () => { throw new Error('network offline'); };
    await assert.rejects(f.service.scan());
    assert.equal(f.store.data.events.get(e.payload.eventId).status, 'pending');
});

test('idempotence: order, case and spacing of the cell change nothing', async () => {
    const f = fixture(); setEmails(f, `${A};${B}`); await f.ready();
    const ids = f.events().map(e => e.payload.eventId).sort();
    for (const value of [`${B};${A}`, ` ${A.toUpperCase()} ;${B};`, `${A};${A};${B}`]) { setEmails(f, value); await f.service.scan(); }
    assert.deepEqual(f.events().map(e => e.payload.eventId).sort(), ids);
    assert.ok(f.events().every(e => e.status === 'pending'), 'equivalent edits do not cancel');
});
test('idempotence: event identity and payload keep the contract shape', async () => {
    const f = fixture(); const e = await f.ready();
    assert.equal(e.payload.eventId, eventId(e.payload)); assert.equal(valid(e.payload), true);
    assert.ok(!('grants' in e.payload) && !('registered' in e.payload));
});
test('idempotence: a delivered recipient is not sent again on later scans', async () => {
    const f = fixture(); setEmails(f, `${A};${B}`); const e = await f.ready(); let calls = 0;
    await worker(f, async () => { calls++; return new Response(JSON.stringify({ ok: true, code: 'SENT', eventId: e.payload.eventId })); }).deliver(e);
    await f.service.scan(); await worker(f).deliver(f.store.data.events.get(e.payload.eventId));
    assert.equal(calls, 1); assert.equal(f.store.data.events.get(e.payload.eventId).status, 'sent');
});
test('persisted state from the previous format keeps working', async () => {
    const f = fixture(); const e = await f.ready(); const state = f.store.data.states.get(f.ids.invoice);
    delete state.audiences; state.snapshot.grants = [{ id: 'x' }];
    await f.service.scan();
    assert.equal(f.store.data.events.get(e.payload.eventId).status, 'pending');
    await f.service.validate(e.payload);
});

test('E2E with the real receiver: each address gets its own message; a removed one gets none', { skip: !available }, async t => {
    const { createReceiver, ROUTE } = require(path.join(notifications, 'billing/receiver.js'));
    const f = fixture(); setEmails(f, `${A}; ${B} ;${C}`); await f.ready();
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
    setEmails(f, `${A};${B}`);
    for (const e of f.events()) await w.deliver(e);
    assert.deepEqual(sent.map(s => s.event.recipient).sort(), [A, B]);
    assert.ok(sent.every(s => s.access.recipient === s.event.recipient));
    for (const e of f.events()) await w.deliver(e);
    assert.equal(sent.length, 2);
    assert.equal(of(f, 'BOLETO_AVAILABLE').length, 3);
    assert.equal(f.events().find(e => e.payload.recipient === C).status, 'cancelled');
});

test('no functional dependency on the parallel table; migration 006 is preserved', () => {
    const dir = path.join(__dirname, '../lib/billing');
    for (const file of fs.readdirSync(dir)) assert.doesNotMatch(fs.readFileSync(path.join(dir, file), 'utf8'), /portal_billing_grants|grantFor|\.grants\b/, file);
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../scripts/billing-local.js'), 'utf8'), /grants/);
    const sql = fs.readFileSync(path.join(__dirname, '../migrations/006_billing_automation.sql'), 'utf8');
    assert.match(sql, /CREATE TABLE IF NOT EXISTS portal_billing_grants/); assert.doesNotMatch(sql, /DROP|TRUNCATE|DELETE/i);
});
test('a grant evidence can no longer be created', () => {
    const f = fixture();
    assert.throws(() => validateEvidence({ type: 'grant', clientId: f.ids.client, cnpj: '12345678000195', evidenceHash: 'a'.repeat(64), validFrom: 1, validUntil: 2, revoked: false, recipient: A, authorized: true }, f.store.cipher), /EVIDENCE_TYPE_INVALID/);
});
test('D2 still pending: a registered address without document attestation sends nothing', async () => {
    const f = fixture(); await f.service.scan(); f.attach('boleto'); f.store.data.documents.clear(); await f.service.scan();
    assert.equal(f.events().length, 0); assert.ok(f.store.data.audit.some(a => a.code === 'DOCUMENT_UNVERIFIED'));
});
test('financial flags stay off by default', () => {
    assert.deepEqual(configuration({}), { enabled: false, worker: false });
});
test('shared emails() keeps the behavior of the legacy flows', () => {
    assert.deepEqual(emails(`${A},${B}\n${C};${A}`), [A, B, C]);
});
