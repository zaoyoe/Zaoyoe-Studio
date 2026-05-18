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
        get statusCode() {
            return state.statusCode;
        },
        get headers() {
            return state.headers;
        },
        get body() {
            return state.body;
        }
    };
}

function createSupabaseMock(state) {
    return {
        from(table) {
            if (table === 'payment_events') {
                return {
                    insert(payload) {
                        state.insertedEvent = payload;
                        return {
                            select() {
                                return {
                                    limit() {
                                        return {
                                            data: [{ id: 'event-1' }],
                                            error: null
                                        };
                                    }
                                };
                            }
                        };
                    },
                    update(payload) {
                        state.finalizedEvent = payload;
                        return {
                            eq(column, value) {
                                state.finalizedEventWhere = { column, value };
                                return {
                                    error: null
                                };
                            }
                        };
                    },
                    delete() {
                        return {
                            eq(column, value) {
                                state.deletedEventWhere = { column, value };
                                return {
                                    error: null
                                };
                            }
                        };
                    }
                };
            }

            if (table === 'payment_orders') {
                return {
                    select(selection) {
                        state.paymentOrderSelect = selection;
                        const filters = [];

                        return {
                            eq(column, value) {
                                filters.push([column, value]);
                                return this;
                            },
                            order() {
                                return this;
                            },
                            limit() {
                                return this;
                            },
                            maybeSingle() {
                                state.paymentOrderFilters = filters;
                                return {
                                    data: state.existingPaymentOrder,
                                    error: null
                                };
                            }
                        };
                    },
                    update(payload) {
                        state.paymentOrderPatch = payload;
                        return {
                            eq(column, value) {
                                state.paymentOrderPatchWhere = { column, value };
                                return {
                                    error: null
                                };
                            }
                        };
                    },
                    insert(payload) {
                        state.insertedPaymentOrder = payload;
                        return {
                            select() {
                                return {
                                    single() {
                                        return {
                                            data: {
                                                ...payload,
                                                id: 'payment-order-inserted'
                                            },
                                            error: null
                                        };
                                    }
                                };
                            }
                        };
                    }
                };
            }

            throw new Error(`Unexpected table access: ${table}`);
        }
    };
}

async function withZpayWebhookModule(mocks, callback) {
    const handlerPath = path.resolve(__dirname, '../api/_lib/payments/zpay-webhook.js');
    const originalLoad = Module._load;

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (Object.prototype.hasOwnProperty.call(mocks, request)) {
            return mocks[request];
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    let loadedModule;
    try {
        loadedModule = require(handlerPath);
    } finally {
        Module._load = originalLoad;
    }

    try {
        return await callback(loadedModule);
    } finally {
        delete require.cache[handlerPath];
    }
}

function buildDependencyMocks(state) {
    return {
        './provider-adapters': {
            getPaymentProviderAdapter(providerKey) {
                assert.equal(providerKey, 'zpay');
                return {
                    buildEventKey({ providerOrderNo, transactionId, status }) {
                        state.eventKeyArgs = { providerOrderNo, transactionId, status };
                        return `zpay:${providerOrderNo}:${transactionId}:${status}`;
                    },
                    async resolveRuntimeContext({ supabase, env }) {
                        state.runtimeContextRequest = { supabase, env };
                        return {
                            provider: 'zpay',
                            integration: {
                                pid: '2026041807323142',
                                pkey: 'secret'
                            }
                        };
                    },
                    verifyWebhook({ payload, runtimeContext }) {
                        state.verificationRequest = { payload, runtimeContext };
                        const valid = state.signatureValid !== false;
                        return {
                            supported: true,
                            valid,
                            expectedSign: 'expected-sign',
                            receivedSign: valid ? 'expected-sign' : 'bad-sign'
                        };
                    },
                    async queryOrder({ runtimeContext, providerOrderNo, tradeNo }) {
                        state.queryOrderRequest = { runtimeContext, providerOrderNo, tradeNo };
                        if (state.queryOrderError) {
                            throw state.queryOrderError;
                        }
                        return state.queryOrderResult || {
                            supported: true,
                            success: true,
                            providerOrderNo,
                            tradeNo: tradeNo || 'TRADE-1',
                            paidAmount: 12.34,
                            status: 'paid',
                            statusRaw: 'TRADE_SUCCESS',
                            responsePayload: {
                                code: '1'
                            }
                        };
                    }
                };
            },
            roundCurrencyAmount(value) {
                return Math.round(Number(value || 0) * 100) / 100;
            },
            amountsMatch(expected, actual) {
                return Math.abs(Number(expected || 0) - Number(actual || 0)) < 0.0001;
            }
        },
        './orders': {
            async reconcileCheckoutSessionForPaymentOrder(payload) {
                state.reconcilePayload = payload;
            },
            sanitizeSite(value) {
                return String(value || '').trim().toLowerCase() === 'intl' ? 'intl' : 'cn';
            }
        },
        './zpay': {
            normalizeZpayPaymentStatus(tradeStatus) {
                return String(tradeStatus || '').trim().toUpperCase() === 'TRADE_SUCCESS'
                    ? 'paid'
                    : 'pending';
            },
            parseZpayParam(value) {
                return JSON.parse(String(value || '{}'));
            }
        },
        './zpay-points': {
            deriveZpayPointBreakdown(paymentOrder, attachData) {
                state.pointBreakdownRequest = { paymentOrder, attachData };
                return {
                    paidPoints: 80,
                    bonusPoints: 20
                };
            }
        },
        './rpc': {
            async rechargePointsForPayment(payload) {
                state.rechargePayload = payload;
                return {
                    error: null
                };
            }
        },
        '../discount-trigger-linkage': {
            async maybeIssueRechargeDiscountAssets(payload) {
                state.discountPayload = payload;
            },
            async maybeIssueAffiliateDiscountAssetsForRecharge(payload) {
                state.affiliatePayload = payload;
            }
        },
        '../request-security': {
            applyRateLimitHeaders(res, result) {
                res.setHeader('x-ratelimit-limit', String(result.limit || 0));
                state.rateLimitHeadersApplied = true;
            },
            explainClientIpResolution(req, { env, trustedProxies }) {
                const resolvedClientIp = state.resolvedClientIp
                    || String(req?.headers?.['x-forwarded-for'] || '203.0.113.10').split(',')[0].trim()
                    || '203.0.113.10';
                state.ipResolutionRequest = {
                    env,
                    trustedProxies,
                    host: req.headers.host
                };
                return {
                    socketIp: '10.0.0.2',
                    forwardedIps: [resolvedClientIp],
                    resolvedClientIp,
                    trustedProxies: ['10.0.0.0/8'],
                    trustAllProxies: false,
                    directPeerTrusted: true,
                    directPeerTrustReason: 'configured_trusted_proxy',
                    usedForwardedChain: true
                };
            },
            isIpAllowed(ip) {
                if (typeof state.ipAllowedResult === 'boolean') {
                    return state.ipAllowedResult;
                }
                return String(ip || '') === '203.0.113.10';
            },
            resolveClientIp() {
                return state.resolvedClientIp || '203.0.113.10';
            },
            splitIpRules(value) {
                return String(value || '')
                    .split(',')
                    .map((entry) => entry.trim())
                    .filter(Boolean);
            },
            async takeRateLimitToken() {
                return {
                    allowed: true,
                    limit: 180,
                    remaining: 179,
                    resetAt: Date.now() + 60_000,
                    retryAfterSeconds: 60
                };
            }
        }
    };
}

test('zpay webhook uses strict verification mode when production source allowlist is missing', async () => {
    const state = {
        existingPaymentOrder: {
            id: 'payment-order-no-allowlist',
            user_id: 'user-1',
            provider: 'zpay',
            provider_order_no: 'ZP123',
            checkout_session_id: 'checkout-session-1',
            site: 'cn',
            package_id: 'pkg-1',
            package_name: '月度积分充值',
            expected_amount: 12.34,
            paid_amount: null,
            points_amount: 100,
            status: 'pending',
            sign_verified: false,
            amount_verified: false,
            provider_metadata: {
                payment_type: 'alipay'
            },
            raw_payload: {
                request: {
                    points_amount: 80,
                    bonus_points: 20
                }
            }
        }
    };

    await withZpayWebhookModule(buildDependencyMocks(state), async ({ createZpayWebhookHandler }) => {
        const handler = createZpayWebhookHandler({
            supabase: createSupabaseMock(state),
            env: {
                VERCEL_ENV: 'production',
                APP_BASE_URL: 'https://www.zaoyoe.com',
                TRUSTED_PROXY_IPS: '10.0.0.0/8'
            }
        });
        const req = {
            method: 'GET',
            url: '/api/payments/zpay/webhook?out_trade_no=ZP123&trade_no=TRADE-1&trade_status=TRADE_SUCCESS&money=12.34&pid=2026041807323142&type=alipay&param=%7B%22user_id%22%3A%22user-1%22%7D',
            headers: {
                host: 'www.zaoyoe.com',
                'x-forwarded-for': '203.0.113.10'
            }
        };
        const res = createMockResponse();

        await handler(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body, 'success');
        assert.equal(state.insertedEvent.provider, 'zpay');
        assert.equal(state.verificationRequest.payload.out_trade_no, 'ZP123');
        assert.equal(state.queryOrderRequest.providerOrderNo, 'ZP123');
        assert.equal(state.paymentOrderPatch.status, 'redeemed');
        assert.equal(state.paymentOrderPatch.sign_verified, true);
        assert.equal(state.paymentOrderPatch.amount_verified, true);
        assert.equal(state.rechargePayload.referenceId, 'zpay_ZP123');
        assert.equal(state.finalizedEvent.processing_result, 'processed_paid');
        assert.equal(state.finalizedEvent.signature_valid, true);
        assert.equal(state.finalizedEvent.amount_valid, true);
    });
});

test('zpay webhook without source allowlist still rejects invalid signatures before active query', async () => {
    const state = {
        signatureValid: false,
        existingPaymentOrder: {
            id: 'payment-order-bad-sign',
            user_id: 'user-1',
            provider: 'zpay',
            provider_order_no: 'ZP-BAD-SIGN',
            checkout_session_id: 'checkout-session-bad-sign',
            site: 'cn',
            package_id: 'pkg-1',
            package_name: '月度积分充值',
            expected_amount: 12.34,
            paid_amount: null,
            points_amount: 100,
            status: 'pending',
            sign_verified: false,
            amount_verified: false,
            provider_metadata: {},
            raw_payload: {
                request: {
                    points_amount: 80,
                    bonus_points: 20
                }
            }
        }
    };

    await withZpayWebhookModule(buildDependencyMocks(state), async ({ createZpayWebhookHandler }) => {
        const handler = createZpayWebhookHandler({
            supabase: createSupabaseMock(state),
            env: {
                DEPLOYMENT_TIER: 'production',
                APP_BASE_URL: 'https://www.zaoyoe.com',
                TRUSTED_PROXY_IPS: '10.0.0.0/8'
            }
        });
        const attachData = JSON.stringify({
            user_id: 'user-1',
            site: 'cn',
            expected_amount: 12.34,
            charge_type: 'package',
            checkout_session_id: 'checkout-session-bad-sign'
        });
        const req = {
            method: 'GET',
            url: `/api/payments/zpay/webhook?out_trade_no=ZP-BAD-SIGN&trade_no=TRADE-BAD-SIGN&trade_status=TRADE_SUCCESS&money=12.34&pid=2026041807323142&type=alipay&param=${encodeURIComponent(attachData)}`,
            headers: {
                host: 'www.zaoyoe.com',
                'x-forwarded-for': '198.51.100.22'
            }
        };
        const res = createMockResponse();

        await handler(req, res);

        assert.equal(res.statusCode, 401);
        assert.equal(res.body, 'invalid signature');
        assert.equal(state.queryOrderRequest, undefined);
        assert.equal(state.rechargePayload, undefined);
        assert.equal(state.paymentOrderPatch.status, 'pending');
        assert.equal(state.paymentOrderPatch.sign_verified, false);
        assert.equal(state.finalizedEvent.processing_result, 'signature_mismatch');
        assert.equal(state.finalizedEvent.signature_valid, false);
        assert.equal(state.finalizedEvent.response_status, 401);
    });
});

test('zpay webhook rejects requests outside the configured source IP allowlist', async () => {
    const state = {
        resolvedClientIp: '198.51.100.22'
    };

    await withZpayWebhookModule(buildDependencyMocks(state), async ({ createZpayWebhookHandler }) => {
        const handler = createZpayWebhookHandler({
            supabase: createSupabaseMock(state),
            env: {
                APP_ENV: 'production',
                APP_BASE_URL: 'https://www.zaoyoe.com',
                TRUSTED_PROXY_IPS: '10.0.0.0/8',
                ZPAY_WEBHOOK_ALLOWED_IPS: '203.0.113.10'
            }
        });
        const req = {
            method: 'GET',
            url: '/api/payments/zpay/webhook?out_trade_no=ZP-IP-BLOCKED&trade_no=TRADE-IP-BLOCKED&trade_status=TRADE_SUCCESS&money=12.34&pid=2026041807323142&type=alipay&param=%7B%22user_id%22%3A%22user-1%22%7D',
            headers: {
                host: 'www.zaoyoe.com',
                'x-forwarded-for': '198.51.100.22'
            }
        };
        const res = createMockResponse();

        await handler(req, res);

        assert.equal(res.statusCode, 403);
        assert.equal(res.body, 'forbidden');
        assert.equal(state.insertedEvent, undefined);
        assert.equal(state.queryOrderRequest, undefined);
        assert.equal(state.rechargePayload, undefined);
    });
});

test('zpay webhook accepts signed GET callbacks through the shared handler', async () => {
    const state = {
        existingPaymentOrder: {
            id: 'payment-order-1',
            user_id: 'user-1',
            provider: 'zpay',
            provider_order_no: 'ZP123',
            checkout_session_id: 'checkout-session-1',
            site: 'cn',
            package_id: 'pkg-1',
            package_name: '月度积分充值',
            expected_amount: 12.34,
            paid_amount: null,
            points_amount: 100,
            status: 'pending',
            sign_verified: false,
            amount_verified: false,
            provider_metadata: {
                payment_type: 'alipay'
            },
            raw_payload: {
                request: {
                    points_amount: 80,
                    bonus_points: 20
                }
            }
        }
    };

    await withZpayWebhookModule(buildDependencyMocks(state), async ({ createZpayWebhookHandler }) => {
        const handler = createZpayWebhookHandler({
            supabase: createSupabaseMock(state),
            env: {
                APP_ENV: 'production',
                APP_BASE_URL: 'https://www.zaoyoe.com',
                TRUSTED_PROXY_IPS: '10.0.0.0/8',
                ZPAY_WEBHOOK_ALLOWED_IPS: '203.0.113.10'
            }
        });
        const attachData = JSON.stringify({
            user_id: 'user-1',
            site: 'cn',
            expected_amount: 12.34,
            charge_type: 'package',
            checkout_session_id: 'checkout-session-1'
        });
        const req = {
            method: 'GET',
            url: `/api/payments/zpay/webhook?out_trade_no=ZP123&trade_no=TRADE-1&trade_status=TRADE_SUCCESS&money=12.34&pid=2026041807323142&type=alipay&param=${encodeURIComponent(attachData)}`,
            headers: {
                host: 'www.zaoyoe.com',
                'x-forwarded-for': '203.0.113.10'
            }
        };
        const res = createMockResponse();

        await handler(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body, 'success');
        assert.equal(state.insertedEvent.provider, 'zpay');
        assert.equal(state.insertedEvent.provider_order_no, 'ZP123');
        assert.equal(state.verificationRequest.payload.out_trade_no, 'ZP123');
        assert.equal(state.queryOrderRequest.providerOrderNo, 'ZP123');
        assert.equal(state.queryOrderRequest.tradeNo, 'TRADE-1');
        assert.equal(state.paymentOrderPatch.status, 'redeemed');
        assert.equal(state.paymentOrderPatch.sign_verified, true);
        assert.equal(state.paymentOrderPatch.amount_verified, true);
        assert.equal(state.paymentOrderPatch.provider_metadata.trade_no, 'TRADE-1');
        assert.equal(state.paymentOrderPatch.provider_metadata.query_status, 'paid');
        assert.equal(state.rechargePayload.referenceId, 'zpay_ZP123');
        assert.equal(state.rechargePayload.paidPoints, 80);
        assert.equal(state.reconcilePayload.providerKey, 'zpay');
        assert.equal(state.discountPayload.paymentProvider, 'zpay');
        assert.equal(state.affiliatePayload.rechargeReferenceId, 'zpay_ZP123');
        assert.equal(state.finalizedEvent.processing_result, 'processed_paid');
        assert.equal(state.finalizedEvent.signature_valid, true);
        assert.equal(state.finalizedEvent.amount_valid, true);
        assert.deepEqual(state.paymentOrderPatchWhere, {
            column: 'id',
            value: 'payment-order-1'
        });
    });
});

test('zpay webhook ignores internal public-route query params before signature verification', async () => {
    const state = {
        existingPaymentOrder: {
            id: 'payment-order-rewrite',
            user_id: 'user-1',
            provider: 'zpay',
            provider_order_no: 'ZP789',
            checkout_session_id: 'checkout-session-789',
            site: 'cn',
            package_id: null,
            package_name: '自定义充值',
            expected_amount: 0.01,
            paid_amount: null,
            points_amount: 0.01,
            status: 'pending',
            sign_verified: false,
            amount_verified: false,
            provider_metadata: {},
            raw_payload: {
                request: {
                    points_amount: 0.01,
                    bonus_points: 0
                }
            }
        },
        queryOrderResult: {
            supported: true,
            success: true,
            providerOrderNo: 'ZP789',
            tradeNo: 'TRADE-789',
            paidAmount: 0.01,
            status: 'paid',
            statusRaw: 'TRADE_SUCCESS',
            responsePayload: {
                code: '1',
                status: 1
            }
        }
    };

    await withZpayWebhookModule(buildDependencyMocks(state), async ({ createZpayWebhookHandler }) => {
        const handler = createZpayWebhookHandler({
            supabase: createSupabaseMock(state),
            env: {
                APP_ENV: 'production',
                APP_BASE_URL: 'https://www.zaoyoe.com',
                TRUSTED_PROXY_IPS: '10.0.0.0/8',
                ZPAY_WEBHOOK_ALLOWED_IPS: '203.0.113.10'
            }
        });
        const attachData = JSON.stringify({
            user_id: 'user-1',
            site: 'cn',
            expected_amount: 0.01,
            charge_type: 'custom',
            checkout_session_id: 'checkout-session-789'
        });
        const req = {
            method: 'GET',
            url: `/api/public?scope=payments&route=zpay/webhook&path=zpay/webhook&out_trade_no=ZP789&trade_no=TRADE-789&trade_status=TRADE_SUCCESS&money=0.01&pid=2026041807323142&type=alipay&param=${encodeURIComponent(attachData)}`,
            headers: {
                host: 'www.zaoyoe.com',
                'x-forwarded-for': '203.0.113.10'
            },
            query: {
                scope: 'payments',
                route: 'zpay/webhook',
                path: 'zpay/webhook'
            }
        };
        const res = createMockResponse();

        await handler(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body, 'success');
        assert.equal(state.verificationRequest.payload.scope, undefined);
        assert.equal(state.verificationRequest.payload.route, undefined);
        assert.equal(state.verificationRequest.payload.path, undefined);
        assert.equal(state.paymentOrderPatch.status, 'redeemed');
        assert.equal(state.finalizedEvent.processing_result, 'processed_paid');
    });
});

test('zpay webhook does not credit points when active query reports a non-paid order', async () => {
    const state = {
        existingPaymentOrder: {
            id: 'payment-order-2',
            user_id: 'user-2',
            provider: 'zpay',
            provider_order_no: 'ZP456',
            checkout_session_id: 'checkout-session-2',
            site: 'cn',
            package_id: 'pkg-2',
            package_name: '年度积分充值',
            expected_amount: 23.45,
            paid_amount: null,
            points_amount: 200,
            status: 'pending',
            sign_verified: false,
            amount_verified: false,
            provider_metadata: {},
            raw_payload: {
                request: {
                    points_amount: 160,
                    bonus_points: 40
                }
            }
        },
        queryOrderResult: {
            supported: true,
            success: true,
            providerOrderNo: 'ZP456',
            tradeNo: 'TRADE-456',
            paidAmount: 23.45,
            status: 'pending',
            statusRaw: '0',
            responsePayload: {
                code: '1',
                status: 0
            }
        }
    };

    await withZpayWebhookModule(buildDependencyMocks(state), async ({ createZpayWebhookHandler }) => {
        const handler = createZpayWebhookHandler({
            supabase: createSupabaseMock(state),
            env: {
                APP_ENV: 'production',
                APP_BASE_URL: 'https://www.zaoyoe.com',
                TRUSTED_PROXY_IPS: '10.0.0.0/8',
                ZPAY_WEBHOOK_ALLOWED_IPS: '203.0.113.10'
            }
        });
        const attachData = JSON.stringify({
            user_id: 'user-2',
            site: 'cn',
            expected_amount: 23.45,
            charge_type: 'package',
            checkout_session_id: 'checkout-session-2'
        });
        const req = {
            method: 'GET',
            url: `/api/payments/zpay/webhook?out_trade_no=ZP456&trade_no=TRADE-456&trade_status=TRADE_SUCCESS&money=23.45&pid=2026041807323142&type=alipay&param=${encodeURIComponent(attachData)}`,
            headers: {
                host: 'www.zaoyoe.com',
                'x-forwarded-for': '203.0.113.10'
            }
        };
        const res = createMockResponse();

        await handler(req, res);

        assert.equal(res.statusCode, 503);
        assert.equal(res.body, 'query verification pending');
        assert.equal(state.rechargePayload, undefined);
        assert.equal(state.discountPayload, undefined);
        assert.equal(state.paymentOrderPatch, undefined);
        assert.deepEqual(state.deletedEventWhere, {
            column: 'event_key',
            value: 'zpay:ZP456:TRADE-456:TRADE_SUCCESS'
        });
        assert.equal(state.finalizedEvent, undefined);
    });
});
