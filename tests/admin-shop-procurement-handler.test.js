const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

function createMockResponse() {
    const state = {
        statusCode: 200,
        body: ''
    };

    return {
        status(code) {
            state.statusCode = code;
            return this;
        },
        setHeader() {
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

function createQueryBuilder(state, table) {
    const operations = [];
    let mode = 'select';
    let payload = null;
    let single = false;

    function finalize(finalizeMode) {
        state.queryCalls.push({ table, operations: [...operations], mode: finalizeMode, queryMode: mode, payload, single });
        const queue = state.queryResults[table] || [];
        const nextResult = queue.length ? queue.shift() : { data: [], error: null };
        return Promise.resolve(nextResult);
    }

    const builder = {
        select(...args) {
            operations.push({ method: 'select', args });
            return builder;
        },
        update(nextPayload) {
            mode = 'update';
            payload = nextPayload;
            operations.push({ method: 'update', args: [nextPayload] });
            return builder;
        },
        eq(column, value) {
            operations.push({ method: 'eq', args: [column, value] });
            return builder;
        },
        in(column, values) {
            operations.push({ method: 'in', args: [column, values] });
            return builder;
        },
        order(column, options) {
            operations.push({ method: 'order', args: [column, options] });
            return builder;
        },
        limit(value) {
            operations.push({ method: 'limit', args: [value] });
            return finalize('limit');
        },
        single() {
            single = true;
            operations.push({ method: 'single', args: [] });
            return builder;
        },
        then(resolve, reject) {
            return finalize('then').then(resolve, reject);
        }
    };

    return builder;
}

async function withShopProcurementHandler(initialState, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/shop/procurement.js');
    const originalLoad = Module._load;
    const state = {
        requireAdminCalls: [],
        auditCalls: [],
        queryCalls: [],
        queryResults: {},
        ...initialState
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                normalizeAdminSite(value, options = {}) {
                    const fallback = Object.prototype.hasOwnProperty.call(options, 'defaultValue')
                        ? options.defaultValue
                        : '';
                    const normalized = String(value || '').trim().toLowerCase();
                    return ['all', 'cn', 'intl'].includes(normalized) ? normalized : fallback;
                },
                async requireAdmin(req, options = {}) {
                    state.requireAdminCalls.push({ req, options });
                    return {
                        user: { id: 'admin_1', email: 'admin@example.com' },
                        supabase: {
                            from(table) {
                                return createQueryBuilder(state, table);
                            }
                        }
                    };
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                },
                async writeAdminAuditLog(payload) {
                    state.auditCalls.push(payload);
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
    }
}

test('shop procurement handler aggregates source cost and quality overview', async () => {
    await withShopProcurementHandler({
        queryResults: {
            shop_procurement_batches: [
                {
                    count: 3,
                    data: [
                        {
                            id: 'batch_1',
                            site: 'cn',
                            batch_code: 'SRC-001',
                            source_id: 'source_1',
                            product_id: 'prod_1',
                            sku_id: 'sku_1',
                            imported_count: 2,
                            unit_cost_cny: 10,
                            total_cost_cny: 20,
                            quality_status: 'unverified',
                            cost_status: 'actual',
                            notes: '首批验证',
                            created_at: '2026-06-06T01:00:00.000Z'
                        },
                        {
                            id: 'batch_2',
                            site: 'cn',
                            batch_code: 'SRC-002',
                            source_id: 'source_1',
                            product_id: 'prod_1',
                            sku_id: 'sku_2',
                            imported_count: 3,
                            unit_cost_cny: 12,
                            total_cost_cny: 36,
                            quality_status: 'accepted',
                            cost_status: 'actual',
                            proof_url: 'https://supplier.example.com/proof/2',
                            notes: '复购批次',
                            created_at: '2026-06-06T02:00:00.000Z'
                        },
                        {
                            id: 'batch_3',
                            site: 'cn',
                            batch_code: 'SRC-003',
                            source_id: 'source_2',
                            product_id: 'prod_2',
                            imported_count: 1,
                            unit_cost_cny: null,
                            total_cost_cny: null,
                            quality_status: 'watch',
                            cost_status: 'missing',
                            created_at: '2026-06-06T03:00:00.000Z'
                        }
                    ],
                    error: null
                }
            ],
            shop_inventory_sources: [
                {
                    data: [
                        {
                            id: 'source_1',
                            source_name: 'Google Workspace 供应商',
                            source_url: 'https://supplier.example.com/source/1',
                            platform: 'supplier',
                            risk_tier: 'standard',
                            quality_grade: 'a',
                            metadata: { source_tags: ['稳定', '主力'] }
                        },
                        {
                            id: 'source_2',
                            source_name: '备用货源',
                            risk_tier: 'watch'
                        }
                    ],
                    error: null
                }
            ],
            shop_products: [
                {
                    data: [
                        { id: 'prod_1', name: 'Gemini Pro' },
                        { id: 'prod_2', name: 'Google One' }
                    ],
                    error: null
                }
            ],
            shop_product_skus: [
                {
                    data: [
                        { id: 'sku_1', product_id: 'prod_1', sku_name: '30 天', sku_code: '30D' },
                        { id: 'sku_2', product_id: 'prod_1', sku_name: '90 天', sku_code: '90D' }
                    ],
                    error: null
                }
            ],
            shop_inventory: [
                {
                    data: [
                        { id: 'inv_1', source_batch_id: 'batch_1', status: 'sold', sold_at: '2026-06-06T05:00:00.000Z' },
                        { id: 'inv_2', source_batch_id: 'batch_1', status: 'available' },
                        { id: 'inv_3', source_batch_id: 'batch_2', status: 'sold', sold_at: '2026-06-06T06:00:00.000Z' },
                        { id: 'inv_4', source_batch_id: 'batch_2', status: 'sold', sold_at: '2026-06-06T06:10:00.000Z' },
                        { id: 'inv_5', source_batch_id: 'batch_2', status: 'sold', sold_at: '2026-06-06T06:20:00.000Z' },
                        { id: 'inv_6', source_batch_id: 'batch_2', status: 'sold', sold_at: '2026-06-06T06:30:00.000Z' },
                        { id: 'inv_7', source_batch_id: 'batch_2', status: 'sold', sold_at: '2026-06-06T06:40:00.000Z' },
                        { id: 'inv_8', source_batch_id: 'batch_3', status: 'fault' },
                        { id: 'inv_9', source_batch_id: 'batch_3', status: 'fault' },
                        { id: 'inv_10', source_batch_id: 'batch_3', status: 'sold', sold_at: '2026-06-06T07:00:00.000Z' }
                    ],
                    error: null
                }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({
            method: 'GET',
            headers: {},
            url: '/api/admin?route=shop/procurement&site=cn&limit=100'
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.site, 'cn');
        assert.equal(payload.totalCount, 3);
        assert.equal(payload.summary.totalBatches, 3);
        assert.equal(payload.summary.totalImported, 6);
        assert.equal(payload.summary.totalCostCny, 56);
        assert.equal(payload.summary.avgUnitCostCny, 11.2);
        assert.equal(payload.summary.sourceCount, 2);
        assert.equal(payload.summary.unverifiedCount, 1);
        assert.equal(payload.summary.watchCount, 1);
        assert.equal(payload.costBySource[0].source_name, 'Google Workspace 供应商');
        assert.equal(payload.costBySource[0].totalCostCny, 56);
        assert.deepEqual(payload.costBySource[0].source_tags, ['稳定', '主力']);
        assert.deepEqual(payload.recentBatches[0].source_tags, ['稳定', '主力']);
        assert.equal(payload.recentBatches[0].product_name, 'Gemini Pro');
        assert.equal(payload.recentBatches[0].sku_name, '30 天');
        assert.equal(payload.recentBatches[0].auto_quality.status, 'unverified');
        assert.equal(payload.recentBatches[1].auto_quality.status, 'accepted');
        assert.equal(payload.recentBatches[1].auto_quality.score >= 85, true);
        assert.equal(payload.recentBatches[1].auto_quality.sold_count, 5);
        assert.equal(payload.recentBatches[2].auto_quality.status, 'rejected');
        assert.match(payload.recentBatches[2].auto_quality.reasons.join(' '), /故障率/);
        assert.deepEqual(state.requireAdminCalls[0]?.options, { permission: 'shop.manage' });
        assert.equal(
            state.queryCalls.some((entry) => (
                entry.table === 'shop_procurement_batches'
                && entry.operations.some((operation) => (
                    operation.method === 'eq'
                    && operation.args[0] === 'site'
                    && operation.args[1] === 'cn'
                ))
            )),
            true,
            'handler should scope procurement batches by requested site'
        );
        assert.equal(
            state.queryCalls.some((entry) => (
                entry.table === 'shop_inventory'
                && entry.operations.some((operation) => (
                    operation.method === 'in'
                    && operation.args[0] === 'source_batch_id'
                ))
            )),
            true,
            'handler should read inventory samples for automatic quality suggestions'
        );
    });
});

test('shop procurement handler filters batches and returns profit performance signals', async () => {
    const batch = {
        id: 'batch_perf_1',
        site: 'cn',
        batch_code: 'PERF-001',
        source_id: 'source_perf',
        product_id: 'prod_perf',
        sku_id: 'sku_perf',
        imported_count: 3,
        unit_cost_cny: 10,
        total_cost_cny: 30,
        quality_status: 'accepted',
        quality_score: 92,
        cost_status: 'actual',
        notes: 'perf source batch',
        created_at: '2026-06-06T01:00:00.000Z'
    };
    const inventoryRows = [
        { id: 'inv_perf_1', source_batch_id: 'batch_perf_1', status: 'sold', sold_at: '2026-06-06T03:00:00.000Z' },
        { id: 'inv_perf_2', source_batch_id: 'batch_perf_1', status: 'sold', sold_at: '2026-06-06T03:30:00.000Z' },
        { id: 'inv_perf_3', source_batch_id: 'batch_perf_1', status: 'sold', sold_at: '2026-06-06T04:00:00.000Z' }
    ];
    const orders = [
        {
            id: 'order_perf_1',
            inventory_id: 'inv_perf_1',
            price_paid: 30,
            total_price: 30,
            paid_points_spent: 25,
            bonus_points_spent: 5,
            refund_status: null,
            created_at: '2026-06-06T01:00:00.000Z'
        },
        {
            id: 'order_perf_2',
            inventory_id: 'inv_perf_2',
            price_paid: 15,
            total_price: 15,
            paid_points_spent: 15,
            bonus_points_spent: 0,
            refund_status: 'refunded',
            created_at: '2026-06-06T01:30:00.000Z'
        },
        {
            id: 'order_perf_3',
            inventory_id: 'inv_perf_3',
            price_paid: 5,
            total_price: 5,
            paid_points_spent: 5,
            bonus_points_spent: 0,
            refund_status: null,
            created_at: '2026-06-06T02:00:00.000Z'
        }
    ];

    await withShopProcurementHandler({
        queryResults: {
            shop_procurement_batches: [
                {
                    count: 1,
                    data: [batch],
                    error: null
                }
            ],
            shop_inventory: [
                {
                    data: inventoryRows,
                    error: null
                }
            ],
            shop_orders: [
                {
                    data: orders,
                    error: null
                },
                {
                    data: orders,
                    error: null
                }
            ],
            shop_order_items: [
                {
                    data: [],
                    error: null
                },
                {
                    data: [],
                    error: null
                }
            ],
            shop_inventory_sources: [
                {
                    data: [
                        {
                            id: 'source_perf',
                            source_name: 'Performance Supplier',
                            source_url: 'https://supplier.example.com/perf',
                            platform: 'supplier',
                            risk_tier: 'standard',
                            quality_grade: 'a'
                        }
                    ],
                    error: null
                }
            ],
            shop_products: [
                {
                    data: [
                        { id: 'prod_perf', name: 'Gemini Pro Performance' }
                    ],
                    error: null
                }
            ],
            shop_product_skus: [
                {
                    data: [
                        { id: 'sku_perf', product_id: 'prod_perf', sku_name: '30 天', sku_code: 'PERF30' }
                    ],
                    error: null
                }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({
            method: 'GET',
            headers: {},
            url: '/api/admin?route=shop/procurement&site=cn&limit=100&sourceId=source_perf&qualityStatus=accepted&costStatus=actual&search=perf&dateFrom=2026-06-05&dateTo=2026-06-07'
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.filteredCount, 1);
        assert.equal(payload.filters.sourceId, 'source_perf');
        assert.equal(payload.filters.qualityStatus, 'accepted');
        assert.equal(payload.filters.costStatus, 'actual');
        assert.equal(payload.filters.search, 'perf');
        assert.match(payload.filters.dateFrom, /^2026-06-05T00:00:00\.000Z$/);
        assert.match(payload.filters.dateTo, /^2026-06-07T23:59:59\.999Z$/);
        assert.equal(payload.summary.orderCount, 3);
        assert.equal(payload.summary.refundOrderCount, 1);
        assert.equal(payload.summary.negativeProfitOrderCount, 1);
        assert.equal(payload.summary.recognizedRevenueCny, 30);
        assert.equal(payload.summary.recognizedCostCny, 20);
        assert.equal(payload.summary.netProfitCny, 10);
        assert.equal(payload.summary.marginRate, 0.3333);
        assert.equal(payload.costBySource[0].netProfitCny, 10);
        assert.equal(payload.costBySource[0].refundRate, 0.3333);
        assert.equal(payload.batchRecords[0].order_count, 3);
        assert.equal(payload.batchRecords[0].refund_order_count, 1);
        assert.equal(payload.batchRecords[0].negative_profit_order_count, 1);
        assert.equal(payload.batchRecords[0].recognized_revenue_cny, 30);
        assert.equal(payload.batchRecords[0].recognized_cost_cny, 20);
        assert.equal(payload.batchRecords[0].net_profit_cny, 10);
        assert.equal(payload.batchRecords[0].inventory_sold_rate, 1);
        assert.equal(payload.batchRecords[0].inventory_fault_rate, 0);
        assert.equal(payload.batchRecords[0].costed_item_count, 3);
        assert.equal(payload.batchRecords[0].missing_cost_item_count, 0);
        assert.equal(payload.batchRecords[0].avg_fulfillment_hours, 2);
        assert.equal(
            state.queryCalls.some((entry) => (
                entry.table === 'shop_procurement_batches'
                && entry.operations.some((operation) => (
                    operation.method === 'eq'
                    && operation.args[0] === 'source_id'
                    && operation.args[1] === 'source_perf'
                ))
            )),
            true,
            'handler should push source filters into the procurement batch query'
        );
        assert.equal(
            state.queryCalls.some((entry) => (
                entry.table === 'shop_procurement_batches'
                && entry.operations.some((operation) => (
                    operation.method === 'eq'
                    && operation.args[0] === 'quality_status'
                    && operation.args[1] === 'accepted'
                ))
            )),
            true,
            'handler should push quality filters into the procurement batch query'
        );
        assert.equal(
            state.queryCalls.some((entry) => (
                entry.table === 'shop_procurement_batches'
                && entry.operations.some((operation) => (
                    operation.method === 'eq'
                    && operation.args[0] === 'cost_status'
                    && operation.args[1] === 'actual'
                ))
            )),
            true,
            'handler should push cost filters into the procurement batch query'
        );
    });
});

test('shop procurement handler auto-syncs eligible auto-managed quality without overriding manual locks', async () => {
    const autoBatch = {
        id: 'batch_auto_1',
        site: 'cn',
        batch_code: 'AUTO-001',
        source_id: 'source_1',
        imported_count: 5,
        unit_cost_cny: 10,
        total_cost_cny: 50,
        proof_url: 'https://supplier.example.com/proof/auto',
        quality_status: 'watch',
        quality_score: 70,
        cost_status: 'actual',
        notes: '自动管理批次',
        metadata: { quality_control_mode: 'auto' },
        created_at: '2026-06-06T01:00:00.000Z'
    };
    const manualBatch = {
        id: 'batch_manual_1',
        site: 'cn',
        batch_code: 'MANUAL-001',
        source_id: 'source_1',
        imported_count: 5,
        unit_cost_cny: 10,
        total_cost_cny: 50,
        proof_url: 'https://supplier.example.com/proof/manual',
        quality_status: 'watch',
        quality_score: 70,
        cost_status: 'actual',
        notes: '手动锁定批次',
        metadata: { quality_control_mode: 'manual' },
        created_at: '2026-06-06T02:00:00.000Z'
    };

    await withShopProcurementHandler({
        queryResults: {
            shop_procurement_batches: [
                {
                    count: 2,
                    data: [autoBatch, manualBatch],
                    error: null
                },
                {
                    data: {
                        ...autoBatch,
                        quality_status: 'accepted',
                        quality_score: 100,
                        metadata: {
                            quality_control_mode: 'auto',
                            quality_auto_sample_count: 5,
                            quality_auto_evidence_count: 5,
                            quality_auto_sold_count: 5,
                            quality_auto_fault_count: 0
                        },
                        updated_at: '2026-06-06T03:00:00.000Z'
                    },
                    error: null
                }
            ],
            shop_inventory_sources: [
                {
                    data: [
                        {
                            id: 'source_1',
                            source_name: '稳定货源',
                            risk_tier: 'standard',
                            quality_grade: 'a'
                        }
                    ],
                    error: null
                }
            ],
            shop_inventory: [
                {
                    data: [
                        ...Array.from({ length: 5 }).map((_, index) => ({
                            id: `auto_inv_${index}`,
                            source_batch_id: 'batch_auto_1',
                            status: 'sold',
                            sold_at: `2026-06-06T05:0${index}:00.000Z`
                        })),
                        ...Array.from({ length: 5 }).map((_, index) => ({
                            id: `manual_inv_${index}`,
                            source_batch_id: 'batch_manual_1',
                            status: 'sold',
                            sold_at: `2026-06-06T06:0${index}:00.000Z`
                        }))
                    ],
                    error: null
                }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({
            method: 'GET',
            headers: {},
            url: '/api/admin?route=shop/procurement&site=cn&limit=100'
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.autoQualitySync.updatedCount, 1);
        assert.equal(payload.autoQualitySync.skippedManualCount, 1);
        assert.equal(payload.recentBatches[0].quality_status, 'accepted');
        assert.equal(payload.recentBatches[0].quality_score, 100);
        assert.equal(payload.recentBatches[1].quality_status, 'watch');
        assert.equal(
            state.queryCalls.filter((entry) => (
                entry.table === 'shop_procurement_batches'
                && entry.queryMode === 'update'
            )).length,
            1,
            'only the auto-managed batch should be updated'
        );
        assert.equal(state.auditCalls[0]?.actionType, 'shop.procurement.quality.auto_sync');
        assert.equal(state.auditCalls[0]?.details?.next_quality_status, 'accepted');
    });
});

test('shop procurement handler reads shared CN inventory when requested site is intl', async () => {
    await withShopProcurementHandler({
        queryResults: {
            shop_procurement_batches: [
                {
                    count: 1,
                    data: [
                        {
                            id: 'batch_shared_1',
                            site: 'cn',
                            batch_code: 'SHARED-001',
                            imported_count: 4,
                            unit_cost_cny: 8,
                            total_cost_cny: 32,
                            quality_status: 'accepted',
                            cost_status: 'actual',
                            created_at: '2026-06-06T04:00:00.000Z'
                        }
                    ],
                    error: null
                }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({
            method: 'GET',
            headers: {},
            url: '/api/admin?route=shop/procurement&site=intl&limit=100'
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.site, 'intl');
        assert.equal(payload.requestedSite, 'intl');
        assert.equal(payload.inventorySite, 'cn');
        assert.equal(payload.inventoryScope, 'shared');
        assert.equal(payload.summary.totalBatches, 1);
        assert.equal(payload.summary.totalCostCny, 32);
        assert.equal(
            state.queryCalls.some((entry) => (
                entry.table === 'shop_procurement_batches'
                && entry.operations.some((operation) => (
                    operation.method === 'eq'
                    && operation.args[0] === 'site'
                    && operation.args[1] === 'cn'
                ))
            )),
            true,
            'intl procurement overview should read from the shared CN inventory pool'
        );
    });
});

test('shop procurement handler rejects non-GET methods', async () => {
    await withShopProcurementHandler({}, async ({ handler }) => {
        const res = createMockResponse();
        await handler({ method: 'POST', headers: {}, url: '/api/admin?route=shop/procurement' }, res);

        assert.equal(res.statusCode, 405);
        assert.equal(res.json().success, false);
    });
});

test('shop procurement handler returns a clear schema-missing error', async () => {
    await withShopProcurementHandler({
        queryResults: {
            shop_procurement_batches: [
                {
                    data: null,
                    error: {
                        message: 'relation "shop_procurement_batches" does not exist'
                    }
                }
            ]
        }
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {}, url: '/api/admin?route=shop/procurement' }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 400);
        assert.equal(payload.success, false);
        assert.equal(payload.code, 'shop_procurement_schema_missing');
        assert.match(payload.message, /20260606_add_shop_inventory_procurement_sources\.sql/);
    });
});
