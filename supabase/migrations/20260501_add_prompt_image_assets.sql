-- Migration: Store prompt images as explicit responsive asset objects.

ALTER TABLE public.prompts
ADD COLUMN IF NOT EXISTS image_assets JSONB DEFAULT '[]'::jsonb;

UPDATE public.prompts
SET image_assets = (
    SELECT COALESCE(
        jsonb_agg(jsonb_build_object('original', image_url) ORDER BY ordinality),
        '[]'::jsonb
    )
    FROM unnest(COALESCE(images, ARRAY[]::text[])) WITH ORDINALITY AS image_items(image_url, ordinality)
    WHERE NULLIF(btrim(image_url), '') IS NOT NULL
)
WHERE (
    image_assets IS NULL
    OR jsonb_typeof(image_assets) <> 'array'
    OR image_assets = '[]'::jsonb
)
AND COALESCE(array_length(images, 1), 0) > 0;
