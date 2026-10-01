-- Read-only audit for guest promo redemptions whose order/payment state
-- indicates a successful refund but whose redemption has not been returned.
-- Run in the target Supabase database before or after the refund-state hardening migration.
-- This query performs no writes and returns aggregate counts only: no order IDs,
-- order numbers, coupon codes, buyer data, provider references, or hashes.
WITH sites(site) AS (
    VALUES ('cn'::TEXT), ('intl'::TEXT)
), refund_candidates AS (
    SELECT
        r.site,
        r.order_id,
        r.discount_amount,
        o.refund_status,
        o.payment_status,
        p.status AS payment_order_status,
        p.guest_order_id IS NOT NULL AS payment_order_present
    FROM public.guest_shop_discount_redemptions AS r
    JOIN public.guest_shop_orders AS o
      ON o.id = r.order_id
    LEFT JOIN public.guest_shop_payment_orders AS p
      ON p.guest_order_id = o.id
    WHERE r.returned_at IS NULL
      AND (
          o.refund_status = 'succeeded'
          OR o.payment_status = 'refunded'
          OR p.status = 'refunded'
      )
), per_site AS (
    SELECT
        c.site,
        COUNT(*)::BIGINT AS unreturned_refund_candidate_rows,
        COUNT(DISTINCT c.order_id)::BIGINT AS affected_order_count,
        COUNT(*) FILTER (WHERE c.refund_status = 'succeeded')::BIGINT
            AS order_refund_succeeded_rows,
        COUNT(*) FILTER (WHERE c.payment_status = 'refunded')::BIGINT
            AS order_payment_refunded_rows,
        COUNT(*) FILTER (WHERE c.payment_order_status = 'refunded')::BIGINT
            AS payment_order_refunded_rows,
        COUNT(*) FILTER (WHERE NOT c.payment_order_present)::BIGINT
            AS missing_payment_order_rows,
        COUNT(*) FILTER (
            WHERE c.refund_status IS DISTINCT FROM 'succeeded'
               OR c.payment_status IS DISTINCT FROM 'refunded'
               OR c.payment_order_status IS DISTINCT FROM 'refunded'
        )::BIGINT AS refund_state_disagreement_rows,
        COALESCE(SUM(c.discount_amount), 0)::NUMERIC(14,2)
            AS unreturned_discount_amount_total
    FROM refund_candidates AS c
    GROUP BY c.site
)
SELECT
    s.site,
    CASE WHEN s.site = 'cn' THEN 'CNY' ELSE 'USD' END AS currency,
    COALESCE(p.unreturned_refund_candidate_rows, 0)::BIGINT
        AS unreturned_refund_candidate_rows,
    COALESCE(p.affected_order_count, 0)::BIGINT AS affected_order_count,
    COALESCE(p.order_refund_succeeded_rows, 0)::BIGINT AS order_refund_succeeded_rows,
    COALESCE(p.order_payment_refunded_rows, 0)::BIGINT AS order_payment_refunded_rows,
    COALESCE(p.payment_order_refunded_rows, 0)::BIGINT AS payment_order_refunded_rows,
    COALESCE(p.missing_payment_order_rows, 0)::BIGINT AS missing_payment_order_rows,
    COALESCE(p.refund_state_disagreement_rows, 0)::BIGINT
        AS refund_state_disagreement_rows,
    COALESCE(p.unreturned_discount_amount_total, 0)::NUMERIC(14,2)
        AS unreturned_discount_amount_total,
    CASE
        WHEN COALESCE(p.unreturned_refund_candidate_rows, 0) = 0
            THEN 'no_unreturned_refund_candidates'
        WHEN COALESCE(p.refund_state_disagreement_rows, 0) > 0
            THEN 'review_refund_state_disagreements'
        ELSE 'review_confirmed_refund_candidates'
    END AS audit_verdict
FROM sites AS s
LEFT JOIN per_site AS p ON p.site = s.site
ORDER BY s.site;
