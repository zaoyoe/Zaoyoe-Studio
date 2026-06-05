-- Allow multiple product SKUs to sell from one shared inventory pool.
-- Orders keep the selected SKU, while stock locking/decrementing uses the
-- effective inventory source SKU.

ALTER TABLE public.shop_product_skus
    ADD COLUMN IF NOT EXISTS inventory_sku_id UUID;

UPDATE public.shop_product_skus
SET inventory_sku_id = NULL
WHERE inventory_sku_id = id;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'shop_product_skus'
          AND constraint_name = 'shop_product_skus_inventory_sku_id_fkey'
    ) THEN
        ALTER TABLE public.shop_product_skus
            ADD CONSTRAINT shop_product_skus_inventory_sku_id_fkey
            FOREIGN KEY (inventory_sku_id)
            REFERENCES public.shop_product_skus(id)
            ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'shop_product_skus'
          AND constraint_name = 'shop_product_skus_inventory_sku_not_self'
    ) THEN
        ALTER TABLE public.shop_product_skus
            ADD CONSTRAINT shop_product_skus_inventory_sku_not_self
            CHECK (inventory_sku_id IS NULL OR inventory_sku_id <> id);
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_shop_product_skus_inventory_sku_id
    ON public.shop_product_skus (inventory_sku_id)
    WHERE inventory_sku_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_validate_shop_product_sku_inventory_source()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_source public.shop_product_skus%ROWTYPE;
BEGIN
    IF NEW.inventory_sku_id IS NULL THEN
        IF EXISTS (
            SELECT 1
            FROM public.shop_product_skus dependent
            WHERE dependent.inventory_sku_id = NEW.id
              AND dependent.product_id IS DISTINCT FROM NEW.product_id
        ) THEN
            RAISE EXCEPTION 'shop_product_sku_inventory_source_invalid: source sku aliases must stay in the same product';
        END IF;

        RETURN NEW;
    END IF;

    IF NEW.inventory_sku_id = NEW.id THEN
        RAISE EXCEPTION 'shop_product_sku_inventory_source_invalid: sku cannot use itself as inventory source';
    END IF;

    SELECT *
    INTO v_source
    FROM public.shop_product_skus
    WHERE id = NEW.inventory_sku_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'shop_product_sku_inventory_source_invalid: source sku does not exist';
    END IF;

    IF v_source.product_id IS DISTINCT FROM NEW.product_id THEN
        RAISE EXCEPTION 'shop_product_sku_inventory_source_invalid: source sku must belong to the same product';
    END IF;

    IF v_source.inventory_sku_id IS NOT NULL THEN
        RAISE EXCEPTION 'shop_product_sku_inventory_source_invalid: source sku cannot be another shared-inventory alias';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.shop_product_skus dependent
        WHERE dependent.inventory_sku_id = NEW.id
          AND dependent.id <> NEW.id
    ) THEN
        RAISE EXCEPTION 'shop_product_sku_inventory_source_invalid: a source sku cannot also share another sku inventory';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_shop_product_skus_validate_inventory_source ON public.shop_product_skus;
CREATE TRIGGER tr_shop_product_skus_validate_inventory_source
BEFORE INSERT OR UPDATE OF product_id, inventory_sku_id ON public.shop_product_skus
FOR EACH ROW
EXECUTE FUNCTION public.fn_validate_shop_product_sku_inventory_source();

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

CREATE OR REPLACE FUNCTION public.fn_trigger_sync_shop_product_sku_inventory_source_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sku_ids UUID[];
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_sku_ids := ARRAY[NEW.id, NEW.inventory_sku_id];
    ELSE
        v_sku_ids := ARRAY[OLD.id, OLD.inventory_sku_id, NEW.id, NEW.inventory_sku_id];
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
AFTER INSERT OR UPDATE OF product_id, inventory_sku_id, is_default ON public.shop_product_skus
FOR EACH ROW
EXECUTE FUNCTION public.fn_trigger_sync_shop_product_sku_inventory_source_stock();

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
            i.buyer_id,
            i.sold_at,
            i.created_at,
            i.remark,
            p.name AS product_name,
            s.sku_name,
            s.sku_code,
            prof.email AS buyer_email,
            links.order_id
        FROM public.shop_inventory i
        LEFT JOIN inventory_order_links links ON links.inventory_id = i.id
        LEFT JOIN public.shop_products p ON p.id = i.product_id
        LEFT JOIN public.shop_product_skus s ON s.id = i.sku_id
        LEFT JOIN public.profiles prof ON prof.id = i.buyer_id
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

DO $$
DECLARE
    v_definition TEXT;
BEGIN
    SELECT pg_get_functiondef(
        'public.fn_create_marketplace_shop_order(uuid,integer,text,text,text,jsonb,character varying,uuid,numeric,numeric,text,text,uuid)'::regprocedure
    )
    INTO v_definition;

    IF v_definition IS NOT NULL THEN
        IF POSITION('v_inventory_sku_id UUID := NULL;' IN v_definition) = 0 THEN
            v_definition := REPLACE(
                v_definition,
                'v_sku_id UUID := p_sku_id;' || E'\n    v_sku_is_default BOOLEAN := false;',
                'v_sku_id UUID := p_sku_id;' || E'\n    v_sku_is_default BOOLEAN := false;' || E'\n    v_inventory_sku_id UUID := NULL;' || E'\n    v_inventory_sku_is_default BOOLEAN := false;'
            );
        END IF;

        IF POSITION('v_inventory_sku_id := COALESCE(v_sku.inventory_sku_id, v_sku.id);' IN v_definition) = 0 THEN
            v_definition := REPLACE(
                v_definition,
                'v_sku_id := v_sku.id;' || E'\n    v_sku_is_default := COALESCE(v_sku.is_default, false);',
                'v_sku_id := v_sku.id;' || E'\n    v_sku_is_default := COALESCE(v_sku.is_default, false);' || E'\n    v_inventory_sku_id := COALESCE(v_sku.inventory_sku_id, v_sku.id);' || E'\n    SELECT COALESCE(source_sku.is_default, false)' || E'\n    INTO v_inventory_sku_is_default' || E'\n    FROM public.shop_product_skus source_sku' || E'\n    WHERE source_sku.id = v_inventory_sku_id;' || E'\n    v_inventory_sku_is_default := COALESCE(v_inventory_sku_is_default, false);'
            );
        END IF;

        v_definition := REPLACE(
            v_definition,
            '                  sku_id = v_sku_id' || E'\n                  OR (v_sku_is_default AND sku_id IS NULL)',
            '                  sku_id = v_inventory_sku_id' || E'\n                  OR (v_inventory_sku_is_default AND sku_id IS NULL)'
        );
        v_definition := REPLACE(
            v_definition,
            '            sku_id = COALESCE(sku_id, v_sku_id),',
            '            sku_id = COALESCE(sku_id, v_inventory_sku_id),'
        );

        IF POSITION('v_inventory_sku_id UUID := NULL;' IN v_definition) = 0
            OR POSITION('v_inventory_sku_is_default BOOLEAN := false;' IN v_definition) = 0
            OR POSITION('v_inventory_sku_id := COALESCE(v_sku.inventory_sku_id, v_sku.id);' IN v_definition) = 0
            OR POSITION('sku_id = v_sku_id' || E'\n                  OR (v_sku_is_default AND sku_id IS NULL)' IN v_definition) > 0
            OR POSITION('sku_id = COALESCE(sku_id, v_sku_id),' IN v_definition) > 0 THEN
            RAISE EXCEPTION 'failed to patch fn_create_marketplace_shop_order with shared SKU inventory source';
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

    IF POSITION('v_inventory_sku_id UUID := NULL;' IN v_definition) = 0 THEN
        v_definition := REPLACE(
            v_definition,
            'v_sku_id UUID := p_sku_id;' || E'\n    v_sku_is_default BOOLEAN := false;',
            'v_sku_id UUID := p_sku_id;' || E'\n    v_sku_is_default BOOLEAN := false;' || E'\n    v_inventory_sku_id UUID := NULL;' || E'\n    v_inventory_sku_is_default BOOLEAN := false;'
        );
    END IF;

    IF POSITION('v_inventory_sku_id := COALESCE(v_sku.inventory_sku_id, v_sku.id);' IN v_definition) = 0 THEN
        v_definition := REPLACE(
            v_definition,
            'v_sku_id := v_sku.id;' || E'\n    v_sku_is_default := COALESCE(v_sku.is_default, false);',
            'v_sku_id := v_sku.id;' || E'\n    v_sku_is_default := COALESCE(v_sku.is_default, false);' || E'\n    v_inventory_sku_id := COALESCE(v_sku.inventory_sku_id, v_sku.id);' || E'\n    SELECT COALESCE(source_sku.is_default, false)' || E'\n    INTO v_inventory_sku_is_default' || E'\n    FROM public.shop_product_skus source_sku' || E'\n    WHERE source_sku.id = v_inventory_sku_id;' || E'\n    v_inventory_sku_is_default := COALESCE(v_inventory_sku_is_default, false);'
        );
    END IF;

    v_definition := REPLACE(
        v_definition,
        '                  sku_id = v_sku_id' || E'\n                  OR (v_sku_is_default AND sku_id IS NULL)',
        '                  sku_id = v_inventory_sku_id' || E'\n                  OR (v_inventory_sku_is_default AND sku_id IS NULL)'
    );
    v_definition := REPLACE(
        v_definition,
        '            sku_id = COALESCE(sku_id, v_sku_id),',
        '            sku_id = COALESCE(sku_id, v_inventory_sku_id),'
    );

    IF POSITION('v_inventory_sku_id UUID := NULL;' IN v_definition) = 0
        OR POSITION('v_inventory_sku_is_default BOOLEAN := false;' IN v_definition) = 0
        OR POSITION('v_inventory_sku_id := COALESCE(v_sku.inventory_sku_id, v_sku.id);' IN v_definition) = 0
        OR POSITION('sku_id = v_sku_id' || E'\n                  OR (v_sku_is_default AND sku_id IS NULL)' IN v_definition) > 0
        OR POSITION('sku_id = COALESCE(sku_id, v_sku_id),' IN v_definition) > 0 THEN
        RAISE EXCEPTION 'failed to patch fn_purchase_shop_item_core with shared SKU inventory source';
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
