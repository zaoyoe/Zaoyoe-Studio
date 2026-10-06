-- Scheduled flash-sale start times for CN and INTL shop pricing.
-- Codex does not execute this file. Apply it in the target Supabase SQL editor,
-- then run 20260923_verify_shop_flash_sale_start.sql and require every check to pass.
--
-- NULL start is deliberately backward compatible and means the existing
-- immediate-start behavior. When a start is configured, the price is active
-- only while start <= the server clock < end. Before the start, the existing
-- quantity-tier price path remains in effect. An INTL price or end selects the
-- INTL field group; an incomplete group cannot activate a flash sale and falls
-- through to INTL tiers. CN fallback applies only when both INTL fields are unset.

ALTER TABLE public.shop_products
    ADD COLUMN IF NOT EXISTS flash_sale_start TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS flash_sale_start_intl TIMESTAMPTZ;

COMMENT ON COLUMN public.shop_products.flash_sale_start IS
    'Optional CN flash-sale start. NULL preserves immediate activation; when set, flash_sale_end must be later.';
COMMENT ON COLUMN public.shop_products.flash_sale_start_intl IS
    'Optional INTL flash-sale start. NULL preserves immediate activation; when set, flash_sale_end_intl must be later.';

DO $constraints$
DECLARE
    v_expected_definition TEXT;
    v_existing_definition TEXT;
    v_is_validated BOOLEAN;
BEGIN
    -- Build the expected definition through PostgreSQL's own deparser so an
    -- existing same-named but weaker/different check cannot pass as idempotent.
    CREATE TEMP TABLE shop_flash_sale_constraint_expected (
        flash_sale_start TIMESTAMPTZ,
        flash_sale_price NUMERIC(12,2),
        flash_sale_end TIMESTAMPTZ,
        flash_sale_start_intl TIMESTAMPTZ,
        flash_sale_price_intl NUMERIC(12,2),
        flash_sale_end_intl TIMESTAMPTZ,
        CONSTRAINT shop_products_flash_sale_window_check CHECK (
            (flash_sale_start IS NULL OR (
                flash_sale_price IS NOT NULL
                AND flash_sale_end IS NOT NULL
                AND flash_sale_start < flash_sale_end
            ))
            AND
            (flash_sale_start_intl IS NULL OR (
                flash_sale_price_intl IS NOT NULL
                AND flash_sale_end_intl IS NOT NULL
                AND flash_sale_start_intl < flash_sale_end_intl
            ))
        )
    ) ON COMMIT DROP;

    SELECT pg_get_constraintdef(c.oid, false)
      INTO v_expected_definition
      FROM pg_constraint c
     WHERE c.conrelid = 'pg_temp.shop_flash_sale_constraint_expected'::regclass
       AND c.conname = 'shop_products_flash_sale_window_check';

    SELECT pg_get_constraintdef(c.oid, false), c.convalidated
      INTO v_existing_definition, v_is_validated
      FROM pg_constraint c
     WHERE c.conrelid = 'public.shop_products'::regclass
       AND c.conname = 'shop_products_flash_sale_window_check';

    IF v_existing_definition IS NULL THEN
        ALTER TABLE public.shop_products
            ADD CONSTRAINT shop_products_flash_sale_window_check CHECK (
                (flash_sale_start IS NULL OR (
                    flash_sale_price IS NOT NULL
                    AND flash_sale_end IS NOT NULL
                    AND flash_sale_start < flash_sale_end
                ))
                AND
                (flash_sale_start_intl IS NULL OR (
                    flash_sale_price_intl IS NOT NULL
                    AND flash_sale_end_intl IS NOT NULL
                    AND flash_sale_start_intl < flash_sale_end_intl
                ))
            ) NOT VALID;
        v_existing_definition := v_expected_definition;
        v_is_validated := false;
    ELSIF v_existing_definition <> v_expected_definition THEN
        RAISE EXCEPTION 'shop_products_flash_sale_window_check exists with an unexpected definition: %',
            v_existing_definition;
    END IF;

    IF NOT COALESCE(v_is_validated, false) THEN
        ALTER TABLE public.shop_products
            VALIDATE CONSTRAINT shop_products_flash_sale_window_check;
    END IF;

    DROP TABLE shop_flash_sale_constraint_expected;
END;
$constraints$;

-- The rewrite helper is session-local. It refuses missing or ambiguous source
-- fragments so this migration cannot silently install a partial pricing patch.
CREATE OR REPLACE FUNCTION pg_temp.shop_flash_sale_replace_once(
    p_source TEXT,
    p_old TEXT,
    p_new TEXT,
    p_label TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
AS $replace$
DECLARE
    v_old_only_source TEXT;
    v_old_only_count INTEGER;
    v_new_count INTEGER;
BEGIN
    IF p_source IS NULL OR p_old IS NULL OR p_old = '' OR p_new IS NULL OR p_new = '' THEN
        RAISE EXCEPTION 'flash_sale_start migration has an empty source or replacement fragment: %', p_label;
    END IF;

    v_new_count := (length(p_source) - length(replace(p_source, p_new, ''))) / length(p_new);
    -- The new fragment often contains the old fragment as a prefix. Remove
    -- complete patched fragments before counting any remaining old matches.
    v_old_only_source := replace(p_source, p_new, '');
    v_old_only_count := (length(v_old_only_source) - length(replace(v_old_only_source, p_old, ''))) / length(p_old);

    IF v_new_count = 1 AND v_old_only_count = 0 THEN
        RETURN p_source;
    ELSIF v_old_only_count = 1 AND v_new_count = 0 THEN
        RETURN replace(p_source, p_old, p_new);
    END IF;

    RAISE EXCEPTION
        'flash_sale_start migration expected exactly one old fragment or one new fragment for %; old_remaining=%, new=%',
        p_label, v_old_only_count, v_new_count;
END;
$replace$;

CREATE OR REPLACE FUNCTION pg_temp.shop_flash_sale_replace_signature_once(
    p_source TEXT,
    p_pattern TEXT,
    p_patched_pattern TEXT,
    p_replacement TEXT,
    p_label TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
AS $replace$
DECLARE
    v_old_only_source TEXT;
    v_old_count INTEGER;
    v_new_count INTEGER;
BEGIN
    IF p_source IS NULL OR p_pattern IS NULL OR p_pattern = ''
       OR p_patched_pattern IS NULL OR p_patched_pattern = '' OR p_replacement IS NULL THEN
        RAISE EXCEPTION 'flash_sale_start migration has an empty signature pattern: %', p_label;
    END IF;

    SELECT COUNT(*) INTO v_new_count
    FROM regexp_matches(p_source, p_patched_pattern, 'gi');
    v_old_only_source := regexp_replace(p_source, p_patched_pattern, '', 'gi');
    SELECT COUNT(*) INTO v_old_count
    FROM regexp_matches(v_old_only_source, p_pattern, 'gi');

    IF v_new_count = 1 AND v_old_count = 0 THEN
        RETURN p_source;
    ELSIF v_old_count = 1 AND v_new_count = 0 THEN
        RETURN regexp_replace(p_source, p_pattern, p_replacement, 'i');
    END IF;

    RAISE EXCEPTION
        'flash_sale_start migration expected one old or patched signature for %; old_remaining=%, patched=%',
        p_label, v_old_count, v_new_count;
END;
$replace$;

DO $functions$
DECLARE
    v_definition TEXT;
BEGIN
    -- Discount preview and final logged-in purchase must use the same scheduled
    -- window. pg_get_functiondef keeps the already-installed stock, entitlement,
    -- discount, and accounting logic intact; only the listed pricing fragments
    -- are amended.
    v_definition := pg_get_functiondef(
        'public.fn_validate_discount_code_core(uuid, uuid, character varying, integer, character varying, uuid, uuid)'::regprocedure
    );
    v_definition := pg_temp.shop_flash_sale_replace_once(
        v_definition,
        'v_effective_flash_sale_end TIMESTAMPTZ := NULL;',
        E'v_effective_flash_sale_end TIMESTAMPTZ := NULL;\n    v_effective_flash_sale_start TIMESTAMPTZ := NULL;',
        'discount preview start variable'
    );
    v_definition := pg_temp.shop_flash_sale_replace_once(
        v_definition,
        E'flash_sale_end_intl,\n        flash_sale_price,',
        E'flash_sale_end_intl,\n        flash_sale_start,\n        flash_sale_start_intl,\n        flash_sale_price,',
        'discount preview selected columns'
    );
    v_definition := pg_temp.shop_flash_sale_replace_once(
        v_definition,
        E'v_effective_flash_sale_end := v_product.flash_sale_end_intl;\n        v_effective_flash_sale_price := v_product.flash_sale_price_intl;',
        E'v_effective_flash_sale_end := v_product.flash_sale_end_intl;\n        v_effective_flash_sale_start := v_product.flash_sale_start_intl;\n        v_effective_flash_sale_price := v_product.flash_sale_price_intl;\n        IF v_effective_flash_sale_price IS NULL AND v_effective_flash_sale_end IS NULL THEN\n            v_effective_flash_sale_end := v_product.flash_sale_end;\n            v_effective_flash_sale_start := v_product.flash_sale_start;\n            v_effective_flash_sale_price := v_product.flash_sale_price;\n        END IF;',
        'discount preview INTL schedule'
    );
    v_definition := pg_temp.shop_flash_sale_replace_once(
        v_definition,
        E'v_effective_flash_sale_end := v_product.flash_sale_end;\n        v_effective_flash_sale_price := v_product.flash_sale_price;',
        E'v_effective_flash_sale_end := v_product.flash_sale_end;\n        v_effective_flash_sale_start := v_product.flash_sale_start;\n        v_effective_flash_sale_price := v_product.flash_sale_price;',
        'discount preview CN schedule'
    );
    v_definition := pg_temp.shop_flash_sale_replace_once(
        v_definition,
        'AND v_effective_flash_sale_price IS NOT NULL THEN',
        E'AND v_effective_flash_sale_price IS NOT NULL\n        AND (v_effective_flash_sale_start IS NULL OR v_effective_flash_sale_start <= clock_timestamp()) THEN',
        'discount preview active window'
    );
    EXECUTE v_definition;

    v_definition := pg_get_functiondef(
        'public.fn_purchase_shop_item_core(uuid, uuid, character varying, integer, character varying, uuid, uuid)'::regprocedure
    );
    v_definition := pg_temp.shop_flash_sale_replace_once(
        v_definition,
        'v_effective_flash_sale_end TIMESTAMPTZ := NULL;',
        E'v_effective_flash_sale_end TIMESTAMPTZ := NULL;\n    v_effective_flash_sale_start TIMESTAMPTZ := NULL;',
        'purchase start variable'
    );
    v_definition := pg_temp.shop_flash_sale_replace_once(
        v_definition,
        E'flash_sale_end_intl,\n        flash_sale_price,',
        E'flash_sale_end_intl,\n        flash_sale_start,\n        flash_sale_start_intl,\n        flash_sale_price,',
        'purchase selected columns'
    );
    v_definition := pg_temp.shop_flash_sale_replace_once(
        v_definition,
        E'v_effective_flash_sale_end := v_product.flash_sale_end_intl;\n        v_effective_flash_sale_price := v_product.flash_sale_price_intl;',
        E'v_effective_flash_sale_end := v_product.flash_sale_end_intl;\n        v_effective_flash_sale_start := v_product.flash_sale_start_intl;\n        v_effective_flash_sale_price := v_product.flash_sale_price_intl;\n        IF v_effective_flash_sale_price IS NULL AND v_effective_flash_sale_end IS NULL THEN\n            v_effective_flash_sale_end := v_product.flash_sale_end;\n            v_effective_flash_sale_start := v_product.flash_sale_start;\n            v_effective_flash_sale_price := v_product.flash_sale_price;\n        END IF;',
        'purchase INTL schedule'
    );
    v_definition := pg_temp.shop_flash_sale_replace_once(
        v_definition,
        E'v_effective_flash_sale_end := v_product.flash_sale_end;\n        v_effective_flash_sale_price := v_product.flash_sale_price;',
        E'v_effective_flash_sale_end := v_product.flash_sale_end;\n        v_effective_flash_sale_start := v_product.flash_sale_start;\n        v_effective_flash_sale_price := v_product.flash_sale_price;',
        'purchase CN schedule'
    );
    v_definition := pg_temp.shop_flash_sale_replace_once(
        v_definition,
        'AND v_effective_flash_sale_price IS NOT NULL THEN',
        E'AND v_effective_flash_sale_price IS NOT NULL\n        AND (v_effective_flash_sale_start IS NULL OR v_effective_flash_sale_start <= clock_timestamp()) THEN',
        'purchase active window'
    );
    EXECUTE v_definition;

    -- Add a versioned resolver rather than changing/dropping the 14-argument
    -- helper. Existing read-only verification files and callers remain valid;
    -- the current order-creation authority is explicitly switched to this v2.
    v_definition := pg_get_functiondef(
        'public.guest_shop_resolve_credit_unit_amount(text, numeric, numeric, boolean, jsonb, jsonb, jsonb, jsonb, numeric, numeric, timestamp with time zone, timestamp with time zone, integer, timestamp with time zone)'::regprocedure
    );
    v_definition := pg_temp.shop_flash_sale_replace_once(
        v_definition,
        'CREATE OR REPLACE FUNCTION public.guest_shop_resolve_credit_unit_amount(',
        'CREATE OR REPLACE FUNCTION public.guest_shop_resolve_credit_unit_amount_with_start(',
        'guest resolver name'
    );
    v_definition := pg_temp.shop_flash_sale_replace_signature_once(
        v_definition,
        'p_quantity[[:space:]]+integer,[[:space:]]+p_now[[:space:]]+timestamp with time zone[[:space:]]*\)',
        'p_quantity[[:space:]]+integer,[[:space:]]+p_now[[:space:]]+timestamp with time zone,[[:space:]]+p_product_flash_sale_start[[:space:]]+timestamp with time zone,[[:space:]]+p_product_flash_sale_start_intl[[:space:]]+timestamp with time zone[[:space:]]*\)',
        E'p_quantity INTEGER,\n    p_now TIMESTAMP WITH TIME ZONE,\n    p_product_flash_sale_start TIMESTAMP WITH TIME ZONE,\n    p_product_flash_sale_start_intl TIMESTAMP WITH TIME ZONE\n)',
        'guest resolver signature'
    );
    v_definition := pg_temp.shop_flash_sale_replace_once(
        v_definition,
        'v_flash_end TIMESTAMP WITH TIME ZONE;',
        E'v_flash_end TIMESTAMP WITH TIME ZONE;\n    v_flash_start TIMESTAMP WITH TIME ZONE;',
        'guest resolver start variable'
    );
    v_definition := pg_temp.shop_flash_sale_replace_once(
        v_definition,
        E'v_has_intl_flash := p_product_flash_sale_price_intl IS NOT NULL\n            OR p_product_flash_sale_end_intl IS NOT NULL;',
        E'v_has_intl_flash := p_product_flash_sale_price_intl IS NOT NULL\n            OR p_product_flash_sale_end_intl IS NOT NULL;',
        'guest resolver INTL schedule boundary'
    );
    v_definition := pg_temp.shop_flash_sale_replace_once(
        v_definition,
        E'v_flash_price := p_product_flash_sale_price_intl;\n            v_flash_end := p_product_flash_sale_end_intl;',
        E'v_flash_price := p_product_flash_sale_price_intl;\n            v_flash_end := p_product_flash_sale_end_intl;\n            v_flash_start := p_product_flash_sale_start_intl;',
        'guest resolver INTL schedule'
    );
    v_definition := pg_temp.shop_flash_sale_replace_once(
        v_definition,
        E'v_flash_price := p_product_flash_sale_price;\n            v_flash_end := p_product_flash_sale_end;',
        E'v_flash_price := p_product_flash_sale_price;\n            v_flash_end := p_product_flash_sale_end;\n            v_flash_start := p_product_flash_sale_start;',
        'guest resolver CN fallback schedule'
    );
    v_definition := pg_temp.shop_flash_sale_replace_once(
        v_definition,
        E'v_flash_price := p_product_flash_sale_price;\n        v_flash_end := p_product_flash_sale_end;',
        E'v_flash_price := p_product_flash_sale_price;\n        v_flash_end := p_product_flash_sale_end;\n        v_flash_start := p_product_flash_sale_start;',
        'guest resolver CN schedule'
    );
    v_definition := pg_temp.shop_flash_sale_replace_once(
        v_definition,
        'AND v_flash_price IS NOT NULL',
        E'AND v_flash_price IS NOT NULL\n       AND (v_flash_start IS NULL OR v_flash_start <= v_now)',
        'guest resolver active window'
    );
    EXECUTE v_definition;

    -- The create-order function already locks and reads the complete product
    -- row. Only its price authority call changes; all order, coupon, quota,
    -- inventory, payment, and identity logic remains the installed version.
    v_definition := pg_get_functiondef(
        'public.fn_guest_shop_create_order(text, uuid, uuid, text, text, text, text, text, text, uuid, text, text, integer, integer, text)'::regprocedure
    );
    v_definition := pg_temp.shop_flash_sale_replace_once(
        v_definition,
        'v_unit_amount := public.guest_shop_resolve_credit_unit_amount(',
        'v_unit_amount := public.guest_shop_resolve_credit_unit_amount_with_start(',
        'guest order resolver call'
    );
    v_definition := pg_temp.shop_flash_sale_replace_once(
        v_definition,
        E'        v_quantity,\n        v_now\n    );',
        E'        v_quantity,\n        v_now,\n        v_product.flash_sale_start,\n        v_product.flash_sale_start_intl\n    );',
        'guest order scheduled start arguments'
    );
    EXECUTE v_definition;
END;
$functions$;

REVOKE ALL ON FUNCTION public.guest_shop_resolve_credit_unit_amount_with_start(
    TEXT, NUMERIC, NUMERIC, BOOLEAN, JSONB, JSONB, JSONB, JSONB,
    NUMERIC, NUMERIC, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_shop_resolve_credit_unit_amount_with_start(
    TEXT, NUMERIC, NUMERIC, BOOLEAN, JSONB, JSONB, JSONB, JSONB,
    NUMERIC, NUMERIC, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ
) TO service_role;

DROP FUNCTION pg_temp.shop_flash_sale_replace_once(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION pg_temp.shop_flash_sale_replace_signature_once(TEXT, TEXT, TEXT, TEXT, TEXT);
