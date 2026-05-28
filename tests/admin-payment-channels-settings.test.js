const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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

async function withPaymentChannelsHandler(state, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/settings/payment-channels.js');
    const originalLoad = Module._load;
    const providersPath = path.resolve(__dirname, '../api/_lib/payments/providers.js');
    const secretsPath = path.resolve(__dirname, '../api/_lib/secrets.js');
    const actualProvidersModule = require(providersPath);
    const actualSecretsModule = require(secretsPath);

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                normalizeAdminSite(value, options = {}) {
                    const normalized = String(value || '').trim().toLowerCase();
                    if (normalized === 'cn' || normalized === 'intl' || normalized === 'all') {
                        return normalized;
                    }
                    return options.defaultValue || '';
                },
                requireWritableAdminSite(value, options = {}) {
                    const normalized = String(value || '').trim().toLowerCase();
                    if (normalized === 'cn' || normalized === 'intl') {
                        return normalized;
                    }
                    const error = new Error(options.message || 'Writable admin site is required');
                    error.statusCode = 400;
                    throw error;
                },
                async requireAdmin() {
                    return {
                        supabase: state.supabase,
                        user: { id: 'admin-1', email: 'admin@example.com' }
                    };
                },
                async parseJsonBody(req) {
                    return req.body || {};
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                },
                async writeAdminAuditLog(entry) {
                    state.auditLogs.push(entry);
                }
            };
        }

        if (request === '../../../../api/_lib/payments/providers') {
            return {
                ...actualProvidersModule,
                ...(state.providersModule || {})
            };
        }

        if (request === '../../../../api/_lib/secrets') {
            return {
                ...actualSecretsModule,
                ...(state.secretsModule || {})
            };
        }

        if (request === '../../../../api/_lib/payments/orders') {
            return {
                getMockPaymentRuntimeState() {
                    return state.mockRuntime || { allowed: false, reason: 'production_like_runtime' };
                }
            };
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

function createSupabaseStub(state) {
    state.savedConfigs = [];

    return {
        from(table) {
            if (table !== 'system_config') {
                throw new Error(`Unexpected table access: ${table}`);
            }

            return {
                select() {
                    return this;
                },
                eq() {
                    return this;
                },
                maybeSingle() {
                    return Promise.resolve({
                        data: null,
                        error: { code: 'PGRST116' }
                    });
                },
                upsert(payload) {
                    state.savedConfigs.push(payload);
                    return Promise.resolve({ error: null });
                }
            };
        }
    };
}

test('payment channel settings allow switching zpay to primary without webhook allowlist while surfacing strict-query guidance', async () => {
    const state = {
        auditLogs: [],
        savedSecrets: [],
        mockRuntime: {
            allowed: false,
            reason: 'production_like_runtime'
        }
    };
    state.supabase = createSupabaseStub(state);
    let secretStatusCallCount = 0;
    state.providersModule = {
        async loadStoredPaymentConfigs() {
            return {
                rechargeOptions: {
                    custom_amount_enabled: true,
                    mock_payment_enabled: false
                }
            };
        },
        async buildPaymentSecretStatus() {
            secretStatusCallCount += 1;
            return {
                afdian_token: { configured: false },
                zpay_pkey: { configured: secretStatusCallCount > 1, source: secretStatusCallCount > 1 ? 'stored' : 'missing' },
                hupijiao_api_key: { configured: false },
                hupijiao_secret_key: { configured: false }
            };
        }
    };
    state.secretsModule = {
        async upsertStoredAdminSecret(payload) {
            state.savedSecrets.push(payload);
        }
    };

    await withEnv({
        DEPLOYMENT_TIER: 'production',
        ZPAY_WEBHOOK_ALLOWED_IPS: undefined
    }, async () => {
        await withPaymentChannelsHandler(state, async (handler) => {
            const req = {
                method: 'POST',
                headers: {
                    host: 'www.fatherkey.com'
                },
                body: {
                    site: 'cn',
                    config: {
                        active_provider: 'zpay',
                        providers: {
                            zpay: {
                                enabled: true,
                                display_name: '易支付',
                                checkout_url: 'https://zpayz.cn',
                                pid: '2026041807323142',
                                payment_type: 'alipay',
                                return_url: 'https://www.fatherkey.com/wallet'
                            }
                        }
                    },
                    secrets: {
                        zpay_pkey: 'strict-query-mode-pkey'
                    }
                }
            };
            const res = createMockResponse();

            await handler(req, res);
            const payload = res.json();

            assert.equal(res.statusCode, 200);
            assert.equal(payload.success, true);
            assert.match(payload.message, /严格查单模式/);
            assert.match(payload.message, /ZPAY_WEBHOOK_ALLOWED_IPS/);
            assert.doesNotMatch(payload.message, /notify_url/);
            assert.equal(payload.activation_checks.zpay.ready, true);
            assert.match(payload.activation_checks.zpay.warnings.join('；'), /严格查单模式/);
            assert.equal(state.savedConfigs.length, 2);
            assert.equal(state.savedSecrets.length, 1);
            assert.equal(state.auditLogs.length, 1);
            assert.deepEqual(state.auditLogs[0].details.activation_issues, []);
            assert.match((state.auditLogs[0].details.activation_warnings || []).join('；'), /严格查单模式/);
        });
    });
});

test('payment channel settings allow switching zpay to primary after incoming pkey and webhook allowlist are present', async () => {
    const state = {
        auditLogs: [],
        savedSecrets: [],
        mockRuntime: {
            allowed: false,
            reason: 'production_like_runtime'
        }
    };
    state.supabase = createSupabaseStub(state);
    let secretStatusCallCount = 0;
    state.providersModule = {
        async loadStoredPaymentConfigs() {
            return {
                rechargeOptions: {
                    custom_amount_enabled: true,
                    mock_payment_enabled: false
                }
            };
        },
        async buildPaymentSecretStatus() {
            secretStatusCallCount += 1;
            return {
                afdian_token: { configured: false },
                zpay_pkey: { configured: secretStatusCallCount > 1, source: secretStatusCallCount > 1 ? 'stored' : 'missing' },
                hupijiao_api_key: { configured: false },
                hupijiao_secret_key: { configured: false }
            };
        }
    };
    state.secretsModule = {
        async upsertStoredAdminSecret(payload) {
            state.savedSecrets.push(payload);
        }
    };

    await withEnv({
        DEPLOYMENT_TIER: 'production',
        ZPAY_WEBHOOK_ALLOWED_IPS: '203.0.113.0/24'
    }, async () => {
        await withPaymentChannelsHandler(state, async (handler) => {
            const req = {
                method: 'POST',
                headers: {
                    host: 'www.fatherkey.com'
                },
                body: {
                    site: 'intl',
                    config: {
                        active_provider: 'zpay',
                        providers: {
                            zpay: {
                                enabled: true,
                                display_name: '易支付',
                                checkout_url: 'https://zpayz.cn',
                                pid: '2026041807323142',
                                payment_type: 'alipay',
                                return_url: 'https://www.fatherkey.com/wallet'
                            }
                        }
                    },
                    secrets: {
                        zpay_pkey: 'fresh-zpay-pkey'
                    }
                }
            };
            const res = createMockResponse();

            await handler(req, res);
            const payload = res.json();

            assert.equal(res.statusCode, 200);
            assert.equal(payload.success, true);
            assert.equal(payload.config.active_provider, 'zpay');
            assert.equal(payload.activation_checks.zpay.ready, true);
            assert.deepEqual(payload.activation_checks.zpay.warnings, []);
            assert.equal(state.savedConfigs.length, 2);
            assert.equal(state.savedSecrets.length, 1);
            assert.equal(state.savedSecrets[0].secretKey, 'payment_provider_zpay_pkey__intl');
            assert.equal(state.auditLogs.length, 1);
            assert.equal(state.auditLogs[0].actionType, 'admin.payment_channels.upsert');
            assert.equal(state.auditLogs[0].details.site, 'intl');
            assert.deepEqual(state.auditLogs[0].details.activation_issues, []);
            assert.deepEqual(state.auditLogs[0].details.activation_warnings, []);
        });
    });
});

test('admin payment channel form keeps surcharge fields when saving zpay and nowpayments', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../admin-studio.html'), 'utf8');
    const script = fs.readFileSync(path.resolve(__dirname, '../admin-config.js'), 'utf8');

    assert.match(html, /id="paymentProviderZpaySurchargeRate"/);
    assert.match(html, /id="paymentProviderNowpaymentsSurchargeRate"/);
    assert.match(script, /normalizePaymentChannelSurchargeRate\(value, fallback = 0\)/);
    assert.match(script, /paymentProviderZpaySurchargeRate/);
    assert.match(script, /paymentProviderNowpaymentsSurchargeRate/);
    assert.match(script, /surcharge_rate:\s*readSurchargeRate\('paymentProviderZpaySurchargeRate'/);
    assert.match(script, /surcharge_rate:\s*readSurchargeRate\('paymentProviderNowpaymentsSurchargeRate'/);
});
