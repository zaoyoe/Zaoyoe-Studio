-- Treat SKU site prices as explicit sale switches.
-- If a SKU has no price for the requested site, it must not inherit another
-- site's SKU/product price and must not be purchasable.

DO $$
DECLARE
    v_definition TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.fn_create_marketplace_shop_order(uuid,integer,text,text,text,jsonb,character varying,uuid,numeric,numeric,text,text,uuid)'::regprocedure
    )
    INTO v_definition;

    IF v_definition IS NOT NULL THEN
        v_definition := REPLACE(
            v_definition,
            'v_unit_price := CASE' || E'\n        WHEN v_site = ''intl'' THEN COALESCE(v_sku.price_points_intl, v_product.price_points_intl, v_sku.price_points, v_product.price_points, 0)' || E'\n        ELSE COALESCE(v_sku.price_points, v_product.price_points, 0)' || E'\n    END;' || E'\n    v_price_paid :=',
            'v_unit_price := CASE' || E'\n        WHEN v_site = ''intl'' THEN v_sku.price_points_intl' || E'\n        ELSE v_sku.price_points' || E'\n    END;' || E'\n' || E'\n    IF v_unit_price IS NULL THEN' || E'\n        RETURN jsonb_build_object(''success'', false, ''message'', ''product sku is not sold on current site'');' || E'\n    END IF;' || E'\n' || E'\n    v_price_paid :='
        );

        IF POSITION('product sku is not sold on current site' IN v_definition) = 0 THEN
            RAISE EXCEPTION 'failed to patch fn_create_marketplace_shop_order with site-scoped SKU prices';
        END IF;

        EXECUTE v_definition;
    END IF;
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

    v_definition := REPLACE(
        v_definition,
        'v_base_unit_price := COALESCE(v_sku.price_points_intl, v_product.price_points_intl, v_sku.price_points, v_product.price_points);',
        'v_base_unit_price := v_sku.price_points_intl;'
    );
    v_definition := REPLACE(
        v_definition,
        'v_base_unit_price := COALESCE(v_sku.price_points, v_product.price_points);',
        'v_base_unit_price := v_sku.price_points;'
    );

    IF POSITION('v_base_unit_price := COALESCE(v_sku.price_points_intl, v_product.price_points_intl, v_sku.price_points, v_product.price_points);' IN v_definition) > 0 THEN
        RAISE EXCEPTION 'failed to remove intl SKU price fallback from fn_validate_discount_code_core';
    END IF;
    IF POSITION('v_base_unit_price := COALESCE(v_sku.price_points, v_product.price_points);' IN v_definition) > 0 THEN
        RAISE EXCEPTION 'failed to remove cn SKU price fallback from fn_validate_discount_code_core';
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

    v_definition := REPLACE(
        v_definition,
        'v_base_unit_price := COALESCE(v_sku.price_points_intl, v_product.price_points_intl, v_sku.price_points, v_product.price_points);',
        'v_base_unit_price := v_sku.price_points_intl;'
    );
    v_definition := REPLACE(
        v_definition,
        'v_base_unit_price := COALESCE(v_sku.price_points, v_product.price_points);',
        'v_base_unit_price := v_sku.price_points;'
    );

    IF POSITION('v_base_unit_price := COALESCE(v_sku.price_points_intl, v_product.price_points_intl, v_sku.price_points, v_product.price_points);' IN v_definition) > 0 THEN
        RAISE EXCEPTION 'failed to remove intl SKU price fallback from fn_purchase_shop_item_core';
    END IF;
    IF POSITION('v_base_unit_price := COALESCE(v_sku.price_points, v_product.price_points);' IN v_definition) > 0 THEN
        RAISE EXCEPTION 'failed to remove cn SKU price fallback from fn_purchase_shop_item_core';
    END IF;

    EXECUTE v_definition;
END;
$$;
