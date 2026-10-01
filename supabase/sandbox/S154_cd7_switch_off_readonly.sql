-- S154 卡 7「沙箱CD7」游客开关关闭回读。Codex 不执行。全文只有一条 SELECT。
-- 先在 Admin Studio 打开「沙箱CD7」，取消「允许游客购买」并保存，再跑本文件。
-- 规格的 allow_guest_purchase 不是空时会盖过商品开关，规格上如果单独勾了也要取消。
-- 不建单，不改库存，不改开关，不付款，不下架。不选出卡密、联系人、IP、凭证或支付地址。
-- 期望正好 1 行。把整行贴回，尤其 switch_verdict。
-- switch_verdict 以「游客开关已关」开头才算完成。写着「还开着」时不要用 SQL 关。
-- 归还回读当时：1 笔未付款单、1 笔支付行、1 笔已释放预占、非共享 available 6、held 0、两级 stock_count 都是 6。

WITH anchor AS (
    SELECT
        '5f940176-8059-443a-b5fd-79adc883a810'::UUID AS product_id,
        'c955f03a-8cd6-44b8-b751-06e2ad66d4cd'::UUID AS sku_id
),
product AS (
    SELECT
        p.id AS product_id,
        BTRIM(p.name) AS product_name,
        p.is_active IS TRUE AS product_active,
        p.allow_guest_purchase AS product_allow_guest,
        p.stock_count AS product_stock_count,
        s.id AS sku_id,
        BTRIM(s.sku_name) AS sku_name,
        s.is_active IS TRUE AS sku_active,
        s.allow_guest_purchase AS sku_allow_guest,
        s.price_points,
        s.stock_count AS sku_stock_count,
        COALESCE(s.allow_guest_purchase, p.allow_guest_purchase, false) AS effective_guest,
        (p.id IS NOT NULL AND s.id IS NOT NULL) AS target_present
    FROM anchor a
    LEFT JOIN public.shop_products p ON p.id = a.product_id
    LEFT JOIN public.shop_product_skus s
        ON s.id = a.sku_id
       AND s.product_id = p.id
),
orders AS (
    SELECT
        o.id,
        o.payment_status
    FROM anchor a
    JOIN public.guest_shop_orders o
        ON o.product_id = a.product_id
        OR o.sku_id = a.sku_id
    WHERE o.source_channel = 'website_guest'
),
order_rollup AS (
    SELECT
        COUNT(*) AS guest_orders_on_product,
        COUNT(*) FILTER (
            WHERE LOWER(COALESCE(payment_status, '')) IN ('paid', 'confirmed', 'success')
        ) AS paid_like_orders
    FROM orders
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
    FROM anchor a
    JOIN public.guest_shop_inventory_reservations r
        ON r.product_id = a.product_id
        OR r.sku_id = a.sku_id
),
inventory AS (
    SELECT
        COUNT(*) FILTER (
            WHERE i.status = 'available'
              AND COALESCE(i.is_shared, false) = false
        ) AS nonshared_available,
        COUNT(*) FILTER (WHERE COALESCE(i.is_shared, false)) AS shared_rows,
        COUNT(*) FILTER (
            WHERE COALESCE(i.is_shared, false) = false
              AND i.status <> 'available'
        ) AS nonshared_other
    FROM product p
    JOIN public.shop_inventory i ON i.product_id = p.product_id
    WHERE p.sku_id IS NOT NULL
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
    WHERE p.sku_id IS NOT NULL
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
shaped AS (
SELECT
    p.target_present,
    p.product_name,
    p.sku_name,
    p.price_points,
    p.product_active,
    p.sku_active,
    p.product_allow_guest,
    p.sku_allow_guest,
    p.effective_guest,
    (
        p.product_id IS NOT NULL
        AND p.sku_id IS NOT NULL
        AND p.effective_guest IS NOT TRUE
    ) AS guest_switch_off,
    COALESCE(ord.guest_orders_on_product, 0) AS guest_orders_on_product,
    COALESCE(ord.paid_like_orders, 0) AS paid_like_orders,
    COALESCE(pay.payment_orders_on_product, 0) AS payment_orders_on_product,
    COALESCE(pay.paid_like_payment_orders, 0) AS paid_like_payment_orders,
    COALESCE(ev.confirmed_like_events, 0) AS confirmed_like_events,
    COALESCE(r.reservations_on_product, 0) AS reservations_on_product,
    COALESCE(r.held_reservation_rows, 0) AS held_reservation_rows,
    COALESCE(r.released_reservation_rows, 0) AS released_reservation_rows,
    COALESCE(i.nonshared_available, 0) AS nonshared_available,
    COALESCE(h.guest_held_reserve, 0) AS guest_held_reserve,
    COALESCE(i.shared_rows, 0) AS shared_rows,
    COALESCE(i.nonshared_other, 0) AS nonshared_other,
    p.product_stock_count,
    p.sku_stock_count,
    CASE
        WHEN p.product_id IS NULL OR p.sku_id IS NULL
            THEN '没有找到已确认的沙箱CD7。不要新建，不要付款。'
        WHEN p.product_name IS DISTINCT FROM '沙箱CD7'
          OR p.sku_name IS DISTINCT FROM '默认规格'
          OR p.price_points IS DISTINCT FROM 10.00
            THEN '商品名、规格名或单价已变。不要为了关开关去改这些，把本行贴回。'
        WHEN COALESCE(ord.paid_like_orders, 0) <> 0
          OR COALESCE(pay.paid_like_payment_orders, 0) <> 0
          OR COALESCE(ev.confirmed_like_events, 0) <> 0
            THEN '出现了付款。不要当成开关已关，不要发货，不要再付款，把本行贴回。'
        WHEN COALESCE(ord.guest_orders_on_product, 0) <> 1
          OR COALESCE(pay.payment_orders_on_product, 0) <> 1
          OR COALESCE(r.reservations_on_product, 0) <> 1
          OR COALESCE(r.held_reservation_rows, 0) <> 0
          OR COALESCE(r.released_reservation_rows, 0) <> 1
          OR COALESCE(i.nonshared_available, 0) <> 6
          OR COALESCE(h.guest_held_reserve, 0) <> 0
          OR COALESCE(i.shared_rows, 0) <> 0
          OR COALESCE(i.nonshared_other, 0) <> 0
          OR p.product_stock_count IS DISTINCT FROM 6
          OR p.sku_stock_count IS DISTINCT FROM 6
            THEN '库存或订单状态和归还回读不一致。不要再试，不要付款，不要改库存，把本行贴回。'
        WHEN p.effective_guest IS TRUE
            THEN '游客开关还开着。请在 Admin Studio 取消「允许游客购买」并保存。规格上如果单独勾了，也要取消。不要用 SQL 关。本脚本不改任何行。'
        WHEN p.product_active IS TRUE
            THEN '游客开关已关。商品仍上架，登录积分商城可能还能看到这 6 张。本步不要求下架。不要再打开游客开关，不要建单，不要付款。'
        ELSE '游客开关已关，商品也未上架。不要再打开，不要建单，不要付款。'
    END AS switch_verdict
FROM product p
CROSS JOIN order_rollup ord
CROSS JOIN payments pay
CROSS JOIN payment_events ev
CROSS JOIN reservations r
CROSS JOIN inventory i
CROSS JOIN held h
)
SELECT
    target_present,
    product_name,
    sku_name,
    price_points,
    product_active,
    sku_active,
    product_allow_guest,
    sku_allow_guest,
    effective_guest,
    guest_switch_off,
    guest_orders_on_product,
    paid_like_orders,
    payment_orders_on_product,
    paid_like_payment_orders,
    confirmed_like_events,
    reservations_on_product,
    held_reservation_rows,
    released_reservation_rows,
    nonshared_available,
    guest_held_reserve,
    shared_rows,
    nonshared_other,
    product_stock_count,
    sku_stock_count,
    switch_verdict
FROM shaped;
