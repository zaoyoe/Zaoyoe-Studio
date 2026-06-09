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
                    }
                };
            }

            throw new Error(`Unexpected table access: ${table}`);
        }
    };
}

async function withNowpaymentsWebhookModule(mocks, callback) {
    const handlerPath = path.resolve(__dirname, '../api/_lib/payments/nowpayments-webhook.js');
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
                assert.equal(providerKey, 'nowpayments');
                return {
                    buildEventKey({ providerOrderNo, transactionId, status }) {
                        state.eventKeyArgs = { providerOrderNo, transactionId, status };
                        return `nowpayments:${providerOrderNo}:${transactionId}:${status}`;
                    },
                    async resolveRuntimeContext({ supabase, env, site }) {
                        state.runtimeContextRequest = { supabase, env, site };
                        return {
                            provider: 'nowpayments',
                            integration: {
                                ipnSecret: 'ipn-secret'
                            }
                        };
                    },
                    verifyWebhook({ payload, runtimeContext, receivedSignature }) {
                        state.verificationRequest = { payload, runtimeContext, receivedSignature };
                        return {
                            supported: true,
                            valid: state.signatureValid !== false,
                            expectedSignature: 'expected-signature',
                            receivedSignature
                        };
                    }
                };
            },
            roundCurrencyAmount(value) {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
            },
            amountsMatch(expected, actual, epsilon = 0.01) {
                const left = Math.round(Number(expected || 0) * 100) / 100;
                const right = Math.round(Number(actual || 0) * 100) / 100;
                return Math.abs(left - right) <= epsilon;
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
        './nowpayments': {
            normalizeNowpaymentsPaymentStatus(value) {
                const normalized = String(value || '').trim().toLowerCase();
                return normalized === 'finished' ? 'paid' : normalized || 'unknown';
            }
        },
        './site-origins': {
            classifyManagedSite(value) {
                return String(value || '').includes('fatherkey.com') ? 'cn' : '';
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

test('nowpayments webhook settles finished payment using actual USDT amount when price quote differs', async () => {
    const payload = {
        order_id: 'NPUSDT950',
        invoice_id: 'invoice-1',
        payment_id: '5731943810',
        payment_status: 'finished',
        price_amount: 9.41,
        price_currency: 'usd',
        pay_amount: 9.5,
        actually_paid: 9.5,
        pay_currency: 'usdtbsc',
        outcome_amount: 9.5,
        outcome_currency: 'usdtbsc'
    };
    const state = {
        existingPaymentOrder: {
            id: 'payment-order-nowpayments-1',
            user_id: 'user-1',
            provider: 'nowpayments',
            provider_order_no: 'NPUSDT950',
            checkout_session_id: 'checkout-session-1',
            site: 'cn',
            package_id: 'pkg-pro',
            package_name: 'Pro package',
            expected_amount: 66.66,
            paid_amount: null,
            points_amount: 66,
            status: 'pending',
            sign_verified: false,
            amount_verified: false,
            provider_metadata: {
                provider_order_no: 'NPUSDT950',
                payment_id: '5731943810',
                local_amount: 66.66,
                price_amount: 9.5,
                price_currency: 'usd',
                pay_amount: 9.5,
                pay_amount_text: '9.50',
                pay_currency: 'usdtbsc',
                paid_points: 66,
                bonus_points: 0,
                charge_type: 'package'
            },
            raw_payload: {},
            paid_at: null,
            claimed_at: null,
            verified_at: null,
            last_error: null
        }
    };

    await withNowpaymentsWebhookModule(buildDependencyMocks(state), async ({ createNowpaymentsWebhookHandler }) => {
        const handler = createNowpaymentsWebhookHandler({
            supabase: createSupabaseMock(state),
            env: {
                APP_BASE_URL: 'https://www.fatherkey.com'
            }
        });
        const req = {
            method: 'POST',
            headers: {
                host: 'www.fatherkey.com',
                'x-forwarded-for': '203.0.113.10',
                'x-nowpayments-sig': 'expected-signature'
            },
            body: payload
        };
        const res = createMockResponse();

        await handler(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body, 'success');
        assert.equal(state.insertedEvent.provider, 'nowpayments');
        assert.equal(state.eventKeyArgs.providerOrderNo, 'NPUSDT950');
        assert.equal(state.verificationRequest.receivedSignature, 'expected-signature');
        assert.equal(state.rechargePayload.referenceId, 'nowpayments_NPUSDT950');
        assert.equal(state.rechargePayload.paidPoints, 66);
        assert.equal(state.paymentOrderPatch.status, 'redeemed');
        assert.equal(state.paymentOrderPatch.amount_verified, true);
        assert.equal(state.paymentOrderPatch.last_error, null);
        assert.equal(state.paymentOrderPatch.provider_metadata.amount_verification.strategy, 'actually_paid');
        assert.equal(state.paymentOrderPatch.provider_metadata.amount_verification.expected_amount, 9.5);
        assert.equal(state.paymentOrderPatch.provider_metadata.amount_verification.actual_amount, 9.5);
        assert.equal(state.reconcilePayload.providerKey, 'nowpayments');
        assert.equal(state.discountPayload.paymentProvider, 'nowpayments');
        assert.equal(state.affiliatePayload.rechargeReferenceId, 'nowpayments_NPUSDT950');
        assert.equal(state.finalizedEvent.processing_result, 'processed_paid');
        assert.equal(state.finalizedEvent.signature_valid, true);
        assert.equal(state.finalizedEvent.amount_valid, true);
    });
});
