'use strict';
const { configuration } = require('./config');
const { createStore } = require('./store');
const { createSource } = require('./source');
const { createService } = require('./service');
const { createWorker } = require('./worker');
const { register } = require('./routes');
function install(app, { express, pool, airtable, env = process.env }) {
    const config = configuration(env);
    if (!config.enabled) {
        register(app, express, { config });
        return { start() {}, async stop() {} };
    }
    const store = createStore(pool, config.storageKey);
    // Shared lock across this billing deployment; separate legacy consumers retain their own budgets.
    const read = fn => store.locked('airtable-budget', async () => {
        try { return await fn(); } finally { await new Promise(resolve => setTimeout(resolve, 250)); }
    });
    const source = createSource({ cipher: store.cipher, airtable: {
        obterRegistro: (...args) => read(() => airtable.obterRegistro(...args)),
        listarRegistros: (...args) => read(() => airtable.listarRegistros(...args))
    } });
    const service = createService({ store, source });
    register(app, express, { config, service, store });
    return createWorker({ config, store, service });
}
module.exports = { install };
