const test = require('node:test');
const assert = require('node:assert/strict');
const { __testUtils } = require('../api/_lib/ops-alerts');

const {
    createWatchdogAlertHandler,
    hasWatchdogAccess
} = require('../server/api-handlers/public/ops-watchdog-alert');

const { buildExternalAlertText } = __testUtils;

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

test('hasWatchdogAccess accepts bearer secret', () => {
    const req = {
        headers: {
            authorization: 'Bearer secret-demo'
        }
    };
    const result = hasWatchdogAccess(req, {
        OPS_WATCHDOG_ALERT_SECRET: 'secret-demo'
    });
    assert.equal(result.ok, true);
});

test('watchdog alert handler enqueues incident into ops alerts', async () => {
    const captured = [];
    const handler = createWatchdogAlertHandler({
        admin: {
            getOptionalSupabaseAdmin() {
                return {
                    from() {
                        throw new Error('enqueue stub should short-circuit before table access');
                    }
                };
            }
        },
        env: {
            OPS_WATCHDOG_ALERT_SECRET: 'secret-demo'
        },
        loadRuntime: async () => ({
            config: {
                enabled: true,
                temporary_mute: {
                    until: '',
                    allow_critical: true
                },
                quiet_hours: {
                    enabled: false,
                    start_hour: 23,
                    end_hour: 8,
                    timezone: 'Asia/Shanghai',
                    allow_critical: true
                },
                mute_rules: {
                    types: {},
                    modules: {}
                },
                channels: {
                    telegram: { enabled: false, minimum_severity: 'warning', chat_ids: [] },
                    feishu: { enabled: false, minimum_severity: 'warning' },
                    email: { enabled: false, minimum_severity: 'warning', recipients: [], from_address: '' }
                },
                routing: {}
            },
            secrets: {}
        }),
        enqueue: async (_supabase, input, options) => {
            captured.push({ input, options });
            return {
                queued: true,
                dedupeKey: 'dedupe-watchdog-1'
            };
        }
    });

    const req = {
        method: 'POST',
        headers: {
            authorization: 'Bearer secret-demo'
        },
        body: {
            alert_type: 'kvm4_watchdog_incident',
            severity: 'critical',
            title: 'KVM4 docker 异常',
            content: 'dockerd CPU 连续过高，watchdog 已触发重建。',
            service_name: 'xianyu-auto-reply-fix',
            container_name: 'xianyu-auto-reply-fix',
            host: '76.13.188.218',
            children: 488,
            zombies: 473,
            cpu_percent: 52,
            guard_key: 'xianyu-auto-reply-fix',
            guard_label: '闲鱼自动回复',
            incident_started_at: '2026-06-11T13:45:00.000Z'
        }
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 202);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].input.alert_type, 'kvm4_watchdog_incident');
    assert.equal(captured[0].input.payload.container_name, 'xianyu-auto-reply-fix');
    assert.equal(captured[0].input.payload.zombies, 473);
    assert.equal(captured[0].options.skipSummary, true);
    assert.equal(captured[0].options.runtime.config.routing.kvm4_watchdog.telegram, true);
});

test('watchdog alert text includes site badge for admins', () => {
    const intlJob = {
        alert_type: 'kvm4_watchdog_incident',
        severity: 'critical',
        site: 'intl',
        title: 'KVM4 docker 异常',
        payload: {
            site: 'intl',
            service_name: 'xianyu-auto-reply-fix',
            container_name: 'xianyu-auto-reply-fix',
            host: '76.13.188.218'
        }
    };
    const cnJob = {
        alert_type: 'kvm4_watchdog_recovered',
        severity: 'warning',
        site: 'cn',
        title: 'KVM4 watchdog 已恢复',
        payload: {
            site: 'cn',
            service_name: 'xianyu-auto-reply-fix'
        }
    };

    assert.match(buildExternalAlertText(intlJob), /^\[INTL站\]\s/);
    assert.match(buildExternalAlertText(cnJob), /^\[CN站\]\s/);
});
