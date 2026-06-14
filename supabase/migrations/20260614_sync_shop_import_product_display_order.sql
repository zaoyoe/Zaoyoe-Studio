-- Keep the Admin Studio import tree product order aligned with product card ranking.
-- The import tree stores ascending per-category sort_order; the product grid and
-- public storefront rank by descending display_order.

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
            GREATEST(COALESCE(sort_order, 0), 0) AS sort_order,
            CASE
                WHEN display_order IS NULL THEN NULL
                ELSE GREATEST(display_order, 0)
            END AS display_order
        FROM jsonb_to_recordset(COALESCE(p_assignments, '[]'::JSONB)) AS x(
            id TEXT,
            category TEXT,
            sort_order INT,
            display_order INT
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
            GREATEST(COALESCE(sort_order, 0), 0) AS sort_order,
            CASE
                WHEN display_order IS NULL THEN NULL
                ELSE GREATEST(display_order, 0)
            END AS display_order
        FROM jsonb_to_recordset(COALESCE(p_assignments, '[]'::JSONB)) AS x(
            id TEXT,
            category TEXT,
            sort_order INT,
            display_order INT
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
            GREATEST(COALESCE(sort_order, 0), 0) AS sort_order,
            CASE
                WHEN display_order IS NULL THEN NULL
                ELSE GREATEST(display_order, 0)
            END AS display_order
        FROM jsonb_to_recordset(COALESCE(p_assignments, '[]'::JSONB)) AS x(
            id TEXT,
            category TEXT,
            sort_order INT,
            display_order INT
        )
        WHERE NULLIF(BTRIM(COALESCE(id, '')), '') IS NOT NULL
          AND NULLIF(BTRIM(COALESCE(category, '')), '') IS NOT NULL
          AND sort_order IS NOT NULL
    ),
    updated AS (
        UPDATE public.shop_products p
        SET
            category = a.category_name,
            sort_order = a.sort_order,
            display_order = COALESCE(a.display_order, p.display_order)
        FROM assignments a
        WHERE p.id::TEXT = a.id_text
        RETURNING p.id, p.name, p.category, p.sort_order, p.display_order
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

GRANT EXECUTE ON FUNCTION public.fn_admin_shop_reorder_products(JSONB) TO authenticated;
