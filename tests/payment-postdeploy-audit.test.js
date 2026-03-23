const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildFindings,
    DEFAULT_ORDER_PREFIX,
    formatHumanReport,
    matchesSmokeUser,
    normalizeBaseUrl,
    parseArgs
} = require('../scripts/payment-postdeploy-audit');

test('parseArgs collects postdeploy audit flags', () => {
    const options = parseArgs([
        '--env-file', 'server/.env.staging',
        '--base-url', 'https://www.zaoyoe.com',
        '--smoke-email', 'smoke@example.com',
        '--order-prefix', 'TEST_',
        '--sample-limit', '7',
        '--json'
    ]);

    assert.match(options.envFile, /server\/\.env\.staging$/);
    assert.equal(options.baseUrl, 'https://www.zaoyoe.com');
    assert.equal(options.smokeEmail, 'smoke@example.com');
    assert.equal(options.orderPrefix, 'TEST_');
    assert.equal(options.sampleLimit, 7);
    assert.equal(options.json, true);
});

test('normalizeBaseUrl normalizes staging and production hosts', () => {
    assert.equal(normalizeBaseUrl('www.zaoyoe.com/'), 'https://www.zaoyoe.com');
    assert.equal(normalizeBaseUrl('https://preview.zaoyoe.com/'), 'https://preview.zaoyoe.com');
});

test('matchesSmokeUser prefers explicit email and falls back to the invalid-domain regex', () => {
    assert.equal(matchesSmokeUser({ email: 'smoke@example.com' }, 'smoke@example.com'), true);
    assert.equal(matchesSmokeUser({ email: 'smoke-payment-20260323@zaoyoe.invalid' }, ''), true);
    assert.equal(matchesSmokeUser({ email: 'member@example.com' }, ''), false);
});

test('buildFindings highlights remote mock risk and leftover smoke artifacts', () => {
    const findings = buildFindings({
        runtime: {
            mock_payment: {
                allowed: true,
                reason: 'remote_whitelist_until_enabled'
            }
        },
        artifacts: {
            auth_users: 1,
            counts: {
                payment_checkout_sessions: 1,
                payment_orders: 2,
                payment_events: 2,
                points_ledger: 1
            }
        },
        network: {
            webhook_allowlist_placeholder: true
        }
    });

    assert.deepEqual(
        findings.map((finding) => finding.key),
        [
            'remote_mock_payment_still_enabled',
            'smoke_payment_artifacts_present',
            'smoke_users_still_present',
            'afdian_webhook_allowlist_placeholder'
        ]
    );
});

test('formatHumanReport renders a readable audit summary', () => {
    const report = formatHumanReport({
        projectHost: 'mmkugdibsaeoevliebzk.supabase.co',
        baseUrl: 'https://www.zaoyoe.com',
        smokeEmail: 'smoke-payment-20260323@zaoyoe.invalid',
        orderPrefix: DEFAULT_ORDER_PREFIX,
        runtime: {
            checked: true,
            status: 200,
            statusText: 'OK',
            mock_payment: {
                allowed: true,
                reason: 'remote_whitelist_until_enabled'
            }
        },
        network: {
            trusted_proxy_ips: '100.64.0.5/32,100.64.0.6/32',
            afdian_webhook_trusted_proxies: '100.64.0.5/32,100.64.0.6/32',
            afdian_webhook_allowed_ips: '203.0.113.254/32'
        },
        artifacts: {
            auth_users: 1,
            counts: {
                payment_checkout_sessions: 1,
                payment_orders: 1,
                payment_events: 1,
                points_ledger: 1
            },
            samples: {
                users: [{ id: 'user-1', email: 'smoke-payment-20260323@zaoyoe.invalid' }],
                payment_orders: [],
                payment_events: [],
                points_ledger: []
            }
        },
        findings: [{
            severity: 'high',
            message: 'Production-like runtime still allows remote mock payments (remote_whitelist_until_enabled)'
        }]
    });

    assert.match(report, /Payment Postdeploy Audit/);
    assert.match(report, /mock_allowed: yes/);
    assert.match(report, /webhook_allowed_ips: 203\.0\.113\.254\/32 \(fail-closed placeholder\)/);
    assert.match(report, /\[high\]/);
    assert.match(report, /ACTION_REQUIRED/);
});
