-- Migration: 20261111_retire_hupijiao_and_afdian_entrypoints.sql
-- Description: Safely revoke and drop legacy Afdian payment processing functions if they exist.

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT p.oid::regprocedure AS func_sig
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
          AND p.proname IN ('fn_process_afdian_payment', 'fn_finalize_afdian_custom_payment')
    ) LOOP
        EXECUTE 'REVOKE ALL ON FUNCTION ' || r.func_sig || ' FROM PUBLIC, service_role, anon, authenticated';
        EXECUTE 'DROP FUNCTION ' || r.func_sig || ' CASCADE';
    END LOOP;
END $$;

-- Idempotent fallback drops for known historical signatures
DROP FUNCTION IF EXISTS public.fn_process_afdian_payment(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, UUID, TEXT, VARCHAR, BOOLEAN, BOOLEAN, JSONB, TEXT, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.fn_process_afdian_payment(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, UUID, TEXT, VARCHAR, BOOLEAN, BOOLEAN, JSONB, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.fn_finalize_afdian_custom_payment(TEXT, UUID, VARCHAR, INTEGER, NUMERIC, TEXT, TEXT) CASCADE;
