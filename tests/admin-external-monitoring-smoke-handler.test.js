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
        },
        get headers() {
            return state.headers;
        }
    };
}

async function withHandler(stateOverrides, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/settings/external-monitoring-smoke.js');
    const originalLoad = Module._load;
    const state = {
        requireAdminCalls: [],
        emittedEvents: [],
        emitResult: {
            event: {
                type: 'external_monitoring_smoke_test',
                level: 'info',
                message: 'Admin Studio external monitoring smoke test',
                event_id: 'evt-admin-smoke'
            },
            results: [
                {
                    provider: 'sentry',
                    ok: true,
                    status: 202,
                    env_name: 'SENTRY_DSN',
                    dsn_host: 'example.sentry.io',
                    dsn_project_id: '123456',
                    present_env_names: ['SENTRY_DSN'],
                    deployment: {
                        vercel_env: 'production',
                        git_ref: 'main',
                        git_commit_sha: 'abcdef123456'
                    }
                },
                { provider: 'axiom', skipped: true, reason: 'not_configured' }
            ],
            configured: 1,
            delivered: 1,
            failed: 0
        },
        ...stateOverrides
    };

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                async requireAdmin(_req, options = {}) {
                    state.requireAdminCalls.push(options);
                    return {
                        user: { id: 'admin-1' }
                    };
                },
                async parseJsonBody(req) {
                    return req.body || {};
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                }
            };
        }
        if (request === '../../../../api/_lib/external-monitoring') {
            return {
                normalizeText(value = '', maxLength = 2000) {
                    return String(value || '').trim().slice(0, Math.max(0, maxLength));
                },
                async emitExternalMonitoringEventFailOpen(event, options) {
                    state.emittedEvents.push({ event, options });
                    return state.emitResult;
                }
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        const handler = require(handlerPath);
        await callback(handler, state);
    } finally {
        Module._load = originalLoad;
        delete require.cache[handlerPath];
    }
}

test('admin external monitoring smoke handler emits a fail-open provider test event', async () => {
    await withHandler({}, async (handler, state) => {
        const response = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {
                source: 'readiness-panel',
                message: 'production smoke'
            }
        }, response);

        assert.equal(response.statusCode, 202);
        assert.deepEqual(
            state.requireAdminCalls[0],
            { anyOf: ['settings.manage', 'ops_alerts.manage'] }
        );
        assert.equal(state.emittedEvents.length, 1);
        assert.equal(state.emittedEvents[0].event.type, 'external_monitoring_smoke_test');
        assert.equal(state.emittedEvents[0].event.message, 'production smoke');
        assert.equal(state.emittedEvents[0].event.extra.pro_fallback, true);
        assert.equal(state.emittedEvents[0].event.extra.runtime_dependency, 'none');
        assert.equal(state.emittedEvents[0].options.timeoutMs, 1200);

        const payload = response.json();
        assert.equal(payload.success, true);
        assert.equal(payload.status, 'delivered');
        assert.equal(payload.configured, 1);
        assert.equal(payload.delivered, 1);
        assert.equal(payload.runtime_dependency, 'none');
        assert.equal(payload.pro_fallback, true);
        assert.equal(payload.providers[0].provider, 'sentry');
        assert.equal(payload.providers[0].env_name, 'SENTRY_DSN');
        assert.equal(payload.providers[0].dsn_host, 'example.sentry.io');
        assert.equal(payload.providers[0].dsn_project_id, '123456');
        assert.deepEqual(payload.providers[0].present_env_names, ['SENTRY_DSN']);
        assert.equal(payload.providers[0].deployment.vercel_env, 'production');
        assert.equal(payload.providers[0].deployment.git_ref, 'main');
        assert.equal(payload.providers[0].deployment.git_commit_sha, 'abcdef123456');
    });
});

test('admin external monitoring smoke handler reports optional not-configured state without failing', async () => {
    await withHandler({
        emitResult: {
            event: {
                type: 'external_monitoring_smoke_test',
                level: 'info',
                message: 'smoke',
                event_id: 'evt-none'
            },
            results: [
                {
                    provider: 'sentry',
                    skipped: true,
                    reason: 'not_configured',
                    expected_env_names: ['SENTRY_DSN', 'SERVER_SENTRY_DSN'],
                    present_env_names: [],
                    deployment: {
                        vercel_env: 'production',
                        git_ref: 'main'
                    }
                },
                { provider: 'axiom', skipped: true, reason: 'not_configured' },
                { provider: 'datadog', skipped: true, reason: 'not_configured' }
            ],
            configured: 0,
            delivered: 0,
            failed: 0
        }
    }, async (handler) => {
        const response = createMockResponse();

        await handler({
            method: 'POST',
            headers: {},
            body: {}
        }, response);

        const payload = response.json();
        assert.equal(response.statusCode, 202);
        assert.equal(payload.status, 'not_configured');
        assert.equal(payload.success, true);
        assert.match(payload.message, /未配置/);
        assert.deepEqual(payload.providers[0].expected_env_names, ['SENTRY_DSN', 'SERVER_SENTRY_DSN']);
        assert.deepEqual(payload.providers[0].present_env_names, []);
        assert.equal(payload.providers[0].deployment.vercel_env, 'production');
    });
});

test('admin external monitoring smoke handler rejects unsupported methods', async () => {
    await withHandler({}, async (handler, state) => {
        const response = createMockResponse();

        await handler({
            method: 'GET',
            headers: {},
            body: {}
        }, response);

        assert.equal(response.statusCode, 405);
        assert.equal(response.headers.allow, 'POST');
        assert.equal(response.json().success, false);
        assert.equal(state.emittedEvents.length, 0);
    });
});
