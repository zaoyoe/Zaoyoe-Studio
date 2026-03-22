-- ============================================
-- Payment Ops Hardening
-- 支付异常专题、查码审计、统一落单与安全审核
-- ============================================

ALTER TABLE IF EXISTS public.payment_orders
    ADD COLUMN IF NOT EXISTS checkout_session_id UUID REFERENCES public.payment_checkout_sessions(id) ON DELETE SET NULL;

UPDATE public.payment_orders po
SET checkout_session_id = pcs.id
FROM public.payment_checkout_sessions pcs
WHERE po.checkout_session_id IS NULL
  AND (
      pcs.payment_order_id = po.id
      OR (
          jsonb_typeof(COALESCE(po.provider_metadata, '{}'::JSONB)) = 'object'
          AND COALESCE(po.provider_metadata->>'checkout_session_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          AND (po.provider_metadata->>'checkout_session_id')::UUID = pcs.id
      )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_orders_checkout_session_id_unique
    ON public.payment_orders(checkout_session_id)
    WHERE checkout_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_orders_checkout_session_created_at
    ON public.payment_orders(checkout_session_id, created_at DESC)
    WHERE checkout_session_id IS NOT NULL;

ALTER TABLE IF EXISTS public.payment_events
    ADD COLUMN IF NOT EXISTS response_status INTEGER;

CREATE INDEX IF NOT EXISTS idx_payment_events_provider_response_status
    ON public.payment_events(provider, response_status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.payment_query_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL,
    site VARCHAR(10) NOT NULL DEFAULT 'cn',
    order_no TEXT,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    payment_order_id UUID REFERENCES public.payment_orders(id) ON DELETE SET NULL,
    checkout_session_id UUID REFERENCES public.payment_checkout_sessions(id) ON DELETE SET NULL,
    success BOOLEAN NOT NULL DEFAULT false,
    response_status INTEGER,
    outcome_code TEXT NOT NULL,
    message TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.payment_query_attempts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_payment_query_attempts_provider_created
    ON public.payment_query_attempts(provider, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_query_attempts_provider_success_created
    ON public.payment_query_attempts(provider, success, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_query_attempts_site_created
    ON public.payment_query_attempts(site, created_at DESC);

DROP POLICY IF EXISTS "Admins view payment query attempts" ON public.payment_query_attempts;
CREATE POLICY "Admins view payment query attempts"
    ON public.payment_query_attempts
    FOR SELECT TO authenticated
    USING (public.is_admin());

DROP POLICY IF EXISTS "Service role inserts payment query attempts" ON public.payment_query_attempts;
CREATE POLICY "Service role inserts payment query attempts"
    ON public.payment_query_attempts
    FOR INSERT TO authenticated
    WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.fn_ensure_redemption_code_for_payment_order(
    p_payment_order_id UUID,
    p_package_id UUID DEFAULT NULL,
    p_points INTEGER DEFAULT 0,
    p_site VARCHAR DEFAULT 'cn',
    p_external_order_id TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_payment_order public.payment_orders%ROWTYPE;
    v_effective_code TEXT;
BEGIN
    IF p_payment_order_id IS NULL THEN
        RAISE EXCEPTION 'payment_order_id is required';
    END IF;

    SELECT *
    INTO v_payment_order
    FROM public.payment_orders
    WHERE id = p_payment_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'payment order not found';
    END IF;

    IF GREATEST(COALESCE(p_points, 0), COALESCE(v_payment_order.points_amount, 0), 0) <= 0 THEN
        RAISE EXCEPTION 'payment order points must be greater than 0 before issuing redemption code';
    END IF;

    v_effective_code := NULLIF(BTRIM(v_payment_order.redemption_code), '');

    IF COALESCE(v_effective_code, '') = '' THEN
        FOR i IN 1..8 LOOP
            BEGIN
                v_effective_code := public.generate_redemption_code();

                INSERT INTO public.redemption_codes (
                    code,
                    package_id,
                    points_amount,
                    status,
                    site,
                    external_order_id
                ) VALUES (
                    v_effective_code,
                    COALESCE(p_package_id, v_payment_order.package_id),
                    GREATEST(COALESCE(p_points, 0), COALESCE(v_payment_order.points_amount, 0), 0),
                    'pending',
                    COALESCE(NULLIF(BTRIM(p_site), ''), v_payment_order.site, 'cn'),
                    COALESCE(NULLIF(BTRIM(p_external_order_id), ''), NULLIF(BTRIM(v_payment_order.provider_order_no), ''), v_payment_order.id::TEXT)
                );

                EXIT;
            EXCEPTION WHEN unique_violation THEN
                v_effective_code := NULL;
            END;
        END LOOP;

        IF COALESCE(v_effective_code, '') = '' THEN
            RAISE EXCEPTION 'failed to generate redemption code';
        END IF;
    END IF;

    INSERT INTO public.redemption_codes (
        code,
        package_id,
        points_amount,
        status,
        site,
        external_order_id
    ) VALUES (
        v_effective_code,
        COALESCE(p_package_id, v_payment_order.package_id),
        GREATEST(COALESCE(p_points, 0), COALESCE(v_payment_order.points_amount, 0), 0),
        'pending',
        COALESCE(NULLIF(BTRIM(p_site), ''), v_payment_order.site, 'cn'),
        COALESCE(NULLIF(BTRIM(p_external_order_id), ''), NULLIF(BTRIM(v_payment_order.provider_order_no), ''), v_payment_order.id::TEXT)
    )
    ON CONFLICT (code) DO UPDATE SET
        package_id = COALESCE(redemption_codes.package_id, EXCLUDED.package_id),
        points_amount = COALESCE(redemption_codes.points_amount, EXCLUDED.points_amount),
        site = COALESCE(redemption_codes.site, EXCLUDED.site),
        external_order_id = COALESCE(redemption_codes.external_order_id, EXCLUDED.external_order_id);

    UPDATE public.payment_orders
    SET
        redemption_code = v_effective_code,
        updated_at = NOW()
    WHERE id = p_payment_order_id;

    RETURN v_effective_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_ensure_redemption_code_for_payment_order(
    UUID,
    UUID,
    INTEGER,
    VARCHAR,
    TEXT
) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.fn_apply_payment_order_review(UUID, TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.fn_apply_payment_order_review(
    p_payment_order_id UUID,
    p_action TEXT,
    p_note TEXT DEFAULT NULL,
    p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order public.payment_orders%ROWTYPE;
    v_action TEXT := COALESCE(NULLIF(BTRIM(LOWER(p_action)), ''), '');
    v_note TEXT := NULLIF(BTRIM(p_note), '');
    v_now TIMESTAMPTZ := NOW();
    v_next_status TEXT;
    v_redemption_code TEXT;
    v_manual_review JSONB;
BEGIN
    IF p_payment_order_id IS NULL THEN
        RAISE EXCEPTION 'payment_order_id is required';
    END IF;

    IF v_action NOT IN ('approve', 'reject') THEN
        RAISE EXCEPTION 'unsupported review action';
    END IF;

    SELECT *
    INTO v_order
    FROM public.payment_orders
    WHERE id = p_payment_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'payment order not found';
    END IF;

    IF COALESCE(NULLIF(BTRIM(LOWER(v_order.status)), ''), '') NOT IN ('pending_review', 'amount_mismatch') THEN
        RAISE EXCEPTION 'only pending_review or amount_mismatch orders can be reviewed';
    END IF;

    v_next_status := CASE WHEN v_action = 'approve' THEN 'paid' ELSE 'rejected' END;

    IF v_action = 'approve'
       AND COALESCE(NULLIF(BTRIM(LOWER(v_order.provider)), ''), '') = 'afdian'
       AND GREATEST(COALESCE(v_order.points_amount, 0), 0) <= 0
       AND COALESCE(NULLIF(BTRIM(v_order.redemption_code), ''), '') = ''
    THEN
        RAISE EXCEPTION 'afdian order has no valid package/points, cannot approve safely';
    END IF;

    IF v_action = 'approve'
       AND COALESCE(NULLIF(BTRIM(LOWER(v_order.provider)), ''), '') = 'afdian'
    THEN
        v_redemption_code := public.fn_ensure_redemption_code_for_payment_order(
            v_order.id,
            v_order.package_id,
            v_order.points_amount,
            v_order.site,
            v_order.provider_order_no
        );
    ELSE
        v_redemption_code := v_order.redemption_code;
    END IF;

    v_manual_review := jsonb_strip_nulls(jsonb_build_object(
        'action', v_action,
        'previous_status', v_order.status,
        'reviewed_at', v_now,
        'reviewed_by', p_actor_id,
        'note', v_note,
        'amount_override', (v_order.status = 'amount_mismatch' AND v_action = 'approve')
    ));

    UPDATE public.payment_orders
    SET
        status = v_next_status,
        paid_at = CASE
            WHEN v_action = 'approve' THEN COALESCE(v_order.paid_at, v_now)
            ELSE v_order.paid_at
        END,
        verified_at = CASE
            WHEN v_action = 'approve' THEN v_now
            ELSE COALESCE(v_order.verified_at, v_now)
        END,
        redemption_code = COALESCE(v_redemption_code, v_order.redemption_code),
        last_error = CASE
            WHEN v_action = 'approve' THEN NULL
            ELSE COALESCE(v_note, '已人工审核驳回')
        END,
        provider_metadata = COALESCE(v_order.provider_metadata, '{}'::JSONB) || jsonb_build_object(
            'manual_review', v_manual_review,
            'provider_order_resolved', TRUE,
            'provider_order_resolved_at', COALESCE(
                COALESCE(v_order.provider_metadata, '{}'::JSONB)->'provider_order_resolved_at',
                to_jsonb(v_now)
            )
        ),
        updated_at = v_now
    WHERE id = v_order.id;

    IF v_order.checkout_session_id IS NOT NULL THEN
        UPDATE public.payment_checkout_sessions
        SET
            payment_order_id = v_order.id,
            status = CASE
                WHEN v_action = 'approve' THEN 'completed'
                ELSE 'failed'
            END,
            completed_at = CASE
                WHEN v_action = 'approve' THEN COALESCE(completed_at, v_now)
                ELSE completed_at
            END,
            error_message = CASE
                WHEN v_action = 'approve' THEN NULL
                ELSE COALESCE(v_note, '已人工审核驳回')
            END,
            provider_metadata = COALESCE(provider_metadata, '{}'::JSONB) || jsonb_strip_nulls(jsonb_build_object(
                'linked_by', 'manual_review',
                'linked_at', v_now,
                'payment_status', v_next_status,
                'provider_order_no', v_order.provider_order_no
            )),
            updated_at = v_now
        WHERE id = v_order.checkout_session_id;
    END IF;

    IF COALESCE(NULLIF(BTRIM(LOWER(v_order.provider)), ''), '') = 'afdian' THEN
        UPDATE public.afdian_orders
        SET
            payment_status = v_next_status,
            redeem_code = COALESCE(v_redemption_code, redeem_code),
            sign_verified = COALESCE(sign_verified, false) OR COALESCE(v_order.sign_verified, false),
            amount_verified = COALESCE(amount_verified, false) OR COALESCE(v_order.amount_verified, false),
            paid_at = CASE
                WHEN v_action = 'approve' THEN COALESCE(paid_at, v_order.paid_at, v_now)
                ELSE paid_at
            END,
            verified_at = CASE
                WHEN v_action = 'approve' THEN COALESCE(verified_at, v_now)
                ELSE verified_at
            END,
            payment_order_id = v_order.id
        WHERE out_trade_no = v_order.provider_order_no
           OR payment_order_id = v_order.id;
    END IF;

    RETURN jsonb_build_object(
        'payment_order_id', v_order.id,
        'status', v_next_status,
        'redemption_code', COALESCE(v_redemption_code, v_order.redemption_code),
        'checkout_session_id', v_order.checkout_session_id,
        'reviewed_at', v_now
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_apply_payment_order_review(UUID, TEXT, TEXT, UUID)
    TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.fn_process_afdian_payment(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, UUID, TEXT, VARCHAR, BOOLEAN, BOOLEAN, JSONB, TEXT);
DROP FUNCTION IF EXISTS public.fn_process_afdian_payment(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, UUID, TEXT, VARCHAR, BOOLEAN, BOOLEAN, JSONB, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.fn_process_afdian_payment(
    p_order_no TEXT,
    p_afdian_user_id TEXT,
    p_plan_id TEXT,
    p_paid_amount NUMERIC,
    p_expected_amount NUMERIC,
    p_points INTEGER,
    p_package_id UUID DEFAULT NULL,
    p_package_name TEXT DEFAULT NULL,
    p_site VARCHAR DEFAULT 'cn',
    p_signature_valid BOOLEAN DEFAULT false,
    p_amount_valid BOOLEAN DEFAULT false,
    p_payload JSONB DEFAULT '{}'::JSONB,
    p_error TEXT DEFAULT NULL,
    p_payment_order_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_payment_order_id UUID;
    v_existing_code TEXT;
    v_effective_code TEXT;
    v_status VARCHAR(30);
    v_now TIMESTAMPTZ := NOW();
    v_existing_order public.payment_orders%ROWTYPE;
    v_existing_provider_order_id UUID;
    v_existing_metadata JSONB := '{}'::JSONB;
    v_existing_raw_payload JSONB := '{}'::JSONB;
    v_targeted_update_applied BOOLEAN := FALSE;
BEGIN
    IF COALESCE(BTRIM(p_order_no), '') = '' THEN
        RAISE EXCEPTION 'order_no is required';
    END IF;

    p_site := COALESCE(NULLIF(BTRIM(p_site), ''), 'cn');
    v_status := CASE
        WHEN NOT COALESCE(p_signature_valid, false) THEN 'rejected'
        WHEN NOT COALESCE(p_amount_valid, false) THEN 'amount_mismatch'
        WHEN COALESCE(p_points, 0) <= 0 THEN 'pending_review'
        ELSE 'paid'
    END;

    IF p_payment_order_id IS NOT NULL THEN
        SELECT *
        INTO v_existing_order
        FROM public.payment_orders
        WHERE id = p_payment_order_id
        FOR UPDATE;

        IF FOUND AND COALESCE(NULLIF(BTRIM(LOWER(v_existing_order.provider)), ''), '') = 'afdian' THEN
            v_existing_metadata := COALESCE(v_existing_order.provider_metadata, '{}'::JSONB);
            v_existing_raw_payload := COALESCE(v_existing_order.raw_payload, '{}'::JSONB);

            SELECT id
            INTO v_existing_provider_order_id
            FROM public.payment_orders
            WHERE provider = 'afdian'
              AND provider_order_no = p_order_no
              AND id <> v_existing_order.id
            LIMIT 1;

            IF v_existing_provider_order_id IS NOT NULL THEN
                UPDATE public.payment_orders
                SET
                    checkout_session_id = NULL,
                    provider_metadata = v_existing_metadata || jsonb_strip_nulls(jsonb_build_object(
                        'provider_order_pending', TRUE,
                        'provider_order_resolved', FALSE,
                        'checkout_session_detached_at', v_now,
                        'checkout_session_detached_by', 'fn_process_afdian_payment_existing_order',
                        'superseded_by_payment_order_id', v_existing_provider_order_id
                    )),
                    last_error = COALESCE(NULLIF(BTRIM(last_error), ''), 'superseded_by_existing_provider_order'),
                    updated_at = v_now
                WHERE id = v_existing_order.id
                  AND v_existing_order.checkout_session_id IS NOT NULL;

                v_payment_order_id := v_existing_provider_order_id;
            ELSE
                UPDATE public.payment_orders
                SET
                    provider_order_no = p_order_no,
                    provider_user_id = COALESCE(NULLIF(BTRIM(p_afdian_user_id), ''), provider_user_id),
                    plan_id = COALESCE(NULLIF(BTRIM(p_plan_id), ''), plan_id),
                    site = COALESCE(NULLIF(BTRIM(p_site), ''), site),
                    package_id = COALESCE(p_package_id, package_id),
                    package_name = COALESCE(NULLIF(BTRIM(p_package_name), ''), package_name),
                    expected_amount = COALESCE(p_expected_amount, expected_amount),
                    paid_amount = COALESCE(p_paid_amount, paid_amount),
                    points_amount = GREATEST(COALESCE(points_amount, 0), GREATEST(COALESCE(p_points, 0), 0)),
                    sign_verified = COALESCE(sign_verified, false) OR COALESCE(p_signature_valid, false),
                    amount_verified = COALESCE(amount_verified, false) OR COALESCE(p_amount_valid, false),
                    raw_payload = v_existing_raw_payload || COALESCE(p_payload, '{}'::JSONB),
                    provider_metadata = v_existing_metadata || jsonb_strip_nulls(jsonb_build_object(
                        'plan_id', p_plan_id,
                        'package_name', p_package_name,
                        'checkout_session_id', v_existing_order.checkout_session_id,
                        'provider_order_resolved', TRUE,
                        'provider_order_resolved_at', v_now,
                        'intent_created_at', COALESCE(
                            v_existing_metadata->'intent_created_at',
                            to_jsonb(v_existing_order.created_at)
                        )
                    )),
                    paid_at = COALESCE(paid_at, CASE WHEN v_status = 'paid' THEN v_now ELSE NULL END),
                    verified_at = COALESCE(
                        verified_at,
                        CASE
                            WHEN COALESCE(p_signature_valid, false) AND COALESCE(p_amount_valid, false)
                                THEN v_now
                            ELSE NULL
                        END
                    ),
                    last_error = CASE
                        WHEN v_status = 'paid' THEN NULL
                        ELSE NULLIF(BTRIM(COALESCE(p_error, '')), '')
                    END,
                    status = CASE
                        WHEN status = 'redeemed' THEN status
                        WHEN v_status = 'paid' THEN 'paid'
                        WHEN status = 'paid' AND v_status <> 'paid' THEN status
                        ELSE v_status
                    END,
                    created_at = CASE
                        WHEN COALESCE((v_existing_metadata->>'provider_order_resolved')::BOOLEAN, FALSE) = FALSE
                             OR UPPER(COALESCE(v_existing_order.provider_order_no, '')) LIKE 'PENDING\_%'
                            THEN COALESCE(v_existing_order.paid_at, v_now)
                        ELSE v_existing_order.created_at
                    END,
                    updated_at = v_now
                WHERE id = v_existing_order.id
                RETURNING id, redemption_code INTO v_payment_order_id, v_existing_code;

                v_targeted_update_applied := TRUE;
            END IF;
        END IF;
    END IF;

    IF v_payment_order_id IS NULL THEN
        INSERT INTO public.payment_orders (
            provider,
            provider_order_no,
            provider_user_id,
            plan_id,
            site,
            package_id,
            package_name,
            checkout_session_id,
            expected_amount,
            paid_amount,
            points_amount,
            status,
            sign_verified,
            amount_verified,
            raw_payload,
            provider_metadata,
            paid_at,
            verified_at,
            last_error
        ) VALUES (
            'afdian',
            p_order_no,
            p_afdian_user_id,
            p_plan_id,
            p_site,
            p_package_id,
            p_package_name,
            NULL,
            p_expected_amount,
            p_paid_amount,
            GREATEST(COALESCE(p_points, 0), 0),
            v_status,
            COALESCE(p_signature_valid, false),
            COALESCE(p_amount_valid, false),
            COALESCE(p_payload, '{}'::JSONB),
            jsonb_strip_nulls(jsonb_build_object(
                'plan_id', p_plan_id,
                'package_name', p_package_name,
                'provider_order_resolved', TRUE,
                'provider_order_resolved_at', v_now
            )),
            CASE WHEN v_status = 'paid' THEN v_now ELSE NULL END,
            CASE
                WHEN COALESCE(p_signature_valid, false) AND COALESCE(p_amount_valid, false)
                    THEN v_now
                ELSE NULL
            END,
            NULLIF(BTRIM(COALESCE(p_error, '')), '')
        )
        ON CONFLICT (provider, provider_order_no) DO UPDATE SET
            provider_user_id = COALESCE(EXCLUDED.provider_user_id, payment_orders.provider_user_id),
            plan_id = COALESCE(EXCLUDED.plan_id, payment_orders.plan_id),
            site = COALESCE(EXCLUDED.site, payment_orders.site),
            package_id = COALESCE(EXCLUDED.package_id, payment_orders.package_id),
            package_name = COALESCE(EXCLUDED.package_name, payment_orders.package_name),
            expected_amount = COALESCE(EXCLUDED.expected_amount, payment_orders.expected_amount),
            paid_amount = COALESCE(EXCLUDED.paid_amount, payment_orders.paid_amount),
            points_amount = GREATEST(COALESCE(payment_orders.points_amount, 0), COALESCE(EXCLUDED.points_amount, 0)),
            sign_verified = COALESCE(payment_orders.sign_verified, false) OR COALESCE(EXCLUDED.sign_verified, false),
            amount_verified = COALESCE(payment_orders.amount_verified, false) OR COALESCE(EXCLUDED.amount_verified, false),
            raw_payload = COALESCE(payment_orders.raw_payload, '{}'::JSONB) || COALESCE(EXCLUDED.raw_payload, '{}'::JSONB),
            provider_metadata = COALESCE(payment_orders.provider_metadata, '{}'::JSONB)
                || COALESCE(EXCLUDED.provider_metadata, '{}'::JSONB)
                || jsonb_build_object(
                    'provider_order_resolved', TRUE,
                    'provider_order_resolved_at', v_now
                ),
            paid_at = COALESCE(payment_orders.paid_at, EXCLUDED.paid_at),
            verified_at = COALESCE(payment_orders.verified_at, EXCLUDED.verified_at),
            last_error = CASE
                WHEN EXCLUDED.status = 'paid' THEN NULL
                ELSE COALESCE(NULLIF(EXCLUDED.last_error, ''), payment_orders.last_error)
            END,
            status = CASE
                WHEN payment_orders.status = 'redeemed' THEN payment_orders.status
                WHEN EXCLUDED.status = 'paid' THEN 'paid'
                WHEN payment_orders.status = 'paid' AND EXCLUDED.status <> 'paid' THEN payment_orders.status
                ELSE EXCLUDED.status
            END,
            updated_at = v_now
        RETURNING id, redemption_code INTO v_payment_order_id, v_existing_code;
    ELSIF NOT v_targeted_update_applied THEN
        SELECT redemption_code
        INTO v_existing_code
        FROM public.payment_orders
        WHERE id = v_payment_order_id;
    END IF;

    v_effective_code := v_existing_code;

    IF v_status = 'paid' THEN
        v_effective_code := public.fn_ensure_redemption_code_for_payment_order(
            v_payment_order_id,
            p_package_id,
            GREATEST(COALESCE(p_points, 0), 0),
            p_site,
            p_order_no
        );
    END IF;

    INSERT INTO public.afdian_orders (
        out_trade_no,
        afdian_user_id,
        plan_id,
        total_amount,
        points,
        redeem_code,
        is_redeemed,
        remark,
        raw_payload,
        site,
        payment_status,
        sign_verified,
        amount_verified,
        paid_at,
        verified_at,
        payment_order_id
    ) VALUES (
        p_order_no,
        p_afdian_user_id,
        p_plan_id,
        COALESCE(p_paid_amount, 0),
        GREATEST(COALESCE(p_points, 0), 0),
        v_effective_code,
        false,
        NULL,
        COALESCE(p_payload, '{}'::JSONB),
        p_site,
        v_status,
        COALESCE(p_signature_valid, false),
        COALESCE(p_amount_valid, false),
        CASE WHEN v_status = 'paid' THEN v_now ELSE NULL END,
        CASE
            WHEN COALESCE(p_signature_valid, false) AND COALESCE(p_amount_valid, false)
                THEN v_now
            ELSE NULL
        END,
        v_payment_order_id
    )
    ON CONFLICT (out_trade_no) DO UPDATE SET
        afdian_user_id = COALESCE(EXCLUDED.afdian_user_id, afdian_orders.afdian_user_id),
        plan_id = COALESCE(EXCLUDED.plan_id, afdian_orders.plan_id),
        total_amount = COALESCE(EXCLUDED.total_amount, afdian_orders.total_amount),
        points = GREATEST(COALESCE(afdian_orders.points, 0), COALESCE(EXCLUDED.points, 0)),
        redeem_code = COALESCE(afdian_orders.redeem_code, EXCLUDED.redeem_code),
        raw_payload = COALESCE(afdian_orders.raw_payload, '{}'::JSONB) || COALESCE(EXCLUDED.raw_payload, '{}'::JSONB),
        site = COALESCE(EXCLUDED.site, afdian_orders.site),
        payment_order_id = COALESCE(afdian_orders.payment_order_id, EXCLUDED.payment_order_id),
        payment_status = CASE
            WHEN afdian_orders.payment_status = 'redeemed' THEN afdian_orders.payment_status
            WHEN EXCLUDED.payment_status = 'paid' THEN 'paid'
            WHEN afdian_orders.payment_status = 'paid' AND EXCLUDED.payment_status <> 'paid' THEN afdian_orders.payment_status
            ELSE EXCLUDED.payment_status
        END,
        sign_verified = COALESCE(afdian_orders.sign_verified, false) OR COALESCE(EXCLUDED.sign_verified, false),
        amount_verified = COALESCE(afdian_orders.amount_verified, false) OR COALESCE(EXCLUDED.amount_verified, false),
        paid_at = COALESCE(afdian_orders.paid_at, EXCLUDED.paid_at),
        verified_at = COALESCE(afdian_orders.verified_at, EXCLUDED.verified_at)
    RETURNING redeem_code INTO v_effective_code;

    RETURN jsonb_build_object(
        'payment_order_id', v_payment_order_id,
        'status', v_status,
        'code', v_effective_code,
        'points', GREATEST(COALESCE(p_points, 0), 0),
        'requires_review', v_status <> 'paid'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_process_afdian_payment(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, UUID, TEXT, VARCHAR, BOOLEAN, BOOLEAN, JSONB, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_process_afdian_payment(TEXT, TEXT, TEXT, NUMERIC, NUMERIC, INTEGER, UUID, TEXT, VARCHAR, BOOLEAN, BOOLEAN, JSONB, TEXT, UUID) TO service_role;
