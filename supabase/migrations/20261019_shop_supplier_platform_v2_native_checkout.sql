-- P2B native checkout wiring. Apply manually AFTER readonly and funding_boundary.
-- No upstream submission, dispatch worker, credentials or sales switch is enabled.
-- Patches the INSTALLED native functions by checked anchors; never restores an old body.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.shop_supplier_transaction_policies
    ADD COLUMN IF NOT EXISTS checkout_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.shop_orders
    ADD COLUMN IF NOT EXISTS fulfillment_source TEXT NOT NULL DEFAULT 'local';
ALTER TABLE public.guest_shop_orders
    ADD COLUMN IF NOT EXISTS fulfillment_source TEXT NOT NULL DEFAULT 'local';
-- CHECKs are additive/idempotent; existing local orders are unchanged.
DO $constraints$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.shop_orders'::regclass
        AND conname = 'shop_orders_fulfillment_source_v2_check') THEN
        ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_fulfillment_source_v2_check
            CHECK (fulfillment_source IN ('local', 'supplier_v2'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.guest_shop_orders'::regclass
        AND conname = 'guest_shop_orders_fulfillment_source_v2_check') THEN
        ALTER TABLE public.guest_shop_orders ADD CONSTRAINT guest_shop_orders_fulfillment_source_v2_check
            CHECK (fulfillment_source IN ('local', 'supplier_v2'));
    END IF;
END;
$constraints$;

CREATE TABLE IF NOT EXISTS public.shop_supplier_checkout_quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id UUID NOT NULL UNIQUE,
    funding_kind TEXT NOT NULL CHECK (funding_kind IN ('points', 'guest_cash')),
    buyer_user_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
    guest_owner_hash TEXT CHECK (guest_owner_hash ~ '^[a-f0-9]{64}$'),
    native_request_fingerprint TEXT CHECK (native_request_fingerprint ~ '^[a-f0-9]{64}$'),
    product_id UUID NOT NULL REFERENCES public.shop_products(id) ON DELETE RESTRICT,
    sku_id UUID NOT NULL,
    mapping_id UUID NOT NULL REFERENCES public.shop_supplier_product_mappings(id) ON DELETE RESTRICT,
    mapping_revision TIMESTAMPTZ NOT NULL,
    supplier_account_id UUID NOT NULL REFERENCES public.shop_supplier_transaction_policies(supplier_account_id) ON DELETE RESTRICT,
    sale_amount NUMERIC(18,2) NOT NULL CHECK (sale_amount > 0 AND sale_amount <> 'NaN'::NUMERIC),
    sale_currency TEXT NOT NULL CHECK (sale_currency IN ('POINTS', 'CNY')),
    -- Policy risk ceiling, NEVER an assumed supplier quote/currency or actual cost.
    cost_ceiling_cny NUMERIC(18,6) NOT NULL CHECK (cost_ceiling_cny > 0 AND cost_ceiling_cny <> 'NaN'::NUMERIC),
    status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'consumed')),
    expires_at TIMESTAMPTZ NOT NULL,
    shop_order_id UUID UNIQUE REFERENCES public.shop_orders(id) ON DELETE RESTRICT,
    guest_order_id UUID UNIQUE REFERENCES public.guest_shop_orders(id) ON DELETE RESTRICT,
    native_params_hash TEXT CHECK (native_params_hash ~ '^[a-f0-9]{64}$'),
    replay_result JSONB CHECK (jsonb_typeof(replay_result) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    consumed_at TIMESTAMPTZ,
    FOREIGN KEY (product_id, sku_id) REFERENCES public.shop_product_skus(product_id, id) ON DELETE RESTRICT,
    CHECK ((funding_kind = 'points' AND buyer_user_id IS NOT NULL AND guest_owner_hash IS NULL
        AND native_request_fingerprint IS NULL AND sale_currency = 'POINTS')
        OR (funding_kind = 'guest_cash' AND buyer_user_id IS NULL AND guest_owner_hash IS NOT NULL
        AND native_request_fingerprint IS NOT NULL AND sale_currency = 'CNY')),
    CHECK ((status = 'issued' AND consumed_at IS NULL AND shop_order_id IS NULL AND guest_order_id IS NULL
            AND replay_result IS NULL AND native_params_hash IS NULL)
        OR (status = 'consumed' AND consumed_at IS NOT NULL AND replay_result IS NOT NULL
            AND ((funding_kind = 'points' AND shop_order_id IS NOT NULL AND guest_order_id IS NULL)
                OR (funding_kind = 'guest_cash' AND shop_order_id IS NULL AND guest_order_id IS NOT NULL
                    AND native_params_hash IS NOT NULL))))
);
ALTER TABLE public.shop_supplier_checkout_quotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shop_supplier_checkout_quotes FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.shop_supplier_checkout_quotes TO service_role;

-- A disabled mapping still classifies this SKU as supplier-owned. It must never
-- fall back to the local-stock path when configuration is disabled/ambiguous.
CREATE OR REPLACE FUNCTION public.shop_supplier_has_source_v2(p_product_id UUID, p_sku_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM public.shop_supplier_product_mappings
        WHERE product_id = p_product_id AND sku_id = p_sku_id AND contract_version = 2);
$$;
CREATE OR REPLACE FUNCTION public.fn_shop_supplier_source_v2(p_product_id UUID, p_sku_id UUID, p_site TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_sku_id UUID := p_sku_id;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'supplier_service_role_required'; END IF;
    IF v_sku_id IS NULL THEN
        SELECT id INTO v_sku_id FROM public.shop_product_skus
        WHERE product_id = p_product_id AND is_default ORDER BY id LIMIT 1;
    END IF;
    RETURN jsonb_build_object('is_supplier', public.shop_supplier_has_source_v2(p_product_id, v_sku_id),
        'sku_id', v_sku_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_issue_shop_supplier_quote_v2(
    p_operation_id UUID, p_funding_kind TEXT, p_buyer_user_id UUID, p_guest_owner_hash TEXT,
    p_product_id UUID, p_sku_id UUID, p_native_request_fingerprint TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_quote public.shop_supplier_checkout_quotes%ROWTYPE;
    v_product public.shop_products%ROWTYPE;
    v_sku public.shop_product_skus%ROWTYPE;
    v_mapping public.shop_supplier_product_mappings%ROWTYPE;
    v_policy public.shop_supplier_transaction_policies%ROWTYPE;
    v_price NUMERIC;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'supplier_service_role_required'; END IF;
    IF p_operation_id IS NULL OR p_product_id IS NULL OR p_sku_id IS NULL
        OR p_funding_kind IS NULL OR p_funding_kind NOT IN ('points', 'guest_cash')
        OR (p_funding_kind = 'points' AND (p_buyer_user_id IS NULL OR p_guest_owner_hash IS NOT NULL OR p_native_request_fingerprint IS NOT NULL))
        OR (p_funding_kind = 'guest_cash' AND (p_buyer_user_id IS NOT NULL OR p_guest_owner_hash IS NULL
            OR p_guest_owner_hash !~ '^[a-f0-9]{64}$' OR p_native_request_fingerprint IS NULL
            OR p_native_request_fingerprint !~ '^[a-f0-9]{64}$')) THEN
        RAISE EXCEPTION 'supplier_idempotency_conflict';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('supplier_quote_v2:' || p_operation_id::TEXT, 0));
    SELECT * INTO v_quote FROM public.shop_supplier_checkout_quotes WHERE operation_id = p_operation_id FOR UPDATE;
    IF FOUND THEN
        IF v_quote.funding_kind IS DISTINCT FROM p_funding_kind OR v_quote.buyer_user_id IS DISTINCT FROM p_buyer_user_id
            OR v_quote.guest_owner_hash IS DISTINCT FROM p_guest_owner_hash
            OR v_quote.native_request_fingerprint IS DISTINCT FROM p_native_request_fingerprint
            OR v_quote.product_id IS DISTINCT FROM p_product_id OR v_quote.sku_id IS DISTINCT FROM p_sku_id THEN
            RAISE EXCEPTION 'supplier_idempotency_conflict';
        END IF;
        -- Consumed recovery precedes TTL/config checks. An issued expired key is
        -- not silently recycled into another purchase; use a NEW operation key.
        IF v_quote.status <> 'consumed' AND v_quote.expires_at <= clock_timestamp() THEN
            RAISE EXCEPTION 'supplier_quote_expired';
        END IF;
        RETURN jsonb_build_object('quote_id', v_quote.id, 'status', v_quote.status);
    END IF;
    SELECT * INTO v_product FROM public.shop_products WHERE id = p_product_id FOR UPDATE;
    IF NOT FOUND OR NOT v_product.is_active OR COALESCE(v_product.manual_delivery, false)
        OR UPPER(COALESCE(v_product.delivery_type, 'KEY')) <> 'KEY' THEN RAISE EXCEPTION 'supplier_quote_changed'; END IF;
    SELECT * INTO v_sku FROM public.shop_product_skus WHERE id = p_sku_id AND product_id = p_product_id FOR UPDATE;
    IF NOT FOUND OR NOT v_sku.is_active OR COALESCE(v_sku.manual_delivery, false) THEN RAISE EXCEPTION 'supplier_quote_changed'; END IF;
    IF (SELECT COUNT(*) FROM public.shop_supplier_product_mappings WHERE product_id = p_product_id AND sku_id = p_sku_id
        AND site = 'cn' AND contract_version = 2 AND is_enabled AND is_primary) <> 1 THEN
        RAISE EXCEPTION 'supplier_quote_changed';
    END IF;
    SELECT * INTO v_mapping FROM public.shop_supplier_product_mappings WHERE product_id = p_product_id AND sku_id = p_sku_id
        AND site = 'cn' AND contract_version = 2 AND is_enabled AND is_primary FOR SHARE;
    PERFORM 1 FROM public.shop_supplier_accounts WHERE id = v_mapping.supplier_account_id AND is_enabled FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'supplier_checkout_unavailable'; END IF;
    SELECT * INTO v_policy FROM public.shop_supplier_transaction_policies WHERE supplier_account_id = v_mapping.supplier_account_id FOR SHARE;
    IF NOT FOUND OR NOT v_policy.intake_enabled OR NOT v_policy.checkout_enabled OR v_policy.per_unit_cost_ceiling_cny <= 0 THEN
        RAISE EXCEPTION 'supplier_checkout_unavailable';
    END IF;
    IF p_funding_kind = 'guest_cash' AND NOT COALESCE(v_sku.allow_guest_purchase, v_product.allow_guest_purchase, false) THEN
        RAISE EXCEPTION 'supplier_checkout_unavailable';
    END IF;
    v_price := public.guest_shop_resolve_credit_unit_amount_with_start('cn',
        v_sku.price_points, v_sku.price_points_intl, COALESCE(v_sku.is_default, false),
        v_sku.quantity_rules, v_sku.quantity_rules_intl, v_product.quantity_rules, v_product.quantity_rules_intl,
        v_product.flash_sale_price, v_product.flash_sale_price_intl, v_product.flash_sale_end, v_product.flash_sale_end_intl,
        1, clock_timestamp(), v_product.flash_sale_start, v_product.flash_sale_start_intl);
    IF v_price IS NULL OR v_price <= 0 OR v_price >= 1000000000000
        OR LOWER(v_price::TEXT) IN ('nan', 'infinity', '-infinity') OR v_price <> ROUND(v_price, 2) THEN
        RAISE EXCEPTION 'supplier_quote_changed';
    END IF;
    INSERT INTO public.shop_supplier_checkout_quotes(operation_id, funding_kind, buyer_user_id, guest_owner_hash,
        native_request_fingerprint, product_id, sku_id, mapping_id, mapping_revision, supplier_account_id,
        sale_amount, sale_currency, cost_ceiling_cny, expires_at)
    VALUES (p_operation_id, p_funding_kind, p_buyer_user_id, p_guest_owner_hash, p_native_request_fingerprint,
        p_product_id, p_sku_id, v_mapping.id, v_mapping.updated_at, v_mapping.supplier_account_id, v_price,
        CASE WHEN p_funding_kind = 'points' THEN 'POINTS' ELSE 'CNY' END,
        v_policy.per_unit_cost_ceiling_cny, clock_timestamp() + INTERVAL '120 seconds') RETURNING * INTO v_quote;
    RETURN jsonb_build_object('quote_id', v_quote.id, 'status', 'issued');
END;
$$;

-- Internal transaction-local capability. A caller setting an arbitrary GUC or
-- invoking a legacy authenticated RPC cannot authorize this branch.
CREATE OR REPLACE FUNCTION public.shop_supplier_checkout_context_v2(
    p_product_id UUID, p_sku_id UUID, p_kind TEXT, p_buyer_user_id UUID
) RETURNS public.shop_supplier_checkout_quotes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_quote public.shop_supplier_checkout_quotes%ROWTYPE;
    v_quote_id UUID := NULLIF(current_setting('app.shop_supplier_quote_v2', true), '')::UUID;
BEGIN
    IF NOT public.shop_supplier_has_source_v2(p_product_id, p_sku_id) THEN
        IF v_quote_id IS NOT NULL THEN RAISE EXCEPTION 'supplier_quote_changed'; END IF;
        RETURN v_quote;
    END IF;
    IF COALESCE(auth.role(), '') <> 'service_role' OR v_quote_id IS NULL THEN
        RAISE EXCEPTION 'supplier_checkout_unavailable';
    END IF;
    SELECT * INTO v_quote FROM public.shop_supplier_checkout_quotes WHERE id = v_quote_id FOR UPDATE;
    IF NOT FOUND OR v_quote.status <> 'issued' OR v_quote.product_id IS DISTINCT FROM p_product_id
        OR v_quote.sku_id IS DISTINCT FROM p_sku_id OR v_quote.funding_kind IS DISTINCT FROM p_kind
        OR v_quote.buyer_user_id IS DISTINCT FROM p_buyer_user_id THEN RAISE EXCEPTION 'supplier_idempotency_conflict'; END IF;
    IF v_quote.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'supplier_quote_expired'; END IF;
    PERFORM 1 FROM public.shop_products p JOIN public.shop_product_skus s ON s.product_id = p.id
        WHERE p.id = p_product_id AND s.id = p_sku_id AND p.is_active AND s.is_active
            AND NOT COALESCE(p.manual_delivery, false) AND NOT COALESCE(s.manual_delivery, false)
            AND UPPER(COALESCE(p.delivery_type, 'KEY')) = 'KEY' FOR SHARE OF p, s;
    IF NOT FOUND THEN RAISE EXCEPTION 'supplier_quote_changed'; END IF;
    PERFORM 1 FROM public.shop_supplier_product_mappings m JOIN public.shop_supplier_accounts a ON a.id = m.supplier_account_id
        WHERE m.id = v_quote.mapping_id AND m.product_id = p_product_id AND m.sku_id = p_sku_id AND m.site = 'cn'
            AND m.contract_version = 2 AND m.is_enabled AND m.is_primary AND m.updated_at = v_quote.mapping_revision
            AND m.supplier_account_id = v_quote.supplier_account_id AND a.is_enabled
        FOR SHARE OF m, a;
    IF NOT FOUND OR (SELECT COUNT(*) FROM public.shop_supplier_product_mappings WHERE product_id = p_product_id
        AND sku_id = p_sku_id AND site = 'cn' AND contract_version = 2 AND is_enabled AND is_primary) <> 1 THEN
        RAISE EXCEPTION 'supplier_quote_changed';
    END IF;
    -- Take the eventual budget lock directly. SHARE -> UPDATE upgrades from
    -- parallel checkouts on the same account would otherwise deadlock.
    PERFORM 1 FROM public.shop_supplier_transaction_policies
        WHERE supplier_account_id = v_quote.supplier_account_id AND intake_enabled AND checkout_enabled
            AND per_unit_cost_ceiling_cny >= v_quote.cost_ceiling_cny FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'supplier_quote_changed'; END IF;
    RETURN v_quote;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_purchase_shop_supplier_points_v2(p_quote_id UUID, p_buyer_user_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_quote public.shop_supplier_checkout_quotes%ROWTYPE;
    v_result JSONB;
    v_previous TEXT := COALESCE(current_setting('app.shop_supplier_quote_v2', true), '');
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'supplier_service_role_required'; END IF;
    SELECT * INTO v_quote FROM public.shop_supplier_checkout_quotes WHERE id = p_quote_id FOR UPDATE;
    IF NOT FOUND OR v_quote.funding_kind <> 'points' OR v_quote.buyer_user_id IS DISTINCT FROM p_buyer_user_id
        OR p_buyer_user_id IS NULL THEN RAISE EXCEPTION 'supplier_idempotency_conflict'; END IF;
    IF v_quote.status = 'consumed' THEN RETURN v_quote.replay_result; END IF;
    PERFORM set_config('app.shop_supplier_quote_v2', v_quote.id::TEXT, true);
    v_result := public.fn_purchase_shop_item_core(v_quote.product_id, p_buyer_user_id, 'cn'::VARCHAR,
        1, NULL::VARCHAR, NULL::UUID, v_quote.sku_id);
    -- Native core catches errors into JSON. Raising here rolls back ANY native
    -- balance/order/lot changes; a success:false must never consume the quote.
    IF v_result->>'success' IS DISTINCT FROM 'true' OR NULLIF(v_result#>>'{data,order_id}', '') IS NULL THEN
        RAISE EXCEPTION 'supplier_checkout_rejected';
    END IF;
    v_result := jsonb_set(v_result, '{data}', (v_result->'data') || jsonb_build_object(
        'content', NULL, 'delivery_status', 'pending', 'fulfillment_source', 'supplier_v2',
        'fulfillment_message', '订单已受理，正在等待供货处理，请在订单记录中查看进度'));
    UPDATE public.shop_supplier_checkout_quotes SET status = 'consumed', consumed_at = clock_timestamp(),
        shop_order_id = (v_result#>>'{data,order_id}')::UUID, replay_result = v_result WHERE id = v_quote.id;
    PERFORM set_config('app.shop_supplier_quote_v2', v_previous, true);
    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_create_shop_supplier_guest_order_v2(
    p_quote_id UUID, p_site TEXT, p_product_id UUID, p_sku_id UUID, p_idempotency_key TEXT,
    p_request_fingerprint TEXT, p_claim_secret_hash TEXT, p_provider TEXT, p_channel TEXT,
    p_buyer_contact_hash TEXT DEFAULT NULL, p_buyer_id UUID DEFAULT NULL,
    p_request_ip_hash TEXT DEFAULT NULL, p_request_device_hash TEXT DEFAULT NULL,
    p_ttl_seconds INTEGER DEFAULT 1800, p_quantity INTEGER DEFAULT 1, p_discount_code TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_quote public.shop_supplier_checkout_quotes%ROWTYPE;
    v_result JSONB;
    v_native_hash TEXT;
    v_previous TEXT := COALESCE(current_setting('app.shop_supplier_quote_v2', true), '');
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'supplier_service_role_required'; END IF;
    IF p_site IS DISTINCT FROM 'cn' OR p_quantity IS DISTINCT FROM 1 OR NULLIF(BTRIM(p_discount_code), '') IS NOT NULL THEN
        RAISE EXCEPTION 'supplier_checkout_scope_unsupported';
    END IF;
    -- Real native claim hash includes its algorithm/version prefix. Ownership
    -- is stable across price changes; request fingerprint is checked separately.
    IF p_claim_secret_hash IS NULL OR p_claim_secret_hash !~ '^hmac-sha256:v[1-9][0-9]{0,5}:[a-f0-9]{64}$' THEN
        RAISE EXCEPTION 'supplier_idempotency_conflict';
    END IF;
    v_native_hash := encode(sha256(convert_to(jsonb_build_object('site', p_site, 'product', p_product_id,
        'sku', p_sku_id, 'key', BTRIM(p_idempotency_key), 'fingerprint', p_request_fingerprint,
        'claim', p_claim_secret_hash, 'provider', LOWER(BTRIM(p_provider)), 'channel', LOWER(BTRIM(p_channel)),
        'contact', p_buyer_contact_hash, 'buyer', p_buyer_id)::TEXT, 'UTF8')), 'hex');
    SELECT * INTO v_quote FROM public.shop_supplier_checkout_quotes WHERE id = p_quote_id FOR UPDATE;
    IF NOT FOUND OR v_quote.funding_kind <> 'guest_cash' OR v_quote.product_id IS DISTINCT FROM p_product_id
        OR v_quote.sku_id IS DISTINCT FROM p_sku_id OR v_quote.native_request_fingerprint IS DISTINCT FROM p_request_fingerprint
        OR v_quote.guest_owner_hash IS DISTINCT FROM encode(sha256(convert_to(p_claim_secret_hash, 'UTF8')), 'hex') THEN
        RAISE EXCEPTION 'supplier_idempotency_conflict';
    END IF;
    IF v_quote.status = 'consumed' THEN
        IF v_quote.native_params_hash IS DISTINCT FROM v_native_hash THEN RAISE EXCEPTION 'supplier_idempotency_conflict'; END IF;
        RETURN v_quote.replay_result;
    END IF;
    PERFORM set_config('app.shop_supplier_quote_v2', v_quote.id::TEXT, true);
    SELECT to_jsonb(r) INTO v_result FROM public.fn_guest_shop_create_order(p_site, p_product_id, p_sku_id,
        p_idempotency_key, p_request_fingerprint, p_claim_secret_hash, p_provider, p_channel,
        p_buyer_contact_hash, p_buyer_id, p_request_ip_hash, p_request_device_hash, p_ttl_seconds, p_quantity, p_discount_code) r;
    IF NULLIF(v_result->>'order_id', '') IS NULL OR NOT EXISTS (SELECT 1 FROM public.shop_supplier_fulfillment_units
        WHERE guest_order_id = (v_result->>'order_id')::UUID AND operation_id = v_quote.operation_id) THEN
        RAISE EXCEPTION 'supplier_idempotency_conflict';
    END IF;
    v_result := v_result || jsonb_build_object('fulfillment_source', 'supplier_v2');
    UPDATE public.shop_supplier_checkout_quotes SET status = 'consumed', consumed_at = clock_timestamp(),
        guest_order_id = (v_result->>'order_id')::UUID, native_params_hash = v_native_hash, replay_result = v_result WHERE id = v_quote.id;
    PERFORM set_config('app.shop_supplier_quote_v2', v_previous, true);
    RETURN v_result;
END;
$$;

-- Source ownership cannot be bypassed through a legacy purchase, marketplace,
-- multi-discount/cart RPC, manual local delivery, or direct order/item writes.
CREATE OR REPLACE FUNCTION public.shop_supplier_native_order_guard_v2() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_quote public.shop_supplier_checkout_quotes%ROWTYPE;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.fulfillment_source IS DISTINCT FROM OLD.fulfillment_source THEN RAISE EXCEPTION 'supplier_source_immutable'; END IF;
        IF OLD.fulfillment_source <> 'supplier_v2' THEN RETURN NEW; END IF;
        IF NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.sku_id IS DISTINCT FROM OLD.sku_id
            OR NEW.site IS DISTINCT FROM OLD.site THEN RAISE EXCEPTION 'supplier_source_immutable'; END IF;
    ELSE
        IF TG_TABLE_NAME = 'shop_orders' THEN
            v_quote := public.shop_supplier_checkout_context_v2(NEW.product_id, NEW.sku_id, 'points', NEW.user_id);
        ELSE
            v_quote := public.shop_supplier_checkout_context_v2(NEW.product_id, NEW.sku_id, 'guest_cash', NULL);
        END IF;
        IF v_quote.id IS NULL THEN
            IF NEW.fulfillment_source <> 'local' THEN RAISE EXCEPTION 'supplier_checkout_unavailable'; END IF;
            RETURN NEW;
        END IF;
        NEW.fulfillment_source := 'supplier_v2';
        IF NEW.site IS DISTINCT FROM 'cn' THEN RAISE EXCEPTION 'supplier_checkout_scope_unsupported'; END IF;
        IF TG_TABLE_NAME = 'shop_orders' THEN
            IF NEW.item_count IS DISTINCT FROM 1 OR NEW.price_paid IS DISTINCT FROM v_quote.sale_amount THEN
                RAISE EXCEPTION 'supplier_quote_changed';
            END IF;
        ELSE
            IF NEW.quantity IS DISTINCT FROM 1 OR NEW.total_amount IS DISTINCT FROM v_quote.sale_amount THEN
                RAISE EXCEPTION 'supplier_quote_changed';
            END IF;
        END IF;
    END IF;
    -- P2B has no supplier delivery executor. An ordinary stock/admin function
    -- must not invent delivery or attach a local inventory/webhook task.
    IF TG_TABLE_NAME = 'shop_orders' THEN
        IF NEW.inventory_id IS NOT NULL OR NEW.delivery_task_id IS NOT NULL
            OR NEW.delivery_status = 'delivered' OR NEW.delivery_completed_at IS NOT NULL THEN
            RAISE EXCEPTION 'supplier_local_fulfillment_forbidden';
        END IF;
    ELSE
        IF NEW.reservation_status IS DISTINCT FROM 'none' OR NEW.fulfillment_status IN ('delivered', 'fulfilling')
            OR NEW.fulfilled_at IS NOT NULL THEN RAISE EXCEPTION 'supplier_local_fulfillment_forbidden'; END IF;
        IF NEW.total_amount - COALESCE(NEW.payment_fee_amount, 0) IS DISTINCT FROM NEW.unit_amount * NEW.quantity THEN
            RAISE EXCEPTION 'supplier_quote_changed';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_shop_supplier_native_order_guard_v2 ON public.shop_orders;
CREATE TRIGGER tr_shop_supplier_native_order_guard_v2 BEFORE INSERT OR UPDATE ON public.shop_orders
    FOR EACH ROW EXECUTE FUNCTION public.shop_supplier_native_order_guard_v2();
DROP TRIGGER IF EXISTS tr_guest_supplier_native_order_guard_v2 ON public.guest_shop_orders;
CREATE TRIGGER tr_guest_supplier_native_order_guard_v2 BEFORE INSERT OR UPDATE ON public.guest_shop_orders
    FOR EACH ROW EXECUTE FUNCTION public.shop_supplier_native_order_guard_v2();

CREATE OR REPLACE FUNCTION public.shop_supplier_local_stock_guard_v2() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF TG_TABLE_NAME = 'guest_shop_checkout_items' THEN
        IF public.shop_supplier_has_source_v2(NEW.product_id, NEW.sku_id) THEN RAISE EXCEPTION 'supplier_checkout_scope_unsupported'; END IF;
    ELSIF TG_TABLE_NAME = 'guest_shop_inventory_reservations' THEN
        IF EXISTS (SELECT 1 FROM public.guest_shop_orders WHERE id = NEW.order_id AND fulfillment_source = 'supplier_v2') THEN
            RAISE EXCEPTION 'supplier_local_fulfillment_forbidden';
        END IF;
    ELSE
        IF NEW.inventory_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.shop_orders WHERE id = NEW.order_id AND fulfillment_source = 'supplier_v2') THEN
            RAISE EXCEPTION 'supplier_local_fulfillment_forbidden';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS tr_supplier_batch_stock_guard_v2 ON public.guest_shop_checkout_items;
CREATE TRIGGER tr_supplier_batch_stock_guard_v2 BEFORE INSERT OR UPDATE ON public.guest_shop_checkout_items
    FOR EACH ROW EXECUTE FUNCTION public.shop_supplier_local_stock_guard_v2();
DROP TRIGGER IF EXISTS tr_supplier_guest_stock_guard_v2 ON public.guest_shop_inventory_reservations;
CREATE TRIGGER tr_supplier_guest_stock_guard_v2 BEFORE INSERT OR UPDATE ON public.guest_shop_inventory_reservations
    FOR EACH ROW EXECUTE FUNCTION public.shop_supplier_local_stock_guard_v2();
DROP TRIGGER IF EXISTS tr_supplier_points_stock_guard_v2 ON public.shop_order_items;
CREATE TRIGGER tr_supplier_points_stock_guard_v2 BEFORE INSERT OR UPDATE ON public.shop_order_items
    FOR EACH ROW EXECUTE FUNCTION public.shop_supplier_local_stock_guard_v2();

-- A supplier-marked native order must commit with BOTH its funding unit and
-- consumed quote. A raw core call with a leaked GUC cannot leave an orphan order.
CREATE OR REPLACE FUNCTION public.shop_supplier_assert_native_binding_v2() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.fulfillment_source <> 'supplier_v2' THEN RETURN NULL; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.shop_supplier_fulfillment_units u
        JOIN public.shop_supplier_checkout_quotes q ON q.operation_id = u.operation_id
        WHERE q.status = 'consumed' AND q.product_id = NEW.product_id AND q.sku_id = NEW.sku_id
            AND ((TG_TABLE_NAME = 'shop_orders' AND q.shop_order_id = NEW.id AND u.shop_order_id = NEW.id)
                OR (TG_TABLE_NAME = 'guest_shop_orders' AND q.guest_order_id = NEW.id AND u.guest_order_id = NEW.id))) THEN
        RAISE EXCEPTION 'supplier_native_binding_required';
    END IF;
    RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS tr_supplier_points_binding_commit_v2 ON public.shop_orders;
CREATE CONSTRAINT TRIGGER tr_supplier_points_binding_commit_v2 AFTER INSERT ON public.shop_orders
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.shop_supplier_assert_native_binding_v2();
DROP TRIGGER IF EXISTS tr_supplier_guest_binding_commit_v2 ON public.guest_shop_orders;
CREATE CONSTRAINT TRIGGER tr_supplier_guest_binding_commit_v2 AFTER INSERT ON public.guest_shop_orders
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.shop_supplier_assert_native_binding_v2();

-- Checked source edits preserve every intervening wallet/lot, promo, TTL, buyer
-- credential, provider verification and inventory fix in the installed function.
CREATE OR REPLACE FUNCTION pg_temp.shop_supplier_replace_v2(
    p_source TEXT, p_old TEXT, p_new TEXT, p_label TEXT, p_expected INTEGER DEFAULT 1, p_ordinal INTEGER DEFAULT 1
) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_count INTEGER; v_offset INTEGER := 0; v_next INTEGER; v_i INTEGER;
BEGIN
    IF p_old IS NULL OR LENGTH(p_old) = 0 THEN RAISE EXCEPTION 'supplier_invalid_patch_anchor'; END IF;
    v_count := (LENGTH(p_source) - LENGTH(REPLACE(p_source, p_old, ''))) / LENGTH(p_old);
    IF v_count <> p_expected OR p_ordinal < 1 OR p_ordinal > v_count THEN
        RAISE EXCEPTION 'Supplier P2B patch anchor mismatch: % (expected %, found %)', p_label, p_expected, v_count;
    END IF;
    FOR v_i IN 1..p_ordinal LOOP
        v_next := strpos(substr(p_source, v_offset + 1), p_old);
        v_offset := v_offset + v_next;
        IF v_i < p_ordinal THEN v_offset := v_offset + LENGTH(p_old) - 1; END IF;
    END LOOP;
    RETURN substr(p_source, 1, v_offset - 1) || p_new || substr(p_source, v_offset + LENGTH(p_old));
END;
$$;

DO $patch$
DECLARE v_definition TEXT := pg_get_functiondef('public.fn_purchase_shop_item_core(uuid,uuid,character varying,integer,character varying,uuid,uuid)'::regprocedure);
BEGIN
    IF POSITION('supplier-native-core-v2' IN v_definition) = 0 THEN
        v_definition := pg_temp.shop_supplier_replace_v2(v_definition,
$old$    v_sku_is_default BOOLEAN := false;$old$,
$new$    v_sku_is_default BOOLEAN := false;
    -- supplier-native-core-v2
    v_supplier_quote public.shop_supplier_checkout_quotes%ROWTYPE;
    v_supplier_item_id UUID;$new$, 'points declarations', 1, 1);
        v_definition := pg_temp.shop_supplier_replace_v2(v_definition,
$old$    v_sku_is_default := COALESCE(v_sku.is_default, false);$old$,
$new$    v_sku_is_default := COALESCE(v_sku.is_default, false);
    v_supplier_quote := public.shop_supplier_checkout_context_v2(p_product_id, v_sku_id, 'points', v_effective_user_id);
    IF v_supplier_quote.id IS NOT NULL AND (v_site <> 'cn' OR p_quantity <> 1
        OR NULLIF(BTRIM(p_discount_code), '') IS NOT NULL OR p_agent_id IS NOT NULL) THEN
        RAISE EXCEPTION 'supplier_checkout_scope_unsupported';
    END IF;$new$, 'points trusted context', 1, 1);
        v_definition := pg_temp.shop_supplier_replace_v2(v_definition,
$old$    IF v_product.delivery_type = 'KEY' OR v_product.delivery_type IS NULL THEN$old$,
$new$    IF v_supplier_quote.id IS NOT NULL THEN
        IF v_total_price IS DISTINCT FROM v_supplier_quote.sale_amount THEN RAISE EXCEPTION 'supplier_quote_changed'; END IF;
        v_contents := ARRAY[]::TEXT[];
    ELSIF v_product.delivery_type = 'KEY' OR v_product.delivery_type IS NULL THEN$new$, 'points skip stock selection', 2, 1);
        v_definition := pg_temp.shop_supplier_replace_v2(v_definition,
$old$WHEN v_product.delivery_type = 'API' THEN 'pending'$old$,
$new$WHEN v_product.delivery_type = 'API' OR v_supplier_quote.id IS NOT NULL THEN 'pending'$new$, 'points pending order', 1, 1);
        v_definition := pg_temp.shop_supplier_replace_v2(v_definition,
$old$WHEN v_product.delivery_type = 'API' THEN NULL$old$,
$new$WHEN v_product.delivery_type = 'API' OR v_supplier_quote.id IS NOT NULL THEN NULL$new$, 'points completion unset', 1, 1);
        v_definition := pg_temp.shop_supplier_replace_v2(v_definition,
$old$    IF v_product.delivery_type = 'KEY' OR v_product.delivery_type IS NULL THEN$old$,
$new$    IF v_supplier_quote.id IS NOT NULL THEN
        INSERT INTO public.shop_order_items(order_id, inventory_id, sku_id, snapshot_product_name, price_paid)
        VALUES (v_order_id, NULL, v_sku_id, v_product.name, v_total_price) RETURNING id INTO v_supplier_item_id;
        PERFORM public.fn_bind_shop_supplier_funding_v2('points', v_order_id, v_supplier_item_id, v_effective_user_id,
            v_supplier_quote.mapping_id, v_supplier_quote.mapping_revision, v_supplier_quote.cost_ceiling_cny, v_supplier_quote.operation_id);
    ELSIF v_product.delivery_type = 'KEY' OR v_product.delivery_type IS NULL THEN$new$, 'points bind before original ledger', 1, 1);
        v_definition := pg_temp.shop_supplier_replace_v2(v_definition,
$old$    IF v_total_price > 0 THEN
        INSERT INTO public.shop_purchase_reward_jobs ($old$,
$new$    IF v_total_price > 0 AND v_supplier_quote.id IS NULL THEN
        INSERT INTO public.shop_purchase_reward_jobs ($new$, 'points defer supplier rewards until delivery', 1, 1);
        EXECUTE v_definition;
    END IF;
    IF POSITION($check$supplier-native-core-v2$check$ IN v_definition) = 0 THEN RAISE EXCEPTION 'Supplier P2B native patch incomplete'; END IF;
    IF POSITION($check$PERFORM public.fn_consume_wallet_point_lots_for_shop_order($check$ IN v_definition) = 0 THEN RAISE EXCEPTION 'Supplier P2B native patch incomplete'; END IF;
    IF POSITION($check$v_spent_paid_points$check$ IN v_definition) = 0 THEN RAISE EXCEPTION 'Supplier P2B native patch incomplete'; END IF;
    IF POSITION($check$points_balance$check$ IN v_definition) = 0 THEN RAISE EXCEPTION 'Supplier P2B native patch incomplete'; END IF;
    IF POSITION($check$IF v_total_price > 0 AND v_supplier_quote.id IS NULL THEN$check$ IN v_definition) = 0 THEN RAISE EXCEPTION 'Supplier P2B native patch incomplete'; END IF;
END;
$patch$;

DO $patch$
DECLARE v_definition TEXT := pg_get_functiondef('public.fn_guest_shop_create_order(text,uuid,uuid,text,text,text,text,text,text,uuid,text,text,integer,integer,text)'::regprocedure);
BEGIN
    IF POSITION('supplier-native-guest-v2' IN v_definition) = 0 THEN
        v_definition := pg_temp.shop_supplier_replace_v2(v_definition,
$old$    v_reservation_rows INTEGER := 0;$old$,
$new$    v_reservation_rows INTEGER := 0;
    -- supplier-native-guest-v2
    v_supplier_quote public.shop_supplier_checkout_quotes%ROWTYPE;$new$, 'guest declarations', 1, 1);
        v_definition := pg_temp.shop_supplier_replace_v2(v_definition,
$old$    v_delivery_type := UPPER(BTRIM(COALESCE(v_product.delivery_type, 'KEY')));$old$,
$new$    v_supplier_quote := public.shop_supplier_checkout_context_v2(p_product_id, p_sku_id, 'guest_cash', NULL);
    IF v_supplier_quote.id IS NOT NULL AND (v_site <> 'cn' OR v_quantity <> 1
        OR NULLIF(BTRIM(p_discount_code), '') IS NOT NULL) THEN RAISE EXCEPTION 'supplier_checkout_scope_unsupported'; END IF;
    v_delivery_type := UPPER(BTRIM(COALESCE(v_product.delivery_type, 'KEY')));$new$, 'guest trusted context', 1, 1);
        v_definition := pg_temp.shop_supplier_replace_v2(v_definition,
$old$    v_raw_source_ids := CASE$old$,
$new$    IF v_supplier_quote.id IS NULL THEN
    v_raw_source_ids := CASE$new$, 'guest local source start', 1, 1);
        v_definition := pg_temp.shop_supplier_replace_v2(v_definition,
$old$    v_guest_enabled := COALESCE(v_sku.allow_guest_purchase, v_product.allow_guest_purchase, false);$old$,
$new$    END IF; -- local inventory source validation only
    v_guest_enabled := COALESCE(v_sku.allow_guest_purchase, v_product.allow_guest_purchase, false);$new$, 'guest local source end', 1, 1);
        v_definition := pg_temp.shop_supplier_replace_v2(v_definition,
$old$    WITH source_rows AS MATERIALIZED ($old$,
$new$    IF v_supplier_quote.id IS NULL THEN
    WITH source_rows AS MATERIALIZED ($new$, 'guest stock selection start', 1, 1);
        v_definition := pg_temp.shop_supplier_replace_v2(v_definition,
$old$    v_order_no := 'GS'$old$,
$new$    END IF; -- local stock selection only
    v_order_no := 'GS'$new$, 'guest stock selection end', 1, 1);
        v_definition := pg_temp.shop_supplier_replace_v2(v_definition,
$old$v_quantity, v_net_unit_amount, v_net_amount, 'pending', 'held', 'pending', 'none',$old$,
$new$v_quantity, v_net_unit_amount, v_net_amount, 'pending',
        CASE WHEN v_supplier_quote.id IS NULL THEN 'held' ELSE 'none' END, 'pending', 'none',$new$, 'guest order no reservation', 1, 1);
        v_definition := pg_temp.shop_supplier_replace_v2(v_definition,
$old$    INSERT INTO public.guest_shop_inventory_reservations ($old$,
$new$    IF v_supplier_quote.id IS NULL THEN
    INSERT INTO public.guest_shop_inventory_reservations ($new$, 'guest reservation insert start', 1, 1);
        v_definition := pg_temp.shop_supplier_replace_v2(v_definition,
$old$    IF v_discount_code IS NOT NULL THEN
        SELECT r.reserved_code,$old$,
$new$    END IF; -- local reservation insert only
    IF v_discount_code IS NOT NULL THEN
        SELECT r.reserved_code,$new$, 'guest reservation insert end', 1, 1);
        v_definition := pg_temp.shop_supplier_replace_v2(v_definition,
$old$    RETURN QUERY SELECT
        v_order_id,$old$,
$new$    IF v_supplier_quote.id IS NOT NULL THEN
        IF v_net_amount IS DISTINCT FROM v_supplier_quote.sale_amount THEN RAISE EXCEPTION 'supplier_quote_changed'; END IF;
        PERFORM public.fn_bind_shop_supplier_funding_v2('guest_cash', v_order_id, NULL, NULL,
            v_supplier_quote.mapping_id, v_supplier_quote.mapping_revision, v_supplier_quote.cost_ceiling_cny, v_supplier_quote.operation_id);
    END IF;
    RETURN QUERY SELECT
        v_order_id,$new$, 'guest bind before provider request', 1, 1);
        v_definition := pg_temp.shop_supplier_replace_v2(v_definition,
$old$        'held'::TEXT,
        'pending'::TEXT,$old$,
$new$        CASE WHEN v_supplier_quote.id IS NULL THEN 'held' ELSE 'none' END::TEXT,
        'pending'::TEXT,$new$, 'guest no reservation response', 1, 1);
        EXECUTE v_definition;
    END IF;
    IF POSITION($check$supplier-native-guest-v2$check$ IN v_definition) = 0 THEN RAISE EXCEPTION 'Supplier P2B native patch incomplete'; END IF;
    IF POSITION($check$guest_shop_resolve_credit_unit_amount_with_start($check$ IN v_definition) = 0 THEN RAISE EXCEPTION 'Supplier P2B native patch incomplete'; END IF;
    IF POSITION($check$guest_quantity_not_allowed$check$ IN v_definition) = 0 THEN RAISE EXCEPTION 'Supplier P2B native patch incomplete'; END IF;
    IF POSITION($check$guest_payment_channel_unavailable$check$ IN v_definition) = 0 THEN RAISE EXCEPTION 'Supplier P2B native patch incomplete'; END IF;
END;
$patch$;

DO $patch$
DECLARE v_definition TEXT := pg_get_functiondef('public.fn_guest_shop_confirm_payment(uuid,uuid,text,text,text,text,numeric,text,text,boolean,boolean,boolean,boolean)'::regprocedure);
BEGIN
    IF POSITION('supplier-native-payment-v2' IN v_definition) = 0 THEN
        v_definition := pg_temp.shop_supplier_replace_v2(v_definition,
$old$    IF v_res_total = 0 THEN$old$,
$new$    -- supplier-native-payment-v2: provider/event/amount checks ABOVE remain authoritative.
    IF EXISTS (SELECT 1 FROM public.shop_supplier_fulfillment_units WHERE guest_order_id = v_order.id) THEN
        IF v_res_total <> 0 THEN RAISE EXCEPTION 'supplier_local_fulfillment_forbidden'; END IF;
        UPDATE public.guest_shop_orders
        SET payment_status = 'confirmed', paid_at = COALESCE(paid_at, v_now),
            fulfillment_status = CASE WHEN v_order.fulfillment_status <> 'pending' THEN v_order.fulfillment_status
                WHEN v_order.expires_at <= v_now THEN 'paid_unfulfillable' ELSE 'pending' END,
            refund_status = CASE WHEN v_order.refund_status <> 'none' THEN v_order.refund_status
                WHEN v_order.expires_at <= v_now THEN 'pending' ELSE 'none' END,
            last_error_code = CASE WHEN v_order.expires_at <= v_now THEN 'supplier_payment_after_expiry' ELSE last_error_code END,
            updated_at = v_now
        WHERE id = v_order.id;
    ELSIF v_res_total = 0 THEN$new$, 'supplier verified payment branch', 1, 1);
        EXECUTE v_definition;
    END IF;
    IF POSITION($check$supplier-native-payment-v2$check$ IN v_definition) = 0 THEN RAISE EXCEPTION 'Supplier P2B native patch incomplete'; END IF;
    IF POSITION($check$processing_status = 'processed'$check$ IN v_definition) = 0 THEN RAISE EXCEPTION 'Supplier P2B native patch incomplete'; END IF;
    IF POSITION($check$amount_verified = true$check$ IN v_definition) = 0 THEN RAISE EXCEPTION 'Supplier P2B native patch incomplete'; END IF;
END;
$patch$;

DO $patch$
DECLARE v_definition TEXT := pg_get_functiondef('public.shop_supplier_capture_funding_v2(uuid)'::regprocedure);
BEGIN
    IF POSITION('supplier-native-fee-v2' IN v_definition) = 0 THEN
        v_definition := pg_temp.shop_supplier_replace_v2(v_definition,
$old$OR v_guest.quantity <> 1 OR v_guest.total_amount IS DISTINCT FROM v_unit.sale_amount$old$,
$new$OR v_guest.quantity <> 1
            -- supplier-native-fee-v2
            OR v_guest.unit_amount IS DISTINCT FROM v_unit.sale_amount
            OR v_guest.total_amount - COALESCE(v_guest.payment_fee_amount, 0) IS DISTINCT FROM v_unit.sale_amount
            OR v_payment.expected_amount IS DISTINCT FROM v_guest.total_amount$new$, 'funding capture fee parity', 1, 1);
        EXECUTE v_definition;
    END IF;
    IF POSITION($check$supplier-native-fee-v2$check$ IN v_definition) = 0 THEN RAISE EXCEPTION 'Supplier P2B native patch incomplete'; END IF;
    IF POSITION($check$v_payment.sign_verified$check$ IN v_definition) = 0 THEN RAISE EXCEPTION 'Supplier P2B native patch incomplete'; END IF;
    IF POSITION($check$budget_version = budget_version + 1$check$ IN v_definition) = 0 THEN RAISE EXCEPTION 'Supplier P2B native patch incomplete'; END IF;
END;
$patch$;

DO $patch$
DECLARE v_definition TEXT := pg_get_functiondef('public.fn_guest_shop_claim_fulfillment(uuid,uuid)'::regprocedure);
BEGIN
    IF POSITION('supplier-native-local-worker-guard-v2' IN v_definition) = 0 THEN
        v_definition := pg_temp.shop_supplier_replace_v2(v_definition,
$old$    PERFORM public.guest_shop_require_service_role();$old$,
$new$    PERFORM public.guest_shop_require_service_role();
    -- supplier-native-local-worker-guard-v2
    IF EXISTS (SELECT 1 FROM public.guest_shop_orders WHERE id = p_order_id AND fulfillment_source = 'supplier_v2') THEN
        RAISE EXCEPTION 'supplier_local_fulfillment_forbidden';
    END IF;$new$, 'local stock worker isolation', 1, 1);
        EXECUTE v_definition;
    END IF;
    IF POSITION($check$supplier-native-local-worker-guard-v2$check$ IN v_definition) = 0 THEN RAISE EXCEPTION 'Supplier P2B native patch incomplete'; END IF;
END;
$patch$;

DO $patch$
DECLARE v_definition TEXT := pg_get_functiondef('public.fn_guest_shop_mark_fulfilled(uuid,uuid)'::regprocedure);
BEGIN
    IF POSITION('supplier-native-local-worker-guard-v2' IN v_definition) = 0 THEN
        v_definition := pg_temp.shop_supplier_replace_v2(v_definition,
$old$    PERFORM public.guest_shop_require_service_role();$old$,
$new$    PERFORM public.guest_shop_require_service_role();
    -- supplier-native-local-worker-guard-v2
    IF EXISTS (SELECT 1 FROM public.guest_shop_orders WHERE id = p_order_id AND fulfillment_source = 'supplier_v2') THEN
        RAISE EXCEPTION 'supplier_local_fulfillment_forbidden';
    END IF;$new$, 'local stock worker isolation', 1, 1);
        EXECUTE v_definition;
    END IF;
    IF POSITION($check$supplier-native-local-worker-guard-v2$check$ IN v_definition) = 0 THEN RAISE EXCEPTION 'Supplier P2B native patch incomplete'; END IF;
END;
$patch$;

DO $patch$
DECLARE v_definition TEXT := pg_get_functiondef('public.fn_guest_shop_list_delivered_content(uuid)'::regprocedure);
BEGIN
    IF POSITION('supplier-native-local-worker-guard-v2' IN v_definition) = 0 THEN
        v_definition := pg_temp.shop_supplier_replace_v2(v_definition,
$old$    PERFORM public.guest_shop_require_service_role();$old$,
$new$    PERFORM public.guest_shop_require_service_role();
    -- supplier-native-local-worker-guard-v2
    IF EXISTS (SELECT 1 FROM public.guest_shop_orders WHERE id = p_order_id AND fulfillment_source = 'supplier_v2') THEN
        RAISE EXCEPTION 'supplier_local_fulfillment_forbidden';
    END IF;$new$, 'local stock worker isolation', 1, 1);
        EXECUTE v_definition;
    END IF;
    IF POSITION($check$supplier-native-local-worker-guard-v2$check$ IN v_definition) = 0 THEN RAISE EXCEPTION 'Supplier P2B native patch incomplete'; END IF;
END;
$patch$;

DROP FUNCTION pg_temp.shop_supplier_replace_v2(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER);
REVOKE ALL ON FUNCTION public.fn_shop_supplier_source_v2(UUID, UUID, TEXT),
    public.fn_issue_shop_supplier_quote_v2(UUID, TEXT, UUID, TEXT, UUID, UUID, TEXT),
    public.fn_purchase_shop_supplier_points_v2(UUID, UUID),
    public.fn_create_shop_supplier_guest_order_v2(UUID, TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER, INTEGER, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_shop_supplier_source_v2(UUID, UUID, TEXT),
    public.fn_issue_shop_supplier_quote_v2(UUID, TEXT, UUID, TEXT, UUID, UUID, TEXT),
    public.fn_purchase_shop_supplier_points_v2(UUID, UUID),
    public.fn_create_shop_supplier_guest_order_v2(UUID, TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER, INTEGER, TEXT)
    TO service_role;
REVOKE ALL ON FUNCTION public.shop_supplier_has_source_v2(UUID, UUID),
    public.shop_supplier_checkout_context_v2(UUID, UUID, TEXT, UUID), public.shop_supplier_native_order_guard_v2(),
    public.shop_supplier_local_stock_guard_v2(), public.shop_supplier_assert_native_binding_v2()
    FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE public.shop_supplier_checkout_quotes IS
    'P2B trusted CN quantity-one native checkout. Private quotes, 120s issued TTL, consumed replay; no procurement executor. Policy and server switches remain OFF.';
NOTIFY pgrst, 'reload schema';
COMMIT;
