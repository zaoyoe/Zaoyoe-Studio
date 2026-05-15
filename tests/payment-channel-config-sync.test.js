const test = require('node:test');
const assert = require('node:assert/strict');

const {
    assertExecuteAllowed,
    buildSyncPlan,
    formatHumanReport,
    getMockRuntimeForEnv,
    parseArgs,
    resolveTargetProvider
} = require('../scripts/payment-channel-config-sync');

test('parseArgs collects sync flags', () => {
    const options = parseArgs([
        '--env-file', 'server/.env.staging',
        '--execute',
        '--json',
        '--provider', 'afdian'
    ]);

    assert.match(options.envFile, /server\/\.env\.staging$/);
    assert.equal(options.execute, true);
    assert.equal(options.json, true);
    assert.equal(options.provider, 'afdian');
});

test('resolveTargetProvider prefers explicit provider and does not auto-switch to half-wired hupijiao config', () => {
    assert.equal(resolveTargetProvider({}, 'mock'), 'mock');
    assert.equal(resolveTargetProvider({}, 'zpay'), 'zpay');
    assert.equal(resolveTargetProvider({}, 'hupijiao'), 'hupijiao');
    assert.equal(resolveTargetProvider({}, 'nowpayments'), 'nowpayments');
    assert.equal(resolveTargetProvider({
        providers: {
            zpay: { enabled: true, checkout_url: 'https://zpayz.cn', pid: '2026041807323142', notify_url: 'https://www.zaoyoe.com/api/payments/zpay/webhook' },
            afdian: { checkout_url: 'https://afdian.com/a/zaoyoe' }
        }
    }), 'afdian');
    assert.equal(resolveTargetProvider({
        providers: {
            afdian: { checkout_url: '' },
            hupijiao: { gateway_url: 'https://pay.example.com' }
        }
    }), 'afdian');
    assert.equal(resolveTargetProvider({
        providers: {
            nowpayments: {
                enabled: true,
                pay_currency: 'usdtbsc',
                ipn_callback_url: 'https://www.zaoyoe.com/api/payments/nowpayments/webhook'
            },
            zpay: {
                enabled: true,
                checkout_url: 'https://zpayz.cn',
                pid: '2026041807323142',
                notify_url: 'https://www.zaoyoe.com/api/payments/zpay/webhook'
            },
            afdian: { enabled: true, checkout_url: 'https://afdian.com/a/zaoyoe' }
        }
    }, '', {
        nowpayments_api_key: { configured: true },
        nowpayments_ipn_secret: { configured: true },
        zpay_pkey: { configured: true }
    }, {
        DEPLOYMENT_TIER: 'production'
    }), 'nowpayments');
    assert.equal(resolveTargetProvider({
        providers: {
            zpay: {
                enabled: true,
                checkout_url: 'https://zpayz.cn',
                pid: '2026041807323142',
                notify_url: 'https://www.zaoyoe.com/api/payments/zpay/webhook'
            },
            afdian: { enabled: true, checkout_url: 'https://afdian.com/a/zaoyoe' }
        }
    }, '', {
        zpay_pkey: { configured: true }
    }, {
        DEPLOYMENT_TIER: 'production'
    }), 'zpay');
});

test('buildSyncPlan disables mock and switches the stored config to afdian', () => {
    const plan = buildSyncPlan(
        {
            active_provider: 'mock',
            providers: {
                mock: { enabled: true, display_name: '模拟支付' },
                afdian: { enabled: false, checkout_url: 'https://afdian.com/a/zaoyoe', display_name: '爱发电' },
                hupijiao: { enabled: false, gateway_url: '', merchant_id: '' }
            }
        },
        {
            custom_amount_enabled: true,
            mock_payment_enabled: true
        }
    );

    assert.equal(plan.changed, true);
    assert.equal(plan.targetProvider, 'afdian');
    assert.equal(plan.next.paymentChannels.active_provider, 'afdian');
    assert.equal(plan.next.paymentChannels.providers.mock.enabled, false);
    assert.equal(plan.next.paymentChannels.providers.afdian.enabled, true);
    assert.equal(plan.next.rechargeOptions.mock_payment_enabled, false);
});

test('buildSyncPlan can switch the stored config back to mock for a temporary test window', () => {
    const plan = buildSyncPlan(
        {
            active_provider: 'afdian',
            providers: {
                mock: { enabled: false, display_name: '模拟支付' },
                afdian: { enabled: true, checkout_url: 'https://afdian.com/a/zaoyoe', display_name: '爱发电' },
                hupijiao: { enabled: false, gateway_url: '', merchant_id: '' }
            }
        },
        {
            custom_amount_enabled: true,
            mock_payment_enabled: false
        },
        {
            provider: 'mock'
        }
    );

    assert.equal(plan.changed, true);
    assert.equal(plan.targetProvider, 'mock');
    assert.equal(plan.next.paymentChannels.active_provider, 'mock');
    assert.equal(plan.next.paymentChannels.providers.mock.enabled, true);
    assert.equal(plan.next.rechargeOptions.mock_payment_enabled, true);
});

test('buildSyncPlan supports explicitly switching the stored config to zpay', () => {
    const plan = buildSyncPlan(
        {
            active_provider: 'afdian',
            providers: {
                mock: { enabled: false, display_name: '模拟支付' },
                afdian: { enabled: true, checkout_url: 'https://afdian.com/a/zaoyoe', display_name: '爱发电' },
                zpay: {
                    enabled: false,
                    checkout_url: 'https://zpayz.cn',
                    display_name: '易支付',
                    pid: '2026041807323142',
                    notify_url: 'https://www.zaoyoe.com/api/payments/zpay/webhook'
                }
            }
        },
        {
            custom_amount_enabled: true,
            mock_payment_enabled: false
        },
        {
            provider: 'zpay',
            secretStatus: {
                zpay_pkey: { configured: true }
            },
            env: {
                DEPLOYMENT_TIER: 'production',
                ZPAY_WEBHOOK_ALLOWED_IPS: '203.0.113.0/24'
            }
        }
    );

    assert.equal(plan.changed, true);
    assert.equal(plan.targetProvider, 'zpay');
    assert.equal(plan.next.paymentChannels.active_provider, 'zpay');
    assert.equal(plan.next.paymentChannels.providers.zpay.enabled, true);
    assert.equal(plan.next.rechargeOptions.mock_payment_enabled, false);
    assert.equal(plan.targetProviderValidation.ready, true);
});

test('buildSyncPlan supports explicitly switching the stored config to nowpayments', () => {
    const plan = buildSyncPlan(
        {
            active_provider: 'afdian',
            providers: {
                mock: { enabled: false, display_name: '模拟支付' },
                afdian: { enabled: true, checkout_url: 'https://afdian.com/a/zaoyoe', display_name: '爱发电' },
                nowpayments: {
                    enabled: false,
                    display_name: 'USDT-BEP20',
                    pay_currency: 'usdtbsc',
                    price_currency: 'usd',
                    cny_to_usd_rate: 0.14,
                    return_url: 'https://www.zaoyoe.com',
                    ipn_callback_url: 'https://www.zaoyoe.com/api/payments/nowpayments/webhook'
                }
            }
        },
        {
            custom_amount_enabled: true,
            mock_payment_enabled: false
        },
        {
            provider: 'nowpayments',
            secretStatus: {
                nowpayments_api_key: { configured: true },
                nowpayments_ipn_secret: { configured: true }
            },
            env: {
                DEPLOYMENT_TIER: 'production'
            }
        }
    );

    assert.equal(plan.changed, true);
    assert.equal(plan.targetProvider, 'nowpayments');
    assert.equal(plan.next.paymentChannels.active_provider, 'nowpayments');
    assert.equal(plan.next.paymentChannels.providers.nowpayments.enabled, true);
    assert.equal(plan.next.rechargeOptions.mock_payment_enabled, false);
    assert.equal(plan.targetProviderValidation.ready, true);
});

test('getMockRuntimeForEnv keeps production mock disabled despite temporary overrides', () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const runtime = getMockRuntimeForEnv({
        DEPLOYMENT_TIER: 'production',
        APP_BASE_URL: 'https://www.zaoyoe.com',
        ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL: tomorrow
    });

    assert.equal(runtime.allowed, false);
    assert.equal(runtime.reason, 'production_like_runtime');
    assert.equal(runtime.override_env_name, 'ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL');
});

test('assertExecuteAllowed blocks switching to mock when runtime override is missing', () => {
    const plan = buildSyncPlan(
        {
            active_provider: 'afdian',
            providers: {
                mock: { enabled: false, display_name: '模拟支付' },
                afdian: { enabled: true, checkout_url: 'https://afdian.com/a/zaoyoe', display_name: '爱发电' }
            }
        },
        {
            custom_amount_enabled: true,
            mock_payment_enabled: false
        },
        {
            provider: 'mock'
        }
    );

    assert.throws(() => assertExecuteAllowed(plan, {
        DEPLOYMENT_TIER: 'production',
        APP_BASE_URL: 'https://www.zaoyoe.com'
    }, {
        execute: true,
        provider: 'mock'
    }), /Refusing to switch stored payment config to mock/);
});

test('assertExecuteAllowed allows switching to zpay without webhook allowlist when strict query mode is available', () => {
    const plan = buildSyncPlan(
        {
            active_provider: 'afdian',
            providers: {
                mock: { enabled: false, display_name: '模拟支付' },
                afdian: { enabled: true, checkout_url: 'https://afdian.com/a/zaoyoe', display_name: '爱发电' },
                zpay: {
                    enabled: false,
                    checkout_url: 'https://zpayz.cn',
                    display_name: '易支付',
                    pid: '2026041807323142',
                    notify_url: 'https://www.zaoyoe.com/api/payments/zpay/webhook'
                }
            }
        },
        {
            custom_amount_enabled: true,
            mock_payment_enabled: false
        },
        {
            provider: 'zpay',
            secretStatus: {
                zpay_pkey: { configured: true }
            },
            env: {
                DEPLOYMENT_TIER: 'production'
            }
        }
    );

    assert.equal(plan.targetProvider, 'zpay');
    assert.equal(plan.targetProviderValidation.ready, true);
    assert.match(plan.targetProviderValidation.warnings.join('；'), /严格查单模式/);
    assert.doesNotThrow(() => assertExecuteAllowed(plan, {
        DEPLOYMENT_TIER: 'production'
    }, {
        execute: true,
        provider: 'zpay'
    }));
});

test('formatHumanReport surfaces the key sync toggles', () => {
    const report = formatHumanReport({
        mode: 'execute',
        project_host: 'mmkugdibsaeoevliebzk.supabase.co',
        plan: {
            changed: true,
            targetProvider: 'afdian',
            current: {
                paymentChannels: {
                    active_provider: 'mock',
                    providers: {
                        mock: { enabled: true }
                    }
                },
                rechargeOptions: {
                    mock_payment_enabled: true
                }
            },
            next: {
                paymentChannels: {
                    active_provider: 'afdian',
                    providers: {
                        mock: { enabled: false }
                    }
                },
                rechargeOptions: {
                    mock_payment_enabled: false
                }
            }
        },
        runtime: {
            allowed: false,
            reason: 'production_like_runtime'
        }
    });

    assert.match(report, /mode: execute/);
    assert.match(report, /target_provider: afdian/);
    assert.match(report, /target_ready: no/);
    assert.match(report, /current/);
    assert.match(report, /next/);
    assert.match(report, /mock_reason: production_like_runtime/);
});
