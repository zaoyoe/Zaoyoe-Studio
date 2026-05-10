const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    formatHumanReport,
    inspectAxiom,
    inspectDatadog,
    inspectLogDrain,
    inspectSentry,
    parseArgs,
    runReadiness
} = require('../scripts/external-monitoring-readiness');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('external monitoring readiness parseArgs supports json and strict invalid mode', () => {
    assert.deepEqual(parseArgs(['--json', '--fail-on-invalid']), {
        json: true,
        failOnInvalid: true
    });
});

test('external monitoring readiness is pass when no external provider is configured', () => {
    const summary = runReadiness({ env: {} });

    assert.equal(summary.ok, true);
    assert.equal(summary.optional, true);
    assert.deepEqual(summary.configured_providers, []);
    assert.equal(summary.findings.length, 0);
    assert.deepEqual(
        summary.provider_checks.map((check) => check.status),
        [
            'optional_not_configured',
            'optional_not_configured',
            'optional_not_configured',
            'optional_not_configured'
        ]
    );
});

test('external monitoring readiness recognizes fully configured providers', () => {
    const summary = runReadiness({
        env: {
            SENTRY_DSN: 'https://public@example.sentry.io/123456',
            AXIOM_TOKEN: 'axiom-token-1234567890',
            AXIOM_DATASET: 'zaoyoe-production',
            DATADOG_API_KEY: '0123456789abcdef0123456789abcdef',
            DATADOG_SITE: 'datadoghq.com',
            EXTERNAL_LOG_DRAIN_CONFIGURED: 'true'
        }
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.optional, false);
    assert.deepEqual(summary.configured_providers, [
        'sentry',
        'axiom',
        'datadog',
        'log_drain'
    ]);
});

test('external monitoring readiness surfaces partial provider config without making missing providers fail', () => {
    const axiom = inspectAxiom({ AXIOM_TOKEN: 'axiom-token-1234567890' });
    const sentry = inspectSentry({ SENTRY_ENVIRONMENT: 'production' });
    const datadog = inspectDatadog({ DATADOG_SITE: 'https://datadoghq.com' });
    const logDrain = inspectLogDrain({ LOG_DRAIN_URL: 'http://logs.example.com/ingest' });

    assert.equal(axiom.ok, false);
    assert.match(axiom.message, /both AXIOM_TOKEN and AXIOM_DATASET/);
    assert.equal(sentry.ok, false);
    assert.match(sentry.message, /no SENTRY_DSN/);
    assert.equal(datadog.ok, false);
    assert.match(datadog.message, /no DATADOG_API_KEY/);
    assert.equal(logDrain.ok, false);
    assert.match(logDrain.message, /https URL/);
});

test('external monitoring readiness report documents fail-open runtime behavior', () => {
    const output = formatHumanReport({
        checked_at: '2026-05-10T00:00:00.000Z',
        provider_checks: [
            { provider: 'sentry', ok: true, message: 'Sentry is optional and not configured' }
        ],
        repo_checks: [
            { key: 'repo:ops-alert-jobs', ok: true, message: 'ops alert queue exists' }
        ],
        configured_providers: [],
        findings: [],
        ok: true
    });

    assert.match(output, /External Monitoring Readiness/);
    assert.match(output, /\[OK\] sentry/);
    assert.match(output, /runtime_dependency: none/);
    assert.match(output, /fail-open/);
});

test('external monitoring docs and npm script keep monitoring optional', () => {
    const packageJson = JSON.parse(readRepoFile('package.json'));
    const checklist = readRepoFile('docs/external-monitoring-checklist.md');

    assert.equal(
        packageJson.scripts['readiness:external-monitoring'],
        'node scripts/external-monitoring-readiness.js'
    );
    assert.match(checklist, /optional enhancement/);
    assert.match(checklist, /not a runtime dependency/);
    assert.match(checklist, /ops_alert_jobs/);
    assert.match(checklist, /Supabase Pro/);
    assert.match(checklist, /Realtime and external monitors must stay fail-open/);
});
