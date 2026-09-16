'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createGuestShopHandlers } = require('../server/api-handlers/public/guest-shop');

const ORDER_ID = '33333333-3333-4333-8333-333333333333';
const PAYMENT_ID = '44444444-4444-4444-8444-444444444444';
const ORDER_NO = 'GS20260913-000001';

function createResponse() {
    const state = { statusCode: 200, headers: {}, body: '' };
    return {
        setHeader(name, value) {
            state.headers[String(name).toLowerCase()] = value;
            return this;
        },
        status(code) {
            state.statusCode = code;
            return this;
        },
        end(body = '') {
            state.body = String(body);
            return this;
        },
        get statusCode() { return state.statusCode; },
        get payload() { return state.body ? JSON.parse(state.body) : null; }
    };
}

function createSupabaseStub(options = {}) {
    const defaultPayment = {
        id: PAYMENT_ID,
        guest_order_id: ORDER_ID,
        merchant_order_no: ORDER_NO,
        purpose: 'shop_direct',
        provider: 'zpay',
        channel: 'alipay',
        site: 'cn',
        currency: 'CNY',
        expected_amount: '12.34',
        provider_order_no: 'ZPAY-TRADE-1',
        checkout_reference: 'https://zpay.example/pay/1',
        provider_metadata: {}
    };
    const state = {
        payment: { ...defaultPayment, ...(options.payment || {}) },
        payments: Array.isArray(options.payments)
            ? options.payments.map((payment) => ({ ...payment }))
            : [{ ...defaultPayment, ...(options.payment || {}) }],
        events: [],
        rpcCalls: [],
        lookupCalls: [],
        ambiguousPaymentLookup: Boolean(options.ambiguousPaymentLookup)
    };

    function builder(table, operation, patch = null) {
        const filters = [];
        const query = {
            select() { return query; },
            eq(field, value) {
                filters.push([String(field), value]);
                return query;
            },
            single() { return execute(); },
            maybeSingle() { return execute(); }
        };

        async function execute() {
            if (operation === 'insert') {
                const row = { id: `event-${state.events.length + 1}`, ...patch };
                if (state.events.some((item) => item.provider === row.provider && item.event_key === row.event_key)) {
                    return { data: null, error: { code: '23505' } };
                }
                state.events.push(row);
                return { data: { ...row }, error: null };
            }
            const rows = table === 'guest_shop_payment_orders' ? state.payments : state.events;
            if (table === 'guest_shop_payment_orders') state.lookupCalls.push(filters.map(([field, value]) => [field, value]));
            const matches = rows.filter((candidate) => filters.every(([field, value]) => candidate?.[field] === value));
            if (table === 'guest_shop_payment_orders' && state.ambiguousPaymentLookup && matches.length > 1) {
                return { data: null, error: { code: 'PGRST116', message: 'Multiple rows returned' } };
            }
            const row = matches[0] || null;
            return { data: row ? { ...row } : null, error: null };
        }

        return query;
    }

    return {
        state,
        from(table) {
            return {
                select() { return builder(table, 'select'); },
                insert(row) { return builder(table, 'insert', row); }
            };
        },
        async rpc(name, args) {
            state.rpcCalls.push({ name, args });
            const event = state.events.find((item) => item.id === args.p_event_id);
            if (event) event.processing_status = 'processed';
            return { data: [{ payment_order_id: PAYMENT_ID, status: 'confirmed' }], error: null };
        }
    };
}

function makeRequest(sign, fields = {}) {
    const rawBody = new URLSearchParams({
        pid: '10001',
        trade_status: 'TRADE_SUCCESS',
        out_trade_no: ORDER_NO,
        trade_no: 'ZPAY-TRADE-1',
        money: '12.34',
        sign_type: 'MD5',
        sign,
        ...fields
    }).toString();
    return {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: Buffer.from(rawBody, 'utf8')
    };
}

function makeNowpaymentsRequest(fields = {}) {
    const payload = {
        payment_id: 'NP-PAYMENT-1',
        payment_status: 'finished',
        price_amount: '1.73',
        price_currency: 'usd',
        pay_amount: '1.73',
        pay_currency: 'usdtbsc',
        actually_paid: '1.73',
        actually_paid_currency: 'usdtbsc',
        ...fields
    };
    return {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-nowpayments-sig': 'valid-signature' },
        body: Buffer.from(JSON.stringify(payload), 'utf8')
    };
}

function createHandlers(options = {}) {
    const supabase = createSupabaseStub(options);
    const provider = options.provider || 'zpay';
    const paymentAdapter = options.paymentAdapter || {
        async verifyGuestWebhook({ payload }) {
            return {
                valid: provider === 'nowpayments'
                    ? true
                    : payload.sign === 'valid-signature',
                signature_version: provider === 'nowpayments' ? 'HMAC-SHA512' : 'MD5'
            };
        },
        async parseGuestWebhook({ payload }) {
            if (provider === 'nowpayments') {
                return {
                    merchant_order_no: payload.order_id || '',
                    provider_order_no: payload.order_id || payload.payment_id,
                    provider_payment_id: payload.payment_id,
                    event_key: `nowpayments:${payload.payment_id || 'unknown'}`,
                    purpose: 'shop_direct',
                    currency: 'CNY',
                    provider_currency: payload.price_currency,
                    price_amount: payload.price_amount,
                    amount: Number(payload.price_amount),
                    paid_amount: Number(payload.price_amount),
                    actually_paid_text: payload.actually_paid,
                    pay_currency: payload.pay_currency,
                    network_verified: true,
                    final_status: 'paid'
                };
            }
            return {
                merchant_order_no: payload.out_trade_no,
                provider_order_no: 'ZPAY-TRADE-1',
                event_key: 'zpay-business-event',
                purpose: 'shop_direct',
                currency: 'CNY',
                amount: 12.34,
                final_status: 'paid'
            };
        }
    };
    const handlers = createGuestShopHandlers({
        admin: {
            getOptionalSupabaseAdmin() { return supabase; },
            sendJson(res, status, payload) {
                res.status(status);
                res.setHeader('content-type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(payload));
            }
        },
        requestSecurity: options.requestSecurity || {
            async takeRateLimitToken() { return { allowed: true }; },
            applyRateLimitHeaders() {},
            resolveClientIp() { return '198.51.100.10'; }
        },
        paymentAdapter,
        env: options.env || { APP_ENV: 'test' }
    });
    return { handlers, state: supabase.state };
}

test('a forged webhook cannot reserve the business event key before the valid callback', async () => {
    const { handlers, state } = createHandlers();

    const forgedResponse = createResponse();
    await handlers.webhook(makeRequest('forged-signature'), forgedResponse, 'zpay');
    assert.equal(forgedResponse.statusCode, 202);
    assert.equal(forgedResponse.payload.accepted, false);
    assert.equal(state.events.length, 1);
    assert.match(state.events[0].event_key, /^zpay:invalid-bucket:\d+:[0-9a-f]{32}$/u);
    assert.notEqual(state.events[0].event_key, 'zpay-business-event');
    assert.equal(state.events[0].processing_status, 'rejected');

    const validResponse = createResponse();
    await handlers.webhook(makeRequest('valid-signature'), validResponse, 'zpay');
    assert.equal(validResponse.statusCode, 200);
    assert.equal(validResponse.payload.accepted, true);
    assert.equal(state.events.length, 2);
    assert.equal(state.events[1].event_key, 'zpay-business-event');
    assert.equal(state.events[1].processing_status, 'processed');
    assert.equal(state.rpcCalls.length, 1);
    assert.equal(state.rpcCalls[0].name, 'fn_guest_shop_confirm_payment');
});

test('repeated forged webhook bodies are deduplicated in the invalid namespace', async () => {
    const { handlers, state } = createHandlers();
    const first = createResponse();
    const second = createResponse();
    await handlers.webhook(makeRequest('forged-signature'), first, 'zpay');
    await handlers.webhook(makeRequest('forged-signature'), second, 'zpay');
    assert.equal(first.statusCode, 202);
    assert.equal(second.statusCode, 202);
    assert.equal(state.events.length, 1);
    assert.equal(state.rpcCalls.length, 0);
});

test('different forged bodies from one source share a bounded audit bucket', async () => {
    const { handlers, state } = createHandlers();
    const first = createResponse();
    const second = createResponse();
    await handlers.webhook(makeRequest('forged-signature', { nonce: 'one' }), first, 'zpay');
    await handlers.webhook(makeRequest('forged-signature', { nonce: 'two' }), second, 'zpay');
    assert.equal(first.statusCode, 202);
    assert.equal(second.statusCode, 202);
    assert.equal(state.events.length, 1);
    assert.match(state.events[0].event_key, /^zpay:invalid-bucket:/u);
});

test('webhook rate limiting rejects before reading or persisting a callback', async () => {
    const calls = [];
    const { handlers, state } = createHandlers({
        requestSecurity: {
            async takeRateLimitToken(args) {
                calls.push(args);
                return { allowed: false, retryAfterSeconds: 7 };
            },
            applyRateLimitHeaders() {},
            resolveClientIp() { return '198.51.100.10'; }
        }
    });
    const response = createResponse();
    await handlers.webhook(makeRequest('forged-signature'), response, 'zpay');
    assert.equal(response.statusCode, 429);
    assert.equal(response.payload.code, 'rate_limited');
    assert.equal(state.events.length, 0);
    assert.equal(state.rpcCalls.length, 0);
    assert.equal(calls.length, 1);
    assert.match(calls[0].key, /^guest-shop:webhook:zpay:global$/u);
});

test('a merchant order callback binds the provider order reference before confirmation', async () => {
    const { handlers, state } = createHandlers();
    const response = createResponse();

    await handlers.webhook(makeRequest('valid-signature'), response, 'zpay');

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.accepted, true);
    assert.equal(state.rpcCalls.length, 1);
    assert.equal(state.rpcCalls[0].args.p_provider_order_no, 'ZPAY-TRADE-1');
    assert.equal(state.events[0].provider_order_no, 'ZPAY-TRADE-1');
});

test('NOWPayments payment_id can locate the payment row without allowing merchant binding to be skipped', async () => {
    const payment = {
        id: '55555555-5555-4555-8555-555555555555',
        guest_order_id: ORDER_ID,
        merchant_order_no: 'GS-NOW-000001',
        purpose: 'shop_direct',
        provider: 'nowpayments',
        channel: 'nowpayments',
        site: 'cn',
        currency: 'CNY',
        expected_amount: '12.34',
        provider_order_no: 'GS-NOW-000001',
        checkout_reference: 'NP-PAYMENT-LOOKUP-1',
        provider_metadata: {
            price_amount: '1.73',
            price_currency: 'usd',
            pay_amount: '1.73',
            pay_amount_text: '1.73'
        }
    };
    const { handlers, state } = createHandlers({
        provider: 'nowpayments',
        payment,
        paymentAdapter: {
            async verifyGuestWebhook() {
                return { valid: true, signature_version: 'HMAC-SHA512' };
            },
            async parseGuestWebhook({ payload }) {
                return {
                    merchant_order_no: payload.order_id || '',
                    provider_order_no: payload.order_id || payload.payment_id,
                    provider_payment_id: payload.payment_id,
                    event_key: `nowpayments:${payload.payment_id}`,
                    purpose: 'shop_direct',
                    currency: 'CNY',
                    provider_currency: 'usd',
                    price_amount: payload.price_amount,
                    paid_amount: payload.price_amount,
                    actually_paid_text: payload.actually_paid,
                    pay_currency: payload.pay_currency,
                    network_verified: true,
                    final_status: 'paid'
                };
            }
        }
    });
    const response = createResponse();
    await handlers.webhook(makeNowpaymentsRequest({
        payment_id: 'NP-PAYMENT-LOOKUP-1',
        order_id: ''
    }), response, 'nowpayments');

    // The payment row was found through checkout_reference after provider_order_no
    // misses, but the callback has no merchant order binding. It must be audited
    // and rejected, never confirmed by payment_id alone.
    assert.equal(response.statusCode, 202);
    assert.equal(response.payload.accepted, false);
    assert.equal(state.rpcCalls.length, 0);
    assert.equal(state.events.length, 1);
    assert.equal(state.events[0].payment_order_id, payment.id);
    assert.deepEqual(
        state.lookupCalls.map((filters) => filters.map(([field]) => field)),
        [
            ['provider', 'provider_order_no'],
            ['provider', 'checkout_reference']
        ]
    );
});

test('ambiguous provider references fail closed before confirmation', async () => {
    const paymentA = {
        ...createSupabaseStub().state.payment,
        id: '66666666-6666-4666-8666-666666666666',
        provider: 'nowpayments',
        channel: 'nowpayments',
        merchant_order_no: 'GS-NOW-A',
        provider_order_no: 'NP-SHARED-1',
        checkout_reference: 'NP-SHARED-1'
    };
    const paymentB = {
        ...paymentA,
        id: '77777777-7777-4777-8777-777777777777',
        merchant_order_no: 'GS-NOW-B'
    };
    const { handlers, state } = createHandlers({
        provider: 'nowpayments',
        payments: [paymentA, paymentB],
        ambiguousPaymentLookup: true,
        paymentAdapter: {
            async verifyGuestWebhook() {
                return { valid: true, signature_version: 'HMAC-SHA512' };
            },
            async parseGuestWebhook({ payload }) {
                return {
                    merchant_order_no: payload.order_id || '',
                    provider_order_no: payload.order_id || payload.payment_id,
                    provider_payment_id: payload.payment_id,
                    purpose: 'shop_direct',
                    currency: 'CNY',
                    provider_currency: 'usd',
                    price_amount: payload.price_amount,
                    paid_amount: payload.price_amount,
                    actually_paid_text: payload.actually_paid,
                    pay_currency: payload.pay_currency,
                    network_verified: true,
                    final_status: 'paid'
                };
            }
        }
    });
    const response = createResponse();
    await handlers.webhook(makeNowpaymentsRequest({
        payment_id: 'NP-SHARED-1',
        order_id: ''
    }), response, 'nowpayments');

    assert.equal(response.statusCode, 500);
    assert.equal(response.payload.success, false);
    assert.equal(state.rpcCalls.length, 0);
    assert.equal(state.events.length, 0);
});

test('NOWPayments webhook compares actually_paid as exact decimal text at the quote boundary', async () => {
    const payment = {
        id: '88888888-8888-4888-8888-888888888888',
        guest_order_id: ORDER_ID,
        merchant_order_no: 'GS-NOW-PRECISION',
        purpose: 'shop_direct',
        provider: 'nowpayments',
        channel: 'nowpayments',
        site: 'cn',
        currency: 'CNY',
        expected_amount: '12.34',
        provider_order_no: 'GS-NOW-PRECISION',
        checkout_reference: 'NP-PRECISION-1',
        provider_metadata: {
            price_amount: '1.73',
            price_currency: 'usd',
            pay_amount: '1.73',
            pay_amount_text: '1.73'
        }
    };
    const makePrecisionHandlers = () => createHandlers({
        provider: 'nowpayments',
        payment,
        paymentAdapter: {
            async verifyGuestWebhook() {
                return { valid: true, signature_version: 'HMAC-SHA512' };
            },
            async parseGuestWebhook({ payload }) {
                return {
                    merchant_order_no: payload.order_id,
                    provider_order_no: payload.order_id,
                    provider_payment_id: payload.payment_id,
                    event_key: `nowpayments:${payload.payment_id}`,
                    purpose: 'shop_direct',
                    currency: 'CNY',
                    provider_currency: 'usd',
                    price_amount: payload.price_amount,
                    paid_amount: payload.price_amount,
                    actually_paid_text: payload.actually_paid,
                    pay_currency: payload.pay_currency,
                    network_verified: true,
                    final_status: 'paid'
                };
            }
        }
    });

    for (const [actuallyPaid, accepted] of [
        ['1.73', true],
        ['1.730000000000000000', true],
        ['1.730000000000000001', true],
        ['1.729999999999999999', false],
        ['1e0', false]
    ]) {
        const { handlers, state } = makePrecisionHandlers();
        const response = createResponse();
        await handlers.webhook(makeNowpaymentsRequest({
            payment_id: `NP-PRECISION-${actuallyPaid}`,
            order_id: 'GS-NOW-PRECISION',
            actually_paid: actuallyPaid
        }), response, 'nowpayments');

        assert.equal(response.statusCode, accepted ? 200 : 202, actuallyPaid);
        assert.equal(response.payload.accepted, accepted, actuallyPaid);
        assert.equal(state.rpcCalls.length, accepted ? 1 : 0, actuallyPaid);
        assert.equal(state.events.length, 1, actuallyPaid);
        assert.equal(state.events[0].processing_status, accepted ? 'processed' : 'rejected', actuallyPaid);
    }
});

test('NOWPayments parser USD quote still binds against stored CNY settlement', async () => {
    const payment = {
        id: '99999999-9999-4999-8999-999999999999',
        guest_order_id: ORDER_ID,
        merchant_order_no: 'GS-NOW-CNY-SETTLE',
        purpose: 'shop_direct',
        provider: 'nowpayments',
        channel: 'nowpayments',
        site: 'intl',
        currency: 'CNY',
        expected_amount: '12.34',
        provider_order_no: 'GS-NOW-CNY-SETTLE',
        checkout_reference: 'NP-CNY-SETTLE-1',
        provider_metadata: {
            price_amount: '1.73',
            price_currency: 'usd',
            pay_amount: '1.73',
            pay_amount_text: '1.73',
            local_currency: 'cny',
            local_amount: 12.34,
            cny_to_usd_rate: 0.14
        }
    };
    const { handlers, state } = createHandlers({
        provider: 'nowpayments',
        payment,
        paymentAdapter: {
            async verifyGuestWebhook() {
                return { valid: true, signature_version: 'HMAC-SHA512' };
            },
            async parseGuestWebhook({ payload }) {
                return {
                    merchant_order_no: payload.order_id,
                    provider_order_no: payload.order_id,
                    provider_payment_id: payload.payment_id,
                    event_key: `nowpayments:${payload.payment_id}`,
                    purpose: 'shop_direct',
                    currency: 'USD',
                    provider_currency: 'usd',
                    price_amount: payload.price_amount,
                    paid_amount: payload.price_amount,
                    actually_paid_text: payload.actually_paid,
                    pay_currency: payload.pay_currency,
                    network_verified: true,
                    final_status: 'paid'
                };
            }
        }
    });
    const response = createResponse();
    await handlers.webhook(makeNowpaymentsRequest({
        payment_id: 'NP-CNY-SETTLE-1',
        order_id: 'GS-NOW-CNY-SETTLE'
    }), response, 'nowpayments');

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.accepted, true);
    assert.equal(state.rpcCalls.length, 1);
    assert.equal(state.rpcCalls[0].args.p_observed_currency, 'CNY');
    assert.equal(state.rpcCalls[0].args.p_observed_amount, '12.34');
    assert.equal(state.rpcCalls[0].args.p_observed_site, 'intl');
    assert.equal(state.events[0].observed_currency, 'CNY');
});

test('a NOWPayments callback that hits a ZPay merchant order is rejected unbound', async () => {
    const payment = {
        id: PAYMENT_ID,
        guest_order_id: ORDER_ID,
        merchant_order_no: ORDER_NO,
        purpose: 'shop_direct',
        provider: 'zpay',
        channel: 'alipay',
        site: 'cn',
        currency: 'CNY',
        expected_amount: '12.34',
        provider_order_no: 'ZPAY-TRADE-1',
        checkout_reference: 'https://zpay.example/pay/1',
        provider_metadata: {}
    };
    const { handlers, state } = createHandlers({
        provider: 'nowpayments',
        payment,
        paymentAdapter: {
            async verifyGuestWebhook() {
                return { valid: true, signature_version: 'HMAC-SHA512' };
            },
            async parseGuestWebhook({ payload }) {
                return {
                    merchant_order_no: payload.order_id,
                    provider_order_no: payload.order_id,
                    provider_payment_id: payload.payment_id,
                    event_key: `nowpayments:${payload.payment_id}`,
                    purpose: 'shop_direct',
                    currency: 'CNY',
                    provider_currency: 'usd',
                    price_amount: payload.price_amount,
                    paid_amount: payload.price_amount,
                    actually_paid_text: payload.actually_paid,
                    pay_currency: payload.pay_currency,
                    network_verified: true,
                    final_status: 'paid'
                };
            }
        }
    });
    const response = createResponse();
    await handlers.webhook(makeNowpaymentsRequest({
        payment_id: 'NP-CROSS-ZPAY-1',
        order_id: ORDER_NO
    }), response, 'nowpayments');

    assert.equal(response.statusCode, 202);
    assert.equal(response.payload.accepted, false);
    assert.equal(state.rpcCalls.length, 0);
    assert.equal(state.events.length, 1);
    assert.equal(state.events[0].payment_order_id, null);
    assert.equal(state.events[0].provider, 'nowpayments');
    assert.equal(state.events[0].merchant_order_no, ORDER_NO);
    assert.equal(state.events[0].processing_status, 'rejected');
    assert.match(state.events[0].event_key, /^nowpayments:invalid-bucket:/u);
});

test('a ZPay callback that hits a NOWPayments merchant order is rejected unbound', async () => {
    const payment = {
        id: PAYMENT_ID,
        guest_order_id: ORDER_ID,
        merchant_order_no: ORDER_NO,
        purpose: 'shop_direct',
        provider: 'nowpayments',
        channel: 'nowpayments',
        site: 'intl',
        currency: 'CNY',
        expected_amount: '12.34',
        provider_order_no: 'NP-INTL-1',
        checkout_reference: 'NP-INTL-1',
        provider_metadata: {}
    };
    const { handlers, state } = createHandlers({
        provider: 'zpay',
        payment
    });
    const response = createResponse();
    await handlers.webhook(makeRequest('valid-signature'), response, 'zpay');

    assert.equal(response.statusCode, 202);
    assert.equal(response.payload.accepted, false);
    assert.equal(state.rpcCalls.length, 0);
    assert.equal(state.events.length, 1);
    assert.equal(state.events[0].payment_order_id, null);
    assert.equal(state.events[0].provider, 'zpay');
    assert.equal(state.events[0].merchant_order_no, ORDER_NO);
    assert.equal(state.events[0].processing_status, 'rejected');
    assert.match(state.events[0].event_key, /^zpay:invalid-bucket:/u);
});
