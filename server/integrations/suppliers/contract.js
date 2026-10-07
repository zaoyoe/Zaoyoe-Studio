'use strict';

const CAPABILITY_METHODS = Object.freeze({
    catalog: ['listGoods', 'getGoodsDetail', 'normalizeCatalogItem'],
    quote: ['quotePrice'],
    procurement: ['createPurchase', 'queryPurchase'],
    purchaseHistory: ['listPurchases'],
    accountBalance: ['getBalance']
});

class SupplierAdapterError extends Error {
    constructor(message, {
        providerId = 'unknown',
        operation = 'unknown',
        code = 'supplier_error',
        retryable = false,
        outcomeUnknown = false,
        cause = null
    } = {}) {
        super(message, cause ? { cause } : undefined);
        this.name = 'SupplierAdapterError';
        this.providerId = String(providerId || 'unknown');
        this.operation = String(operation || 'unknown');
        this.code = String(code || 'supplier_error');
        this.retryable = retryable === true;
        this.outcomeUnknown = outcomeUnknown === true;
    }
}

function normalizeProviderId(value) {
    return String(value || '').trim().toLowerCase();
}

function validateAdapter(adapter) {
    if (!adapter || typeof adapter !== 'object') {
        throw new TypeError('Supplier adapter must be an object');
    }

    const providerId = normalizeProviderId(adapter.providerId);
    if (!providerId) {
        throw new TypeError('Supplier adapter must declare providerId');
    }

    const capabilities = adapter.capabilities && typeof adapter.capabilities === 'object'
        ? adapter.capabilities
        : {};

    for (const [capability, methods] of Object.entries(CAPABILITY_METHODS)) {
        if (capabilities[capability] !== true) continue;
        for (const method of methods) {
            if (typeof adapter[method] !== 'function') {
                throw new TypeError(`Supplier adapter ${providerId} advertises ${capability} but is missing ${method}()`);
            }
        }
    }

    return providerId;
}

function createSupplierAdapterRegistry(initialAdapters = []) {
    const adapters = new Map();

    function register(adapter) {
        const providerId = validateAdapter(adapter);
        if (adapters.has(providerId)) {
            throw new Error(`Supplier adapter already registered: ${providerId}`);
        }
        adapters.set(providerId, Object.freeze({ ...adapter, providerId }));
        return adapters.get(providerId);
    }

    function get(providerId) {
        return adapters.get(normalizeProviderId(providerId)) || null;
    }

    function require(providerId, capability = '') {
        const adapter = get(providerId);
        if (!adapter) {
            throw new SupplierAdapterError(`Supplier adapter is not configured: ${providerId}`, {
                providerId,
                operation: 'resolve_adapter',
                code: 'supplier_not_configured'
            });
        }
        if (capability && adapter.capabilities?.[capability] !== true) {
            throw new SupplierAdapterError(`Supplier does not support capability: ${capability}`, {
                providerId: adapter.providerId,
                operation: 'resolve_capability',
                code: 'supplier_capability_unsupported'
            });
        }
        return adapter;
    }

    function list() {
        return [...adapters.values()];
    }

    for (const adapter of initialAdapters) register(adapter);

    return Object.freeze({ register, get, require, list });
}

module.exports = {
    CAPABILITY_METHODS,
    SupplierAdapterError,
    createSupplierAdapterRegistry
};
