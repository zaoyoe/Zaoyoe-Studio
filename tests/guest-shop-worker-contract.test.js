'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const worker = require('../server/guest-shop-worker');

function responseRecorder() {
    return {
        statusCode: 0,
        headers: {},
        body: '',
        setHeader(name, value) { this.headers[name] = value; },
        end(value) { this.body = String(value || ''); },
        status(value) { this.statusCode = value; return this; }
    };
}

test('guest worker requires a dedicated secret and supports bearer/header auth', () => {
    assert.equal(worker.authorizeGuestShopWorkerRequest({ headers: {} }, {}).ok, false);
    assert.equal(worker.authorizeGuestShopWorkerRequest({ headers: {} }, { GUEST_SHOP_WORKER_SECRET: 'secret' }).status, 401);
    assert.equal(worker.authorizeGuestShopWorkerRequest({ headers: { authorization: 'Bearer secret' } }, { GUEST_SHOP_WORKER_SECRET: 'secret' }).ok, true);
    assert.equal(worker.authorizeGuestShopWorkerRequest({ headers: { 'x-guest-shop-worker-secret': 'secret' } }, { GUEST_SHOP_WORKER_SECRET: 'secret' }).ok, true);
});

test('guest worker backoff is exponential, capped, and bounded by jitter', () => {
    assert.equal(worker.calculateGuestShopBackoffMs(1, { baseBackoffMs: 1000, maxBackoffMs: 5000, jitterRatio: 0 }), 1000);
    assert.equal(worker.calculateGuestShopBackoffMs(3, { baseBackoffMs: 1000, maxBackoffMs: 5000, jitterRatio: 0 }), 4000);
    assert.equal(worker.calculateGuestShopBackoffMs(9, { baseBackoffMs: 1000, maxBackoffMs: 5000, jitterRatio: 0 }), 5000);
    assert.equal(worker.calculateGuestShopBackoffMs(1, { baseBackoffMs: 1000, maxBackoffMs: 5000, jitterRatio: 0.2, random: () => 0 }), 800);
    assert.equal(worker.calculateGuestShopBackoffMs(1, { baseBackoffMs: 1000, maxBackoffMs: 5000, jitterRatio: 0.2, random: () => 1 }), 1000);
});

test('guest worker does not steal a non-expired persisted lease', () => {
    const now = Date.parse('2026-09-13T00:00:00.000Z');
    assert.equal(
        worker.getActiveLeaseKind({
            fulfillment_lease_token: 'other-worker',
            fulfillment_lease_expires_at: '2026-09-13T00:01:00.000Z'
        }, now),
        'fulfillment'
    );
    assert.equal(
        worker.getActiveLeaseKind({
            refund_lease_token: 'expired-worker',
            refund_lease_expires_at: '2026-09-12T23:59:00.000Z'
        }, now),
        ''
    );
});

test('guest worker endpoint is secret-gated and never accepts an order payload', async () => {
    const handler = worker.createGuestShopWorkerHandler({
        env: { GUEST_SHOP_WORKER_SECRET: 'secret' },
        admin: { getOptionalSupabaseAdmin: () => ({}) },
        workerFactory: () => ({ runOnce: async () => ({ success: true, scanned: 0 }) })
    });
    const unauthorized = responseRecorder();
    await handler({ method: 'POST', headers: {}, body: { order_id: 'attacker' } }, unauthorized);
    assert.equal(unauthorized.statusCode, 401);
    assert.match(unauthorized.body, /invalid_worker_secret/);

    const authorized = responseRecorder();
    await handler({ method: 'POST', headers: { 'x-guest-shop-worker-secret': 'secret' }, body: { order_id: 'attacker' } }, authorized);
    assert.equal(authorized.statusCode, 200);
    assert.deepEqual(JSON.parse(authorized.body), { success: true, scanned: 0 });
});

test('guest worker rejects a declared request body before database work', async () => {
    let factoryCalls = 0;
    const handler = worker.createGuestShopWorkerHandler({
        env: { GUEST_SHOP_WORKER_SECRET: 'secret' },
        admin: { getOptionalSupabaseAdmin: () => ({}) },
        workerFactory: () => {
            factoryCalls += 1;
            return { runOnce: async () => ({ success: true }) };
        }
    });
    const response = responseRecorder();
    await handler({
        method: 'POST',
        headers: {
            'content-length': '48',
            'x-guest-shop-worker-secret': 'secret'
        }
    }, response);
    assert.equal(response.statusCode, 400);
    assert.match(response.body, /worker_body_not_allowed/);
    assert.equal(factoryCalls, 0);
});

test('guest worker implementation uses persistent order metadata and atomic fulfillment/refund RPCs', () => {
    const source = fs.readFileSync(path.join(root, 'server/guest-shop-worker.js'), 'utf8');
    assert.match(source, /guest_shop_orders/);
    assert.match(source, /metadata/);
    assert.match(source, /fn_guest_shop_claim_fulfillment/);
    assert.match(source, /fn_guest_shop_mark_fulfilled/);
    assert.match(source, /fn_guest_shop_record_refund_result/);
    assert.match(source, /fn_guest_shop_release_expired_reservations/);
    assert.match(source, /dead_letter/);
    assert.match(source, /paid_unfulfillable/);
    assert.match(source, /GUEST_SHOP_WORKER_SECRET/);
    assert.doesNotMatch(source, /setImmediate\(/);
});

test('guest worker does not return inventory content from its public endpoint', () => {
    const source = fs.readFileSync(path.join(root, 'api/shop/guest/worker.js'), 'utf8');
    assert.match(source, /createGuestShopWorkerHandler/);
    assert.doesNotMatch(source, /content/);
    assert.doesNotMatch(source, /claim_secret/);
});

test('guest worker durably claims and marks a paid order without exposing content', async () => {
    const order = {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        order_no: 'GS-1',
        site: 'cn',
        currency: 'CNY',
        total_amount: '1.00',
        payment_status: 'confirmed',
        reservation_status: 'held',
        fulfillment_status: 'pending',
        refund_status: 'none',
        updated_at: '2026-09-13T00:00:00.000Z',
        metadata: {}
    };
    const reservation = {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        order_id: order.id,
        inventory_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        status: 'held',
        reserved_until: '2026-09-13T01:00:00.000Z'
    };
    const calls = [];

    function containsValue(actual, expected) {
        if (!expected || typeof expected !== 'object') return actual === expected;
        if (!actual || typeof actual !== 'object') return false;
        return Object.entries(expected).every(([key, value]) => containsValue(actual[key], value));
    }

    function makeQuery(table) {
        const query = {
            table,
            op: 'select',
            payload: null,
            filters: [],
            ordering: null,
            maxRows: null,
            single: false,
            select() { this.op = this.op === 'update' ? 'update' : 'select'; return this; },
            update(payload) { this.op = 'update'; this.payload = payload; return this; },
            eq(field, value) { this.filters.push({ type: 'eq', field, value }); return this; },
            in(field, values) { this.filters.push({ type: 'in', field, values }); return this; },
            contains(field, value) { this.filters.push({ type: 'contains', field, value }); return this; },
            order(field, options) { this.ordering = { field, options }; return this; },
            limit(value) { this.maxRows = value; return this; },
            maybeSingle() { this.single = true; return this; },
            async then(resolve, reject) {
                try {
                    const rows = tableRows(this.table).filter((row) => this.filters.every((filter) => {
                        if (filter.type === 'eq') return row[filter.field] === filter.value;
                        if (filter.type === 'in') return filter.values.includes(row[filter.field]);
                        return containsValue(row[filter.field], filter.value);
                    }));
                    if (this.ordering) {
                        const { field, options } = this.ordering;
                        rows.sort((a, b) => String(a[field] || '').localeCompare(String(b[field] || '')));
                        if (options?.ascending === false) rows.reverse();
                    }
                    const limited = this.maxRows ? rows.slice(0, this.maxRows) : rows;
                    if (this.op === 'update') {
                        for (const row of limited) Object.assign(row, this.payload);
                    }
                    const data = this.single ? (limited[0] || null) : limited;
                    resolve({ data, error: null });
                } catch (error) {
                    reject(error);
                }
            }
        };
        return query;
    }

    const rowsByTable = {
        guest_shop_orders: [order],
        guest_shop_inventory_reservations: [reservation],
        guest_shop_payment_orders: []
    };
    function tableRows(table) { return rowsByTable[table] || []; }
    const supabase = {
        from(table) { return makeQuery(table); },
        async rpc(name, params) {
            calls.push({ name, params });
            if (name === 'fn_guest_shop_release_expired_reservations') {
                return { data: [{ processed_count: 0, released_count: 0, unfulfillable_count: 0 }], error: null };
            }
            if (name === 'fn_guest_shop_claim_fulfillment') {
                order.reservation_status = 'consumed';
                order.fulfillment_status = 'fulfilling';
                reservation.status = 'consumed';
                return {
                    data: [{
                        order_id: order.id,
                        reservation_id: reservation.id,
                        inventory_id: reservation.inventory_id,
                        content: 'CARD-CONTENT-MUST-STAY-SERVER-SIDE',
                        fulfillment_status: 'fulfilling',
                        reservation_status: 'consumed'
                    }],
                    error: null
                };
            }
            if (name === 'fn_guest_shop_mark_fulfilled') {
                order.fulfillment_status = 'delivered';
                return {
                    data: [{ fulfilled: true, fulfillment_status: 'delivered', fulfilled_at: '2026-09-13T00:00:01.000Z' }],
                    error: null
                };
            }
            throw new Error(`unexpected rpc ${name}`);
        }
    };
    const logs = [];
    const instance = worker.createGuestShopWorker({
        supabase,
        env: {
            GUEST_SHOP_WORKER_BASE_BACKOFF_MS: '1000',
            GUEST_SHOP_WORKER_RETRY_JITTER_RATIO: '0'
        },
        now: () => new Date('2026-09-13T00:00:00.000Z'),
        logger: { error: (...args) => logs.push(args), warn: (...args) => logs.push(args) }
    });

    const summary = await instance.runOnce({ limit: 1 });
    assert.equal(summary.delivered, 1);
    assert.equal(summary.errors, 0);
    assert.equal(order.fulfillment_status, 'delivered');
    assert.deepEqual(calls.map((call) => call.name), [
        'fn_guest_shop_release_expired_reservations',
        'fn_guest_shop_claim_fulfillment',
        'fn_guest_shop_mark_fulfilled'
    ]);
    assert.equal(JSON.stringify(summary).includes('CARD-CONTENT'), false);
    assert.equal(JSON.stringify(logs).includes('CARD-CONTENT'), false);
});

function containsValue(actual, expected) {
    if (!expected || typeof expected !== 'object' || expected === null) return actual === expected;
    if (!actual || typeof actual !== 'object') return false;
    return Object.entries(expected).every(([key, value]) => containsValue(actual[key], value));
}

function makeWorkerQuery(table, rowsByTable) {
    const query = {
        table,
        op: 'select',
        payload: null,
        filters: [],
        ordering: null,
        maxRows: null,
        single: false,
        select() {
            this.op = this.op === 'update' ? 'update' : 'select';
            return this;
        },
        update(payload) {
            this.op = 'update';
            this.payload = payload;
            return this;
        },
        eq(field, value) {
            this.filters.push({ type: 'eq', field, value });
            return this;
        },
        in(field, values) {
            this.filters.push({ type: 'in', field, values });
            return this;
        },
        contains(field, value) {
            this.filters.push({ type: 'contains', field, value });
            return this;
        },
        order(field, options) {
            this.ordering = { field, options };
            return this;
        },
        limit(value) {
            this.maxRows = value;
            return this;
        },
        maybeSingle() {
            this.single = true;
            return this;
        },
        async then(resolve, reject) {
            try {
                const rows = (rowsByTable[this.table] || []).filter((row) => this.filters.every((filter) => {
                    if (filter.type === 'eq') return row[filter.field] === filter.value;
                    if (filter.type === 'in') return filter.values.includes(row[filter.field]);
                    return containsValue(row[filter.field], filter.value);
                }));
                if (this.ordering) {
                    const { field, options } = this.ordering;
                    rows.sort((a, b) => String(a[field] || '').localeCompare(String(b[field] || '')));
                    if (options?.ascending === false) rows.reverse();
                }
                const limited = this.maxRows ? rows.slice(0, this.maxRows) : rows;
                if (this.op === 'update') {
                    for (const row of limited) Object.assign(row, this.payload);
                }
                const data = this.single ? (limited[0] || null) : limited;
                resolve({ data, error: null });
            } catch (error) {
                reject(error);
            }
        }
    };
    return query;
}

function createCandidateOrder(overrides = {}) {
    return {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        order_no: 'GS-CANDIDATE',
        site: 'cn',
        currency: 'CNY',
        total_amount: '1.00',
        payment_status: 'confirmed',
        reservation_status: 'consumed',
        fulfillment_status: 'pending',
        refund_status: 'none',
        updated_at: '2026-09-14T00:00:00.000Z',
        metadata: {},
        ...overrides
    };
}

test('guest worker candidate scan uses two queries so delivered refunds are not hidden', () => {
    const source = fs.readFileSync(path.join(root, 'server/guest-shop-worker.js'), 'utf8');
    assert.deepEqual([...worker.REFUND_CANDIDATE_STATUSES], ['pending', 'failed']);
    assert.match(source, /Two queries, then merge by id/);
    assert.match(source, /fulfillment_status === 'dead_letter' && !needsRefund/);
    assert.match(source, /refund_status in \(pending, failed\)|REFUND_CANDIDATE_STATUSES/);
    assert.doesNotMatch(source, /query\.or\(/);
});

test('guest worker loadCandidates includes delivered orders with a pending refund', async () => {
    const deliveredRefund = createCandidateOrder({
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        order_no: 'GS-DELIVERED-REFUND',
        fulfillment_status: 'delivered',
        refund_status: 'pending',
        updated_at: '2026-09-14T00:00:02.000Z'
    });
    const pendingFulfillment = createCandidateOrder({
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        order_no: 'GS-PENDING',
        fulfillment_status: 'pending',
        refund_status: 'none',
        updated_at: '2026-09-14T00:00:01.000Z'
    });
    const deadLetterNoRefund = createCandidateOrder({
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        order_no: 'GS-DEAD',
        fulfillment_status: 'dead_letter',
        refund_status: 'none',
        updated_at: '2026-09-14T00:00:00.000Z',
        metadata: {
            __guest_shop_worker: {
                fulfillment_status: 'dead_letter'
            }
        }
    });
    const rowsByTable = {
        guest_shop_orders: [deliveredRefund, pendingFulfillment, deadLetterNoRefund],
        guest_shop_inventory_reservations: [],
        guest_shop_payment_orders: []
    };
    const instance = worker.createGuestShopWorker({
        supabase: {
            from(table) { return makeWorkerQuery(table, rowsByTable); },
            async rpc() { return { data: [{ processed_count: 0 }], error: null }; }
        },
        now: () => new Date('2026-09-14T00:00:00.000Z'),
        logger: { error() {}, warn() {} }
    });

    const candidates = await instance.loadCandidates(10);
    const ids = candidates.map((row) => row.id);
    assert.deepEqual(ids, [pendingFulfillment.id, deliveredRefund.id]);
    assert.equal(ids.includes(deadLetterNoRefund.id), false);
});

test('guest worker processes a dead-lettered order that an admin queued for refund', async () => {
    const order = createCandidateOrder({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        order_no: 'GS-DEAD-REFUND',
        fulfillment_status: 'dead_letter',
        refund_status: 'pending',
        updated_at: '2026-09-14T00:00:00.000Z',
        metadata: {
            __guest_shop_worker: {
                fulfillment_status: 'dead_letter',
                refund_status: 'retry_waiting'
            }
        }
    });
    const payment = {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        guest_order_id: order.id,
        merchant_order_no: order.order_no,
        purpose: 'shop_direct',
        provider: 'zpay',
        channel: 'alipay',
        provider_order_no: 'P-DEAD-1',
        provider_metadata: {}
    };
    const rowsByTable = {
        guest_shop_orders: [order],
        guest_shop_inventory_reservations: [],
        guest_shop_payment_orders: [payment]
    };
    const calls = [];
    const instance = worker.createGuestShopWorker({
        supabase: {
            from(table) { return makeWorkerQuery(table, rowsByTable); },
            async rpc(name, params) {
                calls.push({ name, params });
                if (name === 'fn_guest_shop_release_expired_reservations') {
                    return { data: [{ processed_count: 0, released_count: 0, unfulfillable_count: 0 }], error: null };
                }
                if (name === 'fn_guest_shop_record_refund_result') {
                    order.refund_status = params.p_refund_status;
                    return {
                        data: [{ refund_status: params.p_refund_status, payment_status: 'refunded' }],
                        error: null
                    };
                }
                throw new Error(`unexpected rpc ${name}`);
            }
        },
        paymentAdapter: {
            async refundGuestPayment() {
                return { success: true, provider_ref: 'R-DEAD-1' };
            }
        },
        env: {
            GUEST_SHOP_WORKER_BASE_BACKOFF_MS: '1000',
            GUEST_SHOP_WORKER_RETRY_JITTER_RATIO: '0'
        },
        now: () => new Date('2026-09-14T00:00:00.000Z'),
        logger: { error() {}, warn() {} }
    });

    const summary = await instance.runOnce({ limit: 5 });
    assert.equal(summary.scanned, 1);
    assert.equal(summary.skipped, 0);
    assert.equal(summary.refunded, 1);
    assert.equal(summary.errors, 0);
    assert.equal(calls.some((call) => call.name === 'fn_guest_shop_record_refund_result'), true);
    assert.equal(calls.some((call) => call.name === 'fn_guest_shop_claim_fulfillment'), false);
});
