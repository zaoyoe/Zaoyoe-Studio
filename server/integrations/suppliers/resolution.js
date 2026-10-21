'use strict';

const { createHash } = require('node:crypto');
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const AMOUNT = /^\d{1,12}(?:\.\d{1,2})?$/;
function failure(code = 'supplier_resolution_unavailable', statusCode = 503) {
    const messages = {
        supplier_resolution_invalid_request: '请填写完整的公开说明、内部备注和凭据引用，并确认处理金额',
        supplier_resolution_idempotency_conflict: '操作号对应的信息不一致，请查询原操作结果',
        supplier_resolution_already_completed: '该订单已完结，请刷新订单查看原处理结果',
        supplier_resolution_already_delivered: '该订单已经交付，不能使用未交付结案流程',
        supplier_resolution_not_applicable: '当前付款或供货状态不能执行此处理，请先核对订单',
        supplier_resolution_not_funded: '尚未确认原订单资金，不能登记退款或补偿',
        supplier_resolution_points_breakdown_required: '原订单的付费与赠送积分明细不完整，需要先核对账目',
        supplier_resolution_refund_conflict: '已存在退款账目，请先核对原退款结果',
        supplier_resolution_order_missing: '未找到此站点的供应商订单'
    };
    return Object.assign(new Error(messages[code] || '尚未确认处理结果，请查询本次操作；保持原操作号和处理内容'), { code, statusCode });
}
// Shared allowlist for customer projections. No evidence, account or internal
// notes are ever taken from this object, even if the DB adds fields later.
function publicResolution(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || !['refunded', 'compensated'].includes(value.status)
        || value.method !== (value.status === 'refunded' ? 'points_refund' : 'manual_compensation')
        || typeof value.message !== 'string' || value.message.trim().length < 8 || value.message.length > 500
        || typeof value.resolved_at !== 'string' || !Number.isFinite(Date.parse(value.resolved_at))) return null;
    return { status: value.status, method: value.method, message: value.message, resolved_at: value.resolved_at };
}
function identity(input) {
    if (!UUID.test(input.orderId || '') || !UUID.test(input.operationId || '') || !UUID.test(input.actorId || '')
        || !['points', 'guest_cash'].includes(input.fundingKind) || input.site !== 'cn') throw failure('supplier_resolution_invalid_request', 400);
    return { p_operation_id: input.operationId, p_actor_id: input.actorId,
        p_native_order_id: input.orderId, p_funding_kind: input.fundingKind };
}
function normalizeRequest(body) {
    const request = body?.request;
    if (!request || typeof request !== 'object' || Array.isArray(request)
        || Object.keys(request).some(key => !['kind','publicNote','internalNote','evidenceRef','amount','attested'].includes(key))
        || !['points_refund', 'manual_compensation'].includes(request.kind) || request.attested !== true
        || typeof request.amount !== 'string' || !AMOUNT.test(request.amount) || Number(request.amount) <= 0) throw failure('supplier_resolution_invalid_request', 400);
    for (const [key, max] of [['publicNote', 500], ['internalNote', 1000], ['evidenceRef', 500]]) {
        if (typeof request[key] !== 'string' || request[key].trim().length < 8 || request[key].length > max) throw failure('supplier_resolution_invalid_request', 400);
    }
    const normalized = { kind: request.kind, publicNote: request.publicNote.trim(), internalNote: request.internalNote.trim(),
        evidenceRef: request.evidenceRef.trim(), amount: Number(request.amount).toFixed(2), attested: true };
    return { ...normalized, evidenceHash: createHash('sha256').update(normalized.evidenceRef).digest('hex') };
}
function normalizeResult(row, input) {
    if (row?.operationId !== input.operationId) throw failure();
    if (row.status === 'not_found') return { status: 'not_found', operationId: row.operationId };
    const resolution = publicResolution(row.resolution);
    if (row.status !== 'completed' || !resolution || row.nativeOrderId !== input.orderId || row.fundingKind !== input.fundingKind
        || typeof row.amount !== 'string' || !AMOUNT.test(row.amount) || Number(row.amount) <= 0
        || (input.action === 'commit' && Number(row.amount) !== Number(input.request.amount))
        || resolution.method !== (input.fundingKind === 'points' ? 'points_refund' : 'manual_compensation')
        || row.upstreamRisk !== 'retained') throw failure();
    return { status: 'completed', operationId: row.operationId, nativeOrderId: row.nativeOrderId, fundingKind: row.fundingKind,
        amount: row.amount, resolution, upstreamRisk: 'retained' };
}
async function resolveCustomer(db, input) {
    const args = identity(input);
    if (!['query', 'commit'].includes(input.action)) throw failure('supplier_resolution_invalid_request', 400);
    const request = input.action === 'commit' ? normalizeRequest(input) : {};
    if (input.action === 'commit' && request.kind !== (input.fundingKind === 'points' ? 'points_refund' : 'manual_compensation')) throw failure('supplier_resolution_invalid_request', 400);
    let response;
    try { response = await db.rpc('fn_shop_supplier_resolve_customer_v2', { ...args, p_action: input.action, p_request: request }); }
    catch { throw failure(); }
    if (response?.error) {
        const code = String(response.error.message || '');
        if (/^supplier_resolution_(invalid_request|idempotency_conflict|already_completed|already_delivered|not_applicable|not_funded|points_breakdown_required|refund_conflict|order_missing)$/.test(code)) throw failure(code, 409);
        throw failure();
    }
    if (Array.isArray(response?.data) && response.data.length !== 1) throw failure();
    return normalizeResult(Array.isArray(response?.data) ? response.data[0] : response?.data, input);
}
module.exports = { publicResolution, resolveCustomer, normalizeRequest, normalizeResult };
