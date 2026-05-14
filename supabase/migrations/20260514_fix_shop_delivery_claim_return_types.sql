-- Fix shop delivery worker claim RPC return types.
-- Railway logs showed Postgres error 42804:
-- "Returned type character varying(20) does not match expected type text in column 5".
-- The table status column can be varchar while the RPC contract returns TEXT, so cast
-- all text-like returned columns explicitly.

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
            t.status::TEXT,
            t.attempt_count,
            t.max_attempts,
            t.dedupe_key::TEXT,
            t.lock_token::TEXT,
            t.worker_name::TEXT,
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

GRANT EXECUTE ON FUNCTION public.fn_claim_shop_webhook_tasks(INTEGER, INTEGER, TEXT) TO authenticated, service_role;
