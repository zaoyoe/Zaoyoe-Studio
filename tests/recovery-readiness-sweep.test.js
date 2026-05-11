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

function createReadyPayload(overrides = {}) {
    return {
        success: true,
        fetched_at: '2026-05-11T00:00:00.000Z',
        runtime_dependency: 'none',
        pro_fallback: true,
        status: 'ready',
        summary: {
            section_count: 4,
            blocking_finding_count: 0,
            advisory_count: 2
        },
        sections: [
            {
                key: 'pro_fallback',
                label: 'Pro 到期降级',
                ok: true,
                status: 'ready',
                tone: 'warning',
                findings: [],
                advisories: [{ severity: 'info', key: 'supabase_pro_fallback', message: '可回退' }]
            },
            {
                key: 'financial_recovery_drill',
                label: '恢复演练',
                ok: true,
                status: 'ready',
                tone: 'warning',
                findings: [],
                advisories: [{ severity: 'info', key: 'pitr_optional', message: 'PITR optional' }]
            },
            {
                key: 'payment_recovery_live',
                label: '支付积分库存链路',
                ok: true,
                status: 'ready',
                tone: 'success',
                findings: [],
                advisories: []
            },
            {
                key: 'external_monitoring',
                label: '外部监控',
                ok: true,
                status: 'optional_not_configured',
                tone: 'neutral',
                findings: [],
                advisories: [{ severity: 'info', key: 'external_monitoring_optional', message: '外部监控可选' }]
            }
        ],
        ...overrides
    };
}

async function withSweep(stateOverrides, callback) {
    const sweepPath = path.resolve(__dirname, '../api/_lib/recovery-readiness-sweep.js');
    const originalLoad = Module._load;
    const state = {
        payload: createReadyPayload(),
        alerts: [],
        notifications: [],
        buildCalls: [],
        ...stateOverrides
    };

    delete require.cache[sweepPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === './ops-alerts') {
            return {
                async enqueueOpsAlertJob(supabase, input, options) {
                    state.alerts.push({ supabase, input, options });
                    return {
                        queued: true,
                        id: 'ops-job-1',
                        dedupeKey: input.dedupeKey
                    };
                }
            };
        }
        if (request === './admin-notifications') {
            return {
                async notifyActiveAdmins(supabase, payload) {
                    state.notifications.push({ supabase, payload });
                    return {
                        recipients: 1,
                        created: 1,
                        skipped: 0
                    };
                }
            };
        }
        if (request === './site') {
            return {
                SUPPORTED_SITES: ['cn', 'intl']
            };
        }
        if (request === '../../server/api-handlers/admin/settings/recovery-readiness') {
            return {
                _private: {
                    async buildRecoveryReadinessPayload(options = {}) {
                        state.buildCalls.push(options);
                        if (state.readinessError) throw state.readinessError;
                        return state.payload;
                    }
                }
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        const sweep = require(sweepPath);
        await callback(sweep, state);
    } finally {
        Module._load = originalLoad;
        delete require.cache[sweepPath];
    }
}

test('recovery readiness sweep ignores optional Pro/PITR/external monitoring advisories', async () => {
    await withSweep({}, async ({ runRecoveryReadinessSweep }, state) => {
        const result = await runRecoveryReadinessSweep({ from() {} }, {
            env: { CRON_SECRET: 'secret' },
            now: new Date('2026-05-11T00:00:00.000Z')
        });

        assert.equal(result.success, true);
        assert.equal(result.status, 'ready');
        assert.equal(result.issue_count, 0);
        assert.deepEqual(result.ops_alert, {
            queued: false,
            reason: 'no_issues'
        });
        assert.equal(state.alerts.length, 0);
        assert.equal(state.notifications.length, 0);
        assert.equal(state.buildCalls.length, 1);
    });
});

test('recovery readiness sweep queues ops alert and bilingual-site admin notices for live payment recovery gaps', async () => {
    const payload = createReadyPayload({
        status: 'needs_attention'
    });
    payload.sections[2] = {
        key: 'payment_recovery_live',
        label: '支付积分库存链路',
        ok: false,
        status: 'needs_attention',
        tone: 'danger',
        finding_count: 1,
        findings: [{
            severity: 'error',
            key: 'missing_rpc',
            message: '缺少积分恢复 RPC。'
        }],
        advisories: []
    };

    await withSweep({ payload }, async ({ runRecoveryReadinessSweep }, state) => {
        const supabase = { from() {} };
        const result = await runRecoveryReadinessSweep(supabase, {
            env: { CRON_SECRET: 'secret' },
            now: new Date('2026-05-11T00:00:00.000Z')
        });

        assert.equal(result.success, true);
        assert.equal(result.status, 'needs_attention');
        assert.equal(result.issue_count, 1);
        assert.equal(state.alerts.length, 1);
        assert.equal(state.alerts[0].supabase, supabase);
        assert.equal(state.alerts[0].input.alertType, 'recovery_readiness_degraded');
        assert.equal(state.alerts[0].input.severity, 'critical');
        assert.match(state.alerts[0].input.content, /fail-open/);
        assert.equal(state.alerts[0].options.skipSummary, true);
        assert.equal(state.notifications.length, 2);
        assert.deepEqual(
            state.notifications.map((entry) => entry.payload.site).sort(),
            ['cn', 'intl']
        );
        assert.equal(state.notifications[0].payload.metadata.pro_fallback, true);
        assert.equal(state.notifications[0].payload.metadata.runtime_dependency, 'none');
    });
});

test('recovery readiness sweep stays fail-open when readiness aggregation throws', async () => {
    await withSweep({
        readinessError: new Error('readiness probe exploded')
    }, async ({ runRecoveryReadinessSweep }, state) => {
        const result = await runRecoveryReadinessSweep({ from() {} }, {
            env: { CRON_SECRET: 'secret' },
            now: new Date('2026-05-11T00:00:00.000Z')
        });

        assert.equal(result.success, true);
        assert.equal(result.runtime_dependency, 'none');
        assert.equal(result.pro_fallback, true);
        assert.equal(result.status, 'needs_attention');
        assert.equal(result.issues[0].section_key, 'recovery_readiness_sweep');
        assert.equal(state.alerts.length, 1);
        assert.equal(state.notifications.length, 2);
    });
});

test('recovery readiness sweep reports issues without crashing when Supabase admin is unavailable', async () => {
    const payload = createReadyPayload({
        status: 'needs_attention'
    });
    payload.sections[1] = {
        key: 'financial_recovery_drill',
        label: '恢复演练',
        ok: false,
        status: 'needs_attention',
        tone: 'danger',
        findings: [{
            severity: 'warning',
            key: 'missing_audit_view',
            message: '缺少恢复审计视图。'
        }],
        advisories: []
    };

    await withSweep({ payload }, async ({ runRecoveryReadinessSweep }, state) => {
        const result = await runRecoveryReadinessSweep(null, {
            env: { CRON_SECRET: 'secret' },
            now: new Date('2026-05-11T00:00:00.000Z')
        });

        assert.equal(result.success, true);
        assert.equal(result.status, 'needs_attention');
        assert.equal(result.ops_alert.reason, 'supabase_unavailable');
        assert.equal(result.admin_notifications.reason, 'supabase_unavailable');
        assert.equal(state.alerts.length, 0);
        assert.equal(state.notifications.length, 0);
    });
});

test('recovery readiness sweep handler requires a configured cron secret', async () => {
    const {
        createRecoveryReadinessSweepHandler
    } = require('../server/api-handlers/public/ops-recovery-readiness-sweep');
    const handler = createRecoveryReadinessSweepHandler({
        admin: {},
        env: {},
        async sweep() {
            throw new Error('should not run without secret');
        }
    });
    const response = createMockResponse();

    await handler({
        method: 'GET',
        headers: {},
        url: '/api/ops/recovery-readiness-sweep'
    }, response);

    assert.equal(response.statusCode, 503);
    assert.equal(response.json().reason, 'cron_secret_not_configured');
});

test('recovery readiness sweep handler accepts Vercel cron bearer secret and fails open', async () => {
    const {
        createRecoveryReadinessSweepHandler
    } = require('../server/api-handlers/public/ops-recovery-readiness-sweep');
    const supabase = { from() {} };
    const calls = [];
    const handler = createRecoveryReadinessSweepHandler({
        admin: {
            getOptionalSupabaseAdmin() {
                return supabase;
            }
        },
        env: { CRON_SECRET: 'secret' },
        async sweep(receivedSupabase, options) {
            calls.push({ receivedSupabase, options });
            return {
                success: true,
                status: 'ready',
                runtime_dependency: 'none',
                pro_fallback: true
            };
        }
    });
    const response = createMockResponse();

    await handler({
        method: 'GET',
        headers: {
            authorization: 'Bearer secret'
        },
        url: '/api/ops/recovery-readiness-sweep'
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].receivedSupabase, supabase);
    assert.equal(response.json().protected_by, 'cron_secret');
    assert.equal(response.json().pro_fallback, true);
});
