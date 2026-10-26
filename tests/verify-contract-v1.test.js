'use strict';

// Lado Portal do contrato VERIFY v1 (tests/fixtures/verify-event-v1.json,
// cópia idêntica no serviço de e-mails): o evento REAL produzido por
// service.request tem exatamente as chaves e tipos do contrato.

const test = require('node:test');
const assert = require('node:assert/strict');
const contract = require('./fixtures/verify-event-v1.json');
const { createService, TTL } = require('../lib/proposals/service');
const { createSecrets } = require('../lib/proposals/crypto');
const { createAuthorizedContacts } = require('../lib/proposals/authorized-contacts');
const { memoryStore } = require('./helpers/proposals-memory');

test('VERIFY emitido pelo Portal segue o contrato v1 compartilhado', async () => {
    const store = memoryStore();
    const secrets = createSecrets(Buffer.alloc(32, 6).toString('base64'));
    const now = Date.parse('2026-10-26T13:00:00Z');
    const proposal = {
        id: 'recAAAAAAAAAAAAAA', numero: '2026-077', cnpj: '12345678000190', clienteId: 'recBBBBBBBBBBBBBB',
        nomeCliente: 'Empresa Exemplo', valor: 4800, formaPagamento: 'Boleto', prazoPagamentoDias: 30,
        observacoes: null, descricao: null, dataEnvio: '2026-10-26', status: 'Enviada',
        emails: ['compras@example.test'], anexos: [{ id: 'attAAAAAAAAAAAAAA', filename: 'Proposta.pdf', url: 'https://x' }],
    };
    const service = createService({
        store, secrets, authorizedContacts: createAuthorizedContacts(), origin: 'https://p.example.test',
        enabled: () => true, now: () => now,
        pdf: async () => ({ hash: secrets.hash('pdf') }),
        airtable: { carregarPropostaAtual: async () => structuredClone(proposal) },
    });
    await service.request(proposal.cnpj, proposal.id, {}, secrets.codeHash(proposal.id, 'compras@example.test'));
    const [row] = store.events.values();
    const event = secrets.open(row.payload);
    assert.equal(TTL, contract.ttlMs);
    assert.deepEqual(Object.keys(event).sort(), [...contract.eventKeys].sort());
    for (const key of contract.forbiddenKeys) assert.equal(event[key], undefined, key);
    assert.deepEqual(Object.keys(event.snapshot).sort(), [...contract.snapshotKeys].sort());
    assert.deepEqual(Object.keys(event.snapshot.proposal).sort(), [...contract.proposalKeys].sort());
    assert.equal(event.type, 'VERIFY');
    assert.match(event.code, new RegExp(contract.codePattern));
    assert.equal(typeof event.code, 'string');
    assert.equal(event.expiresAt, now + contract.ttlMs);
    assert.match(event.eventId, /^[a-f0-9]{64}$/);
    assert.match(event.challengeId, /^[a-f0-9-]{36}$/);
    // Exemplo da fixture tem os mesmos campos do evento real.
    assert.deepEqual(Object.keys(contract.example).sort(), Object.keys(event).sort());
});

test('código preserva zeros à esquerda e cobre todo o intervalo de oito dígitos', () => {
    const secrets = createSecrets(Buffer.alloc(32, 6).toString('base64'));
    const crypto = require('node:crypto');
    const original = crypto.randomInt;
    try {
        crypto.randomInt = () => 42;
        assert.equal(secrets.code(), '00000042');
        crypto.randomInt = () => 99999999;
        assert.equal(secrets.code(), '99999999');
    } finally {
        crypto.randomInt = original;
    }
});
