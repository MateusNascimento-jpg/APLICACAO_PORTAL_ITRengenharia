'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createService, TTL } = require('../lib/proposals/service');
const { createSecrets } = require('../lib/proposals/crypto');
const { memoryStore } = require('./helpers/proposals-memory');

function fixture() {
    const store = memoryStore();
    const secrets = createSecrets(Buffer.alloc(32, 8).toString('base64'));
    let clock = Date.now();
    const proposal = {
        id: 'recAAAAAAAAAAAAAA',
        cnpj: '12345678000190',
        clienteId: 'recBBBBBBBBBBBBBB',
        numero: '2026-001',
        nomeCliente: 'Empresa teste',
        valor: 1200,
        status: 'Enviada',
        formaPagamento: 'Boleto',
        prazoPagamentoDias: 30,
        createdTime: new Date(clock).toISOString(),
        emails: ['a@example.test', 'b@example.test'],
        anexos: [
            {
                id: 'attOne',
                filename: 'proposta.pdf',
                url: 'https://v5.airtableusercontent.com/pdf',
            },
        ],
    };
    const writes = [];
    let failure = '';
    const airtable = {
        async carregarPropostaAtual(id, cnpj) {
            if (id !== proposal.id || (cnpj && cnpj !== proposal.cnpj))
                throw new Error('PROPOSAL_NOT_FOUND');
            return structuredClone(proposal);
        },
        async atualizarDecisao(id, status, feedback) {
            writes.push({ id, status, feedback });
            if (failure === 'before') throw new Error('NETWORK');
            proposal.status = status;
            proposal.feedback = feedback;
            if (failure === 'after') throw new Error('NETWORK');
        },
    };
    const params = {
        store,
        secrets,
        airtable,
        origin: 'https://portal.example.test',
        enabled: () => true,
        pdf: async () => ({ hash: secrets.hash('pdf-original') }),
        now: () => clock,
    };
    const service = createService(params);
    const payloads = () => [...store.events.values()].map((row) => secrets.open(row.payload));
    async function request() {
        const result = await service.request(proposal.cnpj, proposal.id, {
            role: 'GeneratedClient',
        });
        const verification = payloads()
            .filter((row) => row.type === 'VERIFY')
            .at(-1);
        const session = await service.open(new URL(verification.actionUrl).hash.slice(1));
        return { ...result, ...session };
    }
    return {
        store,
        secrets,
        proposal,
        writes,
        service,
        params,
        payloads,
        request,
        advance: (milliseconds) => {
            clock += milliseconds;
        },
        failure: (value) => {
            failure = value;
        },
    };
}

test('link + código + confirmação: só o último passo altera o Airtable; final é individual e idempotente', async () => {
    const f = fixture();
    const flow = await f.request();
    assert.equal(f.writes.length, 0);
    await assert.rejects(f.service.confirm(flow.cookie, flow.csrf, true, {}), /CODE_REQUIRED/);
    await f.service.validate(flow.cookie, flow.csrf, flow.code);
    assert.equal(f.writes.length, 0);
    await assert.rejects(f.service.confirm(flow.cookie, flow.csrf, false, {}), /CONSENT_REQUIRED/);
    const results = await Promise.all([
        f.service.confirm(flow.cookie, flow.csrf, true, {}),
        f.service.confirm(flow.cookie, flow.csrf, true, {}),
    ]);
    assert.equal(results[0].status, 'Aceita');
    assert.equal(f.writes.length, 1);
    assert.equal(f.payloads().filter((row) => row.type === 'ACCEPTED').length, 2);
    const state = await f.store.state(f.proposal.id);
    assert.equal(state.decision.state, 'done');
    assert.ok(state.decision.verifiedAt && state.decision.consentAt);
});

test('expiração cobre a confirmação definitiva, inclusive após código correto', async () => {
    const f = fixture();
    const flow = await f.request();
    await f.service.validate(flow.cookie, flow.csrf, flow.code);
    f.advance(TTL);
    await assert.rejects(f.service.confirm(flow.cookie, flow.csrf, true, {}), /CHALLENGE_INVALID/);
    assert.equal(f.writes.length, 0);
});

test('cinco erros bloqueiam; CSRF e cookie adulterados não passam', async () => {
    const f = fixture();
    const flow = await f.request();
    await assert.rejects(f.service.validate(flow.cookie, 'outro', flow.code), /CSRF_INVALID/);
    for (let i = 0; i < 5; i++)
        await assert.rejects(f.service.validate(flow.cookie, flow.csrf, 'invalid'), /CODE_INVALID/);
    await assert.rejects(
        f.service.validate(flow.cookie, flow.csrf, flow.code),
        /CHALLENGE_INVALID/,
    );
    await assert.rejects(f.service.context('tampered'), /CHALLENGE_INVALID/);
    assert.equal(f.writes.length, 0);
});

test('reenviar substitui desafio; reinício preserva código válido sem armazená-lo em claro', async () => {
    const f = fixture();
    const first = await f.request();
    f.advance(61000);
    const second = await f.request();
    await assert.rejects(
        f.service.validate(first.cookie, first.csrf, first.code),
        /CHALLENGE_INVALID/,
    );
    const restarted = createService(f.params);
    await restarted.validate(second.cookie, second.csrf, second.code);
    const rows = JSON.stringify([...f.store.challenges.values()]);
    assert.ok(!rows.includes('"code":'));
    assert.ok(!rows.includes(new URL(f.payloads().at(-1).actionUrl).hash.slice(1)));
});

test('não aceita outro CNPJ, PDF ambíguo, status Pendente ou Safe Mode', async () => {
    const f = fixture();
    await assert.rejects(f.service.options('99999999000199', f.proposal.id), /PROPOSAL_NOT_FOUND/);
    await assert.rejects(
        f.service.request('99999999000199', f.proposal.id, {}),
        /PROPOSAL_NOT_FOUND/,
    );
    f.proposal.anexos.push({ id: 'another' });
    await assert.rejects(f.request(), /PDF_AMBIGUOUS/);
    f.proposal.status = 'Pendente';
    await assert.rejects(f.request(), /PROPOSAL_TERMINAL/);
    await assert.rejects(
        createService({ ...f.params, enabled: () => false }).options(
            f.proposal.cnpj,
            f.proposal.id,
        ),
        /SAFE_MODE/,
    );
});

test('revogação de contato, transferência ou alteração comercial impedem aceite antigo', async () => {
    for (const mutation of [
        (p) => {
            p.valor++;
        },
        (p) => {
            p.emails = [];
        },
        (p) => {
            p.cnpj = '99999999000199';
        },
        (p) => {
            p.anexos[0].id = 'changed';
        },
    ]) {
        const f = fixture();
        const flow = await f.request();
        await f.service.validate(flow.cookie, flow.csrf, flow.code);
        mutation(f.proposal);
        await assert.rejects(f.service.confirm(flow.cookie, flow.csrf, true, {}));
        assert.equal(f.writes.length, 0);
    }
});

test('rejeição exige feedback, grava os dois campos e invalida aceite pendente', async () => {
    const f = fixture();
    const flow = await f.request();
    await f.service.validate(flow.cookie, flow.csrf, flow.code);
    await assert.rejects(
        f.service.reject(f.proposal.cnpj, f.proposal.id, ' ', '', {}),
        /FEEDBACK_INVALID/,
    );
    await f.service.reject(
        f.proposal.cnpj,
        f.proposal.id,
        'Prazo incompatível',
        'Necessitamos prazo menor.',
        {},
    );
    assert.equal(f.writes[0].status, 'Rejeitada');
    assert.match(f.writes[0].feedback, /Prazo incompatível/);
    await assert.rejects(f.service.confirm(flow.cookie, flow.csrf, true, {}));
    assert.equal(f.payloads().filter((row) => row.type === 'ACCEPTED').length, 0);
});

test('timeout após PATCH é reconciliado após reinício sem repetir escrita; antes do PATCH não gera e-mail final', async () => {
    for (const failure of ['before', 'after']) {
        const f = fixture();
        const flow = await f.request();
        await f.service.validate(flow.cookie, flow.csrf, flow.code);
        f.failure(failure);
        await assert.rejects(f.service.confirm(flow.cookie, flow.csrf, true, {}), /NETWORK/);
        assert.equal(f.payloads().filter((row) => row.type === 'ACCEPTED').length, 0);
        const restarted = createService(f.params);
        if (failure === 'after') await restarted.reconcile(f.proposal.id);
        else await assert.rejects(restarted.reconcile(f.proposal.id), /DECISION_UNCERTAIN/);
        assert.equal(f.writes.length, 1);
        assert.equal(
            f.payloads().filter((row) => row.type === 'ACCEPTED').length,
            failure === 'after' ? 2 : 0,
        );
    }
});

test('nova proposta aguarda PDF, respeita marco inicial e não repete após reinício', async () => {
    const f = fixture();
    f.proposal.anexos = [];
    await assert.rejects(f.service.publish(f.proposal.id), /PDF_AMBIGUOUS/);
    assert.equal(f.store.events.size, 0);
    f.proposal.anexos = [
        { id: 'pdf', filename: 'original.pdf', url: 'https://v5.airtableusercontent.com/pdf' },
    ];
    await f.service.publish(f.proposal.id);
    await createService(f.params).publish(f.proposal.id);
    assert.equal(f.store.events.size, 2);
    const historical = fixture();
    historical.store.config.cutoff = Date.now() + 1000;
    await historical.service.publish(historical.proposal.id);
    assert.equal(historical.store.events.size, 0);
});

test('fila e desafio são atômicos em falha de persistência', async () => {
    const f = fixture();
    f.store.enqueue = async () => {
        throw new Error('DISK');
    };
    await assert.rejects(f.request(), /DISK/);
    assert.equal(f.store.challenges.size, 0);
    assert.equal(f.store.states.size, 0);
});


test('solicitação enfileira um link único por endereço autorizado com código único no Portal', async () => {
    const f = fixture();
    const flow = await f.request();
    const events = f.payloads().filter((item) => item.type === 'VERIFY');
    assert.equal(flow.recipientsCount, 2);
    assert.deepEqual(events.map((item) => item.recipient).sort(), f.proposal.emails);
    assert.equal(new Set(events.map((item) => item.actionUrl)).size, 2);
    assert.equal(new Set(events.map((item) => item.challengeId)).size, 2);
    assert.equal(new Set(events.map((item) => item.expiresAt)).size, 1);
    const state = await f.store.state(f.proposal.id);
    assert.equal(state.activeChallenges.length, 2);
    // Either authorized recipient can validate using the same code shown in the Portal.
    for (const event of events) {
        const link = await f.service.open(new URL(event.actionUrl).hash.slice(1));
        await f.service.validate(link.cookie, link.csrf, flow.code);
    }
    assert.equal(f.writes.length, 0);
});

test('revogação de apenas um contato invalida somente seu link, não o dos demais', async () => {
    const f = fixture();
    const flow = await f.request();
    const events = f.payloads().filter((item) => item.type === 'VERIFY');
    const original = events.find((event) => event.recipient === 'a@example.test');
    const permitted = events.find((event) => event.recipient === 'b@example.test');
    const revokedLink = await f.service.open(new URL(original.actionUrl).hash.slice(1));
    const permittedLink = await f.service.open(new URL(permitted.actionUrl).hash.slice(1));
    await f.service.validate(revokedLink.cookie, revokedLink.csrf, flow.code);
    await f.service.validate(permittedLink.cookie, permittedLink.csrf, flow.code);
    f.proposal.emails = ['b@example.test'];
    await assert.rejects(f.service.confirm(revokedLink.cookie, revokedLink.csrf, true, {}), /RECIPIENT_INVALID/);
    assert.equal(f.writes.length, 0);
    const result = await f.service.confirm(permittedLink.cookie, permittedLink.csrf, true, {});
    assert.equal(result.status, 'Aceita');
    assert.equal(f.writes.length, 1);
    const final = f.payloads().filter((item) => item.type === 'ACCEPTED');
    assert.deepEqual(final.map((item) => item.recipient), ['b@example.test']);
});

test('nova solicitação invalida todos os links anteriores sem afetar os novos', async () => {
    const f = fixture();
    const initial = await f.request();
    const oldTokens = f.payloads().filter((item) => item.type === 'VERIFY').map((item) => item.actionUrl);
    f.advance(61000);
    const recent = await f.request();
    for (const url of oldTokens)
        await assert.rejects(f.service.open(new URL(url).hash.slice(1)), /CHALLENGE_INVALID/);
    const newTokens = f.payloads().filter((item) => item.type === 'VERIFY').slice(-2);
    assert.equal(recent.recipientsCount, 2);
    assert.equal(initial.recipientsCount, 2);
    for (const item of newTokens) {
        const session = await f.service.open(new URL(item.actionUrl).hash.slice(1));
        await f.service.validate(session.cookie, session.csrf, recent.code);
    }
});

test('sem destinatários comerciais a solicitação é recusada sem enfileirar e-mails', async () => {
    const f = fixture();
    f.proposal.emails = [];
    await assert.rejects(f.service.request(f.proposal.cnpj, f.proposal.id, {}), /RECIPIENT_MISSING/);
    assert.equal(f.payloads().length, 0);
});


test('lista de e-mails separada por ponto e vírgula ignora espaços e duplicados', () => {
    const { emails } = require('../lib/portal-access');
    assert.deepEqual(
        emails('COMERCIAL@Exemplo.com; financeiro@exemplo.com ; comercial@exemplo.com; inválido ; juridico@exemplo.com'),
        ['comercial@exemplo.com', 'financeiro@exemplo.com', 'juridico@exemplo.com'],
    );
});

test('falha no enfileiramento do segundo e-mail desfaz toda a solicitação', async () => {
    const f = fixture();
    const originalEnqueue = f.store.enqueue;
    let called = 0;
    f.store.enqueue = async (item) => {
        called += 1;
        if (called === 2) throw new Error('INTERNAL_ENQUEUE_FAILED');
        return originalEnqueue(item);
    };
    await assert.rejects(f.request(), /INTERNAL_ENQUEUE_FAILED/);
    assert.equal(f.store.events.size, 0);
    assert.equal(f.store.challenges.size, 0);
    assert.equal(f.store.states.size, 0);
});

test('após primeiro aceite explícito, demais links deixam de autorizar nova decisão', async () => {
    const f = fixture();
    const flow = await f.request();
    const events = f.payloads().filter((item) => item.type === 'VERIFY');
    const links = [];
    for (const event of events) {
        const link = await f.service.open(new URL(event.actionUrl).hash.slice(1));
        await f.service.validate(link.cookie, link.csrf, flow.code);
        links.push(link);
    }
    await f.service.confirm(links[0].cookie, links[0].csrf, true, {});
    assert.equal(f.writes.length, 1);
    await assert.rejects(f.service.context(links[1].cookie), /CHALLENGE_INVALID|DECISION_EXISTS/);
    await assert.rejects(f.service.confirm(links[1].cookie, links[1].csrf, true, {}), /CHALLENGE_INVALID|DECISION_EXISTS/);
    assert.equal(f.writes.length, 1);
});
