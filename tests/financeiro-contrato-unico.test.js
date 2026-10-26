'use strict';

// Critério de aceitação do Financeiro (handoff 24/10, ADR-002): UMA linha por
// CONTRATO, nenhuma parcela listada (nem em Detalhes), situação consolidada
// que nunca vira "Pago" por causa de uma única parcela paga, sem abas e com
// pequeno separador entre contratos. O teste executa o financeiro.js real
// sobre um DOM mínimo, alimentado pelo serviço + mapper reais com uma base
// Airtable fictícia em memória.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('../lib/financeiro/schema');
const { createFinanceiroService } = require('../lib/financeiro/service');
const { criarBaseFicticia, criarBaseContratosDemo, CNPJ_A, IDS, rid } = require('./helpers/financeiro-fixtures');
const { criarDocumento } = require('./helpers/mini-dom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/portal.html'), 'utf8');
const codigo = fs.readFileSync(path.join(root, 'public/assets/js/financeiro.js'), 'utf8');
const P = S.PROPOSTA;

const baseC02C03 = () => criarBaseContratosDemo();

// IDs e tags do painel Financeiro lidos do portal.html real.
function estruturaFinanceiro() {
    const inicio = html.indexOf('id="painelFinanceiro"');
    const fim = html.indexOf('</section>', inicio);
    const trecho = html.slice(html.lastIndexOf('<', inicio), fim);
    const estrutura = [...trecho.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"/g)].map(m => [m[2], m[1]]);
    estrutura.push(['navFinanceiro', 'button']);
    return estrutura;
}

async function executarFinanceiro(resposta) {
    const document = criarDocumento(estruturaFinanceiro());
    document.getElementById('painelFinanceiro').hidden = true;
    const pedidos = [];
    const sandbox = {
        document,
        window: { addEventListener() {}, scrollTo() {}, location: { replace() {} } },
        NAVEGACAO_ATUAL: { propostas: true, financeiro: true },
        ocultarViewsPortal() {}, limparNavAtiva() {}, ativarViewInicial() {}, aplicarIcones() {},
        ITR: { jsonSeguro: resp => resp.json() },
        AbortController, setTimeout, clearTimeout, Set, Intl, Date, Object, Array, String, Number, Math, isFinite, isNaN,
        fetch(url) {
            pedidos.push(url);
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(JSON.stringify(resposta))) });
        },
    };
    vm.createContext(sandbox);
    vm.runInContext(codigo, sandbox, { filename: 'financeiro.js' });
    document.getElementById('navFinanceiro').click();
    for (let i = 0; i < 5; i += 1) await new Promise(r => setImmediate(r));
    return { document, pedidos };
}

function linhasDeContrato(document) {
    return document.getElementById('financeiroTabela').querySelectorAll('tr.financeiro-linha');
}

async function painelDe(base, cnpj = CNPJ_A) {
    const service = createFinanceiroService({ airtable: base.airtable, agora: () => Date.parse('2026-10-24T12:00:00Z') });
    const painel = await service.carregarPainel(cnpj);
    return { sucesso: true, financeiroHabilitado: true, ...painel };
}

test('API pública: um item por contrato, sem lista de parcelas e sem dados de parcela', async () => {
    const { base, ids } = baseC02C03();
    const dados = await painelDe(base);
    assert.equal(dados.faturas, undefined, 'a coleção de faturas não sai do servidor');
    assert.deepEqual(dados.contratos.map(c => c.nome), ['C02', 'C03']);
    const json = JSON.stringify(dados);
    // "Entrada + parcela final"/"Parcela única" são a CONDIÇÃO de pagamento do
    // contrato (Proposta.Forma de Pagamento); o que não pode sair são os
    // registros de parcela: identificação, valores e datas de cada uma.
    for (const proibido of ['C02 - Parcela', 'C03 - Parcela', '"parcela"', 'valorParcela', 'valorPago', 'vencimento', '12250', '2026-10-30', '2026-10-10', 'airtableusercontent']) {
        assert.ok(!json.includes(proibido), `${proibido} não pode chegar ao navegador`);
    }
    const c02 = dados.contratos.find(c => c.id === ids.c02);
    assert.equal(c02.situacao, 'A Vencer', 'Pago + A Vencer não é "Pago"');
    assert.equal(c02.valorTotal, 24500, 'valor total vem de Proposta.Valor, não da parcela');
    assert.equal(c02.status, 'Ativo');
    assert.deepEqual(c02.documentos.map(d => d.tipo), ['proposta', 'nfse', 'nfse', 'boleto']);
    const c03 = dados.contratos.find(c => c.id === ids.c03);
    assert.equal(c03.situacao, 'Aguardando Emissão da NF');
    assert.equal(c03.valorTotal, 8900);
});

test('tela: C02 com duas parcelas e C03 com uma parcela = duas linhas, dois Detalhes, um separador, sem abas', async () => {
    const { base, ids } = baseC02C03();
    const { document, pedidos } = await executarFinanceiro(await painelDe(base));
    assert.deepEqual(pedidos, ['/api/financeiro']);
    const tabela = document.getElementById('financeiroTabela');
    assert.equal(tabela.hidden, false);
    const linhas = linhasDeContrato(document);
    assert.equal(linhas.length, 2, 'uma linha por contrato');
    assert.deepEqual(linhas.map(tr => tr.getAttribute('data-id')), [ids.c02, ids.c03]);
    assert.equal(tabela.querySelectorAll('.financeiro-detalhes-btn').length, 2, 'um botão Detalhes por contrato');
    assert.equal(tabela.querySelectorAll('tr.financeiro-detalhe-linha').length, 2, 'um painel geral por contrato');
    assert.equal(tabela.querySelectorAll('tr.financeiro-separador-contratos').length, 1, 'respiro entre os dois contratos');
    assert.equal(tabela.querySelectorAll('[role="tab"]').length, 0);
    assert.equal(document.getElementById('financeiroAbas'), null, 'barra de abas removida do DOM');

    const cabecalho = tabela.querySelectorAll('th').map(th => th.textContent);
    assert.deepEqual(cabecalho.slice(0, 5), ['Contrato', 'Condição de pagamento', 'Valor total', 'Prazo para pagamento', 'Situação']);
    const textoTabela = tabela.textContent;
    assert.doesNotMatch(textoTabela, /C0\d - Parcela|Parcela \d|Identificação da parcela|Valor da parcela|Próximas|A pagar|Pagas|Canceladas/);
    assert.doesNotMatch(textoTabela, /12\.250,00|30\/10\/2026|10\/10\/2026/, 'nenhum valor/data de parcela isolada');

    const [c02, c03] = linhas;
    assert.equal(c02.querySelector('td.fin-c-contrato').textContent, 'C02');
    assert.equal(c02.querySelector('td.fin-c-condicao').textContent, 'Entrada + parcela final');
    assert.match(c02.querySelector('td.fin-c-valor').textContent, /24\.500,00/);
    assert.equal(c02.querySelector('td.fin-c-data').textContent, '10 dias após a NF');
    assert.equal(c02.querySelector('.financeiro-selo').textContent, 'A Vencer');
    assert.ok(!c02.querySelector('.financeiro-selo').classList.contains('pago'));
    assert.equal(c03.querySelector('.financeiro-selo').textContent, 'Aguardando Emissão da NF');
});

test('Detalhes: começa recolhido, expande só o contrato clicado e mostra dados gerais + documentos empilhados', async () => {
    const { base, ids } = baseC02C03();
    const { document } = await executarFinanceiro(await painelDe(base));
    const detalhe02 = document.getElementById('fin-det-' + ids.c02);
    const detalhe03 = document.getElementById('fin-det-' + ids.c03);
    assert.equal(detalhe02.hidden, true, 'não abre tudo por padrão');
    assert.equal(detalhe03.hidden, true);

    const botao = document.getElementById('financeiroTabela').querySelector(`.financeiro-detalhes-btn[data-id="${ids.c02}"]`);
    botao.click();
    assert.equal(detalhe02.hidden, false);
    assert.equal(detalhe03.hidden, true, 'detalhes independentes');
    assert.equal(botao.getAttribute('aria-expanded'), 'true');

    const rotulos = detalhe02.querySelectorAll('dt').map(dt => dt.textContent);
    assert.deepEqual(rotulos, ['Contrato', 'Proposta', 'Situação do contrato', 'Condição de pagamento', 'Prazo para pagamento', 'Valor total']);
    assert.doesNotMatch(detalhe02.textContent, /Identificação da parcela|Valor da parcela|Parcela \d|Vencimento|Emissão da NF|Valor pago|Data do pagamento/);
    const documentos = detalhe02.querySelectorAll('li.financeiro-documento');
    assert.deepEqual(documentos.map(li => li.querySelector('strong').textContent), ['Proposta comercial', 'NFSe', 'NFSe', 'Boleto']);
    for (const li of documentos) {
        assert.match(li.querySelector('a').href, /^\/api\/financeiro\/documentos\/(proposta|nfse|boleto)\/rec[A-Za-z0-9]{14}\/att[A-Za-z0-9]{14}$/);
    }
    botao.click();
    assert.equal(detalhe02.hidden, true, 'Detalhes recolhe de novo');
});

test('proposta aceita com artefatos: Proposta → Comprovante → NFSe/boleto na mesma pilha', async () => {
    const { base, ids } = baseC02C03();
    const dados = await painelDe(base);
    const c02 = dados.contratos.find(c => c.id === ids.c02);
    // Mesma composição feita por lib/financeiro/routes.js quando há artefato persistido.
    const fiscais = c02.documentos.filter(d => d.tipo !== 'proposta');
    c02.documentos = [
        { tipo: 'proposta-aceita', registroId: ids.prop02, anexoId: 'original', rotulo: 'Proposta comercial', nome: 'Proposta_02.pdf', tamanho: 1000, mime: 'application/pdf', visualizavel: true },
        { tipo: 'comprovante', registroId: ids.prop02, anexoId: 'proof', rotulo: 'Comprovante de Contrato', nome: 'Comprovante de Contrato.pdf', tamanho: 900, mime: 'application/pdf', visualizavel: true },
        ...fiscais,
    ];
    const { document } = await executarFinanceiro(dados);
    const itens = document.getElementById('fin-det-' + ids.c02).querySelectorAll('li.financeiro-documento');
    assert.deepEqual(itens.map(li => li.querySelector('strong').textContent), ['Proposta comercial', 'Comprovante de Contrato', 'NFSe', 'NFSe', 'Boleto']);
    assert.equal(itens[0].querySelector('a').href, `/api/propostas/${ids.prop02}/proposta-aceita`);
    assert.equal(itens[1].querySelector('a').href, `/api/propostas/${ids.prop02}/comprovante`);
});

test('base fictícia completa: N contratos = N linhas; busca por proposta mantém a linha do contrato', async () => {
    const base = criarBaseFicticia();
    const dados = await painelDe(base);
    const { document } = await executarFinanceiro(dados);
    assert.equal(linhasDeContrato(document).length, dados.contratos.length);
    assert.equal(dados.contratos.length, 2, 'C105-2026 (5 parcelas) e C118-2026 (2 parcelas) do cliente A');
    const busca = document.getElementById('financeiroBusca');
    busca.value = '118';
    busca.dispatchEvent({ type: 'input' });
    const linhas = linhasDeContrato(document);
    assert.equal(linhas.length, 1);
    assert.equal(linhas[0].getAttribute('data-id'), IDS.contA2);
    assert.equal(document.getElementById('financeiroTabela').querySelectorAll('tr.financeiro-separador-contratos').length, 0);
});

test('proposta aceita sem contrato cadastrado: aviso discreto, sem linha inventada', async () => {
    const { base } = baseC02C03();
    base.tabelas[S.TABELAS.PROPOSTA].push({ id: rid('Prop04'), fields: {
        [P.NUMERO]: '04', [P.STATUS]: 'Aceita', [P.CLIENTE]: [IDS.clienteA], [P.VALOR]: 1000 } });
    const dados = await painelDe(base);
    assert.deepEqual(dados.pendencias.propostasEmPreparacao, [{ numero: '04' }]);
    const { document } = await executarFinanceiro(dados);
    assert.equal(linhasDeContrato(document).length, 2);
    assert.match(document.getElementById('financeiroAvisos').textContent, /Proposta 04 aceita: o contrato aparecerá nesta lista/);
});

test('rota /api/financeiro: artefato congelado do aceite entra antes dos fiscais; artefato de outro CNPJ é ignorado', async () => {
    const express = require('express');
    const { registerFinanceiroRoutes } = require('../lib/financeiro/routes');
    const { base, ids } = baseC02C03();
    const artefatos = new Map([
        [ids.prop02, { cnpj: CNPJ_A, version: 'v1', original_name: 'Proposta_02.pdf', original_pdf: Buffer.alloc(10), comprovante_pdf: Buffer.alloc(20) }],
        [ids.prop03, { cnpj: '99888777000166', version: 'v1', original_name: 'x.pdf', original_pdf: Buffer.alloc(1), comprovante_pdf: Buffer.alloc(1) }],
    ]);
    const app = express();
    registerFinanceiroRoutes(app, {
        service: createFinanceiroService({ airtable: base.airtable }), airtable: base.airtable,
        auth: (req, res, next) => { req.session = { role: 'GeneratedClient', documento: CNPJ_A }; next(); },
        client: (req, res, next) => next(), consume: async () => ({ ok: true }), audit: () => {}, hmac: v => v,
        logger: { warn() {}, error() {} },
        artifactStore: {
            async artifact(id) { return artefatos.get(id) || null; },
            async state(id) { return artefatos.has(id) ? { decision: { state: 'done', status: 'Aceita', snapshot: { version: 'v1' } } } : {}; },
        },
    });
    const servidor = app.listen(0, '127.0.0.1');
    await new Promise(resolve => servidor.once('listening', resolve));
    try {
        const resposta = await fetch(`http://127.0.0.1:${servidor.address().port}/api/financeiro`);
        assert.equal(resposta.status, 200);
        assert.equal(resposta.headers.get('cache-control'), 'no-store');
        const dados = await resposta.json();
        assert.equal(dados.faturas, undefined);
        const c02 = dados.contratos.find(c => c.id === ids.c02);
        assert.deepEqual(c02.documentos.map(d => d.tipo), ['proposta-aceita', 'comprovante', 'nfse', 'nfse', 'boleto']);
        assert.deepEqual(c02.documentos.slice(0, 2).map(d => d.nome), ['Proposta_02.pdf', 'Comprovante de Contrato.pdf']);
        const c03 = dados.contratos.find(c => c.id === ids.c03);
        assert.deepEqual(c03.documentos.map(d => d.tipo), ['proposta'], 'artefato com CNPJ divergente não é exibido');
    } finally {
        await new Promise(resolve => servidor.close(resolve));
    }
});
