-- Add procurement source tracking for shop inventory imports.
-- Each import can create a procurement batch and link imported inventory rows
-- to immutable cost/source snapshots for later quality and profit analysis.

CREATE TABLE IF NOT EXISTS public.shop_inventory_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site VARCHAR(16) NOT NULL DEFAULT 'cn',
    source_name TEXT NOT NULL,
    source_url TEXT,
    platform TEXT,
    contact_name TEXT,
    contact_handle TEXT,
    risk_tier VARCHAR(32) NOT NULL DEFAULT 'standard',
    quality_grade VARCHAR(32),
    default_currency VARCHAR(12) NOT NULL DEFAULT 'CNY',
    notes TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shop_inventory_sources_site_name
    ON public.shop_inventory_sources (site, LOWER(BTRIM(source_name)));

CREATE INDEX IF NOT EXISTS idx_shop_inventory_sources_site_created
    ON public.shop_inventory_sources (site, created_at DESC);

CREATE TABLE IF NOT EXISTS public.shop_procurement_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site VARCHAR(16) NOT NULL DEFAULT 'cn',
    batch_code TEXT NOT NULL,
    source_id UUID REFERENCES public.shop_inventory_sources(id) ON DELETE SET NULL,
    product_id UUID REFERENCES public.shop_products(id) ON DELETE SET NULL,
    sku_id UUID REFERENCES public.shop_product_skus(id) ON DELETE SET NULL,
    imported_count INT NOT NULL DEFAULT 0 CHECK (imported_count >= 0),
    unit_cost NUMERIC(14,4),
    currency VARCHAR(12) NOT NULL DEFAULT 'CNY',
    exchange_rate_to_cny NUMERIC(18,8) NOT NULL DEFAULT 1,
    unit_cost_cny NUMERIC(14,4),
    total_cost_cny NUMERIC(14,4),
    purchased_at TIMESTAMPTZ,
    proof_url TEXT,
    quality_status VARCHAR(32) NOT NULL DEFAULT 'unverified',
    quality_score INT CHECK (quality_score IS NULL OR (quality_score >= 0 AND quality_score <= 100)),
    cost_status VARCHAR(32) NOT NULL DEFAULT 'actual',
    notes TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (site, batch_code)
);

CREATE INDEX IF NOT EXISTS idx_shop_procurement_batches_site_created
    ON public.shop_procurement_batches (site, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shop_procurement_batches_source_created
    ON public.shop_procurement_batches (source_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shop_procurement_batches_product_sku
    ON public.shop_procurement_batches (product_id, sku_id, created_at DESC);

ALTER TABLE public.shop_inventory
    ADD COLUMN IF NOT EXISTS source_batch_id UUID,
    ADD COLUMN IF NOT EXISTS purchase_unit_cost NUMERIC(14,4),
    ADD COLUMN IF NOT EXISTS purchase_currency VARCHAR(12),
    ADD COLUMN IF NOT EXISTS purchase_exchange_rate_to_cny NUMERIC(18,8),
    ADD COLUMN IF NOT EXISTS purchase_unit_cost_cny NUMERIC(14,4);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'shop_inventory'
          AND constraint_name = 'shop_inventory_source_batch_id_fkey'
    ) THEN
        ALTER TABLE public.shop_inventory
            ADD CONSTRAINT shop_inventory_source_batch_id_fkey
            FOREIGN KEY (source_batch_id)
            REFERENCES public.shop_procurement_batches(id)
            ON DELETE SET NULL;
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_shop_inventory_source_batch_id
    ON public.shop_inventory (source_batch_id)
    WHERE source_batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shop_inventory_product_sku_source_batch
    ON public.shop_inventory (product_id, sku_id, source_batch_id, status);

ALTER TABLE public.shop_inventory_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_procurement_batches ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'shop_inventory_sources'
          AND policyname = 'Admins manage shop inventory sources'
    ) THEN
        CREATE POLICY "Admins manage shop inventory sources"
            ON public.shop_inventory_sources
            FOR ALL
            USING (public.is_admin())
            WITH CHECK (public.is_admin());
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'shop_procurement_batches'
          AND policyname = 'Admins manage shop procurement batches'
    ) THEN
        CREATE POLICY "Admins manage shop procurement batches"
            ON public.shop_procurement_batches
            FOR ALL
            USING (public.is_admin())
            WITH CHECK (public.is_admin());
    END IF;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shop_inventory_sources TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shop_procurement_batches TO authenticated;

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

COMMENT ON TABLE public.shop_inventory_sources IS 'Admin-managed supplier/source profiles used by shop inventory procurement batches.';
COMMENT ON TABLE public.shop_procurement_batches IS 'One procurement/import batch for shop inventory, including source, cost, currency, quality and proof snapshots.';
COMMENT ON COLUMN public.shop_inventory.source_batch_id IS 'Links an inventory row to the procurement batch created during import.';
COMMENT ON COLUMN public.shop_inventory.purchase_unit_cost_cny IS 'Immutable per-item purchase cost snapshot in CNY for later profit attribution.';
