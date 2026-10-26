'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { registerRoutes } = require('../lib/proposals/routes');
const { createSecrets } = require('../lib/proposals/crypto');

// Exercise actual route middleware composition without connecting to production dependencies.
test('HTTP: DevViewer não solicita nem rejeita; cliente exige CSRF; confirmação tem cookie isolado', async (t) => {
    const app = express();
    app.use(express.json());
    const calls = [];
    const next = (_, __, done) => done();
    const auth = (req, res, done) => {
        if (!req.get('x-test-role')) return res.sendStatus(401);
        req.session = { role: req.get('x-test-role'), documento: '12345678000190' };
        done();
    };
    const csrf = (req, res, done) =>
        req.get('x-csrf-token') === 'fixture' ? done() : res.sendStatus(403);
    registerRoutes(app, {
        config: { production: false, notifications: { secret: '' } },
        store: {},
        secrets: createSecrets(Buffer.alloc(32, 5).toString('base64')),
        worker: { wake() {} },
        auth,
        client: next,
        csrf,
        origin: next,
        write: next,
        consume: async () => ({ ok: true }),
        audit: async () => {},
        service: {
            // Contrato real de service.request: nunca devolve o código ao navegador.
            request: async (...args) => {
                calls.push(args);
                return { expiresAt: Date.now() + 7200000, recipientsCount: 1 };
            },
            reject: async (...args) => {
                calls.push(args);
                return { status: 'Rejeitada' };
            },
            open: async () => ({
                cookie: 'encrypted',
                csrf: 'limited',
                expiresAt: Date.now() + 7200000,
            }),
        },
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const post = (route, role, token) =>
        fetch(origin + route, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-test-role': role,
                'x-csrf-token': token || '',
            },
            body: '{}',
        });
    for (const route of [
        '/api/propostas/recAAAAAAAAAAAAAA/aceite/solicitar',
        '/api/propostas/recAAAAAAAAAAAAAA/rejeitar',
    ]) {
        assert.equal((await post(route, 'DevViewer', 'fixture')).status, 403);
        assert.equal((await post(route, 'GeneratedClient', '')).status, 403);
        const ok = await post(route, 'GeneratedClient', 'fixture');
        assert.equal(ok.status, 200);
        assert.equal((await ok.json()).code, undefined);
    }
    assert.equal(calls.length, 2);
    const response = await post('/api/propostas/confirmacao/abrir', '', '');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie'), /HttpOnly/);
    assert.match(response.headers.get('set-cookie'), /SameSite=Strict/);
    assert.match(response.headers.get('set-cookie'), /^itr_proposal=/);
    assert.doesNotMatch(await response.text(), /encrypted/);
});
