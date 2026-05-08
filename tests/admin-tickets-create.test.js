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
        user: { id: 'admin-1', email: 'admin@example.com' },
        orders: [],
        paymentOrders: [],
        insertedTickets: [],
        auditLogs: [],
        ...overrides
    };
}

function createSupabaseStub(state) {
    return {
        from(table) {
            if (!['shop_orders', 'payment_orders', 'shop_tickets'].includes(table)) {
                throw new Error(`Unexpected table access: ${table}`);
            }

            const queryState = {
                mode: 'select',
                filters: [],
                payload: null,
                single: false,
                maybeSingle: false
            };

            function applyFilters(rows) {
                return rows.filter((row) => queryState.filters.every(({ column, value }) => row[column] === value));
            }

            function execute() {
                if (queryState.mode === 'select') {
                    const rows = applyFilters(
                        table === 'shop_orders'
                            ? state.orders
                            : table === 'payment_orders'
                                ? state.paymentOrders
                                : state.insertedTickets
                    );
                    return {
                        data: queryState.single || queryState.maybeSingle ? (rows[0] || null) : rows,
                        error: null
                    };
                }

                if (queryState.mode === 'insert') {
                    const payload = { ...(queryState.payload || {}) };
                    const row = {
                        id: `ticket-${state.insertedTickets.length + 1}`,
                        created_at: '2026-03-30T10:00:00.000Z',
                        updated_at: '2026-03-30T10:00:00.000Z',
                        ...payload
                    };
                    state.insertedTickets.push(row);
                    return {
                        data: row,
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
                    return Promise.resolve(execute());
                },
                insert(payload) {
                    queryState.mode = 'insert';
                    queryState.payload = payload;
                    return query;
                },
                single() {
                    queryState.single = true;
                    return Promise.resolve(execute());
                }
            };

            return query;
        }
    };
}

async function withHandler(stateOverrides, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/tickets/create.js');
    const originalLoad = Module._load;
    const state = createState(stateOverrides);

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
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

test('admin can create a support ticket from an ops alert with explicit user context', async () => {
    await withHandler({}, async (handler, state) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                alert_type: 'shop_order_delivery_failed',
                title: '履约失败（order-1）',
                content: '订单迟迟没有发货，需要人工检查。',
                reference_label: '订单号',
                reference_value: '7f8c1d2e-0cf8-4a9d-95d3-63ce2a4ce44a',
                target_id: 'shop_order_delivery:7f8c1d2e-0cf8-4a9d-95d3-63ce2a4ce44a',
                user_id: 'user-ops-1',
                order_id: '7f8c1d2e-0cf8-4a9d-95d3-63ce2a4ce44a',
                note: '已经联系仓库，先转工单跟进。'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.ticket.user_id, 'user-ops-1');
        assert.equal(payload.ticket.order_id, '7f8c1d2e-0cf8-4a9d-95d3-63ce2a4ce44a');
        assert.equal(state.insertedTickets.length, 1);
        assert.equal(state.insertedTickets[0].site, 'cn');
        assert.equal(state.insertedTickets[0].issue_type, 'OTHER');
        assert.equal(state.insertedTickets[0].status, 'PENDING');
        assert.match(state.insertedTickets[0].description, /\[站内代办转工单]/);
        assert.match(state.insertedTickets[0].description, /告警标题：履约失败/);
        assert.match(state.insertedTickets[0].description, /补充说明：已经联系仓库/);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'ticket.create_from_ops_alert');
        assert.equal(state.auditLogs[0].details.source_alert_type, 'shop_order_delivery_failed');
    });
});

test('admin ticket creation can resolve user from the related order and rejects alerts without user context', async () => {
    await withHandler({
        orders: [{
            id: '5d4f1ea7-8dde-45eb-9d06-467566e7c001',
            user_id: 'user-from-order-1'
        }]
    }, async (handler, state) => {
        const successReq = {
            method: 'POST',
            headers: {},
            body: {
                alert_type: 'shop_purchase_succeeded',
                title: '商城订单需要补跟进',
                order_id: '5d4f1ea7-8dde-45eb-9d06-467566e7c001',
                content: '用户反馈订单状态和实际交付不一致。'
            }
        };
        const successRes = createMockResponse();

        await handler(successReq, successRes);
        const successPayload = successRes.json();

        assert.equal(successRes.statusCode, 200);
        assert.equal(successPayload.ticket.user_id, 'user-from-order-1');
        assert.equal(state.insertedTickets.length, 1);

        const failedReq = {
            method: 'POST',
            headers: {},
            body: {
                alert_type: 'shop_inventory_low',
                title: '库存不足',
                content: '这是一个没有用户归属的库存告警。'
            }
        };
        const failedRes = createMockResponse();

        await handler(failedReq, failedRes);
        const failedPayload = failedRes.json();

        assert.equal(failedRes.statusCode, 400);
        assert.equal(failedPayload.success, false);
        assert.match(failedPayload.message, /缺少可归属用户/);
    });
});

test('admin can create a support ticket from a chat session context', async () => {
    await withHandler({}, async (handler, state) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                source: 'chat_session',
                title: '客服会话跟进（ruihuashi620）',
                content: '用户反馈兑换流程卡住，需要客服继续跟进。',
                reference_label: '会话',
                reference_value: 'ruihuashi620@gmail.com',
                user_id: 'user-chat-1',
                user_email: 'ruihuashi620@gmail.com',
                session_id: 'ruihuashi620@gmail.com',
                note: '已在客服会话里先安抚，转工单继续处理。'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.ticket.user_id, 'user-chat-1');
        assert.equal(state.insertedTickets.length, 1);
        assert.match(state.insertedTickets[0].description, /\[客服会话转工单]/);
        assert.match(state.insertedTickets[0].description, /用户邮箱：ruihuashi620@gmail.com/);
        assert.match(state.insertedTickets[0].description, /客服备注：已在客服会话里先安抚/);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'ticket.create_from_chat_session');
        assert.equal(state.auditLogs[0].details.source, 'chat_session');
    });
});
