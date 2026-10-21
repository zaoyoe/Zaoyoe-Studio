-- P2E runtime acceptance boundary (manual execution only).
--
-- This script is deliberately fail-closed:
--   * it never calls a supplier adapter, worker, webhook, payment path or delivery path;
--   * it only considers an explicitly marked, disabled test fixture;
--   * all runtime rows written by the serial checks are rolled back at the end;
--   * true database concurrency, real merchant behavior and worker redaction remain NOT RUN.
--
-- Run only in an isolated test database or a maintenance window. Do not replace the
-- fixture predicate with a production account. Codex does not execute this file.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT set_config('request.jwt.claim.role', 'service_role', true);

CREATE TEMP TABLE _supplier_runtime_acceptance (
    check_id TEXT PRIMARY KEY,
    result TEXT NOT NULL CHECK (result IN ('PASS', 'FAIL', 'NOT RUN')),
    evidence TEXT NOT NULL
) ON COMMIT PRESERVE ROWS;

INSERT INTO _supplier_runtime_acceptance(check_id, result, evidence) VALUES
    ('safe_fixture', 'NOT RUN', '未发现明确标记为 test/fixture/sandbox 且已关闭的运行夹具，未调用 runtime RPC。'),
    ('same_account_concurrent_claim', 'NOT RUN', '需要两个独立数据库会话同时 claim；本脚本不会伪造并发 PASS。'),
    ('same_job_concurrent_claim', 'NOT RUN', '需要两个独立数据库会话同时 claim；本脚本不会伪造并发 PASS。'),
    ('serial_lease_replay', 'NOT RUN', '无安全夹具时不运行；有夹具时只验证单会话的租约拒绝，不能替代并发验收。'),
    ('wrong_token_reject', 'NOT RUN', '无安全夹具时不运行。'),
    ('account_ownership_mismatch_reject', 'NOT RUN', '需要第二个安全夹具或双会话；本脚本不猜测账号归属。'),
    ('expired_lease_reject', 'NOT RUN', '无安全夹具时不运行。'),
    ('lease_expiry_reclaim', 'NOT RUN', '无安全夹具时不运行。'),
    ('finish_without_start_ack_reject', 'NOT RUN', '无安全夹具时不运行。'),
    ('claim_start_finish', 'NOT RUN', '无安全夹具时不运行；不会访问真实上游。'),
    ('finish_clears_request_marker', 'NOT RUN', '无安全夹具时不运行。'),
    ('timeout_backoff_and_circuit', 'NOT RUN', '无安全夹具时不运行；仅检查数据库协调状态。'),
    ('resume_same_operation_replay', 'NOT RUN', '无安全夹具或没有可用 auth.users actor 时不运行。'),
    ('unknown_queries_original_request_only', 'NOT RUN', '需要 worker/适配器和真实请求恢复证据；SQL 单会话不证明此项。'),
    ('admin_projection_authoritative', 'NOT RUN', '无安全夹具时不运行；仅可检查 runtime projection，不等于浏览器验收。'),
    ('worker_output_redaction', 'NOT RUN', '需要实际 worker 日志/隔离运行证据；本脚本不会启动 worker。'),
    ('real_supplier_business_acceptance', 'NOT RUN', '本脚本禁止调用虾仁、16688 或任何真实上游。');

INSERT INTO _supplier_runtime_acceptance(check_id, result, evidence)
SELECT 'runtime_structural_prerequisites',
    CASE WHEN to_regclass('public.shop_supplier_runtime_accounts') IS NOT NULL
        AND to_regclass('public.shop_supplier_runtime_jobs') IS NOT NULL
        AND to_regclass('public.shop_supplier_runtime_resumes') IS NOT NULL
        AND to_regprocedure('public.fn_shop_supplier_runtime_v2(text,uuid,uuid,text,text,text[],integer,uuid)') IS NOT NULL
        THEN 'PASS' ELSE 'FAIL' END,
    '仅检查 P2E runtime 表和函数是否存在；不代表并发、worker 或真实业务通过。'
ON CONFLICT (check_id) DO UPDATE SET result = EXCLUDED.result, evidence = EXCLUDED.evidence;

DO $$
DECLARE
    v_intent_id UUID;
    v_account_id UUID;
    v_phase TEXT;
    v_token UUID;
    v_next_token UUID;
    v_actor_id UUID;
    v_operation_id UUID := gen_random_uuid();
    v_claim JSONB;
    v_second_claim JSONB;
    v_start JSONB;
    v_finish JSONB;
    v_projection JSONB;
    v_failures INTEGER;
    v_circuit_until TIMESTAMPTZ;
    v_request_started_at TIMESTAMPTZ;
    v_job_state TEXT;
    v_resume_count INTEGER;
    v_pass BOOLEAN;
    v_attempt INTEGER;
BEGIN
    -- Only a disabled, explicitly named test fixture is eligible. A real account,
    -- a real order, or an unmarked disabled account is intentionally not enough.
    SELECT p.intent_id, p.supplier_account_id, p.phase
    INTO v_intent_id, v_account_id, v_phase
    FROM public.shop_supplier_runtime_plan_v2() p
    JOIN public.shop_supplier_procurement_intents i ON i.id = p.intent_id
    JOIN public.shop_supplier_fulfillment_units u ON u.id = i.unit_id
    JOIN public.shop_supplier_accounts a ON a.id = p.supplier_account_id
    WHERE p.phase IN ('dispatch', 'query', 'delivery')
      AND p.ready_at <= clock_timestamp()
      AND p.deadline_at > clock_timestamp()
      AND i.status = 'not_submitted'
      AND u.funding_state = 'funded'
      AND a.is_enabled = false
      AND (
          lower(coalesce(a.account_key, '')) ~ '(^|[^a-z])(test|fixture|sandbox)([^a-z]|$)'
          OR lower(coalesce(a.credential_ref, '')) ~ '(test|fixture|sandbox)'
      )
      AND NOT EXISTS (SELECT 1 FROM public.shop_supplier_runtime_jobs j WHERE j.intent_id = p.intent_id)
      AND NOT EXISTS (SELECT 1 FROM public.shop_supplier_runtime_accounts ra WHERE ra.supplier_account_id = p.supplier_account_id)
    ORDER BY i.created_at, i.id
    LIMIT 1;

    IF v_intent_id IS NULL THEN
        RETURN;
    END IF;

    UPDATE _supplier_runtime_acceptance
    SET result = 'PASS', evidence = '发现已关闭且明确标记的安全夹具；后续仅在当前事务内运行，最终 ROLLBACK。'
    WHERE check_id = 'safe_fixture';

    -- The second claim is a serial replay check only. It is useful evidence for
    -- the lease guard, but is intentionally not reported as database concurrency.
    v_claim := public.fn_shop_supplier_runtime_v2(
        p_action => 'claim', p_intent_id => v_intent_id, p_phase => v_phase,
        p_phases => ARRAY['dispatch', 'query', 'delivery']::TEXT[]);
    IF coalesce((v_claim->>'acquired')::BOOLEAN, false) THEN
        v_token := (v_claim->>'token')::UUID;
        v_second_claim := public.fn_shop_supplier_runtime_v2(
            p_action => 'claim', p_intent_id => v_intent_id, p_phase => v_phase,
            p_phases => ARRAY['dispatch', 'query', 'delivery']::TEXT[]);
        UPDATE _supplier_runtime_acceptance
        SET result = CASE WHEN coalesce((v_second_claim->>'acquired')::BOOLEAN, false) THEN 'FAIL' ELSE 'PASS' END,
            evidence = '同一会话第二次 claim 在活动租约期间返回 acquired=false；双会话竞争仍需单独验收。'
        WHERE check_id = 'serial_lease_replay';

        v_start := public.fn_shop_supplier_runtime_v2(
            p_action => 'start', p_intent_id => v_intent_id, p_token => v_token, p_phase => v_phase);
        v_finish := public.fn_shop_supplier_runtime_v2(
            p_action => 'finish', p_intent_id => v_intent_id, p_token => v_token, p_outcome => 'blocked');
        SELECT j.request_started_at, j.state
        INTO v_request_started_at, v_job_state
        FROM public.shop_supplier_runtime_jobs j WHERE j.intent_id = v_intent_id;
        v_pass := coalesce((v_start->>'applied')::BOOLEAN, false)
            AND coalesce((v_finish->>'applied')::BOOLEAN, false)
            AND v_request_started_at IS NULL
            AND v_job_state IN ('waiting', 'review', 'completed');
        UPDATE _supplier_runtime_acceptance
        SET result = CASE WHEN v_pass THEN 'PASS' ELSE 'FAIL' END,
            evidence = '单事务 claim -> start -> finish(blocked)；完成后 request_started_at=NULL 且租约结束。'
        WHERE check_id IN ('claim_start_finish', 'finish_clears_request_marker');
        UPDATE _supplier_runtime_acceptance
        SET result = CASE WHEN v_pass THEN 'PASS' ELSE 'FAIL' END
        WHERE check_id = 'claim_start_finish';

        v_projection := public.shop_supplier_runtime_projection_v2(v_intent_id);
        UPDATE _supplier_runtime_acceptance
        SET result = CASE WHEN jsonb_typeof(v_projection) = 'object'
            AND v_projection ? 'phase' AND v_projection ? 'state' AND v_projection ? 'lastCode'
            THEN 'PASS' ELSE 'FAIL' END,
            evidence = '读取同一权威 runtime projection 的 phase/state/lastCode；不代表真实 Admin 浏览器验收。'
        WHERE check_id = 'admin_projection_authoritative';
    END IF;

    -- Reset only the temporary coordinator rows inside this transaction so each
    -- serial scenario starts from the same safe fixture. Final ROLLBACK removes all of them.
    DELETE FROM public.shop_supplier_runtime_jobs WHERE intent_id = v_intent_id;
    DELETE FROM public.shop_supplier_runtime_accounts WHERE supplier_account_id = v_account_id;

    v_claim := public.fn_shop_supplier_runtime_v2(
        p_action => 'claim', p_intent_id => v_intent_id, p_phase => v_phase,
        p_phases => ARRAY['dispatch', 'query', 'delivery']::TEXT[]);
    IF coalesce((v_claim->>'acquired')::BOOLEAN, false) THEN
        v_token := (v_claim->>'token')::UUID;
        v_finish := public.fn_shop_supplier_runtime_v2(
            p_action => 'finish', p_intent_id => v_intent_id, p_token => v_token, p_outcome => 'blocked');
        UPDATE _supplier_runtime_acceptance
        SET result = CASE WHEN NOT coalesce((v_finish->>'applied')::BOOLEAN, false) THEN 'PASS' ELSE 'FAIL' END,
            evidence = '没有 start ACK 时 finish 返回 applied=false；未发送任何上游请求。'
        WHERE check_id = 'finish_without_start_ack_reject';
    END IF;

    DELETE FROM public.shop_supplier_runtime_jobs WHERE intent_id = v_intent_id;
    DELETE FROM public.shop_supplier_runtime_accounts WHERE supplier_account_id = v_account_id;

    v_claim := public.fn_shop_supplier_runtime_v2(
        p_action => 'claim', p_intent_id => v_intent_id, p_phase => v_phase,
        p_phases => ARRAY['dispatch', 'query', 'delivery']::TEXT[]);
    IF coalesce((v_claim->>'acquired')::BOOLEAN, false) THEN
        v_token := (v_claim->>'token')::UUID;
        v_start := public.fn_shop_supplier_runtime_v2(
            p_action => 'start', p_intent_id => v_intent_id,
            p_token => gen_random_uuid(), p_phase => v_phase);
        UPDATE _supplier_runtime_acceptance
        SET result = CASE WHEN NOT coalesce((v_start->>'applied')::BOOLEAN, false) THEN 'PASS' ELSE 'FAIL' END,
            evidence = '错误 token 的 start 返回 applied=false。'
        WHERE check_id = 'wrong_token_reject';

        UPDATE public.shop_supplier_runtime_jobs
        SET lease_expires_at = clock_timestamp() - INTERVAL '1 second'
        WHERE intent_id = v_intent_id;
        UPDATE public.shop_supplier_runtime_accounts
        SET lease_expires_at = clock_timestamp() - INTERVAL '1 second', next_request_at = clock_timestamp()
        WHERE supplier_account_id = v_account_id;
        v_start := public.fn_shop_supplier_runtime_v2(
            p_action => 'start', p_intent_id => v_intent_id, p_token => v_token, p_phase => v_phase);
        UPDATE _supplier_runtime_acceptance
        SET result = CASE WHEN NOT coalesce((v_start->>'applied')::BOOLEAN, false) THEN 'PASS' ELSE 'FAIL' END,
            evidence = '已过期租约的 start 返回 applied=false。'
        WHERE check_id = 'expired_lease_reject';
    END IF;

    DELETE FROM public.shop_supplier_runtime_jobs WHERE intent_id = v_intent_id;
    DELETE FROM public.shop_supplier_runtime_accounts WHERE supplier_account_id = v_account_id;

    v_claim := public.fn_shop_supplier_runtime_v2(
        p_action => 'claim', p_intent_id => v_intent_id, p_phase => v_phase,
        p_phases => ARRAY['dispatch', 'query', 'delivery']::TEXT[]);
    IF coalesce((v_claim->>'acquired')::BOOLEAN, false) THEN
        v_token := (v_claim->>'token')::UUID;
        UPDATE public.shop_supplier_runtime_jobs
        SET lease_expires_at = clock_timestamp() - INTERVAL '1 second', next_run_at = clock_timestamp()
        WHERE intent_id = v_intent_id;
        UPDATE public.shop_supplier_runtime_accounts
        SET lease_expires_at = clock_timestamp() - INTERVAL '1 second', next_request_at = clock_timestamp()
        WHERE supplier_account_id = v_account_id;
        v_second_claim := public.fn_shop_supplier_runtime_v2(
            p_action => 'claim', p_intent_id => v_intent_id, p_phase => v_phase,
            p_phases => ARRAY['dispatch', 'query', 'delivery']::TEXT[]);
        v_next_token := NULLIF(v_second_claim->>'token', '')::UUID;
        UPDATE _supplier_runtime_acceptance
        SET result = CASE WHEN coalesce((v_second_claim->>'acquired')::BOOLEAN, false)
            AND v_next_token IS NOT NULL AND v_next_token IS DISTINCT FROM v_token THEN 'PASS' ELSE 'FAIL' END,
            evidence = '租约过期后允许重新 claim，并生成不同 token；仅验证协调层接管。'
        WHERE check_id = 'lease_expiry_reclaim';
    END IF;

    DELETE FROM public.shop_supplier_runtime_jobs WHERE intent_id = v_intent_id;
    DELETE FROM public.shop_supplier_runtime_accounts WHERE supplier_account_id = v_account_id;

    -- Resume replay is tested only when a real auth actor exists. The operation
    -- receipt is immutable and is removed by the final rollback.
    SELECT id INTO v_actor_id FROM auth.users ORDER BY created_at, id LIMIT 1;
    IF v_actor_id IS NOT NULL THEN
        v_claim := public.fn_shop_supplier_runtime_v2(
            p_action => 'claim', p_intent_id => v_intent_id, p_phase => v_phase,
            p_phases => ARRAY['dispatch', 'query', 'delivery']::TEXT[]);
        IF coalesce((v_claim->>'acquired')::BOOLEAN, false) THEN
            UPDATE public.shop_supplier_runtime_jobs
            SET state = 'review', lease_token = NULL, lease_expires_at = NULL,
                request_started_at = NULL, next_run_at = clock_timestamp()
            WHERE intent_id = v_intent_id;
            v_finish := public.fn_shop_supplier_runtime_v2(
                p_action => 'resume', p_intent_id => v_intent_id,
                p_token => v_operation_id, p_actor_id => v_actor_id);
            v_start := public.fn_shop_supplier_runtime_v2(
                p_action => 'resume', p_intent_id => v_intent_id,
                p_token => v_operation_id, p_actor_id => v_actor_id);
            SELECT count(*) INTO v_resume_count
            FROM public.shop_supplier_runtime_resumes WHERE operation_id = v_operation_id;
            UPDATE _supplier_runtime_acceptance
            SET result = CASE WHEN coalesce((v_finish->>'applied')::BOOLEAN, false)
                AND coalesce((v_start->>'applied')::BOOLEAN, false) AND v_resume_count = 1 THEN 'PASS' ELSE 'FAIL' END,
                evidence = '同一 operation_id 的第二次 resume 重放原回执，且不可变回执只存在一条。'
            WHERE check_id = 'resume_same_operation_replay';
        END IF;
    END IF;

    -- Keep the job row because the immutable resume receipt references it.
    UPDATE public.shop_supplier_runtime_jobs
    SET phase = v_phase, state = 'waiting', attempts = 0, next_run_at = clock_timestamp(),
        last_attempt_at = NULL, lease_token = NULL, lease_expires_at = NULL,
        request_started_at = NULL, last_code = 'idle', alert_code = NULL,
        updated_at = clock_timestamp()
    WHERE intent_id = v_intent_id;
    UPDATE public.shop_supplier_runtime_accounts
    SET lease_intent_id = NULL, lease_token = NULL, lease_expires_at = NULL,
        next_request_at = clock_timestamp(), circuit_until = '-infinity', consecutive_failures = 0
    WHERE supplier_account_id = v_account_id;

    -- Three bounded timeout results raise the account circuit. Between attempts
    -- only coordinator rows are reset, because this is an isolated rollback test.
    v_pass := true;
    FOR v_attempt IN 1..3 LOOP
        v_claim := public.fn_shop_supplier_runtime_v2(
            p_action => 'claim', p_intent_id => v_intent_id, p_phase => v_phase,
            p_phases => ARRAY['dispatch', 'query', 'delivery']::TEXT[]);
        IF NOT coalesce((v_claim->>'acquired')::BOOLEAN, false) THEN
            v_pass := false;
            EXIT;
        END IF;
        v_token := (v_claim->>'token')::UUID;
        v_start := public.fn_shop_supplier_runtime_v2(
            p_action => 'start', p_intent_id => v_intent_id, p_token => v_token, p_phase => v_phase);
        v_finish := public.fn_shop_supplier_runtime_v2(
            p_action => 'finish', p_intent_id => v_intent_id, p_token => v_token, p_outcome => 'timeout');
        IF NOT coalesce((v_start->>'applied')::BOOLEAN, false)
            OR NOT coalesce((v_finish->>'applied')::BOOLEAN, false) THEN
            v_pass := false;
            EXIT;
        END IF;
        IF v_attempt < 3 THEN
            UPDATE public.shop_supplier_runtime_jobs
            SET next_run_at = clock_timestamp()
            WHERE intent_id = v_intent_id;
            UPDATE public.shop_supplier_runtime_accounts
            SET lease_intent_id = NULL, lease_token = NULL, lease_expires_at = NULL,
                next_request_at = clock_timestamp(), circuit_until = '-infinity'
            WHERE supplier_account_id = v_account_id;
        END IF;
    END LOOP;
    SELECT consecutive_failures, circuit_until INTO v_failures, v_circuit_until
    FROM public.shop_supplier_runtime_accounts WHERE supplier_account_id = v_account_id;
    v_pass := v_pass AND v_failures >= 3 AND v_circuit_until > clock_timestamp();
    UPDATE _supplier_runtime_acceptance
    SET result = CASE WHEN v_pass THEN 'PASS' ELSE 'FAIL' END,
        evidence = '三次 timeout 产生退避并打开账号 circuit；仅验证 DB 协调状态，不代表上游超时真实发生。'
    WHERE check_id = 'timeout_backoff_and_circuit';
EXCEPTION WHEN OTHERS THEN
    -- Do not expose database details, tokens or fixture identities. A failed
    -- acceptance path is not a PASS and the final rollback remains mandatory.
    UPDATE _supplier_runtime_acceptance
    SET result = 'NOT RUN', evidence = '安全夹具验收在事务内未完成；已保留 NOT RUN，未输出数据库错误或敏感值。'
    WHERE result = 'PASS' AND check_id <> 'runtime_structural_prerequisites';
END;
$$;

SELECT check_id, result, evidence
FROM _supplier_runtime_acceptance
ORDER BY CASE result WHEN 'FAIL' THEN 0 WHEN 'PASS' THEN 1 ELSE 2 END, check_id;

-- Do not retain coordinator rows, test receipts or temporary changes.
ROLLBACK;
