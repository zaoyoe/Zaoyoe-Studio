const fs = require('fs');
const path = require('path');
const vm = require('vm');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

const DEFAULT_ENV_FILE = path.resolve(__dirname, '../server/.env.production');
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_SITE = 'cn';
const DEFAULT_PROVIDER = 'mock';
const DEFAULT_POINTS_AMOUNT = 50;
const DEFAULT_PAID_AMOUNT = 1;
const NON_PRODUCTION_HOST_MARKERS = Object.freeze([
    'localhost',
    '127.0.0.1',
    '.local',
    '.test',
    '.internal',
    '.pages.dev',
    '.vercel.app',
    'staging',
    'preview',
    'sandbox',
    'testing',
    'test',
    'dev',
    'qa',
    'stg'
]);
const PUBLIC_SUPABASE_KEY_ENV_NAMES = Object.freeze([
    'SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY'
]);
const PUBLIC_SUPABASE_URL_ENV_NAMES = Object.freeze([
    'NEXT_PUBLIC_SUPABASE_URL',
    'PUBLIC_SUPABASE_URL',
    'SUPABASE_URL'
]);
const SERVICE_ROLE_ENV_NAMES = Object.freeze([
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SERVICE_KEY'
]);

function parseArgs(argv = []) {
    const options = {
        envFile: DEFAULT_ENV_FILE,
        baseUrl: '',
        accessToken: '',
        email: '',
        password: '',
        site: '',
        provider: '',
        packageId: '',
        pointsAmount: null,
        paidAmount: null,
        orderNo: '',
        configOnly: false,
        allowProductionLike: false,
        json: false,
        timeoutMs: null
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

        if (value === '--access-token') {
            options.accessToken = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }

        if (value === '--email') {
            options.email = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }

        if (value === '--password') {
            options.password = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }

        if (value === '--site') {
            options.site = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }

        if (value === '--provider') {
            options.provider = String(argv[index + 1] || '').trim().toLowerCase();
            index += 1;
            continue;
        }

        if (value === '--package-id') {
            options.packageId = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }

        if (value === '--points') {
            options.pointsAmount = Number(argv[index + 1]);
            index += 1;
            continue;
        }

        if (value === '--amount') {
            options.paidAmount = Number(argv[index + 1]);
            index += 1;
            continue;
        }

        if (value === '--order-no') {
            options.orderNo = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }

        if (value === '--timeout-ms') {
            options.timeoutMs = Number(argv[index + 1]);
            index += 1;
            continue;
        }

        if (value === '--config-only') {
            options.configOnly = true;
            continue;
        }

        if (value === '--allow-production-like') {
            options.allowProductionLike = true;
            continue;
        }

        if (value === '--json') {
            options.json = true;
        }
    }

    return options;
}

function readEnvFile(envFile) {
    if (!envFile || !fs.existsSync(envFile)) {
        return {};
    }

    return dotenv.parse(fs.readFileSync(envFile, 'utf8'));
}

function normalizeBaseUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return candidate.replace(/\/+$/, '');
}

function resolveEnvBoolean(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function resolveOptions(cliOptions, envValues = {}) {
    const resolved = {
        envFile: cliOptions.envFile,
        baseUrl: normalizeBaseUrl(
            cliOptions.baseUrl
            || envValues.PAYMENT_SMOKE_BASE_URL
            || envValues.APP_BASE_URL
            || ''
        ),
        accessToken: String(
            cliOptions.accessToken
            || envValues.PAYMENT_SMOKE_ACCESS_TOKEN
            || envValues.SMOKE_TEST_ACCESS_TOKEN
            || ''
        ).trim(),
        email: String(
            cliOptions.email
            || envValues.PAYMENT_SMOKE_EMAIL
            || envValues.SMOKE_TEST_EMAIL
            || ''
        ).trim(),
        password: String(
            cliOptions.password
            || envValues.PAYMENT_SMOKE_PASSWORD
            || envValues.SMOKE_TEST_PASSWORD
            || ''
        ).trim(),
        site: String(cliOptions.site || envValues.PAYMENT_SMOKE_SITE || DEFAULT_SITE).trim().toLowerCase() || DEFAULT_SITE,
        provider: String(cliOptions.provider || envValues.PAYMENT_SMOKE_PROVIDER || DEFAULT_PROVIDER).trim().toLowerCase() || DEFAULT_PROVIDER,
        packageId: String(cliOptions.packageId || envValues.PAYMENT_SMOKE_PACKAGE_ID || '').trim(),
        pointsAmount: Number.isFinite(cliOptions.pointsAmount)
            ? cliOptions.pointsAmount
            : Number(envValues.PAYMENT_SMOKE_POINTS || DEFAULT_POINTS_AMOUNT),
        paidAmount: Number.isFinite(cliOptions.paidAmount)
            ? cliOptions.paidAmount
            : Number(envValues.PAYMENT_SMOKE_AMOUNT || DEFAULT_PAID_AMOUNT),
        orderNo: String(cliOptions.orderNo || envValues.PAYMENT_SMOKE_ORDER_NO || '').trim(),
        configOnly: cliOptions.configOnly || resolveEnvBoolean(envValues.PAYMENT_SMOKE_CONFIG_ONLY),
        allowProductionLike: cliOptions.allowProductionLike || resolveEnvBoolean(envValues.PAYMENT_SMOKE_ALLOW_PRODUCTION_LIKE),
        json: cliOptions.json,
        timeoutMs: Number.isFinite(cliOptions.timeoutMs) && cliOptions.timeoutMs > 0
            ? cliOptions.timeoutMs
            : DEFAULT_TIMEOUT_MS
    };

    if (!resolved.orderNo) {
        resolved.orderNo = `SMOKE_${Date.now()}`;
    }

    return resolved;
}

function isProductionLikeBaseUrl(baseUrl) {
    const normalized = normalizeBaseUrl(baseUrl);
    if (!normalized) return false;

    let hostname = '';
    try {
        hostname = new URL(normalized).hostname.toLowerCase();
    } catch (_) {
        return true;
    }

    if (!hostname) return true;

    return !NON_PRODUCTION_HOST_MARKERS.some((marker) => hostname === marker || hostname.includes(marker));
}

function buildPaymentCreatePayload(options = {}) {
    const payload = {
        site: String(options.site || DEFAULT_SITE).trim().toLowerCase() || DEFAULT_SITE,
        provider_key: String(options.provider || DEFAULT_PROVIDER).trim().toLowerCase() || DEFAULT_PROVIDER,
        order_no: String(options.orderNo || '').trim()
    };

    if (options.packageId) {
        payload.package_id = String(options.packageId || '').trim();
    } else {
        payload.points_amount = Number(options.pointsAmount);
        payload.paid_amount = Number(options.paidAmount);
    }

    return payload;
}

async function fetchWithTimeout(url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetchImpl(url, {
            ...init,
            signal: controller.signal
        });
    } finally {
        clearTimeout(timeoutId);
    }
}

async function fetchJson(baseUrl, pathname, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch) {
    const response = await fetchWithTimeout(`${normalizeBaseUrl(baseUrl)}${pathname}`, init, timeoutMs, fetchImpl);
    const text = await response.text();
    let payload = null;

    if (text) {
        try {
            payload = JSON.parse(text);
        } catch (_) {
            payload = null;
        }
    }

    return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        payload,
        text
    };
}

function parseRuntimeSupabaseConfig(script = '') {
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

    vm.runInNewContext(String(script || ''), context, { timeout: 1000 });

    const config = context.globalThis.__ZAOYOE_SUPABASE_CONFIG__;
    const url = String(config?.url || '').trim().replace(/\/+$/, '');
    const publishableKey = String(config?.publishableKey || '').trim();
    if (!url || !publishableKey) {
        throw new Error(loggedError || 'Runtime Supabase config is unavailable');
    }

    return {
        url,
        publishableKey
    };
}

async function loadRuntimeSupabaseConfig(baseUrl, timeoutMs) {
    const response = await fetchWithTimeout(
        `${normalizeBaseUrl(baseUrl)}/api/runtime/supabase-config`,
        { method: 'GET' },
        timeoutMs
    );
    const script = await response.text();

    if (!response.ok) {
        throw new Error(`Failed to fetch runtime Supabase config (${response.status} ${response.statusText})`);
    }

    return parseRuntimeSupabaseConfig(script);
}

function pickFirstValue(values = {}, names = []) {
    for (const name of names) {
        const value = String(values?.[name] || '').trim();
        if (value) {
            return value;
        }
    }
    return '';
}

async function resolveSupabasePublicConfig(baseUrl, envValues = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const url = pickFirstValue(envValues, PUBLIC_SUPABASE_URL_ENV_NAMES).replace(/\/+$/, '');
    const publishableKey = pickFirstValue(envValues, PUBLIC_SUPABASE_KEY_ENV_NAMES);

    if (url && publishableKey) {
        return { url, publishableKey };
    }

    return loadRuntimeSupabaseConfig(baseUrl, timeoutMs);
}

function getSupabaseClientFactory(dependencies = {}) {
    return typeof dependencies.createClient === 'function'
        ? dependencies.createClient
        : createClient;
}

function createPublicSupabaseClient(publicConfig = {}, dependencies = {}) {
    const createClientFn = getSupabaseClientFactory(dependencies);
    return createClientFn(publicConfig.url, publicConfig.publishableKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
        }
    });
}

function buildOtpVerificationAttempts(email = '', properties = {}) {
    const normalizedEmail = String(email || '').trim();
    const token = String(properties?.email_otp || '').trim();
    const hashedToken = String(properties?.hashed_token || '').trim();

    return [
        token
            ? {
                label: 'magiclink_email_otp',
                args: { email: normalizedEmail, token, type: 'magiclink' }
            }
            : null,
        token
            ? {
                label: 'email_email_otp',
                args: { email: normalizedEmail, token, type: 'email' }
            }
            : null,
        hashedToken
            ? {
                label: 'magiclink_token_hash',
                args: { token_hash: hashedToken, type: 'magiclink' }
            }
            : null,
        hashedToken
            ? {
                label: 'email_token_hash',
                args: { token_hash: hashedToken, type: 'email' }
            }
            : null
    ].filter(Boolean);
}

async function bootstrapAccessTokenViaAdminLink(options = {}, envValues = {}, dependencies = {}) {
    const serviceRoleKey = pickFirstValue(envValues, SERVICE_ROLE_ENV_NAMES);
    if (!serviceRoleKey) {
        throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY for admin magic-link bootstrap');
    }

    const publicConfig = dependencies.publicConfig
        || await resolveSupabasePublicConfig(options.baseUrl, envValues, options.timeoutMs);
    const createClientFn = getSupabaseClientFactory(dependencies);
    const adminSupabase = createClientFn(publicConfig.url, serviceRoleKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    });
    const publicSupabase = createPublicSupabaseClient(publicConfig, dependencies);
    const { data: linkData, error: linkError } = await adminSupabase.auth.admin.generateLink({
        type: 'magiclink',
        email: options.email
    });

    if (linkError) {
        throw new Error(linkError.message || 'Failed to generate magic link for smoke-test user');
    }

    const attempts = buildOtpVerificationAttempts(options.email, linkData?.properties || {});
    if (!attempts.length) {
        throw new Error('Magic-link bootstrap did not return an OTP or token hash');
    }

    const failures = [];
    for (const attempt of attempts) {
        const { data, error } = await publicSupabase.auth.verifyOtp(attempt.args);
        if (!error && data?.session?.access_token) {
            return {
                accessToken: data.session.access_token,
                authMode: `admin_${attempt.label}`
            };
        }

        failures.push(error?.message || `${attempt.label} failed`);
    }

    throw new Error(`Failed to exchange admin-generated magic link for an access token (${failures.join('; ')})`);
}

async function resolveAccessToken(options = {}, envValues = {}, dependencies = {}) {
    if (options.accessToken) {
        return {
            accessToken: options.accessToken,
            authMode: 'access_token'
        };
    }

    if (!options.email) {
        throw new Error('Payment smoke test requires --access-token or PAYMENT_SMOKE_EMAIL');
    }

    const publicConfig = dependencies.publicConfig
        || await resolveSupabasePublicConfig(options.baseUrl, envValues, options.timeoutMs);
    const publicSupabase = createPublicSupabaseClient(publicConfig, dependencies);
    let passwordError = null;

    if (options.password) {
        const { data, error } = await publicSupabase.auth.signInWithPassword({
            email: options.email,
            password: options.password
        });

        if (!error && data?.session?.access_token) {
            return {
                accessToken: data.session.access_token,
                authMode: 'email_password'
            };
        }

        passwordError = error?.message || 'Failed to obtain Supabase access token for smoke test';
    }

    if (pickFirstValue(envValues, SERVICE_ROLE_ENV_NAMES)) {
        try {
            return await bootstrapAccessTokenViaAdminLink(options, envValues, {
                ...dependencies,
                publicConfig
            });
        } catch (bootstrapError) {
            if (passwordError) {
                throw new Error(`${passwordError} (admin magic-link fallback failed: ${bootstrapError.message || bootstrapError})`);
            }
            throw bootstrapError;
        }
    }

    if (passwordError) {
        throw new Error(passwordError);
    }

    throw new Error('Payment smoke test requires --access-token, a working email/password pair, or SUPABASE_SERVICE_ROLE_KEY for admin magic-link bootstrap');
}

function extractResponseErrorDetail(response = {}) {
    const payloadMessage = String(
        response?.payload?.message
        || response?.payload?.error
        || response?.payload?.msg
        || ''
    ).trim();
    if (payloadMessage) {
        return payloadMessage;
    }

    const text = String(response?.text || '').trim();
    if (!text) {
        return '';
    }

    return text.length > 300
        ? `${text.slice(0, 297)}...`
        : text;
}

function validateConfigPayload(response) {
    if (!response.ok) {
        const detail = extractResponseErrorDetail(response);
        throw new Error(
            detail
                ? `Payment config request failed (${response.status} ${response.statusText}): ${detail}`
                : `Payment config request failed (${response.status} ${response.statusText})`
        );
    }
    if (!response.payload || response.payload.success !== true) {
        throw new Error(extractResponseErrorDetail(response) || 'Payment config payload is invalid');
    }

    return response.payload;
}

function validatePaymentCreatePayload(response, provider = DEFAULT_PROVIDER) {
    if (!response.ok) {
        const detail = extractResponseErrorDetail(response);
        throw new Error(
            detail
                ? `Payment create request failed (${response.status} ${response.statusText}): ${detail}`
                : `Payment create request failed (${response.status} ${response.statusText})`
        );
    }
    if (!response.payload || response.payload.success !== true) {
        throw new Error(extractResponseErrorDetail(response) || 'Payment create payload is invalid');
    }

    const payload = response.payload;
    if (!payload.checkout_session_id) {
        throw new Error('Payment create response is missing checkout_session_id');
    }

    if (provider === 'mock') {
        if (!['paid', 'redeemed'].includes(String(payload.status || '').trim().toLowerCase())) {
            throw new Error('Mock payment smoke test did not finish in a paid/redeemed state');
        }
        if (String(payload.checkout_session_status || '').trim().toLowerCase() !== 'completed') {
            throw new Error('Mock payment smoke test did not complete the checkout session');
        }
    }

    return payload;
}

function validateAuthCheckPayload(response = {}) {
    if (!response.ok) {
        const detail = extractResponseErrorDetail(response);
        throw new Error(
            detail
                ? `Payment auth-check failed (${response.status} ${response.statusText}): ${detail}`
                : `Payment auth-check failed (${response.status} ${response.statusText})`
        );
    }
    if (!response.payload || response.payload.success !== true) {
        throw new Error(extractResponseErrorDetail(response) || 'Payment auth-check payload is invalid');
    }

    return response.payload;
}

async function runOptionalAuthCheck(baseUrl, accessToken, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch) {
    const response = await fetchJson(baseUrl, '/api/payments/auth-check', {
        method: 'GET',
        headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`
        }
    }, timeoutMs, fetchImpl);

    if (response.status === 404) {
        return {
            available: false,
            reason: 'endpoint_not_deployed'
        };
    }

    const payload = validateAuthCheckPayload(response);
    return {
        available: true,
        payload
    };
}

function formatHumanReport(report = {}) {
    const lines = ['Payment Smoke Test', ''];
    lines.push(`base_url: ${report.baseUrl || '(missing)'}`);
    lines.push(`site: ${report.site || DEFAULT_SITE}`);
    lines.push(`provider: ${report.provider || DEFAULT_PROVIDER}`);
    lines.push(`config_status: ${report.configStatus || 'unknown'}`);

    if (report.mockRuntime) {
        lines.push(
            `mock_runtime: ${report.mockRuntime.allowed ? 'allowed' : 'blocked'}`
            + (report.mockRuntime.reason ? ` (${report.mockRuntime.reason})` : '')
        );
    }

    if (report.configOnly) {
        lines.push('mode: config_only');
    } else {
        lines.push(`auth_mode: ${report.authMode || 'unknown'}`);
        if (report.authCheckStatus) {
            lines.push(`auth_check: ${report.authCheckStatus}`);
        }
        lines.push(`create_status: ${report.createStatus || 'unknown'}`);
        if (report.checkoutSessionId) {
            lines.push(`checkout_session_id: ${report.checkoutSessionId}`);
        }
        if (report.orderNo) {
            lines.push(`order_no: ${report.orderNo}`);
        }
    }

    return lines.join('\n');
}

async function runPaymentSmokeTest(options = {}) {
    if (!options.baseUrl) {
        throw new Error('Payment smoke test requires --base-url or APP_BASE_URL / PAYMENT_SMOKE_BASE_URL in the env file');
    }

    if (!options.allowProductionLike && isProductionLikeBaseUrl(options.baseUrl)) {
        throw new Error('Refusing to run payment smoke test against a production-like base URL without --allow-production-like');
    }

    const configResponse = await fetchJson(options.baseUrl, '/api/payments/config', {
        method: 'GET',
        headers: {
            Accept: 'application/json'
        }
    }, options.timeoutMs);
    const configPayload = validateConfigPayload(configResponse);
    const mockRuntime = configPayload.runtime?.mock_payment || null;

    const report = {
        ok: true,
        configOnly: options.configOnly,
        baseUrl: options.baseUrl,
        site: options.site,
        provider: options.provider,
        configStatus: 'ok',
        mockRuntime
    };

    if (options.provider === 'mock' && mockRuntime?.allowed !== true) {
        throw new Error(mockRuntime?.message || 'Mock payment is not enabled for the target deployment');
    }

    if (options.configOnly) {
        return report;
    }

    const { accessToken, authMode } = await resolveAccessToken(options, options.envValues || {});
    const authCheck = await runOptionalAuthCheck(options.baseUrl, accessToken, options.timeoutMs);
    const createPayload = buildPaymentCreatePayload(options);
    const createResponse = await fetchJson(options.baseUrl, '/api/payments/create', {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify(createPayload)
    }, options.timeoutMs);
    const paymentPayload = validatePaymentCreatePayload(createResponse, options.provider);

    report.authMode = authMode;
    report.authCheckStatus = authCheck.available
        ? (authCheck.payload?.auth?.session_mode || 'ok')
        : authCheck.reason;
    report.authCheck = authCheck.available ? authCheck.payload : null;
    report.createStatus = String(paymentPayload.status || paymentPayload.checkout_session_status || 'ok');
    report.checkoutSessionId = paymentPayload.checkout_session_id || '';
    report.orderNo = paymentPayload.order_no || createPayload.order_no || '';
    report.payment = paymentPayload;
    return report;
}

async function main() {
    const cliOptions = parseArgs(process.argv.slice(2));
    const envValues = readEnvFile(cliOptions.envFile);
    const options = {
        ...resolveOptions(cliOptions, envValues),
        envValues
    };

    const report = await runPaymentSmokeTest(options);
    console.log(options.json ? JSON.stringify(report, null, 2) : formatHumanReport(report));
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.message || error);
        process.exitCode = 1;
    });
}

module.exports = {
    buildOtpVerificationAttempts,
    DEFAULT_ENV_FILE,
    buildPaymentCreatePayload,
    bootstrapAccessTokenViaAdminLink,
    extractResponseErrorDetail,
    formatHumanReport,
    isProductionLikeBaseUrl,
    parseArgs,
    parseRuntimeSupabaseConfig,
    readEnvFile,
    resolveAccessToken,
    resolveOptions,
    runOptionalAuthCheck,
    runPaymentSmokeTest,
    validateAuthCheckPayload,
    validateConfigPayload,
    validatePaymentCreatePayload
};
