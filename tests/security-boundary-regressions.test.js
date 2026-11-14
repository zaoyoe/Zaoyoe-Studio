'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { verifyPurchasePassword } = require('../api/_lib/purchase-step-up');
const { createShopHandlers } = require('../server/api-handlers/public/shop');
const { runDbSecurityAudit, SENSITIVE_TABLES, PURCHASE_FUNCTIONS } = require('../scripts/audit-db-security');
const { runShredder, parseArgs } = require('../scripts/shred-expired-cdks');
const sessionSecurity = require('../api/_lib/session-security');
const site = require('../api/_lib/site');
const discountAssets = require('../api/_lib/discount-assets');
const discountPricing = require('../api/_lib/discount-pricing');

const user = { id: 'security-regression-user', email: 'test@example.invalid' };
const password = '  do-not-log-test-password  ';

function passwordClient(result, calls = []) {
    return { auth: {
        async signInWithPassword(input) { calls.push(input); return result; },
        async signOut(input) { calls.push({ signOut: input }); return { error: null }; }
    } };
}

test('purchase password verifies the exact account, preserves spaces, passes CAPTCHA and revokes only its temporary session', async () => {
    const calls = [];
    const result = await verifyPurchasePassword({ user, password, captchaToken: 'fresh-captcha',
        createClient: () => passwordClient({ data: { user, session: { access_token: 'must-not-escape' } } }, calls) });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(calls, [{ email: user.email, password, options: { captchaToken: 'fresh-captcha' } }, { signOut: { scope: 'local' } }]);
    assert.ok(!JSON.stringify(result).includes('must-not-escape'));
});

test('password step-up rejects false, absent and oversized passwords before invoking Auth', async () => {
    let calls = 0;
    for (const invalid of [undefined, null, '', true, {}, 'x'.repeat(4097)]) {
        const result = await verifyPurchasePassword({ user, password: invalid, createClient() { calls++; } });
        assert.equal(result.ok, false);
        assert.equal(result.status, 401);
    }
    assert.equal(calls, 0);
});

test('password step-up rejects wrong accounts, missing users and authentication errors', async () => {
    for (const result of [undefined, {}, { data: {} }, { data: { user: { id: 'another-user' } } },
        { data: { user }, error: { message: 'sensitive-provider-error' } }]) {
        const verification = await verifyPurchasePassword({ user, password, createClient: () => passwordClient(result) });
        assert.equal(verification.ok, false);
        assert.equal(verification.status, 401);
        assert.ok(!JSON.stringify(verification).includes('sensitive-provider-error'));
    }
});

test('password step-up treats client/configuration/provider failures as unavailable', async () => {
    for (const options of [ { user: {} }, { user: { id: user.id } }, { createClient: undefined },
        { createClient: () => ({ auth: {} }) }, { createClient: () => { throw new Error(password); } },
        { createClient: () => ({ auth: { signInWithPassword: async () => { throw new Error(password); } } }) }]) {
        const verification = await verifyPurchasePassword({ user, password, createClient: () => passwordClient({ data: { user } }), ...options });
        assert.deepEqual(verification, { ok: false, status: 503, code: 'step_up_unavailable' });
        assert.ok(!JSON.stringify(verification).includes(password));
    }
});

function makePurchaseHarness(options = {}) {
    const calls = { auth: 0, passwords: [], rates: [], trusted: [], untrusted: [] };
    const trusted = options.noAdmin ? null : { async rpc(name, params) {
        calls.trusted.push({ name, params });
        if (name === 'check_ip_blacklisted') return options.blacklistResult ?? { data: { blocked: false }, error: null };
        if (options.rpcThrows) throw new Error('timed out after commit');
        return options.rpcResult ?? { data: { success: true, data: { order_id: 'order-test', remaining_points: 42 } }, error: null };
    } };
    const untrusted = { async rpc(name, params) { calls.untrusted.push({ name, params }); throw new Error('untrusted RPC was used'); } };
    const handlers = createShopHandlers({
        admin: {
            getOptionalSupabaseAdmin: () => trusted,
            parseJsonBody: async req => req.body,
            requireAuthenticatedUser: async () => { calls.auth++; return { user: options.user || user, requestSupabase: untrusted, adminSupabase: trusted }; },
            createSupabasePasswordVerificationClient: () => passwordClient(options.passwordResult ?? { data: { user: options.user || user } }, calls.passwords),
            sendJson(res, status, payload) { res.statusCode = status; res.payload = payload; }
        },
        requestSecurity: {
            applyRateLimitHeaders() {},
            resolveClientIp: () => options.ip === undefined ? '203.0.113.20' : options.ip,
            isAllowedRequestOrigin: options.originCheck || (() => ({ allowed: true })),
            takeRateLimitToken: async input => {
                calls.rates.push(input);
                return input.key.startsWith('shop-step-up:') ? (options.stepLimit ?? { allowed: true }) : { allowed: true };
            }
        }, site, discountAssets, discountPricing, opsAlerts: {},
        env: { ...options.env }
    });
    return { calls, async request(body = {}, headers = {}) {
        const res = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, getHeader(name) { return this.headers[name]; } };
        await handlers.purchase({ method: 'POST', headers: { 'user-agent': 'regression-browser', ...headers }, body: { productId: 'product-test', quantity: 1, site: 'cn', ...body } }, res);
        return res;
    } };
}
const stepEnv = { ENABLE_HIGH_VALUE_STEP_UP_VERIFICATION: 'true', SHOP_HIGH_VALUE_THRESHOLD_QUANTITY: '2' };

test('confirmation flags, password headers and non-string bodies cannot bypass purchase step-up', async () => {
    for (const body of [ { confirmed: true }, { confirmed: true, confirmPassword: true }, { confirm_password: {} } ]) {
        const harness = makePurchaseHarness({ env: stepEnv });
        const res = await harness.request({ quantity: 2, ...body }, { 'x-confirm-password': password, 'x-step-up-confirmed': 'true' });
        assert.equal(res.statusCode, 403);
        assert.equal(res.payload.code, 'step_up_confirmation_required');
        assert.equal(res.payload.purchaseNotStarted, true);
        assert.equal(harness.calls.passwords.length, 0);
        assert.equal(harness.calls.trusted.length, 0);
    }
});

test('purchase step-up fails closed on unavailable/malformed persistent limiter and throttles password guesses', async () => {
    for (const stepLimit of [ { unavailable: true, allowed: false }, {}, { allowed: 'true' }, { allowed: false, retryAfterSeconds: 30 } ]) {
        const harness = makePurchaseHarness({ env: stepEnv, stepLimit });
        const res = await harness.request({ quantity: 2, confirmPassword: password });
        assert.equal(res.statusCode, stepLimit.allowed === false && !stepLimit.unavailable ? 429 : 503);
        assert.equal(res.payload.purchaseNotStarted, true);
        assert.equal(harness.calls.passwords.length, 0);
        assert.equal(harness.calls.trusted.length, 0);
        const limit = harness.calls.rates.find(input => input.key.startsWith('shop-step-up:'));
        assert.equal(limit.requirePersistent, true);
        assert.equal(limit.limit, 5);
    }
});

test('wrong password/account stops a purchase before idempotency consumption or database mutation', async () => {
    const harness = makePurchaseHarness({ env: stepEnv, passwordResult: { data: { user: { id: 'attacker' } } } });
    const res = await harness.request({ quantity: 2, confirmPassword: password });
    assert.equal(res.statusCode, 401);
    assert.equal(res.payload.purchaseNotStarted, true);
    assert.equal(harness.calls.trusted.length, 0);
    assert.ok(!harness.calls.rates.some(input => input.key.startsWith('shop-purchase:idempotency')));
});

test('simultaneous quantity and session risk invoke password verification only once', async () => {
    const uniqueUser = { ...user, id: 'both-risk-regression-user' };
    sessionSecurity.detectSessionAnomaly({ headers: { 'user-agent': 'browser' } }, uniqueUser, { env: {} });
    const harness = makePurchaseHarness({ user: uniqueUser, env: { ...stepEnv, ENABLE_SESSION_ANOMALY_DETECTION: 'true' } });
    const res = await harness.request({ quantity: 2, confirmPassword: password, captchaToken: 'fresh-captcha' }, { 'user-agent': 'curl/8.0' });
    assert.equal(res.statusCode, 200);
    assert.equal(harness.calls.passwords.length, 1);
    assert.equal(harness.calls.passwords[0].password, password);
    assert.deepEqual(harness.calls.passwords[0].options, { captchaToken: 'fresh-captcha' });
    assert.equal(harness.calls.rates.filter(input => input.key.startsWith('shop-step-up:')).length, 1);
    assert.equal(harness.calls.trusted.length, 1);
});

test('single- and multi-discount financial RPC errors/timeouts are never retried on another client', async () => {
    for (const discounts of [[], [{ code: 'CODE-A' }, { code: 'CODE-B' }]]) {
        for (const failure of [{ rpcThrows: true }, { rpcResult: { data: null, error: { message: 'post-commit timeout', code: '57014' } } }]) {
            const harness = makePurchaseHarness(failure);
            const res = await harness.request({ discountSelections: discounts });
            assert.ok(res.statusCode >= 400);
            assert.equal(harness.calls.trusted.length, 1);
            assert.equal(harness.calls.trusted[0].name, discounts.length ? 'fn_purchase_shop_item_with_discounts' : 'fn_purchase_shop_item');
            assert.equal(harness.calls.untrusted.length, 0);
        }
    }
});

test('missing trusted purchase client and malformed RPC results never count as successful orders', async () => {
    for (const options of [{ noAdmin: true }, ...[null, {}, [], { success: 'true' }].map(data => ({ rpcResult: { data, error: null } }))]) {
        const harness = makePurchaseHarness(options);
        const res = await harness.request();
        assert.equal(res.statusCode, options.noAdmin ? 503 : 502);
        assert.equal(res.payload.success, false);
        assert.equal(harness.calls.untrusted.length, 0);
    }
});

test('enabled IP blacklist rejects unavailable, malformed and blocked checks before authentication', async () => {
    for (const options of [{ noAdmin: true }, { ip: '' },
        { blacklistResult: { data: null, error: { code: '57014' } } }, { blacklistResult: { data: {} } },
        { blacklistResult: { data: { blocked: 'false' } } }, { blacklistResult: { data: { blocked: true } } }]) {
        const harness = makePurchaseHarness({ ...options, env: { ENABLE_PURCHASE_IP_BLOCKLIST_CHECK: 'true' } });
        const res = await harness.request();
        assert.equal(res.statusCode, options.blacklistResult?.data?.blocked === true ? 403 : 503);
        assert.equal(harness.calls.auth, 0);
    }
});

test('enabled CSRF protection rejects validator exceptions and malformed decisions', async () => {
    for (const originCheck of [() => { throw new Error(password); }, () => null, () => ({}), () => ({ allowed: 'yes' }), () => ({ allowed: false })]) {
        const harness = makePurchaseHarness({ originCheck, env: { ENABLE_CSRF_PROTECTION: 'true' } });
        const res = await harness.request();
        assert.ok([403, 503].includes(res.statusCode));
        assert.equal(harness.calls.auth, 0);
        assert.equal(harness.calls.trusted.length, 0);
        assert.ok(!JSON.stringify(res.payload).includes(password));
    }
});

function auditClients({ tables, functions, probe, throwing = false } = {}) {
    return {
        env: {},
        timeoutMs: 20,
        adminSupabase: { async rpc(name) {
            if (throwing) throw new Error('sensitive-db-diagnostic');
            return { data: name === 'fn_audit_db_security'
                ? tables ?? SENSITIVE_TABLES.map(table_name => ({ table_name, rls_enabled: true, rls_forced: false, has_anon_access: false, status: 'OK' }))
                : functions ?? PURCHASE_FUNCTIONS.map(function_name => ({ function_name, signature: `public.${function_name}(uuid)`, anon_execute: false, authenticated_execute: false, service_execute: true })) };
        } },
        anonSupabase: { from() { return { select() { return this; }, async limit() { return probe ?? { data: null, error: { code: '42501' } }; } }; } }
    };
}

test('database audit reports PASS only with complete catalog, function and anonymous access evidence', async () => {
    const report = await runDbSecurityAudit(auditClients());
    assert.equal(report.status, 'PASS');
    assert.equal(report.passed, true);
    assert.deepEqual(report.violations, []);
});

test('missing/invalid/duplicate/unknown audit evidence and network errors remain INCOMPLETE', async () => {
    const valid = auditClients();
    const tableRows = (await valid.adminSupabase.rpc('fn_audit_db_security')).data;
    const functionRows = (await valid.adminSupabase.rpc('fn_audit_purchase_rpc_security')).data;
    for (const options of [{ tables: [] }, { tables: tableRows.slice(1) }, { tables: [...tableRows, tableRows[0]] },
        { tables: [{ ...tableRows[0], status: 'UNRECOGNIZED' }, ...tableRows.slice(1)] },
        { functions: [] }, { functions: functionRows.slice(1) }, { functions: [...functionRows, functionRows[0]] },
        { functions: functionRows.map(row => ({ ...row, service_execute: 'true' })) }, { throwing: true },
        { probe: { error: { code: 'PGRST301', message: 'sensitive-db-diagnostic' } } }, { probe: {} }]) {
        const report = await runDbSecurityAudit(auditClients(options));
        assert.equal(report.status, 'INCOMPLETE', JSON.stringify(options));
        assert.equal(report.passed, false);
        assert.ok(!JSON.stringify(report).includes('sensitive-db-diagnostic'));
    }
});

test('verified database exposure takes FAIL priority even with incomplete evidence and never logs returned secrets', async () => {
    for (const options of [
        { functions: [], tables: [{ table_name: 'shop_cdk_secrets', rls_enabled: false, rls_forced: false, has_anon_access: false, status: 'OK' }] },
        { tables: [], probe: { data: [{ card: 'secret-card-value' }] } },
        { tables: [], functions: [{ function_name: PURCHASE_FUNCTIONS[0], signature: `public.${PURCHASE_FUNCTIONS[0]}(uuid)`, anon_execute: false, authenticated_execute: true, service_execute: true }] }
    ]) {
        const report = await runDbSecurityAudit(auditClients(options));
        assert.equal(report.status, 'FAIL');
        assert.equal(report.passed, false);
        assert.ok(!JSON.stringify(report).includes('secret-card-value'));
    }
});

test('database audit timeouts and client initialization errors cannot become PASS', async () => {
    const input = auditClients();
    input.adminSupabase.rpc = () => new Promise(() => {});
    const timedOut = await runDbSecurityAudit({ ...input, timeoutMs: 5 });
    assert.equal(timedOut.status, 'INCOMPLETE');
    const missing = await runDbSecurityAudit({ env: {} });
    assert.equal(missing.status, 'INCOMPLETE');
    const seenKeys = [];
    const publishable = await runDbSecurityAudit({
        env: {
            SUPABASE_URL: 'https://test.invalid',
            SUPABASE_SERVICE_ROLE_KEY: 'srv-key',
            SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test'
        },
        clientFactory(_url, key) {
            seenKeys.push(key);
            if (key === 'srv-key') return auditClients().adminSupabase;
            return auditClients().anonSupabase;
        }
    });
    assert.equal(publishable.status, 'PASS');
    assert.equal(publishable.passed, true);
    assert.deepEqual(seenKeys, ['srv-key', 'sb_publishable_test']);
    const initialization = await runDbSecurityAudit({ env: { SUPABASE_URL: 'https://test.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-key' }, clientFactory() { throw new Error('secret-init-error'); } });
    assert.equal(initialization.status, 'INCOMPLETE');
    assert.ok(!JSON.stringify(initialization).includes('secret-init-error'));
});

function shredClient(batches, candidateResult = { count: 0, error: null }) {
    const calls = [];
    const reads = [];
    return { calls, reads, databaseFactory() { return {
        async rpc(name, params) { calls.push({ name, params }); return { data: [{ shredded_count: batches.shift() }], error: null }; },
        from(table) {
            reads.push({ table });
            return {
                select(columns, options) { reads.push({ columns, options }); return this; },
                not(column, operator, value) { reads.push({ column, operator, value }); return this; },
                lt(column, value) { reads.push({ column, value }); return this; },
                async neq(column, value) { reads.push({ column, value }); return candidateResult; }
            };
        }
    }; } };
}
const fakeEnv = { SUPABASE_URL: 'https://test.invalid', SUPABASE_SERVICE_ROLE_KEY: 'injected-test-key' };

test('ciphertext maintenance performs bounded batches and distinguishes complete work from a batch limit', async () => {
    const complete = shredClient([2, 2, 1]);
    const result = await runShredder({ env: fakeEnv, argv: ['--batch', '2', '--max-batches', '3'], databaseFactory: complete.databaseFactory });
    assert.equal(result.status, 'PASS');
    assert.equal(result.shreddedCount, 5);
    assert.equal(complete.calls.length, 3);
    const limited = shredClient([2, 2, 2]);
    const partial = await runShredder({ env: fakeEnv, argv: ['--batch', '2', '--max-batches', '2'], databaseFactory: limited.databaseFactory });
    assert.equal(partial.status, 'INCOMPLETE');
    assert.equal(partial.success, false);
    assert.equal(limited.calls.length, 2);
});

test('short or empty clearing batches with skipped candidates cannot report PASS', async () => {
    for (const batchCount of [0, 1]) {
        const mock = shredClient([batchCount], { count: 3, error: null });
        const result = await runShredder({ env: fakeEnv, argv: ['--batch', '2'], databaseFactory: mock.databaseFactory });
        assert.equal(result.status, 'INCOMPLETE');
        assert.equal(result.success, false);
        assert.equal(result.reason, 'candidates_remaining');
        assert.equal(result.shreddedCount, batchCount);
        assert.equal(result.remainingCandidates, 3);
        assert.equal(mock.calls.length, 1);
        assert.deepEqual(mock.reads[0], { table: 'shop_cdk_secrets' });
        assert.deepEqual(mock.reads[1], { columns: 'inventory_id', options: { count: 'exact', head: true } });
        assert.deepEqual(mock.reads[2], { column: 'delivered_at', operator: 'is', value: null });
        assert.equal(mock.reads[3].column, 'delivered_at');
        assert.ok(Number.isFinite(Date.parse(mock.reads[3].value)));
        assert.deepEqual(mock.reads[4], { column: 'ciphertext', value: 'SHREDDED' });
    }
});

test('failed or malformed candidate counts never turn a short clearing batch into PASS', async () => {
    for (const candidateResult of [{ count: null }, { count: -1 }, { count: '0' }, {}, { count: 0, error: { message: 'private-db-error' } }]) {
        const mock = shredClient([0], candidateResult);
        await assert.rejects(runShredder({ env: fakeEnv, argv: ['--batch', '2'], databaseFactory: mock.databaseFactory }),
            /Candidate count query failed|Invalid candidate count/);
        assert.equal(mock.calls.length, 1);
    }
});

test('maintenance rejects ambiguous CLI parameters and malformed RPC counts', async () => {
    for (const argv of [['--days', '7junk'], ['--days', '-1'], ['--batch', '2.5'], ['--batch', '1001'], ['--max-batches', '101'], ['--max-batches'], ['--unknown']]) {
        assert.throws(() => parseArgs(argv));
    }
    for (const count of [undefined, null, -1, 3, '1', 0.5]) {
        const mock = shredClient([count]);
        await assert.rejects(runShredder({ env: fakeEnv, argv: ['--batch', '2'], databaseFactory: mock.databaseFactory }), /Invalid clearing result/);
        assert.equal(mock.calls.length, 1);
    }
});

test('purchase security SQL covers every overload and preserves historical balances and wallet lot accounting', () => {
    const read = name => fs.readFileSync(path.resolve(__dirname, '../supabase/migrations', name), 'utf8');
    const purchaseSql = read('20261107114915_purchase_security_boundary.sql');
    assert.match(purchaseSql, /FROM pg_proc/);
    for (const name of PURCHASE_FUNCTIONS) assert.ok(purchaseSql.includes(name));
    assert.match(purchaseSql, /REVOKE ALL ON FUNCTION[^\n]+PUBLIC, anon, authenticated/i);
    assert.match(purchaseSql, /GRANT EXECUTE ON FUNCTION[^\n]+service_role/i);
    const coreSql = read('20261107_core_security_hardening.sql');
    assert.doesNotMatch(coreSql, /UPDATE\s+(?:public\.)?points_balance\s+SET/i);
    assert.match(coreSql, /RAISE EXCEPTION/);
    assert.match(coreSql, /INSERT INTO public\.points_ledger[\s\S]+RETURNING id INTO/);
    assert.match(coreSql, /fn_create_wallet_point_lot/);
    assert.match(coreSql, /FOR UPDATE SKIP LOCKED/i);
});
