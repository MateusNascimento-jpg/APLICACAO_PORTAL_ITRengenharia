'use strict';

// Documentos do contrato no Financeiro: proposta aceita congelada, comprovante
// e documentos fiscais na MESMA pilha, sem cartões novos.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');

test('Financeiro preserva tabela original e separa contratos sem novos cartões', () => {
    const js = read('public/assets/js/financeiro.js');
    const css = read('public/assets/css/financeiro.css');
    assert.match(js, /financeiro-separador-contratos/);
    assert.match(js, /detalhesContrato\(contrato\)/);
    assert.doesNotMatch(js, /var lista = el\('div', 'financeiro-contratos'\)/);
    assert.doesNotMatch(js, /var parcelas = el\('section', 'financeiro-parcelas'\)/);
    assert.match(css, /\.financeiro-lista-unica \.financeiro-separador-contratos/);
});

test('Documentos da proposta aceita: versão congelada, comprovante e depois NFSe/boleto', () => {
    const portal = read('public/assets/js/portal.js');
    const finance = read('public/assets/js/financeiro.js');
    const routes = read('lib/financeiro/routes.js');
    assert.match(portal, /p\.temComprovante === true/);
    assert.match(portal, /\/proposta-aceita/);
    assert.match(portal, /\/comprovante/);
    assert.match(portal, /Comprovante de Contrato\.pdf/);
    assert.match(finance, /tipo === 'proposta-aceita'/);
    assert.match(finance, /var ordem = \{'proposta-aceita': 0, proposta: 0, comprovante: 1, nfse: 2, boleto: 3\};/);
    assert.match(routes, /art\.original_pdf\.length/);
    assert.match(routes, /const fiscais = contrato\.documentos\.filter\(doc => doc\.tipo !== 'proposta'\);/);
    assert.match(routes, /contrato\.documentos = \[\{tipo:'proposta-aceita'/);
    assert.match(routes, /contrato\.documentos\.push\(\.\.\.fiscais\);/);
});
