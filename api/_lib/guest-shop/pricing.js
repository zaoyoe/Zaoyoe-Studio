'use strict';

/**
 * Guest checkout reuses the logged-in shop credit/tier price.
 * 1 credit = 1 CNY. Both CN and INTL settle in CNY.
 * Agent markup and discount codes are intentionally excluded.
 */

const GUEST_CREDIT_PRICING_VERSION = 'guest-credit-v1';
const GUEST_SETTLEMENT_CURRENCY = 'CNY';
const GUEST_QUANTITY = 1;

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

function resolveGuestCreditUnitAmount(input = {}) {
    const site = String(input.site || '').trim().toLowerCase();
    if (site !== 'cn' && site !== 'intl') return null;

    const quantity = Number.isInteger(input.quantity) ? input.quantity : GUEST_QUANTITY;
    if (quantity !== GUEST_QUANTITY) return null;

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
    resolveGuestPayablePricing,
    roundMoneyAmount,
    roundUpMoneyAmount
};
