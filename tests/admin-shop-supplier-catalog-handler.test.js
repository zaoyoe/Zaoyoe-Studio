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
                update(payload) { this.mode = 'update'; this.payload = payload; state.writes.push({ table, mode: 'update', payload }); return this; },
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

function makeHandler({ adapter = createAdapter(), state = {}, adminError = null, now = Date.now, handlerModuleImpl = handlerModule, env = { SUPPLIER_16688_APP_ID: 'app', SUPPLIER_16688_SECRET: 'secret' } } = {}) {
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
    const handler = handlerModuleImpl.createSupplierCatalogHandler({
        env,
        now,
        registryFactory(config) {
            calls.registries.push(config.account);
            const instrumented = {
                ...adapter,
                async listGoods(input) {
                    calls.supplierCalls.push({ method: 'listGoods', input });
                    return adapter.listGoods(input);
                },
                async listAllGoods() {
                    calls.supplierCalls.push({ method: 'listAllGoods' });
                    return adapter.listAllGoods();
                },
                async getGoodsDetail(goodsNo) {
                    calls.supplierCalls.push({ method: 'getGoodsDetail', goodsNo });
                    return adapter.getGoodsDetail(goodsNo);
                },
                ...(typeof adapter.getDraftCards === 'function' ? {
                    async getDraftCards(input) {
                        calls.supplierCalls.push({ method: 'getDraftCards', input });
                        return adapter.getDraftCards(input);
                    }
                } : {})
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

    await handler({ method: 'GET', headers: {}, url: '/api/admin/shop/supplier-catalog?providerId=16688&pageNo=2&pageSize=500&keywords=abc' }, res);

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
        body: { action: 'import', providerId: '16688', site: 'cn', goodsNos: ['G-1', 'G-1'] }
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
        category: 'other',
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
        body: { action: 'import', providerId: '16688', goodsNo: 'G-1' }
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
        body: { action: 'import', providerId: '16688', goodsNo: 'G-1', site: 'cn' }
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
        body: { action: 'import', providerId: '16688', goodsNo: 'G-1' }
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
        body: { action: 'import', providerId: '16688', goodsNos: Array.from({ length: 21 }, (_, index) => `G-${index}`) }
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
let xiarengTestAccountNumber = 0;
function makeXiareng(payload = {}, state = {}) {
    const adapter = createXiarengAdapter({ appId: 'a', appKey: 'k', async fetchImpl() {
        return new Response(JSON.stringify({ code: 200, data: { code: 'XR-1', name: '只读商品', user_price: '1.25', stock: 5, config: {}, ...payload } }));
    } });
    return makeHandler({ adapter, state: { results: [{ data: xrAccount, error: null }, { data: { status: 'imported_as_draft', productId: 'p1', mappingId: 'm1', site: 'cn' }, error: null }], ...state } });
}

function makeXiarengCatalog({ items = [], categories = [
    { categoryKey: 'cat-1', name: '分类甲', upstreamIdCandidate: 'upstream-1' },
    { categoryKey: 'cat-2', name: '分类乙', upstreamIdCandidate: 'upstream-2' }
], now = Date.now, account = { ...xrAccount, id: `xr-account-${++xiarengTestAccountNumber}` }, handlerModuleImpl = handlerModule } = {}) {
    const base = createAdapter();
    const adapter = {
        ...base,
        providerId: 'xiareng',
        displayName: '虾仁',
        async listAllGoods() { return { categories, items }; },
        normalizeCatalogItem(source) {
            return { ...base.normalizeCatalogItem(source), catalogCategoryKeys: source.catalogCategoryKeys };
        }
    };
    return makeHandler({
        adapter,
        now,
        handlerModuleImpl,
        state: { results: Array.from({ length: 20 }, () => ({ data: account, error: null })) }
    });
}

test('Xiareng catalog snapshots merge duplicate goods across categories and reuse one snapshot for filters and pages', async () => {
    const { handler, calls } = makeXiarengCatalog({ items: [
        { goods_no: 'XR-DUP', goods_name: '重复商品', catalogCategoryKeys: ['cat-1'] },
        { goods_no: 'XR-DUP', goods_name: '重复商品', catalogCategoryKeys: ['cat-2'] },
        { goods_no: 'XR-1', goods_name: '另一个商品', catalogCategoryKeys: ['cat-1'] }
    ] });
    const first = createResponse();
    await handler({ method: 'GET', url: '/api/admin/shop/supplier-catalog?providerId=xiareng&accountKey=second&action=list&pageNo=1&pageSize=1' }, first);

    const firstPayload = first.json();
    assert.equal(first.statusCode, 200);
    assert.equal(firstPayload.total, 2);
    assert.equal(firstPayload.snapshotItemCount, 2);
    assert.deepEqual(firstPayload.categories.map(({ categoryKey, itemCount }) => [categoryKey, itemCount]), [
        ['cat-1', 2],
        ['cat-2', 1]
    ]);
    assert.equal(calls.supplierCalls.filter(({ method }) => method === 'listAllGoods').length, 1);

    const category = createResponse();
    await handler({ method: 'GET', url: `/api/admin/shop/supplier-catalog?providerId=xiareng&accountKey=second&action=list&snapshotId=${firstPayload.snapshotId}&categoryKey=cat-2&keywords=%E9%87%8D%E5%A4%8D` }, category);
    assert.equal(category.statusCode, 200);
    assert.equal(category.json().total, 1);
    assert.equal(category.json().items[0].providerGoodsId, 'XR-DUP');
    assert.deepEqual(category.json().items[0].catalogCategoryKeys, ['cat-1', 'cat-2']);

    const page = createResponse();
    await handler({ method: 'GET', url: `/api/admin/shop/supplier-catalog?providerId=xiareng&accountKey=second&action=list&snapshotId=${firstPayload.snapshotId}&pageNo=2&pageSize=1` }, page);
    assert.equal(page.statusCode, 200);
    assert.equal(page.json().items[0].providerGoodsId, 'XR-1');
    assert.equal(calls.supplierCalls.filter(({ method }) => method === 'listAllGoods').length, 1);

    const refresh = createResponse();
    await handler({ method: 'GET', url: '/api/admin/shop/supplier-catalog?providerId=xiareng&accountKey=second&action=list&refresh=1' }, refresh);
    assert.equal(refresh.statusCode, 200);
    assert.notEqual(refresh.json().snapshotId, firstPayload.snapshotId);
    assert.equal(calls.supplierCalls.filter(({ method }) => method === 'listAllGoods').length, 2);
});

test('Xiareng catalog snapshots survive admin handler recreation between category and page requests', async () => {
    const account = { ...xrAccount, id: 'xr-account-handler-recreation-test' };
    const firstHandler = makeXiarengCatalog({
        account,
        items: [
            { goods_no: 'XR-1', goods_name: '分类内商品一', catalogCategoryKeys: ['cat-1'] },
            { goods_no: 'XR-2', goods_name: '分类内商品二', catalogCategoryKeys: ['cat-1'] },
            { goods_no: 'XR-3', goods_name: '其他分类商品', catalogCategoryKeys: ['cat-2'] }
        ]
    });
    const initial = createResponse();
    await firstHandler.handler({
        method: 'GET',
        url: '/api/admin/shop/supplier-catalog?providerId=xiareng&accountKey=second&action=list&pageNo=1&pageSize=1'
    }, initial);
    assert.equal(initial.statusCode, 200);

    const recreatedModule = {
        ...handlerModule,
        createSupplierCatalogHandler: handlerModule.createSupplierCatalogHandler
    };
    const secondHandler = makeXiarengCatalog({
        account,
        items: [],
        handlerModuleImpl: recreatedModule
    });
    const filteredPage = createResponse();
    await secondHandler.handler({
        method: 'GET',
        url: `/api/admin/shop/supplier-catalog?providerId=xiareng&accountKey=second&action=list&snapshotId=${initial.json().snapshotId}&categoryKey=cat-1&pageNo=2&pageSize=1`
    }, filteredPage);

    assert.equal(filteredPage.statusCode, 200);
    assert.equal(filteredPage.json().total, 2);
    assert.equal(filteredPage.json().items[0].providerGoodsId, 'XR-2');
    assert.equal(firstHandler.calls.supplierCalls.filter(({ method }) => method === 'listAllGoods').length, 1);
    assert.equal(secondHandler.calls.supplierCalls.filter(({ method }) => method === 'listAllGoods').length, 0);
});

test('refreshing a Xiareng snapshot in another tab does not invalidate an unexpired snapshot', async () => {
    const account = { ...xrAccount, id: 'xr-account-parallel-snapshot-test' };
    let currentTime = 1_000_000;
    const firstTab = makeXiarengCatalog({
        account,
        now: () => currentTime,
        items: [
            { goods_no: 'XR-OLD-1', goods_name: '旧快照商品一', catalogCategoryKeys: ['cat-1'] },
            { goods_no: 'XR-OLD-2', goods_name: '旧快照商品二', catalogCategoryKeys: ['cat-1'] }
        ]
    });
    const initial = createResponse();
    await firstTab.handler({
        method: 'GET',
        url: '/api/admin/shop/supplier-catalog?providerId=xiareng&accountKey=second&action=list&pageSize=1'
    }, initial);
    assert.equal(initial.statusCode, 200);

    const secondTab = makeXiarengCatalog({
        account,
        now: () => currentTime,
        items: [
            { goods_no: 'XR-NEW-1', goods_name: '新快照商品一', catalogCategoryKeys: ['cat-1'] },
            { goods_no: 'XR-NEW-2', goods_name: '新快照商品二', catalogCategoryKeys: ['cat-1'] }
        ]
    });
    const refreshed = createResponse();
    await secondTab.handler({
        method: 'GET',
        url: '/api/admin/shop/supplier-catalog?providerId=xiareng&accountKey=second&action=list&refresh=1&pageSize=1'
    }, refreshed);
    assert.equal(refreshed.statusCode, 200);
    assert.notEqual(refreshed.json().snapshotId, initial.json().snapshotId);

    const firstTabPageTwo = createResponse();
    await firstTab.handler({
        method: 'GET',
        url: `/api/admin/shop/supplier-catalog?providerId=xiareng&accountKey=second&action=list&snapshotId=${initial.json().snapshotId}&pageNo=2&pageSize=1`
    }, firstTabPageTwo);
    assert.equal(firstTabPageTwo.statusCode, 200);
    assert.equal(firstTabPageTwo.json().items[0].providerGoodsId, 'XR-OLD-2');
    assert.equal(firstTabPageTwo.json().snapshotId, initial.json().snapshotId);
});

test('Xiareng catalog snapshots expire after the cache TTL and cannot cross site scope', async () => {
    let currentTime = 1_000_000;
    const fixture = makeXiarengCatalog({
        items: [{ goods_no: 'XR-1', goods_name: '只读商品', catalogCategoryKeys: ['cat-1'] }],
        now: () => currentTime
    });

    const first = createResponse();
    await fixture.handler({ method: 'GET', url: '/api/admin/shop/supplier-catalog?providerId=xiareng&accountKey=second&action=list&site=cn' }, first);
    assert.equal(first.statusCode, 200);
    const snapshotId = first.json().snapshotId;

    currentTime += 60_001;
    const expired = createResponse();
    await fixture.handler({ method: 'GET', url: `/api/admin/shop/supplier-catalog?providerId=xiareng&accountKey=second&action=list&site=cn&snapshotId=${snapshotId}` }, expired);
    assert.equal(expired.statusCode, 409);
    assert.equal(expired.json().code, 'supplier_catalog_snapshot_expired');

    const fresh = createResponse();
    await fixture.handler({ method: 'GET', url: '/api/admin/shop/supplier-catalog?providerId=xiareng&accountKey=second&action=list&site=cn' }, fresh);
    assert.equal(fresh.statusCode, 200);
    assert.notEqual(fresh.json().snapshotId, snapshotId);

    const otherSite = createResponse();
    await fixture.handler({ method: 'GET', url: '/api/admin/shop/supplier-catalog?providerId=xiareng&accountKey=second&action=list&site=intl' }, otherSite);
    assert.equal(otherSite.statusCode, 200);
    assert.notEqual(otherSite.json().snapshotId, fresh.json().snapshotId);

    const crossSite = createResponse();
    await fixture.handler({ method: 'GET', url: `/api/admin/shop/supplier-catalog?providerId=xiareng&accountKey=second&action=list&site=intl&snapshotId=${fresh.json().snapshotId}` }, crossSite);
    assert.equal(crossSite.statusCode, 409);
    assert.equal(crossSite.json().code, 'supplier_catalog_snapshot_expired');
});

test('Xiareng catalog rejects malformed or unscoped snapshot filters before reading upstream', async () => {
    const { handler, calls } = makeXiarengCatalog({ items: [] });
    const urls = [
        '/api/admin/shop/supplier-catalog?providerId=xiareng&accountKey=second&action=list&categoryKey=cat-1',
        '/api/admin/shop/supplier-catalog?providerId=xiareng&accountKey=second&action=list&snapshotId=00000000-0000-4000-8000-000000000001&categoryKey=bad',
        '/api/admin/shop/supplier-catalog?providerId=xiareng&accountKey=second&action=list&snapshotId=00000000-0000-4000-8000-000000000001&refresh=1'
    ];

    for (const url of urls) {
        const response = createResponse();
        await handler({ method: 'GET', url }, response);
        assert.equal(response.statusCode, 400);
        assert.equal(response.json().code, 'supplier_catalog_filter_invalid');
    }
    assert.equal(calls.supplierCalls.filter(({ method }) => method === 'listAllGoods').length, 0);
});

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

test('preview returns a specific conflict when a supplier refuses draft-card inventory reads', async () => {
    const draftError = Object.assign(new Error('draft-card preview only'), { code: 'supplier_draft_cards_preview_only' });
    const adapter = createAdapter({
        providerId: 'xiareng',
        capabilities: { catalog: true, quote: true, stock: true },
        async getStock() { throw draftError; },
        async quotePrice() { return { amount: '1.00', currency: 'CNY' }; }
    });
    const { handler, state } = makeHandler({ adapter, state: {
        results: [{ data: xrAccount, error: null }]
    } });
    const res = createResponse();

    await handler({ method: 'GET', url: '/api/admin/shop/supplier-catalog?action=preview&providerId=xiareng&goodsNo=XR-1' }, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.json().success, false);
    assert.equal(res.json().code, 'supplier_draft_cards_preview_only');
    assert.match(res.json().message, /开放只读分页预览/);
    assert.deepEqual(state.writes, []);
    assert.deepEqual(state.rpcCalls, []);
});

test('draft-card GET is admin-only, strictly paged, normalized and never writes local data', async () => {
    const adapter = createAdapter({
        providerId: 'xiareng',
        capabilities: { catalog: true },
        async getDraftCards(input) {
            assert.deepEqual(input, { goodsNo: 'XR-1', page: 2, limit: 10 });
            return {
                page: 2, limit: 10, total: 11,
                cards: [{ id: 'card-2', draft: '<img src=x onerror=alert(1)>', draftPremium: 'premium' }],
                importable: false, procurementReady: false,
                secret: 'must-not-return'
            };
        }
    });
    const { handler, calls, state } = makeHandler({ adapter, state: {
        results: [{ data: { id: 'account-xr', provider_id: 'xiareng', account_key: 'default', is_enabled: true }, error: null }]
    } });
    const res = createResponse();
    await handler({ method: 'GET', url: '/api/admin/shop/supplier-catalog?action=draft-cards&providerId=xiareng&goodsNo=XR-1&page=2&limit=10' }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.deepEqual(res.json().cards, [{ id: 'card-2', draft: '<img src=x onerror=alert(1)>', draftPremium: 'premium' }]);
    assert.equal(res.json().importable, false);
    assert.equal(res.json().procurementReady, false);
    assert.equal(JSON.stringify(res.json()).includes('must-not-return'), false);
    assert.deepEqual(calls.supplierCalls, [{ method: 'getDraftCards', input: { goodsNo: 'XR-1', page: 2, limit: 10 } }]);
    assert.deepEqual(state.writes, []);
    assert.deepEqual(state.rpcCalls, []);
    assert.deepEqual(calls.audits, []);
});

test('draft-card request validation fails before account lookup or supplier calls', async () => {
    const { handler, calls, state } = makeHandler();
    const res = createResponse();
    await handler({ method: 'GET', url: '/api/admin/shop/supplier-catalog?action=draft-cards&providerId=xiareng&goodsNo=XR-1&page=1abc&limit=20' }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().code, 'supplier_draft_cards_invalid_request');
    assert.deepEqual(state.queries, []);
    assert.deepEqual(calls.supplierCalls, []);
});

test('Xiareng preselected-card goods are rejected before any import RPC or write', async () => {
    const { handler, state } = makeXiareng({ draft_status: 1 });
    const res = createResponse();
    await handler({
        method: 'POST', url: '/api/admin/shop/supplier-catalog',
        body: { action: 'import', providerId: 'xiareng', site: 'cn', goodsNo: 'XR-1' }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().results[0].status, 'failed');
    assert.equal(res.json().results[0].code, 'supplier_draft_cards_preview_only');
    assert.match(res.json().results[0].message, /开放只读分页预览/);
    assert.deepEqual(state.rpcCalls, []);
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

test('update-mapping-ceiling validates input and updates mapping cost ceiling via RPC', async () => {
    const h = makeHandler({
        state: {
            writes: [],
            rpcCalls: [],
            results: [{
                data: {
                    success: true,
                    mapping_id: 'bea8e791-54b4-41dc-99b6-a0787c4499d7',
                    cost_ceiling_cny: '8.50',
                    policy_ceiling_cny: '8.50'
                },
                error: null
            }]
        }
    });
    const res = createResponse();
    await h.handler({
        method: 'POST',
        headers: {},
        url: '/api/admin/shop/supplier-catalog',
        body: {
            action: 'update-mapping-ceiling',
            mappingId: 'bea8e791-54b4-41dc-99b6-a0787c4499d7',
            costCeilingCny: '8.50'
        }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), {
        success: true,
        mappingId: 'bea8e791-54b4-41dc-99b6-a0787c4499d7',
        costCeilingCny: '8.50',
        result: {
            success: true,
            mapping_id: 'bea8e791-54b4-41dc-99b6-a0787c4499d7',
            cost_ceiling_cny: '8.50',
            policy_ceiling_cny: '8.50'
        }
    });
    assert.equal(h.state.rpcCalls.length, 1);
    assert.equal(h.state.rpcCalls[0].name, 'fn_set_shop_supplier_mapping_cost_ceiling_v2');
    assert.equal(h.state.rpcCalls[0].input.p_mapping_id, 'bea8e791-54b4-41dc-99b6-a0787c4499d7');
    assert.equal(h.state.rpcCalls[0].input.p_cost_ceiling_cny, 8.5);
});

test('Xiareng catalog list returns categoryTree and filters items by groupKey', async () => {
    const { handler } = makeXiarengCatalog({
        categories: [
            { categoryKey: 'cat-1', name: '飞机API 1', upstreamIdCandidate: '6' },
            { categoryKey: 'cat-2', name: '谷歌邮箱自营', upstreamIdCandidate: '87' }
        ],
        items: [
            { goods_no: 'XR-TG-1', goods_name: 'TG商品', catalogCategoryKeys: ['cat-1'] },
            { goods_no: 'XR-GM-1', goods_name: 'GMail商品', catalogCategoryKeys: ['cat-2'] }
        ]
    });

    const initialRes = createResponse();
    await handler({ method: 'GET', url: '/api/admin/shop/supplier-catalog?providerId=xiareng&accountKey=second&action=list' }, initialRes);
    assert.equal(initialRes.statusCode, 200);
    const initialPayload = initialRes.json();
    assert.equal(initialPayload.success, true);
    assert.ok(Array.isArray(initialPayload.categoryTree));
    assert.equal(initialPayload.categoryTree.length, 2);
    const snapshotId = initialPayload.snapshotId;

    // Filter by groupKey 'xr-3' (Telegram)
    const tgRes = createResponse();
    await handler({ method: 'GET', url: `/api/admin/shop/supplier-catalog?providerId=xiareng&accountKey=second&action=list&snapshotId=${snapshotId}&groupKey=xr-3` }, tgRes);
    assert.equal(tgRes.statusCode, 200);
    const tgPayload = tgRes.json();
    assert.equal(tgPayload.items.length, 1);
    assert.equal(tgPayload.items[0].providerGoodsId, 'XR-TG-1');

    // Filter by groupKey 'xr-2' (Gmail)
    const gmRes = createResponse();
    await handler({ method: 'GET', url: `/api/admin/shop/supplier-catalog?providerId=xiareng&accountKey=second&action=list&snapshotId=${snapshotId}&groupKey=xr-2` }, gmRes);
    assert.equal(gmRes.statusCode, 200);
    const gmPayload = gmRes.json();
    assert.equal(gmPayload.items.length, 1);
    assert.equal(gmPayload.items[0].providerGoodsId, 'XR-GM-1');

    // Query with defaultFirstCategory=1
    const defRes = createResponse();
    await handler({ method: 'GET', url: `/api/admin/shop/supplier-catalog?providerId=xiareng&accountKey=second&action=list&snapshotId=${snapshotId}&defaultFirstCategory=1` }, defRes);
    assert.equal(defRes.statusCode, 200);
    const defPayload = defRes.json();
    assert.equal(defPayload.selectedCategoryKey, 'cat-1');
    assert.equal(defPayload.items.length, 1);
    assert.equal(defPayload.items[0].providerGoodsId, 'XR-TG-1');
});

test('Xiareng multi-variant import calls import_shop_supplier_multi_draft_v3 with multiple variants', async () => {
    const { handler, state } = makeXiareng({
        config: { category: { '半年号': '6.44', '一年号': '12.00' } }
    });
    const res = createResponse();
    await handler({
        method: 'POST',
        url: '/api/admin/shop/supplier-catalog',
        body: {
            action: 'import',
            providerId: 'xiareng',
            accountKey: 'second',
            site: 'cn',
            goodsNos: ['XR-1'],
            multiVariants: {
                'XR-1': [
                    { race: '半年号', costCeilingCny: '7.00' },
                    { race: '一年号', costCeilingCny: '13.00' }
                ]
            }
        }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().success, true);
    assert.equal(state.rpcCalls.length, 1);
    assert.equal(state.rpcCalls[0].name, 'import_shop_supplier_multi_draft_v3');
    const input = state.rpcCalls[0].input;
    assert.equal(input.p_account_id, 'xr-account');
    assert.equal(input.p_admin_id, 'admin-1');
    assert.equal(input.p_goods_no, 'XR-1');
    assert.deepEqual(input.p_variants, [
        { race: '半年号', costCeilingCny: '7.00' },
        { race: '一年号', costCeilingCny: '13.00' }
    ]);
});

test('Xiareng draft import preserves cover imageUrl in snapshot and updates product icon', async () => {
    const { handler, state } = makeXiareng({
        cover: 'https://cdn.example.com/tg-icon.png',
        config: { category: { '半年号': '6.44' } }
    });
    const res = createResponse();
    await handler({
        method: 'POST',
        url: '/api/admin/shop/supplier-catalog',
        body: {
            action: 'import',
            providerId: 'xiareng',
            accountKey: 'second',
            site: 'cn',
            goodsNos: ['XR-1'],
            multiVariants: {
                'XR-1': [{ race: '半年号', costCeilingCny: '7.00' }]
            }
        }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().success, true);
    assert.equal(state.rpcCalls.length, 1);
    const input = state.rpcCalls[0].input;
    assert.equal(input.p_snapshot.imageUrl, 'https://cdn.example.com/tg-icon.png');
    // Verify shop_products update
    const productUpdate = state.writes.find((w) => w.table === 'shop_products' && (w.mode === 'update' || w.op === 'update'));
    assert.ok(productUpdate, 'expected shop_products update for icon');
    assert.equal(productUpdate.payload.icon_url, 'https://cdn.example.com/tg-icon.png');
    assert.deepEqual(productUpdate.payload.image_assets, { original: 'https://cdn.example.com/tg-icon.png' });
});

test('Xiareng autoAllVariants automatically discovers races and imports multi-variant draft', async () => {
    const { handler, state } = makeXiareng({
        config: { category: { '半年号': '6.00', '一年号': '12.00' } }
    });
    const res = createResponse();
    await handler({
        method: 'POST',
        url: '/api/admin/shop/supplier-catalog',
        body: {
            action: 'import',
            providerId: 'xiareng',
            accountKey: 'second',
            site: 'cn',
            goodsNos: ['XR-1'],
            autoAllVariants: true,
            markupMultiplier: 1.2,
            costCeilingMultiplier: 1.0,
            productCategory: 'telegram'
        }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().success, true);
    assert.equal(state.rpcCalls.length, 1);
    assert.equal(state.rpcCalls[0].name, 'import_shop_supplier_multi_draft_v3');
    const input = state.rpcCalls[0].input;
    assert.equal(input.p_goods_no, 'XR-1');
    // Check that races were automatically extracted with cost ceiling calculated as 1.0x cost
    assert.equal(input.p_variants.length, 2);
    assert.equal(input.p_variants[0].race, '半年号');
    assert.equal(input.p_variants[0].costCeilingCny, 6.00);
    assert.equal(input.p_variants[1].race, '一年号');
    assert.equal(input.p_variants[1].costCeilingCny, 12.00);
});

test('Xiareng batch import respects category payment channels and initialStatus published', async () => {
    const { handler, state } = makeXiareng({
        config: { category: { '半年号': '10.00' } }
    });
    const res = createResponse();
    await handler({
        method: 'POST',
        url: '/api/admin/shop/supplier-catalog',
        body: {
            action: 'import',
            providerId: 'xiareng',
            accountKey: 'second',
            site: 'cn',
            goodsNos: ['XR-1'],
            autoAllVariants: true,
            markupMultiplier: 1.2,
            categoryPaymentChannels: {
                'XR-1': ['zpay', 'nowpayments']
            },
            markupMultipliers: {
                'XR-1': 1.5
            },
            initialStatus: 'published'
        }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().success, true);

    // Verify product patch contains payment channels and is_active: true
    const productUpdate = state.writes.find((w) => w.table === 'shop_products' && (w.mode === 'update' || w.op === 'update'));
    assert.ok(productUpdate, 'expected shop_products update');
    assert.equal(productUpdate.payload.is_active, true);
    assert.deepEqual(productUpdate.payload.guest_payment_channels, ['zpay', 'nowpayments']);
    assert.equal(productUpdate.payload.allow_guest_purchase, true);

    // Verify supplier mapping was activated
    const mappingUpdate = state.writes.find((w) => w.table === 'shop_supplier_product_mappings' && (w.mode === 'update' || w.op === 'update'));
    assert.ok(mappingUpdate, 'expected shop_supplier_product_mappings update');
    assert.equal(mappingUpdate.payload.is_enabled, true);
});

test('Xiareng category-goods endpoint returns goods grouped by categoryKeys from snapshot', async () => {
    const { handler } = makeXiarengCatalog({ items: [
        { goods_no: 'XR-1', goods_name: '商品A', catalogCategoryKeys: ['cat-1'] },
        { goods_no: 'XR-2', goods_name: '商品B', catalogCategoryKeys: ['cat-1', 'cat-2'] },
        { goods_no: 'XR-3', goods_name: '商品C', catalogCategoryKeys: ['cat-2'] }
    ] });

    // Step 1: list to generate snapshot
    const listRes = createResponse();
    await handler({ method: 'GET', url: '/api/admin/shop/supplier-catalog?providerId=xiareng&accountKey=second&action=list' }, listRes);
    assert.equal(listRes.statusCode, 200);
    const snapshotId = listRes.json().snapshotId;
    assert.ok(snapshotId);

    // Step 2: call category-goods
    const catRes = createResponse();
    await handler({
        method: 'GET',
        url: `/api/admin/shop/supplier-catalog?providerId=xiareng&accountKey=second&action=category-goods&snapshotId=${snapshotId}&categoryKeys=cat-1,cat-2`
    }, catRes);

    assert.equal(catRes.statusCode, 200);
    const catPayload = catRes.json();
    assert.equal(catPayload.success, true);
    assert.ok(catPayload.categories['cat-1']);
    assert.equal(catPayload.categories['cat-1'].items.length, 2);
    assert.equal(catPayload.categories['cat-2'].items.length, 2);
    assert.equal(catPayload.categories['cat-1'].categoryName, '分类甲');
});

test('Xiareng multi-variant import in fallback mode creates active product with channels when initialStatus is published', async () => {
    const { handler, state } = makeXiareng({
        config: { category: { '半年号': '6.00' } }
    }, {
        results: [
            { data: xrAccount, error: null }, // account lookup
            { data: null, error: { message: 'function import_shop_supplier_multi_draft_v3 does not exist', code: '42883' } }, // RPC fails -> enters fallback
            { data: [], error: null }, // existing mappings lookup
            { data: { id: 'prod-fallback-1', name: '只读商品' }, error: null }, // product insert
            { data: { id: 'sku-fallback-1' }, error: null } // default SKU lookup
        ]
    });
    const res = createResponse();
    await handler({
        method: 'POST',
        url: '/api/admin/shop/supplier-catalog',
        body: {
            action: 'import',
            providerId: 'xiareng',
            accountKey: 'second',
            site: 'cn',
            goodsNos: ['XR-1'],
            autoAllVariants: true,
            markupMultiplier: 1.5,
            productCategory: 'linkedin',
            categoryPaymentChannels: {
                'XR-1': ['zpay']
            },
            initialStatus: 'published'
        }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().success, true);

    // Verify product insert had is_active: true and guest_payment_channels: ['zpay']
    const prodInsert = state.writes.find((w) => w.table === 'shop_products' && (w.mode === 'insert' || w.op === 'insert'));
    assert.ok(prodInsert, 'expected shop_products insert');
    assert.equal(prodInsert.payload.is_active, true);
    assert.equal(prodInsert.payload.allow_guest_purchase, true);
    assert.deepEqual(prodInsert.payload.guest_payment_channels, ['zpay']);
    assert.equal(prodInsert.payload.category, 'linkedin');

    // Verify mapping insert had is_enabled: true
    const mappingInsert = state.writes.find((w) => w.table === 'shop_supplier_product_mappings' && (w.mode === 'insert' || w.op === 'insert'));
    assert.ok(mappingInsert, 'expected mapping insert');
    assert.equal(mappingInsert.payload.is_enabled, true);
});

test('Xiareng multi-variant import in fallback mode skips already imported goods when duplicatePolicy is skip', async () => {
    const { handler, state } = makeXiareng({
        config: { category: { '半年号': '6.00' } }
    }, {
        results: [
            { data: xrAccount, error: null }, // account lookup
            { data: null, error: { message: 'function import_shop_supplier_multi_draft_v3 does not exist', code: '42883' } }, // RPC fails -> enters fallback
            { data: [{ id: 'map-existing-1', product_id: 'prod-existing-1' }], error: null } // existing mappings lookup
        ]
    });
    const res = createResponse();
    await handler({
        method: 'POST',
        url: '/api/admin/shop/supplier-catalog',
        body: {
            action: 'import',
            providerId: 'xiareng',
            accountKey: 'second',
            site: 'cn',
            goodsNos: ['XR-1'],
            autoAllVariants: true,
            duplicatePolicy: 'skip'
        }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().success, true);
    assert.equal(res.json().results[0].status, 'skipped');
    assert.equal(res.json().results[0].productId, 'prod-existing-1');

    // Ensure no new product insert was triggered
    const prodInsert = state.writes.find((w) => w.table === 'shop_products' && (w.mode === 'insert' || w.op === 'insert'));
    assert.equal(prodInsert, undefined);
});

test('Xiareng autoAllVariants falls back to single-variant import for goods without races', async () => {
    const { handler, state } = makeXiareng({
        config: {} // No category or races -> single product
    }, {
        results: [
            { data: xrAccount, error: null }, // account lookup
            { data: { status: 'imported_as_draft', productId: 'prod-single-1', mappingId: 'map-1' }, error: null } // single draft RPC
        ]
    });
    const res = createResponse();
    await handler({
        method: 'POST',
        url: '/api/admin/shop/supplier-catalog',
        body: {
            action: 'import',
            providerId: 'xiareng',
            accountKey: 'second',
            site: 'cn',
            goodsNos: ['XR-1'],
            autoAllVariants: true
        }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().success, true);
    assert.equal(state.rpcCalls.length, 1);
    assert.equal(state.rpcCalls[0].name, 'import_shop_supplier_draft_v2');
});

test('Xiareng multi-variant import in fallback mode synchronizes stock_count from upstream availableQuantity', async () => {
    const { handler, state } = makeXiareng({
        stock: 98,
        config: { category: { '半年号': '6.00' } }
    }, {
        results: [
            { data: xrAccount, error: null }, // account lookup
            { data: null, error: { message: 'function import_shop_supplier_multi_draft_v3 does not exist', code: '42883' } }, // RPC fails
            { data: [], error: null }, // no existing mappings
            { data: { id: 'prod-fallback-stock', name: '只读商品' }, error: null }, // product insert
            { data: { id: 'sku-fallback-stock' }, error: null } // default SKU lookup
        ]
    });
    const res = createResponse();
    await handler({
        method: 'POST',
        url: '/api/admin/shop/supplier-catalog',
        body: {
            action: 'import',
            providerId: 'xiareng',
            accountKey: 'second',
            site: 'cn',
            goodsNos: ['XR-1'],
            autoAllVariants: true
        }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().success, true);

    const prodInsert = state.writes.find((w) => w.table === 'shop_products' && (w.mode === 'insert' || w.op === 'insert'));
    assert.ok(prodInsert, 'expected shop_products insert');
    assert.equal(prodInsert.payload.stock_count, 98);

    const skuUpdate = state.writes.find((w) => w.table === 'shop_product_skus' && (w.mode === 'update' || w.op === 'update'));
    assert.ok(skuUpdate, 'expected shop_product_skus update');
    assert.equal(skuUpdate.payload.stock_count, 98);
});

test('Xiareng supplier import automatically detects manual delivery goods and sets manual_delivery: true', async () => {
    const { handler, state } = makeXiareng({
        delivery_way: 1,
        name: '韩国Kakao/成品/接码',
        description: '下单后联系客服上号，提供设备协助完成登录',
        config: { category: { '首发成品': '35.00' } }
    }, {
        results: [
            { data: xrAccount, error: null }, // account lookup
            { data: null, error: { message: 'function import_shop_supplier_multi_draft_v3 does not exist', code: '42883' } }, // RPC fallback
            { data: [], error: null }, // no existing mappings
            { data: { id: 'prod-kakao', name: '韩国Kakao/成品/接码' }, error: null }, // product insert
            { data: { id: 'sku-kakao' }, error: null } // default SKU lookup
        ]
    });
    const res = createResponse();
    await handler({
        method: 'POST',
        url: '/api/admin/shop/supplier-catalog',
        body: {
            action: 'import',
            providerId: 'xiareng',
            accountKey: 'second',
            site: 'cn',
            goodsNos: ['XR-1'],
            autoAllVariants: true
        }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().success, true);

    const prodInsert = state.writes.find((w) => w.table === 'shop_products' && (w.mode === 'insert' || w.op === 'insert'));
    assert.ok(prodInsert, 'expected shop_products insert');
    assert.equal(prodInsert.payload.manual_delivery, true);
    assert.equal(prodInsert.payload.show_usage_instructions, true);

    const skuUpdate = state.writes.find((w) => w.table === 'shop_product_skus' && (w.mode === 'update' || w.op === 'update'));
    assert.ok(skuUpdate, 'expected shop_product_skus update');
    assert.equal(skuUpdate.payload.manual_delivery, true);
});

test('Xiareng supplier import extracts purchase notes to 注意事项 and sets show_purchase_notes: true', async () => {
    const { handler, state } = makeXiareng({
        code: 'XR-1',
        name: '海外领英LinkedIn-英国IP注册2个月',
        description: '<p>账号格式：登录邮箱----登录密码</p><p>注意事项：登录2小时内不要改任何信息！</p>',
        user_price: '18.20',
        config: { category: { '英国IP': '18.20' } }
    }, {
        results: [
            { data: xrAccount, error: null },
            { data: null, error: { message: 'function import_shop_supplier_multi_draft_v3 does not exist', code: '42883' } },
            { data: [], error: null },
            { data: { id: 'prod-linkedin', name: '海外领英LinkedIn-英国IP注册2个月' }, error: null },
            { data: { id: 'sku-linkedin' }, error: null }
        ]
    });
    const res = createResponse();
    await handler({
        method: 'POST',
        url: '/api/admin/shop/supplier-catalog',
        body: {
            action: 'import',
            providerId: 'xiareng',
            accountKey: 'second',
            site: 'cn',
            goodsNos: ['XR-1'],
            autoAllVariants: true
        }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().success, true);

    const prodInsert = state.writes.find((w) => w.table === 'shop_products' && (w.mode === 'insert' || w.op === 'insert'));
    assert.ok(prodInsert, 'expected shop_products insert');
    assert.equal(prodInsert.payload.show_purchase_notes, true);
    assert.match(prodInsert.payload.purchase_notes, /【特别注意事项】/);
    assert.match(prodInsert.payload.purchase_notes, /登录2小时内不要改任何信息/);
    assert.match(prodInsert.payload.purchase_notes, /【购买须知】/);
    assert.match(prodInsert.payload.purchase_notes, /购买前请确认商品规格、数量和完整说明，价格及库存以本页实时显示为准。/);
    assert.match(prodInsert.payload.purchase_notes, /付款后，可在订单查询或会员购买记录中查看交付内容。/);
    assert.match(prodInsert.payload.purchase_notes, /售后时长和适用条件以商品详情中的说明为准。/);
    assert.match(prodInsert.payload.purchase_notes, /需要售后时，请通过对应订单提交工单，以便核对购买信息。/);
    assert.equal(prodInsert.payload.purchase_notes_zh, prodInsert.payload.purchase_notes);
});

test('Xiareng supplier import without specific notes still includes exact upstream 购买须知', async () => {
    const { handler, state } = makeXiareng({
        code: 'XR-1',
        name: '海外领英LinkedIn-英国IP注册3个月',
        description: '<p>账号格式：登录邮箱----登录密码</p>',
        user_price: '23.40',
        config: { category: { '英国IP注册3个月': '23.40' } }
    }, {
        results: [
            { data: xrAccount, error: null },
            { data: null, error: { message: 'function import_shop_supplier_multi_draft_v3 does not exist', code: '42883' } },
            { data: [], error: null },
            { data: { id: 'prod-linkedin-3m', name: '海外领英LinkedIn-英国IP注册3个月' }, error: null },
            { data: { id: 'sku-linkedin-3m' }, error: null }
        ]
    });
    const res = createResponse();
    await handler({
        method: 'POST',
        url: '/api/admin/shop/supplier-catalog',
        body: {
            action: 'import',
            providerId: 'xiareng',
            accountKey: 'second',
            site: 'cn',
            goodsNos: ['XR-1'],
            autoAllVariants: true
        }
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().success, true);

    const prodInsert = state.writes.find((w) => w.table === 'shop_products' && (w.mode === 'insert' || w.op === 'insert'));
    assert.ok(prodInsert, 'expected shop_products insert');
    assert.equal(prodInsert.payload.show_purchase_notes, true);
    assert.doesNotMatch(prodInsert.payload.purchase_notes, /【特别注意事项】/);
    assert.match(prodInsert.payload.purchase_notes, /【购买须知】/);
    assert.match(prodInsert.payload.purchase_notes, /购买前请确认商品规格、数量和完整说明，价格及库存以本页实时显示为准。/);
    assert.match(prodInsert.payload.purchase_notes, /付款后，可在订单查询或会员购买记录中查看交付内容。/);
    assert.match(prodInsert.payload.purchase_notes, /售后时长和适用条件以商品详情中的说明为准。/);
    assert.match(prodInsert.payload.purchase_notes, /需要售后时，请通过对应订单提交工单，以便核对购买信息。/);
});

test('Xiareng supplier import gracefully falls back when min_purchase_quantity column is missing in database', async () => {
    const { handler, state } = makeXiareng({
        code: 'XR-MIN-QTY',
        name: '全新长效Hotmail邮箱',
        user_price: '0.13',
        stock: 200,
        minimum: 5,
        img: 'https://cdn.fatherkey.com/cover.webp',
        content: '<p>使用说明</p>'
    }, {
        results: [
            { data: xrAccount, error: null },
            {
                data: {
                    status: 'imported_as_draft',
                    productId: 'prod-fallback-min-qty',
                    skuId: 'sku-fallback-min-qty',
                    mappingId: 'map-fallback-min-qty'
                },
                error: null
            },
            // First shop_products.update fails because min_purchase_quantity column does not exist
            {
                data: null,
                error: { code: 'PGRST204', message: "Could not find the 'min_purchase_quantity' column of 'shop_products' in the schema cache" }
            },
            // Second shop_products.update succeeds
            { data: { id: 'prod-fallback-min-qty' }, error: null },
            // Sku update
            { data: { id: 'sku-fallback-min-qty' }, error: null },
            // Mapping update
            { data: { id: 'map-fallback-min-qty' }, error: null }
        ]
    });

    const res = createResponse();
    await handler({
        method: 'POST',
        url: '/api/admin/shop/supplier-catalog',
        body: {
            action: 'import',
            providerId: 'xiareng',
            accountKey: 'second',
            site: 'cn',
            goodsNos: ['XR-MIN-QTY'],
            productCategories: { 'XR-MIN-QTY': '微软邮箱' },
            initialStatus: 'published'
        }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.json().success, true);

    const prodUpdates = state.writes.filter((w) => w.table === 'shop_products' && (w.mode === 'update' || w.op === 'update'));
    assert.equal(prodUpdates.length, 2, 'should have attempted update twice (initial with minQty, then fallback)');
    assert.equal(prodUpdates[0].payload.min_purchase_quantity, 5);
    assert.equal('min_purchase_quantity' in prodUpdates[1].payload, false, 'fallback payload should not have min_purchase_quantity');
    assert.equal(prodUpdates[1].payload.category, '微软邮箱');
    assert.equal(prodUpdates[1].payload.is_active, true);
});
