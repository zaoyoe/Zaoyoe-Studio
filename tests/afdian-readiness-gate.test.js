const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildReadinessSummary,
    formatHumanReport,
    parseArgs
} = require('../scripts/afdian-readiness-gate');

test('afdian-readiness-gate parseArgs collects handoff flags', () => {
    const options = parseArgs([
        '--env-file', 'server/.env.staging',
        '--base-url', 'https://www.zaoyoe.com',
        '--verify-server-url', 'https://verify-api.zaoyoe.com',
        '--admin-email', 'zaoyoe@gmail.com',
        '--access-token', 'token-123',
        '--samples', '7',
        '--timeout-ms', '4321',
        '--skip-proxy-inspection',
        '--json'
    ]);

    assert.match(options.envFile, /server\/\.env\.staging$/);
    assert.equal(options.baseUrl, 'https://www.zaoyoe.com');
    assert.equal(options.verifyServerUrl, 'https://verify-api.zaoyoe.com');
    assert.equal(options.adminEmail, 'zaoyoe@gmail.com');
    assert.equal(options.accessToken, 'token-123');
    assert.equal(options.sampleCount, 7);
    assert.equal(options.timeoutMs, 4321);
    assert.equal(options.skipProxyInspection, true);
    assert.equal(options.json, true);
});

test('buildReadinessSummary recognizes the safe pending Afdian approval state', () => {
    const summary = buildReadinessSummary({
        closeoutAudit: {
            runtime: {
                mock_payment: {
                    allowed: false
                }
            },
            network: {
                trusted_proxy_ips: '100.64.0.3/32,100.64.0.4/32,100.64.0.5/32,100.64.0.6/32',
                afdian_webhook_trusted_proxies: '100.64.0.3/32,100.64.0.4/32,100.64.0.5/32,100.64.0.6/32',
                afdian_webhook_allowed_ips: '203.0.113.254/32',
                webhook_allowlist_placeholder: true
            },
            artifacts: {
                auth_users: 0
            },
            findings: [{
                severity: 'medium',
                key: 'afdian_webhook_allowlist_placeholder',
                message: 'placeholder'
            }]
        },
        proxyInspection: {
            summary: {
                findings: ['current_request_not_in_webhook_allowlist'],
                socketIps: ['100.64.0.3', '100.64.0.4'],
                resolvedClientIps: ['82.26.25.182'],
                recommendedTrustedProxyIps: '100.64.0.3/32,100.64.0.4/32,100.64.0.5/32,100.64.0.6/32',
                recommendedWebhookTrustedProxies: '100.64.0.3/32,100.64.0.4/32,100.64.0.5/32,100.64.0.6/32',
                recommendedWebhookAllowlist: '203.0.113.254/32'
            }
        }
    });

    assert.equal(summary.status, 'SAFE_PENDING_AFDIAN_APPROVAL');
    assert.deepEqual(summary.closeoutAudit.blockingFindings, []);
    assert.deepEqual(summary.proxyInspection.blockingFindings, []);
    assert.equal(summary.proxyInspection.recommendedEnv.TRUSTED_PROXY_IPS, '100.64.0.3/32,100.64.0.4/32,100.64.0.5/32,100.64.0.6/32');
    assert.match(summary.nextSteps[0], /fail-closed/);
});

test('buildReadinessSummary keeps action required when proxy trust still mismatches', () => {
    const summary = buildReadinessSummary({
        closeoutAudit: {
            runtime: {
                mock_payment: {
                    allowed: false
                }
            },
            network: {
                trusted_proxy_ips: '100.64.0.5/32,100.64.0.6/32',
                afdian_webhook_trusted_proxies: '100.64.0.5/32,100.64.0.6/32',
                afdian_webhook_allowed_ips: '203.0.113.254/32',
                webhook_allowlist_placeholder: true
            },
            artifacts: {
                auth_users: 0
            },
            findings: [{
                severity: 'medium',
                key: 'afdian_webhook_allowlist_placeholder',
                message: 'placeholder'
            }]
        },
        proxyInspection: {
            summary: {
                findings: ['proxy_trust_chain_mismatch', 'current_request_not_in_webhook_allowlist'],
                socketIps: ['100.64.0.3'],
                resolvedClientIps: ['100.64.0.3'],
                recommendedTrustedProxyIps: '100.64.0.3/32,100.64.0.4/32,100.64.0.5/32,100.64.0.6/32',
                recommendedWebhookTrustedProxies: '100.64.0.3/32,100.64.0.4/32,100.64.0.5/32,100.64.0.6/32',
                recommendedWebhookAllowlist: '203.0.113.254/32'
            }
        }
    });

    assert.equal(summary.status, 'ACTION_REQUIRED');
    assert.deepEqual(summary.proxyInspection.blockingFindings, ['proxy_trust_chain_mismatch']);
    assert.match(summary.nextSteps[0], /TRUSTED_PROXY_IPS=100\.64\.0\.3\/32/);
});

test('formatHumanReport renders the pending-approval handoff summary', () => {
    const report = formatHumanReport({
        status: 'SAFE_PENDING_AFDIAN_APPROVAL',
        auditedAt: '2026-03-23T05:00:00.000Z',
        closeoutAudit: {
            runtime: {
                mock_payment: {
                    allowed: false
                }
            },
            network: {
                trusted_proxy_ips: '100.64.0.3/32,100.64.0.4/32',
                afdian_webhook_trusted_proxies: '100.64.0.3/32,100.64.0.4/32',
                afdian_webhook_allowed_ips: '203.0.113.254/32'
            },
            artifacts: {
                auth_users: 0
            }
        },
        proxyInspection: {
            checked: true,
            skipped: false,
            error: '',
            findings: ['current_request_not_in_webhook_allowlist'],
            socketIps: ['100.64.0.3', '100.64.0.4'],
            resolvedClientIps: ['82.26.25.182'],
            recommendedEnv: {
                TRUSTED_PROXY_IPS: '100.64.0.3/32,100.64.0.4/32',
                AFDIAN_WEBHOOK_TRUSTED_PROXIES: '100.64.0.3/32,100.64.0.4/32',
                AFDIAN_WEBHOOK_ALLOWED_IPS: '203.0.113.254/32'
            }
        },
        nextSteps: [
            '保持 AFDIAN_WEBHOOK_ALLOWED_IPS 的 fail-closed 占位值，不要在开发者认证开通前放开 webhook 白名单。'
        ]
    });

    assert.match(report, /status: SAFE_PENDING_AFDIAN_APPROVAL/);
    assert.match(report, /webhook_allowed_ips: 203\.0\.113\.254\/32 \(fail-closed placeholder\)/);
    assert.match(report, /resolved_client_ips: 82\.26\.25\.182/);
    assert.match(report, /AFDIAN_WEBHOOK_TRUSTED_PROXIES=100\.64\.0\.3\/32,100\.64\.0\.4\/32/);
});
