'use strict';

// Execução manual. Não é chamado pelo startup nem pelos scripts de cópia.
const pool = require('../db');
const { createStore } = require('../lib/proposals/store');
const { createSecrets } = require('../lib/proposals/crypto');
const config = require('../config');

async function main() {
    const command = process.argv[2] || 'status';
    const store = createStore(pool);
    const settings = await store.settings();
    if (command === 'status') {
        const [outbox] = await pool.query(
            'SELECT status, COUNT(*) AS total FROM portal_proposal_outbox GROUP BY status',
        );
        const applying = await store.applying();
        console.log(
            JSON.stringify(
                {
                    enabled: settings.enabled,
                    cutoff: settings.cutoff,
                    outbox,
                    decisionsRequiringReview: applying,
                },
                null,
                2,
            ),
        );
        return;
    }
    if (!process.argv.includes('--confirmar'))
        throw new Error('Operação exige --confirmar e autorização do responsável pelo ambiente.');
    if (command === 'ativar' || command === 'pausar') {
        // Preserve the original cutoff on resume: never silently drop queued proposals.
        const data = {
            ...settings,
            enabled: command === 'ativar',
            cutoff: settings.cutoff || Date.now(),
        };
        await pool.query('UPDATE portal_proposal_settings SET data = ? WHERE id = 1', [
            JSON.stringify(data),
        ]);
        console.log(
            command === 'ativar'
                ? 'Propostas ativadas. Marco inicial preservado.'
                : 'Propostas pausadas. Recibos e decisões preservados.',
        );
        return;
    }
    if (command === 'reconsultar-evento') {
        const id = process.argv[3];
        if (!/^[a-f0-9]{64}$/.test(id || '')) throw new Error('Event ID inválido.');
        await store.withLock(`event:${id}`, async (repo) => {
            const event = await repo.event(id);
            if (!event || event.status !== 'uncertain')
                throw new Error('Somente um evento incerto pode ser reconsultado.');
            await repo.eventState(id, 'pending');
        });
        console.log('Mesmo evento liberado para consultar novamente o recibo do receptor.');
        return;
    }
    if (command === 'webhook') {
        // Pipe Airtable's macSecretBase64 through stdin, never through a command argument.
        let secret = '';
        for await (const chunk of process.stdin) secret += chunk;
        secret = secret.trim();
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(secret) || Buffer.from(secret, 'base64').length < 32)
            throw new Error('MAC secret inválido.');
        settings.webhookSecret = createSecrets(config.security.pepper).seal(secret);
        await pool.query('UPDATE portal_proposal_settings SET data = ? WHERE id = 1', [
            JSON.stringify(settings),
        ]);
        console.log(
            'MAC secret de webhook salvo de forma criptografada. Nenhum webhook foi criado no Airtable.',
        );
        return;
    }
    if (command === 'liberar-tentativa') {
        const id = process.argv[3];
        if (!/^rec[a-zA-Z0-9]{14}$/.test(id || '')) throw new Error('Record ID inválido.');
        await store.withLock(id, async (repo) => {
            const state = await repo.state(id);
            if (state.decision?.state !== 'applying')
                throw new Error('Não há decisão incerta para revisar.');
            const current = await require('../finance-airtable').carregarPropostaAtual(
                id,
                state.decision.cnpj,
            );
            if (!['Enviada', 'Em Análise pelo Cliente'].includes(current.status))
                throw new Error('Status externo não permite liberar nova tentativa.');
            state.history = [
                ...(state.history || []),
                { ...state.decision, reviewedAt: Date.now(), resolution: 'manual-new-attempt' },
            ];
            delete state.decision;
            state.activeChallenge = null;
            await repo.saveState(id, state);
        });
        console.log(
            'Tentativa encerrada para revisão. Cliente precisará solicitar um novo código; nenhum PATCH foi realizado.',
        );
        return;
    }
    throw new Error(
        'Comando desconhecido. Use status, ativar, pausar, webhook ou liberar-tentativa.',
    );
}

main()
    .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    })
    .finally(() => pool.end());
