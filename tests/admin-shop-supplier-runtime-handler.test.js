'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const f = require('./helpers/shop-supplier-resolution-fixture');
const handlerPath = require.resolve('../server/api-handlers/admin/shop/supplier-catalog');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === '../../../../api/_lib/admin' && parent?.filename === handlerPath) return {};
    return originalLoad.call(this, request, parent, isMain);
};
const { createSupplierCatalogHandler } = require(handlerPath);
Module._load = originalLoad;
const body = { action: 'runtime-resume', providerId: 'xiareng', accountKey: 'original', site: 'cn',
    intentId: f.IDS.intent, orderId: f.IDS.order, fundingKind: 'points', operationId: f.IDS.operation };
function fixture(options = {}) {
    const calls = []; const permissions = [];
    const db = { async rpc(name, input) {
        calls.push({ name, input });
        if (name === 'fn_shop_supplier_operations_v2') return options.operations || { data: { rows: [f.operation()], hasMore: false } };
        if (options.throws) throw Error('private-provider-secret');
        return Object.hasOwn(options, 'result') ? options.result : { data: { applied: true, operationId: f.IDS.operation } };
    }, from() { assert.fail('historical recovery must not resolve enabled account/credentials'); } };
    const handler = createSupplierCatalogHandler({ env: {},
        registryFactory() { assert.fail('runtime recovery must not call upstream'); },
        requireAdmin: async (req, input) => { permissions.push(input);
            if (options.forbidden) throw Object.assign(new Error('forbidden'), { statusCode: 403 });
            return { supabase: db, user: { id: options.actor || f.IDS.actor } };
        }, parseJsonBody: async req => req.body,
        sendJson: (res, status, value) => { res.status = status; res.payload = value; }, writeAdminAuditLog: async () => {} });
    return { calls, permissions, async post(patch = {}) { const res = { setHeader() {} };
        await handler({ method: 'POST', url: '/api/admin/shop/supplier-catalog', body: { ...body, ...patch } }, res); return res;
    } };
}
test('resume checks manage permission and exact native/account scope before private actor-bound RPC', async () => {
    const h = fixture(); const res = await h.post();
    assert.equal(res.status, 200); assert.deepEqual(h.permissions, [{ permission: 'shop.manage' }]);
    assert.deepEqual(h.calls, [{ name: 'fn_shop_supplier_operations_v2', input: { p_provider_id: 'xiareng',
        p_account_key: 'original', p_limit: 1, p_native_order_id: f.IDS.order, p_funding_kind: 'points', p_site: 'cn' } },
    { name: 'fn_shop_supplier_runtime_v2', input: { p_action: 'resume', p_intent_id: f.IDS.intent,
        p_token: f.IDS.operation, p_actor_id: f.IDS.actor } }]);
    assert.deepEqual(res.payload, { success: true, applied: true, operationId: f.IDS.operation });
});
test('permission rejection and malformed scope never mutate runtime or contact upstream', async () => {
    const denied = fixture({ forbidden: true }); assert.equal((await denied.post()).status, 403); assert.equal(denied.calls.length, 0);
    for (const patch of [{ intentId: 'bad' }, { operationId: 'bad' }, { orderId: 'bad' }, { site: 'intl' },
        { accountKey: '' }, { accountKey: {} }, { accountKey: '../other' }, { fundingKind: 'cash' }, { secret: 'not-allowed' }]) {
        const h = fixture(); const res = await h.post(patch);
        assert.equal(res.status, 400); assert.equal(h.calls.length, 0);
    }
});
test('wrong original intent, native order, funding kind and ambiguous result cannot resume', async () => {
    for (const data of [{ rows: [], hasMore: false }, { rows: [f.operation({ intentId: f.IDS.other })], hasMore: false },
        { rows: [f.operation()], hasMore: true }, { rows: [f.operation({ nativeOrderId: f.IDS.other })], hasMore: false },
        { rows: [f.operation({ fundingKind: 'guest_cash' })], hasMore: false }]) {
        const h = fixture({ operations: { data } }); const res = await h.post();
        assert.ok([404, 503].includes(res.status)); assert.equal(h.calls.length, 1);
    }
});
test('both funding paths work and explicit ineligible result remains a confirmed false', async () => {
    const h = fixture({ operations: { data: { rows: [f.operation({ fundingKind: 'guest_cash' })], hasMore: false } },
        result: { data: { applied: false, operationId: f.IDS.operation } } });
    const res = await h.post({ fundingKind: 'guest_cash' }); assert.equal(res.status, 200);
    assert.deepEqual(res.payload, { success: true, applied: false, operationId: f.IDS.operation });
});
test('same operation retry keeps its original UUID and actor, without a new purchase capability', async () => {
    const h = fixture(); await h.post(); await h.post();
    const writes = h.calls.filter(c => c.name === 'fn_shop_supplier_runtime_v2');
    assert.equal(writes.length, 2); assert.deepEqual(writes[0], writes[1]);
});
test('lost/malformed resume ACK and private RPC exceptions are sanitized and left unconfirmed', async () => {
    for (const options of [{ throws: true }, { result: null }, { result: { error: { message: 'private-provider-secret' } } },
        { result: { data: {} } }, { result: { data: { applied: 'yes', operationId: f.IDS.operation } } },
        { result: { data: { applied: true, operationId: f.IDS.other } } }]) {
        const h = fixture(options); const res = await h.post(); assert.equal(res.status, 503);
        assert.doesNotMatch(JSON.stringify(res.payload), /private-provider-secret|credential|card/);
        assert.match(res.payload.message, /尚未确认/);
    }
});
