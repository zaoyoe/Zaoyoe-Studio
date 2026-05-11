const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    formatHumanReport,
    inspectDrillRecord,
    inspectPitr,
    parseArgs,
    parseBooleanMarker,
    parseDateMarker,
    runReadiness
} = require('../scripts/financial-recovery-drill-readiness');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('financial recovery drill readiness parseArgs supports strict drill flags', () => {
    const options = parseArgs([
        '--env-file', 'server/.env.production',
        '--max-age-days', '30',
        '--fail-on-missing-backup',
        '--fail-on-stale',
        '--json'
    ]);

    assert.match(options.envFile, /server\/\.env\.production$/);
    assert.equal(options.maxAgeDays, 30);
    assert.equal(options.failOnMissingBackup, true);
    assert.equal(options.failOnStale, true);
    assert.equal(options.json, true);
});

test('financial recovery drill readiness treats PITR as optional by default', () => {
    const summary = runReadiness({
        env: {},
        now: new Date('2026-05-11T00:00:00.000Z')
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.runtime_dependency, 'none');
    assert.equal(summary.backup_checks.find((check) => check.key === 'pitr').status, 'optional_not_configured');
    assert.equal(summary.drill_checks.find((check) => check.key === 'last_drill').status, 'not_recorded');
    assert.deepEqual(summary.findings, []);
    assert.equal(summary.advisories.length >= 2, true);
});

test('financial recovery drill readiness recognizes PITR and fresh drill markers', () => {
    const summary = runReadiness({
        env: {
            SUPABASE_PITR_ENABLED: 'true',
            FINANCIAL_RECOVERY_DRILL_LAST_AT: '2026-05-01'
        },
        now: new Date('2026-05-11T00:00:00.000Z')
    });

    assert.equal(summary.ok, true);
    assert.deepEqual(summary.configured_recovery_layers, [
        'audit_views',
        'payment_recovery_readiness_gate',
        'pitr',
        'backup_confirmation'
    ]);
    assert.equal(summary.drill_checks[0].status, 'fresh');
});

test('financial recovery drill readiness only fails stale drill records in strict mode', () => {
    const relaxed = inspectDrillRecord(
        { FINANCIAL_RECOVERY_DRILL_LAST_AT: '2026-01-01' },
        { maxAgeDays: 30, failOnStale: false },
        new Date('2026-05-11T00:00:00.000Z')
    );
    const strict = inspectDrillRecord(
        { FINANCIAL_RECOVERY_DRILL_LAST_AT: '2026-01-01' },
        { maxAgeDays: 30, failOnStale: true },
        new Date('2026-05-11T00:00:00.000Z')
    );

    assert.equal(relaxed.ok, true);
    assert.equal(relaxed.status, 'stale');
    assert.equal(strict.ok, false);
    assert.equal(strict.status, 'stale');
});

test('financial recovery drill readiness surfaces invalid PITR markers', () => {
    const pitr = inspectPitr({ SUPABASE_PITR_ENABLED: 'maybe' });

    assert.equal(parseBooleanMarker('true'), true);
    assert.equal(parseBooleanMarker('disabled'), false);
    assert.equal(parseBooleanMarker('maybe'), null);
    assert.equal(pitr.ok, false);
    assert.equal(pitr.status, 'invalid');
});

test('financial recovery drill readiness parses date markers with age', () => {
    const parsed = parseDateMarker('2026-05-01', new Date('2026-05-11T00:00:00.000Z'));

    assert.equal(parsed.valid, true);
    assert.equal(parsed.iso.startsWith('2026-05-01'), true);
    assert.equal(parsed.age_days, 10);
});

test('financial recovery drill readiness report documents Pro fallback behavior', () => {
    const output = formatHumanReport({
        checked_at: '2026-05-11T00:00:00.000Z',
        env_file: '(process env)',
        max_age_days: 45,
        runtime_dependency: 'none',
        repo_checks: [
            { key: 'script:payment-readiness-gate', ok: true, message: 'ready' }
        ],
        backup_checks: [
            { key: 'pitr', ok: true, status: 'optional_not_configured', message: 'PITR optional' }
        ],
        drill_checks: [],
        advisories: [],
        findings: [],
        configured_recovery_layers: [
            'audit_views',
            'payment_recovery_readiness_gate'
        ],
        ok: true
    });

    assert.match(output, /Financial Recovery Drill Readiness/);
    assert.match(output, /runtime_dependency: none/);
    assert.match(output, /pro_fallback: enabled/);
    assert.match(output, /result: PASS/);
});

test('financial recovery drill docs and npm script keep PITR optional', () => {
    const packageJson = JSON.parse(readRepoFile('package.json'));
    const runbook = readRepoFile('docs/financial-recovery-drill-runbook.md');

    assert.equal(
        packageJson.scripts['readiness:financial-recovery-drill'],
        'node scripts/financial-recovery-drill-readiness.js'
    );
    assert.match(runbook, /Pro \/ PITR Fallback Rule/);
    assert.match(runbook, /not a runtime dependency/);
    assert.match(runbook, /Missing PITR is an advisory by default/);
    assert.match(runbook, /--fail-on-missing-backup --fail-on-stale/);
});
