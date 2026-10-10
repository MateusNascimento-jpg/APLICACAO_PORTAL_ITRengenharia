'use strict';

const { headers } = require('./protocol');

function createWorker({
    store,
    service,
    secrets,
    airtable,
    notificationUrl,
    secret,
    fetcher = fetch,
    logger = console,
}) {
    let stopped = true;
    let timer;
    let running;
    let scanning;
    let lastScan = 0;

    async function deliver(id) {
        return store.withLock(`event:${id}`, async (repo) => {
            const row = await repo.event(id);
            if (!row || row.status !== 'pending' || Number(row.next_at) > Date.now()) return;
            const payload = secrets.open(row.payload);
            try {
                await service.checkEvent(payload);
            } catch (error) {
                if (
                    [
                        'EVENT_OBSOLETE',
                        'CHALLENGE_INVALID',
                        'DECISION_EXISTS',
                        'PROPOSAL_NOT_FOUND',
                    ].includes(error.code || error.message)
                ) {
                    await repo.eventState(id, 'cancelled');
                    return;
                }
                throw error;
            }
            const origin = new URL(notificationUrl);
            if (
                origin.protocol !== 'https:' ||
                origin.username ||
                origin.password ||
                origin.pathname !== '/' ||
                origin.search ||
                origin.hash
            )
                throw new Error('NOTIFICATION_ORIGIN_INVALID');
            const route = '/internal/proposals/events';
            const body = JSON.stringify(payload);
            try {
                const response = await fetcher(origin.origin + route, {
                    method: 'POST',
                    redirect: 'error',
                    body,
                    headers: headers(secret, 'POST', route, body),
                    signal: AbortSignal.timeout(85000),
                });
                const result = await response.json();
                if (response.ok && result.ok && result.eventId === id) {
                    await repo.eventState(id, 'sent');
                } else if (
                    result.code === 'DELIVERY_UNCERTAIN' ||
                    result.code === 'EVENT_CONFLICT'
                ) {
                    await repo.eventState(id, 'uncertain');
                } else if (response.status === 422) {
                    await repo.eventState(id, 'cancelled');
                } else {
                    await repo.eventState(
                        id,
                        'pending',
                        Date.now() + Math.min(300000, 5000 * 2 ** Math.min(row.attempts, 6)),
                    );
                }
            } catch (_) {
                // Retry the SAME event ID: the receiver owns the durable SMTP receipt.
                await repo.eventState(id, 'pending', Date.now() + 30000);
            }
        });
    }

    async function scan(settings) {
        await store.withLock('scan', async () => {
            for (const id of await store.applying()) {
                try {
                    await service.reconcile(id);
                } catch (_) {
                    logger.warn('[Propostas] Decisão pendente de reconciliação.');
                }
            }
            for (const record of await airtable.listarCandidatas(settings.cutoff)) {
                if (stopped) return;
                if (!(Date.parse(record.createdTime) >= settings.cutoff)) continue;
                try {
                    await service.publish(record.id);
                } catch (_) {
                    logger.warn('[Propostas] Cadastro/documento pendente de validação.');
                }
            }
            await store.cleanup();
        });
    }

    async function tick() {
        try {
            const settings = await service.active();
            for (const item of await store.due()) {
                if (stopped) return;
                try {
                    await deliver(item.id);
                } catch (_) {
                    logger.warn('[Propostas] Evento pendente; verifique o diagnóstico comercial.');
                }
            }
            if (!scanning && Date.now() - lastScan >= 60000 && !stopped) {
                lastScan = Date.now();
                scanning = scan(settings)
                    .catch(() => {
                        logger.warn(
                            '[Propostas] Sincronização pendente; nova tentativa no próximo ciclo.',
                        );
                    })
                    .finally(() => {
                        scanning = null;
                    });
            }
        } catch (error) {
            if (
                !['SAFE_MODE', 'PROPOSALS_DISABLED', 'ER_NO_SUCH_TABLE'].includes(
                    error.code || error.message,
                )
            ) {
                logger.warn('[Propostas] Processamento comercial indisponível.');
            }
        }
    }

    function wake() {
        if (stopped || running) return;
        running = tick().finally(() => {
            running = null;
        });
    }

    return {
        deliver,
        wake,
        rescan() {
            lastScan = 0;
            wake();
        },
        start() {
            stopped = false;
            timer = setInterval(wake, 3000);
            timer.unref();
            wake();
        },
        async stop() {
            stopped = true;
            clearInterval(timer);
            await Promise.all([running, scanning]);
        },
    };
}

module.exports = { createWorker };
