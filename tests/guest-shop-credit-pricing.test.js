'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    GUEST_CREDIT_PRICING_VERSION,
    GUEST_SETTLEMENT_CURRENCY,
    publicGuestPaymentProviderSummaries,
    resolveGuestCreditUnitAmount,
    resolveGuestPayablePricing
} = require('../api/_lib/guest-shop/pricing');

const NOW = new Date('2026-09-14T12:00:00.000Z');

function price(overrides = {}) {
    return resolveGuestCreditUnitAmount({
        site: 'cn',
        skuPricePoints: 12.34,
        skuPricePointsIntl: 20,
        skuIsDefault: true,
        now: NOW,
        ...overrides
    });
}

test('guest credit pricing reuses site-scoped SKU points and settles in CNY', () => {
    assert.equal(GUEST_CREDIT_PRICING_VERSION, 'guest-credit-v1');
    assert.equal(GUEST_SETTLEMENT_CURRENCY, 'CNY');
    assert.equal(price(), 12.34);
    assert.equal(price({ site: 'intl' }), 20);
    assert.equal(price({ skuPricePoints: '12.34' }), 12.34);
});

test('guest credit pricing never falls back to product prices or leftover cash prices', () => {
    assert.equal(price({ skuPricePoints: null, productPricePoints: 99 }), null);
    assert.equal(price({ skuPricePoints: 0 }), null);
    assert.equal(price({ skuPricePoints: -1 }), null);
    assert.equal(price({ site: 'unknown' }), null);
    assert.equal(price({ skuPricePoints: null, skuPricePointsIntl: 20 }), null);
});

// L1 relaxed the qty==1 hard-lock: the mirror must keep the SQL resolver's own
// bounds (p_quantity BETWEEN 1 AND 99) and reject everything outside them,
// because promo.resolveGuestQuantityCap is the only other gate in the chain.
test('guest credit pricing rejects quantities outside the resolver bounds', () => {
    assert.equal(price({ quantity: 0 }), null);
    assert.equal(price({ quantity: -1 }), null);
    assert.equal(price({ quantity: 1.5 }), null);
    assert.equal(price({ quantity: 100 }), null);
    assert.equal(price({ quantity: 'abc' }), null);
    assert.equal(price({ quantity: '2' }), 12.34);
    assert.equal(price({ quantity: 99 }), 12.34);
});

// L1: tiered pricing and flash sales now apply to the guest channel exactly as
// they do for logged-in users, because points and cash are equivalent.
test('guest credit pricing applies the tier the requested quantity reaches', () => {
    const rules = [{ qty: 1, price: 10 }, { qty: 3, price: 8 }, { qty: 5, price: 6 }];
    assert.equal(price({ skuQuantityRules: rules, quantity: 1 }), 10);
    assert.equal(price({ skuQuantityRules: rules, quantity: 2 }), 10);
    assert.equal(price({ skuQuantityRules: rules, quantity: 3 }), 8);
    assert.equal(price({ skuQuantityRules: rules, quantity: 4 }), 8);
    assert.equal(price({ skuQuantityRules: rules, quantity: 5 }), 6);
    // A tier above the SKU list price can never raise what the guest pays.
    assert.equal(price({ skuQuantityRules: [{ qty: 2, price: 99 }], quantity: 3 }), 12.34);
    // An active flash sale wins and ignores quantity, matching LEAST() in SQL.
    assert.equal(price({
        skuQuantityRules: rules,
        quantity: 5,
        productFlashSalePrice: 7,
        productFlashSaleEnd: '2026-09-14T13:00:00.000Z'
    }), 7);
    // A live-but-more-expensive flash still owns the branch: SQL takes
    // LEAST(base, flash) and skips the ladder, so the guest pays list price.
    assert.equal(price({
        skuQuantityRules: rules,
        quantity: 5,
        productFlashSalePrice: 20,
        productFlashSaleEnd: '2026-09-14T13:00:00.000Z'
    }), 12.34);
    // Expired flash falls back to the tier ladder for the requested quantity.
    assert.equal(price({
        skuQuantityRules: rules,
        quantity: 3,
        productFlashSalePrice: 7,
        productFlashSaleEnd: '2026-09-14T11:00:00.000Z'
    }), 8);
});

test('intl guest credit pricing reuses CN SKU points when intl points are missing', () => {
    assert.equal(price({ site: 'intl', skuPricePointsIntl: null, skuPricePoints: 12.34 }), 12.34);
    assert.equal(price({ site: 'intl', skuPricePointsIntl: 0, skuPricePoints: 12.34 }), 12.34);
    assert.equal(price({ site: 'intl', skuPricePointsIntl: -1, skuPricePoints: 12.34 }), 12.34);
    assert.equal(price({ site: 'intl', skuPricePointsIntl: 20, skuPricePoints: 12.34 }), 20);
    assert.equal(price({ site: 'intl', skuPricePointsIntl: null, skuPricePoints: null }), null);
});

test('intl guest credit pricing reuses CN qty=1 and flash when intl marketing is missing', () => {
    assert.equal(price({
        site: 'intl',
        skuPricePointsIntl: null,
        skuQuantityRulesIntl: null,
        skuQuantityRules: [{ qty: 1, price: 9.5 }, { qty: 2, price: 7 }]
    }), 9.5);
    assert.equal(price({
        site: 'intl',
        skuPricePointsIntl: null,
        productFlashSalePriceIntl: null,
        productFlashSaleEndIntl: null,
        productFlashSalePrice: 10,
        productFlashSaleEnd: '2026-09-14T13:00:00.000Z',
        skuQuantityRules: [{ qty: 1, price: 8 }]
    }), 10);
    assert.equal(price({
        site: 'intl',
        skuPricePointsIntl: 20,
        skuQuantityRulesIntl: [{ qty: 1, price: 18 }],
        skuQuantityRules: [{ qty: 1, price: 9.5 }]
    }), 18);
});

test('guest credit pricing applies product flash sale with LEAST and skips quantity rules', () => {
    // "skips quantity rules" means the ladder is not consulted while a flash
    // sale is live; the flash price still applies at any allowed quantity.
    assert.equal(price({
        productFlashSalePrice: 10,
        productFlashSaleEnd: '2026-09-14T13:00:00.000Z',
        skuQuantityRules: [{ qty: 1, price: 8 }]
    }), 10);
    assert.equal(price({
        skuPricePoints: 9,
        productFlashSalePrice: 10,
        productFlashSaleEnd: '2026-09-14T13:00:00.000Z'
    }), 9);
    assert.equal(price({
        productFlashSalePrice: 10,
        productFlashSaleEnd: '2026-09-14T11:00:00.000Z',
        skuQuantityRules: [{ qty: 1, price: 8 }]
    }), 8);
});

test('guest credit pricing applies tier rules and default-SKU product fallback', () => {
    assert.equal(price({
        skuQuantityRules: [{ qty: 1, price: 9.5 }, { qty: 2, price: 7 }]
    }), 9.5);
    // The same ladder at quantity 2 reaches the cheaper tier (L1).
    assert.equal(price({
        skuQuantityRules: [{ qty: 1, price: 9.5 }, { qty: 2, price: 7 }],
        quantity: 2
    }), 7);
    assert.equal(price({
        skuIsDefault: true,
        skuQuantityRules: null,
        productQuantityRules: [{ qty: 1, price: 11 }]
    }), 11);
    assert.equal(price({
        skuIsDefault: false,
        skuQuantityRules: null,
        productQuantityRules: [{ qty: 1, price: 11 }]
    }), 12.34);
    assert.equal(price({
        site: 'intl',
        skuQuantityRulesIntl: [{ qty: 1, price: 18 }]
    }), 18);
    // INTL reuses the CN ladder when it has no site-specific marketing data,
    // at any quantity (L1).
    assert.equal(price({
        site: 'intl',
        skuPricePointsIntl: null,
        skuQuantityRulesIntl: null,
        skuQuantityRules: [{ qty: 1, price: 9.5 }, { qty: 2, price: 7 }],
        quantity: 2
    }), 7);
});

test('guest payable pricing adds a rounded-up 1% surcharge on the credit price', () => {
    const alipay = resolveGuestPayablePricing(144, 'zpay');
    assert.equal(alipay.baseAmount, 144);
    assert.equal(alipay.surchargeRate, 0.01);
    assert.equal(alipay.surchargeAmount, 1.44);
    assert.equal(alipay.payableAmount, 145.44);
    assert.equal(alipay.payload.base_amount, 144);
    assert.equal(alipay.payload.payment_fee_amount, 1.44);
    assert.equal(alipay.payload.payable_amount, 145.44);

    const fractional = resolveGuestPayablePricing(12.34, 'zpay');
    assert.equal(fractional.surchargeAmount, 0.13);
    assert.equal(fractional.payableAmount, 12.47);

    const usdt = resolveGuestPayablePricing(144, 'nowpayments');
    assert.equal(usdt.surchargeAmount, 1.44);
    assert.equal(usdt.payableAmount, 145.44);
});

test('guest payable pricing does not stack a second surcharge on an already payable amount', () => {
    const first = resolveGuestPayablePricing(144, 'zpay');
    const stacked = resolveGuestPayablePricing(first.payableAmount, 'zpay');
    assert.equal(first.payableAmount, 145.44);
    assert.notEqual(stacked.payableAmount, first.payableAmount);
});

test('public guest payment provider summaries default to a 1% channel fee', () => {
    const summaries = publicGuestPaymentProviderSummaries();
    assert.equal(summaries.zpay.surcharge_rate, 0.01);
    assert.equal(summaries.nowpayments.surcharge_rate, 0.01);
    assert.equal(summaries.zpay.surcharge_label, '通道手续费');
});

test('guest payable pricing treats stored 0% as the default 1% channel fee', () => {
    const alipay = resolveGuestPayablePricing(144, 'zpay', { zpay: { surcharge_rate: 0 } });
    assert.equal(alipay.surchargeRate, 0.01);
    assert.equal(alipay.surchargeAmount, 1.44);
    assert.equal(alipay.payableAmount, 145.44);

    const usdt = resolveGuestPayablePricing(144, 'nowpayments', { nowpayments: { surcharge_rate: 0 } });
    assert.equal(usdt.surchargeRate, 0.01);
    assert.equal(usdt.surchargeAmount, 1.44);
    assert.equal(usdt.payableAmount, 145.44);

    const summaries = publicGuestPaymentProviderSummaries({
        zpay: { surcharge_rate: 0 },
        nowpayments: { surcharge_rate: 0 }
    });
    assert.equal(summaries.zpay.surcharge_rate, 0.01);
    assert.equal(summaries.nowpayments.surcharge_rate, 0.01);
});

test('guest payable pricing rounds a one-cent SKU up to two cents after 1%', () => {
    const tiny = resolveGuestPayablePricing(0.01, 'zpay');
    assert.equal(tiny.baseAmount, 0.01);
    assert.equal(tiny.surchargeRate, 0.01);
    assert.equal(tiny.surchargeAmount, 0.01);
    assert.equal(tiny.payableAmount, 0.02);

    const usdt = resolveGuestPayablePricing(0.01, 'nowpayments');
    assert.equal(usdt.payableAmount, 0.02);
});
