const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRepoFile(relativePath) {
    return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('financial recovery audit migration covers payment, points, and shop recovery views', () => {
    const migration = readRepoFile('supabase/migrations/20260510_add_financial_recovery_audit_views.sql');
    const serviceRoleMigration = readRepoFile('supabase/migrations/20260511_allow_service_role_financial_recovery_audit_views.sql');
    const readiness = readRepoFile('scripts/payment-readiness-gate.js');
    const packageJson = JSON.parse(readRepoFile('package.json'));

    for (const viewName of [
        'admin_payment_order_recovery_audit_view',
        'admin_points_balance_recovery_audit_view',
        'admin_shop_inventory_recovery_audit_view',
        'admin_financial_recovery_audit_summary_view'
    ]) {
        assert.match(migration, new RegExp(`CREATE OR REPLACE VIEW public\\.${viewName}`));
        assert.match(migration, new RegExp(`GRANT SELECT ON public\\.${viewName} TO authenticated`));
        assert.equal(readiness.includes(viewName), true, `readiness gate should probe ${viewName}`);
        assert.match(serviceRoleMigration, new RegExp(`CREATE OR REPLACE VIEW public\\.${viewName}`));
        assert.match(serviceRoleMigration, new RegExp(`GRANT SELECT ON public\\.${viewName} TO authenticated, service_role`));
    }

    for (const flag of [
        'paid_without_redemption_code',
        'redeemed_without_ledger_credit',
        'ledger_credit_amount_mismatch',
        'balance_ledger_mismatch',
        'ledger_without_balance',
        'paid_order_without_ledger_debit',
        'key_order_missing_inventory_items',
        'sold_inventory_buyer_mismatch',
        'sold_inventory_status_mismatch'
    ]) {
        assert.equal(migration.includes(flag), true, `recovery audit migration should include ${flag}`);
    }

    assert.match(migration, /WITH \(security_invoker = on\)/);
    assert.match(migration, /WHERE public\.is_admin\(\)/);
    assert.match(serviceRoleMigration, /COALESCE\(auth\.role\(\), ''\) = 'service_role' OR public\.is_admin\(\)/);
    assert.equal(
        (serviceRoleMigration.match(/COALESCE\(auth\.role\(\), ''\) = 'service_role' OR public\.is_admin\(\)/g) || []).length,
        3
    );
    assert.doesNotMatch(serviceRoleMigration, /WHERE public\.is_admin\(\);/);
    assert.match(serviceRoleMigration, /backend readiness and scheduled recovery drills can use service_role/);
    assert.match(migration, /COALESCE\(NULLIF\(BTRIM\(site\), ''\), 'cn'\)/);
    assert.match(migration, /SHOP_ORDER_/);
    assert.match(migration, /redeem_/);

    assert.equal(
        packageJson.scripts['readiness:payment-recovery'],
        'node scripts/payment-readiness-gate.js --fail-on-missing'
    );
});

test('payment readiness gate probes critical write rpcs before rollout', () => {
    const readiness = readRepoFile('scripts/payment-readiness-gate.js');

    for (const rpcName of [
        'fn_create_payment_checkout_session',
        'fn_ensure_redemption_code_for_payment_order',
        'fn_recharge_points',
        'fn_purchase_shop_item_with_discounts',
        'fn_admin_refund_order',
        'fn_deduct_points_admin_site_with_breakdown'
    ]) {
        assert.equal(readiness.includes(`rpcName: '${rpcName}'`), true, `readiness gate should probe ${rpcName}`);
    }

    assert.match(readiness, /function probeRelationCapability/);
    assert.match(readiness, /isMissingRelationCapabilityError/);
    assert.match(readiness, /recovery_audit_relations/);
});
