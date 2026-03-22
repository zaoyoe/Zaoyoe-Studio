-- ============================================
-- Guestbook: Single-Query Loader RPC
-- Fetches messages + profiles + comments + comment profiles + comment likes
-- all in ONE database round-trip
-- ============================================

CREATE OR REPLACE FUNCTION public.fn_load_guestbook(
    p_site TEXT DEFAULT 'cn',
    p_limit INT DEFAULT 50,
    p_user_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
                        'id', p.id,
                        'username', COALESCE(p.username, 'Anonymous'),
                        'avatar_url', p.avatar_url
                    ) AS profiles
                FROM public.guestbook_messages m
                LEFT JOIN public.profiles p ON p.id = m.user_id
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
                        'id', cp.id,
                        'username', COALESCE(cp.username, 'Anonymous'),
                        'avatar_url', cp.avatar_url
                    ) AS profiles,
                    COALESCE(lk.like_count, 0) AS like_count
                FROM public.guestbook_comments c
                LEFT JOIN public.profiles cp ON cp.id = c.user_id
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
            SELECT COALESCE(json_agg(json_build_object(
                'target_type', gl.target_type,
                'target_id', gl.target_id
            )), '[]'::json)
            FROM public.guestbook_likes gl
            WHERE gl.user_id = v_effective_user_id
              AND v_effective_user_id IS NOT NULL
        )
    ) INTO result;

    RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_load_guestbook(TEXT, INT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_load_guestbook(TEXT, INT, UUID) TO anon, authenticated, service_role;
