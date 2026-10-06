-- S154 卡 9 已付款订单只读回读。Codex 不执行。请在 SQL 编辑器整文件执行本文件。
-- 这是支付后的回读，不是「段 6」应付探针。应付探针结果已由用户贴回：9.09。
-- 精确订单号定位，不读取最新订单。全文只有一条只读 SELECT，缺行仍返回一行。
-- 只输出订单、支付、库存和促销汇总状态，不输出买家信息、凭证、卡密或原始错误。
-- 订单不属于「沙箱CD7」或形状不匹配时金额列留空。
-- 把整行贴回；支付未进库不是失败，也不要重试付款、另建订单或踢 worker。

WITH target AS (
    SELECT
        'GS20260922120128080254E4D17280D'::text AS order_no,
        '5f940176-8059-443a-b5fd-79adc883a810'::uuid AS product_id,
        'c955f03a-8cd6-44b8-b751-06e2ad66d4cd'::uuid AS sku_id,
        'GS2026092207342938190F2B83D5ACF'::text AS prior_order_no,
        'c373b8b7-ebce-4709-b8d4-c192abd36869'::uuid AS cd3_product_id,
        'f928599e-30e8-4b3e-aa86-34ec09e2d659'::uuid AS cd3_sku_id
),
target_product AS (
    SELECT
        t.*,
        (p.id IS NOT NULL AND s.id IS NOT NULL) AS target_present,
        BTRIM(p.name) AS product_name,
        BTRIM(s.sku_name) AS sku_name,
        s.price_points
    FROM target t
    LEFT JOIN public.shop_products p ON p.id = t.product_id
    LEFT JOIN public.shop_product_skus s
        ON s.id = t.sku_id
       AND s.product_id = p.id
),
order_row AS (
    SELECT
        o.id,
        o.order_no,
        o.source_channel,
        o.product_id,
        o.sku_id,
        o.site,
        o.currency,
        o.quantity,
        o.payment_status,
        o.fulfillment_status,
        o.refund_status,
        o.reservation_status,
        o.expires_at,
        o.discount_code,
        o.list_unit_amount,
        o.discount_amount,
        o.unit_amount,
        o.total_amount,
        o.payment_fee_amount,
        o.paid_at,
        o.fulfilled_at,
        CASE
            WHEN o.last_error_code IS NULL THEN NULL
            WHEN o.last_error_code ~ '^[A-Za-z0-9_]{1,64}$' THEN o.last_error_code
            ELSE '[redacted]'
        END AS safe_last_error_code
    FROM target t
    JOIN public.guest_shop_orders o ON o.order_no = t.order_no
),
payment_rows AS (
    SELECT
        p.id,
        p.guest_order_id,
        p.merchant_order_no,
        p.site,
        p.currency,
        p.expected_amount,
        p.paid_amount,
        p.payment_fee,
        p.status,
        p.sign_verified,
        p.amount_verified,
        p.currency_verified,
        p.final_status_verified,
        p.expires_at,
        CASE
            WHEN p.last_error_code IS NULL THEN NULL
            WHEN p.last_error_code ~ '^[A-Za-z0-9_]{1,64}$' THEN p.last_error_code
            ELSE '[redacted]'
        END AS safe_last_error_code
    FROM order_row o
    JOIN public.guest_shop_payment_orders p ON p.guest_order_id = o.id
),
payment_rollup AS (
    SELECT
        COUNT(p.id)::bigint AS payment_row_count,
        COUNT(p.id) FILTER (WHERE p.status = 'confirmed')::bigint AS confirmed_payment_rows,
        BOOL_AND(p.guest_order_id = o.id) AS payment_order_id_matches,
        BOOL_AND(p.site = o.site) AS payment_site_matches,
        BOOL_AND(p.currency = o.currency) AS payment_currency_matches,
        BOOL_AND(ROUND(p.expected_amount, 2) = ROUND(o.total_amount, 2)) AS expected_matches_total,
        BOOL_AND(p.status IN ('pending', 'created')) AS payment_waiting,
        BOOL_OR(p.status = 'review') AS payment_review,
        BOOL_AND(p.sign_verified IS TRUE) FILTER (WHERE p.status = 'confirmed') AS sign_verified,
        BOOL_AND(p.amount_verified IS TRUE) FILTER (WHERE p.status = 'confirmed') AS amount_verified,
        BOOL_AND(p.currency_verified IS TRUE) FILTER (WHERE p.status = 'confirmed') AS currency_verified,
        BOOL_AND(p.final_status_verified IS TRUE) FILTER (WHERE p.status = 'confirmed') AS final_status_verified,
        CASE WHEN COUNT(p.id) = 1 THEN MAX(p.status) END AS payment_status,
        CASE WHEN COUNT(p.id) = 1 THEN MAX(p.expected_amount) END AS expected_amount,
        CASE WHEN COUNT(p.id) = 1 THEN MAX(p.paid_amount) END AS paid_amount,
        CASE WHEN COUNT(p.id) = 1 THEN MAX(p.payment_fee) END AS payment_fee,
        CASE WHEN COUNT(p.id) = 1 THEN MAX(p.site) END AS payment_site,
        CASE WHEN COUNT(p.id) = 1 THEN MAX(p.currency) END AS payment_currency,
        CASE WHEN COUNT(p.id) = 1 THEN MAX(p.expires_at) END AS payment_expires_at,
        CASE WHEN COUNT(p.id) = 1 THEN MAX(p.safe_last_error_code) END AS payment_safe_last_error_code
    FROM order_row o
    LEFT JOIN payment_rows p ON TRUE
),
reservation AS (
    SELECT
        COUNT(r.id)::bigint AS reservation_rows,
        COUNT(r.id) FILTER (WHERE r.status = 'held')::bigint AS held_rows,
        COUNT(r.id) FILTER (WHERE r.status = 'released')::bigint AS released_rows,
        COUNT(r.id) FILTER (WHERE r.status = 'consumed')::bigint AS consumed_rows,
        CASE WHEN COUNT(r.id) = 1 THEN MAX(r.status) END AS reservation_status,
        CASE WHEN COUNT(r.id) = 1 THEN MAX(r.reserved_until) END AS reserved_until,
        CASE WHEN COUNT(r.id) = 1 THEN MAX(CASE
            WHEN r.release_reason IS NULL THEN NULL
            WHEN r.release_reason ~ '^[A-Za-z0-9_]{1,64}$' THEN r.release_reason
            ELSE '[redacted]'
        END) END AS safe_release_reason,
        COUNT(i.id) FILTER (WHERE i.status = 'reserve')::bigint AS reserve_inventory_rows,
        COUNT(i.id) FILTER (WHERE i.status = 'sold')::bigint AS sold_inventory_rows,
        COUNT(i.id) FILTER (WHERE i.status = 'available')::bigint AS available_inventory_rows
    FROM order_row o
    LEFT JOIN public.guest_shop_inventory_reservations r ON r.order_id = o.id
    LEFT JOIN public.shop_inventory i ON i.id = r.inventory_id
),
target_inventory AS (
    SELECT
        COUNT(i.id) FILTER (
            WHERE i.status = 'available'
              AND COALESCE(i.is_shared, false) = false
              AND EXISTS (
                  SELECT 1
                  FROM public.fn_resolve_shop_sku_inventory_sources(tp.sku_id, 'cn') src
                  WHERE src.source_sku_id = i.sku_id
                     OR (src.source_is_default IS TRUE AND i.sku_id IS NULL)
              )
        )::bigint AS nonshared_available,
        COUNT(i.id) FILTER (
            WHERE i.status = 'sold'
              AND COALESCE(i.is_shared, false) = false
              AND EXISTS (
                  SELECT 1
                  FROM public.fn_resolve_shop_sku_inventory_sources(tp.sku_id, 'cn') src
                  WHERE src.source_sku_id = i.sku_id
                     OR (src.source_is_default IS TRUE AND i.sku_id IS NULL)
              )
        )::bigint AS nonshared_sold,
        COUNT(i.id) FILTER (
            WHERE i.status = 'reserve'
              AND COALESCE(i.is_shared, false) = false
              AND EXISTS (
                  SELECT 1
                  FROM public.fn_resolve_shop_sku_inventory_sources(tp.sku_id, 'cn') src
                  WHERE src.source_sku_id = i.sku_id
                     OR (src.source_is_default IS TRUE AND i.sku_id IS NULL)
              )
        )::bigint AS nonshared_reserved
    FROM target_product tp
    LEFT JOIN public.shop_inventory i ON i.product_id = tp.product_id
    WHERE tp.target_present
),
prior_order AS (
    SELECT
        COUNT(o.id)::bigint AS prior_order_rows,
        BOOL_AND(o.payment_status = 'pending') AS prior_payment_pending,
        BOOL_AND(o.reservation_status = 'released') AS prior_reservation_released,
        BOOL_AND(ROUND(o.discount_amount, 2) = 1.00) AS prior_discount_is_1
    FROM target t
    LEFT JOIN public.guest_shop_orders o ON o.order_no = t.prior_order_no
),
target_orders AS (
    SELECT
        COUNT(o.id)::bigint AS cd7_guest_orders,
        COUNT(o.id) FILTER (WHERE o.payment_status = 'confirmed')::bigint AS cd7_confirmed_orders,
        COUNT(o.id) FILTER (WHERE o.payment_status IN ('confirmed', 'paid', 'success'))::bigint AS cd7_paid_like_orders
    FROM target t
    LEFT JOIN public.guest_shop_orders o
      ON o.source_channel = 'website_guest'
     AND (o.product_id = t.product_id OR o.sku_id = t.sku_id)
),
cd3 AS (
    SELECT
        (p.id IS NOT NULL AND s.id IS NOT NULL) AS present,
        COALESCE(s.allow_guest_purchase, p.allow_guest_purchase, false) AS effective_guest
    FROM target t
    LEFT JOIN public.shop_products p ON p.id = t.cd3_product_id
    LEFT JOIN public.shop_product_skus s
        ON s.id = t.cd3_sku_id
       AND s.product_id = p.id
),
cd3_orders AS (
    SELECT COUNT(o.id)::bigint AS guest_orders
    FROM target t
    LEFT JOIN public.guest_shop_orders o
      ON o.source_channel = 'website_guest'
     AND (o.product_id = t.cd3_product_id OR o.sku_id = t.cd3_sku_id)
),
coupon AS (
    SELECT
        COUNT(d.id)::bigint AS promo10_rows,
        MAX(d.guest_used_count) AS promo10_guest_used_count,
        MAX(d.used_count) AS promo10_used_count,
        ROUND(MAX(d.guest_discount_total), 2) AS promo10_guest_discount_total
    FROM public.discount_codes d
    WHERE UPPER(BTRIM(d.code::text)) = 'SBXPROMO10'
),
quota_coupon AS (
    SELECT
        COUNT(d.id)::bigint AS quota2_rows,
        MAX(d.guest_used_count) AS quota2_guest_used_count,
        MAX(d.used_count) AS quota2_used_count,
        ROUND(MAX(d.guest_discount_total), 2) AS quota2_guest_discount_total
    FROM public.discount_codes d
    WHERE UPPER(BTRIM(d.code::text)) = 'SBXQUOTA2'
),
ledger AS (
    SELECT
        COUNT(r.id)::bigint AS promo10_rows,
        COUNT(r.id) FILTER (WHERE r.returned_at IS NULL)::bigint AS promo10_open_rows,
        COUNT(r.id) FILTER (WHERE r.returned_at IS NOT NULL)::bigint AS promo10_returned_rows,
        COALESCE(ROUND(SUM(r.discount_amount) FILTER (WHERE r.returned_at IS NULL), 2), 0) AS promo10_open_amount,
        COALESCE(ROUND(SUM(r.discount_amount) FILTER (WHERE r.returned_at IS NOT NULL), 2), 0) AS promo10_returned_amount,
        COUNT(r.id) FILTER (WHERE UPPER(BTRIM(r.code::text)) = 'SBXQUOTA2')::bigint AS quota2_rows,
        COUNT(r.id) FILTER (WHERE UPPER(BTRIM(r.code::text)) = 'SBXQUOTA2' AND r.returned_at IS NULL)::bigint AS quota2_open_rows
    FROM public.guest_shop_discount_redemptions r
    WHERE UPPER(BTRIM(r.code::text)) IN ('SBXPROMO10', 'SBXQUOTA2')
),
budget AS (
    SELECT
        COUNT(b.site) FILTER (WHERE b.site = 'cn')::bigint AS cn_rows,
        COUNT(b.site) FILTER (WHERE b.site = 'intl')::bigint AS intl_rows,
        BOOL_OR(b.enabled) FILTER (WHERE b.site = 'cn') AS cn_enabled,
        MAX(b.daily_budget_cny) FILTER (WHERE b.site = 'cn') AS cn_daily_budget_cny,
        MAX(b.spent_cny) FILTER (WHERE b.site = 'cn') AS cn_spent_cny,
        MAX(b.budget_date) FILTER (WHERE b.site = 'cn') AS cn_budget_date,
        BOOL_OR(b.enabled) FILTER (WHERE b.site = 'intl') AS intl_enabled,
        MAX(b.daily_budget_cny) FILTER (WHERE b.site = 'intl') AS intl_daily_budget_cny,
        MAX(b.spent_cny) FILTER (WHERE b.site = 'intl') AS intl_spent_cny,
        MAX(b.budget_date) FILTER (WHERE b.site = 'intl') AS intl_budget_date
    FROM public.guest_shop_promo_budget b
),
breaker AS (
    SELECT
        COUNT(b.id)::bigint AS breaker_rows,
        MAX(b.state) AS state,
        MAX(b.reason) AS reason,
        MAX(b.closed_by) AS closed_by,
        MAX(b.closed_at) AS closed_at,
        MAX(b.mismatch_trip_threshold) AS mismatch_trip_threshold,
        MAX(b.identity_trip_threshold) AS identity_trip_threshold,
        MAX(b.trip_window_seconds) AS trip_window_seconds
    FROM public.guest_shop_promo_breaker b
    WHERE b.id = 1
),
breaker_events AS (
    SELECT COUNT(e.id)::bigint AS event_count
    FROM public.guest_shop_promo_breaker_events e
),
facts AS (
    SELECT
        tp.target_present,
        tp.product_name,
        tp.sku_name,
        tp.price_points,
        o.id IS NOT NULL AS order_present,
        o.source_channel,
        o.product_id = tp.product_id AND o.sku_id = tp.sku_id AS order_product_matches,
        o.payment_status,
        o.fulfillment_status,
        o.refund_status,
        o.reservation_status AS order_reservation_status,
        o.site,
        o.currency,
        o.quantity,
        o.expires_at,
        o.expires_at > clock_timestamp() AS within_ttl,
        ROUND(o.list_unit_amount, 2) AS list_unit_amount,
        ROUND(o.discount_amount, 2) AS discount_amount,
        ROUND(o.unit_amount, 2) AS net_unit_amount,
        ROUND(o.total_amount, 2) AS total_amount,
        ROUND(o.payment_fee_amount, 2) AS order_payment_fee_amount,
        UPPER(BTRIM(COALESCE(o.discount_code, ''))) = 'SBXPROMO10' AS uses_sbxpromo10,
        o.paid_at IS NOT NULL AS paid_at_present,
        o.fulfilled_at IS NOT NULL AS fulfilled_at_present,
        o.safe_last_error_code,
        pr.payment_row_count,
        pr.confirmed_payment_rows,
        pr.payment_order_id_matches,
        pr.payment_site_matches,
        pr.payment_currency_matches,
        pr.expected_matches_total,
        pr.payment_waiting,
        pr.payment_review,
        pr.payment_status AS guest_payment_status,
        ROUND(pr.expected_amount, 2) AS expected_amount,
        ROUND(pr.paid_amount, 2) AS paid_amount,
        ROUND(pr.payment_fee, 2) AS payment_fee,
        pr.sign_verified,
        pr.amount_verified,
        pr.currency_verified,
        pr.final_status_verified,
        pr.payment_expires_at,
        pr.payment_safe_last_error_code,
        r.reservation_rows,
        r.held_rows,
        r.released_rows,
        r.consumed_rows,
        r.reservation_status AS reservation_row_status,
        r.reserved_until,
        r.safe_release_reason,
        r.reserve_inventory_rows,
        r.sold_inventory_rows,
        r.available_inventory_rows,
        ti.nonshared_available,
        ti.nonshared_sold,
        ti.nonshared_reserved,
        po.prior_order_rows,
        po.prior_payment_pending,
        po.prior_reservation_released,
        po.prior_discount_is_1,
        ord.cd7_guest_orders,
        ord.cd7_confirmed_orders,
        ord.cd7_paid_like_orders,
        cd3.present AS cd3_present,
        cd3.effective_guest AS cd3_effective_guest,
        c3.guest_orders AS cd3_guest_orders,
        c.promo10_rows AS coupon_rows,
        c.promo10_guest_used_count,
        c.promo10_used_count AS coupon_used_count,
        ROUND(c.promo10_guest_discount_total, 2) AS coupon_guest_discount_total,
        q.quota2_rows AS quota2_coupon_rows,
        q.quota2_guest_used_count AS quota2_guest_used_count,
        q.quota2_used_count AS quota2_used_count,
        ROUND(q.quota2_guest_discount_total, 2) AS quota2_guest_discount_total,
        l.promo10_rows AS ledger_rows,
        l.promo10_open_rows AS ledger_open_rows,
        l.promo10_returned_rows AS ledger_returned_rows,
        l.promo10_open_amount AS ledger_open_amount,
        l.promo10_returned_amount AS ledger_returned_amount,
        l.quota2_rows AS quota2_ledger_rows,
        l.quota2_open_rows AS quota2_ledger_open_rows,
        b.cn_rows,
        b.intl_rows,
        b.cn_enabled,
        ROUND(b.cn_daily_budget_cny, 2) AS cn_daily_budget_cny,
        ROUND(b.cn_spent_cny, 2) AS cn_spent_cny,
        b.cn_budget_date,
        b.intl_enabled,
        ROUND(b.intl_daily_budget_cny, 2) AS intl_daily_budget_cny,
        ROUND(b.intl_spent_cny, 2) AS intl_spent_cny,
        b.intl_budget_date,
        br.breaker_rows,
        br.state AS breaker_state,
        br.reason AS breaker_reason,
        br.closed_by,
        br.closed_at,
        br.mismatch_trip_threshold,
        br.identity_trip_threshold,
        br.trip_window_seconds,
        be.event_count
    FROM target_product tp
    LEFT JOIN order_row o ON TRUE
    CROSS JOIN payment_rollup pr
    CROSS JOIN reservation r
    CROSS JOIN target_inventory ti
    CROSS JOIN prior_order po
    CROSS JOIN target_orders ord
    CROSS JOIN cd3
    CROSS JOIN cd3_orders c3
    CROSS JOIN coupon c
    CROSS JOIN quota_coupon q
    CROSS JOIN ledger l
    CROSS JOIN budget b
    CROSS JOIN breaker br
    CROSS JOIN breaker_events be
)
SELECT
    f.target_present,
    f.product_name,
    f.sku_name,
    ROUND(f.price_points, 2) AS sku_price_points,
    f.order_present,
    f.source_channel,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.site END AS site,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.currency END AS currency,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.quantity END AS quantity,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.payment_status END AS order_payment_status,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.fulfillment_status END AS fulfillment_status,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.refund_status END AS refund_status,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.order_reservation_status END AS order_reservation_status,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.list_unit_amount END AS list_unit_amount,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.discount_amount END AS discount_amount,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.net_unit_amount END AS net_unit_amount,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.order_payment_fee_amount END AS order_payment_fee_amount,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.total_amount END AS order_total_amount,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.uses_sbxpromo10 END AS uses_sbxpromo10,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.within_ttl END AS within_ttl,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.paid_at_present END AS paid_at_present,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.fulfilled_at_present END AS fulfilled_at_present,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.safe_last_error_code END AS safe_last_error_code,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.payment_row_count END AS payment_row_count,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.confirmed_payment_rows END AS confirmed_payment_rows,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.payment_order_id_matches END AS payment_order_id_matches,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.payment_site_matches END AS payment_site_matches,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.payment_currency_matches END AS payment_currency_matches,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.expected_matches_total END AS expected_matches_total,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.guest_payment_status END AS guest_payment_status,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.expected_amount END AS expected_amount,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.paid_amount END AS paid_amount,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.payment_fee END AS payment_fee,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.sign_verified END AS sign_verified,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.amount_verified END AS amount_verified,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.currency_verified END AS currency_verified,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.final_status_verified END AS final_status_verified,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.payment_review END AS payment_review,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.payment_safe_last_error_code END AS payment_safe_last_error_code,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.reservation_rows END AS reservation_rows,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.held_rows END AS held_reservation_rows,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.released_rows END AS released_reservation_rows,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.consumed_rows END AS consumed_reservation_rows,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.reservation_row_status END AS reservation_row_status,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.reserved_until END AS reserved_until,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.safe_release_reason END AS safe_release_reason,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.reserve_inventory_rows END AS reserve_inventory_rows,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.sold_inventory_rows END AS sold_inventory_rows,
    CASE WHEN f.order_present AND f.order_product_matches THEN f.available_inventory_rows END AS reservation_available_inventory_rows,
    f.nonshared_available,
    f.nonshared_sold,
    f.nonshared_reserved,
    CASE WHEN f.order_present THEN f.prior_order_rows END AS prior_order_rows,
    CASE WHEN f.order_present THEN f.prior_payment_pending END AS prior_payment_pending,
    CASE WHEN f.order_present THEN f.prior_reservation_released END AS prior_reservation_released,
    CASE WHEN f.order_present THEN f.prior_discount_is_1 END AS prior_discount_is_1,
    f.cd7_guest_orders,
    f.cd7_confirmed_orders,
    f.cd7_paid_like_orders,
    f.cd3_present,
    f.cd3_effective_guest,
    f.cd3_guest_orders,
    f.coupon_rows,
    f.promo10_guest_used_count,
    f.coupon_used_count,
    f.coupon_guest_discount_total,
    f.quota2_coupon_rows,
    f.quota2_guest_used_count,
    f.quota2_used_count,
    f.quota2_guest_discount_total,
    f.ledger_rows,
    f.ledger_open_rows,
    f.ledger_returned_rows,
    f.ledger_open_amount,
    f.ledger_returned_amount,
    f.quota2_ledger_rows,
    f.quota2_ledger_open_rows,
    f.cn_rows,
    f.cn_enabled,
    f.cn_daily_budget_cny,
    f.cn_spent_cny,
    f.cn_budget_date,
    f.intl_rows,
    f.intl_enabled,
    f.intl_daily_budget_cny,
    f.intl_spent_cny,
    f.intl_budget_date,
    f.breaker_rows,
    f.breaker_state,
    f.breaker_reason,
    f.closed_by,
    f.closed_at,
    f.mismatch_trip_threshold,
    f.identity_trip_threshold,
    f.trip_window_seconds,
    f.event_count,
    CASE
        WHEN f.target_present IS DISTINCT FROM TRUE
            THEN '目标商品或 SKU 不存在。不要建单，不要付款，不要改商品。'
        WHEN f.order_present IS NOT TRUE
            THEN '还没有这张单。这不是邀请重试。订单号精确匹配为零行；不要再建单，不要重复付款。'
        WHEN f.order_product_matches IS NOT TRUE OR f.source_channel IS DISTINCT FROM 'website_guest'
            THEN '该订单不是「沙箱CD7」游客单。金额列已留空；不要继续判为支付通过。'
        WHEN f.list_unit_amount IS DISTINCT FROM 10.00
          OR f.discount_amount IS DISTINCT FROM 1.00
          OR f.net_unit_amount IS DISTINCT FROM 9.00
          OR f.quantity IS DISTINCT FROM 1
          OR f.site IS DISTINCT FROM 'cn'
          OR f.currency IS DISTINCT FROM 'CNY'
          OR f.uses_sbxpromo10 IS DISTINCT FROM TRUE
            THEN '订单金额、站点、数量或券形状不符。不要改价，不要再付款。'
        WHEN f.payment_review IS TRUE OR f.payment_status = 'review'
            THEN '支付处于 review。不要付款，不要手工改状态。'
        WHEN f.payment_status IN ('pending', 'created')
          AND f.order_reservation_status = 'held'
          AND f.within_ttl IS TRUE
          AND (f.payment_row_count = 0 OR f.payment_waiting IS TRUE)
            THEN '支付还没进库。订单仍在 TTL 且预占 held；这不是失败，也不要重试付款。'
        WHEN f.payment_status IN ('pending', 'created')
          AND f.within_ttl IS FALSE
          AND f.order_reservation_status = 'held'
          AND f.promo10_guest_used_count = 1
          AND f.cn_budget_date = DATE '2026-09-22'
          AND ROUND(f.cn_daily_budget_cny, 2) = 1.00
          AND ROUND(f.cn_spent_cny, 2) = 1.00
            THEN '订单已过期但仍 held，券计数仍为 1。预算日期 2026-09-22 上限 1.00、已用 1.00 是已占用，不是未归还；等待既定 worker 周期后再查询，不要踢 worker。'
        WHEN f.payment_status IN ('pending', 'created')
          AND f.order_reservation_status = 'released'
          AND ((f.held_rows = 0 AND f.available_inventory_rows = 1 AND f.nonshared_available = 6)
            <> (f.ledger_rows = 2 AND f.ledger_returned_rows = 2 AND f.ledger_open_rows = 0))
            THEN '泄漏：未确认订单的库存归还和促销台账归还仅一边完成。不要再付款或手工改计数。'
        WHEN f.payment_status IN ('pending', 'created')
          AND f.order_reservation_status = 'released'
          AND f.held_rows = 0
          AND f.available_inventory_rows = 1
          AND f.nonshared_available = 6
          AND f.ledger_rows = 2
          AND f.ledger_returned_rows = 2
          AND f.ledger_open_rows = 0
          AND f.cn_budget_date = DATE '2026-09-22'
          AND ROUND(f.cn_daily_budget_cny, 2) = 1.00
          AND ROUND(f.cn_spent_cny, 2) = 0.00
            THEN '订单未确认，库存与促销台账都已归还，预算在原预算日已用 0.00。用户报告已付款，当前状态属于风险，按支付争议流程人工核对；不要重试付款或踢 worker。'
        WHEN f.payment_status IN ('pending', 'created')
          AND f.order_reservation_status = 'released'
          AND f.held_rows = 0
          AND f.ledger_rows = 2
          AND f.ledger_returned_rows = 2
          AND f.ledger_open_rows = 0
          AND f.fulfillment_status <> 'paid_unfulfillable'
          AND f.cn_budget_date = DATE '2026-09-22'
          AND ROUND(f.cn_daily_budget_cny, 2) = 1.00
          AND ROUND(f.cn_spent_cny, 2) = 1.00
            THEN '订单两边都已归还，不是泄漏。预算仍记在 2026-09-22 的 1.00 上限内；跨日不滚动清零。由于用户报告已付款，这种状态仍需人工核查，不要再次付款。'
        WHEN (f.payment_status IN ('pending', 'created') AND f.order_reservation_status = 'released' AND ROUND(f.cn_spent_cny, 2) = 0.00)
          OR (f.payment_status = 'confirmed' AND f.order_reservation_status = 'released')
          OR f.fulfillment_status = 'paid_unfulfillable'
            THEN '风险：用户报告已付款，但本地订单/库存状态不能证明安全完成。不要踢 worker，不要重试支付或建单；按支付争议流程人工核对。'
        WHEN f.payment_status = 'confirmed'
          AND f.order_reservation_status = 'held'
          AND f.within_ttl IS FALSE
            THEN '已确认但订单已过期且预占仍 held，不算通过。不要踢 worker或手工释放；按支付争议流程核对。'
        WHEN f.payment_status = 'confirmed'
          AND f.guest_payment_status = 'confirmed'
          AND f.sign_verified IS TRUE
          AND f.amount_verified IS TRUE
          AND f.currency_verified IS TRUE
          AND f.final_status_verified IS TRUE
          AND ROUND(f.paid_amount, 2) = 9.09
          AND ROUND(f.expected_amount, 2) = 9.09
          AND ROUND(f.total_amount, 2) = 9.09
          AND ROUND(f.order_payment_fee_amount, 2) = 0.09
          AND (f.payment_fee IS NULL OR ROUND(f.payment_fee, 2) = 0.09)
          AND f.payment_order_id_matches IS TRUE
          AND f.payment_site_matches IS TRUE
          AND f.payment_currency_matches IS TRUE
          AND f.expected_matches_total IS TRUE
          AND f.prior_order_rows = 1
          AND f.prior_payment_pending IS TRUE
          AND f.prior_reservation_released IS TRUE
          AND f.prior_discount_is_1 IS TRUE
          AND f.cd7_guest_orders = 2
          AND f.cd7_confirmed_orders = 1
          AND f.cd7_paid_like_orders = 1
          AND f.held_rows + f.released_rows + f.consumed_rows = 1
          AND f.coupon_rows = 1
          AND f.promo10_guest_used_count = 1
          AND f.coupon_used_count = 1
          AND ROUND(f.coupon_guest_discount_total, 2) = 1.00
          AND f.ledger_rows = 2
          AND f.ledger_returned_rows + f.ledger_open_rows = 2
          AND f.ledger_returned_rows = 1
          AND f.ledger_open_rows = 1
          AND ROUND(f.ledger_open_amount, 2) = 1.00
          AND ROUND(f.ledger_returned_amount, 2) = 1.00
          AND f.quota2_coupon_rows = 1
          AND f.quota2_guest_used_count = 0
          AND f.quota2_used_count = 0
          AND ROUND(f.quota2_guest_discount_total, 2) = 0.00
          AND f.quota2_ledger_rows = 0
          AND f.quota2_ledger_open_rows = 0
          AND f.cn_rows = 1
          AND f.cn_enabled IS TRUE
          AND ROUND(f.cn_daily_budget_cny, 2) = 1.00
          AND f.cn_budget_date = DATE '2026-09-22'
          AND ROUND(f.cn_spent_cny, 2) = 1.00
          AND f.intl_rows = 1
          AND f.intl_enabled IS FALSE
          AND ROUND(f.intl_daily_budget_cny, 2) = 0.00
          AND ROUND(f.intl_spent_cny, 2) = 0.00
          AND f.intl_budget_date = DATE '2026-09-22'
          AND f.breaker_rows = 1
          AND f.breaker_state = 'closed'
          AND f.breaker_reason IS NULL
          AND f.closed_by = 's154-card8'
          AND f.closed_at = TIMESTAMPTZ '2026-09-22 09:18:20.678679+00'
          AND f.mismatch_trip_threshold = 3
          AND f.identity_trip_threshold = 20
          AND f.trip_window_seconds = 900
          AND f.event_count = 2
          AND f.cd3_present IS TRUE
          AND f.cd3_effective_guest IS FALSE
          AND f.cd3_guest_orders = 0
          AND f.nonshared_available = 5
          AND (
              (f.order_reservation_status = 'held'
                AND f.within_ttl IS TRUE
                AND f.reserve_inventory_rows = 1
                AND f.sold_inventory_rows = 0
                AND f.fulfillment_status = 'pending')
              OR
              (f.order_reservation_status = 'consumed'
                AND f.sold_inventory_rows = 1
                AND f.reserve_inventory_rows = 0
                AND f.fulfillment_status IN ('fulfilling', 'delivered')
                AND (f.fulfillment_status <> 'delivered' OR f.fulfilled_at_present IS TRUE))
          )
            THEN '支付半步通过。订单确认、9.09 应付和 0.09 手续费、券预算与库存状态均吻合。游客开关仍可能开启：不要再购买；回读通过不表示卡 9 整卡 PASS。'
        ELSE '未闭合或出现不匹配。不要改价、预算、熔断或商品开关，不要再付款；按回读列定位并贴回本行。'
    END AS readback_verdict
FROM facts f
LEFT JOIN target_product tp ON TRUE;
