-- 🎁 Commercial Points System - Foundation Schema

-- 1. 💳 Points Balance (Dual-Balance System)
CREATE TABLE IF NOT EXISTS points_balance (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    paid_balance INT DEFAULT 0,  -- Purchased points (Permanent)
    bonus_balance INT DEFAULT 0, -- Bonus/Free points (Time-limited in logic)
    total_balance INT GENERATED ALWAYS AS (paid_balance + bonus_balance) STORED,
    version INT DEFAULT 0,       -- Optimistic locking
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT non_negative_balances CHECK (paid_balance >= 0 AND bonus_balance >= 0)
);

-- 2. 🧾 Points Ledger (Audit Trail)
-- Records every single transaction for financial audit.
CREATE TABLE IF NOT EXISTS points_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL, -- e.g., 'recharge', 'redeem_code', 'consume', 'refund', 'admin_adjustment'
    amount INT NOT NULL,             -- Positive for add, Negative for subtract
    balance_snapshot INT NOT NULL,   -- Balance AFTER transaction (for consistency check)
    description TEXT,                -- Human readable note
    metadata JSONB DEFAULT '{}'::JSONB, -- Extra data (order_id, code_id, etc.)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id) -- Initiator (User themselves or Admin)
);

-- 3. 🏷️ Pricing Rules (Dynamic Pricing Engine)
CREATE TABLE IF NOT EXISTS points_pricing_rules (
    action_key VARCHAR(50) PRIMARY KEY, -- e.g., 'unlock_prompt', 'download_csv'
    base_cost INT NOT NULL,             -- Standard cost
    is_active BOOLEAN DEFAULT true,
    discount_percent INT DEFAULT 0,     -- Global discount (0-100)
    description TEXT
);

-- 4. 📦 Points Packages (For UI Display & Redemption)
CREATE TABLE IF NOT EXISTS points_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    points_amount INT NOT NULL,      -- Paid portion
    bonus_points INT DEFAULT 0,      -- Bonus portion
    price_cny DECIMAL(10, 2),        -- Price in CNY
    sku_id VARCHAR(50) UNIQUE,       -- External SKU ID (e.g. for Xianyu Auto-Delivery)
    is_active BOOLEAN DEFAULT true,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Initial Data Seeding
INSERT INTO points_pricing_rules (action_key, base_cost, description) VALUES
('unlock_prompt', 10, 'Unlock a generated prompt'),
('generate_image', 50, 'Generate an AI image'),
('download_csv', 20, 'Download batch data')
ON CONFLICT (action_key) DO NOTHING;

INSERT INTO points_packages (name, points_amount, bonus_points, price_cny, sku_id, sort_order) VALUES
('新手尝鲜包', 100, 0, 1.99, 'sku_novice', 1),
('超值进阶包', 500, 100, 9.90, 'sku_advanced', 2),
('土豪尊享包', 5000, 2000, 99.00, 'sku_pro', 3)
ON CONFLICT DO NOTHING;

-- RLS Policies
ALTER TABLE points_balance ENABLE ROW LEVEL SECURITY;
ALTER TABLE points_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE points_pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE points_packages ENABLE ROW LEVEL SECURITY;

-- 1. Balance: Users can view their own, Admins can view all
CREATE POLICY "Users view own balance" ON points_balance
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Admins view all balances" ON points_balance
    FOR SELECT TO authenticated
    USING (public.is_admin());

-- 2. Ledger: Users view own history, Admins view all
CREATE POLICY "Users view own ledger" ON points_ledger
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Admins view all ledgers" ON points_ledger
    FOR SELECT TO authenticated
    USING (public.is_admin());

-- 3. Pricing Rules & Packages: Public read-only, Admin write
CREATE POLICY "Public view pricing" ON points_pricing_rules
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage pricing" ON points_pricing_rules
    FOR ALL TO authenticated USING (public.is_admin());

CREATE POLICY "Public view packages" ON points_packages
    FOR SELECT TO authenticated USING (is_active = true);

CREATE POLICY "Admins manage packages" ON points_packages
    FOR ALL TO authenticated USING (public.is_admin());

-- Trigger: Auto-create balance entry on user signup (optional, or handle in application)
-- For now, we'll handle creation lazily or via Edge Function to keep it simple.
