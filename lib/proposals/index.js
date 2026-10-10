'use strict';

const { createStore } = require('./store');
const { createSecrets } = require('./crypto');
const { createService } = require('./service');
const { createWorker } = require('./worker');
const { registerRoutes } = require('./routes');

function install(app, dependencies) {
    const { pool, config } = dependencies;
    const airtable = require('../../finance-airtable');
    const store = createStore(pool);
    const secrets = createSecrets(config.security.pepper);
    const service = createService({
        store,
        secrets,
        airtable,
        origin: config.publicOrigin,
        enabled: () => !config.security.safeMode && config.security.writeEnabled,
    });
    const worker = createWorker({
        store,
        secrets,
        service,
        airtable,
        notificationUrl: config.notifications.url,
        secret: config.notifications.secret,
    });
    registerRoutes(app, { ...dependencies, store, secrets, service, worker });
    return worker;
}

module.exports = { install };
