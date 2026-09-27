-- ============================================================================
-- S154_cleanup.sql  ·  §15.4 九项沙箱验证 · 收尾还原（**会写库**）
-- ============================================================================
-- 用途：九项跑完（或中途叫停）之后，把沙箱动过的**配置**还原成"游客促销未启用"
--       的安全默认态，让生产库回到 readiness 可复跑、脏券扫描为 0 的干净状态。
--
-- 执行者：**你**（Supabase SQL Editor）。Codex 不执行任何 SQL。
-- 目标库：**生产库**（沙箱 = 本地新代码 + 生产数据库 + 真实支付）。
-- 幂等：可重复执行，执行 N 次结果相同。
--
-- ----------------------------------------------------------------------------
-- 本脚本**只写** 4 个地方（与 S154_fixture_setup.sql 的写入面严格对齐）：
--   (1) discount_codes 里 **SBX 前缀** 两张券的 5 个游客列 + used_count
--   (2) guest_shop_promo_budget  cn 行与 intl 行（都关：enabled=false, daily=0, spent=0）
--   (3) guest_shop_promo_breaker id=1（仅当它还是 open 时合闸，并补一条审计行）
--   (4) guest_shop_buyers.registered_user_match → false
--       （**仅**当你在 v_reset_buyer_ids 里显式列出 buyer id；默认空数组 = 不碰）
--
-- 本脚本**绝不写 / 绝不删**：
--   ✗ shop_products / shop_product_skus / shop_inventory（商品、SKU、卡密）
--   ✗ guest_shop_orders（游客订单）
--   ✗ guest_shop_discount_redemptions（折扣台账）
--   ✗ guest_shop_payment_events（支付事件）
--   ✗ 任何密钥 / pepper / claim secret / 卡密内容
--
-- ----------------------------------------------------------------------------
-- ⚠️ 三条必须知道的"不还原"
--
--   N-1 **台账与订单默认保留，这是有意的。**
--       guest_shop_discount_redemptions 与 guest_shop_orders 是财务审计证据，
--       §15.5 的归档要求恰恰是"把它们留在库里、把数字抄进 evidence 文档"。
--       删掉它们等于删掉你自己的实机证据。本脚本只**汇总**它们（见文末 R4/R5），
--       不做任何 DELETE。
--
--   N-2 **卡密不会被归还。**
--       第 2 项真实付款后，那张卡密已经发货、已经属于买家，是真销售。
--       第 7 项的 TTL 归还走的是 worker（fn_guest_shop_release_expired_reservations），
--       不是 cleanup。要人工退款/补发/解锁，走
--       docs/guest-shop-payment-fulfillment-runbook.md 的后台流程，
--       **不要**用 SQL 直接改 shop_inventory.status（会绕过归还函数的幂等 claim，
--       把同一份预算/库存退两次）。
--
--   N-3 **24h 限流额度不会被清零。**
--       per-contact(邮箱) 3 次 / per-IP 10 次是 fn_guest_shop_evaluate_discount /
--       fn_guest_shop_reserve_discount 的**硬编码默认值**，没有 env 旋钮，
--       计数来源就是 redemption 台账的行数。既然 N-1 不删台账，额度就只能等
--       24 小时自然滚出窗口。**同一天想重跑一整轮九项，请换出口 IP 或等到明天。**
--
-- ----------------------------------------------------------------------------
-- 🔒 护栏（脚本自己会检查）
--   H-1 只碰 `code LIKE 'SBX%'` 的券。任何真实营销券都不在射程内；
--       两个码里只要有一个不是 SBX 前缀，整块 RAISE 回滚，什么都不改。
--   H-4 合闸必须留痕。若熔断器当前是 open，本脚本按
--       fn_guest_shop_promo_set_breaker 的 closed 分支**逐字段**还原
--       （state/reason/opened_at/opened_by/closed_at/closed_by/updated_at），
--       并**补插一条 kind='manual_close' 的审计行**到
--       guest_shop_promo_breaker_events，避免出现"状态是 closed 但审计链断了"
--       的静默合闸。detail 里不含 email / contact_hash / 任何密钥
--       （受 guest_shop_promo_breaker_events_detail_no_secrets_check 约束）。
--       更推荐的路径是走函数（会自动写事件）：
--         node supabase/sandbox/s154-guest-promo-toolbox.js breaker closed \
--              --actor "<你的名字>" --reason "S154 沙箱收尾"
--   H-5 不改商品、不改 SKU、不改卡密。若你发现单价/库存被沙箱改乱了，
--       去 Admin Studio 手工改，本脚本不会替你做。
--
-- ----------------------------------------------------------------------------
-- 📌 关于「还原后 readiness 应该是什么结果」
--   allow_guest=false 之后，脏券扫描（allow_guest=true AND (guest_max_uses=0 OR
--   guest_max_total_discount<=0)）自动为 0 条 → `--fail-on-invalid` 应保持 EXIT 0。
--   注意：本脚本把 guest_max_uses 与 guest_max_total_discount 都归零，
--   这是**安全默认**（游客通道对该券彻底关闭），不是脏配置——脏配置的判据里
--   第一个条件就是 allow_guest=true。R1 会把 is_dirty_coupon 打出来供你核对。
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 唯一需要你编辑的地方：下面 DO 块 DECLARE 里的「EDIT HERE」区。
-- 改完 **整块** 执行（DO 语句必须整体选中）。
-- 执行后看 Messages / 通知面板里的 RAISE NOTICE 汇总，再单独跑文末 R1~R6。
-- ----------------------------------------------------------------------------
DO $s154_cleanup$
DECLARE
    -- ======================= EDIT HERE =======================
    -- 与 S154_fixture_setup.sql 里保持一致的两张沙箱券
    v_main_code              TEXT    := 'SBXPROMO10';
    v_quota_code             TEXT    := 'SBXQUOTA2';

    -- 熔断器：若第 8 项跑完你忘了合闸，这里兜底关掉。
    -- 设 false 则本脚本完全不碰 breaker（想走 toolbox/函数路径时用）。
    v_close_breaker          BOOLEAN := true;
    v_breaker_actor          TEXT    := 's154-cleanup';   -- >= 2 字符，会写进 closed_by

    -- 是否把熔断阈值也恢复成出厂默认（3 / 20 / 900）。
    -- 只有你在第 3/8 项里为了"更容易跳闸"手工调小过阈值时才需要 true。
    v_reset_breaker_thresholds BOOLEAN := false;

    -- 是否顺手把两张 SBX 券整体停用（is_active=false）。
    -- 默认 false。设 true 之后 S154_fixture_setup.sql 会拒绝执行
    -- （它断言 is_active=true），下次重跑沙箱得先去 Admin Studio 重新启用。
    v_also_deactivate        BOOLEAN := false;

    -- 第 5 项 (c) 可选演示：如果你手工把某个 buyer 的 registered_user_match
    -- 改成过 true，把那些 buyer id 填进来（探针段 10 能查到）。
    -- 默认空数组 = 完全不碰 guest_shop_buyers。
    -- 例：v_reset_buyer_ids UUID[] := ARRAY['11111111-1111-1111-1111-111111111111']::UUID[];
    v_reset_buyer_ids        UUID[]  := ARRAY[]::UUID[];

    -- R4/R5 汇总报告的时间窗口（小时）。默认 24 = 只看今天这一轮。
    v_ledger_window_hours    INTEGER := 24;
    -- ===================== STOP EDITING =====================

    v_label              TEXT;
    v_code               TEXT;
    v_prev_state         TEXT;
    v_coupon_rows        INTEGER;
    v_budget_rows        INTEGER;
    v_breaker_rows       INTEGER;
    v_buyer_rows         INTEGER;
    v_event_rows         INTEGER;
    v_ledger_standing    INTEGER;
    v_ledger_returned    INTEGER;
    v_ledger_total       NUMERIC(14,2);
    v_orders_paid        INTEGER;
    v_orders_unpaid      INTEGER;
    v_rejected_events    INTEGER;
BEGIN
    -- ------------------------------------------------------------------
    -- 0 · 参数自检 + H-1 前缀护栏
    -- ------------------------------------------------------------------
    IF char_length(BTRIM(COALESCE(v_breaker_actor, ''))) < 2 THEN
        RAISE EXCEPTION 'S154 cleanup: v_breaker_actor 至少 2 个字符（要写进 closed_by 做审计），当前=%',
            COALESCE(v_breaker_actor, '<NULL>');
    END IF;
    IF COALESCE(v_ledger_window_hours, 0) < 1 OR v_ledger_window_hours > 720 THEN
        RAISE EXCEPTION 'S154 cleanup: v_ledger_window_hours 只能在 1~720 之间，当前=%',
            COALESCE(v_ledger_window_hours, 0);
    END IF;

    FOREACH v_label IN ARRAY ARRAY['main', 'quota']
    LOOP
        v_code := CASE WHEN v_label = 'main' THEN v_main_code ELSE v_quota_code END;
        IF COALESCE(BTRIM(v_code), '') !~ '^SBX' THEN
            RAISE EXCEPTION
                'S154 cleanup: 护栏 H-1 拦截 —— 券码「%」不是 SBX 前缀。'
                '本脚本只还原沙箱券，拒绝改动任何真实营销券。整块已回滚，什么都没改。',
                COALESCE(v_code, '<NULL>');
        END IF;
    END LOOP;

    IF v_main_code = v_quota_code THEN
        RAISE EXCEPTION 'S154 cleanup: 两个券码不能相同（当前都是 %）。', v_main_code;
    END IF;

    RAISE NOTICE 'S154 cleanup 开始 · 券=% / % · 合闸=% · 停用券=% · 还原 buyer 行数=%',
        v_main_code, v_quota_code, v_close_breaker, v_also_deactivate,
        COALESCE(array_length(v_reset_buyer_ids, 1), 0);

    -- ------------------------------------------------------------------
    -- 1 · 两张 SBX 券：关闭游客通道，计数器归零
    --     单条 UPDATE 即可满足 discount_codes_guest_caps_check：
    --       (guest_max_uses = 0 OR guest_used_count <= guest_max_uses)
    --       (guest_max_total_discount = 0 OR guest_discount_total <= cap)
    --     两边都是 0 → 两个分支的前件成立 → 约束通过。
    --     ⚠️ discount_codes **没有 updated_at 列**，别顺手加。
    -- ------------------------------------------------------------------
    UPDATE public.discount_codes d
    SET allow_guest              = false,
        guest_max_uses           = 0,
        guest_used_count         = 0,
        guest_max_total_discount = 0,
        guest_discount_total     = 0,
        used_count               = 0,
        is_active                = CASE WHEN v_also_deactivate THEN false ELSE d.is_active END
    WHERE d.code = ANY (ARRAY[v_main_code, v_quota_code]);
    GET DIAGNOSTICS v_coupon_rows = ROW_COUNT;

    IF v_coupon_rows <> 2 THEN
        RAISE WARNING
            'S154 cleanup: 只匹配到 % 张券（期望 2 张）。缺失的那张可能根本没建，'
            '或者券码拼写与 fixture 不一致 —— 请核对 Admin Studio。', v_coupon_rows;
    END IF;

    RAISE NOTICE 'S154 cleanup · 券已还原 % 张：allow_guest=false，游客配额/让利上限/计数器全部归零%',
        v_coupon_rows,
        CASE WHEN v_also_deactivate THEN '，且 is_active=false（整体停用）' ELSE '' END;

    -- ------------------------------------------------------------------
    -- 2 · 预算：两站都关（cn + intl）
    --     guest_shop_promo_budget_amount_check 要求
    --       daily_budget_cny >= 0 AND (daily = 0 OR spent <= daily)
    --     daily=0 且 spent=0 → 通过。
    -- ------------------------------------------------------------------
    INSERT INTO public.guest_shop_promo_budget AS b (site, enabled, daily_budget_cny, spent_cny, budget_date, updated_at)
    VALUES
        ('cn',   false, 0, 0, (now() AT TIME ZONE 'Asia/Shanghai')::DATE, clock_timestamp()),
        ('intl', false, 0, 0, (now() AT TIME ZONE 'Asia/Shanghai')::DATE, clock_timestamp())
    ON CONFLICT (site) DO UPDATE
       SET enabled          = false,
           daily_budget_cny = 0,
           spent_cny        = 0,
           budget_date      = EXCLUDED.budget_date,
           updated_at       = clock_timestamp();
    GET DIAGNOSTICS v_budget_rows = ROW_COUNT;

    RAISE NOTICE 'S154 cleanup · 预算已关闭 % 行（cn + intl，enabled=false / daily=0 / spent=0）',
        v_budget_rows;

    -- ------------------------------------------------------------------
    -- 3 · 熔断器：open → closed（H-4，必须留痕）
    -- ------------------------------------------------------------------
    INSERT INTO public.guest_shop_promo_breaker (id, state)
    VALUES (1, 'closed')
    ON CONFLICT (id) DO NOTHING;

    v_prev_state := NULL;
    SELECT b.state INTO v_prev_state FROM public.guest_shop_promo_breaker b WHERE b.id = 1;

    v_breaker_rows := 0;
    v_event_rows   := 0;

    IF v_close_breaker AND COALESCE(v_prev_state, 'closed') = 'open' THEN
        -- 逐字段复刻 fn_guest_shop_promo_set_breaker 的 closed 分支
        UPDATE public.guest_shop_promo_breaker
        SET state      = 'closed',
            reason     = NULL,
            opened_at  = NULL,
            opened_by  = NULL,
            closed_at  = clock_timestamp(),
            closed_by  = LEFT(BTRIM(v_breaker_actor), 120),
            updated_at = clock_timestamp(),
            mismatch_trip_threshold = CASE WHEN v_reset_breaker_thresholds THEN 3   ELSE mismatch_trip_threshold END,
            identity_trip_threshold = CASE WHEN v_reset_breaker_thresholds THEN 20  ELSE identity_trip_threshold END,
            trip_window_seconds     = CASE WHEN v_reset_breaker_thresholds THEN 900 ELSE trip_window_seconds END
        WHERE id = 1
          AND state = 'open';
        GET DIAGNOSTICS v_breaker_rows = ROW_COUNT;

        IF v_breaker_rows > 0 THEN
            INSERT INTO public.guest_shop_promo_breaker_events (kind, site, detail, occurred_at)
            VALUES (
                'manual_close',
                NULL,
                jsonb_build_object(
                    'actor',          LEFT(BTRIM(v_breaker_actor), 120),
                    'reason',         'S154 sandbox cleanup',
                    'previous_state', 'open',
                    'source',         'raw_sql_fallback'
                ),
                clock_timestamp()
            );
            GET DIAGNOSTICS v_event_rows = ROW_COUNT;
        END IF;

        RAISE NOTICE 'S154 cleanup · 熔断器 open → closed（审计行 +%）', v_event_rows;
    ELSIF v_close_breaker THEN
        -- 已经是 closed。阈值还原仍然可选执行。
        IF v_reset_breaker_thresholds THEN
            UPDATE public.guest_shop_promo_breaker
            SET mismatch_trip_threshold = 3,
                identity_trip_threshold = 20,
                trip_window_seconds     = 900,
                updated_at              = clock_timestamp()
            WHERE id = 1;
            GET DIAGNOSTICS v_breaker_rows = ROW_COUNT;
            RAISE NOTICE 'S154 cleanup · 熔断器已是 closed，阈值已恢复出厂默认（3 / 20 / 900）';
        ELSE
            RAISE NOTICE 'S154 cleanup · 熔断器已是 closed，无需处理';
        END IF;
    ELSE
        RAISE NOTICE 'S154 cleanup · v_close_breaker=false，跳过熔断器（当前状态=%）',
            COALESCE(v_prev_state, '<missing>');
    END IF;

    -- ------------------------------------------------------------------
    -- 4 · 可选：第 5 项 (c) 演示过的 registered_user_match 还原
    --     只碰显式列出的 id，绝不按时间/站点批量扫。
    -- ------------------------------------------------------------------
    v_buyer_rows := 0;
    IF COALESCE(array_length(v_reset_buyer_ids, 1), 0) > 0 THEN
        UPDATE public.guest_shop_buyers
        SET registered_user_match = false,
            updated_at            = clock_timestamp()
        WHERE id = ANY (v_reset_buyer_ids)
          AND registered_user_match IS DISTINCT FROM false;
        GET DIAGNOSTICS v_buyer_rows = ROW_COUNT;
        RAISE NOTICE 'S154 cleanup · registered_user_match 已还原 % 行（你列了 % 个 id）',
            v_buyer_rows, array_length(v_reset_buyer_ids, 1);
    ELSE
        RAISE NOTICE 'S154 cleanup · 未提供 v_reset_buyer_ids，guest_shop_buyers 未被触碰';
    END IF;

    -- ------------------------------------------------------------------
    -- 5 · 本轮沙箱痕迹汇总（只读，写进 NOTICE 方便你直接抄进 evidence）
    -- ------------------------------------------------------------------
    SELECT COUNT(*) FILTER (WHERE r.returned_at IS NULL)::INTEGER,
           COUNT(*) FILTER (WHERE r.returned_at IS NOT NULL)::INTEGER,
           COALESCE(SUM(r.discount_amount) FILTER (WHERE r.returned_at IS NULL), 0)
      INTO v_ledger_standing, v_ledger_returned, v_ledger_total
    FROM public.guest_shop_discount_redemptions r
    WHERE r.code LIKE 'SBX%'
      AND r.created_at >= clock_timestamp() - (v_ledger_window_hours || ' hours')::INTERVAL;

    SELECT COUNT(*) FILTER (WHERE o.payment_status = 'paid')::INTEGER,
           COUNT(*) FILTER (WHERE COALESCE(o.payment_status, '') <> 'paid')::INTEGER
      INTO v_orders_paid, v_orders_unpaid
    FROM public.guest_shop_orders o
    WHERE COALESCE(o.discount_code, '') LIKE 'SBX%'
      AND o.created_at >= clock_timestamp() - (v_ledger_window_hours || ' hours')::INTERVAL;

    SELECT COUNT(*)::INTEGER INTO v_rejected_events
    FROM public.guest_shop_payment_events e
    WHERE e.processing_status = 'rejected'
      AND e.created_at >= clock_timestamp() - (v_ledger_window_hours || ' hours')::INTERVAL;

    RAISE NOTICE
        'S154 cleanup · 近 % 小时沙箱痕迹（**保留，不删**）：SBX 台账 % 条（仍生效 % 条 / 已归还 % 条，'
        '生效中的抵扣合计 ¥%）；SBX 订单 % 笔（已付 % / 未付 %）；rejected 支付事件 % 条',
        v_ledger_window_hours,
        COALESCE(v_ledger_standing, 0) + COALESCE(v_ledger_returned, 0),
        COALESCE(v_ledger_standing, 0), COALESCE(v_ledger_returned, 0), COALESCE(v_ledger_total, 0),
        COALESCE(v_orders_paid, 0) + COALESCE(v_orders_unpaid, 0),
        COALESCE(v_orders_paid, 0), COALESCE(v_orders_unpaid, 0), COALESCE(v_rejected_events, 0);

    RAISE NOTICE
        'S154 cleanup 完成。下一步：① 跑文末 R1~R6 逐项核对；'
        '② npm run readiness:guest-shop -- --env-file server/.env.production --fail-on-invalid 应仍为 EXIT 0；'
        '③ 把 R1~R6 与九项结果抄进 docs/guest-shop-promo-evidence.md。'
        '提醒：卡密不归还（N-2）、台账不删（N-1）、24h 限流额度不清零（N-3）。';
END;
$s154_cleanup$;


-- ============================================================================
-- 回读报告（**单独执行下面这些 SELECT**；DO 块不返回结果集）
-- ============================================================================

-- ----------------------------------------------------------------------------
-- R1 · 两张 SBX 券：还原后必须是"游客通道彻底关闭"
--   期望：allow_guest=false，guest_max_uses=0，guest_used_count=0，
--         guest_max_total_discount=0，guest_discount_total=0，used_count=0，
--         is_dirty_coupon=**false**（readiness 脏券扫描 0 条）
-- ----------------------------------------------------------------------------
SELECT '1_coupons' AS section,
       d.code,
       d.discount_type,
       d.discount_value,
       d.allow_guest,
       d.guest_max_uses,
       d.guest_used_count,
       d.guest_max_total_discount,
       d.guest_discount_total,
       d.max_uses,
       d.used_count,
       d.is_active,
       d.lifecycle_status,
       d.applicable_site,
       d.starts_at,
       d.expires_at,
       -- readiness 脏券扫描口径：allow_guest=true AND (guest_max_uses=0 OR cap<=0)
       (d.allow_guest AND (d.guest_max_uses = 0 OR d.guest_max_total_discount <= 0)) AS is_dirty_coupon,
       -- 还原是否彻底的单行判定
       (NOT d.allow_guest
        AND d.guest_max_uses = 0
        AND d.guest_used_count = 0
        AND d.guest_max_total_discount = 0
        AND d.guest_discount_total = 0)                                              AS fully_reset
FROM public.discount_codes d
WHERE d.code LIKE 'SBX%'
ORDER BY d.code;


-- ----------------------------------------------------------------------------
-- R2 · 预算 + 熔断器单行
--   期望：cn/intl 均 enabled=false daily=0 spent=0；
--         breaker state=closed，opened_at/opened_by 均 NULL（CHECK 要求），
--         closed_at/closed_by 有值（谁关的、什么时候关的）
-- ----------------------------------------------------------------------------
SELECT '2_budget' AS section, b.site, b.enabled, b.daily_budget_cny, b.spent_cny,
       b.budget_date, b.updated_at,
       (b.enabled IS FALSE AND b.daily_budget_cny = 0 AND b.spent_cny = 0) AS fully_closed
FROM public.guest_shop_promo_budget b
ORDER BY b.site;

SELECT '3_breaker' AS section, br.id, br.state, br.reason,
       br.opened_at, br.opened_by, br.closed_at, br.closed_by,
       br.mismatch_trip_threshold, br.identity_trip_threshold, br.trip_window_seconds,
       br.updated_at,
       (br.state = 'closed' AND br.opened_at IS NULL AND br.opened_by IS NULL) AS closed_shape_ok,
       (br.mismatch_trip_threshold = 3 AND br.identity_trip_threshold = 20
        AND br.trip_window_seconds = 900)                                      AS thresholds_are_defaults
FROM public.guest_shop_promo_breaker br
WHERE br.id = 1;


-- ----------------------------------------------------------------------------
-- R3 · 熔断事件审计链（第 8 项 + cleanup 合闸应都在这里留痕）
--   期望：manual_open 与 manual_close **成对**出现；
--         cleanup 走 raw SQL 合闸时 detail.source='raw_sql_fallback'，
--         走 toolbox/函数时 detail 里没有该字段（两种都算合规，只要链条不断）
-- ----------------------------------------------------------------------------
SELECT '4_breaker_events' AS section,
       e.id, e.kind, e.site, e.detail, e.occurred_at,
       (e.detail ->> 'source') AS close_source
FROM public.guest_shop_promo_breaker_events e
WHERE e.kind IN ('manual_open', 'manual_close', 'auto_open')
ORDER BY e.occurred_at DESC
LIMIT 20;

SELECT '5_breaker_event_tally' AS section,
       e.kind,
       COUNT(*)                       AS n,
       MIN(e.occurred_at)             AS first_at,
       MAX(e.occurred_at)             AS last_at
FROM public.guest_shop_promo_breaker_events e
GROUP BY e.kind
ORDER BY e.kind;


-- ----------------------------------------------------------------------------
-- R4 · 本轮沙箱台账汇总（**归档用数字**；这些行保留在库里，不删）
--   still_standing = 抵扣仍然生效（占券配额与日预算）
--   returned       = 已被 TTL/退款归还（第 7 项的证据）
-- ----------------------------------------------------------------------------
SELECT '6_redemption_ledger' AS section,
       r.code,
       COUNT(*)                                                     AS rows_total,
       COUNT(*) FILTER (WHERE r.returned_at IS NULL)                AS still_standing,
       COUNT(*) FILTER (WHERE r.returned_at IS NOT NULL)            AS returned,
       COALESCE(SUM(r.discount_amount), 0)                          AS discount_sum_all,
       COALESCE(SUM(r.discount_amount) FILTER (WHERE r.returned_at IS NULL), 0)
                                                                    AS discount_sum_standing,
       MIN(r.created_at)                                            AS first_at,
       MAX(r.created_at)                                            AS last_at,
       COUNT(DISTINCT r.buyer_contact_hash)                         AS distinct_contacts,
       COUNT(DISTINCT r.request_ip_hash)                            AS distinct_ips
FROM public.guest_shop_discount_redemptions r
WHERE r.code LIKE 'SBX%'
GROUP BY r.code
ORDER BY r.code;


-- ----------------------------------------------------------------------------
-- R5 · 本轮沙箱订单汇总（**归档用数字**；第 1 项断言"¥0.01 不新增订单行"、
--      第 2 项断言"9.09 已付并发货"、第 3 项断言"少付被拒不发货"都从这里抄）
--   隐私：不输出 claim_secret_hash / contact_hash 全文，只给前 12 位。
-- ----------------------------------------------------------------------------
SELECT '7_orders' AS section,
       o.order_no,
       o.site,
       o.quantity,
       o.discount_code,
       o.list_unit_amount,
       o.unit_amount,
       o.discount_amount,
       o.payment_fee_amount,
       o.total_amount,
       o.currency,
       o.payment_status,
       o.fulfillment_status,
       o.refund_status,
       o.reservation_status,
       LEFT(COALESCE(o.buyer_contact_hash, ''), 12)                 AS contact_hash_12,
       o.expires_at,
       o.created_at,
       -- 三个安全属性的单行复核
       (o.total_amount > 0)                                         AS not_zero_purchase,
       (ROUND(COALESCE(o.unit_amount, 0) * COALESCE(o.quantity, 1), 2)
        + COALESCE(o.payment_fee_amount, 0) = o.total_amount)       AS amounts_self_consistent,
       (o.discount_amount IS NULL
        OR o.discount_amount <= ROUND(COALESCE(o.list_unit_amount, 0)
                                      * COALESCE(o.quantity, 1) * 0.5, 2))
                                                                    AS within_50pct_cap
FROM public.guest_shop_orders o
WHERE COALESCE(o.discount_code, '') LIKE 'SBX%'
ORDER BY o.created_at DESC
LIMIT 40;


-- ----------------------------------------------------------------------------
-- R6 · 第 5 项 (c) 演示是否已还原（只有你填过 v_reset_buyer_ids 才需要看）
--   期望：所有 registered_user_match 都是 false（公网下单路径恒定传 null → false）
-- ----------------------------------------------------------------------------
SELECT '8_buyers' AS section,
       b.id,
       b.site,
       LEFT(b.contact_hash, 12)                                     AS contact_hash_12,
       b.credential_group_no,
       b.registered_user_match,
       b.merged_into_user_id,
       b.created_at,
       b.updated_at,
       (SELECT COUNT(*) FROM public.guest_shop_orders o WHERE o.buyer_id = b.id) AS orders_owned
FROM public.guest_shop_buyers b
WHERE b.registered_user_match IS TRUE
ORDER BY b.created_at DESC
LIMIT 25;

-- ============================================================================
-- 收尾清单（跑完 R1~R6 之后逐条打勾）
--   □ R1 两张 SBX 券 fully_reset=true、is_dirty_coupon=false
--   □ R2 两站预算 fully_closed=true；breaker closed_shape_ok=true
--   □ R3 manual_open / manual_close 成对，审计链没断
--   □ R4/R5 数字已抄进 docs/guest-shop-promo-evidence.md
--   □ R6 结果为空（没有任何 registered_user_match=true 残留）
--   □ 商品/SKU 的游客开关已在 Admin Studio 关回（本脚本不碰，H-5）
--   □ readiness --fail-on-invalid 仍为 EXIT 0；--fail-on-not-ready 仍为 EXIT 3
--     （EXIT 3 是**期望的 fail-closed 结果**，不是失败，别用 || true 绕过）
--   □ 本地 preview 进程已停（GUEST_SHOP_DISCOUNT_ENABLED 等临时 env 一起消失）
-- ============================================================================
