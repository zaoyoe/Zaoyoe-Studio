-- NewAPI support messages share the existing administrator inbox without
-- exposing a NewAPI identity as a legacy Supabase user or browser session.

ALTER TABLE public.chat_messages
    ADD COLUMN IF NOT EXISTS product text NOT NULL DEFAULT 'legacy',
    ADD COLUMN IF NOT EXISTS source text,
    ADD COLUMN IF NOT EXISTS external_user_id text,
    ADD COLUMN IF NOT EXISTS external_username text,
    ADD COLUMN IF NOT EXISTS external_email text,
    ADD COLUMN IF NOT EXISTS client_message_id text,
    ADD COLUMN IF NOT EXISTS page_context jsonb;

ALTER TABLE public.chat_messages
    DROP CONSTRAINT IF EXISTS chat_messages_product_check;

ALTER TABLE public.chat_messages
    ADD CONSTRAINT chat_messages_product_check
    CHECK (product IN ('legacy', 'newapi'));

-- Browser clients use the existing legacy chat policy. They must never be
-- able to assign themselves to the NewAPI tenant; NewAPI inserts are made
-- only by the HMAC-authenticated gateway with the service-role client.
DROP POLICY IF EXISTS "Users can read their own chat messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Users can insert their own chat messages" ON public.chat_messages;

CREATE POLICY "Users can read their own chat messages"
ON public.chat_messages FOR SELECT
USING (
    public.is_chat_admin()
    OR (
        COALESCE(product, 'legacy') = 'legacy'
        AND (
            (user_id IS NOT NULL AND auth.uid() = user_id)
            OR (
                auth.uid() IS NOT NULL
                AND session_id = public.authenticated_chat_session_id()
            )
            OR (
                COALESCE(auth.jwt() ->> 'email', '') <> ''
                AND lower(COALESCE(session_id, '')) = lower(auth.jwt() ->> 'email')
            )
            OR (
                auth.uid() IS NULL
                AND public.current_chat_session_id() IS NOT NULL
                AND session_id = public.current_chat_session_id()
            )
        )
    )
);

CREATE POLICY "Users can insert their own chat messages"
ON public.chat_messages FOR INSERT
WITH CHECK (
    (
        public.is_chat_admin()
        AND is_admin = TRUE
    )
    OR (
        COALESCE(product, 'legacy') = 'legacy'
        AND is_admin = FALSE
        AND auth.uid() IS NOT NULL
        AND user_id = auth.uid()
        AND session_id = public.authenticated_chat_session_id()
    )
    OR (
        COALESCE(product, 'legacy') = 'legacy'
        AND is_admin = FALSE
        AND auth.uid() IS NULL
        AND user_id IS NULL
        AND public.current_chat_session_id() IS NOT NULL
        AND session_id = public.current_chat_session_id()
    )
);

DROP INDEX IF EXISTS public.chat_messages_newapi_client_message_id_key;

CREATE UNIQUE INDEX chat_messages_newapi_client_message_id_key
    ON public.chat_messages (product, session_id, client_message_id)
    WHERE client_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS chat_messages_newapi_conversation_idx
    ON public.chat_messages (product, session_id, created_at, id);

CREATE INDEX IF NOT EXISTS chat_messages_newapi_external_user_idx
    ON public.chat_messages (product, external_user_id, created_at, id)
    WHERE external_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.newapi_support_conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product text NOT NULL DEFAULT 'newapi' CHECK (product = 'newapi'),
    external_user_id text NOT NULL,
    external_username text NOT NULL DEFAULT '',
    external_email text,
    -- This is deliberately random and never returned to a browser. The legacy
    -- chat RLS permits a caller-supplied session header, so a predictable ID
    -- derived from the NewAPI user ID would be unsafe here.
    session_id text NOT NULL DEFAULT ('newapi:' || gen_random_uuid()::text),
    page_context jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (product, external_user_id),
    UNIQUE (session_id)
);

CREATE INDEX IF NOT EXISTS newapi_support_conversations_external_user_idx
    ON public.newapi_support_conversations (product, external_user_id);

CREATE TABLE IF NOT EXISTS public.newapi_support_gateway_nonces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    nonce_hash char(64) NOT NULL UNIQUE,
    product text NOT NULL CHECK (product = 'newapi'),
    principal_external_user_id text NOT NULL,
    action text NOT NULL CHECK (action IN ('context', 'messages', 'send_message')),
    request_body_sha256 char(64) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS newapi_support_gateway_nonces_created_at_idx
    ON public.newapi_support_gateway_nonces (created_at);

ALTER TABLE public.newapi_support_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newapi_support_gateway_nonces ENABLE ROW LEVEL SECURITY;

-- Service-role requests made by the gateway bypass RLS. There are deliberately
-- no browser-facing policies for either NewAPI support table.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_messages'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages';
  END IF;
END;
$$;
