const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
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

test('tickets list handler avoids selecting the legacy reason column directly', () => {
    const handlerSource = fs.readFileSync(
        path.resolve(__dirname, '../server/api-handlers/admin/tickets/list.js'),
        'utf8'
    );

    assert.equal(
        handlerSource.includes("select('id, user_id, order_id, issue_type, status, description, admin_notes, created_at, updated_at', { count: 'exact' })"),
        true
    );
    assert.equal(
        handlerSource.includes("select('id, user_id, order_id, issue_type, status, reason, description, admin_notes, created_at, updated_at'"),
        false
    );
});

function createState(overrides = {}) {
    return {
        user: { id: 'admin-ticket-list-1', email: 'ops@example.com' },
        tickets: [],
        profiles: [],
        orders: [],
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
        this.rangeFrom = null;
        this.rangeTo = null;
        this.limitCount = null;
        this.selectOptions = {};
    }

    select(_selection = '*', options = {}) {
        this.selectOptions = options || {};
        return this;
    }

    eq(field, value) {
        this.filters.push({ op: 'eq', field, value });
        return this;
    }

    in(field, values) {
        this.filters.push({ op: 'in', field, values: Array.isArray(values) ? values : [] });
        return this;
    }

    ilike(field, pattern) {
        this.filters.push({ op: 'ilike', field, pattern: String(pattern || '') });
        return this;
    }

    order(field, { ascending = true } = {}) {
        this.orderField = field;
        this.orderAscending = ascending;
        return this;
    }

    range(from, to) {
        this.rangeFrom = Number(from);
        this.rangeTo = Number(to);
        return this;
    }

    limit(count) {
        this.limitCount = Number(count);
        return this;
    }

    getRows() {
        if (this.table === 'shop_tickets') return this.state.tickets;
        if (this.table === 'profiles') return this.state.profiles;
        if (this.table === 'shop_orders') return this.state.orders;
        if (this.table === 'admin_audit_logs_view') return this.state.auditLogsView;
        if (this.table === 'admin_audit_logs') return this.state.auditLogs;
        return [];
    }

    matchesFilter(row, filter) {
        const value = row?.[filter.field];

        if (filter.op === 'eq') {
            return value === filter.value;
        }

        if (filter.op === 'in') {
            return filter.values.includes(value);
        }

        if (filter.op === 'ilike') {
            const needle = String(filter.pattern || '').replace(/%/g, '').toLowerCase();
            return String(value || '').toLowerCase().includes(needle);
        }

        return true;
    }

    exec() {
        const tableError = this.state.tableErrors?.[this.table] || null;
        if (tableError) {
            return {
                data: [],
                count: null,
                error: tableError
            };
        }

        let rows = [...this.getRows()].filter((row) => this.filters.every((filter) => this.matchesFilter(row, filter)));
        const count = rows.length;

        if (this.orderField) {
            rows.sort((left, right) => {
                const leftValue = String(left?.[this.orderField] || '');
                const rightValue = String(right?.[this.orderField] || '');
                const comparison = leftValue.localeCompare(rightValue);
                return this.orderAscending ? comparison : -comparison;
            });
        }

        if (Number.isFinite(this.rangeFrom) && Number.isFinite(this.rangeTo)) {
            rows = rows.slice(this.rangeFrom, this.rangeTo + 1);
        }

        if (Number.isFinite(this.limitCount)) {
            rows = rows.slice(0, this.limitCount);
        }

        return {
            data: rows,
            count: this.selectOptions?.count === 'exact' ? count : null,
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
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/tickets/list.js');
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

        if (request === '../../../../api/_lib/ops-alerts') {
            return {
                async loadOpsAlertsRuntimeConfig() {
                    return {
                        config: {
                            tickets: {
                                pending_overdue_minutes: 60,
                                reply_templates: [
                                    {
                                        id: 'resolved_generic',
                                        action: 'resolved',
                                        issue_type: 'all',
                                        enabled: true,
                                        title: '通用处理完成',
                                        tag: '推荐',
                                        body: '已收到你的反馈，当前问题已处理完成。'
                                    },
                                    {
                                        id: 'rejected_need_more_context',
                                        action: 'rejected',
                                        issue_type: 'all',
                                        enabled: true,
                                        title: '补充资料后再提交',
                                        tag: '推荐',
                                        body: '请补充订单号、截图或发生时间后重新提交。'
                                    }
                                ]
                            }
                        }
                    };
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

test('tickets list handler paginates pending tickets and enriches source, sla, and refund metadata', async () => {
    await withHandler({
        tickets: [{
            id: 'ticket-chat-new',
            user_id: 'user-chat-1',
            order_id: 'order-chat-1',
            issue_type: 'verification',
            status: 'PENDING',
            description: [
                '[客服会话转工单]',
                '告警标题：客服会话跟进（user-chat-1）',
                '用户邮箱：chat@example.com',
                '会话标识：chat@example.com'
            ].join('\n'),
            created_at: '2999-01-01T00:00:00.000Z',
            updated_at: '2999-01-01T00:00:00.000Z'
        }, {
            id: 'ticket-ops-old',
            user_id: 'user-ops-1',
            order_id: 'order-ops-1',
            issue_type: 'delivery',
            status: 'OPEN',
            description: [
                '[站内代办转工单]',
                '告警标题：履约失败（order-ops-1）',
                '告警类型：shop_order_delivery_failed',
                '订单号：order-ops-1',
                '告警标识：shop_order_delivery:order-ops-1'
            ].join('\n'),
            admin_notes: '等待人工补发',
            created_at: '2000-01-01T00:00:00.000Z',
            updated_at: '2000-01-01T00:00:00.000Z'
        }, {
            id: 'ticket-resolved-1',
            user_id: 'user-resolved-1',
            order_id: '',
            issue_type: 'OTHER',
            status: 'RESOLVED',
            description: '已处理工单',
            created_at: '2998-01-01T00:00:00.000Z',
            updated_at: '2998-01-01T00:00:00.000Z'
        }],
        profiles: [{
            id: 'user-chat-1',
            email: 'chat@example.com'
        }, {
            id: 'user-ops-1',
            email: 'ops-search@example.com'
        }],
        orders: [{
            id: 'order-chat-1',
            price_paid: 88,
            refund_status: 'none'
        }, {
            id: 'order-ops-1',
            price_paid: 66,
            refund_status: 'refunded'
        }]
    }, async (handler) => {
        const req = {
            method: 'GET',
            url: '/api/admin/tickets/list?status=pending&page=1&pageSize=2',
            headers: {}
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.pagination.page, 1);
        assert.equal(payload.pagination.pageSize, 2);
        assert.equal(payload.pagination.totalItems, 2);
        assert.equal(payload.pagination.totalPages, 1);
        assert.equal(payload.rows.length, 2);
        assert.equal(Array.isArray(payload.templateConfig.reply_templates), true);
        assert.equal(payload.templateConfig.reply_templates.length, 2);
        assert.equal(payload.templateConfig.reply_templates[0].id, 'resolved_generic');

        assert.equal(payload.rows[0].id, 'ticket-chat-new');
        assert.equal(payload.rows[0].source_type, 'chat_session');
        assert.equal(payload.rows[0].source_label, '客服会话');
        assert.equal(payload.rows[0].issue_type_label, '验证问题');
        assert.equal(payload.rows[0].user_email, 'chat@example.com');
        assert.equal(payload.rows[0].can_refund, true);
        assert.equal(payload.rows[0].refund_summary, '可退 88 积分');
        assert.equal(payload.rows[0].is_overdue, false);
        assert.match(payload.rows[0].sla_label, /等待/);

        assert.equal(payload.rows[1].id, 'ticket-ops-old');
        assert.equal(payload.rows[1].status, 'PENDING');
        assert.equal(payload.rows[1].status_label, '待处理');
        assert.equal(payload.rows[1].source_type, 'ops_alert');
        assert.equal(payload.rows[1].source_label, '站内代办');
        assert.equal(payload.rows[1].issue_type_label, '履约问题');
        assert.equal(payload.rows[1].can_refund, false);
        assert.equal(payload.rows[1].refund_summary, '订单已退款');
        assert.equal(payload.rows[1].is_overdue, true);
        assert.match(payload.rows[1].sla_label, /已超时/);
    });
});

test('tickets list handler supports searching by profile email', async () => {
    await withHandler({
        tickets: [{
            id: 'ticket-email-match-1',
            user_id: 'user-email-1',
            order_id: '',
            issue_type: 'OTHER',
            status: 'PENDING',
            description: '普通售后咨询',
            created_at: '2026-04-03T10:00:00.000Z',
            updated_at: '2026-04-03T10:00:00.000Z'
        }, {
            id: 'ticket-email-miss-1',
            user_id: 'user-email-2',
            order_id: '',
            issue_type: 'OTHER',
            status: 'PENDING',
            description: '另一个工单',
            created_at: '2026-04-03T09:00:00.000Z',
            updated_at: '2026-04-03T09:00:00.000Z'
        }],
        profiles: [{
            id: 'user-email-1',
            email: 'ops-search@example.com'
        }, {
            id: 'user-email-2',
            email: 'someone@example.com'
        }]
    }, async (handler) => {
        const req = {
            method: 'GET',
            url: '/api/admin/tickets/list?status=all&page=1&pageSize=10&query=ops-search@example.com',
            headers: {}
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.pagination.totalItems, 1);
        assert.equal(payload.rows.length, 1);
        assert.equal(payload.rows[0].id, 'ticket-email-match-1');
        assert.equal(payload.rows[0].user_email, 'ops-search@example.com');
    });
});

test('tickets list handler supports overdue and high priority filtering with assignment metadata', async () => {
    await withHandler({
        tickets: [{
            id: 'ticket-priority-1',
            user_id: 'user-priority-1',
            order_id: 'order-priority-1',
            issue_type: 'REFUND',
            status: 'PENDING',
            description: [
                '[站内代办转工单]',
                '告警标题：退款异常（order-priority-1）',
                '告警类型：shop_order_refund_risk',
                '订单号：order-priority-1',
                '告警标识：shop_order_refund:order-priority-1'
            ].join('\n'),
            created_at: '2000-01-01T00:00:00.000Z',
            updated_at: '2000-01-01T00:00:00.000Z'
        }, {
            id: 'ticket-normal-1',
            user_id: 'user-normal-1',
            order_id: '',
            issue_type: 'OTHER',
            status: 'PENDING',
            description: '普通售后咨询',
            created_at: '2999-01-01T00:00:00.000Z',
            updated_at: '2999-01-01T00:00:00.000Z'
        }],
        profiles: [{
            id: 'user-priority-1',
            email: 'priority@example.com'
        }],
        orders: [{
            id: 'order-priority-1',
            price_paid: 66,
            refund_status: 'none'
        }],
        auditLogsView: [{
            id: 'audit-assign-1',
            action_type: 'ticket.assign',
            created_at: '2026-04-03T12:00:00.000Z',
            admin_id: 'admin-ticket-list-1',
            admin_email: 'ops@example.com',
            details: {
                ticket_id: 'ticket-priority-1',
                assigned: true,
                assignee_id: 'admin-ticket-list-1',
                assignee_label: 'ops@example.com'
            }
        }]
    }, async (handler) => {
        const req = {
            method: 'GET',
            url: '/api/admin/tickets/list?status=pending&page=1&pageSize=10&overdue=1&priority=high',
            headers: {}
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.filters.overdueOnly, true);
        assert.equal(payload.filters.priority, 'high');
        assert.equal(payload.pagination.totalItems, 1);
        assert.equal(payload.rows.length, 1);
        assert.equal(payload.rows[0].id, 'ticket-priority-1');
        assert.equal(payload.rows[0].is_high_priority, true);
        assert.equal(payload.rows[0].priority_label, '高优先');
        assert.equal(payload.rows[0].assigned_to_label, 'ops@example.com');
        assert.equal(payload.rows[0].assignment_summary, '负责人：ops@example.com');
    });
});

test('tickets list handler supports filtering my tickets and unassigned tickets', async () => {
    await withHandler({
        tickets: [{
            id: 'ticket-mine-1',
            user_id: 'user-mine-1',
            order_id: '',
            issue_type: 'OTHER',
            status: 'PENDING',
            description: '我名下工单',
            created_at: '2026-04-03T12:00:00.000Z',
            updated_at: '2026-04-03T12:00:00.000Z'
        }, {
            id: 'ticket-unassigned-1',
            user_id: 'user-unassigned-1',
            order_id: '',
            issue_type: 'OTHER',
            status: 'PENDING',
            description: '未指派工单',
            created_at: '2026-04-03T11:00:00.000Z',
            updated_at: '2026-04-03T11:00:00.000Z'
        }],
        auditLogsView: [{
            id: 'audit-assign-me-1',
            action_type: 'ticket.assign',
            created_at: '2026-04-03T12:30:00.000Z',
            admin_id: 'admin-ticket-list-1',
            admin_email: 'ops@example.com',
            details: {
                ticket_id: 'ticket-mine-1',
                assigned: true,
                assignee_id: 'admin-ticket-list-1',
                assignee_label: 'ops@example.com'
            }
        }]
    }, async (handler) => {
        const mineReq = {
            method: 'GET',
            url: '/api/admin/tickets/list?status=pending&page=1&pageSize=10&assignee=mine',
            headers: {}
        };
        const mineRes = createMockResponse();

        await handler(mineReq, mineRes);
        const minePayload = mineRes.json();

        assert.equal(minePayload.success, true);
        assert.equal(minePayload.rows.length, 1);
        assert.equal(minePayload.rows[0].id, 'ticket-mine-1');

        const unassignedReq = {
            method: 'GET',
            url: '/api/admin/tickets/list?status=pending&page=1&pageSize=10&assignee=unassigned',
            headers: {}
        };
        const unassignedRes = createMockResponse();

        await handler(unassignedReq, unassignedRes);
        const unassignedPayload = unassignedRes.json();

        assert.equal(unassignedPayload.success, true);
        assert.equal(unassignedPayload.rows.length, 1);
        assert.equal(unassignedPayload.rows[0].id, 'ticket-unassigned-1');
    });
});

test('tickets list handler isolates cn and intl tickets by the current admin site', async () => {
    await withHandler({
        tickets: [{
            id: 'ticket-cn-1',
            user_id: 'user-cn-1',
            site: 'cn',
            order_id: '',
            issue_type: 'OTHER',
            status: 'PENDING',
            description: '国内站工单',
            created_at: '2026-04-04T12:00:00.000Z',
            updated_at: '2026-04-04T12:00:00.000Z'
        }, {
            id: 'ticket-intl-1',
            user_id: 'user-intl-1',
            site: 'intl',
            order_id: '',
            issue_type: 'OTHER',
            status: 'PENDING',
            description: '国际站工单',
            created_at: '2026-04-04T11:00:00.000Z',
            updated_at: '2026-04-04T11:00:00.000Z'
        }]
    }, async (handler) => {
        const req = {
            method: 'GET',
            url: '/api/admin/tickets/list?status=pending&page=1&pageSize=10&site=intl',
            headers: {}
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(payload.success, true);
        assert.equal(payload.filters.site, 'intl');
        assert.equal(payload.rows.length, 1);
        assert.equal(payload.rows[0].id, 'ticket-intl-1');
    });
});
