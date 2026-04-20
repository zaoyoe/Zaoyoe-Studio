const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

function cloneRows(rows = []) {
    return rows.map((row) => ({ ...row }));
}

function projectRows(rows, columns = '*') {
    const normalized = String(columns || '*').trim();
    if (!normalized || normalized === '*') {
        return cloneRows(rows);
    }

    const fields = normalized.split(',').map((field) => field.trim()).filter(Boolean);
    return rows.map((row) => fields.reduce((accumulator, field) => {
        accumulator[field] = row[field];
        return accumulator;
    }, {}));
}

function matchesLike(value, pattern) {
    const normalizedValue = String(value || '');
    const normalizedPattern = String(pattern || '');
    if (!normalizedPattern.includes('%')) {
        return normalizedValue === normalizedPattern;
    }

    if (normalizedPattern.endsWith('%') && normalizedPattern.indexOf('%') === normalizedPattern.length - 1) {
        return normalizedValue.startsWith(normalizedPattern.slice(0, -1));
    }

    const escaped = normalizedPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*');
    return new RegExp(`^${escaped}$`).test(normalizedValue);
}

function applyFilters(rows, filters = []) {
    return rows.filter((row) => filters.every((filter) => {
        if (filter.type === 'in') {
            return filter.values.includes(row[filter.column]);
        }

        if (filter.type === 'like') {
            return matchesLike(row[filter.column], filter.pattern);
        }

        throw new Error(`Unsupported filter type: ${filter.type}`);
    }));
}

function createQueryBuilder(state, table) {
    const query = {
        mode: 'select',
        selectColumns: '*',
        filters: [],
        head: false,
        order: null,
        limit: null
    };

    const builder = {
        select(columns = '*', options = {}) {
            query.selectColumns = columns;
            query.head = Boolean(options?.head);
            return builder;
        },
        like(column, pattern) {
            query.filters.push({ type: 'like', column, pattern });
            return builder;
        },
        in(column, values) {
            query.filters.push({ type: 'in', column, values: Array.isArray(values) ? values : [] });
            return builder;
        },
        order(column, options = {}) {
            query.order = {
                column,
                ascending: Boolean(options?.ascending)
            };
            return builder;
        },
        limit(value) {
            query.limit = Number.parseInt(value, 10);
            return builder;
        },
        delete() {
            query.mode = 'delete';
            return builder;
        },
        then(resolve, reject) {
            return Promise.resolve(executeQuery(state, table, query)).then(resolve, reject);
        },
        catch(reject) {
            return builder.then(undefined, reject);
        }
    };

    return builder;
}

function executeQuery(state, table, query) {
    const rows = state.tables[table] || [];
    const filteredRows = applyFilters(rows, query.filters);

    if (query.mode === 'delete') {
        const remainingRows = rows.filter((row) => !filteredRows.includes(row));
        state.tables[table] = remainingRows;
        return {
            data: projectRows(filteredRows, query.selectColumns || 'id'),
            error: null
        };
    }

    if (query.head) {
        return {
            count: filteredRows.length,
            error: null
        };
    }

    let selectedRows = cloneRows(filteredRows);
    if (query.order?.column) {
        const { column, ascending } = query.order;
        selectedRows.sort((left, right) => {
            const leftValue = Date.parse(left?.[column] || 0) || 0;
            const rightValue = Date.parse(right?.[column] || 0) || 0;
            return ascending ? leftValue - rightValue : rightValue - leftValue;
        });
    }

    if (Number.isFinite(query.limit) && query.limit >= 0) {
        selectedRows = selectedRows.slice(0, query.limit);
    }

    return {
        data: projectRows(selectedRows, query.selectColumns),
        error: null
    };
}

function createSupabaseStub(state) {
    const authUsers = state.authUsers || [];
    const listUsersFailures = Array.isArray(state.listUsersFailures)
        ? [...state.listUsersFailures]
        : [];

    return {
        auth: {
            admin: {
                async listUsers({ page = 1, perPage = 200 } = {}) {
                    state.listUsersCalls = Number(state.listUsersCalls || 0) + 1;
                    if (listUsersFailures.length > 0) {
                        throw listUsersFailures.shift();
                    }
                    const start = (page - 1) * perPage;
                    const users = authUsers.slice(start, start + perPage).map((user) => ({ ...user }));
                    return { data: { users }, error: null };
                },
                async deleteUser(userId) {
                    const index = authUsers.findIndex((user) => user.id === userId);
                    if (index >= 0) {
                        authUsers.splice(index, 1);
                    }
                    return { data: { user: null }, error: null };
                }
            }
        },
        from(table) {
            return createQueryBuilder(state, table);
        }
    };
}

function createMockAdminModule(state) {
    const supabaseAdmin = createSupabaseStub(state);
    state.auditLogs = state.auditLogs || [];

    return {
        getSupabaseAdmin() {
            return supabaseAdmin;
        },
        async requireAdmin() {
            return {
                user: {
                    id: 'admin-1',
                    email: 'admin@example.com'
                }
            };
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
    const responseState = {
        statusCode: 200,
        headers: {},
        body: ''
    };

    return {
        status(code) {
            responseState.statusCode = code;
            return this;
        },
        setHeader(name, value) {
            responseState.headers[String(name).toLowerCase()] = value;
            return this;
        },
        end(payload = '') {
            responseState.body = String(payload || '');
            return this;
        },
        json() {
            return responseState.body ? JSON.parse(responseState.body) : {};
        },
        get statusCode() {
            return responseState.statusCode;
        }
    };
}

async function withCleanupHandler(state, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/payments/cleanup.js');
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

function createFixtureState() {
    return {
        authUsers: [
            { id: 'legacy-user', email: 'codex.one@example.com' },
            { id: 'smoke-user', email: 'smoke-payment-20260323@zaoyoe.invalid' },
            { id: 'real-user', email: 'real-user@example.com' }
        ],
        tables: {
            payment_checkout_sessions: [
                { id: 'pcs-legacy', user_id: 'legacy-user' },
                { id: 'pcs-smoke', user_id: 'smoke-user' },
                { id: 'pcs-real', user_id: 'real-user' }
            ],
            payment_orders: [
                { id: 'order-legacy', provider_order_no: 'AUTO_CDX_ORDER_1', status: 'redeemed', paid_amount: 1, created_at: '2026-03-20T00:00:00.000Z' },
                { id: 'order-smoke', provider_order_no: 'SMOKE_ORDER_1', status: 'redeemed', paid_amount: 1, created_at: '2026-03-21T00:00:00.000Z' },
                { id: 'order-real', provider_order_no: 'REAL_ORDER_1', status: 'paid', paid_amount: 12, created_at: '2026-03-22T00:00:00.000Z' }
            ],
            payment_events: [
                { id: 'event-legacy', provider_order_no: 'AUTO_CDX_ORDER_1' },
                { id: 'event-smoke', provider_order_no: 'SMOKE_ORDER_1' },
                { id: 'event-real', provider_order_no: 'REAL_ORDER_1' }
            ],
            afdian_orders: [
                { id: 'afdian-legacy', out_trade_no: 'AUTO_CDX_ORDER_1' },
                { id: 'afdian-smoke', out_trade_no: 'SMOKE_ORDER_1' },
                { id: 'afdian-real', out_trade_no: 'REAL_ORDER_1' }
            ],
            profiles: [
                { id: 'legacy-user' },
                { id: 'smoke-user' },
                { id: 'real-user' }
            ],
            points_balance: [
                { user_id: 'legacy-user', site: 'cn' },
                { user_id: 'smoke-user', site: 'cn' },
                { user_id: 'real-user', site: 'cn' }
            ],
            points_ledger: [
                { id: 'ledger-legacy-bonus', user_id: 'legacy-user', created_by: 'legacy-user', reference_id: 'REG_BONUS_legacy-user' },
                { id: 'ledger-smoke-bonus', user_id: 'smoke-user', created_by: 'smoke-user', reference_id: 'REG_BONUS_smoke-user' },
                { id: 'ledger-smoke-order', user_id: 'smoke-user', created_by: 'admin-1', reference_id: 'mock_SMOKE_ORDER_1' },
                { id: 'ledger-real-order', user_id: 'real-user', created_by: 'admin-1', reference_id: 'mock_REAL_ORDER_1' }
            ],
            user_checkins: [
                { id: 'checkin-legacy', user_id: 'legacy-user' },
                { id: 'checkin-smoke', user_id: 'smoke-user' }
            ],
            user_events: [
                { id: 'event-user-legacy', user_id: 'legacy-user' },
                { id: 'event-user-smoke', user_id: 'smoke-user' }
            ],
            system_notifications: [
                { id: 'notice-legacy', user_id: 'legacy-user' },
                { id: 'notice-smoke', user_id: 'smoke-user' }
            ],
            admin_notes: [
                { id: 'note-legacy-target', target_user_id: 'legacy-user', admin_id: 'admin-1' },
                { id: 'note-smoke-target', target_user_id: 'smoke-user', admin_id: 'admin-1' }
            ],
            admin_audit_logs: [
                { id: 'audit-legacy-target', target_user_id: 'legacy-user', admin_id: 'admin-1' },
                { id: 'audit-smoke-target', target_user_id: 'smoke-user', admin_id: 'admin-1' }
            ]
        }
    };
}

test('cleanup preview scans both legacy and production-smoke payment artifacts', async () => {
    const state = createFixtureState();

    await withCleanupHandler(state, async (handler) => {
        const req = { method: 'GET' };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.deepEqual(payload.preview.order_prefixes, ['AUTO_CDX_', 'SMOKE_']);
        assert.deepEqual(payload.preview.user_email_patterns, [
            '/^codex\\..+@example\\.com$/i',
            '/^smoke-payment-.+@zaoyoe\\.invalid$/i'
        ]);
        assert.equal(payload.preview.counts.payment_orders, 2);
        assert.equal(payload.preview.counts.payment_events, 2);
        assert.equal(payload.preview.counts.afdian_orders, 2);
        assert.equal(payload.preview.counts.payment_checkout_sessions, 2);
        assert.equal(payload.preview.counts.auth_users, 2);
        assert.deepEqual(
            payload.preview.samples.orders.map((row) => row.provider_order_no),
            ['SMOKE_ORDER_1', 'AUTO_CDX_ORDER_1']
        );
        assert.deepEqual(
            payload.preview.samples.users.map((row) => row.email),
            ['codex.one@example.com', 'smoke-payment-20260323@zaoyoe.invalid']
        );
    });
});

test('cleanup POST removes both legacy codex fixtures and production smoke fixtures', async () => {
    const state = createFixtureState();

    await withCleanupHandler(state, async (handler) => {
        const req = { method: 'POST', body: { confirm: true } };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.deleted.payment_checkout_sessions, 2);
        assert.equal(payload.deleted.payment_orders, 2);
        assert.equal(payload.deleted.payment_events, 2);
        assert.equal(payload.deleted.afdian_orders, 2);
        assert.equal(payload.deleted.points_ledger_reference, 1);
        assert.equal(payload.deleted.points_ledger_user, 2);
        assert.equal(payload.deleted.auth_users, 2);
        assert.deepEqual(state.authUsers.map((row) => row.email), ['real-user@example.com']);
        assert.deepEqual(
            state.tables.payment_orders.map((row) => row.provider_order_no),
            ['REAL_ORDER_1']
        );
        assert.deepEqual(
            state.tables.payment_events.map((row) => row.provider_order_no),
            ['REAL_ORDER_1']
        );
        assert.deepEqual(
            state.tables.points_ledger.map((row) => row.reference_id),
            ['mock_REAL_ORDER_1']
        );
        assert.equal(state.auditLogs.length, 1);
        assert.equal(state.auditLogs[0].actionType, 'payments.cleanup_test_data');
    });
});

test('cleanup preview retries transient auth listUsers failures before surfacing an error', async () => {
    const state = createFixtureState();
    const transientError = new Error('fetch failed');
    transientError.name = 'AuthRetryableFetchError';
    transientError.status = 503;
    state.listUsersFailures = [transientError];

    await withCleanupHandler(state, async (handler) => {
        const req = { method: 'GET' };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.preview.counts.auth_users, 2);
        assert.equal(state.listUsersCalls, 2);
    });
});
