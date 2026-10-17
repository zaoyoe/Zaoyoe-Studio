'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTgWorker } = require('../server/tg/worker');

const providerId = '18ca3cce-8441-4de6-874a-fd34792ae1b5';
const leaseToken = '91b14bdc-c5fb-4301-a08a-8f1396220ce0';
const orderId = '22ca3cce-8441-4de6-874a-fd34792ae1b5';
const idempotencyKey = 'tg-provider-key-000000001';
const now = Date.parse('2026-10-15T00:00:00Z');

function order(patch = {}) {
    return {
        id: orderId, status: 'processing', telegram_username: 'telegram_user',
        term_months: 6, provider_order_id: null, provider_payment_currency: null,
        provider_idempotency_key: idempotencyKey,
        attempt_count: 1, submitted_at: null, lease_token: leaseToken,
        ...patch
    };
}

function setup({ action = 'buy', currentOrder = order(), client = {}, env = {}, markSuccess = true, claimResponse, finishResponse } = {}) {
    const calls = [];
    const supabase = {
        async rpc(name, args) {
            calls.push({ name, args });
            if (name === 'fn_tg_claim_fulfillment_order') return { data: claimResponse || { success: true, order: currentOrder, action }, error: null };
            if (name === 'fn_tg_mark_submitted') return { data: { success: markSuccess, payment_currency: args.p_payment_currency }, error: null };
            if (name === 'fn_tg_finish_order') return { data: finishResponse || { success: true, status: args.p_state }, error: null };
            throw new Error(`Unexpected RPC: ${name}`);
        }
    };
    const worker = createTgWorker({
        supabase, client, env: { TG_FULFILLMENT_ENABLED: 'true', ...env },
        now: () => now, leaseTokenFactory: () => leaseToken
    });
    return { worker, calls };
}

function providerDetail(patch = {}) {
    return {
        statusCode: 200,
        data: {
            id: providerId, status: 'completed', recipientName: 'telegram_user',
            type: 'premium_6_month', method: 'api', amount: '12.3400', currency: 'usd',
            idempotencyKey, ...patch
        }
    };
}

test('fulfillment is disabled by default and does not claim or contact provider', async () => {
    let calls = 0;
    const worker = createTgWorker({
        supabase: { async rpc() { calls += 1; throw new Error('must not claim'); } },
        env: {}, client: { async purchasePremium() { calls += 1; } }
    });
    assert.deepEqual(await worker.runOnce(), { success: true, processed: false, disabled: true });
    assert.equal(calls, 0);
});

test('fulfillment accepts the numeric environment flag used by process managers', async () => {
    let claims = 0;
    const worker = createTgWorker({
        supabase: {
            async rpc(name) {
                assert.equal(name, 'fn_tg_claim_fulfillment_order');
                claims += 1;
                return { data: { success: false, code: 'no_order' }, error: null };
            }
        },
        env: { TG_FULFILLMENT_ENABLED: '1' }
    });
    assert.deepEqual(await worker.runOnce(), { success: true, processed: false, code: 'no_order' });
    assert.equal(claims, 1);
});

test('purchase is submitted once only after durable marker, with fixed provider idempotency key', async () => {
    const { worker, calls } = setup({
        client: {
            async purchasePremium(input) {
                assert.equal(calls.at(-1).name, 'fn_tg_mark_submitted');
                assert.deepEqual(input, { recipientName: 'telegram_user', duration: 6, paymentCurrency: 'usdt', idempotencyKey });
                return { statusCode: 201, data: { orderId: providerId, status: 'processing', idempotencyKey } };
            }
        }
    });
    const result = await worker.runOnce();
    assert.equal(result.status, 'processing');
    assert.deepEqual(calls[1].args, {
        p_order_id: orderId, p_lease_token: leaseToken, p_payment_currency: 'usdt'
    });
    assert.deepEqual(calls[0].args.p_product_families, ['telegram_premium', 'telegram_stars']);
    assert.equal(calls.at(-1).name, 'fn_tg_finish_order');
    assert.equal(calls.at(-1).args.p_state, 'processing');
    assert.equal(calls.at(-1).args.p_provider_order_id, providerId);
    assert.equal(calls.at(-1).args.p_provider_snapshot.completed, false);
    assert.equal(calls.at(-1).args.p_next_attempt_at, '2026-10-15T00:00:15.000Z');
});

test('HTTP 201 with completed status still requires a later order GET', async () => {
    const { worker, calls } = setup({ client: { async purchasePremium() { return { statusCode: 201, data: { orderId: providerId, status: 'completed', idempotencyKey } }; } } });
    await worker.runOnce();
    assert.equal(calls.at(-1).args.p_state, 'processing');
    assert.equal(calls.at(-1).args.p_provider_snapshot.completed, false);
});

test('network failure during creation is manual review and never enables another purchase', async () => {
    let buys = 0;
    const { worker, calls } = setup({ client: { async purchasePremium() { buys += 1; throw Object.assign(new Error('secret upstream text'), { code: 'gramix_timeout', retryable: true }); } } });
    const result = await worker.runOnce();
    assert.equal(buys, 1);
    assert.equal(result.status, 'manual_review');
    assert.equal(calls.at(-1).args.p_state, 'manual_review');
    assert.equal(calls.at(-1).args.p_error_code, 'gramix_timeout');
    assert.equal(JSON.stringify(calls).includes('secret upstream text'), false);
});

test('matching GET completed confirms product, recipient, duration and provider order before success', async () => {
    let buys = 0;
    const { worker, calls } = setup({
        action: 'poll', currentOrder: order({ provider_order_id: providerId, provider_payment_currency: 'usdt', submitted_at: '2026-10-15T00:00:00Z' }),
        client: { async getOrder(id) { assert.equal(id, providerId); return providerDetail(); }, async purchasePremium() { buys += 1; } }
    });
    const result = await worker.runOnce();
    assert.equal(buys, 0);
    assert.equal(result.status, 'succeeded');
    assert.deepEqual(calls.at(-1).args.p_provider_snapshot, {
        verified_by: 'order_get', provider_order_id: providerId, provider_status: 'completed', completed: true,
        telegram_username: 'telegram_user', product_family: 'telegram_premium', term_months: 6,
        stars_quantity: null, product_type: 'premium_6_month',
        method: 'api', idempotency_key_matches: true, amount: '12.3400', currency: 'usd'
    });
});

test('mismatched duration, recipient, idempotency, order id or currency stops in manual review', async () => {
    for (const mismatch of [{ type: 'premium_12_month' }, { recipientName: 'other_user' }, { idempotencyKey: 'wrong_key' }, { id: orderId }, { method: 'web' }, { currency: 'gram' }, { currency: 'usdt' }, { currency: 'btc' }, { currency: null }]) {
        const { worker, calls } = setup({
            action: 'poll', currentOrder: order({ provider_order_id: providerId, provider_payment_currency: 'usdt' }),
            client: { async getOrder() { return providerDetail(mismatch); } }
        });
        await worker.runOnce();
        assert.equal(calls.at(-1).args.p_state, 'manual_review');
        assert.equal(calls.at(-1).args.p_error_code, 'tg_provider_order_mismatch');
    }
});

test('poll verifies the persisted purchase currency even after the worker currency changes', async () => {
    for (const [persisted, returned, current] of [['gram', 'gram', 'usdt'], ['usdt', 'usd', 'gram']]) {
        const { worker, calls } = setup({
            action: 'poll', currentOrder: order({ provider_order_id: providerId, provider_payment_currency: persisted }),
            env: { GRAMIX_PAYMENT_CURRENCY: current },
            client: { async getOrder() { return providerDetail({ currency: returned }); } }
        });
        assert.equal((await worker.runOnce()).status, 'succeeded');
        assert.equal(calls.at(-1).args.p_provider_snapshot.currency, returned);
    }
});

test('an old order with no saved currency stops for review without guessing from current configuration', async () => {
    let requests = 0;
    const { worker, calls } = setup({
        action: 'poll', currentOrder: order({ provider_order_id: providerId }),
        env: { GRAMIX_PAYMENT_CURRENCY: 'usdt' },
        client: { async getOrder() { requests++; return providerDetail(); } }
    });
    assert.equal((await worker.runOnce()).status, 'manual_review');
    assert.equal(calls.at(-1).args.p_error_code, 'tg_payment_currency_unconfirmed');
    assert.equal(requests, 0);
});

test('invalid configured currency cannot authorize submission or contact the provider', async () => {
    let requests = 0;
    const { worker, calls } = setup({
        env: { GRAMIX_PAYMENT_CURRENCY: 'usd' },
        client: { async purchasePremium() { requests++; } }
    });
    assert.equal((await worker.runOnce()).status, 'manual_review');
    assert.equal(calls.some((call) => call.name === 'fn_tg_mark_submitted'), false);
    assert.equal(requests, 0);
});

test('a legacy or mismatched marker response cannot authorize a purchase', async () => {
    for (const paymentCurrency of [undefined, 'gram']) {
        let requests = 0;
        const worker = createTgWorker({
            env: { TG_FULFILLMENT_ENABLED: 'true', GRAMIX_PAYMENT_CURRENCY: 'usdt' },
            supabase: { async rpc(name) {
                if (name === 'fn_tg_claim_fulfillment_order') return { data: { success: true, order: order(), action: 'buy' } };
                assert.equal(name, 'fn_tg_mark_submitted');
                return { data: { success: true, payment_currency: paymentCurrency } };
            } },
            client: { async purchasePremium() { requests++; } }
        });
        assert.equal((await worker.runOnce()).code, 'tg_submission_marker_rejected');
        assert.equal(requests, 0);
    }
});

test('known provider order may be re-polled after retryable query error without buying', async () => {
    const { worker, calls } = setup({
        action: 'poll', currentOrder: order({ provider_order_id: providerId, provider_payment_currency: 'usdt', attempt_count: 3 }),
        client: { async getOrder() { throw Object.assign(new Error('private data'), { code: 'gramix_network_error', retryable: true }); } }
    });
    await worker.runOnce();
    assert.equal(calls.at(-1).args.p_state, 'retry_waiting');
    assert.equal(calls.at(-1).args.p_provider_order_id, providerId);
    assert.equal(calls.at(-1).args.p_next_attempt_at, '2026-10-15T00:01:00.000Z');
    assert.equal(JSON.stringify(calls).includes('private data'), false);
});

test('failed durable marker prevents provider contact', async () => {
    let buys = 0;
    const { worker, calls } = setup({ markSuccess: false, client: { async purchasePremium() { buys += 1; } } });
    const result = await worker.runOnce();
    assert.equal(result.code, 'tg_submission_marker_rejected');
    assert.equal(buys, 0);
    assert.equal(calls.length, 2);
});

test('a submitted order without provider id cannot enter buy action again', async () => {
    let buys = 0;
    const { worker, calls } = setup({ currentOrder: order({ submitted_at: '2026-10-15T00:00:00Z' }), client: { async purchasePremium() { buys += 1; } } });
    await worker.runOnce();
    assert.equal(buys, 0);
    assert.equal(calls.at(-1).args.p_state, 'manual_review');
});

test('confirmed failed upstream order does not report success', async () => {
    const { worker, calls } = setup({ action: 'poll', currentOrder: order({ provider_order_id: providerId, provider_payment_currency: 'usdt' }), client: { async getOrder() { return providerDetail({ status: 'failed' }); } } });
    await worker.runOnce();
    assert.equal(calls.at(-1).args.p_state, 'failed');
    assert.equal(calls.at(-1).args.p_provider_snapshot.completed, false);
});

test('an idle queue is a successful no-op without contacting provider', async () => {
    const { worker, calls } = setup({ claimResponse: { success: false, code: 'no_order' }, client: { async purchasePremium() { throw new Error('must not buy'); } } });
    assert.deepEqual(await worker.runOnce(), { success: true, processed: false, code: 'no_order' });
    assert.equal(calls.length, 1);
});

test('an expired ambiguous claim cannot purchase again', async () => {
    let buys = 0;
    const { worker, calls } = setup({
        claimResponse: { success: false, code: 'manual_review', status: 'manual_review' },
        client: { async purchasePremium() { buys += 1; } }
    });
    const result = await worker.runOnce();
    assert.equal(result.code, 'manual_review');
    assert.equal(buys, 0);
    assert.equal(calls.length, 1);
});

test('unexpected purchase HTTP status is ambiguous and cannot complete or trigger another buy', async () => {
    let buys = 0;
    const { worker, calls } = setup({ client: { async purchasePremium() { buys += 1; return { statusCode: 202, data: { orderId: providerId, status: 'processing', idempotencyKey } }; } } });
    const result = await worker.runOnce();
    assert.equal(buys, 1);
    assert.equal(result.status, 'manual_review');
    assert.equal(calls.at(-1).args.p_error_code, 'tg_provider_create_response_invalid');
});

test('result CAS rejects a stale worker without claiming success', async () => {
    const { worker } = setup({
        action: 'poll', currentOrder: order({ provider_order_id: providerId, provider_payment_currency: 'usdt' }),
        client: { async getOrder() { return providerDetail(); } },
        finishResponse: { success: false, code: 'lease_lost' }
    });
    assert.deepEqual(await worker.runOnce(), { success: false, processed: false, code: 'lease_lost', order_id: orderId });
});

test('database downgrade to manual review is reflected by worker result', async () => {
    const { worker } = setup({
        action: 'poll', currentOrder: order({ provider_order_id: providerId, provider_payment_currency: 'usdt' }),
        client: { async getOrder() { return providerDetail(); } },
        finishResponse: { success: true, status: 'manual_review' }
    });
    assert.equal((await worker.runOnce()).status, 'manual_review');
});

test('order GET with an invalid envelope never completes redemption', async () => {
    const { worker, calls } = setup({
        action: 'poll', currentOrder: order({ provider_order_id: providerId, provider_payment_currency: 'usdt' }),
        client: { async getOrder() { return { ...providerDetail(), statusCode: 201 }; } }
    });
    await worker.runOnce();
    assert.equal(calls.at(-1).args.p_state, 'manual_review');
    assert.equal(calls.at(-1).args.p_error_code, 'tg_provider_order_invalid');
});

test('Stars purchases use the fixed code quantity exactly once after the currency marker', async () => {
    let starsBuys = 0;
    let premiumBuys = 0;
    const { worker, calls } = setup({
        currentOrder: order({ product_family: 'telegram_stars', term_months: null, stars_quantity: 500 }),
        client: {
            async purchaseStars(input) {
                starsBuys++;
                assert.equal(calls.at(-1).name, 'fn_tg_mark_submitted');
                assert.deepEqual(input, { recipientName: 'telegram_user', stars: 500, paymentCurrency: 'usdt', idempotencyKey });
                return { statusCode: 201, data: { orderId: providerId, status: 'completed', idempotencyKey } };
            },
            async purchasePremium() { premiumBuys++; }
        }
    });
    assert.equal((await worker.runOnce()).status, 'processing');
    assert.equal(starsBuys, 1);
    assert.equal(premiumBuys, 0);
    assert.equal(calls.at(-1).args.p_provider_snapshot.completed, false);
});

test('malformed product claims never mark submission or contact either purchase endpoint', async () => {
    const malformed = [
        { product_family: 'telegram_stars', term_months: 6, stars_quantity: 500 },
        { product_family: 'telegram_stars', term_months: null, stars_quantity: 49 },
        { product_family: 'telegram_stars', term_months: null, stars_quantity: 1000001 },
        { product_family: 'telegram_stars', term_months: null, stars_quantity: '500' },
        { product_family: 'telegram_stars', term_months: null, stars_quantity: 50.5 },
        { product_family: 'telegram_premium', term_months: 6, stars_quantity: 500 },
        { product_family: 'telegram_premium', term_months: '6' },
        { product_family: 'unknown', term_months: 6 }
    ];
    for (const patch of malformed) {
        let requests = 0;
        const { worker, calls } = setup({
            currentOrder: order(patch),
            client: { async purchasePremium() { requests++; }, async purchaseStars() { requests++; } }
        });
        assert.equal((await worker.runOnce()).status, 'manual_review', JSON.stringify(patch));
        assert.equal(calls.some((call) => call.name === 'fn_tg_mark_submitted'), false);
        assert.equal(calls.at(-1).args.p_error_code, 'tg_order_product_invalid');
        assert.equal(requests, 0);
    }
});

test('Stars completion requires official extraData.quantityStars and persisted currency', async () => {
    const { worker, calls } = setup({
        action: 'poll',
        currentOrder: order({ product_family: 'telegram_stars', term_months: null, stars_quantity: 500, provider_order_id: providerId, provider_payment_currency: 'usdt' }),
        env: { GRAMIX_PAYMENT_CURRENCY: 'gram' },
        client: { async getOrder() { return providerDetail({ type: 'stars', extraData: { quantityStars: 500 } }); } }
    });
    assert.equal((await worker.runOnce()).status, 'succeeded');
    assert.deepEqual(calls.at(-1).args.p_provider_snapshot, {
        verified_by: 'order_get', provider_order_id: providerId, provider_status: 'completed', completed: true,
        telegram_username: 'telegram_user', product_family: 'telegram_stars', term_months: null,
        stars_quantity: 500, product_type: 'stars', method: 'api', idempotency_key_matches: true,
        amount: '12.3400', currency: 'usd'
    });
});

test('Stars mismatch or missing official quantity cannot be replaced with top-level quantities', async () => {
    for (const detail of [
        { extraData: null }, { extraData: {} }, { extraData: { quantityStars: '500' } },
        { extraData: { quantityStars: 501 } }, { extraData: { quantityStars: 500.5 } },
        { extraData: { quantityCoins: 500 } }, { type: 'premium_6_month', extraData: { quantityStars: 500 } },
        { extraData: { quantityStars: 500 }, currency: 'gram' },
        { extraData: { quantityStars: 500 }, amount: null },
        { extraData: { quantityStars: 500 }, amount: 12.34 }
    ]) {
        let buys = 0;
        const { worker, calls } = setup({
            action: 'poll', currentOrder: order({ product_family: 'telegram_stars', term_months: null, stars_quantity: 500, provider_order_id: providerId, provider_payment_currency: 'usdt' }),
            client: {
                async getOrder() { return providerDetail({ type: 'stars', stars: 500, quantity: 500, ...detail }); },
                async purchaseStars() { buys++; }
            }
        });
        assert.equal((await worker.runOnce()).status, 'manual_review', JSON.stringify(detail));
        assert.equal(calls.at(-1).args.p_error_code, 'tg_provider_order_mismatch');
        assert.equal(buys, 0);
    }
});

test('ambiguous Stars purchase and submitted claims never automatically buy again', async () => {
    let buys = 0;
    const client = { async purchaseStars() { buys++; throw Object.assign(new Error('private'), { code: 'gramix_timeout' }); } };
    const currentOrder = order({ product_family: 'telegram_stars', term_months: null, stars_quantity: 50 });
    const first = setup({ currentOrder, client });
    assert.equal((await first.worker.runOnce()).status, 'manual_review');
    const restarted = setup({ currentOrder: { ...currentOrder, submitted_at: '2026-10-15T00:00:00Z', provider_payment_currency: 'usdt' }, client });
    assert.equal((await restarted.worker.runOnce()).status, 'manual_review');
    assert.equal(buys, 1);
    assert.equal(restarted.calls.some((call) => call.name === 'fn_tg_mark_submitted'), false);
});


test('a documented purchase rejection is persisted with HTTP and reason while the original task stays locked', async () => {
    const { GramixClient } = require('../server/tg/gramix-client');
    let submissions = 0;
    const client = new GramixClient({ apiKey: 'private-key', baseUrl: 'https://provider.test/api/v1', fetchImpl: async () => {
        submissions++;
        return new Response(JSON.stringify({ statusCode: 403, message: 'Insufficient balance', debug: 'private-key' }), { status: 403, headers: { 'content-type': 'application/json' } });
    } });
    const { worker, calls } = setup({ client });
    assert.equal((await worker.runOnce()).status, 'manual_review');
    const finished = calls.at(-1).args;
    assert.equal(finished.p_error_code, 'gramix_insufficient_balance');
    assert.match(finished.p_error_message, /\[HTTP 403\].*上游余额不足/);
    assert.match(finished.p_error_message, /提交结果仍需核对/);
    assert.equal(finished.p_provider_order_id, null); assert.equal(finished.p_next_attempt_at, null);
    assert.equal(submissions, 1); assert.ok(!JSON.stringify(calls).includes('private-key'));
});

test('an unknown HTTP 403 is not mislabeled as insufficient funds and never copies the upstream text', async () => {
    const { worker, calls } = setup({ client: { async purchasePremium() {
        throw Object.assign(new Error('private-key'), { code: 'gramix_http_error', statusCode: 403, providerReason: 'unknown-private-key' });
    } } });
    assert.equal((await worker.runOnce()).status, 'manual_review');
    const args = calls.at(-1).args;
    assert.equal(args.p_error_code, 'gramix_http_error'); assert.match(args.p_error_message, /HTTP 403/);
    assert.doesNotMatch(args.p_error_message, /余额不足|private-key/); assert.equal(args.p_next_attempt_at, null);
});

test('poll errors retain safe HTTP details without enabling another purchase', async () => {
    const { worker, calls } = setup({ action: 'poll', currentOrder: order({ provider_order_id: providerId, provider_payment_currency: 'usdt', submitted_at: '2026-10-15T00:00:00Z' }),
        client: { async getOrder() { throw Object.assign(new Error('private-key'), { code: 'gramix_http_error', statusCode: 401, providerReason: 'unauthorized', retryable: false }); },
            async purchasePremium() { assert.fail('must not buy again'); } } });
    assert.equal((await worker.runOnce()).status, 'manual_review');
    assert.equal(calls.at(-1).args.p_error_code, 'gramix_unauthorized');
    assert.match(calls.at(-1).args.p_error_message, /HTTP 401.*身份验证失败/);
    assert.ok(!JSON.stringify(calls).includes('private-key'));
});
