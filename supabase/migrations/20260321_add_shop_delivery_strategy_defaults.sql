-- ============================================
-- Shop Delivery Strategy Defaults
-- 为履约任务补齐策略配置落库默认值
-- ============================================

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
        'lease_seconds', 120,
        'http_timeout_ms', 15000,
        'base_backoff_seconds', 30,
        'max_backoff_seconds', 1800
    ),
    NOW()
)
ON CONFLICT (config_key) DO NOTHING;

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

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_shop_delivery_task_defaults ON public.shop_webhook_tasks;
CREATE TRIGGER trg_apply_shop_delivery_task_defaults
    BEFORE INSERT ON public.shop_webhook_tasks
    FOR EACH ROW
    EXECUTE FUNCTION public.apply_shop_delivery_task_defaults();

WITH strategy AS (
    SELECT GREATEST(
        COALESCE(NULLIF(config_value->>'max_attempts', '')::INTEGER, 5),
        1
    ) AS max_attempts
    FROM public.system_config
    WHERE config_key = 'shop_delivery_strategy'
    LIMIT 1
)
UPDATE public.shop_webhook_tasks t
SET
    max_attempts = strategy.max_attempts,
    dedupe_key = COALESCE(NULLIF(t.dedupe_key, ''), 'shop_delivery:' || t.order_id::TEXT),
    next_attempt_at = COALESCE(t.next_attempt_at, NOW()),
    updated_at = NOW()
FROM strategy
WHERE t.status IN ('pending', 'processing', 'retry_waiting', 'requeued')
  AND (
      COALESCE(t.max_attempts, 5) = 5
      OR t.next_attempt_at IS NULL
      OR COALESCE(t.dedupe_key, '') = ''
  );
