-- Extend the content-free guest-order admin view with the financial fields
-- required by the administrator detail page. This migration does not expose
-- inventory content, claim secrets, buyer hashes, or provider webhook bodies.

CREATE OR REPLACE VIEW public.admin_guest_shop_orders
WITH (security_invoker = on) AS
SELECT
    o.id,
    o.order_no,
    o.site,
    o.currency,
    o.product_id,
    o.sku_id,
    o.snapshot_product_name,
    o.snapshot_sku_name,
    o.quantity,
    o.unit_amount,
    o.total_amount,
    o.payment_status,
    o.reservation_status,
    o.fulfillment_status,
    o.refund_status,
    o.expires_at,
    o.paid_at,
    o.fulfilled_at,
    o.last_error_code,
    o.last_error_message,
    r.id AS reservation_id,
    r.inventory_id,
    r.status AS reservation_row_status,
    r.reserved_until,
    p.id AS payment_order_id,
    p.provider,
    p.channel,
    p.provider_order_no,
    p.status AS payment_row_status,
    p.expected_amount,
    p.paid_amount,
    p.sign_verified,
    p.amount_verified,
    p.currency_verified,
    p.final_status_verified,
    p.last_event_at,
    p.last_error_code AS payment_last_error_code,
    p.last_error_message AS payment_last_error_message,
    o.created_at,
    o.updated_at,
    o.list_unit_amount,
    o.discount_amount,
    o.discount_code,
    o.payment_fee_amount,
    p.payment_fee,
    i.status AS inventory_status,
    i.source_batch_id AS inventory_source_batch_id,
    i.purchase_unit_cost AS inventory_purchase_unit_cost,
    i.purchase_unit_cost_cny AS inventory_purchase_unit_cost_cny,
    p.currency AS payment_currency
FROM public.guest_shop_orders o
LEFT JOIN LATERAL (
    SELECT
        reservation.id,
        reservation.inventory_id,
        reservation.status,
        reservation.reserved_until
    FROM public.guest_shop_inventory_reservations reservation
    WHERE reservation.order_id = o.id
    ORDER BY reservation.created_at, reservation.id
    LIMIT 1
) r ON TRUE
LEFT JOIN public.guest_shop_payment_orders p ON p.guest_order_id = o.id
LEFT JOIN public.shop_inventory i ON i.id = r.inventory_id
WHERE COALESCE(auth.role(), '') = 'service_role'
   OR public.is_admin();

REVOKE ALL ON public.admin_guest_shop_orders FROM PUBLIC, anon;
GRANT SELECT ON public.admin_guest_shop_orders TO authenticated, service_role;

COMMENT ON VIEW public.admin_guest_shop_orders IS
    'Admin-only, content-free guest order view with safe financial and inventory-cost attribution fields.';
