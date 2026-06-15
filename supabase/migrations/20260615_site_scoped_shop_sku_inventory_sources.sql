-- Split fallback SKU inventory-source chains by storefront site.
-- CN/Fatherkey keeps using inventory_source_sku_ids and inventory_sku_id.
-- INTL/zaoyoe uses inventory_source_sku_ids_intl while the underlying stock rows stay shared.

ALTER TABLE public.shop_product_skus
    ADD COLUMN IF NOT EXISTS inventory_source_sku_ids_intl UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

UPDATE public.shop_product_skus
SET inventory_source_sku_ids_intl = COALESCE(inventory_source_sku_ids, ARRAY[]::UUID[])
WHERE COALESCE(array_length(inventory_source_sku_ids_intl, 1), 0) = 0
  AND COALESCE(array_length(inventory_source_sku_ids, 1), 0) > 0;

CREATE INDEX IF NOT EXISTS idx_shop_product_skus_inventory_source_sku_ids_intl
    ON public.shop_product_skus USING GIN (inventory_source_sku_ids_intl);

CREATE OR REPLACE FUNCTION public.fn_resolve_shop_sku_inventory_sources(
    p_sku_id UUID,
    p_site TEXT
)
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
            COALESCE(s.inventory_source_sku_ids, ARRAY[]::UUID[]) AS inventory_source_sku_ids,
            COALESCE(s.inventory_source_sku_ids_intl, ARRAY[]::UUID[]) AS inventory_source_sku_ids_intl,
            CASE
                WHEN LOWER(BTRIM(COALESCE(p_site, 'cn'))) = 'intl' THEN 'intl'
                ELSE 'cn'
            END AS normalized_site
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
                WHEN t.normalized_site = 'intl'
                     AND COALESCE(array_length(t.inventory_source_sku_ids_intl, 1), 0) > 0
                    THEN t.inventory_source_sku_ids_intl
                WHEN t.normalized_site <> 'intl'
                     AND COALESCE(array_length(t.inventory_source_sku_ids, 1), 0) > 0
                    THEN t.inventory_source_sku_ids
                WHEN t.normalized_site = 'intl'
                     AND COALESCE(array_length(t.inventory_source_sku_ids_intl, 1), 0) = 0
                    THEN ARRAY[t.id]::UUID[]
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
    SELECT *
    FROM public.fn_resolve_shop_sku_inventory_sources(p_sku_id, 'cn');
$$;

CREATE OR REPLACE FUNCTION public.fn_validate_shop_product_sku_inventory_source()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_shared_source_ids UUID[] := ARRAY[]::UUID[];
    v_intl_source_ids UUID[] := ARRAY[]::UUID[];
    v_source_id UUID;
    v_source public.shop_product_skus%ROWTYPE;
    v_source_source_ids UUID[];
BEGIN
    SELECT COALESCE(array_agg(source_id ORDER BY first_rank), ARRAY[]::UUID[])
    INTO v_shared_source_ids
    FROM (
        SELECT source_id, MIN(source_rank) AS first_rank
        FROM unnest(COALESCE(NEW.inventory_source_sku_ids, ARRAY[]::UUID[])) WITH ORDINALITY AS source(source_id, source_rank)
        WHERE source_id IS NOT NULL
        GROUP BY source_id
    ) deduped;

    IF COALESCE(array_length(v_shared_source_ids, 1), 0) = 0
        AND NEW.inventory_sku_id IS NOT NULL THEN
        v_shared_source_ids := ARRAY[NEW.inventory_sku_id]::UUID[];
    END IF;

    SELECT COALESCE(array_agg(source_id ORDER BY first_rank), ARRAY[]::UUID[])
    INTO v_intl_source_ids
    FROM (
        SELECT source_id, MIN(source_rank) AS first_rank
        FROM unnest(COALESCE(NEW.inventory_source_sku_ids_intl, ARRAY[]::UUID[])) WITH ORDINALITY AS source(source_id, source_rank)
        WHERE source_id IS NOT NULL
        GROUP BY source_id
    ) deduped;

    NEW.inventory_source_sku_ids := COALESCE(v_shared_source_ids, ARRAY[]::UUID[]);
    NEW.inventory_source_sku_ids_intl := COALESCE(v_intl_source_ids, ARRAY[]::UUID[]);
    SELECT source_id
    INTO NEW.inventory_sku_id
    FROM unnest(COALESCE(v_shared_source_ids, ARRAY[]::UUID[])) AS source(source_id)
    WHERE source_id IS NOT NULL
      AND source_id <> NEW.id
    LIMIT 1;

    FOREACH v_source_id IN ARRAY COALESCE(v_shared_source_ids, ARRAY[]::UUID[])
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

    FOREACH v_source_id IN ARRAY COALESCE(v_intl_source_ids, ARRAY[]::UUID[])
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
            FROM unnest(COALESCE(v_source.inventory_source_sku_ids_intl, ARRAY[]::UUID[])) WITH ORDINALITY AS source(source_id, source_rank)
            WHERE source_id IS NOT NULL
              AND source_id <> v_source.id
            GROUP BY source_id
        ) deduped;

        IF COALESCE(array_length(v_source_source_ids, 1), 0) > 0 THEN
            RAISE EXCEPTION 'shop_product_sku_inventory_source_invalid: source sku cannot be another shared-inventory alias';
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_shop_product_skus_validate_inventory_source ON public.shop_product_skus;
CREATE TRIGGER tr_shop_product_skus_validate_inventory_source
BEFORE INSERT OR UPDATE OF product_id, inventory_sku_id, inventory_source_sku_ids, inventory_source_sku_ids_intl ON public.shop_product_skus
FOR EACH ROW
EXECUTE FUNCTION public.fn_validate_shop_product_sku_inventory_source();

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
        v_sku_ids := ARRAY[NEW.id, NEW.inventory_sku_id]::UUID[]
            || COALESCE(NEW.inventory_source_sku_ids, ARRAY[]::UUID[])
            || COALESCE(NEW.inventory_source_sku_ids_intl, ARRAY[]::UUID[]);
    ELSE
        v_sku_ids := ARRAY[OLD.id, OLD.inventory_sku_id, NEW.id, NEW.inventory_sku_id]::UUID[]
            || COALESCE(OLD.inventory_source_sku_ids, ARRAY[]::UUID[])
            || COALESCE(NEW.inventory_source_sku_ids, ARRAY[]::UUID[])
            || COALESCE(OLD.inventory_source_sku_ids_intl, ARRAY[]::UUID[])
            || COALESCE(NEW.inventory_source_sku_ids_intl, ARRAY[]::UUID[]);
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
AFTER INSERT OR UPDATE OF product_id, inventory_sku_id, inventory_source_sku_ids, inventory_source_sku_ids_intl, is_default ON public.shop_product_skus
FOR EACH ROW
EXECUTE FUNCTION public.fn_trigger_sync_shop_product_sku_inventory_source_stock();

CREATE OR REPLACE FUNCTION public.fn_lock_shop_sku_inventory(
    p_product_id UUID,
    p_sku_id UUID,
    p_quantity INT,
    p_site TEXT
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
    v_site TEXT := CASE WHEN LOWER(BTRIM(COALESCE(p_site, 'cn'))) = 'intl' THEN 'intl' ELSE 'cn' END;
BEGIN
    IF p_product_id IS NULL OR p_sku_id IS NULL OR v_quantity <= 0 THEN
        RETURN;
    END IF;

    RETURN QUERY
    WITH source_rows AS MATERIALIZED (
        SELECT *
        FROM public.fn_resolve_shop_sku_inventory_sources(p_sku_id, v_site)
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
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT *
    FROM public.fn_lock_shop_sku_inventory(p_product_id, p_sku_id, p_quantity, 'cn');
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
        v_definition := REPLACE(
            v_definition,
            'FROM public.fn_resolve_shop_sku_inventory_sources(v_sku.id)',
            'FROM public.fn_resolve_shop_sku_inventory_sources(v_sku.id, v_site)'
        );
        v_definition := REPLACE(
            v_definition,
            'FROM public.fn_lock_shop_sku_inventory(p_product_id, v_sku_id, v_quantity);',
            'FROM public.fn_lock_shop_sku_inventory(p_product_id, v_sku_id, v_quantity, v_site);'
        );

        IF POSITION('fn_lock_shop_sku_inventory(p_product_id, v_sku_id, v_quantity, v_site)' IN v_definition) = 0 THEN
            RAISE EXCEPTION 'failed to patch fn_create_marketplace_shop_order with site-scoped SKU inventory sources';
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

    v_definition := REPLACE(
        v_definition,
        'FROM public.fn_resolve_shop_sku_inventory_sources(v_sku.id)',
        'FROM public.fn_resolve_shop_sku_inventory_sources(v_sku.id, v_site)'
    );
    v_definition := REPLACE(
        v_definition,
        'FROM public.fn_lock_shop_sku_inventory(p_product_id, v_sku_id, p_quantity);',
        'FROM public.fn_lock_shop_sku_inventory(p_product_id, v_sku_id, p_quantity, v_site);'
    );

    IF POSITION('fn_lock_shop_sku_inventory(p_product_id, v_sku_id, p_quantity, v_site)' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'failed to patch fn_purchase_shop_item_core with site-scoped SKU inventory sources';
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

REVOKE ALL ON FUNCTION public.fn_resolve_shop_sku_inventory_sources(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_resolve_shop_sku_inventory_sources(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.fn_resolve_shop_sku_inventory_sources(UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_resolve_shop_sku_inventory_sources(UUID, TEXT) TO service_role, authenticated;

REVOKE ALL ON FUNCTION public.fn_resolve_shop_sku_inventory_sources(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_resolve_shop_sku_inventory_sources(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.fn_resolve_shop_sku_inventory_sources(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_resolve_shop_sku_inventory_sources(UUID) TO service_role, authenticated;

REVOKE ALL ON FUNCTION public.fn_lock_shop_sku_inventory(UUID, UUID, INT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_lock_shop_sku_inventory(UUID, UUID, INT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.fn_lock_shop_sku_inventory(UUID, UUID, INT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_lock_shop_sku_inventory(UUID, UUID, INT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.fn_lock_shop_sku_inventory(UUID, UUID, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_lock_shop_sku_inventory(UUID, UUID, INT) FROM anon;
REVOKE ALL ON FUNCTION public.fn_lock_shop_sku_inventory(UUID, UUID, INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_lock_shop_sku_inventory(UUID, UUID, INT) TO service_role;
