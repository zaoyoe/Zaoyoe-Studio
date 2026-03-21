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
