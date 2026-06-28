-- Per-user encrypted Sub2API keys for the AI image/text workbench.
-- Plaintext keys are accepted only by the authenticated backend request that
-- saves or rotates the key. Public frontend config receives status metadata
-- only: configured flag, key tail, fingerprint, base URL, and updated time.

CREATE TABLE IF NOT EXISTS public.ai_image_user_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site TEXT NOT NULL DEFAULT 'cn'
        CHECK (site IN ('cn', 'intl')),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    api_base_url TEXT NOT NULL DEFAULT '',
    api_key_tail TEXT NOT NULL DEFAULT '',
    api_key_fingerprint TEXT NOT NULL DEFAULT '',
    encrypted_api_key JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ai_image_user_api_keys_unique UNIQUE (user_id, site, api_base_url),
    CONSTRAINT ai_image_user_api_keys_fingerprint_format
        CHECK (api_key_fingerprint = '' OR api_key_fingerprint ~ '^sha256:[a-f0-9]{24}$')
);

CREATE INDEX IF NOT EXISTS idx_ai_image_user_api_keys_user_site_updated
    ON public.ai_image_user_api_keys (user_id, site, updated_at DESC);

DROP TRIGGER IF EXISTS trg_ai_image_user_api_keys_touch_updated_at
    ON public.ai_image_user_api_keys;
CREATE TRIGGER trg_ai_image_user_api_keys_touch_updated_at
BEFORE INSERT OR UPDATE ON public.ai_image_user_api_keys
FOR EACH ROW
EXECUTE FUNCTION public.fn_touch_ai_image_updated_at();

ALTER TABLE public.ai_image_user_api_keys ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ai_image_user_api_keys FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
    ON TABLE public.ai_image_user_api_keys
    TO service_role;

DROP POLICY IF EXISTS "Service role manages ai image user api keys" ON public.ai_image_user_api_keys;
CREATE POLICY "Service role manages ai image user api keys"
    ON public.ai_image_user_api_keys
    FOR ALL TO service_role
    USING (TRUE)
    WITH CHECK (TRUE);
