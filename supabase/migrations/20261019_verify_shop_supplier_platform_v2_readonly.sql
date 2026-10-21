-- Run manually only after 20261019_shop_supplier_platform_v2_readonly.sql.
-- Structural evidence only: no merchant request, import, concurrency or purchase is executed.
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';

DO $$
DECLARE
    v_rpc OID := to_regprocedure('public.import_shop_supplier_draft_v2(uuid,text,text,jsonb,text,jsonb,uuid)');
    v_definition TEXT;
BEGIN
    IF v_rpc IS NULL THEN
        RAISE EXCEPTION 'Supplier read-only draft import migration is not ready';
    END IF;
    IF (SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname IN (
            'shop_supplier_accounts', 'shop_supplier_product_mappings', 'shop_supplier_availability')
        AND c.relrowsecurity) <> 3 THEN
        RAISE EXCEPTION 'Supplier tables must retain row-level security';
    END IF;
    IF (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public'
        AND table_name = 'shop_supplier_product_mappings' AND is_nullable = 'NO'
        AND column_name IN ('supplier_variant_key', 'supplier_variant', 'import_snapshot', 'contract_version')) <> 4 THEN
        RAISE EXCEPTION 'Supplier variant and snapshot columns are not ready';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_index i WHERE i.indexrelid = to_regclass('public.ux_shop_supplier_mapping_account_goods_variant')
        AND i.indisunique AND i.indisvalid AND i.indnkeyatts = 4
        AND i.indpred IS NULL AND i.indexprs IS NULL
        AND (SELECT array_agg(a.attname::TEXT ORDER BY k.ordinality)
            FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ordinality)
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
            WHERE k.ordinality <= i.indnkeyatts)
            = ARRAY['supplier_account_id', 'site', 'supplier_goods_no', 'supplier_variant_key']::TEXT[]
    ) THEN
        RAISE EXCEPTION 'Supplier variant unique index is not ready';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.shop_supplier_product_mappings'::regclass
        AND conname = 'shop_supplier_product_mappings_account_goods_unique') THEN
        RAISE EXCEPTION 'Legacy goods-only uniqueness still blocks separate variants';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
        AND table_name = 'shop_supplier_availability' AND column_name = 'currency'
        AND is_nullable = 'YES' AND column_default IS NULL) THEN
        RAISE EXCEPTION 'Unknown supplier currency must remain nullable without a default';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.shop_supplier_accounts
        WHERE provider_id = 'xiareng' AND account_key = 'default' AND credential_ref = 'env:SUPPLIER_XIARENG') THEN
        RAISE EXCEPTION 'Xiareng account reference is not provisioned';
    END IF;
    -- An operator can separately enable read access later; never change its flag here.
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'public.shop_products'::regclass
        AND tgname = 'tr_shop_products_ensure_default_sku' AND NOT tgisinternal AND tgenabled IN ('O', 'A')) THEN
        RAISE EXCEPTION 'The default product SKU trigger is unavailable';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_rpc AND prosecdef
        AND proconfig @> ARRAY['search_path=public, pg_temp']::TEXT[]) THEN
        RAISE EXCEPTION 'Supplier import RPC must retain its fixed SECURITY DEFINER search path';
    END IF;
    IF has_function_privilege('anon', v_rpc, 'EXECUTE')
        OR has_function_privilege('authenticated', v_rpc, 'EXECUTE')
        OR NOT has_function_privilege('service_role', v_rpc, 'EXECUTE') THEN
        RAISE EXCEPTION 'Supplier import RPC privileges are not service-role-only';
    END IF;
    v_definition := pg_get_functiondef(v_rpc);
    IF POSITION('pg_advisory_xact_lock' IN v_definition) = 0
        OR POSITION('FOR SHARE' IN v_definition) = 0
        OR POSITION('shop_supplier_product_mappings' IN v_definition) = 0
        OR POSITION('admin_audit_logs' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'Supplier import lock, mapping or audit structure is missing';
    END IF;
END;
$$;

SELECT 'Supplier P0/P1 structural checks passed; concurrent/merchant/business acceptance remains NOT RUN' AS result;
COMMIT;
