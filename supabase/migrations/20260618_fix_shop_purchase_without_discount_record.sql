-- Avoid reading an unassigned discount record when checkout has no coupon.
-- The max_discount_quantity patch added v_discount_record reads to the purchase
-- response/snapshot path; those paths still run for normal no-coupon purchases.

DO $$
DECLARE
    v_definition TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.fn_purchase_shop_item_core(uuid,uuid,character varying,integer,character varying,uuid,uuid)'::regprocedure
    )
    INTO v_definition;

    IF v_definition IS NULL THEN
        RAISE EXCEPTION 'fn_purchase_shop_item_core is missing';
    END IF;

    IF POSITION('v_max_discount_quantity INT := 0;' IN v_definition) = 0 THEN
        v_definition := REPLACE(
            v_definition,
            '    v_discount_version INT := NULL;' || E'\n'
                || '    v_has_effective_discount BOOLEAN := FALSE;',
            '    v_discount_version INT := NULL;' || E'\n'
                || '    v_max_discount_quantity INT := 0;' || E'\n'
                || '    v_has_effective_discount BOOLEAN := FALSE;'
        );
    END IF;

    v_definition := REPLACE(
        v_definition,
        'COALESCE(v_discount_record.max_discount_quantity, 0)',
        'v_max_discount_quantity'
    );

    v_definition := REPLACE(
        v_definition,
        'v_max_discount_quantity := v_max_discount_quantity;',
        'v_max_discount_quantity := COALESCE(v_discount_record.max_discount_quantity, 0);'
    );

    IF POSITION('v_max_discount_quantity := COALESCE(v_discount_record.max_discount_quantity, 0);' IN v_definition) = 0 THEN
        v_definition := REPLACE(
            v_definition,
            '        v_applied_discount_value := v_discount_record.discount_value;' || E'\n',
            '        v_applied_discount_value := v_discount_record.discount_value;' || E'\n'
                || '        v_max_discount_quantity := COALESCE(v_discount_record.max_discount_quantity, 0);' || E'\n'
        );
    END IF;

    IF POSITION('v_max_discount_quantity INT := 0;' IN v_definition) = 0
        OR POSITION('v_max_discount_quantity := v_max_discount_quantity;' IN v_definition) > 0
        OR POSITION('''max_discount_quantity'', COALESCE(v_discount_record.max_discount_quantity, 0)' IN v_definition) > 0 THEN
        RAISE EXCEPTION 'fn_purchase_shop_item_core max_discount_quantity no-coupon patch verification failed';
    END IF;

    IF POSITION('''max_discount_quantity'', v_max_discount_quantity' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'fn_purchase_shop_item_core response should use initialized max_discount_quantity';
    END IF;

    EXECUTE v_definition;
END;
$$;
