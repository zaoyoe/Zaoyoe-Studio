const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const {
    bootstrapAccessTokenViaAdminLink
} = require('./payment-smoke-test');
const {
    FALLBACK_FAIL_CLOSED_ALLOWLIST
} = require('./_lib/afdian-network-guards');
const {
    isIpAllowed,
    normalizeIp,
    splitIpRules
} = require('../api/_lib/request-security');

const DEFAULT_ENV_FILE = path.resolve(__dirname, '../server/.env.production');
const DEFAULT_BASE_URL = 'https://www.fatherkey.com';
const DEFAULT_VERIFY_SERVER_URL = 'https://verify-api.fatherkey.com';
const DEFAULT_SAMPLE_COUNT = 5;
const DEFAULT_TIMEOUT_MS = 15000;
function parseArgs(argv = []) {
    const options = {
        envFile: DEFAULT_ENV_FILE,
        baseUrl: DEFAULT_BASE_URL,
        verifyServerUrl: DEFAULT_VERIFY_SERVER_URL,
        adminEmail: '',
        accessToken: '',
        sampleCount: DEFAULT_SAMPLE_COUNT,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        json: false
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '').trim();
        if (!value) continue;

        if (value === '--env-file') {
            options.envFile = path.resolve(process.cwd(), String(argv[index + 1] || '').trim());
            index += 1;
            continue;
        }

        if (value === '--base-url') {
            options.baseUrl = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }

        if (value === '--verify-server-url') {
            options.verifyServerUrl = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }

        if (value === '--admin-email') {
            options.adminEmail = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }

        if (value === '--access-token') {
            options.accessToken = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }

        if (value === '--samples') {
            const parsed = Number.parseInt(String(argv[index + 1] || '').trim(), 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                options.sampleCount = Math.min(parsed, 20);
            }
            index += 1;
            continue;
        }

        if (value === '--timeout-ms') {
            const parsed = Number.parseInt(String(argv[index + 1] || '').trim(), 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                options.timeoutMs = parsed;
            }
            index += 1;
            continue;
        }

        if (value === '--json') {
            options.json = true;
        }
    }

    return options;
}

function loadEnvFile(envFile) {
    if (!envFile || !fs.existsSync(envFile)) {
        return {};
    }

    return dotenv.parse(fs.readFileSync(envFile, 'utf8'));
}

function normalizeBaseUrl(value, fallback = '') {
    const raw = String(value || fallback || '').trim();
    if (!raw) return '';
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return candidate.replace(/\/+$/, '');
}

function isLikelyTestAdminEmail(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return true;
    return normalized.endsWith('@example.com') || normalized.endsWith('.invalid');
}

function chooseAdminEmail(users = []) {
    const normalizedUsers = Array.isArray(users)
        ? users.filter((user) => String(user?.email || '').trim())
        : [];

    const ranked = normalizedUsers
        .map((user) => ({
            email: String(user.email || '').trim(),
            score: isLikelyTestAdminEmail(user.email) ? 1 : 0
        }))
        .sort((left, right) => left.score - right.score || left.email.localeCompare(right.email));

    return ranked[0]?.email || '';
}

async function resolveAdminEmail(envValues = {}, dependencies = {}) {
    const supabaseUrl = String(envValues.SUPABASE_URL || '').trim();
    const serviceRoleKey = String(envValues.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!supabaseUrl || !serviceRoleKey) {
        throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for admin discovery');
    }

    const createClientFn = dependencies.createClient || createClient;
    const supabase = createClientFn(supabaseUrl, serviceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    });

    const { data: roles, error: rolesError } = await supabase
        .from('admin_roles')
        .select('user_id, expires_at')
        .limit(200);

    if (rolesError) {
        throw new Error(rolesError.message || 'Failed to list admin roles');
    }

    const now = Date.now();
    const adminIds = [...new Set((roles || [])
        .filter((role) => {
            if (!role?.user_id) return false;
            if (!role?.expires_at) return true;
            return new Date(role.expires_at).getTime() > now;
        })
        .map((role) => role.user_id))];

    if (!adminIds.length) {
        throw new Error('No active admin users found');
    }

    const users = [];
    let page = 1;
    const perPage = 200;
    while (true) {
        const { data, error } = await supabase.auth.admin.listUsers({
            page,
            perPage
        });

        if (error) {
            throw new Error(error.message || 'Failed to list auth users');
        }

        const batch = Array.isArray(data?.users) ? data.users : [];
        users.push(...batch.filter((user) => adminIds.includes(user.id)));

        if (batch.length < perPage) {
            break;
        }
        page += 1;
    }

    const adminEmail = chooseAdminEmail(users);
    if (!adminEmail) {
        throw new Error('Failed to resolve an admin email for diagnostics');
    }

    return adminEmail;
}

async function resolveAdminAccess(options = {}, envValues = {}, dependencies = {}) {
    if (options.accessToken) {
        return {
            accessToken: options.accessToken,
            adminEmail: String(options.adminEmail || '').trim() || '(provided)',
            authMode: 'access_token'
        };
    }

    const adminEmail = String(options.adminEmail || '').trim() || await resolveAdminEmail(envValues, dependencies);
    const tokenResult = await bootstrapAccessTokenViaAdminLink({
        email: adminEmail,
        baseUrl: normalizeBaseUrl(options.baseUrl, envValues.APP_BASE_URL || envValues.PAYMENT_SMOKE_BASE_URL || DEFAULT_BASE_URL),
        timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS
    }, envValues, dependencies);

    return {
        accessToken: tokenResult.accessToken,
        authMode: tokenResult.authMode,
        adminEmail
    };
}

async function fetchRequestContext({
    verifyServerUrl,
    accessToken,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = globalThis.fetch
} = {}) {
    const response = await fetchImpl(`${normalizeBaseUrl(verifyServerUrl, DEFAULT_VERIFY_SERVER_URL)}/api/admin/network/request-context`, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json'
        },
        signal: AbortSignal.timeout(timeoutMs)
    });
    const text = await response.text();
    let payload = null;
    if (text) {
        try {
            payload = JSON.parse(text);
        } catch (_) {
            payload = { raw: text };
        }
    }

    return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        payload
    };
}

function summarizeSamples(samples = []) {
    const socketIps = [...new Set(samples
        .map((sample) => String(sample?.appProxy?.socket_ip || '').trim())
        .filter(Boolean))]
        .sort();
    const configuredTrustedProxyRules = [...new Set(samples
        .flatMap((sample) => [
            ...(Array.isArray(sample?.appProxy?.trusted_proxies) ? sample.appProxy.trusted_proxies : []),
            ...(Array.isArray(sample?.afdianWebhook?.trusted_proxies) ? sample.afdianWebhook.trusted_proxies : [])
        ])
        .map((rule) => String(rule || '').trim())
        .filter(Boolean))]
        .sort();
    const forwardedIps = [...new Set(samples
        .flatMap((sample) => {
            const headerValue = String(sample?.appProxy?.forwarding_headers?.['x-forwarded-for'] || '').trim();
            if (!headerValue) return [];
            return headerValue.split(',').map((entry) => String(entry || '').trim()).filter(Boolean);
        }))]
        .sort();
    const resolvedClientIps = [...new Set(samples
        .map((sample) => String(sample?.appProxy?.resolved_client_ip || '').trim())
        .filter(Boolean))]
        .sort();
    const findings = [...new Set(samples
        .flatMap((sample) => Array.isArray(sample?.findings) ? sample.findings : [])
        .map((finding) => String(finding?.code || '').trim())
        .filter(Boolean))]
        .sort();
    const proxyRecommendationRules = [...configuredTrustedProxyRules];
    socketIps.forEach((ip) => {
        const normalizedIp = normalizeIp(ip);
        if (!normalizedIp) return;
        const alreadyCovered = proxyRecommendationRules.some((rule) => isIpAllowed(normalizedIp, rule));
        if (!alreadyCovered) {
            proxyRecommendationRules.push(`${normalizedIp}/32`);
        }
    });

    const normalizedProxyRecommendationRules = [...new Set(splitIpRules(proxyRecommendationRules))].sort();

    return {
        sampleCount: samples.length,
        socketIps,
        configuredTrustedProxyRules,
        forwardedIps,
        resolvedClientIps,
        findings,
        recommendedTrustedProxyIps: normalizedProxyRecommendationRules.join(','),
        recommendedWebhookTrustedProxies: normalizedProxyRecommendationRules.join(','),
        recommendedWebhookAllowlist: FALLBACK_FAIL_CLOSED_ALLOWLIST,
        requiresRealWebhookObservation: true
    };
}

function formatHumanReport(result = {}) {
    const lines = ['Proxy Chain Inspection', ''];
    lines.push(`verify_server_url: ${result.verifyServerUrl || DEFAULT_VERIFY_SERVER_URL}`);
    lines.push(`base_url: ${result.baseUrl || DEFAULT_BASE_URL}`);
    lines.push(`admin_email: ${result.adminEmail || '(auto-discovered)'}`);
    lines.push(`auth_mode: ${result.authMode || '(unknown)'}`);
    lines.push(`samples: ${Number(result.summary?.sampleCount || 0)}`);
    lines.push('');
    lines.push(`socket_ips: ${(result.summary?.socketIps || []).join(', ') || '(none)'}`);
    lines.push(`configured_trusted_proxies: ${(result.summary?.configuredTrustedProxyRules || []).join(', ') || '(none)'}`);
    lines.push(`forwarded_client_ips: ${(result.summary?.forwardedIps || []).join(', ') || '(none)'}`);
    lines.push(`resolved_client_ips_before_trust: ${(result.summary?.resolvedClientIps || []).join(', ') || '(none)'}`);
    lines.push(`findings: ${(result.summary?.findings || []).join(', ') || '(none)'}`);
    lines.push('');
    lines.push('recommended_env');
    lines.push(`  TRUSTED_PROXY_IPS=${result.summary?.recommendedTrustedProxyIps || '(unavailable)'}`);
    lines.push(`  AFDIAN_WEBHOOK_TRUSTED_PROXIES=${result.summary?.recommendedWebhookTrustedProxies || '(unavailable)'}`);
    lines.push(`  AFDIAN_WEBHOOK_ALLOWED_IPS=${result.summary?.recommendedWebhookAllowlist || FALLBACK_FAIL_CLOSED_ALLOWLIST}`);
    lines.push('');
    lines.push('notes');
    lines.push('  - The webhook allowlist above is a fail-closed placeholder until a real Afdian webhook can be observed.');
    lines.push('  - After setting TRUSTED_PROXY_IPS and AFDIAN_WEBHOOK_TRUSTED_PROXIES, redeploy and trigger a real Afdian callback.');
    lines.push('  - Replace AFDIAN_WEBHOOK_ALLOWED_IPS with the resolved_client_ip logged for that real webhook.');
    return lines.join('\n');
}

async function runInspection(options = {}, dependencies = {}) {
    const envValues = dependencies.envValues || loadEnvFile(options.envFile);
    const verifyServerUrl = normalizeBaseUrl(options.verifyServerUrl, DEFAULT_VERIFY_SERVER_URL);
    const baseUrl = normalizeBaseUrl(options.baseUrl, envValues.APP_BASE_URL || envValues.PAYMENT_SMOKE_BASE_URL || DEFAULT_BASE_URL);

    const access = await resolveAdminAccess({
        ...options,
        verifyServerUrl,
        baseUrl
    }, envValues, dependencies);

    const samples = [];
    for (let index = 0; index < (options.sampleCount || DEFAULT_SAMPLE_COUNT); index += 1) {
        const response = await fetchRequestContext({
            verifyServerUrl,
            accessToken: access.accessToken,
            timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
            fetchImpl: dependencies.fetchImpl
        });
        const payload = response.payload || {};
        samples.push({
            status: response.status,
            appProxy: payload?.request_context?.app_proxy || {},
            afdianWebhook: payload?.request_context?.afdian_webhook || {},
            findings: Array.isArray(payload?.findings) ? payload.findings : []
        });
    }

    return {
        verifyServerUrl,
        baseUrl,
        adminEmail: access.adminEmail,
        authMode: access.authMode,
        samples,
        summary: summarizeSamples(samples)
    };
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const result = await runInspection(options);
    if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    console.log(formatHumanReport(result));
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.message || error);
        process.exitCode = 1;
    });
}

module.exports = {
    FALLBACK_FAIL_CLOSED_ALLOWLIST,
    DEFAULT_VERIFY_SERVER_URL,
    chooseAdminEmail,
    formatHumanReport,
    normalizeBaseUrl,
    parseArgs,
    resolveAdminEmail,
    runInspection,
    summarizeSamples
};
