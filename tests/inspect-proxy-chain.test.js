const test = require('node:test');
const assert = require('node:assert/strict');

const {
    FALLBACK_FAIL_CLOSED_ALLOWLIST,
    chooseAdminEmail,
    formatHumanReport,
    normalizeBaseUrl,
    parseArgs,
    summarizeSamples
} = require('../scripts/inspect-proxy-chain');

test('inspect-proxy-chain parseArgs collects operational flags', () => {
    const options = parseArgs([
        '--env-file', 'server/.env.staging',
        '--base-url', 'https://www.zaoyoe.com',
        '--verify-server-url', 'https://zaoyoe-verify-server-production.up.railway.app',
        '--admin-email', 'zaoyoe@gmail.com',
        '--access-token', 'token-123',
        '--samples', '7',
        '--timeout-ms', '4321',
        '--json'
    ]);

    assert.match(options.envFile, /server\/\.env\.staging$/);
    assert.equal(options.baseUrl, 'https://www.zaoyoe.com');
    assert.equal(options.verifyServerUrl, 'https://zaoyoe-verify-server-production.up.railway.app');
    assert.equal(options.adminEmail, 'zaoyoe@gmail.com');
    assert.equal(options.accessToken, 'token-123');
    assert.equal(options.sampleCount, 7);
    assert.equal(options.timeoutMs, 4321);
    assert.equal(options.json, true);
});

test('normalizeBaseUrl normalizes verify-server hosts', () => {
    assert.equal(normalizeBaseUrl('zaoyoe-verify-server-production.up.railway.app/'), 'https://zaoyoe-verify-server-production.up.railway.app');
    assert.equal(normalizeBaseUrl('https://www.zaoyoe.com/'), 'https://www.zaoyoe.com');
});

test('chooseAdminEmail prefers real admins over example.com or invalid placeholders', () => {
    assert.equal(chooseAdminEmail([
        { email: 'diag.admin.1773938677689@example.com' },
        { email: 'smoke-payment-20260323@zaoyoe.invalid' },
        { email: 'zaoyoe@gmail.com' }
    ]), 'zaoyoe@gmail.com');
});

test('summarizeSamples recommends /32 proxy rules and a fail-closed webhook placeholder', () => {
    const summary = summarizeSamples([
        {
            appProxy: {
                socket_ip: '100.64.0.4',
                forwarding_headers: {
                    'x-forwarded-for': '82.26.25.182'
                },
                resolved_client_ip: '100.64.0.4'
            },
            findings: [{ code: 'proxy_trust_chain_missing' }]
        },
        {
            appProxy: {
                socket_ip: '100.64.0.3',
                forwarding_headers: {
                    'x-forwarded-for': '82.26.25.182'
                },
                resolved_client_ip: '100.64.0.3'
            },
            findings: [{ code: 'afdian_webhook_allowlist_missing' }]
        }
    ]);

    assert.deepEqual(summary.socketIps, ['100.64.0.3', '100.64.0.4']);
    assert.equal(summary.recommendedTrustedProxyIps, '100.64.0.3/32,100.64.0.4/32');
    assert.equal(summary.recommendedWebhookTrustedProxies, '100.64.0.3/32,100.64.0.4/32');
    assert.equal(summary.recommendedWebhookAllowlist, FALLBACK_FAIL_CLOSED_ALLOWLIST);
    assert.equal(summary.requiresRealWebhookObservation, true);
});

test('formatHumanReport explains the temporary fail-closed webhook strategy', () => {
    const report = formatHumanReport({
        verifyServerUrl: 'https://zaoyoe-verify-server-production.up.railway.app',
        baseUrl: 'https://www.zaoyoe.com',
        adminEmail: 'zaoyoe@gmail.com',
        authMode: 'admin_magiclink_email_otp',
        summary: {
            sampleCount: 5,
            socketIps: ['100.64.0.3', '100.64.0.4'],
            forwardedIps: ['82.26.25.182'],
            resolvedClientIps: ['100.64.0.3', '100.64.0.4'],
            findings: ['proxy_trust_chain_missing', 'afdian_webhook_allowlist_missing'],
            recommendedTrustedProxyIps: '100.64.0.3/32,100.64.0.4/32',
            recommendedWebhookTrustedProxies: '100.64.0.3/32,100.64.0.4/32',
            recommendedWebhookAllowlist: FALLBACK_FAIL_CLOSED_ALLOWLIST
        }
    });

    assert.match(report, /TRUSTED_PROXY_IPS=100\.64\.0\.3\/32,100\.64\.0\.4\/32/);
    assert.match(report, /AFDIAN_WEBHOOK_ALLOWED_IPS=203\.0\.113\.254\/32/);
    assert.match(report, /fail-closed placeholder/);
});
