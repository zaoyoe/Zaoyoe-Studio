const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

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

function createState(overrides = {}) {
    return {
        user: {
            id: 'admin-ticket-summary-history-1',
            email: 'ops@example.com'
        },
        jobs: [],
        attempts: [],
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
        this.limitCount = null;
    }

    select() {
        return this;
    }

    eq(field, value) {
        this.filters.push({ op: 'eq', field, value });
        return this;
    }

    in(field, values = []) {
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

    single() {
        return Promise.resolve(this.execSingle());
    }

    getRows() {
        if (this.table === 'ops_alert_jobs') return this.state.jobs;
        if (this.table === 'ops_alert_job_attempts') return this.state.attempts;
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
        return true;
    }

    buildRows() {
        const tableError = this.state.tableErrors?.[this.table] || null;
        if (tableError) {
            throw tableError;
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
        if (Number.isFinite(this.limitCount)) {
            rows = rows.slice(0, this.limitCount);
        }
        return rows;
    }

    execSingle() {
        try {
            const rows = this.buildRows();
            if (!rows.length) {
                return {
                    data: null,
                    error: new Error('Row not found')
                };
            }
            return {
                data: rows[0],
                error: null
            };
        } catch (error) {
            return {
                data: null,
                error
            };
        }
    }

    then(resolve, reject) {
        try {
            return Promise.resolve({
                data: this.buildRows(),
                error: null
            }).then(resolve, reject);
        } catch (error) {
            return Promise.resolve({
                data: [],
                error
            }).then(resolve, reject);
        }
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
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/tickets/summary-history.js');
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

test('tickets summary history handler returns creation, attempts, retry actions, and manual notes in timeline order', async () => {
    await withHandler({
        jobs: [{
            id: 'summary-job-history-1',
            alert_type: 'ticket_sla_summary',
            severity: 'critical',
            title: '工单超时汇总（2 条超时工单）',
            payload: {
                summary_schedule_mode: 'daily',
                summary_window_minutes: 1440,
                summary_daily_hour: 9,
                summary_daily_minute: 30,
                window_start_at: '2026-04-03T01:30:00.000Z',
                window_end_at: '2026-04-04T01:30:00.000Z',
                item_count: 2,
                entry_path: '售后工单 -> 看板'
            },
            channels: ['feishu', 'email'],
            remaining_channels: ['email'],
            status: 'retry',
            attempt_count: 2,
            max_attempts: 6,
            next_retry_at: '2026-04-04T10:15:00.000Z',
            last_attempt_at: '2026-04-04T10:00:00.000Z',
            delivered_at: null,
            last_error: 'Digest webhook timeout',
            worker_name: 'ops-worker-1',
            created_at: '2026-04-04T09:30:00.000Z',
            updated_at: '2026-04-04T10:02:00.000Z'
        }],
        attempts: [{
            job_id: 'summary-job-history-1',
            channel: 'feishu',
            status: 'failed',
            response_status: 504,
            error_message: 'Digest webhook timeout',
            created_at: '2026-04-04T10:00:00.000Z'
        }],
        auditLogsView: [{
            id: 'audit-summary-retry-1',
            action_type: 'ticket.summary_job_action',
            created_at: '2026-04-04T10:01:00.000Z',
            admin_id: 'admin-ticket-summary-history-1',
            admin_email: 'ops@example.com',
            details: {
                action: 'request_retry',
                job_id: 'summary-job-history-1',
                queue_previous_status: 'dead_letter',
                queue_next_status: 'retry',
                queue_channel_count: 1,
                manual_retry_mode: 'requeue',
                item_count: 2
            }
        }, {
            id: 'audit-summary-note-1',
            action_type: 'ticket.summary_job_action',
            created_at: '2026-04-04T10:02:00.000Z',
            admin_id: 'admin-ticket-summary-history-1',
            admin_email: 'ops@example.com',
            details: {
                action: 'add_note',
                job_id: 'summary-job-history-1',
                note: '已联系值班同学排查邮件通道'
            }
        }]
    }, async (handler) => {
        const req = {
            method: 'GET',
            url: '/api/admin?route=tickets/summary-history&jobId=summary-job-history-1',
            headers: {}
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.summary_job.status, 'retry');
        assert.equal(payload.items.length, 5);
        assert.equal(payload.items[0].title, '生成 SLA 汇总任务');
        assert.equal(payload.items[1].title, '汇总投递失败');
        assert.equal(payload.items[2].title, '人工重新加入重试队列');
        assert.equal(payload.items[3].title, '记录人工备注');
        assert.equal(payload.items[4].title, '汇总任务等待自动重试');
        assert.match(payload.items[2].detail, /重试方式：重新入队/);
        assert.match(payload.items[3].detail, /已联系值班同学排查邮件通道/);
        assert.match(payload.items[4].detail, /下次重试/);
    });
});

test('tickets summary history handler falls back to admin_audit_logs when the view is unavailable', async () => {
    await withHandler({
        jobs: [{
            id: 'summary-job-history-2',
            alert_type: 'ticket_sla_summary',
            severity: 'warning',
            title: '工单超时汇总（1 条超时工单）',
            payload: {
                summary_schedule_mode: 'daily',
                summary_window_minutes: 1440,
                item_count: 1
            },
            channels: ['feishu'],
            remaining_channels: [],
            status: 'delivered',
            attempt_count: 1,
            max_attempts: 6,
            next_retry_at: null,
            last_attempt_at: '2026-04-04T09:10:00.000Z',
            delivered_at: '2026-04-04T09:11:00.000Z',
            last_error: '',
            worker_name: 'ops-worker-2',
            created_at: '2026-04-04T09:00:00.000Z',
            updated_at: '2026-04-04T09:11:00.000Z'
        }],
        auditLogs: [{
            id: 'audit-summary-note-fallback-1',
            action_type: 'ticket.summary_job_action',
            created_at: '2026-04-04T09:12:00.000Z',
            admin_id: 'admin-ticket-summary-history-1',
            details: {
                action: 'add_note',
                job_id: 'summary-job-history-2',
                note: '改走备用通道后已恢复'
            }
        }],
        tableErrors: {
            admin_audit_logs_view: {
                message: 'relation "admin_audit_logs_view" does not exist'
            }
        }
    }, async (handler) => {
        const req = {
            method: 'GET',
            url: '/api/admin?route=tickets/summary-history&jobId=summary-job-history-2',
            headers: {}
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.items.some((item) => item.title === '记录人工备注'), true);
        assert.equal(payload.items.some((item) => /备用通道/.test(item.detail)), true);
    });
});
