'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const schedulerDir = path.join(root, 'deploy/kvm4/guest-shop-worker');
const helper = fs.readFileSync(path.join(schedulerDir, 'zaoyoe-guest-shop-worker'), 'utf8');
const helperExecutable = helper.replace(/^\s*#.*$/gmu, '');
const service = fs.readFileSync(path.join(schedulerDir, 'zaoyoe-guest-shop-worker.service'), 'utf8');
const timer = fs.readFileSync(path.join(schedulerDir, 'zaoyoe-guest-shop-worker.timer'), 'utf8');
const installerPath = path.join(root, 'scripts/install-kvm4-guest-shop-worker.sh');
const installer = fs.readFileSync(installerPath, 'utf8');
const canonicalRoot = '/opt/zaoyoe-verify-server';

test('guest worker scheduler calls only the loopback bodyless endpoint', () => {
    assert.match(helper, /http:\/\/127\.0\.0\.1:3001\/api\/shop\/guest\/worker/u);
    assert.match(helper, /--request POST/u);
    assert.match(helper, /Content-Length: 0/u);
    assert.match(helper, /GUEST_SHOP_WORKER_SECRET/u);
    assert.doesNotMatch(helper, /CRON_SECRET/u);
    assert.doesNotMatch(helperExecutable, /order[_-]?id|inventory|payload/iu);
    assert.doesNotMatch(helperExecutable, /https?:\/\/(?!127\.0\.0\.1)/u);
});

test('systemd unit loads the dedicated secret without embedding or writing it', () => {
    assert.match(service, /Type=oneshot/u);
    assert.match(service, /EnvironmentFile=\/opt\/zaoyoe-verify-server\/\.env/u);
    assert.match(service, /ExecStart=\/usr\/local\/sbin\/zaoyoe-guest-shop-worker/u);
    assert.match(service, /NoNewPrivileges=true/u);
    assert.match(service, /ProtectSystem=strict/u);
    assert.doesNotMatch(service, /CRON_SECRET/u);
    assert.doesNotMatch(service, /ExecStart=.*order[_-]?id/iu);
});

test('installer and static unit share one canonical verify root and reject overrides', () => {
    const conditionRoot = service.match(/^ConditionPathExists=(.+)$/mu)?.[1];
    const environmentRoot = service.match(/^EnvironmentFile=(.+)$/mu)?.[1];

    assert.equal(conditionRoot, `${canonicalRoot}/.env`);
    assert.equal(environmentRoot, `${canonicalRoot}/.env`);
    assert.match(installer, /CANONICAL_KVM4_ROOT="\/opt\/zaoyoe-verify-server"/u);
    assert.match(installer, /KVM4_ROOT="\$CANONICAL_KVM4_ROOT"/u);
    assert.match(installer, /--root\)\s*\n\s*validate_root/u);
    assert.match(installer, /grep -Fqx "ConditionPathExists=\$KVM4_ROOT\/\.env"/u);
    assert.match(installer, /grep -Fqx "EnvironmentFile=\$KVM4_ROOT\/\.env"/u);
    assert.doesNotMatch(installer, /KVM4_ROOT="\$\{KVM4_ROOT:-\/opt\/zaoyoe-verify-server\}"/u);
    assert.doesNotMatch(installer, /KVM4_ROOT="\$\{2:-\}"/u);
});

test('installer fails closed before SSH when a custom KVM4_ROOT is supplied', () => {
    const result = spawnSync('bash', [installerPath], {
        cwd: root,
        env: {
            ...process.env,
            KVM4_ROOT: '/tmp/guest-shop-worker-test-root',
            KVM4_KEY: '/tmp/guest-shop-worker-test-key-does-not-exist'
        },
        encoding: 'utf8'
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /custom KVM4_ROOT is unsupported/u);
    assert.doesNotMatch(result.stderr, /GUEST_SHOP_WORKER_SECRET|SUPABASE_SERVICE_ROLE_KEY/u);
});

test('installer rejects a non-canonical --root before any remote operation', () => {
    const result = spawnSync('bash', [installerPath, '--root', '/tmp/guest-shop-worker-test-root'], {
        cwd: root,
        env: { ...process.env },
        encoding: 'utf8'
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /custom KVM4_ROOT is unsupported/u);
    assert.doesNotMatch(result.stderr, /GUEST_SHOP_WORKER_SECRET|SUPABASE_SERVICE_ROLE_KEY/u);
});

test('installer accepts the canonical --root only as an explicit no-op', () => {
    const result = spawnSync('bash', [installerPath, '--root', canonicalRoot, '--help'], {
        cwd: root,
        env: { ...process.env },
        encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /remote app root is fixed/u);
});

test('systemd timer is minute-based, persistent, and targets the worker unit', () => {
    assert.match(timer, /OnCalendar=\*-\*-\* \*:\*:00/u);
    assert.match(timer, /Persistent=true/u);
    assert.match(timer, /Unit=zaoyoe-guest-shop-worker\.service/u);
    assert.match(timer, /RandomizedDelaySec=/u);
});

test('installer only installs scheduler artifacts and defaults to stopped timer', () => {
    assert.match(installer, /install-kvm4-guest-shop-worker/u);
    assert.match(installer, /--start/u);
    assert.match(installer, /systemctl enable ["']\$TIMER_NAME["']/u);
    assert.ok(installer.includes('if [[ "${START_NOW:-0}" == "1" ]]'));
    assert.doesNotMatch(installer, /supabase|psql|guest_shop_orders|INSERT|UPDATE|DELETE/iu);
    assert.doesNotMatch(installer, /GUEST_SHOP_WORKER_SECRET\s*=/u);
});

test('deploy docs require env_file recreate after guest-shop secret changes', () => {
    const files = [
        'AGENTS.md',
        'docs/kvm4-verify-server-deploy.md',
        'docs/guest-shop-payment-fulfillment-runbook.md',
        'docs/vercel-release-checklist.md'
    ];
    const recreate = /docker compose up -d --no-deps --force-recreate --no-build verify-server/;
    const envFile = /env_file/;
    const noRestart = /docker restart/;
    const noCronReuse = /CRON_SECRET/;

    for (const relativePath of files) {
        const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
        assert.match(source, recreate, relativePath);
        assert.match(source, envFile, relativePath);
        assert.match(source, noRestart, relativePath);
        assert.match(source, noCronReuse, relativePath);
    }

    const kvm4 = fs.readFileSync(path.join(root, 'docs/kvm4-verify-server-deploy.md'), 'utf8');
    assert.match(kvm4, /resolvePaymentProviderSecrets/);
    assert.match(kvm4, /deploy\/kvm4\/guest-shop-worker/);
    assert.doesNotMatch(kvm4, /GUEST_SHOP_WORKER_SECRET\s*=\s*['\"][^'\"]+['\"]/);

    const runbook = fs.readFileSync(path.join(root, 'docs/guest-shop-payment-fulfillment-runbook.md'), 'utf8');
    assert.match(runbook, /resolvePaymentProviderSecrets/);
    assert.match(runbook, /docker restart[\s\S]{0,80}不会重读/);
});
