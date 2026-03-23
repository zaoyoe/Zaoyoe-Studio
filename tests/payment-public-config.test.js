const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildPublicPaymentConfig
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
                    merchant_id: ''
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
});
