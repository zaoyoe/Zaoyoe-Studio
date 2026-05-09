-- ============================================
-- Shop purchase hot-path indexes
-- - accelerate per-user per-product purchase-cap scans
-- - accelerate per-user discount reuse checks
-- - accelerate available inventory reservation and stock-count sync
-- ============================================

CREATE INDEX IF NOT EXISTS idx_shop_orders_purchase_limit_active_window
    ON public.shop_orders (user_id, product_id, created_at DESC)
    INCLUDE (item_count)
    WHERE COALESCE(refund_status, 'none') NOT IN ('refunded', 'full_refund');

CREATE INDEX IF NOT EXISTS idx_shop_orders_discount_user_active
    ON public.shop_orders (user_id, discount_code, created_at DESC)
    WHERE NULLIF(BTRIM(COALESCE(discount_code, '')), '') IS NOT NULL
      AND COALESCE(refund_status, 'none') NOT IN ('refunded', 'full_refund');

CREATE INDEX IF NOT EXISTS idx_shop_inventory_available_purchase
    ON public.shop_inventory (product_id, id)
    INCLUDE (content)
    WHERE status = 'available';

CREATE INDEX IF NOT EXISTS idx_shop_inventory_available_stock_sync
    ON public.shop_inventory (product_id)
    WHERE LOWER(BTRIM(COALESCE(status, ''))) = 'available';
