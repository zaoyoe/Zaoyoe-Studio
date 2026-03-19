-- ============================================
-- 6.6 修复推广返佣被按整数写入的问题
-- 适用场景：
-- 1. points_ledger.amount / points_balance.* 仍是整数精度
-- 2. 标准商城返佣 AFFILIATE_REWARD_* 已被错误写成整数
--
-- 执行结果：
-- 1. 强制积分相关字段升级到 NUMERIC(12,1)
-- 2. 重新按流水 reason 里的配置比例修正标准商城返佣金额
-- 3. 同步调整邀请人的 bonus_balance
--
-- 说明：
-- - 这里只修复标准商城返佣 AFFILIATE_REWARD_*，不动代理资源 AFF_REW_*
-- - 如果 points_ledger 有 balance_snapshot 字段，本脚本不会回算历史快照
-- ============================================

DO $$
DECLARE
    v_points_balance_has_site BOOLEAN := false;
    v_points_ledger_has_site BOOLEAN := false;
    v_rows_fixed INTEGER := 0;
    v_total_delta NUMERIC(12,1) := 0;
BEGIN
    -- 1. 先确保积分字段支持 0.1 精度
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

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'points_balance'
          AND column_name = 'site'
    ) INTO v_points_balance_has_site;

    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'points_ledger'
          AND column_name = 'site'
    ) INTO v_points_ledger_has_site;

    DROP TABLE IF EXISTS tmp_affiliate_commission_fix;

    EXECUTE format($sql$
        CREATE TEMP TABLE tmp_affiliate_commission_fix AS
        WITH reward_rows AS (
            SELECT
                pl.id AS ledger_id,
                pl.user_id,
                %s AS site,
                COALESCE(pl.amount, 0)::NUMERIC(12,1) AS current_amount,
                COALESCE(so.price_paid, so.total_price, 0)::NUMERIC(12,1) AS order_amount,
                NULLIF((regexp_match(pl.reason, '([0-9]+(?:\.[0-9]+)?)%%'))[1], '')::NUMERIC AS declared_rate_percent
            FROM public.points_ledger pl
            JOIN public.shop_orders so
              ON so.id::TEXT = SUBSTRING(pl.reference_id FROM LENGTH('AFFILIATE_REWARD_') + 1)
            WHERE pl.reference_id LIKE 'AFFILIATE_REWARD_%%'
        )
        SELECT
            ledger_id,
            user_id,
            site,
            current_amount,
            order_amount,
            declared_rate_percent,
            ROUND((order_amount * declared_rate_percent / 100)::NUMERIC, 1) AS expected_amount,
            ROUND(ROUND((order_amount * declared_rate_percent / 100)::NUMERIC, 1) - current_amount, 1) AS delta
        FROM reward_rows
        WHERE declared_rate_percent IS NOT NULL
          AND order_amount > 0
          AND ABS(ROUND((order_amount * declared_rate_percent / 100)::NUMERIC, 1) - current_amount) >= 0.1
    $sql$, CASE WHEN v_points_ledger_has_site THEN 'COALESCE(pl.site, ''cn'')' ELSE '''cn''' END);

    UPDATE public.points_ledger pl
    SET amount = f.expected_amount
    FROM tmp_affiliate_commission_fix f
    WHERE pl.id = f.ledger_id;

    GET DIAGNOSTICS v_rows_fixed = ROW_COUNT;

    SELECT COALESCE(SUM(delta), 0)::NUMERIC(12,1)
    INTO v_total_delta
    FROM tmp_affiliate_commission_fix;

    IF v_total_delta <> 0 THEN
        IF v_points_balance_has_site THEN
            UPDATE public.points_balance pb
            SET bonus_balance = ROUND(COALESCE(pb.bonus_balance, 0) + fix.delta, 1),
                updated_at = NOW()
            FROM (
                SELECT user_id, site, SUM(delta)::NUMERIC(12,1) AS delta
                FROM tmp_affiliate_commission_fix
                GROUP BY user_id, site
            ) fix
            WHERE pb.user_id = fix.user_id
              AND pb.site = fix.site;
        ELSE
            UPDATE public.points_balance pb
            SET bonus_balance = ROUND(COALESCE(pb.bonus_balance, 0) + fix.delta, 1),
                updated_at = NOW()
            FROM (
                SELECT user_id, SUM(delta)::NUMERIC(12,1) AS delta
                FROM tmp_affiliate_commission_fix
                GROUP BY user_id
            ) fix
            WHERE pb.user_id = fix.user_id;
        END IF;
    END IF;

    RAISE NOTICE '[AffiliateCommissionFix] fixed % ledger rows, total balance delta = %', v_rows_fixed, v_total_delta;
END $$;

SELECT
    COUNT(*) AS fixed_rows,
    COALESCE(SUM(delta), 0)::NUMERIC(12,1) AS total_balance_delta
FROM tmp_affiliate_commission_fix;

SELECT
    ledger_id,
    user_id,
    site,
    current_amount,
    expected_amount,
    delta,
    order_amount,
    declared_rate_percent
FROM tmp_affiliate_commission_fix
ORDER BY ABS(delta) DESC, ledger_id DESC
LIMIT 50;
