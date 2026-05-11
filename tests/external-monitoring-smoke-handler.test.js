const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createExternalMonitoringSmokeHandler
} = require('../server/api-handlers/public/ops-external-monitoring-smoke');

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

test('external monitoring smoke handler rejects requests when cron secret is missing', async () => {
    const handler = createExternalMonitoringSmokeHandler({
        env: {},
        async emit() {
            throw new Error('should not emit without secret');
        }
    });
    const response = createMockResponse();

    await handler({
        method: 'GET',
        url: '/api/ops/external-monitoring-smoke',
        headers: {}
    }, response);

    assert.equal(response.statusCode, 503);
    assert.equal(response.json().reason, 'cron_secret_not_configured');
});

test('external monitoring smoke handler succeeds without configured providers', async () => {
    const calls = [];
    const handler = createExternalMonitoringSmokeHandler({
        env: { CRON_SECRET: 'secret' },
        async emit(event, options) {
            calls.push({ event, options });
            return {
                event: {
                    ...event,
                    event_id: 'evt-not-configured'
                },
                results: [
                    {
                        provider: 'sentry',
                        skipped: true,
                        reason: 'not_configured',
                        expected_env_names: ['SENTRY_DSN', 'SERVER_SENTRY_DSN']
                    },
                    { provider: 'axiom', skipped: true, reason: 'not_configured' },
                    { provider: 'datadog', skipped: true, reason: 'not_configured' }
                ],
                configured: 0,
                delivered: 0,
                failed: 0
            };
        }
    });
    const response = createMockResponse();

    await handler({
        method: 'GET',
        url: '/api/ops/external-monitoring-smoke?source=manual&message=hello',
        headers: {
            authorization: 'Bearer secret'
        }
    }, response);

    assert.equal(response.statusCode, 202);
    assert.equal(response.headers['cache-control'], 'no-store, max-age=0');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].event.type, 'external_monitoring_smoke_test');
    assert.equal(calls[0].event.message, 'hello');
    assert.equal(calls[0].event.extra.pro_fallback, true);
    assert.equal(calls[0].options.timeoutMs, 1200);

    const payload = response.json();
    assert.equal(payload.success, true);
    assert.equal(payload.status, 'not_configured');
    assert.equal(payload.configured, 0);
    assert.equal(payload.delivered, 0);
    assert.equal(payload.pro_fallback, true);
    assert.deepEqual(
        payload.providers.map((provider) => provider.provider),
        ['sentry', 'axiom', 'datadog']
    );
    assert.deepEqual(payload.providers[0].expected_env_names, ['SENTRY_DSN', 'SERVER_SENTRY_DSN']);
});

test('external monitoring smoke handler exposes provider delivery diagnostics', async () => {
    const handler = createExternalMonitoringSmokeHandler({
        env: { RECOVERY_READINESS_CRON_SECRET: 'secret' },
        async emit(event) {
            return {
                event: {
                    ...event,
                    event_id: 'evt-delivered'
                },
                results: [
                    {
                        provider: 'sentry',
                        ok: true,
                        status: 202,
                        env_name: 'SENTRY_DSN',
                        dsn_host: 'example.sentry.io',
                        dsn_project_id: '123456'
                    },
                    { provider: 'axiom', ok: false, status: 401, error: 'unauthorized' },
                    { provider: 'datadog', skipped: true, reason: 'not_configured' }
                ],
                configured: 2,
                delivered: 1,
                failed: 1
            };
        }
    });
    const response = createMockResponse();

    await handler({
        method: 'POST',
        url: '/api/ops/external-monitoring-smoke',
        body: {
            source: 'admin-studio',
            message: 'production smoke'
        },
        headers: {
            'x-cron-secret': 'secret'
        }
    }, response);

    const payload = response.json();
    assert.equal(response.statusCode, 202);
    assert.equal(payload.status, 'delivered');
    assert.equal(payload.configured, 2);
    assert.equal(payload.delivered, 1);
    assert.equal(payload.failed, 1);
    assert.equal(payload.event.event_id, 'evt-delivered');
    assert.equal(payload.providers[0].env_name, 'SENTRY_DSN');
    assert.equal(payload.providers[0].dsn_host, 'example.sentry.io');
    assert.equal(payload.providers[0].dsn_project_id, '123456');
    assert.equal(payload.providers[1].provider, 'axiom');
    assert.equal(payload.providers[1].reason, 'unauthorized');
});
