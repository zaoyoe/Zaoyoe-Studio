-- 1. System Settings Table
CREATE TABLE IF NOT EXISTS system_settings (
    key VARCHAR(50) PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID
);

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- Only authenticated users can read globally
DROP POLICY IF EXISTS "Anyone can read system settings" ON system_settings;
CREATE POLICY "Anyone can read system settings" ON system_settings FOR SELECT USING (true);

-- Insert Customization Defaults
INSERT INTO system_settings (key, value, description) VALUES
('commission_rate_shop', '0.10', '商城消费返佣比例 (例如 0.10 = 10%)'),
('commission_rate_agent', '0.10', '分销商资源购买返佣比例 (小数)'),
('registration_reward_points', '0', '拉新注册固定奖励积分'),
('registration_reward_requires_purchase', 'true', '拉新奖励是否需要首单激活(防刷作弊必开)')
ON CONFLICT (key) DO NOTHING;

-- 2. Pending Registration Rewards Table (Plan A: Purchase-Gateway)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS registration_ip VARCHAR(100);

CREATE TABLE IF NOT EXISTS pending_referral_rewards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inviter_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    invitee_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    reward_points INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(invitee_id)
);

ALTER TABLE pending_referral_rewards ENABLE ROW LEVEL SECURITY;

-- Invitees or Inviters can read their own pending rewards
DROP POLICY IF EXISTS "Users can read own pending rewards" ON pending_referral_rewards;
CREATE POLICY "Users can read own pending rewards" ON pending_referral_rewards FOR SELECT USING (
    auth.uid() = inviter_id OR auth.uid() = invitee_id
);

-- 3. Overriding Profile Creation Trigger to support Registration Rewards (Plan A + Plan B)
CREATE OR REPLACE FUNCTION fn_generate_invite_code()
RETURNS TRIGGER AS $$
DECLARE
    v_reward_points INT := 0;
    v_requires_purchase BOOLEAN := true;
    v_client_ip TEXT;
    v_recent_ip_count INT := 0;
    v_affiliate_config JSONB;
BEGIN
    IF NEW.invite_code IS NULL THEN
        NEW.invite_code := UPPER(SUBSTRING(NEW.id::text, 1, 8));
    END IF;
    
    -- Plan B: Capture Client IP
    BEGIN
        v_client_ip := current_setting('request.headers', true)::jsonb->>'x-forwarded-for';
        IF v_client_ip IS NOT NULL THEN
            v_client_ip := split_part(v_client_ip, ',', 1);
            NEW.registration_ip := TRIM(v_client_ip);
        END IF;
    EXCEPTION WHEN OTHERS THEN 
        -- Ignore if not via PostgREST
    END;
    
    -- Handle Registration Reward Logic
    IF NEW.invited_by IS NOT NULL THEN
        SELECT config_value INTO v_affiliate_config
        FROM system_config
        WHERE config_key = 'affiliate_program';

        v_reward_points := COALESCE(
            (v_affiliate_config->>'registration_reward_points')::INT,
            (SELECT value::INT FROM system_settings WHERE key = 'registration_reward_points'),
            0
        );
        v_requires_purchase := COALESCE(
            (v_affiliate_config->>'registration_reward_requires_purchase')::BOOLEAN,
            (SELECT value::BOOLEAN FROM system_settings WHERE key = 'registration_reward_requires_purchase'),
            true
        );
        
        IF v_reward_points > 0 THEN
            -- Plan B: Fraud Check (Max 3 registrations per IP per 24h)
            IF NEW.registration_ip IS NOT NULL THEN
                SELECT COUNT(*) INTO v_recent_ip_count 
                FROM profiles 
                WHERE registration_ip = NEW.registration_ip 
                AND created_at > NOW() - INTERVAL '24 hours';
            END IF;

            -- Only grant if they passed IP velocity checks
            IF v_recent_ip_count < 3 THEN
                IF v_requires_purchase THEN
                    INSERT INTO pending_referral_rewards (inviter_id, invitee_id, reward_points) 
                    VALUES (NEW.invited_by, NEW.id, v_reward_points);
                ELSE
                    -- Instant unlock (if fraud prevention is partially disabled)
                    UPDATE points_balance SET bonus_balance = bonus_balance + v_reward_points, updated_at = NOW() WHERE user_id = NEW.invited_by;
                    INSERT INTO points_ledger (user_id, amount, reason, reference_id) VALUES (NEW.invited_by, v_reward_points, '邀请拉新奖励', 'REG_REWARD_' || NEW.id);
                END IF;
            END IF;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
