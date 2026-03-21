-- ============================================
-- Shop Delivery Conflict Controls
-- 目标 / 通道限流、冲突审计与专门冲突处理策略
-- ============================================

CREATE OR REPLACE FUNCTION public.normalize_shop_delivery_channel_key(p_target_url TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_url TEXT := LOWER(BTRIM(COALESCE(p_target_url, '')));
    v_host TEXT;
BEGIN
    IF v_url = '' THEN
        RETURN NULL;
    END IF;

    v_url := regexp_replace(v_url, '^https?://', '');
    v_host := split_part(v_url, '/', 1);
    v_host := split_part(v_host, '?', 1);
    v_host := split_part(v_host, '#', 1);

    RETURN NULLIF(v_host, '');
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_shop_delivery_target_key(p_target_url TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_url TEXT := LOWER(BTRIM(COALESCE(p_target_url, '')));
    v_host TEXT;
    v_path TEXT;
BEGIN
    IF v_url = '' THEN
        RETURN NULL;
    END IF;

    v_url := regexp_replace(v_url, '^https?://', '');
    v_host := split_part(v_url, '/', 1);
    v_host := split_part(v_host, '?', 1);
    v_host := split_part(v_host, '#', 1);

    v_path := substring(v_url FROM '^[^/]+(/[^?#]*)');
    IF COALESCE(v_path, '') = '' THEN
        v_path := '/';
    END IF;

    RETURN CASE
        WHEN COALESCE(v_host, '') = '' THEN NULL
        ELSE v_host || v_path
    END;
END;
$$;

INSERT INTO public.system_config (
    config_key,
    config_value,
    updated_at
)
VALUES (
    'shop_delivery_strategy',
    jsonb_build_object(
        'max_attempts', 5,
        'sweep_interval_ms', 10000,
        'sweep_batch_size', 10,
        'worker_parallelism', 1,
        'lease_seconds', 120,
        'http_timeout_ms', 15000,
        'base_backoff_seconds', 30,
        'max_backoff_seconds', 1800,
        'target_min_interval_ms', 0,
        'target_max_inflight', 1,
        'channel_min_interval_ms', 0,
        'channel_max_inflight', 2,
        'conflict_backoff_seconds', 45,
        'conflict_dead_letter_threshold', 0
    ),
    NOW()
)
ON CONFLICT (config_key) DO NOTHING;

UPDATE public.system_config sc
SET
    config_value = COALESCE(sc.config_value, '{}'::JSONB)
        || jsonb_strip_nulls(jsonb_build_object(
            'worker_parallelism', CASE WHEN COALESCE(sc.config_value, '{}'::JSONB) ? 'worker_parallelism' THEN NULL ELSE to_jsonb(1) END,
            'target_min_interval_ms', CASE WHEN COALESCE(sc.config_value, '{}'::JSONB) ? 'target_min_interval_ms' THEN NULL ELSE to_jsonb(0) END,
            'target_max_inflight', CASE WHEN COALESCE(sc.config_value, '{}'::JSONB) ? 'target_max_inflight' THEN NULL ELSE to_jsonb(1) END,
            'channel_min_interval_ms', CASE WHEN COALESCE(sc.config_value, '{}'::JSONB) ? 'channel_min_interval_ms' THEN NULL ELSE to_jsonb(0) END,
            'channel_max_inflight', CASE WHEN COALESCE(sc.config_value, '{}'::JSONB) ? 'channel_max_inflight' THEN NULL ELSE to_jsonb(2) END,
            'conflict_backoff_seconds', CASE WHEN COALESCE(sc.config_value, '{}'::JSONB) ? 'conflict_backoff_seconds' THEN NULL ELSE to_jsonb(45) END,
            'conflict_dead_letter_threshold', CASE WHEN COALESCE(sc.config_value, '{}'::JSONB) ? 'conflict_dead_letter_threshold' THEN NULL ELSE to_jsonb(0) END
        )),
    updated_at = NOW()
WHERE sc.config_key = 'shop_delivery_strategy';

ALTER TABLE IF EXISTS public.shop_webhook_tasks
    ADD COLUMN IF NOT EXISTS target_key TEXT,
    ADD COLUMN IF NOT EXISTS channel_key TEXT,
    ADD COLUMN IF NOT EXISTS conflict_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_conflict_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_conflict_reason TEXT,
    ADD COLUMN IF NOT EXISTS last_conflict_scope TEXT,
    ADD COLUMN IF NOT EXISTS last_conflict_note TEXT;

UPDATE public.shop_webhook_tasks
SET
    target_key = COALESCE(NULLIF(target_key, ''), public.normalize_shop_delivery_target_key(target_url)),
    channel_key = COALESCE(NULLIF(channel_key, ''), public.normalize_shop_delivery_channel_key(target_url)),
    conflict_count = GREATEST(COALESCE(conflict_count, 0), 0)
WHERE COALESCE(target_key, '') = ''
   OR COALESCE(channel_key, '') = ''
   OR conflict_count IS NULL
   OR conflict_count < 0;

CREATE INDEX IF NOT EXISTS idx_shop_webhook_tasks_target_key_status
    ON public.shop_webhook_tasks(target_key, status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_shop_webhook_tasks_channel_key_status
    ON public.shop_webhook_tasks(channel_key, status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_shop_webhook_tasks_last_conflict_at
    ON public.shop_webhook_tasks(last_conflict_at DESC);

CREATE TABLE IF NOT EXISTS public.shop_webhook_task_conflicts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES public.shop_webhook_tasks(id) ON DELETE CASCADE,
    order_id UUID REFERENCES public.shop_orders(id) ON DELETE SET NULL,
    scope TEXT NOT NULL,
    reason_key TEXT NOT NULL,
    detail TEXT,
    strategy_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
    target_key TEXT,
    channel_key TEXT,
    worker_name TEXT,
    lock_token TEXT,
    task_status TEXT,
    next_attempt_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shop_webhook_task_conflicts_task_created
    ON public.shop_webhook_task_conflicts(task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shop_webhook_task_conflicts_scope_reason
    ON public.shop_webhook_task_conflicts(scope, reason_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shop_webhook_task_conflicts_created
    ON public.shop_webhook_task_conflicts(created_at DESC);

CREATE OR REPLACE FUNCTION public.apply_shop_delivery_task_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_strategy JSONB;
    v_default_max_attempts INTEGER := 5;
BEGIN
    SELECT config_value
    INTO v_strategy
    FROM public.system_config
    WHERE config_key = 'shop_delivery_strategy'
    LIMIT 1;

    IF jsonb_typeof(v_strategy) = 'object' THEN
        v_default_max_attempts := GREATEST(
            COALESCE(NULLIF(v_strategy->>'max_attempts', '')::INTEGER, 5),
            1
        );
    END IF;

    IF COALESCE(BTRIM(NEW.status), '') = '' THEN
        NEW.status := 'pending';
    END IF;

    IF NEW.attempt_count IS NULL OR NEW.attempt_count < 0 THEN
        NEW.attempt_count := 0;
    END IF;

    IF NEW.next_attempt_at IS NULL THEN
        NEW.next_attempt_at := NOW();
    END IF;

    IF COALESCE(NEW.dedupe_key, '') = '' AND NEW.order_id IS NOT NULL THEN
        NEW.dedupe_key := 'shop_delivery:' || NEW.order_id::TEXT;
    END IF;

    IF NEW.max_attempts IS NULL OR NEW.max_attempts <= 0 OR NEW.max_attempts = 5 THEN
        NEW.max_attempts := v_default_max_attempts;
    END IF;

    IF NEW.conflict_count IS NULL OR NEW.conflict_count < 0 THEN
        NEW.conflict_count := 0;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        NEW.target_key := public.normalize_shop_delivery_target_key(NEW.target_url);
        NEW.channel_key := public.normalize_shop_delivery_channel_key(NEW.target_url);
    ELSE
        IF COALESCE(NULLIF(BTRIM(NEW.target_key), ''), '') = '' THEN
            NEW.target_key := public.normalize_shop_delivery_target_key(NEW.target_url);
        END IF;
        IF COALESCE(NULLIF(BTRIM(NEW.channel_key), ''), '') = '' THEN
            NEW.channel_key := public.normalize_shop_delivery_channel_key(NEW.target_url);
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_shop_delivery_task_defaults ON public.shop_webhook_tasks;
CREATE TRIGGER trg_apply_shop_delivery_task_defaults
    BEFORE INSERT OR UPDATE OF target_url ON public.shop_webhook_tasks
    FOR EACH ROW
    EXECUTE FUNCTION public.apply_shop_delivery_task_defaults();

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

GRANT EXECUTE ON FUNCTION public.fn_record_shop_delivery_conflict(
    UUID,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    JSONB,
    INTEGER,
    INTEGER
) TO authenticated, service_role;
