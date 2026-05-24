-- Add optional SKU-level coupon scoping for product-scoped discounts.
-- NULL scope_product_sku_id keeps existing "all specs under this product" behavior.

ALTER TABLE public.discount_codes
    ADD COLUMN IF NOT EXISTS scope_product_sku_id UUID REFERENCES public.shop_product_skus(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_discount_codes_scope_product_sku_id
    ON public.discount_codes (scope_product_sku_id)
    WHERE scope_product_sku_id IS NOT NULL;

ALTER TABLE public.discount_codes
    DROP CONSTRAINT IF EXISTS discount_codes_scope_target_check;

ALTER TABLE public.discount_codes
    ADD CONSTRAINT discount_codes_scope_target_check
    CHECK (
        (scope_type = 'all' AND scope_category IS NULL AND scope_product_id IS NULL AND scope_product_sku_id IS NULL)
        OR (scope_type = 'category' AND scope_category IS NOT NULL AND scope_product_id IS NULL AND scope_product_sku_id IS NULL)
        OR (scope_type = 'product' AND scope_category IS NULL AND scope_product_id IS NOT NULL)
    );

COMMENT ON COLUMN public.discount_codes.scope_product_sku_id IS 'Optional SKU restriction when scope_type=product; NULL means all SKUs under the scoped product.';

DO $$
DECLARE
    v_definition TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.fn_validate_discount_code_core(uuid,uuid,character varying,integer,character varying,uuid,uuid)'::regprocedure
    )
    INTO v_definition;

    IF v_definition IS NULL THEN
        RAISE EXCEPTION 'fn_validate_discount_code_core is missing; run SKU shop migrations first';
    END IF;

    IF POSITION('scope_product_sku_id' IN v_definition) = 0 THEN
        v_definition := REPLACE(
            v_definition,
            'IF COALESCE(v_discount_record.scope_type, ''all'') = ''product''' || E'\n        AND v_discount_record.scope_product_id IS DISTINCT FROM p_product_id THEN' || E'\n        RETURN jsonb_build_object(''success'', false, ''message'', ''该优惠码仅适用于指定商品'');' || E'\n    END IF;',
            'IF COALESCE(v_discount_record.scope_type, ''all'') = ''product''' || E'\n        AND v_discount_record.scope_product_id IS DISTINCT FROM p_product_id THEN' || E'\n        RETURN jsonb_build_object(''success'', false, ''message'', ''该优惠码仅适用于指定商品'');' || E'\n    END IF;' || E'\n' || E'\n    IF COALESCE(v_discount_record.scope_type, ''all'') = ''product''' || E'\n        AND v_discount_record.scope_product_sku_id IS NOT NULL' || E'\n        AND v_discount_record.scope_product_sku_id IS DISTINCT FROM v_sku_id THEN' || E'\n        RETURN jsonb_build_object(''success'', false, ''message'', ''该优惠码仅适用于指定商品规格'');' || E'\n    END IF;'
        );

        v_definition := REPLACE(
            v_definition,
            '''scope_product_id'', v_discount_record.scope_product_id,',
            '''scope_product_id'', v_discount_record.scope_product_id,' || E'\n            ''scope_product_sku_id'', v_discount_record.scope_product_sku_id,'
        );
    END IF;

    IF POSITION('scope_product_sku_id' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'failed to patch fn_validate_discount_code_core with SKU coupon scope';
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
        RAISE EXCEPTION 'fn_purchase_shop_item_core is missing; run SKU shop migrations first';
    END IF;

    IF POSITION('scope_product_sku_id' IN v_definition) = 0 THEN
        v_definition := REPLACE(
            v_definition,
            'IF COALESCE(v_discount_record.scope_type, ''all'') = ''product''' || E'\n            AND v_discount_record.scope_product_id IS DISTINCT FROM p_product_id THEN' || E'\n            RETURN jsonb_build_object(''success'', false, ''message'', ''该优惠码仅适用于指定商品'');' || E'\n        END IF;',
            'IF COALESCE(v_discount_record.scope_type, ''all'') = ''product''' || E'\n            AND v_discount_record.scope_product_id IS DISTINCT FROM p_product_id THEN' || E'\n            RETURN jsonb_build_object(''success'', false, ''message'', ''该优惠码仅适用于指定商品'');' || E'\n        END IF;' || E'\n' || E'\n        IF COALESCE(v_discount_record.scope_type, ''all'') = ''product''' || E'\n            AND v_discount_record.scope_product_sku_id IS NOT NULL' || E'\n            AND v_discount_record.scope_product_sku_id IS DISTINCT FROM v_sku_id THEN' || E'\n            RETURN jsonb_build_object(''success'', false, ''message'', ''该优惠码仅适用于指定商品规格'');' || E'\n        END IF;'
        );

        v_definition := REPLACE(
            v_definition,
            '''scope_product_id'', v_discount_record.scope_product_id,',
            '''scope_product_id'', v_discount_record.scope_product_id,' || E'\n            ''scope_product_sku_id'', v_discount_record.scope_product_sku_id,'
        );
    END IF;

    IF POSITION('scope_product_sku_id' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'failed to patch fn_purchase_shop_item_core with SKU coupon scope';
    END IF;

    EXECUTE v_definition;
END;
$$;
