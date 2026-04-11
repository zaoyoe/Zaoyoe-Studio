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

function applyFilters(rows, filters = []) {
    return rows.filter((row) => filters.every((filter) => {
        if (!filter) {
            return true;
        }

        if (filter.kind === 'eq') {
            return normalizeComparableValue(row?.[filter.field]) === normalizeComparableValue(filter.value);
        }

        if (filter.kind === 'in') {
            return (Array.isArray(filter.values) ? filter.values : []).some((value) => (
                normalizeComparableValue(row?.[filter.field]) === normalizeComparableValue(value)
            ));
        }

        return true;
    }));
}

function createSupabaseDouble(state) {
    function getTable(table) {
        if (!state.tables[table]) {
            state.tables[table] = [];
        }
        return state.tables[table];
    }

    function buildSelectQuery(table, filters = []) {
        return {
            eq(field, value) {
                filters.push({ kind: 'eq', field, value });
                return this;
            },
            in(field, values) {
                filters.push({ kind: 'in', field, values });
                return this;
            },
            then(resolve, reject) {
                try {
                    resolve({
                        data: clone(applyFilters(getTable(table), filters)),
                        error: null
                    });
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

    function buildDeleteQuery(table, filters = []) {
        return {
            eq(field, value) {
                filters.push({ kind: 'eq', field, value });
                return this;
            },
            in(field, values) {
                filters.push({ kind: 'in', field, values });
                return this;
            },
            then(resolve, reject) {
                try {
                    state.tables[table] = getTable(table).filter((row) => !applyFilters([row], filters).length);
                    resolve({ data: null, error: null });
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
                    return buildSelectQuery(table, []);
                },
                upsert(payload, options = {}) {
                    const rows = getTable(table);
                    const items = Array.isArray(payload) ? payload : [payload];
                    const conflictFields = String(options?.onConflict || '').split(',').map((item) => item.trim()).filter(Boolean);

                    items.forEach((item) => {
                        const cloned = clone(item);
                        const existingIndex = rows.findIndex((row) => (
                            conflictFields.every((field) => normalizeComparableValue(row?.[field]) === normalizeComparableValue(cloned?.[field]))
                        ));
                        if (existingIndex >= 0) {
                            rows[existingIndex] = {
                                ...rows[existingIndex],
                                ...cloned
                            };
                        } else {
                            rows.push(cloned);
                        }
                    });

                    return Promise.resolve({ data: null, error: null });
                },
                insert(payload) {
                    const rows = getTable(table);
                    const items = Array.isArray(payload) ? payload : [payload];
                    items.forEach((item) => rows.push(clone(item)));
                    return Promise.resolve({ data: null, error: null });
                },
                delete() {
                    return buildDeleteQuery(table, []);
                }
            };
        }
    };
}

async function withUsersBlocksHandler(options, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/users/blocks.js');
    const originalLoad = Module._load;
    const state = {
        auditEntries: [],
        notifications: [],
        requireAdminCalls: [],
        tables: {
            profiles: clone(options?.tables?.profiles || []),
            blocked_users: clone(options?.tables?.blocked_users || []),
            block_history: clone(options?.tables?.block_history || [])
        }
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                async requireAdmin(req, config = {}) {
                    state.requireAdminCalls.push({ req, config });
                    return {
                        supabase: createSupabaseDouble(state),
                        user: { id: 'admin_1', email: 'admin@example.com' }
                    };
                },
                async parseJsonBody(req) {
                    return req.body || {};
                },
                normalizeAdminSite(value, { defaultValue = 'all' } = {}) {
                    return String(value || '').trim().toLowerCase() || defaultValue;
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                },
                async writeAdminAuditLog(entry) {
                    state.auditEntries.push(clone(entry));
                }
            };
        }

        if (request === '../../../../api/_lib/admin-notifications') {
            return {
                async notifyUsers(_supabase, payload) {
                    state.notifications.push(clone(payload));
                    return {
                        recipients: Array.isArray(payload?.userIds) ? payload.userIds.length : 0,
                        created: Array.isArray(payload?.userIds) ? payload.userIds.length : 0,
                        skipped: 0
                    };
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

test('users blocks handler GET returns active scope state including points usage', async () => {
    await withUsersBlocksHandler({
        tables: {
            profiles: [{ id: 'user_1', email: 'user1@example.com' }],
            blocked_users: [
                { user_id: 'user_1', scope: 'points_usage', reason: '积分风控', expires_at: null },
                { user_id: 'user_1', scope: 'gallery', reason: '画廊违规', expires_at: null }
            ]
        }
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            url: '/api/admin/users/blocks?userId=user_1',
            headers: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().blocks.length, 2);
        assert.equal(res.json().isPointsUsageBlocked, true);
        assert.equal(res.json().isGalleryBlocked, true);
    });
});

test('users blocks handler POST applies batched block changes and writes history/audit', async () => {
    await withUsersBlocksHandler({
        tables: {
            profiles: [{ id: 'user_1', email: 'user1@example.com' }]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'apply_selection',
                items: [
                    {
                        userId: 'user_1',
                        scope: 'gallery',
                        action: 'block',
                        days: 7,
                        notifyUser: true
                    }
                ]
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(state.tables.blocked_users.length, 1);
        assert.equal(state.tables.block_history.length, 1);
        assert.equal(state.notifications.length, 1);
        assert.equal(state.auditEntries[0]?.actionType, 'BAN_USER');
    });
});

test('users blocks handler clear_all removes every block row for the selected users', async () => {
    await withUsersBlocksHandler({
        tables: {
            profiles: [{ id: 'user_1', email: 'user1@example.com' }],
            blocked_users: [
                { user_id: 'user_1', scope: 'gallery', reason: '画廊违规', expires_at: null },
                { user_id: 'user_1', scope: 'points_usage', reason: '积分风控', expires_at: null }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'clear_all',
                userIds: ['user_1']
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(state.tables.blocked_users.length, 0);
        assert.equal(state.tables.block_history.length, 2);
        assert.equal(state.auditEntries[0]?.actionType, 'UNBAN_USER');
    });
});
