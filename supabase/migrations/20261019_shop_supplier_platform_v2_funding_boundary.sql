-- P2A internal transaction boundary only. Review/apply manually after P0/P1.
-- No storefront entry point or upstream request is enabled. Existing local
-- purchases have no binding and retain their original transaction paths.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.shop_supplier_transaction_policies (
    supplier_account_id UUID PRIMARY KEY REFERENCES public.shop_supplier_accounts(id) ON DELETE RESTRICT,
    intake_enabled BOOLEAN NOT NULL DEFAULT false,
    budget_version BIGINT NOT NULL DEFAULT 0 CHECK (budget_version >= 0),
    max_unresolved_units INTEGER NOT NULL DEFAULT 0 CHECK (max_unresolved_units >= 0),
    max_reserved_cost_cny NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (max_reserved_cost_cny >= 0 AND max_reserved_cost_cny <> 'NaN'::NUMERIC),
    per_unit_cost_ceiling_cny NUMERIC(18,6) NOT NULL DEFAULT 0 CHECK (per_unit_cost_ceiling_cny >= 0 AND per_unit_cost_ceiling_cny <> 'NaN'::NUMERIC),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (per_unit_cost_ceiling_cny <= max_reserved_cost_cny),
    CHECK (NOT intake_enabled OR (max_unresolved_units > 0 AND per_unit_cost_ceiling_cny > 0))
);
-- No enabled policy, budget or sales switch is provisioned by this migration.

CREATE UNIQUE INDEX IF NOT EXISTS ux_shop_order_items_supplier_parent
    ON public.shop_order_items(order_id, id);

CREATE TABLE IF NOT EXISTS public.shop_supplier_fulfillment_units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id UUID NOT NULL CONSTRAINT shop_supplier_unit_operation_unique UNIQUE,
    request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
    funding_kind TEXT NOT NULL CHECK (funding_kind IN ('points', 'guest_cash')),
    site TEXT NOT NULL CHECK (site = 'cn'),
    shop_order_id UUID CONSTRAINT shop_supplier_unit_points_order_unique UNIQUE REFERENCES public.shop_orders(id) ON DELETE RESTRICT,
    shop_order_item_id UUID CONSTRAINT shop_supplier_unit_points_item_unique UNIQUE,
    guest_order_id UUID CONSTRAINT shop_supplier_unit_guest_order_unique UNIQUE REFERENCES public.guest_shop_orders(id) ON DELETE RESTRICT,
    buyer_user_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES public.shop_products(id) ON DELETE RESTRICT,
    sku_id UUID NOT NULL,
    mapping_id UUID NOT NULL REFERENCES public.shop_supplier_product_mappings(id) ON DELETE RESTRICT,
    supplier_account_id UUID NOT NULL REFERENCES public.shop_supplier_transaction_policies(supplier_account_id) ON DELETE RESTRICT,
    mapping_revision TIMESTAMPTZ NOT NULL,
    source_snapshot JSONB NOT NULL CHECK (jsonb_typeof(source_snapshot) = 'object'),
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity = 1),
    sale_amount NUMERIC(18,2) NOT NULL CHECK (sale_amount > 0 AND sale_amount <> 'NaN'::NUMERIC),
    sale_currency TEXT NOT NULL CHECK (sale_currency IN ('POINTS', 'CNY')),
    cost_ceiling_cny NUMERIC(18,6) NOT NULL CHECK (cost_ceiling_cny > 0 AND cost_ceiling_cny <> 'NaN'::NUMERIC),
    funding_state TEXT NOT NULL DEFAULT 'awaiting_payment' CHECK (funding_state IN ('awaiting_payment', 'funded')),
    points_ledger_id UUID CONSTRAINT shop_supplier_unit_points_ledger_unique UNIQUE REFERENCES public.points_ledger(id) ON DELETE RESTRICT,
    guest_payment_order_id UUID CONSTRAINT shop_supplier_unit_guest_payment_unique UNIQUE REFERENCES public.guest_shop_payment_orders(id) ON DELETE RESTRICT,
    guest_payment_event_id UUID REFERENCES public.guest_shop_payment_events(id) ON DELETE RESTRICT,
    funded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT shop_supplier_unit_points_item_fk FOREIGN KEY (shop_order_id, shop_order_item_id)
        REFERENCES public.shop_order_items(order_id, id) ON DELETE RESTRICT,
    CONSTRAINT shop_supplier_unit_sku_product_fk FOREIGN KEY (product_id, sku_id)
        REFERENCES public.shop_product_skus(product_id, id) ON DELETE RESTRICT,
    CONSTRAINT shop_supplier_unit_native_owner_check CHECK (
        (funding_kind = 'points' AND shop_order_id IS NOT NULL AND shop_order_item_id IS NOT NULL
            AND guest_order_id IS NULL AND buyer_user_id IS NOT NULL AND sale_currency = 'POINTS')
        OR (funding_kind = 'guest_cash' AND guest_order_id IS NOT NULL AND shop_order_id IS NULL
            AND shop_order_item_id IS NULL AND buyer_user_id IS NULL AND sale_currency = 'CNY')
    ),
    CONSTRAINT shop_supplier_unit_funding_proof_check CHECK (
        (funding_state = 'awaiting_payment' AND funded_at IS NULL AND points_ledger_id IS NULL
            AND guest_payment_order_id IS NULL AND guest_payment_event_id IS NULL)
        OR (funding_state = 'funded' AND funded_at IS NOT NULL AND (
            (funding_kind = 'points' AND points_ledger_id IS NOT NULL AND guest_payment_order_id IS NULL AND guest_payment_event_id IS NULL)
            OR (funding_kind = 'guest_cash' AND points_ledger_id IS NULL AND guest_payment_order_id IS NOT NULL AND guest_payment_event_id IS NOT NULL)
        ))
    )
);

CREATE TABLE IF NOT EXISTS public.shop_supplier_procurement_intents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL CONSTRAINT shop_supplier_intent_unit_unique UNIQUE REFERENCES public.shop_supplier_fulfillment_units(id) ON DELETE RESTRICT,
    supplier_account_id UUID NOT NULL REFERENCES public.shop_supplier_transaction_policies(supplier_account_id) ON DELETE RESTRICT,
    original_request_id UUID NOT NULL DEFAULT gen_random_uuid(),
    supplier_order_no TEXT,
    request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
    -- Execution states will be introduced with a separately verified adapter.
    status TEXT NOT NULL DEFAULT 'not_submitted' CONSTRAINT shop_supplier_intent_status_check CHECK (status = 'not_submitted'),
    exposure_status TEXT NOT NULL CHECK (exposure_status IN ('held', 'not_reserved')),
    reserved_cost_cny NUMERIC(18,6) NOT NULL CHECK (reserved_cost_cny >= 0 AND reserved_cost_cny <> 'NaN'::NUMERIC),
    actual_cost_cny NUMERIC(18,6),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT shop_supplier_intent_request_unique UNIQUE (supplier_account_id, original_request_id),
    CHECK ((exposure_status = 'held' AND reserved_cost_cny > 0) OR (exposure_status = 'not_reserved' AND reserved_cost_cny = 0)),
    -- Unknown cost remains NULL; a reservation is not an actual expense.
    CONSTRAINT shop_supplier_intent_unsubmitted_check CHECK (actual_cost_cny IS NULL AND supplier_order_no IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_shop_supplier_intent_upstream_order
    ON public.shop_supplier_procurement_intents(supplier_account_id, supplier_order_no)
    WHERE supplier_order_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shop_supplier_intent_budget
    ON public.shop_supplier_procurement_intents(supplier_account_id, exposure_status);

CREATE TABLE IF NOT EXISTS public.shop_supplier_transaction_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    intent_id UUID NOT NULL CONSTRAINT shop_supplier_outbox_intent_unique UNIQUE REFERENCES public.shop_supplier_procurement_intents(id) ON DELETE RESTRICT,
    task_kind TEXT NOT NULL DEFAULT 'supplier_purchase' CHECK (task_kind = 'supplier_purchase'),
    -- There is deliberately no claim RPC, runnable status, retry or expiry.
    status TEXT NOT NULL DEFAULT 'blocked' CONSTRAINT shop_supplier_outbox_status_check CHECK (status = 'blocked'),
    block_reason TEXT NOT NULL CHECK (block_reason IN ('procurement_contract_unverified', 'risk_budget_unavailable', 'customer_resolution_required')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.shop_supplier_transaction_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES public.shop_supplier_fulfillment_units(id) ON DELETE RESTRICT,
    event_type TEXT NOT NULL CHECK (event_type IN ('binding_prepared', 'funding_captured')),
    details JSONB NOT NULL CHECK (jsonb_typeof(details) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT shop_supplier_event_type_unique UNIQUE (unit_id, event_type)
);

ALTER TABLE public.shop_supplier_transaction_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_supplier_fulfillment_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_supplier_procurement_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_supplier_transaction_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_supplier_transaction_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_supplier_transaction_policies, public.shop_supplier_fulfillment_units,
    public.shop_supplier_procurement_intents, public.shop_supplier_transaction_outbox,
    public.shop_supplier_transaction_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.shop_supplier_transaction_policies, public.shop_supplier_fulfillment_units,
    public.shop_supplier_procurement_intents, public.shop_supplier_transaction_outbox,
    public.shop_supplier_transaction_events TO service_role;

-- Internal hook for a future native purchase/payment RPC. Points callers must
-- bind BEFORE their debit ledger INSERT, in that same database transaction.
-- Guest callers bind the pending order BEFORE making any payment request.
-- Calling this as a second RPC after collecting points is rejected.
CREATE OR REPLACE FUNCTION public.fn_bind_shop_supplier_funding_v2(
    p_funding_kind TEXT, p_order_id UUID, p_order_item_id UUID, p_buyer_user_id UUID,
    p_mapping_id UUID, p_mapping_revision TIMESTAMPTZ, p_cost_ceiling_cny NUMERIC, p_operation_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_unit public.shop_supplier_fulfillment_units%ROWTYPE;
    v_order public.shop_orders%ROWTYPE;
    v_item public.shop_order_items%ROWTYPE;
    v_guest public.guest_shop_orders%ROWTYPE;
    v_mapping public.shop_supplier_product_mappings%ROWTYPE;
    v_account public.shop_supplier_accounts%ROWTYPE;
    v_policy public.shop_supplier_transaction_policies%ROWTYPE;
    v_product_id UUID;
    v_sku_id UUID;
    v_sale_amount NUMERIC;
    v_fingerprint TEXT;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'supplier_service_role_required'; END IF;
    IF p_funding_kind IS NULL OR p_funding_kind NOT IN ('points', 'guest_cash') OR p_order_id IS NULL
        OR p_mapping_id IS NULL OR p_mapping_revision IS NULL OR p_operation_id IS NULL THEN
        RAISE EXCEPTION 'supplier_invalid_binding';
    END IF;
    IF p_cost_ceiling_cny IS NULL OR p_cost_ceiling_cny <= 0 OR p_cost_ceiling_cny >= 1000000000000
        OR LOWER(p_cost_ceiling_cny::TEXT) IN ('nan', 'infinity', '-infinity')
        OR p_cost_ceiling_cny <> ROUND(p_cost_ceiling_cny, 6) THEN
        RAISE EXCEPTION 'supplier_invalid_cost_ceiling';
    END IF;
    v_fingerprint := encode(sha256(convert_to(jsonb_build_object(
        'kind', p_funding_kind, 'order', p_order_id, 'item', p_order_item_id, 'buyer', p_buyer_user_id,
        'mapping', p_mapping_id, 'revision_epoch', EXTRACT(EPOCH FROM p_mapping_revision),
        'cost_ceiling_cny', ROUND(p_cost_ceiling_cny, 6))::TEXT, 'UTF8')), 'hex');
    PERFORM pg_advisory_xact_lock(hashtextextended('supplier_binding_v2:' || p_operation_id::TEXT, 0));
    SELECT * INTO v_unit FROM public.shop_supplier_fulfillment_units WHERE operation_id = p_operation_id;
    IF FOUND THEN
        IF v_unit.request_fingerprint <> v_fingerprint THEN RAISE EXCEPTION 'supplier_idempotency_conflict'; END IF;
        RETURN jsonb_build_object('unit_id', v_unit.id, 'funding_state', v_unit.funding_state,
            'already_bound', true, 'procurement_ready', false);
    END IF;

    IF p_funding_kind = 'points' THEN
        IF p_order_item_id IS NULL OR p_buyer_user_id IS NULL THEN RAISE EXCEPTION 'supplier_points_owner_required'; END IF;
        SELECT * INTO v_order FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'supplier_native_order_missing'; END IF;
        SELECT * INTO v_item FROM public.shop_order_items WHERE id = p_order_item_id AND order_id = p_order_id FOR UPDATE;
        IF NOT FOUND OR v_order.user_id IS DISTINCT FROM p_buyer_user_id OR v_order.site IS DISTINCT FROM 'cn'
            OR v_order.item_count IS DISTINCT FROM 1 OR v_order.inventory_id IS NOT NULL OR v_item.inventory_id IS NOT NULL
            OR v_order.delivery_task_id IS NOT NULL OR v_order.delivery_status IS DISTINCT FROM 'pending'
            OR v_order.delivery_completed_at IS NOT NULL OR COALESCE(v_order.refund_status, 'none') <> 'none'
            OR v_order.price_paid <= 0 OR v_item.price_paid IS DISTINCT FROM v_order.price_paid
            OR v_item.sku_id IS DISTINCT FROM v_order.sku_id
            OR (SELECT COUNT(*) FROM public.shop_order_items WHERE order_id = p_order_id) <> 1
            OR EXISTS (SELECT 1 FROM public.shop_webhook_tasks WHERE order_id = p_order_id) THEN
            RAISE EXCEPTION 'supplier_native_order_ineligible';
        END IF;
        IF EXISTS (SELECT 1 FROM public.points_ledger WHERE reference_id = 'SHOP_ORDER_' || p_order_id::TEXT) THEN
            RAISE EXCEPTION 'supplier_binding_must_precede_points_debit';
        END IF;
        v_product_id := v_order.product_id; v_sku_id := v_order.sku_id; v_sale_amount := v_order.price_paid;
    ELSE
        IF p_order_item_id IS NOT NULL OR p_buyer_user_id IS NOT NULL THEN RAISE EXCEPTION 'supplier_guest_owner_invalid'; END IF;
        SELECT * INTO v_guest FROM public.guest_shop_orders WHERE id = p_order_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'supplier_native_order_missing'; END IF;
        IF v_guest.site IS DISTINCT FROM 'cn' OR v_guest.currency IS DISTINCT FROM 'CNY' OR v_guest.quantity <> 1
            OR v_guest.payment_status NOT IN ('pending', 'created') OR v_guest.reservation_status <> 'none'
            OR v_guest.fulfillment_status <> 'pending' OR v_guest.refund_status <> 'none'
            OR v_guest.expires_at <= clock_timestamp()
            OR EXISTS (SELECT 1 FROM public.guest_shop_inventory_reservations WHERE order_id = p_order_id)
            OR EXISTS (SELECT 1 FROM public.guest_shop_payment_orders WHERE guest_order_id = p_order_id AND (status NOT IN ('pending', 'created') OR provider_order_no IS NOT NULL)) THEN
            RAISE EXCEPTION 'supplier_native_order_ineligible';
        END IF;
        v_product_id := v_guest.product_id; v_sku_id := v_guest.sku_id; v_sale_amount := v_guest.total_amount;
    END IF;
    IF EXISTS (SELECT 1 FROM public.shop_supplier_fulfillment_units
        WHERE shop_order_id = p_order_id OR guest_order_id = p_order_id) THEN
        RAISE EXCEPTION 'supplier_order_already_bound';
    END IF;
    SELECT * INTO v_mapping FROM public.shop_supplier_product_mappings WHERE id = p_mapping_id FOR SHARE;
    IF NOT FOUND OR v_mapping.site IS DISTINCT FROM 'cn' OR NOT v_mapping.is_enabled
        OR v_mapping.product_id IS DISTINCT FROM v_product_id OR v_mapping.sku_id IS DISTINCT FROM v_sku_id
        OR v_mapping.updated_at IS DISTINCT FROM p_mapping_revision OR v_mapping.contract_version <> 2
        OR jsonb_typeof(v_mapping.supplier_variant) IS DISTINCT FROM 'object'
        OR (v_mapping.supplier_variant - 'race') <> '{}'::JSONB
        OR (v_mapping.supplier_variant ? 'race' AND (
            jsonb_typeof(v_mapping.supplier_variant->'race') IS DISTINCT FROM 'string'
            OR LENGTH(BTRIM(v_mapping.supplier_variant->>'race')) NOT BETWEEN 1 AND 160
            OR v_mapping.supplier_variant->>'race' IS DISTINCT FROM BTRIM(v_mapping.supplier_variant->>'race')))
        OR v_mapping.supplier_variant_key IS DISTINCT FROM (CASE WHEN v_mapping.supplier_variant = '{}'::JSONB
            THEN 'default' ELSE 'v1:' || md5(v_mapping.supplier_variant::TEXT) END) THEN
        RAISE EXCEPTION 'supplier_mapping_changed_or_unavailable';
    END IF;
    SELECT * INTO v_account FROM public.shop_supplier_accounts WHERE id = v_mapping.supplier_account_id FOR SHARE;
    IF NOT FOUND OR NOT v_account.is_enabled THEN RAISE EXCEPTION 'supplier_account_unavailable'; END IF;
    SELECT * INTO v_policy FROM public.shop_supplier_transaction_policies
        WHERE supplier_account_id = v_account.id FOR UPDATE;
    IF NOT FOUND OR NOT v_policy.intake_enabled OR p_cost_ceiling_cny > v_policy.per_unit_cost_ceiling_cny THEN
        RAISE EXCEPTION 'supplier_intake_unavailable';
    END IF;
    INSERT INTO public.shop_supplier_fulfillment_units (operation_id, request_fingerprint, funding_kind, site,
        shop_order_id, shop_order_item_id, guest_order_id, buyer_user_id, product_id, sku_id, mapping_id,
        supplier_account_id, mapping_revision, source_snapshot, sale_amount, sale_currency, cost_ceiling_cny)
    VALUES (p_operation_id, v_fingerprint, p_funding_kind, 'cn',
        CASE WHEN p_funding_kind = 'points' THEN p_order_id END, p_order_item_id,
        CASE WHEN p_funding_kind = 'guest_cash' THEN p_order_id END, p_buyer_user_id,
        v_product_id, v_sku_id, p_mapping_id, v_account.id, p_mapping_revision,
        jsonb_build_object('provider_id', v_account.provider_id, 'supplier_account_id', v_account.id,
            'goods_no', v_mapping.supplier_goods_no, 'variant_key', v_mapping.supplier_variant_key,
            'variant', v_mapping.supplier_variant, 'contract_version', v_mapping.contract_version),
        v_sale_amount, CASE WHEN p_funding_kind = 'points' THEN 'POINTS' ELSE 'CNY' END, p_cost_ceiling_cny)
    RETURNING * INTO v_unit;
    INSERT INTO public.shop_supplier_transaction_events(unit_id, event_type, details)
    VALUES (v_unit.id, 'binding_prepared', jsonb_build_object('operation_id', p_operation_id, 'funding_kind', p_funding_kind));
    RETURN jsonb_build_object('unit_id', v_unit.id, 'funding_state', 'awaiting_payment',
        'already_bound', false, 'procurement_ready', false);
END;
$$;

-- Only the constraint triggers below can invoke this function. A points binding
-- without a matching debit rolls back the ENTIRE caller transaction at COMMIT.
CREATE OR REPLACE FUNCTION public.shop_supplier_capture_funding_v2(p_unit_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_unit public.shop_supplier_fulfillment_units%ROWTYPE;
    v_order public.shop_orders%ROWTYPE;
    v_guest public.guest_shop_orders%ROWTYPE;
    v_payment public.guest_shop_payment_orders%ROWTYPE;
    v_event public.guest_shop_payment_events%ROWTYPE;
    v_ledger public.points_ledger%ROWTYPE;
    v_policy public.shop_supplier_transaction_policies%ROWTYPE;
    v_reserved NUMERIC;
    v_count BIGINT;
    v_intent_id UUID;
    v_reason TEXT := 'procurement_contract_unverified';
    v_hold BOOLEAN := false;
BEGIN
    -- Serialize on the native order before the unit: the payment verifier uses
    -- that same lock order. Do not acquire unit -> order in this function.
    SELECT * INTO v_unit FROM public.shop_supplier_fulfillment_units WHERE id = p_unit_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'supplier_binding_missing'; END IF;
    IF v_unit.funding_kind = 'points' THEN
        SELECT * INTO v_order FROM public.shop_orders WHERE id = v_unit.shop_order_id FOR UPDATE;
    ELSE
        SELECT * INTO v_guest FROM public.guest_shop_orders WHERE id = v_unit.guest_order_id FOR UPDATE;
    END IF;
    SELECT * INTO v_unit FROM public.shop_supplier_fulfillment_units WHERE id = p_unit_id FOR UPDATE;
    IF v_unit.funding_state = 'funded' THEN RETURN; END IF;
    IF v_unit.funding_kind = 'points' THEN
        IF v_order.user_id IS DISTINCT FROM v_unit.buyer_user_id OR v_order.site IS DISTINCT FROM v_unit.site
            OR v_order.product_id IS DISTINCT FROM v_unit.product_id OR v_order.sku_id IS DISTINCT FROM v_unit.sku_id
            OR v_order.item_count IS DISTINCT FROM 1 OR v_order.price_paid IS DISTINCT FROM v_unit.sale_amount
            OR v_order.inventory_id IS NOT NULL OR v_order.delivery_task_id IS NOT NULL
            OR v_order.delivery_status IS DISTINCT FROM 'pending' OR v_order.delivery_completed_at IS NOT NULL
            OR COALESCE(v_order.refund_status, 'none') <> 'none'
            OR v_order.paid_points_spent IS NULL OR v_order.bonus_points_spent IS NULL
            OR v_order.paid_points_spent < 0 OR v_order.bonus_points_spent < 0
            OR v_order.paid_points_spent + v_order.bonus_points_spent <> v_unit.sale_amount
            OR (SELECT COUNT(*) FROM public.shop_order_items WHERE order_id = v_order.id) <> 1
            OR NOT EXISTS (SELECT 1 FROM public.shop_order_items WHERE id = v_unit.shop_order_item_id
                AND order_id = v_order.id AND sku_id = v_unit.sku_id
                AND price_paid = v_unit.sale_amount AND inventory_id IS NULL)
            OR EXISTS (SELECT 1 FROM public.shop_webhook_tasks WHERE order_id = v_order.id) THEN
            RAISE EXCEPTION 'supplier_points_funding_mismatch';
        END IF;
        SELECT COUNT(*) INTO v_count FROM public.points_ledger WHERE reference_id = 'SHOP_ORDER_' || v_order.id::TEXT;
        IF v_count <> 1 THEN RAISE EXCEPTION 'supplier_points_debit_required_in_transaction'; END IF;
        SELECT * INTO v_ledger FROM public.points_ledger WHERE reference_id = 'SHOP_ORDER_' || v_order.id::TEXT FOR SHARE;
        IF v_ledger.user_id IS DISTINCT FROM v_unit.buyer_user_id OR v_ledger.site IS DISTINCT FROM v_unit.site
            OR v_ledger.amount IS DISTINCT FROM -v_unit.sale_amount THEN
            RAISE EXCEPTION 'supplier_points_funding_mismatch';
        END IF;
    ELSE
        IF v_guest.payment_status IN ('pending', 'created') THEN RETURN; END IF;
        SELECT * INTO v_payment FROM public.guest_shop_payment_orders WHERE guest_order_id = v_guest.id FOR SHARE;
        IF NOT FOUND OR v_payment.status IS DISTINCT FROM 'confirmed' OR v_payment.site IS DISTINCT FROM v_unit.site
            OR v_payment.currency IS DISTINCT FROM 'CNY' OR v_payment.purpose IS DISTINCT FROM 'shop_direct'
            OR v_payment.merchant_order_no IS DISTINCT FROM v_guest.order_no
            OR v_payment.sign_verified IS DISTINCT FROM true OR v_payment.amount_verified IS DISTINCT FROM true
            OR v_payment.currency_verified IS DISTINCT FROM true OR v_payment.final_status_verified IS DISTINCT FROM true OR v_payment.paid_at IS NULL OR v_payment.verified_at IS NULL
            OR NULLIF(BTRIM(v_payment.provider_order_no), '') IS NULL
            OR v_payment.paid_amount IS DISTINCT FROM v_payment.expected_amount
            OR v_payment.expected_amount < v_unit.sale_amount
            OR v_guest.site IS DISTINCT FROM v_unit.site OR v_guest.currency IS DISTINCT FROM 'CNY'
            OR v_guest.product_id IS DISTINCT FROM v_unit.product_id OR v_guest.sku_id IS DISTINCT FROM v_unit.sku_id
            OR v_guest.quantity <> 1 OR v_guest.total_amount IS DISTINCT FROM v_unit.sale_amount
            OR v_guest.payment_status IS DISTINCT FROM 'confirmed' OR v_guest.paid_at IS NULL THEN
            RAISE EXCEPTION 'supplier_guest_verified_payment_required';
        END IF;
        SELECT * INTO v_event FROM public.guest_shop_payment_events e
        WHERE e.payment_order_id = v_payment.id AND e.provider = v_payment.provider
            AND e.provider_order_no = v_payment.provider_order_no AND e.merchant_order_no = v_payment.merchant_order_no
            AND e.signature_verified AND e.amount_verified
            AND e.currency_verified AND e.final_status_verified AND e.processing_status IN ('processed', 'duplicate')
            AND e.observed_site = v_unit.site AND e.observed_currency = 'CNY'
            AND e.observed_amount = v_payment.expected_amount AND e.observed_purpose = 'shop_direct'
            AND public.guest_shop_payment_is_final_success(e.observed_status)
        ORDER BY e.received_at, e.id LIMIT 1 FOR SHARE;
        IF NOT FOUND THEN RAISE EXCEPTION 'supplier_guest_verified_event_required'; END IF;
        IF v_guest.refund_status <> 'none' OR v_guest.reservation_status <> 'none'
            OR v_guest.fulfillment_status <> 'pending' OR v_guest.expires_at <= v_guest.paid_at
            OR EXISTS (SELECT 1 FROM public.guest_shop_inventory_reservations WHERE order_id = v_guest.id) THEN
            v_reason := 'customer_resolution_required';
        END IF;
    END IF;
    -- All budget writers lock the SAME account row before inspecting exposure.
    -- No TTL releases a reservation. Unresolved exposure remains held.
    SELECT * INTO v_policy FROM public.shop_supplier_transaction_policies
        WHERE supplier_account_id = v_unit.supplier_account_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'supplier_transaction_policy_missing'; END IF;
    -- Touch the serialization row as well as locking it. Under REPEATABLE READ
    -- a concurrent reservation must serialize-fail, not use an old SUM snapshot.
    UPDATE public.shop_supplier_transaction_policies SET budget_version = budget_version + 1
        WHERE supplier_account_id = v_unit.supplier_account_id;
    SELECT COUNT(*), COALESCE(SUM(reserved_cost_cny), 0) INTO v_count, v_reserved
        FROM public.shop_supplier_procurement_intents
        WHERE supplier_account_id = v_unit.supplier_account_id AND exposure_status = 'held';
    IF v_reason <> 'customer_resolution_required' AND v_count < v_policy.max_unresolved_units
        AND v_unit.cost_ceiling_cny <= v_policy.per_unit_cost_ceiling_cny
        AND v_reserved + v_unit.cost_ceiling_cny <= v_policy.max_reserved_cost_cny THEN
        v_hold := true;
    ELSIF v_unit.funding_kind = 'points' THEN
        RAISE EXCEPTION 'supplier_risk_budget_unavailable';
    ELSIF v_reason <> 'customer_resolution_required' THEN
        -- A verified cash payment must remain a recorded fact even if capacity
        -- changed after checkout. Block procurement; do not discard the payment.
        v_reason := 'risk_budget_unavailable';
    END IF;
    INSERT INTO public.shop_supplier_procurement_intents(unit_id, supplier_account_id, request_fingerprint,
        exposure_status, reserved_cost_cny)
    VALUES (v_unit.id, v_unit.supplier_account_id, v_unit.request_fingerprint,
        CASE WHEN v_hold THEN 'held' ELSE 'not_reserved' END, CASE WHEN v_hold THEN v_unit.cost_ceiling_cny ELSE 0 END)
    RETURNING id INTO v_intent_id;
    INSERT INTO public.shop_supplier_transaction_outbox(intent_id, block_reason) VALUES (v_intent_id, v_reason);
    UPDATE public.shop_supplier_fulfillment_units SET funding_state = 'funded', funded_at = clock_timestamp(),
        points_ledger_id = CASE WHEN v_unit.funding_kind = 'points' THEN v_ledger.id END,
        guest_payment_order_id = CASE WHEN v_unit.funding_kind = 'guest_cash' THEN v_payment.id END,
        guest_payment_event_id = CASE WHEN v_unit.funding_kind = 'guest_cash' THEN v_event.id END
    WHERE id = v_unit.id;
    INSERT INTO public.shop_supplier_transaction_events(unit_id, event_type, details)
    VALUES (v_unit.id, 'funding_captured', jsonb_build_object('funding_kind', v_unit.funding_kind,
        'intent_id', v_intent_id, 'budget_held', v_hold, 'outbox_status', 'blocked', 'block_reason', v_reason));
END;
$$;

CREATE OR REPLACE FUNCTION public.shop_supplier_funding_boundary_v2() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    PERFORM public.shop_supplier_capture_funding_v2(NEW.id);
    RETURN NULL;
END;
$$;
CREATE OR REPLACE FUNCTION public.shop_supplier_guest_payment_boundary_v2() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_unit_id UUID;
BEGIN
    SELECT id INTO v_unit_id FROM public.shop_supplier_fulfillment_units WHERE guest_order_id = NEW.guest_order_id;
    IF FOUND THEN PERFORM public.shop_supplier_capture_funding_v2(v_unit_id); END IF;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS tr_shop_supplier_funding_boundary_v2 ON public.shop_supplier_fulfillment_units;
CREATE CONSTRAINT TRIGGER tr_shop_supplier_funding_boundary_v2
    AFTER INSERT ON public.shop_supplier_fulfillment_units DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION public.shop_supplier_funding_boundary_v2();
DROP TRIGGER IF EXISTS tr_shop_supplier_guest_payment_boundary_v2 ON public.guest_shop_payment_orders;
CREATE CONSTRAINT TRIGGER tr_shop_supplier_guest_payment_boundary_v2
    AFTER UPDATE ON public.guest_shop_payment_orders DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW WHEN (NEW.status = 'confirmed' AND OLD.status IS DISTINCT FROM 'confirmed')
    EXECUTE FUNCTION public.shop_supplier_guest_payment_boundary_v2();

REVOKE ALL ON FUNCTION public.fn_bind_shop_supplier_funding_v2(TEXT, UUID, UUID, UUID, UUID, TIMESTAMPTZ, NUMERIC, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bind_shop_supplier_funding_v2(TEXT, UUID, UUID, UUID, UUID, TIMESTAMPTZ, NUMERIC, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.shop_supplier_capture_funding_v2(UUID), public.shop_supplier_funding_boundary_v2(),
    public.shop_supplier_guest_payment_boundary_v2() FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION public.fn_bind_shop_supplier_funding_v2(TEXT, UUID, UUID, UUID, UUID, TIMESTAMPTZ, NUMERIC, UUID) IS
    'P2A private CN quantity-one funding hook. Points bind before debit within native purchase transaction; guest binds before payment. No purchase, debit or upstream side effect is performed by this RPC.';
COMMENT ON TABLE public.shop_supplier_transaction_outbox IS
    'P2A blocked supplier intents only. This is not the legacy webhook queue. No dispatch/retry/expiry is implemented or authorized.';
COMMIT;
