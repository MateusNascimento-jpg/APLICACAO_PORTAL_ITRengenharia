'use strict';
// Decisão da ITR: o PDF original continua pagável após o vencimento, com encargos tratados pelo banco. Sem rede.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { fixture, S } = require('./helpers/billing-fixtures');
const { CLIENT_EMAIL } = require('../lib/billing/source');
const { createWorker } = require('../lib/billing/worker');
const { register } = require('../lib/billing/routes');
const { valid } = require('../lib/billing/contract');
const { configuration } = require('../lib/billing/config');
const { hash } = require('../lib/billing/protocol');
const N = S.NOTAS_FISCAIS;
const cfg = { enabled: true, worker: true, origin: 'https://notifications.example.test', secret: Buffer.alloc(32, 3).toString('base64') };
const noFetch = async () => { throw new Error('must not send'); };
const worker = (f, fetcher = noFetch) => createWorker({ config: cfg, store: f.store, service: f.service, clock: f.clock, fetcher, random: () => 0 });
const reminders = f => f.events().filter(e => e.payload.type === 'BOLETO_OVERDUE_REMINDER');
const find = (f, type) => f.events().find(e => e.payload.type === type);
const notifications = process.env.BILLING_NOTIFICATIONS_REPO || path.resolve(__dirname, '../../Emails_diarios_ITRengenharia');
const available = fs.existsSync(path.join(notifications, 'billing/receiver.js'));
async function overdue(day = '11', prepare = () => {}) {
    const f = fixture(); await f.ready(); prepare(f); f.setNow(`2026-11-${day}T12:00:00Z`); await f.service.scan();
    return f;
}

// Lembretes retomados.
test('D+5, D+10, D+15 and later are generated while unpaid', async () => {
    const f = fixture(); await f.ready();
    for (const day of ['11', '16', '21', '26']) { f.setNow(`2026-11-${day}T12:00:00Z`); await f.service.scan(); }
    assert.deepEqual(reminders(f).map(e => e.payload.scheduledFor), ['2026-11-11', '2026-11-16', '2026-11-21', '2026-11-26']);
    assert.ok(reminders(f).every(e => valid(e.payload)));
});
test('the recurrence continues past the end of the month', async () => {
    const f = fixture(); await f.ready(); f.setNow('2026-12-06T12:00:00Z'); await f.service.scan();
    assert.deepEqual(reminders(f).map(e => e.payload.scheduledFor), ['2026-12-06']);
});
test('D+1, D+6 and other days generate nothing, and missed days are not recovered', async () => {
    const f = fixture(); await f.ready();
    for (const day of ['07', '12', '13']) { f.setNow(`2026-11-${day}T12:00:00Z`); await f.service.scan(); }
    assert.equal(reminders(f).length, 0);
    f.setNow('2026-11-16T12:00:00Z'); await f.service.scan();
    assert.deepEqual(reminders(f).map(e => e.payload.scheduledFor), ['2026-11-16']);
});
test('the reminder attaches the original registered PDF, read again at each phase', async () => {
    const f = await overdue(); const e = find(f, 'BOLETO_OVERDUE_REMINDER');
    assert.equal(e.payload.document.kind, 'boleto'); assert.equal(e.payload.document.sha256, hash(f.pdfs.boleto));
    const current = f.store.data.events.get(e.payload.eventId); current.status = 'sending'; await f.store.repo.saveEvent(current);
    for (const phase of ['prepare', 'pdf', 'smtp']) {
        const { bytes, proof } = await f.service.validate(e.payload, phase);
        assert.deepEqual(bytes.boleto, f.pdfs.boleto); assert.equal(proof.documentPayable, true); assert.equal(proof.payableAfterDue, true);
    }
});
test('status Vencido does not stop the reminder', async () => {
    const f = await overdue('11', x => { x.invoice.fields[N.STATUS_PAGAMENTO] = 'Vencido'; });
    assert.equal(reminders(f).length, 1);
    await f.service.validate(reminders(f)[0].payload);
});
test('the amount is never recalculated', async () => {
    const f = fixture(); await f.ready();
    for (const day of ['11', '16', '21']) { f.setNow(`2026-11-${day}T12:00:00Z`); await f.service.scan(); }
    assert.deepEqual(reminders(f).map(e => e.payload.amountCents), [150050, 150050, 150050]);
});
test('one event per occurrence and per address, across repeated scans', async () => {
    const f = await overdue('11', x => { x.client.fields[CLIENT_EMAIL] += ';second@example.test'; });
    for (let i = 0; i < 5; i++) await f.service.scan();
    assert.equal(reminders(f).length, 2); assert.equal(new Set(reminders(f).map(e => e.payload.eventId)).size, 2);
});

// Integridade e vínculo.
test('technical checks still deny a reminder', async t => {
    const changes = {
        contentSwapped: f => { f.pdfs.boleto = Buffer.from(f.pdfs.boleto.toString().replace('Boleto', 'Fraude')); },
        sizeChanged: f => { f.pdfs.boleto = Buffer.from('%PDF-1.4\nOutro conteudo\n%%EOF'); },
        notPdfMime: f => { f.invoice.fields[N.BOLETO][0].type = 'image/png'; },
        otherAttachment: f => { f.invoice.fields[N.BOLETO][0].id = 'attGGGGGGGGGGGGGG'; },
        removed: f => { f.invoice.fields[N.BOLETO] = []; },
        invalidCnpj: f => { f.client.fields[S.CLIENTES.CNPJ] = '123'; },
        duplicateCnpj: f => { f.tables[S.TABELAS.CLIENTES].push({ ...f.client, id: 'recZZZZZZZZZZZZZZ' }); },
        otherClient: f => { f.proposal.fields[S.PROPOSTA.CLIENTE] = ['recZZZZZZZZZZZZZZ']; },
        brokenChain: f => { f.contract.fields[S.CONTRATOS.PARCELAS] = []; },
        recipientRemoved: f => { f.client.fields[CLIENT_EMAIL] = 'other@example.test'; },
        amountChanged: f => { f.invoice.fields[N.VALOR_PARCELA] = 1600; },
        dueDateChanged: f => { f.invoice.fields[N.VENCIMENTO] = '2026-11-30'; }
    };
    for (const [name, change] of Object.entries(changes)) await t.test(name, async () => {
        const f = await overdue(); change(f);
        await assert.rejects(f.service.validate(reminders(f)[0].payload));
    });
});
test('a replaced boleto is not attached and stays held for reconciliation', async () => {
    const f = await overdue('11', x => { x.pdfs.boleto = Buffer.from('%PDF-1.4\nSegunda via\n%%EOF'); x.attach('boleto'); });
    assert.equal(reminders(f).length, 0);
    assert.ok(f.store.data.states.get(f.ids.invoice).blockedKinds.includes('boleto'));
});
test('API failure on authorization: no send, intent stays retryable', async () => {
    const f = await overdue(); f.airtable.obterRegistro = async () => { throw new Error('network offline'); };
    const e = reminders(f)[0]; await worker(f).deliver(e);
    assert.equal(f.store.data.events.get(e.payload.eventId).status, 'retry');
});

// Pagamento revalidado antes de cada envio; parcela ativa.
test('paid before the occurrence: no reminder, only one confirmation', async () => {
    const f = fixture(); await f.ready(); f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago'; await f.service.scan(); await f.service.scan();
    f.setNow('2026-11-11T12:00:00Z'); await f.service.scan();
    assert.equal(reminders(f).length, 0);
    assert.equal(f.events().filter(e => e.payload.type === 'BOLETO_PAYMENT_RECORDED').length, 1);
});
test('paid after a reminder: it is cancelled and no later occurrence arises', async () => {
    const f = await overdue(); f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago'; await f.service.scan();
    await assert.rejects(f.service.validate(reminders(f)[0].payload));
    f.setNow('2026-11-16T12:00:00Z'); await f.service.scan();
    assert.deepEqual(reminders(f).map(e => e.status), ['cancelled']);
});
test('paid after queueing and before the scan: the proof refuses, with no HTTP call', async () => {
    const f = await overdue(); const e = reminders(f)[0]; f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago';
    await worker(f).deliver(e);
    assert.equal(f.store.data.events.get(e.payload.eventId).status, 'cancelled');
});
test('paid between prepare and SMTP: no lease', async () => {
    const f = await overdue(); const e = reminders(f)[0]; const current = f.store.data.events.get(e.payload.eventId);
    current.status = 'sending'; await f.store.repo.saveEvent(current);
    await f.service.validate(e.payload, 'prepare'); f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago';
    await assert.rejects(f.service.validate(e.payload, 'smtp'));
    assert.deepEqual(f.store.data.states.get(f.ids.invoice).leases, []);
});
test('a payment reversal does not restart reminders on its own', async () => {
    const f = fixture(); await f.ready(); f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago'; await f.service.scan();
    f.invoice.fields[N.STATUS_PAGAMENTO] = 'Vencido'; f.setNow('2026-11-11T12:00:00Z'); await f.service.scan();
    assert.equal(reminders(f).length, 0);
});
test('inactive installment or contract gets no reminder', async t => {
    const changes = {
        parcelaCancelada: f => { f.invoice.fields[N.STATUS_PAGAMENTO] = 'Cancelado'; },
        contratoCancelado: f => { f.contract.fields[S.CONTRATOS.STATUS] = 'Cancelado'; },
        propostaNaoAceita: f => { f.proposal.fields[S.PROPOSTA.STATUS] = 'Enviada'; },
        statusDesconhecido: f => { f.invoice.fields[N.STATUS_PAGAMENTO] = 'Outro'; }
    };
    for (const [name, change] of Object.entries(changes)) await t.test(name, async () => {
        const f = await overdue('11', change); assert.equal(reminders(f).length, 0);
    });
});

// Sem retroativos.
test('a boleto already present at the baseline is not reminded', async () => {
    const f = fixture(); f.attach('boleto'); await f.service.scan();
    f.setNow('2026-11-11T12:00:00Z'); await f.service.scan();
    assert.equal(f.events().length, 0);
});
test('a cancelled event is not recreated, and the next occurrence still arises', async () => {
    const f = await overdue(); const e = reminders(f)[0]; const current = f.store.data.events.get(e.payload.eventId);
    current.status = 'cancelled'; await f.store.repo.saveEvent(current); await f.service.scan();
    assert.equal(reminders(f).length, 1);
    f.setNow('2026-11-16T12:00:00Z'); await f.service.scan();
    assert.deepEqual(reminders(f).map(x => x.status), ['cancelled', 'pending']);
});
test('a contact added after the occurrence only joins the next one', async () => {
    const f = await overdue(); f.client.fields[CLIENT_EMAIL] += ';novo@example.test'; await f.service.scan();
    assert.equal(reminders(f).length, 1);
    f.setNow('2026-11-16T12:00:00Z'); await f.service.scan();
    assert.equal(reminders(f).filter(e => e.payload.scheduledFor === '2026-11-16').length, 2);
});

// Receptor real, contrato e flags sem alteração.
test('real receiver delivers the reminder with the original PDF, once', { skip: !available }, async t => {
    const { createReceiver, ROUTE } = require(path.join(notifications, 'billing/receiver.js'));
    const { render } = require(path.join(notifications, 'billing/template.js'));
    const f = await overdue();
    const app = express(); register(app, express, { config: cfg, store: f.store, service: f.service, clock: f.clock });
    const srv = app.listen(0, '127.0.0.1'); await new Promise(resolve => srv.once('listening', resolve));
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'itr-billing-test-'));
    t.after(async () => { await new Promise(resolve => { srv.closeAllConnections(); srv.close(resolve); }); fs.rmSync(directory, { recursive: true, force: true }); });
    const sent = [];
    const receiver = createReceiver({ config: { enabled: true, secret: cfg.secret, origin: 'https://portal.example.test', directory }, clock: f.clock,
        fetcher: (url, options) => fetch(`http://127.0.0.1:${srv.address().port}${new URL(url).pathname}`, options),
        send: async args => { sent.push(args); return { ok: true }; } });
    const w = worker(f, async (url, options) => {
        const r = await receiver.handle({ method: 'POST', path: ROUTE, headers: options.headers }, Buffer.from(options.body));
        return new Response(JSON.stringify(r.body), { status: r.status });
    });
    const e = reminders(f)[0];
    await w.deliver(e); await w.deliver(f.store.data.events.get(e.payload.eventId));
    assert.equal(f.store.data.events.get(e.payload.eventId).status, 'sent');
    assert.equal(sent.length, 1); assert.deepEqual(sent[0].pdfs[0].content, f.pdfs.boleto); assert.equal(sent[0].pdfs[0].filename, 'Boleto.pdf');
    const { texto } = render(e.payload, f.clock(), null);
    assert.doesNotMatch(texto, /%|ao dia|juros de|multa de/i, 'no invented percentage'); assert.match(texto, /1\.500,50/);
    assert.match(texto, /acréscimos previstos em contrato/); assert.doesNotMatch(texto, /elegibilidade|revalidad/i);
});
test('the block is gone from the code, and the contract still requires the document', async () => {
    const dir = path.join(__dirname, '../lib/billing');
    for (const file of fs.readdirSync(dir)) assert.doesNotMatch(fs.readFileSync(path.join(dir, file), 'utf8'), /BOLETO_OVERDUE_RULE_PENDING|overdueBoletoPayable/, file);
    const f = await overdue();
    assert.equal(valid({ ...reminders(f)[0].payload, document: null }), false);
});
test('financial flags stay off by default', () => {
    assert.deepEqual(configuration({}), { enabled: false, worker: false });
});
