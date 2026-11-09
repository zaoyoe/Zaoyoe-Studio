-- ============================================================================
-- Security Audit & RLS Hardening Migration
-- Date: 2026-11-07
-- Purpose:
-- 1. Create audit function to report tables lacking Row Level Security (RLS).
-- 2. Ensure RLS is active on core business, order, auth, and secret tables.
-- 3. Defend against unauthorized anon-key data dumping via Supabase PostgREST.
-- ============================================================================

-- 1. Diagnostic Function: List any public table with RLS disabled
CREATE OR REPLACE FUNCTION public.fn_audit_unprotected_tables()
RETURNS TABLE (
    schema_name text,
    table_name text,
    is_rls_enabled boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT 
        schemaname::text AS schema_name, 
        tablename::text AS table_name, 
        rowsecurity AS is_rls_enabled
    FROM pg_tables 
    WHERE schemaname = 'public' 
      AND rowsecurity = false
    ORDER BY tablename ASC;
$$;

REVOKE ALL ON FUNCTION public.fn_audit_unprotected_tables() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_audit_unprotected_tables() TO service_role;

COMMENT ON FUNCTION public.fn_audit_unprotected_tables() IS 'Audits public tables missing Row Level Security (RLS)';

-- 2. Enable RLS on sensitive operational and business tables (idempotent)
DO $$
DECLARE
    target_table text;
    sensitive_tables text[] := ARRAY[
        'discount_event_logs',
        'discount_user_assets',
        'homepage_site_drafts',
        'homepage_site_releases',
        'homepage_site_schedules',
        'homepage_site_templates',
        'marketing_asset_workflow_runs',
        'marketing_asset_workflows',
        'shop_webhook_task_attempts',
        'shop_webhook_task_conflicts',
        'admin_roles',
        'system_config',
        'ops_alert_cases',
        'shop_risk_cases',
        'payment_anomaly_cases',
        'payment_query_attempts',
        'guest_shop_buyers',
        'guest_shop_access_attempts',
        'guest_shop_access_resets',
        'tg_purchase_orders',
        'tg_purchase_quotes',
        'google_one_activation_jobs',
        'google_one_activation_audit',
        'google_one_activation_rate_events',
        'shop_supplier_runtime_accounts',
        'shop_supplier_runtime_jobs',
        'shop_supplier_customer_resolutions'
    ];
BEGIN
    FOREACH target_table IN ARRAY sensitive_tables LOOP
        IF EXISTS (
            SELECT 1 FROM pg_tables 
            WHERE schemaname = 'public' AND tablename = target_table
        ) THEN
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', target_table);
            
            -- Ensure service_role policy exists so backend functions can manage rows
            IF NOT EXISTS (
                SELECT 1 FROM pg_policies 
                WHERE schemaname = 'public' 
                  AND tablename = target_table 
                  AND policyname = 'service_role_all_access'
            ) THEN
                EXECUTE format(
                    'CREATE POLICY service_role_all_access ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);',
                    target_table
                );
            END IF;
        END IF;
    END LOOP;
END $$;

-- 3. Targeted user-level read policy for discount assets
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'discount_user_assets'
    ) THEN
        DROP POLICY IF EXISTS users_read_own_discount_assets ON public.discount_user_assets;
        CREATE POLICY users_read_own_discount_assets
        ON public.discount_user_assets
        FOR SELECT
        TO authenticated
        USING (auth.uid() = user_id);
    END IF;
END $$;
