-- Multi-variant draft import v3 for shop supplier catalog (Xiareng).
-- Allows importing an upstream product with multiple verified variants (races)
-- into ONE shop_product with multiple SKUs and corresponding mappings.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.import_shop_supplier_multi_draft_v3(
    p_account_id UUID,
    p_site TEXT,
    p_goods_no TEXT,
    p_variants JSONB,
    p_name TEXT,
    p_snapshot JSONB,
    p_admin_id UUID,
    p_product_category TEXT DEFAULT 'resource'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_account public.shop_supplier_accounts%ROWTYPE;
    v_product_id UUID;
    v_default_sku_id UUID;
    v_current_sku_id UUID;
    v_variant JSONB;
    v_race TEXT;
    v_ceiling TEXT;
    v_key TEXT;
    v_description TEXT;
    v_image_url TEXT;
    v_sku_count INT := 0;
    v_category TEXT;
    v_mapping_ids UUID[] := ARRAY[]::UUID[];
    v_sku_ids UUID[] := ARRAY[]::UUID[];
    v_idx INT := 0;
BEGIN
    IF p_admin_id IS NULL OR p_site IS DISTINCT FROM 'cn'
        OR p_goods_no IS NULL OR LENGTH(BTRIM(p_goods_no)) NOT BETWEEN 1 AND 160
        OR p_goods_no IS DISTINCT FROM BTRIM(p_goods_no)
        OR p_name IS NULL OR LENGTH(BTRIM(p_name)) NOT BETWEEN 1 AND 100
        OR jsonb_typeof(p_variants) IS DISTINCT FROM 'array'
        OR jsonb_array_length(p_variants) < 1
        OR jsonb_array_length(p_variants) > 100
        OR jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object'
        OR OCTET_LENGTH(p_snapshot::TEXT) > 32768 THEN
        RAISE EXCEPTION 'Invalid multi-variant supplier draft import input';
    END IF;

    SELECT * INTO v_account FROM public.shop_supplier_accounts
        WHERE id = p_account_id FOR SHARE;
    IF NOT FOUND OR v_account.is_enabled IS DISTINCT FROM true
        OR v_account.provider_id IS DISTINCT FROM 'xiareng' THEN
        RAISE EXCEPTION 'Supplier read-only account unavailable';
    END IF;

    v_category := COALESCE(NULLIF(BTRIM(p_product_category), ''), 'resource');
    v_description := NULLIF(BTRIM(COALESCE(p_snapshot->>'description', '')), '');
    v_image_url := NULLIF(BTRIM(COALESCE(p_snapshot->>'imageUrl', '')), '');

    -- Create 1 inactive draft product
    INSERT INTO public.shop_products (
        name, description, category, tags, price_points, price_points_intl,
        stock_count, is_active, allow_guest_purchase,
        usage_instructions, usage_instructions_zh, show_usage_instructions,
        icon_url, image_assets
    ) VALUES (
        BTRIM(p_name), NULL, v_category, '[]'::JSONB, 0, NULL, 0, false, false,
        v_description, v_description, (v_description IS NOT NULL),
        v_image_url, CASE WHEN v_image_url IS NOT NULL THEN jsonb_build_object('original', v_image_url) ELSE '{}'::JSONB END
    ) RETURNING id INTO v_product_id;

    -- Retrieve auto-created default SKU
    SELECT id INTO v_default_sku_id FROM public.shop_product_skus
        WHERE product_id = v_product_id AND is_default = true LIMIT 1;
    IF v_default_sku_id IS NULL THEN
        RAISE EXCEPTION 'Default SKU trigger is unavailable; multi-variant import rolled back';
    END IF;

    -- Iterate variants
    FOR v_variant IN SELECT * FROM jsonb_array_elements(p_variants)
    LOOP
        v_idx := v_idx + 1;
        v_race := NULLIF(BTRIM(v_variant->>'race'), '');
        IF v_race IS NULL OR LENGTH(v_race) > 160 THEN
            RAISE EXCEPTION 'Variant race name invalid at index %', v_idx;
        END IF;

        v_ceiling := NULLIF(BTRIM(v_variant->>'costCeilingCny'), '');
        v_key := 'v1:' || md5(jsonb_build_object('race', v_race)::TEXT);

        IF v_idx = 1 THEN
            -- Update the default SKU
            UPDATE public.shop_product_skus
               SET sku_name = v_race,
                   spec_values = jsonb_build_object('规格', v_race),
                   sort_order = 0
             WHERE id = v_default_sku_id;
            v_current_sku_id := v_default_sku_id;
        ELSE
            -- Insert new non-default SKU
            INSERT INTO public.shop_product_skus (
                product_id, sku_name, spec_values, is_default, is_active, stock_count, sort_order
            ) VALUES (
                v_product_id, v_race, jsonb_build_object('规格', v_race), false, true, 0, (v_idx - 1) * 10
            ) RETURNING id INTO v_current_sku_id;
        END IF;

        v_sku_ids := array_append(v_sku_ids, v_current_sku_id);

        -- Insert mapping for this SKU
        INSERT INTO public.shop_supplier_product_mappings (
            site, supplier_account_id, product_id, sku_id,
            supplier_goods_no, supplier_variant_key, supplier_variant,
            import_snapshot, contract_version, priority, is_primary, is_enabled
        ) VALUES (
            p_site, p_account_id, v_product_id, v_current_sku_id,
            p_goods_no, v_key, jsonb_build_object('race', v_race),
            p_snapshot || CASE
                WHEN v_ceiling IS NOT NULL THEN jsonb_build_object('costCeilingCny', v_ceiling)
                ELSE '{}'::jsonb
            END,
            2, 100, true, false
        );

        v_sku_count := v_sku_count + 1;
    END LOOP;

    -- Audit log
    INSERT INTO public.admin_audit_logs (admin_id, target_user_id, action_type, details)
    VALUES (p_admin_id, NULL, 'shop.supplier_catalog.import_multi_variant', jsonb_build_object(
        'module', 'shop', 'site', p_site, 'provider_id', v_account.provider_id,
        'supplier_account_id', p_account_id, 'supplier_goods_no', p_goods_no,
        'product_id', v_product_id, 'sku_ids', v_sku_ids, 'sku_count', v_sku_count,
        'mapping_enabled', false, 'is_active', false, 'contract_version', 2
    ));

    RETURN jsonb_build_object(
        'status', 'imported_as_draft',
        'productId', v_product_id,
        'skuCount', v_sku_count,
        'site', p_site,
        'goodsNo', p_goods_no
    );
END;
$$;

REVOKE ALL ON FUNCTION public.import_shop_supplier_multi_draft_v3(UUID, TEXT, TEXT, JSONB, TEXT, JSONB, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_shop_supplier_multi_draft_v3(UUID, TEXT, TEXT, JSONB, TEXT, JSONB, UUID, TEXT) TO service_role;

COMMIT;
