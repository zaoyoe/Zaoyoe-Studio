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
            order() {
                return this;
            },
            async maybeSingle() {
                const rows = applyFilters(getTable(table), filters);
                return {
                    data: rows.length ? clone(rows[0]) : null,
                    error: null
                };
            },
            async single() {
                const rows = applyFilters(getTable(table), filters);
                if (!rows.length) {
                    return {
                        data: null,
                        error: { code: 'PGRST116', message: 'not found' }
                    };
                }

                return {
                    data: clone(rows[0]),
                    error: null
                };
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

    function buildUpdateQuery(table, payload, filters = []) {
        return {
            eq(field, value) {
                filters.push({ kind: 'eq', field, value });
                return this;
            },
            then(resolve, reject) {
                try {
                    state.tables[table] = getTable(table).map((row) => (
                        applyFilters([row], filters).length
                            ? (() => {
                                const nextRow = { ...row, ...clone(payload) };
                                if (table === 'points_balance') {
                                    nextRow.total_balance = Number(nextRow.paid_balance || 0) + Number(nextRow.bonus_balance || 0);
                                }
                                return nextRow;
                            })()
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
                upsert(payload, options = {}) {
                    const rows = getTable(table);
                    const items = Array.isArray(payload) ? payload : [payload];
                    const conflictFields = String(options?.onConflict || '').split(',').map((item) => item.trim()).filter(Boolean);

                    items.forEach((item) => {
                        const cloned = clone(item);
                        const existingIndex = rows.findIndex((row) => (
                            conflictFields.length
                                ? conflictFields.every((field) => normalizeComparableValue(row?.[field]) === normalizeComparableValue(cloned?.[field]))
                                : false
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
                },
                update(payload) {
                    return buildUpdateQuery(table, payload, []);
                }
            };
        },
        async rpc(fn, args) {
            state.rpcCalls.push({ fn, args: clone(args) });

            if (fn === 'fn_add_points') {
                return {
                    data: {
                        success: true,
                        added: Number(args?.p_amount || 0),
                        new_total: 150
                    },
                    error: null
                };
            }

            if (fn === 'fn_deduct_points_admin_site') {
                return {
                    data: {
                        success: true,
                        deducted: Number(args?.p_amount || 0),
                        new_total: 20
                    },
                    error: null
                };
            }

            if (fn === 'fn_admin_clear_user_data') {
                return {
                    data: {
                        success: true
                    },
                    error: null
                };
            }

            throw new Error(`Unexpected rpc: ${fn}`);
        }
    };
}

async function withUsersManageHandler(options, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/users/manage.js');
    const originalLoad = Module._load;
    const state = {
        auditEntries: [],
        notifications: [],
        requireAdminCalls: [],
        rpcCalls: [],
        tables: {
            profiles: clone(options?.tables?.profiles || []),
            admin_roles: clone(options?.tables?.admin_roles || []),
            user_purchase_entitlements: clone(options?.tables?.user_purchase_entitlements || []),
            user_tags: clone(options?.tables?.user_tags || []),
            admin_notes: clone(options?.tables?.admin_notes || []),
            user_points: clone(options?.tables?.user_points || []),
            points_balance: clone(options?.tables?.points_balance || []),
            prompt_comments: clone(options?.tables?.prompt_comments || []),
            prompt_unlocks: clone(options?.tables?.prompt_unlocks || []),
            guestbook_messages: clone(options?.tables?.guestbook_messages || []),
            guestbook_comments: clone(options?.tables?.guestbook_comments || []),
            points_ledger: clone(options?.tables?.points_ledger || []),
            block_history: clone(options?.tables?.block_history || []),
            admin_audit_logs: clone(options?.tables?.admin_audit_logs || [])
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
                        user: {
                            id: 'admin_1',
                            email: 'admin@example.com'
                        }
                    };
                },
                async parseJsonBody(req) {
                    return req.body || {};
                },
                normalizeAdminSite(value, { defaultValue = 'all' } = {}) {
                    return String(value || '').trim().toLowerCase() || defaultValue;
                },
                normalizeAdminPermissionList: adminLib.normalizeAdminPermissionList,
                requireWritableAdminSite(value) {
                    const normalized = String(value || '').trim().toLowerCase();
                    if (!normalized || normalized === 'all') {
                        const error = new Error('Writable admin site must be cn or intl');
                        error.statusCode = 400;
                        throw error;
                    }
                    return normalized;
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

test('users manage handler grants admin roles through the server-side route', async () => {
    await withUsersManageHandler({
        tables: {
            profiles: [
                { id: 'user_1', email: 'user1@example.com', username: 'user1' }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'grant_admin',
                userId: 'user_1',
                permissions: ['users.manage', 'content.moderate'],
                unlimitedShopPurchases: true
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.deepEqual(state.requireAdminCalls[0]?.config, { permission: 'users.manage' });
        assert.equal(state.tables.admin_roles.length, 1);
        assert.deepEqual(state.tables.admin_roles[0].permissions, ['users.manage', 'content.moderate']);
        assert.equal(state.tables.user_purchase_entitlements.length, 1);
        assert.equal(state.auditEntries[0]?.actionType, 'grant_admin');
    });
});

test('users manage handler adjusts points through hardened RPCs and server notifications', async () => {
    await withUsersManageHandler({
        tables: {
            profiles: [
                { id: 'user_1', email: 'user1@example.com', username: 'user1' }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'adjust_points',
                userId: 'user_1',
                amount: 25,
                reason: '补偿发放',
                site: 'cn'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().results[0].new_total, 150);
        assert.equal(state.rpcCalls[0]?.fn, 'fn_add_points');
        assert.equal(state.rpcCalls[0]?.args?.p_site, 'cn');
        assert.equal(state.notifications.length, 1);
        assert.equal(state.notifications[0]?.scope, 'user_personal');
        assert.equal(state.auditEntries[0]?.actionType, 'UPDATE_POINT');
    });
});

test('users manage handler blocks edits to locked super-admin accounts', async () => {
    await withUsersManageHandler({
        tables: {
            profiles: [
                { id: 'user_1', email: 'zaoyoe@gmail.com', username: 'root' }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'revoke_admin',
                userId: 'user_1'
            }
        }, res);

        assert.equal(res.statusCode, 403);
        assert.match(res.json().message, /内置超管账号不能在用户后台中修改/);
        assert.equal(state.tables.admin_roles.length, 0);
        assert.equal(state.auditEntries.length, 0);
    });
});

test('users manage handler clears remaining points without calling the legacy clear-data rpc', async () => {
    await withUsersManageHandler({
        tables: {
            profiles: [
                { id: 'user_1', email: 'user1@example.com', username: 'user1' }
            ],
            user_points: [
                { user_id: 'user_1', balance: 88, total_earned: 120 }
            ],
            points_balance: [
                { user_id: 'user_1', site: 'cn', paid_balance: 55, bonus_balance: 33, total_balance: 88 },
                { user_id: 'user_1', site: 'intl', paid_balance: 20, bonus_balance: 5, total_balance: 25 }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'clear_content',
                userId: 'user_1',
                resetPoints: true
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.json().clearedItems, ['剩余积分(重置为0)']);
        assert.equal(state.tables.user_points[0]?.balance, 0);
        assert.equal(state.tables.user_points[0]?.total_earned, 0);
        assert.equal(state.tables.points_balance[0]?.paid_balance, 0);
        assert.equal(state.tables.points_balance[0]?.bonus_balance, 0);
        assert.equal(state.tables.points_balance[0]?.total_balance, 0);
        assert.equal(state.tables.points_balance[1]?.paid_balance, 0);
        assert.equal(state.tables.points_balance[1]?.bonus_balance, 0);
        assert.equal(state.tables.points_balance[1]?.total_balance, 0);
        assert.equal(state.rpcCalls.some((entry) => entry.fn === 'fn_admin_clear_user_data'), false);
        assert.equal(state.auditEntries[0]?.actionType, 'CLEAR_CONTENT');
    });
});

test('users manage handler clears prompt unlock purchases through direct table deletes', async () => {
    await withUsersManageHandler({
        tables: {
            profiles: [
                { id: 'user_1', email: 'user1@example.com', username: 'user1' }
            ],
            prompt_unlocks: [
                { user_id: 'user_1', prompt_id: 'prompt_1', site: 'cn' },
                { user_id: 'user_1', prompt_id: 'prompt_2', site: 'intl' },
                { user_id: 'user_2', prompt_id: 'prompt_3', site: 'cn' }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'clear_content',
                userId: 'user_1',
                purchases: true
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.json().clearedItems, ['购买记录(已收回)']);
        assert.equal(state.tables.prompt_unlocks.length, 1);
        assert.equal(state.tables.prompt_unlocks[0]?.user_id, 'user_2');
        assert.equal(state.rpcCalls.some((entry) => entry.fn === 'fn_admin_clear_user_data'), false);
        assert.equal(state.auditEntries[0]?.actionType, 'CLEAR_CONTENT');
    });
});
