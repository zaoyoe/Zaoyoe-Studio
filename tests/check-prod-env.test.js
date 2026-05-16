const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildAuthCheckProbeResult,
    buildLocalEnvironmentChecks,
    buildPlatformEnvChecklist,
    buildRuntimeConfigCheckResult,
    buildShopCatalogProbeResult,
    buildStaticAssetVersionCheckResult,
    classifySupabaseKey,
    collectStaticAssetVersionsFromHtml,
    normalizeExpectedStaticAssetVersion,
    parseArgs,
    parseRuntimeConfigScript,
    resolveExpectedStaticAssetVersion,
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
        '--runtime-only',
        '--base-url', 'https://www.zaoyoe.com',
        '--expected-asset-version', 'd87130bd22f8',
        '--expect-current-git-version',
        '--timeout-ms', '4321',
        '--allow-non-production'
    ]);

    assert.match(options.envFile, /server\/\.env\.production$/);
    assert.equal(options.validateSupabase, true);
    assert.equal(options.validatePaymentSchema, true);
    assert.equal(options.checkAppRuntime, true);
    assert.equal(options.runtimeOnly, true);
    assert.equal(options.baseUrl, 'https://www.zaoyoe.com');
    assert.equal(options.expectedAssetVersion, 'd87130bd22f8');
    assert.equal(options.expectCurrentGitVersion, true);
    assert.equal(options.timeoutMs, 4321);
    assert.equal(options.allowNonProduction, true);
});

test('buildLocalEnvironmentChecks skips local secret failures in runtime-only mode', () => {
    assert.deepEqual(
        buildLocalEnvironmentChecks({
            options: {
                runtimeOnly: true
            },
            env: {}
        }),
        []
    );

    const checks = buildLocalEnvironmentChecks({
        options: {
            runtimeOnly: false,
            allowNonProduction: true
        },
        env: {}
    });
    assert.equal(checks.length, 7);
    assert.equal(checks[0].label, 'SUPABASE_SERVICE_ROLE_KEY');
    assert.equal(checks[0].ok, false);
    assert.equal(checks[5].label, 'trusted proxy chain');
    assert.equal(checks[6].label, 'Afdian webhook IP allowlist');
});

test('buildLocalEnvironmentChecks requires proxy trust and webhook allowlist in production-like envs', () => {
    const checks = buildLocalEnvironmentChecks({
        options: {
            runtimeOnly: false,
            allowNonProduction: false
        },
        env: {
            SUPABASE_SERVICE_ROLE_KEY: 'service-role',
            ADMIN_CONFIG_ENCRYPTION_KEY: 'enc-key',
            PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET: 'quote-key',
            ADMIN_STUDIO_ACCESS_SECRET: 'studio-key',
            DEPLOYMENT_TIER: 'production'
        }
    });

    const proxyCheck = checks.find((check) => check.label === 'trusted proxy chain');
    const allowlistCheck = checks.find((check) => check.label === 'Afdian webhook IP allowlist');
    assert.equal(proxyCheck.ok, false);
    assert.match(proxyCheck.details, /missing TRUSTED_PROXY_IPS/);
    assert.equal(allowlistCheck.ok, false);
    assert.match(allowlistCheck.details, /missing AFDIAN_WEBHOOK_ALLOWED_IPS/);
});

test('buildLocalEnvironmentChecks treats the fail-closed webhook placeholder as incomplete hardening', () => {
    const checks = buildLocalEnvironmentChecks({
        options: {
            runtimeOnly: false,
            allowNonProduction: false
        },
        env: {
            SUPABASE_SERVICE_ROLE_KEY: 'service-role',
            ADMIN_CONFIG_ENCRYPTION_KEY: 'enc-key',
            PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET: 'quote-key',
            ADMIN_STUDIO_ACCESS_SECRET: 'studio-key',
            DEPLOYMENT_TIER: 'production',
            TRUSTED_PROXY_IPS: '100.64.0.5/32,100.64.0.6/32',
            AFDIAN_WEBHOOK_ALLOWED_IPS: '203.0.113.254/32'
        }
    });

    const allowlistCheck = checks.find((check) => check.label === 'Afdian webhook IP allowlist');
    assert.equal(allowlistCheck.ok, false);
    assert.match(allowlistCheck.details, /fail-closed placeholder/);
});

test('classifySupabaseKey and buildLocalEnvironmentChecks reject publishable keys in the service-role slot', () => {
    assert.equal(classifySupabaseKey('sb_secret_demo'), 'secret');
    assert.equal(classifySupabaseKey('sb_publishable_demo'), 'publishable');
    assert.equal(classifySupabaseKey('sb_anon_demo'), 'anon');

    const checks = buildLocalEnvironmentChecks({
        options: {
            runtimeOnly: false,
            allowNonProduction: true
        },
        env: {
            SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_demo',
            ADMIN_CONFIG_ENCRYPTION_KEY: 'enc-key',
            PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET: 'quote-key',
            ADMIN_STUDIO_ACCESS_SECRET: 'studio-key'
        }
    });

    const serviceRoleCheck = checks.find((check) => check.label === 'SUPABASE_SERVICE_ROLE_KEY');
    assert.equal(serviceRoleCheck.ok, false);
    assert.match(serviceRoleCheck.details, /looks like a publishable key/);
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

test('static asset version helpers normalize and compare homepage versions', () => {
    assert.equal(normalizeExpectedStaticAssetVersion('d87130bd22f8be419817c02e33b8abb0915d436f'), 'd87130bd22f8');
    assert.deepEqual(
        collectStaticAssetVersionsFromHtml([
            '<script src="./js/site-config.js?v=d87130bd22f8"></script>',
            '<link rel="stylesheet" href="./css/index.css?v=d87130bd22f8">'
        ].join('\n')),
        ['d87130bd22f8', 'd87130bd22f8']
    );

    const okResult = buildStaticAssetVersionCheckResult(
        {
            ok: true,
            status: 200,
            statusText: 'OK',
            text: '<script src="./js/site-config.js?v=d87130bd22f8"></script>'
        },
        'd87130bd22f8be419817c02e33b8abb0915d436f'
    );
    assert.equal(okResult.ok, true);
    assert.match(okResult.details, /expected=d87130bd22f8/);

    const mismatch = buildStaticAssetVersionCheckResult(
        {
            ok: true,
            status: 200,
            statusText: 'OK',
            text: '<script src="./js/site-config.js?v=21257c39264f"></script>'
        },
        'd87130bd22f8'
    );
    assert.equal(mismatch.ok, false);
    assert.match(mismatch.details, /does not match expected/);
});

test('resolveExpectedStaticAssetVersion prefers explicit env and can fall back to git', () => {
    assert.equal(
        resolveExpectedStaticAssetVersion({
            options: {},
            env: {
                EXPECTED_STATIC_ASSET_VERSION: 'd87130bd22f8'
            }
        }),
        'd87130bd22f8'
    );

    assert.equal(
        resolveExpectedStaticAssetVersion({
            options: {
                expectCurrentGitVersion: true
            },
            env: {},
            execFileSyncImpl: () => '21257c39264f5c516f7c2b84d57c09608b7eb695\n'
        }),
        '21257c39264f'
    );
});

test('buildShopCatalogProbeResult requires a successful catalog with active products', () => {
    const okResult = buildShopCatalogProbeResult({
        ok: true,
        status: 200,
        statusText: 'OK',
        payload: {
            success: true,
            products: [{ id: 'prod_1' }],
            categories: [{ id: 'cat_1' }]
        }
    });
    assert.equal(okResult.ok, true);
    assert.match(okResult.details, /products=1 categories=1/);

    const unavailable = buildShopCatalogProbeResult({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        payload: {
            success: false,
            message: '商城数据暂时不可用，请稍后刷新重试'
        }
    });
    assert.equal(unavailable.ok, false);
    assert.match(unavailable.details, /商城数据暂时不可用/);
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

    const secretRuntimeKey = buildRuntimeConfigCheckResult(
        { ok: true, url: 'https://demo.supabase.co', publishableKey: 'sb_secret_live' },
        { supabaseUrl: 'https://demo.supabase.co', publishableKey: 'pk_live' }
    );
    assert.equal(secretRuntimeKey.ok, false);
    assert.match(secretRuntimeKey.details, /looks like a secret\/service key/);
});

test('buildAuthCheckProbeResult distinguishes redeploy gaps from deployed auth-gated endpoints', () => {
    assert.deepEqual(
        buildAuthCheckProbeResult({
            status: 404,
            statusText: 'Not Found',
            payload: { success: false, message: 'Not found' },
            text: '{"success":false,"message":"Not found"}'
        }),
        {
            label: 'app payment auth-check endpoint',
            ok: false,
            details: 'status=404 Not Found redeploy required before JWT auth probing can run'
        }
    );

    const deployed = buildAuthCheckProbeResult({
        status: 401,
        statusText: 'Unauthorized',
        payload: { success: false, message: 'Auth session missing!' },
        text: '{"success":false,"message":"Auth session missing!"}'
    });
    assert.equal(deployed.ok, true);
    assert.match(deployed.details, /endpoint deployed and auth-gated/);
});

test('buildPlatformEnvChecklist renders the expected Vercel and Railway variables', () => {
    const checklist = buildPlatformEnvChecklist({
        SUPABASE_URL: 'https://demo.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'pk_demo',
        GOOGLE_CLIENT_ID_CN: 'google-cn-client',
        GOOGLE_CLIENT_ID_INTL: 'google-intl-client',
        SUPABASE_SERVICE_ROLE_KEY: 'sr_demo',
        ADMIN_CONFIG_ENCRYPTION_KEY: 'enc_demo',
        PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET: 'quote_demo',
        ADMIN_STUDIO_ACCESS_SECRET: 'studio_demo',
        DEPLOYMENT_TIER: 'production',
        APP_BASE_URL: 'https://www.zaoyoe.com',
        PAYMENT_SMOKE_BASE_URL: 'https://preview.zaoyoe.com',
        TRUSTED_PROXY_IPS: '10.0.0.0/8',
        TRUST_ALL_PROXIES: 'false',
        AFDIAN_WEBHOOK_TRUSTED_PROXIES: '100.64.0.0/10',
        AFDIAN_WEBHOOK_ALLOWED_IPS: '203.0.113.0/24'
    });

    assert.equal(checklist.vercel[0].name, 'SUPABASE_URL');
    assert.equal(checklist.vercel[0].value, 'https://demo.supabase.co');
    assert.equal(checklist.vercel[1].name, 'SUPABASE_PUBLISHABLE_KEY');
    assert.match(checklist.vercel[1].value, /^set, fingerprint=/);
    assert.deepEqual(
        checklist.vercel.slice(2, 4),
        [
            { name: 'GOOGLE_CLIENT_ID_CN', value: 'google-cn-client' },
            { name: 'GOOGLE_CLIENT_ID_INTL', value: 'google-intl-client' }
        ]
    );
    assert.deepEqual(
        checklist.railway.map((item) => item.name),
        [
            'SUPABASE_URL',
            'SUPABASE_SERVICE_ROLE_KEY',
            'ADMIN_CONFIG_ENCRYPTION_KEY',
            'PAYMENT_CUSTOM_RECHARGE_QUOTE_SECRET',
            'ADMIN_STUDIO_ACCESS_SECRET',
            'DEPLOYMENT_TIER',
            'APP_BASE_URL',
            'TRUSTED_PROXY_IPS',
            'AFDIAN_WEBHOOK_TRUSTED_PROXIES',
            'AFDIAN_WEBHOOK_ALLOWED_IPS'
        ]
    );
    assert.equal(checklist.vercel.at(-2).name, 'TRUSTED_PROXY_IPS');
    assert.equal(checklist.vercel.at(-2).value, '10.0.0.0/8');
    assert.equal(checklist.vercel.at(-1).name, 'TRUST_ALL_PROXIES');
    assert.equal(checklist.vercel.at(-1).value, 'false');
});

test('buildPlatformEnvChecklist annotates the fail-closed webhook placeholder', () => {
    const checklist = buildPlatformEnvChecklist({
        AFDIAN_WEBHOOK_ALLOWED_IPS: '203.0.113.254/32'
    });

    const webhookAllowlist = checklist.railway.find((item) => item.name === 'AFDIAN_WEBHOOK_ALLOWED_IPS');
    assert.equal(webhookAllowlist.value, '203.0.113.254/32 (fail-closed placeholder)');
});

test('runAppRuntimeValidation checks runtime config and payment config endpoint health', async () => {
    const calls = [];
    const checks = await runAppRuntimeValidation({
        env: {
            APP_BASE_URL: 'https://www.zaoyoe.com',
            SUPABASE_URL: 'https://demo.supabase.co',
            SUPABASE_PUBLISHABLE_KEY: 'publishable-key'
        },
        expectedAssetVersion: 'd87130bd22f8',
        fetchImpl: async (url) => {
            calls.push(url);
            if (String(url) === 'https://www.zaoyoe.com/') {
                return createFetchResponse({
                    status: 200,
                    body: [
                        '<script src="./js/site-config.js?v=d87130bd22f8"></script>',
                        '<link rel="stylesheet" href="./css/index.css?v=d87130bd22f8">',
                        '<script src="./js/wallet-modal-loader.js?v=d87130bd22f8&iosChromeKeyboard=keep"></script>'
                    ].join('\n')
                });
            }

            if (String(url) === 'https://www.zaoyoe.com/js/wallet-modal-loader.js?v=d87130bd22f8&iosChromeKeyboard=keep') {
                return createFetchResponse({
                    status: 200,
                    body: [
                        "const POINTS_SERVICE_SRC = 'js/services/PointsService.js?v=d87130bd22f8';",
                        "const WALLET_MODAL_SRC = 'js/components/WalletModal.js?v=d87130bd22f8';"
                    ].join('\n')
                });
            }

            if (String(url) === 'https://www.zaoyoe.com/js/services/PointsService.js?v=d87130bd22f8') {
                return createFetchResponse({
                    status: 200,
                    body: 'function refreshSupabaseSession() {}\nwindow.PointsService = PointsService;'
                });
            }

            if (String(url) === 'https://www.zaoyoe.com/js/components/WalletModal.js?v=d87130bd22f8') {
                return createFetchResponse({
                    status: 200,
                    body: 'window.WalletModal = WalletModal;'
                });
            }

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

            if (String(url).endsWith('/api/shop/catalog?site=cn')) {
                return createFetchResponse({
                    status: 200,
                    body: JSON.stringify({
                        success: true,
                        products: [{ id: 'prod_1' }, { id: 'prod_2' }],
                        categories: [{ id: 'cat_1' }]
                    })
                });
            }

            if (String(url).endsWith('/api/payments/auth-check')) {
                return createFetchResponse({
                    status: 401,
                    statusText: 'Unauthorized',
                    body: JSON.stringify({
                        success: false,
                        message: 'Auth session missing!'
                    })
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
        'https://www.zaoyoe.com/',
        'https://www.zaoyoe.com/js/wallet-modal-loader.js?v=d87130bd22f8&iosChromeKeyboard=keep',
        'https://www.zaoyoe.com/js/services/PointsService.js?v=d87130bd22f8',
        'https://www.zaoyoe.com/js/components/WalletModal.js?v=d87130bd22f8',
        'https://www.zaoyoe.com/api/runtime/supabase-config',
        'https://www.zaoyoe.com/api/shop/catalog?site=cn',
        'https://www.zaoyoe.com/api/payments/config',
        'https://www.zaoyoe.com/api/payments/auth-check'
    ]);
    assert.equal(checks[0].label, 'app runtime base url');
    assert.equal(checks[1].label, 'app static asset version');
    assert.equal(checks[1].ok, true);
    assert.equal(checks[2].label, 'app wallet loader asset');
    assert.equal(checks[2].ok, true);
    assert.equal(checks[3].label, 'app wallet service asset');
    assert.equal(checks[3].ok, true);
    assert.equal(checks[4].label, 'app wallet modal asset');
    assert.equal(checks[4].ok, true);
    assert.equal(checks[5].label, 'app runtime Supabase config');
    assert.equal(checks[5].ok, true);
    assert.equal(checks[6].label, 'app shop catalog endpoint');
    assert.equal(checks[6].ok, true);
    assert.equal(checks[7].label, 'app payment config endpoint');
    assert.equal(checks[7].ok, true);
    assert.equal(checks[8].label, 'app payment auth-check endpoint');
    assert.equal(checks[8].ok, true);
});

test('runAppRuntimeValidation reports remote runtime loader failures clearly', async () => {
    const checks = await runAppRuntimeValidation({
        env: {
            APP_BASE_URL: 'https://www.zaoyoe.com',
            SUPABASE_URL: 'https://demo.supabase.co',
            SUPABASE_PUBLISHABLE_KEY: 'publishable-key'
        },
        expectedAssetVersion: 'd87130bd22f8',
        fetchImpl: async (url) => {
            if (String(url) === 'https://www.zaoyoe.com/') {
                return createFetchResponse({
                    status: 200,
                    body: '<script src="./js/site-config.js?v=21257c39264f"></script>'
                });
            }

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

            if (String(url).endsWith('/api/shop/catalog?site=cn')) {
                return createFetchResponse({
                    status: 503,
                    statusText: 'Service Unavailable',
                    body: JSON.stringify({
                        success: false,
                        message: '商城数据暂时不可用，请稍后刷新重试'
                    })
                });
            }

            if (String(url).endsWith('/api/payments/auth-check')) {
                return createFetchResponse({
                    status: 404,
                    statusText: 'Not Found',
                    body: JSON.stringify({
                        success: false,
                        message: 'Not found'
                    })
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

    const assetVersionCheck = checks.find((check) => check.label === 'app static asset version');
    const walletLoaderCheck = checks.find((check) => check.label === 'app wallet loader asset');
    const runtimeConfigCheck = checks.find((check) => check.label === 'app runtime Supabase config');
    const shopCatalogCheck = checks.find((check) => check.label === 'app shop catalog endpoint');
    const paymentConfigCheck = checks.find((check) => check.label === 'app payment config endpoint');
    const authCheck = checks.find((check) => check.label === 'app payment auth-check endpoint');

    assert.equal(assetVersionCheck.ok, false);
    assert.match(assetVersionCheck.details, /does not match expected/);
    assert.equal(walletLoaderCheck.ok, false);
    assert.match(walletLoaderCheck.details, /does not reference js\/wallet-modal-loader\.js/);
    assert.equal(runtimeConfigCheck.ok, false);
    assert.match(runtimeConfigCheck.details, /Missing required environment variable: SUPABASE_PUBLISHABLE_KEY/);
    assert.equal(shopCatalogCheck.ok, false);
    assert.match(shopCatalogCheck.details, /商城数据暂时不可用/);
    assert.equal(paymentConfigCheck.ok, false);
    assert.match(paymentConfigCheck.details, /broken payment config/);
    assert.equal(authCheck.ok, false);
    assert.match(authCheck.details, /redeploy required/);
});

test('runAppRuntimeValidation catches wallet dynamic scripts that resolve to HTML', async () => {
    const checks = await runAppRuntimeValidation({
        env: {
            APP_BASE_URL: 'https://www.zaoyoe.com',
            SUPABASE_URL: 'https://demo.supabase.co',
            SUPABASE_PUBLISHABLE_KEY: 'publishable-key'
        },
        expectedAssetVersion: 'd87130bd22f8',
        fetchImpl: async (url) => {
            const normalizedUrl = String(url);
            if (normalizedUrl === 'https://www.zaoyoe.com/') {
                return createFetchResponse({
                    status: 200,
                    body: [
                        '<script src="./js/site-config.js?v=d87130bd22f8"></script>',
                        '<script src="./js/wallet-modal-loader.js?v=d87130bd22f8"></script>'
                    ].join('\n')
                });
            }

            if (normalizedUrl === 'https://www.zaoyoe.com/js/wallet-modal-loader.js?v=d87130bd22f8') {
                return createFetchResponse({
                    status: 200,
                    body: [
                        "const POINTS_SERVICE_SRC = 'js/services/PointsService.js?v=d87130bd22f8';",
                        "const WALLET_MODAL_SRC = 'js/components/WalletModal.js?v=d87130bd22f8';"
                    ].join('\n')
                });
            }

            if (normalizedUrl === 'https://www.zaoyoe.com/js/services/PointsService.js?v=d87130bd22f8') {
                return createFetchResponse({
                    status: 200,
                    body: '<!DOCTYPE html><html><body>homepage fallback</body></html>'
                });
            }

            if (normalizedUrl === 'https://www.zaoyoe.com/js/components/WalletModal.js?v=d87130bd22f8') {
                return createFetchResponse({
                    status: 200,
                    body: 'window.WalletModal = WalletModal;'
                });
            }

            if (normalizedUrl.endsWith('/api/runtime/supabase-config')) {
                return createFetchResponse({
                    status: 200,
                    body: [
                        '(function (global) {',
                        '  global.__ZAOYOE_SUPABASE_CONFIG__ = { url: "https://demo.supabase.co", publishableKey: "publishable-key" };',
                        '}(typeof window !== "undefined" ? window : globalThis));'
                    ].join('\n')
                });
            }

            if (normalizedUrl.endsWith('/api/shop/catalog?site=cn')) {
                return createFetchResponse({
                    status: 200,
                    body: JSON.stringify({
                        success: true,
                        products: [{ id: 'prod_1' }],
                        categories: []
                    })
                });
            }

            if (normalizedUrl.endsWith('/api/payments/auth-check')) {
                return createFetchResponse({
                    status: 401,
                    statusText: 'Unauthorized',
                    body: JSON.stringify({ success: false, message: 'Unauthorized' })
                });
            }

            return createFetchResponse({
                status: 200,
                body: JSON.stringify({
                    success: true,
                    runtime: {
                        mock_payment: {
                            allowed: false,
                            reason: 'production_like_runtime'
                        }
                    }
                })
            });
        }
    });

    const walletServiceCheck = checks.find((check) => check.label === 'app wallet service asset');
    assert.equal(walletServiceCheck.ok, false);
    assert.match(walletServiceCheck.details, /returned HTML instead of JavaScript/);
});
