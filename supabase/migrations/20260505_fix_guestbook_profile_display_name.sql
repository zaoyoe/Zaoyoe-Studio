BEGIN;

CREATE OR REPLACE FUNCTION public.fn_load_guestbook(
    p_site TEXT DEFAULT 'cn',
    p_limit INT DEFAULT 50,
    p_user_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn_load_guestbook$
DECLARE
    result JSON;
    v_request_user_id UUID := auth.uid();
    v_request_role TEXT := COALESCE(auth.role(), '');
    v_effective_user_id UUID := NULL;
    v_request_is_admin BOOLEAN := FALSE;
BEGIN
    IF v_request_role = 'service_role' THEN
        v_effective_user_id := COALESCE(p_user_id, v_request_user_id);
    ELSIF v_request_user_id IS NOT NULL THEN
        BEGIN
            v_request_is_admin := public.is_admin();
        EXCEPTION WHEN OTHERS THEN
            v_request_is_admin := FALSE;
        END;

        IF v_request_is_admin AND p_user_id IS NOT NULL THEN
            v_effective_user_id := p_user_id;
        ELSE
            v_effective_user_id := v_request_user_id;
        END IF;
    END IF;

    SELECT json_build_object(
        'messages', (
            SELECT COALESCE(json_agg(msg_row ORDER BY msg_row.created_at DESC), '[]'::json)
            FROM (
                SELECT
                    m.id,
                    m.content,
                    m.image_url,
                    m.like_count,
                    m.created_at,
                    m.user_id,
                    json_build_object(
                        'id', COALESCE(p.id, au.id),
                        'username', COALESCE(
                            NULLIF(BTRIM(p.username), ''),
                            NULLIF(BTRIM(au.raw_user_meta_data->>'full_name'), ''),
                            NULLIF(BTRIM(au.raw_user_meta_data->>'name'), ''),
                            NULLIF(split_part(COALESCE(au.email, ''), '@', 1), ''),
                            'Anonymous'
                        ),
                        'avatar_url', COALESCE(
                            NULLIF(BTRIM(p.avatar_url), ''),
                            NULLIF(BTRIM(au.raw_user_meta_data->>'avatar_url'), '')
                        )
                    ) AS profiles
                FROM public.guestbook_messages m
                LEFT JOIN public.profiles p ON p.id = m.user_id
                LEFT JOIN auth.users au ON au.id = m.user_id
                WHERE m.site = p_site
                ORDER BY m.created_at DESC
                LIMIT p_limit
            ) msg_row
        ),
        'comments', (
            SELECT COALESCE(json_agg(cmt_row ORDER BY cmt_row.created_at ASC), '[]'::json)
            FROM (
                SELECT
                    c.id,
                    c.message_id,
                    c.parent_id,
                    c.content,
                    c.created_at,
                    c.user_id,
                    json_build_object(
                        'id', COALESCE(cp.id, cau.id),
                        'username', COALESCE(
                            NULLIF(BTRIM(cp.username), ''),
                            NULLIF(BTRIM(cau.raw_user_meta_data->>'full_name'), ''),
                            NULLIF(BTRIM(cau.raw_user_meta_data->>'name'), ''),
                            NULLIF(split_part(COALESCE(cau.email, ''), '@', 1), ''),
                            'Anonymous'
                        ),
                        'avatar_url', COALESCE(
                            NULLIF(BTRIM(cp.avatar_url), ''),
                            NULLIF(BTRIM(cau.raw_user_meta_data->>'avatar_url'), '')
                        )
                    ) AS profiles,
                    COALESCE(lk.like_count, 0) AS like_count
                FROM public.guestbook_comments c
                LEFT JOIN public.profiles cp ON cp.id = c.user_id
                LEFT JOIN auth.users cau ON cau.id = c.user_id
                LEFT JOIN (
                    SELECT target_id, COUNT(*) AS like_count
                    FROM public.guestbook_likes
                    WHERE target_type = 'comment'
                    GROUP BY target_id
                ) lk ON lk.target_id = c.id
                WHERE c.message_id IN (
                    SELECT id FROM public.guestbook_messages
                    WHERE site = p_site
                    ORDER BY created_at DESC
                    LIMIT p_limit
                )
                ORDER BY c.created_at ASC
            ) cmt_row
        ),
        'user_likes', (
            SELECT COALESCE(json_agg(like_row), '[]'::json)
            FROM (
                SELECT gl.target_type, gl.target_id
                FROM public.guestbook_likes gl
                WHERE v_effective_user_id IS NOT NULL
                  AND gl.user_id = v_effective_user_id
                  AND gl.target_id IN (
                    SELECT id FROM public.guestbook_messages
                    WHERE site = p_site
                    UNION
                    SELECT id FROM public.guestbook_comments
                    WHERE message_id IN (
                        SELECT id FROM public.guestbook_messages
                        WHERE site = p_site
                        ORDER BY created_at DESC
                        LIMIT p_limit
                    )
                  )
            ) like_row
        )
    ) INTO result;

    RETURN result;
END;
$fn_load_guestbook$;

REVOKE ALL ON FUNCTION public.fn_load_guestbook(TEXT, INTEGER, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_load_guestbook(TEXT, INTEGER, UUID) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION pg_temp.fix_guestbook_featured_item_names(p_items JSONB)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $fix_guestbook_featured_item_names$
    WITH item_rows AS (
        SELECT item.value, item.ordinality
        FROM jsonb_array_elements(
            CASE
                WHEN jsonb_typeof(p_items) = 'array' THEN p_items
                ELSE '[]'::jsonb
            END
        ) WITH ORDINALITY AS item(value, ordinality)
    ),
    resolved_items AS (
        SELECT
            item_rows.value,
            item_rows.ordinality,
            COALESCE(
                NULLIF(BTRIM(p.username), ''),
                NULLIF(BTRIM(au.raw_user_meta_data->>'full_name'), ''),
                NULLIF(BTRIM(au.raw_user_meta_data->>'name'), ''),
                NULLIF(split_part(COALESCE(au.email, ''), '@', 1), '')
            ) AS display_name,
            COALESCE(
                NULLIF(BTRIM(p.avatar_url), ''),
                NULLIF(BTRIM(au.raw_user_meta_data->>'avatar_url'), '')
            ) AS avatar_url
        FROM item_rows
        LEFT JOIN public.guestbook_messages m ON m.id::TEXT = item_rows.value->>'id'
        LEFT JOIN public.profiles p ON p.id = m.user_id
        LEFT JOIN auth.users au ON au.id = m.user_id
    )
    SELECT COALESCE(
        jsonb_agg(
            CASE
                WHEN display_name IS NULL THEN value
                ELSE jsonb_set(
                    CASE
                        WHEN avatar_url IS NULL THEN value
                        ELSE jsonb_set(value, '{avatar_url}', to_jsonb(avatar_url), true)
                    END,
                    '{username}',
                    to_jsonb(display_name),
                    true
                )
            END
            ORDER BY ordinality
        ),
        '[]'::jsonb
    )
    FROM resolved_items;
$fix_guestbook_featured_item_names$;

UPDATE public.homepage_config hc
SET
    content = jsonb_set(
        hc.content,
        '{featured_items}',
        pg_temp.fix_guestbook_featured_item_names(hc.content->'featured_items'),
        true
    ),
    updated_at = NOW()
WHERE hc.section = 'guestbook'
  AND jsonb_typeof(hc.content->'featured_items') = 'array'
  AND hc.content->'featured_items' IS DISTINCT FROM pg_temp.fix_guestbook_featured_item_names(hc.content->'featured_items');

UPDATE public.homepage_site_drafts draft
SET
    sections = jsonb_set(
        draft.sections,
        '{guestbook,content,featured_items}',
        pg_temp.fix_guestbook_featured_item_names(draft.sections #> '{guestbook,content,featured_items}'),
        true
    ),
    updated_at = NOW()
WHERE to_regclass('public.homepage_site_drafts') IS NOT NULL
  AND jsonb_typeof(draft.sections #> '{guestbook,content,featured_items}') = 'array'
  AND draft.sections #> '{guestbook,content,featured_items}' IS DISTINCT FROM pg_temp.fix_guestbook_featured_item_names(draft.sections #> '{guestbook,content,featured_items}');

UPDATE public.homepage_site_releases rel
SET payload = jsonb_set(
    rel.payload,
    '{sections,guestbook,content,featured_items}',
    pg_temp.fix_guestbook_featured_item_names(rel.payload #> '{sections,guestbook,content,featured_items}'),
    true
)
WHERE to_regclass('public.homepage_site_releases') IS NOT NULL
  AND jsonb_typeof(rel.payload #> '{sections,guestbook,content,featured_items}') = 'array'
  AND rel.payload #> '{sections,guestbook,content,featured_items}' IS DISTINCT FROM pg_temp.fix_guestbook_featured_item_names(rel.payload #> '{sections,guestbook,content,featured_items}');

COMMIT;
