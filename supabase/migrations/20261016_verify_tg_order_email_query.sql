-- Read-only verification; execute manually after 20261016_tg_order_email_query.sql.
-- All checks should return true. No order creation, payment or fulfillment.
SELECT public.fn_tg_order_query_contract() = 1 AS contract_ready;
SELECT c.relrowsecurity AS credentials_rls_enabled,
       NOT has_table_privilege('anon', c.oid, 'SELECT') AS anon_cannot_read,
       NOT has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_cannot_read
FROM pg_class c WHERE c.oid = 'public.tg_order_query_buyers'::regclass;
SELECT p.oid::regprocedure AS function_name,
       p.prosecdef AS security_definer,
       'search_path=public, pg_temp' = ANY(p.proconfig) AS fixed_search_path,
       NOT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_cannot_execute,
       NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_cannot_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN (
    'fn_tg_upsert_query_buyer', 'fn_tg_bind_query_order', 'fn_tg_create_purchase_with_query',
    'fn_tg_reserve_code_with_query', 'fn_tg_query_order_token_hash', 'fn_tg_query_orders', 'fn_tg_order_query_contract'
) ORDER BY p.proname;
