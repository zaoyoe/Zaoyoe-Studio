-- P0/P1 only. Review/apply manually. No procurement/order/payment path is enabled.
BEGIN;

ALTER TABLE public.shop_supplier_product_mappings
    ADD COLUMN IF NOT EXISTS supplier_variant_key TEXT NOT NULL DEFAULT 'default',
    ADD COLUMN IF NOT EXISTS supplier_variant JSONB NOT NULL DEFAULT '{}'::JSONB,
    ADD COLUMN IF NOT EXISTS import_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
    ADD COLUMN IF NOT EXISTS contract_version SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE public.shop_supplier_product_mappings
    DROP CONSTRAINT IF EXISTS shop_supplier_product_mappings_account_goods_unique;
CREATE UNIQUE INDEX IF NOT EXISTS ux_shop_supplier_mapping_account_goods_variant
    ON public.shop_supplier_product_mappings (supplier_account_id, site, supplier_goods_no, supplier_variant_key);

-- Do not default an unverified upstream amount to CNY. Existing rows retain
-- their original values; legacy adapters continue to supply explicit currency.
ALTER TABLE public.shop_supplier_availability ALTER COLUMN currency DROP NOT NULL;
ALTER TABLE public.shop_supplier_availability ALTER COLUMN currency DROP DEFAULT;

INSERT INTO public.shop_supplier_accounts (provider_id, account_key, display_name, credential_ref, is_enabled)
VALUES ('xiareng', 'default', '虾仁默认账号（只读）', 'env:SUPPLIER_XIARENG', false)
ON CONFLICT (provider_id, account_key) DO NOTHING;

-- This transaction owns variant identity and import deduplication. It does not
-- change an existing product, mapping, price, availability or publication flag.
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
    v_key := CASE WHEN v_variant = '{}'::JSONB THEN 'default' ELSE 'v1:' || md5(v_variant::TEXT) END;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_account_id::TEXT || ':' || p_site || ':' || p_goods_no || ':' || v_key, 0));
    SELECT * INTO v_mapping FROM public.shop_supplier_product_mappings
        WHERE supplier_account_id = p_account_id AND site = p_site
            AND supplier_goods_no = p_goods_no AND supplier_variant_key = v_key;
    IF FOUND THEN
        IF v_mapping.supplier_variant IS DISTINCT FROM v_variant THEN
            RAISE EXCEPTION 'Supplier variant identity conflict';
        END IF;
        RETURN jsonb_build_object('status', 'already_imported', 'productId', v_mapping.product_id,
            'skuId', v_mapping.sku_id, 'mappingId', v_mapping.id, 'variantKey', v_key, 'site', p_site);
    END IF;

    INSERT INTO public.shop_products (name, description, category, tags, price_points, price_points_intl,
        stock_count, is_active, allow_guest_purchase)
        VALUES (BTRIM(p_name), NULL, 'resource', '[]'::JSONB, 0, NULL, 0, false, false)
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

COMMENT ON COLUMN public.shop_supplier_product_mappings.import_snapshot IS
    'Admin-only, sanitized catalog reference at draft import; neither locked stock nor a settled procurement cost.';
COMMENT ON FUNCTION public.import_shop_supplier_draft_v2(UUID, TEXT, TEXT, JSONB, TEXT, JSONB, UUID) IS
    'CN Xiareng read-only draft import, atomically deduplicated by account/site/goods/variant; procurement stays unavailable.';
COMMIT;
