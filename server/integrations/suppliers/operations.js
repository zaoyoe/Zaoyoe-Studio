'use strict';
const { publicResolution } = require('./resolution');
const { normalizeRuntime } = require('./runtime-status');

// A bounded, nonsecret database projection. No adapter/credential resolution or
// merchant request belongs in administrator reads of historical procurements.
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const MONEY = /^\d{1,12}(?:\.\d{1,6})?$/;
const STATES = new Set(['not_submitted', 'prepared', 'dispatching', 'outcome_unknown', 'accepted', 'rejected', 'review']);
const DELIVERY = new Set(['awaiting_acceptance', 'awaiting_delivery', 'delivered', 'quarantined']);
const REASONS = new Set(['native_not_deliverable', 'cost_above_ceiling', 'duplicate_content']);
function unavailable() {
    return Object.assign(new Error('采购与交付记录暂不可用，请稍后重试'), { code: 'supplier_operations_unavailable', statusCode: 503 });
}
function text(value, max) { return typeof value === 'string' ? value.slice(0, max) : ''; }
function normalizeOperation(row) {
    const resolution = publicResolution(row?.customerResolution);
    const hasResolutionFields = ['customerResolution', 'resolutionOperationId', 'resolutionAmount', 'canResolve'].some(key => Object.hasOwn(row || {}, key));
    if (hasResolutionFields && (typeof row.canResolve !== 'boolean'
        || typeof row.resolutionAmount !== 'string' || !/^\d{1,12}(?:\.\d{1,2})?$/.test(row.resolutionAmount)
        || (row.customerResolution !== null && !resolution)
        || (resolution ? (!UUID.test(row.resolutionOperationId || '') || row.canResolve
            || row.deliveryState === 'delivered' || resolution.method !== (row.fundingKind === 'points' ? 'points_refund' : 'manual_compensation'))
            : row.resolutionOperationId !== null)
        || (row.canResolve && (row.deliveryState === 'delivered' || Number(row.resolutionAmount) <= 0)))) throw unavailable();
    if (!row || !UUID.test(row.intentId || '') || !UUID.test(row.nativeOrderId || '')
        || !UUID.test(row.originalRequestId || '') || !['points', 'guest_cash'].includes(row.fundingKind)
        || row.site !== 'cn' || !STATES.has(row.procurementState) || !DELIVERY.has(row.deliveryState)
        || !['held', 'not_reserved'].includes(row.exposureStatus) || !MONEY.test(row.reservedCostCny || '')
        || (row.actualCostCny !== null && (typeof row.actualCostCny !== 'string' || !MONEY.test(row.actualCostCny)))
        || typeof row.costVerified !== 'boolean' || row.costVerified !== (row.actualCostCny !== null)
        || (['delivered', 'quarantined'].includes(row.deliveryState) !== row.costVerified)
        || (row.costVerified && row.procurementState !== 'accepted')
        || (row.deliveryState === 'delivered' && (row.exposureStatus !== 'not_reserved'
            || !/^0+(?:\.0+)?$/.test(row.reservedCostCny)))
        || (row.deliveryState === 'quarantined' ? !REASONS.has(row.quarantineReason) : row.quarantineReason !== null)) {
        throw unavailable();
    }
    let runtime;
    if (Object.hasOwn(row, 'runtime')) {
        try { runtime = normalizeRuntime(row.runtime); } catch { throw unavailable(); }
    }
    return {
        intentId: row.intentId, nativeOrderId: row.nativeOrderId, originalRequestId: row.originalRequestId,
        orderNo: text(row.orderNo, 160), fundingKind: row.fundingKind, site: row.site,
        productName: text(row.productName, 255), procurementState: row.procurementState,
        supplierOrderNo: text(row.supplierOrderNo, 160) || null, deliveryState: row.deliveryState,
        actualCostCny: row.actualCostCny, costVerified: row.costVerified === true,
        exposureStatus: row.exposureStatus, reservedCostCny: row.reservedCostCny,
        quarantineReason: row.quarantineReason, canRefund: false,
        customerResolution: resolution,
        resolutionOperationId: UUID.test(row.resolutionOperationId || '') ? row.resolutionOperationId : null,
        resolutionAmount: /^\d{1,12}(?:\.\d{1,2})?$/.test(row.resolutionAmount || '') ? row.resolutionAmount : null,
        canResolve: row.canResolve === true && !row.customerResolution && row.deliveryState !== 'delivered',
        createdAt: text(row.createdAt, 80), deliveredAt: text(row.deliveredAt, 80) || null,
        ...(Object.hasOwn(row, 'runtime') ? { runtime } : {})
    };
}
async function loadOperations(db, { providerId = null, accountKey = null, limit = 50,
    orderId = null, fundingKind = null, site = 'cn' } = {}) {
    if (site !== 'cn' || !Number.isInteger(limit) || limit < 1 || limit > 100
        || (providerId !== null && !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(providerId))
        || (accountKey !== null && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(accountKey))
        || (orderId !== null && !UUID.test(orderId))
        || (fundingKind !== null && !['points', 'guest_cash'].includes(fundingKind))
        || (orderId !== null && fundingKind === null)) {
        throw Object.assign(new Error('采购查询条件无效'), { code: 'supplier_operations_invalid_request', statusCode: 400 });
    }
    let response;
    try { response = await db.rpc('fn_shop_supplier_operations_v2', {
        p_provider_id: providerId, p_account_key: accountKey, p_limit: limit,
        p_native_order_id: orderId, p_funding_kind: fundingKind, p_site: site
    }); } catch { throw unavailable(); }
    if (response?.error) throw unavailable();
    const data = response?.data;
    if (!data || !Array.isArray(data.rows) || data.rows.length > limit || typeof data.hasMore !== 'boolean') throw unavailable();
    const rows = data.rows.map(normalizeOperation);
    if (rows.some((row) => (orderId && row.nativeOrderId !== orderId) || (fundingKind && row.fundingKind !== fundingKind))) throw unavailable();
    return { rows, hasMore: data.hasMore, limit };
}
async function loadOrderOperations(db, order) {
    if (order?.fulfillment_source !== 'supplier_v2') return null;
    const result = await loadOperations(db, { orderId: order.id, fundingKind: 'points', site: order.site, limit: 1 });
    if (result.rows.length !== 1 || result.hasMore) throw unavailable();
    return result.rows[0];
}
module.exports = { loadOperations, loadOrderOperations, normalizeOperation };
