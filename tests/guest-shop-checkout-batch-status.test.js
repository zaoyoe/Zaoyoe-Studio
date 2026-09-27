'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const security = require('../api/_lib/guest-shop/security');
const { createGuestShopHandlers } = require('../server/api-handlers/public/guest-shop');

const BATCH_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PAYMENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BATCH_NO = 'GCB-20260927045652-D790EFCD5153';
const PROVIDER_ORDER_NO = BATCH_NO;
const CLAIM_SECRET = 'batch-claim-proof-secret-01234567890123456789';
const ENV = {
    APP_ENV: 'test',
    APP_BASE_URL: 'https://www.fatherkey.com',
    GUEST_SHOP_CLAIM_PEPPER: 'guest-claim-pepper-012345678901234567890123456789'
};

function makeClaimCookie() {
    const pepper = security.getGuestClaimPepper(ENV, { required: true });
    const key = crypto.createHash('sha256')
        .update(`guest-shop-claim-cookie\0${pepper}`, 'utf8')
        .digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const plaintext = Buffer.from(JSON.stringify({
        v: 1,
        proofs: [{ orderNo: BATCH_NO, secret: CLAIM_SECRET, expiresAt: '2099-01-01T00:00:00.000Z' }]
    }), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return `guest_claim_proof=${encodeURIComponent([
        'v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')
    ].join('.'))}`;
}

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function makeRows(overrides = {}) {
    const batch = {
        id: BATCH_ID,
        batch_no: BATCH_NO,
        site: 'cn',
        currency: 'CNY',
        total_amount: '0.02',
        payment_status: 'pending',
        fulfillment_status: 'pending',
        refund_status: 'none',
        expires_at: '2099-01-01T00:00:00.000Z',
        claim_secret_hash: security.hashClaimSecret(CLAIM_SECRET, { env: ENV }),
        ...overrides.batch
    };
    const payment = {
        id: PAYMENT_ID,
        batch_id: BATCH_ID,
        merchant_order_no: BATCH_NO,
        provider: 'zpay',
        channel: 'alipay',
        provider_order_no: PROVIDER_ORDER_NO,
        site: 'cn',
        currency: 'CNY',
        expected_amount: '0.02',
        paid_amount: null,
        status: 'created',
        provider_metadata: {
            provider: 'zpay',
            purpose: 'shop_direct',
            provider_order_no: PROVIDER_ORDER_NO,
            checkout_url: 'https://pay.example.test/checkout',
            qrcode_url: 'https://pay.example.test/qr',
            qrcode_image_url: 'https://pay.example.test/qr.png',
            ...overrides.paymentMetadata
        },
        ...overrides.payment
    };
    const items = [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', batch_id: BATCH_ID, item_index: 0 }];
    return { batch, payment, items };
}

function createSupabase(rows) {
    const tables = {
        guest_shop_checkout_batches: [rows.batch],
        guest_shop_checkout_payments: [rows.payment],
        guest_shop_checkout_items: rows.items,
        guest_shop_payment_events: []
    };
    const calls = [];

    function builder(table, operation = 'select', patch = null) {
        const filters = [];
        const query = {
            select() { return query; },
            update(nextPatch) { return builder(table, 'update', nextPatch); },
            insert(nextRows) { return builder(table, 'insert', nextRows); },
            eq(field, value) { filters.push({ field, value }); return query; },
            in(field, values) { filters.push({ field, values }); return query; },
            order() { return query; },
            async maybeSingle() {
                const result = await execute();
                return { ...result, data: Array.isArray(result.data) ? (result.data[0] || null) : result.data };
            },
            async single() {
                const result = await execute();
                return { ...result, data: Array.isArray(result.data) ? (result.data[0] || null) : result.data };
            },
            then(resolve, reject) { return execute().then(resolve, reject); }
        };

        async function execute() {
            const tableRows = tables[table] || [];
            const matches = tableRows.filter((row) => filters.every((filter) => (
                filter.values ? filter.values.includes(row[filter.field]) : row[filter.field] === filter.value
            )));
            if (operation === 'insert') {
                const inserted = (Array.isArray(patch) ? patch : [patch]).map((row) => ({ id: crypto.randomUUID(), ...row }));
                for (const row of inserted) tableRows.push(row);
                return { data: inserted, error: null };
            }
            if (operation === 'update') {
                matches.forEach((row) => Object.assign(row, clone(patch)));
                return { data: clone(matches), error: null };
            }
            return { data: clone(matches), error: null };
        }
        return query;
    }

    return {
        tables,
        calls,
        from(table) {
            return {
                select() { return builder(table, 'select'); },
                update(patch) { return builder(table, 'update', patch); },
                insert(rowsToInsert) { return builder(table, 'insert', rowsToInsert); }
            };
        },
        async rpc(name, args) {
            calls.push({ name, args: clone(args) });
            if (name === 'fn_guest_shop_confirm_checkout_batch_payment') {
                rows.payment.status = 'confirmed';
                rows.payment.paid_amount = args.p_observed_amount;
                rows.payment.provider_order_no = args.p_provider_order_no;
                rows.batch.payment_status = 'confirmed';
                return { data: [{ batch_id: BATCH_ID, batch_no: BATCH_NO, payment_status: 'confirmed' }], error: null };
            }
            if (name === 'fn_guest_shop_claim_checkout_batch') {
                rows.batch.fulfillment_status = 'delivered';
                rows.batch.fulfilled_at = '2026-09-27T00:00:00.000Z';
                return { data: [], error: null };
            }
            if (name === 'fn_guest_shop_cancel_checkout_batch') {
                if (rows.batch.payment_status !== 'pending') {
                    return { data: null, error: { message: 'guest_checkout_batch_not_cancellable' } };
                }
                rows.payment.status = 'expired';
                rows.batch.payment_status = 'expired';
                return { data: [{ cancelled: true }], error: null };
            }
            if (name === 'fn_guest_shop_expire_checkout_batches') {
                if (rows.batch.payment_status === 'pending'
                    && ['pending', 'created'].includes(rows.payment.status)
                    && Date.parse(rows.batch.expires_at) <= Date.now()) {
                    rows.payment.status = 'expired';
                    rows.batch.payment_status = 'expired';
                    rows.batch.last_error_code = 'guest_checkout_batch_expired';
                    return { data: [{ processed_count: 1, released_count: 1 }], error: null };
                }
                return { data: [{ processed_count: 0, released_count: 0 }], error: null };
            }
            throw new Error(`Unexpected RPC ${name}`);
        }
    };
}

function response() {
    const state = { statusCode: 200, headers: {}, body: '' };
    return {
        setHeader(name, value) { state.headers[String(name).toLowerCase()] = value; return this; },
        status(code) { state.statusCode = code; return this; },
        end(body = '') { state.body = String(body); return this; },
        getHeader(name) { return state.headers[String(name).toLowerCase()]; },
        get statusCode() { return state.statusCode; },
        get payload() { return state.body ? JSON.parse(state.body) : null; }
    };
}

function createHandlers({ live, overrides = {} } = {}) {
    const rows = makeRows(overrides);
    const supabase = createSupabase(rows);
    let providerQueries = 0;
    const handlers = createGuestShopHandlers({
        admin: {
            getOptionalSupabaseAdmin() { return supabase; },
            sendJson(res, status, payload) { res.status(status); res.end(JSON.stringify(payload)); }
        },
        requestSecurity: {
            async takeRateLimitToken() { return { allowed: true }; },
            applyRateLimitHeaders() {},
            resolveClientIp() { return '198.51.100.10'; }
        },
        security,
        paymentAdapter: {
            async queryGuestPayment() { providerQueries += 1; return clone(live); }
        },
        env: ENV
    });
    const req = (method = 'GET', body = null) => ({
        method,
        query: { orderNo: BATCH_NO },
        headers: {
            cookie: makeClaimCookie(),
            ...(body ? { 'content-type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : ''
    });
    return { handlers, rows, supabase, providerQueries: () => providerQueries, req };
}

function livePayment(overrides = {}) {
    return {
        supported: true,
        provider: 'zpay',
        purpose: 'shop_direct',
        merchant_order_no: BATCH_NO,
        provider_order_no: PROVIDER_ORDER_NO,
        status: 'paid',
        final_status: 'paid',
        amount: 0.02,
        paid_amount: 0.02,
        currency: 'CNY',
        site: 'cn',
        response_payload: { trade_status: 'TRADE_SUCCESS', out_trade_no: BATCH_NO },
        ...overrides
    };
}

test('batch status confirms a verified provider payment and claims the whole batch', async () => {
    const fixture = createHandlers({ live: livePayment() });
    const res = response();

    await fixture.handlers.checkoutBatchStatus(fixture.req(), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.payment_status, 'confirmed');
    assert.equal(res.payload.fulfillment_status, 'delivered');
    assert.equal(fixture.rows.payment.status, 'confirmed');
    assert.deepEqual(fixture.supabase.calls.map((call) => call.name), [
        'fn_guest_shop_confirm_checkout_batch_payment',
        'fn_guest_shop_claim_checkout_batch'
    ]);
    assert.equal(fixture.supabase.tables.guest_shop_payment_events[0].processing_status, 'processed');
    assert.equal(fixture.providerQueries(), 1);
});

test('batch status leaves an unpaid payment pending and throttles repeated provider queries', async () => {
    const fixture = createHandlers({ live: livePayment({ status: 'pending', final_status: 'pending' }) });
    const first = response();
    await fixture.handlers.checkoutBatchStatus(fixture.req(), first);
    assert.equal(first.payload.payment_status, 'pending');
    assert.equal(fixture.supabase.calls.length, 0);

    const second = response();
    await fixture.handlers.checkoutBatchStatus(fixture.req(), second);
    assert.equal(second.payload.payment_status, 'pending');
    assert.equal(fixture.providerQueries(), 1);
});

test('batch status rejects a provider amount mismatch without confirming payment', async () => {
    const fixture = createHandlers({ live: livePayment({ amount: 0.03, paid_amount: 0.03 }) });
    const res = response();

    await fixture.handlers.checkoutBatchStatus(fixture.req(), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.payment_status, 'pending');
    assert.equal(fixture.rows.payment.status, 'created');
    assert.equal(fixture.supabase.calls.length, 0);
    assert.equal(fixture.supabase.tables.guest_shop_payment_events.length, 0);
});

test('batch cancel first checks the provider and refuses to release inventory after payment', async () => {
    const fixture = createHandlers({ live: livePayment() });
    const res = response();

    await fixture.handlers.checkoutBatchCancel(fixture.req('POST', { orderNo: BATCH_NO }), res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.payload.code, 'guest_order_not_cancellable');
    assert.equal(fixture.rows.batch.fulfillment_status, 'delivered');
    assert.equal(fixture.supabase.calls.some((call) => call.name === 'fn_guest_shop_cancel_checkout_batch'), false);
});

test('batch cancel releases inventory only after the provider confirms an unpaid state', async () => {
    const fixture = createHandlers({ live: livePayment({ status: 'pending', final_status: 'pending' }) });
    const res = response();

    await fixture.handlers.checkoutBatchCancel(fixture.req('POST', { orderNo: BATCH_NO }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.cancelled, true);
    assert.equal(fixture.rows.batch.payment_status, 'expired');
    assert.equal(fixture.supabase.calls.at(-1).name, 'fn_guest_shop_cancel_checkout_batch');
});

test('batch status expires an unpaid batch before querying the provider', async () => {
    const fixture = createHandlers({
        live: livePayment(),
        overrides: { batch: { expires_at: '2020-01-01T00:00:00.000Z' } }
    });
    const res = response();

    await fixture.handlers.checkoutBatchStatus(fixture.req(), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.payment_status, 'expired');
    assert.equal(fixture.rows.payment.status, 'expired');
    assert.equal(fixture.providerQueries(), 0);
    assert.deepEqual(fixture.supabase.calls.map((call) => call.name), [
        'fn_guest_shop_expire_checkout_batches'
    ]);
});

test('batch cancel treats an expired unpaid batch as safely cancelled', async () => {
    const fixture = createHandlers({
        live: livePayment(),
        overrides: { batch: { expires_at: '2020-01-01T00:00:00.000Z' } }
    });
    const res = response();

    await fixture.handlers.checkoutBatchCancel(fixture.req('POST', { orderNo: BATCH_NO }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.cancelled, true);
    assert.equal(res.payload.expired, true);
    assert.equal(fixture.rows.batch.payment_status, 'expired');
    assert.equal(fixture.providerQueries(), 0);
    assert.deepEqual(fixture.supabase.calls.map((call) => call.name), [
        'fn_guest_shop_expire_checkout_batches'
    ]);
});
