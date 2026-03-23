const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

const DEFAULT_ENV_FILES = [
    path.resolve(__dirname, '../server/.env'),
    path.resolve(__dirname, '../server/.env.production')
];

function fingerprintSecret(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return 'missing';

    return crypto
        .createHash('sha256')
        .update(normalized)
        .digest('hex')
        .slice(0, 12);
}

function parseArgs(argv = []) {
    const options = {
        envFiles: [],
        json: false,
        checkLive: false,
        failOnDrift: false
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '').trim();
        if (!value) continue;

        if (value === '--json') {
            options.json = true;
            continue;
        }

        if (value === '--check-live') {
            options.checkLive = true;
            continue;
        }

        if (value === '--fail-on-drift') {
            options.failOnDrift = true;
            continue;
        }

        if (value === '--env-file') {
            const envFile = path.resolve(process.cwd(), String(argv[index + 1] || '').trim());
            if (envFile) {
                options.envFiles.push(envFile);
            }
            index += 1;
        }
    }

    if (!options.envFiles.length) {
        options.envFiles = DEFAULT_ENV_FILES.filter((candidate) => fs.existsSync(candidate));
    }

    return options;
}

function readEnvFile(envFile) {
    if (!fs.existsSync(envFile)) {
        return {
            envFile,
            exists: false,
            values: {}
        };
    }

    return {
        envFile,
        exists: true,
        values: dotenv.parse(fs.readFileSync(envFile, 'utf8'))
    };
}

function pickFirstAvailable(values, names = []) {
    for (const name of names) {
        const value = String(values?.[name] || '').trim();
        if (value) {
            return {
                name,
                value
            };
        }
    }

    return {
        name: '',
        value: ''
    };
}

function summarizeEnvFile(record) {
    const values = record.values || {};
    const supabaseUrl = String(values.SUPABASE_URL || '').trim();
    const projectHost = supabaseUrl
        ? supabaseUrl.replace(/^https?:\/\//i, '').replace(/\/+$/, '')
        : '';
    const deploymentTier = String(values.DEPLOYMENT_TIER || values.APP_ENV || '').trim().toLowerCase();
    const trustedProxyIps = String(values.TRUSTED_PROXY_IPS || values.TRUSTED_PROXY_CIDRS || '').trim();
    const trustAllProxies = String(values.TRUST_ALL_PROXIES || '').trim().toLowerCase();
    const afdianWebhookTrustedProxies = String(values.AFDIAN_WEBHOOK_TRUSTED_PROXIES || '').trim();
    const afdianWebhookAllowedIps = String(values.AFDIAN_WEBHOOK_ALLOWED_IPS || '').trim();
    const quoteSecret = pickFirstAvailable(values, [
        'PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET',
        'PAYMENT_CUSTOM_QUOTE_SECRET',
        'PAYMENT_QUOTE_SECRET'
    ]);

    return {
        envFile: record.envFile,
        exists: record.exists,
        projectHost,
        supabaseUrl,
        fingerprints: {
            supabase_service_role_key: fingerprintSecret(values.SUPABASE_SERVICE_ROLE_KEY),
            admin_config_encryption_key: fingerprintSecret(values.ADMIN_CONFIG_ENCRYPTION_KEY),
            payment_custom_recharge_quote_secret: fingerprintSecret(quoteSecret.value),
            admin_studio_access_secret: fingerprintSecret(values.ADMIN_STUDIO_ACCESS_SECRET)
        },
        sources: {
            payment_custom_recharge_quote_secret: quoteSecret.name || ''
        },
        missing: {
            supabase_url: !supabaseUrl,
            supabase_service_role_key: !String(values.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
            admin_config_encryption_key: !String(values.ADMIN_CONFIG_ENCRYPTION_KEY || '').trim(),
            payment_custom_recharge_quote_secret: !String(quoteSecret.value || '').trim(),
            admin_studio_access_secret: !String(values.ADMIN_STUDIO_ACCESS_SECRET || '').trim(),
            trusted_proxy_ips: !trustedProxyIps,
            afdian_webhook_trusted_proxies: !afdianWebhookTrustedProxies,
            afdian_webhook_allowed_ips: !afdianWebhookAllowedIps
        },
        runtime: {
            deploymentTier,
            productionLike: deploymentTier === 'production',
            trustAllProxies: trustAllProxies === 'true' || trustAllProxies === '1'
        },
        securityNetwork: {
            trustedProxyIps,
            afdianWebhookTrustedProxies,
            afdianWebhookAllowedIps
        },
        live: null
    };
}

async function checkLiveAccess(summary, values) {
    const supabaseUrl = String(values.SUPABASE_URL || '').trim();
    const serviceRoleKey = String(values.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!supabaseUrl || !serviceRoleKey) {
        return {
            ok: false,
            status: 0,
            statusText: 'Missing credentials',
            paymentOrdersStatus: 0,
            paymentCheckoutSessionsStatus: 0
        };
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    });

    const [systemConfigResult, paymentOrdersResult, paymentCheckoutSessionsResult] = await Promise.all([
        supabase.from('system_config').select('config_key', { count: 'exact', head: true }).limit(1),
        supabase.from('payment_orders').select('id', { count: 'exact', head: true }).limit(1),
        supabase.from('payment_checkout_sessions').select('id', { count: 'exact', head: true }).limit(1)
    ]);

    return {
        ok: !systemConfigResult.error
            && !paymentOrdersResult.error
            && !paymentCheckoutSessionsResult.error,
        status: systemConfigResult.status || 0,
        statusText: systemConfigResult.statusText || '',
        error: systemConfigResult.error?.message || '',
        paymentOrdersStatus: paymentOrdersResult.status || 0,
        paymentOrdersError: paymentOrdersResult.error?.message || '',
        paymentCheckoutSessionsStatus: paymentCheckoutSessionsResult.status || 0,
        paymentCheckoutSessionsError: paymentCheckoutSessionsResult.error?.message || ''
    };
}

function buildDriftFindings(summaries = []) {
    const findings = [];
    const existingSummaries = summaries.filter((item) => item.exists);

    const sameHostGroups = new Map();
    for (const summary of existingSummaries) {
        const host = summary.projectHost || '(missing)';
        if (!sameHostGroups.has(host)) {
            sameHostGroups.set(host, []);
        }
        sameHostGroups.get(host).push(summary);
    }

    for (const [host, group] of sameHostGroups.entries()) {
        if (group.length < 2 || !host || host === '(missing)') continue;
        const fingerprints = new Set(group.map((item) => item.fingerprints.supabase_service_role_key).filter((value) => value !== 'missing'));
        if (fingerprints.size > 1) {
            findings.push({
                severity: 'high',
                type: 'service_role_drift',
                message: `Same Supabase host ${host} is configured with multiple service role fingerprints`,
                envFiles: group.map((item) => item.envFile)
            });
        }
    }

    for (const [field, label] of [
        ['admin_config_encryption_key', 'ADMIN_CONFIG_ENCRYPTION_KEY'],
        ['payment_custom_recharge_quote_secret', 'PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET'],
        ['admin_studio_access_secret', 'ADMIN_STUDIO_ACCESS_SECRET']
    ]) {
        const fingerprints = new Set(
            existingSummaries
                .map((item) => item.fingerprints[field])
                .filter((value) => value !== 'missing')
        );
        if (fingerprints.size > 1) {
            findings.push({
                severity: 'high',
                type: 'shared_secret_drift',
                message: `${label} fingerprints differ across the provided env files`,
                envFiles: existingSummaries
                    .filter((item) => item.fingerprints[field] !== 'missing')
                    .map((item) => item.envFile)
            });
        }
    }

    for (const summary of summaries) {
        if (!summary.exists) {
            findings.push({
                severity: 'medium',
                type: 'missing_env_file',
                message: `Env file is missing: ${summary.envFile}`,
                envFiles: [summary.envFile]
            });
            continue;
        }

        if (summary.live && !summary.live.ok) {
            findings.push({
                severity: 'high',
                type: 'live_access_failed',
                message: `Live Supabase validation failed for ${summary.envFile}`,
                envFiles: [summary.envFile]
            });
        }

        if (summary.runtime?.productionLike) {
            const proxyTrustConfigured = summary.runtime.trustAllProxies
                || !summary.missing.trusted_proxy_ips
                || !summary.missing.afdian_webhook_trusted_proxies;

            if (!proxyTrustConfigured) {
                findings.push({
                    severity: 'high',
                    type: 'proxy_trust_chain_missing',
                    message: `Production-like env is missing TRUSTED_PROXY_IPS / AFDIAN_WEBHOOK_TRUSTED_PROXIES: ${summary.envFile}`,
                    envFiles: [summary.envFile]
                });
            }

            if (summary.missing.afdian_webhook_allowed_ips) {
                findings.push({
                    severity: 'high',
                    type: 'webhook_allowlist_missing',
                    message: `Production-like env is missing AFDIAN_WEBHOOK_ALLOWED_IPS: ${summary.envFile}`,
                    envFiles: [summary.envFile]
                });
            }
        }
    }

    return findings;
}

function formatHumanReport({ summaries = [], findings = [] }) {
    const lines = ['Environment Drift Audit', ''];

    for (const summary of summaries) {
        lines.push(summary.envFile);
        lines.push(`  exists: ${summary.exists ? 'yes' : 'no'}`);
        if (!summary.exists) {
            lines.push('');
            continue;
        }

        lines.push(`  host: ${summary.projectHost || '(missing)'}`);
        lines.push(`  service_role_fp: ${summary.fingerprints.supabase_service_role_key}`);
        lines.push(`  admin_encryption_fp: ${summary.fingerprints.admin_config_encryption_key}`);
        lines.push(`  quote_secret_fp: ${summary.fingerprints.payment_custom_recharge_quote_secret}`);
        lines.push(`  admin_studio_fp: ${summary.fingerprints.admin_studio_access_secret}`);
        lines.push(`  deployment_tier: ${summary.runtime?.deploymentTier || '(missing)'}`);
        lines.push(`  trusted_proxy_ips: ${summary.securityNetwork?.trustedProxyIps || '(missing)'}`);
        lines.push(`  webhook_trusted_proxies: ${summary.securityNetwork?.afdianWebhookTrustedProxies || '(missing)'}`);
        lines.push(`  webhook_allowed_ips: ${summary.securityNetwork?.afdianWebhookAllowedIps || '(missing)'}`);

        if (summary.live) {
            lines.push(`  live_access: ${summary.live.ok ? 'ok' : 'fail'} (${summary.live.status} ${summary.live.statusText || ''})`.trim());
            lines.push(`  payment_orders_status: ${summary.live.paymentOrdersStatus}`);
            lines.push(`  payment_checkout_sessions_status: ${summary.live.paymentCheckoutSessionsStatus}`);
        }

        lines.push('');
    }

    if (!findings.length) {
        lines.push('Findings: none');
    } else {
        lines.push('Findings:');
        for (const finding of findings) {
            lines.push(`- [${finding.severity}] ${finding.message}`);
        }
    }

    return lines.join('\n').trimEnd();
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (!options.envFiles.length) {
        throw new Error('No env files were provided and no default env files were found');
    }

    const records = options.envFiles.map(readEnvFile);
    const summaries = records.map(summarizeEnvFile);

    if (options.checkLive) {
        for (let index = 0; index < records.length; index += 1) {
            if (!records[index].exists) continue;
            summaries[index].live = await checkLiveAccess(summaries[index], records[index].values);
        }
    }

    const findings = buildDriftFindings(summaries);
    const report = {
        audited_at: new Date().toISOString(),
        summaries,
        findings
    };

    console.log(options.json ? JSON.stringify(report, null, 2) : formatHumanReport(report));

    if (options.failOnDrift && findings.length) {
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.message || error);
        process.exitCode = 1;
    });
}

module.exports = {
    buildDriftFindings,
    fingerprintSecret,
    parseArgs,
    summarizeEnvFile
};
