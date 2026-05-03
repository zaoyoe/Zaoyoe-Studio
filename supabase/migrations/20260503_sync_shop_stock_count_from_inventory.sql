-- Keep public product stock badges aligned with the real deliverable inventory.
-- The purchase RPC reserves rows from shop_inventory where status = 'available',
-- so shop_products.stock_count must be derived from the same source.

CREATE OR REPLACE FUNCTION public.fn_sync_shop_product_stock_count(p_product_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_stock_count INTEGER := 0;
BEGIN
    IF p_product_id IS NULL THEN
        RETURN 0;
    END IF;

    SELECT COUNT(*)::INTEGER
    INTO v_stock_count
    FROM public.shop_inventory
    WHERE product_id = p_product_id
      AND LOWER(BTRIM(COALESCE(status, ''))) = 'available';

    UPDATE public.shop_products
    SET stock_count = v_stock_count
    WHERE id = p_product_id;

    RETURN v_stock_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_trigger_update_stock_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM public.fn_sync_shop_product_stock_count(NEW.product_id);
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.product_id IS DISTINCT FROM NEW.product_id THEN
            PERFORM public.fn_sync_shop_product_stock_count(OLD.product_id);
        END IF;
        PERFORM public.fn_sync_shop_product_stock_count(NEW.product_id);
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        PERFORM public.fn_sync_shop_product_stock_count(OLD.product_id);
        RETURN OLD;
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_shop_inventory_stock ON public.shop_inventory;

CREATE TRIGGER tr_shop_inventory_stock
AFTER INSERT OR UPDATE OR DELETE ON public.shop_inventory
FOR EACH ROW
EXECUTE FUNCTION public.fn_trigger_update_stock_count();

WITH real_counts AS (
    SELECT
        p.id AS product_id,
        COUNT(i.id) FILTER (
            WHERE LOWER(BTRIM(COALESCE(i.status, ''))) = 'available'
        )::INTEGER AS available_count
    FROM public.shop_products p
    LEFT JOIN public.shop_inventory i ON i.product_id = p.id
    GROUP BY p.id
)
UPDATE public.shop_products p
SET stock_count = real_counts.available_count
FROM real_counts
WHERE p.id = real_counts.product_id;

REVOKE ALL ON FUNCTION public.fn_sync_shop_product_stock_count(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_sync_shop_product_stock_count(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.fn_sync_shop_product_stock_count(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sync_shop_product_stock_count(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.fn_trigger_update_stock_count() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_trigger_update_stock_count() FROM anon;
REVOKE ALL ON FUNCTION public.fn_trigger_update_stock_count() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_trigger_update_stock_count() TO service_role;
