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
        user: { id: 'admin-assign-1', email: 'ops@example.com' },
        tickets: [],
        auditLogsView: [],
        auditLogs: [],
        tableErrors: {},
        writtenAuditLogs: [],
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
        if (this.table === 'shop_tickets') return this.state.tickets;
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
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/tickets/assign.js');
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
                    state.writtenAuditLogs.push(entry);
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

test('tickets assign handler writes assign-self audit entries for pending tickets', async () => {
    await withHandler({
        tickets: [{
            id: 'ticket-assign-1',
            user_id: 'user-1',
            order_id: 'order-1',
            status: 'PENDING'
        }, {
            id: 'ticket-assign-2',
            user_id: 'user-2',
            order_id: '',
            status: 'OPEN'
        }, {
            id: 'ticket-assign-3',
            user_id: 'user-3',
            order_id: '',
            status: 'RESOLVED'
        }]
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                ticketIds: ['ticket-assign-1', 'ticket-assign-2', 'ticket-assign-3'],
                operation: 'assign_self'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.changedCount, 2);
        assert.equal(payload.skippedCount, 1);
        assert.equal(state.writtenAuditLogs.length, 2);
        assert.equal(state.writtenAuditLogs[0].actionType, 'ticket.assign');
        assert.equal(state.writtenAuditLogs[0].details.assignee_label, 'ops@example.com');
        assert.equal(state.writtenAuditLogs[0].details.assigned, true);
    });
});

test('tickets assign handler clears an existing assignee through audit history', async () => {
    await withHandler({
        tickets: [{
            id: 'ticket-clear-1',
            user_id: 'user-clear-1',
            order_id: '',
            status: 'PENDING'
        }],
        auditLogsView: [{
            id: 'audit-assign-existing-1',
            action_type: 'ticket.assign',
            created_at: '2026-04-03T10:00:00.000Z',
            admin_id: 'admin-assign-0',
            admin_email: 'lead@example.com',
            details: {
                ticket_id: 'ticket-clear-1',
                assigned: true,
                assignee_id: 'admin-assign-0',
                assignee_label: 'lead@example.com'
            }
        }]
    }, async (handler, state) => {
        const req = {
            method: 'POST',
            headers: {},
            body: {
                ticketIds: ['ticket-clear-1'],
                operation: 'clear'
            }
        };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.changedCount, 1);
        assert.equal(state.writtenAuditLogs.length, 1);
        assert.equal(state.writtenAuditLogs[0].details.assigned, false);
        assert.equal(state.writtenAuditLogs[0].details.previous_assignee_label, 'lead@example.com');
    });
});
