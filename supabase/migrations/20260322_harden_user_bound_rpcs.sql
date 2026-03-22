-- ============================================
-- Harden user-bound RPCs against client-side user_id spoofing
-- 收紧用户侧 RPC：不再信任前端伪造的 p_user_id，并显式收口函数执行权限
-- ============================================

CREATE OR REPLACE FUNCTION public.get_user_permissions(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_role RECORD;
    v_request_user_id UUID := auth.uid();
    v_request_role TEXT := COALESCE(auth.role(), '');
    v_request_is_admin BOOLEAN := FALSE;
    v_effective_user_id UUID;
BEGIN
    IF v_request_role = 'service_role' THEN
        v_effective_user_id := COALESCE(p_user_id, v_request_user_id);
    ELSE
        IF v_request_user_id IS NULL THEN
            RAISE EXCEPTION 'auth required';
        END IF;

        v_request_is_admin := public.is_admin();
        IF p_user_id IS NOT NULL AND p_user_id <> v_request_user_id AND NOT v_request_is_admin THEN
            RAISE EXCEPTION 'Access denied';
        END IF;

        v_effective_user_id := COALESCE(p_user_id, v_request_user_id);
    END IF;

    IF v_effective_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id required';
    END IF;

    SELECT
        role_name,
        COALESCE(permissions, '[]'::jsonb) AS permissions,
        expires_at
    INTO v_role
    FROM public.admin_roles
    WHERE user_id = v_effective_user_id
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY
        CASE WHEN role_name = 'super_admin' THEN 0 ELSE 1 END,
        granted_at DESC NULLS LAST,
        created_at DESC NULLS LAST
    LIMIT 1;

    RETURN jsonb_build_object(
        'is_super_admin', COALESCE(v_role.role_name = 'super_admin' OR v_role.permissions @> jsonb_build_array('*'), FALSE),
        'is_admin', v_role.role_name IS NOT NULL,
        'role', v_role.role_name,
        'permissions', COALESCE(v_role.permissions, '[]'::jsonb),
        'expires_at', v_role.expires_at
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.fn_get_checkin_data(
    p_user_id UUID,
    p_site TEXT,
    p_year INT,
    p_month INT
) RETURNS JSONB AS $$
DECLARE
    v_start_date DATE;
    v_end_date DATE;
    v_checked_dates JSONB;
    v_consecutive_days INT := 0;
    v_check_date DATE;
    v_request_user_id UUID := auth.uid();
    v_request_role TEXT := COALESCE(auth.role(), '');
    v_effective_user_id UUID;
BEGIN
    IF v_request_role = 'service_role' THEN
        v_effective_user_id := COALESCE(p_user_id, v_request_user_id);
    ELSE
        IF v_request_user_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'message', '用户未登录');
        END IF;

        IF p_user_id IS NOT NULL AND p_user_id <> v_request_user_id THEN
            RAISE EXCEPTION 'Access denied';
        END IF;

        v_effective_user_id := v_request_user_id;
    END IF;

    IF v_effective_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '用户未登录');
    END IF;

    v_start_date := make_date(p_year, p_month, 1);
    v_end_date := (v_start_date + interval '1 month - 1 day')::DATE;

    SELECT COALESCE(jsonb_agg(to_char(check_date, 'YYYY-MM-DD')), '[]'::jsonb)
    INTO v_checked_dates
    FROM public.user_checkins
    WHERE user_id = v_effective_user_id
      AND site = p_site
      AND check_date BETWEEN v_start_date AND v_end_date;

    v_check_date := current_date;

    IF NOT EXISTS (SELECT 1 FROM public.user_checkins WHERE user_id = v_effective_user_id AND site = p_site AND check_date = v_check_date) THEN
        v_check_date := v_check_date - 1;
        IF NOT EXISTS (SELECT 1 FROM public.user_checkins WHERE user_id = v_effective_user_id AND site = p_site AND check_date = v_check_date) THEN
            v_consecutive_days := 0;
        END IF;
    END IF;

    IF v_consecutive_days IS NULL OR v_consecutive_days = 0 THEN
        IF EXISTS (SELECT 1 FROM public.user_checkins WHERE user_id = v_effective_user_id AND site = p_site AND check_date = v_check_date) THEN
            v_consecutive_days := 0;
            LOOP
                IF EXISTS (SELECT 1 FROM public.user_checkins WHERE user_id = v_effective_user_id AND site = p_site AND check_date = v_check_date) THEN
                    v_consecutive_days := v_consecutive_days + 1;
                    v_check_date := v_check_date - 1;
                ELSE
                    EXIT;
                END IF;
            END LOOP;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'checked_dates', v_checked_dates,
        'consecutive_days', v_consecutive_days,
        'current_date', to_char(current_date, 'YYYY-MM-DD')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.fn_daily_checkin_v2(
    p_user_id UUID,
    p_site TEXT DEFAULT 'cn'
) RETURNS JSONB AS $$
DECLARE
    v_reward NUMERIC(12,1) := 0;
    v_consecutive_bonus NUMERIC(12,1) := 0;
    v_perfect_bonus NUMERIC(12,1) := 0;
    v_total_reward NUMERIC(12,1) := 0;

    v_config JSONB;
    v_already_checked BOOLEAN := false;
    v_new_balance NUMERIC;

    v_consecutive_days INT := 1;
    v_check_date DATE := current_date - 1;

    v_days_in_month INT;
    v_checked_in_month INT;

    v_message TEXT := '签到成功';
    v_request_user_id UUID := auth.uid();
    v_request_role TEXT := COALESCE(auth.role(), '');
    v_effective_user_id UUID;
BEGIN
    IF v_request_role = 'service_role' THEN
        v_effective_user_id := COALESCE(p_user_id, v_request_user_id);
    ELSE
        IF v_request_user_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'message', '用户未登录');
        END IF;

        IF p_user_id IS NOT NULL AND p_user_id <> v_request_user_id THEN
            RAISE EXCEPTION 'Access denied';
        END IF;

        v_effective_user_id := v_request_user_id;
    END IF;

    IF v_effective_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '用户未登录');
    END IF;

    SELECT EXISTS(
        SELECT 1 FROM public.user_checkins
        WHERE user_id = v_effective_user_id AND site = p_site AND check_date = current_date
    ) INTO v_already_checked;

    IF v_already_checked THEN
        RETURN jsonb_build_object('success', false, 'already_checked', true, 'message', '今日已签到', 'points', 0);
    END IF;

    SELECT config_value INTO v_config FROM public.system_config WHERE config_key = 'checkin_system';
    v_reward := COALESCE((v_config->>'base_points')::NUMERIC(12,1), 5);
    v_consecutive_bonus := COALESCE((v_config->>'consecutive_7_points')::NUMERIC(12,1), 50);
    v_perfect_bonus := COALESCE((v_config->>'perfect_month_points')::NUMERIC(12,1), 200);

    LOOP
        IF EXISTS (SELECT 1 FROM public.user_checkins WHERE user_id = v_effective_user_id AND site = p_site AND check_date = v_check_date) THEN
            v_consecutive_days := v_consecutive_days + 1;
            v_check_date := v_check_date - 1;
        ELSE
            EXIT;
        END IF;
    END LOOP;

    v_total_reward := v_reward;

    IF v_consecutive_bonus > 0 AND v_consecutive_days % 7 = 0 THEN
        v_total_reward := v_total_reward + v_consecutive_bonus;
        v_message := '🎉 连续签到 ' || v_consecutive_days || ' 天，获得额外奖励！';
    END IF;

    INSERT INTO public.user_checkins (user_id, site, check_date)
    VALUES (v_effective_user_id, p_site, current_date);

    v_days_in_month := EXTRACT(DAY FROM (date_trunc('month', current_date) + interval '1 month - 1 day'));
    SELECT COUNT(*) INTO v_checked_in_month
    FROM public.user_checkins
    WHERE user_id = v_effective_user_id AND site = p_site AND date_trunc('month', check_date) = date_trunc('month', current_date);

    IF v_perfect_bonus > 0 AND v_checked_in_month = v_days_in_month THEN
        v_total_reward := v_total_reward + v_perfect_bonus;
        v_message := '🏆 恭喜达成全月全勤！获得巨额奖励！';
    END IF;

    IF v_total_reward > 0 THEN
        INSERT INTO public.points_balance (user_id, site, paid_balance, bonus_balance)
        VALUES (v_effective_user_id, p_site, 0, v_total_reward)
        ON CONFLICT (user_id, site) DO UPDATE SET
            bonus_balance = public.points_balance.bonus_balance + v_total_reward,
            updated_at = NOW();

        INSERT INTO public.points_ledger (user_id, site, amount, reason, reference_id)
        VALUES (v_effective_user_id, p_site, v_total_reward, 'daily_checkin', 'CHK_' || to_char(current_date, 'YYYYMMDD'));
    END IF;

    SELECT COALESCE(total_balance, 0)
    INTO v_new_balance
    FROM public.points_balance
    WHERE user_id = v_effective_user_id AND site = p_site;

    RETURN jsonb_build_object(
        'success', true,
        'message', v_message,
        'points', v_total_reward,
        'base_reward', v_reward,
        'bonus_reward', v_total_reward - v_reward,
        'consecutive_days', v_consecutive_days,
        'new_balance', v_new_balance
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.fn_makeup_checkin(
    p_user_id UUID,
    p_site TEXT,
    p_date DATE,
    p_method TEXT
) RETURNS JSONB AS $$
DECLARE
    v_config JSONB;
    v_cost NUMERIC(12,1) := 0;
    v_user_balance NUMERIC;
    v_new_balance NUMERIC;
    v_current_bonus NUMERIC(12,1) := 0;
    v_current_paid NUMERIC(12,1) := 0;
    v_deduct_bonus NUMERIC(12,1) := 0;
    v_deduct_paid NUMERIC(12,1) := 0;
    v_remaining_cost NUMERIC(12,1) := 0;
    v_request_user_id UUID := auth.uid();
    v_request_role TEXT := COALESCE(auth.role(), '');
    v_effective_user_id UUID;
BEGIN
    IF v_request_role = 'service_role' THEN
        v_effective_user_id := COALESCE(p_user_id, v_request_user_id);
    ELSE
        IF v_request_user_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'message', '用户未登录');
        END IF;

        IF p_user_id IS NOT NULL AND p_user_id <> v_request_user_id THEN
            RAISE EXCEPTION 'Access denied';
        END IF;

        v_effective_user_id := v_request_user_id;
    END IF;

    IF v_effective_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '用户未登录');
    END IF;

    IF p_date >= current_date THEN
        RETURN jsonb_build_object('success', false, 'message', '只能对过去的日期进行补签');
    END IF;

    IF EXISTS(SELECT 1 FROM public.user_checkins WHERE user_id = v_effective_user_id AND site = p_site AND check_date = p_date) THEN
        RETURN jsonb_build_object('success', false, 'message', '该日期已签到或已补签过');
    END IF;

    SELECT config_value INTO v_config FROM public.system_config WHERE config_key = 'checkin_system';

    IF p_method = 'points' THEN
        v_cost := COALESCE((v_config->>'makeup_cost_points')::NUMERIC(12,1), 10);

        IF v_cost > 0 THEN
            SELECT COALESCE(paid_balance, 0), COALESCE(bonus_balance, 0), COALESCE(total_balance, 0)
            INTO v_current_paid, v_current_bonus, v_user_balance
            FROM public.points_balance
            WHERE user_id = v_effective_user_id AND site = p_site
            FOR UPDATE;

            IF v_user_balance IS NULL OR v_user_balance < v_cost THEN
                RETURN jsonb_build_object('success', false, 'message', '积分不足，无法补签（需要 ' || v_cost || ' 积分）');
            END IF;

            v_remaining_cost := v_cost;
            v_deduct_bonus := LEAST(v_current_bonus, v_remaining_cost);
            v_remaining_cost := v_remaining_cost - v_deduct_bonus;
            v_deduct_paid := LEAST(v_current_paid, v_remaining_cost);

            IF (v_deduct_bonus + v_deduct_paid) < v_cost THEN
                RETURN jsonb_build_object('success', false, 'message', '积分不足，无法补签（需要 ' || v_cost || ' 积分）');
            END IF;

            UPDATE public.points_balance
            SET bonus_balance = bonus_balance - v_deduct_bonus,
                paid_balance = paid_balance - v_deduct_paid,
                updated_at = NOW()
            WHERE user_id = v_effective_user_id AND site = p_site;

            INSERT INTO public.points_ledger (user_id, site, amount, reason, reference_id)
            VALUES (v_effective_user_id, p_site, -v_cost, 'makeup_checkin_cost', 'MKP_COST_' || to_char(p_date, 'YYYYMMDD'));
        END IF;
    ELSIF p_method = 'comment' THEN
        RETURN jsonb_build_object('success', false, 'message', '通过评论补签功能暂未开启');
    ELSIF p_method = 'invite' THEN
        RETURN jsonb_build_object('success', false, 'message', '通过拉新补签功能暂未开启');
    ELSE
        RETURN jsonb_build_object('success', false, 'message', '未知的补签方式');
    END IF;

    INSERT INTO public.user_checkins (user_id, site, check_date, is_makeup, makeup_method)
    VALUES (v_effective_user_id, p_site, p_date, true, p_method);

    SELECT COALESCE((
        SELECT total_balance
        FROM public.points_balance
        WHERE user_id = v_effective_user_id AND site = p_site
    ), 0) INTO v_new_balance;

    RETURN jsonb_build_object(
        'success', true,
        'message', '补签成功',
        'cost', v_cost,
        'new_balance', v_new_balance
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.fn_get_affiliate_stats(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_invite_code TEXT;
    v_rate_shop FLOAT;
    v_rate_agent FLOAT;
    v_reg_reward NUMERIC(12,1);
    v_requires_purchase BOOLEAN;
    v_reward_notice TEXT;
    v_legal_disclaimer TEXT;
    v_affiliate_config JSONB;
    v_members JSONB := '[]'::JSONB;
    v_invited_count INT := 0;
    v_first_recharge_count INT := 0;
    v_consumed_count INT := 0;
    v_pending_reward_count INT := 0;
    v_total_order_commission NUMERIC(12,1) := 0;
    v_total_registration_rewards NUMERIC(12,1) := 0;
    v_total_rewards NUMERIC(12,1) := 0;
    v_total_invitee_spend NUMERIC(12,1) := 0;
    v_request_user_id UUID := auth.uid();
    v_request_role TEXT := COALESCE(auth.role(), '');
    v_request_is_admin BOOLEAN := FALSE;
    v_effective_user_id UUID;
BEGIN
    IF v_request_role = 'service_role' THEN
        v_effective_user_id := COALESCE(p_user_id, v_request_user_id);
    ELSE
        IF v_request_user_id IS NULL THEN
            RAISE EXCEPTION 'auth required';
        END IF;

        v_request_is_admin := public.is_admin();
        IF p_user_id IS NOT NULL AND p_user_id <> v_request_user_id AND NOT v_request_is_admin THEN
            RAISE EXCEPTION 'Access denied';
        END IF;

        v_effective_user_id := COALESCE(p_user_id, v_request_user_id);
    END IF;

    IF v_effective_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id required';
    END IF;

    SELECT COALESCE(invite_code, UPPER(SUBSTRING(v_effective_user_id::TEXT, 1, 8)))
    INTO v_invite_code
    FROM public.profiles
    WHERE id = v_effective_user_id;

    SELECT config_value INTO v_affiliate_config
    FROM public.system_config
    WHERE config_key = 'affiliate_program';

    v_rate_shop := COALESCE(
        (v_affiliate_config->>'commission_rate_shop')::FLOAT,
        (SELECT value::FLOAT FROM public.system_settings WHERE key = 'commission_rate_shop'),
        0.10
    );
    v_rate_agent := COALESCE(
        (v_affiliate_config->>'commission_rate_agent')::FLOAT,
        (SELECT value::FLOAT FROM public.system_settings WHERE key = 'commission_rate_agent'),
        0.10
    );
    v_reg_reward := COALESCE(
        (v_affiliate_config->>'registration_reward_points')::NUMERIC(12,1),
        (SELECT value::NUMERIC(12,1) FROM public.system_settings WHERE key = 'registration_reward_points'),
        0
    );
    v_requires_purchase := COALESCE(
        (v_affiliate_config->>'registration_reward_requires_purchase')::BOOLEAN,
        (SELECT value::BOOLEAN FROM public.system_settings WHERE key = 'registration_reward_requires_purchase'),
        true
    );
    v_reward_notice := COALESCE(
        NULLIF(v_affiliate_config->>'reward_notice', ''),
        '拉新固定奖励与持续返佣可叠加发放；异常流量、作弊注册、退款订单与刷单行为不计入奖励统计。'
    );
    v_legal_disclaimer := COALESCE(
        NULLIF(v_affiliate_config->>'legal_disclaimer', ''),
        '活动最终解释权归平台所有'
    );

    WITH invitees AS (
        SELECT
            p.id AS invitee_id,
            p.username,
            p.avatar_url,
            au.email,
            au.created_at AS registered_at
        FROM public.profiles p
        LEFT JOIN auth.users au ON au.id = p.id
        WHERE p.invited_by = v_effective_user_id
    ),
    recharge_events AS (
        SELECT
            pl.user_id AS invitee_id,
            MIN(pl.created_at) AS first_recharge_at
        FROM public.points_ledger pl
        JOIN invitees i ON i.invitee_id = pl.user_id
        WHERE COALESCE(pl.amount, 0) > 0
          AND public.fn_is_affiliate_qualifying_recharge_reason(pl.reason)
        GROUP BY pl.user_id
    ),
    purchase_events AS (
        SELECT
            so.user_id AS invitee_id,
            COUNT(*) FILTER (WHERE COALESCE(so.price_paid, so.total_price, 0) > 0) AS paid_order_count,
            MIN(so.created_at) FILTER (WHERE COALESCE(so.price_paid, so.total_price, 0) > 0) AS first_purchase_at,
            MAX(so.created_at) FILTER (WHERE COALESCE(so.price_paid, so.total_price, 0) > 0) AS last_order_at,
            COALESCE(SUM(COALESCE(so.price_paid, so.total_price, 0)) FILTER (WHERE COALESCE(so.price_paid, so.total_price, 0) > 0), 0)::NUMERIC(12,1) AS total_spend
        FROM public.shop_orders so
        JOIN invitees i ON i.invitee_id = so.user_id
        GROUP BY so.user_id
    ),
    last_purchase AS (
        SELECT DISTINCT ON (so.user_id)
            so.user_id AS invitee_id,
            so.id AS last_order_id,
            so.snapshot_product_name AS last_order_name,
            COALESCE(so.price_paid, so.total_price, 0)::NUMERIC(12,1) AS last_order_amount,
            so.created_at AS last_order_at
        FROM public.shop_orders so
        JOIN invitees i ON i.invitee_id = so.user_id
        WHERE COALESCE(so.price_paid, so.total_price, 0) > 0
        ORDER BY so.user_id, so.created_at DESC, so.id DESC
    ),
    commission_rewards AS (
        SELECT
            so.user_id AS invitee_id,
            COALESCE(SUM(pl.amount), 0)::NUMERIC(12,1) AS commission_earned
        FROM public.points_ledger pl
        JOIN public.shop_orders so
          ON so.id::TEXT = CASE
              WHEN pl.reference_id LIKE 'AFFILIATE_REWARD_%' THEN SUBSTRING(pl.reference_id FROM LENGTH('AFFILIATE_REWARD_') + 1)
              WHEN pl.reference_id LIKE 'AFF_REW_%' THEN SUBSTRING(pl.reference_id FROM LENGTH('AFF_REW_') + 1)
              ELSE NULL
          END
        WHERE pl.user_id = v_effective_user_id
          AND (
              pl.reference_id LIKE 'AFFILIATE_REWARD_%'
              OR pl.reference_id LIKE 'AFF_REW_%'
          )
        GROUP BY so.user_id
    ),
    direct_registration_rewards AS (
        SELECT
            SUBSTRING(pl.reference_id FROM LENGTH('REG_REWARD_') + 1)::UUID AS invitee_id,
            COALESCE(SUM(pl.amount), 0)::NUMERIC(12,1) AS granted_points
        FROM public.points_ledger pl
        WHERE pl.user_id = v_effective_user_id
          AND pl.reference_id ~ '^REG_REWARD_[0-9a-fA-F-]{36}$'
        GROUP BY 1
    ),
    purchase_unlocked_rewards AS (
        SELECT
            so.user_id AS invitee_id,
            COALESCE(SUM(pl.amount), 0)::NUMERIC(12,1) AS granted_points
        FROM public.points_ledger pl
        JOIN public.shop_orders so
          ON so.id::TEXT = SUBSTRING(pl.reference_id FROM LENGTH('REG_REWARD_UNLOCK_') + 1)
        WHERE pl.user_id = v_effective_user_id
          AND pl.reference_id LIKE 'REG_REWARD_UNLOCK_%'
          AND pl.reference_id NOT LIKE 'REG_REWARD_UNLOCK_RECHARGE_%'
        GROUP BY so.user_id
    ),
    recharge_unlocked_rewards AS (
        SELECT
            source_ledger.user_id AS invitee_id,
            COALESCE(SUM(pl.amount), 0)::NUMERIC(12,1) AS granted_points
        FROM public.points_ledger pl
        JOIN public.points_ledger source_ledger
          ON source_ledger.id::TEXT = SUBSTRING(pl.reference_id FROM LENGTH('REG_REWARD_UNLOCK_RECHARGE_') + 1)
        WHERE pl.user_id = v_effective_user_id
          AND pl.reference_id LIKE 'REG_REWARD_UNLOCK_RECHARGE_%'
        GROUP BY source_ledger.user_id
    ),
    pending_rewards AS (
        SELECT
            invitee_id,
            COALESCE(MAX(reward_points), 0)::NUMERIC(12,1) AS pending_points
        FROM public.pending_referral_rewards
        WHERE inviter_id = v_effective_user_id
        GROUP BY invitee_id
    ),
    member_rows AS (
        SELECT
            i.invitee_id,
            COALESCE(NULLIF(BTRIM(i.username), ''), NULLIF(split_part(COALESCE(i.email, ''), '@', 1), ''), '新用户') AS display_name,
            COALESCE(NULLIF(BTRIM(i.username), ''), '') AS username,
            public.fn_mask_affiliate_email(i.email) AS masked_email,
            i.avatar_url,
            i.registered_at,
            r.first_recharge_at,
            pe.first_purchase_at,
            pe.last_order_at,
            lp.last_order_id,
            lp.last_order_name,
            lp.last_order_amount,
            COALESCE(pe.paid_order_count, 0) AS paid_order_count,
            COALESCE(pe.total_spend, 0)::NUMERIC(12,1) AS total_spend,
            COALESCE(cr.commission_earned, 0)::NUMERIC(12,1) AS commission_earned,
            (
                COALESCE(drr.granted_points, 0)
                + COALESCE(pur.granted_points, 0)
                + COALESCE(rur.granted_points, 0)
            )::NUMERIC(12,1) AS registration_reward_granted,
            COALESCE(pr.pending_points, 0)::NUMERIC(12,1) AS registration_reward_pending
        FROM invitees i
        LEFT JOIN recharge_events r ON r.invitee_id = i.invitee_id
        LEFT JOIN purchase_events pe ON pe.invitee_id = i.invitee_id
        LEFT JOIN last_purchase lp ON lp.invitee_id = i.invitee_id
        LEFT JOIN commission_rewards cr ON cr.invitee_id = i.invitee_id
        LEFT JOIN direct_registration_rewards drr ON drr.invitee_id = i.invitee_id
        LEFT JOIN purchase_unlocked_rewards pur ON pur.invitee_id = i.invitee_id
        LEFT JOIN recharge_unlocked_rewards rur ON rur.invitee_id = i.invitee_id
        LEFT JOIN pending_rewards pr ON pr.invitee_id = i.invitee_id
    )
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE first_recharge_at IS NOT NULL),
        COUNT(*) FILTER (WHERE first_purchase_at IS NOT NULL),
        COUNT(*) FILTER (WHERE registration_reward_pending > 0 AND registration_reward_granted <= 0),
        COALESCE(SUM(commission_earned), 0)::NUMERIC(12,1),
        COALESCE(SUM(registration_reward_granted), 0)::NUMERIC(12,1),
        COALESCE(SUM(commission_earned + registration_reward_granted), 0)::NUMERIC(12,1),
        COALESCE(SUM(total_spend), 0)::NUMERIC(12,1),
        COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'user_id', invitee_id,
                    'display_name', display_name,
                    'username', username,
                    'masked_email', masked_email,
                    'avatar_url', avatar_url,
                    'registered_at', registered_at,
                    'first_recharge_at', first_recharge_at,
                    'first_purchase_at', first_purchase_at,
                    'last_order_at', last_order_at,
                    'last_order_id', last_order_id,
                    'last_order_name', last_order_name,
                    'last_order_amount', last_order_amount,
                    'paid_order_count', paid_order_count,
                    'total_spend', total_spend,
                    'commission_earned', commission_earned,
                    'registration_reward_granted', registration_reward_granted,
                    'registration_reward_pending', registration_reward_pending,
                    'total_rewards', (commission_earned + registration_reward_granted)::NUMERIC(12,1),
                    'current_stage', CASE
                        WHEN first_purchase_at IS NOT NULL THEN 'purchased'
                        WHEN first_recharge_at IS NOT NULL THEN 'recharged'
                        ELSE 'registered'
                    END,
                    'stage_step', CASE
                        WHEN first_purchase_at IS NOT NULL THEN 3
                        WHEN first_recharge_at IS NOT NULL THEN 2
                        ELSE 1
                    END,
                    'reward_status', CASE
                        WHEN registration_reward_granted > 0 THEN 'granted'
                        WHEN registration_reward_pending > 0 AND (first_recharge_at IS NOT NULL OR first_purchase_at IS NOT NULL) THEN 'processing'
                        WHEN registration_reward_pending > 0 THEN 'pending'
                        ELSE 'none'
                    END
                )
                ORDER BY COALESCE(last_order_at, first_recharge_at, registered_at) DESC NULLS LAST, registered_at DESC NULLS LAST
            ),
            '[]'::JSONB
        )
    INTO
        v_invited_count,
        v_first_recharge_count,
        v_consumed_count,
        v_pending_reward_count,
        v_total_order_commission,
        v_total_registration_rewards,
        v_total_rewards,
        v_total_invitee_spend,
        v_members
    FROM member_rows;

    RETURN jsonb_build_object(
        'invite_code', COALESCE(v_invite_code, UPPER(SUBSTRING(v_effective_user_id::TEXT, 1, 8))),
        'invited_count', COALESCE(v_invited_count, 0),
        'first_recharge_count', COALESCE(v_first_recharge_count, 0),
        'consumed_count', COALESCE(v_consumed_count, 0),
        'pending_reward_count', COALESCE(v_pending_reward_count, 0),
        'total_commission', COALESCE(v_total_rewards, 0),
        'total_order_commission', COALESCE(v_total_order_commission, 0),
        'total_registration_rewards', COALESCE(v_total_registration_rewards, 0),
        'total_rewards', COALESCE(v_total_rewards, 0),
        'total_invitee_spend', COALESCE(v_total_invitee_spend, 0),
        'commission_rate_shop', v_rate_shop,
        'commission_rate_agent', v_rate_agent,
        'registration_reward_points', v_reg_reward,
        'registration_reward_requires_purchase', v_requires_purchase,
        'reward_notice', v_reward_notice,
        'legal_disclaimer', v_legal_disclaimer,
        'members', COALESCE(v_members, '[]'::JSONB)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_get_affiliate_reward_detail(
    p_user_id UUID,
    p_ledger_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_entry RECORD;
    v_reward_type TEXT := 'affiliate_reward';
    v_reward_label TEXT := '推广奖励';
    v_source_kind TEXT := '';
    v_source_stage TEXT := '';
    v_invitee_id UUID;
    v_invitee_name TEXT;
    v_invitee_username TEXT;
    v_invitee_avatar_url TEXT;
    v_invitee_masked_email TEXT;
    v_invitee_registered_at TIMESTAMPTZ;
    v_source_order_id UUID;
    v_source_ledger_id UUID;
    v_source_reason TEXT;
    v_source_name TEXT;
    v_source_amount NUMERIC(12,1) := 0;
    v_source_created_at TIMESTAMPTZ;
    v_commission_rate NUMERIC(12,1);
    v_declared_commission_rate NUMERIC(12,1);
    v_expected_reward_amount NUMERIC(12,1);
    v_text_ref TEXT;
    v_affiliate_config JSONB;
    v_source_category TEXT;
    v_has_agent_profit BOOLEAN := false;
    v_is_agent_commission BOOLEAN := false;
    v_reason_declared_rate NUMERIC(12,1);
    v_request_user_id UUID := auth.uid();
    v_request_role TEXT := COALESCE(auth.role(), '');
    v_request_is_admin BOOLEAN := FALSE;
    v_effective_user_id UUID;
BEGIN
    IF v_request_role = 'service_role' THEN
        v_effective_user_id := COALESCE(p_user_id, v_request_user_id);
    ELSE
        IF v_request_user_id IS NULL THEN
            RAISE EXCEPTION 'auth required';
        END IF;

        v_request_is_admin := public.is_admin();
        IF p_user_id IS NOT NULL AND p_user_id <> v_request_user_id AND NOT v_request_is_admin THEN
            RAISE EXCEPTION 'Access denied';
        END IF;

        v_effective_user_id := COALESCE(p_user_id, v_request_user_id);
    END IF;

    IF v_effective_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id required';
    END IF;

    SELECT
        pl.id,
        pl.amount,
        pl.reason,
        pl.reference_id,
        pl.created_at
    INTO v_entry
    FROM public.points_ledger pl
    WHERE pl.id = p_ledger_id
      AND pl.user_id = v_effective_user_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('found', false);
    END IF;

    IF v_entry.reference_id LIKE 'AFFILIATE_REWARD_%' OR v_entry.reference_id LIKE 'AFF_REW_%' THEN
        v_reward_type := 'commission';
        v_reward_label := '推广返佣';
        v_source_kind := 'purchase';
        v_source_stage := '已消费';
        v_text_ref := CASE
            WHEN v_entry.reference_id LIKE 'AFFILIATE_REWARD_%' THEN SUBSTRING(v_entry.reference_id FROM LENGTH('AFFILIATE_REWARD_') + 1)
            ELSE SUBSTRING(v_entry.reference_id FROM LENGTH('AFF_REW_') + 1)
        END;
        IF v_text_ref ~ '^[0-9a-fA-F-]{36}$' THEN
            v_source_order_id := v_text_ref::UUID;
        END IF;

        SELECT
            so.user_id,
            COALESCE(NULLIF(BTRIM(p.username), ''), NULLIF(split_part(COALESCE(au.email, ''), '@', 1), ''), '新用户'),
            COALESCE(NULLIF(BTRIM(p.username), ''), ''),
            p.avatar_url,
            public.fn_mask_affiliate_email(au.email),
            au.created_at,
            so.snapshot_product_name,
            COALESCE(so.price_paid, so.total_price, 0)::NUMERIC(12,1),
            so.created_at,
            COALESCE(sp.category, '')
        INTO
            v_invitee_id,
            v_invitee_name,
            v_invitee_username,
            v_invitee_avatar_url,
            v_invitee_masked_email,
            v_invitee_registered_at,
            v_source_name,
            v_source_amount,
            v_source_created_at,
            v_source_category
        FROM public.shop_orders so
        LEFT JOIN public.shop_products sp ON sp.id = so.product_id
        LEFT JOIN public.profiles p ON p.id = so.user_id
        LEFT JOIN auth.users au ON au.id = so.user_id
        WHERE so.id = v_source_order_id;

        IF COALESCE(v_source_amount, 0) > 0 THEN
            v_commission_rate := ROUND((v_entry.amount / v_source_amount * 100)::NUMERIC, 1);
        END IF;

        BEGIN
            v_reason_declared_rate := NULLIF((regexp_match(v_entry.reason, '([0-9]+(?:\.[0-9]+)?)%'))[1], '')::NUMERIC;
        EXCEPTION WHEN OTHERS THEN
            v_reason_declared_rate := NULL;
        END;

        IF v_source_order_id IS NOT NULL THEN
            SELECT EXISTS (
                SELECT 1
                FROM public.points_ledger pl
                WHERE pl.reference_id = 'AGENT_PROF_' || v_source_order_id::TEXT
            ) INTO v_has_agent_profit;
        END IF;

        v_is_agent_commission := v_has_agent_profit OR COALESCE(v_source_category, '') = 'resource';

        SELECT config_value
        INTO v_affiliate_config
        FROM public.system_config
        WHERE config_key = 'affiliate_program';

        v_declared_commission_rate := CASE
            WHEN v_is_agent_commission THEN COALESCE((v_affiliate_config->>'commission_rate_agent')::NUMERIC, v_reason_declared_rate, v_commission_rate)
            ELSE COALESCE((v_affiliate_config->>'commission_rate_shop')::NUMERIC, v_reason_declared_rate, v_commission_rate)
        END;

        v_expected_reward_amount := CASE
            WHEN COALESCE(v_source_amount, 0) > 0 AND COALESCE(v_declared_commission_rate, 0) > 0
                THEN ROUND((v_source_amount * v_declared_commission_rate / 100.0)::NUMERIC, 1)
            ELSE NULL
        END;
    ELSIF v_entry.reference_id LIKE 'REG_REWARD_%' THEN
        v_reward_type := 'registration_reward';
        v_reward_label := '拉新固定奖励';
        v_source_kind := 'registration';
        v_source_stage := '已注册';

        IF v_entry.reference_id LIKE 'REG_REWARD_UNLOCK_RECHARGE_%' THEN
            v_text_ref := SUBSTRING(v_entry.reference_id FROM LENGTH('REG_REWARD_UNLOCK_RECHARGE_') + 1);
            IF v_text_ref ~ '^[0-9a-fA-F-]{36}$' THEN
                v_source_ledger_id := v_text_ref::UUID;
            END IF;

            SELECT
                pl.user_id,
                pl.reason,
                pl.amount,
                pl.created_at
            INTO
                v_invitee_id,
                v_source_reason,
                v_source_amount,
                v_source_created_at
            FROM public.points_ledger pl
            WHERE pl.id = v_source_ledger_id;

            v_source_kind := 'recharge';
            v_source_stage := '已首充';
            v_source_name := COALESCE(NULLIF(BTRIM(v_source_reason), ''), '首充入账');
        ELSIF v_entry.reference_id LIKE 'REG_REWARD_UNLOCK_%' THEN
            v_text_ref := SUBSTRING(v_entry.reference_id FROM LENGTH('REG_REWARD_UNLOCK_') + 1);
            IF v_text_ref ~ '^[0-9a-fA-F-]{36}$' THEN
                v_source_order_id := v_text_ref::UUID;
            END IF;

            SELECT
                so.user_id,
                so.snapshot_product_name,
                COALESCE(so.price_paid, so.total_price, 0)::NUMERIC(12,1),
                so.created_at
            INTO
                v_invitee_id,
                v_source_name,
                v_source_amount,
                v_source_created_at
            FROM public.shop_orders so
            WHERE so.id = v_source_order_id;

            v_source_kind := 'purchase';
            v_source_stage := '已消费';
        ELSE
            v_text_ref := SUBSTRING(v_entry.reference_id FROM LENGTH('REG_REWARD_') + 1);
            IF v_text_ref ~ '^[0-9a-fA-F-]{36}$' THEN
                v_invitee_id := v_text_ref::UUID;
            END IF;
        END IF;

        IF v_invitee_id IS NOT NULL THEN
            SELECT
                COALESCE(NULLIF(BTRIM(p.username), ''), NULLIF(split_part(COALESCE(au.email, ''), '@', 1), ''), '新用户'),
                COALESCE(NULLIF(BTRIM(p.username), ''), ''),
                p.avatar_url,
                public.fn_mask_affiliate_email(au.email),
                au.created_at
            INTO
                v_invitee_name,
                v_invitee_username,
                v_invitee_avatar_url,
                v_invitee_masked_email,
                v_invitee_registered_at
            FROM public.profiles p
            LEFT JOIN auth.users au ON au.id = p.id
            WHERE p.id = v_invitee_id;
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'found', true,
        'ledger_id', v_entry.id,
        'reward_type', v_reward_type,
        'reward_label', v_reward_label,
        'reward_amount', COALESCE(v_entry.amount, 0),
        'reward_reason', v_entry.reason,
        'reward_created_at', v_entry.created_at,
        'reference_id', v_entry.reference_id,
        'invitee_id', v_invitee_id,
        'invitee_name', v_invitee_name,
        'invitee_username', v_invitee_username,
        'invitee_avatar_url', v_invitee_avatar_url,
        'invitee_masked_email', v_invitee_masked_email,
        'invitee_registered_at', v_invitee_registered_at,
        'source_kind', v_source_kind,
        'source_stage', v_source_stage,
        'source_order_id', v_source_order_id,
        'source_ledger_id', v_source_ledger_id,
        'source_name', v_source_name,
        'source_amount', v_source_amount,
        'source_reason', v_source_reason,
        'source_created_at', v_source_created_at,
        'commission_rate', v_commission_rate,
        'declared_commission_rate', v_declared_commission_rate,
        'expected_reward_amount', v_expected_reward_amount,
        'is_agent_commission', v_is_agent_commission
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_load_guestbook(
    p_site TEXT DEFAULT 'cn',
    p_limit INT DEFAULT 50,
    p_user_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    result JSON;
    v_request_user_id UUID := auth.uid();
    v_request_role TEXT := COALESCE(auth.role(), '');
    v_effective_user_id UUID := NULL;
    v_request_is_admin BOOLEAN := FALSE;
BEGIN
    IF v_request_role = 'service_role' THEN
        v_effective_user_id := COALESCE(p_user_id, v_request_user_id);
    ELSIF v_request_user_id IS NOT NULL THEN
        BEGIN
            v_request_is_admin := public.is_admin();
        EXCEPTION WHEN OTHERS THEN
            v_request_is_admin := FALSE;
        END;

        IF v_request_is_admin AND p_user_id IS NOT NULL THEN
            v_effective_user_id := p_user_id;
        ELSE
            v_effective_user_id := v_request_user_id;
        END IF;
    END IF;

    SELECT json_build_object(
        'messages', (
            SELECT COALESCE(json_agg(msg_row ORDER BY msg_row.created_at DESC), '[]'::json)
            FROM (
                SELECT
                    m.id,
                    m.content,
                    m.image_url,
                    m.like_count,
                    m.created_at,
                    m.user_id,
                    json_build_object(
                        'id', p.id,
                        'username', COALESCE(p.username, 'Anonymous'),
                        'avatar_url', p.avatar_url
                    ) AS profiles
                FROM public.guestbook_messages m
                LEFT JOIN public.profiles p ON p.id = m.user_id
                WHERE m.site = p_site
                ORDER BY m.created_at DESC
                LIMIT p_limit
            ) msg_row
        ),
        'comments', (
            SELECT COALESCE(json_agg(cmt_row ORDER BY cmt_row.created_at ASC), '[]'::json)
            FROM (
                SELECT
                    c.id,
                    c.message_id,
                    c.parent_id,
                    c.content,
                    c.created_at,
                    c.user_id,
                    json_build_object(
                        'id', cp.id,
                        'username', COALESCE(cp.username, 'Anonymous'),
                        'avatar_url', cp.avatar_url
                    ) AS profiles,
                    COALESCE(lk.like_count, 0) AS like_count
                FROM public.guestbook_comments c
                LEFT JOIN public.profiles cp ON cp.id = c.user_id
                LEFT JOIN (
                    SELECT target_id, COUNT(*) AS like_count
                    FROM public.guestbook_likes
                    WHERE target_type = 'comment'
                    GROUP BY target_id
                ) lk ON lk.target_id = c.id
                WHERE c.message_id IN (
                    SELECT id FROM public.guestbook_messages
                    WHERE site = p_site
                    ORDER BY created_at DESC
                    LIMIT p_limit
                )
                ORDER BY c.created_at ASC
            ) cmt_row
        ),
        'user_likes', (
            SELECT COALESCE(json_agg(json_build_object(
                'target_type', gl.target_type,
                'target_id', gl.target_id
            )), '[]'::json)
            FROM public.guestbook_likes gl
            WHERE gl.user_id = v_effective_user_id
              AND v_effective_user_id IS NOT NULL
        )
    ) INTO result;

    RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_permissions(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_permissions(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_get_checkin_data(UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_checkin_data(UUID, TEXT, INTEGER, INTEGER) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_daily_checkin_v2(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_daily_checkin_v2(UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_makeup_checkin(UUID, TEXT, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_makeup_checkin(UUID, TEXT, DATE, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_get_affiliate_stats(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_affiliate_stats(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_get_affiliate_reward_detail(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_affiliate_reward_detail(UUID, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_load_guestbook(TEXT, INTEGER, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_load_guestbook(TEXT, INTEGER, UUID) TO anon, authenticated, service_role;
