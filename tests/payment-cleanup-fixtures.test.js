const test = require('node:test');
const assert = require('node:assert/strict');

const {
    DEFAULT_ORDER_PREFIXES,
    formatHumanReport,
    matchesFixtureUser,
    parseArgs
} = require('../scripts/payment-cleanup-fixtures');

test('parseArgs collects cleanup flags and prefixes', () => {
    const options = parseArgs([
        '--env-file', 'server/.env.staging',
        '--execute',
        '--json',
        '--order-prefix', 'SMOKE_,AUTO_CDX_',
        '--smoke-email', 'smoke-payment-20260323@zaoyoe.invalid'
    ]);

    assert.match(options.envFile, /server\/\.env\.staging$/);
    assert.equal(options.execute, true);
    assert.equal(options.json, true);
    assert.deepEqual(options.orderPrefixes, ['SMOKE_', 'AUTO_CDX_']);
    assert.equal(options.smokeEmail, 'smoke-payment-20260323@zaoyoe.invalid');
});

test('matchesFixtureUser supports both legacy codex and smoke invalid-domain users', () => {
    assert.equal(matchesFixtureUser({ email: 'codex.worker@example.com' }), true);
    assert.equal(matchesFixtureUser({ email: 'smoke-payment-20260323@zaoyoe.invalid' }), true);
    assert.equal(matchesFixtureUser({ email: 'member@example.com' }), false);
    assert.equal(matchesFixtureUser({ email: 'custom@example.com' }, 'custom@example.com'), true);
});

test('formatHumanReport renders preview and deletion summaries', () => {
    const report = formatHumanReport({
        mode: 'execute',
        project_host: 'mmkugdibsaeoevliebzk.supabase.co',
        preview: {
            explicit_smoke_email: 'smoke-payment-20260323@zaoyoe.invalid',
            order_prefixes: DEFAULT_ORDER_PREFIXES,
            counts: {
                payment_orders: 1,
                auth_users: 1
            },
            samples: {
                orders: [{ provider_order_no: 'SMOKE_1' }],
                users: [{ email: 'smoke-payment-20260323@zaoyoe.invalid' }]
            }
        },
        deleted: {
            payment_orders: 1,
            auth_users: 1
        },
        warnings: [{ user_id: 'user-1', message: 'manual review' }]
    });

    assert.match(report, /mode: execute/);
    assert.match(report, /order_prefixes: AUTO_CDX_, SMOKE_/);
    assert.match(report, /payment_orders: 1/);
    assert.match(report, /sample_orders:/);
    assert.match(report, /deleted/);
    assert.match(report, /warnings/);
});
