-- P2E runtime concurrency acceptance, session A / seed phase.
--
-- Run this whole file in an isolated test database or an approved maintenance
-- window. It commits exactly one runtime claim so a second database session can
-- observe the same safe fixture. It never calls a supplier and never changes a
-- native order, funding row, product, account credential or feature switch.
--
-- The only eligible fixture is explicitly marked test/fixture/sandbox, disabled,
-- funded and not_submitted, with no existing runtime rows for that account.
-- Do not replace this predicate with a production account.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT set_config('request.jwt.claim.role', 'service_role', true);

CREATE TEMP TABLE _supplier_runtime_concurrency_seed (
    intent_id UUID PRIMARY KEY,
    account_id UUID NOT NULL,
    phase TEXT NOT NULL,
    claim_acquired BOOLEAN NOT NULL DEFAULT false
) ON COMMIT PRESERVE ROWS;

WITH eligible AS (
    SELECT plan.intent_id, plan.supplier_account_id, plan.phase, i.created_at
    FROM public.shop_supplier_runtime_plan_v2() AS plan
    JOIN public.shop_supplier_procurement_intents i ON i.id = plan.intent_id
    JOIN public.shop_supplier_fulfillment_units u ON u.id = i.unit_id
    JOIN public.shop_supplier_accounts a ON a.id = plan.supplier_account_id
    WHERE plan.phase IN ('dispatch', 'query', 'delivery')
      AND plan.ready_at <= clock_timestamp()
      AND plan.deadline_at > clock_timestamp()
      AND i.status = 'not_submitted'
      AND u.funding_state = 'funded'
      AND a.is_enabled = false
      AND (
          lower(coalesce(a.account_key, '')) ~ '(^|[^a-z])(test|fixture|sandbox)([^a-z]|$)'
          OR lower(coalesce(a.credential_ref, '')) ~ '(test|fixture|sandbox)'
      )
      AND NOT EXISTS (
          SELECT 1 FROM public.shop_supplier_runtime_accounts ra
          WHERE ra.supplier_account_id = plan.supplier_account_id
      )
      AND NOT EXISTS (
          SELECT 1 FROM public.shop_supplier_runtime_jobs rj
          WHERE rj.supplier_account_id = plan.supplier_account_id
      )
    ORDER BY i.created_at, i.id
    LIMIT 1
)
INSERT INTO _supplier_runtime_concurrency_seed(intent_id, account_id, phase)
SELECT intent_id, supplier_account_id, phase
FROM eligible;

DO $$
DECLARE
    v_fixture RECORD;
    v_claim JSONB;
BEGIN
    SELECT * INTO v_fixture FROM _supplier_runtime_concurrency_seed LIMIT 1;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    SELECT public.fn_shop_supplier_runtime_v2(
        p_action => 'claim',
        p_intent_id => v_fixture.intent_id,
        p_phase => v_fixture.phase,
        p_phases => ARRAY['dispatch', 'query', 'delivery']::TEXT[]
    ) INTO v_claim;

    IF coalesce((v_claim->>'acquired')::BOOLEAN, false) IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'supplier_p2e_seed_claim_not_acquired';
    END IF;

    UPDATE _supplier_runtime_concurrency_seed SET claim_acquired = true;
END;
$$;

SELECT
    CASE WHEN count(*) = 1 AND bool_and(claim_acquired) THEN 'PASS' ELSE 'NOT RUN' END AS result,
    CASE WHEN count(*) = 1 AND bool_and(claim_acquired)
        THEN 'Session A 已建立安全夹具 claim；随后运行 session A hold，再同时运行 session B 脚本。'
        ELSE '未发现满足安全边界的夹具；没有调用 runtime claim，也没有写入运行协调行。'
    END AS evidence,
    (array_agg(intent_id ORDER BY intent_id))[1] AS intent_id,
    (array_agg(account_id ORDER BY account_id))[1] AS account_id,
    (array_agg(phase ORDER BY phase))[1] AS phase
FROM _supplier_runtime_concurrency_seed;

COMMIT;
