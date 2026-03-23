const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildDriftFindings,
    fingerprintSecret,
    parseArgs,
    summarizeEnvFile
} = require('../scripts/check-env-drift');

test('parseArgs collects repeated env files and flags', () => {
    const options = parseArgs([
        '--env-file', 'server/.env',
        '--env-file', 'server/.env.production',
        '--check-live',
        '--fail-on-drift',
        '--json'
    ]);

    assert.equal(options.envFiles.length, 2);
    assert.equal(options.checkLive, true);
    assert.equal(options.failOnDrift, true);
    assert.equal(options.json, true);
});

test('summarizeEnvFile fingerprints key secrets and quote aliases', () => {
    const summary = summarizeEnvFile({
        envFile: '/tmp/server.env',
        exists: true,
        values: {
            SUPABASE_URL: 'https://example.supabase.co',
            SUPABASE_SERVICE_ROLE_KEY: 'service-a',
            ADMIN_CONFIG_ENCRYPTION_KEY: 'encrypt-a',
            PAYMENT_QUOTE_SECRET: 'quote-a',
            ADMIN_STUDIO_ACCESS_SECRET: 'studio-a',
            DEPLOYMENT_TIER: 'production',
            TRUSTED_PROXY_IPS: '10.0.0.0/8',
            AFDIAN_WEBHOOK_TRUSTED_PROXIES: '100.64.0.0/10',
            AFDIAN_WEBHOOK_ALLOWED_IPS: '203.0.113.0/24'
        }
    });

    assert.equal(summary.projectHost, 'example.supabase.co');
    assert.equal(summary.fingerprints.supabase_service_role_key, fingerprintSecret('service-a'));
    assert.equal(summary.fingerprints.payment_custom_recharge_quote_secret, fingerprintSecret('quote-a'));
    assert.equal(summary.sources.payment_custom_recharge_quote_secret, 'PAYMENT_QUOTE_SECRET');
    assert.equal(summary.runtime.productionLike, true);
    assert.equal(summary.securityNetwork.trustedProxyIps, '10.0.0.0/8');
    assert.equal(summary.securityNetwork.afdianWebhookAllowedIps, '203.0.113.0/24');
});

test('buildDriftFindings flags same-host service role drift and shared secret drift', () => {
    const findings = buildDriftFindings([
        {
            envFile: '/tmp/a.env',
            exists: true,
            projectHost: 'same.supabase.co',
            fingerprints: {
                supabase_service_role_key: 'aaa111',
                admin_config_encryption_key: 'enc111',
                payment_custom_recharge_quote_secret: 'quote111',
                admin_studio_access_secret: 'studio111'
            },
            missing: {
                trusted_proxy_ips: false,
                afdian_webhook_trusted_proxies: false,
                afdian_webhook_allowed_ips: false
            },
            runtime: {
                productionLike: true,
                trustAllProxies: false
            },
            live: { ok: true }
        },
        {
            envFile: '/tmp/b.env',
            exists: true,
            projectHost: 'same.supabase.co',
            fingerprints: {
                supabase_service_role_key: 'bbb222',
                admin_config_encryption_key: 'enc999',
                payment_custom_recharge_quote_secret: 'quote111',
                admin_studio_access_secret: 'studio999'
            },
            missing: {
                trusted_proxy_ips: true,
                afdian_webhook_trusted_proxies: true,
                afdian_webhook_allowed_ips: true
            },
            runtime: {
                productionLike: true,
                trustAllProxies: false
            },
            live: { ok: false }
        }
    ]);

    assert.equal(findings.some((item) => item.type === 'service_role_drift'), true);
    assert.equal(findings.some((item) => item.type === 'shared_secret_drift'), true);
    assert.equal(findings.some((item) => item.type === 'live_access_failed'), true);
    assert.equal(findings.some((item) => item.type === 'proxy_trust_chain_missing'), true);
    assert.equal(findings.some((item) => item.type === 'webhook_allowlist_missing'), true);
});
