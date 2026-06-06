-- Wire point-source lots into positive point inflows.
-- This preserves existing balance/ledger behavior while creating durable lots
-- for recharge, redemption-code, refund-return, admin-grant, and affiliate
-- reward sources.

CREATE OR REPLACE FUNCTION public.fn_classify_wallet_point_lot_source(
    p_reason TEXT,
    p_reference_id TEXT,
    p_paid NUMERIC DEFAULT 0,
    p_bonus NUMERIC DEFAULT 0
)
RETURNS VARCHAR
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_reason TEXT := LOWER(COALESCE(p_reason, ''));
    v_reference TEXT := UPPER(COALESCE(p_reference_id, ''));
BEGIN
    IF v_reference LIKE 'REFUND_%' OR v_reason LIKE '%退款%' THEN
        RETURN 'refund_return';
    ELSIF v_reference LIKE 'REDEEM_%' OR v_reason LIKE '%兑换码%' THEN
        RETURN 'redemption_code';
    ELSIF v_reference LIKE 'REG_REWARD_%' OR v_reason LIKE '%拉新%' OR v_reason LIKE '%邀请%' THEN
        RETURN 'affiliate_commission';
    ELSIF v_reason LIKE '%签到%' THEN
        RETURN 'checkin';
    ELSIF v_reason LIKE '%活动%' OR v_reason LIKE '%赠送%' OR v_reason LIKE '%奖励%' THEN
        RETURN 'activity_bonus';
    ELSIF v_reason LIKE '%管理员%' OR v_reason LIKE '%admin%' THEN
        RETURN 'admin_grant';
    ELSIF COALESCE(p_paid, 0) > 0 THEN
        RETURN 'recharge';
    ELSIF COALESCE(p_bonus, 0) > 0 THEN
        RETURN 'activity_bonus';
    END IF;

    RETURN 'unknown';
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_create_wallet_point_lot(
    p_user_id UUID,
    p_site VARCHAR,
    p_source_type VARCHAR,
    p_source_label TEXT,
    p_source_reference_id TEXT,
    p_points NUMERIC,
    p_cash_value_cny NUMERIC,
    p_currency VARCHAR DEFAULT 'CNY',
    p_source_ledger_id UUID DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_points NUMERIC(14,2) := ROUND(GREATEST(COALESCE(p_points, 0), 0), 2);
    v_cash NUMERIC(14,4) := ROUND(GREATEST(COALESCE(p_cash_value_cny, 0), 0), 4);
    v_site VARCHAR(16) := COALESCE(NULLIF(BTRIM(p_site), ''), 'cn');
    v_source_type VARCHAR(40) := COALESCE(NULLIF(BTRIM(p_source_type), ''), 'unknown');
    v_lot_id UUID;
BEGIN
    IF COALESCE(auth.role(), '') NOT IN ('service_role', 'authenticated') THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'p_user_id is required';
    END IF;

    IF v_points <= 0 THEN
        RETURN NULL;
    END IF;

    IF v_source_type NOT IN (
        'recharge',
        'redemption_code',
        'checkin',
        'activity_bonus',
        'admin_grant',
        'affiliate_commission',
        'refund_return',
        'migration',
        'unknown'
    ) THEN
        v_source_type := 'unknown';
    END IF;

    INSERT INTO public.wallet_point_lots (
        user_id,
        site,
        source_type,
        source_label,
        source_reference_id,
        points_original,
        points_remaining,
        cash_value_cny,
        cash_value_rate,
        currency,
        source_ledger_id,
        metadata
    )
    VALUES (
        p_user_id,
        v_site,
        v_source_type,
        NULLIF(BTRIM(COALESCE(p_source_label, '')), ''),
        NULLIF(BTRIM(COALESCE(p_source_reference_id, '')), ''),
        v_points,
        v_points,
        v_cash,
        CASE WHEN v_points > 0 THEN ROUND(v_cash / v_points, 6) ELSE 0 END,
        COALESCE(NULLIF(BTRIM(p_currency), ''), 'CNY'),
        p_source_ledger_id,
        COALESCE(p_metadata, '{}'::JSONB)
    )
    ON CONFLICT (source_ledger_id)
    WHERE source_ledger_id IS NOT NULL
    DO UPDATE SET
        source_type = EXCLUDED.source_type,
        source_label = EXCLUDED.source_label,
        source_reference_id = EXCLUDED.source_reference_id,
        points_original = EXCLUDED.points_original,
        points_remaining = GREATEST(public.wallet_point_lots.points_remaining, EXCLUDED.points_remaining),
        cash_value_cny = EXCLUDED.cash_value_cny,
        cash_value_rate = EXCLUDED.cash_value_rate,
        currency = EXCLUDED.currency,
        metadata = public.wallet_point_lots.metadata || EXCLUDED.metadata,
        updated_at = NOW()
    RETURNING id INTO v_lot_id;

    RETURN v_lot_id;
END;
$$;

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
        'paid', v_new_balance.paid_balance,
        'bonus', v_new_balance.bonus_balance,
        'total', v_new_balance.total_balance
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_redeem_code(
    p_code VARCHAR,
    p_site VARCHAR DEFAULT 'cn'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_code_record RECORD;
    v_batch_expires_at TIMESTAMPTZ;
    v_package RECORD;
    v_points_amount NUMERIC(12,2);
    v_package_name TEXT;
    v_effective_expires_at TIMESTAMPTZ;
    v_site VARCHAR := COALESCE(NULLIF(BTRIM(p_site), ''), 'cn');
    v_redeem_ledger_id UUID;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'auth required';
    END IF;

    p_code := UPPER(TRIM(COALESCE(p_code, '')));

    IF p_code = '' THEN
        RETURN json_build_object('success', false, 'message', '兑换码不能为空');
    END IF;

    SELECT *
    INTO v_code_record
    FROM public.redemption_codes
    WHERE code = p_code
    FOR UPDATE;

    IF v_code_record IS NULL THEN
        RETURN json_build_object('success', false, 'message', '无效的兑换码');
    END IF;

    IF v_code_record.status = 'used' THEN
        RETURN json_build_object('success', false, 'message', '该兑换码已被使用');
    ELSIF v_code_record.status = 'revoked' THEN
        RETURN json_build_object('success', false, 'message', '该兑换码已被撤销');
    ELSIF v_code_record.status = 'locked' THEN
        RETURN json_build_object('success', false, 'message', '该兑换码已被锁定');
    ELSIF v_code_record.status = 'disabled' THEN
        RETURN json_build_object('success', false, 'message', '该兑换码已被禁用');
    END IF;

    SELECT expires_at
    INTO v_batch_expires_at
    FROM public.redemption_batches
    WHERE id = v_code_record.batch_id;

    v_effective_expires_at := COALESCE(v_code_record.expires_at, v_batch_expires_at);

    IF v_effective_expires_at IS NOT NULL AND v_effective_expires_at < NOW() THEN
        RETURN json_build_object('success', false, 'message', '该兑换码已过期');
    END IF;

    SELECT *
    INTO v_package
    FROM public.points_packages
    WHERE id = v_code_record.package_id;

    IF v_package IS NULL THEN
        IF COALESCE(v_code_record.points_amount, 0) > 0 THEN
            v_points_amount := ROUND(v_code_record.points_amount, 2);
            v_package_name := '自定义积分';
        ELSE
            RETURN json_build_object('success', false, 'message', '关联的套餐不存在');
        END IF;
    ELSE
        v_points_amount := ROUND(COALESCE(v_package.points_amount, 0) + COALESCE(v_package.bonus_points, 0), 2);
        v_package_name := v_package.name;
    END IF;

    INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
    VALUES (
        v_user_id,
        v_points_amount,
        '兑换码充值: ' || v_package_name,
        'redeem_' || p_code,
        v_site
    )
    RETURNING id INTO v_redeem_ledger_id;

    INSERT INTO public.points_balance (user_id, site, paid_balance, bonus_balance)
    VALUES (v_user_id, v_site, v_points_amount, 0)
    ON CONFLICT (user_id, site)
    DO UPDATE SET
        paid_balance = ROUND(public.points_balance.paid_balance + EXCLUDED.paid_balance, 2),
        updated_at = NOW(),
        version = public.points_balance.version + 1;

    PERFORM public.fn_create_wallet_point_lot(
        v_user_id,
        v_site,
        'redemption_code',
        '兑换码充值: ' || v_package_name,
        'redeem_' || p_code,
        v_points_amount,
        v_points_amount,
        'CNY',
        v_redeem_ledger_id,
        jsonb_build_object('code', p_code, 'package_id', v_code_record.package_id)
    );

    UPDATE public.redemption_codes
    SET status = 'used',
        used_by = v_user_id,
        used_at = NOW(),
        points_granted = v_points_amount
    WHERE id = v_code_record.id;

    RETURN json_build_object(
        'success', true,
        'message', '兑换成功！',
        'points', v_points_amount,
        'package_name', v_package_name
    );
END;
$$;

DROP FUNCTION IF EXISTS public.fn_redeem_code(VARCHAR);

REVOKE ALL ON FUNCTION public.fn_classify_wallet_point_lot_source(TEXT, TEXT, NUMERIC, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_classify_wallet_point_lot_source(TEXT, TEXT, NUMERIC, NUMERIC) TO service_role;

REVOKE ALL ON FUNCTION public.fn_create_wallet_point_lot(UUID, VARCHAR, VARCHAR, TEXT, TEXT, NUMERIC, NUMERIC, VARCHAR, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_create_wallet_point_lot(UUID, VARCHAR, VARCHAR, TEXT, TEXT, NUMERIC, NUMERIC, VARCHAR, UUID, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.fn_recharge_points(UUID, NUMERIC, NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_recharge_points(UUID, NUMERIC, NUMERIC, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.fn_recharge_points(UUID, NUMERIC, NUMERIC, TEXT, TEXT, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_recharge_points(UUID, NUMERIC, NUMERIC, TEXT, TEXT, VARCHAR) TO service_role;

REVOKE ALL ON FUNCTION public.fn_redeem_code(VARCHAR, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_redeem_code(VARCHAR, VARCHAR) TO authenticated;
