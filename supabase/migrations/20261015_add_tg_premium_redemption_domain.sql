-- Telegram Premium redemption-code domain.
--
-- This is intentionally isolated from redemption_codes / redemption_batches.
-- Those tables credit the existing points wallet and must never be used for
-- Telegram fulfillment. All writes belong behind the tg.* server APIs and
-- workers. RLS plus revoked table grants keep the bearer-code material out of
-- browser clients.

CREATE TABLE IF NOT EXISTS public.tg_redemption_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_no TEXT NOT NULL UNIQUE,
    product_family TEXT NOT NULL DEFAULT 'telegram_premium',
    term_months INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_until TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'draft',
    generated_count INTEGER NOT NULL DEFAULT 0,
    redeemed_count INTEGER NOT NULL DEFAULT 0,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    disabled_at TIMESTAMPTZ,
    disabled_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    disabled_reason TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.tg_redemption_batches
    DROP CONSTRAINT IF EXISTS tg_redemption_batches_product_family_check,
    DROP CONSTRAINT IF EXISTS tg_redemption_batches_term_months_check,
    DROP CONSTRAINT IF EXISTS tg_redemption_batches_quantity_check,
    DROP CONSTRAINT IF EXISTS tg_redemption_batches_validity_check,
    DROP CONSTRAINT IF EXISTS tg_redemption_batches_status_check,
    DROP CONSTRAINT IF EXISTS tg_redemption_batches_counts_check,
    ADD CONSTRAINT tg_redemption_batches_product_family_check
        CHECK (product_family = 'telegram_premium'),
    ADD CONSTRAINT tg_redemption_batches_term_months_check
        CHECK (term_months IN (3, 6, 12)),
    ADD CONSTRAINT tg_redemption_batches_quantity_check
        CHECK (quantity BETWEEN 1 AND 100000),
    ADD CONSTRAINT tg_redemption_batches_validity_check
        CHECK (valid_until IS NULL OR valid_until > valid_from),
    ADD CONSTRAINT tg_redemption_batches_status_check
        CHECK (status IN ('draft', 'active', 'disabled', 'revoked', 'expired', 'exhausted')),
    ADD CONSTRAINT tg_redemption_batches_counts_check
        CHECK (generated_count BETWEEN 0 AND quantity AND redeemed_count BETWEEN 0 AND generated_count);

CREATE INDEX IF NOT EXISTS idx_tg_redemption_batches_status_created
    ON public.tg_redemption_batches(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tg_redemption_batches_term_status
    ON public.tg_redemption_batches(term_months, status);

COMMENT ON TABLE public.tg_redemption_batches IS
    'Telegram Premium redemption-code batches; independent from the points redemption domain.';
COMMENT ON COLUMN public.tg_redemption_batches.term_months IS
    'Telegram Premium entitlement duration. Supported values are 3, 6, and 12 months.';
COMMENT ON COLUMN public.tg_redemption_batches.metadata IS
    'Non-secret operational metadata. Never store provider credentials or plaintext codes.';

CREATE TABLE IF NOT EXISTS public.tg_redemption_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES public.tg_redemption_batches(id) ON DELETE RESTRICT,
    code_digest TEXT NOT NULL UNIQUE,
    code_ciphertext TEXT NOT NULL,
    code_last4 TEXT NOT NULL,
    expires_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'available',
    reserved_at TIMESTAMPTZ,
    reservation_expires_at TIMESTAMPTZ,
    fulfillment_started_at TIMESTAMPTZ,
    fulfilled_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    redeemed_at TIMESTAMPTZ,
    telegram_username TEXT,
    telegram_user_id BIGINT,
    redeemed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    revoked_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    revoke_reason TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.tg_redemption_codes
    DROP CONSTRAINT IF EXISTS tg_redemption_codes_digest_check,
    DROP CONSTRAINT IF EXISTS tg_redemption_codes_ciphertext_check,
    DROP CONSTRAINT IF EXISTS tg_redemption_codes_last4_check,
    DROP CONSTRAINT IF EXISTS tg_redemption_codes_status_check,
    DROP CONSTRAINT IF EXISTS tg_redemption_codes_reservation_check,
    DROP CONSTRAINT IF EXISTS tg_redemption_codes_fulfillment_check,
    DROP CONSTRAINT IF EXISTS tg_redemption_codes_telegram_username_check,
    DROP CONSTRAINT IF EXISTS tg_redemption_codes_expiry_check,
    DROP CONSTRAINT IF EXISTS tg_redemption_codes_revoke_reason_check,
    ADD CONSTRAINT tg_redemption_codes_digest_check
        CHECK (char_length(code_digest) BETWEEN 32 AND 256),
    ADD CONSTRAINT tg_redemption_codes_ciphertext_check
        CHECK (char_length(code_ciphertext) >= 16),
    ADD CONSTRAINT tg_redemption_codes_last4_check
        CHECK (char_length(code_last4) = 4),
    ADD CONSTRAINT tg_redemption_codes_status_check
        CHECK (status IN ('available', 'reserved', 'fulfilling', 'fulfilled', 'failed', 'revoked', 'expired')),
    ADD CONSTRAINT tg_redemption_codes_reservation_check
        CHECK (reservation_expires_at IS NULL OR reserved_at IS NOT NULL),
    ADD CONSTRAINT tg_redemption_codes_fulfillment_check
        CHECK (fulfilled_at IS NULL OR status = 'fulfilled'),
    ADD CONSTRAINT tg_redemption_codes_telegram_username_check
        CHECK (telegram_username IS NULL OR telegram_username ~ '^[A-Za-z0-9_]{5,32}$'),
    ADD CONSTRAINT tg_redemption_codes_expiry_check
        CHECK (expires_at IS NULL OR expires_at > created_at),
    ADD CONSTRAINT tg_redemption_codes_revoke_reason_check
        CHECK (revoke_reason IS NULL OR char_length(revoke_reason) <= 500);

CREATE INDEX IF NOT EXISTS idx_tg_redemption_codes_batch_status
    ON public.tg_redemption_codes(batch_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_tg_redemption_codes_reservation_expiry
    ON public.tg_redemption_codes(status, reservation_expires_at)
    WHERE status IN ('reserved', 'fulfilling');
CREATE INDEX IF NOT EXISTS idx_tg_redemption_codes_expiry
    ON public.tg_redemption_codes(expires_at)
    WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tg_redemption_codes_telegram_user
    ON public.tg_redemption_codes(telegram_user_id)
    WHERE telegram_user_id IS NOT NULL;

COMMENT ON COLUMN public.tg_redemption_codes.code_digest IS
    'Application-keyed digest (for example HMAC-SHA-256), never the plaintext bearer code.';
COMMENT ON COLUMN public.tg_redemption_codes.code_ciphertext IS
    'Application-encrypted code for controlled administrative export; encryption key is outside the database.';
COMMENT ON COLUMN public.tg_redemption_codes.code_last4 IS
    'Non-sensitive display suffix used by the admin UI.';
COMMENT ON COLUMN public.tg_redemption_codes.expires_at IS
    'Snapshot of the batch expiry used by the redemption RPC.';

-- Counts are convenience fields for the admin list. The authoritative count
-- is exposed by this view, so a worker can repair/reconcile denormalized batch
-- values without affecting code validity.
CREATE OR REPLACE VIEW public.tg_redemption_batch_stats AS
SELECT
    b.id AS batch_id,
    b.batch_no,
    b.term_months,
    b.quantity,
    COUNT(c.id)::INTEGER AS generated_count,
    COUNT(c.id) FILTER (WHERE c.status = 'available')::INTEGER AS available_count,
    COUNT(c.id) FILTER (WHERE c.status IN ('reserved', 'fulfilling'))::INTEGER AS in_flight_count,
    COUNT(c.id) FILTER (WHERE c.status = 'fulfilled')::INTEGER AS fulfilled_count,
    COUNT(c.id) FILTER (WHERE c.status IN ('revoked', 'expired'))::INTEGER AS unavailable_count
FROM public.tg_redemption_batches b
LEFT JOIN public.tg_redemption_codes c ON c.batch_id = b.id
GROUP BY b.id, b.batch_no, b.term_months, b.quantity;

COMMENT ON VIEW public.tg_redemption_batch_stats IS
    'Authoritative live code counts for TG admin reporting; no plaintext code material.';

CREATE TABLE IF NOT EXISTS public.tg_redemption_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_no TEXT NOT NULL UNIQUE,
    code_id UUID NOT NULL REFERENCES public.tg_redemption_codes(id) ON DELETE RESTRICT,
    product_family TEXT NOT NULL DEFAULT 'telegram_premium',
    term_months INTEGER NOT NULL,
    telegram_username TEXT NOT NULL,
    telegram_user_id BIGINT,
    status TEXT NOT NULL DEFAULT 'pending',
    provider TEXT NOT NULL DEFAULT 'gramix',
    provider_order_id TEXT,
    status_token_hash CHAR(64) NOT NULL,
    idempotency_key_hash CHAR(64) NOT NULL UNIQUE,
    provider_idempotency_key TEXT NOT NULL UNIQUE,
    source_payment_order_id TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_attempt_at TIMESTAMPTZ,
    last_error_code TEXT,
    last_error_message TEXT,
    provider_request JSONB,
    provider_response JSONB,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ
);

ALTER TABLE public.tg_redemption_orders
    DROP CONSTRAINT IF EXISTS tg_redemption_orders_product_family_check,
    DROP CONSTRAINT IF EXISTS tg_redemption_orders_term_months_check,
    DROP CONSTRAINT IF EXISTS tg_redemption_orders_provider_check,
    DROP CONSTRAINT IF EXISTS tg_redemption_orders_status_check,
    DROP CONSTRAINT IF EXISTS tg_redemption_orders_status_token_hash_check,
    DROP CONSTRAINT IF EXISTS tg_redemption_orders_idempotency_key_hash_check,
    DROP CONSTRAINT IF EXISTS tg_redemption_orders_provider_idempotency_key_check,
    DROP CONSTRAINT IF EXISTS tg_redemption_orders_attempt_count_check,
    DROP CONSTRAINT IF EXISTS tg_redemption_orders_telegram_username_check,
    DROP CONSTRAINT IF EXISTS tg_redemption_orders_completed_check,
    ADD CONSTRAINT tg_redemption_orders_product_family_check
        CHECK (product_family = 'telegram_premium'),
    ADD CONSTRAINT tg_redemption_orders_term_months_check
        CHECK (term_months IN (3, 6, 12)),
    ADD CONSTRAINT tg_redemption_orders_provider_check
        CHECK (provider = 'gramix'),
    ADD CONSTRAINT tg_redemption_orders_status_check
        CHECK (status IN ('pending', 'processing', 'retry_waiting', 'succeeded', 'failed', 'manual_review', 'cancelled')),
    ADD CONSTRAINT tg_redemption_orders_status_token_hash_check
        CHECK (status_token_hash ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT tg_redemption_orders_idempotency_key_hash_check
        CHECK (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT tg_redemption_orders_provider_idempotency_key_check
        CHECK (char_length(provider_idempotency_key) BETWEEN 16 AND 200),
    ADD CONSTRAINT tg_redemption_orders_attempt_count_check
        CHECK (attempt_count >= 0),
    ADD CONSTRAINT tg_redemption_orders_telegram_username_check
        CHECK (telegram_username ~ '^[A-Za-z0-9_]{5,32}$'),
    ADD CONSTRAINT tg_redemption_orders_completed_check
        CHECK (completed_at IS NULL OR status = 'succeeded');

CREATE INDEX IF NOT EXISTS idx_tg_redemption_orders_status_next_attempt
    ON public.tg_redemption_orders(status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_tg_redemption_orders_provider_order
    ON public.tg_redemption_orders(provider, provider_order_id)
    WHERE provider_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_tg_redemption_orders_provider_order
    ON public.tg_redemption_orders(provider, provider_order_id)
    WHERE provider_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tg_redemption_orders_username
    ON public.tg_redemption_orders(telegram_username, created_at DESC);

-- A code can have historical failed attempts, but only one live fulfillment
-- order may reserve it at a time.
CREATE UNIQUE INDEX IF NOT EXISTS ux_tg_redemption_orders_live_code
    ON public.tg_redemption_orders(code_id)
    WHERE status IN ('pending', 'processing', 'retry_waiting', 'manual_review');

COMMENT ON TABLE public.tg_redemption_orders IS
    'Local Telegram entitlement order; success is recorded only after provider confirmation.';
COMMENT ON COLUMN public.tg_redemption_orders.source_payment_order_id IS
    'Optional linkage to an existing payment order. TG fulfillment remains a separate order domain.';
COMMENT ON COLUMN public.tg_redemption_orders.provider_response IS
    'Redacted provider response. Do not persist card data, access tokens, or webhook secrets.';

COMMENT ON COLUMN public.tg_redemption_orders.status_token_hash IS
    'Hash of the high-entropy public status token; the bearer token is never stored.';
COMMENT ON COLUMN public.tg_redemption_orders.idempotency_key_hash IS
    'Hash of the client idempotency key; the original key is never stored.';

CREATE TABLE IF NOT EXISTS public.tg_fulfillment_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.tg_redemption_orders(id) ON DELETE CASCADE,
    attempt_no INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'started',
    request_id TEXT,
    provider_order_id TEXT,
    request_payload JSONB,
    response_payload JSONB,
    response_status INTEGER,
    error_code TEXT,
    error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    duration_ms INTEGER,
    UNIQUE (order_id, attempt_no)
);

ALTER TABLE public.tg_fulfillment_attempts
    DROP CONSTRAINT IF EXISTS tg_fulfillment_attempts_status_check,
    DROP CONSTRAINT IF EXISTS tg_fulfillment_attempts_attempt_no_check,
    DROP CONSTRAINT IF EXISTS tg_fulfillment_attempts_duration_check,
    ADD CONSTRAINT tg_fulfillment_attempts_status_check
        CHECK (status IN ('started', 'submitted', 'succeeded', 'failed', 'unknown')),
    ADD CONSTRAINT tg_fulfillment_attempts_attempt_no_check
        CHECK (attempt_no >= 1),
    ADD CONSTRAINT tg_fulfillment_attempts_duration_check
        CHECK (duration_ms IS NULL OR duration_ms >= 0);

CREATE INDEX IF NOT EXISTS idx_tg_fulfillment_attempts_order
    ON public.tg_fulfillment_attempts(order_id, attempt_no DESC);

CREATE TABLE IF NOT EXISTS public.tg_audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id UUID,
    request_id TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tg_audit_events_target
    ON public.tg_audit_events(target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tg_audit_events_created
    ON public.tg_audit_events(created_at DESC);

COMMENT ON TABLE public.tg_audit_events IS
    'Administrative and fulfillment audit trail for Telegram products; metadata must be redacted.';

-- Keep updated_at server-owned and consistent across the isolated TG domain.
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tg_redemption_batches_touch_updated_at ON public.tg_redemption_batches;
CREATE TRIGGER trg_tg_redemption_batches_touch_updated_at
BEFORE INSERT OR UPDATE ON public.tg_redemption_batches
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS trg_tg_redemption_codes_touch_updated_at ON public.tg_redemption_codes;
CREATE TRIGGER trg_tg_redemption_codes_touch_updated_at
BEFORE INSERT OR UPDATE ON public.tg_redemption_codes
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS trg_tg_redemption_orders_touch_updated_at ON public.tg_redemption_orders;
CREATE TRIGGER trg_tg_redemption_orders_touch_updated_at
BEFORE INSERT OR UPDATE ON public.tg_redemption_orders
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

ALTER TABLE public.tg_redemption_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tg_redemption_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tg_redemption_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tg_fulfillment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tg_audit_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tg_redemption_batches FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.tg_redemption_codes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.tg_redemption_orders FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.tg_fulfillment_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.tg_audit_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.tg_redemption_batch_stats FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tg_redemption_batches TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tg_redemption_codes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tg_redemption_orders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tg_fulfillment_attempts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tg_audit_events TO service_role;
GRANT SELECT ON public.tg_redemption_batch_stats TO service_role;

REVOKE ALL ON FUNCTION public.tg_touch_updated_at() FROM PUBLIC;

-- Code generation is a single server-side transaction. The API supplies only
-- digests and encrypted payloads; plaintext bearer codes never cross SQL.
CREATE OR REPLACE FUNCTION public.fn_tg_generate_batch(
    p_batch_no TEXT,
    p_term_months INTEGER,
    p_quantity INTEGER,
    p_valid_until TIMESTAMPTZ,
    p_created_by UUID,
    p_metadata JSONB,
    p_codes JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_batch public.tg_redemption_batches%ROWTYPE;
    v_batch_no TEXT := trim(coalesce(p_batch_no, ''));
    v_metadata JSONB := coalesce(p_metadata, '{}'::JSONB);
BEGIN
    IF v_batch_no !~ '^[A-Za-z0-9_-]{1,100}$'
       OR p_term_months IS NULL OR p_term_months NOT IN (3, 6, 12)
       OR p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 1000
       OR (p_valid_until IS NOT NULL AND p_valid_until <= now())
       OR coalesce(jsonb_typeof(p_metadata), 'object') <> 'object' THEN
        RAISE EXCEPTION 'invalid TG batch generation request' USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(coalesce(p_codes, 'null'::JSONB)) <> 'array' THEN
        RAISE EXCEPTION 'invalid TG batch code array' USING ERRCODE = '22023';
    END IF;
    IF jsonb_array_length(p_codes) <> p_quantity THEN
        RAISE EXCEPTION 'invalid TG batch code array' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_codes) AS code(item)
        WHERE jsonb_typeof(code.item) <> 'object'
           OR coalesce(code.item->>'code_digest', '') !~ '^[0-9a-f]{64}$'
           OR char_length(coalesce(code.item->>'code_ciphertext', '')) < 16
           OR char_length(coalesce(code.item->>'code_ciphertext', '')) > 4096
           OR coalesce(code.item->>'code_last4', '') !~ '^[A-Z0-9]{4}$'
    ) THEN
        RAISE EXCEPTION 'invalid TG code payload' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_codes) AS code(item)
        GROUP BY code.item->>'code_digest'
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'duplicate TG code digest' USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.tg_redemption_batches (
        batch_no, term_months, quantity, valid_until, status,
        generated_count, redeemed_count, created_by, metadata
    ) VALUES (
        v_batch_no, p_term_months, p_quantity, p_valid_until, 'active',
        p_quantity, 0, p_created_by, v_metadata
    ) RETURNING * INTO v_batch;

    INSERT INTO public.tg_redemption_codes (
        batch_id, code_digest, code_ciphertext, code_last4, expires_at
    )
    SELECT
        v_batch.id,
        code.item->>'code_digest',
        code.item->>'code_ciphertext',
        code.item->>'code_last4',
        p_valid_until
    FROM jsonb_array_elements(p_codes) AS code(item);

    INSERT INTO public.tg_audit_events (actor_user_id, event_type, target_type, target_id, metadata)
    VALUES (
        p_created_by, 'codes_generated', 'redemption_batch', v_batch.id,
        jsonb_build_object('term_months', p_term_months, 'quantity', p_quantity)
    );

    RETURN jsonb_build_object(
        'success', true, 'batch_id', v_batch.id, 'batch_no', v_batch.batch_no,
        'term_months', v_batch.term_months, 'quantity', v_batch.quantity,
        'generated_count', p_quantity
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_tg_revoke_codes(
    p_code_id UUID,
    p_batch_id UUID,
    p_actor UUID,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_count INTEGER := 0;
    v_reason TEXT := left(coalesce(nullif(trim(p_reason), ''), '管理员撤销'), 500);
    v_target_id UUID := coalesce(p_code_id, p_batch_id);
BEGIN
    IF (p_code_id IS NULL) = (p_batch_id IS NULL) THEN
        RAISE EXCEPTION 'exactly one TG revoke target is required' USING ERRCODE = '22023';
    END IF;

    IF p_code_id IS NOT NULL THEN
        UPDATE public.tg_redemption_codes
        SET status = 'revoked', revoked_at = now(), revoked_by = p_actor,
            revoke_reason = v_reason, updated_at = now()
        WHERE id = p_code_id AND status IN ('available', 'failed');
        GET DIAGNOSTICS v_count = ROW_COUNT;
    ELSE
        UPDATE public.tg_redemption_codes
        SET status = 'revoked', revoked_at = now(), revoked_by = p_actor,
            revoke_reason = v_reason, updated_at = now()
        WHERE batch_id = p_batch_id AND status IN ('available', 'failed');
        GET DIAGNOSTICS v_count = ROW_COUNT;
        UPDATE public.tg_redemption_batches b
        SET status = 'disabled', disabled_at = coalesce(disabled_at, now()),
            disabled_by = coalesce(disabled_by, p_actor),
            disabled_reason = v_reason, updated_at = now()
        WHERE b.id = p_batch_id
          AND b.status IN ('draft', 'active');
    END IF;

    INSERT INTO public.tg_audit_events (actor_user_id, event_type, target_type, target_id, metadata)
    VALUES (
        p_actor, 'codes_revoked', CASE WHEN p_code_id IS NULL THEN 'redemption_batch' ELSE 'redemption_code' END,
        v_target_id, jsonb_build_object('count', v_count, 'reason', v_reason)
    );

    RETURN jsonb_build_object('success', true, 'revoked_count', v_count);
END;
$$;

-- Public redemption is performed through the server-role API only. These
-- functions atomically reserve a code and expose only a status-token-gated
-- order view; no browser role receives table access.
CREATE OR REPLACE FUNCTION public.fn_tg_reserve_code(
    p_code_digest TEXT,
    p_username TEXT,
    p_status_token_hash CHAR(64),
    p_idempotency_key_hash CHAR(64)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_code public.tg_redemption_codes%ROWTYPE;
    v_batch public.tg_redemption_batches%ROWTYPE;
    v_order public.tg_redemption_orders%ROWTYPE;
    v_existing_code public.tg_redemption_codes%ROWTYPE;
    v_order_no TEXT;
    v_username TEXT;
    v_code_digest TEXT;
    v_status_token_hash TEXT;
    v_idempotency_key_hash TEXT;
BEGIN
    v_code_digest := lower(trim(coalesce(p_code_digest, '')));
    v_status_token_hash := lower(trim(coalesce(p_status_token_hash, '')));
    v_idempotency_key_hash := lower(trim(coalesce(p_idempotency_key_hash, '')));
    v_username := lower(regexp_replace(trim(coalesce(p_username, '')), '^@', ''));

    IF v_code_digest = ''
       OR v_status_token_hash !~ '^[0-9a-f]{64}$'
       OR v_idempotency_key_hash !~ '^[0-9a-f]{64}$' THEN
        RETURN jsonb_build_object('success', false, 'code', 'invalid_request', 'message', '兑换请求无效');
    END IF;

    IF v_username !~ '^[A-Za-z0-9_]{5,32}$' THEN
        RETURN jsonb_build_object('success', false, 'code', 'invalid_username', 'message', 'Telegram 用户名格式无效');
    END IF;

    SELECT * INTO v_order
    FROM public.tg_redemption_orders
    WHERE idempotency_key_hash = v_idempotency_key_hash
    LIMIT 1;
    IF v_order.id IS NOT NULL THEN
        SELECT * INTO v_existing_code
        FROM public.tg_redemption_codes
        WHERE id = v_order.code_id;
        IF v_existing_code.id IS NULL
           OR v_existing_code.code_digest <> v_code_digest
           OR v_order.telegram_username <> v_username
           OR v_order.status_token_hash <> v_status_token_hash THEN
            RETURN jsonb_build_object('success', false, 'code', 'idempotency_conflict', 'message', '幂等请求与原兑换请求不一致');
        END IF;
        RETURN jsonb_build_object(
            'success', true, 'existing', true, 'order_no', v_order.order_no,
            'status', v_order.status, 'term_months', v_order.term_months
        );
    END IF;

    SELECT * INTO v_code
    FROM public.tg_redemption_codes
    WHERE code_digest = v_code_digest
    FOR UPDATE;
    IF v_code.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'invalid_code', 'message', '兑换码无效');
    END IF;

    -- The first lookup can precede a concurrent request's commit. Acquiring
    -- this code lock waits for that reservation; recheck the committed key
    -- before treating the now-reserved code as unavailable.
    SELECT * INTO v_order
    FROM public.tg_redemption_orders
    WHERE idempotency_key_hash = v_idempotency_key_hash
    LIMIT 1;
    IF v_order.id IS NOT NULL THEN
        IF v_order.code_id <> v_code.id
           OR v_order.telegram_username <> v_username
           OR v_order.status_token_hash <> v_status_token_hash THEN
            RETURN jsonb_build_object('success', false, 'code', 'idempotency_conflict', 'message', '幂等请求与原兑换请求不一致');
        END IF;
        RETURN jsonb_build_object(
            'success', true, 'existing', true, 'order_no', v_order.order_no,
            'status', v_order.status, 'term_months', v_order.term_months
        );
    END IF;

    IF v_code.status = 'expired' THEN
        RETURN jsonb_build_object('success', false, 'code', 'expired', 'message', '兑换码已过期');
    END IF;

    -- A crashed request may leave a code reserved. Only a still-pending
    -- reservation is released automatically; an in-flight provider call must
    -- remain locked until its worker reconciles the result.
    IF v_code.status = 'reserved'
       AND v_code.reservation_expires_at IS NOT NULL
       AND v_code.reservation_expires_at <= now() THEN
        SELECT * INTO v_order FROM public.tg_redemption_orders
        WHERE code_id = v_code.id AND status IN ('pending', 'processing', 'retry_waiting', 'manual_review')
        FOR UPDATE;
        IF v_order.id IS NOT NULL AND v_order.status = 'pending'
           AND v_order.provider_order_id IS NULL AND v_order.attempt_count = 0
           AND NOT EXISTS (SELECT 1 FROM public.tg_fulfillment_attempts WHERE order_id = v_order.id) THEN
            UPDATE public.tg_redemption_orders
            SET status = 'failed', last_error_code = 'reservation_expired',
                last_error_message = '兑换预约已过期', updated_at = now()
            WHERE id = v_order.id;
            UPDATE public.tg_redemption_codes
            SET status = 'available', reserved_at = NULL,
                reservation_expires_at = NULL, telegram_username = NULL,
                updated_at = now()
            WHERE id = v_code.id;
            SELECT * INTO v_code FROM public.tg_redemption_codes WHERE id = v_code.id FOR UPDATE;
        END IF;
    END IF;

    IF v_code.status <> 'available' THEN
        RETURN jsonb_build_object('success', false, 'code', 'code_unavailable', 'message', '兑换码不可用');
    END IF;

    IF v_code.expires_at IS NOT NULL AND v_code.expires_at <= now() THEN
        UPDATE public.tg_redemption_codes
        SET status = 'expired', updated_at = now()
        WHERE id = v_code.id;
        RETURN jsonb_build_object('success', false, 'code', 'expired', 'message', '兑换码已过期');
    END IF;

    SELECT * INTO v_batch FROM public.tg_redemption_batches WHERE id = v_code.batch_id FOR SHARE;
    IF v_batch.id IS NULL OR v_batch.status <> 'active' OR v_batch.valid_from > now()
       OR (v_batch.valid_until IS NOT NULL AND v_batch.valid_until < now()) THEN
        RETURN jsonb_build_object('success', false, 'code', 'batch_unavailable', 'message', '兑换码批次不可用');
    END IF;

    v_order_no := 'TG-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 20));
    INSERT INTO public.tg_redemption_orders (
        order_no, code_id, term_months, telegram_username,
        status_token_hash, idempotency_key_hash, provider_idempotency_key
    ) VALUES (
        v_order_no, v_code.id, v_batch.term_months, v_username,
        v_status_token_hash, v_idempotency_key_hash,
        'tg-' || lower(replace(gen_random_uuid()::text, '-', ''))
    ) RETURNING * INTO v_order;

    UPDATE public.tg_redemption_codes
    SET status = 'reserved', reserved_at = now(),
        reservation_expires_at = now() + interval '30 minutes',
        telegram_username = v_username, updated_at = now()
    WHERE id = v_code.id;

    INSERT INTO public.tg_audit_events (event_type, target_type, target_id, metadata)
    VALUES ('code_reserved', 'redemption_order', v_order.id,
        jsonb_build_object('term_months', v_order.term_months));

    RETURN jsonb_build_object(
        'success', true, 'existing', false, 'order_no', v_order.order_no,
        'status', v_order.status, 'term_months', v_order.term_months
    );
EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_order FROM public.tg_redemption_orders
    WHERE idempotency_key_hash = v_idempotency_key_hash LIMIT 1;
    IF v_order.id IS NOT NULL THEN
        SELECT * INTO v_existing_code FROM public.tg_redemption_codes WHERE id = v_order.code_id;
        IF v_existing_code.id IS NULL OR v_existing_code.code_digest <> v_code_digest
           OR v_order.telegram_username <> v_username
           OR v_order.status_token_hash <> v_status_token_hash THEN
            RETURN jsonb_build_object('success', false, 'code', 'idempotency_conflict', 'message', '幂等请求与原兑换请求不一致');
        END IF;
        RETURN jsonb_build_object('success', true, 'existing', true, 'order_no', v_order.order_no,
            'status', v_order.status, 'term_months', v_order.term_months);
    END IF;
    RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_tg_order_status(
    p_order_no TEXT,
    p_status_token_hash CHAR(64)
)
RETURNS JSONB
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT coalesce(
        (
            SELECT jsonb_build_object(
                'success', true, 'order_no', o.order_no, 'status', o.status,
                'username', o.telegram_username, 'term_months', o.term_months,
                'created_at', o.created_at, 'updated_at', o.updated_at
            )
            FROM public.tg_redemption_orders o
            WHERE o.order_no = trim(p_order_no)
              AND o.status_token_hash = lower(trim(p_status_token_hash))
            LIMIT 1
        ),
        jsonb_build_object('success', false, 'code', 'not_found', 'message', '订单不存在或查询凭证无效')
    );
$$;

REVOKE ALL ON FUNCTION public.fn_tg_generate_batch(TEXT, INTEGER, INTEGER, TIMESTAMPTZ, UUID, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_tg_revoke_codes(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_tg_reserve_code(TEXT, TEXT, CHAR(64), CHAR(64)) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_tg_order_status(TEXT, CHAR(64)) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_generate_batch(TEXT, INTEGER, INTEGER, TIMESTAMPTZ, UUID, JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_tg_revoke_codes(UUID, UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_tg_reserve_code(TEXT, TEXT, CHAR(64), CHAR(64)) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_tg_order_status(TEXT, CHAR(64)) TO service_role;

