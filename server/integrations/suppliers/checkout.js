'use strict';

const crypto = require('node:crypto');

// This module never calls a supplier or a payment provider. A server-owned DB
// quote authorizes one native checkout; the procurement outbox remains blocked.
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
function checkoutError(code = 'supplier_checkout_unavailable', statusCode = 503) {
    const messages = {
        supplier_checkout_unavailable: '供应商商品暂未开放购买，请稍后重试',
        supplier_checkout_scope_unsupported: '该供应商商品暂仅支持国内站单件原价购买',
        supplier_operation_required: '请刷新购买页面后重试',
        supplier_quote_expired: '订单报价已过期，请重新核对商品与金额',
        supplier_quote_changed: '商品配置或价格已更新，请重新核对订单',
        supplier_idempotency_conflict: '本次购买信息已变更，请核对原订单',
        supplier_checkout_rejected: '当前无法完成此笔购买，请检查余额和商品状态后重试'
    };
    return Object.assign(new Error(messages[code] || messages.supplier_checkout_unavailable), {
        code, statusCode, expose: true
    });
}
function publicCheckoutError(error) {
    const code = String(error?.message || error?.code || '').trim();
    if (['supplier_quote_expired', 'supplier_quote_changed', 'supplier_idempotency_conflict',
        'supplier_checkout_rejected', 'supplier_checkout_scope_unsupported'].includes(code)) return checkoutError(code, 409);
    // Never echo SQL DETAIL, credentials, upstream payloads or raw RPC errors.
    return checkoutError();
}
function operationId(kind, owner, key) {
    if (typeof key !== 'string' || key.trim().length < 16 || key.trim().length > 200) {
        throw checkoutError('supplier_operation_required', 400);
    }
    const hex = crypto.createHash('sha256').update(JSON.stringify([
        'shop-supplier-checkout-v2', kind, owner, key.trim()
    ])).digest('hex').slice(0, 32).split('');
    hex[12] = '4'; hex[16] = '8';
    const value = hex.join('');
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
function guestOwner(claimHash) {
    if (!/^hmac-sha256:v[1-9][0-9]{0,5}:[a-f\d]{64}$/.test(String(claimHash))) {
        throw checkoutError('supplier_operation_required', 400);
    }
    return crypto.createHash('sha256').update(claimHash).digest('hex');
}
function one(data) { return Array.isArray(data) ? data[0] : data; }
async function call(db, name, params) {
    if (typeof db?.rpc !== 'function') throw checkoutError();
    let result;
    try { result = await db.rpc(name, params); } catch (error) { throw publicCheckoutError(error); }
    if (result?.error) throw publicCheckoutError(result.error);
    const row = one(result?.data);
    if (!row || typeof row !== 'object') throw checkoutError();
    return row;
}
async function resolveSupplierSource(db, { productId, productSkuId = null, site = 'cn' }, env = process.env) {
    // Off by default. The DB native guards also reject mapped products without
    // a trusted quote, including direct authenticated RPC calls and batch carts.
    if (String(env.SHOP_SUPPLIER_CHECKOUT_V2_ENABLED || '').toLowerCase() !== 'true') return null;
    if (!UUID.test(String(productId)) || (productSkuId && !UUID.test(String(productSkuId)))) {
        throw checkoutError('supplier_checkout_scope_unsupported', 400);
    }
    const source = await call(db, 'fn_shop_supplier_source_v2', {
        p_product_id: productId, p_sku_id: productSkuId, p_site: site
    });
    if (source.is_supplier !== true) return null;
    if (site !== 'cn' || !UUID.test(String(source.sku_id))) {
        throw checkoutError('supplier_checkout_scope_unsupported', 409);
    }
    return { productId, skuId: source.sku_id };
}
function assertScope(payload) {
    if (payload.site !== 'cn' || Number(payload.quantity) !== 1 || payload.discountCode || payload.discountAssetId
        || payload.discountSelections?.length || payload.agentId) {
        throw checkoutError('supplier_checkout_scope_unsupported', 409);
    }
}
async function issueQuote(db, { source, fundingKind, userId = null, ownerHash = null, requestFingerprint = null, operation }) {
    const quote = await call(db, 'fn_issue_shop_supplier_quote_v2', {
        p_operation_id: operation, p_funding_kind: fundingKind,
        p_buyer_user_id: userId, p_guest_owner_hash: ownerHash,
        p_product_id: source.productId, p_sku_id: source.skuId,
        p_native_request_fingerprint: requestFingerprint
    });
    if (!UUID.test(String(quote.quote_id))) throw checkoutError();
    return quote;
}
async function purchaseWithPoints(db, { source, payload, userId }) {
    assertScope(payload);
    if (!UUID.test(String(userId))) throw checkoutError('supplier_operation_required', 400);
    const quote = await issueQuote(db, { source, fundingKind: 'points', userId,
        operation: operationId('points', userId, payload.idempotencyKey) });
    return call(db, 'fn_purchase_shop_supplier_points_v2', {
        p_quote_id: quote.quote_id, p_buyer_user_id: userId
    });
}
async function createGuestOrder(db, { source, params }) {
    assertScope({ site: params.p_site, quantity: params.p_quantity,
        discountCode: params.p_discount_code });
    const ownerHash = guestOwner(params.p_claim_secret_hash);
    const quote = await issueQuote(db, { source, fundingKind: 'guest_cash', ownerHash,
        requestFingerprint: params.p_request_fingerprint,
        operation: operationId('guest_cash', ownerHash, params.p_idempotency_key) });
    return call(db, 'fn_create_shop_supplier_guest_order_v2', { ...params, p_quote_id: quote.quote_id });
}

async function recoverPointsPurchase(db, { userId, site, idempotencyKey }) {
    if (!UUID.test(userId || '') || site !== 'cn') throw checkoutError('supplier_checkout_scope_unsupported', 400);
    const row = await call(db, 'fn_shop_supplier_recover_points_v2', {
        p_operation_id: operationId('points', userId, idempotencyKey), p_buyer_user_id: userId, p_site: site
    });
    if (row.status === 'unconfirmed') return { status: 'unconfirmed' };
    if (row.status !== 'confirmed' || !UUID.test(row.orderId || '')) throw checkoutError();
    const { publicResolution } = require('./resolution');
    const resolution = publicResolution(row.resolution);
    if (row.resolution != null && !resolution) throw checkoutError();
    return { status: 'confirmed', orderId: row.orderId, resolution };
}

module.exports = { resolveSupplierSource, purchaseWithPoints, createGuestOrder,
    operationId, guestOwner, publicCheckoutError, recoverPointsPurchase };
