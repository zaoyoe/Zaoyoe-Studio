-- Qualify the INSERT RETURNING columns in the cart batch RPC. `batch_no` is
-- also a RETURNS TABLE output variable, so the unqualified reference raises
-- SQLSTATE 42702 before the first cart item is checked.
DO $$
DECLARE
    v_definition TEXT;
    v_patched_definition TEXT;
BEGIN
    v_definition := pg_get_functiondef(
        'public.fn_guest_shop_create_checkout_batch(text, jsonb, text, text, text, text, text, integer)'::REGPROCEDURE
    );

    IF v_definition !~ 'RETURNING[[:space:]]+guest_shop_checkout_batches[.]id[[:space:]]*,[[:space:]]*guest_shop_checkout_batches[.]batch_no[[:space:]]+INTO[[:space:]]+v_batch_id[[:space:]]*,[[:space:]]*v_batch_no;' THEN
        v_patched_definition := regexp_replace(
            v_definition,
            'RETURNING[[:space:]]+id[[:space:]]*,[[:space:]]*batch_no[[:space:]]+INTO[[:space:]]+v_batch_id[[:space:]]*,[[:space:]]*v_batch_no;',
            'RETURNING guest_shop_checkout_batches.id, guest_shop_checkout_batches.batch_no INTO v_batch_id, v_batch_no;'
        );

        IF v_patched_definition = v_definition THEN
            RAISE EXCEPTION 'guest_checkout_batch_returning_patch_target_not_found';
        END IF;

        EXECUTE v_patched_definition;
    END IF;
END;
$$;

DO $$
DECLARE
    v_definition TEXT;
BEGIN
    v_definition := pg_get_functiondef(
        'public.fn_guest_shop_create_checkout_batch(text, jsonb, text, text, text, text, text, integer)'::REGPROCEDURE
    );
    IF v_definition !~ 'RETURNING[[:space:]]+guest_shop_checkout_batches[.]id[[:space:]]*,[[:space:]]*guest_shop_checkout_batches[.]batch_no[[:space:]]+INTO[[:space:]]+v_batch_id[[:space:]]*,[[:space:]]*v_batch_no;' THEN
        RAISE EXCEPTION 'guest_checkout_batch_returning_patch_verification_failed';
    END IF;
END;
$$;
