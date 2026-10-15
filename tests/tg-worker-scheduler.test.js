'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');
const { applicationDigest, checkConfiguration, run } = require('../deploy/kvm4/tg-worker/zaoyoe-tg-worker.cjs');

const root = path.resolve(__dirname, '..');
const schedulerDir = path.join(root, 'deploy/kvm4/tg-worker');
const runnerSource = fs.readFileSync(path.join(schedulerDir, 'zaoyoe-tg-worker.cjs'), 'utf8');
const helper = fs.readFileSync(path.join(schedulerDir, 'zaoyoe-tg-worker'), 'utf8');
const service = fs.readFileSync(path.join(schedulerDir, 'zaoyoe-tg-worker.service'), 'utf8');
const timer = fs.readFileSync(path.join(schedulerDir, 'zaoyoe-tg-worker.timer'), 'utf8');
const installerPath = path.join(root, 'scripts/install-kvm4-tg-worker.sh');
const installer = fs.readFileSync(installerPath, 'utf8');
const digestValue = 'd'.repeat(64);
const mainCommit = 'a'.repeat(40);
const code = (expected) => (error) => error.code === expected && error.message === expected;
const options = (overrides = {}) => ({
    mode: '--once', expectedDigest: digestValue, envText: 'TG_FULFILLMENT_ENABLED=false\n',
    env: { TG_FULFILLMENT_ENABLED: 'false' }, digest: () => digestValue, ...overrides
});

test('scheduler check and disabled execution never spawn the purchasing CLI', () => {
    let spawns = 0;
    const spawn = () => { spawns += 1; throw new Error('must not buy'); };
    assert.deepEqual(run(options({ spawn })), { success: true, processed: false, disabled: true });
    assert.deepEqual(run(options({
        mode: '--check', envText: 'TG_FULFILLMENT_ENABLED=true\n',
        env: { TG_FULFILLMENT_ENABLED: 'true' }, spawn
    })), { success: true, checked: true, fulfillment_enabled: true });
    assert.equal(spawns, 0);
});

test('enabled scheduler invokes exactly one worker with container configuration and whitelists output', () => {
    const env = { TG_FULFILLMENT_ENABLED: 'true', GRAMIX_API_KEY: 'private-api-key' };
    const result = run(options({
        env, envText: 'TG_FULFILLMENT_ENABLED=true\nGRAMIX_API_KEY=private-api-key\n',
        spawn(executable, args, settings) {
            assert.equal(executable, process.execPath);
            assert.deepEqual(args, ['scripts/tg-fulfillment-worker.js', '--once']);
            assert.equal(settings.cwd, '/app');
            assert.equal(settings.env, env);
            assert.deepEqual(settings.stdio, ['ignore', 'pipe', 'pipe']);
            assert.equal(settings.timeout, 180000);
            return { status: 0, stdout: JSON.stringify({ success: true, processed: true, status: 'processing', order_id: 'private-order', secret: 'private-secret' }), stderr: 'private-provider-body' };
        }
    }));
    assert.deepEqual(result, { success: true, processed: true });
});

test('code mismatch, invalid invocation and container configuration drift fail before worker execution', () => {
    let spawns = 0;
    const spawn = () => { spawns += 1; };
    for (const [patch, errorCode] of [
        [{ mode: '--force' }, 'tg_scheduler_invalid_arguments'],
        [{ expectedDigest: 'private-argument' }, 'tg_scheduler_invalid_arguments'],
        [{ digest: () => 'e'.repeat(64) }, 'tg_scheduler_code_mismatch'],
        [{ env: { TG_FULFILLMENT_ENABLED: 'true' } }, 'tg_scheduler_configuration_drift'],
        [{ envText: 'TG_FULFILLMENT_ENABLED=false\nGRAMIX_API_KEY=new-private-secret\n', env: { TG_FULFILLMENT_ENABLED: 'false', GRAMIX_API_KEY: 'old-private-secret' } }, 'tg_scheduler_configuration_drift'],
        [{ envText: 'TG_FULFILLMENT_ENABLED=false\n', env: { TG_FULFILLMENT_ENABLED: 'false', GRAMIX_API_KEY: 'private-container-only-secret' } }, 'tg_scheduler_configuration_drift']
    ]) assert.throws(() => run(options({ ...patch, spawn })), code(errorCode));
    assert.equal(spawns, 0);
});

test('Compose interpolation, ambiguous quoting and duplicate TG keys are rejected without evaluating them', () => {
    for (const text of [
        'GRAMIX_API_KEY=${PRIVATE_SECRET}\n', 'GRAMIX_API_KEY="${PRIVATE_SECRET}"\n',
        'GRAMIX_API_KEY=literal$$dollar\n', 'GRAMIX_API_KEY="escaped\\nvalue"\n',
        'GRAMIX_API_KEY=unquoted#fragment\n', 'GRAMIX_API_KEY=`literal`\n',
        "GRAMIX_API_KEY='line\nbreak'\n", 'GRAMIX_API_KEY=one\nGRAMIX_API_KEY=two\n'
    ]) assert.throws(() => checkConfiguration(text, {}, dotenv.parse), code('tg_scheduler_configuration_ambiguous'));
    const text = "GRAMIX_API_KEY='literal-$-and-#' # private\nTG_FULFILLMENT_ENABLED=false # stopped\nUNRELATED_SETTING=${HOST_VALUE}\n";
    assert.deepEqual(checkConfiguration(text, { GRAMIX_API_KEY: 'literal-$-and-#', TG_FULFILLMENT_ENABLED: 'false' }, dotenv.parse), { fulfillmentEnabled: false });
    assert.throws(() => checkConfiguration('a'.repeat(1024 * 1024 + 1), {}, dotenv.parse), code('tg_scheduler_configuration_invalid'));
});

test('failed or malformed worker output cannot leak child stdout or stderr through the host runner', () => {
    for (const child of [
        { status: 1, stdout: 'private-payload', stderr: 'private-api-key' },
        { status: 0, stdout: '{"success":false,"secret":"private-payload"}', stderr: 'private-api-key' },
        { status: 0, stdout: '{"success":true}', error: new Error('private-timeout-cause') },
        { status: 0, stdout: 'private-non-json', stderr: 'private-api-key' }
    ]) assert.throws(() => run(options({ envText: 'TG_FULFILLMENT_ENABLED=true\n', env: { TG_FULFILLMENT_ENABLED: 'true' }, spawn: () => child })), code('tg_scheduler_tick_failed'));
    const cli = spawnSync(process.execPath, ['-e', runnerSource, '--', '--tg-scheduler', '--once', 'private-argument-do-not-print'], {
        cwd: root, env: {}, input: 'GRAMIX_API_KEY=private-stdin-do-not-print\n', encoding: 'utf8'
    });
    assert.equal(cli.status, 1);
    assert.equal(cli.stdout, '');
    assert.deepEqual(JSON.parse(cli.stderr), { success: false, code: 'tg_scheduler_invalid_arguments' });
});

test('container code digest matches the host manifest and rejects changed source or symlinks', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-scheduler-code-'));
    try {
        for (const [filename, contents] of [
            ['package.json', '{}'], ['package-lock.json', '{"lockfileVersion":3}'],
            ['scripts/tg-fulfillment-worker.js', 'worker'], ['server/tg/worker.js', 'source'],
            ['server/tg/nested/client.js', 'client'], ['server/tg/ignored.txt', 'not executable']
        ]) {
            fs.mkdirSync(path.dirname(path.join(fixture, filename)), { recursive: true });
            fs.writeFileSync(path.join(fixture, filename), contents);
        }
        const initial = applicationDigest(fixture);
        const manifest = spawnSync('bash', ['-c', "{ printf '%s\\0' package.json package-lock.json scripts/tg-fulfillment-worker.js; find server/tg -type f -name '*.js' -print0; } | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum"], { cwd: fixture, encoding: 'utf8' });
        assert.equal(manifest.status, 0, manifest.stderr);
        assert.equal(manifest.stdout.trim().split(/\s+/)[0], initial);
        fs.writeFileSync(path.join(fixture, 'server/tg/worker.js'), 'changed');
        assert.notEqual(applicationDigest(fixture), initial);
        fs.symlinkSync('worker.js', path.join(fixture, 'server/tg/linked.js'));
        assert.throws(() => applicationDigest(fixture), code('tg_scheduler_code_mismatch'));
    } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});

test('installer rejects root overrides and enabling requests before any remote operation', () => {
    for (const args of [['--root', '/tmp/private-root'], ['--start']]) {
        const result = spawnSync('bash', [installerPath, ...args], { cwd: root, env: { PATH: process.env.PATH }, encoding: 'utf8' });
        assert.notEqual(result.status, 0);
        assert.doesNotMatch(result.stderr, /private-root/);
        assert.match(result.stderr, /unsupported|separate explicit launch/);
    }
});

test('installer only reaches mocked SSH after clean main matches the latest origin/main', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-scheduler-install-'));
    try {
        fs.mkdirSync(path.join(fixture, 'scripts'), { recursive: true });
        fs.mkdirSync(path.join(fixture, 'bin'), { recursive: true });
        fs.cpSync(schedulerDir, path.join(fixture, 'deploy/kvm4/tg-worker'), { recursive: true });
        fs.copyFileSync(installerPath, path.join(fixture, 'scripts/install.sh'));
        fs.writeFileSync(path.join(fixture, 'key'), 'fixture', { mode: 0o600 });
        fs.writeFileSync(path.join(fixture, 'bin/git'), '#!/usr/bin/env bash\ncase "$1" in\nbranch) printf "%s\\n" "${TG_TEST_BRANCH:-main}";;\nrev-parse) printf "%s\\n" "$TG_TEST_HEAD";;\nstatus) printf "%s" "${TG_TEST_DIRTY:-}";;\nls-remote) [[ "${TG_TEST_ORIGIN_FAILURE:-}" != 1 ]] || exit 1; printf "%s\\trefs/heads/main\\n" "$TG_TEST_ORIGIN";;\n*) exit 1;;\nesac\n', { mode: 0o755 });
        for (const name of ['ssh', 'scp']) fs.writeFileSync(path.join(fixture, 'bin', name), '#!/usr/bin/env bash\nprintf "called\\n" >> "$TG_TEST_REMOTE_LOG"\n', { mode: 0o755 });
        const log = path.join(fixture, 'remote.log');
        const env = { PATH: `${path.join(fixture, 'bin')}:${process.env.PATH}`, KVM4_KEY: path.join(fixture, 'key'), TG_TEST_HEAD: mainCommit, TG_TEST_ORIGIN: mainCommit, TG_TEST_REMOTE_LOG: log };
        for (const patch of [
            { TG_TEST_BRANCH: 'codex/tg-independent-redemption' }, { TG_TEST_HEAD: 'b'.repeat(40) },
            { TG_TEST_DIRTY: ' M package.json' }, { TG_TEST_ORIGIN: 'b'.repeat(40) }, { TG_TEST_ORIGIN_FAILURE: '1' }
        ]) {
            const result = spawnSync('bash', [path.join(fixture, 'scripts/install.sh'), '--expected-commit', mainCommit], { env: { ...env, ...patch }, encoding: 'utf8' });
            assert.notEqual(result.status, 0);
            assert.equal(fs.existsSync(log), false, 'no SSH/SCP is permitted before branch/release checks pass');
        }
        const allowed = spawnSync('bash', [path.join(fixture, 'scripts/install.sh'), '--expected-commit', mainCommit], { env, encoding: 'utf8' });
        assert.equal(allowed.status, 0, allowed.stderr);
        assert.equal(fs.readFileSync(log, 'utf8'), 'called\ncalled\ncalled\n');
    } finally { fs.rmSync(fixture, { recursive: true, force: true }); }
});

test('host scheduler binds release, healthy container, private env and stopped installation without catch-up ticks', () => {
    assert.match(helper, /expected_commit.*EXPECTED_RELEASE_FILE/s);
    assert.match(helper, /\.current-release/);
    assert.match(helper, /com\.docker\.compose\.project\.working_dir/);
    assert.match(helper, /true:healthy/);
    assert.match(helper, /flock -n 9/);
    assert.match(helper, /stat -c '%a:%u'/);
    assert.match(helper, /< "\$CANONICAL_ROOT\/\.env"/);
    assert.doesNotMatch(helper, /(?:--env(?:-file)?\b|^\s*(?:source|eval)\s)/m);
    assert.doesNotMatch(service, /^EnvironmentFile=/m);
    assert.match(service, /^RestrictAddressFamilies=AF_UNIX$/m);
    assert.match(service, /^TimeoutStartSec=210$/m);
    assert.match(timer, /^Persistent=false$/m);
    assert.match(timer, /^OnCalendar=\*-\*-\* \*:\*:00\/15$/m);
    assert.match(installer, /git ls-remote --exit-code origin refs\/heads\/main/);
    assert.match(installer, /tg-readiness\.js --runtime --fail-on-invalid/);
    assert.match(installer, /systemctl is-enabled.*===?/);
    assert.match(installer, /== 'disabled'/);
    assert.match(installer, /== 'inactive'/);
    assert.doesNotMatch(installer, /^\s*systemctl (?:enable|start) /m);
    assert.doesNotMatch(installer, /systemctl disable --now[^\n]*\|\| true/);
    assert.match(installer, /systemctl daemon-reload\nstop_timer\n\/usr\/local\/sbin\/zaoyoe-tg-worker --check/);
});
