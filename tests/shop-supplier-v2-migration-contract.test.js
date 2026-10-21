'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
const migration = read('supabase/migrations/20261019_shop_supplier_platform_v2_readonly.sql');
const verify = read('supabase/migrations/20261019_verify_shop_supplier_platform_v2_readonly.sql');
const rpc = migration.split('AS $$')[1].split('$$;')[0];

test('variant migration preserves existing mappings while widening identity to account/site/goods/variant', () => {
    assert.match(migration, /supplier_variant_key TEXT NOT NULL DEFAULT 'default'/);
    assert.match(migration, /supplier_variant JSONB NOT NULL DEFAULT '\{\}'::JSONB/);
    assert.match(migration, /DROP CONSTRAINT IF EXISTS shop_supplier_product_mappings_account_goods_unique/);
    assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS ux_shop_supplier_mapping_account_goods_variant\s+ON public\.shop_supplier_product_mappings \(supplier_account_id, site, supplier_goods_no, supplier_variant_key\)/);
    assert.doesNotMatch(migration, /\b(?:DELETE FROM|TRUNCATE|DROP TABLE)\b/i);
    assert.doesNotMatch(migration, /UPDATE public\.shop_supplier_product_mappings/i);
});

test('import validates the CN site, provider, enabled account and exact supported variant identity', () => {
    assert.match(rpc, /p_admin_id IS NULL OR p_site IS DISTINCT FROM 'cn'/);
    assert.match(rpc, /p_goods_no IS DISTINCT FROM BTRIM\(p_goods_no\)/);
    assert.match(rpc, /jsonb_typeof\(v_variant\) IS DISTINCT FROM 'object'/);
    assert.match(rpc, /\(v_variant - 'race'\) <> '\{\}'::JSONB/);
    assert.match(rpc, /v_variant->>'race' IS DISTINCT FROM BTRIM\(v_variant->>'race'\)/);
    assert.match(rpc, /v_account\.is_enabled IS DISTINCT FROM true[\s\S]*v_account\.provider_id IS DISTINCT FROM 'xiareng'/);
    assert.match(rpc, /OCTET_LENGTH\(p_snapshot::TEXT\) > 16384/);
    assert.match(rpc, /v_variant = '\{\}'::JSONB THEN 'default' ELSE 'v1:' \|\| md5\(v_variant::TEXT\)/);
});

test('import locks the account and variant before lookup; duplicate and collision paths precede every write', () => {
    const order = [
        'WHERE id = p_account_id FOR SHARE',
        'pg_advisory_xact_lock',
        'SELECT * INTO v_mapping',
        'v_mapping.supplier_variant IS DISTINCT FROM v_variant',
        "'status', 'already_imported'",
        'INSERT INTO public.shop_products',
        'INSERT INTO public.shop_supplier_product_mappings',
        'INSERT INTO public.admin_audit_logs'
    ].map((marker) => { const index = rpc.indexOf(marker); assert.notEqual(index, -1, marker); return index; });
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.match(rpc, /supplier_goods_no = p_goods_no AND supplier_variant_key = v_key/);
    assert.doesNotMatch(rpc, /EXCEPTION\s+WHEN|\b(?:COMMIT|ROLLBACK)\s*;/i, 'errors must roll back the whole caller transaction');
});

test('atomic draft import cannot publish a product, invent international pricing or turn on a mapping', () => {
    assert.match(rpc, /INSERT INTO public\.shop_products \(name, description, category, tags, price_points, price_points_intl,\s+stock_count, is_active, allow_guest_purchase\)\s+VALUES \(BTRIM\(p_name\), NULL, 'resource', '\[\]'::JSONB, 0, NULL, 0, false, false\)/);
    assert.match(rpc, /WHERE product_id = v_product_id AND is_default = true/);
    assert.match(rpc, /IF v_sku_id IS NULL THEN\s+RAISE EXCEPTION/);
    assert.match(rpc, /p_snapshot, 2, 100, true, false\)/);
    assert.match(rpc, /admin_id, target_user_id, action_type, details/);
    assert.doesNotMatch(rpc, /\bUPDATE\s|\bhttp\b|dblink|shop_orders|shop_guest_orders|user_points/i);
});

test('draft import RPC is service-role-only with a fixed SECURITY DEFINER search path', () => {
    assert.match(migration, /LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp/);
    assert.match(migration, /REVOKE ALL ON FUNCTION public\.import_shop_supplier_draft_v2\([^;]+FROM PUBLIC, anon, authenticated;/);
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.import_shop_supplier_draft_v2\([^;]+TO service_role;/);
});

test('unknown currency stays unknown and the new provider account is seeded disabled without overwriting existing configuration', () => {
    assert.match(migration, /ALTER COLUMN currency DROP NOT NULL/);
    assert.match(migration, /ALTER COLUMN currency DROP DEFAULT/);
    assert.match(migration, /VALUES \('xiareng', 'default', '虾仁默认账号（只读）', 'env:SUPPLIER_XIARENG', false\)\s+ON CONFLICT \(provider_id, account_key\) DO NOTHING/);
    assert.doesNotMatch(migration, /UPDATE public\.shop_supplier_availability|DO UPDATE/i);
});

test('manual verification checks schema and privileges read-only and keeps business/concurrency evidence explicitly NOT RUN', () => {
    assert.match(verify, /SET TRANSACTION READ ONLY;/);
    for (const marker of [
        'c.relrowsecurity', 'i.indisunique AND i.indisvalid', 'i.indnkeyatts = 4',
        "column_default IS NULL", 'tr_shop_products_ensure_default_sku',
        "has_function_privilege('anon'", "has_function_privilege('authenticated'",
        "has_function_privilege('service_role'", "search_path=public, pg_temp",
        'pg_get_functiondef', 'pg_advisory_xact_lock'
    ]) assert.ok(verify.includes(marker), marker);
    assert.match(verify, /structural checks passed; concurrent\/merchant\/business acceptance remains NOT RUN/);
    assert.doesNotMatch(verify, /\b(?:INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE|ALTER TABLE|GRANT |REVOKE )/i);
    assert.doesNotMatch(verify, /(?:SELECT|PERFORM)\s+(?:public\.)?import_shop_supplier_draft_v2\s*\(/i);
});

test('supplier runtime sources are included in both artifact paths and require no new public gateway route', () => {
    const ignores = read('.vercelignore');
    assert.match(ignores, /^!server\/integrations\/\*\*$/m);
    const packagePaths = read('scripts/deploy-kvm4-verify-server.sh').split('PACKAGE_PATHS=(')[1].split(')')[0].trim().split(/\s+/);
    for (const directory of ['server', 'js', 'docs', 'supabase']) assert.ok(packagePaths.includes(directory), directory);
    const dockerfile = read('deploy/kvm4/verify-server.Dockerfile');
    for (const directory of ['server', 'js', 'docs', 'supabase']) assert.ok(dockerfile.includes(`COPY ${directory} ./${directory}`), directory);
    assert.match(read('api/admin.js'), /supplier-catalog/);
});
