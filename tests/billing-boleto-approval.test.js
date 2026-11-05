'use strict';
// D2: boleto cadastrado no Airtable já foi aprovado pelo Financeiro. Vencido e NFSe ficam de fora. Sem rede.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { fixture, S } = require('./helpers/billing-fixtures');
const { CLIENT_EMAIL } = require('../lib/billing/source');
const { createService } = require('../lib/billing/service');
const { createWorker } = require('../lib/billing/worker');
const { register } = require('../lib/billing/routes');
const { configuration } = require('../lib/billing/config');
const { hash } = require('../lib/billing/protocol');
const N = S.NOTAS_FISCAIS, PENDING = /BOLETO_OVERDUE_RULE_PENDING/;
const cfg = { enabled: true, worker: true, origin: 'https://notifications.example.test', secret: Buffer.alloc(32, 3).toString('base64') };
const noFetch = async () => { throw new Error('must not send'); };
const worker = (f, fetcher = noFetch) => createWorker({ config: cfg, store: f.store, service: f.service, clock: f.clock, fetcher, random: () => 0 });
const types = f => f.events().map(e => e.payload.type);
const find = (f, type) => f.events().find(e => e.payload.type === type);
const pendingAudits = f => f.store.data.audit.filter(a => a.code === 'BOLETO_OVERDUE_RULE_PENDING').length;
const notifications = process.env.BILLING_NOTIFICATIONS_REPO || path.resolve(__dirname, '../../Emails_diarios_ITRengenharia');
const available = fs.existsSync(path.join(notifications, 'billing/receiver.js'));

// Aprovação do boleto.
test('registered boleto needs no attestation: queued and authorized', async () => {
    const f = fixture(); const e = await f.ready();
    assert.equal(e.payload.type, 'BOLETO_AVAILABLE');
    const { proof, bytes } = await f.service.validate(e.payload);
    assert.equal(proof.documentPayable, true); assert.equal(proof.payableAfterDue, false);
    assert.deepEqual(bytes.boleto, f.pdfs.boleto);
});
test('D−1 and D0 go out with only the registered boleto', async () => {
    const f = fixture(); await f.ready();
    f.setNow('2026-11-05T12:00:00Z'); await f.service.scan(); await f.service.validate(find(f, 'BOLETO_D_MINUS_1').payload);
    f.setNow('2026-11-06T12:00:00Z'); await f.service.scan(); await f.service.validate(find(f, 'BOLETO_DUE_TODAY').payload);
    assert.deepEqual(types(f), ['BOLETO_AVAILABLE', 'BOLETO_D_MINUS_1', 'BOLETO_DUE_TODAY']);
});
test('payment confirmation is unaffected', async () => {
    const f = fixture(); await f.ready(); f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago'; await f.service.scan(); await f.service.scan();
    const { proof } = await f.service.validate(find(f, 'BOLETO_PAYMENT_RECORDED').payload);
    assert.equal(proof.newPaymentTransition, true);
});

// Boleto vencido: regra pendente.
test('overdue reminders are not generated while the rule is pending', async () => {
    const f = fixture(); await f.ready();
    for (const day of ['11', '16', '21']) { f.setNow(`2026-11-${day}T12:00:00Z`); await f.service.scan(); }
    assert.ok(!types(f).includes('BOLETO_OVERDUE_REMINDER'));
    assert.ok(pendingAudits(f) >= 1, 'the block is visible in the audit');
});
test('boleto first registered after its due date generates no availability', async () => {
    const f = fixture(); await f.service.scan(); f.setNow('2026-11-07T12:00:00Z'); f.attach('boleto'); await f.service.scan();
    assert.equal(f.events().length, 0); assert.equal(pendingAudits(f), 1);
});
test('status Vencido blocks even with a future or missing due date', async t => {
    for (const due of ['2026-12-31', '']) await t.test(due || 'sem vencimento', async () => {
        const f = fixture(); f.invoice.fields[N.VENCIMENTO] = due; await f.service.scan();
        f.invoice.fields[N.STATUS_PAGAMENTO] = 'Vencido'; f.attach('boleto'); await f.service.scan();
        assert.equal(f.events().length, 0); assert.equal(pendingAudits(f), 1);
    });
});
test('the due day itself is not overdue, at the Sao Paulo boundary', async () => {
    const f = fixture(); const e = await f.ready();
    f.setNow('2026-11-07T02:59:59Z'); await f.service.validate(e.payload);
    f.setNow('2026-11-07T03:00:00Z'); await assert.rejects(f.service.validate(e.payload), PENDING);
});
test('queued boleto that becomes overdue is refused and never reaches Notifications', async () => {
    const f = fixture(); const e = await f.ready(); f.setNow('2026-11-07T12:00:00Z');
    await worker(f).deliver(e);
    const current = f.store.data.events.get(e.payload.eventId);
    assert.equal(current.status, 'cancelled'); assert.equal(current.reason, 'BOLETO_OVERDUE_RULE_PENDING');
});
test('status changed to Vencido after queueing denies every phase', async t => {
    for (const phase of ['prepare', 'pdf', 'smtp']) await t.test(phase, async () => {
        const f = fixture(); const e = await f.ready(); const current = f.store.data.events.get(e.payload.eventId);
        current.status = 'sending'; await f.store.repo.saveEvent(current);
        f.invoice.fields[N.STATUS_PAGAMENTO] = 'Vencido';
        await assert.rejects(f.service.validate(e.payload, phase), PENDING);
    });
});
test('the block is audited once a day, per invoice', async () => {
    const f = fixture(); await f.ready(); f.setNow('2026-11-11T12:00:00Z');
    for (let i = 0; i < 5; i++) await f.service.scan();
    assert.equal(pendingAudits(f), 1);
});
test('no configuration can release overdue boletos in the running application', () => {
    for (const file of ['index.js', 'config.js', 'routes.js', 'worker.js', 'source.js', 'store.js'])
        assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../lib/billing', file), 'utf8'), /overdueBoletoPayable/, file);
    const env = { PORTAL_BILLING_ENABLED: 'true', BILLING_HMAC_SECRET: cfg.secret, PORTAL_BILLING_STORAGE_KEY: Buffer.alloc(32, 9).toString('base64'), PORTAL_BILLING_NOTIFICATIONS_ORIGIN: cfg.origin };
    assert.ok(!Object.keys(configuration(env)).some(k => /overdue|payable/i.test(k)));
});
test('the recurring schedule stays intact behind the pending rule', async () => {
    const f = fixture({ overdueBoletoPayable: true }); await f.ready();
    f.setNow('2026-11-11T12:00:00Z'); await f.service.scan();
    const { proof } = await f.service.validate(find(f, 'BOLETO_OVERDUE_REMINDER').payload);
    assert.equal(proof.payableAfterDue, true);
});

// Verificações técnicas preservadas.
test('technical checks still deny a boleto', async t => {
    const changes = {
        contentSwapped: f => { f.pdfs.boleto = Buffer.from(f.pdfs.boleto.toString().replace('Boleto', 'Fraude')); },
        sizeChanged: f => { f.pdfs.boleto = Buffer.from('%PDF-1.4\nOutro conteudo\n%%EOF'); },
        notPdfMime: f => { f.invoice.fields[N.BOLETO][0].type = 'image/png'; },
        badAttachmentId: f => { f.invoice.fields[N.BOLETO][0].id = 'x'; },
        otherAttachment: f => { f.invoice.fields[N.BOLETO][0].id = 'attGGGGGGGGGGGGGG'; },
        twoAttachments: f => { f.invoice.fields[N.BOLETO].push({ ...f.invoice.fields[N.BOLETO][0], id: 'attGGGGGGGGGGGGGG' }); },
        removed: f => { f.invoice.fields[N.BOLETO] = []; },
        dueDateChanged: f => { f.invoice.fields[N.VENCIMENTO] = '2026-11-20'; },
        amountChanged: f => { f.invoice.fields[N.VALOR_PARCELA] = 1200; },
        installmentChanged: f => { f.invoice.fields[N.PARCELA] = 'Parcela 2'; },
        paid: f => { f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago'; },
        cancelled: f => { f.invoice.fields[N.STATUS_PAGAMENTO] = 'Cancelado'; },
        unknownStatus: f => { f.invoice.fields[N.STATUS_PAGAMENTO] = 'Outro'; },
        contractCancelled: f => { f.contract.fields[S.CONTRATOS.STATUS] = 'Cancelado'; },
        proposalNotAccepted: f => { f.proposal.fields[S.PROPOSTA.STATUS] = 'Enviada'; },
        invalidCnpj: f => { f.client.fields[S.CLIENTES.CNPJ] = '123'; },
        duplicateCnpj: f => { f.tables[S.TABELAS.CLIENTES].push({ ...f.client, id: 'recZZZZZZZZZZZZZZ' }); },
        brokenChain: f => { f.contract.fields[S.CONTRATOS.PARCELAS] = []; },
        recipientRemoved: f => { f.client.fields[CLIENT_EMAIL] = 'other@example.test'; }
    };
    for (const [name, change] of Object.entries(changes)) await t.test(name, async () => {
        const f = fixture(); const e = await f.ready(); change(f);
        await assert.rejects(f.service.validate(e.payload));
    });
});
test('invalid PDF content from the source is denied', async () => {
    const f = fixture(); const e = await f.ready(); const pdfReader = async () => { throw new Error('PDF_CONTENT_INVALID'); };
    const { createSource } = require('../lib/billing/source');
    const service = createService({ store: f.store, source: createSource({ airtable: f.airtable, cipher: f.store.cipher, pdfReader }), clock: f.clock });
    await assert.rejects(service.validate(e.payload));
});
test('a boleto replaced after detection stays held for reconciliation', async () => {
    const f = fixture(); await f.ready(); f.pdfs.boleto = Buffer.from('%PDF-1.4\nBoleto corrigido\n%%EOF'); f.attach('boleto');
    f.setNow('2026-11-05T12:00:00Z'); await f.service.scan();
    assert.deepEqual(types(f), ['BOLETO_AVAILABLE']);
    assert.ok(f.store.data.states.get(f.ids.invoice).blockedKinds.includes('boleto'));
});
test('a boleto already present at the baseline gets no retroactive message', async () => {
    const f = fixture(); f.attach('boleto'); await f.service.scan(); await f.service.scan();
    f.setNow('2026-11-05T12:00:00Z'); await f.service.scan();
    assert.equal(f.events().length, 0);
});
test('idempotence: same boleto keeps one event across scans and URL changes', async () => {
    const f = fixture(); const e = await f.ready();
    for (let i = 0; i < 5; i++) await f.service.scan();
    f.invoice.fields[N.BOLETO][0].url += '?novo-token'; await f.service.scan();
    assert.equal(f.events().length, 1); assert.equal(f.events()[0].payload.eventId, e.payload.eventId);
    assert.equal(f.events()[0].payload.document.sha256, hash(f.pdfs.boleto));
});

// Compatibilidade com o receptor real, sem alterar as Notificações.
function realReceiver(t, f, service = f.service) {
    const { createReceiver, ROUTE } = require(path.join(notifications, 'billing/receiver.js'));
    const { headers, canonical } = require('../lib/billing/protocol');
    const app = express(); register(app, express, { config: cfg, store: f.store, service, clock: f.clock });
    const srv = app.listen(0, '127.0.0.1');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'itr-billing-test-'));
    t.after(async () => { await new Promise(resolve => { srv.closeAllConnections(); srv.close(resolve); }); fs.rmSync(directory, { recursive: true, force: true }); });
    const sent = [];
    const receiver = createReceiver({ config: { enabled: true, secret: cfg.secret, origin: 'https://portal.example.test', directory }, clock: f.clock,
        fetcher: (url, options) => fetch(`http://127.0.0.1:${srv.address().port}${new URL(url).pathname}`, options),
        send: async args => { sent.push(args); return { ok: true }; } });
    const post = event => { const body = canonical(event); return receiver.handle({ method: 'POST', path: ROUTE, headers: headers(cfg.secret, 'POST', ROUTE, body, f.clock()) }, Buffer.from(body)); };
    const handle = options => receiver.handle({ method: 'POST', path: ROUTE, headers: options.headers }, Buffer.from(options.body));
    return { sent, post, handle, listening: new Promise(resolve => srv.once('listening', resolve)) };
}
test('real receiver sends availability, D−1 and D0 with the exact registered PDF', { skip: !available }, async t => {
    const f = fixture(); await f.ready(); const r = realReceiver(t, f); await r.listening;
    const w = worker(f, async (url, options) => { const x = await r.handle(options); return new Response(JSON.stringify(x.body), { status: x.status }); });
    const send = async type => { await w.deliver(find(f, type)); assert.equal(find(f, type).status, 'sent', type); };
    await send('BOLETO_AVAILABLE');
    f.setNow('2026-11-05T12:00:00Z'); await f.service.scan(); await send('BOLETO_D_MINUS_1');
    f.setNow('2026-11-06T12:00:00Z'); await f.service.scan(); await send('BOLETO_DUE_TODAY');
    assert.equal(r.sent.length, 3);
    for (const message of r.sent) assert.deepEqual(message.pdfs[0].content, f.pdfs.boleto);
});
test('real receiver sends nothing for an overdue reminder, even if one is presented', { skip: !available }, async t => {
    const f = fixture({ overdueBoletoPayable: true }); await f.ready(); f.setNow('2026-11-11T12:00:00Z'); await f.service.scan();
    const reminder = find(f, 'BOLETO_OVERDUE_REMINDER').payload;
    const current = find(f, 'BOLETO_OVERDUE_REMINDER'); current.status = 'sending'; await f.store.repo.saveEvent(current);
    // Same construction as lib/billing/index.js: no option, so the running default applies.
    const strict = createService({ store: f.store, source: f.source, clock: f.clock });
    await assert.rejects(strict.validate(reminder), PENDING);
    const r = realReceiver(t, f, strict); await r.listening;
    const result = await r.post(reminder);
    assert.equal(result.status, 503); assert.equal(result.body.code, 'PORTAL_VALIDATION_FAILED');
    assert.equal(r.sent.length, 0);
});
test('financial flags stay off by default', () => {
    assert.deepEqual(configuration({}), { enabled: false, worker: false });
});
