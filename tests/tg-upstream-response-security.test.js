'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readBoundedResponseText } = require('../server/tg/bounded-response');
const { GramixClient } = require('../server/tg/gramix-client');
const { createTgPaymentGateway } = require('../server/tg/payment-gateway');
const { createTgNowpaymentsGateway } = require('../server/tg/nowpayments-gateway');
const { createTgWorker } = require('../server/tg/worker');

// All requests terminate in these injected streams; no network or database is used.
function streamed(chunks, { headers, status = 200, stall = false, hangingCancel = false } = {}) {
    let reads = 0, cancels = 0;
    const response = new Response(new ReadableStream({
        pull(controller) {
            const chunk = chunks[reads++];
            if (chunk !== undefined) controller.enqueue(chunk);
            else if (!stall) controller.close();
        },
        cancel() { cancels++; if (hangingCancel) return new Promise(() => {}); }
    }, { highWaterMark: 0 }), { status, headers });
    response.text = () => { throw new Error('Unbounded text() must not be called'); };
    response.json = () => { throw new Error('Unbounded json() must not be called'); };
    return { response, get reads() { return reads; }, get cancels() { return cancels; } };
}
const bytes = value => Buffer.from(value);
const paddedJson = (payload, size) => {
    const json = JSON.stringify(payload);
    return bytes(json + ' '.repeat(size - Buffer.byteLength(json)));
};

test('bounded reader accepts exact byte boundaries and UTF-8 split across chunks', async () => {
    const raw = bytes('中文😀');
    const stream = streamed(Array.from(raw, byte => Uint8Array.of(byte)));
    assert.equal(await readBoundedResponseText(stream.response, { maxBytes: raw.length }), '中文😀');
    assert.equal(stream.cancels, 0);
    assert.equal(stream.response.body.locked, false);
});

for (const headers of [undefined, { 'content-length': '1' }, { 'content-length': 'invalid' }]) {
    test(`bounded reader rejects excessive actual bytes with ${JSON.stringify(headers)} length header`, async () => {
        const stream = streamed([bytes('1234'), bytes('5'), bytes('never read')]);
        await assert.rejects(readBoundedResponseText(stream.response, { maxBytes: 4 }), { code: 'upstream_response_too_large' });
        assert.equal(stream.reads, 2);
        assert.equal(stream.cancels, 1);
        assert.equal(stream.response.body.locked, false);
    });
}

test('oversized declared length cancels before the first read', async () => {
    const stream = streamed([bytes('private upstream body')], { headers: { 'content-length': '99999999999999999999999999' } });
    await assert.rejects(readBoundedResponseText(stream.response, { maxBytes: 4 }), { code: 'upstream_response_too_large' });
    assert.equal(stream.reads, 0);
    assert.equal(stream.cancels, 1);
});

test('a stalled stream with stalled cancellation still exits when aborted', { timeout: 1000 }, async () => {
    const stream = streamed([], { stall: true, hangingCancel: true });
    const controller = new AbortController();
    const pending = readBoundedResponseText(stream.response, { maxBytes: 8, signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(pending, { name: 'AbortError' });
    assert.ok(stream.cancels >= 1);
});

test('already-aborted reads cancel without consuming data', async () => {
    const stream = streamed([bytes('unused')]);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(readBoundedResponseText(stream.response, { maxBytes: 8, signal: controller.signal }), { name: 'AbortError' });
    assert.equal(stream.reads, 0);
    assert.equal(stream.cancels, 1);
});

test('reader removes the abort handler after successful reads', async () => {
    const controller = new AbortController();
    const listeners = new Set();
    const signal = {
        get aborted() { return controller.signal.aborted; },
        addEventListener(_name, listener) { listeners.add(listener); },
        removeEventListener(_name, listener) { listeners.delete(listener); }
    };
    assert.equal(await readBoundedResponseText(streamed([bytes('ok')]).response, { maxBytes: 8, signal }), 'ok');
    assert.equal(listeners.size, 0);
});

test('reader refuses non-byte chunks and does not fall back to unbounded body APIs', async () => {
    const stream = streamed(['not bytes']);
    await assert.rejects(readBoundedResponseText(stream.response, { maxBytes: 8 }), { code: 'upstream_response_invalid_chunk' });
    assert.equal(stream.cancels, 1);
    const response = { body: {}, text() { assert.fail('text fallback'); }, json() { assert.fail('json fallback'); } };
    await assert.rejects(readBoundedResponseText(response, { maxBytes: 8 }), { code: 'upstream_response_stream_required' });
    assert.equal(await readBoundedResponseText({ body: null }, { maxBytes: 8 }), '');
});

const zpayEnv = { TG_PURCHASE_ZPAY_PID: '7654321', TG_PURCHASE_ZPAY_KEY: 'offline-payment-key-0123456789', TG_PUBLIC_ORIGIN: 'https://tg.fatherkey.com' };
const paymentOrder = { order_no: 'TGP-ABCDEFGHIJKLMNOPQRST', product_family: 'telegram_stars', stars_quantity: 100,
    currency: 'CNY', total_minor: 1234, payment_channel: 'alipay', payment_provider: 'zpay', payment_merchant_id: '7654321' };
const nowEnv = { TG_PURCHASE_CHANNELS: 'usdt_bep20', TG_PURCHASE_NOWPAYMENTS_API_KEY: 'offline-nowpayments-api-key-123456',
    TG_PURCHASE_NOWPAYMENTS_IPN_SECRET: 'offline-nowpayments-ipn-secret-123456', TG_PURCHASE_NOWPAYMENTS_CNY_TO_USD_RATE: '0.1536', TG_PUBLIC_ORIGIN: 'https://tg.fatherkey.com' };

for (const provider of ['zpay', 'nowpayments']) {
    for (const headers of [undefined, { 'content-length': '1' }]) {
        test(`${provider} rejects oversized chunked checkout responses without leaking body or credentials (${JSON.stringify(headers)})`, async () => {
            const stream = streamed([bytes(' '.repeat(65536)), bytes('private upstream body')], { headers });
            let fetches = 0, signal;
            const fetchImpl = async (_url, init) => { fetches++; signal = init.signal; return stream.response; };
            const gateway = provider === 'zpay' ? createTgPaymentGateway({ env: zpayEnv, fetchImpl }) : createTgNowpaymentsGateway({ env: nowEnv, fetchImpl });
            const order = provider === 'zpay' ? paymentOrder : { ...paymentOrder, payment_provider: 'nowpayments',
                payment_channel: 'usdt_bep20', payment_merchant_id: gateway.identity().merchant_id };
            await assert.rejects(gateway.createPayment({ order }), error => {
                assert.equal(error.statusCode, 503);
                assert.equal(error.message.includes('private upstream body'), false);
                assert.equal(error.message.includes('offline-'), false);
                return true;
            });
            assert.equal(fetches, 1);
            assert.equal(stream.cancels, 1);
            assert.equal(signal.aborted, true);
        });
    }
}

test('ZPay accepts a valid checkout response at the exact 64 KiB boundary', async () => {
    const stream = streamed([paddedJson({ code: 1, payurl: 'https://checkout.test/pay/123', trade_no: 'OFFLINE-123' }, 65536)]);
    const gateway = createTgPaymentGateway({ env: zpayEnv, fetchImpl: async () => stream.response });
    assert.equal((await gateway.createPayment({ order: paymentOrder })).provider_trade_no, 'OFFLINE-123');
});

test('local callback probe enforces its smaller response limit', async () => {
    const stream = streamed([bytes(' '.repeat(2048)), bytes('x')]);
    const gateway = createTgPaymentGateway({ env: { ...zpayEnv, APP_ENV: 'preview', LOCAL_PREVIEW_HOST: '127.0.0.1',
        TG_PREVIEW_PAYMENT_WEBHOOK_ORIGIN: 'https://offline-preview.trycloudflare.com' }, fetchImpl: async () => stream.response });
    await assert.rejects(gateway.assertCallbackReady(), { code: 'tg_payment_callback_unavailable' });
    assert.equal(stream.cancels, 1);
});

function gramix(fetchImpl) {
    return new GramixClient({ apiKey: 'offline-provider-key', baseUrl: 'https://provider.test/api/v1', fetchImpl, timeoutMs: 250 });
}

test('Gramix accepts a valid response at 1 MiB without calling json()', async () => {
    const stream = streamed([paddedJson({ statusCode: 200, data: { safe: true } }, 1024 * 1024)]);
    assert.equal((await gramix(async () => stream.response).request('/offline')).data.safe, true);
});

test('Gramix bounds error responses before parsing and redacts oversized errors', async () => {
    const stream = streamed([bytes(' '.repeat(8192)), bytes('private-provider-text')], { status: 429 });
    await assert.rejects(gramix(async () => stream.response).request('/offline'), error => {
        assert.equal(error.code, 'gramix_http_error');
        assert.equal(error.statusCode, 429);
        assert.equal(error.retryable, true);
        assert.equal(JSON.stringify(error).includes('private-provider-text'), false);
        return true;
    });
    assert.equal(stream.cancels, 1);
});

test('Gramix timeout covers a stalled success body even if fetch ignores abort', { timeout: 3000 }, async () => {
    const stream = streamed([], { stall: true, hangingCancel: true });
    await assert.rejects(gramix(async () => stream.response).request('/offline'), { code: 'gramix_timeout' });
    assert.ok(stream.cancels >= 1);
});

for (const kind of ['oversized', 'unreadable']) {
    test(`Gramix ${kind} purchase acknowledgement enters manual review after one marked submission`, async () => {
        let submits = 0;
        const calls = [];
        const stream = streamed([bytes(' '.repeat(1024 * 1024)), bytes('private response')], { status: 201 });
        const client = gramix(async () => { submits++; return kind === 'oversized' ? stream.response : { ok: true, status: 201, body: {} }; });
        const worker = createTgWorker({ env: { TG_FULFILLMENT_ENABLED: 'true' }, client,
            leaseTokenFactory: () => '91b14bdc-c5fb-4301-a08a-8f1396220ce0',
            supabase: { async rpc(name, args) {
                calls.push({ name, args });
                if (name === 'fn_tg_claim_fulfillment_order') return { data: { success: true, action: 'buy', order: {
                    id: '22ca3cce-8441-4de6-874a-fd34792ae1b5', status: 'processing',
                    telegram_username: 'telegram_user', term_months: 6,
                    provider_order_id: null, provider_payment_currency: null,
                    provider_idempotency_key: 'tg-provider-key-000000001', attempt_count: 1,
                    submitted_at: null, lease_token: '91b14bdc-c5fb-4301-a08a-8f1396220ce0'
                } } };
                if (name === 'fn_tg_mark_submitted') return { data: { success: true, payment_currency: args.p_payment_currency } };
                if (name === 'fn_tg_finish_order') return { data: { success: true, status: args.p_state } };
                assert.fail(`Unexpected RPC ${name}`);
            } }
        });
        const result = await worker.runOnce();
        assert.equal(submits, 1);
        assert.deepEqual(calls.map(call => call.name), ['fn_tg_claim_fulfillment_order', 'fn_tg_mark_submitted', 'fn_tg_finish_order']);
        assert.equal(result.status, 'manual_review');
        assert.equal(calls.at(-1).args.p_state, 'manual_review');
        assert.equal(calls.at(-1).args.p_error_code, 'gramix_invalid_response');
        assert.equal(JSON.stringify(calls).includes('private response'), false);
    });
}
