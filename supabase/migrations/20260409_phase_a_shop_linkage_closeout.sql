-- Phase A closeout: harden inventory-to-order linkage for admin tooling.
-- This migration is intentionally limited to linkage recovery and admin inventory reads.

-- Backfill shop_orders.inventory_id for historical single-inventory orders.
WITH single_inventory_orders AS (
    SELECT
        soi.order_id,
        MIN(soi.inventory_id::text)::uuid AS inventory_id
    FROM public.shop_order_items soi
    WHERE soi.inventory_id IS NOT NULL
    GROUP BY soi.order_id
    HAVING COUNT(DISTINCT soi.inventory_id) = 1
)
UPDATE public.shop_orders o
SET inventory_id = sio.inventory_id
FROM single_inventory_orders sio
WHERE o.id = sio.order_id
  AND o.inventory_id IS NULL;

-- Rebuild fn_admin_list_inventory so order_id can resolve through both
-- shop_orders.inventory_id and shop_order_items.inventory_id.
DROP FUNCTION IF EXISTS public.fn_admin_list_inventory(UUID, VARCHAR, VARCHAR, INT, INT);
DROP FUNCTION IF EXISTS public.fn_admin_list_inventory(UUID, TEXT, TEXT, INT, INT);
DROP FUNCTION IF EXISTS public.fn_admin_list_inventory(UUID, VARCHAR, VARCHAR, INT, INT, TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE);
DROP FUNCTION IF EXISTS public.fn_admin_list_inventory;

CREATE OR REPLACE FUNCTION public.fn_admin_list_inventory(
    p_product_id UUID DEFAULT NULL,
    p_status VARCHAR DEFAULT NULL,
    p_search VARCHAR DEFAULT NULL,
    p_page INT DEFAULT 1,
    p_page_size INT DEFAULT 20,
    p_date_from TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    p_date_to TIMESTAMP WITH TIME ZONE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_offset INT := GREATEST((COALESCE(p_page, 1) - 1) * COALESCE(p_page_size, 20), 0);
    v_items JSONB;
    v_total INT;
    v_stats JSONB;
    v_search_term TEXT := NULLIF(BTRIM(COALESCE(p_search, '')), '');
BEGIN
    IF NOT (
        public.is_admin()
        OR (auth.jwt() ->> 'email') IN ('fjivvid@163.com', 'zaoyoe@gmail.com')
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Access denied');
    END IF;

    WITH filtered AS (
        SELECT
            i.id,
            i.product_id,
            i.content,
            i.status,
            i.batch_id,
            i.buyer_id,
            i.sold_at,
            i.created_at,
            i.remark,
            p.name AS product_name,
            prof.email AS buyer_email,
            COALESCE(
                (
                    SELECT o.id
                    FROM public.shop_orders o
                    WHERE o.inventory_id = i.id
                    ORDER BY o.created_at DESC
                    LIMIT 1
                ),
                (
                    SELECT soi.order_id
                    FROM public.shop_order_items soi
                    WHERE soi.inventory_id = i.id
                    ORDER BY soi.created_at ASC
                    LIMIT 1
                )
            ) AS order_id
        FROM public.shop_inventory i
        LEFT JOIN public.shop_products p ON p.id = i.product_id
        LEFT JOIN public.profiles prof ON prof.id = i.buyer_id
        WHERE
            (p_product_id IS NULL OR i.product_id = p_product_id)
            AND (p_status IS NULL OR i.status = p_status)
            AND (
                v_search_term IS NULL
                OR i.content ILIKE '%' || v_search_term || '%'
                OR i.batch_id ILIKE '%' || v_search_term || '%'
                OR p.name ILIKE '%' || v_search_term || '%'
            )
            AND (p_date_from IS NULL OR i.created_at >= p_date_from)
            AND (p_date_to IS NULL OR i.created_at <= p_date_to)
        ORDER BY i.created_at DESC
    ),
    paged AS (
        SELECT *
        FROM filtered
        LIMIT COALESCE(p_page_size, 20)
        OFFSET v_offset
    )
    SELECT
        COALESCE(jsonb_agg(to_jsonb(paged.*)), '[]'::JSONB),
        (
            SELECT COUNT(*)
            FROM filtered
        )
    INTO v_items, v_total
    FROM paged;

    SELECT jsonb_build_object(
        'reserve', COUNT(*) FILTER (WHERE status = 'reserve'),
        'available', COUNT(*) FILTER (WHERE status = 'available'),
        'sold', COUNT(*) FILTER (WHERE status = 'sold'),
        'frozen', COUNT(*) FILTER (WHERE status = 'frozen'),
        'fault', COUNT(*) FILTER (WHERE status = 'fault')
    )
    INTO v_stats
    FROM public.shop_inventory
    WHERE (p_product_id IS NULL OR product_id = p_product_id);

    RETURN jsonb_build_object(
        'success', true,
        'items', COALESCE(v_items, '[]'::JSONB),
        'total', COALESCE(v_total, 0),
        'stats', COALESCE(v_stats, '{}'::JSONB)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_admin_list_inventory(
    UUID,
    VARCHAR,
    VARCHAR,
    INT,
    INT,
    TIMESTAMP WITH TIME ZONE,
    TIMESTAMP WITH TIME ZONE
) TO authenticated;
