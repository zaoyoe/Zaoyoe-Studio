-- Read-only checks after both TG redemption migrations. No provider requests.
DO $$
DECLARE
    v_column TEXT;
    v_signature TEXT;
    v_role TEXT;
BEGIN
    FOREACH v_column IN ARRAY ARRAY['lease_token', 'lease_expires_at', 'submitted_at'] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'tg_redemption_orders'
              AND column_name = v_column
        ) THEN
            RAISE EXCEPTION 'missing TG worker column: %', v_column;
        END IF;
    END LOOP;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.tg_redemption_orders'::regclass
          AND conname = 'tg_redemption_orders_lease_check'
    ) OR to_regclass('public.idx_tg_redemption_orders_lease') IS NULL THEN
        RAISE EXCEPTION 'missing TG worker lease constraint or index';
    END IF;
    FOREACH v_signature IN ARRAY ARRAY[
        'public.fn_tg_claim_order(uuid,uuid,integer)',
        'public.fn_tg_mark_submitted(uuid,uuid)',
        'public.fn_tg_finish_order(uuid,uuid,text,text,jsonb,text,text,timestamp with time zone)'
    ] LOOP
        IF to_regprocedure(v_signature) IS NULL THEN
            RAISE EXCEPTION 'missing TG worker RPC: %', v_signature;
        END IF;
        FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
            IF has_function_privilege(v_role, v_signature, 'EXECUTE') THEN
                RAISE EXCEPTION 'unsafe browser role % can invoke %', v_role, v_signature;
            END IF;
        END LOOP;
        IF NOT has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
            RAISE EXCEPTION 'service_role cannot invoke %', v_signature;
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM pg_proc p
            WHERE p.oid = to_regprocedure(v_signature) AND p.prosecdef
        ) THEN
            RAISE EXCEPTION 'TG worker RPC is missing SECURITY DEFINER: %', v_signature;
        END IF;
    END LOOP;
    RAISE NOTICE 'TG worker lease and RPC verification passed';
END;
$$;
