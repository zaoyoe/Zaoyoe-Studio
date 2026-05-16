const crypto = require('crypto');
const { execFileSync } = require('child_process');
const path = require('path');
const vm = require('vm');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const {
    getFirstEnvValue,
    PUBLIC_GOOGLE_CLIENT_ID_CN_ENV_NAMES,
    PUBLIC_GOOGLE_CLIENT_ID_INTL_ENV_NAMES
} = require('../api/_lib/public-runtime-config');
const {
    describeAfdianAllowlist,
    isFailClosedAfdianAllowlist
} = require('./_lib/afdian-network-guards');

const PUBLIC_SUPABASE_URL_ENV_NAMES = Object.freeze([
    'SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'PUBLIC_SUPABASE_URL'
]);
const PUBLIC_SUPABASE_KEY_ENV_NAMES = Object.freeze([
    'SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY'
]);
const QUOTE_SECRET_ENV_NAMES = Object.freeze([
    'PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET',
    'PAYMENT_CUSTOM_QUOTE_SECRET',
    'PAYMENT_QUOTE_SECRET'
]);

function readEnv(name) {
    return String(process.env[name] || '').trim();
}

function readFirstAvailableEnv(names = []) {
    for (const name of names) {
        const value = readEnv(name);
        if (value) {
            return { name, value };
        }
    }

    return { name: '', value: '' };
}

function fingerprintSecret(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return 'missing';

    return crypto
        .createHash('sha256')
        .update(normalized)
        .digest('hex')
        .slice(0, 12);
}

function classifySupabaseKey(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return 'missing';
    if (/^sb_secret_/i.test(normalized)) return 'secret';
    if (/^sb_publishable_/i.test(normalized)) return 'publishable';
    if (/^sb_anon_/i.test(normalized)) return 'anon';
    if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(normalized)) return 'jwt_like';
    return 'unknown';
}

function isProductionLikeRuntime(env = process.env) {
    const vercelEnv = String(env.VERCEL_ENV || '').trim().toLowerCase();
    const railwayEnv = String(env.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase();
    const deploymentTier = String(env.DEPLOYMENT_TIER || env.APP_ENV || '').trim().toLowerCase();

    return {
        productionLike: vercelEnv === 'production'
            || railwayEnv === 'production'
            || deploymentTier === 'production',
        source: vercelEnv === 'production'
            ? 'VERCEL_ENV'
            : railwayEnv === 'production'
                ? 'RAILWAY_ENVIRONMENT_NAME'
                : deploymentTier === 'production'
                    ? (readEnv('DEPLOYMENT_TIER') ? 'DEPLOYMENT_TIER' : 'APP_ENV')
                    : ''
    };
}

function printCheck(label, ok, details) {
    const status = ok ? '[OK]  ' : '[FAIL]';
    console.log(`${status} ${label}: ${details}`);
}

function normalizeBaseUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return candidate.replace(/\/+$/, '');
}

function normalizeExpectedStaticAssetVersion(value = '') {
    const normalized = String(value || '')
        .trim()
        .replace(/[^A-Za-z0-9_-]/g, '');

    if (/^[0-9a-f]{13,40}$/i.test(normalized)) {
        return normalized.slice(0, 12);
    }

    return normalized.slice(0, 40);
}

function resolveExpectedStaticAssetVersion({
    options = {},
    env = process.env,
    rootDir = process.cwd(),
    execFileSyncImpl = execFileSync
} = {}) {
    const explicitVersion = normalizeExpectedStaticAssetVersion(
        options.expectedAssetVersion
        || env.EXPECTED_STATIC_ASSET_VERSION
        || env.STATIC_ASSET_VERSION
        || ''
    );
    if (explicitVersion) {
        return explicitVersion;
    }

    if (!options.expectCurrentGitVersion) {
        return '';
    }

    const envCommitSha = normalizeExpectedStaticAssetVersion(env.VERCEL_GIT_COMMIT_SHA || '');
    if (envCommitSha) {
        return envCommitSha;
    }

    try {
        return normalizeExpectedStaticAssetVersion(execFileSyncImpl('git', ['rev-parse', 'HEAD'], {
            cwd: rootDir,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }));
    } catch (_) {
        return '';
    }
}

function resolveAppBaseUrl(options = {}, env = process.env) {
    return normalizeBaseUrl(
        options.baseUrl
        || env.APP_BASE_URL
        || env.PAYMENT_SMOKE_BASE_URL
        || ''
    );
}

function parseRuntimeConfigScript(script = '') {
    let loggedError = '';
    const context = {
        globalThis: {},
        console: {
            error(...args) {
                loggedError = args
                    .map((value) => String(value || '').trim())
                    .filter(Boolean)
                    .join(' ')
                    .trim();
            }
        }
    };
    context.global = context.globalThis;

    try {
        vm.runInNewContext(String(script || ''), context, { timeout: 1000 });
    } catch (error) {
        return {
            ok: false,
            error: error.message || 'Failed to evaluate runtime config script'
        };
    }

    const config = context.globalThis.__ZAOYOE_SUPABASE_CONFIG__;
    const url = String(config?.url || '').trim().replace(/\/+$/, '');
    const publishableKey = String(config?.publishableKey || '').trim();
    if (!url || !publishableKey) {
        return {
            ok: false,
            error: loggedError || 'Runtime Supabase config is unavailable'
        };
    }

    return {
        ok: true,
        url,
        publishableKey
    };
}

async function fetchText(url, timeoutMs = 10000, fetchImpl = globalThis.fetch) {
    if (typeof fetchImpl !== 'function') {
        throw new Error('fetch is unavailable in this runtime');
    }

    const response = await fetchImpl(url, {
        method: 'GET',
        headers: {
            Accept: 'application/json, application/javascript, text/plain'
        },
        signal: AbortSignal.timeout(timeoutMs)
    });
    const text = await response.text();
    return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        text
    };
}

async function fetchJson(url, timeoutMs = 10000, fetchImpl = globalThis.fetch) {
    const response = await fetchText(url, timeoutMs, fetchImpl);
    let payload = null;
    if (response.text) {
        try {
            payload = JSON.parse(response.text);
        } catch (_) {
            payload = null;
        }
    }

    return {
        ...response,
        payload
    };
}

function parseArgs(argv = []) {
    const options = {
        allowNonProduction: false,
        envFile: '',
        baseUrl: '',
        checkAppRuntime: false,
        runtimeOnly: false,
        validateSupabase: false,
        validatePaymentSchema: false,
        expectedAssetVersion: '',
        expectCurrentGitVersion: false,
        timeoutMs: 10000
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '').trim();
        if (!value) continue;

        if (value === '--allow-non-production') {
            options.allowNonProduction = true;
            continue;
        }

        if (value === '--validate-supabase') {
            options.validateSupabase = true;
            continue;
        }

        if (value === '--validate-payment-schema') {
            options.validatePaymentSchema = true;
            continue;
        }

        if (value === '--check-app-runtime') {
            options.checkAppRuntime = true;
            continue;
        }

        if (value === '--runtime-only') {
            options.runtimeOnly = true;
            continue;
        }

        if (value === '--expect-current-git-version') {
            options.expectCurrentGitVersion = true;
            continue;
        }

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

        if (value === '--expected-asset-version') {
            options.expectedAssetVersion = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }

        if (value === '--timeout-ms') {
            options.timeoutMs = Number(argv[index + 1]);
            index += 1;
        }
    }

    return options;
}

function buildLocalEnvironmentChecks({ options = {}, env = process.env } = {}) {
    if (options.runtimeOnly) {
        return [];
    }

    const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    const serviceRoleKeyKind = classifySupabaseKey(serviceRoleKey);
    const adminEncryptionKey = String(env.ADMIN_CONFIG_ENCRYPTION_KEY || '').trim();
    const adminStudioAccessSecret = String(env.ADMIN_STUDIO_ACCESS_SECRET || '').trim();
    const quoteSecret = readFirstAvailableEnv(QUOTE_SECRET_ENV_NAMES);
    const runtime = isProductionLikeRuntime(env);
    const trustedProxyIps = String(env.TRUSTED_PROXY_IPS || env.TRUSTED_PROXY_CIDRS || '').trim();
    const trustAllProxies = String(env.TRUST_ALL_PROXIES || '').trim().toLowerCase();
    const webhookTrustedProxies = String(env.AFDIAN_WEBHOOK_TRUSTED_PROXIES || '').trim();
    const webhookAllowedIps = String(env.AFDIAN_WEBHOOK_ALLOWED_IPS || '').trim();
    const webhookAllowlistPlaceholder = isFailClosedAfdianAllowlist(webhookAllowedIps);
    const proxyTrustConfigured = trustAllProxies === 'true'
        || trustAllProxies === '1'
        || Boolean(trustedProxyIps)
        || Boolean(webhookTrustedProxies);
    const requireStrictNetworkGuards = runtime.productionLike;

    return [
        {
            label: 'SUPABASE_SERVICE_ROLE_KEY',
            ok: Boolean(serviceRoleKey) && !['publishable', 'anon'].includes(serviceRoleKeyKind),
            details: !serviceRoleKey
                ? 'missing'
                : ['publishable', 'anon'].includes(serviceRoleKeyKind)
                    ? `looks like a ${serviceRoleKeyKind} key; use an sb_secret_/service-role key instead`
                    : `set, kind=${serviceRoleKeyKind}, fingerprint=${fingerprintSecret(serviceRoleKey)}`
        },
        {
            label: 'ADMIN_CONFIG_ENCRYPTION_KEY',
            ok: Boolean(adminEncryptionKey) && adminEncryptionKey !== serviceRoleKey,
            details: !adminEncryptionKey
                ? 'missing'
                : adminEncryptionKey === serviceRoleKey
                    ? 'must not equal SUPABASE_SERVICE_ROLE_KEY'
                    : `set, independent, fingerprint=${fingerprintSecret(adminEncryptionKey)}`
        },
        {
            label: 'PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET',
            ok: Boolean(quoteSecret.value) && quoteSecret.value !== serviceRoleKey,
            details: !quoteSecret.value
                ? 'missing (checked PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET / PAYMENT_CUSTOM_QUOTE_SECRET / PAYMENT_QUOTE_SECRET)'
                : quoteSecret.value === serviceRoleKey
                    ? `source=${quoteSecret.name}, but it must not equal SUPABASE_SERVICE_ROLE_KEY`
                    : `set via ${quoteSecret.name}, independent, fingerprint=${fingerprintSecret(quoteSecret.value)}`
        },
        {
            label: 'ADMIN_STUDIO_ACCESS_SECRET',
            ok: Boolean(adminStudioAccessSecret)
                && adminStudioAccessSecret !== serviceRoleKey
                && adminStudioAccessSecret !== adminEncryptionKey,
            details: !adminStudioAccessSecret
                ? 'missing'
                : adminStudioAccessSecret === serviceRoleKey
                    ? 'must not equal SUPABASE_SERVICE_ROLE_KEY'
                    : adminStudioAccessSecret === adminEncryptionKey
                        ? 'should be independent from ADMIN_CONFIG_ENCRYPTION_KEY'
                        : `set, independent, fingerprint=${fingerprintSecret(adminStudioAccessSecret)}`
        },
        {
            label: 'production-like runtime',
            ok: runtime.productionLike || options.allowNonProduction,
            details: runtime.productionLike
                ? `enabled via ${runtime.source}`
                : options.allowNonProduction
                    ? 'not production-like, but allowed by --allow-non-production'
                    : 'missing production marker (set DEPLOYMENT_TIER=production if VERCEL_ENV / RAILWAY_ENVIRONMENT_NAME are unavailable)'
        },
        {
            label: 'trusted proxy chain',
            ok: !requireStrictNetworkGuards || proxyTrustConfigured,
            details: proxyTrustConfigured
                ? trustAllProxies === 'true' || trustAllProxies === '1'
                    ? 'enabled via TRUST_ALL_PROXIES'
                    : webhookTrustedProxies
                        ? 'configured via AFDIAN_WEBHOOK_TRUSTED_PROXIES'
                        : 'configured via TRUSTED_PROXY_IPS'
                : 'missing TRUSTED_PROXY_IPS / AFDIAN_WEBHOOK_TRUSTED_PROXIES (or set TRUST_ALL_PROXIES=true only if you fully trust the ingress chain)'
        },
        {
            label: 'Afdian webhook IP allowlist',
            ok: !requireStrictNetworkGuards || (Boolean(webhookAllowedIps) && !webhookAllowlistPlaceholder),
            details: webhookAllowedIps
                ? webhookAllowlistPlaceholder
                    ? 'configured via AFDIAN_WEBHOOK_ALLOWED_IPS, but still using the fail-closed placeholder; replace it after the first real Afdian webhook'
                    : 'configured via AFDIAN_WEBHOOK_ALLOWED_IPS'
                : 'missing AFDIAN_WEBHOOK_ALLOWED_IPS for a production-like runtime'
        }
    ];
}

function loadEnvFile(envFile) {
    if (!envFile) return;
    dotenv.config({
        path: envFile,
        override: true
    });
}

function getSupabaseClient() {
    const url = readEnv('SUPABASE_URL');
    const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !serviceRoleKey) return null;

    return createClient(url, serviceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    });
}

async function runSupabaseValidation({ validatePaymentSchema = false } = {}) {
    const supabase = getSupabaseClient();
    if (!supabase) {
        return [{
            label: 'Supabase live access',
            ok: false,
            details: 'missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'
        }];
    }

    const checks = [];
    const systemConfigResult = await supabase
        .from('system_config')
        .select('config_key', { count: 'exact', head: true })
        .limit(1);

    checks.push({
        label: 'Supabase live access',
        ok: !systemConfigResult.error && systemConfigResult.status >= 200 && systemConfigResult.status < 300,
        details: systemConfigResult.error
            ? `status=${systemConfigResult.status} ${systemConfigResult.statusText || ''} ${systemConfigResult.error.message || ''}`.trim()
            : `status=${systemConfigResult.status} ${systemConfigResult.statusText || 'OK'}`
    });

    if (!validatePaymentSchema) {
        return checks;
    }

    for (const table of ['payment_orders', 'payment_checkout_sessions']) {
        const result = await supabase
            .from(table)
            .select('id', { count: 'exact', head: true })
            .limit(1);

        checks.push({
            label: `${table} schema access`,
            ok: !result.error && result.status >= 200 && result.status < 300,
            details: result.error
                ? `status=${result.status} ${result.statusText || ''} ${result.error.message || ''}`.trim()
                : `status=${result.status} ${result.statusText || 'OK'} count=${Number(result.count || 0)}`
        });
    }

    return checks;
}

function buildRuntimeConfigCheckResult(runtimeConfig, expected = {}) {
    if (!runtimeConfig?.ok) {
        return {
            label: 'app runtime Supabase config',
            ok: false,
            details: runtimeConfig?.error || 'Runtime Supabase config is unavailable'
        };
    }

    const runtimePublishableKeyKind = classifySupabaseKey(runtimeConfig.publishableKey);
    if (runtimePublishableKeyKind === 'secret') {
        return {
            label: 'app runtime Supabase config',
            ok: false,
            details: 'runtime publishable key looks like a secret/service key'
        };
    }

    const expectedUrl = String(expected.supabaseUrl || '').trim().replace(/\/+$/, '');
    if (expectedUrl && runtimeConfig.url !== expectedUrl) {
        return {
            label: 'app runtime Supabase config',
            ok: false,
            details: `remote url=${runtimeConfig.url} does not match env SUPABASE_URL=${expectedUrl}`
        };
    }

    const expectedPublishableKey = String(expected.publishableKey || '').trim();
    if (expectedPublishableKey && runtimeConfig.publishableKey !== expectedPublishableKey) {
        return {
            label: 'app runtime Supabase config',
            ok: false,
            details: `publishable key fingerprint mismatch remote=${fingerprintSecret(runtimeConfig.publishableKey)} env=${fingerprintSecret(expectedPublishableKey)}`
        };
    }

    return {
        label: 'app runtime Supabase config',
        ok: true,
        details: `url=${runtimeConfig.url} publishable_key_fp=${fingerprintSecret(runtimeConfig.publishableKey)}`
    };
}

function buildAuthCheckProbeResult(response = {}) {
    const detail = String(response.payload?.message || response.text || '').trim();

    if (response.status === 404) {
        return {
            label: 'app payment auth-check endpoint',
            ok: false,
            details: 'status=404 Not Found redeploy required before JWT auth probing can run'
        };
    }

    if (response.status === 401) {
        return {
            label: 'app payment auth-check endpoint',
            ok: true,
            details: `status=401 ${response.statusText || 'Unauthorized'} endpoint deployed and auth-gated`
        };
    }

    if (response.ok && response.payload?.success === true) {
        return {
            label: 'app payment auth-check endpoint',
            ok: true,
            details: `status=${response.status} ${response.statusText || 'OK'} endpoint deployed`
        };
    }

    return {
        label: 'app payment auth-check endpoint',
        ok: false,
        details: `status=${response.status} ${response.statusText || ''} ${detail || 'unexpected response'}`.trim()
    };
}

function collectStaticAssetVersionsFromHtml(html = '') {
    const versions = [];
    const pattern = /\b(?:href|src)=["'][^"']+\.(?:css|js)\?[^"']*?\bv=([^&"'\s<>]+)/gi;
    let match = null;

    while ((match = pattern.exec(String(html || ''))) !== null) {
        const version = normalizeExpectedStaticAssetVersion(match[1] || '');
        if (version) {
            versions.push(version);
        }
    }

    return versions;
}

function buildStaticAssetVersionCheckResult(response = {}, expectedAssetVersion = '') {
    const expected = normalizeExpectedStaticAssetVersion(expectedAssetVersion);
    const detail = String(response.text || '').trim();

    if (!response.ok) {
        return {
            label: 'app static asset version',
            ok: false,
            details: `status=${response.status} ${response.statusText || ''} ${detail.slice(0, 160)}`.trim()
        };
    }

    const versions = collectStaticAssetVersionsFromHtml(response.text || '');
    const uniqueVersions = [...new Set(versions)];
    if (!uniqueVersions.length) {
        return {
            label: 'app static asset version',
            ok: false,
            details: 'homepage has no versioned CSS/JS asset references'
        };
    }

    if (uniqueVersions.length > 1) {
        return {
            label: 'app static asset version',
            ok: false,
            details: `homepage has mixed asset versions: ${uniqueVersions.slice(0, 6).join(', ')}`
        };
    }

    const actual = uniqueVersions[0];
    if (expected && actual !== expected) {
        return {
            label: 'app static asset version',
            ok: false,
            details: `homepage version=${actual} does not match expected=${expected}`
        };
    }

    return {
        label: 'app static asset version',
        ok: true,
        details: expected
            ? `version=${actual} refs=${versions.length} expected=${expected}`
            : `version=${actual} refs=${versions.length}`
    };
}

function buildShopCatalogProbeResult(response = {}) {
    const detail = String(response.payload?.message || response.text || '').trim();
    const products = Array.isArray(response.payload?.products)
        ? response.payload.products
        : Array.isArray(response.payload?.data?.products)
            ? response.payload.data.products
            : [];
    const categories = Array.isArray(response.payload?.categories)
        ? response.payload.categories
        : Array.isArray(response.payload?.data?.categories)
            ? response.payload.data.categories
            : [];

    if (!response.ok || response.payload?.success !== true) {
        return {
            label: 'app shop catalog endpoint',
            ok: false,
            details: `status=${response.status} ${response.statusText || ''} ${detail || 'unexpected response'}`.trim()
        };
    }

    if (!products.length) {
        return {
            label: 'app shop catalog endpoint',
            ok: false,
            details: `status=${response.status} ${response.statusText || 'OK'} no active products returned`
        };
    }

    return {
        label: 'app shop catalog endpoint',
        ok: true,
        details: `status=${response.status} ${response.statusText || 'OK'} products=${products.length} categories=${categories.length}`
    };
}

function renderChecklistValue(value, { sensitive = false } = {}) {
    const normalized = String(value || '').trim();
    if (!normalized) return '(missing)';
    if (sensitive) return `set, fingerprint=${fingerprintSecret(normalized)}`;
    return normalized;
}

function buildPlatformEnvChecklist(env = process.env) {
    const supabaseUrl = getFirstEnvValue(PUBLIC_SUPABASE_URL_ENV_NAMES, env);
    const publishableKey = getFirstEnvValue(PUBLIC_SUPABASE_KEY_ENV_NAMES, env);
    const googleClientIdCn = getFirstEnvValue(PUBLIC_GOOGLE_CLIENT_ID_CN_ENV_NAMES, env);
    const googleClientIdIntl = getFirstEnvValue(PUBLIC_GOOGLE_CLIENT_ID_INTL_ENV_NAMES, env);
    const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    const adminEncryptionKey = String(env.ADMIN_CONFIG_ENCRYPTION_KEY || '').trim();
    const adminStudioAccessSecret = String(env.ADMIN_STUDIO_ACCESS_SECRET || '').trim();
    const quoteSecret = getFirstEnvValue(QUOTE_SECRET_ENV_NAMES, env);
    const appBaseUrl = resolveAppBaseUrl({}, env);
    const smokeBaseUrl = normalizeBaseUrl(String(env.PAYMENT_SMOKE_BASE_URL || '').trim());
    const deploymentTier = String(env.DEPLOYMENT_TIER || env.APP_ENV || '').trim();
    const trustedProxyIps = String(env.TRUSTED_PROXY_IPS || env.TRUSTED_PROXY_CIDRS || '').trim();
    const trustAllProxies = String(env.TRUST_ALL_PROXIES || '').trim();
    const afdianWebhookTrustedProxies = String(env.AFDIAN_WEBHOOK_TRUSTED_PROXIES || '').trim();
    const afdianWebhookAllowedIps = String(env.AFDIAN_WEBHOOK_ALLOWED_IPS || '').trim();

    return {
        vercel: [
            { name: 'SUPABASE_URL', value: renderChecklistValue(supabaseUrl) },
            { name: 'SUPABASE_PUBLISHABLE_KEY', value: renderChecklistValue(publishableKey, { sensitive: true }) },
            { name: 'GOOGLE_CLIENT_ID_CN', value: renderChecklistValue(googleClientIdCn) },
            { name: 'GOOGLE_CLIENT_ID_INTL', value: renderChecklistValue(googleClientIdIntl) },
            { name: 'SUPABASE_SERVICE_ROLE_KEY', value: renderChecklistValue(serviceRoleKey, { sensitive: true }) },
            { name: 'ADMIN_CONFIG_ENCRYPTION_KEY', value: renderChecklistValue(adminEncryptionKey, { sensitive: true }) },
            { name: 'PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET', value: renderChecklistValue(quoteSecret, { sensitive: true }) },
            { name: 'ADMIN_STUDIO_ACCESS_SECRET', value: renderChecklistValue(adminStudioAccessSecret, { sensitive: true }) },
            { name: 'DEPLOYMENT_TIER', value: renderChecklistValue(deploymentTier) },
            { name: 'APP_BASE_URL', value: renderChecklistValue(appBaseUrl) },
            { name: 'PAYMENT_SMOKE_BASE_URL', value: renderChecklistValue(smokeBaseUrl || appBaseUrl) },
            { name: 'TRUSTED_PROXY_IPS', value: renderChecklistValue(trustedProxyIps) },
            { name: 'TRUST_ALL_PROXIES', value: renderChecklistValue(trustAllProxies) }
        ],
        railway: [
            { name: 'SUPABASE_URL', value: renderChecklistValue(supabaseUrl) },
            { name: 'SUPABASE_SERVICE_ROLE_KEY', value: renderChecklistValue(serviceRoleKey, { sensitive: true }) },
            { name: 'ADMIN_CONFIG_ENCRYPTION_KEY', value: renderChecklistValue(adminEncryptionKey, { sensitive: true }) },
            { name: 'PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET', value: renderChecklistValue(quoteSecret, { sensitive: true }) },
            { name: 'ADMIN_STUDIO_ACCESS_SECRET', value: renderChecklistValue(adminStudioAccessSecret, { sensitive: true }) },
            { name: 'DEPLOYMENT_TIER', value: renderChecklistValue(deploymentTier) },
            { name: 'APP_BASE_URL', value: renderChecklistValue(appBaseUrl) },
            { name: 'TRUSTED_PROXY_IPS', value: renderChecklistValue(trustedProxyIps) },
            { name: 'AFDIAN_WEBHOOK_TRUSTED_PROXIES', value: renderChecklistValue(afdianWebhookTrustedProxies) },
            { name: 'AFDIAN_WEBHOOK_ALLOWED_IPS', value: describeAfdianAllowlist(afdianWebhookAllowedIps) }
        ]
    };
}

async function runAppRuntimeValidation({
    baseUrl = '',
    env = process.env,
    expectedAssetVersion = '',
    timeoutMs = 10000,
    fetchImpl = globalThis.fetch
} = {}) {
    const resolvedBaseUrl = resolveAppBaseUrl({ baseUrl }, env);
    if (!resolvedBaseUrl) {
        return [{
            label: 'app runtime base url',
            ok: false,
            details: 'missing APP_BASE_URL / PAYMENT_SMOKE_BASE_URL (or pass --base-url)'
        }];
    }

    const checks = [{
        label: 'app runtime base url',
        ok: true,
        details: resolvedBaseUrl
    }];

    try {
        const homepageResponse = await fetchText(
            `${resolvedBaseUrl}/`,
            timeoutMs,
            fetchImpl
        );
        checks.push(buildStaticAssetVersionCheckResult(homepageResponse, expectedAssetVersion));
    } catch (error) {
        checks.push({
            label: 'app static asset version',
            ok: false,
            details: error.message || 'fetch failed'
        });
    }

    try {
        const runtimeResponse = await fetchText(
            `${resolvedBaseUrl}/api/runtime/supabase-config`,
            timeoutMs,
            fetchImpl
        );
        const runtimeConfig = parseRuntimeConfigScript(runtimeResponse.text);

        if (!runtimeResponse.ok) {
            checks.push({
                label: 'app runtime Supabase config',
                ok: false,
                details: `status=${runtimeResponse.status} ${runtimeResponse.statusText || ''} ${(runtimeConfig.error || runtimeResponse.text || '').trim()}`.trim()
            });
        } else {
            checks.push(buildRuntimeConfigCheckResult(runtimeConfig, {
                supabaseUrl: getFirstEnvValue(PUBLIC_SUPABASE_URL_ENV_NAMES, env),
                publishableKey: getFirstEnvValue(PUBLIC_SUPABASE_KEY_ENV_NAMES, env)
            }));
        }
    } catch (error) {
        checks.push({
            label: 'app runtime Supabase config',
            ok: false,
            details: error.message || 'fetch failed'
        });
    }

    try {
        const shopCatalogResponse = await fetchJson(
            `${resolvedBaseUrl}/api/shop/catalog?site=cn`,
            timeoutMs,
            fetchImpl
        );
        checks.push(buildShopCatalogProbeResult(shopCatalogResponse));
    } catch (error) {
        checks.push({
            label: 'app shop catalog endpoint',
            ok: false,
            details: error.message || 'fetch failed'
        });
    }

    try {
        const paymentConfigResponse = await fetchJson(
            `${resolvedBaseUrl}/api/payments/config`,
            timeoutMs,
            fetchImpl
        );

        if (!paymentConfigResponse.ok || paymentConfigResponse.payload?.success !== true) {
            checks.push({
                label: 'app payment config endpoint',
                ok: false,
                details: `status=${paymentConfigResponse.status} ${paymentConfigResponse.statusText || ''} ${String(paymentConfigResponse.payload?.message || paymentConfigResponse.text || '').trim()}`.trim()
            });
        } else {
            const mockRuntime = paymentConfigResponse.payload?.runtime?.mock_payment || null;
            checks.push({
                label: 'app payment config endpoint',
                ok: true,
                details: mockRuntime
                    ? `status=${paymentConfigResponse.status} mock_allowed=${mockRuntime.allowed ? 'yes' : 'no'}${mockRuntime.reason ? ` reason=${mockRuntime.reason}` : ''}`
                    : `status=${paymentConfigResponse.status}`
            });
        }
    } catch (error) {
        checks.push({
            label: 'app payment config endpoint',
            ok: false,
            details: error.message || 'fetch failed'
        });
    }

    try {
        const authCheckResponse = await fetchJson(
            `${resolvedBaseUrl}/api/payments/auth-check`,
            timeoutMs,
            fetchImpl
        );
        checks.push(buildAuthCheckProbeResult(authCheckResponse));
    } catch (error) {
        checks.push({
            label: 'app payment auth-check endpoint',
            ok: false,
            details: error.message || 'fetch failed'
        });
    }

    return checks;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    loadEnvFile(options.envFile);
    const checks = buildLocalEnvironmentChecks({
        options,
        env: process.env
    });

    if (options.validateSupabase || options.validatePaymentSchema) {
        checks.push(...await runSupabaseValidation({
            validatePaymentSchema: options.validatePaymentSchema
        }));
    }

    if (options.checkAppRuntime || resolveAppBaseUrl(options, process.env)) {
        checks.push(...await runAppRuntimeValidation({
            baseUrl: options.baseUrl,
            env: process.env,
            expectedAssetVersion: resolveExpectedStaticAssetVersion({
                options,
                env: process.env
            }),
            timeoutMs: Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 10000
        }));
    }

    console.log('Production Environment Check');
    console.log('Compare ADMIN_CONFIG_ENCRYPTION_KEY, PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET, and ADMIN_STUDIO_ACCESS_SECRET fingerprints across Vercel and Railway; they should match.');
    if (options.envFile) {
        console.log(`Loaded env file: ${options.envFile}`);
    }
    if (options.runtimeOnly) {
        console.log('Runtime-only mode: skipping local secret/env completeness checks.');
    }
    console.log('');

    checks.forEach((check) => {
        printCheck(check.label, check.ok, check.details);
    });

    console.log('');
    console.log('Runtime flags:');
    console.log(`- VERCEL_ENV=${readEnv('VERCEL_ENV') || '(empty)'}`);
    console.log(`- RAILWAY_ENVIRONMENT_NAME=${readEnv('RAILWAY_ENVIRONMENT_NAME') || '(empty)'}`);
    console.log(`- DEPLOYMENT_TIER=${readEnv('DEPLOYMENT_TIER') || '(empty)'}`);
    console.log(`- APP_ENV=${readEnv('APP_ENV') || '(empty)'}`);
    console.log(`- ALLOW_REMOTE_MOCK_PAYMENTS=${readEnv('ALLOW_REMOTE_MOCK_PAYMENTS') || '(empty)'}`);
    console.log(`- ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL=${readEnv('ALLOW_REMOTE_MOCK_PAYMENTS_UNTIL') || '(empty)'}`);
    console.log(`- PAYMENT_ALLOW_REMOTE_MOCK=${readEnv('PAYMENT_ALLOW_REMOTE_MOCK') || '(empty)'}`);
    console.log(`- PAYMENT_ALLOW_REMOTE_MOCK_UNTIL=${readEnv('PAYMENT_ALLOW_REMOTE_MOCK_UNTIL') || '(empty)'}`);
    console.log(`- PAYMENT_MOCK_ALLOW_REMOTE=${readEnv('PAYMENT_MOCK_ALLOW_REMOTE') || '(empty)'}`);
    console.log(`- PAYMENT_MOCK_ALLOW_REMOTE_UNTIL=${readEnv('PAYMENT_MOCK_ALLOW_REMOTE_UNTIL') || '(empty)'}`);
    console.log(`- APP_BASE_URL=${readEnv('APP_BASE_URL') || '(empty)'}`);
    console.log(`- PAYMENT_SMOKE_BASE_URL=${readEnv('PAYMENT_SMOKE_BASE_URL') || '(empty)'}`);

    if (!options.runtimeOnly) {
        console.log('');
        console.log('Platform env checklist:');
        const checklist = buildPlatformEnvChecklist(process.env);
        console.log('- Vercel');
        checklist.vercel.forEach((item) => {
            console.log(`  - ${item.name}=${item.value}`);
        });
        console.log('- Railway / verify server');
        checklist.railway.forEach((item) => {
            console.log(`  - ${item.name}=${item.value}`);
        });
    }

    const failedChecks = checks.filter((check) => !check.ok);
    if (failedChecks.length) {
        console.log('');
        console.log(`Result: FAIL (${failedChecks.length} issue${failedChecks.length > 1 ? 's' : ''})`);
        process.exitCode = 1;
        return;
    }

    console.log('');
    console.log('Result: PASS');
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.message || error);
        process.exitCode = 1;
    });
}

module.exports = {
    buildAuthCheckProbeResult,
    buildLocalEnvironmentChecks,
    buildPlatformEnvChecklist,
    buildRuntimeConfigCheckResult,
    buildShopCatalogProbeResult,
    buildStaticAssetVersionCheckResult,
    classifySupabaseKey,
    collectStaticAssetVersionsFromHtml,
    fetchJson,
    fetchText,
    fingerprintSecret,
    isProductionLikeRuntime,
    loadEnvFile,
    normalizeBaseUrl,
    normalizeExpectedStaticAssetVersion,
    parseArgs,
    parseRuntimeConfigScript,
    resolveExpectedStaticAssetVersion,
    resolveAppBaseUrl,
    runAppRuntimeValidation,
    runSupabaseValidation
};
