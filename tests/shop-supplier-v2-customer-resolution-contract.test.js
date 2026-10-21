'use strict';
// Source/authorization contracts, not database execution or concurrency evidence.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const sql = read('supabase/migrations/20261019_shop_supplier_platform_v2_customer_resolution.sql');
const previous = read('supabase/migrations/20261019_shop_supplier_platform_v2_delivery_settlement.sql');
const verify = read('supabase/migrations/20261019_verify_shop_supplier_platform_v2_customer_resolution.sql');
function body(name, text = sql) { const found = text.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`, 'i'));
    assert.ok(found, name); return found[1]; }
const resolve = body('fn_shop_supplier_resolve_customer_v2');

test('resolution receipts are private, immutable, unique per fulfillment unit and never directly writable by service_role', () => {
    assert.match(sql, /operation_id UUID PRIMARY KEY/); assert.match(sql, /unit_id UUID NOT NULL UNIQUE/);
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
    assert.match(sql, /REVOKE ALL ON TABLE public\.shop_supplier_customer_resolutions FROM PUBLIC, anon, authenticated, service_role/);
    assert.match(sql, /GRANT SELECT ON TABLE public\.shop_supplier_customer_resolutions TO service_role/);
    assert.match(sql, /BEFORE UPDATE OR DELETE ON public\.shop_supplier_customer_resolutions[\s\S]*shop_supplier_delivery_receipt_immutable_v2/);
    assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC,anon,authenticated,service_role/);
});
test('all resolution mutations require an exact immutable native projection; other fields and closed orders are protected', () => {
    const projection = body('shop_supplier_resolution_projection_matches_v2');
    assert.match(projection, /p_new->'supplier_customer_resolution' = c\.customer_result/);
    assert.equal((projection.match(/jsonb_object_agg\(k, p_new->k\)/g) || []).length, 2);
    assert.match(projection, /c\.kind = 'points_refund'/); assert.match(projection, /c\.kind = 'manual_compensation'/);
    assert.match(projection, /p_old - ARRAY[\s\S]*= p_new - ARRAY/);
    const guard = body('shop_supplier_resolution_native_guard_v2');
    assert.match(guard, /TG_OP = 'INSERT'[\s\S]*supplier_resolution_receipt_required/);
    assert.match(guard, /OLD\.supplier_customer_resolution IS NOT NULL[\s\S]*supplier_customer_resolution_terminal/);
    assert.match(guard, /NEW\.supplier_customer_resolution IS NOT NULL[\s\S]*shop_supplier_resolution_projection_matches_v2/);
});
test('dispatch financial guard is preserved verbatim except the private receipt authorization', () => {
    const before = body('shop_supplier_dispatch_native_guard_v2', previous).replace(/\s+/g, ' ').trim();
    const after = body('shop_supplier_dispatch_native_guard_v2').replace(
        /    IF public\.shop_supplier_resolution_projection_matches_v2\(TG_TABLE_NAME,to_jsonb\(OLD\),to_jsonb\(NEW\)\) THEN RETURN NEW; END IF;\n/, '').replace(/\s+/g, ' ').trim();
    assert.equal(after, before); assert.match(after, /supplier_dispatch_resolution_required/);
});
test('commit lock order stays native -> unit -> policy -> intent -> attempt; receipt inserted before native terminal update', () => {
    const marks = ['FROM public.shop_orders WHERE', 'FROM public.shop_supplier_fulfillment_units WHERE',
        'FROM public.shop_supplier_transaction_policies WHERE', 'FROM public.shop_supplier_procurement_intents WHERE',
        'FROM public.shop_supplier_dispatch_attempts WHERE'];
    let prior = -1;
    for (const mark of marks) { const next = resolve.indexOf(mark, prior + 1); assert.ok(next > prior, mark); prior = next; }
    assert.ok(resolve.indexOf('INSERT INTO public.shop_supplier_customer_resolutions') < resolve.indexOf('UPDATE public.shop_orders SET'));
    assert.match(resolve, /v_existing\.request_hash IS DISTINCT FROM v_hash[\s\S]*v_existing\.actor_id IS DISTINCT FROM p_actor_id/);
    assert.match(resolve, /WHERE unit_id = v_unit\.id[\s\S]*supplier_resolution_already_completed/);
});
test('points refund preserves paid and bonus lot origins, exact amount and unique refund reference without local stock reversal', () => {
    assert.match(resolve, /v_paid := v_order\.paid_points_spent; v_bonus := v_order\.bonus_points_spent/);
    assert.match(resolve, /v_paid \+ v_bonus IS DISTINCT FROM v_amount/);
    assert.match(resolve, /v_reference := 'REFUND_' \|\| v_order\.id::TEXT/);
    assert.match(resolve, /FROM public\.points_ledger[\s\S]*supplier_resolution_refund_conflict/);
    assert.match(resolve, /fn_recharge_points\(v_order\.user_id,v_paid,v_bonus,'订单退款: 供应商订单结案',v_reference,'cn'::VARCHAR\)/);
    assert.match(resolve, /v_recharge->>'success' IS DISTINCT FROM 'true'/);
    assert.match(resolve, /v_recharge->>'deduped' IS DISTINCT FROM 'false'[\s\S]*supplier_resolution_refund_conflict/);
    assert.match(resolve, /v_order\.inventory_id IS NOT NULL OR v_order\.delivery_task_id IS NOT NULL/);
    assert.doesNotMatch(resolve, /fn_admin_refund|UPDATE public\.shop_inventory|SET delivery_completed_at/);
});
test('cash resolution requires confirmed native funds, no channel refund, no delivery and full compensation including fee', () => {
    assert.match(resolve, /v_guest\.payment_status IS DISTINCT FROM 'confirmed'/);
    assert.match(resolve, /v_guest\.refund_status IS DISTINCT FROM 'none'/);
    assert.match(resolve, /v_guest\.fulfilled_at IS NOT NULL OR v_guest\.paid_at IS NULL/);
    assert.match(resolve, /v_guest\.quantity IS DISTINCT FROM 1 OR v_guest\.reservation_status IS DISTINCT FROM 'none'/);
    assert.match(resolve, /v_amount IS DISTINCT FROM v_guest\.total_amount/);
    assert.match(resolve, /total_amount - COALESCE\(v_guest\.payment_fee_amount,0\) IS DISTINCT FROM v_unit\.sale_amount/);
    const update = resolve.match(/UPDATE public\.guest_shop_orders SET[\s\S]*?WHERE id = p_native_order_id;/)[0];
    assert.doesNotMatch(update, /payment_status|refund_status|fulfilled_at/);
    assert.doesNotMatch(resolve, /fn_guest_shop_(?:refund|cancel)|payment_orders SET/);
});
test('evidence reference fingerprint is computed and verified; public explanation is a narrow result', () => {
    assert.match(resolve, /evidenceHash' IS DISTINCT FROM encode\(sha256\(convert_to\(btrim\(p_request->>'evidenceRef'\),'UTF8'\)\),'hex'\)/);
    assert.match(resolve, /p_request->'attested' IS DISTINCT FROM 'true'::JSONB/);
    const result = resolve.match(/v_public := jsonb_build_object\([\s\S]*?;\n/)[0];
    assert.match(result, /'status'[\s\S]*'method'[\s\S]*'message'[\s\S]*'resolved_at'/);
    assert.doesNotMatch(result, /evidence|internal|account|sealed/);
});
test('customer closure retains upstream request, actual debit and risk; late goods stay subject to native readiness', () => {
    assert.match(resolve, /UPDATE public\.shop_supplier_transaction_outbox SET status = 'review',block_reason = 'customer_resolution_required'/);
    assert.doesNotMatch(resolve, /UPDATE public\.shop_supplier_(?:procurement_intents|dispatch_attempts|delivery_receipts|transaction_policies)/);
    assert.match(previous, /v_native_ready[\s\S]*native_not_deliverable/);
    const record = body('fn_shop_supplier_record_delivery_v2', previous);
    const readiness = record.slice(record.indexOf('v_native_ready :='), record.indexOf('ELSE', record.indexOf('v_native_ready :=')));
    assert.match(readiness, /v_order\.delivery_status = 'pending'/);
    assert.match(readiness, /COALESCE\(v_order\.refund_status,'none'\) = 'none'/);
    const delivery = body('fn_shop_supplier_customer_delivery_v2');
    assert.ok(delivery.indexOf("jsonb_build_object('status','closed')") < delivery.indexOf('SELECT * INTO v_receipt'));
});
test('read-only recovery is owner/site bound, has no TTL/switch dependency, and cannot issue another quote or debit', () => {
    const recovery = body('fn_shop_supplier_recover_points_v2');
    assert.match(recovery, /buyer_user_id = p_buyer_user_id/); assert.match(recovery, /site = p_site/);
    assert.match(recovery, /v_quote\.status <> 'consumed'[\s\S]*'unconfirmed'/);
    assert.match(recovery, /'confirmed','orderId',v_order\.id/);
    assert.doesNotMatch(recovery, /\b(?:INSERT|UPDATE|DELETE|PERFORM)\b|expires_at|enabled|fn_purchase|fn_issue/i);
    const query = resolve.slice(resolve.indexOf("IF p_action = 'query'"), resolve.indexOf('IF jsonb_typeof(p_request)'));
    assert.match(query, /c\.actor_id = p_actor_id/);
    assert.doesNotMatch(query, /\b(?:INSERT|UPDATE|DELETE|PERFORM)\b/i);
});
test('read-only verification cannot claim database or business acceptance and checks grants and both terminal guards', () => {
    assert.match(verify, /SET TRANSACTION READ ONLY/); assert.match(verify, /concurrent\/business acceptance remains NOT RUN/);
    assert.match(verify, /INSERT,UPDATE,DELETE,TRUNCATE/); assert.match(verify, /\['shop_orders','guest_shop_orders'\]/);
    assert.match(verify, /tr_supplier_resolution_native_guard_v2/); assert.match(verify, /tr_supplier_resolution_immutable_v2/);
    assert.doesNotMatch(verify, /SELECT public\.fn_shop_supplier_resolve_customer_v2/);
});
