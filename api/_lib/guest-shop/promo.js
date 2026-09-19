'use strict';

/**
 * Guest promo L1/L2 application switches and normalization.
 *
 * Design contract: docs/guest-shop-promo-hardening-plan.md §8.3 / §13.
 * Schema contract: supabase/migrations/20260923_guest_shop_promo_l1l2.sql.
 *
 * RED LINE (non-negotiable, inherited from AGENTS.md and the plan §4):
 * this module NEVER computes an amount. It only decides
 *   1. whether the guest channel may carry a quantity > 1 or a discount code,
 *   2. how to normalize those two inputs before they reach the database, and
 *   3. how to shape the amounts the database returned for display.
 * Every price, every discount and every fee is produced by the SQL functions
 * (guest_shop_resolve_credit_unit_amount / fn_guest_shop_evaluate_discount /
 * fn_guest_shop_reserve_discount / fn_guest_shop_create_order). A value in this
 * file can only ever make the guest channel STRICTER than the database, never
 * looser: all caps are min() of the operator env and the database ceilings, and
 * an unparsable env value degrades to the P0 behaviour (quantity 1, no code).
 */

const { parseRuntimeNumericSetting } = require('./runtime-config');
// The canonical discount-code alphabet lives in security.js next to
// normalizeGuestOrderInput / buildGuestRequestFingerprint, because the value
// that is normalized there is the value that enters the idempotency fingerprint.
// This module re-exports it so callers have one import, and so the two can never
// drift apart.
const {
    GUEST_DISCOUNT_CODE_MAX_LENGTH,
    GUEST_DISCOUNT_CODE_PATTERN,
    isGuestDiscountCodeFormat,
    normalizeGuestDiscountCode
} = require('./security');

// Boolean switch for L2. Mirrors GUEST_SHOP_BUYER_CREDENTIAL_ENABLED parsing in
// buyer-credentials.js so an operator typo behaves the same way in both places:
// unparsable means OFF, and readiness reports it as invalid.
const GUEST_DISCOUNT_SWITCH = 'GUEST_SHOP_DISCOUNT_ENABLED';
const GUEST_QUANTITY_SWITCH = 'GUEST_SHOP_MAX_QUANTITY';
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'y', 'on', 'enabled']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'n', 'off', 'disabled']);

// Hard ceiling from guest_shop_orders_quantity_check (§1 of the migration).
// Raising it is a database migration, never an env change.
const GUEST_MAX_QUANTITY_CEILING = 5;
const GUEST_DEFAULT_QUANTITY = 1;

function parseGuestDiscountSwitch(env = {}) {
    const raw = String(env?.[GUEST_DISCOUNT_SWITCH] ?? '').trim().toLowerCase();
    if (!raw) return Object.freeze({ present: false, valid: true, enabled: false });
    if (TRUE_VALUES.has(raw)) return Object.freeze({ present: true, valid: true, enabled: true });
    if (FALSE_VALUES.has(raw)) return Object.freeze({ present: true, valid: true, enabled: false });
    return Object.freeze({ present: true, valid: false, enabled: false });
}

/**
 * L2 master switch. Default OFF: with it off the HTTP layer rejects a submitted
 * discount code instead of silently dropping it, so a buyer can never believe
 * they received a discount that the order does not carry.
 */
function isGuestDiscountEnabled(env = {}) {
    return parseGuestDiscountSwitch(env).enabled;
}

function parseIntegerOrNull(value) {
    if (typeof value === 'number') {
        return Number.isInteger(value) ? value : null;
    }
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    if (!text || !/^\d+$/u.test(text)) return null;
    const parsed = Number(text);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Operator env ceiling for one guest order. An unparsable or out-of-range value
 * degrades to 1 (the P0 behaviour) rather than to the maximum, so a typo can
 * never widen the channel.
 */
function resolveGuestMaxQuantity(env = {}) {
    const parsed = parseRuntimeNumericSetting(env, GUEST_QUANTITY_SWITCH);
    if (!parsed.valid) return GUEST_DEFAULT_QUANTITY;
    const value = parseIntegerOrNull(parsed.value);
    if (value === null || value < 1) return GUEST_DEFAULT_QUANTITY;
    return Math.min(GUEST_MAX_QUANTITY_CEILING, value);
}

function positiveIntegerOrNull(value) {
    const parsed = parseIntegerOrNull(value);
    if (parsed === null || parsed < 1) return null;
    return parsed;
}

/**
 * Effective per-order quantity ceiling, mirroring the SQL expression in §6 of
 * the migration exactly:
 *
 *   LEAST(5,
 *         GREATEST(1, COALESCE(sku.guest_max_quantity, product.guest_max_quantity, 1)),
 *         GREATEST(1, COALESCE(product.max_purchase_quantity, 5)))
 *
 * then clamped by the operator env ceiling. The Node value is only ever used to
 * reject early and to render the UI stepper; fn_guest_shop_create_order
 * re-applies the same cap and raises guest_quantity_not_allowed, so a stale or
 * forged client cap cannot enlarge an order.
 */
function resolveGuestQuantityCap({
    env = {},
    skuGuestMaxQuantity = null,
    productGuestMaxQuantity = null,
    productMaxPurchaseQuantity = null
} = {}) {
    const guestCeiling = positiveIntegerOrNull(skuGuestMaxQuantity)
        ?? positiveIntegerOrNull(productGuestMaxQuantity)
        ?? 1;
    const purchaseCeiling = positiveIntegerOrNull(productMaxPurchaseQuantity) ?? GUEST_MAX_QUANTITY_CEILING;
    const databaseCap = Math.min(
        GUEST_MAX_QUANTITY_CEILING,
        Math.max(1, guestCeiling),
        Math.max(1, purchaseCeiling)
    );
    return Math.max(1, Math.min(databaseCap, resolveGuestMaxQuantity(env)));
}

/**
 * Normalize a requested quantity. Returns null (never a clamp) when the value
 * is absent-but-invalid or outside 1..cap, so the caller fails closed with an
 * explicit 400 instead of quietly selling a different amount than requested.
 * `undefined` / null / '' mean "not supplied" and resolve to 1.
 */
function normalizeGuestQuantity(value, { cap = GUEST_DEFAULT_QUANTITY } = {}) {
    const limit = Math.max(1, Math.min(GUEST_MAX_QUANTITY_CEILING, parseIntegerOrNull(cap) ?? GUEST_DEFAULT_QUANTITY));
    if (value === undefined || value === null || value === '') return GUEST_DEFAULT_QUANTITY;
    const parsed = parseIntegerOrNull(value);
    if (parsed === null || parsed < 1 || parsed > limit) return null;
    return parsed;
}

function roundAmount(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return Number((Math.round(value * 100) / 100).toFixed(2));
}

function toAmount(value) {
    if (typeof value === 'number') return roundAmount(value);
    if (value === null || value === undefined || value === '') return null;
    const text = String(value).trim();
    if (!text || !/^-?\d+(?:\.\d+)?$/u.test(text)) return null;
    return roundAmount(Number(text));
}

/**
 * Shape the DATABASE-RETURNED amounts into the display breakdown the checkout
 * modal renders. Every input comes from the create-order RPC row or from the
 * persisted order row; nothing here is derived from client input, and a missing
 * or inconsistent value removes the breakdown instead of guessing one.
 *
 * Vocabulary (migration §1):
 *   list_unit_amount * quantity = list_amount   (catalogue price, tier/flash applied)
 *   list_amount - discount_amount = net_amount  (= unit_amount * quantity)
 *   net_amount + payment_fee_amount = total_amount (what the buyer pays)
 */
function buildGuestAmountBreakdown(order = {}) {
    const quantity = parseIntegerOrNull(order?.quantity) ?? GUEST_DEFAULT_QUANTITY;
    if (quantity < 1 || quantity > GUEST_MAX_QUANTITY_CEILING) return null;
    const listUnit = toAmount(order?.list_unit_amount);
    const unit = toAmount(order?.unit_amount);
    const total = toAmount(order?.total_amount);
    const discount = toAmount(order?.discount_amount) ?? 0;
    const fee = toAmount(order?.payment_fee_amount) ?? 0;
    if (unit === null || !(unit > 0) || total === null || !(total > 0)) return null;
    if (discount < 0 || fee < 0) return null;
    const netAmount = roundAmount(unit * quantity);
    const expectedTotal = netAmount === null ? null : roundAmount(netAmount + fee);
    if (netAmount === null || expectedTotal === null || expectedTotal !== total) return null;

    const breakdown = {
        quantity,
        unit_amount: unit,
        net_amount: netAmount,
        discount_amount: discount,
        payment_fee_amount: fee,
        total_amount: total,
        currency: typeof order?.currency === 'string' && order.currency.trim()
            ? order.currency.trim().toUpperCase().slice(0, 8)
            : 'CNY'
    };
    if (listUnit !== null && listUnit > 0) {
        const listAmount = roundAmount(listUnit * quantity);
        // A legacy row (created before L1/L2) has list_unit_amount NULL; a new
        // row must be internally consistent or the discount line is dropped
        // rather than shown against a wrong base.
        if (listAmount !== null && listAmount >= netAmount && roundAmount(listAmount - netAmount) === discount) {
            breakdown.list_unit_amount = listUnit;
            breakdown.list_amount = listAmount;
        }
    }
    const code = typeof order?.discount_code === 'string' ? order.discount_code.trim().toUpperCase() : '';
    if (code && isGuestDiscountCodeFormat(code) && discount > 0) {
        breakdown.discount_code = code;
    }
    return breakdown;
}

// ---------------------------------------------------------------------------
// Guest create-order error contract (plan §11.2 / C-E6).
//
// fn_guest_shop_create_order and everything it calls signal a rejection as a
// bare `RAISE EXCEPTION 'guest_*'`, which the PostgREST client hands back as
// { code: 'P0001', message: 'guest_*', details: '<human text>' }. With no
// mapping layer that becomes a 500 `P0001`, so a plain coupon typo and a real
// fault look identical to the checkout modal - and the modal cannot retract a
// discount line it must retract.
//
// Two rules, both security properties rather than cosmetics:
//
//   1. C-E6 unification. Every coupon-lifecycle rejection - unknown code, not
//      open to guests, expired, not started, wrong site, wrong scope, per-code
//      uses exhausted, daily budget exhausted, per-identity limit, breaker open,
//      floor violation, reservation race - collapses onto ONE public code, ONE
//      status and ONE message. The granular SQL code and the SQL DETAIL stay
//      internal: echoing either one is a coupon-existence oracle.
//   2. Fail closed. A code this table does not know is left untouched, so it
//      stays a 500 with the generic message exactly as it did before this
//      batch. Adding a new RAISE to the migration can never widen what a buyer
//      is told without a reviewed change here.
//
// The table is also the single source of truth for the frontend contract test,
// which asserts the codes js/guest-shop-client.js reacts to are a subset of the
// codes this layer can actually emit.
// ---------------------------------------------------------------------------

// The one public coupon rejection (C-E6). Frozen and shared by every alias so a
// test can compare by identity and a future edit cannot drift one of them.
const GUEST_DISCOUNT_UNAVAILABLE_RESPONSE = Object.freeze({
    statusCode: 400,
    code: 'guest_discount_unavailable',
    message: '优惠码不可用'
});

const GUEST_ORDER_REQUEST_INVALID_RESPONSE = Object.freeze({
    statusCode: 400,
    code: 'guest_order_request_invalid',
    message: '下单请求已失效，请刷新页面后重试'
});

const GUEST_PAYMENT_CHANNEL_UNAVAILABLE_RESPONSE = Object.freeze({
    statusCode: 409,
    code: 'guest_payment_channel_unavailable',
    message: '支付通道暂不可用，请稍后再试'
});

const GUEST_INVENTORY_UNAVAILABLE_RESPONSE = Object.freeze({
    statusCode: 409,
    code: 'guest_inventory_unavailable',
    message: '库存不足，请稍后再试'
});

const GUEST_ORDER_STATE_INVALID_RESPONSE = Object.freeze({
    statusCode: 409,
    code: 'guest_order_state_invalid',
    message: '订单状态异常，请联系客服'
});

const GUEST_IDEMPOTENCY_CONFLICT_RESPONSE = Object.freeze({
    statusCode: 409,
    code: 'guest_idempotency_conflict',
    message: '下单信息已变化，请重新提交'
});

/**
 * Internal SQL exception message -> public HTTP contract. Keys are exactly the
 * strings the migration raises; values are the ONLY shape a buyer can receive.
 */
const GUEST_CREATE_ORDER_ERROR_CONTRACT = Object.freeze({
    // --- coupon lifecycle: all collapse onto one response (C-E6) -------------
    guest_discount_code_rejected: GUEST_DISCOUNT_UNAVAILABLE_RESPONSE,
    guest_discount_code_exhausted: GUEST_DISCOUNT_UNAVAILABLE_RESPONSE,
    guest_discount_code_mismatch: GUEST_DISCOUNT_UNAVAILABLE_RESPONSE,
    guest_discount_code_empty: GUEST_DISCOUNT_UNAVAILABLE_RESPONSE,
    guest_discount_no_effect: GUEST_DISCOUNT_UNAVAILABLE_RESPONSE,
    guest_discount_below_floor: GUEST_DISCOUNT_UNAVAILABLE_RESPONSE,
    guest_discount_identity_required: GUEST_DISCOUNT_UNAVAILABLE_RESPONSE,
    guest_discount_rate_limited: GUEST_DISCOUNT_UNAVAILABLE_RESPONSE,
    guest_discount_reservation_failed: GUEST_DISCOUNT_UNAVAILABLE_RESPONSE,
    guest_discount_rejected: GUEST_DISCOUNT_UNAVAILABLE_RESPONSE,
    guest_discount_unavailable: GUEST_DISCOUNT_UNAVAILABLE_RESPONSE,
    guest_promo_halted: GUEST_DISCOUNT_UNAVAILABLE_RESPONSE,
    guest_promo_budget_closed: GUEST_DISCOUNT_UNAVAILABLE_RESPONSE,
    guest_promo_budget_exhausted: GUEST_DISCOUNT_UNAVAILABLE_RESPONSE,

    // --- buyer input --------------------------------------------------------
    guest_invalid_site: Object.freeze({ statusCode: 400, code: 'guest_invalid_site', message: '站点参数无效' }),
    guest_product_or_sku_required: Object.freeze({
        statusCode: 400,
        code: 'guest_product_or_sku_required',
        message: '请选择商品和规格'
    }),
    guest_invalid_quantity: Object.freeze({ statusCode: 400, code: 'guest_invalid_quantity', message: '购买数量无效' }),
    guest_invalid_discount_code: GUEST_DISCOUNT_UNAVAILABLE_RESPONSE,
    guest_invalid_idempotency_key: GUEST_ORDER_REQUEST_INVALID_RESPONSE,
    guest_invalid_request_fingerprint: GUEST_ORDER_REQUEST_INVALID_RESPONSE,
    guest_invalid_claim_secret_hash: GUEST_ORDER_REQUEST_INVALID_RESPONSE,
    guest_buyer_contact_required: Object.freeze({
        statusCode: 400,
        code: 'guest_buyer_contact_required',
        message: '请填写邮箱和查询密码'
    }),
    // Same copy as the credential-lookup failure on purpose: a buyer-group
    // mismatch must not be distinguishable from a wrong password.
    guest_buyer_mismatch: Object.freeze({
        statusCode: 403,
        code: 'guest_buyer_mismatch',
        message: '邮箱或查询密码不正确'
    }),

    // --- availability / state ----------------------------------------------
    guest_purchase_disabled: Object.freeze({
        statusCode: 409,
        code: 'guest_purchase_disabled',
        message: '游客购买暂未开放'
    }),
    guest_product_unavailable: Object.freeze({
        statusCode: 409,
        code: 'guest_product_unavailable',
        message: '商品暂不支持游客购买'
    }),
    guest_sku_unavailable: Object.freeze({
        statusCode: 409,
        code: 'guest_sku_unavailable',
        message: '该规格暂不支持游客购买'
    }),
    guest_delivery_mode_unsupported: Object.freeze({
        statusCode: 409,
        code: 'guest_delivery_mode_unsupported',
        message: '该商品暂不支持游客购买'
    }),
    guest_credit_price_unavailable: Object.freeze({
        statusCode: 409,
        code: 'guest_credit_price_unavailable',
        message: '商品价格暂不可用，请稍后再试'
    }),
    guest_quantity_not_allowed: Object.freeze({
        statusCode: 409,
        code: 'guest_quantity_not_allowed',
        message: '购买数量超出该商品的可购上限'
    }),
    guest_idempotency_conflict: GUEST_IDEMPOTENCY_CONFLICT_RESPONSE,
    guest_idempotency_claim_secret_conflict: GUEST_IDEMPOTENCY_CONFLICT_RESPONSE,
    guest_payment_channel_unavailable: GUEST_PAYMENT_CHANNEL_UNAVAILABLE_RESPONSE,
    guest_payment_channel_allowlist_empty: GUEST_PAYMENT_CHANNEL_UNAVAILABLE_RESPONSE,
    guest_payment_channel_allowlist_invalid: GUEST_PAYMENT_CHANNEL_UNAVAILABLE_RESPONSE,
    guest_invalid_payment_provider: GUEST_PAYMENT_CHANNEL_UNAVAILABLE_RESPONSE,
    guest_provider_order_conflict: Object.freeze({
        statusCode: 409,
        code: 'guest_provider_order_conflict',
        message: '支付单已存在，请刷新后重试'
    }),
    guest_inventory_unavailable: GUEST_INVENTORY_UNAVAILABLE_RESPONSE,
    guest_inventory_source_invalid: GUEST_INVENTORY_UNAVAILABLE_RESPONSE,
    guest_inventory_source_unavailable: GUEST_INVENTORY_UNAVAILABLE_RESPONSE,
    guest_inventory_source_snapshot_failed: GUEST_INVENTORY_UNAVAILABLE_RESPONSE,
    guest_reservation_count_mismatch: GUEST_ORDER_STATE_INVALID_RESPONSE,
    // Raised by fn_guest_shop_reserve_discount when the order row it was handed
    // does not exist. Unreachable from a well-formed create (the RPC creates the
    // row first), so it is a state fault, not a buyer mistake - but it is still
    // retryable and says nothing about a coupon.
    guest_order_required: GUEST_ORDER_STATE_INVALID_RESPONSE,
    guest_order_not_found: Object.freeze({
        statusCode: 409,
        code: 'guest_order_not_found',
        message: '订单不存在或已过期'
    }),

    // --- server faults: deliberately generic, never a coupon hint -------------
    // guest_discount_amount_invalid is the invariant guard that fires only when
    // the database computed a discount it cannot store. That is a fault, not a
    // buyer mistake, so it stays a 500 and shows nothing about the code.
    guest_discount_amount_invalid: Object.freeze({
        statusCode: 500,
        code: 'guest_shop_request_failed',
        message: '游客购买请求失败',
        expose: false
    }),
    guest_invalid_order_ttl: Object.freeze({
        statusCode: 500,
        code: 'guest_shop_request_failed',
        message: '游客购买请求失败',
        expose: false
    })
});

/**
 * Codes the Node layer raises itself, BEFORE the create RPC runs, so they bypass
 * the mapping table above and are public in their own right:
 *
 *   guest_invalid_discount_code   400  security.normalizeGuestOrderInput /
 *                                      buildGuestRequestFingerprint. Pure format
 *                                      validation of the submitted string - no
 *                                      database lookup, therefore not a
 *                                      coupon-existence oracle. The client runs
 *                                      the same regex first, so this is the
 *                                      "should never happen" path.
 *   guest_discount_disabled       403  a code was submitted while
 *                                      GUEST_SHOP_DISCOUNT_ENABLED is off. A
 *                                      global switch state the preview already
 *                                      publishes as discount_enabled=false.
 *   guest_pricing_parity_mismatch 503  the handler's post-RPC parity gate
 *                                      (SQL price != quoted price). expose:false,
 *                                      so the buyer sees no detail; the code is
 *                                      listed because the client branches on it
 *                                      to force a re-quote.
 *   rate_limited                  429  the existing per-IP create-order bucket.
 */
const GUEST_CREATE_ORDER_NODE_LAYER_CODES = Object.freeze([
    'guest_invalid_discount_code',
    'guest_discount_disabled',
    'guest_pricing_parity_mismatch',
    'rate_limited'
]);

/**
 * Every code a buyer can receive from POST /api/shop/guest/orders. Exported for
 * the frontend contract test: the codes js/guest-shop-client.js branches on must
 * be a subset, so a client can never wait for a code the server never sends -
 * which is exactly how the pre-L1 `guest_idempotency_conflict` branch went dead.
 */
function listGuestCreateOrderPublicCodes() {
    const codes = new Set(['guest_shop_request_failed', ...GUEST_CREATE_ORDER_NODE_LAYER_CODES]);
    for (const entry of Object.values(GUEST_CREATE_ORDER_ERROR_CONTRACT)) {
        codes.add(entry.code);
    }
    return Array.from(codes).sort();
}

/**
 * True when the failure is a raw database rejection rather than an HTTP-shaped
 * error: a PostgREST error carries a 5-character SQLSTATE in `code` and, for a
 * plpgsql `RAISE EXCEPTION 'guest_x'`, the machine code in `message`.
 *
 * Used for the fail-closed branch. A rejection this module does not know must
 * still be a 500 with the generic message - but it must not hand the buyer a
 * SQLSTATE or the SQL exception text on the way out, because that is both an
 * information leak and a fingerprint of the schema.
 */
function isOpaqueGuestDatabaseError(error) {
    if (!error || typeof error !== 'object') return false;
    if (Number.isInteger(error.statusCode) && error.statusCode >= 400) return false;
    const code = typeof error.code === 'string' ? error.code.trim() : '';
    const message = typeof error.message === 'string' ? error.message.trim() : '';
    return /^[0-9A-Z]{5}$/u.test(code) || /^guest_[a-z0-9_]+$/u.test(message);
}

/**
 * Translate a create-order failure into the public HTTP contract.
 *
 * Returns null when there is nothing to translate: an error that already carries
 * an HTTP shape (GuestShopSecurityError from the Node-layer guards, a rate-limit
 * rejection) or a code this table does not know. Callers must treat null as
 * "pass the original error through unchanged", which keeps the pre-L1 500
 * behaviour for anything unexpected.
 */
function resolveGuestCreateOrderError(error) {
    if (!error || typeof error !== 'object') return null;
    // Already HTTP-shaped: the Node layer decided the status and the message.
    if (Number.isInteger(error.statusCode) && error.statusCode >= 400) return null;
    for (const candidate of [error.message, error.code, error.details]) {
        const key = typeof candidate === 'string' ? candidate.trim() : '';
        if (!key) continue;
        const mapped = Object.prototype.hasOwnProperty.call(GUEST_CREATE_ORDER_ERROR_CONTRACT, key)
            ? GUEST_CREATE_ORDER_ERROR_CONTRACT[key]
            : null;
        if (!mapped) continue;
        return Object.freeze({
            statusCode: mapped.statusCode,
            code: mapped.code,
            message: mapped.message,
            expose: mapped.expose !== false,
            // Internal only. failResponse() serializes success/code/message and
            // nothing else, so the granular SQL code can never reach a buyer; it
            // exists so an operator reading a captured error object can tell a
            // coupon typo from a real fault.
            internalCode: key
        });
    }
    return null;
}

module.exports = {
    GUEST_CREATE_ORDER_ERROR_CONTRACT,
    GUEST_CREATE_ORDER_NODE_LAYER_CODES,
    GUEST_DEFAULT_QUANTITY,
    GUEST_DISCOUNT_CODE_MAX_LENGTH,
    GUEST_DISCOUNT_CODE_PATTERN,
    GUEST_DISCOUNT_SWITCH,
    GUEST_MAX_QUANTITY_CEILING,
    GUEST_QUANTITY_SWITCH,
    buildGuestAmountBreakdown,
    isGuestDiscountCodeFormat,
    isOpaqueGuestDatabaseError,
    listGuestCreateOrderPublicCodes,
    isGuestDiscountEnabled,
    normalizeGuestDiscountCode,
    normalizeGuestQuantity,
    parseGuestDiscountSwitch,
    resolveGuestCreateOrderError,
    resolveGuestMaxQuantity,
    resolveGuestQuantityCap
};
