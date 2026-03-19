-- ============================================
-- 推广链接注册热修复
-- 修复点：
-- 1. 避免在 BEFORE INSERT 阶段写 pending_referral_rewards，导致 invitee_id 外键报错
-- 2. 将同 IP 注册频控从 profiles.created_at 改为 auth.users.created_at
-- 3. 兼容 points_balance / points_ledger 有无 site 字段的两套积分 schema
-- ============================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS invite_code VARCHAR(20);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES public.profiles(id);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS registration_ip VARCHAR(100);

UPDATE public.profiles
SET invite_code = UPPER(SUBSTRING(id::text, 1, 8))
WHERE invite_code IS NULL OR BTRIM(invite_code) = '';

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

CREATE OR REPLACE FUNCTION public.fn_generate_invite_code()
RETURNS TRIGGER AS $$
DECLARE
    v_client_ip TEXT;
BEGIN
    IF NEW.invite_code IS NULL OR BTRIM(NEW.invite_code) = '' THEN
        NEW.invite_code := UPPER(SUBSTRING(NEW.id::text, 1, 8));
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

CREATE OR REPLACE FUNCTION public.fn_handle_registration_rewards()
RETURNS TRIGGER AS $$
DECLARE
    v_reward_points NUMERIC(12,1) := 0;
    v_requires_purchase BOOLEAN := true;
    v_recent_ip_count INT := 0;
    v_affiliate_config JSONB;
    v_points_balance_has_site BOOLEAN := false;
    v_points_ledger_has_site BOOLEAN := false;
BEGIN
    IF NEW.invited_by IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT config_value INTO v_affiliate_config
    FROM public.system_config
    WHERE config_key = 'affiliate_program';

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

        RETURN NEW;
    END IF;

    IF to_regclass('public.points_balance') IS NULL OR to_regclass('public.points_ledger') IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'points_balance'
          AND column_name = 'site'
    ) INTO v_points_balance_has_site;

    IF v_points_balance_has_site THEN
        INSERT INTO public.points_balance (user_id, site, paid_balance, bonus_balance)
        VALUES (NEW.invited_by, 'cn', 0, v_reward_points)
        ON CONFLICT (user_id, site) DO UPDATE SET
            bonus_balance = public.points_balance.bonus_balance + EXCLUDED.bonus_balance,
            updated_at = NOW();
    ELSE
        INSERT INTO public.points_balance (user_id, paid_balance, bonus_balance)
        VALUES (NEW.invited_by, 0, v_reward_points)
        ON CONFLICT (user_id) DO UPDATE SET
            bonus_balance = public.points_balance.bonus_balance + EXCLUDED.bonus_balance,
            updated_at = NOW();
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'points_ledger'
          AND column_name = 'site'
    ) INTO v_points_ledger_has_site;

    IF v_points_ledger_has_site THEN
        INSERT INTO public.points_ledger (user_id, site, amount, reason, reference_id)
        VALUES (NEW.invited_by, 'cn', v_reward_points, '邀请拉新奖励', 'REG_REWARD_' || NEW.id);
    ELSE
        INSERT INTO public.points_ledger (user_id, amount, reason, reference_id)
        VALUES (NEW.invited_by, v_reward_points, '邀请拉新奖励', 'REG_REWARD_' || NEW.id);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
