-- P2E structural verification only. Does not execute the scheduler or merchants.
BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE v_name TEXT; v_definition TEXT; v_shared_pos INTEGER; v_start_pos INTEGER; v_finish_pos INTEGER; v_outcome_pos INTEGER;
BEGIN
    FOREACH v_name IN ARRAY ARRAY['shop_supplier_runtime_accounts','shop_supplier_runtime_jobs','shop_supplier_runtime_resumes'] LOOP
        IF to_regclass('public.' || v_name) IS NULL THEN RAISE EXCEPTION 'Supplier runtime table missing: %',v_name; END IF;
        IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.' || v_name)) THEN
            RAISE EXCEPTION 'Supplier runtime RLS missing: %',v_name;
        END IF;
        IF has_table_privilege('anon','public.' || v_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            OR has_table_privilege('authenticated','public.' || v_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            OR has_table_privilege('service_role','public.' || v_name,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
            RAISE EXCEPTION 'Supplier runtime table mutation exposed: %',v_name;
        END IF;
    END LOOP;
    IF to_regprocedure('public.fn_shop_supplier_runtime_v2(text,uuid,uuid,text,text,text[],integer,uuid)') IS NULL THEN
        RAISE EXCEPTION 'Supplier runtime function missing';
    END IF;
    IF has_function_privilege('anon','public.fn_shop_supplier_runtime_v2(text,uuid,uuid,text,text,text[],integer,uuid)','EXECUTE')
        OR has_function_privilege('authenticated','public.fn_shop_supplier_runtime_v2(text,uuid,uuid,text,text,text[],integer,uuid)','EXECUTE')
        OR NOT has_function_privilege('service_role','public.fn_shop_supplier_runtime_v2(text,uuid,uuid,text,text,text[],integer,uuid)','EXECUTE') THEN
        RAISE EXCEPTION 'Supplier runtime function authorization invalid';
    END IF;
    FOREACH v_name IN ARRAY ARRAY['shop_supplier_runtime_plan_v2(uuid)',
        'shop_supplier_runtime_projection_v2(uuid)','shop_supplier_runtime_resume_immutable_v2()'] LOOP
        IF to_regprocedure('public.' || v_name) IS NULL
            OR has_function_privilege('anon','public.' || v_name,'EXECUTE')
            OR has_function_privilege('authenticated','public.' || v_name,'EXECUTE')
            OR has_function_privilege('service_role','public.' || v_name,'EXECUTE') THEN
            RAISE EXCEPTION 'Supplier runtime helper authorization invalid: %',v_name;
        END IF;
    END LOOP;
    SELECT pg_get_functiondef('public.fn_shop_supplier_runtime_v2(text,uuid,uuid,text,text,text[],integer,uuid)'::REGPROCEDURE) INTO v_definition;
    v_shared_pos := position('IF p_token IS NULL OR v_job.lease_token IS DISTINCT FROM p_token' IN v_definition);
    v_start_pos := position('IF p_action = ''start'' THEN' IN v_definition);
    v_finish_pos := position('IF p_action = ''finish'' AND' IN v_definition);
    v_outcome_pos := position('IF p_outcome IS NULL' IN v_definition);
    IF position('supplier_service_role_required' IN v_definition) = 0 OR position('INTERVAL ''90 seconds''' IN v_definition) = 0
        OR position('v_job.state <> ''running''' IN v_definition) = 0
        OR position('v_job.request_started_at IS NULL' IN v_definition) = 0
        OR position('v_job.request_started_at IS NOT NULL' IN v_definition) = 0
        OR position('request_started_at = NULL' IN v_definition) = 0
        OR v_shared_pos = 0 OR v_start_pos = 0 OR v_finish_pos = 0 OR v_outcome_pos = 0
        OR NOT (v_finish_pos > v_start_pos AND v_outcome_pos > v_finish_pos)
        OR position('request_started_at' IN substring(v_definition FROM v_shared_pos FOR v_start_pos - v_shared_pos)) > 0
        OR position('v_job.request_started_at IS NOT NULL' IN substring(v_definition FROM v_start_pos FOR v_finish_pos - v_start_pos)) = 0
        OR position('request_started_at = v_now' IN substring(v_definition FROM v_start_pos FOR v_finish_pos - v_start_pos)) = 0
        OR position('v_job.state <> ''running''' IN substring(v_definition FROM v_finish_pos FOR v_outcome_pos - v_finish_pos)) = 0
        OR position('v_job.request_started_at IS NULL' IN substring(v_definition FROM v_finish_pos FOR v_outcome_pos - v_finish_pos)) = 0
        OR position('v_plan.deadline_at <= v_now' IN v_definition) = 0
        OR position('v_account.lease_token IS DISTINCT FROM p_token' IN v_definition) = 0
        OR position('v_account.lease_intent_id IS DISTINCT FROM p_intent_id' IN v_definition) = 0
        OR position('v_job.lease_expires_at <= v_now' IN v_definition) = 0
        OR position('v_account.lease_expires_at <= v_now' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'Supplier runtime fencing/bounds contract missing';
    END IF;
    SELECT pg_get_functiondef('public.fn_shop_supplier_operations_v2(text,text,integer,uuid,text,text)'::REGPROCEDURE) INTO v_definition;
    IF position('shop_supplier_runtime_projection_v2' IN v_definition) = 0
        OR position('customerResolution' IN v_definition) = 0 OR position('canResolve' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'Supplier runtime admin/customer projection incomplete';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.shop_supplier_runtime_resumes'::REGCLASS
        AND tgname = 'tr_supplier_runtime_resume_immutable_v2' AND tgenabled <> 'D') THEN
        RAISE EXCEPTION 'Supplier runtime immutable resume receipt missing';
    END IF;
END;
$$;
SELECT 'Supplier P2E runtime structural checks passed; concurrent/business acceptance remains NOT RUN' AS result;
COMMIT;
