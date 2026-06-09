-- Aggregate-heavy overview summary for Admin Payments.
-- This moves the overview tab's biggest rollups into PostgreSQL so the API no
-- longer has to page through payment_orders / payment_events /
-- payment_query_attempts / payment_checkout_sessions in Node.js.

CREATE OR REPLACE FUNCTION public.fn_admin_get_payment_overview_summary(
    p_start_at TIMESTAMPTZ,
    p_end_at TIMESTAMPTZ DEFAULT NULL,
    p_trend_start_at TIMESTAMPTZ DEFAULT NULL,
    p_site VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
AS $$
WITH constants AS (
    SELECT
        TIMESTAMPTZ '2026-03-21T00:00:00.000Z' AS session_feature_start,
        date_trunc('hour', NOW()) AS current_hour,
        COALESCE(p_trend_start_at, NOW() - INTERVAL '24 hours') AS trend_start_at
),
filtered_orders AS (
    SELECT
        po.id,
        po.provider,
        po.provider_order_no,
        po.package_name,
        po.paid_amount,
        po.expected_amount,
        po.points_amount,
        po.status,
        po.user_id,
        po.created_at,
        po.paid_at,
        po.claimed_at,
        po.site,
        po.last_error,
        po.provider_metadata,
        po.checkout_session_id
    FROM public.payment_orders po
    WHERE po.created_at >= p_start_at
      AND (p_end_at IS NULL OR po.created_at <= p_end_at)
      AND (p_site IS NULL OR po.site = p_site)
),
real_sessions AS (
    SELECT
        pcs.id::TEXT AS session_id,
        pcs.session_key,
        pcs.provider,
        pcs.user_id,
        pcs.site,
        pcs.package_name,
        pcs.expected_amount,
        LOWER(BTRIM(COALESCE(pcs.status, ''))) AS status,
        pcs.payment_order_id,
        pcs.provider_metadata,
        pcs.error_message,
        pcs.created_at,
        pcs.updated_at
    FROM public.payment_checkout_sessions pcs
    WHERE pcs.created_at >= p_start_at
      AND (p_end_at IS NULL OR pcs.created_at <= p_end_at)
      AND (p_site IS NULL OR pcs.site = p_site)
),
synthetic_sessions AS (
    SELECT
        COALESCE(
            NULLIF(BTRIM(COALESCE(fo.checkout_session_id::TEXT, '')), ''),
            NULLIF(BTRIM(COALESCE(fo.provider_metadata->>'checkout_session_id', '')), ''),
            'synthetic_' || fo.id::TEXT
        ) AS session_id,
        NULLIF(BTRIM(COALESCE(fo.provider_metadata->>'checkout_session_key', '')), '') AS session_key,
        fo.provider,
        fo.user_id,
        fo.site,
        fo.package_name,
        COALESCE(fo.expected_amount, fo.paid_amount, 0) AS expected_amount,
        LOWER(BTRIM(COALESCE(
            NULLIF(fo.provider_metadata->>'checkout_session_status', ''),
            CASE
                WHEN LOWER(BTRIM(COALESCE(fo.status, ''))) IN ('paid', 'redeemed') THEN 'completed'
                ELSE 'created'
            END
        ))) AS status,
        fo.id AS payment_order_id,
        jsonb_build_object(
            'provider_order_no', COALESCE(NULLIF(BTRIM(COALESCE(fo.provider_metadata->>'provider_order_no', '')), ''), NULLIF(BTRIM(COALESCE(fo.provider_order_no, '')), '')),
            'payment_status', COALESCE(NULLIF(BTRIM(COALESCE(fo.provider_metadata->>'checkout_session_status', '')), ''), LOWER(BTRIM(COALESCE(fo.status, '')))),
            'linked_by', NULLIF(BTRIM(COALESCE(fo.provider_metadata->>'checkout_session_linked_by', '')), ''),
            'linked_at', NULLIF(BTRIM(COALESCE(fo.provider_metadata->>'checkout_session_linked_at', '')), '')
        ) AS provider_metadata,
        NULLIF(BTRIM(COALESCE(fo.last_error, '')), '') AS error_message,
        fo.created_at,
        fo.created_at AS updated_at
    FROM filtered_orders fo
    WHERE (
        NULLIF(BTRIM(COALESCE(fo.checkout_session_id::TEXT, '')), '') IS NOT NULL
        OR NULLIF(BTRIM(COALESCE(fo.provider_metadata->>'checkout_session_id', '')), '') IS NOT NULL
        OR NULLIF(BTRIM(COALESCE(fo.provider_metadata->>'checkout_session_key', '')), '') IS NOT NULL
    )
      AND NOT EXISTS (
          SELECT 1
          FROM real_sessions rs
          WHERE rs.session_id = COALESCE(
              NULLIF(BTRIM(COALESCE(fo.checkout_session_id::TEXT, '')), ''),
              NULLIF(BTRIM(COALESCE(fo.provider_metadata->>'checkout_session_id', '')), '')
          )
             OR (
                 NULLIF(BTRIM(COALESCE(fo.provider_metadata->>'checkout_session_key', '')), '') IS NOT NULL
                 AND rs.session_key = NULLIF(BTRIM(COALESCE(fo.provider_metadata->>'checkout_session_key', '')), '')
             )
      )
),
merged_sessions AS (
    SELECT * FROM real_sessions
    UNION ALL
    SELECT * FROM synthetic_sessions
),
visible_orders AS (
    SELECT
        fo.*,
        (
            LOWER(BTRIM(COALESCE(fo.status, ''))) = 'pending'
            AND (
                fo.provider_metadata->>'provider_order_resolved' = 'false'
                OR fo.provider_metadata->>'provider_order_pending' = 'true'
                OR fo.provider_metadata->>'order_origin' = 'payment_checkout_session'
                OR UPPER(BTRIM(COALESCE(fo.provider_order_no, ''))) LIKE 'PENDING_%'
            )
        ) AS is_intent_only,
        (
            LOWER(BTRIM(COALESCE(fo.provider, ''))) IN ('mock', 'afdian', 'hupijiao')
            AND (
                NULLIF(BTRIM(COALESCE(fo.checkout_session_id::TEXT, '')), '') IS NOT NULL
                OR NULLIF(BTRIM(COALESCE(fo.provider_metadata->>'checkout_session_id', '')), '') IS NOT NULL
                OR NULLIF(BTRIM(COALESCE(fo.provider_metadata->>'checkout_session_key', '')), '') IS NOT NULL
                OR fo.created_at >= (SELECT session_feature_start FROM constants)
            )
        ) AS checkout_session_required,
        (
            EXISTS (
                SELECT 1
                FROM merged_sessions ms
                WHERE ms.payment_order_id = fo.id
            )
            OR NULLIF(BTRIM(COALESCE(fo.checkout_session_id::TEXT, '')), '') IS NOT NULL
            OR NULLIF(BTRIM(COALESCE(fo.provider_metadata->>'checkout_session_id', '')), '') IS NOT NULL
        ) AS checkout_session_matched
    FROM filtered_orders fo
),
scoped_orders AS (
    SELECT *
    FROM visible_orders
    WHERE NOT is_intent_only
),
filtered_query_attempts AS (
    SELECT
        pqa.id,
        pqa.provider,
        pqa.site,
        pqa.order_no,
        pqa.user_id,
        pqa.payment_order_id,
        pqa.checkout_session_id,
        pqa.success,
        pqa.response_status,
        pqa.outcome_code,
        pqa.message,
        pqa.created_at
    FROM public.payment_query_attempts pqa
    WHERE pqa.created_at >= p_start_at
      AND (p_end_at IS NULL OR pqa.created_at <= p_end_at)
      AND (p_site IS NULL OR pqa.site = p_site)
),
scoped_events AS (
    SELECT
        pe.id,
        pe.payment_order_id,
        pe.provider,
        pe.provider_order_no,
        pe.event_type,
        pe.signature_valid,
        pe.amount_valid,
        pe.processing_result,
        pe.error_message,
        pe.response_status,
        pe.created_at
    FROM public.payment_events pe
    WHERE pe.created_at >= p_start_at
      AND (p_end_at IS NULL OR pe.created_at <= p_end_at)
      AND (
          p_site IS NULL
          OR EXISTS (
              SELECT 1
              FROM scoped_orders so
              WHERE so.id = pe.payment_order_id
          )
          OR EXISTS (
              SELECT 1
              FROM scoped_orders so
              WHERE so.provider_order_no = pe.provider_order_no
          )
      )
),
overview_counts AS (
    SELECT
        COUNT(*)::INTEGER AS total_orders,
        COUNT(*) FILTER (WHERE LOWER(BTRIM(COALESCE(status, ''))) IN ('paid', 'redeemed'))::INTEGER AS paid_orders,
        COUNT(*) FILTER (WHERE LOWER(BTRIM(COALESCE(status, ''))) = 'redeemed')::INTEGER AS redeemed_orders,
        COUNT(*) FILTER (WHERE user_id IS NOT NULL)::INTEGER AS claimed_orders,
        COUNT(*) FILTER (WHERE LOWER(BTRIM(COALESCE(status, ''))) = 'pending_review')::INTEGER AS review_orders,
        COUNT(*) FILTER (WHERE LOWER(BTRIM(COALESCE(status, ''))) IN ('rejected', 'amount_mismatch'))::INTEGER AS failed_orders,
        COUNT(*) FILTER (WHERE LOWER(BTRIM(COALESCE(status, ''))) = 'paid' AND user_id IS NULL)::INTEGER AS unclaimed_paid_orders,
        ROUND(COALESCE(SUM(CASE WHEN LOWER(BTRIM(COALESCE(status, ''))) IN ('paid', 'redeemed') THEN COALESCE(paid_amount, expected_amount, 0) ELSE 0 END), 0), 2) AS total_amount,
        ROUND(COALESCE(SUM(CASE WHEN LOWER(BTRIM(COALESCE(status, ''))) IN ('paid', 'redeemed') THEN COALESCE(points_amount, 0) ELSE 0 END), 0), 1) AS total_points
    FROM scoped_orders
),
session_counts AS (
    SELECT
        COUNT(*)::INTEGER AS total_sessions,
        COUNT(*) FILTER (WHERE payment_order_id IS NOT NULL)::INTEGER AS matched_sessions,
        COUNT(*) FILTER (WHERE status IN ('created', 'redirect_ready'))::INTEGER AS open_sessions,
        COUNT(*) FILTER (
            WHERE payment_order_id IS NULL
              AND status IN ('created', 'redirect_ready')
              AND EXTRACT(EPOCH FROM (NOW() - created_at)) / 60 >= 30
        )::INTEGER AS stale_sessions,
        COUNT(*) FILTER (WHERE status IN ('failed', 'expired', 'cancelled'))::INTEGER AS failed_sessions,
        COUNT(*) FILTER (WHERE payment_order_id IS NULL AND status = 'completed')::INTEGER AS completed_unlinked_sessions,
        COUNT(*) FILTER (
            WHERE payment_order_id IS NOT NULL
              AND LOWER(BTRIM(COALESCE(provider_metadata->>'linked_by', ''))) LIKE '%webhook%'
        )::INTEGER AS webhook_linked_sessions,
        COUNT(*) FILTER (
            WHERE payment_order_id IS NOT NULL
              AND (
                  LOWER(BTRIM(COALESCE(provider_metadata->>'linked_by', ''))) LIKE '%query%'
                  OR LOWER(BTRIM(COALESCE(provider_metadata->>'linked_by', ''))) LIKE '%claim%'
                  OR LOWER(BTRIM(COALESCE(provider_metadata->>'linked_by', ''))) LIKE '%fallback%'
              )
        )::INTEGER AS fallback_linked_sessions,
        COUNT(*) FILTER (
            WHERE payment_order_id IS NOT NULL
              AND NULLIF(BTRIM(COALESCE(provider_metadata->>'linked_by', '')), '') IS NOT NULL
              AND LOWER(BTRIM(COALESCE(provider_metadata->>'linked_by', ''))) NOT LIKE '%webhook%'
              AND LOWER(BTRIM(COALESCE(provider_metadata->>'linked_by', ''))) NOT LIKE '%query%'
              AND LOWER(BTRIM(COALESCE(provider_metadata->>'linked_by', ''))) NOT LIKE '%claim%'
              AND LOWER(BTRIM(COALESCE(provider_metadata->>'linked_by', ''))) NOT LIKE '%fallback%'
        )::INTEGER AS direct_linked_sessions
    FROM merged_sessions
),
eligible_order_counts AS (
    SELECT
        COUNT(*) FILTER (WHERE checkout_session_required)::INTEGER AS eligible_orders,
        COUNT(*) FILTER (WHERE checkout_session_required AND checkout_session_matched)::INTEGER AS matched_orders,
        COUNT(*) FILTER (WHERE checkout_session_required AND NOT checkout_session_matched)::INTEGER AS unmatched_orders
    FROM scoped_orders
),
event_anomaly_rows AS (
    SELECT
        se.*,
        (
            se.signature_valid = FALSE
            OR se.amount_valid = FALSE
            OR NULLIF(BTRIM(COALESCE(se.error_message, '')), '') IS NOT NULL
            OR (
                NULLIF(BTRIM(COALESCE(se.processing_result, '')), '') IS NOT NULL
                AND LOWER(BTRIM(COALESCE(se.processing_result, ''))) NOT IN (
                    'processed_paid',
                    'received',
                    'ignored_pending',
                    'ignored_non_success_ec',
                    'ignored_non_order_event',
                    'ignored_non_paid_status',
                    'admin_refund_processed',
                    'admin_refund_synced_refunded'
                )
            )
        ) AS is_anomaly,
        (
            se.signature_valid = FALSE
            OR se.amount_valid = FALSE
            OR LOWER(BTRIM(COALESCE(se.processing_result, ''))) IN (
                'webhook_exception',
                'process_rpc_failed',
                'missing_signature',
                'invalid_order_no',
                'missing_afdian_token',
                'admin_refund_failed',
                'admin_refund_reclaim_failed',
                'admin_refund_compensation_failed'
            )
        ) AS is_failed
    FROM scoped_events se
),
event_anomaly_counts AS (
    SELECT COUNT(*) FILTER (WHERE is_anomaly)::INTEGER AS anomaly_count
    FROM event_anomaly_rows
),
duplicate_webhooks AS (
    SELECT COUNT(*)::INTEGER AS duplicate_webhook_orders
    FROM (
        SELECT provider_order_no
        FROM scoped_events
        WHERE NULLIF(BTRIM(COALESCE(provider_order_no, '')), '') IS NOT NULL
          AND NOT (
              LOWER(BTRIM(COALESCE(provider, ''))) = 'nowpayments'
              AND LOWER(BTRIM(COALESCE(event_type, 'webhook'))) = 'webhook'
              AND (response_status IS NULL OR (response_status >= 200 AND response_status < 300))
              AND signature_valid IS DISTINCT FROM FALSE
              AND amount_valid IS DISTINCT FROM FALSE
              AND LOWER(BTRIM(COALESCE(processing_result, ''))) IN ('ignored_pending', 'processed_paid', 'received')
          )
        GROUP BY provider_order_no
        HAVING COUNT(*) > 1
    ) duplicates
),
query_base AS (
    SELECT
        COUNT(*)::INTEGER AS total_attempts,
        COUNT(*) FILTER (WHERE success = TRUE)::INTEGER AS success_attempts,
        COUNT(*) FILTER (WHERE success IS DISTINCT FROM TRUE)::INTEGER AS failed_attempts
    FROM filtered_query_attempts
),
query_outcomes AS (
    SELECT
        LOWER(BTRIM(COALESCE(outcome_code, 'unknown'))) AS outcome_code,
        CASE LOWER(BTRIM(COALESCE(outcome_code, 'unknown')))
            WHEN 'success' THEN '查码成功'
            WHEN 'missing_order_no' THEN '未填写订单号'
            WHEN 'unauthenticated' THEN '未登录查询'
            WHEN 'access_denied' THEN '订单归属冲突'
            WHEN 'query_rpc_failed' THEN '查码 RPC 失败'
            WHEN 'not_found' THEN '未找到订单'
            WHEN 'rejected' THEN '订单已被拦截'
            WHEN 'amount_mismatch' THEN '订单金额异常'
            WHEN 'code_pending' THEN '兑换码未就绪'
            WHEN 'query_exception' THEN '查码接口异常'
            ELSE COALESCE(NULLIF(BTRIM(COALESCE(outcome_code, '')), ''), 'unknown')
        END AS label,
        CASE LOWER(BTRIM(COALESCE(outcome_code, 'unknown')))
            WHEN 'success' THEN 'info'
            WHEN 'missing_order_no' THEN 'info'
            WHEN 'unauthenticated' THEN 'warning'
            WHEN 'access_denied' THEN 'critical'
            WHEN 'query_rpc_failed' THEN 'critical'
            WHEN 'not_found' THEN 'warning'
            WHEN 'rejected' THEN 'critical'
            WHEN 'amount_mismatch' THEN 'critical'
            WHEN 'code_pending' THEN 'warning'
            WHEN 'query_exception' THEN 'critical'
            ELSE 'warning'
        END AS severity,
        COUNT(*)::INTEGER AS count
    FROM filtered_query_attempts
    WHERE success IS DISTINCT FROM TRUE
    GROUP BY 1, 2, 3
    ORDER BY COUNT(*) DESC, LOWER(BTRIM(COALESCE(outcome_code, 'unknown'))) ASC
    LIMIT 6
),
refund_events AS (
    SELECT
        ear.id::TEXT AS id,
        ear.provider,
        ear.provider_order_no,
        LOWER(BTRIM(COALESCE(ear.processing_result, ''))) AS status,
        CASE LOWER(BTRIM(COALESCE(ear.processing_result, '')))
            WHEN 'admin_refund_failed' THEN 'warning'
            WHEN 'admin_refund_reclaim_failed' THEN 'critical'
            WHEN 'admin_refund_compensation_failed' THEN 'critical'
            ELSE 'warning'
        END AS severity,
        CASE LOWER(BTRIM(COALESCE(ear.processing_result, '')))
            WHEN 'admin_refund_failed' THEN '退款失败已补回'
            WHEN 'admin_refund_reclaim_failed' THEN '退款积分扣回失败'
            WHEN 'admin_refund_compensation_failed' THEN '退款积分回滚失败'
            ELSE '退款异常'
        END AS title,
        COALESCE(
            NULLIF(BTRIM(COALESCE(ear.error_message, '')), ''),
            CASE LOWER(BTRIM(COALESCE(ear.processing_result, '')))
                WHEN 'admin_refund_failed' THEN '网关退款失败，但系统已自动补回积分，请复核退款通道返回值。'
                WHEN 'admin_refund_reclaim_failed' THEN '已入账订单在退款前无法安全扣回积分，系统已停止继续发起网关退款。'
                WHEN 'admin_refund_compensation_failed' THEN '网关退款失败后，系统自动补回积分也失败了，需要立即人工修复账务。'
                ELSE '退款异常待人工复核。'
            END
        ) AS message,
        ear.created_at,
        CASE LOWER(BTRIM(COALESCE(ear.processing_result, '')))
            WHEN 'admin_refund_failed' THEN 'refund_failures'
            WHEN 'admin_refund_reclaim_failed' THEN 'refund_reclaim_failures'
            WHEN 'admin_refund_compensation_failed' THEN 'refund_compensation_failures'
            ELSE 'refund_failures'
        END AS topic_key,
        CASE LOWER(BTRIM(COALESCE(ear.processing_result, '')))
            WHEN 'admin_refund_failed' THEN '退款失败'
            WHEN 'admin_refund_reclaim_failed' THEN '扣回失败'
            WHEN 'admin_refund_compensation_failed' THEN '回滚失败'
            ELSE '退款失败'
        END AS topic_label,
        ROW_NUMBER() OVER (
            PARTITION BY LOWER(BTRIM(COALESCE(ear.processing_result, '')))
            ORDER BY ear.created_at DESC, ear.id DESC
        ) AS topic_rank
    FROM event_anomaly_rows ear
    WHERE LOWER(BTRIM(COALESCE(ear.processing_result, ''))) IN (
        'admin_refund_failed',
        'admin_refund_reclaim_failed',
        'admin_refund_compensation_failed'
    )
),
refund_topic_counts AS (
    SELECT
        topic_key,
        topic_label,
        MAX(severity) AS severity,
        COUNT(*)::INTEGER AS count
    FROM refund_events
    GROUP BY 1, 2
),
trend_buckets AS (
    SELECT generate_series(
        (SELECT current_hour FROM constants) - INTERVAL '23 hours',
        (SELECT current_hour FROM constants),
        INTERVAL '1 hour'
    ) AS bucket_start
),
trend_counts AS (
    SELECT
        date_trunc('hour', created_at) AS bucket_start,
        COUNT(*)::INTEGER AS total_events,
        COUNT(*) FILTER (WHERE is_anomaly)::INTEGER AS anomaly_events,
        COUNT(*) FILTER (WHERE is_failed)::INTEGER AS failed_events
    FROM event_anomaly_rows
    WHERE created_at >= (SELECT trend_start_at FROM constants)
    GROUP BY 1
),
provider_dimension AS (
    SELECT provider FROM (
        SELECT COALESCE(NULLIF(BTRIM(COALESCE(provider, '')), ''), 'unknown') AS provider FROM scoped_orders
        UNION
        SELECT COALESCE(NULLIF(BTRIM(COALESCE(provider, '')), ''), 'unknown') AS provider FROM merged_sessions
        UNION
        SELECT COALESCE(NULLIF(BTRIM(COALESCE(provider, '')), ''), 'unknown') AS provider FROM scoped_events
        UNION
        SELECT COALESCE(NULLIF(BTRIM(COALESCE(provider, '')), ''), 'unknown') AS provider FROM filtered_query_attempts
    ) providers
),
order_provider_stats AS (
    SELECT
        COALESCE(NULLIF(BTRIM(COALESCE(provider, '')), ''), 'unknown') AS provider,
        COUNT(*)::INTEGER AS total_orders,
        COUNT(*) FILTER (WHERE LOWER(BTRIM(COALESCE(status, ''))) IN ('paid', 'redeemed'))::INTEGER AS paid_orders,
        COUNT(*) FILTER (WHERE user_id IS NOT NULL)::INTEGER AS claimed_orders,
        COUNT(*) FILTER (WHERE LOWER(BTRIM(COALESCE(status, ''))) = 'pending_review')::INTEGER AS review_orders,
        COUNT(*) FILTER (WHERE LOWER(BTRIM(COALESCE(status, ''))) IN ('rejected', 'amount_mismatch'))::INTEGER AS failed_orders,
        ROUND(COALESCE(SUM(CASE WHEN LOWER(BTRIM(COALESCE(status, ''))) IN ('paid', 'redeemed') THEN COALESCE(paid_amount, expected_amount, 0) ELSE 0 END), 0), 2) AS total_amount,
        ROUND(COALESCE(SUM(CASE WHEN LOWER(BTRIM(COALESCE(status, ''))) IN ('paid', 'redeemed') THEN COALESCE(points_amount, 0) ELSE 0 END), 0), 1) AS total_points,
        COUNT(*) FILTER (WHERE checkout_session_required)::INTEGER AS eligible_orders,
        COUNT(*) FILTER (WHERE checkout_session_required AND checkout_session_matched)::INTEGER AS matched_orders,
        COUNT(*) FILTER (WHERE checkout_session_required AND NOT checkout_session_matched)::INTEGER AS unmatched_orders
    FROM scoped_orders
    GROUP BY 1
),
session_provider_stats AS (
    SELECT
        COALESCE(NULLIF(BTRIM(COALESCE(provider, '')), ''), 'unknown') AS provider,
        COUNT(*)::INTEGER AS session_total,
        COUNT(*) FILTER (WHERE payment_order_id IS NOT NULL)::INTEGER AS session_matched,
        COUNT(*) FILTER (
            WHERE payment_order_id IS NULL
              AND status IN ('created', 'redirect_ready')
              AND EXTRACT(EPOCH FROM (NOW() - created_at)) / 60 >= 30
        )::INTEGER AS session_stale,
        COUNT(*) FILTER (WHERE status IN ('failed', 'expired', 'cancelled'))::INTEGER AS session_failed,
        COUNT(*) FILTER (WHERE payment_order_id IS NULL AND status = 'completed')::INTEGER AS session_completed_unlinked,
        COUNT(*) FILTER (
            WHERE payment_order_id IS NOT NULL
              AND LOWER(BTRIM(COALESCE(provider_metadata->>'linked_by', ''))) LIKE '%webhook%'
        )::INTEGER AS webhook_links,
        COUNT(*) FILTER (
            WHERE payment_order_id IS NOT NULL
              AND (
                  LOWER(BTRIM(COALESCE(provider_metadata->>'linked_by', ''))) LIKE '%query%'
                  OR LOWER(BTRIM(COALESCE(provider_metadata->>'linked_by', ''))) LIKE '%claim%'
                  OR LOWER(BTRIM(COALESCE(provider_metadata->>'linked_by', ''))) LIKE '%fallback%'
              )
        )::INTEGER AS fallback_links,
        COUNT(*) FILTER (
            WHERE payment_order_id IS NOT NULL
              AND NULLIF(BTRIM(COALESCE(provider_metadata->>'linked_by', '')), '') IS NOT NULL
              AND LOWER(BTRIM(COALESCE(provider_metadata->>'linked_by', ''))) NOT LIKE '%webhook%'
              AND LOWER(BTRIM(COALESCE(provider_metadata->>'linked_by', ''))) NOT LIKE '%query%'
              AND LOWER(BTRIM(COALESCE(provider_metadata->>'linked_by', ''))) NOT LIKE '%claim%'
              AND LOWER(BTRIM(COALESCE(provider_metadata->>'linked_by', ''))) NOT LIKE '%fallback%'
        )::INTEGER AS direct_links
    FROM merged_sessions
    GROUP BY 1
),
event_provider_stats AS (
    SELECT
        COALESCE(NULLIF(BTRIM(COALESCE(provider, '')), ''), 'unknown') AS provider,
        COUNT(*)::INTEGER AS webhook_total,
        COUNT(*) FILTER (
            WHERE response_status IS NOT NULL
              AND response_status >= 400
              AND response_status < 500
        )::INTEGER AS webhook_4xx,
        COUNT(*) FILTER (
            WHERE response_status IS NOT NULL
              AND response_status >= 500
        )::INTEGER AS webhook_5xx,
        COUNT(*) FILTER (
            WHERE NOT (
                (response_status IS NOT NULL AND response_status >= 400)
                OR signature_valid = FALSE
                OR amount_valid = FALSE
                OR NULLIF(BTRIM(COALESCE(error_message, '')), '') IS NOT NULL
                OR (
                    NULLIF(BTRIM(COALESCE(processing_result, '')), '') IS NOT NULL
                    AND LOWER(BTRIM(COALESCE(processing_result, ''))) NOT IN (
                        'processed_paid',
                        'received',
                        'ignored_pending',
                        'ignored_non_success_ec',
                        'ignored_non_order_event',
                        'ignored_non_paid_status',
                        'admin_refund_processed',
                        'admin_refund_synced_refunded'
                    )
                )
            )
        )::INTEGER AS webhook_success
    FROM scoped_events
    GROUP BY 1
),
query_provider_stats AS (
    SELECT
        COALESCE(NULLIF(BTRIM(COALESCE(provider, '')), ''), 'unknown') AS provider,
        COUNT(*)::INTEGER AS query_total,
        COUNT(*) FILTER (WHERE success = TRUE)::INTEGER AS query_success,
        COUNT(*) FILTER (WHERE success IS DISTINCT FROM TRUE)::INTEGER AS query_failed,
        COUNT(*) FILTER (
            WHERE response_status IS NOT NULL
              AND response_status >= 400
              AND response_status < 500
        )::INTEGER AS query_4xx,
        COUNT(*) FILTER (
            WHERE response_status IS NOT NULL
              AND response_status >= 500
        )::INTEGER AS query_5xx
    FROM filtered_query_attempts
    GROUP BY 1
),
provider_stats AS (
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'provider', pd.provider,
                'total_orders', COALESCE(op.total_orders, 0),
                'paid_orders', COALESCE(op.paid_orders, 0),
                'claimed_orders', COALESCE(op.claimed_orders, 0),
                'review_orders', COALESCE(op.review_orders, 0),
                'failed_orders', COALESCE(op.failed_orders, 0),
                'total_amount', COALESCE(op.total_amount, 0),
                'total_points', COALESCE(op.total_points, 0),
                'eligible_orders', COALESCE(op.eligible_orders, 0),
                'matched_orders', COALESCE(op.matched_orders, 0),
                'unmatched_orders', COALESCE(op.unmatched_orders, 0),
                'session_total', COALESCE(sp.session_total, 0),
                'session_matched', COALESCE(sp.session_matched, 0),
                'session_stale', COALESCE(sp.session_stale, 0),
                'session_failed', COALESCE(sp.session_failed, 0),
                'session_completed_unlinked', COALESCE(sp.session_completed_unlinked, 0),
                'webhook_links', COALESCE(sp.webhook_links, 0),
                'fallback_links', COALESCE(sp.fallback_links, 0),
                'direct_links', COALESCE(sp.direct_links, 0),
                'webhook_total', COALESCE(ep.webhook_total, 0),
                'webhook_success', COALESCE(ep.webhook_success, 0),
                'webhook_failed', GREATEST(COALESCE(ep.webhook_total, 0) - COALESCE(ep.webhook_success, 0), 0),
                'webhook_4xx', COALESCE(ep.webhook_4xx, 0),
                'webhook_5xx', COALESCE(ep.webhook_5xx, 0),
                'query_total', COALESCE(qp.query_total, 0),
                'query_success', COALESCE(qp.query_success, 0),
                'query_failed', COALESCE(qp.query_failed, 0),
                'query_4xx', COALESCE(qp.query_4xx, 0),
                'query_5xx', COALESCE(qp.query_5xx, 0),
                'paid_rate', CASE
                    WHEN COALESCE(op.total_orders, 0) > 0 THEN ROUND((COALESCE(op.paid_orders, 0)::NUMERIC / op.total_orders::NUMERIC) * 100, 2)
                    ELSE 0
                END,
                'claim_rate', CASE
                    WHEN COALESCE(op.paid_orders, 0) > 0 THEN ROUND((COALESCE(op.claimed_orders, 0)::NUMERIC / op.paid_orders::NUMERIC) * 100, 2)
                    ELSE 0
                END,
                'session_match_rate', CASE
                    WHEN COALESCE(sp.session_total, 0) > 0 THEN ROUND((COALESCE(sp.session_matched, 0)::NUMERIC / sp.session_total::NUMERIC) * 100, 2)
                    ELSE 0
                END,
                'order_match_rate', CASE
                    WHEN COALESCE(op.eligible_orders, 0) > 0 THEN ROUND((COALESCE(op.matched_orders, 0)::NUMERIC / op.eligible_orders::NUMERIC) * 100, 2)
                    ELSE 0
                END,
                'webhook_success_rate', CASE
                    WHEN COALESCE(ep.webhook_total, 0) > 0 THEN ROUND((COALESCE(ep.webhook_success, 0)::NUMERIC / ep.webhook_total::NUMERIC) * 100, 2)
                    ELSE 0
                END,
                'query_success_rate', CASE
                    WHEN COALESCE(qp.query_total, 0) > 0 THEN ROUND((COALESCE(qp.query_success, 0)::NUMERIC / qp.query_total::NUMERIC) * 100, 2)
                    ELSE 0
                END,
                'auto_link_rate', CASE
                    WHEN COALESCE(sp.session_matched, 0) > 0 THEN ROUND((COALESCE(sp.webhook_links, 0)::NUMERIC / sp.session_matched::NUMERIC) * 100, 2)
                    ELSE 0
                END,
                'fallback_link_rate', CASE
                    WHEN COALESCE(sp.session_matched, 0) > 0 THEN ROUND((COALESCE(sp.fallback_links, 0)::NUMERIC / sp.session_matched::NUMERIC) * 100, 2)
                    ELSE 0
                END
            )
            ORDER BY COALESCE(op.total_orders, 0) DESC, COALESCE(op.total_amount, 0) DESC
        ),
        '[]'::JSONB
    ) AS rows
    FROM provider_dimension pd
    LEFT JOIN order_provider_stats op ON op.provider = pd.provider
    LEFT JOIN session_provider_stats sp ON sp.provider = pd.provider
    LEFT JOIN event_provider_stats ep ON ep.provider = pd.provider
    LEFT JOIN query_provider_stats qp ON qp.provider = pd.provider
),
trend_rows AS (
    SELECT
        tb.bucket_start,
        TO_CHAR(tb.bucket_start AT TIME ZONE 'UTC', 'MM-DD HH24:00') AS label,
        COALESCE(tc.total_events, 0) AS total_events,
        COALESCE(tc.anomaly_events, 0) AS anomaly_events,
        COALESCE(tc.failed_events, 0) AS failed_events
    FROM trend_buckets tb
    LEFT JOIN trend_counts tc ON tc.bucket_start = tb.bucket_start
    ORDER BY tb.bucket_start ASC
)
SELECT jsonb_build_object(
    'overview', jsonb_build_object(
        'total_orders', oc.total_orders,
        'paid_orders', oc.paid_orders,
        'redeemed_orders', oc.redeemed_orders,
        'claimed_orders', oc.claimed_orders,
        'review_orders', oc.review_orders,
        'failed_orders', oc.failed_orders,
        'total_amount', oc.total_amount,
        'total_points', oc.total_points,
        'paid_rate', CASE
            WHEN oc.total_orders > 0 THEN ROUND((oc.paid_orders::NUMERIC / oc.total_orders::NUMERIC) * 100, 2)
            ELSE 0
        END,
        'claim_rate', CASE
            WHEN oc.paid_orders > 0 THEN ROUND((oc.claimed_orders::NUMERIC / oc.paid_orders::NUMERIC) * 100, 2)
            ELSE 0
        END
    ),
    'session_summary', jsonb_build_object(
        'total_sessions', sc.total_sessions,
        'matched_sessions', sc.matched_sessions,
        'open_sessions', sc.open_sessions,
        'stale_sessions', sc.stale_sessions,
        'failed_sessions', sc.failed_sessions,
        'completed_unlinked_sessions', sc.completed_unlinked_sessions,
        'webhook_linked_sessions', sc.webhook_linked_sessions,
        'fallback_linked_sessions', sc.fallback_linked_sessions,
        'direct_linked_sessions', sc.direct_linked_sessions,
        'unmatched_orders', eoc.unmatched_orders,
        'eligible_orders', eoc.eligible_orders,
        'matched_orders', eoc.matched_orders,
        'match_rate', CASE
            WHEN sc.total_sessions > 0 THEN ROUND((sc.matched_sessions::NUMERIC / sc.total_sessions::NUMERIC) * 100, 2)
            ELSE 0
        END,
        'order_match_rate', CASE
            WHEN eoc.eligible_orders > 0 THEN ROUND((eoc.matched_orders::NUMERIC / eoc.eligible_orders::NUMERIC) * 100, 2)
            ELSE 0
        END,
        'anomaly_count', sc.stale_sessions + sc.failed_sessions + sc.completed_unlinked_sessions + eoc.unmatched_orders
    ),
    'query_summary', jsonb_build_object(
        'total_attempts', qb.total_attempts,
        'success_attempts', qb.success_attempts,
        'failed_attempts', qb.failed_attempts,
        'success_rate', CASE
            WHEN qb.total_attempts > 0 THEN ROUND((qb.success_attempts::NUMERIC / qb.total_attempts::NUMERIC) * 100, 2)
            ELSE 0
        END,
        'outcome_breakdown', COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'outcome_code', qo.outcome_code,
                    'label', qo.label,
                    'severity', qo.severity,
                    'count', qo.count
                )
                ORDER BY qo.count DESC, qo.outcome_code ASC
            )
            FROM query_outcomes qo
        ), '[]'::JSONB)
    ),
    'anomaly_summary', jsonb_build_object(
        'review_orders', oc.review_orders,
        'failed_orders', oc.failed_orders,
        'unclaimed_paid_orders', oc.unclaimed_paid_orders,
        'recent_event_anomalies', eac.anomaly_count,
        'duplicate_webhook_orders', dw.duplicate_webhook_orders,
        'refund_failures', COALESCE((SELECT count FROM refund_topic_counts WHERE topic_key = 'refund_failures'), 0),
        'refund_reclaim_failures', COALESCE((SELECT count FROM refund_topic_counts WHERE topic_key = 'refund_reclaim_failures'), 0),
        'refund_compensation_failures', COALESCE((SELECT count FROM refund_topic_counts WHERE topic_key = 'refund_compensation_failures'), 0),
        'query_failures', qb.failed_attempts,
        'stale_checkout_sessions', sc.stale_sessions,
        'failed_checkout_sessions', sc.failed_sessions,
        'completed_unlinked_sessions', sc.completed_unlinked_sessions,
        'unmatched_session_orders', eoc.unmatched_orders,
        'webhook_linked_sessions', sc.webhook_linked_sessions,
        'fallback_linked_sessions', sc.fallback_linked_sessions,
        'session_anomalies', sc.stale_sessions + sc.failed_sessions + sc.completed_unlinked_sessions + eoc.unmatched_orders,
        'open_cases', LEAST(COALESCE((SELECT COUNT(*) FROM refund_events), 0), 24),
        'handled_cases', 0,
        'ignored_cases', 0,
        'retry_requested_cases', 0
    ),
    'provider_stats', ps.rows,
    'trend_24h', COALESCE((
        SELECT jsonb_agg(
            jsonb_build_object(
                'bucket', tr.bucket_start,
                'label', tr.label,
                'total_events', tr.total_events,
                'anomaly_events', tr.anomaly_events,
                'failed_events', tr.failed_events
            )
            ORDER BY tr.bucket_start ASC
        )
        FROM trend_rows tr
    ), '[]'::JSONB),
    'refund_alert_topics', COALESCE((
        SELECT jsonb_agg(
            jsonb_build_object(
                'key', rtc.topic_key,
                'label', rtc.topic_label,
                'severity', rtc.severity,
                'description', CASE rtc.topic_key
                    WHEN 'refund_failures' THEN '网关退款失败，但系统已自动补回积分，仍需复核通道响应和重复提交风险。'
                    WHEN 'refund_reclaim_failures' THEN '已入账订单在退款前无法安全扣回积分，当前退款已 fail-closed 停止。'
                    WHEN 'refund_compensation_failures' THEN '退款失败后自动补回积分也失败了，需要立刻人工对账修复。'
                    ELSE '退款异常待人工复核。'
                END,
                'count', rtc.count
            )
            ORDER BY CASE rtc.topic_key
                WHEN 'refund_failures' THEN 1
                WHEN 'refund_reclaim_failures' THEN 2
                WHEN 'refund_compensation_failures' THEN 3
                ELSE 99
            END
        )
        FROM refund_topic_counts rtc
        WHERE rtc.count > 0
    ), '[]'::JSONB),
    'refund_alert_items', COALESCE((
        SELECT jsonb_agg(
            jsonb_build_object(
                'type', 'event',
                'id', re.id,
                'provider', re.provider,
                'provider_order_no', re.provider_order_no,
                'status', re.status,
                'severity', re.severity,
                'title', re.title,
                'message', re.message,
                'created_at', re.created_at,
                'topic_key', re.topic_key,
                'topic_label', re.topic_label
            )
            ORDER BY re.created_at DESC
        )
        FROM refund_events re
        WHERE re.topic_rank <= 12
    ), '[]'::JSONB)
)
FROM overview_counts oc
CROSS JOIN session_counts sc
CROSS JOIN eligible_order_counts eoc
CROSS JOIN query_base qb
CROSS JOIN event_anomaly_counts eac
CROSS JOIN duplicate_webhooks dw
CROSS JOIN provider_stats ps;
$$;

REVOKE ALL ON FUNCTION public.fn_admin_get_payment_overview_summary(TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_admin_get_payment_overview_summary(TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, VARCHAR) TO service_role;
