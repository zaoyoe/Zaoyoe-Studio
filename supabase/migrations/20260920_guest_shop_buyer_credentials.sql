-- Guest Shop Order Access 2.0 (A0): buyer credential tables + buyer_id link.
-- Codex does not execute this file. Run it in the target Supabase SQL editor
-- after 20260919. Design contract: docs/guest-shop-order-access-2.0.md.
--
-- This migration is additive with ONE deliberate exception: it replaces
-- fn_guest_shop_create_order by exact signature (DROP FUNCTION without
-- CASCADE, then CREATE) because adding p_buyer_id would otherwise create a
-- second overload and make every named-parameter call ambiguous. The
-- replacement body is mechanically derived from the 20260915 version; the
-- only changes are the new parameter, a fail-closed buyer binding guard, and
-- the buyer_id column in the orders INSERT. See the paired verify file.
--
-- It does NOT drop tables, does NOT cascade, does NOT roll back
-- 20260913/14/15/16/17/18/19, does NOT enable guest products or SKUs, and
-- does NOT turn on any GUEST_SHOP_BUYER_CREDENTIAL_* behaviour. Every switch
-- that reads these tables stays off until the operator enables it, so after
-- this file runs the production behaviour is unchanged.

-- ---------------------------------------------------------------------------
-- 1. guest_shop_buyers: one row per (site, contact_hash, credential_group_no).
--
--    Credential groups (§6.4) are the load-bearing wall against card-secret
--    cross-leak. A single email may hold up to a small number of mutually
--    invisible query passwords so that:
--      N1  a user who forgot their password can still place a NEW order
--          (no purchase wall before OTP ships), and
--      N2  a later order can never read an earlier order's card secrets
--          (a naive upsert that overwrites password_hash would hand the
--          victim's whole order history to whoever ordered with their email).
--    Passwords are therefore never overwritten; a mismatch allocates a new
--    group. Login verifies against the groups for that contact hash and
--    returns ONLY the orders of the matched group.
--
--    There is deliberately no order_count column: a denormalised counter
--    drifts and then lies. "Does this group have orders" is computed with
--    EXISTS against guest_shop_orders, which cannot drift.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guest_shop_buyers (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site                  VARCHAR(10)  NOT NULL,
    contact_hash          TEXT         NOT NULL,
    credential_group_no   SMALLINT     NOT NULL DEFAULT 1,
    password_hash         TEXT         NOT NULL,
    password_version      SMALLINT     NOT NULL DEFAULT 1,
    password_updated_at   TIMESTAMPTZ,
    email_verified_at     TIMESTAMPTZ,
    registered_user_match BOOLEAN      NOT NULL DEFAULT false,
    failed_login_count    INTEGER      NOT NULL DEFAULT 0,
    login_lock_stage      SMALLINT     NOT NULL DEFAULT 0,
    locked_until          TIMESTAMPTZ,
    last_login_at         TIMESTAMPTZ,
    last_login_ip_hash    TEXT,
    merged_into_user_id   UUID,
    merged_at             TIMESTAMPTZ,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp(),
    updated_at            TIMESTAMPTZ  NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT guest_shop_buyers_site_check   CHECK (site IN ('cn','intl')),
    CONSTRAINT guest_shop_buyers_hash_check   CHECK (contact_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT guest_shop_buyers_pwd_format   CHECK (password_hash ~ '^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$norm=v[0-9]+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$'),
    CONSTRAINT guest_shop_buyers_pwd_version  CHECK (password_version >= 1),
    CONSTRAINT guest_shop_buyers_attempts     CHECK (failed_login_count >= 0 AND failed_login_count <= 1000),
    CONSTRAINT guest_shop_buyers_stage        CHECK (login_lock_stage BETWEEN 0 AND 3),
    -- Group cap. The application-level effective cap (K38, default 3) counts
    -- only groups that actually own orders; orphan groups are recycled so a
    -- failed order can never permanently block an email. The DB cap is the
    -- outer bound and must stay >= the application cap.
    CONSTRAINT guest_shop_buyers_group_range  CHECK (credential_group_no BETWEEN 1 AND 5),
    CONSTRAINT guest_shop_buyers_site_contact_group_uniq
        UNIQUE (site, contact_hash, credential_group_no)
);

COMMENT ON TABLE public.guest_shop_buyers IS
    'Guest order-access credentials (email hash + scrypt query password). Access control only: never a pricing or quota input. See docs/guest-shop-order-access-2.0.md.';
COMMENT ON COLUMN public.guest_shop_buyers.contact_hash IS
    'HMAC-SHA256(GUEST_SHOP_CONTACT_HASH_PEPPER, lower(btrim(email))). Plaintext email is never stored.';
COMMENT ON COLUMN public.guest_shop_buyers.password_hash IS
    'scrypt$N$r$p$norm=v1$salt_b64$hash_b64. Per-row random salt, no pepper by design (a lost pepper would make every guest order permanently inaccessible).';
COMMENT ON COLUMN public.guest_shop_buyers.registered_user_match IS
    'Recorded for account merge and analytics ONLY. Must never reach the pricing resolver (anti-price-discrimination constraint H2).';

-- Login lookup: fetch all groups for one email (bounded), verify, stop on hit.
CREATE INDEX IF NOT EXISTS guest_shop_buyers_contact_idx
    ON public.guest_shop_buyers (site, contact_hash);
CREATE INDEX IF NOT EXISTS guest_shop_buyers_locked_idx
    ON public.guest_shop_buyers (locked_until)
    WHERE locked_until IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. guest_shop_access_attempts: brute-force forensics.
--    Stores only values already derived by HMAC. Never a password, never a
--    password hash, never a plaintext email, never a plaintext IP.
--    Retention: 30 days. The purge job is NOT created here; it is operator
--    scheduled work and must not be enabled by a migration.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guest_shop_access_attempts (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    site                VARCHAR(10) NOT NULL,
    contact_hash        TEXT,
    buyer_id            UUID,
    request_ip_hash     TEXT NOT NULL,
    request_device_hash TEXT,
    outcome             VARCHAR(24) NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT guest_shop_access_attempts_site_check CHECK (site IN ('cn','intl')),
    CONSTRAINT guest_shop_access_attempts_ip_check   CHECK (char_length(request_ip_hash) <= 128),
    CONSTRAINT guest_shop_access_attempts_outcome_check CHECK (outcome IN
        ('success','bad_password','unknown_email','locked','captcha_required',
         'rate_limited','credential_conflict'))
);
CREATE INDEX IF NOT EXISTS guest_shop_access_attempts_ip_idx
    ON public.guest_shop_access_attempts (request_ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS guest_shop_access_attempts_contact_idx
    ON public.guest_shop_access_attempts (contact_hash, created_at DESC);

COMMENT ON TABLE public.guest_shop_access_attempts IS
    'Guest credential login attempts. 30-day retention, purge job is operator-scheduled and not created by migration.';

-- ---------------------------------------------------------------------------
-- 2b. Row Level Security + privileges for the two new tables.
--
--     This is the single most security-critical statement in the file.
--     Supabase installs ALTER DEFAULT PRIVILEGES that grant ALL on every new
--     public table to anon and authenticated, so WITHOUT the REVOKE below the
--     scrypt password hashes and the contact-hash index would be readable by
--     any anonymous browser through PostgREST. RLS alone is not enough, and
--     REVOKE alone is not enough: both are applied, exactly as 20260913 does
--     for guest_shop_orders.
--
--     There are deliberately NO browser-facing policies and no SELECT grant to
--     authenticated. Guest order access is served exclusively by the server
--     handlers using the service role (which bypasses RLS), and the admin
--     surface (A3) also goes through those handlers. If an admin view over
--     guest_shop_buyers is ever added it must be security_invoker=on plus an
--     explicit public.is_admin() SELECT policy, and it must never expose
--     password_hash.
-- ---------------------------------------------------------------------------
ALTER TABLE public.guest_shop_buyers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_shop_access_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.guest_shop_buyers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.guest_shop_access_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.guest_shop_buyers TO service_role;
GRANT ALL ON TABLE public.guest_shop_access_attempts TO service_role;

-- ---------------------------------------------------------------------------
-- 3. guest_shop_orders.buyer_id
--    Access control only. Promotion quota counting MUST use the existing
--    buyer_contact_hash column across all credential groups of that email,
--    never buyer_id: counting by buyer_id would let an attacker refresh their
--    promo allowance simply by allocating another credential group.
-- ---------------------------------------------------------------------------
ALTER TABLE public.guest_shop_orders
    ADD COLUMN IF NOT EXISTS buyer_id UUID
        REFERENCES public.guest_shop_buyers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS guest_shop_orders_buyer_idx
    ON public.guest_shop_orders (buyer_id, created_at DESC);

COMMENT ON COLUMN public.guest_shop_orders.buyer_id IS
    'Credential group that owns this order (access control). Promotion quota must count by buyer_contact_hash across groups, NOT by this column.';

-- Historical rows keep buyer_id NULL and stay reachable through the existing
-- claim-secret path (/api/shop/guest/recover). No backfill, no NOT NULL.

-- ---------------------------------------------------------------------------
-- 4. Replace fn_guest_shop_create_order so it can persist buyer_id atomically
--    with the order INSERT. Exact-signature DROP, no CASCADE.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fn_guest_shop_create_order(
    TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER
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
    p_buyer_id UUID DEFAULT NULL,
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
    v_buyer_id UUID;
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
    v_currency := 'CNY';

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

    -- Order Access 2.0 (§6.4): buyer_id is an ACCESS-CONTROL key, never a
    -- pricing or quota input. It must be bound to the same site and the same
    -- contact hash as this order, so a caller can never attach an order to
    -- somebody else's credential group and later read their card secrets.
    -- Fail closed: a buyer_id without a matching contact hash is rejected,
    -- not silently ignored.
    IF p_buyer_id IS NOT NULL THEN
        IF p_buyer_contact_hash IS NULL OR p_buyer_contact_hash !~ '^[0-9a-f]{64}$' THEN
            RAISE EXCEPTION 'guest_buyer_contact_required';
        END IF;
        SELECT b.id INTO v_buyer_id
        FROM public.guest_shop_buyers b
        WHERE b.id = p_buyer_id
          AND b.site = v_site
          AND b.contact_hash = p_buyer_contact_hash;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'guest_buyer_mismatch';
        END IF;
    ELSE
        v_buyer_id := NULL;
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

    v_unit_amount := public.guest_shop_resolve_credit_unit_amount(
        v_site,
        v_sku.price_points,
        v_sku.price_points_intl,
        COALESCE(v_sku.is_default, false),
        v_sku.quantity_rules,
        v_sku.quantity_rules_intl,
        v_product.quantity_rules,
        v_product.quantity_rules_intl,
        v_product.flash_sale_price,
        v_product.flash_sale_price_intl,
        v_product.flash_sale_end,
        v_product.flash_sale_end_intl,
        1,
        v_now
    );
    IF v_unit_amount IS NULL
       OR LOWER(v_unit_amount::TEXT) IN ('nan', 'infinity', '-infinity')
       OR v_unit_amount <= 0
       OR v_unit_amount <> ROUND(v_unit_amount, 2) THEN
        RAISE EXCEPTION 'guest_credit_price_unavailable';
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
        claim_secret_version, buyer_contact_hash, buyer_id, request_ip_hash,
        request_device_hash, expires_at, metadata
    ) VALUES (
        v_order_id, v_order_no, v_key, v_fingerprint, 'website_guest',
        v_site, v_currency, v_product.id, v_sku.id,
        COALESCE(NULLIF(BTRIM(v_product.name), ''), 'Product'),
        COALESCE(NULLIF(BTRIM(v_sku.sku_name), ''), 'Default'),
        v_delivery_type, COALESCE(v_product.manual_delivery, false),
        COALESCE(v_sku.manual_delivery, false),
        1, v_unit_amount, v_unit_amount, 'pending', 'held', 'pending', 'none',
        p_claim_secret_hash, 1, p_buyer_contact_hash, v_buyer_id, p_request_ip_hash,
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

-- Re-apply grants on the NEW signature: the exact-signature DROP above removed
-- the old function together with its ACL, and Postgres does not inherit grants
-- across a signature change. Same convention as 20260913/20260915.
REVOKE ALL ON FUNCTION public.fn_guest_shop_create_order(TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guest_shop_create_order(TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Operator notes (read before running the historical verify scripts)
--
--    a) The exact-signature DROP in section 4 removes the 12-parameter
--       fn_guest_shop_create_order created by 20260915. Historical verify
--       scripts that resolve the function with that identity
--       (20260913_verify_guest_shop_atomic_rpcs.sql,
--        20260914_verify_guest_shop_admin_ops.sql,
--        20260915_verify_guest_shop_credit_pricing.sql)
--       will therefore report FAIL for `target_functions_present` once this
--       file has been applied. That is expected and is NOT a regression:
--       20260920_verify_guest_shop_buyer_credentials.sql is the authoritative
--       post-migration check for the 13-parameter signature. Do not "fix" it by
--       re-running an old migration; that would recreate the ambiguous
--       overload and break every named-parameter RPC call.
--    b) guest_shop_orders.order_no is already globally UNIQUE
--       (20260913_add_guest_shop_cash_purchase.sql:110), so the
--       (buyer_id, order_no) unique index sketched in the design doc is
--       redundant and is intentionally omitted here.
--    c) No row of guest_shop_orders is modified by this file. buyer_id stays
--       NULL for every existing order, which keeps the claim-secret recovery
--       path (/api/shop/guest/recover) as the only way to reach them until
--       §13.2 self-service upgrade ships.
--    d) The 30-day purge job for guest_shop_access_attempts is NOT created
--       here. Scheduling operator work is out of scope for a migration and must
--       never be turned on by a deploy.
-- ---------------------------------------------------------------------------
