-- ============================================================================
-- S154_fixture_setup.sql  ·  §15.4 九项沙箱验证 · 前置夹具（**会写库**）
-- ============================================================================
-- 性质：**写库**。只写 4 个地方，且全部可被 S154_cleanup.sql 还原：
--         (1) guest_shop_promo_budget   cn 行（enabled / daily / spent / date）
--         (2) guest_shop_promo_budget   intl 行（**强制关闭**，防串站）
--         (3) discount_codes 里 **SBX 前缀** 的 5 个游客列
--         (4) 什么都不做的断言（不通过就 RAISE，整块回滚）
--       **绝不写**：shop_products / shop_product_skus（商品与 SKU 的游客开关、
--       单价、库存全部由你在 Admin Studio 手工掌握）、guest_shop_orders、
--       guest_shop_discount_redemptions、guest_shop_buyers、任何密钥/pepper。
-- 执行者：**你**（Supabase SQL Editor）。Codex 不执行任何 SQL。
-- 幂等：可重复执行；每次执行都把 SBX 券的游客计数器归零、预算 spent 归零。
-- 目标库：**生产库**（沙箱 = 本地新代码 + 生产数据库 + 真实支付）。
--
-- ⚠️ 三条硬护栏（脚本自己会检查，这里先讲清楚为什么）
--   H-1 只碰 `code LIKE 'SBX%'` 的券。任何真实营销券都不在射程内。
--   H-2 熔断器（breaker）处于 open 时**拒绝执行**，不替你悄悄合闸。
--       合闸必须走 fn_guest_shop_promo_set_breaker('closed', ...)，
--       这样 guest_shop_promo_breaker_events 里才有 manual_close 审计行。
--   H-3 不修改商品/SKU。若单价或库存不满足要求，脚本 RAISE 并告诉你去
--       Admin Studio 改，而不是自己动手改生产商品。
--
-- 📌 关于「percent 券」的语义（**最容易踩的坑，务必先读**）
--   共享定价函数 public.fn_resolve_shop_discount_amount 对 percent 的算法是：
--       折后金额 = ROUND(原价 × discount_value / 100, 2)
--       抵扣金额 = 原价 - 折后金额
--   也就是说 `discount_value` 是**结算比例（付多少）**，不是「减多少」。
--   Admin Studio 的字段标签正是「结算比例」，提示文案：
--       「80 = 按原价 80% 结算，实际抵扣 20%」
--   ⇒ 想要 §15.4 第 1/2 项的「10% 券」，Admin Studio 里必须填 **90**。
--     填 10 会变成「抵扣 90%」，被游客通道的 50% 地板拦成
--     guest_discount_below_floor，对外统一显示「优惠码不可用」，
--     你会误判成功能坏了。
--   本脚本会把两张券的 discount_value 断言在 [50, 99] 区间内（= 最多打对折，
--   一定高于 50% 地板），并按你填的单价**算出期望抵扣额**打印到 NOTICE。
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 唯一需要你编辑的地方：下面 DO 块 DECLARE 里的「EDIT HERE」区。
-- 改完 **整块** 执行（DO 语句必须整体选中）。
-- 执行后看 Messages / 通知面板里的 RAISE NOTICE 汇总。
-- ----------------------------------------------------------------------------
DO $s154_fixture$
DECLARE
    -- ======================= EDIT HERE =======================
    -- 阶段（三选一，字符串必须完全一致）：
    --   'MAIN'         → cn 日预算 20.00，够跑第 1~8 项
    --   'BUDGET_TIGHT' → cn 日预算 1.00，专跑第 9 项：
    --                     第 1 次 ¥1.00 抵扣成功（spent 0→1.00），
    --                     第 2 次 gate 判 spent+1.00 > 1.00 → guest_promo_budget_exhausted
    --   'CLOSED'       → cn 预算关闭（等价于 cleanup 的预算部分，用于中途停测）
    v_phase                 TEXT    := 'MAIN';

    v_site                  TEXT    := 'cn';

    -- 从 S154_probe_readonly.sql 段 1 抄四个 UUID。
    -- 第 1 项用「¥0.01」SKU，第 2/3/4/5/7/8/9 项用「¥10.00」SKU。
    -- 两个可以是同一个商品下的不同 SKU，也可以是两个商品。
    v_penny_product_id      UUID    := NULL;   -- ← 填
    v_penny_sku_id          UUID    := NULL;   -- ← 填
    v_ten_product_id        UUID    := NULL;   -- ← 填
    v_ten_sku_id            UUID    := NULL;   -- ← 填

    -- 期望单价（脚本会**断言**数据库里的 price_points 正好等于这两个值；
    -- 不等就 RAISE，让你去 Admin Studio 改价，而不是脚本偷偷改价）。
    v_penny_expected_price  NUMERIC := 0.01;
    v_ten_expected_price    NUMERIC := 10.00;

    -- 两张沙箱券（**必须 SBX 前缀**，必须已在 Admin Studio 建好）。
    --   SBXPROMO10 → 主力券，percent 结算比例 90（= 抵扣 10%），配额放宽
    --   SBXQUOTA2  → 第 4 项专用，percent 结算比例 90，guest_max_uses = 2
    v_main_code             TEXT    := 'SBXPROMO10';
    v_quota_code            TEXT    := 'SBXQUOTA2';
    v_main_guest_max_uses   INTEGER := 50;
    v_quota_guest_max_uses  INTEGER := 2;
    -- 单券让利金额上限（CNY）。readiness 的脏券扫描把
    -- allow_guest=true AND guest_max_total_discount<=0 判为 INVALID(exit 2)，
    -- 所以这里必须给**显式正数**，不能用 0 表示「不限制」。
    v_main_money_cap        NUMERIC := 50.00;
    v_quota_money_cap       NUMERIC := 2.00;   -- 正好 2 次 × ¥1.00

    -- 每个被选中的 SKU 至少要有几张 available 且非共享的卡密。
    -- ¥10 SKU 要跑第 2(付) + 3(少付) + 4(×3) + 5(×2) + 7(不付) + 8 + 9，
    -- 建议 >= 10；¥0.01 SKU 只需要 1（第 1 项根本不会建单）。
    v_min_cards_ten         INTEGER := 10;
    v_min_cards_penny       INTEGER := 1;
    -- ===================== STOP EDITING =====================

    v_daily             NUMERIC(14,2);
    v_budget_enabled    BOOLEAN;
    v_rec               RECORD;
    v_sku_rec           RECORD;
    v_cards             INTEGER;
    v_breaker_state     TEXT;
    v_expected_discount NUMERIC(12,2);
    v_expected_net      NUMERIC(12,2);
    v_label             TEXT;
    v_redemptions_24h   INTEGER;
BEGIN
    -- ------------------------------------------------------------------
    -- 0 · 角色与阶段自检
    -- ------------------------------------------------------------------
    IF v_phase NOT IN ('MAIN', 'BUDGET_TIGHT', 'CLOSED') THEN
        RAISE EXCEPTION 'S154: v_phase 只能是 MAIN / BUDGET_TIGHT / CLOSED，当前=%', v_phase;
    END IF;
    IF v_site NOT IN ('cn', 'intl') THEN
        RAISE EXCEPTION 'S154: v_site 只能是 cn / intl，当前=%', v_site;
    END IF;

    v_daily          := CASE v_phase
                            WHEN 'MAIN'         THEN 20.00
                            WHEN 'BUDGET_TIGHT' THEN 1.00
                            ELSE 0
                        END;
    v_budget_enabled := (v_phase <> 'CLOSED');

    RAISE NOTICE 'S154 fixture 开始 · phase=% site=% daily=% enabled=%',
        v_phase, v_site, v_daily, v_budget_enabled;

    -- ------------------------------------------------------------------
    -- H-2 · 熔断器：open 时拒绝执行
    -- ------------------------------------------------------------------
    INSERT INTO public.guest_shop_promo_breaker (id, state)
    VALUES (1, 'closed')
    ON CONFLICT (id) DO NOTHING;

    SELECT b.state INTO v_breaker_state FROM public.guest_shop_promo_breaker b WHERE b.id = 1;
    IF COALESCE(v_breaker_state, 'closed') <> 'closed' THEN
        RAISE EXCEPTION
            'S154: 熔断器当前是 %，夹具拒绝在跳闸状态下改配置（否则你分不清"促销停了"是熔断还是预算）。'
            '请先执行第 8 项的恢复步骤：SELECT public.fn_guest_shop_promo_set_breaker(''closed'', ''S154 沙箱恢复'', ''<你的名字>'');'
            '（注意：SQL Editor 里直接调该函数需要 service_role 上下文，见 runbook §2.8）',
            v_breaker_state;
    END IF;
    RAISE NOTICE 'S154 · 熔断器 closed ✓';

    -- ------------------------------------------------------------------
    -- H-3 · 商品 / SKU 断言（只读，不改）
    -- ------------------------------------------------------------------
    IF v_penny_sku_id IS NULL OR v_ten_sku_id IS NULL
       OR v_penny_product_id IS NULL OR v_ten_product_id IS NULL THEN
        RAISE EXCEPTION
            'S154: 四个 UUID 还没填。先跑 S154_probe_readonly.sql 段 1，'
            '把 guest_ready=true 的商品/SKU id 抄进 EDIT HERE 区。';
    END IF;
    IF v_penny_sku_id = v_ten_sku_id THEN
        RAISE EXCEPTION 'S154: ¥0.01 与 ¥10.00 必须是两个不同的 SKU。';
    END IF;

    FOR v_rec IN
        SELECT * FROM (VALUES
            ('penny(¥0.01)', v_penny_product_id, v_penny_sku_id, v_penny_expected_price, v_min_cards_penny),
            ('ten(¥10.00)',  v_ten_product_id,   v_ten_sku_id,   v_ten_expected_price,   v_min_cards_ten)
        ) AS t(label, product_id, sku_id, expected_price, min_cards)
    LOOP
        SELECT p.id AS product_id, p.name AS product_name, p.is_active AS product_active,
               UPPER(BTRIM(COALESCE(p.delivery_type, ''))) AS delivery_type,
               COALESCE(p.manual_delivery, false) AS product_manual,
               s.id AS sku_id, s.sku_name, s.is_active AS sku_active,
               COALESCE(s.manual_delivery, false) AS sku_manual,
               s.price_points,
               COALESCE(s.allow_guest_purchase, p.allow_guest_purchase, false) AS effective_guest
        INTO v_sku_rec
        FROM public.shop_products p
        JOIN public.shop_product_skus s ON s.product_id = p.id
        WHERE s.id = v_rec.sku_id AND p.id = v_rec.product_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'S154[%]: 找不到 product_id=% / sku_id=% 这一对（id 抄错或不属于同一商品）。',
                v_rec.label, v_rec.product_id, v_rec.sku_id;
        END IF;

        IF v_sku_rec.product_active IS NOT TRUE OR v_sku_rec.sku_active IS NOT TRUE THEN
            RAISE EXCEPTION 'S154[%]: 商品或 SKU 未上架（product_active=%, sku_active=%）。去 Admin Studio 上架。',
                v_rec.label, v_sku_rec.product_active, v_sku_rec.sku_active;
        END IF;
        IF v_sku_rec.effective_guest IS NOT TRUE THEN
            RAISE EXCEPTION 'S154[%]: 该 SKU 的游客购买开关是关的（effective_guest=false）。'
                '去 Admin Studio 打开商品或 SKU 的 allow_guest_purchase。脚本不会替你开。', v_rec.label;
        END IF;
        IF v_sku_rec.delivery_type <> 'KEY' THEN
            RAISE EXCEPTION 'S154[%]: delivery_type=% 不是 KEY，游客通道不支持（loadGuestSkuPricing 会判 guest_ready=false）。',
                v_rec.label, v_sku_rec.delivery_type;
        END IF;
        IF v_sku_rec.product_manual OR v_sku_rec.sku_manual THEN
            RAISE EXCEPTION 'S154[%]: 人工发货商品不走游客自动发货，请换一个 SKU。', v_rec.label;
        END IF;
        IF v_sku_rec.price_points IS DISTINCT FROM v_rec.expected_price THEN
            RAISE EXCEPTION
                'S154[%]: SKU「%」的 price_points=% ，但本项要求 %。'
                '请在 Admin Studio 把该 SKU 的 CN 单价改成 %（脚本不改生产商品价格），'
                '或者把 EDIT HERE 区对应的 v_penny_expected_price / v_ten_expected_price '
                '改成实际值，并同步修改 runbook 里的期望金额。',
                v_rec.label, v_sku_rec.sku_name, v_sku_rec.price_points,
                v_rec.expected_price, v_rec.expected_price;
        END IF;

        SELECT COUNT(*)::INTEGER INTO v_cards
        FROM public.shop_inventory i
        WHERE i.sku_id = v_rec.sku_id
          AND i.product_id = v_rec.product_id
          AND i.status = 'available'
          AND COALESCE(i.is_shared, false) = false;

        IF v_cards < v_rec.min_cards THEN
            RAISE EXCEPTION
                'S154[%]: SKU「%」可用卡密只有 % 张（要求 >= %，且必须 status=available、is_shared=false）。'
                '去 Admin Studio 补卡密。脚本不会替你写库存。',
                v_rec.label, v_sku_rec.sku_name, v_cards, v_rec.min_cards;
        END IF;

        RAISE NOTICE 'S154[%] ✓ 商品=% SKU=% 单价=% 可用卡密=% 张',
            v_rec.label, v_sku_rec.product_name, v_sku_rec.sku_name,
            v_sku_rec.price_points, v_cards;
    END LOOP;

    -- ------------------------------------------------------------------
    -- 1 · 预算：cn 按 phase 打开，intl 强制关闭
    -- ------------------------------------------------------------------
    INSERT INTO public.guest_shop_promo_budget AS b (site, enabled, daily_budget_cny, spent_cny, budget_date, updated_at)
    VALUES (
        v_site,
        v_budget_enabled,
        v_daily,
        0,
        (now() AT TIME ZONE 'Asia/Shanghai')::DATE,
        clock_timestamp()
    )
    ON CONFLICT (site) DO UPDATE
       SET enabled          = EXCLUDED.enabled,
           daily_budget_cny = EXCLUDED.daily_budget_cny,
           spent_cny        = 0,
           budget_date      = EXCLUDED.budget_date,
           updated_at       = clock_timestamp();

    -- 另一站强制关闭：沙箱只跑一个站，避免 intl 侧被同一批券打到。
    INSERT INTO public.guest_shop_promo_budget AS b (site, enabled, daily_budget_cny, spent_cny, budget_date, updated_at)
    VALUES (
        CASE WHEN v_site = 'cn' THEN 'intl' ELSE 'cn' END,
        false, 0, 0,
        (now() AT TIME ZONE 'Asia/Shanghai')::DATE,
        clock_timestamp()
    )
    ON CONFLICT (site) DO UPDATE
       SET enabled          = false,
           daily_budget_cny = 0,
           spent_cny        = 0,
           budget_date      = EXCLUDED.budget_date,
           updated_at       = clock_timestamp();

    RAISE NOTICE 'S154 · 预算已设置：% enabled=% daily=% spent=0；另一站强制关闭',
        v_site, v_budget_enabled, v_daily;

    -- ------------------------------------------------------------------
    -- 2 · 两张 SBX 券：断言 + 打开游客四列
    -- ------------------------------------------------------------------
    FOREACH v_label IN ARRAY ARRAY['main', 'quota']
    LOOP
        DECLARE
            v_code        TEXT := CASE WHEN v_label = 'main' THEN v_main_code ELSE v_quota_code END;
            v_max_uses    INTEGER := CASE WHEN v_label = 'main' THEN v_main_guest_max_uses ELSE v_quota_guest_max_uses END;
            v_money_cap   NUMERIC := CASE WHEN v_label = 'main' THEN v_main_money_cap ELSE v_quota_money_cap END;
            v_c           RECORD;
            v_list_price  NUMERIC := v_ten_expected_price;
        BEGIN
            -- H-1 · 前缀护栏
            IF UPPER(BTRIM(v_code)) NOT LIKE 'SBX%' THEN
                RAISE EXCEPTION 'S154: 护栏 H-1 拦截 —— 券码「%」不是 SBX 前缀。'
                    '沙箱只允许操作 SBX* 专用券，请改 v_%_code。', v_code, v_label;
            END IF;
            IF UPPER(BTRIM(v_code)) <> BTRIM(v_code) THEN
                RAISE EXCEPTION 'S154: 券码常量必须大写（evaluate 会 UPPER 后精确匹配 d.code），当前=%', v_code;
            END IF;
            IF v_max_uses <= 0 THEN
                RAISE EXCEPTION 'S154: guest_max_uses 必须 > 0（0 在游客通道语义是「关闭」，不是「无限」）。';
            END IF;
            IF v_money_cap <= 0 THEN
                RAISE EXCEPTION 'S154: guest_max_total_discount 必须 > 0，否则 readiness 脏券扫描会判 INVALID(exit 2)。';
            END IF;

            SELECT d.code, d.discount_type, d.discount_value,
                   COALESCE(d.is_active, false)                       AS is_active,
                   COALESCE(NULLIF(BTRIM(COALESCE(d.lifecycle_status, '')), ''), 'active') AS lifecycle_status,
                   d.starts_at, d.expires_at, d.applicable_site,
                   COALESCE(d.max_uses, 0)                            AS max_uses,
                   COALESCE(d.used_count, 0)                          AS used_count,
                   COALESCE(d.max_uses_per_user, 0)                   AS max_uses_per_user,
                   COALESCE(d.allow_zero_total, false)                AS allow_zero_total,
                   COALESCE(d.max_discount_quantity, 0)               AS max_discount_quantity,
                   COALESCE(NULLIF(BTRIM(d.scope_type), ''), 'all')   AS scope_type,
                   d.scope_product_id, d.scope_product_sku_id, d.scope_category,
                   COALESCE(NULLIF(BTRIM(d.distribution_mode), ''), 'general_code') AS distribution_mode,
                   COALESCE(NULLIF(BTRIM(d.pricing_apply_stage), ''), 'order_discount') AS pricing_apply_stage,
                   d.audience_segment, d.is_exclusive
            INTO v_c
            FROM public.discount_codes d
            WHERE d.code = v_code;

            IF NOT FOUND THEN
                RAISE EXCEPTION
                    'S154: 券「%」不存在。请先在 Admin Studio 建好：类型=percent（百分比）、'
                    '结算比例=90（= 抵扣 10%%）、适用范围=全部商品、站点=%、max_uses 留空/0（不限）、'
                    '有效期覆盖今天、**不要**勾「允许全免」。建好后重跑本脚本。',
                    v_code, v_site;
            END IF;

            -- 共享引擎侧的前置条件。任何一条不满足，游客都会拿到统一的
            -- 「优惠码不可用」，而你在 HTTP/日志里看不到内部原因，所以这里提前拦。
            IF v_c.is_active IS NOT TRUE THEN
                RAISE EXCEPTION 'S154[%]: is_active=false，券未启用。', v_code;
            END IF;
            IF v_c.lifecycle_status IN ('archived', 'paused_manual', 'paused_risk') THEN
                RAISE EXCEPTION 'S154[%]: lifecycle_status=%，reserve 的 WHERE 会直接排除该券。', v_code, v_c.lifecycle_status;
            END IF;
            IF v_c.starts_at IS NOT NULL AND v_c.starts_at > clock_timestamp() THEN
                RAISE EXCEPTION 'S154[%]: 还没到生效时间 starts_at=%。', v_code, v_c.starts_at;
            END IF;
            IF v_c.expires_at IS NOT NULL AND v_c.expires_at < clock_timestamp() THEN
                RAISE EXCEPTION 'S154[%]: 已过期 expires_at=%。', v_code, v_c.expires_at;
            END IF;
            IF v_c.applicable_site IS NOT NULL AND v_c.applicable_site NOT IN (v_site, 'all') THEN
                RAISE EXCEPTION 'S154[%]: applicable_site=% 与沙箱站点 % 不匹配。', v_code, v_c.applicable_site, v_site;
            END IF;
            IF v_c.max_uses <> 0 THEN
                RAISE EXCEPTION
                    'S154[%]: max_uses=%（共享总配额）不是 0/不限。第 4 项要证明的是**游客配额**'
                    '（guest_max_uses）原子生效；若共享配额也在跑，两个计数器会互相掩盖，'
                    '你就分不清是哪一道闸拦下的。请把该券的 max_uses 设为不限。', v_code, v_c.max_uses;
            END IF;
            IF v_c.allow_zero_total IS NOT FALSE THEN
                RAISE EXCEPTION 'S154[%]: allow_zero_total=true。游客通道硬编码传 false（绝不零元购），'
                    '券本身也必须是 false，否则后台与游客两侧语义不一致。', v_code;
            END IF;
            IF LOWER(BTRIM(COALESCE(v_c.discount_type, ''))) <> 'percent' THEN
                RAISE EXCEPTION
                    'S154[%]: discount_type=%，本沙箱按 percent 设计（期望金额都是按结算比例算的）。'
                    '若要跑 fixed 券，请自行改 v_*_expected_price 与期望抵扣额。', v_code, v_c.discount_type;
            END IF;
            IF v_c.discount_value IS NULL OR v_c.discount_value < 50 OR v_c.discount_value > 99 THEN
                RAISE EXCEPTION
                    'S154[%]: discount_value=%（percent 的语义是**结算比例 = 付多少**）。'
                    '必须落在 [50,99]：<50 表示抵扣超过一半，会被游客通道的 50%% 地板拦成 '
                    'guest_discount_below_floor；>=100 表示不抵扣，会得到 guest_discount_no_effect。'
                    '两者对外都只显示「优惠码不可用」。要「抵扣 10%%」请填 90（= 打九折）。',
                    v_code, v_c.discount_value;
            END IF;
            IF v_c.scope_type = 'product'
               AND v_c.scope_product_id IS NOT NULL
               AND v_c.scope_product_id <> v_ten_product_id
               AND v_c.scope_product_id <> v_penny_product_id THEN
                RAISE EXCEPTION 'S154[%]: scope_type=product 但 scope_product_id=% 不在本沙箱选中的两个商品内。',
                    v_code, v_c.scope_product_id;
            END IF;
            IF v_c.scope_type = 'product' AND v_c.scope_product_sku_id IS NOT NULL
               AND v_c.scope_product_sku_id <> v_ten_sku_id
               AND v_c.scope_product_sku_id <> v_penny_sku_id THEN
                RAISE EXCEPTION 'S154[%]: scope_product_sku_id=% 不在本沙箱选中的两个 SKU 内。',
                    v_code, v_c.scope_product_sku_id;
            END IF;
            -- 下面三列游客评估路径**没有**显式过滤（fn_guest_shop_evaluate_discount
            -- 只把 scope/site/lifecycle/window/max_uses/max_uses_per_user 委托给
            -- fn_validate_discount_code_core）。所以夹具必须把它们钉在安全值上，
            -- 否则一张 user_assigned / balance_offset / 带人群包的券被开了
            -- allow_guest，就会在游客侧产生计划里没有的行为。
            IF v_c.distribution_mode <> 'general_code' THEN
                RAISE EXCEPTION 'S154[%]: distribution_mode=%。游客侧不校验该列，请改成 general_code'
                    '（public_claim / user_assigned 依赖账号资产，对匿名买家没有意义）。', v_code, v_c.distribution_mode;
            END IF;
            IF v_c.pricing_apply_stage <> 'order_discount' THEN
                RAISE EXCEPTION 'S154[%]: pricing_apply_stage=%。游客只支持 order_discount；'
                    'balance_offset 需要余额（游客没有），catalog_price 会改商品价。', v_code, v_c.pricing_apply_stage;
            END IF;
            IF v_c.audience_segment IS NOT NULL AND BTRIM(v_c.audience_segment) <> '' THEN
                RAISE EXCEPTION 'S154[%]: audience_segment=% 非空。人群包对匿名买家不可验证，'
                    '游客侧也不校验该列，必须清空。', v_code, v_c.audience_segment;
            END IF;
            IF COALESCE(v_c.is_exclusive, false) THEN
                RAISE EXCEPTION 'S154[%]: is_exclusive=true。互斥语义在游客侧无对照实现，请关掉。', v_code;
            END IF;

            -- 打开游客四列并归零计数器。单条 UPDATE：新行同时满足
            -- discount_codes_guest_caps_check（used<=max、total<=cap）。
            UPDATE public.discount_codes d
            SET allow_guest              = true,
                guest_max_uses           = v_max_uses,
                guest_used_count         = 0,
                guest_max_total_discount = v_money_cap,
                guest_discount_total     = 0,
                used_count               = 0
            WHERE d.code = v_code;

            -- 期望金额（按共享函数的真实算法算，不是按 runbook 抄）
            v_expected_net      := ROUND((v_list_price * v_c.discount_value) / 100, 2);
            v_expected_net      := GREATEST(0, LEAST(v_list_price, v_expected_net));
            v_expected_discount := ROUND(v_list_price - v_expected_net, 2);

            RAISE NOTICE
                'S154[%] ✓ 券=% percent 结算比例=% → ¥% 商品：抵扣 ¥% / 折后 ¥%（游客配额 % 次、单券让利上限 ¥%）',
                v_label, v_code, v_c.discount_value, v_list_price,
                v_expected_discount, v_expected_net, v_max_uses, v_money_cap;

            IF v_label = 'main' AND v_expected_discount <> 1.00 THEN
                RAISE WARNING
                    'S154[main]: ¥10 商品的期望抵扣是 ¥%（不是 ¥1.00）。'
                    '第 2 项的「应付 = 折后 + 通道费」与第 9 项 BUDGET_TIGHT 的 daily=1.00 '
                    '都按 ¥1.00 设计，请同步修改 runbook 与 v_phase 预算。', v_expected_discount;
            END IF;
            IF v_label = 'quota' AND v_expected_discount * v_max_uses > v_money_cap THEN
                RAISE EXCEPTION
                    'S154[quota]: 期望抵扣 ¥% × 配额 % = ¥% 超过单券让利上限 ¥%，'
                    '第 4 项会先撞金额上限而不是撞次数上限。请调大 v_quota_money_cap。',
                    v_expected_discount, v_max_uses, v_expected_discount * v_max_uses, v_money_cap;
            END IF;
        END;
    END LOOP;

    -- ------------------------------------------------------------------
    -- 3 · 24h 限流余量提醒（只读）
    --     per-contact 3 次 / per-IP 10 次，都是 fn_guest_shop_*_discount 的
    --     **硬编码默认值**，没有 env 旋钮。整轮九项大约消耗 9 次成功抵扣，
    --     也就是说 per-IP 只剩 1 次余量。这里把当前已用量打印出来。
    -- ------------------------------------------------------------------
    SELECT COUNT(*)::INTEGER INTO v_redemptions_24h
    FROM public.guest_shop_discount_redemptions
    WHERE created_at >= clock_timestamp() - INTERVAL '24 hours';
    RAISE NOTICE 'S154 · 近 24h 全站已有 % 条游客抵扣台账。上限是**硬编码**的：'
        'per-IP 10 次 / per-contact(邮箱) 3 次，没有 env 旋钮。整轮九项约消耗 9 次成功抵扣，'
        'per-IP 只剩约 1 次余量；余量不足时后面几项会返回 guest_discount_rate_limited，'
        '那是限流不是 bug（用 toolbox 的 evaluate 子命令可以零消耗地看内部原因）。', v_redemptions_24h;

    RAISE NOTICE 'S154 fixture 完成 · phase=% · 现在可以按 runbook 顺序执行九项', v_phase;
END;
$s154_fixture$;


-- ----------------------------------------------------------------------------
-- 回读报告（**单独执行这一段**；DO 块不返回结果集）
-- 期望：
--   budget_cn     enabled=true daily=20.00(或 1.00) spent=0.00 date=今天
--   budget_intl   enabled=false daily=0 spent=0
--   breaker       state=closed，opened_at/opened_by 均为 NULL
--   两张 SBX 券   allow_guest=true，guest_used_count=0，guest_discount_total=0，
--                 guest_max_uses>0，guest_max_total_discount>0
-- ----------------------------------------------------------------------------
SELECT '1_budget' AS section, b.site, b.enabled, b.daily_budget_cny, b.spent_cny, b.budget_date,
       (b.enabled AND b.daily_budget_cny > 0) AS gate_would_allow
FROM public.guest_shop_promo_budget b
ORDER BY b.site;

SELECT '2_breaker' AS section, br.id, br.state, br.reason, br.opened_at, br.opened_by,
       br.closed_at, br.closed_by,
       br.mismatch_trip_threshold, br.identity_trip_threshold, br.trip_window_seconds
FROM public.guest_shop_promo_breaker br
WHERE br.id = 1;

SELECT '3_coupons' AS section, d.code, d.discount_type, d.discount_value,
       d.allow_guest, d.guest_max_uses, d.guest_used_count,
       d.guest_max_total_discount, d.guest_discount_total,
       d.max_uses, d.used_count, d.is_active, d.lifecycle_status,
       d.applicable_site, d.starts_at, d.expires_at, d.allow_zero_total,
       -- readiness 脏券扫描口径：allow_guest=true AND (guest_max_uses=0 OR cap<=0)
       (d.allow_guest AND (d.guest_max_uses = 0 OR d.guest_max_total_discount <= 0)) AS is_dirty_coupon
FROM public.discount_codes d
WHERE d.code LIKE 'SBX%'
ORDER BY d.code;

-- 4 · gate 输入的等价只读预览。
--    **故意不直接调 public.guest_shop_promo_gate()**：它内部第一件事是
--    guest_shop_require_service_role()，而该函数读的是 auth.role()（即
--    request.jwt.claim(s) GUC），SQL Editor 里默认解析成 'anon'，直接调会
--    抛 'guest shop RPC requires service_role'。要看 gate 的真实返回，用
--    toolbox：node supabase/sandbox/s154-guest-promo-toolbox.js gate --amount 1.00
--    （走 PostgREST + service_role JWT，一定成功）。
SELECT '4_gate_inputs' AS section,
       (SELECT br.state FROM public.guest_shop_promo_breaker br WHERE br.id = 1) AS breaker_state,
       b.site,
       b.enabled,
       b.daily_budget_cny,
       b.budget_date,
       CASE WHEN b.budget_date = (now() AT TIME ZONE 'Asia/Shanghai')::DATE
            THEN COALESCE(b.spent_cny, 0) ELSE 0 END                            AS effective_spent,
       CASE WHEN b.budget_date = (now() AT TIME ZONE 'Asia/Shanghai')::DATE
            THEN ROUND(b.daily_budget_cny - COALESCE(b.spent_cny, 0), 2)
            ELSE b.daily_budget_cny END                                          AS remaining_cny,
       -- 复刻 gate 的判定顺序，便于一眼看出「下一次 ¥1.00 抵扣会不会被拦」
       CASE
           WHEN COALESCE((SELECT br.state FROM public.guest_shop_promo_breaker br WHERE br.id = 1), 'closed') <> 'closed'
               THEN 'guest_promo_halted'
           WHEN b.enabled IS NOT TRUE OR b.daily_budget_cny <= 0
               THEN 'guest_promo_budget_closed'
           WHEN (CASE WHEN b.budget_date = (now() AT TIME ZONE 'Asia/Shanghai')::DATE
                      THEN COALESCE(b.spent_cny, 0) ELSE 0 END) + 1.00 > b.daily_budget_cny
               THEN 'guest_promo_budget_exhausted'
           ELSE 'allowed(for a 1.00 discount)'
       END                                                                       AS gate_verdict_for_1cny
FROM public.guest_shop_promo_budget b
ORDER BY b.site;
