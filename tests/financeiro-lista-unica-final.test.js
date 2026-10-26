'use strict';

// Decisão final (handoff 24/10, ADR-002/003): a tabela original lista UM
// contrato por linha. Estes contratos estáticos impedem a volta da tabela por
// parcela; o comportamento é exercitado em financeiro-contrato-unico.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');

test('Financeiro: tabela original por contrato, sem filtros, cartões ou parcelas', () => {
    const js = read('public/assets/js/financeiro.js');
    const css = read('public/assets/css/financeiro.css');
    assert.match(js, /financeiro-tabela-dados financeiro-lista-unica/);
    assert.match(js, /cabecalhoTabela\(\)/);
    assert.match(js, /contratos\.forEach\(function \(contrato, indice\) \{\s*if \(indice > 0\) corpo\.appendChild\(separadorContratos\(\)\);\s*var par = linhasContrato\(contrato\);/);
    assert.match(js, /estado\.abertas = new Set\(\);/, 'Detalhes começam recolhidos');
    assert.doesNotMatch(js, /linhasFatura|detalhesFatura|dados\.faturas|financeiroAbas/);
    assert.doesNotMatch(js, /financeiro-contrato-cabecalho|financeiro-parcelas|el\('section'/, 'sem cartões ou subtabelas por contrato');
    assert.match(css, /\.financeiro-lista-unica \.financeiro-separador-contratos > td \{\s*height: 14px;/);
    assert.doesNotMatch(css, /\.financeiro-aba\b|fin-c-parcela/);
});

test('Proposta aceita mostra versão preservada + comprovante em uma única seção', () => {
    const js = read('public/assets/js/portal.js');
    const start = js.indexOf('function documentosProposta(p){');
    const end = js.indexOf('function blocoAceiteProposta', start);
    const bloco = js.slice(start, end);
    assert.match(bloco, /aceitoComProva/);
    assert.match(bloco, /proposta-aceita/);
    assert.match(bloco, /Comprovante de Contrato\.pdf/);
    assert.ok(bloco.indexOf("'/proposta-aceita'") < bloco.indexOf("'/comprovante'"));
    assert.equal((bloco.match(/proposta-documento-destaque/g) || []).length >= 1, true);
});
