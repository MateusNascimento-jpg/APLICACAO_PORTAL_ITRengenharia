'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const S = require('../lib/financeiro/schema');
const { createFinanceiroService } = require('../lib/financeiro/service');
const { registerFinanceiroRoutes } = require('../lib/financeiro/routes');
const { criarBaseFicticia, IDS, ANEXOS, CNPJ_A } = require('./helpers/financeiro-fixtures');

async function preparar(t) {
    const base = criarBaseFicticia();
    const service = createFinanceiroService({ airtable: base.airtable });
    const app = express();
    const consultasArquivo = [];
    registerFinanceiroRoutes(app, {
        service,
        airtable: base.airtable,
        auth(req, res, next) {
            req.session = { role: 'GeneratedClient', documento: CNPJ_A };
            req.requestId = 'integridade-ficticia';
            next();
        },
        client(req, res, next) { next(); },
        consume: async () => ({ ok: true }),
        audit() {},
        hmac: () => 'identidade-ficticia',
        logger: { warn() {}, error() {} },
        fetcher: async url => {
            consultasArquivo.push(url);
            return new Response('%PDF-1.4\n%%EOF\n', {
                headers: { 'content-type': 'application/pdf' },
            });
        },
    });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
    }));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const get = route => fetch(origin + route, { headers: { Accept: 'application/json' } });
    const documento = (tipo, registro, anexo) => get(`/api/financeiro/documentos/${tipo}/${registro}/${anexo}`);
    return { base, service, get, documento, consultasArquivo };
}

test('vínculo de outra proposta do mesmo CNPJ não autoriza contrato ou documentos', async t => {
    const { base, get, documento, consultasArquivo } = await preparar(t);
    base.registro(S.TABELAS.CONTRATOS, IDS.contA1).fields[S.CONTRATOS.PROPOSTA] = [IDS.propA2];
    const painel = await (await get('/api/financeiro')).json();
    assert.ok(!painel.contratos.some(c => c.id === IDS.contA1));
    assert.ok(painel.contratos.some(c => c.id === IDS.contA2), 'contrato coerente continua disponível');
    assert.ok(painel.pendencias.itensEmConferencia > 0);
    for (const args of [
        ['proposta', IDS.contA1, ANEXOS.propostaA2.id],
        ['nfse', IDS.nfA1, ANEXOS.nfseA1.id],
        ['boleto', IDS.nfA1, ANEXOS.boletoA1.id],
    ]) {
        const res = await documento(...args);
        assert.equal(res.status, 404);
        assert.equal((await res.json()).codigo, 'FINANCE_DOCUMENT_NOT_FOUND');
    }
    assert.equal(consultasArquivo.length, 0, 'nega antes de buscar bytes do arquivo');
});

test('uma proposta pode autorizar dois contratos com vínculos recíprocos coerentes', async t => {
    const { base, service } = await preparar(t);
    base.registro(S.TABELAS.PROPOSTA, IDS.propA1).fields[S.PROPOSTA.CONTRATOS] = [IDS.contA1, IDS.contA2];
    base.registro(S.TABELAS.PROPOSTA, IDS.propA2).fields[S.PROPOSTA.CONTRATOS] = [];
    base.registro(S.TABELAS.CONTRATOS, IDS.contA2).fields[S.CONTRATOS.PROPOSTA] = [IDS.propA1];
    const painel = await service.carregarPainel(CNPJ_A);
    assert.deepEqual(painel.contratos.map(c => c.id).sort(), [IDS.contA1, IDS.contA2].sort());
});

test('cancelamento ou status inválido revoga URLs antigas de NFSe e boleto', async t => {
    const { base, get, documento, consultasArquivo } = await preparar(t);
    assert.equal((await documento('nfse', IDS.nfA1, ANEXOS.nfseA1.id)).status, 200);
    consultasArquivo.length = 0;
    for (const status of ['Cancelado', 'Estado desconhecido', null]) {
        base.registro(S.TABELAS.NOTAS_FISCAIS, IDS.nfA1).fields[S.NOTAS_FISCAIS.STATUS_PAGAMENTO] = status;
        const painel = await (await get('/api/financeiro')).json();
        assert.ok(!painel.contratos.flatMap(c => c.documentos).some(d => d.registroId === IDS.nfA1));
        for (const [tipo, anexo] of [['nfse', ANEXOS.nfseA1.id], ['boleto', ANEXOS.boletoA1.id]]) {
            const res = await documento(tipo, IDS.nfA1, anexo);
            assert.equal(res.status, 404, `${tipo}: ${status}`);
            assert.equal((await res.json()).codigo, 'FINANCE_DOCUMENT_NOT_FOUND');
        }
    }
    assert.equal(consultasArquivo.length, 0, 'link antigo não dispara download externo');
});

test('status oficiais não cancelados preservam downloads de NFSe e boleto', async t => {
    const { base, documento } = await preparar(t);
    for (const status of ['Pago', 'A Vencer', 'Vencido', 'Aguardando Emissão da NF']) {
        base.registro(S.TABELAS.NOTAS_FISCAIS, IDS.nfA1).fields[S.NOTAS_FISCAIS.STATUS_PAGAMENTO] = status;
        for (const [tipo, anexo] of [['nfse', ANEXOS.nfseA1.id], ['boleto', ANEXOS.boletoA1.id]]) {
            const res = await documento(tipo, IDS.nfA1, anexo);
            assert.equal(res.status, 200, `${tipo}: ${status}`);
            assert.match(await res.text(), /^%PDF-/);
        }
    }
});
