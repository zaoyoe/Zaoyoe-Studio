'use strict';
const IDS = {
    order: '11111111-1111-4111-8111-111111111111', actor: '22222222-2222-4222-8222-222222222222',
    operation: '33333333-3333-4333-8333-333333333333', intent: '44444444-4444-4444-8444-444444444444',
    request: '55555555-5555-4555-8555-555555555555', other: '66666666-6666-4666-8666-666666666666'
};
function request(patch = {}) { return { kind: 'points_refund', publicNote: '原积分已按原付款明细退回，请查收。',
    internalNote: '核对原始积分明细并登记客服处理依据。', evidenceRef: 'support-case-resolution-20261019', amount: '20.15', attested: true, ...patch }; }
function resolution(patch = {}) { return { status: 'refunded', method: 'points_refund', message: request().publicNote,
    resolved_at: '2026-10-19T10:00:00.000Z', ...patch }; }
function input(patch = {}) { return { action: 'commit', operationId: IDS.operation, actorId: IDS.actor,
    orderId: IDS.order, fundingKind: 'points', site: 'cn', request: request(), ...patch }; }
function result(patch = {}) { return { status: 'completed', operationId: IDS.operation, nativeOrderId: IDS.order,
    fundingKind: 'points', amount: '20.15', resolution: resolution(), upstreamRisk: 'retained', ...patch }; }
function operation(patch = {}) { return { intentId: IDS.intent, nativeOrderId: IDS.order, orderNo: IDS.order, fundingKind: 'points',
    site: 'cn', productName: '测试供应商商品', procurementState: 'outcome_unknown', originalRequestId: IDS.request,
    supplierOrderNo: null, deliveryState: 'awaiting_acceptance', actualCostCny: null, costVerified: false,
    exposureStatus: 'held', reservedCostCny: '12.000000', quarantineReason: null, canRefund: false,
    customerResolution: null, resolutionOperationId: null, resolutionAmount: '20.15', canResolve: true,
    createdAt: '2026-10-19T09:00:00Z', deliveredAt: null, ...patch }; }
function memoryStorage() { const rows = new Map(); return { rows, getItem: key => rows.get(key) ?? null,
    setItem: (key, value) => rows.set(key, value), removeItem: key => rows.delete(key) }; }
module.exports = { IDS, request, resolution, input, result, operation, memoryStorage };
