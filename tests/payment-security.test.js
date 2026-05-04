const test = require('node:test');
const assert = require('node:assert/strict');

const {
    issueCustomRechargeQuote,
    issuePaymentIntentClaimToken,
    verifyCustomRechargeQuoteToken,
    verifyPaymentIntentClaimToken,
    __testUtils: paymentTestUtils
} = require('../api/_lib/payments/orders');
const {
    __testUtils: secretTestUtils
} = require('../api/_lib/secrets');
const {
    buildNowpaymentsIpnSignature,
    convertCnyAmountToPriceAmount,
    createNowpaymentsPayment,
    normalizeNowpaymentsPaymentStatus,
    verifyNowpaymentsIpnSignature
} = require('../api/_lib/payments/nowpayments');

function withEnv(patch, callback) {
    const previous = {};

    for (const [key, value] of Object.entries(patch || {})) {
        previous[key] = process.env[key];
        if (value === undefined || value === null) {
            delete process.env[key];
        } else {
            process.env[key] = String(value);
        }
    }

    try {
        return callback();
    } finally {
        for (const key of Object.keys(patch || {})) {
            if (previous[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = previous[key];
            }
        }
    }
}

test('custom recharge quote no longer falls back to service role key', () => {
    assert.throws(() => issueCustomRechargeQuote({
        userId: 'user-1',
        site: 'cn',
        providerKey: 'afdian',
        pointsAmount: 2,
        rechargeOptions: {
            custom_amount_points_per_cny: 50
        },
        env: {
            SUPABASE_SERVICE_ROLE_KEY: 'service-role-only'
        }
    }), /自定义充值报价签名密钥未配置/);
});

test('custom recharge quote secret must not reuse service role key', () => {
    assert.throws(() => issueCustomRechargeQuote({
        userId: 'user-1',
        site: 'cn',
        providerKey: 'afdian',
        pointsAmount: 2,
        rechargeOptions: {
            custom_amount_points_per_cny: 50
        },
        env: {
            SUPABASE_SERVICE_ROLE_KEY: 'shared-secret',
            PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET: 'shared-secret'
        }
    }), /不能复用 SUPABASE_SERVICE_ROLE_KEY/);
});

test('custom recharge quote signs and verifies with an independent secret', () => {
    const env = {
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
        PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET: 'quote-secret'
    };

    const quote = issueCustomRechargeQuote({
        userId: 'user-1',
        site: 'cn',
        providerKey: 'afdian',
        pointsAmount: 2,
        rechargeOptions: {
            custom_amount_points_per_cny: 50
        },
        env
    });

    const verified = verifyCustomRechargeQuoteToken(quote.token, {
        env,
        userId: 'user-1',
        site: 'cn',
        providerKey: 'afdian'
    });

    assert.ok(verified);
    assert.equal(verified.quoteId, quote.quoteId);
    assert.equal(verified.pointsAmount, 2);
    assert.equal(verified.paidAmount, 2);
});

test('custom recharge quote ignores legacy non-1:1 exchange ratios', () => {
    const env = {
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
        PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET: 'quote-secret'
    };

    const quote = issueCustomRechargeQuote({
        userId: 'user-1',
        site: 'cn',
        providerKey: 'zpay',
        pointsAmount: 0.5,
        rechargeOptions: {
            custom_amount_min_points: 1,
            custom_amount_step: 1,
            custom_amount_points_per_cny: 50
        },
        env
    });

    const verified = verifyCustomRechargeQuoteToken(quote.token, {
        env,
        userId: 'user-1',
        site: 'cn',
        providerKey: 'zpay'
    });

    assert.ok(verified);
    assert.equal(verified.pointsAmount, 0.5);
    assert.equal(verified.paidAmount, 0.5);
});

test('custom recharge quote preserves 1:1 decimal amounts at 0.01 precision', () => {
    const env = {
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
        PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET: 'quote-secret'
    };

    const quote = issueCustomRechargeQuote({
        userId: 'user-1',
        site: 'cn',
        providerKey: 'zpay',
        pointsAmount: 0.25,
        rechargeOptions: {
            custom_amount_min_points: 0.01,
            custom_amount_step: 0.01,
            custom_amount_points_per_cny: 1
        },
        env
    });

    const verified = verifyCustomRechargeQuoteToken(quote.token, {
        env,
        userId: 'user-1',
        site: 'cn',
        providerKey: 'zpay'
    });

    assert.ok(verified);
    assert.equal(verified.pointsAmount, 0.25);
    assert.equal(verified.paidAmount, 0.25);
});

test('misconfigured quote secret fails closed during verification', () => {
    const issueEnv = {
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
        PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET: 'quote-secret'
    };

    const quote = issueCustomRechargeQuote({
        userId: 'user-1',
        site: 'cn',
        providerKey: 'afdian',
        pointsAmount: 2,
        rechargeOptions: {
            custom_amount_points_per_cny: 50
        },
        env: issueEnv
    });

    const verified = verifyCustomRechargeQuoteToken(quote.token, {
        env: {
            SUPABASE_SERVICE_ROLE_KEY: 'shared-secret',
            PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET: 'shared-secret'
        },
        userId: 'user-1',
        site: 'cn',
        providerKey: 'afdian'
    });

    assert.equal(verified, null);
});

test('payment intent claim signs and verifies with an independent secret', () => {
    const env = {
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
        PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET: 'quote-secret'
    };

    const claim = issuePaymentIntentClaimToken({
        userId: 'user-1',
        site: 'intl',
        providerKey: 'afdian',
        checkoutSessionId: 'checkout-session-1',
        packageId: 'pkg-1',
        packageName: 'Intl Package',
        expectedAmount: 20,
        pointsAmount: 200,
        chargeType: 'package',
        env
    });

    const verified = verifyPaymentIntentClaimToken(claim.token, {
        env,
        userId: 'user-1',
        site: 'intl',
        providerKey: 'afdian'
    });

    assert.ok(verified);
    assert.equal(verified.intentId, claim.intentId);
    assert.equal(verified.checkoutSessionId, 'checkout-session-1');
    assert.equal(verified.expectedAmount, 20);
    assert.equal(verified.pointsAmount, 200);
});

test('payment intent claim verification rejects mismatched user, site, or provider', () => {
    const env = {
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
        PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET: 'quote-secret'
    };

    const claim = issuePaymentIntentClaimToken({
        userId: 'user-1',
        site: 'cn',
        providerKey: 'afdian',
        checkoutSessionId: 'checkout-session-2',
        packageId: 'pkg-2',
        packageName: 'CN Package',
        expectedAmount: 9.9,
        pointsAmount: 100,
        chargeType: 'package',
        env
    });

    assert.equal(verifyPaymentIntentClaimToken(claim.token, {
        env,
        userId: 'user-2',
        providerKey: 'afdian'
    }), null);
    assert.equal(verifyPaymentIntentClaimToken(claim.token, {
        env,
        userId: 'user-1',
        site: 'intl',
        providerKey: 'afdian'
    }), null);
    assert.equal(verifyPaymentIntentClaimToken(claim.token, {
        env,
        userId: 'user-1',
        site: 'cn',
        providerKey: 'hupijiao'
    }), null);
});

test('mock payment can be explicitly allowed in production-like runtimes', () => {
    const runtimeState = paymentTestUtils.getMockPaymentRuntimeState({
        requestHost: 'verify.zaoyoe.com',
        env: {
            VERCEL_ENV: 'production',
            ALLOW_REMOTE_MOCK_PAYMENTS: 'true'
        }
    });

    assert.equal(runtimeState.allowed, true);
    assert.match(runtimeState.message, /白名单放行/);
    assert.equal(paymentTestUtils.isMockPaymentRuntimeAllowed({
        requestHost: 'verify.zaoyoe.com',
        env: {
            VERCEL_ENV: 'production',
            ALLOW_REMOTE_MOCK_PAYMENTS: 'true'
        }
    }), true);

    assert.equal(paymentTestUtils.resolveRequestedProviderKey({
        requestedProviderKey: 'mock',
        paymentChannels: {
            active_provider: 'afdian',
            providers: {
                mock: { enabled: true }
            }
        },
        rechargeOptions: {
            mock_payment_enabled: true
        },
        requestHost: 'verify.zaoyoe.com',
        env: {
            VERCEL_ENV: 'production',
            ALLOW_REMOTE_MOCK_PAYMENTS: 'true'
        }
    }), 'mock');
});

test('mock payment supports auto-expiring production override windows', () => {
    const futureIso = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const runtimeState = paymentTestUtils.getMockPaymentRuntimeState({
        requestHost: 'verify.zaoyoe.com',
        env: {
            VERCEL_ENV: 'production',
            ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL: futureIso
        }
    });

    assert.equal(runtimeState.allowed, true);
    assert.match(runtimeState.message, /有效期至/);
    assert.match(runtimeState.message, new RegExp(futureIso.slice(0, 16)));
});

test('expired mock payment override windows fail closed', () => {
    const pastIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const runtimeState = paymentTestUtils.getMockPaymentRuntimeState({
        requestHost: 'verify.zaoyoe.com',
        env: {
            VERCEL_ENV: 'production',
            ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL: pastIso
        }
    });

    assert.equal(runtimeState.allowed, false);
    assert.match(runtimeState.message, /到期/);
});

test('mock payment runtime state keeps cleanup metadata when override env still exists', () => {
    const pastIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const runtimeState = paymentTestUtils.getMockPaymentRuntimeState({
        requestHost: 'verify.zaoyoe.com',
        env: {
            VERCEL_ENV: 'production',
            ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL: pastIso
        }
    });

    assert.equal(runtimeState.override_configured, true);
    assert.equal(runtimeState.override_active, false);
    assert.equal(runtimeState.override_env_name, 'ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL');
    assert.equal(runtimeState.override_mode, 'until');
    assert.match(runtimeState.cleanup_message, /ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL/);
});

test('mock payment stays blocked in production-like runtimes without explicit override', () => {
    assert.throws(() => paymentTestUtils.resolveRequestedProviderKey({
        requestedProviderKey: 'mock',
        paymentChannels: {
            active_provider: 'afdian',
            providers: {
                mock: { enabled: true }
            }
        },
        rechargeOptions: {
            mock_payment_enabled: true
        },
        requestHost: 'verify.zaoyoe.com',
        env: {
            VERCEL_ENV: 'production'
        }
    }), /ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL/);
});

test('mock payment still requires backend config even when runtime override is enabled', () => {
    assert.throws(() => paymentTestUtils.resolveRequestedProviderKey({
        requestedProviderKey: 'mock',
        paymentChannels: {
            active_provider: 'afdian',
            providers: {
                mock: { enabled: false }
            }
        },
        rechargeOptions: {
            mock_payment_enabled: false
        },
        requestHost: 'verify.zaoyoe.com',
        env: {
            VERCEL_ENV: 'production',
            ALLOW_REMOTE_MOCK_PAYMENTS: 'true'
        }
    }), /未开启模拟支付/);
});

test('explicit enabled real payment providers can be selected independently from the active provider', () => {
    assert.equal(paymentTestUtils.resolveRequestedProviderKey({
        requestedProviderKey: 'nowpayments',
        paymentChannels: {
            active_provider: 'zpay',
            providers: {
                zpay: { enabled: true },
                nowpayments: { enabled: true }
            }
        },
        rechargeOptions: {
            mock_payment_enabled: false
        },
        requestHost: 'www.zaoyoe.com',
        env: {
            VERCEL_ENV: 'production'
        }
    }), 'nowpayments');

    assert.throws(() => paymentTestUtils.resolveRequestedProviderKey({
        requestedProviderKey: 'nowpayments',
        paymentChannels: {
            active_provider: 'zpay',
            providers: {
                zpay: { enabled: true },
                nowpayments: { enabled: false }
            }
        },
        rechargeOptions: {
            mock_payment_enabled: false
        },
        requestHost: 'www.zaoyoe.com',
        env: {
            VERCEL_ENV: 'production'
        }
    }), /未启用/);
});

test('admin secret encryption key must be independent', () => {
    assert.throws(() => withEnv({
        ADMIN_CONFIG_ENCRYPTION_KEY: 'shared-secret',
        SUPABASE_SERVICE_ROLE_KEY: 'shared-secret'
    }, () => secretTestUtils.getEncryptionKey()), /不能复用 SUPABASE_SERVICE_ROLE_KEY/);

    const encryptionKey = withEnv({
        ADMIN_CONFIG_ENCRYPTION_KEY: 'admin-config-secret',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret'
    }, () => secretTestUtils.getEncryptionKey());

    assert.equal(Buffer.isBuffer(encryptionKey), true);
    assert.equal(encryptionKey.length, 32);
});

test('nowpayments ipn signature sorts nested payloads before hmac verification', () => {
    const payload = {
        payment_status: 'finished',
        order_id: 'NP123',
        fee: {
            withdrawalFee: 0,
            depositFee: 0.01
        },
        price_amount: 1,
        pay_currency: 'usdtbsc'
    };
    const signature = buildNowpaymentsIpnSignature(payload, 'ipn-secret');

    assert.equal(verifyNowpaymentsIpnSignature(payload, 'ipn-secret', signature).valid, true);
    assert.equal(verifyNowpaymentsIpnSignature({
        ...payload,
        price_amount: 2
    }, 'ipn-secret', signature).valid, false);
});

test('nowpayments status and cny quote conversion stay conservative', () => {
    assert.equal(normalizeNowpaymentsPaymentStatus('finished'), 'paid');
    assert.equal(normalizeNowpaymentsPaymentStatus('partially_paid'), 'partially_paid');
    assert.equal(normalizeNowpaymentsPaymentStatus('wrong_asset_confirmed'), 'wrong_asset');
    assert.equal(convertCnyAmountToPriceAmount(10, {
        priceCurrency: 'usd',
        cnyToUsdRate: 0.14
    }), 1.4);
    assert.equal(convertCnyAmountToPriceAmount(0.01, {
        priceCurrency: 'usd',
        cnyToUsdRate: 0.14
    }), 0.01);
});

test('nowpayments direct payment creation uses payment endpoint for hosted Chinese checkout', async () => {
    let capturedUrl = '';
    let capturedInit = null;
    const result = await createNowpaymentsPayment({
        channelConfig: {
            api_base_url: 'https://api.nowpayments.io',
            pay_currency: 'usdtbsc',
            price_currency: 'usd',
            ipn_callback_url: 'https://www.zaoyoe.com/api/payments/nowpayments/webhook',
            is_fixed_rate: true,
            is_fee_paid_by_user: true
        },
        secretValues: {
            nowpayments_api_key: 'np-api-key',
            nowpayments_ipn_secret: 'np-ipn-secret'
        },
        requestOrigin: 'https://www.zaoyoe.com',
        orderId: 'NP_DIRECT_1',
        priceAmount: '8.40',
        orderDescription: 'Zaoyoe credits 60'
    }, {
        fetchImpl: async (url, init) => {
            capturedUrl = url;
            capturedInit = init;
            return {
                ok: true,
                status: 200,
                statusText: 'OK',
                text: async () => JSON.stringify({
                    payment_id: '5731943810',
                    pay_address: '0x6776ad44D571c1b24930939F8ba0f0B5601e05d0',
                    pay_amount: 8.55955247,
                    pay_currency: 'usdtbsc'
                })
            };
        }
    });

    assert.equal(capturedUrl, 'https://api.nowpayments.io/v1/payment');
    assert.equal(capturedInit.method, 'POST');
    assert.equal(capturedInit.headers['x-api-key'], 'np-api-key');
    const payload = JSON.parse(capturedInit.body);
    assert.equal(payload.order_id, 'NP_DIRECT_1');
    assert.equal(payload.price_amount, '8.40');
    assert.equal(payload.pay_currency, 'usdtbsc');
    assert.equal(payload.is_fixed_rate, true);
    assert.equal(payload.is_fee_paid_by_user, true);
    assert.equal(result.response.data.pay_address, '0x6776ad44D571c1b24930939F8ba0f0B5601e05d0');
});
