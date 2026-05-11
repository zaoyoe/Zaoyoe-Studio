const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

const PROVIDERS = Object.freeze([
    'sentry',
    'axiom',
    'datadog',
    'log_drain'
]);

function parseArgs(argv = []) {
    const options = {
        json: false,
        failOnInvalid: false
    };

    for (const rawValue of argv) {
        const value = String(rawValue || '').trim();
        if (value === '--json') {
            options.json = true;
        } else if (value === '--fail-on-invalid') {
            options.failOnInvalid = true;
        }
    }

    return options;
}

function normalizeText(value, maxLength = 500) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function readEnv(env, name) {
    return normalizeText(env?.[name] || '');
}

function readFirstEnv(env, names = []) {
    for (const name of names) {
        const value = readEnv(env, name);
        if (value) {
            return { name, value };
        }
    }

    return { name: '', value: '' };
}

function fingerprintSecret(value) {
    const normalized = normalizeText(value, 2000);
    if (!normalized) return 'missing';

    return crypto
        .createHash('sha256')
        .update(normalized)
        .digest('hex')
        .slice(0, 12);
}

function parseUrl(value) {
    try {
        return new URL(value);
    } catch (_) {
        return null;
    }
}

function readRepoFile(repoRoot, relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function hasAnyEnv(env, names = []) {
    return names.some((name) => Boolean(readEnv(env, name)));
}

function buildProviderCheck(provider, ok, status, message, detail = {}) {
    return {
        provider,
        ok: ok === true,
        status,
        message,
        ...detail
    };
}

function inspectSentry(env = process.env) {
    const dsn = readFirstEnv(env, [
        'SENTRY_DSN',
        'SERVER_SENTRY_DSN',
        'NEXT_PUBLIC_SENTRY_DSN',
        'PUBLIC_SENTRY_DSN'
    ]);
    const relatedNames = [
        'SENTRY_DSN',
        'SERVER_SENTRY_DSN',
        'NEXT_PUBLIC_SENTRY_DSN',
        'PUBLIC_SENTRY_DSN',
        'SENTRY_ENVIRONMENT',
        'SENTRY_RELEASE',
        'SENTRY_ORG',
        'SENTRY_PROJECT'
    ];

    if (!dsn.value && !hasAnyEnv(env, relatedNames)) {
        return buildProviderCheck(
            'sentry',
            true,
            'optional_not_configured',
            'Sentry is optional and not configured'
        );
    }

    if (!dsn.value) {
        return buildProviderCheck(
            'sentry',
            false,
            'invalid',
            'Sentry-related env is present, but no SENTRY_DSN/SERVER_SENTRY_DSN is configured'
        );
    }

    const parsed = parseUrl(dsn.value);
    const valid = Boolean(parsed)
        && ['http:', 'https:'].includes(parsed.protocol)
        && Boolean(parsed.hostname)
        && Boolean(parsed.username)
        && Boolean(parsed.pathname.replace(/\//g, ''));

    return buildProviderCheck(
        'sentry',
        valid,
        valid ? 'configured' : 'invalid',
        valid
            ? `Sentry DSN configured via ${dsn.name}`
            : `${dsn.name} does not look like a Sentry DSN`,
        {
            env_name: dsn.name,
            fingerprint: fingerprintSecret(dsn.value)
        }
    );
}

function inspectAxiom(env = process.env) {
    const token = readFirstEnv(env, ['AXIOM_TOKEN', 'AXIOM_API_TOKEN']);
    const dataset = readFirstEnv(env, ['AXIOM_DATASET', 'AXIOM_LOG_DATASET']);
    const relatedNames = [
        'AXIOM_TOKEN',
        'AXIOM_API_TOKEN',
        'AXIOM_DATASET',
        'AXIOM_LOG_DATASET',
        'AXIOM_ORG_ID'
    ];

    if (!hasAnyEnv(env, relatedNames)) {
        return buildProviderCheck(
            'axiom',
            true,
            'optional_not_configured',
            'Axiom is optional and not configured'
        );
    }

    if (!token.value || !dataset.value) {
        return buildProviderCheck(
            'axiom',
            false,
            'invalid',
            'Axiom requires both AXIOM_TOKEN and AXIOM_DATASET when enabled',
            {
                missing: [
                    !token.value ? 'AXIOM_TOKEN' : '',
                    !dataset.value ? 'AXIOM_DATASET' : ''
                ].filter(Boolean)
            }
        );
    }

    const datasetLooksValid = /^[A-Za-z0-9_.:-]{1,128}$/.test(dataset.value);
    const tokenLooksValid = token.value.length >= 12 && !/\s/.test(token.value);
    const valid = datasetLooksValid && tokenLooksValid;

    return buildProviderCheck(
        'axiom',
        valid,
        valid ? 'configured' : 'invalid',
        valid
            ? `Axiom configured via ${token.name} + ${dataset.name}`
            : 'Axiom token or dataset has an unexpected format',
        {
            token_env_name: token.name,
            dataset_env_name: dataset.name,
            token_fingerprint: fingerprintSecret(token.value),
            dataset: dataset.value
        }
    );
}

function inspectDatadog(env = process.env) {
    const apiKey = readFirstEnv(env, ['DATADOG_API_KEY', 'DD_API_KEY']);
    const site = readFirstEnv(env, ['DATADOG_SITE', 'DD_SITE']);
    const relatedNames = [
        'DATADOG_API_KEY',
        'DD_API_KEY',
        'DATADOG_SITE',
        'DD_SITE',
        'DATADOG_SERVICE',
        'DD_SERVICE',
        'DATADOG_ENV',
        'DD_ENV'
    ];

    if (!hasAnyEnv(env, relatedNames)) {
        return buildProviderCheck(
            'datadog',
            true,
            'optional_not_configured',
            'Datadog is optional and not configured'
        );
    }

    if (!apiKey.value) {
        return buildProviderCheck(
            'datadog',
            false,
            'invalid',
            'Datadog-related env is present, but no DATADOG_API_KEY/DD_API_KEY is configured'
        );
    }

    const normalizedSite = site.value || 'datadoghq.com';
    const validSite = /^[A-Za-z0-9.-]+$/.test(normalizedSite) && !/^https?:\/\//i.test(normalizedSite);
    const validKey = apiKey.value.length >= 20 && !/\s/.test(apiKey.value);
    const valid = validSite && validKey;

    return buildProviderCheck(
        'datadog',
        valid,
        valid ? 'configured' : 'invalid',
        valid
            ? `Datadog configured via ${apiKey.name}; site=${normalizedSite}${site.value ? '' : ' (default)'}`
            : 'Datadog API key or site has an unexpected format',
        {
            api_key_env_name: apiKey.name,
            site_env_name: site.name || 'default',
            api_key_fingerprint: fingerprintSecret(apiKey.value),
            site: normalizedSite
        }
    );
}

function inspectLogDrain(env = process.env) {
    const drainUrl = readFirstEnv(env, [
        'LOG_DRAIN_URL',
        'VERCEL_LOG_DRAIN_URL',
        'RAILWAY_LOG_DRAIN_URL',
        'SUPABASE_LOG_DRAIN_URL'
    ]);
    const manualMarker = readFirstEnv(env, [
        'EXTERNAL_LOG_DRAIN_CONFIGURED',
        'SUPABASE_LOG_DRAIN_CONFIGURED',
        'VERCEL_LOG_DRAIN_CONFIGURED'
    ]);
    const markerValue = manualMarker.value.toLowerCase();
    const truthyMarker = ['1', 'true', 'yes', 'enabled'].includes(markerValue);
    const falseyMarker = ['0', 'false', 'no', 'disabled'].includes(markerValue);

    if (!drainUrl.value && !manualMarker.value) {
        return buildProviderCheck(
            'log_drain',
            true,
            'optional_not_configured',
            'External Log Drain is optional and not configured'
        );
    }

    if (manualMarker.value && !truthyMarker && !falseyMarker) {
        return buildProviderCheck(
            'log_drain',
            false,
            'invalid',
            `${manualMarker.name} must be true/false when used as a readiness marker`
        );
    }

    if (truthyMarker && !drainUrl.value) {
        return buildProviderCheck(
            'log_drain',
            true,
            'configured',
            `Log Drain marked as configured via ${manualMarker.name}; platform dashboard config is manual`
        );
    }

    if (falseyMarker && !drainUrl.value) {
        return buildProviderCheck(
            'log_drain',
            true,
            'optional_not_configured',
            `Log Drain explicitly disabled via ${manualMarker.name}`
        );
    }

    const parsed = parseUrl(drainUrl.value);
    const valid = Boolean(parsed) && parsed.protocol === 'https:' && Boolean(parsed.hostname);

    return buildProviderCheck(
        'log_drain',
        valid,
        valid ? 'configured' : 'invalid',
        valid
            ? `Log Drain endpoint configured via ${drainUrl.name}`
            : `${drainUrl.name} must be an https URL`,
        {
            env_name: drainUrl.name,
            host: parsed?.hostname || ''
        }
    );
}

function buildRepoChecks(repoRoot = REPO_ROOT) {
    const checks = [];

    try {
        const opsAlerts = readRepoFile(repoRoot, 'api/_lib/ops-alerts.js');
        checks.push({
            key: 'repo:ops-alert-jobs',
            ok: opsAlerts.includes('ops_alert_jobs') && opsAlerts.includes('ops_alert_job_attempts'),
            message: 'existing ops_alert_jobs queue remains the primary in-app alert path'
        });
    } catch (error) {
        checks.push({
            key: 'repo:ops-alert-jobs',
            ok: false,
            message: `cannot read ops alert queue module: ${error.message || error}`
        });
    }

    try {
        const healthHandler = readRepoFile(repoRoot, 'server/api-handlers/admin/settings/ops-alert-health.js');
        checks.push({
            key: 'repo:admin-ops-alert-health',
            ok: healthHandler.includes('ops_alert_job_attempts') && healthHandler.includes('buildRecentDeliveryEntries'),
            message: 'Admin Studio can keep showing internal alert delivery health without external monitors'
        });
    } catch (error) {
        checks.push({
            key: 'repo:admin-ops-alert-health',
            ok: false,
            message: `cannot read ops alert health handler: ${error.message || error}`
        });
    }

    try {
        const monitoringHelper = readRepoFile(repoRoot, 'api/_lib/external-monitoring.js');
        checks.push({
            key: 'repo:external-monitoring-helper',
            ok: monitoringHelper.includes('emitExternalMonitoringEventFailOpen')
                && monitoringHelper.includes('redactMonitoringPayload')
                && monitoringHelper.includes('buildSentryEnvelope')
                && monitoringHelper.includes('sendAxiomEvent')
                && monitoringHelper.includes('sendDatadogEvent'),
            message: 'external monitoring helper emits optional sanitized provider copies'
        });
    } catch (error) {
        checks.push({
            key: 'repo:external-monitoring-helper',
            ok: false,
            message: `cannot read external monitoring helper: ${error.message || error}`
        });
    }

    try {
        const clientEndpoint = readRepoFile(repoRoot, 'server/api-handlers/public/monitoring-client-event.js');
        const publicRouter = readRepoFile(repoRoot, 'api/public.js');
        checks.push({
            key: 'repo:client-monitoring-endpoint',
            ok: clientEndpoint.includes('emitExternalMonitoringEventFailOpen')
                && clientEndpoint.includes('accepted: true')
                && clientEndpoint.includes('no-store')
                && publicRouter.includes("case 'monitoring'")
                && publicRouter.includes("'client-event': clientMonitoringEventHandler"),
            message: 'frontend diagnostics endpoint accepts events without making monitoring a runtime dependency'
        });
    } catch (error) {
        checks.push({
            key: 'repo:client-monitoring-endpoint',
            ok: false,
            message: `cannot read client monitoring endpoint: ${error.message || error}`
        });
    }

    try {
        const runtimeConfig = readRepoFile(repoRoot, 'js/runtime-supabase-config.js');
        checks.push({
            key: 'repo:client-monitoring-fail-open',
            ok: runtimeConfig.includes('installZaoyoeClientMonitoring')
                && runtimeConfig.includes('unhandledrejection')
                && runtimeConfig.includes('ZaoyoeMonitoring')
                && runtimeConfig.includes('catch(() => {})'),
            message: 'frontend runtime reports browser errors with throttled fail-open delivery'
        });
    } catch (error) {
        checks.push({
            key: 'repo:client-monitoring-fail-open',
            ok: false,
            message: `cannot read frontend monitoring runtime: ${error.message || error}`
        });
    }

    try {
        const checklist = readRepoFile(repoRoot, 'docs/external-monitoring-checklist.md');
        checks.push({
            key: 'docs:external-monitoring-fallback',
            ok: /optional enhancement/i.test(checklist)
                && /not a runtime dependency/i.test(checklist)
                && /ops_alert_jobs/i.test(checklist)
                && /frontend_runtime_error/i.test(checklist)
                && /Supabase Pro/i.test(checklist),
            message: 'external monitoring checklist documents fail-open fallback behavior'
        });
    } catch (error) {
        checks.push({
            key: 'docs:external-monitoring-fallback',
            ok: false,
            message: `external monitoring checklist is missing: ${error.message || error}`
        });
    }

    return checks;
}

function inspectProviders(env = process.env) {
    return [
        inspectSentry(env),
        inspectAxiom(env),
        inspectDatadog(env),
        inspectLogDrain(env)
    ];
}

function runReadiness({ env = process.env, repoRoot = REPO_ROOT } = {}) {
    const providers = inspectProviders(env);
    const repo_checks = buildRepoChecks(repoRoot);
    const providerFindings = providers
        .filter((check) => check.ok !== true)
        .map((check) => ({
            severity: 'medium',
            key: `provider:${check.provider}`,
            message: check.message
        }));
    const repoFindings = repo_checks
        .filter((check) => check.ok !== true)
        .map((check) => ({
            severity: 'medium',
            key: check.key,
            message: check.message
        }));
    const configuredProviders = providers.filter((check) => check.status === 'configured').map((check) => check.provider);

    return {
        checked_at: new Date().toISOString(),
        providers: PROVIDERS,
        configured_providers: configuredProviders,
        provider_checks: providers,
        repo_checks,
        ok: providerFindings.length === 0 && repoFindings.length === 0,
        optional: configuredProviders.length === 0,
        findings: [...providerFindings, ...repoFindings]
    };
}

function formatHumanReport(summary = {}) {
    const lines = [
        'External Monitoring Readiness',
        '',
        `checked_at: ${summary.checked_at || ''}`,
        ''
    ];

    lines.push('providers:');
    for (const check of summary.provider_checks || []) {
        lines.push(`${check.ok ? '[OK]' : '[WARN]'} ${check.provider}: ${check.message}`);
    }

    lines.push('');
    lines.push('repo checks:');
    for (const check of summary.repo_checks || []) {
        lines.push(`${check.ok ? '[OK]' : '[WARN]'} ${check.key}: ${check.message}`);
    }

    lines.push('');
    if (!summary.findings?.length) {
        lines.push('findings: none');
    } else {
        lines.push('findings:');
        for (const finding of summary.findings) {
            lines.push(`- [${finding.severity}] ${finding.key}: ${finding.message}`);
        }
    }

    lines.push('');
    lines.push(`configured_providers: ${summary.configured_providers?.length ? summary.configured_providers.join(', ') : '(none)'}`);
    lines.push(`result: ${summary.ok ? 'PASS' : 'WARN'}`);
    lines.push('runtime_dependency: none; external monitoring is fail-open by design');
    return lines.join('\n');
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const summary = runReadiness();
    console.log(options.json ? JSON.stringify(summary, null, 2) : formatHumanReport(summary));
    if (options.failOnInvalid && !summary.ok) {
        process.exitCode = 2;
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.message || error);
        process.exitCode = 1;
    });
}

module.exports = {
    PROVIDERS,
    buildRepoChecks,
    formatHumanReport,
    inspectAxiom,
    inspectDatadog,
    inspectLogDrain,
    inspectProviders,
    inspectSentry,
    parseArgs,
    runReadiness
};
