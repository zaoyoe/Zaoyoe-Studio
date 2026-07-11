-- Prompt import rows must store the real prompts.id value.
-- Existing production prompts use numeric ids in this project, so keep imported
-- prompt references as text instead of UUID.

ALTER TABLE public.prompt_import_items
    ALTER COLUMN final_prompt_id TYPE TEXT USING final_prompt_id::TEXT,
    ALTER COLUMN duplicate_of_prompt_id TYPE TEXT USING duplicate_of_prompt_id::TEXT;

COMMENT ON COLUMN public.prompt_import_items.final_prompt_id IS
    'Final Gallery prompt id as text. Supports numeric or UUID prompt tables.';

COMMENT ON COLUMN public.prompt_import_items.duplicate_of_prompt_id IS
    'Duplicate Gallery prompt id as text. Supports numeric or UUID prompt tables.';
