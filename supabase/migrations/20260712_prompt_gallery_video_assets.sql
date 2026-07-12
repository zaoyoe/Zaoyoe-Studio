-- End-to-end video media support for Meigen prompt imports.
-- Binary video/poster objects live in Cloudflare R2; Supabase stores only
-- small source/stored-asset descriptors and public R2 URLs.

ALTER TABLE public.prompts
    ADD COLUMN IF NOT EXISTS video_assets JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.prompt_import_items
    ADD COLUMN IF NOT EXISTS video_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS temp_video_assets JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS final_video_assets JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.prompts.video_assets IS
    'R2-backed prompt videos. Each object may include original, poster, mime_type, width, height, duration, and storage_path.';

COMMENT ON COLUMN public.prompt_import_items.video_sources IS
    'Temporary remote video descriptors collected by the browser extension; cleared after a successful import.';

COMMENT ON COLUMN public.prompt_import_items.final_video_assets IS
    'Final R2-backed video descriptors retained for import audit and retry state.';
