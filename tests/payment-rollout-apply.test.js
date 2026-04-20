const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    MIGRATION_SETS,
    buildSupabasePushArgs,
    createTempRolloutWorkdir,
    ensureRolloutSafety,
    formatHumanReport,
    getMigrationSet,
    inferProjectRefFromSupabaseUrl,
    parseArgs,
    resolveRolloutContext
} = require('../scripts/payment-rollout-apply');

test('parseArgs captures rollout planning and execution flags', () => {
    const options = parseArgs([
        '--env-file', 'server/.env.production',
        '--set', 'full',
        '--project-ref', 'demo123',
        '--db-url', 'postgresql://user:pw@example.com/postgres',
        '--apply',
        '--keep-temp',
        '--skip-preflight',
        '--run-smoke',
        '--run-verify',
        '--smoke-config-only',
        '--allow-production-like',
        '--json'
    ]);

    assert.match(options.envFile, /server\/\.env\.production$/);
    assert.equal(options.migrationSet, 'full');
    assert.equal(options.expectedProjectRef, 'demo123');
    assert.equal(options.dbUrl, 'postgresql://user:pw@example.com/postgres');
    assert.equal(options.executeMode, 'apply');
    assert.equal(options.keepTemp, true);
    assert.equal(options.skipPreflight, true);
    assert.equal(options.runSmoke, true);
    assert.equal(options.runVerify, true);
    assert.equal(options.smokeConfigOnly, true);
    assert.equal(options.allowProductionLike, true);
    assert.equal(options.json, true);
});

test('inferProjectRefFromSupabaseUrl extracts the project ref from Supabase URLs', () => {
    assert.equal(
        inferProjectRefFromSupabaseUrl('https://mmkugdibsaeoevliebzk.supabase.co'),
        'mmkugdibsaeoevliebzk'
    );
    assert.equal(
        inferProjectRefFromSupabaseUrl('mmkugdibsaeoevliebzk.supabase.co'),
        'mmkugdibsaeoevliebzk'
    );
});

test('getMigrationSet exposes both incremental and full payment rollout chains', () => {
    assert.deepEqual(getMigrationSet('incremental').migrations, [...MIGRATION_SETS.incremental]);
    assert.deepEqual(getMigrationSet('full').migrations, [...MIGRATION_SETS.full]);
    assert.equal(getMigrationSet('incremental').migrations.includes('20260419_allow_archived_payment_anomaly_cases.sql'), true);
    assert.equal(getMigrationSet('full').migrations.includes('20260419_allow_archived_payment_anomaly_cases.sql'), true);
    assert.equal(getMigrationSet('incremental').migrations.includes('20260419_fix_payment_overview_summary_active_anomalies.sql'), true);
    assert.equal(getMigrationSet('full').migrations.includes('20260419_fix_payment_overview_summary_active_anomalies.sql'), true);
});

test('resolveRolloutContext prefers explicit project ref and db url overrides', () => {
    const context = resolveRolloutContext({
        envFile: '/tmp/server.env',
        migrationSet: 'incremental',
        expectedProjectRef: 'override123',
        dbUrl: 'postgresql://demo',
        executeMode: 'dry-run',
        keepTemp: true,
        skipPreflight: true,
        runSmoke: false,
        runVerify: false,
        smokeConfigOnly: false,
        allowProductionLike: false,
        json: false
    }, {
        SUPABASE_URL: 'https://wrong.supabase.co',
        PAYMENT_ROLLOUT_TARGET_REF: 'envref'
    });

    assert.equal(context.expectedProjectRef, 'override123');
    assert.equal(context.dbUrl, 'postgresql://demo');
    assert.equal(context.migrationSet.key, 'incremental');
});

test('ensureRolloutSafety rejects linked project mismatches', () => {
    assert.throws(
        () => ensureRolloutSafety({
            expectedProjectRef: 'target123',
            linkedProjectRef: 'other456',
            dbUrl: ''
        }),
        /does not match the expected target/
    );
});

test('buildSupabasePushArgs supports linked dry-runs and db-url applies', () => {
    assert.deepEqual(
        buildSupabasePushArgs({
            tempWorkdir: '/tmp/payment-rollout',
            dbUrl: '',
            executeMode: 'dry-run'
        }),
        ['db', 'push', '--workdir', '/tmp/payment-rollout', '--linked', '--dry-run']
    );

    assert.deepEqual(
        buildSupabasePushArgs({
            tempWorkdir: '/tmp/payment-rollout',
            dbUrl: 'postgresql://demo',
            executeMode: 'apply'
        }),
        ['db', 'push', '--workdir', '/tmp/payment-rollout', '--db-url', 'postgresql://demo', '--yes']
    );
});

test('formatHumanReport renders planned supabase commands without throwing', () => {
    const report = formatHumanReport({
        envFile: '/tmp/server.env',
        expectedProjectRef: 'demo123',
        linkedProjectRef: 'demo123',
        executeMode: 'plan',
        migrationSet: 'incremental',
        tempWorkdir: '/tmp/payment-rollout-abc',
        command: ['db', 'push', '--workdir', '/tmp/payment-rollout-abc', '--linked', '--dry-run'],
        migrations: ['a.sql', 'b.sql']
    });

    assert.match(report, /command: supabase db push --workdir \/tmp\/payment-rollout-abc --linked --dry-run/);
    assert.match(report, /- a\.sql/);
});

test('createTempRolloutWorkdir copies only the selected migration files and linked ref metadata', () => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'payment-rollout-fixture-'));
    const sourceDir = path.join(fixtureRoot, 'source');
    fs.mkdirSync(sourceDir, { recursive: true });

    const migrationA = path.join(sourceDir, '20260322_harden_payment_creation_entrypoints.sql');
    const migrationB = path.join(sourceDir, '20260322_constrain_payment_sites.sql');
    fs.writeFileSync(migrationA, '-- migration a\n');
    fs.writeFileSync(migrationB, '-- migration b\n');

    const tempWorkdir = createTempRolloutWorkdir({
        migrationPaths: [
            { filename: path.basename(migrationA), absolutePath: migrationA },
            { filename: path.basename(migrationB), absolutePath: migrationB }
        ],
        linkedProjectRef: 'demo123'
    });

    assert.equal(
        fs.readFileSync(path.join(tempWorkdir, 'supabase/.temp/project-ref'), 'utf8').trim(),
        'demo123'
    );
    assert.equal(
        fs.readFileSync(path.join(tempWorkdir, 'supabase/migrations', path.basename(migrationA)), 'utf8'),
        '-- migration a\n'
    );
    assert.equal(
        fs.readFileSync(path.join(tempWorkdir, 'supabase/migrations', path.basename(migrationB)), 'utf8'),
        '-- migration b\n'
    );

    fs.rmSync(fixtureRoot, { recursive: true, force: true });
    fs.rmSync(tempWorkdir, { recursive: true, force: true });
});
