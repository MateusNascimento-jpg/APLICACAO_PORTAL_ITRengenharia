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
        const contacts = await service.options(proposal.cnpj, proposal.id);
        const result = await service.request(proposal.cnpj, proposal.id, contacts[0].key, {
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

test('não aceita outro CNPJ, contato livre, PDF ambíguo, status Pendente ou Safe Mode', async () => {
    const f = fixture();
    await assert.rejects(f.service.options('99999999000199', f.proposal.id), /PROPOSAL_NOT_FOUND/);
    await assert.rejects(
        f.service.request(f.proposal.cnpj, f.proposal.id, 'attacker', {}),
        /RECIPIENT_INVALID/,
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
