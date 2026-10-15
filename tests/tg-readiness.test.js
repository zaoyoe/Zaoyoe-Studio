'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { REQUIRED_FILES, RUNTIME_FILES, parseArgs, loadEnvFile, runReadiness, getExitCode, formatReport } = require('../scripts/tg-readiness');

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-readiness-'));
for (const file of REQUIRED_FILES) {
    const full = path.join(repoRoot, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'fixture');
}
for (const file of [
    'deploy/kvm4/tg-worker/zaoyoe-tg-worker',
    'deploy/kvm4/tg-worker/zaoyoe-tg-worker.cjs',
    'deploy/kvm4/tg-worker/zaoyoe-tg-worker.service',
    'deploy/kvm4/tg-worker/zaoyoe-tg-worker.timer'
]) fs.copyFileSync(path.resolve(__dirname, '..', file), path.join(repoRoot, file));
test.after(() => fs.rmSync(repoRoot, { recursive: true, force: true }));
function configured(overrides = {}) {
    return {
        APP_ENV: 'production', TG_REDEMPTION_ENABLED: 'false', TG_FULFILLMENT_ENABLED: 'false', TG_PURCHASE_ENABLED: 'false',
        SUPABASE_URL: 'https://database.invalid', SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${'s'.repeat(32)}`,
        SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'p'.repeat(32)}`, ADMIN_STUDIO_ACCESS_SECRET: 'a'.repeat(40),
        TG_REDEMPTION_CODE_PEPPER: 'd'.repeat(48), TG_REDEMPTION_CODE_ENCRYPTION_KEY: 'e'.repeat(64),
        GRAMIX_API_KEY: 'private-gramix-credential', ...overrides
    };
}
const run = (env, other = {}) => runReadiness({ env, repoRoot, ...other });
const check = (report, key) => report.checks.find((item) => item.key === key);

test('offline readiness never reaches the network or changes switches, even if fulfillment is on', () => {
    const originalFetch = globalThis.fetch;
    let networkCalls = 0;
    globalThis.fetch = () => { networkCalls += 1; throw new Error('must not request'); };
    try {
        const env = configured({ TG_FULFILLMENT_ENABLED: 'true' });
        const before = { ...env };
        const report = run(env);
        assert.equal(report.ok, true);
        assert.equal(report.ready, false);
        assert.equal(report.mode, 'offline');
        assert.deepEqual(env, before);
        assert.equal(networkCalls, 0);
        assert.equal(check(report, 'operator:database').status, 'pending');
        assert.equal(check(report, 'operator:provider').status, 'pending');
        assert.equal(check(report, 'scheduler-policy').status, 'ok');
    } finally { globalThis.fetch = originalFetch; }
});

test('disabled unconfigured staging is preparable, while opening switches with missing configuration is invalid', () => {
    const disabled = run({});
    assert.equal(disabled.ok, true);
    assert.equal(disabled.ready, false);
    assert.equal(check(disabled, 'GRAMIX_API_KEY').status, 'pending');
    const active = run({ TG_REDEMPTION_ENABLED: 'true' });
    assert.equal(active.ok, false);
    assert.equal(check(active, 'GRAMIX_API_KEY').status, 'invalid');
});

test('credentials, including malformed values and URL credentials, never appear in any report', () => {
    const env = configured({
        SUPABASE_URL: 'https://username:super-private-password@database.invalid/?token=private-url-token',
        GRAMIX_API_KEY: 'key-with-secret\nextra-secret', TG_REDEMPTION_CODE_PEPPER: 'too-short-secret'
    });
    const report = run(env);
    const output = JSON.stringify(report) + formatReport(report);
    for (const secret of [env.SUPABASE_URL, 'super-private-password', 'private-url-token', 'key-with-secret', env.TG_REDEMPTION_CODE_PEPPER, env.SUPABASE_SERVICE_ROLE_KEY]) assert.ok(!output.includes(secret));
    assert.equal(report.ok, false);
});

test('unsafe/reused code secrets and service credentials in the public key slot fail validation', () => {
    for (const env of [
        configured({ TG_REDEMPTION_CODE_PEPPER: 'short' }),
        configured({ TG_REDEMPTION_CODE_ENCRYPTION_KEY: 'not-an-aes-key' }),
        configured({ CRON_SECRET: 'd'.repeat(48) }),
        configured({ SUPABASE_PUBLISHABLE_KEY: `sb_secret_${'s'.repeat(32)}` }),
        configured({ SUPABASE_SERVICE_ROLE_KEY: `sb_publishable_${'q'.repeat(32)}` }),
        configured({ ADMIN_STUDIO_ACCESS_SECRET: 'local-dev-admin-studio-access-secret' })
    ]) assert.equal(run(env).ok, false);
    const jwt = (role) => `e30.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
    assert.equal(run(configured({ SUPABASE_SERVICE_ROLE_KEY: jwt('service_role'), SUPABASE_PUBLISHABLE_KEY: jwt('anon') })).ok, true);
    assert.equal(run(configured({ SUPABASE_SERVICE_ROLE_KEY: jwt('anon') })).ok, false);
});

test('numeric fallbacks, unsupported flags, lease exhaustion and disabled persistent rate limiting are not accepted as valid', () => {
    for (const patch of [
        { TG_REDEMPTION_ENABLED: 'yes' }, { TG_FULFILLMENT_ENABLED: 'typo' }, { TG_PURCHASE_ENABLED: 'yes' },
        { GRAMIX_API_TIMEOUT_MS: '1' }, { TG_FULFILLMENT_POLL_SECONDS: '4' },
        { TG_FULFILLMENT_LEASE_SECONDS: '601' }, { TG_FULFILLMENT_LEASE_SECONDS: '30' },
        { GRAMIX_PAYMENT_CURRENCY: 'usd' }, { GRAMIX_API_BASE_URL: 'https://attacker.invalid' },
        { GRAMIX_API_BASE_URL: 'https://api.gramix.io/api/v1?key=private' },
        { RATE_LIMIT_BACKEND: 'memory' }, { RATE_LIMIT_STORE: 'local' }, { DISABLE_PERSISTENT_RATE_LIMITS: 'true' }
    ]) assert.equal(run(configured(patch)).ok, false);
    assert.equal(run(configured(), { nodeVersion: '18.20.0' }).ok, false);
});

test('cash purchases validate their independent payment configuration without making network requests', () => {
    const disabled = run(configured());
    assert.equal(disabled.purchase_enabled, false);
    assert.equal(check(disabled, 'TG_PURCHASE_ZPAY_KEY').status, 'pending');
    const active = { TG_PURCHASE_ENABLED: 'true', TG_PURCHASE_ZPAY_PID: '54321', TG_PURCHASE_ZPAY_KEY: 'payment-merchant-private-key', TG_PUBLIC_ORIGIN: 'https://tg.fatherkey.com' };
    assert.equal(run(configured(active)).ok, true);
    assert.equal(run(configured({ TG_PURCHASE_ENABLED: 'true' })).ok, false);
    for (const patch of [
        { TG_PURCHASE_ZPAY_KEY: 'short' }, { TG_PURCHASE_ZPAY_KEY: 'd'.repeat(48) },
        { TG_PUBLIC_ORIGIN: 'https://untrusted.invalid' }, { TG_PURCHASE_CHANNELS: 'nowpayments' },
        { TG_PUBLIC_ORIGIN: 'https://user:secret@tg.fatherkey.com' }, { TG_PURCHASE_ZPAY_PID: 'merchant-123' },
        { TG_PURCHASE_ZPAY_PID: '1'.repeat(33) },
        { TG_PURCHASE_ZPAY_KEY: 'payment-merchant-private-key\n' },
        { TG_PURCHASE_CHANNELS: 'alipay,alipay' }, { TG_PURCHASE_ZPAY_API_BASE_URL: 'http://unsafe.invalid' }
    ]) assert.equal(run(configured({ ...active, ...patch })).ok, false);
    assert.equal(run(configured({ ...active, TG_PURCHASE_ZPAY_PID: '1'.repeat(32) })).ok, true);
    const output = JSON.stringify(run(configured(active)));
    assert.ok(!output.includes(active.TG_PURCHASE_ZPAY_KEY));
    assert.equal(check(run(configured()), 'operator:payments').status, 'pending');
});

test('USDT-only purchases require their own credentials and an explicit rate, without requiring ZPay', () => {
    const usdt = {
        TG_PURCHASE_ENABLED: 'true', TG_PURCHASE_CHANNELS: 'usdt_bep20',
        TG_PURCHASE_NOWPAYMENTS_API_KEY: 'independent-nowpayments-api-credential',
        TG_PURCHASE_NOWPAYMENTS_IPN_SECRET: 'independent-nowpayments-callback-secret',
        TG_PURCHASE_NOWPAYMENTS_CNY_TO_USD_RATE: '0.14012345'
    };
    const report = run(configured(usdt));
    assert.equal(report.ok, true);
    assert.equal(report.ready, false);
    assert.equal(check(report, 'TG_PURCHASE_ZPAY_PID').status, 'ok');
    assert.equal(check(report, 'TG_PURCHASE_ZPAY_KEY').status, 'ok');
    assert.equal(run(configured({ ...usdt, TG_PURCHASE_CHANNELS: 'alipay,usdt_bep20' })).ok, false);
    for (const name of ['TG_PURCHASE_NOWPAYMENTS_API_KEY', 'TG_PURCHASE_NOWPAYMENTS_IPN_SECRET', 'TG_PURCHASE_NOWPAYMENTS_CNY_TO_USD_RATE']) {
        assert.equal(check(run(configured({ ...usdt, [name]: '' })), name).status, 'invalid');
        assert.equal(check(run(configured({ ...usdt, TG_PURCHASE_ENABLED: 'false', [name]: '' })), name).status, 'pending');
    }
    for (const rate of ['0', '-0.1', '10', '10.00000001', '0.123456789', '1e-1', '.14', '01.2', '0.14 ', 'NaN']) {
        assert.equal(check(run(configured({ ...usdt, TG_PURCHASE_NOWPAYMENTS_CNY_TO_USD_RATE: rate })), 'TG_PURCHASE_NOWPAYMENTS_CNY_TO_USD_RATE').status, 'invalid', rate);
    }
    for (const rate of ['1', '0.00000001', '9.99999999']) {
        assert.equal(run(configured({ ...usdt, TG_PURCHASE_NOWPAYMENTS_CNY_TO_USD_RATE: rate })).ok, true);
    }
    const output = JSON.stringify(report) + formatReport(report);
    for (const name of ['TG_PURCHASE_NOWPAYMENTS_API_KEY', 'TG_PURCHASE_NOWPAYMENTS_IPN_SECRET']) assert.ok(!output.includes(usdt[name]));
});

test('USDT secrets reject whitespace, malformed lengths and reuse of application or each other secrets', () => {
    const usdt = {
        TG_PURCHASE_CHANNELS: 'usdt_bep20', TG_PURCHASE_NOWPAYMENTS_API_KEY: 'independent-nowpayments-api-credential',
        TG_PURCHASE_NOWPAYMENTS_IPN_SECRET: 'independent-nowpayments-callback-secret', TG_PURCHASE_NOWPAYMENTS_CNY_TO_USD_RATE: '0.14'
    };
    for (const name of ['TG_PURCHASE_NOWPAYMENTS_API_KEY', 'TG_PURCHASE_NOWPAYMENTS_IPN_SECRET']) {
        for (const secret of ['short', 'n'.repeat(301), ` ${usdt[name]}`, `${usdt[name]}\n`, `${usdt[name]}\rline`]) {
            assert.equal(check(run(configured({ ...usdt, [name]: secret })), name).status, 'invalid');
        }
        for (const forbidden of [
            'GRAMIX_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL', 'CRON_SECRET', 'TG_WORKER_SECRET',
            'TG_REDEMPTION_CODE_PEPPER', 'TG_REDEMPTION_CODE_ENCRYPTION_KEY', 'TG_PURCHASE_ZPAY_KEY',
            'ADMIN_CONFIG_ENCRYPTION_KEY', 'ADMIN_STUDIO_ACCESS_SECRET',
            name === 'TG_PURCHASE_NOWPAYMENTS_API_KEY' ? 'TG_PURCHASE_NOWPAYMENTS_IPN_SECRET' : 'TG_PURCHASE_NOWPAYMENTS_API_KEY'
        ]) assert.equal(check(run(configured({ ...usdt, [forbidden]: usdt[name] })), name).status, 'invalid', forbidden);
    }
});

test('env loading matches runtime precedence, protects private files and does not execute shell content', () => {
    const file = path.join(repoRoot, 'private.env');
    fs.writeFileSync(file, 'TG_FULFILLMENT_ENABLED=true\nGRAMIX_API_KEY="literal-$(never-execute)"\n', { mode: 0o600 });
    const env = loadEnvFile(file, { TG_FULFILLMENT_ENABLED: 'false' });
    assert.equal(env.TG_FULFILLMENT_ENABLED, 'false');
    assert.equal(env.GRAMIX_API_KEY, 'literal-$(never-execute)');
    assert.equal(check(run(configured(), { envFile: file }), 'env-file-permissions').status, 'ok');
    fs.chmodSync(file, 0o644);
    assert.equal(check(run(configured(), { envFile: file }), 'env-file-permissions').status, 'invalid');
    const link = path.join(repoRoot, 'link.env');
    fs.symlinkSync(file, link);
    assert.throws(() => loadEnvFile(link, {}), /tg_readiness_env_file_unavailable/);
    assert.throws(() => loadEnvFile(`${file}.missing`, {}), /tg_readiness_env_file_unavailable/);
});

test('a successful automated configuration gate cannot count as launch approval', () => {
    const report = run(configured());
    assert.equal(getExitCode({ failOnInvalid: true }, report), 0);
    assert.equal(getExitCode({ failOnNotReady: true }, report), 3);
    assert.equal(getExitCode({ failOnNotReady: true }, run(configured({ GRAMIX_PAYMENT_CURRENCY: 'bad' }))), 2);
    assert.equal(getExitCode({}, run({})), 0);
    assert.equal(run(configured({ NODE_ENV: 'production', APP_ENV: '' })).ready, false);
    assert.equal(check(run(configured({ NODE_ENV: 'production', APP_ENV: '' })), 'production-marker').status, 'pending');
});

test('missing runtime/scheduler files fail preparation and CLI errors do not echo arbitrary arguments', () => {
    const file = REQUIRED_FILES[0];
    fs.unlinkSync(path.join(repoRoot, file));
    assert.equal(check(run(configured()), `file:${file}`).status, 'invalid');
    fs.writeFileSync(path.join(repoRoot, file), 'fixture');
    assert.throws(() => parseArgs(['--env-file']), /tg_readiness_invalid_arguments/);
    assert.throws(() => parseArgs(['--purchase']), /tg_readiness_invalid_arguments/);
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/tg-readiness.js'), '--private-api-secret-do-not-print'], { encoding: 'utf8', env: {} });
    assert.equal(result.status, 2);
    assert.ok(!`${result.stdout}${result.stderr}`.includes('private-api-secret-do-not-print'));
});

test('readiness rejects unsafe scheduler catch-up and host-side secret injection policies', () => {
    const timerPath = path.join(repoRoot, 'deploy/kvm4/tg-worker/zaoyoe-tg-worker.timer');
    const runnerPath = path.join(repoRoot, 'deploy/kvm4/tg-worker/zaoyoe-tg-worker');
    const timer = fs.readFileSync(timerPath, 'utf8');
    const runner = fs.readFileSync(runnerPath, 'utf8');
    try {
        fs.writeFileSync(timerPath, timer.replace('Persistent=false', 'Persistent=true'));
        assert.equal(check(run(configured()), 'scheduler-policy').status, 'invalid');
        fs.writeFileSync(timerPath, timer);
        fs.writeFileSync(runnerPath, `${runner}\nSUPABASE_SERVICE_ROLE_KEY=secret\n`);
        assert.equal(check(run(configured()), 'scheduler-policy').status, 'invalid');
    } finally {
        fs.writeFileSync(timerPath, timer);
        fs.writeFileSync(runnerPath, runner);
    }
});

test('runtime profile supports compact API images while missing actual worker code still blocks preparation', () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-runtime-readiness-'));
    try {
        for (const file of RUNTIME_FILES) {
            const full = path.join(runtimeRoot, file);
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, 'fixture');
        }
        const options = { env: configured(), repoRoot: runtimeRoot, runtime: true };
        const report = runReadiness(options);
        assert.equal(report.ok, true);
        assert.equal(report.ready, false);
        assert.equal(report.profile, 'runtime');
        assert.equal(check(report, 'scheduler-policy').status, 'pending');
        assert.equal(check(report, 'file:tg.html'), undefined);
        assert.equal(runReadiness({ ...options, runtime: false }).ok, false);
        fs.unlinkSync(path.join(runtimeRoot, 'scripts/tg-fulfillment-worker.js'));
        assert.equal(runReadiness(options).ok, false);
        assert.equal(parseArgs(['--runtime', '--fail-on-invalid']).runtime, true);
    } finally { fs.rmSync(runtimeRoot, { recursive: true, force: true }); }
});
