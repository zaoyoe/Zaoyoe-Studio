DO $$
BEGIN
    IF to_regprocedure('public.fn_admin_get_payment_overview_summary_base_20260419(timestamp with time zone, timestamp with time zone, timestamp with time zone, character varying)') IS NULL
       AND to_regprocedure('public.fn_admin_get_payment_overview_summary(timestamp with time zone, timestamp with time zone, timestamp with time zone, character varying)') IS NOT NULL THEN
        ALTER FUNCTION public.fn_admin_get_payment_overview_summary(TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, VARCHAR)
            RENAME TO fn_admin_get_payment_overview_summary_base_20260419;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_admin_get_payment_overview_summary(
    p_start_at TIMESTAMPTZ,
    p_end_at TIMESTAMPTZ DEFAULT NULL,
    p_trend_start_at TIMESTAMPTZ DEFAULT NULL,
    p_site VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
RETURN (
    WITH base AS (
        SELECT public.fn_admin_get_payment_overview_summary_base_20260419(
            p_start_at,
            p_end_at,
            p_trend_start_at,
            p_site
        ) AS payload
    ),
    event_rows AS (
        SELECT
            pe.id::TEXT AS id,
            pe.provider,
            pe.provider_order_no,
            LOWER(BTRIM(COALESCE(pe.processing_result, ''))) AS status,
            pe.error_message,
            pe.created_at,
            COALESCE((
                SELECT LOWER(BTRIM(COALESCE(pac.status, 'open')))
                FROM public.payment_anomaly_cases pac
                WHERE pac.target_type = 'event'
                  AND pac.target_id::TEXT = pe.id::TEXT
                ORDER BY pac.updated_at DESC, pac.id DESC
                LIMIT 1
            ), 'open') AS case_status,
            (
                pe.signature_valid = FALSE
                OR pe.amount_valid = FALSE
                OR NULLIF(BTRIM(COALESCE(pe.error_message, '')), '') IS NOT NULL
                OR (
                    NULLIF(BTRIM(COALESCE(pe.processing_result, '')), '') IS NOT NULL
                    AND LOWER(BTRIM(COALESCE(pe.processing_result, ''))) NOT IN (
                        'processed_paid',
                        'received',
                        'ignored_non_success_ec',
                        'ignored_non_order_event',
                        'ignored_non_paid_status',
                        'admin_refund_processed',
                        'admin_refund_synced_refunded'
                    )
                )
            ) AS is_anomaly
        FROM public.payment_events pe
        WHERE pe.created_at >= p_start_at
          AND (p_end_at IS NULL OR pe.created_at <= p_end_at)
          AND (
              p_site IS NULL
              OR EXISTS (
                  SELECT 1
                  FROM public.payment_orders po
                  WHERE po.site = p_site
                    AND (
                        po.id = pe.payment_order_id
                        OR (
                            NULLIF(BTRIM(COALESCE(pe.provider_order_no, '')), '') IS NOT NULL
                            AND po.provider_order_no = pe.provider_order_no
                        )
                    )
              )
          )
    ),
    active_events AS (
        SELECT *
        FROM event_rows
        WHERE is_anomaly
          AND case_status NOT IN ('handled', 'ignored', 'approved', 'rejected', 'archived')
    ),
    duplicate_webhooks AS (
        SELECT COUNT(*)::INTEGER AS duplicate_webhook_orders
        FROM (
            SELECT
                provider_order_no,
                (ARRAY_AGG(case_status ORDER BY created_at DESC, id DESC))[1] AS latest_case_status
            FROM event_rows
            WHERE NULLIF(BTRIM(COALESCE(provider_order_no, '')), '') IS NOT NULL
            GROUP BY provider_order_no
            HAVING COUNT(*) > 1
        ) duplicates
        WHERE latest_case_status NOT IN ('archived')
    ),
    active_refunds AS (
        SELECT
            ae.*,
            CASE ae.status
                WHEN 'admin_refund_failed' THEN 'refund_failures'
                WHEN 'admin_refund_reclaim_failed' THEN 'refund_reclaim_failures'
                WHEN 'admin_refund_compensation_failed' THEN 'refund_compensation_failures'
                ELSE 'refund_failures'
            END AS topic_key,
            CASE ae.status
                WHEN 'admin_refund_failed' THEN '退款失败'
                WHEN 'admin_refund_reclaim_failed' THEN '扣回失败'
                WHEN 'admin_refund_compensation_failed' THEN '回滚失败'
                ELSE '退款失败'
            END AS topic_label,
            CASE ae.status
                WHEN 'admin_refund_failed' THEN 'warning'
                ELSE 'critical'
            END AS severity,
            CASE ae.status
                WHEN 'admin_refund_failed' THEN '退款失败已补回'
                WHEN 'admin_refund_reclaim_failed' THEN '退款积分扣回失败'
                WHEN 'admin_refund_compensation_failed' THEN '退款积分回滚失败'
                ELSE '退款异常'
            END AS title,
            ROW_NUMBER() OVER (
                PARTITION BY ae.status
                ORDER BY ae.created_at DESC, ae.id DESC
            ) AS topic_rank
        FROM active_events ae
        WHERE ae.status IN (
            'admin_refund_failed',
            'admin_refund_reclaim_failed',
            'admin_refund_compensation_failed'
        )
    ),
    refund_topics AS (
        SELECT
            topic_key,
            topic_label,
            MAX(severity) AS severity,
            COUNT(*)::INTEGER AS count
        FROM active_refunds
        GROUP BY 1, 2
    )
    SELECT jsonb_set(
        jsonb_set(
            jsonb_set(
                base.payload,
                '{anomaly_summary}',
                COALESCE(base.payload->'anomaly_summary', '{}'::JSONB) || jsonb_build_object(
                    'recent_event_anomalies', COALESCE((SELECT COUNT(*) FROM active_events), 0),
                    'duplicate_webhook_orders', COALESCE((SELECT duplicate_webhook_orders FROM duplicate_webhooks), 0),
                    'refund_failures', COALESCE((SELECT COUNT(*) FROM active_refunds WHERE topic_key = 'refund_failures'), 0),
                    'refund_reclaim_failures', COALESCE((SELECT COUNT(*) FROM active_refunds WHERE topic_key = 'refund_reclaim_failures'), 0),
                    'refund_compensation_failures', COALESCE((SELECT COUNT(*) FROM active_refunds WHERE topic_key = 'refund_compensation_failures'), 0),
                    'open_cases', COALESCE((SELECT COUNT(*) FROM active_refunds), 0)
                ),
                true
            ),
            '{refund_alert_topics}',
            COALESCE((
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'key', rt.topic_key,
                        'label', rt.topic_label,
                        'severity', rt.severity,
                        'description', '退款异常待人工复核。',
                        'count', rt.count
                    )
                    ORDER BY rt.topic_key
                )
                FROM refund_topics rt
            ), '[]'::JSONB),
            true
        ),
        '{refund_alert_items}',
        COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object(
                    'type', 'event',
                    'id', ar.id,
                    'provider', ar.provider,
                    'provider_order_no', ar.provider_order_no,
                    'status', ar.status,
                    'severity', ar.severity,
                    'title', ar.title,
                    'message', COALESCE(NULLIF(BTRIM(COALESCE(ar.error_message, '')), ''), '退款异常待人工复核。'),
                    'created_at', ar.created_at,
                    'topic_key', ar.topic_key,
                    'topic_label', ar.topic_label
                )
                ORDER BY ar.created_at DESC
            )
            FROM active_refunds ar
            WHERE ar.topic_rank <= 12
        ), '[]'::JSONB),
        true
    )
    FROM base
);

REVOKE ALL ON FUNCTION public.fn_admin_get_payment_overview_summary(TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_admin_get_payment_overview_summary(TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, VARCHAR) TO service_role;
