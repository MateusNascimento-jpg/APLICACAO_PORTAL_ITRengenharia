'use strict';

// Regressão do serviço de propostas com o contrato de aceite por código
// enviado exclusivamente ao e-mail expressamente autorizado.
// Nenhuma chamada a Airtable, SMTP ou MySQL reais.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createService, TTL } = require('../lib/proposals/service');
const { createSecrets } = require('../lib/proposals/crypto');
const { memoryStore } = require('./helpers/proposals-memory');

function fixture() {
    const store = memoryStore();
    const secrets = createSecrets(Buffer.alloc(32, 8).toString('base64'));
    let clock = Date.parse('2026-10-23T10:00:00Z');
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
        anexos: [{
            id: 'attAAAAAAAAAAAAAA',
            filename: 'proposta.pdf',
            url: 'https://v5.airtableusercontent.com/pdf',
        }],
    };
    const permissions = new Set(proposal.emails);
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
        authorizedContacts: {
            async forProposal(p) {
                // Autorização explícita, restringida aos contatos do mesmo CNPJ.
                return p.emails.filter((email) => permissions.has(email));
            },
        },
        origin: 'https://portal.example.test',
        enabled: () => true,
        pdf: async () => ({
            hash: secrets.hash('pdf-original'),
            bytes: Buffer.from('%PDF-1.4\n%fixture\n'),
        }),
        now: () => clock,
    };
    const service = createService(params);
    const payloads = () => [...store.events.values()].map((row) => secrets.open(row.payload));

    async function request(email = 'a@example.test') {
        const available = await service.options(proposal.cnpj, proposal.id);
        const key = secrets.codeHash(proposal.id, email);
        assert.ok(available.some((item) => item.key === key), 'Contato não autorizado no fixture');
        const result = await service.request(proposal.cnpj, proposal.id, { role: 'Cliente' }, key);
        const verify = payloads().filter((row) => row.type === 'VERIFY').at(-1);
        assert.ok(verify, 'Evento VERIFY ausente');
        assert.equal(verify.recipient, email);
        assert.match(verify.code, /^\d{8}$/);
        assert.equal(result.code, undefined, 'Código não pode ser revelado ao navegador');
        return { ...result, code: verify.code, recipient: email };
    }

    async function validate(code) {
        return service.validateForClient(proposal.cnpj, proposal.id, code);
    }

    async function confirm(proof, consent = true) {
        return service.confirmForClient(
            proposal.cnpj, proposal.id, proof.confirmation, consent, { role: 'Cliente' },
        );
    }

    return {
        store, secrets, proposal, permissions, writes, service, params,
        payloads, request, validate, confirm,
        advance: (ms) => { clock += ms; },
        failure: (value) => { failure = value; },
    };
}

test('código + consentimento: só a confirmação altera o Airtable e cria comprovante', async () => {
    const f = fixture();
    const flow = await f.request();
    assert.equal(TTL, 120 * 60 * 1000);
    assert.equal(flow.recipientsCount, 1);
    assert.equal(f.writes.length, 0);
    const proof = await f.validate(flow.code);
    assert.equal(f.writes.length, 0);
    await assert.rejects(f.confirm(proof, false), /CONSENT_REQUIRED/);
    assert.equal(f.writes.length, 0);
    const accepted = await f.confirm(proof);
    assert.equal(accepted.status, 'Aceita');
    assert.equal(f.writes.length, 1);
    assert.equal(f.payloads().filter((e) => e.type === 'ACCEPTED').length, 2);
    assert.ok(await f.store.artifact(f.proposal.id));
    const state = await f.store.state(f.proposal.id);
    assert.equal(state.decision.state, 'done');
    assert.ok(state.decision.verifiedAt && state.decision.consentAt);
});

test('a validade de duas horas também cobre a confirmação final', async () => {
    const f = fixture();
    const flow = await f.request();
    const proof = await f.validate(flow.code);
    f.advance(TTL);
    await assert.rejects(f.confirm(proof), /CHALLENGE_INVALID/);
    assert.equal(f.writes.length, 0);
});

test('cinco tentativas incorretas bloqueiam o desafio e não gravam aceite', async () => {
    const f = fixture();
    const flow = await f.request();
    for (let i = 0; i < 5; i++)
        await assert.rejects(f.validate('invalid'), /CODE_INVALID/);
    await assert.rejects(f.validate(flow.code), /CHALLENGE_INVALID/);
    assert.equal(f.writes.length, 0);
});

test('novo código substitui o anterior sem registrar código em claro nas tabelas', async () => {
    const f = fixture();
    const previous = await f.request();
    f.advance(61_000);
    const recent = await f.request();
    await assert.rejects(f.validate(previous.code), /CODE_INVALID|CHALLENGE_INVALID/);
    const restarted = createService(f.params);
    const proof = await restarted.validateForClient(f.proposal.cnpj, f.proposal.id, recent.code);
    assert.ok(proof.confirmation);
    assert.equal(f.store.challenges.size, 2);
    const challenges = JSON.stringify([...f.store.challenges.values()]);
    assert.ok(!challenges.includes(previous.code));
    assert.ok(!challenges.includes(recent.code));
    const persistedEvents = JSON.stringify([...f.store.events.values()]);
    assert.ok(!persistedEvents.includes(recent.code));
});

test('outro CNPJ, PDF ambíguo, status terminal e Safe Mode são recusados', async () => {
    const f = fixture();
    await assert.rejects(f.service.options('99999999000199', f.proposal.id), /PROPOSAL_NOT_FOUND/);
    const key = f.secrets.codeHash(f.proposal.id, 'a@example.test');
    await assert.rejects(
        f.service.request('99999999000199', f.proposal.id, {}, key),
        /PROPOSAL_NOT_FOUND/,
    );
    f.proposal.anexos.push({ id: 'another' });
    await assert.rejects(f.request(), /PDF_AMBIGUOUS/);
    f.proposal.status = 'Pendente';
    await assert.rejects(f.request(), /PROPOSAL_TERMINAL/);
    await assert.rejects(
        createService({ ...f.params, enabled: () => false }).options(f.proposal.cnpj, f.proposal.id),
        /SAFE_MODE/,
    );
});

test('revogação explícita, troca de CNPJ, documento ou valor impedem aceite antigo', async () => {
    for (const mutate of [
        (f) => { f.proposal.valor++; },
        (f) => { f.permissions.delete('a@example.test'); },
        (f) => { f.proposal.cnpj = '99999999000199'; },
        (f) => { f.proposal.anexos[0].id = 'changed'; },
    ]) {
        const f = fixture();
        const flow = await f.request();
        const proof = await f.validate(flow.code);
        mutate(f);
        await assert.rejects(f.confirm(proof));
        assert.equal(f.writes.length, 0);
    }
});

test('rejeição exige justificativa, atualiza campos e bloqueia aceite pendente', async () => {
    const f = fixture();
    const flow = await f.request();
    const proof = await f.validate(flow.code);
    await assert.rejects(f.service.reject(f.proposal.cnpj, f.proposal.id, ' ', '', {}), /FEEDBACK_INVALID/);
    await f.service.reject(f.proposal.cnpj, f.proposal.id,
        'Prazo incompatível', 'Necessitamos prazo menor.', {});
    assert.equal(f.writes[0].status, 'Rejeitada');
    assert.match(f.writes[0].feedback, /Prazo incompatível/);
    await assert.rejects(f.confirm(proof));
    assert.equal(f.payloads().filter((e) => e.type === 'ACCEPTED').length, 0);
});

test('timeout após PATCH pode ser reconciliado sem nova escrita', async () => {
    for (const failure of ['before', 'after']) {
        const f = fixture();
        const flow = await f.request();
        const proof = await f.validate(flow.code);
        f.failure(failure);
        await assert.rejects(f.confirm(proof), /NETWORK/);
        assert.equal(f.payloads().filter((e) => e.type === 'ACCEPTED').length, 0);
        const restarted = createService(f.params);
        if (failure === 'after') {
            await restarted.reconcile(f.proposal.id);
        } else {
            await assert.rejects(restarted.reconcile(f.proposal.id), /DECISION_UNCERTAIN/);
        }
        assert.equal(f.writes.length, 1);
        assert.equal(f.payloads().filter((e) => e.type === 'ACCEPTED').length,
            failure === 'after' ? 2 : 0);
    }
});

test('publicação respeita PDF existente, data de corte e idempotência', async () => {
    const f = fixture();
    f.proposal.anexos = [];
    await assert.rejects(f.service.publish(f.proposal.id), /PDF_AMBIGUOUS/);
    assert.equal(f.store.events.size, 0);
    f.proposal.anexos = [{ id: 'attCCCCCCCCCCCCCC', filename: 'original.pdf', url: 'https://v5.airtableusercontent.com/pdf' }];
    await f.service.publish(f.proposal.id);
    await createService(f.params).publish(f.proposal.id);
    assert.equal(f.store.events.size, 2);
    const historical = fixture();
    historical.store.config.cutoff = Date.parse(historical.proposal.createdTime) + 1000;
    await historical.service.publish(historical.proposal.id);
    assert.equal(historical.store.events.size, 0);
});

test('persistência de desafio e evento é atômica quando a fila falha', async () => {
    const f = fixture();
    f.store.enqueue = async () => { throw new Error('DISK'); };
    await assert.rejects(f.request(), /DISK/);
    assert.equal(f.store.challenges.size, 0);
    assert.equal(f.store.states.size, 0);
});

test('solicitação envia um código para um único e-mail escolhido entre os autorizados', async () => {
    const f = fixture();
    const list = await f.service.options(f.proposal.cnpj, f.proposal.id);
    assert.equal(list.length, 2);
    assert.ok(list.every((contact) => contact.label.includes('***@')));
    const flow = await f.request('b@example.test');
    assert.equal(flow.recipientsCount, 1);
    const verification = f.payloads().filter((e) => e.type === 'VERIFY');
    assert.equal(verification.length, 1);
    assert.equal(verification[0].recipient, 'b@example.test');
    assert.equal(verification[0].expiresAt - Date.parse(f.proposal.createdTime), TTL);
    assert.equal(f.writes.length, 0);
});

test('revogar um dos contatos preserva a autorização do outro', async () => {
    const f = fixture();
    f.permissions.delete('a@example.test');
    const list = await f.service.options(f.proposal.cnpj, f.proposal.id);
    assert.deepEqual(list.map((item) => item.key), [f.secrets.codeHash(f.proposal.id, 'b@example.test')]);
    const flow = await f.request('b@example.test');
    const proof = await f.validate(flow.code);
    const accepted = await f.confirm(proof);
    assert.equal(accepted.status, 'Aceita');
    assert.equal(f.writes.length, 1);
});

test('reenvio após intervalo mínimo invalida o código anterior', async () => {
    const f = fixture();
    const first = await f.request();
    await assert.rejects(f.request(), /REQUEST_TOO_SOON/);
    f.advance(61_000);
    const second = await f.request('b@example.test');
    await assert.rejects(f.validate(first.code), /CODE_INVALID|CHALLENGE_INVALID/);
    const proof = await f.validate(second.code);
    assert.ok(proof.confirmation);
    assert.equal(f.payloads().filter((e) => e.type === 'VERIFY').length, 2);
});

test('sem contato expressamente autorizado o token é bloqueado sem enfileirar', async () => {
    const f = fixture();
    f.permissions.clear();
    await assert.rejects(f.service.options(f.proposal.cnpj, f.proposal.id), /RECIPIENT_MISSING/);
    await assert.rejects(
        f.service.request(f.proposal.cnpj, f.proposal.id, {}, 'invalid'),
        /RECIPIENT_MISSING/,
    );
    assert.equal(f.payloads().length, 0);
    const withoutDirectory = createService({ ...f.params, authorizedContacts: undefined });
    await assert.rejects(
        withoutDirectory.options(f.proposal.cnpj, f.proposal.id),
        /AUTHORIZATIONS_UNAVAILABLE/,
    );
});

test('lista comercial separada por ponto e vírgula ignora duplicados e inválidos', () => {
    const { emails } = require('../lib/portal-access');
    assert.deepEqual(
        emails('COMERCIAL@Exemplo.com; financeiro@exemplo.com ; comercial@exemplo.com; inválido ; juridico@exemplo.com'),
        ['comercial@exemplo.com', 'financeiro@exemplo.com', 'juridico@exemplo.com'],
    );
});

test('falha de enfileiramento cancela integralmente a emissão do código', async () => {
    const f = fixture();
    f.store.enqueue = async () => { throw new Error('INTERNAL_ENQUEUE_FAILED'); };
    await assert.rejects(f.request(), /INTERNAL_ENQUEUE_FAILED/);
    assert.equal(f.store.events.size, 0);
    assert.equal(f.store.challenges.size, 0);
    assert.equal(f.store.states.size, 0);
});

test('aceite confirmado só escreve uma vez, sem duplicar efeito comercial', async () => {
    const f = fixture();
    const flow = await f.request();
    const proof = await f.validate(flow.code);
    await f.confirm(proof);
    assert.equal(f.writes.length, 1);
    await assert.rejects(f.confirm(proof), /DECISION_EXISTS|CHALLENGE_INVALID/);
    await assert.rejects(f.validate(flow.code), /DECISION_EXISTS|CHALLENGE_INVALID/);
    assert.equal(f.writes.length, 1);
    assert.equal(f.payloads().filter((e) => e.type === 'ACCEPTED').length, 2);
});
