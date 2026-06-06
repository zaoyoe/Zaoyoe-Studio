const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

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
            state.headers[String(name || '').toLowerCase()] = value;
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

function createSupabaseStub(state) {
    function createQueryBuilder(table) {
        const queryState = {
            eqFilters: [],
            inFilters: [],
            gteFilters: [],
            lteFilters: [],
            gtFilters: [],
            notFilters: [],
            orderBy: null,
            ascending: true,
            limitCount: null
        };

        function applyQuery() {
            let rows = Array.isArray(state.tables[table]) ? state.tables[table].map((row) => ({ ...row })) : [];

            for (const [column, value] of queryState.eqFilters) {
                rows = rows.filter((row) => String(row?.[column] || '') === String(value || ''));
            }
            for (const [column, values] of queryState.inFilters) {
                const valueSet = new Set(values.map((value) => String(value || '')));
                rows = rows.filter((row) => valueSet.has(String(row?.[column] || '')));
            }
            for (const [column, value] of queryState.gteFilters) {
                rows = rows.filter((row) => String(row?.[column] || '') >= String(value || ''));
            }
            for (const [column, value] of queryState.lteFilters) {
                rows = rows.filter((row) => String(row?.[column] || '') <= String(value || ''));
            }
            for (const [column, value] of queryState.gtFilters) {
                rows = rows.filter((row) => String(row?.[column] || '') > String(value || ''));
            }
            for (const [column, operator, value] of queryState.notFilters) {
                if (operator === 'in') {
                    const blocked = String(value || '')
                        .replace(/[()"]/g, '')
                        .split(',')
                        .map((item) => item.trim())
                        .filter(Boolean);
                    rows = rows.filter((row) => !blocked.includes(String(row?.[column] || '')));
                }
            }

            if (queryState.orderBy) {
                rows.sort((left, right) => {
                    const leftValue = String(left?.[queryState.orderBy] || '');
                    const rightValue = String(right?.[queryState.orderBy] || '');
                    return queryState.ascending
                        ? leftValue.localeCompare(rightValue)
                        : rightValue.localeCompare(leftValue);
                });
            }

            if (Number.isFinite(queryState.limitCount)) {
                rows = rows.slice(0, queryState.limitCount);
            }

            return rows;
        }

        const builder = {
            select(columns = '*') {
                state.calls.push({ table, mode: 'select', columns });
                return builder;
            },
            eq(column, value) {
                queryState.eqFilters.push([String(column || ''), value]);
                return builder;
            },
            in(column, values) {
                queryState.inFilters.push([String(column || ''), Array.isArray(values) ? values : []]);
                return builder;
            },
            gte(column, value) {
                queryState.gteFilters.push([String(column || ''), value]);
                return builder;
            },
            lte(column, value) {
                queryState.lteFilters.push([String(column || ''), value]);
                return builder;
            },
            gt(column, value) {
                queryState.gtFilters.push([String(column || ''), value]);
                return builder;
            },
            not(column, operator, value) {
                queryState.notFilters.push([String(column || ''), String(operator || ''), value]);
                return builder;
            },
            order(column, options = {}) {
                queryState.orderBy = String(column || '');
                queryState.ascending = options?.ascending !== false;
                return builder;
            },
            limit(value) {
                queryState.limitCount = Math.max(0, Number(value) || 0);
                return builder;
            },
            maybeSingle() {
                return Promise.resolve({
                    data: applyQuery()[0] || null,
                    error: null
                });
            },
            upsert(payload, options = {}) {
                const rows = Array.isArray(payload) ? payload : [payload];
                state.calls.push({
                    table,
                    mode: 'upsert',
                    payload: clone(rows),
                    options
                });
                state.tables[table] = Array.isArray(state.tables[table]) ? state.tables[table] : [];

                rows.forEach((row) => {
                    const index = state.tables[table].findIndex((existing) => (
                        String(existing?.order_id || '') === String(row?.order_id || '')
                        && String(existing?.dedupe_key || '') === String(row?.dedupe_key || '')
                    ));
                    if (index >= 0) {
                        state.tables[table][index] = { ...state.tables[table][index], ...row };
                    } else {
                        state.tables[table].push({
                            id: `ledger_${state.tables[table].length + 1}`,
                            ...row
                        });
                    }
                });

                return Promise.resolve({ data: clone(rows), error: null });
            },
            then(resolve, reject) {
                return Promise.resolve({
                    data: applyQuery(),
                    error: null
                }).then(resolve, reject);
            }
        };

        return builder;
    }

    return {
        from(table) {
            state.tables[table] = Array.isArray(state.tables[table]) ? state.tables[table] : [];
            return createQueryBuilder(table);
        }
    };
}

function createState(overrides = {}) {
    return {
        requireAdminCalls: [],
        auditLogs: [],
        calls: [],
        tables: {
            shop_orders: [
                {
                    id: 'order_1',
                    user_id: 'user_1',
                    product_id: 'product_1',
                    inventory_id: null,
                    snapshot_product_name: 'Premium Account',
                    price_paid: 100,
                    total_price: 100,
                    paid_points_spent: 100,
                    bonus_points_spent: 0,
                    item_count: 1,
                    refund_status: 'none',
                    site: 'cn',
                    created_at: '2026-06-01T00:00:00.000Z'
                },
                {
                    id: 'order_2',
                    user_id: 'user_2',
                    product_id: 'product_1',
                    inventory_id: null,
                    snapshot_product_name: 'Premium Account',
                    price_paid: 80,
                    total_price: 80,
                    paid_points_spent: 60,
                    bonus_points_spent: 20,
                    item_count: 1,
                    refund_status: 'refunded',
                    site: 'cn',
                    created_at: '2026-06-02T00:00:00.000Z'
                }
            ],
            shop_order_items: [
                {
                    id: 'item_1',
                    order_id: 'order_1',
                    inventory_id: 'inventory_1',
                    snapshot_product_name: 'Premium Account',
                    price_paid: 100,
                    created_at: '2026-06-01T00:00:01.000Z'
                },
                {
                    id: 'item_2',
                    order_id: 'order_2',
                    inventory_id: 'inventory_2',
                    snapshot_product_name: 'Premium Account',
                    price_paid: 80,
                    created_at: '2026-06-02T00:00:01.000Z'
                }
            ],
            shop_inventory: [
                {
                    id: 'inventory_1',
                    status: 'sold',
                    source_batch_id: 'batch_1',
                    purchase_unit_cost_cny: 35,
                    content: 'account-1'
                },
                {
                    id: 'inventory_2',
                    status: 'fault',
                    source_batch_id: 'batch_1',
                    purchase_unit_cost_cny: 35,
                    content: 'account-2'
                }
            ],
            shop_order_profit_ledger: []
        },
        ...overrides
    };
}

async function withBackfillHandler(stateOverrides, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/shop/profit-ledger-backfill.js');
    const originalLoad = Module._load;
    const state = createState(stateOverrides);
    const supabase = createSupabaseStub(state);

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                normalizeAdminSite(value, config = {}) {
                    const normalized = String(value || '').trim().toLowerCase();
                    if (['all', 'cn', 'intl'].includes(normalized)) return normalized;
                    return String(config?.defaultValue || '').trim().toLowerCase() || '';
                },
                async requireAdmin(req, options = {}) {
                    state.requireAdminCalls.push({ req, options });
                    return {
                        supabase,
                        user: { id: 'admin_1' }
                    };
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                },
                async writeAdminAuditLog(entry) {
                    state.auditLogs.push(entry);
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

test('shop profit ledger backfill handler describes bounded usage', async () => {
    await withBackfillHandler({}, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin?route=shop/profit-ledger-backfill'
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.endpoint, 'shop/profit-ledger-backfill');
        assert.equal(payload.limits.max, 100);
        assert.equal(state.requireAdminCalls[0]?.options?.permission, 'shop.manage');
    });
});

test('shop profit ledger backfill dry run previews entries without upserting or audit logging', async () => {
    await withBackfillHandler({}, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            url: '/api/admin?route=shop/profit-ledger-backfill&site=cn&limit=1&dryRun=1'
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.dryRun, true);
        assert.equal(payload.processed, 1);
        assert.equal(payload.hasMore, true);
        assert.equal(payload.nextCursor, '2026-06-01T00:00:00.000Z');
        assert.equal(payload.results[0].status, 'dry_run');
        assert.equal(payload.results[0].entry_count > 0, true);
        assert.equal(state.tables.shop_order_profit_ledger.length, 0);
        assert.equal(state.auditLogs.length, 0);
    });
});

test('shop profit ledger backfill upserts one bounded page and writes audit context', async () => {
    await withBackfillHandler({}, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            url: '/api/admin?route=shop/profit-ledger-backfill',
            body: {
                site: 'cn',
                limit: 2,
                includeRefunded: true
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.dryRun, false);
        assert.equal(payload.processed, 2);
        assert.equal(payload.synced, 2);
        assert.equal(payload.failed, 0);
        assert.equal(payload.hasMore, false);
        assert.equal(payload.results.some((row) => row.order_id === 'order_2' && row.profit_ledger_status === 'settled'), true);
        assert.equal(state.tables.shop_order_profit_ledger.some((row) => row.order_id === 'order_1' && row.entry_type === 'inventory_cost'), true);
        assert.equal(state.tables.shop_order_profit_ledger.some((row) => row.order_id === 'order_2' && row.entry_type === 'refund_reversal'), true);
        assert.equal(
            state.calls.some((call) => call.table === 'shop_order_profit_ledger' && call.mode === 'upsert' && call.options?.onConflict === 'order_id,dedupe_key'),
            true
        );
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'shop.profit_ledger.backfill');
        assert.equal(state.auditLogs[0].details.processed, 2);
        assert.equal(state.auditLogs[0].details.synced, 2);
    });
});
