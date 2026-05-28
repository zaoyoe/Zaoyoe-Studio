const test = require('node:test');
const assert = require('node:assert/strict');

const {
    bootstrapAccessTokenViaAdminLink,
    buildOtpVerificationAttempts,
    buildPaymentCreatePayload,
    extractResponseErrorDetail,
    isProductionLikeBaseUrl,
    parseArgs,
    parseRuntimeSupabaseConfig,
    resolveAccessToken,
    resolveOptions,
    runOptionalAuthCheck,
    validateAuthCheckPayload,
    validateConfigPayload,
    validatePaymentCreatePayload
} = require('../scripts/payment-smoke-test');
const {
    buildSupabaseRuntimeScript
} = require('../api/_lib/public-runtime-config');

test('parseArgs collects smoke-test flags', () => {
    const options = parseArgs([
        '--env-file', 'server/.env.production',
        '--base-url', 'https://preview.example.com',
        '--email', 'demo@example.com',
        '--password', 'secret',
        '--site', 'intl',
        '--provider', 'mock',
        '--points', '88',
        '--amount', '1.76',
        '--order-no', 'SMOKE_ORDER_1',
        '--timeout-ms', '5000',
        '--config-only',
        '--allow-production-like',
        '--json'
    ]);

    assert.match(options.envFile, /server\/\.env\.production$/);
    assert.equal(options.baseUrl, 'https://preview.example.com');
    assert.equal(options.email, 'demo@example.com');
    assert.equal(options.password, 'secret');
    assert.equal(options.site, 'intl');
    assert.equal(options.provider, 'mock');
    assert.equal(options.pointsAmount, 88);
    assert.equal(options.paidAmount, 1.76);
    assert.equal(options.orderNo, 'SMOKE_ORDER_1');
    assert.equal(options.timeoutMs, 5000);
    assert.equal(options.configOnly, true);
    assert.equal(options.allowProductionLike, true);
    assert.equal(options.json, true);
});

test('resolveOptions prefers CLI values but can fall back to env defaults', () => {
    const resolved = resolveOptions(parseArgs([]), {
        APP_BASE_URL: 'https://staging.zaoyoe.com',
        PAYMENT_SMOKE_EMAIL: 'staging@example.com',
        PAYMENT_SMOKE_PASSWORD: 'pw',
        PAYMENT_SMOKE_SITE: 'intl',
        PAYMENT_SMOKE_PROVIDER: 'mock',
        PAYMENT_SMOKE_POINTS: '66',
        PAYMENT_SMOKE_AMOUNT: '1.32'
    });

    assert.equal(resolved.baseUrl, 'https://staging.zaoyoe.com');
    assert.equal(resolved.email, 'staging@example.com');
    assert.equal(resolved.password, 'pw');
    assert.equal(resolved.site, 'intl');
    assert.equal(resolved.provider, 'mock');
    assert.equal(resolved.pointsAmount, 66, 'env-provided smoke-test points should be honored');
    assert.equal(resolved.paidAmount, 1.32, 'env-provided smoke-test amount should be honored');
    assert.match(resolved.orderNo, /^SMOKE_/);
});

test('isProductionLikeBaseUrl distinguishes preview hosts from production hosts', () => {
    assert.equal(isProductionLikeBaseUrl('http://localhost:3000'), false);
    assert.equal(isProductionLikeBaseUrl('https://pay-preview.vercel.app'), false);
    assert.equal(isProductionLikeBaseUrl('https://pay-staging.zaoyoe.com'), false);
    assert.equal(isProductionLikeBaseUrl('https://zaoyoe.com'), true);
});

test('parseRuntimeSupabaseConfig extracts public runtime settings from the emitted script', () => {
    const script = buildSupabaseRuntimeScript({
        SUPABASE_URL: 'https://demo.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'publishable-key'
    });

    const config = parseRuntimeSupabaseConfig(script);
    assert.equal(config.url, 'https://demo.supabase.co');
    assert.equal(config.publishableKey, 'publishable-key');
});

test('parseRuntimeSupabaseConfig surfaces runtime loader errors', () => {
    assert.throws(
        () => parseRuntimeSupabaseConfig(
            [
                '(function (global) {',
                '  console.error("Failed to load Supabase runtime config:", "Missing required environment variable: SUPABASE_PUBLISHABLE_KEY");',
                '  global.__ZAOYOE_SUPABASE_CONFIG__ = null;',
                '}(typeof window !== "undefined" ? window : globalThis));'
            ].join('\n')
        ),
        /Missing required environment variable: SUPABASE_PUBLISHABLE_KEY/
    );
});

test('buildPaymentCreatePayload supports both custom recharge and package flows', () => {
    assert.deepEqual(
        buildPaymentCreatePayload({
            site: 'cn',
            provider: 'mock',
            orderNo: 'SMOKE_1',
            pointsAmount: 50,
            paidAmount: 1
        }),
        {
            site: 'cn',
            provider_key: 'mock',
            order_no: 'SMOKE_1',
            points_amount: 50,
            paid_amount: 1
        }
    );

    assert.deepEqual(
        buildPaymentCreatePayload({
            site: 'intl',
            provider: 'afdian',
            orderNo: 'SMOKE_2',
            packageId: 'pkg_123'
        }),
        {
            site: 'intl',
            provider_key: 'afdian',
            order_no: 'SMOKE_2',
            package_id: 'pkg_123'
        }
    );
});

test('validateConfigPayload and validatePaymentCreatePayload enforce expected smoke-test invariants', () => {
    const configPayload = validateConfigPayload({
        ok: true,
        status: 200,
        statusText: 'OK',
        payload: {
            success: true,
            runtime: {
                mock_payment: {
                    allowed: true,
                    reason: 'remote_whitelist_override'
                }
            }
        }
    });

    assert.equal(configPayload.success, true);

    const paymentPayload = validatePaymentCreatePayload({
        ok: true,
        status: 200,
        statusText: 'OK',
        payload: {
            success: true,
            status: 'redeemed',
            checkout_session_id: 'pcs_123',
            checkout_session_status: 'completed'
        }
    }, 'mock');

    assert.equal(paymentPayload.status, 'redeemed');
    assert.equal(paymentPayload.checkout_session_id, 'pcs_123');
});

test('validatePaymentCreatePayload surfaces API-provided auth failures', () => {
    assert.throws(
        () => validatePaymentCreatePayload({
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
            payload: {
                success: false,
                message: 'invalid JWT: signature is invalid'
            }
        }, 'mock'),
        /invalid JWT: signature is invalid/
    );
});

test('validateAuthCheckPayload surfaces API-provided auth failures', () => {
    assert.throws(
        () => validateAuthCheckPayload({
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
            payload: {
                success: false,
                message: 'Auth session missing!'
            }
        }),
        /Auth session missing!/
    );
});

test('extractResponseErrorDetail prefers structured API errors over raw text', () => {
    assert.equal(
        extractResponseErrorDetail({
            payload: {
                message: 'structured failure'
            },
            text: 'fallback text'
        }),
        'structured failure'
    );
});

test('buildOtpVerificationAttempts includes both email OTP and token-hash fallbacks', () => {
    assert.deepEqual(
        buildOtpVerificationAttempts('smoke@example.com', {
            email_otp: '123456',
            hashed_token: 'hash-token'
        }).map((attempt) => attempt.label),
        [
            'magiclink_email_otp',
            'email_email_otp',
            'magiclink_token_hash',
            'email_token_hash'
        ]
    );
});

test('runOptionalAuthCheck tolerates older deployments where the endpoint is not deployed yet', async () => {
    const result = await runOptionalAuthCheck(
        'https://www.fatherkey.com',
        'token',
        5000,
        async () => ({
            ok: false,
            status: 404,
            statusText: 'Not Found',
            async text() {
                return '{"success":false,"message":"Not found"}';
            }
        })
    );

    assert.deepEqual(result, {
        available: false,
        reason: 'endpoint_not_deployed'
    });
});

test('resolveAccessToken keeps a successful password session token usable for subsequent API calls', async () => {
    const calls = [];
    const result = await resolveAccessToken({
        baseUrl: 'https://preview.example.com',
        email: 'smoke@example.com',
        password: 'correct-password',
        timeoutMs: 5000
    }, {
        SUPABASE_URL: 'https://demo.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'publishable-key'
    }, {
        createClient() {
            return {
                auth: {
                    async signInWithPassword() {
                        calls.push('signInWithPassword');
                        return {
                            data: {
                                session: {
                                    access_token: 'password-token'
                                }
                            },
                            error: null
                        };
                    },
                    async signOut() {
                        calls.push('publicSignOut');
                        return {};
                    }
                }
            };
        }
    });

    assert.equal(result.accessToken, 'password-token');
    assert.equal(result.authMode, 'email_password');
    assert.deepEqual(calls, ['signInWithPassword']);
});

test('resolveAccessToken falls back to admin magic-link bootstrap when password auth fails', async () => {
    const calls = [];
    const publicClient = {
        auth: {
            async signInWithPassword() {
                calls.push('signInWithPassword');
                return {
                    data: null,
                    error: {
                        message: 'Invalid login credentials'
                    }
                };
            },
            async signOut() {
                calls.push('publicSignOut');
                return {};
            },
            async verifyOtp(args) {
                calls.push(`verifyOtp:${args.type}`);
                if (args.type === 'magiclink') {
                    return {
                        data: {
                            session: {
                                access_token: 'bootstrap-token'
                            }
                        },
                        error: null
                    };
                }

                return {
                    data: null,
                    error: {
                        message: 'wrong otp type'
                    }
                };
            }
        }
    };
    const adminClient = {
        auth: {
            admin: {
                async generateLink() {
                    calls.push('generateLink');
                    return {
                        data: {
                            properties: {
                                email_otp: '123456'
                            }
                        },
                        error: null
                    };
                }
            }
        }
    };

    const result = await resolveAccessToken({
        baseUrl: 'https://preview.example.com',
        email: 'smoke@example.com',
        password: 'wrong-password',
        timeoutMs: 5000
    }, {
        SUPABASE_URL: 'https://demo.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role'
    }, {
        createClient(url, key) {
            return key === 'service-role'
                ? adminClient
                : publicClient;
        }
    });

    assert.equal(result.accessToken, 'bootstrap-token');
    assert.equal(result.authMode, 'admin_magiclink_email_otp');
    assert.deepEqual(calls, [
        'signInWithPassword',
        'generateLink',
        'verifyOtp:magiclink'
    ]);
});

test('bootstrapAccessTokenViaAdminLink fails clearly when no service-role key is available', async () => {
    await assert.rejects(
        bootstrapAccessTokenViaAdminLink({
            baseUrl: 'https://preview.example.com',
            email: 'smoke@example.com',
            timeoutMs: 5000
        }, {
            SUPABASE_URL: 'https://demo.supabase.co',
            SUPABASE_PUBLISHABLE_KEY: 'publishable-key'
        }),
        /Missing SUPABASE_SERVICE_ROLE_KEY/
    );
});
