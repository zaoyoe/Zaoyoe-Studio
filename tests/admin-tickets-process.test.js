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
        user: { id: 'admin-processor-1', email: 'ops@example.com' },
        tickets: [],
        orders: [],
        chatMessages: [],
        notifications: [],
        auditLogs: [],
        cases: [],
        events: [],
        shopRiskCases: [],
        tableErrors: {},
        ...overrides
    };
}

function createSupabaseStub(state) {
    return {
        from(table) {
            const queryState = {
                mode: 'select',
                filters: [],
                payload: null,
                payloads: null,
                single: false,
                maybeSingle: false
            };

            function applyFilters(rows) {
                return rows.filter((row) => queryState.filters.every(({ column, value }) => row[column] === value));
            }

            function execute() {
                const tableError = state.tableErrors?.[table] || null;
                if (tableError) {
                    return {
                        data: queryState.single || queryState.maybeSingle ? null : [],
                        error: tableError
                    };
                }

                if (queryState.mode === 'select') {
                    const sourceRows = table === 'shop_tickets'
                        ? state.tickets
                        : table === 'shop_orders'
                            ? state.orders
                            : table === 'chat_messages'
                                ? state.chatMessages
                            : table === 'ops_alert_cases'
                                ? state.cases
                                : table === 'shop_risk_cases'
                                    ? state.shopRiskCases
                                    : table === 'ops_alert_case_events'
                                        ? state.events
                                        : table === 'system_notifications'
                                            ? state.notifications
                                            : [];
                    const rows = applyFilters(sourceRows);
                    return {
                        data: queryState.single || queryState.maybeSingle ? (rows[0] || null) : rows,
                        error: null
                    };
                }

                if (queryState.mode === 'update') {
                    const rows = applyFilters(state.tickets);
                    rows.forEach((row) => Object.assign(row, queryState.payload || {}));
                    return {
                        data: rows,
                        error: null
                    };
                }

                if (queryState.mode === 'insert') {
                    if (table === 'chat_messages') {
                        const nextRows = (Array.isArray(queryState.payloads) ? queryState.payloads : [queryState.payload || {}]).map((payload) => ({
                            id: `chat-message-${state.chatMessages.length + 1}`,
                            ...payload
                        }));
                        state.chatMessages.push(...nextRows);
                        return {
                            data: nextRows,
                            error: null
                        };
                    }

                    if (table === 'system_notifications') {
                        const nextRows = (Array.isArray(queryState.payloads) ? queryState.payloads : [queryState.payload || {}]).map((payload) => ({
                            id: `notification-${state.notifications.length + 1}`,
                            ...payload
                        }));
                        state.notifications.push(...nextRows);
                        return {
                            data: nextRows,
                            error: null
                        };
                    }

                    if (table === 'ops_alert_case_events') {
                        const nextRows = (Array.isArray(queryState.payloads) ? queryState.payloads : [queryState.payload || {}]).map((payload, index) => {
                            const row = {
                                id: `event-${state.events.length + index + 1}`,
                                ...payload
                            };
                            state.events.push(row);
                            return row;
                        });
                        return {
                            data: nextRows,
                            error: null
                        };
                    }
                }

                if (queryState.mode === 'upsert') {
                    const payload = { ...(queryState.payload || {}) };
                    const rows = table === 'shop_risk_cases' ? state.shopRiskCases : state.cases;
                    const existingIndex = rows.findIndex((row) => (
                        table === 'shop_risk_cases'
                            ? row.target_id === payload.target_id
                            : row.category_key === payload.category_key && row.target_id === payload.target_id
                    ));
                    const nextRow = existingIndex >= 0
                        ? { ...rows[existingIndex], ...payload }
                        : {
                            id: `${table === 'shop_risk_cases' ? 'legacy-case' : 'case'}-${rows.length + 1}`,
                            created_at: '2026-03-30T12:00:00.000Z',
                            ...payload
                        };
                    rows[existingIndex >= 0 ? existingIndex : rows.length] = nextRow;
                    return {
                        data: nextRow,
                        error: null
                    };
                }

                throw new Error(`Unsupported ${table} ${queryState.mode}`);
            }

            const query = {
                select() {
                    return query;
                },
                eq(column, value) {
                    queryState.filters.push({ column, value });
                    return query;
                },
                update(payload) {
                    queryState.mode = 'update';
                    queryState.payload = payload;
                    return query;
                },
                insert(payload) {
                    queryState.mode = 'insert';
                    queryState.payload = payload;
                    queryState.payloads = Array.isArray(payload) ? payload : [payload];
                    return query;
                },
                upsert(payload) {
                    queryState.mode = 'upsert';
                    queryState.payload = payload;
                    return query;
                },
                single() {
                    queryState.single = true;
                    return Promise.resolve(execute());
                },
                maybeSingle() {
                    queryState.maybeSingle = true;
                    return Promise.resolve(execute());
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

async function withHandler(stateOverrides, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/tickets/process.js');
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
        if (request === '../../../../api/_lib/payments/rpc') {
            return {
                async rechargePointsForPayment() {
                    return { error: null };
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

test('ticket process resolves the linked ops alert case when the ticket came from ops inbox', async () => {
    await withHandler({
        tickets: [{
            id: 'ticket-ops-1',
            user_id: 'user-1',
            order_id: 'order-1',
            status: 'PENDING',
            description: [
                '[站内代办转工单]',
                '告警标题：履约失败（order-1）',
                '告警类型：shop_order_delivery_failed',
                '订单号：order-1',
                '告警标识：shop_order_delivery:order-1'
            ].join('\n'),
            created_at: '2026-03-30T10:00:00.000Z',
            updated_at: '2026-03-30T10:00:00.000Z'
        }],
        cases: [{
            id: 'case-1',
            category_key: 'fulfillment',
            target_id: 'shop_order_delivery:order-1',
            alert_type: 'shop_order_delivery_failed',
            status: 'claimed',
            owner_admin_id: 'admin-processor-1',
            owner_label: 'ops@example.com',
            note: '已转工单，工单号：ticket-ops-1',
            resolution: null,
            metadata: {
                alert_type: 'shop_order_delivery_failed',
                title: '履约失败（order-1）',
                reference_label: '订单号',
                reference_value: 'order-1'
            }
        }]
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                ticketId: 'ticket-ops-1',
                newStatus: 'RESOLVED',
                adminReply: '已经补发成功'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.ticket.status, 'RESOLVED');
        assert.equal(payload.linkedOpsAlertCase.category_key, 'fulfillment');
        assert.equal(payload.linkedOpsAlertCase.target_id, 'shop_order_delivery:order-1');
        assert.equal(state.cases[0].status, 'resolved');
        assert.match(state.cases[0].resolution, /关联工单 ticket-ops-1 已解决/);
        assert.match(state.cases[0].resolution, /处理说明：已经补发成功/);
        assert.equal(state.events.length, 1);
        assert.equal(state.events[0].action, 'resolve');
        assert.equal(state.notifications.length, 1);
        assert.equal(state.auditLogs.length, 1);
        assert.deepEqual(state.auditLogs[0].details.linked_ops_alert_case, payload.linkedOpsAlertCase);
    });
});

test('ticket process still succeeds when linked ops alert backfill is unavailable', async () => {
    await withHandler({
        tickets: [{
            id: 'ticket-ops-2',
            user_id: 'user-2',
            order_id: '',
            status: 'PENDING',
            description: [
                '[站内代办转工单]',
                '告警标题：验证服务异常',
                '告警类型：verify_failure_rate_spike',
                '告警标识：verify-failure-window-1'
            ].join('\n'),
            created_at: '2026-03-30T10:00:00.000Z',
            updated_at: '2026-03-30T10:00:00.000Z'
        }],
        tableErrors: {
            ops_alert_cases: {
                code: 'PGRST205',
                message: "Could not find the table 'public.ops_alert_cases' in the schema cache"
            }
        }
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                ticketId: 'ticket-ops-2',
                newStatus: 'REJECTED',
                adminReply: '这次先不处理'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.ticket.status, 'REJECTED');
        assert.equal(payload.linkedOpsAlertCase, null);
        assert.equal(state.notifications.length, 1);
        assert.equal(state.auditLogs.length, 1);
    });
});

test('ticket process syncs the result back into the linked chat session when the ticket came from客服会话', async () => {
    await withHandler({
        tickets: [{
            id: 'ticket-chat-1',
            user_id: 'user-chat-1',
            order_id: '',
            status: 'PENDING',
            description: [
                '[客服会话转工单]',
                '告警标题：客服会话跟进（ruihuashi620）',
                '用户邮箱：ruihuashi620@gmail.com',
                '会话标识：ruihuashi620@gmail.com'
            ].join('\n'),
            created_at: '2026-03-30T10:00:00.000Z',
            updated_at: '2026-03-30T10:00:00.000Z'
        }]
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                ticketId: 'ticket-chat-1',
                newStatus: 'RESOLVED',
                adminReply: '已经帮你处理好了'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.ticket.status, 'RESOLVED');
        assert.equal(payload.linkedChatSession.session_id, 'ruihuashi620@gmail.com');
        assert.equal(state.chatMessages.length, 1);
        assert.equal(state.chatMessages[0].session_id, 'ruihuashi620@gmail.com');
        assert.equal(state.chatMessages[0].message_type, 'ticket_update');
        assert.match(state.chatMessages[0].content, /\[工单处理结果同步]/);
        assert.match(state.chatMessages[0].content, /已经帮你处理好了/);
        assert.equal(state.notifications.length, 1);
        assert.equal(state.notifications[0].category, 'ticket_result');
        assert.equal(state.auditLogs.length, 1);
        assert.deepEqual(state.auditLogs[0].details.linked_chat_session, payload.linkedChatSession);
    });
});
