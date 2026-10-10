'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('Propostas usa base financeira separada sem substituir AIRTABLE_BASE_ID operacional', () => {
    const config = read('config.js');
    const financeiro = read('finance-airtable.js');
    assert.match(config, /AIRTABLE_FINANCE_BASE_ID/);
    assert.match(financeiro, /config\.financeAirtable/);
    assert.match(financeiro, /tbl8Sw1hYuEvgot8O/);
    assert.match(financeiro, /tblTzY3Iggkhydke2/);
});

test('aceite da proposta exige sessão, cliente, CSRF e escrita habilitada', () => {
    const server = read('server.js');
    assert.match(
        server,
        /app\.post\('\/api\/propostas\/:id\/aceitar',\s*sameOriginOnly,\s*autenticado,\s*somenteClientePortal,\s*csrfProtegido,\s*escritaHabilitada/,
    );
});

test('documento da proposta é servido pelo backend depois de validar o cliente', () => {
    const server = read('server.js');
    const financeiro = read('finance-airtable.js');
    assert.match(server, /\/api\/propostas\/:id\/documento\/:anexoId/);
    assert.match(financeiro, /carregarPropostaAtual\(propostaId, cnpj\)/);
    assert.doesNotMatch(read('public/assets/js/portal.js'), /airtableusercontent\.com/);
});

test('sidebar e tela de propostas são aditivas ao portal atual', () => {
    const html = read('public/portal.html');
    const js = read('public/assets/js/portal.js');
    assert.match(html, /id="navRelatorios"/);
    assert.match(html, /id="navConta"/);
    assert.match(html, /id="navSiteItr"/);
    assert.match(html, /id="navPropostas"/);
    assert.match(html, /id="painelPropostas"/);
    assert.match(js, /ativarViewPropostas/);
    assert.match(js, /PROPOSTA APROVADA/);
});

test('linked records do Airtable REST sao tratados como IDs em string', () => {
    const financeiro = read('finance-airtable.js');
    assert.match(financeiro, /typeof item === 'string'/);
    assert.match(financeiro, /links\.length === 1 && links\[0\] === clienteId/);
});

test('categoria linked-record e resolvida por ID sem depender do formato rico do conector', () => {
    const financeiro = read('finance-airtable.js');
    assert.match(financeiro, /TBL_CATEGORIAS/);
    assert.match(financeiro, /categoriasPorId\.get\(id\)/);
});

test('card de proposta nao exibe setor nem categoria e destaca o PDF antes dos dados comerciais', () => {
    const js = read('public/assets/js/portal.js');
    assert.doesNotMatch(js, /proposta-info-rotulo">Categoria/);
    assert.doesNotMatch(js, /p\.setor \|\| 'ITR Engenharia'/);
    assert.match(js, /proposta-documento-destaque/);
    assert.match(js, /ti-file-description/);
});

test('redesign v0.3 prioriza documento, usa timeline encorpada e decisao verde no grid', () => {
    const js = read('public/assets/js/portal.js');
    const css = read('public/assets/css/original-portal.css');
    const detalhe = js.slice(
        js.indexOf('\'<div class="proposta-detalhes"'),
        js.indexOf('lista.appendChild(artigo)', js.indexOf('\'<div class="proposta-detalhes"')),
    );
    assert.ok(detalhe.indexOf('documentosProposta(p)') < detalhe.indexOf('proposta-info-grid'));
    assert.ok(detalhe.indexOf('blocoAceiteProposta(p)') > detalhe.indexOf('Prazo para pagamento'));
    assert.match(js, /proposta-etapa-marca/);
    assert.match(js, /proposta-documento-destaque/);
    assert.match(css, /background:linear-gradient\(135deg,#218c58,#147542\)/);
    assert.match(css, /height:5px/);
    assert.match(css, /font-size:27px/);
    assert.doesNotMatch(js, /Consulte o documento antes de decidir/);
    assert.match(js, /proposta-documento-kicker\">Documento<\/span>/);
    assert.match(js, /ti-mail/);
    assert.match(js, /proposta-ampulheta/);
    assert.match(css, /font-weight:600/);
});
