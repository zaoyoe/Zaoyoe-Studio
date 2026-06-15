-- Harden payment recharge settlement idempotency.
--
-- The payment webhooks and active status polling can legitimately race each
-- other. A payment reference must therefore be idempotent at the balance RPC,
-- not only at the caller.

CREATE INDEX IF NOT EXISTS idx_points_ledger_user_site_reference_positive
    ON public.points_ledger(user_id, site, reference_id, created_at)
    WHERE reference_id IS NOT NULL AND amount > 0;

DELETE FROM public.payment_events pe
USING public.payment_events keeper
WHERE pe.event_key IS NOT NULL
  AND keeper.event_key = pe.event_key
  AND (
      keeper.created_at < pe.created_at
      OR (keeper.created_at = pe.created_at AND keeper.id < pe.id)
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_events_event_key_unique
    ON public.payment_events(event_key)
    WHERE event_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_recharge_points(
    target_user_id UUID,
    p_paid NUMERIC(12,2),
    p_bonus NUMERIC(12,2),
    p_reason TEXT,
    p_reference_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_new_balance RECORD;
    v_recharge_ledger_id UUID;
    v_existing_ledger RECORD;
    v_pending_reward RECORD;
    v_pending_reward_ledger_id UUID;
    v_paid NUMERIC(12,2) := ROUND(COALESCE(p_paid, 0), 2);
    v_bonus NUMERIC(12,2) := ROUND(COALESCE(p_bonus, 0), 2);
    v_source_type VARCHAR(40);
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    IF target_user_id IS NULL THEN
        RAISE EXCEPTION 'target_user_id is required';
    END IF;

    IF v_paid < 0 OR v_bonus < 0 THEN
        RAISE EXCEPTION 'paid and bonus must be non-negative';
    END IF;

    IF ROUND(v_paid + v_bonus, 2) <= 0 THEN
        RAISE EXCEPTION 'recharge total must be greater than 0';
    END IF;

    IF NULLIF(BTRIM(COALESCE(p_reference_id, '')), '') IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext(
            'fn_recharge_points:' || target_user_id::TEXT || ':cn:' || p_reference_id
        )::BIGINT);

        SELECT id, amount
        INTO v_existing_ledger
        FROM public.points_ledger
        WHERE user_id = target_user_id
          AND COALESCE(site, 'cn') = 'cn'
          AND reference_id = p_reference_id
          AND amount > 0
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE;

        IF FOUND THEN
            SELECT paid_balance, bonus_balance, total_balance
            INTO v_new_balance
            FROM public.points_balance
            WHERE user_id = target_user_id
              AND COALESCE(site, 'cn') = 'cn';

            RETURN jsonb_build_object(
                'success', true,
                'deduped', true,
                'ledger_id', v_existing_ledger.id,
                'paid', COALESCE(v_new_balance.paid_balance, 0),
                'bonus', COALESCE(v_new_balance.bonus_balance, 0),
                'total', COALESCE(v_new_balance.total_balance, 0)
            );
        END IF;
    END IF;

    INSERT INTO public.points_ledger (user_id, amount, reason, reference_id)
    VALUES (target_user_id, ROUND(v_paid + v_bonus, 2), p_reason, p_reference_id)
    RETURNING id INTO v_recharge_ledger_id;

    INSERT INTO public.points_balance (user_id, paid_balance, bonus_balance)
    VALUES (target_user_id, v_paid, v_bonus)
    ON CONFLICT (user_id)
    DO UPDATE SET
        paid_balance = ROUND(public.points_balance.paid_balance + EXCLUDED.paid_balance, 2),
        bonus_balance = ROUND(public.points_balance.bonus_balance + EXCLUDED.bonus_balance, 2),
        updated_at = NOW()
    RETURNING paid_balance, bonus_balance, total_balance INTO v_new_balance;

    v_source_type := public.fn_classify_wallet_point_lot_source(p_reason, p_reference_id, v_paid, v_bonus);
    IF v_paid > 0 THEN
        PERFORM public.fn_create_wallet_point_lot(
            target_user_id,
            'cn',
            v_source_type,
            p_reason,
            p_reference_id,
            v_paid,
            v_paid,
            'CNY',
            v_recharge_ledger_id,
            jsonb_build_object('component', 'paid', 'legacy_site_overload', true)
        );
    END IF;
    IF v_bonus > 0 THEN
        PERFORM public.fn_create_wallet_point_lot(
            target_user_id,
            'cn',
            CASE WHEN v_source_type IN ('recharge', 'redemption_code') THEN 'activity_bonus' ELSE v_source_type END,
            p_reason,
            p_reference_id,
            v_bonus,
            0,
            'CNY',
            NULL,
            jsonb_build_object('component', 'bonus', 'source_ledger_id', v_recharge_ledger_id, 'legacy_site_overload', true)
        );
    END IF;

    IF ROUND(v_paid + v_bonus, 2) > 0
       AND public.fn_is_affiliate_qualifying_recharge_reason(p_reason) THEN
        SELECT *
        INTO v_pending_reward
        FROM public.pending_referral_rewards
        WHERE invitee_id = target_user_id;

        IF FOUND THEN
            INSERT INTO public.points_balance (user_id, paid_balance, bonus_balance)
            VALUES (v_pending_reward.inviter_id, 0, ROUND(v_pending_reward.reward_points, 2))
            ON CONFLICT (user_id) DO UPDATE SET
                bonus_balance = ROUND(public.points_balance.bonus_balance + EXCLUDED.bonus_balance, 2),
                updated_at = NOW();

            INSERT INTO public.points_ledger (user_id, amount, reason, reference_id)
            VALUES (
                v_pending_reward.inviter_id,
                ROUND(v_pending_reward.reward_points, 2),
                '拉新固定奖励 (下线首充激活)',
                'REG_REWARD_UNLOCK_RECHARGE_' || v_recharge_ledger_id
            )
            RETURNING id INTO v_pending_reward_ledger_id;

            PERFORM public.fn_create_wallet_point_lot(
                v_pending_reward.inviter_id,
                'cn',
                'affiliate_commission',
                '拉新固定奖励 (下线首充激活)',
                'REG_REWARD_UNLOCK_RECHARGE_' || v_recharge_ledger_id,
                ROUND(v_pending_reward.reward_points, 2),
                0,
                'CNY',
                v_pending_reward_ledger_id,
                jsonb_build_object('invitee_id', target_user_id, 'legacy_site_overload', true)
            );

            DELETE FROM public.pending_referral_rewards
            WHERE id = v_pending_reward.id;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'deduped', false,
        'ledger_id', v_recharge_ledger_id,
        'paid', v_new_balance.paid_balance,
        'bonus', v_new_balance.bonus_balance,
        'total', v_new_balance.total_balance
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_recharge_points(
    target_user_id UUID,
    p_paid NUMERIC(12,2),
    p_bonus NUMERIC(12,2),
    p_reason TEXT,
    p_reference_id TEXT,
    p_site VARCHAR DEFAULT 'cn'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_new_balance RECORD;
    v_recharge_ledger_id UUID;
    v_existing_ledger RECORD;
    v_pending_reward RECORD;
    v_pending_reward_ledger_id UUID;
    v_paid NUMERIC(12,2) := ROUND(COALESCE(p_paid, 0), 2);
    v_bonus NUMERIC(12,2) := ROUND(COALESCE(p_bonus, 0), 2);
    v_site VARCHAR := COALESCE(NULLIF(BTRIM(p_site), ''), 'cn');
    v_source_type VARCHAR(40);
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    IF target_user_id IS NULL THEN
        RAISE EXCEPTION 'target_user_id is required';
    END IF;

    IF v_paid < 0 OR v_bonus < 0 THEN
        RAISE EXCEPTION 'paid and bonus must be non-negative';
    END IF;

    IF ROUND(v_paid + v_bonus, 2) <= 0 THEN
        RAISE EXCEPTION 'recharge total must be greater than 0';
    END IF;

    IF NULLIF(BTRIM(COALESCE(p_reference_id, '')), '') IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext(
            'fn_recharge_points:' || target_user_id::TEXT || ':' || v_site || ':' || p_reference_id
        )::BIGINT);

        SELECT id, amount
        INTO v_existing_ledger
        FROM public.points_ledger
        WHERE user_id = target_user_id
          AND site = v_site
          AND reference_id = p_reference_id
          AND amount > 0
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE;

        IF FOUND THEN
            SELECT paid_balance, bonus_balance, total_balance
            INTO v_new_balance
            FROM public.points_balance
            WHERE user_id = target_user_id
              AND site = v_site;

            RETURN jsonb_build_object(
                'success', true,
                'deduped', true,
                'ledger_id', v_existing_ledger.id,
                'paid', COALESCE(v_new_balance.paid_balance, 0),
                'bonus', COALESCE(v_new_balance.bonus_balance, 0),
                'total', COALESCE(v_new_balance.total_balance, 0)
            );
        END IF;
    END IF;

    INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
    VALUES (target_user_id, ROUND(v_paid + v_bonus, 2), p_reason, p_reference_id, v_site)
    RETURNING id INTO v_recharge_ledger_id;

    INSERT INTO public.points_balance (user_id, site, paid_balance, bonus_balance)
    VALUES (target_user_id, v_site, v_paid, v_bonus)
    ON CONFLICT (user_id, site)
    DO UPDATE SET
        paid_balance = ROUND(public.points_balance.paid_balance + EXCLUDED.paid_balance, 2),
        bonus_balance = ROUND(public.points_balance.bonus_balance + EXCLUDED.bonus_balance, 2),
        updated_at = NOW()
    RETURNING paid_balance, bonus_balance, total_balance INTO v_new_balance;

    v_source_type := public.fn_classify_wallet_point_lot_source(p_reason, p_reference_id, v_paid, v_bonus);
    IF v_paid > 0 THEN
        PERFORM public.fn_create_wallet_point_lot(
            target_user_id,
            v_site,
            v_source_type,
            p_reason,
            p_reference_id,
            v_paid,
            v_paid,
            'CNY',
            v_recharge_ledger_id,
            jsonb_build_object('component', 'paid')
        );
    END IF;
    IF v_bonus > 0 THEN
        PERFORM public.fn_create_wallet_point_lot(
            target_user_id,
            v_site,
            CASE WHEN v_source_type IN ('recharge', 'redemption_code') THEN 'activity_bonus' ELSE v_source_type END,
            p_reason,
            p_reference_id,
            v_bonus,
            0,
            'CNY',
            NULL,
            jsonb_build_object('component', 'bonus', 'source_ledger_id', v_recharge_ledger_id)
        );
    END IF;

    IF ROUND(v_paid + v_bonus, 2) > 0
       AND public.fn_is_affiliate_qualifying_recharge_reason(p_reason) THEN
        SELECT *
        INTO v_pending_reward
        FROM public.pending_referral_rewards
        WHERE invitee_id = target_user_id;

        IF FOUND THEN
            INSERT INTO public.points_balance (user_id, site, paid_balance, bonus_balance)
            VALUES (v_pending_reward.inviter_id, v_site, 0, ROUND(v_pending_reward.reward_points, 2))
            ON CONFLICT (user_id, site) DO UPDATE SET
                bonus_balance = ROUND(public.points_balance.bonus_balance + EXCLUDED.bonus_balance, 2),
                updated_at = NOW();

            INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
            VALUES (
                v_pending_reward.inviter_id,
                ROUND(v_pending_reward.reward_points, 2),
                '拉新固定奖励 (下线首充激活)',
                'REG_REWARD_UNLOCK_RECHARGE_' || v_recharge_ledger_id,
                v_site
            )
            RETURNING id INTO v_pending_reward_ledger_id;

            PERFORM public.fn_create_wallet_point_lot(
                v_pending_reward.inviter_id,
                v_site,
                'affiliate_commission',
                '拉新固定奖励 (下线首充激活)',
                'REG_REWARD_UNLOCK_RECHARGE_' || v_recharge_ledger_id,
                ROUND(v_pending_reward.reward_points, 2),
                0,
                'CNY',
                v_pending_reward_ledger_id,
                jsonb_build_object('invitee_id', target_user_id)
            );

            DELETE FROM public.pending_referral_rewards
            WHERE id = v_pending_reward.id;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'deduped', false,
        'ledger_id', v_recharge_ledger_id,
        'paid', v_new_balance.paid_balance,
        'bonus', v_new_balance.bonus_balance,
        'total', v_new_balance.total_balance
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_recharge_points(UUID, NUMERIC, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_recharge_points(UUID, NUMERIC, NUMERIC, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.fn_recharge_points(UUID, NUMERIC, NUMERIC, TEXT, TEXT, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_recharge_points(UUID, NUMERIC, NUMERIC, TEXT, TEXT, VARCHAR) TO service_role;
