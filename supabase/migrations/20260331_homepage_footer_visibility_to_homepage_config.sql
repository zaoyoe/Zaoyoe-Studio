BEGIN;

INSERT INTO public.homepage_config (
    site,
    section,
    content,
    is_visible,
    display_order,
    created_at,
    updated_at
)
SELECT
    seed.site,
    'footer',
    '{}'::jsonb,
    seed.is_visible,
    7,
    NOW(),
    NOW()
FROM (
    SELECT
        'cn'::varchar AS site,
        COALESCE(
            (
                SELECT (sc.config_value -> 'cn' ->> 'footer')::boolean
                FROM public.system_config sc
                WHERE sc.config_key = 'section_visibility'
                LIMIT 1
            ),
            true
        ) AS is_visible
    UNION ALL
    SELECT
        'intl'::varchar AS site,
        COALESCE(
            (
                SELECT (sc.config_value -> 'intl' ->> 'footer')::boolean
                FROM public.system_config sc
                WHERE sc.config_key = 'section_visibility'
                LIMIT 1
            ),
            true
        ) AS is_visible
) AS seed
ON CONFLICT (site, section) DO NOTHING;

COMMIT;
