-- FIX: Reset all stock counts to match actual available inventory
-- This fixes negative numbers caused by previous bugs

WITH real_counts AS (
    SELECT product_id, COUNT(*) as cnt 
    FROM shop_inventory 
    WHERE status = 'available'
    GROUP BY product_id
)
UPDATE shop_products p
SET stock_count = COALESCE((SELECT cnt FROM real_counts rc WHERE rc.product_id = p.id), 0);

-- Verify
SELECT name, stock_count FROM shop_products;
