-- ============================================================================
-- P2E: operator-controlled manual purchase (Plan B).
--
-- Scope: an administrator may purchase ONE unit for an already funded native
-- order, after the server shows the live CNY quote and the administrator
-- explicitly confirms it. Nothing here enables automated dispatch, a worker, a
-- timer or any policy switch. `fn_shop_supplier_dispatch_v2` keeps its four
-- merchant-verification gates; this migration does not relax them.
--
-- Money safety: the upstream request key is the intent's immutable
-- `original_request_id`, so a retried manual attempt can never debit twice. The
-- quote is compared with the authorised cost ceiling BEFORE any debit, and the
-- debited amount is verified AFTER the debit.
-- Apply manually AFTER P2D. No proof rows, switches or policies are seeded.
-- ============================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
    IF to_regprocedure('public.fn_shop_supplier_record_delivery_v2(uuid,jsonb)') IS NULL
        OR to_regprocedure('public.fn_shop_supplier_operations_v2(text,text,integer,uuid,text,text)') IS NULL
        OR to_regprocedure('public.fn_shop_supplier_customer_delivery_v2(uuid,text,uuid,text)') IS NULL THEN
        RAISE EXCEPTION 'Supplier P2B/P2C/P2D migrations are required before P2E';
    END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.shop_supplier_manual_purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    intent_id UUID NOT NULL UNIQUE REFERENCES public.shop_supplier_procurement_intents(id) ON DELETE RESTRICT,
    unit_id UUID NOT NULL REFERENCES public.shop_supplier_fulfillment_units(id) ON DELETE RESTRICT,
    supplier_account_id UUID NOT NULL REFERENCES public.shop_supplier_accounts(id) ON DELETE RESTRICT,
    original_request_id UUID NOT NULL,
    operator_admin_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    confirmed_by_admin_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
    state TEXT NOT NULL CHECK (state IN ('quoted','confirmed','accepted','unknown','rejected','expired','abandoned')),
    attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
    quote_currency TEXT NOT NULL DEFAULT 'CNY' CHECK (quote_currency = 'CNY'),
    quoted_amount_cny NUMERIC(18,6) NOT NULL CHECK (quoted_amount_cny >= 0 AND quoted_amount_cny <> 'NaN'::NUMERIC),
    cost_ceiling_cny NUMERIC(18,6) NOT NULL CHECK (cost_ceiling_cny > 0 AND cost_ceiling_cny <> 'NaN'::NUMERIC),
    quoted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    quote_expires_at TIMESTAMPTZ NOT NULL,
    confirmed_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    supplier_order_no TEXT CHECK (supplier_order_no ~ '^[[:alnum:]_.:-]{1,160}$'),
    actual_amount_cny NUMERIC(18,6) CHECK (actual_amount_cny IS NULL
        OR (actual_amount_cny >= 0 AND actual_amount_cny <> 'NaN'::NUMERIC)),
    failure_code TEXT CHECK (failure_code IS NULL OR failure_code ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT shop_supplier_manual_quote_window_check CHECK (quote_expires_at > quoted_at),
    -- A quote alone can never carry an order number or a debit; only the
    -- confirmed-then-recorded path may publish the supplier order.
    CONSTRAINT shop_supplier_manual_purchase_state_check CHECK (
        (state = 'quoted' AND confirmed_at IS NULL AND submitted_at IS NULL
            AND supplier_order_no IS NULL AND actual_amount_cny IS NULL AND failure_code IS NULL)
        OR (state = 'expired' AND supplier_order_no IS NULL AND actual_amount_cny IS NULL)
        OR (state = 'abandoned' AND supplier_order_no IS NULL AND actual_amount_cny IS NULL)
        -- The confirm step stamps submitted_at at the same instant it claims
        -- the quote, so a confirmed row always carries it. A confirmed row may
        -- also carry the order number the supplier just returned, so a crash
        -- between the debit and the receipt can still be finalised. Only an
        -- accepted row may carry the order number *and* the debited amount.
        OR (state = 'confirmed' AND confirmed_at IS NOT NULL AND submitted_at IS NOT NULL
            AND failure_code IS NULL
            AND (supplier_order_no IS NULL) = (actual_amount_cny IS NULL))
        OR (state = 'accepted' AND confirmed_at IS NOT NULL AND submitted_at IS NOT NULL
            AND supplier_order_no IS NOT NULL AND actual_amount_cny IS NOT NULL)
        OR (state = 'unknown' AND confirmed_at IS NOT NULL AND submitted_at IS NOT NULL
            AND supplier_order_no IS NULL AND actual_amount_cny IS NULL AND failure_code IS NOT NULL)
        OR (state = 'rejected' AND supplier_order_no IS NULL AND actual_amount_cny IS NULL
            AND failure_code IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_supplier_manual_purchases_state
    ON public.shop_supplier_manual_purchases (state, quote_expires_at);

CREATE TABLE IF NOT EXISTS public.shop_supplier_manual_purchase_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_id UUID NOT NULL REFERENCES public.shop_supplier_manual_purchases(id) ON DELETE RESTRICT,
    intent_id UUID NOT NULL REFERENCES public.shop_supplier_procurement_intents(id) ON DELETE RESTRICT,
    event_kind TEXT NOT NULL CHECK (event_kind IN ('quoted','quote_expired','confirmed','submitted',
        'accepted','unknown','rejected')),
    actor_admin_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
    -- Amounts, states and hashes only. Never a card secret, credential or
    -- signature.
    detail JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(detail) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_supplier_manual_events_purchase
    ON public.shop_supplier_manual_purchase_events (purchase_id, created_at);

ALTER TABLE public.shop_supplier_manual_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_supplier_manual_purchase_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_supplier_manual_purchases, public.shop_supplier_manual_purchase_events
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.shop_supplier_manual_purchases, public.shop_supplier_manual_purchase_events TO service_role;

CREATE OR REPLACE FUNCTION public.shop_supplier_manual_events_immutable_v2() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'supplier_manual_event_immutable';
END;
$$;
DROP TRIGGER IF EXISTS tr_supplier_manual_events_immutable_v2 ON public.shop_supplier_manual_purchase_events;
CREATE TRIGGER tr_supplier_manual_events_immutable_v2 BEFORE UPDATE OR DELETE
    ON public.shop_supplier_manual_purchase_events
    FOR EACH ROW EXECUTE FUNCTION public.shop_supplier_manual_events_immutable_v2();

-- ---------------------------------------------------------------------------
-- Read-only eligibility projection. The administrator UI needs the supplier
-- goods number and the authorised ceiling BEFORE it asks the supplier for a
-- live quote, so this is a separate, side-effect free read.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_shop_supplier_manual_context_v2(p_intent_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_unit public.shop_supplier_fulfillment_units%ROWTYPE;
    v_intent public.shop_supplier_procurement_intents%ROWTYPE;
    v_policy public.shop_supplier_transaction_policies%ROWTYPE;
    v_mapping public.shop_supplier_product_mappings%ROWTYPE;
    v_account public.shop_supplier_accounts%ROWTYPE;
    v_purchase public.shop_supplier_manual_purchases%ROWTYPE;
    v_order public.shop_orders%ROWTYPE;
    v_guest public.guest_shop_orders%ROWTYPE;
    v_native_ready BOOLEAN := false;
    v_reason TEXT;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'supplier_service_role_required'; END IF;
    IF p_intent_id IS NULL THEN RAISE EXCEPTION 'supplier_manual_invalid_request'; END IF;
    SELECT u.* INTO v_unit FROM public.shop_supplier_fulfillment_units u
        JOIN public.shop_supplier_procurement_intents i ON i.unit_id = u.id WHERE i.id = p_intent_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'supplier_manual_intent_missing'; END IF;
    SELECT * INTO STRICT v_intent FROM public.shop_supplier_procurement_intents WHERE id = p_intent_id;
    IF v_unit.funding_kind = 'points' THEN
        SELECT * INTO STRICT v_order FROM public.shop_orders WHERE id = v_unit.shop_order_id;
        v_native_ready := v_order.fulfillment_source = 'supplier_v2' AND v_order.delivery_status = 'pending'
            AND COALESCE(v_order.refund_status, 'none') = 'none' AND v_order.item_count = 1
            AND v_order.site = v_unit.site AND v_order.product_id = v_unit.product_id AND v_order.sku_id = v_unit.sku_id
            AND v_order.user_id = v_unit.buyer_user_id AND v_order.price_paid = v_unit.sale_amount
            AND COALESCE(v_order.discount_amount, 0) = 0 AND COALESCE(v_order.discount_refund_amount, 0) = 0
            AND v_order.delivery_completed_at IS NULL AND v_order.inventory_id IS NULL AND v_order.delivery_task_id IS NULL;
    ELSE
        SELECT * INTO STRICT v_guest FROM public.guest_shop_orders WHERE id = v_unit.guest_order_id;
        v_native_ready := v_guest.fulfillment_source = 'supplier_v2' AND v_guest.payment_status = 'confirmed'
            AND v_guest.fulfillment_status = 'pending' AND v_guest.refund_status = 'none'
            AND v_guest.reservation_status = 'none' AND v_guest.paid_at IS NOT NULL AND v_guest.fulfilled_at IS NULL
            AND v_guest.site = v_unit.site AND v_guest.product_id = v_unit.product_id AND v_guest.sku_id = v_unit.sku_id
            AND v_guest.currency = 'CNY' AND v_guest.quantity = 1 AND v_guest.unit_amount = v_unit.sale_amount
            AND v_guest.total_amount - COALESCE(v_guest.payment_fee_amount, 0) = v_unit.sale_amount;
    END IF;
    SELECT * INTO v_policy FROM public.shop_supplier_transaction_policies
        WHERE supplier_account_id = v_unit.supplier_account_id;
    SELECT * INTO v_mapping FROM public.shop_supplier_product_mappings WHERE id = v_unit.mapping_id;
    SELECT * INTO v_account FROM public.shop_supplier_accounts WHERE id = v_unit.supplier_account_id;
    SELECT * INTO v_purchase FROM public.shop_supplier_manual_purchases WHERE intent_id = v_intent.id;
    IF v_purchase.state IN ('accepted') THEN v_reason := 'manual_purchase_accepted';
    ELSIF v_purchase.state IN ('unknown') THEN v_reason := 'manual_purchase_unknown';
    ELSIF v_purchase.state IN ('confirmed') THEN v_reason := 'manual_purchase_in_progress';
    ELSIF v_intent.status <> 'not_submitted' THEN v_reason := 'intent_not_submitted';
    ELSIF v_unit.funding_state <> 'funded' THEN v_reason := 'funding_not_ready';
    ELSIF v_unit.site <> 'cn' OR v_unit.quantity <> 1 THEN v_reason := 'scope_unsupported';
    ELSIF v_intent.exposure_status <> 'held'
        OR v_intent.reserved_cost_cny IS DISTINCT FROM v_unit.cost_ceiling_cny THEN v_reason := 'exposure_not_held';
    ELSIF NOT COALESCE(v_native_ready, false) THEN v_reason := 'native_not_ready';
    ELSIF v_policy.supplier_account_id IS NULL OR NOT v_policy.intake_enabled
        OR NOT v_policy.checkout_enabled OR v_unit.cost_ceiling_cny > v_policy.per_unit_cost_ceiling_cny THEN
        v_reason := 'policy_not_ready';
    ELSIF v_mapping.id IS NULL OR NOT v_mapping.is_enabled OR NOT v_mapping.is_primary
        OR v_mapping.contract_version <> 2 OR v_mapping.site IS DISTINCT FROM v_unit.site
        OR v_mapping.supplier_account_id IS DISTINCT FROM v_unit.supplier_account_id
        OR v_mapping.product_id IS DISTINCT FROM v_unit.product_id
        OR v_mapping.sku_id IS DISTINCT FROM v_unit.sku_id
        OR v_mapping.updated_at IS DISTINCT FROM v_unit.mapping_revision
        OR v_mapping.supplier_goods_no IS DISTINCT FROM v_unit.source_snapshot->>'goods_no'
        OR v_mapping.supplier_variant IS DISTINCT FROM v_unit.source_snapshot->'variant'
        OR v_mapping.supplier_variant_key IS DISTINCT FROM v_unit.source_snapshot->>'variant_key' THEN
        v_reason := 'mapping_not_ready';
    ELSIF v_account.id IS NULL OR NOT v_account.is_enabled
        OR v_account.provider_id IS DISTINCT FROM v_unit.source_snapshot->>'provider_id' THEN
        v_reason := 'account_not_ready';
    END IF;
    RETURN jsonb_build_object(
        'status', CASE WHEN v_reason IS NULL THEN 'ready' ELSE 'blocked' END,
        'reason', v_reason,
        'intentId', v_intent.id,
        'nativeOrderId', COALESCE(v_unit.shop_order_id, v_unit.guest_order_id),
        'fundingKind', v_unit.funding_kind,
        'site', v_unit.site,
        'requestId', v_intent.original_request_id,
        'goodsNo', v_mapping.supplier_goods_no,
        'variant', COALESCE(v_mapping.supplier_variant, '{}'::JSONB),
        'quantity', 1,
        'costCeilingCny', v_unit.cost_ceiling_cny::TEXT,
        'perUnitCeilingCny', COALESCE(v_policy.per_unit_cost_ceiling_cny, 0)::TEXT,
        'providerId', v_account.provider_id,
        'purchaseId', v_purchase.id,
        'purchaseState', v_purchase.state,
        'attemptCount', COALESCE(v_purchase.attempt_count, 0),
        'quotedAmountCny', v_purchase.quoted_amount_cny::TEXT,
        'quoteExpiresAt', v_purchase.quote_expires_at,
        'supplierOrderNo', v_purchase.supplier_order_no
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- Step 1 of the manual purchase: record the live CNY quote the server just read
-- from the supplier. No money moves here and no order number exists yet.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_shop_supplier_manual_quote_v2(
    p_intent_id UUID, p_admin_id UUID, p_quoted_amount_cny TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_unit public.shop_supplier_fulfillment_units%ROWTYPE;
    v_intent public.shop_supplier_procurement_intents%ROWTYPE;
    v_policy public.shop_supplier_transaction_policies%ROWTYPE;
    v_mapping public.shop_supplier_product_mappings%ROWTYPE;
    v_account public.shop_supplier_accounts%ROWTYPE;
    v_purchase public.shop_supplier_manual_purchases%ROWTYPE;
    v_order public.shop_orders%ROWTYPE;
    v_guest public.guest_shop_orders%ROWTYPE;
    v_native_ready BOOLEAN := false;
    v_amount NUMERIC(18,6);
    v_now TIMESTAMPTZ;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'supplier_service_role_required'; END IF;
    IF p_intent_id IS NULL OR p_admin_id IS NULL OR p_quoted_amount_cny IS NULL
        OR p_quoted_amount_cny !~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' THEN
        RAISE EXCEPTION 'supplier_manual_invalid_request';
    END IF;
    v_amount := p_quoted_amount_cny::NUMERIC;
    IF v_amount < 0 OR v_amount <> v_amount THEN RAISE EXCEPTION 'supplier_manual_invalid_request'; END IF;
    -- Same lock order as dispatch: native order -> funding unit -> policy ->
    -- intent -> manual purchase.
    SELECT u.* INTO v_unit FROM public.shop_supplier_fulfillment_units u
        JOIN public.shop_supplier_procurement_intents i ON i.unit_id = u.id WHERE i.id = p_intent_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'supplier_manual_intent_missing'; END IF;
    IF v_unit.funding_kind = 'points' THEN
        SELECT * INTO STRICT v_order FROM public.shop_orders WHERE id = v_unit.shop_order_id FOR UPDATE;
        v_native_ready := v_order.fulfillment_source = 'supplier_v2' AND v_order.delivery_status = 'pending'
            AND COALESCE(v_order.refund_status, 'none') = 'none' AND v_order.item_count = 1
            AND v_order.site = v_unit.site AND v_order.product_id = v_unit.product_id AND v_order.sku_id = v_unit.sku_id
            AND v_order.user_id = v_unit.buyer_user_id AND v_order.price_paid = v_unit.sale_amount
            AND COALESCE(v_order.discount_amount, 0) = 0 AND COALESCE(v_order.discount_refund_amount, 0) = 0
            AND v_order.delivery_completed_at IS NULL AND v_order.inventory_id IS NULL AND v_order.delivery_task_id IS NULL;
    ELSE
        SELECT * INTO STRICT v_guest FROM public.guest_shop_orders WHERE id = v_unit.guest_order_id FOR UPDATE;
        v_native_ready := v_guest.fulfillment_source = 'supplier_v2' AND v_guest.payment_status = 'confirmed'
            AND v_guest.fulfillment_status = 'pending' AND v_guest.refund_status = 'none'
            AND v_guest.reservation_status = 'none' AND v_guest.paid_at IS NOT NULL AND v_guest.fulfilled_at IS NULL
            AND v_guest.site = v_unit.site AND v_guest.product_id = v_unit.product_id AND v_guest.sku_id = v_unit.sku_id
            AND v_guest.currency = 'CNY' AND v_guest.quantity = 1 AND v_guest.unit_amount = v_unit.sale_amount
            AND v_guest.total_amount - COALESCE(v_guest.payment_fee_amount, 0) = v_unit.sale_amount;
    END IF;
    SELECT * INTO STRICT v_unit FROM public.shop_supplier_fulfillment_units WHERE id = v_unit.id FOR UPDATE;
    SELECT * INTO STRICT v_policy FROM public.shop_supplier_transaction_policies
        WHERE supplier_account_id = v_unit.supplier_account_id FOR UPDATE;
    SELECT * INTO STRICT v_intent FROM public.shop_supplier_procurement_intents WHERE id = p_intent_id FOR UPDATE;
    SELECT * INTO v_purchase FROM public.shop_supplier_manual_purchases WHERE intent_id = v_intent.id FOR UPDATE;
    v_now := clock_timestamp();

    IF v_purchase.state IN ('confirmed','accepted','unknown') THEN
        RETURN jsonb_build_object('status', 'blocked', 'reason',
            CASE v_purchase.state WHEN 'confirmed' THEN 'manual_purchase_in_progress'
                WHEN 'accepted' THEN 'manual_purchase_accepted' ELSE 'manual_purchase_unknown' END,
            'purchaseId', v_purchase.id, 'purchaseState', v_purchase.state);
    END IF;
    IF v_intent.status <> 'not_submitted' THEN
        RETURN jsonb_build_object('status', 'blocked', 'reason', 'intent_not_submitted', 'intentStatus', v_intent.status);
    END IF;
    IF v_unit.funding_state <> 'funded' THEN
        RETURN jsonb_build_object('status', 'blocked', 'reason', 'funding_not_ready');
    END IF;
    IF v_unit.site <> 'cn' OR v_unit.quantity <> 1 THEN
        RETURN jsonb_build_object('status', 'blocked', 'reason', 'scope_unsupported');
    END IF;
    IF v_intent.exposure_status <> 'held'
        OR v_intent.reserved_cost_cny IS DISTINCT FROM v_unit.cost_ceiling_cny THEN
        RETURN jsonb_build_object('status', 'blocked', 'reason', 'exposure_not_held');
    END IF;
    IF NOT COALESCE(v_native_ready, false) THEN
        RETURN jsonb_build_object('status', 'blocked', 'reason', 'native_not_ready');
    END IF;
    IF NOT v_policy.intake_enabled OR NOT v_policy.checkout_enabled
        OR v_unit.cost_ceiling_cny > v_policy.per_unit_cost_ceiling_cny THEN
        RETURN jsonb_build_object('status', 'blocked', 'reason', 'policy_not_ready');
    END IF;
    SELECT * INTO v_mapping FROM public.shop_supplier_product_mappings WHERE id = v_unit.mapping_id FOR SHARE;
    IF NOT FOUND OR NOT v_mapping.is_enabled OR NOT v_mapping.is_primary OR v_mapping.contract_version <> 2
        OR v_mapping.site IS DISTINCT FROM v_unit.site
        OR v_mapping.supplier_account_id IS DISTINCT FROM v_unit.supplier_account_id
        OR v_mapping.product_id IS DISTINCT FROM v_unit.product_id OR v_mapping.sku_id IS DISTINCT FROM v_unit.sku_id
        OR v_mapping.updated_at IS DISTINCT FROM v_unit.mapping_revision
        OR v_mapping.supplier_goods_no IS DISTINCT FROM v_unit.source_snapshot->>'goods_no'
        OR v_mapping.supplier_variant IS DISTINCT FROM v_unit.source_snapshot->'variant'
        OR v_mapping.supplier_variant_key IS DISTINCT FROM v_unit.source_snapshot->>'variant_key' THEN
        RETURN jsonb_build_object('status', 'blocked', 'reason', 'mapping_not_ready');
    END IF;
    SELECT * INTO v_account FROM public.shop_supplier_accounts WHERE id = v_unit.supplier_account_id FOR SHARE;
    IF NOT FOUND OR NOT v_account.is_enabled
        OR v_account.provider_id IS DISTINCT FROM v_unit.source_snapshot->>'provider_id' THEN
        RETURN jsonb_build_object('status', 'blocked', 'reason', 'account_not_ready');
    END IF;

    IF v_purchase.id IS NULL THEN
        INSERT INTO public.shop_supplier_manual_purchases(intent_id, unit_id, supplier_account_id,
            original_request_id, operator_admin_id, state, attempt_count, quoted_amount_cny,
            cost_ceiling_cny, quoted_at, quote_expires_at, updated_at)
        VALUES (v_intent.id, v_unit.id, v_unit.supplier_account_id, v_intent.original_request_id,
            p_admin_id, 'quoted', 1, v_amount, v_unit.cost_ceiling_cny, v_now, v_now + INTERVAL '120 seconds', v_now)
        RETURNING * INTO v_purchase;
    ELSE
        UPDATE public.shop_supplier_manual_purchases SET
            state = 'quoted', operator_admin_id = p_admin_id,
            attempt_count = CASE WHEN v_purchase.state = 'quoted' THEN v_purchase.attempt_count
                ELSE v_purchase.attempt_count + 1 END,
            quoted_amount_cny = v_amount, quoted_at = v_now,
            quote_expires_at = v_now + INTERVAL '120 seconds',
            confirmed_at = NULL, submitted_at = NULL, confirmed_by_admin_id = NULL,
            supplier_order_no = NULL, actual_amount_cny = NULL, failure_code = NULL,
            updated_at = v_now
            WHERE id = v_purchase.id RETURNING * INTO v_purchase;
    END IF;
    INSERT INTO public.shop_supplier_manual_purchase_events(purchase_id, intent_id, event_kind, actor_admin_id, detail)
    VALUES (v_purchase.id, v_intent.id, 'quoted', p_admin_id, jsonb_build_object(
        'quotedAmountCny', v_amount::TEXT, 'costCeilingCny', v_unit.cost_ceiling_cny::TEXT,
        'attemptCount', v_purchase.attempt_count, 'expiresAt', v_purchase.quote_expires_at));
    RETURN jsonb_build_object(
        'status', 'quoted',
        'purchaseId', v_purchase.id,
        'requestId', v_intent.original_request_id,
        'goodsNo', v_mapping.supplier_goods_no,
        'variant', COALESCE(v_mapping.supplier_variant, '{}'::JSONB),
        'quantity', 1,
        'providerId', v_account.provider_id,
        'costCeilingCny', v_unit.cost_ceiling_cny::TEXT,
        'quotedAmountCny', v_amount::TEXT,
        'quoteCurrency', 'CNY',
        'quoteExpiresAt', v_purchase.quote_expires_at,
        'attemptCount', v_purchase.attempt_count,
        'overCeiling', v_amount > v_unit.cost_ceiling_cny
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- Step 2: the administrator confirms the exact quoted amount. This is the only
-- point that authorises the server to send the supplier trade request. The
-- compare-and-set on state makes a double click a no-op: exactly one caller
-- receives claimed=true.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_shop_supplier_manual_confirm_v2(
    p_purchase_id UUID, p_admin_id UUID, p_quoted_amount_cny TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_unit public.shop_supplier_fulfillment_units%ROWTYPE;
    v_intent public.shop_supplier_procurement_intents%ROWTYPE;
    v_policy public.shop_supplier_transaction_policies%ROWTYPE;
    v_mapping public.shop_supplier_product_mappings%ROWTYPE;
    v_account public.shop_supplier_accounts%ROWTYPE;
    v_purchase public.shop_supplier_manual_purchases%ROWTYPE;
    v_order public.shop_orders%ROWTYPE;
    v_guest public.guest_shop_orders%ROWTYPE;
    v_native_ready BOOLEAN := false;
    v_amount NUMERIC(18,6);
    v_now TIMESTAMPTZ;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'supplier_service_role_required'; END IF;
    IF p_purchase_id IS NULL OR p_admin_id IS NULL OR p_quoted_amount_cny IS NULL
        OR p_quoted_amount_cny !~ '^[0-9]{1,12}(\.[0-9]{1,6})?$' THEN
        RAISE EXCEPTION 'supplier_manual_invalid_request';
    END IF;
    v_amount := p_quoted_amount_cny::NUMERIC;
    SELECT * INTO v_purchase FROM public.shop_supplier_manual_purchases WHERE id = p_purchase_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'supplier_manual_purchase_missing'; END IF;
    SELECT u.* INTO v_unit FROM public.shop_supplier_fulfillment_units u WHERE u.id = v_purchase.unit_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'supplier_manual_intent_missing'; END IF;
    IF v_unit.funding_kind = 'points' THEN
        SELECT * INTO STRICT v_order FROM public.shop_orders WHERE id = v_unit.shop_order_id FOR UPDATE;
        v_native_ready := v_order.fulfillment_source = 'supplier_v2' AND v_order.delivery_status = 'pending'
            AND COALESCE(v_order.refund_status, 'none') = 'none' AND v_order.item_count = 1
            AND v_order.site = v_unit.site AND v_order.product_id = v_unit.product_id AND v_order.sku_id = v_unit.sku_id
            AND v_order.user_id = v_unit.buyer_user_id AND v_order.price_paid = v_unit.sale_amount
            AND COALESCE(v_order.discount_amount, 0) = 0 AND COALESCE(v_order.discount_refund_amount, 0) = 0
            AND v_order.delivery_completed_at IS NULL AND v_order.inventory_id IS NULL AND v_order.delivery_task_id IS NULL;
    ELSE
        SELECT * INTO STRICT v_guest FROM public.guest_shop_orders WHERE id = v_unit.guest_order_id FOR UPDATE;
        v_native_ready := v_guest.fulfillment_source = 'supplier_v2' AND v_guest.payment_status = 'confirmed'
            AND v_guest.fulfillment_status = 'pending' AND v_guest.refund_status = 'none'
            AND v_guest.reservation_status = 'none' AND v_guest.paid_at IS NOT NULL AND v_guest.fulfilled_at IS NULL
            AND v_guest.site = v_unit.site AND v_guest.product_id = v_unit.product_id AND v_guest.sku_id = v_unit.sku_id
            AND v_guest.currency = 'CNY' AND v_guest.quantity = 1 AND v_guest.unit_amount = v_unit.sale_amount
            AND v_guest.total_amount - COALESCE(v_guest.payment_fee_amount, 0) = v_unit.sale_amount;
    END IF;
    SELECT * INTO STRICT v_unit FROM public.shop_supplier_fulfillment_units WHERE id = v_unit.id FOR UPDATE;
    SELECT * INTO STRICT v_policy FROM public.shop_supplier_transaction_policies
        WHERE supplier_account_id = v_unit.supplier_account_id FOR UPDATE;
    SELECT * INTO STRICT v_intent FROM public.shop_supplier_procurement_intents
        WHERE id = v_purchase.intent_id FOR UPDATE;
    SELECT * INTO STRICT v_purchase FROM public.shop_supplier_manual_purchases
        WHERE id = p_purchase_id FOR UPDATE;
    v_now := clock_timestamp();

    IF v_purchase.state <> 'quoted' THEN
        RETURN jsonb_build_object('claimed', false, 'reason', 'manual_purchase_not_quoted',
            'purchaseState', v_purchase.state, 'supplierOrderNo', v_purchase.supplier_order_no);
    END IF;
    IF v_purchase.quote_expires_at <= v_now THEN
        UPDATE public.shop_supplier_manual_purchases SET state = 'expired', updated_at = v_now
            WHERE id = v_purchase.id AND state = 'quoted';
        INSERT INTO public.shop_supplier_manual_purchase_events(purchase_id, intent_id, event_kind, actor_admin_id, detail)
        VALUES (v_purchase.id, v_intent.id, 'quote_expired', p_admin_id,
            jsonb_build_object('quotedAmountCny', v_purchase.quoted_amount_cny::TEXT, 'expiredAt', v_now));
        RETURN jsonb_build_object('claimed', false, 'reason', 'quote_expired');
    END IF;
    IF v_purchase.quoted_amount_cny IS DISTINCT FROM v_amount THEN
        RETURN jsonb_build_object('claimed', false, 'reason', 'quote_amount_changed',
            'quotedAmountCny', v_purchase.quoted_amount_cny::TEXT);
    END IF;
    IF v_amount > v_purchase.cost_ceiling_cny THEN
        RETURN jsonb_build_object('claimed', false, 'reason', 'cost_ceiling_exceeded',
            'quotedAmountCny', v_amount::TEXT, 'costCeilingCny', v_purchase.cost_ceiling_cny::TEXT);
    END IF;
    IF v_intent.status <> 'not_submitted' THEN
        RETURN jsonb_build_object('claimed', false, 'reason', 'intent_not_submitted', 'intentStatus', v_intent.status);
    END IF;
    IF v_unit.funding_state <> 'funded' OR NOT COALESCE(v_native_ready, false) THEN
        RETURN jsonb_build_object('claimed', false, 'reason', 'native_not_ready');
    END IF;
    IF NOT v_policy.intake_enabled OR NOT v_policy.checkout_enabled
        OR v_unit.cost_ceiling_cny > v_policy.per_unit_cost_ceiling_cny THEN
        RETURN jsonb_build_object('claimed', false, 'reason', 'policy_not_ready');
    END IF;
    SELECT * INTO v_mapping FROM public.shop_supplier_product_mappings WHERE id = v_unit.mapping_id FOR SHARE;
    IF NOT FOUND OR NOT v_mapping.is_enabled OR NOT v_mapping.is_primary OR v_mapping.contract_version <> 2
        OR v_mapping.site IS DISTINCT FROM v_unit.site
        OR v_mapping.supplier_account_id IS DISTINCT FROM v_unit.supplier_account_id
        OR v_mapping.product_id IS DISTINCT FROM v_unit.product_id OR v_mapping.sku_id IS DISTINCT FROM v_unit.sku_id
        OR v_mapping.updated_at IS DISTINCT FROM v_unit.mapping_revision
        OR v_mapping.supplier_goods_no IS DISTINCT FROM v_unit.source_snapshot->>'goods_no'
        OR v_mapping.supplier_variant IS DISTINCT FROM v_unit.source_snapshot->'variant'
        OR v_mapping.supplier_variant_key IS DISTINCT FROM v_unit.source_snapshot->>'variant_key' THEN
        RETURN jsonb_build_object('claimed', false, 'reason', 'mapping_not_ready');
    END IF;
    SELECT * INTO v_account FROM public.shop_supplier_accounts WHERE id = v_unit.supplier_account_id FOR SHARE;
    IF NOT FOUND OR NOT v_account.is_enabled
        OR v_account.provider_id IS DISTINCT FROM v_unit.source_snapshot->>'provider_id' THEN
        RETURN jsonb_build_object('claimed', false, 'reason', 'account_not_ready');
    END IF;
    IF v_intent.supplier_account_id IS DISTINCT FROM v_unit.supplier_account_id
        OR v_purchase.supplier_account_id IS DISTINCT FROM v_unit.supplier_account_id
        OR v_purchase.original_request_id IS DISTINCT FROM v_intent.original_request_id THEN
        RAISE EXCEPTION 'supplier_manual_identity_conflict';
    END IF;

    UPDATE public.shop_supplier_manual_purchases SET state = 'confirmed', confirmed_at = v_now,
        confirmed_by_admin_id = p_admin_id, submitted_at = v_now, updated_at = v_now
        WHERE id = v_purchase.id AND state = 'quoted' RETURNING * INTO v_purchase;
    IF NOT FOUND THEN RETURN jsonb_build_object('claimed', false, 'reason', 'manual_purchase_not_quoted'); END IF;
    UPDATE public.shop_supplier_procurement_intents SET status = 'prepared' WHERE id = v_intent.id;
    UPDATE public.shop_supplier_transaction_outbox SET status = 'processing', block_reason = 'dispatch_in_progress'
        WHERE intent_id = v_intent.id;
    INSERT INTO public.shop_supplier_manual_purchase_events(purchase_id, intent_id, event_kind, actor_admin_id, detail)
    VALUES (v_purchase.id, v_intent.id, 'confirmed', p_admin_id, jsonb_build_object(
        'quotedAmountCny', v_amount::TEXT, 'costCeilingCny', v_purchase.cost_ceiling_cny::TEXT,
        'attemptCount', v_purchase.attempt_count));
    RETURN jsonb_build_object(
        'claimed', true,
        'purchaseId', v_purchase.id,
        'requestId', v_purchase.original_request_id,
        'goodsNo', v_mapping.supplier_goods_no,
        'variant', COALESCE(v_mapping.supplier_variant, '{}'::JSONB),
        'quantity', 1,
        'providerId', v_account.provider_id,
        'accountId', v_account.id,
        'quotedAmountCny', v_amount::TEXT,
        'costCeilingCny', v_purchase.cost_ceiling_cny::TEXT,
        'fundingKind', v_unit.funding_kind,
        'site', v_unit.site
    );
END;
$$;


-- ---------------------------------------------------------------------------
-- Step 2b: persist what the supplier answered to the trade request BEFORE the
-- delivery content is fetched or the receipt is written.
--
-- The debit has already happened at this point, so the order number must be
-- durable even if the process dies before the receipt exists. That is the only
-- way a later "finalise" call can re-read the delivered card instead of asking
-- the supplier to trade again.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_shop_supplier_manual_stage_v2(
    p_purchase_id UUID, p_admin_id UUID, p_trade_no TEXT,
    p_actual_amount_cny TEXT, p_evidence_hash TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_purchase public.shop_supplier_manual_purchases%ROWTYPE;
    v_intent public.shop_supplier_procurement_intents%ROWTYPE;
    v_now TIMESTAMPTZ;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'supplier_service_role_required'; END IF;
    IF p_purchase_id IS NULL OR p_admin_id IS NULL
        OR p_trade_no IS NULL OR p_trade_no !~ '^[[:alnum:]_.:-]{1,160}$'
        OR p_actual_amount_cny IS NULL OR p_actual_amount_cny !~ '^[0-9]{1,12}(\.[0-9]{1,6})?$'
        OR p_evidence_hash IS NULL OR p_evidence_hash !~ '^[a-f0-9]{64}$' THEN
        RAISE EXCEPTION 'supplier_manual_invalid_request';
    END IF;
    SELECT * INTO v_purchase FROM public.shop_supplier_manual_purchases
        WHERE id = p_purchase_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'supplier_manual_purchase_missing'; END IF;
    SELECT * INTO v_intent FROM public.shop_supplier_procurement_intents
        WHERE id = v_purchase.intent_id FOR UPDATE;
    v_now := clock_timestamp();

    IF v_purchase.state IN ('accepted','unknown','rejected') THEN
        RETURN jsonb_build_object('status', v_purchase.state, 'staged', false, 'duplicate', true,
            'supplierOrderNo', v_purchase.supplier_order_no);
    END IF;
    IF v_purchase.state <> 'confirmed' THEN
        RAISE EXCEPTION 'supplier_manual_state_conflict';
    END IF;
    IF v_purchase.supplier_order_no IS NOT NULL THEN
        IF v_purchase.supplier_order_no IS DISTINCT FROM p_trade_no THEN
            RAISE EXCEPTION 'supplier_manual_identity_conflict';
        END IF;
        RETURN jsonb_build_object('status', 'confirmed', 'staged', false, 'duplicate', true,
            'supplierOrderNo', p_trade_no);
    END IF;
    UPDATE public.shop_supplier_manual_purchases
        SET supplier_order_no = p_trade_no, actual_amount_cny = p_actual_amount_cny::NUMERIC(18,6),
            updated_at = v_now
        WHERE id = v_purchase.id AND state = 'confirmed' AND supplier_order_no IS NULL;
    INSERT INTO public.shop_supplier_manual_purchase_events(purchase_id, intent_id, event_kind, actor_admin_id, detail)
    VALUES (v_purchase.id, v_intent.id, 'submitted', p_admin_id, jsonb_build_object(
        'supplierOrderNo', p_trade_no, 'actualAmountCny', p_actual_amount_cny,
        'quotedAmountCny', v_purchase.quoted_amount_cny::TEXT,
        'costCeilingCny', v_purchase.cost_ceiling_cny::TEXT, 'evidenceHash', p_evidence_hash));
    RETURN jsonb_build_object('status', 'confirmed', 'staged', true,
        'supplierOrderNo', p_trade_no, 'actualAmountCny', p_actual_amount_cny);
END;
$$;

-- ---------------------------------------------------------------------------
-- Step 3: record what the supplier actually answered.
--
-- `accepted` writes the immutable delivery receipt and the customer-visible
-- projection. `unknown` and `rejected` never invent an order number and never
-- publish a receipt; they park the unit for the existing resolution protocol.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_shop_supplier_manual_record_v2(
    p_purchase_id UUID, p_admin_id UUID, p_outcome TEXT,
    p_trade_no TEXT DEFAULT NULL, p_actual_amount_cny TEXT DEFAULT NULL,
    p_evidence_hash TEXT DEFAULT NULL, p_sealed JSONB DEFAULT NULL,
    p_failure_code TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_unit public.shop_supplier_fulfillment_units%ROWTYPE;
    v_intent public.shop_supplier_procurement_intents%ROWTYPE;
    v_purchase public.shop_supplier_manual_purchases%ROWTYPE;
    v_existing public.shop_supplier_delivery_receipts%ROWTYPE;
    v_order public.shop_orders%ROWTYPE;
    v_guest public.guest_shop_orders%ROWTYPE;
    v_native_ready BOOLEAN := false;
    v_proof_hash TEXT;
    v_result_hash TEXT;
    v_cost NUMERIC(18,6);
    v_reason TEXT;
    v_base_price NUMERIC(12,2);
    v_product_name TEXT;
    v_now TIMESTAMPTZ;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'supplier_service_role_required'; END IF;
    IF p_purchase_id IS NULL OR p_admin_id IS NULL OR p_outcome IS NULL
        OR p_outcome NOT IN ('accepted','unknown','rejected') THEN
        RAISE EXCEPTION 'supplier_manual_invalid_request';
    END IF;
    IF p_outcome = 'accepted' THEN
        IF p_trade_no IS NULL OR p_trade_no !~ '^[[:alnum:]_.:-]{1,160}$'
            OR p_actual_amount_cny IS NULL OR p_actual_amount_cny !~ '^[0-9]{1,12}(\.[0-9]{1,6})?$'
            OR p_evidence_hash IS NULL OR p_evidence_hash !~ '^[a-f0-9]{64}$'
            OR p_sealed IS NULL OR jsonb_typeof(p_sealed) <> 'object'
            OR NOT COALESCE(p_sealed->>'fingerprint' ~ '^[a-f0-9]{64}$', false) THEN
            RAISE EXCEPTION 'supplier_manual_invalid_receipt';
        END IF;
        v_cost := p_actual_amount_cny::NUMERIC;
        IF v_cost < 0 OR v_cost <> v_cost THEN RAISE EXCEPTION 'supplier_manual_invalid_receipt'; END IF;
    ELSE
        IF p_failure_code IS NULL OR p_failure_code !~ '^[a-z0-9][a-z0-9._-]{0,79}$'
            OR p_trade_no IS NOT NULL OR p_actual_amount_cny IS NOT NULL OR p_sealed IS NOT NULL THEN
            RAISE EXCEPTION 'supplier_manual_invalid_receipt';
        END IF;
    END IF;

    SELECT * INTO v_purchase FROM public.shop_supplier_manual_purchases WHERE id = p_purchase_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'supplier_manual_purchase_missing'; END IF;
    SELECT u.* INTO v_unit FROM public.shop_supplier_fulfillment_units u WHERE u.id = v_purchase.unit_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'supplier_manual_intent_missing'; END IF;
    IF v_unit.funding_kind = 'points' THEN
        SELECT * INTO STRICT v_order FROM public.shop_orders WHERE id = v_unit.shop_order_id FOR UPDATE;
        v_native_ready := v_order.fulfillment_source = 'supplier_v2' AND v_order.delivery_status = 'pending'
            AND COALESCE(v_order.refund_status, 'none') = 'none' AND v_order.item_count = 1
            AND v_order.site = v_unit.site AND v_order.product_id = v_unit.product_id AND v_order.sku_id = v_unit.sku_id
            AND v_order.user_id = v_unit.buyer_user_id AND v_order.price_paid = v_unit.sale_amount
            AND COALESCE(v_order.discount_amount, 0) = 0 AND COALESCE(v_order.discount_refund_amount, 0) = 0
            AND v_order.delivery_completed_at IS NULL AND v_order.inventory_id IS NULL AND v_order.delivery_task_id IS NULL;
    ELSE
        SELECT * INTO STRICT v_guest FROM public.guest_shop_orders WHERE id = v_unit.guest_order_id FOR UPDATE;
        v_native_ready := v_guest.fulfillment_source = 'supplier_v2' AND v_guest.payment_status = 'confirmed'
            AND v_guest.fulfillment_status = 'pending' AND v_guest.refund_status = 'none'
            AND v_guest.reservation_status = 'none' AND v_guest.paid_at IS NOT NULL AND v_guest.fulfilled_at IS NULL
            AND v_guest.site = v_unit.site AND v_guest.product_id = v_unit.product_id AND v_guest.sku_id = v_unit.sku_id
            AND v_guest.currency = 'CNY' AND v_guest.quantity = 1 AND v_guest.unit_amount = v_unit.sale_amount
            AND v_guest.total_amount - COALESCE(v_guest.payment_fee_amount, 0) = v_unit.sale_amount;
    END IF;
    SELECT * INTO STRICT v_unit FROM public.shop_supplier_fulfillment_units WHERE id = v_unit.id FOR UPDATE;
    PERFORM 1 FROM public.shop_supplier_transaction_policies
        WHERE supplier_account_id = v_unit.supplier_account_id FOR UPDATE;
    SELECT * INTO STRICT v_intent FROM public.shop_supplier_procurement_intents
        WHERE id = v_purchase.intent_id FOR UPDATE;
    SELECT * INTO STRICT v_purchase FROM public.shop_supplier_manual_purchases
        WHERE id = p_purchase_id FOR UPDATE;
    v_now := clock_timestamp();

    IF v_purchase.state IN ('accepted','unknown','rejected') THEN
        -- A retried record call must be a no-op that reports the stored result.
        RETURN jsonb_build_object('status', v_purchase.state, 'applied', false, 'duplicate', true,
            'supplierOrderNo', v_purchase.supplier_order_no);
    END IF;
    IF v_purchase.state <> 'confirmed' OR v_purchase.submitted_at IS NULL
        OR v_intent.status <> 'prepared'
        OR v_purchase.supplier_account_id IS DISTINCT FROM v_unit.supplier_account_id
        OR v_purchase.original_request_id IS DISTINCT FROM v_intent.original_request_id THEN
        RAISE EXCEPTION 'supplier_manual_identity_conflict';
    END IF;

    IF p_outcome = 'unknown' THEN
        UPDATE public.shop_supplier_manual_purchases SET state = 'unknown', failure_code = p_failure_code,
            updated_at = v_now WHERE id = v_purchase.id;
        UPDATE public.shop_supplier_procurement_intents SET status = 'outcome_unknown' WHERE id = v_intent.id;
        UPDATE public.shop_supplier_transaction_outbox SET status = 'awaiting_reconciliation', block_reason = 'outcome_unknown'
            WHERE intent_id = v_intent.id;
        INSERT INTO public.shop_supplier_manual_purchase_events(purchase_id, intent_id, event_kind, actor_admin_id, detail)
        VALUES (v_purchase.id, v_intent.id, 'unknown', p_admin_id,
            jsonb_build_object('failureCode', p_failure_code, 'evidenceHash', p_evidence_hash));
        RETURN jsonb_build_object('status', 'unknown', 'applied', true);
    END IF;

    IF p_outcome = 'rejected' THEN
        UPDATE public.shop_supplier_manual_purchases SET state = 'rejected', failure_code = p_failure_code,
            updated_at = v_now WHERE id = v_purchase.id;
        UPDATE public.shop_supplier_procurement_intents SET status = 'rejected' WHERE id = v_intent.id;
        UPDATE public.shop_supplier_transaction_outbox SET status = 'rejected', block_reason = 'supplier_rejected'
            WHERE intent_id = v_intent.id;
        INSERT INTO public.shop_supplier_manual_purchase_events(purchase_id, intent_id, event_kind, actor_admin_id, detail)
        VALUES (v_purchase.id, v_intent.id, 'rejected', p_admin_id,
            jsonb_build_object('failureCode', p_failure_code, 'evidenceHash', p_evidence_hash));
        RETURN jsonb_build_object('status', 'rejected', 'applied', true);
    END IF;

    -- Accepted: the supplier already debited. Preserve the fact even when the
    -- native order or the amount turns out to be undeliverable.
    v_proof_hash := encode(sha256(convert_to(jsonb_build_object(
        'kind', 'manual_purchase', 'purchase', v_purchase.id, 'intent', v_intent.id,
        'operator', v_purchase.operator_admin_id, 'confirmedBy', v_purchase.confirmed_by_admin_id,
        'quotedAmountCny', v_purchase.quoted_amount_cny::TEXT, 'costCeilingCny', v_purchase.cost_ceiling_cny::TEXT,
        'requestId', v_purchase.original_request_id, 'supplierOrderNo', p_trade_no,
        'attemptCount', v_purchase.attempt_count)::TEXT, 'UTF8')), 'hex');
    v_result_hash := encode(sha256(convert_to(jsonb_build_object(
        'request', v_purchase.original_request_id::TEXT, 'account', v_intent.supplier_account_id::TEXT,
        'order', p_trade_no, 'contract', '412c6c9277c684368548010f93001c9cf10a7b170fddcafc085f9a0171289fd9',
        'proof', v_proof_hash, 'evidence', p_evidence_hash, 'cost', v_cost,
        'content', p_sealed->>'fingerprint')::TEXT, 'UTF8')), 'hex');
    SELECT * INTO v_existing FROM public.shop_supplier_delivery_receipts WHERE intent_id = v_intent.id;
    IF FOUND THEN
        IF v_existing.result_hash IS DISTINCT FROM v_result_hash THEN
            RAISE EXCEPTION 'supplier_manual_result_conflict';
        END IF;
        RETURN jsonb_build_object('status', v_existing.disposition, 'applied', false, 'duplicate', true);
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('supplier-delivery-v1:' || (p_sealed->>'fingerprint'), 0));
    IF NOT COALESCE(v_native_ready, false) THEN v_reason := 'native_not_deliverable';
    ELSIF v_cost > v_purchase.cost_ceiling_cny THEN v_reason := 'cost_above_ceiling';
    ELSIF EXISTS (SELECT 1 FROM public.shop_supplier_delivery_receipts
        WHERE content_fingerprint = p_sealed->>'fingerprint') THEN v_reason := 'duplicate_content';
    END IF;
    UPDATE public.shop_supplier_procurement_intents
        SET status = 'accepted', supplier_order_no = p_trade_no, actual_cost_cny = v_cost
        WHERE id = v_intent.id;
    INSERT INTO public.shop_supplier_delivery_receipts(unit_id, intent_id, supplier_account_id, original_request_id,
        supplier_order_no, contract_hash, proof_hash, evidence_hash, result_hash, actual_cost_cny,
        content_fingerprint, sealed, disposition, quarantine_reason, created_at)
    VALUES (v_unit.id, v_intent.id, v_intent.supplier_account_id, v_intent.original_request_id,
        p_trade_no, '412c6c9277c684368548010f93001c9cf10a7b170fddcafc085f9a0171289fd9',
        v_proof_hash, p_evidence_hash, v_result_hash, v_cost,
        p_sealed->>'fingerprint', p_sealed,
        CASE WHEN v_reason IS NULL THEN 'delivered' ELSE 'quarantined' END, v_reason, v_now);
    UPDATE public.shop_supplier_manual_purchases SET state = 'accepted', supplier_order_no = p_trade_no,
        actual_amount_cny = v_cost, updated_at = v_now WHERE id = v_purchase.id;
    UPDATE public.shop_supplier_procurement_intents SET
        exposure_status = CASE WHEN v_reason IS NULL THEN 'not_reserved' ELSE exposure_status END,
        reserved_cost_cny = CASE WHEN v_reason IS NULL THEN 0 ELSE reserved_cost_cny END
        WHERE id = v_intent.id;
    UPDATE public.shop_supplier_transaction_outbox SET
        status = CASE WHEN v_reason IS NULL THEN 'completed' ELSE 'review' END,
        block_reason = CASE WHEN v_reason IS NULL THEN 'supplier_delivered' ELSE 'delivery_quarantined' END
        WHERE intent_id = v_intent.id;
    IF v_reason IS NULL AND v_unit.funding_kind = 'points' THEN
        -- Timestamps must equal the receipt's created_at exactly: the native
        -- guard authorises delivery only through that exact projection.
        UPDATE public.shop_orders SET delivery_status = 'delivered', delivery_completed_at = v_now,
            delivery_updated_at = v_now, delivery_last_error = NULL,
            supplier_dispatch_version = supplier_dispatch_version + 1
            WHERE id = v_unit.shop_order_id;
        SELECT CASE WHEN v_unit.site = 'cn' THEN p.price_points ELSE p.price_points_intl END, p.name
            INTO v_base_price, v_product_name
            FROM public.shop_products p WHERE p.id = v_unit.product_id;
        IF v_order.total_price > 0 THEN
            INSERT INTO public.shop_purchase_reward_jobs(order_id, user_id, product_id, product_name, site,
                quantity, base_unit_price, total_price, agent_id, agent_markup, status, updated_at)
            VALUES (v_order.id, v_order.user_id, v_order.product_id,
                COALESCE(v_order.snapshot_product_name, v_product_name, ''), v_unit.site,
                1, COALESCE(v_base_price, v_order.total_price), v_order.total_price, NULL, 0, 'pending', v_now)
            ON CONFLICT (order_id) DO NOTHING;
        END IF;
    ELSIF v_reason IS NULL THEN
        UPDATE public.guest_shop_orders SET fulfillment_status = 'delivered', fulfilled_at = v_now,
            updated_at = v_now, supplier_dispatch_version = supplier_dispatch_version + 1
            WHERE id = v_unit.guest_order_id;
    ELSE
        IF v_unit.funding_kind = 'points' THEN
            UPDATE public.shop_orders SET supplier_dispatch_version = supplier_dispatch_version + 1
                WHERE id = v_unit.shop_order_id;
        ELSE
            UPDATE public.guest_shop_orders SET supplier_dispatch_version = supplier_dispatch_version + 1
                WHERE id = v_unit.guest_order_id;
        END IF;
    END IF;
    INSERT INTO public.shop_supplier_manual_purchase_events(purchase_id, intent_id, event_kind, actor_admin_id, detail)
    VALUES (v_purchase.id, v_intent.id, 'accepted', p_admin_id, jsonb_build_object(
        'supplierOrderNo', p_trade_no, 'actualAmountCny', v_cost::TEXT,
        'quotedAmountCny', v_purchase.quoted_amount_cny::TEXT, 'evidenceHash', p_evidence_hash,
        'disposition', CASE WHEN v_reason IS NULL THEN 'delivered' ELSE 'quarantined' END,
        'quarantineReason', v_reason));
    RETURN jsonb_build_object('status', CASE WHEN v_reason IS NULL THEN 'delivered' ELSE 'quarantined' END,
        'applied', true, 'supplierOrderNo', p_trade_no);
END;
$$;

-- Server-only surface. No authenticated or anon role may quote, confirm or
-- record a manual purchase.
REVOKE ALL ON FUNCTION public.fn_shop_supplier_manual_context_v2(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_shop_supplier_manual_quote_v2(UUID,UUID,TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_shop_supplier_manual_confirm_v2(UUID,UUID,TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_shop_supplier_manual_stage_v2(UUID,UUID,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_shop_supplier_manual_record_v2(UUID,UUID,TEXT,TEXT,TEXT,TEXT,JSONB,TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_shop_supplier_manual_context_v2(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_shop_supplier_manual_quote_v2(UUID,UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_shop_supplier_manual_confirm_v2(UUID,UUID,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_shop_supplier_manual_stage_v2(UUID,UUID,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_shop_supplier_manual_record_v2(UUID,UUID,TEXT,TEXT,TEXT,TEXT,JSONB,TEXT) TO service_role;

COMMIT;
