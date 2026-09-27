'use strict';

/**
 * §9.5 黄金向量 parity 测试（C-E3）
 * docs/guest-shop-promo-hardening-plan.md §9.5 / §15.1
 *
 * 目的：用一组**固定期望值**的 fixture，证明游客通道的「展示/预报价」JS 层与
 * 数据库定价权威在语义上逐项一致，并且 JS 层在异常输入下**只会更严、绝不会更松**
 * （fail-closed）。这是启用游客促销（§14 灰度许可）前 readiness `promo-parity-evidence`
 * 要求的硬证据之一。
 *
 * 权威边界（不可越界，继承 pricing.js / promo.js 文件头红线）：
 *   - resolveGuestCreditUnitAmount 是 SQL public.guest_shop_resolve_credit_unit_amount
 *     的**只读镜像**，只算「单价/列表价」（基础价、闪购、阶梯），**从不算折扣**。
 *   - 折扣、券预算、下限、零元购地板全部由 SQL（fn_guest_shop_evaluate_discount /
 *     fn_guest_shop_reserve_discount / fn_guest_shop_create_order）裁定。
 *   - buildGuestAmountBreakdown 只把**数据库已返回**的金额整形为展示用 breakdown，
 *     任何缺失/不自洽的行都被丢弃（返回 null），绝不自行推算一个金额。
 *
 * 配套交付物（§9.5 要求，Codex 不执行）：
 *   supabase/migrations/20260923_verify_guest_shop_promo_parity.sql
 *   —— 用**同一组 group A fixture** 在 DB 侧 SELECT 出 resolver 结果做比对。
 *   下面的 `companion SQL` 用例断言两份交付物覆盖同一批 fixture id，防止漂移。
 *   group B/C/D 依赖订单行/券行/买家身份等 DB 状态，无法只靠字面量在 DB 侧重放，
 *   其 DB 侧权威由 §15.4 九项沙箱实机验证 + 23 行 verify 的 zero_purchase_guards /
 *   promo_function_guards 行覆盖；本文件只固化它们的 **JS 展示层 fail-closed** 行为。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    GUEST_QUANTITY_CEILING,
    resolveGuestCreditUnitAmount,
    resolveGuestListSubtotal,
    resolveGuestOrderPayablePricing
} = require('../api/_lib/guest-shop/pricing');

const {
    GUEST_MAX_QUANTITY_CEILING,
    buildGuestAmountBreakdown,
    normalizeGuestQuantity,
    resolveGuestQuantityCap
} = require('../api/_lib/guest-shop/promo');

// 固定「现在」，让闪购生效/过期完全由 fixture 决定，与真实时钟无关。
const NOW = new Date('2026-09-14T12:00:00.000Z');
const NOW_ISO = '2026-09-14T12:00:00.000Z';
const FUTURE = '2026-09-14T13:00:00.000Z';
const PAST = '2026-09-14T11:00:00.000Z';

const COMPANION_SQL = path.join(
    __dirname,
    '..',
    'supabase',
    'migrations',
    '20260923_verify_guest_shop_promo_parity.sql'
);

// ---------------------------------------------------------------------------
// Group A —— 单价/列表价 resolver（JS 镜像 == SQL 权威）。
// 每条都可序列化成 resolver 入参，配套 SQL 文件用同一批 id 在 DB 侧重放。
// 覆盖 §9.5：基础价 / 闪购生效·过期 / 阶梯命中·未命中 / quantity 1~5 /
//           INTL 站点回落 CN 价 / 各类越界拒绝。
// ---------------------------------------------------------------------------
const UNIT_VECTORS = [
    // 基础价
    { id: 'A01', desc: 'CN 基础价', input: { site: 'cn', skuPricePoints: 12.34 }, expected: 12.34 },
    { id: 'A02', desc: 'CN 整数基础价', input: { site: 'cn', skuPricePoints: 10 }, expected: 10 },
    { id: 'A03', desc: 'INTL 自有价', input: { site: 'intl', skuPricePointsIntl: 20, skuPricePoints: 12.34 }, expected: 20 },
    // INTL 回落 CN（§9.5「INTL 站点回落 CN 价」）
    { id: 'A04', desc: 'INTL 缺失回落 CN(null)', input: { site: 'intl', skuPricePointsIntl: null, skuPricePoints: 12.34 }, expected: 12.34 },
    { id: 'A05', desc: 'INTL 非正回落 CN(0)', input: { site: 'intl', skuPricePointsIntl: 0, skuPricePoints: 9.5 }, expected: 9.5 },
    { id: 'A06', desc: 'INTL 非正回落 CN(负)', input: { site: 'intl', skuPricePointsIntl: -1, skuPricePoints: 8 }, expected: 8 },
    // 站点/基础价越界拒绝
    { id: 'A07', desc: '未知站点拒绝', input: { site: 'us', skuPricePoints: 10 }, expected: null },
    { id: 'A08', desc: '缺站点拒绝', input: { skuPricePoints: 10 }, expected: null },
    { id: 'A09', desc: '基础价 0 拒绝', input: { site: 'cn', skuPricePoints: 0 }, expected: null },
    { id: 'A10', desc: '基础价负拒绝', input: { site: 'cn', skuPricePoints: -1 }, expected: null },
    { id: 'A11', desc: '基础价缺失不回退商品价', input: { site: 'cn', skuPricePoints: null, productPricePoints: 99 }, expected: null },
    // 阶梯命中/未命中（§9.5「阶梯命中 / 未命中」「quantity 1~5」）
    { id: 'A12', desc: '阶梯 qty1 命中首档', input: { site: 'cn', skuPricePoints: 12.34, skuQuantityRules: [{ qty: 1, price: 10 }, { qty: 3, price: 8 }, { qty: 5, price: 6 }], quantity: 1 }, expected: 10 },
    { id: 'A13', desc: '阶梯 qty2 未达次档', input: { site: 'cn', skuPricePoints: 12.34, skuQuantityRules: [{ qty: 1, price: 10 }, { qty: 3, price: 8 }, { qty: 5, price: 6 }], quantity: 2 }, expected: 10 },
    { id: 'A14', desc: '阶梯 qty3 命中', input: { site: 'cn', skuPricePoints: 12.34, skuQuantityRules: [{ qty: 1, price: 10 }, { qty: 3, price: 8 }, { qty: 5, price: 6 }], quantity: 3 }, expected: 8 },
    { id: 'A15', desc: '阶梯 qty4 沿用 qty3 档', input: { site: 'cn', skuPricePoints: 12.34, skuQuantityRules: [{ qty: 1, price: 10 }, { qty: 3, price: 8 }, { qty: 5, price: 6 }], quantity: 4 }, expected: 8 },
    { id: 'A16', desc: '阶梯 qty5 命中最低档', input: { site: 'cn', skuPricePoints: 12.34, skuQuantityRules: [{ qty: 1, price: 10 }, { qty: 3, price: 8 }, { qty: 5, price: 6 }], quantity: 5 }, expected: 6 },
    { id: 'A17', desc: '高于列表价的阶梯永不抬价', input: { site: 'cn', skuPricePoints: 12.34, skuQuantityRules: [{ qty: 2, price: 99 }], quantity: 3 }, expected: 12.34 },
    // 闪购生效/过期（§9.5「闪购生效 / 过期」）
    { id: 'A18', desc: '闪购生效且更便宜', input: { site: 'cn', skuPricePoints: 12.34, productFlashSalePrice: 7, productFlashSaleEnd: FUTURE }, expected: 7 },
    { id: 'A19', desc: '闪购生效但更贵(LEAST 保基础价)', input: { site: 'cn', skuPricePoints: 12.34, productFlashSalePrice: 20, productFlashSaleEnd: FUTURE }, expected: 12.34 },
    { id: 'A20', desc: '闪购过期回落阶梯', input: { site: 'cn', skuPricePoints: 12.34, productFlashSalePrice: 7, productFlashSaleEnd: PAST, skuQuantityRules: [{ qty: 1, price: 10 }, { qty: 3, price: 8 }, { qty: 5, price: 6 }], quantity: 3 }, expected: 8 },
    { id: 'A21', desc: '闪购生效跳过阶梯', input: { site: 'cn', skuPricePoints: 12.34, productFlashSalePrice: 10, productFlashSaleEnd: FUTURE, skuQuantityRules: [{ qty: 1, price: 8 }] }, expected: 10 },
    // 默认 SKU 回退商品级阶梯
    { id: 'A22', desc: '默认 SKU 用商品阶梯', input: { site: 'cn', skuPricePoints: 12.34, skuIsDefault: true, skuQuantityRules: null, productQuantityRules: [{ qty: 1, price: 11 }] }, expected: 11 },
    { id: 'A23', desc: '非默认 SKU 忽略商品阶梯', input: { site: 'cn', skuPricePoints: 12.34, skuIsDefault: false, skuQuantityRules: null, productQuantityRules: [{ qty: 1, price: 11 }] }, expected: 12.34 },
    // INTL 营销数据回落
    { id: 'A24', desc: 'INTL 无自有阶梯回落 CN 阶梯', input: { site: 'intl', skuPricePointsIntl: null, skuPricePoints: 12.34, skuQuantityRulesIntl: null, skuQuantityRules: [{ qty: 1, price: 9.5 }, { qty: 2, price: 7 }], quantity: 2 }, expected: 7 },
    { id: 'A25', desc: 'INTL 自有阶梯优先', input: { site: 'intl', skuPricePointsIntl: 20, skuPricePoints: 12.34, skuQuantityRulesIntl: [{ qty: 1, price: 18 }], skuQuantityRules: [{ qty: 1, price: 9.5 }] }, expected: 18 },
    // quantity 越界（resolver 自带 1..99 边界）
    { id: 'A26', desc: 'qty0 拒绝', input: { site: 'cn', skuPricePoints: 12.34, quantity: 0 }, expected: null },
    { id: 'A27', desc: 'qty 负拒绝', input: { site: 'cn', skuPricePoints: 12.34, quantity: -1 }, expected: null },
    { id: 'A28', desc: 'qty 小数拒绝', input: { site: 'cn', skuPricePoints: 12.34, quantity: 1.5 }, expected: null },
    { id: 'A29', desc: 'qty 超 99 拒绝', input: { site: 'cn', skuPricePoints: 12.34, quantity: 100 }, expected: null },
    { id: 'A30', desc: 'qty 非数字拒绝', input: { site: 'cn', skuPricePoints: 12.34, quantity: 'abc' }, expected: null },
    { id: 'A31', desc: 'qty 数字字符串可解析', input: { site: 'cn', skuPricePoints: 12.34, quantity: '2' }, expected: 12.34 },
    { id: 'A32', desc: 'qty 99 边界可解析', input: { site: 'cn', skuPricePoints: 12.34, quantity: 99 }, expected: 12.34 }
];

// ---------------------------------------------------------------------------
// Group B —— 多件小计 / 订单应付（含 1% 通道费、期望基额一致性闸）。
// 覆盖 §9.5「quantity 1~5」的小计与手续费侧；手续费基额是**净订单额**不是单价。
// ---------------------------------------------------------------------------
const SUBTOTAL_VECTORS = [
    { id: 'B01', desc: '小计 10×3', call: () => resolveGuestListSubtotal({ unitAmount: 10, quantity: 3 }), expected: 30 },
    { id: 'B02', desc: '小计 12.34×1', call: () => resolveGuestListSubtotal({ unitAmount: 12.34, quantity: 1 }), expected: 12.34 },
    { id: 'B03', desc: '小计 qty0 拒绝', call: () => resolveGuestListSubtotal({ unitAmount: 10, quantity: 0 }), expected: null },
    { id: 'B04', desc: '小计 qty100 拒绝', call: () => resolveGuestListSubtotal({ unitAmount: 10, quantity: 100 }), expected: null },
    { id: 'B05', desc: '小计 单价0 拒绝', call: () => resolveGuestListSubtotal({ unitAmount: 0, quantity: 3 }), expected: null }
];

const ORDER_PAYABLE_VECTORS = [
    {
        id: 'B06', desc: '应付 10×3 zpay：基额30 费0.30 应付30.30',
        call: () => resolveGuestOrderPayablePricing({ unitAmount: 10, quantity: 3, providerKey: 'zpay' }),
        assert: (r) => {
            assert.equal(r.baseAmount, 30);
            assert.equal(r.surchargeAmount, 0.3);
            assert.equal(r.payableAmount, 30.3);
            assert.equal(r.quantity, 3);
            assert.equal(r.unitAmount, 10);
        }
    },
    {
        id: 'B07', desc: '应付 期望基额一致(30)通过',
        call: () => resolveGuestOrderPayablePricing({ unitAmount: 10, quantity: 3, providerKey: 'zpay', expectedBaseAmount: 30 }),
        assert: (r) => assert.equal(r.payableAmount, 30.3)
    },
    {
        id: 'B08', desc: '应付 期望基额不一致(29)拒绝',
        call: () => resolveGuestOrderPayablePricing({ unitAmount: 10, quantity: 3, providerKey: 'zpay', expectedBaseAmount: 29 }),
        expected: null
    },
    {
        id: 'B09', desc: '应付 12.34×1：费向上取整 0.13 应付 12.47',
        call: () => resolveGuestOrderPayablePricing({ unitAmount: 12.34, quantity: 1, providerKey: 'zpay' }),
        assert: (r) => {
            assert.equal(r.baseAmount, 12.34);
            assert.equal(r.surchargeAmount, 0.13);
            assert.equal(r.payableAmount, 12.47);
        }
    },
    {
        id: 'B10', desc: '应付 6×5：基额30 费0.30 应付30.30',
        call: () => resolveGuestOrderPayablePricing({ unitAmount: 6, quantity: 5, providerKey: 'zpay' }),
        assert: (r) => {
            assert.equal(r.baseAmount, 30);
            assert.equal(r.payableAmount, 30.3);
            assert.equal(r.quantity, 5);
        }
    }
];

// ---------------------------------------------------------------------------
// Group C —— 折扣 breakdown（整形**数据库已返回**的行）。
// 覆盖 §9.5：percent 券 1/5/10/50/90/100、fixed 券 小于/等于/大于 subtotal、
//           券过期、折后低于下限、折后为 0、非法 code 格式、不自洽行丢弃。
// 红线：JS 层从不推算折扣；零元/负值/不自洽一律 null（fail-closed），
//       这正是「绝不零元购」在展示层的镜像。
// ---------------------------------------------------------------------------
const row = (o) => buildGuestAmountBreakdown(o);
const BREAKDOWN_VECTORS = [
    {
        id: 'C01', desc: 'percent 1% on ¥100',
        call: () => row({ quantity: 1, list_unit_amount: 100, unit_amount: 99, discount_amount: 1, payment_fee_amount: 0.99, total_amount: 99.99, discount_code: 'SAVE1' }),
        expected: { quantity: 1, unit_amount: 99, net_amount: 99, discount_amount: 1, payment_fee_amount: 0.99, total_amount: 99.99, currency: 'CNY', list_unit_amount: 100, list_amount: 100, discount_code: 'SAVE1' }
    },
    {
        id: 'C02', desc: 'percent 5% on ¥100',
        call: () => row({ quantity: 1, list_unit_amount: 100, unit_amount: 95, discount_amount: 5, payment_fee_amount: 0.95, total_amount: 95.95, discount_code: 'SAVE5' }),
        expected: { quantity: 1, unit_amount: 95, net_amount: 95, discount_amount: 5, payment_fee_amount: 0.95, total_amount: 95.95, currency: 'CNY', list_unit_amount: 100, list_amount: 100, discount_code: 'SAVE5' }
    },
    {
        id: 'C03', desc: 'percent 10% on ¥100',
        call: () => row({ quantity: 1, list_unit_amount: 100, unit_amount: 90, discount_amount: 10, payment_fee_amount: 0.9, total_amount: 90.9, discount_code: 'SAVE10' }),
        expected: { quantity: 1, unit_amount: 90, net_amount: 90, discount_amount: 10, payment_fee_amount: 0.9, total_amount: 90.9, currency: 'CNY', list_unit_amount: 100, list_amount: 100, discount_code: 'SAVE10' }
    },
    {
        id: 'C04', desc: 'percent 50% on ¥100',
        call: () => row({ quantity: 1, list_unit_amount: 100, unit_amount: 50, discount_amount: 50, payment_fee_amount: 0.5, total_amount: 50.5, discount_code: 'HALF' }),
        expected: { quantity: 1, unit_amount: 50, net_amount: 50, discount_amount: 50, payment_fee_amount: 0.5, total_amount: 50.5, currency: 'CNY', list_unit_amount: 100, list_amount: 100, discount_code: 'HALF' }
    },
    {
        id: 'C05', desc: 'percent 90% on ¥100（DB 硬顶 90）',
        call: () => row({ quantity: 1, list_unit_amount: 100, unit_amount: 10, discount_amount: 90, payment_fee_amount: 0.1, total_amount: 10.1, discount_code: 'SAVE90' }),
        expected: { quantity: 1, unit_amount: 10, net_amount: 10, discount_amount: 90, payment_fee_amount: 0.1, total_amount: 10.1, currency: 'CNY', list_unit_amount: 100, list_amount: 100, discount_code: 'SAVE90' }
    },
    {
        id: 'C06', desc: 'percent 100% → 净额 0 → 拒绝（零元购地板）',
        call: () => row({ quantity: 1, list_unit_amount: 100, unit_amount: 0, discount_amount: 100, payment_fee_amount: 0, total_amount: 0 }),
        expected: null
    },
    {
        id: 'C07', desc: 'fixed ¥5 < subtotal',
        call: () => row({ quantity: 1, list_unit_amount: 100, unit_amount: 95, discount_amount: 5, payment_fee_amount: 0.95, total_amount: 95.95, discount_code: 'FIX5' }),
        expected: { quantity: 1, unit_amount: 95, net_amount: 95, discount_amount: 5, payment_fee_amount: 0.95, total_amount: 95.95, currency: 'CNY', list_unit_amount: 100, list_amount: 100, discount_code: 'FIX5' }
    },
    {
        id: 'C08', desc: 'fixed == subtotal → 净额 0 → 拒绝',
        call: () => row({ quantity: 1, list_unit_amount: 100, unit_amount: 0, discount_amount: 100, payment_fee_amount: 0, total_amount: 0 }),
        expected: null
    },
    {
        id: 'C09', desc: 'fixed > subtotal → 负净额 → 拒绝',
        call: () => row({ quantity: 1, list_unit_amount: 100, unit_amount: -50, discount_amount: 150, payment_fee_amount: 0, total_amount: -50 }),
        expected: null
    },
    {
        id: 'C10', desc: '券过期/无折扣：不显示 discount_code',
        call: () => row({ quantity: 1, list_unit_amount: 100, unit_amount: 100, discount_amount: 0, payment_fee_amount: 1, total_amount: 101, discount_code: 'EXPIRED' }),
        expected: { quantity: 1, unit_amount: 100, net_amount: 100, discount_amount: 0, payment_fee_amount: 1, total_amount: 101, currency: 'CNY', list_unit_amount: 100, list_amount: 100 }
    },
    {
        id: 'C11', desc: '非法 code 格式：即便有折扣也不显示 code',
        call: () => row({ quantity: 1, list_unit_amount: 100, unit_amount: 90, discount_amount: 10, payment_fee_amount: 0.9, total_amount: 90.9, discount_code: 'BAD CODE!' }),
        expected: { quantity: 1, unit_amount: 90, net_amount: 90, discount_amount: 10, payment_fee_amount: 0.9, total_amount: 90.9, currency: 'CNY', list_unit_amount: 100, list_amount: 100 }
    },
    {
        id: 'C12', desc: '合法 code 小写入参被规范化为大写',
        call: () => row({ quantity: 1, list_unit_amount: 100, unit_amount: 90, discount_amount: 10, payment_fee_amount: 0.9, total_amount: 90.9, discount_code: 'save10' }),
        expected: { quantity: 1, unit_amount: 90, net_amount: 90, discount_amount: 10, payment_fee_amount: 0.9, total_amount: 90.9, currency: 'CNY', list_unit_amount: 100, list_amount: 100, discount_code: 'SAVE10' }
    },
    {
        id: 'C13', desc: '不自洽行(net+fee≠total)丢弃',
        call: () => row({ quantity: 1, list_unit_amount: 100, unit_amount: 99, discount_amount: 1, payment_fee_amount: 0.99, total_amount: 99.98 }),
        expected: null
    },
    {
        id: 'C14', desc: 'legacy 行(list_unit 为空)：无 list 线但保留 code',
        call: () => row({ quantity: 1, list_unit_amount: null, unit_amount: 99, discount_amount: 1, payment_fee_amount: 0.99, total_amount: 99.99, discount_code: 'SAVE1' }),
        expected: { quantity: 1, unit_amount: 99, net_amount: 99, discount_amount: 1, payment_fee_amount: 0.99, total_amount: 99.99, currency: 'CNY', discount_code: 'SAVE1' }
    },
    {
        id: 'C15', desc: 'breakdown qty>5 拒绝（GUEST_MAX_QUANTITY_CEILING）',
        call: () => row({ quantity: 6, list_unit_amount: 100, unit_amount: 99, discount_amount: 1, payment_fee_amount: 0.99, total_amount: 99.99 }),
        expected: null
    },
    {
        id: 'C16', desc: '多件 qty5 阶梯+券一致',
        call: () => row({ quantity: 5, list_unit_amount: 20, unit_amount: 18, discount_amount: 10, payment_fee_amount: 0.9, total_amount: 90.9, discount_code: 'SAVE10' }),
        expected: { quantity: 5, unit_amount: 18, net_amount: 90, discount_amount: 10, payment_fee_amount: 0.9, total_amount: 90.9, currency: 'CNY', list_unit_amount: 20, list_amount: 100, discount_code: 'SAVE10' }
    },
    {
        id: 'C17', desc: '负折扣拒绝',
        call: () => row({ quantity: 1, list_unit_amount: 100, unit_amount: 99, discount_amount: -1, payment_fee_amount: 0.99, total_amount: 99.99 }),
        expected: null
    },
    {
        id: 'C18', desc: '负手续费拒绝',
        call: () => row({ quantity: 1, list_unit_amount: 100, unit_amount: 99, discount_amount: 1, payment_fee_amount: -0.99, total_amount: 99.99 }),
        expected: null
    },
    {
        id: 'C19', desc: 'total<=0 拒绝',
        call: () => row({ quantity: 1, list_unit_amount: 100, unit_amount: 99, discount_amount: 1, payment_fee_amount: 0, total_amount: 0 }),
        expected: null
    },
    {
        id: 'C20', desc: '多件 qty3 percent：list300 net270 discount30',
        call: () => row({ quantity: 3, list_unit_amount: 100, unit_amount: 90, discount_amount: 30, payment_fee_amount: 2.7, total_amount: 272.7, discount_code: 'SAVE10' }),
        expected: { quantity: 3, unit_amount: 90, net_amount: 270, discount_amount: 30, payment_fee_amount: 2.7, total_amount: 272.7, currency: 'CNY', list_unit_amount: 100, list_amount: 300, discount_code: 'SAVE10' }
    }
];

// ---------------------------------------------------------------------------
// Group D —— 件数上限（env 与 DB 上限取 min，越界/非法一律降级到 1，绝不放大）。
// 覆盖 §9.5「quantity 1~5」的闸门侧，并固化「out-of-range env → 1」的 fail-closed。
// ---------------------------------------------------------------------------
const QUANTITY_VECTORS = [
    { id: 'D01', desc: '默认上限 1', call: () => resolveGuestQuantityCap({ env: {} }), expected: 1 },
    { id: 'D02', desc: 'env3 + sku5 + purchase5 → 3', call: () => resolveGuestQuantityCap({ env: { GUEST_SHOP_MAX_QUANTITY: '3' }, skuGuestMaxQuantity: 5, productMaxPurchaseQuantity: 5 }), expected: 3 },
    { id: 'D03', desc: 'env10 超上限 → 降级 1（绝不放大到 5）', call: () => resolveGuestQuantityCap({ env: { GUEST_SHOP_MAX_QUANTITY: '10' }, skuGuestMaxQuantity: 5, productMaxPurchaseQuantity: 5 }), expected: 1 },
    { id: 'D04', desc: 'env 非法 → 降级 1', call: () => resolveGuestQuantityCap({ env: { GUEST_SHOP_MAX_QUANTITY: 'abc' }, skuGuestMaxQuantity: 5, productMaxPurchaseQuantity: 5 }), expected: 1 },
    { id: 'D05', desc: 'env5 合法 + sku5 → 5（DB 天花板）', call: () => resolveGuestQuantityCap({ env: { GUEST_SHOP_MAX_QUANTITY: '5' }, skuGuestMaxQuantity: 5, productMaxPurchaseQuantity: 5 }), expected: 5 },
    { id: 'D06', desc: 'sku1 收紧到 1（即便 env3）', call: () => resolveGuestQuantityCap({ env: { GUEST_SHOP_MAX_QUANTITY: '3' }, skuGuestMaxQuantity: 1, productMaxPurchaseQuantity: 5 }), expected: 1 },
    { id: 'D07', desc: 'normalize undefined → 1', call: () => normalizeGuestQuantity(undefined, { cap: 1 }), expected: 1 },
    { id: 'D08', desc: 'normalize 3 超 cap1 → null', call: () => normalizeGuestQuantity(3, { cap: 1 }), expected: null },
    { id: 'D09', desc: "normalize '2' cap3 → 2", call: () => normalizeGuestQuantity('2', { cap: 3 }), expected: 2 },
    { id: 'D10', desc: 'normalize 0 → null', call: () => normalizeGuestQuantity(0, { cap: 3 }), expected: null },
    { id: 'D11', desc: 'normalize 负 → null', call: () => normalizeGuestQuantity(-1, { cap: 3 }), expected: null },
    { id: 'D12', desc: 'normalize 6 超 DB 天花板5 → null', call: () => normalizeGuestQuantity(6, { cap: GUEST_MAX_QUANTITY_CEILING }), expected: null }
];

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

test('§9.5 group A：单价/列表价 resolver 黄金向量（JS 镜像 == 期望值）', () => {
    for (const v of UNIT_VECTORS) {
        const actual = resolveGuestCreditUnitAmount({ now: NOW, ...v.input });
        assert.equal(
            actual,
            v.expected,
            `[${v.id}] ${v.desc}: 期望 ${v.expected}，实际 ${actual}`
        );
    }
});

test('§9.5 group B：多件小计黄金向量', () => {
    for (const v of SUBTOTAL_VECTORS) {
        assert.equal(v.call(), v.expected, `[${v.id}] ${v.desc}`);
    }
});

test('§9.5 group B：订单应付（含 1% 通道费与基额一致性闸）黄金向量', () => {
    for (const v of ORDER_PAYABLE_VECTORS) {
        const actual = v.call();
        if (v.assert) {
            v.assert(actual);
        } else {
            assert.equal(actual, v.expected, `[${v.id}] ${v.desc}`);
        }
    }
});

test('§9.5 group C：折扣 breakdown 黄金向量（零元/负值/不自洽一律 fail-closed）', () => {
    for (const v of BREAKDOWN_VECTORS) {
        const actual = v.call();
        assert.deepEqual(actual, v.expected, `[${v.id}] ${v.desc}`);
    }
});

test('§9.5 group D：件数上限黄金向量（越界 env 降级到 1，绝不放大）', () => {
    for (const v of QUANTITY_VECTORS) {
        assert.equal(v.call(), v.expected, `[${v.id}] ${v.desc}`);
    }
});

test('§9.5 黄金向量总数 ≥ 40（防止将来被悄悄削减到规格线下）', () => {
    const total = UNIT_VECTORS.length
        + SUBTOTAL_VECTORS.length
        + ORDER_PAYABLE_VECTORS.length
        + BREAKDOWN_VECTORS.length
        + QUANTITY_VECTORS.length;
    assert.ok(total >= 40, `黄金向量总数 ${total} < 40`);
});

test('红线：resolver 镜像从不算折扣——折扣类入参被完全忽略', () => {
    // 即便塞进各种「折扣」字段，单价镜像也必须只反映基础价/闪购/阶梯，
    // 绝不在 JS 侧产生任何折后价（折扣是 SQL 专属权威）。
    const base = resolveGuestCreditUnitAmount({ site: 'cn', skuPricePoints: 100, now: NOW });
    const withDiscountNoise = resolveGuestCreditUnitAmount({
        site: 'cn',
        skuPricePoints: 100,
        now: NOW,
        discount_code: 'SAVE90',
        discount_amount: 90,
        guest_max_discount_percent: 90,
        percent_off: 90
    });
    assert.equal(base, 100);
    assert.equal(withDiscountNoise, 100);
});

test('红线：resolver 镜像的 quantity 天花板与 SQL 边界一致（99）', () => {
    assert.equal(GUEST_QUANTITY_CEILING, 99);
    assert.equal(GUEST_MAX_QUANTITY_CEILING, 5);
});

test('§9.5 配套 SQL parity 文件存在且覆盖全部 group A fixture id（防漂移）', () => {
    assert.ok(fs.existsSync(COMPANION_SQL), `缺少配套 SQL parity 文件：${COMPANION_SQL}`);
    const sql = fs.readFileSync(COMPANION_SQL, 'utf8');
    const missing = UNIT_VECTORS.map((v) => v.id).filter((id) => !sql.includes(`'${id}'`));
    assert.deepEqual(missing, [], `配套 SQL 缺少 group A fixture id：${missing.join(', ')}`);
    // 只读交付物：不得含写操作关键字（DML/DDL），与其余 verify 文件同一条纪律。
    assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)\b/i.test(
        sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    ), '配套 SQL parity 文件必须只读（剥注释后不得出现写操作关键字）');
});
