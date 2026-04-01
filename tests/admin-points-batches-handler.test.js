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
    return JSON.parse(JSON.stringify(value));
}

function normalizeComparable(value) {
    return value == null ? '' : String(value);
}

function applyFilters(rows, filters = []) {
    return rows.filter((row) => filters.every((filter) => {
        if (filter.kind === 'eq') {
            return normalizeComparable(row?.[filter.field]) === normalizeComparable(filter.value);
        }
        if (filter.kind === 'in') {
            return (Array.isArray(filter.values) ? filter.values : []).some((value) => normalizeComparable(row?.[filter.field]) === normalizeComparable(value));
        }
        return true;
    }));
}

function createReadSupabase(state) {
    function getTable(table) {
        return state.tables[table] || [];
    }

    function createQuery(table, filters = [], maybeSingleMode = false, singleMode = false) {
        return {
            eq(field, value) {
                filters.push({ kind: 'eq', field, value });
                return this;
            },
            in(field, values) {
                filters.push({ kind: 'in', field, values });
                return this;
            },
            order(field, options = {}) {
                const rows = [...applyFilters(getTable(table), filters)];
                rows.sort((left, right) => {
                    const leftValue = left?.[field];
                    const rightValue = right?.[field];
                    const leftTime = Date.parse(leftValue);
                    const rightTime = Date.parse(rightValue);
                    const delta = Number.isFinite(leftTime) && Number.isFinite(rightTime)
                        ? leftTime - rightTime
                        : normalizeComparable(leftValue).localeCompare(normalizeComparable(rightValue));
                    return options.ascending === false ? -delta : delta;
                });
                return Promise.resolve({
                    data: clone(rows),
                    error: null
                });
            },
            maybeSingle() {
                return createQuery(table, filters, true, false);
            },
            single() {
                return createQuery(table, filters, false, true);
            },
            then(resolve, reject) {
                try {
                    const rows = applyFilters(getTable(table), filters);
                    if (singleMode) {
                        if (!rows.length) {
                            resolve({ data: null, error: { code: 'PGRST116', message: 'not found' } });
                            return;
                        }
                        resolve({ data: clone(rows[0]), error: null });
                        return;
                    }

                    if (maybeSingleMode) {
                        resolve({ data: rows.length ? clone(rows[0]) : null, error: null });
                        return;
                    }

                    resolve({ data: clone(rows), error: null });
                } catch (error) {
                    if (typeof reject === 'function') {
                        reject(error);
                        return;
                    }
                    throw error;
                }
            }
        };
    }

    return {
        from(table) {
            return {
                select() {
                    return createQuery(table);
                }
            };
        }
    };
}

async function withPointsBatchesHandler(options, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/points/batches.js');
    const originalLoad = Module._load;
    const state = {
        requireAdminCalls: [],
        tables: {
            redemption_batches: clone(options?.tables?.redemption_batches || []),
            redemption_codes: clone(options?.tables?.redemption_codes || []),
            points_packages: clone(options?.tables?.points_packages || []),
            profiles: clone(options?.tables?.profiles || [])
        }
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                normalizeAdminSite(value, { defaultValue } = {}) {
                    const normalized = String(value || '').trim().toLowerCase();
                    if (normalized === 'intl') return 'intl';
                    if (normalized === 'cn') return 'cn';
                    if (normalized === 'all') return 'all';
                    return defaultValue || '';
                },
                async requireAdmin(req, config = {}) {
                    state.requireAdminCalls.push({ req, config });
                    return {
                        supabase: createReadSupabase(state)
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

test('points batches handler lists site-scoped batches with attached package summary', async () => {
    await withPointsBatchesHandler({
        tables: {
            redemption_batches: [
                { id: 'batch-cn-1', site: 'cn', package_id: 'pkg-1', name: 'CN Batch', created_at: '2026-04-01T10:00:00.000Z' },
                { id: 'batch-intl-1', site: 'intl', package_id: 'pkg-1', name: 'INTL Batch', created_at: '2026-04-01T09:00:00.000Z' }
            ],
            points_packages: [
                { id: 'pkg-1', name: 'Starter', points_amount: 100 }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', url: '/api/admin/points/batches?site=cn', headers: {} }, res);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(state.requireAdminCalls[0]?.config, { permission: 'points.manage' });
        assert.equal(res.json().batches.length, 1);
        assert.equal(res.json().batches[0]?.name, 'CN Batch');
        assert.equal(res.json().batches[0]?.points_packages?.name, 'Starter');
    });
});

test('points batches handler returns batch detail codes with used profile and revoker name', async () => {
    await withPointsBatchesHandler({
        tables: {
            redemption_batches: [
                { id: 'batch-cn-1', site: 'cn', package_id: 'pkg-1', name: 'CN Batch', created_at: '2026-04-01T10:00:00.000Z' }
            ],
            redemption_codes: [
                { id: 'code-1', batch_id: 'batch-cn-1', site: 'cn', code: 'ZY-CN-1', status: 'used', used_by: 'user-1', revoked_by: '', created_at: '2026-04-01T10:01:00.000Z' },
                { id: 'code-2', batch_id: 'batch-cn-1', site: 'cn', code: 'ZY-CN-2', status: 'revoked', used_by: 'user-1', revoked_by: 'admin-2', created_at: '2026-04-01T10:02:00.000Z' }
            ],
            points_packages: [
                { id: 'pkg-1', name: 'Starter', points_amount: 100 }
            ],
            profiles: [
                { id: 'user-1', username: 'Alice', email: 'alice@example.com' },
                { id: 'admin-2', username: 'Bob Admin', email: 'bob@example.com' }
            ]
        }
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', url: '/api/admin/points/batches?site=cn&batchId=batch-cn-1', headers: {} }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().batch?.name, 'CN Batch');
        assert.equal(res.json().codes.length, 2);
        assert.equal(res.json().codes[0]?.used_profile?.username, 'Alice');
        assert.equal(res.json().codes[1]?.revoker_name, 'Bob Admin');
    });
});

test('points batches handler can locate a batch by redemption code', async () => {
    await withPointsBatchesHandler({
        tables: {
            redemption_batches: [
                { id: 'batch-cn-1', site: 'cn', package_id: '', name: 'CN Batch', created_at: '2026-04-01T10:00:00.000Z' }
            ],
            redemption_codes: [
                { id: 'code-1', batch_id: 'batch-cn-1', site: 'cn', code: 'ZY-CN-SEARCH', status: 'pending', created_at: '2026-04-01T10:01:00.000Z' }
            ]
        }
    }, async ({ handler }) => {
        const res = createMockResponse();
        await handler({ method: 'GET', url: '/api/admin/points/batches?site=cn&code=ZY-CN-SEARCH', headers: {} }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().found, true);
        assert.equal(res.json().batch?.id, 'batch-cn-1');
    });
});
