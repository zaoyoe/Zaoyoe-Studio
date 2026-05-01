const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

function createMockResponse() {
    const state = {
        statusCode: 200,
        headers: {},
        body: ''
    };

    return {
        status(code) {
            state.statusCode = Number(code) || 200;
            return this;
        },
        setHeader(name, value) {
            state.headers[String(name).toLowerCase()] = value;
            return this;
        },
        end(payload = '') {
            state.body = String(payload || '');
            return this;
        },
        json() {
            return state.body ? JSON.parse(state.body) : {};
        },
        get statusCode() {
            return state.statusCode;
        }
    };
}

function createQueryBuilder(state, table, rows = [], options = {}) {
    const queryState = {
        table,
        rows: Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [],
        orderBy: '',
        ascending: false,
        from: 0,
        to: 499,
        eqFilters: [],
        inFilters: [],
        gteFilters: [],
        lteFilters: [],
        shouldFail: options.shouldFail === true
    };

    const builder = {
        select() {
            return builder;
        },
        order(column, config = {}) {
            queryState.orderBy = String(column || '');
            queryState.ascending = config?.ascending === true;
            return builder;
        },
        range(from, to) {
            queryState.from = Number(from) || 0;
            queryState.to = Number(to) || 0;
            return builder;
        },
        eq(column, value) {
            queryState.eqFilters.push([String(column || ''), value]);
            return builder;
        },
        in(column, values) {
            queryState.inFilters.push([String(column || ''), Array.isArray(values) ? [...values] : []]);
            return builder;
        },
        gte(column, value) {
            queryState.gteFilters.push([String(column || ''), String(value || '')]);
            return builder;
        },
        lte(column, value) {
            queryState.lteFilters.push([String(column || ''), String(value || '')]);
            return builder;
        },
        then(resolve, reject) {
            state.calls.push({
                table,
                eqFilters: queryState.eqFilters.map((item) => [...item]),
                inFilters: queryState.inFilters.map(([column, values]) => [column, [...values]]),
                gteFilters: queryState.gteFilters.map((item) => [...item]),
                lteFilters: queryState.lteFilters.map((item) => [...item]),
                orderBy: queryState.orderBy,
                ascending: queryState.ascending,
                range: [queryState.from, queryState.to]
            });

            if (queryState.shouldFail) {
                return Promise.resolve({
                    data: null,
                    error: { message: `Failed to load ${table}` }
                }).then(resolve, reject);
            }

            let filteredRows = [...queryState.rows];

            for (const [column, value] of queryState.eqFilters) {
                filteredRows = filteredRows.filter((row) => String(row?.[column] || '') === String(value || ''));
            }

            for (const [column, values] of queryState.inFilters) {
                const valueSet = new Set((Array.isArray(values) ? values : []).map((value) => String(value || '')));
                filteredRows = filteredRows.filter((row) => valueSet.has(String(row?.[column] || '')));
            }

            for (const [column, value] of queryState.gteFilters) {
                filteredRows = filteredRows.filter((row) => String(row?.[column] || '') >= value);
            }

            for (const [column, value] of queryState.lteFilters) {
                filteredRows = filteredRows.filter((row) => String(row?.[column] || '') <= value);
            }

            if (queryState.orderBy) {
                filteredRows.sort((left, right) => {
                    const leftValue = String(left?.[queryState.orderBy] || '');
                    const rightValue = String(right?.[queryState.orderBy] || '');
                    return queryState.ascending
                        ? leftValue.localeCompare(rightValue)
                        : rightValue.localeCompare(leftValue);
                });
            }

            const slicedRows = filteredRows.slice(queryState.from, queryState.to + 1);
            return Promise.resolve({
                data: slicedRows,
                error: null
            }).then(resolve, reject);
        }
    };

    return builder;
}

async function withHandler(handlerFile, options = {}, callback) {
    const handlerPath = path.resolve(__dirname, `../server/api-handlers/admin/analytics/${handlerFile}`);
    const builderPath = path.resolve(__dirname, '../server/api-handlers/admin/analytics/_product-analytics-builders.js');
    const summaryRowsPath = path.resolve(__dirname, '../server/api-handlers/admin/analytics/summary-rows-bundle.js');
    const originalLoad = Module._load;
    const state = {
        calls: [],
        requireAdminCalls: []
    };
    const tables = options.tables || {};

    delete require.cache[handlerPath];
    delete require.cache[builderPath];
    delete require.cache[summaryRowsPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                normalizeAdminSite(value, config = {}) {
                    const normalized = String(value || '').trim().toLowerCase();
                    if (['cn', 'intl', 'all'].includes(normalized)) {
                        return normalized;
                    }
                    return String(config?.defaultValue || '').trim().toLowerCase() || '';
                },
                async requireAdmin(req, config = {}) {
                    state.requireAdminCalls.push({ req, config });
                    return {
                        supabase: {
                            from(table) {
                                const tableState = tables[table] || {};
                                return createQueryBuilder(state, table, tableState.rows || [], tableState);
                            }
                        }
                    };
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                }
            };
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    let handler;
    try {
        handler = require(handlerPath);
    } finally {
        Module._load = originalLoad;
    }

    try {
        return await callback({ handler, state });
    } finally {
        delete require.cache[handlerPath];
        delete require.cache[builderPath];
        delete require.cache[summaryRowsPath];
    }
}

const PRODUCT_TEST_TABLES = {
    shop_products: {
        rows: [
            { id: 'product-1', name: 'Season Pass', category: 'membership', is_active: true, stock_count: 2, delivery_type: 'KEY', price_points: 200, price_points_intl: 30, updated_at: '2026-04-05T10:00:00.000Z' },
            { id: 'product-2', name: 'Mood Pack', category: 'bundle', is_active: true, stock_count: 0, delivery_type: 'KEY', price_points: 80, price_points_intl: 12, updated_at: '2026-04-05T09:00:00.000Z' },
            { id: 'product-3', name: 'Archive Box', category: 'collectible', is_active: true, stock_count: 10, delivery_type: 'KEY', price_points: 50, price_points_intl: 8, updated_at: '2026-04-05T08:00:00.000Z' }
        ]
    },
    shop_orders: {
        rows: [
            { id: 'order-1', user_id: 'user-1', product_id: 'product-1', site: 'cn', item_count: 2, total_price: 200, price_paid: 100, snapshot_product_name: 'Season Pass', refund_status: '', delivery_status: 'delivered', created_at: '2026-04-04T08:00:00.000Z' },
            { id: 'order-2', user_id: 'user-2', product_id: 'product-2', site: 'intl', item_count: 1, total_price: 80, price_paid: 80, snapshot_product_name: 'Mood Pack', refund_status: '', delivery_status: 'processing', created_at: '2026-04-05T08:00:00.000Z' },
            { id: 'order-3', user_id: 'user-3', product_id: 'product-2', site: 'cn', item_count: 1, total_price: 80, price_paid: 80, snapshot_product_name: 'Mood Pack', refund_status: 'refunded', delivery_status: 'delivered', created_at: '2026-04-05T10:00:00.000Z' }
        ]
    },
    shop_inventory: {
        rows: [
            { id: 'inventory-1', product_id: 'product-1', status: 'available', buyer_id: null, sold_at: null, created_at: '2026-04-01T00:00:00.000Z', order_id: null },
            { id: 'inventory-2', product_id: 'product-1', status: 'sold', buyer_id: 'user-1', sold_at: '2026-04-04T08:00:00.000Z', created_at: '2026-04-02T00:00:00.000Z', order_id: 'order-1' },
            { id: 'inventory-3', product_id: 'product-2', status: 'sold', buyer_id: 'user-2', sold_at: '2026-04-05T08:00:00.000Z', created_at: '2026-04-03T00:00:00.000Z', order_id: 'order-2' },
            { id: 'inventory-4', product_id: 'product-3', status: 'available', buyer_id: null, sold_at: null, created_at: '2026-04-03T00:00:00.000Z', order_id: null }
        ]
    },
    user_events: {
        rows: [
            { id: 'event-1', user_id: 'user-1', site: 'cn', event_name: 'shop_view', event_type: 'commerce', event_data: { metadata: { product_id: 'product-1', source_page: 'home', source_channel: 'homepage' } }, created_at: '2026-04-04T07:00:00.000Z', page_url: 'https://zaoyoe.local/shop.html', referrer: 'https://zaoyoe.local/' },
            { id: 'event-2', user_id: 'user-4', site: 'cn', event_name: 'shop_view', event_type: 'commerce', event_data: { metadata: { product_id: 'product-1', source_page: 'home', source_channel: 'homepage' } }, created_at: '2026-04-04T07:05:00.000Z', page_url: 'https://zaoyoe.local/shop.html', referrer: 'https://zaoyoe.local/' },
            { id: 'event-3', user_id: 'user-2', site: 'intl', event_name: 'product_card_click', event_type: 'commerce', event_data: { metadata: { product_id: 'product-2', source_page: 'prompts', source_channel: 'prompt_content', source_prompt_id: 'prompt-9002' } }, created_at: '2026-04-05T06:55:00.000Z', page_url: 'https://zaoyoe.local/shop.html', referrer: 'https://zaoyoe.local/prompts.html?id=prompt-9002' },
            { id: 'event-4', user_id: 'user-2', site: 'intl', event_name: 'product_detail_view', event_type: 'commerce', event_data: { metadata: { product_id: 'product-2', source_page: 'prompts', source_channel: 'prompt_content', source_prompt_id: 'prompt-9002' } }, created_at: '2026-04-05T06:58:00.000Z', page_url: 'https://zaoyoe.local/shop.html', referrer: 'https://zaoyoe.local/prompts.html?id=prompt-9002' },
            { id: 'event-5', user_id: 'user-2', site: 'intl', event_name: 'shop_view', event_type: 'commerce', event_data: { metadata: { product_id: 'product-2', source_page: 'prompts', source_channel: 'prompt_content', source_prompt_id: 'prompt-9002' } }, created_at: '2026-04-05T07:00:00.000Z', page_url: 'https://zaoyoe.local/shop.html', referrer: 'https://zaoyoe.local/prompts.html?id=prompt-9002' },
            { id: 'event-6', user_id: 'user-2', site: 'intl', event_name: 'product_purchase_click', event_type: 'commerce', event_data: { metadata: { product_id: 'product-2', source_page: 'prompts', source_channel: 'prompt_content', source_prompt_id: 'prompt-9002' } }, created_at: '2026-04-05T08:00:00.000Z', page_url: 'https://zaoyoe.local/shop.html', referrer: 'https://zaoyoe.local/prompts.html?id=prompt-9002' },
            { id: 'event-7', user_id: 'user-2', site: 'intl', event_name: 'shop_purchase', event_type: 'commerce', event_data: { metadata: { product_id: 'product-2', order_id: 'order-2', source_page: 'prompts', source_channel: 'prompt_content', source_prompt_id: 'prompt-9002' } }, created_at: '2026-04-05T08:05:00.000Z', page_url: 'https://zaoyoe.local/shop.html', referrer: 'https://zaoyoe.local/prompts.html?id=prompt-9002' },
            { id: 'event-8', user_id: 'user-2', site: 'intl', event_name: 'product_purchase_success', event_type: 'commerce', event_data: { metadata: { product_id: 'product-2', order_id: 'order-2', source_page: 'prompts', source_channel: 'prompt_content', source_prompt_id: 'prompt-9002' } }, created_at: '2026-04-05T08:06:00.000Z', page_url: 'https://zaoyoe.local/shop.html', referrer: 'https://zaoyoe.local/prompts.html?id=prompt-9002' },
            { id: 'event-9', user_id: 'user-5', site: 'cn', event_name: 'shop_view', event_type: 'commerce', event_data: { metadata: { product_id: 'product-3', source_page: 'shop', source_channel: 'shop_storefront' } }, created_at: '2026-04-05T09:00:00.000Z', page_url: 'https://zaoyoe.local/shop.html', referrer: 'https://zaoyoe.local/shop.html' },
            { id: 'event-10', user_id: 'user-6', site: 'cn', event_name: 'shop_view', event_type: 'commerce', event_data: { metadata: { product_id: 'product-3', source_page: 'shop', source_channel: 'shop_storefront' } }, created_at: '2026-04-05T09:05:00.000Z', page_url: 'https://zaoyoe.local/shop.html', referrer: 'https://zaoyoe.local/shop.html' },
            { id: 'event-11', user_id: 'user-7', site: 'cn', event_name: 'shop_view', event_type: 'commerce', event_data: { metadata: { product_id: 'product-3', source_page: 'shop', source_channel: 'shop_storefront' } }, created_at: '2026-04-05T09:10:00.000Z', page_url: 'https://zaoyoe.local/shop.html', referrer: 'https://zaoyoe.local/shop.html' },
            { id: 'event-12', user_id: 'user-8', site: 'cn', event_name: 'shop_view', event_type: 'commerce', event_data: { metadata: { product_id: 'product-3', source_page: 'shop', source_channel: 'shop_storefront' } }, created_at: '2026-04-05T09:15:00.000Z', page_url: 'https://zaoyoe.local/shop.html', referrer: 'https://zaoyoe.local/shop.html' }
        ]
    }
};

const EXPECTED_PRODUCT_EVENT_NAMES = [
    'shop_view',
    'product_card_click',
    'product_detail_view',
    'product_purchase_click',
    'shop_purchase',
    'product_purchase_success'
];

test('product summary bundle returns summary, trend, site comparison, category breakdown, and operating matrix payloads', async () => {
    await withHandler('product-summary-bundle.js', {
        tables: PRODUCT_TEST_TABLES
    }, async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({
            method: 'GET',
            url: '/api/admin?route=analytics/product-summary-bundle&site=all&startDate=2026-04-04T00:00:00.000Z&endDate=2026-04-05T23:59:59.999Z',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.partial_failure_count, 0);
        assert.deepEqual(state.requireAdminCalls[0]?.config, { permission: 'analytics.view' });
        const userEventsCall = state.calls.find((call) => call.table === 'user_events');
        assert.deepEqual(userEventsCall?.inFilters, [['event_name', EXPECTED_PRODUCT_EVENT_NAMES]]);

        assert.equal(payload.segments.summary.ok, true);
        assert.equal(payload.segments.summary.payload.active_product_count, 3);
        assert.equal(payload.segments.summary.payload.order_count, 2);
        assert.equal(payload.segments.summary.payload.refunded_order_count, 1);
        assert.equal(payload.segments.summary.payload.units_sold, 3);
        assert.equal(payload.segments.summary.payload.gmv_points, 280);
        assert.equal(payload.segments.summary.payload.view_user_count, 7);
        assert.equal(payload.segments.summary.payload.card_click_user_count, 1);
        assert.equal(payload.segments.summary.payload.detail_view_user_count, 1);
        assert.equal(payload.segments.summary.payload.purchase_click_user_count, 1);
        assert.equal(Array.isArray(payload.segments.summary.payload.user_signal_samples.shop_view), true);
        assert.equal(payload.segments.summary.payload.user_signal_samples.shop_view.length > 0, true);
        assert.equal(typeof payload.segments.summary.payload.user_signal_samples.shop_view[0].user_id, 'string');
        assert.equal(typeof payload.segments.summary.payload.user_signal_samples.shop_view[0].event_count, 'number');
        assert.equal(Array.isArray(payload.segments.summary.payload.user_signal_samples.buyer), true);
        assert.equal(payload.segments.summary.payload.user_signal_samples.buyer[0].user_id, 'user-1');
        assert.equal(payload.segments.summary.payload.user_signal_samples.buyer[0].order_count, 1);
        assert.equal(Array.isArray(payload.segments.summary.payload.buyer_snapshot), true);
        assert.equal(payload.segments.summary.payload.buyer_snapshot[0].user_id, 'user-1');
        assert.equal(Array.isArray(payload.segments.summary.payload.buyer_segment_summary), true);
        assert.equal(payload.segments.summary.payload.buyer_segment_summary[0].label, '首单成交');
        assert.equal(payload.segments.summary.payload.buyer_segment_summary[0].count, 2);
        assert.equal(Array.isArray(payload.segments.summary.payload.buyer_segment_summary[0].sample_users), true);
        assert.equal(payload.segments.summary.payload.buyer_segment_summary[0].sample_users[0].user_id, 'user-1');
        assert.equal(Array.isArray(payload.segments.summary.payload.first_purchase_destinations), true);
        assert.equal(payload.segments.summary.payload.first_purchase_destinations[0].product_id, 'product-1');
        assert.equal(payload.segments.summary.payload.first_purchase_destinations[0].user_count, 1);
        assert.equal(Array.isArray(payload.segments.summary.payload.post_purchase_destinations), true);
        assert.equal(payload.segments.summary.payload.post_purchase_destinations.length, 0);

        assert.equal(payload.segments.trend.ok, true);
        assert.equal(Array.isArray(payload.segments.trend.payload), true);
        assert.equal(payload.segments.trend.payload.length, 2);
        assert.equal(payload.segments.siteComparison.ok, true);
        assert.equal(payload.segments.siteComparison.payload.snapshots.length, 2);
        assert.equal(payload.segments.categoryBreakdown.ok, true);
        assert.equal(Array.isArray(payload.segments.categoryBreakdown.payload.rows), true);
        assert.equal(payload.segments.categoryBreakdown.payload.rows[0].category, 'membership');
        assert.equal(payload.segments.categoryBreakdown.payload.rows[0].gmv_points, 200);
        assert.equal(payload.segments.productMatrix.ok, true);
        assert.equal(Array.isArray(payload.segments.productMatrix.payload.items), true);
        assert.equal(payload.segments.productMatrix.payload.items.length > 0, true);
        assert.equal(payload.segments.productMatrix.payload.items[0].product_id, 'product-1');
    });
});

test('product dashboard bundle returns shared summary, rank, and health payloads for product panels', async () => {
    await withHandler('product-dashboard-bundle.js', {
        tables: PRODUCT_TEST_TABLES
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({
            method: 'GET',
            url: '/api/admin?route=analytics/product-dashboard-bundle&site=all&limit=2&startDate=2026-04-04T00:00:00.000Z&endDate=2026-04-05T23:59:59.999Z',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.limit, 2);
        assert.equal(payload.partial_failure_count, 0);

        assert.equal(payload.segments.summary.ok, true);
        assert.equal(payload.segments.summary.payload.order_count, 2);
        assert.equal(payload.segments.productMatrix.ok, true);
        assert.equal(Array.isArray(payload.segments.productMatrix.payload.items), true);
        assert.equal(payload.segments.productMatrix.payload.items.length > 0, true);

        assert.equal(payload.segments.gmvTop.ok, true);
        assert.equal(payload.segments.gmvTop.payload[0].product_id, 'product-1');
        assert.equal(payload.segments.highExposureLowConversion.ok, true);
        assert.equal(payload.segments.highExposureLowConversion.payload[0].product_id, 'product-3');

        assert.equal(payload.segments.lowStockProducts.ok, true);
        assert.equal(payload.segments.lowStockProducts.payload[0].product_id, 'product-1');
        assert.equal(payload.segments.deliveryRiskProducts.ok, true);
        assert.equal(payload.segments.deliveryRiskProducts.payload[0].product_id, 'product-2');
        assert.equal(payload.segments.funnelSummary.ok, true);
        assert.equal(payload.segments.funnelSummary.payload.stages[0].value, 7);
        assert.equal(payload.segments.funnelSiteComparison.ok, true);
        assert.equal(payload.segments.funnelSiteComparison.payload.snapshots.length, 2);
        assert.equal(payload.segments.funnelProductRows.ok, true);
        assert.equal(payload.segments.funnelProductRows.payload[0].product_id, 'product-3');
    });
});

test('product rank bundle returns core, risk, and content-driven product rankings', async () => {
    await withHandler('product-rank-bundle.js', {
        tables: PRODUCT_TEST_TABLES
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({
            method: 'GET',
            url: '/api/admin?route=analytics/product-rank-bundle&site=all&limit=2&startDate=2026-04-04T00:00:00.000Z&endDate=2026-04-05T23:59:59.999Z',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.limit, 2);
        assert.equal(payload.segments.salesTop.ok, true);
        assert.equal(payload.segments.salesTop.payload[0].product_id, 'product-1');
        assert.equal(payload.segments.gmvTop.payload[0].product_id, 'product-1');
        assert.equal(payload.segments.conversionTop.payload[0].product_id, 'product-2');
        assert.equal(payload.segments.refundRateTop.payload[0].product_id, 'product-2');
        assert.equal(payload.segments.refundRateTop.payload[0].refund_rate, 50);
        assert.equal(payload.segments.deliveryRiskRateTop.payload[0].product_id, 'product-2');
        assert.equal(payload.segments.deliveryRiskRateTop.payload[0].delivery_risk_rate, 100);
        assert.equal(payload.segments.contentDrivenTop.payload[0].product_id, 'product-2');
        assert.equal(payload.segments.contentDrivenTop.payload[0].content_assisted_gmv_points, 80);
        assert.equal(payload.segments.contentDrivenTop.payload[0].top_prompt_id, 'prompt-9002');
        assert.equal(Array.isArray(payload.segments.contentDrivenTop.payload[0].prompt_sources[0].purchase_success_user_samples), true);
        assert.equal(payload.segments.contentDrivenTop.payload[0].prompt_sources[0].purchase_success_user_samples[0], 'user-2');
        assert.equal(Array.isArray(payload.segments.contentDrivenTop.payload[0].prompt_sources[0].order_samples), true);
        assert.equal(payload.segments.contentDrivenTop.payload[0].prompt_sources[0].order_samples[0].order_id, 'order-2');
        assert.equal(payload.segments.highExposureLowConversion.payload[0].product_id, 'product-3');
    });
});

test('product health bundle returns stock, delivery, refund, and turnover health segments', async () => {
    await withHandler('product-health-bundle.js', {
        tables: PRODUCT_TEST_TABLES
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({
            method: 'GET',
            url: '/api/admin?route=analytics/product-health-bundle&site=all&limit=3&startDate=2026-04-04T00:00:00.000Z&endDate=2026-04-05T23:59:59.999Z',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.limit, 3);
        assert.equal(payload.segments.lowStockProducts.payload[0].product_id, 'product-1');
        assert.equal(payload.segments.soldOutProducts.payload[0].product_id, 'product-2');
        assert.equal(payload.segments.deliveryRiskProducts.payload[0].product_id, 'product-2');
        assert.equal(payload.segments.refundRiskProducts.payload[0].product_id, 'product-2');
        assert.equal(Array.isArray(payload.segments.inventoryTurnoverHints.payload), true);
        assert.equal(payload.segments.inventoryTurnoverHints.payload.length > 0, true);
    });
});

test('product funnel bundle returns summary, site comparison, and product comparison rows', async () => {
    await withHandler('product-funnel-bundle.js', {
        tables: PRODUCT_TEST_TABLES
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({
            method: 'GET',
            url: '/api/admin?route=analytics/product-funnel-bundle&site=all&limit=3&startDate=2026-04-04T00:00:00.000Z&endDate=2026-04-05T23:59:59.999Z',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.limit, 3);
        assert.equal(payload.segments.summary.ok, true);
        assert.equal(payload.segments.summary.payload.stages[0].value, 7);
        assert.equal(payload.segments.summary.payload.stages[1].value, 2);
        assert.equal(payload.segments.summary.payload.stages[2].value, 2);
        assert.equal(payload.segments.summary.payload.stages[3].value, 1);
        assert.equal(payload.segments.summary.payload.stages[4].value, 1);
        assert.equal(payload.segments.summary.payload.card_click_user_count, 1);
        assert.equal(payload.segments.summary.payload.detail_to_intent_rate, 28.57);
        assert.equal(payload.segments.summary.payload.intent_to_paid_rate, 100);
        assert.equal(payload.segments.siteComparison.ok, true);
        assert.equal(payload.segments.siteComparison.payload.snapshots.length, 2);
        assert.equal(payload.segments.productRows.ok, true);
        assert.equal(payload.segments.productRows.payload[0].product_id, 'product-3');
        assert.equal(payload.segments.productRows.payload[1].product_id, 'product-1');
    });
});

test('product detail bundle returns summary, trend, funnel, and recent orders for a selected product', async () => {
    const detailTables = {
        ...PRODUCT_TEST_TABLES,
        shop_orders: {
            ...PRODUCT_TEST_TABLES.shop_orders,
            rows: [
                ...PRODUCT_TEST_TABLES.shop_orders.rows.map((row) => ({ ...row })),
                { id: 'order-4', user_id: 'user-2', product_id: 'product-3', site: 'intl', item_count: 1, total_price: 50, price_paid: 50, snapshot_product_name: 'Archive Box', refund_status: '', delivery_status: 'delivered', created_at: '2026-04-05T09:00:00.000Z' }
            ]
        }
    };

    await withHandler('product-detail-bundle.js', {
        tables: detailTables
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({
            method: 'GET',
            url: '/api/admin?route=analytics/product-detail-bundle&site=all&productId=product-2&recentOrderLimit=2&startDate=2026-04-04T00:00:00.000Z&endDate=2026-04-05T23:59:59.999Z',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.product_id, 'product-2');
        assert.equal(payload.segments.summary.ok, true);
        assert.equal(payload.segments.summary.payload.product_name, 'Mood Pack');
        assert.equal(payload.segments.summary.payload.order_count, 1);
        assert.equal(payload.segments.summary.payload.refunded_order_count, 1);
        assert.equal(payload.segments.summary.payload.delivery_risk_count, 1);
        assert.equal(payload.segments.summary.payload.site_snapshots.length, 2);
        assert.equal(payload.segments.summary.payload.buyer_snapshot.length, 1);
        assert.equal(payload.segments.summary.payload.card_click_count, 1);
        assert.equal(payload.segments.summary.payload.detail_view_count, 1);
        assert.equal(payload.segments.summary.payload.purchase_click_count, 1);
        assert.equal(payload.segments.summary.payload.event_purchase_count, 1);
        assert.equal(payload.segments.summary.payload.source_pages[0].key, 'prompts');
        assert.equal(payload.segments.summary.payload.source_channels[0].key, 'prompt_content');
        assert.equal(payload.segments.summary.payload.prompt_sources[0].prompt_id, 'prompt-9002');
        assert.equal(payload.segments.summary.payload.prompt_sources[0].detail_view_count, 1);
        assert.equal(payload.segments.summary.payload.prompt_sources[0].purchase_click_count, 1);
        assert.equal(payload.segments.summary.payload.prompt_sources[0].purchase_success_count, 1);
        assert.equal(payload.segments.summary.payload.prompt_sources[0].gmv_points, 80);
        assert.equal(payload.segments.summary.payload.prompt_sources[0].detail_view_user_samples[0], 'user-2');
        assert.equal(payload.segments.summary.payload.prompt_sources[0].purchase_click_user_samples[0], 'user-2');
        assert.equal(payload.segments.summary.payload.prompt_sources[0].purchase_success_user_samples[0], 'user-2');
        assert.equal(payload.segments.summary.payload.prompt_sources[0].order_samples[0].order_id, 'order-2');
        assert.equal(payload.segments.summary.payload.refund_breakdown[0].status, 'refunded');
        assert.equal(payload.segments.summary.payload.refund_breakdown[0].count, 1);
        assert.equal(payload.segments.summary.payload.delivery_breakdown[0].status, 'processing');
        assert.equal(payload.segments.summary.payload.delivery_breakdown[0].count, 1);
        assert.equal(payload.segments.summary.payload.content_assisted_prompt_count, 1);
        assert.equal(payload.segments.summary.payload.content_assisted_purchase_success_count, 1);
        assert.equal(payload.segments.summary.payload.content_assisted_gmv_points, 80);
        assert.equal(payload.segments.summary.payload.top_prompt_id, 'prompt-9002');
        assert.equal(payload.segments.summary.payload.top_source_page.key, 'prompts');
        assert.equal(payload.segments.summary.payload.top_source_channel.key, 'prompt_content');
        assert.equal(Array.isArray(payload.segments.summary.payload.buyer_segment_summary), true);
        assert.equal(payload.segments.summary.payload.buyer_segment_summary[0].label, '本商品首购');
        assert.equal(payload.segments.summary.payload.buyer_segment_summary[0].count, 1);
        assert.equal(payload.segments.summary.payload.buyer_segment_summary[1].label, '窗口复购');
        assert.equal(payload.segments.summary.payload.buyer_segment_summary[1].count, 1);
        assert.equal(Array.isArray(payload.segments.summary.payload.first_purchase_destinations), true);
        assert.equal(payload.segments.summary.payload.first_purchase_destinations[0].product_id, 'product-2');
        assert.equal(Array.isArray(payload.segments.summary.payload.cross_sell_destinations), true);
        assert.equal(payload.segments.summary.payload.cross_sell_destinations[0].product_id, 'product-3');
        assert.equal(payload.segments.summary.payload.cross_sell_destinations[0].user_count, 1);
        assert.equal(Array.isArray(payload.segments.summary.payload.post_purchase_destinations), true);
        assert.equal(payload.segments.summary.payload.post_purchase_destinations[0].product_id, 'product-3');
        assert.equal(payload.segments.summary.payload.post_purchase_destinations[0].user_count, 1);
        assert.equal(payload.segments.summary.payload.post_purchase_destinations[0].order_count, 1);
        assert.equal(payload.segments.summary.payload.event_stage_summary.length, 4);
        assert.equal(payload.segments.summary.payload.event_stage_summary[0].key, 'product_card_click');
        assert.equal(payload.segments.trend.ok, true);
        assert.equal(payload.segments.trend.payload.length, 1);
        assert.equal(payload.segments.funnel.ok, true);
        assert.equal(payload.segments.funnel.payload.summary.product_id, 'product-2');
        assert.equal(payload.segments.funnel.payload.summary.stages[0].value, 1);
        assert.equal(payload.segments.funnel.payload.summary.stages[1].value, 1);
        assert.equal(payload.segments.funnel.payload.summary.stages[2].value, 1);
        assert.equal(payload.segments.funnel.payload.summary.stages[3].value, 0);
        assert.equal(payload.segments.funnel.payload.summary.stages[4].value, 1);
        assert.equal(payload.segments.funnel.payload.summary.card_click_user_count, 1);
        assert.equal(payload.segments.funnel.payload.summary.intent_to_paid_rate, 100);
        assert.equal(payload.segments.recentOrders.ok, true);
        assert.equal(payload.segments.recentOrders.payload.length, 2);
        assert.equal(payload.segments.recentOrders.payload[0].order_id, 'order-3');
    });
});
