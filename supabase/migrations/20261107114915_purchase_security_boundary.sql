-- Purchase gates live on the server. Revoke every legacy overload to prevent direct RPC bypass.
-- Apply with the matching server release; browser-authenticated RPC callers are intentionally denied.
DO $$
DECLARE
    target RECORD;
BEGIN
    FOR target IN
        SELECT p.oid::regprocedure AS signature
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prokind = 'f'
          AND p.proname IN ('fn_purchase_shop_item', 'fn_purchase_shop_item_core', 'fn_purchase_shop_item_with_discounts')
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', target.signature);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', target.signature);
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.fn_audit_purchase_rpc_security()
RETURNS TABLE (
    function_name TEXT,
    signature TEXT,
    anon_execute BOOLEAN,
    authenticated_execute BOOLEAN,
    service_execute BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;
    RETURN QUERY
    SELECT p.proname::TEXT, p.oid::regprocedure::TEXT,
        has_function_privilege('anon', p.oid, 'EXECUTE'),
        has_function_privilege('authenticated', p.oid, 'EXECUTE'),
        has_function_privilege('service_role', p.oid, 'EXECUTE')
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.proname IN ('fn_purchase_shop_item', 'fn_purchase_shop_item_core', 'fn_purchase_shop_item_with_discounts')
    ORDER BY p.proname, p.oid;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_audit_purchase_rpc_security() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_audit_purchase_rpc_security() TO service_role;
