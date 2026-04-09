-- Phase B closeout:
-- 1. Provide transactional admin RPC helpers for category rename/delete and product reorder.
-- 2. Extend admin inventory search so the existing search box can match order id, buyer email and remarks.

DROP FUNCTION IF EXISTS public.fn_admin_shop_rename_category(UUID, TEXT);
DROP FUNCTION IF EXISTS public.fn_admin_shop_delete_category(UUID, TEXT);
DROP FUNCTION IF EXISTS public.fn_admin_shop_reorder_products(JSON);
DROP FUNCTION IF EXISTS public.fn_admin_shop_reorder_products(JSONB);

CREATE OR REPLACE FUNCTION public.fn_admin_shop_rename_category(
    p_category_id UUID,
    p_next_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_category RECORD;
    v_next_name TEXT := NULLIF(BTRIM(COALESCE(p_next_name, '')), '');
    v_moved_count INT := 0;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' AND NOT public.is_admin() THEN
        RETURN jsonb_build_object('success', false, 'message', 'Access denied');
    END IF;

    IF p_category_id IS NULL OR v_next_name IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'categoryId and name are required');
    END IF;

    SELECT id, name, color, sort_order
    INTO v_category
    FROM public.shop_categories
    WHERE id = p_category_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', '分类不存在');
    END IF;

    IF v_category.name = v_next_name THEN
        RETURN jsonb_build_object(
            'success', true,
            'category_id', v_category.id,
            'name', v_next_name,
            'previous_name', v_category.name,
            'moved_products', 0,
            'transaction_mode', 'rpc'
        );
    END IF;

    UPDATE public.shop_categories
    SET name = v_next_name
    WHERE id = p_category_id;

    UPDATE public.shop_products
    SET category = v_next_name
    WHERE category = v_category.name;
    GET DIAGNOSTICS v_moved_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', true,
        'category_id', v_category.id,
        'name', v_next_name,
        'previous_name', v_category.name,
        'moved_products', v_moved_count,
        'transaction_mode', 'rpc'
    );
EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false, 'message', '分类名称已存在');
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_admin_shop_delete_category(
    p_category_id UUID,
    p_fallback_name TEXT DEFAULT 'other'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_category RECORD;
    v_fallback RECORD;
    v_fallback_name TEXT := NULLIF(BTRIM(COALESCE(p_fallback_name, 'other')), '');
    v_moved_count INT := 0;
    v_sort_order INT := 10;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' AND NOT public.is_admin() THEN
        RETURN jsonb_build_object('success', false, 'message', 'Access denied');
    END IF;

    IF p_category_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'categoryId is required');
    END IF;

    SELECT id, name, color, sort_order
    INTO v_category
    FROM public.shop_categories
    WHERE id = p_category_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', '分类不存在');
    END IF;

    IF LOWER(COALESCE(v_category.name, '')) = 'other' THEN
        RETURN jsonb_build_object('success', false, 'message', '默认分类 other 不允许删除');
    END IF;

    SELECT id, name, color, sort_order
    INTO v_fallback
    FROM public.shop_categories
    WHERE name = COALESCE(v_fallback_name, 'other')
    FOR UPDATE;

    IF NOT FOUND THEN
        SELECT COALESCE(MAX(sort_order), 0) + 10
        INTO v_sort_order
        FROM public.shop_categories;

        INSERT INTO public.shop_categories (name, color, sort_order)
        VALUES (COALESCE(v_fallback_name, 'other'), '#9aa0a6', v_sort_order)
        RETURNING id, name, color, sort_order
        INTO v_fallback;
    END IF;

    UPDATE public.shop_products
    SET category = v_fallback.name
    WHERE category = v_category.name;
    GET DIAGNOSTICS v_moved_count = ROW_COUNT;

    DELETE FROM public.shop_categories
    WHERE id = p_category_id;

    RETURN jsonb_build_object(
        'success', true,
        'deleted', true,
        'category_id', v_category.id,
        'name', v_category.name,
        'fallback_category', v_fallback.name,
        'moved_products', v_moved_count,
        'transaction_mode', 'rpc'
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_admin_shop_reorder_products(
    p_assignments JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_assignment_count INT := 0;
    v_existing_count INT := 0;
    v_products JSONB := '[]'::JSONB;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' AND NOT public.is_admin() THEN
        RETURN jsonb_build_object('success', false, 'message', 'Access denied');
    END IF;

    WITH assignments AS (
        SELECT DISTINCT
            NULLIF(BTRIM(COALESCE(id, '')), '') AS id_text,
            NULLIF(BTRIM(COALESCE(category, '')), '') AS category_name,
            GREATEST(COALESCE(sort_order, 0), 0) AS sort_order
        FROM jsonb_to_recordset(COALESCE(p_assignments, '[]'::JSONB)) AS x(
            id TEXT,
            category TEXT,
            sort_order INT
        )
        WHERE NULLIF(BTRIM(COALESCE(id, '')), '') IS NOT NULL
          AND NULLIF(BTRIM(COALESCE(category, '')), '') IS NOT NULL
          AND sort_order IS NOT NULL
    )
    SELECT COUNT(*)
    INTO v_assignment_count
    FROM assignments;

    IF v_assignment_count = 0 THEN
        RETURN jsonb_build_object('success', false, 'message', 'assignments is required');
    END IF;

    WITH assignments AS (
        SELECT DISTINCT
            NULLIF(BTRIM(COALESCE(id, '')), '') AS id_text,
            NULLIF(BTRIM(COALESCE(category, '')), '') AS category_name,
            GREATEST(COALESCE(sort_order, 0), 0) AS sort_order
        FROM jsonb_to_recordset(COALESCE(p_assignments, '[]'::JSONB)) AS x(
            id TEXT,
            category TEXT,
            sort_order INT
        )
        WHERE NULLIF(BTRIM(COALESCE(id, '')), '') IS NOT NULL
          AND NULLIF(BTRIM(COALESCE(category, '')), '') IS NOT NULL
          AND sort_order IS NOT NULL
    )
    SELECT COUNT(*)
    INTO v_existing_count
    FROM public.shop_products p
    JOIN assignments a
      ON p.id::TEXT = a.id_text;

    IF v_existing_count <> v_assignment_count THEN
        RETURN jsonb_build_object('success', false, 'message', '部分商品不存在，排序未执行');
    END IF;

    WITH assignments AS (
        SELECT DISTINCT
            NULLIF(BTRIM(COALESCE(id, '')), '') AS id_text,
            NULLIF(BTRIM(COALESCE(category, '')), '') AS category_name,
            GREATEST(COALESCE(sort_order, 0), 0) AS sort_order
        FROM jsonb_to_recordset(COALESCE(p_assignments, '[]'::JSONB)) AS x(
            id TEXT,
            category TEXT,
            sort_order INT
        )
        WHERE NULLIF(BTRIM(COALESCE(id, '')), '') IS NOT NULL
          AND NULLIF(BTRIM(COALESCE(category, '')), '') IS NOT NULL
          AND sort_order IS NOT NULL
    ),
    updated AS (
        UPDATE public.shop_products p
        SET
            category = a.category_name,
            sort_order = a.sort_order
        FROM assignments a
        WHERE p.id::TEXT = a.id_text
        RETURNING p.id, p.name, p.category, p.sort_order
    )
    SELECT COALESCE(jsonb_agg(to_jsonb(updated.*)), '[]'::JSONB)
    INTO v_products
    FROM updated;

    RETURN jsonb_build_object(
        'success', true,
        'updated', v_assignment_count,
        'products', v_products,
        'transaction_mode', 'rpc'
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_admin_shop_rename_category(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_shop_delete_category(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_admin_shop_reorder_products(JSONB) TO authenticated;

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

    WITH inventory_order_links AS (
        SELECT
            i.id AS inventory_id,
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
    ),
    filtered AS (
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
            links.order_id
        FROM public.shop_inventory i
        LEFT JOIN inventory_order_links links ON links.inventory_id = i.id
        LEFT JOIN public.shop_products p ON p.id = i.product_id
        LEFT JOIN public.profiles prof ON prof.id = i.buyer_id
        WHERE
            (p_product_id IS NULL OR i.product_id = p_product_id)
            AND (p_status IS NULL OR i.status = p_status)
            AND (
                v_search_term IS NULL
                OR i.content ILIKE '%' || v_search_term || '%'
                OR COALESCE(i.batch_id, '') ILIKE '%' || v_search_term || '%'
                OR COALESCE(i.remark, '') ILIKE '%' || v_search_term || '%'
                OR COALESCE(p.name, '') ILIKE '%' || v_search_term || '%'
                OR COALESCE(prof.email, '') ILIKE '%' || v_search_term || '%'
                OR COALESCE(links.order_id::TEXT, '') ILIKE '%' || v_search_term || '%'
                OR ('SHOP_ORDER_' || COALESCE(links.order_id::TEXT, '')) ILIKE '%' || v_search_term || '%'
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
