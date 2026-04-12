const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.resolve(
    __dirname,
    '../supabase/migrations/20260331_harden_shop_admin_refund_site_isolation.sql'
);
const legacyEnhanceMigrationPath = path.resolve(
    __dirname,
    '../supabase/migrations/enhance_refund_function.sql'
);
const p2RehardenMigrationPath = path.resolve(
    __dirname,
    '../supabase/migrations/20260410_p2_refund_rpc_service_role_reharden.sql'
);

function readMigration(filePath = migrationPath) {
    return fs.readFileSync(filePath, 'utf8');
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

test('legacy enhanced refund script cannot downgrade the service-only refund rpc', () => {
    const source = readMigration(legacyEnhanceMigrationPath);

    const requiredMarkers = [
        "IF COALESCE(auth.role(), '') <> 'service_role' THEN",
        "v_site := COALESCE(NULLIF(BTRIM(v_order.site), ''), 'cn');",
        'SELECT public.fn_recharge_points(',
        'v_site',
        "delivery_status = 'refunded'",
        'UPDATE public.shop_products',
        'REVOKE ALL ON FUNCTION public.fn_admin_refund_order(UUID, UUID, VARCHAR, TEXT) FROM authenticated;',
        'GRANT EXECUTE ON FUNCTION public.fn_admin_refund_order(UUID, UUID, VARCHAR, TEXT) TO service_role;'
    ];

    for (const marker of requiredMarkers) {
        assert.equal(source.includes(marker), true, `legacy enhanced script should contain ${marker}`);
    }

    assert.equal(
        source.includes('GRANT EXECUTE ON FUNCTION fn_admin_refund_order TO authenticated;'),
        false,
        'legacy enhanced script should not reopen the refund rpc to authenticated clients'
    );
});

test('p2 refund rehardening migration reapplies site-aware service-only refund rpc', () => {
    const source = readMigration(p2RehardenMigrationPath);

    const requiredMarkers = [
        'DROP FUNCTION IF EXISTS public.fn_admin_refund_order(UUID, UUID, VARCHAR, TEXT);',
        "IF COALESCE(auth.role(), '') <> 'service_role' THEN",
        "v_site := COALESCE(NULLIF(BTRIM(v_order.site), ''), 'cn');",
        'SELECT public.fn_recharge_points(',
        'v_site',
        "delivery_status = 'refunded'",
        'UPDATE public.shop_products',
        'REVOKE ALL ON FUNCTION public.fn_admin_refund_order(UUID, UUID, VARCHAR, TEXT) FROM authenticated;',
        'GRANT EXECUTE ON FUNCTION public.fn_admin_refund_order(UUID, UUID, VARCHAR, TEXT) TO service_role;'
    ];

    for (const marker of requiredMarkers) {
        assert.equal(source.includes(marker), true, `p2 rehardening migration should contain ${marker}`);
    }

    assert.equal(
        source.includes('GRANT EXECUTE ON FUNCTION fn_admin_refund_order TO authenticated;'),
        false,
        'p2 rehardening migration should not reopen the refund rpc to authenticated clients'
    );
});
