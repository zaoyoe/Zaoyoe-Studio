const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildZpayMapiPayload,
    buildZpayOrderQueryPayload,
    buildZpayOutTradeNo,
    buildZpayParam,
    buildZpayRefundPayload,
    buildZpaySign,
    createZpayPayment,
    normalizeZpayConfig,
    parseZpayParam,
    refundZpayPayment,
    requestZpayJson,
    verifyZpaySign
} = require('../api/_lib/payments/zpay');

test('normalizeZpayConfig derives official endpoint urls and reports missing fields', () => {
    const config = normalizeZpayConfig({
        channelConfig: {
            pid: 'pid-123',
            checkout_url: 'https://zpayz.cn/',
            notify_url: 'https://www.zaoyoe.com/api/payments/zpay/webhook',
            return_url: 'https://www.zaoyoe.com/wallet',
            payment_type: 'wxpay'
        },
        secretValues: {
            zpay_pkey: 'pkey-123'
        },
        requestOrigin: 'https://www.zaoyoe.com'
    });

    assert.equal(config.pid, 'pid-123');
    assert.equal(config.mapiUrl, 'https://zpayz.cn/mapi.php');
    assert.equal(config.apiUrl, 'https://zpayz.cn/api.php');
    assert.equal(config.refundUrl, 'https://zpayz.cn/api.php?act=refund');
    assert.equal(config.paymentType, 'wxpay');
    assert.equal(config.createReady, true);
    assert.deepEqual(config.missingFields, []);
});

test('normalizeZpayConfig rewrites managed notify and return urls onto the intl site origin', () => {
    const config = normalizeZpayConfig({
        channelConfig: {
            pid: 'pid-123',
            checkout_url: 'https://zpayz.cn/',
            notify_url: 'https://www.zaoyoe.com/api/payments/zpay/webhook',
            return_url: 'https://www.zaoyoe.com/wallet'
        },
        secretValues: {
            zpay_pkey: 'pkey-123'
        },
        requestOrigin: 'https://www.zaoyoe.xyz'
    });

    assert.equal(config.notifyUrl, 'https://www.zaoyoe.xyz/api/payments/zpay/webhook');
    assert.equal(config.returnUrl, 'https://www.zaoyoe.xyz/wallet');
    assert.equal(config.createReady, true);
});

test('buildZpaySign ignores empty fields and the sign/sign_type keys', () => {
    const payload = {
        pid: 'pid-123',
        out_trade_no: 'ZPORDER001',
        money: '8.80',
        sign: 'ignore-me',
        sign_type: 'MD5',
        param: ''
    };

    const sign = buildZpaySign(payload, 'demo-key');
    assert.equal(sign.length, 32);
    assert.deepEqual(
        verifyZpaySign({
            ...payload,
            sign
        }, 'demo-key'),
        {
            valid: true,
            expectedSign: sign,
            receivedSign: sign
        }
    );
});

test('buildZpayOutTradeNo stays within the official 32-char limit', () => {
    const outTradeNo = buildZpayOutTradeNo('PCS_ZPAY_1742709999999_AB12CD34');
    assert.match(outTradeNo, /^ZP[A-Z0-9]{30}$/);
    assert.ok(outTradeNo.length <= 32);
});

test('buildZpayParam round-trips compact attach payloads', () => {
    const encoded = buildZpayParam({
        checkout_session_key: 'PCS_ZP_1',
        granted_points: 110
    });

    assert.match(encoded, /^zp1\./);
    assert.deepEqual(parseZpayParam(encoded), {
        checkout_session_key: 'PCS_ZP_1',
        granted_points: 110
    });
});

test('buildZpayMapiPayload and follow-up payloads match the documented field names', () => {
    const config = normalizeZpayConfig({
        channelConfig: {
            pid: 'pid-123',
            checkout_url: 'https://zpayz.cn',
            notify_url: 'https://www.zaoyoe.com/api/payments/zpay/webhook',
            return_url: 'https://www.zaoyoe.com/wallet',
            payment_type: 'alipay',
            channel_ids: '123,456'
        },
        secretValues: {
            zpay_pkey: 'pkey-123'
        }
    });

    const paymentPayload = buildZpayMapiPayload({
        config,
        outTradeNo: 'ZPORDER001',
        amount: 9.9,
        name: '测试支付',
        clientIp: '203.0.113.8',
        device: 'mobile',
        param: buildZpayParam({
            checkout_session_key: 'PCS_ZP_1'
        })
    });
    assert.equal(paymentPayload.pid, 'pid-123');
    assert.equal(paymentPayload.type, 'alipay');
    assert.equal(paymentPayload.out_trade_no, 'ZPORDER001');
    assert.equal(paymentPayload.money, '9.90');
    assert.equal(paymentPayload.clientip, '203.0.113.8');
    assert.equal(paymentPayload.device, 'mobile');
    assert.equal(paymentPayload.cid, '123,456');
    assert.equal(paymentPayload.sign_type, 'MD5');
    assert.equal(paymentPayload.sign, buildZpaySign(paymentPayload, 'pkey-123'));

    const queryPayload = buildZpayOrderQueryPayload({
        config,
        outTradeNo: 'ZPORDER001'
    });
    assert.equal(queryPayload.act, 'order');
    assert.equal(queryPayload.out_trade_no, 'ZPORDER001');
    assert.equal(queryPayload.key, 'pkey-123');

    const refundPayload = buildZpayRefundPayload({
        config,
        outTradeNo: 'ZPORDER001',
        money: 9.9
    });
    assert.equal(Object.prototype.hasOwnProperty.call(refundPayload, 'act'), false);
    assert.equal(refundPayload.out_trade_no, 'ZPORDER001');
    assert.equal(refundPayload.money, '9.90');
});

test('buildZpay query and refund payloads prefer out_trade_no when both order ids are present', () => {
    const config = normalizeZpayConfig({
        channelConfig: {
            pid: 'pid-123',
            checkout_url: 'https://zpayz.cn',
            notify_url: 'https://www.zaoyoe.com/api/payments/zpay/webhook'
        },
        secretValues: {
            zpay_pkey: 'pkey-123'
        }
    });

    const queryPayload = buildZpayOrderQueryPayload({
        config,
        outTradeNo: 'ZPORDER001',
        tradeNo: 'TRADE001'
    });
    assert.equal(queryPayload.out_trade_no, 'ZPORDER001');
    assert.equal(Object.prototype.hasOwnProperty.call(queryPayload, 'trade_no'), false);

    const refundPayload = buildZpayRefundPayload({
        config,
        outTradeNo: 'ZPORDER001',
        tradeNo: 'TRADE001',
        money: 9.9
    });
    assert.equal(refundPayload.out_trade_no, 'ZPORDER001');
    assert.equal(Object.prototype.hasOwnProperty.call(refundPayload, 'trade_no'), false);
});

test('normalizeZpayPaymentStatus maps refunded status values', () => {
    assert.equal(require('../api/_lib/payments/zpay').normalizeZpayPaymentStatus('', 2), 'refunded');
    assert.equal(require('../api/_lib/payments/zpay').normalizeZpayPaymentStatus('REFUNDED', null), 'refunded');
});

test('createZpayPayment posts form data to the mapi endpoint', async () => {
    const result = await createZpayPayment({
        channelConfig: {
            pid: 'pid-123',
            checkout_url: 'https://zpayz.cn',
            notify_url: 'https://www.zaoyoe.com/api/payments/zpay/webhook',
            return_url: 'https://www.zaoyoe.com/wallet',
            payment_type: 'alipay'
        },
        secretValues: {
            zpay_pkey: 'pkey-123'
        },
        outTradeNo: 'ZPORDER001',
        amount: 9.9,
        name: '测试支付',
        clientIp: '203.0.113.8',
        device: 'pc'
    }, {
        fetchImpl: async (url, request) => {
            assert.equal(url, 'https://zpayz.cn/mapi.php');
            assert.match(String(request.body || ''), /out_trade_no=ZPORDER001/);
            assert.match(String(request.body || ''), /clientip=203\.0\.113\.8/);

            return {
                ok: true,
                status: 200,
                statusText: 'OK',
                async text() {
                    return JSON.stringify({
                        code: 1,
                        msg: 'success',
                        trade_no: 'TRADE_001',
                        O_id: 'OID_001',
                        payurl: 'https://zpayz.cn/pay/demo/1'
                    });
                }
            };
        }
    });

    assert.equal(result.response.data.payurl, 'https://zpayz.cn/pay/demo/1');
    assert.equal(result.requestPayload.out_trade_no, 'ZPORDER001');
});

test('refundZpayPayment posts refund fields to the documented act=refund endpoint', async () => {
    const result = await refundZpayPayment({
        channelConfig: {
            pid: 'pid-123',
            checkout_url: 'https://zpayz.cn',
            notify_url: 'https://www.zaoyoe.com/api/payments/zpay/webhook'
        },
        secretValues: {
            zpay_pkey: 'pkey-123'
        },
        outTradeNo: 'ZPORDER001',
        money: 9.9
    }, {
        fetchImpl: async (url, request) => {
            assert.equal(url, 'https://zpayz.cn/api.php?act=refund');
            assert.equal(request.method, 'POST');
            assert.match(String(request.body || ''), /pid=pid-123/);
            assert.match(String(request.body || ''), /out_trade_no=ZPORDER001/);
            assert.match(String(request.body || ''), /money=9\.90/);
            assert.doesNotMatch(String(request.body || ''), /(?:^|&)act=refund(?:&|$)/);

            return {
                ok: true,
                status: 200,
                statusText: 'OK',
                async text() {
                    return JSON.stringify({
                        code: 1,
                        msg: '退款成功',
                        out_trade_no: 'ZPORDER001',
                        trade_no: 'TRADE_001',
                        status: 2
                    });
                }
            };
        }
    });

    assert.equal(result.requestPayload.out_trade_no, 'ZPORDER001');
    assert.equal(result.response.data.code, 1);
});

test('requestZpayJson wraps upstream fetch failures with a friendly message', async () => {
    await assert.rejects(
        requestZpayJson('https://zpayz.cn/api.php', { act: 'order' }, {
            fetchImpl: async () => {
                throw new Error('fetch failed');
            }
        }),
        /易支付网关请求失败，请稍后重试/
    );
});

test('refundZpayPayment surfaces empty-body responses as a safe manual-check prompt', async () => {
    await assert.rejects(
        refundZpayPayment({
            channelConfig: {
                pid: 'pid-123',
                checkout_url: 'https://zpayz.cn',
                notify_url: 'https://www.zaoyoe.com/api/payments/zpay/webhook'
            },
            secretValues: {
                zpay_pkey: 'pkey-123'
            },
            outTradeNo: 'ZPORDER001',
            money: 9.9
        }, {
            fetchImpl: async () => ({
                ok: true,
                status: 200,
                statusText: 'OK',
                async text() {
                    return '';
                }
            })
        }),
        /易支付退款接口返回空响应，请先到易支付后台确认是否已退款，避免重复提交/
    );
});
