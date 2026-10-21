-- P2E runtime concurrency acceptance, session B / same intent.
--
-- Run in a second independent database session while session A hold is running.
-- The claim must wait on session A's account lock and then return acquired=false.
-- The elapsed-time guard prevents a sequential lease rejection from being
-- reported as concurrent PASS. This file rolls back its own coordinator work.

BEGIN;
SET LOCAL lock_timeout = '60s';
SET LOCAL statement_timeout = '90s';
SELECT set_config('request.jwt.claim.role', 'service_role', true);

CREATE TEMP TABLE _supplier_runtime_concurrency_target AS
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

CREATE TEMP TABLE _supplier_runtime_concurrency_result (
    result TEXT NOT NULL,
    evidence TEXT NOT NULL,
    elapsed_seconds NUMERIC
) ON COMMIT PRESERVE ROWS;

DO $$
DECLARE
    v_target RECORD;
    v_claim JSONB;
    v_started TIMESTAMPTZ;
    v_elapsed NUMERIC;
BEGIN
    SELECT * INTO v_target FROM _supplier_runtime_concurrency_target;
    IF NOT FOUND OR (SELECT count(*) FROM _supplier_runtime_concurrency_target) <> 1 THEN
        INSERT INTO _supplier_runtime_concurrency_result
        VALUES ('NOT RUN', '当前没有唯一的已建立安全夹具目标；没有调用 runtime claim。', NULL);
        RETURN;
    END IF;

    v_started := clock_timestamp();
    BEGIN
        SELECT public.fn_shop_supplier_runtime_v2(
            p_action => 'claim',
            p_intent_id => v_target.intent_id,
            p_phase => v_target.phase,
            p_phases => ARRAY['dispatch', 'query', 'delivery']::TEXT[]
        ) INTO v_claim;
        v_elapsed := extract(epoch FROM clock_timestamp() - v_started);
        INSERT INTO _supplier_runtime_concurrency_result
        VALUES (
            CASE
                WHEN coalesce((v_claim->>'acquired')::BOOLEAN, false) IS FALSE
                     AND v_elapsed >= 1 THEN 'PASS'
                WHEN coalesce((v_claim->>'acquired')::BOOLEAN, false) IS FALSE THEN 'NOT RUN'
                ELSE 'FAIL'
            END,
            CASE
                WHEN coalesce((v_claim->>'acquired')::BOOLEAN, false) IS FALSE
                     AND v_elapsed >= 1 THEN '同一 intent 的竞争 claim 在锁持有期间等待后被拒绝；未启动上游请求。'
                WHEN coalesce((v_claim->>'acquired')::BOOLEAN, false) IS FALSE THEN 'claim 被拒绝，但等待时间不足以证明数据库并发。'
                ELSE '竞争 claim 意外获得租约；停止，不把结果当作并发通过。'
            END,
            round(v_elapsed, 3)
        );
    EXCEPTION WHEN lock_not_available OR query_canceled THEN
        INSERT INTO _supplier_runtime_concurrency_result
        VALUES ('NOT RUN', '锁等待超时或语句被取消；未把超时伪造为并发 PASS。', NULL);
    END;
END;
$$;

SELECT * FROM _supplier_runtime_concurrency_result;

ROLLBACK;
