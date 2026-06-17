-- Keep zero-total coupon rejections specific after the max-discount-quantity resolver.
-- A coupon that would reduce the order to 0 but disallows full discount should not
-- fall through to the generic "no discountable amount" message.

DO $$
DECLARE
    v_definition TEXT;
    v_original_definition TEXT;
    v_old_block TEXT := '    IF NOT v_has_effective_discount THEN' || E'\n'
        || '        RETURN jsonb_build_object(''success'', false, ''message'', ''当前商品暂无可优惠金额，无法使用这张优惠码'');' || E'\n'
        || '    END IF;';
    v_new_block TEXT := '    IF NOT v_has_effective_discount THEN' || E'\n'
        || '        IF v_final_total = 0' || E'\n'
        || '            AND v_discount_amount > 0' || E'\n'
        || '            AND NOT COALESCE(v_discount_record.allow_zero_total, false) THEN' || E'\n'
        || '            RETURN jsonb_build_object(''success'', false, ''message'', ''该优惠码不允许全额抵扣'');' || E'\n'
        || '        END IF;' || E'\n'
        || E'\n'
        || '        RETURN jsonb_build_object(''success'', false, ''message'', ''当前商品暂无可优惠金额，无法使用这张优惠码'');' || E'\n'
        || '    END IF;';
BEGIN
    SELECT pg_get_functiondef(
        'public.fn_validate_discount_code_core(uuid,uuid,character varying,integer,character varying,uuid,uuid)'::regprocedure
    )
    INTO v_definition;

    IF v_definition IS NULL THEN
        RAISE EXCEPTION 'fn_validate_discount_code_core is missing';
    END IF;

    IF POSITION('fn_resolve_shop_discount_amount(' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'fn_validate_discount_code_core must be patched by 20260617_add_discount_max_discount_quantity.sql first';
    END IF;

    IF POSITION('IF v_final_total = 0' || E'\n            AND v_discount_amount > 0' IN v_definition) = 0 THEN
        v_original_definition := v_definition;
        v_definition := REPLACE(v_definition, v_old_block, v_new_block);

        IF v_definition = v_original_definition THEN
            RAISE EXCEPTION 'failed to patch fn_validate_discount_code_core full-discount block message';
        END IF;
    END IF;

    IF POSITION('IF v_final_total = 0' || E'\n            AND v_discount_amount > 0' IN v_definition) = 0
        OR POSITION('''该优惠码不允许全额抵扣''' IN v_definition) = 0
        OR POSITION('''当前商品暂无可优惠金额，无法使用这张优惠码''' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'fn_validate_discount_code_core full-discount block message patch verification failed';
    END IF;

    EXECUTE v_definition;
END;
$$;

DO $$
DECLARE
    v_definition TEXT;
    v_original_definition TEXT;
    v_old_block TEXT := '        IF NOT v_has_effective_discount THEN' || E'\n'
        || '            RETURN jsonb_build_object(''success'', false, ''message'', ''当前商品暂无可优惠金额，无法使用这张优惠码'');' || E'\n'
        || '        END IF;';
    v_new_block TEXT := '        IF NOT v_has_effective_discount THEN' || E'\n'
        || '            IF v_final_total = 0' || E'\n'
        || '                AND v_discount_amount > 0' || E'\n'
        || '                AND NOT COALESCE(v_discount_record.allow_zero_total, false) THEN' || E'\n'
        || '                RETURN jsonb_build_object(''success'', false, ''message'', ''该优惠码不允许全额抵扣'');' || E'\n'
        || '            END IF;' || E'\n'
        || E'\n'
        || '            RETURN jsonb_build_object(''success'', false, ''message'', ''当前商品暂无可优惠金额，无法使用这张优惠码'');' || E'\n'
        || '        END IF;';
BEGIN
    SELECT pg_get_functiondef(
        'public.fn_purchase_shop_item_core(uuid,uuid,character varying,integer,character varying,uuid,uuid)'::regprocedure
    )
    INTO v_definition;

    IF v_definition IS NULL THEN
        RAISE EXCEPTION 'fn_purchase_shop_item_core is missing';
    END IF;

    IF POSITION('fn_resolve_shop_discount_amount(' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'fn_purchase_shop_item_core must be patched by 20260617_add_discount_max_discount_quantity.sql first';
    END IF;

    IF POSITION('IF v_final_total = 0' || E'\n                AND v_discount_amount > 0' IN v_definition) = 0 THEN
        v_original_definition := v_definition;
        v_definition := REPLACE(v_definition, v_old_block, v_new_block);

        IF v_definition = v_original_definition THEN
            RAISE EXCEPTION 'failed to patch fn_purchase_shop_item_core full-discount block message';
        END IF;
    END IF;

    IF POSITION('IF v_final_total = 0' || E'\n                AND v_discount_amount > 0' IN v_definition) = 0
        OR POSITION('''该优惠码不允许全额抵扣''' IN v_definition) = 0
        OR POSITION('''当前商品暂无可优惠金额，无法使用这张优惠码''' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'fn_purchase_shop_item_core full-discount block message patch verification failed';
    END IF;

    EXECUTE v_definition;
END;
$$;
