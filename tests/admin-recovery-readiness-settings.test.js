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
        requireAdminCalls: [],
        financialSummary: {
            ok: true,
            checked_at: '2026-05-11T00:00:00.000Z',
            runtime_dependency: 'none',
            configured_recovery_layers: ['audit_views', 'payment_recovery_readiness_gate'],
            findings: [],
            advisories: [{ severity: 'info', key: 'pitr_optional', message: 'PITR optional' }]
        },
        paymentSummary: {
            ok: true,
            checked_at: '2026-05-11T00:00:00.000Z',
            project_host: 'demo.supabase.co',
            capabilities: {
                points_recharge: { available: true },
                shop_admin_refund: { available: true }
            },
            recovery_audit_relations: {
                financial_recovery_audit_summary: { available: true }
            },
            findings: []
        },
        externalSummary: {
            ok: true,
            optional: true,
            checked_at: '2026-05-11T00:00:00.000Z',
            configured_providers: [],
            findings: []
        },
        ...overrides
    };
}

async function withHandler(stateOverrides, callback) {
    const handlerPath = path.resolve(__dirname, '../server/api-handlers/admin/settings/recovery-readiness.js');
    const originalLoad = Module._load;
    const state = createState(stateOverrides);

    delete require.cache[handlerPath];
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/admin') {
            return {
                async requireAdmin(_req, options = {}) {
                    state.requireAdminCalls.push(options);
                    return { user: { id: 'admin-1' } };
                },
                sendJson(res, status, payload) {
                    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
                    res.end(JSON.stringify(payload));
                }
            };
        }
        if (request === '../../../../scripts/financial-recovery-drill-readiness') {
            return {
                runReadiness() {
                    if (state.financialError) throw state.financialError;
                    return state.financialSummary;
                }
            };
        }
        if (request === '../../../../scripts/payment-readiness-gate') {
            return {
                async runReadinessGate() {
                    if (state.paymentNeverResolves) return new Promise(() => {});
                    if (state.paymentError) throw state.paymentError;
                    return state.paymentSummary;
                }
            };
        }
        if (request === '../../../../scripts/external-monitoring-readiness') {
            return {
                runReadiness() {
                    if (state.externalError) throw state.externalError;
                    return state.externalSummary;
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

test('recovery readiness handler returns fail-open readiness sections', async () => {
    await withHandler({}, async (handler, state) => {
        const response = createMockResponse();

        await handler({ method: 'GET', headers: {} }, response);

        assert.equal(response.statusCode, 200);
        assert.deepEqual(
            state.requireAdminCalls[0],
            { anyOf: ['settings.manage', 'ops_alerts.manage', 'analytics.view', 'payments.manage'] }
        );

        const payload = response.json();
        assert.equal(payload.success, true);
        assert.equal(payload.runtime_dependency, 'none');
        assert.equal(payload.pro_fallback, true);
        assert.equal(payload.status, 'ready');
        assert.deepEqual(
            payload.sections.map((section) => section.key),
            [
                'pro_fallback',
                'financial_recovery_drill',
                'payment_recovery_live',
                'external_monitoring'
            ]
        );
        assert.equal(payload.sections[0].summary_text.includes('Realtime'), true);
        assert.equal(payload.sections[1].tone, 'warning');
        assert.equal(payload.sections[2].summary_text.includes('关键 RPC 2/2'), true);
        assert.equal(payload.sections[3].status, 'optional_not_configured');
    });
});

test('recovery readiness handler keeps response successful when optional checks fail', async () => {
    await withHandler({
        paymentError: new Error('Missing required environment variable: SUPABASE_URL'),
        externalError: new Error('monitoring probe unavailable')
    }, async (handler) => {
        const response = createMockResponse();

        await handler({ method: 'GET', headers: {} }, response);

        assert.equal(response.statusCode, 200);
        const payload = response.json();
        assert.equal(payload.success, true);
        assert.equal(payload.status, 'ready');

        const payment = payload.sections.find((section) => section.key === 'payment_recovery_live');
        const external = payload.sections.find((section) => section.key === 'external_monitoring');
        assert.equal(payment.status, 'unavailable_fallback');
        assert.equal(payment.runtime_dependency, 'none');
        assert.match(payment.summary_text, /继续使用原有读取和降级逻辑/);
        assert.equal(external.status, 'unavailable_fallback');
    });
});

test('recovery readiness payload times out slow optional payment checks and still returns', async () => {
    await withHandler({
        paymentNeverResolves: true
    }, async (handler) => {
        const payload = await handler._private.buildRecoveryReadinessPayload({
            env: {},
            now: new Date('2026-05-11T00:00:00.000Z'),
            defaultTimeoutMs: 50,
            paymentTimeoutMs: 10
        });

        assert.equal(payload.success, true);
        assert.equal(payload.status, 'ready');
        const payment = payload.sections.find((section) => section.key === 'payment_recovery_live');
        assert.equal(payment.status, 'unavailable_fallback');
        assert.equal(payment.runtime_dependency, 'none');
        assert.match(payment.message, /超过 10ms/);
        assert.match(payment.summary_text, /继续使用原有读取和降级逻辑/);
    });
});

test('recovery readiness handler rejects unsupported methods', async () => {
    await withHandler({}, async (handler) => {
        const response = createMockResponse();

        await handler({ method: 'POST', headers: {} }, response);

        assert.equal(response.statusCode, 405);
        assert.equal(response.json().success, false);
    });
});
