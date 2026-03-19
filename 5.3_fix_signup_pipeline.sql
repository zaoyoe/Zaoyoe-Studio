-- ============================================
-- 注册链路兜底热修复
-- 目标：
-- 1. 修复推广链接注册导致的 profile/奖励触发器报错
-- 2. 修复注册送积分触发器与历史 points schema 不兼容导致的注册失败
-- 3. 尽量兼容 profiles / points_* 表的历史版本差异
-- ============================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS invite_code VARCHAR(20);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES public.profiles(id);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS registration_ip VARCHAR(100);

UPDATE public.profiles
SET invite_code = UPPER(SUBSTRING(REPLACE(id::text, '-', ''), 1, 8))
WHERE invite_code IS NULL OR BTRIM(invite_code) = '';

CREATE TABLE IF NOT EXISTS public.system_settings (
    key VARCHAR(50) PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID
);

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read system settings" ON public.system_settings;
CREATE POLICY "Anyone can read system settings" ON public.system_settings FOR SELECT USING (true);

INSERT INTO public.system_settings (key, value, description) VALUES
('commission_rate_shop', '0.10', '商城消费返佣比例'),
('commission_rate_agent', '0.10', '分销商资源购买返佣比例'),
('registration_reward_points', '0', '拉新注册固定奖励积分'),
('registration_reward_requires_purchase', 'true', '拉新奖励是否需要首单激活')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.pending_referral_rewards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inviter_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    invitee_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    reward_points NUMERIC(12,1) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(invitee_id)
);

ALTER TABLE public.pending_referral_rewards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own pending rewards" ON public.pending_referral_rewards;
CREATE POLICY "Users can read own pending rewards" ON public.pending_referral_rewards FOR SELECT USING (
    auth.uid() = inviter_id OR auth.uid() = invitee_id
);

CREATE OR REPLACE FUNCTION public.fn_table_has_column(
    p_schema TEXT,
    p_table TEXT,
    p_column TEXT
) RETURNS BOOLEAN AS $$
DECLARE
    v_exists BOOLEAN := false;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = p_schema
          AND table_name = p_table
          AND column_name = p_column
    ) INTO v_exists;

    RETURN v_exists;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION public.fn_safe_add_bonus_balance(
    p_user_id UUID,
    p_bonus NUMERIC,
    p_site TEXT DEFAULT 'cn'
) RETURNS VOID AS $$
DECLARE
    v_has_site BOOLEAN := false;
BEGIN
    IF p_bonus IS NULL OR p_bonus = 0 OR to_regclass('public.points_balance') IS NULL THEN
        RETURN;
    END IF;

    v_has_site := public.fn_table_has_column('public', 'points_balance', 'site');

    IF v_has_site THEN
        EXECUTE '
            INSERT INTO public.points_balance (user_id, site, paid_balance, bonus_balance)
            VALUES ($1, $2, 0, $3)
            ON CONFLICT (user_id, site) DO UPDATE SET
                bonus_balance = COALESCE(public.points_balance.bonus_balance, 0) + EXCLUDED.bonus_balance,
                updated_at = NOW()
        '
        USING p_user_id, p_site, p_bonus;
    ELSE
        EXECUTE '
            INSERT INTO public.points_balance (user_id, paid_balance, bonus_balance)
            VALUES ($1, 0, $2)
            ON CONFLICT (user_id) DO UPDATE SET
                bonus_balance = COALESCE(public.points_balance.bonus_balance, 0) + EXCLUDED.bonus_balance,
                updated_at = NOW()
        '
        USING p_user_id, p_bonus;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[SignupHotfix] Skip points_balance update for user %: %', p_user_id, SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.fn_safe_insert_reason_ledger(
    p_user_id UUID,
    p_amount NUMERIC,
    p_reason TEXT,
    p_reference_id TEXT DEFAULT NULL,
    p_site TEXT DEFAULT 'cn'
) RETURNS VOID AS $$
DECLARE
    v_has_reason BOOLEAN := false;
    v_has_reference_id BOOLEAN := false;
    v_has_site BOOLEAN := false;
BEGIN
    IF to_regclass('public.points_ledger') IS NULL THEN
        RETURN;
    END IF;

    v_has_reason := public.fn_table_has_column('public', 'points_ledger', 'reason');
    v_has_reference_id := public.fn_table_has_column('public', 'points_ledger', 'reference_id');
    v_has_site := public.fn_table_has_column('public', 'points_ledger', 'site');

    IF NOT v_has_reason THEN
        RETURN;
    END IF;

    IF v_has_site AND v_has_reference_id THEN
        EXECUTE '
            INSERT INTO public.points_ledger (user_id, site, amount, reason, reference_id)
            VALUES ($1, $2, $3, $4, $5)
        '
        USING p_user_id, p_site, p_amount, p_reason, p_reference_id;
    ELSIF v_has_site THEN
        EXECUTE '
            INSERT INTO public.points_ledger (user_id, site, amount, reason)
            VALUES ($1, $2, $3, $4)
        '
        USING p_user_id, p_site, p_amount, p_reason;
    ELSIF v_has_reference_id THEN
        EXECUTE '
            INSERT INTO public.points_ledger (user_id, amount, reason, reference_id)
            VALUES ($1, $2, $3, $4)
        '
        USING p_user_id, p_amount, p_reason, p_reference_id;
    ELSE
        EXECUTE '
            INSERT INTO public.points_ledger (user_id, amount, reason)
            VALUES ($1, $2, $3)
        '
        USING p_user_id, p_amount, p_reason;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[SignupHotfix] Skip points_ledger insert for user %: %', p_user_id, SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.fn_generate_invite_code()
RETURNS TRIGGER AS $$
DECLARE
    v_client_ip TEXT;
    v_candidate TEXT;
    v_len INT := 8;
BEGIN
    IF NEW.invite_code IS NULL OR BTRIM(NEW.invite_code) = '' THEN
        LOOP
            v_candidate := UPPER(SUBSTRING(REPLACE(NEW.id::text, '-', ''), 1, v_len));
            EXIT WHEN NOT EXISTS (
                SELECT 1
                FROM public.profiles
                WHERE invite_code = v_candidate
                  AND id <> NEW.id
            );
            v_len := LEAST(v_len + 2, 20);
            EXIT WHEN v_len >= 20;
        END LOOP;

        NEW.invite_code := v_candidate;
    END IF;

    BEGIN
        v_client_ip := current_setting('request.headers', true)::jsonb->>'x-forwarded-for';
        IF v_client_ip IS NOT NULL AND BTRIM(v_client_ip) <> '' THEN
            v_client_ip := split_part(v_client_ip, ',', 1);
            NEW.registration_ip := NULLIF(BTRIM(v_client_ip), '');
        END IF;
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    v_username TEXT;
    v_fallback_username TEXT;
    v_avatar_url TEXT;
    v_invite_code TEXT;
    v_invited_by UUID := NULL;
    v_has_invited_by BOOLEAN := false;
    v_has_email BOOLEAN := false;
BEGIN
    v_username := COALESCE(
        NULLIF(BTRIM(NEW.raw_user_meta_data->>'full_name'), ''),
        NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
        'user'
    );

    IF char_length(v_username) < 3 THEN
        v_username := v_username || repeat('_', 3 - char_length(v_username));
    END IF;

    v_fallback_username := LEFT(
        COALESCE(NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''), 'user'),
        24
    ) || '_' || LEFT(REPLACE(NEW.id::text, '-', ''), 6);

    IF char_length(v_fallback_username) < 3 THEN
        v_fallback_username := v_fallback_username || repeat('_', 3 - char_length(v_fallback_username));
    END IF;

    v_avatar_url := NULLIF(BTRIM(NEW.raw_user_meta_data->>'avatar_url'), '');
    v_invite_code := NULLIF(UPPER(BTRIM(NEW.raw_user_meta_data->>'invite_code')), '');

    v_has_invited_by := public.fn_table_has_column('public', 'profiles', 'invited_by')
        AND public.fn_table_has_column('public', 'profiles', 'invite_code');
    v_has_email := public.fn_table_has_column('public', 'profiles', 'email');

    IF v_has_invited_by AND v_invite_code IS NOT NULL THEN
        SELECT id INTO v_invited_by
        FROM public.profiles
        WHERE invite_code = v_invite_code
        LIMIT 1;
    END IF;

    BEGIN
        IF v_has_invited_by AND v_has_email THEN
            EXECUTE '
                INSERT INTO public.profiles (id, username, avatar_url, invited_by, email)
                VALUES ($1, $2, $3, $4, $5)
            '
            USING NEW.id, v_username, v_avatar_url, v_invited_by, NEW.email;
        ELSIF v_has_invited_by THEN
            EXECUTE '
                INSERT INTO public.profiles (id, username, avatar_url, invited_by)
                VALUES ($1, $2, $3, $4)
            '
            USING NEW.id, v_username, v_avatar_url, v_invited_by;
        ELSIF v_has_email THEN
            EXECUTE '
                INSERT INTO public.profiles (id, username, avatar_url, email)
                VALUES ($1, $2, $3, $4)
            '
            USING NEW.id, v_username, v_avatar_url, NEW.email;
        ELSE
            INSERT INTO public.profiles (id, username, avatar_url)
            VALUES (NEW.id, v_username, v_avatar_url);
        END IF;
    EXCEPTION WHEN unique_violation THEN
        IF v_has_invited_by AND v_has_email THEN
            EXECUTE '
                INSERT INTO public.profiles (id, username, avatar_url, invited_by, email)
                VALUES ($1, $2, $3, $4, $5)
            '
            USING NEW.id, v_fallback_username, v_avatar_url, v_invited_by, NEW.email;
        ELSIF v_has_invited_by THEN
            EXECUTE '
                INSERT INTO public.profiles (id, username, avatar_url, invited_by)
                VALUES ($1, $2, $3, $4)
            '
            USING NEW.id, v_fallback_username, v_avatar_url, v_invited_by;
        ELSIF v_has_email THEN
            EXECUTE '
                INSERT INTO public.profiles (id, username, avatar_url, email)
                VALUES ($1, $2, $3, $4)
            '
            USING NEW.id, v_fallback_username, v_avatar_url, NEW.email;
        ELSE
            INSERT INTO public.profiles (id, username, avatar_url)
            VALUES (NEW.id, v_fallback_username, v_avatar_url);
        END IF;
    END;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.fn_handle_registration_rewards()
RETURNS TRIGGER AS $$
DECLARE
    v_reward_points NUMERIC(12,1) := 0;
    v_requires_purchase BOOLEAN := true;
    v_recent_ip_count INT := 0;
    v_affiliate_config JSONB;
BEGIN
    IF NEW.invited_by IS NULL THEN
        RETURN NEW;
    END IF;

    BEGIN
        IF to_regclass('public.system_config') IS NOT NULL THEN
            SELECT config_value INTO v_affiliate_config
            FROM public.system_config
            WHERE config_key = 'affiliate_program';
        END IF;

        v_reward_points := COALESCE(
            (v_affiliate_config->>'registration_reward_points')::NUMERIC(12,1),
            (SELECT value::NUMERIC(12,1) FROM public.system_settings WHERE key = 'registration_reward_points'),
            0
        );
        v_requires_purchase := COALESCE(
            (v_affiliate_config->>'registration_reward_requires_purchase')::BOOLEAN,
            (SELECT value::BOOLEAN FROM public.system_settings WHERE key = 'registration_reward_requires_purchase'),
            true
        );

        IF v_reward_points <= 0 THEN
            RETURN NEW;
        END IF;

        IF NEW.registration_ip IS NOT NULL AND BTRIM(NEW.registration_ip) <> '' THEN
            SELECT COUNT(*) INTO v_recent_ip_count
            FROM public.profiles p
            JOIN auth.users au ON au.id = p.id
            WHERE p.registration_ip = NEW.registration_ip
              AND au.created_at > NOW() - INTERVAL '24 hours';

            IF v_recent_ip_count >= 3 THEN
                RETURN NEW;
            END IF;
        END IF;

        IF v_requires_purchase THEN
            INSERT INTO public.pending_referral_rewards (inviter_id, invitee_id, reward_points)
            VALUES (NEW.invited_by, NEW.id, v_reward_points)
            ON CONFLICT (invitee_id) DO UPDATE SET
                inviter_id = EXCLUDED.inviter_id,
                reward_points = EXCLUDED.reward_points;
        ELSE
            PERFORM public.fn_safe_add_bonus_balance(NEW.invited_by, v_reward_points, 'cn');
            PERFORM public.fn_safe_insert_reason_ledger(
                NEW.invited_by,
                v_reward_points,
                '邀请拉新奖励',
                'REG_REWARD_' || NEW.id,
                'cn'
            );
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[SignupHotfix] Skip registration reward for user %: %', NEW.id, SQLERRM;
    END;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.fn_signup_bonus()
RETURNS TRIGGER AS $$
DECLARE
    v_bonus NUMERIC(12,1) := 0;
    v_config JSONB;
    v_can_check_dup BOOLEAN := false;
    v_already_granted BOOLEAN := false;
BEGIN
    BEGIN
        IF to_regclass('public.system_config') IS NOT NULL THEN
            SELECT config_value INTO v_config
            FROM public.system_config
            WHERE config_key = 'rewards';
        END IF;

        v_bonus := COALESCE((v_config->>'signup_bonus')::NUMERIC(12,1), 0);

        IF v_bonus <= 0 THEN
            RETURN NEW;
        END IF;

        v_can_check_dup := public.fn_table_has_column('public', 'points_ledger', 'reason');

        IF v_can_check_dup THEN
            SELECT EXISTS(
                SELECT 1
                FROM public.points_ledger
                WHERE user_id = NEW.id
                  AND reason = 'signup_bonus'
            ) INTO v_already_granted;

            IF v_already_granted THEN
                RETURN NEW;
            END IF;
        END IF;

        PERFORM public.fn_safe_add_bonus_balance(NEW.id, v_bonus, 'cn');
        PERFORM public.fn_safe_insert_reason_ledger(
            NEW.id,
            v_bonus,
            'signup_bonus',
            'REG_BONUS_' || NEW.id,
            'cn'
        );
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE '[SignupHotfix] Skip signup bonus for user %: %', NEW.id, SQLERRM;
    END;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE PROCEDURE public.handle_new_user();

DROP TRIGGER IF EXISTS tr_generate_invite_code ON public.profiles;
CREATE TRIGGER tr_generate_invite_code
    BEFORE INSERT ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_generate_invite_code();

DROP TRIGGER IF EXISTS tr_handle_registration_rewards ON public.profiles;
CREATE TRIGGER tr_handle_registration_rewards
    AFTER INSERT ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_handle_registration_rewards();

DROP TRIGGER IF EXISTS trg_signup_bonus ON public.profiles;
CREATE TRIGGER trg_signup_bonus
    AFTER INSERT ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_signup_bonus();
