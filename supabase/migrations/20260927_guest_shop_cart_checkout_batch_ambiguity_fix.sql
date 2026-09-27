-- Fix the checkout RPC's SKU lookup. The function returns a `product_id`
-- column, so the unqualified table column in this predicate is ambiguous in
-- PL/pgSQL and aborts checkout before any batch is committed.
DO $$
DECLARE
    v_definition TEXT;
    v_patched_definition TEXT;
BEGIN
    v_definition := pg_get_functiondef(
        'public.fn_guest_shop_create_checkout_batch(text, jsonb, text, text, text, text, text, integer)'::REGPROCEDURE
    );

    IF v_definition !~ 'FROM public[.]shop_product_skus[[:space:]]+AS sku WHERE sku[.]id = v_sku_id AND sku[.]product_id = v_product_id FOR UPDATE;' THEN
        v_patched_definition := regexp_replace(
            v_definition,
            'FROM public[.]shop_product_skus[[:space:]]+WHERE[[:space:]]+id = v_sku_id AND product_id = v_product_id FOR UPDATE;',
            'FROM public.shop_product_skus AS sku WHERE sku.id = v_sku_id AND sku.product_id = v_product_id FOR UPDATE;'
        );

        IF v_patched_definition = v_definition THEN
            RAISE EXCEPTION 'guest_checkout_batch_sku_lookup_patch_target_not_found';
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
    IF v_definition !~ 'sku[.]product_id = v_product_id FOR UPDATE;' THEN
        RAISE EXCEPTION 'guest_checkout_batch_sku_lookup_patch_verification_failed';
    END IF;
END;
$$;
