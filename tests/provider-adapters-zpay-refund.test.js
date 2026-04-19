const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

async function withProviderAdaptersModule(overrides = {}, callback) {
    const modulePath = path.resolve(__dirname, '../api/_lib/payments/provider-adapters.js');
    const originalLoad = Module._load;

    delete require.cache[modulePath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === './zpay') {
            return overrides.zpayModule;
        }
        if (request === './providers') {
            return overrides.providersModule || {
                async loadStoredPaymentConfigs() {
                    return {
                        paymentChannels: {
                            providers: {
                                zpay: {}
                            }
                        }
                    };
                },
                async resolvePaymentProviderSecrets() {
                    return {};
                }
            };
        }
        if (request === './hupijiao') {
            return overrides.hupijiaoModule || {};
        }
        if (request === '../site') {
            return overrides.siteModule || {
                normalizeSiteValue(value = 'cn') {
                    return String(value || 'cn').trim().toLowerCase() || 'cn';
                }
            };
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        const providerAdapters = require(modulePath);
        return await callback(providerAdapters);
    } finally {
        Module._load = originalLoad;
        delete require.cache[modulePath];
    }
}

test('zpay refundOrder treats empty refund responses as success when follow-up query confirms refunded', async () => {
    let refundAttempted = 0;
    let queryAttempted = 0;

    await withProviderAdaptersModule({
        zpayModule: {
            normalizeZpayConfig({ channelConfig = {}, secretValues = {}, requestOrigin = '' } = {}) {
                return {
                    pid: channelConfig.pid || 'pid-123',
                    pkey: secretValues.zpay_pkey || 'pkey-123',
                    requestOrigin,
                    ...channelConfig
                };
            },
            normalizeZpayDevice(value = 'pc') {
                return value;
            },
            buildZpayOutTradeNo(value = '') {
                return value || 'ZPTEST001';
            },
            buildZpayParam(payload = {}) {
                return JSON.stringify(payload);
            },
            createZpayPayment() {
                throw new Error('not used');
            },
            async refundZpayPayment() {
                refundAttempted += 1;
                throw new Error('易支付退款接口返回空响应，请先到易支付后台确认是否已退款，避免重复提交');
            },
            async queryZpayPayment() {
                queryAttempted += 1;
                return {
                    response: {
                        data: {
                            code: 1,
                            msg: '查询订单号成功！',
                            out_trade_no: 'ZPORDER001',
                            trade_no: 'TRADE001',
                            status: 2,
                            money: '0.01'
                        }
                    }
                };
            },
            normalizeZpayPaymentStatus(tradeStatus = '', status = null) {
                if (Number(status) === 2) return 'refunded';
                return 'unknown';
            },
            verifyZpaySign() {
                return { valid: true };
            }
        }
    }, async ({ getPaymentProviderAdapter }) => {
        const adapter = getPaymentProviderAdapter('zpay');
        const result = await adapter.refundOrder({
            runtimeContext: {
                channelConfig: {
                    pid: 'pid-123',
                    checkout_url: 'https://zpayz.cn',
                    notify_url: 'https://www.zaoyoe.com/api/payments/zpay/webhook',
                    refund_confirmation_delays_ms: [0]
                },
                secretValues: {
                    zpay_pkey: 'pkey-123'
                },
                requestOrigin: 'https://www.zaoyoe.com'
            },
            providerOrderNo: 'ZPORDER001',
            tradeNo: 'TRADE001',
            money: 0.01
        });

        assert.equal(refundAttempted, 1);
        assert.equal(queryAttempted, 1);
        assert.equal(result.supported, true);
        assert.equal(result.success, true);
        assert.equal(result.status, 'refunded');
        assert.equal(result.tradeNo, 'TRADE001');
        assert.match(result.message, /查单已确认上游退款成功/);
    });
});

test('zpay refundOrder keeps the request fail-closed when follow-up polling still shows paid', async () => {
    let refundAttempted = 0;
    let queryAttempted = 0;

    await withProviderAdaptersModule({
        zpayModule: {
            normalizeZpayConfig({ channelConfig = {}, secretValues = {}, requestOrigin = '' } = {}) {
                return {
                    pid: channelConfig.pid || 'pid-123',
                    pkey: secretValues.zpay_pkey || 'pkey-123',
                    requestOrigin,
                    ...channelConfig
                };
            },
            normalizeZpayDevice(value = 'pc') {
                return value;
            },
            buildZpayOutTradeNo(value = '') {
                return value || 'ZPTEST001';
            },
            buildZpayParam(payload = {}) {
                return JSON.stringify(payload);
            },
            createZpayPayment() {
                throw new Error('not used');
            },
            async refundZpayPayment() {
                refundAttempted += 1;
                throw new Error('易支付退款接口返回空响应，请先到易支付后台确认是否已退款，避免重复提交');
            },
            async queryZpayPayment() {
                queryAttempted += 1;
                return {
                    response: {
                        data: {
                            code: 1,
                            msg: '查询订单号成功！',
                            out_trade_no: 'ZPORDER002',
                            trade_no: 'TRADE002',
                            status: 1,
                            money: '0.01'
                        }
                    }
                };
            },
            normalizeZpayPaymentStatus(tradeStatus = '', status = null) {
                if (Number(status) === 2) return 'refunded';
                if (Number(status) === 1) return 'paid';
                return 'unknown';
            },
            verifyZpaySign() {
                return { valid: true };
            }
        }
    }, async ({ getPaymentProviderAdapter }) => {
        const adapter = getPaymentProviderAdapter('zpay');

        await assert.rejects(
            () => adapter.refundOrder({
                runtimeContext: {
                    channelConfig: {
                        pid: 'pid-123',
                        checkout_url: 'https://zpayz.cn',
                        notify_url: 'https://www.zaoyoe.com/api/payments/zpay/webhook',
                        refund_confirmation_delays_ms: [0, 0]
                    },
                    secretValues: {
                        zpay_pkey: 'pkey-123'
                    },
                    requestOrigin: 'https://www.zaoyoe.com'
                },
                providerOrderNo: 'ZPORDER002',
                tradeNo: 'TRADE002',
                money: 0.01
            }),
            /轮询查单后仍显示已支付/
        );

        assert.equal(refundAttempted, 1);
        assert.equal(queryAttempted, 3);
    });
});
