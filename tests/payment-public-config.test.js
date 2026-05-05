const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildPublicPaymentConfig,
    buildPublicPaymentRuntime
} = require('../api/_lib/payments/providers');

test('public payment config hides mock when runtime blocks remote mock payments', () => {
    const result = buildPublicPaymentConfig(
        {
            active_provider: 'mock',
            providers: {
                mock: {
                    enabled: true,
                    display_name: '模拟支付'
                },
                afdian: {
                    enabled: false,
                    display_name: '爱发电',
                    checkout_url: 'https://afdian.com/a/zaoyoe'
                },
                hupijiao: {
                    enabled: false,
                    display_name: '虎皮椒',
                    checkout_url: '',
                    gateway_url: '',
                    merchant_id: '',
                    notify_url: 'https://verify.example.com/webhook',
                    return_url: 'https://www.zaoyoe.com/wallet'
                }
            }
        },
        {
            custom_amount_enabled: true,
            mock_payment_enabled: true
        },
        {
            mock_payment: {
                allowed: false,
                reason: 'production_like_runtime'
            }
        }
    );

    assert.equal(result.paymentChannels.active_provider, 'afdian');
    assert.equal(result.paymentChannels.providers.mock.enabled, false);
    assert.equal(result.rechargeOptions.mock_payment_enabled, false);
    assert.equal(result.rechargeOptions.custom_amount_enabled, true);
    assert.equal(result.rechargeOptions.custom_amount_min_points, 0.01);
    assert.equal(result.rechargeOptions.custom_amount_step, 0.01);
    assert.equal(result.rechargeOptions.custom_amount_points_per_cny, 1);
    assert.equal('gateway_url' in result.paymentChannels.providers.hupijiao, false);
    assert.equal('merchant_id' in result.paymentChannels.providers.hupijiao, false);
    assert.equal('notify_url' in result.paymentChannels.providers.hupijiao, false);
    assert.equal('return_url' in result.paymentChannels.providers.hupijiao, false);
});

test('public payment config preserves mock when runtime explicitly allows it', () => {
    const result = buildPublicPaymentConfig(
        {
            active_provider: 'mock',
            providers: {
                mock: {
                    enabled: true,
                    display_name: '模拟支付'
                },
                afdian: {
                    enabled: false,
                    display_name: '爱发电',
                    checkout_url: 'https://afdian.com/a/zaoyoe'
                },
                hupijiao: {
                    enabled: true,
                    display_name: '虎皮椒',
                    checkout_url: 'https://pay.example.com/public',
                    gateway_url: 'https://api.xunhupay.com/payment/do.html',
                    merchant_id: 'appid-demo',
                    notify_url: 'https://verify.example.com/webhook',
                    return_url: 'https://www.zaoyoe.com/wallet'
                }
            }
        },
        {
            custom_amount_enabled: true,
            mock_payment_enabled: true
        },
        {
            mock_payment: {
                allowed: true,
                reason: 'remote_whitelist_until_enabled'
            }
        }
    );

    assert.equal(result.paymentChannels.active_provider, 'mock');
    assert.equal(result.paymentChannels.providers.mock.enabled, true);
    assert.equal(result.rechargeOptions.mock_payment_enabled, true);
    assert.equal('gateway_url' in result.paymentChannels.providers.hupijiao, false);
    assert.equal('merchant_id' in result.paymentChannels.providers.hupijiao, false);
    assert.equal('notify_url' in result.paymentChannels.providers.hupijiao, false);
    assert.equal('return_url' in result.paymentChannels.providers.hupijiao, false);
});

test('public payment config normalizes legacy recharge ratios to the unified 1:1 currency model', () => {
    const result = buildPublicPaymentConfig(
        {
            active_provider: 'zpay',
            providers: {
                mock: { enabled: false, display_name: '模拟支付' },
                afdian: { enabled: false, display_name: '爱发电', checkout_url: 'https://afdian.com/a/zaoyoe' },
                hupijiao: { enabled: false, display_name: '虎皮椒', checkout_url: '' },
                zpay: { enabled: true, display_name: '易支付', checkout_url: 'https://zpayz.cn' }
            }
        },
        {
            custom_amount_enabled: true,
            mock_payment_enabled: false,
            custom_amount_min_points: 1,
            custom_amount_step: 1,
            custom_amount_points_per_cny: 50,
            custom_amount_max_points: 1234
        },
        {
            mock_payment: {
                allowed: false,
                reason: 'production_like_runtime'
            }
        }
    );

    assert.equal(result.rechargeOptions.custom_amount_min_points, 0.01);
    assert.equal(result.rechargeOptions.custom_amount_step, 0.01);
    assert.equal(result.rechargeOptions.custom_amount_points_per_cny, 1);
    assert.equal(result.rechargeOptions.custom_amount_max_points, 1234);
});

test('public payment config exposes only safe surcharge settings for enabled channels', () => {
    const result = buildPublicPaymentConfig(
        {
            active_provider: 'zpay',
            providers: {
                mock: { enabled: false, display_name: '模拟支付' },
                afdian: { enabled: false, display_name: '爱发电', checkout_url: 'https://afdian.com/a/zaoyoe' },
                zpay: {
                    enabled: true,
                    display_name: '易支付',
                    checkout_url: 'https://zpayz.cn',
                    pid: 'merchant-id',
                    notify_url: 'https://verify.example.com/payments/zpay/webhook',
                    surcharge_rate: 0.0125,
                    surcharge_label: '支付通道费'
                },
                nowpayments: {
                    enabled: true,
                    display_name: 'USDT-BEP20',
                    api_base_url: 'https://api.nowpayments.io',
                    pay_currency: 'usdtbsc',
                    network_name: 'BNB Smart Chain',
                    cny_to_usd_rate: 0.1425,
                    pay_amount_precision: 2,
                    surcharge_rate: 0.01,
                    surcharge_label: '链路手续费',
                    is_fee_paid_by_user: true
                }
            }
        },
        {
            custom_amount_enabled: true,
            mock_payment_enabled: false
        },
        {
            mock_payment: {
                allowed: false,
                reason: 'production_like_runtime'
            }
        }
    );

    assert.equal(result.paymentChannels.providers.zpay.surcharge_rate, 0.0125);
    assert.equal(result.paymentChannels.providers.zpay.surcharge_label, '支付通道费');
    assert.equal('pid' in result.paymentChannels.providers.zpay, false);
    assert.equal('notify_url' in result.paymentChannels.providers.zpay, false);
    assert.equal(result.paymentChannels.providers.nowpayments.surcharge_rate, 0.01);
    assert.equal(result.paymentChannels.providers.nowpayments.surcharge_label, '链路手续费');
    assert.equal(result.paymentChannels.providers.nowpayments.is_fee_paid_by_user, true);
    assert.equal(result.paymentChannels.providers.nowpayments.cny_to_usd_rate, 0.1425);
    assert.equal(result.paymentChannels.providers.nowpayments.pay_amount_precision, 2);
    assert.equal('api_base_url' in result.paymentChannels.providers.nowpayments, false);
});

test('public payment config does not auto-promote hupijiao from partial gateway config while afdian remains available', () => {
    const result = buildPublicPaymentConfig(
        {
            active_provider: 'mock',
            providers: {
                mock: {
                    enabled: true,
                    display_name: '模拟支付'
                },
                afdian: {
                    enabled: true,
                    display_name: '爱发电',
                    checkout_url: 'https://afdian.com/a/zaoyoe'
                },
                hupijiao: {
                    enabled: true,
                    display_name: '虎皮椒',
                    gateway_url: 'https://api.xunhupay.com/payment/do.html',
                    merchant_id: 'appid-demo'
                }
            }
        },
        {
            custom_amount_enabled: true,
            mock_payment_enabled: true
        },
        {
            mock_payment: {
                allowed: false,
                reason: 'production_like_runtime'
            }
        }
    );

    assert.equal(result.paymentChannels.active_provider, 'afdian');
    assert.equal('gateway_url' in result.paymentChannels.providers.hupijiao, false);
    assert.equal('merchant_id' in result.paymentChannels.providers.hupijiao, false);
});

test('public payment config keeps provider-driven manual order query fields for legacy claim flows', () => {
    const result = buildPublicPaymentConfig(
        {
            active_provider: 'afdian',
            providers: {
                mock: {
                    enabled: false,
                    display_name: '模拟支付'
                },
                afdian: {
                    enabled: true,
                    display_name: '爱发电',
                    checkout_url: 'https://afdian.com/a/zaoyoe',
                    order_query_enabled: true,
                    order_query_title: '订单号认领',
                    order_query_hint: '完成支付后，可在这里输入订单号查询兑换结果。',
                    order_query_placeholder: '输入支付平台订单号'
                },
                hupijiao: {
                    enabled: true,
                    display_name: '虎皮椒',
                    checkout_url: '',
                    gateway_url: 'https://api.xunhupay.com/payment/do.html',
                    merchant_id: 'appid-demo'
                }
            }
        },
        {
            custom_amount_enabled: true,
            mock_payment_enabled: false
        },
        {
            mock_payment: {
                allowed: false,
                reason: 'production_like_runtime'
            }
        }
    );

    assert.equal(result.paymentChannels.providers.afdian.order_query_enabled, true);
    assert.equal(result.paymentChannels.providers.afdian.order_query_title, '订单号认领');
    assert.equal(result.paymentChannels.providers.afdian.order_query_hint, '完成支付后，可在这里输入订单号查询兑换结果。');
    assert.equal(result.paymentChannels.providers.afdian.order_query_placeholder, '输入支付平台订单号');
});

test('public payment config exposes zpay safely without leaking operational fields', () => {
    const result = buildPublicPaymentConfig(
        {
            active_provider: 'zpay',
            providers: {
                mock: {
                    enabled: false,
                    display_name: '模拟支付'
                },
                afdian: {
                    enabled: false,
                    display_name: '爱发电',
                    checkout_url: 'https://afdian.com/a/zaoyoe'
                },
                hupijiao: {
                    enabled: false,
                    display_name: '虎皮椒',
                    checkout_url: ''
                },
                zpay: {
                    enabled: true,
                    display_name: '易支付',
                    checkout_url: 'https://zpayz.cn',
                    pid: 'pid-123',
                    notify_url: 'https://verify.example.com/api/payments/zpay/webhook',
                    return_url: 'https://www.zaoyoe.com/wallet',
                    package_hint: '创建订单后直接支付',
                    custom_amount_hint: '创建自定义金额订单后直接支付'
                }
            }
        },
        {
            custom_amount_enabled: true,
            mock_payment_enabled: false
        },
        {
            mock_payment: {
                allowed: false,
                reason: 'production_like_runtime'
            }
        }
    );

    assert.equal(result.paymentChannels.active_provider, 'zpay');
    assert.equal(result.paymentChannels.providers.zpay.display_name, '易支付');
    assert.equal(result.paymentChannels.providers.zpay.checkout_url, 'https://zpayz.cn');
    assert.equal(result.paymentChannels.providers.zpay.package_hint, '创建订单后直接支付');
    assert.equal(result.paymentChannels.providers.zpay.custom_amount_hint, '创建自定义金额订单后直接支付');
    assert.equal('pid' in result.paymentChannels.providers.zpay, false);
    assert.equal('notify_url' in result.paymentChannels.providers.zpay, false);
    assert.equal('return_url' in result.paymentChannels.providers.zpay, false);
});

test('public payment runtime strips operational override metadata and env hints', () => {
    const runtime = buildPublicPaymentRuntime({
        mock_payment: {
            allowed: false,
            reason: 'production_like_runtime',
            message: '当前站点运行在生产环境，服务端默认禁用模拟支付；如需临时测试，建议设置 ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL 后重新部署。',
            override_env_name: 'ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL',
            override_mode: 'until',
            cleanup_message: '环境变量仍存在但当前未启用，需移除 vercel 的环境变量 ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL'
        }
    });

    assert.deepEqual(runtime, {
        mock_payment: {
            allowed: false,
            reason: 'production_like_runtime',
            message: '当前环境暂未开放模拟支付。'
        }
    });
});
