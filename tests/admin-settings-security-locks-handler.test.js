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

        if (filter.kind === 'gt') {
            return Date.parse(row?.[filter.field] || 0) > Date.parse(filter.value || 0);
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
        const query = {
            _orderField: '',
            _ascending: true,
            eq(field, value) {
                filters.push({ kind: 'eq', field, value });
                return this;
            },
            in(field, values) {
                filters.push({ kind: 'in', field, values });
                return this;
            },
            gt(field, value) {
                filters.push({ kind: 'gt', field, value });
                return this;
            },
            order(field, options = {}) {
                query._orderField = field;
                query._ascending = options.ascending !== false;
                return this;
            },
            then(resolve, reject) {
                try {
                    let rows = clone(applyFilters(getTable(table), filters));
                    if (query._orderField) {
                        rows = rows.sort((left, right) => {
                            const leftValue = Date.parse(left?.[query._orderField] || 0);
                            const rightValue = Date.parse(right?.[query._orderField] || 0);
                            return query._ascending ? leftValue - rightValue : rightValue - leftValue;
                        });
                    }
                    resolve({ data: rows, error: null });
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

    function buildUpdateQuery(table, payload, filters = []) {
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
                    state.tables[table] = getTable(table).map((row) => (
                        applyFilters([row], filters).length
                            ? { ...row, ...clone(payload) }
                            : row
                    ));
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
                update(payload) {
                    return buildUpdateQuery(table, payload, []);
                }
            };
        }
    };
}

async function withSecurityLocksHandler(options, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/settings/security-locks.js');
    const originalLoad = Module._load;
    const state = {
        auditEntries: [],
        requireAdminCalls: [],
        tables: {
            profiles: clone(options?.tables?.profiles || []),
            admin_users_view: clone(options?.tables?.admin_users_view || [])
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
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                },
                async writeAdminAuditLog(entry) {
                    state.auditEntries.push(clone(entry));
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

test('security locks handler GET returns locked accounts with email fallbacks', async () => {
    await withSecurityLocksHandler({
        tables: {
            profiles: [
                {
                    id: 'user_1',
                    username: 'alice',
                    failed_login_attempts: 5,
                    locked_until: '2099-01-01T00:00:00.000Z'
                },
                {
                    id: 'user_2',
                    username: 'bob',
                    failed_login_attempts: 3,
                    locked_until: '2099-01-02T00:00:00.000Z'
                }
            ],
            admin_users_view: [
                { id: 'user_1', email: 'alice@example.com' }
            ]
        }
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            headers: {}
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().count, 2);
        assert.equal(res.json().accounts[0].email, 'bob');
        assert.equal(res.json().accounts[1].email, 'alice@example.com');
    });
});

test('security locks handler unlocks one account and writes audit', async () => {
    await withSecurityLocksHandler({
        tables: {
            profiles: [
                {
                    id: 'user_1',
                    username: 'alice',
                    failed_login_attempts: 5,
                    locked_until: '2099-01-01T00:00:00.000Z'
                }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'unlock_one',
                userId: 'user_1'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(state.tables.profiles[0].failed_login_attempts, 0);
        assert.equal(state.tables.profiles[0].locked_until, null);
        assert.equal(state.auditEntries[0]?.actionType, 'security.unlock_account');
    });
});

test('security locks handler unlocks all locked accounts and reports count', async () => {
    await withSecurityLocksHandler({
        tables: {
            profiles: [
                {
                    id: 'user_1',
                    username: 'alice',
                    failed_login_attempts: 5,
                    locked_until: '2099-01-01T00:00:00.000Z'
                },
                {
                    id: 'user_2',
                    username: 'bob',
                    failed_login_attempts: 1,
                    locked_until: null
                },
                {
                    id: 'user_3',
                    username: 'carol',
                    failed_login_attempts: 4,
                    locked_until: '2099-01-03T00:00:00.000Z'
                }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'unlock_all'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().unlockedCount, 2);
        assert.equal(state.tables.profiles[0].locked_until, null);
        assert.equal(state.tables.profiles[2].locked_until, null);
        assert.equal(state.auditEntries[0]?.actionType, 'security.unlock_all_accounts');
    });
});
