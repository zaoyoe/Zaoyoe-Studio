-- Guest shop INTL credit-price fallback onto CN SKU points.
-- Codex does not execute this file. Run it in the target Supabase SQL editor
-- only after the matching code/tests are complete. This migration is additive:
-- it CREATE OR REPLACE the existing helper with the same identity arguments,
-- does not DROP tables, does not CASCADE, does not rollback 20260913/14/15,
-- and does not enable guest products.
--
-- Product rule: catalog and settlement stay CNY on both sites. Prefer INTL
-- SKU credit/tier/flash when present and > 0; otherwise reuse the CN SKU
-- credit/qty=1/flash. Never fall back to product list prices or leftover
-- guest cash columns.

CREATE OR REPLACE FUNCTION public.guest_shop_resolve_credit_unit_amount(
    p_site TEXT,
    p_sku_price_points NUMERIC,
    p_sku_price_points_intl NUMERIC,
    p_sku_is_default BOOLEAN,
    p_sku_quantity_rules JSONB,
    p_sku_quantity_rules_intl JSONB,
    p_product_quantity_rules JSONB,
    p_product_quantity_rules_intl JSONB,
    p_product_flash_sale_price NUMERIC,
    p_product_flash_sale_price_intl NUMERIC,
    p_product_flash_sale_end TIMESTAMP WITH TIME ZONE,
    p_product_flash_sale_end_intl TIMESTAMP WITH TIME ZONE,
    p_quantity INTEGER,
    p_now TIMESTAMP WITH TIME ZONE
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_site TEXT := LOWER(BTRIM(COALESCE(p_site, '')));
    v_base NUMERIC;
    v_rules JSONB;
    v_flash_price NUMERIC;
    v_flash_end TIMESTAMP WITH TIME ZONE;
    v_now TIMESTAMP WITH TIME ZONE := COALESCE(p_now, clock_timestamp());
    v_rule JSONB;
    v_rule_qty INTEGER;
    v_rule_price NUMERIC;
    v_result NUMERIC(14,2);
    v_cn_rules JSONB;
    v_intl_rules JSONB;
    v_has_intl_flash BOOLEAN;
BEGIN
    IF v_site NOT IN ('cn', 'intl') THEN
        RETURN NULL;
    END IF;
    IF p_quantity IS DISTINCT FROM 1 THEN
        RETURN NULL;
    END IF;

    v_cn_rules := COALESCE(
        p_sku_quantity_rules,
        CASE
            WHEN p_sku_is_default IS TRUE THEN p_product_quantity_rules
            ELSE NULL
        END
    );
    v_intl_rules := COALESCE(
        p_sku_quantity_rules_intl,
        CASE
            WHEN p_sku_is_default IS TRUE THEN p_product_quantity_rules_intl
            ELSE NULL
        END
    );

    IF v_site = 'intl' THEN
        -- intl_missing_points_reuse_cn
        v_base := p_sku_price_points_intl;
        IF v_base IS NULL
           OR LOWER(v_base::TEXT) IN ('nan', 'infinity', '-infinity')
           OR v_base <= 0 THEN
            v_base := p_sku_price_points;
        END IF;
        v_rules := COALESCE(v_intl_rules, v_cn_rules);
        v_has_intl_flash := p_product_flash_sale_price_intl IS NOT NULL
            OR p_product_flash_sale_end_intl IS NOT NULL;
        IF v_has_intl_flash THEN
            v_flash_price := p_product_flash_sale_price_intl;
            v_flash_end := p_product_flash_sale_end_intl;
        ELSE
            v_flash_price := p_product_flash_sale_price;
            v_flash_end := p_product_flash_sale_end;
        END IF;
    ELSE
        v_base := p_sku_price_points;
        v_rules := v_cn_rules;
        v_flash_price := p_product_flash_sale_price;
        v_flash_end := p_product_flash_sale_end;
    END IF;

    IF v_base IS NULL
       OR LOWER(v_base::TEXT) IN ('nan', 'infinity', '-infinity')
       OR v_base <= 0 THEN
        RETURN NULL;
    END IF;

    IF v_flash_end IS NOT NULL
       AND v_flash_end > v_now
       AND v_flash_price IS NOT NULL
       AND LOWER(v_flash_price::TEXT) NOT IN ('nan', 'infinity', '-infinity') THEN
        v_base := LEAST(v_base, v_flash_price);
    ELSIF v_rules IS NOT NULL
          AND jsonb_typeof(v_rules) = 'array'
          AND jsonb_array_length(v_rules) > 0 THEN
        FOR v_rule IN SELECT * FROM jsonb_array_elements(v_rules)
        LOOP
            v_rule_qty := NULL;
            v_rule_price := NULL;
            BEGIN
                v_rule_qty := (v_rule->>'qty')::INTEGER;
                v_rule_price := COALESCE(NULLIF(BTRIM(COALESCE(v_rule->>'price', '')), ''), '0')::NUMERIC;
            EXCEPTION WHEN OTHERS THEN
                v_rule_qty := NULL;
                v_rule_price := NULL;
            END;
            IF v_rule_qty IS NOT NULL
               AND v_rule_qty >= 1
               AND p_quantity >= v_rule_qty
               AND v_rule_price IS NOT NULL
               AND LOWER(v_rule_price::TEXT) NOT IN ('nan', 'infinity', '-infinity')
               AND v_rule_price < v_base THEN
                v_base := v_rule_price;
            END IF;
        END LOOP;
    END IF;

    IF v_base IS NULL
       OR LOWER(v_base::TEXT) IN ('nan', 'infinity', '-infinity')
       OR v_base <= 0 THEN
        RETURN NULL;
    END IF;

    v_result := ROUND(v_base, 2);
    IF v_result IS NULL OR v_result <= 0 THEN
        RETURN NULL;
    END IF;
    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.guest_shop_resolve_credit_unit_amount(TEXT, NUMERIC, NUMERIC, BOOLEAN, JSONB, JSONB, JSONB, JSONB, NUMERIC, NUMERIC, TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, INTEGER, TIMESTAMP WITH TIME ZONE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guest_shop_resolve_credit_unit_amount(TEXT, NUMERIC, NUMERIC, BOOLEAN, JSONB, JSONB, JSONB, JSONB, NUMERIC, NUMERIC, TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, INTEGER, TIMESTAMP WITH TIME ZONE) TO service_role;
