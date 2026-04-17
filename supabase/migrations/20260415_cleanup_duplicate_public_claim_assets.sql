-- Remove duplicate public-claim assets that were created by the pre-RPC race window.
-- Only fresh, unused assets are deleted so historical orders and restored assets stay intact.

DO $$
DECLARE
    v_deleted_count INT := 0;
BEGIN
    WITH over_limit_groups AS (
        SELECT
            a.user_id,
            a.discount_id,
            GREATEST(0, COALESCE(d.claim_limit_per_user, 0)) AS claim_limit_per_user,
            COUNT(*)::INT AS total_claim_count,
            GREATEST(0, COUNT(*)::INT - GREATEST(0, COALESCE(d.claim_limit_per_user, 0))) AS excess_claim_count
        FROM public.discount_user_assets a
        JOIN public.discount_codes d
            ON d.id = a.discount_id
        WHERE LOWER(BTRIM(COALESCE(d.distribution_mode, ''))) = 'public_claim'
          AND GREATEST(0, COALESCE(d.claim_limit_per_user, 0)) > 0
        GROUP BY a.user_id, a.discount_id, d.claim_limit_per_user
        HAVING COUNT(*)::INT > GREATEST(0, COALESCE(d.claim_limit_per_user, 0))
    ),
    ranked_cleanup_candidates AS (
        SELECT
            a.id,
            g.excess_claim_count,
            ROW_NUMBER() OVER (
                PARTITION BY a.user_id, a.discount_id
                ORDER BY COALESCE(a.claimed_at, a.assigned_at, a.created_at) DESC, a.id DESC
            ) AS cleanup_rank
        FROM public.discount_user_assets a
        JOIN over_limit_groups g
            ON g.user_id = a.user_id
           AND g.discount_id = a.discount_id
        WHERE LOWER(BTRIM(COALESCE(a.asset_status, ''))) = 'available'
          AND LOWER(BTRIM(COALESCE(a.source_type, ''))) = 'public_claim'
          AND a.consumed_at IS NULL
          AND a.restored_at IS NULL
          AND a.last_order_id IS NULL
          AND NOT EXISTS (
              SELECT 1
              FROM public.shop_orders o
              WHERE o.discount_asset_id = a.id
          )
    ),
    deleted_assets AS (
        DELETE FROM public.discount_user_assets a
        USING ranked_cleanup_candidates c
        WHERE a.id = c.id
          AND c.cleanup_rank <= c.excess_claim_count
        RETURNING a.id
    )
    SELECT COUNT(*)::INT
    INTO v_deleted_count
    FROM deleted_assets;

    RAISE NOTICE 'Removed % duplicate public-claim assets that were never used.', v_deleted_count;
END;
$$;
