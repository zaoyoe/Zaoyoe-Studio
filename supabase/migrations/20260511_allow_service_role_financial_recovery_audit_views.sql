-- Allow service_role automation to read financial recovery audit views.
-- These views remain read-only. Browser access still requires public.is_admin(),
-- while backend readiness and scheduled recovery drills can use service_role.

DROP VIEW IF EXISTS public.admin_financial_recovery_audit_summary_view;
DROP VIEW IF EXISTS public.admin_shop_inventory_recovery_audit_view;
DROP VIEW IF EXISTS public.admin_points_balance_recovery_audit_view;
DROP VIEW IF EXISTS public.admin_payment_order_recovery_audit_view;

CREATE OR REPLACE VIEW public.admin_payment_order_recovery_audit_view
WITH (security_invoker = on) AS
WITH redemption_ledger AS (
    SELECT
        REPLACE(reference_id, 'redeem_', '') AS redemption_code,
        user_id,
        COALESCE(NULLIF(BTRIM(site), ''), 'cn') AS site,
        COUNT(*) AS ledger_credit_count,
        ROUND(COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0), 2) AS ledger_credit_amount,
        MAX(created_at) AS last_ledger_credit_at
    FROM public.points_ledger
    WHERE reference_id LIKE 'redeem_%'
    GROUP BY REPLACE(reference_id, 'redeem_', ''), user_id, COALESCE(NULLIF(BTRIM(site), ''), 'cn')
)
SELECT
    po.id AS payment_order_id,
    po.site,
    po.provider,
    po.provider_order_no,
    po.checkout_session_id,
    po.user_id,
    po.package_id,
    po.package_name,
    po.status,
    po.expected_amount,
    po.paid_amount,
    po.points_amount,
    po.redemption_code,
    rc.status AS redemption_code_status,
    rc.used_by AS redemption_used_by,
    rc.used_at AS redemption_used_at,
    rl.ledger_credit_count,
    rl.ledger_credit_amount,
    rl.last_ledger_credit_at,
    po.sign_verified,
    po.amount_verified,
    po.paid_at,
    po.created_at,
    po.updated_at,
    audit.flags AS recovery_flags,
    CASE
        WHEN CARDINALITY(audit.flags) = 0 THEN 'healthy'
        ELSE 'review_required'
    END AS recovery_status
FROM public.payment_orders po
LEFT JOIN public.redemption_codes rc
    ON rc.code = po.redemption_code
LEFT JOIN redemption_ledger rl
    ON rl.redemption_code = po.redemption_code
   AND rl.user_id = po.user_id
   AND rl.site = COALESCE(NULLIF(BTRIM(po.site), ''), 'cn')
CROSS JOIN LATERAL (
    SELECT ARRAY_REMOVE(ARRAY[
        CASE
            WHEN LOWER(COALESCE(po.status, '')) IN ('paid', 'redeemed')
             AND NULLIF(BTRIM(COALESCE(po.redemption_code, '')), '') IS NULL
                THEN 'paid_without_redemption_code'
        END,
        CASE
            WHEN LOWER(COALESCE(po.status, '')) IN ('paid', 'redeemed')
             AND NULLIF(BTRIM(COALESCE(po.redemption_code, '')), '') IS NOT NULL
             AND rc.code IS NULL
                THEN 'paid_without_redemption_record'
        END,
        CASE
            WHEN LOWER(COALESCE(po.status, '')) = 'amount_mismatch'
              OR (
                    po.paid_amount IS NOT NULL
                AND po.expected_amount IS NOT NULL
                AND ABS(ROUND(COALESCE(po.paid_amount, 0)::NUMERIC, 2) - ROUND(COALESCE(po.expected_amount, 0)::NUMERIC, 2)) > 0.01
              )
                THEN 'amount_mismatch'
        END,
        CASE
            WHEN (
                    LOWER(COALESCE(po.status, '')) = 'redeemed'
                 OR LOWER(COALESCE(rc.status, '')) = 'used'
                 )
             AND COALESCE(rl.ledger_credit_count, 0) = 0
                THEN 'redeemed_without_ledger_credit'
        END,
        CASE
            WHEN COALESCE(rl.ledger_credit_count, 0) > 0
             AND ROUND(COALESCE(po.points_amount, 0)::NUMERIC, 2) > 0
             AND ABS(COALESCE(rl.ledger_credit_amount, 0) - ROUND(COALESCE(po.points_amount, 0)::NUMERIC, 2)) > 0.01
                THEN 'ledger_credit_amount_mismatch'
        END
    ], NULL)::TEXT[] AS flags
) audit
WHERE COALESCE(auth.role(), '') = 'service_role' OR public.is_admin();

CREATE OR REPLACE VIEW public.admin_points_balance_recovery_audit_view
WITH (security_invoker = on) AS
WITH ledger_summary AS (
    SELECT
        user_id,
        COALESCE(NULLIF(BTRIM(site), ''), 'cn') AS site,
        COUNT(*) AS ledger_entry_count,
        ROUND(COALESCE(SUM(amount), 0), 2) AS ledger_total,
        MIN(created_at) AS first_ledger_at,
        MAX(created_at) AS last_ledger_at
    FROM public.points_ledger
    GROUP BY user_id, COALESCE(NULLIF(BTRIM(site), ''), 'cn')
),
balance_summary AS (
    SELECT
        user_id,
        COALESCE(NULLIF(BTRIM(site), ''), 'cn') AS site,
        ROUND(COALESCE(paid_balance, 0)::NUMERIC, 2) AS paid_balance,
        ROUND(COALESCE(bonus_balance, 0)::NUMERIC, 2) AS bonus_balance,
        ROUND(COALESCE(paid_balance, 0)::NUMERIC + COALESCE(bonus_balance, 0)::NUMERIC, 2) AS computed_total_balance,
        version,
        updated_at
    FROM public.points_balance
)
SELECT
    COALESCE(b.user_id, l.user_id) AS user_id,
    COALESCE(b.site, l.site, 'cn') AS site,
    b.paid_balance,
    b.bonus_balance,
    b.computed_total_balance,
    b.version,
    b.updated_at AS balance_updated_at,
    COALESCE(l.ledger_entry_count, 0) AS ledger_entry_count,
    COALESCE(l.ledger_total, 0) AS ledger_total,
    ROUND(COALESCE(b.computed_total_balance, 0) - COALESCE(l.ledger_total, 0), 2) AS balance_ledger_delta,
    l.first_ledger_at,
    l.last_ledger_at,
    audit.flags AS recovery_flags,
    CASE
        WHEN CARDINALITY(audit.flags) = 0 THEN 'healthy'
        ELSE 'review_required'
    END AS recovery_status
FROM balance_summary b
FULL OUTER JOIN ledger_summary l
    ON l.user_id = b.user_id
   AND l.site = b.site
CROSS JOIN LATERAL (
    SELECT ARRAY_REMOVE(ARRAY[
        CASE
            WHEN b.user_id IS NULL
             AND ABS(COALESCE(l.ledger_total, 0)) > 0.01
                THEN 'ledger_without_balance'
        END,
        CASE
            WHEN l.user_id IS NULL
             AND ABS(COALESCE(b.computed_total_balance, 0)) > 0.01
                THEN 'balance_without_ledger'
        END,
        CASE
            WHEN b.user_id IS NOT NULL
             AND l.user_id IS NOT NULL
             AND ABS(COALESCE(b.computed_total_balance, 0) - COALESCE(l.ledger_total, 0)) > 0.01
                THEN 'balance_ledger_mismatch'
        END,
        CASE
            WHEN COALESCE(b.computed_total_balance, 0) < 0
                THEN 'negative_balance'
        END
    ], NULL)::TEXT[] AS flags
) audit
WHERE COALESCE(auth.role(), '') = 'service_role' OR public.is_admin();

CREATE OR REPLACE VIEW public.admin_shop_inventory_recovery_audit_view
WITH (security_invoker = on) AS
WITH order_item_inventory AS (
    SELECT
        o.id AS order_id,
        COUNT(soi.id) AS order_item_count,
        COUNT(soi.inventory_id) AS inventory_item_count,
        COUNT(soi.inventory_id) FILTER (WHERE i.status = 'sold') AS sold_inventory_item_count,
        COUNT(soi.inventory_id) FILTER (WHERE i.id IS NOT NULL AND i.buyer_id IS DISTINCT FROM o.user_id) AS buyer_mismatch_count,
        COUNT(soi.inventory_id) FILTER (WHERE i.id IS NOT NULL AND i.status IS DISTINCT FROM 'sold') AS status_mismatch_count
    FROM public.shop_orders o
    LEFT JOIN public.shop_order_items soi
        ON soi.order_id = o.id
    LEFT JOIN public.shop_inventory i
        ON i.id = soi.inventory_id
    GROUP BY o.id
),
shop_ledger_debits AS (
    SELECT
        SUBSTRING(reference_id FROM '^SHOP_ORDER_([0-9a-fA-F-]{36})$')::UUID AS order_id,
        COUNT(*) AS ledger_debit_count,
        ROUND(ABS(COALESCE(SUM(amount) FILTER (WHERE amount < 0), 0)), 2) AS ledger_debit_amount,
        MAX(created_at) AS last_ledger_debit_at
    FROM public.points_ledger
    WHERE reference_id ~* '^SHOP_ORDER_[0-9a-f-]{36}$'
    GROUP BY SUBSTRING(reference_id FROM '^SHOP_ORDER_([0-9a-fA-F-]{36})$')::UUID
)
SELECT
    o.id AS shop_order_id,
    o.site,
    o.user_id,
    o.product_id,
    p.name AS product_name,
    COALESCE(NULLIF(BTRIM(p.delivery_type), ''), 'KEY') AS delivery_type,
    o.inventory_id,
    o.item_count,
    o.price_paid,
    o.total_price,
    o.refund_status,
    o.delivery_status,
    o.delivery_task_id,
    o.created_at,
    COALESCE(items.order_item_count, 0) AS order_item_count,
    COALESCE(items.inventory_item_count, 0) AS inventory_item_count,
    COALESCE(items.sold_inventory_item_count, 0) AS sold_inventory_item_count,
    COALESCE(items.buyer_mismatch_count, 0) AS buyer_mismatch_count,
    COALESCE(items.status_mismatch_count, 0) AS status_mismatch_count,
    COALESCE(debits.ledger_debit_count, 0) AS ledger_debit_count,
    COALESCE(debits.ledger_debit_amount, 0) AS ledger_debit_amount,
    debits.last_ledger_debit_at,
    audit.flags AS recovery_flags,
    CASE
        WHEN CARDINALITY(audit.flags) = 0 THEN 'healthy'
        ELSE 'review_required'
    END AS recovery_status
FROM public.shop_orders o
LEFT JOIN public.shop_products p
    ON p.id = o.product_id
LEFT JOIN order_item_inventory items
    ON items.order_id = o.id
LEFT JOIN shop_ledger_debits debits
    ON debits.order_id = o.id
CROSS JOIN LATERAL (
    SELECT ARRAY_REMOVE(ARRAY[
        CASE
            WHEN COALESCE(o.price_paid, 0) > 0
             AND LOWER(COALESCE(o.refund_status, 'none')) <> 'refunded'
             AND COALESCE(debits.ledger_debit_count, 0) = 0
                THEN 'paid_order_without_ledger_debit'
        END,
        CASE
            WHEN COALESCE(debits.ledger_debit_count, 0) > 0
             AND ABS(COALESCE(debits.ledger_debit_amount, 0) - ROUND(COALESCE(o.price_paid, 0)::NUMERIC, 2)) > 0.01
                THEN 'ledger_debit_amount_mismatch'
        END,
        CASE
            WHEN COALESCE(NULLIF(BTRIM(p.delivery_type), ''), 'KEY') = 'KEY'
             AND COALESCE(o.item_count, 1) > 0
             AND COALESCE(items.inventory_item_count, 0) < COALESCE(o.item_count, 1)
                THEN 'key_order_missing_inventory_items'
        END,
        CASE
            WHEN COALESCE(items.buyer_mismatch_count, 0) > 0
                THEN 'sold_inventory_buyer_mismatch'
        END,
        CASE
            WHEN COALESCE(items.status_mismatch_count, 0) > 0
                THEN 'sold_inventory_status_mismatch'
        END
    ], NULL)::TEXT[] AS flags
) audit
WHERE COALESCE(auth.role(), '') = 'service_role' OR public.is_admin();

CREATE OR REPLACE VIEW public.admin_financial_recovery_audit_summary_view
WITH (security_invoker = on) AS
SELECT
    'payment_orders' AS area,
    COUNT(*)::BIGINT AS total_rows,
    COUNT(*) FILTER (WHERE recovery_status <> 'healthy')::BIGINT AS review_required_rows,
    MAX(updated_at) AS latest_activity_at
FROM public.admin_payment_order_recovery_audit_view
UNION ALL
SELECT
    'points_balance' AS area,
    COUNT(*)::BIGINT AS total_rows,
    COUNT(*) FILTER (WHERE recovery_status <> 'healthy')::BIGINT AS review_required_rows,
    MAX(COALESCE(balance_updated_at, last_ledger_at)) AS latest_activity_at
FROM public.admin_points_balance_recovery_audit_view
UNION ALL
SELECT
    'shop_inventory' AS area,
    COUNT(*)::BIGINT AS total_rows,
    COUNT(*) FILTER (WHERE recovery_status <> 'healthy')::BIGINT AS review_required_rows,
    MAX(created_at) AS latest_activity_at
FROM public.admin_shop_inventory_recovery_audit_view;

GRANT SELECT ON public.admin_payment_order_recovery_audit_view TO authenticated, service_role;
GRANT SELECT ON public.admin_points_balance_recovery_audit_view TO authenticated, service_role;
GRANT SELECT ON public.admin_shop_inventory_recovery_audit_view TO authenticated, service_role;
GRANT SELECT ON public.admin_financial_recovery_audit_summary_view TO authenticated, service_role;

COMMENT ON VIEW public.admin_payment_order_recovery_audit_view IS 'Admin or service_role payment recovery audit view linking paid orders, redemption codes, and ledger credits.';
COMMENT ON VIEW public.admin_points_balance_recovery_audit_view IS 'Admin or service_role points recovery audit view comparing points_balance totals against immutable points_ledger sums.';
COMMENT ON VIEW public.admin_shop_inventory_recovery_audit_view IS 'Admin or service_role shop recovery audit view linking orders, inventory item state, and ledger debits.';
COMMENT ON VIEW public.admin_financial_recovery_audit_summary_view IS 'Admin or service_role rollup of payment, points, and shop recovery audit findings.';
