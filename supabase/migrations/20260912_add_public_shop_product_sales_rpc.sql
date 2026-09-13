-- Provide the public shop with site-scoped, non-refunded product sales totals.
-- The API calls this through service_role so order rows never become public data.

ALTER TABLE public.shop_orders
    ADD COLUMN IF NOT EXISTS item_count INT DEFAULT 1,
    ADD COLUMN IF NOT EXISTS refund_status VARCHAR(20) DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS site VARCHAR(10) DEFAULT 'cn';

UPDATE public.shop_orders
SET item_count = 1
WHERE item_count IS NULL OR item_count < 1;

UPDATE public.shop_orders
SET refund_status = 'none'
WHERE refund_status IS NULL OR BTRIM(refund_status) = '';

UPDATE public.shop_orders
SET site = 'cn'
WHERE site IS NULL OR BTRIM(site) = '';

ALTER TABLE public.shop_orders
    ALTER COLUMN item_count SET DEFAULT 1,
    ALTER COLUMN refund_status SET DEFAULT 'none',
    ALTER COLUMN site SET DEFAULT 'cn';

CREATE INDEX IF NOT EXISTS idx_shop_orders_public_sales_site_product
    ON public.shop_orders (site, product_id)
    INCLUDE (item_count, refund_status);

DROP FUNCTION IF EXISTS public.fn_public_shop_product_sales_counts(UUID[], VARCHAR);

CREATE OR REPLACE FUNCTION public.fn_public_shop_product_sales_counts(
    p_product_ids UUID[],
    p_site VARCHAR DEFAULT 'cn'
)
RETURNS TABLE (
    product_id UUID,
    sales_count BIGINT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
    SELECT
        o.product_id,
        SUM(GREATEST(COALESCE(o.item_count, 1), 1))::BIGINT AS sales_count
    FROM public.shop_orders o
    WHERE o.product_id = ANY(COALESCE(p_product_ids, ARRAY[]::UUID[]))
      AND LOWER(BTRIM(COALESCE(NULLIF(o.site, ''), 'cn'))) = CASE
          WHEN LOWER(BTRIM(COALESCE(NULLIF(p_site, ''), 'cn'))) = 'intl' THEN 'intl'
          ELSE 'cn'
      END
      AND LOWER(BTRIM(COALESCE(NULLIF(o.refund_status, ''), 'none'))) NOT IN ('refunded', 'full_refund')
    GROUP BY o.product_id;
$function$;

COMMENT ON FUNCTION public.fn_public_shop_product_sales_counts(UUID[], VARCHAR)
    IS 'Returns site-scoped product sales quantities excluding refunded orders.';

REVOKE ALL ON FUNCTION public.fn_public_shop_product_sales_counts(UUID[], VARCHAR) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_public_shop_product_sales_counts(UUID[], VARCHAR) FROM anon;
REVOKE ALL ON FUNCTION public.fn_public_shop_product_sales_counts(UUID[], VARCHAR) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_public_shop_product_sales_counts(UUID[], VARCHAR) TO service_role;
