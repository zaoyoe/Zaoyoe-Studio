'use strict';

const Module = require('node:module');
const path = require('node:path');
const { fixture, accepted, receipt } = require('./shop-supplier-runtime-fixture');

const scenario = process.env.SHOP_SUPPLIER_REDACTION_SCENARIO;
const marker = {
    serviceRole: process.env.SUPABASE_SERVICE_ROLE_KEY,
    upstream: 'LEAK_UPSTREAM_PAYLOAD_SENTINEL',
    delivery: 'LEAK_DELIVERY_CONTENT_SENTINEL',
    database: 'LEAK_DATABASE_ERROR_SENTINEL',
    adapter: 'LEAK_ADAPTER_ERROR_SENTINEL'
};

const adapterOverrides = {
    createPurchase: async function createPurchase() {
        if (scenario === 'adapter_error') throw Object.assign(new Error(marker.adapter), { code: marker.adapter });
        return { ...accepted(), appKey: process.env.SUPPLIER_FIXTURE_APP_KEY,
            rawResponse: marker.upstream, deliveryContent: marker.delivery };
    },
    queryDelivery: async function queryDelivery() {
        return { ...receipt(), appKey: process.env.SUPPLIER_FIXTURE_APP_KEY,
            rawResponse: marker.upstream, content: marker.delivery };
    }
};
const harness = fixture({ phase: scenario === 'delivery' ? 'delivery' : 'dispatch', adapter: adapterOverrides });
const originalRpc = harness.db.rpc.bind(harness.db);
harness.db.rpc = async (name, params) => {
    if (scenario === 'rpc_error' && name === 'fn_shop_supplier_runtime_v2' && params.p_action === 'scan') {
        throw new Error(marker.database);
    }
    return originalRpc(name, params);
};

const workerPath = path.resolve(__dirname, '../../scripts/shop-supplier-worker.js');
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
    if (parent?.filename === workerPath && request === '@supabase/supabase-js') {
        return { createClient(url, key) {
            if (url !== 'https://fixture.invalid' || key !== marker.serviceRole) throw new Error(marker.database);
            return harness.db;
        } };
    }
    if (parent?.filename === workerPath && request === '../server/integrations/suppliers/registry') {
        return { createConfiguredSupplierAdapterRegistry() {
            return { require(providerId) {
                if (providerId !== 'fixture') throw new Error(marker.adapter);
                return harness.adapter;
            } };
        } };
    }
    return originalLoad.call(this, request, parent, isMain);
};

global.fetch = async () => { throw new Error('network access blocked by worker redaction harness'); };
