-- Add per-order discountable quantity limits for shop coupons.
-- max_discount_quantity = 0 means the coupon can apply to all purchased items.

ALTER TABLE public.discount_codes
    ADD COLUMN IF NOT EXISTS max_discount_quantity INT NOT NULL DEFAULT 0;

ALTER TABLE public.discount_codes
    DROP CONSTRAINT IF EXISTS discount_codes_max_discount_quantity_check;

ALTER TABLE public.discount_codes
    ADD CONSTRAINT discount_codes_max_discount_quantity_check
    CHECK (max_discount_quantity >= 0);

COMMENT ON COLUMN public.discount_codes.max_discount_quantity IS
    'Maximum item quantity in a single order that this coupon may discount; 0 means unlimited.';

CREATE OR REPLACE FUNCTION public.fn_resolve_shop_discount_amount(
    p_subtotal NUMERIC,
    p_discount_type TEXT,
    p_discount_value NUMERIC,
    p_allow_zero_total BOOLEAN DEFAULT false,
    p_unit_price NUMERIC DEFAULT NULL,
    p_quantity INT DEFAULT 1,
    p_max_discount_quantity INT DEFAULT 0
)
RETURNS TABLE (
    discount_amount NUMERIC(12,2),
    final_total NUMERIC(12,2),
    has_effective_discount BOOLEAN
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_subtotal NUMERIC(12,2) := ROUND(GREATEST(0, COALESCE(p_subtotal, 0))::NUMERIC, 2);
    v_discount_type TEXT := LOWER(BTRIM(COALESCE(p_discount_type, '')));
    v_discount_value NUMERIC(12,2) := ROUND(GREATEST(0, COALESCE(p_discount_value, 0))::NUMERIC, 2);
    v_quantity INT := GREATEST(1, COALESCE(p_quantity, 1));
    v_max_discount_quantity INT := GREATEST(0, COALESCE(p_max_discount_quantity, 0));
    v_unit_price NUMERIC(12,2) := ROUND(GREATEST(0, COALESCE(p_unit_price, CASE WHEN COALESCE(p_quantity, 1) > 0 THEN p_subtotal / p_quantity ELSE p_subtotal END))::NUMERIC, 2);
    v_eligible_quantity INT := 0;
    v_eligible_subtotal NUMERIC(12,2) := 0;
    v_eligible_final_total NUMERIC(12,2) := 0;
BEGIN
    IF v_subtotal <= 0
        OR v_discount_type NOT IN ('percent', 'fixed')
        OR (v_discount_type = 'percent' AND v_discount_value > 100)
        OR (v_discount_type = 'fixed' AND v_discount_value <= 0) THEN
        RETURN QUERY
        SELECT 0::NUMERIC(12,2), v_subtotal, false;
        RETURN;
    END IF;

    v_eligible_quantity := CASE
        WHEN v_max_discount_quantity > 0 THEN LEAST(v_quantity, v_max_discount_quantity)
        ELSE v_quantity
    END;
    v_eligible_subtotal := CASE
        WHEN v_max_discount_quantity > 0 THEN ROUND(LEAST(v_subtotal, v_unit_price * v_eligible_quantity), 2)
        ELSE v_subtotal
    END;

    IF v_eligible_subtotal <= 0 THEN
        RETURN QUERY
        SELECT 0::NUMERIC(12,2), v_subtotal, false;
        RETURN;
    END IF;

    IF v_discount_type = 'percent' THEN
        v_eligible_final_total := ROUND((v_eligible_subtotal * v_discount_value) / 100, 2);
        v_eligible_final_total := GREATEST(0, LEAST(v_eligible_subtotal, v_eligible_final_total));
        discount_amount := ROUND(GREATEST(0, v_eligible_subtotal - v_eligible_final_total), 2);
    ELSE
        discount_amount := ROUND(LEAST(v_eligible_subtotal, v_discount_value), 2);
    END IF;

    final_total := ROUND(GREATEST(0, v_subtotal - discount_amount), 2);
    has_effective_discount := discount_amount > 0;

    IF final_total = 0
        AND discount_amount > 0
        AND NOT COALESCE(p_allow_zero_total, false) THEN
        has_effective_discount := false;
    END IF;

    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.fn_resolve_shop_discount_amount(NUMERIC, TEXT, NUMERIC, BOOLEAN, NUMERIC, INT, INT) IS
    'Resolves fixed and percent shop coupon amounts with an optional max_discount_quantity cap; 0 cap means unlimited.';

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

    IF POSITION('fn_resolve_shop_discount_amount(' IN v_definition) = 0 THEN
        v_definition := REPLACE(
            v_definition,
            '    IF v_discount_record.discount_type = ''percent'' THEN' || E'\n        SELECT' || E'\n            resolved.discount_amount,' || E'\n            resolved.final_total,' || E'\n            resolved.has_effective_discount' || E'\n        INTO' || E'\n            v_discount_amount,' || E'\n            v_final_total,' || E'\n            v_has_effective_discount' || E'\n        FROM public.fn_resolve_shop_percent_discount(' || E'\n            v_subtotal,' || E'\n            v_discount_record.discount_value,' || E'\n            COALESCE(v_discount_record.allow_zero_total, false)' || E'\n        ) AS resolved;' || E'\n' || E'\n        IF NOT v_has_effective_discount THEN' || E'\n            RETURN jsonb_build_object(''success'', false, ''message'', ''当前商品暂无可优惠金额，无法使用这张优惠码'');' || E'\n        END IF;' || E'\n    ELSIF v_discount_record.discount_type = ''fixed'' THEN' || E'\n        v_discount_amount := LEAST(v_subtotal, v_discount_record.discount_value::NUMERIC(12,2));' || E'\n        v_final_total := ROUND(GREATEST(0, v_subtotal - v_discount_amount), 2);' || E'\n        v_has_effective_discount := v_discount_amount > 0;' || E'\n    ELSE' || E'\n        v_final_total := v_subtotal;' || E'\n        v_has_effective_discount := false;' || E'\n    END IF;',
            '    SELECT' || E'\n        resolved.discount_amount,' || E'\n        resolved.final_total,' || E'\n        resolved.has_effective_discount' || E'\n    INTO' || E'\n        v_discount_amount,' || E'\n        v_final_total,' || E'\n        v_has_effective_discount' || E'\n    FROM public.fn_resolve_shop_discount_amount(' || E'\n        v_subtotal,' || E'\n        v_discount_record.discount_type,' || E'\n        v_discount_record.discount_value,' || E'\n        COALESCE(v_discount_record.allow_zero_total, false),' || E'\n        v_actual_unit_price,' || E'\n        p_quantity,' || E'\n        COALESCE(v_discount_record.max_discount_quantity, 0)' || E'\n    ) AS resolved;' || E'\n' || E'\n    IF NOT v_has_effective_discount THEN' || E'\n        RETURN jsonb_build_object(''success'', false, ''message'', ''当前商品暂无可优惠金额，无法使用这张优惠码'');' || E'\n    END IF;'
        );

        v_definition := REPLACE(
            v_definition,
            '''discount_value'', v_discount_record.discount_value,' || E'\n            ''discount_version'', COALESCE(v_discount_record.version_no, 1),',
            '''discount_value'', v_discount_record.discount_value,' || E'\n            ''max_discount_quantity'', COALESCE(v_discount_record.max_discount_quantity, 0),' || E'\n            ''discount_version'', COALESCE(v_discount_record.version_no, 1),'
        );
    END IF;

    IF POSITION('fn_resolve_shop_discount_amount(' IN v_definition) = 0
        OR POSITION('''max_discount_quantity'', COALESCE(v_discount_record.max_discount_quantity, 0)' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'failed to patch fn_validate_discount_code_core with max_discount_quantity';
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

    IF POSITION('fn_resolve_shop_discount_amount(' IN v_definition) = 0 THEN
        v_definition := REPLACE(
            v_definition,
            '        IF v_discount_record.discount_type = ''percent'' THEN' || E'\n            SELECT' || E'\n                resolved.discount_amount,' || E'\n                resolved.final_total,' || E'\n                resolved.has_effective_discount' || E'\n            INTO' || E'\n                v_discount_amount,' || E'\n                v_final_total,' || E'\n                v_has_effective_discount' || E'\n            FROM public.fn_resolve_shop_percent_discount(' || E'\n                v_total_price,' || E'\n                v_discount_record.discount_value,' || E'\n                COALESCE(v_discount_record.allow_zero_total, false)' || E'\n            ) AS resolved;' || E'\n' || E'\n            IF NOT v_has_effective_discount THEN' || E'\n                RETURN jsonb_build_object(''success'', false, ''message'', ''当前商品暂无可优惠金额，无法使用这张优惠码'');' || E'\n            END IF;' || E'\n        ELSIF v_discount_record.discount_type = ''fixed'' THEN' || E'\n            v_discount_amount := LEAST(v_total_price, v_discount_record.discount_value::NUMERIC(12,2));' || E'\n            v_final_total := ROUND(GREATEST(0, v_total_price - v_discount_amount), 2);' || E'\n            v_has_effective_discount := v_discount_amount > 0;' || E'\n        ELSE' || E'\n            v_final_total := v_total_price;' || E'\n            v_has_effective_discount := false;' || E'\n        END IF;',
            '        SELECT' || E'\n            resolved.discount_amount,' || E'\n            resolved.final_total,' || E'\n            resolved.has_effective_discount' || E'\n        INTO' || E'\n            v_discount_amount,' || E'\n            v_final_total,' || E'\n            v_has_effective_discount' || E'\n        FROM public.fn_resolve_shop_discount_amount(' || E'\n            v_total_price,' || E'\n            v_discount_record.discount_type,' || E'\n            v_discount_record.discount_value,' || E'\n            COALESCE(v_discount_record.allow_zero_total, false),' || E'\n            v_actual_unit_price,' || E'\n            p_quantity,' || E'\n            COALESCE(v_discount_record.max_discount_quantity, 0)' || E'\n        ) AS resolved;' || E'\n' || E'\n        IF NOT v_has_effective_discount THEN' || E'\n            RETURN jsonb_build_object(''success'', false, ''message'', ''当前商品暂无可优惠金额，无法使用这张优惠码'');' || E'\n        END IF;'
        );

        v_definition := REPLACE(
            v_definition,
            '''discount_value'', v_discount_record.discount_value,' || E'\n            ''max_uses'', v_discount_record.max_uses,',
            '''discount_value'', v_discount_record.discount_value,' || E'\n            ''max_discount_quantity'', COALESCE(v_discount_record.max_discount_quantity, 0),' || E'\n            ''max_uses'', v_discount_record.max_uses,'
        );

        v_definition := REPLACE(
            v_definition,
            '''discount_value'', v_applied_discount_value,' || E'\n            ''discount_amount'', v_discount_amount,',
            '''discount_value'', v_applied_discount_value,' || E'\n            ''max_discount_quantity'', COALESCE(v_discount_record.max_discount_quantity, 0),' || E'\n            ''discount_amount'', v_discount_amount,'
        );
    END IF;

    IF POSITION('fn_resolve_shop_discount_amount(' IN v_definition) = 0
        OR POSITION('''max_discount_quantity'', COALESCE(v_discount_record.max_discount_quantity, 0)' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'failed to patch fn_purchase_shop_item_core with max_discount_quantity';
    END IF;

    EXECUTE v_definition;
END;
$$;

DO $$
DECLARE
    v_definition TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.fn_purchase_shop_item_with_discounts(uuid,uuid,character varying,integer,jsonb,uuid)'::regprocedure
    )
    INTO v_definition;

    IF v_definition IS NULL THEN
        RAISE EXCEPTION 'fn_purchase_shop_item_with_discounts is missing; run 20260416_enable_multi_discount_shop_stacking.sql first';
    END IF;

    IF POSITION('max_discount_quantity' IN v_definition) = 0 THEN
        v_definition := REPLACE(
            v_definition,
            '            COALESCE(d.version_no, 1) AS version_no,',
            '            COALESCE(d.version_no, 1) AS version_no,' || E'\n            COALESCE(d.max_discount_quantity, 0) AS max_discount_quantity,'
        );

        v_definition := REPLACE(
            v_definition,
            '''discount_value'', (v_preview_data ->> ''discount_value'')::NUMERIC(12,2),' || E'\n            ''unit_price'', (v_preview_data ->> ''unit_price'')::NUMERIC(12,2),',
            '''discount_value'', (v_preview_data ->> ''discount_value'')::NUMERIC(12,2),' || E'\n            ''max_discount_quantity'', COALESCE(v_discount_row.max_discount_quantity, 0),' || E'\n            ''quantity'', p_quantity,' || E'\n            ''unit_price'', (v_preview_data ->> ''unit_price'')::NUMERIC(12,2),'
        );

        v_definition := REPLACE(
            v_definition,
            '        IF COALESCE(v_discount_entry ->> ''discount_type'', '''') = ''percent'' THEN' || E'\n            SELECT' || E'\n                resolved.discount_amount,' || E'\n                resolved.final_total,' || E'\n                resolved.has_effective_discount' || E'\n            INTO' || E'\n                v_discount_amount,' || E'\n                v_discounted_total,' || E'\n                v_has_effective_discount' || E'\n            FROM public.fn_resolve_shop_percent_discount(' || E'\n                v_running_total,' || E'\n                COALESCE((v_discount_entry ->> ''discount_value'')::INT, 0),' || E'\n                COALESCE((v_discount_entry ->> ''allow_zero_total'')::BOOLEAN, false)' || E'\n            ) AS resolved;' || E'\n        ELSIF COALESCE(v_discount_entry ->> ''discount_type'', '''') = ''fixed'' THEN' || E'\n            v_discount_amount := LEAST(v_running_total, COALESCE((v_discount_entry ->> ''discount_value'')::NUMERIC(12,2), 0));' || E'\n            v_discounted_total := ROUND(GREATEST(0, v_running_total - v_discount_amount), 2);' || E'\n            v_has_effective_discount := v_discount_amount > 0;' || E'\n' || E'\n            IF v_discounted_total = 0' || E'\n                AND v_discount_amount > 0' || E'\n                AND NOT COALESCE((v_discount_entry ->> ''allow_zero_total'')::BOOLEAN, false) THEN' || E'\n                v_has_effective_discount := FALSE;' || E'\n            END IF;' || E'\n        ELSE' || E'\n            v_discount_amount := 0;' || E'\n            v_discounted_total := v_running_total;' || E'\n            v_has_effective_discount := FALSE;' || E'\n        END IF;',
            '        SELECT' || E'\n            resolved.discount_amount,' || E'\n            resolved.final_total,' || E'\n            resolved.has_effective_discount' || E'\n        INTO' || E'\n            v_discount_amount,' || E'\n            v_discounted_total,' || E'\n            v_has_effective_discount' || E'\n        FROM public.fn_resolve_shop_discount_amount(' || E'\n            v_running_total,' || E'\n            COALESCE(v_discount_entry ->> ''discount_type'', ''''),' || E'\n            COALESCE((v_discount_entry ->> ''discount_value'')::NUMERIC(12,2), 0),' || E'\n            COALESCE((v_discount_entry ->> ''allow_zero_total'')::BOOLEAN, false),' || E'\n            COALESCE((v_discount_entry ->> ''unit_price'')::NUMERIC(12,2), CASE WHEN p_quantity > 0 THEN v_subtotal / p_quantity ELSE v_subtotal END),' || E'\n            p_quantity,' || E'\n            COALESCE((v_discount_entry ->> ''max_discount_quantity'')::INT, 0)' || E'\n        ) AS resolved;'
        );
    END IF;

    IF POSITION('max_discount_quantity' IN v_definition) = 0
        OR POSITION('fn_resolve_shop_discount_amount(' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'failed to patch fn_purchase_shop_item_with_discounts with max_discount_quantity';
    END IF;

    EXECUTE v_definition;
END;
$$;
