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
        user: { id: 'admin-ticket-metrics-1', email: 'ops@example.com' },
        tickets: [],
        profiles: [],
        orders: [],
        opsAlertJobs: [],
        opsAlertJobAttempts: [],
        auditLogsView: [],
        auditLogs: [],
        tableErrors: {},
        ...overrides
    };
}

function getComparableValue(value) {
    const dateValue = Date.parse(String(value || ''));
    if (Number.isFinite(dateValue)) {
        return dateValue;
    }

    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
        return numericValue;
    }

    return String(value || '');
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
    }

    select() {
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

    gte(field, value) {
        this.filters.push({ op: 'gte', field, value });
        return this;
    }

    lte(field, value) {
        this.filters.push({ op: 'lte', field, value });
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
        if (this.table === 'ops_alert_jobs') return this.state.opsAlertJobs;
        if (this.table === 'ops_alert_job_attempts') return this.state.opsAlertJobAttempts;
        if (this.table === 'admin_audit_logs_view') return this.state.auditLogsView;
        if (this.table === 'admin_audit_logs') return this.state.auditLogs;
        return [];
    }

    matchesFilter(row, filter) {
        const rowValue = row?.[filter.field];

        if (filter.op === 'eq') {
            return rowValue === filter.value;
        }

        if (filter.op === 'in') {
            return filter.values.includes(rowValue);
        }

        if (filter.op === 'gte') {
            return getComparableValue(rowValue) >= getComparableValue(filter.value);
        }

        if (filter.op === 'lte') {
            return getComparableValue(rowValue) <= getComparableValue(filter.value);
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
                const leftValue = getComparableValue(left?.[this.orderField]);
                const rightValue = getComparableValue(right?.[this.orderField]);
                if (leftValue === rightValue) return 0;
                return this.orderAscending
                    ? (leftValue > rightValue ? 1 : -1)
                    : (leftValue > rightValue ? -1 : 1);
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
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/tickets/metrics.js');
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
                            enabled: true,
                            tickets: {
                                enabled: true,
                                sweep_interval_ms: 10 * 60 * 1000,
                                pending_overdue_minutes: 60,
                                critical_overdue_minutes: 180,
                                page_size: 100,
                                max_pages: 10,
                                work_hours_only_enabled: true,
                                summary_enabled: true,
                                summary_schedule_mode: 'hourly',
                                summary_hourly_minute: 15,
                                summary_window_minutes: 90
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

function createAuditFixtures() {
    return [{
        id: 'audit-assign-pending-1',
        action_type: 'ticket.assign',
        created_at: '2026-04-03T10:35:00.000Z',
        admin_id: 'admin-ticket-metrics-1',
        admin_email: 'ops@example.com',
        details: {
            ticket_id: 'ticket-chat-pending-1',
            assigned: true,
            assignee_id: 'admin-ticket-metrics-1',
            assignee_label: 'ops@example.com'
        }
    }, {
        id: 'audit-assign-closed-1',
        action_type: 'ticket.assign',
        created_at: '2026-03-31T10:00:00.000Z',
        admin_id: 'admin-ticket-metrics-1',
        admin_email: 'ops@example.com',
        details: {
            ticket_id: 'ticket-resolved-1',
            assigned: true,
            assignee_id: 'admin-ticket-metrics-1',
            assignee_label: 'ops@example.com'
        }
    }, {
        id: 'audit-process-closed-1',
        action_type: 'ticket.process',
        created_at: '2026-03-31T12:00:00.000Z',
        admin_id: 'admin-ticket-metrics-1',
        admin_email: 'ops@example.com',
        details: {
            ticket_id: 'ticket-resolved-1',
            new_status: 'RESOLVED',
            refunded: true,
            refund_amount: 66,
            refund_outcome: 'refunded'
        }
    }, {
        id: 'audit-note-closed-2',
        action_type: 'ticket.internal_note',
        created_at: '2026-04-01T08:20:00.000Z',
        admin_id: 'admin-ticket-metrics-1',
        admin_email: 'ops@example.com',
        details: {
            ticket_id: 'ticket-rejected-1',
            note: '需要补充资料'
        }
    }, {
        id: 'audit-process-closed-2',
        action_type: 'ticket.process',
        created_at: '2026-04-01T09:00:00.000Z',
        admin_id: 'admin-ticket-metrics-1',
        admin_email: 'ops@example.com',
        details: {
            ticket_id: 'ticket-rejected-1',
            new_status: 'REJECTED',
            refund_outcome: 'not_requested'
        }
    }];
}

function createReminderFixtures() {
    return {
        jobs: [{
            id: 'ticket-sla-job-overdue-1',
            alert_type: 'ticket_sla_overdue',
            severity: 'critical',
            title: '工单超时未处理（ticket-ch）',
            payload: {
                target_id: 'ticket-chat-pending-1',
                ticket_id: 'ticket-chat-pending-1',
                wait_label: '1 小时 30 分钟'
            },
            channels: ['feishu'],
            remaining_channels: [],
            status: 'delivered',
            attempt_count: 1,
            last_error: '',
            created_at: '2026-04-03T10:10:00.000Z',
            delivered_at: '2026-04-03T10:11:00.000Z'
        }, {
            id: 'ticket-sla-job-recovered-1',
            alert_type: 'ticket_sla_recovered',
            severity: 'warning',
            title: '工单超时已恢复（ticket-op）',
            payload: {
                target_id: 'ticket-ops-pending-1',
                ticket_id: 'ticket-ops-pending-1',
                previous_wait_label: '4 小时 30 分钟'
            },
            channels: ['feishu', 'email'],
            remaining_channels: ['email'],
            status: 'retry',
            attempt_count: 2,
            last_error: 'Webhook timeout',
            created_at: '2026-04-03T11:20:00.000Z',
            delivered_at: ''
        }, {
            id: 'ticket-sla-job-summary-2',
            alert_type: 'ticket_sla_summary',
            severity: 'warning',
            title: '工单超时汇总（1 条超时工单）',
            payload: {
                summary_schedule_mode: 'daily',
                summary_window_minutes: 1440,
                summary_max_items: 5,
                summary_daily_hour: 9,
                summary_daily_minute: 15,
                summary_timezone: 'Asia/Shanghai',
                window_start_at: '2026-04-01T01:15:00.000Z',
                window_end_at: '2026-04-02T01:15:00.000Z',
                item_count: 1,
                entry_path: '售后工单 -> 待处理 -> 工单详情',
                items: [{
                    alert_type: 'ticket_sla_overdue',
                    payload: {
                        ticket_id: 'ticket-chat-pending-1',
                        order_id: 'order-chat-1',
                        user_id: 'user-chat-1',
                        user_email: 'chat@example.com',
                        wait_label: '1 小时 10 分钟',
                        ticket_status: 'PENDING',
                        responsible_label: 'ops@example.com',
                        reason: '用户再次催单',
                        updated_at: '2026-04-02T09:35:00.000Z'
                    }
                }]
            },
            channels: ['feishu', 'email'],
            remaining_channels: ['email'],
            status: 'retry',
            attempt_count: 1,
            last_error: 'Digest webhook timeout',
            created_at: '2026-04-02T09:40:00.000Z',
            delivered_at: ''
        }, {
            id: 'ticket-sla-job-summary-1',
            alert_type: 'ticket_sla_summary',
            severity: 'critical',
            title: '工单超时汇总（2 条超时工单）',
            payload: {
                summary_schedule_mode: 'daily',
                summary_window_minutes: 1440,
                summary_max_items: 5,
                summary_daily_hour: 9,
                summary_daily_minute: 15,
                summary_timezone: 'Asia/Shanghai',
                window_start_at: '2026-04-02T01:15:00.000Z',
                window_end_at: '2026-04-03T01:15:00.000Z',
                item_count: 2,
                entry_path: '售后工单 -> 待处理 -> 工单详情',
                items: [{
                    alert_type: 'ticket_sla_overdue',
                    payload: {
                        ticket_id: 'ticket-chat-pending-1',
                        order_id: 'order-chat-1',
                        user_id: 'user-chat-1',
                        user_email: 'chat@example.com',
                        wait_label: '1 小时 30 分钟',
                        ticket_status: 'PENDING',
                        responsible_label: 'ops@example.com',
                        reason: '用户申请退款',
                        updated_at: '2026-04-03T10:10:00.000Z'
                    }
                }, {
                    alert_type: 'ticket_sla_overdue',
                    payload: {
                        ticket_id: 'ticket-ops-pending-1',
                        order_id: 'order-ops-1',
                        user_id: 'user-ops-1',
                        user_email: 'ops@example.com',
                        wait_label: '4 小时 30 分钟',
                        ticket_status: 'PENDING',
                        responsible_label: '未分配',
                        reason: '履约失败',
                        updated_at: '2026-04-03T11:05:00.000Z'
                    }
                }]
            },
            channels: ['feishu'],
            remaining_channels: [],
            status: 'delivered',
            attempt_count: 1,
            last_error: '',
            created_at: '2026-04-03T12:15:00.000Z',
            delivered_at: '2026-04-03T12:16:00.000Z'
        }],
        attempts: [{
            job_id: 'ticket-sla-job-overdue-1',
            channel: 'feishu',
            status: 'delivered',
            response_status: 200,
            error_message: '',
            created_at: '2026-04-03T10:11:00.000Z'
        }, {
            job_id: 'ticket-sla-job-recovered-1',
            channel: 'feishu',
            status: 'failed',
            response_status: 504,
            error_message: 'Webhook timeout',
            created_at: '2026-04-03T11:22:00.000Z'
        }, {
            job_id: 'ticket-sla-job-summary-2',
            channel: 'feishu',
            status: 'failed',
            response_status: 504,
            error_message: 'Digest webhook timeout',
            created_at: '2026-04-02T09:41:00.000Z'
        }, {
            job_id: 'ticket-sla-job-summary-1',
            channel: 'feishu',
            status: 'delivered',
            response_status: 200,
            error_message: '',
            created_at: '2026-04-03T12:16:00.000Z'
        }]
    };
}

function createSummaryAuditFixtures() {
    return [{
        id: 'audit-summary-retry-1',
        action_type: 'ticket.summary_job_action',
        created_at: '2026-04-02T09:45:00.000Z',
        admin_id: 'admin-ticket-metrics-1',
        admin_email: 'ops@example.com',
        details: {
            action: 'request_retry',
            job_id: 'ticket-sla-job-summary-2',
            queue_previous_status: 'dead_letter',
            queue_next_status: 'retry',
            manual_retry_mode: 'requeue',
            queue_channel_count: 1,
            item_count: 1
        }
    }, {
        id: 'audit-summary-note-1',
        action_type: 'ticket.summary_job_action',
        created_at: '2026-04-03T12:50:00.000Z',
        admin_id: 'admin-ticket-metrics-1',
        admin_email: 'lead@example.com',
        details: {
            action: 'add_note',
            job_id: 'ticket-sla-job-summary-1',
            note: '已由值班同学确认送达，无需继续跟进'
        }
    }];
}

test('tickets metrics handler returns backlog, efficiency, distributions, and reminder state', async () => {
    const reminderFixtures = createReminderFixtures();
    await withHandler({
        tickets: [{
            id: 'ticket-chat-pending-1',
            user_id: 'user-chat-1',
            order_id: 'order-chat-1',
            issue_type: 'REFUND',
            status: 'PENDING',
            description: [
                '[客服会话转工单]',
                '告警标题：客服会话跟进（user-chat-1）',
                '用户邮箱：chat@example.com'
            ].join('\n'),
            created_at: '2026-04-03T10:00:00.000Z',
            updated_at: '2026-04-03T10:00:00.000Z'
        }, {
            id: 'ticket-ops-pending-1',
            user_id: 'user-ops-1',
            order_id: 'order-ops-1',
            issue_type: 'DELIVERY',
            status: 'OPEN',
            description: [
                '[站内代办转工单]',
                '告警标题：履约失败（order-ops-1）',
                '告警类型：shop_order_delivery_failed',
                '订单号：order-ops-1',
                '告警标识：shop_order_delivery:order-ops-1'
            ].join('\n'),
            created_at: '2026-04-03T07:00:00.000Z',
            updated_at: '2026-04-03T07:00:00.000Z'
        }, {
            id: 'ticket-resolved-1',
            user_id: 'user-closed-1',
            order_id: 'order-closed-1',
            issue_type: 'REFUND',
            status: 'RESOLVED',
            description: '已完成退款处理',
            created_at: '2026-03-31T09:00:00.000Z',
            updated_at: '2026-03-31T12:00:00.000Z'
        }, {
            id: 'ticket-rejected-1',
            user_id: 'user-closed-2',
            order_id: '',
            issue_type: 'OTHER',
            status: 'REJECTED',
            description: '资料不完整',
            created_at: '2026-04-01T08:00:00.000Z',
            updated_at: '2026-04-01T09:00:00.000Z'
        }],
        profiles: [{
            id: 'user-chat-1',
            email: 'chat@example.com'
        }, {
            id: 'user-ops-1',
            email: 'ops@example.com'
        }],
        orders: [{
            id: 'order-chat-1',
            price_paid: 66,
            refund_status: 'none'
        }, {
            id: 'order-ops-1',
            price_paid: 0,
            refund_status: 'none'
        }],
        opsAlertJobs: reminderFixtures.jobs,
        opsAlertJobAttempts: reminderFixtures.attempts,
        auditLogsView: [
            ...createAuditFixtures(),
            ...createSummaryAuditFixtures()
        ]
    }, async (handler) => {
        const req = {
            method: 'GET',
            url: '/api/admin?route=tickets/metrics',
            headers: {},
            now: new Date('2026-04-03T11:30:00.000Z')
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.overview.backlog.total_pending, 2);
        assert.equal(payload.overview.backlog.assigned_count, 1);
        assert.equal(payload.overview.backlog.unassigned_count, 1);
        assert.equal(payload.overview.backlog.overdue_count, 2);
        assert.equal(payload.overview.backlog.critical_overdue_count, 1);
        assert.equal(payload.overview.backlog.high_priority_count, 2);
        assert.equal(payload.overview.backlog.refundable_count, 1);
        assert.equal(payload.overview.backlog.oldest_wait_minutes, 270);

        assert.deepEqual(
            payload.overview.sources.map((item) => ({ key: item.key, count: item.count })),
            [
                { key: 'chat_session', count: 1 },
                { key: 'ops_alert', count: 1 }
            ]
        );
        assert.deepEqual(
            payload.overview.issue_types.map((item) => ({ key: item.key, count: item.count })),
            [
                { key: 'DELIVERY', count: 1 },
                { key: 'REFUND', count: 1 }
            ]
        );

        assert.equal(payload.overview.efficiency.closed_count, 2);
        assert.equal(payload.overview.efficiency.resolved_count, 1);
        assert.equal(payload.overview.efficiency.rejected_count, 1);
        assert.equal(payload.overview.efficiency.refund_related_count, 1);
        assert.equal(payload.overview.efficiency.avg_first_touch_minutes, 40);
        assert.equal(payload.overview.efficiency.first_touch_sample_count, 2);
        assert.equal(payload.overview.efficiency.avg_resolution_minutes, 120);
        assert.equal(payload.overview.efficiency.resolution_sample_count, 2);
        assert.equal(payload.overview.efficiency.resolved_rate_percent, 50);
        assert.equal(payload.overview.efficiency.rejected_rate_percent, 50);
        assert.equal(payload.overview.efficiency.refund_related_rate_percent, 50);

        assert.equal(payload.overview.reminder.enabled, true);
        assert.equal(payload.overview.reminder.work_hours_only_enabled, true);
        assert.equal(payload.overview.reminder.summary_enabled, true);
        assert.equal(payload.overview.reminder.pending_overdue_minutes, 60);
        assert.equal(payload.overview.reminder.critical_overdue_minutes, 180);
        assert.equal(payload.overview.reminder.summary_schedule_mode, 'hourly');
        assert.equal(payload.overview.reminder.summary_hourly_minute, 15);
        assert.equal(payload.overview.reminder.activity.lookback_days, 7);
        assert.equal(payload.overview.reminder.activity.overdue_job_count, 1);
        assert.equal(payload.overview.reminder.activity.recovered_job_count, 1);
        assert.equal(payload.overview.reminder.activity.delivered_count, 1);
        assert.equal(payload.overview.reminder.activity.active_count, 1);
        assert.equal(payload.overview.reminder.activity.retry_count, 1);
        assert.equal(payload.overview.reminder.activity.dead_letter_count, 0);
        assert.equal(payload.overview.reminder.activity.latest_job.kind, 'recovered');
        assert.equal(payload.overview.reminder.activity.latest_job.status, 'retry');
        assert.equal(payload.overview.reminder.activity.latest_job.latest_attempt.channel, 'feishu');
        assert.equal(payload.overview.reminder.activity.latest_overdue.status, 'delivered');
        assert.equal(payload.overview.reminder.activity.latest_overdue.wait_label, '1 小时 30 分钟');
        assert.equal(payload.overview.reminder.activity.latest_recovered.last_error, 'Webhook timeout');
        assert.equal(payload.overview.reminder.summary_digest.total_job_count, 2);
        assert.equal(payload.overview.reminder.summary_digest.daily_job_count, 2);
        assert.equal(payload.overview.reminder.summary_digest.delivered_count, 1);
        assert.equal(payload.overview.reminder.summary_digest.retry_count, 1);
        assert.equal(payload.overview.reminder.summary_digest.failure_job_count, 1);
        assert.equal(payload.overview.reminder.summary_digest.latest_job.status, 'delivered');
        assert.equal(payload.overview.reminder.summary_digest.latest_job.summary_schedule_mode, 'daily');
        assert.equal(payload.overview.reminder.summary_digest.latest_job.item_count, 2);
        assert.equal(payload.overview.reminder.summary_digest.latest_daily_job.preview_items[0].ticket_id, 'ticket-chat-pending-1');
        assert.equal(payload.overview.reminder.summary_digest.latest_daily_job.preview_items[1].responsible_label, '未分配');
        assert.equal(payload.overview.reminder.summary_digest.latest_job.manual_event_count, 1);
        assert.equal(payload.overview.reminder.summary_digest.latest_job.latest_manual_event.title, '记录人工备注');
        assert.equal(payload.overview.reminder.summary_digest.latest_job.latest_manual_event.actor, 'lead@example.com');
        assert.equal(payload.overview.reminder.summary_digest.latest_problem_job.status, 'retry');
        assert.equal(payload.overview.reminder.summary_digest.latest_problem_job.last_error, 'Digest webhook timeout');
        assert.equal(payload.overview.reminder.summary_digest.latest_problem_job.latest_manual_event.title, '人工重新加入重试队列');
        assert.equal(payload.overview.reminder.summary_digest.recent_jobs.length, 2);
        assert.equal(payload.overview.reminder.summary_digest.recent_jobs[1].preview_items[0].reason, '用户再次催单');
    });
});

test('tickets metrics handler falls back to admin_audit_logs when the view is unavailable', async () => {
    await withHandler({
        tickets: [{
            id: 'ticket-chat-pending-1',
            user_id: 'user-chat-1',
            order_id: '',
            issue_type: 'OTHER',
            status: 'PENDING',
            description: '普通售后咨询',
            created_at: '2026-04-03T08:00:00.000Z',
            updated_at: '2026-04-03T08:00:00.000Z'
        }],
        auditLogs: createAuditFixtures(),
        tableErrors: {
            admin_audit_logs_view: {
                message: 'relation "admin_audit_logs_view" does not exist'
            },
            ops_alert_jobs: {
                message: 'relation "ops_alert_jobs" does not exist'
            }
        }
    }, async (handler) => {
        const req = {
            method: 'GET',
            url: '/api/admin?route=tickets/metrics',
            headers: {},
            now: new Date('2026-04-03T11:30:00.000Z')
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.overview.backlog.total_pending, 1);
        assert.equal(payload.overview.reminder.activity.total_job_count, 0);
        assert.equal(payload.overview.reminder.summary_digest.total_job_count, 0);
    });
});
