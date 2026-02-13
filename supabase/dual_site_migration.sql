-- ============================================
-- 双站点数据隔离 - 数据库迁移脚本
-- 执行前请先在 Supabase 中备份数据库！
-- ============================================

-- ============================================
-- PART 1: 商品表 - 增加国际价格字段
-- ============================================

ALTER TABLE shop_products 
    ADD COLUMN IF NOT EXISTS price_points_intl INT CHECK (price_points_intl >= 0);

COMMENT ON COLUMN shop_products.price_points_intl IS '国际站价格 (Credits/USD)，NULL 表示不在国际站销售';

-- ============================================
-- PART 2: Tier 1 核心交易表 - 加 site 字段
-- ============================================

-- 2.1 points_balance (主键变更：user_id → (user_id, site))
-- 注意：total_balance 是 GENERATED 列，需要特殊处理

-- Step 1: 添加 site 列
ALTER TABLE points_balance 
    ADD COLUMN IF NOT EXISTS site VARCHAR(10) DEFAULT 'cn';

-- Step 2: 填充现有数据
UPDATE points_balance SET site = 'cn' WHERE site IS NULL;

-- Step 3: 设置 NOT NULL
ALTER TABLE points_balance ALTER COLUMN site SET NOT NULL;

-- Step 4: 删除旧主键，添加新复合主键
ALTER TABLE points_balance DROP CONSTRAINT IF EXISTS points_balance_pkey;
ALTER TABLE points_balance ADD PRIMARY KEY (user_id, site);

-- Step 5: 添加索引
CREATE INDEX IF NOT EXISTS idx_points_balance_site ON points_balance(site);

-- 2.2 points_ledger (商业积分流水)
ALTER TABLE points_ledger 
    ADD COLUMN IF NOT EXISTS site VARCHAR(10) DEFAULT 'cn' NOT NULL;
CREATE INDEX IF NOT EXISTS idx_points_ledger_site ON points_ledger(site);

-- 2.3 shop_orders (商城订单)
ALTER TABLE shop_orders 
    ADD COLUMN IF NOT EXISTS site VARCHAR(10) DEFAULT 'cn' NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shop_orders_site ON shop_orders(site);

-- 2.4 user_points (旧版积分 - schema-comments-points.sql)
ALTER TABLE user_points 
    ADD COLUMN IF NOT EXISTS site VARCHAR(10) DEFAULT 'cn';

-- 由于 user_points 的主键是 user_id，需要类似 points_balance 的处理
-- 但 user_points 可能已被 points_balance 取代，按需处理
-- ALTER TABLE user_points DROP CONSTRAINT IF EXISTS user_points_pkey;
-- ALTER TABLE user_points ADD PRIMARY KEY (user_id, site);

-- 2.5 prompt_unlocks (Prompt 解锁记录)
ALTER TABLE prompt_unlocks 
    ADD COLUMN IF NOT EXISTS site VARCHAR(10) DEFAULT 'cn' NOT NULL;

-- 更新唯一约束
ALTER TABLE prompt_unlocks DROP CONSTRAINT IF EXISTS prompt_unlocks_user_id_prompt_id_key;
ALTER TABLE prompt_unlocks DROP CONSTRAINT IF EXISTS prompt_unlocks_user_prompt_site_unique;
ALTER TABLE prompt_unlocks ADD CONSTRAINT prompt_unlocks_user_prompt_site_unique 
    UNIQUE (user_id, prompt_id, site);
CREATE INDEX IF NOT EXISTS idx_prompt_unlocks_site ON prompt_unlocks(site);

-- 2.6 redemption_codes (兑换码使用记录)
ALTER TABLE redemption_codes 
    ADD COLUMN IF NOT EXISTS site VARCHAR(10) DEFAULT 'cn';

-- 2.7 afdian_orders (爱发电订单)
ALTER TABLE afdian_orders 
    ADD COLUMN IF NOT EXISTS site VARCHAR(10) DEFAULT 'cn';

-- ============================================
-- PART 3: Tier 2 社区/行为数据表 - 加 site 字段
-- ============================================

-- 3.1 guestbook_messages
ALTER TABLE guestbook_messages 
    ADD COLUMN IF NOT EXISTS site VARCHAR(10) DEFAULT 'cn' NOT NULL;
CREATE INDEX IF NOT EXISTS idx_guestbook_messages_site ON guestbook_messages(site);

-- 3.2 guestbook_comments
ALTER TABLE guestbook_comments 
    ADD COLUMN IF NOT EXISTS site VARCHAR(10) DEFAULT 'cn' NOT NULL;

-- 3.3 guestbook_likes
ALTER TABLE guestbook_likes 
    ADD COLUMN IF NOT EXISTS site VARCHAR(10) DEFAULT 'cn' NOT NULL;

-- 3.4 prompt_comments
ALTER TABLE prompt_comments 
    ADD COLUMN IF NOT EXISTS site VARCHAR(10) DEFAULT 'cn' NOT NULL;
CREATE INDEX IF NOT EXISTS idx_prompt_comments_site ON prompt_comments(site);

-- 3.5 comment_likes
ALTER TABLE comment_likes 
    ADD COLUMN IF NOT EXISTS site VARCHAR(10) DEFAULT 'cn' NOT NULL;

-- 3.6 chat_messages
ALTER TABLE chat_messages 
    ADD COLUMN IF NOT EXISTS site VARCHAR(10) DEFAULT 'cn' NOT NULL;

-- 3.7 user_events (埋点)
ALTER TABLE user_events 
    ADD COLUMN IF NOT EXISTS site VARCHAR(10) DEFAULT 'cn';

-- 3.8 verification_logs
ALTER TABLE verification_logs 
    ADD COLUMN IF NOT EXISTS site VARCHAR(10) DEFAULT 'cn';

-- 3.9 user_login_history
ALTER TABLE user_login_history 
    ADD COLUMN IF NOT EXISTS site VARCHAR(10) DEFAULT 'cn';

-- ============================================
-- PART 4: 更新 RLS 策略（按站点过滤）
-- ============================================

-- 注意：RLS 策略使用 current_setting 获取请求头中的 site 信息
-- Supabase 客户端通过 headers 传递 site 参数
-- 但由于客户端无法直接注入 RLS context，
-- 我们选择不在 RLS 层面做 site 过滤，而是在应用层（JS）做过滤
-- 这样更灵活，且管理员可以查看所有站点数据

-- 下面是一些关键表的 RLS 更新示例（可选，用于更严格的安全性）

-- shop_orders: 用户只能看自己 + 对应站点的订单
-- DROP POLICY IF EXISTS "Users view own orders" ON shop_orders;
-- CREATE POLICY "Users view own orders" ON shop_orders 
--     FOR SELECT USING (user_id = auth.uid());
-- 注意：站点过滤在前端完成，RLS 只验证 user_id 所有权

-- ============================================
-- PART 5: 数据完整性检查
-- ============================================

-- 验证迁移结果
DO $$
DECLARE
    v_count INT;
BEGIN
    -- 检查 points_balance 主键
    SELECT count(*) INTO v_count FROM points_balance WHERE site IS NULL;
    IF v_count > 0 THEN
        RAISE WARNING 'points_balance has % rows with NULL site', v_count;
    END IF;
    
    -- 检查 points_ledger
    SELECT count(*) INTO v_count FROM points_ledger WHERE site IS NULL;
    IF v_count > 0 THEN
        RAISE WARNING 'points_ledger has % rows with NULL site', v_count;
    END IF;
    
    RAISE NOTICE '✅ Migration completed successfully!';
END $$;

-- ============================================
-- 完成！迁移脚本执行完毕
-- ============================================
