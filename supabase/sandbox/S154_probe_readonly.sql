-- ============================================================================
-- S154_probe_readonly.sql  ·  §15.4 九项沙箱验证 · 只读盘点
-- ============================================================================
-- 性质：**完全只读**。全文没有 INSERT / UPDATE / DELETE / DROP / ALTER /
--       CREATE / TRUNCATE / GRANT / REVOKE，可以反复跑、随时跑。
-- 执行者：**你**（Supabase SQL Editor，service_role）。Codex 不执行任何 SQL。
-- 目标库：**生产库**。本仓库 `npm run preview:local` 的 env 链
--         （server/.env.staging → server/.env → .env → .env.local →
--          .vercel/.env.production.local）实测全部指向同一个生产项目，
--         所以"沙箱"= 本地新代码 + 生产数据库 + 真实支付。
-- 用法：**逐段执行**（每段一条 SELECT）。SQL Editor 一次跑全文只会重点展示
--       最后一个结果集，分段跑才看得全。**先跑段 0**：它告诉你本文件哪些段
--       能在 SQL Editor 里跑、哪一段必须改用配套工具箱（原因见段 0）。
-- 隐私：本文件**绝不** SELECT `shop_inventory.content`（卡密正文）、
--       `guest_shop_buyers.password_hash`、任何 claim secret / pepper。
--       涉及买家的地方只输出 hash 前 12 位与布尔/时间戳。
-- 配套文档：docs/guest-shop-promo-sandbox-runbook.md
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 段 0 · 执行身份自检（**先跑这一段**，否则段 4 会白报一个看不懂的错）
--
-- 为什么需要它：促销侧所有 SECURITY DEFINER 函数的第一行都是
--       PERFORM public.guest_shop_require_service_role();
-- 这个守卫的判据是 auth.role() <> 'service_role' 就 RAISE
-- （定义见 supabase/migrations/20260913_guest_shop_atomic_rpcs.sql:481-492）。
-- auth.role() 读的是 PostgREST 从 JWT 注入的 GUC：
--       request.jwt.claim.role / request.jwt.claims->>'role' / request.role
-- **Supabase SQL Editor 里这几个 GUC 全是空**，于是 auth.role() 回退成 'anon' ——
-- 哪怕 current_user 是 postgres（表 owner，读写这些表毫无问题），调函数也一定报：
--       ERROR:  guest shop RPC requires service_role
-- 这不是迁移没落库，也不是权限配错，是「执行身份」与「函数要求的身份」不是一回事。
--
-- 由此得到本文件的分工（**记住这一条就不会白折腾**）：
--   ✓ SQL Editor 能跑：段 0~3、段 5~17 —— 纯读表 / 读 pg_catalog，owner 权限足够
--   ✗ SQL Editor 跑不了：段 4（SELECT fn_guest_shop_promo_status()），以及任何
--     直接调 fn_guest_shop_evaluate_discount / guest_shop_promo_gate /
--     fn_guest_shop_promo_set_breaker / fn_guest_shop_promo_record_event 的语句
--     → 一律改用配套工具箱（它走 PostgREST + service_role JWT，auth.role()
--       天然就是 'service_role'）：
--         node supabase/sandbox/s154-guest-promo-toolbox.js status
--         node supabase/sandbox/s154-guest-promo-toolbox.js gate --site cn --amount 1.00
--         node supabase/sandbox/s154-guest-promo-toolbox.js breaker open --actor <你> --reason <原因> --yes
--
-- 期望（在 Supabase SQL Editor 里）：
--   sql_editor_is_service_role = **false**  ← 这是正常结果，不是故障
--   promo_tables_present       = true
--   role_guard_fn_present      = true
--   verdict                    = 「…必须改用工具箱…」那一条
-- 若 promo_tables_present / role_guard_fn_present 为 false，说明迁移没落库：
-- 先看段 16，再按 runbook §1.3 依次执行三个 SQL 文件。
-- ----------------------------------------------------------------------------
WITH role_probe AS (
    -- 与 auth.role() 的取值顺序逐字对齐（claim.role → claims->>'role' →
    -- request.role → 'anon'）。claims 那一项先用正则确认它长得像 JSON 对象
    -- 再 ::jsonb，这样即使某个环境把它设成了非 JSON 字符串，本段也不会抛错。
    SELECT COALESCE(
               NULLIF(current_setting('request.jwt.claim.role', true), ''),
               CASE
                   WHEN COALESCE(current_setting('request.jwt.claims', true), '') ~ '^\s*\{'
                       THEN current_setting('request.jwt.claims', true)::jsonb ->> 'role'
               END,
               NULLIF(current_setting('request.role', true), ''),
               'anon'
           ) AS auth_role_replica
)
SELECT
    current_user                                              AS sql_editor_current_user,
    session_user                                              AS sql_editor_session_user,
    r.auth_role_replica                                       AS auth_role_replica,
    (NULLIF(current_setting('request.jwt.claims', true), '') IS NOT NULL)
                                                              AS jwt_claims_guc_present,
    (r.auth_role_replica = 'service_role')                    AS sql_editor_is_service_role,
    (to_regclass('public.guest_shop_promo_breaker')      IS NOT NULL
     AND to_regclass('public.guest_shop_promo_budget')   IS NOT NULL
     AND to_regclass('public.guest_shop_promo_breaker_events') IS NOT NULL)
                                                              AS promo_tables_present,
    EXISTS (SELECT 1
              FROM pg_catalog.pg_proc f
              JOIN pg_catalog.pg_namespace n ON n.oid = f.pronamespace
             WHERE n.nspname = 'public'
               AND f.proname = 'guest_shop_require_service_role')
                                                              AS role_guard_fn_present,
    CASE
        WHEN r.auth_role_replica = 'service_role'
            THEN '当前会话就是 service_role：段 4 可以直接在这里跑（与工具箱等价）'
        ELSE '当前会话不是 service_role（SQL Editor 的正常状态）：段 4 与一切 fn_guest_shop_* / guest_shop_promo_gate 调用必须改用 s154-guest-promo-toolbox.js；其余各段照常在这里跑'
    END                                                       AS verdict
FROM role_probe r;


-- ----------------------------------------------------------------------------
-- 段 1 · 游客可购商品 / SKU 盘点（第 1、2 项选 SKU 用）
--
-- 看什么：
--   effective_guest  = COALESCE(sku.allow_guest_purchase, product.allow_guest_purchase)
--   guest_ready      = 游客通道真正可用的六个条件（对齐 loadGuestSkuPricing:1118）
--                      product.is_active / sku.is_active / effective_guest /
--                      delivery_type='KEY' / 两边都不是 manual_delivery / 单价可解析
--   price_points     = **CN 站游客单价的权威来源**（不是 guest_cash_price_cny！
--                      L1 之后 CN 单价走 sku.price_points，见迁移 §4）
--   inv_by_status    = 该 SKU 的卡密库存按状态分组计数（available / reserve /
--                      sold / frozen …）。第 2 项要"真发货"，所以必须挑
--                      available >= 1 的 SKU。
-- 挑选建议：
--   第 1 项（¥0.01）：任选一个 guest_ready=true 且 available>=1 的 SKU
--   第 2 项（¥10.00）：**另选一个** guest_ready=true 且 available>=2 的 SKU
--                      （第 2 项真付 1 张 + 第 3 项少付 1 张）
--   把两者的 id 与 price_points 抄进 S154_fixture_setup.sql 的常量块。
-- ----------------------------------------------------------------------------
SELECT
    p.id                                                          AS product_id,
    p.name                                                        AS product_name,
    p.is_active                                                   AS product_active,
    p.delivery_type,
    COALESCE(p.manual_delivery, false)                            AS product_manual,
    p.guest_max_quantity                                          AS product_guest_max_qty,
    p.max_purchase_quantity,
    p.flash_sale_price,
    p.flash_sale_end,
    s.id                                                          AS sku_id,
    s.sku_name,
    s.sku_code,
    s.is_active                                                   AS sku_active,
    COALESCE(s.manual_delivery, false)                            AS sku_manual,
    s.is_default,
    s.price_points,
    s.price_points_intl,
    s.guest_max_quantity                                          AS sku_guest_max_qty,
    s.stock_count,
    COALESCE(s.allow_guest_purchase, p.allow_guest_purchase, false) AS effective_guest,
    (
        p.is_active
        AND s.is_active
        AND COALESCE(s.allow_guest_purchase, p.allow_guest_purchase, false)
        AND UPPER(BTRIM(COALESCE(p.delivery_type, ''))) = 'KEY'
        AND COALESCE(p.manual_delivery, false) = false
        AND COALESCE(s.manual_delivery, false) = false
        AND s.price_points IS NOT NULL
        AND s.price_points > 0
    )                                                             AS guest_ready,
    inv.inv_by_status
FROM public.shop_products p
JOIN public.shop_product_skus s ON s.product_id = p.id
LEFT JOIN LATERAL (
    SELECT COALESCE(jsonb_object_agg(x.status, x.n) ORDER BY x.status, x.n), '{}'::jsonb) AS inv_by_status
    FROM (
        SELECT i.status, COUNT(*) AS n
        FROM public.shop_inventory i
        WHERE i.sku_id = s.id
        GROUP BY i.status
    ) x
) inv ON true
WHERE COALESCE(s.allow_guest_purchase, p.allow_guest_purchase, false) = true
   OR p.allow_guest_purchase = true
ORDER BY p.name, s.sort_order, s.created_at;


-- ----------------------------------------------------------------------------
-- 段 2 · 第 6 项（H2 入参白名单）· 逐字段明细
--
-- 原理：pg_get_function_arguments() 返回的是**函数签名**。签名里没有的字段，
--       函数体再怎么改写也拿不到 —— 这比读源码强，因为源码可以被后续迁移改掉，
--       而签名一改所有调用点都会炸。
-- 期望：present_in_signature **全为 false**（14 行 = 2 个函数 × 7 个身份字段）。
-- 字段清单与 docs/guest-shop-order-access-2.0.md §16.1 对齐；
-- guest_shop_buyers 已无 order_count 列（该文档 §5.1），故不在清单内。
-- 判定：本段全 false + 段 3 的 h2_violation_count = 0 → 第 6 项 PASS。
-- ----------------------------------------------------------------------------
WITH fn_args AS (
    SELECT p.proname,
           pg_catalog.pg_get_function_arguments(p.oid) AS args
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('guest_shop_resolve_credit_unit_amount',
                        'fn_resolve_shop_discount_amount')
),
identity_fields(f) AS (
    VALUES ('registered_user_match'), ('merged_into_user_id'), ('buyer_id'),
           ('credential_group_no'), ('failed_login_count'), ('last_login_at'),
           ('email_verified_at')
)
SELECT
    fa.proname,
    i.f                                                            AS identity_field,
    (POSITION(i.f IN LOWER(fa.args)) > 0)                          AS present_in_signature,
    fa.args                                                        AS full_signature
FROM fn_args fa
CROSS JOIN identity_fields i
ORDER BY fa.proname, i.f;


-- ----------------------------------------------------------------------------
-- 段 3 · 第 6 项（H2）· 单行判定（归档时直接抄这一行）
--
-- 期望：functions_inspected = 2，h2_violation_count = 0，verdict = 'PASS'
-- 若 functions_inspected < 2 → 迁移没落库或函数被改名，先查 §2.5 的 23 行 verify。
-- ----------------------------------------------------------------------------
WITH fn_args AS (
    SELECT p.proname,
           pg_catalog.pg_get_function_arguments(p.oid) AS args
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('guest_shop_resolve_credit_unit_amount',
                        'fn_resolve_shop_discount_amount')
),
identity_fields(f) AS (
    VALUES ('registered_user_match'), ('merged_into_user_id'), ('buyer_id'),
           ('credential_group_no'), ('failed_login_count'), ('last_login_at'),
           ('email_verified_at')
),
hits AS (
    SELECT fa.proname, i.f
    FROM fn_args fa
    CROSS JOIN identity_fields i
    WHERE POSITION(i.f IN LOWER(fa.args)) > 0
)
SELECT
    (SELECT COUNT(*) FROM fn_args)                                 AS functions_inspected,
    (SELECT COUNT(*) FROM hits)                                    AS h2_violation_count,
    (SELECT COALESCE(string_agg(proname || ':' || f, ', ' ORDER BY proname, f), 'none') FROM hits)
                                                                   AS violations,
    CASE
        WHEN (SELECT COUNT(*) FROM fn_args) < 2 THEN 'INCONCLUSIVE(函数缺失)'
        WHEN (SELECT COUNT(*) FROM hits) = 0    THEN 'PASS'
        ELSE 'FAIL'
    END                                                            AS verdict;


-- ----------------------------------------------------------------------------
-- 段 4 · 促销全局状态（第 8、9 项的基线与复核）
--
-- ⛔ **本段在 Supabase SQL Editor 里跑不通**，会报：
--       ERROR: guest shop RPC requires service_role
--    原因见段 0（auth.role() 在 SQL Editor 里回退成 'anon'）。请改用：
--       node supabase/sandbox/s154-guest-promo-toolbox.js status
--       node supabase/sandbox/s154-guest-promo-toolbox.js status --json
--    下面这条 SELECT 保留，是为了给「promo_status 返回哪些字段」留一份可对照的
--    书面定义；若你确实在 service_role 上下文（例如 psql 里手工
--    SET request.jwt.claims），也可以直接跑它。
--
-- fn_guest_shop_promo_status() 是只读运维视图（迁移 :851），service_role only，
-- 无 PII、无密钥、不写库。返回：
--   breaker                  单行跳闸状态 + 三个阈值
--   budget_date              Asia/Shanghai 今天
--   budgets[]                每站 enabled / daily_budget_cny / spent_cny /
--                            remaining_cny / stale_date
--   guest_enabled_codes      allow_guest=true AND guest_max_uses>0 的券数
--   redemptions_24h          24h 内 redemption 行数
--   redemptions_discount_24h 24h 内**未归还**的折扣总额
--   events_24h               breaker_events 按 kind 的 24h 计数
-- 期望（沙箱开始前）：breaker.state='closed'，budgets 双站 enabled=false /
--   daily_budget_cny=0 / spent_cny=0，guest_enabled_codes=0。
-- ----------------------------------------------------------------------------
SELECT public.fn_guest_shop_promo_status() AS promo_status;


-- ----------------------------------------------------------------------------
-- 段 5 · 券的游客四列 + gate 四要素自检（第 4 项与"为什么被拒"排查用）
--
-- gate（迁移 :541 guest_shop_promo_gate）四要素，缺一即拒：
--   ① env 开关 GUEST_SHOP_DISCOUNT_ENABLED（DB 侧看不到，见 runbook P0-1）
--   ② breaker 单行 state='closed'（**缺行也 fail-closed**）
--   ③ budget 行 enabled=true AND daily_budget_cny>0
--      AND spent + 本次折扣 <= daily_budget_cny（Asia/Shanghai 日界）
--   ④ 券 allow_guest=true AND guest_max_uses>0
-- 脏券口径（readiness promo-dirty-coupon-scan，退出码 2）：
--   allow_guest=true AND (guest_max_uses=0 OR guest_max_total_discount<=0)
--   → 按 §8.1，0 表示"关闭"而不是"无限"，所以"开了白名单却没给次数/金额预算"
--     就是脏券。沙箱专用券请一律用 SBX 前缀，方便这里一眼扫清。
-- 只看 SBX 前缀 + 任何已对游客开放的券，避免把生产营销券列出来。
-- ----------------------------------------------------------------------------
SELECT
    d.id,
    d.code,
    d.discount_type,
    d.discount_value,
    d.max_discount_quantity,
    d.applicable_site,
    d.is_active,
    d.starts_at,
    d.expires_at,
    d.allow_guest,
    d.guest_max_uses,
    d.guest_used_count,
    d.guest_max_total_discount,
    d.guest_discount_total,
    (d.guest_max_uses - d.guest_used_count)                        AS guest_remaining_uses,
    (d.guest_max_total_discount - d.guest_discount_total)          AS guest_remaining_cny,
    -- 脏券判定：与 readiness 完全同口径
    (COALESCE(d.allow_guest, false)
     AND (COALESCE(d.guest_max_uses, 0) = 0
          OR COALESCE(d.guest_max_total_discount, 0) <= 0))        AS is_dirty_coupon,
    -- 第 4 项要观测的就是上面这两列：第 3 次被拒后 guest_used_count 必须**停在 2**，
    -- guest_remaining_uses 必须**停在 0**。
    --
    -- 下面这些是 core（fn_validate_discount_code_core）同样会读到的闸门。
    -- 券被拒但 guest 四列看起来正常时，按这几列自查：
    --   lifecycle_status  非 'active'（scheduled/paused/expired）→ core 直接拒
    --   starts_at         未来时间 → core 拒（scheduled_start）
    --   max_uses/used_count  登录侧总次数；0 = 无限（沙箱券保持 0 最省事）
    --   allow_zero_total  游客通道**恒定按 false 处理**（迁移里硬写死），
    --                     这里选出来只是让你看见「即使券配了 true 也零元购不了」
    --   scope_*           券的适用范围；沙箱券建议全站全品（scope_type='all'）
    --   audience_segment  若限定了人群，游客的 buyer_id 不在 auth.users 里，
    --                     core 可能判为不适用 → 沙箱券请留空/不限
    -- ⚠️ discount_codes **没有 updated_at 列**（建表见仓库根 2.2_discount_codes.sql，
    --    之后所有迁移都没加过），别 SELECT 它，否则整段报 42703。
    d.lifecycle_status,
    d.version_no,
    d.max_uses,
    d.used_count,
    d.allow_zero_total,
    d.scope_type,
    d.scope_category,
    d.scope_product_id,
    d.scope_product_sku_id,
    d.is_exclusive,
    d.distribution_mode,
    d.audience_segment,
    d.created_at
FROM public.discount_codes d
WHERE UPPER(BTRIM(d.code)) LIKE 'SBX%'
   OR COALESCE(d.allow_guest, false) = true
ORDER BY d.code;


-- ----------------------------------------------------------------------------
-- 段 6 · 通道附加费（第 2 项算"应付"用；**不要硬记 9.09**）
--
-- 应付公式：
--   net   = ROUND(list_unit × quantity, 2) − discount_amount
--   fee   = CEIL(net × surcharge_rate, 2)      -- 向上取整到分（roundUpMoneyAmount）
--   total = net + fee
-- surcharge_rate 存在 system_config 的 payment_channels.providers.<key> 里，
-- 种子模板中 zpay / nowpayments = 0.01，afdian / hupijiao = 0；**以这里查到的
-- 线上实际值为准**。所以 ¥10 SKU + 10% 券：
--   rate=0.01 → net 9.00 + fee 0.09 = **应付 9.09**
--   rate=0    → net 9.00 + fee 0.00 = **应付 9.00**
-- ----------------------------------------------------------------------------
SELECT
    c.config_key,
    prov.key                                                       AS provider,
    (prov.value ->> 'enabled')                                     AS enabled,
    (prov.value ->> 'display_name')                                AS display_name,
    COALESCE((prov.value ->> 'surcharge_rate'), '(未设置)')         AS surcharge_rate,
    COALESCE((prov.value ->> 'surcharge_label'), '(未设置)')        AS surcharge_label,
    -- 直接给出 ¥10 SKU + 10% 券在该通道下的应付，省得手工算
    ROUND(9.00 + CEIL(9.00 * COALESCE((prov.value ->> 'surcharge_rate')::NUMERIC, 0) * 100) / 100, 2)
                                                                   AS payable_for_net_9_00
FROM public.system_config c
CROSS JOIN LATERAL jsonb_each(COALESCE(c.config_value -> 'providers', '{}'::jsonb)) AS prov(key, value)
WHERE c.config_key LIKE 'payment_channels%'
ORDER BY c.config_key, prov.key;


-- ----------------------------------------------------------------------------
-- 段 7 · 最近的游客订单（第 1 项"没有新增订单行"、第 2/3/4/7 项对账用）
--
-- 第 1 项的核心断言就是：被拒之后**这里不新增任何行**。
-- 金额列语义（L1/L2 新制行，list_unit_amount IS NOT NULL 即为新制）：
--   list_unit_amount × quantity = list_amount（原价小计）
--   unit_amount      × quantity = net_amount （折后小计）
--   net_amount + payment_fee_amount = total_amount（应付）
--   四者任一对不上，buildGuestAmountBreakdown 会 fail-closed 返回 null，
--   前端就拿不到 amount_breakdown —— 这本身就是一条可观测的安全属性。
-- 隐私：不输出 claim_secret_hash / contact_hash 全文，只给前 12 位。
-- ----------------------------------------------------------------------------
SELECT
    o.id,
    o.order_no,
    o.site,
    o.product_id,
    o.sku_id,
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
    o.expires_at,
    LEFT(COALESCE(o.buyer_contact_hash, ''), 12)                   AS contact_hash_12,
    o.created_at,
    -- 自洽性自检：net + fee 必须等于 total
    (ROUND(COALESCE(o.unit_amount, 0) * COALESCE(o.quantity, 1), 2)
     + COALESCE(o.payment_fee_amount, 0) = o.total_amount)         AS amounts_self_consistent,
    -- 零元购 / 50% 硬顶自检（DB CHECK 已经拦，这里是给人看的复核）
    (o.total_amount > 0)                                           AS not_zero_purchase,
    (o.discount_amount IS NULL
     OR o.discount_amount <= ROUND(COALESCE(o.list_unit_amount, 0) * COALESCE(o.quantity, 1) * 0.5, 2))
                                                                   AS within_50pct_cap
FROM public.guest_shop_orders o
ORDER BY o.created_at DESC
LIMIT 25;


-- ----------------------------------------------------------------------------
-- 段 8 · 折扣 redemption 台账（第 4 项计数、第 7 项 TTL 归还、第 5 项限流额度）
--
-- 这张表同时是三件事的数据源：
--   ① 券配额：guest_used_count 由它驱动（reserve 时 +1，return 时 −1）
--   ② 限流：evaluate 数它 24h 内的行数 —— 每 contact_hash 上限 **3**、
--      每 request_ip_hash 上限 **10**（迁移 :1263-1285，默认值 3 / 10，
--      硬夹到 <=10 / <=50）。**被拒的请求不写行，所以不消耗额度。**
--   ③ TTL 归还：returned_at IS NOT NULL 即已归还；returned_at 是幂等 claim，
--      同一份预算不可能被退回两次（第 7 项要验的就是这个）
-- ----------------------------------------------------------------------------
SELECT
    r.id,
    r.order_id,
    r.code,
    r.site,
    r.product_id,
    r.sku_id,
    r.quantity,
    r.list_amount,
    r.discount_amount,
    r.net_amount,
    r.discount_version,
    LEFT(COALESCE(r.buyer_contact_hash, ''), 12)                   AS contact_hash_12,
    LEFT(COALESCE(r.request_ip_hash, ''), 12)                      AS ip_hash_12,
    r.created_at,
    r.returned_at,
    r.return_reason,
    (r.returned_at IS NULL)                                        AS still_standing,
    (r.created_at >= clock_timestamp() - INTERVAL '24 hours')      AS within_24h_window
FROM public.guest_shop_discount_redemptions r
ORDER BY r.created_at DESC
LIMIT 40;


-- ----------------------------------------------------------------------------
-- 段 9 · 24h 限流余量（第 4、5 项开跑前先看一眼，避免撞限流而不是撞配额）
--
-- 第 4 项的坑：每联系方式 24h 上限 3 次，排在券配额检查**前面**。
--   同一邮箱成功下 2 单后第 3 次 → contact_uses=2 < 3 通过限流 → 命中配额
--   → 内部 code = guest_discount_code_exhausted ✅（这才是第 4 项要的观测）
--   若手滑打到第 4 次 → 先撞限流 → 内部 code = guest_discount_rate_limited
--   两者对外都是 HTTP 400 guest_discount_unavailable（C-E6 统一口径），
--   但证据里必须写清命中的是哪一条。
-- 第 5 项：两个邮箱是**两个不同的 contact_hash**，各自独立享有 3 次额度。
-- ----------------------------------------------------------------------------
SELECT
    LEFT(COALESCE(r.buyer_contact_hash, ''), 12)                   AS contact_hash_12,
    COUNT(*)                                                       AS uses_24h,
    3 - COUNT(*)                                                   AS contact_remaining,
    MIN(r.created_at)                                              AS first_use,
    MAX(r.created_at)                                              AS last_use
FROM public.guest_shop_discount_redemptions r
WHERE r.created_at >= clock_timestamp() - INTERVAL '24 hours'
GROUP BY r.buyer_contact_hash
ORDER BY uses_24h DESC;


-- ----------------------------------------------------------------------------
-- 段 10 · 买家身份行（第 5 项 (c) 可选演示用）
--
-- 第 5 项主判据是"两个会话折后金额逐分相等"。计划原文那句
-- "registered_user_match 在两边取值不同"**在公网上不可观测**：公开下单路径
-- allocateBuyerGroup 恒定传 p_registered_user_match: null
-- （api/_lib/guest-shop/buyer-credentials.js:577），DB 侧 COALESCE→false，
-- 所以两边都是 false。这正是 H1 的设计意图（身份匹配只记录、永不进定价）。
--
-- 若要留一条"判定确实跑了"的实机痕迹，做 (c)：
--   1) 这里找到会话 A 的 buyer 行 id
--   2) UPDATE public.guest_shop_buyers SET registered_user_match = true
--        WHERE id = '<A 的 id>';
--   3) 同邮箱同密码、**换幂等键**再下一单
--   4) 期望 amount_breakdown 与改之前**逐字节相同**
--   5) 收尾用 S154_cleanup.sql 还原为 false
-- 隐私：只输出 hash 前 12 位与布尔/计数/时间戳；**不输出** password_hash。
-- ----------------------------------------------------------------------------
SELECT
    b.id,
    b.site,
    LEFT(b.contact_hash, 12)                                       AS contact_hash_12,
    b.credential_group_no,
    b.registered_user_match,
    b.email_verified_at,
    b.failed_login_count,
    b.login_lock_stage,
    b.locked_until,
    b.last_login_at,
    b.merged_into_user_id,
    b.password_version,
    b.created_at,
    b.updated_at,
    (SELECT COUNT(*) FROM public.guest_shop_orders o WHERE o.buyer_id = b.id) AS orders_owned
FROM public.guest_shop_buyers b
ORDER BY b.created_at DESC
LIMIT 25;


-- ----------------------------------------------------------------------------
-- 段 11 · 库存预占（第 7 项 TTL 归还：库存与预算"同时"归还）
--
-- 链路：fn_guest_shop_release_expired_reservations
--        （20260913_guest_shop_atomic_rpcs.sql:1420）
--      → fn_guest_shop_release_reservation
--      → 当订单 reservation_status='released' 时调
--        fn_guest_shop_return_discount_reservation（promo 迁移 :3265-3283）
-- 期望（worker 扫过之后）：held → released；shop_inventory 对应行 reserve →
--   available；券 guest_used_count / guest_discount_total 与 budget.spent_cny
--   **同步**回落；redemption 行 returned_at 有值。
-- ----------------------------------------------------------------------------
SELECT
    r.id,
    r.order_id,
    o.order_no,
    r.sku_id,
    r.inventory_id,
    -- ⚠️ guest_shop_inventory_reservations **没有 quantity 列**：一行预占 == 一张
    --    卡密 == 1 件。N 件订单会有 N 行预占，所以件数看 o.quantity，
    --    归还时看「同一 order_id 的 N 行是否全部 released」。
    o.quantity                                                     AS order_quantity,
    (SELECT COUNT(*) FROM public.guest_shop_inventory_reservations x
      WHERE x.order_id = r.order_id)                               AS reservation_rows_for_order,
    r.status                                                       AS reservation_status,
    r.reserved_until,
    r.released_at,
    r.release_reason,
    o.reservation_status                                           AS order_reservation_status,
    o.payment_status,
    o.fulfillment_status,
    o.expires_at,
    (o.expires_at <= clock_timestamp())                            AS ttl_already_passed,
    r.created_at,
    r.updated_at
FROM public.guest_shop_inventory_reservations r
LEFT JOIN public.guest_shop_orders o ON o.id = r.order_id
ORDER BY r.created_at DESC
LIMIT 30;


-- ----------------------------------------------------------------------------
-- 段 12 · 支付事件（第 3 项：少付 → rejected + amount_verified=false）
--
-- 第 3 项已实现的半边，期望看到：
--   processing_status='rejected'、amount_verified=false、
--   error_code='guest_webhook_verification_failed'、
--   且**没有**对应的 fn_guest_shop_confirm_payment 效果
--   （订单仍 pending、不发货、卡密仍 held/reserve）。
-- webhook 在 server/api-handlers/public/guest-shop.js:3745 写这行，
-- :3748 直接 `return sendJson(res, 202, {success:true, accepted:false})`。
--
-- ⚠️ 第 3 项 BLOCKED 的半边（如实登记，不要写 PASS）：
--   ① "熔断计数 +1" **本批未接线**：fn_guest_shop_promo_record_event 在全仓库
--      的唯一调用点是 fn_guest_shop_promo_set_breaker 自己（迁移 :837），
--      webhook 的金额不符分支不调它 → breaker_events 不会新增 amount_mismatch。
--   ② 既有 amount_mismatch 告警**也不会响**：api/_lib/guest-shop-alerts.js 的
--      告警按 payment_status ∈ {amount_mismatch, overpaid, partial} 触发，
--      而这条路径下支付单**停在 pending**，没落到这三个状态。
-- ----------------------------------------------------------------------------
SELECT
    e.id,
    e.payment_order_id,
    e.merchant_order_no,
    e.provider,
    e.event_key,
    e.provider_event_id,
    e.provider_order_no,
    e.event_type,
    e.observed_status,
    e.observed_site,
    e.observed_currency,
    e.observed_amount,
    e.signature_verified,
    e.amount_verified,
    e.currency_verified,
    e.final_status_verified,
    e.processing_status,
    e.error_code,
    e.created_at
FROM public.guest_shop_payment_events e
ORDER BY e.created_at DESC
LIMIT 30;


-- ----------------------------------------------------------------------------
-- 段 13 · 熔断事件表（第 8 项：manual_open / manual_close 应各 +1）
--
-- kind 枚举：amount_mismatch / identity_limit_hit / budget_exhausted /
--            code_exhausted / manual_open / manual_close / auto_open
-- 注意：amount_mismatch 与 budget_exhausted 这两个 kind **目前没有自动写入方**
--       （见段 12 与第 9 项的 BLOCKED 说明）。沙箱里能看到的应该只有
--       manual_open / manual_close（第 8 项手工跳闸与恢复产生）。
-- 该表有 no-secrets CHECK：detail 里出现 email / *_hash / password_hash /
-- content / access_token / authorization 任一 key 都会被 DB 直接拒。
-- ----------------------------------------------------------------------------
SELECT
    e.id,
    e.kind,
    e.site,
    e.detail,
    e.occurred_at,
    (e.occurred_at >= clock_timestamp() - INTERVAL '24 hours')     AS within_24h
FROM public.guest_shop_promo_breaker_events e
ORDER BY e.occurred_at DESC
LIMIT 40;


-- ----------------------------------------------------------------------------
-- 段 14 · breaker 单行原始状态（第 8 项逐字段核对 CHECK 约束）
--
-- CHECK guest_shop_promo_breaker_state_exclusive_check 强制：
--   state='open'   → opened_at 与 opened_by **都必须有值**
--   state='closed' → opened_at 与 opened_by **都必须为 NULL**
-- 所以恢复只能用 fn_guest_shop_promo_set_breaker('closed', actor, reason)，
-- 裸 UPDATE 要么被 CHECK 拦下，要么留下一行没有审计的 open。
-- **缺行 = fail-closed**：gate 找不到 closed 行就拒绝所有折扣。
-- ----------------------------------------------------------------------------
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
    b.updated_at,
    -- CHECK 约束的自洽复核
    ((b.state = 'open'   AND b.opened_at IS NOT NULL AND b.opened_by IS NOT NULL)
     OR (b.state = 'closed' AND b.opened_at IS NULL AND b.opened_by IS NULL))
                                                                   AS state_exclusive_ok
FROM public.guest_shop_promo_breaker b
WHERE b.id = 1;


-- ----------------------------------------------------------------------------
-- 段 15 · 预算行原始状态（第 9 项：日预算打满）
--
-- CHECK guest_shop_promo_budget_amount_check 强制：
--   daily_budget_cny BETWEEN 0 AND 99999999
--   spent_cny >= 0
--   (daily_budget_cny = 0 OR spent_cny <= daily_budget_cny)
-- 最后一条让"超支"在物理上不可表示 —— 即使未来有人改坏了 reserve 里的
-- WHERE 守卫，行也提交不进去。
-- 日界是 Asia/Shanghai（无 DST），rollover 由扣减那条 UPDATE 自己完成
-- （比较 budget_date 并在同一行版本里重置 spent_cny），**没有 cron**。
-- stale_date=true 表示这行还停在旧日期，下一次扣减会顺手重置。
-- ----------------------------------------------------------------------------
SELECT
    b.site,
    b.enabled,
    b.daily_budget_cny,
    b.budget_date,
    b.spent_cny,
    (b.budget_date IS DISTINCT FROM (now() AT TIME ZONE 'Asia/Shanghai')::DATE) AS stale_date,
    CASE WHEN b.budget_date = (now() AT TIME ZONE 'Asia/Shanghai')::DATE
         THEN b.spent_cny ELSE 0 END                               AS effective_spent_today,
    CASE WHEN b.budget_date = (now() AT TIME ZONE 'Asia/Shanghai')::DATE
         THEN ROUND(GREATEST(0, b.daily_budget_cny - COALESCE(b.spent_cny, 0)), 2)
         ELSE b.daily_budget_cny END                               AS effective_remaining_today,
    b.updated_at
FROM public.guest_shop_promo_budget b
ORDER BY b.site;


-- ----------------------------------------------------------------------------
-- 段 16 · 迁移落库自检（跑沙箱前确认 schema 到位）
--
-- 期望：required_objects_present = 全部 true；missing = '{}'。
-- 若 promo 相关对象缺失，先按 §2.4 执行
--   supabase/migrations/20260923_guest_shop_promo_l1l2.sql
-- 再跑 23 行 verify（supabase/migrations/20260923_verify_guest_shop_promo_l1l2.sql）
-- 确认 1-22 行全 PASS。
-- ----------------------------------------------------------------------------
SELECT
    (to_regclass('public.guest_shop_promo_budget')          IS NOT NULL) AS budget_table,
    (to_regclass('public.guest_shop_promo_breaker')         IS NOT NULL) AS breaker_table,
    (to_regclass('public.guest_shop_promo_breaker_events')  IS NOT NULL) AS breaker_events_table,
    (to_regclass('public.guest_shop_discount_redemptions')  IS NOT NULL) AS redemptions_table,
    (to_regclass('public.guest_shop_buyers')                IS NOT NULL) AS buyers_table,
    (to_regclass('public.guest_shop_access_resets')         IS NOT NULL) AS access_resets_table,
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname='fn_guest_shop_evaluate_discount')            AS evaluate_fn,
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname='fn_guest_shop_reserve_discount')             AS reserve_fn,
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname='fn_guest_shop_return_discount_reservation')  AS return_fn,
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname='fn_guest_shop_promo_gate')                   AS gate_fn,
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname='fn_guest_shop_promo_set_breaker')            AS set_breaker_fn,
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname='fn_guest_shop_promo_status')                 AS status_fn,
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname='fn_guest_shop_release_expired_reservations') AS expiry_sweep_fn,
    EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname='guest_shop_resolve_credit_unit_amount')      AS credit_resolver_fn,
    EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='discount_codes' AND column_name='allow_guest') AS coupon_guest_cols;


-- ----------------------------------------------------------------------------
-- 段 17 · 游客订单表的零元购 / 50% 硬顶 CHECK 是否在位（第 1 项纵深防御）
--
-- 第 1 项的直接拒绝来自 guest_discount_no_effect（¥0.01 × 10% = 0.001 →
-- ROUND(...,2) = 0.00 → 折扣无效果 → evaluate 拒 → 订单行根本不创建）。
-- 但即使有一天折扣算错，还有两道物理兜底：
--   ① 50% 地板 guest_discount_below_floor（迁移 :1348-1358）
--   ② DB CHECK guest_shop_orders_amount_check（零元购地板 + 50% 硬顶 +
--      通道费 10% 硬顶）
-- 期望：amount_check_present = true，且 pg_get_constraintdef 里能看到 0.5 与
--       零元购相关的表达式。
-- ----------------------------------------------------------------------------
SELECT
    c.conname,
    pg_catalog.pg_get_constraintdef(c.oid, true)                   AS definition,
    (c.conname = 'guest_shop_orders_amount_check')                 AS amount_check_present
FROM pg_catalog.pg_constraint c
WHERE c.conrelid = 'public.guest_shop_orders'::regclass
  AND c.contype = 'c'
  AND c.conname LIKE '%amount%'
ORDER BY c.conname;

-- ============================================================================
-- 跑完之后：把段 0（执行身份）、段 1（选 SKU）、段 5（券）、段 6（附加费）的输出抄进
-- S154_fixture_setup.sql 的常量块，再执行夹具。
-- 段 3 的 verdict 就是第 6 项的结论，可以直接归档。
-- ============================================================================
