-- S154 卡 7「沙箱CD7」促销持有回读。Codex 不执行。全文只有一条 SELECT。
-- 建单前先跑本文件。判语以「还没有这 1 笔」开头不是失败。
-- 下一笔建单之后，600 秒内再跑本文件。以「持有已闭合」开头才算这半步通过。
-- 过了截止但仍是 held，不是归还失败。不要提前截止时间，不要付款，不要第二笔。
-- 不改行，不改库存，不改券，不改预算，不开商品。
-- 不选出卡密、联系人、IP、凭证或支付链接。订单号可以保留。
-- 找不到商品也返回一行。0 行不是预期。把整行贴回。

WITH target AS (
    SELECT
        '5f940176-8059-443a-b5fd-79adc883a810'::UUID AS product_id,
        'c955f03a-8cd6-44b8-b751-06e2ad66d4cd'::UUID AS sku_id,
        TIMESTAMPTZ '2026-09-22 06:05:00+00' AS attempt_not_before
),
product AS (
    SELECT
        t.product_id,
        t.sku_id,
        t.attempt_not_before,
        (p.id IS NOT NULL AND s.id IS NOT NULL) AS target_present,
        BTRIM(p.name) AS product_name,
        BTRIM(s.sku_name) AS sku_name,
        s.price_points,
        p.stock_count AS product_stock_count,
        s.stock_count AS sku_stock_count
    FROM target t
    LEFT JOIN public.shop_products p ON p.id = t.product_id
    LEFT JOIN public.shop_product_skus s
        ON s.id = t.sku_id
       AND s.product_id = p.id
),
orders AS (
    SELECT
        o.id,
        o.order_no,
        o.created_at,
        o.expires_at,
        o.site,
        o.quantity,
        o.payment_status,
        o.fulfillment_status,
        o.refund_status,
        o.reservation_status,
        o.discount_amount,
        o.list_unit_amount,
        o.unit_amount,
        o.total_amount,
        o.payment_fee_amount,
        (NULLIF(BTRIM(COALESCE(o.discount_code, '')), '') IS NOT NULL) AS has_discount_code,
        (UPPER(BTRIM(COALESCE(o.discount_code, ''))) = 'SBXPROMO10') AS discount_code_is_sbxpromo10,
        CASE
            WHEN o.last_error_code IS NULL THEN NULL
            WHEN o.last_error_code ~ '^[A-Za-z0-9_]{1,64}$' THEN o.last_error_code
            ELSE '[redacted]'
        END AS safe_last_error_code
    FROM product p
    JOIN public.guest_shop_orders o
        ON o.product_id = p.product_id
        OR o.sku_id = p.sku_id
    WHERE p.target_present
      AND o.source_channel = 'website_guest'
),
order_rollup AS (
    SELECT
        COUNT(*) AS guest_orders_on_product,
        COUNT(*) FILTER (
            WHERE created_at >= (SELECT attempt_not_before FROM product)
        ) AS orders_after_attempt,
        COUNT(*) FILTER (
            WHERE payment_status IN ('pending', 'created', 'review')
              AND reservation_status = 'held'
              AND expires_at > clock_timestamp()
        ) AS live_unpaid_holds,
        COUNT(*) FILTER (
            WHERE LOWER(COALESCE(payment_status, '')) IN ('paid', 'confirmed', 'success')
        ) AS paid_like_orders,
        COUNT(*) FILTER (WHERE has_discount_code) AS discounted_orders,
        COALESCE(ROUND(SUM(discount_amount) FILTER (WHERE has_discount_code), 2), 0) AS discount_amount_sum
    FROM orders
),
newest AS (
    SELECT *
    FROM orders
    ORDER BY created_at DESC, order_no DESC
    LIMIT 1
),
newest_reservation AS (
    SELECT
        r.status AS reservation_row_status,
        r.reserved_until,
        CASE
            WHEN r.release_reason IS NULL THEN NULL
            WHEN r.release_reason ~ '^[A-Za-z0-9_]{1,64}$' THEN r.release_reason
            ELSE '[redacted]'
        END AS safe_release_reason,
        i.status AS inventory_status
    FROM newest n
    JOIN public.guest_shop_inventory_reservations r ON r.order_id = n.id
    LEFT JOIN public.shop_inventory i ON i.id = r.inventory_id
    ORDER BY r.created_at DESC
    LIMIT 1
),
payments AS (
    SELECT
        COUNT(*) AS payment_orders_on_product,
        COUNT(*) FILTER (
            WHERE LOWER(COALESCE(p.status, '')) IN (
                'confirmed', 'paid', 'success', 'trade_success', 'trade_finished'
            )
        ) AS paid_like_payment_orders
    FROM orders o
    JOIN public.guest_shop_payment_orders p ON p.guest_order_id = o.id
),
payment_events AS (
    SELECT COUNT(*) AS confirmed_like_events
    FROM orders o
    JOIN public.guest_shop_payment_orders p ON p.guest_order_id = o.id
    JOIN public.guest_shop_payment_events e ON e.payment_order_id = p.id
    WHERE e.final_status_verified
       OR e.amount_verified
       OR LOWER(COALESCE(e.observed_status, '')) IN (
           'confirmed', 'paid', 'success', 'trade_success', 'trade_finished'
       )
),
reservations AS (
    SELECT
        COUNT(*) AS reservations_on_product,
        COUNT(*) FILTER (WHERE r.status = 'held') AS held_reservation_rows,
        COUNT(*) FILTER (WHERE r.status = 'released') AS released_reservation_rows
    FROM product p
    JOIN public.guest_shop_inventory_reservations r
        ON r.product_id = p.product_id
        OR r.sku_id = p.sku_id
    WHERE p.target_present
),
available AS (
    SELECT COUNT(*) AS nonshared_available
    FROM product p
    JOIN public.shop_inventory i ON i.product_id = p.product_id
    WHERE p.target_present
      AND i.status = 'available'
      AND COALESCE(i.is_shared, false) = false
      AND EXISTS (
          SELECT 1
          FROM public.fn_resolve_shop_sku_inventory_sources(p.sku_id, 'cn') src
          WHERE src.source_sku_id = i.sku_id
             OR (src.source_is_default IS TRUE AND i.sku_id IS NULL)
      )
),
held AS (
    SELECT COUNT(*) AS guest_held_reserve
    FROM product p
    JOIN public.guest_shop_inventory_reservations r ON r.product_id = p.product_id
    JOIN public.guest_shop_orders o ON o.id = r.order_id
    JOIN public.shop_inventory i ON i.id = r.inventory_id
    WHERE p.target_present
      AND r.status = 'held'
      AND o.source_channel = 'website_guest'
      AND i.status = 'reserve'
      AND COALESCE(i.is_shared, false) = false
      AND EXISTS (
          SELECT 1
          FROM public.fn_resolve_shop_sku_inventory_sources(p.sku_id, 'cn') src
          WHERE src.source_sku_id = r.inventory_source_sku_id
      )
),
ledger AS (
    SELECT
        COUNT(*) AS redemption_rows,
        COUNT(*) FILTER (WHERE r.returned_at IS NULL) AS open_redemptions,
        COUNT(*) FILTER (WHERE r.returned_at IS NOT NULL) AS returned_redemptions,
        COALESCE(ROUND(SUM(r.discount_amount) FILTER (WHERE r.returned_at IS NULL), 2), 0) AS open_discount_amount
    FROM orders o
    JOIN public.guest_shop_discount_redemptions r ON r.order_id = o.id
),
coupon_fixed AS (
    SELECT
        COUNT(*) AS coupon_count,
        CASE WHEN COUNT(*) = 1 THEN MAX(d.guest_used_count) END AS guest_used_count,
        CASE WHEN COUNT(*) = 1 THEN MAX(d.used_count) END AS coupon_used_count,
        CASE WHEN COUNT(*) = 1 THEN ROUND(MAX(d.guest_discount_total), 2) END AS guest_discount_total
    FROM public.discount_codes d
    WHERE UPPER(BTRIM(d.code)) = 'SBXPROMO10'
),
budget AS (
    SELECT
        cn.budget_date AS cn_budget_date,
        (cn.budget_date = (clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::DATE) AS cn_budget_is_today,
        ROUND(COALESCE(cn.spent_cny, 0), 2) AS cn_spent_raw,
        CASE
            WHEN cn.budget_date = (clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::DATE
                THEN ROUND(COALESCE(cn.spent_cny, 0), 2)
            ELSE 0
        END AS cn_effective_spent
    FROM (SELECT 1) AS anchor
    LEFT JOIN public.guest_shop_promo_budget cn ON cn.site = 'cn'
),
facts AS (
    SELECT
        p.target_present,
        p.product_name,
        p.sku_name,
        p.price_points,
        p.product_stock_count,
        p.sku_stock_count,
        COALESCE(ord.guest_orders_on_product, 0) AS guest_orders_on_product,
        COALESCE(ord.orders_after_attempt, 0) AS orders_after_attempt,
        COALESCE(ord.live_unpaid_holds, 0) AS live_unpaid_holds,
        COALESCE(ord.paid_like_orders, 0) AS paid_like_orders,
        COALESCE(ord.discounted_orders, 0) AS discounted_orders,
        COALESCE(ord.discount_amount_sum, 0) AS discount_amount_sum,
        n.order_no AS newest_order_no,
        n.created_at AS newest_created_at,
        n.expires_at AS newest_expires_at,
        ROUND(EXTRACT(EPOCH FROM (n.expires_at - n.created_at))::numeric, 3) AS ttl_seconds,
        ROUND(EXTRACT(EPOCH FROM (n.expires_at - clock_timestamp()))::numeric, 3) AS seconds_until_expiry,
        (n.expires_at IS NOT NULL AND n.expires_at > clock_timestamp()) AS within_ttl,
        n.site AS newest_site,
        n.quantity AS newest_quantity,
        n.payment_status AS newest_payment_status,
        n.fulfillment_status AS newest_fulfillment_status,
        n.refund_status AS newest_refund_status,
        n.reservation_status AS newest_reservation_status,
        ROUND(n.discount_amount, 2) AS newest_discount_amount,
        ROUND(n.list_unit_amount, 2) AS newest_list_unit_amount,
        ROUND(n.unit_amount, 2) AS newest_unit_amount,
        ROUND(n.total_amount, 2) AS newest_total_amount,
        ROUND(COALESCE(n.payment_fee_amount, 0), 2) AS newest_payment_fee_amount,
        n.has_discount_code AS newest_has_discount_code,
        n.discount_code_is_sbxpromo10 AS newest_discount_code_is_sbxpromo10,
        n.safe_last_error_code AS newest_safe_last_error_code,
        nr.reserved_until AS newest_reserved_until,
        (nr.reserved_until IS NOT NULL AND nr.reserved_until = n.expires_at) AS reserved_until_matches_expires,
        nr.reservation_row_status AS newest_reservation_row_status,
        nr.inventory_status AS newest_inventory_status,
        nr.safe_release_reason AS newest_safe_release_reason,
        COALESCE(pay.payment_orders_on_product, 0) AS payment_orders_on_product,
        COALESCE(pay.paid_like_payment_orders, 0) AS paid_like_payment_orders,
        COALESCE(ev.confirmed_like_events, 0) AS confirmed_like_events,
        COALESCE(res.reservations_on_product, 0) AS reservations_on_product,
        COALESCE(res.held_reservation_rows, 0) AS held_reservation_rows,
        COALESCE(res.released_reservation_rows, 0) AS released_reservation_rows,
        COALESCE(av.nonshared_available, 0) AS nonshared_available,
        COALESCE(h.guest_held_reserve, 0) AS guest_held_reserve,
        COALESCE(led.redemption_rows, 0) AS redemption_rows,
        COALESCE(led.open_redemptions, 0) AS open_redemptions,
        COALESCE(led.returned_redemptions, 0) AS returned_redemptions,
        COALESCE(led.open_discount_amount, 0) AS open_discount_amount,
        COALESCE(cp.coupon_count, 0) AS coupon_count,
        cp.guest_used_count,
        cp.coupon_used_count,
        cp.guest_discount_total,
        bud.cn_budget_date,
        bud.cn_budget_is_today,
        bud.cn_spent_raw,
        bud.cn_effective_spent,
        (
            COALESCE(ord.guest_orders_on_product, 0) = 1
            AND COALESCE(res.held_reservation_rows, 0) = 0
            AND COALESCE(res.released_reservation_rows, 0) = 1
            AND COALESCE(h.guest_held_reserve, 0) = 0
            AND COALESCE(av.nonshared_available, 0) = 6
            AND n.reservation_status = 'released'
            AND nr.inventory_status = 'available'
        ) AS inventory_returned,
        (
            COALESCE(led.returned_redemptions, 0) = 1
            AND COALESCE(led.open_redemptions, 0) = 0
            AND COALESCE(led.open_discount_amount, 0) = 0
            AND cp.guest_used_count = 0
            AND cp.coupon_used_count = 0
            AND cp.guest_discount_total = 0
            AND bud.cn_budget_is_today IS TRUE
            AND bud.cn_spent_raw = 0
            AND bud.cn_effective_spent = 0
        ) AS budget_returned
    FROM product p
    LEFT JOIN order_rollup ord ON TRUE
    LEFT JOIN newest n ON TRUE
    LEFT JOIN newest_reservation nr ON TRUE
    LEFT JOIN payments pay ON TRUE
    LEFT JOIN payment_events ev ON TRUE
    LEFT JOIN reservations res ON TRUE
    LEFT JOIN available av ON TRUE
    LEFT JOIN held h ON TRUE
    LEFT JOIN ledger led ON TRUE
    LEFT JOIN coupon_fixed cp ON TRUE
    LEFT JOIN budget bud ON TRUE
)
SELECT
    target_present,
    product_name,
    sku_name,
    price_points,
    guest_orders_on_product,
    orders_after_attempt,
    live_unpaid_holds,
    paid_like_orders,
    discounted_orders,
    discount_amount_sum,
    newest_order_no,
    newest_created_at,
    newest_expires_at,
    ttl_seconds,
    seconds_until_expiry,
    within_ttl,
    newest_site,
    newest_quantity,
    newest_payment_status,
    newest_fulfillment_status,
    newest_refund_status,
    newest_reservation_status,
    newest_discount_amount,
    newest_list_unit_amount,
    newest_unit_amount,
    newest_total_amount,
    newest_payment_fee_amount,
    newest_has_discount_code,
    newest_discount_code_is_sbxpromo10,
    newest_safe_last_error_code,
    newest_reserved_until,
    reserved_until_matches_expires,
    newest_reservation_row_status,
    newest_inventory_status,
    newest_safe_release_reason,
    payment_orders_on_product,
    paid_like_payment_orders,
    confirmed_like_events,
    reservations_on_product,
    held_reservation_rows,
    released_reservation_rows,
    nonshared_available,
    guest_held_reserve,
    product_stock_count,
    sku_stock_count,
    redemption_rows,
    open_redemptions,
    returned_redemptions,
    open_discount_amount,
    coupon_count,
    guest_used_count,
    coupon_used_count,
    guest_discount_total,
    cn_budget_date,
    cn_budget_is_today,
    cn_spent_raw,
    cn_effective_spent,
    inventory_returned,
    budget_returned,
    CASE
        WHEN NOT target_present THEN
            '商品或规格不在。不要建单，不要付款。'
        WHEN guest_orders_on_product = 0
         AND orders_after_attempt = 0
         AND live_unpaid_holds = 0
         AND paid_like_orders = 0
         AND discounted_orders = 0
         AND payment_orders_on_product = 0
         AND reservations_on_product = 0
         AND held_reservation_rows = 0
         AND released_reservation_rows = 0
         AND redemption_rows = 0 THEN
            '还没有这 1 笔。这不是失败，也不是卡 7 闭合。不要自行建单，不要付款。把本行贴回。'
        WHEN guest_orders_on_product = 1
         AND paid_like_orders = 0
         AND paid_like_payment_orders = 0
         AND confirmed_like_events = 0
         AND newest_reservation_status = 'held'
         AND held_reservation_rows = 1
         AND within_ttl IS NOT TRUE THEN
            '已过截止但仍是 held。这不是归还失败。不要手工改行，不要付款。请改跑到期回读。'
        WHEN guest_orders_on_product = 1
         AND orders_after_attempt = 1
         AND live_unpaid_holds = 1
         AND paid_like_orders = 0
         AND discounted_orders = 1
         AND discount_amount_sum = 1.00
         AND within_ttl IS TRUE
         AND ttl_seconds > 590
         AND ttl_seconds <= 600
         AND newest_site = 'cn'
         AND newest_quantity = 1
         AND newest_payment_status = 'pending'
         AND newest_fulfillment_status = 'pending'
         AND newest_refund_status = 'none'
         AND newest_reservation_status = 'held'
         AND newest_discount_amount = 1.00
         AND newest_list_unit_amount = 10.00
         AND newest_unit_amount = 9.00
         AND newest_total_amount >= 9.00
         AND newest_total_amount < 10.00
         AND newest_has_discount_code IS TRUE
         AND newest_discount_code_is_sbxpromo10 IS TRUE
         AND reserved_until_matches_expires IS TRUE
         AND payment_orders_on_product = 1
         AND paid_like_payment_orders = 0
         AND confirmed_like_events = 0
         AND reservations_on_product = 1
         AND held_reservation_rows = 1
         AND released_reservation_rows = 0
         AND nonshared_available = 5
         AND guest_held_reserve = 1
         AND newest_inventory_status = 'reserve'
         AND redemption_rows = 1
         AND open_redemptions = 1
         AND returned_redemptions = 0
         AND open_discount_amount = 1.00
         AND coupon_count = 1
         AND guest_used_count = 1
         AND coupon_used_count = 1
         AND guest_discount_total = 1.00
         AND cn_budget_is_today IS TRUE
         AND cn_effective_spent = 1.00
         AND inventory_returned IS FALSE
         AND budget_returned IS FALSE THEN
            '持有已闭合。1 笔未付款促销单，抵扣 1.00，商品净额 9.00，截止距 created_at 大于 590 秒且不超过 600 秒。不要付款，不要第二笔，不要提前截止时间。到期后再跑到期回读。这仍不是整卡 PASS。'
        WHEN inventory_returned IS TRUE OR budget_returned IS TRUE THEN
            '持有窗口已过并且至少一边已释放。这不是持有失败。请改跑到期回读。不要付款。'
        ELSE
            '和「还没有这 1 笔」或「持有已闭合」都不符。不要再 commit，不要付款，不要手工改行。把本行贴回。'

    END AS readback_verdict
FROM facts;
