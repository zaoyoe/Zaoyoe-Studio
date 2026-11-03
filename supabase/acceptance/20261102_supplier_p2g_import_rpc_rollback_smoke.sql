-- Rollback-only integration smoke for the isolated supplier P2G baseline.
-- Target only supabase_db_shop-supplier-p2g-baseline-20261102 on colima-p2g
-- (localhost:55453). This script creates temporary test rows inside one
-- transaction and always rolls them back. It never calls the Xiareng API.

BEGIN;

DO $$
DECLARE
    v_target TEXT := current_setting('app.supplier_p2g_target', true);
BEGIN
    IF current_database() <> 'postgres' THEN
        RAISE EXCEPTION 'Refusing supplier smoke outside the expected postgres database';
    END IF;

    IF v_target IS DISTINCT FROM 'supabase_db_shop-supplier-p2g-baseline-20261102' THEN
        RAISE EXCEPTION 'Refusing supplier smoke without the isolated P2G container marker';
    END IF;
END;
$$;

INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
VALUES (
    '00000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'supplier-p2g-smoke-20261102@example.invalid',
    NOW(),
    NOW()
);

DO $$
DECLARE
    v_updated INTEGER;
BEGIN
    UPDATE public.shop_supplier_accounts
    SET is_enabled = true
    WHERE provider_id = 'xiareng'
      AND account_key = 'default'
      AND is_enabled = false;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated <> 1 THEN
        RAISE EXCEPTION 'Expected exactly one disabled Xiareng default account, updated %', v_updated;
    END IF;
END;
$$;

SET LOCAL ROLE service_role;

DO $$
DECLARE
    v_account_id UUID;
    v_first JSONB;
    v_second JSONB;
    v_product_id UUID;
    v_sku_id UUID;
    v_count INTEGER;
    v_is_active BOOLEAN;
    v_allow_guest_purchase BOOLEAN;
    v_mapping_enabled BOOLEAN;
    v_is_default BOOLEAN;
BEGIN
    SELECT id INTO STRICT v_account_id
    FROM public.shop_supplier_accounts
    WHERE provider_id = 'xiareng' AND account_key = 'default';

    v_first := public.import_shop_supplier_draft_v2(
        v_account_id,
        'cn',
        'P2G-ROLLBACK-SMOKE-20261102',
        '{}'::JSONB,
        'P2G rollback smoke draft',
        '{"source":"acceptance-smoke","priceKind":"member_reference"}'::JSONB,
        '00000000-0000-0000-0000-000000000002'::UUID
    );

    IF v_first->>'status' <> 'imported_as_draft' THEN
        RAISE EXCEPTION 'First import did not create a draft: %', v_first->>'status';
    END IF;

    v_product_id := (v_first->>'productId')::UUID;
    v_sku_id := (v_first->>'skuId')::UUID;

    SELECT is_active, allow_guest_purchase
    INTO STRICT v_is_active, v_allow_guest_purchase
    FROM public.shop_products
    WHERE id = v_product_id;
    IF v_is_active OR v_allow_guest_purchase THEN
        RAISE EXCEPTION 'Imported product was not safely disabled';
    END IF;

    SELECT is_default INTO STRICT v_is_default
    FROM public.shop_product_skus
    WHERE id = v_sku_id AND product_id = v_product_id;
    IF NOT v_is_default THEN
        RAISE EXCEPTION 'Imported draft has no expected default SKU';
    END IF;

    SELECT is_enabled INTO STRICT v_mapping_enabled
    FROM public.shop_supplier_product_mappings
    WHERE supplier_account_id = v_account_id
      AND site = 'cn'
      AND supplier_goods_no = 'P2G-ROLLBACK-SMOKE-20261102';
    IF v_mapping_enabled THEN
        RAISE EXCEPTION 'Imported supplier mapping was enabled';
    END IF;

    v_second := public.import_shop_supplier_draft_v2(
        v_account_id,
        'cn',
        'P2G-ROLLBACK-SMOKE-20261102',
        '{}'::JSONB,
        'P2G rollback smoke draft',
        '{"source":"acceptance-smoke","priceKind":"member_reference"}'::JSONB,
        '00000000-0000-0000-0000-000000000002'::UUID
    );

    IF v_second->>'status' <> 'already_imported'
       OR (v_second->>'productId')::UUID <> v_product_id
       OR (v_second->>'skuId')::UUID <> v_sku_id THEN
        RAISE EXCEPTION 'Repeated import was not idempotent: %', v_second->>'status';
    END IF;

    SELECT COUNT(*) INTO v_count
    FROM public.shop_supplier_product_mappings
    WHERE supplier_account_id = v_account_id
      AND site = 'cn'
      AND supplier_goods_no = 'P2G-ROLLBACK-SMOKE-20261102';
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'Expected one mapping after replay, found %', v_count;
    END IF;

    SELECT COUNT(*) INTO v_count
    FROM public.admin_audit_logs
    WHERE action_type = 'shop.supplier_catalog.import'
      AND details->>'supplier_goods_no' = 'P2G-ROLLBACK-SMOKE-20261102';
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'Expected one audit record after replay, found %', v_count;
    END IF;

    RAISE NOTICE 'PASS: draft, default SKU, disabled mapping, replay idempotency, single audit record';
END;
$$;

RESET ROLE;
ROLLBACK;
