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
            checkout_url: `https://pay.example.test/checkout/${BATCH_NO}`,
            qrcode_url: `https://pay.example.test/qr/${BATCH_NO}`,
            qrcode_image_url: 'https://pay.example.test/qr.png',
            ...overrides.paymentMetadata
        },
        ...overrides.payment
    };
    const items = [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', batch_id: BATCH_ID, item_index: 0 }];
    return { batch, payment, items };
}

function createSupabase(rows, { confirmFailuresRemaining = 0, claimError = null } = {}) {
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
                if (table === 'guest_shop_payment_events' && inserted.some((row) => tableRows.some((current) =>
                    current.provider === row.provider && current.event_key === row.event_key))) {
                    return { data: null, error: { code: '23505', message: 'duplicate event key' } };
                }
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
                if (confirmFailuresRemaining > 0) {
                    confirmFailuresRemaining -= 1;
                    return { data: null, error: { code: '42702', message: 'column reference payment_status is ambiguous' } };
                }
                rows.payment.status = 'confirmed';
                rows.payment.paid_amount = args.p_observed_amount;
                rows.payment.provider_order_no = args.p_provider_order_no;
                rows.batch.payment_status = 'confirmed';
                return { data: [{ batch_id: BATCH_ID, batch_no: BATCH_NO, payment_status: 'confirmed' }], error: null };
            }
            if (name === 'fn_guest_shop_claim_checkout_batch') {
                if (claimError) {
                    return { data: null, error: { ...claimError } };
                }
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

function createHandlers({ live, overrides = {}, confirmFailuresRemaining = 0, claimError = null, webhookAdapter = {} } = {}) {
    const rows = makeRows(overrides);
    const supabase = createSupabase(rows, { confirmFailuresRemaining, claimError });
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
            async queryGuestPayment() { providerQueries += 1; return clone(live); },
            ...webhookAdapter
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

function webhookRequest({ amount = '0.03', signature = 'valid-signature' } = {}) {
    const body = new URLSearchParams({
        pid: '10001', out_trade_no: BATCH_NO, trade_no: PROVIDER_ORDER_NO,
        trade_status: 'TRADE_SUCCESS', money: amount, sign_type: 'MD5', sign: signature
    }).toString();
    return {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: Buffer.from(body, 'utf8')
    };
}

function batchWebhookAdapter() {
    return {
        async verifyGuestWebhook({ payload }) { return { valid: payload.sign === 'valid-signature', signature_version: 'MD5' }; },
        async parseGuestWebhook({ payload }) {
            return {
                merchant_order_no: payload.out_trade_no,
                provider_order_no: payload.trade_no,
                purpose: 'shop_direct', currency: 'CNY', amount: Number(payload.money),
                final_status: 'paid'
            };
        }
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

test('batch status never reconstructs an image-only ZPay checkout', async () => {
    const fixture = createHandlers({
        live: livePayment({ status: 'pending', final_status: 'pending' }),
        overrides: {
            paymentMetadata: {
                checkout_url: '',
                qrcode_url: '',
                qrcode_image_url: 'https://pay.example.test/shared-loading-image.png'
            }
        }
    });

    const res = response();
    await fixture.handlers.checkoutBatchStatus(fixture.req(), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.checkout, null);
    assert.equal(fixture.providerQueries(), 1);
});

test('batch status rejects root or local ZPay URLs but replays the stored opaque payment URL', async () => {
    for (const paymentMetadata of [
        { checkout_url: 'https://pay.example.test/', qrcode_url: 'https://pay.example.test/' },
        { checkout_url: 'http://localhost:8000/pay', qrcode_url: 'http://localhost:8000/pay' }
    ]) {
        const fixture = createHandlers({
            live: livePayment({ status: 'pending', final_status: 'pending' }),
            overrides: { paymentMetadata }
        });
        const res = response();
        await fixture.handlers.checkoutBatchStatus(fixture.req(), res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.payload.checkout, null);
    }

    const fixture = createHandlers({
        live: livePayment({ status: 'pending', final_status: 'pending' }),
        overrides: {
            paymentMetadata: {
                checkout_url: 'https://pay.example.test/checkout?token=provider-opaque-token',
                qrcode_url: 'https://pay.example.test/qr?token=provider-opaque-token'
            }
        }
    });
    const res = response();
    await fixture.handlers.checkoutBatchStatus(fixture.req(), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.checkout?.checkout_url, 'https://pay.example.test/checkout?token=provider-opaque-token');
    assert.equal(res.payload.checkout?.qrcode_url, 'https://pay.example.test/qr?token=provider-opaque-token');
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

test('batch status checks the provider before expiring an unpaid batch', async () => {
    const fixture = createHandlers({
        live: livePayment({ status: 'pending', final_status: 'pending' }),
        overrides: { batch: { expires_at: '2020-01-01T00:00:00.000Z' } }
    });
    const res = response();

    await fixture.handlers.checkoutBatchStatus(fixture.req(), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.payment_status, 'expired');
    assert.equal(fixture.rows.payment.status, 'expired');
    assert.equal(fixture.providerQueries(), 1);
    assert.deepEqual(fixture.supabase.calls.map((call) => call.name), [
        'fn_guest_shop_expire_checkout_batches'
    ]);
});

test('batch cancel treats a provider-verified expired unpaid batch as cancelled', async () => {
    const fixture = createHandlers({
        live: livePayment({ status: 'pending', final_status: 'pending' }),
        overrides: { batch: { expires_at: '2020-01-01T00:00:00.000Z' } }
    });
    const res = response();

    await fixture.handlers.checkoutBatchCancel(fixture.req('POST', { orderNo: BATCH_NO }), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.cancelled, true);
    assert.equal(res.payload.expired, true);
    assert.equal(fixture.rows.batch.payment_status, 'expired');
    assert.equal(fixture.providerQueries(), 1);
    assert.deepEqual(fixture.supabase.calls.map((call) => call.name), ['fn_guest_shop_cancel_checkout_batch']);
});

test('paid amount includes the channel fee and can confirm the complete batch', async () => {
    const fixture = createHandlers({
        live: livePayment({ amount: 0.03, paid_amount: 0.03 }),
        overrides: {
            batch: { total_amount: '0.03' },
            payment: { expected_amount: '0.03' }
        }
    });
    const res = response();
    await fixture.handlers.checkoutBatchStatus(fixture.req(), res);
    assert.equal(res.payload.payment_status, 'confirmed');
    assert.equal(res.payload.fulfillment_status, 'delivered');
    assert.equal(fixture.supabase.calls[0].args.p_observed_amount, 0.03);
    assert.equal(fixture.supabase.tables.guest_shop_payment_events[0].observed_amount, 0.03);
});

test('a paid batch with a failed confirmation remains protected and can be retried', async () => {
    // Cancellation must not consume a confirmation retry once a verified
    // provider event has put the batch into reconciliation review. The next
    // status query is the single retry that should recover the batch.
    const fixture = createHandlers({ live: livePayment(), confirmFailuresRemaining: 1 });
    const first = response();
    await fixture.handlers.checkoutBatchStatus(fixture.req(), first);
    assert.equal(first.statusCode, 200);
    assert.equal(first.payload.payment_status, 'review');
    assert.equal(first.payload.last_error_code, 'guest_checkout_batch_confirmation_failed');
    assert.equal(first.payload.checkout, null);
    assert.equal(fixture.rows.payment.status, 'review');
    assert.equal(fixture.supabase.tables.guest_shop_payment_events[0].processing_status, 'retry');
    assert.equal(fixture.supabase.calls.some((call) => call.name === 'fn_guest_shop_expire_checkout_batches'), false);

    const cancelled = response();
    await fixture.handlers.checkoutBatchCancel(fixture.req('POST', { orderNo: BATCH_NO }), cancelled);
    assert.equal(cancelled.statusCode, 409);
    assert.equal(cancelled.payload.code, 'guest_checkout_batch_confirmation_failed');
    assert.equal(fixture.supabase.calls.some((call) => call.name === 'fn_guest_shop_cancel_checkout_batch'), false);

    const recovered = response();
    await fixture.handlers.checkoutBatchStatus(fixture.req(), recovered);
    assert.equal(recovered.payload.payment_status, 'confirmed');
    assert.equal(recovered.payload.fulfillment_status, 'delivered');
    assert.equal(fixture.supabase.tables.guest_shop_payment_events[0].processing_status, 'processed');
});

test('a confirmed payment with a fulfilment RPC failure stays paid and retryable', async () => {
    const fixture = createHandlers({
        live: livePayment(),
        claimError: { code: '57014', message: 'statement timeout' }
    });
    const res = response();

    await fixture.handlers.checkoutBatchStatus(fixture.req(), res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.payment_status, 'confirmed');
    assert.equal(res.payload.fulfillment_status, 'pending');
    assert.equal(res.payload.last_error_code, 'guest_checkout_batch_fulfillment_pending');
    assert.equal(res.payload.last_error_message, '支付已确认，正在等待发货处理。请稍后查询，勿重复付款。');
    assert.equal(fixture.rows.payment.status, 'confirmed');
    assert.equal(fixture.supabase.calls.filter((call) => call.name === 'fn_guest_shop_claim_checkout_batch').length, 2);
});

test('a paid provider response cannot be expired solely because the deadline passed', async () => {
    const fixture = createHandlers({
        live: livePayment(),
        overrides: { batch: { expires_at: '2020-01-01T00:00:00.000Z' } }
    });
    const res = response();
    await fixture.handlers.checkoutBatchStatus(fixture.req(), res);
    assert.equal(res.payload.payment_status, 'confirmed');
    assert.equal(fixture.supabase.calls.some((call) => call.name === 'fn_guest_shop_expire_checkout_batches'), false);
});

test('a mismatched provider order reference cannot confirm or authorize cancellation', async () => {
    const fixture = createHandlers({ live: livePayment({ provider_order_no: 'another-provider-order', status: 'pending', final_status: 'pending' }) });
    const res = response();
    await fixture.handlers.checkoutBatchCancel(fixture.req('POST', { orderNo: BATCH_NO }), res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.payload.code, 'guest_payment_verification_required');
    assert.equal(fixture.supabase.calls.length, 0);
});

test('batch webhook confirms the fee-inclusive amount and repeated callbacks are idempotent', async () => {
    const fixture = createHandlers({
        live: null,
        overrides: {
            batch: { total_amount: '0.03' },
            payment: { expected_amount: '0.03' }
        },
        webhookAdapter: batchWebhookAdapter()
    });
    const first = response();
    await fixture.handlers.webhook(webhookRequest(), first, 'zpay');
    assert.equal(first.statusCode, 200);
    assert.equal(first.payload.accepted, true);
    assert.equal(fixture.supabase.calls[0].args.p_observed_amount, 0.03);
    assert.equal(fixture.rows.batch.payment_status, 'confirmed');
    assert.equal(fixture.rows.batch.fulfillment_status, 'delivered');
    assert.equal(fixture.supabase.tables.guest_shop_payment_events[0].observed_amount, 0.03);

    const repeated = response();
    await fixture.handlers.webhook(webhookRequest(), repeated, 'zpay');
    assert.equal(repeated.statusCode, 200);
    assert.equal(fixture.supabase.tables.guest_shop_payment_events.length, 1);
});

test('batch webhook rejects a wrong signature or amount without confirming payment', async () => {
    const fixture = createHandlers({
        live: null,
        overrides: { batch: { total_amount: '0.03' }, payment: { expected_amount: '0.03' } },
        webhookAdapter: batchWebhookAdapter()
    });
    for (const request of [webhookRequest({ signature: 'forged' }), webhookRequest({ amount: '0.02' })]) {
        const res = response();
        await fixture.handlers.webhook(request, res, 'zpay');
        assert.equal(res.statusCode, 202);
        assert.equal(res.payload.accepted, false);
    }
    assert.equal(fixture.rows.batch.payment_status, 'pending');
    assert.equal(fixture.supabase.calls.length, 0);
    assert.equal(fixture.supabase.tables.guest_shop_payment_events.length, 0);
});
