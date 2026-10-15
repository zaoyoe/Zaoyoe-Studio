'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Funds-safety source contracts only. No database connection or SQL execution.
const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261015_tg_purchase_domain.sql'), 'utf8');
const verify = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261015_verify_tg_stars_purchase_domain.sql'), 'utf8');
const stars = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261015_tg_stars_redemption.sql'), 'utf8');
const functions = Array.from(migration.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(([^$]*?)\)\nRETURNS[\s\S]*?\n\$\$;/g), (match) => ({ name: match[1], args: match[2], definition: match[0] }));
const get = (name) => { const fn = functions.find((item) => item.name === name); assert.ok(fn, `missing ${name}`); return fn.definition; };
const contains = (source, fragments) => fragments.forEach((fragment) => assert.ok(source.includes(fragment), `missing safety contract: ${fragment}`));

// Verify behavior at the domain boundary: immutable buyer confirmation,
// signed payment identity, exactly one submission, and independent delivery.
test('purchase schema is an additive isolated transaction with unpriced disabled catalog seeds', () => {
    assert.match(migration, /^BEGIN;$/m);
    assert.match(migration, /\nCOMMIT;\s*$/);
    assert.ok(migration.lastIndexOf('DO $$') < migration.lastIndexOf('COMMIT;'));
    assert.doesNotMatch(migration, /^\s*(?:DROP TABLE|TRUNCATE|DELETE FROM)\b/im);
    assert.doesNotMatch(migration, /(?:INSERT INTO|UPDATE|ALTER TABLE) public\.(?:shop_|wallet|payment_orders)/i);
    contains(migration, [
        'enabled BOOLEAN NOT NULL DEFAULT false', 'price_minor BIGINT,', 'unit_price_micros BIGINT,',
        'INSERT INTO public.tg_purchase_products (product_key, product_family, term_months)',
        "('premium_3', 'telegram_premium', 3)", "('premium_6', 'telegram_premium', 6)",
        "('premium_12', 'telegram_premium', 12)", "('stars', 'telegram_stars', NULL)",
        'ON CONFLICT (product_key) DO NOTHING'
    ]);
    assert.doesNotMatch(migration, /SET enabled\s*=\s*true/i);
});

test('one fixed Premium entitlement or an exact bounded Stars quantity determines the integer price', () => {
    contains(migration, [
        "product_key = 'premium_' || term_months::TEXT AND stars_quantity IS NULL",
        "product_family = 'telegram_stars' AND product_key = 'stars' AND term_months IS NULL",
        'stars_quantity IS NOT NULL AND stars_quantity BETWEEN 50 AND 1000000',
        'total_minor = ceil(unit_price_micros::NUMERIC * stars_quantity / 10000)::BIGINT'
    ]);
    const quote = get('fn_tg_purchase_quote');
    contains(quote, [
        'p_stars_quantity IS NULL', 'p_stars_quantity BETWEEN 50 AND 1000000',
        'p_stars_quantity < v_product.min_stars OR p_stars_quantity > v_product.max_stars',
        'ceil(v_product.unit_price_micros::NUMERIC * p_stars_quantity / 10000)',
        'v_total IS NULL OR v_total < 1 OR v_total > 100000000',
        "now() + interval '10 minutes'", 'FOR SHARE;'
    ]);
    const update = get('fn_tg_update_price');
    contains(update, ['p_expected_version BIGINT', 'FOR UPDATE;',
        'v_product.price_version IS DISTINCT FROM p_expected_version', "'code', 'version_conflict'",
        'enabled = p_sale_enabled']);
});

test('purchase is persisted only after quote, buyer, product, Stars count, total and version agree', () => {
    const create = get('fn_tg_create_purchase');
    contains(create, ['p_expected_stars_quantity BIGINT', 'pg_advisory_xact_lock',
        'WHERE idempotency_key_hash = p_idempotency_key_hash', 'FOR UPDATE;', 'FOR SHARE;',
        "'code', 'quote_expired'", "'code', 'quote_already_used'", "'code', 'quote_stale'",
        "'code', 'quote_mismatch'", "'code', 'idempotency_conflict'",
        "p_expected_product_key <> 'stars' AND p_expected_stars_quantity IS NOT NULL"]);
    for (const [field, param] of [['product_key', 'product_key'], ['telegram_username', 'username'],
        ['total_minor', 'total_minor'], ['price_version', 'price_version'], ['stars_quantity', 'stars_quantity']]) {
        for (const target of ['v_quote', 'v_order']) assert.ok(create.includes(`${target}.${field} IS DISTINCT FROM p_expected_${param}`));
    }
    assert.ok(create.indexOf("'code', 'quote_mismatch'") < create.indexOf('INSERT INTO public.tg_purchase_orders'));
    assert.ok(create.indexOf("'code', 'quote_stale'") < create.indexOf('INSERT INTO public.tg_purchase_orders'));
});

test('immutable quote and purchase triggers prevent changing a payable order recipient, price or merchant', () => {
    const guard = get('tg_guard_purchase_identity');
    contains(guard, [
        "TG_TABLE_NAME = 'tg_purchase_quotes'", 'TG quote snapshot is immutable',
        'NEW.telegram_username IS DISTINCT FROM OLD.telegram_username',
        'NEW.stars_quantity IS DISTINCT FROM OLD.stars_quantity', 'NEW.total_minor IS DISTINCT FROM OLD.total_minor',
        'NEW.currency IS DISTINCT FROM OLD.currency', 'NEW.payment_provider IS DISTINCT FROM OLD.payment_provider',
        'NEW.payment_merchant_id IS DISTINCT FROM OLD.payment_merchant_id', 'NEW.payment_channel IS DISTINCT FROM OLD.payment_channel',
        'NEW.status_token_hash IS DISTINCT FROM OLD.status_token_hash',
        'NEW.idempotency_key_hash IS DISTINCT FROM OLD.idempotency_key_hash',
        'NEW.payment_expires_at IS DISTINCT FROM OLD.payment_expires_at',
        "OLD.payment_status = 'paid'", 'TG verified payment cannot be reversed',
        'TG payment trade identity is immutable', 'TG purchase does not match immutable quote'
    ]);
});

test('checkout leases never repeat an ambiguous payment-create call', () => {
    const claim = get('fn_tg_claim_purchase_checkout');
    contains(claim, [
        'FOR UPDATE;', 'v_order.checkout_lease_expires_at > now()', "'action', 'busy'",
        'IF v_order.checkout_started_at IS NOT NULL THEN', "last_error_code = 'checkout_result_unknown'",
        "payment_status = 'manual_review'", "SET payment_status = 'checkout_creating', checkout_started_at = now()",
        'v_order.payment_expires_at <= now()'
    ]);
    assert.ok(claim.indexOf('IF v_order.checkout_started_at IS NOT NULL THEN') < claim.indexOf("SET payment_status = 'checkout_creating'"));
    contains(get('fn_tg_save_purchase_checkout'), [
        'pg_advisory_xact_lock', 'FOR UPDATE;', 'v_order.checkout_lease_token IS DISTINCT FROM p_lease_token',
        'v_order.checkout_lease_expires_at <= now()', "v_order.payment_status <> 'checkout_creating'",
        'payment_trade_conflict', "v_order.payment_status = 'paid'"
    ]);
    contains(get('fn_tg_fail_purchase_checkout'), ["payment_status = 'manual_review'", "payment_status = 'checkout_creating'"]);
});

test('signed notify must bind order, merchant, trade, channel, amount and currency before creating fulfillment', () => {
    const confirm = get('fn_tg_confirm_purchase_payment');
    contains(confirm, [
        "p_provider IS DISTINCT FROM 'zpay'", "p_verified_payload->>'verified_by' IS DISTINCT FROM 'signed_notify'",
        "p_verified_payload->>'event_status' IS DISTINCT FROM 'paid'", 'pg_advisory_xact_lock', 'FOR UPDATE;',
        'v_order.payment_provider IS DISTINCT FROM p_provider', 'v_order.payment_merchant_id IS DISTINCT FROM p_merchant_id',
        'v_order.payment_channel IS DISTINCT FROM p_payment_channel', 'v_order.total_minor IS DISTINCT FROM p_amount_minor',
        'v_order.currency IS DISTINCT FROM p_currency', 'v_order.checkout_started_at IS NULL',
        'v_order.provider_trade_no IS DISTINCT FROM p_provider_trade_no',
        "v_order.payment_status = 'paid' OR v_order.paid_at IS NOT NULL", 'payment_received_after_expiry',
        'INSERT INTO public.tg_redemption_orders(order_no, order_source, purchase_id, code_id',
        "'purchase', v_order.id, NULL", "encode(sha256(convert_to('tg-purchase:' || v_order.id::TEXT, 'UTF8')), 'hex')",
        "'tg-purchase-' || replace(v_order.id::TEXT, '-', '')"
    ]);
    assert.ok(confirm.indexOf("'code', 'payment_binding_mismatch'") < confirm.indexOf('INSERT INTO public.tg_redemption_orders'));
    assert.ok(confirm.indexOf('payment_received_after_expiry') < confirm.indexOf('INSERT INTO public.tg_redemption_orders'));
    assert.doesNotMatch(confirm, /UPDATE public\.tg_redemption_codes/);
    contains(migration, ["payment_merchant_id ~ '^[0-9]{1,32}$'", 'CREATE UNIQUE INDEX IF NOT EXISTS idx_tg_purchase_orders_provider_trade']);
});

test('cash and redemption source identities cannot overlap or change after creation', () => {
    contains(migration, [
        "order_source TEXT NOT NULL DEFAULT 'redemption'", 'ALTER COLUMN code_id DROP NOT NULL',
        "order_source = 'redemption' AND code_id IS NOT NULL AND purchase_id IS NULL",
        "order_source = 'purchase' AND code_id IS NULL AND purchase_id IS NOT NULL",
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_tg_redemption_orders_purchase'
    ]);
    contains(get('tg_guard_entitlement_identity'), [
        'NEW.order_source IS DISTINCT FROM OLD.order_source', 'NEW.purchase_id IS DISTINCT FROM OLD.purchase_id',
        'NEW.telegram_username IS DISTINCT FROM OLD.telegram_username',
        'NEW.provider_idempotency_key IS DISTINCT FROM OLD.provider_idempotency_key',
        "v_purchase.payment_status <> 'paid'", 'TG fulfillment does not match paid purchase',
        'NEW.product_family IS DISTINCT FROM v_purchase.product_family', 'NEW.term_months IS DISTINCT FROM v_purchase.term_months',
        'NEW.stars_quantity IS DISTINCT FROM v_purchase.stars_quantity', 'NEW.telegram_username IS DISTINCT FROM v_purchase.telegram_username',
        'TG order entitlement does not match its code batch'
    ]);
});

test('status token is checked before locking and only normal unpaid orders expire', () => {
    const status = get('fn_tg_purchase_status');
    contains(status, ['WHERE order_no = trim(p_order_no) AND status_token_hash = lower(trim(p_status_token_hash)) FOR UPDATE;',
        "v_order.payment_status = 'awaiting_payment' AND v_order.paid_at IS NULL",
        'v_order.payment_expires_at <= now()', "SET payment_status = 'expired'", "'code', 'not_found'"]);
    contains(status, ["v_order.payment_status = 'checkout_creating' AND v_order.paid_at IS NULL",
        'v_order.checkout_lease_expires_at <= now()', "payment_status = 'manual_review'", "last_error_code = 'checkout_result_unknown'",
        'checkout_lease_token = NULL, checkout_lease_expires_at = NULL']);
    assert.equal((status.match(/UPDATE public\.tg_purchase_orders/g) || []).length, 2);
    assert.doesNotMatch(status, /SET payment_status = '(?:paid|awaiting_payment|checkout_creating)'/);
});

test('claim needs explicit product/source capabilities, a paid purchase and a never-submitted first attempt to buy', () => {
    const claim = get('fn_tg_claim_fulfillment_order');
    contains(claim, [
        'p_product_families TEXT[]', 'p_order_sources TEXT[]', 'cardinality(p_order_sources) = 0',
        'array_position(p_order_sources, NULL) IS NOT NULL', "ARRAY['redemption', 'purchase']::TEXT[]",
        "ARRAY['telegram_premium', 'telegram_stars']::TEXT[]", 'public.fn_tg_claim_order(p_order_id, p_lease_token, p_lease_seconds, p_product_families)',
        "p.payment_status = 'paid' AND p.paid_at IS NOT NULL", 'FOR UPDATE OF p SKIP LOCKED', 'FOR UPDATE SKIP LOCKED',
        'v_order.stars_quantity IS DISTINCT FROM v_purchase.stars_quantity',
        'v_order.telegram_username IS DISTINCT FROM v_purchase.telegram_username',
        "v_order.status = 'pending' AND v_order.provider_order_id IS NULL AND v_order.submitted_at IS NULL",
        'v_order.provider_payment_currency IS NULL AND v_order.attempt_count = 0',
        'NOT EXISTS (SELECT 1 FROM public.tg_fulfillment_attempts WHERE order_id = v_order.id)',
        "v_order.provider_order_id IS NOT NULL AND v_order.provider_payment_currency IN ('gram', 'usdt')",
        "v_action := 'poll'", 'provider_result_unknown', "SET status = 'manual_review'"
    ]);
    assert.ok(claim.indexOf('FOR UPDATE OF p SKIP LOCKED') < claim.indexOf('FOR UPDATE SKIP LOCKED'));
    assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION public\.fn_tg_(?:claim_order|mark_submitted)\(/);
    assert.match(stars, /o\.submitted_at IS NULL AND o\.provider_order_id IS NULL/);
});

test('finish preserves independent GET and exact recipient, product, quantity and saved-currency verification for both sources', () => {
    const finish = get('fn_tg_finish_order');
    contains(finish, [
        "v_source = 'redemption' AND v_code_id IS NOT NULL AND v_purchase_id IS NULL",
        "v_source = 'purchase' AND v_code_id IS NULL AND v_purchase_id IS NOT NULL",
        'SELECT * INTO v_purchase FROM public.tg_purchase_orders WHERE id = v_purchase_id FOR UPDATE;',
        'SELECT * INTO v_code FROM public.tg_redemption_codes WHERE id = v_code_id FOR UPDATE;',
        'SELECT * INTO v_order FROM public.tg_redemption_orders WHERE id = p_order_id FOR UPDATE;',
        "v_order.lease_token IS DISTINCT FROM p_lease_token OR v_order.status <> 'processing'",
        "v_purchase.payment_status <> 'paid' OR v_purchase.paid_at IS NULL", 'purchase_binding_conflict', 'entitlement_binding_conflict',
        'v_order.product_family IS DISTINCT FROM v_purchase.product_family', 'v_order.term_months IS DISTINCT FROM v_purchase.term_months',
        'v_order.stars_quantity IS DISTINCT FROM v_purchase.stars_quantity', 'v_order.telegram_username IS DISTINCT FROM v_purchase.telegram_username',
        'FROM jsonb_each(p_provider_snapshot) e', 'WHERE e.key IN (',
        "v_snapshot->>'verified_by' = 'order_get'", "v_snapshot->>'method' = 'api'",
        "v_snapshot->>'provider_order_id' = v_provider_id", "v_snapshot->'completed' = 'true'::JSONB",
        "v_snapshot->>'provider_status' = 'completed'", "v_snapshot->>'currency' = CASE v_order.provider_payment_currency",
        "WHEN 'gram' THEN 'gram' WHEN 'usdt' THEN 'usd' ELSE NULL END",
        "v_snapshot->>'stars_quantity' = v_order.stars_quantity::TEXT", "jsonb_typeof(v_snapshot->'stars_quantity') = 'number'",
        "v_snapshot->>'product_type' = 'stars'", "v_snapshot->>'product_family' = 'telegram_stars'",
        "v_snapshot->>'term_months' = v_order.term_months::TEXT", "v_snapshot->>'product_type' = 'premium_' || v_order.term_months::TEXT || '_month'",
        "lower(regexp_replace(coalesce(v_snapshot->>'telegram_username', ''), '^@', '')) = v_order.telegram_username",
        "coalesce(v_snapshot->'idempotency_key_matches', 'true'::JSONB) <> 'false'::JSONB"
    ]);
    assert.ok(finish.indexOf('SELECT * INTO v_purchase') < finish.indexOf('SELECT * INTO v_order'));
    const accounting = finish.slice(finish.indexOf('    IF v_source = \'redemption\' THEN\n        UPDATE public.tg_redemption_codes'), finish.indexOf("    INSERT INTO public.tg_audit_events"));
    contains(accounting, ['UPDATE public.tg_redemption_codes', "IF v_state = 'succeeded' THEN", 'UPDATE public.tg_redemption_batches', 'redeemed_count = redeemed_count + 1']);
    assert.doesNotMatch(finish, /status\s*=\s*'available'/);
    assert.doesNotMatch(finish, /UPDATE public\.tg_purchase_orders/);
});

test('administrative purchase projection omits payment credentials and all new surfaces are service-only', () => {
    const view = migration.slice(migration.indexOf('CREATE OR REPLACE VIEW public.tg_purchase_order_stats AS'), migration.indexOf('ALTER TABLE public.tg_purchase_products ENABLE'));
    contains(view, ['p.order_no', 'p.telegram_username', 'p.product_family', 'p.term_months', 'p.stars_quantity',
        'p.currency', 'p.total_minor', 'p.payment_channel', 'p.payment_status', 'AS fulfillment_status',
        'p.created_at', 'p.updated_at', 'AS expires_at', 'p.price_version']);
    assert.doesNotMatch(view, /status_token_hash|idempotency_key_hash|checkout_url|lease_token|verified_payment/);
    for (const table of ['tg_purchase_products', 'tg_purchase_quotes', 'tg_purchase_orders']) {
        assert.ok(migration.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`));
        assert.ok(migration.includes(`REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated;`));
    }
    for (const fn of functions) {
        contains(fn.definition, ['SECURITY DEFINER', 'SET search_path = public, pg_temp']);
        assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn.name}\\([^;]*FROM PUBLIC, anon, authenticated;`));
        if (!fn.name.startsWith('tg_guard_')) assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn.name}\\([^;]*TO service_role;`));
    }
    assert.doesNotMatch(migration, /GRANT (?:EXECUTE|SELECT)[^;]* TO (?:PUBLIC|anon|authenticated)/i);
});

test('eighth SQL repeats the same schema, row-binding, ACL and source-aware guard verification in read-only mode', () => {
    assert.match(verify, /^BEGIN READ ONLY;$/m);
    assert.match(verify, /\nCOMMIT;\s*$/);
    assert.doesNotMatch(verify, /^\s*(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE)\b/im);
    const checks = migration.slice(migration.lastIndexOf('DO $$'), migration.lastIndexOf('\nCOMMIT;'));
    assert.ok(verify.includes(checks));
    contains(checks, [
        'c.relrowsecurity', 'has_table_privilege', 'has_function_privilege', 'aclexplode', 'a.grantee = 0',
        'p.prosecdef', 'search_path=public, pg_temp', 'pg_get_functiondef', 'indisunique AND indisvalid',
        'TG purchase immutable identity triggers missing', 'TG purchase quote/recipient/price binding missing',
        'existing TG purchase or redemption binding mismatch requires manual review',
        'TG Stars and purchase schema, immutable binding, service ACL and single-submission guards verified'
    ]);
});
