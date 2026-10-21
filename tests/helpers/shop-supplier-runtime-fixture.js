'use strict';
const assert = require('node:assert/strict');
const { createSupplierRuntime, CONTRACT } = require('../../server/integrations/suppliers/runtime');
const procurement = require('../../server/integrations/suppliers/procurement');
const delivery = require('../../server/integrations/suppliers/delivery');
const f = require('./shop-supplier-resolution-fixture');
const { intent, request, order } = f.IDS;
const account = '77777777-7777-4777-8777-777777777777';
const token = '88888888-8888-4888-8888-888888888888';
const attempt = '99999999-9999-4999-8999-999999999999';
const hash = 'a'.repeat(64);
const env = { SHOP_SUPPLIER_RUNTIME_V2_ENABLED: 'true', SHOP_SUPPLIER_DISPATCH_V2_ENABLED: 'true',
    SHOP_SUPPLIER_RECONCILE_V2_ENABLED: 'true', SHOP_SUPPLIER_DELIVERY_V2_ENABLED: 'true',
    SHOP_SUPPLIER_DELIVERY_ACTIVE_KEY: 'test', SHOP_SUPPLIER_DELIVERY_KEYS: JSON.stringify({ test: 'test-runtime-encryption-'.repeat(3) }),
    SHOP_SUPPLIER_DELIVERY_FINGERPRINT_KEY: 'test-runtime-fingerprint-'.repeat(3) };
function accountRow() { return { id: account, provider_id: 'fixture', credential_ref: 'env:SUPPLIER_FIXTURE' }; }
function purchaseTicket() { return { intentId: intent, attemptId: attempt, token: attempt, account: accountRow(),
    contractHash: procurement.CONTRACT_HASH, evidenceHash: hash,
    request: { requestId: request, goodsNo: 'fixture-goods', variant: {}, quantity: 1, maxCost: { currency: 'CNY', amount: '12.000000' } } }; }
function deliveryTicket() { return { intentId: intent, unitId: order, account: accountRow(), site: 'cn', requestId: request,
    orderNo: 'FIXTURE-ORDER', contractHash: delivery.CONTRACT_HASH, proofHash: hash }; }
function accepted() { return { outcome: 'accepted', accountId: account, requestId: request, orderNo: 'FIXTURE-ORDER', evidenceHash: hash }; }
function receipt() { return { outcome: 'delivered', accountId: account, requestId: request, orderNo: 'FIXTURE-ORDER', evidenceHash: hash,
    completeDelivery: true, quantity: 1, finalCost: true, cost: { currency: 'CNY', amount: '12.000000' }, content: 'fixture-goods-private-content' }; }
function fixture(options = {}) {
    const calls = []; const http = []; const resolutions = [];
    const phase = options.phase || 'dispatch';
    const scripts = options.scripts || {};
    const adapter = { providerId: 'fixture', capabilities: { procurement: true, requestLookup: true, deliveryQuery: true },
        runtimeContract: CONTRACT, procurementContract: procurement.CONTRACT, deliveryContract: delivery.CONTRACT,
        async createPurchase(input, bounds) { assert.equal(this, adapter); http.push({ method: 'create', input, bounds }); return accepted(); },
        async queryPurchase(input, bounds) { assert.equal(this, adapter); http.push({ method: 'query', input, bounds }); return accepted(); },
        async queryDelivery(input, bounds) { assert.equal(this, adapter); http.push({ method: 'delivery', input, bounds }); return receipt(); },
        ...options.adapter };
    if (options.frozen) Object.freeze(adapter);
    const db = { async rpc(name, params) {
        calls.push({ name, ...structuredClone(params) });
        const key = name === 'fn_shop_supplier_runtime_v2' ? params.p_action : `${name}:${params.p_action || ''}`;
        if (scripts[key]) return scripts[key](params, { calls, http, adapter });
        if (name === 'fn_shop_supplier_runtime_v2') {
            if (params.p_action === 'scan') return { data: { jobs: [{ intentId: intent, phase }] } };
            if (params.p_action === 'claim') return { data: { acquired: true, intentId: intent, accountId: account, phase, token } };
            if (params.p_action === 'start') return { data: { applied: true, intentId: intent, accountId: account, phase, token } };
            if (params.p_action === 'finish') return { data: { applied: true, intentId: intent, token } };
        }
        if (name === 'fn_shop_supplier_dispatch_v2') {
            if (['prepare', 'claim_query'].includes(params.p_action)) return { data: { acquired: true, ticket: purchaseTicket() } };
            if (params.p_action === 'begin') return { data: { applied: true, status: 'dispatching' } };
            if (params.p_action === 'record') return { data: { applied: true,
                status: params.p_result.outcome === 'unknown' ? 'outcome_unknown' : params.p_result.outcome } };
        }
        if (name === 'fn_shop_supplier_delivery_ticket_v2') return { data: { status: 'ready', ticket: deliveryTicket() } };
        if (name === 'fn_shop_supplier_record_delivery_v2') return { data: { applied: true, status: 'delivered' } };
        assert.fail(`Unexpected mock RPC ${name}`);
    } };
    const runtime = createSupplierRuntime({ db, env: options.env || env,
        requestTimeoutMs: options.requestTimeoutMs || 15000, ...(options.now ? { now: options.now } : {}),
        resolveAdapter: async row => { resolutions.push(row); return options.resolve ? options.resolve(row) : adapter; } });
    return { runtime, db, adapter, calls, http, resolutions, finish: () => calls.filter(c => c.p_action === 'finish').at(-1) };
}
module.exports = { ...f, env, fixture, accountRow, purchaseTicket, deliveryTicket, accepted, receipt, account, token, attempt, hash };
