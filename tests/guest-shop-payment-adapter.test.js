'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
    buildZpaySign
} = require('../api/_lib/payments/zpay');
const {
    buildNowpaymentsIpnSignature,
    sortObject
} = require('../api/_lib/payments/nowpayments');
const {
    channelMatchesAllowlist,
    createGuestShopPaymentAdapter,
    getTrustedOrderAmount,
    normalizeAllowedChannels,
    normalizeDecimalAmount
} = require('../api/_lib/payments/guest-shop-adapter');

const ORIGIN = 'https://www.fatherkey.com';
const ZPAY_SECRET = 'zpay-live-secret-012345678901234567890';
const NOWPAYMENTS_API_KEY = 'nowpayments-live-api-key-0123456789';
const NOWPAYMENTS_IPN_SECRET = 'nowpayments-live-ipn-secret-0123456789';

function responseJson(data, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status >= 200 && status < 300 ? 'OK' : 'Bad Request',
        async text() {
            return JSON.stringify(data);
        }
    };
}

function makeOrder(overrides = {}) {
    return {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        order_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        order_no: 'GS20260913-000001',
        payment_order_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        total_amount: '12.34',
        site: 'cn',
        currency: 'CNY',
        provider: 'zpay',
        channel: 'alipay',
        snapshot_product_name: 'Test product',
        snapshot_sku_name: 'Default',
        ...overrides
    };
}

function makeAdapter(config, secretValues, fetchImpl, provider = config?.pay_currency ? 'nowpayments' : 'zpay') {
    return createGuestShopPaymentAdapter({
        supabase: {},
        config: { providers: { [provider]: config } },
        env: { APP_ENV: 'test', APP_BASE_URL: ORIGIN },
        fetchImpl,
        // Passing secrets directly keeps this contract test independent from
        // Supabase while exercising the same fail-closed normalization path.
        resolveSecrets: async () => secretValues
    });
}

function zpayConfig(overrides = {}) {
    return {
        enabled: true,
        pid: '10001',
        checkout_url: 'https://zpayz.cn',
        payment_type: 'alipay',
        ...overrides
    };
}

function nowpaymentsConfig(overrides = {}) {
    return {
        enabled: true,
        api_base_url: 'https://api.nowpayments.io',
        pay_currency: 'usdtbsc',
        price_currency: 'usd',
        cny_to_usd_rate: 0.14,
        ...overrides
    };
}

test('guest payment channel allowlist matches the database exact-token contract', () => {
    assert.deepEqual(
        normalizeAllowedChannels([' ZPAY ', 'alipay', 'zpay:alipay', 'ALIPAY']),
        ['zpay', 'alipay', 'zpay:alipay']
    );
    assert.equal(channelMatchesAllowlist('zpay', 'alipay', ['zpay']), true);
    assert.equal(channelMatchesAllowlist('zpay', 'alipay', ['alipay']), true);
    assert.equal(channelMatchesAllowlist('zpay', 'alipay', ['zpay:alipay']), true);
    assert.equal(channelMatchesAllowlist('zpay', 'wxpay', ['zpay:alipay']), false);
    assert.equal(channelMatchesAllowlist('zpay', 'alipay', ['zpay:*']), false);

    for (const invalid of [
        ['zpay:*'],
        ['mock'],
        ['zpay', 1],
        ['zpay', { provider: 'zpay', channel: 'alipay' }],
        ['zpay', 'bad channel'],
        ['zpay', ''],
        ['zpay', 'x'.repeat(161)]
    ]) {
        assert.throws(
            () => normalizeAllowedChannels(invalid),
            (error) => error?.code === 'guest_payment_channel_allowlist_invalid'
        );
    }
});

test('adapter rejects an empty product channel allowlist before touching gateway', async () => {
    let calls = 0;
    const adapter = makeAdapter(zpayConfig(), { zpay_pkey: ZPAY_SECRET }, async () => {
        calls += 1;
        return responseJson({ code: 1, payurl: `${ORIGIN}/pay` });
    });

    await assert.rejects(
        () => adapter.createGuestPayment({
            order: makeOrder(),
            provider: 'zpay',
            channel: 'alipay',
            site: 'cn',
            amount: '12.34',
            allowedChannels: []
        }),
        (error) => error.code === 'guest_payment_channel_allowlist_empty'
    );
    assert.equal(calls, 0);
});

test('adapter rejects mock/test/fake providers and disabled or placeholder live config', async () => {
    const adapter = makeAdapter(zpayConfig({ enabled: false }), { zpay_pkey: '__configured__' }, async () => responseJson({}));
    for (const provider of ['mock', 'test', 'fake']) {
        await assert.rejects(
            () => adapter.createGuestPayment({
                order: makeOrder({ provider }),
                provider,
                channel: provider,
                site: 'cn',
                allowedChannels: [provider]
            }),
            (error) => error.code === 'guest_invalid_payment_provider'
        );
    }

    await assert.rejects(
        () => adapter.createGuestPayment({
            order: makeOrder(),
            provider: 'zpay',
            channel: 'alipay',
            site: 'cn',
            allowedChannels: ['zpay']
        }),
        (error) => error.code === 'guest_payment_provider_disabled'
    );

    const enabledAdapter = makeAdapter(zpayConfig(), { zpay_pkey: 'test' }, async () => responseJson({}));
    await assert.rejects(
        () => enabledAdapter.createGuestPayment({
            order: makeOrder(),
            provider: 'zpay',
            channel: 'alipay',
            site: 'cn',
            allowedChannels: ['zpay']
        }),
        (error) => error.code === 'guest_payment_live_secret_unavailable'
    );
});

test('ZPay checkout uses immutable server amount and excludes claim/user metadata', async () => {
    let request;
    const adapter = makeAdapter(zpayConfig(), { zpay_pkey: ZPAY_SECRET }, async (url, options) => {
        request = { url, options };
        return responseJson({
            code: 1,
            payurl: 'https://zpayz.cn/pay/checkout?id=1',
            trade_no: 'ZTRADE-1',
            O_id: 'GATEWAY-1'
        });
    });
    const result = await adapter.createGuestPayment({
        order: makeOrder({ claim_secret: 'must-never-leave-server', user_id: 'user-1' }),
        provider: 'zpay',
        channel: 'alipay',
        site: 'cn',
        currency: 'CNY',
        amount: '12.34',
        allowedChannels: ['zpay'],
        req: { headers: { 'user-agent': 'test-agent' } }
    });

    assert.equal(result.amount_text, '12.34');
    assert.equal(result.provider_order_no, 'GS20260913-000001');
    assert.equal(result.provider_metadata.purpose, 'shop_direct');
    assert.equal(result.provider_metadata.provider, 'zpay');
    assert.equal('claim_secret' in result.provider_metadata, false);
    assert.equal('user_id' in result.provider_metadata, false);
    assert.equal('points' in result.provider_metadata, false);
    assert.equal('payment_checkout_session' in result.provider_metadata, false);

    const form = new URLSearchParams(request.options.body);
    assert.equal(form.get('money'), '12.34');
    assert.equal(form.get('out_trade_no'), 'GS20260913-000001');
    assert.equal(form.get('param'), 'guest:GS20260913-000001');
    assert.equal(form.get('param').includes('claim'), false);
    assert.equal(form.get('param').includes('user'), false);
    assert.equal(form.get('param').includes('points'), false);
});

test('trusted guest amount prefers expected_amount over catalog total_amount', () => {
    const payable = getTrustedOrderAmount({
        expected_amount: '12.47',
        total_amount: '12.34'
    }, '12.47');
    assert.equal(payable.text, '12.47');
    assert.equal(payable.amount, 12.47);

    const fallback = getTrustedOrderAmount({
        total_amount: '144.00'
    });
    assert.equal(fallback.text, '144.00');

    assert.throws(
        () => getTrustedOrderAmount({
            expected_amount: '12.47',
            total_amount: '12.34'
        }, '12.34'),
        (error) => error.code === 'guest_payment_amount_snapshot_mismatch'
    );
});

test('adapter rejects a client amount that differs from the server snapshot', async () => {
    const adapter = makeAdapter(zpayConfig(), { zpay_pkey: ZPAY_SECRET }, async () => responseJson({ code: 1, payurl: 'https://zpayz.cn/pay' }));
    await assert.rejects(
        () => adapter.createGuestPayment({
            order: makeOrder({ total_amount: '12.34' }),
            provider: 'zpay',
            channel: 'alipay',
            site: 'cn',
            amount: '0.01',
            allowedChannels: ['zpay']
        }),
        (error) => error.code === 'guest_payment_amount_snapshot_mismatch'
    );
    assert.throws(() => normalizeDecimalAmount('1e-2'), (error) => error.code === 'guest_invalid_payment_amount');
});

test('NOWPayments checkout requires USDT-BEP20 and returns payment details without secrets', async () => {
    let request;
    const adapter = makeAdapter(nowpaymentsConfig(), {
        nowpayments_api_key: NOWPAYMENTS_API_KEY,
        nowpayments_ipn_secret: NOWPAYMENTS_IPN_SECRET
    }, async (url, options) => {
        request = { url, options };
        return responseJson({
            payment_id: 'NP-PAYMENT-1',
            order_id: 'GS20260913-000002',
            pay_address: '0x1234567890abcdef1234567890abcdef12345678',
            pay_amount: 1.73,
            pay_currency: 'usdtbsc',
            price_amount: 1.73,
            price_currency: 'usd',
            expiration_estimate_date: '2026-09-13T12:00:00Z'
        });
    });
    const result = await adapter.createGuestPayment({
        order: makeOrder({
            order_no: 'GS20260913-000002',
            provider: 'nowpayments',
            channel: 'nowpayments',
            site: 'cn'
        }),
        provider: 'nowpayments',
        channel: 'nowpayments',
        site: 'cn',
        amount: '12.34',
        allowedChannels: ['nowpayments']
    });

    assert.equal(result.payment_id, 'NP-PAYMENT-1');
    assert.equal(result.pay_currency, 'usdtbsc');
    assert.equal(result.provider_metadata.purpose, 'shop_direct');
    assert.equal('nowpayments_api_key' in result.provider_metadata, false);
    assert.equal('nowpayments_ipn_secret' in result.provider_metadata, false);
    assert.equal(request.options.headers['x-api-key'], NOWPAYMENTS_API_KEY);
    const body = JSON.parse(request.options.body);
    assert.equal(body.order_id, 'GS20260913-000002');
    assert.equal(body.pay_currency, 'usdtbsc');
    assert.equal(body.price_amount, '1.73');
    assert.equal(result.currency, 'CNY');
    assert.equal(result.checkout.currency, 'CNY');
    assert.equal(result.provider_metadata.local_currency, 'cny');
    assert.equal(result.provider_metadata.local_amount, 12.34);
    assert.equal(result.provider_metadata.cny_to_usd_rate, 0.14);

    const wrongNetworkAdapter = makeAdapter(nowpaymentsConfig({ pay_currency: 'usdttrc20' }), {
        nowpayments_api_key: NOWPAYMENTS_API_KEY,
        nowpayments_ipn_secret: NOWPAYMENTS_IPN_SECRET
    }, async () => responseJson({}));
    await assert.rejects(
        () => wrongNetworkAdapter.createGuestPayment({
            order: makeOrder({ provider: 'nowpayments', channel: 'nowpayments' }),
            provider: 'nowpayments',
            channel: 'nowpayments',
            site: 'cn',
            amount: '12.34',
            allowedChannels: ['nowpayments']
        }),
        (error) => error.code === 'guest_payment_network_unsupported'
    );
});

test('NOWPayments intl checkout still settles CNY and converts the credit price to a USD quote', async () => {
    let request;
    const adapter = makeAdapter(nowpaymentsConfig(), {
        nowpayments_api_key: NOWPAYMENTS_API_KEY,
        nowpayments_ipn_secret: NOWPAYMENTS_IPN_SECRET
    }, async (url, options) => {
        request = { url, options };
        return responseJson({
            payment_id: 'NP-PAYMENT-INTL-1',
            order_id: 'GS20260913-000006',
            pay_address: '0x1234567890abcdef1234567890abcdef12345678',
            pay_amount: 1.73,
            pay_currency: 'usdtbsc',
            price_amount: 1.73,
            price_currency: 'usd',
            expiration_estimate_date: '2026-09-13T12:00:00Z'
        });
    });
    const result = await adapter.createGuestPayment({
        order: makeOrder({
            order_no: 'GS20260913-000006',
            provider: 'nowpayments',
            channel: 'nowpayments',
            site: 'intl',
            currency: 'CNY'
        }),
        provider: 'nowpayments',
        channel: 'nowpayments',
        site: 'intl',
        amount: '12.34',
        allowedChannels: ['nowpayments']
    });

    assert.equal(result.currency, 'CNY');
    assert.equal(result.checkout.currency, 'CNY');
    assert.equal(result.pay_currency, 'usdtbsc');
    assert.equal(result.provider_metadata.local_currency, 'cny');
    assert.equal(result.provider_metadata.local_amount, 12.34);
    assert.equal(result.provider_metadata.cny_to_usd_rate, 0.14);
    const body = JSON.parse(request.options.body);
    assert.equal(body.price_amount, '1.73');
    assert.equal(body.pay_currency, 'usdtbsc');
});

test('NOWPayments 4xx amount too small is a definitive create rejection', async () => {
    const adapter = makeAdapter(nowpaymentsConfig(), {
        nowpayments_api_key: NOWPAYMENTS_API_KEY,
        nowpayments_ipn_secret: NOWPAYMENTS_IPN_SECRET
    }, async () => responseJson({ message: 'amountTo is too small' }, 400));
    await assert.rejects(
        () => adapter.createGuestPayment({
            order: makeOrder({
                provider: 'nowpayments',
                channel: 'nowpayments',
                site: 'intl',
                currency: 'CNY'
            }),
            provider: 'nowpayments',
            channel: 'nowpayments',
            site: 'intl',
            amount: '12.34',
            allowedChannels: ['nowpayments']
        }),
        (error) => error.code === 'guest_provider_create_failed'
            && error.statusCode === 400
            && /最低限额/.test(error.message)
    );
});

test('NOWPayments gateway network failure stays non-definitive', async () => {
    const adapter = makeAdapter(nowpaymentsConfig(), {
        nowpayments_api_key: NOWPAYMENTS_API_KEY,
        nowpayments_ipn_secret: NOWPAYMENTS_IPN_SECRET
    }, async () => {
        throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    });
    await assert.rejects(
        () => adapter.createGuestPayment({
            order: makeOrder({
                provider: 'nowpayments',
                channel: 'nowpayments',
                site: 'intl',
                currency: 'CNY'
            }),
            provider: 'nowpayments',
            channel: 'nowpayments',
            site: 'intl',
            amount: '12.34',
            allowedChannels: ['nowpayments']
        }),
        (error) => error.code !== 'guest_provider_create_failed'
            && error.code !== 'guest_payment_channel_unavailable'
            && error.code !== 'guest_payment_provider_disabled'
            && error.code !== 'guest_payment_provider_not_ready'
    );
});

test('ZPay webhook verification requires official MD5 and exact raw form body', async () => {
    const adapter = makeAdapter(zpayConfig(), { zpay_pkey: ZPAY_SECRET }, async () => responseJson({}));
    const unsigned = {
        pid: '10001',
        trade_status: 'TRADE_SUCCESS',
        out_trade_no: 'GS20260913-000001',
        trade_no: 'ZTRADE-1',
        money: '12.34',
        sign_type: 'MD5'
    };
    const sign = buildZpaySign(unsigned, ZPAY_SECRET);
    const payload = { ...unsigned, sign };
    const rawBody = new URLSearchParams(payload).toString();
    const verified = await adapter.verifyGuestWebhook({
        provider: 'zpay',
        payload,
        rawBody,
        expectedPayment: { site: 'cn' },
        site: 'cn'
    });
    assert.equal(verified.valid, true);
    assert.equal(verified.signature_version, 'MD5');

    const tampered = await adapter.verifyGuestWebhook({
        provider: 'zpay',
        payload: { ...payload, money: '0.01' },
        rawBody,
        expectedPayment: { site: 'cn' },
        site: 'cn'
    });
    assert.equal(tampered.valid, false);
    assert.equal(tampered.reason, 'guest_webhook_payload_mismatch');
});

test('NOWPayments webhook verification uses x-nowpayments-sig HMAC-SHA512', async () => {
    const adapter = makeAdapter(nowpaymentsConfig(), {
        nowpayments_api_key: NOWPAYMENTS_API_KEY,
        nowpayments_ipn_secret: NOWPAYMENTS_IPN_SECRET
    }, async () => responseJson({}));
    const payload = {
        payment_id: 'NP-PAYMENT-1',
        order_id: 'GS20260913-000002',
        payment_status: 'finished',
        price_amount: 1.73,
        price_currency: 'usd',
        pay_amount: 1.73,
        pay_currency: 'usdtbsc',
        actually_paid: 1.73,
        actually_paid_currency: 'usdtbsc'
    };
    const rawBody = JSON.stringify(payload);
    const signature = buildNowpaymentsIpnSignature(payload, NOWPAYMENTS_IPN_SECRET);
    const verified = await adapter.verifyGuestWebhook({
        provider: 'nowpayments',
        payload,
        rawBody,
        headers: { 'x-nowpayments-sig': signature },
        expectedPayment: { site: 'cn' },
        site: 'cn'
    });
    assert.equal(verified.valid, true);
    assert.equal(verified.signature_version, 'HMAC-SHA512');

    const badSignature = await adapter.verifyGuestWebhook({
        provider: 'nowpayments',
        payload,
        rawBody,
        headers: { 'x-nowpayments-sig': crypto.createHash('sha256').update(signature).digest('hex') },
        expectedPayment: { site: 'cn' },
        site: 'cn'
    });
    assert.equal(badSignature.valid, false);

    const parsed = sortObject(payload);
    assert.deepEqual(parsed, { ...payload });
});

test('webhook parser normalizes provider references, status and network without trusting client site', async () => {
    const adapter = makeAdapter(nowpaymentsConfig(), {
        nowpayments_api_key: NOWPAYMENTS_API_KEY,
        nowpayments_ipn_secret: NOWPAYMENTS_IPN_SECRET
    }, async () => responseJson({}));
    const parsed = await adapter.parseGuestWebhook({
        provider: 'nowpayments',
        site: 'cn',
        payload: {
            payment_id: 'NP-PAYMENT-1',
            order_id: 'GS20260913-000002',
            payment_status: 'finished',
            price_amount: '1.73',
            price_currency: 'usd',
            pay_amount: '1.73',
            pay_currency: 'usdtbsc',
            actually_paid: '1.73',
            actually_paid_currency: 'usdtbsc',
            transaction_id: 'tx-1'
        }
    });
    assert.equal(parsed.purpose, 'shop_direct');
    assert.equal(parsed.merchant_order_no, 'GS20260913-000002');
    assert.equal(parsed.status, 'paid');
    assert.equal(parsed.network_verified, true);
    assert.equal(parsed.currency, 'USD');
    assert.equal(parsed.paid_currency, 'usdtbsc');
});

test('NOWPayments finished callbacks require explicit actually_paid and actually_paid_currency', async () => {
    const adapter = makeAdapter(nowpaymentsConfig(), {
        nowpayments_api_key: NOWPAYMENTS_API_KEY,
        nowpayments_ipn_secret: NOWPAYMENTS_IPN_SECRET
    }, async () => responseJson({}));
    const base = {
        payment_id: 'NP-PAYMENT-STRICT-1',
        order_id: 'GS20260913-000003',
        payment_status: 'finished',
        price_amount: '1.73',
        price_currency: 'usd',
        // These are only the requested checkout quote and must not be treated
        // as proof of funds received.
        pay_amount: '1.73',
        pay_currency: 'usdtbsc'
    };

    const missingAmount = await adapter.parseGuestWebhook({ provider: 'nowpayments', site: 'cn', payload: base });
    assert.equal(missingAmount.actually_paid, null);
    assert.equal(missingAmount.paid_currency, '');
    assert.equal(missingAmount.actual_payment_verified, false);
    assert.equal(missingAmount.status, 'review');
    assert.equal(missingAmount.network_verified, false);

    const missingCurrency = await adapter.parseGuestWebhook({
        provider: 'nowpayments',
        site: 'cn',
        payload: { ...base, actually_paid: '1.73' }
    });
    assert.equal(missingCurrency.actually_paid, 1.73);
    assert.equal(missingCurrency.paid_currency, '');
    assert.equal(missingCurrency.actual_payment_verified, false);
    assert.equal(missingCurrency.status, 'review');

    const wrongCurrency = await adapter.parseGuestWebhook({
        provider: 'nowpayments',
        site: 'cn',
        payload: { ...base, actually_paid: '1.73', actually_paid_currency: 'usdttrc20' }
    });
    assert.equal(wrongCurrency.actual_payment_verified, false);
    assert.equal(wrongCurrency.status, 'wrong_asset');
    assert.equal(wrongCurrency.network_verified, false);

    const valid = await adapter.parseGuestWebhook({
        provider: 'nowpayments',
        site: 'cn',
        payload: { ...base, actually_paid: '1.73', actually_paid_currency: 'usdtbsc' }
    });
    assert.equal(valid.actual_payment_verified, true);
    assert.equal(valid.status, 'paid');
    assert.equal(valid.network_verified, true);
});

test('NOWPayments settlement preserves decimal text and rejects malformed amounts', async () => {
    const adapter = makeAdapter(nowpaymentsConfig(), {
        nowpayments_api_key: NOWPAYMENTS_API_KEY,
        nowpayments_ipn_secret: NOWPAYMENTS_IPN_SECRET
    }, async () => responseJson({}));
    const base = {
        payment_id: 'NP-PAYMENT-PRECISION-1',
        order_id: 'GS20260913-000005',
        payment_status: 'finished',
        price_amount: '1.73',
        price_currency: 'usd',
        pay_amount: '1.73',
        pay_currency: 'usdtbsc',
        actually_paid_currency: 'usdtbsc'
    };

    const exact = await adapter.parseGuestWebhook({
        provider: 'nowpayments', site: 'cn',
        payload: { ...base, actually_paid: '1.730000000000000001' }
    });
    assert.equal(exact.actually_paid_text, '1.730000000000000001');
    assert.equal(exact.actual_payment_verified, true);
    assert.equal(exact.status, 'paid');

    for (const value of ['1e0', '1E+0', '-1', '0', 'NaN', 'Infinity', '']) {
        const parsed = await adapter.parseGuestWebhook({
            provider: 'nowpayments', site: 'cn',
            payload: { ...base, actually_paid: value }
        });
        assert.equal(parsed.actually_paid_text, null, `malformed amount ${value}`);
        assert.equal(parsed.actual_payment_verified, false, `malformed amount ${value}`);
        assert.equal(parsed.status, 'review', `malformed amount ${value}`);
    }

    const trailingZeros = await adapter.parseGuestWebhook({
        provider: 'nowpayments', site: 'cn',
        payload: { ...base, actually_paid: '2.0000' }
    });
    assert.equal(trailingZeros.actually_paid_text, '2.0000');
    assert.equal(trailingZeros.actual_payment_verified, true);
});

test('NOWPayments status query does not fall back to quote fields for settlement', async () => {
    const adapter = makeAdapter(nowpaymentsConfig(), {
        nowpayments_api_key: NOWPAYMENTS_API_KEY,
        nowpayments_ipn_secret: NOWPAYMENTS_IPN_SECRET
    }, async () => responseJson({
        payment_id: 'NP-PAYMENT-STRICT-2',
        order_id: 'GS20260913-000004',
        payment_status: 'finished',
        price_amount: '1.73',
        price_currency: 'usd',
        pay_amount: '1.73',
        pay_currency: 'usdtbsc'
    }));
    const queried = await adapter.queryGuestPayment({
        provider: 'nowpayments',
        channel: 'nowpayments',
        site: 'cn',
        paymentId: 'NP-PAYMENT-STRICT-2',
        allowedChannels: ['nowpayments']
    });
    assert.equal(queried.actually_paid, null);
    assert.equal(queried.paid_currency, '');
    assert.equal(queried.actual_payment_verified, false);
    assert.equal(queried.status, 'review');
    assert.equal(queried.effective_status, 'review');
});
