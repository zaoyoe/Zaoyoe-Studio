-- P2D-2 customer resolution. Apply manually AFTER P2D-1. No merchant calls or enablement.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
    IF to_regprocedure('public.fn_shop_supplier_record_delivery_v2(uuid,jsonb)') IS NULL THEN
        RAISE EXCEPTION 'Supplier P2D-1 is required before P2D-2';
    END IF;
END; $$;
ALTER TABLE public.shop_orders ADD COLUMN IF NOT EXISTS supplier_customer_resolution JSONB;
ALTER TABLE public.guest_shop_orders ADD COLUMN IF NOT EXISTS supplier_customer_resolution JSONB;

-- Only this immutable private receipt authorizes the exact native projection.
-- Manual compensation is an administrator attestation, NEVER a provider refund.
CREATE TABLE IF NOT EXISTS public.shop_supplier_customer_resolutions (
    operation_id UUID PRIMARY KEY,
    unit_id UUID NOT NULL UNIQUE REFERENCES public.shop_supplier_fulfillment_units(id) ON DELETE RESTRICT,
    actor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
    kind TEXT NOT NULL CHECK (kind IN ('points_refund','manual_compensation')),
    amount NUMERIC(18,2) NOT NULL CHECK (amount > 0 AND amount <> 'NaN'::NUMERIC),
    currency TEXT NOT NULL CHECK (currency IN ('POINTS','CNY')),
    evidence_ref TEXT NOT NULL CHECK (length(btrim(evidence_ref)) BETWEEN 8 AND 500),
    evidence_hash TEXT NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
    internal_note TEXT NOT NULL CHECK (length(btrim(internal_note)) BETWEEN 8 AND 1000),
    customer_result JSONB NOT NULL CHECK (jsonb_typeof(customer_result) = 'object'),
    native_projection JSONB NOT NULL CHECK (jsonb_typeof(native_projection) = 'object'),
    result JSONB NOT NULL CHECK (jsonb_typeof(result) = 'object'),
    created_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE public.shop_supplier_customer_resolutions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_supplier_customer_resolutions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.shop_supplier_customer_resolutions TO service_role;
DROP TRIGGER IF EXISTS tr_supplier_resolution_immutable_v2 ON public.shop_supplier_customer_resolutions;
CREATE TRIGGER tr_supplier_resolution_immutable_v2 BEFORE UPDATE OR DELETE ON public.shop_supplier_customer_resolutions
    FOR EACH ROW EXECUTE FUNCTION public.shop_supplier_delivery_receipt_immutable_v2();

CREATE OR REPLACE FUNCTION public.shop_supplier_resolution_projection_matches_v2(p_table TEXT, p_old JSONB, p_new JSONB)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM public.shop_supplier_customer_resolutions c
        JOIN public.shop_supplier_fulfillment_units u ON u.id = c.unit_id
        WHERE p_old->>'fulfillment_source' = 'supplier_v2' AND p_new->>'site' = u.site
        AND p_old->>'supplier_customer_resolution' IS NULL
        AND p_new->'supplier_customer_resolution' = c.customer_result
        AND ((p_table = 'shop_orders' AND u.shop_order_id::TEXT = p_old->>'id' AND c.kind = 'points_refund'
            AND (SELECT jsonb_object_agg(k, p_new->k) FROM jsonb_object_keys(c.native_projection) k) = c.native_projection
            AND p_old - ARRAY['refund_status','delivery_status','delivery_updated_at','delivery_last_error',
                'points_spend_breakdown','supplier_customer_resolution','supplier_dispatch_version']
                = p_new - ARRAY['refund_status','delivery_status','delivery_updated_at','delivery_last_error',
                'points_spend_breakdown','supplier_customer_resolution','supplier_dispatch_version'])
        OR (p_table = 'guest_shop_orders' AND u.guest_order_id::TEXT = p_old->>'id' AND c.kind = 'manual_compensation'
            AND (SELECT jsonb_object_agg(k, p_new->k) FROM jsonb_object_keys(c.native_projection) k) = c.native_projection
            AND p_old - ARRAY['fulfillment_status','updated_at','supplier_customer_resolution','supplier_dispatch_version']
                = p_new - ARRAY['fulfillment_status','updated_at','supplier_customer_resolution','supplier_dispatch_version'])));
$$;
CREATE OR REPLACE FUNCTION public.shop_supplier_resolution_native_guard_v2() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.supplier_customer_resolution IS NOT NULL THEN RAISE EXCEPTION 'supplier_resolution_receipt_required'; END IF;
        RETURN NEW;
    END IF;
    IF OLD.supplier_customer_resolution IS NOT NULL THEN
        -- Query-only dispatch fencing may advance its version. No financial,
        -- ownership, customer result or fulfillment changes after customer close.
        IF to_jsonb(NEW) - ARRAY['supplier_dispatch_version','updated_at']
            IS DISTINCT FROM to_jsonb(OLD) - ARRAY['supplier_dispatch_version','updated_at'] THEN
            RAISE EXCEPTION 'supplier_customer_resolution_terminal';
        END IF;
    ELSIF NEW.supplier_customer_resolution IS NOT NULL AND NOT
        public.shop_supplier_resolution_projection_matches_v2(TG_TABLE_NAME,to_jsonb(OLD),to_jsonb(NEW)) THEN
        RAISE EXCEPTION 'supplier_resolution_receipt_required';
    END IF;
    RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS tr_supplier_resolution_native_guard_v2 ON public.shop_orders;
CREATE TRIGGER tr_supplier_resolution_native_guard_v2 BEFORE INSERT OR UPDATE ON public.shop_orders
    FOR EACH ROW EXECUTE FUNCTION public.shop_supplier_resolution_native_guard_v2();
DROP TRIGGER IF EXISTS tr_supplier_resolution_native_guard_v2 ON public.guest_shop_orders;
CREATE TRIGGER tr_supplier_resolution_native_guard_v2 BEFORE INSERT OR UPDATE ON public.guest_shop_orders
    FOR EACH ROW EXECUTE FUNCTION public.shop_supplier_resolution_native_guard_v2();

CREATE OR REPLACE FUNCTION public.shop_supplier_dispatch_native_guard_v2() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_changed BOOLEAN;
BEGIN
    IF OLD.fulfillment_source IS DISTINCT FROM 'supplier_v2' THEN RETURN NEW; END IF;
    IF public.shop_supplier_resolution_projection_matches_v2(TG_TABLE_NAME,to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'shop_orders' THEN
        v_changed := NEW.refund_status IS DISTINCT FROM OLD.refund_status
            OR NEW.delivery_status IS DISTINCT FROM OLD.delivery_status
            OR NEW.price_paid IS DISTINCT FROM OLD.price_paid OR NEW.total_price IS DISTINCT FROM OLD.total_price
            OR NEW.item_count IS DISTINCT FROM OLD.item_count OR NEW.user_id IS DISTINCT FROM OLD.user_id
            OR NEW.discount_code IS DISTINCT FROM OLD.discount_code OR NEW.discount_amount IS DISTINCT FROM OLD.discount_amount
            OR NEW.discount_refund_amount IS DISTINCT FROM OLD.discount_refund_amount;
    ELSE
        v_changed := NEW.refund_status IS DISTINCT FROM OLD.refund_status
            OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
            OR NEW.fulfillment_status IS DISTINCT FROM OLD.fulfillment_status
            OR NEW.total_amount IS DISTINCT FROM OLD.total_amount OR NEW.unit_amount IS DISTINCT FROM OLD.unit_amount
            OR NEW.payment_fee_amount IS DISTINCT FROM OLD.payment_fee_amount OR NEW.quantity IS DISTINCT FROM OLD.quantity
            OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.paid_at IS DISTINCT FROM OLD.paid_at;
    END IF;
    IF v_changed AND EXISTS (SELECT 1 FROM public.shop_supplier_dispatch_attempts a
        JOIN public.shop_supplier_procurement_intents i ON i.id = a.intent_id
        JOIN public.shop_supplier_fulfillment_units u ON u.id = i.unit_id
        WHERE (TG_TABLE_NAME = 'shop_orders' AND u.shop_order_id = OLD.id)
            OR (TG_TABLE_NAME = 'guest_shop_orders' AND u.guest_order_id = OLD.id)) THEN
        IF public.shop_supplier_delivery_projection_matches_v2(TG_TABLE_NAME,to_jsonb(NEW)) THEN
            IF TG_TABLE_NAME = 'shop_orders' AND
                to_jsonb(NEW) - ARRAY['delivery_status','delivery_completed_at','delivery_updated_at','delivery_last_error','supplier_dispatch_version']
                = to_jsonb(OLD) - ARRAY['delivery_status','delivery_completed_at','delivery_updated_at','delivery_last_error','supplier_dispatch_version'] THEN
                RETURN NEW;
            ELSIF TG_TABLE_NAME = 'guest_shop_orders' AND
                to_jsonb(NEW) - ARRAY['fulfillment_status','fulfilled_at','updated_at','supplier_dispatch_version']
                = to_jsonb(OLD) - ARRAY['fulfillment_status','fulfilled_at','updated_at','supplier_dispatch_version'] THEN
                RETURN NEW;
            END IF;
        END IF;
        RAISE EXCEPTION 'supplier_dispatch_resolution_required';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_shop_supplier_resolve_customer_v2(
    p_action TEXT, p_operation_id UUID, p_actor_id UUID, p_native_order_id UUID,
    p_funding_kind TEXT, p_request JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_unit public.shop_supplier_fulfillment_units%ROWTYPE;
    v_order public.shop_orders%ROWTYPE;
    v_guest public.guest_shop_orders%ROWTYPE;
    v_intent public.shop_supplier_procurement_intents%ROWTYPE;
    v_existing public.shop_supplier_customer_resolutions%ROWTYPE;
    v_kind TEXT; v_hash TEXT; v_now TIMESTAMPTZ; v_public JSONB; v_projection JSONB; v_result JSONB;
    v_amount NUMERIC(18,2); v_paid NUMERIC(18,2); v_bonus NUMERIC(18,2); v_recharge JSONB; v_reference TEXT;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'supplier_service_role_required'; END IF;
    IF p_action IS NULL OR p_action NOT IN ('query','commit') OR p_operation_id IS NULL OR p_actor_id IS NULL
        OR p_native_order_id IS NULL OR p_funding_kind IS NULL OR p_funding_kind NOT IN ('points','guest_cash') THEN
        RAISE EXCEPTION 'supplier_resolution_invalid_request'; END IF;
    IF p_action = 'query' THEN
        SELECT c.* INTO v_existing FROM public.shop_supplier_customer_resolutions c
            JOIN public.shop_supplier_fulfillment_units u ON u.id = c.unit_id
            WHERE c.operation_id = p_operation_id AND c.actor_id = p_actor_id AND u.site = 'cn' AND u.funding_kind = p_funding_kind
            AND COALESCE(u.shop_order_id,u.guest_order_id) = p_native_order_id;
        IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found','operationId',p_operation_id); END IF;
        RETURN v_existing.result;
    END IF;
    IF jsonb_typeof(p_request) IS DISTINCT FROM 'object'
        OR p_request - ARRAY['kind','publicNote','internalNote','evidenceRef','evidenceHash','amount','attested'] <> '{}'::JSONB
        OR NOT p_request ?& ARRAY['kind','publicNote','internalNote','evidenceRef','evidenceHash','amount','attested']
        OR p_request->'attested' IS DISTINCT FROM 'true'::JSONB
        OR jsonb_typeof(p_request->'amount') IS DISTINCT FROM 'string'
        OR p_request->>'amount' !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'
        OR jsonb_typeof(p_request->'publicNote') IS DISTINCT FROM 'string'
        OR length(btrim(p_request->>'publicNote')) NOT BETWEEN 8 AND 500
        OR jsonb_typeof(p_request->'internalNote') IS DISTINCT FROM 'string'
        OR length(btrim(p_request->>'internalNote')) NOT BETWEEN 8 AND 1000
        OR jsonb_typeof(p_request->'evidenceRef') IS DISTINCT FROM 'string'
        OR length(btrim(p_request->>'evidenceRef')) NOT BETWEEN 8 AND 500
        OR jsonb_typeof(p_request->'evidenceHash') IS DISTINCT FROM 'string'
        OR p_request->>'evidenceHash' !~ '^[a-f0-9]{64}$'
        OR p_request->>'evidenceHash' IS DISTINCT FROM encode(sha256(convert_to(btrim(p_request->>'evidenceRef'),'UTF8')),'hex')
        OR jsonb_typeof(p_request->'kind') IS DISTINCT FROM 'string' OR p_request->>'kind' NOT IN ('points_refund','manual_compensation') THEN
        RAISE EXCEPTION 'supplier_resolution_invalid_request'; END IF;
    v_kind := p_request->>'kind';
    v_hash := encode(sha256(convert_to(p_request::TEXT,'UTF8')),'hex');
    -- Global lock order: native -> unit -> policy -> intent -> attempt.
    IF p_funding_kind = 'points' THEN
        SELECT * INTO v_order FROM public.shop_orders WHERE id = p_native_order_id AND site = 'cn'
            AND fulfillment_source = 'supplier_v2' FOR UPDATE;
    ELSE
        SELECT * INTO v_guest FROM public.guest_shop_orders WHERE id = p_native_order_id AND site = 'cn'
            AND fulfillment_source = 'supplier_v2' FOR UPDATE;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'supplier_resolution_order_missing'; END IF;
    SELECT * INTO v_unit FROM public.shop_supplier_fulfillment_units WHERE funding_kind = p_funding_kind AND site = 'cn'
        AND COALESCE(shop_order_id,guest_order_id) = p_native_order_id FOR UPDATE;
    IF NOT FOUND OR v_unit.funding_state <> 'funded' THEN RAISE EXCEPTION 'supplier_resolution_not_funded'; END IF;
    PERFORM 1 FROM public.shop_supplier_transaction_policies WHERE supplier_account_id = v_unit.supplier_account_id FOR UPDATE;
    SELECT * INTO STRICT v_intent FROM public.shop_supplier_procurement_intents WHERE unit_id = v_unit.id FOR UPDATE;
    PERFORM 1 FROM public.shop_supplier_dispatch_attempts WHERE intent_id = v_intent.id FOR UPDATE;
    SELECT * INTO v_existing FROM public.shop_supplier_customer_resolutions WHERE operation_id = p_operation_id;
    IF FOUND THEN
        IF v_existing.unit_id IS DISTINCT FROM v_unit.id OR v_existing.request_hash IS DISTINCT FROM v_hash
            OR v_existing.actor_id IS DISTINCT FROM p_actor_id THEN RAISE EXCEPTION 'supplier_resolution_idempotency_conflict'; END IF;
        RETURN v_existing.result;
    END IF;
    IF EXISTS (SELECT 1 FROM public.shop_supplier_customer_resolutions WHERE unit_id = v_unit.id) THEN
        RAISE EXCEPTION 'supplier_resolution_already_completed'; END IF;
    -- No revocation of goods already delivered or accessed. Late goods after
    -- close will fail native readiness and remain encrypted/quarantined.
    IF EXISTS (SELECT 1 FROM public.shop_supplier_delivery_receipts WHERE unit_id = v_unit.id AND disposition = 'delivered') THEN
        RAISE EXCEPTION 'supplier_resolution_already_delivered'; END IF;
    v_amount := (p_request->>'amount')::NUMERIC;
    IF p_funding_kind = 'points' THEN
        IF v_kind <> 'points_refund' OR v_order.user_id IS DISTINCT FROM v_unit.buyer_user_id
            OR v_order.price_paid IS DISTINCT FROM v_unit.sale_amount OR v_amount IS DISTINCT FROM v_unit.sale_amount
            OR COALESCE(v_order.refund_status,'none') <> 'none' OR COALESCE(v_order.delivery_status,'') NOT IN ('pending','failed')
            OR v_order.inventory_id IS NOT NULL OR v_order.delivery_task_id IS NOT NULL
            OR v_order.delivery_completed_at IS NOT NULL OR v_order.item_count IS DISTINCT FROM 1
            OR COALESCE(v_order.discount_amount,0) <> 0 THEN RAISE EXCEPTION 'supplier_resolution_not_applicable'; END IF;
        v_paid := v_order.paid_points_spent; v_bonus := v_order.bonus_points_spent;
        IF v_paid IS NULL OR v_bonus IS NULL OR v_paid < 0 OR v_bonus < 0 OR v_paid + v_bonus IS DISTINCT FROM v_amount THEN
            RAISE EXCEPTION 'supplier_resolution_points_breakdown_required'; END IF;
        v_reference := 'REFUND_' || v_order.id::TEXT;
        IF EXISTS (SELECT 1 FROM public.points_ledger WHERE user_id = v_order.user_id AND reference_id = v_reference AND site = 'cn') THEN
            RAISE EXCEPTION 'supplier_resolution_refund_conflict'; END IF;
        v_recharge := public.fn_recharge_points(v_order.user_id,v_paid,v_bonus,'订单退款: 供应商订单结案',v_reference,'cn'::VARCHAR);
        IF v_recharge->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'supplier_resolution_refund_failed'; END IF;
        -- A pre-existing or concurrently credited reference is a conflict, not
        -- proof that this resolution refunded the original paid/bonus split.
        IF v_recharge->>'deduped' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'supplier_resolution_refund_conflict'; END IF;
    ELSE
        IF v_kind <> 'manual_compensation' OR v_guest.payment_status IS DISTINCT FROM 'confirmed'
            OR v_guest.refund_status IS DISTINCT FROM 'none'
            OR COALESCE(v_guest.fulfillment_status,'') NOT IN ('pending','failed','dead_letter','paid_unfulfillable')
            OR v_guest.fulfilled_at IS NOT NULL OR v_guest.paid_at IS NULL OR v_guest.currency IS DISTINCT FROM 'CNY'
            OR v_guest.quantity IS DISTINCT FROM 1 OR v_guest.reservation_status IS DISTINCT FROM 'none'
            OR v_guest.unit_amount IS DISTINCT FROM v_unit.sale_amount
            OR v_guest.total_amount - COALESCE(v_guest.payment_fee_amount,0) IS DISTINCT FROM v_unit.sale_amount
            OR v_amount IS DISTINCT FROM v_guest.total_amount THEN RAISE EXCEPTION 'supplier_resolution_not_applicable'; END IF;
        -- No payment/refund RPC is called. Record only externally completed,
        -- administrator-attested compensation including the original channel fee.
    END IF;
    v_now := clock_timestamp();
    v_public := jsonb_build_object('status',CASE WHEN v_kind = 'points_refund' THEN 'refunded' ELSE 'compensated' END,
        'method',v_kind,'message',btrim(p_request->>'publicNote'),'resolved_at',v_now);
    IF p_funding_kind = 'points' THEN
        v_projection := jsonb_build_object('refund_status','refunded','delivery_status','refunded',
            'delivery_updated_at',v_now,'delivery_last_error',NULL,
            'points_spend_breakdown',COALESCE(v_order.points_spend_breakdown,'{}'::JSONB) || jsonb_build_object(
                'refund_status','refunded','refund_paid_points',v_paid,'refund_bonus_points',v_bonus,'refund_reference',v_reference),
            'supplier_customer_resolution',v_public);
    ELSE
        v_projection := jsonb_build_object('fulfillment_status','failed','updated_at',v_now,'supplier_customer_resolution',v_public);
    END IF;
    v_result := jsonb_build_object('status','completed','operationId',p_operation_id,'nativeOrderId',p_native_order_id,
        'fundingKind',p_funding_kind,'resolution',v_public,'amount',v_amount::TEXT,'upstreamRisk','retained');
    INSERT INTO public.shop_supplier_customer_resolutions(operation_id,unit_id,actor_id,request_hash,kind,amount,currency,
        evidence_ref,evidence_hash,internal_note,customer_result,native_projection,result,created_at)
    VALUES (p_operation_id,v_unit.id,p_actor_id,v_hash,v_kind,v_amount,CASE WHEN v_kind = 'points_refund' THEN 'POINTS' ELSE 'CNY' END,
        btrim(p_request->>'evidenceRef'),p_request->>'evidenceHash',btrim(p_request->>'internalNote'),v_public,v_projection,v_result,v_now);
    IF p_funding_kind = 'points' THEN
        UPDATE public.shop_orders SET refund_status = 'refunded',delivery_status = 'refunded',delivery_updated_at = v_now,
            delivery_last_error = NULL,points_spend_breakdown = v_projection->'points_spend_breakdown',supplier_customer_resolution = v_public,
            supplier_dispatch_version = supplier_dispatch_version + 1 WHERE id = p_native_order_id;
    ELSE
        UPDATE public.guest_shop_orders SET fulfillment_status = 'failed',updated_at = v_now,supplier_customer_resolution = v_public,
            supplier_dispatch_version = supplier_dispatch_version + 1 WHERE id = p_native_order_id;
    END IF;
    UPDATE public.shop_supplier_transaction_outbox SET status = 'review',block_reason = 'customer_resolution_required'
        WHERE intent_id = v_intent.id;
    -- Upstream request, state, debit, encrypted receipt and risk reservation are
    -- deliberately retained for query-only reconciliation and recovery.
    RETURN v_result;
END; $$;

CREATE OR REPLACE FUNCTION public.fn_shop_supplier_customer_delivery_v2(
    p_order_id UUID, p_funding_kind TEXT, p_buyer_user_id UUID DEFAULT NULL, p_site TEXT DEFAULT 'cn'
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_unit public.shop_supplier_fulfillment_units%ROWTYPE;
    v_receipt public.shop_supplier_delivery_receipts%ROWTYPE;
    v_order public.shop_orders%ROWTYPE;
    v_guest public.guest_shop_orders%ROWTYPE;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'supplier_service_role_required'; END IF;
    IF p_order_id IS NULL OR p_funding_kind IS NULL OR p_funding_kind NOT IN ('points','guest_cash')
        OR p_site IS DISTINCT FROM 'cn' THEN RAISE EXCEPTION 'supplier_delivery_forbidden'; END IF;
    IF p_funding_kind = 'points' THEN
        SELECT * INTO v_order FROM public.shop_orders WHERE id = p_order_id AND user_id = p_buyer_user_id
            AND site = p_site AND fulfillment_source = 'supplier_v2' FOR SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION 'supplier_delivery_forbidden'; END IF;
    ELSE
        IF p_buyer_user_id IS NOT NULL THEN RAISE EXCEPTION 'supplier_delivery_forbidden'; END IF;
        SELECT * INTO v_guest FROM public.guest_shop_orders WHERE id = p_order_id AND site = p_site
            AND fulfillment_source = 'supplier_v2' FOR SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION 'supplier_delivery_forbidden'; END IF;
    END IF;
    SELECT * INTO v_unit FROM public.shop_supplier_fulfillment_units WHERE funding_kind = p_funding_kind AND site = p_site
        AND ((p_funding_kind = 'points' AND shop_order_id = p_order_id AND buyer_user_id = p_buyer_user_id)
            OR (p_funding_kind = 'guest_cash' AND guest_order_id = p_order_id)) FOR SHARE;
    IF NOT FOUND OR v_unit.funding_state <> 'funded' THEN RAISE EXCEPTION 'supplier_delivery_forbidden'; END IF;
    IF EXISTS (SELECT 1 FROM public.shop_supplier_customer_resolutions WHERE unit_id = v_unit.id) THEN
        RETURN jsonb_build_object('status','closed');
    END IF;
    SELECT * INTO v_receipt FROM public.shop_supplier_delivery_receipts WHERE unit_id = v_unit.id;
    IF NOT FOUND OR v_receipt.disposition <> 'delivered' THEN RETURN jsonb_build_object('status','pending'); END IF;
    IF p_funding_kind = 'points' THEN
        IF NOT public.shop_supplier_delivery_projection_matches_v2('shop_orders',to_jsonb(v_order)) THEN
            RAISE EXCEPTION 'supplier_delivery_forbidden'; END IF;
    ELSE
        IF NOT public.shop_supplier_delivery_projection_matches_v2('guest_shop_orders',to_jsonb(v_guest)) THEN
            RAISE EXCEPTION 'supplier_delivery_forbidden'; END IF;
    END IF;
    INSERT INTO public.shop_supplier_delivery_access_events(unit_id,access_kind,buyer_user_id)
        VALUES (v_unit.id,CASE WHEN p_funding_kind = 'points' THEN 'customer_points' ELSE 'customer_guest' END,p_buyer_user_id);
    RETURN jsonb_build_object('status','delivered','unitId',v_unit.id,'intentId',v_receipt.intent_id,
        'orderNo',v_receipt.supplier_order_no,'sealed',v_receipt.sealed);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_shop_supplier_operations_v2(
    p_provider_id TEXT DEFAULT NULL, p_account_key TEXT DEFAULT NULL, p_limit INTEGER DEFAULT 50,
    p_native_order_id UUID DEFAULT NULL, p_funding_kind TEXT DEFAULT NULL, p_site TEXT DEFAULT 'cn'
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_result JSONB;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'supplier_service_role_required'; END IF;
    IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_site IS DISTINCT FROM 'cn'
        OR (p_provider_id IS NOT NULL AND p_provider_id !~ '^[a-z0-9][a-z0-9._-]{0,79}$')
        OR (p_account_key IS NOT NULL AND p_account_key !~ '^[a-z0-9][a-z0-9_-]{0,63}$')
        OR (p_funding_kind IS NOT NULL AND p_funding_kind NOT IN ('points','guest_cash'))
        OR (p_native_order_id IS NOT NULL AND p_funding_kind IS NULL) THEN
        RAISE EXCEPTION 'supplier_operations_invalid_request';
    END IF;
    WITH bounded AS (
        SELECT u.id, u.created_at,
            jsonb_build_object(
                'intentId',i.id,'nativeOrderId',COALESCE(u.shop_order_id,u.guest_order_id),
                'orderNo',COALESCE(g.order_no,u.shop_order_id::TEXT),'fundingKind',u.funding_kind,'site',u.site,
                'productName',COALESCE(o.snapshot_product_name,g.snapshot_product_name,''),
                'procurementState',i.status,'originalRequestId',i.original_request_id,'supplierOrderNo',i.supplier_order_no,
                'deliveryState',CASE WHEN r.unit_id IS NOT NULL THEN r.disposition
                    WHEN i.status = 'accepted' THEN 'awaiting_delivery' ELSE 'awaiting_acceptance' END,
                'actualCostCny',r.actual_cost_cny::TEXT,
                'costVerified',r.unit_id IS NOT NULL AND r.actual_cost_cny IS NOT DISTINCT FROM i.actual_cost_cny,
                'exposureStatus',i.exposure_status,'reservedCostCny',i.reserved_cost_cny::TEXT,
                'quarantineReason',r.quarantine_reason,'canRefund',false,
                'customerResolution',c.customer_result,'resolutionOperationId',c.operation_id,
                'resolutionAmount',(CASE WHEN u.funding_kind = 'points' THEN u.sale_amount ELSE g.total_amount END)::TEXT,
                'canResolve',COALESCE(c.unit_id IS NULL AND u.funding_state = 'funded'
                    AND COALESCE(r.disposition,'') <> 'delivered' AND (CASE WHEN u.funding_kind = 'points' THEN
                        o.fulfillment_source = 'supplier_v2' AND o.user_id = u.buyer_user_id AND o.price_paid = u.sale_amount
                        AND u.sale_amount > 0 AND COALESCE(o.refund_status,'none') = 'none' AND o.delivery_status IN ('pending','failed')
                        AND o.inventory_id IS NULL AND o.delivery_task_id IS NULL AND o.delivery_completed_at IS NULL
                        AND o.item_count = 1 AND COALESCE(o.discount_amount,0) = 0
                        AND o.paid_points_spent >= 0 AND o.bonus_points_spent >= 0
                        AND o.paid_points_spent + o.bonus_points_spent = u.sale_amount
                        AND NOT EXISTS (SELECT 1 FROM public.points_ledger l WHERE l.user_id = o.user_id
                            AND l.reference_id = 'REFUND_' || o.id::TEXT AND l.site = 'cn')
                    ELSE g.fulfillment_source = 'supplier_v2' AND g.payment_status = 'confirmed' AND g.refund_status = 'none'
                        AND g.fulfillment_status IN ('pending','failed','dead_letter','paid_unfulfillable')
                        AND g.fulfilled_at IS NULL AND g.paid_at IS NOT NULL AND g.currency = 'CNY'
                        AND g.quantity = 1 AND g.reservation_status = 'none' AND g.unit_amount = u.sale_amount
                        AND g.total_amount - COALESCE(g.payment_fee_amount,0) = u.sale_amount AND g.total_amount > 0
                    END),false),
                'createdAt',u.created_at,'deliveredAt',CASE WHEN r.disposition = 'delivered' THEN r.created_at END
            ) AS payload
        FROM public.shop_supplier_fulfillment_units u
        JOIN public.shop_supplier_procurement_intents i ON i.unit_id = u.id
        JOIN public.shop_supplier_accounts a ON a.id = u.supplier_account_id
        LEFT JOIN public.shop_supplier_delivery_receipts r ON r.unit_id = u.id AND r.intent_id = i.id
        LEFT JOIN public.shop_supplier_customer_resolutions c ON c.unit_id = u.id
        LEFT JOIN public.shop_orders o ON o.id = u.shop_order_id
        LEFT JOIN public.guest_shop_orders g ON g.id = u.guest_order_id
        WHERE u.site = p_site AND (p_provider_id IS NULL OR a.provider_id = p_provider_id)
            AND (p_account_key IS NULL OR a.account_key = p_account_key)
            AND (p_funding_kind IS NULL OR u.funding_kind = p_funding_kind)
            AND (p_native_order_id IS NULL OR COALESCE(u.shop_order_id,u.guest_order_id) = p_native_order_id)
        ORDER BY u.created_at DESC,u.id DESC LIMIT p_limit + 1
    ), visible AS (SELECT * FROM bounded ORDER BY created_at DESC,id DESC LIMIT p_limit)
    SELECT jsonb_build_object('rows',COALESCE((SELECT jsonb_agg(payload ORDER BY created_at DESC,id DESC) FROM visible),'[]'::JSONB),
        'hasMore',(SELECT count(*) > p_limit FROM bounded),'limit',p_limit) INTO v_result;
    RETURN v_result;
END;
$$;

-- Extend the existing content-free admin view without dropping its columns or grants.
DO $$ DECLARE v_definition TEXT; v_extra TEXT := ''; BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
        AND table_name = 'admin_guest_shop_orders' AND column_name = 'supplier_customer_resolution') THEN
        v_definition := rtrim(pg_get_viewdef('public.admin_guest_shop_orders'::REGCLASS,true), E';\n ');
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
            AND table_name = 'admin_guest_shop_orders' AND column_name = 'fulfillment_source') THEN
            v_extra := ', native.fulfillment_source';
        END IF;
        EXECUTE 'CREATE OR REPLACE VIEW public.admin_guest_shop_orders WITH (security_invoker = on) AS '
            || 'SELECT prior.*' || v_extra || ', native.supplier_customer_resolution FROM (' || v_definition
            || ') prior JOIN public.guest_shop_orders native ON native.id = prior.id';
    END IF;
END; $$;

-- Query-only recovery, independent of current intake switches/mapping/quote TTL.
-- Never invokes checkout or procurement, even when the original request is absent.
CREATE OR REPLACE FUNCTION public.fn_shop_supplier_recover_points_v2(p_operation_id UUID,p_buyer_user_id UUID,p_site TEXT DEFAULT 'cn')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_quote public.shop_supplier_checkout_quotes%ROWTYPE; v_order public.shop_orders%ROWTYPE;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'supplier_service_role_required'; END IF;
    IF p_operation_id IS NULL OR p_buyer_user_id IS NULL OR p_site IS DISTINCT FROM 'cn' THEN
        RAISE EXCEPTION 'supplier_recovery_forbidden'; END IF;
    SELECT * INTO v_quote FROM public.shop_supplier_checkout_quotes WHERE operation_id = p_operation_id
        AND funding_kind = 'points' AND buyer_user_id = p_buyer_user_id FOR SHARE;
    IF NOT FOUND OR v_quote.status <> 'consumed' THEN RETURN jsonb_build_object('status','unconfirmed'); END IF;
    SELECT * INTO STRICT v_order FROM public.shop_orders WHERE id = v_quote.shop_order_id
        AND user_id = p_buyer_user_id AND site = p_site AND fulfillment_source = 'supplier_v2' FOR SHARE;
    RETURN jsonb_build_object('status','confirmed','orderId',v_order.id,'resolution',v_order.supplier_customer_resolution);
END; $$;
REVOKE ALL ON FUNCTION public.shop_supplier_resolution_projection_matches_v2(TEXT,JSONB,JSONB),
    public.shop_supplier_resolution_native_guard_v2(),
    public.fn_shop_supplier_resolve_customer_v2(TEXT,UUID,UUID,UUID,TEXT,JSONB),
    public.fn_shop_supplier_recover_points_v2(UUID,UUID,TEXT) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.fn_shop_supplier_resolve_customer_v2(TEXT,UUID,UUID,UUID,TEXT,JSONB),
    public.fn_shop_supplier_recover_points_v2(UUID,UUID,TEXT) TO service_role;
COMMENT ON TABLE public.shop_supplier_customer_resolutions IS
    'Immutable customer resolution; compensation is an admin attestation, not channel refund. Upstream uncertainty and actual cost retained. Business/concurrency acceptance NOT RUN.';
COMMIT;
