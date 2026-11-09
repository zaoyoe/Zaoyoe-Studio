-- Custom per-product upstream procurement cost ceiling for supplier mappings.
-- Allows admins to configure costCeilingCny when importing a draft or editing a product,
-- and uses that per-mapping ceiling in fn_issue_shop_supplier_quote_v2 while keeping
-- shop_supplier_transaction_policies aligned.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.fn_set_shop_supplier_mapping_cost_ceiling_v2(
    p_mapping_id UUID,
    p_cost_ceiling_cny NUMERIC,
    p_admin_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_mapping public.shop_supplier_product_mappings%ROWTYPE;
    v_ceiling NUMERIC(18,6);
    v_ceiling_str TEXT;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'supplier_service_role_required';
    END IF;
    IF p_mapping_id IS NULL
        OR p_cost_ceiling_cny IS NULL
        OR LOWER(p_cost_ceiling_cny::TEXT) IN ('nan', 'infinity', '-infinity')
        OR p_cost_ceiling_cny <= 0
        OR p_cost_ceiling_cny > 100000 THEN
        RAISE EXCEPTION 'supplier_invalid_cost_ceiling';
    END IF;

    v_ceiling := ROUND(p_cost_ceiling_cny, 6);
    v_ceiling_str := CASE
        WHEN v_ceiling = ROUND(v_ceiling, 2) THEN TO_CHAR(ROUND(v_ceiling, 2), 'FM999999999990.00')
        ELSE TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM TO_CHAR(v_ceiling, 'FM999999999990.000000')))
    END;

    SELECT * INTO v_mapping
    FROM public.shop_supplier_product_mappings
    WHERE id = p_mapping_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'supplier_mapping_not_found';
    END IF;

    UPDATE public.shop_supplier_product_mappings
    SET import_snapshot = COALESCE(import_snapshot, '{}'::jsonb) || jsonb_build_object(
            'costCeilingCny', v_ceiling_str,
            'costCeilingUpdatedAt', clock_timestamp()
        ),
        updated_at = clock_timestamp()
    WHERE id = v_mapping.id
    RETURNING * INTO v_mapping;

    UPDATE public.shop_supplier_transaction_policies
    SET per_unit_cost_ceiling_cny = GREATEST(per_unit_cost_ceiling_cny, v_ceiling),
        max_unresolved_units = GREATEST(max_unresolved_units, 10),
        max_reserved_cost_cny = GREATEST(
            max_reserved_cost_cny,
            GREATEST(per_unit_cost_ceiling_cny, v_ceiling) * GREATEST(max_unresolved_units, 10)
        ),
        updated_at = clock_timestamp()
    WHERE supplier_account_id = v_mapping.supplier_account_id;

    RETURN jsonb_build_object(
        'mapping_id', v_mapping.id,
        'product_id', v_mapping.product_id,
        'sku_id', v_mapping.sku_id,
        'supplier_account_id', v_mapping.supplier_account_id,
        'cost_ceiling_cny', v_ceiling_str
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_set_shop_supplier_mapping_cost_ceiling_v2(UUID, NUMERIC, UUID)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_set_shop_supplier_mapping_cost_ceiling_v2(UUID, NUMERIC, UUID)
    TO service_role;

CREATE OR REPLACE FUNCTION public.fn_issue_shop_supplier_quote_v2(
    p_operation_id UUID, p_funding_kind TEXT, p_buyer_user_id UUID, p_guest_owner_hash TEXT,
    p_product_id UUID, p_sku_id UUID, p_native_request_fingerprint TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_quote public.shop_supplier_checkout_quotes%ROWTYPE;
    v_product public.shop_products%ROWTYPE;
    v_sku public.shop_product_skus%ROWTYPE;
    v_mapping public.shop_supplier_product_mappings%ROWTYPE;
    v_policy public.shop_supplier_transaction_policies%ROWTYPE;
    v_price NUMERIC;
    v_raw_ceiling TEXT;
    v_ceiling NUMERIC(18,6);
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'supplier_service_role_required'; END IF;
    IF p_operation_id IS NULL OR p_product_id IS NULL OR p_sku_id IS NULL
        OR p_funding_kind IS NULL OR p_funding_kind NOT IN ('points', 'guest_cash')
        OR (p_funding_kind = 'points' AND (p_buyer_user_id IS NULL OR p_guest_owner_hash IS NOT NULL OR p_native_request_fingerprint IS NOT NULL))
        OR (p_funding_kind = 'guest_cash' AND (p_buyer_user_id IS NOT NULL OR p_guest_owner_hash IS NULL
            OR p_guest_owner_hash !~ '^[a-f0-9]{64}$' OR p_native_request_fingerprint IS NULL
            OR p_native_request_fingerprint !~ '^[a-f0-9]{64}$')) THEN
        RAISE EXCEPTION 'supplier_idempotency_conflict';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('supplier_quote_v2:' || p_operation_id::TEXT, 0));
    SELECT * INTO v_quote FROM public.shop_supplier_checkout_quotes WHERE operation_id = p_operation_id FOR UPDATE;
    IF FOUND THEN
        IF v_quote.funding_kind IS DISTINCT FROM p_funding_kind OR v_quote.buyer_user_id IS DISTINCT FROM p_buyer_user_id
            OR v_quote.guest_owner_hash IS DISTINCT FROM p_guest_owner_hash
            OR v_quote.native_request_fingerprint IS DISTINCT FROM p_native_request_fingerprint
            OR v_quote.product_id IS DISTINCT FROM p_product_id OR v_quote.sku_id IS DISTINCT FROM p_sku_id THEN
            RAISE EXCEPTION 'supplier_idempotency_conflict';
        END IF;
        IF v_quote.status <> 'consumed' AND v_quote.expires_at <= clock_timestamp() THEN
            RAISE EXCEPTION 'supplier_quote_expired';
        END IF;
        RETURN jsonb_build_object('quote_id', v_quote.id, 'status', v_quote.status);
    END IF;
    SELECT * INTO v_product FROM public.shop_products WHERE id = p_product_id FOR UPDATE;
    IF NOT FOUND OR NOT v_product.is_active OR COALESCE(v_product.manual_delivery, false)
        OR UPPER(COALESCE(v_product.delivery_type, 'KEY')) <> 'KEY' THEN RAISE EXCEPTION 'supplier_quote_changed'; END IF;
    SELECT * INTO v_sku FROM public.shop_product_skus WHERE id = p_sku_id AND product_id = p_product_id FOR UPDATE;
    IF NOT FOUND OR NOT v_sku.is_active OR COALESCE(v_sku.manual_delivery, false) THEN RAISE EXCEPTION 'supplier_quote_changed'; END IF;
    IF (SELECT COUNT(*) FROM public.shop_supplier_product_mappings WHERE product_id = p_product_id AND sku_id = p_sku_id
        AND site = 'cn' AND contract_version = 2 AND is_enabled AND is_primary) <> 1 THEN
        RAISE EXCEPTION 'supplier_quote_changed';
    END IF;
    SELECT * INTO v_mapping FROM public.shop_supplier_product_mappings WHERE product_id = p_product_id AND sku_id = p_sku_id
        AND site = 'cn' AND contract_version = 2 AND is_enabled AND is_primary FOR SHARE;
    PERFORM 1 FROM public.shop_supplier_accounts WHERE id = v_mapping.supplier_account_id AND is_enabled FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'supplier_checkout_unavailable'; END IF;
    SELECT * INTO v_policy FROM public.shop_supplier_transaction_policies WHERE supplier_account_id = v_mapping.supplier_account_id FOR UPDATE;
    IF NOT FOUND OR NOT v_policy.intake_enabled OR NOT v_policy.checkout_enabled OR v_policy.per_unit_cost_ceiling_cny <= 0 THEN
        RAISE EXCEPTION 'supplier_checkout_unavailable';
    END IF;

    v_raw_ceiling := COALESCE(
        NULLIF(BTRIM(COALESCE(v_mapping.import_snapshot->>'costCeilingCny', '')), ''),
        CASE
            WHEN COALESCE(NULLIF(BTRIM(COALESCE(v_mapping.import_snapshot->>'currency', '')), ''), 'CNY') = 'CNY'
            THEN NULLIF(BTRIM(COALESCE(v_mapping.import_snapshot->>'supplierUnitPrice', '')), '')
            ELSE NULL
        END
    );
    IF v_raw_ceiling IS NOT NULL AND v_raw_ceiling ~ '^\d{1,12}(\.\d{1,8})?$' THEN
        v_ceiling := ROUND(v_raw_ceiling::NUMERIC, 6);
        IF v_ceiling <= 0 OR v_ceiling > 100000 THEN
            v_ceiling := v_policy.per_unit_cost_ceiling_cny;
        END IF;
    ELSE
        v_ceiling := v_policy.per_unit_cost_ceiling_cny;
    END IF;

    IF v_ceiling > v_policy.per_unit_cost_ceiling_cny
        OR (v_ceiling * GREATEST(v_policy.max_unresolved_units, 10)) > v_policy.max_reserved_cost_cny THEN
        UPDATE public.shop_supplier_transaction_policies
        SET per_unit_cost_ceiling_cny = GREATEST(per_unit_cost_ceiling_cny, v_ceiling),
            max_unresolved_units = GREATEST(max_unresolved_units, 10),
            max_reserved_cost_cny = GREATEST(
                max_reserved_cost_cny,
                GREATEST(per_unit_cost_ceiling_cny, v_ceiling) * GREATEST(max_unresolved_units, 10)
            ),
            updated_at = clock_timestamp()
        WHERE supplier_account_id = v_mapping.supplier_account_id
        RETURNING * INTO v_policy;
    END IF;

    IF p_funding_kind = 'guest_cash' AND NOT COALESCE(v_sku.allow_guest_purchase, v_product.allow_guest_purchase, false) THEN
        RAISE EXCEPTION 'supplier_checkout_unavailable';
    END IF;
    v_price := public.guest_shop_resolve_credit_unit_amount_with_start('cn',
        v_sku.price_points, v_sku.price_points_intl, COALESCE(v_sku.is_default, false),
        v_sku.quantity_rules, v_sku.quantity_rules_intl, v_product.quantity_rules, v_product.quantity_rules_intl,
        v_product.flash_sale_price, v_product.flash_sale_price_intl, v_product.flash_sale_end, v_product.flash_sale_end_intl,
        1, clock_timestamp(), v_product.flash_sale_start, v_product.flash_sale_start_intl);
    IF v_price IS NULL OR v_price <= 0 OR v_price >= 1000000000000
        OR LOWER(v_price::TEXT) IN ('nan', 'infinity', '-infinity') OR v_price <> ROUND(v_price, 2) THEN
        RAISE EXCEPTION 'supplier_quote_changed';
    END IF;
    INSERT INTO public.shop_supplier_checkout_quotes(operation_id, funding_kind, buyer_user_id, guest_owner_hash,
        native_request_fingerprint, product_id, sku_id, mapping_id, mapping_revision, supplier_account_id,
        sale_amount, sale_currency, cost_ceiling_cny, expires_at)
    VALUES (p_operation_id, p_funding_kind, p_buyer_user_id, p_guest_owner_hash, p_native_request_fingerprint,
        p_product_id, p_sku_id, v_mapping.id, v_mapping.updated_at, v_mapping.supplier_account_id, v_price,
        CASE WHEN p_funding_kind = 'points' THEN 'POINTS' ELSE 'CNY' END,
        v_ceiling, clock_timestamp() + INTERVAL '120 seconds') RETURNING * INTO v_quote;
    RETURN jsonb_build_object('quote_id', v_quote.id, 'status', 'issued');
END;
$$;

REVOKE ALL ON FUNCTION public.fn_issue_shop_supplier_quote_v2(UUID, TEXT, UUID, TEXT, UUID, UUID, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_issue_shop_supplier_quote_v2(UUID, TEXT, UUID, TEXT, UUID, UUID, TEXT)
    TO service_role;

-- 3. Update import_shop_supplier_draft_v2 to automatically populate usage_instructions from p_snapshot->>'description'
CREATE OR REPLACE FUNCTION public.import_shop_supplier_draft_v2(
    p_account_id UUID, p_site TEXT, p_goods_no TEXT, p_variant JSONB,
    p_name TEXT, p_snapshot JSONB, p_admin_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_account public.shop_supplier_accounts%ROWTYPE;
    v_mapping public.shop_supplier_product_mappings%ROWTYPE;
    v_variant JSONB := COALESCE(p_variant, '{}'::JSONB);
    v_key TEXT;
    v_product_id UUID;
    v_sku_id UUID;
    v_description TEXT;
    v_image_url TEXT;
BEGIN
    IF p_admin_id IS NULL OR p_site IS DISTINCT FROM 'cn'
        OR p_goods_no IS NULL OR LENGTH(BTRIM(p_goods_no)) NOT BETWEEN 1 AND 160
        OR p_goods_no IS DISTINCT FROM BTRIM(p_goods_no)
        OR p_name IS NULL OR LENGTH(BTRIM(p_name)) NOT BETWEEN 1 AND 100
        OR jsonb_typeof(v_variant) IS DISTINCT FROM 'object'
        OR (v_variant - 'race') <> '{}'::JSONB
        OR (v_variant ? 'race' AND (
            jsonb_typeof(v_variant->'race') IS DISTINCT FROM 'string'
            OR LENGTH(BTRIM(v_variant->>'race')) NOT BETWEEN 1 AND 160
            OR v_variant->>'race' IS DISTINCT FROM BTRIM(v_variant->>'race')))
        OR jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object'
        OR OCTET_LENGTH(p_snapshot::TEXT) > 16384 THEN
        RAISE EXCEPTION 'Invalid supplier draft import input';
    END IF;
    SELECT * INTO v_account FROM public.shop_supplier_accounts
        WHERE id = p_account_id FOR SHARE;
    IF NOT FOUND OR v_account.is_enabled IS DISTINCT FROM true
        OR v_account.provider_id IS DISTINCT FROM 'xiareng' THEN
        RAISE EXCEPTION 'Supplier read-only account unavailable';
    END IF;
    v_description := NULLIF(BTRIM(COALESCE(p_snapshot->>'description', '')), '');
    v_image_url := NULLIF(BTRIM(COALESCE(p_snapshot->>'imageUrl', '')), '');
    v_key := CASE WHEN v_variant = '{}'::JSONB THEN 'default' ELSE 'v1:' || md5(v_variant::TEXT) END;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_account_id::TEXT || ':' || p_site || ':' || p_goods_no || ':' || v_key, 0));
    SELECT * INTO v_mapping FROM public.shop_supplier_product_mappings
        WHERE supplier_account_id = p_account_id AND site = p_site
            AND supplier_goods_no = p_goods_no AND supplier_variant_key = v_key;
    IF FOUND THEN
        IF v_mapping.supplier_variant IS DISTINCT FROM v_variant THEN
            RAISE EXCEPTION 'Supplier variant identity conflict';
        END IF;
        IF v_description IS NOT NULL THEN
            UPDATE public.shop_products
               SET usage_instructions = COALESCE(NULLIF(BTRIM(usage_instructions), ''), v_description),
                   usage_instructions_zh = COALESCE(NULLIF(BTRIM(usage_instructions_zh), ''), v_description),
                   show_usage_instructions = CASE
                       WHEN NULLIF(BTRIM(usage_instructions), '') IS NULL THEN true
                       ELSE COALESCE(show_usage_instructions, true)
                   END
             WHERE id = v_mapping.product_id;
        END IF;
        IF v_image_url IS NOT NULL THEN
            UPDATE public.shop_products
               SET icon_url = COALESCE(NULLIF(BTRIM(icon_url), ''), v_image_url),
                   image_assets = CASE
                       WHEN image_assets IS NULL OR image_assets = '{}'::JSONB THEN jsonb_build_object('original', v_image_url)
                       ELSE image_assets
                   END
             WHERE id = v_mapping.product_id;
        END IF;
        RETURN jsonb_build_object('status', 'already_imported', 'productId', v_mapping.product_id,
            'skuId', v_mapping.sku_id, 'mappingId', v_mapping.id, 'variantKey', v_key, 'site', p_site);
    END IF;

    INSERT INTO public.shop_products (name, description, category, tags, price_points, price_points_intl,
        stock_count, is_active, allow_guest_purchase, usage_instructions, usage_instructions_zh, show_usage_instructions,
        icon_url, image_assets)
        VALUES (BTRIM(p_name), NULL, 'resource', '[]'::JSONB, 0, NULL, 0, false, false,
            v_description, v_description, (v_description IS NOT NULL),
            v_image_url, CASE WHEN v_image_url IS NOT NULL THEN jsonb_build_object('original', v_image_url) ELSE '{}'::JSONB END)
        RETURNING id INTO v_product_id;
    SELECT id INTO v_sku_id FROM public.shop_product_skus
        WHERE product_id = v_product_id AND is_default = true LIMIT 1;
    IF v_sku_id IS NULL THEN
        RAISE EXCEPTION 'Default SKU trigger is unavailable; draft import rolled back';
    END IF;
    INSERT INTO public.shop_supplier_product_mappings (site, supplier_account_id, product_id, sku_id,
        supplier_goods_no, supplier_variant_key, supplier_variant, import_snapshot, contract_version,
        priority, is_primary, is_enabled)
        VALUES (p_site, p_account_id, v_product_id, v_sku_id, p_goods_no, v_key, v_variant,
            p_snapshot, 2, 100, true, false) RETURNING * INTO v_mapping;
    INSERT INTO public.admin_audit_logs (admin_id, target_user_id, action_type, details)
        VALUES (p_admin_id, NULL, 'shop.supplier_catalog.import', jsonb_build_object(
            'module', 'shop', 'site', p_site, 'provider_id', v_account.provider_id,
            'supplier_account_id', p_account_id, 'supplier_goods_no', p_goods_no,
            'variant_key', v_key, 'product_id', v_product_id, 'sku_id', v_sku_id,
            'mapping_enabled', false, 'is_active', false, 'contract_version', 2));
    RETURN jsonb_build_object('status', 'imported_as_draft', 'productId', v_product_id,
            'skuId', v_sku_id, 'mappingId', v_mapping.id, 'variantKey', v_key, 'site', p_site);
END;
$$;
REVOKE ALL ON FUNCTION public.import_shop_supplier_draft_v2(UUID, TEXT, TEXT, JSONB, TEXT, JSONB, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_shop_supplier_draft_v2(UUID, TEXT, TEXT, JSONB, TEXT, JSONB, UUID) TO service_role;

COMMIT;
