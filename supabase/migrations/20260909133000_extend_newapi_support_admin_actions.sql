-- Allow the NewAPI administrator inbox to use the existing HMAC nonce table.
-- The browser never reaches this table; the service-role support gateway owns
-- all reads and writes.

ALTER TABLE public.newapi_support_gateway_nonces
    DROP CONSTRAINT IF EXISTS newapi_support_gateway_nonces_action_check;

ALTER TABLE public.newapi_support_gateway_nonces
    ADD CONSTRAINT newapi_support_gateway_nonces_action_check
    CHECK (
        action IN (
            'context',
            'messages',
            'send_message',
            'admin_conversations',
            'admin_messages',
            'admin_send_message'
        )
    );

-- Fatherkey Admin Studio writes replies directly to chat_messages. Keep the
-- NewAPI-side inbox ordered by the same latest activity regardless of which
-- administrator entry point sent the message. SECURITY DEFINER is required
-- because the conversation table intentionally has no browser-facing update
-- policy; the function only updates the conversation identified by NEW's
-- private session_id and product boundary.
CREATE OR REPLACE FUNCTION public.touch_newapi_support_conversation_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.product = 'newapi' AND NEW.session_id IS NOT NULL THEN
        UPDATE public.newapi_support_conversations
        SET updated_at = GREATEST(
            COALESCE(updated_at, '-infinity'::timestamptz),
            COALESCE(NEW.created_at, now())
        )
        WHERE product = 'newapi'
          AND session_id = NEW.session_id;
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
