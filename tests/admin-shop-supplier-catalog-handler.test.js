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
                    const result = state.results.shift() || { data: null, error: null };
                    return Promise.resolve(result);
                }
            };
            return query;
        }
    };
}

function makeHandler({ adapter = createAdapter(), state = {}, adminError = null } = {}) {
    const calls = {
        auth: [],
        audits: [],
        supplierCalls: []
    };
    const mockState = {
        writes: [],
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
        env: { SUPPLIER_16688_APP_ID: 'app', SUPPLIER_16688_SECRET: 'secret' },
        registryFactory() {
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
