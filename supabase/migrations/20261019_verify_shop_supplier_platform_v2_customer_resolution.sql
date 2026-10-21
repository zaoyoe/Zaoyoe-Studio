-- Read-only structural evidence. No refund, fixture, merchant or business test.
BEGIN;
SET TRANSACTION READ ONLY;
DO $$
DECLARE v_role TEXT; v_function REGPROCEDURE; v_name TEXT; v_source TEXT;
BEGIN
    IF to_regclass('public.shop_supplier_customer_resolutions') IS NULL THEN
        RAISE EXCEPTION 'Supplier P2D-2 customer resolution is not ready'; END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.shop_supplier_customer_resolutions'::REGCLASS) THEN
        RAISE EXCEPTION 'Supplier customer resolution RLS missing'; END IF;
    FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
        IF has_table_privilege(v_role,'public.shop_supplier_customer_resolutions','INSERT,UPDATE,DELETE,TRUNCATE') THEN
            RAISE EXCEPTION 'Supplier resolution direct write grant: %',v_role; END IF;
    END LOOP;
    FOREACH v_name IN ARRAY ARRAY['fn_shop_supplier_resolve_customer_v2(text,uuid,uuid,uuid,text,jsonb)',
        'fn_shop_supplier_recover_points_v2(uuid,uuid,text)'] LOOP
        v_function := to_regprocedure('public.' || v_name);
        IF v_function IS NULL THEN RAISE EXCEPTION 'Missing function: %',v_name; END IF;
        FOREACH v_role IN ARRAY ARRAY['anon','authenticated'] LOOP
            IF has_function_privilege(v_role,v_function,'EXECUTE') THEN RAISE EXCEPTION 'Public resolution function grant'; END IF;
        END LOOP;
        IF NOT has_function_privilege('service_role',v_function,'EXECUTE') THEN RAISE EXCEPTION 'Missing service role function grant'; END IF;
    END LOOP;
    FOREACH v_name IN ARRAY ARRAY['shop_orders','guest_shop_orders'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.' || v_name)
            AND tgname = 'tr_supplier_resolution_native_guard_v2' AND tgenabled IN ('O','A') AND NOT tgisinternal) THEN
            RAISE EXCEPTION 'Supplier resolution guard missing: %',v_name; END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
            AND table_name = v_name AND column_name = 'supplier_customer_resolution') THEN
            RAISE EXCEPTION 'Customer projection missing: %',v_name; END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.shop_supplier_customer_resolutions'::REGCLASS
        AND tgname = 'tr_supplier_resolution_immutable_v2' AND tgenabled IN ('O','A')) THEN
        RAISE EXCEPTION 'Immutable resolution receipt missing'; END IF;
    v_source := pg_get_functiondef('public.shop_supplier_dispatch_native_guard_v2()'::REGPROCEDURE);
    IF position('shop_supplier_resolution_projection_matches_v2' IN v_source) = 0
        OR position('supplier_dispatch_resolution_required' IN v_source) = 0 THEN
        RAISE EXCEPTION 'Original dispatch guard must retain receipt-based authorization'; END IF;
    v_source := pg_get_functiondef('public.fn_shop_supplier_customer_delivery_v2(uuid,text,uuid,text)'::REGPROCEDURE);
    IF position('shop_supplier_customer_resolutions' IN v_source) = 0 THEN RAISE EXCEPTION 'Closed delivery guard missing'; END IF;
END; $$;
SELECT 'Supplier P2D-2 customer resolution structural checks passed; concurrent/business acceptance remains NOT RUN' AS result;
COMMIT;
