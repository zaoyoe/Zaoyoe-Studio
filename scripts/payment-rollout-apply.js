const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ENV_FILE = path.resolve(REPO_ROOT, 'server/.env.production');
const LINKED_PROJECT_REF_FILE = path.resolve(REPO_ROOT, 'supabase/.temp/project-ref');
const MIGRATION_SETS = Object.freeze({
    incremental: Object.freeze([
        '20260322_harden_payment_creation_entrypoints.sql',
        '20260322_constrain_payment_sites.sql',
        '20260322_retire_legacy_redemption_overloads.sql',
        '20260324_add_persistent_rate_limits.sql'
    ]),
    full: Object.freeze([
        '20260322_harden_shop_purchase_identity.sql',
        '20260322_harden_points_mutation_rpcs.sql',
        '20260322_harden_payment_creation_entrypoints.sql',
        '20260322_harden_payment_redemption_entrypoints.sql',
        '20260322_constrain_payment_sites.sql',
        '20260322_retire_legacy_redemption_overloads.sql',
        '20260324_add_persistent_rate_limits.sql'
    ])
});

function parseArgs(argv = []) {
    const options = {
        envFile: DEFAULT_ENV_FILE,
        migrationSet: 'incremental',
        expectedProjectRef: '',
        dbUrl: '',
        executeMode: 'plan',
        keepTemp: false,
        skipPreflight: false,
        runSmoke: false,
        runVerify: false,
        smokeConfigOnly: false,
        allowProductionLike: false,
        json: false
    };

    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '').trim();
        if (!value) continue;

        if (value === '--env-file') {
            options.envFile = path.resolve(process.cwd(), String(argv[index + 1] || '').trim());
            index += 1;
            continue;
        }

        if (value === '--set') {
            options.migrationSet = String(argv[index + 1] || '').trim().toLowerCase();
            index += 1;
            continue;
        }

        if (value === '--project-ref') {
            options.expectedProjectRef = String(argv[index + 1] || '').trim().toLowerCase();
            index += 1;
            continue;
        }

        if (value === '--db-url') {
            options.dbUrl = String(argv[index + 1] || '').trim();
            index += 1;
            continue;
        }

        if (value === '--execute') {
            options.executeMode = 'dry-run';
            continue;
        }

        if (value === '--apply') {
            options.executeMode = 'apply';
            continue;
        }

        if (value === '--keep-temp') {
            options.keepTemp = true;
            continue;
        }

        if (value === '--skip-preflight') {
            options.skipPreflight = true;
            continue;
        }

        if (value === '--run-smoke') {
            options.runSmoke = true;
            continue;
        }

        if (value === '--run-verify') {
            options.runVerify = true;
            continue;
        }

        if (value === '--smoke-config-only') {
            options.smokeConfigOnly = true;
            continue;
        }

        if (value === '--allow-production-like') {
            options.allowProductionLike = true;
            continue;
        }

        if (value === '--json') {
            options.json = true;
        }
    }

    return options;
}

function readEnvFile(envFile) {
    if (!envFile || !fs.existsSync(envFile)) {
        return {};
    }

    return dotenv.parse(fs.readFileSync(envFile, 'utf8'));
}

function inferProjectRefFromSupabaseUrl(supabaseUrl = '') {
    const normalized = String(supabaseUrl || '').trim();
    if (!normalized) return '';

    try {
        const hostname = new URL(normalized).hostname.toLowerCase();
        const [subdomain = ''] = hostname.split('.');
        return subdomain;
    } catch (_) {
        const sanitized = normalized
            .replace(/^https?:\/\//i, '')
            .replace(/\/+$/, '')
            .toLowerCase();
        return sanitized.split('.')[0] || '';
    }
}

function readLinkedProjectRef(projectRefFile = LINKED_PROJECT_REF_FILE) {
    if (!fs.existsSync(projectRefFile)) {
        return '';
    }

    return String(fs.readFileSync(projectRefFile, 'utf8') || '').trim().toLowerCase();
}

function getMigrationSet(migrationSet = 'incremental') {
    const normalized = String(migrationSet || '').trim().toLowerCase() || 'incremental';
    const migrations = MIGRATION_SETS[normalized];
    if (!migrations) {
        throw new Error(`Unknown payment rollout migration set: ${migrationSet}`);
    }
    return {
        key: normalized,
        migrations: [...migrations]
    };
}

function resolveRolloutContext(options = {}, envValues = {}) {
    const envProjectRef = inferProjectRefFromSupabaseUrl(
        envValues.SUPABASE_URL
        || envValues.NEXT_PUBLIC_SUPABASE_URL
        || ''
    );
    const linkedProjectRef = readLinkedProjectRef();
    const expectedProjectRef = String(
        options.expectedProjectRef
        || envValues.PAYMENT_ROLLOUT_TARGET_REF
        || envProjectRef
        || ''
    ).trim().toLowerCase();
    const dbUrl = String(
        options.dbUrl
        || envValues.PAYMENT_ROLLOUT_DB_URL
        || envValues.SUPABASE_DB_URL
        || ''
    ).trim();
    const migrationSet = getMigrationSet(options.migrationSet);

    return {
        envFile: options.envFile,
        envProjectRef,
        linkedProjectRef,
        expectedProjectRef,
        dbUrl,
        migrationSet,
        executeMode: options.executeMode,
        keepTemp: options.keepTemp,
        skipPreflight: options.skipPreflight,
        runSmoke: options.runSmoke,
        runVerify: options.runVerify,
        smokeConfigOnly: options.smokeConfigOnly,
        allowProductionLike: options.allowProductionLike,
        json: options.json
    };
}

function ensureRolloutSafety(context = {}) {
    if (!context.expectedProjectRef) {
        throw new Error('Unable to determine the target Supabase project ref. Pass --project-ref or set SUPABASE_URL in the env file.');
    }

    if (!context.dbUrl && !context.linkedProjectRef) {
        throw new Error('No linked Supabase project ref was found and no --db-url was provided.');
    }

    if (!context.dbUrl && context.linkedProjectRef !== context.expectedProjectRef) {
        throw new Error(
            `Linked Supabase project ref ${context.linkedProjectRef} does not match the expected target ${context.expectedProjectRef}.`
        );
    }
}

function resolveMigrationPaths(migrations = []) {
    return migrations.map((filename) => {
        const absolutePath = path.resolve(REPO_ROOT, 'supabase/migrations', filename);
        if (!fs.existsSync(absolutePath)) {
            throw new Error(`Missing rollout migration file: ${filename}`);
        }

        return {
            filename,
            absolutePath
        };
    });
}

function createTempRolloutWorkdir({ migrationPaths = [], linkedProjectRef = '' } = {}) {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'payment-rollout-'));
    const tempSupabaseDir = path.join(tempRoot, 'supabase');
    const tempMigrationsDir = path.join(tempSupabaseDir, 'migrations');
    const tempMetaDir = path.join(tempSupabaseDir, '.temp');

    fs.mkdirSync(tempMigrationsDir, { recursive: true });
    fs.mkdirSync(tempMetaDir, { recursive: true });

    if (linkedProjectRef) {
        fs.writeFileSync(path.join(tempMetaDir, 'project-ref'), `${linkedProjectRef}\n`);
    }

    for (const migration of migrationPaths) {
        fs.copyFileSync(
            migration.absolutePath,
            path.join(tempMigrationsDir, migration.filename)
        );
    }

    return tempRoot;
}

function buildSupabasePushArgs({ tempWorkdir, dbUrl = '', executeMode = 'plan' } = {}) {
    const args = ['db', 'push', '--workdir', tempWorkdir];

    if (dbUrl) {
        args.push('--db-url', dbUrl);
    } else {
        args.push('--linked');
    }

    if (executeMode === 'dry-run') {
        args.push('--dry-run');
    }

    if (executeMode === 'apply') {
        args.push('--yes');
    }

    return args;
}

function buildSmokeArgs(context = {}) {
    const args = ['--env-file', context.envFile];

    if (context.smokeConfigOnly) {
        args.push('--config-only');
    }

    if (context.allowProductionLike) {
        args.push('--allow-production-like');
    }

    return args;
}

function runNodeScript(scriptRelativePath, args = []) {
    const scriptPath = path.resolve(REPO_ROOT, 'scripts', scriptRelativePath);
    const result = spawnSync(process.execPath, [scriptPath, ...args], {
        cwd: REPO_ROOT,
        encoding: 'utf8'
    });

    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);

    return result.status ?? 1;
}

function runSupabaseCommand(args = []) {
    const result = spawnSync('supabase', args, {
        cwd: REPO_ROOT,
        encoding: 'utf8'
    });

    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);

    return result.status ?? 1;
}

function cleanupTempWorkdir(tempWorkdir = '') {
    if (!tempWorkdir || !fs.existsSync(tempWorkdir)) return;
    fs.rmSync(tempWorkdir, { recursive: true, force: true });
}

function formatHumanReport(report = {}) {
    const lines = ['Payment Rollout Apply Plan', ''];
    const commandText = Array.isArray(report.command)
        ? report.command.join(' ')
        : String(report.command || '');
    lines.push(`env_file: ${report.envFile || DEFAULT_ENV_FILE}`);
    lines.push(`target_project_ref: ${report.expectedProjectRef || '(missing)'}`);
    lines.push(`linked_project_ref: ${report.linkedProjectRef || '(missing)'}`);
    lines.push(`execution_mode: ${report.executeMode || 'plan'}`);
    lines.push(`migration_set: ${report.migrationSet || 'incremental'}`);
    lines.push(`workdir: ${report.tempWorkdir || '(pending)'}`);
    lines.push(`command: supabase ${commandText}`);
    lines.push('');
    lines.push('migrations:');
    for (const migration of report.migrations || []) {
        lines.push(`- ${migration}`);
    }
    return lines.join('\n');
}

async function runPaymentRollout(options = {}) {
    const envValues = readEnvFile(options.envFile);
    const context = resolveRolloutContext(options, envValues);
    ensureRolloutSafety(context);

    const migrationPaths = resolveMigrationPaths(context.migrationSet.migrations);
    const tempWorkdir = createTempRolloutWorkdir({
        migrationPaths,
        linkedProjectRef: context.linkedProjectRef || context.expectedProjectRef
    });
    const command = buildSupabasePushArgs({
        tempWorkdir,
        dbUrl: context.dbUrl,
        executeMode: context.executeMode
    });

    const report = {
        ok: true,
        envFile: context.envFile,
        expectedProjectRef: context.expectedProjectRef,
        linkedProjectRef: context.linkedProjectRef,
        executeMode: context.executeMode,
        migrationSet: context.migrationSet.key,
        migrations: context.migrationSet.migrations,
        tempWorkdir,
        command
    };

    if (context.executeMode === 'plan') {
        return report;
    }

    let preflightStatus = 0;
    if (context.executeMode === 'apply' && !context.skipPreflight) {
        preflightStatus = runNodeScript('payment-rollout-preflight.js', ['--env-file', context.envFile]);
        report.preflightStatus = preflightStatus;
        if (preflightStatus !== 0) {
            report.ok = false;
            return report;
        }
    }

    const pushStatus = runSupabaseCommand(command);
    report.pushStatus = pushStatus;
    report.ok = pushStatus === 0;

    if (pushStatus !== 0) {
        return report;
    }

    if (context.executeMode === 'apply' && context.runSmoke) {
        const smokeStatus = runNodeScript('payment-smoke-test.js', buildSmokeArgs(context));
        report.smokeStatus = smokeStatus;
        report.ok = smokeStatus === 0;
        if (smokeStatus !== 0) {
            return report;
        }
    }

    if (context.executeMode === 'apply' && context.runVerify) {
        const verifyStatus = runNodeScript('payment-rollout-verify.js', [
            '--env-file',
            context.envFile,
            '--fail-on-finding'
        ]);
        report.verifyStatus = verifyStatus;
        report.ok = verifyStatus === 0;
    }

    return report;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    let report = null;

    try {
        report = await runPaymentRollout(options);
        console.log(options.json ? JSON.stringify(report, null, 2) : formatHumanReport(report));
        if (!report.ok) {
            process.exitCode = 1;
        }
    } catch (error) {
        if (report?.tempWorkdir && !options.keepTemp && options.executeMode !== 'plan') {
            cleanupTempWorkdir(report.tempWorkdir);
        }
        console.error(error.message || error);
        process.exitCode = 1;
        return;
    }

    if (report?.tempWorkdir && !options.keepTemp && options.executeMode !== 'plan') {
        cleanupTempWorkdir(report.tempWorkdir);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    DEFAULT_ENV_FILE,
    MIGRATION_SETS,
    buildSupabasePushArgs,
    createTempRolloutWorkdir,
    ensureRolloutSafety,
    formatHumanReport,
    getMigrationSet,
    inferProjectRefFromSupabaseUrl,
    parseArgs,
    readEnvFile,
    resolveRolloutContext,
    resolveMigrationPaths,
    runPaymentRollout
};
