'use strict';

const { createSupplierAdapterRegistry } = require('./contract');
const { create16688AdapterFromEnv } = require('./16688/client');

/**
 * Build the provider-neutral registry for the current process configuration.
 * Adding a supplier should add its adapter here, rather than adding provider
 * checks to shop handlers or storefront/payment code.
 */
function createConfiguredSupplierAdapterRegistry({ env = process.env, options = {} } = {}) {
    const adapters = [];
    const appId = String(env.SUPPLIER_16688_APP_ID || '').trim();
    const secret = String(env.SUPPLIER_16688_SECRET || '');

    if (appId && secret) {
        adapters.push(create16688AdapterFromEnv(env, options['16688'] || {}));
    }

    return createSupplierAdapterRegistry(adapters);
}

module.exports = {
    createConfiguredSupplierAdapterRegistry
};
