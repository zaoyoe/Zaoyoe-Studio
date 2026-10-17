-- Operator-applied, read-only verification after 20261017_tg_data_center.sql.
-- This checks schema, privileges and executable read projections only.
-- It does not certify real receipts, concurrency or business reconciliation.
BEGIN READ ONLY;
DO $$
DECLARE
    v_signature TEXT; v_oid OID; v_view TEXT; v_module TEXT; v_kind TEXT;
    v_payload JSONB; v_now TIMESTAMPTZ := now();
    v_from TIMESTAMPTZ := date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai';
BEGIN
    FOREACH v_signature IN ARRAY ARRAY[
        'public.fn_tg_admin_data_center(text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone)',
        'public.fn_tg_admin_data_center_list(text,jsonb,timestamp with time zone,integer,integer)'
    ] LOOP
        v_oid := to_regprocedure(v_signature);
        IF v_oid IS NULL THEN RAISE EXCEPTION 'Missing TG reporting RPC: %', v_signature; END IF;
        IF has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
            OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
            RAISE EXCEPTION 'Invalid TG reporting RPC grants: %', v_signature;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_oid AND prosecdef AND provolatile = 's'
            AND proconfig @> ARRAY['search_path=public, pg_temp']) THEN
            RAISE EXCEPTION 'Invalid TG reporting read-only security context: %', v_signature;
        END IF;
    END LOOP;
    FOREACH v_view IN ARRAY ARRAY['public.tg_admin_purchase_facts', 'public.tg_admin_code_facts'] LOOP
        IF to_regclass(v_view) IS NULL THEN RAISE EXCEPTION 'Missing TG reporting view: %', v_view; END IF;
        IF has_table_privilege('anon', v_view, 'SELECT') OR has_table_privilege('authenticated', v_view, 'SELECT')
            OR NOT has_table_privilege('service_role', v_view, 'SELECT') THEN
            RAISE EXCEPTION 'Invalid TG reporting view grants: %', v_view;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass(v_view) AND attnum > 0 AND NOT attisdropped
            AND attname IN ('verified_payment', 'crypto_checkout', 'status_token_hash', 'query_secret_hash', 'code_digest', 'code_ciphertext', 'provider_payload', 'metadata')) THEN
            RAISE EXCEPTION 'Unsafe raw material in TG reporting view: %', v_view;
        END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_tg_redemption_orders_purchase') AND indisunique AND indisvalid)
        OR NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_tg_purchase_paid_reporting') AND indisvalid)
        OR NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.idx_tg_fulfillment_completed_reporting') AND indisvalid) THEN
        RAISE EXCEPTION 'Missing valid TG reporting / fulfillment uniqueness indexes';
    END IF;
    IF public.tg_admin_decimal('1.23456789') IS DISTINCT FROM 1.23456789::NUMERIC
        OR public.tg_admin_decimal('not-an-amount') IS NOT NULL
        OR public.tg_admin_attention_reason('manual_review', 'closed', v_now, v_now - interval '1 day', v_now) IS NOT NULL
        OR public.tg_admin_attention_reason('paid', 'succeeded', NULL, v_now - interval '1 day', v_now) IS NOT NULL
        OR public.tg_admin_attention_reason('paid', 'pending', NULL, v_now - interval '31 minutes', v_now) IS DISTINCT FROM 'overdue'
        OR public.tg_admin_code_matches('available', 'disabled', v_now - interval '1 day', NULL, v_now, 'available') IS DISTINCT FROM false
        OR public.tg_admin_code_matches('available', 'active', v_now - interval '1 day', v_now + interval '6 days', v_now, 'expiring') IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'TG reporting helper contract is not ready';
    END IF;
    -- Read-only calls also resolve references inside PL/pgSQL bodies, which
    -- CREATE FUNCTION alone does not fully validate. No rows are printed.
    FOREACH v_module IN ARRAY ARRAY['business', 'operations', 'inventory'] LOOP
        v_payload := public.fn_tg_admin_data_center(v_module, v_from, v_now, v_from - interval '1 day', v_now - interval '1 day', v_now);
        IF v_payload->>'module' IS DISTINCT FROM v_module OR v_payload->>'version' IS DISTINCT FROM '1' THEN
            RAISE EXCEPTION 'Invalid TG reporting module projection: %', v_module;
        END IF;
    END LOOP;
    FOREACH v_kind IN ARRAY ARRAY['purchase', 'order', 'batch', 'code'] LOOP
        v_payload := public.fn_tg_admin_data_center_list(v_kind,
            CASE WHEN v_kind = 'code' THEN '{"inventory":"available","batch_id":"00000000-0000-0000-0000-000000000000"}'::JSONB
                ELSE '{}'::JSONB END, v_now, 1, 1);
        IF jsonb_typeof(v_payload->'rows') IS DISTINCT FROM 'array' OR jsonb_typeof(v_payload->'total') IS DISTINCT FROM 'number' THEN
            RAISE EXCEPTION 'Invalid TG reporting drilldown projection: %', v_kind;
        END IF;
    END LOOP;
END;
$$;
SELECT 'TG data center structural/read-only checks passed; concurrent/business acceptance remains NOT RUN' AS result;
COMMIT;
