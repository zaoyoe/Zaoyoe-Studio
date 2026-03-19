-- ============================================
-- 修复：admin analytics 积分生态在小数积分模式下的 RPC 返回类型
-- 适用场景：
-- 1. points_balance.total_balance / points_ledger.amount 已升级为 NUMERIC(12,1)
-- 2. admin studio 的“积分流向 / 积分富豪榜 / 周收入周消耗”出现加载失败或无法显示
-- ============================================

-- 1) 积分富豪榜：返回 NUMERIC，避免 total_balance 与 amount 的聚合结果和旧 INTEGER 签名冲突
CREATE OR REPLACE FUNCTION get_points_leaderboard(p_limit INTEGER DEFAULT 10, p_site VARCHAR DEFAULT NULL)
RETURNS TABLE (
    user_id UUID,
    username TEXT,
    avatar_url TEXT,
    balance NUMERIC,
    total_spent NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        pb.user_id,
        p.username,
        p.avatar_url,
        ROUND(COALESCE(SUM(pb.total_balance), 0), 1)::NUMERIC AS balance,
        COALESCE(
            (
                SELECT ROUND(ABS(SUM(pl.amount)), 1)
                FROM public.points_ledger pl
                WHERE pl.user_id = pb.user_id
                  AND pl.amount < 0
                  AND (p_site IS NULL OR pl.site = p_site)
            ),
            0
        )::NUMERIC AS total_spent
    FROM public.points_balance pb
    LEFT JOIN public.profiles p ON p.id = pb.user_id
    WHERE (p_site IS NULL OR pb.site = p_site)
    GROUP BY pb.user_id, p.username, p.avatar_url
    ORDER BY balance DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2) 积分健康：补充 weekly_income / weekly_spend，前端 KPI 可以直接显示“本周收入 / 本周消耗”
CREATE OR REPLACE FUNCTION get_points_health(p_site VARCHAR DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
    v_users_with_points BIGINT;
    v_hoarding_users BIGINT;
    v_total_circulation NUMERIC(12,1);
    v_monthly_spend NUMERIC(12,1);
    v_weekly_income NUMERIC(12,1);
    v_weekly_spend NUMERIC(12,1);
    v_velocity NUMERIC;
    v_hoarding_rate NUMERIC;
    v_30_days_ago TIMESTAMP := NOW() - INTERVAL '30 days';
    v_7_days_ago TIMESTAMP := NOW() - INTERVAL '7 days';
BEGIN
    IF p_site IS NULL THEN
        SELECT COALESCE(SUM(total_balance), 0) INTO v_total_circulation FROM public.points_balance;
        SELECT COALESCE(ABS(SUM(amount)), 0) INTO v_monthly_spend
        FROM public.points_ledger
        WHERE amount < 0 AND created_at >= v_30_days_ago;

        SELECT COALESCE(SUM(amount), 0) INTO v_weekly_income
        FROM public.points_ledger
        WHERE amount > 0 AND created_at >= v_7_days_ago;

        SELECT COALESCE(ABS(SUM(amount)), 0) INTO v_weekly_spend
        FROM public.points_ledger
        WHERE amount < 0 AND created_at >= v_7_days_ago;
    ELSE
        SELECT COALESCE(SUM(total_balance), 0) INTO v_total_circulation
        FROM public.points_balance
        WHERE site = p_site;

        SELECT COALESCE(ABS(SUM(amount)), 0) INTO v_monthly_spend
        FROM public.points_ledger
        WHERE amount < 0 AND created_at >= v_30_days_ago AND site = p_site;

        SELECT COALESCE(SUM(amount), 0) INTO v_weekly_income
        FROM public.points_ledger
        WHERE amount > 0 AND created_at >= v_7_days_ago AND site = p_site;

        SELECT COALESCE(ABS(SUM(amount)), 0) INTO v_weekly_spend
        FROM public.points_ledger
        WHERE amount < 0 AND created_at >= v_7_days_ago AND site = p_site;
    END IF;

    IF v_total_circulation > 0 THEN
        v_velocity := ROUND((v_monthly_spend / v_total_circulation) * 100, 2);
    ELSE
        v_velocity := 0;
    END IF;

    IF p_site IS NULL THEN
        SELECT COUNT(*) INTO v_users_with_points
        FROM public.points_balance
        WHERE total_balance > 0;

        SELECT COUNT(*) INTO v_hoarding_users
        FROM public.points_balance pb
        WHERE pb.total_balance > 0
          AND NOT EXISTS (
              SELECT 1
              FROM public.points_ledger pl
              WHERE pl.user_id = pb.user_id
                AND pl.amount < 0
                AND pl.created_at >= v_30_days_ago
          );
    ELSE
        SELECT COUNT(*) INTO v_users_with_points
        FROM public.points_balance
        WHERE total_balance > 0 AND site = p_site;

        SELECT COUNT(*) INTO v_hoarding_users
        FROM public.points_balance pb
        WHERE pb.total_balance > 0
          AND pb.site = p_site
          AND NOT EXISTS (
              SELECT 1
              FROM public.points_ledger pl
              WHERE pl.user_id = pb.user_id
                AND pl.amount < 0
                AND pl.created_at >= v_30_days_ago
                AND pl.site = p_site
          );
    END IF;

    IF v_users_with_points > 0 THEN
        v_hoarding_rate := ROUND((v_hoarding_users::NUMERIC / v_users_with_points::NUMERIC) * 100, 2);
    ELSE
        v_hoarding_rate := 0;
    END IF;

    RETURN jsonb_build_object(
        'total_circulation', v_total_circulation,
        'monthly_spend', v_monthly_spend,
        'weekly_income', COALESCE(v_weekly_income, 0),
        'weekly_spend', COALESCE(v_weekly_spend, 0),
        'velocity', v_velocity,
        'hoarding_rate', v_hoarding_rate,
        'active_holders', v_users_with_points,
        'hoarding_users', v_hoarding_users
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3) 积分流向：返回 NUMERIC，避免 SUM(amount) 与旧 BIGINT 签名冲突
CREATE OR REPLACE FUNCTION get_points_flow(p_days INTEGER DEFAULT 30, p_site VARCHAR DEFAULT NULL)
RETURNS TABLE (
    source_node TEXT,
    target_node TEXT,
    value NUMERIC
) AS $$
DECLARE
    v_start_date TIMESTAMPTZ := NOW() - (p_days || ' days')::INTERVAL;
BEGIN
    RETURN QUERY
    SELECT
        CASE
            WHEN reason LIKE '%兑换码%' OR reason LIKE '%redeem%' THEN '兑换码'
            WHEN reason LIKE '%充值%' OR reason LIKE '%recharge%' THEN '充值'
            WHEN reason LIKE '%奖励%' OR reason LIKE '%reward%' THEN '系统奖励'
            ELSE '其他收入'
        END::TEXT AS source_node,
        '用户余额'::TEXT AS target_node,
        ROUND(ABS(SUM(amount)), 1)::NUMERIC AS value
    FROM public.points_ledger
    WHERE created_at >= v_start_date
      AND amount > 0
      AND (p_site IS NULL OR site = p_site)
    GROUP BY 1

    UNION ALL

    SELECT
        '用户余额'::TEXT AS source_node,
        CASE
            WHEN reason LIKE '%解锁%' OR reason LIKE '%unlock%' THEN '内容解锁'
            WHEN reason LIKE '%扣除%' OR reason LIKE '%deduct%' THEN '管理扣除'
            ELSE '其他消费'
        END::TEXT AS target_node,
        ROUND(ABS(SUM(amount)), 1)::NUMERIC AS value
    FROM public.points_ledger
    WHERE created_at >= v_start_date
      AND amount < 0
      AND (p_site IS NULL OR site = p_site)
    GROUP BY 2

    ORDER BY value DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_points_leaderboard(INTEGER, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_points_health(VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_points_flow(INTEGER, VARCHAR) TO authenticated;
