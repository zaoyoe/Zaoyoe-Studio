CREATE OR REPLACE VIEW public.admin_comments_feed AS
WITH RECURSIVE guestbook_comment_tree AS (
    SELECT
        c.id,
        c.parent_id,
        c.message_id,
        1 AS thread_depth
    FROM public.guestbook_comments c
    WHERE c.parent_id IS NULL

    UNION ALL

    SELECT
        c.id,
        c.parent_id,
        c.message_id,
        guestbook_comment_tree.thread_depth + 1 AS thread_depth
    FROM public.guestbook_comments c
    JOIN guestbook_comment_tree
        ON guestbook_comment_tree.id = c.parent_id
), prompt_comment_tree AS (
    SELECT
        c.id,
        c.parent_id,
        c.id AS root_comment_id,
        0 AS thread_depth
    FROM public.prompt_comments c
    WHERE c.parent_id IS NULL

    UNION ALL

    SELECT
        c.id,
        c.parent_id,
        prompt_comment_tree.root_comment_id,
        prompt_comment_tree.thread_depth + 1 AS thread_depth
    FROM public.prompt_comments c
    JOIN prompt_comment_tree
        ON prompt_comment_tree.id = c.parent_id
), active_blocks AS (
    SELECT
        bu.user_id,
        BOOL_OR(bu.scope = 'all') AS has_global_block,
        BOOL_OR(bu.scope IN ('all', 'guestbook')) AS is_guestbook_blocked,
        BOOL_OR(bu.scope IN ('all', 'gallery')) AS is_gallery_blocked,
        BOOL_OR(bu.scope IN ('all', 'points_usage')) AS is_points_usage_blocked,
        COALESCE(
            ARRAY_AGG(DISTINCT bu.scope) FILTER (WHERE bu.scope IS NOT NULL),
            '{}'::TEXT[]
        ) AS block_scopes
    FROM public.blocked_users bu
    WHERE bu.expires_at IS NULL OR bu.expires_at > NOW()
    GROUP BY bu.user_id
), comment_workflows AS (
    SELECT
        w.site,
        w.entity_type,
        w.entity_id,
        COALESCE(w.status, 'pending') AS workflow_status,
        COALESCE(w.priority, 'normal') AS workflow_priority,
        COALESCE(w.assignee_id::TEXT, '') AS workflow_assignee_id,
        COALESCE(w.assignee_label, '') AS workflow_assignee_label,
        COALESCE(w.tags, '{}'::TEXT[]) AS workflow_tags,
        COALESCE(w.note_count, 0) AS workflow_note_count,
        GREATEST(
            COALESCE(w.linked_ticket_count, 0),
            COALESCE(ARRAY_LENGTH(w.linked_ticket_ids, 1), 0)
        ) AS workflow_linked_ticket_count,
        COALESCE(w.linked_ticket_ids, '{}'::TEXT[]) AS workflow_linked_ticket_ids,
        w.resolved_at AS workflow_resolved_at,
        w.updated_at AS workflow_updated_at,
        w.last_activity_at AS workflow_last_activity_at,
        COALESCE(w.metadata, '{}'::JSONB) AS workflow_metadata
    FROM public.admin_comment_workflows w
), guestbook_message_rows AS (
    SELECT
        m.id::TEXT AS id,
        COALESCE(m.site, 'cn')::TEXT AS site,
        'guestbook'::TEXT AS type,
        'guestbook_message'::TEXT AS entity_type,
        '留言主贴'::TEXT AS entity_label,
        'message'::TEXT AS record_type,
        'top'::TEXT AS level,
        0::INT AS thread_depth,
        COALESCE(m.content, '')::TEXT AS content,
        COALESCE(p.username, '未知用户')::TEXT AS author,
        COALESCE(p.email, '')::TEXT AS email,
        p.avatar_url::TEXT AS avatar,
        m.created_at,
        m.id::TEXT AS context,
        '留言板主贴'::TEXT AS context_title,
        'Guestbook'::TEXT AS context_type_label,
        ''::TEXT AS prompt_title,
        COALESCE(m.like_count, 0)::INT AS like_count,
        COALESCE(m.like_count, 0)::INT AS likes,
        m.user_id::TEXT AS user_id,
        NULL::TEXT AS parent_id,
        m.id::TEXT AS message_id,
        NULL::TEXT AS prompt_id,
        m.id::TEXT AS thread_root_id,
        'guestbook_message'::TEXT AS thread_root_type,
        ''::TEXT AS parent_snippet,
        ''::TEXT AS parent_author,
        COALESCE(m.content, '')::TEXT AS root_snippet,
        NULLIF(BTRIM(COALESCE(m.image_url, '')), '')::TEXT AS image_url,
        FALSE AS is_pinned,
        FALSE AS is_featured,
        COALESCE(reply_counts.reply_count, 0)::INT AS reply_count,
        COALESCE(ab.has_global_block, FALSE) AS has_global_block,
        COALESCE(ab.is_guestbook_blocked, FALSE) AS is_guestbook_blocked,
        COALESCE(ab.is_gallery_blocked, FALSE) AS is_gallery_blocked,
        COALESCE(ab.is_points_usage_blocked, FALSE) AS is_points_usage_blocked,
        COALESCE(ab.block_scopes, '{}'::TEXT[]) AS block_scopes,
        COALESCE(cw.workflow_status, 'pending')::TEXT AS workflow_status,
        COALESCE(cw.workflow_priority, 'normal')::TEXT AS workflow_priority,
        COALESCE(cw.workflow_assignee_id, '')::TEXT AS workflow_assignee_id,
        COALESCE(cw.workflow_assignee_label, '')::TEXT AS workflow_assignee_label,
        COALESCE(cw.workflow_tags, '{}'::TEXT[]) AS workflow_tags,
        COALESCE(cw.workflow_note_count, 0)::INT AS workflow_note_count,
        COALESCE(cw.workflow_linked_ticket_count, 0)::INT AS workflow_linked_ticket_count,
        COALESCE(cw.workflow_linked_ticket_ids, '{}'::TEXT[]) AS workflow_linked_ticket_ids,
        cw.workflow_resolved_at,
        cw.workflow_updated_at,
        cw.workflow_last_activity_at,
        COALESCE(cw.workflow_metadata, '{}'::JSONB) AS workflow_metadata
    FROM public.guestbook_messages m
    LEFT JOIN public.profiles p
        ON p.id = m.user_id
    LEFT JOIN LATERAL (
        SELECT COUNT(*)::INT AS reply_count
        FROM public.guestbook_comments gc
        WHERE gc.message_id = m.id
    ) AS reply_counts
        ON TRUE
    LEFT JOIN active_blocks ab
        ON ab.user_id = m.user_id
    LEFT JOIN comment_workflows cw
        ON cw.entity_type = 'guestbook_message'
        AND cw.entity_id = m.id::TEXT
        AND cw.site = COALESCE(m.site, 'cn')
), guestbook_comment_rows AS (
    SELECT
        c.id::TEXT AS id,
        COALESCE(c.site, gm.site, 'cn')::TEXT AS site,
        'guestbook'::TEXT AS type,
        'guestbook_comment'::TEXT AS entity_type,
        CASE WHEN c.parent_id IS NULL THEN '留言评论' ELSE '留言回复' END::TEXT AS entity_label,
        CASE WHEN c.parent_id IS NULL THEN 'comment' ELSE 'reply' END::TEXT AS record_type,
        CASE WHEN c.parent_id IS NULL THEN 'top' ELSE 'reply' END::TEXT AS level,
        COALESCE(gct.thread_depth, CASE WHEN c.parent_id IS NULL THEN 1 ELSE 2 END)::INT AS thread_depth,
        COALESCE(c.content, '')::TEXT AS content,
        COALESCE(p.username, '未知用户')::TEXT AS author,
        COALESCE(p.email, '')::TEXT AS email,
        p.avatar_url::TEXT AS avatar,
        c.created_at,
        c.message_id::TEXT AS context,
        '留言板主贴'::TEXT AS context_title,
        'Guestbook'::TEXT AS context_type_label,
        ''::TEXT AS prompt_title,
        COALESCE(comment_likes.like_count, 0)::INT AS like_count,
        COALESCE(comment_likes.like_count, 0)::INT AS likes,
        c.user_id::TEXT AS user_id,
        c.parent_id::TEXT AS parent_id,
        c.message_id::TEXT AS message_id,
        NULL::TEXT AS prompt_id,
        c.message_id::TEXT AS thread_root_id,
        'guestbook_message'::TEXT AS thread_root_type,
        COALESCE(parent_comment.content, gm.content, '')::TEXT AS parent_snippet,
        COALESCE(parent_profile.username, message_profile.username, '')::TEXT AS parent_author,
        COALESCE(gm.content, '')::TEXT AS root_snippet,
        NULL::TEXT AS image_url,
        FALSE AS is_pinned,
        FALSE AS is_featured,
        COALESCE(reply_counts.reply_count, 0)::INT AS reply_count,
        COALESCE(ab.has_global_block, FALSE) AS has_global_block,
        COALESCE(ab.is_guestbook_blocked, FALSE) AS is_guestbook_blocked,
        COALESCE(ab.is_gallery_blocked, FALSE) AS is_gallery_blocked,
        COALESCE(ab.is_points_usage_blocked, FALSE) AS is_points_usage_blocked,
        COALESCE(ab.block_scopes, '{}'::TEXT[]) AS block_scopes,
        COALESCE(cw.workflow_status, 'pending')::TEXT AS workflow_status,
        COALESCE(cw.workflow_priority, 'normal')::TEXT AS workflow_priority,
        COALESCE(cw.workflow_assignee_id, '')::TEXT AS workflow_assignee_id,
        COALESCE(cw.workflow_assignee_label, '')::TEXT AS workflow_assignee_label,
        COALESCE(cw.workflow_tags, '{}'::TEXT[]) AS workflow_tags,
        COALESCE(cw.workflow_note_count, 0)::INT AS workflow_note_count,
        COALESCE(cw.workflow_linked_ticket_count, 0)::INT AS workflow_linked_ticket_count,
        COALESCE(cw.workflow_linked_ticket_ids, '{}'::TEXT[]) AS workflow_linked_ticket_ids,
        cw.workflow_resolved_at,
        cw.workflow_updated_at,
        cw.workflow_last_activity_at,
        COALESCE(cw.workflow_metadata, '{}'::JSONB) AS workflow_metadata
    FROM public.guestbook_comments c
    LEFT JOIN public.guestbook_messages gm
        ON gm.id = c.message_id
    LEFT JOIN public.guestbook_comments parent_comment
        ON parent_comment.id = c.parent_id
    LEFT JOIN public.profiles p
        ON p.id = c.user_id
    LEFT JOIN public.profiles parent_profile
        ON parent_profile.id = parent_comment.user_id
    LEFT JOIN public.profiles message_profile
        ON message_profile.id = gm.user_id
    LEFT JOIN guestbook_comment_tree gct
        ON gct.id = c.id
    LEFT JOIN LATERAL (
        SELECT COUNT(*)::INT AS reply_count
        FROM public.guestbook_comments gc
        WHERE gc.parent_id = c.id
    ) AS reply_counts
        ON TRUE
    LEFT JOIN LATERAL (
        SELECT COUNT(*)::INT AS like_count
        FROM public.guestbook_likes gl
        WHERE gl.target_type = 'comment'
          AND gl.target_id = c.id
    ) AS comment_likes
        ON TRUE
    LEFT JOIN active_blocks ab
        ON ab.user_id = c.user_id
    LEFT JOIN comment_workflows cw
        ON cw.entity_type = 'guestbook_comment'
        AND cw.entity_id = c.id::TEXT
        AND cw.site = COALESCE(c.site, gm.site, 'cn')
), gallery_comment_rows AS (
    SELECT
        c.id::TEXT AS id,
        COALESCE(c.site, 'cn')::TEXT AS site,
        'gallery'::TEXT AS type,
        'prompt_comment'::TEXT AS entity_type,
        CASE WHEN c.parent_id IS NULL THEN '画廊评论' ELSE '画廊回复' END::TEXT AS entity_label,
        CASE WHEN c.parent_id IS NULL THEN 'comment' ELSE 'reply' END::TEXT AS record_type,
        CASE WHEN c.parent_id IS NULL THEN 'top' ELSE 'reply' END::TEXT AS level,
        COALESCE(pct.thread_depth, CASE WHEN c.parent_id IS NULL THEN 0 ELSE 1 END)::INT AS thread_depth,
        COALESCE(c.content, '')::TEXT AS content,
        COALESCE(p.username, '未知用户')::TEXT AS author,
        COALESCE(p.email, '')::TEXT AS email,
        p.avatar_url::TEXT AS avatar,
        c.created_at,
        c.prompt_id::TEXT AS context,
        COALESCE(pr.title, 'Unknown')::TEXT AS context_title,
        'Prompt'::TEXT AS context_type_label,
        COALESCE(pr.title, 'Unknown')::TEXT AS prompt_title,
        COALESCE(comment_likes.like_count, 0)::INT AS like_count,
        COALESCE(comment_likes.like_count, 0)::INT AS likes,
        c.user_id::TEXT AS user_id,
        c.parent_id::TEXT AS parent_id,
        NULL::TEXT AS message_id,
        c.prompt_id::TEXT AS prompt_id,
        COALESCE(pct.root_comment_id::TEXT, c.id::TEXT) AS thread_root_id,
        'prompt_comment'::TEXT AS thread_root_type,
        COALESCE(parent_comment.content, '')::TEXT AS parent_snippet,
        COALESCE(parent_profile.username, '')::TEXT AS parent_author,
        COALESCE(root_comment.content, c.content, '')::TEXT AS root_snippet,
        NULLIF(BTRIM(COALESCE(c.image_url, '')), '')::TEXT AS image_url,
        COALESCE(c.is_pinned, FALSE) AS is_pinned,
        FALSE AS is_featured,
        COALESCE(reply_counts.reply_count, 0)::INT AS reply_count,
        COALESCE(ab.has_global_block, FALSE) AS has_global_block,
        COALESCE(ab.is_guestbook_blocked, FALSE) AS is_guestbook_blocked,
        COALESCE(ab.is_gallery_blocked, FALSE) AS is_gallery_blocked,
        COALESCE(ab.is_points_usage_blocked, FALSE) AS is_points_usage_blocked,
        COALESCE(ab.block_scopes, '{}'::TEXT[]) AS block_scopes,
        COALESCE(cw.workflow_status, 'pending')::TEXT AS workflow_status,
        COALESCE(cw.workflow_priority, 'normal')::TEXT AS workflow_priority,
        COALESCE(cw.workflow_assignee_id, '')::TEXT AS workflow_assignee_id,
        COALESCE(cw.workflow_assignee_label, '')::TEXT AS workflow_assignee_label,
        COALESCE(cw.workflow_tags, '{}'::TEXT[]) AS workflow_tags,
        COALESCE(cw.workflow_note_count, 0)::INT AS workflow_note_count,
        COALESCE(cw.workflow_linked_ticket_count, 0)::INT AS workflow_linked_ticket_count,
        COALESCE(cw.workflow_linked_ticket_ids, '{}'::TEXT[]) AS workflow_linked_ticket_ids,
        cw.workflow_resolved_at,
        cw.workflow_updated_at,
        cw.workflow_last_activity_at,
        COALESCE(cw.workflow_metadata, '{}'::JSONB) AS workflow_metadata
    FROM public.prompt_comments c
    LEFT JOIN prompt_comment_tree pct
        ON pct.id = c.id
    LEFT JOIN public.prompt_comments parent_comment
        ON parent_comment.id = c.parent_id
    LEFT JOIN public.prompt_comments root_comment
        ON root_comment.id = pct.root_comment_id
    LEFT JOIN public.prompts pr
        ON pr.id = c.prompt_id
    LEFT JOIN public.profiles p
        ON p.id = c.user_id
    LEFT JOIN public.profiles parent_profile
        ON parent_profile.id = parent_comment.user_id
    LEFT JOIN LATERAL (
        SELECT COUNT(*)::INT AS reply_count
        FROM public.prompt_comments child_comment
        WHERE child_comment.parent_id = c.id
    ) AS reply_counts
        ON TRUE
    LEFT JOIN LATERAL (
        SELECT COUNT(*)::INT AS like_count
        FROM public.comment_likes cl
        WHERE cl.comment_id = c.id
    ) AS comment_likes
        ON TRUE
    LEFT JOIN active_blocks ab
        ON ab.user_id = c.user_id
    LEFT JOIN comment_workflows cw
        ON cw.entity_type = 'prompt_comment'
        AND cw.entity_id = c.id::TEXT
        AND cw.site = COALESCE(c.site, 'cn')
), unioned AS (
    SELECT * FROM guestbook_message_rows
    UNION ALL
    SELECT * FROM guestbook_comment_rows
    UNION ALL
    SELECT * FROM gallery_comment_rows
)
SELECT
    unioned.*,
    (unioned.image_url IS NOT NULL AND BTRIM(COALESCE(unioned.image_url, '')) <> '') AS has_image,
    LOWER(CONCAT_WS(
        ' ',
        COALESCE(unioned.content, ''),
        COALESCE(unioned.author, ''),
        COALESCE(unioned.email, ''),
        COALESCE(unioned.user_id, ''),
        COALESCE(unioned.context_title, ''),
        COALESCE(unioned.prompt_title, ''),
        COALESCE(unioned.id, ''),
        COALESCE(unioned.parent_id, ''),
        COALESCE(unioned.message_id, ''),
        COALESCE(unioned.prompt_id, ''),
        COALESCE(unioned.thread_root_id, ''),
        COALESCE(unioned.parent_snippet, ''),
        COALESCE(unioned.root_snippet, ''),
        COALESCE(unioned.site, ''),
        COALESCE(unioned.type, ''),
        COALESCE(unioned.entity_type, ''),
        ARRAY_TO_STRING(COALESCE(unioned.block_scopes, '{}'::TEXT[]), ' '),
        ARRAY_TO_STRING(COALESCE(unioned.workflow_tags, '{}'::TEXT[]), ' '),
        ARRAY_TO_STRING(COALESCE(unioned.workflow_linked_ticket_ids, '{}'::TEXT[]), ' ')
    )) AS search_document,
    (
        COALESCE(unioned.has_global_block, FALSE)
        OR CASE
            WHEN unioned.type = 'guestbook' THEN COALESCE(unioned.is_guestbook_blocked, FALSE)
            WHEN unioned.type = 'gallery' THEN COALESCE(unioned.is_gallery_blocked, FALSE)
            ELSE FALSE
        END
    ) AS is_blocked,
    (
        COALESCE(unioned.workflow_status, 'pending') = 'escalated'
        OR COALESCE(unioned.workflow_linked_ticket_count, 0) > 0
    ) AS is_escalated,
    (
        (
            COALESCE(unioned.has_global_block, FALSE)
            OR CASE
                WHEN unioned.type = 'guestbook' THEN COALESCE(unioned.is_guestbook_blocked, FALSE)
                WHEN unioned.type = 'gallery' THEN COALESCE(unioned.is_gallery_blocked, FALSE)
                ELSE FALSE
            END
        )
        OR COALESCE(unioned.workflow_priority, 'normal') = 'high'
        OR COALESCE(unioned.workflow_tags, '{}'::TEXT[]) && ARRAY['risk', 'high_risk', 'spam', 'abuse']::TEXT[]
    ) AS is_high_risk
FROM unioned;

GRANT SELECT ON public.admin_comments_feed TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_admin_comments_summary(
    p_site TEXT DEFAULT 'all'
)
RETURNS JSONB
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
WITH normalized_site AS (
    SELECT COALESCE(NULLIF(LOWER(BTRIM(p_site)), ''), 'all') AS site
), feed AS (
    SELECT acf.*
    FROM public.admin_comments_feed acf
    CROSS JOIN normalized_site ns
    WHERE ns.site = 'all' OR acf.site = ns.site
), metrics AS (
    SELECT
        COUNT(*)::INT AS total_feedback,
        COUNT(*) FILTER (WHERE type = 'guestbook' AND record_type = 'message')::INT AS total_messages,
        COUNT(*) FILTER (WHERE record_type = 'comment' AND level = 'top')::INT AS total_comments,
        COUNT(*) FILTER (WHERE level = 'reply')::INT AS total_replies,
        COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('day', NOW()))::INT AS today_count,
        COUNT(DISTINCT user_id) FILTER (
            WHERE user_id IS NOT NULL
              AND user_id <> ''
              AND created_at >= NOW() - INTERVAL '7 day'
        )::INT AS active_users_count,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 day')::INT AS this_week_count,
        COUNT(*) FILTER (
            WHERE created_at >= NOW() - INTERVAL '14 day'
              AND created_at < NOW() - INTERVAL '7 day'
        )::INT AS prev_week_count,
        COUNT(*) FILTER (WHERE workflow_status = 'resolved')::INT AS resolved_count,
        COUNT(*) FILTER (WHERE workflow_status = 'ignored')::INT AS ignored_count,
        COUNT(*) FILTER (WHERE is_escalated)::INT AS escalated_count,
        COUNT(*) FILTER (
            WHERE type = 'guestbook'
              AND record_type = 'message'
              AND COALESCE(reply_count, 0) <= 0
        )::INT AS guestbook_unreplied_count,
        COUNT(*) FILTER (WHERE is_high_risk)::INT AS high_risk_count,
        COUNT(*) FILTER (WHERE is_blocked)::INT AS blocked_count
    FROM feed
)
SELECT JSONB_BUILD_OBJECT(
    'totalCount', total_feedback,
    'todayCount', today_count,
    'activeUsersCount', active_users_count,
    'weekGrowth',
    CASE
        WHEN prev_week_count > 0 THEN ROUND(((this_week_count - prev_week_count)::NUMERIC / prev_week_count) * 100)
        ELSE 0
    END,
    'totalFeedback', total_feedback,
    'totalMessages', total_messages,
    'totalComments', total_comments,
    'totalReplies', total_replies,
    'todayFeedbackCount', today_count,
    'activeUsers7d', active_users_count,
    'openGovernanceCount', GREATEST(total_feedback - resolved_count - ignored_count, 0),
    'escalatedCount', escalated_count,
    'resolvedCount', resolved_count,
    'queueCounts', JSONB_BUILD_OBJECT(
        'guestbook_unreplied', guestbook_unreplied_count,
        'high_risk', high_risk_count,
        'blocked_user', blocked_count,
        'escalated', escalated_count
    )
) FROM metrics;
$$;

REVOKE ALL ON FUNCTION public.fn_admin_comments_summary(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_admin_comments_summary(TEXT) TO authenticated, service_role;
