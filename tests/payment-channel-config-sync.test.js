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

test('resolveTargetProvider prefers explicit provider and falls back to configured checkout links', () => {
    assert.equal(resolveTargetProvider({}, 'mock'), 'mock');
    assert.equal(resolveTargetProvider({}, 'hupijiao'), 'hupijiao');
    assert.equal(resolveTargetProvider({
        providers: {
            afdian: { checkout_url: 'https://afdian.com/a/zaoyoe' }
        }
    }), 'afdian');
    assert.equal(resolveTargetProvider({
        providers: {
            afdian: { checkout_url: '' },
            hupijiao: { gateway_url: 'https://pay.example.com' }
        }
    }), 'hupijiao');
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

test('getMockRuntimeForEnv recognizes a valid temporary override', () => {
    const runtime = getMockRuntimeForEnv({
        DEPLOYMENT_TIER: 'production',
        APP_BASE_URL: 'https://www.zaoyoe.com',
        ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL: '2026-03-28T23:59:59+08:00'
    });

    assert.equal(runtime.allowed, true);
    assert.equal(runtime.reason, 'remote_whitelist_until_enabled');
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
    assert.match(report, /current/);
    assert.match(report, /next/);
    assert.match(report, /mock_reason: production_like_runtime/);
});
