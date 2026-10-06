-- S154 卡 9 切 BUDGET_TIGHT 之前，只读抄录两张 SBX 券和台账。Codex 不执行。
-- 全文只有一条 SELECT。不改 v_phase，不跑夹具，不跑 cleanup。
-- 不打开熔断，不打开游客开关，不建单，不付款，不开生产折扣开关。
-- 不读取联系方式、来源地址、密钥、会话、支付链接、卡密或查询口令。
-- 台账只按券汇总行数、未归还数、已归还数和金额。
-- 期望正好 1 行。把整行贴回，尤其 snapshot_verdict。
-- snapshot_verdict 以「抄录通过」开头才算这半步。这不是卡 4 PASS。
-- 写着异常不是邀请去修。计数不是 0 时留下本行，这一轮仍不要切 BUDGET_TIGHT。

WITH breaker AS (
    SELECT
        b.id,
        b.state,
        b.reason,
        b.opened_at,
        b.opened_by,
        b.closed_at,
        b.closed_by,
        b.mismatch_trip_threshold,
        b.identity_trip_threshold,
        b.trip_window_seconds,
        (
            (b.state = 'open' AND b.opened_at IS NOT NULL AND b.opened_by IS NOT NULL)
            OR (b.state = 'closed' AND b.opened_at IS NULL AND b.opened_by IS NULL)
        ) AS state_exclusive_ok
    FROM public.guest_shop_promo_breaker b
    WHERE b.id = 1
),
events AS (
    SELECT
        COUNT(*)::bigint AS event_count,
        COUNT(*) FILTER (WHERE kind = 'manual_open')::bigint AS manual_open_count,
        COUNT(*) FILTER (WHERE kind = 'manual_close')::bigint AS manual_close_count,
        COUNT(*) FILTER (WHERE kind = 'auto_open')::bigint AS auto_open_count,
        COUNT(*) FILTER (WHERE kind = 'amount_mismatch')::bigint AS amount_mismatch_count,
        COUNT(*) FILTER (WHERE kind = 'identity_limit_hit')::bigint AS identity_limit_hit_count,
        COUNT(*) FILTER (WHERE kind = 'budget_exhausted')::bigint AS budget_exhausted_count,
        COUNT(*) FILTER (WHERE kind = 'code_exhausted')::bigint AS code_exhausted_count,
        COUNT(*) FILTER (
            WHERE kind = 'manual_open'
              AND site IS NULL
              AND detail->>'actor' = 's154-card8'
              AND detail->>'reason' = 'S154 第8项'
              AND detail->>'previous_state' = 'closed'
        )::bigint AS manual_open_matched,
        COUNT(*) FILTER (
            WHERE kind = 'manual_close'
              AND site IS NULL
              AND detail->>'actor' = 's154-card8'
              AND detail->>'reason' = 'S154 第8项恢复'
              AND detail->>'previous_state' = 'open'
        )::bigint AS manual_close_matched
    FROM public.guest_shop_promo_breaker_events
),
budgets AS (
    SELECT
        COUNT(*) FILTER (WHERE site = 'cn')::bigint AS cn_rows,
        COUNT(*) FILTER (WHERE site = 'intl')::bigint AS intl_rows,
        MAX(daily_budget_cny) FILTER (WHERE site = 'cn') AS cn_daily_budget_cny,
        MAX(spent_cny) FILTER (WHERE site = 'cn') AS cn_spent_cny,
        MAX(budget_date) FILTER (WHERE site = 'cn') AS cn_budget_date,
        BOOL_OR(enabled) FILTER (WHERE site = 'cn') AS cn_enabled,
        MAX(daily_budget_cny) FILTER (WHERE site = 'intl') AS intl_daily_budget_cny,
        MAX(spent_cny) FILTER (WHERE site = 'intl') AS intl_spent_cny,
        MAX(budget_date) FILTER (WHERE site = 'intl') AS intl_budget_date,
        BOOL_OR(enabled) FILTER (WHERE site = 'intl') AS intl_enabled
    FROM public.guest_shop_promo_budget
),
cd7 AS (
    SELECT
        (p.id IS NOT NULL AND s.id IS NOT NULL) AS present,
        COALESCE(s.allow_guest_purchase, p.allow_guest_purchase, false) AS effective_guest,
        p.allow_guest_purchase IS FALSE AS product_guest_off,
        s.allow_guest_purchase IS NULL AS sku_guest_unset
    FROM (
        SELECT
            '5f940176-8059-443a-b5fd-79adc883a810'::uuid AS product_id,
            'c955f03a-8cd6-44b8-b751-06e2ad66d4cd'::uuid AS sku_id
    ) a
    LEFT JOIN public.shop_products p ON p.id = a.product_id
    LEFT JOIN public.shop_product_skus s
        ON s.id = a.sku_id
       AND s.product_id = p.id
),
cd3 AS (
    SELECT
        (p.id IS NOT NULL AND s.id IS NOT NULL) AS present,
        COALESCE(s.allow_guest_purchase, p.allow_guest_purchase, false) AS effective_guest,
        p.allow_guest_purchase IS FALSE AS product_guest_off,
        s.allow_guest_purchase IS NULL AS sku_guest_unset
    FROM (
        SELECT
            'c373b8b7-ebce-4709-b8d4-c192abd36869'::uuid AS product_id,
            'f928599e-30e8-4b3e-aa86-34ec09e2d659'::uuid AS sku_id
    ) a
    LEFT JOIN public.shop_products p ON p.id = a.product_id
    LEFT JOIN public.shop_product_skus s
        ON s.id = a.sku_id
       AND s.product_id = p.id
),
cd7_orders AS (
    SELECT
        COUNT(*)::bigint AS guest_orders,
        COUNT(*) FILTER (
            WHERE LOWER(COALESCE(o.payment_status, '')) IN ('paid', 'confirmed', 'success')
        )::bigint AS paid_like_orders
    FROM public.guest_shop_orders o
    WHERE o.source_channel = 'website_guest'
      AND (
          o.product_id = '5f940176-8059-443a-b5fd-79adc883a810'::uuid
          OR o.sku_id = 'c955f03a-8cd6-44b8-b751-06e2ad66d4cd'::uuid
      )
),
cd3_orders AS (
    SELECT COUNT(*)::bigint AS guest_orders
    FROM public.guest_shop_orders o
    WHERE o.source_channel = 'website_guest'
      AND (
          o.product_id = 'c373b8b7-ebce-4709-b8d4-c192abd36869'::uuid
          OR o.sku_id = 'f928599e-30e8-4b3e-aa86-34ec09e2d659'::uuid
      )
),
known AS (
    SELECT
        (COUNT(*) = 1) AS known_order_present,
        COALESCE(BOOL_AND(o.payment_status = 'pending'), false) AS known_payment_pending,
        COALESCE(BOOL_AND(o.reservation_status = 'released'), false) AS known_reservation_released,
        COALESCE(BOOL_AND(ROUND(o.discount_amount, 2) = 1.00), false) AS known_discount_still_1
    FROM public.guest_shop_orders o
    WHERE o.order_no = 'GS2026092207342938190F2B83D5ACF'
),
coupon_rows AS (
    SELECT
        UPPER(BTRIM(d.code::text)) AS code,
        d.discount_type::text AS discount_type,
        d.discount_value,
        d.allow_guest,
        d.guest_max_uses,
        d.guest_used_count,
        d.guest_max_total_discount,
        d.guest_discount_total,
        d.max_uses,
        d.used_count,
        d.is_active,
        d.lifecycle_status::text AS lifecycle_status,
        d.applicable_site::text AS applicable_site
    FROM public.discount_codes d
    WHERE UPPER(BTRIM(d.code::text)) IN ('SBXPROMO10', 'SBXQUOTA2')
),
coupons AS (
    SELECT
        COUNT(*) FILTER (WHERE code = 'SBXPROMO10')::bigint AS promo10_rows,
        MAX(discount_type) FILTER (WHERE code = 'SBXPROMO10') AS promo10_discount_type,
        MAX(discount_value) FILTER (WHERE code = 'SBXPROMO10') AS promo10_discount_value,
        BOOL_AND(allow_guest) FILTER (WHERE code = 'SBXPROMO10') AS promo10_allow_guest,
        MAX(guest_max_uses) FILTER (WHERE code = 'SBXPROMO10') AS promo10_guest_max_uses,
        MAX(guest_used_count) FILTER (WHERE code = 'SBXPROMO10') AS promo10_guest_used_count,
        MAX(guest_max_total_discount) FILTER (WHERE code = 'SBXPROMO10') AS promo10_guest_max_total_discount,
        MAX(guest_discount_total) FILTER (WHERE code = 'SBXPROMO10') AS promo10_guest_discount_total,
        MAX(max_uses) FILTER (WHERE code = 'SBXPROMO10') AS promo10_max_uses,
        MAX(used_count) FILTER (WHERE code = 'SBXPROMO10') AS promo10_used_count,
        BOOL_AND(is_active) FILTER (WHERE code = 'SBXPROMO10') AS promo10_is_active,
        MAX(lifecycle_status) FILTER (WHERE code = 'SBXPROMO10') AS promo10_lifecycle_status,
        MAX(applicable_site) FILTER (WHERE code = 'SBXPROMO10') AS promo10_applicable_site,
        COUNT(*) FILTER (WHERE code = 'SBXQUOTA2')::bigint AS quota2_rows,
        MAX(discount_type) FILTER (WHERE code = 'SBXQUOTA2') AS quota2_discount_type,
        MAX(discount_value) FILTER (WHERE code = 'SBXQUOTA2') AS quota2_discount_value,
        BOOL_AND(allow_guest) FILTER (WHERE code = 'SBXQUOTA2') AS quota2_allow_guest,
        MAX(guest_max_uses) FILTER (WHERE code = 'SBXQUOTA2') AS quota2_guest_max_uses,
        MAX(guest_used_count) FILTER (WHERE code = 'SBXQUOTA2') AS quota2_guest_used_count,
        MAX(guest_max_total_discount) FILTER (WHERE code = 'SBXQUOTA2') AS quota2_guest_max_total_discount,
        MAX(guest_discount_total) FILTER (WHERE code = 'SBXQUOTA2') AS quota2_guest_discount_total,
        MAX(max_uses) FILTER (WHERE code = 'SBXQUOTA2') AS quota2_max_uses,
        MAX(used_count) FILTER (WHERE code = 'SBXQUOTA2') AS quota2_used_count,
        BOOL_AND(is_active) FILTER (WHERE code = 'SBXQUOTA2') AS quota2_is_active,
        MAX(lifecycle_status) FILTER (WHERE code = 'SBXQUOTA2') AS quota2_lifecycle_status,
        MAX(applicable_site) FILTER (WHERE code = 'SBXQUOTA2') AS quota2_applicable_site
    FROM coupon_rows
),
redemptions AS (
    SELECT
        COUNT(*) FILTER (WHERE code = 'SBXPROMO10')::bigint AS promo10_redemption_rows,
        COUNT(*) FILTER (WHERE code = 'SBXPROMO10' AND returned_at IS NULL)::bigint AS promo10_open_rows,
        COUNT(*) FILTER (WHERE code = 'SBXPROMO10' AND returned_at IS NOT NULL)::bigint AS promo10_returned_rows,
        COALESCE(ROUND(SUM(discount_amount) FILTER (WHERE code = 'SBXPROMO10' AND returned_at IS NULL), 2), 0) AS promo10_open_discount_amount,
        COALESCE(ROUND(SUM(discount_amount) FILTER (WHERE code = 'SBXPROMO10' AND returned_at IS NOT NULL), 2), 0) AS promo10_returned_discount_amount,
        COUNT(*) FILTER (WHERE code = 'SBXQUOTA2')::bigint AS quota2_redemption_rows,
        COUNT(*) FILTER (WHERE code = 'SBXQUOTA2' AND returned_at IS NULL)::bigint AS quota2_open_rows,
        COUNT(*) FILTER (WHERE code = 'SBXQUOTA2' AND returned_at IS NOT NULL)::bigint AS quota2_returned_rows,
        COALESCE(ROUND(SUM(discount_amount) FILTER (WHERE code = 'SBXQUOTA2' AND returned_at IS NULL), 2), 0) AS quota2_open_discount_amount,
        COALESCE(ROUND(SUM(discount_amount) FILTER (WHERE code = 'SBXQUOTA2' AND returned_at IS NOT NULL), 2), 0) AS quota2_returned_discount_amount
    FROM (
        SELECT
            UPPER(BTRIM(r.code::text)) AS code,
            r.returned_at,
            r.discount_amount
        FROM public.guest_shop_discount_redemptions r
        WHERE UPPER(BTRIM(r.code::text)) IN ('SBXPROMO10', 'SBXQUOTA2')
    ) r
)
SELECT
    c.promo10_rows,
    c.promo10_discount_type,
    c.promo10_discount_value,
    c.promo10_allow_guest,
    c.promo10_guest_max_uses,
    c.promo10_guest_used_count,
    c.promo10_guest_max_total_discount,
    c.promo10_guest_discount_total,
    c.promo10_max_uses,
    c.promo10_used_count,
    c.promo10_is_active,
    c.promo10_lifecycle_status,
    c.promo10_applicable_site,
    c.quota2_rows,
    c.quota2_discount_type,
    c.quota2_discount_value,
    c.quota2_allow_guest,
    c.quota2_guest_max_uses,
    c.quota2_guest_used_count,
    c.quota2_guest_max_total_discount,
    c.quota2_guest_discount_total,
    c.quota2_max_uses,
    c.quota2_used_count,
    c.quota2_is_active,
    c.quota2_lifecycle_status,
    c.quota2_applicable_site,
    r.promo10_redemption_rows,
    r.promo10_open_rows,
    r.promo10_returned_rows,
    r.promo10_open_discount_amount,
    r.promo10_returned_discount_amount,
    r.quota2_redemption_rows,
    r.quota2_open_rows,
    r.quota2_returned_rows,
    r.quota2_open_discount_amount,
    r.quota2_returned_discount_amount,
    (b.id IS NOT NULL) AS breaker_present,
    COALESCE(b.state, 'missing') AS breaker_state,
    b.state_exclusive_ok,
    b.closed_by,
    b.closed_at,
    e.manual_open_count,
    e.manual_close_count,
    bg.cn_enabled,
    bg.cn_daily_budget_cny,
    bg.cn_spent_cny,
    bg.cn_budget_date,
    bg.intl_enabled,
    bg.intl_daily_budget_cny,
    bg.intl_spent_cny,
    cd7.present AS cd7_present,
    cd7.effective_guest AS cd7_effective_guest,
    cd3.present AS cd3_present,
    cd3.effective_guest AS cd3_effective_guest,
    cd7_orders.guest_orders AS cd7_guest_orders,
    cd7_orders.paid_like_orders AS cd7_paid_like_orders,
    cd3_orders.guest_orders AS cd3_guest_orders,
    known.known_order_present,
    known.known_payment_pending,
    known.known_reservation_released,
    known.known_discount_still_1,
    CASE
        WHEN b.id IS NULL
            THEN '缺行。不要补插熔断行，不要改 v_phase，不要切 BUDGET_TIGHT，不要跑夹具或 cleanup，不要打开熔断，不要建单。留下本行。把本行贴回。写着异常不是邀请去修。这不是卡 4 PASS，不要改写 §2.6。'
        WHEN b.state IS DISTINCT FROM 'closed'
          OR b.state_exclusive_ok IS NOT TRUE
          OR b.reason IS NOT NULL
          OR b.opened_at IS NOT NULL
          OR b.opened_by IS NOT NULL
          OR b.closed_by IS DISTINCT FROM 's154-card8'
          OR b.closed_at IS DISTINCT FROM TIMESTAMPTZ '2026-09-22 09:18:20.678679+00'
            THEN '不是这次合闸。closed 应由 s154-card8 在 2026-09-22 09:18:20.678679+00 留下，熔断行 reason 应为空。不要再合一次，不要打开熔断，不要改 v_phase，不要切 BUDGET_TIGHT，不要跑夹具。留下本行。把本行贴回。写着异常不是邀请去修。这不是卡 4 PASS，不要改写 §2.6。'
        WHEN b.mismatch_trip_threshold IS DISTINCT FROM 3
          OR b.identity_trip_threshold IS DISTINCT FROM 20
          OR b.trip_window_seconds IS DISTINCT FROM 900
            THEN '已经是这次合闸，但阈值不再是 3、20、900。不要改阈值，不要改 v_phase，不要切 BUDGET_TIGHT，不要跑夹具。留下本行。把本行贴回。写着异常不是邀请去修。这不是卡 4 PASS，不要改写 §2.6。'
        WHEN NOT (
            e.event_count = 2
            AND e.manual_open_count = 1
            AND e.manual_close_count = 1
            AND e.auto_open_count = 0
            AND e.amount_mismatch_count = 0
            AND e.identity_limit_hit_count = 0
            AND e.budget_exhausted_count = 0
            AND e.code_exhausted_count = 0
         )
            THEN '已经是这次合闸，但 manual_open 不是 1，或 manual_close 不是 1，或其他事件不是 0。不要补事件，不要再合一次，不要打开熔断，不要切 BUDGET_TIGHT。留下本行。把本行贴回。写着异常不是邀请去修。这不是卡 4 PASS，不要改写 §2.6。'
        WHEN e.manual_open_matched IS DISTINCT FROM 1
          OR e.manual_close_matched IS DISTINCT FROM 1
            THEN '已经是这次合闸，但 manual_open 或 manual_close 审计对不上 s154-card8。不要再打开，不要再合一次，不要改 v_phase，不要切 BUDGET_TIGHT。留下本行。把本行贴回。写着异常不是邀请去修。这不是卡 4 PASS，不要改写 §2.6。'
        WHEN NOT (
            bg.cn_rows = 1
            AND bg.intl_rows = 1
            AND bg.cn_enabled IS TRUE
            AND ROUND(bg.cn_daily_budget_cny, 2) = 20.00
            AND ROUND(bg.cn_spent_cny, 2) = 0.00
            AND bg.cn_budget_date = DATE '2026-09-22'
            AND bg.intl_enabled IS FALSE
            AND ROUND(bg.intl_daily_budget_cny, 2) = 0.00
            AND ROUND(bg.intl_spent_cny, 2) = 0.00
            AND bg.intl_budget_date = DATE '2026-09-22'
         )
            THEN '预算已经不是基线。CN 应为启用、日预算 20.00、已用 0.00、日期 2026-09-22，intl 应为关闭。不要改 v_phase，不要切 BUDGET_TIGHT，不要跑夹具或 cleanup。留下本行。把本行贴回。写着异常不是邀请去修。这不是卡 4 PASS，不要改写 §2.6。'
        WHEN NOT (
            cd7.present IS TRUE
            AND cd7.effective_guest IS FALSE
            AND cd7.product_guest_off IS TRUE
            AND cd7.sku_guest_unset IS TRUE
            AND cd3.present IS TRUE
            AND cd3.effective_guest IS FALSE
            AND cd3.product_guest_off IS TRUE
            AND cd3.sku_guest_unset IS TRUE
         )
            THEN '游客开关不是关的，或商品不在。不要打开游客开关，不要建单，不要付款，不要改 v_phase，不要切 BUDGET_TIGHT。留下本行。把本行贴回。写着异常不是邀请去修。这不是卡 4 PASS，不要改写 §2.6。'
        WHEN NOT (
            cd7_orders.guest_orders = 1
            AND cd7_orders.paid_like_orders = 0
            AND cd3_orders.guest_orders = 0
         )
            THEN '沙箱CD7 游客订单不是 1，或出现付款，或沙箱CD3 出现游客订单。不要付款，不要再打，不要改 v_phase，不要切 BUDGET_TIGHT。留下本行。把本行贴回。写着异常不是邀请去修。这不是卡 4 PASS，不要改写 §2.6。'
        WHEN NOT (
            known.known_order_present IS TRUE
            AND known.known_payment_pending IS TRUE
            AND known.known_reservation_released IS TRUE
            AND known.known_discount_still_1 IS TRUE
         )
            THEN '订单 GS2026092207342938190F2B83D5ACF 不在，或不再是未付款已释放，或抵扣不再是 1.00。不要改金额，不要付款，不要跑夹具，不要切 BUDGET_TIGHT。留下本行。把本行贴回。写着异常不是邀请去修。这不是卡 4 PASS，不要改写 §2.6。'
        WHEN NOT (
            c.promo10_rows = 1
            AND c.promo10_discount_type = 'percent'
            AND c.promo10_discount_value = 90
            AND c.promo10_allow_guest IS TRUE
            AND c.promo10_guest_max_uses = 50
            AND ROUND(c.promo10_guest_max_total_discount, 2) = 50.00
            AND c.promo10_max_uses = 0
            AND c.promo10_is_active IS TRUE
            AND c.promo10_lifecycle_status = 'active'
            AND c.promo10_applicable_site = 'cn'
            AND c.quota2_rows = 1
            AND c.quota2_discount_type = 'percent'
            AND c.quota2_discount_value = 90
            AND c.quota2_allow_guest IS TRUE
            AND c.quota2_guest_max_uses = 2
            AND ROUND(c.quota2_guest_max_total_discount, 2) = 30.00
            AND c.quota2_max_uses = 0
            AND c.quota2_is_active IS TRUE
            AND c.quota2_lifecycle_status = 'active'
            AND c.quota2_applicable_site = 'cn'
         )
            THEN '两张券不是各正好 1 行，或类型、结算比例、配额、站点、状态和上次回读对不上。留下本行。这一轮仍不要切 BUDGET_TIGHT，不要改券，不要跑夹具或 cleanup。写着异常不是邀请去修。这不是卡 4 PASS，不要改写 §2.6。'
        WHEN NOT (
            c.promo10_guest_used_count = 0
            AND ROUND(c.promo10_guest_discount_total, 2) = 0.00
            AND c.promo10_used_count = 0
            AND c.quota2_guest_used_count = 0
            AND ROUND(c.quota2_guest_discount_total, 2) = 0.00
            AND c.quota2_used_count = 0
            AND r.promo10_open_rows = 0
            AND ROUND(r.promo10_open_discount_amount, 2) = 0.00
            AND r.quota2_redemption_rows = 0
            AND r.quota2_open_rows = 0
            AND r.quota2_returned_rows = 0
            AND ROUND(r.quota2_open_discount_amount, 2) = 0.00
            AND ROUND(r.quota2_returned_discount_amount, 2) = 0.00
         )
            THEN '计数不是 0，或还有未归还台账。留下本行。这一轮仍不要切 BUDGET_TIGHT，不要改计数，不要跑夹具或 cleanup。写着异常不是邀请去修。这不是卡 4 PASS，不要改写 §2.6。'
        WHEN NOT (
            r.promo10_redemption_rows = 1
            AND r.promo10_returned_rows = 1
            AND ROUND(r.promo10_returned_discount_amount, 2) = 1.00
         )
            THEN '计数是 0，但台账形状和卡 7 到期归还对不上。留下本行。这一轮仍不要切 BUDGET_TIGHT，不要改台账，不要跑夹具或 cleanup。写着异常不是邀请去修。这不是卡 4 PASS，不要改写 §2.6。'
        ELSE '抄录通过。SBXPROMO10 与 SBXQUOTA2 的 guest_used_count、used_count、guest_discount_total 都是 0。SBXPROMO10 台账 1 行且已归还，抵扣 1.00；SBXQUOTA2 台账 0 行。这不是卡 4 PASS，不要改写 §2.6，不要切 BUDGET_TIGHT，不要跑夹具或 cleanup，不要打开熔断，不要打开游客开关，不要建单，不要付款。贴回本行。'
    END AS snapshot_verdict
FROM (SELECT 1) AS anchor
LEFT JOIN breaker b ON TRUE
CROSS JOIN events e
CROSS JOIN budgets bg
CROSS JOIN cd7
CROSS JOIN cd3
CROSS JOIN cd7_orders
CROSS JOIN cd3_orders
CROSS JOIN known
CROSS JOIN coupons c
CROSS JOIN redemptions r;
