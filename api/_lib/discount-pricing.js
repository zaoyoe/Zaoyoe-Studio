const VALID_PRICING_APPLY_STAGES = new Set([
    'catalog_price',
    'order_discount',
    'balance_offset'
]);

function normalizeText(value, maxLength = 255) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizePricingApplyStage(value, fallback = 'order_discount') {
    const normalized = normalizeText(value, 40).toLowerCase();
    return VALID_PRICING_APPLY_STAGES.has(normalized) ? normalized : fallback;
}

function formatPricingApplyStageLabel(value = '') {
    switch (normalizePricingApplyStage(value, 'order_discount')) {
        case 'catalog_price':
            return '目录价阶段';
        case 'balance_offset':
            return '余额抵扣阶段';
        case 'order_discount':
        default:
            return '订单优惠阶段';
    }
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return value !== 0;
    }

    const normalized = normalizeText(value, 20).toLowerCase();
    if (!normalized) {
        return fallback;
    }
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
        return true;
    }
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
        return false;
    }
    return fallback;
}

function normalizeInteger(value, fallback = 0, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, parsed));
}

function normalizeMoney(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function buildDiscountStackingPolicy(source = {}) {
    const isExclusive = normalizeBoolean(source?.is_exclusive, true);
    const stackPriority = normalizeInteger(source?.stack_priority, 100, { min: 1, max: 9999 });
    const pricingApplyStage = normalizePricingApplyStage(source?.pricing_apply_stage, 'order_discount');

    return {
        is_exclusive: isExclusive,
        stack_priority: stackPriority,
        pricing_apply_stage: pricingApplyStage,
        exclusivity_label: isExclusive ? '排他券' : '可并行',
        apply_stage_label: formatPricingApplyStageLabel(pricingApplyStage),
        summary: isExclusive
            ? `当前按排他券处理，在 ${formatPricingApplyStageLabel(pricingApplyStage)} 生效。`
            : `当前预留并行权益优先级，按 ${formatPricingApplyStageLabel(pricingApplyStage)} 与优先级 ${stackPriority} 参与结算。`
    };
}

function buildPricingWaterfall(source = {}, options = {}) {
    const quantity = normalizeInteger(options.quantity ?? source?.quantity, 1, { min: 1, max: 9999 });
    const unitPrice = Math.max(0, normalizeMoney(source?.unit_price ?? source?.unitPrice, 0));
    const subtotal = Math.max(0, normalizeMoney(source?.subtotal ?? source?.subtotal_points, unitPrice * quantity));
    const discountAmount = Math.max(0, normalizeMoney(source?.discount_amount ?? source?.discountAmount, 0));
    const finalTotal = Math.max(0, normalizeMoney(
        source?.final_total
        ?? source?.finalTotal
        ?? source?.paid_amount
        ?? (subtotal - discountAmount),
        subtotal - discountAmount
    ));
    const normalizedCode = normalizeText(source?.discount_code || source?.discountCode || '', 80).toUpperCase();
    const policy = buildDiscountStackingPolicy(source);
    const rows = [
        {
            key: 'unit_price',
            label: '站点结算单价',
            amount: unitPrice,
            detail: `${unitPrice} x ${quantity}`,
            tone: 'base'
        },
        {
            key: 'subtotal',
            label: '商品小计',
            amount: subtotal,
            detail: quantity > 1 ? `数量 ${quantity}` : '单件结算',
            tone: 'subtotal'
        }
    ];

    if (discountAmount > 0) {
        rows.push({
            key: 'discount',
            label: normalizedCode ? `优惠券 ${normalizedCode}` : '优惠券抵扣',
            amount: discountAmount,
            display_amount: -discountAmount,
            detail: `${policy.apply_stage_label} · ${policy.exclusivity_label} · 优先级 ${policy.stack_priority}`,
            tone: 'discount'
        });
    }

    rows.push({
        key: 'total',
        label: '实付积分',
        amount: finalTotal,
        detail: discountAmount > 0 ? '已包含优惠抵扣' : '未使用优惠',
        tone: 'total'
    });

    return {
        rows,
        stacking_policy: policy
    };
}

module.exports = {
    VALID_PRICING_APPLY_STAGES,
    normalizeText,
    normalizePricingApplyStage,
    formatPricingApplyStageLabel,
    buildDiscountStackingPolicy,
    buildPricingWaterfall
};
