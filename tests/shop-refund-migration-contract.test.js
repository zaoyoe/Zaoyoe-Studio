const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.resolve(
    __dirname,
    '../supabase/migrations/20260331_harden_shop_admin_refund_site_isolation.sql'
);

function readMigration() {
    return fs.readFileSync(migrationPath, 'utf8');
}

test('shop refund hardening migration upgrades refund rpc to site-aware service-only flow', () => {
    const source = readMigration();

    const requiredMarkers = [
        'CREATE OR REPLACE FUNCTION public.fn_admin_refund_order(',
        "IF COALESCE(auth.role(), '') <> 'service_role' THEN",
        "v_site := COALESCE(NULLIF(BTRIM(v_order.site), ''), 'cn');",
        'SELECT public.fn_recharge_points(',
        'v_refund_reference,',
        'v_site',
        "SET refund_status = 'refunded',",
        "delivery_status = 'refunded',",
        'UPDATE public.shop_products',
        'SET stock_count = v_stock_count',
        'GRANT EXECUTE ON FUNCTION public.fn_admin_refund_order(UUID, UUID, VARCHAR, TEXT) TO service_role;'
    ];

    for (const marker of requiredMarkers) {
        assert.equal(source.includes(marker), true, `migration should contain ${marker}`);
    }

    assert.equal(
        source.includes('GRANT EXECUTE ON FUNCTION public.fn_admin_refund_order TO authenticated;'),
        false,
        'migration should not reopen the refund rpc to authenticated clients'
    );
});
