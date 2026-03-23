const test = require('node:test');
const assert = require('node:assert/strict');

const {
    SUPPORTED_SITES,
    buildSupportedSitesFilter,
    buildVerificationSummary,
    formatHuman,
    parseArgs
} = require('../scripts/payment-rollout-verify');

test('parseArgs captures verification flags', () => {
    const options = parseArgs([
        '--env-file', 'server/.env.production',
        '--sample-limit', '33',
        '--fail-on-finding',
        '--json'
    ]);

    assert.match(options.envFile, /server\/\.env\.production$/);
    assert.equal(options.sampleLimit, 33);
    assert.equal(options.failOnFinding, true);
    assert.equal(options.json, true);
});

test('buildSupportedSitesFilter tracks the supported rollout site set', () => {
    assert.deepEqual(SUPPORTED_SITES, ['cn', 'intl']);
    assert.equal(buildSupportedSitesFilter(), '(cn,intl)');
});

test('buildVerificationSummary marks high-severity payment anomalies as blocking', () => {
    const summary = buildVerificationSummary({
        envFile: '/tmp/server.env',
        projectHost: 'demo.supabase.co',
        siteSummary: {
            payment_checkout_sessions: {
                total: 2,
                supported: { cn: 1, intl: 1 },
                anomalies: { null_or_blank: 0, unsupported: 0 },
                samples: []
            },
            payment_orders: {
                total: 2,
                supported: { cn: 1, intl: 1 },
                anomalies: { null_or_blank: 0, unsupported: 1 },
                samples: [{ id: 'po_1', site: 'legacy' }]
            }
        },
        prematureRedemptionCodes: { count: 1, samples: [{ id: 'po_1' }] },
        unresolvedLinkedCodes: { count: 0, samples: [] },
        pendingSyntheticCodes: { count: 0, samples: [] },
        missingLedgerSites: { count: 0, samples: [] },
        customCodeBatches: { count: 1, samples: [{ id: 'batch_1' }] }
    });

    assert.equal(summary.ok, false);
    assert.equal(summary.findings.some((finding) => finding.key === 'site_anomalies_payment_orders'), true);
    assert.equal(summary.findings.some((finding) => finding.key === 'premature_redemption_codes'), true);
    assert.equal(summary.findings.some((finding) => finding.key === 'recent_custom_code_batches'), true);
});

test('formatHuman renders a readable PASS report', () => {
    const output = formatHuman({
        ok: true,
        project_host: 'demo.supabase.co',
        env_file: '/tmp/server.env',
        verified_at: '2026-03-22T00:00:00.000Z',
        site_summary: {
            payment_checkout_sessions: {
                total: 0,
                supported: { cn: 0, intl: 0 },
                anomalies: { null_or_blank: 0, unsupported: 0 },
                samples: []
            },
            payment_orders: {
                total: 0,
                supported: { cn: 0, intl: 0 },
                anomalies: { null_or_blank: 0, unsupported: 0 },
                samples: []
            }
        },
        payment_orders_with_premature_redemption_code: { count: 0, samples: [] },
        unresolved_payment_orders_with_linked_codes: { count: 0, samples: [] },
        redemption_codes_with_pending_external_order_id: { count: 0, samples: [] },
        redeem_ledger_rows_missing_site: { count: 0, samples: [] },
        recent_custom_code_batches: { count: 0, samples: [] },
        findings: []
    });

    assert.match(output, /Payment Rollout Verification/);
    assert.match(output, /result: PASS/);
    assert.match(output, /findings: none/);
});
