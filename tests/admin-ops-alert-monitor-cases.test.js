const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

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

function createState(overrides = {}) {
    return {
        user: { id: 'admin-user-1', email: 'admin@example.com' },
        cases: [],
        auditLogs: [],
        ...overrides
    };
}

function createSupabaseStub(state) {
    return {
        from(table) {
            if (table !== 'ops_alert_cases') {
                throw new Error(`Unexpected table access: ${table}`);
            }

            const queryState = {
                mode: 'select',
                filters: [],
                payload: null,
                maybeSingle: false,
                single: false
            };

            function applyFilters(rows) {
                return rows.filter((row) => queryState.filters.every(({ column, value }) => row[column] === value));
            }

            function execute() {
                if (queryState.mode === 'select') {
                    const rows = applyFilters(state.cases || []);
                    return {
                        data: queryState.maybeSingle ? (rows[0] || null) : rows,
                        error: null
                    };
                }

                if (queryState.mode === 'upsert') {
                    const payload = {
                        ...(queryState.payload || {})
                    };
                    const existingIndex = state.cases.findIndex((row) => (
                        row.category_key === payload.category_key
                        && row.target_id === payload.target_id
                    ));
                    const nextRow = existingIndex >= 0
                        ? {
                            ...state.cases[existingIndex],
                            ...payload
                        }
                        : {
                            id: payload.id || `case-${state.cases.length + 1}`,
                            created_at: payload.created_at || new Date().toISOString(),
                            ...payload
                        };

                    if (!nextRow.updated_at) {
                        nextRow.updated_at = new Date().toISOString();
                    }

                    if (existingIndex >= 0) {
                        state.cases[existingIndex] = nextRow;
                    } else {
                        state.cases.push(nextRow);
                    }

                    return {
                        data: queryState.single ? nextRow : [nextRow],
                        error: null
                    };
                }

                throw new Error(`Unsupported mode: ${queryState.mode}`);
            }

            const query = {
                select() {
                    return query;
                },
                eq(column, value) {
                    queryState.filters.push({ column, value });
                    return query;
                },
                maybeSingle() {
                    queryState.maybeSingle = true;
                    return query;
                },
                upsert(payload) {
                    queryState.mode = 'upsert';
                    queryState.payload = payload;
                    return query;
                },
                single() {
                    queryState.single = true;
                    return query;
                },
                then(resolve, reject) {
                    return Promise.resolve(execute()).then(resolve, reject);
                },
                catch(reject) {
                    return query.then(undefined, reject);
                }
            };

            return query;
        }
    };
}

function createAdminModule(state) {
    return {
        async requireAdmin() {
            return {
                supabase: createSupabaseStub(state),
                user: state.user
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

async function withHandler(stateOverrides, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/settings/ops-alert-monitor-cases.js');
    const originalLoad = Module._load;
    const state = createState(stateOverrides);

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return createAdminModule(state);
        }
        return originalLoad(request, parent, isMain);
    };

    try {
        const handler = require(handlerPath);
        await callback(handler, state);
    } finally {
        Module._load = originalLoad;
        delete require.cache[handlerPath];
    }
}

test('ops alert case handler claims a shop risk case and writes legacy-compatible audit log', async () => {
    await withHandler({}, async (handler, state) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                action: 'claim',
                target_id: 'shop_order_risk:coupon:FLASH0'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.case.category_key, 'shop_risk');
        assert.equal(payload.case.status, 'claimed');
        assert.equal(payload.case.owner_admin_id, 'admin-user-1');
        assert.equal(payload.case.owner_label, 'admin@example.com');
        assert.equal(state.cases.length, 1);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'admin.shop_risk_case.claim');
    });
});

test('ops alert case handler requires note content when resolving a case', async () => {
    await withHandler({}, async (handler) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                action: 'resolve',
                category_key: 'payments',
                target_id: 'payment_gateway:hupijiao:cn'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 400);
        assert.equal(payload.success, false);
        assert.equal(payload.message, '关闭告警时需要填写处理结论');
    });
});

test('ops alert case handler resolves an existing case while preserving owner information', async () => {
    await withHandler({
        cases: [
            {
                id: 'case-1',
                category_key: 'shop_risk',
                target_id: 'shop_order_risk:coupon:FLASH0',
                alert_type: 'shop_order_risk_anomaly',
                status: 'claimed',
                owner_admin_id: 'admin-user-2',
                owner_label: 'ops@example.com',
                note: '已接手',
                resolution: null,
                metadata: { from: 'test' },
                last_action: 'claimed',
                last_action_by: 'admin-user-2',
                last_action_at: '2026-03-27T08:00:00.000Z',
                created_at: '2026-03-27T07:59:00.000Z',
                updated_at: '2026-03-27T08:00:00.000Z'
            }
        ]
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                action: 'resolve',
                target_id: 'shop_order_risk:coupon:FLASH0',
                note: '已停用优惠码并完成订单复核。'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.case.status, 'resolved');
        assert.equal(payload.case.owner_admin_id, 'admin-user-2');
        assert.equal(payload.case.owner_label, 'ops@example.com');
        assert.equal(payload.case.resolution, '已停用优惠码并完成订单复核。');
        assert.equal(state.cases[0].status, 'resolved');
        assert.equal(state.auditLogs[0].actionType, 'admin.shop_risk_case.resolve');
    });
});

test('ops alert case handler supports batch claim for generic monitor items', async () => {
    await withHandler({}, async (handler, state) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                action: 'claim',
                items: [
                    {
                        category_key: 'payments',
                        target_id: 'payment_gateway:hupijiao:cn',
                        alert_type: 'payment_gateway_degraded',
                        title: '支付通道异常'
                    },
                    {
                        category_key: 'inventory',
                        target_id: 'shop_inventory:product-a',
                        alert_type: 'shop_inventory_low',
                        title: '库存偏低'
                    }
                ]
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.summary.processed_count, 2);
        assert.equal(payload.cases.length, 2);
        assert.equal(state.cases.length, 2);
        assert.equal(state.cases[0].status, 'claimed');
        assert.equal(state.cases[1].status, 'claimed');
        assert.equal(state.auditLogs[0].actionType, 'admin.ops_alert_case.batch.claim');
    });
});
