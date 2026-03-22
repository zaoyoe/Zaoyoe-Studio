const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

function createQueryBuilder(executor) {
    const state = {
        mode: 'select',
        filters: [],
        payload: null,
        single: false
    };

    const builder = {
        select() {
            return builder;
        },
        eq(column, value) {
            state.filters.push({ column, value });
            return builder;
        },
        single() {
            state.single = true;
            return builder;
        },
        upsert(payload) {
            state.mode = 'upsert';
            state.payload = payload;
            return builder;
        },
        insert(payload) {
            state.mode = 'insert';
            state.payload = payload;
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

function applyFilters(rows, filters) {
    return rows.filter((row) => filters.every(({ column, value }) => row[column] === value));
}

function createSupabaseStub(state = {}) {
    const orders = state.orders || [];
    const anomalyCases = state.anomalyCases || [];
    state.anomalyCases = anomalyCases;
    state.metrics = state.metrics || {};
    state.metrics.reviewRpcCalls = state.metrics.reviewRpcCalls || [];

    return {
        rpc(name, args = {}) {
            if (name === 'fn_apply_payment_order_review') {
                state.metrics.reviewRpcCalls.push(args);
                return Promise.resolve({
                    data: state.reviewRpcData || { ok: true },
                    error: state.reviewRpcError || null
                });
            }

            throw new Error(`Unexpected RPC: ${name}`);
        },
        from(table) {
            return createQueryBuilder(async (query) => {
                if (table === 'payment_orders' && query.mode === 'select') {
                    const rows = applyFilters(orders, query.filters);
                    return {
                        data: query.single ? (rows[0] || null) : rows,
                        error: rows.length ? null : { message: 'Order not found' }
                    };
                }

                if (table === 'payment_anomaly_cases' && query.mode === 'upsert') {
                    const payload = query.payload || {};
                    const existingIndex = anomalyCases.findIndex((item) => (
                        item.target_type === payload.target_type && item.target_id === payload.target_id
                    ));
                    const nextRow = {
                        id: existingIndex >= 0 ? anomalyCases[existingIndex].id : `anomaly-${anomalyCases.length + 1}`,
                        ...payload
                    };

                    if (existingIndex >= 0) {
                        anomalyCases[existingIndex] = nextRow;
                    } else {
                        anomalyCases.push(nextRow);
                    }

                    return {
                        data: query.single ? nextRow : [nextRow],
                        error: null
                    };
                }

                if (table === 'admin_audit_logs' && query.mode === 'insert') {
                    return { data: null, error: null };
                }

                throw new Error(`Unexpected table access: ${table}/${query.mode}`);
            });
        }
    };
}

function createMockAdminModule(state = {}) {
    const supabase = createSupabaseStub(state);
    state.auditLogs = state.auditLogs || [];

    return {
        async requireAdmin() {
            return {
                supabase,
                requestSupabase: supabase,
                user: { id: 'admin-1', email: 'admin@example.com' }
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
            state.auditLogs.push(entry);
        }
    };
}

function createMockResponse() {
    const state = {
        statusCode: 200,
        headers: {},
        body: ''
    };

    return {
        status(code) {
            state.statusCode = code;
            return this;
        },
        setHeader(name, value) {
            state.headers[String(name).toLowerCase()] = value;
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

async function withPaymentsActionHandler(state, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/payments/actions.js');
    const originalLoad = Module._load;
    const mockAdminModule = createMockAdminModule(state);

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return mockAdminModule;
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
        return await callback(handler);
    } finally {
        delete require.cache[handlerPath];
    }
}

test('approve_review applies review RPC, writes anomaly case, and records audit log', async () => {
    const state = {
        orders: [
            {
                id: 'order-1',
                provider: 'afdian',
                provider_order_no: 'AFD-REVIEW-1',
                status: 'pending_review',
                paid_at: null,
                verified_at: null,
                last_error: 'signature mismatch',
                provider_metadata: {}
            }
        ]
    };

    await withPaymentsActionHandler(state, async (handler) => {
        const req = {
            method: 'POST',
            body: {
                targetType: 'order',
                targetId: 'order-1',
                action: 'approve_review',
                note: '人工复核后确认放行'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.anomaly_case.status, 'approved');
        assert.equal(payload.anomaly_case.last_action, 'approve_review');
        assert.equal(state.metrics.reviewRpcCalls.length, 1);
        assert.deepEqual(state.metrics.reviewRpcCalls[0], {
            p_payment_order_id: 'order-1',
            p_action: 'approve',
            p_note: '人工复核后确认放行',
            p_actor_id: 'admin-1'
        });
        assert.equal(state.anomalyCases.length, 1);
        assert.equal(state.anomalyCases[0].resolution, '人工复核后确认放行');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'payments.anomaly.action');
    });
});

test('approve_review is rejected when order is not pending_review', async () => {
    const state = {
        orders: [
            {
                id: 'order-2',
                provider: 'afdian',
                provider_order_no: 'AFD-REVIEW-2',
                status: 'amount_mismatch',
                paid_at: null,
                verified_at: null,
                last_error: 'amount mismatch',
                provider_metadata: {}
            }
        ]
    };

    await withPaymentsActionHandler(state, async (handler) => {
        const req = {
            method: 'POST',
            body: {
                targetType: 'order',
                targetId: 'order-2',
                action: 'approve_review',
                note: '不应允许'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 409);
        assert.equal(payload.success, false);
        assert.match(payload.message, /Only pending_review orders can use this review action/);
        assert.equal(state.metrics.reviewRpcCalls.length, 0);
        assert.equal(state.anomalyCases.length, 0);
        assert.equal(state.auditLogs.length, 0);
    });
});

test('sensitive review actions require an operator note', async () => {
    const state = {
        orders: [
            {
                id: 'order-3',
                provider: 'afdian',
                provider_order_no: 'AFD-REVIEW-3',
                status: 'pending_review',
                paid_at: null,
                verified_at: null,
                last_error: 'signature mismatch',
                provider_metadata: {}
            }
        ]
    };

    await withPaymentsActionHandler(state, async (handler) => {
        const req = {
            method: 'POST',
            body: {
                targetType: 'order',
                targetId: 'order-3',
                action: 'reject_review',
                note: '   '
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 400);
        assert.equal(payload.success, false);
        assert.match(payload.message, /请填写处理备注/);
        assert.equal(state.metrics.reviewRpcCalls.length, 0);
        assert.equal(state.anomalyCases.length, 0);
        assert.equal(state.auditLogs.length, 0);
    });
});
