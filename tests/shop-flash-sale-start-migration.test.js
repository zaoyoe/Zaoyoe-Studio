'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION_PATH = path.join(ROOT, 'supabase/migrations/20260923_shop_flash_sale_start.sql');
const VERIFY_PATH = path.join(ROOT, 'supabase/migrations/20260923_verify_shop_flash_sale_start.sql');
const ADMIN_MUTATE_PATH = path.join(ROOT, 'server/api-handlers/admin/shop/mutate.js');
const SHOP_PAGE_PATH = path.join(ROOT, 'shop.html');
const ADMIN_STUDIO_PAGE_PATH = path.join(ROOT, 'admin-studio.html');
const LEGACY_SHOP_PAGE_PATH = path.join(ROOT, 'index_old.html');
const EXPECTED_FLASH_WINDOW_CONSTRAINT = 'check((((flash_sale_startisnull)or((flash_sale_priceisnotnull)and(flash_sale_endisnotnull)and(flash_sale_start<flash_sale_end)))and((flash_sale_start_intlisnull)or((flash_sale_price_intlisnotnull)and(flash_sale_end_intlisnotnull)and(flash_sale_start_intl<flash_sale_end_intl)))))';
const EXPECTED_GUEST_ORDER_RESOLVER_ARGS = 'v_site,v_sku.price_points,v_sku.price_points_intl,coalesce(v_sku.is_default,false),v_sku.quantity_rules,v_sku.quantity_rules_intl,v_product.quantity_rules,v_product.quantity_rules_intl,v_product.flash_sale_price,v_product.flash_sale_price_intl,v_product.flash_sale_end,v_product.flash_sale_end_intl,v_quantity,v_now,v_product.flash_sale_start,v_product.flash_sale_start_intl';

const migration = fs.readFileSync(MIGRATION_PATH, 'utf8');
const verify = fs.readFileSync(VERIFY_PATH, 'utf8');
const adminMutate = fs.readFileSync(ADMIN_MUTATE_PATH, 'utf8');
const shopPage = fs.readFileSync(SHOP_PAGE_PATH, 'utf8');
const adminStudioPage = fs.readFileSync(ADMIN_STUDIO_PAGE_PATH, 'utf8');
const legacyShopPage = fs.readFileSync(LEGACY_SHOP_PAGE_PATH, 'utf8');

function assertScriptCacheVersion(html, scriptPath, label) {
    const escapedPath = scriptPath.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const scriptTag = new RegExp(`<script\\b[^>]*\\bsrc=["'](?:\\./)?${escapedPath}\\?([^"']*)["'][^>]*>`, 'iu');
    const match = html.match(scriptTag);

    assert.ok(match, `${label} should load ${scriptPath} with a versioned URL`);
    assert.ok(
        new URLSearchParams(match[1]).has('flashSaleStart'),
        `${label} should cache-bust ${scriptPath} when the flash-sale start behavior changes`
    );
    assert.equal(
        new URLSearchParams(match[1]).get('flashSaleStart'),
        '20260923_FLASH_SALE_START_1',
        `${label} should use the current flash-sale start cache version`
    );
}

function normalizeGuestOrderResolverArgs(definition) {
    const match = /v_unit_amount\s*:=\s*public[.]guest_shop_resolve_credit_unit_amount_with_start\s*[(]([^;]*)[)][\t\r\n ]*;/iu.exec(definition);
    if (!match) return null;
    return match[1]
        .replace(/--[^\r\n]*/gu, '')
        .replace(/\s+/gu, '')
        .toLowerCase();
}

function normalizeConstraintDefinition(definition) {
    return definition.replace(/\s+/gu, '').toLowerCase();
}

test('scheduled flash-sale migration preserves existing site fallback and NULL-start behavior', () => {
    assert.match(migration, /NULL start is deliberately backward compatible/i);
    assert.match(migration, /CN fallback applies only when both INTL fields are unset/i);
    assert.doesNotMatch(migration, /CN and INTL schedules are isolated/i);
    assert.match(migration, /flash_sale_start_intl TIMESTAMPTZ/);
    assert.match(migration, /v_flash_start IS NULL OR v_flash_start <= v_now/);
});

test('dynamic migration replacement accepts only one complete old or new fragment', () => {
    assert.match(migration, /v_new_count :=[\s\S]*v_old_only_count :=/);
    assert.match(migration, /v_new_count = 1 AND v_old_only_count = 0/);
    assert.match(migration, /v_old_only_count = 1 AND v_new_count = 0/);
    assert.match(migration, /old_remaining=%, new=%/);
    assert.match(migration, /p_new IS NULL OR p_new = ''/);
});

test('migration fails on a same-named constraint with the wrong definition', () => {
    assert.match(migration, /CREATE TEMP TABLE shop_flash_sale_constraint_expected/);
    assert.match(migration, /pg_get_constraintdef\(c\.oid, false\)/);
    assert.match(migration, /v_existing_definition <> v_expected_definition/);
    assert.match(migration, /VALIDATE CONSTRAINT shop_products_flash_sale_window_check/);
});

test('flash-sale verifier matches PostgreSQL constraint output and reports validation separately', () => {
    const postgresConstraintDefinition = `CHECK ((((flash_sale_start IS NULL) OR ((flash_sale_price IS NOT NULL) AND (flash_sale_end IS NOT NULL) AND (flash_sale_start < flash_sale_end))) AND ((flash_sale_start_intl IS NULL) OR ((flash_sale_price_intl IS NOT NULL) AND (flash_sale_end_intl IS NOT NULL) AND (flash_sale_start_intl < flash_sale_end_intl)))))`;

    assert.equal(normalizeConstraintDefinition(postgresConstraintDefinition), EXPECTED_FLASH_WINDOW_CONSTRAINT);
    assert.match(verify, /'validated_window_constraint'/);
    assert.match(verify, /constraint_validated/);
    assert.match(verify, /'window_constraint_definition'/);
    assert.match(verify, /normalized_definition = expected_definition/);
});

test('scheduled flash-sale verifier is read-only and covers schema, ACL, order binding, and timing boundaries', () => {
    const executableSql = verify
        .replace(/'(?:''|[^'])*'/gu, "''")
        .replace(/--[^\n]*/gu, '')
        .trim();
    assert.match(executableSql, /^WITH\b/i);
    assert.doesNotMatch(executableSql, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|CALL)\b/iu);
    assert.doesNotMatch(executableSql, /\b(?:public\.)?fn_guest_shop_create_order\s*\(/iu);
    assert.match(verify, /flash_sale_start_intl/);
    assert.match(verify, /has_function_privilege\('service_role'/);
    assert.match(verify, /has_function_privilege\('anon'/);
    assert.match(verify, /has_function_privilege\('authenticated'/);
    assert.match(verify, /guest_shop_resolve_credit_unit_amount_with_start/);
    assert.match(verify, /guest_shop_create_order/);
    assert.match(verify, /regexp_replace\(lower\(pg_get_constraintdef\(c\.oid, false\)\), '\[\[:space:\]\]\+', '', 'g'\)/);
    assert.doesNotMatch(verify, /\[\[:space:\]\(\)\]/);
    assert.ok(verify.toLowerCase().includes(EXPECTED_FLASH_WINDOW_CONSTRAINT));
    assert.equal((migration.match(/v_effective_flash_sale_start <= clock_timestamp\(\)/gu) || []).length, 2);
    assert.equal((verify.match(/v_effective_flash_sale_start <= clock_timestamp\(\)/gu) || []).length, 2);
    for (const definition of ['preview_definition', 'purchase_definition']) {
        for (const [site, start, end, price] of [
            ['CN', 'flash_sale_start', 'flash_sale_end', 'flash_sale_price'],
            ['INTL', 'flash_sale_start_intl', 'flash_sale_end_intl', 'flash_sale_price_intl']
        ]) {
            assert.ok(verify.includes(`${definition} ILIKE '%v_effective_flash_sale_end := v_product.${end}%'`), `${definition} must verify ${site} end mapping`);
            assert.ok(verify.includes(`${definition} ILIKE '%v_effective_flash_sale_start := v_product.${start}%'`), `${definition} must verify ${site} start mapping`);
            assert.ok(verify.includes(`${definition} ILIKE '%v_effective_flash_sale_price := v_product.${price}%'`), `${definition} must verify ${site} price mapping`);
        }
    }
    assert.match(verify, /guest_order_resolver_args_normalized AS/);
    assert.match(verify, /regexp_match\(/);
    assert.ok(verify.includes("E'--[^\\\\n]*'"));
    assert.ok(verify.includes(EXPECTED_GUEST_ORDER_RESOLVER_ARGS));
    assert.doesNotMatch(verify, /guest_order_definition\s+~\*/);
    assert.match(verify, /cn_before_start_uses_tier/);
    assert.match(verify, /cn_start_is_inclusive/);
    assert.match(verify, /cn_end_is_exclusive/);
    assert.match(verify, /null_start_preserves_immediate_flash/);
    assert.match(verify, /intl_price_only_uses_intl_tier_not_cn_flash/);
    assert.match(verify, /intl_end_only_uses_intl_tier_not_cn_flash/);
    assert.match(verify, /intl_start_alone_falls_back_to_cn_schedule/);
});

test('guest-order resolver verification rejects missing, reordered, and extra arguments', () => {
    const definitionFor = (args) => `v_unit_amount := public.guest_shop_resolve_credit_unit_amount_with_start(\n${args}\n);`;
    const validArguments = `
        v_site,
        v_sku.price_points,
        v_sku.price_points_intl,
        COALESCE(v_sku.is_default, false),
        v_sku.quantity_rules,
        v_sku.quantity_rules_intl,
        v_product.quantity_rules,
        v_product.quantity_rules_intl,
        v_product.flash_sale_price,
        v_product.flash_sale_price_intl,
        v_product.flash_sale_end,
        v_product.flash_sale_end_intl, -- comment between existing end and quantity args
        v_quantity,
        v_now,
        v_product.flash_sale_start,
        v_product.flash_sale_start_intl`;

    assert.equal(normalizeGuestOrderResolverArgs(definitionFor(validArguments)), EXPECTED_GUEST_ORDER_RESOLVER_ARGS);
    assert.notEqual(
        normalizeGuestOrderResolverArgs(definitionFor(validArguments.replace('v_sku.price_points_intl,', ''))),
        EXPECTED_GUEST_ORDER_RESOLVER_ARGS,
        'omitted arguments must fail the complete-call contract'
    );
    assert.notEqual(
        normalizeGuestOrderResolverArgs(definitionFor(validArguments.replace(
            'v_product.flash_sale_end,\n        v_product.flash_sale_end_intl',
            'v_product.flash_sale_end_intl,\n        v_product.flash_sale_end'
        ))),
        EXPECTED_GUEST_ORDER_RESOLVER_ARGS,
        'reordered arguments must fail the complete-call contract'
    );
    assert.notEqual(
        normalizeGuestOrderResolverArgs(definitionFor(`${validArguments}, true`)),
        EXPECTED_GUEST_ORDER_RESOLVER_ARGS,
        'extra arguments must fail the complete-call contract'
    );
});

test('admin product save returns a migration-required error for configured flash starts', () => {
    assert.match(adminMutate, /requiredMigrationMissingFields\?\.length/);
    assert.match(adminMutate, /shop_flash_sale_start_migration_required/);
    assert.match(adminMutate, /20260923_shop_flash_sale_start\.sql/);
});

test('all public and admin entry points cache-bust scripts that implement scheduled flash sales', () => {
    assertScriptCacheVersion(shopPage, 'js/shop-client.js', 'shop.html');
    assertScriptCacheVersion(shopPage, 'js/guest-shop-client.js', 'shop.html');
    assertScriptCacheVersion(adminStudioPage, 'js/admin-shop.js', 'admin-studio.html');
    assertScriptCacheVersion(legacyShopPage, 'js/shop-client.js', 'index_old.html');
});
