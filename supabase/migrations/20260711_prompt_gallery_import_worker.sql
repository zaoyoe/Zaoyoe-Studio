ALTER TABLE public.prompt_import_items
    ADD COLUMN IF NOT EXISTS worker_name TEXT,
    ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS processing_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS pipeline_stage TEXT;

CREATE INDEX IF NOT EXISTS idx_prompt_import_items_worker_claim
    ON public.prompt_import_items(status, next_attempt_at, lease_expires_at, created_at)
    WHERE status IN ('staged', 'queued', 'failed');

CREATE OR REPLACE FUNCTION public.claim_prompt_import_items(
    p_worker_name TEXT,
    p_limit INTEGER DEFAULT 4,
    p_lease_seconds INTEGER DEFAULT 300
)
RETURNS SETOF public.prompt_import_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    WITH candidates AS (
        SELECT item.id
        FROM public.prompt_import_items AS item
        WHERE item.status IN ('staged', 'queued', 'failed')
          AND item.processing_attempts < 3
          AND (item.next_attempt_at IS NULL OR item.next_attempt_at <= NOW())
          AND (item.lease_expires_at IS NULL OR item.lease_expires_at <= NOW())
          AND COALESCE(item.prompt_text, '') <> ''
          AND jsonb_array_length(COALESCE(item.image_sources, '[]'::jsonb)) > 0
          AND COALESCE(item.original_work_url, '') <> ''
          AND COALESCE(item.author_name, '') <> ''
          AND COALESCE(item.author_handle, '') <> ''
        ORDER BY item.created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT LEAST(GREATEST(COALESCE(p_limit, 4), 1), 10)
    )
    UPDATE public.prompt_import_items AS item
    SET status = 'queued',
        worker_name = LEFT(COALESCE(NULLIF(p_worker_name, ''), 'prompt-import-worker'), 160),
        lease_expires_at = NOW() + make_interval(secs => LEAST(GREATEST(COALESCE(p_lease_seconds, 300), 60), 1800)),
        processing_attempts = item.processing_attempts + 1,
        pipeline_stage = 'claimed',
        error_summary = '',
        updated_at = NOW()
    FROM candidates
    WHERE item.id = candidates.id
    RETURNING item.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_prompt_import_items(TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_prompt_import_items(TEXT, INTEGER, INTEGER) TO service_role;
