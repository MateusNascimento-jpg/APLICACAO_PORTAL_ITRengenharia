'use strict';

// Browser QA uses only a loopback server, synthetic data and in-memory persistence.
// Install Playwright separately; this script never loads the application's .env or db.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright');
const { memoryStore } = require('../tests/helpers/proposals-memory');
const { createSecrets } = require('../lib/proposals/crypto');
const { createService } = require('../lib/proposals/service');
const { registerRoutes } = require('../lib/proposals/routes');
const { readPdf, disposition } = require('../lib/proposals/pdf');

function makePdf() {
    let content = '%PDF-1.4\n';
    const stream = 'BT /F1 20 Tf 50 760 Td (Proposta original - teste local ITR) Tj ET';
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ];
    const offsets = [0];
    objects.forEach((object, index) => {
        offsets.push(Buffer.byteLength(content));
        content += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = Buffer.byteLength(content);
    content += `xref\n0 6\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => String(offset).padStart(10, '0') + ' 00000 n ')
        .join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(content);
}

async function main() {
    const output = path.resolve(process.argv[2] || 'qa-proposals');
    fs.mkdirSync(output, { recursive: true });
    const app = express();
    app.use(express.json());
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const store = memoryStore();
    const secrets = createSecrets(Buffer.alloc(32, 9).toString('base64'));
    const pdf = makePdf();
    fs.writeFileSync(path.join(output, 'original.pdf'), pdf);
    const proposal = {
        id: 'recAAAAAAAAAAAAAA',
        numero: '101/2026',
        cnpj: '12345678000190',
        clienteId: 'recBBBBBBBBBBBBBB',
        nomeCliente: 'Empresa de Validação',
        emails: ['compras@example.test'],
        valor: 12500,
        formaPagamento: 'Boleto',
        prazoPagamentoDias: 30,
        dataEnvio: '2026-10-09',
        status: 'Enviada',
        createdTime: new Date().toISOString(),
        anexos: [
            {
                id: 'attA',
                filename: 'Proposta original.pdf',
                url: 'https://dl.airtable.com/test-only',
            },
        ],
        documentos: [{ id: 'attA', nome: 'Proposta original.pdf' }],
    };
    const service = createService({
        store,
        secrets,
        origin,
        enabled: () => true,
        pdf: async () => ({ hash: secrets.hash(pdf) }),
        airtable: {
            carregarPropostaAtual: async () => structuredClone(proposal),
            atualizarDecisao: async (_, status, feedback) => {
                proposal.status = status;
                proposal.feedback = feedback;
            },
        },
    });
    const next = (_, __, done) => done();
    const auth = (req, res, done) => {
        req.session = { role: 'GeneratedClient', documento: proposal.cnpj };
        done();
    };
    registerRoutes(app, {
        service,
        store,
        secrets,
        config: { production: false, notifications: {} },
        worker: { wake() {} },
        auth,
        client: next,
        csrf: (req, res, done) =>
            req.get('x-csrf-token') === 'fixture-csrf' ? done() : res.sendStatus(403),
        origin: (req, res, done) => (req.get('origin') === origin ? done() : res.sendStatus(403)),
        write: next,
        consume: async () => ({ ok: true }),
        audit: async () => {},
    });
    app.get('/api/perfil', (_, res) =>
        res.json({
            sucesso: true,
            usuario: {
                perfil: 'Cliente',
                documento: proposal.cnpj,
                nomeEmpresa: proposal.nomeCliente,
            },
        }),
    );
    app.get('/api/navegacao', (_, res) =>
        res.json({ sucesso: true, propostas: true, relatorios: false }),
    );
    app.get('/api/conta', (_, res) => res.json({ sucesso: true, conta: {} }));
    app.get('/api/runtime', (_, res) => res.json({ safeMode: false }));
    app.get('/api/csrf', (_, res) => res.json({ csrfToken: 'fixture-csrf' }));
    app.get('/api/meus-dados', (_, res) =>
        res.json({ sucesso: true, trabalhos: [], nome_cliente: proposal.nomeCliente }),
    );
    app.get('/api/propostas', (_, res) => res.json({ sucesso: true, propostas: [proposal] }));
    app.get('/api/propostas/:id/documento/:attachmentId', async (_, res) => {
        const document = await readPdf(
            'https://dl.airtable.com/test-only',
            async () => new Response(pdf, { headers: { 'content-type': 'application/pdf' } }),
        );
        res.set('Content-Type', 'application/pdf');
        res.set('Content-Disposition', disposition('Proposta original.pdf'));
        res.send(document.bytes);
    });
    app.use(express.static(path.resolve(__dirname, '../public')));
    const browser = await chromium.launch({
        headless: true,
        executablePath: process.env.ITR_QA_CHROMIUM || undefined,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await context.route('**/*', (route) =>
            route.request().url().startsWith(origin) ? route.continue() : route.abort(),
        );
        await context.addInitScript(() => localStorage.setItem('itr-tour-version', '1'));
        context.setDefaultTimeout(15000);
        const page = await context.newPage();
        const errors = [];
        console.log('QA: Portal');
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(origin + '/portal.html');
        await page.locator('#navPropostas').click();
        await page.locator('.proposta-resumo').click();
        await page.screenshot({ path: path.join(output, 'portal-desktop.png'), fullPage: true });
        console.log('QA: PDF HTTP');
        const documentResponse = await context.request.get(
            origin + '/api/propostas/' + proposal.id + '/documento/attA',
            { timeout: 10000 },
        );
        assert.deepEqual(await documentResponse.body(), pdf);
        assert.match(documentResponse.headers()['content-type'], /application\/pdf/);
        console.log('QA: link PDF');
        const downloadPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
        const popupPromise = page.waitForEvent('popup', { timeout: 10000 }).catch(() => null);
        await page.getByText('Visualizar PDF', { exact: false }).click();
        const [download, popup] = await Promise.all([downloadPromise, popupPromise]);
        assert.ok(
            download || popup,
            'O clique precisa abrir o PDF ou iniciar seu download no navegador.',
        );
        if (download) {
            const target = path.join(output, 'browser-original.pdf');
            await download.saveAs(target);
            assert.deepEqual(fs.readFileSync(target), pdf);
        }
        if (popup) await popup.close();
        console.log('QA: código');
        await page.getByRole('button', { name: 'Aceitar proposta', exact: true }).click();
        await page.getByRole('button', { name: 'Gerar código e solicitar e-mail' }).click();
        await page.locator('.proposta-codigo').waitFor();
        const code = await page.locator('.proposta-codigo').inputValue();
        assert.match(code, /^\d{8}$/);
        await page.screenshot({ path: path.join(output, 'codigo-desktop.png'), fullPage: true });
        const payload = secrets.open([...store.events.values()][0].payload);
        console.log('QA: confirmação');
        const confirmation = await context.newPage();
        confirmation.on('pageerror', (error) => errors.push(error.message));
        await confirmation.goto(payload.actionUrl);
        await confirmation.locator('#code').fill(code);
        await confirmation.getByRole('button', { name: 'Validar código' }).click();
        await confirmation.locator('#confirmForm').waitFor({ state: 'visible' });
        assert.equal(proposal.status, 'Enviada');
        await confirmation.screenshot({
            path: path.join(output, 'confirmacao-desktop.png'),
            fullPage: true,
        });
        await confirmation.setViewportSize({ width: 390, height: 844 });
        await confirmation.screenshot({
            path: path.join(output, 'confirmacao-mobile.png'),
            fullPage: true,
        });
        assert.equal(
            await confirmation.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
        );
        await confirmation.locator('#consent').check();
        await confirmation.getByRole('button', { name: 'Confirmar aceite da proposta' }).click();
        await confirmation.getByText('Proposta aceita com sucesso.', { exact: false }).waitFor();
        assert.equal(proposal.status, 'Aceita');
        console.log('QA: rejeição');
        await page.getByRole('button', { name: 'Fechar', exact: true }).click();
        proposal.status = 'Enviada';
        store.states.clear();
        await page.evaluate(() => carregarPropostas(true));
        await page.getByRole('button', { name: 'Rejeitar proposta', exact: true }).click();
        await page
            .getByLabel('Motivo da rejeição (obrigatório)')
            .fill('Prazo incompatível com nossa necessidade.');
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: path.join(output, 'rejeicao-mobile.png'), fullPage: true });
        assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
        );
        await page
            .getByRole('button', { name: 'Enviar feedback e rejeitar proposta', exact: true })
            .click();
        await page.getByText('A proposta foi rejeitada', { exact: false }).waitFor();
        assert.equal(proposal.status, 'Rejeitada');
        assert.match(proposal.feedback, /Prazo incompatível/);
        console.log('QA: navegação e temas');
        for (const viewport of [
            { width: 1440, height: 1000 },
            { width: 390, height: 844 },
        ]) {
            await page.setViewportSize(viewport);
            for (const [propostas, relatorios] of [
                [true, false],
                [false, true],
                [true, true],
                [false, false],
            ]) {
                await context.route('**/api/navegacao', (route) =>
                    route.fulfill({ json: { sucesso: true, propostas, relatorios } }),
                );
                await page.goto(origin + '/portal.html');
                await page.locator('#navegacaoEstado').waitFor({ state: 'hidden' });
                const items = await page.locator('.sidebar-item:visible').allTextContents();
                assert.deepEqual(
                    items.map((value) => value.trim()),
                    [
                        ...(propostas ? ['Propostas'] : []),
                        ...(relatorios ? ['Relatórios'] : []),
                        'Conta',
                        'Ajuda',
                        'Site ITR',
                    ],
                );
                assert.equal(
                    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                    true,
                );
                await context.unroute('**/api/navegacao');
            }
        }
        await page.goto(origin + '/portal.html');
        await page.locator('.proposta-resumo').click();
        for (const theme of ['escuro', 'claro']) {
            await page.evaluate(
                (value) => document.documentElement.setAttribute('data-tema', value),
                theme,
            );
            await page.waitForTimeout(500); // aguarda a transição de tema existente
            await page.screenshot({
                path: path.join(output, 'documento-mobile-' + theme + '.png'),
                fullPage: true,
            });
            const colors = await page.locator('.proposta-documento').evaluate((element) => ({
                background: getComputedStyle(element).backgroundColor,
                text: getComputedStyle(element.querySelector('.proposta-documento-nome')).color,
            }));
            assert.notEqual(colors.background, 'rgba(255, 255, 255, 0.62)');
            assert.notEqual(colors.text, colors.background);
        }
        assert.deepEqual(errors, []);
        console.log(
            'Browser QA OK: desktop/mobile, PDF original, código, confirmação explícita e rejeição; sem rede externa.',
        );
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
