-- Sixth TG migration: apply after all original four files and the currency guard.
-- Adds Stars redemption without enabling fulfillment or making a provider request.
-- Never rerun the original worker SQL after this upgrade.
BEGIN;

ALTER TABLE public.tg_redemption_batches
    ADD COLUMN IF NOT EXISTS stars_quantity INTEGER,
    ALTER COLUMN term_months DROP NOT NULL,
    DROP CONSTRAINT IF EXISTS tg_redemption_batches_product_family_check,
    DROP CONSTRAINT IF EXISTS tg_redemption_batches_term_months_check,
    DROP CONSTRAINT IF EXISTS tg_redemption_batches_entitlement_check,
    ADD CONSTRAINT tg_redemption_batches_product_family_check
        CHECK (product_family IN ('telegram_premium', 'telegram_stars')),
    ADD CONSTRAINT tg_redemption_batches_entitlement_check CHECK (
        (product_family = 'telegram_premium' AND term_months IS NOT NULL
            AND term_months IN (3, 6, 12) AND stars_quantity IS NULL)
        OR (product_family = 'telegram_stars' AND term_months IS NULL
            AND stars_quantity IS NOT NULL AND stars_quantity BETWEEN 50 AND 1000000)
    );

ALTER TABLE public.tg_redemption_orders
    ADD COLUMN IF NOT EXISTS stars_quantity INTEGER,
    ALTER COLUMN term_months DROP NOT NULL,
    DROP CONSTRAINT IF EXISTS tg_redemption_orders_product_family_check,
    DROP CONSTRAINT IF EXISTS tg_redemption_orders_term_months_check,
    DROP CONSTRAINT IF EXISTS tg_redemption_orders_entitlement_check,
    ADD CONSTRAINT tg_redemption_orders_product_family_check
        CHECK (product_family IN ('telegram_premium', 'telegram_stars')),
    ADD CONSTRAINT tg_redemption_orders_entitlement_check CHECK (
        (product_family = 'telegram_premium' AND term_months IS NOT NULL
            AND term_months IN (3, 6, 12) AND stars_quantity IS NULL)
        OR (product_family = 'telegram_stars' AND term_months IS NULL
            AND stars_quantity IS NOT NULL AND stars_quantity BETWEEN 50 AND 1000000)
    );

COMMENT ON COLUMN public.tg_redemption_batches.quantity IS
    'Number of bearer redemption codes in the batch; never the Stars entitlement quantity.';
COMMENT ON COLUMN public.tg_redemption_batches.stars_quantity IS
    'Exact Stars entitlement per code, 50..1000000; NULL for Premium.';
COMMENT ON COLUMN public.tg_redemption_orders.stars_quantity IS
    'Immutable Stars entitlement copied from the code batch; NULL for Premium.';

-- An exported code or queued order cannot be silently repurposed across products.
CREATE OR REPLACE FUNCTION public.tg_guard_entitlement_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_batch public.tg_redemption_batches%ROWTYPE;
BEGIN
    IF TG_TABLE_NAME = 'tg_redemption_batches' THEN
        IF NEW.product_family IS DISTINCT FROM OLD.product_family
           OR NEW.term_months IS DISTINCT FROM OLD.term_months
           OR NEW.stars_quantity IS DISTINCT FROM OLD.stars_quantity THEN
            RAISE EXCEPTION 'TG batch entitlement is immutable' USING ERRCODE = '23514';
        END IF;
    ELSIF TG_TABLE_NAME = 'tg_redemption_codes' THEN
        IF NEW.batch_id IS DISTINCT FROM OLD.batch_id THEN
            RAISE EXCEPTION 'TG code batch is immutable' USING ERRCODE = '23514';
        END IF;
    ELSE
        IF TG_OP = 'UPDATE' AND (
            NEW.code_id IS DISTINCT FROM OLD.code_id
            OR NEW.product_family IS DISTINCT FROM OLD.product_family
            OR NEW.term_months IS DISTINCT FROM OLD.term_months
            OR NEW.stars_quantity IS DISTINCT FROM OLD.stars_quantity
        ) THEN
            RAISE EXCEPTION 'TG order entitlement is immutable' USING ERRCODE = '23514';
        END IF;
        SELECT b.* INTO v_batch FROM public.tg_redemption_batches b
        JOIN public.tg_redemption_codes c ON c.batch_id = b.id
        WHERE c.id = NEW.code_id;
        IF v_batch.id IS NULL OR NEW.product_family IS DISTINCT FROM v_batch.product_family
           OR NEW.term_months IS DISTINCT FROM v_batch.term_months
           OR NEW.stars_quantity IS DISTINCT FROM v_batch.stars_quantity THEN
            RAISE EXCEPTION 'TG order entitlement does not match its code batch' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tg_batch_entitlement_identity ON public.tg_redemption_batches;
CREATE TRIGGER trg_tg_batch_entitlement_identity
BEFORE UPDATE OF product_family, term_months, stars_quantity ON public.tg_redemption_batches
FOR EACH ROW EXECUTE FUNCTION public.tg_guard_entitlement_identity();
DROP TRIGGER IF EXISTS trg_tg_code_batch_identity ON public.tg_redemption_codes;
CREATE TRIGGER trg_tg_code_batch_identity
BEFORE UPDATE OF batch_id ON public.tg_redemption_codes
FOR EACH ROW EXECUTE FUNCTION public.tg_guard_entitlement_identity();
DROP TRIGGER IF EXISTS trg_tg_order_entitlement_identity ON public.tg_redemption_orders;
CREATE TRIGGER trg_tg_order_entitlement_identity
BEFORE INSERT OR UPDATE OF code_id, product_family, term_months, stars_quantity ON public.tg_redemption_orders
FOR EACH ROW EXECUTE FUNCTION public.tg_guard_entitlement_identity();
REVOKE ALL ON FUNCTION public.tg_guard_entitlement_identity() FROM PUBLIC, anon, authenticated;

-- Existing report columns stay in their original positions; append product columns.
CREATE OR REPLACE VIEW public.tg_redemption_batch_stats AS
SELECT b.id AS batch_id, b.batch_no, b.term_months, b.quantity,
    COUNT(c.id)::INTEGER AS generated_count,
    COUNT(c.id) FILTER (WHERE c.status = 'available')::INTEGER AS available_count,
    COUNT(c.id) FILTER (WHERE c.status IN ('reserved', 'fulfilling'))::INTEGER AS in_flight_count,
    COUNT(c.id) FILTER (WHERE c.status = 'fulfilled')::INTEGER AS fulfilled_count,
    COUNT(c.id) FILTER (WHERE c.status IN ('revoked', 'expired'))::INTEGER AS unavailable_count,
    b.product_family, b.stars_quantity
FROM public.tg_redemption_batches b
LEFT JOIN public.tg_redemption_codes c ON c.batch_id = b.id
GROUP BY b.id, b.batch_no, b.term_months, b.quantity, b.product_family, b.stars_quantity;
REVOKE ALL ON public.tg_redemption_batch_stats FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tg_redemption_batch_stats TO service_role;


CREATE OR REPLACE FUNCTION public.fn_tg_generate_stars_batch(
    p_batch_no TEXT,
    p_stars_quantity INTEGER,
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
       OR p_stars_quantity IS NULL OR p_stars_quantity NOT BETWEEN 50 AND 1000000
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
        batch_no, product_family, term_months, stars_quantity, quantity, valid_until, status,
        generated_count, redeemed_count, created_by, metadata
    ) VALUES (
        v_batch_no, 'telegram_stars', NULL, p_stars_quantity, p_quantity, p_valid_until, 'active',
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
        jsonb_build_object('product_family', 'telegram_stars', 'stars_quantity', p_stars_quantity, 'quantity', p_quantity)
    );

    RETURN jsonb_build_object(
        'success', true, 'batch_id', v_batch.id, 'batch_no', v_batch.batch_no,
        'product_family', v_batch.product_family, 'term_months', NULL,
        'stars_quantity', v_batch.stars_quantity, 'quantity', v_batch.quantity,
        'generated_count', p_quantity
    );
END;
$$;

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
           OR NOT EXISTS (SELECT 1 FROM public.tg_redemption_codes ec
               JOIN public.tg_redemption_batches eb ON eb.id = ec.batch_id
               WHERE ec.id = v_order.code_id AND eb.product_family = v_order.product_family
                 AND eb.term_months IS NOT DISTINCT FROM v_order.term_months
                 AND eb.stars_quantity IS NOT DISTINCT FROM v_order.stars_quantity)
           OR v_order.telegram_username <> v_username
           OR v_order.status_token_hash <> v_status_token_hash THEN
            RETURN jsonb_build_object('success', false, 'code', 'idempotency_conflict', 'message', '幂等请求与原兑换请求不一致');
        END IF;
        RETURN jsonb_build_object(
            'success', true, 'existing', true, 'order_no', v_order.order_no,
            'status', v_order.status, 'product_family', v_order.product_family,
            'term_months', v_order.term_months, 'stars_quantity', v_order.stars_quantity
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
           OR NOT EXISTS (SELECT 1 FROM public.tg_redemption_codes ec
               JOIN public.tg_redemption_batches eb ON eb.id = ec.batch_id
               WHERE ec.id = v_order.code_id AND eb.product_family = v_order.product_family
                 AND eb.term_months IS NOT DISTINCT FROM v_order.term_months
                 AND eb.stars_quantity IS NOT DISTINCT FROM v_order.stars_quantity)
           OR v_order.telegram_username <> v_username
           OR v_order.status_token_hash <> v_status_token_hash THEN
            RETURN jsonb_build_object('success', false, 'code', 'idempotency_conflict', 'message', '幂等请求与原兑换请求不一致');
        END IF;
        RETURN jsonb_build_object(
            'success', true, 'existing', true, 'order_no', v_order.order_no,
            'status', v_order.status, 'product_family', v_order.product_family,
            'term_months', v_order.term_months, 'stars_quantity', v_order.stars_quantity
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
        order_no, code_id, product_family, term_months, stars_quantity, telegram_username,
        status_token_hash, idempotency_key_hash, provider_idempotency_key
    ) VALUES (
        v_order_no, v_code.id, v_batch.product_family, v_batch.term_months, v_batch.stars_quantity, v_username,
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
        jsonb_build_object('product_family', v_order.product_family,
            'term_months', v_order.term_months, 'stars_quantity', v_order.stars_quantity));

    RETURN jsonb_build_object(
        'success', true, 'existing', false, 'order_no', v_order.order_no,
        'status', v_order.status, 'product_family', v_order.product_family,
            'term_months', v_order.term_months, 'stars_quantity', v_order.stars_quantity
    );
EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_order FROM public.tg_redemption_orders
    WHERE idempotency_key_hash = v_idempotency_key_hash LIMIT 1;
    IF v_order.id IS NOT NULL THEN
        SELECT * INTO v_existing_code FROM public.tg_redemption_codes WHERE id = v_order.code_id;
        IF v_existing_code.id IS NULL OR v_existing_code.code_digest <> v_code_digest
           OR NOT EXISTS (SELECT 1 FROM public.tg_redemption_codes ec
               JOIN public.tg_redemption_batches eb ON eb.id = ec.batch_id
               WHERE ec.id = v_order.code_id AND eb.product_family = v_order.product_family
                 AND eb.term_months IS NOT DISTINCT FROM v_order.term_months
                 AND eb.stars_quantity IS NOT DISTINCT FROM v_order.stars_quantity)
           OR v_order.telegram_username <> v_username
           OR v_order.status_token_hash <> v_status_token_hash THEN
            RETURN jsonb_build_object('success', false, 'code', 'idempotency_conflict', 'message', '幂等请求与原兑换请求不一致');
        END IF;
        RETURN jsonb_build_object('success', true, 'existing', true, 'order_no', v_order.order_no,
            'status', v_order.status, 'product_family', v_order.product_family,
            'term_months', v_order.term_months, 'stars_quantity', v_order.stars_quantity);
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
                'username', o.telegram_username, 'product_family', o.product_family,
                'term_months', o.term_months, 'stars_quantity', o.stars_quantity,
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

CREATE OR REPLACE FUNCTION public.fn_tg_claim_order(
    p_order_id UUID,
    p_lease_token UUID,
    p_lease_seconds INTEGER,
    p_product_families TEXT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_code public.tg_redemption_codes%ROWTYPE;
    v_order public.tg_redemption_orders%ROWTYPE;
    v_action TEXT;
    v_manual_reason TEXT;
BEGIN
    IF p_product_families IS NULL OR cardinality(p_product_families) = 0
       OR array_position(p_product_families, NULL) IS NOT NULL
       OR NOT p_product_families <@ ARRAY['telegram_premium', 'telegram_stars']::TEXT[] THEN
        RAISE EXCEPTION 'invalid TG worker product capability' USING ERRCODE = '22023';
    END IF;
    IF p_lease_token IS NULL OR p_lease_seconds IS NULL
       OR p_lease_seconds < 30 OR p_lease_seconds > 600 THEN
        RAISE EXCEPTION 'invalid TG worker lease' USING ERRCODE = '22023';
    END IF;

    -- Always lock code before order, matching public reservation and avoiding
    -- a lock inversion with reservation-expiry reconciliation.
    SELECT c.* INTO v_code
    FROM public.tg_redemption_codes c
    JOIN public.tg_redemption_orders o ON o.code_id = c.id
    WHERE (p_order_id IS NULL OR o.id = p_order_id)
      AND o.product_family = ANY(p_product_families)
      AND o.status IN ('pending', 'processing', 'retry_waiting')
      AND o.next_attempt_at <= now()
      AND (o.lease_token IS NULL OR o.lease_expires_at <= now())
      AND c.status IN ('reserved', 'fulfilling')
    ORDER BY o.next_attempt_at, o.created_at, o.id
    LIMIT 1
    FOR UPDATE OF c SKIP LOCKED;

    IF v_code.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'no_order');
    END IF;

    SELECT * INTO v_order
    FROM public.tg_redemption_orders o
    WHERE o.code_id = v_code.id
      AND (p_order_id IS NULL OR o.id = p_order_id)
      AND o.product_family = ANY(p_product_families)
      AND o.status IN ('pending', 'processing', 'retry_waiting')
      AND o.next_attempt_at <= now()
      AND (o.lease_token IS NULL OR o.lease_expires_at <= now())
    ORDER BY o.created_at, o.id
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_order.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'no_order');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.tg_redemption_batches b
        WHERE b.id = v_code.batch_id AND b.product_family = v_order.product_family
          AND b.term_months IS NOT DISTINCT FROM v_order.term_months
          AND b.stars_quantity IS NOT DISTINCT FROM v_order.stars_quantity) THEN
        RAISE EXCEPTION 'TG claim entitlement does not match its code batch' USING ERRCODE = '23514';
    END IF;

    IF v_order.status = 'pending' AND v_order.provider_order_id IS NULL
       AND v_order.submitted_at IS NULL AND v_order.provider_payment_currency IS NULL
       AND v_order.attempt_count = 0
       AND v_code.status = 'reserved'
       AND NOT EXISTS (
           SELECT 1 FROM public.tg_fulfillment_attempts a WHERE a.order_id = v_order.id
       ) THEN
        v_action := 'buy';
    ELSIF v_order.provider_order_id IS NOT NULL
          AND v_order.provider_payment_currency IN ('gram', 'usdt') THEN
        v_action := 'poll';
    ELSE
        -- Never infer a historical payment currency from today's environment
        -- or from an order GET denomination. Legacy unbound submissions need review.
        v_manual_reason := CASE
            WHEN v_order.provider_payment_currency IS NULL
                 AND (v_order.provider_order_id IS NOT NULL OR v_order.submitted_at IS NOT NULL)
            THEN 'provider_payment_currency_unconfirmed'
            ELSE 'provider_result_unknown' END;
        -- A worker may have died before receiving the create response. Even
        -- an absent submitted marker is not permission to buy after a claim.
        UPDATE public.tg_redemption_orders
        SET status = 'manual_review', lease_token = NULL, lease_expires_at = NULL,
            last_error_code = v_manual_reason,
            last_error_message = '上游结果待核实，已停止自动重试', updated_at = now()
        WHERE id = v_order.id;
        UPDATE public.tg_redemption_codes
        SET status = 'fulfilling', fulfillment_started_at = coalesce(fulfillment_started_at, now()),
            reservation_expires_at = NULL, updated_at = now()
        WHERE id = v_code.id;
        UPDATE public.tg_fulfillment_attempts
        SET status = 'unknown', error_code = 'worker_lease_expired', finished_at = now()
        WHERE order_id = v_order.id AND status IN ('started', 'submitted') AND finished_at IS NULL;
        INSERT INTO public.tg_audit_events (event_type, target_type, target_id, metadata)
        VALUES ('fulfillment_manual_review', 'redemption_order', v_order.id,
            jsonb_build_object('reason', CASE
                WHEN v_manual_reason = 'provider_payment_currency_unconfirmed'
                THEN 'missing_historical_payment_currency'
                ELSE 'expired_lease_without_provider_order' END));
        RETURN jsonb_build_object('success', false, 'code', 'manual_review', 'status', 'manual_review');
    END IF;

    UPDATE public.tg_fulfillment_attempts
    SET status = 'unknown', error_code = 'worker_lease_expired', finished_at = now()
    WHERE order_id = v_order.id AND status IN ('started', 'submitted') AND finished_at IS NULL;

    UPDATE public.tg_redemption_orders
    SET status = 'processing', lease_token = p_lease_token,
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        attempt_count = attempt_count + 1, last_attempt_at = now(), updated_at = now()
    WHERE id = v_order.id
    RETURNING * INTO v_order;

    UPDATE public.tg_redemption_codes
    SET status = 'fulfilling', fulfillment_started_at = coalesce(fulfillment_started_at, now()),
        reservation_expires_at = NULL, updated_at = now()
    WHERE id = v_code.id;

    INSERT INTO public.tg_fulfillment_attempts (
        order_id, attempt_no, status, provider_order_id, request_payload
    ) VALUES (
        v_order.id, v_order.attempt_count, 'started', v_order.provider_order_id,
        jsonb_build_object('action', v_action, 'product_family', v_order.product_family,
            'term_months', v_order.term_months, 'stars_quantity', v_order.stars_quantity,
            'payment_currency', v_order.provider_payment_currency)
    );
    INSERT INTO public.tg_audit_events (event_type, target_type, target_id, metadata)
    VALUES ('fulfillment_claimed', 'redemption_order', v_order.id,
        jsonb_build_object('action', v_action, 'attempt_no', v_order.attempt_count,
            'payment_currency', v_order.provider_payment_currency));

    RETURN jsonb_build_object(
        'success', true, 'action', v_action,
        'order', jsonb_build_object(
            'id', v_order.id, 'order_no', v_order.order_no, 'status', v_order.status,
            'telegram_username', v_order.telegram_username, 'product_family', v_order.product_family,
            'term_months', v_order.term_months, 'stars_quantity', v_order.stars_quantity,
            'provider_order_id', v_order.provider_order_id,
            'provider_payment_currency', v_order.provider_payment_currency,
            'provider_idempotency_key', v_order.provider_idempotency_key,
            'attempt_count', v_order.attempt_count, 'submitted_at', v_order.submitted_at,
            'lease_token', v_order.lease_token, 'lease_expires_at', v_order.lease_expires_at
        )
    );
END;
$$;

-- Old workers cannot claim Stars; new workers must declare supported products.
CREATE OR REPLACE FUNCTION public.fn_tg_claim_order(
    p_order_id UUID DEFAULT NULL,
    p_lease_token UUID DEFAULT NULL,
    p_lease_seconds INTEGER DEFAULT 120
)
RETURNS JSONB
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT public.fn_tg_claim_order(p_order_id, p_lease_token, p_lease_seconds,
        ARRAY['telegram_premium']::TEXT[]);
$$;

CREATE OR REPLACE FUNCTION public.fn_tg_mark_submitted(
    p_order_id UUID,
    p_lease_token UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN jsonb_build_object('success', false, 'code', 'payment_currency_required');
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_tg_mark_submitted(
    p_order_id UUID,
    p_lease_token UUID,
    p_payment_currency TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_submitted_at TIMESTAMPTZ;
    v_attempt_no INTEGER;
    v_payment_currency TEXT;
BEGIN
    IF p_payment_currency IS NULL OR p_payment_currency NOT IN ('gram', 'usdt') THEN
        RETURN jsonb_build_object('success', false, 'code', 'payment_currency_invalid');
    END IF;
    -- This is deliberately not idempotent: the same worker may not use a
    -- successful old write-ahead marker to authorize a second create call.
    UPDATE public.tg_redemption_orders o
    SET submitted_at = now(), provider_payment_currency = p_payment_currency, updated_at = now()
    WHERE o.id = p_order_id AND o.lease_token = p_lease_token
      AND o.lease_expires_at > now() AND o.status = 'processing'
      AND o.submitted_at IS NULL AND o.provider_order_id IS NULL
      AND o.provider_payment_currency IS NULL
      AND o.attempt_count = 1
    RETURNING o.submitted_at, o.attempt_count, o.provider_payment_currency
    INTO v_submitted_at, v_attempt_no, v_payment_currency;

    IF v_submitted_at IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'submission_not_authorized');
    END IF;
    UPDATE public.tg_fulfillment_attempts
    SET status = 'submitted',
        request_payload = coalesce(request_payload, '{}'::JSONB)
            || jsonb_build_object('payment_currency', v_payment_currency)
    WHERE order_id = p_order_id AND attempt_no = v_attempt_no AND status = 'started';
    INSERT INTO public.tg_audit_events (event_type, target_type, target_id, metadata)
    VALUES ('provider_submission_marked', 'redemption_order', p_order_id,
        jsonb_build_object('payment_currency', v_payment_currency));
    RETURN jsonb_build_object('success', true, 'submitted_at', v_submitted_at,
        'payment_currency', v_payment_currency);
END;
$$;



CREATE OR REPLACE FUNCTION public.fn_tg_finish_order(
    p_order_id UUID,
    p_lease_token UUID,
    p_state TEXT,
    p_provider_order_id TEXT DEFAULT NULL,
    p_provider_snapshot JSONB DEFAULT '{}'::JSONB,
    p_error_code TEXT DEFAULT NULL,
    p_error_message TEXT DEFAULT NULL,
    p_next_attempt_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_code public.tg_redemption_codes%ROWTYPE;
    v_order public.tg_redemption_orders%ROWTYPE;
    v_code_id UUID;
    v_state TEXT := p_state;
    v_provider_id TEXT := nullif(trim(p_provider_order_id), '');
    v_error_code TEXT := left(p_error_code, 100);
    v_error_message TEXT := left(p_error_message, 500);
    v_snapshot JSONB;
    v_complete BOOLEAN;
BEGIN
    IF p_order_id IS NULL OR p_lease_token IS NULL
       OR p_state IS NULL OR p_state NOT IN ('processing', 'retry_waiting', 'succeeded', 'failed', 'manual_review')
       OR coalesce(jsonb_typeof(p_provider_snapshot), '') <> 'object'
       OR (v_provider_id IS NOT NULL AND char_length(v_provider_id) > 200) THEN
        RAISE EXCEPTION 'invalid TG worker result' USING ERRCODE = '22023';
    END IF;

    SELECT code_id INTO v_code_id FROM public.tg_redemption_orders WHERE id = p_order_id;
    IF v_code_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'not_found');
    END IF;
    SELECT * INTO v_code FROM public.tg_redemption_codes WHERE id = v_code_id FOR UPDATE;
    SELECT * INTO v_order FROM public.tg_redemption_orders WHERE id = p_order_id FOR UPDATE;
    IF v_order.lease_token IS DISTINCT FROM p_lease_token OR v_order.status <> 'processing' THEN
        RETURN jsonb_build_object('success', false, 'code', 'lease_lost');
    END IF;

    -- Strip all unknown fields, even if a caller accidentally passes a raw
    -- provider response. Provider credentials and full request bodies stay out.
    SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::JSONB) INTO v_snapshot
    FROM jsonb_each(p_provider_snapshot) e
    WHERE e.key IN (
        'provider_order_id', 'provider_status', 'completed', 'telegram_username',
        'term_months', 'product_family', 'stars_quantity', 'product_type', 'idempotency_key_matches', 'method',
        'verified_by', 'amount', 'currency'
    );

    IF v_provider_id IS NULL THEN
        v_provider_id := v_order.provider_order_id;
    END IF;
    IF (v_order.provider_order_id IS NOT NULL AND v_provider_id IS DISTINCT FROM v_order.provider_order_id)
       OR (v_provider_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM public.tg_redemption_orders other
           WHERE other.provider = v_order.provider AND other.provider_order_id = v_provider_id
             AND other.id <> v_order.id
       )) THEN
        v_state := 'manual_review';
        v_provider_id := v_order.provider_order_id;
        v_error_code := 'provider_order_conflict';
        v_error_message := '上游订单归属待核实，已停止自动操作';
    END IF;

    IF v_state IN ('processing', 'retry_waiting') AND v_provider_id IS NULL THEN
        v_state := 'manual_review';
        v_error_code := 'provider_result_unknown';
        v_error_message := '上游结果待核实，已停止自动重试';
    END IF;

    IF v_order.provider_payment_currency IS NULL
       AND (v_order.submitted_at IS NOT NULL OR v_provider_id IS NOT NULL OR v_state = 'succeeded') THEN
        v_state := 'manual_review';
        v_error_code := 'provider_payment_currency_unconfirmed';
        v_error_message := '历史订单扣款币种未确认，等待人工核查';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.tg_redemption_batches b
        WHERE b.id = v_code.batch_id AND b.product_family = v_order.product_family
          AND b.term_months IS NOT DISTINCT FROM v_order.term_months
          AND b.stars_quantity IS NOT DISTINCT FROM v_order.stars_quantity) THEN
        v_state := 'manual_review';
        v_error_code := 'entitlement_binding_conflict';
        v_error_message := '兑换权益归属待核实，已停止自动操作';
    END IF;

    IF v_state = 'succeeded' THEN
        -- A create response is never enough. Require the saved provider order
        -- plus an independently queried completed entitlement with exact binding.
        v_complete := v_order.provider_order_id IS NOT NULL
            AND v_order.submitted_at IS NOT NULL
            AND v_order.provider_payment_currency IN ('gram', 'usdt')
            -- Official SDK: USDT paymentCurrency is returned as Order.currency usd.
            AND v_snapshot->>'currency' = CASE v_order.provider_payment_currency
                WHEN 'gram' THEN 'gram' WHEN 'usdt' THEN 'usd' ELSE NULL END
            AND v_provider_id = v_order.provider_order_id
            AND v_snapshot->>'provider_order_id' = v_provider_id
            AND v_snapshot->'completed' = 'true'::JSONB
            AND v_snapshot->>'provider_status' = 'completed'
            AND v_snapshot->>'method' = 'api'
            AND v_snapshot->>'verified_by' = 'order_get'
            AND lower(regexp_replace(coalesce(v_snapshot->>'telegram_username', ''), '^@', '')) = v_order.telegram_username
            AND (
                (v_order.product_family = 'telegram_premium'
                    AND coalesce(v_snapshot->>'product_family', 'telegram_premium') = 'telegram_premium'
                    AND v_order.stars_quantity IS NULL
                    AND coalesce(v_snapshot->'stars_quantity', 'null'::JSONB) = 'null'::JSONB
                    AND v_snapshot->>'term_months' = v_order.term_months::TEXT
                    AND v_snapshot->>'product_type' = 'premium_' || v_order.term_months::TEXT || '_month')
                OR (v_order.product_family = 'telegram_stars'
                    AND v_snapshot->>'product_family' = 'telegram_stars'
                    AND v_order.term_months IS NULL
                    AND coalesce(v_snapshot->'term_months', 'null'::JSONB) = 'null'::JSONB
                    AND v_snapshot->>'stars_quantity' = v_order.stars_quantity::TEXT
                    AND jsonb_typeof(v_snapshot->'stars_quantity') = 'number'
                    AND v_snapshot->>'product_type' = 'stars')
            )
            AND coalesce(v_snapshot->'idempotency_key_matches', 'true'::JSONB) <> 'false'::JSONB;
        IF NOT coalesce(v_complete, false) THEN
            v_state := 'manual_review';
            v_error_code := 'provider_completion_unconfirmed';
            v_error_message := '上游完成状态或订单归属未确认';
        END IF;
    END IF;

    UPDATE public.tg_redemption_orders
    SET status = v_state, provider_order_id = v_provider_id, provider_response = v_snapshot,
        last_error_code = CASE WHEN v_state = 'succeeded' THEN NULL ELSE v_error_code END,
        last_error_message = CASE WHEN v_state = 'succeeded' THEN NULL ELSE v_error_message END,
        next_attempt_at = CASE WHEN v_state IN ('processing', 'retry_waiting')
            THEN greatest(coalesce(p_next_attempt_at, now() + interval '30 seconds'), now() + interval '1 second')
            ELSE next_attempt_at END,
        completed_at = CASE WHEN v_state = 'succeeded' THEN now() ELSE completed_at END,
        lease_token = NULL, lease_expires_at = NULL, updated_at = now()
    WHERE id = v_order.id;

    UPDATE public.tg_fulfillment_attempts
    SET status = CASE WHEN v_state = 'succeeded' THEN 'succeeded'
                      WHEN v_state = 'failed' THEN 'failed'
                      WHEN v_state = 'manual_review' THEN 'unknown'
                      ELSE 'submitted' END,
        provider_order_id = v_provider_id, response_payload = v_snapshot,
        error_code = v_error_code, error_message = v_error_message, finished_at = now(),
        duration_ms = least(2147483647, greatest(0, floor(extract(epoch FROM (now() - started_at)) * 1000)))::INTEGER
    WHERE order_id = v_order.id AND attempt_no = v_order.attempt_count;

    UPDATE public.tg_redemption_codes
    SET status = CASE WHEN v_state = 'succeeded' THEN 'fulfilled'
                      WHEN v_state = 'failed' THEN 'failed' ELSE 'fulfilling' END,
        fulfilled_at = CASE WHEN v_state = 'succeeded' THEN now() ELSE fulfilled_at END,
        redeemed_at = CASE WHEN v_state = 'succeeded' THEN now() ELSE redeemed_at END,
        reservation_expires_at = NULL, updated_at = now()
    WHERE id = v_order.code_id;

    IF v_state = 'succeeded' THEN
        UPDATE public.tg_redemption_batches
        SET redeemed_count = redeemed_count + 1, updated_at = now()
        WHERE id = v_code.batch_id;
    END IF;
    INSERT INTO public.tg_audit_events (event_type, target_type, target_id, metadata)
    VALUES ('fulfillment_result', 'redemption_order', v_order.id,
        jsonb_build_object('status', v_state, 'attempt_no', v_order.attempt_count,
            'error_code', CASE WHEN v_state = 'succeeded' THEN NULL ELSE v_error_code END,
            'payment_currency', v_order.provider_payment_currency));
    RETURN jsonb_build_object('success', true, 'status', v_state,
        'product_family', v_order.product_family, 'term_months', v_order.term_months,
        'stars_quantity', v_order.stars_quantity);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_tg_generate_stars_batch(TEXT, INTEGER, INTEGER, TIMESTAMPTZ, UUID, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_generate_stars_batch(TEXT, INTEGER, INTEGER, TIMESTAMPTZ, UUID, JSONB, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.fn_tg_reserve_code(TEXT, TEXT, CHAR(64), CHAR(64)) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_reserve_code(TEXT, TEXT, CHAR(64), CHAR(64)) TO service_role;
REVOKE ALL ON FUNCTION public.fn_tg_order_status(TEXT, CHAR(64)) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_order_status(TEXT, CHAR(64)) TO service_role;
REVOKE ALL ON FUNCTION public.fn_tg_claim_order(UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_claim_order(UUID, UUID, INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.fn_tg_claim_order(UUID, UUID, INTEGER, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_claim_order(UUID, UUID, INTEGER, TEXT[]) TO service_role;
REVOKE ALL ON FUNCTION public.fn_tg_mark_submitted(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_mark_submitted(UUID, UUID) TO service_role;
REVOKE ALL ON FUNCTION public.fn_tg_mark_submitted(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_mark_submitted(UUID, UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.fn_tg_finish_order(UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tg_finish_order(UUID, UUID, TEXT, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

-- Same-transaction verification; no credentials, codes or orders are generated.
DO $$
DECLARE
    v_signature TEXT;
    v_role TEXT;
    v_function OID;
    v_source TEXT;
    v_table TEXT;
BEGIN
    FOREACH v_table IN ARRAY ARRAY['tg_redemption_batches', 'tg_redemption_orders'] LOOP
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = v_table
              AND column_name = 'stars_quantity' AND data_type = 'integer' AND is_nullable = 'YES')
           OR NOT EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = v_table
              AND column_name = 'term_months' AND is_nullable = 'YES') THEN
            RAISE EXCEPTION 'TG Stars entitlement columns missing: %', v_table;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint c
            WHERE c.conrelid = ('public.' || v_table)::regclass
              AND c.conname = v_table || '_entitlement_check' AND c.contype = 'c' AND c.convalidated
              AND position('telegram_premium' IN pg_get_constraintdef(c.oid)) > 0
              AND position('telegram_stars' IN pg_get_constraintdef(c.oid)) > 0
              AND position('stars_quantity IS NULL' IN pg_get_constraintdef(c.oid)) > 0
              AND position('term_months IS NULL' IN pg_get_constraintdef(c.oid)) > 0) THEN
            RAISE EXCEPTION 'TG mutually exclusive entitlement constraint missing: %', v_table;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_class c
            WHERE c.oid = ('public.' || v_table)::regclass AND c.relrowsecurity)
           OR has_table_privilege('anon', 'public.' || v_table, 'SELECT')
           OR has_table_privilege('authenticated', 'public.' || v_table, 'SELECT') THEN
            RAISE EXCEPTION 'unsafe TG entitlement table grants or RLS: %', v_table;
        END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM public.tg_redemption_orders o
        JOIN public.tg_redemption_codes c ON c.id = o.code_id
        JOIN public.tg_redemption_batches b ON b.id = c.batch_id
        WHERE o.product_family IS DISTINCT FROM b.product_family
           OR o.term_months IS DISTINCT FROM b.term_months
           OR o.stars_quantity IS DISTINCT FROM b.stars_quantity) THEN
        RAISE EXCEPTION 'existing TG entitlement mismatch requires manual review';
    END IF;
    FOREACH v_signature IN ARRAY ARRAY[
        'public.fn_tg_generate_stars_batch(text,integer,integer,timestamp with time zone,uuid,jsonb,jsonb)',
        'public.fn_tg_reserve_code(text,text,character,character)',
        'public.fn_tg_order_status(text,character)',
        'public.fn_tg_claim_order(uuid,uuid,integer)',
        'public.fn_tg_claim_order(uuid,uuid,integer,text[])',
        'public.fn_tg_mark_submitted(uuid,uuid)',
        'public.fn_tg_mark_submitted(uuid,uuid,text)',
        'public.fn_tg_finish_order(uuid,uuid,text,text,jsonb,text,text,timestamp with time zone)'
    ] LOOP
        v_function := to_regprocedure(v_signature);
        IF v_function IS NULL THEN
            RAISE EXCEPTION 'missing Stars-aware TG RPC: %', v_signature;
        END IF;
        FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
            IF has_function_privilege(v_role, v_function, 'EXECUTE') THEN
                RAISE EXCEPTION 'unsafe browser role % can invoke %', v_role, v_signature;
            END IF;
        END LOOP;
        IF NOT has_function_privilege('service_role', v_function, 'EXECUTE')
           OR EXISTS (SELECT 1 FROM pg_proc p,
                LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.oid = v_function AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
           OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_function AND p.prosecdef
                AND p.proconfig @> ARRAY['search_path=public, pg_temp']::TEXT[]) THEN
            RAISE EXCEPTION 'invalid TG service-only definer RPC ACL: %', v_signature;
        END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.tg_redemption_batches'::regclass
        AND tgname = 'trg_tg_batch_entitlement_identity' AND NOT tgisinternal AND tgenabled = 'O')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.tg_redemption_codes'::regclass
        AND tgname = 'trg_tg_code_batch_identity' AND NOT tgisinternal AND tgenabled = 'O')
       OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.tg_redemption_orders'::regclass
        AND tgname = 'trg_tg_order_entitlement_identity' AND NOT tgisinternal AND tgenabled = 'O') THEN
        RAISE EXCEPTION 'TG immutable entitlement identity triggers missing';
    END IF;
    SELECT pg_get_functiondef('public.fn_tg_claim_order(uuid,uuid,integer)'::regprocedure) INTO v_source;
    IF position('ARRAY[''telegram_premium'']::TEXT[]' IN v_source) = 0 THEN
        RAISE EXCEPTION 'legacy TG worker can claim unsupported Stars';
    END IF;
    SELECT pg_get_functiondef('public.fn_tg_claim_order(uuid,uuid,integer,text[])'::regprocedure) INTO v_source;
    IF position('o.product_family = ANY(p_product_families)' IN v_source) = 0
       OR position('FOR UPDATE OF c SKIP LOCKED' IN v_source) = 0
       OR position('FOR UPDATE SKIP LOCKED' IN v_source) = 0
       OR position('missing_historical_payment_currency' IN v_source) = 0 THEN
        RAISE EXCEPTION 'Stars claim lost capability, locking, or currency protection';
    END IF;
    SELECT pg_get_functiondef('public.fn_tg_mark_submitted(uuid,uuid)'::regprocedure) INTO v_source;
    IF position('payment_currency_required' IN v_source) = 0
       OR position('UPDATE public.' IN v_source) > 0
       OR position('INSERT INTO public.' IN v_source) > 0 THEN
        RAISE EXCEPTION 'legacy TG marker is not fail-closed';
    END IF;
    SELECT pg_get_functiondef('public.fn_tg_mark_submitted(uuid,uuid,text)'::regprocedure) INTO v_source;
    IF position('SET submitted_at = now(), provider_payment_currency = p_payment_currency' IN v_source) = 0
       OR position('o.attempt_count = 1' IN v_source) = 0
       OR position('o.lease_expires_at > now()' IN v_source) = 0 THEN
        RAISE EXCEPTION 'TG currency-bound single submission guard missing';
    END IF;
    SELECT pg_get_functiondef('public.fn_tg_finish_order(uuid,uuid,text,text,jsonb,text,text,timestamp with time zone)'::regprocedure) INTO v_source;
    IF position('v_snapshot->>''stars_quantity'' = v_order.stars_quantity::TEXT' IN v_source) = 0
       OR position('v_snapshot->>''product_family'' = ''telegram_stars''' IN v_source) = 0
       OR position('v_snapshot->>''product_type'' = ''stars''' IN v_source) = 0
       OR position('v_snapshot->>''verified_by'' = ''order_get''' IN v_source) = 0
       OR position('v_snapshot->>''currency'' = CASE v_order.provider_payment_currency' IN v_source) = 0
       OR position('WHEN ''gram'' THEN ''gram'' WHEN ''usdt'' THEN ''usd'' ELSE NULL END' IN v_source) = 0
       OR position('entitlement_binding_conflict' IN v_source) = 0 THEN
        RAISE EXCEPTION 'Stars completion lost exact entitlement or currency binding';
    END IF;
    RAISE NOTICE 'TG Stars schema, immutable entitlement, service ACL and worker guards verified';
END;
$$;

COMMIT;
