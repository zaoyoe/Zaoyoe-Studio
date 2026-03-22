const test = require('node:test');
const assert = require('node:assert/strict');

const {
    issueCustomRechargeQuote,
    verifyCustomRechargeQuoteToken,
    __testUtils: paymentTestUtils
} = require('../api/_lib/payments/orders');
const {
    __testUtils: secretTestUtils
} = require('../api/_lib/secrets');

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
        pointsAmount: 100,
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
        pointsAmount: 100,
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
        pointsAmount: 100,
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
    assert.equal(verified.pointsAmount, 100);
    assert.equal(verified.paidAmount, 2);
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
        pointsAmount: 100,
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
