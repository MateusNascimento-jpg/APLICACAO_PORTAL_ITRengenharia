'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { fixture, S } = require('./helpers/billing-fixtures');
const { register, AUTH } = require('../lib/billing/routes');
const { headers, verify, hash, canonical } = require('../lib/billing/protocol');
const { eventId } = require('../lib/billing/contract');
const secret = Buffer.alloc(32, 3).toString('base64');
async function serverFor(t, f, enabled = true) {
    const app = express(); register(app, express, { config: { enabled, secret }, store: f.store, service: f.service, clock: f.clock });
    app.use(express.json());
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const origin = 'http://127.0.0.1:' + server.address().port;
    return { origin, async auth(event, phase = 'prepare', override = {}) {
        const body = canonical({ event, phase }); const signed = headers(secret, 'POST', AUTH, body, f.clock());
        const r = await fetch(origin + AUTH, { method: 'POST', body, headers: { ...signed, ...override } });
        return { r, signed, raw: await r.text() };
    } };
}
test('signed prepare + PDF + serialized SMTP lease, access is authoritative and digest-bound', async t => {
    const f = fixture(), e = await f.ready(), s = await serverFor(t, f);
    const a = await s.auth(e.payload); assert.equal(a.r.status, 200);
    assert.ok(verify(secret, 'RESPONSE', AUTH, Object.fromEntries(a.r.headers), a.raw, f.clock()));
    const p = JSON.parse(a.raw); assert.equal(p.requestNonce, a.signed['x-itr-nonce']);
    assert.equal(p.eventDigest, hash(canonical(e.payload))); assert.equal(p.access.cnpj, '12345678000195');
    assert.equal(p.access.recipient, e.payload.recipient); assert.equal(p.expiresAt - p.checkedAt, 9000);
    const path = `/internal/billing/v1/pdf/${e.payload.eventId}/${e.payload.document.id}`;
    const r = await fetch(s.origin + path, { headers: headers(secret, 'GET', path, '', f.clock()) });
    assert.equal(r.status, 200); assert.equal(r.headers.get('x-itr-document-version'), e.payload.document.version);
    assert.equal(r.headers.get('x-itr-client-id'), e.payload.clientId); assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), f.pdfs.boleto);
    assert.equal((await s.auth(e.payload, 'smtp')).r.status, 503);
    e.status = 'sending'; await f.store.repo.saveEvent(e);
    const smtp = await s.auth(e.payload, 'smtp'); assert.equal(smtp.r.status, 200); assert.match(JSON.parse(smtp.raw).leaseId, /^[a-f0-9]{64}$/);
    assert.equal((await s.auth(e.payload, 'smtp')).r.status, 503);
    f.setNow(f.clock() + 20000); assert.equal((await s.auth(e.payload, 'smtp')).r.status, 503, 'expired lease is not stolen');
});
test('invalid signature, nonce, expired timestamp, method, raw body and query are rejected; nonce survives restart', async t => {
    const f = fixture(), e = await f.ready(), s = await serverFor(t, f);
    for (const h of [{ 'x-itr-signature': '0'.repeat(64) }, { 'x-itr-nonce': 'invalid' }, { 'x-itr-timestamp': '1000000000' }])
        assert.equal((await s.auth(e.payload, 'prepare', h)).r.status, 401);
    const body = canonical({ event: e.payload, phase: 'prepare' }), signed = headers(secret, 'POST', AUTH, body, f.clock());
    const request = () => fetch(s.origin + AUTH, { method: 'POST', body, headers: signed });
    assert.equal((await request()).status, 200); assert.equal((await request()).status, 401);
    const restarted = await serverFor(t, f);
    assert.equal((await fetch(restarted.origin + AUTH, { method: 'POST', body, headers: signed })).status, 401);
    const badJson = '{'; const signedBad = headers(secret, 'POST', AUTH, badJson, f.clock());
    assert.equal((await fetch(s.origin + AUTH, { method: 'POST', body: badJson, headers: signedBad })).status, 503);
    assert.equal((await fetch(s.origin + AUTH, { method: 'POST', body: badJson, headers: signedBad })).status, 401);
    assert.equal((await fetch(s.origin + AUTH + '?x=1', { method: 'POST', body, headers: headers(secret, 'POST', AUTH, body, f.clock()) })).status, 401);
    assert.equal((await fetch(s.origin + AUTH, { method: 'POST', body: body + ' ', headers: headers(secret, 'POST', AUTH, body, f.clock()) })).status, 401);
    assert.equal((await fetch(s.origin + AUTH, { method: 'POST', body: 'x'.repeat(17000), headers: { 'content-type': 'application/json' } })).status, 413);
});
test('event substitution, unknown event, wrong attachment and other client never expose PDF or proof', async t => {
    const f = fixture(), e = await f.ready(), s = await serverFor(t, f);
    for (const patch of [{ recipient: 'another@example.test' }, { clientId: 'recZZZZZZZZZZZZZZ' }, { amountCents: 1 }, { stateVersion: 'a'.repeat(64) }]) {
        const forged = { ...e.payload, ...patch }; forged.eventId = eventId(forged);
        assert.equal((await s.auth(forged)).r.status, 503);
    }
    for (const path of [`/internal/billing/v1/pdf/${e.payload.eventId}/attZZZZZZZZZZZZZZ`, `/internal/billing/v1/pdf/${'a'.repeat(64)}/${e.payload.document.id}`])
        assert.equal((await fetch(s.origin + path, { headers: headers(secret, 'GET', path, '', f.clock()) })).status, 503);
    f.store.data.grants[0].revoked = true;
    const r = await s.auth(e.payload); assert.equal(r.r.status, 503); assert.doesNotMatch(r.raw, /cnpj|123456|financeiro|stack|sha256/);
});
test('payment between prepare and SMTP prevents lease and persists stop', async t => {
    const f = fixture(), e = await f.ready(), s = await serverFor(t, f);
    e.status = 'sending'; await f.store.repo.saveEvent(e);
    assert.equal((await s.auth(e.payload)).r.status, 200);
    f.invoice.fields[S.NOTAS_FISCAIS.STATUS_PAGAMENTO] = 'Pago';
    assert.equal((await s.auth(e.payload, 'smtp')).r.status, 503);
    assert.equal(f.store.data.states.get(f.ids.invoice).stopped, true); assert.deepEqual(f.store.data.states.get(f.ids.invoice).leases, []);
});
test('disabled routes do not access storage; budget is enforced', async t => {
    const f = fixture(), e = await f.ready(); const disabled = await serverFor(t, f, false);
    f.store.nonce = () => { throw new Error('must not run'); };
    assert.equal((await disabled.auth(e.payload)).r.status, 503);
    const active = await serverFor(t, f);
    let last;
    for (let i = 0; i < 121; i++) last = await active.auth(e.payload);
    assert.equal(last.r.status, 429);
});
