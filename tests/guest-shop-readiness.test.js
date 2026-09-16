'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    READINESS_EXIT_CODES,
    REQUIRED_REPO_FILES,
    REQUIRED_TEST_FILES,
    formatHumanReport,
    getReadinessExitCode,
    inspectCallbackUrl,
    inspectRepo,
    inspectRunbook,
    loadEnvFile,
    parseArgs,
    parseProviderList,
    runReadiness
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

