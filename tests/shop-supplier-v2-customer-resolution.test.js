'use strict';
// Mock RPC/service acceptance only. Financial transactions/concurrency remain NOT RUN.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { resolveCustomer, publicResolution, normalizeRequest } = require('../server/integrations/suppliers/resolution');
const { normalizeOperation } = require('../server/integrations/suppliers/operations');
const { loadCustomerDelivery } = require('../server/integrations/suppliers/delivery');
const { recoverPointsPurchase, operationId } = require('../server/integrations/suppliers/checkout');
const f = require('./helpers/shop-supplier-resolution-fixture');
function database(response = { data: f.result() }) { return { calls: [], async rpc(name, args) {
    this.calls.push({ name, args }); if (response instanceof Error) throw response; return response;
} }; }
function safe(error) { return error.statusCode === 503 && error.code === 'supplier_resolution_unavailable'
    && !/SQL|private|secret|card/.test(error.message); }

test('resolution commit binds native order, actor and funding; trims and fingerprints a reference, returns public allowlist', async () => {
    const db = database({ data: f.result({ amount: '20.10', private: 'secret', resolution: f.resolution({ internalNote: 'private', evidenceRef: 'private' }) }) });
    assert.deepEqual(await resolveCustomer(db, f.input({ request: f.request({ amount: '20.1', evidenceRef: '  support-case-20261019  ' }) })), f.result({ amount: '20.10' }));
    assert.equal(db.calls.length, 1);
    assert.equal(db.calls[0].name, 'fn_shop_supplier_resolve_customer_v2');
    const a = db.calls[0].args;
    assert.equal(a.p_actor_id, f.IDS.actor); assert.equal(a.p_native_order_id, f.IDS.order);
    assert.equal(a.p_operation_id, f.IDS.operation); assert.equal(a.p_funding_kind, 'points');
    assert.equal(a.p_request.amount, '20.10'); assert.equal(a.p_request.evidenceRef, 'support-case-20261019');
    assert.equal(a.p_request.evidenceHash, createHash('sha256').update('support-case-20261019').digest('hex'));
});
test('query needs original identity but no editable financial request and cannot introduce a new operation', async () => {
    const db = database({ data: { status: 'not_found', operationId: f.IDS.operation, secret: 'private' } });
    assert.deepEqual(await resolveCustomer(db, f.input({ action: 'query', request: { secret: 'must not forward' } })),
        { status: 'not_found', operationId: f.IDS.operation });
    assert.deepEqual(db.calls[0].args.p_request, {}); assert.equal(db.calls[0].args.p_action, 'query');
});
for (const patch of [{ orderId: 'bad' }, { actorId: '' }, { operationId: 'bad' }, { site: 'intl' },
    { fundingKind: 'cash' }, { action: 'refund' }, { request: f.request({ kind: 'manual_compensation' }) }]) {
    test(`invalid resolution identity or funding fails before RPC (${Object.keys(patch)[0]})`, async () => {
        const db = database(); await assert.rejects(resolveCustomer(db, f.input(patch)), { code: 'supplier_resolution_invalid_request' });
        assert.equal(db.calls.length, 0);
    });
}
for (const patch of [{ amount: 20 }, { amount: '0' }, { amount: '-1' }, { amount: '1e2' }, { amount: '20.151' },
    { amount: '1000000000000' }, { attested: false }, { publicNote: 'short' }, { internalNote: 'short' },
    { evidenceRef: 'short' }, { evidenceHash: 'client-controlled' }, { publicNote: 'x'.repeat(501) }]) {
    test(`invalid resolution request is rejected before financial RPC (${Object.keys(patch)[0]}=${String(Object.values(patch)[0]).slice(0, 22)})`, () => {
        assert.throws(() => normalizeRequest({ request: f.request(patch) }), { code: 'supplier_resolution_invalid_request' });
    });
}
test('manual cash compensation is explicitly typed and never becomes a provider refund', async () => {
    const resolution = f.resolution({ status: 'compensated', method: 'manual_compensation' });
    const db = database({ data: f.result({ fundingKind: 'guest_cash', resolution }) });
    assert.equal((await resolveCustomer(db, f.input({ fundingKind: 'guest_cash', request: f.request({ kind: 'manual_compensation' }) }))).resolution.status, 'compensated');
    assert.deepEqual(db.calls.map(c => c.name), ['fn_shop_supplier_resolve_customer_v2']);
});
for (const response of [new Error('private SQL secret'), { error: { message: 'SQL private' } }, { data: [] }, { data: [f.result(), f.result()] },
    { data: f.result({ operationId: f.IDS.other }) }, { data: f.result({ nativeOrderId: f.IDS.other }) },
    { data: f.result({ fundingKind: 'guest_cash' }) }, { data: f.result({ upstreamRisk: 'released' }) },
    { data: f.result({ amount: 20 }) }, { data: f.result({ amount: '20.16' }) }, { data: f.result({ resolution: f.resolution({ method: 'manual_compensation' }) }) }]) {
    test(`unknown or inconsistent commit acknowledgement stays safely unconfirmed (${JSON.stringify(response).slice(0, 90)})`, async () => {
        await assert.rejects(resolveCustomer(database(response), f.input()), safe);
    });
}
test('known financial safety rejection remains a conflict without exposing SQL', async () => {
    await assert.rejects(resolveCustomer(database({ error: { message: 'supplier_resolution_refund_conflict' } }), f.input()),
        { statusCode: 409, code: 'supplier_resolution_refund_conflict' });
});
test('customer projections reject malformed closure and strip all internal fields', () => {
    assert.deepEqual(publicResolution(f.resolution({ internalNote: 'private', sealed: 'private' })), f.resolution());
    for (const patch of [{ status: 'closed' }, { method: 'manual_compensation' }, { message: 'short' }, { resolved_at: 'invalid' }])
        assert.equal(publicResolution(f.resolution(patch)), null);
});
test('operations retain cost and risk and require a consistent closure projection', () => {
    const closed = f.operation({ customerResolution: f.resolution(), resolutionOperationId: f.IDS.operation, canResolve: false });
    const row = normalizeOperation(closed);
    assert.equal(row.customerResolution.message, f.request().publicNote);
    assert.equal(row.exposureStatus, 'held'); assert.equal(row.reservedCostCny, '12.000000'); assert.equal(row.canRefund, false);
    for (const patch of [{ canResolve: true }, { resolutionOperationId: null }, { resolutionAmount: 20 },
        { customerResolution: { status: 'refunded' } }, { fundingKind: 'guest_cash' }]) assert.throws(() => normalizeOperation({ ...closed, ...patch }));
    const historical = f.operation();
    for (const k of ['customerResolution', 'resolutionOperationId', 'resolutionAmount', 'canResolve']) delete historical[k];
    assert.equal(normalizeOperation(historical).canResolve, false); // P2D-1 read compatibility.
    assert.throws(() => normalizeOperation({ ...historical, canResolve: true })); // Partial P2D-2 is unsafe.
});
test('closed customer delivery never decrypts a stored late receipt, even with no encryption keys', async () => {
    const db = database({ data: { status: 'closed', sealed: 'not decryptable', content: 'must not leak' } });
    assert.deepEqual(await loadCustomerDelivery(db, { orderId: f.IDS.order, fundingKind: 'points', userId: f.IDS.actor }, {}),
        { status: 'closed', content: '' });
    assert.equal(db.calls[0].name, 'fn_shop_supplier_customer_delivery_v2');
});
test('points recovery queries original operation independently of intake configuration and exposes no credentials', async () => {
    const db = database({ data: { status: 'confirmed', orderId: f.IDS.order, resolution: f.resolution({ evidenceRef: 'private' }), secret: 'private' } });
    const key = 'original-purchase-operation-20261019';
    assert.deepEqual(await recoverPointsPurchase(db, { userId: f.IDS.actor, site: 'cn', idempotencyKey: key }),
        { status: 'confirmed', orderId: f.IDS.order, resolution: f.resolution() });
    assert.deepEqual(db.calls, [{ name: 'fn_shop_supplier_recover_points_v2', args: {
        p_operation_id: operationId('points', f.IDS.actor, key), p_buyer_user_id: f.IDS.actor, p_site: 'cn' } }]);
    assert.deepEqual(await recoverPointsPurchase(database({ data: { status: 'unconfirmed' } }),
        { userId: f.IDS.actor, site: 'cn', idempotencyKey: key }), { status: 'unconfirmed' });
});
