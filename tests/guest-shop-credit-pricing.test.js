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
    assert.equal(price({ quantity: 2 }), null);
    assert.equal(price({ skuPricePoints: null, skuPricePointsIntl: 20 }), null);
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

test('guest credit pricing applies qty=1 tier rules and default-SKU product fallback', () => {
    assert.equal(price({
        skuQuantityRules: [{ qty: 1, price: 9.5 }, { qty: 2, price: 7 }]
    }), 9.5);
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
