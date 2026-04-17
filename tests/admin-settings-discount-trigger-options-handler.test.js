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

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeComparableValue(value) {
    return value == null ? '' : String(value);
}

function createSupabaseDouble(state) {
    function getTable(table) {
        if (!state.tables[table]) {
            state.tables[table] = [];
        }
        return state.tables[table];
    }

    return {
        from(table) {
            const rows = getTable(table);
            return {
                select() {
                    const filters = [];
                    const query = {
                        eq(field, value) {
                            filters.push({ kind: 'eq', field, value });
                            return query;
                        },
                        order(field, options = {}) {
                            query._order = {
                                field,
                                ascending: options?.ascending !== false
                            };
                            return query;
                        },
                        then(resolve, reject) {
                            try {
                                let result = clone(rows);
                                for (const filter of filters) {
                                    if (filter.kind === 'eq') {
                                        result = result.filter((row) => (
                                            normalizeComparableValue(row?.[filter.field]) === normalizeComparableValue(filter.value)
                                        ));
                                    }
                                }

                                if (query._order?.field) {
                                    const { field, ascending } = query._order;
                                    result.sort((left, right) => {
                                        const leftValue = normalizeComparableValue(left?.[field]);
                                        const rightValue = normalizeComparableValue(right?.[field]);
                                        return ascending
                                            ? leftValue.localeCompare(rightValue)
                                            : rightValue.localeCompare(leftValue);
                                    });
                                }

                                resolve({ data: result, error: null });
                            } catch (error) {
                                if (typeof reject === 'function') {
                                    reject(error);
                                    return;
                                }
                                throw error;
                            }
                        }
                    };

                    return query;
                }
            };
        }
    };
}

async function withHandler(options, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/settings/discount-trigger-options.js');
    const originalLoad = Module._load;
    const state = {
        requireAdminCalls: [],
        tables: {
            discount_codes: clone(options?.tables?.discount_codes || [])
        }
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                normalizeAdminSite(value, { defaultValue = 'all' } = {}) {
                    const normalized = String(value || '').trim().toLowerCase();
                    if (!normalized || normalized === 'global') return defaultValue;
                    return ['all', 'cn', 'intl'].includes(normalized) ? normalized : defaultValue;
                },
                async requireAdmin(req, config = {}) {
                    state.requireAdminCalls.push({ req, config });
                    return {
                        supabase: createSupabaseDouble(state),
                        user: { id: 'admin_1' }
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
    }
}

test('discount trigger options handler requires settings.manage and only returns user-assigned rows for matching site', async () => {
    await withHandler({
        tables: {
            discount_codes: [
                {
                    id: 'discount-global-assigned',
                    code: 'global-gift',
                    applicable_site: 'all',
                    distribution_mode: 'user_assigned',
                    discount_type: 'fixed',
                    discount_value: 50,
                    lifecycle_status: 'active',
                    created_at: '2026-04-15T10:00:00.000Z'
                },
                {
                    id: 'discount-cn-assigned',
                    code: 'cn-only',
                    applicable_site: 'cn',
                    distribution_mode: 'user_assigned',
                    discount_type: 'percent',
                    discount_value: 85,
                    lifecycle_status: 'scheduled',
                    starts_at: '2026-04-20T00:00:00.000Z',
                    created_at: '2026-04-14T10:00:00.000Z'
                },
                {
                    id: 'discount-cn-public',
                    code: 'public-claim',
                    applicable_site: 'cn',
                    distribution_mode: 'public_claim',
                    discount_type: 'fixed',
                    discount_value: 10,
                    lifecycle_status: 'active',
                    created_at: '2026-04-13T10:00:00.000Z'
                },
                {
                    id: 'discount-intl-assigned',
                    code: 'intl-only',
                    applicable_site: 'intl',
                    distribution_mode: 'user_assigned',
                    discount_type: 'fixed',
                    discount_value: 30,
                    lifecycle_status: 'active',
                    created_at: '2026-04-12T10:00:00.000Z'
                }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin/settings/discount-trigger-options?site=cn'
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(state.requireAdminCalls[0]?.config?.permission, 'settings.manage');

        const payload = res.json();
        assert.equal(payload.success, true);
        assert.equal(payload.site, 'cn');
        assert.deepEqual(
            payload.rows.map((row) => row.id),
            ['discount-global-assigned', 'discount-cn-assigned']
        );
        assert.equal(payload.rows.every((row) => row.distribution_mode === 'user_assigned'), true);
        assert.equal(payload.rows[0].code, 'GLOBAL-GIFT');
        assert.equal(typeof payload.rows[0].lifecycle_summary?.label, 'string');
    });
});

test('discount trigger options handler returns all matching assigned rows when site is all', async () => {
    await withHandler({
        tables: {
            discount_codes: [
                {
                    id: 'discount-all',
                    code: 'all-user',
                    applicable_site: 'all',
                    distribution_mode: 'user_assigned',
                    discount_type: 'fixed',
                    discount_value: 20,
                    lifecycle_status: 'active',
                    created_at: '2026-04-15T10:00:00.000Z'
                },
                {
                    id: 'discount-cn',
                    code: 'cn-user',
                    applicable_site: 'cn',
                    distribution_mode: 'user_assigned',
                    discount_type: 'fixed',
                    discount_value: 10,
                    lifecycle_status: 'active',
                    created_at: '2026-04-14T10:00:00.000Z'
                },
                {
                    id: 'discount-intl',
                    code: 'intl-user',
                    applicable_site: 'intl',
                    distribution_mode: 'user_assigned',
                    discount_type: 'percent',
                    discount_value: 90,
                    lifecycle_status: 'paused_risk',
                    created_at: '2026-04-13T10:00:00.000Z'
                }
            ]
        }
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin/settings/discount-trigger-options?site=all'
        }, res);

        assert.equal(res.statusCode, 200);
        const payload = res.json();
        assert.equal(payload.success, true);
        assert.equal(payload.site, 'all');
        assert.deepEqual(
            payload.rows.map((row) => row.id),
            ['discount-all', 'discount-cn', 'discount-intl']
        );
    });
});
