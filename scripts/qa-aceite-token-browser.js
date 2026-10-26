'use strict';

// QA de navegador do modal de aceite (correções de 26/10/2026): retomada sem
// novo código, contagem regressiva, HTTP 429 com Retry-After, substituição de
// código, erro de código, confirmação com resposta perdida e tema/celular.
// Loopback + dados sintéticos + store em memória; relógio controlado no
// navegador (page.clock) e no serviço. Requer Playwright instalado à parte.
// Uso: node scripts/qa-aceite-token-browser.js [pasta-de-capturas]

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright');
const { memoryStore } = require('../tests/helpers/proposals-memory');
const { createSecrets } = require('../lib/proposals/crypto');
const { createService } = require('../lib/proposals/service');
const { createAuthorizedContacts } = require('../lib/proposals/authorized-contacts');
const { registerRoutes } = require('../lib/proposals/routes');

async function main() {
    const output = path.resolve(process.argv[2] || 'qa-aceite-token');
    fs.mkdirSync(output, { recursive: true });
    const START = Date.parse('2026-10-26T13:00:00Z');
    let clock = START;
    const store = memoryStore();
    const secrets = createSecrets(Buffer.alloc(32, 11).toString('base64'));
    const proposal = {
        id: 'recAAAAAAAAAAAAAA', numero: '101/2026', cnpj: '12345678000190', clienteId: 'recBBBBBBBBBBBBBB',
        nomeCliente: 'Empresa de Validação', emails: ['compras@example.test', 'diretoria@example.test'],
        valor: 12500, formaPagamento: 'Boleto', prazoPagamentoDias: 30, dataEnvio: '2026-10-09',
        status: 'Enviada', createdTime: new Date(START).toISOString(),
        anexos: [{ id: 'attAAAAAAAAAAAAAA', filename: 'Proposta.pdf', url: 'https://dl.airtable.com/x' }],
        documentos: [{ id: 'attAAAAAAAAAAAAAA', nome: 'Proposta.pdf' }],
    };
    const patches = [];
    const service = createService({
        store, secrets, authorizedContacts: createAuthorizedContacts(), origin: 'https://portal.itr.test',
        enabled: () => true, now: () => clock,
        pdf: async () => ({ hash: secrets.hash('pdf'), bytes: Buffer.from('%PDF-1.4\n%%EOF\n') }),
        airtable: {
            carregarPropostaAtual: async () => structuredClone(proposal),
            atualizarDecisao: async (_, status) => { patches.push(status); proposal.status = status; },
        },
    });
    let limited = null;
    const app = express();
    if (process.env.QA_DEBUG) app.use((req, res, next) => { res.on('finish', () => console.log(req.method, req.url, res.statusCode)); next(); });
    app.use(express.json());
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const pass = (_, __, next) => next();
    registerRoutes(app, {
        service, store, secrets, config: { production: false, notifications: {} }, worker: { wake() {} },
        auth: (req, _, next) => { req.session = { role: 'GeneratedClient', documento: proposal.cnpj }; next(); },
        client: pass, write: pass, audit: async () => {},
        csrf: (req, res, next) => (req.get('x-csrf-token') === 'fixture-csrf-token-0000' ? next() : res.sendStatus(403)),
        origin: (req, res, next) => (req.get('origin') === origin ? next() : res.sendStatus(403)),
        consume: async (scope) => (limited && scope === limited.scope ? { ok: false, retryAfterMs: limited.ms } : { ok: true }),
    });
    app.get('/api/perfil', (_, res) => res.json({ sucesso: true, usuario: { perfil: 'Cliente', documento: proposal.cnpj, nomeEmpresa: proposal.nomeCliente } }));
    app.get('/api/navegacao', (_, res) => res.json({ sucesso: true, propostas: true, relatorios: false }));
    app.get('/api/conta', (_, res) => res.json({ sucesso: true, conta: {} }));
    app.get('/api/runtime', (_, res) => res.json({ safeMode: false }));
    app.get('/api/csrf', (_, res) => res.json({ csrfToken: 'fixture-csrf-token-0000' }));
    app.get('/api/meus-dados', (_, res) => res.json({ sucesso: true, trabalhos: [], nome_cliente: proposal.nomeCliente }));
    app.get('/api/propostas', (_, res) => res.json({ sucesso: true, propostas: [proposal] }));
    app.use(express.static(path.resolve(__dirname, '../public')));

    const verifyCodes = () => [...store.events.values()].map((e) => secrets.open(e.payload))
        .filter((e) => e.type === 'VERIFY').map((e) => e.code);
    const browser = await chromium.launch({
        headless: true, executablePath: process.env.ITR_QA_CHROMIUM || undefined,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const errors = [];
    const step = (name) => console.log('QA: ' + name);
    let page;
    try {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
        await context.route('**/*', (route) => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
        await context.addInitScript(() => localStorage.setItem('itr-tour-version', '1'));
        context.setDefaultTimeout(10000);
        page = await context.newPage();
        page.on('pageerror', (error) => errors.push(error.message));
        if (process.env.QA_DEBUG) page.on('console', (m) => console.log('console:', m.type(), m.text()));
        page.on('dialog', (dialog) => dialog.accept());
        await page.clock.install({ time: START });
        const advance = async (ms) => { clock += ms; await page.clock.runFor(ms); };
        const modal = page.locator('dialog.proposta-modal');
        const message = modal.locator('.proposta-modal-mensagem');
        const status = modal.locator('.proposta-modal-estado');
        const wait = modal.locator('.proposta-modal-espera');

        await page.goto(origin + '/portal.html');
        await page.locator('#navPropostas').click();
        // Com uma única proposta o cartão já abre expandido.
        await page.locator('.proposta-resumo[aria-expanded="true"]').waitFor();

        step('primeiro pedido');
        await page.getByRole('button', { name: 'Aceitar proposta', exact: true }).click();
        await modal.getByRole('button', { name: 'Enviar código por e-mail' }).click();
        await status.getByText('Código solicitado para co***@example.test', { exact: false }).waitFor();
        assert.match(await status.textContent(), /\(restam 2 h 00 min\)/);
        assert.match(await message.textContent(), /Solicitação registrada\. Verifique a caixa de entrada e a pasta de spam de co\*\*\*@example\.test\./);
        assert.equal(await modal.getByRole('button', { name: 'Solicitar novo código' }).isDisabled(), true);
        assert.equal(await wait.textContent(), 'Novo código disponível em 1 min 00 s.');
        assert.equal(store.challenges.size, 1);
        await page.screenshot({ path: path.join(output, '01-codigo-solicitado.png') });

        step('estado de entrega atualizado pela fila');
        const [eventId] = store.events.keys();
        await store.eventState(eventId, 'sent');
        await advance(4000);
        await message.getByText('E-mail com o código enviado para co***@example.test.').waitFor();
        assert.equal(await wait.textContent(), 'Novo código disponível em 56 s.');

        step('fechar e reabrir: retoma o mesmo código, sem novo pedido');
        await modal.getByRole('button', { name: 'Fechar', exact: true }).click();
        await advance(10 * 60000);
        await page.getByRole('button', { name: 'Aceitar proposta', exact: true }).click();
        await status.getByText('Código solicitado para co***@example.test', { exact: false }).waitFor();
        assert.match(await status.textContent(), /\(restam 1 h 50 min\)/);
        await modal.locator('.proposta-codigo').waitFor();
        assert.equal(await modal.getByRole('button', { name: 'Solicitar novo código' }).isDisabled(), false);
        assert.equal(store.challenges.size, 1);
        assert.equal(verifyCodes().length, 1);
        assert.equal(await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage) + document.cookie)
            .then((text) => text.includes(verifyCodes()[0])), false);
        await page.screenshot({ path: path.join(output, '02-retomada-apos-reabrir.png') });

        step('código errado mostra tentativas restantes');
        await modal.locator('.proposta-codigo').fill(verifyCodes()[0] === '00000000' ? '11111111' : '00000000');
        await modal.getByRole('button', { name: 'Validar código' }).click();
        await message.getByText('Código inválido.', { exact: false }).waitFor();
        await status.getByText('Tentativas restantes: 4.', { exact: false }).waitFor();

        step('novo código substitui o anterior e aplica intervalo crescente');
        await modal.getByLabel('E-mail autorizado').selectOption({ label: 'di***@example.test' });
        await modal.getByRole('button', { name: 'Solicitar novo código' }).click();
        await message.getByText('O código anterior foi substituído e não vale mais.', { exact: false }).waitFor();
        await status.getByText('Código solicitado para di***@example.test', { exact: false }).waitFor();
        assert.equal(await wait.textContent(), 'Novo código disponível em 2 min 00 s.');
        assert.equal(verifyCodes().length, 2);

        step('HTTP 429 com Retry-After: tempo exibido e botão reabilitado sem recarregar');
        await advance(2 * 60000);
        limited = { scope: 'proposal-request-account', ms: 754000 };
        await modal.getByRole('button', { name: 'Solicitar novo código' }).click();
        await message.getByText('Muitas tentativas em sequência. Tente novamente em 12 min 34 s.').waitFor();
        assert.equal(await wait.textContent(), 'Novo código disponível em 12 min 34 s.');
        assert.equal(await modal.getByRole('button', { name: 'Solicitar novo código' }).isDisabled(), true);
        await modal.locator('.proposta-codigo').waitFor(); // digitação continua disponível
        await page.screenshot({ path: path.join(output, '03-limite-429-contagem.png') });
        await advance(754000);
        limited = null;
        assert.equal(await wait.isHidden(), true);
        assert.equal(await message.textContent(), '');
        assert.equal(await modal.getByRole('button', { name: 'Solicitar novo código' }).isDisabled(), false);

        step('celular e tema escuro');
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: path.join(output, '04-celular.png') });
        await page.evaluate(() => ITR.aplicarTema('escuro'));
        await page.screenshot({ path: path.join(output, '05-celular-tema-escuro.png') });
        await page.evaluate(() => ITR.aplicarTema('claro'));
        await page.setViewportSize({ width: 1280, height: 900 });

        step('código correto, consentimento e resposta perdida');
        await modal.locator('.proposta-codigo').fill(verifyCodes().at(-1));
        await modal.getByRole('button', { name: 'Validar código' }).click();
        const consent = modal.getByLabel('Li as condições comerciais e concordo com o aceite desta proposta.');
        await consent.waitFor();
        assert.deepEqual(patches, []);
        assert.equal(await consent.isChecked(), false);
        // O servidor processa o aceite, mas a resposta não chega ao navegador.
        await page.route('**/aceite/confirmar', async (route) => { await route.fetch(); await route.abort('connectionreset'); });
        await consent.check();
        await modal.getByRole('button', { name: 'Confirmar aceite da proposta' }).click();
        await modal.getByText('Aceite confirmado. Sua decisão foi registrada', { exact: false }).waitFor();
        await page.unroute('**/aceite/confirmar');
        assert.deepEqual(patches, ['Aceita']);
        await page.screenshot({ path: path.join(output, '06-aceite-com-resposta-perdida.png') });

        step('reabrir após o aceite não oferece novo código');
        await modal.getByRole('button', { name: 'Fechar', exact: true }).click();
        await page.evaluate(() => ITRProposals.accept({ id: 'recAAAAAAAAAAAAAA', numero: '101/2026' }, null, null));
        await modal.getByText('Esta proposta já possui decisão registrada (Aceita).').waitFor();
        assert.equal(await modal.getByRole('button', { name: /código/ }).count(), 0);
        assert.deepEqual(patches, ['Aceita']);
        assert.deepEqual(errors, []);
        console.log('QA concluído: ' + output);
    } catch (error) {
        if (page) await page.screenshot({ path: path.join(output, 'falha.png') }).catch(() => {});
        console.error('Mensagem do modal:', await page?.locator('.proposta-modal-mensagem').textContent().catch(() => ''));
        console.error('Erros de página:', errors);
        throw error;
    } finally {
        await browser.close();
        server.close();
        server.closeAllConnections();
    }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
