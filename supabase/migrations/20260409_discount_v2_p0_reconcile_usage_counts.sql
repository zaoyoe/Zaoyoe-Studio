-- ============================================
-- Discount V2 P0 companion script
-- Reconcile discount_codes.used_count to the net
-- count of non-refunded discounted shop_orders.
--
-- Run this AFTER:
--   20260409_discount_v2_p0_lifecycle_snapshot_refund.sql
-- ============================================

BEGIN;

CREATE TEMP TABLE tmp_discount_usage_reconcile AS
SELECT
    dc.id,
    dc.code,
    COALESCE(dc.used_count, 0) AS old_used_count,
    COALESCE(COUNT(so.id) FILTER (
        WHERE NULLIF(BTRIM(COALESCE(so.discount_code, '')), '') IS NOT NULL
          AND COALESCE(so.discount_amount, 0) > 0
          AND COALESCE(so.refund_status, 'none') NOT IN ('refunded', 'full_refund')
    ), 0)::INT AS new_used_count
FROM public.discount_codes dc
LEFT JOIN public.shop_orders so
    ON UPPER(BTRIM(COALESCE(so.discount_code, ''))) = dc.code
GROUP BY dc.id, dc.code, dc.used_count;

UPDATE public.discount_codes dc
SET used_count = t.new_used_count
FROM tmp_discount_usage_reconcile t
WHERE dc.id = t.id
  AND COALESCE(dc.used_count, 0) <> COALESCE(t.new_used_count, 0);

SELECT
    code,
    old_used_count,
    new_used_count,
    (new_used_count - old_used_count) AS delta
FROM tmp_discount_usage_reconcile
WHERE old_used_count <> new_used_count
ORDER BY ABS(new_used_count - old_used_count) DESC, code ASC;

DROP TABLE IF EXISTS tmp_discount_usage_reconcile;

COMMIT;
