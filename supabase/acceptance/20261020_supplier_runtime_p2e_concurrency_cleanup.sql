-- P2E runtime concurrency acceptance cleanup.
--
-- Run only after session A hold has committed and both session-B scripts have
-- returned. Use the database owner/maintenance role if the normal service_role
-- cannot mutate the private runtime tables. This deletes runtime coordination
-- rows for one explicitly marked disabled test account only. It never deletes a
-- native order, funding row, supplier account, product, or credential.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TEMP TABLE _supplier_runtime_concurrency_cleanup AS
SELECT DISTINCT ra.supplier_account_id
FROM public.shop_supplier_runtime_accounts ra
JOIN public.shop_supplier_accounts a ON a.id = ra.supplier_account_id
WHERE a.is_enabled = false
  AND (
      lower(coalesce(a.account_key, '')) ~ '(^|[^a-z])(test|fixture|sandbox)([^a-z]|$)'
      OR lower(coalesce(a.credential_ref, '')) ~ '(test|fixture|sandbox)'
  )
  AND EXISTS (
      SELECT 1 FROM public.shop_supplier_runtime_jobs j
      WHERE j.supplier_account_id = ra.supplier_account_id
  )
  AND NOT EXISTS (
      SELECT 1
      FROM public.shop_supplier_runtime_jobs j
      JOIN public.shop_supplier_procurement_intents i ON i.id = j.intent_id
      JOIN public.shop_supplier_fulfillment_units u ON u.id = i.unit_id
      WHERE j.supplier_account_id = ra.supplier_account_id
        AND (
            i.status IS DISTINCT FROM 'not_submitted'
            OR u.funding_state IS DISTINCT FROM 'funded'
            OR j.request_started_at IS NOT NULL
            OR j.state NOT IN ('waiting', 'running')
        )
  );

DO $$
DECLARE
    v_count INTEGER;
    v_account_id UUID;
    v_job_count INTEGER;
    v_receipt_count INTEGER;
BEGIN
    SELECT count(*) INTO v_count FROM _supplier_runtime_concurrency_cleanup;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'supplier_p2e_cleanup_target_ambiguous';
    END IF;

    SELECT supplier_account_id INTO v_account_id
    FROM _supplier_runtime_concurrency_cleanup;

    SELECT count(*) INTO v_job_count
    FROM public.shop_supplier_runtime_jobs
    WHERE supplier_account_id = v_account_id;
    IF v_job_count NOT BETWEEN 1 AND 2 THEN
        RAISE EXCEPTION 'supplier_p2e_cleanup_job_count_unexpected';
    END IF;

    SELECT count(*) INTO v_receipt_count
    FROM public.shop_supplier_runtime_resumes r
    JOIN public.shop_supplier_runtime_jobs j ON j.intent_id = r.intent_id
    WHERE j.supplier_account_id = v_account_id;
    IF v_receipt_count <> 0 THEN
        RAISE EXCEPTION 'supplier_p2e_cleanup_resume_receipt_present';
    END IF;

    PERFORM 1 FROM public.shop_supplier_runtime_accounts
    WHERE supplier_account_id = v_account_id FOR UPDATE;
    PERFORM 1 FROM public.shop_supplier_runtime_jobs
    WHERE supplier_account_id = v_account_id FOR UPDATE;

    DELETE FROM public.shop_supplier_runtime_jobs
    WHERE supplier_account_id = v_account_id;
    DELETE FROM public.shop_supplier_runtime_accounts
    WHERE supplier_account_id = v_account_id
      AND NOT EXISTS (
          SELECT 1 FROM public.shop_supplier_runtime_jobs j
          WHERE j.supplier_account_id = v_account_id
      );
END;
$$;

SELECT 'PASS' AS result,
    '仅清理了一个明确标记且关闭的安全夹具账号的 runtime 协调行；业务表未修改。' AS evidence,
    supplier_account_id AS account_id
FROM _supplier_runtime_concurrency_cleanup;

COMMIT;
