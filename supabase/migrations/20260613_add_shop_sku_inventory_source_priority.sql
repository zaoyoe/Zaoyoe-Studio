-- Allow a SKU to consume inventory from multiple source SKUs in priority order.
-- inventory_sku_id remains the compatibility field for the first external source.

ALTER TABLE public.shop_product_skus
    ADD COLUMN IF NOT EXISTS inventory_source_sku_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

UPDATE public.shop_product_skus
SET inventory_source_sku_ids = ARRAY[inventory_sku_id]::UUID[]
WHERE inventory_sku_id IS NOT NULL
  AND COALESCE(array_length(inventory_source_sku_ids, 1), 0) = 0;

UPDATE public.shop_product_skus
SET inventory_source_sku_ids = ARRAY(
        SELECT source_id
        FROM (
            SELECT source_id, MIN(source_rank) AS first_rank
            FROM unnest(COALESCE(inventory_source_sku_ids, ARRAY[]::UUID[])) WITH ORDINALITY AS source(source_id, source_rank)
            WHERE source_id IS NOT NULL
            GROUP BY source_id
        ) deduped
        ORDER BY first_rank
    ),
    inventory_sku_id = (
        ARRAY(
            SELECT source_id
            FROM (
                SELECT source_id, MIN(source_rank) AS first_rank
                FROM unnest(COALESCE(inventory_source_sku_ids, ARRAY[]::UUID[])) WITH ORDINALITY AS source(source_id, source_rank)
                WHERE source_id IS NOT NULL
                  AND source_id <> shop_product_skus.id
                GROUP BY source_id
            ) deduped
            ORDER BY first_rank
        )
    )[1];

CREATE INDEX IF NOT EXISTS idx_shop_product_skus_inventory_source_sku_ids
    ON public.shop_product_skus USING GIN (inventory_source_sku_ids);

CREATE OR REPLACE FUNCTION public.fn_resolve_shop_sku_inventory_sources(p_sku_id UUID)
RETURNS TABLE (
    source_sku_id UUID,
    source_is_default BOOLEAN,
    source_rank INT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    WITH target_sku AS (
        SELECT
            s.id,
            s.product_id,
            s.inventory_sku_id,
            COALESCE(s.inventory_source_sku_ids, ARRAY[]::UUID[]) AS inventory_source_sku_ids
        FROM public.shop_product_skus s
        WHERE s.id = p_sku_id
        LIMIT 1
    ),
    raw_sources AS (
        SELECT
            source.source_id,
            source.source_rank::INT
        FROM target_sku t
        CROSS JOIN LATERAL unnest(
            CASE
                WHEN COALESCE(array_length(t.inventory_source_sku_ids, 1), 0) > 0
                    THEN t.inventory_source_sku_ids
                WHEN t.inventory_sku_id IS NOT NULL
                    THEN ARRAY[t.inventory_sku_id]::UUID[]
                ELSE ARRAY[t.id]::UUID[]
            END
        ) WITH ORDINALITY AS source(source_id, source_rank)
        WHERE source.source_id IS NOT NULL
    ),
    deduped_sources AS (
        SELECT
            source_id,
            MIN(source_rank)::INT AS first_rank
        FROM raw_sources
        GROUP BY source_id
    )
    SELECT
        source_sku.id AS source_sku_id,
        COALESCE(source_sku.is_default, false) AS source_is_default,
        deduped_sources.first_rank AS source_rank
    FROM deduped_sources
    JOIN public.shop_product_skus source_sku ON source_sku.id = deduped_sources.source_id
    JOIN target_sku t ON t.product_id = source_sku.product_id
    ORDER BY deduped_sources.first_rank ASC;
$$;

CREATE OR REPLACE FUNCTION public.fn_validate_shop_product_sku_inventory_source()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_source_ids UUID[] := ARRAY[]::UUID[];
    v_source_id UUID;
    v_source public.shop_product_skus%ROWTYPE;
    v_source_source_ids UUID[];
BEGIN
    SELECT COALESCE(array_agg(source_id ORDER BY first_rank), ARRAY[]::UUID[])
    INTO v_source_ids
    FROM (
        SELECT source_id, MIN(source_rank) AS first_rank
        FROM unnest(COALESCE(NEW.inventory_source_sku_ids, ARRAY[]::UUID[])) WITH ORDINALITY AS source(source_id, source_rank)
        WHERE source_id IS NOT NULL
        GROUP BY source_id
    ) deduped;

    IF COALESCE(array_length(v_source_ids, 1), 0) = 0
        AND NEW.inventory_sku_id IS NOT NULL THEN
        v_source_ids := ARRAY[NEW.inventory_sku_id]::UUID[];
    END IF;

    NEW.inventory_source_sku_ids := COALESCE(v_source_ids, ARRAY[]::UUID[]);
    SELECT source_id
    INTO NEW.inventory_sku_id
    FROM unnest(COALESCE(v_source_ids, ARRAY[]::UUID[])) AS source(source_id)
    WHERE source_id IS NOT NULL
      AND source_id <> NEW.id
    LIMIT 1;

    IF COALESCE(array_length(v_source_ids, 1), 0) = 0 THEN
        IF EXISTS (
            SELECT 1
            FROM public.shop_product_skus dependent
            WHERE dependent.id <> NEW.id
              AND NEW.id = ANY(
                  CASE
                      WHEN COALESCE(array_length(dependent.inventory_source_sku_ids, 1), 0) > 0
                          THEN dependent.inventory_source_sku_ids
                      WHEN dependent.inventory_sku_id IS NOT NULL
                          THEN ARRAY[dependent.inventory_sku_id]::UUID[]
                      ELSE ARRAY[]::UUID[]
                  END
              )
              AND dependent.product_id IS DISTINCT FROM NEW.product_id
        ) THEN
            RAISE EXCEPTION 'shop_product_sku_inventory_source_invalid: source sku aliases must stay in the same product';
        END IF;

        RETURN NEW;
    END IF;

    FOREACH v_source_id IN ARRAY v_source_ids
    LOOP
        IF v_source_id = NEW.id THEN
            CONTINUE;
        END IF;

        SELECT *
        INTO v_source
        FROM public.shop_product_skus
        WHERE id = v_source_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'shop_product_sku_inventory_source_invalid: source sku does not exist';
        END IF;

        IF v_source.product_id IS DISTINCT FROM NEW.product_id THEN
            RAISE EXCEPTION 'shop_product_sku_inventory_source_invalid: source sku must belong to the same product';
        END IF;

        SELECT COALESCE(array_agg(source_id ORDER BY first_rank), ARRAY[]::UUID[])
        INTO v_source_source_ids
        FROM (
            SELECT source_id, MIN(source_rank) AS first_rank
            FROM unnest(COALESCE(v_source.inventory_source_sku_ids, ARRAY[]::UUID[])) WITH ORDINALITY AS source(source_id, source_rank)
            WHERE source_id IS NOT NULL
              AND source_id <> v_source.id
            GROUP BY source_id
        ) deduped;

        IF COALESCE(array_length(v_source_source_ids, 1), 0) = 0
            AND v_source.inventory_sku_id IS NOT NULL
            AND v_source.inventory_sku_id <> v_source.id THEN
            v_source_source_ids := ARRAY[v_source.inventory_sku_id]::UUID[];
        END IF;

        IF COALESCE(array_length(v_source_source_ids, 1), 0) > 0 THEN
            RAISE EXCEPTION 'shop_product_sku_inventory_source_invalid: source sku cannot be another shared-inventory alias';
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_shop_product_skus_validate_inventory_source ON public.shop_product_skus;
CREATE TRIGGER tr_shop_product_skus_validate_inventory_source
BEFORE INSERT OR UPDATE OF product_id, inventory_sku_id, inventory_source_sku_ids ON public.shop_product_skus
FOR EACH ROW
EXECUTE FUNCTION public.fn_validate_shop_product_sku_inventory_source();

CREATE OR REPLACE FUNCTION public.fn_sync_shop_product_sku_stock_counts(p_sku_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
        SELECT sku_id AS source_sku_id
        FROM requested
        UNION
        SELECT resolved.source_sku_id
        FROM requested r
        CROSS JOIN LATERAL public.fn_resolve_shop_sku_inventory_sources(r.sku_id) resolved
    ),
    affected_skus AS (
        SELECT DISTINCT s.id AS sku_id
        FROM public.shop_product_skus s
        WHERE s.id IN (SELECT source_sku_id FROM affected_sources)
           OR EXISTS (
               SELECT 1
               FROM public.fn_resolve_shop_sku_inventory_sources(s.id) resolved
               WHERE resolved.source_sku_id IN (SELECT source_sku_id FROM affected_sources)
           )
    ),
    sku_sources AS (
        SELECT
            affected_skus.sku_id,
            s.product_id,
            resolved.source_sku_id,
            resolved.source_is_default
        FROM affected_skus
        JOIN public.shop_product_skus s ON s.id = affected_skus.sku_id
        CROSS JOIN LATERAL public.fn_resolve_shop_sku_inventory_sources(s.id) resolved
    ),
    real_counts AS (
        SELECT
            sku_sources.sku_id,
            COUNT(DISTINCT i.id)::INTEGER AS available_count
        FROM sku_sources
        LEFT JOIN public.shop_inventory i
          ON i.product_id = sku_sources.product_id
         AND LOWER(BTRIM(COALESCE(i.status, ''))) = 'available'
         AND (
             i.sku_id = sku_sources.source_sku_id
             OR (sku_sources.source_is_default AND i.sku_id IS NULL)
         )
        GROUP BY sku_sources.sku_id
    )
    UPDATE public.shop_product_skus s
    SET stock_count = real_counts.available_count,
        updated_at = NOW()
    FROM real_counts
    WHERE s.id = real_counts.sku_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_trigger_sync_shop_product_sku_inventory_source_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_sku_ids UUID[];
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_sku_ids := ARRAY[NEW.id, NEW.inventory_sku_id]::UUID[] || COALESCE(NEW.inventory_source_sku_ids, ARRAY[]::UUID[]);
    ELSE
        v_sku_ids := ARRAY[OLD.id, OLD.inventory_sku_id, NEW.id, NEW.inventory_sku_id]::UUID[]
            || COALESCE(OLD.inventory_source_sku_ids, ARRAY[]::UUID[])
            || COALESCE(NEW.inventory_source_sku_ids, ARRAY[]::UUID[]);
    END IF;

    PERFORM public.fn_sync_shop_product_sku_stock_counts(
        ARRAY(
            SELECT DISTINCT sku_id
            FROM unnest(v_sku_ids) AS ids(sku_id)
            WHERE sku_id IS NOT NULL
        )
    );

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_shop_product_skus_inventory_source_stock ON public.shop_product_skus;
CREATE TRIGGER tr_shop_product_skus_inventory_source_stock
AFTER INSERT OR UPDATE OF product_id, inventory_sku_id, inventory_source_sku_ids, is_default ON public.shop_product_skus
FOR EACH ROW
EXECUTE FUNCTION public.fn_trigger_sync_shop_product_sku_inventory_source_stock();

CREATE OR REPLACE FUNCTION public.fn_lock_shop_sku_inventory(
    p_product_id UUID,
    p_sku_id UUID,
    p_quantity INT
)
RETURNS TABLE (
    item_index INT,
    inventory_id UUID,
    content TEXT,
    source_sku_id UUID,
    is_shared BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_quantity INT := GREATEST(COALESCE(p_quantity, 1), 0);
BEGIN
    IF p_product_id IS NULL OR p_sku_id IS NULL OR v_quantity <= 0 THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH source_rows AS MATERIALIZED (
        SELECT *
        FROM public.fn_resolve_shop_sku_inventory_sources(p_sku_id)
    ),
    locked_rows AS MATERIALIZED (
        SELECT
            ROW_NUMBER() OVER (ORDER BY locked.source_rank ASC, locked.created_at ASC, locked.id ASC)::INT AS item_index,
            locked.id,
            locked.content,
            locked.source_sku_id
        FROM (
            SELECT
                i.id,
                i.content,
                i.created_at,
                source_rows.source_sku_id,
                source_rows.source_rank
            FROM source_rows
            JOIN public.shop_inventory i
              ON i.product_id = p_product_id
             AND LOWER(BTRIM(COALESCE(i.status, ''))) = 'available'
             AND COALESCE(i.is_shared, false) = false
             AND (
                 i.sku_id = source_rows.source_sku_id
                 OR (source_rows.source_is_default AND i.sku_id IS NULL)
             )
            ORDER BY source_rows.source_rank ASC, i.created_at ASC, i.id ASC
            LIMIT v_quantity
            FOR UPDATE OF i SKIP LOCKED
        ) locked
    ),
    reusable_row AS MATERIALIZED (
        SELECT
            i.id,
            i.content,
            source_rows.source_sku_id
        FROM source_rows
        JOIN public.shop_inventory i
          ON i.product_id = p_product_id
         AND LOWER(BTRIM(COALESCE(i.status, ''))) = 'available'
         AND COALESCE(i.is_shared, false) = true
         AND (
             i.sku_id = source_rows.source_sku_id
             OR (source_rows.source_is_default AND i.sku_id IS NULL)
         )
        ORDER BY source_rows.source_rank ASC, i.created_at ASC, i.id ASC
        LIMIT 1
        FOR UPDATE OF i
    )
    SELECT
        series.item_index::INT,
        COALESCE(locked_rows.id, reusable_row.id) AS inventory_id,
        COALESCE(locked_rows.content, reusable_row.content) AS content,
        COALESCE(locked_rows.source_sku_id, reusable_row.source_sku_id) AS source_sku_id,
        (locked_rows.id IS NULL AND reusable_row.id IS NOT NULL) AS is_shared
    FROM generate_series(1, v_quantity) AS series(item_index)
    LEFT JOIN locked_rows ON locked_rows.item_index = series.item_index
    LEFT JOIN reusable_row ON locked_rows.id IS NULL
    WHERE locked_rows.id IS NOT NULL
       OR reusable_row.id IS NOT NULL
    ORDER BY series.item_index ASC;
END;
$$;

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
    v_filter_sku_ids UUID[] := CASE WHEN p_sku_id IS NULL THEN ARRAY[]::UUID[] ELSE ARRAY[p_sku_id]::UUID[] END;
    v_filter_has_default BOOLEAN := false;
BEGIN
    IF NOT (
        public.is_admin()
        OR (auth.jwt() ->> 'email') IN ('fjivvid@163.com', 'zaoyoe@gmail.com')
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', 'Access denied');
    END IF;

    IF p_sku_id IS NOT NULL THEN
        SELECT
            COALESCE(array_agg(source_sku_id ORDER BY source_rank), ARRAY[p_sku_id]::UUID[]),
            COALESCE(bool_or(source_is_default), false)
        INTO v_filter_sku_ids, v_filter_has_default
        FROM public.fn_resolve_shop_sku_inventory_sources(p_sku_id);

        v_filter_sku_ids := COALESCE(v_filter_sku_ids, ARRAY[p_sku_id]::UUID[]);
        v_filter_has_default := COALESCE(v_filter_has_default, false);
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
                OR i.sku_id = ANY(v_filter_sku_ids)
                OR (v_filter_has_default AND i.sku_id IS NULL)
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
          OR sku_id = ANY(v_filter_sku_ids)
          OR (v_filter_has_default AND sku_id IS NULL)
      );

    RETURN jsonb_build_object(
        'success', true,
        'items', COALESCE(v_items, '[]'::JSONB),
        'total', COALESCE(v_total, 0),
        'stats', COALESCE(v_stats, '{}'::JSONB)
    );
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
        IF POSITION('v_inventory_source_ids UUID[];' IN v_definition) = 0 THEN
            v_definition := REPLACE(
                v_definition,
                'v_inventory_ids UUID[];',
                'v_inventory_ids UUID[];' || E'\n    v_inventory_source_ids UUID[];'
            );
        END IF;

        v_definition := REPLACE(
            v_definition,
            'v_inventory_sku_id := COALESCE(v_sku.inventory_sku_id, v_sku.id);',
            'v_inventory_sku_id := COALESCE((' || E'\n        SELECT source_sku_id' || E'\n        FROM public.fn_resolve_shop_sku_inventory_sources(v_sku.id)' || E'\n        ORDER BY source_rank ASC' || E'\n        LIMIT 1' || E'\n    ), v_sku.id);'
        );

        v_definition := REPLACE(
            v_definition,
            'WITH locked_inventory AS (' || E'\n            SELECT id, content, created_at' || E'\n            FROM public.shop_inventory' || E'\n            WHERE product_id = p_product_id' || E'\n              AND status = ''available''' || E'\n              AND COALESCE(is_shared, false) = false' || E'\n              AND (' || E'\n                  sku_id = v_inventory_sku_id' || E'\n                  OR (v_inventory_sku_is_default AND sku_id IS NULL)' || E'\n              )' || E'\n            ORDER BY created_at ASC, id ASC' || E'\n            LIMIT v_quantity' || E'\n            FOR UPDATE SKIP LOCKED' || E'\n        )' || E'\n        SELECT array_agg(id ORDER BY created_at ASC, id ASC), array_agg(content ORDER BY created_at ASC, id ASC)' || E'\n        INTO v_inventory_ids, v_contents' || E'\n        FROM locked_inventory;',
            'SELECT' || E'\n            array_agg(inventory_id ORDER BY item_index),' || E'\n            array_agg(content ORDER BY item_index),' || E'\n            array_agg(source_sku_id ORDER BY item_index)' || E'\n        INTO v_inventory_ids, v_contents, v_inventory_source_ids' || E'\n        FROM public.fn_lock_shop_sku_inventory(p_product_id, v_sku_id, v_quantity);'
        );

        v_definition := REPLACE(
            v_definition,
            '        UPDATE public.shop_inventory' || E'\n        SET status = ''sold'',' || E'\n            sku_id = COALESCE(sku_id, v_inventory_sku_id),' || E'\n            buyer_id = p_user_id,' || E'\n            sold_at = v_now' || E'\n        WHERE id = ANY(v_inventory_ids)' || E'\n          AND COALESCE(is_shared, false) = false;',
            '        UPDATE public.shop_inventory AS inventory' || E'\n        SET status = ''sold'',' || E'\n            sku_id = COALESCE(inventory.sku_id, locked.source_sku_id, v_inventory_sku_id),' || E'\n            buyer_id = p_user_id,' || E'\n            sold_at = v_now' || E'\n        FROM (' || E'\n            SELECT DISTINCT ON (inventory_id)' || E'\n                inventory_id,' || E'\n                source_sku_id' || E'\n            FROM unnest(' || E'\n                COALESCE(v_inventory_ids, ARRAY[]::UUID[]),' || E'\n                COALESCE(v_inventory_source_ids, ARRAY[]::UUID[])' || E'\n            ) AS item(inventory_id, source_sku_id)' || E'\n            WHERE inventory_id IS NOT NULL' || E'\n            ORDER BY inventory_id' || E'\n        ) locked' || E'\n        WHERE inventory.id = locked.inventory_id' || E'\n          AND COALESCE(inventory.is_shared, false) = false;'
        );

        IF POSITION('v_inventory_source_ids UUID[];' IN v_definition) = 0
            OR POSITION('fn_lock_shop_sku_inventory(p_product_id, v_sku_id, v_quantity)' IN v_definition) = 0
            OR POSITION('COALESCE(inventory.sku_id, locked.source_sku_id, v_inventory_sku_id)' IN v_definition) = 0 THEN
            RAISE EXCEPTION 'failed to patch fn_create_marketplace_shop_order with priority SKU inventory sources';
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

    IF POSITION('v_inventory_source_ids UUID[];' IN v_definition) = 0 THEN
        v_definition := REPLACE(
            v_definition,
            'v_inventory_ids UUID[];',
            'v_inventory_ids UUID[];' || E'\n    v_inventory_source_ids UUID[];'
        );
    END IF;

    v_definition := REPLACE(
        v_definition,
        'v_inventory_sku_id := COALESCE(v_sku.inventory_sku_id, v_sku.id);',
        'v_inventory_sku_id := COALESCE((' || E'\n        SELECT source_sku_id' || E'\n        FROM public.fn_resolve_shop_sku_inventory_sources(v_sku.id)' || E'\n        ORDER BY source_rank ASC' || E'\n        LIMIT 1' || E'\n    ), v_sku.id);'
    );

    v_definition := REPLACE(
        v_definition,
        'SELECT array_agg(id), array_agg(content)' || E'\n        INTO v_inventory_ids, v_contents' || E'\n        FROM (' || E'\n            SELECT id, content' || E'\n            FROM public.shop_inventory' || E'\n            WHERE product_id = p_product_id' || E'\n              AND status = ''available''' || E'\n              AND COALESCE(is_shared, false) = false' || E'\n              AND (' || E'\n                  sku_id = v_inventory_sku_id' || E'\n                  OR (v_inventory_sku_is_default AND sku_id IS NULL)' || E'\n              )' || E'\n            ORDER BY created_at ASC, id ASC' || E'\n            LIMIT p_quantity' || E'\n            FOR UPDATE SKIP LOCKED' || E'\n        ) t;',
        'SELECT' || E'\n            array_agg(inventory_id ORDER BY item_index),' || E'\n            array_agg(content ORDER BY item_index),' || E'\n            array_agg(source_sku_id ORDER BY item_index)' || E'\n        INTO v_inventory_ids, v_contents, v_inventory_source_ids' || E'\n        FROM public.fn_lock_shop_sku_inventory(p_product_id, v_sku_id, p_quantity);'
    );

    v_definition := REPLACE(
        v_definition,
        '        UPDATE public.shop_inventory' || E'\n        SET status = ''sold'',' || E'\n            sku_id = COALESCE(sku_id, v_inventory_sku_id),' || E'\n            buyer_id = v_effective_user_id,' || E'\n            sold_at = v_now' || E'\n        WHERE id = ANY(v_inventory_ids)' || E'\n          AND COALESCE(is_shared, false) = false;',
        '        UPDATE public.shop_inventory AS inventory' || E'\n        SET status = ''sold'',' || E'\n            sku_id = COALESCE(inventory.sku_id, locked.source_sku_id, v_inventory_sku_id),' || E'\n            buyer_id = v_effective_user_id,' || E'\n            sold_at = v_now' || E'\n        FROM (' || E'\n            SELECT DISTINCT ON (inventory_id)' || E'\n                inventory_id,' || E'\n                source_sku_id' || E'\n            FROM unnest(' || E'\n                COALESCE(v_inventory_ids, ARRAY[]::UUID[]),' || E'\n                COALESCE(v_inventory_source_ids, ARRAY[]::UUID[])' || E'\n            ) AS item(inventory_id, source_sku_id)' || E'\n            WHERE inventory_id IS NOT NULL' || E'\n            ORDER BY inventory_id' || E'\n        ) locked' || E'\n        WHERE inventory.id = locked.inventory_id' || E'\n          AND COALESCE(inventory.is_shared, false) = false;'
    );

    IF POSITION('v_inventory_source_ids UUID[];' IN v_definition) = 0
        OR POSITION('fn_lock_shop_sku_inventory(p_product_id, v_sku_id, p_quantity)' IN v_definition) = 0
        OR POSITION('COALESCE(inventory.sku_id, locked.source_sku_id, v_inventory_sku_id)' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'failed to patch fn_purchase_shop_item_core with priority SKU inventory sources';
    END IF;

    EXECUTE v_definition;
END;
$$;

SELECT public.fn_sync_shop_product_sku_stock_counts(
    ARRAY(
        SELECT id
        FROM public.shop_product_skus
    )
);

REVOKE ALL ON FUNCTION public.fn_resolve_shop_sku_inventory_sources(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_resolve_shop_sku_inventory_sources(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.fn_resolve_shop_sku_inventory_sources(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_resolve_shop_sku_inventory_sources(UUID) TO service_role, authenticated;

REVOKE ALL ON FUNCTION public.fn_lock_shop_sku_inventory(UUID, UUID, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_lock_shop_sku_inventory(UUID, UUID, INT) FROM anon;
REVOKE ALL ON FUNCTION public.fn_lock_shop_sku_inventory(UUID, UUID, INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_lock_shop_sku_inventory(UUID, UUID, INT) TO service_role;

REVOKE ALL ON FUNCTION public.fn_sync_shop_product_sku_stock_counts(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_sync_shop_product_sku_stock_counts(UUID[]) FROM anon;
REVOKE ALL ON FUNCTION public.fn_sync_shop_product_sku_stock_counts(UUID[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sync_shop_product_sku_stock_counts(UUID[]) TO service_role;

REVOKE ALL ON FUNCTION public.fn_admin_list_inventory(
    UUID, VARCHAR, VARCHAR, INT, INT, TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, UUID
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_admin_list_inventory(
    UUID, VARCHAR, VARCHAR, INT, INT, TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, UUID
) TO authenticated;
