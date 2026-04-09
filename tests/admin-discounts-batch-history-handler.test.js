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

function createQueryBuilder(executor) {
    const state = {
        mode: 'select',
        filters: [],
        payload: null,
        order: null,
        limit: null
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
        eq(column, value) {
            state.filters.push({ op: 'eq', column, value });
            return builder;
        },
        order(column, options = {}) {
            state.order = {
                column,
                ascending: options.ascending !== false
            };
            return builder;
        },
        limit(value) {
            state.limit = value;
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

function applyFilters(rows, filters = []) {
    return rows.filter((row) => filters.every((filter) => {
        if (filter.op === 'eq') {
            return row[filter.column] === filter.value;
        }
        return true;
    }));
}

function cloneRow(row) {
    return JSON.parse(JSON.stringify(row));
}

function createSupabaseStub(state) {
    state.auditRows = Array.isArray(state.auditRows) ? state.auditRows : [];

    return {
        from(table) {
            if (!['admin_audit_logs_view', 'admin_audit_logs'].includes(table)) {
                throw new Error(`Unexpected table request: ${table}`);
            }

            return createQueryBuilder((query) => {
                if (query.mode === 'insert') {
                    state.auditRows.unshift({
                        id: `audit_${state.auditRows.length + 1}`,
                        created_at: '2026-04-08T10:00:00.000Z',
                        ...cloneRow(query.payload)
                    });
                    return { data: null, error: null };
                }

                let rows = applyFilters(state.auditRows.slice().map(cloneRow), query.filters);
                if (query.order?.column) {
                    rows.sort((left, right) => {
                        const leftValue = Date.parse(left[query.order.column] || '') || 0;
                        const rightValue = Date.parse(right[query.order.column] || '') || 0;
                        return query.order.ascending ? leftValue - rightValue : rightValue - leftValue;
                    });
                }
                if (Number.isFinite(Number(query.limit))) {
                    rows = rows.slice(0, Number(query.limit));
                }
                return { data: rows, error: null };
            });
        }
    };
}

async function withBatchHistoryHandler(initialState, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/discounts/batch-history.js');
    const originalLoad = Module._load;
    const state = {
        auditCalls: [],
        requireAdminCalls: [],
        ...initialState
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                normalizeAdminSite: adminLib.normalizeAdminSite,
                async requireAdmin(req, options = {}) {
                    state.requireAdminCalls.push({ req, options });
                    return {
                        supabase: createSupabaseStub(state),
                        user: { id: 'admin_1', email: 'ops@example.com' }
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

test('discount batch history handler records a batch restore run summary', async () => {
    await withBatchHistoryHandler({}, async ({ handler, state }) => {
        const res = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                batch_run_id: 'run_1',
                operation_source: 'risk_restore_batch_modal',
                generated_at: '2026-04-08T10:00:00.000Z',
                site: 'cn',
                status_filter: 'inactive',
                search_filter: 'flash',
                resolution: '已批量复核，确认可恢复。',
                should_resolve_cases: true,
                total_candidate_count: 5,
                total_attempted_count: 3,
                truncated_count: 2,
                restored: [{ id: 'd1', code: 'FLASH0' }],
                failed: [{ id: 'd2', code: 'FLASH1', message: 'Conflict' }]
            }
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(state.auditCalls.length, 1);
        assert.equal(state.auditCalls[0].actionType, 'discount.batch_restore.run');
        assert.equal(state.auditCalls[0].details.batch_run_id, 'run_1');
        assert.equal(state.auditCalls[0].details.total_attempted_count, 3);
        assert.equal(state.auditCalls[0].details.restored[0].code, 'FLASH0');
    });
});

test('discount batch history handler lists normalized runs for the selected site', async () => {
    await withBatchHistoryHandler({
        auditRows: [
            {
                id: 'audit_1',
                action_type: 'discount.batch_restore.run',
                created_at: '2026-04-08T10:00:00.000Z',
                admin_id: 'admin_1',
                admin_email: 'ops@example.com',
                details: {
                    batch_run_id: 'run_1',
                    operation_source: 'risk_restore_batch_modal',
                    generated_at: '2026-04-08T10:00:00.000Z',
                    site: 'cn',
                    status_filter: 'inactive',
                    search_filter: 'flash',
                    resolution: '已批量复核，确认可恢复。',
                    should_resolve_cases: true,
                    total_candidate_count: 5,
                    total_attempted_count: 3,
                    truncated_count: 2,
                    restored: [{ id: 'd1', code: 'FLASH0' }],
                    failed: [
                        { id: 'd2', code: 'FLASH1', message: 'Conflict', skipped: false },
                        { id: 'd3', code: 'FLASH2', message: 'Skipped', skipped: true }
                    ],
                    case_sync_warning: '部分 case 未同步关闭'
                }
            },
            {
                id: 'audit_2',
                action_type: 'discount.batch_restore.run',
                created_at: '2026-04-07T10:00:00.000Z',
                admin_id: 'admin_2',
                admin_email: 'intl@example.com',
                details: {
                    batch_run_id: 'run_2',
                    operation_source: 'risk_restore_batch_modal',
                    generated_at: '2026-04-07T10:00:00.000Z',
                    site: 'intl',
                    total_attempted_count: 1,
                    restored: [{ id: 'd4', code: 'INTL50' }],
                    failed: []
                }
            }
        ]
    }, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'GET',
            headers: {},
            url: '/api/admin/discounts/batch-history?site=cn'
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.site, 'cn');
        assert.equal(payload.runs.length, 1);
        assert.equal(payload.runs[0].run_id, 'run_1');
        assert.equal(payload.runs[0].restored_count, 1);
        assert.equal(payload.runs[0].failed_count, 1);
        assert.equal(payload.runs[0].skipped_count, 1);
        assert.equal(payload.runs[0].case_sync_warning, '部分 case 未同步关闭');
    });
});

test('discount batch history handler rejects unsupported methods', async () => {
    await withBatchHistoryHandler({}, async ({ handler }) => {
        const res = createMockResponse();

        await handler({
            method: 'DELETE',
            headers: {}
        }, res);

        const payload = res.json();
        assert.equal(res.statusCode, 405);
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Method not allowed');
    });
});
