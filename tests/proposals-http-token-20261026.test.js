'use strict';

// Rotas reais do aceite sobre o serviço real (store em memória): 429 com
// Retry-After e corpo estruturado, estado para retomada e nenhuma resposta
// contendo o código. O rate limit persistente é emulado em memória com a
// mesma semântica de `untilWindowEnd`.

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { registerRoutes, waitText } = require('../lib/proposals/routes');
const { createService } = require('../lib/proposals/service');
const { createSecrets } = require('../lib/proposals/crypto');
const { createAuthorizedContacts } = require('../lib/proposals/authorized-contacts');
const { memoryStore } = require('./helpers/proposals-memory');

async function setup(t, { consume } = {}) {
    let clock = Date.now();
    const store = memoryStore();
    const secrets = createSecrets(Buffer.alloc(32, 4).toString('base64'));
    const proposal = {
        id: 'recAAAAAAAAAAAAAA', cnpj: '12345678000190', clienteId: 'recBBBBBBBBBBBBBB',
        numero: '55', status: 'Enviada', nomeCliente: 'Empresa', valor: 100, emails: ['compras@example.test'],
        anexos: [{ id: 'attAAAAAAAAAAAAAA', url: 'https://v5.airtableusercontent.com/x' }],
    };
    const service = createService({
        store, secrets, authorizedContacts: createAuthorizedContacts(), origin: 'https://p.example.test',
        enabled: () => true, now: () => clock,
        pdf: async () => ({ hash: secrets.hash('pdf'), bytes: Buffer.from('%PDF-') }),
        airtable: {
            async carregarPropostaAtual(id, cnpj) {
                if (id !== proposal.id || (cnpj && cnpj !== proposal.cnpj)) throw new Error('PROPOSAL_NOT_FOUND');
                return structuredClone(proposal);
            },
            async atualizarDecisao() {},
        },
    });
    const app = express();
    app.use(express.json());
    const next = (_, __, done) => done();
    registerRoutes(app, {
        config: { production: false, notifications: { secret: '' } }, store, secrets, service,
        worker: { wake() {} },
        auth: (req, res, done) => {
            req.session = { role: req.get('x-role') || 'GeneratedClient', documento: req.get('x-doc') || proposal.cnpj };
            done();
        },
        client: next, csrf: next, origin: next, write: next, audit: async () => {},
        consume: consume || (async () => ({ ok: true })),
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}/api/propostas/${proposal.id}`;
    const call = (path, body, headers = {}) => fetch(base + path, body === undefined ? { headers } : {
        method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    });
    return { store, secrets, proposal, call, advance: (ms) => { clock += ms; } };
}

test('formato do tempo restante', () => {
    assert.equal(waitText(1), '1 s');
    assert.equal(waitText(59000), '59 s');
    assert.equal(waitText(60000), '1 min 00 s');
    assert.equal(waitText(245000), '4 min 05 s');
    assert.equal(waitText(3600000), '60 min 00 s');
});

test('reenvio cedo responde 429 com Retry-After e tempo exato; estado retoma sem código', async (t) => {
    const s = await setup(t);
    const key = s.secrets.codeHash(s.proposal.id, 'compras@example.test');
    const first = await s.call('/aceite/solicitar', { recipientKey: key });
    assert.equal(first.status, 200);
    const body = await first.json();
    assert.equal(body.code, undefined);
    assert.equal(body.recipientLabel, 'co***@example.test');
    s.advance(15000);
    const early = await s.call('/aceite/solicitar', { recipientKey: key });
    assert.equal(early.status, 429);
    assert.equal(early.headers.get('retry-after'), '45');
    const denied = await early.json();
    assert.equal(denied.codigo, 'REQUEST_TOO_SOON');
    assert.equal(denied.retryAfterSeconds, 45);
    assert.match(denied.erro, /Tente novamente em 45 s\./);
    const status = await s.call('/aceite/estado');
    assert.equal(status.status, 200);
    const state = await status.json();
    assert.equal(state.challenge.recipientLabel, 'co***@example.test');
    assert.ok(Number.isFinite(state.now) && Number.isFinite(state.nextRequestAt));
    const verify = [...s.store.events.values()].map((e) => s.secrets.open(e.payload))[0];
    for (const text of [JSON.stringify(body), JSON.stringify(state), JSON.stringify(denied)])
        assert.ok(!text.includes(verify.code), 'código nunca volta ao navegador');
    assert.equal(s.store.challenges.size, 1);
});

test('limite persistente devolve tempo até o fim da janela; DevViewer e outro CNPJ isolados', async (t) => {
    const s = await setup(t, { consume: async (scope) =>
        scope === 'proposal-request-account' ? { ok: false, retryAfterMs: 754000 } : { ok: true } });
    const response = await s.call('/aceite/solicitar', { recipientKey: 'x' });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '754');
    const body = await response.json();
    assert.deepEqual([body.codigo, body.retryAfterSeconds], ['RATE_LIMITED', 754]);
    assert.match(body.erro, /Tente novamente em 12 min 34 s\./);
    assert.equal((await s.call('/aceite/estado', undefined, { 'x-role': 'DevViewer' })).status, 403);
    const other = await (await s.call('/aceite/estado', undefined, { 'x-doc': '99999999000199' })).json();
    assert.deepEqual([other.challenge, other.decision], [null, null]);
});
