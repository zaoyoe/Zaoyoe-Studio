-- Run manually AFTER 20261017_tg_purchase_upstream_recovery.sql.
-- Read-only structural verification. No orders/evidence/attempts are created or modified.
BEGIN TRANSACTION READ ONLY;
DO $$
DECLARE
    v_source TEXT;
    v_signature TEXT := 'public.fn_tg_apply_purchase_recovery(text,uuid,text,uuid,text,timestamptz,timestamptz,text,text,jsonb,timestamptz,jsonb)';
    v_immutable TEXT;
BEGIN
    IF to_regprocedure('public.fn_tg_purchase_recovery_ready()') IS NULL THEN
        RAISE EXCEPTION 'Apply TG purchase upstream recovery migration first';
    END IF;
    IF NOT public.fn_tg_purchase_recovery_ready() THEN
        RAISE EXCEPTION 'TG purchase upstream recovery is not ready';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure(v_signature) AND prosecdef
        AND proconfig @> ARRAY['search_path=public, pg_temp']) THEN
        RAISE EXCEPTION 'TG recovery service-only definer guard missing';
    END IF;
    SELECT pg_get_functiondef(to_regprocedure(v_signature)) INTO v_source;
    IF strpos(v_source, 'v_order.updated_at IS DISTINCT FROM p_expected_updated_at') = 0
       OR strpos(v_source, 'v_task.updated_at IS DISTINCT FROM p_expected_task_updated_at') = 0
       OR strpos(v_source, 'v_task.lease_token IS NOT NULL OR v_task.lease_expires_at IS NOT NULL') = 0
       OR strpos(v_source, 'v_task.submitted_at IS NULL') = 0
       OR strpos(v_source, 'v_task.attempt_count < 1') = 0
       OR strpos(v_source, 'v_order.payment_status <> ''paid''') = 0
       OR strpos(v_source, 'v_task.telegram_username IS DISTINCT FROM v_order.telegram_username') = 0
       OR strpos(v_source, 'v_task.stars_quantity IS DISTINCT FROM v_order.stars_quantity') = 0 THEN
        RAISE EXCEPTION 'TG recovery identity, version, payment or worker fence missing';
    END IF;
    IF strpos(v_source, 'p_check->>''verified_by'' = ''order_get''') = 0
       OR strpos(v_source, 'p_check->''idempotency_key_matches'' = ''true''::JSONB') = 0
       OR strpos(v_source, 'p_check->>''provider_order_id'' = v_provider_id') = 0
       OR strpos(v_source, 'p_check->>''currency'' = CASE v_task.provider_payment_currency') = 0
       OR strpos(v_source, 'p_check->>''stars_quantity'' = v_task.stars_quantity::TEXT') = 0
       OR strpos(v_source, 'p_check->>''term_months'' = v_task.term_months::TEXT') = 0
       OR strpos(v_source, 'lower(other.provider_order_id) = v_provider_id') = 0
       OR strpos(v_source, 'EXCEPTION WHEN unique_violation') = 0 THEN
        RAISE EXCEPTION 'TG recovery original order proof or ownership fence missing';
    END IF;
    IF strpos(v_source, 'p_evidence->>''verification'' IS DISTINCT FROM ''operator_attestation''') = 0
       OR strpos(v_source, 'p_evidence->''confirm_nonacceptance'' IS DISTINCT FROM ''true''::JSONB') = 0
       OR strpos(v_source, 'p_evidence->''confirm_payment_handled'' IS DISTINCT FROM ''true''::JSONB') = 0
       OR strpos(v_source, 'p_check#>''{search,exhausted}'' IS DISTINCT FROM ''true''::JSONB') = 0
       OR strpos(v_source, 'v_confirmed_at < v_task.submitted_at') = 0
       OR strpos(v_source, 'v_existing.request_hash IS DISTINCT FROM p_request_hash') = 0
       OR strpos(v_source, 'v_existing.actor_user_id IS DISTINCT FROM p_actor_id') = 0
       OR strpos(v_source, 'INSERT INTO public.tg_purchase_recovery_events') = 0
       OR strpos(v_source, 'INSERT INTO public.tg_audit_events') = 0 THEN
        RAISE EXCEPTION 'TG recovery nonacceptance evidence or idempotency guard missing';
    END IF;
    IF v_source ~* '(provider_idempotency_key|submitted_at|attempt_count)[[:space:]]*=' THEN
        RAISE EXCEPTION 'TG recovery must preserve original submission markers and attempts';
    END IF;
    SELECT pg_get_functiondef('public.tg_recovery_evidence_immutable()'::regprocedure) INTO v_immutable;
    IF strpos(v_immutable, 'TG recovery evidence is append-only') = 0 THEN
        RAISE EXCEPTION 'TG recovery immutable evidence trigger missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.ux_tg_provider_order_casefold')
        AND indisunique AND indisvalid AND pg_get_indexdef(indexrelid) LIKE '%lower(provider_order_id)%') THEN
        RAISE EXCEPTION 'TG recovery case-folded provider ownership index missing';
    END IF;
END;
$$;
SELECT 'TG upstream recovery structural checks passed; concurrent/business acceptance remains NOT RUN' AS result;
COMMIT;
