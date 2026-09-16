'use strict';


const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const CREDIT_PRICING_PATH = path.join(
    REPO_ROOT,
    'supabase',
    'migrations',
    '20260915_guest_shop_credit_pricing.sql'
);
const CREDIT_PRICING_VERIFY_PATH = path.join(
    REPO_ROOT,
    'supabase',
    'migrations',
    '20260915_verify_guest_shop_credit_pricing.sql'
);
const HISTORICAL_ATOMIC_RPCS_PATH = path.join(
    REPO_ROOT,
    'supabase',
    'migrations',
    '20260913_guest_shop_atomic_rpcs.sql'
);

const INTL_FALLBACK_PATH = path.join(
    REPO_ROOT,
    'supabase',
    'migrations',
    '20260916_guest_shop_intl_credit_fallback.sql'
);
const INTL_FALLBACK_VERIFY_PATH = path.join(
    REPO_ROOT,
    'supabase',
    'migrations',
    '20260916_verify_guest_shop_intl_credit_fallback.sql'
);

const HELPER_IDENTITY = [
    'TEXT',
    'NUMERIC',
    'NUMERIC',
    'BOOLEAN',
    'JSONB',
    'JSONB',
    'JSONB',
    'JSONB',
    'NUMERIC',
    'NUMERIC',
    'TIMESTAMP WITH TIME ZONE',
    'TIMESTAMP WITH TIME ZONE',
    'INTEGER',
    'TIMESTAMP WITH TIME ZONE'
].join(', ');

const CREATE_ORDER_IDENTITY = [
    'TEXT',
    'UUID',
    'UUID',
    'TEXT',
    'TEXT',
    'TEXT',
    'TEXT',
    'TEXT',
    'TEXT',
    'TEXT',
    'TEXT',
    'INTEGER'
].join(', ');

function readSql(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function functionBlock(sql, name) {
    const start = sql.search(new RegExp(
        `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\(`,
        'i'
    ));
    assert.notEqual(start, -1, `missing ${name} definition`);
    const end = sql.indexOf('$$;', start);
    assert.notEqual(end, -1, `${name} should have a dollar-quoted body`);
    return sql.slice(start, end + 3);
}

test('credit-pricing migration is additive and never drops tables or historical guest cash columns', () => {
    const sql = readSql(CREDIT_PRICING_PATH);
    const verify = readSql(CREDIT_PRICING_VERIFY_PATH);
    const historical = readSql(HISTORICAL_ATOMIC_RPCS_PATH);

    assert.match(sql, /Codex does not execute this file/i);
    assert.match(verify, /Codex does not execute this file/i);
    assert.doesNotMatch(sql, /\bDROP\s+(?:TABLE|SCHEMA|DATABASE)\b/i);
    assert.doesNotMatch(sql, /\bDROP\s+FUNCTION\b[^;]*\bCASCADE\b/i);
    assert.doesNotMatch(sql, /\bDROP\s+COLUMN\b/i);
    assert.doesNotMatch(sql, /guest_purchase_enabled\s*=\s*true/i);
    assert.doesNotMatch(sql, /SET\s+allow_guest_purchase\s*=\s*(?:TRUE|true)/i);
    assert.doesNotMatch(sql, /UPDATE\s+public\.(?:shop_products|shop_product_skus)[\s\S]{0,240}allow_guest_purchase/i);
    assert.doesNotMatch(sql, /fn_purchase_shop_item|payment_checkout_sessions|rechargePointsForPayment/i);
    assert.doesNotMatch(verify, /^\s*(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/im);
    assert.match(historical, /guest_cash_price/i);
    assert.doesNotMatch(sql, /ALTER\s+TABLE[\s\S]{0,400}DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+guest_shop_payment_events_observed_currency_check/i);
});

test('credit helper is STABLE invoker with pinned search_path and service_role-only execute', () => {
    const sql = readSql(CREDIT_PRICING_PATH);
    const helper = functionBlock(sql, 'guest_shop_resolve_credit_unit_amount');

    assert.match(helper, /LANGUAGE\s+plpgsql\s+STABLE/i);
    assert.match(helper, /SECURITY\s+INVOKER/i);
    assert.doesNotMatch(helper, /SECURITY\s+DEFINER/i);
    assert.match(helper, /SET\s+search_path\s*=\s*public\s*,\s*pg_temp/i);
    assert.match(helper, /p_quantity\s+IS\s+DISTINCT\s+FROM\s+1/i);
    assert.match(helper, /LEAST\s*\(/i);
    assert.match(helper, /p_sku_price_points/i);
    assert.match(helper, /p_sku_price_points_intl/i);
    assert.doesNotMatch(helper, /guest_cash_price/i);
    assert.doesNotMatch(helper, /p_product_price_points/i);
    assert.match(
        sql,
        new RegExp(
            `REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.guest_shop_resolve_credit_unit_amount\\s*\\(\\s*${HELPER_IDENTITY}\\s*\\)\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated`,
            'i'
        )
    );
    assert.match(
        sql,
        new RegExp(
            `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.guest_shop_resolve_credit_unit_amount\\s*\\(\\s*${HELPER_IDENTITY}\\s*\\)\\s+TO\\s+service_role`,
            'i'
        )
    );
});

test('create-order replacement settles CNY from credit helper and never accepts a client amount', () => {
    const sql = readSql(CREDIT_PRICING_PATH);
    const create = functionBlock(sql, 'fn_guest_shop_create_order');

    assert.match(create, /SECURITY\s+DEFINER[\s\S]*?SET\s+search_path\s*=\s*public\s*,\s*pg_temp/i);
    assert.match(create, /v_currency\s*:=\s*'CNY'/i);
    assert.match(create, /guest_shop_resolve_credit_unit_amount\s*\(/i);
    assert.match(create, /RAISE\s+EXCEPTION\s+'guest_credit_price_unavailable'/i);
    assert.doesNotMatch(create, /guest_cash_price/i);
    assert.doesNotMatch(create, /p_(?:unit_)?amount\s+NUMERIC|p_price\s+NUMERIC|p_total_amount\s+NUMERIC/i);
    assert.match(sql, /guest_shop_orders_currency_check[\s\S]*CHECK\s*\(\s*currency\s*=\s*'CNY'\s*\)/i);
    assert.match(sql, /site\s*=\s*'intl'\s+AND\s+currency\s*=\s*'CNY'/i);
    assert.match(sql, /guest_shop_non_cny_rows_exist/i);
    assert.match(
        sql,
        new RegExp(
            `REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.fn_guest_shop_create_order\\s*\\(\\s*${CREATE_ORDER_IDENTITY}\\s*\\)\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated`,
            'i'
        )
    );
    assert.match(
        sql,
        new RegExp(
            `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.fn_guest_shop_create_order\\s*\\(\\s*${CREATE_ORDER_IDENTITY}\\s*\\)\\s+TO\\s+service_role`,
            'i'
        )
    );
});

test('credit-pricing verifier resolves functions by regprocedure, keeps leftover cash columns, and still allows observed USD quotes', () => {
    const verify = readSql(CREDIT_PRICING_VERIFY_PATH);

    assert.match(
        verify,
        /to_regprocedure\(\s*format\('public\.%I\(%s\)'/i
    );
    assert.doesNotMatch(
        verify,
        /pg_get_function_identity_arguments\(p\.oid\)\s*=\s*e\.identity_args/i
    );
    assert.match(
        verify,
        /text, numeric, numeric, boolean, jsonb, jsonb, jsonb, jsonb, numeric, numeric, timestamp with time zone, timestamp with time zone, integer, timestamp with time zone/
    );
    assert.match(
        verify,
        /text, uuid, uuid, text, text, text, text, text, text, text, text, integer/
    );
    assert.match(verify, /guest_shop_resolve_credit_unit_amount/i);
    assert.match(verify, /fn_guest_shop_create_order/i);
    assert.match(verify, /leftover_cash_price_columns_kept/i);
    assert.match(verify, /present_count',\s*4/i);
    assert.match(verify, /events_observed_still_allows_usd/i);
    assert.match(verify, /orders_currency_is_cny/i);
    assert.match(verify, /payments_currency_is_cny/i);
    assert.match(verify, /guest_shop_payment_events_observed_currency_check/i);
    assert.match(verify, /pg_get_constraintdef\(\) emits \(currency\)::text/i);
    assert.ok(verify.includes("~* 'currency(\\))?(::text)?\\s*=\\s*''CNY'''"));
    assert.doesNotMatch(verify, /ILIKE\s+'%site = ''intl'' AND currency = ''CNY''%'/i);
    assert.match(verify, /~\*\s+'''USD'''/);
    assert.match(verify, /no_non_cny_settlement_rows/i);
    assert.match(verify, /guest_products_remain_disabled_or_review/i);
    assert.match(verify, /service_role/i);
    assert.match(verify, /provolatile/i);
});

test('intl fallback migration only replaces the helper and reuses CN SKU points', () => {
    const sql = readSql(INTL_FALLBACK_PATH);
    const verify = readSql(INTL_FALLBACK_VERIFY_PATH);
    const helper = functionBlock(sql, 'guest_shop_resolve_credit_unit_amount');

    assert.match(sql, /Codex does not execute this file/i);
    assert.match(verify, /Codex does not execute this file/i);
    assert.doesNotMatch(sql, /\bDROP\s+(?:TABLE|SCHEMA|DATABASE)\b/i);
    assert.doesNotMatch(sql, /\bDROP\s+FUNCTION\b/i);
    assert.doesNotMatch(sql, /\bDROP\s+COLUMN\b/i);
    assert.doesNotMatch(sql, /fn_guest_shop_create_order/i);
    assert.doesNotMatch(sql, /guest_purchase_enabled\s*=\s*true/i);
    assert.doesNotMatch(sql, /SET\s+allow_guest_purchase\s*=\s*(?:TRUE|true)/i);
    assert.doesNotMatch(sql, /UPDATE\s+public\.(?:shop_products|shop_product_skus)[\s\S]{0,240}allow_guest_purchase/i);
    assert.doesNotMatch(verify, /^\s*(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/im);

    assert.match(helper, /LANGUAGE\s+plpgsql\s+STABLE/i);
    assert.match(helper, /SECURITY\s+INVOKER/i);
    assert.match(helper, /intl_missing_points_reuse_cn/i);
    assert.match(helper, /v_base\s*:=\s*p_sku_price_points_intl/i);
    assert.match(helper, /v_base\s*:=\s*p_sku_price_points/i);
    assert.match(helper, /COALESCE\s*\(\s*v_intl_rules\s*,\s*v_cn_rules\s*\)/i);
    assert.doesNotMatch(helper, /p_product_price_points/i);
    assert.doesNotMatch(helper, /guest_cash_price/i);
    assert.match(
        sql,
        new RegExp(
            `REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.guest_shop_resolve_credit_unit_amount\\s*\\(\\s*${HELPER_IDENTITY}\\s*\\)\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated`,
            'i'
        )
    );
    assert.match(
        sql,
        new RegExp(
            `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.guest_shop_resolve_credit_unit_amount\\s*\\(\\s*${HELPER_IDENTITY}\\s*\\)\\s+TO\\s+service_role`,
            'i'
        )
    );
});

test('intl fallback verifier is read-only and requires CN SKU reuse without product-price fallback', () => {
    const verify = readSql(INTL_FALLBACK_VERIFY_PATH);
    assert.match(verify, /to_regprocedure\(\s*'public\.guest_shop_resolve_credit_unit_amount\(/i);
    assert.match(verify, /intl_missing_points_reuse_cn/i);
    assert.match(verify, /assigns_intl_first/i);
    assert.match(verify, /reuses_cn_points/i);
    assert.match(verify, /no_product_price_fallback/i);
    assert.match(verify, /service_role/i);
    assert.doesNotMatch(verify, /SET\s+allow_guest_purchase/i);
});
