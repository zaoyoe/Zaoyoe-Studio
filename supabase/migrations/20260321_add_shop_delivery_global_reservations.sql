-- ============================================
-- Shop Delivery Global Reservations
-- 数据库级全局占位，支持多实例 target/channel 并发保护
-- ============================================

ALTER TABLE IF EXISTS public.shop_webhook_tasks
    ADD COLUMN IF NOT EXISTS reservation_acquired_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reservation_lock_token TEXT,
    ADD COLUMN IF NOT EXISTS reservation_worker_name TEXT;

UPDATE public.shop_webhook_tasks
SET
    target_key = COALESCE(NULLIF(BTRIM(target_key), ''), public.normalize_shop_delivery_target_key(target_url)),
    channel_key = COALESCE(NULLIF(BTRIM(channel_key), ''), public.normalize_shop_delivery_channel_key(target_url)),
    reservation_acquired_at = COALESCE(
        reservation_acquired_at,
        last_attempt_at,
        locked_at,
        updated_at,
        created_at,
        NOW()
    ),
    reservation_lock_token = COALESCE(NULLIF(BTRIM(reservation_lock_token), ''), NULLIF(BTRIM(lock_token), '')),
    reservation_worker_name = COALESCE(NULLIF(BTRIM(reservation_worker_name), ''), NULLIF(BTRIM(worker_name), ''))
WHERE COALESCE(status, '') = 'processing'
  AND COALESCE(NULLIF(BTRIM(lock_token), ''), '') <> ''
  AND COALESCE(lock_expires_at, TO_TIMESTAMP(0)) > NOW()
  AND (
      COALESCE(NULLIF(BTRIM(target_key), ''), '') = ''
      OR COALESCE(NULLIF(BTRIM(channel_key), ''), '') = ''
      OR reservation_acquired_at IS NULL
      OR COALESCE(NULLIF(BTRIM(reservation_lock_token), ''), '') = ''
      OR COALESCE(NULLIF(BTRIM(reservation_worker_name), ''), '') = ''
  );

CREATE INDEX IF NOT EXISTS idx_shop_webhook_tasks_target_reservation_started
    ON public.shop_webhook_tasks(target_key, reservation_acquired_at DESC)
    WHERE target_key IS NOT NULL
      AND reservation_acquired_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shop_webhook_tasks_channel_reservation_started
    ON public.shop_webhook_tasks(channel_key, reservation_acquired_at DESC)
    WHERE channel_key IS NOT NULL
      AND reservation_acquired_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shop_webhook_tasks_target_processing_reservation
    ON public.shop_webhook_tasks(target_key, lock_expires_at DESC)
    WHERE status = 'processing'
      AND target_key IS NOT NULL
      AND reservation_lock_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shop_webhook_tasks_channel_processing_reservation
    ON public.shop_webhook_tasks(channel_key, lock_expires_at DESC)
    WHERE status = 'processing'
      AND channel_key IS NOT NULL
      AND reservation_lock_token IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_acquire_shop_delivery_execution_reservation(
    p_task_id UUID,
    p_lock_token TEXT DEFAULT NULL,
    p_worker_name TEXT DEFAULT NULL,
    p_target_key TEXT DEFAULT NULL,
    p_channel_key TEXT DEFAULT NULL,
    p_target_max_inflight INTEGER DEFAULT 1,
    p_target_min_interval_ms INTEGER DEFAULT 0,
    p_channel_max_inflight INTEGER DEFAULT 2,
    p_channel_min_interval_ms INTEGER DEFAULT 0,
    p_lease_seconds INTEGER DEFAULT 120
)
RETURNS TABLE (
    acquired BOOLEAN,
    scope TEXT,
    reason_key TEXT,
    wait_ms INTEGER,
    detail TEXT,
    target_key TEXT,
    channel_key TEXT,
    reservation_acquired_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_task public.shop_webhook_tasks%ROWTYPE;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_lock_token TEXT := NULLIF(BTRIM(p_lock_token), '');
    v_worker_name TEXT := NULLIF(BTRIM(p_worker_name), '');
    v_target_key TEXT;
    v_channel_key TEXT;
    v_target_max_inflight INTEGER := GREATEST(COALESCE(p_target_max_inflight, 1), 1);
    v_target_min_interval_ms INTEGER := GREATEST(COALESCE(p_target_min_interval_ms, 0), 0);
    v_channel_max_inflight INTEGER := GREATEST(COALESCE(p_channel_max_inflight, 2), 1);
    v_channel_min_interval_ms INTEGER := GREATEST(COALESCE(p_channel_min_interval_ms, 0), 0);
    v_lease_seconds INTEGER := GREATEST(COALESCE(p_lease_seconds, 120), 30);
    v_target_inflight INTEGER := 0;
    v_channel_inflight INTEGER := 0;
    v_last_target_started_at TIMESTAMPTZ;
    v_last_channel_started_at TIMESTAMPTZ;
    v_wait_ms INTEGER := 0;
    v_lock_names TEXT[] := ARRAY[]::TEXT[];
    v_lock_name TEXT;
BEGIN
    SELECT *
    INTO v_task
    FROM public.shop_webhook_tasks
    WHERE id = p_task_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN QUERY
        SELECT
            FALSE,
            'worker'::TEXT,
            'task_missing'::TEXT,
            0,
            '履约任务不存在'::TEXT,
            NULL::TEXT,
            NULL::TEXT,
            NULL::TIMESTAMPTZ;
        RETURN;
    END IF;

    v_target_key := COALESCE(
        NULLIF(LOWER(BTRIM(v_task.target_key)), ''),
        NULLIF(LOWER(BTRIM(p_target_key)), ''),
        public.normalize_shop_delivery_target_key(v_task.target_url)
    );
    v_channel_key := COALESCE(
        NULLIF(LOWER(BTRIM(v_task.channel_key)), ''),
        NULLIF(LOWER(BTRIM(p_channel_key)), ''),
        public.normalize_shop_delivery_channel_key(v_task.target_url)
    );

    IF COALESCE(LOWER(BTRIM(v_task.status)), '') <> 'processing'
        OR COALESCE(NULLIF(BTRIM(v_task.lock_token), ''), '') = ''
    THEN
        RETURN QUERY
        SELECT
            FALSE,
            'worker'::TEXT,
            'lock_token_mismatch'::TEXT,
            0,
            '任务锁已释放或被其他 worker 接管'::TEXT,
            v_target_key,
            v_channel_key,
            v_task.reservation_acquired_at;
        RETURN;
    END IF;

    IF v_lock_token IS NOT NULL AND COALESCE(v_task.lock_token, '') <> v_lock_token THEN
        RETURN QUERY
        SELECT
            FALSE,
            'worker'::TEXT,
            'lock_token_mismatch'::TEXT,
            0,
            '任务锁已被其他 worker 接管'::TEXT,
            v_target_key,
            v_channel_key,
            v_task.reservation_acquired_at;
        RETURN;
    END IF;

    v_lock_token := COALESCE(v_lock_token, NULLIF(BTRIM(v_task.lock_token), ''));
    v_worker_name := COALESCE(v_worker_name, NULLIF(BTRIM(v_task.worker_name), ''));

    IF COALESCE(v_task.reservation_lock_token, '') = COALESCE(v_lock_token, '')
        AND v_task.reservation_acquired_at IS NOT NULL
        AND COALESCE(v_task.lock_expires_at, TO_TIMESTAMP(0)) > v_now
    THEN
        RETURN QUERY
        SELECT
            TRUE,
            NULL::TEXT,
            NULL::TEXT,
            0,
            NULL::TEXT,
            v_target_key,
            v_channel_key,
            v_task.reservation_acquired_at;
        RETURN;
    END IF;

    IF v_target_key IS NOT NULL THEN
        v_lock_names := array_append(v_lock_names, 'target:' || v_target_key);
    END IF;
    IF v_channel_key IS NOT NULL THEN
        v_lock_names := array_append(v_lock_names, 'channel:' || v_channel_key);
    END IF;

    IF COALESCE(array_length(v_lock_names, 1), 0) > 0 THEN
        SELECT ARRAY_AGG(lock_name ORDER BY lock_name)
        INTO v_lock_names
        FROM unnest(v_lock_names) AS lock_name;

        FOREACH v_lock_name IN ARRAY v_lock_names LOOP
            PERFORM pg_advisory_xact_lock(60421, hashtext(v_lock_name));
        END LOOP;
    END IF;

    IF v_target_key IS NOT NULL THEN
        SELECT COUNT(*)
        INTO v_target_inflight
        FROM public.shop_webhook_tasks t
        WHERE t.target_key = v_target_key
          AND t.status = 'processing'
          AND COALESCE(t.lock_expires_at, TO_TIMESTAMP(0)) > v_now
          AND COALESCE(NULLIF(BTRIM(t.lock_token), ''), '') <> ''
          AND COALESCE(t.reservation_lock_token, '') = COALESCE(t.lock_token, '')
          AND t.id <> v_task.id;

        IF v_target_inflight >= v_target_max_inflight THEN
            RETURN QUERY
            SELECT
                FALSE,
                'target'::TEXT,
                'target_max_inflight'::TEXT,
                v_target_min_interval_ms,
                ('目标 ' || v_target_key || ' 的全局占位已达到 ' || v_target_max_inflight)::TEXT,
                v_target_key,
                v_channel_key,
                v_task.reservation_acquired_at;
            RETURN;
        END IF;

        SELECT MAX(t.reservation_acquired_at)
        INTO v_last_target_started_at
        FROM public.shop_webhook_tasks t
        WHERE t.target_key = v_target_key
          AND t.reservation_acquired_at IS NOT NULL;

        IF v_target_min_interval_ms > 0 AND v_last_target_started_at IS NOT NULL THEN
            v_wait_ms := GREATEST(
                0,
                CEIL(
                    EXTRACT(
                        EPOCH FROM (
                            (v_last_target_started_at + (v_target_min_interval_ms * INTERVAL '1 millisecond'))
                            - v_now
                        )
                    ) * 1000
                )::INTEGER
            );

            IF v_wait_ms > 0 THEN
                RETURN QUERY
                SELECT
                    FALSE,
                    'target'::TEXT,
                    'target_min_interval'::TEXT,
                    v_wait_ms,
                    ('目标 ' || v_target_key || ' 需至少间隔 ' || v_target_min_interval_ms || 'ms')::TEXT,
                    v_target_key,
                    v_channel_key,
                    v_task.reservation_acquired_at;
                RETURN;
            END IF;
        END IF;
    END IF;

    IF v_channel_key IS NOT NULL THEN
        SELECT COUNT(*)
        INTO v_channel_inflight
        FROM public.shop_webhook_tasks t
        WHERE t.channel_key = v_channel_key
          AND t.status = 'processing'
          AND COALESCE(t.lock_expires_at, TO_TIMESTAMP(0)) > v_now
          AND COALESCE(NULLIF(BTRIM(t.lock_token), ''), '') <> ''
          AND COALESCE(t.reservation_lock_token, '') = COALESCE(t.lock_token, '')
          AND t.id <> v_task.id;

        IF v_channel_inflight >= v_channel_max_inflight THEN
            RETURN QUERY
            SELECT
                FALSE,
                'channel'::TEXT,
                'channel_max_inflight'::TEXT,
                v_channel_min_interval_ms,
                ('通道 ' || v_channel_key || ' 的全局占位已达到 ' || v_channel_max_inflight)::TEXT,
                v_target_key,
                v_channel_key,
                v_task.reservation_acquired_at;
            RETURN;
        END IF;

        SELECT MAX(t.reservation_acquired_at)
        INTO v_last_channel_started_at
        FROM public.shop_webhook_tasks t
        WHERE t.channel_key = v_channel_key
          AND t.reservation_acquired_at IS NOT NULL;

        IF v_channel_min_interval_ms > 0 AND v_last_channel_started_at IS NOT NULL THEN
            v_wait_ms := GREATEST(
                0,
                CEIL(
                    EXTRACT(
                        EPOCH FROM (
                            (v_last_channel_started_at + (v_channel_min_interval_ms * INTERVAL '1 millisecond'))
                            - v_now
                        )
                    ) * 1000
                )::INTEGER
            );

            IF v_wait_ms > 0 THEN
                RETURN QUERY
                SELECT
                    FALSE,
                    'channel'::TEXT,
                    'channel_min_interval'::TEXT,
                    v_wait_ms,
                    ('通道 ' || v_channel_key || ' 需至少间隔 ' || v_channel_min_interval_ms || 'ms')::TEXT,
                    v_target_key,
                    v_channel_key,
                    v_task.reservation_acquired_at;
                RETURN;
            END IF;
        END IF;
    END IF;

    UPDATE public.shop_webhook_tasks
    SET
        target_key = v_target_key,
        channel_key = v_channel_key,
        reservation_acquired_at = v_now,
        reservation_lock_token = v_lock_token,
        reservation_worker_name = v_worker_name,
        lock_expires_at = GREATEST(
            COALESCE(lock_expires_at, TO_TIMESTAMP(0)),
            v_now + make_interval(secs => v_lease_seconds)
        ),
        updated_at = v_now
    WHERE id = v_task.id;

    RETURN QUERY
    SELECT
        TRUE,
        NULL::TEXT,
        NULL::TEXT,
        0,
        NULL::TEXT,
        v_target_key,
        v_channel_key,
        v_now;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_acquire_shop_delivery_execution_reservation(
    UUID,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    INTEGER,
    INTEGER,
    INTEGER,
    INTEGER,
    INTEGER
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_claim_shop_webhook_tasks(
    p_limit INTEGER DEFAULT 10,
    p_lock_seconds INTEGER DEFAULT 120,
    p_worker_name TEXT DEFAULT 'shop-delivery-worker'
)
RETURNS TABLE (
    id UUID,
    order_id UUID,
    target_url TEXT,
    payload JSONB,
    status TEXT,
    attempt_count INTEGER,
    max_attempts INTEGER,
    dedupe_key TEXT,
    lock_token TEXT,
    worker_name TEXT,
    next_attempt_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_limit INTEGER := GREATEST(COALESCE(p_limit, 10), 1);
    v_lock_seconds INTEGER := GREATEST(COALESCE(p_lock_seconds, 120), 30);
    v_worker_name TEXT := COALESCE(NULLIF(BTRIM(p_worker_name), ''), 'shop-delivery-worker');
BEGIN
    RETURN QUERY
    WITH candidates AS (
        SELECT t.id
        FROM public.shop_webhook_tasks t
        WHERE (
            (
                t.status IN ('pending', 'retry_waiting', 'requeued')
                AND COALESCE(t.next_attempt_at, v_now) <= v_now
            )
            OR (
                t.status = 'processing'
                AND COALESCE(t.lock_expires_at, TO_TIMESTAMP(0)) <= v_now
            )
        )
          AND COALESCE(t.attempt_count, 0) < COALESCE(t.max_attempts, 5)
        ORDER BY COALESCE(t.next_attempt_at, t.created_at) ASC, t.created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT v_limit
    ),
    claimed AS (
        UPDATE public.shop_webhook_tasks t
        SET
            status = 'processing',
            attempt_count = COALESCE(t.attempt_count, 0) + 1,
            last_attempt_at = v_now,
            locked_at = v_now,
            lock_expires_at = v_now + make_interval(secs => v_lock_seconds),
            lock_token = gen_random_uuid()::TEXT,
            worker_name = v_worker_name,
            reservation_acquired_at = NULL,
            reservation_lock_token = NULL,
            reservation_worker_name = NULL,
            updated_at = v_now
        FROM candidates c
        WHERE t.id = c.id
        RETURNING
            t.id,
            t.order_id,
            t.target_url::TEXT,
            t.payload,
            t.status,
            t.attempt_count,
            t.max_attempts,
            t.dedupe_key,
            t.lock_token,
            t.worker_name,
            t.next_attempt_at
    )
    SELECT
        claimed.id,
        claimed.order_id,
        claimed.target_url,
        claimed.payload,
        claimed.status,
        claimed.attempt_count,
        claimed.max_attempts,
        claimed.dedupe_key,
        claimed.lock_token,
        claimed.worker_name,
        claimed.next_attempt_at
    FROM claimed;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_record_shop_delivery_conflict(
    p_task_id UUID,
    p_lock_token TEXT DEFAULT NULL,
    p_scope TEXT DEFAULT 'worker',
    p_reason_key TEXT DEFAULT 'unknown_conflict',
    p_detail TEXT DEFAULT NULL,
    p_worker_name TEXT DEFAULT NULL,
    p_target_key TEXT DEFAULT NULL,
    p_channel_key TEXT DEFAULT NULL,
    p_strategy_snapshot JSONB DEFAULT '{}'::JSONB,
    p_backoff_seconds INTEGER DEFAULT 45,
    p_conflict_dead_letter_threshold INTEGER DEFAULT 0
)
RETURNS TABLE (
    status TEXT,
    next_attempt_at TIMESTAMPTZ,
    conflict_count INTEGER,
    dead_lettered BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_task public.shop_webhook_tasks%ROWTYPE;
    v_now TIMESTAMPTZ := NOW();
    v_backoff_seconds INTEGER := GREATEST(COALESCE(p_backoff_seconds, 45), 5);
    v_conflict_threshold INTEGER := GREATEST(COALESCE(p_conflict_dead_letter_threshold, 0), 0);
    v_conflict_count INTEGER := 0;
    v_dead_letter BOOLEAN := FALSE;
    v_status TEXT := 'retry_waiting';
    v_next_attempt_at TIMESTAMPTZ;
    v_scope TEXT := COALESCE(NULLIF(BTRIM(LOWER(p_scope)), ''), 'worker');
    v_reason_key TEXT := COALESCE(NULLIF(BTRIM(LOWER(p_reason_key)), ''), 'unknown_conflict');
    v_detail TEXT := NULLIF(BTRIM(p_detail), '');
    v_target_key TEXT;
    v_channel_key TEXT;
    v_error_message TEXT;
BEGIN
    SELECT *
    INTO v_task
    FROM public.shop_webhook_tasks
    WHERE id = p_task_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    IF p_lock_token IS NOT NULL AND COALESCE(v_task.lock_token, '') <> COALESCE(p_lock_token, '') THEN
        RETURN;
    END IF;

    v_conflict_count := GREATEST(COALESCE(v_task.conflict_count, 0) + 1, 1);
    v_dead_letter := v_conflict_threshold > 0 AND v_conflict_count >= v_conflict_threshold;
    v_status := CASE WHEN v_dead_letter THEN 'dead_letter' ELSE 'retry_waiting' END;
    v_next_attempt_at := v_now + make_interval(secs => v_backoff_seconds);
    v_target_key := COALESCE(
        NULLIF(BTRIM(v_task.target_key), ''),
        NULLIF(BTRIM(p_target_key), ''),
        public.normalize_shop_delivery_target_key(v_task.target_url)
    );
    v_channel_key := COALESCE(
        NULLIF(BTRIM(v_task.channel_key), ''),
        NULLIF(BTRIM(p_channel_key), ''),
        public.normalize_shop_delivery_channel_key(v_task.target_url)
    );
    v_error_message := CASE
        WHEN v_dead_letter THEN
            '冲突保护已转死信: ' || COALESCE(v_detail, v_scope || '/' || v_reason_key)
        ELSE
            '冲突保护已重排队: ' || COALESCE(v_detail, v_scope || '/' || v_reason_key)
    END;

    UPDATE public.shop_webhook_tasks
    SET
        status = v_status,
        next_attempt_at = v_next_attempt_at,
        attempt_count = GREATEST(COALESCE(v_task.attempt_count, 0) - CASE WHEN v_task.status = 'processing' THEN 1 ELSE 0 END, 0),
        last_error = v_error_message,
        updated_at = v_now,
        dead_lettered_at = CASE WHEN v_dead_letter THEN COALESCE(v_task.dead_lettered_at, v_now) ELSE NULL END,
        locked_at = NULL,
        lock_expires_at = NULL,
        lock_token = NULL,
        worker_name = NULL,
        reservation_acquired_at = NULL,
        reservation_lock_token = NULL,
        reservation_worker_name = NULL,
        target_key = v_target_key,
        channel_key = v_channel_key,
        conflict_count = v_conflict_count,
        last_conflict_at = v_now,
        last_conflict_reason = v_reason_key,
        last_conflict_scope = v_scope,
        last_conflict_note = v_detail
    WHERE id = v_task.id;

    INSERT INTO public.shop_webhook_task_conflicts (
        task_id,
        order_id,
        scope,
        reason_key,
        detail,
        strategy_snapshot,
        target_key,
        channel_key,
        worker_name,
        lock_token,
        task_status,
        next_attempt_at
    )
    VALUES (
        v_task.id,
        v_task.order_id,
        v_scope,
        v_reason_key,
        v_detail,
        COALESCE(p_strategy_snapshot, '{}'::JSONB),
        v_target_key,
        v_channel_key,
        NULLIF(BTRIM(p_worker_name), ''),
        v_task.lock_token,
        v_status,
        v_next_attempt_at
    );

    IF v_task.order_id IS NOT NULL THEN
        UPDATE public.shop_orders
        SET
            delivery_status = CASE
                WHEN COALESCE(delivery_status, '') = 'delivered' THEN delivery_status
                ELSE v_status
            END,
            delivery_last_error = v_error_message,
            delivery_updated_at = v_now
        WHERE id = v_task.order_id;
    END IF;

    RETURN QUERY
    SELECT
        v_status,
        v_next_attempt_at,
        v_conflict_count,
        v_dead_letter;
END;
$$;
