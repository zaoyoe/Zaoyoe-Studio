'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CONTRACT, CONTRACT_HASH, createProcurementRunner, normalizeResult, validateTicket } = require('../server/integrations/suppliers/procurement');
const intentId = '11111111-1111-4111-8111-111111111111';
const accountId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const token = '44444444-4444-4444-8444-444444444444';
const attemptId = '55555555-5555-4555-8555-555555555555';
const otherToken = '66666666-6666-4666-8666-666666666666';
const evidenceHash = 'a'.repeat(64);
const enabled = { SHOP_SUPPLIER_DISPATCH_V2_ENABLED: 'true', SHOP_SUPPLIER_RECONCILE_V2_ENABLED: 'true' };
function ticket(overrides = {}) {
    return { intentId, attemptId, token, account: { id: accountId, provider_id: 'fixture', credential_ref: 'env:SUPPLIER_FIXTURE' },
        contractHash: CONTRACT_HASH, evidenceHash,
        request: { requestId, goodsNo: 'goods-1', variant: { race: 'month' }, quantity: 1,
            maxCost: { currency: 'CNY', amount: '12.123456' } }, ...overrides };
}
function accepted(extra = {}) { return { outcome: 'accepted', accountId, requestId, orderNo: 'ORDER_123', evidenceHash, ...extra }; }
function harness({ script = {}, adapterOverrides = {}, env = enabled, preparedTicket = ticket(), resolve } = {}) {
    const calls = []; const submissions = []; const queries = [];
    const adapter = { providerId: 'fixture', capabilities: { procurement: true, requestLookup: true }, procurementContract: CONTRACT,
        async createPurchase(input) { submissions.push(input); return accepted(); },
        async queryPurchase(input) { queries.push(input); return accepted(); }, ...adapterOverrides };
    const db = { async rpc(name, params) {
        assert.equal(name, 'fn_shop_supplier_dispatch_v2');
        calls.push(structuredClone(params));
        if (script[params.p_action]) return script[params.p_action](params, calls);
        if (params.p_action === 'prepare') return { data: { status: 'prepared', acquired: true, ticket: structuredClone(preparedTicket) } };
        if (params.p_action === 'begin') return { data: { status: 'dispatching', applied: true } };
        if (params.p_action === 'claim_query') return { data: { status: 'outcome_unknown', acquired: true, ticket: structuredClone(preparedTicket) } };
        if (params.p_action === 'record') return { data: { status: params.p_result.outcome === 'unknown' ? 'outcome_unknown' : params.p_result.outcome, applied: true } };
        assert.fail('Unexpected action');
    } };
    return { calls, submissions, queries, adapter, runner: createProcurementRunner({ db, resolveAdapter: resolve || (async () => adapter), env }) };
}

test('both switches default off without touching RPC or the merchant', async () => {
    const h = harness({ env: {} });
    assert.equal((await h.runner.dispatch(intentId)).status, 'disabled');
    assert.equal((await h.runner.reconcile(intentId)).status, 'disabled');
    assert.deepEqual(h.calls, []); assert.deepEqual(h.submissions, []); assert.deepEqual(h.queries, []);
});
test('query-only recovery remains available when new dispatch is disabled', async () => {
    const h = harness({ env: { SHOP_SUPPLIER_DISPATCH_V2_ENABLED: 'false', SHOP_SUPPLIER_RECONCILE_V2_ENABLED: 'true' } });
    assert.equal((await h.runner.dispatch(intentId)).status, 'disabled');
    assert.equal((await h.runner.reconcile(intentId)).status, 'accepted');
    assert.deepEqual(h.calls.map(c => c.p_action), ['claim_query', 'record']);
    assert.equal(h.submissions.length, 0);
    assert.deepEqual(h.queries, [{ requestId, accountId, orderNo: null }]);
});
test('one explicit committed begin acknowledgement precedes the only HTTP submission', async () => {
    let acknowledged = false;
    const h = harness({ script: { begin: async p => { assert.equal(p.p_token, token); acknowledged = true; return { data: { status: 'dispatching', applied: true } }; } },
        adapterOverrides: { async createPurchase(input) { assert.equal(acknowledged, true); assert.deepEqual(input, ticket().request); return accepted(); } } });
    assert.deepEqual(await h.runner.dispatch(intentId), { status: 'accepted', applied: true, acquired: false });
    assert.deepEqual(h.calls.map(c => c.p_action), ['prepare', 'begin', 'record']);
    assert.equal(h.calls[0].p_contract_hash, CONTRACT_HASH);
});
test('an unacquired mock DB lease prevents all merchant calls, including concurrent runners', async () => {
    let granted = false;
    const h = harness({ script: { prepare: async () => {
        if (granted) return { data: { status: 'dispatching', acquired: false } };
        granted = true; return { data: { status: 'prepared', acquired: true, ticket: ticket() } };
    } } });
    const results = await Promise.all(Array.from({ length: 8 }, () => h.runner.dispatch(intentId)));
    assert.equal(results.filter(r => r.applied).length, 1); assert.equal(h.submissions.length, 1);
    // This checks runner behavior against a mock lease, NOT database concurrency.
});
for (const [label, response] of [
    ['lost ACK', () => { throw new Error('private SQL/credential'); }],
    ['truncated ACK', () => ({ data: { status: 'dispatching' } })],
    ['duplicate begin', () => ({ data: { status: 'dispatching', applied: false } })],
    ['expired old token', () => ({ data: { status: 'prepared', applied: false } })],
    ['database error', () => ({ error: new Error('secret') })]
]) test(`begin ${label} never sends a purchase`, async () => {
    const h = harness({ script: { begin: response } });
    const result = await h.runner.dispatch(intentId);
    assert.equal(h.submissions.length, 0); assert.equal(h.calls.some(c => c.p_action === 'record'), false);
    assert.equal(JSON.stringify(result).includes('secret'), false);
});
for (const result of [null, { error: { message: 'db secret' } }, { data: [] }]) {
    test(`prepare errors are sanitized before resolving or calling an adapter: ${JSON.stringify(result)}`, async () => {
        let resolves = 0;
        const h = harness({ script: { prepare: () => result }, resolve: () => { resolves++; throw Error('secret'); } });
        await assert.rejects(h.runner.dispatch(intentId), { code: 'supplier_dispatch_unavailable', message: 'supplier_dispatch_unavailable' });
        assert.equal(resolves, 0); assert.equal(h.submissions.length, 0);
    });
}
test('provider timeout leaves an unknown result and a repeated dispatch does not retry HTTP', async () => {
    let prepared = false; let creates = 0;
    const h = harness({ script: { prepare: () => {
        if (prepared) return { data: { status: 'outcome_unknown', acquired: false } };
        prepared = true; return { data: { status: 'prepared', acquired: true, ticket: ticket() } };
    } }, adapterOverrides: { async createPurchase() { creates++; throw Object.assign(Error('key/secret'), { retryable: true }); } } });
    assert.equal((await h.runner.dispatch(intentId)).status, 'outcome_unknown');
    assert.equal((await h.runner.dispatch(intentId)).status, 'outcome_unknown');
    assert.equal(creates, 1);
    assert.deepEqual(h.calls.find(c => c.p_action === 'record').p_result, { outcome: 'unknown', requestId, code: 'outcome_unknown' });
});
test('lost result persistence acknowledgement is unknown and cannot trigger another purchase', async () => {
    const h = harness({ script: { record: () => { throw Error('lost ACK secret'); } } });
    assert.deepEqual(await h.runner.dispatch(intentId), { status: 'outcome_unknown', applied: false, acquired: true });
    assert.equal(h.submissions.length, 1); assert.equal(h.calls.filter(c => c.p_action === 'record').length, 1);
});
test('reconciliation uses the same original request and known order number; it never dispatches', async () => {
    const h = harness({ preparedTicket: ticket({ token: otherToken, orderNo: 'KNOWN-1' }),
        adapterOverrides: { async createPurchase() { assert.fail('query must not create'); } } });
    await h.runner.reconcile(intentId);
    assert.deepEqual(h.queries, [{ requestId, accountId, orderNo: 'KNOWN-1' }]);
    assert.equal(h.calls.find(c => c.p_action === 'record').p_token, otherToken);
});
test('stale query responses honor DB fencing without inventing success or submitting again', async () => {
    const h = harness({ script: { record: () => ({ data: { status: 'outcome_unknown', applied: false } }) } });
    assert.deepEqual(await h.runner.reconcile(intentId), { status: 'outcome_unknown', applied: false, acquired: false });
    assert.equal(h.submissions.length, 0);
});
for (const state of ['accepted', 'rejected', 'review', 'prepared']) {
    test(`terminal or unsubmitted ${state} query disposition performs no merchant call`, async () => {
        const h = harness({ script: { claim_query: () => ({ data: { status: state, acquired: false } }) } });
        assert.equal((await h.runner.reconcile(intentId)).status, state); assert.equal(h.queries.length, 0);
    });
}
for (const raw of [null, { status: 1, secret: 'waiting for delivery' }, accepted({ accountId: intentId }), accepted({ requestId: intentId }),
    accepted({ evidenceHash: 'invalid' }), accepted({ orderNo: 'secret\nORDER' }), accepted({ outcome: 'delivered' }),
    { outcome: 'rejected', requestId, accountId, evidenceHash, definitivelyNotAccepted: false }]) {
    test(`ambiguous/unbound upstream result cannot prove acceptance or rejection: ${JSON.stringify(raw)}`, () => {
        assert.deepEqual(normalizeResult(raw, ticket()), { outcome: 'unknown', requestId, code: 'outcome_unknown' });
    });
}
test('not_found remains unknown and explicit final rejection needs identity and evidence', () => {
    assert.deepEqual(normalizeResult({ outcome: 'not_found', requestId, accountId }, ticket()), { outcome: 'unknown', requestId, code: 'not_found' });
    assert.deepEqual(normalizeResult({ outcome: 'rejected', requestId, accountId, evidenceHash, definitivelyNotAccepted: true }, ticket()),
        { outcome: 'rejected', requestId, evidenceHash, code: 'explicitly_not_accepted' });
});
test('raw responses and secrets never enter result persistence or runner output', async () => {
    const h = harness({ adapterOverrides: { async createPurchase() { return accepted({ secret: 'CARDSECRET', raw: { app_key: 'KEYSECRET' }, amount: 0, currency: 'USD', message: 'PRIVATE' }); } } });
    const result = await h.runner.dispatch(intentId);
    const recorded = h.calls.find(c => c.p_action === 'record').p_result;
    assert.deepEqual(recorded, { outcome: 'accepted', requestId, orderNo: 'ORDER_123', evidenceHash, code: 'accepted' });
    assert.equal(/SECRET|PRIVATE|token|account|amount/.test(JSON.stringify(result)), false);
});
test('adapter input is a clone and exact CNY decimal strings survive without float conversion', async () => {
    const h = harness({ adapterOverrides: { async createPurchase(input) {
        assert.equal(input.maxCost.amount, '12.123456'); input.maxCost.amount = '0'; input.variant.race = 'other'; return accepted();
    } } });
    await h.runner.dispatch(intentId);
    assert.equal(ticket().request.maxCost.amount, '12.123456');
    assert.equal(h.calls[0].p_action, 'prepare');
});
test('contract matching tolerates property order but rejects missing and additional semantics', async () => {
    const reordered = Object.fromEntries(Object.entries(CONTRACT).reverse());
    assert.equal((await harness({ adapterOverrides: { procurementContract: reordered } }).runner.dispatch(intentId)).status, 'accepted');
    for (const contract of [{ ...CONTRACT, extra: true }, { ...CONTRACT, requestLookup: 'tradeNo_only' }, { ...CONTRACT, rejection: null }]) {
        const h = harness({ adapterOverrides: { procurementContract: contract } });
        assert.equal((await h.runner.dispatch(intentId)).reason, 'supplier_dispatch_contract_unverified');
        assert.equal(h.calls.length, 1); assert.equal(h.submissions.length, 0);
    }
});
for (const adapterOverrides of [{ capabilities: { procurement: true } }, { providerId: 'another_account' }, { createPurchase: null }, { queryPurchase: null }]) {
    test(`ineligible adapter cannot begin: ${JSON.stringify(adapterOverrides)}`, async () => {
        const h = harness({ adapterOverrides });
        assert.equal((await h.runner.dispatch(intentId)).reason, 'supplier_dispatch_contract_unverified');
        assert.equal(h.calls.length, 1);
    });
}
test('both real adapters remain ineligible even with test credentials and procurement capability on legacy 16688', async () => {
    let http = 0;
    const { createXiarengAdapter } = require('../server/integrations/suppliers/xiareng/client');
    const { create16688AdapterFromEnv } = require('../server/integrations/suppliers/16688/client');
    for (const adapter of [createXiarengAdapter({ appId: 'TEST', appKey: 'TEST', fetchImpl: () => { http++; throw Error('forbidden'); } }),
        create16688AdapterFromEnv({ SUPPLIER_16688_APP_ID: 'TEST', SUPPLIER_16688_SECRET: 'TEST' }, { fetchImpl: () => { http++; throw Error('forbidden'); } })]) {
        const h = harness({ preparedTicket: ticket({ account: { ...ticket().account, provider_id: adapter.providerId } }), resolve: () => adapter });
        assert.equal((await h.runner.dispatch(intentId)).reason, 'supplier_dispatch_contract_unverified');
        assert.equal(h.calls.length, 1);
    }
    assert.equal(http, 0);
});
for (const mutate of [t => { t.token = 'bad'; }, t => { t.intentId = requestId; }, t => { t.evidenceHash = ''; },
    t => { t.request.quantity = 2; }, t => { t.request.maxCost.currency = 'USD'; }, t => { t.request.maxCost.amount = 12.2; },
    t => { t.request.maxCost.amount = '0.000000'; }, t => { t.request.maxCost.amount = 'NaN'; },
    t => { t.request.goodsNo = ' goods'; }, t => { t.request.variant = { email: 'unverified field' }; },
    t => { t.request.variant.race = ' race '; }, t => { t.account.credential_ref = 'unrelated:SECRET'; }]) {
    test(`malformed frozen ticket fails before adapter resolution: ${mutate}`, async () => {
        const t = ticket(); mutate(t); let resolves = 0;
        const h = harness({ preparedTicket: t, resolve: () => { resolves++; assert.fail('no adapter'); } });
        await assert.rejects(h.runner.dispatch(intentId), { code: 'supplier_dispatch_invalid_ticket' }); assert.equal(resolves, 0);
    });
}
test('default and race variants retain distinct original identities', () => {
    assert.equal(validateTicket(ticket({ request: { ...ticket().request, variant: {} } }), intentId).request.requestId, requestId);
    assert.equal(validateTicket(ticket(), intentId).request.variant.race, 'month');
});
