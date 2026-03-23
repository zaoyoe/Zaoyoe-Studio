const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildRuntimeConfigCheckResult,
    parseArgs,
    parseRuntimeConfigScript,
    resolveAppBaseUrl,
    runAppRuntimeValidation
} = require('../scripts/check-prod-env');

function createFetchResponse({ status = 200, statusText = 'OK', body = '' } = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText,
        async text() {
            return body;
        }
    };
}

test('check-prod-env parseArgs collects app runtime flags', () => {
    const options = parseArgs([
        '--env-file', 'server/.env.production',
        '--validate-supabase',
        '--validate-payment-schema',
        '--check-app-runtime',
        '--base-url', 'https://www.zaoyoe.com',
        '--timeout-ms', '4321',
        '--allow-non-production'
    ]);

    assert.match(options.envFile, /server\/\.env\.production$/);
    assert.equal(options.validateSupabase, true);
    assert.equal(options.validatePaymentSchema, true);
    assert.equal(options.checkAppRuntime, true);
    assert.equal(options.baseUrl, 'https://www.zaoyoe.com');
    assert.equal(options.timeoutMs, 4321);
    assert.equal(options.allowNonProduction, true);
});

test('resolveAppBaseUrl prefers explicit CLI value and normalizes trailing slashes', () => {
    assert.equal(
        resolveAppBaseUrl(
            { baseUrl: 'https://preview.zaoyoe.com/' },
            { APP_BASE_URL: 'https://ignored.zaoyoe.com' }
        ),
        'https://preview.zaoyoe.com'
    );
    assert.equal(
        resolveAppBaseUrl({}, { PAYMENT_SMOKE_BASE_URL: 'preview.zaoyoe.com/' }),
        'https://preview.zaoyoe.com'
    );
});

test('parseRuntimeConfigScript extracts config or surfaces the inline loader error', () => {
    const okScript = [
        '(function (global) {',
        '  global.__ZAOYOE_SUPABASE_CONFIG__ = { url: "https://demo.supabase.co", publishableKey: "pk_live" };',
        '}(typeof window !== "undefined" ? window : globalThis));'
    ].join('\n');
    const failScript = [
        '(function (global) {',
        '  console.error("Failed to load Supabase runtime config:", "Missing required environment variable: SUPABASE_PUBLISHABLE_KEY");',
        '  global.__ZAOYOE_SUPABASE_CONFIG__ = null;',
        '}(typeof window !== "undefined" ? window : globalThis));'
    ].join('\n');

    assert.deepEqual(parseRuntimeConfigScript(okScript), {
        ok: true,
        url: 'https://demo.supabase.co',
        publishableKey: 'pk_live'
    });
    assert.deepEqual(parseRuntimeConfigScript(failScript), {
        ok: false,
        error: 'Failed to load Supabase runtime config: Missing required environment variable: SUPABASE_PUBLISHABLE_KEY'
    });
});

test('buildRuntimeConfigCheckResult detects runtime url and key mismatches', () => {
    assert.equal(
        buildRuntimeConfigCheckResult(
            { ok: true, url: 'https://demo.supabase.co', publishableKey: 'pk_live' },
            { supabaseUrl: 'https://demo.supabase.co', publishableKey: 'pk_live' }
        ).ok,
        true
    );

    const mismatch = buildRuntimeConfigCheckResult(
        { ok: true, url: 'https://wrong.supabase.co', publishableKey: 'pk_live' },
        { supabaseUrl: 'https://demo.supabase.co', publishableKey: 'pk_live' }
    );
    assert.equal(mismatch.ok, false);
    assert.match(mismatch.details, /does not match env SUPABASE_URL/);
});

test('runAppRuntimeValidation checks runtime config and payment config endpoint health', async () => {
    const calls = [];
    const checks = await runAppRuntimeValidation({
        env: {
            APP_BASE_URL: 'https://www.zaoyoe.com',
            SUPABASE_URL: 'https://demo.supabase.co',
            SUPABASE_PUBLISHABLE_KEY: 'publishable-key'
        },
        fetchImpl: async (url) => {
            calls.push(url);
            if (String(url).endsWith('/api/runtime/supabase-config')) {
                return createFetchResponse({
                    status: 200,
                    body: [
                        '(function (global) {',
                        '  global.__ZAOYOE_SUPABASE_CONFIG__ = { url: "https://demo.supabase.co", publishableKey: "publishable-key" };',
                        '}(typeof window !== "undefined" ? window : globalThis));'
                    ].join('\n')
                });
            }

            return createFetchResponse({
                status: 200,
                body: JSON.stringify({
                    success: true,
                    runtime: {
                        mock_payment: {
                            allowed: true,
                            reason: 'remote_whitelist_until_enabled'
                        }
                    }
                })
            });
        }
    });

    assert.deepEqual(calls, [
        'https://www.zaoyoe.com/api/runtime/supabase-config',
        'https://www.zaoyoe.com/api/payments/config'
    ]);
    assert.equal(checks[0].label, 'app runtime base url');
    assert.equal(checks[1].label, 'app runtime Supabase config');
    assert.equal(checks[1].ok, true);
    assert.equal(checks[2].label, 'app payment config endpoint');
    assert.equal(checks[2].ok, true);
});

test('runAppRuntimeValidation reports remote runtime loader failures clearly', async () => {
    const checks = await runAppRuntimeValidation({
        env: {
            APP_BASE_URL: 'https://www.zaoyoe.com',
            SUPABASE_URL: 'https://demo.supabase.co',
            SUPABASE_PUBLISHABLE_KEY: 'publishable-key'
        },
        fetchImpl: async (url) => {
            if (String(url).endsWith('/api/runtime/supabase-config')) {
                return createFetchResponse({
                    status: 200,
                    body: [
                        '(function (global) {',
                        '  console.error("Failed to load Supabase runtime config:", "Missing required environment variable: SUPABASE_PUBLISHABLE_KEY");',
                        '  global.__ZAOYOE_SUPABASE_CONFIG__ = null;',
                        '}(typeof window !== "undefined" ? window : globalThis));'
                    ].join('\n')
                });
            }

            return createFetchResponse({
                status: 500,
                statusText: 'Internal Server Error',
                body: JSON.stringify({
                    success: false,
                    message: 'broken payment config'
                })
            });
        }
    });

    assert.equal(checks[1].ok, false);
    assert.match(checks[1].details, /Missing required environment variable: SUPABASE_PUBLISHABLE_KEY/);
    assert.equal(checks[2].ok, false);
    assert.match(checks[2].details, /broken payment config/);
});
