-- Prompt Gallery import staging for Meigen and future external sources.
-- Production data flow:
-- 1. Scraped items are staged here for review/progress/retry.
-- 2. Successful imports create rows in public.prompts and then clear bulky staged payloads.
-- 3. Failed or needs-review items keep enough data for an admin retry or manual cleanup.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.prompt_import_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT NOT NULL DEFAULT 'meigen',
    mode TEXT NOT NULL DEFAULT 'review_first',
    site TEXT NOT NULL DEFAULT 'cn' CHECK (site IN ('cn', 'intl')),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (
        status IN ('draft', 'running', 'ready', 'uploading', 'completed', 'needs_attention', 'cancelled')
    ),
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    stats JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    cleanup_after TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.prompt_import_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES public.prompt_import_batches(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'meigen',
    source_item_id TEXT,
    source_page_url TEXT,
    original_work_url TEXT,
    author_name TEXT,
    author_handle TEXT,
    favorite_count INTEGER NOT NULL DEFAULT 0 CHECK (favorite_count >= 0),
    prompt_text TEXT,
    prompt_hash TEXT,
    image_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
    temp_image_assets JSONB NOT NULL DEFAULT '[]'::jsonb,
    final_image_assets JSONB NOT NULL DEFAULT '[]'::jsonb,
    final_prompt_id UUID,
    duplicate_of_prompt_id UUID,
    status TEXT NOT NULL DEFAULT 'staged' CHECK (
        status IN (
            'staged',
            'needs_review',
            'duplicate',
            'queued',
            'uploading',
            'saving',
            'imported',
            'failed',
            'skipped',
            'cleaned'
        )
    ),
    error_summary TEXT,
    error_details JSONB NOT NULL DEFAULT '{}'::jsonb,
    imported_at TIMESTAMPTZ,
    cleaned_at TIMESTAMPTZ,
    cleanup_after TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prompt_import_batches_status_updated
    ON public.prompt_import_batches(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_prompt_import_items_batch_status
    ON public.prompt_import_items(batch_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_prompt_import_items_prompt_hash
    ON public.prompt_import_items(prompt_hash)
    WHERE prompt_hash IS NOT NULL AND prompt_hash <> '';

CREATE INDEX IF NOT EXISTS idx_prompt_import_items_source_item
    ON public.prompt_import_items(source, source_item_id)
    WHERE source_item_id IS NOT NULL AND source_item_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_prompt_import_items_batch_source_item
    ON public.prompt_import_items(batch_id, source, source_item_id)
    WHERE source_item_id IS NOT NULL AND source_item_id <> '';

ALTER TABLE public.prompt_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_import_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage prompt import batches." ON public.prompt_import_batches;
CREATE POLICY "Service role can manage prompt import batches."
    ON public.prompt_import_batches
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can manage prompt import items." ON public.prompt_import_items;
CREATE POLICY "Service role can manage prompt import items."
    ON public.prompt_import_items
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.prompt_import_batches IS
    'Admin-only import batches for external prompt gallery sources such as Meigen.';

COMMENT ON TABLE public.prompt_import_items IS
    'Admin-only staged prompt import items. Bulky scraped payloads are cleared after successful Gallery import.';
