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
            discount_codes: clone(options?.tables?.discount_codes || []),
            discount_user_assets: clone(options?.tables?.discount_user_assets || []),
            discount_event_logs: clone(options?.tables?.discount_event_logs || []),
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

test('users manage handler imports user tags by email for engagement segmentation', async () => {
    await withUsersManageHandler({
        tables: {
            profiles: [
                { id: 'user_1', email: 'buyer@example.com', username: 'buyer' },
                { id: 'user_2', email: 'vip@example.com', username: 'vip' }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'import_tags_by_email',
                tag: 'paid_user',
                importText: [
                    'buyer@example.com',
                    'vip@example.com, high_value',
                    'missing@example.com'
                ].join('\n')
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().matched, 2);
        assert.deepEqual(res.json().missing, ['missing@example.com']);
        assert.deepEqual(
            state.tables.user_tags.map((row) => ({ user_id: row.user_id, tag: row.tag })),
            [
                { user_id: 'user_1', tag: 'paid_user' },
                { user_id: 'user_2', tag: 'high_value' }
            ]
        );
        assert.equal(state.auditEntries[0]?.actionType, 'import_tag_by_email');
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

test('users manage handler can revoke an available user discount asset and write audit', async () => {
    await withUsersManageHandler({
        tables: {
            profiles: [
                { id: 'user_1', email: 'user1@example.com', username: 'user1' }
            ],
            discount_codes: [
                {
                    id: 'discount_1',
                    code: 'VIP9',
                    applicable_site: 'cn',
                    discount_type: 'percent',
                    discount_value: 90,
                    distribution_mode: 'targeted_push',
                    pricing_apply_stage: 'order_discount',
                    is_exclusive: false,
                    stack_priority: 30,
                    expires_at: '2026-05-01T00:00:00.000Z'
                }
            ],
            discount_user_assets: [
                {
                    id: 'asset_1',
                    discount_id: 'discount_1',
                    user_id: 'user_1',
                    asset_status: 'available',
                    assigned_at: '2026-04-16T09:00:00.000Z',
                    claimed_at: '2026-04-16T09:01:00.000Z',
                    expires_at: '2026-05-01T00:00:00.000Z',
                    source_type: 'admin_assign',
                    source_channel: 'vip_recall',
                    audience_segment: 'vip',
                    created_at: '2026-04-16T09:00:00.000Z',
                    updated_at: '2026-04-16T09:00:00.000Z'
                }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'revoke_discount_asset',
                userId: 'user_1',
                assetId: 'asset_1'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(state.tables.discount_user_assets[0]?.asset_status, 'revoked');
        assert.equal(res.json().asset?.benefit_label, '9折');
        assert.equal(state.auditEntries[0]?.actionType, 'remove_user_discount_asset');
        assert.equal(state.auditEntries[0]?.details?.asset_id, 'asset_1');
        assert.equal(state.auditEntries[0]?.details?.asset_status_before, 'available');
        assert.equal(state.auditEntries[0]?.details?.asset_status_after, 'revoked');
    });
});

test('users manage handler allows revoking discount assets for locked super-admin accounts', async () => {
    await withUsersManageHandler({
        tables: {
            profiles: [
                { id: 'user_1', email: 'zaoyoe@gmail.com', username: 'root' }
            ],
            discount_codes: [
                {
                    id: 'discount_1',
                    code: 'VIP9',
                    applicable_site: 'cn',
                    discount_type: 'percent',
                    discount_value: 90,
                    distribution_mode: 'targeted_push',
                    pricing_apply_stage: 'order_discount',
                    is_exclusive: false,
                    stack_priority: 30,
                    expires_at: '2026-05-01T00:00:00.000Z'
                }
            ],
            discount_user_assets: [
                {
                    id: 'asset_1',
                    discount_id: 'discount_1',
                    user_id: 'user_1',
                    asset_status: 'available',
                    assigned_at: '2026-04-16T09:00:00.000Z',
                    claimed_at: '2026-04-16T09:01:00.000Z',
                    expires_at: '2026-05-01T00:00:00.000Z',
                    source_type: 'admin_assign',
                    source_channel: 'vip_recall',
                    audience_segment: 'vip',
                    created_at: '2026-04-16T09:00:00.000Z',
                    updated_at: '2026-04-16T09:00:00.000Z'
                }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'revoke_discount_asset',
                userId: 'user_1',
                assetId: 'asset_1'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(state.tables.discount_user_assets[0]?.asset_status, 'revoked');
        assert.equal(state.auditEntries[0]?.actionType, 'remove_user_discount_asset');
    });
});

test('users manage handler treats revoked coupons without admin audit as user-removed', async () => {
    await withUsersManageHandler({
        tables: {
            profiles: [
                { id: 'user_1', email: 'user1@example.com', username: 'user1' }
            ],
            discount_codes: [
                {
                    id: 'discount_wallet_removed',
                    code: 'WQXXIVPQ',
                    applicable_site: 'cn',
                    discount_type: 'percent',
                    discount_value: 90,
                    distribution_mode: 'public_claim',
                    pricing_apply_stage: 'order_discount',
                    is_exclusive: true,
                    stack_priority: 100
                }
            ],
            discount_user_assets: [
                {
                    id: 'asset_wallet_removed',
                    discount_id: 'discount_wallet_removed',
                    user_id: 'user_1',
                    asset_status: 'revoked',
                    assigned_at: '2026-04-15T15:44:00.000Z',
                    claimed_at: '2026-04-15T15:44:00.000Z',
                    source_type: 'public_claim',
                    source_channel: 'claim_center',
                    audience_segment: 'public_claim',
                    created_at: '2026-04-15T15:44:00.000Z',
                    updated_at: '2026-04-16T20:20:00.000Z'
                }
            ]
        }
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'list_discount_assets',
                userId: 'user_1'
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.assets.length, 1);
        assert.equal(payload.assets[0]?.asset_status, 'revoked');
        assert.equal(payload.assets[0]?.removal_origin, 'user');
        assert.equal(payload.assets[0]?.removal_origin_label, '用户删除');
    });
});

test('users manage handler keeps admin-removed coupons marked as backend removal', async () => {
    await withUsersManageHandler({
        tables: {
            profiles: [
                { id: 'user_1', email: 'user1@example.com', username: 'user1' }
            ],
            discount_codes: [
                {
                    id: 'discount_admin_removed',
                    code: 'CZ187YE8',
                    applicable_site: 'cn',
                    discount_type: 'percent',
                    discount_value: 90,
                    distribution_mode: 'public_claim',
                    pricing_apply_stage: 'order_discount',
                    is_exclusive: true,
                    stack_priority: 100
                }
            ],
            discount_user_assets: [
                {
                    id: 'asset_admin_removed',
                    discount_id: 'discount_admin_removed',
                    user_id: 'user_1',
                    asset_status: 'revoked',
                    assigned_at: '2026-04-15T15:44:00.000Z',
                    claimed_at: '2026-04-15T15:44:00.000Z',
                    source_type: 'public_claim',
                    source_channel: 'claim_center',
                    audience_segment: 'public_claim',
                    created_at: '2026-04-15T15:44:00.000Z',
                    updated_at: '2026-04-16T20:20:00.000Z'
                }
            ],
            admin_audit_logs: [
                {
                    id: 'audit_remove_1',
                    target_user_id: 'user_1',
                    action_type: 'remove_user_discount_asset',
                    details: {
                        asset_id: 'asset_admin_removed'
                    },
                    created_at: '2026-04-16T20:20:00.000Z'
                }
            ]
        }
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'list_discount_assets',
                userId: 'user_1'
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.assets.length, 1);
        assert.equal(payload.assets[0]?.asset_status, 'revoked');
        assert.equal(payload.assets[0]?.removal_origin, 'admin');
        assert.equal(payload.assets[0]?.removal_origin_label, '后台删除');
    });
});

test('users manage handler can restore a revoked user discount asset and write audit', async () => {
    await withUsersManageHandler({
        tables: {
            profiles: [
                { id: 'user_1', email: 'user1@example.com', username: 'user1' }
            ],
            discount_codes: [
                {
                    id: 'discount_1',
                    code: 'VIP9',
                    applicable_site: 'cn',
                    discount_type: 'percent',
                    discount_value: 90,
                    distribution_mode: 'targeted_push',
                    pricing_apply_stage: 'order_discount',
                    is_exclusive: false,
                    stack_priority: 30,
                    expires_at: '2026-05-01T00:00:00.000Z'
                }
            ],
            discount_user_assets: [
                {
                    id: 'asset_1',
                    discount_id: 'discount_1',
                    user_id: 'user_1',
                    asset_status: 'revoked',
                    assigned_at: '2026-04-16T09:00:00.000Z',
                    claimed_at: '2026-04-16T09:01:00.000Z',
                    expires_at: '2026-05-01T00:00:00.000Z',
                    source_type: 'admin_assign',
                    source_channel: 'vip_recall',
                    audience_segment: 'vip',
                    created_at: '2026-04-16T09:00:00.000Z',
                    updated_at: '2026-04-16T10:00:00.000Z'
                }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'restore_discount_asset',
                userId: 'user_1',
                assetId: 'asset_1'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(state.tables.discount_user_assets[0]?.asset_status, 'available');
        assert.ok(state.tables.discount_user_assets[0]?.restored_at);
        assert.equal(res.json().asset?.can_remove, true);
        assert.equal(state.auditEntries[0]?.actionType, 'restore_user_discount_asset');
        assert.equal(state.auditEntries[0]?.details?.asset_status_before, 'revoked');
        assert.equal(state.auditEntries[0]?.details?.asset_status_after, 'available');
    });
});

test('users manage handler rejects restoring a non-revoked discount asset', async () => {
    await withUsersManageHandler({
        tables: {
            profiles: [
                { id: 'user_1', email: 'user1@example.com', username: 'user1' }
            ],
            discount_codes: [
                {
                    id: 'discount_1',
                    code: 'SAVE5',
                    discount_type: 'fixed',
                    discount_value: 5
                }
            ],
            discount_user_assets: [
                {
                    id: 'asset_1',
                    discount_id: 'discount_1',
                    user_id: 'user_1',
                    asset_status: 'available',
                    assigned_at: '2026-04-16T09:00:00.000Z',
                    created_at: '2026-04-16T09:00:00.000Z',
                    updated_at: '2026-04-16T10:00:00.000Z'
                }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'restore_discount_asset',
                userId: 'user_1',
                assetId: 'asset_1'
            }
        }, res);

        assert.equal(res.statusCode, 409);
        assert.equal(res.json().success, false);
        assert.equal(state.tables.discount_user_assets[0]?.asset_status, 'available');
        assert.equal(state.auditEntries.length, 0);
    });
});

test('users manage handler rejects removing a used discount asset', async () => {
    await withUsersManageHandler({
        tables: {
            profiles: [
                { id: 'user_1', email: 'user1@example.com', username: 'user1' }
            ],
            discount_codes: [
                {
                    id: 'discount_1',
                    code: 'SAVE5',
                    discount_type: 'fixed',
                    discount_value: 5
                }
            ],
            discount_user_assets: [
                {
                    id: 'asset_1',
                    discount_id: 'discount_1',
                    user_id: 'user_1',
                    asset_status: 'used',
                    assigned_at: '2026-04-16T09:00:00.000Z',
                    created_at: '2026-04-16T09:00:00.000Z',
                    updated_at: '2026-04-16T10:00:00.000Z'
                }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'revoke_discount_asset',
                userId: 'user_1',
                assetId: 'asset_1'
            }
        }, res);

        assert.equal(res.statusCode, 409);
        assert.equal(res.json().success, false);
        assert.equal(state.tables.discount_user_assets[0]?.asset_status, 'used');
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
