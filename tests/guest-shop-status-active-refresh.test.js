'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const realSecurity = require('../api/_lib/guest-shop/security');
const { createGuestShopHandlers } = require('../server/api-handlers/public/guest-shop');

const ORDER_ID = '33333333-3333-4333-8333-333333333333';
const PAYMENT_ID = '44444444-4444-4444-8444-444444444444';
const ORDER_NO = 'GS20260916-000777';

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createResponse() {
    const state = { statusCode: 200, headers: {}, body: '' };
    return {
        setHeader(name, value) { state.headers[String(name).toLowerCase()] = value; return this; },
        status(code) { state.statusCode = code; return this; },
        end(body = '') { state.body = String(body); return this; },
        get statusCode() { return state.statusCode; },
        get headers() { return state.headers; },
        get payload() { return state.body ? JSON.parse(state.body) : null; }
    };
}

function makeOrder(overrides = {}) {
    return {
        id: ORDER_ID,
        order_no: ORDER_NO,
        payment_order_id: PAYMENT_ID,
        site: 'cn',
        claim_secret_hash: 'stored-claim-hash',
        claim_attempt_count: 0,
        last_error_code: null,
        last_error_message: null,
        payment_status: 'pending',
        fulfillment_status: 'pending',
        refund_status: 'none',
        total_amount: '12.34',
        currency: 'CNY',
        expires_at: '2099-01-01T00:00:00.000Z',
        ...overrides
    };
}

function makePayment(overrides = {}) {
    const checkoutUrl = 'https://pay.example.test/checkout?id=1';
    return {
        id: PAYMENT_ID,
        guest_order_id: ORDER_ID,
        merchant_order_no: ORDER_NO,
        purpose: 'shop_direct',
        provider: 'zpay',
        channel: 'alipay',
        site: 'cn',
        currency: 'CNY',
        status: 'created',
        provider_order_no: ORDER_NO,
        expected_amount: '12.34',
        checkout_reference: checkoutUrl,
        provider_metadata: {
            provider: 'zpay',
            purpose: 'shop_direct',
            provider_order_no: ORDER_NO,
            trade_no: 'ZP-TRADE-0001',
            checkout_url: checkoutUrl,
            qrcode_url: 'https://pay.example.test/qr?id=1'
        },
        ...overrides
    };
}

function makeZpayQueryResult(overrides = {}) {
    return {
        supported: true,
        provider: 'zpay',
        purpose: 'shop_direct',
        merchant_order_no: ORDER_NO,
        provider_order_no: ORDER_NO,
        trade_no: 'ZP-TRADE-0001',
        transaction_id: 'ZP-TRADE-0001',
        status: 'paid',
        status_raw: 'TRADE_SUCCESS',
        amount: 12.34,
        paid_amount: 12.34,
        currency: 'CNY',
        response_payload: {
            trade_status: 'TRADE_SUCCESS',
            money: '12.34',
            out_trade_no: ORDER_NO,
            trade_no: 'ZP-TRADE-0001',
            sign: 'do-not-leak-signature'
        },
        ...overrides
    };
}

/**
 * PostgREST-shaped double for the status endpoint. It supports the select,
 * update, insert and rpc calls the active-query self-healing path performs and
 * records each side effect so tests can assert it never runs when it should
 * not.
 */
function createSupabaseStub({ order = makeOrder(), payment = makePayment() } = {}) {
    const state = {
        order,
        payment,
        events: [],
        orderReads: 0,
        paymentReads: 0,
        eventReads: 0,
        eventInserts: 0,
        metadataUpdates: 0,
        confirmCalls: 0,
        confirmParams: null
    };
    let eventSequence = 0;

    const rowsFor = (table) => {
        if (table === 'guest_shop_orders') return [state.order];
        if (table === 'guest_shop_payment_orders') return [state.payment];
        if (table === 'guest_shop_payment_events') return state.events;
        return [];
    };

    function createBuilder(table, operation = 'select', payload = null) {
        const filters = [];
        const matches = () => rowsFor(table).filter((row) => filters.every((filter) => {
            if (filter.type === 'is') {
                return filter.value === null ? row?.[filter.field] == null : row?.[filter.field] === filter.value;
            }
            return row?.[filter.field] === filter.value;
        }));

        async function execute(single) {
            if (operation === 'select' && table === 'guest_shop_orders') state.orderReads += 1;
            if (operation === 'select' && table === 'guest_shop_payment_orders') state.paymentReads += 1;
            if (operation === 'select' && table === 'guest_shop_payment_events') state.eventReads += 1;
            if (operation === 'update') {
                if (table === 'guest_shop_payment_orders') state.metadataUpdates += 1;
                for (const row of matches()) Object.assign(row, clone(payload));
                return { data: single ? (matches()[0] || null) : matches(), error: null };
            }
            if (operation === 'insert') {
                if (table === 'guest_shop_payment_events') state.eventInserts += 1;
                const row = { id: `event-${++eventSequence}`, processing_status: 'received', ...clone(payload) };
                rowsFor(table).push(row);
                return { data: single ? clone(row) : [clone(row)], error: null };
            }
            return { data: single ? (matches()[0] || null) : matches(), error: null };
        }

        const builder = {
            select() { return builder; },
            update(patch) { return createBuilder(table, 'update', patch); },
            insert(row) { return createBuilder(table, 'insert', row); },
            eq(field, value) { filters.push({ type: 'eq', field: String(field), value }); return builder; },
            is(field, value) { filters.push({ type: 'is', field: String(field), value }); return builder; },
            maybeSingle() { return execute(true); },
            single() { return execute(true); },
            then(resolve, reject) { return execute(false).then(resolve, reject); }
        };
        return builder;
    }

    return {
        state,
        from(table) {
            return {
                select() { return createBuilder(table, 'select'); },
                update(patch) { return createBuilder(table, 'update', patch); },
                insert(row) { return createBuilder(table, 'insert', row); }
            };
        },
        async rpc(name, params = {}) {
            if (name !== 'fn_guest_shop_confirm_payment') {
                return { data: null, error: { message: `unsupported rpc ${name}` } };
            }
            state.confirmCalls += 1;
            state.confirmParams = params;
            const event = state.events.find((row) => row.id === params.p_event_id);
            if (!event) return { data: null, error: { message: 'guest_payment_event_not_found' } };
            event.processing_status = 'processed';
            state.payment.status = 'confirmed';
            state.payment.paid_amount = params.p_observed_amount;
            state.payment.provider_order_no = params.p_provider_order_no;
            state.order.payment_status = 'confirmed';
            state.order.paid_at = '2026-09-16T00:00:00.000Z';
            return { data: [{ confirmed: true, payment_status: 'confirmed' }], error: null };
        }
    };
}

function createHandlers({ supabase, adapter } = {}) {
    const security = Object.assign({}, realSecurity, {
        // Authorization is covered by the status-recovery suite; here we only
        // need a deterministic success/failure boundary.
        verifyClaimSecret(secret) { return String(secret || '') === 'valid-secret'; }
    });
    const handlers = createGuestShopHandlers({
        admin: {
            getOptionalSupabaseAdmin() { return supabase; },
            sendJson(res, status, payload) {
                res.status(status);
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify(payload));
            }
        },
        requestSecurity: {
            async takeRateLimitToken() { return { allowed: true }; },
            applyRateLimitHeaders() {},
            resolveClientIp() { return '198.51.100.10'; }
        },
        security,
        paymentAdapter: adapter,
        env: { APP_ENV: 'test' }
    });
    return handlers;
}

function makeAdapter({ result, error } = {}) {
    const state = { queries: [] };
    return {
        state,
        async queryGuestPayment(args) {
            state.queries.push(args);
            if (error) throw error;
            return typeof result === 'function' ? result(args) : clone(result);
        }
    };
}

function statusRequest({ secret = 'valid-secret', force = false } = {}) {
    const query = { orderNo: ORDER_NO };
    if (force) query.force_provider_refresh = '1';
    const headers = secret === undefined ? {} : { 'x-guest-claim-secret': secret };
    return { method: 'GET', query, headers };
}

test('lost webhook self-heals through the active provider query and confirm RPC', async () => {
    const supabase = createSupabaseStub();
    const adapter = makeAdapter({ result: makeZpayQueryResult() });
    const handlers = createHandlers({ supabase, adapter });
    const response = createResponse();

    await handlers.status(statusRequest(), response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.success, true);
    assert.equal(response.payload.order.payment_status, 'confirmed');
    assert.equal(Object.prototype.hasOwnProperty.call(response.payload, 'checkout'), false);
    assert.equal(adapter.state.queries.length, 1);

    const query = adapter.state.queries[0];
    assert.equal(query.provider, 'zpay');
    assert.equal(query.providerOrderNo, ORDER_NO);
    assert.equal(query.merchantOrderNo, ORDER_NO);
    assert.equal(query.tradeNo, 'ZP-TRADE-0001');
    assert.equal(query.site, 'cn');

    assert.equal(supabase.state.eventInserts, 1);
    const event = supabase.state.events[0];
    assert.equal(event.provider, 'zpay');
    assert.equal(event.event_key, `zpay:status-query:${PAYMENT_ID}`);
    assert.equal(event.provider_order_no, ORDER_NO);
    assert.equal(event.merchant_order_no, ORDER_NO);
    assert.equal(Number(event.observed_amount), 12.34);
    assert.equal(event.observed_status, 'paid');
    assert.equal(event.signature_version, 'query_api');
    assert.equal(event.signature_verified, true);
    assert.equal(event.amount_verified, true);
    assert.equal(event.currency_verified, true);
    assert.equal(event.final_status_verified, true);
    assert.equal(event.processing_status, 'processed');
    assert.match(event.body_sha256, /^[0-9a-f]{64}$/);
    assert.doesNotMatch(JSON.stringify(event), /do-not-leak-signature|stored-claim-hash/);

    assert.equal(supabase.state.confirmCalls, 1);
    assert.equal(supabase.state.confirmParams.p_provider, 'zpay');
    assert.equal(supabase.state.confirmParams.p_provider_order_no, ORDER_NO);
    assert.equal(supabase.state.confirmParams.p_observed_site, 'cn');
    assert.equal(supabase.state.confirmParams.p_observed_currency, 'CNY');
    assert.equal(Number(supabase.state.confirmParams.p_observed_amount), 12.34);
    assert.equal(supabase.state.confirmParams.p_observed_purpose, 'shop_direct');
    assert.equal(supabase.state.confirmParams.p_observed_status, 'paid');
    assert.equal(supabase.state.confirmParams.p_signature_verified, true);
    assert.equal(supabase.state.confirmParams.p_final_status_verified, true);
});

test('a non-final provider status never inserts an event or confirms the order', async () => {
    const supabase = createSupabaseStub();
    const adapter = makeAdapter({ result: makeZpayQueryResult({ status: 'waiting', status_raw: 'WAIT_BUYER_PAY', paid_amount: null, amount: null }) });
    const handlers = createHandlers({ supabase, adapter });
    const response = createResponse();

    await handlers.status(statusRequest(), response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.order.payment_status, 'pending');
    assert.equal(adapter.state.queries.length, 1);
    assert.equal(supabase.state.eventInserts, 0);
    assert.equal(supabase.state.confirmCalls, 0);
    assert.equal(supabase.state.metadataUpdates, 1);
    assert.equal(supabase.state.payment.provider_metadata.query_status, 'waiting');
});

test('an amount mismatch is recorded but never confirms a guest order', async () => {
    const supabase = createSupabaseStub();
    const adapter = makeAdapter({ result: makeZpayQueryResult({ amount: 99.99, paid_amount: 99.99 }) });
    const handlers = createHandlers({ supabase, adapter });
    const response = createResponse();

    await handlers.status(statusRequest(), response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.order.payment_status, 'pending');
    assert.equal(supabase.state.eventInserts, 0);
    assert.equal(supabase.state.confirmCalls, 0);
    assert.equal(supabase.state.payment.status, 'created');
    assert.equal(supabase.state.payment.provider_metadata.query_status, 'paid');
    assert.equal(supabase.state.payment.provider_metadata.query_error_code, 'guest_status_query_not_confirmed');
});

test('the active query is throttled unless the buyer forces a refresh', async () => {
    const recent = new Date().toISOString();
    const supabase = createSupabaseStub({
        payment: makePayment({ provider_metadata: { provider: 'zpay', purpose: 'shop_direct', provider_order_no: ORDER_NO, trade_no: 'ZP-TRADE-0001', query_verified_at: recent, status_poll_query_at: recent } })
    });
    const adapter = makeAdapter({ result: makeZpayQueryResult() });
    const handlers = createHandlers({ supabase, adapter });

    const throttled = createResponse();
    await handlers.status(statusRequest(), throttled);
    assert.equal(throttled.statusCode, 200);
    assert.equal(throttled.payload.order.payment_status, 'pending');
    assert.equal(adapter.state.queries.length, 0);

    // A forced refresh inside the background window is also throttled.
    const forcedThrottled = createResponse();
    await handlers.status(statusRequest({ force: true }), forcedThrottled);
    assert.equal(adapter.state.queries.length, 0);

    // Once the short forced window has elapsed the query runs and heals.
    supabase.state.payment.provider_metadata.query_verified_at = new Date(Date.now() - 3000).toISOString();
    const forced = createResponse();
    await handlers.status(statusRequest({ force: true }), forced);
    assert.equal(forced.statusCode, 200);
    assert.equal(adapter.state.queries.length, 1);
    assert.equal(forced.payload.order.payment_status, 'confirmed');
});

test('a non-forced poll waits for the background throttle window before querying', async () => {
    const supabase = createSupabaseStub({
        payment: makePayment({ provider_metadata: { provider: 'zpay', purpose: 'shop_direct', provider_order_no: ORDER_NO, query_verified_at: new Date(Date.now() - 3000).toISOString() } })
    });
    const adapter = makeAdapter({ result: makeZpayQueryResult() });
    const handlers = createHandlers({ supabase, adapter });

    const throttled = createResponse();
    await handlers.status(statusRequest(), throttled);
    assert.equal(adapter.state.queries.length, 0);
    assert.equal(throttled.payload.order.payment_status, 'pending');

    supabase.state.payment.provider_metadata.query_verified_at = new Date(Date.now() - 9000).toISOString();
    const refreshed = createResponse();
    await handlers.status(statusRequest(), refreshed);
    assert.equal(adapter.state.queries.length, 1);
    assert.equal(refreshed.payload.order.payment_status, 'confirmed');
});

test('a terminal order never reads the payment row or queries the provider', async () => {
    const supabase = createSupabaseStub({ order: makeOrder({ payment_status: 'confirmed', fulfillment_status: 'delivered' }) });
    const adapter = makeAdapter({ result: makeZpayQueryResult() });
    const handlers = createHandlers({ supabase, adapter });
    const response = createResponse();

    await handlers.status(statusRequest(), response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.order.payment_status, 'confirmed');
    assert.equal(supabase.state.paymentReads, 0);
    assert.equal(adapter.state.queries.length, 0);
    assert.equal(supabase.state.eventInserts, 0);
});

test('an invalid claim is rejected before any provider query', async () => {
    const supabase = createSupabaseStub();
    const adapter = makeAdapter({ result: makeZpayQueryResult() });
    const handlers = createHandlers({ supabase, adapter });
    const response = createResponse();

    await handlers.status(statusRequest({ secret: 'wrong-secret' }), response);

    assert.equal(response.statusCode, 403);
    assert.equal(response.payload.code, 'guest_claim_invalid');
    assert.equal(supabase.state.paymentReads, 0);
    assert.equal(adapter.state.queries.length, 0);
    assert.equal(supabase.state.confirmCalls, 0);
});

test('a provider query failure degrades to a normal pending status response', async () => {
    const supabase = createSupabaseStub();
    const adapter = makeAdapter({ error: Object.assign(new Error('provider timeout'), { code: 'guest_provider_unavailable' }) });
    const handlers = createHandlers({ supabase, adapter });
    const response = createResponse();

    await handlers.status(statusRequest(), response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.success, true);
    assert.equal(response.payload.order.payment_status, 'pending');
    assert.equal(supabase.state.eventInserts, 0);
    assert.equal(supabase.state.confirmCalls, 0);
    assert.equal(supabase.state.payment.provider_metadata.query_error_code, 'guest_provider_unavailable');
});

test('a confirm RPC failure stays a 200 pending response instead of surfacing an error', async () => {
    const supabase = createSupabaseStub();
    supabase.rpc = async () => ({ data: null, error: { message: 'guest_payment_binding_mismatch' } });
    const adapter = makeAdapter({ result: makeZpayQueryResult() });
    const handlers = createHandlers({ supabase, adapter });
    const response = createResponse();

    await handlers.status(statusRequest(), response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.success, true);
    assert.equal(response.payload.order.payment_status, 'pending');
});

test('an already processed query event is idempotent and never double-confirms', async () => {
    const supabase = createSupabaseStub();
    const adapter = makeAdapter({ result: makeZpayQueryResult() });
    const handlers = createHandlers({ supabase, adapter });

    const first = createResponse();
    await handlers.status(statusRequest(), first);
    assert.equal(supabase.state.confirmCalls, 1);

    // The order is now terminal, so a second poll neither queries nor confirms.
    const second = createResponse();
    await handlers.status(statusRequest(), second);
    assert.equal(adapter.state.queries.length, 1);
    assert.equal(supabase.state.confirmCalls, 1);
    assert.equal(supabase.state.eventInserts, 1);
    assert.equal(second.payload.order.payment_status, 'confirmed');
});
