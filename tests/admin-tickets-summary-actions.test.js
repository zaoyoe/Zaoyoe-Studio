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
            id: 'admin-ticket-summary-1',
            email: 'ops@example.com'
        },
        jobs: [],
        auditLogs: [],
        ...overrides
    };
}

class FakeQuery {
    constructor(state, table) {
        this.state = state;
        this.table = table;
        this.mode = 'select';
        this.patch = null;
        this.filters = [];
    }

    select() {
        return this;
    }

    update(patch = {}) {
        this.mode = 'update';
        this.patch = patch;
        return this;
    }

    eq(field, value) {
        this.filters.push({ field, value });
        return this;
    }

    single() {
        return Promise.resolve(this.exec());
    }

    matches(row) {
        return this.filters.every((filter) => row?.[filter.field] === filter.value);
    }

    exec() {
        if (this.table !== 'ops_alert_jobs') {
            return {
                data: null,
                error: new Error(`Unsupported table: ${this.table}`)
            };
        }

        const rowIndex = this.state.jobs.findIndex((row) => this.matches(row));
        if (rowIndex === -1) {
            return {
                data: null,
                error: new Error('Row not found')
            };
        }

        if (this.mode === 'update') {
            this.state.jobs[rowIndex] = {
                ...this.state.jobs[rowIndex],
                ...(this.patch || {})
            };
        }

        return {
            data: { ...this.state.jobs[rowIndex] },
            error: null
        };
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
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/tickets/summary-actions.js');
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

test('tickets summary actions handler requeues a dead-letter summary job and records audit details', async () => {
    await withHandler({
        jobs: [{
            id: 'summary-job-1',
            alert_type: 'ticket_sla_summary',
            severity: 'critical',
            title: '工单超时汇总（2 条超时工单）',
            payload: {
                summary_schedule_mode: 'daily',
                summary_window_minutes: 1440,
                item_count: 2
            },
            channels: ['feishu', 'email'],
            remaining_channels: ['email'],
            status: 'dead_letter',
            attempt_count: 6,
            max_attempts: 6,
            next_retry_at: null,
            last_attempt_at: '2026-04-04T10:00:00.000Z',
            delivered_at: null,
            last_error: 'Digest webhook timeout',
            worker_name: 'ops-worker-1',
            created_at: '2026-04-04T09:00:00.000Z',
            updated_at: '2026-04-04T10:00:00.000Z'
        }]
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                jobId: 'summary-job-1',
                action: 'request_retry'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.summary_job.status, 'retry');
        assert.equal(payload.summary_job.attempt_count, 0);
        assert.equal(payload.summary_job.last_error, '');
        assert.deepEqual(payload.summary_job.remaining_channels, ['email']);
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'ticket.summary_job_action');
        assert.equal(state.auditLogs[0].details.queue_previous_status, 'dead_letter');
        assert.equal(state.auditLogs[0].details.queue_next_status, 'retry');
        assert.equal(state.auditLogs[0].details.manual_retry_mode, 'requeue');
    });
});

test('tickets summary actions handler expedites an already retrying summary job', async () => {
    await withHandler({
        jobs: [{
            id: 'summary-job-2',
            alert_type: 'ticket_sla_summary',
            severity: 'warning',
            title: '工单超时汇总（1 条超时工单）',
            payload: {
                summary_schedule_mode: 'daily',
                summary_window_minutes: 1440,
                item_count: 1
            },
            channels: ['feishu'],
            remaining_channels: ['feishu'],
            status: 'retry',
            attempt_count: 2,
            max_attempts: 6,
            next_retry_at: '2026-04-04T11:00:00.000Z',
            last_attempt_at: '2026-04-04T10:30:00.000Z',
            delivered_at: null,
            last_error: 'Digest webhook timeout',
            worker_name: 'ops-worker-2',
            created_at: '2026-04-04T09:30:00.000Z',
            updated_at: '2026-04-04T10:30:00.000Z'
        }]
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                jobId: 'summary-job-2',
                action: 'request_retry'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.summary_job.status, 'retry');
        assert.equal(payload.summary_job.attempt_count, 2);
        assert.equal(payload.summary_job.last_error, 'Digest webhook timeout');
        assert.equal(typeof payload.summary_job.next_retry_at, 'string');
        assert.notEqual(payload.summary_job.next_retry_at, '2026-04-04T11:00:00.000Z');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].details.queue_previous_status, 'retry');
        assert.equal(state.auditLogs[0].details.manual_retry_mode, 'expedite');
    });
});

test('tickets summary actions handler records an internal summary note without mutating queue state', async () => {
    await withHandler({
        jobs: [{
            id: 'summary-job-3',
            alert_type: 'ticket_sla_summary',
            severity: 'warning',
            title: '工单超时汇总（3 条超时工单）',
            payload: {
                summary_schedule_mode: 'daily',
                summary_window_minutes: 1440,
                item_count: 3
            },
            channels: ['feishu', 'email'],
            remaining_channels: [],
            status: 'delivered',
            attempt_count: 1,
            max_attempts: 6,
            next_retry_at: null,
            last_attempt_at: '2026-04-04T10:00:00.000Z',
            delivered_at: '2026-04-04T10:01:00.000Z',
            last_error: '',
            worker_name: 'ops-worker-3',
            created_at: '2026-04-04T09:00:00.000Z',
            updated_at: '2026-04-04T10:01:00.000Z'
        }]
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            body: {
                jobId: 'summary-job-3',
                action: 'add_note',
                note: '已联系值班同学检查 webhook 证书'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.message, '已记录人工备注');
        assert.equal(payload.summary_job.status, 'delivered');
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'ticket.summary_job_action');
        assert.equal(state.auditLogs[0].details.action, 'add_note');
        assert.equal(state.auditLogs[0].details.note, '已联系值班同学检查 webhook 证书');
        assert.equal(state.auditLogs[0].details.queue_previous_status, 'delivered');
        assert.equal(state.jobs[0].status, 'delivered');
    });
});
