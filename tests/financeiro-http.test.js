'use strict';

// Rotas HTTP reais do Financeiro (server.js), com sessão, MySQL e Airtable
// substituídos por dublês em memória e dados 100% fictícios.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
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

const { criarBaseFicticia, IDS, ANEXOS, CNPJ_A, CNPJ_B, rid } = require('./helpers/financeiro-fixtures');
const S = require('../lib/financeiro/schema');

const base = criarBaseFicticia();
// Empresa C: somente proposta enviada (não aceita).
const CNPJ_C = '77888999000163';
base.tabelas[S.TABELAS.CLIENTES].push({ id: rid('CliC'), fields: { [S.CLIENTES.CNPJ]: CNPJ_C } });
base.tabelas[S.TABELAS.PROPOSTA].push({ id: rid('PropC1'), fields: { [S.PROPOSTA.STATUS]: 'Enviada', [S.PROPOSTA.CLIENTE]: [rid('CliC')] } });

let limiteOk = true;
const auditoria = [];
const raiz = path.resolve(__dirname, '..') + path.sep;
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
    const doPortal = parent?.filename?.startsWith(raiz);
    if (doPortal && (request === './db' || request === '../db')) return { query: async () => [[], []], verificarBanco: async () => true };
    if (doPortal && request === './lib/sessions')
        return {
            loadSession: async req => {
                const role = req.get('x-test-role');
                return role ? { role, documento: req.get('x-test-cnpj') || CNPJ_A, airtableId: 'recAAAAAAAAAAAAAA' } : null;
            },
        };
    if (doPortal && request === './lib/rate-limit')
        return { consume: async () => (limiteOk ? { ok: true } : { ok: false, retryAfterMs: 30_000 }), reset: async () => {}, defensiveDelay: async () => {} };
    if (doPortal && request === './lib/audit') return { audit: async (req, evento, dados) => { auditoria.push({ evento, ...dados }); } };
    if (doPortal && request === './airtable' && parent.filename.endsWith('server.js')) return { temTrabalhosAutorizados: async () => false };
    if (doPortal && request === './finance-airtable' && parent.filename.endsWith('server.js')) return base.airtable;
    return realLoad.call(this, request, parent, isMain);
};
const { app } = require('../server');
Module._load = realLoad;

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n');
const upstream = [];
let corpoUpstream = () => new Response(PDF, { headers: { 'content-type': 'application/pdf' } });
const realFetch = global.fetch;
global.fetch = async (url, options) => {
    if (String(url).startsWith('https://v5.airtableusercontent.com/')) {
        upstream.push(String(url));
        return corpoUpstream(String(url));
    }
    return realFetch(url, options);
};

let origin;
let server;
test.before(async () => {
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => new Promise(resolve => server.close(resolve)));

function get(rota, { role = 'GeneratedClient', cnpj = CNPJ_A, headers = {} } = {}) {
    const h = { ...headers };
    if (role) h['x-test-role'] = role;
    if (cnpj) h['x-test-cnpj'] = cnpj;
    return realFetch(origin + rota, { headers: h });
}

const doc = (tipo, registro, anexo) => `/api/financeiro/documentos/${tipo}/${registro}/${anexo}`;

test('sessão e papel: 401 sem sessão, 403 Diretor, 404 DEV e 404 sem proposta aceita', async () => {
    assert.equal((await get('/api/financeiro', { role: '' })).status, 401);
    assert.equal((await get(doc('nfse', IDS.nfA1, ANEXOS.nfseA1.id), { role: '' })).status, 401);
    assert.equal((await get('/api/financeiro', { role: 'Director' })).status, 403);
    const dev = await get('/api/financeiro', { role: 'DevViewer' });
    assert.equal(dev.status, 404);
    assert.equal((await dev.json()).codigo, 'FINANCE_NOT_AVAILABLE');
    assert.equal((await get(doc('nfse', IDS.nfA1, ANEXOS.nfseA1.id), { role: 'DevViewer' })).status, 404);
    const semAceite = await get('/api/financeiro', { cnpj: CNPJ_C });
    assert.equal(semAceite.status, 404);
    const nav = await (await get('/api/navegacao', { cnpj: CNPJ_C })).json();
    assert.equal(nav.financeiro, false);
    assert.equal((await (await get('/api/navegacao')).json()).financeiro, true);
});

test('lista: escopo pela sessão (query ignorada), sem URLs do Airtable e sem cache HTTP', async () => {
    const resposta = await get(`/api/financeiro?cnpj=${CNPJ_B}&clienteId=${IDS.clienteB}`);
    assert.equal(resposta.status, 200);
    assert.match(resposta.headers.get('cache-control'), /no-store/);
    const texto = await resposta.text();
    const dados = JSON.parse(texto);
    assert.equal(dados.sucesso, true);
    assert.equal(dados.financeiroHabilitado, true);
    assert.deepEqual(dados.contratos.map(c => c.nome), ['C105-2026', 'C118-2026']);
    assert.doesNotMatch(texto, /C200-2026|airtableusercontent|dl\.airtable\.com|appI163|tbl[A-Za-z0-9]{14}|fld[A-Za-z0-9]{14}/);

    const deB = await (await get('/api/financeiro', { cnpj: CNPJ_B })).json();
    assert.deepEqual(deB.contratos.map(c => c.nome), ['C200-2026']);
});

test('documentos: PDF inline, XML como download, cabeçalhos seguros e auditoria', async () => {
    upstream.length = 0;
    const pdf = await get(doc('nfse', IDS.nfA1, ANEXOS.nfseA1.id));
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.match(pdf.headers.get('content-disposition'), /^inline; filename="NFSe 0001\.pdf"/);
    assert.match(pdf.headers.get('cache-control'), /no-store/);
    assert.equal(pdf.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await pdf.arrayBuffer()), PDF);
    assert.ok(auditoria.some(a => a.evento === 'finance_document_open' && a.outcome === 'success' && a.targetId === IDS.nfA1));
    assert.ok(!JSON.stringify(auditoria).includes(CNPJ_A), 'auditoria usa HMAC, não CNPJ');

    corpoUpstream = () => new Response('<?xml version="1.0"?><NFSe/>', { headers: { 'content-type': 'text/xml' } });
    const xml = await get(doc('nfse', IDS.nfA2, ANEXOS.xmlA2.id));
    assert.equal(xml.status, 200);
    assert.match(xml.headers.get('content-disposition'), /^attachment;/);

    corpoUpstream = () => new Response(PDF, { headers: { 'content-type': 'application/pdf' } });
    const proposta = await get(doc('proposta', IDS.contA1, ANEXOS.propostaA1.id));
    assert.equal(proposta.status, 200);
    assert.match(proposta.headers.get('content-disposition'), /Proposta 105-2026\.pdf/);
});

test('negações de documento são genéricas e não buscam o arquivo alheio', async () => {
    upstream.length = 0;
    const casos = [
        doc('nfse', IDS.nfB1, ANEXOS.nfseB1.id),
        doc('boleto', IDS.nfA1, ANEXOS.boletoB1.id),
        doc('proposta', IDS.contB1, ANEXOS.propostaA1.id),
        doc('contrato-formal', IDS.contA1, ANEXOS.propostaA1.id),
        doc('constructor', IDS.contA1, ANEXOS.propostaA1.id),
        doc('nfse', 'recCURTO', ANEXOS.nfseA1.id),
        doc('nfse', IDS.nfA1, 'attCURTO'),
        doc('nfse', '..%2F..%2Fserver.js', ANEXOS.nfseA1.id),
    ];
    const corpos = new Set();
    for (const rota of casos) {
        const resposta = await get(rota);
        assert.equal(resposta.status, 404, rota);
        const dados = await resposta.json();
        corpos.add(`${dados.erro}|${dados.codigo}`);
    }
    assert.equal(corpos.size, 1, 'mesma resposta para inexistente e não autorizado');
    assert.equal(upstream.length, 0, 'nenhum download de terceiro foi iniciado');

    const html = await get(doc('nfse', IDS.nfB1, ANEXOS.nfseB1.id), { headers: { accept: 'text/html', 'sec-fetch-dest': 'document' } });
    assert.equal(html.status, 404);
    assert.match(html.headers.get('content-type'), /text\/html/);
    const pagina = await html.text();
    assert.match(pagina, /Documento indisponível/);
    assert.doesNotMatch(pagina, /<script/i);
});

test('upstream inválido, redirecionamento externo e rate limit respondem sem vazar detalhes', async () => {
    corpoUpstream = () => new Response('<html>login</html>', { headers: { 'content-type': 'application/pdf' } });
    let resposta = await get(doc('nfse', IDS.nfA1, ANEXOS.nfseA1.id));
    assert.equal(resposta.status, 502);
    let dados = await resposta.json();
    assert.equal(dados.codigo, 'FINANCE_DOCUMENT_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(dados), /DOC_|html|airtable/i);

    corpoUpstream = () => new Response(null, { status: 302, headers: { location: 'https://evil.example/roubo' } });
    resposta = await get(doc('nfse', IDS.nfA1, ANEXOS.nfseA1.id));
    assert.equal(resposta.status, 502);

    corpoUpstream = () => new Response(PDF, { headers: { 'content-type': 'application/pdf' } });
    limiteOk = false;
    resposta = await get(doc('nfse', IDS.nfA1, ANEXOS.nfseA1.id));
    assert.equal(resposta.status, 429);
    assert.equal(resposta.headers.get('retry-after'), '30');
    limiteOk = true;
});

test('Airtable indisponível: 503 com mensagem aprovada e sem detalhes internos', async () => {
    base.falhar(true);
    try {
        const resposta = await get('/api/financeiro', { cnpj: CNPJ_B });
        assert.equal(resposta.status, 503);
        const dados = await resposta.json();
        assert.equal(dados.erro, 'Não foi possível carregar suas informações financeiras. Tente novamente em instantes.');
        assert.equal(dados.codigo, 'FINANCE_UNAVAILABLE');
        assert.doesNotMatch(JSON.stringify(dados), /AIRTABLE_OFFLINE|stack|503 /);
        assert.equal((await get(doc('nfse', IDS.nfA1, ANEXOS.nfseA1.id))).status, 503);
    } finally {
        base.falhar(false);
    }
});

test('Financeiro não expõe nenhuma rota de escrita', async () => {
    for (const metodo of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        for (const rota of ['/api/financeiro', doc('nfse', IDS.nfA1, ANEXOS.nfseA1.id)]) {
            const resposta = await realFetch(origin + rota, {
                method: metodo,
                headers: { 'x-test-role': 'GeneratedClient', 'content-type': 'application/json' },
                body: '{}',
            });
            assert.equal(resposta.status, 404, `${metodo} ${rota}`);
        }
    }
});

test('Achado 1 — GET seguido de GET: vínculo alterado no Airtable some na hora (sem cache de painel)', async () => {
    const contrato = base.registro(S.TABELAS.CONTRATOS, IDS.contA1);
    const original = contrato.fields[S.CONTRATOS.PROPOSTA];
    try {
        let dados = await (await get('/api/financeiro')).json();
        assert.ok(dados.contratos.some(c => c.id === IDS.contA1));
        contrato.fields[S.CONTRATOS.PROPOSTA] = [IDS.propB1];
        dados = await (await get('/api/financeiro')).json();
        assert.ok(!dados.contratos.some(c => c.id === IDS.contA1), 'contrato reassociado não aparece');
        assert.equal(dados.faturas, undefined, 'parcelas nunca são listadas');
        assert.ok(!dados.contratos.some(c => c.documentos.some(d => d.registroId === IDS.nfA1)), 'nem documentos das suas notas');
        assert.ok(dados.pendencias.itensEmConferencia >= 1);
        assert.equal((await get(doc('nfse', IDS.nfA1, ANEXOS.nfseA1.id))).status, 404);
    } finally {
        contrato.fields[S.CONTRATOS.PROPOSTA] = original;
    }
    const restaurado = await (await get('/api/financeiro')).json();
    assert.ok(restaurado.contratos.some(c => c.id === IDS.contA1));
});

test('Achado 4 — downloads simultâneos: no máximo 2 por conta; vagas liberadas ao terminar', async () => {
    let liberar;
    const barreira = new Promise(resolve => { liberar = resolve; });
    upstream.length = 0;
    corpoUpstream = () => new Response(new ReadableStream({
        async start(controller) {
            await barreira;
            controller.enqueue(new Uint8Array(PDF));
            controller.close();
        },
    }), { headers: { 'content-type': 'application/pdf', 'content-length': String(PDF.length) } });
    try {
        const primeiros = [get(doc('nfse', IDS.nfA1, ANEXOS.nfseA1.id)), get(doc('boleto', IDS.nfA1, ANEXOS.boletoA1.id))];
        while (upstream.length < 2) await new Promise(r => setTimeout(r, 5));
        const terceiro = await get(doc('boleto', IDS.nfA2, ANEXOS.boletoA2.id));
        assert.equal(terceiro.status, 429);
        assert.equal(terceiro.headers.get('retry-after'), '5');
        assert.equal((await terceiro.json()).codigo, 'FINANCE_DOCUMENT_BUSY');
        const outraConta = get(doc('nfse', IDS.nfB1, ANEXOS.nfseB1.id), { cnpj: CNPJ_B });
        while (upstream.length < 3) await new Promise(r => setTimeout(r, 5));
        liberar();
        const respostas = await Promise.all([...primeiros, outraConta]);
        assert.deepEqual(respostas.map(r => r.status), [200, 200, 200], 'outra empresa não é bloqueada pela primeira');
        await Promise.all(respostas.map(r => r.arrayBuffer()));
    } finally {
        liberar();
        corpoUpstream = () => new Response(PDF, { headers: { 'content-type': 'application/pdf' } });
    }
    // As vagas são devolvidas no evento 'close' da resposta; aguarda até 1 s.
    let depois;
    for (let i = 0; i < 40; i += 1) {
        depois = await get(doc('nfse', IDS.nfA1, ANEXOS.nfseA1.id));
        if (depois.status === 200) break;
        await depois.arrayBuffer();
        await new Promise(r => setTimeout(r, 25));
    }
    assert.equal(depois.status, 200, 'vagas devolvidas após as respostas');
});

test('Achado 4 — limite do servidor e orçamento de memória na rota: 503 genérico com Retry-After', async () => {
    const express = require('express');
    const { registerFinanceiroRoutes } = require('../lib/financeiro/routes');
    const { createFinanceiroService } = require('../lib/financeiro/service');
    const { criarLimitadorDownloads } = require('../lib/financeiro/documentos');
    const app2 = express();
    const sessao = (req, _res, next) => { req.session = { role: 'GeneratedClient', documento: req.get('x-test-cnpj') }; next(); };
    const limitador = criarLimitadorDownloads({ maxSimultaneos: 1, maxPorConta: 1, orcamentoBytes: 1024 * 1024 });
    let liberar;
    const barreira = new Promise(resolve => { liberar = resolve; });
    const chamadasUpstream = [];
    const fetcher = async url => {
        chamadasUpstream.push(url);
        await barreira;
        return new Response(PDF, { headers: { 'content-type': 'application/pdf', 'content-length': String(PDF.length) } });
    };
    registerFinanceiroRoutes(app2, {
        service: createFinanceiroService({ airtable: base.airtable }), airtable: base.airtable,
        auth: sessao, client: (_q, _s, n) => n(), consume: async () => ({ ok: true }), audit: async () => {},
        hmac: v => 'h' + String(v).length, fetcher, limitadorDownloads: limitador, logger: { warn() {}, error() {} },
    });
    const srv = app2.listen(0, '127.0.0.1');
    await new Promise(r => srv.once('listening', r));
    const url = rota => `http://127.0.0.1:${srv.address().port}${rota}`;
    try {
        const primeiro = realFetch(url(doc('nfse', IDS.nfA1, ANEXOS.nfseA1.id)), { headers: { 'x-test-cnpj': CNPJ_A } });
        while (!chamadasUpstream.length) await new Promise(r => setTimeout(r, 5));
        const segundo = await realFetch(url(doc('nfse', IDS.nfB1, ANEXOS.nfseB1.id)), { headers: { 'x-test-cnpj': CNPJ_B } });
        assert.equal(segundo.status, 503);
        assert.equal(segundo.headers.get('retry-after'), '5');
        assert.equal((await segundo.json()).codigo, 'FINANCE_DOCUMENT_BUSY');
        liberar();
        const respostaPrimeiro = await primeiro;
        assert.equal(respostaPrimeiro.status, 200);
        await respostaPrimeiro.arrayBuffer();
        for (let i = 0; i < 40 && limitador.situacao().ativos; i += 1) await new Promise(r => setTimeout(r, 25));
        assert.deepEqual(limitador.situacao(), { ativos: 0, bytesReservados: 0, contas: 0 });

        // Orçamento menor que o arquivo: recusa limpa, sem ler o corpo inteiro.
        const pequeno = criarLimitadorDownloads({ orcamentoBytes: 8 });
        const app3 = express();
        registerFinanceiroRoutes(app3, {
            service: createFinanceiroService({ airtable: base.airtable }), airtable: base.airtable,
            auth: sessao, client: (_q, _s, n) => n(), consume: async () => ({ ok: true }), audit: async () => {},
            hmac: v => v, fetcher: async () => new Response(PDF, { headers: { 'content-type': 'application/pdf', 'content-length': String(PDF.length) } }),
            limitadorDownloads: pequeno, logger: { warn() {}, error() {} },
        });
        const srv3 = app3.listen(0, '127.0.0.1');
        await new Promise(r => srv3.once('listening', r));
        try {
            const r = await realFetch(`http://127.0.0.1:${srv3.address().port}${doc('nfse', IDS.nfA1, ANEXOS.nfseA1.id)}`, { headers: { 'x-test-cnpj': CNPJ_A } });
            assert.equal(r.status, 503);
            assert.equal((await r.json()).codigo, 'FINANCE_DOCUMENT_BUSY');
            for (let i = 0; i < 40 && pequeno.situacao().ativos; i += 1) await new Promise(r2 => setTimeout(r2, 25));
            assert.deepEqual(pequeno.situacao(), { ativos: 0, bytesReservados: 0, contas: 0 });
        } finally {
            await new Promise(r => srv3.close(r));
        }
    } finally {
        liberar();
        await new Promise(r => srv.close(r));
    }
});
