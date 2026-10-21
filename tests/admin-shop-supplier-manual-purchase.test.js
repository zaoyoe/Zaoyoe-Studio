'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const handlerPath = require.resolve('../server/api-handlers/admin/shop/supplier-manual-purchase');

const INTENT_ID = '2db86646-3d58-4549-a25b-9ca910aed939';
const PURCHASE_ID = '9f1c5b0e-2b7a-4a1f-9c3d-0a5b6c7d8e9f';
const ACCOUNT_ID = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f';
const UNIT_ID = '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b';
const ADMIN_ID = '6f7a8b9c-0d1e-4f2a-9b3c-4d5e6f7a8b9c';
const REQUEST_ID = '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';
const CARD = 'CARD-SECRET-VALUE-9';

function createResponse() {
    return {
        statusCode: 200,
        headers: {},
        body: '',
        status(code) { this.statusCode = code; return this; },
        setHeader(name, value) { this.headers[name] = value; return this; },
        end(value = '') { this.body = String(value); return this; },
        json() { return this.body ? JSON.parse(this.body) : {}; }
    };
}

function createDb(state = {}) {
    const calls = { rpc: [], reads: [] };
    const rows = {
        shop_supplier_procurement_intents: () => ({
            id: INTENT_ID, unit_id: UNIT_ID, supplier_account_id: ACCOUNT_ID,
            original_request_id: REQUEST_ID, status: 'not_submitted'
        }),
        shop_supplier_accounts: () => ({
            id: ACCOUNT_ID, provider_id: 'xiareng', credential_ref: 'env:SUPPLIER_XIARENG',
            is_enabled: true, account_key: 'default'
        }),
        shop_supplier_manual_purchases: () => state.purchase || {
            id: PURCHASE_ID, intent_id: INTENT_ID, unit_id: UNIT_ID, supplier_account_id: ACCOUNT_ID,
            original_request_id: REQUEST_ID, state: 'confirmed', attempt_count: 1,
            quoted_amount_cny: '0.16', cost_ceiling_cny: '1.000000',
            quote_expires_at: '2026-10-21T00:00:00.000Z',
            supplier_order_no: null, actual_amount_cny: null
        }
    };
    return {
        calls,
        async rpc(name, params) {
            calls.rpc.push({ name, params });
            const value = typeof state.rpc?.[name] === 'function' ? state.rpc[name](params) : null;
            if (value instanceof Error) return { data: null, error: { message: value.message } };
            return { data: value, error: null };
        },
        from(table) {
            const query = {
                filters: {},
                select() { return query; },
                eq(key, value) { query.filters[key] = value; return query; },
                order() { return query; },
                limit() { return query; },
                maybeSingle() {
                    calls.reads.push(table);
                    return Promise.resolve({ data: typeof rows[table] === 'function' ? rows[table]() : null, error: null });
                },
                then(resolve) {
                    calls.reads.push(table);
                    return Promise.resolve({ data: state.list?.[table] || [], error: null }).then(resolve);
                }
            };
            return query;
        }
    };
}

function loadHandler({ db, adapter, seal }) {
    const originalLoad = Module._load;
    Module._load = function patched(request, parent, isMain) {
        if (parent?.filename === handlerPath && request === '../../../../api/_lib/admin') {
            return {
                parseJsonBody: async (req) => req.body || {},
                requireAdmin: async () => ({ adminSupabase: db, user: { id: ADMIN_ID } }),
                sendJson: (res, status, payload) => res.status(status).setHeader('Content-Type', 'application/json').end(JSON.stringify(payload)),
                writeAdminAuditLog: async () => {}
            };
        }
        if (parent?.filename === handlerPath && request === '../../../integrations/suppliers/registry') {
            return {
                createConfiguredSupplierAdapterRegistry: () => ({
                    get: (providerId) => (providerId === 'xiareng' ? adapter : null)
                })
            };
        }
        if (parent?.filename === handlerPath && request === '../../../integrations/suppliers/delivery') {
            return { sealDelivery: seal || (() => ({ fingerprint: 'a'.repeat(64) })) };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[handlerPath];
    const handler = require(handlerPath);
    Module._load = originalLoad;
    return handler;
}

function createAdapter(overrides = {}) {
    const calls = [];
    const adapter = {
        providerId: 'xiareng',
        capabilities: { catalog: true, quote: true, procurement: false },
        calls,
        async quotePrice(input) { calls.push(['quotePrice', input]); return { amount: '0.16', currency: 'CNY', quantity: 1 }; },
        async createPurchase(input) {
            calls.push(['createPurchase', input]);
            return { outcome: 'accepted', requestId: input.requestId, orderNo: '778217796203351836',
                actualAmountCny: '0.16', evidenceHash: 'b'.repeat(64) };
        },
        async fetchDelivery(input) { calls.push(['fetchDelivery', input]); return { content: CARD }; },
        ...overrides
    };
    return adapter;
}

function request(body) {
    return { method: 'POST', url: '/', headers: {}, body };
}

async function call(handler, body, options = {}) {
    const res = createResponse();
    await handler(request(body), res, options);
    return { status: res.statusCode, body: res.json(), raw: res.body };
}

const ENABLED = { env: { SHOP_SUPPLIER_MANUAL_PURCHASE_ENABLED: 'true' } };

test('the manual path stays off until the operator switch is on', async () => {
    const handler = loadHandler({ db: createDb(), adapter: createAdapter() });
    const result = await call(handler, { action: 'context', intentId: INTENT_ID }, { env: {} });
    assert.equal(result.status, 503);
    assert.equal(result.body.code, 'supplier_manual_disabled');
});

test('only POST is accepted and the action must be one of the four manual steps', async () => {
    const handler = loadHandler({ db: createDb(), adapter: createAdapter() });
    const get = createResponse();
    await handler({ method: 'GET', url: '/' }, get, ENABLED);
    assert.equal(get.statusCode, 405);
    const bad = await call(handler, { action: 'dispatch', intentId: INTENT_ID }, ENABLED);
    assert.equal(bad.status, 400);
    const unknownKey = await call(handler, { action: 'quote', intentId: INTENT_ID, amount: '0.01' }, ENABLED);
    assert.equal(unknownKey.status, 400);
});

test('a blocked context never reaches the supplier', async () => {
    const adapter = createAdapter();
    const db = createDb({ rpc: { fn_shop_supplier_manual_context_v2: () => ({ status: 'blocked', reason: 'native_not_ready', intentId: INTENT_ID }) } });
    const handler = loadHandler({ db, adapter });
    const result = await call(handler, { action: 'quote', intentId: INTENT_ID }, ENABLED);
    assert.equal(result.status, 200);
    assert.equal(result.body.result.status, 'blocked');
    assert.equal(result.body.result.reason, 'native_not_ready');
    assert.equal(adapter.calls.length, 0);
    assert.equal(db.calls.rpc.some((entry) => entry.name === 'fn_shop_supplier_manual_quote_v2'), false);
});

test('quote records exactly the live CNY amount the server read', async () => {
    const db = createDb({ rpc: {
        fn_shop_supplier_manual_context_v2: () => ({ status: 'ready', intentId: INTENT_ID, goodsNo: 'XR-1', variant: {}, costCeilingCny: '1.000000', quantity: 1 }),
        fn_shop_supplier_manual_quote_v2: (params) => ({ status: 'quoted', purchaseId: PURCHASE_ID, quotedAmountCny: params.p_quoted_amount_cny,
            quoteCurrency: 'CNY', quoteExpiresAt: '2026-10-21T00:02:00.000Z', costCeilingCny: '1.000000', attemptCount: 1, overCeiling: false,
            goodsNo: 'XR-1', providerId: 'xiareng' })
    } });
    const adapter = createAdapter();
    const handler = loadHandler({ db, adapter });
    const result = await call(handler, { action: 'quote', intentId: INTENT_ID }, ENABLED);
    assert.equal(result.status, 200);
    assert.equal(result.body.result.status, 'quoted');
    assert.equal(result.body.result.quotedAmountCny, '0.16');
    const recorded = db.calls.rpc.find((entry) => entry.name === 'fn_shop_supplier_manual_quote_v2');
    assert.equal(recorded.params.p_quoted_amount_cny, '0.16');
    assert.equal(recorded.params.p_admin_id, ADMIN_ID);
});

test('a non-CNY or unparsable quote is refused instead of being recorded', async () => {
    const db = createDb({ rpc: {
        fn_shop_supplier_manual_context_v2: () => ({ status: 'ready', intentId: INTENT_ID, goodsNo: 'XR-1', variant: {}, costCeilingCny: '1.000000' })
    } });
    const usd = loadHandler({ db, adapter: createAdapter({ quotePrice: async () => ({ amount: '0.16', currency: 'USD' }) }) });
    const usdResult = await call(usd, { action: 'quote', intentId: INTENT_ID }, ENABLED);
    assert.equal(usdResult.status, 502);
    assert.equal(usdResult.body.code, 'supplier_manual_quote_failed');

    const garbage = loadHandler({ db, adapter: createAdapter({ quotePrice: async () => ({ amount: '0.1e3', currency: 'CNY' }) }) });
    const garbageResult = await call(garbage, { action: 'quote', intentId: INTENT_ID }, ENABLED);
    assert.equal(garbageResult.status, 502);
});

test('confirm refuses an unconfirmed click before touching the database', async () => {
    const db = createDb();
    const handler = loadHandler({ db, adapter: createAdapter() });
    const result = await call(handler, { action: 'confirm', purchaseId: PURCHASE_ID, quotedAmountCny: '0.16' }, ENABLED);
    assert.equal(result.status, 400);
    assert.equal(db.calls.rpc.length, 0);
});

test('a stale or already-claimed quote never trades a second time', async () => {
    const adapter = createAdapter();
    const db = createDb({ rpc: {
        fn_shop_supplier_manual_confirm_v2: () => ({ claimed: false, reason: 'quote_amount_changed', quotedAmountCny: '0.17' })
    } });
    const handler = loadHandler({ db, adapter });
    const result = await call(handler, { action: 'confirm', purchaseId: PURCHASE_ID, quotedAmountCny: '0.16', confirm: true }, ENABLED);
    assert.equal(result.status, 200);
    assert.equal(result.body.result.status, 'not_claimed');
    assert.equal(result.body.result.stale, true);
    assert.equal(adapter.calls.length, 0);
});

test('accepted: stage the order number, seal the card and record a receipt without leaking the card', async () => {
    const adapter = createAdapter();
    const sealed = { fingerprint: 'c'.repeat(64), ciphertext: 'x' };
    let sealContext = null;
    const db = createDb({ rpc: {
        fn_shop_supplier_manual_confirm_v2: () => ({ claimed: true, purchaseId: PURCHASE_ID, requestId: REQUEST_ID,
            goodsNo: 'XR-1', variant: {}, quantity: 1, providerId: 'xiareng', accountId: ACCOUNT_ID,
            quotedAmountCny: '0.16', costCeilingCny: '1.000000', fundingKind: 'points', site: 'cn' }),
        fn_shop_supplier_manual_stage_v2: () => ({ status: 'confirmed', staged: true, supplierOrderNo: '778217796203351836' }),
        fn_shop_supplier_manual_record_v2: () => ({ status: 'delivered', applied: true })
    } });
    const handler = loadHandler({ db, adapter, seal: (content, context) => { sealContext = { content, context }; return sealed; } });
    const result = await call(handler, { action: 'confirm', purchaseId: PURCHASE_ID, quotedAmountCny: '0.16', confirm: true }, ENABLED);
    assert.equal(result.status, 200);
    assert.equal(result.body.result.status, 'delivered');
    assert.equal(result.body.result.supplierOrderNo, '778217796203351836');

    const trade = adapter.calls.find(([name]) => name === 'createPurchase');
    assert.equal(trade[1].requestId, REQUEST_ID);
    assert.equal(trade[1].quantity, 1);
    assert.deepEqual(trade[1].maxCost, { currency: 'CNY', amount: '1.000000' });

    const stage = db.calls.rpc.find((entry) => entry.name === 'fn_shop_supplier_manual_stage_v2');
    assert.equal(stage.params.p_trade_no, '778217796203351836');
    assert.equal(stage.params.p_actual_amount_cny, '0.16');

    assert.equal(sealContext.content, CARD);
    assert.deepEqual(sealContext.context, { unitId: UNIT_ID, intentId: INTENT_ID, site: 'cn', orderNo: '778217796203351836' });

    const record = db.calls.rpc.find((entry) => entry.name === 'fn_shop_supplier_manual_record_v2');
    assert.equal(record.params.p_outcome, 'accepted');
    assert.equal(record.params.p_sealed.fingerprint, 'c'.repeat(64));

    // The card never leaves the process in the HTTP response.
    assert.equal(result.raw.includes(CARD), false);
    assert.equal(JSON.stringify(db.calls.rpc).includes(CARD), false);
});

test('an ambiguous supplier answer parks the attempt as unknown and never retries', async () => {
    const adapter = createAdapter({ createPurchase: async (input) => {
        adapter.calls.push(['createPurchase', input]);
        return { outcome: 'unknown', requestId: input.requestId, code: 'request_key_already_exists' };
    } });
    const db = createDb({ rpc: {
        fn_shop_supplier_manual_confirm_v2: () => ({ claimed: true, purchaseId: PURCHASE_ID, requestId: REQUEST_ID,
            goodsNo: 'XR-1', variant: {}, costCeilingCny: '1.000000' }),
        fn_shop_supplier_manual_record_v2: () => ({ status: 'unknown', applied: true })
    } });
    const handler = loadHandler({ db, adapter });
    const result = await call(handler, { action: 'confirm', purchaseId: PURCHASE_ID, quotedAmountCny: '0.16', confirm: true }, ENABLED);
    assert.equal(result.status, 200);
    assert.equal(result.body.result.status, 'unknown');
    const record = db.calls.rpc.find((entry) => entry.name === 'fn_shop_supplier_manual_record_v2');
    assert.equal(record.params.p_outcome, 'unknown');
    assert.equal(record.params.p_failure_code, 'request_key_already_exists');
    assert.equal(adapter.calls.filter(([name]) => name === 'createPurchase').length, 1);
});

test('a definitive rejection is recorded as rejected, not unknown', async () => {
    const adapter = createAdapter({ createPurchase: async (input) => {
        adapter.calls.push(['createPurchase', input]);
        return { outcome: 'rejected', definitivelyNotAccepted: true, code: 'supplier_out_of_stock' };
    } });
    const db = createDb({ rpc: {
        fn_shop_supplier_manual_confirm_v2: () => ({ claimed: true, purchaseId: PURCHASE_ID, requestId: REQUEST_ID,
            goodsNo: 'XR-1', variant: {}, costCeilingCny: '1.000000' }),
        fn_shop_supplier_manual_record_v2: () => ({ status: 'rejected', applied: true })
    } });
    const handler = loadHandler({ db, adapter });
    const result = await call(handler, { action: 'confirm', purchaseId: PURCHASE_ID, quotedAmountCny: '0.16', confirm: true }, ENABLED);
    assert.equal(result.body.result.status, 'rejected');
    const record = db.calls.rpc.find((entry) => entry.name === 'fn_shop_supplier_manual_record_v2');
    assert.equal(record.params.p_outcome, 'rejected');
    assert.equal(record.params.p_failure_code, 'supplier_out_of_stock');
});

test('a thrown trade error is parked as unknown and never becomes a rejection', async () => {
    const adapter = createAdapter({ createPurchase: async () => {
        throw Object.assign(new Error('socket hang up'), { code: 'supplier_request_failed' });
    } });
    const db = createDb({ rpc: {
        fn_shop_supplier_manual_confirm_v2: () => ({ claimed: true, purchaseId: PURCHASE_ID, requestId: REQUEST_ID,
            goodsNo: 'XR-1', variant: {}, costCeilingCny: '1.000000' }),
        fn_shop_supplier_manual_record_v2: () => ({ status: 'unknown', applied: true })
    } });
    const handler = loadHandler({ db, adapter });
    const result = await call(handler, { action: 'confirm', purchaseId: PURCHASE_ID, quotedAmountCny: '0.16', confirm: true }, ENABLED);
    assert.equal(result.body.result.status, 'unknown');
    const record = db.calls.rpc.find((entry) => entry.name === 'fn_shop_supplier_manual_record_v2');
    assert.equal(record.params.p_outcome, 'unknown');
    assert.equal(record.params.p_failure_code, 'supplier_request_failed');
});

test('an accepted debit with a missing card stays unknown and can be finalised later', async () => {
    const adapter = createAdapter({ fetchDelivery: async () => null });
    const db = createDb({ rpc: {
        fn_shop_supplier_manual_confirm_v2: () => ({ claimed: true, purchaseId: PURCHASE_ID, requestId: REQUEST_ID,
            goodsNo: 'XR-1', variant: {}, costCeilingCny: '1.000000' }),
        fn_shop_supplier_manual_stage_v2: () => ({ status: 'confirmed', staged: true, supplierOrderNo: '778217796203351836' }),
        fn_shop_supplier_manual_record_v2: () => ({ status: 'unknown', applied: true })
    } });
    const handler = loadHandler({ db, adapter });
    const result = await call(handler, { action: 'confirm', purchaseId: PURCHASE_ID, quotedAmountCny: '0.16', confirm: true }, ENABLED);
    assert.equal(result.body.result.status, 'unknown');
    assert.equal(result.body.result.reason, 'supplier_delivery_missing');
    assert.equal(result.body.result.supplierOrderNo, '778217796203351836');
    const record = db.calls.rpc.find((entry) => entry.name === 'fn_shop_supplier_manual_record_v2');
    assert.equal(record.params.p_failure_code, 'supplier_delivery_missing');
});

test('finalize re-reads the staged order number and never trades again', async () => {
    const adapter = createAdapter();
    const db = createDb({
        purchase: { id: PURCHASE_ID, intent_id: INTENT_ID, unit_id: UNIT_ID, supplier_account_id: ACCOUNT_ID,
            original_request_id: REQUEST_ID, state: 'confirmed', attempt_count: 1,
            quoted_amount_cny: '0.16', cost_ceiling_cny: '1.000000',
            supplier_order_no: '778217796203351836', actual_amount_cny: '0.16' },
        list: { shop_supplier_manual_purchase_events: [{ detail: { evidenceHash: 'd'.repeat(64) } }] },
        rpc: { fn_shop_supplier_manual_record_v2: () => ({ status: 'delivered', applied: true }) }
    });
    const handler = loadHandler({ db, adapter });
    const result = await call(handler, { action: 'finalize', purchaseId: PURCHASE_ID }, ENABLED);
    assert.equal(result.status, 200);
    assert.equal(result.body.result.status, 'delivered');
    assert.equal(adapter.calls.some(([name]) => name === 'createPurchase'), false);
    const record = db.calls.rpc.find((entry) => entry.name === 'fn_shop_supplier_manual_record_v2');
    assert.equal(record.params.p_trade_no, '778217796203351836');
    assert.equal(record.params.p_actual_amount_cny, '0.16');
    assert.equal(record.params.p_evidence_hash, 'd'.repeat(64));
});

test('finalize refuses a purchase that has no staged order number', async () => {
    const adapter = createAdapter();
    const db = createDb({ purchase: { id: PURCHASE_ID, intent_id: INTENT_ID, unit_id: UNIT_ID,
        supplier_account_id: ACCOUNT_ID, original_request_id: REQUEST_ID, state: 'confirmed',
        supplier_order_no: null, actual_amount_cny: null } });
    const handler = loadHandler({ db, adapter });
    const result = await call(handler, { action: 'finalize', purchaseId: PURCHASE_ID }, ENABLED);
    assert.equal(result.status, 200);
    assert.equal(result.body.result.status, 'not_finalizable');
    assert.equal(result.body.result.reason, 'supplier_order_missing');
    assert.equal(adapter.calls.length, 0);
});
