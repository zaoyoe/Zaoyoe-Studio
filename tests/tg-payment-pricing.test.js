'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { breakdown, valid, displayCryptoAmount, usdtPayAmount, cryptoAmountsEqual } = require('../js/tg-payment-pricing');

test('Alipay and USDT add exactly 1%, rounding upward to integer cents; WeChat remains fee free', () => {
    for (const channel of ['alipay', 'usdt_bep20']) {
        for (const [subtotal, fee] of [[1, 1], [99, 1], [100, 1], [101, 2], [124, 2], [1234, 13], [10000, 100]]) {
            const value = breakdown(subtotal, channel);
            assert.deepEqual(value, { subtotal_minor: subtotal, payment_fee_minor: fee, payment_fee_rate_bps: 100, total_minor: subtotal + fee });
            assert.equal(valid({ ...value, payment_channel: channel }, { quote: true }), true);
        }
    }
    assert.deepEqual(breakdown(124, 'wxpay'), { subtotal_minor: 124, payment_fee_minor: 0, payment_fee_rate_bps: 0, total_minor: 124 });
});

test('invalid, overflow and client-forged fee snapshots fail closed', () => {
    for (const subtotal of [undefined, null, NaN, 0, -1, 1.5, '100', 100000001, Number.MAX_SAFE_INTEGER]) assert.equal(breakdown(subtotal, 'alipay'), null);
    assert.equal(breakdown(100000000, 'alipay'), null);
    for (const channel of [undefined, 'paypal', '__proto__']) assert.equal(breakdown(100, channel), null);
    const value = { ...breakdown(124, 'alipay'), payment_channel: 'alipay' };
    for (const change of [{ subtotal_minor: undefined }, { payment_fee_minor: 0 }, { payment_fee_minor: '2' },
        { payment_fee_rate_bps: 1 }, { total_minor: 124 }, { total_minor: 127 }, { payment_channel: 'wxpay' }]) assert.equal(valid({ ...value, ...change }), false);
});

test('legacy accepted fee-free orders remain valid, but cannot become new Alipay or USDT quotes', () => {
    for (const channel of ['alipay', 'usdt_bep20']) {
        const legacy = { subtotal_minor: 100000000, payment_fee_minor: 0, payment_fee_rate_bps: 0, total_minor: 100000000, payment_channel: channel };
        assert.equal(valid(legacy), true);
        assert.equal(valid(legacy, { quote: true }), false);
    }
});

test('USDT display amount rounds upward to four decimals without changing the exact payment value', () => {
    assert.equal(displayCryptoAmount('11.06025126'), '11.0603');
    assert.equal(displayCryptoAmount('11.0602'), '11.0602');
    assert.equal(displayCryptoAmount('11.06'), '11.0600');
    assert.equal(displayCryptoAmount('0.00000001'), '0.0001');
    assert.equal(displayCryptoAmount('9.99999999'), '10.0000');
    for (const value of [undefined, null, '', '0', '1e3', '1.1234567890123456789', 1.2]) assert.equal(displayCryptoAmount(value), null);
});


test('product, quote and payment use one exact merchant USDT price including the fee once', () => {
    assert.equal(usdtPayAmount(breakdown(7000, 'usdt_bep20').total_minor, '0.1536'), '10.86');
    assert.equal(usdtPayAmount(breakdown(21800, 'usdt_bep20').total_minor, '0.1536'), '33.82');
    assert.equal(usdtPayAmount(1, '0.00000001'), '0.01');
    assert.equal(usdtPayAmount(126, '0.1536'), '0.20');
    for (const rate of [undefined, null, 0.1536, '0', '-1', '10', 'NaN', '1e-2', '0.123456789']) assert.equal(usdtPayAmount(7070, rate), null);
    for (const total of [undefined, 0, -1, 1.5, '7070', 100000001]) assert.equal(usdtPayAmount(total, '0.1536'), null);
});

test('confirmation comparisons never equate values that merely round to the same four-decimal display', () => {
    assert.equal(cryptoAmountsEqual('10.86', '10.860000000000000000'), true);
    assert.equal(cryptoAmountsEqual('10.86', '10.860000000000000001'), false);
    assert.equal(cryptoAmountsEqual('10.86', '10.859999999999999999'), false);
    for (const value of [undefined, null, '0', '1e1', 10.86, '10.8600000000000000001']) assert.equal(cryptoAmountsEqual(value, value), false);
});
