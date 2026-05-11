const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_MAX_AGE_DAYS = 45;

const REQUIRED_REPO_FILES = Object.freeze([
    Object.freeze({
        key: 'migration:financial-recovery-audit-views',
        relativePath: 'supabase/migrations/20260510_add_financial_recovery_audit_views.sql',
        label: '财务恢复审计视图 migration'
    }),
    Object.freeze({
        key: 'migration:service-role-recovery-audit-views',
        relativePath: 'supabase/migrations/20260511_allow_service_role_financial_recovery_audit_views.sql',
        label: 'service_role 恢复审计视图读取 migration'
    }),
    Object.freeze({
        key: 'script:payment-readiness-gate',
        relativePath: 'scripts/payment-readiness-gate.js',
        label: '支付/积分/商城关键 RPC readiness gate'
    }),
    Object.freeze({
        key: 'docs:financial-recovery-drill-runbook',
        relativePath: 'docs/financial-recovery-drill-runbook.md',
        label: '月度恢复演练 runbook'
    })
]);

const REQUIRED_PACKAGE_SCRIPTS = Object.freeze([
    Object.freeze({
        key: 'package-script:readiness-payment-recovery',
        name: 'readiness:payment-recovery',
        expected: 'node scripts/payment-readiness-gate.js --fail-on-missing',
        label: '支付/积分/商城恢复链路 readiness 命令'
    }),
    Object.freeze({
        key: 'package-script:readiness-financial-recovery-drill',
        name: 'readiness:financial-recovery-drill',
        expected: 'node scripts/financial-recovery-drill-readiness.js',
        label: '财务恢复演练 readiness 命令'
    })
]);

const PITR_MARKERS = Object.freeze([
    'SUPABASE_PITR_ENABLED',
    'ZAOYOE_SUPABASE_PITR_ENABLED',
    'PITR_ENABLED'
]);

const BACKUP_MARKERS = Object.freeze([
    'FINANCIAL_RECOVERY_BACKUP_CONFIRMED',
    'SUPABASE_BACKUPS_CONFIRMED',
    'SUPABASE_DAILY_BACKUPS_CONFIRMED'
]);

const BACKUP_DATE_MARKERS = Object.freeze([
    'FINANCIAL_RECOVERY_BACKUP_CONFIRMED_AT',
    'SUPABASE_BACKUP_CONFIRMED_AT'
]);

const DRILL_DATE_MARKERS = Object.freeze([
    'FINANCIAL_RECOVERY_DRILL_LAST_AT',
    'FINANCIAL_RECOVERY_LAST_DRILL_AT'
]);

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'y', 'on', 'enabled']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'n', 'off', 'disabled']);

function parseArgs(argv = []) {
    const options = {
        envFile: '',
        json: false,
        failOnMissingBackup: false,
        failOnStale: false,
        maxAgeDays: DEFAULT_MAX_AGE_DAYS
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '').trim();
        if (!value) continue;

        if (value === '--env-file') {
            options.envFile = path.resolve(process.cwd(), String(argv[index + 1] || '').trim());
            index += 1;
            continue;
        }

        if (value === '--max-age-days') {
            const parsed = Number.parseInt(String(argv[index + 1] || '').trim(), 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                options.maxAgeDays = parsed;
            }
            index += 1;
            continue;
        }

        if (value === '--fail-on-missing-backup') {
            options.failOnMissingBackup = true;
            continue;
        }

        if (value === '--fail-on-stale') {
            options.failOnStale = true;
            continue;
        }

        if (value === '--json') {
            options.json = true;
        }
    }

    return options;
}

function loadEnvFile(envFile) {
    if (!envFile) return;
    dotenv.config({
        path: envFile,
        override: true
    });
}

function normalizeText(value, maxLength = 500) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function readEnv(env, name) {
    return normalizeText(env?.[name] || '');
}

function readFirstEnv(env, names = []) {
    for (const name of names) {
        const value = readEnv(env, name);
        if (value) {
            return { name, value };
        }
    }

    return { name: '', value: '' };
}

function parseBooleanMarker(value) {
    const normalized = normalizeText(value, 64).toLowerCase();
    if (!normalized) return null;
    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;
    return null;
}

function readBooleanMarker(env, names = []) {
    const marker = readFirstEnv(env, names);
    return {
        ...marker,
        parsed: parseBooleanMarker(marker.value)
    };
}

function parseDateMarker(value, now = new Date()) {
    const raw = normalizeText(value, 80);
    if (!raw) {
        return {
            raw: '',
            valid: false,
            date: null,
            iso: '',
            age_days: null
        };
    }

    const date = new Date(raw);
    const valid = Number.isFinite(date.getTime());
    const ageDays = valid
        ? Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86400000))
        : null;

    return {
        raw,
        valid,
        date: valid ? date : null,
        iso: valid ? date.toISOString() : '',
        age_days: ageDays
    };
}

function buildCheck(area, key, ok, status, message, detail = {}) {
    return {
        area,
        key,
        ok: ok === true,
        status,
        message,
        ...detail
    };
}

function inspectRepoFiles(repoRoot = REPO_ROOT) {
    const checks = REQUIRED_REPO_FILES.map((definition) => {
        const absolutePath = path.join(repoRoot, definition.relativePath);
        const exists = fs.existsSync(absolutePath);
        return buildCheck(
            'repo',
            definition.key,
            exists,
            exists ? 'present' : 'missing',
            exists
                ? `${definition.label} 已存在`
                : `${definition.label} 缺失：${definition.relativePath}`,
            {
                relative_path: definition.relativePath
            }
        );
    });

    const packagePath = path.join(repoRoot, 'package.json');
    let packageJson = null;
    try {
        packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    } catch (_) {
        packageJson = null;
    }

    for (const definition of REQUIRED_PACKAGE_SCRIPTS) {
        const actual = normalizeText(packageJson?.scripts?.[definition.name] || '', 200);
        const ok = actual === definition.expected;
        checks.push(buildCheck(
            'repo',
            definition.key,
            ok,
            ok ? 'present' : 'missing_or_changed',
            ok
                ? `${definition.label} 已注册`
                : `${definition.label} 缺失或被改动：${definition.name}`,
            {
                script_name: definition.name,
                expected: definition.expected,
                actual
            }
        ));
    }

    return checks;
}

function inspectPitr(env = process.env) {
    const marker = readBooleanMarker(env, PITR_MARKERS);

    if (!marker.name) {
        return buildCheck(
            'backup',
            'pitr',
            true,
            'optional_not_configured',
            'PITR 未配置为 readiness 标记；运行时不依赖 PITR，Pro/PITR 到期不会阻断网站',
            {
                env_name: '',
                enabled: false
            }
        );
    }

    if (marker.parsed === null) {
        return buildCheck(
            'backup',
            'pitr',
            false,
            'invalid',
            `${marker.name} 只能填写 true/false 这类布尔值`,
            {
                env_name: marker.name,
                enabled: null
            }
        );
    }

    return buildCheck(
        'backup',
        'pitr',
        true,
        marker.parsed ? 'configured' : 'disabled_fallback',
        marker.parsed
            ? `PITR readiness 标记已开启：${marker.name}`
            : `PITR readiness 标记为关闭：${marker.name}，将按手动备份/审计视图降级演练`,
        {
            env_name: marker.name,
            enabled: marker.parsed
        }
    );
}

function inspectBackupConfirmation(env = process.env, options = {}, pitrCheck = {}) {
    const marker = readBooleanMarker(env, BACKUP_MARKERS);
    const pitrEnabled = pitrCheck?.enabled === true;

    if (!marker.name) {
        const ok = pitrEnabled || options.failOnMissingBackup !== true;
        return buildCheck(
            'backup',
            'backup_confirmation',
            ok,
            pitrEnabled ? 'covered_by_pitr' : 'manual_confirmation_required',
            pitrEnabled
                ? 'PITR 已标记开启，本次 readiness 视为已有恢复点能力'
                : '未看到备份确认标记；真实修复前仍需在 Supabase 控制台确认备份/导出',
            {
                env_name: '',
                confirmed: pitrEnabled
            }
        );
    }

    if (marker.parsed === null) {
        return buildCheck(
            'backup',
            'backup_confirmation',
            false,
            'invalid',
            `${marker.name} 只能填写 true/false 这类布尔值`,
            {
                env_name: marker.name,
                confirmed: null
            }
        );
    }

    const ok = marker.parsed === true || options.failOnMissingBackup !== true;
    return buildCheck(
        'backup',
        'backup_confirmation',
        ok,
        marker.parsed ? 'confirmed' : 'not_confirmed',
        marker.parsed
            ? `备份/恢复点 readiness 标记已确认：${marker.name}`
            : `备份/恢复点 readiness 标记为关闭：${marker.name}`,
        {
            env_name: marker.name,
            confirmed: marker.parsed
        }
    );
}

function inspectBackupDate(env = process.env, options = {}, now = new Date(), pitrCheck = {}) {
    const marker = readFirstEnv(env, BACKUP_DATE_MARKERS);
    const pitrEnabled = pitrCheck?.enabled === true;

    if (!marker.name) {
        const ok = pitrEnabled || options.failOnMissingBackup !== true;
        return buildCheck(
            'backup',
            'backup_confirmed_at',
            ok,
            pitrEnabled ? 'covered_by_pitr' : 'not_recorded',
            pitrEnabled
                ? 'PITR 已标记开启，可以不额外记录手动备份确认时间'
                : '未记录最近一次备份确认时间；建议设置 FINANCIAL_RECOVERY_BACKUP_CONFIRMED_AT',
            {
                env_name: '',
                age_days: null
            }
        );
    }

    const parsed = parseDateMarker(marker.value, now);
    if (!parsed.valid) {
        return buildCheck(
            'backup',
            'backup_confirmed_at',
            false,
            'invalid',
            `${marker.name} 不是有效日期`,
            {
                env_name: marker.name,
                raw: marker.value
            }
        );
    }

    return buildCheck(
        'backup',
        'backup_confirmed_at',
        true,
        'recorded',
        `最近一次备份确认记录：${parsed.iso.slice(0, 10)}`,
        {
            env_name: marker.name,
            recorded_at: parsed.iso,
            age_days: parsed.age_days
        }
    );
}

function inspectDrillRecord(env = process.env, options = {}, now = new Date()) {
    const marker = readFirstEnv(env, DRILL_DATE_MARKERS);

    if (!marker.name) {
        const ok = options.failOnStale !== true;
        return buildCheck(
            'drill',
            'last_drill',
            ok,
            'not_recorded',
            '未记录最近一次恢复演练时间；建议每月演练后设置 FINANCIAL_RECOVERY_DRILL_LAST_AT',
            {
                env_name: '',
                age_days: null,
                max_age_days: options.maxAgeDays
            }
        );
    }

    const parsed = parseDateMarker(marker.value, now);
    if (!parsed.valid) {
        return buildCheck(
            'drill',
            'last_drill',
            false,
            'invalid',
            `${marker.name} 不是有效日期`,
            {
                env_name: marker.name,
                raw: marker.value,
                max_age_days: options.maxAgeDays
            }
        );
    }

    const fresh = Number(parsed.age_days) <= Number(options.maxAgeDays || DEFAULT_MAX_AGE_DAYS);
    const ok = fresh || options.failOnStale !== true;
    return buildCheck(
        'drill',
        'last_drill',
        ok,
        fresh ? 'fresh' : 'stale',
        fresh
            ? `最近一次恢复演练记录仍在 ${options.maxAgeDays} 天窗口内`
            : `最近一次恢复演练已超过 ${options.maxAgeDays} 天；建议补一次月度演练`,
        {
            env_name: marker.name,
            recorded_at: parsed.iso,
            age_days: parsed.age_days,
            max_age_days: options.maxAgeDays
        }
    );
}

function buildReadinessSummary({
    envFile = '',
    repoChecks = [],
    backupChecks = [],
    drillChecks = [],
    options = {}
} = {}) {
    const allChecks = [
        ...repoChecks,
        ...backupChecks,
        ...drillChecks
    ];
    const findings = allChecks
        .filter((check) => check.ok !== true)
        .map((check) => ({
            severity: check.area === 'repo' ? 'high' : 'medium',
            key: check.key,
            message: check.message,
            status: check.status
        }));
    const advisories = allChecks
        .filter((check) => check.ok === true && [
            'optional_not_configured',
            'disabled_fallback',
            'manual_confirmation_required',
            'not_recorded',
            'not_confirmed',
            'stale'
        ].includes(check.status))
        .map((check) => ({
            severity: 'info',
            key: check.key,
            message: check.message,
            status: check.status
        }));
    const configuredRecoveryLayers = [
        'audit_views',
        'payment_recovery_readiness_gate'
    ];

    if (backupChecks.some((check) => check.key === 'pitr' && check.enabled === true)) {
        configuredRecoveryLayers.push('pitr');
    }
    if (backupChecks.some((check) => (
        ['backup_confirmation', 'backup_confirmed_at'].includes(check.key)
            && ['confirmed', 'recorded', 'covered_by_pitr'].includes(check.status)
    ))) {
        configuredRecoveryLayers.push('backup_confirmation');
    }

    return {
        checked_at: new Date().toISOString(),
        env_file: envFile || '(process env)',
        max_age_days: options.maxAgeDays || DEFAULT_MAX_AGE_DAYS,
        runtime_dependency: 'none',
        pro_fallback: 'PITR/backups are readiness conveniences only; production payment, points, shop, and Supabase Realtime fallback paths do not depend on this script.',
        configured_recovery_layers: [...new Set(configuredRecoveryLayers)],
        repo_checks: repoChecks,
        backup_checks: backupChecks,
        drill_checks: drillChecks,
        advisories,
        findings,
        ok: findings.length === 0
    };
}

function formatHumanReport(summary = {}) {
    const lines = [
        'Financial Recovery Drill Readiness',
        '',
        `env_file: ${summary.env_file || '(process env)'}`,
        `checked_at: ${summary.checked_at || ''}`,
        `max_age_days: ${summary.max_age_days || DEFAULT_MAX_AGE_DAYS}`,
        `runtime_dependency: ${summary.runtime_dependency || 'none'}`,
        'pro_fallback: enabled',
        ''
    ];

    for (const section of [
        ['repo_checks', summary.repo_checks || []],
        ['backup_checks', summary.backup_checks || []],
        ['drill_checks', summary.drill_checks || []]
    ]) {
        const [title, checks] = section;
        lines.push(title);
        for (const check of checks) {
            lines.push(`- [${check.ok ? 'OK' : 'FAIL'}] ${check.key}: ${check.message}`);
        }
        if (!checks.length) {
            lines.push('- (none)');
        }
        lines.push('');
    }

    if (summary.advisories?.length) {
        lines.push('advisories:');
        for (const advisory of summary.advisories) {
            lines.push(`- [${advisory.severity}] ${advisory.message}`);
        }
        lines.push('');
    }

    if (!summary.findings?.length) {
        lines.push('findings: none');
    } else {
        lines.push('findings:');
        for (const finding of summary.findings) {
            lines.push(`- [${finding.severity}] ${finding.message}`);
        }
    }

    lines.push('');
    lines.push(`configured_recovery_layers: ${(summary.configured_recovery_layers || []).join(', ') || '(none)'}`);
    lines.push(`result: ${summary.ok ? 'PASS' : 'FAIL'}`);
    return lines.join('\n');
}

function normalizeRunOptions(options = {}) {
    return {
        envFile: options.envFile || '',
        failOnMissingBackup: options.failOnMissingBackup === true,
        failOnStale: options.failOnStale === true,
        maxAgeDays: Number.isFinite(Number(options.maxAgeDays)) && Number(options.maxAgeDays) > 0
            ? Number(options.maxAgeDays)
            : DEFAULT_MAX_AGE_DAYS
    };
}

function runReadiness({
    env = process.env,
    repoRoot = REPO_ROOT,
    options = {},
    now = new Date()
} = {}) {
    const normalizedOptions = normalizeRunOptions(options);
    const repoChecks = inspectRepoFiles(repoRoot);
    const pitrCheck = inspectPitr(env);
    const backupChecks = [
        pitrCheck,
        inspectBackupConfirmation(env, normalizedOptions, pitrCheck),
        inspectBackupDate(env, normalizedOptions, now, pitrCheck)
    ];
    const drillChecks = [
        inspectDrillRecord(env, normalizedOptions, now)
    ];

    return buildReadinessSummary({
        envFile: normalizedOptions.envFile,
        repoChecks,
        backupChecks,
        drillChecks,
        options: normalizedOptions
    });
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    loadEnvFile(options.envFile);
    const summary = runReadiness({ options });

    console.log(options.json ? JSON.stringify(summary, null, 2) : formatHumanReport(summary));

    if (!summary.ok) {
        process.exitCode = 2;
    }
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error.message || error);
        process.exitCode = 1;
    }
}

module.exports = {
    BACKUP_DATE_MARKERS,
    BACKUP_MARKERS,
    DEFAULT_MAX_AGE_DAYS,
    DRILL_DATE_MARKERS,
    PITR_MARKERS,
    REQUIRED_PACKAGE_SCRIPTS,
    REQUIRED_REPO_FILES,
    buildReadinessSummary,
    formatHumanReport,
    inspectBackupConfirmation,
    inspectBackupDate,
    inspectDrillRecord,
    inspectPitr,
    inspectRepoFiles,
    parseArgs,
    parseBooleanMarker,
    parseDateMarker,
    runReadiness
};
