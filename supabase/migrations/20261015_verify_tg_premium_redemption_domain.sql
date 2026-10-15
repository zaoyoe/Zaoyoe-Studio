-- Read-only verification for 20261015_add_tg_premium_redemption_domain.sql.
-- Run this after applying the migration; it raises on a missing table, index,
-- constraint, RLS setting, or unsafe browser role grant.

DO $$
DECLARE
    v_table TEXT;
    v_constraint TEXT;
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'tg_redemption_batches',
        'tg_redemption_codes',
        'tg_redemption_orders',
        'tg_fulfillment_attempts',
        'tg_audit_events'
    ] LOOP
        IF to_regclass('public.' || v_table) IS NULL THEN
            RAISE EXCEPTION 'missing TG table: public.%', v_table;
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relname = v_table
              AND c.relrowsecurity
        ) THEN
            RAISE EXCEPTION 'RLS is disabled on public.%', v_table;
        END IF;
    END LOOP;

    FOREACH v_constraint IN ARRAY ARRAY[
        'tg_redemption_batches_term_months_check',
        'tg_redemption_codes_status_check',
        'tg_redemption_orders_status_check',
        'tg_redemption_orders_idempotency_key_hash_check',
        'tg_redemption_orders_provider_idempotency_key_check',
        'tg_fulfillment_attempts_status_check'
    ] LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE connamespace = 'public'::regnamespace
              AND conname = v_constraint
        ) THEN
            RAISE EXCEPTION 'missing TG constraint: %', v_constraint;
        END IF;
    END LOOP;

    IF has_table_privilege('anon', 'public.tg_redemption_codes', 'SELECT')
       OR has_table_privilege('authenticated', 'public.tg_redemption_codes', 'SELECT') THEN
        RAISE EXCEPTION 'TG bearer-code table is readable by a browser role';
    END IF;

    IF has_table_privilege('anon', 'public.tg_redemption_batch_stats', 'SELECT')
       OR has_table_privilege('authenticated', 'public.tg_redemption_batch_stats', 'SELECT') THEN
        RAISE EXCEPTION 'TG batch stats view is readable by a browser role';
    END IF;

    IF to_regprocedure('public.fn_tg_generate_batch(text,integer,integer,timestamp with time zone,uuid,jsonb,jsonb)') IS NULL
       OR to_regprocedure('public.fn_tg_revoke_codes(uuid,uuid,uuid,text)') IS NULL
       OR to_regprocedure('public.fn_tg_reserve_code(text,text,character,character)') IS NULL
       OR to_regprocedure('public.fn_tg_order_status(text,character)') IS NULL THEN
        RAISE EXCEPTION 'missing TG server RPC';
    END IF;

    RAISE NOTICE 'TG Premium redemption domain verification passed';
END;
$$;

