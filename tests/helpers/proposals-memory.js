'use strict';

function memoryStore() {
    const states = new Map();
    const challenges = new Map();
    const events = new Map();
    const artifacts = new Map();
    const invoices = new Map();
    const locks = new Map();
    const clone = (value) => (value == null ? value : structuredClone(value));
    const store = {
        states,
        challenges,
        events,
        config: { enabled: true, cutoff: 1 },
        settings: async () => clone(store.config),
        state: async (id) => clone(states.get(id) || {}),
        saveState: async (id, value) => {
            states.set(id, clone(value));
        },
        challenge: async (id) => clone(challenges.get(id)),
        saveChallenge: async (value) => {
            challenges.set(value.id, clone(value));
        },
        token: async (hash) =>
            clone([...challenges.values()].find((value) => value.tokenHash === hash)),
        enqueue: async (value) => {
            if (!events.has(value.id))
                events.set(value.id, {
                    ...clone(value),
                    status: 'pending',
                    attempts: 0,
                    next_at: 0
                });
        },
        artifact: async (id) => clone(artifacts.get(id)),
        saveArtifact: async (data) => {
            const previous = artifacts.get(data.proposalId);
            if (previous && (previous.version !== data.version || previous.proofHash !== data.proofHash))
                throw new Error('ARTIFACT_VERSION_CONFLICT');
            artifacts.set(data.proposalId, clone({
                version:data.version,cnpj:data.cnpj,
                original_sha256:data.originalHash,comprovante_sha256:data.proofHash,
                original_name:data.filename,original_pdf:data.original,
                comprovante_pdf:data.proof,proofHash:data.proofHash,
            }));
        },
        invoiceState: async (id) => clone(invoices.get(id) || null),
        saveInvoiceState: async (id,data) => { invoices.set(id,clone(data)); },
        event: async (id) => clone(events.get(id)),
        eventState: async (id, status, nextAt) => {
            Object.assign(events.get(id), { status, next_at: nextAt });
        },
        async transaction(work) {
            const backup = [clone(states), clone(challenges), clone(events)];
            try {
                return await work();
            } catch (error) {
                [states, challenges, events].forEach((map, index) => {
                    map.clear();
                    for (const [key, value] of backup[index]) map.set(key, value);
                });
                throw error;
            }
        },
        async withLock(id, work) {
            const previous = locks.get(id) || Promise.resolve();
            let unlock;
            const gate = new Promise((resolve) => {
                unlock = resolve;
            });
            locks.set(
                id,
                previous.then(() => gate)
            );
            await previous;
            try {
                return await work(store);
            } finally {
                unlock();
            }
        }
    };
    return store;
}

module.exports = { memoryStore };
