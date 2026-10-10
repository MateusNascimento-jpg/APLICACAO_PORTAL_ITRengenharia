'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorker } = require('../lib/proposals/worker');
const { createSecrets } = require('../lib/proposals/crypto');
const { verify } = require('../lib/proposals/protocol');
const { memoryStore } = require('./helpers/proposals-memory');

test('outbox: perda de resposta repete mesmo ID; recibo idempotente evita segundo envio', async () => {
    const store = memoryStore();
    const secrets = createSecrets(Buffer.alloc(32, 4).toString('base64'));
    const secret = Buffer.alloc(32, 5).toString('base64');
    const payload = { eventId: 'a'.repeat(64), type: 'VERIFY' };
    const receipts = new Set();
    let sends = 0;
    let requests = 0;
    await store.enqueue({ id: payload.eventId, payload: secrets.seal(payload) });
    const worker = createWorker({
        store,
        secrets,
        secret,
        notificationUrl: 'https://notifications.example.test',
        service: { checkEvent: async () => {} },
        fetcher: async (url, options) => {
            requests++;
            assert.equal(url, 'https://notifications.example.test/internal/proposals/events');
            assert.equal(options.redirect, 'error');
            assert.equal(
                verify(secret, 'POST', '/internal/proposals/events', options.headers, options.body),
                true,
            );
            const body = JSON.parse(options.body);
            assert.equal(body.eventId, payload.eventId);
            if (!receipts.has(body.eventId)) {
                sends++;
                receipts.add(body.eventId);
            }
            if (requests === 1) throw Error('resposta perdida após o envio');
            return new Response(JSON.stringify({ ok: true, eventId: body.eventId }));
        },
    });
    await worker.deliver(payload.eventId);
    assert.equal(store.events.get(payload.eventId).status, 'pending');
    store.events.get(payload.eventId).next_at = 0;
    await Promise.all([worker.deliver(payload.eventId), worker.deliver(payload.eventId)]);
    assert.equal(store.events.get(payload.eventId).status, 'sent');
    assert.equal(sends, 1);
    assert.equal(requests, 2);
});

test('outbox: evento revogado é cancelado; resultado SMTP incerto fica para revisão', async () => {
    const store = memoryStore();
    const secrets = createSecrets(Buffer.alloc(32, 4).toString('base64'));
    let obsolete = true;
    let calls = 0;
    const worker = createWorker({
        store,
        secrets,
        secret: 'fixture',
        notificationUrl: 'https://notifications.example.test',
        service: {
            checkEvent: async () => {
                if (obsolete) throw Error('EVENT_OBSOLETE');
            },
        },
        fetcher: async () => {
            calls++;
            return new Response(JSON.stringify({ code: 'DELIVERY_UNCERTAIN' }), { status: 409 });
        },
    });
    for (const id of ['a'.repeat(64), 'b'.repeat(64)]) {
        await store.enqueue({ id, payload: secrets.seal({ eventId: id }) });
        await worker.deliver(id);
        assert.equal(store.events.get(id).status, obsolete ? 'cancelled' : 'uncertain');
        obsolete = false;
    }
    assert.equal(calls, 1);
});
