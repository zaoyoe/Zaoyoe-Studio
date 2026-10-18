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

for (const actuallyPaid of ['14.82', '14.81']) test(`market recharge callback ${actuallyPaid} uses the saved quote and credits only full payment`, async () => {
    const metadata = {
        fx_mode: 'market', fx_snapshot_id: '41444444-4444-4444-8444-444444444444',
        fx_expires_at: '2020-01-01T00:00:00Z', fx_usdt_per_cny: '0.14970060',
        payment_id: '5731943810', local_amount: 98.98, price_amount: 14.82,
        price_currency: 'usdtbsc', pay_currency: 'usdtbsc', pay_amount: 14.82, pay_amount_text: '14.82',
        paid_points: 98, bonus_points: 0, charge_type: 'custom', payment_fee_amount: 0.98
    };
    const state = { existingPaymentOrder: {
        id: 'market-payment-1', user_id: 'user-1', provider: 'nowpayments', provider_order_no: 'NPMARKET',
        checkout_session_id: 'market-checkout-1', site: 'cn', expected_amount: 98.98,
        paid_amount: null, points_amount: 98, status: 'pending', provider_metadata: metadata, raw_payload: {}
    } };
    await withNowpaymentsWebhookModule(buildDependencyMocks(state), async ({ createNowpaymentsWebhookHandler }) => {
        const handler = createNowpaymentsWebhookHandler({ supabase: createSupabaseMock(state), env: {
            APP_BASE_URL: 'https://www.fatherkey.com', PAYMENT_USDT_FX_MODE: 'market', NOWPAYMENTS_CNY_TO_USD_RATE: '0.99'
        } });
        const res = createMockResponse();
        await handler({ method: 'POST', headers: { host: 'www.fatherkey.com',
            'x-forwarded-for': '203.0.113.10', 'x-nowpayments-sig': 'expected-signature' },
        body: { order_id: 'NPMARKET', payment_id: metadata.payment_id, payment_status: 'finished',
            price_amount: 14.82, price_currency: 'usdtbsc', pay_amount: 14.82,
            actually_paid: actuallyPaid, pay_currency: 'usdtbsc' } }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(state.paymentOrderPatch.provider_metadata.fx_snapshot_id, metadata.fx_snapshot_id);
        assert.equal(state.paymentOrderPatch.provider_metadata.pay_amount_text, '14.82');
        assert.equal(state.paymentOrderPatch.provider_metadata.pay_amount, 14.82);
        if (actuallyPaid === '14.82') {
            assert.equal(state.rechargePayload.paidPoints, 98, 'the fee does not become wallet credit');
            assert.equal(state.reconcilePayload.paidAmount, 98.98);
            assert.equal(state.paymentOrderPatch.status, 'redeemed');
            assert.equal(state.finalizedEvent.processing_result, 'processed_paid');
        } else {
            assert.equal(state.rechargePayload, undefined);
            assert.equal(state.paymentOrderPatch.amount_verified, false);
            assert.equal(state.finalizedEvent.processing_result, 'amount_mismatch');
        }
    });
});

test('native TON recharge keeps its immutable identity after a wrong callback and compares raw atomic amounts', async () => {
    const metadata = { native_usdt: true, payment_id: '5731943810', price_currency: 'usdtton', pay_currency: 'usdtton',
        pay_amount: 14.82, pay_amount_text: '14.82', price_amount: 14.82, pay_address: 'EQ' + 'a'.repeat(46), payin_extra_id: '556677', paid_points: 98 };
    const state = { existingPaymentOrder: { id: 'native-ton-payment', user_id: 'user-1', provider: 'nowpayments', provider_order_no: 'NPTON',
        site: 'cn', expected_amount: 98.98, points_amount: 98, status: 'pending', provider_metadata: metadata, raw_payload: {} } };
    await withNowpaymentsWebhookModule(buildDependencyMocks(state), async ({ createNowpaymentsWebhookHandler }) => {
        const handler = createNowpaymentsWebhookHandler({ supabase: createSupabaseMock(state), env: {} });
        const valid = { order_id: 'NPTON', payment_id: metadata.payment_id, payment_status: 'finished', price_currency: 'usdtton',
            pay_currency: 'usdtton', price_amount: 14.82, pay_amount: 14.82, actually_paid: '14.82', pay_address: metadata.pay_address, extra_id: '556677' };
        for (const [patch, rawAmount, accepted] of [
            [{ payment_status: 'confirming', payment_id: '999', pay_currency: 'usdtbsc', price_currency: 'usdtbsc', pay_amount: 1 }, null, false],
            [{}, '14.819999999999999999', false], [{}, '14.82', true]
        ]) {
            const payload = { ...valid, ...patch };
            const rawBody = JSON.stringify(payload).replace('"actually_paid":"14.82"', `"actually_paid":${rawAmount || '14.82'}`);
            await handler({ method: 'POST', headers: { 'x-nowpayments-sig': 'expected-signature' }, body: JSON.parse(rawBody), rawBody: Buffer.from(rawBody) }, createMockResponse());
            for (const key of ['payment_id', 'pay_currency', 'price_currency', 'pay_amount', 'pay_amount_text', 'payin_extra_id']) {
                assert.equal(state.paymentOrderPatch.provider_metadata[key], metadata[key]);
            }
            if (!accepted) assert.equal(state.rechargePayload, undefined);
            else assert.equal(state.rechargePayload.paidPoints, 98);
            state.existingPaymentOrder = { ...state.existingPaymentOrder, ...state.paymentOrderPatch };
        }
    });
});

test('nowpayments webhook preserves existing payment id when callback omits it', async () => {
    const payload = {
        order_id: 'NPUSDT950',
        invoice_id: 'invoice-1',
        purchase_id: 'purchase-is-not-payment-id',
        payment_status: 'confirming',
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
            id: 'payment-order-nowpayments-preserve-id',
            user_id: 'user-1',
            provider: 'nowpayments',
            provider_order_no: 'NPUSDT950',
            checkout_session_id: 'checkout-session-1',
            site: 'cn',
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
                pay_currency: 'usdtbsc',
                paid_points: 66,
                bonus_points: 0
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
        assert.equal(state.paymentOrderPatch.provider_metadata.payment_id, '5731943810');
        assert.equal(state.paymentOrderPatch.provider_metadata.purchase_id, 'purchase-is-not-payment-id');
        assert.equal(state.finalizedEvent.processing_result, 'ignored_confirming');
    });
});
