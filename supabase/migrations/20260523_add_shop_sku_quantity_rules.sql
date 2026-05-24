-- Add SKU-level tiered pricing.
-- Product-level quantity_rules remain as a compatibility default for the default SKU.

ALTER TABLE public.shop_product_skus
    ADD COLUMN IF NOT EXISTS quantity_rules JSONB,
    ADD COLUMN IF NOT EXISTS quantity_rules_intl JSONB;

UPDATE public.shop_product_skus s
SET
    quantity_rules = COALESCE(s.quantity_rules, p.quantity_rules),
    quantity_rules_intl = COALESCE(s.quantity_rules_intl, p.quantity_rules_intl)
FROM public.shop_products p
WHERE s.product_id = p.id
  AND s.is_default = true;

CREATE OR REPLACE FUNCTION public.fn_shop_products_ensure_default_sku()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.shop_product_skus (
        product_id,
        sku_code,
        sku_name,
        spec_values,
        price_points,
        price_points_intl,
        quantity_rules,
        quantity_rules_intl,
        is_default,
        is_active,
        sort_order
    )
    VALUES (
        NEW.id,
        'default',
        COALESCE(NULLIF(BTRIM(NEW.name), ''), '默认规格'),
        jsonb_build_object('label', '默认规格'),
        NEW.price_points,
        NEW.price_points_intl,
        NEW.quantity_rules,
        NEW.quantity_rules_intl,
        true,
        true,
        0
    )
    ON CONFLICT DO NOTHING;

    RETURN NEW;
END;
$$;

DO $$
DECLARE
    v_definition TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.fn_validate_discount_code_core(uuid,uuid,character varying,integer,character varying,uuid,uuid)'::regprocedure
    )
    INTO v_definition;

    IF v_definition IS NULL THEN
        RAISE EXCEPTION 'fn_validate_discount_code_core is missing; run 20260523_add_shop_product_skus.sql first';
    END IF;

    IF POSITION('v_sku_is_default BOOLEAN := false;' IN v_definition) = 0 THEN
        v_definition := REPLACE(
            v_definition,
            'v_sku_id UUID := p_sku_id;' || E'\n    v_base_unit_price',
            'v_sku_id UUID := p_sku_id;' || E'\n    v_sku_is_default BOOLEAN := false;' || E'\n    v_base_unit_price'
        );
    END IF;

    IF POSITION('v_sku_is_default := COALESCE(v_sku.is_default, false);' IN v_definition) = 0 THEN
        v_definition := REPLACE(
            v_definition,
            'v_sku_id := v_sku.id;' || E'\n' || E'\n    IF NOT v_unlimited_shop_purchases THEN',
            'v_sku_id := v_sku.id;' || E'\n    v_sku_is_default := COALESCE(v_sku.is_default, false);' || E'\n' || E'\n    IF NOT v_unlimited_shop_purchases THEN'
        );
    END IF;

    v_definition := REPLACE(
        v_definition,
        'v_effective_quantity_rules := v_product.quantity_rules_intl;',
        'v_effective_quantity_rules := COALESCE(' || E'\n            v_sku.quantity_rules_intl,' || E'\n            CASE' || E'\n                WHEN v_sku_is_default THEN v_product.quantity_rules_intl' || E'\n                ELSE NULL' || E'\n            END' || E'\n        );'
    );

    v_definition := REPLACE(
        v_definition,
        'v_effective_quantity_rules := v_product.quantity_rules;',
        'v_effective_quantity_rules := COALESCE(' || E'\n            v_sku.quantity_rules,' || E'\n            CASE' || E'\n                WHEN v_sku_is_default THEN v_product.quantity_rules' || E'\n                ELSE NULL' || E'\n            END' || E'\n        );'
    );

    IF POSITION('v_sku.quantity_rules' IN v_definition) = 0
        OR POSITION('v_sku_is_default' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'failed to patch fn_validate_discount_code_core with SKU quantity rules';
    END IF;

    EXECUTE v_definition;
END;
$$;

DO $$
DECLARE
    v_definition TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.fn_purchase_shop_item_core(uuid,uuid,character varying,integer,character varying,uuid,uuid)'::regprocedure
    )
    INTO v_definition;

    IF v_definition IS NULL THEN
        RAISE EXCEPTION 'fn_purchase_shop_item_core is missing; run 20260523_add_shop_product_skus.sql first';
    END IF;

    IF POSITION('v_sku_is_default BOOLEAN := false;' IN v_definition) = 0 THEN
        v_definition := REPLACE(
            v_definition,
            'v_sku_id UUID := p_sku_id;' || E'\n    v_base_unit_price',
            'v_sku_id UUID := p_sku_id;' || E'\n    v_sku_is_default BOOLEAN := false;' || E'\n    v_base_unit_price'
        );
    END IF;

    IF POSITION('v_sku_is_default := COALESCE(v_sku.is_default, false);' IN v_definition) = 0 THEN
        v_definition := REPLACE(
            v_definition,
            'v_sku_id := v_sku.id;' || E'\n' || E'\n    IF NOT v_unlimited_shop_purchases THEN',
            'v_sku_id := v_sku.id;' || E'\n    v_sku_is_default := COALESCE(v_sku.is_default, false);' || E'\n' || E'\n    IF NOT v_unlimited_shop_purchases THEN'
        );
    END IF;

    v_definition := REPLACE(
        v_definition,
        'v_effective_quantity_rules := v_product.quantity_rules_intl;',
        'v_effective_quantity_rules := COALESCE(' || E'\n            v_sku.quantity_rules_intl,' || E'\n            CASE' || E'\n                WHEN v_sku_is_default THEN v_product.quantity_rules_intl' || E'\n                ELSE NULL' || E'\n            END' || E'\n        );'
    );

    v_definition := REPLACE(
        v_definition,
        'v_effective_quantity_rules := v_product.quantity_rules;',
        'v_effective_quantity_rules := COALESCE(' || E'\n            v_sku.quantity_rules,' || E'\n            CASE' || E'\n                WHEN v_sku_is_default THEN v_product.quantity_rules' || E'\n                ELSE NULL' || E'\n            END' || E'\n        );'
    );

    IF POSITION('v_sku.quantity_rules' IN v_definition) = 0
        OR POSITION('v_sku_is_default' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'failed to patch fn_purchase_shop_item_core with SKU quantity rules';
    END IF;

    EXECUTE v_definition;
END;
$$;
