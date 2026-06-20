-- Add source attribution fields for prompt gallery cards.

ALTER TABLE public.prompts ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE public.prompts ADD COLUMN IF NOT EXISTS source_author_name TEXT;
ALTER TABLE public.prompts ADD COLUMN IF NOT EXISTS source_author_handle TEXT;
ALTER TABLE public.prompts ADD COLUMN IF NOT EXISTS source_author_avatar_url TEXT;

CREATE OR REPLACE FUNCTION public.fn_admin_gallery_prompt_manage_list(
    p_site TEXT DEFAULT 'all',
    p_page INTEGER DEFAULT 1,
    p_page_size INTEGER DEFAULT 10,
    p_search TEXT DEFAULT '',
    p_category TEXT DEFAULT '',
    p_date_filter TEXT DEFAULT '',
    p_language_filter TEXT DEFAULT '',
    p_status_filter TEXT DEFAULT '',
    p_sort TEXT DEFAULT 'updated-desc'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_site TEXT := CASE WHEN lower(trim(coalesce(p_site, 'all'))) IN ('cn', 'intl') THEN lower(trim(p_site)) ELSE 'all' END;
    v_page INTEGER := greatest(coalesce(p_page, 1), 1);
    v_page_size INTEGER := least(greatest(coalesce(p_page_size, 10), 1), 100);
    v_offset INTEGER := 0;
    v_search TEXT := lower(trim(coalesce(p_search, '')));
    v_category TEXT := lower(trim(coalesce(p_category, '')));
    v_date_filter TEXT := lower(trim(coalesce(p_date_filter, '')));
    v_language_filter TEXT := lower(trim(coalesce(p_language_filter, '')));
    v_status_filter TEXT := lower(trim(coalesce(p_status_filter, '')));
    v_sort TEXT := lower(trim(coalesce(p_sort, 'updated-desc')));
    v_start_at TIMESTAMPTZ := NULL;
    v_total_items BIGINT := 0;
    v_rows JSONB := '[]'::jsonb;
BEGIN
    PERFORM public.require_admin_access();

    IF v_sort NOT IN ('updated-desc', 'created-desc', 'engagement-desc', 'status-priority', 'title-asc') THEN
        v_sort := 'updated-desc';
    END IF;

    IF v_date_filter = 'today' THEN
        v_start_at := date_trunc('day', now());
    ELSIF v_date_filter = 'week' THEN
        v_start_at := date_trunc('day', now()) - interval '7 days';
    ELSIF v_date_filter = 'month' THEN
        v_start_at := date_trunc('day', now()) - interval '30 days';
    END IF;

    v_offset := (v_page - 1) * v_page_size;

    WITH unlock_metrics AS (
        SELECT
            prompt_id::text AS prompt_id,
            count(*) FILTER (WHERE coalesce(site, 'cn') = 'cn')::bigint AS cn_unlock_count,
            count(*) FILTER (WHERE coalesce(site, 'cn') = 'intl')::bigint AS intl_unlock_count,
            count(*)::bigint AS total_unlock_count
        FROM public.prompt_unlocks
        GROUP BY prompt_id::text
    ),
    comment_metrics AS (
        SELECT
            prompt_id::text AS prompt_id,
            count(*) FILTER (WHERE coalesce(site, 'cn') = 'cn')::bigint AS cn_comment_count,
            count(*) FILTER (WHERE coalesce(site, 'cn') = 'intl')::bigint AS intl_comment_count,
            count(*)::bigint AS total_comment_count
        FROM public.prompt_comments
        GROUP BY prompt_id::text
    ),
    base AS (
        SELECT
            p.*,
            coalesce(u.cn_unlock_count, 0) AS cn_unlock_count,
            coalesce(c.cn_comment_count, 0) AS cn_comment_count,
            coalesce(u.intl_unlock_count, 0) AS intl_unlock_count,
            coalesce(c.intl_comment_count, 0) AS intl_comment_count,
            coalesce(u.total_unlock_count, 0) AS total_unlock_count,
            coalesce(c.total_comment_count, 0) AS total_comment_count,
            (
                coalesce(nullif(trim(p.title_zh), ''), '') <> ''
                OR coalesce(nullif(trim(p.description_zh), ''), '') <> ''
                OR coalesce(nullif(trim(p.prompt_text_zh), ''), '') <> ''
            ) AS has_zh_copy,
            (
                coalesce(nullif(trim(p.title_en), ''), '') <> ''
                OR coalesce(nullif(trim(p.description_en), ''), '') <> ''
                OR coalesce(nullif(trim(p.prompt_text_en), ''), '') <> ''
            ) AS has_en_copy,
            lower(trim(coalesce(p.ai_tags #>> '{admin,status}', p.ai_tags #>> '{ops,status}', ''))) AS ops_status,
            concat_ws(
                ' ',
                p.id::text,
                p.title,
                p.title_zh,
                p.title_en,
                p.description,
                p.description_zh,
                p.description_en,
                p.prompt_text,
                p.prompt_text_zh,
                p.prompt_text_en,
                p.source_url,
                p.source_author_name,
                p.source_author_handle,
                array_to_string(coalesce(p.tags, ARRAY[]::text[]), ' '),
                array_to_string(coalesce(p.dominant_colors, ARRAY[]::text[]), ' '),
                coalesce(p.ai_tags::text, '')
            ) AS searchable_text
        FROM public.prompts p
        LEFT JOIN unlock_metrics u ON u.prompt_id = p.id::text
        LEFT JOIN comment_metrics c ON c.prompt_id = p.id::text
    ),
    derived AS (
        SELECT
            base.*,
            CASE
                WHEN ops_status = 'archived' THEN 'archived'
                WHEN ops_status = 'draft' THEN 'draft'
                WHEN coalesce(nullif(trim(title), ''), '') = ''
                    OR coalesce(nullif(trim(prompt_text), ''), '') = ''
                    OR NOT EXISTS (
                        SELECT 1 FROM unnest(coalesce(images, ARRAY[]::text[])) AS image_values(image_value)
                        WHERE coalesce(nullif(trim(image_value), ''), '') <> ''
                    ) THEN 'draft'
                WHEN ops_status = 'review' THEN 'review'
                WHEN NOT has_zh_copy OR NOT has_en_copy THEN 'needs-localization'
                WHEN ops_status = 'homepage-candidate' THEN 'homepage-candidate'
                WHEN ops_status = 'featured' THEN 'featured'
                WHEN total_unlock_count > 0 OR total_comment_count > 0 THEN 'live'
                WHEN ops_status = 'live' THEN 'live'
                ELSE 'ready'
            END AS lifecycle_status,
            CASE
                WHEN v_site = 'cn' THEN cn_unlock_count * 3 + cn_comment_count
                WHEN v_site = 'intl' THEN intl_unlock_count * 3 + intl_comment_count
                ELSE total_unlock_count * 3 + total_comment_count
            END AS engagement_score
        FROM base
    ),
    filtered AS (
        SELECT *
        FROM derived
        WHERE
            (v_category = '' OR EXISTS (
                SELECT 1 FROM unnest(coalesce(tags, ARRAY[]::text[])) AS tag_values(tag_value)
                WHERE lower(tag_value) = v_category
            ))
            AND (v_start_at IS NULL OR created_at >= v_start_at)
            AND (
                v_language_filter = ''
                OR (v_language_filter = 'bilingual-ready' AND has_zh_copy AND has_en_copy)
                OR (v_language_filter = 'zh-ready' AND has_zh_copy)
                OR (v_language_filter = 'en-ready' AND has_en_copy)
                OR (v_language_filter = 'needs-translation' AND NOT (has_zh_copy AND has_en_copy))
            )
            AND (v_status_filter = '' OR lifecycle_status = v_status_filter)
            AND (
                v_search = ''
                OR NOT EXISTS (
                    SELECT 1
                    FROM regexp_split_to_table(v_search, '\s+') AS search_terms(search_term)
                    WHERE search_term <> ''
                        AND lower(searchable_text) NOT LIKE '%' || search_term || '%'
                )
            )
    ),
    total AS (
        SELECT count(*)::bigint AS total_items FROM filtered
    ),
    page_rows AS (
        SELECT *
        FROM filtered
        ORDER BY
            CASE
                WHEN v_sort = 'title-asc' THEN lower(coalesce(nullif(trim(title), ''), nullif(trim(title_zh), ''), nullif(trim(title_en), ''), ''))
            END ASC NULLS LAST,
            CASE WHEN v_sort = 'created-desc' THEN created_at END DESC NULLS LAST,
            CASE WHEN v_sort = 'engagement-desc' THEN engagement_score END DESC NULLS LAST,
            CASE
                WHEN v_sort = 'status-priority' THEN
                    CASE lifecycle_status
                        WHEN 'review' THEN 0
                        WHEN 'homepage-candidate' THEN 1
                        WHEN 'featured' THEN 2
                        WHEN 'live' THEN 3
                        WHEN 'needs-localization' THEN 4
                        WHEN 'ready' THEN 5
                        WHEN 'draft' THEN 6
                        WHEN 'archived' THEN 7
                        ELSE 99
                    END
            END ASC NULLS LAST,
            CASE WHEN v_sort NOT IN ('title-asc', 'created-desc') THEN coalesce(updated_at, created_at) END DESC NULLS LAST,
            created_at DESC NULLS LAST,
            id ASC
        LIMIT v_page_size
        OFFSET v_offset
    )
    SELECT
        total.total_items,
        coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'id', page_rows.id,
                    'title', page_rows.title,
                    'tags', coalesce(page_rows.tags, ARRAY[]::text[]),
                    'description', page_rows.description,
                    'prompt_text', page_rows.prompt_text,
                    'images', coalesce(page_rows.images, ARRAY[]::text[]),
                    'created_at', page_rows.created_at,
                    'dominant_colors', coalesce(page_rows.dominant_colors, ARRAY[]::text[]),
                    'ai_tags', coalesce(page_rows.ai_tags, '{}'::jsonb),
                    'image_assets', coalesce(page_rows.image_assets, '[]'::jsonb),
                    'quality_score', page_rows.quality_score,
                    'updated_at', page_rows.updated_at,
                    'title_zh', coalesce(page_rows.title_zh, ''),
                    'title_en', coalesce(page_rows.title_en, ''),
                    'description_zh', coalesce(page_rows.description_zh, ''),
                    'description_en', coalesce(page_rows.description_en, ''),
                    'prompt_text_zh', coalesce(page_rows.prompt_text_zh, ''),
                    'prompt_text_en', coalesce(page_rows.prompt_text_en, ''),
                    'source_url', coalesce(page_rows.source_url, ''),
                    'source_author_name', coalesce(page_rows.source_author_name, ''),
                    'source_author_handle', coalesce(page_rows.source_author_handle, ''),
                    'source_author_avatar_url', coalesce(page_rows.source_author_avatar_url, ''),
                    'site_metrics', jsonb_build_object(
                        'cn', jsonb_build_object(
                            'unlock_count', page_rows.cn_unlock_count,
                            'comment_count', page_rows.cn_comment_count
                        ),
                        'intl', jsonb_build_object(
                            'unlock_count', page_rows.intl_unlock_count,
                            'comment_count', page_rows.intl_comment_count
                        ),
                        'total', jsonb_build_object(
                            'unlock_count', page_rows.total_unlock_count,
                            'comment_count', page_rows.total_comment_count
                        )
                    )
                )
                ORDER BY
                    CASE
                        WHEN v_sort = 'title-asc' THEN lower(coalesce(nullif(trim(page_rows.title), ''), nullif(trim(page_rows.title_zh), ''), nullif(trim(page_rows.title_en), ''), ''))
                    END ASC NULLS LAST,
                    CASE WHEN v_sort = 'created-desc' THEN page_rows.created_at END DESC NULLS LAST,
                    CASE WHEN v_sort = 'engagement-desc' THEN page_rows.engagement_score END DESC NULLS LAST,
                    CASE
                        WHEN v_sort = 'status-priority' THEN
                            CASE page_rows.lifecycle_status
                                WHEN 'review' THEN 0
                                WHEN 'homepage-candidate' THEN 1
                                WHEN 'featured' THEN 2
                                WHEN 'live' THEN 3
                                WHEN 'needs-localization' THEN 4
                                WHEN 'ready' THEN 5
                                WHEN 'draft' THEN 6
                                WHEN 'archived' THEN 7
                                ELSE 99
                            END
                    END ASC NULLS LAST,
                    CASE WHEN v_sort NOT IN ('title-asc', 'created-desc') THEN coalesce(page_rows.updated_at, page_rows.created_at) END DESC NULLS LAST,
                    page_rows.created_at DESC NULLS LAST,
                    page_rows.id ASC
            ) FILTER (WHERE page_rows.id IS NOT NULL),
            '[]'::jsonb
        )
    INTO v_total_items, v_rows
    FROM total
    LEFT JOIN page_rows ON true
    GROUP BY total.total_items;

    RETURN jsonb_build_object(
        'rows', coalesce(v_rows, '[]'::jsonb),
        'pagination', jsonb_build_object(
            'page', v_page,
            'pageSize', v_page_size,
            'totalItems', coalesce(v_total_items, 0),
            'totalPages', greatest(1, ceil(coalesce(v_total_items, 0)::numeric / v_page_size)::integer),
            'hasPrevPage', v_page > 1,
            'hasNextPage', v_page < greatest(1, ceil(coalesce(v_total_items, 0)::numeric / v_page_size)::integer),
            'returnedItems', jsonb_array_length(coalesce(v_rows, '[]'::jsonb))
        )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_admin_gallery_prompt_manage_list(
    TEXT,
    INTEGER,
    INTEGER,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    TEXT
) TO authenticated, service_role;

SELECT pg_notify('pgrst', 'reload schema');
