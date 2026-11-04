'use strict';
// Paces Airtable reads inside this process, without holding database connections.
// Calls run one at a time; a 429 stops new calls for the period Airtable penalizes.
function createBudget({ minIntervalMs = 250, cooldownMs = 30000, clock = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    let tail = Promise.resolve(), nextStart = 0, cooldownUntil = 0;
    async function attempt(fn) {
        if (clock() < cooldownUntil) throw new Error('RATE_LIMITED');
        const wait = nextStart - clock();
        if (wait > 0) await sleep(wait);
        nextStart = clock() + minIntervalMs;
        try { return await fn(); }
        catch (error) {
            if (error?.status !== 429) throw error;
            cooldownUntil = clock() + cooldownMs;
            throw new Error('RATE_LIMITED');
        }
    }
    return {
        run(fn) {
            const result = tail.then(() => attempt(fn));
            tail = result.catch(() => {});
            return result;
        }
    };
}
// The billing module receives these two read operations and nothing else.
function readOnlyAirtable(airtable, budget) {
    return Object.freeze({
        obterRegistro: (...args) => budget.run(() => airtable.obterRegistro(...args)),
        listarRegistros: (...args) => budget.run(() => airtable.listarRegistros(...args))
    });
}
module.exports = { createBudget, readOnlyAirtable };
