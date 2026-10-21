'use strict';

// These are source/SQL contract checks. They never connect to a database and
// do not establish transaction, concurrency, native-checkout or merchant PASS.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
const sql = read('supabase/migrations/20261019_shop_supplier_platform_v2_funding_boundary.sql');
const verify = read('supabase/migrations/20261019_verify_shop_supplier_platform_v2_funding_boundary.sql');
const withoutComments = (source) => source.replace(/--[^\n]*/g, '');
const executable = withoutComments(sql);
function body(name) {
    const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    assert.notEqual(start, -1, name);
    const end = sql.indexOf('$$;', start);
    assert.notEqual(end, -1, name);
    return sql.slice(start, end + 3);
}
const bind = body('fn_bind_shop_supplier_funding_v2');
const capture = body('shop_supplier_capture_funding_v2');
function ordered(source, markers) {
    let previous = -1;
    for (const marker of markers) {
        const current = source.indexOf(marker);
        assert.ok(current > previous, `missing/out-of-order marker: ${marker}`);
        previous = current;
    }
}

test('P2A changes only its private boundary and a supporting native index, without replacing native checkout', () => {
    assert.equal((executable.match(/CREATE TABLE IF NOT EXISTS public\./g) || []).length, 5);
    assert.equal((executable.match(/CREATE OR REPLACE FUNCTION public\./g) || []).length, 4);
    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS ux_shop_order_items_supplier_parent\s+ON public\.shop_order_items\(order_id, id\)/);
    assert.doesNotMatch(executable, /\b(?:DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN)\b/i);
    assert.doesNotMatch(executable, /(?:INSERT INTO|UPDATE|ALTER TABLE) public\.(?:shop_orders|shop_order_items|guest_shop_orders|guest_shop_payment_orders|points_ledger|points_balance|wallet_point_lots|shop_webhook_tasks)\b/i);
    assert.doesNotMatch(executable, /CREATE OR REPLACE FUNCTION public\.fn_(?:purchase|guest_shop_confirm|guest_shop_create)/i);
});

test('all five new tables are private; service role can read and only bind through the protected RPC', () => {
    const tables = ['shop_supplier_transaction_policies', 'shop_supplier_fulfillment_units',
        'shop_supplier_procurement_intents', 'shop_supplier_transaction_outbox', 'shop_supplier_transaction_events'];
    for (const table of tables) assert.ok(sql.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`), table);
    assert.match(sql, /REVOKE ALL ON TABLE[^;]+FROM PUBLIC, anon, authenticated, service_role;/);
    assert.match(sql, /GRANT SELECT ON TABLE[^;]+TO service_role;/);
    assert.doesNotMatch(executable, /GRANT\s+(?:ALL|INSERT|UPDATE|DELETE)|CREATE POLICY/i);
    assert.equal((sql.match(/SECURITY DEFINER SET search_path = public, pg_temp/g) || []).length, 4);
    assert.match(bind, /COALESCE\(auth\.role\(\), ''\) <> 'service_role'/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.fn_bind_shop_supplier_funding_v2\([^;]+FROM PUBLIC, anon, authenticated;/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.fn_bind_shop_supplier_funding_v2\([^;]+TO service_role;/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.shop_supplier_capture_funding_v2\(UUID\),[\s\S]+FROM PUBLIC, anon, authenticated, service_role;/);
});

test('funding owner XOR and native composite foreign keys prevent cross-order item or SKU binding', () => {
    assert.match(sql, /FOREIGN KEY \(shop_order_id, shop_order_item_id\)\s+REFERENCES public\.shop_order_items\(order_id, id\) ON DELETE RESTRICT/);
    assert.match(sql, /FOREIGN KEY \(product_id, sku_id\)\s+REFERENCES public\.shop_product_skus\(product_id, id\) ON DELETE RESTRICT/);
    assert.match(sql, /funding_kind = 'points' AND shop_order_id IS NOT NULL AND shop_order_item_id IS NOT NULL\s+AND guest_order_id IS NULL AND buyer_user_id IS NOT NULL AND sale_currency = 'POINTS'/);
    assert.match(sql, /funding_kind = 'guest_cash' AND guest_order_id IS NOT NULL AND shop_order_id IS NULL\s+AND shop_order_item_id IS NULL AND buyer_user_id IS NULL AND sale_currency = 'CNY'/);
    for (const name of ['operation', 'points_order', 'points_item', 'guest_order', 'points_ledger', 'guest_payment']) {
        assert.ok(sql.includes(`CONSTRAINT shop_supplier_unit_${name}_unique UNIQUE`), name);
    }
});

test('CN quantity-one sale values and CNY procurement ceilings have separate finite monetary contracts', () => {
    assert.match(sql, /site TEXT NOT NULL CHECK \(site = 'cn'\)/);
    assert.match(sql, /quantity INTEGER NOT NULL DEFAULT 1 CHECK \(quantity = 1\)/);
    assert.match(sql, /sale_amount NUMERIC\(18,2\) NOT NULL CHECK \(sale_amount > 0 AND sale_amount <> 'NaN'::NUMERIC\)/);
    assert.match(sql, /cost_ceiling_cny NUMERIC\(18,6\) NOT NULL CHECK \(cost_ceiling_cny > 0 AND cost_ceiling_cny <> 'NaN'::NUMERIC\)/);
    assert.match(bind, /p_cost_ceiling_cny IS NULL OR p_cost_ceiling_cny <= 0 OR p_cost_ceiling_cny >= 1000000000000/);
    assert.match(bind, /LOWER\(p_cost_ceiling_cny::TEXT\) IN \('nan', 'infinity', '-infinity'\)/);
    assert.match(bind, /p_cost_ceiling_cny <> ROUND\(p_cost_ceiling_cny, 6\)/);
    assert.doesNotMatch(capture, /sale_amount\s*\*|sale_amount\s*\/|COALESCE\([^)]*actual_cost/i);
});

test('same operation is serialized and returns its persisted unit; different parameters conflict before a write', () => {
    ordered(bind, [
        'v_fingerprint := encode(sha256(',
        "pg_advisory_xact_lock(hashtextextended('supplier_binding_v2:'",
        'WHERE operation_id = p_operation_id',
        'supplier_idempotency_conflict',
        "'already_bound', true",
        'WHERE id = p_order_id FOR UPDATE',
        'INSERT INTO public.shop_supplier_fulfillment_units'
    ]);
    for (const key of ['kind', 'order', 'item', 'buyer', 'mapping', 'revision_epoch', 'cost_ceiling_cny']) {
        assert.ok(bind.includes(`'${key}',`), key);
    }
    assert.doesNotMatch(bind, /ON CONFLICT[^;]+DO UPDATE|DELETE FROM|EXCEPTION\s+WHEN/i);
});

test('points binding requires the native buyer, one matching pending item and no competing local fulfillment', () => {
    for (const marker of [
        'p_order_item_id IS NULL OR p_buyer_user_id IS NULL',
        'v_order.user_id IS DISTINCT FROM p_buyer_user_id', "v_order.site IS DISTINCT FROM 'cn'",
        'v_order.item_count IS DISTINCT FROM 1', 'v_item.price_paid IS DISTINCT FROM v_order.price_paid',
        'v_item.sku_id IS DISTINCT FROM v_order.sku_id', 'v_order.inventory_id IS NOT NULL',
        'v_item.inventory_id IS NOT NULL', 'v_order.delivery_task_id IS NOT NULL',
        "v_order.delivery_status IS DISTINCT FROM 'pending'", 'v_order.delivery_completed_at IS NOT NULL',
        'SELECT COUNT(*) FROM public.shop_order_items WHERE order_id = p_order_id',
        'EXISTS (SELECT 1 FROM public.shop_webhook_tasks WHERE order_id = p_order_id)'
    ]) assert.ok(bind.includes(marker), marker);
});

test('binding after the original points debit is rejected; there is no second financial write in the hook', () => {
    ordered(bind, [
        "reference_id = 'SHOP_ORDER_' || p_order_id::TEXT",
        'supplier_binding_must_precede_points_debit',
        'INSERT INTO public.shop_supplier_fulfillment_units'
    ]);
    assert.doesNotMatch(executable, /(?:INSERT INTO|UPDATE) public\.(?:points_ledger|points_balance|user_points|wallet_point_lots)\b/i);
    assert.match(sql, /AFTER INSERT ON public\.shop_supplier_fulfillment_units DEFERRABLE INITIALLY DEFERRED/);
    assert.match(body('shop_supplier_funding_boundary_v2'), /PERFORM public\.shop_supplier_capture_funding_v2\(NEW\.id\)/);
});

test('guest binding must precede payment and cannot steal local reservations or already-processed orders', () => {
    for (const marker of [
        'p_order_item_id IS NOT NULL OR p_buyer_user_id IS NOT NULL',
        "v_guest.site IS DISTINCT FROM 'cn'", "v_guest.currency IS DISTINCT FROM 'CNY'",
        "v_guest.payment_status NOT IN ('pending', 'created')", "v_guest.reservation_status <> 'none'",
        "v_guest.fulfillment_status <> 'pending'", "v_guest.refund_status <> 'none'",
        'v_guest.expires_at <= clock_timestamp()',
        'public.guest_shop_inventory_reservations WHERE order_id = p_order_id',
        "status NOT IN ('pending', 'created') OR provider_order_no IS NOT NULL"
    ]) assert.ok(bind.includes(marker), marker);
    assert.match(capture, /IF v_guest\.payment_status IN \('pending', 'created'\) THEN RETURN; END IF;/);
});

test('the original source is frozen only after exact account, product/SKU, revision and supported variant checks', () => {
    for (const marker of [
        'WHERE id = p_mapping_id FOR SHARE', 'NOT v_mapping.is_enabled',
        'v_mapping.product_id IS DISTINCT FROM v_product_id', 'v_mapping.sku_id IS DISTINCT FROM v_sku_id',
        'v_mapping.updated_at IS DISTINCT FROM p_mapping_revision', 'v_mapping.contract_version <> 2',
        "(v_mapping.supplier_variant - 'race') <> '{}'::JSONB",
        "v_mapping.supplier_variant->>'race' IS DISTINCT FROM BTRIM(v_mapping.supplier_variant->>'race')",
        "THEN 'default' ELSE 'v1:' || md5(v_mapping.supplier_variant::TEXT) END)",
        'WHERE id = v_mapping.supplier_account_id FOR SHARE', 'NOT v_account.is_enabled'
    ]) assert.ok(bind.includes(marker), marker);
    const snapshot = bind.split("jsonb_build_object('provider_id'")[1].split('v_sale_amount,')[0];
    assert.doesNotMatch(snapshot, /credential_ref|app_key|signature|claim_secret|buyer_contact|metadata/i);
});

test('intake is unprovisioned and default-off; native hooks cannot silently enable selling or procurement', () => {
    assert.match(sql, /intake_enabled BOOLEAN NOT NULL DEFAULT false/);
    assert.match(sql, /budget_version BIGINT NOT NULL DEFAULT 0 CHECK \(budget_version >= 0\)/);
    for (const name of ['max_unresolved_units', 'max_reserved_cost_cny', 'per_unit_cost_ceiling_cny']) {
        assert.match(sql, new RegExp(`${name} [^\\n]+NOT NULL DEFAULT 0`));
    }
    assert.match(bind, /NOT v_policy.intake_enabled OR p_cost_ceiling_cny > v_policy.per_unit_cost_ceiling_cny/);
    assert.doesNotMatch(executable, /INSERT INTO public\.shop_supplier_transaction_policies|SET\s+(?:is_enabled|is_active|allow_guest_purchase|intake_enabled)\s*=/i);
});

test('points capture validates the single original debit, buyer/site/amount and exact paid/bonus attribution', () => {
    for (const marker of [
        "reference_id = 'SHOP_ORDER_' || v_order.id::TEXT", 'IF v_count <> 1 THEN',
        'supplier_points_debit_required_in_transaction',
        'v_ledger.user_id IS DISTINCT FROM v_unit.buyer_user_id', 'v_ledger.site IS DISTINCT FROM v_unit.site',
        'v_ledger.amount IS DISTINCT FROM -v_unit.sale_amount',
        'v_order.paid_points_spent IS NULL OR v_order.bonus_points_spent IS NULL',
        'v_order.paid_points_spent < 0 OR v_order.bonus_points_spent < 0',
        'v_order.paid_points_spent + v_order.bonus_points_spent <> v_unit.sale_amount',
        'price_paid = v_unit.sale_amount AND inventory_id IS NULL',
        'public.shop_webhook_tasks WHERE order_id = v_order.id'
    ]) assert.ok(capture.includes(marker), marker);
});

test('cash capture requires matching verified native payment and event facts rather than a client paid flag', () => {
    for (const marker of [
        "v_payment.status IS DISTINCT FROM 'confirmed'", "v_payment.purpose IS DISTINCT FROM 'shop_direct'",
        'v_payment.merchant_order_no IS DISTINCT FROM v_guest.order_no',
        'v_payment.sign_verified IS DISTINCT FROM true', 'v_payment.amount_verified IS DISTINCT FROM true',
        'v_payment.currency_verified IS DISTINCT FROM true', 'v_payment.final_status_verified IS DISTINCT FROM true',
        'v_payment.paid_amount IS DISTINCT FROM v_payment.expected_amount', 'v_payment.expected_amount < v_unit.sale_amount',
        'e.payment_order_id = v_payment.id AND e.provider = v_payment.provider',
        'e.provider_order_no = v_payment.provider_order_no AND e.merchant_order_no = v_payment.merchant_order_no',
        'e.signature_verified AND e.amount_verified', 'e.currency_verified AND e.final_status_verified',
        "e.processing_status IN ('processed', 'duplicate')", 'e.observed_amount = v_payment.expected_amount',
        "e.observed_site = v_unit.site AND e.observed_currency = 'CNY'", "e.observed_purpose = 'shop_direct'",
        'public.guest_shop_payment_is_final_success(e.observed_status)', 'supplier_guest_verified_event_required'
    ]) assert.ok(capture.includes(marker), marker);
});

test('guest trigger defers until native order and event writes are visible; repeated capture is a no-op', () => {
    assert.match(sql, /AFTER UPDATE ON public\.guest_shop_payment_orders DEFERRABLE INITIALLY DEFERRED\s+FOR EACH ROW WHEN \(NEW.status = 'confirmed' AND OLD.status IS DISTINCT FROM 'confirmed'\)/);
    assert.match(body('shop_supplier_guest_payment_boundary_v2'), /WHERE guest_order_id = NEW.guest_order_id/);
    assert.match(capture, /IF v_unit.funding_state = 'funded' THEN RETURN; END IF;/);
    ordered(capture, [
        'FROM public.shop_supplier_fulfillment_units WHERE id = p_unit_id;',
        'FROM public.shop_orders WHERE id = v_unit.shop_order_id FOR UPDATE',
        'FROM public.guest_shop_orders WHERE id = v_unit.guest_order_id FOR UPDATE',
        'FROM public.shop_supplier_fulfillment_units WHERE id = p_unit_id FOR UPDATE'
    ]);
});

test('a shared account mutation serializes budget decisions before aggregate exposure, including repeatable-read conflicts', () => {
    ordered(capture, [
        'WHERE supplier_account_id = v_unit.supplier_account_id FOR UPDATE',
        'UPDATE public.shop_supplier_transaction_policies SET budget_version = budget_version + 1',
        'SELECT COUNT(*), COALESCE(SUM(reserved_cost_cny), 0)',
        "exposure_status = 'held'",
        'v_count < v_policy.max_unresolved_units',
        'v_unit.cost_ceiling_cny <= v_policy.per_unit_cost_ceiling_cny',
        'v_reserved + v_unit.cost_ceiling_cny <= v_policy.max_reserved_cost_cny',
        'INSERT INTO public.shop_supplier_procurement_intents'
    ]);
    assert.doesNotMatch(executable, /reserved_until|release_at|expires_at\s*<[^;]+DELETE|EXCEPTION\s+WHEN/i);
});

test('budget exhaustion rolls back points but preserves verified cash as a blocked unreserved intent', () => {
    assert.match(capture, /ELSIF v_unit.funding_kind = 'points' THEN\s+RAISE EXCEPTION 'supplier_risk_budget_unavailable';\s+ELSIF v_reason <> 'customer_resolution_required' THEN[\s\S]+v_reason := 'risk_budget_unavailable';/);
    assert.match(capture, /CASE WHEN v_hold THEN 'held' ELSE 'not_reserved' END, CASE WHEN v_hold THEN v_unit.cost_ceiling_cny ELSE 0 END/);
    assert.match(capture, /v_guest.expires_at <= v_guest.paid_at[\s\S]+v_reason := 'customer_resolution_required'/);
    assert.doesNotMatch(capture, /NOT v_policy.intake_enabled|NOT v_account.is_enabled/,
        'a previously bound, verified cash receipt must not be discarded on account pause');
    assert.doesNotMatch(executable, /EXCEPTION\s+WHEN|\b(?:COMMIT|ROLLBACK)\s*;(?=[\s\S]*\$\$;)/i);
});

test('intent, blocked task, funding proof and audit are written atomically with one identity each', () => {
    ordered(capture, [
        'INSERT INTO public.shop_supplier_procurement_intents',
        'INSERT INTO public.shop_supplier_transaction_outbox',
        "SET funding_state = 'funded'",
        'INSERT INTO public.shop_supplier_transaction_events', "'funding_captured'"
    ]);
    assert.match(sql, /shop_supplier_intent_unit_unique UNIQUE/);
    assert.match(sql, /shop_supplier_outbox_intent_unique UNIQUE/);
    assert.match(sql, /shop_supplier_event_type_unique UNIQUE \(unit_id, event_type\)/);
    assert.match(sql, /funding_state = 'awaiting_payment' AND funded_at IS NULL AND points_ledger_id IS NULL\s+AND guest_payment_order_id IS NULL AND guest_payment_event_id IS NULL/);
    assert.match(sql, /funding_state = 'funded' AND funded_at IS NOT NULL/);
});

test('original request identity is durable and unknown actual procurement cost cannot be invented', () => {
    assert.match(sql, /original_request_id UUID NOT NULL DEFAULT gen_random_uuid\(\)/);
    assert.match(sql, /shop_supplier_intent_request_unique UNIQUE \(supplier_account_id, original_request_id\)/);
    assert.match(sql, /ON public\.shop_supplier_procurement_intents\(supplier_account_id, supplier_order_no\)\s+WHERE supplier_order_no IS NOT NULL/);
    assert.match(sql, /actual_cost_cny NUMERIC\(18,6\),/);
    assert.match(sql, /CHECK \(actual_cost_cny IS NULL AND supplier_order_no IS NULL\)/);
    assert.doesNotMatch(capture, /SET actual_cost_cny|INSERT INTO public\.shop_supplier_procurement_intents\([^)]*actual_cost_cny/i);
});

test('P2A cannot submit upstream work or be mistaken for an executable queue', () => {
    assert.match(sql, /CHECK \(status = 'not_submitted'\)/);
    assert.match(sql, /CHECK \(status = 'blocked'\)/);
    assert.match(bind, /'procurement_ready', false/);
    assert.doesNotMatch(executable, /https?:\/\/|\bhttp_|dblink|pg_net|CREATE EXTENSION|pg_cron|FOR UPDATE SKIP LOCKED|status\s*=\s*'ready'/i);
    for (const file of ['server/api-handlers/public/shop.js', 'server/api-handlers/public/guest-shop.js']) {
        assert.doesNotMatch(read(file), /fn_bind_shop_supplier_funding_v2|shop_supplier_capture_funding_v2/,
            'public checkout integration is a separate P2 slice');
    }
});

test('manual verifier is read-only, validates private identity/budget/trigger contracts and retains NOT RUN evidence', () => {
    assert.match(verify, /SET TRANSACTION READ ONLY;/);
    for (const marker of [
        'has_any_column_privilege', 'has_table_privilege', 'has_function_privilege',
        'tgtype = 5', 'tgtype = 17', 'tgdeferrable AND tginitdeferred', 'tgenabled',
        'convalidated AND NOT c.condeferrable AND i.indisunique AND i.indisvalid',
        'shop_supplier_unit_points_item_fk', 'shop_supplier_unit_sku_product_fk',
        'shop_supplier_unit_points_ledger_unique', 'shop_supplier_intent_request_unique',
        'shop_supplier_outbox_intent_unique', 'shop_supplier_event_type_unique',
        'i.indnkeyatts = 2 AND i.indnatts = 2', 'budget_version = budget_version + 1',
        'funding/intent/outbox/audit records are inconsistent'
    ]) assert.ok(verify.includes(marker), marker);
    assert.match(verify, /structural checks passed; database transaction\/concurrency\/merchant acceptance remains NOT RUN/);
    const verifyStatements = withoutComments(verify).replace(/'(?:[^']|'')*'/g, "''");
    assert.doesNotMatch(verifyStatements, /\b(?:INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE|ALTER TABLE|GRANT |REVOKE )/i);
    assert.doesNotMatch(verify, /(?:SELECT|PERFORM)\s+(?:public\.)?(?:fn_bind_shop_supplier_funding_v2|shop_supplier_capture_funding_v2)\s*\(/i);
});
