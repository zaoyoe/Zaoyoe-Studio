'use strict';

/**
 * Guest checkout reuses the logged-in shop credit/tier price.
 * 1 credit = 1 CNY. Both CN and INTL settle in CNY.
 * Agent markup stays excluded: it is an account-level benefit and the guest
 * channel has no account.
 *
 * L1/L2 SCOPE OF THIS FILE (docs/guest-shop-promo-hardening-plan.md §9.4)
 *   resolveGuestCreditUnitAmount below is a DISPLAY/PARITY mirror of the SQL
 *   function public.guest_shop_resolve_credit_unit_amount. It exists so the
 *   preview endpoint and the request fingerprint can be built before an order
 *   row exists, and so a parity test can prove the two agree. It is never the
 *   authority for what a buyer pays: fn_guest_shop_create_order recomputes the
 *   list price in SQL, applies any discount through
 *   fn_guest_shop_reserve_discount, and the HTTP layer persists whatever the
 *   database returned. Discount amounts are therefore NOT computed here at all.
 */

const GUEST_CREDIT_PRICING_VERSION = 'guest-credit-v1';
const GUEST_SETTLEMENT_CURRENCY = 'CNY';
const GUEST_QUANTITY = 1;
// Mirrors the SQL resolver's own bound (p_quantity BETWEEN 1 AND 99). The
// per-order guest ceiling (<= 5, and usually 1) is applied by
// promo.resolveGuestQuantityCap before this function is ever reached; keeping
// the two bounds identical is what makes the JS/SQL parity test meaningful.
const GUEST_QUANTITY_CEILING = 99;

function toFiniteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    const text = String(value).trim();
    if (!text || /[eE]/.test(text)) return null;
    const amount = Number(text);
    return Number.isFinite(amount) ? amount : null;
}

function roundCreditAmount(value) {
    const amount = toFiniteNumber(value);
    if (amount === null) return null;
    return Number((Math.round(amount * 100) / 100).toFixed(2));
}

function parseTimestamp(value) {
    if (value instanceof Date) {
        const ms = value.getTime();
        return Number.isFinite(ms) ? ms : NaN;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : NaN;
    }
    if (typeof value === 'string' && value.trim()) {
        return Date.parse(value);
    }
    return NaN;
}

function isFlashSaleActive(end, now) {
    const endMs = parseTimestamp(end);
    const nowMs = parseTimestamp(now);
    return Number.isFinite(endMs) && Number.isFinite(nowMs) && endMs > nowMs;
}

function parseQuantityRules(rules) {
    let source = rules;
    if (typeof source === 'string' && source.trim()) {
        try {
            source = JSON.parse(source);
        } catch (_) {
            return [];
        }
    }
    if (!Array.isArray(source)) return [];

    const parsed = [];
    for (const rule of source) {
        if (!rule || typeof rule !== 'object') continue;
        const qty = Number.parseInt(String(rule.qty ?? ''), 10);
        const priceText = String(rule.price ?? '').trim();
        const price = Number(priceText === '' ? '0' : priceText);
        if (!Number.isInteger(qty) || qty < 1 || !Number.isFinite(price)) continue;
        parsed.push({ qty, price });
    }
    return parsed;
}

function firstPositiveAmount(...values) {
    for (const value of values) {
        const amount = toFiniteNumber(value);
        if (amount !== null && amount > 0) return amount;
    }
    return null;
}

function firstDefined(...values) {
    for (const value of values) {
        if (value === null || value === undefined || value === '') continue;
        return value;
    }
    return null;
}

function parseQuantityInteger(value) {
    if (typeof value === 'number') return Number.isInteger(value) ? value : null;
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!text || !/^\d+$/u.test(text)) return null;
    const parsed = Number(text);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

function resolveGuestCreditUnitAmount(input = {}) {
    const site = String(input.site || '').trim().toLowerCase();
    if (site !== 'cn' && site !== 'intl') return null;

    // L1: quantity is no longer hard-locked to 1. The tier loop further down
    // already picks the cheapest rule whose qty is <= quantity, and the
    // flash-sale branch ignores quantity, so relaxing this guard is exactly what
    // turns tiered pricing and flash sales on for the guest channel - the same
    // edit the SQL resolver received in §4 of the L1/L2 migration.
    const quantity = input.quantity === undefined || input.quantity === null || input.quantity === ''
        ? GUEST_QUANTITY
        : (Number.isInteger(input.quantity) ? input.quantity : parseQuantityInteger(input.quantity));
    if (quantity === null || quantity < 1 || quantity > GUEST_QUANTITY_CEILING) return null;

    // INTL may leave site-specific credit fields empty. Reuse the CN SKU
    // credit/tier/flash price in that case. Never fall back to product
    // list prices or leftover guest cash columns.
    const skuIsDefault = input.skuIsDefault === true;
    const cnQuantityRules = input.skuQuantityRules ?? (skuIsDefault ? input.productQuantityRules : null);
    const intlQuantityRules = input.skuQuantityRulesIntl ?? (skuIsDefault ? input.productQuantityRulesIntl : null);
    let base;
    let quantityRules;
    let flashPrice;
    let flashEnd;
    if (site === 'intl') {
        base = firstPositiveAmount(input.skuPricePointsIntl, input.skuPricePoints);
        quantityRules = firstDefined(intlQuantityRules, cnQuantityRules);
        const hasIntlFlash = input.productFlashSalePriceIntl != null
            || (input.productFlashSaleEndIntl != null && String(input.productFlashSaleEndIntl).trim() !== '');
        flashPrice = hasIntlFlash
            ? toFiniteNumber(input.productFlashSalePriceIntl)
            : toFiniteNumber(input.productFlashSalePrice);
        flashEnd = hasIntlFlash ? input.productFlashSaleEndIntl : input.productFlashSaleEnd;
    } else {
        base = firstPositiveAmount(input.skuPricePoints);
        quantityRules = cnQuantityRules;
        flashPrice = toFiniteNumber(input.productFlashSalePrice);
        flashEnd = input.productFlashSaleEnd;
    }
    if (base === null || base <= 0) return null;

    const now = input.now == null ? new Date() : input.now;

    if (isFlashSaleActive(flashEnd, now) && flashPrice !== null) {
        base = Math.min(base, flashPrice);
    } else {
        for (const rule of parseQuantityRules(quantityRules)) {
            if (quantity >= rule.qty && rule.price < base) {
                base = rule.price;
            }
        }
    }

    const rounded = roundCreditAmount(base);
    if (rounded === null || rounded <= 0) return null;
    return rounded;
}

const {
    getDefaultPaymentChannelsConfig,
    loadStoredPaymentConfigs
} = require('../payments/providers');

const DEFAULT_GUEST_SURCHARGE_RATE = 0.01;
const DEFAULT_GUEST_SURCHARGE_LABEL = '通道手续费';
const GUEST_PAYMENT_PROVIDER_KEYS = Object.freeze(['zpay', 'nowpayments']);

function roundMoneyAmount(value, fallback = null) {
    const amount = toFiniteNumber(value);
    if (amount === null) return fallback;
    return Number((Math.round(amount * 100) / 100).toFixed(2));
}

function roundUpMoneyAmount(value, fallback = null) {
    const amount = toFiniteNumber(value);
    if (amount === null) return fallback;
    return Number((Math.ceil(amount * 100) / 100).toFixed(2));
}

function normalizeSurchargeRate(value, fallback = 0) {
    const parsed = toFiniteNumber(value);
    const fallbackParsed = toFiniteNumber(fallback);
    const rate = parsed === null
        ? (fallbackParsed === null ? 0 : fallbackParsed)
        : parsed;
    if (!(rate > 0)) return 0;
    return Math.min(0.1, Math.round(rate * 10000) / 10000);
}

function resolveGuestSurchargeRate(value, fallback = DEFAULT_GUEST_SURCHARGE_RATE) {
    const rate = normalizeSurchargeRate(value, fallback);
    if (rate > 0) return rate;
    const fallbackRate = normalizeSurchargeRate(fallback, DEFAULT_GUEST_SURCHARGE_RATE);
    return fallbackRate > 0 ? fallbackRate : DEFAULT_GUEST_SURCHARGE_RATE;
}

function sanitizeSurchargeLabel(value, fallback = DEFAULT_GUEST_SURCHARGE_LABEL) {
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim();
    return normalized ? normalized.slice(0, 40) : fallback;
}

function moneyAmountsEqual(left, right) {
    const first = roundMoneyAmount(left);
    const second = roundMoneyAmount(right);
    return first !== null && second !== null && first === second;
}

function buildGuestPaymentPricing({
    baseAmount = 0,
    surchargeRate = 0,
    surchargeLabel = DEFAULT_GUEST_SURCHARGE_LABEL
} = {}) {
    const normalizedBaseAmount = roundMoneyAmount(baseAmount, null);
    const rate = normalizeSurchargeRate(surchargeRate, 0);
    const label = sanitizeSurchargeLabel(surchargeLabel) || DEFAULT_GUEST_SURCHARGE_LABEL;
    const surchargeAmount = normalizedBaseAmount > 0 && rate > 0
        ? roundUpMoneyAmount(normalizedBaseAmount * rate, 0)
        : 0;
    const payableAmount = normalizedBaseAmount > 0
        ? roundMoneyAmount(normalizedBaseAmount + (surchargeAmount || 0), normalizedBaseAmount)
        : normalizedBaseAmount;

    return {
        baseAmount: normalizedBaseAmount,
        surchargeRate: rate,
        surchargeAmount: surchargeAmount || 0,
        surchargeLabel: label,
        payableAmount
    };
}

function buildGuestPaymentPricingPayload(pricing = {}) {
    return {
        base_amount: roundMoneyAmount(pricing.baseAmount, null),
        payment_fee_amount: roundMoneyAmount(pricing.surchargeAmount, 0) || 0,
        payment_fee_rate: normalizeSurchargeRate(pricing.surchargeRate, 0),
        payment_fee_label: sanitizeSurchargeLabel(pricing.surchargeLabel),
        payable_amount: roundMoneyAmount(pricing.payableAmount, null)
    };
}

function defaultGuestProviderSurcharge(providerKey) {
    const key = String(providerKey || '').trim().toLowerCase();
    const defaults = getDefaultPaymentChannelsConfig();
    const provider = defaults?.providers?.[key] || {};
    const fallbackRate = GUEST_PAYMENT_PROVIDER_KEYS.includes(key)
        ? DEFAULT_GUEST_SURCHARGE_RATE
        : 0;
    return {
        surcharge_rate: resolveGuestSurchargeRate(provider.surcharge_rate, fallbackRate),
        surcharge_label: sanitizeSurchargeLabel(provider.surcharge_label)
    };
}

function guestProviderSurchargeFromConfig(providerKey, paymentChannels) {
    const key = String(providerKey || '').trim().toLowerCase();
    const provider = paymentChannels?.providers?.[key];
    const fallback = defaultGuestProviderSurcharge(key);
    if (!provider || typeof provider !== 'object') return fallback;
    return {
        surcharge_rate: resolveGuestSurchargeRate(provider.surcharge_rate, fallback.surcharge_rate),
        surcharge_label: sanitizeSurchargeLabel(provider.surcharge_label, fallback.surcharge_label)
    };
}

function publicGuestPaymentProviderSummaries(summaries = {}) {
    const result = {};
    for (const key of GUEST_PAYMENT_PROVIDER_KEYS) {
        const summary = summaries && typeof summaries === 'object' ? summaries[key] : null;
        const fallback = defaultGuestProviderSurcharge(key);
        result[key] = {
            surcharge_rate: resolveGuestSurchargeRate(summary?.surcharge_rate, fallback.surcharge_rate),
            surcharge_label: sanitizeSurchargeLabel(summary?.surcharge_label, fallback.surcharge_label)
        };
    }
    return result;
}

function resolveGuestPayablePricing(unitAmount, providerKey, summaries = {}) {
    const key = String(providerKey || '').trim().toLowerCase();
    const summary = summaries && typeof summaries === 'object' && summaries[key]
        ? summaries[key]
        : defaultGuestProviderSurcharge(key);
    const pricing = buildGuestPaymentPricing({
        baseAmount: unitAmount,
        surchargeRate: resolveGuestSurchargeRate(summary?.surcharge_rate, defaultGuestProviderSurcharge(key).surcharge_rate),
        surchargeLabel: summary?.surcharge_label
    });
    return {
        providerKey: key,
        ...pricing,
        payload: buildGuestPaymentPricingPayload(pricing)
    };
}

/**
 * L1: the LIST (pre-discount) subtotal of a multi-unit guest order, i.e. the
 * tiered/flash unit price this process resolved times the requested count.
 *
 * Why this exists as a server helper instead of a client multiplication: the
 * guest checkout modal must show 商品金额 for N units BEFORE an order row
 * exists, and §11.1 forbids the browser from deriving an amount by itself. So
 * the preview endpoint ships the subtotal and the client only formats it. The
 * value is still display-only - fn_guest_shop_create_order recomputes the list
 * price in SQL and the parity gate in the orders handler rejects any row that
 * disagrees with what was quoted here.
 *
 * Bounds mirror resolveGuestOrderPayablePricing exactly so a quantity that one
 * helper accepts can never be rejected by the other.
 */
function resolveGuestListSubtotal({
    unitAmount,
    quantity = GUEST_QUANTITY
} = {}) {
    const unit = roundMoneyAmount(unitAmount, null);
    const count = parseQuantityInteger(quantity);
    if (unit === null || !(unit > 0) || count === null || count < 1 || count > GUEST_QUANTITY_CEILING) {
        return null;
    }
    const subtotal = roundMoneyAmount(unit * count, null);
    return subtotal !== null && subtotal > 0 ? subtotal : null;
}

/**
 * L1: the surcharge base for a multi-unit order is the NET ORDER TOTAL, not the
 * unit price. `baseAmount` must be the amount the database already committed as
 * the pre-fee total (fn_guest_shop_create_order returns it as total_amount, and
 * §1's CHECK pins total_amount = unit_amount*quantity + payment_fee_amount), so
 * this helper only re-derives base = unit*quantity to double-check the caller
 * passed a consistent pair and then adds the channel fee.
 *
 * The result satisfies the fee CHECK by construction: normalizeSurchargeRate
 * caps the rate at 0.1 and roundUpMoneyAmount adds at most one cent, which is
 * exactly the +0.01 slack in payment_fee_amount <= ROUND(unit*qty*0.1, 2) + 0.01.
 */
function resolveGuestOrderPayablePricing({
    unitAmount,
    quantity = GUEST_QUANTITY,
    providerKey,
    summaries = {},
    expectedBaseAmount = null
} = {}) {
    const unit = roundMoneyAmount(unitAmount, null);
    const count = parseQuantityInteger(quantity);
    if (unit === null || !(unit > 0) || count === null || count < 1 || count > GUEST_QUANTITY_CEILING) {
        return null;
    }
    const baseAmount = roundMoneyAmount(unit * count, null);
    if (baseAmount === null || !(baseAmount > 0)) return null;
    const expected = roundMoneyAmount(expectedBaseAmount, null);
    // A caller that already knows the committed pre-fee total (the create-order
    // row) must agree with unit*quantity. Refusing to price a mismatch is what
    // keeps the fee from being computed on a base the database will reject.
    if (expected !== null && expected !== baseAmount) return null;
    const pricing = resolveGuestPayablePricing(baseAmount, providerKey, summaries);
    return {
        ...pricing,
        quantity: count,
        unitAmount: unit,
        baseAmount
    };
}

async function loadGuestPaymentProviderSummaries({ supabase = null, siteName = '' } = {}) {
    const summaries = {};
    for (const key of GUEST_PAYMENT_PROVIDER_KEYS) {
        summaries[key] = defaultGuestProviderSurcharge(key);
    }
    try {
        if (!supabase?.from) return summaries;
        const stored = await loadStoredPaymentConfigs(supabase, { site: siteName });
        for (const key of GUEST_PAYMENT_PROVIDER_KEYS) {
            summaries[key] = guestProviderSurchargeFromConfig(key, stored?.paymentChannels);
        }
        return summaries;
    } catch (_) {
        return summaries;
    }
}

module.exports = {
    DEFAULT_GUEST_SURCHARGE_LABEL,
    DEFAULT_GUEST_SURCHARGE_RATE,
    GUEST_CREDIT_PRICING_VERSION,
    GUEST_PAYMENT_PROVIDER_KEYS,
    GUEST_QUANTITY,
    GUEST_QUANTITY_CEILING,
    GUEST_SETTLEMENT_CURRENCY,
    buildGuestPaymentPricing,
    buildGuestPaymentPricingPayload,
    defaultGuestProviderSurcharge,
    loadGuestPaymentProviderSummaries,
    moneyAmountsEqual,
    normalizeSurchargeRate,
    publicGuestPaymentProviderSummaries,
    resolveGuestSurchargeRate,
    resolveGuestCreditUnitAmount,
    resolveGuestListSubtotal,
    resolveGuestOrderPayablePricing,
    resolveGuestPayablePricing,
    roundMoneyAmount,
    roundUpMoneyAmount
};
