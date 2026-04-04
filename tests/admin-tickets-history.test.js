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
        user: { id: 'admin-history-1', email: 'ops@example.com' },
        auditLogsView: [],
        auditLogs: [],
        tableErrors: {},
        ...overrides
    };
}

class FakeQuery {
    constructor(state, table) {
        this.state = state;
        this.table = table;
        this.filters = [];
        this.orderField = '';
        this.orderAscending = true;
        this.limitCount = null;
    }

    select() {
        return this;
    }

    in(field, values) {
        this.filters.push({ op: 'in', field, values: Array.isArray(values) ? values : [] });
        return this;
    }

    order(field, { ascending = true } = {}) {
        this.orderField = field;
        this.orderAscending = ascending;
        return this;
    }

    limit(count) {
        this.limitCount = Number(count);
        return this;
    }

    getRows() {
        if (this.table === 'admin_audit_logs_view') return this.state.auditLogsView;
        if (this.table === 'admin_audit_logs') return this.state.auditLogs;
        return [];
    }

    matchesFilter(row, filter) {
        const value = row?.[filter.field];
        if (filter.op === 'in') {
            return filter.values.includes(value);
        }
        return true;
    }

    exec() {
        const tableError = this.state.tableErrors?.[this.table] || null;
        if (tableError) {
            return {
                data: [],
                error: tableError
            };
        }

        let rows = [...this.getRows()].filter((row) => this.filters.every((filter) => this.matchesFilter(row, filter)));
        if (this.orderField) {
            rows.sort((left, right) => {
                const leftValue = String(left?.[this.orderField] || '');
                const rightValue = String(right?.[this.orderField] || '');
                const comparison = leftValue.localeCompare(rightValue);
                return this.orderAscending ? comparison : -comparison;
            });
        }

        if (Number.isFinite(this.limitCount)) {
            rows = rows.slice(0, this.limitCount);
        }

        return {
            data: rows,
            error: null
        };
    }

    then(resolve, reject) {
        return Promise.resolve(this.exec()).then(resolve, reject);
    }
}

function createSupabaseStub(state) {
    return {
        from(table) {
            return new FakeQuery(state, table);
        }
    };
}

async function withHandler(stateOverrides, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/tickets/history.js');
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
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
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

test('tickets history handler returns chronological create and process audit items for the ticket', async () => {
    await withHandler({
        auditLogsView: [{
            id: 'audit-process-1',
            action_type: 'ticket.process',
            created_at: '2026-04-03T10:30:00.000Z',
            admin_id: 'admin-history-1',
            admin_email: 'ops@example.com',
            details: {
                ticket_id: 'ticket-history-1',
                order_id: 'order-history-1',
                new_status: 'RESOLVED',
                admin_reply: '已完成补发处理',
                refunded: true,
                refund_amount: 88
            }
        }, {
            id: 'audit-create-1',
            action_type: 'ticket.create_from_chat_session',
            created_at: '2026-04-03T10:00:00.000Z',
            admin_id: 'admin-history-2',
            admin_email: 'chat-ops@example.com',
            details: {
                ticket_id: 'ticket-history-1',
                order_id: 'order-history-1',
                source: 'chat_session',
                source_reference_label: '会话ID',
                source_reference_value: 'session-42'
            }
        }, {
            id: 'audit-other-ticket',
            action_type: 'ticket.process',
            created_at: '2026-04-03T11:00:00.000Z',
            admin_id: 'admin-history-3',
            admin_email: 'other@example.com',
            details: {
                ticket_id: 'ticket-history-2',
                new_status: 'REJECTED'
            }
        }]
    }, async (handler) => {
        const req = {
            method: 'GET',
            url: '/api/admin/tickets/history?ticketId=ticket-history-1',
            headers: {}
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.items.length, 2);
        assert.equal(payload.items[0].title, '从客服会话创建工单');
        assert.match(payload.items[0].detail, /会话ID：session-42/);
        assert.equal(payload.items[1].title, '管理员解决工单');
        assert.equal(payload.items[1].tone, 'success');
        assert.match(payload.items[1].detail, /已退回 88 积分/);
    });
});

test('tickets history handler falls back to admin_audit_logs when the view is unavailable', async () => {
    await withHandler({
        tableErrors: {
            admin_audit_logs_view: {
                message: 'relation "admin_audit_logs_view" does not exist'
            }
        },
        auditLogs: [{
            id: 'audit-fallback-1',
            action_type: 'ticket.process',
            created_at: '2026-04-03T11:20:00.000Z',
            admin_id: 'admin-history-1',
            details: {
                ticket_id: 'ticket-history-fallback-1',
                new_status: 'REJECTED',
                admin_reply: '信息不足，暂无法处理'
            }
        }]
    }, async (handler) => {
        const req = {
            method: 'GET',
            url: '/api/admin/tickets/history?ticketId=ticket-history-fallback-1',
            headers: {}
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.items.length, 1);
        assert.equal(payload.items[0].title, '管理员拒绝工单');
        assert.equal(payload.items[0].actor, 'admin-history-1');
    });
});

test('tickets history handler maps dedicated internal note audit items', async () => {
    await withHandler({
        auditLogsView: [{
            id: 'audit-note-1',
            action_type: 'ticket.internal_note',
            created_at: '2026-04-03T10:10:00.000Z',
            admin_id: 'admin-history-9',
            admin_email: 'reviewer@example.com',
            details: {
                ticket_id: 'ticket-history-note-1',
                ticket_status: 'RESOLVED',
                public_reply: '已完成补发',
                note: '命中风控规则，人工核验后继续放行'
            }
        }]
    }, async (handler) => {
        const req = {
            method: 'GET',
            url: '/api/admin/tickets/history?ticketId=ticket-history-note-1',
            headers: {}
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.items.length, 1);
        assert.equal(payload.items[0].title, '添加内部备注');
        assert.equal(payload.items[0].icon, 'fa-note-sticky');
        assert.match(payload.items[0].detail, /记录人：reviewer@example.com/);
        assert.match(payload.items[0].detail, /工单状态：已解决/);
        assert.match(payload.items[0].detail, /关联回复：已完成补发/);
        assert.match(payload.items[0].detail, /内部备注：命中风控规则/);
    });
});

test('tickets history handler maps ticket assignment events into timeline items', async () => {
    await withHandler({
        auditLogsView: [{
            id: 'audit-assign-history-1',
            action_type: 'ticket.assign',
            created_at: '2026-04-03T10:15:00.000Z',
            admin_id: 'admin-history-10',
            admin_email: 'dispatcher@example.com',
            details: {
                ticket_id: 'ticket-history-assign-1',
                assigned: true,
                assignee_id: 'admin-history-11',
                assignee_label: 'owner@example.com',
                previous_assignee_label: 'lead@example.com',
                ticket_status: 'PENDING'
            }
        }]
    }, async (handler) => {
        const req = {
            method: 'GET',
            url: '/api/admin/tickets/history?ticketId=ticket-history-assign-1',
            headers: {}
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.items.length, 1);
        assert.equal(payload.items[0].title, '指派负责人');
        assert.equal(payload.items[0].icon, 'fa-user-check');
        assert.match(payload.items[0].detail, /操作人：dispatcher@example.com/);
        assert.match(payload.items[0].detail, /之前负责人：lead@example.com/);
        assert.match(payload.items[0].detail, /当前负责人：owner@example.com/);
    });
});
