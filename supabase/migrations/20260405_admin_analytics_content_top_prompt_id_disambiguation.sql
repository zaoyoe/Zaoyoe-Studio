DROP FUNCTION IF EXISTS get_content_top_v2(INTEGER, VARCHAR, INTEGER, DATE, DATE);

CREATE OR REPLACE FUNCTION get_content_top_v2(
    p_limit INTEGER DEFAULT 10,
    p_site VARCHAR DEFAULT NULL,
    p_days INTEGER DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
    prompt_id TEXT,
    title TEXT,
    view_count BIGINT,
    unlock_count BIGINT,
    comment_count BIGINT,
    score NUMERIC,
    category TEXT
) AS $$
DECLARE
    v_start_date DATE := CASE
        WHEN p_start_date IS NOT NULL
            THEN p_start_date
        WHEN p_days IS NOT NULL AND p_days > 0
            THEN COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date) - GREATEST(p_days - 1, 0)
        ELSE NULL
    END;
    v_end_date DATE := COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date);
BEGIN
    PERFORM public.require_admin_access();

    RETURN QUERY
    WITH scoped_events AS (
        SELECT
            COALESCE(
                NULLIF(ue.event_data->>'entity_id', ''),
                NULLIF(ue.event_data->'metadata'->>'prompt_id', '')
            ) AS prompt_id,
            NULLIF(ue.event_data->'metadata'->>'title', '') AS prompt_title,
            NULLIF(ue.event_data->'metadata'->>'category', '') AS prompt_category,
            ue.event_name
        FROM public.user_events ue
        WHERE ue.user_id IS NOT NULL
          AND ue.event_name IN ('prompt_view', 'unlock_success')
          AND (v_start_date IS NULL OR get_local_date(ue.created_at) BETWEEN v_start_date AND v_end_date)
          AND (
              p_site IS NULL
              OR COALESCE(NULLIF(ue.site, ''), NULLIF(ue.event_data->>'site', ''), 'cn') = p_site
          )
    ),
    prompt_event_rollup AS (
        SELECT
            se.prompt_id,
            MAX(se.prompt_title) FILTER (WHERE se.prompt_title IS NOT NULL) AS title,
            MAX(se.prompt_category) FILTER (WHERE se.prompt_category IS NOT NULL) AS category,
            COUNT(*) FILTER (WHERE se.event_name = 'prompt_view') AS view_count,
            COUNT(*) FILTER (WHERE se.event_name = 'unlock_success') AS unlock_count
        FROM scoped_events se
        WHERE COALESCE(se.prompt_id, '') <> ''
        GROUP BY se.prompt_id
    ),
    prompt_comment_rollup AS (
        SELECT
            c.prompt_id::TEXT AS prompt_id,
            COUNT(*) AS comment_count
        FROM public.prompt_comments c
        WHERE (p_site IS NULL OR c.site = p_site)
          AND (v_start_date IS NULL OR get_local_date(c.created_at) BETWEEN v_start_date AND v_end_date)
        GROUP BY c.prompt_id::TEXT
    ),
    prompt_keys AS (
        SELECT per.prompt_id AS prompt_id FROM prompt_event_rollup per
        UNION
        SELECT pcr.prompt_id AS prompt_id FROM prompt_comment_rollup pcr
    )
    SELECT
        pk.prompt_id,
        COALESCE(NULLIF(per.title, ''), p.title, '未命名 Prompt')::TEXT AS title,
        COALESCE(per.view_count, 0)::BIGINT AS view_count,
        COALESCE(per.unlock_count, 0)::BIGINT AS unlock_count,
        COALESCE(pcr.comment_count, 0)::BIGINT AS comment_count,
        ROUND(
            COALESCE(per.unlock_count, 0)::NUMERIC * 3
            + COALESCE(pcr.comment_count, 0)::NUMERIC
            + COALESCE(per.view_count, 0)::NUMERIC * 0.2,
            2
        ) AS score,
        COALESCE(NULLIF(per.category, ''), '未分类')::TEXT AS category
    FROM prompt_keys pk
    LEFT JOIN prompt_event_rollup per ON per.prompt_id = pk.prompt_id
    LEFT JOIN prompt_comment_rollup pcr ON pcr.prompt_id = pk.prompt_id
    LEFT JOIN public.prompts p ON p.id::TEXT = pk.prompt_id
    WHERE COALESCE(pk.prompt_id, '') <> ''
    ORDER BY score DESC, unlock_count DESC, view_count DESC, comment_count DESC
    LIMIT GREATEST(COALESCE(p_limit, 10), 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_content_top_v2(INTEGER, VARCHAR, INTEGER, DATE, DATE) TO authenticated;
