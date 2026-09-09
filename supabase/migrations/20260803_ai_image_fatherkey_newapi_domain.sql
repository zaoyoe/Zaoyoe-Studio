-- Make NewAPI the canonical FatherKey endpoint while retaining the old route
-- as an inactive compatibility record for existing saved configurations.
INSERT INTO public.ai_image_api_base_urls (
    site,
    label,
    base_url,
    is_active,
    display_order,
    metadata
)
VALUES (
    'cn',
    'FatherKey NewAPI',
    'https://new.fatherkey.com/v1',
    TRUE,
    10,
    '{"source":"default","canonical":true}'::jsonb
)
ON CONFLICT (site, base_url) DO UPDATE
SET label = EXCLUDED.label,
    is_active = TRUE,
    display_order = EXCLUDED.display_order,
    metadata = COALESCE(public.ai_image_api_base_urls.metadata, '{}'::jsonb)
        || EXCLUDED.metadata,
    updated_at = NOW();

UPDATE public.ai_image_api_base_urls
SET label = 'FatherKey Legacy API',
    is_active = FALSE,
    display_order = GREATEST(display_order, 90),
    metadata = COALESCE(metadata, '{}'::jsonb)
        || '{"canonical":false,"compatibility_only":true,"replaced_by":"https://new.fatherkey.com/v1"}'::jsonb,
    updated_at = NOW()
WHERE site = 'cn'
  AND base_url = 'https://sub2api.fatherkey.com/v1';
