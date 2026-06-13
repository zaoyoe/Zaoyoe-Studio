-- Allow the current SKU itself to be the first inventory source.
-- This represents "local stock first, then fallback stock" in inventory_source_sku_ids.

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
