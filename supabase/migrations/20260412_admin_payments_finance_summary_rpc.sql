-- Aggregate-heavy finance summary for Admin Payments.
-- This lets the finance tab read pre-grouped metrics instead of paging through
-- payment_orders / shop_orders / points_ledger / points_balance in Node.js.

CREATE OR REPLACE FUNCTION public.fn_admin_get_payment_finance_summary(
    p_start_at TIMESTAMPTZ,
    p_end_at TIMESTAMPTZ DEFAULT NULL,
    p_site VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result JSONB;
BEGIN
    WITH filtered_orders AS (
        SELECT
            id,
            provider,
            paid_amount,
            expected_amount,
            points_amount,
            status,
            user_id
        FROM public.payment_orders
        WHERE created_at >= p_start_at
          AND (p_end_at IS NULL OR created_at <= p_end_at)
          AND (p_site IS NULL OR site = p_site)
    ),
    successful_orders AS (
        SELECT
            provider,
            points_amount,
            COALESCE(paid_amount, expected_amount, 0)::NUMERIC AS effective_amount
        FROM filtered_orders
        WHERE LOWER(BTRIM(COALESCE(status, ''))) IN ('paid', 'redeemed')
    ),
    overview_data AS (
        SELECT
            COUNT(*)::INTEGER AS total_orders,
            COUNT(*) FILTER (WHERE LOWER(BTRIM(COALESCE(status, ''))) IN ('paid', 'redeemed'))::INTEGER AS paid_orders,
            COUNT(*) FILTER (WHERE LOWER(BTRIM(COALESCE(status, ''))) = 'redeemed')::INTEGER AS redeemed_orders,
            COUNT(*) FILTER (WHERE user_id IS NOT NULL)::INTEGER AS claimed_orders,
            COUNT(*) FILTER (WHERE LOWER(BTRIM(COALESCE(status, ''))) = 'pending_review')::INTEGER AS review_orders,
            COUNT(*) FILTER (WHERE LOWER(BTRIM(COALESCE(status, ''))) IN ('rejected', 'amount_mismatch'))::INTEGER AS failed_orders,
            ROUND(COALESCE(SUM(CASE WHEN LOWER(BTRIM(COALESCE(status, ''))) IN ('paid', 'redeemed') THEN COALESCE(paid_amount, expected_amount, 0) ELSE 0 END), 0), 2) AS total_amount,
            ROUND(COALESCE(SUM(CASE WHEN LOWER(BTRIM(COALESCE(status, ''))) IN ('paid', 'redeemed') THEN COALESCE(points_amount, 0) ELSE 0 END), 0), 1) AS total_points,
            COUNT(*) FILTER (WHERE LOWER(BTRIM(COALESCE(status, ''))) = 'paid' AND user_id IS NULL)::INTEGER AS unclaimed_paid_orders
        FROM filtered_orders
    ),
    provider_rows AS (
        SELECT
            COALESCE(NULLIF(BTRIM(provider), ''), 'unknown') AS provider,
            COUNT(*)::INTEGER AS total_orders,
            COUNT(*) FILTER (WHERE LOWER(BTRIM(COALESCE(status, ''))) IN ('paid', 'redeemed'))::INTEGER AS paid_orders,
            COUNT(*) FILTER (WHERE user_id IS NOT NULL)::INTEGER AS claimed_orders,
            COUNT(*) FILTER (WHERE LOWER(BTRIM(COALESCE(status, ''))) = 'pending_review')::INTEGER AS review_orders,
            COUNT(*) FILTER (WHERE LOWER(BTRIM(COALESCE(status, ''))) IN ('rejected', 'amount_mismatch'))::INTEGER AS failed_orders,
            ROUND(COALESCE(SUM(CASE WHEN LOWER(BTRIM(COALESCE(status, ''))) IN ('paid', 'redeemed') THEN COALESCE(paid_amount, expected_amount, 0) ELSE 0 END), 0), 2) AS total_amount,
            ROUND(COALESCE(SUM(CASE WHEN LOWER(BTRIM(COALESCE(status, ''))) IN ('paid', 'redeemed') THEN COALESCE(points_amount, 0) ELSE 0 END), 0), 1) AS total_points
        FROM filtered_orders
        GROUP BY 1
    ),
    provider_stats AS (
        SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
                'provider', provider,
                'total_orders', total_orders,
                'paid_orders', paid_orders,
                'claimed_orders', claimed_orders,
                'review_orders', review_orders,
                'failed_orders', failed_orders,
                'total_amount', total_amount,
                'total_points', total_points,
                'paid_rate', CASE
                    WHEN total_orders > 0 THEN ROUND((paid_orders::NUMERIC / total_orders::NUMERIC) * 100, 2)
                    ELSE 0
                END,
                'claim_rate', CASE
                    WHEN paid_orders > 0 THEN ROUND((claimed_orders::NUMERIC / paid_orders::NUMERIC) * 100, 2)
                    ELSE 0
                END,
                'session_total', 0,
                'session_matched', 0,
                'session_stale', 0,
                'session_failed', 0,
                'session_completed_unlinked', 0,
                'webhook_total', 0,
                'webhook_success', 0,
                'webhook_failed', 0,
                'webhook_4xx', 0,
                'webhook_5xx', 0,
                'query_total', 0,
                'query_success', 0,
                'query_failed', 0,
                'query_4xx', 0,
                'query_5xx', 0,
                'eligible_orders', 0,
                'matched_orders', 0,
                'unmatched_orders', 0,
                'webhook_links', 0,
                'fallback_links', 0,
                'direct_links', 0,
                'session_match_rate', 0,
                'order_match_rate', 0,
                'webhook_success_rate', 0,
                'query_success_rate', 0,
                'auto_link_rate', 0,
                'fallback_link_rate', 0
            )
            ORDER BY total_orders DESC, total_amount DESC
        ), '[]'::JSONB) AS rows
        FROM provider_rows
    ),
    shop_summary AS (
        SELECT
            ROUND(COALESCE(SUM(CASE WHEN COALESCE(LOWER(BTRIM(refund_status)), 'none') <> 'refunded' THEN COALESCE(price_paid, 0) ELSE 0 END), 0), 1) AS shop_points_spent,
            COUNT(*) FILTER (WHERE COALESCE(LOWER(BTRIM(refund_status)), 'none') <> 'refunded')::INTEGER AS shop_order_count,
            ROUND(COALESCE(SUM(CASE WHEN COALESCE(LOWER(BTRIM(refund_status)), 'none') = 'refunded' THEN COALESCE(price_paid, 0) ELSE 0 END), 0), 1) AS refunded_shop_points,
            COUNT(*) FILTER (WHERE COALESCE(LOWER(BTRIM(refund_status)), 'none') = 'refunded')::INTEGER AS refunded_shop_order_count
        FROM public.shop_orders
        WHERE created_at >= p_start_at
          AND (p_end_at IS NULL OR created_at <= p_end_at)
          AND (p_site IS NULL OR COALESCE(site, 'cn') = p_site)
    ),
    ledger_scoped AS (
        SELECT
            amount,
            LOWER(BTRIM(COALESCE(reason, ''))) AS lower_reason
        FROM public.points_ledger
        WHERE created_at >= p_start_at
          AND (p_end_at IS NULL OR created_at <= p_end_at)
          AND (p_site IS NULL OR COALESCE(site, 'cn') = p_site)
    ),
    ledger_summary AS (
        SELECT
            ROUND(COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0), 1) AS points_inflow,
            ROUND(COALESCE(ABS(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END)), 0), 1) AS points_outflow
        FROM ledger_scoped
    ),
    categorized_ledger AS (
        SELECT
            CASE
                WHEN amount >= 0 AND (
                    lower_reason LIKE '%充值%'
                    OR lower_reason LIKE '%recharge%'
                    OR lower_reason LIKE '%package_purchase%'
                    OR lower_reason LIKE '%模拟充值%'
                    OR lower_reason LIKE '%afdian%'
                ) THEN 'recharge'
                WHEN amount >= 0 AND (
                    lower_reason LIKE '%兑换码%'
                    OR lower_reason LIKE '%redeem%'
                ) THEN 'redeem_code'
                WHEN amount >= 0 AND (
                    lower_reason LIKE '%返佣%'
                    OR lower_reason LIKE '%奖励%'
                    OR lower_reason LIKE '%reward%'
                    OR lower_reason LIKE '%signup%'
                    OR lower_reason LIKE '%checkin%'
                ) THEN 'rewards'
                WHEN amount >= 0 AND (
                    lower_reason LIKE '%refund%'
                    OR lower_reason LIKE '%退款%'
                ) THEN 'refund'
                WHEN amount >= 0 AND (
                    lower_reason LIKE '%admin%'
                    OR lower_reason LIKE '%manual%'
                    OR lower_reason LIKE '%系统%'
                ) THEN 'admin_in'
                WHEN amount >= 0 THEN 'other_in'
                WHEN lower_reason LIKE '%商城购买%'
                    OR lower_reason LIKE '%shop_purchase%' THEN 'shop_purchase'
                WHEN lower_reason LIKE '%unlock%'
                    OR lower_reason LIKE '%解锁%' THEN 'content_unlock'
                WHEN lower_reason LIKE '%验证%'
                    OR lower_reason LIKE '%gemini%'
                    OR lower_reason LIKE '%verify%' THEN 'verification'
                WHEN lower_reason LIKE '%refund%'
                    OR lower_reason LIKE '%退款%' THEN 'refund_out'
                WHEN lower_reason LIKE '%deduct%'
                    OR lower_reason LIKE '%扣除%'
                    OR lower_reason LIKE '%admin%' THEN 'admin_deduct'
                ELSE 'other_out'
            END AS category_key,
            CASE
                WHEN amount >= 0 AND (
                    lower_reason LIKE '%充值%'
                    OR lower_reason LIKE '%recharge%'
                    OR lower_reason LIKE '%package_purchase%'
                    OR lower_reason LIKE '%模拟充值%'
                    OR lower_reason LIKE '%afdian%'
                ) THEN '充值入账'
                WHEN amount >= 0 AND (
                    lower_reason LIKE '%兑换码%'
                    OR lower_reason LIKE '%redeem%'
                ) THEN '兑换码入账'
                WHEN amount >= 0 AND (
                    lower_reason LIKE '%返佣%'
                    OR lower_reason LIKE '%奖励%'
                    OR lower_reason LIKE '%reward%'
                    OR lower_reason LIKE '%signup%'
                    OR lower_reason LIKE '%checkin%'
                ) THEN '奖励 / 返佣'
                WHEN amount >= 0 AND (
                    lower_reason LIKE '%refund%'
                    OR lower_reason LIKE '%退款%'
                ) THEN '退款返还'
                WHEN amount >= 0 AND (
                    lower_reason LIKE '%admin%'
                    OR lower_reason LIKE '%manual%'
                    OR lower_reason LIKE '%系统%'
                ) THEN '管理入账'
                WHEN amount >= 0 THEN '其他入账'
                WHEN lower_reason LIKE '%商城购买%'
                    OR lower_reason LIKE '%shop_purchase%' THEN '商城消费'
                WHEN lower_reason LIKE '%unlock%'
                    OR lower_reason LIKE '%解锁%' THEN '内容解锁'
                WHEN lower_reason LIKE '%验证%'
                    OR lower_reason LIKE '%gemini%'
                    OR lower_reason LIKE '%verify%' THEN '验证消耗'
                WHEN lower_reason LIKE '%refund%'
                    OR lower_reason LIKE '%退款%' THEN '退款扣回'
                WHEN lower_reason LIKE '%deduct%'
                    OR lower_reason LIKE '%扣除%'
                    OR lower_reason LIKE '%admin%' THEN '管理扣减'
                ELSE '其他支出'
            END AS category_label,
            CASE WHEN amount >= 0 THEN amount ELSE 0 END AS inflow,
            CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END AS outflow
        FROM ledger_scoped
    ),
    points_breakdown_rows AS (
        SELECT
            category_key,
            category_label,
            ROUND(COALESCE(SUM(inflow), 0), 1) AS inflow,
            ROUND(COALESCE(SUM(outflow), 0), 1) AS outflow,
            ROUND(COALESCE(SUM(inflow), 0) - COALESCE(SUM(outflow), 0), 1) AS net
        FROM categorized_ledger
        GROUP BY 1, 2
    ),
    points_breakdown AS (
        SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
                'key', category_key,
                'label', category_label,
                'inflow', inflow,
                'outflow', outflow,
                'net', net
            )
            ORDER BY ABS(net) DESC, category_key ASC
        ), '[]'::JSONB) AS rows
        FROM points_breakdown_rows
    ),
    balance_summary AS (
        SELECT
            ROUND(COALESCE(SUM(COALESCE(total_balance, 0)), 0), 1) AS circulating_points,
            ROUND(COALESCE(SUM(COALESCE(paid_balance, 0)), 0), 1) AS paid_balance,
            ROUND(COALESCE(SUM(COALESCE(bonus_balance, 0)), 0), 1) AS bonus_balance,
            COUNT(*)::INTEGER AS balance_account_count
        FROM public.points_balance
        WHERE p_site IS NULL OR COALESCE(site, 'cn') = p_site
    ),
    mock_summary AS (
        SELECT
            COUNT(*)::INTEGER AS mock_recharge_order_count,
            ROUND(COALESCE(SUM(COALESCE(points_amount, 0)), 0), 1) AS mock_recharge_points
        FROM filtered_orders
        WHERE LOWER(BTRIM(COALESCE(provider, ''))) = 'mock'
          AND LOWER(BTRIM(COALESCE(status, ''))) IN ('paid', 'redeemed')
    )
    SELECT jsonb_build_object(
        'overview', jsonb_build_object(
            'total_orders', overview_data.total_orders,
            'paid_orders', overview_data.paid_orders,
            'redeemed_orders', overview_data.redeemed_orders,
            'claimed_orders', overview_data.claimed_orders,
            'review_orders', overview_data.review_orders,
            'failed_orders', overview_data.failed_orders,
            'total_amount', overview_data.total_amount,
            'total_points', overview_data.total_points,
            'paid_rate', CASE
                WHEN overview_data.total_orders > 0 THEN ROUND((overview_data.paid_orders::NUMERIC / overview_data.total_orders::NUMERIC) * 100, 2)
                ELSE 0
            END,
            'claim_rate', CASE
                WHEN overview_data.paid_orders > 0 THEN ROUND((overview_data.claimed_orders::NUMERIC / overview_data.paid_orders::NUMERIC) * 100, 2)
                ELSE 0
            END
        ),
        'anomaly_summary', jsonb_build_object(
            'review_orders', overview_data.review_orders,
            'failed_orders', overview_data.failed_orders,
            'unclaimed_paid_orders', overview_data.unclaimed_paid_orders,
            'recent_event_anomalies', 0,
            'duplicate_webhook_orders', 0,
            'refund_failures', 0,
            'refund_reclaim_failures', 0,
            'refund_compensation_failures', 0,
            'query_failures', 0,
            'stale_checkout_sessions', 0,
            'failed_checkout_sessions', 0,
            'completed_unlinked_sessions', 0,
            'unmatched_session_orders', 0,
            'webhook_linked_sessions', 0,
            'fallback_linked_sessions', 0,
            'session_anomalies', 0,
            'open_cases', 0,
            'handled_cases', 0,
            'ignored_cases', 0,
            'retry_requested_cases', 0
        ),
        'provider_stats', provider_stats.rows,
        'sitewide_summary', jsonb_build_object(
            'recharge_amount', ROUND(COALESCE((SELECT SUM(effective_amount) FROM successful_orders), 0), 2),
            'recharge_points', ROUND(COALESCE((SELECT SUM(COALESCE(points_amount, 0)) FROM successful_orders), 0), 1),
            'recharge_order_count', (SELECT COUNT(*)::INTEGER FROM successful_orders),
            'shop_points_spent', shop_summary.shop_points_spent,
            'shop_order_count', shop_summary.shop_order_count,
            'refunded_shop_points', shop_summary.refunded_shop_points,
            'refunded_shop_order_count', shop_summary.refunded_shop_order_count,
            'points_inflow', ledger_summary.points_inflow,
            'points_outflow', ledger_summary.points_outflow,
            'net_points_flow', ROUND(COALESCE(ledger_summary.points_inflow, 0) - COALESCE(ledger_summary.points_outflow, 0), 1),
            'circulating_points', balance_summary.circulating_points,
            'paid_balance', balance_summary.paid_balance,
            'bonus_balance', balance_summary.bonus_balance,
            'balance_account_count', balance_summary.balance_account_count,
            'mock_recharge_order_count', mock_summary.mock_recharge_order_count,
            'mock_recharge_points', mock_summary.mock_recharge_points
        ),
        'points_breakdown', points_breakdown.rows
    )
    INTO v_result
    FROM overview_data, provider_stats, shop_summary, ledger_summary, balance_summary, mock_summary, points_breakdown;

    RETURN COALESCE(v_result, jsonb_build_object(
        'overview', jsonb_build_object(
            'total_orders', 0,
            'paid_orders', 0,
            'redeemed_orders', 0,
            'claimed_orders', 0,
            'review_orders', 0,
            'failed_orders', 0,
            'total_amount', 0,
            'total_points', 0,
            'paid_rate', 0,
            'claim_rate', 0
        ),
        'anomaly_summary', jsonb_build_object(
            'review_orders', 0,
            'failed_orders', 0,
            'unclaimed_paid_orders', 0,
            'recent_event_anomalies', 0,
            'duplicate_webhook_orders', 0,
            'refund_failures', 0,
            'refund_reclaim_failures', 0,
            'refund_compensation_failures', 0,
            'query_failures', 0,
            'stale_checkout_sessions', 0,
            'failed_checkout_sessions', 0,
            'completed_unlinked_sessions', 0,
            'unmatched_session_orders', 0,
            'webhook_linked_sessions', 0,
            'fallback_linked_sessions', 0,
            'session_anomalies', 0,
            'open_cases', 0,
            'handled_cases', 0,
            'ignored_cases', 0,
            'retry_requested_cases', 0
        ),
        'provider_stats', '[]'::JSONB,
        'sitewide_summary', jsonb_build_object(
            'recharge_amount', 0,
            'recharge_points', 0,
            'recharge_order_count', 0,
            'shop_points_spent', 0,
            'shop_order_count', 0,
            'refunded_shop_points', 0,
            'refunded_shop_order_count', 0,
            'points_inflow', 0,
            'points_outflow', 0,
            'net_points_flow', 0,
            'circulating_points', 0,
            'paid_balance', 0,
            'bonus_balance', 0,
            'balance_account_count', 0,
            'mock_recharge_order_count', 0,
            'mock_recharge_points', 0
        ),
        'points_breakdown', '[]'::JSONB
    ));
END;
$$;

REVOKE ALL ON FUNCTION public.fn_admin_get_payment_finance_summary(TIMESTAMPTZ, TIMESTAMPTZ, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_admin_get_payment_finance_summary(TIMESTAMPTZ, TIMESTAMPTZ, VARCHAR) TO service_role;
