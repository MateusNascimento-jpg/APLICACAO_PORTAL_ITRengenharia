'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
Object.assign(process.env, {
    PORTAL_NOTIFICATIONS_URL: 'http://localhost:3999',
    PORTAL_NOTIFICATIONS_HMAC_SECRET: Buffer.alloc(32, 2).toString('base64'),
    NODE_ENV: 'test',
    AIRTABLE_TOKEN: 'fake',
    AIRTABLE_BASE_ID: 'appFake',
    DB_HOST: 'localhost',
    DB_USER: 'fake',
    DB_NAME: 'fake',
    PORTAL_SECURITY_PEPPER: Buffer.alloc(32, 1).toString('base64'),
    CLIENT_AUTH_MODE: 'generated',
});
let reports = false;
let proposals = false;
let proposalStatus = undefined;
let failed = false;
const calls = [];
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === './db') return { query: async () => [[], []] };
    if (request === './lib/sessions')
        return {
            loadSession: async (req) =>
                req.get('x-test-role')
                    ? {
                          role: req.get('x-test-role'),
                          documento: '12345678000190',
                          airtableId: 'recAAAAAAAAAAAAAA',
                      }
                    : null,
        };
    if (request === './airtable' && parent.filename.endsWith('server.js'))
        return {
            temTrabalhosAutorizados: async (id) => {
                calls.push(id);
                if (failed) throw Error('offline');
                return reports;
            },
        };
    if (request === './finance-airtable' && parent.filename.endsWith('server.js'))
        return {
            habilitado: () => true,
            listarPropostasPorCnpj: async (cnpj) => {
                calls.push(cnpj);
                return { propostas: proposals ? [{ id: 'recP', status: proposalStatus }] : [] };
            },
        };
    return realLoad.call(this, request, parent, isMain);
};
const { app } = require('../server');
Module._load = realLoad;

test('navegação: quatro cenários, sessão obrigatória, CNPJ da sessão e falha fechada', async (t) => {
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const get = (role = 'GeneratedClient') =>
        fetch(origin + '/api/navegacao?cnpj=99999999999999', { headers: { 'x-test-role': role } });
    for (const pair of [
        [true, false],
        [false, true],
        [true, true],
        [false, false],
    ]) {
        [proposals, reports] = pair;
        const response = await get();
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            sucesso: true,
            relatorios: reports,
            propostas: proposals,
            financeiro: false,
        });
    }
    // Financeiro: somente proposta com Status exatamente "Aceita" e conta real da empresa.
    proposals = true;
    for (const [status, role, esperado] of [
        ['Aceita', 'GeneratedClient', true],
        ['Aceita', 'Cliente', true],
        ['Aceita', 'DevViewer', false],
        ['Em Análise pelo Cliente', 'GeneratedClient', false],
        ['Rejeitada', 'GeneratedClient', false],
        ['aceita', 'GeneratedClient', false],
    ]) {
        proposalStatus = status;
        const response = await get(role);
        assert.equal(response.status, 200);
        assert.equal((await response.json()).financeiro, esperado, `${status}/${role}`);
    }
    assert.deepEqual([...new Set(calls)].sort(), ['12345678000190', 'recAAAAAAAAAAAAAA'].sort());
    assert.equal((await get('')).status, 401);
    assert.equal((await get('Director')).status, 403);
    failed = true;
    assert.equal((await get()).status, 503);
});
