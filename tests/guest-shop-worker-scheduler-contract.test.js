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
const kvm4DeployDoc = fs.readFileSync(path.join(root, 'docs/kvm4-verify-server-deploy.md'), 'utf8');
const fulfillmentRunbook = fs.readFileSync(path.join(root, 'docs/guest-shop-payment-fulfillment-runbook.md'), 'utf8');

function assertOrdered(source, markers, label) {
    let cursor = -1;
    for (const marker of markers) {
        const next = source.indexOf(marker, cursor + 1);
        assert.ok(next > cursor, `${label}: missing or out-of-order marker ${marker}`);
        cursor = next;
    }
}

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

test('systemd timer runs every 10 seconds, is persistent, and targets the worker unit', () => {
    assert.match(timer, /Description=.*every 10 seconds/u);
    assert.match(timer, /OnCalendar=\*-\*-\* \*:\*:00\/10/u);
    assert.match(timer, /AccuracySec=1s/u);
    assert.match(timer, /RandomizedDelaySec=2s/u);
    assert.match(timer, /Persistent=true/u);
    assert.match(timer, /Unit=zaoyoe-guest-shop-worker\.service/u);
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

test('operator docs freeze the independent credential and retention switch matrix', () => {
    assert.match(fulfillmentRunbook, /GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_ENABLED[^\n]*独立/u);
    assert.match(fulfillmentRunbook, /^\| OFF \| OFF \/ 未设置 \| 允许（默认） \|/mu);
    assert.match(fulfillmentRunbook, /^\| ON \| OFF \/ 未设置 \| \*\*禁止\*\* \|/mu);
    assert.match(fulfillmentRunbook, /^\| ON \| ON \| 条件允许 \|[^\n]*7\/7 PASS/mu);
    assert.match(fulfillmentRunbook, /^\| OFF \| ON \| 允许且是凭证回滚后的必需状态 \|/mu);

    assert.match(kvm4DeployDoc, /retention switch defaults OFF/u);
    assert.match(kvm4DeployDoc, /^\| OFF \| OFF \| Default; no retention RPC \|/mu);
    assert.match(kvm4DeployDoc, /^\| ON \| OFF \| Invalid; readiness fails closed \|/mu);
    assert.match(kvm4DeployDoc, /^\| ON \| ON \| Allowed only after migration \+ 7\/7 verify \|/mu);
    assert.match(kvm4DeployDoc, /^\| OFF \| ON \| Required rollback-drain mode;/mu);
});

test('operator docs keep retention running through credential rollback and the retention horizon', () => {
    assert.match(fulfillmentRunbook, /凭证回滚[\s\S]{0,500}retention 必须保持 ON/u);
    assert.match(fulfillmentRunbook, /GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_ENABLED` 保持 `true`/u);
    assert.match(fulfillmentRunbook, /跨过配置的保留期[\s\S]{0,120}没有 retention 错误或积压/u);

    assert.match(kvm4DeployDoc, /credential rollback[\s\S]{0,180}leave retention ON/u);
    assert.match(kvm4DeployDoc, /turn buyer credentials and the orders page[\s\S]{0,100}keep retention and the guest-shop timer ON/u);
    assert.match(kvm4DeployDoc, /configured retention period has elapsed[\s\S]{0,160}no cleanup\s+error or backlog/u);
});

test('operator docs require watchdog-safe force recreation for every env transition', () => {
    const stopWatchdog = 'systemctl stop zaoyoe-kvm4-health-watchdog.timer zaoyoe-kvm4-health-watchdog.service';
    const recreate = 'docker compose up -d --no-deps --force-recreate --no-build verify-server';
    const startWatchdog = 'systemctl start zaoyoe-kvm4-health-watchdog.timer';

    for (const [label, source] of [
        ['fulfillment runbook', fulfillmentRunbook],
        ['KVM4 deploy guide', kvm4DeployDoc]
    ]) {
        assertOrdered(source, [stopWatchdog, recreate, startWatchdog], label);
        assert.match(source, /docker compose restart/u, label);
        assert.match(source, /(?:禁止|Never use)[^\n]*(?:docker restart|`docker restart`)/u, label);
    }
});

test('operator docs preserve retention degradation status and stable error codes', () => {
    for (const [label, source] of [
        ['fulfillment runbook', fulfillmentRunbook],
        ['KVM4 deploy guide', kvm4DeployDoc]
    ]) {
        assert.match(source, /10 (?:批|batches)[\s\S]{0,80}1000/u, label);
        assert.match(source, /HTTP 503/u, label);
        assert.match(source, /guest_access_audit_cleanup_failed/u, label);
        assert.match(source, /guest_access_audit_backlog_degraded/u, label);
        assert.match(source, /systemd[\s\S]{0,80}(?:failed|失败)/iu, label);
        assert.match(source, /journalctl -u zaoyoe-guest-shop-worker\.service/u, label);
    }
});

test('KVM4 guide distinguishes local source readiness from the compact hosted gate', () => {
    assert.match(kvm4DeployDoc, /complete[\s\S]{0,100}checkout contains `guest-orders\.html`/u);
    assert.match(kvm4DeployDoc, /does not require the generated[\s\S]{0,60}`server\/\.release-commit`/u);
    assert.match(kvm4DeployDoc, /buyer credentials and the guest-orders page are both enabled/u);
    assert.match(kvm4DeployDoc, /\/app\/server\/\.release-commit/u);
    assert.match(kvm4DeployDoc, /\.current-release/u);
    assert.match(kvm4DeployDoc, /docker compose exec -T verify-server[\s\S]{0,120}npm run readiness:guest-shop -- --fail-on-invalid/u);
    assert.match(kvm4DeployDoc, /Vercel `guest-orders\.html`[\s\S]{0,160}same-origin `js\/guest-orders-client\.js`/u);
    assert.match(kvm4DeployDoc, /frontend:guest-orders-commit` as `aligned`/u);
    assert.match(kvm4DeployDoc, /hosted_verified/u);
});
