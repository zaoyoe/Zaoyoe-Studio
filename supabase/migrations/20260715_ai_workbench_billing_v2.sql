-- AI Workbench billing V2: exact authorization, settlement, release, and task-level idempotency.

ALTER TABLE public.points_ledger
    ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT TRUE;

DO $$
DECLARE
    constraint_record RECORD;
BEGIN
    FOR constraint_record IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid
         AND a.attnum = ANY(c.conkey)
        WHERE c.conrelid = 'public.ai_image_tasks'::regclass
          AND c.contype = 'c'
          AND a.attname = 'status'
    LOOP
        EXECUTE format('ALTER TABLE public.ai_image_tasks DROP CONSTRAINT IF EXISTS %I', constraint_record.conname);
    END LOOP;
END
$$;

ALTER TABLE public.ai_image_tasks
    ADD CONSTRAINT ai_image_tasks_status_check
    CHECK (status IN ('authorizing', 'queued', 'running', 'succeeded', 'failed', 'cancelled', 'refunded'));

CREATE TABLE IF NOT EXISTS public.ai_workbench_point_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    site TEXT NOT NULL CHECK (site IN ('cn', 'intl')),
    status TEXT NOT NULL DEFAULT 'authorized'
        CHECK (status IN ('authorized', 'settled', 'released')),
    authorized_points NUMERIC(18, 6) NOT NULL CHECK (authorized_points > 0),
    authorized_bonus NUMERIC(18, 6) NOT NULL DEFAULT 0 CHECK (authorized_bonus >= 0),
    authorized_paid NUMERIC(18, 6) NOT NULL DEFAULT 0 CHECK (authorized_paid >= 0),
    settled_points NUMERIC(18, 6) NOT NULL DEFAULT 0 CHECK (settled_points >= 0),
    settled_bonus NUMERIC(18, 6) NOT NULL DEFAULT 0 CHECK (settled_bonus >= 0),
    settled_paid NUMERIC(18, 6) NOT NULL DEFAULT 0 CHECK (settled_paid >= 0),
    released_points NUMERIC(18, 6) NOT NULL DEFAULT 0 CHECK (released_points >= 0),
    ledger_id UUID REFERENCES public.points_ledger(id) ON DELETE SET NULL,
    reason TEXT NOT NULL DEFAULT '',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    authorized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    settled_at TIMESTAMPTZ,
    released_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ai_workbench_point_reservations_scope_unique UNIQUE (task_id, user_id, site)
);

CREATE INDEX IF NOT EXISTS idx_ai_workbench_point_reservations_user_created
    ON public.ai_workbench_point_reservations(user_id, site, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_workbench_point_reservations_status_updated
    ON public.ai_workbench_point_reservations(status, updated_at);

ALTER TABLE public.ai_workbench_point_reservations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ai_workbench_point_reservations FROM PUBLIC;
REVOKE ALL ON TABLE public.ai_workbench_point_reservations FROM anon;
REVOKE ALL ON TABLE public.ai_workbench_point_reservations FROM authenticated;
GRANT ALL ON TABLE public.ai_workbench_point_reservations TO service_role;

CREATE OR REPLACE FUNCTION public.fn_authorize_ai_workbench_points(
    p_task_id UUID,
    p_user_id UUID,
    p_site VARCHAR,
    p_amount NUMERIC,
    p_reason TEXT DEFAULT 'AI 工作台预授权'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    normalized_site TEXT := LOWER(COALESCE(NULLIF(BTRIM(p_site), ''), 'cn'));
    normalized_amount NUMERIC(18,6) := ROUND(COALESCE(p_amount, 0), 6);
    current_bonus NUMERIC(18,6) := 0;
    current_paid NUMERIC(18,6) := 0;
    deduct_bonus NUMERIC(18,6) := 0;
    deduct_paid NUMERIC(18,6) := 0;
    existing_reservation public.ai_workbench_point_reservations%ROWTYPE;
    inserted_ledger_id UUID;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;
    IF p_task_id IS NULL OR p_user_id IS NULL THEN
        RAISE EXCEPTION 'task_id and user_id are required';
    END IF;
    IF normalized_site NOT IN ('cn', 'intl') THEN
        RAISE EXCEPTION 'Unsupported site';
    END IF;
    IF normalized_amount <= 0 THEN
        RAISE EXCEPTION 'Authorization amount must be positive';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('ai-workbench:' || p_task_id::TEXT, 0));

    SELECT * INTO existing_reservation
    FROM public.ai_workbench_point_reservations
    WHERE task_id = p_task_id;

    IF FOUND THEN
        IF existing_reservation.user_id <> p_user_id OR existing_reservation.site <> normalized_site THEN
            RAISE EXCEPTION 'Reservation scope mismatch';
        END IF;
        RETURN jsonb_build_object(
            'success', true,
            'duplicate', true,
            'status', existing_reservation.status,
            'authorized', existing_reservation.authorized_points,
            'settled', existing_reservation.settled_points,
            'reservation_id', existing_reservation.id,
            'ledger_id', existing_reservation.ledger_id,
            'site', normalized_site
        );
    END IF;

    PERFORM 1
    FROM public.ai_image_tasks
    WHERE id = p_task_id
      AND user_id = p_user_id
      AND site = normalized_site
      AND billing_mode = 'points';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'AI workbench task scope mismatch';
    END IF;

    SELECT COALESCE(bonus_balance, 0), COALESCE(paid_balance, 0)
      INTO current_bonus, current_paid
    FROM public.points_balance
    WHERE user_id = p_user_id
      AND site = normalized_site
    FOR UPDATE;

    IF NOT FOUND OR ROUND(current_bonus + current_paid, 6) < normalized_amount THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'insufficient_points',
            'message', '积分余额不足',
            'required', normalized_amount,
            'balance', ROUND(COALESCE(current_bonus, 0) + COALESCE(current_paid, 0), 6),
            'site', normalized_site
        );
    END IF;

    deduct_bonus := LEAST(current_bonus, normalized_amount);
    deduct_paid := normalized_amount - deduct_bonus;

    UPDATE public.points_balance
       SET bonus_balance = ROUND(bonus_balance - deduct_bonus, 6),
           paid_balance = ROUND(paid_balance - deduct_paid, 6),
           updated_at = NOW(),
           version = version + 1
     WHERE user_id = p_user_id
       AND site = normalized_site;

    INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site, is_visible)
    VALUES (p_user_id, -normalized_amount, p_reason, p_task_id::TEXT, normalized_site, FALSE)
    RETURNING id INTO inserted_ledger_id;

    INSERT INTO public.ai_workbench_point_reservations (
        task_id,
        user_id,
        site,
        authorized_points,
        authorized_bonus,
        authorized_paid,
        ledger_id,
        reason
    ) VALUES (
        p_task_id,
        p_user_id,
        normalized_site,
        normalized_amount,
        deduct_bonus,
        deduct_paid,
        inserted_ledger_id,
        p_reason
    )
    RETURNING * INTO existing_reservation;

    RETURN jsonb_build_object(
        'success', true,
        'duplicate', false,
        'status', existing_reservation.status,
        'authorized', normalized_amount,
        'authorized_bonus', deduct_bonus,
        'authorized_paid', deduct_paid,
        'reservation_id', existing_reservation.id,
        'ledger_id', inserted_ledger_id,
        'new_total', ROUND(current_bonus + current_paid - normalized_amount, 6),
        'site', normalized_site
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_settle_ai_workbench_points(
    p_task_id UUID,
    p_user_id UUID,
    p_site VARCHAR,
    p_amount NUMERIC,
    p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    normalized_site TEXT := LOWER(COALESCE(NULLIF(BTRIM(p_site), ''), 'cn'));
    normalized_amount NUMERIC(18,6) := ROUND(COALESCE(p_amount, 0), 6);
    reservation public.ai_workbench_point_reservations%ROWTYPE;
    current_bonus NUMERIC(18,6) := 0;
    current_paid NUMERIC(18,6) := 0;
    extra_points NUMERIC(18,6) := 0;
    extra_bonus NUMERIC(18,6) := 0;
    extra_paid NUMERIC(18,6) := 0;
    v_settled_bonus NUMERIC(18,6) := 0;
    v_settled_paid NUMERIC(18,6) := 0;
    refund_bonus NUMERIC(18,6) := 0;
    refund_paid NUMERIC(18,6) := 0;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;
    IF p_task_id IS NULL OR p_user_id IS NULL THEN
        RAISE EXCEPTION 'task_id and user_id are required';
    END IF;
    IF normalized_amount < 0 THEN
        RAISE EXCEPTION 'Settlement amount cannot be negative';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('ai-workbench:' || p_task_id::TEXT, 0));

    SELECT * INTO reservation
    FROM public.ai_workbench_point_reservations
    WHERE task_id = p_task_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'ai_billing_reservation_not_found',
            'message', '未找到任务积分预授权'
        );
    END IF;
    IF reservation.user_id <> p_user_id OR reservation.site <> normalized_site THEN
        RAISE EXCEPTION 'Reservation scope mismatch';
    END IF;
    IF reservation.status = 'settled' THEN
        RETURN jsonb_build_object(
            'success', true,
            'duplicate', true,
            'status', reservation.status,
            'deducted', reservation.settled_points,
            'reservation_id', reservation.id,
            'ledger_id', reservation.ledger_id,
            'site', normalized_site
        );
    END IF;
    IF reservation.status = 'released' THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'ai_billing_reservation_released',
            'message', '任务积分预授权已释放'
        );
    END IF;

    SELECT COALESCE(bonus_balance, 0), COALESCE(paid_balance, 0)
      INTO current_bonus, current_paid
    FROM public.points_balance
    WHERE user_id = p_user_id
      AND site = normalized_site
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Points balance account not found';
    END IF;

    IF normalized_amount > reservation.authorized_points THEN
        extra_points := normalized_amount - reservation.authorized_points;
        IF ROUND(current_bonus + current_paid, 6) < extra_points THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'ai_billing_reservation_shortfall',
                'message', '实际扣费超过预授权且余额不足',
                'required_extra', extra_points,
                'balance', ROUND(current_bonus + current_paid, 6),
                'authorized', reservation.authorized_points,
                'actual', normalized_amount,
                'site', normalized_site
            );
        END IF;

        extra_bonus := LEAST(current_bonus, extra_points);
        extra_paid := extra_points - extra_bonus;
        reservation.authorized_bonus := reservation.authorized_bonus + extra_bonus;
        reservation.authorized_paid := reservation.authorized_paid + extra_paid;
        reservation.authorized_points := normalized_amount;
        current_bonus := current_bonus - extra_bonus;
        current_paid := current_paid - extra_paid;
    END IF;

    v_settled_bonus := LEAST(normalized_amount, reservation.authorized_bonus);
    v_settled_paid := normalized_amount - v_settled_bonus;
    refund_bonus := reservation.authorized_bonus - v_settled_bonus;
    refund_paid := reservation.authorized_paid - v_settled_paid;

    UPDATE public.points_balance
       SET bonus_balance = ROUND(current_bonus + refund_bonus, 6),
           paid_balance = ROUND(current_paid + refund_paid, 6),
           updated_at = NOW(),
           version = version + 1
     WHERE user_id = p_user_id
       AND site = normalized_site;

    UPDATE public.points_ledger
       SET amount = -normalized_amount,
           reason = COALESCE(NULLIF(BTRIM(p_reason), ''), reason),
           is_visible = normalized_amount > 0
     WHERE id = reservation.ledger_id;

    UPDATE public.ai_workbench_point_reservations
       SET status = 'settled',
           authorized_points = reservation.authorized_points,
           authorized_bonus = reservation.authorized_bonus,
           authorized_paid = reservation.authorized_paid,
           settled_points = normalized_amount,
           settled_bonus = v_settled_bonus,
           settled_paid = v_settled_paid,
           released_points = ROUND(refund_bonus + refund_paid, 6),
           reason = COALESCE(NULLIF(BTRIM(p_reason), ''), reason),
           settled_at = NOW(),
           updated_at = NOW()
     WHERE id = reservation.id;

    RETURN jsonb_build_object(
        'success', true,
        'duplicate', false,
        'status', 'settled',
        'deducted', normalized_amount,
        'deducted_bonus', v_settled_bonus,
        'deducted_paid', v_settled_paid,
        'released', ROUND(refund_bonus + refund_paid, 6),
        'reservation_id', reservation.id,
        'ledger_id', reservation.ledger_id,
        'new_total', ROUND(current_bonus + current_paid + refund_bonus + refund_paid, 6),
        'site', normalized_site
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_release_ai_workbench_points(
    p_task_id UUID,
    p_user_id UUID,
    p_site VARCHAR,
    p_reason TEXT DEFAULT 'AI 工作台预授权释放'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    normalized_site TEXT := LOWER(COALESCE(NULLIF(BTRIM(p_site), ''), 'cn'));
    reservation public.ai_workbench_point_reservations%ROWTYPE;
    current_bonus NUMERIC(18,6) := 0;
    current_paid NUMERIC(18,6) := 0;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;
    IF p_task_id IS NULL OR p_user_id IS NULL THEN
        RAISE EXCEPTION 'task_id and user_id are required';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended('ai-workbench:' || p_task_id::TEXT, 0));

    SELECT * INTO reservation
    FROM public.ai_workbench_point_reservations
    WHERE task_id = p_task_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', true,
            'duplicate', true,
            'status', 'missing',
            'released', 0,
            'site', normalized_site
        );
    END IF;
    IF reservation.user_id <> p_user_id OR reservation.site <> normalized_site THEN
        RAISE EXCEPTION 'Reservation scope mismatch';
    END IF;
    IF reservation.status = 'released' THEN
        RETURN jsonb_build_object(
            'success', true,
            'duplicate', true,
            'status', reservation.status,
            'released', reservation.released_points,
            'reservation_id', reservation.id,
            'site', normalized_site
        );
    END IF;
    IF reservation.status = 'settled' THEN
        RETURN jsonb_build_object(
            'success', true,
            'duplicate', true,
            'status', reservation.status,
            'released', 0,
            'deducted', reservation.settled_points,
            'reservation_id', reservation.id,
            'site', normalized_site
        );
    END IF;

    SELECT COALESCE(bonus_balance, 0), COALESCE(paid_balance, 0)
      INTO current_bonus, current_paid
    FROM public.points_balance
    WHERE user_id = p_user_id
      AND site = normalized_site
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Points balance account not found';
    END IF;

    UPDATE public.points_balance
       SET bonus_balance = ROUND(bonus_balance + reservation.authorized_bonus, 6),
           paid_balance = ROUND(paid_balance + reservation.authorized_paid, 6),
           updated_at = NOW(),
           version = version + 1
     WHERE user_id = p_user_id
       AND site = normalized_site;

    UPDATE public.points_ledger
       SET amount = 0,
           reason = COALESCE(NULLIF(BTRIM(p_reason), ''), reason),
           is_visible = FALSE
     WHERE id = reservation.ledger_id;

    UPDATE public.ai_workbench_point_reservations
       SET status = 'released',
           released_points = authorized_points,
           reason = COALESCE(NULLIF(BTRIM(p_reason), ''), reason),
           released_at = NOW(),
           updated_at = NOW()
     WHERE id = reservation.id;

    RETURN jsonb_build_object(
        'success', true,
        'duplicate', false,
        'status', 'released',
        'released', reservation.authorized_points,
        'reservation_id', reservation.id,
        'ledger_id', reservation.ledger_id,
        'new_total', ROUND(current_bonus + current_paid + reservation.authorized_points, 6),
        'site', normalized_site
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_authorize_ai_workbench_points(UUID, UUID, VARCHAR, NUMERIC, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_settle_ai_workbench_points(UUID, UUID, VARCHAR, NUMERIC, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_release_ai_workbench_points(UUID, UUID, VARCHAR, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_authorize_ai_workbench_points(UUID, UUID, VARCHAR, NUMERIC, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.fn_settle_ai_workbench_points(UUID, UUID, VARCHAR, NUMERIC, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.fn_release_ai_workbench_points(UUID, UUID, VARCHAR, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.fn_authorize_ai_workbench_points(UUID, UUID, VARCHAR, NUMERIC, TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.fn_settle_ai_workbench_points(UUID, UUID, VARCHAR, NUMERIC, TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.fn_release_ai_workbench_points(UUID, UUID, VARCHAR, TEXT) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.fn_authorize_ai_workbench_points(UUID, UUID, VARCHAR, NUMERIC, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_settle_ai_workbench_points(UUID, UUID, VARCHAR, NUMERIC, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_release_ai_workbench_points(UUID, UUID, VARCHAR, TEXT) TO service_role;
