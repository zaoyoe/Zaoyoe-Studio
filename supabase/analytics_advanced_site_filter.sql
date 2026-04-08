-- ============================================
-- 高级分析 RPC 函数 - 站点过滤支持
-- 为 conversion_funnel / retention_cohort / points_flow 增加 p_site 参数
-- p_site = NULL 时返回所有站点数据
-- ============================================

CREATE OR REPLACE FUNCTION public.require_admin_access()
RETURNS VOID AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.require_admin_access() TO authenticated;

-- ============================================
-- 1. CONVERSION FUNNEL (真实事件漏斗)
-- Legacy proxy funnel has been retired from the admin analytics path.
-- ============================================

DROP FUNCTION IF EXISTS get_conversion_funnel(INTEGER, VARCHAR, DATE, DATE);
DROP FUNCTION IF EXISTS get_conversion_funnel(INTEGER, VARCHAR);
DROP FUNCTION IF EXISTS get_conversion_funnel(INTEGER);

DROP FUNCTION IF EXISTS get_conversion_funnel_v2(INTEGER, VARCHAR);

CREATE OR REPLACE FUNCTION get_conversion_funnel_v2(
    p_days INTEGER DEFAULT 30,
    p_site VARCHAR DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
    step_name TEXT,
    step_order INTEGER,
    user_count BIGINT,
    conversion_rate NUMERIC,
    is_proxy_metric BOOLEAN
) AS $$
DECLARE
    v_end_date DATE := COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date);
    v_start_date DATE := COALESCE(p_start_date, v_end_date - GREATEST(COALESCE(p_days, 30) - 1, 0));
    v_prompt_view_users BIGINT := 0;
    v_unlock_click_users BIGINT := 0;
    v_unlock_success_users BIGINT := 0;
BEGIN
    PERFORM public.require_admin_access();

    WITH scoped_events AS (
        SELECT
            ue.user_id,
            ue.event_name
        FROM public.user_events ue
        WHERE ue.user_id IS NOT NULL
          AND get_local_date(ue.created_at) BETWEEN v_start_date AND v_end_date
          AND ue.event_name IN ('prompt_view', 'unlock_click', 'unlock_success')
          AND (
              p_site IS NULL
              OR COALESCE(NULLIF(ue.site, ''), NULLIF(ue.event_data->>'site', ''), 'cn') = p_site
          )
    )
    SELECT
        COUNT(DISTINCT user_id) FILTER (WHERE event_name = 'prompt_view'),
        COUNT(DISTINCT user_id) FILTER (WHERE event_name = 'unlock_click'),
        COUNT(DISTINCT user_id) FILTER (WHERE event_name = 'unlock_success')
    INTO
        v_prompt_view_users,
        v_unlock_click_users,
        v_unlock_success_users
    FROM scoped_events;

    RETURN QUERY
    SELECT 'Prompt 浏览'::TEXT, 1, COALESCE(v_prompt_view_users, 0), 100.0::NUMERIC, FALSE
    UNION ALL
    SELECT
        '解锁点击'::TEXT,
        2,
        COALESCE(v_unlock_click_users, 0),
        ROUND(
            safe_divide(
                COALESCE(v_unlock_click_users, 0)::NUMERIC,
                NULLIF(v_prompt_view_users, 0)::NUMERIC
            ) * 100,
            1
        ),
        FALSE
    UNION ALL
    SELECT
        '内容解锁'::TEXT,
        3,
        COALESCE(v_unlock_success_users, 0),
        ROUND(
            safe_divide(
                COALESCE(v_unlock_success_users, 0)::NUMERIC,
                NULLIF(v_prompt_view_users, 0)::NUMERIC
            ) * 100,
            1
        ),
        FALSE
    ORDER BY 2;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 2. USER RETENTION COHORT (用户留存热力图)
-- ============================================

DROP FUNCTION IF EXISTS get_retention_cohort(INTEGER, VARCHAR, DATE, DATE);

CREATE OR REPLACE FUNCTION get_retention_cohort(
    p_weeks INTEGER DEFAULT 8,
    p_site VARCHAR DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
    cohort_week TEXT,
    week_0 INTEGER,
    week_1 INTEGER,
    week_2 INTEGER,
    week_3 INTEGER,
    week_4 INTEGER,
    is_proxy_metric BOOLEAN,
    metric_basis TEXT,
    metric_label TEXT
) AS $$
DECLARE
    v_end_date DATE := COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date);
    v_start_date DATE := COALESCE(
        p_start_date,
        v_end_date - GREATEST(COALESCE(p_weeks, 8) * 7 - 1, 0)
    );
BEGIN
    PERFORM public.require_admin_access();

    RETURN QUERY
    WITH cohort_source AS (
        SELECT 
            u.id as user_id,
            date_trunc('week', u.created_at AT TIME ZONE 'Asia/Shanghai')::date as cohort_date
        FROM auth.users u
        WHERE get_local_date(u.created_at) BETWEEN v_start_date AND v_end_date
    ),
    attributed_cohorts AS (
        SELECT
            cs.user_id,
            cs.cohort_date,
            first_touch.site_value AS attributed_site
        FROM cohort_source cs
        LEFT JOIN LATERAL (
            SELECT observed_site.site_value
            FROM (
                SELECT
                    ulh.created_at,
                    CASE
                        WHEN LOWER(BTRIM(COALESCE(ulh.site, ''))) IN ('cn', 'intl')
                            THEN LOWER(BTRIM(ulh.site))
                        ELSE NULL
                    END AS site_value
                FROM public.user_login_history ulh
                WHERE ulh.user_id = cs.user_id
                UNION ALL
                SELECT
                    ue.created_at,
                    CASE
                        WHEN LOWER(BTRIM(COALESCE(ue.site, ue.event_data->>'site', ''))) IN ('cn', 'intl')
                            THEN LOWER(BTRIM(COALESCE(ue.site, ue.event_data->>'site', '')))
                        ELSE NULL
                    END AS site_value
                FROM public.user_events ue
                WHERE ue.user_id = cs.user_id
            ) observed_site
            WHERE observed_site.site_value IS NOT NULL
            ORDER BY observed_site.created_at ASC, observed_site.site_value ASC
            LIMIT 1
        ) first_touch ON TRUE
    ),
    cohorts AS (
        SELECT
            ac.user_id,
            ac.cohort_date
        FROM attributed_cohorts ac
        WHERE p_site IS NULL OR ac.attributed_site = p_site
    ),
    user_activity AS (
        SELECT DISTINCT
            ue.user_id,
            date_trunc('week', ue.created_at AT TIME ZONE 'Asia/Shanghai')::date as activity_week
        FROM public.user_events ue
        WHERE ue.user_id IS NOT NULL
          AND get_local_date(ue.created_at) BETWEEN v_start_date AND v_end_date
          AND (
              p_site IS NULL
              OR COALESCE(NULLIF(ue.site, ''), NULLIF(ue.event_data->>'site', ''), 'cn') = p_site
          )
          AND ue.event_name IN (
              'prompt_view',
              'unlock_click',
              'unlock_success',
              'wallet_open',
              'recharge_click',
              'recharge_success',
              'verify_submit',
              'verify_success',
              'verify_fail',
              'shop_view',
              'shop_purchase',
              'guestbook_post',
              'affiliate_invite_click',
              'checkin_success'
          )
    ),
    retention AS (
        SELECT
            c.cohort_date,
            COUNT(DISTINCT c.user_id) as cohort_size,
            COUNT(DISTINCT CASE WHEN ua.activity_week = c.cohort_date THEN c.user_id END) as w0,
            COUNT(DISTINCT CASE WHEN ua.activity_week = c.cohort_date + INTERVAL '1 week' THEN c.user_id END) as w1,
            COUNT(DISTINCT CASE WHEN ua.activity_week = c.cohort_date + INTERVAL '2 weeks' THEN c.user_id END) as w2,
            COUNT(DISTINCT CASE WHEN ua.activity_week = c.cohort_date + INTERVAL '3 weeks' THEN c.user_id END) as w3,
            COUNT(DISTINCT CASE WHEN ua.activity_week = c.cohort_date + INTERVAL '4 weeks' THEN c.user_id END) as w4
        FROM cohorts c
        LEFT JOIN user_activity ua ON c.user_id = ua.user_id
        GROUP BY c.cohort_date
        ORDER BY c.cohort_date DESC
        LIMIT 6
    )
    SELECT 
        to_char(cohort_date, 'MM/DD') as cohort_week,
        ROUND(w0::NUMERIC / NULLIF(cohort_size, 0) * 100)::INTEGER as week_0,
        ROUND(w1::NUMERIC / NULLIF(cohort_size, 0) * 100)::INTEGER as week_1,
        ROUND(w2::NUMERIC / NULLIF(cohort_size, 0) * 100)::INTEGER as week_2,
        ROUND(w3::NUMERIC / NULLIF(cohort_size, 0) * 100)::INTEGER as week_3,
        ROUND(w4::NUMERIC / NULLIF(cohort_size, 0) * 100)::INTEGER as week_4,
        FALSE AS is_proxy_metric,
        'site_attributed_cohort_effective_business_activity'::TEXT AS metric_basis,
        '首站点归因 cohort + 真实业务回访'::TEXT AS metric_label
    FROM retention;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop old signature
DROP FUNCTION IF EXISTS get_retention_cohort(INTEGER, VARCHAR);
DROP FUNCTION IF EXISTS get_retention_cohort(INTEGER);

-- ============================================
-- 3. POINTS FLOW (积分流向)
-- ============================================

DROP FUNCTION IF EXISTS get_points_flow(INTEGER, VARCHAR);

CREATE OR REPLACE FUNCTION get_points_flow(
    p_days INTEGER DEFAULT 30,
    p_site VARCHAR DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
    source_node TEXT,
    target_node TEXT,
    value NUMERIC
) AS $$
DECLARE
    v_end_date DATE := COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date);
    v_start_date DATE := COALESCE(p_start_date, v_end_date - GREATEST(COALESCE(p_days, 30) - 1, 0));
BEGIN
    PERFORM public.require_admin_access();

    RETURN QUERY
    -- Income sources
    SELECT 
        CASE 
            WHEN reason LIKE '%兑换码%' OR reason LIKE '%redeem%' THEN '兑换码'
            WHEN reason LIKE '%充值%' OR reason LIKE '%recharge%' THEN '充值'
            WHEN reason LIKE '%奖励%' OR reason LIKE '%reward%' THEN '系统奖励'
            ELSE '其他收入'
        END::TEXT as source_node,
        '用户余额'::TEXT as target_node,
        ROUND(ABS(SUM(amount)), 1)::NUMERIC as value
    FROM public.points_ledger
    WHERE get_local_date(created_at) BETWEEN v_start_date AND v_end_date AND amount > 0
      AND (p_site IS NULL OR site = p_site)
    GROUP BY 1
    
    UNION ALL
    
    -- Expense destinations
    SELECT 
        '用户余额'::TEXT as source_node,
        CASE 
            WHEN reason LIKE '%解锁%' OR reason LIKE '%unlock%' THEN '内容解锁'
            WHEN reason LIKE '%扣除%' OR reason LIKE '%deduct%' THEN '管理扣除'
            ELSE '其他消费'
        END::TEXT as target_node,
        ROUND(ABS(SUM(amount)), 1)::NUMERIC as value
    FROM public.points_ledger
    WHERE get_local_date(created_at) BETWEEN v_start_date AND v_end_date AND amount < 0
      AND (p_site IS NULL OR site = p_site)
    GROUP BY 2
    
    ORDER BY value DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop old signature
DROP FUNCTION IF EXISTS get_points_flow(INTEGER);

DROP FUNCTION IF EXISTS get_points_flow_v2(INTEGER, VARCHAR);

CREATE OR REPLACE FUNCTION get_points_flow_v2(
    p_days INTEGER DEFAULT 30,
    p_site VARCHAR DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
    source_node TEXT,
    target_node TEXT,
    value NUMERIC
) AS $$
DECLARE
    v_end_date DATE := COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date);
    v_start_date DATE := COALESCE(p_start_date, v_end_date - GREATEST(COALESCE(p_days, 30) - 1, 0));
BEGIN
    PERFORM public.require_admin_access();

    RETURN QUERY
    WITH ledger_classified AS (
        SELECT
            CASE
                WHEN pl.amount > 0 THEN
                    CASE
                        WHEN pl.reason = 'redeem_code' OR pl.reason ILIKE '%兑换码%' OR pl.reason ILIKE '%redeem%' THEN '兑换码'
                        WHEN pl.reason ILIKE '推广返佣%' OR UPPER(COALESCE(pl.reference_id, '')) LIKE 'AFFILIATE_REWARD_%' OR UPPER(COALESCE(pl.reference_id, '')) LIKE 'AFF_REW_%' THEN '推广返佣'
                        WHEN UPPER(COALESCE(pl.reference_id, '')) LIKE 'REG_REWARD_UNLOCK_%' OR pl.reason ILIKE '%首单激活%' OR pl.reason ILIKE '%首充激活%' THEN '拉新激活'
                        WHEN UPPER(COALESCE(pl.reference_id, '')) LIKE 'REG_REWARD_%' OR pl.reason ILIKE '邀请拉新奖励%' OR pl.reason IN ('signup_bonus', 'register_bonus') THEN '注册奖励'
                        WHEN pl.reason = 'daily_checkin' THEN '签到奖励'
                        WHEN pl.reason IN ('package_purchase', 'afdian_recharge', 'custom_recharge') OR pl.reason ILIKE '模拟充值:%' OR pl.reason ILIKE '模拟充值：%' OR pl.reason ILIKE '%充值%' OR pl.reason ILIKE '%recharge%' THEN '充值'
                        ELSE '其他收入'
                    END
                ELSE '用户余额'
            END::TEXT AS source_node,
            CASE
                WHEN pl.amount > 0 THEN '用户余额'
                ELSE
                    CASE
                        WHEN pl.reason = 'unlock_prompt' OR pl.reason ILIKE '%unlock%' OR pl.reason ILIKE '%解锁%' THEN '内容解锁'
                        WHEN (LOWER(COALESCE(pl.reason, '')) LIKE '%google one%' AND (
                            LOWER(COALESCE(pl.reason, '')) LIKE '%链接获取服务%'
                            OR LOWER(COALESCE(pl.reason, '')) LIKE '%trial link%'
                            OR LOWER(COALESCE(pl.reason, '')) LIKE '%link service%'
                            OR LOWER(COALESCE(pl.reason, '')) LIKE '%verify service%'
                        )) THEN '验证服务'
                        WHEN pl.reason ILIKE '商城购买:%' OR pl.reason ILIKE 'shop purchase:%' OR UPPER(COALESCE(pl.reference_id, '')) LIKE 'SHOP_ORDER_%' THEN '商城兑换'
                        WHEN pl.reason = 'makeup_checkin_cost' THEN '补签成本'
                        WHEN pl.reason ILIKE '%deduct%' OR pl.reason ILIKE 'admin_manual:%' OR pl.reason ILIKE '%admin%' OR pl.reason ILIKE '%扣除%' THEN '管理扣除'
                        ELSE '其他消费'
                    END
            END::TEXT AS target_node,
            ABS(pl.amount)::NUMERIC AS value
        FROM public.points_ledger pl
        WHERE get_local_date(pl.created_at) BETWEEN v_start_date AND v_end_date
          AND (p_site IS NULL OR pl.site = p_site)
    ),
    ledger_agg AS (
        SELECT
            lc.source_node,
            lc.target_node,
            ROUND(SUM(lc.value), 1)::NUMERIC AS value
        FROM ledger_classified lc
        GROUP BY lc.source_node, lc.target_node
    ),
    event_agg AS (
        SELECT
            CASE
                WHEN points_delta > 0 AND event_name = 'recharge_success' THEN '充值'
                WHEN points_delta > 0 AND event_name = 'checkin_success' THEN '签到奖励'
                WHEN points_delta < 0 THEN '用户余额'
                ELSE NULL
            END::TEXT AS source_node,
            CASE
                WHEN points_delta > 0 THEN '用户余额'
                WHEN points_delta < 0 AND event_name = 'unlock_success' THEN '内容解锁'
                WHEN points_delta < 0 AND event_name = 'verify_submit' THEN '验证服务'
                WHEN points_delta < 0 AND event_name = 'shop_purchase' THEN '商城兑换'
                ELSE NULL
            END::TEXT AS target_node,
            ROUND(SUM(ABS(points_delta)), 1)::NUMERIC AS value
        FROM (
            SELECT
                ue.event_name,
                COALESCE(
                    NULLIF(ue.event_data->>'points_delta', '')::NUMERIC,
                    NULLIF(ue.event_data->'metadata'->>'points_amount', '')::NUMERIC,
                    NULLIF(ue.event_data->'metadata'->>'points_cost', '')::NUMERIC * CASE
                        WHEN ue.event_name = 'verify_submit' THEN -1
                        ELSE 1
                    END,
                    0
                ) AS points_delta
            FROM public.user_events ue
            WHERE ue.user_id IS NOT NULL
              AND ue.event_name IN ('recharge_success', 'checkin_success', 'unlock_success', 'verify_submit', 'shop_purchase')
              AND get_local_date(ue.created_at) BETWEEN v_start_date AND v_end_date
              AND (
                  p_site IS NULL
                  OR COALESCE(NULLIF(ue.site, ''), NULLIF(ue.event_data->>'site', ''), 'cn') = p_site
              )
        ) scoped_events
        WHERE points_delta <> 0
        GROUP BY 1, 2
    ),
    combined_pairs AS (
        SELECT source_node, target_node FROM ledger_agg
        UNION
        SELECT source_node, target_node FROM event_agg
    )
    SELECT
        cp.source_node,
        cp.target_node,
        CASE
            WHEN (cp.source_node, cp.target_node) IN (
                ('充值', '用户余额'),
                ('签到奖励', '用户余额'),
                ('用户余额', '内容解锁'),
                ('用户余额', '验证服务'),
                ('用户余额', '商城兑换')
            )
                THEN ROUND(GREATEST(COALESCE(ea.value, 0), COALESCE(la.value, 0)), 1)::NUMERIC
            ELSE ROUND(COALESCE(la.value, 0), 1)::NUMERIC
        END AS value
    FROM combined_pairs cp
    LEFT JOIN ledger_agg la
        ON la.source_node = cp.source_node
       AND la.target_node = cp.target_node
    LEFT JOIN event_agg ea
        ON ea.source_node = cp.source_node
       AND ea.target_node = cp.target_node
    WHERE CASE
        WHEN (cp.source_node, cp.target_node) IN (
            ('充值', '用户余额'),
            ('签到奖励', '用户余额'),
            ('用户余额', '内容解锁'),
            ('用户余额', '验证服务'),
            ('用户余额', '商城兑换')
        )
            THEN GREATEST(COALESCE(ea.value, 0), COALESCE(la.value, 0))
        ELSE COALESCE(la.value, 0)
    END > 0
    ORDER BY value DESC, source_node, target_node;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 4. REDEMPTION FUNNEL (兑换码漏斗 - 带站点过滤)
-- ============================================

DROP FUNCTION IF EXISTS get_redemption_funnel(VARCHAR, INTEGER);

CREATE OR REPLACE FUNCTION get_redemption_funnel(
    p_site VARCHAR DEFAULT NULL,
    p_days INTEGER DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
    step TEXT,
    count BIGINT,
    conversion_rate NUMERIC
) AS $$
DECLARE
    v_generated BIGINT;
    v_redeemed BIGINT;
    v_users BIGINT;
    v_start_date DATE := CASE
        WHEN p_start_date IS NOT NULL
            THEN p_start_date
        WHEN p_days IS NOT NULL AND p_days > 0
            THEN COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date) - GREATEST(p_days - 1, 0)
        ELSE NULL
    END;
    v_end_date DATE := COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date);
BEGIN
    PERFORM public.require_admin_access();

    -- 1. Generated Codes
    IF p_site IS NULL THEN
        SELECT COUNT(*) INTO v_generated
        FROM public.redemption_codes
        WHERE v_start_date IS NULL OR get_local_date(created_at) BETWEEN v_start_date AND v_end_date;
    ELSE
        SELECT COUNT(*) INTO v_generated
        FROM public.redemption_codes
        WHERE site = p_site
          AND (v_start_date IS NULL OR get_local_date(created_at) BETWEEN v_start_date AND v_end_date);
    END IF;
    
    -- 2. Redeemed Codes
    IF p_site IS NULL THEN
        SELECT COUNT(*) INTO v_redeemed
        FROM public.redemption_codes
        WHERE status = 'used'
          AND (v_start_date IS NULL OR get_local_date(created_at) BETWEEN v_start_date AND v_end_date);
    ELSE
        SELECT COUNT(*) INTO v_redeemed
        FROM public.redemption_codes
        WHERE status = 'used'
          AND site = p_site
          AND (v_start_date IS NULL OR get_local_date(created_at) BETWEEN v_start_date AND v_end_date);
    END IF;
    
    -- 3. Users Redeemed (Unique)
    IF p_site IS NULL THEN
        SELECT COUNT(DISTINCT used_by) INTO v_users 
        FROM public.redemption_codes 
        WHERE status = 'used'
          AND used_by IS NOT NULL
          AND (v_start_date IS NULL OR get_local_date(created_at) BETWEEN v_start_date AND v_end_date);
    ELSE
        SELECT COUNT(DISTINCT used_by) INTO v_users 
        FROM public.redemption_codes 
        WHERE status = 'used'
          AND used_by IS NOT NULL
          AND site = p_site
          AND (v_start_date IS NULL OR get_local_date(created_at) BETWEEN v_start_date AND v_end_date);
    END IF;
    
    RETURN QUERY SELECT '已生成', v_generated, 100.0::NUMERIC;
    
    RETURN QUERY SELECT '已核销', v_redeemed, 
        CASE WHEN v_generated > 0 THEN ROUND((v_redeemed::NUMERIC / v_generated::NUMERIC) * 100, 2) ELSE 0 END;
        
    RETURN QUERY SELECT '核销人数', v_users, 
        CASE WHEN v_redeemed > 0 THEN ROUND((v_users::NUMERIC / v_redeemed::NUMERIC) * 100, 2) ELSE 0 END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop old signature
DROP FUNCTION IF EXISTS get_redemption_funnel();
DROP FUNCTION IF EXISTS get_redemption_funnel(VARCHAR);

-- ============================================
-- 5. CHANNEL BREAKDOWN (渠道分布 - 带站点过滤)
-- ============================================

DROP FUNCTION IF EXISTS get_channel_breakdown(VARCHAR, INTEGER);

CREATE OR REPLACE FUNCTION get_channel_breakdown(
    p_site VARCHAR DEFAULT NULL,
    p_days INTEGER DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
    channel TEXT,
    batch_count BIGINT,
    total_codes BIGINT,
    used_codes BIGINT,
    total_points BIGINT,
    redemption_rate NUMERIC
) AS $$
DECLARE
    v_start_date DATE := CASE
        WHEN p_start_date IS NOT NULL
            THEN p_start_date
        WHEN p_days IS NOT NULL AND p_days > 0
            THEN COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date) - GREATEST(p_days - 1, 0)
        ELSE NULL
    END;
    v_end_date DATE := COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date);
BEGIN
    PERFORM public.require_admin_access();

    RETURN QUERY
    SELECT 
        COALESCE(b.channel, '未分类')::TEXT AS channel,
        COUNT(DISTINCT b.id) FILTER (WHERE c.id IS NOT NULL) AS batch_count,
        COUNT(c.id) AS total_codes,
        COUNT(c.id) FILTER (WHERE c.status = 'used') AS used_codes,
        COALESCE(SUM(pkg.points_amount) FILTER (WHERE c.status = 'used'), 0) AS total_points,
        ROUND(
            safe_divide(
                COUNT(c.id) FILTER (WHERE c.status = 'used')::NUMERIC,
                NULLIF(COUNT(c.id), 0)::NUMERIC
            ) * 100, 
            2
        ) AS redemption_rate
    FROM public.redemption_batches b
    LEFT JOIN public.redemption_codes c ON c.batch_id = b.id
        AND (p_site IS NULL OR c.site = p_site)
        AND (v_start_date IS NULL OR get_local_date(c.created_at) BETWEEN v_start_date AND v_end_date)
    LEFT JOIN public.points_packages pkg ON b.package_id = pkg.id
    GROUP BY COALESCE(b.channel, '未分类')
    ORDER BY total_points DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop old signature
DROP FUNCTION IF EXISTS get_channel_breakdown();
DROP FUNCTION IF EXISTS get_channel_breakdown(VARCHAR);

DROP FUNCTION IF EXISTS get_channel_breakdown_v2(VARCHAR, INTEGER);

CREATE OR REPLACE FUNCTION get_channel_breakdown_v2(
    p_site VARCHAR DEFAULT NULL,
    p_days INTEGER DEFAULT NULL,
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
    channel TEXT,
    event_count BIGINT,
    user_count BIGINT,
    unlock_success_count BIGINT,
    verify_submit_count BIGINT,
    recharge_success_count BIGINT,
    shop_purchase_count BIGINT,
    share_rate NUMERIC,
    source_kind TEXT
) AS $$
DECLARE
    v_start_date DATE := CASE
        WHEN p_start_date IS NOT NULL
            THEN p_start_date
        WHEN p_days IS NOT NULL AND p_days > 0
            THEN COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date) - GREATEST(p_days - 1, 0)
        ELSE NULL
    END;
    v_end_date DATE := COALESCE(p_end_date, (NOW() AT TIME ZONE 'Asia/Shanghai')::date);
BEGIN
    PERFORM public.require_admin_access();

    RETURN QUERY
    WITH scoped_events AS (
        SELECT
            ue.user_id,
            ue.event_name,
            LOWER(COALESCE(NULLIF(ue.event_data->'metadata'->>'entry', ''), '')) AS entry_key,
            LOWER(COALESCE(NULLIF(ue.event_data->'metadata'->>'source_module', ''), '')) AS source_module_key,
            LOWER(COALESCE(NULLIF(ue.event_data->'metadata'->>'channel', ''), '')) AS action_channel_key,
            LOWER(COALESCE(NULLIF(ue.event_data->>'page', ''), NULLIF(ue.page_url, ''), '')) AS page_key
        FROM public.user_events ue
        WHERE ue.user_id IS NOT NULL
          AND ue.event_name IN (
              'prompt_view',
              'unlock_success',
              'wallet_open',
              'recharge_click',
              'recharge_success',
              'verify_submit',
              'shop_view',
              'shop_purchase',
              'guestbook_post',
              'affiliate_invite_click'
          )
          AND (v_start_date IS NULL OR get_local_date(ue.created_at) BETWEEN v_start_date AND v_end_date)
          AND (
              p_site IS NULL
              OR COALESCE(NULLIF(ue.site, ''), NULLIF(ue.event_data->>'site', ''), 'cn') = p_site
          )
    ),
    labeled_events AS (
        SELECT
            CASE
                WHEN se.entry_key = 'unlock_insufficient_points' THEN '内容解锁补款'
                WHEN se.entry_key = 'shop_insufficient_points' THEN '商城积分不足'
                WHEN se.entry_key = 'verify_balance' THEN '验证服务入口'
                WHEN se.entry_key = 'nav_wallet' THEN '导航钱包'
                WHEN se.entry_key = 'nav_orders' THEN '导航订单'
                WHEN se.entry_key = 'homepage_guestbook' THEN '首页留言板'
                WHEN se.entry_key = 'guestbook_page' THEN '留言板页面'
                WHEN se.entry_key = 'wallet_balance' THEN '钱包余额页'
                WHEN se.entry_key = 'wallet_recharge' THEN '钱包充值页'
                WHEN se.action_channel_key = 'copy_link' THEN '推广链接分享'
                WHEN se.action_channel_key = 'poster_download' THEN '推广海报下载'
                WHEN se.source_module_key = 'prompt_gallery' THEN 'Prompt 内容页'
                WHEN se.source_module_key = 'verify_widget' THEN '验证服务'
                WHEN se.source_module_key = 'shop_client' THEN '商城'
                WHEN se.source_module_key = 'auth_dropdown' THEN '账户下拉'
                WHEN se.source_module_key = 'wallet_modal' THEN '钱包弹窗'
                WHEN se.page_key IN ('/', '/index.html') THEN '首页'
                WHEN se.page_key LIKE '%/shop.html%' THEN '商城页'
                WHEN se.page_key LIKE '%/verify.html%' THEN '验证页'
                WHEN se.page_key LIKE '%/guestbook.html%' THEN '留言板页'
                ELSE '其他来源'
            END::TEXT AS channel,
            se.user_id,
            se.event_name
        FROM scoped_events se
    ),
    rollup AS (
        SELECT
            le.channel,
            COUNT(*) AS event_count,
            COUNT(DISTINCT le.user_id) AS user_count,
            COUNT(*) FILTER (WHERE le.event_name = 'unlock_success') AS unlock_success_count,
            COUNT(*) FILTER (WHERE le.event_name = 'verify_submit') AS verify_submit_count,
            COUNT(*) FILTER (WHERE le.event_name = 'recharge_success') AS recharge_success_count,
            COUNT(*) FILTER (WHERE le.event_name = 'shop_purchase') AS shop_purchase_count
        FROM labeled_events le
        GROUP BY le.channel
    ),
    totals AS (
        SELECT SUM(r.event_count) AS total_events
        FROM rollup r
    )
    SELECT
        r.channel,
        r.event_count,
        r.user_count,
        r.unlock_success_count,
        r.verify_submit_count,
        r.recharge_success_count,
        r.shop_purchase_count,
        ROUND(
            safe_divide(
                COALESCE(r.event_count, 0)::NUMERIC,
                NULLIF(t.total_events, 0)::NUMERIC
            ) * 100,
            2
        ) AS share_rate,
        '业务入口'::TEXT AS source_kind
    FROM rollup r
    CROSS JOIN totals t
    ORDER BY r.event_count DESC, r.user_count DESC, r.channel ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- GRANT PERMISSIONS
-- ============================================

GRANT EXECUTE ON FUNCTION get_conversion_funnel_v2(INTEGER, VARCHAR, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_retention_cohort(INTEGER, VARCHAR, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_points_flow(INTEGER, VARCHAR, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_points_flow_v2(INTEGER, VARCHAR, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_redemption_funnel(VARCHAR, INTEGER, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_channel_breakdown(VARCHAR, INTEGER, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION get_channel_breakdown_v2(VARCHAR, INTEGER, DATE, DATE) TO authenticated;

-- ============================================
-- 完成！在 Supabase SQL Editor 中执行本脚本
-- ============================================
