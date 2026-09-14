'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createGuestShopHandlers } = require('../server/api-handlers/public/guest-shop');

const ORDER_ID = '33333333-3333-4333-8333-333333333333';
const INVENTORY_ID = '55555555-5555-4555-8555-555555555555';
const ORDER_NO = 'GS20260913-000001';

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

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

function createSupabaseStub(initial = {}) {
    const state = {
        order: {
            id: ORDER_ID,
            order_no: ORDER_NO,
            claim_secret_hash: 'stored-claim-hash',
            claim_attempt_count: 0,
            last_error_code: null,
            last_error_message: null,
            payment_status: 'confirmed',
            fulfillment_status: 'delivered',
            refund_status: 'none',
            total_amount: '12.34',
            currency: 'CNY',
            expires_at: '2099-01-01T00:00:00.000Z',
            ...initial.order
        },
        reservation: {
            order_id: ORDER_ID,
            inventory_id: INVENTORY_ID,
            status: 'consumed',
            ...initial.reservation
        },
        inventory: {
            id: INVENTORY_ID,
            content: 'card-content',
            is_shared: false,
            status: 'sold',
            ...initial.inventory
        },
        updateCalls: 0
    };

    function rowsFor(table) {
        if (table === 'guest_shop_orders') return [state.order];
        if (table === 'guest_shop_inventory_reservations') return [state.reservation];
        if (table === 'shop_inventory') return [state.inventory];
        return [];
    }

    function createBuilder(table, operation = 'select', patch = null) {
        const filters = [];
        const query = {
            select() { return query; },
            update(nextPatch) { return createBuilder(table, 'update', nextPatch); },
            eq(field, value) {
                filters.push({ type: 'eq', field: String(field), value });
                return query;
            },
            is(field, value) {
                filters.push({ type: 'is', field: String(field), value });
                return query;
            },
            async maybeSingle() { return execute(); },
            then(resolve, reject) { return execute().then(resolve, reject); }
        };

        async function execute() {
            // Force concurrent requests to observe the same stale value before
            // the conditional update is evaluated.
            await new Promise((resolve) => setImmediate(resolve));
            const rows = rowsFor(table);
            const matches = rows.filter((row) => filters.every((filter) => {
                if (filter.type === 'is') return filter.value === null ? row?.[filter.field] == null : row?.[filter.field] === filter.value;
                return row?.[filter.field] === filter.value;
            }));
            if (operation !== 'update') return { data: clone(matches[0] || null), error: null };
            state.updateCalls += 1;
            const row = matches[0];
            if (!row) return { data: null, error: null };
            Object.assign(row, clone(patch));
            return { data: clone(row), error: null };
        }

        return query;
    }

    return {
        state,
        from(table) {
            return {
                select() { return createBuilder(table, 'select'); },
                update(patch) { return createBuilder(table, 'update', patch); }
            };
        }
    };
}

function createHandlers(initial = {}) {
    const supabase = createSupabaseStub(initial);
    const security = {
        readJsonBodyWithLimit(req) { return req.body; },
        verifyClaimSecret(secret, storedHash) {
            return secret === 'valid-secret' && storedHash === 'stored-claim-hash';
        }
    };
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
        env: { APP_ENV: 'test' }
    });
    return { handlers, state: supabase.state };
}

function invalidRequest() {
    return {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-guest-claim-secret': 'wrong-secret'
        },
        body: { orderNo: ORDER_NO }
    };
}

function validRequest() {
    return {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-guest-claim-secret': 'valid-secret'
        },
        body: { orderNo: ORDER_NO }
    };
}

test('concurrent invalid credentials increment the bounded claim counter without losing updates', async () => {
    const { handlers, state } = createHandlers();
    const first = createResponse();
    const second = createResponse();

    await Promise.all([
        handlers.claim(invalidRequest(), first),
        handlers.claim(invalidRequest(), second)
    ]);

    assert.equal(first.statusCode, 403);
    assert.equal(second.statusCode, 403);
    assert.equal(state.order.claim_attempt_count, 2);
    assert.equal(state.order.last_error_code, 'guest_claim_invalid');
    assert.equal(state.order.last_error_message, '取货凭证校验失败');
});

test('claim failure audit preserves an existing payment or fulfillment error', async () => {
    const { handlers, state } = createHandlers({
        order: {
            last_error_code: 'payment_creation_unknown',
            last_error_message: '支付创建结果未知，请对账确认'
        }
    });
    const response = createResponse();
    await handlers.claim(invalidRequest(), response);

    assert.equal(response.statusCode, 403);
    assert.equal(state.order.claim_attempt_count, 1);
    assert.equal(state.order.last_error_code, 'payment_creation_unknown');
    assert.equal(state.order.last_error_message, '支付创建结果未知，请对账确认');
});

test('claim failure audit caps writes at twenty attempts and valid claim remains usable', async () => {
    const { handlers, state } = createHandlers({
        order: { claim_attempt_count: 20 }
    });
    const invalid = createResponse();
    await handlers.claim(invalidRequest(), invalid);
    assert.equal(invalid.statusCode, 403);
    assert.equal(state.order.claim_attempt_count, 20);
    assert.equal(state.updateCalls, 0);

    const valid = createResponse();
    await handlers.claim(validRequest(), valid);
    assert.equal(valid.statusCode, 200);
    assert.equal(valid.payload.success, true);
    assert.equal(valid.payload.content, 'card-content');
    assert.equal(state.order.claim_attempt_count, 20);
});
