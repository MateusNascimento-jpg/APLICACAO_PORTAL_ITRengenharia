'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (name, parent, main) {
    if (name === './config' && parent.filename.endsWith('finance-airtable.js'))
        return {
            financeAirtable: { baseId: 'appTest', token: 'fake', retries: 3, timeoutMs: 1000 },
        };
    return originalLoad.call(this, name, parent, main);
};
const finance = require('../finance-airtable');
Module._load = originalLoad;
const id = 'recAAAAAAAAAAAAAA';
const client = 'recBBBBBBBBBBBBBB';

test('GET individual não envia fields[]; PDF exige o vínculo atual e nunca volta ao primeiro anexo', async (t) => {
    const originalFetch = global.fetch;
    const calls = [];
    let cnpj = '12345678000190';
    global.fetch = async (url, options) => {
        calls.push({ url, options });
        if (url.includes('tblTzY3Iggkhydke2'))
            return Response.json({
                id,
                fields: {
                    fldauuqhFbHn59uOl: [client],
                    fld2aWLikbuqsoOgZ: [
                        { id: 'attA', filename: 'original.pdf', url: 'https://dl.airtable.com/x' },
                    ],
                },
            });
        return Response.json({
            id: client,
            fields: { fldb8XcWv0Uooz3Uo: cnpj, fldtqo76edbzzQcNz: 'a@example.test' },
        });
    };
    t.after(() => {
        global.fetch = originalFetch;
    });
    const doc = await finance.obterDocumentoProposta(cnpj, id, 'attA');
    assert.equal(doc.nome, 'original.pdf');
    assert.ok(calls.every((call) => !new URL(call.url).searchParams.has('fields[]')));
    assert.equal(await finance.obterDocumentoProposta(cnpj, id, 'removed'), null);
    cnpj = '99999999000199';
    await assert.rejects(
        finance.obterDocumentoProposta('12345678000190', id, 'attA'),
        /PROPOSAL_NOT_FOUND/,
    );
});

test('PATCH status + Feedback1 em uma chamada; timeout de escrita não é repetido', async (t) => {
    const originalFetch = global.fetch;
    let calls = 0;
    let body;
    t.after(() => {
        global.fetch = originalFetch;
    });
    global.fetch = async (_, options) => {
        calls++;
        body = JSON.parse(options.body);
        throw new Error('timeout');
    };
    await assert.rejects(
        finance.atualizarDecisao(id, 'Rejeitada', 'Motivo obrigatório'),
        /timeout/,
    );
    assert.equal(calls, 1);
    assert.deepEqual(body.fields, {
        fldTvIRySPUEG2Mwf: 'Rejeitada',
        fldFMHkwowNMiiPpX: 'Motivo obrigatório',
    });
});
