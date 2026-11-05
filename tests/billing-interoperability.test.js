'use strict';
const { UPDATE_SETTLE_MS } = require('../lib/billing/service');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const { fixture, S } = require('./helpers/billing-fixtures');
const { register } = require('../lib/billing/routes');
const { createWorker } = require('../lib/billing/worker');
const { canonical } = require('../lib/billing/protocol');
const { EVENTS } = require('../lib/billing/contract');
const notifications = process.env.BILLING_NOTIFICATIONS_REPO || path.resolve(__dirname, '../../Emails_diarios_ITRengenharia');
const available = fs.existsSync(path.join(notifications, 'billing/receiver.js'));
test('local corrected Notifications contract/protocol match byte-for-byte (D+5, never D+1)', { skip: !available && 'Set BILLING_NOTIFICATIONS_REPO to the corrected local checkout' }, () => {
    for (const file of ['contract.js', 'protocol.js']) assert.equal(fs.readFileSync(path.join(notifications, 'billing', file), 'utf8'), fs.readFileSync(path.join(__dirname, '../lib/billing', file), 'utf8'));
});
test('every end-to-end event type through actual local receiver and Portal HTTP; injected SMTP only', { skip: !available && 'Corrected Notifications checkout required' }, async t => {
    const { createReceiver, ROUTE } = require(path.join(notifications, 'billing/receiver.js'));
    for (const type of EVENTS) await t.test(type, async t => {
        const f = fixture();
        await f.service.scan();
        f.attach(type === 'NFSE_AVAILABLE' ? 'nfse' : 'boleto'); await f.service.scan();
        if (/MINUS|TODAY|OVERDUE/.test(type)) await f.sent();
        if (type === 'BOLETO_D_MINUS_1') f.setNow('2026-11-05T12:00:00Z');
        if (type === 'BOLETO_DUE_TODAY') f.setNow('2026-11-06T12:00:00Z');
        if (type === 'BOLETO_OVERDUE_REMINDER') f.setNow('2026-11-11T12:00:00Z');
        if (type === 'BOLETO_PAYMENT_RECORDED') { f.invoice.fields[S.NOTAS_FISCAIS.STATUS_PAGAMENTO] = 'Pago'; await f.service.scan(); }
        if (type === 'BOLETO_UPDATED') {
            const first = f.events()[0]; first.status = 'sent'; first.attempts = 1; await f.store.repo.saveEvent(first);
            f.invoice.fields[S.NOTAS_FISCAIS.VALOR_PARCELA] = 1600; await f.service.scan(); f.setNow(f.clock() + UPDATE_SETTLE_MS);
        }
        await f.service.scan();
        const e = f.events().find(e => e.payload.type === type); assert.ok(e, type);
        const secret = Buffer.alloc(32, 3).toString('base64');
        const config = { enabled: true, worker: true, secret, origin: 'https://notifications.example.test' };
        const app = express(); register(app, express, { config, store: f.store, service: f.service, clock: f.clock });
        const srv = app.listen(0, '127.0.0.1'); await new Promise(resolve => srv.once('listening', resolve));
        const origin = 'http://127.0.0.1:' + srv.address().port;
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'itr-billing-test-'));
        t.after(async () => { await new Promise(resolve => { srv.closeAllConnections(); srv.close(resolve); }); fs.rmSync(directory, { recursive: true, force: true }); });
        const sent = [];
        const receiver = createReceiver({ config: { enabled: true, secret, origin: 'https://portal.example.test', directory }, clock: f.clock,
            fetcher: (url, options) => fetch(origin + new URL(url).pathname, options),
            send: async args => { sent.push(args); return { ok: true }; }
        });
        const fetcher = async (url, options) => {
            assert.equal(new URL(url).pathname, ROUTE);
            const result = await receiver.handle({ method: 'POST', path: ROUTE, headers: options.headers }, Buffer.from(options.body));
            return new Response(JSON.stringify(result.body), { status: result.status });
        };
        const w = createWorker({ config, store: f.store, service: f.service, clock: f.clock, fetcher });
        await w.deliver(e); assert.equal(f.events().find(x => x.payload.eventId === e.payload.eventId).status, 'sent');
        assert.equal(sent.length, 1); assert.equal(sent[0].access.cnpj, '12345678000195');
        assert.equal(sent[0].event.type, type);
        if (type === 'BOLETO_PAYMENT_RECORDED') assert.deepEqual(sent[0].pdfs, []);
        else {
            const kind = type === 'NFSE_AVAILABLE' ? 'nfse' : 'boleto';
            assert.deepEqual(sent[0].pdfs[0].content, f.pdfs[kind]);
        }
        await w.deliver(e); assert.equal(sent.length, 1);
        // Restart the real receiver: disk receipt suppresses SMTP independently of Portal's outbox.
        const restarted = createReceiver({ config: { enabled: true, secret, origin: 'https://portal.example.test', directory }, clock: f.clock,
            fetcher: () => { throw new Error('must not fetch'); }, send: () => { throw new Error('must not send'); } });
        const body = canonical(e.payload), h = require('../lib/billing/protocol').headers(secret, 'POST', ROUTE, body, f.clock());
        const result = await restarted.handle({ method: 'POST', path: ROUTE, headers: h }, Buffer.from(body));
        assert.equal(result.body.code, 'ALREADY_SENT');
        assert.ok(fs.readdirSync(directory).length > 0);
    });
});
