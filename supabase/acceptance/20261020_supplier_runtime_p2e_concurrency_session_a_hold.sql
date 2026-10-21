-- P2E runtime concurrency acceptance, session A / hold phase.
--
-- Run this file in the same database session after the seed script committed.
-- Start the two session-B scripts while this file is sleeping. The transaction
-- holds the runtime account and job rows in the same lock order used by the
-- runtime function, then commits and releases them. No supplier is called.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT set_config('request.jwt.claim.role', 'service_role', true);

CREATE TEMP TABLE _supplier_runtime_concurrency_hold AS
SELECT j.intent_id, j.supplier_account_id, j.phase
FROM public.shop_supplier_runtime_jobs j
JOIN public.shop_supplier_runtime_accounts ra
  ON ra.supplier_account_id = j.supplier_account_id
JOIN public.shop_supplier_runtime_plan_v2(j.intent_id) p
  ON p.intent_id = j.intent_id
JOIN public.shop_supplier_procurement_intents i ON i.id = j.intent_id
JOIN public.shop_supplier_fulfillment_units u ON u.id = i.unit_id
JOIN public.shop_supplier_accounts a ON a.id = j.supplier_account_id
WHERE j.state = 'running'
  AND j.last_code = 'running'
  AND j.request_started_at IS NULL
  AND j.lease_token IS NOT NULL
  AND j.lease_expires_at > clock_timestamp()
  AND ra.lease_intent_id = j.intent_id
  AND ra.lease_token = j.lease_token
  AND ra.lease_expires_at > clock_timestamp()
  AND p.phase = j.phase
  AND i.status = 'not_submitted'
  AND u.funding_state = 'funded'
  AND a.is_enabled = false
  AND (
      lower(coalesce(a.account_key, '')) ~ '(^|[^a-z])(test|fixture|sandbox)([^a-z]|$)'
      OR lower(coalesce(a.credential_ref, '')) ~ '(test|fixture|sandbox)'
  );

DO $$
DECLARE
    v_count INTEGER;
    v_account_id UUID;
    v_intent_id UUID;
BEGIN
    SELECT count(*) INTO v_count FROM _supplier_runtime_concurrency_hold;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'supplier_p2e_hold_target_ambiguous';
    END IF;

    SELECT supplier_account_id, intent_id INTO v_account_id, v_intent_id
    FROM _supplier_runtime_concurrency_hold;

    -- Match fn_shop_supplier_runtime_v2: account row first, then job row.
    PERFORM 1 FROM public.shop_supplier_runtime_accounts
    WHERE supplier_account_id = v_account_id FOR UPDATE;
    PERFORM 1 FROM public.shop_supplier_runtime_jobs
    WHERE intent_id = v_intent_id FOR UPDATE;
END;
$$;

SELECT 'PASS' AS result,
    'Session A 已持有 runtime account/job 锁；请在本段等待期间同时运行两个 session-B 脚本。' AS evidence,
    intent_id, supplier_account_id AS account_id, phase
FROM _supplier_runtime_concurrency_hold;

-- Keep the lock long enough for the two independent sessions to enter claim.
SELECT pg_sleep(45) AS hold_seconds;

COMMIT;
