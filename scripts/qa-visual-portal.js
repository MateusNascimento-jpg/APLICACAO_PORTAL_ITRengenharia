'use strict';

// Prova visual local do Financeiro (uma linha por contrato) e da seção
// Documentos de Propostas. Usa o frontend real (public/) e as rotas reais do
// Financeiro (lib/financeiro) sobre uma base Airtable FICTÍCIA em memória.
// Nada de .env, MySQL, Airtable, SMTP ou rede externa: o navegador só alcança
// o servidor de loopback. Playwright é instalado à parte (não é dependência).
//
//   node scripts/qa-visual-portal.js <pasta-de-saida>

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright');
const { createFinanceiroService } = require('../lib/financeiro/service');
const { registerFinanceiroRoutes } = require('../lib/financeiro/routes');
const { generate: gerarComprovante } = require('../lib/proposals/comprovante');
const { criarBaseContratosDemo, CNPJ_A, rid, aid } = require('../tests/helpers/financeiro-fixtures');

function pdfSimples(titulo) {
    let conteudo = '%PDF-1.4\n';
    const stream = `BT /F1 18 Tf 60 760 Td (${titulo}) Tj ET`;
    const objetos = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ];
    const offsets = [];
    objetos.forEach((objeto, i) => {
        offsets.push(Buffer.byteLength(conteudo));
        conteudo += `${i + 1} 0 obj\n${objeto}\nendobj\n`;
    });
    const xref = Buffer.byteLength(conteudo);
    conteudo += `xref\n0 6\n0000000000 65535 f \n${offsets.map(o => String(o).padStart(10, '0') + ' 00000 n ').join('\n')}\n`
        + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(conteudo, 'latin1');
}

async function main() {
    const saida = path.resolve(process.argv[2] || 'qa-visual');
    fs.mkdirSync(saida, { recursive: true });
    const { base, ids } = criarBaseContratosDemo({ incluirC01: true });
    const service = createFinanceiroService({ airtable: base.airtable });

    // Artefatos do aceite da proposta 02 (mesmo formato de portal_proposal_artifacts).
    const original = pdfSimples('Proposta 02 - versao aceita (ficticia)');
    const comprovante = gerarComprovante({
        proposal: { id: ids.prop02, cnpj: CNPJ_A, numero: '02', nomeCliente: 'Empresa Fictícia de Homologação Ltda',
            emails: ['compras@example.test'], emailContato: 'compras@example.test', valor: 24500, formaPagamento: 'Entrada + parcela final',
            prazoPagamentoDias: 10, descricao: 'Ensaios de caracterização de solo e concreto' },
        attachmentId: aid('PdfProp02'), pdfHash: 'a'.repeat(64), version: 'b'.repeat(64),
        acceptedAt: Date.parse('2026-10-23T14:05:00Z'), origin: 'https://portal.example.test/',
    }).bytes;
    const artefatos = new Map([[ids.prop02, {
        cnpj: CNPJ_A, version: 'v-aceita', original_name: 'Proposta_02.pdf', original_pdf: original, comprovante_pdf: comprovante,
    }]]);
    const artifactStore = {
        async artifact(id) { return artefatos.get(id) || null; },
        async state(id) { return artefatos.has(id) ? { decision: { state: 'done', status: 'Aceita', snapshot: { version: 'v-aceita' } } } : {}; },
    };

    const app = express();
    const servidor = app.listen(0, '127.0.0.1');
    await new Promise(resolve => servidor.once('listening', resolve));
    const origin = `http://127.0.0.1:${servidor.address().port}`;
    const auth = (req, res, next) => { req.session = { role: 'GeneratedClient', documento: CNPJ_A }; req.requestId = 'qa'; next(); };
    const pass = (req, res, next) => next();
    const pdfDoAirtable = pdfSimples('Documento ficticio (NFSe/boleto/proposta)');
    registerFinanceiroRoutes(app, {
        service, airtable: base.airtable, auth, client: pass, artifactStore,
        consume: async () => ({ ok: true }), audit: () => {}, hmac: v => v, logger: { warn() {}, error() {} },
        fetcher: async () => new Response(pdfDoAirtable, { headers: { 'content-type': 'application/pdf', 'content-length': String(pdfDoAirtable.length) } }),
    });

    const propostas = [
        { id: rid('Prop04'), numero: '04', dataEnvio: '2026-10-22', status: 'Em Análise pelo Cliente', valor: 24500,
            formaPagamento: 'Entrada + parcela final', prazoPagamentoDias: 10, categorias: [], documentos: [{ id: aid('PdfProp04'), nome: 'Proposta_04.pdf' }] },
        // Anexo atual do Airtable substituído depois do aceite: a tela mostra a versão congelada.
        { id: ids.prop02, numero: '02', dataEnvio: '2026-10-15', status: 'Aceita', valor: 24500, temComprovante: true,
            nomePropostaAceita: 'Proposta_02.pdf', formaPagamento: 'Entrada + parcela final', prazoPagamentoDias: 10,
            categorias: [], documentos: [{ id: aid('PdfProp02'), nome: 'Proposta_02_REVISAO_POSTERIOR.pdf' }] },
    ];
    app.get('/api/perfil', (_, res) => res.json({ sucesso: true, usuario: { perfil: 'Cliente', documento: CNPJ_A, nomeEmpresa: 'Empresa Fictícia de Homologação Ltda' } }));
    app.get('/api/navegacao', (_, res) => res.json({ sucesso: true, propostas: true, relatorios: false, financeiro: true }));
    app.get('/api/conta', (_, res) => res.json({ sucesso: true, conta: {} }));
    app.get('/api/runtime', (_, res) => res.json({ safeMode: false }));
    app.get('/api/csrf', (_, res) => res.json({ csrfToken: 'qa-csrf' }));
    app.get('/api/meus-dados', (_, res) => res.json({ sucesso: true, trabalhos: [], nome_cliente: 'Empresa Fictícia de Homologação Ltda' }));
    app.get('/api/propostas', (_, res) => res.json({ sucesso: true, clienteEncontrado: true, propostas }));
    for (const tipo of ['proposta-aceita', 'comprovante']) {
        app.get(`/api/propostas/:id/${tipo}`, (req, res) => {
            const art = artefatos.get(req.params.id);
            if (!art) return res.sendStatus(404);
            res.type('application/pdf').send(tipo === 'comprovante' ? art.comprovante_pdf : art.original_pdf);
        });
    }
    app.use(express.static(path.resolve(__dirname, '../public')));

    const browser = await chromium.launch({ headless: true, executablePath: process.env.ITR_QA_CHROMIUM || undefined });
    const relatorio = [];
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
        await context.route('**/*', route => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
        await context.addInitScript(() => { try { localStorage.setItem('itr-tour-version', '1'); } catch (_) {} });
        const page = await context.newPage();
        const erros = [];
        page.on('pageerror', e => erros.push(e.message));
        const semOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
        const foto = async (nome, opcoes = {}) => {
            await page.screenshot({ path: path.join(saida, nome), fullPage: true, ...opcoes });
            relatorio.push(nome);
        };

        // ---- Financeiro ----
        await page.goto(origin + '/portal.html');
        await page.locator('#navFinanceiro').waitFor({ state: 'visible' });
        await page.locator('#navFinanceiro').click();
        await page.locator('#financeiroTabela tr.financeiro-linha').first().waitFor();
        const linhas = page.locator('#financeiroTabela tr.financeiro-linha');
        assert.equal(await linhas.count(), 3, 'C01, C02, C03: uma linha por contrato');
        assert.deepEqual(await page.locator('#financeiroTabela td.fin-c-contrato').allTextContents(), ['C01', 'C02', 'C03']);
        assert.deepEqual(await page.locator('#financeiroTabela .financeiro-selo').allTextContents(), ['Pago', 'A Vencer', 'Aguardando Emissão da NF']);
        assert.equal(await page.locator('#financeiroTabela tr.financeiro-separador-contratos').count(), 2);
        assert.equal(await page.locator('[role="tab"], #financeiroAbas').count(), 0, 'sem abas');
        assert.equal(await page.locator('#financeiroTabela tr.financeiro-detalhe-linha:visible').count(), 0, 'Detalhes recolhidos');
        const textoPainel = await page.locator('#painelFinanceiro').innerText();
        assert.doesNotMatch(textoPainel, /C0\d - Parcela|Parcela \d|Valor da parcela|Identificação da parcela|Próximas/);
        assert.equal(await semOverflow(), true);
        await foto('financeiro-desktop-1440-recolhido.png');

        await page.locator('.financeiro-detalhes-btn[data-id="' + ids.c02 + '"]').click();
        const detalhe = page.locator('#fin-det-' + ids.c02);
        await detalhe.waitFor({ state: 'visible' });
        await page.waitForTimeout(300); // fim da rotação do chevron
        assert.deepEqual(await detalhe.locator('li.financeiro-documento strong').allTextContents(),
            ['Proposta comercial', 'Comprovante de Contrato', 'NFSe', 'NFSe', 'Boleto']);
        assert.doesNotMatch(await detalhe.innerText(), /Parcela \d|Vencimento|Valor pago/);
        assert.equal(await detalhe.locator('.financeiro-documento-icone svg').count(), 5, 'todo documento tem ícone desenhado');
        await foto('financeiro-desktop-1440-C02-detalhes.png');

        // Download real pela rota autenticada do Financeiro (NFSe) e do comprovante.
        const hrefs = await detalhe.locator('li.financeiro-documento a').evaluateAll(as => as.map(a => a.getAttribute('href')));
        for (const href of hrefs) {
            const resposta = await context.request.get(origin + href);
            assert.equal(resposta.status(), 200, href);
            assert.match(resposta.headers()['content-type'], /application\/pdf/, href);
            assert.equal((await resposta.body()).subarray(0, 5).toString(), '%PDF-', href);
        }
        relatorio.push(`downloads OK: ${hrefs.length} documentos (%PDF-, 200)`);

        await page.evaluate(() => document.documentElement.setAttribute('data-tema', 'escuro'));
        await page.waitForTimeout(400);
        await foto('financeiro-desktop-1440-C02-detalhes-escuro.png');
        await page.evaluate(() => document.documentElement.setAttribute('data-tema', 'claro'));
        await page.waitForTimeout(400);

        for (const [largura, altura] of [[820, 1100], [390, 844]]) {
            await page.setViewportSize({ width: largura, height: altura });
            await page.waitForTimeout(250);
            assert.equal(await semOverflow(), true, `sem overflow horizontal em ${largura}px`);
            await foto(`financeiro-${largura}-C02-detalhes.png`);
        }
        await page.locator('.financeiro-detalhes-btn[data-id="' + ids.c02 + '"]').click();
        await page.waitForTimeout(300);
        await foto('financeiro-390-recolhido.png');

        // ---- Propostas ----
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.locator('#navPropostas').click();
        await page.locator('.proposta-documento').first().waitFor();
        assert.equal(await page.locator('#navFinanceiro.ativo').count(), 0, 'somente o menu atual fica ativo');
        assert.equal(await page.locator('#navPropostas.ativo').count(), 1);
        const cartoes = page.locator('.proposta-card, .proposta, [data-proposta-id]');
        relatorio.push(`cartões de proposta detectados: ${await cartoes.count()}`);
        const secoes = page.locator('.proposta-documento-destaque');
        assert.equal(await secoes.count(), 2, 'uma seção Documentos por proposta');
        const nomes = await Promise.all([0, 1].map(i => secoes.nth(i).locator('.proposta-documento-nome').allTextContents()));
        assert.deepEqual(nomes[0].map(t => t.trim()), ['Proposta_04.pdf'], 'antes do aceite: só a proposta');
        assert.deepEqual(nomes[1].map(t => t.trim()), ['Proposta_02.pdf', 'Comprovante de Contrato.pdf'], 'após o aceite: proposta congelada + comprovante, mesma seção');
        const links = await secoes.nth(1).locator('a').evaluateAll(as => as.map(a => a.getAttribute('href')));
        assert.deepEqual(links, [`/api/propostas/${ids.prop02}/proposta-aceita`, `/api/propostas/${ids.prop02}/comprovante`]);
        await foto('propostas-desktop-1440.png');
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(250);
        assert.equal(await semOverflow(), true);
        await foto('propostas-390.png');

        fs.writeFileSync(path.join(saida, 'comprovante-ficticio.pdf'), comprovante);
        assert.deepEqual(erros, [], 'sem erros de JavaScript na página');
        relatorio.push('sem erros de JavaScript; sem rede externa');
        fs.writeFileSync(path.join(saida, 'RELATORIO_QA_VISUAL.txt'), relatorio.join('\n') + '\n');
        console.log('QA visual OK:\n- ' + relatorio.join('\n- '));
    } finally {
        await browser.close();
        await new Promise(resolve => servidor.close(resolve));
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
