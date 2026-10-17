'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { queryUpstreamStatus, fulfillmentRuntime } = require('../server/tg/upstream-status');
const ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const OTHER_ID = 'fb019449-e61f-400d-aa84-494f06ad0785';
const KEY = 'private-submission-correlation';
const DATE = '2026-10-16T11:30:00.000Z';
const order = (patch = {}) => ({ id: OTHER_ID, order_no: 'TG-ABCDEFGHIJKLMNOPQRST', provider: 'gramix', telegram_username: 'recipient_test',
    product_family: 'telegram_stars', term_months: null, stars_quantity: 50, provider_order_id: ID,
    provider_payment_currency: 'usdt', provider_idempotency_key: KEY, submitted_at: '2026-10-16T11:00:00Z', ...patch });
const detail = (patch = {}) => ({ statusCode: 200, data: { id: ID, recipientName: 'recipient_test', type: 'stars', method: 'api',
    status: 'completed', currency: 'usd', amount: '0.7500', extraData: { quantityStars: 50 }, ...patch } });
const list = (data = [], total = data.length, offset = 0) => ({ statusCode: 200, data: { data, total, offset, limit: 100 } });
function setup({ local = order(), get = async () => detail(), scan = async () => list(), factory } = {}) {
    const calls = [];
    const clientFactory = factory || (() => ({
        async getOrder(id, options) { calls.push({ method: 'GET', id, options }); return get(id, options); },
        async listOrders(options) { calls.push({ method: 'LIST', ...options }); return scan(options); },
        async purchaseStars() { throw new Error('A query must never buy'); },
        async purchasePremium() { throw new Error('A query must never buy'); }
    }));
    return { calls, run: () => queryUpstreamStatus({ order: local, clientFactory, now: () => new Date(DATE) }) };
}

test('a queued task with no submission marker requires neither a provider client nor credentials', async () => {
    const { run, calls } = setup({ local: order({ provider_order_id: null, submitted_at: null }), factory() { assert.fail('must not contact provider'); } });
    const r = await run(); assert.equal(r.status, 'not_submitted'); assert.equal(r.verified, false); assert.equal(r.checked_at, DATE); assert.equal(r.snapshot, null); assert.deepEqual(calls, []);
});

test('an existing upstream id is queried read-only with a bounded timeout and a whitelisted result', async () => {
    const { run, calls } = setup({ get: async () => detail({ apiKey: 'private-api-key', idempotencyKey: KEY, arbitrary: 'raw-secret' }) });
    const r = await run(); assert.equal(r.status, 'verified'); assert.equal(r.lookup, 'saved_id'); assert.equal(r.snapshot.provider_status, 'completed');
    assert.equal(r.snapshot.stars_quantity, 50); assert.equal(r.snapshot.amount, '0.7500'); assert.equal(calls.length, 1); assert.equal(calls[0].id, ID); assert.equal(calls[0].options.timeoutMs, 3000);
    for (const value of [KEY, 'private-api-key', 'raw-secret']) assert.ok(!JSON.stringify(r).includes(value));
});

for (const patch of [{ id: OTHER_ID }, { recipientName: 'another_user' }, { extraData: { quantityStars: 100 } }, { currency: 'gram' },
    { type: 'premium_3_month' }, { method: 'web' }, { idempotencyKey: 'unrelated' }, { amount: 0.75 }, { status: 'unknown' }]) {
    test(`a mismatched saved upstream order is not fulfillment evidence: ${JSON.stringify(patch)}`, async () => {
        const { run } = setup({ get: async () => detail(patch) }); const r = await run();
        assert.equal(r.verified, false); assert.equal(r.status, 'mismatch'); assert.equal(r.snapshot, null);
    });
}

for (const status of ['created', 'processing', 'completed', 'failed', 'canceled']) {
    test(`the query preserves authenticated upstream state ${status} without completing or retrying a task`, async () => {
        const { run } = setup({ get: async () => detail({ status }) }); const r = await run();
        assert.equal(r.verified, true); assert.equal(r.snapshot.provider_status, status); assert.equal(r.snapshot.completed, status === 'completed');
    });
}

test('an uncertain submission is located by exact submission key and confirmed by order GET', async () => {
    const { run, calls } = setup({ local: order({ provider_order_id: null }), scan: async () => list([{ id: ID, idempotencyKey: KEY, status: 'created' }]) });
    const r = await run(); assert.equal(r.status, 'verified'); assert.equal(r.lookup, 'submission_key'); assert.equal(r.snapshot.provider_order_id, ID);
    assert.equal(r.snapshot.provider_status, 'completed'); assert.deepEqual(calls.map(c => c.method), ['LIST', 'GET']); assert.equal(r.search.exhausted, true); assert.ok(!JSON.stringify(r).includes(KEY));
});

test('a matching list entry cannot override a mismatched order GET', async () => {
    const { run } = setup({ local: order({ provider_order_id: null }), scan: async () => list([{ id: ID, idempotencyKey: KEY }]), get: async () => detail({ recipientName: 'another_user' }) });
    const r = await run(); assert.equal(r.status, 'mismatch'); assert.equal(r.snapshot, null);
});

test('username, quantity and submission time alone never select another upstream purchase', async () => {
    const { run, calls } = setup({ local: order({ provider_order_id: null }), scan: async () => list([{ ...detail().data, createdAt: '2026-10-16T11:00:00Z' }]) });
    const r = await run(); assert.equal(r.status, 'submission_unknown'); assert.equal(r.snapshot, null); assert.deepEqual(calls.map(c => c.method), ['LIST']);
});

test('a complete empty provider list remains unconfirmed rather than permitting a second purchase', async () => {
    const { run, calls } = setup({ local: order({ provider_order_id: null }) }); const r = await run();
    assert.equal(r.status, 'not_found'); assert.equal(r.verified, false); assert.equal(r.search.exhausted, true); assert.match(r.message, /请勿重复补发/); assert.equal(calls.length, 1);
});

test('search scans at most three pages and cannot claim an absent order from a partial list', async () => {
    const { run, calls } = setup({ local: order({ provider_order_id: null }), scan: async ({ offset }) => list(Array.from({ length: 100 }, () => ({ id: OTHER_ID, idempotencyKey: 'another-key' })), 1000, offset) });
    const r = await run(); assert.equal(r.status, 'search_limited'); assert.equal(r.search.exhausted, false); assert.equal(r.search.scanned, 300);
    assert.deepEqual(calls.map(c => c.offset), [0, 100, 200]); assert.ok(calls.every(c => c.timeoutMs === 3000));
});

test('duplicate upstream ids for one submission key require manual review', async () => {
    const { run, calls } = setup({ local: order({ provider_order_id: null }), scan: async () => list([{ id: ID, idempotencyKey: KEY }, { id: OTHER_ID, idempotencyKey: KEY }]) });
    const r = await run(); assert.equal(r.status, 'mismatch'); assert.equal(r.reason, 'tg_provider_duplicate_correlation'); assert.equal(calls.length, 1);
});

for (const response of [{ statusCode: 200, data: [] }, { statusCode: 200, data: { data: 'wrong', total: 0, offset: 0, limit: 100 } },
    list([null]), list([], '0'), { statusCode: 201, data: list().data }, { statusCode: 200, data: { ...list().data, offset: 100 } }]) {
    test(`invalid list response never proves absence: ${JSON.stringify(response)}`, async () => {
        const { run } = setup({ local: order({ provider_order_id: null }), scan: async () => response });
        const r = await run(); assert.equal(r.status, 'unavailable'); assert.equal(r.snapshot, null);
    });
}

for (const [code, status, httpStatus] of [['gramix_timeout', 'unavailable'], ['gramix_configuration_error', 'unconfigured'], ['gramix_http_error', 'unavailable', 403], ['raw-secret-error', 'unavailable']]) {
    test(`provider errors are redacted and query failure is distinct from order failure: ${code}`, async () => {
        const { run } = setup({ get() { throw Object.assign(new Error('key and signed URL raw-secret'), { code, statusCode: httpStatus, response: 'raw-secret' }); } });
        const r = await run(); assert.equal(r.status, status); assert.equal(r.snapshot, null); assert.equal(r.verified, false); assert.ok(!JSON.stringify(r).includes('raw-secret'));
        assert.equal(r.http_status, httpStatus); if (code === 'raw-secret-error') assert.equal(r.reason, 'tg_provider_query_failed');
    });
}

test('invalid saved ids and absent submission keys do not reach the provider', async () => {
    for (const [patch, status] of [[{ provider_order_id: 'bad-id' }, 'mismatch'], [{ provider_order_id: null, provider_idempotency_key: null }, 'submission_unknown']]) {
        const { run, calls } = setup({ local: order(patch), factory() { assert.fail('must not contact provider'); } });
        assert.equal((await run()).status, status); assert.equal(calls.length, 0);
    }
});

test('API switch diagnostics never claim that a separate worker is running or stopped', () => {
    for (const flag of ['true', 'false']) {
        const r = fulfillmentRuntime({ TG_FULFILLMENT_ENABLED: flag, GRAMIX_API_KEY: 'private-api-key' });
        assert.equal(r.scope, 'current_api'); assert.equal(r.fulfillment_enabled, flag === 'true'); assert.equal(r.worker_status, 'unverified');
        assert.equal(r.provider_configured, true); assert.ok(!JSON.stringify(r).includes('private-api-key'));
    }
});


function diagnosedTask({ local = {}, balance, queryError, balanceError } = {}) {
    const task = Object.freeze(order({ provider_order_id: null, status: 'manual_review', last_error_code: 'gramix_http_error', ...local }));
    const before = JSON.stringify(task);
    const calls = [];
    return { task, before, calls, run: () => queryUpstreamStatus({ order: task, now: () => new Date(DATE), clientFactory: () => ({
        async listOrders() { calls.push('list'); if (queryError) throw queryError; return list(); },
        async getBalance(options) { calls.push('balance'); assert.equal(options.timeoutMs, 3000); if (balanceError) throw balanceError;
            return balance || { statusCode: 200, data: { usdt: '0.0000', gram: '0.0000', private: KEY } }; },
        async purchaseStars() { assert.fail('a diagnostic must not buy'); },
        async purchasePremium() { assert.fail('a diagnostic must not buy'); }
    }) }) };
}

test('historical missing error detail and current zero balance are returned as separate evidence', async () => {
    const { run, task, before, calls } = diagnosedTask({ local: { last_error_message: 'old generic error with private token' } });
    const result = await run(); const { recorded_error: recorded, balance } = result.diagnostics;
    assert.equal(result.status, 'not_found'); assert.equal(result.verified, false);
    assert.equal(recorded.historical_details_missing, true); assert.equal(recorded.http_status, null);
    assert.equal(recorded.reason, null); assert.match(recorded.message, /未留存/);
    assert.equal(balance.status, 'available'); assert.equal(balance.balances.usdt, '0.0000');
    assert.equal(balance.payment_currency, 'usdt'); assert.equal(balance.payment_balance_zero, true);
    assert.equal(balance.checked_at, DATE); assert.match(balance.message, /不能代替原提交/);
    assert.equal(JSON.stringify(task), before); assert.deepEqual(calls.sort(), ['balance', 'list']);
    assert.ok(!JSON.stringify(result).includes(KEY)); assert.ok(!JSON.stringify(result).includes('private token'));
});

test('future errors recover their safe recorded HTTP status and reason from existing database fields', async () => {
    const { run } = diagnosedTask({ local: { last_error_code: 'gramix_insufficient_balance',
        last_error_message: '[HTTP 403] 上游余额不足（Insufficient balance）。提交结果仍需核对。' } });
    const recorded = (await run()).diagnostics.recorded_error;
    assert.equal(recorded.reason, 'insufficient_balance'); assert.equal(recorded.http_status, 403);
    assert.equal(recorded.historical_details_missing, false); assert.match(recorded.message, /上游余额不足/);
});

for (const [currency, usdt, gram, zero] of [['usdt', '0.0001', '0.0000', false], ['gram', '10.0000', '0.0000', true], [null, '0.0000', '0.0000', null]]) {
    test(`current balance respects the persisted currency ${currency} without guessing affordability`, async () => {
        const { run } = diagnosedTask({ local: { provider_payment_currency: currency }, balance: { statusCode: 200, data: { usdt, gram } } });
        const result = await run(); assert.equal(result.diagnostics.balance.payment_balance_zero, zero);
        assert.equal(result.status, 'not_found'); assert.equal(result.verified, false);
        assert.equal(result.diagnostics.recorded_error.reason, null);
    });
}

test('balance failure cannot conceal a successful order query or be recorded as an original submission failure', async () => {
    const { run } = diagnosedTask({ balanceError: Object.assign(new Error(KEY), { code: 'gramix_http_error', statusCode: 401, providerReason: 'unauthorized' }) });
    const result = await run(); assert.equal(result.status, 'not_found'); assert.equal(result.diagnostics.recorded_error.reason, null);
    assert.equal(result.diagnostics.balance.status, 'unavailable'); assert.equal(result.diagnostics.balance.error.http_status, 401);
    assert.equal(result.diagnostics.balance.error.reason, 'unauthorized'); assert.ok(!JSON.stringify(result).includes(KEY));
});

test('a failed current query reports its own safe reason separately from the historical submission error', async () => {
    const { run } = diagnosedTask({ queryError: Object.assign(new Error(KEY), { code: 'gramix_http_error', statusCode: 401, providerReason: 'unauthorized' }) });
    const result = await run(); assert.equal(result.status, 'unavailable'); assert.equal(result.error.reason, 'unauthorized');
    assert.equal(result.http_status, 401); assert.equal(result.diagnostics.recorded_error.historical_details_missing, true);
    assert.equal(result.diagnostics.balance.status, 'available'); assert.ok(!JSON.stringify(result).includes(KEY));
});

for (const payload of [{ statusCode: 200, data: { usdt: 0, gram: '0.0000' } },
    { statusCode: 200, data: { usdt: 'private-secret', gram: '0.0000' } },
    { statusCode: 200, data: { usdt: '1'.repeat(100), gram: '0.0000' } },
    { statusCode: 201, data: { usdt: '0.0000', gram: '0.0000' } }]) {
    test(`invalid balance data cannot be displayed or authorize recovery: ${JSON.stringify(payload)}`, async () => {
        const { run } = diagnosedTask({ balance: payload }); const result = await run();
        assert.equal(result.diagnostics.balance.status, 'unavailable'); assert.equal(result.status, 'not_found');
        assert.equal(result.verified, false); assert.ok(!JSON.stringify(result).includes('private-secret'));
    });
}
