-- ============================================
-- 6.4 小数积分支持（0.1 精度）
-- 目标：让余额表/流水表支持 NUMERIC(12,1)
-- 执行前建议备份数据库
-- ============================================

DO $$
BEGIN
    -- total_balance 是 generated column，必须先删掉，才能修改它依赖的 paid/bonus 类型
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'points_balance'
          AND column_name = 'total_balance'
    ) THEN
        EXECUTE 'ALTER TABLE public.points_balance DROP COLUMN total_balance';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'points_balance'
          AND column_name = 'paid_balance'
    ) THEN
        EXECUTE 'ALTER TABLE public.points_balance ALTER COLUMN paid_balance TYPE NUMERIC(12,1) USING ROUND(COALESCE(paid_balance, 0)::numeric, 1)';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'points_balance'
          AND column_name = 'bonus_balance'
    ) THEN
        EXECUTE 'ALTER TABLE public.points_balance ALTER COLUMN bonus_balance TYPE NUMERIC(12,1) USING ROUND(COALESCE(bonus_balance, 0)::numeric, 1)';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'points_balance'
          AND column_name = 'paid_balance'
    ) AND EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'points_balance'
          AND column_name = 'bonus_balance'
    ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'points_balance'
          AND column_name = 'total_balance'
    ) THEN
        EXECUTE 'ALTER TABLE public.points_balance ADD COLUMN total_balance NUMERIC(12,1) GENERATED ALWAYS AS (paid_balance + bonus_balance) STORED';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'points_ledger'
          AND column_name = 'amount'
    ) THEN
        EXECUTE 'ALTER TABLE public.points_ledger ALTER COLUMN amount TYPE NUMERIC(12,1) USING ROUND(COALESCE(amount, 0)::numeric, 1)';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'points_ledger'
          AND column_name = 'balance_snapshot'
    ) THEN
        EXECUTE 'ALTER TABLE public.points_ledger ALTER COLUMN balance_snapshot TYPE NUMERIC(12,1) USING ROUND(COALESCE(balance_snapshot, 0)::numeric, 1)';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'pending_referral_rewards'
          AND column_name = 'reward_points'
    ) THEN
        EXECUTE 'ALTER TABLE public.pending_referral_rewards ALTER COLUMN reward_points TYPE NUMERIC(12,1) USING ROUND(COALESCE(reward_points, 0)::numeric, 1)';
    END IF;
END $$;
