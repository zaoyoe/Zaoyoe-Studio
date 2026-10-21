'use strict';
// Offline source evidence only: no SQL execution, database or supplier request.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { replay } = require('./helpers/shop-supplier-native-patch-replay');
const root = path.resolve(__dirname, '..');
const filename = '20261019_shop_supplier_platform_v2_native_checkout.sql';
const sql = fs.readFileSync(path.join(root, 'supabase/migrations', filename), 'utf8');
const verify = fs.readFileSync(path.join(root, 'supabase/migrations/20261019_verify_shop_supplier_platform_v2_native_checkout.sql'), 'utf8');
const before = replay(root, { includeP2b: false });
const after = replay(root);
function body(name) {
    const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    assert.ok(start >= 0, name);
    const end = sql.indexOf('\n$$;', start);
    assert.ok(end > start, name);
    return sql.slice(start, end);
}
function ordered(source, markers) {
    let offset = -1;
    for (const marker of markers) {
        const index = source.indexOf(marker, offset + 1);
        assert.ok(index > offset, `missing or out of order: ${marker}`);
        offset = index;
    }
}

test('P2B replays all 23 checked anchors on the latest seven native definitions', () => {
    const patches = after.evidence.filter(e => e.filename === filename && e.kind === 'patch');
    assert.equal(patches.length, 23);
    assert.equal(Object.keys(after.sources).length, 7);
    assert.equal(patches.filter(e => e.count === 2).length, 1);
    assert.equal(patches.find(e => e.count === 2).label, 'points skip stock selection');
    assert.ok(patches.every(e => e.count >= 1));
    // The latest native wallet-lot patch, not a historical core snapshot, is the baseline.
    assert.match(before.sources.fn_purchase_shop_item_core, /fn_consume_wallet_point_lots_for_shop_order/);
    assert.doesNotMatch(sql, /CREATE OR REPLACE FUNCTION public\.(?:fn_purchase_shop_item_core|fn_guest_shop_create_order|fn_guest_shop_confirm_payment)\(/);
    assert.match(sql, /Supplier P2B patch anchor mismatch/);
});

test('mapped source classification includes disabled and other-site mappings and cannot fall back to stock', () => {
    const source = body('shop_supplier_has_source_v2');
    assert.match(source, /product_id = p_product_id AND sku_id = p_sku_id AND contract_version = 2/);
    assert.doesNotMatch(source, /is_enabled|is_primary|site =/);
    assert.match(body('shop_supplier_checkout_context_v2'), /supplier_checkout_unavailable/);
    assert.match(body('shop_supplier_local_stock_guard_v2'), /guest_shop_checkout_items[\s\S]*shop_supplier_has_source_v2/);
});

test('quotes are private, default off, short lived and owned by a server-derived stable operation', () => {
    assert.match(sql, /checkout_enabled BOOLEAN NOT NULL DEFAULT false/);
    assert.match(sql, /operation_id UUID NOT NULL UNIQUE/);
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
    assert.match(sql, /REVOKE ALL ON TABLE public\.shop_supplier_checkout_quotes FROM PUBLIC, anon, authenticated, service_role/);
    assert.match(sql, /GRANT SELECT ON TABLE public\.shop_supplier_checkout_quotes TO service_role/);
    const quote = body('fn_issue_shop_supplier_quote_v2');
    ordered(quote, ['supplier_service_role_required', 'pg_advisory_xact_lock', 'WHERE operation_id = p_operation_id FOR UPDATE', "v_quote.status <> 'consumed'", "'supplier_quote_expired'", "'quote_id', v_quote.id", 'shop_products']);
    assert.match(quote, /INTERVAL '120 seconds'/);
    assert.match(quote, /native_request_fingerprint IS DISTINCT FROM p_native_request_fingerprint/);
    assert.match(quote, /buyer_user_id IS DISTINCT FROM p_buyer_user_id/);
    assert.match(quote, /guest_owner_hash IS DISTINCT FROM p_guest_owner_hash/);
    assert.doesNotMatch(quote, /upstream_cost|supplier_actual_cost|ON CONFLICT[^;]*DO UPDATE/);
});

test('trusted native context validates the quote, mapping revision and account with a direct policy UPDATE lock', () => {
    const context = body('shop_supplier_checkout_context_v2');
    for (const marker of ["COALESCE(auth.role(), '') <> 'service_role'", "current_setting('app.shop_supplier_quote_v2', true)",
        "v_quote.status <> 'issued'", 'v_quote.expires_at <= clock_timestamp()', 'm.updated_at = v_quote.mapping_revision',
        'm.supplier_account_id = v_quote.supplier_account_id AND a.is_enabled', 'FOR SHARE OF m, a',
        'AND intake_enabled AND checkout_enabled', 'per_unit_cost_ceiling_cny >= v_quote.cost_ceiling_cny FOR UPDATE']) {
        assert.ok(context.includes(marker), marker);
    }
    assert.doesNotMatch(context, /FOR SHARE OF[^;]*\btp\b/);
});

test('points purchase retains native auth, wallet ledger and lot consumption and binds before debit', () => {
    const points = after.sources.fn_purchase_shop_item_core;
    for (const marker of ['v_request_user_id UUID := auth.uid()', 'v_request_role TEXT := COALESCE(auth.role()',
        'INSERT INTO public.points_ledger', 'fn_consume_wallet_point_lots_for_shop_order', "'SHOP_ORDER_' || v_order_id"]) {
        assert.ok(before.sources.fn_purchase_shop_item_core.includes(marker), `baseline: ${marker}`);
        assert.ok(points.includes(marker), `patched: ${marker}`);
    }
    ordered(points, ['shop_supplier_checkout_context_v2(', 'INSERT INTO public.shop_orders',
        'INSERT INTO public.shop_order_items', 'fn_bind_shop_supplier_funding_v2(',
        'INSERT INTO public.points_ledger', 'fn_consume_wallet_point_lots_for_shop_order']);
    assert.match(points, /WHEN v_product\.delivery_type = 'API' OR v_supplier_quote\.id IS NOT NULL THEN 'pending'/);
    assert.match(points, /VALUES \(v_order_id, NULL, v_sku_id, v_product\.name, v_total_price\)/);
    assert.match(points, /IF v_total_price > 0 AND v_supplier_quote\.id IS NULL THEN\s*INSERT INTO public\.shop_purchase_reward_jobs/);
});

test('points wrapper raises on native success:false so partial debit/order writes roll back and replay stays immutable', () => {
    const wrapper = body('fn_purchase_shop_supplier_points_v2');
    ordered(wrapper, ['supplier_service_role_required', 'FOR UPDATE', 'buyer_user_id IS DISTINCT FROM p_buyer_user_id',
        "IF v_quote.status = 'consumed' THEN RETURN v_quote.replay_result", 'set_config(', 'fn_purchase_shop_item_core(',
        "v_result->>'success' IS DISTINCT FROM 'true'", "RAISE EXCEPTION 'supplier_checkout_rejected'",
        "'content', NULL, 'delivery_status', 'pending'", "SET status = 'consumed'"]);
    assert.doesNotMatch(wrapper, /EXCEPTION\s+WHEN|INSERT INTO public\.(?:points_ledger|user_points)/);
});

test('guest wrapper preserves all 15 native arguments and checks stable owner plus consumed replay parameters', () => {
    const wrapper = body('fn_create_shop_supplier_guest_order_v2');
    assert.match(wrapper, /\^hmac-sha256:v\[1-9\]\[0-9\]\{0,5\}:\[a-f0-9\]\{64\}\$/);
    assert.match(wrapper, /guest_owner_hash IS DISTINCT FROM encode\(sha256\(convert_to\(p_claim_secret_hash, 'UTF8'\)\), 'hex'\)/);
    assert.match(wrapper, /native_request_fingerprint IS DISTINCT FROM p_request_fingerprint/);
    assert.match(wrapper, /v_quote\.native_params_hash IS DISTINCT FROM v_native_hash/);
    assert.match(wrapper, /p_site, p_product_id, p_sku_id,\s*p_idempotency_key, p_request_fingerprint, p_claim_secret_hash, p_provider, p_channel,\s*p_buyer_contact_hash, p_buyer_id, p_request_ip_hash, p_request_device_hash, p_ttl_seconds, p_quantity, p_discount_code/);
    ordered(wrapper, ["v_quote.status = 'consumed'", 'RETURN v_quote.replay_result', 'fn_guest_shop_create_order(',
        'shop_supplier_fulfillment_units', "SET status = 'consumed'"]);
});

test('guest native branch keeps payment creation, credentials, original price and promo gates without reserving local stock', () => {
    const guest = after.sources.fn_guest_shop_create_order;
    for (const marker of ['guest_quantity_not_allowed', 'p_buyer_id', 'p_claim_secret_hash',
        'p_request_fingerprint', 'allow_guest_purchase', 'guest_payment_channels', 'guest_shop_payment_orders']) {
        assert.ok(before.sources.fn_guest_shop_create_order.includes(marker), `baseline: ${marker}`);
        assert.ok(guest.includes(marker), `patched: ${marker}`);
    }
    assert.match(guest, /CASE WHEN v_supplier_quote\.id IS NULL THEN 'held' ELSE 'none' END/);
    assert.match(guest, /v_net_amount IS DISTINCT FROM v_supplier_quote\.sale_amount/);
    assert.equal((guest.match(/IF v_supplier_quote\.id IS NULL THEN/g) || []).length, 3);
    ordered(guest, ['INSERT INTO public.guest_shop_orders', 'INSERT INTO public.guest_shop_payment_orders',
        "fn_bind_shop_supplier_funding_v2('guest_cash'"]);
});

test('supplier payment confirmation runs after native provider, signature, amount and receipt verification', () => {
    const confirm = after.sources.fn_guest_shop_confirm_payment;
    ordered(confirm, ['guest_invalid_payment_purpose', 'p_signature_verified IS NOT TRUE',
        'guest_provider_order_conflict', 'v_event.signature_verified IS NOT TRUE',
        'SET provider_order_no = v_provider_order_no', 'supplier-native-payment-v2']);
    for (const marker of ['p_amount_verified IS NOT TRUE', 'p_currency_verified IS NOT TRUE',
        'v_event.amount_verified IS NOT TRUE', 'v_event.currency_verified IS NOT TRUE', 'v_event.observed_purpose']) {
        assert.ok(confirm.includes(marker), marker);
    }
    assert.match(confirm, /v_order\.expires_at <= v_now THEN 'paid_unfulfillable'/);
    assert.match(confirm, /v_order\.expires_at <= v_now THEN 'pending' ELSE 'none'/);
    assert.match(confirm, /supplier_payment_after_expiry/);
});

test('funding capture distinguishes merchandise from final fee-inclusive payable and requires verified events', () => {
    const capture = after.sources.shop_supplier_capture_funding_v2;
    for (const marker of ['v_payment.expected_amount IS DISTINCT FROM v_guest.total_amount',
        'v_guest.total_amount - COALESCE(v_guest.payment_fee_amount, 0) IS DISTINCT FROM v_unit.sale_amount',
        'v_guest.unit_amount IS DISTINCT FROM v_unit.sale_amount',
        'e.signature_verified AND e.amount_verified', 'e.currency_verified AND e.final_status_verified',
        'e.observed_amount = v_payment.expected_amount', 'supplier_guest_verified_event_required',
        "v_reason := 'customer_resolution_required'", "v_reason := 'risk_budget_unavailable'", 'budget_version = budget_version + 1']) {
        assert.ok(capture.includes(marker), marker);
    }
    assert.doesNotMatch(capture, /SET\s+actual_cost|SET\s+supplier_order_id/);
});

test('native order/source/stock guards prevent fake delivery, local inventory and orphan funding', () => {
    const guard = body('shop_supplier_native_order_guard_v2');
    for (const marker of ['supplier_source_immutable', 'NEW.inventory_id IS NOT NULL', 'NEW.delivery_task_id IS NOT NULL',
        "NEW.delivery_status = 'delivered'", "NEW.reservation_status IS DISTINCT FROM 'none'", "NEW.fulfillment_status IN ('delivered', 'fulfilling')"]) {
        assert.ok(guard.includes(marker), marker);
    }
    assert.match(sql, /AFTER INSERT ON public\.shop_orders\s+DEFERRABLE INITIALLY DEFERRED/);
    assert.match(sql, /AFTER INSERT ON public\.guest_shop_orders\s+DEFERRABLE INITIALLY DEFERRED/);
    assert.match(body('shop_supplier_assert_native_binding_v2'), /supplier_native_binding_required/);
    for (const name of ['fn_guest_shop_claim_fulfillment', 'fn_guest_shop_mark_fulfilled', 'fn_guest_shop_list_delivered_content']) {
        ordered(after.sources[name], ['BEGIN', 'supplier-native-local-worker-guard-v2', 'supplier_local_fulfillment_forbidden']);
    }
});

test('P2B verifier is readonly and does not mislabel business/concurrency acceptance as passed', () => {
    assert.match(verify, /SET TRANSACTION READ ONLY/);
    assert.match(verify, /structural checks passed; database transaction\/concurrency\/business\/merchant acceptance remains NOT RUN/);
    assert.match(verify, /has_any_column_privilege/);
    assert.ok(verify.includes('IF v_total_price > 0 AND v_supplier_quote.id IS NULL THEN'));
    assert.match(verify, /tgenabled IN \('O', 'A'\)/);
    assert.match(verify, /tgdeferrable = v_required\.deferred AND tginitdeferred = v_required\.deferred/);
    assert.doesNotMatch(verify.replace(/--[^\n]*/g, ''), /\b(?:INSERT INTO|UPDATE public\.|DELETE FROM|CREATE TABLE|CREATE FUNCTION)\b/i);
    assert.match(sql, /NOTIFY pgrst, 'reload schema'/);
});
