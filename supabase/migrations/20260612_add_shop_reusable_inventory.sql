-- Support reusable delivery inventory rows.
-- is_shared means one inventory row contains shared delivery content (for example
-- a cloud-drive URL) and should remain available after it is delivered.

ALTER TABLE public.shop_inventory
    ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_shop_inventory_reusable_available
    ON public.shop_inventory (product_id, sku_id, created_at, id)
    WHERE is_shared IS TRUE AND LOWER(BTRIM(COALESCE(status, ''))) = 'available';

COMMENT ON COLUMN public.shop_inventory.is_shared IS
    'Reusable/shared delivery content. True rows remain available and can be delivered repeatedly.';

CREATE OR REPLACE FUNCTION public.fn_admin_list_inventory(
    p_product_id UUID DEFAULT NULL,
    p_status VARCHAR DEFAULT NULL,
    p_search VARCHAR DEFAULT NULL,
    p_page INT DEFAULT 1,
    p_page_size INT DEFAULT 20,
    p_date_from TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    p_date_to TIMESTAMP WITH TIME ZONE DEFAULT NULL,
    p_sku_id UUID DEFAULT NULL
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
    v_filter_sku_id UUID := p_sku_id;
    v_filter_sku_is_default BOOLEAN := false;
BEGIN
    IF NOT (
        public.is_admin()
        OR (auth.jwt() ->> 'email') IN ('fjivvid@163.com', 'zaoyoe@gmail.com')
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Access denied');
    END IF;

    IF p_sku_id IS NOT NULL THEN
        SELECT
            COALESCE(s.inventory_sku_id, s.id),
            COALESCE(source_sku.is_default, s.is_default, false)
        INTO v_filter_sku_id, v_filter_sku_is_default
        FROM public.shop_product_skus s
        LEFT JOIN public.shop_product_skus source_sku ON source_sku.id = COALESCE(s.inventory_sku_id, s.id)
        WHERE s.id = p_sku_id;

        v_filter_sku_id := COALESCE(v_filter_sku_id, p_sku_id);
        v_filter_sku_is_default := COALESCE(v_filter_sku_is_default, false);
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
            i.sku_id,
            i.content,
            i.status,
            i.batch_id,
            i.source_batch_id,
            i.purchase_unit_cost,
            i.purchase_currency,
            i.purchase_exchange_rate_to_cny,
            i.purchase_unit_cost_cny,
            COALESCE(i.is_shared, false) AS is_shared,
            i.buyer_id,
            i.sold_at,
            i.created_at,
            i.remark,
            p.name AS product_name,
            s.sku_name,
            s.sku_code,
            prof.email AS buyer_email,
            links.order_id,
            pb.batch_code AS procurement_batch_code,
            pb.unit_cost AS procurement_unit_cost,
            pb.currency AS procurement_currency,
            pb.exchange_rate_to_cny AS procurement_exchange_rate_to_cny,
            pb.unit_cost_cny AS procurement_unit_cost_cny,
            pb.total_cost_cny AS procurement_total_cost_cny,
            pb.purchased_at AS procurement_purchased_at,
            pb.quality_status AS procurement_quality_status,
            pb.quality_score AS procurement_quality_score,
            src.id AS source_id,
            src.source_name,
            src.source_url,
            src.platform AS source_platform,
            src.risk_tier AS source_risk_tier,
            src.quality_grade AS source_quality_grade
        FROM public.shop_inventory i
        LEFT JOIN inventory_order_links links ON links.inventory_id = i.id
        LEFT JOIN public.shop_products p ON p.id = i.product_id
        LEFT JOIN public.shop_product_skus s ON s.id = i.sku_id
        LEFT JOIN public.profiles prof ON prof.id = i.buyer_id
        LEFT JOIN public.shop_procurement_batches pb ON pb.id = i.source_batch_id
        LEFT JOIN public.shop_inventory_sources src ON src.id = pb.source_id
        WHERE
            (p_product_id IS NULL OR i.product_id = p_product_id)
            AND (
                p_sku_id IS NULL
                OR i.sku_id = v_filter_sku_id
                OR (v_filter_sku_is_default AND i.sku_id IS NULL)
            )
            AND (p_status IS NULL OR i.status = p_status)
            AND (
                v_search_term IS NULL
                OR i.content ILIKE '%' || v_search_term || '%'
                OR COALESCE(i.batch_id, '') ILIKE '%' || v_search_term || '%'
                OR COALESCE(i.remark, '') ILIKE '%' || v_search_term || '%'
                OR COALESCE(p.name, '') ILIKE '%' || v_search_term || '%'
                OR COALESCE(s.sku_name, '') ILIKE '%' || v_search_term || '%'
                OR COALESCE(s.sku_code, '') ILIKE '%' || v_search_term || '%'
                OR COALESCE(prof.email, '') ILIKE '%' || v_search_term || '%'
                OR COALESCE(links.order_id::TEXT, '') ILIKE '%' || v_search_term || '%'
                OR ('SHOP_ORDER_' || COALESCE(links.order_id::TEXT, '')) ILIKE '%' || v_search_term || '%'
                OR COALESCE(pb.batch_code, '') ILIKE '%' || v_search_term || '%'
                OR COALESCE(src.source_name, '') ILIKE '%' || v_search_term || '%'
                OR COALESCE(src.source_url, '') ILIKE '%' || v_search_term || '%'
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
    WHERE (p_product_id IS NULL OR product_id = p_product_id)
      AND (
          p_sku_id IS NULL
          OR sku_id = v_filter_sku_id
          OR (v_filter_sku_is_default AND sku_id IS NULL)
      );

    RETURN jsonb_build_object(
        'success', true,
        'items', COALESCE(v_items, '[]'::JSONB),
        'total', COALESCE(v_total, 0),
        'stats', COALESCE(v_stats, '{}'::JSONB)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_admin_list_inventory(
    UUID, VARCHAR, VARCHAR, INT, INT, TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, UUID
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_admin_list_inventory(
    UUID, VARCHAR, VARCHAR, INT, INT, TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, UUID
) TO authenticated;

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

CREATE OR REPLACE FUNCTION public.fn_sync_shop_product_sku_stock_counts(p_sku_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_sku_ids IS NULL OR array_length(p_sku_ids, 1) IS NULL THEN
        RETURN;
    END IF;

    WITH requested AS (
        SELECT DISTINCT sku_id
        FROM unnest(p_sku_ids) AS ids(sku_id)
        WHERE sku_id IS NOT NULL
    ),
    affected_sources AS (
        SELECT DISTINCT COALESCE(s.inventory_sku_id, s.id) AS source_sku_id
        FROM requested r
        JOIN public.shop_product_skus s ON s.id = r.sku_id
        UNION
        SELECT sku_id
        FROM requested
    ),
    affected_skus AS (
        SELECT
            s.id AS sku_id,
            s.product_id,
            COALESCE(s.inventory_sku_id, s.id) AS source_sku_id,
            COALESCE(source_sku.is_default, false) AS source_is_default
        FROM public.shop_product_skus s
        JOIN affected_sources affected ON affected.source_sku_id = COALESCE(s.inventory_sku_id, s.id)
        JOIN public.shop_product_skus source_sku ON source_sku.id = COALESCE(s.inventory_sku_id, s.id)
    ),
    real_counts AS (
        SELECT
            affected_skus.sku_id,
            COUNT(i.id)::INTEGER AS available_count
        FROM affected_skus
        LEFT JOIN public.shop_inventory i
          ON i.product_id = affected_skus.product_id
         AND LOWER(BTRIM(COALESCE(i.status, ''))) = 'available'
         AND (
             i.sku_id = affected_skus.source_sku_id
             OR (affected_skus.source_is_default AND i.sku_id IS NULL)
         )
        GROUP BY affected_skus.sku_id
    )
    UPDATE public.shop_product_skus s
    SET stock_count = real_counts.available_count,
        updated_at = NOW()
    FROM real_counts
    WHERE s.id = real_counts.sku_id;
END;
$$;

DO $$
DECLARE
    v_definition TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.fn_create_marketplace_shop_order(uuid,integer,text,text,text,jsonb,character varying,uuid,numeric,numeric,text,text,uuid)'::regprocedure
    )
    INTO v_definition;

    IF v_definition IS NOT NULL THEN
        IF POSITION('v_reusable_inventory_id UUID := NULL;' IN v_definition) = 0 THEN
            IF POSITION('v_inventory_primary_id UUID := NULL;' IN v_definition) > 0 THEN
                v_definition := REPLACE(
                    v_definition,
                    'v_inventory_primary_id UUID := NULL;',
                    'v_inventory_primary_id UUID := NULL;' || E'\n    v_reusable_inventory_id UUID := NULL;'
                );
            ELSE
                v_definition := REPLACE(
                    v_definition,
                    'v_inventory_primary_id UUID;',
                    'v_inventory_primary_id UUID;' || E'\n    v_reusable_inventory_id UUID := NULL;'
                );
            END IF;
        END IF;

        v_definition := REPLACE(
            v_definition,
            'SELECT id, content, created_at' || E'\n            FROM public.shop_inventory' || E'\n            WHERE product_id = p_product_id' || E'\n              AND status = ''available''' || E'\n              AND (' || E'\n                  sku_id = v_inventory_sku_id' || E'\n                  OR (v_inventory_sku_is_default AND sku_id IS NULL)' || E'\n              )' || E'\n            ORDER BY created_at ASC, id ASC' || E'\n            LIMIT v_quantity' || E'\n            FOR UPDATE SKIP LOCKED',
            'SELECT id, content, created_at' || E'\n            FROM public.shop_inventory' || E'\n            WHERE product_id = p_product_id' || E'\n              AND status = ''available''' || E'\n              AND COALESCE(is_shared, false) = false' || E'\n              AND (' || E'\n                  sku_id = v_inventory_sku_id' || E'\n                  OR (v_inventory_sku_is_default AND sku_id IS NULL)' || E'\n              )' || E'\n            ORDER BY created_at ASC, id ASC' || E'\n            LIMIT v_quantity' || E'\n            FOR UPDATE SKIP LOCKED'
        );

        IF POSITION('SELECT id INTO v_reusable_inventory_id' IN v_definition) = 0 THEN
            v_definition := REPLACE(
                v_definition,
                '        IF v_inventory_ids IS NULL OR array_length(v_inventory_ids, 1) < v_quantity THEN' || E'\n            RETURN jsonb_build_object(''success'', false, ''message'', ''shared sku inventory is insufficient'');' || E'\n        END IF;',
                '        IF COALESCE(array_length(v_inventory_ids, 1), 0) < v_quantity THEN' || E'\n            SELECT id INTO v_reusable_inventory_id' || E'\n            FROM public.shop_inventory' || E'\n            WHERE product_id = p_product_id' || E'\n              AND status = ''available''' || E'\n              AND COALESCE(is_shared, false) = true' || E'\n              AND (' || E'\n                  sku_id = v_inventory_sku_id' || E'\n                  OR (v_inventory_sku_is_default AND sku_id IS NULL)' || E'\n              )' || E'\n            ORDER BY created_at ASC, id ASC' || E'\n            LIMIT 1' || E'\n            FOR UPDATE;' || E'\n' || E'\n            IF v_reusable_inventory_id IS NULL THEN' || E'\n                RETURN jsonb_build_object(''success'', false, ''message'', ''shared sku inventory is insufficient'');' || E'\n            END IF;' || E'\n' || E'\n            SELECT' || E'\n                array_agg(id ORDER BY item_index),' || E'\n                array_agg(content ORDER BY item_index)' || E'\n            INTO v_inventory_ids, v_contents' || E'\n            FROM (' || E'\n                SELECT' || E'\n                    COALESCE(locked_rows.id, reusable_row.id) AS id,' || E'\n                    COALESCE(locked_rows.content, reusable_row.content) AS content,' || E'\n                    series.item_index' || E'\n                FROM generate_series(1, v_quantity) AS series(item_index)' || E'\n                LEFT JOIN unnest(' || E'\n                    COALESCE(v_inventory_ids, ARRAY[]::uuid[]),' || E'\n                    COALESCE(v_contents, ARRAY[]::text[])' || E'\n                ) WITH ORDINALITY AS locked_rows(id, content, item_index)' || E'\n                  ON locked_rows.item_index = series.item_index' || E'\n                CROSS JOIN public.shop_inventory reusable_row' || E'\n                WHERE reusable_row.id = v_reusable_inventory_id' || E'\n            ) delivery_rows;' || E'\n        END IF;'
            );
        END IF;

        v_definition := REPLACE(
            v_definition,
            '        UPDATE public.shop_inventory' || E'\n        SET status = ''sold'',' || E'\n            sku_id = COALESCE(sku_id, v_inventory_sku_id),' || E'\n            buyer_id = p_user_id,' || E'\n            sold_at = v_now' || E'\n        WHERE id = ANY(v_inventory_ids);',
            '        UPDATE public.shop_inventory' || E'\n        SET status = ''sold'',' || E'\n            sku_id = COALESCE(sku_id, v_inventory_sku_id),' || E'\n            buyer_id = p_user_id,' || E'\n            sold_at = v_now' || E'\n        WHERE id = ANY(v_inventory_ids)' || E'\n          AND COALESCE(is_shared, false) = false;'
        );

        IF POSITION('v_reusable_inventory_id UUID := NULL;' IN v_definition) = 0
            OR POSITION('COALESCE(is_shared, false) = false' IN v_definition) = 0
            OR POSITION('COALESCE(is_shared, false) = true' IN v_definition) = 0
            OR POSITION('generate_series(1, v_quantity)' IN v_definition) = 0 THEN
            RAISE EXCEPTION 'failed to patch fn_create_marketplace_shop_order with reusable inventory support';
        END IF;

        EXECUTE v_definition;
    END IF;
END;
$$;

DO $$
DECLARE
    v_definition TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.fn_purchase_shop_item_core(uuid,uuid,character varying,integer,character varying,uuid,uuid)'::regprocedure
    )
    INTO v_definition;

    IF v_definition IS NULL THEN
        RAISE EXCEPTION 'fn_purchase_shop_item_core is missing; run 20260523_add_shop_product_skus.sql first';
    END IF;

    IF POSITION('v_reusable_inventory_id UUID := NULL;' IN v_definition) = 0 THEN
        IF POSITION('v_inventory_primary_id UUID := NULL;' IN v_definition) > 0 THEN
            v_definition := REPLACE(
                v_definition,
                'v_inventory_primary_id UUID := NULL;',
                'v_inventory_primary_id UUID := NULL;' || E'\n    v_reusable_inventory_id UUID := NULL;'
            );
        ELSE
            v_definition := REPLACE(
                v_definition,
                'v_inventory_primary_id UUID;',
                'v_inventory_primary_id UUID;' || E'\n    v_reusable_inventory_id UUID := NULL;'
            );
        END IF;
    END IF;

    v_definition := REPLACE(
        v_definition,
        'SELECT id, content' || E'\n            FROM public.shop_inventory' || E'\n            WHERE product_id = p_product_id' || E'\n              AND status = ''available''' || E'\n              AND (' || E'\n                  sku_id = v_inventory_sku_id' || E'\n                  OR (v_inventory_sku_is_default AND sku_id IS NULL)' || E'\n              )' || E'\n            ORDER BY created_at ASC, id ASC' || E'\n            LIMIT p_quantity' || E'\n            FOR UPDATE SKIP LOCKED',
        'SELECT id, content' || E'\n            FROM public.shop_inventory' || E'\n            WHERE product_id = p_product_id' || E'\n              AND status = ''available''' || E'\n              AND COALESCE(is_shared, false) = false' || E'\n              AND (' || E'\n                  sku_id = v_inventory_sku_id' || E'\n                  OR (v_inventory_sku_is_default AND sku_id IS NULL)' || E'\n              )' || E'\n            ORDER BY created_at ASC, id ASC' || E'\n            LIMIT p_quantity' || E'\n            FOR UPDATE SKIP LOCKED'
    );

    IF POSITION('SELECT id INTO v_reusable_inventory_id' IN v_definition) = 0 THEN
        v_definition := REPLACE(
            v_definition,
            '        IF v_inventory_ids IS NULL OR array_length(v_inventory_ids, 1) < p_quantity THEN' || E'\n            RETURN jsonb_build_object(''success'', false, ''message'', ''商品库存不足，无法满足当前数量'');' || E'\n        END IF;',
            '        IF COALESCE(array_length(v_inventory_ids, 1), 0) < p_quantity THEN' || E'\n            SELECT id INTO v_reusable_inventory_id' || E'\n            FROM public.shop_inventory' || E'\n            WHERE product_id = p_product_id' || E'\n              AND status = ''available''' || E'\n              AND COALESCE(is_shared, false) = true' || E'\n              AND (' || E'\n                  sku_id = v_inventory_sku_id' || E'\n                  OR (v_inventory_sku_is_default AND sku_id IS NULL)' || E'\n              )' || E'\n            ORDER BY created_at ASC, id ASC' || E'\n            LIMIT 1' || E'\n            FOR UPDATE;' || E'\n' || E'\n            IF v_reusable_inventory_id IS NULL THEN' || E'\n                RETURN jsonb_build_object(''success'', false, ''message'', ''商品库存不足，无法满足当前数量'');' || E'\n            END IF;' || E'\n' || E'\n            SELECT' || E'\n                array_agg(id ORDER BY item_index),' || E'\n                array_agg(content ORDER BY item_index)' || E'\n            INTO v_inventory_ids, v_contents' || E'\n            FROM (' || E'\n                SELECT' || E'\n                    COALESCE(locked_rows.id, reusable_row.id) AS id,' || E'\n                    COALESCE(locked_rows.content, reusable_row.content) AS content,' || E'\n                    series.item_index' || E'\n                FROM generate_series(1, p_quantity) AS series(item_index)' || E'\n                LEFT JOIN unnest(' || E'\n                    COALESCE(v_inventory_ids, ARRAY[]::uuid[]),' || E'\n                    COALESCE(v_contents, ARRAY[]::text[])' || E'\n                ) WITH ORDINALITY AS locked_rows(id, content, item_index)' || E'\n                  ON locked_rows.item_index = series.item_index' || E'\n                CROSS JOIN public.shop_inventory reusable_row' || E'\n                WHERE reusable_row.id = v_reusable_inventory_id' || E'\n            ) delivery_rows;' || E'\n        END IF;'
        );
    END IF;

    v_definition := REPLACE(
        v_definition,
        '        UPDATE public.shop_inventory' || E'\n        SET status = ''sold'',' || E'\n            sku_id = COALESCE(sku_id, v_inventory_sku_id),' || E'\n            buyer_id = v_effective_user_id,' || E'\n            sold_at = v_now' || E'\n        WHERE id = ANY(v_inventory_ids);',
        '        UPDATE public.shop_inventory' || E'\n        SET status = ''sold'',' || E'\n            sku_id = COALESCE(sku_id, v_inventory_sku_id),' || E'\n            buyer_id = v_effective_user_id,' || E'\n            sold_at = v_now' || E'\n        WHERE id = ANY(v_inventory_ids)' || E'\n          AND COALESCE(is_shared, false) = false;'
    );

    IF POSITION('v_reusable_inventory_id UUID := NULL;' IN v_definition) = 0
        OR POSITION('COALESCE(is_shared, false) = false' IN v_definition) = 0
        OR POSITION('COALESCE(is_shared, false) = true' IN v_definition) = 0
        OR POSITION('generate_series(1, p_quantity)' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'failed to patch fn_purchase_shop_item_core with reusable inventory support';
    END IF;

    EXECUTE v_definition;
END;
$$;

SELECT public.fn_sync_shop_product_stock_counts(
    ARRAY(
        SELECT DISTINCT product_id
        FROM public.shop_inventory
        WHERE product_id IS NOT NULL
    )
);

SELECT public.fn_sync_shop_product_sku_stock_counts(
    ARRAY(
        SELECT id
        FROM public.shop_product_skus
    )
);

REVOKE ALL ON FUNCTION public.fn_sync_shop_product_stock_counts(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_sync_shop_product_stock_counts(UUID[]) FROM anon;
REVOKE ALL ON FUNCTION public.fn_sync_shop_product_stock_counts(UUID[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sync_shop_product_stock_counts(UUID[]) TO service_role;

REVOKE ALL ON FUNCTION public.fn_sync_shop_product_stock_count(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_sync_shop_product_stock_count(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.fn_sync_shop_product_stock_count(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sync_shop_product_stock_count(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.fn_sync_shop_product_sku_stock_counts(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_sync_shop_product_sku_stock_counts(UUID[]) FROM anon;
REVOKE ALL ON FUNCTION public.fn_sync_shop_product_sku_stock_counts(UUID[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sync_shop_product_sku_stock_counts(UUID[]) TO service_role;
