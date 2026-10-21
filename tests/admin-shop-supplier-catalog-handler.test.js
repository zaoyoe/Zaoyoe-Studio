'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const {
    createSupplierAdapterRegistry
} = require('../server/integrations/suppliers/contract');
const handlerPath = require.resolve('../server/api-handlers/admin/shop/supplier-catalog');
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
    if (request === '../../../../api/_lib/admin' && parent?.filename === handlerPath) {
        return {
            parseJsonBody: async (req) => req.body || {},
            requireAdmin: async () => ({ supabase: null, user: null }),
            sendJson: (res, status, payload) => res.status(status).setHeader('Content-Type', 'application/json').end(JSON.stringify(payload)),
            writeAdminAuditLog: async () => {}
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};
const handlerModule = require(handlerPath);
Module._load = originalLoad;

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

function createAdapter(overrides = {}) {
    return {
        providerId: '16688',
        displayName: '16688',
        capabilities: { catalog: true },
        normalizeCatalogItem(item) {
            return {
                providerGoodsId: String(item.goods_no || item.providerGoodsId || ''),
                name: String(item.goods_name || item.name || ''),
                description: '',
                imageUrl: '',
                supplierUnitPrice: null,
                currency: 'CNY',
                minimumQuantity: null,
                deliveryMethod: null
            };
        },
        async listGoods() {
            return { total: 1, items: [{ goods_no: 'G-1', goods_name: '测试上游商品' }] };
        },
        async getGoodsDetail(goodsNo) {
            return { goods_no: goodsNo, goods_name: '测试上游商品' };
        },
        ...overrides
    };
}

function createSupabase(state) {
    return {
        async rpc(name, input) {
            state.rpcCalls.push({ name, input });
            return state.results.shift() || { data: null, error: null };
        },
        from(table) {
            const query = {
                table,
                mode: 'read',
                payload: null,
                filters: [],
                select(columns) { this.columns = columns; return this; },
                eq(column, value) { this.filters.push([column, value]); return this; },
                insert(payload) { this.mode = 'insert'; this.payload = payload; state.writes.push({ table, mode: 'insert', payload }); return this; },
                delete() { this.mode = 'delete'; state.writes.push({ table, mode: 'delete' }); return this; },
                maybeSingle() { return this.finish(); },
                single() { return this.finish(); },
                then(resolve, reject) { return this.finish().then(resolve, reject); },
                finish() {
                    state.queries.push({ table, columns: this.columns, filters: this.filters });
                    const result = state.results.shift() || { data: null, error: null };
                    return Promise.resolve(result);
                }
            };
            return query;
        }
    };
}

function makeHandler({ adapter = createAdapter(), state = {}, adminError = null, env = { SUPPLIER_16688_APP_ID: 'app', SUPPLIER_16688_SECRET: 'secret' } } = {}) {
    const calls = {
        auth: [],
        audits: [],
        supplierCalls: [],
        registries: []
    };
    const mockState = {
        writes: [],
        queries: [],
        rpcCalls: [],
        results: [
            { data: { id: 'account-1', provider_id: '16688', account_key: 'default', is_enabled: true }, error: null },
            { data: null, error: null },
            { data: { id: 'product-1', name: '测试上游商品' }, error: null },
            { data: { id: 'sku-1' }, error: null },
            { data: null, error: null }
        ],
        ...state
    };
    const handler = handlerModule.createSupplierCatalogHandler({
        env,
        registryFactory(config) {
            calls.registries.push(config.account);
            const instrumented = {
                ...adapter,
                async listGoods(input) {
                    calls.supplierCalls.push({ method: 'listGoods', input });
                    return adapter.listGoods(input);
                },
                async getGoodsDetail(goodsNo) {
                    calls.supplierCalls.push({ method: 'getGoodsDetail', goodsNo });
                    return adapter.getGoodsDetail(goodsNo);
                }
            };
            return createSupplierAdapterRegistry([instrumented]);
        },
        async requireAdmin(req, options) {
            calls.auth.push(options);
            if (adminError) throw adminError;
            return { supabase: createSupabase(mockState), user: { id: 'admin-1' } };
        },
        parseJsonBody: async (req) => req.body || {},
        sendJson(res, status, payload) {
            res.status(status).setHeader('Content-Type', 'application/json').end(JSON.stringify(payload));
        },
        async writeAdminAuditLog(payload) { calls.audits.push(payload); }
    });
    return { handler, calls, state: mockState };
}

test('supplier catalog list requires admin and returns only normalized upstream fields', async () => {
    const { handler, calls } = makeHandler();
    const res = createResponse();

    await handler({ method: 'GET', headers: {}, url: '/api/admin/shop/supplier-catalog?pageNo=2&pageSize=500&keywords=abc' }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.deepEqual(calls.auth, [{ permission: 'shop.manage' }]);
    assert.deepEqual(calls.supplierCalls[0], {
        method: 'listGoods',
        input: { pageNo: 2, pageSize: 100, keywords: 'abc', source: '' }
    });
    assert.equal(payload.items[0].providerGoodsId, 'G-1');
    assert.equal(payload.items[0].name, '测试上游商品');
    assert.equal('raw' in payload.items[0], false);
    assert.match(payload.note, /不代表已锁定库存/);
});

test('single and bulk supplier imports create only inactive local drafts and disabled mappings', async () => {
    const { handler, calls, state } = makeHandler();
    const res = createResponse();

    await handler({
        method: 'POST',
        headers: {},
        url: '/api/admin/shop/supplier-catalog',
        body: { action: 'import', site: 'cn', goodsNos: ['G-1', 'G-1'] }
    }, res);

    const payload = res.json();
    assert.equal(res.statusCode, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.results.length, 1);
    assert.equal(payload.results[0].status, 'imported_as_draft');
    assert.deepEqual(state.writes.map((write) => write.table), [
        'shop_products',
        'shop_supplier_product_mappings'
    ]);
    assert.deepEqual(state.writes[0].payload, {
        name: '测试上游商品',
        description: null,
        category: 'resource',
        tags: [],
        price_points: 0,
        stock_count: 0,
        is_active: false
    });
    assert.equal(state.writes[1].payload.is_enabled, false);
    assert.equal(state.writes[1].payload.is_primary, true);
    assert.equal(state.writes[1].payload.sku_id, 'sku-1');
    assert.equal(calls.audits.length, 1);
    assert.equal(calls.audits[0].adminId, 'admin-1');
    assert.equal(calls.audits[0].details.mapping_enabled, false);
    assert.match(payload.note, /不会开放购买/);
});

test('disabled supplier accounts fail closed before any upstream request', async () => {
    const calls = [];
    const { handler } = makeHandler({
        adapter: createAdapter({
            async listGoods() {
                calls.push('listGoods');
                return { total: 0, items: [] };
            }
        }),
        state: {
            writes: [],
            results: [{ data: { id: 'account-1', provider_id: '16688', account_key: 'default', is_enabled: false }, error: null }]
        }
    });
    const res = createResponse();

    await handler({
        method: 'GET',
        headers: {},
        url: '/api/admin/shop/supplier-catalog?action=list'
    }, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.json().code, 'supplier_account_disabled');
    assert.deepEqual(calls, []);
});

test('supplier catalog import fails closed with a clear migration-not-ready response', async () => {
    const state = {
        writes: [],
        results: [{ data: null, error: { code: '42P01', message: 'relation "shop_supplier_accounts" does not exist' } }]
    };
    const { handler } = makeHandler({ state });
    const res = createResponse();

    await handler({
        method: 'POST',
        headers: {},
        url: '/api/admin/shop/supplier-catalog',
        body: { action: 'import', goodsNo: 'G-1' }
    }, res);

    assert.equal(res.statusCode, 503);
    assert.equal(res.json().code, 'supplier_schema_not_ready');
    assert.match(res.json().message, /应用数据库迁移/);
    assert.deepEqual(state.writes, []);
});


test('re-importing an existing source listing returns its mapping without overwriting local product data', async () => {
    const state = {
        writes: [],
        results: [
            { data: { id: 'account-1', provider_id: '16688', account_key: 'default', is_enabled: true }, error: null },
            { data: { id: 'mapping-1', product_id: 'existing-product', sku_id: 'existing-sku', site: 'cn' }, error: null }
        ]
    };
    const { handler } = makeHandler({ state });
    const res = createResponse();

    await handler({
        method: 'POST',
        headers: {},
        url: '/api/admin/shop/supplier-catalog',
        body: { action: 'import', goodsNo: 'G-1', site: 'cn' }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.json().results[0].status, 'already_imported');
    assert.equal(res.json().results[0].productId, 'existing-product');
    assert.deepEqual(state.writes, []);
});

test('failed mapping creation compensates by removing the newly created inactive draft', async () => {
    const state = {
        writes: [],
        results: [
            { data: { id: 'account-1', provider_id: '16688', account_key: 'default', is_enabled: true }, error: null },
            { data: null, error: null },
            { data: { id: 'product-1', name: '测试上游商品' }, error: null },
            { data: { id: 'sku-1' }, error: null },
            { data: null, error: { code: '23505', message: 'duplicate mapping' } },
            { data: null, error: null }
        ]
    };
    const { handler } = makeHandler({ state });
    const res = createResponse();

    await handler({
        method: 'POST',
        headers: {},
        url: '/api/admin/shop/supplier-catalog',
        body: { action: 'import', goodsNo: 'G-1' }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.json().success, false);
    assert.equal(res.json().results[0].status, 'failed');
    assert.deepEqual(state.writes.map(({ table, mode }) => [table, mode]), [
        ['shop_products', 'insert'],
        ['shop_supplier_product_mappings', 'insert'],
        ['shop_products', 'delete']
    ]);
});

test('supplier catalog route rejects unsupported methods and invalid bulk size', async () => {
    const { handler } = makeHandler();
    const methodRes = createResponse();
    await handler({ method: 'DELETE', headers: {}, url: '/api/admin/shop/supplier-catalog' }, methodRes);
    assert.equal(methodRes.statusCode, 405);
    assert.equal(methodRes.headers.Allow, 'GET, POST');

    const { handler: importHandler } = makeHandler();
    const bulkRes = createResponse();
    await importHandler({
        method: 'POST',
        headers: {},
        url: '/api/admin/shop/supplier-catalog',
        body: { action: 'import', goodsNos: Array.from({ length: 21 }, (_, index) => `G-${index}`) }
    }, bulkRes);
    assert.equal(bulkRes.statusCode, 400);
    assert.deepEqual(bulkRes.json().code, undefined);
});

test('supplier catalog API handler is registered on the admin gateway', () => {
    const fs = require('node:fs');
    const source = fs.readFileSync(require.resolve('../api/admin'), 'utf8');
    assert.match(source, /shopSupplierCatalogHandler = require\('\.\.\/server\/api-handlers\/admin\/shop\/supplier-catalog'\)/);
    assert.match(source, /'shop\/supplier-catalog': shopSupplierCatalogHandler/);
});

const { createXiarengAdapter } = require('../server/integrations/suppliers/xiareng/client');
const xrAccount = { id: 'xr-account', provider_id: 'xiareng', account_key: 'second', display_name: '第二账号', credential_ref: 'env:SUPPLIER_XIARENG_SECOND', is_enabled: true };
function makeXiareng(payload = {}, state = {}) {
    const adapter = createXiarengAdapter({ appId: 'a', appKey: 'k', async fetchImpl() {
        return new Response(JSON.stringify({ code: 200, data: { code: 'XR-1', name: '只读商品', user_price: '1.25', stock: 5, config: {}, ...payload } }));
    } });
    return makeHandler({ adapter, state: { results: [{ data: xrAccount, error: null }, { data: { status: 'imported_as_draft', productId: 'p1', mappingId: 'm1', site: 'cn' }, error: null }], ...state } });
}

test('account discovery returns safe configuration metadata without adapter construction or upstream calls', async () => {
    const { handler, calls } = makeHandler({ state: { results: [{ data: [xrAccount], error: null }] }, env: { SUPPLIER_XIARENG_SECOND_APP_ID: 'private-id', SUPPLIER_XIARENG_SECOND_APP_KEY: 'private-key' } });
    const res = createResponse();
    await handler({ method: 'GET', url: '/api/admin/shop/supplier-catalog?action=accounts&providerId=xiareng' }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(res.json().accounts[0].configured, true);
    assert.equal(res.json().accounts[0].accountKey, 'second');
    assert.equal(res.json().accounts[0].procurementReady, false);
    assert.doesNotMatch(res.body, /credential_ref|private-id|private-key|env:/);
    assert.deepEqual(calls.registries, []);
    assert.deepEqual(calls.supplierCalls, []);
});

test('catalog requests resolve exactly the selected provider/account and carry it to the isolated registry', async () => {
    const { handler, state, calls } = makeHandler({ state: { results: [{ data: { ...xrAccount, provider_id: '16688' }, error: null }] } });
    const res = createResponse();
    await handler({ method: 'GET', url: '/api/admin/shop/supplier-catalog?providerId=16688&accountKey=second' }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(state.queries[0].filters, [['provider_id', '16688'], ['account_key', 'second']]);
    assert.equal(calls.registries[0].id, 'xr-account');
    assert.equal(res.json().accountKey, 'second');
});

test('paused nondefault account and unsupported actions never construct an adapter or call upstream', async () => {
    const { handler, calls } = makeHandler({ state: { results: [{ data: { ...xrAccount, is_enabled: false }, error: null }] } });
    let res = createResponse();
    await handler({ method: 'GET', url: '/api/admin/shop/supplier-catalog?providerId=xiareng&accountKey=second' }, res);
    assert.equal(res.statusCode, 409);
    res = createResponse();
    await handler({ method: 'POST', url: '/api/admin/shop/supplier-catalog', body: { action: 'purchase', providerId: 'xiareng' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(calls.registries.length, 0);
    assert.equal(calls.supplierCalls.length, 0);
});

test('Xiareng draft import uses one transactional RPC with a sanitized snapshot and server-validated race', async () => {
    const { handler, state, calls } = makeXiareng({ config: { category: { 月卡: '1', 年卡: '2' } }, secret: 'must-not-store', owner: { app_key: 'must-not-store' } });
    const res = createResponse();
    await handler({ method: 'POST', url: '/api/admin/shop/supplier-catalog', body: { action: 'import', providerId: 'xiareng', accountKey: 'second', site: 'cn', goodsNos: ['XR-1'], variants: { 'XR-1': { race: '月卡' } } } }, res);
    assert.equal(res.json().success, true);
    assert.equal(state.rpcCalls.length, 1);
    assert.equal(state.rpcCalls[0].name, 'import_shop_supplier_draft_v2');
    const input = state.rpcCalls[0].input;
    assert.equal(input.p_account_id, 'xr-account');
    assert.equal(input.p_admin_id, 'admin-1');
    assert.deepEqual(input.p_variant, { race: '月卡' });
    // The supplier quotes in CNY; the 2026-10-21 probe confirmed it.
    assert.equal(input.p_snapshot.currency, 'CNY');
    assert.equal(input.p_snapshot.procurementReady, false);
    assert.match(input.p_name, /月卡/);
    assert.doesNotMatch(JSON.stringify(input), /must-not-store|app_key|secret/);
    assert.deepEqual(state.writes, []);
    assert.deepEqual(calls.audits, []); // Audit is in the same RPC transaction.
});

test('unsupported SKU, unspecified race and unsupported site do not create even an inactive product', async () => {
    for (const [detail, body] of [
        [{ config: { sku: { color: ['black'] } } }, {}],
        [{ config: { category: { 月卡: 1 } } }, {}],
        [{}, { site: 'intl' }]
    ]) {
        const { handler, state } = makeXiareng(detail);
        const res = createResponse();
        await handler({ method: 'POST', url: '/api/admin/shop/supplier-catalog', body: { action: 'import', providerId: 'xiareng', goodsNo: 'XR-1', ...body } }, res);
        assert.equal(res.json().success, false);
        assert.deepEqual(state.rpcCalls, []);
        assert.deepEqual(state.writes, []);
    }
});

test('a missing v2 database function fails explicitly without falling back to nontransactional product writes', async () => {
    const { handler, state } = makeXiareng({}, { results: [{ data: xrAccount, error: null }, { data: null, error: { code: 'PGRST202', message: 'Could not find import_shop_supplier_draft_v2' } }] });
    const res = createResponse();
    await handler({ method: 'POST', url: '/api/admin/shop/supplier-catalog', body: { action: 'import', providerId: 'xiareng', goodsNo: 'XR-1' } }, res);
    assert.equal(res.json().success, false);
    assert.match(res.json().results[0].message, /迁移尚未应用/);
    assert.deepEqual(state.writes, []);
});

test('read-only preview requires stock/quote capabilities and never writes local products or mappings', async () => {
    const adapter = createAdapter({ providerId: 'xiareng', capabilities: { catalog: true, quote: true, stock: true },
        async getStock(input) { assert.deepEqual(input.variant, { race: '月卡' }); return { availableQuantity: 4, locked: false }; },
        async quotePrice(input) { assert.equal(input.quantity, 1); return { amount: '1.250000', currency: null, locked: false }; }
    });
    const { handler, state } = makeHandler({ adapter, state: { results: [{ data: xrAccount, error: null }] } });
    const res = createResponse();
    await handler({ method: 'GET', url: '/api/admin/shop/supplier-catalog?action=preview&providerId=xiareng&accountKey=second&goodsNo=XR-1&race=%E6%9C%88%E5%8D%A1' }, res);
    assert.equal(res.json().stock.availableQuantity, 4);
    assert.equal(res.json().quote.amount, '1.250000');
    assert.equal(res.json().procurementReady, false);
    assert.deepEqual(state.writes, []);
});

test('product source summary excludes credentials and stays readable on the pre-v2 schema', async () => {
    const { handler, calls, state } = makeHandler({ state: { results: [
        { data: null, error: { code: '42703', message: 'column supplier_variant does not exist' } },
        { data: [{ id: 'm1', site: 'cn', supplier_goods_no: 'XR-1', is_enabled: false, shop_supplier_accounts: { provider_id: 'xiareng', display_name: '只读账号' } }], error: null }
    ] } });
    const res = createResponse();
    await handler({ method: 'GET', url: '/api/admin/shop/supplier-catalog?action=mappings&productId=00000000-0000-0000-0000-000000000001' }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().mappings[0].accountName, '只读账号');
    assert.equal(res.json().mappings[0].procurementReady, false);
    assert.doesNotMatch(state.queries[1].columns, /credential_ref|supplier_variant/);
    assert.equal(calls.registries.length, 0);
});

test('source summary allowlists stored fields and rejects malformed product IDs before reading the database', async () => {
    const { handler, state } = makeHandler({ state: { results: [{ data: [{
        id: 'm1', site: 'cn', supplier_goods_no: 'XR-1', is_enabled: false, contract_version: 2,
        supplier_variant: { race: '月卡', app_key: 'never-return-this' },
        import_snapshot: { supplierUnitPrice: '0.12345678', currency: null, app_key: 'never-return-this', raw: { secret: 'never-return-this' }, procurementReady: true },
        shop_supplier_accounts: { provider_id: 'xiareng', display_name: '只读账号', credential_ref: 'never-return-this' }
    }], error: null }] } });
    const invalid = createResponse();
    await handler({ method: 'GET', url: '/api/admin/shop/supplier-catalog?action=mappings&productId=------------------------------------' }, invalid);
    assert.equal(invalid.statusCode, 400);
    assert.equal(state.queries.length, 0);
    const res = createResponse();
    await handler({ method: 'GET', url: '/api/admin/shop/supplier-catalog?action=mappings&productId=00000000-0000-0000-0000-000000000001' }, res);
    assert.equal(res.statusCode, 200);
    const mapping = res.json().mappings[0];
    assert.deepEqual(mapping.variant, { race: '月卡' });
    assert.deepEqual(mapping.snapshot, { supplierUnitPrice: '0.12345678', currency: null, procurementReady: false });
    assert.doesNotMatch(res.body, /never-return-this|credential_ref|app_key|"raw"/);
});


test('procurement history needs shop.manage but no configured adapter, credential, or enabled account', async () => {
    const { handler, calls, state } = makeHandler({ env: {}, state: { results: [{ data: { rows: [], hasMore: false } }] } });
    const res = createResponse();
    await handler({ method: 'GET', headers: {}, url: '/api/admin/shop/supplier-catalog?action=procurements&providerId=xiareng&accountKey=disabled&site=cn' }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { success: true, rows: [], hasMore: false, limit: 50 });
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.deepEqual(calls.auth, [{ permission: 'shop.manage' }]);
    assert.deepEqual(calls.registries, []);
    assert.deepEqual(calls.supplierCalls, []);
    assert.deepEqual(state.queries, []);
    assert.deepEqual(state.writes, []);
    assert.deepEqual(state.rpcCalls, [{ name: 'fn_shop_supplier_operations_v2', input: {
        p_provider_id: 'xiareng', p_account_key: 'disabled', p_limit: 50,
        p_native_order_id: null, p_funding_kind: null, p_site: 'cn'
    } }]);
});

test('procurement history rejects unauthorized and invalid filters before accessing private data', async () => {
    const denied = makeHandler({ env: {}, adminError: Object.assign(new Error('Forbidden'), { statusCode: 403 }) });
    const res = createResponse();
    await denied.handler({ method: 'GET', headers: {}, url: '/api/admin/shop/supplier-catalog?action=procurements&providerId=xiareng&accountKey=first' }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(denied.state.rpcCalls.length, 0);
    for (const suffix of ['', '&accountKey=../first', '&accountKey=first&site=intl', '&accountKey=first&site=invalid']) {
        const h = makeHandler({ env: {} });
        const response = createResponse();
        await h.handler({ method: 'GET', headers: {}, url: '/api/admin/shop/supplier-catalog?action=procurements&providerId=xiareng' + suffix }, response);
        assert.equal(response.statusCode, 400);
        assert.equal(h.state.rpcCalls.length, 0);
        assert.equal(h.calls.registries.length, 0);
    }
});

test('procurement database failures return a safe retryable response without revealing internals', async () => {
    const h = makeHandler({ env: {}, state: { results: [{ error: { message: 'credential-and-card-secret' } }] } });
    const res = createResponse();
    await h.handler({ method: 'GET', headers: {}, url: '/api/admin/shop/supplier-catalog?action=procurements&providerId=xiareng&accountKey=first' }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().code, 'supplier_operations_unavailable');
    assert.doesNotMatch(res.body, /credential-and-card-secret/);
    assert.equal(h.calls.registries.length, 0);
});

test('known upstream order reconciliation is read-only and returns only safe status evidence', async () => {
    const lookups = [];
    const h = makeHandler({
        adapter: createAdapter({
            providerId: 'xiareng',
            capabilities: { catalog: true, orderLookup: true },
            async queryPurchaseByOrderNo(orderNo) {
                lookups.push(orderNo);
                return {
                    supplierOrderNo: orderNo,
                    paymentStatus: 'paid',
                    deliveryContentPresent: true,
                    queriedAt: '2026-10-21T23:00:00.000Z',
                    evidenceHash: 'a'.repeat(64)
                };
            }
        }),
        state: {
            writes: [],
            rpcCalls: [],
            results: [{ data: { id: 'account-x', provider_id: 'xiareng', account_key: 'default', is_enabled: true }, error: null }]
        }
    });
    const res = createResponse();

    await h.handler({
        method: 'GET',
        headers: {},
        url: '/api/admin/shop/supplier-catalog?action=reconcile&providerId=xiareng&accountKey=default&site=cn&orderNo=XR-ORDER-1'
    }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(lookups, ['XR-ORDER-1']);
    assert.deepEqual(res.json(), {
        success: true,
        result: {
            supplierOrderNo: 'XR-ORDER-1',
            paymentStatus: 'paid',
            deliveryContentPresent: true,
            queriedAt: '2026-10-21T23:00:00.000Z',
            evidenceHash: 'a'.repeat(64)
        }
    });
    assert.deepEqual(h.state.writes, []);
    assert.deepEqual(h.state.rpcCalls, []);
    assert.deepEqual(h.calls.audits, []);
    assert.equal(h.calls.registries.length, 1);
    assert.equal(h.calls.registries[0].id, 'account-x');
    assert.doesNotMatch(res.body, /secret|card|credential/i);
});

test('upstream order reconciliation rejects malformed input before any database or supplier access', async () => {
    const lookups = [];
    const h = makeHandler({
        adapter: createAdapter({
            providerId: 'xiareng',
            capabilities: { catalog: true, orderLookup: true },
            async queryPurchaseByOrderNo(orderNo) { lookups.push(orderNo); return null; }
        }),
        state: { queries: [], writes: [], rpcCalls: [] }
    });
    const res = createResponse();

    await h.handler({
        method: 'GET',
        headers: {},
        url: '/api/admin/shop/supplier-catalog?action=reconcile&providerId=xiareng&accountKey=default&site=cn&orderNo=bad'
    }, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.json().message, /完整且有效/);
    assert.deepEqual(h.state.queries, []);
    assert.deepEqual(h.state.writes, []);
    assert.deepEqual(h.state.rpcCalls, []);
    assert.deepEqual(lookups, []);
    assert.deepEqual(h.calls.registries, []);
});

test('upstream order reconciliation fails closed on lookup errors and malformed status evidence', async () => {
    for (const adapter of [
        createAdapter({
            providerId: 'xiareng',
            capabilities: { catalog: true, orderLookup: true },
            async queryPurchaseByOrderNo() { throw new Error('upstream-secret-card-data'); }
        }),
        createAdapter({
            providerId: 'xiareng',
            capabilities: { catalog: true, orderLookup: true },
            async queryPurchaseByOrderNo(orderNo) {
                return { supplierOrderNo: orderNo, paymentStatus: 'unknown', deliveryContentPresent: false,
                    queriedAt: '2026-10-21T23:00:00.000Z', evidenceHash: 'b'.repeat(64) };
            }
        })
    ]) {
        const h = makeHandler({
            adapter,
            state: { writes: [], rpcCalls: [], results: [{ data: { id: 'account-x', provider_id: 'xiareng', account_key: 'default', is_enabled: true }, error: null }] }
        });
        const res = createResponse();
        await h.handler({
            method: 'GET',
            headers: {},
            url: '/api/admin/shop/supplier-catalog?action=reconcile&providerId=xiareng&accountKey=default&site=cn&orderNo=XR-ORDER-1'
        }, res);
        assert.equal(res.statusCode, 502);
        assert.equal(res.json().code, 'supplier_order_lookup_failed');
        assert.doesNotMatch(res.body, /upstream-secret-card-data|unknown/);
        assert.deepEqual(h.state.writes, []);
        assert.deepEqual(h.state.rpcCalls, []);
        assert.deepEqual(h.calls.audits, []);
    }
});
