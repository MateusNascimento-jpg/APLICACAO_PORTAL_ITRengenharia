'use strict';
// Incremento 1: regressões dos defeitos A1, A3, A4, A5, A7, M1, M4 e M5 da auditoria.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { fixture, S } = require('./helpers/billing-fixtures');
const { createWorker } = require('../lib/billing/worker');
const { register } = require('../lib/billing/routes');
const N = S.NOTAS_FISCAIS;
const cfg = { enabled: true, worker: true, origin: 'https://notifications.example.test', secret: Buffer.alloc(32, 3).toString('base64') };
const worker = (f, fetcher) => createWorker({ config: cfg, store: f.store, service: f.service, clock: f.clock, fetcher, random: () => 0 });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const find = (f, type) => f.events().find(e => e.payload.type === type);
const notifications = process.env.BILLING_NOTIFICATIONS_REPO || path.resolve(__dirname, '../../Emails_diarios_ITRengenharia');
const available = fs.existsSync(path.join(notifications, 'billing/receiver.js'));

// A1: uma alteração sem relação com a intenção não pode perdê-la.
test('A1: status change keeps pending availability deliverable', async () => {
    const f = fixture(); const e = await f.ready();
    f.invoice.fields[N.STATUS_PAGAMENTO] = 'A Vencer'; await f.service.scan();
    assert.equal(find(f, 'BOLETO_AVAILABLE').status, 'pending');
    await f.service.validate(e.payload);
});
test('A1: NFSe attached after the boleto does not cancel the boleto, and vice versa', async () => {
    const f = fixture(); await f.ready(); f.attach('nfse'); await f.service.scan();
    assert.equal(find(f, 'BOLETO_AVAILABLE').status, 'pending');
    assert.equal(find(f, 'NFSE_AVAILABLE').status, 'pending');
    await f.service.validate(find(f, 'BOLETO_AVAILABLE').payload);
    await f.service.validate(find(f, 'NFSE_AVAILABLE').payload);
});
test('A1: a new address does not cancel the intent of the current one, nor receive it', async () => {
    const f = fixture(); const e = await f.ready(); const field = require('../lib/billing/source').CLIENT_EMAIL;
    f.client.fields[field] += ';second@example.test'; await f.service.scan();
    assert.equal(f.store.data.events.get(e.payload.eventId).status, 'pending');
    assert.equal(f.events().length, 1);
});
test('A1: material changes still cancel, and live checks still deny', async () => {
    const material = fixture(); const a = await material.ready();
    material.contract.fields[S.CONTRATOS.NOME] = 'C-OUTRO'; await material.service.scan();
    assert.equal(material.store.data.events.get(a.payload.eventId).status, 'cancelled');
    const revoked = fixture(); const b = await revoked.ready();
    revoked.client.fields[require('../lib/billing/source').CLIENT_EMAIL] = 'other@example.test';
    await assert.rejects(revoked.service.validate(b.payload), /RECIPIENT_UNAUTHORIZED/);
    const unaccepted = fixture(); const c = await unaccepted.ready();
    unaccepted.proposal.fields[S.PROPOSTA.STATUS] = 'Enviada';
    await assert.rejects(unaccepted.service.validate(c.payload), /STATUS_INELIGIBLE/);
});

// A3: sem confirmação de transporte, o mesmo evento volta a ser tentado.
test('A3: connection refused retries with long backoff, then delivers', async () => {
    const f = fixture(); const e = await f.ready(); let calls = 0;
    const w = worker(f, async () => {
        if (++calls === 1) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
        return json({ ok: true, code: 'SENT', eventId: e.payload.eventId });
    });
    await w.deliver(e);
    let current = f.store.data.events.get(e.payload.eventId);
    assert.equal(current.status, 'retry'); assert.equal(current.reason, 'HTTP_TRANSPORT');
    assert.ok(current.nextAt - f.clock() >= 60000, 'backoff suitable for a restart');
    await w.deliver(current); assert.equal(calls, 1, 'backoff respected');
    f.setNow(f.clock() + 3600000); await w.deliver(current); assert.equal(calls, 2);
    assert.equal(f.store.data.events.get(e.payload.eventId).status, 'sent');
});
test('A3: an outage of many hours stays retryable and is bounded', async () => {
    const f = fixture(); await f.service.scan(); f.attach('nfse'); await f.service.scan();
    const id = f.events()[0].payload.eventId;
    const w = worker(f, async () => { throw new TypeError('fetch failed'); });
    let tries = 0;
    for (; tries < 40 && ['pending', 'retry'].includes(f.store.data.events.get(id).status); tries++) {
        await w.deliver(f.store.data.events.get(id)); f.setNow(f.clock() + 3600000);
    }
    assert.equal(f.store.data.events.get(id).status, 'blocked');
    assert.equal(f.store.data.events.get(id).reason, 'RETRY_EXHAUSTED');
    assert.ok(tries > 8, 'more budget than known pre-SMTP refusals');
});
test('A3: gateway HTML and missing route retry; a malformed 200 stays uncertain', async t => {
    for (const [name, response, status] of [
        ['502 HTML', () => new Response('<html>', { status: 502 }), 'retry'],
        ['404 route', () => json({ error: 'not found' }, 404), 'retry'],
        ['200 malformed', () => json({}), 'uncertain']
    ]) await t.test(name, async () => {
        const f = fixture(); const e = await f.ready();
        await worker(f, async () => response()).deliver(e);
        assert.equal(f.store.data.events.get(e.payload.eventId).status, status);
    });
});
test('A3: HTTP 401 is recoverable and logs only a code', async t => {
    const f = fixture(); const e = await f.ready(); const warn = t.mock.method(console, 'warn', () => {});
    await worker(f, async () => json({ ok: false, code: 'UNAUTHORIZED' }, 401)).deliver(e);
    const current = f.store.data.events.get(e.payload.eventId);
    assert.equal(current.status, 'retry'); assert.equal(current.reason, 'AUTH_REJECTED');
    assert.deepEqual(warn.mock.calls.map(c => c.arguments[0]), ['[billing] AUTH_REJECTED']);
});
test('A3: 422 and DELIVERY_UNCERTAIN remain final', async () => {
    const invalid = fixture(); const a = await invalid.ready();
    await worker(invalid, async () => json({ code: 'INVALID_EVENT' }, 422)).deliver(a);
    assert.equal(invalid.store.data.events.get(a.payload.eventId).status, 'blocked');
    const unsure = fixture(); const b = await unsure.ready();
    await worker(unsure, async () => json({ code: 'DELIVERY_UNCERTAIN' }, 409)).deliver(b);
    assert.equal(unsure.store.data.events.get(b.payload.eventId).status, 'uncertain');
});

// A4: uma lease nunca derruba outros eventos da parcela nem sobrevive à prova de não envio.
async function leased(f, e) {
    const current = f.store.data.events.get(e.payload.eventId);
    current.status = 'sending'; current.attempts = 1; current.nextAt = f.clock() + 120000;
    await f.store.repo.saveEvent(current);
    await f.service.validate(e.payload, 'smtp');
}
test('A4: uncertain lease on one event does not block other events of the installment', async () => {
    const f = fixture(); const e = await f.ready(); await leased(f, e);
    f.attach('nfse'); await f.service.scan();
    const n = find(f, 'NFSE_AVAILABLE'); n.status = 'sending'; await f.store.repo.saveEvent(n);
    // Mesmo destinatário e prazo vigente: serializado até expirar.
    await assert.rejects(f.service.validate(n.payload, 'smtp'), /LEASE_BUSY/);
    f.setNow(f.clock() + 10000);
    const proof = await f.service.validate(n.payload, 'smtp');
    assert.match(proof.proof.leaseId, /^[a-f0-9]{64}$/);
});
test('A4: same event cannot obtain a second concurrent lease', async () => {
    const f = fixture(); const e = await f.ready(); await leased(f, e);
    f.setNow(f.clock() + 20000);
    await assert.rejects(f.service.validate(e.payload, 'smtp'), /LEASE_RECONCILIATION_REQUIRED/);
});
test('A4: receiver proof of no SMTP releases the lease and keeps the intent retryable', async t => {
    for (const [status, code, expected] of [[503, 'PORTAL_VALIDATION_FAILED', 'retry'], [503, 'BUSY', 'retry'], [409, 'OBSOLETE', 'cancelled'], [422, 'INVALID_EVENT', 'blocked']])
        await t.test(code, async () => {
            const f = fixture(); const e = await f.ready();
            await worker(f, async () => {
                await f.service.validate(e.payload, 'smtp');
                return json({ ok: false, code }, status);
            }).deliver(e);
            const current = f.store.data.events.get(e.payload.eventId);
            assert.equal(current.status, expected); assert.equal(current.leaseId, null);
            assert.deepEqual(f.store.data.states.get(f.ids.invoice).leases, []);
        });
});
test('A4: storage failure, lost ack and DELIVERY_UNCERTAIN are not proof and keep the lease', async t => {
    for (const [name, respond, expected] of [
        ['STORAGE_UNAVAILABLE', () => json({ code: 'STORAGE_UNAVAILABLE' }, 503), 'retry'],
        ['lost ack', () => { throw new TypeError('socket hang up'); }, 'retry'],
        ['DELIVERY_UNCERTAIN', () => json({ code: 'DELIVERY_UNCERTAIN' }, 409), 'uncertain']
    ]) await t.test(name, async () => {
        const f = fixture(); const e = await f.ready();
        await worker(f, async () => { await f.service.validate(e.payload, 'smtp'); return respond(); }).deliver(e);
        const current = f.store.data.events.get(e.payload.eventId);
        assert.equal(current.status, expected); assert.match(current.leaseId, /^[a-f0-9]{64}$/);
        assert.equal(f.store.data.states.get(f.ids.invoice).leases.length, 1);
    });
});
test('A4: an obsolete event holding a lease ends uncertain, never silently cancelled', async () => {
    const f = fixture(); await f.ready(); f.setNow('2026-11-05T12:00:00Z'); await f.service.scan();
    const e = find(f, 'BOLETO_D_MINUS_1');
    await worker(f, async () => { await f.service.validate(e.payload, 'smtp'); throw new TypeError('socket hang up'); }).deliver(e);
    assert.equal(f.store.data.events.get(e.payload.eventId).status, 'retry');
    f.setNow('2026-11-06T12:00:00Z');
    await worker(f, async () => { throw new Error('must not send'); }).deliver(f.store.data.events.get(e.payload.eventId));
    assert.equal(f.store.data.events.get(e.payload.eventId).status, 'uncertain');
});

// Integração: receptor real sobre disco temporário e SMTP injetado.
function realReceiver(t, f, overrides = {}) {
    const { createReceiver, ROUTE } = require(path.join(notifications, 'billing/receiver.js'));
    const app = express(); register(app, express, { config: cfg, store: f.store, service: f.service, clock: f.clock });
    const srv = app.listen(0, '127.0.0.1');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'itr-billing-test-'));
    t.after(async () => { await new Promise(resolve => { srv.closeAllConnections(); srv.close(resolve); }); fs.rmSync(directory, { recursive: true, force: true }); });
    const sent = [];
    const receiver = createReceiver({ config: { enabled: true, secret: cfg.secret, origin: 'https://portal.example.test', directory }, clock: f.clock,
        fetcher: overrides.portalFetcher ? overrides.portalFetcher(srv) : (url, options) => fetch(`http://127.0.0.1:${srv.address().port}${new URL(url).pathname}`, options),
        send: overrides.send || (async args => { sent.push(args); return { ok: true }; }) });
    const handle = async options => {
        const r = await receiver.handle({ method: 'POST', path: ROUTE, headers: options.headers }, Buffer.from(options.body));
        return json(r.body, r.status);
    };
    return { sent, handle, listening: new Promise(resolve => srv.once('listening', resolve)) };
}
test('A3+A4 real receiver: ack lost after SMTP resolves as ALREADY_SENT with exactly one message', { skip: !available }, async t => {
    const f = fixture(); const e = await f.ready(); const r = realReceiver(t, f); await r.listening;
    let calls = 0;
    const w = worker(f, async (url, options) => {
        const response = await r.handle(options);
        if (++calls === 1) throw new TypeError('socket hang up');
        return response;
    });
    await w.deliver(e);
    assert.equal(f.store.data.events.get(e.payload.eventId).status, 'retry');
    f.setNow(f.clock() + 3600000);
    await w.deliver(f.store.data.events.get(e.payload.eventId));
    const current = f.store.data.events.get(e.payload.eventId);
    assert.equal(current.status, 'sent'); assert.equal(current.reason, 'ALREADY_SENT');
    assert.equal(r.sent.length, 1); assert.deepEqual(f.store.data.states.get(f.ids.invoice).leases, []);
});
test('A4 real receiver: proof lost after lease retries and sends exactly once', { skip: !available }, async t => {
    const f = fixture(); const e = await f.ready(); let drop = true;
    const r = realReceiver(t, f, { portalFetcher: srv => async (url, options) => {
        const response = await fetch(`http://127.0.0.1:${srv.address().port}${new URL(url).pathname}`, options);
        if (drop && options.method === 'POST' && JSON.parse(options.body).phase === 'smtp') { drop = false; await response.text(); throw new TypeError('proof lost'); }
        return response;
    } });
    await r.listening;
    const w = worker(f, async (url, options) => r.handle(options));
    await w.deliver(e);
    assert.equal(f.store.data.events.get(e.payload.eventId).status, 'retry');
    assert.equal(f.store.data.events.get(e.payload.eventId).leaseId, null);
    f.setNow(f.clock() + 3600000);
    await w.deliver(f.store.data.events.get(e.payload.eventId));
    assert.equal(f.store.data.events.get(e.payload.eventId).status, 'sent'); assert.equal(r.sent.length, 1);
});
test('A4 real receiver: SMTP failure stays uncertain and does not resend', { skip: !available }, async t => {
    const f = fixture(); const e = await f.ready(); let smtp = 0;
    const r = realReceiver(t, f, { send: async () => { smtp++; throw new Error('smtp down'); } }); await r.listening;
    const w = worker(f, async (url, options) => r.handle(options));
    await w.deliver(e); f.setNow(f.clock() + 3600000); await w.deliver(f.store.data.events.get(e.payload.eventId));
    assert.equal(f.store.data.events.get(e.payload.eventId).status, 'uncertain'); assert.equal(smtp, 1);
});

// A5: registro inconsistente fica em quarentena, sem impedir os demais.
function secondInvoice(f, id = 'recYYYYYYYYYYYYYY', createdTime = '2020-01-01T00:00:00Z') {
    const record = { id, createdTime, fields: {} };
    f.tables[S.TABELAS.NOTAS_FISCAIS].push(record); return record;
}
function makeValid(f, record) {
    Object.assign(record.fields, structuredClone(f.invoice.fields));
    if (!f.contract.fields[S.CONTRATOS.PARCELAS].includes(record.id)) f.contract.fields[S.CONTRATOS.PARCELAS].push(record.id);
}
test('A5: an invalid invoice is quarantined and the baseline completes without retroactive messages', async () => {
    const f = fixture(); const bad = secondInvoice(f); await f.service.scan();
    assert.equal(f.store.data.meta.count, 1); assert.equal(f.store.data.meta.quarantined, 1);
    assert.ok(f.store.data.audit.some(a => a.subject === bad.id && a.code === 'CHAIN_INVALID'));
    // Corrigida depois, com documento: entra na linha de base, sem envio retroativo.
    f.attach('boleto'); await f.service.scan(); const before = f.events().length;
    makeValid(f, bad); await f.service.scan();
    assert.ok(f.store.data.states.has(bad.id));
    assert.equal(f.events().filter(e => e.payload.invoiceId === bad.id).length, 0); assert.equal(f.events().length, before);
});
test('A5: invoice with two attachments is baselined, without blocking and without a retroactive message', async () => {
    const f = fixture(); f.attach('nfse');
    f.invoice.fields[N.NFSE].push({ ...f.invoice.fields[N.NFSE][0], id: 'attGGGGGGGGGGGGGG' });
    await f.service.scan();
    assert.ok(f.store.data.meta); assert.ok(f.store.data.audit.some(a => a.code === 'DOCUMENT_AMBIGUOUS'));
    f.invoice.fields[N.NFSE].pop(); await f.service.scan();
    assert.equal(f.events().length, 0);
});
test('A5: a transient failure on any record still aborts the whole baseline', async () => {
    const f = fixture(); f.attach('boleto'); secondInvoice(f); const reader = f.pdfs.boleto;
    Object.defineProperty(f.pdfs, 'boleto', { configurable: true, get() { throw new Error('network offline'); } });
    await assert.rejects(f.service.scan()); assert.equal(f.store.data.meta, null); assert.equal(f.store.data.states.size, 0);
    Object.defineProperty(f.pdfs, 'boleto', { configurable: true, writable: true, value: reader });
    await f.service.scan(); assert.ok(f.store.data.meta);
});
test('A5: a commit failure leaves no partial baseline or quarantine', async () => {
    const f = fixture(); secondInvoice(f); f.store.failCommit(true);
    await assert.rejects(f.service.scan());
    assert.equal(f.store.data.meta, null); assert.equal(f.store.data.audit.length, 0);
});
test('A5: an invoice created after the cutoff is still armed after its chain is fixed', async () => {
    const f = fixture(); await f.service.scan();
    const late = secondInvoice(f, 'recXXXXXXXXXXXXXX', '2026-11-04T12:30:00Z');
    f.setNow('2026-11-04T13:00:00Z'); await f.service.scan();
    assert.ok(!f.store.data.states.has(late.id));
    makeValid(f, late); late.fields[N.BOLETO] = [{ id: f.ids.boleto, type: 'application/pdf', size: f.pdfs.boleto.length, url: 'https://v5.airtableusercontent.com/boleto' }];
    await f.service.scan();
    assert.deepEqual(f.events().filter(e => e.payload.invoiceId === late.id).map(e => e.payload.type), ['BOLETO_AVAILABLE']);
});

// A7: a prova mede o frescor a partir do fim da leitura, não do início.
test('A7: checkedAt is taken after the source read and the receiver window starts there', async () => {
    const f = fixture(); const e = await f.ready(); const start = f.clock(); const get = f.airtable.obterRegistro;
    f.airtable.obterRegistro = async (...args) => { f.setNow(f.clock() + 1000); return get(...args); };
    const { proof } = await f.service.validate(e.payload);
    assert.equal(proof.checkedAt, start + 4000); assert.equal(proof.expiresAt, start + 13000);
});
test('A7: a read above the budget is still refused', async () => {
    const f = fixture(); const e = await f.ready(); const get = f.airtable.obterRegistro;
    f.airtable.obterRegistro = async (...args) => { f.setNow(f.clock() + 1200); return get(...args); };
    await assert.rejects(f.service.validate(e.payload), /SOURCE_TOO_SLOW/);
});

// M1
test('M1: new invoice with an attachment error is armed once the attachment is fixed', async () => {
    const f = fixture(); await f.service.scan();
    const late = secondInvoice(f, 'recXXXXXXXXXXXXXX', '2026-11-04T12:30:00Z'); makeValid(f, late);
    late.fields[N.BOLETO] = [{ id: f.ids.boleto, type: 'application/pdf', size: 1, url: 'https://v5.airtableusercontent.com/boleto' }];
    f.setNow('2026-11-04T13:00:00Z'); await f.service.scan();
    assert.equal(f.store.data.states.get(late.id).seen.boleto, false);
    late.fields[N.BOLETO][0].size = f.pdfs.boleto.length; await f.service.scan();
    assert.deepEqual(f.events().filter(e => e.payload.invoiceId === late.id).map(e => e.payload.type), ['BOLETO_AVAILABLE']);
});
test('M1: an old invoice with an attachment error stays silent after the fix', async () => {
    const f = fixture(); await f.service.scan();
    const old = secondInvoice(f); makeValid(f, old);
    old.fields[N.BOLETO] = [{ id: f.ids.boleto, type: 'application/pdf', size: 1, url: 'https://v5.airtableusercontent.com/boleto' }];
    await f.service.scan();
    old.fields[N.BOLETO][0].size = f.pdfs.boleto.length; await f.service.scan();
    assert.equal(f.events().filter(e => e.payload.invoiceId === old.id).length, 0);
});

// M4
test('M4: repeated denial is audited once a day per subject and code', async () => {
    const f = fixture(); await f.service.scan(); f.attach('nfse'); f.proposal.fields[S.PROPOSTA.STATUS] = 'Enviada'; f.setNow('2026-11-05T12:00:00Z');
    const count = () => f.store.data.audit.filter(a => a.code === 'STATUS_INELIGIBLE').length;
    for (let i = 0; i < 10; i++) await f.service.scan();
    assert.equal(count(), 1);
    f.setNow(f.clock() + 86400000 + 1); await f.service.scan();
    assert.equal(count(), 2);
});
test('M4: quarantined invoice does not repeat its audit on every scan', async () => {
    const f = fixture(); const bad = secondInvoice(f); await f.service.scan();
    for (let i = 0; i < 5; i++) await f.service.scan();
    assert.equal(f.store.data.audit.filter(a => a.subject === bad.id && a.code === 'CHAIN_INVALID').length, 1);
});
test('M4: delivery and lifecycle audit codes are not deduplicated', async () => {
    const f = fixture(); const e = await f.ready();
    await worker(f, async () => json({ code: 'BUSY' }, 503)).deliver(e);
    f.setNow(f.clock() + 10000);
    await worker(f, async () => json({ code: 'BUSY' }, 503)).deliver(f.store.data.events.get(e.payload.eventId));
    assert.equal(f.store.data.audit.filter(a => a.code === 'HTTP_ATTEMPT').length, 2);
});

// M5
test('M5: scan stops between invoices when asked', async () => {
    const f = fixture(); await f.service.scan();
    const second = secondInvoice(f, 'recXXXXXXXXXXXXXX'); makeValid(f, second);
    let checks = 0;
    const result = await f.service.scan({ shouldStop: () => ++checks > 1 });
    assert.equal(result.stopped, true); assert.ok(!f.store.data.states.has(second.id));
});
test('M5: stopping during the baseline commits nothing', async () => {
    const f = fixture(); const result = await f.service.scan({ shouldStop: () => true });
    assert.equal(result.stopped, true); assert.equal(f.store.data.meta, null);
});
test('M5: worker stop interrupts the running scan and skips delivery', async () => {
    let signal; const delivered = [];
    const store = { due: async () => { delivered.push('due'); return []; } };
    const service = { async scan(options) { signal = options?.shouldStop; await new Promise(resolve => setImmediate(resolve)); return { stopped: true }; } };
    const w = createWorker({ config: cfg, store, service, fetcher: async () => { throw new Error('must not send'); } });
    const running = w.tick(); await w.stop(); await running;
    assert.equal(signal?.(), true); assert.deepEqual(delivered, []);
});
