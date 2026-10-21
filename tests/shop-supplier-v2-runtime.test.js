'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSupplierRuntime, CONTRACT, phasesFor } = require('../server/integrations/suppliers/runtime');
const { createConfiguredSupplierAdapterRegistry } = require('../server/integrations/suppliers/registry');
const f = require('./helpers/shop-supplier-runtime-fixture');
const runtimeName = 'fn_shop_supplier_runtime_v2';
test('runtime and phase switches are exact default-off values and touch no DB or adapter', async () => {
    for (const env of [{}, { ...f.env, SHOP_SUPPLIER_RUNTIME_V2_ENABLED: 'TRUE' }, { SHOP_SUPPLIER_RUNTIME_V2_ENABLED: 'true' }]) {
        const h = f.fixture({ env }); assert.deepEqual(await h.runtime.runOnce(), { success: true, disabled: true, processed: 0 });
        assert.equal(h.calls.length, 0); assert.equal(h.resolutions.length, 0);
    }
    assert.deepEqual(phasesFor({ SHOP_SUPPLIER_RECONCILE_V2_ENABLED: 'true' }), ['query']);
});
test('invalid batch/deadline bounds fail before persistence or merchant access', async () => {
    const h = f.fixture();
    for (const limit of [0, 21, 1.5, '5']) await assert.rejects(h.runtime.runOnce({ limit }), { code: 'supplier_runtime_invalid_limit' });
    for (const requestTimeoutMs of [0, 15001, NaN, '15']) assert.throws(() => createSupplierRuntime({ db: h.db,
        resolveAdapter: () => h.adapter, requestTimeoutMs }), { code: 'supplier_runtime_unavailable' });
    assert.equal(h.calls.length, 0);
});
test('bounded candidates reject duplicates, invalid phases/identities and raw malformed data', async () => {
    for (const jobs of [null, {}, [{ intentId: 'bad', phase: 'dispatch' }], [{ intentId: f.IDS.intent, phase: 'refund' }],
        Array.from({ length: 2 }, () => ({ intentId: f.IDS.intent, phase: 'dispatch' }))]) {
        const h = f.fixture({ scripts: { scan: () => ({ data: { jobs } }) } });
        await assert.rejects(h.runtime.runOnce(), { code: 'supplier_runtime_invalid_candidates' });
        assert.equal(h.calls.length, 1); assert.equal(h.resolutions.length, 0);
    }
});
test('account/job mock lease denial and malformed claims never resolve credentials or send HTTP', async () => {
    for (const patch of [{ acquired: false }, { token: 'bad' }, { intentId: f.IDS.other }, { phase: 'query' }, { accountId: 'bad' }]) {
        const h = f.fixture({ scripts: { claim: () => ({ data: { acquired: true, intentId: f.IDS.intent,
            accountId: f.account, phase: 'dispatch', token: f.token, ...patch } }) } });
        await h.runtime.runOnce(); assert.equal(h.http.length, 0); assert.equal(h.resolutions.length, 0);
        assert.equal(h.calls.find(c => c.p_action === 'claim').p_phase, 'dispatch');
    }
});
test('frozen admitted adapter sends once only after both committed ACKs and receives abort/deadline bounds', async () => {
    const h = f.fixture({ frozen: true }); const result = await h.runtime.runOnce();
    assert.equal(result.processed, 1); assert.deepEqual(result.counts, { ok: 1 }); assert.equal(h.http.length, 1);
    assert.deepEqual(h.calls.map(c => [c.name, c.p_action]), [[runtimeName,'scan'],[runtimeName,'claim'],
        ['fn_shop_supplier_dispatch_v2','prepare'],['fn_shop_supplier_dispatch_v2','begin'],[runtimeName,'start'],
        ['fn_shop_supplier_dispatch_v2','record'],[runtimeName,'finish']]);
    assert.equal(h.http[0].bounds.signal.aborted, false); assert.ok(h.http[0].bounds.deadlineAt > Date.now());
    assert.deepEqual(h.http[0].input, f.purchaseTicket().request);
});
test('runtime contract is exact and procurement contract stays independently mandatory', async () => {
    for (const adapter of [{ runtimeContract: null }, { runtimeContract: { ...CONTRACT, retries: 'automatic' } },
        { runtimeContract: { ...CONTRACT, extra: true } }, { procurementContract: {} }, { capabilities: { procurement: true } }]) {
        const h = f.fixture({ adapter }); await h.runtime.runOnce(); assert.equal(h.http.length, 0);
        assert.equal(h.finish().p_outcome, 'contract_unverified');
        assert.equal(h.calls.some(c => c.p_action === 'begin' || c.p_action === 'start'), false);
    }
});
test('original account mismatch prevents adapter resolution and submission', async () => {
    const ticket = f.purchaseTicket(); ticket.account.id = f.IDS.other;
    const h = f.fixture({ scripts: { 'fn_shop_supplier_dispatch_v2:prepare': () => ({ data: { acquired: true, ticket } }) } });
    await h.runtime.runOnce(); assert.equal(h.resolutions.length, 0); assert.equal(h.http.length, 0);
});
test('lost, false, mismatched or stale start ACK never sends or retries create', async () => {
    const base = { applied: true, intentId: f.IDS.intent, accountId: f.account, phase: 'dispatch', token: f.token };
    for (const data of [null, {}, { applied: false }, { ...base, token: f.IDS.other }, { ...base, phase: 'query' },
        { ...base, accountId: f.IDS.other }, { ...base, intentId: f.IDS.other }]) {
        const h = f.fixture({ scripts: { start: () => ({ data }) } }); await h.runtime.runOnce();
        assert.equal(h.http.length, 0); assert.equal(h.calls.filter(c => c.p_action === 'start').length, 1);
    }
    let clock = 0;
    const h = f.fixture({ now: () => clock, scripts: { start: () => { clock = 5001; return { data: base }; } } });
    await h.runtime.runOnce(); assert.equal(h.http.length, 0); assert.equal(h.finish().p_outcome, 'blocked');
});
test('lost native begin ACK prevents runtime start and submission', async () => {
    const h = f.fixture({ scripts: { 'fn_shop_supplier_dispatch_v2:begin': () => { throw Error('private payload'); } } });
    await h.runtime.runOnce(); assert.equal(h.http.length, 0); assert.equal(h.calls.some(c => c.p_action === 'start'), false);
    assert.equal(h.finish().p_outcome, 'unknown');
});
test('timeout aborts one HTTP; its late success is ignored and only unknown is recorded', async () => {
    let late; let bounds; let sends = 0;
    const h = f.fixture({ requestTimeoutMs: 10, adapter: { createPurchase(input, options) {
        sends++; bounds = options; return new Promise(resolve => { late = resolve; });
    } } });
    const result = await h.runtime.runOnce(); assert.equal(result.counts.timeout, 1); assert.equal(sends, 1);
    assert.equal(bounds.signal.aborted, true); assert.equal(h.finish().p_outcome, 'timeout');
    const before = h.calls.length; late(f.accepted()); await Promise.resolve(); await Promise.resolve();
    assert.equal(h.calls.length, before); assert.equal(sends, 1);
    assert.equal(h.calls.find(c => c.p_action === 'record').p_result.outcome, 'unknown');
});
test('event-loop-late resolved HTTP response is also rejected by monotonic deadline', async () => {
    let clock = 0;
    const h = f.fixture({ now: () => clock, requestTimeoutMs: 100, adapter: { async createPurchase() {
        clock = 101; return f.accepted();
    } } });
    await h.runtime.runOnce(); assert.equal(h.finish().p_outcome, 'timeout');
    assert.equal(h.calls.find(c => c.p_action === 'record').p_result.outcome, 'unknown');
});
test('rate limiting and upstream errors yield safe persisted codes without provider messages', async () => {
    for (const [code, expected] of [['supplier_rate_limited', 'rate_limited'], ['secret-key-card', 'unavailable']]) {
        const h = f.fixture({ adapter: { async createPurchase() { throw Object.assign(new Error('secret-key-card'), { code }); } } });
        const result = await h.runtime.runOnce(); assert.equal(h.finish().p_outcome, expected);
        assert.doesNotMatch(JSON.stringify(result), /secret-key-card|fixture-goods|credential|lease|token/);
    }
});
test('uncertain persistence never issues a second create; recovery queries original immutable request', async () => {
    const h = f.fixture({ scripts: { 'fn_shop_supplier_dispatch_v2:record': () => { throw Error('lost commit ACK'); } } });
    await h.runtime.runOnce(); assert.equal(h.http.length, 1); assert.equal(h.finish().p_outcome, 'unknown');
    const query = f.fixture({ phase: 'query', env: { ...f.env, SHOP_SUPPLIER_DISPATCH_V2_ENABLED: 'false' } });
    await query.runtime.runOnce(); assert.equal(query.http.length, 1); assert.equal(query.http[0].method, 'query');
    assert.deepEqual(query.http[0].input, { requestId: f.IDS.request, orderNo: null, accountId: f.account });
    assert.equal(query.calls.some(c => c.p_action === 'begin'), false);
});
test('query not-found never authorizes create or becomes explicit rejection', async () => {
    const h = f.fixture({ phase: 'query', adapter: { async queryPurchase() { return { ...f.accepted(), outcome: 'not_found' }; } } });
    await h.runtime.runOnce(); assert.equal(h.finish().p_outcome, 'unknown');
    assert.equal(h.calls.find(c => c.p_action === 'record').p_result.outcome, 'unknown');
    assert.equal(h.calls.some(c => c.p_action === 'prepare' || c.p_action === 'begin'), false);
});
test('late delivery after customer closure still queries original procurement; goods are sealed and quarantined', async () => {
    const h = f.fixture({ phase: 'delivery', scripts: { 'fn_shop_supplier_record_delivery_v2:': params => {
        assert.equal(params.p_receipt.requestId, f.IDS.request); assert.equal(params.p_receipt.accountId, f.account);
        assert.equal(params.p_receipt.actualCostCny, '12.000000');
        assert.doesNotMatch(JSON.stringify(params), /fixture-goods-private-content/);
        return { data: { status: 'quarantined', applied: true } };
    } } });
    const result = await h.runtime.runOnce(); assert.deepEqual(result.counts, { quarantined: 1 });
    assert.deepEqual(h.http[0].input, { requestId: f.IDS.request, orderNo: 'FIXTURE-ORDER' });
    assert.equal(h.calls.some(c => c.name === 'fn_shop_supplier_dispatch_v2'), false);
});
test('unconfirmed finish is visible and no purchase is repeated inside the bounded run', async () => {
    for (const finish of [() => ({ data: { applied: false } }), () => ({ data: { applied: true, intentId: f.IDS.other, token: f.token } }),
        () => { throw Error('lost result'); }]) {
        const h = f.fixture({ scripts: { finish } }); const result = await h.runtime.runOnce();
        assert.equal(result.success, false); assert.equal(result.counts.confirmation_pending, 1); assert.equal(h.http.length, 1);
    }
});
test('mock DB account lease serializes competing runners; this is not database concurrency acceptance', async () => {
    let leased = false;
    const h = f.fixture({ scripts: { claim: () => {
        if (leased) return { data: { acquired: false } }; leased = true;
        return { data: { acquired: true, intentId: f.IDS.intent, accountId: f.account, phase: 'dispatch', token: f.token } };
    } } });
    const results = await Promise.all(Array.from({ length: 6 }, () => h.runtime.runOnce()));
    assert.equal(h.http.length, 1); assert.equal(results.reduce((n, r) => n + r.processed, 0), 1);
});
test('shipped supplier adapters have no runtime admission even if credentials and master switches exist', () => {
    for (const provider of ['xiareng', '16688']) {
        const prefix = provider === 'xiareng' ? 'SUPPLIER_XIARENG' : 'SUPPLIER_16688';
        const env = { [`${prefix}_APP_ID`]: 'test-app', [`${prefix}_${provider === 'xiareng' ? 'APP_KEY' : 'SECRET'}`]: 'test-secret' };
        const registry = createConfiguredSupplierAdapterRegistry({ env, account: { id: f.account,
            provider_id: provider, credential_ref: `env:${prefix}` } });
        const adapter = registry.require(provider);
        assert.ok(adapter); assert.notEqual(adapter.runtimeContract?.version, CONTRACT.version);
    }
});
