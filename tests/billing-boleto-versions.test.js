'use strict';
// D3: correções de vencimento, valor e PDF. O Airtable segue somente leitura; sem rede.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { fixture, S } = require('./helpers/billing-fixtures');
const { CLIENT_EMAIL } = require('../lib/billing/source');
const { createService, UPDATE_SETTLE_MS } = require('../lib/billing/service');
const { createWorker } = require('../lib/billing/worker');
const { register } = require('../lib/billing/routes');
const { hash } = require('../lib/billing/protocol');
const N = S.NOTAS_FISCAIS;
const cfg = { enabled: true, worker: true, origin: 'https://notifications.example.test', secret: Buffer.alloc(32, 3).toString('base64') };
const notifications = process.env.BILLING_NOTIFICATIONS_REPO || path.resolve(__dirname, '../../Emails_diarios_ITRengenharia');
const available = fs.existsSync(path.join(notifications, 'billing/receiver.js'));
const of = (f, type) => f.events().filter(e => e.payload.type === type);
const updates = f => of(f, 'BOLETO_UPDATED');
const stored = (f, e) => f.store.data.events.get(e.payload.eventId);
const audits = (f, code) => f.store.data.audit.filter(a => a.code === code);
const later = (f, ms = UPDATE_SETTLE_MS) => f.setNow(f.clock() + ms);
// Delivers everything queued, as the worker does, through a receiver that always confirms.
async function deliver(f) {
    const w = createWorker({ config: cfg, store: f.store, service: f.service, clock: f.clock, random: () => 0,
        fetcher: async (url, options) => new Response(JSON.stringify({ ok: true, code: 'SENT', eventId: JSON.parse(options.body).eventId }), { status: 200 }) });
    for (const e of await f.store.due(f.clock())) await w.deliver(e);
}
async function notified() { const f = fixture(); await f.ready(); await deliver(f); return f; }
function swapPdf(f, text = 'Segunda via') { f.pdfs.boleto = Buffer.from(`%PDF-1.4\n${text}\n%%EOF`); f.invoice.fields[N.BOLETO] = [{ id: ('att' + text.replace(/[^A-Za-z]/g, '') + 'GGGGGGGGGGGGGG').slice(0, 17), type: 'application/pdf', size: f.pdfs.boleto.length, url: 'https://v5.airtableusercontent.com/boleto' }]; }
// Observes the change, lets it settle and observes it again.
async function settle(f) { await f.service.scan(); later(f); await f.service.scan(); }

// Requisito 1: preenchimento inicial x alteração.
test('filling an empty due date or amount after the notice is not a correction', async t => {
    for (const [field, value] of [[N.VENCIMENTO, '2026-11-20'], [N.VALOR_PARCELA, 1500.5]]) await t.test(field, async () => {
        const f = fixture(); delete f.invoice.fields[field]; await f.ready(); await deliver(f);
        assert.equal(stored(f, of(f, 'BOLETO_AVAILABLE')[0]).status, 'sent');
        f.invoice.fields[field] = value; await settle(f); await settle(f);
        assert.equal(updates(f).length, 0); assert.equal(of(f, 'BOLETO_AVAILABLE').length, 1);
        assert.deepEqual(f.store.data.states.get(f.ids.invoice).blockedKinds, []);
    });
});
test('a value corrected after being filled in for the first time is a correction', async () => {
    const f = fixture(); delete f.invoice.fields[N.VENCIMENTO]; await f.ready(); await deliver(f);
    f.invoice.fields[N.VENCIMENTO] = '2026-11-20'; await settle(f);
    f.invoice.fields[N.VENCIMENTO] = '2026-11-25'; await settle(f);
    assert.deepEqual(updates(f).map(e => e.payload.dueDate), ['2026-11-25']);
});
test('correcting before anything was sent stays silent and uses the current data', async () => {
    const f = fixture(); await f.ready(); const first = f.events()[0];
    swapPdf(f); f.invoice.fields[N.VALOR_PARCELA] = 1600; await f.service.scan();
    assert.equal(stored(f, first).status, 'cancelled'); assert.equal(updates(f).length, 0);
    const current = of(f, 'BOLETO_AVAILABLE').find(e => e.status === 'pending');
    assert.equal(current.payload.document.sha256, hash(f.pdfs.boleto)); assert.equal(current.payload.amountCents, 160000);
});
test('a date correction before anything was sent reissues availability instead of losing it', async () => {
    const f = fixture(); await f.ready(); f.invoice.fields[N.VENCIMENTO] = '2026-11-20'; await f.service.scan();
    assert.deepEqual(of(f, 'BOLETO_AVAILABLE').map(e => [e.status, e.payload.dueDate]), [['cancelled', '2026-11-06'], ['pending', '2026-11-20']]);
});

// Requisitos 2 e 3: nova versão explícita, agenda reconstruída.
test('a replaced PDF is announced once, as a new version, with the new document', async () => {
    const f = await notified(); swapPdf(f); await f.service.scan();
    assert.equal(updates(f).length, 0, 'waits for the correction to settle');
    later(f); await f.service.scan(); await f.service.scan();
    assert.equal(updates(f).length, 1);
    const { payload } = updates(f)[0];
    assert.equal(payload.document.sha256, hash(f.pdfs.boleto)); assert.equal(payload.document.id, f.invoice.fields[N.BOLETO][0].id);
    assert.equal(of(f, 'BOLETO_AVAILABLE').length, 1, 'no second availability');
    const { bytes, proof } = await f.service.validate(payload);
    assert.deepEqual(bytes.boleto, f.pdfs.boleto); assert.equal(proof.documentPayable, true);
    assert.ok(audits(f, 'BOLETO_VERSION_CHANGED').length >= 1);
});
test('while a change settles nothing about the old version goes out', async () => {
    const f = await notified(); swapPdf(f); f.setNow('2026-11-05T12:00:00Z'); await f.service.scan();
    assert.equal(of(f, 'BOLETO_D_MINUS_1').length, 0);
});
test('pending messages of the old version are cancelled', async () => {
    const f = await notified(); f.setNow('2026-11-05T12:00:00Z'); await f.service.scan();
    const reminder = of(f, 'BOLETO_D_MINUS_1')[0]; swapPdf(f); await f.service.scan();
    assert.equal(stored(f, reminder).status, 'cancelled');
    await assert.rejects(f.service.validate(reminder.payload));
});
test('a due date correction rebuilds the agenda on the new date, with no catch-up', async () => {
    const f = await notified(); f.invoice.fields[N.VENCIMENTO] = '2026-11-20'; await settle(f); await deliver(f);
    assert.deepEqual(updates(f).map(e => e.payload.dueDate), ['2026-11-20']);
    f.setNow('2026-11-05T12:00:00Z'); await f.service.scan(); f.setNow('2026-11-06T12:00:00Z'); await f.service.scan();
    assert.equal(of(f, 'BOLETO_D_MINUS_1').length, 0, 'old D-1 does not arise'); assert.equal(of(f, 'BOLETO_DUE_TODAY').length, 0, 'old D0 does not arise');
    f.setNow('2026-11-19T12:00:00Z'); await f.service.scan(); f.setNow('2026-11-20T12:00:00Z'); await f.service.scan();
    assert.deepEqual(of(f, 'BOLETO_D_MINUS_1').map(e => e.payload.dueDate), ['2026-11-20']); assert.deepEqual(of(f, 'BOLETO_DUE_TODAY').map(e => e.payload.dueDate), ['2026-11-20']);
    f.setNow('2026-11-25T12:00:00Z'); await f.service.scan();
    assert.deepEqual(of(f, 'BOLETO_OVERDUE_REMINDER').map(e => e.payload.scheduledFor), ['2026-11-25']);
});
test('a due date moved to the past does not recover missed reminders', async () => {
    const f = await notified(); f.invoice.fields[N.VENCIMENTO] = '2026-10-01'; await settle(f);
    assert.equal(updates(f).length, 1); assert.equal(of(f, 'BOLETO_OVERDUE_REMINDER').length, 0);
});
test('an amount correction is announced with the registered value, never a calculated one', async () => {
    const f = await notified(); f.invoice.fields[N.VALOR_PARCELA] = 1650.75; await settle(f); await deliver(f);
    assert.deepEqual(updates(f).map(e => e.payload.amountCents), [165075]);
    f.setNow('2026-11-11T12:00:00Z'); await f.service.scan();
    assert.deepEqual(of(f, 'BOLETO_OVERDUE_REMINDER').map(e => e.payload.amountCents), [165075]);
});
test('several edits of one correction produce one announcement, with the final data', async () => {
    const f = await notified(); swapPdf(f); await f.service.scan(); later(f, 300000);
    f.invoice.fields[N.VENCIMENTO] = '2026-11-20'; await f.service.scan(); later(f, 300000);
    f.invoice.fields[N.VALOR_PARCELA] = 1600; await f.service.scan();
    assert.equal(updates(f).length, 0);
    later(f); await f.service.scan();
    assert.equal(updates(f).length, 1); assert.equal(updates(f)[0].payload.dueDate, '2026-11-20'); assert.equal(updates(f)[0].payload.amountCents, 160000);
});
test('an update already queued is replaced if the data changes again', async () => {
    const f = await notified(); swapPdf(f); await settle(f); const first = updates(f)[0];
    swapPdf(f, 'Terceira via'); await settle(f);
    assert.equal(stored(f, first).status, 'cancelled');
    assert.equal(updates(f).filter(e => e.status === 'pending').length, 1);
});
test('no second message about the same day: the update carries the document', async () => {
    const f = await notified(); f.setNow('2026-11-06T12:00:00Z'); swapPdf(f); await settle(f); await deliver(f); await f.service.scan();
    assert.equal(updates(f).length, 1); assert.equal(of(f, 'BOLETO_DUE_TODAY').length, 0);
    f.setNow('2026-11-11T12:00:00Z'); await f.service.scan();
    assert.equal(of(f, 'BOLETO_OVERDUE_REMINDER').length, 1);
});
test('an uncertain delivery counts as notified', async () => {
    const f = fixture(); await f.ready(); const e = stored(f, f.events()[0]);
    e.status = 'uncertain'; e.attempts = 1; await f.store.repo.saveEvent(e);
    swapPdf(f); await settle(f);
    assert.equal(updates(f).length, 1); assert.equal(of(f, 'BOLETO_AVAILABLE').length, 1);
});
test('going back to a version announced earlier is announced again, once', async () => {
    const f = await notified(); const original = f.pdfs.boleto, attachment = f.invoice.fields[N.BOLETO];
    swapPdf(f); await settle(f); await deliver(f);
    f.pdfs.boleto = original; f.invoice.fields[N.BOLETO] = attachment; await settle(f); await deliver(f); await settle(f);
    assert.deepEqual(updates(f).map(e => e.payload.document.sha256), [hash(Buffer.from('%PDF-1.4\nSegunda via\n%%EOF')), hash(original)]);
});
test('a correction undone before being announced sends nothing', async () => {
    const f = await notified(); const original = f.pdfs.boleto, attachment = f.invoice.fields[N.BOLETO];
    swapPdf(f); await f.service.scan(); f.pdfs.boleto = original; f.invoice.fields[N.BOLETO] = attachment; await settle(f);
    assert.equal(updates(f).length, 0);
});
test('returning to a version whose announcement is spent is held for review, and a new one resolves it', async () => {
    const f = await notified(); const original = f.pdfs.boleto, attachment = f.invoice.fields[N.BOLETO];
    swapPdf(f); const second = f.invoice.fields[N.BOLETO], secondPdf = f.pdfs.boleto; await settle(f); await deliver(f);
    f.pdfs.boleto = original; f.invoice.fields[N.BOLETO] = attachment; await settle(f); await deliver(f);
    f.pdfs.boleto = secondPdf; f.invoice.fields[N.BOLETO] = second; await settle(f);
    assert.equal(updates(f).length, 2); assert.ok(audits(f, 'BOLETO_VERSION_REVIEW').length >= 1);
    f.setNow('2026-11-11T12:00:00Z'); await f.service.scan(); assert.equal(of(f, 'BOLETO_OVERDUE_REMINDER').length, 0);
    swapPdf(f, 'Terceira via'); await settle(f); assert.equal(updates(f).length, 3);
});
test('a boleto from the baseline is not announced when replaced: no retroactive message', async () => {
    const f = fixture(); f.attach('boleto'); await f.service.scan(); swapPdf(f); await settle(f);
    f.setNow('2026-11-11T12:00:00Z'); await f.service.scan();
    assert.equal(f.events().length, 0);
});

// A variante do e-mail vem da comparação entre o que foi informado e os dados atuais.
test('the update records what the client was told before', async t => {
    const cases = {
        pdf: [f => swapPdf(f), f => ({ sha256: hash(Buffer.from('%PDF-1.4\nBoleto ficticio\n%%EOF')), dueDate: '2026-11-06', amountCents: 150050 })],
        vencimento: [f => { f.invoice.fields[N.VENCIMENTO] = '2026-11-20'; }, f => ({ sha256: hash(f.pdfs.boleto), dueDate: '2026-11-06', amountCents: 150050 })],
        valor: [f => { f.invoice.fields[N.VALOR_PARCELA] = 1600; }, f => ({ sha256: hash(f.pdfs.boleto), dueDate: '2026-11-06', amountCents: 150050 })]
    };
    for (const [name, [change, previous]] of Object.entries(cases)) await t.test(name, async () => {
        const f = await notified(); change(f); await settle(f);
        assert.deepEqual(updates(f)[0].payload.previous, previous(f));
    });
});
test('the previous version follows the last one announced', async () => {
    const f = await notified(); f.invoice.fields[N.VENCIMENTO] = '2026-11-20'; await settle(f); await deliver(f);
    f.invoice.fields[N.VENCIMENTO] = '2026-11-25'; await settle(f);
    assert.deepEqual(updates(f).map(e => e.payload.previous.dueDate), ['2026-11-06', '2026-11-20']);
});
test('a forged previous version is refused by the Portal, even correctly identified', async () => {
    const { eventId } = require('../lib/billing/contract');
    const f = await notified(); swapPdf(f); await settle(f); const p = structuredClone(updates(f)[0].payload);
    p.previous.sha256 = p.document.sha256; p.previous.dueDate = '2026-01-01'; p.eventId = eventId(p);
    await assert.rejects(f.service.validate(p), /EVENT_OBSOLETE/);
    const same = structuredClone(updates(f)[0].payload); same.previous.amountCents = 1;
    await assert.rejects(f.service.validate(same), /INVALID_EVENT/);
});
test('after a chain of versions, a return with another previous version is announced', async () => {
    const f = await notified(); swapPdf(f); const b = f.invoice.fields[N.BOLETO], bPdf = f.pdfs.boleto; await settle(f); await deliver(f);
    swapPdf(f, 'Terceira via'); await settle(f); await deliver(f);
    f.pdfs.boleto = bPdf; f.invoice.fields[N.BOLETO] = b; await settle(f);
    assert.equal(updates(f).length, 3); assert.equal(audits(f, 'BOLETO_VERSION_REVIEW').length, 0);
});

// Requisito 5: documentos idênticos.
test('the same content under a new attachment is not a new version', async () => {
    const f = await notified(); f.invoice.fields[N.BOLETO][0].id = 'attGGGGGGGGGGGGGG'; await settle(f);
    assert.equal(f.events().length, 1); assert.equal(audits(f, 'BOLETO_VERSION_CHANGED').length, 0);
});
test('re-uploading identical content does not lose a message waiting to go out', async () => {
    const f = fixture(); await f.ready(); const e = f.events()[0];
    f.invoice.fields[N.BOLETO][0].id = 'attGGGGGGGGGGGGGG'; await f.service.scan();
    assert.equal(stored(f, e).status, 'pending');
    const { bytes } = await f.service.validate(e.payload); assert.deepEqual(bytes.boleto, f.pdfs.boleto);
});
test('repeated scans and deliveries generate no duplicates', async () => {
    const f = await notified(); swapPdf(f); await settle(f);
    for (let i = 0; i < 4; i++) { await f.service.scan(); await deliver(f); }
    assert.equal(updates(f).length, 1); assert.equal(updates(f)[0].status, 'sent'); assert.equal(updates(f)[0].attempts, 1);
});

// Requisitos 6 e 7: pagamento, destinatários e vínculo.
test('payment during the correction announces nothing', async () => {
    const f = await notified(); swapPdf(f); await f.service.scan(); f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago'; later(f); await f.service.scan(); await f.service.scan();
    assert.equal(updates(f).length, 0);
});
test('payment after the update is queued cancels it and it is refused', async () => {
    const f = await notified(); swapPdf(f); await settle(f); const e = updates(f)[0];
    f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago'; await f.service.scan();
    assert.equal(stored(f, e).status, 'cancelled'); await assert.rejects(f.service.validate(e.payload));
});
test('correcting a paid installment restarts nothing and keeps one confirmation', async () => {
    const f = await notified(); f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago'; await f.service.scan(); await f.service.scan(); await deliver(f);
    swapPdf(f); f.invoice.fields[N.VALOR_PARCELA] = 1600; await settle(f); await deliver(f);
    assert.equal(updates(f).length, 0); assert.equal(of(f, 'BOLETO_PAYMENT_RECORDED').length, 1);
});
test('a confirmation waiting to go out survives an amount correction', async () => {
    const f = await notified(); f.invoice.fields[N.STATUS_PAGAMENTO] = 'Pago'; await f.service.scan(); await f.service.scan();
    f.invoice.fields[N.VALOR_PARCELA] = 1600; await f.service.scan();
    assert.deepEqual(of(f, 'BOLETO_PAYMENT_RECORDED').map(e => e.status), ['cancelled', 'pending']);
});
test('payment data without status Pago holds the announcement until corrected', async () => {
    const f = await notified(); swapPdf(f); f.invoice.fields[N.DATA_PAGAMENTO] = '2026-11-04'; await settle(f);
    assert.equal(updates(f).length, 0);
    delete f.invoice.fields[N.DATA_PAGAMENTO]; await settle(f);
    assert.equal(updates(f).length, 1);
});
test('the announcement goes to the addresses registered now', async () => {
    const f = await notified(); swapPdf(f); f.client.fields[CLIENT_EMAIL] = 'novo@example.test'; await settle(f);
    assert.deepEqual(updates(f).map(e => e.payload.recipient), ['novo@example.test']);
});
test('an address removed after queueing is refused', async () => {
    const f = await notified(); swapPdf(f); await settle(f); f.client.fields[CLIENT_EMAIL] = 'novo@example.test';
    await assert.rejects(f.service.validate(updates(f)[0].payload), /RECIPIENT_UNAUTHORIZED/);
});
test('with no registered address nothing is announced and it is audited', async () => {
    const f = await notified(); swapPdf(f); delete f.client.fields[CLIENT_EMAIL]; await settle(f);
    assert.equal(updates(f).length, 0); assert.ok(audits(f, 'RECIPIENT_UNAUTHORIZED').length >= 1);
});
test('another client or CNPJ never continues: held durably and audited', async t => {
    const changes = { cnpj: f => { f.client.fields[S.CLIENTES.CNPJ] = '98765432000198'; } };
    for (const [name, change] of Object.entries(changes)) await t.test(name, async () => {
        const f = await notified(); change(f); await settle(f); swapPdf(f); await settle(f);
        f.setNow('2026-11-11T12:00:00Z'); await f.service.scan();
        const state = f.store.data.states.get(f.ids.invoice);
        assert.deepEqual(state.blockedKinds, ['boleto', 'nfse']); assert.ok(audits(f, 'RECONCILIATION_REQUIRED').length >= 1);
        for (const e of updates(f)) await assert.rejects(f.service.validate(e.payload), /RECONCILIATION_REQUIRED/);
        assert.equal(of(f, 'BOLETO_OVERDUE_REMINDER').length, 0);
    });
});
test('a chain broken during a correction sends nothing', async () => {
    const f = await notified(); swapPdf(f); await f.service.scan(); f.contract.fields[S.CONTRATOS.PARCELAS] = []; later(f); await f.service.scan();
    assert.equal(updates(f).length, 0);
});

// Requisito 10: leituras e documentos com problema.
test('a removed boleto holds messages, without blocking; the same one back resumes silently', async () => {
    const f = fixture(); await f.ready(); const e = f.events()[0], attachment = f.invoice.fields[N.BOLETO];
    f.invoice.fields[N.BOLETO] = []; await f.service.scan();
    assert.equal(stored(f, e).status, 'pending');
    await createWorker({ config: cfg, store: f.store, service: f.service, clock: f.clock, random: () => 0, fetcher: async () => { throw new Error('must not send'); } }).deliver(stored(f, e));
    assert.equal(stored(f, e).status, 'retry'); assert.equal(stored(f, e).reason, 'DOCUMENT_HELD');
    f.invoice.fields[N.BOLETO] = attachment; await f.service.scan(); later(f, 300000); await deliver(f);
    assert.equal(stored(f, e).status, 'sent'); assert.equal(f.events().length, 1);
});
test('removing and attaching another boleto is a replacement', async () => {
    const f = await notified(); f.invoice.fields[N.BOLETO] = []; await settle(f);
    assert.equal(updates(f).length, 0);
    swapPdf(f); await settle(f);
    assert.equal(updates(f).length, 1);
});
test('an unreadable document neither announces nor cancels', async t => {
    const changes = { naoPdf: f => { f.invoice.fields[N.BOLETO][0].type = 'image/png'; }, dois: f => { f.invoice.fields[N.BOLETO].push({ ...f.invoice.fields[N.BOLETO][0], id: 'attGGGGGGGGGGGGGG' }); } };
    for (const [name, change] of Object.entries(changes)) await t.test(name, async () => {
        const f = fixture(); await f.ready(); const e = f.events()[0]; change(f); await settle(f);
        assert.equal(stored(f, e).status, 'pending'); assert.equal(updates(f).length, 0);
        await assert.rejects(f.service.validate(e.payload), /DOCUMENT_HELD/);
    });
});
test('a PDF that fails integrity after a replacement is not announced', async () => {
    const f = await notified(); swapPdf(f); f.invoice.fields[N.BOLETO][0].size += 1; await settle(f);
    assert.equal(updates(f).length, 0);
});
test('a source outage changes nothing and the settling time is kept', async () => {
    const f = await notified(); swapPdf(f); await f.service.scan();
    const state = structuredClone(f.store.data.states.get(f.ids.invoice));
    f.fail(true); later(f); await assert.rejects(f.service.scan()); f.fail(false);
    assert.deepEqual(f.store.data.states.get(f.ids.invoice), state); assert.equal(updates(f).length, 0);
    await f.service.scan(); assert.equal(updates(f).length, 1);
});
test('an empty corrected value announces nothing until it is filled', async () => {
    const f = await notified(); delete f.invoice.fields[N.VALOR_PARCELA]; await settle(f);
    assert.equal(updates(f).length, 0); assert.ok(audits(f, 'BOLETO_VERSION_INCOMPLETE').length >= 1);
    f.invoice.fields[N.VALOR_PARCELA] = 1600; await settle(f);
    assert.equal(updates(f).length, 1);
});

test('other content under the same attachment is an anomaly, not a correction; a new attachment resolves it', async () => {
    const f = await notified(); f.pdfs.boleto = Buffer.from(f.pdfs.boleto.toString().replace('Boleto', 'Fraude'));
    await assert.rejects(f.service.validate(f.events()[0].payload)); await settle(f); await settle(f);
    assert.equal(updates(f).length, 0); assert.ok(audits(f, 'RECONCILIATION_REQUIRED').length >= 1);
    swapPdf(f); await settle(f);
    assert.equal(updates(f).length, 1); await f.service.validate(updates(f)[0].payload);
});

// Reinicialização.
test('a restart keeps the settling time, what was announced, and sends nothing twice', async () => {
    const f = await notified(); swapPdf(f); await f.service.scan();
    const restarted = createService({ store: f.store, source: f.source, clock: f.clock, pilotClients: [f.ids.client] });
    later(f); await restarted.scan(); await deliver(f);
    assert.equal(updates(f).length, 1);
    const again = createService({ store: f.store, source: f.source, clock: f.clock, pilotClients: [f.ids.client] });
    await again.scan(); await again.scan();
    assert.equal(updates(f).length, 1); assert.equal(updates(f)[0].status, 'sent');
    assert.equal(f.store.data.states.get(f.ids.invoice).announced.sha256, hash(f.pdfs.boleto));
});
test('a restart while the update is queued delivers the same event', async () => {
    const f = await notified(); swapPdf(f); await settle(f); const id = updates(f)[0].payload.eventId;
    const restarted = createService({ store: f.store, source: f.source, clock: f.clock, pilotClients: [f.ids.client] });
    await restarted.scan(); await deliver(f);
    assert.deepEqual(updates(f).map(e => [e.payload.eventId, e.status]), [[id, 'sent']]);
});

// NFSe: a lógica de aprovação não muda; a correção do boleto não a afeta.
test('a boleto correction does not stop a new NFSe', async () => {
    const f = await notified(); f.invoice.fields[N.VENCIMENTO] = '2026-11-20'; f.invoice.fields[N.VALOR_PARCELA] = 1600; await f.service.scan();
    f.attach('nfse'); await f.service.scan();
    assert.equal(of(f, 'NFSE_AVAILABLE').length, 1); await f.service.validate(of(f, 'NFSE_AVAILABLE')[0].payload);
});
test('an NFSe already sent is not sent again when data changes', async () => {
    const f = fixture(); await f.ready('nfse'); await deliver(f);
    f.invoice.fields[N.VENCIMENTO] = '2026-11-20'; await settle(f);
    assert.equal(of(f, 'NFSE_AVAILABLE').length, 1);
});
test('an NFSe waiting to go out follows the corrected data', async () => {
    const f = fixture(); await f.ready('nfse'); f.invoice.fields[N.VALOR_PARCELA] = 1600; await f.service.scan();
    assert.deepEqual(of(f, 'NFSE_AVAILABLE').map(e => [e.status, e.payload.amountCents]), [['cancelled', 150050], ['pending', 160000]]);
});
test('an NFSe replaced after delivery is audited for review and not sent automatically', async () => {
    const f = fixture(); await f.ready('nfse'); await deliver(f);
    f.pdfs.nfse = Buffer.from('%PDF-1.4\nNFSe nova\n%%EOF'); f.invoice.fields[N.NFSE] = [{ id: 'attGGGGGGGGGGGGGG', type: 'application/pdf', size: f.pdfs.nfse.length, url: 'https://v5.airtableusercontent.com/nfse' }];
    await settle(f);
    assert.equal(of(f, 'NFSE_AVAILABLE').length, 1); assert.ok(audits(f, 'NFSE_REPLACED_REVIEW').length >= 1);
});

// Ponta a ponta, com o receptor real.
test('real receiver: update delivers the new PDF once, including after a repeated delivery', { skip: !available }, async t => {
    const { createReceiver, ROUTE } = require(path.join(notifications, 'billing/receiver.js'));
    const f = await notified(); swapPdf(f); await settle(f);
    const app = express(); register(app, express, { config: cfg, store: f.store, service: f.service, clock: f.clock });
    const srv = app.listen(0, '127.0.0.1'); await new Promise(resolve => srv.once('listening', resolve));
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'itr-billing-test-'));
    t.after(async () => { await new Promise(resolve => { srv.closeAllConnections(); srv.close(resolve); }); fs.rmSync(directory, { recursive: true, force: true }); });
    const sent = [];
    const receiver = createReceiver({ config: { enabled: true, secret: cfg.secret, origin: 'https://portal.example.test', directory }, clock: f.clock,
        fetcher: (url, options) => fetch(`http://127.0.0.1:${srv.address().port}${new URL(url).pathname}`, options),
        send: async args => { sent.push(args); return { ok: true }; } });
    const w = createWorker({ config: cfg, store: f.store, service: f.service, clock: f.clock, random: () => 0, fetcher: async (url, options) => {
        const r = await receiver.handle({ method: 'POST', path: ROUTE, headers: options.headers }, Buffer.from(options.body));
        return new Response(JSON.stringify(r.body), { status: r.status });
    } });
    const e = updates(f)[0];
    await w.deliver(stored(f, e)); await w.deliver(stored(f, e));
    assert.equal(stored(f, e).status, 'sent'); assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].pdfs[0].content, f.pdfs.boleto); assert.equal(sent[0].event.type, 'BOLETO_UPDATED');
    const { render } = require(path.join(notifications, 'billing/template.js'));
    assert.match(render(e.payload, f.clock(), null).texto, /substitui o documento anteriormente encaminhado/);
});
test('real receiver: same PDF with another due date goes out as a data update, with the same bytes', { skip: !available }, async t => {
    const { createReceiver, ROUTE } = require(path.join(notifications, 'billing/receiver.js'));
    const { render } = require(path.join(notifications, 'billing/template.js'));
    const f = await notified(), original = f.pdfs.boleto; f.invoice.fields[N.VENCIMENTO] = '2026-11-20'; await settle(f);
    const app = express(); register(app, express, { config: cfg, store: f.store, service: f.service, clock: f.clock });
    const srv = app.listen(0, '127.0.0.1'); await new Promise(resolve => srv.once('listening', resolve));
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'itr-billing-test-'));
    t.after(async () => { await new Promise(resolve => { srv.closeAllConnections(); srv.close(resolve); }); fs.rmSync(directory, { recursive: true, force: true }); });
    const sent = [];
    const receiver = createReceiver({ config: { enabled: true, secret: cfg.secret, origin: 'https://portal.example.test', directory }, clock: f.clock,
        fetcher: (url, options) => fetch(`http://127.0.0.1:${srv.address().port}${new URL(url).pathname}`, options),
        send: async args => { sent.push(args); return { ok: true }; } });
    const w = createWorker({ config: cfg, store: f.store, service: f.service, clock: f.clock, random: () => 0, fetcher: async (url, options) => {
        const r = await receiver.handle({ method: 'POST', path: ROUTE, headers: options.headers }, Buffer.from(options.body));
        return new Response(JSON.stringify(r.body), { status: r.status });
    } });
    const e = updates(f)[0]; await w.deliver(stored(f, e));
    assert.equal(sent.length, 1); assert.deepEqual(sent[0].pdfs[0].content, original);
    const { assunto, texto } = render(sent[0].event, f.clock(), null);
    assert.match(assunto, /Dados do boleto atualizados/); assert.match(texto, /Vencimento: de 06\/11\/2026 para 20\/11\/2026\./);
    assert.doesNotMatch(texto, /substitui|Valor da parcela: de/);
});
