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
        verificationLogs: [],
        ...overrides
    };
}

function createSupabaseStub(state) {
    return {
        from(table) {
            if (table !== 'verification_logs') {
                throw new Error(`Unexpected table access: ${table}`);
            }

            const query = {
                async limit(limitValue) {
                    return {
                        data: (state.verificationLogs || []).slice(0, limitValue),
                        error: null
                    };
                },
                order() {
                    return query;
                },
                select() {
                    return query;
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
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/settings/verify-monitor.js');
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

function buildLog(message, overrides = {}) {
    return {
        id: overrides.id || 'log-1',
        user_id: overrides.user_id || 'user-1',
        verification_id: overrides.verification_id || 'job-1',
        status: overrides.status || 'queued',
        message: JSON.stringify({
            kind: 'google_one_job',
            email: overrides.email || 'member@example.com',
            stage_label: overrides.stage_label || '',
            raw_status: overrides.raw_status || '',
            error_message: overrides.error_message || '',
            error_code: overrides.error_code || '',
            ...message
        }),
        points_deducted: overrides.points_deducted ?? 10,
        site: overrides.site || 'cn',
        created_at: overrides.created_at || '2026-03-25T10:00:00.000Z'
    };
}

test('verify monitor settings handler returns recent tasks, recent failures, and local summary', async () => {
    await withHandler({
        verificationLogs: [
            buildLog({ job_id: 'job-success' }, {
                id: 'log-success',
                verification_id: 'job-success',
                status: 'success',
                email: 'ok@example.com',
                stage_label: '验证完成',
                created_at: '2026-03-25T10:30:00.000Z'
            }),
            buildLog({ job_id: 'job-failed' }, {
                id: 'log-failed',
                verification_id: 'job-failed',
                status: 'failed',
                email: 'failed@example.com',
                error_message: 'otp_invalid',
                created_at: '2026-03-25T10:20:00.000Z'
            }),
            buildLog({ job_id: 'job-active' }, {
                id: 'log-active',
                verification_id: 'job-active',
                status: 'running',
                email: 'busy@example.com',
                stage_label: '等待上游执行',
                created_at: '2026-03-25T10:10:00.000Z'
            }),
            buildLog({ job_id: 'job-active', stage_label: '重复旧状态' }, {
                id: 'log-active-older',
                verification_id: 'job-active',
                status: 'queued',
                email: 'busy@example.com',
                created_at: '2026-03-25T10:05:00.000Z'
            })
        ]
    }, async (handler) => {
        const req = { method: 'GET', headers: {} };
        const res = createMockResponse();

        await handler(req, res);
        const payload = res.json();

        assert.equal(res.statusCode, 200);
        assert.equal(payload.success, true);
        assert.equal(payload.summary.active_task_count, 1);
        assert.equal(payload.summary.failure_task_count, 1);
        assert.equal(Array.isArray(payload.recent_tasks), true);
        assert.equal(payload.recent_tasks.length, 3);
        assert.equal(payload.recent_tasks[0].verification_id, 'job-success');
        assert.equal(payload.recent_tasks[1].verification_id, 'job-failed');
        assert.equal(payload.recent_tasks[2].verification_id, 'job-active');
        assert.equal(payload.recent_failures.length, 1);
        assert.equal(payload.recent_failures[0].error_message, 'otp_invalid');
        assert.equal(payload.recent_failures[0].summary, 'otp_invalid');
    });
});

test('verify monitor settings handler rejects non-GET methods', async () => {
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
