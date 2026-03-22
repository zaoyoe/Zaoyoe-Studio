-- ============================================
-- Unify legacy shop purchase overloads
-- Purpose:
-- - Ensure any remaining 3-arg fn_purchase_shop_item overload
--   routes into the hardened 6-arg implementation
-- - Prevent legacy exact-signature calls from bypassing the
--   newer order-level audit / reference_id behavior
-- ============================================

CREATE OR REPLACE FUNCTION public.fn_purchase_shop_item(
    p_product_id UUID,
    p_user_id UUID,
    p_site VARCHAR DEFAULT 'cn'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN public.fn_purchase_shop_item(
        p_product_id,
        p_user_id,
        p_site,
        1,
        NULL,
        NULL
    );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_purchase_shop_item(UUID, UUID, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_purchase_shop_item(UUID, UUID, VARCHAR) TO authenticated, service_role;
