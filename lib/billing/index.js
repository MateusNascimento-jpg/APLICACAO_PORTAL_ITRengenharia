'use strict';
const { configuration } = require('./config');
const { createStore } = require('./store');
const { createBudget, readOnlyAirtable } = require('./budget');
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
    // Billing's own budget; separate legacy consumers retain theirs.
    const source = createSource({ cipher: store.cipher, airtable: readOnlyAirtable(airtable, createBudget()) });
    const service = createService({ store, source });
    register(app, express, { config, service, store });
    return createWorker({ config, store, service });
}
module.exports = { install };
