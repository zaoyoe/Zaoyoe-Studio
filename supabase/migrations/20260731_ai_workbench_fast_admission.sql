-- AI Workbench fast admission: batch rate limits and atomically create,
-- authorize, and start text/image/video tasks with pricing-version checks.

CREATE OR REPLACE FUNCTION public.take_rate_limit_tokens(
    p_checks JSONB,
    p_now TIMESTAMPTZ DEFAULT timezone('utc', now())
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_check JSONB;
    v_result RECORD;
    v_results JSONB := '[]'::JSONB;
    v_now TIMESTAMPTZ := COALESCE(p_now, timezone('utc', now()));
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    FOR v_check IN
        SELECT value
        FROM jsonb_array_elements(COALESCE(p_checks, '[]'::JSONB))
    LOOP
        SELECT * INTO v_result
        FROM public.take_rate_limit_token(
            COALESCE(v_check->>'key', ''),
            GREATEST(1, COALESCE((v_check->>'limit')::INTEGER, 1)),
            GREATEST(1000, COALESCE((v_check->>'window_ms')::INTEGER, 60000)),
            v_now
        );

        v_results := v_results || jsonb_build_array(jsonb_build_object(
            'scope', COALESCE(v_check->>'scope', ''),
            'allowed', v_result.allowed,
            'limit', v_result.limit_value,
            'remaining', v_result.remaining,
            'reset_at', v_result.reset_at,
            'retry_after_seconds', v_result.retry_after_seconds,
            'hit_count', v_result.hit_count
        ));

        EXIT WHEN v_result.allowed = FALSE;
    END LOOP;

    RETURN v_results;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_admit_ai_workbench_task(
    p_task JSONB,
    p_target_status TEXT DEFAULT 'queued',
    p_started_at TIMESTAMPTZ DEFAULT NULL,
    p_authorization_points NUMERIC DEFAULT 0,
    p_authorization_required BOOLEAN DEFAULT FALSE,
    p_running_limit INTEGER DEFAULT 2,
    p_queued_limit INTEGER DEFAULT 5,
    p_active_limit INTEGER DEFAULT 6,
    p_pricing_rule_id UUID DEFAULT NULL,
    p_pricing_rule_updated_at TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_task_id UUID := COALESCE(NULLIF(p_task->>'id', '')::UUID, gen_random_uuid());
    v_user_id UUID := NULLIF(p_task->>'user_id', '')::UUID;
    v_site TEXT := LOWER(COALESCE(NULLIF(BTRIM(p_task->>'site'), ''), 'cn'));
    v_client_task_id TEXT := COALESCE(BTRIM(p_task->>'client_task_id'), '');
    v_billing_mode TEXT := LOWER(COALESCE(NULLIF(BTRIM(p_task->>'billing_mode'), ''), 'points'));
    v_target_status TEXT := LOWER(COALESCE(NULLIF(BTRIM(p_target_status), ''), 'queued'));
    v_running_count INTEGER := 0;
    v_queued_count INTEGER := 0;
    v_authorizing_count INTEGER := 0;
    v_current_pricing_updated_at TIMESTAMPTZ;
    v_authorization JSONB := NULL;
    v_metadata JSONB := COALESCE(p_task->'metadata', '{}'::JSONB);
    v_billing_metadata JSONB := COALESCE(v_metadata->'billing_v2', '{}'::JSONB);
    v_existing public.ai_image_tasks%ROWTYPE;
    v_task public.ai_image_tasks%ROWTYPE;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id is required';
    END IF;
    IF v_site NOT IN ('cn', 'intl') THEN
        RAISE EXCEPTION 'Unsupported site';
    END IF;
    IF v_billing_mode NOT IN ('points', 'api') THEN
        RAISE EXCEPTION 'Unsupported billing mode';
    END IF;
    IF v_target_status NOT IN ('queued', 'running') THEN
        RAISE EXCEPTION 'Unsupported target status';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(
        'ai-workbench-admit:' || v_site || ':' || v_user_id::TEXT,
        0
    ));

    IF v_client_task_id <> '' THEN
        SELECT * INTO v_existing
        FROM public.ai_image_tasks
        WHERE user_id = v_user_id
          AND site = v_site
          AND client_task_id = v_client_task_id
        ORDER BY created_at DESC
        LIMIT 1;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'success', true,
                'duplicate', true,
                'task', to_jsonb(v_existing)
            );
        END IF;
    END IF;

    SELECT
        COUNT(*) FILTER (WHERE status = 'running'),
        COUNT(*) FILTER (WHERE status = 'queued'),
        COUNT(*) FILTER (WHERE status = 'authorizing')
    INTO v_running_count, v_queued_count, v_authorizing_count
    FROM public.ai_image_tasks
    WHERE user_id = v_user_id
      AND site = v_site
      AND status IN ('authorizing', 'queued', 'running');

    IF v_target_status = 'running' AND v_running_count >= GREATEST(1, COALESCE(p_running_limit, 2)) THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 429,
            'code', 'ai_image_user_running_limit',
            'message', '当前已有任务正在生成，请等待其中一个完成后再提交',
            'scope', 'task:running',
            'retry_after_seconds', 15
        );
    END IF;
    IF v_target_status = 'queued' AND v_queued_count >= GREATEST(1, COALESCE(p_queued_limit, 5)) THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 429,
            'code', 'ai_image_user_queue_limit',
            'message', '当前排队任务较多，请先等待或取消部分任务',
            'scope', 'task:queued',
            'retry_after_seconds', 20
        );
    END IF;
    IF v_running_count + v_queued_count + v_authorizing_count >= GREATEST(1, COALESCE(p_active_limit, 6)) THEN
        RETURN jsonb_build_object(
            'success', false,
            'status_code', 429,
            'code', 'ai_image_user_active_limit',
            'message', '当前未完成任务较多，请稍后再提交',
            'scope', 'task:active',
            'retry_after_seconds', 20
        );
    END IF;

    IF p_pricing_rule_id IS NOT NULL THEN
        SELECT updated_at INTO v_current_pricing_updated_at
        FROM public.ai_image_pricing_rules
        WHERE id = p_pricing_rule_id
          AND is_active = TRUE
        FOR SHARE;

        IF NOT FOUND
           OR p_pricing_rule_updated_at IS NULL
           OR v_current_pricing_updated_at <> p_pricing_rule_updated_at THEN
            RETURN jsonb_build_object(
                'success', false,
                'status_code', 409,
                'code', 'pricing_changed',
                'message', '计价标准已更新，请确认最新价格后重新提交'
            );
        END IF;
    END IF;

    INSERT INTO public.ai_image_tasks (
        id,
        site,
        user_id,
        parent_task_id,
        conversation_id,
        client_task_id,
        source_prompt_id,
        mode,
        agent_id,
        agent_slug,
        billing_mode,
        status,
        model,
        api_model_group,
        ratio,
        resolution,
        quantity,
        prompt,
        negative_prompt,
        reference_image_url,
        reference_image_storage_path,
        reference_title,
        result_prompt,
        estimated_points,
        charged_points,
        points_ledger_reference_id,
        api_base_url,
        api_key_tail,
        api_key_fingerprint,
        token_usage,
        input_tokens,
        output_tokens,
        total_tokens,
        provider_task_id,
        error_code,
        error_message,
        metadata,
        started_at,
        completed_at
    ) VALUES (
        v_task_id,
        v_site,
        v_user_id,
        NULLIF(p_task->>'parent_task_id', '')::UUID,
        NULLIF(p_task->>'conversation_id', '')::UUID,
        v_client_task_id,
        COALESCE(p_task->>'source_prompt_id', ''),
        COALESCE(p_task->>'mode', 'text'),
        NULLIF(p_task->>'agent_id', '')::UUID,
        COALESCE(p_task->>'agent_slug', ''),
        v_billing_mode,
        CASE WHEN p_authorization_required THEN 'authorizing' ELSE v_target_status END,
        COALESCE(p_task->>'model', ''),
        COALESCE(p_task->>'api_model_group', ''),
        NULLIF(p_task->>'ratio', ''),
        NULLIF(p_task->>'resolution', ''),
        GREATEST(1, LEAST(8, COALESCE((p_task->>'quantity')::INTEGER, 1))),
        COALESCE(p_task->>'prompt', ''),
        COALESCE(p_task->>'negative_prompt', ''),
        COALESCE(p_task->>'reference_image_url', ''),
        COALESCE(p_task->>'reference_image_storage_path', ''),
        COALESCE(p_task->>'reference_title', ''),
        COALESCE(p_task->>'result_prompt', ''),
        ROUND(COALESCE((p_task->>'estimated_points')::NUMERIC, 0), 6),
        ROUND(COALESCE((p_task->>'charged_points')::NUMERIC, 0), 6),
        COALESCE(p_task->>'points_ledger_reference_id', ''),
        COALESCE(p_task->>'api_base_url', ''),
        COALESCE(p_task->>'api_key_tail', ''),
        COALESCE(p_task->>'api_key_fingerprint', ''),
        COALESCE(p_task->'token_usage', '{}'::JSONB),
        GREATEST(0, COALESCE((p_task->>'input_tokens')::INTEGER, 0)),
        GREATEST(0, COALESCE((p_task->>'output_tokens')::INTEGER, 0)),
        GREATEST(0, COALESCE((p_task->>'total_tokens')::INTEGER, 0)),
        COALESCE(p_task->>'provider_task_id', ''),
        COALESCE(p_task->>'error_code', ''),
        COALESCE(p_task->>'error_message', ''),
        v_metadata,
        CASE WHEN v_target_status = 'running' AND NOT p_authorization_required
            THEN COALESCE(p_started_at, timezone('utc', now()))
            ELSE NULL
        END,
        NULL
    )
    RETURNING * INTO v_task;

    IF p_authorization_required THEN
        v_authorization := public.fn_authorize_ai_workbench_points(
            v_task.id,
            v_task.user_id,
            v_task.site,
            ROUND(COALESCE(p_authorization_points, 0), 6),
            'AI 工作台预授权'
        );

        IF COALESCE((v_authorization->>'success')::BOOLEAN, FALSE) <> TRUE THEN
            DELETE FROM public.ai_image_tasks WHERE id = v_task.id;
            RETURN v_authorization || jsonb_build_object(
                'success', false,
                'status_code', CASE WHEN v_authorization->>'code' = 'insufficient_points' THEN 402 ELSE 503 END
            );
        END IF;

        v_billing_metadata := v_billing_metadata || jsonb_build_object(
            'status', 'authorized',
            'authorized_points', ROUND(COALESCE((v_authorization->>'authorized')::NUMERIC, 0), 6),
            'reservation_id', COALESCE(v_authorization->>'reservation_id', ''),
            'authorized_at', timezone('utc', now())
        );
    ELSIF COALESCE((v_billing_metadata->>'enabled')::BOOLEAN, FALSE) THEN
        v_billing_metadata := v_billing_metadata || jsonb_build_object(
            'status', 'free',
            'authorized_points', 0,
            'reservation_id', '',
            'authorized_at', timezone('utc', now())
        );
    END IF;

    IF COALESCE((v_billing_metadata->>'enabled')::BOOLEAN, FALSE) THEN
        v_metadata := jsonb_set(v_metadata, '{billing_v2}', v_billing_metadata, TRUE);
    END IF;

    UPDATE public.ai_image_tasks
       SET status = v_target_status,
           metadata = v_metadata,
           started_at = CASE WHEN v_target_status = 'running'
               THEN COALESCE(p_started_at, timezone('utc', now()))
               ELSE NULL
           END,
           error_code = '',
           error_message = '',
           updated_at = timezone('utc', now())
     WHERE id = v_task.id
    RETURNING * INTO v_task;

    RETURN jsonb_build_object(
        'success', true,
        'duplicate', false,
        'task', to_jsonb(v_task),
        'authorization', v_authorization
    );
END;
$$;

REVOKE ALL ON FUNCTION public.take_rate_limit_tokens(JSONB, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.take_rate_limit_tokens(JSONB, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.take_rate_limit_tokens(JSONB, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.take_rate_limit_tokens(JSONB, TIMESTAMPTZ) TO service_role;

REVOKE ALL ON FUNCTION public.fn_admit_ai_workbench_task(JSONB, TEXT, TIMESTAMPTZ, NUMERIC, BOOLEAN, INTEGER, INTEGER, INTEGER, UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_admit_ai_workbench_task(JSONB, TEXT, TIMESTAMPTZ, NUMERIC, BOOLEAN, INTEGER, INTEGER, INTEGER, UUID, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.fn_admit_ai_workbench_task(JSONB, TEXT, TIMESTAMPTZ, NUMERIC, BOOLEAN, INTEGER, INTEGER, INTEGER, UUID, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admit_ai_workbench_task(JSONB, TEXT, TIMESTAMPTZ, NUMERIC, BOOLEAN, INTEGER, INTEGER, INTEGER, UUID, TIMESTAMPTZ) TO service_role;
