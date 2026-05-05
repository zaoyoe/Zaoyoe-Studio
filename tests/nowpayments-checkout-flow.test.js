const test = require('node:test');
const assert = require('node:assert/strict');

const {
    getPaymentProviderAdapter
} = require('../api/_lib/payments/provider-adapters');

test('NOWPayments adapter returns a direct crypto checkout summary for the Chinese wallet UI', async () => {
    const adapter = getPaymentProviderAdapter('nowpayments');
    const calls = [];
    const originalFetch = global.fetch;

    global.fetch = async (url, request) => {
        calls.push({
            url: String(url),
            payload: JSON.parse(String(request.body || '{}'))
        });
        if (String(url).includes('/update-merchant-estimate')) {
            return {
                ok: true,
                status: 200,
                statusText: 'OK',
                async text() {
                    return JSON.stringify({
                        pay_amount: 8.55955248,
                        expiration_estimate_date: '2030-05-04T04:03:00.000Z'
                    });
                }
            };
        }

        return {
            ok: true,
            status: 200,
            statusText: 'OK',
            async text() {
                return JSON.stringify({
                    payment_id: '5731943810',
                    pay_address: '0x6776ad44D571c1b24930939F8ba0f0B5601e05d0',
                    pay_amount: 8.55955247,
                    pay_currency: 'usdtbsc'
                });
            }
        };
    };

    try {
        const context = await adapter.createCheckoutContext({
            runtimeContext: {
                channelConfig: {
                    display_name: 'USDT-BEP20',
                    api_base_url: 'https://api.nowpayments.io',
                    pay_currency: 'usdtbsc',
                    price_currency: 'usd',
                    cny_to_usd_rate: 0.14,
                    ipn_callback_url: 'https://www.zaoyoe.com/api/payments/nowpayments/webhook',
                    is_fixed_rate: true,
                    is_fee_paid_by_user: true,
                    network_name: 'BNB Smart Chain'
                },
                secretValues: {
                    nowpayments_api_key: 'np-api-key',
                    nowpayments_ipn_secret: 'np-ipn-secret'
                },
                requestOrigin: 'https://www.zaoyoe.com'
            },
            checkoutSession: {
                id: 'checkout-session-1',
                session_key: 'PCS_TEST_NOWPAYMENTS'
            },
            site: 'cn',
            packageId: 'pkg-100',
            packageName: '新礼包',
            paidPoints: 100,
            bonusPoints: 0,
            grantedPoints: 100,
            paidAmount: 60,
            isCustomRecharge: false
        });

        assert.equal(calls.length, 2);
        assert.equal(calls[0].url, 'https://api.nowpayments.io/v1/payment');
        assert.equal(calls[0].payload.price_amount, '8.40');
        assert.equal(calls[0].payload.price_currency, 'usd');
        assert.equal(calls[0].payload.pay_currency, 'usdtbsc');
        assert.equal(calls[1].url, 'https://api.nowpayments.io/v1/payment/5731943810/update-merchant-estimate');
        assert.equal(context.supported, true);
        assert.equal(context.action, 'crypto_checkout');
        assert.equal(context.checkoutUrl, '');
        assert.match(context.providerOrderNo, /^NP[A-F0-9]+$/);
        assert.equal(context.providerMetadata.pay_address, '0x6776ad44D571c1b24930939F8ba0f0B5601e05d0');
        assert.equal(context.providerMetadata.pay_amount_text, '8.56');
        assert.equal(context.providerMetadata.pay_amount_original, 8.55955248);
        assert.equal(context.providerMetadata.pay_amount_precision, 2);
        assert.equal(context.summary.pay_address, '0x6776ad44D571c1b24930939F8ba0f0B5601e05d0');
        assert.equal(context.summary.pay_amount_text, '8.56');
        assert.equal(context.summary.pay_amount_original, 8.55955248);
        assert.equal(context.summary.network_code, 'BSC/BEP20');
        assert.equal(context.summary.expiration_estimate_date, '2030-05-04T04:03:00.000Z');
    } finally {
        global.fetch = originalFetch;
    }
});
