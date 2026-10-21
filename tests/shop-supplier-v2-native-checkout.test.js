'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const checkout = require('../server/integrations/suppliers/checkout');
const { supplierOrderStatus } = require('../server/integrations/suppliers/order-status');
const { createGuestShopWorker } = require('../server/guest-shop-worker');
const { buildOrderProfitAttribution } = require('../server/api-handlers/admin/shop/_profit');
const { syncOrderProfitLedger } = require('../server/api-handlers/admin/shop/_profit-ledger');
const productId = '11111111-1111-4111-8111-111111111111';
const skuId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const quoteId = '44444444-4444-4444-8444-444444444444';
const key = 'native-checkout-operation-1';
const claim = 'hmac-sha256:v1:' + 'a'.repeat(64);
function dbMock(results) {
    const calls = [];
    return { calls, async rpc(name, params) {
        calls.push({ name, params });
        const result = results.shift();
        assert.ok(result, `Unexpected RPC ${name}`);
        if (result instanceof Error) throw result;
        return result;
    } };
}
const source = { productId, skuId };
const payload = { productId, productSkuId: skuId, site: 'cn', quantity: 1, idempotencyKey: key };
const params = { p_site: 'cn', p_product_id: productId, p_sku_id: skuId, p_quantity: 1,
    p_idempotency_key: key, p_request_fingerprint: 'b'.repeat(64), p_claim_secret_hash: claim,
    p_provider: 'alipay', p_channel: 'alipay', p_ttl_seconds: 1800 };

test('default-off checkout performs no RPC, including on an old database', async () => {
    const db = dbMock([]);
    assert.equal(await checkout.resolveSupplierSource(db, payload, {}), null);
    assert.equal(await checkout.resolveSupplierSource(db, payload, { SHOP_SUPPLIER_CHECKOUT_V2_ENABLED: 'false' }), null);
    assert.equal(db.calls.length, 0);
});
test('trusted source lookup passes only native identity and resolves default SKU', async () => {
    const db = dbMock([{ data: { is_supplier: true, sku_id: skuId } }]);
    assert.deepEqual(await checkout.resolveSupplierSource(db, { productId, site: 'cn', cost: 0, account: 'client' },
        { SHOP_SUPPLIER_CHECKOUT_V2_ENABLED: 'true' }), source);
    assert.deepEqual(db.calls[0].params, { p_product_id: productId, p_sku_id: null, p_site: 'cn' });
});
test('unmapped products stay on native local checkout; mapped international products fail closed', async () => {
    assert.equal(await checkout.resolveSupplierSource(dbMock([{ data: { is_supplier: false } }]), payload,
        { SHOP_SUPPLIER_CHECKOUT_V2_ENABLED: 'true' }), null);
    await assert.rejects(checkout.resolveSupplierSource(dbMock([{ data: { is_supplier: true, sku_id: skuId } }]),
        { ...payload, site: 'intl' }, { SHOP_SUPPLIER_CHECKOUT_V2_ENABLED: 'true' }),
    { code: 'supplier_checkout_scope_unsupported' });
});
test('operation keys are stable and isolated by funding type and owner', () => {
    const operation = checkout.operationId('points', userId, key);
    assert.match(operation, /^[a-f0-9-]{36}$/);
    assert.equal(operation, checkout.operationId('points', userId, ' ' + key + ' '));
    assert.notEqual(operation, checkout.operationId('guest_cash', userId, key));
    assert.notEqual(operation, checkout.operationId('points', productId, key));
    assert.throws(() => checkout.operationId('points', userId, 'short'), { code: 'supplier_operation_required' });
});
test('points checkout freezes price only in DB and returns exact consumed replay', async () => {
    const replay = { success: true, data: { order_id: productId, fulfillment_source: 'supplier_v2', delivery_status: 'pending' } };
    const db = dbMock([{ data: { quote_id: quoteId, status: 'consumed' } }, { data: replay }]);
    assert.deepEqual(await checkout.purchaseWithPoints(db, { source, payload: { ...payload, price: 0, mappingId: 'untrusted' }, userId }), replay);
    assert.deepEqual(db.calls[0].params, { p_operation_id: checkout.operationId('points', userId, key),
        p_funding_kind: 'points', p_buyer_user_id: userId, p_guest_owner_hash: null,
        p_product_id: productId, p_sku_id: skuId, p_native_request_fingerprint: null });
    assert.deepEqual(db.calls[1], { name: 'fn_purchase_shop_supplier_points_v2', params: { p_quote_id: quoteId, p_buyer_user_id: userId } });
});
for (const unsupported of [{ quantity: 2 }, { site: 'intl' }, { discountCode: 'CODE' },
    { discountAssetId: productId }, { discountSelections: [{ code: 'CODE' }] }, { agentId: userId }]) {
    test(`unsupported supplier scope fails before money/order RPC: ${JSON.stringify(unsupported)}`, async () => {
        const db = dbMock([]);
        await assert.rejects(checkout.purchaseWithPoints(db, { source, payload: { ...payload, ...unsupported }, userId }),
            { code: 'supplier_checkout_scope_unsupported' });
        assert.equal(db.calls.length, 0);
    });
}
test('guest quote owner includes the real versioned claim hash and stays stable as price fingerprint changes', async () => {
    const expected = crypto.createHash('sha256').update(claim).digest('hex');
    assert.equal(checkout.guestOwner(claim), expected);
    assert.throws(() => checkout.guestOwner('a'.repeat(64)), { code: 'supplier_operation_required' });
    const db = dbMock([{ data: { quote_id: quoteId } }, { data: { order_id: productId } },
        { data: { quote_id: quoteId } }, { error: { message: 'supplier_idempotency_conflict' } }]);
    await checkout.createGuestOrder(db, { source, params });
    await assert.rejects(checkout.createGuestOrder(db, { source, params: { ...params, p_request_fingerprint: 'c'.repeat(64) } }),
        { code: 'supplier_idempotency_conflict' });
    assert.equal(db.calls[0].params.p_operation_id, db.calls[2].params.p_operation_id);
    assert.equal(db.calls[0].params.p_guest_owner_hash, expected);
    assert.deepEqual(db.calls[1].params, { ...params, p_quote_id: quoteId });
});
test('quote expiry and ambiguous RPC failures never fall back to a new native debit', async () => {
    for (const message of ['supplier_quote_expired', 'supplier_quote_changed', 'supplier_idempotency_conflict', 'secret app_key SQL DETAIL']) {
        const db = dbMock([{ error: { message, details: 'private credential' } }]);
        const error = await checkout.purchaseWithPoints(db, { source, payload, userId }).catch(e => e);
        assert.equal(error.expose, true);
        assert.equal(db.calls.length, 1);
        assert.doesNotMatch(error.message, /secret|app_key|SQL|DETAIL|private/);
    }
});
test('public supplier projection includes progress only and preserves local response shape', () => {
    assert.deepEqual(supplierOrderStatus({ fulfillment_source: 'local', delivery_status: 'delivered' }), {});
    const result = supplierOrderStatus({ fulfillment_source: 'supplier_v2', delivery_status: 'pending',
        account_id: 'private', cost_ceiling_cny: 99, app_key: 'secret', mapping_id: 'private' });
    assert.equal(result.supplier_status, 'pending');
    assert.match(result.fulfillment_message, /等待供货/);
    assert.deepEqual(Object.keys(result).sort(), ['delivery_status', 'fulfillment_message', 'fulfillment_source', 'supplier_status']);
    assert.equal(supplierOrderStatus({ fulfillment_source: 'supplier_v2', payment_status: 'pending' }).supplier_status, 'awaiting_payment');
    assert.equal(supplierOrderStatus({ fulfillment_source: 'supplier_v2', payment_status: 'confirmed', fulfillment_status: 'paid_unfulfillable' }).supplier_status, 'review');
});
for (const state of [{ payment_status: 'confirmed', fulfillment_status: 'pending' },
    { payment_status: 'confirmed', refund_status: 'pending', fulfillment_status: 'paid_unfulfillable' }]) {
    test(`stock worker cannot lease, fulfill or refund external procurement (${state.fulfillment_status})`, async () => {
        const noIo = () => assert.fail('Supplier order reached stock/refund side effect');
        const worker = createGuestShopWorker({ supabase: { from: noIo, rpc: noIo }, paymentAdapter: { refund: noIo } });
        const order = { id: productId, fulfillment_source: 'supplier_v2', ...state };
        for (const method of ['processOrder', 'processFulfillment', 'processRefund']) {
            assert.deepEqual(await worker[method](order), { status: 'skipped', reason: 'supplier_executor_not_enabled' });
        }
    });
}
test('by-id immediate fulfillment reads the source before any lease or provider request', async () => {
    const calls = [];
    const query = { select(value) { assert.match(value, /fulfillment_source/); return this; },
        eq() { return this; }, maybeSingle() { return Promise.resolve({ data: { id: productId, fulfillment_source: 'supplier_v2' } }); } };
    const worker = createGuestShopWorker({ supabase: { from(table) { calls.push(table); return query; },
        rpc() { assert.fail('Unexpected stock RPC'); } } });
    assert.equal((await worker.processOrderById(productId)).reason, 'supplier_executor_not_enabled');
    assert.deepEqual(calls, ['guest_shop_orders']);
});
test('worker excludes supplier candidates before its row limit so local orders cannot be starved', async () => {
    const supplier = { id: productId, fulfillment_source: 'supplier_v2', updated_at: '2026-10-19T00:00:00Z' };
    const local = { id: skuId, fulfillment_source: 'local', updated_at: '2026-10-19T00:00:01Z' };
    const scans = [];
    const worker = createGuestShopWorker({ supabase: {
        rpc() { assert.fail('Candidate scan must not mutate orders'); },
        from(table) {
            assert.equal(table, 'guest_shop_orders');
            let rows = [supplier, local];
            const calls = [];
            scans.push(calls);
            const query = {
                select(fields) { assert.match(fields, /fulfillment_source/); return this; },
                neq(field, value) { calls.push('exclude-source'); rows = rows.filter(row => row[field] !== value); return this; },
                eq() { return this; }, in() { return this; }, order() { return this; },
                limit(value) { calls.push('limit'); rows = rows.slice(0, value); return this; },
                then(resolve, reject) { return Promise.resolve({ data: rows }).then(resolve, reject); }
            };
            return query;
        }
    } });
    assert.deepEqual(await worker.loadCandidates(1), [local]);
    assert.equal(scans.length, 2);
    for (const calls of scans) assert.deepEqual(calls, ['exclude-source', 'limit']);
});
test('unknown external purchase cost stays unknown and never creates zero-cost profit entries', async () => {
    const order = { id: productId, fulfillment_source: 'supplier_v2', price_paid: 100, item_count: 1,
        paid_points_spent: 80, bonus_points_spent: 20 };
    const result = buildOrderProfitAttribution(order, []);
    for (const field of ['purchase_cost_cny', 'recognized_cost_cny', 'net_profit_cny', 'margin_rate']) assert.equal(result[field], null, field);
    assert.equal(result.cost_coverage, 'supplier_pending');
    assert.equal(result.profit_ledger_status, 'incomplete');
    assert.deepEqual(result.profit_ledger_entries, []);
    const ledger = await syncOrderProfitLedger({ from() { assert.fail('Must not write invented profit'); } }, order,
        { profit_ledger_entries: [{ amount: 100 }] });
    assert.equal(ledger.synced, false);
    assert.equal(ledger.status, 'incomplete');
});

for (const [state, expected] of [
    [{ payment_status: 'created' }, 'awaiting_payment'],
    [{ payment_status: 'expired' }, 'expired'],
    [{ payment_status: 'failed' }, 'failed'],
    [{ status: 'cancelled' }, 'closed'],
    [{ payment_status: 'partial' }, 'review'],
    [{ payment_status: 'overpaid' }, 'review'],
    [{ payment_status: 'amount_mismatch' }, 'review'],
    [{ payment_status: 'chargeback' }, 'review'],
    [{ payment_status: 'review' }, 'review'],
    [{ payment_status: 'unrecognized' }, 'review'],
    [{ refund_status: 'pending', fulfillment_status: 'paid_unfulfillable' }, 'refunding'],
    [{ refund_status: 'manual_review' }, 'review'],
    [{ refund_status: 'succeeded', fulfillment_status: 'delivered' }, 'refunded'],
    [{ status: 'full_refund' }, 'refunded'],
    [{ status: 'partial_refund', refund_status: 'succeeded' }, 'partially_refunded'],
    [{ payment_status: 'refunded' }, 'refunded'],
    [{ payment_status: 'confirmed', fulfillment_status: 'delivered' }, 'delivered']
]) {
    test(`supplier progress honours native terminal/payment/refund state ${JSON.stringify(state)}`, () => {
        const result = supplierOrderStatus({ fulfillment_source: 'supplier_v2', ...state });
        assert.equal(result.supplier_status, expected);
        if (['expired', 'failed', 'closed', 'review', 'refunding', 'refunded', 'partially_refunded'].includes(expected)) {
            assert.doesNotMatch(result.fulfillment_message, /等待付款确认|等待供货/);
        }
    });
}
