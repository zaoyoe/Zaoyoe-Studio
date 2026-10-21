'use strict';
// Fake database projections only; no database/merchant acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadOperations, loadOrderOperations, normalizeOperation } = require('../server/integrations/suppliers/operations');
const { buildOrderProfitAttribution } = require('../server/api-handlers/admin/shop/_profit');
const INTENT = '11111111-1111-4111-8111-111111111111';
const ORDER = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';
function operation(overrides = {}) { return {
    intentId: INTENT, nativeOrderId: ORDER, originalRequestId: REQUEST, orderNo: 'SUPPLIER-1',
    fundingKind: 'points', site: 'cn', productName: '采购测试商品', procurementState: 'accepted',
    supplierOrderNo: 'ORIGINAL-1', deliveryState: 'delivered', actualCostCny: '12.340000', costVerified: true,
    exposureStatus: 'not_reserved', reservedCostCny: '0.000000', quarantineReason: null,
    createdAt: '2026-10-19T01:00:00Z', deliveredAt: '2026-10-19T02:00:00Z', ...overrides
}; }
function database(result = { data: { rows: [operation()], hasMore: false } }) {
    const calls = [];
    return { calls, async rpc(name, args) { calls.push({ name, args }); if (result instanceof Error) throw result; return result; } };
}
function safeError(error) {
    assert.equal(error.statusCode, 503);
    assert.doesNotMatch(JSON.stringify(error) + error.message, /secret-key|claim-token|card-content/);
    return true;
}
test('operations reads are bounded, account scoped, nonsecret, and preserve exact decimal strings', async () => {
    const db = database({ data: { rows: [operation({ actualCostCny: '0.000000', credential_ref: 'secret-key',
        content: 'card-content', claimToken: 'claim-token', sealedContent: { secret: 'secret-key' }, canRefund: true })], hasMore: true } });
    const result = await loadOperations(db, { providerId: 'xiareng', accountKey: 'disabled-account', site: 'cn', limit: 1 });
    assert.deepEqual(db.calls, [{ name: 'fn_shop_supplier_operations_v2', args: {
        p_provider_id: 'xiareng', p_account_key: 'disabled-account', p_limit: 1,
        p_native_order_id: null, p_funding_kind: null, p_site: 'cn'
    } }]);
    assert.equal(result.rows[0].actualCostCny, '0.000000');
    assert.equal(result.hasMore, true);
    assert.equal(result.rows[0].canRefund, false);
    assert.doesNotMatch(JSON.stringify(result), /secret-key|claim-token|card-content|sealedContent|credential_ref/);
});
test('order operations skip local stock and bind a supplier projection to the exact native order and funding', async () => {
    const db = database();
    assert.equal(await loadOrderOperations(db, { id: ORDER, fulfillment_source: 'local_inventory' }), null);
    assert.equal(db.calls.length, 0);
    assert.equal((await loadOrderOperations(db, { id: ORDER, site: 'cn', fulfillment_source: 'supplier_v2' })).nativeOrderId, ORDER);
    assert.equal(db.calls[0].args.p_funding_kind, 'points');
    assert.equal(db.calls[0].args.p_native_order_id, ORDER);
    assert.equal(db.calls[0].args.p_limit, 1);
    for (const data of [
        { rows: [], hasMore: false },
        { rows: [operation()], hasMore: true },
        { rows: [operation({ nativeOrderId: INTENT })], hasMore: false },
        { rows: [operation({ fundingKind: 'guest_cash' })], hasMore: false }
    ]) await assert.rejects(loadOrderOperations(database({ data }), { id: ORDER, site: 'cn', fulfillment_source: 'supplier_v2' }), safeError);
});
test('invalid operations filters fail before any private RPC', async () => {
    const db = database();
    for (const options of [{ site: 'intl' }, { limit: 0 }, { limit: 101 }, { limit: 1.5 },
        { providerId: '../xiareng' }, { accountKey: 'invalid key' }, { orderId: ORDER },
        { orderId: 'bad', fundingKind: 'points' }, { fundingKind: 'cash' }]) {
        await assert.rejects(loadOperations(db, options), { code: 'supplier_operations_invalid_request', statusCode: 400 });
    }
    assert.equal(db.calls.length, 0);
});
test('malformed database results and errors fail closed with a safe message', async () => {
    for (const result of [new Error('secret-key'), { error: { message: 'card-content' } }, {},
        { data: { rows: 'not-an-array', hasMore: false } }, { data: { rows: [], hasMore: 'no' } },
        { data: { rows: [operation(), operation()], hasMore: false } }]) {
        await assert.rejects(loadOperations(database(result), { limit: 1 }), safeError);
    }
});
test('operations reject inconsistent delivery, exact cost, quarantine and reservation projections', () => {
    for (const patch of [
        { intentId: 'invalid' }, { site: 'intl' }, { actualCostCny: 12.34 }, { actualCostCny: null },
        { actualCostCny: '-1' }, { actualCostCny: '1e2' }, { actualCostCny: '0.1234567' },
        { costVerified: 'true' }, { costVerified: false }, { deliveryState: 'awaiting_delivery' },
        { procurementState: 'prepared' }, { exposureStatus: 'held' }, { reservedCostCny: '1' },
        { quarantineReason: 'duplicate_content' }, { deliveryState: 'quarantined', quarantineReason: 'untrusted' }
    ]) assert.throws(() => normalizeOperation(operation(patch)), safeError);
    const pending = normalizeOperation(operation({ deliveryState: 'awaiting_delivery', costVerified: false, actualCostCny: null,
        exposureStatus: 'held', reservedCostCny: '20', deliveredAt: null }));
    assert.equal(pending.actualCostCny, null);
    const quarantined = normalizeOperation(operation({ deliveryState: 'quarantined', quarantineReason: 'duplicate_content',
        exposureStatus: 'held', reservedCostCny: '20' }));
    assert.equal(quarantined.actualCostCny, '12.340000');
    assert.equal(quarantined.canRefund, false);
});
const nativeOrder = { id: ORDER, site: 'cn', fulfillment_source: 'supplier_v2', delivery_status: 'delivered',
    total_price: 20, price_paid: 20, paid_points_spent: 15, bonus_points_spent: 5 };
test('verified supplier debit does not become a fabricated profit ledger or net profit', () => {
    const result = buildOrderProfitAttribution(nativeOrder, [], { supplierSettlement: operation() });
    assert.equal(result.supplier_actual_debit_cny, '12.340000');
    assert.equal(result.purchase_cost_cny, 12.34);
    assert.equal(result.recognized_revenue_cny, 15);
    assert.equal(result.net_profit_cny, null);
    assert.equal(result.recognized_cost_cny, null);
    assert.equal(result.margin_rate, null);
    assert.equal(result.profit_ledger_status, 'incomplete');
    assert.deepEqual(result.profit_ledger_entries, []);
    assert.equal(result.cost_coverage, 'supplier_verified');
});
test('pending, quarantined and mismatched native projections cannot recognize supplier revenue', () => {
    const pending = buildOrderProfitAttribution({ ...nativeOrder, delivery_status: 'pending' }, [], { supplierSettlement: operation() });
    assert.equal(pending.recognized_revenue_cny, null);
    const quarantined = buildOrderProfitAttribution(nativeOrder, [], { supplierSettlement: operation({ deliveryState: 'quarantined' }) });
    assert.equal(quarantined.recognized_revenue_cny, null);
    assert.equal(quarantined.supplier_actual_debit_cny, '12.340000');
    for (const settlement of [null, operation({ nativeOrderId: INTENT }), operation({ site: 'intl' }),
        operation({ fundingKind: 'guest_cash' }), operation({ costVerified: false }), operation({ actualCostCny: 12.34 })]) {
        const result = buildOrderProfitAttribution(nativeOrder, [{ purchase_unit_cost_cny: 1 }], { supplierSettlement: settlement });
        assert.equal(result.purchase_cost_cny, null);
        assert.equal(result.recognized_revenue_cny, null);
        assert.equal(result.net_profit_cny, null);
        assert.equal(result.cost_coverage, 'supplier_pending');
    }
});
test('verified zero debit remains a concrete zero and local attribution ignores supplier metadata', () => {
    const free = buildOrderProfitAttribution(nativeOrder, [], { supplierSettlement: operation({ actualCostCny: '0.000000' }) });
    assert.equal(free.purchase_cost_cny, 0);
    assert.equal(free.supplier_actual_debit_cny, '0.000000');
    const local = { ...nativeOrder, fulfillment_source: 'local_inventory' };
    assert.deepEqual(buildOrderProfitAttribution(local, [], { supplierSettlement: operation() }), buildOrderProfitAttribution(local, []));
});
