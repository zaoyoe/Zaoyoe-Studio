const test = require('node:test');
const assert = require('node:assert/strict');

const {
    REDACTED_VALUE,
    SENTRY_DSN_ENV_NAMES,
    buildMonitoringEvent,
    buildSentryEnvelope,
    emitExternalMonitoringEvent,
    emitExternalMonitoringEventFailOpen,
    redactMonitoringPayload
} = require('../api/_lib/external-monitoring');
const {
    clientMonitoringEventHandler
} = require('../server/api-handlers/public/monitoring-client-event');

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

function withCleanMonitoringEnv(callback) {
    const names = [
        'SENTRY_DSN',
        'SERVER_SENTRY_DSN',
        'NEXT_PUBLIC_SENTRY_DSN',
        'PUBLIC_SENTRY_DSN',
        'AXIOM_TOKEN',
        'AXIOM_API_TOKEN',
        'AXIOM_DATASET',
        'AXIOM_LOG_DATASET',
        'AXIOM_INGEST_URL',
        'DATADOG_API_KEY',
        'DD_API_KEY',
        'DATADOG_SITE',
        'DD_SITE'
    ];
    const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    names.forEach((name) => {
        delete process.env[name];
    });

    return Promise.resolve()
        .then(callback)
        .finally(() => {
            for (const name of names) {
                if (previous[name] === undefined) {
                    delete process.env[name];
                } else {
                    process.env[name] = previous[name];
                }
            }
        });
}

test('external monitoring payload redaction removes secrets before provider delivery', () => {
    const redacted = redactMonitoringPayload({
        authorization: 'Bearer abc.def.ghi',
        nested: {
            api_key: 'secret-key',
            message: 'safe text'
        },
        stack: 'Error: safe'
    });

    assert.equal(redacted.authorization, REDACTED_VALUE);
    assert.equal(redacted.nested.api_key, REDACTED_VALUE);
    assert.equal(redacted.nested.message, 'safe text');
    assert.equal(redacted.stack, 'Error: safe');
});

test('external monitoring is no-op when no provider is configured', async () => {
    const calls = [];
    const result = await emitExternalMonitoringEvent({
        type: 'unit_test',
        level: 'error',
        message: 'test event'
    }, {
        env: {},
        fetchImpl: async (...args) => {
            calls.push(args);
            throw new Error('fetch should not run');
        }
    });

    assert.equal(result.configured, 0);
    assert.equal(result.delivered, 0);
    assert.equal(result.failed, 0);
    assert.equal(calls.length, 0);
    assert.equal(result.results.every((entry) => entry.skipped === true), true);
    const sentry = result.results.find((entry) => entry.provider === 'sentry');
    assert.deepEqual(sentry.expected_env_names, SENTRY_DSN_ENV_NAMES);
    assert.deepEqual(sentry.present_env_names, []);
    assert.equal(sentry.deployment.vercel_env, null);
});

test('external monitoring sends sanitized copies to configured providers', async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
        calls.push({
            url: String(url),
            init
        });
        return {
            ok: true,
            status: 202,
            async text() {
                return 'ok';
            }
        };
    };

    const result = await emitExternalMonitoringEvent({
        type: 'ops_alert_delivery_attempt',
        level: 'warning',
        message: 'delivery failed',
        tags: {
            alert_type: 'payment_gateway_degraded'
        },
        extra: {
            token: 'should-not-leak',
            nested: {
                webhook_signature: 'abc123',
                order_id: 'order_1'
            }
        }
    }, {
        env: {
            SENTRY_DSN: 'https://public@example.sentry.io/123456',
            AXIOM_TOKEN: 'axiom-token-1234567890',
            AXIOM_DATASET: 'zaoyoe-production',
            DATADOG_API_KEY: '0123456789abcdef0123456789abcdef',
            DATADOG_SITE: 'datadoghq.com',
            VERCEL_ENV: 'production',
            VERCEL_GIT_COMMIT_REF: 'main',
            VERCEL_GIT_COMMIT_SHA: 'abcdef1234567890'
        },
        fetchImpl
    });

    assert.equal(result.configured, 3);
    assert.equal(result.delivered, 3);
    assert.equal(calls.length, 3);
    assert.equal(result.results[0].env_name, 'SENTRY_DSN');
    assert.equal(result.results[0].dsn_host, 'example.sentry.io');
    assert.equal(result.results[0].dsn_project_id, '123456');
    assert.deepEqual(result.results[0].present_env_names, ['SENTRY_DSN']);
    assert.equal(result.results[0].deployment.vercel_env, 'production');
    assert.equal(result.results[0].deployment.git_ref, 'main');
    assert.equal(result.results[0].deployment.git_commit_sha, 'abcdef123456');
    assert.match(calls[0].url, /example\.sentry\.io\/api\/123456\/envelope/);
    assert.match(calls[1].url, /api\.axiom\.co\/v1\/datasets\/zaoyoe-production\/ingest/);
    assert.match(calls[2].url, /http-intake\.logs\.datadoghq\.com\/api\/v2\/logs/);

    const bodies = calls.map((call) => String(call.init.body || '')).join('\n');
    assert.equal(bodies.includes('should-not-leak'), false);
    assert.equal(bodies.includes('abc123'), false);
    assert.equal(bodies.includes(REDACTED_VALUE), true);
    assert.equal(bodies.includes('order_1'), true);
});

test('external monitoring fail-open helper does not throw provider errors', async () => {
    const result = await emitExternalMonitoringEventFailOpen({
        type: 'unit_test',
        level: 'error',
        message: 'provider down'
    }, {
        env: {
            AXIOM_TOKEN: 'axiom-token-1234567890',
            AXIOM_DATASET: 'zaoyoe-production'
        },
        fetchImpl: async () => {
            throw new Error('network down');
        }
    });

    assert.equal(result.configured, 1);
    assert.equal(result.delivered, 0);
    assert.equal(result.failed, 1);
});

test('sentry envelope includes event metadata without requiring the browser sdk', () => {
    const event = buildMonitoringEvent({
        type: 'frontend_runtime_error',
        level: 'error',
        message: 'white screen',
        tags: {
            page: 'home'
        }
    }, {
        env: {
            SENTRY_ENVIRONMENT: 'production',
            SENTRY_RELEASE: 'test-release'
        }
    });
    const envelope = buildSentryEnvelope(event, 'https://public@example.sentry.io/123456');

    assert.match(envelope, /frontend_runtime_error/);
    assert.match(envelope, /white screen/);
    assert.match(envelope, /test-release/);
});

test('client monitoring endpoint accepts diagnostics when no external provider is configured', async () => {
    await withCleanMonitoringEnv(async () => {
        const res = createMockResponse();

        await clientMonitoringEventHandler({
            method: 'POST',
            body: {
                kind: 'window_error',
                message: 'ReferenceError: boom',
                stack: 'ReferenceError: boom\n    at home.js:1:1',
                href: 'https://www.fatherkey.com/',
                metadata: {
                    access_token: 'eyJ.secret.value'
                }
            }
        }, res);

        assert.equal(res.statusCode, 202);
        assert.equal(res.headers['cache-control'], 'no-store, max-age=0');
        assert.equal(res.json().success, true);
        assert.equal(res.json().accepted, true);
        assert.equal(res.json().configured, 0);
    });
});
