'use strict';

const { createStore } = require('./store');
const { createSecrets } = require('./crypto');
const { createService } = require('./service');
const { createWorker } = require('./worker');
const { registerRoutes } = require('./routes');
const { createAuthorizedContacts } = require('./authorized-contacts');
const { createInvoiceNotifications } = require('../invoices/notifications');

function install(app, dependencies) {
    const { pool, config } = dependencies;
    const airtable = require('../../finance-airtable');
    const store = createStore(pool);
    const secrets = createSecrets(config.security.pepper);
    const service = createService({
        store,
        secrets,
        authorizedContacts: createAuthorizedContacts({ airtable }),
        airtable,
        origin: config.publicOrigin,
        enabled: () => !config.security.safeMode && config.security.writeEnabled,
    });
    const invoiceNotifications = createInvoiceNotifications({ store, airtable, service, secrets });
    const worker = createWorker({
        invoiceNotifications,
        store,
        secrets,
        authorizedContacts: createAuthorizedContacts({ airtable }),
        service,
        airtable,
        notificationUrl: config.notifications.url,
        secret: config.notifications.secret,
    });
    registerRoutes(app, { ...dependencies, store, secrets, service, worker, invoiceNotifications });
    return worker;
}

module.exports = { install };
