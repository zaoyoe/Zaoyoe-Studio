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
                    notify_url: 'https://www.fatherkey.com/api/payments/zpay/webhook',
                    refund_confirmation_delays_ms: [0]
                },
                secretValues: {
                    zpay_pkey: 'pkey-123'
                },
                requestOrigin: 'https://www.fatherkey.com'
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
                        notify_url: 'https://www.fatherkey.com/api/payments/zpay/webhook',
                        refund_confirmation_delays_ms: [0, 0]
                    },
                    secretValues: {
                        zpay_pkey: 'pkey-123'
                    },
                    requestOrigin: 'https://www.fatherkey.com'
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


for (const [money, expected] of [
    ['0.01', 0.01], ['12.34', 12.34], [12.34, 12.34], ['12.33', 12.33],
    ['12.3401', null], [12.3401, null], ['0', null], [0, null], ['', null],
    [null, null], [undefined, null], ['NaN', null], [NaN, null], [Infinity, null],
    ['-0.01', null], ['1e2', null], [true, null], ['9007199254740992', null]
]) test(`zpay real adapter preserves exact cents or rejects invalid money ${String(money)}`, async () => {
    await withProviderAdaptersModule({ zpayModule: {
        normalizeZpayConfig: () => ({ pid: 'fixture-pid', pkey: 'fixture-key' }),
        normalizeZpayPaymentStatus: () => 'paid',
        queryZpayPayment: async () => ({ response: { data: {
            code: 1, money, out_trade_no: 'ZP-QUERY', trade_no: 'TRADE-QUERY', status: 1
        } } })
    } }, async ({ getPaymentProviderAdapter }) => {
        const result = await getPaymentProviderAdapter('zpay').queryOrder({
            runtimeContext: {}, providerOrderNo: 'ZP-QUERY', tradeNo: 'TRADE-QUERY'
        });
        assert.equal(result.paidAmount, expected);
        assert.equal(result.providerOrderNo, 'ZP-QUERY');
        assert.equal(result.tradeNo, 'TRADE-QUERY');
    });
});
for (const missing of ['out_trade_no', 'trade_no']) test(`zpay real adapter does not substitute requested ${missing} for missing gateway evidence`, async () => {
    const payload = { code: 1, money: '0.01', out_trade_no: 'ZP-QUERY', trade_no: 'TRADE-QUERY', status: 1 };
    delete payload[missing];
    await withProviderAdaptersModule({ zpayModule: {
        normalizeZpayConfig: () => ({ pid: 'fixture-pid', pkey: 'fixture-key' }),
        normalizeZpayPaymentStatus: () => 'paid',
        queryZpayPayment: async () => ({ response: { data: payload } })
    } }, async ({ getPaymentProviderAdapter }) => {
        const result = await getPaymentProviderAdapter('zpay').queryOrder({
            runtimeContext: {}, providerOrderNo: 'ZP-QUERY', tradeNo: 'TRADE-QUERY'
        });
        assert.equal(result[missing === 'out_trade_no' ? 'providerOrderNo' : 'tradeNo'], null);
    });
});
