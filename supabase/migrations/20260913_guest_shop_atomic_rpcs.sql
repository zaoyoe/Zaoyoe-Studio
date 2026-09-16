-- Guest cash purchase atomic state machine.
--
-- This migration is intentionally separate from the foundation migration.  It
-- keeps all guest-order writes behind service-role functions and never grants
-- the anonymous or ordinary authenticated roles access to these functions.
-- The HTTP layer must still authenticate provider webhooks and rate-limit the
-- public claim endpoint before calling the service-role RPCs.

DO $$
BEGIN
    IF to_regclass('public.guest_shop_orders') IS NULL
       OR to_regclass('public.guest_shop_inventory_reservations') IS NULL
       OR to_regclass('public.guest_shop_payment_orders') IS NULL
       OR to_regclass('public.guest_shop_payment_events') IS NULL THEN
        RAISE EXCEPTION 'guest shop atomic RPC migration requires the foundation migration first';
    END IF;
    IF to_regprocedure('public.fn_resolve_shop_sku_inventory_sources(uuid,text)') IS NULL THEN
        RAISE EXCEPTION 'guest shop atomic RPC migration requires the site-scoped SKU source migration first';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'shop_products'
          AND column_name IN ('delivery_type', 'manual_delivery')
        GROUP BY table_schema, table_name
        HAVING COUNT(*) = 2
    ) THEN
        RAISE EXCEPTION 'guest shop atomic RPC migration requires shop_products delivery_type and manual_delivery columns';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'shop_product_skus'
          AND column_name = 'manual_delivery'
    ) THEN
        RAISE EXCEPTION 'guest shop atomic RPC migration requires shop_product_skus.manual_delivery';
    END IF;
END;
$$;

-- Webhook adapters pass normalized observations to the database. Keeping
-- these values as typed columns avoids trusting arbitrary JSON text for money,
-- currency, site, or payment purpose.
ALTER TABLE public.guest_shop_payment_events
    ADD COLUMN IF NOT EXISTS observed_site VARCHAR(10),
    ADD COLUMN IF NOT EXISTS observed_currency VARCHAR(3),
    ADD COLUMN IF NOT EXISTS observed_amount NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS observed_purpose TEXT;

ALTER TABLE public.guest_shop_payment_orders
    ADD COLUMN IF NOT EXISTS refund_provider_ref TEXT;

ALTER TABLE public.guest_shop_orders
    ADD COLUMN IF NOT EXISTS snapshot_delivery_type TEXT,
    ADD COLUMN IF NOT EXISTS snapshot_manual_delivery BOOLEAN,
    ADD COLUMN IF NOT EXISTS snapshot_sku_manual_delivery BOOLEAN;

ALTER TABLE public.guest_shop_inventory_reservations
    ADD COLUMN IF NOT EXISTS inventory_source_sku_id UUID;

-- The source snapshot is an audit and integrity boundary, not a free-form
-- label.  Do not turn this on over old rows whose source cannot be proven:
-- operators must backfill/reconcile those rows before enabling guest sales.
-- The two FKs make both source existence and product ownership immutable.
DO $$
DECLARE
    -- pg_constraint lives in pg_catalog; qualifying it through public would
    -- fail while the migration is parsed on a normal PostgreSQL/Supabase
    -- instance.  RECORD keeps this block compatible with managed versions
    -- that expose additional catalog columns.
    v_source_fk RECORD;
    v_source_product_fk RECORD;
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.guest_shop_inventory_reservations
        WHERE inventory_source_sku_id IS NULL
    ) THEN
        RAISE EXCEPTION 'guest reservation source snapshots must be backfilled before atomic RPC migration';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM public.guest_shop_inventory_reservations r
        LEFT JOIN public.shop_product_skus s ON s.id = r.inventory_source_sku_id
        WHERE r.inventory_source_sku_id IS NOT NULL
          AND (s.id IS NULL OR s.product_id IS DISTINCT FROM r.product_id)
    ) THEN
        RAISE EXCEPTION 'guest reservation source snapshot is missing or belongs to another product';
    END IF;

    SELECT * INTO v_source_fk
    FROM pg_constraint
    WHERE conrelid = 'public.guest_shop_inventory_reservations'::regclass
      AND conname = 'guest_shop_inventory_reservations_source_sku_fk';
    IF FOUND AND (
        v_source_fk.contype <> 'f'
        OR v_source_fk.confrelid <> 'public.shop_product_skus'::regclass
        OR v_source_fk.confdeltype <> 'r'
        OR pg_get_constraintdef(v_source_fk.oid) !~ 'FOREIGN KEY \(inventory_source_sku_id\)'
    ) THEN
        RAISE EXCEPTION 'guest reservation source SKU FK has an unexpected definition';
    ELSIF NOT FOUND THEN
        ALTER TABLE public.guest_shop_inventory_reservations
            ADD CONSTRAINT guest_shop_inventory_reservations_source_sku_fk
            FOREIGN KEY (inventory_source_sku_id)
            REFERENCES public.shop_product_skus(id)
            ON DELETE RESTRICT;
    END IF;

    SELECT * INTO v_source_product_fk
    FROM pg_constraint
    WHERE conrelid = 'public.guest_shop_inventory_reservations'::regclass
      AND conname = 'guest_shop_inventory_reservations_source_sku_product_fk';
    IF FOUND AND (
        v_source_product_fk.contype <> 'f'
        OR v_source_product_fk.confrelid <> 'public.shop_product_skus'::regclass
        OR v_source_product_fk.confdeltype <> 'r'
        OR pg_get_constraintdef(v_source_product_fk.oid) !~ 'FOREIGN KEY \(product_id, inventory_source_sku_id\)'
    ) THEN
        RAISE EXCEPTION 'guest reservation source SKU product FK has an unexpected definition';
    ELSIF NOT FOUND THEN
        ALTER TABLE public.guest_shop_inventory_reservations
            ADD CONSTRAINT guest_shop_inventory_reservations_source_sku_product_fk
            FOREIGN KEY (product_id, inventory_source_sku_id)
            REFERENCES public.shop_product_skus(product_id, id)
            ON DELETE RESTRICT;
    END IF;
END;
$$;

ALTER TABLE public.guest_shop_inventory_reservations
    ALTER COLUMN inventory_source_sku_id SET NOT NULL;

ALTER TABLE public.guest_shop_payment_events
    DROP CONSTRAINT IF EXISTS guest_shop_payment_events_observed_site_check,
    DROP CONSTRAINT IF EXISTS guest_shop_payment_events_observed_currency_check,
    DROP CONSTRAINT IF EXISTS guest_shop_payment_events_observed_amount_check,
    DROP CONSTRAINT IF EXISTS guest_shop_payment_events_observed_purpose_check;

ALTER TABLE public.guest_shop_payment_events
    ADD CONSTRAINT guest_shop_payment_events_observed_site_check
        CHECK (observed_site IS NULL OR observed_site IN ('cn', 'intl')),
    ADD CONSTRAINT guest_shop_payment_events_observed_currency_check
        CHECK (observed_currency IS NULL OR observed_currency IN ('CNY', 'USD')),
    ADD CONSTRAINT guest_shop_payment_events_observed_amount_check
        CHECK (
            observed_amount IS NULL
            OR (
                LOWER(observed_amount::TEXT) NOT IN ('nan', 'infinity', '-infinity')
                AND observed_amount >= 0
                AND observed_amount <= 999999999999.99
                AND observed_amount = ROUND(observed_amount, 2)
            )
        ),
    ADD CONSTRAINT guest_shop_payment_events_observed_purpose_check
        CHECK (observed_purpose IS NULL OR observed_purpose = 'shop_direct');

-- PostgreSQL NUMERIC permits NaN (and newer versions also support infinities).
-- Ordered comparisons alone do not reject every non-finite value, so harden
-- every guest-cash money boundary before the channel can be enabled.
ALTER TABLE public.shop_products
    DROP CONSTRAINT IF EXISTS shop_products_guest_cash_price_cny_check,
    DROP CONSTRAINT IF EXISTS shop_products_guest_cash_price_intl_check,
    ADD CONSTRAINT shop_products_guest_cash_price_cny_check
        CHECK (
            guest_cash_price_cny IS NULL
            OR (
                LOWER(guest_cash_price_cny::TEXT) NOT IN ('nan', 'infinity', '-infinity')
                AND guest_cash_price_cny > 0
                AND guest_cash_price_cny <= 999999999999.99
                AND guest_cash_price_cny = ROUND(guest_cash_price_cny, 2)
            )
        ),
    ADD CONSTRAINT shop_products_guest_cash_price_intl_check
        CHECK (
            guest_cash_price_intl IS NULL
            OR (
                LOWER(guest_cash_price_intl::TEXT) NOT IN ('nan', 'infinity', '-infinity')
                AND guest_cash_price_intl > 0
                AND guest_cash_price_intl <= 999999999999.99
                AND guest_cash_price_intl = ROUND(guest_cash_price_intl, 2)
            )
        );

ALTER TABLE public.shop_product_skus
    DROP CONSTRAINT IF EXISTS shop_product_skus_guest_cash_price_cny_check,
    DROP CONSTRAINT IF EXISTS shop_product_skus_guest_cash_price_intl_check,
    ADD CONSTRAINT shop_product_skus_guest_cash_price_cny_check
        CHECK (
            guest_cash_price_cny IS NULL
            OR (
                LOWER(guest_cash_price_cny::TEXT) NOT IN ('nan', 'infinity', '-infinity')
                AND guest_cash_price_cny > 0
                AND guest_cash_price_cny <= 999999999999.99
                AND guest_cash_price_cny = ROUND(guest_cash_price_cny, 2)
            )
        ),
    ADD CONSTRAINT shop_product_skus_guest_cash_price_intl_check
        CHECK (
            guest_cash_price_intl IS NULL
            OR (
                LOWER(guest_cash_price_intl::TEXT) NOT IN ('nan', 'infinity', '-infinity')
                AND guest_cash_price_intl > 0
                AND guest_cash_price_intl <= 999999999999.99
                AND guest_cash_price_intl = ROUND(guest_cash_price_intl, 2)
            )
        );

ALTER TABLE public.guest_shop_orders
    DROP CONSTRAINT IF EXISTS guest_shop_orders_amount_check,
    ADD CONSTRAINT guest_shop_orders_amount_check
        CHECK (
            LOWER(unit_amount::TEXT) NOT IN ('nan', 'infinity', '-infinity')
            AND LOWER(total_amount::TEXT) NOT IN ('nan', 'infinity', '-infinity')
            AND unit_amount > 0
            AND total_amount > 0
            AND unit_amount <= 999999999999.99
            AND total_amount <= 999999999999.99
            AND unit_amount = ROUND(unit_amount, 2)
            AND total_amount = ROUND(total_amount, 2)
            AND total_amount = unit_amount * quantity
        );

ALTER TABLE public.guest_shop_payment_orders
    DROP CONSTRAINT IF EXISTS guest_shop_payment_orders_expected_amount_check,
    DROP CONSTRAINT IF EXISTS guest_shop_payment_orders_paid_amount_check,
    DROP CONSTRAINT IF EXISTS guest_shop_payment_orders_fee_check,
    ADD CONSTRAINT guest_shop_payment_orders_expected_amount_check
        CHECK (
            LOWER(expected_amount::TEXT) NOT IN ('nan', 'infinity', '-infinity')
            AND expected_amount > 0
            AND expected_amount <= 999999999999.99
            AND expected_amount = ROUND(expected_amount, 2)
        ),
    ADD CONSTRAINT guest_shop_payment_orders_paid_amount_check
        CHECK (
            paid_amount IS NULL
            OR (
                LOWER(paid_amount::TEXT) NOT IN ('nan', 'infinity', '-infinity')
                AND paid_amount >= 0
                AND paid_amount <= 999999999999.99
                AND paid_amount = ROUND(paid_amount, 2)
            )
        ),
    ADD CONSTRAINT guest_shop_payment_orders_fee_check
        CHECK (
            payment_fee IS NULL
            OR (
                LOWER(payment_fee::TEXT) NOT IN ('nan', 'infinity', '-infinity')
                AND payment_fee >= 0
                AND payment_fee <= 999999999999.99
                AND payment_fee = ROUND(payment_fee, 2)
            )
        );

-- Keep direct service-role writes inside the same identifier envelope as the
-- RPCs.  Provider names and channels are lowercase ASCII tokens; provider
-- order numbers are opaque but may never contain whitespace/control bytes.
ALTER TABLE public.guest_shop_orders
    DROP CONSTRAINT IF EXISTS guest_shop_orders_idempotency_key_format_check,
    DROP CONSTRAINT IF EXISTS guest_shop_orders_request_fingerprint_check,
    DROP CONSTRAINT IF EXISTS guest_shop_orders_claim_secret_hash_format_check,
    ADD CONSTRAINT guest_shop_orders_idempotency_key_format_check
        CHECK (idempotency_key !~ '[[:cntrl:][:space:]]'),
    ADD CONSTRAINT guest_shop_orders_request_fingerprint_check
        CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT guest_shop_orders_claim_secret_hash_format_check
        CHECK (claim_secret_hash ~ '^hmac-sha256:v1:[0-9a-f]{64}$');

ALTER TABLE public.guest_shop_payment_orders
    DROP CONSTRAINT IF EXISTS guest_shop_payment_orders_merchant_order_no_check,
    DROP CONSTRAINT IF EXISTS guest_shop_payment_orders_provider_check,
    DROP CONSTRAINT IF EXISTS guest_shop_payment_orders_channel_check,
    DROP CONSTRAINT IF EXISTS guest_shop_payment_orders_provider_order_no_check,
    ADD CONSTRAINT guest_shop_payment_orders_merchant_order_no_check
        CHECK (
            char_length(btrim(merchant_order_no)) BETWEEN 1 AND 200
            AND merchant_order_no !~ '[[:cntrl:][:space:]]'
        ),
    ADD CONSTRAINT guest_shop_payment_orders_provider_check
        CHECK (
            char_length(provider) BETWEEN 1 AND 80
            AND provider = LOWER(BTRIM(provider))
            AND provider ~ '^[a-z0-9][a-z0-9._:-]{0,79}$'
            AND provider NOT IN ('mock', 'test', 'fake')
        ),
    ADD CONSTRAINT guest_shop_payment_orders_channel_check
        CHECK (
            char_length(channel) BETWEEN 1 AND 80
            AND channel = LOWER(BTRIM(channel))
            AND channel ~ '^[a-z0-9][a-z0-9._:-]{0,79}$'
            AND channel NOT IN ('mock', 'test', 'fake')
        ),
    ADD CONSTRAINT guest_shop_payment_orders_provider_order_no_check
        CHECK (
            provider_order_no IS NULL
            OR (
                char_length(btrim(provider_order_no)) BETWEEN 1 AND 300
                AND provider_order_no = btrim(provider_order_no)
                AND provider_order_no !~ '[[:cntrl:][:space:]]'
            )
        );

ALTER TABLE public.guest_shop_payment_events
    DROP CONSTRAINT IF EXISTS guest_shop_payment_events_provider_check,
    DROP CONSTRAINT IF EXISTS guest_shop_payment_events_event_key_format_check,
    DROP CONSTRAINT IF EXISTS guest_shop_payment_events_provider_order_no_check,
    DROP CONSTRAINT IF EXISTS guest_shop_payment_events_provider_event_id_check,
    ADD CONSTRAINT guest_shop_payment_events_provider_check
        CHECK (
            char_length(provider) BETWEEN 1 AND 80
            AND provider = LOWER(BTRIM(provider))
            AND provider ~ '^[a-z0-9][a-z0-9._:-]{0,79}$'
            AND provider NOT IN ('mock', 'test', 'fake')
        ),
    ADD CONSTRAINT guest_shop_payment_events_event_key_format_check
        CHECK (
            char_length(btrim(event_key)) BETWEEN 1 AND 300
            AND event_key = btrim(event_key)
            AND event_key !~ '[[:cntrl:][:space:]]'
        ),
    ADD CONSTRAINT guest_shop_payment_events_provider_order_no_check
        CHECK (
            provider_order_no IS NULL
            OR (
                char_length(btrim(provider_order_no)) BETWEEN 1 AND 300
                AND provider_order_no = btrim(provider_order_no)
                AND provider_order_no !~ '[[:cntrl:][:space:]]'
            )
        ),
    ADD CONSTRAINT guest_shop_payment_events_provider_event_id_check
        CHECK (
            provider_event_id IS NULL
            OR (
                char_length(btrim(provider_event_id)) BETWEEN 1 AND 300
                AND provider_event_id = btrim(provider_event_id)
                AND provider_event_id !~ '[[:cntrl:][:space:]]'
            )
        );

COMMENT ON COLUMN public.guest_shop_payment_events.observed_amount IS
    'Normalized provider amount from the verified webhook; never parsed from payload_redacted.';
COMMENT ON COLUMN public.guest_shop_payment_events.observed_purpose IS
    'Normalized immutable payment purpose. Guest cash events must be shop_direct.';

-- Replace the foundation reservation trigger with a site-aware source-chain
-- check.  A storefront SKU may legitimately consume stock rows attached to a
-- source/alias SKU (including the default SKU's NULL sku_id rows), but a
-- shared/reusable row can never be reserved for a guest order.
CREATE OR REPLACE FUNCTION public.guest_shop_validate_inventory_reservation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.guest_shop_orders%ROWTYPE;
    v_inventory RECORD;
    v_source RECORD;
    v_source_match BOOLEAN := false;
    v_identity_changed BOOLEAN := false;
BEGIN
    -- The source chain is a creation-time decision.  Re-running the current
    -- resolver while an order moves held -> consumed/released would make an
    -- otherwise valid old order depend on an administrator's later alias
    -- edits.  Only INSERTs and identity changes validate the live chain;
    -- status-only transitions validate the persisted snapshot and ownership.
    IF TG_OP = 'INSERT' THEN
        v_identity_changed := true;
    ELSE
        v_identity_changed := NEW.order_id IS DISTINCT FROM OLD.order_id
            OR NEW.inventory_id IS DISTINCT FROM OLD.inventory_id
            OR NEW.inventory_source_sku_id IS DISTINCT FROM OLD.inventory_source_sku_id
            OR NEW.product_id IS DISTINCT FROM OLD.product_id
            OR NEW.sku_id IS DISTINCT FROM OLD.sku_id
            OR NEW.site IS DISTINCT FROM OLD.site;
    END IF;

    SELECT * INTO v_order
    FROM public.guest_shop_orders
    WHERE id = NEW.order_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest reservation references missing order';
    END IF;
    IF NEW.product_id IS DISTINCT FROM v_order.product_id
       OR NEW.sku_id IS DISTINCT FROM v_order.sku_id
       OR NEW.site <> v_order.site THEN
        RAISE EXCEPTION 'guest reservation does not match order snapshot';
    END IF;

    SELECT i.product_id,
           i.sku_id,
           i.status,
           COALESCE(i.is_shared, false) AS is_shared
    INTO v_inventory
    FROM public.shop_inventory i
    WHERE i.id = NEW.inventory_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest reservation references missing inventory';
    END IF;
    IF v_inventory.product_id IS DISTINCT FROM v_order.product_id
       OR v_inventory.is_shared THEN
        RAISE EXCEPTION 'guest reservation inventory does not match a non-shared order product';
    END IF;

    IF NEW.inventory_source_sku_id IS NULL THEN
        RAISE EXCEPTION 'guest reservation source SKU snapshot is required';
    END IF;

    -- The FK enforces existence and product ownership.  Repeat the ownership
    -- lookup here so this trigger remains fail-closed on installations where
    -- the migration is applied while constraints are being validated.
    SELECT s.product_id,
           COALESCE(s.is_active, false) AS is_active,
           COALESCE(s.manual_delivery, false) AS manual_delivery
    INTO v_source
    FROM public.shop_product_skus s
    WHERE s.id = NEW.inventory_source_sku_id
    FOR SHARE;
    IF NOT FOUND
       OR v_source.product_id IS DISTINCT FROM v_order.product_id THEN
        RAISE EXCEPTION 'guest reservation source SKU does not belong to order product';
    END IF;

    IF v_identity_changed THEN
        -- Resolve against the site configuration only when the snapshot is
        -- first selected (or explicitly replaced).  A default inventory row
        -- has NULL sku_id, so its logical source must be a resolver row marked
        -- source_is_default; a SKU-bound row must match its concrete source.
        SELECT EXISTS (
            SELECT 1
            FROM public.fn_resolve_shop_sku_inventory_sources(v_order.sku_id, v_order.site) src
            WHERE src.source_sku_id = NEW.inventory_source_sku_id
              AND (
                  (v_inventory.sku_id IS NOT NULL
                   AND v_inventory.sku_id = src.source_sku_id)
                  OR (v_inventory.sku_id IS NULL AND src.source_is_default)
              )
        )
        INTO v_source_match;

        IF NOT v_source_match THEN
            RAISE EXCEPTION 'guest reservation inventory does not match the site SKU source chain';
        END IF;
        IF v_source.is_active IS NOT TRUE OR v_source.manual_delivery THEN
            RAISE EXCEPTION 'guest reservation source SKU is not eligible for automatic delivery';
        END IF;
    ELSE
        -- Do not consult the live source resolver on a status-only update.
        -- For a concrete SKU-bound inventory row we can still prove that the
        -- row has not been rebound to a different source; NULL/default rows
        -- rely on the immutable source id plus the FK/product check above.
        IF v_inventory.sku_id IS NOT NULL
           AND v_inventory.sku_id IS DISTINCT FROM NEW.inventory_source_sku_id THEN
            RAISE EXCEPTION 'guest reservation inventory source binding changed';
        END IF;
    END IF;

    IF NEW.status = 'held' AND v_inventory.status NOT IN ('available', 'reserve') THEN
        RAISE EXCEPTION 'guest reservation inventory is not reservable';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guest_shop_validate_inventory_reservation
    ON public.guest_shop_inventory_reservations;
CREATE TRIGGER trg_guest_shop_validate_inventory_reservation
    BEFORE INSERT OR UPDATE OF order_id, inventory_id, inventory_source_sku_id,
        product_id, sku_id, site, status
    ON public.guest_shop_inventory_reservations
    FOR EACH ROW
    EXECUTE FUNCTION public.guest_shop_validate_inventory_reservation();

CREATE OR REPLACE FUNCTION public.guest_shop_require_service_role()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'guest shop RPC requires service_role';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.guest_shop_normalize_site(p_site TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT LOWER(BTRIM(COALESCE(p_site, '')));
$$;

CREATE OR REPLACE FUNCTION public.guest_shop_payment_is_final_success(p_status TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT LOWER(BTRIM(COALESCE(p_status, ''))) IN
        ('paid', 'success', 'succeeded', 'completed', 'captured', 'confirmed', 'finished');
$$;

-- Confirm a provider payment after the webhook adapter has verified the raw
-- signature and normalized all typed observations.  This function does not
-- call a provider and never returns inventory content.  A late success after
-- the reservation was released is recorded as paid_unfulfillable and must be
-- handled by the refund worker; it is never allowed to re-reserve stock.
CREATE OR REPLACE FUNCTION public.fn_guest_shop_confirm_payment(
    p_payment_order_id UUID,
    p_event_id UUID DEFAULT NULL,
    p_provider TEXT DEFAULT NULL,
    p_provider_order_no TEXT DEFAULT NULL,
    p_observed_site TEXT DEFAULT NULL,
    p_observed_currency TEXT DEFAULT NULL,
    p_observed_amount NUMERIC DEFAULT NULL,
    p_observed_purpose TEXT DEFAULT NULL,
    p_observed_status TEXT DEFAULT NULL,
    p_signature_verified BOOLEAN DEFAULT false,
    p_amount_verified BOOLEAN DEFAULT false,
    p_currency_verified BOOLEAN DEFAULT false,
    p_final_status_verified BOOLEAN DEFAULT false
)
RETURNS TABLE (
    confirmed BOOLEAN,
    order_id UUID,
    payment_order_id UUID,
    payment_status TEXT,
    fulfillment_status TEXT,
    reservation_status TEXT,
    refund_status TEXT,
    event_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order_id UUID;
    v_order public.guest_shop_orders%ROWTYPE;
    v_payment public.guest_shop_payment_orders%ROWTYPE;
    v_event public.guest_shop_payment_events%ROWTYPE;
    v_reservation public.guest_shop_inventory_reservations%ROWTYPE;
    v_inventory_status TEXT;
    v_inventory_shared BOOLEAN;
    v_provider TEXT := LOWER(BTRIM(COALESCE(p_provider, '')));
    v_provider_order_no TEXT := BTRIM(COALESCE(p_provider_order_no, ''));
    v_site TEXT := public.guest_shop_normalize_site(p_observed_site);
    v_currency TEXT := UPPER(BTRIM(COALESCE(p_observed_currency, '')));
    v_purpose TEXT := LOWER(BTRIM(COALESCE(p_observed_purpose, '')));
    v_status TEXT := LOWER(BTRIM(COALESCE(p_observed_status, '')));
    v_now TIMESTAMPTZ := clock_timestamp();
    v_event_status TEXT := 'processed';
    v_confirmed BOOLEAN := true;
    v_late_success BOOLEAN := false;
BEGIN
    PERFORM public.guest_shop_require_service_role();
    IF p_payment_order_id IS NULL THEN
        RAISE EXCEPTION 'guest_payment_order_required';
    END IF;
    IF p_event_id IS NULL THEN
        RAISE EXCEPTION 'guest_payment_event_required';
    END IF;
    IF v_provider = '' OR char_length(v_provider) > 80
       OR v_provider !~ '^[a-z0-9][a-z0-9._:-]{0,79}$'
       OR v_provider IN ('mock', 'test', 'fake') THEN
        RAISE EXCEPTION 'guest_invalid_payment_provider';
    END IF;
    IF v_provider_order_no = '' OR char_length(v_provider_order_no) > 300
       OR v_provider_order_no ~ '[[:cntrl:][:space:]]' THEN
        RAISE EXCEPTION 'guest_invalid_provider_order_no';
    END IF;
    IF v_site NOT IN ('cn', 'intl') THEN
        RAISE EXCEPTION 'guest_invalid_site';
    END IF;
    IF v_currency NOT IN ('CNY', 'USD') THEN
        RAISE EXCEPTION 'guest_invalid_currency';
    END IF;
    IF v_purpose <> 'shop_direct' THEN
        RAISE EXCEPTION 'guest_invalid_payment_purpose';
    END IF;
    IF p_observed_amount IS NULL
       OR LOWER(p_observed_amount::TEXT) IN ('nan', 'infinity', '-infinity')
       OR p_observed_amount < 0
       OR p_observed_amount > 999999999999.99
       OR p_observed_amount <> ROUND(p_observed_amount, 2) THEN
        RAISE EXCEPTION 'guest_invalid_payment_amount';
    END IF;
    IF p_signature_verified IS NOT TRUE
       OR p_amount_verified IS NOT TRUE
       OR p_currency_verified IS NOT TRUE
       OR p_final_status_verified IS NOT TRUE
       OR NOT public.guest_shop_payment_is_final_success(v_status) THEN
        RAISE EXCEPTION 'guest_payment_verification_required';
    END IF;

    -- Resolve the order before taking the payment lock.  All guest state
    -- transitions use order -> payment -> reservation -> inventory ordering.
    SELECT p.guest_order_id
    INTO v_order_id
    FROM public.guest_shop_payment_orders p
    WHERE p.id = p_payment_order_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_payment_order_not_found';
    END IF;

    SELECT * INTO v_order
    FROM public.guest_shop_orders o
    WHERE o.id = v_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_order_not_found';
    END IF;

    SELECT * INTO v_payment
    FROM public.guest_shop_payment_orders p
    WHERE p.id = p_payment_order_id
    FOR UPDATE;
    IF NOT FOUND OR v_payment.guest_order_id <> v_order.id THEN
        RAISE EXCEPTION 'guest_payment_order_mismatch';
    END IF;

    IF v_payment.provider <> v_provider
       OR v_payment.merchant_order_no <> v_order.order_no
       OR v_payment.purpose <> v_purpose
       OR v_payment.site <> v_site
       OR v_payment.currency <> v_currency
       OR v_payment.expected_amount <> p_observed_amount THEN
        RAISE EXCEPTION 'guest_payment_binding_mismatch';
    END IF;
    IF v_payment.provider_order_no IS NOT NULL
       AND v_payment.provider_order_no <> v_provider_order_no THEN
        RAISE EXCEPTION 'guest_provider_order_conflict';
    END IF;

    IF p_event_id IS NOT NULL THEN
        SELECT * INTO v_event
        FROM public.guest_shop_payment_events e
        WHERE e.id = p_event_id
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'guest_payment_event_not_found';
        END IF;
        IF v_event.payment_order_id IS DISTINCT FROM p_payment_order_id
           OR LOWER(BTRIM(v_event.provider)) <> v_provider
           OR v_event.provider_order_no IS DISTINCT FROM v_provider_order_no
           OR v_event.merchant_order_no IS DISTINCT FROM v_payment.merchant_order_no
           OR v_event.observed_site IS DISTINCT FROM v_site
           OR v_event.observed_currency IS DISTINCT FROM v_currency
           OR v_event.observed_amount IS DISTINCT FROM p_observed_amount
           OR v_event.observed_purpose IS DISTINCT FROM v_purpose
           OR LOWER(BTRIM(COALESCE(v_event.observed_status, ''))) <> v_status
           OR v_event.signature_verified IS NOT TRUE
           OR v_event.amount_verified IS NOT TRUE
           OR v_event.currency_verified IS NOT TRUE
           OR v_event.final_status_verified IS NOT TRUE THEN
            RAISE EXCEPTION 'guest_payment_event_binding_mismatch';
        END IF;

        -- A provider retry for the same event is a no-op.  The event is
        -- already bound to this payment and the state below is authoritative.
        IF v_event.processing_status IN ('processed', 'duplicate') THEN
            v_event_status := v_event.processing_status;
            RETURN QUERY
            SELECT
                v_payment.status = 'confirmed',
                v_order.id,
                v_payment.id,
                v_payment.status,
                v_order.fulfillment_status,
                v_order.reservation_status,
                v_order.refund_status,
                v_event_status;
            RETURN;
        END IF;
        IF v_event.processing_status IN ('rejected', 'dead_letter') THEN
            RAISE EXCEPTION 'guest_payment_event_not_processable';
        END IF;
        IF v_event.processing_status <> 'verified' THEN
            RAISE EXCEPTION 'guest_payment_event_not_verified';
        END IF;
    END IF;

    -- A refund/chargeback is terminal for fulfillment.  Mark the event as a
    -- duplicate rather than reviving a paid order or consuming stock again.
    IF v_payment.status IN ('refunded', 'chargeback')
       OR v_order.payment_status IN ('refunded', 'chargeback') THEN
        v_confirmed := false;
        v_event_status := 'duplicate';
        IF p_event_id IS NOT NULL THEN
            UPDATE public.guest_shop_payment_events
            SET processing_status = 'duplicate',
                processed_at = COALESCE(processed_at, v_now),
                updated_at = v_now
            WHERE id = p_event_id;
        END IF;
        RETURN QUERY
        SELECT v_confirmed, v_order.id, v_payment.id, v_payment.status,
               v_order.fulfillment_status, v_order.reservation_status,
               v_order.refund_status, v_event_status;
        RETURN;
    END IF;

    -- Bind the provider order number before setting confirmed.  The partial
    -- unique index on (provider, provider_order_no) rejects cross-order reuse.
    UPDATE public.guest_shop_payment_orders
    SET provider_order_no = v_provider_order_no,
        paid_amount = p_observed_amount,
        sign_verified = true,
        amount_verified = true,
        currency_verified = true,
        final_status_verified = true,
        status = 'confirmed',
        paid_at = COALESCE(paid_at, v_now),
        verified_at = COALESCE(verified_at, v_now),
        last_event_at = v_now,
        last_error_code = NULL,
        last_error_message = NULL,
        updated_at = v_now
    WHERE id = v_payment.id;

    SELECT * INTO v_reservation
    FROM public.guest_shop_inventory_reservations r
    WHERE r.order_id = v_order.id
    FOR UPDATE;
    v_late_success := NOT FOUND;

    -- Consumed is a terminal stock transition.  A retry that arrives after
    -- the order TTL must remain successful/idempotent and must never downgrade
    -- an already delivered order to paid_unfulfillable.
    IF NOT v_late_success AND v_reservation.status = 'consumed' THEN
        UPDATE public.guest_shop_orders
        SET payment_status = 'confirmed',
            paid_at = COALESCE(paid_at, v_now),
            reservation_status = 'consumed',
            updated_at = v_now
        WHERE id = v_order.id;
    ELSE
        IF NOT v_late_success
           AND (v_reservation.status = 'released' OR v_order.expires_at <= v_now) THEN
            v_late_success := true;
            IF v_reservation.status = 'held' THEN
                SELECT i.status, COALESCE(i.is_shared, false)
                INTO v_inventory_status, v_inventory_shared
                FROM public.shop_inventory i
                WHERE i.id = v_reservation.inventory_id
                FOR UPDATE;
                IF FOUND AND v_inventory_status = 'reserve' AND NOT v_inventory_shared THEN
                    UPDATE public.shop_inventory
                    SET status = 'available'
                    WHERE id = v_reservation.inventory_id
                      AND status = 'reserve'
                      AND COALESCE(is_shared, false) = false;
                END IF;
                UPDATE public.guest_shop_inventory_reservations
                SET status = 'released',
                    released_at = COALESCE(released_at, v_now),
                    release_reason = 'payment_confirmed_after_expiry',
                    updated_at = v_now
                WHERE id = v_reservation.id
                  AND status = 'held';
            END IF;
        ELSIF NOT v_late_success AND v_reservation.status = 'held' THEN
            SELECT i.status, COALESCE(i.is_shared, false)
            INTO v_inventory_status, v_inventory_shared
            FROM public.shop_inventory i
            WHERE i.id = v_reservation.inventory_id
            FOR UPDATE;
            IF NOT FOUND OR v_inventory_status <> 'reserve' OR v_inventory_shared THEN
                v_late_success := true;
                UPDATE public.guest_shop_inventory_reservations
                SET status = 'released',
                    released_at = COALESCE(released_at, v_now),
                    release_reason = 'payment_confirmed_inventory_not_reservable',
                    updated_at = v_now
                WHERE id = v_reservation.id
                  AND status = 'held';
            END IF;
        END IF;

        IF v_late_success THEN
            UPDATE public.guest_shop_orders
            SET payment_status = 'confirmed',
                paid_at = COALESCE(paid_at, v_now),
                reservation_status = CASE
                    WHEN v_reservation.id IS NULL THEN 'none'
                    ELSE 'released'
                END,
                fulfillment_status = CASE
                    WHEN v_order.fulfillment_status IN ('delivered', 'refunded') THEN v_order.fulfillment_status
                    ELSE 'paid_unfulfillable'
                END,
                refund_status = CASE
                    WHEN v_order.refund_status = 'succeeded' THEN v_order.refund_status
                    ELSE 'pending'
                END,
                last_error_code = CASE
                    WHEN v_order.fulfillment_status IN ('delivered', 'refunded') THEN last_error_code
                    ELSE 'paid_inventory_not_reservable'
                END,
                last_error_message = CASE
                    WHEN v_order.fulfillment_status IN ('delivered', 'refunded') THEN last_error_message
                    ELSE 'payment confirmed after reservation expiry or inventory loss'
                END,
                updated_at = v_now
            WHERE id = v_order.id;
        ELSE
            UPDATE public.guest_shop_orders
            SET payment_status = 'confirmed',
                paid_at = COALESCE(paid_at, v_now),
                updated_at = v_now
            WHERE id = v_order.id;
        END IF;
    END IF;

    IF p_event_id IS NOT NULL THEN
        UPDATE public.guest_shop_payment_events
        SET processing_status = 'processed',
            processed_at = COALESCE(processed_at, v_now),
            updated_at = v_now
        WHERE id = p_event_id;
    END IF;

    RETURN QUERY
    SELECT v_confirmed, o.id, p.id, p.status, o.fulfillment_status,
           o.reservation_status, o.refund_status,
           CASE WHEN p_event_id IS NULL THEN NULL ELSE v_event_status END
    FROM public.guest_shop_orders o
    JOIN public.guest_shop_payment_orders p ON p.guest_order_id = o.id
    WHERE o.id = v_order.id;
END;
$$;

-- Consume is kept as a compatibility wrapper.  The actual state transition is
-- implemented by fn_guest_shop_claim_fulfillment so every worker path shares
-- the same payment-verification and reservation-expiry checks.
CREATE OR REPLACE FUNCTION public.fn_guest_shop_consume_reservation(
    p_order_id UUID,
    p_reservation_id UUID DEFAULT NULL
)
RETURNS TABLE (
    order_id UUID,
    reservation_id UUID,
    inventory_id UUID,
    content TEXT,
    fulfillment_status TEXT,
    reservation_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public.guest_shop_require_service_role();
    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'guest_order_required';
    END IF;
    RETURN QUERY
    SELECT c.order_id, c.reservation_id, c.inventory_id, c.content,
           c.fulfillment_status, c.reservation_status
    FROM public.fn_guest_shop_claim_fulfillment(p_order_id, p_reservation_id) c;
END;
$$;

-- Claim one non-shared inventory row for a verified paid order.  This is a
-- service-role worker RPC; it intentionally returns content only to the
-- trusted fulfillment process.  Public claim handlers must verify the claim
-- secret separately and only read an already delivered order.
CREATE OR REPLACE FUNCTION public.fn_guest_shop_claim_fulfillment(
    p_order_id UUID,
    p_reservation_id UUID DEFAULT NULL
)
RETURNS TABLE (
    order_id UUID,
    reservation_id UUID,
    inventory_id UUID,
    content TEXT,
    fulfillment_status TEXT,
    reservation_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.guest_shop_orders%ROWTYPE;
    v_reservation public.guest_shop_inventory_reservations%ROWTYPE;
    v_inventory public.shop_inventory%ROWTYPE;
    v_inventory_found BOOLEAN;
    v_now TIMESTAMPTZ := clock_timestamp();
BEGIN
    PERFORM public.guest_shop_require_service_role();
    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'guest_order_required';
    END IF;

    SELECT * INTO v_order
    FROM public.guest_shop_orders o
    WHERE o.id = p_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_order_not_found';
    END IF;
    IF v_order.payment_status <> 'confirmed'
       OR v_order.payment_status IN ('refunded', 'chargeback')
       OR v_order.refund_status IN ('succeeded', 'manual_review')
       OR v_order.fulfillment_status IN ('paid_unfulfillable', 'refunded', 'dead_letter') THEN
        RAISE EXCEPTION 'guest_payment_not_fulfillable';
    END IF;

    SELECT * INTO v_reservation
    FROM public.guest_shop_inventory_reservations r
    WHERE r.order_id = p_order_id
      AND (p_reservation_id IS NULL OR r.id = p_reservation_id)
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_reservation_not_found';
    END IF;
    IF p_reservation_id IS NOT NULL AND v_reservation.id <> p_reservation_id THEN
        RAISE EXCEPTION 'guest_reservation_order_mismatch';
    END IF;

    IF v_reservation.status = 'consumed' THEN
        SELECT * INTO v_inventory
        FROM public.shop_inventory i
        WHERE i.id = v_reservation.inventory_id
        FOR UPDATE;
        IF NOT FOUND OR v_inventory.status <> 'sold' OR COALESCE(v_inventory.is_shared, false) THEN
            RAISE EXCEPTION 'guest_consumed_inventory_inconsistent';
        END IF;
        RETURN QUERY SELECT
            v_order.id, v_reservation.id, v_inventory.id, v_inventory.content,
            v_order.fulfillment_status, v_reservation.status;
        RETURN;
    END IF;

    IF v_reservation.status <> 'held' THEN
        -- Released rows are terminal.  Do not try to find replacement stock.
        RETURN QUERY SELECT
            v_order.id, v_reservation.id, v_reservation.inventory_id, NULL::TEXT,
            v_order.fulfillment_status, v_reservation.status;
        RETURN;
    END IF;

    SELECT * INTO v_inventory
    FROM public.shop_inventory i
    WHERE i.id = v_reservation.inventory_id
    FOR UPDATE;

    v_inventory_found := FOUND;

    IF v_order.expires_at <= v_now
       OR v_reservation.reserved_until <= v_now
       OR NOT v_inventory_found
       OR (v_inventory_found AND (v_inventory.status <> 'reserve'
           OR COALESCE(v_inventory.is_shared, false))) THEN
        -- Do not raise after writing this state: an exception would roll the
        -- paid_unfulfillable marker back and make the refund queue blind.
        IF v_inventory_found AND v_inventory.status = 'reserve' AND NOT COALESCE(v_inventory.is_shared, false) THEN
            UPDATE public.shop_inventory
            SET status = 'available'
            WHERE id = v_inventory.id
              AND status = 'reserve'
              AND COALESCE(is_shared, false) = false;
        END IF;
        UPDATE public.guest_shop_inventory_reservations
        SET status = 'released',
            released_at = COALESCE(released_at, v_now),
            release_reason = CASE
                WHEN v_order.expires_at <= v_now OR v_reservation.reserved_until <= v_now
                    THEN 'paid_reservation_expired'
                ELSE 'paid_inventory_not_reservable'
            END,
            updated_at = v_now
        WHERE id = v_reservation.id
          AND status = 'held';
        UPDATE public.guest_shop_orders
        SET reservation_status = 'released',
            fulfillment_status = 'paid_unfulfillable',
            refund_status = CASE
                WHEN v_order.refund_status = 'succeeded' THEN v_order.refund_status
                ELSE 'pending'
            END,
            last_error_code = 'paid_inventory_not_reservable',
            last_error_message = 'payment confirmed but held inventory expired or was lost',
            updated_at = v_now
        WHERE id = v_order.id;
        RETURN QUERY SELECT
            v_order.id, v_reservation.id, v_reservation.inventory_id, NULL::TEXT,
            'paid_unfulfillable'::TEXT, 'released'::TEXT;
        RETURN;
    END IF;

    UPDATE public.shop_inventory
    SET status = 'sold',
        sold_at = COALESCE(sold_at, v_now),
        buyer_id = NULL
    WHERE id = v_inventory.id
      AND status = 'reserve'
      AND COALESCE(is_shared, false) = false;
    IF NOT FOUND THEN
        -- The row changed despite the lock only if an out-of-band trigger or
        -- manual operation violated the state contract.  Persist a visible
        -- compensation state rather than throwing it away in a rollback.
        UPDATE public.guest_shop_inventory_reservations
        SET status = 'released',
            released_at = COALESCE(released_at, v_now),
            release_reason = 'paid_inventory_update_race',
            updated_at = v_now
        WHERE id = v_reservation.id
          AND status = 'held';
        UPDATE public.guest_shop_orders
        SET reservation_status = 'released',
            fulfillment_status = 'paid_unfulfillable',
            refund_status = CASE WHEN v_order.refund_status = 'succeeded' THEN v_order.refund_status ELSE 'pending' END,
            last_error_code = 'paid_inventory_update_race',
            last_error_message = 'inventory could not be consumed after payment confirmation',
            updated_at = v_now
        WHERE id = v_order.id;
        RETURN QUERY SELECT
            v_order.id, v_reservation.id, v_reservation.inventory_id, NULL::TEXT,
            'paid_unfulfillable'::TEXT, 'released'::TEXT;
        RETURN;
    END IF;

    UPDATE public.guest_shop_inventory_reservations
    SET status = 'consumed',
        consumed_at = COALESCE(consumed_at, v_now),
        updated_at = v_now
    WHERE id = v_reservation.id
      AND status = 'held';
    IF NOT FOUND THEN
        -- This should be impossible under the reservation lock, but leave a
        -- compensatable state if a future trigger changes the row semantics.
        UPDATE public.guest_shop_orders
        SET fulfillment_status = 'paid_unfulfillable',
            refund_status = CASE WHEN v_order.refund_status = 'succeeded' THEN v_order.refund_status ELSE 'pending' END,
            last_error_code = 'guest_reservation_update_race',
            last_error_message = 'reservation could not be consumed after inventory sale',
            updated_at = v_now
        WHERE id = v_order.id;
        RETURN QUERY SELECT
            v_order.id, v_reservation.id, v_reservation.inventory_id, NULL::TEXT,
            'paid_unfulfillable'::TEXT, v_reservation.status;
        RETURN;
    END IF;

    UPDATE public.guest_shop_orders
    SET reservation_status = 'consumed',
        fulfillment_status = CASE
            WHEN v_order.fulfillment_status = 'delivered' THEN v_order.fulfillment_status
            ELSE 'fulfilling'
        END,
        updated_at = v_now
    WHERE id = v_order.id
      AND payment_status = 'confirmed';

    RETURN QUERY SELECT
        v_order.id, v_reservation.id, v_inventory.id, v_inventory.content,
        (SELECT o.fulfillment_status FROM public.guest_shop_orders o WHERE o.id = v_order.id),
        'consumed'::TEXT;
END;
$$;

-- Mark an already consumed/sold item as delivered.  Repeated worker callbacks
-- are successful no-ops after the first delivered transition.
CREATE OR REPLACE FUNCTION public.fn_guest_shop_mark_fulfilled(
    p_order_id UUID,
    p_reservation_id UUID DEFAULT NULL
)
RETURNS TABLE (
    fulfilled BOOLEAN,
    order_id UUID,
    reservation_id UUID,
    fulfillment_status TEXT,
    fulfilled_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.guest_shop_orders%ROWTYPE;
    v_reservation public.guest_shop_inventory_reservations%ROWTYPE;
    v_inventory_status TEXT;
    v_fulfilled_at TIMESTAMPTZ;
BEGIN
    PERFORM public.guest_shop_require_service_role();
    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'guest_order_required';
    END IF;

    SELECT * INTO v_order
    FROM public.guest_shop_orders
    WHERE id = p_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_order_not_found';
    END IF;
    IF v_order.payment_status <> 'confirmed'
       OR v_order.payment_status IN ('refunded', 'chargeback')
       OR v_order.refund_status IN ('succeeded', 'manual_review')
       OR v_order.fulfillment_status IN ('paid_unfulfillable', 'refunded', 'dead_letter') THEN
        RAISE EXCEPTION 'guest_payment_not_confirmed';
    END IF;

    SELECT * INTO v_reservation
    FROM public.guest_shop_inventory_reservations r
    WHERE r.order_id = p_order_id
      AND (p_reservation_id IS NULL OR r.id = p_reservation_id)
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_reservation_not_found';
    END IF;
    IF p_reservation_id IS NOT NULL AND v_reservation.id <> p_reservation_id THEN
        RAISE EXCEPTION 'guest_reservation_order_mismatch';
    END IF;

    SELECT i.status INTO v_inventory_status
    FROM public.shop_inventory i
    WHERE i.id = v_reservation.inventory_id
    FOR UPDATE;
    IF NOT FOUND OR v_inventory_status <> 'sold' THEN
        RAISE EXCEPTION 'guest_inventory_not_sold';
    END IF;
    IF v_reservation.status NOT IN ('consumed') THEN
        RAISE EXCEPTION 'guest_reservation_not_consumed';
    END IF;

    IF v_order.fulfillment_status = 'delivered' THEN
        RETURN QUERY SELECT
            true,
            p_order_id,
            v_reservation.id,
            v_order.fulfillment_status,
            v_order.fulfilled_at;
        RETURN;
    END IF;

    v_fulfilled_at := COALESCE(v_order.fulfilled_at, clock_timestamp());
    UPDATE public.guest_shop_orders o
    SET fulfillment_status = 'delivered',
        fulfilled_at = v_fulfilled_at,
        updated_at = clock_timestamp()
    WHERE o.id = p_order_id
      AND o.payment_status = 'confirmed'
      AND o.fulfillment_status <> 'delivered';

    RETURN QUERY SELECT
        true,
        p_order_id,
        v_reservation.id,
        'delivered'::TEXT,
        v_fulfilled_at;
END;
$$;

-- Record the result of a provider refund/compensation attempt.  This does not
-- trigger a provider call; the worker owns retries and supplies its reference.
CREATE OR REPLACE FUNCTION public.fn_guest_shop_record_refund_result(
    p_order_id UUID,
    p_refund_status TEXT,
    p_provider_ref TEXT DEFAULT NULL,
    p_error_code TEXT DEFAULT NULL,
    p_error_message TEXT DEFAULT NULL
)
RETURNS TABLE (
    order_id UUID,
    refund_status TEXT,
    payment_status TEXT,
    fulfillment_status TEXT,
    provider_ref TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.guest_shop_orders%ROWTYPE;
    v_payment public.guest_shop_payment_orders%ROWTYPE;
    v_status TEXT := LOWER(BTRIM(COALESCE(p_refund_status, '')));
    v_message TEXT := LEFT(NULLIF(BTRIM(COALESCE(p_error_message, '')), ''), 500);
BEGIN
    PERFORM public.guest_shop_require_service_role();
    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'guest_order_required';
    END IF;
    IF v_status NOT IN ('pending', 'succeeded', 'failed', 'manual_review') THEN
        RAISE EXCEPTION 'guest_invalid_refund_status';
    END IF;
    IF v_status = 'succeeded' AND NULLIF(BTRIM(COALESCE(p_provider_ref, '')), '') IS NULL THEN
        RAISE EXCEPTION 'guest_refund_provider_ref_required';
    END IF;

    SELECT * INTO v_order
    FROM public.guest_shop_orders
    WHERE id = p_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_order_not_found';
    END IF;
    SELECT * INTO v_payment
    FROM public.guest_shop_payment_orders
    WHERE guest_order_id = p_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_payment_order_not_found';
    END IF;
    IF v_order.payment_status NOT IN ('confirmed', 'refunded', 'chargeback')
       AND v_order.fulfillment_status <> 'paid_unfulfillable' THEN
        RAISE EXCEPTION 'guest_refund_not_applicable';
    END IF;
    IF v_order.payment_status = 'chargeback'
       OR v_payment.status = 'chargeback' THEN
        RETURN QUERY SELECT v_order.id, v_order.refund_status,
                            v_order.payment_status, v_order.fulfillment_status,
                            v_payment.refund_provider_ref;
        RETURN;
    END IF;
    IF v_order.payment_status = 'refunded'
       AND v_status <> 'succeeded' THEN
        RETURN QUERY SELECT v_order.id, v_order.refund_status,
                            v_order.payment_status, v_order.fulfillment_status,
                            v_payment.refund_provider_ref;
        RETURN;
    END IF;

    -- Refund/chargeback is terminal. A repeated provider result may be
    -- acknowledged, but it must not move a succeeded refund backwards.
    IF v_order.refund_status = 'succeeded' AND v_status <> 'succeeded' THEN
        RETURN QUERY SELECT v_order.id, v_order.refund_status,
                            v_order.payment_status, v_order.fulfillment_status,
                            v_payment.refund_provider_ref;
        RETURN;
    END IF;

    IF v_status = 'succeeded' THEN
        IF v_order.refund_status = 'succeeded' THEN
            RETURN QUERY SELECT v_order.id, v_order.refund_status,
                                v_order.payment_status, v_order.fulfillment_status,
                                v_payment.refund_provider_ref;
            RETURN;
        END IF;
        UPDATE public.guest_shop_payment_orders
        SET status = 'refunded',
            refund_provider_ref = COALESCE(refund_provider_ref, LEFT(NULLIF(BTRIM(p_provider_ref), ''), 200)),
            last_error_code = NULL,
            last_error_message = NULL,
            updated_at = clock_timestamp()
        WHERE id = v_payment.id;
        UPDATE public.guest_shop_orders
        SET payment_status = 'refunded',
            refund_status = 'succeeded',
            fulfillment_status = CASE
                -- foundation CHECK requires fulfilled_at to imply delivered;
                -- retain delivered after refund while financial columns carry
                -- the refund terminal state.
                WHEN v_order.fulfillment_status = 'delivered' THEN 'delivered'
                WHEN v_order.fulfillment_status IN ('paid_unfulfillable', 'failed', 'dead_letter') THEN 'refunded'
                ELSE v_order.fulfillment_status
            END,
            last_error_code = NULL,
            last_error_message = NULL,
            updated_at = clock_timestamp()
        WHERE id = p_order_id;
    ELSE
        UPDATE public.guest_shop_payment_orders
        SET status = CASE WHEN v_status = 'manual_review' THEN 'review' ELSE status END,
            refund_provider_ref = COALESCE(LEFT(NULLIF(BTRIM(p_provider_ref), ''), 200), refund_provider_ref),
            last_error_code = LEFT(NULLIF(BTRIM(COALESCE(p_error_code, '')), ''), 120),
            last_error_message = v_message,
            updated_at = clock_timestamp()
        WHERE id = v_payment.id;
        UPDATE public.guest_shop_orders
        SET refund_status = v_status,
            last_error_code = LEFT(NULLIF(BTRIM(COALESCE(p_error_code, '')), ''), 120),
            last_error_message = v_message,
            updated_at = clock_timestamp()
        WHERE id = p_order_id;
    END IF;

    RETURN QUERY
    SELECT o.id, o.refund_status, o.payment_status, o.fulfillment_status,
           p.refund_provider_ref
    FROM public.guest_shop_orders o
    JOIN public.guest_shop_payment_orders p ON p.guest_order_id = o.id
    WHERE o.id = p_order_id;
END;
$$;

-- Release a held reservation.  The order id is required so a caller cannot
-- accidentally release a reservation belonging to another order.  If payment
-- has already been confirmed but the inventory row is no longer reservable,
-- the order is made explicitly unfulfillable and queued for compensation.
CREATE OR REPLACE FUNCTION public.fn_guest_shop_release_reservation(
    p_reservation_id UUID,
    p_order_id UUID,
    p_reason TEXT DEFAULT 'expired'
)
RETURNS TABLE (
    released BOOLEAN,
    reservation_status TEXT,
    payment_status TEXT,
    fulfillment_status TEXT,
    refund_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order public.guest_shop_orders%ROWTYPE;
    v_reservation public.guest_shop_inventory_reservations%ROWTYPE;
    v_inventory_status TEXT;
    v_released BOOLEAN := false;
    v_reason TEXT := LEFT(COALESCE(NULLIF(BTRIM(p_reason), ''), 'expired'), 120);
BEGIN
    PERFORM public.guest_shop_require_service_role();
    IF p_reservation_id IS NULL OR p_order_id IS NULL THEN
        RAISE EXCEPTION 'guest_reservation_and_order_required';
    END IF;

    -- State-transition functions consistently lock order -> reservation ->
    -- inventory, which prevents release/consume races from deadlocking.
    SELECT * INTO v_order
    FROM public.guest_shop_orders
    WHERE id = p_order_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'guest_order_not_found';
    END IF;

    SELECT * INTO v_reservation
    FROM public.guest_shop_inventory_reservations
    WHERE id = p_reservation_id
    FOR UPDATE;
    IF NOT FOUND OR v_reservation.order_id <> p_order_id THEN
        RAISE EXCEPTION 'guest_reservation_order_mismatch';
    END IF;

    IF v_reservation.status = 'held' THEN
        SELECT i.status INTO v_inventory_status
        FROM public.shop_inventory i
        WHERE i.id = v_reservation.inventory_id
        FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'guest_inventory_not_found';
        END IF;

        IF v_inventory_status = 'reserve' THEN
            UPDATE public.shop_inventory
            SET status = 'available'
            WHERE id = v_reservation.inventory_id
              AND status = 'reserve';
            v_released := true;
        END IF;

        UPDATE public.guest_shop_inventory_reservations
        SET status = 'released',
            released_at = clock_timestamp(),
            release_reason = v_reason,
            updated_at = clock_timestamp()
        WHERE id = v_reservation.id
          AND order_id = p_order_id
          AND status = 'held';

        IF v_order.payment_status = 'confirmed' THEN
            UPDATE public.guest_shop_orders
            SET reservation_status = 'released',
                fulfillment_status = 'paid_unfulfillable',
                refund_status = CASE
                    WHEN v_order.refund_status = 'succeeded' THEN v_order.refund_status
                    ELSE 'pending'
                END,
                last_error_code = CASE
                    WHEN v_released THEN last_error_code
                    ELSE 'paid_inventory_not_reservable'
                END,
                last_error_message = CASE
                    WHEN v_released THEN last_error_message
                    ELSE 'payment confirmed but inventory was not in reserve state'
                END,
                updated_at = clock_timestamp()
            WHERE id = p_order_id;
        ELSE
            UPDATE public.guest_shop_orders
            SET reservation_status = 'released',
                last_error_code = NULL,
                last_error_message = NULL,
                updated_at = clock_timestamp()
            WHERE id = p_order_id;
        END IF;
    ELSE
        -- Releasing an already released/consumed row is idempotent.  A consumed
        -- row is never rewound to available, even for a repeated expiry job.
        v_released := v_reservation.status = 'released';
    END IF;

    RETURN QUERY SELECT
        v_released,
        (SELECT r.status FROM public.guest_shop_inventory_reservations r WHERE r.id = p_reservation_id),
        (SELECT o.payment_status FROM public.guest_shop_orders o WHERE o.id = p_order_id),
        (SELECT o.fulfillment_status FROM public.guest_shop_orders o WHERE o.id = p_order_id),
        (SELECT o.refund_status FROM public.guest_shop_orders o WHERE o.id = p_order_id);
END;
$$;

-- Lock candidate orders with SKIP LOCKED, then call the transition function.
-- The transition itself re-locks order -> reservation -> inventory in a stable
-- order, so concurrent payment confirmation and expiry sweeps cannot deadlock.
CREATE OR REPLACE FUNCTION public.fn_guest_shop_release_expired_reservations(
    p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
    processed_count INTEGER,
    released_count INTEGER,
    unfulfillable_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 1000);
    v_candidate RECORD;
    v_result RECORD;
    v_processed INTEGER := 0;
    v_released INTEGER := 0;
    v_unfulfillable INTEGER := 0;
    v_error_message TEXT;
BEGIN
    PERFORM public.guest_shop_require_service_role();

    FOR v_candidate IN
        SELECT o.id AS order_id, r.id AS reservation_id
        FROM public.guest_shop_orders o
        JOIN public.guest_shop_inventory_reservations r ON r.order_id = o.id
        WHERE r.status = 'held'
          AND r.reserved_until <= clock_timestamp()
        ORDER BY r.reserved_until ASC, r.id ASC
        LIMIT v_limit
        FOR UPDATE OF o SKIP LOCKED
    LOOP
        BEGIN
            SELECT * INTO v_result
            FROM public.fn_guest_shop_release_reservation(
                v_candidate.reservation_id,
                v_candidate.order_id,
                'expired'
            );
            v_processed := v_processed + 1;
            IF COALESCE(v_result.released, false) THEN
                v_released := v_released + 1;
            END IF;
            IF v_result.fulfillment_status = 'paid_unfulfillable' THEN
                v_unfulfillable := v_unfulfillable + 1;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            -- Keep the batch alive, but never hide a failed transition from
            -- operations. The reservation remains eligible for the next sweep.
            GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
            RAISE WARNING 'guest expiry release failed for reservation % order %: %',
                v_candidate.reservation_id, v_candidate.order_id, v_error_message;
            v_processed := v_processed + 1;
        END;
    END LOOP;

    RETURN QUERY SELECT v_processed, v_released, v_unfulfillable;
END;
$$;

-- Create an order, hold exactly one non-shared inventory row, and create the
-- matching shop_direct payment intent in one transaction.  No inventory
-- content is selected into the return value.
-- Drop the pre-hardening signature so PostgreSQL cannot retain an overload
-- that accepts a client-supplied amount.
DROP FUNCTION IF EXISTS public.fn_guest_shop_create_order(
    TEXT, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT,
    TEXT, TEXT, TEXT, INTEGER
);
CREATE OR REPLACE FUNCTION public.fn_guest_shop_create_order(
    p_site TEXT,
    p_product_id UUID,
    p_sku_id UUID,
    p_idempotency_key TEXT,
    p_request_fingerprint TEXT,
    p_claim_secret_hash TEXT,
    p_provider TEXT,
    p_channel TEXT,
    p_buyer_contact_hash TEXT DEFAULT NULL,
    p_request_ip_hash TEXT DEFAULT NULL,
    p_request_device_hash TEXT DEFAULT NULL,
    p_ttl_seconds INTEGER DEFAULT 1800
)
RETURNS TABLE (
    order_id UUID,
    order_no TEXT,
    payment_order_id UUID,
    merchant_order_no TEXT,
    site TEXT,
    currency TEXT,
    unit_amount NUMERIC,
    total_amount NUMERIC,
    expires_at TIMESTAMPTZ,
    claim_secret_version SMALLINT,
    reservation_status TEXT,
    payment_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_site TEXT := public.guest_shop_normalize_site(p_site);
    v_currency TEXT;
    v_provider TEXT := LOWER(BTRIM(COALESCE(p_provider, '')));
    v_channel TEXT := LOWER(BTRIM(COALESCE(p_channel, '')));
    v_key TEXT := BTRIM(COALESCE(p_idempotency_key, ''));
    v_fingerprint TEXT := BTRIM(COALESCE(p_request_fingerprint, ''));
    v_product public.shop_products%ROWTYPE;
    v_sku public.shop_product_skus%ROWTYPE;
    v_source_sku public.shop_product_skus%ROWTYPE;
    v_unit_amount NUMERIC(14,2);
    v_order_id UUID;
    v_payment_order_id UUID;
    v_inventory_id UUID;
    v_order_no TEXT;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_expires_at TIMESTAMPTZ;
    v_existing RECORD;
    v_existing_payment RECORD;
    v_guest_enabled BOOLEAN;
    v_allowed_channels JSONB;
    v_delivery_type TEXT;
    v_raw_source_ids UUID[];
    v_configured_source_ids UUID[];
    v_source_ids UUID[];
    v_inventory_source_sku_id UUID;
BEGIN
    PERFORM public.guest_shop_require_service_role();

    IF v_site NOT IN ('cn', 'intl') THEN
        RAISE EXCEPTION 'guest_invalid_site';
    END IF;
    v_currency := CASE WHEN v_site = 'cn' THEN 'CNY' ELSE 'USD' END;

    IF p_product_id IS NULL OR p_sku_id IS NULL THEN
        RAISE EXCEPTION 'guest_product_or_sku_required';
    END IF;
    IF char_length(v_key) < 16 OR char_length(v_key) > 200 THEN
        RAISE EXCEPTION 'guest_invalid_idempotency_key';
    END IF;
    IF v_fingerprint !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'guest_invalid_request_fingerprint';
    END IF;
    IF p_claim_secret_hash IS NULL
       OR p_claim_secret_hash !~ '^hmac-sha256:v1:[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'guest_invalid_claim_secret_hash';
    END IF;
    IF p_ttl_seconds IS NULL OR p_ttl_seconds < 300 OR p_ttl_seconds > 7200 THEN
        RAISE EXCEPTION 'guest_invalid_order_ttl';
    END IF;
    IF v_provider = '' OR char_length(v_provider) > 80
       OR v_provider !~ '^[a-z0-9][a-z0-9._:-]{0,79}$'
       OR v_provider IN ('mock', 'test', 'fake')
       OR v_channel = '' OR char_length(v_channel) > 80
       OR v_channel !~ '^[a-z0-9][a-z0-9._:-]{0,79}$'
       OR v_channel IN ('mock', 'test', 'fake') THEN
        RAISE EXCEPTION 'guest_invalid_payment_provider';
    END IF;

    -- The advisory lock makes the idempotency lookup and inventory decision a
    -- single serial point even when two retries arrive simultaneously.
    PERFORM pg_advisory_xact_lock(hashtextextended(v_site || ':' || v_key, 0));

    SELECT o.*,
           p.id AS existing_payment_order_id,
           p.merchant_order_no AS existing_merchant_order_no,
           p.status AS existing_payment_status
    INTO v_existing
    FROM public.guest_shop_orders o
    LEFT JOIN public.guest_shop_payment_orders p ON p.guest_order_id = o.id
    WHERE o.site = v_site
      AND o.idempotency_key = v_key;

    IF FOUND THEN
        IF v_existing.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
            RAISE EXCEPTION 'guest_idempotency_conflict';
        END IF;
        IF v_existing.claim_secret_hash IS DISTINCT FROM p_claim_secret_hash THEN
            RAISE EXCEPTION 'guest_idempotency_claim_secret_conflict';
        END IF;
        RETURN QUERY SELECT
            v_existing.id,
            v_existing.order_no,
            v_existing.existing_payment_order_id,
            v_existing.existing_merchant_order_no,
            v_existing.site::TEXT,
            v_existing.currency::TEXT,
            v_existing.unit_amount,
            v_existing.total_amount,
            v_existing.expires_at,
            v_existing.claim_secret_version,
            v_existing.reservation_status,
            v_existing.existing_payment_status;
        RETURN;
    END IF;

    -- Product then selected SKU then source SKU is the lock order used by all
    -- creation calls.  Source aliases stay within one product by migration
    -- constraints; P0 still rejects shared inventory itself below.
    SELECT * INTO v_product
    FROM public.shop_products
    WHERE id = p_product_id
    FOR UPDATE;
    IF NOT FOUND OR COALESCE(v_product.is_active, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'guest_product_unavailable';
    END IF;

    SELECT * INTO v_sku
    FROM public.shop_product_skus
    WHERE id = p_sku_id
      AND product_id = p_product_id
    FOR UPDATE;
    IF NOT FOUND OR COALESCE(v_sku.is_active, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'guest_sku_unavailable';
    END IF;

    -- P0 is automatic KEY delivery only. Manual/API products can never enter
    -- this cash channel, even if an operator accidentally enables guest sale.
    v_delivery_type := UPPER(BTRIM(COALESCE(v_product.delivery_type, 'KEY')));
    IF v_delivery_type <> 'KEY'
       OR COALESCE(v_product.manual_delivery, false)
       OR COALESCE(v_sku.manual_delivery, false) THEN
        RAISE EXCEPTION 'guest_delivery_mode_unsupported';
    END IF;

    -- Validate the raw configured source list before using the resolver.  The
    -- resolver intentionally uses joins and can omit a deleted source; a new
    -- guest order must instead fail closed when configuration is stale,
    -- cross-product, points at an inactive SKU, or contains a NULL that a
    -- convenience unnest() filter would otherwise silently discard.
    v_raw_source_ids := CASE
        WHEN v_site = 'intl'
             AND COALESCE(array_length(v_sku.inventory_source_sku_ids_intl, 1), 0) > 0
            THEN v_sku.inventory_source_sku_ids_intl
        WHEN v_site <> 'intl'
             AND COALESCE(array_length(v_sku.inventory_source_sku_ids, 1), 0) > 0
            THEN v_sku.inventory_source_sku_ids
        WHEN v_site = 'intl'
            THEN ARRAY[v_sku.id]::UUID[]
        WHEN v_sku.inventory_sku_id IS NOT NULL
            THEN ARRAY[v_sku.inventory_sku_id]::UUID[]
        ELSE ARRAY[v_sku.id]::UUID[]
    END;
    IF v_raw_source_ids IS NULL
       OR COALESCE(array_length(v_raw_source_ids, 1), 0) = 0
       OR array_position(v_raw_source_ids, NULL) IS NOT NULL THEN
        RAISE EXCEPTION 'guest_inventory_source_invalid';
    END IF;

    SELECT COALESCE(array_agg(source_id ORDER BY first_rank), ARRAY[]::UUID[])
    INTO v_configured_source_ids
    FROM (
        SELECT source_id, MIN(source_rank) AS first_rank
        FROM unnest(v_raw_source_ids) WITH ORDINALITY AS source(source_id, source_rank)
        GROUP BY source_id
    ) configured;
    IF COALESCE(array_length(v_configured_source_ids, 1), 0) = 0 THEN
        RAISE EXCEPTION 'guest_inventory_source_unavailable';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM unnest(v_configured_source_ids) AS configured(source_id)
        LEFT JOIN public.shop_product_skus source_sku ON source_sku.id = configured.source_id
        WHERE source_sku.id IS NULL
           OR source_sku.product_id IS DISTINCT FROM v_product.id
           OR COALESCE(source_sku.is_active, false) IS NOT TRUE
           OR COALESCE(source_sku.manual_delivery, false)
    ) THEN
        RAISE EXCEPTION 'guest_inventory_source_invalid';
    END IF;

    -- Resolve the site-specific source chain and lock source SKUs in priority
    -- order. The resolver enforces same-product aliases and default semantics.
    -- Prove both directions: cardinality alone accepts two different source
    -- sets of equal length, which could reserve inventory from a stale alias.
    SELECT COALESCE(array_agg(src.source_sku_id ORDER BY src.source_rank), ARRAY[]::UUID[])
    INTO v_source_ids
    FROM public.fn_resolve_shop_sku_inventory_sources(v_sku.id, v_site) src;
    IF COALESCE(array_length(v_source_ids, 1), 0) = 0
       OR COALESCE(array_length(v_source_ids, 1), 0)
          <> COALESCE(array_length(v_configured_source_ids, 1), 0)
       OR EXISTS (
           SELECT 1
           FROM unnest(v_configured_source_ids) AS configured(source_id)
           WHERE NOT EXISTS (
               SELECT 1
               FROM unnest(v_source_ids) AS resolved(source_id)
               WHERE resolved.source_id = configured.source_id
           )
       )
       OR EXISTS (
           SELECT 1
           FROM unnest(v_source_ids) AS resolved(source_id)
           WHERE NOT EXISTS (
               SELECT 1
               FROM unnest(v_configured_source_ids) AS configured(source_id)
               WHERE configured.source_id = resolved.source_id
           )
       )
       -- Preserve first-occurrence priority too: it decides which available
       -- inventory row is held when several source pools have stock.
       OR v_source_ids IS DISTINCT FROM v_configured_source_ids THEN
        RAISE EXCEPTION 'guest_inventory_source_invalid';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM public.shop_product_skus source_sku
        WHERE source_sku.id = ANY(v_source_ids)
          AND (
              source_sku.product_id IS DISTINCT FROM v_product.id
              OR COALESCE(source_sku.is_active, false) IS NOT TRUE
              OR COALESCE(source_sku.manual_delivery, false)
          )
    ) THEN
        RAISE EXCEPTION 'guest_inventory_source_invalid';
    END IF;
    FOR v_source_sku IN
        SELECT s.*
        FROM public.shop_product_skus s
        WHERE s.id = ANY(v_source_ids)
        ORDER BY array_position(v_source_ids, s.id)
        FOR UPDATE
    LOOP
        NULL;
    END LOOP;

    v_guest_enabled := COALESCE(v_sku.allow_guest_purchase, v_product.allow_guest_purchase, false);
    IF v_guest_enabled IS NOT TRUE THEN
        RAISE EXCEPTION 'guest_purchase_disabled';
    END IF;

    v_unit_amount := CASE
        WHEN v_site = 'cn' THEN COALESCE(v_sku.guest_cash_price_cny, v_product.guest_cash_price_cny)
        ELSE COALESCE(v_sku.guest_cash_price_intl, v_product.guest_cash_price_intl)
    END;
    IF v_unit_amount IS NULL
       OR LOWER(v_unit_amount::TEXT) IN ('nan', 'infinity', '-infinity')
       OR v_unit_amount <= 0
       OR v_unit_amount <> ROUND(v_unit_amount, 2) THEN
        RAISE EXCEPTION 'guest_cash_price_unavailable';
    END IF;
    v_unit_amount := ROUND(v_unit_amount, 2);

    v_allowed_channels := COALESCE(v_sku.guest_payment_channels, v_product.guest_payment_channels, '[]'::JSONB);
    -- Payment channel configuration is an allowlist, never an opt-out.  An
    -- empty/malformed list must fail closed, and each entry must be a string
    -- token or an explicit provider:channel pair.  Never accept mock/test/fake
    -- values through configuration even if an operator accidentally stores
    -- them in JSONB.
    IF jsonb_typeof(v_allowed_channels) <> 'array'
       OR jsonb_array_length(v_allowed_channels) = 0 THEN
        RAISE EXCEPTION 'guest_payment_channel_allowlist_empty';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_allowed_channels) AS allowed(value)
        WHERE jsonb_typeof(allowed.value) <> 'string'
           OR LOWER(BTRIM(allowed.value #>> '{}')) !~ '^[a-z0-9][a-z0-9._:-]{0,159}$'
           OR LOWER(BTRIM(allowed.value #>> '{}')) IN ('mock', 'test', 'fake')
    ) THEN
        RAISE EXCEPTION 'guest_payment_channel_allowlist_invalid';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(v_allowed_channels) AS allowed(channel)
        WHERE LOWER(BTRIM(allowed.channel)) IN (
            v_channel,
            v_provider,
            v_provider || ':' || v_channel
        )
    ) THEN
        RAISE EXCEPTION 'guest_payment_channel_unavailable';
    END IF;

    v_expires_at := v_now + make_interval(secs => p_ttl_seconds);

    -- P0 intentionally sells one row only and excludes reusable/shared rows.
    WITH source_rows AS MATERIALIZED (
        SELECT src.source_sku_id, src.source_is_default, src.source_rank
        FROM public.fn_resolve_shop_sku_inventory_sources(v_sku.id, v_site) src
    ), candidate AS (
        -- Carry the logical source selected by the same row-locking query.
        -- This is an immutable reservation snapshot; resolving the chain a
        -- second time after UPDATE would permit a concurrent configuration
        -- change (or a different default source) to mislabel the held row.
        SELECT i.id,
               src.source_sku_id AS matched_source_sku_id
        FROM public.shop_inventory i
        JOIN source_rows src
          ON i.sku_id = src.source_sku_id
          OR (src.source_is_default AND i.sku_id IS NULL)
        WHERE i.product_id = p_product_id
          AND i.status = 'available'
          AND COALESCE(i.is_shared, false) = false
        ORDER BY src.source_rank ASC, i.created_at ASC, i.id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.shop_inventory AS i
    SET status = 'reserve'
    FROM candidate
    WHERE i.id = candidate.id
      AND i.status = 'available'
    RETURNING i.id, candidate.matched_source_sku_id
    INTO v_inventory_id, v_inventory_source_sku_id;

    IF v_inventory_id IS NULL THEN
        RAISE EXCEPTION 'guest_inventory_unavailable';
    END IF;
    -- Default inventory rows intentionally have NULL i.sku_id; the candidate
    -- source carried above preserves which logical source authorized them.
    IF v_inventory_source_sku_id IS NULL THEN
        RAISE EXCEPTION 'guest_inventory_source_snapshot_failed';
    END IF;

    v_order_no := 'GS' || to_char(v_now, 'YYYYMMDDHH24MISSMS')
        || upper(substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 12));
    v_order_id := gen_random_uuid();
    v_payment_order_id := gen_random_uuid();

    INSERT INTO public.guest_shop_orders (
        id, order_no, idempotency_key, request_fingerprint, source_channel,
        site, currency, product_id, sku_id, snapshot_product_name,
        snapshot_sku_name, snapshot_delivery_type, snapshot_manual_delivery,
        snapshot_sku_manual_delivery, quantity, unit_amount, total_amount, payment_status,
        reservation_status, fulfillment_status, refund_status, claim_secret_hash,
        claim_secret_version, buyer_contact_hash, request_ip_hash,
        request_device_hash, expires_at, metadata
    ) VALUES (
        v_order_id, v_order_no, v_key, v_fingerprint, 'website_guest',
        v_site, v_currency, v_product.id, v_sku.id,
        COALESCE(NULLIF(BTRIM(v_product.name), ''), 'Product'),
        COALESCE(NULLIF(BTRIM(v_sku.sku_name), ''), 'Default'),
        v_delivery_type, COALESCE(v_product.manual_delivery, false),
        COALESCE(v_sku.manual_delivery, false),
        1, v_unit_amount, v_unit_amount, 'pending', 'held', 'pending', 'none',
        p_claim_secret_hash, 1, p_buyer_contact_hash, p_request_ip_hash,
        p_request_device_hash, v_expires_at, '{}'::JSONB
    );

    INSERT INTO public.guest_shop_inventory_reservations (
        id, order_id, inventory_id, inventory_source_sku_id, product_id, sku_id, site, status,
        reserved_at, reserved_until
    ) VALUES (
        gen_random_uuid(), v_order_id, v_inventory_id, v_inventory_source_sku_id,
        v_product.id, v_sku.id,
        v_site, 'held', v_now, v_expires_at
    );

    INSERT INTO public.guest_shop_payment_orders (
        id, guest_order_id, merchant_order_no, purpose, provider, channel,
        site, currency, expected_amount, status, expires_at
    ) VALUES (
        v_payment_order_id, v_order_id, v_order_no, 'shop_direct', v_provider,
        v_channel, v_site, v_currency, v_unit_amount, 'pending', v_expires_at
    );

    RETURN QUERY SELECT
        v_order_id,
        v_order_no,
        v_payment_order_id,
        v_order_no,
        v_site,
        v_currency,
        v_unit_amount,
        v_unit_amount,
        v_expires_at,
        1::SMALLINT,
        'held'::TEXT,
        'pending'::TEXT;
END;
$$;

-- SECURITY DEFINER does not imply caller authorization. Explicitly close all
-- guest-shop helpers and state transitions to service_role; anon/authenticated
-- callers must use server HTTP endpoints that perform rate limits and secret
-- verification before invoking these RPCs.
REVOKE ALL ON FUNCTION public.guest_shop_require_service_role() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_shop_require_service_role() TO service_role;
REVOKE ALL ON FUNCTION public.guest_shop_normalize_site(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_shop_normalize_site(TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.guest_shop_payment_is_final_success(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_shop_payment_is_final_success(TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.guest_shop_validate_inventory_reservation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_shop_validate_inventory_reservation() TO service_role;
REVOKE ALL ON FUNCTION public.guest_shop_validate_payment_order() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_shop_validate_payment_order() TO service_role;
REVOKE ALL ON FUNCTION public.guest_shop_validate_payment_event() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_shop_validate_payment_event() TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_confirm_payment(UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_confirm_payment(UUID, UUID, TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, TEXT, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_consume_reservation(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_consume_reservation(UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_claim_fulfillment(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_claim_fulfillment(UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_mark_fulfilled(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_mark_fulfilled(UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_record_refund_result(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_record_refund_result(UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_release_reservation(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_release_reservation(UUID, UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_release_expired_reservations(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_release_expired_reservations(INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.fn_guest_shop_create_order(TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_create_order(TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER) TO service_role;
