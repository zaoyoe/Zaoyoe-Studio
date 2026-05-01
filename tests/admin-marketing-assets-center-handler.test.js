const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const adminLib = require('../api/_lib/admin');

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

function cloneRow(row) {
    return JSON.parse(JSON.stringify(row));
}

function compareValues(left, right, ascending = true) {
    const leftDate = Date.parse(left || '');
    const rightDate = Date.parse(right || '');
    if (Number.isFinite(leftDate) || Number.isFinite(rightDate)) {
        const safeLeft = Number.isFinite(leftDate) ? leftDate : 0;
        const safeRight = Number.isFinite(rightDate) ? rightDate : 0;
        return ascending ? safeLeft - safeRight : safeRight - safeLeft;
    }

    if (typeof left === 'number' || typeof right === 'number') {
        const safeLeft = Number(left) || 0;
        const safeRight = Number(right) || 0;
        return ascending ? safeLeft - safeRight : safeRight - safeLeft;
    }

    return ascending
        ? String(left || '').localeCompare(String(right || ''))
        : String(right || '').localeCompare(String(left || ''));
}

function applyFilters(rows, filters = []) {
    return rows.filter((row) => filters.every((filter) => {
        if (filter.op === 'eq') return row[filter.column] === filter.value;
        if (filter.op === 'in') return filter.values.includes(row[filter.column]);
        if (filter.op === 'gte') {
            const rowTime = Date.parse(row[filter.column] || '');
            const filterTime = Date.parse(filter.value || '');
            if (!Number.isFinite(filterTime)) return true;
            return Number.isFinite(rowTime) ? rowTime >= filterTime : false;
        }
        return true;
    }));
}

function createQueryBuilder(executor) {
    const state = {
        mode: 'select',
        filters: [],
        payload: null,
        order: null
    };

    const builder = {
        select() {
            return builder;
        },
        insert(payload) {
            state.mode = 'insert';
            state.payload = payload;
            return builder;
        },
        update(payload) {
            state.mode = 'update';
            state.payload = payload;
            return builder;
        },
        eq(column, value) {
            state.filters.push({ op: 'eq', column, value });
            return builder;
        },
        in(column, values) {
            state.filters.push({ op: 'in', column, values: Array.isArray(values) ? values.slice() : [] });
            return builder;
        },
        gte(column, value) {
            state.filters.push({ op: 'gte', column, value });
            return builder;
        },
        order(column, options = {}) {
            state.order = {
                column,
                ascending: options.ascending !== false
            };
            return builder;
        },
        then(resolve, reject) {
            return Promise.resolve(executor(state)).then(resolve, reject);
        },
        catch(reject) {
            return builder.then(undefined, reject);
        }
    };

    return builder;
}

function createSupabaseStub(state) {
    state.discountRows = Array.isArray(state.discountRows) ? state.discountRows : [];
    state.orderRows = Array.isArray(state.orderRows) ? state.orderRows : [];
    state.assetRows = Array.isArray(state.assetRows) ? state.assetRows : [];
    state.pointsPackages = Array.isArray(state.pointsPackages) ? state.pointsPackages : [];
    state.redemptionBatches = Array.isArray(state.redemptionBatches) ? state.redemptionBatches : [];
    state.workflowRows = Array.isArray(state.workflowRows) ? state.workflowRows : [];
    state.workflowRunRows = Array.isArray(state.workflowRunRows) ? state.workflowRunRows : [];
    state.tableRequests = Array.isArray(state.tableRequests) ? state.tableRequests : [];
    state.insertSeq = state.insertSeq || 1;

    function getRows(table) {
        if (table === 'discount_codes') return state.discountRows;
        if (table === 'shop_orders') return state.orderRows;
        if (table === 'discount_user_assets') return state.assetRows;
        if (table === 'points_packages') return state.pointsPackages;
        if (table === 'redemption_batches') return state.redemptionBatches;
        if (table === 'marketing_asset_workflows') return state.workflowRows;
        if (table === 'marketing_asset_workflow_runs') return state.workflowRunRows;
        throw new Error(`Unexpected table request: ${table}`);
    }

    return {
        from(table) {
            state.tableRequests.push(table);
            return createQueryBuilder((query) => {
                const sourceRows = getRows(table);

                if (query.mode === 'insert') {
                    const payloadRows = Array.isArray(query.payload) ? query.payload : [query.payload];
                    const insertedRows = payloadRows.map((row) => ({
                        id: row.id || `${table}_${state.insertSeq++}`,
                        ...cloneRow(row)
                    }));
                    sourceRows.push(...insertedRows);
                    return { data: insertedRows, error: null };
                }

                if (query.mode === 'update') {
                    const matchedRows = applyFilters(sourceRows, query.filters);
                    matchedRows.forEach((row) => Object.assign(row, cloneRow(query.payload)));
                    return { data: matchedRows.map(cloneRow), error: null };
                }

                let rows = applyFilters(sourceRows, query.filters).map(cloneRow);
                if (query.order?.column) {
                    rows.sort((left, right) => compareValues(left[query.order.column], right[query.order.column], query.order.ascending));
                }
                return { data: rows, error: null };
            });
        }
    };
}

function countTableRequests(state, table) {
    return (state.tableRequests || []).filter((requestedTable) => requestedTable === table).length;
}

async function withMarketingAssetsHandler(initialState, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/marketing/assets-center.js');
    const catalogHandlerPath = path.resolve(__dirname, '../server/api-handlers/admin/points/catalog.js');
    const sharedBasePath = path.resolve(__dirname, '../server/api-handlers/admin/points/_catalog-base.js');
    const originalLoad = Module._load;
    const state = {
        requireAdminCalls: [],
        auditCalls: [],
        ...initialState
    };

    delete require.cache[handlerPath];
    delete require.cache[catalogHandlerPath];
    delete require.cache[sharedBasePath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                normalizeAdminSite: adminLib.normalizeAdminSite,
                async requireAdmin(req, options = {}) {
                    state.requireAdminCalls.push({ req, options });
                    return {
                        supabase: createSupabaseStub(state),
                        user: { id: 'admin_1' }
                    };
                },
                async parseJsonBody(req) {
                    return req.body || {};
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                },
                async writeAdminAuditLog(entry) {
                    state.auditCalls.push(entry);
                }
            };
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    let catalogHandler;
    let handler;
    try {
        handler = require(handlerPath);
        catalogHandler = require(catalogHandlerPath);
    } finally {
        Module._load = originalLoad;
    }

    try {
        return await callback({ catalogHandler, handler, state });
    } finally {
        delete require.cache[handlerPath];
        delete require.cache[catalogHandlerPath];
        delete require.cache[sharedBasePath];
    }
}

test('marketing assets center GET returns unified discount, package, and workflow overview without leaking raw source rows', async () => {
    await withMarketingAssetsHandler({
        discountRows: [
            {
                id: 'discount_1',
                code: 'SPRING20',
                created_at: '2099-04-09T08:00:00.000Z',
                applicable_site: 'cn',
                is_active: true,
                lifecycle_status: 'scheduled',
                status_reason: 'scheduled_start',
                starts_at: '2000-01-01T00:00:00.000Z',
                expires_at: '2099-05-01T00:00:00.000Z',
                distribution_mode: 'public_claim',
                is_exclusive: false,
                stack_priority: 12,
                pricing_apply_stage: 'catalog_price'
            }
        ],
        orderRows: [
            {
                id: 'order_1',
                discount_code: 'SPRING20',
                price_paid: 180,
                discount_amount: 20,
                refund_status: null,
                created_at: '2099-04-09T10:00:00.000Z',
                site: 'cn'
            }
        ],
        assetRows: [
            {
                id: 'asset_1',
                discount_id: 'discount_1',
                asset_status: 'available',
                assigned_at: '2099-04-09T09:00:00.000Z',
                claimed_at: '2099-04-09T09:05:00.000Z',
                consumed_at: null,
                restored_at: null
            }
        ],
        pointsPackages: [
            {
                id: 'package_1',
                name: '积分礼包',
                points_amount: 100,
                bonus_points: 20,
                price_cny: 12,
                is_active: true,
                sort_order: 1,
                created_at: '2099-04-01T08:00:00.000Z'
            }
        ],
        redemptionBatches: [
            {
                id: 'batch_1',
                package_id: 'package_1',
                total_count: 10,
                used_count: 3,
                status: 'active',
                site: 'cn',
                created_at: '2099-04-08T08:00:00.000Z'
            }
        ],
        workflowRows: [
            {
                id: 'workflow_1',
                workflow_key: 'discount_lifecycle_sync',
                workflow_name: '优惠券生命周期同步',
                asset_family: 'discount',
                status: 'active',
                schedule_label: '建议每小时执行',
                sort_order: 1,
                config: { interval_hours: 1 },
                last_run_at: null,
                last_run_status: null,
                last_run_summary: null,
                next_run_at: null
            }
        ],
        workflowRunRows: []
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {}, url: '/api/admin/marketing/assets-center?site=cn' }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.summary.discount_count, 1);
        assert.equal(payload.summary.package_count, 1);
        assert.equal(payload.summary.due_workflow_count, 1);
        assert.equal(payload.asset_families.length, 2);
        assert.equal(payload.unified_assets.length >= 1, true);
        assert.equal(payload.unified_assets[0].stacking_policy.pricing_apply_stage, 'catalog_price');
        assert.equal(Object.prototype.hasOwnProperty.call(payload.unified_assets[0], '__source'), false);
        assert.equal(payload.workflows[0].due_count, 1);
    });
});

test('marketing assets center summary mode skips detail table scans for faster first paint', async () => {
    await withMarketingAssetsHandler({
        discountRows: [
            {
                id: 'discount_1',
                code: 'SPRING20',
                created_at: '2099-04-09T08:00:00.000Z',
                applicable_site: 'cn',
                is_active: true,
                lifecycle_status: 'scheduled',
                status_reason: 'scheduled_start',
                starts_at: '2000-01-01T00:00:00.000Z',
                expires_at: '2099-05-01T00:00:00.000Z',
                distribution_mode: 'public_claim'
            }
        ],
        orderRows: [
            {
                id: 'order_1',
                discount_code: 'SPRING20',
                price_paid: 180,
                discount_amount: 20,
                refund_status: null,
                created_at: '2099-04-09T10:00:00.000Z',
                site: 'cn'
            }
        ],
        assetRows: [
            {
                id: 'asset_1',
                discount_id: 'discount_1',
                asset_status: 'available',
                assigned_at: '2099-04-09T09:00:00.000Z'
            }
        ],
        pointsPackages: [
            {
                id: 'package_1',
                name: '积分礼包',
                points_amount: 100,
                bonus_points: 20,
                price_cny: 12,
                is_active: true,
                sort_order: 1,
                created_at: '2099-04-01T08:00:00.000Z'
            }
        ],
        redemptionBatches: [],
        workflowRows: [],
        workflowRunRows: [
            {
                id: 'run_1',
                workflow_id: 'workflow_1',
                workflow_key: 'discount_lifecycle_sync',
                started_at: '2099-04-09T10:00:00.000Z',
                run_status: 'success',
                summary: 'done'
            }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', headers: {}, url: '/api/admin/marketing/assets-center?site=cn&mode=summary' }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.load_mode, 'summary');
        assert.equal(payload.details_pending, true);
        assert.equal(payload.asset_families.length, 2);
        assert.equal(state.tableRequests.includes('discount_codes'), true);
        assert.equal(state.tableRequests.includes('points_packages'), true);
        assert.equal(state.tableRequests.includes('shop_orders'), false);
        assert.equal(state.tableRequests.includes('discount_user_assets'), false);
        assert.equal(state.tableRequests.includes('marketing_asset_workflow_runs'), false);
    });
});

test('marketing assets center reuses points catalog base rows warmed by the points catalog', async () => {
    await withMarketingAssetsHandler({
        discountRows: [
            {
                id: 'discount_1',
                code: 'SPRING20',
                created_at: '2099-04-09T08:00:00.000Z',
                applicable_site: 'cn',
                is_active: true,
                lifecycle_status: 'active',
                distribution_mode: 'general_code'
            }
        ],
        pointsPackages: [
            {
                id: 'package_1',
                name: '积分礼包',
                points_amount: 100,
                bonus_points: 20,
                price_cny: 12,
                is_active: true,
                sort_order: 1,
                created_at: '2099-04-01T08:00:00.000Z'
            }
        ],
        redemptionBatches: [
            {
                id: 'batch_1',
                package_id: 'package_1',
                total_count: 10,
                used_count: 3,
                status: 'active',
                site: 'cn',
                created_at: '2099-04-08T08:00:00.000Z'
            }
        ],
        workflowRows: []
    }, async ({ catalogHandler, handler, state }) => {
        const catalogRes = createMockResponse();
        await catalogHandler({ method: 'GET', headers: {}, url: '/api/admin/points/catalog?site=cn' }, catalogRes);

        const assetsRes = createMockResponse();
        await handler({ method: 'GET', headers: {}, url: '/api/admin/marketing/assets-center?site=cn&mode=summary' }, assetsRes);

        assert.equal(catalogRes.statusCode, 200);
        assert.equal(assetsRes.statusCode, 200);
        assert.equal(assetsRes.json().summary.package_count, 1);
        assert.equal(countTableRequests(state, 'points_packages'), 1);
        assert.equal(countTableRequests(state, 'redemption_batches'), 1);
        assert.equal(countTableRequests(state, 'discount_codes'), 1);
        assert.equal(countTableRequests(state, 'marketing_asset_workflows'), 1);
    });
});

test('marketing assets center returns a detail overlay without rereading base rows', async () => {
    await withMarketingAssetsHandler({
        discountRows: [
            {
                id: 'discount_1',
                code: 'SPRING20',
                created_at: '2099-04-09T08:00:00.000Z',
                applicable_site: 'cn',
                is_active: true,
                lifecycle_status: 'scheduled',
                status_reason: 'scheduled_start',
                starts_at: '2000-01-01T00:00:00.000Z',
                expires_at: '2099-05-01T00:00:00.000Z',
                distribution_mode: 'public_claim'
            }
        ],
        orderRows: [
            {
                id: 'order_1',
                discount_code: 'SPRING20',
                price_paid: 180,
                discount_amount: 20,
                refund_status: null,
                created_at: '2099-04-09T10:00:00.000Z',
                site: 'cn'
            }
        ],
        assetRows: [
            {
                id: 'asset_1',
                discount_id: 'discount_1',
                asset_status: 'available',
                assigned_at: '2099-04-09T09:00:00.000Z'
            }
        ],
        pointsPackages: [
            {
                id: 'package_1',
                name: '积分礼包',
                points_amount: 100,
                bonus_points: 20,
                price_cny: 12,
                is_active: true,
                sort_order: 1,
                created_at: '2099-04-01T08:00:00.000Z'
            }
        ],
        redemptionBatches: [
            {
                id: 'batch_1',
                package_id: 'package_1',
                total_count: 10,
                used_count: 3,
                status: 'active',
                site: 'cn',
                created_at: '2099-04-08T08:00:00.000Z'
            }
        ],
        workflowRows: [
            {
                id: 'workflow_1',
                workflow_key: 'discount_lifecycle_sync',
                workflow_name: '优惠券生命周期同步',
                asset_family: 'discount',
                status: 'active',
                schedule_label: '建议每小时执行',
                sort_order: 1,
                config: { interval_hours: 1 },
                last_run_at: null,
                last_run_status: null,
                last_run_summary: null,
                next_run_at: null
            }
        ],
        workflowRunRows: [
            {
                id: 'run_1',
                workflow_id: 'workflow_1',
                workflow_key: 'discount_lifecycle_sync',
                started_at: '2099-04-09T10:00:00.000Z',
                run_status: 'success',
                summary: 'done'
            }
        ]
    }, async ({ handler, state }) => {
        const summaryRes = createMockResponse();
        await handler({ method: 'GET', headers: {}, url: '/api/admin/marketing/assets-center?site=cn&mode=summary' }, summaryRes);

        assert.equal(summaryRes.statusCode, 200);
        assert.equal(summaryRes.json().details_pending, true);
        assert.equal(countTableRequests(state, 'discount_user_assets'), 0);
        assert.equal(countTableRequests(state, 'shop_orders'), 0);
        assert.equal(countTableRequests(state, 'marketing_asset_workflow_runs'), 0);

        const detailsRes = createMockResponse();
        await handler({ method: 'GET', headers: {}, url: '/api/admin/marketing/assets-center?site=cn&mode=details' }, detailsRes);

        const detailsPayload = detailsRes.json();
        assert.equal(detailsRes.statusCode, 200);
        assert.equal(detailsPayload.load_mode, 'details');
        assert.equal(detailsPayload.details_pending, false);
        assert.equal(detailsPayload.summary.issued_asset_count, 1);
        assert.equal(detailsPayload.summary.recent_revenue_net, 180);
        assert.equal(Object.prototype.hasOwnProperty.call(detailsPayload.summary, 'package_count'), false);
        assert.equal(detailsPayload.asset_families.length, 1);
        assert.equal(detailsPayload.asset_families[0].key, 'discount');
        assert.equal(detailsPayload.unified_assets_mode, 'discount_patch');
        assert.equal(detailsPayload.unified_assets.every((item) => item.type === 'discount'), true);
        assert.equal(detailsPayload.workflows[0].latest_run.summary, 'done');
        assert.equal(countTableRequests(state, 'discount_codes'), 1);
        assert.equal(countTableRequests(state, 'points_packages'), 1);
        assert.equal(countTableRequests(state, 'redemption_batches'), 1);
        assert.equal(countTableRequests(state, 'marketing_asset_workflows'), 1);
        assert.equal(countTableRequests(state, 'discount_user_assets'), 1);
        assert.equal(countTableRequests(state, 'shop_orders'), 1);
        assert.equal(countTableRequests(state, 'marketing_asset_workflow_runs'), 1);
    });
});

test('marketing assets center workflow run updates lifecycle state and writes audit context', async () => {
    await withMarketingAssetsHandler({
        discountRows: [
            {
                id: 'discount_1',
                code: 'SPRING20',
                created_at: '2099-04-09T08:00:00.000Z',
                applicable_site: 'cn',
                is_active: true,
                lifecycle_status: 'scheduled',
                status_reason: 'scheduled_start',
                starts_at: '2000-01-01T00:00:00.000Z',
                expires_at: '2099-05-01T00:00:00.000Z',
                distribution_mode: 'general_code'
            }
        ],
        workflowRows: [
            {
                id: 'workflow_1',
                workflow_key: 'discount_lifecycle_sync',
                workflow_name: '优惠券生命周期同步',
                asset_family: 'discount',
                status: 'active',
                schedule_label: '建议每小时执行',
                sort_order: 1,
                config: { interval_hours: 1 },
                last_run_at: null,
                last_run_status: null,
                last_run_summary: null,
                next_run_at: null
            }
        ]
    }, async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'run_workflow',
                workflow_key: 'discount_lifecycle_sync',
                site: 'cn'
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(state.discountRows[0].lifecycle_status, 'active');
        assert.equal(state.discountRows[0].status_reason, 'scheduled_activated');
        assert.equal(state.workflowRows[0].last_run_status, 'success');
        assert.equal(state.workflowRunRows.length, 1);
        assert.equal(state.workflowRunRows[0].workflow_key, 'discount_lifecycle_sync');
        assert.equal(state.auditCalls.length, 1);
        assert.equal(state.auditCalls[0].actionType, 'marketing.assets.workflow.run');
        assert.equal(state.auditCalls[0].details.workflow_key, 'discount_lifecycle_sync');
    });
});
