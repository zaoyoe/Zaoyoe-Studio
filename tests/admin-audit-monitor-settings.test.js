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
        auditLogs: [],
        ...overrides
    };
}

function createSupabaseStub(state) {
    return {
        from(table) {
            if (table !== 'admin_audit_logs_view') {
                throw new Error(`Unexpected table access: ${table}`);
            }

            const queryState = {
                filters: [],
                order: null,
                limit: null
            };

            const query = {
                select() {
                    return query;
                },
                eq(column, value) {
                    queryState.filters.push({ op: 'eq', column, value });
                    return query;
                },
                gte(column, value) {
                    queryState.filters.push({ op: 'gte', column, value });
                    return query;
                },
                order(column, options = {}) {
                    queryState.order = {
                        column,
                        ascending: options.ascending !== false
                    };
                    return query;
                },
                async limit(limitValue) {
                    let rows = (state.auditLogs || []).slice();
                    rows = rows.filter((row) => queryState.filters.every((filter) => {
                        if (filter.op === 'eq') {
                            return row[filter.column] === filter.value;
                        }
                        if (filter.op === 'gte') {
                            return new Date(row[filter.column]).getTime() >= new Date(filter.value).getTime();
                        }
                        return true;
                    }));

                    if (queryState.order?.column) {
                        const { column, ascending } = queryState.order;
                        rows.sort((left, right) => {
                            const leftValue = new Date(left[column]).getTime();
                            const rightValue = new Date(right[column]).getTime();
                            return ascending ? leftValue - rightValue : rightValue - leftValue;
                        });
                    }

                    return {
                        data: rows.slice(0, limitValue),
                        error: null
                    };
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
        sendJson(res, status, payload) {
            res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(payload));
        }
    };
}

async function withHandler(stateOverrides, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/settings/admin-audit-monitor.js');
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

function minutesAgo(minutes) {
    return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function buildAuditRow(actionType, overrides = {}) {
    return {
        id: overrides.id || `${actionType}-1`,
        action_type: actionType,
        admin_id: overrides.admin_id || 'admin-user-1',
        admin_email: overrides.admin_email || 'admin@example.com',
        created_at: overrides.created_at || minutesAgo(5),
        details: overrides.details || {}
    };
}

test('admin audit monitor handler returns recent access rows, anomaly signals, and payment config audit rows', async () => {
    await withHandler({
        auditLogs: [
            buildAuditRow('admin.access.session.issue', {
                id: 'access-older',
                created_at: minutesAgo(180),
                details: {
                    client_ip: '203.0.113.8',
                    user_agent: 'Chrome / baseline',
                    origin: 'https://www.zaoyoe.com'
                }
            }),
            buildAuditRow('admin.access.session.issue', {
                id: 'access-recent-a',
                created_at: minutesAgo(8),
                details: {
                    client_ip: '198.51.100.20',
                    user_agent: 'Chrome / desktop',
                    origin: 'https://www.zaoyoe.com',
                    referer: 'https://www.zaoyoe.com/admin-entry.html',
                    granted: true
                }
            }),
            buildAuditRow('admin.access.session.issue', {
                id: 'access-recent-b',
                created_at: minutesAgo(2),
                details: {
                    client_ip: '198.51.100.21',
                    user_agent: 'Safari / laptop',
                    origin: 'https://www.zaoyoe.com',
                    granted: true
                }
            }),
            buildAuditRow('admin.payment_channels.upsert', {
                id: 'config-upsert',
                created_at: minutesAgo(6),
                admin_email: 'ops@example.com',
                details: {
                    active_provider: 'mock',
                    updated_providers: ['mock', 'hupijiao'],
                    updated_secrets: ['hupijiao_secret_key']
                }
            }),
            buildAuditRow('admin.payment_channels.secret.delete', {
                id: 'config-delete',
                created_at: minutesAgo(4),
                admin_email: 'owner@example.com',
                details: {
                    secret_name: 'hupijiao_secret_key'
                }
            })
        ]
    }, async (handler) => {
        const req = { method: 'GET', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.access_summary.access_count, 3);
        assert.equal(payload.access_summary.distinct_ip_count, 3);
        assert.equal(Array.isArray(payload.recent_accesses), true);
        assert.equal(payload.recent_accesses[0].id, 'access-recent-b');
        assert.equal(payload.access_anomalies.length > 0, true);
        assert.equal(payload.config_summary.config_change_count, 2);
        assert.equal(payload.config_summary.secret_delete_count, 1);
        assert.equal(payload.config_summary.mock_switch_count, 1);
        assert.equal(payload.payment_config_events[0].id, 'config-delete');
        assert.equal(payload.payment_config_events[1].id, 'config-upsert');
    });
});

test('admin audit monitor handler rejects non-GET methods', async () => {
    await withHandler({}, async (handler) => {
        const req = { method: 'POST', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 405);
        assert.equal(payload.success, false);
        assert.equal(payload.message, 'Method not allowed');
    });
});
