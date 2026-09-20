'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    PROMO_MIGRATION,
    PROMO_VERIFY_MIGRATION,
    READINESS_EXIT_CODES,
    REQUIRED_REPO_FILES,
    REQUIRED_TEST_FILES,
    formatHumanReport,
    getReadinessExitCode,
    inspectBuyerCredentials,
    inspectBuyerCredentialFrontend,
    inspectHostedBuyerCredentialFrontend,
    inspectCallbackUrl,
    inspectPromo,
    inspectRepo,
    inspectRunbook,
    loadEnvFile,
    parseArgs,
    parseProviderList,
    runReadiness,
    runReadinessWithHostedFrontend,
    stripSqlComments
} = require('../scripts/guest-shop-readiness');

const REPO_ROOT = path.resolve(__dirname, '..');
const SECRET_VALUES = Object.freeze({
    serviceRole: 'service-role-live-' + 's'.repeat(40),
    claim: 'claim-live-' + 'a'.repeat(48),
    derivation: 'derivation-live-' + 'b'.repeat(48),
    contact: 'contact-live-' + 'c'.repeat(48),
    request: 'request-live-' + 'd'.repeat(48),
    worker: 'worker-live-' + 'e'.repeat(48),
    zpay: 'zpay-live-' + 'f'.repeat(32),
    nowApi: 'now-api-live-' + 'g'.repeat(32),
    nowIpn: 'now-ipn-live-' + 'h'.repeat(32)
});

function completeProductionEnv(overrides = {}) {
    return {
        APP_ENV: 'production',
        APP_BASE_URL: 'https://www.fatherkey.com',
        SUPABASE_URL: 'https://guest-shop.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: SECRET_VALUES.serviceRole,
        GUEST_SHOP_CLAIM_PEPPER: SECRET_VALUES.claim,
        GUEST_SHOP_CLAIM_DERIVATION_PEPPER: SECRET_VALUES.derivation,
        GUEST_SHOP_CONTACT_HASH_PEPPER: SECRET_VALUES.contact,
        GUEST_SHOP_REQUEST_HASH_PEPPER: SECRET_VALUES.request,
        GUEST_SHOP_WORKER_SECRET: SECRET_VALUES.worker,
        GUEST_SHOP_ORDER_TTL_SECONDS: '1800',
        GUEST_SHOP_PAYMENT_CREATE_LEASE_MS: '120000',
        GUEST_SHOP_WEBHOOK_GLOBAL_LIMIT: '1200',
        GUEST_SHOP_WEBHOOK_IP_LIMIT: '120',
        DISABLE_PERSISTENT_RATE_LIMITS: 'false',
        RATE_LIMIT_BACKEND: 'supabase',
        GUEST_SHOP_ENABLED_PROVIDERS: 'zpay,nowpayments',
        ZPAY_PKEY: SECRET_VALUES.zpay,
        ZPAY_WEBHOOK_ALLOWED_IPS: '198.51.100.10/32',
        ZPAY_WEBHOOK_TRUSTED_PROXIES: '10.0.0.1/32',
        GUEST_SHOP_ZPAY_WEBHOOK_URL: 'https://www.fatherkey.com/api/shop/guest/webhooks/zpay',
        NOWPAYMENTS_API_KEY: SECRET_VALUES.nowApi,
        NOWPAYMENTS_IPN_SECRET: SECRET_VALUES.nowIpn,
        GUEST_SHOP_NOWPAYMENTS_PAY_CURRENCY: 'usdtbsc',
        NOWPAYMENTS_WEBHOOK_ALLOWED_IPS: '198.51.100.11/32',
        NOWPAYMENTS_WEBHOOK_TRUSTED_PROXIES: '10.0.0.2/32',
        GUEST_SHOP_NOWPAYMENTS_WEBHOOK_URL: 'https://www.fatherkey.com/api/shop/guest/webhooks/nowpayments',
        ...overrides
    };
}

function checksByKey(summary, key) {
    return (summary.checks || []).filter((check) => check.key === key);
}

function hasFinding(summary, key) {
    return (summary.findings || []).some((finding) => finding.key === key);
}

function createFetchResponse(url, { status = 200, text = '' } = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : 'Error',
        url,
        async text() { return text; }
    };
}

function readKvm4PackagePaths() {
    const deploySource = fs.readFileSync(
        path.join(REPO_ROOT, 'scripts', 'deploy-kvm4-verify-server.sh'),
        'utf8'
    );
    const block = /^PACKAGE_PATHS=\(\r?\n([\s\S]*?)^\)$/mu.exec(deploySource);
    assert.ok(block, 'deploy-kvm4-verify-server.sh must declare PACKAGE_PATHS');
    return block[1]
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((entry) => {
            assert.match(entry, /^[A-Za-z0-9._/-]+$/u, `unsupported PACKAGE_PATHS entry: ${entry}`);
            return entry;
        });
}

function linkKvm4PackageFixture(tempRoot) {
    const packagePaths = readKvm4PackagePaths();
    for (const relativePath of packagePaths) {
        const sourcePath = path.join(REPO_ROOT, relativePath);
        const targetPath = path.join(tempRoot, relativePath);
        if (relativePath === 'server') {
            fs.mkdirSync(targetPath, { recursive: true });
            for (const entry of fs.readdirSync(sourcePath, { withFileTypes: true })) {
                if (entry.name === '.release-commit') continue;
                fs.symlinkSync(
                    path.join(sourcePath, entry.name),
                    path.join(targetPath, entry.name),
                    entry.isDirectory() ? 'dir' : 'file'
                );
            }
            continue;
        }
        fs.symlinkSync(sourcePath, targetPath, fs.statSync(sourcePath).isDirectory() ? 'dir' : 'file');
    }
    return packagePaths;
}

test('parseArgs supports env file, JSON and strict readiness flags', () => {
    const options = parseArgs([
        '--env-file', 'server/.env.production',
        '--json',
        '--fail-on-invalid',
        '--fail-on-not-ready'
    ]);

    assert.match(options.envFile, /server\/\.env\.production$/u);
    assert.equal(options.json, true);
    assert.equal(options.failOnInvalid, true);
    assert.equal(options.failOnNotReady, true);
});

test('strict readiness gate distinguishes invalid configuration from manual review', () => {
    assert.equal(
        getReadinessExitCode({ failOnNotReady: true }, { ok: true, ready: false }),
        READINESS_EXIT_CODES.NOT_READY
    );
    assert.equal(
        getReadinessExitCode({ failOnNotReady: true }, { ok: true, ready: true }),
        0
    );
    assert.equal(
        getReadinessExitCode({ failOnInvalid: true, failOnNotReady: true }, { ok: false, ready: false }),
        READINESS_EXIT_CODES.INVALID,
        'the historical invalid code takes precedence when both strict gates are requested'
    );
    assert.equal(
        getReadinessExitCode({ failOnNotReady: true }, { ok: false, ready: false }),
        READINESS_EXIT_CODES.NOT_READY,
        'not-ready mode alone still fails closed, while preserving the reason in the report'
    );
});

test('parseProviderList normalizes tokens and reports unknown providers', () => {
    assert.deepEqual(
        parseProviderList({ GUEST_SHOP_ENABLED_PROVIDERS: ' ZPAY, nowpayments; zpay, bitcoin ' }),
        {
            name: 'GUEST_SHOP_ENABLED_PROVIDERS',
            values: ['zpay', 'nowpayments', 'bitcoin'],
            invalid: ['bitcoin']
        }
    );
    assert.deepEqual(parseProviderList({}), { name: '', values: [], invalid: [] });
});

test('complete production configuration has no hard failures and never prints secrets', () => {
    const summary = runReadiness({
        env: completeProductionEnv(),
        repoRoot: REPO_ROOT,
        envFile: '',
        now: new Date('2026-09-14T00:00:00.000Z')
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.invalid_count, 0);
    assert.equal(summary.production_like, true);
    // Database/provider activation and the rate-limit RPC are intentionally
    // operator checks; an offline checker must not claim operational_ready.
    assert.equal(summary.ready, false);
    assert.ok(summary.manual_review_count > 0);

    const report = formatHumanReport(summary);
    const serialized = JSON.stringify(summary);
    for (const secret of Object.values(SECRET_VALUES)) {
        assert.equal(report.includes(secret), false);
        assert.equal(serialized.includes(secret), false);
    }
});

test('production fails closed when claim peppers or dedicated worker secret are missing', () => {
    const env = completeProductionEnv({
        GUEST_SHOP_CLAIM_PEPPER: '',
        GUEST_SHOP_CLAIM_DERIVATION_PEPPER: '',
        GUEST_SHOP_WORKER_SECRET: '',
        GUEST_SHOP_CRON_SECRET: 'legacy-' + 'x'.repeat(48)
    });
    const summary = runReadiness({ env, repoRoot: REPO_ROOT });

    assert.equal(summary.ok, false);
    assert.equal(hasFinding(summary, 'guest_shop_claim_pepper'), true);
    assert.equal(hasFinding(summary, 'guest_shop_claim_derivation_pepper'), true);
    assert.equal(hasFinding(summary, 'worker-secret-explicit'), true);
    assert.match(checksByKey(summary, 'worker-secret-explicit')[0].message, /专用|GUEST_SHOP_WORKER_SECRET/u);
});

test('production rejects memory rate limiting and an explicit disable flag', () => {
    const memorySummary = runReadiness({
        env: completeProductionEnv({ RATE_LIMIT_BACKEND: 'memory' }),
        repoRoot: REPO_ROOT
    });
    assert.equal(hasFinding(memorySummary, 'persistent-backend'), true);

    const disabledSummary = runReadiness({
        env: completeProductionEnv({ DISABLE_PERSISTENT_RATE_LIMITS: 'true' }),
        repoRoot: REPO_ROOT
    });
    assert.equal(hasFinding(disabledSummary, 'persistent-disabled'), true);
});

test('production rejects malformed or unsafe TTL, lease and webhook limits', () => {
    const summary = runReadiness({
        env: completeProductionEnv({
            GUEST_SHOP_ORDER_TTL_SECONDS: 'not-a-number',
            GUEST_SHOP_PAYMENT_CREATE_LEASE_MS: '1',
            GUEST_SHOP_WEBHOOK_GLOBAL_LIMIT: '5',
            GUEST_SHOP_WEBHOOK_IP_LIMIT: '20'
        }),
        repoRoot: REPO_ROOT
    });

    assert.equal(hasFinding(summary, 'order-ttl'), true);
    assert.equal(hasFinding(summary, 'payment-create-lease'), true);
    assert.equal(hasFinding(summary, 'webhook-global-limit'), true);
    assert.equal(hasFinding(summary, 'webhook-limit-order'), true);
});

test('production rejects malformed or unsafe worker runtime limits', () => {
    const malformed = runReadiness({
        env: completeProductionEnv({
            GUEST_SHOP_WORKER_BATCH_SIZE: 'NaN',
            GUEST_SHOP_WORKER_MAX_ATTEMPTS: '1.5',
            GUEST_SHOP_WORKER_REFUND_MAX_ATTEMPTS: '0',
            GUEST_SHOP_WORKER_BASE_BACKOFF_MS: '1e3',
            GUEST_SHOP_WORKER_MAX_BACKOFF_MS: 'Infinity',
            GUEST_SHOP_WORKER_LEASE_MS: '-1',
            GUEST_SHOP_WORKER_RETRY_JITTER_RATIO: '0.75'
        }),
        repoRoot: REPO_ROOT
    });

    for (const key of [
        'worker-batch-size',
        'worker-max-attempts',
        'worker-refund-max-attempts',
        'worker-base-backoff',
        'worker-max-backoff',
        'worker-lease',
        'worker-jitter-ratio'
    ]) {
        assert.equal(hasFinding(malformed, key), true, key);
    }

    const inconsistent = runReadiness({
        env: completeProductionEnv({
            GUEST_SHOP_WORKER_BASE_BACKOFF_MS: '5000',
            GUEST_SHOP_WORKER_MAX_BACKOFF_MS: '1000'
        }),
        repoRoot: REPO_ROOT
    });
    assert.equal(hasFinding(inconsistent, 'worker-backoff-order'), true);
});

test('worker runtime defaults are reported without blocking a complete production environment', () => {
    const summary = runReadiness({ env: completeProductionEnv(), repoRoot: REPO_ROOT });
    assert.equal(summary.ok, true);
    for (const key of [
        'worker-batch-size',
        'worker-max-attempts',
        'worker-refund-max-attempts',
        'worker-base-backoff',
        'worker-max-backoff',
        'worker-lease',
        'worker-jitter-ratio'
    ]) {
        const check = checksByKey(summary, key)[0];
        assert.equal(check?.status, 'default', key);
        assert.equal(check?.ok, true, key);
    }
});

test('provider activation and credentials fail closed without penalizing explicitly disabled providers', () => {
    const disabled = runReadiness({
        env: completeProductionEnv({
            GUEST_SHOP_ENABLED_PROVIDERS: 'zpay',
            NOWPAYMENTS_API_KEY: '',
            NOWPAYMENTS_IPN_SECRET: '',
            GUEST_SHOP_NOWPAYMENTS_PAY_CURRENCY: ''
        }),
        repoRoot: REPO_ROOT
    });
    assert.equal(hasFinding(disabled, 'nowpayments-secret-pair'), false);

    const unknown = runReadiness({
        env: completeProductionEnv({ GUEST_SHOP_ENABLED_PROVIDERS: 'zpay,bitcoin' }),
        repoRoot: REPO_ROOT
    });
    assert.equal(hasFinding(unknown, 'zpay-activation'), true);
    assert.equal(hasFinding(unknown, 'nowpayments-activation'), true);
    assert.ok(unknown.findings.some((finding) => finding.key === 'zpay-activation' || finding.key === 'nowpayments-activation'));

    const partial = runReadiness({
        env: completeProductionEnv({ NOWPAYMENTS_IPN_SECRET: '' }),
        repoRoot: REPO_ROOT
    });
    assert.equal(hasFinding(partial, 'nowpayments-secret-pair'), true);
});

test('NOWPayments only accepts the usdtbsc network for guest checkout', () => {
    const summary = runReadiness({
        env: completeProductionEnv({ GUEST_SHOP_NOWPAYMENTS_PAY_CURRENCY: 'usdttrc20' }),
        repoRoot: REPO_ROOT
    });
    assert.equal(hasFinding(summary, 'nowpayments-network'), true);
});

test('callback URLs require managed HTTPS guest webhook paths', () => {
    const valid = inspectCallbackUrl(
        completeProductionEnv(),
        'zpay',
        true
    );
    assert.equal(valid.ok, true);

    const invalid = inspectCallbackUrl({
        GUEST_SHOP_ZPAY_WEBHOOK_URL: 'http://evil.example/callback'
    }, 'zpay', true);
    assert.equal(invalid.ok, false);

    const wrongPath = inspectCallbackUrl({
        GUEST_SHOP_ZPAY_WEBHOOK_URL: 'https://www.fatherkey.com/api/shop/webhook'
    }, 'zpay', true);
    assert.equal(wrongPath.ok, false);
});

test('unknown provider activation is a manual review, not an implicit enable', () => {
    const summary = runReadiness({
        env: completeProductionEnv({
            GUEST_SHOP_ENABLED_PROVIDERS: '',
            ZPAY_PKEY: '',
            NOWPAYMENTS_API_KEY: '',
            NOWPAYMENTS_IPN_SECRET: '',
            GUEST_SHOP_NOWPAYMENTS_PAY_CURRENCY: ''
        }),
        repoRoot: REPO_ROOT
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.findings.some((finding) => /database-activation/u.test(finding.key)), false);
    assert.ok(summary.manual_review.some((item) => item.key === 'zpay-database-activation'));
    assert.ok(summary.manual_review.some((item) => item.key === 'nowpayments-database-activation'));
});

test('loadEnvFile is side-effect free and does not mutate the base environment', () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'guest-shop-readiness-'));
    const envFile = path.join(temporaryDirectory, '.env');
    const base = { FROM_PROCESS: 'process-value', KEEP: 'yes' };
    fs.writeFileSync(envFile, 'FROM_FILE=file-value\nNEW_VALUE=new-value\n', 'utf8');
    try {
        const merged = loadEnvFile(envFile, base);
        assert.equal(merged.FROM_FILE, 'file-value');
        assert.equal(merged.NEW_VALUE, 'new-value');
        assert.equal(base.FROM_FILE, undefined);
        assert.equal(base.FROM_PROCESS, 'process-value');
    } finally {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
});

test('repository and runbook contracts are present', () => {
    const repoChecks = inspectRepo(REPO_ROOT);
    const runbookChecks = inspectRunbook(REPO_ROOT);
    assert.equal(repoChecks.length, REQUIRED_REPO_FILES.length + REQUIRED_TEST_FILES.length + 7);
    assert.equal(repoChecks.some((check) => check.ok === false), false);
    assert.equal(runbookChecks.some((check) => check.ok === false), false);
});

test('guest-shop readiness npm script uses node -- so Node 25 forwards gate flags', () => {
    const { spawnSync } = require('node:child_process');
    const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    assert.equal(
        packageJson.scripts['readiness:guest-shop'],
        'node -- scripts/guest-shop-readiness.js'
    );

    const withoutSeparator = spawnSync(process.execPath, [
        '--fail-on-not-ready',
        'scripts/guest-shop-readiness.js'
    ], {
        cwd: REPO_ROOT,
        encoding: 'utf8'
    });
    assert.notEqual(withoutSeparator.status, 0);
    assert.match(
        `${withoutSeparator.stderr || ''}\n${withoutSeparator.stdout || ''}`,
        /bad option|unrecognized|unknown option/i
    );

    const withSeparator = spawnSync(process.execPath, [
        '--',
        'scripts/guest-shop-readiness.js',
        '--json',
        '--fail-on-not-ready'
    ], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: { ...process.env, APP_ENV: 'production' }
    });
    const combined = `${withSeparator.stderr || ''}\n${withSeparator.stdout || ''}`;
    assert.doesNotMatch(combined, /bad option|unrecognized|unknown option/i);
    assert.ok(
        [READINESS_EXIT_CODES.INVALID, READINESS_EXIT_CODES.NOT_READY].includes(withSeparator.status),
        `expected fail-closed exit 2 or 3, received ${withSeparator.status}`
    );

    const npmRun = spawnSync('npm', [
        'run',
        'readiness:guest-shop',
        '--',
        '--json',
        '--fail-on-not-ready'
    ], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: { ...process.env, APP_ENV: 'production' }
    });
    const npmCombined = `${npmRun.stderr || ''}\n${npmRun.stdout || ''}`;
    assert.doesNotMatch(npmCombined, /bad option|unrecognized|unknown option/i);
    assert.ok(
        [READINESS_EXIT_CODES.INVALID, READINESS_EXIT_CODES.NOT_READY].includes(npmRun.status),
        `npm run must forward gate flags; received ${npmRun.status}`
    );
});


// ---------------------------------------------------------------------------
// Order Access 2.0 readiness gate (docs/guest-shop-order-access-2.0.md §15.2)
// ---------------------------------------------------------------------------

const BUYER_MIGRATION = path.join(
    REPO_ROOT,
    'supabase',
    'migrations',
    '20260920_guest_shop_buyer_credentials.sql'
);
const BUYER_VERIFY_MIGRATION = path.join(
    REPO_ROOT,
    'supabase',
    'migrations',
    '20260920_verify_guest_shop_buyer_credentials.sql'
);

function buyerCheckKeys(checks) {
    return new Set((checks || []).map((check) => check.key));
}

test('buyer credential switches default off so A0 is behaviour neutral', () => {
    const checks = inspectBuyerCredentials({}, false, REPO_ROOT);
    assert.equal(checks.some((check) => check.ok === false), false, JSON.stringify(checks.filter((c) => !c.ok)));

    const switches = checks.filter((check) => ['credential-switch-boolean', 'orders-page-requires-credentials'].includes(check.key));
    assert.equal(switches.length, 2);
    for (const item of switches) {
        assert.equal(item.blocking, false);
        assert.notEqual(item.status, 'enabled');
    }

    // Both switches absent must never look like an enablement.
    const summary = runReadiness({ env: completeProductionEnv(), repoRoot: REPO_ROOT, envFile: '' });
    assert.equal(summary.ok, true);
    const enabled = (summary.checks || []).filter((check) => check.status === 'enabled' && check.area === 'buyer_credentials');
    assert.equal(enabled.length, 0);
});

test('A1b upsert migration static assertions pass on the real file and fail closed on a tampered one', () => {
    // Positive: the committed A1b RPC satisfies every requirement and trips no
    // prohibition, so the gate stays green while the feature is off (the
    // migration is behaviour-neutral until GUEST_SHOP_BUYER_CREDENTIAL_ENABLED).
    const real = inspectBuyerCredentials({}, false, REPO_ROOT);
    const a1b = real.filter((check) => check.key.startsWith('upsert-migration:') || check.key.startsWith('upsert-verify:'));
    assert.ok(a1b.length >= 28, `expected the full A1b assertion set, got ${a1b.length}`);
    assert.equal(a1b.some((check) => check.ok === false), false, JSON.stringify(a1b.filter((check) => !check.ok)));
    assert.equal(real.find((check) => check.key === 'upsert-migration-file').ok, true);

    // Negative: a rewrite that drops the contact advisory lock and overwrites an
    // existing group's password (ON CONFLICT ... DO UPDATE) is the N2
    // card-secret-cross-leak primitive. The static gate must catch it on disk,
    // before it can ever be applied to a database.
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guest-shop-a1b-'));
    try {
        const migDir = path.join(tempRoot, 'supabase', 'migrations');
        fs.mkdirSync(migDir, { recursive: true });
        // Keep A0 green so every failure below is isolated to A1b.
        for (const file of ['20260920_guest_shop_buyer_credentials.sql', '20260920_verify_guest_shop_buyer_credentials.sql']) {
            fs.copyFileSync(path.join(REPO_ROOT, 'supabase', 'migrations', file), path.join(migDir, file));
        }
        fs.copyFileSync(
            path.join(REPO_ROOT, 'supabase', 'migrations', '20260921_verify_guest_shop_buyer_group_upsert.sql'),
            path.join(migDir, '20260921_verify_guest_shop_buyer_group_upsert.sql')
        );
        const tampered = [
            'CREATE OR REPLACE FUNCTION public.fn_guest_shop_upsert_buyer_group(',
            '    p_site TEXT, p_contact_hash TEXT)',
            'RETURNS TABLE (buyer_id UUID, credential_group_no SMALLINT, allocation TEXT)',
            'LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$',
            'BEGIN',
            '    INSERT INTO public.guest_shop_buyers (site, contact_hash) VALUES (p_site, p_contact_hash)',
            '    ON CONFLICT ON CONSTRAINT guest_shop_buyers_site_contact_group_uniq DO UPDATE SET password_hash = EXCLUDED.password_hash;',
            '    RETURN;',
            'END; $$;',
            'REVOKE ALL ON FUNCTION public.fn_guest_shop_upsert_buyer_group(TEXT, TEXT, SMALLINT, TEXT, INTEGER, INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;',
            'GRANT EXECUTE ON FUNCTION public.fn_guest_shop_upsert_buyer_group(TEXT, TEXT, SMALLINT, TEXT, INTEGER, INTEGER, BOOLEAN) TO service_role;'
        ].join('\n');
        fs.writeFileSync(path.join(migDir, '20260921_guest_shop_buyer_group_upsert.sql'), tampered, 'utf8');

        const out = inspectBuyerCredentials({}, false, tempRoot);
        const byKey = new Map(out.map((check) => [check.key, check]));
        assert.equal(byKey.get('upsert-migration:upsert-advisory-lock').ok, false, 'a missing advisory lock must fail');
        assert.equal(byKey.get('upsert-migration:upsert-no-do-update').ok, false, 'an ON CONFLICT DO UPDATE must fail (N2)');
        assert.equal(byKey.get('upsert-migration:upsert-conflict-token').ok, false, 'a missing named 409 token must fail');
        assert.equal(byKey.get('upsert-migration:upsert-registered-match-record-only').ok, false, 'a missing record-only guard must fail');
        // A0 stayed green: the gate pinpoints A1b rather than failing wholesale.
        assert.equal(byKey.get('migration-file').ok, true);
        assert.equal(out.some((check) => check.key.startsWith('migration:') && check.ok === false), false);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('access-attempt retention readiness proves the migration, verify and worker contracts but keeps DB evidence manual', () => {
    const checks = inspectBuyerCredentials({}, false, REPO_ROOT);
    const retention = checks.filter((check) => check.key.startsWith('access-retention:'));
    assert.ok(retention.length >= 20, `expected retention static checks, got ${retention.length}`);
    assert.equal(retention.some((check) => check.ok === false), false, JSON.stringify(retention.filter((check) => !check.ok)));
    assert.equal(retention.some((check) => check.key === 'access-retention:verify-owner'), true);
    assert.equal(retention.some((check) => check.key === 'access-retention:verify-result-contract'), true);
    assert.equal(retention.some((check) => check.key === 'access-retention:service-role-guard'), true);
    assert.equal(retention.some((check) => check.key === 'access-retention:advisory-lock'), true);
    assert.equal(retention.some((check) => check.key === 'access-retention:verify-single-overload'), true);
    assert.equal(retention.some((check) => check.key === 'access-retention:verify-index-valid-ready'), true);
    assert.equal(retention.some((check) => check.key === 'access-retention:verify-index-shape'), true);

    const applied = checks.find((check) => check.key === 'access-retention-schema-applied');
    assert.equal(applied.status, 'manual_review');
    assert.equal(applied.requires_manual_review, true);
    assert.match(applied.message, /7 项检查全部 PASS/u);
    assert.match(applied.message, /每批最多 1000 行/u);
    assert.match(applied.message, /不执行 SQL/u);
});

test('access-attempt retention readiness rejects removal of each hardened SQL invariant', () => {
    const migrationPath = 'supabase/migrations/20260924_guest_shop_access_attempt_retention.sql';
    const verifyPath = 'supabase/migrations/20260924_verify_guest_shop_access_attempt_retention.sql';
    const workerPath = 'server/guest-shop-worker.js';
    const cases = [
        {
            name: 'migration service-role guard',
            file: migrationPath,
            key: 'access-retention:service-role-guard',
            mutate: (source) => source.replace(
                'PERFORM public.guest_shop_require_service_role();',
                'PERFORM public.guest_shop_require_service_role_removed();'
            )
        },
        {
            name: 'migration advisory lock',
            file: migrationPath,
            key: 'access-retention:advisory-lock',
            mutate: (source) => source.replace(
                'PERFORM pg_catalog.pg_advisory_xact_lock(',
                'PERFORM pg_catalog.pg_advisory_lock('
            )
        },
        {
            name: 'migration bounded victims',
            file: migrationPath,
            key: 'access-retention:victim-limit',
            mutate: (source) => source.replace('        LIMIT v_limit\n', '')
        },
        {
            name: 'migration complete search path',
            file: migrationPath,
            key: 'access-retention:secure-definer',
            mutate: (source) => source.replace(
                'SET search_path = pg_catalog, pg_temp',
                'SET search_path = pg_catalog, public, pg_temp'
            )
        },
        {
            name: 'verify unique overload family',
            file: verifyPath,
            key: 'access-retention:verify-single-overload',
            mutate: (source) => source.replace(
                'AND (SELECT COUNT(*) = 1 FROM fn_family)',
                'AND true'
            )
        },
        {
            name: 'verify index ready state',
            file: verifyPath,
            key: 'access-retention:verify-index-valid-ready',
            mutate: (source) => source.replace('AND bool_and(indisready)', 'AND true')
        },
        {
            name: 'verify exact index columns',
            file: verifyPath,
            key: 'access-retention:verify-index-shape',
            mutate: (source) => source.replace(
                "AND bool_and(key_columns = ARRAY['created_at', 'id']::NAME[])",
                'AND true'
            )
        },
        {
            name: 'verify exact index direction',
            file: verifyPath,
            key: 'access-retention:verify-index-shape',
            mutate: (source) => source.replace(
                'AND bool_and(is_ascending_nulls_last)',
                'AND true'
            )
        },
        {
            name: 'verify complete search path',
            file: verifyPath,
            key: 'access-retention:verify-search-path',
            mutate: (source) => source.replace(
                "proconfig @> ARRAY['search_path=pg_catalog, pg_temp']::TEXT[]",
                "proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp']::TEXT[]"
            )
        },
        {
            name: 'verify body service-role guard',
            file: verifyPath,
            key: 'access-retention:verify-body-service-role-guard',
            mutate: (source) => source.replace(
                "AND def LIKE '%PERFORM public.guest_shop_require_service_role()%'",
                'AND true'
            )
        },
        {
            name: 'verify body advisory lock',
            file: verifyPath,
            key: 'access-retention:verify-body-advisory-lock',
            mutate: (source) => source.replace(
                "AND def LIKE '%pg_catalog.pg_advisory_xact_lock%'",
                'AND true'
            )
        },
        {
            name: 'verify body bounded victims',
            file: verifyPath,
            key: 'access-retention:verify-body-victim-limit',
            mutate: (source) => source.replace(
                "AND def LIKE '%LIMIT v_limit%'",
                'AND true'
            )
        },
        {
            name: 'verify grants cover the overload family',
            file: verifyPath,
            key: 'access-retention:verify-family-grant-source',
            mutate: (source) => source.replace(
                'FROM fn_family\n    CROSS JOIN LATERAL aclexplode(',
                'FROM fn\n    CROSS JOIN LATERAL aclexplode('
            )
        },
        {
            name: 'verify effective inherited grants',
            file: verifyPath,
            key: 'access-retention:verify-effective-grants',
            mutate: (source) => source.replace(
                'NOT anon_can_execute\n                AND NOT authenticated_can_execute\n                AND service_role_can_execute',
                'service_role_can_execute'
            )
        },
        {
            name: 'worker credential-retention runtime interlock',
            file: workerPath,
            key: 'access-retention:worker-credential-interlock',
            mutate: (source) => source.replace(
                "? 'access_audit_retention_required'",
                "? 'access_audit_retention_disabled'"
            )
        }
    ];

    for (const scenario of cases) {
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guest-shop-retention-readiness-'));
        try {
            for (const relativePath of [migrationPath, verifyPath, workerPath]) {
                const targetPath = path.join(tempRoot, relativePath);
                fs.mkdirSync(path.dirname(targetPath), { recursive: true });
                fs.copyFileSync(path.join(REPO_ROOT, relativePath), targetPath);
            }
            const targetPath = path.join(tempRoot, scenario.file);
            const source = fs.readFileSync(targetPath, 'utf8');
            const mutated = scenario.mutate(source);
            assert.notEqual(mutated, source, `${scenario.name} fixture mutation must apply`);
            fs.writeFileSync(targetPath, mutated, 'utf8');

            const failed = inspectBuyerCredentials({}, false, tempRoot)
                .find((check) => check.key === scenario.key);
            assert.ok(failed, `${scenario.name} readiness check must exist`);
            assert.equal(failed.ok, false, `${scenario.name} must fail closed`);
            assert.equal(failed.blocking, true, `${scenario.name} must be blocking`);
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true });
        }
    }
});

test('access-attempt retention uses an independent fail-closed switch that can outlive credential rollback', () => {
    const defaults = inspectBuyerCredentials({}, true, REPO_ROOT);
    const defaultSwitch = defaults.find((check) => check.key === 'access-retention-switch-boolean');
    assert.equal(defaultSwitch.status, 'optional_not_configured');
    assert.match(defaultSwitch.message, /默认关闭/u);

    const missingForCredentials = inspectBuyerCredentials({
        GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: 'true',
        GUEST_SHOP_CONTACT_HASH_PEPPER: SECRET_VALUES.contact
    }, true, REPO_ROOT);
    const required = missingForCredentials.find((check) => check.key === 'access-retention-switch-required');
    assert.equal(required.ok, false);
    assert.equal(required.blocking, true);
    assert.match(required.message, /必须显式开启/u);

    const explicitlyDisabled = inspectBuyerCredentials({
        GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: 'true',
        GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_ENABLED: 'false',
        GUEST_SHOP_CONTACT_HASH_PEPPER: SECRET_VALUES.contact
    }, true, REPO_ROOT).find((check) => check.key === 'access-retention-switch-required');
    assert.equal(explicitlyDisabled.ok, false);
    assert.equal(explicitlyDisabled.blocking, true);

    const rollbackCleanup = inspectBuyerCredentials({
        GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: 'false',
        GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_ENABLED: 'true'
    }, true, REPO_ROOT);
    const rollbackSwitch = rollbackCleanup.find((check) => check.key === 'access-retention-switch-boolean');
    assert.equal(rollbackSwitch.ok, true);
    assert.equal(rollbackSwitch.status, 'enabled');
    assert.match(rollbackSwitch.message, /回滚后的历史数据/u);
    assert.equal(rollbackCleanup.some((check) => check.key === 'access-retention-switch-required'), false);

    const enabledWithCredentials = inspectBuyerCredentials({
        GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: 'true',
        GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_ENABLED: 'true',
        GUEST_SHOP_CONTACT_HASH_PEPPER: SECRET_VALUES.contact
    }, true, REPO_ROOT);
    assert.equal(enabledWithCredentials.some((check) => check.key === 'access-retention-switch-required'), false);
    assert.equal(enabledWithCredentials.find((check) => check.key === 'access-retention-switch-boolean').status, 'enabled');

    const malformed = inspectBuyerCredentials({
        GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_ENABLED: 'sometimes'
    }, true, REPO_ROOT).find((check) => check.key === 'access-retention-switch-boolean');
    assert.equal(malformed.ok, false);
    assert.equal(malformed.blocking, true);
});

test('enabling buyer credentials fails closed without a dedicated contact pepper', () => {
    const missing = inspectBuyerCredentials({ GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: 'true' }, true, REPO_ROOT);
    assert.equal(hasFinding({ checks: missing, findings: missing.filter((c) => !c.ok) }, 'contact-pepper-required'), true);

    // Falling back to the claim pepper is not acceptable once the email hash
    // becomes the credential-group key: a later pepper rotation would re-key
    // every stored contact_hash and orphan all guest orders.
    const reused = inspectBuyerCredentials({
        GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: 'true',
        GUEST_SHOP_CLAIM_PEPPER: SECRET_VALUES.claim,
        GUEST_SHOP_CONTACT_HASH_PEPPER: SECRET_VALUES.claim
    }, true, REPO_ROOT);
    assert.equal(reused.some((check) => check.key === 'contact-pepper-required' && check.ok === false), true);

    // AGENTS.md forbids reusing SUPABASE_SERVICE_ROLE_KEY as a guest-shop
    // pepper. The cross-check compares two environment values, so the test must
    // present both: a pepper that merely looks like a service role key is not
    // detectable, and must not be pretended to be.
    const serviceRole = inspectBuyerCredentials({
        GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: 'true',
        SUPABASE_SERVICE_ROLE_KEY: SECRET_VALUES.serviceRole,
        GUEST_SHOP_CONTACT_HASH_PEPPER: SECRET_VALUES.serviceRole
    }, true, REPO_ROOT);
    assert.equal(serviceRole.some((check) => check.key === 'contact-pepper-required' && check.ok === false), true);
    assert.equal(JSON.stringify(serviceRole).includes(SECRET_VALUES.serviceRole), false);

    const good = inspectBuyerCredentials({
        GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: 'true',
        GUEST_SHOP_CONTACT_HASH_PEPPER: SECRET_VALUES.contact
    }, true, REPO_ROOT);
    const pepperCheck = good.find((check) => check.key === 'contact-pepper-required');
    assert.equal(pepperCheck.ok, true);
    assert.equal(pepperCheck.message.includes(SECRET_VALUES.contact), false);
});

test('the A2 frontend deliverables satisfy the buyer credential frontend gate', () => {
    const checks = inspectBuyerCredentials({
        GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: 'true',
        GUEST_SHOP_CONTACT_HASH_PEPPER: SECRET_VALUES.contact
    }, true, REPO_ROOT);
    const keys = buyerCheckKeys(checks);
    assert.equal(keys.has('frontend:guest-orders.html'), true);
    assert.equal(keys.has('frontend:js/guest-orders-client.js'), true);
    // A2 landed guest-orders.html + js/guest-orders-client.js, so the static
    // deliverable gate is now green. It stays a code-presence gate only: the
    // runtime gate (database, sandbox, worker, manual evidence) still decides
    // readiness, asserted by the strict-gate test below.
    const frontend = checks.filter((check) => check.key.startsWith('frontend:'));
    assert.equal(frontend.length, 2);
    for (const check of frontend) {
        assert.equal(check.ok, true, `${check.key} must pass now that A2 is committed`);
        assert.equal(check.status, 'present');
    }
});

test('a missing A2 frontend file still fails the buyer credential gate closed', () => {
    // Regression guard for the positive case above: the gate must keep failing
    // closed if either deliverable disappears (revert, bad merge, partial
    // deploy), otherwise a half-removed lookup page could be enabled.
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guest-shop-a2-frontend-'));
    try {
        const checks = inspectBuyerCredentials({
            GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: 'true',
            GUEST_SHOP_CONTACT_HASH_PEPPER: SECRET_VALUES.contact
        }, true, tempRoot);
        const missing = checks.filter((check) => check.key.startsWith('frontend:'));
        assert.equal(missing.length, 2);
        assert.equal(missing.every((check) => check.ok === false), true);
        assert.equal(missing.every((check) => check.blocking === true), true);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('a complete local checkout validates its present frontend without a generated KVM4 release marker', async () => {
    assert.equal(fs.existsSync(path.join(REPO_ROOT, 'guest-orders.html')), true);
    assert.equal(fs.existsSync(path.join(REPO_ROOT, 'js', 'guest-orders-client.js')), true);
    assert.equal(fs.existsSync(path.join(REPO_ROOT, 'server', '.release-commit')), false,
        'the KVM4 marker is generated during deploy and must not be required in a source checkout');

    let fetchCalls = 0;
    const summary = await runReadinessWithHostedFrontend({
        env: completeProductionEnv({
            GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: 'true',
            GUEST_SHOP_GUEST_ORDERS_PAGE_ENABLED: 'true',
            GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_ENABLED: 'true'
        }),
        repoRoot: REPO_ROOT,
        envFile: '',
        fetchImpl: async () => {
            fetchCalls += 1;
            throw new Error('complete source checkout must not require hosted frontend evidence');
        }
    });

    assert.equal(fetchCalls, 0);
    assert.equal(summary.ok, true, JSON.stringify(summary.findings));
    assert.equal(summary.checks.find((check) => check.key === 'frontend:guest-orders.html').status, 'present');
    assert.equal(summary.checks.some((check) => check.key === 'frontend:release-commit'), false);
    assert.equal(summary.checks.some((check) => check.key === 'frontend:guest-orders-commit'), false);
});

test('the KVM4 compact image delegates only the Vercel HTML entry point to manual evidence', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guest-shop-kvm4-frontend-'));
    try {
        const clientPath = path.join(tempRoot, 'js', 'guest-orders-client.js');
        fs.mkdirSync(path.dirname(clientPath), { recursive: true });
        fs.copyFileSync(path.join(REPO_ROOT, 'js', 'guest-orders-client.js'), clientPath);

        const checks = inspectBuyerCredentialFrontend({
            APP_BASE_URL: 'https://www.fatherkey.com'
        }, true, tempRoot);
        const byKey = new Map(checks.map((check) => [check.key, check]));
        const page = byKey.get('frontend:guest-orders.html');
        const client = byKey.get('frontend:js/guest-orders-client.js');

        assert.equal(page.ok, true);
        assert.equal(page.status, 'manual_review');
        assert.equal(page.blocking, false);
        assert.equal(page.requires_manual_review, true);
        assert.equal(page.deployment_surface, 'vercel');
        assert.equal(page.hosted_url, 'https://www.fatherkey.com/guest-orders.html');
        assert.match(page.message, /同一 main 提交/u);
        assert.match(page.message, /guest-shop-frontend-contract\.test\.js/u);
        assert.equal(client.ok, true);
        assert.equal(client.status, 'present');

        // The topology is not invalid, but it is intentionally not launch-ready
        // until the Vercel page and CI contract evidence are reviewed.
        const frontendSummary = {
            ok: checks.every((check) => check.blocking !== true),
            ready: checks.every((check) => check.requires_manual_review !== true)
        };
        assert.equal(getReadinessExitCode({ failOnInvalid: true }, frontendSummary), 0);
        assert.equal(
            getReadinessExitCode({ failOnNotReady: true }, frontendSummary),
            READINESS_EXIT_CODES.NOT_READY
        );
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('missing frontend artifacts cannot claim Vercel hosting without a managed production origin', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guest-shop-untrusted-frontend-'));
    try {
        for (const [env, production] of [
            [{ APP_BASE_URL: 'https://evil.example' }, true],
            [{ APP_BASE_URL: 'https://verify-api.fatherkey.com' }, true],
            [{ APP_BASE_URL: 'http://www.fatherkey.com' }, true],
            [{ APP_BASE_URL: 'https://www.fatherkey.com' }, false]
        ]) {
            const checks = inspectBuyerCredentialFrontend(env, production, tempRoot);
            assert.equal(checks.every((check) => check.ok === false), true);
            assert.equal(checks.every((check) => check.blocking === true), true);
        }
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('hosted frontend verification aligns Vercel asset versions with the KVM4 release commit', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guest-shop-hosted-frontend-'));
    const releaseCommit = 'a'.repeat(40);
    const expectedVersion = releaseCommit.slice(0, 12);
    try {
        fs.mkdirSync(path.join(tempRoot, 'server'), { recursive: true });
        fs.writeFileSync(path.join(tempRoot, 'server', '.release-commit'), `${releaseCommit}\n`, 'utf8');
        const pageUrl = 'https://www.fatherkey.com/guest-orders.html';
        const clientUrl = `https://www.fatherkey.com/js/guest-orders-client.js?v=${expectedVersion}`;
        const page = [
            '<body class="guest-orders-page">',
            '<section id="guestOrdersFeatureGate"></section>',
            '<div id="guestOrdersProtectedContent"></div>',
            '<form id="guestOrdersQueryForm"></form>',
            '<div id="guestOrdersLegacyPanel"></div>',
            `<link rel="stylesheet" href="css/guest-orders.css?v=${expectedVersion}">`,
            `<script src="./js/guest-orders-client.js?v=${expectedVersion}"></script>`
        ].join('\n');
        const client = [
            "const ACCESS_AVAILABILITY_ENDPOINT = '/api/shop/guest/access/availability';",
            "const CREDENTIAL_HEADER = 'X-Guest-Order-Credential';",
            "fetch('/api', { credentials: 'same-origin' });"
        ].join('\n');
        const calls = [];
        const checks = await inspectHostedBuyerCredentialFrontend({
            env: { APP_BASE_URL: 'https://www.fatherkey.com' },
            repoRoot: tempRoot,
            fetchImpl: async (url) => {
                calls.push(String(url));
                if (String(url) === pageUrl) return createFetchResponse(pageUrl, { text: page });
                if (String(url) === clientUrl) return createFetchResponse(clientUrl, { text: client });
                return createFetchResponse(String(url), { status: 404 });
            }
        });

        assert.deepEqual(calls, [pageUrl, clientUrl]);
        assert.equal(checks.length, 3);
        assert.equal(checks.every((check) => check.ok === true), true);
        assert.equal(checks.find((check) => check.key === 'frontend:guest-orders-commit').expected_commit, expectedVersion);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('the async production gate replaces local page presence with hosted commit-aligned evidence', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guest-shop-readiness-overlay-'));
    const releaseCommit = 'c'.repeat(40);
    const expectedVersion = releaseCommit.slice(0, 12);
    try {
        const packagePaths = linkKvm4PackageFixture(tempRoot);
        assert.deepEqual(packagePaths, [
            'package.json',
            'package-lock.json',
            'adapters',
            'api',
            'server',
            'js',
            'scripts',
            'docs',
            'supabase'
        ]);
        assert.equal(fs.existsSync(path.join(tempRoot, 'deploy')), false);
        assert.equal(fs.existsSync(path.join(tempRoot, 'tests')), false);
        const serverRoot = path.join(tempRoot, 'server');
        fs.writeFileSync(path.join(serverRoot, '.release-commit'), `${releaseCommit}\n`, 'utf8');

        const pageUrl = 'https://www.fatherkey.com/guest-orders.html';
        const clientUrl = `https://www.fatherkey.com/js/guest-orders-client.js?v=${expectedVersion}`;
        const page = [
            '<body class="guest-orders-page">',
            '<div id="guestOrdersFeatureGate"></div>',
            '<div id="guestOrdersProtectedContent"></div>',
            '<form id="guestOrdersQueryForm"></form>',
            '<div id="guestOrdersLegacyPanel"></div>',
            `<link rel="stylesheet" href="css/guest-orders.css?v=${expectedVersion}">`,
            `<script src="./js/guest-orders-client.js?v=${expectedVersion}"></script>`
        ].join('\n');
        const client = [
            "const ACCESS_AVAILABILITY_ENDPOINT = '/api/shop/guest/access/availability';",
            "const CREDENTIAL_HEADER = 'X-Guest-Order-Credential';",
            "fetch('/api', { credentials: 'same-origin' });"
        ].join('\n');

        const summary = await runReadinessWithHostedFrontend({
            env: completeProductionEnv({
                GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: 'true',
                GUEST_SHOP_GUEST_ORDERS_PAGE_ENABLED: 'true',
                GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_ENABLED: 'true'
            }),
            repoRoot: tempRoot,
            envFile: '',
            fetchImpl: async (url) => {
                if (String(url) === pageUrl) return createFetchResponse(pageUrl, { text: page });
                if (String(url) === clientUrl) return createFetchResponse(clientUrl, { text: client });
                return createFetchResponse(String(url), { status: 404 });
            }
        });

        assert.equal(summary.ok, true, JSON.stringify(summary.findings));
        assert.equal(summary.ready, false, 'database/operator evidence must still keep strict readiness closed');
        assert.equal(summary.checks.find((check) => check.key === 'frontend:guest-orders.html').status, 'hosted_verified');
        assert.equal(summary.checks.find((check) => check.key === 'frontend:guest-orders-commit').status, 'aligned');
        assert.equal(summary.manual_review.some((check) => check.key === 'frontend:guest-orders.html'), false);
        const hostOnlyWorkerChecks = summary.checks.filter((check) =>
            check.key.startsWith('file:deploy/kvm4/guest-shop-worker/')
        );
        assert.equal(hostOnlyWorkerChecks.length, 3);
        assert.equal(hostOnlyWorkerChecks.every((check) => check.ok === true), true);
        assert.equal(hostOnlyWorkerChecks.every((check) => check.status === 'manual_review'), true);
        assert.equal(hostOnlyWorkerChecks.every((check) => check.requires_manual_review === true), true);
        assert.equal(hostOnlyWorkerChecks.every((check) => check.deployment_surface === 'kvm4-host'), true);
        assert.equal(hostOnlyWorkerChecks.every((check) => check.compact_image === true), true);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('missing host worker assets remain invalid without a valid compact-image marker', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guest-shop-source-assets-'));
    try {
        fs.mkdirSync(path.join(tempRoot, 'server'), { recursive: true });
        fs.writeFileSync(path.join(tempRoot, 'server', '.release-commit'), 'not-a-commit\n', 'utf8');
        const hostOnlyWorkerChecks = inspectRepo(tempRoot).filter((check) =>
            check.key.startsWith('file:deploy/kvm4/guest-shop-worker/')
        );
        assert.equal(hostOnlyWorkerChecks.length, 3);
        assert.equal(hostOnlyWorkerChecks.every((check) => check.ok === false), true);
        assert.equal(hostOnlyWorkerChecks.every((check) => check.status === 'invalid'), true);
        assert.equal(hostOnlyWorkerChecks.every((check) => check.blocking === true), true);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('hosted frontend verification fails closed on commit drift or missing release evidence', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guest-shop-hosted-drift-'));
    try {
        const missing = await inspectHostedBuyerCredentialFrontend({
            env: { APP_BASE_URL: 'https://www.fatherkey.com' },
            repoRoot: tempRoot,
            fetchImpl: async () => { throw new Error('must not fetch without release evidence'); }
        });
        assert.equal(missing[0].key, 'frontend:release-commit');
        assert.equal(missing[0].ok, false);

        fs.mkdirSync(path.join(tempRoot, 'server'), { recursive: true });
        fs.writeFileSync(path.join(tempRoot, 'server', '.release-commit'), `${'a'.repeat(40)}\n`, 'utf8');
        const stalePage = [
            '<body class="guest-orders-page">',
            '<div id="guestOrdersFeatureGate"></div>',
            '<div id="guestOrdersProtectedContent"></div>',
            '<form id="guestOrdersQueryForm"></form>',
            '<div id="guestOrdersLegacyPanel"></div>',
            '<script src="./js/guest-orders-client.js?v=bbbbbbbbbbbb"></script>'
        ].join('\n');
        const drift = await inspectHostedBuyerCredentialFrontend({
            env: { APP_BASE_URL: 'https://www.fatherkey.com' },
            repoRoot: tempRoot,
            fetchImpl: async (url) => createFetchResponse(String(url), { text: stalePage })
        });
        assert.equal(drift[0].key, 'frontend:guest-orders-commit');
        assert.equal(drift[0].ok, false);
        assert.equal(drift[0].blocking, true);
        assert.deepEqual(drift[0].observed_versions, ['bbbbbbbbbbbb']);
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('the KVM4 deploy embeds its exact release commit for hosted frontend alignment', () => {
    const deploy = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'deploy-kvm4-verify-server.sh'), 'utf8');
    assert.match(
        deploy,
        /printf '%s\\n' "\$RELEASE_COMMIT" > "\$release_app\/server\/\.release-commit"/u
    );
    assert.match(deploy, /tar -xzf "\$REMOTE_TMP\/app\.tar\.gz" -C "\$release_app"[\s\S]{0,600}server\/\.release-commit/u);
});

test('guest orders page cannot be enabled ahead of the credential chain', () => {
    const checks = inspectBuyerCredentials({ GUEST_SHOP_GUEST_ORDERS_PAGE_ENABLED: 'true' }, true, REPO_ROOT);
    const failure = checks.find((check) => check.key === 'orders-page-requires-credentials');
    assert.equal(failure.ok, false);
    assert.equal(failure.blocking, true);
});

test('malformed buyer credential switch values are hard failures, not silent off', () => {
    for (const value of ['maybe', '2', 'yess']) {
        const checks = inspectBuyerCredentials({ GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: value }, true, REPO_ROOT);
        const failure = checks.find((check) => check.key === 'credential-switch-boolean');
        assert.equal(failure.ok, false, `value ${value} must fail closed`);
    }
    const off = inspectBuyerCredentials({ GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: 'false' }, true, REPO_ROOT);
    assert.equal(off.some((check) => check.ok === false), false);
});

test('reserved captcha thresholds must remain below the lockout thresholds without claiming runtime protection', () => {
    const buyer = inspectBuyerCredentials({ GUEST_SHOP_BUYER_CAPTCHA_BUYER_THRESHOLD: '5' }, true, REPO_ROOT);
    assert.equal(buyer.some((check) => check.key === 'buyer-captcha-before-lockout' && check.ok === false), true);

    const ip = inspectBuyerCredentials({ GUEST_SHOP_BUYER_CAPTCHA_IP_THRESHOLD: '20' }, true, REPO_ROOT);
    assert.equal(ip.some((check) => check.key === 'buyer-captcha-ip-before-lockout' && check.ok === false), true);

    const consistent = inspectBuyerCredentials({
        GUEST_SHOP_BUYER_CAPTCHA_BUYER_THRESHOLD: '3',
        GUEST_SHOP_BUYER_CAPTCHA_IP_THRESHOLD: '8'
    }, true, REPO_ROOT);
    assert.equal(consistent.some((check) => check.key.startsWith('buyer-captcha-') && check.ok === false), false);
    for (const check of consistent.filter((item) => item.key.startsWith('buyer-captcha-'))) {
        assert.equal(check.status, 'configured_deferred');
        assert.match(check.message, /尚未读取或校验 CAPTCHA token/u);
        assert.doesNotMatch(check.message, /早于.*触发/u);
    }
});

test('buyer credential readiness reports CAPTCHA as deferred instead of active protection', () => {
    const disabled = inspectBuyerCredentials({}, true, REPO_ROOT)
        .find((check) => check.key === 'captcha-runtime-deferred');
    assert.equal(disabled.status, 'optional_not_configured');
    assert.equal(disabled.requires_manual_review, undefined);

    const enabled = inspectBuyerCredentials({
        GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: 'true',
        GUEST_SHOP_CONTACT_HASH_PEPPER: SECRET_VALUES.contact
    }, true, REPO_ROOT).find((check) => check.key === 'captcha-runtime-deferred');
    assert.equal(enabled.ok, true);
    assert.equal(enabled.status, 'manual_review');
    assert.equal(enabled.blocking, false);
    assert.equal(enabled.requires_manual_review, true);
    assert.equal(enabled.deferred, true);
    assert.equal(enabled.rollout_limit_orders, 5);
    assert.match(enabled.message, /IP 限流/u);
    assert.match(enabled.message, /阶梯锁定/u);
    assert.match(enabled.message, /不得作为放行证据/u);
});

test('buyer credential numeric settings reject malformed and out-of-range values', () => {
    const outOfRange = inspectBuyerCredentials({ GUEST_SHOP_BUYER_CREDENTIAL_GROUP_CAP: '99' }, true, REPO_ROOT);
    assert.equal(outOfRange.some((check) => check.key === 'buyerCredentialGroupCap' && check.ok === false), true);

    const malformed = inspectBuyerCredentials({ GUEST_SHOP_BUYER_PASSWORD_MIN_LENGTH: '8.5' }, true, REPO_ROOT);
    assert.equal(malformed.some((check) => check.key === 'buyerPasswordMinLength' && check.ok === false), true);

    const defaults = inspectBuyerCredentials({}, true, REPO_ROOT);
    const expectedDefaults = {
        buyerPasswordMinLength: 8,
        buyerCredentialGroupCap: 3,
        buyerLoginMaxFailures: 5,
        buyerLoginWindowSeconds: 600,
        buyerIpMaxFailures: 20,
        buyerCaptchaBuyerThreshold: 3,
        buyerCaptchaIpThreshold: 8,
        buyerAccessSessionTtlSeconds: 1800,
        buyerAccessAuditRetentionDays: 30
    };
    for (const [key, value] of Object.entries(expectedDefaults)) {
        const check = defaults.find((item) => item.key === key);
        assert.ok(check, `missing readiness check for ${key}`);
        assert.equal(check.effective_value, value);
    }
});

test('stripSqlComments keeps string literals and dollar-quoted bodies but drops prose', () => {
    const source = [
        '-- DROP FUNCTION ... CASCADE is mentioned in prose only',
        "CREATE TABLE t (a TEXT CHECK (a ~ '^scrypt$'));",
        '/* block DROP TABLE t */',
        "COMMENT ON COLUMN t.a IS 'literal -- not a comment';",
        'CREATE FUNCTION f() RETURNS void AS $$',
        'BEGIN',
        '    -- body prose survives: a dollar-quoted body is opaque',
        "    RAISE EXCEPTION 'guest_buyer_mismatch';",
        'END;',
        '$$;',
        'SELECT 1; -- trailing prose'
    ].join('\n');
    const stripped = stripSqlComments(source);
    assert.equal(/CASCADE/.test(stripped), false);
    assert.equal(/block DROP TABLE/.test(stripped), false);
    assert.equal(/trailing prose/.test(stripped), false);
    assert.ok(stripped.includes("'^scrypt$'"));
    // A comment marker inside a string literal is literal text, not a comment.
    assert.ok(stripped.includes("'literal -- not a comment'"));
    assert.ok(stripped.includes("'guest_buyer_mismatch'"));
    assert.ok(stripped.includes('$$'));
    // Opacity is the conservative direction for a gate: keeping body prose can
    // only make a prohibition check stricter, never let real SQL be stripped.
    assert.ok(stripped.includes('-- body prose survives'));
    assert.ok(stripped.includes('RAISE EXCEPTION'));
});

test('A0 migration statically satisfies the credential, RLS and no-enablement contract', () => {
    // Every structural assertion runs against the comment-stripped source, the
    // same way scripts/guest-shop-readiness.js does: prose must never satisfy a
    // gate (a "-- no CASCADE" note is not a DROP statement) and must never fail
    // one either (the header explains the drop is without CASCADE).
    const migration = stripSqlComments(fs.readFileSync(BUYER_MIGRATION, 'utf8'));
    const verify = stripSqlComments(fs.readFileSync(BUYER_VERIFY_MIGRATION, 'utf8'));

    // Credential storage must be scrypt with a pinned normalisation version and
    // a per-row salt; a deterministic HMAC (the Dujiao design) is not allowed.
    // The CHECK expression is asserted as a literal string because the SQL
    // regex escapes `$`, and a JS regex for it is an escaping trap.
    const hashFormatCheck = "password_hash ~ '^scrypt\\$[0-9]+\\$[0-9]+\\$[0-9]+\\$norm=v[0-9]+\\$[A-Za-z0-9+/=]+\\$[A-Za-z0-9+/=]+$'";
    assert.ok(
        migration.includes(hashFormatCheck),
        'guest_shop_buyers.password_hash must pin the scrypt$N$r$p$norm=vX$salt$hash format'
    );
    assert.match(migration, /norm=v1/u);
    assert.match(migration, /CONSTRAINT guest_shop_buyers_site_contact_group_uniq\s+UNIQUE \(site, contact_hash, credential_group_no\)/u);
    // Group capacity is bounded in the database as the outer bound of the
    // application-level K38 cap.
    assert.match(migration, /credential_group_no BETWEEN 1 AND 5/u);

    // The password-hash table must never be reachable from a browser role.
    assert.match(migration, /ALTER TABLE public\.guest_shop_buyers ENABLE ROW LEVEL SECURITY/u);
    assert.match(migration, /REVOKE ALL ON TABLE public\.guest_shop_buyers FROM PUBLIC, anon, authenticated/u);
    assert.match(migration, /GRANT ALL ON TABLE public\.guest_shop_buyers TO service_role/u);
    assert.doesNotMatch(migration, /GRANT SELECT ON TABLE public\.guest_shop_buyers TO authenticated/u);
    assert.doesNotMatch(migration, /CREATE POLICY[^;]*guest_shop_buyers/iu);

    // buyer_id is access control only and must not become a quota key.
    assert.match(migration, /ADD COLUMN IF NOT EXISTS buyer_id UUID\s+REFERENCES public\.guest_shop_buyers\(id\) ON DELETE SET NULL/u);
    assert.match(migration, /Promotion quota must count by buyer_contact_hash/u);

    // The RPC replacement must be an exact-signature drop, never a cascade, and
    // must re-grant EXECUTE on the NEW 13-parameter identity.
    assert.match(migration, /DROP FUNCTION IF EXISTS public\.fn_guest_shop_create_order\(\s*TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER\s*\)/u);
    assert.doesNotMatch(migration, /DROP FUNCTION[^;]*CASCADE/iu);
    assert.match(migration, /p_buyer_id UUID DEFAULT NULL/u);
    assert.match(migration, /RAISE EXCEPTION 'guest_buyer_contact_required'/u);
    assert.match(migration, /RAISE EXCEPTION 'guest_buyer_mismatch'/u);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.fn_guest_shop_create_order\(TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER\) TO service_role/u);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.fn_guest_shop_create_order\(TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER\) FROM PUBLIC, anon, authenticated/u);

    // AGENTS.md: a deploy must never enable guest products or schedule jobs.
    assert.doesNotMatch(migration, /allow_guest_purchase\s*=\s*true/iu);
    assert.doesNotMatch(migration, /UPDATE\s+public\.(shop_products|shop_product_skus|guest_shop_orders)/iu);
    assert.doesNotMatch(migration, /pg_cron|cron\.schedule/iu);

    // The paired verify script is read-only and covers the signature change.
    assert.doesNotMatch(verify, /^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE)\b/imu);
    assert.match(verify, /legacy_12_param_signature_absent/u);
    assert.match(verify, /rls_and_privileges_closed/u);
    assert.match(verify, /realtime_published/u);
    assert.match(verify, /browser_policies/u);
});

test('buyer credential readiness checks stay inside the strict gate and never print secrets', () => {
    const summary = runReadiness({
        env: completeProductionEnv({
            GUEST_SHOP_BUYER_CREDENTIAL_ENABLED: 'true',
            GUEST_SHOP_GUEST_ORDERS_PAGE_ENABLED: 'true',
            GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_ENABLED: 'true'
        }),
        repoRoot: REPO_ROOT,
        envFile: ''
    });

    // A2 shipped the frontend files, so the static configuration gate is now
    // valid. That must NOT be readable as "ready": the runtime evidence chain
    // (database migrations applied, provider sandbox, worker, manual archive)
    // is still absent, so readiness stays fail-closed with exit code 3 exactly
    // as AGENTS.md requires. A green `--fail-on-invalid` run is never permission
    // to open guest checkout.
    assert.equal(summary.ok, true, JSON.stringify((summary.checks || []).filter((check) => !check.ok).map((check) => check.key)));
    assert.equal(summary.ready, false);
    assert.equal(getReadinessExitCode({ failOnInvalid: true }, summary), 0);
    assert.equal(getReadinessExitCode({ failOnNotReady: true }, summary), READINESS_EXIT_CODES.NOT_READY);
    assert.equal(getReadinessExitCode({ failOnInvalid: true, failOnNotReady: true }, summary), READINESS_EXIT_CODES.NOT_READY);

    const areas = new Set((summary.checks || []).map((check) => check.area));
    assert.equal(areas.has('buyer_credentials'), true);

    const report = formatHumanReport(summary);
    const serialized = JSON.stringify(summary);
    for (const secret of Object.values(SECRET_VALUES)) {
        assert.equal(report.includes(secret), false);
        assert.equal(serialized.includes(secret), false);
    }
});

// ---------------------------------------------------------------------------
// 促销 verify 的静态闸门：真文件全绿，被篡改后必须逐项变红
// ---------------------------------------------------------------------------
//
// 2026-09-23 用户第一次在 Supabase 执行促销 verify，22 行里报了 2 个 FAIL，
// 而迁移本身是正确的：
//   第 12 行 evaluate_is_read_only=false —— pg_proc.prosrc 保留函数自己的注释，
//     fn_guest_shop_evaluate_discount 的原子性说明里有一句 "the atomic UPDATE
//     pair"，拿关键字正则扫原始 prosrc 就把注释当成了写操作；
//   第 16 行 guest_products_enabled observed=2 / expected=0 —— 把「运维开了几个
//     游客商品」钉成迁移必须满足的常量，等于宣告正确的迁移在有人开过游客商品时
//     必然 FAIL。FAIL 一旦成为常态，运维就会开始忽略所有 FAIL。
// 修法写进了 verify（fn_code 剥注释 + 第 23 行 operator_state_review），
// 这里保证 readiness 的闸门不是空转：每条新断言都要能被一个单点篡改打红。

test('promo verify static assertions pass on the real file and fail closed on tampered ones', () => {
    const realVerify = fs.readFileSync(path.join(REPO_ROOT, PROMO_VERIFY_MIGRATION), 'utf8');
    const real = inspectPromo({}, false, REPO_ROOT);
    const verifyChecks = real.filter((check) => check.key.startsWith('verify:'));
    assert.ok(verifyChecks.length >= 30, `expected the full promo verify assertion set, got ${verifyChecks.length}`);
    assert.deepEqual(
        verifyChecks.filter((check) => !check.ok).map((check) => check.key),
        [],
        'the committed promo verify must satisfy every readiness assertion'
    );
    for (const key of [
        'verify:verify-body-scans-strip-comments',
        'verify:verify-body-scans-strip-block-comments',
        'verify:verify-fn-code-superset',
        'verify:verify-evaluate-no-dynamic-sql',
        'verify:verify-evaluate-strip-keeps-guards',
        'verify:verify-promo-functions-never-write-products',
        'verify:verify-operator-state-review-row',
        'verify:verify-operator-state-review-branch',
        'verify:verify-operator-state-names-products',
        'verify:verify-no-pinned-operator-count',
        'verify:verify-no-raw-prosrc-regex',
        'verify:verify-no-raw-prosrc-position'
    ]) {
        assert.equal(real.find((check) => check.key === key)?.ok, true, `${key} must exist and pass on the real file`);
    }

    const variants = [
        {
            name: 'pinned-operator-count',
            key: 'verify:verify-no-pinned-operator-count',
            mutate: (source) => source.replace(
                "'guest_products_enabled', (",
                "'guest_products_enabled', 0,\n            'guest_products_enabled_live', ("
            )
        },
        {
            name: 'raw-prosrc-regex',
            key: 'verify:verify-no-raw-prosrc-regex',
            mutate: (source) => source.replace("WHERE code ~* '", "WHERE prosrc ~* '")
        },
        {
            name: 'raw-prosrc-position',
            key: 'verify:verify-no-raw-prosrc-position',
            mutate: (source) => source.replace("in f.code) > 0", "in f.prosrc) > 0")
        },
        {
            name: 'no-comment-strip',
            key: 'verify:verify-body-scans-strip-comments',
            mutate: (source) => source.replace("regexp_replace(f.prosrc, '--.*', ' ', 'gn')", 'f.prosrc')
        },
        {
            name: 'no-review-branch',
            key: 'verify:verify-operator-state-review-branch',
            mutate: (source) => source.replace("THEN 'PASS' ELSE 'REVIEW'", "THEN 'PASS' ELSE 'FAIL'")
        },
        {
            name: 'no-review-row',
            key: 'verify:verify-operator-state-review-row',
            // 必须全局替换：行名在 checks CTE 和最后的判分 CASE 里各出现一次，
            // 只换第一处的话闸门仍然命中，测试就会假绿。
            mutate: (source) => source.replace(/'operator_state_review'/gu, "'operator_state_summary'")
        },
        {
            name: 'no-mechanism-assertion',
            key: 'verify:verify-promo-functions-never-write-products',
            mutate: (source) => source.replace(/'promo_functions_never_write_products'/gu, "'catalogue_write_audit'")
        }
    ];

    for (const variant of variants) {
        const tampered = variant.mutate(realVerify);
        // 防止 needle 过期导致「篡改没生效、测试却绿着」这种最危险的空转。
        assert.notEqual(tampered, realVerify, `${variant.name}: the tamper must actually change the verify script`);
        const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guest-shop-promo-verify-'));
        try {
            const migDir = path.join(tempRoot, 'supabase', 'migrations');
            fs.mkdirSync(migDir, { recursive: true });
            fs.copyFileSync(path.join(REPO_ROOT, PROMO_MIGRATION), path.join(migDir, path.basename(PROMO_MIGRATION)));
            fs.writeFileSync(path.join(migDir, path.basename(PROMO_VERIFY_MIGRATION)), tampered, 'utf8');
            const out = inspectPromo({}, false, tempRoot);
            const byKey = new Map(out.map((check) => [check.key, check]));
            assert.equal(
                byKey.get(variant.key)?.ok,
                false,
                `${variant.name}: ${variant.key} must fail closed on the tampered verify script`
            );
        } finally {
            fs.rmSync(tempRoot, { recursive: true, force: true });
        }
    }
});
