-- S154 卡 9：只把已有 cn 日预算上限从 20.00 收到 1.00。Codex 不执行。
-- 整份执行。不要只跑最后一条 SELECT。不要改 v_phase，不要切 BUDGET_TIGHT。
-- 不跑夹具，不跑 cleanup。不新增行。不改已用、启用开关、日期、intl、券、台账、熔断、商品或游客开关。
-- 不读取联系方式、来源地址、凭据、会话、支付链接、卡密或查询口令。
-- 以「收紧半步通过」开头，才表示这一次从 20.00 收到 1.00。这不是卡 9 整卡 PASS。
-- 以「本次没有再改」开头不是失败。不要为了再看到第一句把 20.00 写回去。
-- 以「看不清」开头表示没有本次标记。不要手工改数字。
-- 1.00 会留在这行上，过了 2026-09-22 也不会自己回到 20.00。恢复是以后单独的一步。
-- 上海当天不是 2026-09-22 时直接中止，不要猜数字。

DO $cd9$
DECLARE
    v_guard text := $guard$
WITH today AS (
    SELECT ((now() AT TIME ZONE 'Asia/Shanghai')::date = DATE '2026-09-22') AS today_ok
),
breaker AS (
    SELECT
        (b.id IS NOT NULL) AS present,
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
    FROM (SELECT 1) AS anchor
    LEFT JOIN public.guest_shop_promo_breaker b ON b.id = 1
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
        BTRIM(p.name) AS product_name,
        BTRIM(s.sku_name) AS sku_name,
        s.price_points,
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
        BTRIM(p.name) AS product_name,
        BTRIM(s.sku_name) AS sku_name,
        s.price_points,
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
        COALESCE(BOOL_AND(o.site = 'cn'), false) AS known_site_cn,
        COALESCE(BOOL_AND(o.quantity = 1), false) AS known_qty_1,
        COALESCE(BOOL_AND(o.payment_status = 'pending'), false) AS known_payment_pending,
        COALESCE(BOOL_AND(o.fulfillment_status = 'pending'), false) AS known_unfulfilled,
        COALESCE(BOOL_AND(o.refund_status = 'none'), false) AS known_unrefunded,
        COALESCE(BOOL_AND(o.reservation_status = 'released'), false) AS known_reservation_released,
        COALESCE(BOOL_AND(ROUND(o.discount_amount, 2) = 1.00), false) AS known_discount_still_1,
        COALESCE(BOOL_AND(ROUND(o.list_unit_amount, 2) = 10.00), false) AS known_list_10,
        COALESCE(BOOL_AND(ROUND(o.unit_amount, 2) = 9.00), false) AS known_net_9,
        COALESCE(BOOL_AND(ROUND(COALESCE(o.payment_fee_amount, 0), 2) = 0.09), false) AS known_fee_009,
        COALESCE(BOOL_AND(ROUND(o.total_amount, 2) = 9.09), false) AS known_total_909,
        COALESCE(BOOL_AND(UPPER(BTRIM(COALESCE(o.discount_code, ''))) = 'SBXPROMO10'), false) AS known_code
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
),
flags AS (
    SELECT
        t.today_ok,
        (
            br.present IS TRUE
            AND br.state = 'closed'
            AND br.state_exclusive_ok IS TRUE
            AND br.reason IS NULL
            AND br.opened_at IS NULL
            AND br.opened_by IS NULL
            AND br.closed_by = 's154-card8'
            AND br.closed_at = TIMESTAMPTZ '2026-09-22 09:18:20.678679+00'
            AND br.mismatch_trip_threshold = 3
            AND br.identity_trip_threshold = 20
            AND br.trip_window_seconds = 900
        ) AS breaker_ok,
        (
            e.event_count = 2
            AND e.manual_open_count = 1
            AND e.manual_close_count = 1
            AND e.manual_open_matched = 1
            AND e.manual_close_matched = 1
            AND e.auto_open_count = 0
            AND e.amount_mismatch_count = 0
            AND e.identity_limit_hit_count = 0
            AND e.budget_exhausted_count = 0
            AND e.code_exhausted_count = 0
        ) AS events_ok,
        (
            bg.cn_rows = 1
            AND bg.cn_enabled IS TRUE
            AND ROUND(bg.cn_spent_cny, 2) = 0.00
            AND bg.cn_budget_date = DATE '2026-09-22'
            AND bg.intl_rows = 1
            AND bg.intl_enabled IS FALSE
            AND ROUND(bg.intl_daily_budget_cny, 2) = 0.00
            AND ROUND(bg.intl_spent_cny, 2) = 0.00
            AND bg.intl_budget_date = DATE '2026-09-22'
        ) AS budget_shape_ok,
        (
            cd7.present IS TRUE
            AND cd7.product_name = '沙箱CD7'
            AND cd7.sku_name = '默认规格'
            AND ROUND(cd7.price_points, 2) = 10.00
            AND cd7.effective_guest IS FALSE
            AND cd7.product_guest_off IS TRUE
            AND cd7.sku_guest_unset IS TRUE
            AND cd3.present IS TRUE
            AND cd3.product_name = '沙箱CD3'
            AND cd3.sku_name = '默认规格'
            AND ROUND(cd3.price_points, 2) = 3.00
            AND cd3.effective_guest IS FALSE
            AND cd3.product_guest_off IS TRUE
            AND cd3.sku_guest_unset IS TRUE
        ) AS products_ok,
        (
            cd7_orders.guest_orders = 1
            AND cd7_orders.paid_like_orders = 0
            AND cd3_orders.guest_orders = 0
            AND k.known_order_present IS TRUE
            AND k.known_site_cn IS TRUE
            AND k.known_qty_1 IS TRUE
            AND k.known_payment_pending IS TRUE
            AND k.known_unfulfilled IS TRUE
            AND k.known_unrefunded IS TRUE
            AND k.known_reservation_released IS TRUE
            AND k.known_discount_still_1 IS TRUE
            AND k.known_list_10 IS TRUE
            AND k.known_net_9 IS TRUE
            AND k.known_fee_009 IS TRUE
            AND k.known_total_909 IS TRUE
            AND k.known_code IS TRUE
        ) AS orders_ok,
        (
            c.promo10_rows = 1
            AND c.promo10_discount_type = 'percent'
            AND c.promo10_discount_value = 90
            AND c.promo10_allow_guest IS TRUE
            AND c.promo10_guest_max_uses = 50
            AND ROUND(c.promo10_guest_max_total_discount, 2) = 50.00
            AND c.promo10_guest_used_count = 0
            AND ROUND(c.promo10_guest_discount_total, 2) = 0.00
            AND c.promo10_max_uses = 0
            AND c.promo10_used_count = 0
            AND c.promo10_is_active IS TRUE
            AND c.promo10_lifecycle_status = 'active'
            AND c.promo10_applicable_site = 'cn'
            AND c.quota2_rows = 1
            AND c.quota2_discount_type = 'percent'
            AND c.quota2_discount_value = 90
            AND c.quota2_allow_guest IS TRUE
            AND c.quota2_guest_max_uses = 2
            AND ROUND(c.quota2_guest_max_total_discount, 2) = 30.00
            AND c.quota2_guest_used_count = 0
            AND ROUND(c.quota2_guest_discount_total, 2) = 0.00
            AND c.quota2_max_uses = 0
            AND c.quota2_used_count = 0
            AND c.quota2_is_active IS TRUE
            AND c.quota2_lifecycle_status = 'active'
            AND c.quota2_applicable_site = 'cn'
            AND r.promo10_redemption_rows = 1
            AND r.promo10_open_rows = 0
            AND r.promo10_returned_rows = 1
            AND ROUND(r.promo10_open_discount_amount, 2) = 0.00
            AND ROUND(r.promo10_returned_discount_amount, 2) = 1.00
            AND r.quota2_redemption_rows = 0
            AND r.quota2_open_rows = 0
            AND r.quota2_returned_rows = 0
            AND ROUND(r.quota2_open_discount_amount, 2) = 0.00
            AND ROUND(r.quota2_returned_discount_amount, 2) = 0.00
        ) AS coupons_ok,
        bg.cn_daily_budget_cny
    FROM today t
    CROSS JOIN breaker br
    CROSS JOIN events e
    CROSS JOIN budgets bg
    CROSS JOIN cd7
    CROSS JOIN cd3
    CROSS JOIN cd7_orders
    CROSS JOIN cd3_orders
    CROSS JOIN known k
    CROSS JOIN coupons c
    CROSS JOIN redemptions r
)
SELECT
    (
        f.today_ok
        AND f.breaker_ok
        AND f.events_ok
        AND f.budget_shape_ok
        AND f.products_ok
        AND f.orders_ok
        AND f.coupons_ok
    ) AS context_ok,
    CASE
        WHEN NOT f.today_ok
            THEN '上海当天不是 2026-09-22。不要收紧，不要猜数字。把报错贴回。写着异常不是邀请去修。'
        WHEN NOT f.breaker_ok
            THEN '熔断不是这次合闸。closed_by 应为 s154-card8，closed_at 应为 2026-09-22 09:18:20.678679+00，熔断行原因应为空。不要再合一次，不要打开熔断。写着异常不是邀请去修。'
        WHEN NOT f.events_ok
            THEN '熔断事件不是 manual_open=1 且 manual_close=1，或审计对不上 s154-card8。不要补事件，不要再打开，不要再合一次。写着异常不是邀请去修。'
        WHEN NOT f.budget_shape_ok
            THEN '日预算形状不对。CN 应启用、已用 0.00、日期 2026-09-22；intl 应关闭且金额 0.00。不要改 intl，不要改已用。写着异常不是邀请去修。'
        WHEN NOT f.products_ok
            THEN '沙箱CD7 或沙箱CD3 的名称、单价或游客开关对不上。不要打开游客开关，不要改价。写着异常不是邀请去修。'
        WHEN NOT f.orders_ok
            THEN '订单 GS2026092207342938190F2B83D5ACF 的金额或状态对不上，或沙箱订单数变了。不要改金额，不要付款，不要再建。写着异常不是邀请去修。'
        WHEN NOT f.coupons_ok
            THEN 'SBXPROMO10 或 SBXQUOTA2 的配额、计数或台账对不上。不要改券，不要跑夹具或 cleanup。写着异常不是邀请去修。'
        ELSE NULL
    END AS fail_reason,
    f.cn_daily_budget_cny
FROM flags f
$guard$;
    v_ok boolean;
    v_reason text;
    v_daily numeric;
    v_n bigint;
BEGIN
    EXECUTE v_guard INTO v_ok, v_reason, v_daily;
    IF v_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'S154: %', COALESCE(v_reason, '守卫没有通过。不要收紧，不要建单，不要付款。写着异常不是邀请去修。');
    END IF;

    IF ROUND(v_daily, 2) = 1.00 THEN
        RAISE NOTICE 'S154: CN 日预算已经是 1.00，本次没有再改。不要把 20.00 写回去。';
        PERFORM set_config('s154.cd9_budget_tighten', 'already', false);
    ELSIF ROUND(v_daily, 2) = 20.00 THEN
        UPDATE public.guest_shop_promo_budget AS b
           SET daily_budget_cny = 1.00,
               updated_at = clock_timestamp()
         WHERE b.site = 'cn'
           AND b.enabled IS TRUE
           AND ROUND(b.daily_budget_cny, 2) = 20.00
           AND ROUND(b.spent_cny, 2) = 0.00
           AND b.budget_date = DATE '2026-09-22';
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n IS DISTINCT FROM 1 THEN
            RAISE EXCEPTION 'S154: 日预算没有改到正好 1 行（实际 %）。这一笔会撤回。不要手工再改，不要建单，不要付款。写着异常不是邀请去修。', v_n;
        END IF;
        EXECUTE v_guard INTO v_ok, v_reason, v_daily;
        IF v_ok IS NOT TRUE OR ROUND(v_daily, 2) IS DISTINCT FROM 1.00 THEN
            RAISE EXCEPTION 'S154: 收紧后守卫没有停在 1.00（%）。这一笔会撤回。不要猜数字，不要建单，不要付款。写着异常不是邀请去修。', COALESCE(v_reason, '日预算不是 1.00');
        END IF;
        PERFORM set_config('s154.cd9_budget_tighten', 'updated', false);
        RAISE NOTICE 'S154: CN 日预算已从 20.00 收到 1.00。这不是卡 9 整卡 PASS。不要建单，不要付款。';
    ELSE
        RAISE EXCEPTION 'S154: CN 日预算既不是 20.00 也不是 1.00（实际 %）。不要猜数字，不要把 20.00 写回去，不要建单，不要付款。写着异常不是邀请去修。', COALESCE(v_daily::text, '空');
    END IF;
END
$cd9$;

WITH breaker AS (
    SELECT b.state, b.closed_by
    FROM public.guest_shop_promo_breaker b
    WHERE b.id = 1
),
budgets AS (
    SELECT
        BOOL_OR(enabled) FILTER (WHERE site = 'cn') AS cn_enabled,
        MAX(daily_budget_cny) FILTER (WHERE site = 'cn') AS cn_daily_budget_cny,
        MAX(spent_cny) FILTER (WHERE site = 'cn') AS cn_spent_cny,
        MAX(budget_date) FILTER (WHERE site = 'cn') AS cn_budget_date,
        BOOL_OR(enabled) FILTER (WHERE site = 'intl') AS intl_enabled,
        MAX(daily_budget_cny) FILTER (WHERE site = 'intl') AS intl_daily_budget_cny,
        MAX(spent_cny) FILTER (WHERE site = 'intl') AS intl_spent_cny,
        MAX(budget_date) FILTER (WHERE site = 'intl') AS intl_budget_date
    FROM public.guest_shop_promo_budget
)
SELECT
    current_setting('s154.cd9_budget_tighten', true) AS tighten_marker,
    b.state AS breaker_state,
    b.closed_by,
    bg.cn_enabled,
    ROUND(bg.cn_daily_budget_cny, 2) AS cn_daily_budget_cny,
    ROUND(bg.cn_spent_cny, 2) AS cn_spent_cny,
    bg.cn_budget_date,
    bg.intl_enabled,
    ROUND(bg.intl_daily_budget_cny, 2) AS intl_daily_budget_cny,
    ROUND(bg.intl_spent_cny, 2) AS intl_spent_cny,
    bg.intl_budget_date,
    CASE
        WHEN current_setting('s154.cd9_budget_tighten', true) = 'updated'
         AND ROUND(bg.cn_daily_budget_cny, 2) = 1.00
         AND ROUND(bg.cn_spent_cny, 2) = 0.00
         AND bg.cn_budget_date = DATE '2026-09-22'
         AND bg.cn_enabled IS TRUE
         AND bg.intl_enabled IS FALSE
         AND ROUND(bg.intl_daily_budget_cny, 2) = 0.00
         AND ROUND(bg.intl_spent_cny, 2) = 0.00
         AND b.state = 'closed'
            THEN '收紧半步通过。CN 日预算从 20.00 收到 1.00，已用仍是 0.00，日期仍是 2026-09-22，intl 仍关闭，熔断仍是 closed。这不是卡 9 整卡 PASS。不要建单，不要付款，不要打开游客开关，不要把 20.00 写回去。第二次整份重跑看到「本次没有再改」不是失败。'
        WHEN current_setting('s154.cd9_budget_tighten', true) = 'already'
         AND ROUND(bg.cn_daily_budget_cny, 2) = 1.00
         AND ROUND(bg.cn_spent_cny, 2) = 0.00
         AND bg.cn_enabled IS TRUE
            THEN '本次没有再改。CN 日预算已经是 1.00，这次没有再写。不要为了再看到「收紧半步通过」把 20.00 写回去。这不是失败，也不是卡 9 整卡 PASS。不要建单，不要付款。'
        ELSE '看不清。没有本次标记。请整份执行本文件，不要只跑最后这条 SELECT。若前面的 NOTICE 已经说收到 1.00，这不是失败，不要把 20.00 写回去；整份再跑应看到「本次没有再改」。写着异常不是邀请去修。这不是卡 9 整卡 PASS。'
    END AS tighten_verdict
FROM budgets bg
LEFT JOIN breaker b ON TRUE;
