-- =============================================================================
-- 20260923_verify_guest_shop_promo_parity.sql
-- §9.5 黄金向量 parity —— DB 侧只读比对（C-E3）
-- docs/guest-shop-promo-hardening-plan.md §9.5 / §15.1
--
-- 用途：用与 tests/guest-shop-pricing-parity.test.js **完全相同**的 group A fixture，
--       在数据库侧调用定价权威 public.guest_shop_resolve_credit_unit_amount(...)，
--       把 observed 与 JS 镜像的 expected 逐条比对，输出 PASS/FAIL。
--       JS 侧（CI 必绿）证明展示镜像自洽；本文件证明**镜像 == DB 权威**。
--
-- 纪律（与其余 verify 文件一致）：
--   1. 只读：单条 WITH...SELECT，无任何 DML/DDL/授权，可重复执行、无副作用。
--   2. Codex **不执行**本文件；由用户在 Supabase SQL Editor（service_role 权限）执行，
--      因为 resolver 已 REVOKE FROM PUBLIC/anon/authenticated、仅 GRANT 给 service_role。
--   3. 预期：**32 行全 PASS**。任何 FAIL 都意味着 JS 镜像与 SQL 权威漂移，
--      必须先定位是镜像还是 resolver 的问题，**不得**为了让它变绿而弱化任一侧。
--   4. group B/C/D（多件小计、折扣 breakdown、件数上限）依赖订单行/券行/买家身份等
--      DB 状态，无法只靠字面量重放；其 DB 侧权威由 §15.4 九项沙箱实机验证 +
--      20260923_verify_guest_shop_promo_l1l2.sql 的 zero_purchase_guards /
--      promo_function_guards 行覆盖。本文件只固化 group A（纯函数 resolver）的 parity。
--   5. p_now 固定为 '2026-09-14T12:00:00.000Z'，与 JS 测试的 NOW 一致，
--      使闪购生效/过期完全由 fixture 决定，与真实时钟无关。
--   6. A28（qty=1.5）/A30（qty='abc'）在 JS 侧因「非整数/非数字」被拒；DB 侧 p_quantity
--      是 INTEGER，非整数在类型边界即不可表达，故以 NULL 表达并同样被 resolver 拒绝，
--      observed/expected 均为 NULL → PASS。note 列已逐行标明，避免误读为「同机制」。
--
-- 列序对应 resolver 形参：
--   p_site, p_sku_price_points, p_sku_price_points_intl, p_sku_is_default,
--   p_sku_quantity_rules, p_sku_quantity_rules_intl, p_product_quantity_rules,
--   p_product_quantity_rules_intl, p_product_flash_sale_price,
--   p_product_flash_sale_price_intl, p_product_flash_sale_end,
--   p_product_flash_sale_end_intl, p_quantity, p_now
-- =============================================================================
WITH fixtures(
    fixture_id,
    note,
    p_site,
    p_sku_price_points,
    p_sku_price_points_intl,
    p_sku_is_default,
    p_sku_quantity_rules,
    p_sku_quantity_rules_intl,
    p_product_quantity_rules,
    p_product_quantity_rules_intl,
    p_product_flash_sale_price,
    p_product_flash_sale_price_intl,
    p_product_flash_sale_end,
    p_product_flash_sale_end_intl,
    p_quantity,
    expected_unit_amount
) AS (
    VALUES
    ('A01', 'CN 基础价'::text, 'cn'::text, 12.34::numeric, NULL::numeric, NULL::boolean, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::numeric, NULL::numeric, NULL::timestamptz, NULL::timestamptz, 1::integer, 12.34::numeric),
    ('A02', 'CN 整数基础价'::text, 'cn'::text, 10::numeric, NULL::numeric, NULL::boolean, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::numeric, NULL::numeric, NULL::timestamptz, NULL::timestamptz, 1::integer, 10::numeric),
    ('A03', 'INTL 自有价'::text, 'intl'::text, 12.34::numeric, 20::numeric, NULL::boolean, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::numeric, NULL::numeric, NULL::timestamptz, NULL::timestamptz, 1::integer, 20::numeric),
    ('A04', 'INTL 缺失回落 CN(null)'::text, 'intl'::text, 12.34::numeric, NULL::numeric, NULL::boolean, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::numeric, NULL::numeric, NULL::timestamptz, NULL::timestamptz, 1::integer, 12.34::numeric),
    ('A05', 'INTL 非正回落 CN(0)'::text, 'intl'::text, 9.5::numeric, 0::numeric, NULL::boolean, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::numeric, NULL::numeric, NULL::timestamptz, NULL::timestamptz, 1::integer, 9.5::numeric),
    ('A06', 'INTL 非正回落 CN(负)'::text, 'intl'::text, 8::numeric, -1::numeric, NULL::boolean, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::numeric, NULL::numeric, NULL::timestamptz, NULL::timestamptz, 1::integer, 8::numeric),
    ('A07', '未知站点拒绝'::text, 'us'::text, 10::numeric, NULL::numeric, NULL::boolean, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::numeric, NULL::numeric, NULL::timestamptz, NULL::timestamptz, 1::integer, NULL::numeric),
    ('A08', '缺站点拒绝'::text, NULL::text, 10::numeric, NULL::numeric, NULL::boolean, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::numeric, NULL::numeric, NULL::timestamptz, NULL::timestamptz, 1::integer, NULL::numeric),
    ('A09', '基础价 0 拒绝'::text, 'cn'::text, 0::numeric, NULL::numeric, NULL::boolean, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::numeric, NULL::numeric, NULL::timestamptz, NULL::timestamptz, 1::integer, NULL::numeric),
    ('A10', '基础价负拒绝'::text, 'cn'::text, -1::numeric, NULL::numeric, NULL::boolean, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::numeric, NULL::numeric, NULL::timestamptz, NULL::timestamptz, 1::integer, NULL::numeric),
    ('A11', '基础价缺失不回退商品价'::text, 'cn'::text, NULL::numeric, NULL::numeric, NULL::boolean, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::numeric, NULL::numeric, NULL::timestamptz, NULL::timestamptz, 1::integer, NULL::numeric),
    ('A12', '阶梯 qty1 命中首档'::text, 'cn'::text, 12.34::numeric, NULL::numeric, NULL::boolean, '[{"qty":1,"price":10},{"qty":3,"price":8},{"qty":5,"price":6}]'::jsonb, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::numeric, NULL::numeric, NULL::timestamptz, NULL::timestamptz, 1::integer, 10::numeric),
    ('A13', '阶梯 qty2 未达次档'::text, 'cn'::text, 12.34::numeric, NULL::numeric, NULL::boolean, '[{"qty":1,"price":10},{"qty":3,"price":8},{"qty":5,"price":6}]'::jsonb, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::numeric, NULL::numeric, NULL::timestamptz, NULL::timestamptz, 2::integer, 10::numeric),
    ('A14', '阶梯 qty3 命中'::text, 'cn'::text, 12.34::numeric, NULL::numeric, NULL::boolean, '[{"qty":1,"price":10},{"qty":3,"price":8},{"qty":5,"price":6}]'::jsonb, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::numeric, NULL::numeric, NULL::timestamptz, NULL::timestamptz, 3::integer, 8::numeric),
    ('A15', '阶梯 qty4 沿用 qty3 档'::text, 'cn'::text, 12.34::numeric, NULL::numeric, NULL::boolean, '[{"qty":1,"price":10},{"qty":3,"price":8},{"qty":5,"price":6}]'::jsonb, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::numeric, NULL::numeric, NULL::timestamptz, NULL::timestamptz, 4::integer, 8::numeric),
    ('A16', '阶梯 qty5 命中最低档'::text, 'cn'::text, 12.34::numeric, NULL::numeric, NULL::boolean, '[{"qty":1,"price":10},{"qty":3,"price":8},{"qty":5,"price":6}]'::jsonb, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::numeric, NULL::numeric, NULL::timestamptz, NULL::timestamptz, 5::integer, 6::numeric),
    ('A17', '高于列表价的阶梯永不抬价'::text, 'cn'::text, 12.34::numeric, NULL::numeric, NULL::boolean, '[{"qty":2,"price":99}]'::jsonb, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::numeric, NULL::numeric, NULL::timestamptz, NULL::timestamptz, 3::integer, 12.34::numeric),
    ('A18', '闪购生效且更便宜'::text, 'cn'::text, 12.34::numeric, NULL::numeric, NULL::boolean, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::jsonb, 7::numeric, NULL::numeric, TIMESTAMPTZ '2026-09-14T13:00:00.000Z', NULL::timestamptz, 1::integer, 7::numeric),
    ('A19', '闪购生效但更贵(LEAST 保基础价)'::text, 'cn'::text, 12.34::numeric, NULL::numeric, NULL::boolean, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::jsonb, 20::numeric, NULL::numeric, TIMESTAMPTZ '2026-09-14T13:00:00.000Z', NULL::timestamptz, 1::integer, 12.34::numeric),
    ('A20', '闪购过期回落阶梯'::text, 'cn'::text, 12.34::numeric, NULL::numeric, NULL::boolean, '[{"qty":1,"price":10},{"qty":3,"price":8},{"qty":5,"price":6}]'::jsonb, NULL::jsonb, NULL::jsonb, NULL::jsonb, 7::numeric, NULL::numeric, TIMESTAMPTZ '2026-09-14T11:00:00.000Z', NULL::timestamptz, 3::integer, 8::numeric),
    ('A21', '闪购生效跳过阶梯'::text, 'cn'::text, 12.34::numeric, NULL::numeric, NULL::boolean, '[{"qty":1,"price":8}]'::jsonb, NULL::jsonb, NULL::jsonb, NULL::jsonb, 10::numeric, NULL::numeric, TIMESTAMPTZ '2026-09-14T13:00:00.000Z', NULL::timestamptz, 1::integer, 10::numeric),
    ('A22', '默认 SKU 用商品阶梯'::text, 'cn'::text, 12.34::numeric, NULL::numeric, TRUE, NULL::jsonb, NULL::jsonb, '[{"qty":1,"price":11}]'::jsonb, NULL::jsonb, NULL::numeric, NULL::numeric, NULL::timestamptz, NULL::timestamptz, 1::integer, 11::numeric),
    ('A23', '非默认 SKU 忽略商品阶梯'::text, 'cn'::text, 12.34::numeric, NULL::numeric, FALSE, NULL::jsonb, NULL::jsonb, '[{"qty":1,"price":11}]'::jsonb, NULL::jsonb, NULL::numeric, NULL::numeric, NULL::timestamptz, NULL::timestamptz, 1::integer, 12.34::numeric),
    ('A24', 'INTL 无自有阶梯回落 CN 阶梯'::text, 'intl'::text, 12.34::numeric, NULL::numeric, NULL::boolean, '[{"qty":1,"price":9.5},{"qty":2,"price":7}]'::jsonb, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::numeric, NULL::numeric, NULL::timestamptz, NULL::timestamptz, 2::integer, 7::numeric),
    ('A25', 'INTL 自有阶梯优先'::text, 'intl'::text, 12.34::numeric, 20::numeric, NULL::boolean, '[{"qty":1,"price":9.5}]'::jsonb, '[{"qty":1,"price":18}]'::jsonb, NULL::jsonb, NULL::jsonb, NULL::numeric, NULL::numeric, NULL::timestamptz, NULL::timestamptz, 1::integer, 18::numeric),
    ('A26', 'qty0 拒绝'::text, 'cn'::text, 12.34::numeric, NULL::numeric, NULL::boolean, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::numeric, NULL::numeric, NULL::timestamptz, NULL::timestamptz, 0::integer, NULL::numeric),
    ('A27', 'qty 负拒绝'::text, 'cn'::text, 12.34::numeric, NULL::numeric, NULL::boolean, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::numeric, NULL::numeric, NULL::timestamptz, NULL::timestamptz, -1::integer, NULL::numeric),
    ('A28', 'qty 小数拒绝；非整数在 INTEGER 边界即被拒，DB 侧以 NULL 表达'::text, 'cn'::text, 12.34::numeric, NULL::numeric, NULL::boolean, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::numeric, NULL::numeric, NULL::timestamptz, NULL::timestamptz, NULL::integer, NULL::numeric),
    ('A29', 'qty 超 99 拒绝'::text, 'cn'::text, 12.34::numeric, NULL::numeric, NULL::boolean, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::numeric, NULL::numeric, NULL::timestamptz, NULL::timestamptz, 100::integer, NULL::numeric),
    ('A30', 'qty 非数字拒绝；非数字在 INTEGER 边界即被拒，DB 侧以 NULL 表达'::text, 'cn'::text, 12.34::numeric, NULL::numeric, NULL::boolean, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::numeric, NULL::numeric, NULL::timestamptz, NULL::timestamptz, NULL::integer, NULL::numeric),
    ('A31', 'qty 数字字符串可解析'::text, 'cn'::text, 12.34::numeric, NULL::numeric, NULL::boolean, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::numeric, NULL::numeric, NULL::timestamptz, NULL::timestamptz, 2::integer, 12.34::numeric),
    ('A32', 'qty 99 边界可解析'::text, 'cn'::text, 12.34::numeric, NULL::numeric, NULL::boolean, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::jsonb, NULL::numeric, NULL::numeric, NULL::timestamptz, NULL::timestamptz, 99::integer, 12.34::numeric)
),
resolved AS (
    SELECT
        f.fixture_id,
        f.note,
        public.guest_shop_resolve_credit_unit_amount(
            f.p_site,
            f.p_sku_price_points,
            f.p_sku_price_points_intl,
            f.p_sku_is_default,
            f.p_sku_quantity_rules,
            f.p_sku_quantity_rules_intl,
            f.p_product_quantity_rules,
            f.p_product_quantity_rules_intl,
            f.p_product_flash_sale_price,
            f.p_product_flash_sale_price_intl,
            f.p_product_flash_sale_end,
            f.p_product_flash_sale_end_intl,
            f.p_quantity,
            TIMESTAMPTZ '2026-09-14T12:00:00.000Z'
        ) AS observed_unit_amount,
        f.expected_unit_amount
    FROM fixtures f
)
SELECT
    r.fixture_id,
    r.note,
    r.observed_unit_amount,
    r.expected_unit_amount,
    CASE
        WHEN r.observed_unit_amount IS NOT DISTINCT FROM r.expected_unit_amount
            THEN 'PASS'
        ELSE 'FAIL'
    END AS status
FROM resolved r
ORDER BY r.fixture_id;
