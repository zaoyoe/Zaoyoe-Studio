-- Update fn_admin_list_inventory to support batch_id search
-- Run this in Supabase SQL Editor

-- Drop existing function (all overloads)
DROP FUNCTION IF EXISTS fn_admin_list_inventory(UUID, VARCHAR, VARCHAR, INT, INT);
DROP FUNCTION IF EXISTS fn_admin_list_inventory(UUID, TEXT, TEXT, INT, INT);
DROP FUNCTION IF EXISTS fn_admin_list_inventory;

CREATE OR REPLACE FUNCTION fn_admin_list_inventory(
    p_product_id UUID DEFAULT NULL,
    p_status VARCHAR DEFAULT NULL,
    p_search VARCHAR DEFAULT NULL,
    p_page INT DEFAULT 1,
    p_page_size INT DEFAULT 20
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_offset INT;
    v_items JSONB;
    v_total INT;
    v_stats JSONB;
BEGIN
    -- Admin check
    IF NOT (
        public.is_admin() OR 
        (auth.jwt() ->> 'email') IN ('fjivvid@163.com', 'zaoyoe@gmail.com')
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Access denied');
    END IF;
    
    v_offset := (p_page - 1) * p_page_size;
    
    -- Get items with filters
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
            p.name AS product_name,
            prof.email AS buyer_email,
            (SELECT id FROM shop_orders WHERE inventory_id = i.id LIMIT 1) AS order_id
        FROM shop_inventory i
        LEFT JOIN shop_products p ON i.product_id = p.id
        LEFT JOIN profiles prof ON i.buyer_id = prof.id
        WHERE 
            (p_product_id IS NULL OR i.product_id = p_product_id)
            AND (p_status IS NULL OR i.status = p_status)
            AND (
                p_search IS NULL 
                OR i.content ILIKE '%' || p_search || '%'
                OR i.batch_id ILIKE '%' || p_search || '%'
                OR p.name ILIKE '%' || p_search || '%'
            )
        ORDER BY i.created_at DESC
    )
    SELECT 
        jsonb_agg(to_jsonb(filtered.*)),
        COUNT(*) OVER()
    INTO v_items, v_total
    FROM (SELECT * FROM filtered LIMIT p_page_size OFFSET v_offset) AS filtered;
    
    -- Get stats (unfiltered)
    SELECT jsonb_build_object(
        'reserve', COUNT(*) FILTER (WHERE status = 'reserve'),
        'available', COUNT(*) FILTER (WHERE status = 'available'),
        'sold', COUNT(*) FILTER (WHERE status = 'sold'),
        'frozen', COUNT(*) FILTER (WHERE status = 'frozen')
    ) INTO v_stats
    FROM shop_inventory
    WHERE (p_product_id IS NULL OR product_id = p_product_id);
    
    RETURN jsonb_build_object(
        'success', true,
        'items', COALESCE(v_items, '[]'::jsonb),
        'total', COALESCE(v_total, 0),
        'stats', v_stats
    );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION fn_admin_list_inventory TO authenticated;
