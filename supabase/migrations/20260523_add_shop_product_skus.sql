-- Add shop product SKU inventory support.
-- Existing single-spec products keep working through an auto-created default SKU.

CREATE TABLE IF NOT EXISTS public.shop_product_skus (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.shop_products(id) ON DELETE CASCADE,
    sku_code TEXT,
    sku_name TEXT NOT NULL,
    spec_values JSONB NOT NULL DEFAULT '{}'::jsonb,
    price_points NUMERIC(12,2),
    price_points_intl NUMERIC(12,2),
    quantity_rules JSONB,
    quantity_rules_intl JSONB,
    is_default BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    stock_count INT NOT NULL DEFAULT 0,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_shop_product_skus_default
    ON public.shop_product_skus (product_id)
    WHERE is_default = true;

CREATE UNIQUE INDEX IF NOT EXISTS ux_shop_product_skus_product_code
    ON public.shop_product_skus (product_id, LOWER(BTRIM(sku_code)))
    WHERE sku_code IS NOT NULL AND BTRIM(sku_code) <> '';

CREATE INDEX IF NOT EXISTS idx_shop_product_skus_product_active_sort
    ON public.shop_product_skus (product_id, is_active, sort_order, created_at);

ALTER TABLE public.shop_product_skus
    ADD COLUMN IF NOT EXISTS quantity_rules JSONB,
    ADD COLUMN IF NOT EXISTS quantity_rules_intl JSONB;

ALTER TABLE public.shop_product_skus ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'shop_product_skus'
          AND policyname = 'Public read active shop product skus'
    ) THEN
        CREATE POLICY "Public read active shop product skus"
            ON public.shop_product_skus
            FOR SELECT
            USING (is_active = true);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'shop_product_skus'
          AND policyname = 'Admins manage shop product skus'
    ) THEN
        CREATE POLICY "Admins manage shop product skus"
            ON public.shop_product_skus
            FOR ALL
            USING (public.is_admin());
    END IF;
END;
$$;

ALTER TABLE public.shop_inventory
    ADD COLUMN IF NOT EXISTS sku_id UUID;

ALTER TABLE public.shop_orders
    ADD COLUMN IF NOT EXISTS sku_id UUID;

ALTER TABLE public.shop_order_items
    ADD COLUMN IF NOT EXISTS sku_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'shop_inventory'
          AND constraint_name = 'shop_inventory_sku_id_fkey'
    ) THEN
        ALTER TABLE public.shop_inventory
            ADD CONSTRAINT shop_inventory_sku_id_fkey
            FOREIGN KEY (sku_id)
            REFERENCES public.shop_product_skus(id)
            ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'shop_orders'
          AND constraint_name = 'shop_orders_sku_id_fkey'
    ) THEN
        ALTER TABLE public.shop_orders
            ADD CONSTRAINT shop_orders_sku_id_fkey
            FOREIGN KEY (sku_id)
            REFERENCES public.shop_product_skus(id)
            ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'shop_order_items'
          AND constraint_name = 'shop_order_items_sku_id_fkey'
    ) THEN
        ALTER TABLE public.shop_order_items
            ADD CONSTRAINT shop_order_items_sku_id_fkey
            FOREIGN KEY (sku_id)
            REFERENCES public.shop_product_skus(id)
            ON DELETE SET NULL;
    END IF;
END;
$$;

INSERT INTO public.shop_product_skus (
    product_id,
    sku_code,
    sku_name,
    spec_values,
    price_points,
    price_points_intl,
    quantity_rules,
    quantity_rules_intl,
    is_default,
    is_active,
    sort_order
)
SELECT
    p.id,
    'default',
    COALESCE(NULLIF(BTRIM(p.name), ''), 'Default'),
    jsonb_build_object('label', 'Default'),
    p.price_points,
    p.price_points_intl,
    p.quantity_rules,
    p.quantity_rules_intl,
    true,
    true,
    0
FROM public.shop_products p
WHERE NOT EXISTS (
    SELECT 1
    FROM public.shop_product_skus s
    WHERE s.product_id = p.id
      AND s.is_default = true
);

CREATE OR REPLACE FUNCTION public.fn_shop_products_ensure_default_sku()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.shop_product_skus (
        product_id,
        sku_code,
        sku_name,
        spec_values,
        price_points,
        price_points_intl,
        quantity_rules,
        quantity_rules_intl,
        is_default,
        is_active,
        sort_order
    )
    VALUES (
        NEW.id,
        'default',
        COALESCE(NULLIF(BTRIM(NEW.name), ''), '默认规格'),
        jsonb_build_object('label', '默认规格'),
        NEW.price_points,
        NEW.price_points_intl,
        NEW.quantity_rules,
        NEW.quantity_rules_intl,
        true,
        true,
        0
    )
    ON CONFLICT DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_shop_products_ensure_default_sku ON public.shop_products;
CREATE TRIGGER tr_shop_products_ensure_default_sku
AFTER INSERT ON public.shop_products
FOR EACH ROW
EXECUTE FUNCTION public.fn_shop_products_ensure_default_sku();

UPDATE public.shop_product_skus s
SET
    quantity_rules = COALESCE(s.quantity_rules, p.quantity_rules),
    quantity_rules_intl = COALESCE(s.quantity_rules_intl, p.quantity_rules_intl)
FROM public.shop_products p
WHERE s.product_id = p.id
  AND s.is_default = true;

UPDATE public.shop_inventory i
SET sku_id = s.id
FROM public.shop_product_skus s
WHERE i.product_id = s.product_id
  AND s.is_default = true
  AND i.sku_id IS NULL;

UPDATE public.shop_orders o
SET sku_id = s.id
FROM public.shop_product_skus s
WHERE o.product_id = s.product_id
  AND s.is_default = true
  AND o.sku_id IS NULL;

UPDATE public.shop_order_items oi
SET sku_id = resolved.sku_id
FROM (
    SELECT
        oi_inner.id AS order_item_id,
        COALESCE(i.sku_id, o.sku_id) AS sku_id
    FROM public.shop_order_items oi_inner
    JOIN public.shop_orders o ON o.id = oi_inner.order_id
    LEFT JOIN public.shop_inventory i ON i.id = oi_inner.inventory_id
    WHERE oi_inner.sku_id IS NULL
      AND COALESCE(i.sku_id, o.sku_id) IS NOT NULL
) resolved
WHERE oi.id = resolved.order_item_id;

CREATE INDEX IF NOT EXISTS idx_shop_inventory_product_sku_status
    ON public.shop_inventory (product_id, sku_id, status, id);

CREATE INDEX IF NOT EXISTS idx_shop_orders_product_sku_created
    ON public.shop_orders (product_id, sku_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shop_order_items_sku_order
    ON public.shop_order_items (sku_id, order_id);

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

    WITH affected AS (
        SELECT DISTINCT sku_id
        FROM unnest(p_sku_ids) AS ids(sku_id)
        WHERE sku_id IS NOT NULL
    ),
    real_counts AS (
        SELECT
            affected.sku_id,
            COUNT(i.id)::INTEGER AS available_count
        FROM affected
        LEFT JOIN public.shop_inventory i
          ON i.sku_id = affected.sku_id
         AND LOWER(BTRIM(COALESCE(i.status, ''))) = 'available'
        GROUP BY affected.sku_id
    )
    UPDATE public.shop_product_skus s
    SET stock_count = real_counts.available_count,
        updated_at = NOW()
    FROM real_counts
    WHERE s.id = real_counts.sku_id;
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
    v_sku_ids UUID[];
BEGIN
    SELECT array_agg(DISTINCT product_id)
    INTO v_product_ids
    FROM new_rows
    WHERE product_id IS NOT NULL;

    SELECT array_agg(DISTINCT sku_id)
    INTO v_sku_ids
    FROM new_rows
    WHERE sku_id IS NOT NULL;

    PERFORM public.fn_sync_shop_product_stock_counts(v_product_ids);
    PERFORM public.fn_sync_shop_product_sku_stock_counts(v_sku_ids);
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
    v_sku_ids UUID[];
BEGIN
    SELECT array_agg(DISTINCT product_id)
    INTO v_product_ids
    FROM (
        SELECT product_id FROM old_rows WHERE product_id IS NOT NULL
        UNION
        SELECT product_id FROM new_rows WHERE product_id IS NOT NULL
    ) affected_products;

    SELECT array_agg(DISTINCT sku_id)
    INTO v_sku_ids
    FROM (
        SELECT sku_id FROM old_rows WHERE sku_id IS NOT NULL
        UNION
        SELECT sku_id FROM new_rows WHERE sku_id IS NOT NULL
    ) affected_skus;

    PERFORM public.fn_sync_shop_product_stock_counts(v_product_ids);
    PERFORM public.fn_sync_shop_product_sku_stock_counts(v_sku_ids);
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
    v_sku_ids UUID[];
BEGIN
    SELECT array_agg(DISTINCT product_id)
    INTO v_product_ids
    FROM old_rows
    WHERE product_id IS NOT NULL;

    SELECT array_agg(DISTINCT sku_id)
    INTO v_sku_ids
    FROM old_rows
    WHERE sku_id IS NOT NULL;

    PERFORM public.fn_sync_shop_product_stock_counts(v_product_ids);
    PERFORM public.fn_sync_shop_product_sku_stock_counts(v_sku_ids);
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

DROP FUNCTION IF EXISTS public.fn_admin_list_inventory(
    UUID, VARCHAR, VARCHAR, INT, INT, TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE
);
DROP FUNCTION IF EXISTS public.fn_admin_list_inventory(
    UUID, VARCHAR, VARCHAR, INT, INT, TIMESTAMP WITH TIME ZONE, TIMESTAMP WITH TIME ZONE, UUID
);

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
            AND (p_sku_id IS NULL OR i.sku_id = p_sku_id)
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
      AND (p_sku_id IS NULL OR sku_id = p_sku_id);

    RETURN jsonb_build_object(
        'success', true,
        'items', COALESCE(v_items, '[]'::JSONB),
        'total', COALESCE(v_total, 0),
        'stats', COALESCE(v_stats, '{}'::JSONB)
    );
END;
$$;

DROP FUNCTION IF EXISTS public.fn_create_marketplace_shop_order(
    UUID, INT, TEXT, TEXT, TEXT, JSONB, VARCHAR, UUID, NUMERIC, NUMERIC, TEXT, TEXT
);
DROP FUNCTION IF EXISTS public.fn_create_marketplace_shop_order(
    UUID, INT, TEXT, TEXT, TEXT, JSONB, VARCHAR, UUID, NUMERIC, NUMERIC, TEXT, TEXT, UUID
);

CREATE OR REPLACE FUNCTION public.fn_create_marketplace_shop_order(
    p_product_id UUID,
    p_quantity INT DEFAULT 1,
    p_source_channel TEXT DEFAULT 'xianyu',
    p_channel_account_key TEXT DEFAULT 'main',
    p_external_order_id TEXT DEFAULT NULL,
    p_external_order_snapshot JSONB DEFAULT '{}'::jsonb,
    p_site VARCHAR DEFAULT 'cn',
    p_user_id UUID DEFAULT NULL,
    p_price_paid NUMERIC DEFAULT NULL,
    p_total_price NUMERIC DEFAULT NULL,
    p_external_buyer_id TEXT DEFAULT NULL,
    p_external_buyer_name TEXT DEFAULT NULL,
    p_sku_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_source_channel TEXT := LOWER(BTRIM(COALESCE(p_source_channel, 'xianyu')));
    v_channel_account_key TEXT := LOWER(BTRIM(COALESCE(p_channel_account_key, 'main')));
    v_external_order_id TEXT := LEFT(BTRIM(COALESCE(p_external_order_id, '')), 180);
    v_site VARCHAR := LOWER(BTRIM(COALESCE(p_site, 'cn')));
    v_quantity INT := COALESCE(p_quantity, 1);
    v_product RECORD;
    v_sku RECORD;
    v_sku_id UUID := p_sku_id;
    v_sku_is_default BOOLEAN := false;
    v_delivery_type TEXT;
    v_inventory_ids UUID[];
    v_contents TEXT[];
    v_inventory_primary_id UUID := NULL;
    v_order_id UUID;
    v_task_id UUID := NULL;
    v_unit_price NUMERIC(12,2) := 0;
    v_price_paid NUMERIC(12,2) := 0;
    v_total_price NUMERIC(12,2) := 0;
    v_snapshot JSONB := '{}'::jsonb;
    v_existing_order public.shop_orders%ROWTYPE;
    v_existing_items JSONB := '[]'::jsonb;
    v_existing_content TEXT := '';
BEGIN
    IF p_product_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'product_id is required');
    END IF;

    IF v_quantity < 1 OR v_quantity > 99 THEN
        RETURN jsonb_build_object('success', false, 'message', 'quantity must be between 1 and 99');
    END IF;

    IF v_site NOT IN ('cn', 'intl') THEN
        v_site := 'cn';
    END IF;

    IF v_source_channel !~ '^[a-z0-9_-]{1,80}$' THEN
        RETURN jsonb_build_object('success', false, 'message', 'source_channel is invalid');
    END IF;

    IF v_channel_account_key !~ '^[a-z0-9_-]{1,80}$' THEN
        RETURN jsonb_build_object('success', false, 'message', 'channel_account_key is invalid');
    END IF;

    IF v_external_order_id = '' THEN
        RETURN jsonb_build_object('success', false, 'message', 'external_order_id is required');
    END IF;

    PERFORM pg_advisory_xact_lock(
        hashtext(v_source_channel || ':' || v_channel_account_key),
        hashtext(v_external_order_id)
    );

    SELECT *
    INTO v_existing_order
    FROM public.shop_orders
    WHERE source_channel = v_source_channel
      AND channel_account_key = v_channel_account_key
      AND external_order_id = v_external_order_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF FOUND THEN
        SELECT
            COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'inventory_id', soi.inventory_id,
                        'sku_id', COALESCE(soi.sku_id, i.sku_id, v_existing_order.sku_id),
                        'content', i.content,
                        'snapshot_product_name', soi.snapshot_product_name,
                        'price_paid', soi.price_paid
                    )
                    ORDER BY soi.created_at ASC, soi.id ASC
                ) FILTER (WHERE soi.id IS NOT NULL),
                '[]'::jsonb
            ),
            COALESCE(string_agg(COALESCE(i.content, ''), E'\n----\n' ORDER BY soi.created_at ASC, soi.id ASC), '')
        INTO v_existing_items, v_existing_content
        FROM public.shop_order_items soi
        LEFT JOIN public.shop_inventory i ON i.id = soi.inventory_id
        WHERE soi.order_id = v_existing_order.id;

        RETURN jsonb_build_object(
            'success', true,
            'duplicate', true,
            'message', 'marketplace order already exists',
            'data', jsonb_build_object(
                'order_id', v_existing_order.id,
                'product_id', v_existing_order.product_id,
                'sku_id', v_existing_order.sku_id,
                'product_name', v_existing_order.snapshot_product_name,
                'source_channel', v_existing_order.source_channel,
                'channel_account_key', v_existing_order.channel_account_key,
                'external_order_id', v_existing_order.external_order_id,
                'delivery_status', v_existing_order.delivery_status,
                'delivery_task_id', v_existing_order.delivery_task_id,
                'quantity', v_existing_order.item_count,
                'price_paid', v_existing_order.price_paid,
                'total_price', v_existing_order.total_price,
                'site', v_existing_order.site,
                'content', v_existing_content,
                'items', COALESCE(v_existing_items, '[]'::jsonb)
            )
        );
    END IF;

    SELECT
        id,
        name,
        price_points,
        price_points_intl,
        delivery_type,
        webhook_target,
        is_active
    INTO v_product
    FROM public.shop_products
    WHERE id = p_product_id
      AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'product not found or inactive');
    END IF;

    IF v_sku_id IS NULL THEN
        SELECT *
        INTO v_sku
        FROM public.shop_product_skus
        WHERE product_id = p_product_id
          AND is_default = true
        ORDER BY sort_order ASC, created_at ASC
        LIMIT 1;
    ELSE
        SELECT *
        INTO v_sku
        FROM public.shop_product_skus
        WHERE id = v_sku_id
          AND product_id = p_product_id
        LIMIT 1;
    END IF;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'product sku not found');
    END IF;

    IF v_sku.is_active IS NOT TRUE THEN
        RETURN jsonb_build_object('success', false, 'message', 'product sku is inactive');
    END IF;

    v_sku_id := v_sku.id;
    v_sku_is_default := COALESCE(v_sku.is_default, false);

    v_delivery_type := UPPER(BTRIM(COALESCE(v_product.delivery_type, 'KEY')));
    v_unit_price := CASE
        WHEN v_site = 'intl' THEN v_sku.price_points_intl
        ELSE v_sku.price_points
    END;

    IF v_unit_price IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'product sku is not sold on current site');
    END IF;

    v_price_paid := ROUND(COALESCE(p_price_paid, v_unit_price * v_quantity, 0), 2);
    v_total_price := ROUND(COALESCE(p_total_price, v_price_paid, 0), 2);

    v_snapshot := CASE
        WHEN jsonb_typeof(COALESCE(p_external_order_snapshot, '{}'::jsonb)) = 'object' THEN COALESCE(p_external_order_snapshot, '{}'::jsonb)
        ELSE jsonb_build_object('raw', p_external_order_snapshot)
    END;
    v_snapshot := v_snapshot || jsonb_strip_nulls(jsonb_build_object(
        'source_channel', v_source_channel,
        'channel_account_key', v_channel_account_key,
        'external_order_id', v_external_order_id,
        'external_buyer_id', NULLIF(BTRIM(COALESCE(p_external_buyer_id, '')), ''),
        'external_buyer_name', NULLIF(BTRIM(COALESCE(p_external_buyer_name, '')), ''),
        'product_sku_id', v_sku_id,
        'product_sku_name', v_sku.sku_name,
        'ingested_at', v_now
    ));

    IF v_delivery_type = 'KEY' THEN
        WITH locked_inventory AS (
            SELECT id, content, created_at
            FROM public.shop_inventory
            WHERE product_id = p_product_id
              AND status = 'available'
              AND (
                  sku_id = v_sku_id
                  OR (v_sku_is_default AND sku_id IS NULL)
              )
            ORDER BY created_at ASC, id ASC
            LIMIT v_quantity
            FOR UPDATE SKIP LOCKED
        )
        SELECT array_agg(id ORDER BY created_at ASC, id ASC), array_agg(content ORDER BY created_at ASC, id ASC)
        INTO v_inventory_ids, v_contents
        FROM locked_inventory;

        IF v_inventory_ids IS NULL OR array_length(v_inventory_ids, 1) < v_quantity THEN
            RETURN jsonb_build_object('success', false, 'message', 'shared sku inventory is insufficient');
        END IF;

        IF array_length(v_inventory_ids, 1) = 1 THEN
            v_inventory_primary_id := v_inventory_ids[1];
        END IF;
    ELSIF v_delivery_type = 'API' THEN
        IF COALESCE(BTRIM(v_product.webhook_target), '') = '' THEN
            RETURN jsonb_build_object('success', false, 'message', 'API product webhook target is not configured');
        END IF;
        v_contents := ARRAY['API delivery task queued'];
    ELSE
        RETURN jsonb_build_object('success', false, 'message', 'unsupported delivery_type: ' || v_delivery_type);
    END IF;

    INSERT INTO public.shop_orders (
        user_id,
        product_id,
        sku_id,
        inventory_id,
        price_paid,
        total_price,
        item_count,
        snapshot_product_name,
        discount_code,
        discount_amount,
        discount_snapshot,
        discount_version,
        discount_usage_restored,
        discount_refund_amount,
        delivery_status,
        delivery_completed_at,
        delivery_updated_at,
        delivery_attempt_count,
        site,
        source_channel,
        channel_account_key,
        external_order_id,
        external_order_snapshot
    )
    VALUES (
        p_user_id,
        p_product_id,
        v_sku_id,
        CASE WHEN v_delivery_type = 'KEY' THEN v_inventory_primary_id ELSE NULL END,
        v_price_paid,
        v_total_price,
        v_quantity,
        v_product.name,
        NULL,
        0,
        NULL,
        NULL,
        false,
        0,
        CASE WHEN v_delivery_type = 'API' THEN 'pending' ELSE 'delivered' END,
        CASE WHEN v_delivery_type = 'API' THEN NULL ELSE v_now END,
        v_now,
        0,
        v_site,
        v_source_channel,
        v_channel_account_key,
        v_external_order_id,
        v_snapshot
    )
    RETURNING id INTO v_order_id;

    IF v_delivery_type = 'KEY' THEN
        UPDATE public.shop_inventory
        SET status = 'sold',
            sku_id = COALESCE(sku_id, v_sku_id),
            buyer_id = p_user_id,
            sold_at = v_now
        WHERE id = ANY(v_inventory_ids);

        INSERT INTO public.shop_order_items (order_id, inventory_id, sku_id, snapshot_product_name, price_paid)
        SELECT v_order_id, unnest(v_inventory_ids), v_sku_id, v_product.name, ROUND(v_price_paid / v_quantity, 2);
    ELSE
        INSERT INTO public.shop_webhook_tasks (
            order_id,
            target_url,
            payload,
            status,
            attempt_count,
            max_attempts,
            next_attempt_at,
            dedupe_key
        )
        VALUES (
            v_order_id,
            v_product.webhook_target,
            jsonb_build_object(
                'order_id', v_order_id,
                'product_id', p_product_id,
                'sku_id', v_sku_id,
                'sku_name', v_sku.sku_name,
                'quantity', v_quantity,
                'site', v_site,
                'source_channel', v_source_channel,
                'channel_account_key', v_channel_account_key,
                'external_order_id', v_external_order_id,
                'external_order_snapshot', v_snapshot,
                'marketplace', jsonb_build_object(
                    'source_channel', v_source_channel,
                    'channel_account_key', v_channel_account_key,
                    'external_order_id', v_external_order_id,
                    'external_buyer_id', NULLIF(BTRIM(COALESCE(p_external_buyer_id, '')), ''),
                    'external_buyer_name', NULLIF(BTRIM(COALESCE(p_external_buyer_name, '')), '')
                )
            ),
            'pending',
            0,
            5,
            v_now,
            'marketplace_delivery:' || v_source_channel || ':' || v_channel_account_key || ':' || v_external_order_id
        )
        RETURNING id INTO v_task_id;

        INSERT INTO public.shop_order_items (order_id, inventory_id, sku_id, snapshot_product_name, price_paid)
        VALUES (v_order_id, NULL, v_sku_id, v_product.name || ' [API]', v_price_paid);

        UPDATE public.shop_orders
        SET delivery_task_id = v_task_id
        WHERE id = v_order_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'duplicate', false,
        'message', 'marketplace order created',
        'data', jsonb_build_object(
            'order_id', v_order_id,
            'product_id', p_product_id,
            'sku_id', v_sku_id,
            'sku_name', v_sku.sku_name,
            'product_name', v_product.name,
            'source_channel', v_source_channel,
            'channel_account_key', v_channel_account_key,
            'external_order_id', v_external_order_id,
            'delivery_status', CASE WHEN v_delivery_type = 'API' THEN 'pending' ELSE 'delivered' END,
            'delivery_task_id', v_task_id,
            'quantity', v_quantity,
            'price_paid', v_price_paid,
            'total_price', v_total_price,
            'site', v_site,
            'content', array_to_string(v_contents, E'\n----\n'),
            'items', CASE
                WHEN v_delivery_type = 'KEY' THEN (
                    SELECT COALESCE(
                        jsonb_agg(
                            jsonb_build_object(
                                'inventory_id', inventory_id,
                                'sku_id', v_sku_id,
                                'content', content
                            )
                            ORDER BY item_index
                        ),
                        '[]'::jsonb
                    )
                    FROM unnest(v_inventory_ids, v_contents) WITH ORDINALITY AS item(inventory_id, content, item_index)
                )
                ELSE '[]'::jsonb
            END,
            'external_order_snapshot', v_snapshot
        )
    );
EXCEPTION
    WHEN unique_violation THEN
        SELECT *
        INTO v_existing_order
        FROM public.shop_orders
        WHERE source_channel = v_source_channel
          AND channel_account_key = v_channel_account_key
          AND external_order_id = v_external_order_id
        ORDER BY created_at DESC
        LIMIT 1;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'success', true,
                'duplicate', true,
                'message', 'marketplace order already exists',
                'data', jsonb_build_object(
                    'order_id', v_existing_order.id,
                    'product_id', v_existing_order.product_id,
                    'sku_id', v_existing_order.sku_id,
                    'product_name', v_existing_order.snapshot_product_name,
                    'source_channel', v_existing_order.source_channel,
                    'channel_account_key', v_existing_order.channel_account_key,
                    'external_order_id', v_existing_order.external_order_id,
                    'delivery_status', v_existing_order.delivery_status,
                    'delivery_task_id', v_existing_order.delivery_task_id,
                    'quantity', v_existing_order.item_count,
                    'price_paid', v_existing_order.price_paid,
                    'total_price', v_existing_order.total_price,
                    'site', v_existing_order.site,
                    'content', '',
                    'items', '[]'::jsonb
                )
            );
        END IF;

        RETURN jsonb_build_object('success', false, 'message', 'marketplace order duplicate conflict');
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'message', 'marketplace order create failed: ' || SQLERRM);
END;
$$;

SELECT public.fn_sync_shop_product_stock_counts(
    ARRAY(
        SELECT id
        FROM public.shop_products
    )
);

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

REVOKE ALL ON FUNCTION public.fn_create_marketplace_shop_order(
    UUID, INT, TEXT, TEXT, TEXT, JSONB, VARCHAR, UUID, NUMERIC, NUMERIC, TEXT, TEXT, UUID
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_create_marketplace_shop_order(
    UUID, INT, TEXT, TEXT, TEXT, JSONB, VARCHAR, UUID, NUMERIC, NUMERIC, TEXT, TEXT, UUID
) FROM anon;
REVOKE ALL ON FUNCTION public.fn_create_marketplace_shop_order(
    UUID, INT, TEXT, TEXT, TEXT, JSONB, VARCHAR, UUID, NUMERIC, NUMERIC, TEXT, TEXT, UUID
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_marketplace_shop_order(
    UUID, INT, TEXT, TEXT, TEXT, JSONB, VARCHAR, UUID, NUMERIC, NUMERIC, TEXT, TEXT, UUID
) TO service_role;


-- Discount preview needs the same SKU price basis as the final purchase.
CREATE OR REPLACE FUNCTION public.fn_validate_discount_code_core(
    p_product_id UUID,
    p_user_id UUID DEFAULT NULL,
    p_site VARCHAR DEFAULT 'cn',
    p_quantity INT DEFAULT 1,
    p_discount_code VARCHAR DEFAULT NULL,
    p_agent_id UUID DEFAULT NULL,
    p_sku_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_request_user_id UUID := auth.uid();
    v_request_role TEXT := COALESCE(auth.role(), '');
    v_effective_user_id UUID;
    v_site VARCHAR := LOWER(BTRIM(COALESCE(p_site, 'cn')));
    v_max_quantity INT := 99;
    v_product_max_quantity INT := 99;
    v_unlimited_shop_purchases BOOLEAN := FALSE;

    v_product RECORD;
    v_sku RECORD;
    v_sku_id UUID := p_sku_id;
    v_sku_is_default BOOLEAN := false;
    v_base_unit_price NUMERIC(12,2);
    v_actual_unit_price NUMERIC(12,2);
    v_subtotal NUMERIC(12,2);
    v_final_total NUMERIC(12,2);

    v_discount_record RECORD;
    v_discount_amount NUMERIC(12,2) := 0;
    v_discount_code VARCHAR := NULL;
    v_user_discount_use_count INT := 0;
    v_effective_lifecycle_status VARCHAR(32);
    v_has_effective_discount BOOLEAN := FALSE;

    v_rule JSONB;
    v_rule_qty INT;
    v_rule_price NUMERIC(12,2);
    v_effective_quantity_rules JSONB := NULL;
    v_effective_flash_sale_end TIMESTAMPTZ := NULL;
    v_effective_flash_sale_price NUMERIC(12,2) := NULL;

    v_agent_price NUMERIC(12,2) := NULL;
    v_user_product_total_quantity INT := 0;
    v_user_product_24h_quantity INT := 0;
    v_user_product_window_quantity INT := 0;
    v_remaining_quantity INT := 0;
BEGIN
    IF v_request_role = 'service_role' THEN
        v_effective_user_id := COALESCE(p_user_id, v_request_user_id);
    ELSE
        IF v_request_user_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'message', '请先登录');
        END IF;

        IF p_user_id IS NOT NULL AND p_user_id <> v_request_user_id THEN
            RETURN jsonb_build_object('success', false, 'message', '非法的用户上下文');
        END IF;

        v_effective_user_id := v_request_user_id;
    END IF;

    IF v_effective_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '缺少有效的用户身份');
    END IF;

    IF v_site NOT IN ('cn', 'intl') THEN
        RETURN jsonb_build_object('success', false, 'message', '站点参数无效');
    END IF;

    IF p_quantity < 1 THEN
        RETURN jsonb_build_object('success', false, 'message', '购买数量必须大于0');
    END IF;

    SELECT COALESCE(unlimited_shop_purchases, false)
    INTO v_unlimited_shop_purchases
    FROM public.user_purchase_entitlements
    WHERE user_id = v_effective_user_id;

    v_unlimited_shop_purchases := COALESCE(v_unlimited_shop_purchases, false);

    IF NOT v_unlimited_shop_purchases AND p_quantity > v_max_quantity THEN
        RETURN jsonb_build_object('success', false, 'message', '单次购买数量不能超过' || v_max_quantity);
    END IF;

    v_discount_code := NULLIF(UPPER(BTRIM(COALESCE(p_discount_code, ''))), '');
    IF v_discount_code IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '请输入优惠码');
    END IF;

    SELECT
        id,
        name,
        category,
        price_points,
        price_points_intl,
        quantity_rules,
        quantity_rules_intl,
        flash_sale_end,
        flash_sale_end_intl,
        flash_sale_price,
        flash_sale_price_intl,
        max_purchase_quantity,
        purchase_limit_24h_quantity,
        purchase_limit_window_minutes,
        purchase_limit_window_quantity,
        per_account_purchase_limit
    INTO v_product
    FROM public.shop_products
    WHERE id = p_product_id
      AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', '商品不存在或已下架');
    END IF;

    IF p_sku_id IS NOT NULL THEN
        SELECT *
        INTO v_sku
        FROM public.shop_product_skus
        WHERE id = p_sku_id
          AND product_id = p_product_id
        LIMIT 1;
    ELSE
        SELECT *
        INTO v_sku
        FROM public.shop_product_skus
        WHERE product_id = p_product_id
          AND is_default = true
        ORDER BY sort_order ASC, created_at ASC
        LIMIT 1;
    END IF;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', CASE
                WHEN p_sku_id IS NOT NULL THEN '所选商品规格不存在或不属于该商品'
                ELSE '商品默认规格不存在，请先在后台补全 SKU'
            END
        );
    END IF;

    IF v_sku.is_active IS NOT TRUE THEN
        RETURN jsonb_build_object('success', false, 'message', '所选商品规格已停用');
    END IF;

    v_sku_id := v_sku.id;
    v_sku_is_default := COALESCE(v_sku.is_default, false);

    IF NOT v_unlimited_shop_purchases THEN
        v_product_max_quantity := LEAST(
            v_max_quantity,
            GREATEST(1, COALESCE(v_product.max_purchase_quantity, v_max_quantity))
        );

        IF p_quantity > v_product_max_quantity THEN
            RETURN jsonb_build_object('success', false, 'message', '当前商品单次最多购买' || v_product_max_quantity || '件');
        END IF;

        IF v_product.per_account_purchase_limit IS NOT NULL THEN
            SELECT COALESCE(SUM(COALESCE(item_count, 0)), 0)::INT
            INTO v_user_product_total_quantity
            FROM public.shop_orders
            WHERE user_id = v_effective_user_id
              AND product_id = p_product_id
              AND COALESCE(refund_status, 'none') NOT IN ('refunded', 'full_refund');

            v_remaining_quantity := GREATEST(0, v_product.per_account_purchase_limit - v_user_product_total_quantity);
            IF v_remaining_quantity < p_quantity THEN
                IF v_remaining_quantity = 0 THEN
                    RETURN jsonb_build_object('success', false, 'message', '当前账号已达到该商品的累计限购上限');
                END IF;

                RETURN jsonb_build_object('success', false, 'message', '当前账号最多还可购买' || v_remaining_quantity || '件');
            END IF;
        END IF;

        IF v_product.purchase_limit_24h_quantity IS NOT NULL THEN
            SELECT COALESCE(SUM(COALESCE(item_count, 0)), 0)::INT
            INTO v_user_product_24h_quantity
            FROM public.shop_orders
            WHERE user_id = v_effective_user_id
              AND product_id = p_product_id
              AND created_at >= NOW() - INTERVAL '24 hours'
              AND COALESCE(refund_status, 'none') NOT IN ('refunded', 'full_refund');

            v_remaining_quantity := GREATEST(0, v_product.purchase_limit_24h_quantity - v_user_product_24h_quantity);
            IF v_remaining_quantity < p_quantity THEN
                IF v_remaining_quantity = 0 THEN
                    RETURN jsonb_build_object('success', false, 'message', '当前账号在24小时内已达到该商品的购买上限');
                END IF;

                RETURN jsonb_build_object('success', false, 'message', '当前账号在24小时内最多还可购买' || v_remaining_quantity || '件');
            END IF;
        END IF;

        IF v_product.purchase_limit_window_minutes IS NOT NULL
            AND v_product.purchase_limit_window_quantity IS NOT NULL THEN
            SELECT COALESCE(SUM(COALESCE(item_count, 0)), 0)::INT
            INTO v_user_product_window_quantity
            FROM public.shop_orders
            WHERE user_id = v_effective_user_id
              AND product_id = p_product_id
              AND created_at >= NOW() - make_interval(mins => v_product.purchase_limit_window_minutes)
              AND COALESCE(refund_status, 'none') NOT IN ('refunded', 'full_refund');

            v_remaining_quantity := GREATEST(0, v_product.purchase_limit_window_quantity - v_user_product_window_quantity);
            IF v_remaining_quantity < p_quantity THEN
                IF v_remaining_quantity = 0 THEN
                    RETURN jsonb_build_object(
                        'success', false,
                        'message', '当前账号在最近' || v_product.purchase_limit_window_minutes || '分钟内已达到该商品的购买上限'
                    );
                END IF;

                RETURN jsonb_build_object(
                    'success', false,
                    'message', '当前账号在最近' || v_product.purchase_limit_window_minutes || '分钟内最多还可购买' || v_remaining_quantity || '件'
                );
            END IF;
        END IF;
    END IF;

    IF v_site = 'intl' THEN
        v_base_unit_price := v_sku.price_points_intl;
        v_effective_quantity_rules := COALESCE(
            v_sku.quantity_rules_intl,
            CASE
                WHEN v_sku_is_default THEN v_product.quantity_rules_intl
                ELSE NULL
            END
        );
        v_effective_flash_sale_end := v_product.flash_sale_end_intl;
        v_effective_flash_sale_price := v_product.flash_sale_price_intl;
    ELSE
        v_base_unit_price := v_sku.price_points;
        v_effective_quantity_rules := COALESCE(
            v_sku.quantity_rules,
            CASE
                WHEN v_sku_is_default THEN v_product.quantity_rules
                ELSE NULL
            END
        );
        v_effective_flash_sale_end := v_product.flash_sale_end;
        v_effective_flash_sale_price := v_product.flash_sale_price;
    END IF;

    IF v_base_unit_price IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '商品未在当前站点销售');
    END IF;

    IF v_effective_flash_sale_end IS NOT NULL
        AND v_effective_flash_sale_end > NOW()
        AND v_effective_flash_sale_price IS NOT NULL THEN
        v_base_unit_price := LEAST(v_base_unit_price, v_effective_flash_sale_price);
    ELSIF v_effective_quantity_rules IS NOT NULL AND jsonb_array_length(v_effective_quantity_rules) > 0 THEN
        FOR v_rule IN SELECT * FROM jsonb_array_elements(v_effective_quantity_rules)
        LOOP
            v_rule_qty := (v_rule->>'qty')::INT;
            v_rule_price := COALESCE(NULLIF(BTRIM(COALESCE(v_rule->>'price', '')), ''), '0')::NUMERIC(12,2);
            IF p_quantity >= v_rule_qty AND v_rule_price < v_base_unit_price THEN
                v_base_unit_price := v_rule_price;
            END IF;
        END LOOP;
    END IF;

    v_actual_unit_price := v_base_unit_price;

    IF p_agent_id IS NOT NULL THEN
        SELECT custom_price
        INTO v_agent_price
        FROM public.agent_prices
        WHERE agent_id = p_agent_id
          AND product_id = p_product_id
          AND COALESCE(NULLIF(BTRIM(LOWER(site)), ''), 'cn') = v_site;

        IF v_agent_price IS NOT NULL AND v_agent_price > v_base_unit_price THEN
            v_actual_unit_price := v_agent_price;
        END IF;
    END IF;

    v_subtotal := ROUND(v_actual_unit_price * p_quantity, 2);

    SELECT *
    INTO v_discount_record
    FROM public.discount_codes
    WHERE code = v_discount_code;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', '无效的优惠码');
    END IF;

    v_effective_lifecycle_status := COALESCE(
        NULLIF(BTRIM(COALESCE(v_discount_record.lifecycle_status, '')), ''),
        CASE WHEN COALESCE(v_discount_record.is_active, true) THEN 'active' ELSE 'paused_manual' END
    );

    IF v_effective_lifecycle_status = 'archived' THEN
        RETURN jsonb_build_object('success', false, 'message', '该优惠码已归档');
    END IF;

    IF v_discount_record.starts_at IS NOT NULL AND v_discount_record.starts_at > NOW() THEN
        RETURN jsonb_build_object('success', false, 'message', '该优惠码尚未生效');
    END IF;

    IF v_discount_record.expires_at IS NOT NULL AND v_discount_record.expires_at < NOW() THEN
        RETURN jsonb_build_object('success', false, 'message', '该优惠码已过期');
    END IF;

    IF COALESCE(v_discount_record.is_active, true) = false OR v_effective_lifecycle_status IN ('paused_manual', 'paused_risk') THEN
        IF v_effective_lifecycle_status = 'paused_risk' OR COALESCE(v_discount_record.status_reason, '') LIKE 'risk_%' THEN
            RETURN jsonb_build_object('success', false, 'message', '该优惠码当前因风控暂停使用');
        END IF;

        RETURN jsonb_build_object('success', false, 'message', '该优惠码当前已停用');
    END IF;

    IF v_discount_record.max_uses > 0 AND v_discount_record.used_count >= v_discount_record.max_uses THEN
        RETURN jsonb_build_object('success', false, 'message', '该优惠码的使用次数已达上限');
    END IF;

    IF v_discount_record.applicable_site IS NOT NULL
        AND v_discount_record.applicable_site <> v_site THEN
        RETURN jsonb_build_object('success', false, 'message', '该优惠码仅适用于指定站点');
    END IF;

    IF COALESCE(v_discount_record.scope_type, 'all') = 'category'
        AND COALESCE(v_product.category, '') <> COALESCE(v_discount_record.scope_category, '') THEN
        RETURN jsonb_build_object('success', false, 'message', '该优惠码仅适用于指定分类商品');
    END IF;

    IF COALESCE(v_discount_record.scope_type, 'all') = 'product'
        AND v_discount_record.scope_product_id IS DISTINCT FROM p_product_id THEN
        RETURN jsonb_build_object('success', false, 'message', '该优惠码仅适用于指定商品');
    END IF;

    IF COALESCE(v_discount_record.max_uses_per_user, 0) > 0 THEN
        SELECT COUNT(*)::INT
        INTO v_user_discount_use_count
        FROM public.shop_orders
        WHERE user_id = v_effective_user_id
          AND discount_code = v_discount_code
          AND COALESCE(refund_status, 'none') NOT IN ('refunded', 'full_refund');

        IF v_user_discount_use_count >= v_discount_record.max_uses_per_user THEN
            RETURN jsonb_build_object('success', false, 'message', '当前账号已达到该优惠码的使用上限');
        END IF;
    END IF;

    IF v_discount_record.discount_type = 'percent' THEN
        SELECT
            resolved.discount_amount,
            resolved.final_total,
            resolved.has_effective_discount
        INTO
            v_discount_amount,
            v_final_total,
            v_has_effective_discount
        FROM public.fn_resolve_shop_percent_discount(
            v_subtotal,
            v_discount_record.discount_value,
            COALESCE(v_discount_record.allow_zero_total, false)
        ) AS resolved;

        IF NOT v_has_effective_discount THEN
            RETURN jsonb_build_object('success', false, 'message', '当前商品暂无可优惠金额，无法使用这张优惠码');
        END IF;
    ELSIF v_discount_record.discount_type = 'fixed' THEN
        v_discount_amount := LEAST(v_subtotal, v_discount_record.discount_value::NUMERIC(12,2));
        v_final_total := ROUND(GREATEST(0, v_subtotal - v_discount_amount), 2);
        v_has_effective_discount := v_discount_amount > 0;
    ELSE
        v_final_total := v_subtotal;
        v_has_effective_discount := false;
    END IF;

    IF v_discount_amount > 0
        AND v_final_total = 0
        AND NOT COALESCE(v_discount_record.allow_zero_total, false) THEN
        RETURN jsonb_build_object('success', false, 'message', '该优惠码不允许全额抵扣');
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'message', '优惠码可用',
        'data', jsonb_build_object(
            'discount_code', v_discount_code,
            'discount_type', v_discount_record.discount_type,
            'discount_value', v_discount_record.discount_value,
            'discount_version', COALESCE(v_discount_record.version_no, 1),
            'unit_price', v_actual_unit_price,
            'subtotal', v_subtotal,
            'discount_amount', v_discount_amount,
            'final_total', v_final_total,
            'sku_id', v_sku_id,
            'sku_name', v_sku.sku_name,
            'site', v_site,
            'applicable_site', v_discount_record.applicable_site,
            'scope_type', v_discount_record.scope_type,
            'scope_category', v_discount_record.scope_category,
            'scope_product_id', v_discount_record.scope_product_id,
            'max_uses_per_user', v_discount_record.max_uses_per_user,
            'starts_at', v_discount_record.starts_at,
            'expires_at', v_discount_record.expires_at,
            'lifecycle_status', v_effective_lifecycle_status,
            'status_reason', v_discount_record.status_reason,
            'recovery_strategy', COALESCE(v_discount_record.recovery_strategy, 'manual_only'),
            'observation_ends_at', v_discount_record.observation_ends_at
        )
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', '优惠码校验失败: ' || SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_validate_discount_code(
    p_product_id UUID,
    p_user_id UUID DEFAULT NULL,
    p_site VARCHAR DEFAULT 'cn',
    p_quantity INT DEFAULT 1,
    p_discount_code VARCHAR DEFAULT NULL,
    p_agent_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_setting_sku_id UUID := NULLIF(current_setting('app.shop_product_sku_id', true), '')::UUID;
BEGIN
    RETURN public.fn_validate_discount_code_core(
        p_product_id,
        p_user_id,
        p_site,
        p_quantity,
        p_discount_code,
        p_agent_id,
        v_setting_sku_id
    );
END;
$$;

DROP FUNCTION IF EXISTS public.fn_validate_discount_code(UUID, UUID, VARCHAR, INT, VARCHAR, UUID, UUID, UUID);

CREATE OR REPLACE FUNCTION public.fn_validate_discount_code(
    p_product_id UUID,
    p_user_id UUID,
    p_site VARCHAR,
    p_quantity INT,
    p_discount_code VARCHAR,
    p_discount_asset_id UUID,
    p_agent_id UUID,
    p_sku_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM set_config('app.shop_product_sku_id', COALESCE(p_sku_id::TEXT, ''), true);

    RETURN public.fn_validate_discount_code(
        p_product_id,
        p_user_id,
        p_site,
        p_quantity,
        p_discount_code,
        p_discount_asset_id,
        p_agent_id
    );
END;
$$;

-- Keep legacy website purchases on the default SKU while allowing the storefront to pass a concrete SKU.
CREATE OR REPLACE FUNCTION public.fn_purchase_shop_item_core(
    p_product_id UUID,
    p_user_id UUID,
    p_site VARCHAR DEFAULT 'cn',
    p_quantity INT DEFAULT 1,
    p_discount_code VARCHAR DEFAULT NULL,
    p_agent_id UUID DEFAULT NULL,
    p_sku_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_request_user_id UUID := auth.uid();
    v_request_role TEXT := COALESCE(auth.role(), '');
    v_effective_user_id UUID;
    v_site VARCHAR := LOWER(BTRIM(COALESCE(p_site, 'cn')));
    v_max_quantity INT := 99;
    v_product_max_quantity INT := 99;
    v_unlimited_shop_purchases BOOLEAN := FALSE;

    v_product RECORD;
    v_sku RECORD;
    v_sku_id UUID := p_sku_id;
    v_sku_is_default BOOLEAN := false;
    v_base_unit_price NUMERIC(12,2);
    v_actual_unit_price NUMERIC(12,2);
    v_total_price NUMERIC(12,2);
    v_gross_total NUMERIC(12,2) := 0;
    v_final_total NUMERIC(12,2);

    v_discount_record RECORD;
    v_discount_amount NUMERIC(12,2) := 0;
    v_discount_code VARCHAR := NULL;
    v_applied_discount_type VARCHAR(32) := NULL;
    v_applied_discount_value INT := NULL;
    v_user_discount_use_count INT := 0;
    v_effective_lifecycle_status VARCHAR(32);
    v_discount_snapshot JSONB := NULL;
    v_discount_version INT := NULL;
    v_has_effective_discount BOOLEAN := FALSE;

    v_user_balance NUMERIC(12,2);
    v_balance_bonus NUMERIC(12,2) := 0;
    v_balance_paid NUMERIC(12,2) := 0;
    v_inventory_ids UUID[];
    v_inventory_primary_id UUID := NULL;
    v_contents TEXT[];

    v_order_id UUID;
    v_task_id UUID;
    v_rule JSONB;
    v_rule_qty INT;
    v_rule_price NUMERIC(12,2);
    v_effective_quantity_rules JSONB := NULL;
    v_effective_flash_sale_end TIMESTAMPTZ := NULL;
    v_effective_flash_sale_price NUMERIC(12,2) := NULL;

    v_agent_price NUMERIC(12,2) := NULL;
    v_agent_markup NUMERIC(12,2) := 0;

    v_user_product_total_quantity INT := 0;
    v_user_product_24h_quantity INT := 0;
    v_user_product_window_quantity INT := 0;
    v_remaining_quantity INT := 0;
    v_purchase_limit_lock_name TEXT := NULL;
    v_purchase_limit_24h_started_at TIMESTAMPTZ := NULL;
    v_purchase_limit_window_started_at TIMESTAMPTZ := NULL;
BEGIN
    IF v_request_role = 'service_role' THEN
        v_effective_user_id := COALESCE(p_user_id, v_request_user_id);
    ELSE
        IF v_request_user_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'message', '请先登录');
        END IF;

        IF p_user_id IS NOT NULL AND p_user_id <> v_request_user_id THEN
            RETURN jsonb_build_object('success', false, 'message', '非法的用户上下文');
        END IF;

        v_effective_user_id := v_request_user_id;
    END IF;

    IF v_effective_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '缺少有效的用户身份');
    END IF;

    IF v_site NOT IN ('cn', 'intl') THEN
        RETURN jsonb_build_object('success', false, 'message', '站点参数无效');
    END IF;

    IF p_quantity < 1 THEN
        RETURN jsonb_build_object('success', false, 'message', '购买数量必须大于0');
    END IF;

    SELECT COALESCE(unlimited_shop_purchases, false)
    INTO v_unlimited_shop_purchases
    FROM public.user_purchase_entitlements
    WHERE user_id = v_effective_user_id;

    v_unlimited_shop_purchases := COALESCE(v_unlimited_shop_purchases, false);

    IF NOT v_unlimited_shop_purchases AND p_quantity > v_max_quantity THEN
        RETURN jsonb_build_object('success', false, 'message', '单次购买数量不能超过' || v_max_quantity);
    END IF;

    SELECT
        id,
        category,
        price_points,
        price_points_intl,
        name,
        quantity_rules,
        quantity_rules_intl,
        flash_sale_end,
        flash_sale_end_intl,
        flash_sale_price,
        flash_sale_price_intl,
        delivery_type,
        webhook_target,
        usage_instructions,
        show_usage_instructions,
        max_purchase_quantity,
        purchase_limit_24h_quantity,
        purchase_limit_window_minutes,
        purchase_limit_window_quantity,
        per_account_purchase_limit
    INTO v_product
    FROM public.shop_products
    WHERE id = p_product_id
      AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', '商品不存在或已下架');
    END IF;

    IF p_sku_id IS NOT NULL THEN
        SELECT *
        INTO v_sku
        FROM public.shop_product_skus
        WHERE id = p_sku_id
          AND product_id = p_product_id
        LIMIT 1;
    ELSE
        SELECT *
        INTO v_sku
        FROM public.shop_product_skus
        WHERE product_id = p_product_id
          AND is_default = true
        ORDER BY sort_order ASC, created_at ASC
        LIMIT 1;
    END IF;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', CASE
                WHEN p_sku_id IS NOT NULL THEN '所选商品规格不存在或不属于该商品'
                ELSE '商品默认规格不存在，请先在后台补全 SKU'
            END
        );
    END IF;

    IF v_sku.is_active IS NOT TRUE THEN
        RETURN jsonb_build_object('success', false, 'message', '所选商品规格已停用');
    END IF;

    v_sku_id := v_sku.id;
    v_sku_is_default := COALESCE(v_sku.is_default, false);

    IF NOT v_unlimited_shop_purchases THEN
        v_product_max_quantity := LEAST(
            v_max_quantity,
            GREATEST(1, COALESCE(v_product.max_purchase_quantity, v_max_quantity))
        );

        IF p_quantity > v_product_max_quantity THEN
            RETURN jsonb_build_object('success', false, 'message', '当前商品单次最多购买' || v_product_max_quantity || '件');
        END IF;

        IF v_product.per_account_purchase_limit IS NOT NULL
            OR v_product.purchase_limit_24h_quantity IS NOT NULL
            OR (
                v_product.purchase_limit_window_minutes IS NOT NULL
                AND v_product.purchase_limit_window_quantity IS NOT NULL
            ) THEN
            v_purchase_limit_lock_name := v_effective_user_id::TEXT || ':' || p_product_id::TEXT;
            PERFORM pg_advisory_xact_lock(60424, hashtext(v_purchase_limit_lock_name));

            v_purchase_limit_24h_started_at := v_now - INTERVAL '24 hours';
            IF v_product.purchase_limit_window_minutes IS NOT NULL
                AND v_product.purchase_limit_window_quantity IS NOT NULL THEN
                v_purchase_limit_window_started_at := v_now - make_interval(mins => v_product.purchase_limit_window_minutes);
            END IF;

            SELECT
                COALESCE(SUM(COALESCE(item_count, 0)), 0)::INT,
                COALESCE(SUM(CASE
                    WHEN v_product.purchase_limit_24h_quantity IS NOT NULL
                        AND created_at >= v_purchase_limit_24h_started_at
                        THEN COALESCE(item_count, 0)
                    ELSE 0
                END), 0)::INT,
                COALESCE(SUM(CASE
                    WHEN v_purchase_limit_window_started_at IS NOT NULL
                        AND created_at >= v_purchase_limit_window_started_at
                        THEN COALESCE(item_count, 0)
                    ELSE 0
                END), 0)::INT
            INTO
                v_user_product_total_quantity,
                v_user_product_24h_quantity,
                v_user_product_window_quantity
            FROM public.shop_orders
            WHERE user_id = v_effective_user_id
              AND product_id = p_product_id
              AND COALESCE(refund_status, 'none') NOT IN ('refunded', 'full_refund');
        END IF;

        IF v_product.per_account_purchase_limit IS NOT NULL THEN
            v_remaining_quantity := GREATEST(0, v_product.per_account_purchase_limit - v_user_product_total_quantity);
            IF v_remaining_quantity < p_quantity THEN
                IF v_remaining_quantity = 0 THEN
                    RETURN jsonb_build_object('success', false, 'message', '当前账号已达到该商品的累计限购上限');
                END IF;

                RETURN jsonb_build_object('success', false, 'message', '当前账号最多还可购买' || v_remaining_quantity || '件');
            END IF;
        END IF;

        IF v_product.purchase_limit_24h_quantity IS NOT NULL THEN
            v_remaining_quantity := GREATEST(0, v_product.purchase_limit_24h_quantity - v_user_product_24h_quantity);
            IF v_remaining_quantity < p_quantity THEN
                IF v_remaining_quantity = 0 THEN
                    RETURN jsonb_build_object('success', false, 'message', '当前账号在24小时内已达到该商品的购买上限');
                END IF;

                RETURN jsonb_build_object('success', false, 'message', '当前账号在24小时内最多还可购买' || v_remaining_quantity || '件');
            END IF;
        END IF;

        IF v_purchase_limit_window_started_at IS NOT NULL
            AND v_product.purchase_limit_window_quantity IS NOT NULL THEN
            v_remaining_quantity := GREATEST(0, v_product.purchase_limit_window_quantity - v_user_product_window_quantity);
            IF v_remaining_quantity < p_quantity THEN
                IF v_remaining_quantity = 0 THEN
                    RETURN jsonb_build_object(
                        'success', false,
                        'message', '当前账号在最近' || v_product.purchase_limit_window_minutes || '分钟内已达到该商品的购买上限'
                    );
                END IF;

                RETURN jsonb_build_object(
                    'success', false,
                    'message', '当前账号在最近' || v_product.purchase_limit_window_minutes || '分钟内最多还可购买' || v_remaining_quantity || '件'
                );
            END IF;
        END IF;
    END IF;

    IF v_site = 'intl' THEN
        v_base_unit_price := v_sku.price_points_intl;
        v_effective_quantity_rules := COALESCE(
            v_sku.quantity_rules_intl,
            CASE
                WHEN v_sku_is_default THEN v_product.quantity_rules_intl
                ELSE NULL
            END
        );
        v_effective_flash_sale_end := v_product.flash_sale_end_intl;
        v_effective_flash_sale_price := v_product.flash_sale_price_intl;
    ELSE
        v_base_unit_price := v_sku.price_points;
        v_effective_quantity_rules := COALESCE(
            v_sku.quantity_rules,
            CASE
                WHEN v_sku_is_default THEN v_product.quantity_rules
                ELSE NULL
            END
        );
        v_effective_flash_sale_end := v_product.flash_sale_end;
        v_effective_flash_sale_price := v_product.flash_sale_price;
    END IF;

    IF v_base_unit_price IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '商品未在当前站点销售');
    END IF;

    IF v_effective_flash_sale_end IS NOT NULL
        AND v_effective_flash_sale_end > v_now
        AND v_effective_flash_sale_price IS NOT NULL THEN
        v_base_unit_price := LEAST(v_base_unit_price, v_effective_flash_sale_price);
    ELSIF v_effective_quantity_rules IS NOT NULL AND jsonb_array_length(v_effective_quantity_rules) > 0 THEN
        FOR v_rule IN SELECT * FROM jsonb_array_elements(v_effective_quantity_rules)
        LOOP
            v_rule_qty := (v_rule->>'qty')::INT;
            v_rule_price := COALESCE(NULLIF(BTRIM(COALESCE(v_rule->>'price', '')), ''), '0')::NUMERIC(12,2);
            IF p_quantity >= v_rule_qty AND v_rule_price < v_base_unit_price THEN
                v_base_unit_price := v_rule_price;
            END IF;
        END LOOP;
    END IF;

    v_actual_unit_price := v_base_unit_price;

    IF p_agent_id IS NOT NULL THEN
        SELECT custom_price
        INTO v_agent_price
        FROM public.agent_prices
        WHERE agent_id = p_agent_id
          AND product_id = p_product_id
          AND COALESCE(NULLIF(BTRIM(LOWER(site)), ''), 'cn') = v_site;

        IF v_agent_price IS NOT NULL AND v_agent_price > v_base_unit_price THEN
            v_actual_unit_price := v_agent_price;
            v_agent_markup := ROUND(v_agent_price - v_base_unit_price, 2);
        END IF;
    END IF;

    v_total_price := ROUND(v_actual_unit_price * p_quantity, 2);
    v_gross_total := v_total_price;

    v_discount_code := NULLIF(UPPER(BTRIM(COALESCE(p_discount_code, ''))), '');
    IF v_discount_code IS NOT NULL THEN
        SELECT *
        INTO v_discount_record
        FROM public.discount_codes
        WHERE code = v_discount_code
        FOR UPDATE;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'message', '无效的优惠码');
        END IF;

        v_effective_lifecycle_status := COALESCE(
            NULLIF(BTRIM(COALESCE(v_discount_record.lifecycle_status, '')), ''),
            CASE WHEN COALESCE(v_discount_record.is_active, true) THEN 'active' ELSE 'paused_manual' END
        );

        IF v_effective_lifecycle_status = 'archived' THEN
            RETURN jsonb_build_object('success', false, 'message', '该优惠码已归档');
        END IF;

        IF v_discount_record.starts_at IS NOT NULL AND v_discount_record.starts_at > v_now THEN
            RETURN jsonb_build_object('success', false, 'message', '该优惠码尚未生效');
        END IF;

        IF v_discount_record.expires_at IS NOT NULL AND v_discount_record.expires_at < v_now THEN
            RETURN jsonb_build_object('success', false, 'message', '该优惠码已过期');
        END IF;

        IF COALESCE(v_discount_record.is_active, true) = false OR v_effective_lifecycle_status IN ('paused_manual', 'paused_risk') THEN
            IF v_effective_lifecycle_status = 'paused_risk' OR COALESCE(v_discount_record.status_reason, '') LIKE 'risk_%' THEN
                RETURN jsonb_build_object('success', false, 'message', '该优惠码当前因风控暂停使用');
            END IF;

            RETURN jsonb_build_object('success', false, 'message', '该优惠码当前已停用');
        END IF;

        IF v_discount_record.max_uses > 0 AND v_discount_record.used_count >= v_discount_record.max_uses THEN
            RETURN jsonb_build_object('success', false, 'message', '该优惠码的使用次数已达上限');
        END IF;

        IF v_discount_record.applicable_site IS NOT NULL
            AND v_discount_record.applicable_site <> v_site THEN
            RETURN jsonb_build_object('success', false, 'message', '该优惠码仅适用于指定站点');
        END IF;

        IF COALESCE(v_discount_record.scope_type, 'all') = 'category'
            AND COALESCE(v_product.category, '') <> COALESCE(v_discount_record.scope_category, '') THEN
            RETURN jsonb_build_object('success', false, 'message', '该优惠码仅适用于指定分类商品');
        END IF;

        IF COALESCE(v_discount_record.scope_type, 'all') = 'product'
            AND v_discount_record.scope_product_id IS DISTINCT FROM p_product_id THEN
            RETURN jsonb_build_object('success', false, 'message', '该优惠码仅适用于指定商品');
        END IF;

        IF COALESCE(v_discount_record.max_uses_per_user, 0) > 0 THEN
            SELECT COUNT(*)::INT
            INTO v_user_discount_use_count
            FROM public.shop_orders
            WHERE user_id = v_effective_user_id
              AND discount_code = v_discount_code
              AND COALESCE(refund_status, 'none') NOT IN ('refunded', 'full_refund');

            IF v_user_discount_use_count >= v_discount_record.max_uses_per_user THEN
                RETURN jsonb_build_object('success', false, 'message', '当前账号已达到该优惠码的使用上限');
            END IF;
        END IF;

        v_applied_discount_type := v_discount_record.discount_type;
        v_applied_discount_value := v_discount_record.discount_value;

        IF v_discount_record.discount_type = 'percent' THEN
            SELECT
                resolved.discount_amount,
                resolved.final_total,
                resolved.has_effective_discount
            INTO
                v_discount_amount,
                v_final_total,
                v_has_effective_discount
            FROM public.fn_resolve_shop_percent_discount(
                v_total_price,
                v_discount_record.discount_value,
                COALESCE(v_discount_record.allow_zero_total, false)
            ) AS resolved;

            IF NOT v_has_effective_discount THEN
                RETURN jsonb_build_object('success', false, 'message', '当前商品暂无可优惠金额，无法使用这张优惠码');
            END IF;
        ELSIF v_discount_record.discount_type = 'fixed' THEN
            v_discount_amount := LEAST(v_total_price, v_discount_record.discount_value::NUMERIC(12,2));
            v_final_total := ROUND(GREATEST(0, v_total_price - v_discount_amount), 2);
            v_has_effective_discount := v_discount_amount > 0;
        ELSE
            v_final_total := v_total_price;
            v_has_effective_discount := false;
        END IF;

        IF v_discount_amount > 0
            AND v_final_total = 0
            AND NOT COALESCE(v_discount_record.allow_zero_total, false) THEN
            RETURN jsonb_build_object('success', false, 'message', '该优惠码不允许全额抵扣');
        END IF;

        v_discount_version := COALESCE(v_discount_record.version_no, 1);
        v_discount_snapshot := jsonb_build_object(
            'code', v_discount_code,
            'version_no', v_discount_version,
            'discount_type', v_discount_record.discount_type,
            'discount_value', v_discount_record.discount_value,
            'max_uses', v_discount_record.max_uses,
            'max_uses_per_user', v_discount_record.max_uses_per_user,
            'starts_at', v_discount_record.starts_at,
            'expires_at', v_discount_record.expires_at,
            'lifecycle_status', v_effective_lifecycle_status,
            'status_reason', v_discount_record.status_reason,
            'applicable_site', v_discount_record.applicable_site,
            'scope_type', COALESCE(v_discount_record.scope_type, 'all'),
            'scope_category', v_discount_record.scope_category,
            'scope_product_id', v_discount_record.scope_product_id,
            'allow_zero_total', COALESCE(v_discount_record.allow_zero_total, false),
            'recovery_strategy', COALESCE(v_discount_record.recovery_strategy, 'manual_only'),
            'observation_window_hours', COALESCE(v_discount_record.observation_window_hours, 24),
            'observation_ends_at', v_discount_record.observation_ends_at,
            'site', v_site,
            'quantity', p_quantity,
            'unit_price', v_actual_unit_price,
            'subtotal', v_gross_total,
            'discount_amount', v_discount_amount,
            'final_total', v_final_total
        );

        v_total_price := v_final_total;
    END IF;

    IF v_product.delivery_type = 'KEY' OR v_product.delivery_type IS NULL THEN
        SELECT array_agg(id), array_agg(content)
        INTO v_inventory_ids, v_contents
        FROM (
            SELECT id, content
            FROM public.shop_inventory
            WHERE product_id = p_product_id
              AND status = 'available'
              AND (
                  sku_id = v_sku_id
                  OR (v_sku_is_default AND sku_id IS NULL)
              )
            ORDER BY created_at ASC, id ASC
            LIMIT p_quantity
            FOR UPDATE SKIP LOCKED
        ) t;

        IF v_inventory_ids IS NULL OR array_length(v_inventory_ids, 1) < p_quantity THEN
            RETURN jsonb_build_object('success', false, 'message', '商品库存不足，无法满足当前数量');
        END IF;

        IF array_length(v_inventory_ids, 1) = 1 THEN
            v_inventory_primary_id := v_inventory_ids[1];
        END IF;
    ELSIF v_product.delivery_type = 'API' THEN
        v_contents := ARRAY['您的订单信息已通过 API Webhook 推送至第三方商户，请留意履约通知。'];
    ELSE
        RETURN jsonb_build_object('success', false, 'message', '未知的发货模式: ' || v_product.delivery_type);
    END IF;

    SELECT total_balance, bonus_balance, paid_balance
    INTO v_user_balance, v_balance_bonus, v_balance_paid
    FROM public.points_balance
    WHERE user_id = v_effective_user_id
      AND site = v_site
    FOR UPDATE;

    IF v_user_balance IS NULL OR v_user_balance < v_total_price THEN
        RETURN jsonb_build_object('success', false, 'message', '积分余额不足');
    END IF;

    IF v_total_price > 0 THEN
        DECLARE
            v_deduct_bonus NUMERIC(12,2) := 0;
            v_deduct_paid NUMERIC(12,2) := 0;
            v_remaining_cost NUMERIC(12,2) := v_total_price;
        BEGIN
            IF COALESCE(v_balance_bonus, 0) >= v_remaining_cost THEN
                v_deduct_bonus := v_remaining_cost;
                v_remaining_cost := 0;
            ELSE
                v_deduct_bonus := COALESCE(v_balance_bonus, 0);
                v_remaining_cost := ROUND(v_remaining_cost - COALESCE(v_balance_bonus, 0), 2);
            END IF;

            IF v_remaining_cost > 0 THEN
                IF COALESCE(v_balance_paid, 0) >= v_remaining_cost THEN
                    v_deduct_paid := v_remaining_cost;
                ELSE
                    RETURN jsonb_build_object('success', false, 'message', '余额扣款异常');
                END IF;
            END IF;

            UPDATE public.points_balance
            SET bonus_balance = ROUND(bonus_balance - v_deduct_bonus, 2),
                paid_balance = ROUND(paid_balance - v_deduct_paid, 2),
                updated_at = v_now
            WHERE user_id = v_effective_user_id
              AND site = v_site;
        END;
    END IF;

    IF v_discount_amount > 0 AND v_discount_code IS NOT NULL THEN
        UPDATE public.discount_codes
        SET used_count = used_count + 1
        WHERE code = v_discount_code;
    END IF;

    INSERT INTO public.shop_orders (
        user_id,
        product_id,
        sku_id,
        inventory_id,
        price_paid,
        total_price,
        item_count,
        snapshot_product_name,
        discount_code,
        discount_amount,
        discount_snapshot,
        discount_version,
        discount_usage_restored,
        discount_refund_amount,
        delivery_status,
        delivery_completed_at,
        delivery_updated_at,
        delivery_attempt_count,
        site
    )
    VALUES (
        v_effective_user_id,
        p_product_id,
        v_sku_id,
        CASE
            WHEN v_product.delivery_type = 'KEY' OR v_product.delivery_type IS NULL THEN v_inventory_primary_id
            ELSE NULL
        END,
        v_total_price,
        v_gross_total,
        p_quantity,
        v_product.name,
        v_discount_code,
        v_discount_amount,
        v_discount_snapshot,
        v_discount_version,
        false,
        0,
        CASE
            WHEN v_product.delivery_type = 'API' THEN 'pending'
            ELSE 'delivered'
        END,
        CASE
            WHEN v_product.delivery_type = 'API' THEN NULL
            ELSE v_now
        END,
        v_now,
        0,
        v_site
    )
    RETURNING id INTO v_order_id;

    IF v_product.delivery_type = 'KEY' OR v_product.delivery_type IS NULL THEN
        UPDATE public.shop_inventory
        SET status = 'sold',
            sku_id = COALESCE(sku_id, v_sku_id),
            buyer_id = v_effective_user_id,
            sold_at = v_now
        WHERE id = ANY(v_inventory_ids);

        INSERT INTO public.shop_order_items (order_id, inventory_id, sku_id, snapshot_product_name, price_paid)
        SELECT v_order_id, unnest(v_inventory_ids), v_sku_id, v_product.name, v_actual_unit_price;
    ELSE
        INSERT INTO public.shop_webhook_tasks (
            order_id,
            target_url,
            payload,
            status,
            attempt_count,
            max_attempts,
            next_attempt_at,
            dedupe_key
        )
        VALUES (
            v_order_id,
            v_product.webhook_target,
            jsonb_build_object(
                'user_id', v_effective_user_id,
                'order_id', v_order_id,
                'product_id', p_product_id,
                'sku_id', v_sku_id,
                'sku_name', v_sku.sku_name,
                'quantity', p_quantity,
                'site', v_site
            ),
            'pending',
            0,
            5,
            v_now,
            'shop_delivery:' || v_order_id::TEXT
        )
        RETURNING id INTO v_task_id;

        INSERT INTO public.shop_order_items (order_id, inventory_id, sku_id, snapshot_product_name, price_paid)
        VALUES (v_order_id, NULL, v_sku_id, v_product.name || ' [API]', v_total_price);

        UPDATE public.shop_orders
        SET delivery_task_id = v_task_id
        WHERE id = v_order_id;
    END IF;

    IF v_total_price > 0 THEN
        INSERT INTO public.points_ledger (user_id, amount, reason, reference_id, site)
        VALUES (v_effective_user_id, -v_total_price, '商城购买: ' || v_product.name, 'SHOP_ORDER_' || v_order_id, v_site);
    END IF;

    IF v_total_price > 0 THEN
        INSERT INTO public.shop_purchase_reward_jobs (
            order_id,
            user_id,
            product_id,
            product_name,
            site,
            quantity,
            base_unit_price,
            total_price,
            agent_id,
            agent_markup,
            status,
            updated_at
        )
        VALUES (
            v_order_id,
            v_effective_user_id,
            p_product_id,
            v_product.name,
            v_site,
            p_quantity,
            v_base_unit_price,
            v_total_price,
            p_agent_id,
            v_agent_markup,
            'pending',
            v_now
        )
        ON CONFLICT (order_id) DO NOTHING;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'message', '购买成功',
        'data', jsonb_build_object(
            'content', array_to_string(v_contents, E'\n----\n'),
            'order_id', v_order_id,
            'sku_id', v_sku_id,
            'sku_name', v_sku.sku_name,
            'product_name', v_product.name,
            'price_paid', v_total_price,
            'subtotal', v_gross_total,
            'discount_code', v_discount_code,
            'discount_type', v_applied_discount_type,
            'discount_value', v_applied_discount_value,
            'discount_amount', v_discount_amount,
            'final_total', v_total_price,
            'unit_price', v_actual_unit_price,
            'remaining_points', ROUND(GREATEST(0, COALESCE(v_user_balance, 0) - v_total_price), 2),
            'usage_instructions', CASE WHEN v_product.show_usage_instructions THEN v_product.usage_instructions ELSE NULL END,
            'show_usage_instructions', COALESCE(v_product.show_usage_instructions, false),
            'site', v_site,
            'discount_version', v_discount_version
        )
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', '交易失败: ' || SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_purchase_shop_item_core(UUID, UUID, VARCHAR, INT, VARCHAR, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_purchase_shop_item_core(UUID, UUID, VARCHAR, INT, VARCHAR, UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_purchase_shop_item_core(UUID, UUID, VARCHAR, INT, VARCHAR, UUID, UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_purchase_shop_item(
    p_product_id UUID,
    p_user_id UUID,
    p_site VARCHAR DEFAULT 'cn',
    p_quantity INT DEFAULT 1,
    p_discount_code VARCHAR DEFAULT NULL,
    p_agent_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_setting_sku_id UUID := NULLIF(current_setting('app.shop_product_sku_id', true), '')::UUID;
BEGIN
    RETURN public.fn_purchase_shop_item_core(
        p_product_id,
        p_user_id,
        p_site,
        p_quantity,
        p_discount_code,
        p_agent_id,
        v_setting_sku_id
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_purchase_shop_item(
    p_product_id UUID,
    p_user_id UUID,
    p_site VARCHAR,
    p_quantity INT,
    p_discount_code VARCHAR,
    p_discount_asset_id UUID,
    p_agent_id UUID,
    p_sku_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_request_user_id UUID := auth.uid();
    v_request_role TEXT := COALESCE(auth.role(), '');
    v_effective_user_id UUID;
    v_effective_discount_code VARCHAR := NULLIF(UPPER(BTRIM(COALESCE(p_discount_code, ''))), '');
    v_discount_record RECORD;
    v_asset RECORD;
    v_result JSONB;
    v_order_id UUID;
    v_discount_id UUID := NULL;
    v_distribution_mode VARCHAR(32) := 'general_code';
    v_audience_segment VARCHAR(80) := NULL;
    v_campaign_tag VARCHAR(120) := NULL;
    v_is_exclusive BOOLEAN := true;
    v_stack_priority INT := 100;
    v_pricing_apply_stage VARCHAR(32) := 'order_discount';
BEGIN
    IF v_request_role = 'service_role' THEN
        v_effective_user_id := COALESCE(p_user_id, v_request_user_id);
    ELSE
        IF v_request_user_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'message', '请先登录');
        END IF;

        IF p_user_id IS DISTINCT FROM v_request_user_id THEN
            RETURN jsonb_build_object('success', false, 'message', '非法的用户上下文');
        END IF;

        v_effective_user_id := v_request_user_id;
    END IF;

    IF v_effective_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', '缺少有效的用户身份');
    END IF;

    IF p_discount_asset_id IS NOT NULL THEN
        SELECT
            a.id,
            a.user_id,
            a.discount_id,
            a.asset_status,
            a.expires_at,
            a.source_type,
            a.source_channel,
            COALESCE(NULLIF(BTRIM(a.audience_segment), ''), NULLIF(BTRIM(d.audience_segment), '')) AS audience_segment,
            d.code,
            d.distribution_mode,
            d.campaign_tag,
            d.is_exclusive,
            d.stack_priority,
            d.pricing_apply_stage
        INTO v_asset
        FROM public.discount_user_assets a
        JOIN public.discount_codes d
            ON d.id = a.discount_id
        WHERE a.id = p_discount_asset_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'message', '指定卡券不存在');
        END IF;

        IF v_asset.user_id IS DISTINCT FROM v_effective_user_id THEN
            RETURN jsonb_build_object('success', false, 'message', '该卡券不属于当前账号');
        END IF;

        CASE LOWER(BTRIM(COALESCE(v_asset.asset_status, 'available')))
            WHEN 'used' THEN
                RETURN jsonb_build_object('success', false, 'message', '该卡券已使用');
            WHEN 'expired' THEN
                RETURN jsonb_build_object('success', false, 'message', '该卡券已过期');
            WHEN 'revoked' THEN
                RETURN jsonb_build_object('success', false, 'message', '该卡券当前不可用');
            WHEN 'available' THEN
                NULL;
            ELSE
                RETURN jsonb_build_object('success', false, 'message', '该卡券当前不可用');
        END CASE;

        IF v_asset.expires_at IS NOT NULL AND v_asset.expires_at < NOW() THEN
            RETURN jsonb_build_object('success', false, 'message', '该卡券已过期');
        END IF;

        IF v_effective_discount_code IS NOT NULL AND v_effective_discount_code <> v_asset.code THEN
            RETURN jsonb_build_object('success', false, 'message', '卡券与优惠码不匹配');
        END IF;

        v_effective_discount_code := v_asset.code;
        v_discount_id := v_asset.discount_id;
        v_distribution_mode := COALESCE(v_asset.distribution_mode, 'general_code');
        v_audience_segment := v_asset.audience_segment;
        v_campaign_tag := v_asset.campaign_tag;
        v_is_exclusive := COALESCE(v_asset.is_exclusive, true);
        v_stack_priority := GREATEST(1, COALESCE(v_asset.stack_priority, 100));
        v_pricing_apply_stage := COALESCE(NULLIF(BTRIM(COALESCE(v_asset.pricing_apply_stage, '')), ''), 'order_discount');
    END IF;

    IF v_effective_discount_code IS NOT NULL THEN
        SELECT
            id,
            distribution_mode,
            audience_segment,
            campaign_tag,
            is_exclusive,
            stack_priority,
            pricing_apply_stage
        INTO v_discount_record
        FROM public.discount_codes
        WHERE code = v_effective_discount_code
        LIMIT 1;

        IF FOUND THEN
            v_discount_id := COALESCE(v_discount_id, v_discount_record.id);
            v_distribution_mode := COALESCE(NULLIF(BTRIM(COALESCE(v_discount_record.distribution_mode, '')), ''), v_distribution_mode, 'general_code');
            v_audience_segment := COALESCE(NULLIF(BTRIM(COALESCE(v_audience_segment, '')), ''), NULLIF(BTRIM(COALESCE(v_discount_record.audience_segment, '')), ''));
            v_campaign_tag := COALESCE(NULLIF(BTRIM(COALESCE(v_campaign_tag, '')), ''), NULLIF(BTRIM(COALESCE(v_discount_record.campaign_tag, '')), ''));
            v_is_exclusive := COALESCE(v_discount_record.is_exclusive, v_is_exclusive, true);
            v_stack_priority := GREATEST(1, COALESCE(v_discount_record.stack_priority, v_stack_priority, 100));
            v_pricing_apply_stage := COALESCE(NULLIF(BTRIM(COALESCE(v_discount_record.pricing_apply_stage, '')), ''), v_pricing_apply_stage, 'order_discount');
        END IF;
    END IF;

    IF p_discount_asset_id IS NULL AND v_distribution_mode = 'public_claim' THEN
        RETURN jsonb_build_object('success', false, 'message', '该优惠券需先领取到卡券包后使用');
    END IF;

    IF p_discount_asset_id IS NULL AND v_distribution_mode = 'user_assigned' THEN
        RETURN jsonb_build_object('success', false, 'message', '该优惠券仅限已到账户的用户使用');
    END IF;

    v_result := public.fn_purchase_shop_item_core(
        p_product_id,
        v_effective_user_id,
        p_site,
        p_quantity,
        v_effective_discount_code,
        p_agent_id,
        p_sku_id
    );

    IF COALESCE((v_result ->> 'success')::BOOLEAN, false) IS NOT TRUE THEN
        RETURN v_result;
    END IF;

    v_order_id := NULLIF(v_result #>> '{data,order_id}', '')::UUID;

    IF v_order_id IS NOT NULL AND v_effective_discount_code IS NOT NULL THEN
        UPDATE public.shop_orders
        SET discount_asset_id = COALESCE(p_discount_asset_id, discount_asset_id),
            discount_asset_restored = CASE
                WHEN p_discount_asset_id IS NOT NULL THEN false
                ELSE discount_asset_restored
            END,
            discount_snapshot = COALESCE(discount_snapshot, '{}'::JSONB) || jsonb_strip_nulls(jsonb_build_object(
                'discount_id', v_discount_id,
                'discount_asset_id', p_discount_asset_id,
                'distribution_mode', v_distribution_mode,
                'campaign_tag', v_campaign_tag,
                'audience_segment', v_audience_segment,
                'source_type', COALESCE(v_asset.source_type, NULL),
                'source_channel', COALESCE(v_asset.source_channel, NULL),
                'is_exclusive', v_is_exclusive,
                'stack_priority', v_stack_priority,
                'pricing_apply_stage', v_pricing_apply_stage
            ))
        WHERE id = v_order_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'message', COALESCE(v_result ->> 'message', '购买成功'),
        'data', COALESCE(v_result -> 'data', '{}'::JSONB) || jsonb_build_object(
            'discount_id', v_discount_id,
            'discount_asset_id', p_discount_asset_id,
            'distribution_mode', v_distribution_mode,
            'campaign_tag', v_campaign_tag,
            'audience_segment', v_audience_segment,
            'is_exclusive', v_is_exclusive,
            'stack_priority', v_stack_priority,
            'pricing_apply_stage', v_pricing_apply_stage
        )
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', '交易失败: ' || SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_purchase_shop_item(UUID, UUID, VARCHAR, INT, VARCHAR, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_purchase_shop_item(UUID, UUID, VARCHAR, INT, VARCHAR, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_purchase_shop_item(UUID, UUID, VARCHAR, INT, VARCHAR, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_purchase_shop_item(UUID, UUID, VARCHAR, INT, VARCHAR, UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_purchase_shop_item(UUID, UUID, VARCHAR, INT, VARCHAR, UUID, UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_purchase_shop_item(UUID, UUID, VARCHAR, INT, VARCHAR, UUID, UUID, UUID) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.fn_purchase_shop_item_with_discounts(UUID, UUID, VARCHAR, INT, JSONB, UUID, UUID);

CREATE OR REPLACE FUNCTION public.fn_purchase_shop_item_with_discounts(
    p_product_id UUID,
    p_user_id UUID,
    p_site VARCHAR,
    p_quantity INT,
    p_discount_inputs JSONB,
    p_agent_id UUID,
    p_sku_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_result JSONB := '{}'::JSONB;
BEGIN
    PERFORM set_config('app.shop_product_sku_id', COALESCE(p_sku_id::TEXT, ''), true);

    v_result := public.fn_purchase_shop_item_with_discounts(
        p_product_id,
        p_user_id,
        p_site,
        p_quantity,
        p_discount_inputs,
        p_agent_id
    );

    PERFORM set_config('app.shop_product_sku_id', '', true);
    RETURN v_result;
EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.shop_product_sku_id', '', true);
    RETURN jsonb_build_object('success', false, 'message', '多券交易失败: ' || SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_validate_discount_code_core(UUID, UUID, VARCHAR, INT, VARCHAR, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_validate_discount_code_core(UUID, UUID, VARCHAR, INT, VARCHAR, UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_validate_discount_code_core(UUID, UUID, VARCHAR, INT, VARCHAR, UUID, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_validate_discount_code(UUID, UUID, VARCHAR, INT, VARCHAR, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_validate_discount_code(UUID, UUID, VARCHAR, INT, VARCHAR, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_validate_discount_code(UUID, UUID, VARCHAR, INT, VARCHAR, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_validate_discount_code(UUID, UUID, VARCHAR, INT, VARCHAR, UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_validate_discount_code(UUID, UUID, VARCHAR, INT, VARCHAR, UUID, UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_validate_discount_code(UUID, UUID, VARCHAR, INT, VARCHAR, UUID, UUID, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_purchase_shop_item_with_discounts(UUID, UUID, VARCHAR, INT, JSONB, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_purchase_shop_item_with_discounts(UUID, UUID, VARCHAR, INT, JSONB, UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_purchase_shop_item_with_discounts(UUID, UUID, VARCHAR, INT, JSONB, UUID, UUID) TO authenticated, service_role;
