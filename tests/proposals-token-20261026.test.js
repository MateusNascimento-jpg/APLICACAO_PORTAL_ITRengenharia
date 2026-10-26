'use strict';

// Correções do token de aceite (auditoria de 26/10/2026): retomada sem novo
// código, política de reenvio proporcional, fronteira exata de 120 minutos,
// 5 erros por desafio (inclusive concorrentes) e confirmação idempotente.
// Serviço real + store em memória; nenhum Airtable, SMTP ou MySQL real.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createService, TTL, REQUEST_MAX, REQUEST_COOLDOWNS, REQUEST_WINDOW,
} = require('../lib/proposals/service');
const { createSecrets } = require('../lib/proposals/crypto');
const { createAuthorizedContacts } = require('../lib/proposals/authorized-contacts');
const { memoryStore } = require('./helpers/proposals-memory');

function fixture() {
    let clock = Date.parse('2026-10-26T13:00:00Z');
    const store = memoryStore();
    const secrets = createSecrets(Buffer.alloc(32, 3).toString('base64'));
    const proposal = {
        id: 'recAAAAAAAAAAAAAA', cnpj: '12345678000190', clienteId: 'recBBBBBBBBBBBBBB',
        numero: '2026-077', status: 'Enviada', nomeCliente: 'Empresa Teste', valor: 4800,
        formaPagamento: 'Boleto', prazoPagamentoDias: 30, createdTime: new Date(clock).toISOString(),
        emails: ['compras@example.test', 'diretoria@example.test'],
        anexos: [{ id: 'attAAAAAAAAAAAAAA', filename: 'proposta.pdf', url: 'https://v5.airtableusercontent.com/p' }],
    };
    let pdfVersion = 'v1';
    const writes = [];
    let gate = null;
    const airtable = {
        async carregarPropostaAtual(id, cnpj) {
            if (id !== proposal.id || (cnpj && cnpj !== proposal.cnpj)) throw new Error('PROPOSAL_NOT_FOUND');
            return structuredClone(proposal);
        },
        async atualizarDecisao(id, status) {
            writes.push(status);
            if (gate) await gate;
            proposal.status = status;
        },
    };
    const service = createService({
        store, secrets, airtable, authorizedContacts: createAuthorizedContacts(),
        origin: 'https://portal.example.test', enabled: () => true,
        pdf: async () => ({ hash: secrets.hash(pdfVersion), bytes: Buffer.from('%PDF-1.4\n') }),
        now: () => clock,
    });
    const verify = () => [...store.events.values()].map((e) => secrets.open(e.payload))
        .filter((e) => e.type === 'VERIFY');
    const key = (email = 'compras@example.test') => secrets.codeHash(proposal.id, email);
    const request = (email) => service.request(proposal.cnpj, proposal.id, { role: 'Cliente' }, key(email));
    const lastCode = () => verify().at(-1).code;
    return {
        store, secrets, service, proposal, writes, verify, key, request, lastCode,
        advance: (ms) => { clock += ms; }, now: () => clock,
        changePdf: () => { pdfVersion = 'v2'; },
        hold: () => { let release; gate = new Promise((r) => { release = r; }); return () => { gate = null; release(); }; },
    };
}

test('retomada: o estado mostra o desafio vigente sem código, hash ou e-mail completo', async () => {
    const f = fixture();
    assert.deepEqual(await f.service.status(f.proposal.cnpj, f.proposal.id),
        { now: f.now(), decision: null, challenge: null, nextRequestAt: 0 });
    const result = await f.request();
    assert.equal(result.code, undefined);
    assert.equal(result.recipientLabel, 'co***@example.test');
    assert.equal(result.delivery, 'queued');
    for (let i = 0; i < 5; i++) {
        // Reabrir a janela várias vezes não cria desafio nem evento novos.
        const status = await f.service.status(f.proposal.cnpj, f.proposal.id);
        assert.equal(status.challenge.recipientLabel, 'co***@example.test');
        assert.equal(status.challenge.recipientKey, f.key());
        assert.equal(status.challenge.expiresAt, f.now() + TTL);
        assert.equal(status.challenge.attemptsRemaining, 5);
        assert.equal(status.challenge.delivery, 'queued');
        const raw = JSON.stringify(status);
        assert.ok(!raw.includes(f.lastCode()));
        assert.doesNotMatch(raw, /compras@|codeHash|tokenHash/);
    }
    assert.equal(f.store.challenges.size, 1);
    assert.equal(f.verify().length, 1);
    // Sessão de outro CNPJ não enxerga o desafio.
    assert.deepEqual(await f.service.status('99999999000199', f.proposal.id),
        { now: f.now(), decision: null, challenge: null, nextRequestAt: 0 });
    // O código pendente continua válido após "reabrir".
    const proof = await f.service.validateForClient(f.proposal.cnpj, f.proposal.id, f.lastCode());
    assert.ok(proof.confirmation);
});

test('estado de entrega reflete a outbox real: fila, enviado e falha', async () => {
    const f = fixture();
    await f.request();
    const [id] = f.store.events.keys();
    await f.store.eventState(id, 'sent');
    assert.equal((await f.service.status(f.proposal.cnpj, f.proposal.id)).challenge.delivery, 'sent');
    await f.store.eventState(id, 'uncertain');
    assert.equal((await f.service.status(f.proposal.cnpj, f.proposal.id)).challenge.delivery, 'uncertain');
    await f.store.eventState(id, 'cancelled');
    const failed = await f.service.status(f.proposal.cnpj, f.proposal.id);
    assert.equal(failed.challenge.delivery, 'failed');
    // Falha de entrega do código vigente não impõe espera nem consome cota.
    assert.equal(failed.nextRequestAt, 0);
    assert.equal(failed.requestsRemaining, REQUEST_MAX);
    const again = await f.request();
    assert.equal(again.replaced, true);
});

test('reenvio: intervalos crescentes, teto por janela e tempo exato de espera', async () => {
    const f = fixture();
    assert.deepEqual(REQUEST_COOLDOWNS, [60000, 120000, 300000, 600000]);
    assert.equal(REQUEST_MAX, 6);
    assert.equal(REQUEST_WINDOW, TTL);
    const first = await f.request();
    assert.equal(first.replaced, false);
    assert.equal(first.nextRequestAt, f.now() + 60000);
    assert.equal(first.requestsRemaining, 5);
    const start = f.now();
    const waits = [60000, 120000, 300000, 600000, 600000];
    for (const wait of waits) {
        f.advance(wait - 1000);
        await assert.rejects(f.request(), (error) =>
            error.code === 'REQUEST_TOO_SOON' && error.retryAfterMs === 1000);
        f.advance(1000);
        const result = await f.request('diretoria@example.test');
        assert.equal(result.replaced, true);
    }
    // 6 pedidos em 28 min; o 7º só quando o 1º sair da janela de 2 h.
    const elapsed = f.now() - start;
    await assert.rejects(f.request(), (error) =>
        error.code === 'REQUEST_TOO_SOON' && error.retryAfterMs === REQUEST_WINDOW - elapsed);
    const status = await f.service.status(f.proposal.cnpj, f.proposal.id);
    assert.equal(status.nextRequestAt, start + REQUEST_WINDOW);
    assert.equal(status.requestsRemaining, 0);
    f.advance(REQUEST_WINDOW - elapsed);
    await f.request();
    // Pedidos recusados (contato inválido) não consomem cota.
    const g = fixture();
    await assert.rejects(g.service.request(g.proposal.cnpj, g.proposal.id, {}, 'invalido'), /RECIPIENT_INVALID/);
    assert.equal((await g.request()).requestsRemaining, REQUEST_MAX - 1);
});

test('reenvio substitui o desafio: código anterior sempre falha, novo funciona', async () => {
    const f = fixture();
    await f.request();
    const old = f.lastCode();
    f.advance(60000);
    await f.request('diretoria@example.test');
    const fresh = f.lastCode();
    await assert.rejects(f.service.validateForClient(f.proposal.cnpj, f.proposal.id, old), /CODE_INVALID|CHALLENGE_INVALID/);
    assert.ok((await f.service.validateForClient(f.proposal.cnpj, f.proposal.id, fresh)).confirmation);
});

test('cinco erros invalidam o desafio; o sexto palpite, mesmo correto, é recusado', async () => {
    const f = fixture();
    await f.request();
    const code = f.lastCode();
    const wrong = code === '00000000' ? '11111111' : '00000000';
    for (let attempt = 1; attempt <= 5; attempt++) {
        await assert.rejects(f.service.validateForClient(f.proposal.cnpj, f.proposal.id, wrong), /CODE_INVALID/);
        const status = await f.service.status(f.proposal.cnpj, f.proposal.id);
        if (attempt < 5) assert.equal(status.challenge.attemptsRemaining, 5 - attempt);
        else assert.equal(status.challenge, null);
    }
    await assert.rejects(f.service.validateForClient(f.proposal.cnpj, f.proposal.id, code), /CHALLENGE_INVALID/);
    // Palpites concorrentes são serializados pelo lock: nunca mais de 5 registrados.
    const g = fixture();
    await g.request();
    const results = await Promise.allSettled(Array.from({ length: 12 }, () =>
        g.service.validateForClient(g.proposal.cnpj, g.proposal.id, g.lastCode() === '00000000' ? '11111111' : '00000000')));
    assert.equal(results.filter((r) => /CODE_INVALID/.test(r.reason?.message)).length, 5);
    assert.equal(results.filter((r) => /CHALLENGE_INVALID/.test(r.reason?.message)).length, 7);
    assert.equal([...g.store.challenges.values()][0].attempts, 5);
});

test('fronteira de 120 minutos: t<120 valida, t=120 recusa; confirmar após o prazo não grava', async () => {
    const f = fixture();
    await f.request();
    f.advance(TTL - 1);
    assert.ok((await f.service.validateForClient(f.proposal.cnpj, f.proposal.id, f.lastCode())).confirmation);
    const g = fixture();
    await g.request();
    g.advance(TTL);
    await assert.rejects(g.service.validateForClient(g.proposal.cnpj, g.proposal.id, g.lastCode()), /CHALLENGE_INVALID/);
    const h = fixture();
    await h.request();
    h.advance(TTL - 60000);
    const proof = await h.service.validateForClient(h.proposal.cnpj, h.proposal.id, h.lastCode());
    h.advance(60000);
    await assert.rejects(h.service.confirmForClient(h.proposal.cnpj, h.proposal.id, proof.confirmation, true, {}),
        /CHALLENGE_INVALID/);
    assert.deepEqual(h.writes, []);
});

test('validar não aceita; sem consentimento nada é gravado', async () => {
    const f = fixture();
    await f.request();
    const proof = await f.service.validateForClient(f.proposal.cnpj, f.proposal.id, f.lastCode());
    assert.deepEqual(f.writes, []);
    for (const consent of [false, 'true', 1, undefined])
        await assert.rejects(f.service.confirmForClient(f.proposal.cnpj, f.proposal.id, proof.confirmation, consent, {}),
            /CONSENT_REQUIRED/);
    assert.deepEqual(f.writes, []);
});

test('proposta alterada, contato removido, outro CNPJ ou status terminal negam o aceite', async () => {
    const f = fixture();
    await f.request();
    const proof = await f.service.validateForClient(f.proposal.cnpj, f.proposal.id, f.lastCode());
    f.changePdf();
    await assert.rejects(f.service.confirmForClient(f.proposal.cnpj, f.proposal.id, proof.confirmation, true, {}), /PROPOSAL_CHANGED/);
    const g = fixture();
    await g.request();
    g.proposal.emails = ['diretoria@example.test'];
    await assert.rejects(g.service.validateForClient(g.proposal.cnpj, g.proposal.id, g.lastCode()), /RECIPIENT_INVALID/);
    const h = fixture();
    await h.request();
    const hp = await h.service.validateForClient(h.proposal.cnpj, h.proposal.id, h.lastCode());
    await assert.rejects(h.service.confirmForClient('99999999000199', h.proposal.id, hp.confirmation, true, {}), /CHALLENGE_INVALID/);
    h.proposal.status = 'Rejeitada';
    await assert.rejects(h.service.confirmForClient(h.proposal.cnpj, h.proposal.id, hp.confirmation, true, {}), /PROPOSAL_TERMINAL/);
    for (const x of [f, g, h]) assert.deepEqual(x.writes, []);
});

test('resposta perdida: repetir a confirmação devolve o resultado sem novo PATCH nem e-mail', async () => {
    const f = fixture();
    await f.request();
    const proof = await f.service.validateForClient(f.proposal.cnpj, f.proposal.id, f.lastCode());
    // Dois cliques concorrentes: o lock serializa e só um grava.
    const [a, b] = await Promise.all([
        f.service.confirmForClient(f.proposal.cnpj, f.proposal.id, proof.confirmation, true, {}),
        f.service.confirmForClient(f.proposal.cnpj, f.proposal.id, proof.confirmation, true, {}),
    ]);
    assert.deepEqual([a.status, b.status], ['Aceita', 'Aceita']);
    assert.equal([a, b].filter((r) => r.repetido).length, 1);
    const accepted = () => [...f.store.events.values()].map((e) => f.secrets.open(e.payload))
        .filter((e) => e.type === 'ACCEPTED').length;
    assert.equal(accepted(), 2);
    // Mesmo após o prazo do código, a repetição apenas consulta o resultado.
    f.advance(TTL + 1);
    const again = await f.service.confirmForClient(f.proposal.cnpj, f.proposal.id, proof.confirmation, true, {});
    assert.deepEqual(again, { status: 'Aceita', numero: '2026-077', repetido: true });
    assert.deepEqual(f.writes, ['Aceita']);
    assert.equal(accepted(), 2);
    const status = await f.service.status(f.proposal.cnpj, f.proposal.id);
    assert.deepEqual(status.decision, { status: 'Aceita', state: 'done' });
    assert.equal(status.challenge, null);
});

test('decisão ainda em conferência (applying) não é repetida nem dada como concluída', async () => {
    const f = fixture();
    await f.request();
    const proof = await f.service.validateForClient(f.proposal.cnpj, f.proposal.id, f.lastCode());
    const release = f.hold();
    const first = f.service.confirmForClient(f.proposal.cnpj, f.proposal.id, proof.confirmation, true, {});
    await new Promise((r) => setImmediate(r));
    const state = await f.store.state(f.proposal.id);
    assert.equal(state.decision.state, 'applying');
    // Simula o retorno do cliente enquanto o PATCH ainda não terminou: o lock
    // em memória serializa; após liberar, a repetição recebe o resultado gravado.
    const second = f.service.confirmForClient(f.proposal.cnpj, f.proposal.id, proof.confirmation, true, {});
    release();
    assert.equal((await first).status, 'Aceita');
    assert.equal((await second).repetido, true);
    // Estado applying persistido (falha de rede no PATCH) → DECISION_UNCERTAIN.
    const g = fixture();
    await g.request();
    const gp = await g.service.validateForClient(g.proposal.cnpj, g.proposal.id, g.lastCode());
    const challengeId = [...g.store.challenges.keys()][0];
    await g.store.saveState(g.proposal.id, { decision: { state: 'applying', status: 'Aceita',
        cnpj: g.proposal.cnpj, challengeId, snapshot: { proposal: { numero: '2026-077' } } } });
    await assert.rejects(g.service.confirmForClient(g.proposal.cnpj, g.proposal.id, gp.confirmation, true, {}),
        /DECISION_UNCERTAIN/);
    assert.deepEqual(g.writes, []);
});
