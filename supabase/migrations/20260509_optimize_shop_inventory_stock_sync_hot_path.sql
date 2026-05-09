-- ============================================
-- Optimize shop inventory stock sync hot path
-- - replace row-by-row stock recounts with statement-level recounts
-- - keep fn_sync_shop_product_stock_count for existing admin/refund callers
-- ============================================

CREATE OR REPLACE FUNCTION public.fn_sync_shop_product_stock_counts(p_product_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_product_ids IS NULL OR array_length(p_product_ids, 1) IS NULL THEN
        RETURN;
    END IF;

    WITH affected AS (
        SELECT DISTINCT product_id
        FROM unnest(p_product_ids) AS ids(product_id)
        WHERE product_id IS NOT NULL
    ),
    real_counts AS (
        SELECT
            affected.product_id,
            COUNT(i.id)::INTEGER AS available_count
        FROM affected
        LEFT JOIN public.shop_inventory i
          ON i.product_id = affected.product_id
         AND LOWER(BTRIM(COALESCE(i.status, ''))) = 'available'
        GROUP BY affected.product_id
    )
    UPDATE public.shop_products p
    SET stock_count = real_counts.available_count
    FROM real_counts
    WHERE p.id = real_counts.product_id;
END;
$$;

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

    PERFORM public.fn_sync_shop_product_stock_counts(ARRAY[p_product_id]);

    SELECT COALESCE(stock_count, 0)::INTEGER
    INTO v_stock_count
    FROM public.shop_products
    WHERE id = p_product_id;

    RETURN COALESCE(v_stock_count, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_trigger_update_stock_count_insert_statement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_product_ids UUID[];
BEGIN
    SELECT array_agg(DISTINCT product_id)
    INTO v_product_ids
    FROM new_rows
    WHERE product_id IS NOT NULL;

    PERFORM public.fn_sync_shop_product_stock_counts(v_product_ids);
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_trigger_update_stock_count_update_statement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_product_ids UUID[];
BEGIN
    SELECT array_agg(DISTINCT product_id)
    INTO v_product_ids
    FROM (
        SELECT product_id FROM old_rows WHERE product_id IS NOT NULL
        UNION
        SELECT product_id FROM new_rows WHERE product_id IS NOT NULL
    ) affected;

    PERFORM public.fn_sync_shop_product_stock_counts(v_product_ids);
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_trigger_update_stock_count_delete_statement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_product_ids UUID[];
BEGIN
    SELECT array_agg(DISTINCT product_id)
    INTO v_product_ids
    FROM old_rows
    WHERE product_id IS NOT NULL;

    PERFORM public.fn_sync_shop_product_stock_counts(v_product_ids);
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_shop_inventory_stock ON public.shop_inventory;
DROP TRIGGER IF EXISTS tr_shop_inventory_stock_insert ON public.shop_inventory;
DROP TRIGGER IF EXISTS tr_shop_inventory_stock_update ON public.shop_inventory;
DROP TRIGGER IF EXISTS tr_shop_inventory_stock_delete ON public.shop_inventory;

CREATE TRIGGER tr_shop_inventory_stock_insert
AFTER INSERT ON public.shop_inventory
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.fn_trigger_update_stock_count_insert_statement();

CREATE TRIGGER tr_shop_inventory_stock_update
AFTER UPDATE ON public.shop_inventory
REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.fn_trigger_update_stock_count_update_statement();

CREATE TRIGGER tr_shop_inventory_stock_delete
AFTER DELETE ON public.shop_inventory
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.fn_trigger_update_stock_count_delete_statement();

REVOKE ALL ON FUNCTION public.fn_sync_shop_product_stock_counts(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_sync_shop_product_stock_counts(UUID[]) FROM anon;
REVOKE ALL ON FUNCTION public.fn_sync_shop_product_stock_counts(UUID[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sync_shop_product_stock_counts(UUID[]) TO service_role;

REVOKE ALL ON FUNCTION public.fn_sync_shop_product_stock_count(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_sync_shop_product_stock_count(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.fn_sync_shop_product_stock_count(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sync_shop_product_stock_count(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.fn_trigger_update_stock_count_insert_statement() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_trigger_update_stock_count_insert_statement() FROM anon;
REVOKE ALL ON FUNCTION public.fn_trigger_update_stock_count_insert_statement() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_trigger_update_stock_count_insert_statement() TO service_role;

REVOKE ALL ON FUNCTION public.fn_trigger_update_stock_count_update_statement() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_trigger_update_stock_count_update_statement() FROM anon;
REVOKE ALL ON FUNCTION public.fn_trigger_update_stock_count_update_statement() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_trigger_update_stock_count_update_statement() TO service_role;

REVOKE ALL ON FUNCTION public.fn_trigger_update_stock_count_delete_statement() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_trigger_update_stock_count_delete_statement() FROM anon;
REVOKE ALL ON FUNCTION public.fn_trigger_update_stock_count_delete_statement() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_trigger_update_stock_count_delete_statement() TO service_role;
