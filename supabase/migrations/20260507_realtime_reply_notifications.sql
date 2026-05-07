BEGIN;

CREATE OR REPLACE FUNCTION public.fn_engagement_collapse_preview(
    p_value TEXT,
    p_max_length INT DEFAULT 120
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $fn$
    SELECT LEFT(
        REGEXP_REPLACE(BTRIM(COALESCE(p_value, '')), '\s+', ' ', 'g'),
        GREATEST(COALESCE(p_max_length, 120), 1)
    );
$fn$;

CREATE OR REPLACE FUNCTION public.fn_create_reply_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
    v_site TEXT := 'cn';
    v_recipient_id UUID := NULL;
    v_parent_id UUID := NEW.parent_id;
    v_message_id UUID := NULL;
    v_target_type TEXT := '';
    v_prompt_title TEXT := '';
    v_preview TEXT := public.fn_engagement_collapse_preview(NEW.content, 120);
    v_source_event_id TEXT := '';
    v_category TEXT := '';
    v_title TEXT := '';
    v_content TEXT := '';
    v_action_label TEXT := '';
    v_action_url TEXT := '';
    v_priority INT := 0;
    v_source_module TEXT := '';
    v_metadata JSONB := '{}'::JSONB;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'prompt_comments' THEN
        IF v_parent_id IS NULL THEN
            RETURN NEW;
        END IF;

        SELECT
            parent.user_id,
            CASE
                WHEN COALESCE(NULLIF(BTRIM(NEW.site), ''), NULLIF(BTRIM(parent.site), ''), 'cn') = 'intl' THEN 'intl'
                ELSE 'cn'
            END,
            COALESCE(NULLIF(BTRIM(prompt.title), ''), '')
        INTO
            v_recipient_id,
            v_site,
            v_prompt_title
        FROM public.prompt_comments parent
        LEFT JOIN public.prompts prompt
            ON prompt.id = NEW.prompt_id
        WHERE parent.id = v_parent_id;

        IF v_recipient_id IS NULL OR v_recipient_id = NEW.user_id THEN
            RETURN NEW;
        END IF;

        v_source_event_id := 'prompt_comment_reply:' || NEW.id::TEXT;
        v_category := 'comment_replied';
        v_action_label := CASE WHEN v_site = 'intl' THEN 'View reply' ELSE '查看回复' END;
        v_action_url := '/prompts.html?id=' || NEW.prompt_id::TEXT || '&comments=1&commentId=' || NEW.id::TEXT;
        v_priority := 55;
        v_source_module := 'comments';
        v_title := CASE WHEN v_site = 'intl' THEN 'Your comment has a new reply' ELSE '你的评论收到了新回复' END;
        v_content := CASE
            WHEN v_preview <> '' AND v_site = 'intl' THEN
                'New reply' || CASE WHEN v_prompt_title <> '' THEN ' on ' || v_prompt_title ELSE '' END || ': ' || v_preview
            WHEN v_preview <> '' THEN
                CASE
                    WHEN v_prompt_title <> '' THEN '「' || v_prompt_title || '」有新回复：' || v_preview
                    ELSE '你的 Prompt 评论有新回复：' || v_preview
                END
            WHEN v_site = 'intl' THEN
                'Open the Prompt page to view the latest reply.'
            ELSE
                '打开提示词页面查看最新回复。'
        END;
        v_metadata := JSONB_BUILD_OBJECT(
            'page_id', 'prompts',
            'site', v_site,
            'event_type', 'comment_replied',
            'source', 'prompt_comment',
            'comment_id', NEW.id,
            'parent_id', v_parent_id,
            'prompt_id', NEW.prompt_id,
            'prompt_title', NULLIF(v_prompt_title, '')
        );
    ELSIF TG_TABLE_NAME = 'guestbook_comments' THEN
        v_message_id := NEW.message_id;
        IF v_message_id IS NULL THEN
            RETURN NEW;
        END IF;

        IF v_parent_id IS NULL THEN
            v_target_type := 'message';
            SELECT
                message.user_id,
                CASE
                    WHEN COALESCE(NULLIF(BTRIM(NEW.site), ''), NULLIF(BTRIM(message.site), ''), 'cn') = 'intl' THEN 'intl'
                    ELSE 'cn'
                END
            INTO
                v_recipient_id,
                v_site
            FROM public.guestbook_messages message
            WHERE message.id = v_message_id;
        ELSE
            v_target_type := 'comment';
            SELECT
                parent.user_id,
                CASE
                    WHEN COALESCE(NULLIF(BTRIM(NEW.site), ''), NULLIF(BTRIM(parent.site), ''), NULLIF(BTRIM(message.site), ''), 'cn') = 'intl' THEN 'intl'
                    ELSE 'cn'
                END
            INTO
                v_recipient_id,
                v_site
            FROM public.guestbook_comments parent
            LEFT JOIN public.guestbook_messages message
                ON message.id = parent.message_id
            WHERE parent.id = v_parent_id;
        END IF;

        IF v_recipient_id IS NULL OR v_recipient_id = NEW.user_id THEN
            RETURN NEW;
        END IF;

        v_source_event_id := CASE
            WHEN v_target_type = 'message' THEN 'guestbook_message_reply:' || NEW.id::TEXT
            ELSE 'guestbook_comment_reply:' || NEW.id::TEXT
        END;
        v_category := CASE
            WHEN v_target_type = 'message' THEN 'message_replied'
            ELSE 'guestbook_mention'
        END;
        v_action_label := CASE WHEN v_site = 'intl' THEN 'View reply' ELSE '查看回复' END;
        v_action_url := '/guestbook.html?messageId=' || v_message_id::TEXT || '&commentId=' || NEW.id::TEXT;
        v_priority := CASE WHEN v_target_type = 'message' THEN 50 ELSE 55 END;
        v_source_module := 'guestbook';
        v_title := CASE
            WHEN v_target_type = 'message' AND v_site = 'intl' THEN 'Your guestbook post has a new comment'
            WHEN v_target_type = 'message' THEN '你的留言收到了新评论'
            WHEN v_site = 'intl' THEN 'Your guestbook comment has a new reply'
            ELSE '你的评论收到了新回复'
        END;
        v_content := CASE
            WHEN v_preview <> '' AND v_target_type = 'message' AND v_site = 'intl' THEN 'New comment: ' || v_preview
            WHEN v_preview <> '' AND v_target_type = 'message' THEN '新评论：' || v_preview
            WHEN v_preview <> '' AND v_site = 'intl' THEN 'New reply: ' || v_preview
            WHEN v_preview <> '' THEN '新回复：' || v_preview
            WHEN v_target_type = 'message' AND v_site = 'intl' THEN 'Open the guestbook to view the latest comment.'
            WHEN v_target_type = 'message' THEN '打开留言板查看最新评论。'
            WHEN v_site = 'intl' THEN 'Open the guestbook to view the latest reply.'
            ELSE '打开留言板查看最新回复。'
        END;
        v_metadata := JSONB_BUILD_OBJECT(
            'page_id', 'guestbook',
            'site', v_site,
            'event_type', v_category,
            'source', 'guestbook_comment',
            'target_type', v_target_type,
            'comment_id', NEW.id,
            'parent_id', v_parent_id,
            'message_id', v_message_id
        );
    ELSE
        RETURN NEW;
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_source_event_id), hashtext(v_recipient_id::TEXT));

    IF EXISTS (
        SELECT 1
        FROM public.system_notifications notification
        WHERE notification.user_id = v_recipient_id
          AND notification.source_event_id = v_source_event_id
        LIMIT 1
    ) THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.system_notifications (
        user_id,
        title,
        content,
        type,
        scope,
        category,
        is_read,
        action_url,
        action_label,
        metadata,
        priority,
        dedupe_key,
        source_module,
        source_event_id
    )
    VALUES (
        v_recipient_id,
        v_title,
        v_content,
        'info',
        'user_personal',
        v_category,
        false,
        v_action_url,
        v_action_label,
        v_metadata,
        v_priority,
        v_source_event_id,
        v_source_module,
        v_source_event_id
    );

    RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trigger_prompt_comment_reply_notifications ON public.prompt_comments;
CREATE TRIGGER trigger_prompt_comment_reply_notifications
    AFTER INSERT ON public.prompt_comments
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_create_reply_notification();

DROP TRIGGER IF EXISTS trigger_guestbook_comment_reply_notifications ON public.guestbook_comments;
CREATE TRIGGER trigger_guestbook_comment_reply_notifications
    AFTER INSERT ON public.guestbook_comments
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_create_reply_notification();

COMMIT;
