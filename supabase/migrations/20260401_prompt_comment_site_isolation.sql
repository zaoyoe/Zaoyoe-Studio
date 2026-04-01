BEGIN;

ALTER TABLE public.prompt_comments
    ADD COLUMN IF NOT EXISTS site VARCHAR(10) DEFAULT 'cn' NOT NULL;

ALTER TABLE public.comment_likes
    ADD COLUMN IF NOT EXISTS site VARCHAR(10) DEFAULT 'cn' NOT NULL;

CREATE INDEX IF NOT EXISTS idx_prompt_comments_site_created_at
    ON public.prompt_comments(site, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_comment_likes_site
    ON public.comment_likes(site);

UPDATE public.prompt_comments
SET site = CASE WHEN site = 'intl' THEN 'intl' ELSE 'cn' END
WHERE site IS DISTINCT FROM CASE WHEN site = 'intl' THEN 'intl' ELSE 'cn' END;

CREATE OR REPLACE FUNCTION public.auto_link_reply_comment()
RETURNS TRIGGER AS $$
DECLARE
    mentioned_username TEXT;
    parent_comment_id UUID;
BEGIN
    IF NEW.parent_id IS NULL AND NEW.content LIKE '@%' THEN
        mentioned_username := substring(NEW.content FROM '@([^ ]+)');

        SELECT c.id INTO parent_comment_id
        FROM public.prompt_comments c
        INNER JOIN public.profiles p ON c.user_id = p.id
        WHERE c.prompt_id = NEW.prompt_id
          AND c.site = NEW.site
          AND LOWER(p.username) = LOWER(mentioned_username)
          AND c.created_at < NEW.created_at
          AND c.parent_id IS NULL
          AND c.id != NEW.id
        ORDER BY c.created_at DESC
        LIMIT 1;

        IF parent_comment_id IS NOT NULL THEN
            NEW.parent_id := parent_comment_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_auto_link_replies ON public.prompt_comments;

CREATE TRIGGER trigger_auto_link_replies
    BEFORE INSERT ON public.prompt_comments
    FOR EACH ROW
    EXECUTE FUNCTION public.auto_link_reply_comment();

CREATE OR REPLACE FUNCTION public.sync_comment_like_site()
RETURNS TRIGGER AS $$
DECLARE
    comment_site TEXT;
BEGIN
    SELECT c.site
    INTO comment_site
    FROM public.prompt_comments c
    WHERE c.id = NEW.comment_id;

    IF comment_site IS NULL THEN
        RAISE EXCEPTION 'prompt comment % not found for site sync', NEW.comment_id;
    END IF;

    NEW.site := CASE WHEN comment_site = 'intl' THEN 'intl' ELSE 'cn' END;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sync_comment_like_site ON public.comment_likes;

CREATE TRIGGER trigger_sync_comment_like_site
    BEFORE INSERT OR UPDATE OF comment_id, site ON public.comment_likes
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_comment_like_site();

UPDATE public.comment_likes cl
SET site = CASE WHEN pc.site = 'intl' THEN 'intl' ELSE 'cn' END
FROM public.prompt_comments pc
WHERE pc.id = cl.comment_id
  AND cl.site IS DISTINCT FROM CASE WHEN pc.site = 'intl' THEN 'intl' ELSE 'cn' END;

COMMIT;
