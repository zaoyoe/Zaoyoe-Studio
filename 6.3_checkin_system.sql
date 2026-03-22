-- ============================================
-- 6.3 签到系统核心 (Check-in System Core)
-- 包含：独立的签到记录表、当月查询、签到 V2(带全勤/连续奖励)、补签功能
-- ============================================

-- 1. 创建签到记录表
CREATE TABLE IF NOT EXISTS public.user_checkins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    site TEXT NOT NULL DEFAULT 'cn',
    check_date DATE NOT NULL,
    is_makeup BOOLEAN DEFAULT false,
    makeup_method VARCHAR(50), -- null, 'points', 'comment', 'invite'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, site, check_date)
);

CREATE INDEX IF NOT EXISTS idx_user_checkins_user_date ON user_checkins(user_id, site, check_date);

ALTER TABLE public.user_checkins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own checkins" ON public.user_checkins;
CREATE POLICY "Users can view their own checkins" ON public.user_checkins
    FOR SELECT USING (auth.uid() = user_id);

-- 2. 查询用户某月签到数据及连续签到天数
CREATE OR REPLACE FUNCTION fn_get_checkin_data(
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
BEGIN
    IF p_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '用户未登录');
    END IF;

    v_start_date := make_date(p_year, p_month, 1);
    v_end_date := (v_start_date + interval '1 month - 1 day')::DATE;

    -- 获取当月所有签到记录 (格式: ["2026-03-01", "2026-03-02"])
    SELECT COALESCE(jsonb_agg(to_char(check_date, 'YYYY-MM-DD')), '[]'::jsonb)
    INTO v_checked_dates
    FROM public.user_checkins
    WHERE user_id = p_user_id 
      AND site = p_site
      AND check_date BETWEEN v_start_date AND v_end_date;

    -- 计算当前最大连续签到天数 (倒推法)
    -- 从今天(如果已签到)或昨天开始往前推，只要连续就 +1
    v_check_date := current_date;
    
    -- 先看看今天签了没，没签的话，看看昨天签了没
    IF NOT EXISTS (SELECT 1 FROM user_checkins WHERE user_id = p_user_id AND site = p_site AND check_date = v_check_date) THEN
        v_check_date := v_check_date - 1;
        IF NOT EXISTS (SELECT 1 FROM user_checkins WHERE user_id = p_user_id AND site = p_site AND check_date = v_check_date) THEN
            v_consecutive_days := 0;
        END IF;
    END IF;

    -- 如果起点在连续状态，开始往历史追溯
    IF v_consecutive_days IS NULL OR v_consecutive_days = 0 THEN
        -- check again to define loop condition
        IF EXISTS (SELECT 1 FROM user_checkins WHERE user_id = p_user_id AND site = p_site AND check_date = v_check_date) THEN
            v_consecutive_days := 0;
            LOOP
                IF EXISTS (SELECT 1 FROM user_checkins WHERE user_id = p_user_id AND site = p_site AND check_date = v_check_date) THEN
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- Security Hardening Override
-- 绑定签到/补签到当前登录用户，防止抓包伪造 p_user_id
-- ============================================

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

    IF p_date >= current_date THEN RETURN jsonb_build_object('success', false, 'message', '只能对过去的日期进行补签'); END IF;
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

REVOKE ALL ON FUNCTION public.fn_get_checkin_data(UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_get_checkin_data(UUID, TEXT, INTEGER, INTEGER) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_daily_checkin_v2(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_daily_checkin_v2(UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_makeup_checkin(UUID, TEXT, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_makeup_checkin(UUID, TEXT, DATE, TEXT) TO authenticated, service_role;


-- 3. 全新签到逻辑 (包含自动识别连续签到和全勤奖励)
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


-- 4. 补签逻辑
CREATE OR REPLACE FUNCTION public.fn_makeup_checkin(
    p_user_id UUID,
    p_site TEXT,
    p_date DATE,
    p_method TEXT -- 'points', 'comment', 'invite'
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

    IF p_date >= current_date THEN RETURN jsonb_build_object('success', false, 'message', '只能对过去的日期进行补签'); END IF;
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
