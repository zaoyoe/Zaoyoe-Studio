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
    return JSON.parse(JSON.stringify(value));
}

function normalizeComparableValue(value) {
    return value == null ? '' : String(value);
}

function applyFilters(rows, filters = []) {
    return rows.filter((row) => filters.every((filter) => {
        if (!filter) return true;
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

function createSupabaseDouble(state, options = {}) {
    const clientLabel = String(options?.label || 'default');

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
                    const rows = getTable(table);
                    const nextRows = rows.map((row) => (
                        applyFilters([row], filters).length
                            ? { ...row, ...clone(payload) }
                            : row
                    ));
                    state.tables[table] = nextRows;
                    resolve({
                        data: null,
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
                    const rows = getTable(table);
                    state.tables[table] = rows.filter((row) => !applyFilters([row], filters).length);
                    resolve({
                        data: null,
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

    function buildInsertQuery(table, payload) {
        return {
            then(resolve, reject) {
                try {
                    const rows = getTable(table);
                    const items = Array.isArray(payload) ? payload : [payload];
                    state.tables[table] = [
                        ...rows,
                        ...items.map((item) => clone(item))
                    ];
                    resolve({
                        data: Array.isArray(payload) ? clone(items) : clone(items[0]),
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

    return {
        from(table) {
            return {
                select() {
                    return buildSelectQuery(table, []);
                },
                insert(payload) {
                    return buildInsertQuery(table, payload);
                },
                update(payload) {
                    return buildUpdateQuery(table, payload, []);
                },
                delete() {
                    return buildDeleteQuery(table, []);
                }
            };
        },
        async rpc(fn, args) {
            state.rpcCalls.push({ client: clientLabel, fn, args: clone(args) });

            if (fn === 'fn_generate_codes') {
                if (clientLabel === 'admin' && options?.failGenerateOnAdminClient) {
                    return {
                        data: null,
                        error: { message: 'Unauthorized: Admin only' }
                    };
                }
                return {
                    data: [{ code: 'ZY-CN-1001' }, { code: 'ZY-CN-1002' }],
                    error: null
                };
            }

            if (fn === 'fn_generate_custom_codes') {
                if (clientLabel === 'admin' && options?.failGenerateOnAdminClient) {
                    return {
                        data: null,
                        error: { message: 'Unauthorized: Admin only' }
                    };
                }
                return {
                    data: [{ code: 'ZY-CUSTOM-1001' }],
                    error: null
                };
            }

            if (fn === 'fn_revoke_code') {
                if (clientLabel === 'admin' && options?.failRevokeOnAdminClient) {
                    return {
                        data: null,
                        error: { message: 'Unauthorized: Admin only' }
                    };
                }
                return {
                    data: {
                        success: true,
                        points_deducted: 120
                    },
                    error: null
                };
            }

            if (
                fn === 'fn_deduct_points_admin_site_with_breakdown' ||
                fn === 'fn_deduct_points_admin_site' ||
                fn === 'fn_deduct_points'
            ) {
                return {
                    data: {
                        success: true,
                        deducted: Number(args?.p_amount || 0)
                    },
                    error: null
                };
            }

            throw new Error(`Unexpected rpc: ${fn}`);
        }
    };
}

async function withPointsManageHandler(options, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/points/manage.js');
    const originalLoad = Module._load;
    const state = {
        requireAdminCalls: [],
        rpcCalls: [],
        auditEntries: [],
        tables: {
            redemption_batches: clone(options?.tables?.redemption_batches || []),
            redemption_codes: clone(options?.tables?.redemption_codes || []),
            points_packages: clone(options?.tables?.points_packages || [])
        }
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                async requireAdmin(req, config = {}) {
                    state.requireAdminCalls.push({ req, config });
                    const adminSupabase = createSupabaseDouble(state, {
                        label: 'admin',
                        failGenerateOnAdminClient: Boolean(options?.failGenerateOnAdminClient),
                        failRevokeOnAdminClient: Boolean(options?.failRevokeOnAdminClient)
                    });
                    const requestSupabase = createSupabaseDouble(state, {
                        label: 'request'
                    });
                    return {
                        user: { id: 'admin-1' },
                        supabase: adminSupabase,
                        requestSupabase: options?.withRequestSupabase ? requestSupabase : undefined,
                        token: options?.withRequestSupabase ? 'request-token' : ''
                    };
                },
                async parseJsonBody(req) {
                    return req.body || {};
                },
                requireWritableAdminSite: adminLib.requireWritableAdminSite,
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                },
                async writeAdminAuditLog(entry) {
                    state.auditEntries.push(entry);
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

test('points manage handler generates package codes through the site-aware RPC', async () => {
    await withPointsManageHandler({ tables: {} }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'generate_codes',
                site: 'cn',
                batch_name: '四月活动',
                package_id: 'pkg-starter',
                count: 2,
                channel: 'manual'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.deepEqual(state.requireAdminCalls[0]?.config, { permission: 'points.manage' });
        assert.equal(state.rpcCalls[0]?.fn, 'fn_generate_codes');
        assert.equal(state.rpcCalls[0]?.args?.p_site, 'cn');
        assert.deepEqual(res.json().codes, ['ZY-CN-1001', 'ZY-CN-1002']);
        assert.equal(state.auditEntries[0]?.actionType, 'batch.generate');
        assert.equal(state.auditEntries[0]?.site, 'cn');
    });
});

test('points manage handler uses request-scoped client for generate RPC when admin service client would be rejected', async () => {
    await withPointsManageHandler({
        withRequestSupabase: true,
        failGenerateOnAdminClient: true,
        tables: {
            points_packages: [
                { id: 'pkg-starter', name: 'Starter', points_amount: 10, bonus_points: 0 }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'generate_codes',
                site: 'cn',
                batch_name: '四月活动',
                package_id: 'pkg-starter',
                count: 2,
                channel: 'manual'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(state.rpcCalls.some((call) => call.client === 'request' && call.fn === 'fn_generate_codes'), true);
        assert.equal(state.rpcCalls.some((call) => call.client === 'admin' && call.fn === 'fn_generate_codes'), false);
        assert.deepEqual(res.json().codes, ['ZY-CN-1001', 'ZY-CN-1002']);
    });
});

test('points manage handler passes decimal custom point amounts through to the custom code rpc', async () => {
    await withPointsManageHandler({ tables: {} }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'generate_codes',
                site: 'cn',
                batch_name: '小额激活',
                package_id: 'custom',
                custom_points_amount: '0.25',
                count: 1,
                channel: 'manual'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(state.rpcCalls[0]?.fn, 'fn_generate_custom_codes');
        assert.equal(state.rpcCalls[0]?.args?.p_points_amount, 0.25);
    });
});

test('points manage handler falls back to service generate flow when admin RPC is rejected', async () => {
    await withPointsManageHandler({
        failGenerateOnAdminClient: true,
        tables: {
            points_packages: [
                { id: 'pkg-starter', name: 'Starter', points_amount: 10, bonus_points: 5 }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'generate_codes',
                site: 'cn',
                batch_name: '四月活动',
                package_id: 'pkg-starter',
                count: 2,
                channel: 'manual'
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(state.rpcCalls.some((call) => call.client === 'admin' && call.fn === 'fn_generate_codes'), true);
        assert.equal(state.tables.redemption_batches.length, 1);
        assert.equal(state.tables.redemption_codes.length, 2);
        assert.equal(state.tables.redemption_batches[0]?.package_id, 'pkg-starter');
        assert.equal(state.tables.redemption_batches[0]?.site, 'cn');
        assert.equal(state.tables.redemption_batches[0]?.total_count, 2);
        assert.equal(state.tables.redemption_codes.every((row) => row.site === 'cn' && row.package_id === 'pkg-starter'), true);
        assert.equal(state.tables.redemption_codes.every((row) => row.points_amount === 15), true);
        assert.equal(payload.codes.length, 2);
        assert.equal(payload.codes.every((code) => /^ZY-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/.test(code)), true);
        assert.equal(state.auditEntries[0]?.actionType, 'batch.generate');
    });
});

test('points manage handler updates batches and code status within the selected site', async () => {
    await withPointsManageHandler({
        tables: {
            redemption_batches: [
                { id: 'batch-cn-1', site: 'cn', name: '旧批次', notes: null, expires_at: null }
            ],
            redemption_codes: [
                { id: 'code-cn-1', code: 'ZY-CN-1', site: 'cn', batch_id: 'batch-cn-1', status: 'pending', expires_at: null }
            ]
        }
    }, async ({ handler, state }) => {
        const updateRes = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'update_batch',
                site: 'cn',
                batch_id: 'batch-cn-1',
                name: '新批次名',
                notes: 'smoke note',
                expires_at: '2026-04-10T00:00:00.000Z'
            }
        }, updateRes);

        assert.equal(updateRes.statusCode, 200);
        assert.equal(state.tables.redemption_batches[0]?.name, '新批次名');
        assert.equal(state.auditEntries[0]?.actionType, 'batch.update');

        const statusRes = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'set_code_status',
                site: 'cn',
                code: 'ZY-CN-1',
                status: 'disabled'
            }
        }, statusRes);

        assert.equal(statusRes.statusCode, 200);
        assert.equal(state.tables.redemption_codes[0]?.status, 'disabled');
        assert.equal(state.auditEntries[1]?.actionType, 'code.disable');
    });
});

test('points manage handler deletes scoped batches and revokes used codes before removal', async () => {
    await withPointsManageHandler({
        tables: {
            redemption_batches: [
                { id: 'batch-cn-1', site: 'cn', name: 'CN Batch' },
                { id: 'batch-intl-1', site: 'intl', name: 'INTL Batch' }
            ],
            redemption_codes: [
                { id: 'code-cn-used', code: 'ZY-CN-USED', site: 'cn', batch_id: 'batch-cn-1', status: 'used', used_by: 'user-cn-1', points_granted: 120 },
                { id: 'code-cn-pending', code: 'ZY-CN-PENDING', site: 'cn', batch_id: 'batch-cn-1', status: 'pending' },
                { id: 'code-intl-used', code: 'ZY-INTL-USED', site: 'intl', batch_id: 'batch-intl-1', status: 'used' }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'delete_batches',
                site: 'cn',
                batch_ids: ['batch-cn-1'],
                delete_mode: 'revoke'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(state.rpcCalls.some((call) => call.fn.startsWith('fn_deduct_points') && call.args?.p_target_user_id === 'user-cn-1'), true);
        assert.equal(
            state.rpcCalls.find((call) => call.fn.startsWith('fn_deduct_points'))?.args?.p_reason,
            '兑换码批次删除扣回: 批次删除-自动撤销（ZY-CN-USED）'
        );
        assert.equal(state.tables.redemption_batches.some((row) => row.id === 'batch-cn-1'), false);
        assert.equal(state.tables.redemption_batches.some((row) => row.id === 'batch-intl-1'), true);
        assert.equal(state.tables.redemption_codes.some((row) => row.batch_id === 'batch-cn-1'), false);
        assert.equal(state.tables.redemption_codes.some((row) => row.batch_id === 'batch-intl-1'), true);
        assert.equal(state.auditEntries[0]?.actionType, 'batch.delete');
    });
});

test('points manage handler invalidates pending codes and can update code expiry', async () => {
    await withPointsManageHandler({
        tables: {
            redemption_batches: [
                { id: 'batch-cn-1', site: 'cn', name: 'CN Batch' }
            ],
            redemption_codes: [
                { id: 'code-cn-1', code: 'ZY-CN-1', site: 'cn', batch_id: 'batch-cn-1', status: 'pending', expires_at: null },
                { id: 'code-cn-2', code: 'ZY-CN-2', site: 'cn', batch_id: 'batch-cn-1', status: 'used', expires_at: null }
            ]
        }
    }, async ({ handler, state }) => {
        const invalidateRes = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'invalidate_batches',
                site: 'cn',
                batch_ids: ['batch-cn-1']
            }
        }, invalidateRes);

        assert.equal(invalidateRes.statusCode, 200);
        assert.equal(state.tables.redemption_codes.find((row) => row.id === 'code-cn-1')?.status, 'disabled');
        assert.equal(state.tables.redemption_codes.find((row) => row.id === 'code-cn-2')?.status, 'used');

        const expiryRes = createMockResponse();
        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'set_code_expiry',
                site: 'cn',
                code: 'ZY-CN-2',
                expires_at: '2026-04-15T23:59:59.999Z'
            }
        }, expiryRes);

        assert.equal(expiryRes.statusCode, 200);
        assert.equal(state.tables.redemption_codes.find((row) => row.id === 'code-cn-2')?.expires_at, '2026-04-15T23:59:59.999Z');
        assert.equal(state.auditEntries.some((entry) => entry.actionType === 'code.expiry.update'), true);
    });
});

test('points manage handler uses service revoke flow so ledger keeps the admin reason', async () => {
    await withPointsManageHandler({
        withRequestSupabase: true,
        failRevokeOnAdminClient: true,
        tables: {
            redemption_batches: [
                { id: 'batch-cn-1', site: 'cn', name: 'CN Batch' }
            ],
            redemption_codes: [
                { id: 'code-cn-used', code: 'ZY-CN-USED', site: 'cn', batch_id: 'batch-cn-1', status: 'used', used_by: 'user-cn-1', points_granted: 120 }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'revoke_code',
                site: 'cn',
                code: 'ZY-CN-USED',
                reason: '客户退款'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(state.rpcCalls.some((call) => call.fn === 'fn_revoke_code'), false);
        assert.equal(
            state.rpcCalls.find((call) => call.fn.startsWith('fn_deduct_points'))?.args?.p_reason,
            '兑换码撤销扣回: 客户退款（ZY-CN-USED）'
        );
        assert.equal(state.tables.redemption_codes.find((row) => row.id === 'code-cn-used')?.revoke_reason, '客户退款');
        assert.equal(state.auditEntries.some((entry) => entry.actionType === 'code.revoke'), true);
    });
});

test('points manage handler falls back to service revoke flow when no request token is available', async () => {
    await withPointsManageHandler({
        tables: {
            redemption_batches: [
                { id: 'batch-cn-1', site: 'cn', name: 'CN Batch' }
            ],
            redemption_codes: [
                { id: 'code-cn-used', code: 'ZY-CN-USED', site: 'cn', batch_id: 'batch-cn-1', status: 'used', used_by: 'user-cn-1', points_granted: 120 }
            ]
        }
    }, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'revoke_code',
                site: 'cn',
                code: 'ZY-CN-USED',
                reason: '管理员撤销'
            }
        }, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.json().success, true);
        assert.equal(state.rpcCalls.some((call) => call.fn === 'fn_revoke_code'), false);
        assert.equal(state.rpcCalls.some((call) => call.fn.startsWith('fn_deduct_points') && call.args?.p_target_user_id === 'user-cn-1' && call.args?.p_amount === 120), true);
        assert.equal(
            state.rpcCalls.find((call) => call.fn.startsWith('fn_deduct_points'))?.args?.p_reason,
            '兑换码撤销扣回: 管理员撤销（ZY-CN-USED）'
        );
        assert.equal(state.tables.redemption_codes.find((row) => row.id === 'code-cn-used')?.status, 'revoked');
        assert.equal(state.tables.redemption_codes.find((row) => row.id === 'code-cn-used')?.revoke_reason, '管理员撤销');
        assert.equal(state.auditEntries.some((entry) => entry.actionType === 'code.revoke'), true);
    });
});

test('points manage handler rejects all-site writes', async () => {
    await withPointsManageHandler({
        tables: {
            redemption_batches: [
                { id: 'batch-cn-1', site: 'cn', name: 'CN Batch' }
            ]
        }
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                action: 'update_batch',
                site: 'all',
                batch_id: 'batch-cn-1',
                name: 'should fail'
            }
        }, res);

        assert.equal(res.statusCode, 400);
        assert.equal(res.json().message, 'Writable admin site must be cn or intl; received all');
    });
});
