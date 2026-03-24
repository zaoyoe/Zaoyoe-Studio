const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

function createMockResponse() {
    const state = {
        statusCode: 200,
        headers: {},
        body: ''
    };

    return {
        status(code) {
            state.statusCode = code;
            return this;
        },
        setHeader(name, value) {
            state.headers[String(name).toLowerCase()] = value;
            return this;
        },
        end(payload = '') {
            state.body = String(payload || '');
            return this;
        },
        json() {
            return state.body ? JSON.parse(state.body) : {};
        },
        get statusCode() {
            return state.statusCode;
        }
    };
}

async function withEnv(patch, callback) {
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
        return await callback();
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

async function withConfigHandler({
    adminModule,
    requestSecurityModule = null,
    ordersModule = null
}, callback) {
    const handlerPath = path.resolve(__dirname, '../api/payments/config.js');
    const originalLoad = Module._load;
    const resolvedAdminModule = {
        getOptionalSupabaseAdmin() {
            return typeof adminModule.getOptionalSupabaseAdmin === 'function'
                ? adminModule.getOptionalSupabaseAdmin()
                : null;
        },
        ...adminModule
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../_lib/admin') {
            return resolvedAdminModule;
        }

        if (request === '../_lib/request-security' && requestSecurityModule) {
            return requestSecurityModule;
        }

        if (request === '../_lib/payments/orders' && ordersModule) {
            return ordersModule;
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    let handler;
    try {
        handler = require(handlerPath);
    } finally {
        Module._load = originalLoad;
    }

    try {
        return await callback(handler);
    } finally {
        delete require.cache[handlerPath];
    }
}

test('payment config endpoint strips provider operational fields and runtime override metadata', async () => {
    const supabase = {
        from(table) {
            assert.equal(table, 'system_config');
            return {
                select() {
                    return this;
                },
                in(column, values) {
                    assert.equal(column, 'config_key');
                    assert.deepEqual(values, ['payment_channels', 'recharge_options']);
                    return Promise.resolve({
                        data: [
                            {
                                config_key: 'payment_channels',
                                config_value: {
                                    active_provider: 'hupijiao',
                                    providers: {
                                        mock: {
                                            enabled: true,
                                            display_name: '模拟支付',
                                            description: '仅允许本地开发'
                                        },
                                        afdian: {
                                            enabled: true,
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
                                            return_url: 'https://www.zaoyoe.com/wallet',
                                            package_hint: '正式支付',
                                            custom_amount_hint: '支持自定义金额'
                                        }
                                    }
                                }
                            },
                            {
                                config_key: 'recharge_options',
                                config_value: {
                                    custom_amount_enabled: true,
                                    mock_payment_enabled: true
                                }
                            }
                        ],
                        error: null
                    });
                }
            };
        }
    };

    await withEnv({
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key'
    }, async () => {
        await withConfigHandler({
            adminModule: {
                getSupabaseAdmin() {
                    return supabase;
                },
                getOptionalSupabaseAdmin() {
                    return supabase;
                },
                getSupabasePublicClient() {
                    return supabase;
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                }
            },
            requestSecurityModule: {
                resolveClientIp() {
                    return '203.0.113.8';
                },
                async takeRateLimitToken() {
                    return {
                        allowed: true,
                        limit: 120,
                        remaining: 119,
                        resetAt: Date.now() + 60_000
                    };
                },
                applyRateLimitHeaders() {}
            },
            ordersModule: {
                getMockPaymentRuntimeState() {
                    return {
                        allowed: false,
                        reason: 'production_like_runtime',
                        message: '当前站点运行在生产环境，服务端默认禁用模拟支付；如需临时测试，建议设置 ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL 后重新部署。',
                        override_env_name: 'ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL',
                        override_mode: 'until',
                        cleanup_message: '环境变量仍存在但当前未启用，需移除 vercel 的环境变量 ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL'
                    };
                }
            }
        }, async (handler) => {
            const req = {
                method: 'GET',
                headers: {
                    host: 'www.zaoyoe.com'
                }
            };
            const res = createMockResponse();

            await handler(req, res);
            const payload = res.json();

            assert.equal(res.statusCode, 200);
            assert.equal(payload.success, true);
            assert.equal(payload.runtime.mock_payment.allowed, false);
            assert.equal(payload.runtime.mock_payment.reason, 'production_like_runtime');
            assert.equal(payload.runtime.mock_payment.message, '当前环境暂未开放模拟支付。');
            assert.equal('override_env_name' in payload.runtime.mock_payment, false);
            assert.equal('override_mode' in payload.runtime.mock_payment, false);
            assert.equal('cleanup_message' in payload.runtime.mock_payment, false);
            assert.equal(payload.config.providers.hupijiao.display_name, '虎皮椒');
            assert.equal(payload.config.providers.hupijiao.checkout_url, 'https://pay.example.com/public');
            assert.equal(payload.config.providers.hupijiao.package_hint, '正式支付');
            assert.equal(payload.config.providers.hupijiao.custom_amount_hint, '支持自定义金额');
            assert.equal('gateway_url' in payload.config.providers.hupijiao, false);
            assert.equal('merchant_id' in payload.config.providers.hupijiao, false);
            assert.equal('notify_url' in payload.config.providers.hupijiao, false);
            assert.equal('return_url' in payload.config.providers.hupijiao, false);
        });
    });
});
