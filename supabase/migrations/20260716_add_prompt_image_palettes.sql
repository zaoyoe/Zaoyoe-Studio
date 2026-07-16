ALTER TABLE public.prompts
    ADD COLUMN IF NOT EXISTS image_palettes JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.prompts
SET image_palettes = '[]'::jsonb
WHERE image_palettes IS NULL;

ALTER TABLE public.prompts
    ALTER COLUMN image_palettes SET DEFAULT '[]'::jsonb,
    ALTER COLUMN image_palettes SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'prompts_image_palettes_is_array'
            AND conrelid = 'public.prompts'::regclass
    ) THEN
        ALTER TABLE public.prompts
            ADD CONSTRAINT prompts_image_palettes_is_array
            CHECK (jsonb_typeof(image_palettes) = 'array');
    END IF;
END;
$$;

COMMENT ON COLUMN public.prompts.image_palettes IS
    'Server-generated deterministic 3-6 color palettes keyed by prompt image index and SHA-256.';

SELECT pg_notify('pgrst', 'reload schema');
