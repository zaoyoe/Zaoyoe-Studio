-- Track the author of the latest message so administrator unread badges do not
-- count a reply that the administrator just sent.

ALTER TABLE public.newapi_support_conversations
    ADD COLUMN IF NOT EXISTS last_message_is_admin boolean;

-- Backfill conversations created before this column existed. The existing
-- index on (product, session_id, created_at, id) keeps this lookup bounded to
-- the newest message for each conversation.
UPDATE public.newapi_support_conversations AS conversation
SET last_message_is_admin = (
    SELECT message.is_admin
    FROM public.chat_messages AS message
    WHERE message.product = 'newapi'
      AND message.session_id = conversation.session_id
    ORDER BY message.created_at DESC NULLS LAST, message.id DESC
    LIMIT 1
)
WHERE conversation.product = 'newapi'
  AND EXISTS (
      SELECT 1
      FROM public.chat_messages AS message
      WHERE message.product = 'newapi'
        AND message.session_id = conversation.session_id
  );

-- Rebuild the trigger so the author flag and activity timestamp are derived
-- from the actual latest row, even if an older message arrives out of order.
CREATE OR REPLACE FUNCTION public.touch_newapi_support_conversation_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.product = 'newapi' AND NEW.session_id IS NOT NULL THEN
        UPDATE public.newapi_support_conversations AS conversation
        SET updated_at = GREATEST(
                COALESCE(conversation.updated_at, '-infinity'::timestamptz),
                COALESCE(NEW.created_at, now())
            ),
            last_message_is_admin = (
                SELECT message.is_admin
                FROM public.chat_messages AS message
                WHERE message.product = 'newapi'
                  AND message.session_id = NEW.session_id
                ORDER BY message.created_at DESC NULLS LAST, message.id DESC
                LIMIT 1
            )
        WHERE conversation.product = 'newapi'
          AND conversation.session_id = NEW.session_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_newapi_support_conversation_on_message
    ON public.chat_messages;

CREATE TRIGGER trg_touch_newapi_support_conversation_on_message
AFTER INSERT ON public.chat_messages
FOR EACH ROW
EXECUTE FUNCTION public.touch_newapi_support_conversation_on_message();
