const VALID_PRICING_APPLY_STAGES = new Set([
    'catalog_price',
    'order_discount',
    'balance_offset'
]);

const PRICING_STAGE_ORDER = {
    catalog_price: 0,
    order_discount: 1,
    balance_offset: 2
};

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

function normalizeMaxDiscountQuantity(value) {
    const parsed = normalizeInteger(value, 0, { min: 0, max: 9999 });
    return Number.isFinite(parsed) ? parsed : 0;
}

function resolveDiscountEligibleSubtotal({ subtotal = 0, unitPrice = 0, quantity = 1, maxDiscountQuantity = 0 } = {}) {
    const normalizedSubtotal = Math.max(0, normalizeMoney(subtotal, 0));
    const normalizedQuantity = normalizeInteger(quantity, 1, { min: 1, max: 9999 });
    const normalizedUnitPrice = Math.max(0, normalizeMoney(unitPrice, normalizedQuantity > 0 ? normalizedSubtotal / normalizedQuantity : normalizedSubtotal));
    const normalizedMaxQuantity = normalizeMaxDiscountQuantity(maxDiscountQuantity);

    if (normalizedMaxQuantity <= 0 || normalizedMaxQuantity >= normalizedQuantity || !(normalizedUnitPrice > 0)) {
        return normalizedSubtotal;
    }

    return Math.max(0, Math.min(normalizedSubtotal, Number((normalizedUnitPrice * normalizedMaxQuantity).toFixed(2))));
}

function buildDiscountStackingPolicy(source = {}) {
    const isExclusive = normalizeBoolean(source?.is_exclusive, true);
    const stackPriority = normalizeInteger(source?.stack_priority, 100, { min: 1, max: 9999 });
    const pricingApplyStage = normalizePricingApplyStage(source?.pricing_apply_stage, 'order_discount');

    return {
        is_exclusive: isExclusive,
        stack_priority: stackPriority,
        pricing_apply_stage: pricingApplyStage,
        exclusivity_label: isExclusive ? '排他券' : '可并行权益',
        apply_stage_label: formatPricingApplyStageLabel(pricingApplyStage),
        summary: isExclusive
            ? `当前按排他券处理，在 ${formatPricingApplyStageLabel(pricingApplyStage)} 生效。`
            : `这张券可与其它可并行权益叠加，在 ${formatPricingApplyStageLabel(pricingApplyStage)} 按优先级 ${stackPriority} 参与结算。`
    };
}

function normalizeDiscountSelection(source = {}) {
    const pricingApplyStage = normalizePricingApplyStage(source?.pricing_apply_stage ?? source?.pricingApplyStage, 'order_discount');
    const discountType = normalizeText(source?.discount_type ?? source?.discountType, 20).toLowerCase();
    const discountValue = normalizeMoney(source?.discount_value ?? source?.discountValue, NaN);
    const quantity = normalizeInteger(source?.quantity ?? source?.item_count ?? source?.itemCount, 1, { min: 1, max: 9999 });
    const unitPrice = Math.max(0, normalizeMoney(source?.unit_price ?? source?.unitPrice, 0));
    const maxDiscountQuantity = normalizeMaxDiscountQuantity(
        source?.max_discount_quantity
        ?? source?.maxDiscountQuantity
        ?? source?.discount_quantity_limit
        ?? source?.discountQuantityLimit
    );
    const discountAmount = Math.max(0, normalizeMoney(source?.discount_amount ?? source?.discountAmount, 0));
    const finalTotalAfterApply = normalizeMoney(
        source?.final_total_after_apply
        ?? source?.finalTotalAfterApply
        ?? source?.final_total
        ?? source?.finalTotal,
        NaN
    );

    return {
        code: normalizeText(source?.discount_code ?? source?.discountCode ?? source?.code, 80).toUpperCase() || null,
        asset_id: normalizeText(source?.discount_asset_id ?? source?.discountAssetId ?? source?.asset_id ?? source?.assetId, 160) || null,
        discount_id: normalizeText(source?.discount_id ?? source?.discountId ?? source?.id, 160) || null,
        scope_product_sku_id: normalizeText(source?.scope_product_sku_id ?? source?.scopeProductSkuId, 160) || null,
        discount_type: discountType || null,
        discount_value: Number.isFinite(discountValue) ? discountValue : null,
        quantity,
        unit_price: unitPrice,
        max_discount_quantity: maxDiscountQuantity,
        discount_amount: discountAmount,
        final_total_after_apply: Number.isFinite(finalTotalAfterApply) ? Math.max(0, finalTotalAfterApply) : null,
        allow_zero_total: normalizeBoolean(source?.allow_zero_total ?? source?.allowZeroTotal, false),
        is_exclusive: normalizeBoolean(source?.is_exclusive ?? source?.isExclusive, true),
        stack_priority: normalizeInteger(source?.stack_priority ?? source?.stackPriority, 100, { min: 1, max: 9999 }),
        pricing_apply_stage: pricingApplyStage,
        apply_stage_label: formatPricingApplyStageLabel(pricingApplyStage),
        benefit_label: normalizeText(source?.benefit_label ?? source?.benefitLabel, 120) || null,
        distribution_mode: normalizeText(source?.distribution_mode ?? source?.distributionMode, 40).toLowerCase() || null,
        audience_segment: normalizeText(source?.audience_segment ?? source?.audienceSegment, 80) || null,
        campaign_tag: normalizeText(source?.campaign_tag ?? source?.campaignTag, 120) || null,
        source_channel: normalizeText(source?.source_channel ?? source?.sourceChannel, 80) || null,
        source_type: normalizeText(source?.source_type ?? source?.sourceType, 80) || null
    };
}

function sortDiscountSelections(discounts = []) {
    return (Array.isArray(discounts) ? discounts : []).slice().sort((left, right) => {
        const leftStage = PRICING_STAGE_ORDER[normalizePricingApplyStage(left?.pricing_apply_stage, 'order_discount')] ?? 999;
        const rightStage = PRICING_STAGE_ORDER[normalizePricingApplyStage(right?.pricing_apply_stage, 'order_discount')] ?? 999;
        if (leftStage !== rightStage) {
            return leftStage - rightStage;
        }

        const leftPriority = normalizeInteger(left?.stack_priority, 100, { min: 1, max: 9999 });
        const rightPriority = normalizeInteger(right?.stack_priority, 100, { min: 1, max: 9999 });
        if (leftPriority !== rightPriority) {
            return leftPriority - rightPriority;
        }

        const leftCode = normalizeText(left?.code ?? left?.discount_code, 80).toUpperCase();
        const rightCode = normalizeText(right?.code ?? right?.discount_code, 80).toUpperCase();
        if (leftCode !== rightCode) {
            return leftCode.localeCompare(rightCode);
        }

        return normalizeText(left?.asset_id ?? left?.discount_asset_id, 160)
            .localeCompare(normalizeText(right?.asset_id ?? right?.discount_asset_id, 160));
    });
}

function buildMultiDiscountStackingPolicy(appliedDiscounts = []) {
    const normalizedDiscounts = sortDiscountSelections(appliedDiscounts.map((item) => normalizeDiscountSelection(item)));
    const firstDiscount = normalizedDiscounts[0] || {};
    const stageLabels = [...new Set(normalizedDiscounts.map((item) => item.apply_stage_label || formatPricingApplyStageLabel(item.pricing_apply_stage)).filter(Boolean))];
    const discountCodes = normalizedDiscounts.map((item) => item.code).filter(Boolean);
    const selectedCount = normalizedDiscounts.length;

    return {
        is_exclusive: false,
        stack_priority: normalizeInteger(firstDiscount.stack_priority, 100, { min: 1, max: 9999 }),
        pricing_apply_stage: normalizePricingApplyStage(firstDiscount.pricing_apply_stage, 'order_discount'),
        exclusivity_label: `已叠加 ${selectedCount} 张`,
        apply_stage_label: stageLabels.length === 1 ? stageLabels[0] : '多阶段叠加',
        summary: selectedCount > 1
            ? `已按价格瀑布顺序叠加 ${selectedCount} 张卡券：${discountCodes.join(' + ')}。`
            : '当前已按价格瀑布顺序应用卡券。'
    };
}

function resolveSingleDiscountAmount(subtotal = 0, discount = {}) {
    const normalizedSubtotal = Math.max(0, normalizeMoney(subtotal, 0));
    const normalizedDiscount = normalizeDiscountSelection(discount);
    const discountValue = Number(normalizedDiscount.discount_value);
    const eligibleSubtotal = resolveDiscountEligibleSubtotal({
        subtotal: normalizedSubtotal,
        unitPrice: normalizedDiscount.unit_price,
        quantity: normalizedDiscount.quantity,
        maxDiscountQuantity: normalizedDiscount.max_discount_quantity
    });

    if (
        !normalizedDiscount.discount_type
        || !Number.isFinite(discountValue)
        || (normalizedDiscount.discount_type === 'percent' ? discountValue < 0 : discountValue <= 0)
        || normalizedSubtotal <= 0
        || eligibleSubtotal <= 0
    ) {
        return {
            has_effective_discount: false,
            discount_amount: 0,
            final_total: normalizedSubtotal
        };
    }

    if (normalizedDiscount.discount_type === 'percent') {
        const eligibleFinalTotal = Math.max(
            0,
            Math.min(eligibleSubtotal, Number(((eligibleSubtotal * discountValue) / 100).toFixed(2)))
        );
        const discountAmount = Math.max(0, Math.min(normalizedSubtotal, Number((eligibleSubtotal - eligibleFinalTotal).toFixed(2))));
        const finalTotal = Math.max(0, Number((normalizedSubtotal - discountAmount).toFixed(2)));
        if (!(discountAmount > 0)) {
            return {
                has_effective_discount: false,
                discount_amount: 0,
                final_total: normalizedSubtotal
            };
        }

        if (finalTotal === 0 && !normalizedDiscount.allow_zero_total) {
            return {
                has_effective_discount: false,
                discount_amount: discountAmount,
                final_total: 0
            };
        }

        return {
            has_effective_discount: true,
            discount_amount: discountAmount,
            final_total: finalTotal
        };
    }

    if (normalizedDiscount.discount_type === 'fixed') {
        const discountAmount = Math.min(eligibleSubtotal, discountValue);
        const finalTotal = Math.max(0, Number((normalizedSubtotal - discountAmount).toFixed(2)));
        if (!(discountAmount > 0)) {
            return {
                has_effective_discount: false,
                discount_amount: 0,
                final_total: normalizedSubtotal
            };
        }

        if (finalTotal === 0 && !normalizedDiscount.allow_zero_total) {
            return {
                has_effective_discount: false,
                discount_amount: discountAmount,
                final_total: 0
            };
        }

        return {
            has_effective_discount: true,
            discount_amount: discountAmount,
            final_total: finalTotal
        };
    }

    return {
        has_effective_discount: false,
        discount_amount: 0,
        final_total: normalizedSubtotal
    };
}

function resolveDiscountStacking({ subtotal = 0, discounts = [] } = {}) {
    const normalizedSubtotal = Math.max(0, normalizeMoney(subtotal, 0));
    const normalizedDiscounts = sortDiscountSelections(
        (Array.isArray(discounts) ? discounts : [])
            .map((discount) => normalizeDiscountSelection(discount))
            .filter((discount) => discount.code || discount.asset_id)
    );

    if (!normalizedDiscounts.length) {
        return {
            success: true,
            applied_discounts: [],
            discount_amount: 0,
            final_total: normalizedSubtotal,
            stacking_policy: null
        };
    }

    const exclusiveDiscount = normalizedDiscounts.find((discount) => discount.is_exclusive !== false) || null;
    if (exclusiveDiscount && normalizedDiscounts.length > 1) {
        return {
            success: false,
            message: `优惠券 ${exclusiveDiscount.code || '当前券'} 为排他券，不能与其他卡券叠加`
        };
    }

    let runningTotal = normalizedSubtotal;
    const appliedDiscounts = [];

    for (const discount of normalizedDiscounts) {
        const pricing = resolveSingleDiscountAmount(runningTotal, {
            ...discount,
            unit_price: discount.unit_price || (discount.quantity > 0 ? normalizedSubtotal / discount.quantity : 0)
        });
        if (!pricing.has_effective_discount) {
            const isZeroTotalRestricted = pricing.final_total === 0 && pricing.discount_amount > 0 && !discount.allow_zero_total;
            return {
                success: false,
                message: isZeroTotalRestricted
                    ? `优惠券 ${discount.code || '当前券'} 不允许全额抵扣`
                    : `优惠券 ${discount.code || '当前券'} 在当前组合下暂无可优惠金额`
            };
        }

        runningTotal = pricing.final_total;
        appliedDiscounts.push({
            ...discount,
            discount_amount: pricing.discount_amount,
            final_total_after_apply: runningTotal,
            apply_index: appliedDiscounts.length + 1
        });
    }

    const totalDiscountAmount = Math.max(
        0,
        Number(appliedDiscounts.reduce((sum, discount) => sum + Math.max(0, Number(discount.discount_amount || 0) || 0), 0).toFixed(2))
    );

    return {
        success: true,
        applied_discounts: appliedDiscounts,
        discount_amount: totalDiscountAmount,
        final_total: Math.max(0, Number(runningTotal.toFixed(2))),
        stacking_policy: appliedDiscounts.length === 1
            ? buildDiscountStackingPolicy(appliedDiscounts[0])
            : buildMultiDiscountStackingPolicy(appliedDiscounts)
    };
}

function buildPricingWaterfall(source = {}, options = {}) {
    const quantity = normalizeInteger(options.quantity ?? source?.quantity, 1, { min: 1, max: 9999 });
    const unitPrice = Math.max(0, normalizeMoney(source?.unit_price ?? source?.unitPrice, 0));
    const subtotal = Math.max(0, normalizeMoney(source?.subtotal ?? source?.subtotal_points, unitPrice * quantity));
    const requestedAppliedDiscounts = Array.isArray(source?.applied_discounts)
        ? source.applied_discounts
        : (Array.isArray(source?.appliedDiscounts) ? source.appliedDiscounts : []);
    const stackedDiscounts = requestedAppliedDiscounts.length
        ? resolveDiscountStacking({
            subtotal,
            discounts: requestedAppliedDiscounts
        })
        : null;
    const hasResolvedStack = stackedDiscounts?.success === true && Array.isArray(stackedDiscounts.applied_discounts) && stackedDiscounts.applied_discounts.length > 0;
    const resolvedDiscountAmount = hasResolvedStack
        ? Math.max(0, normalizeMoney(stackedDiscounts.discount_amount, 0))
        : null;
    const resolvedFinalTotal = hasResolvedStack
        ? Math.max(0, normalizeMoney(stackedDiscounts.final_total, subtotal))
        : null;
    const discountAmount = Math.max(0, normalizeMoney(source?.discount_amount ?? source?.discountAmount, 0));
    const finalTotal = Math.max(0, normalizeMoney(
        source?.final_total
        ?? source?.finalTotal
        ?? source?.paid_amount
        ?? (hasResolvedStack ? resolvedFinalTotal : (subtotal - discountAmount)),
        hasResolvedStack ? resolvedFinalTotal : (subtotal - discountAmount)
    ));
    const normalizedCode = normalizeText(source?.discount_code || source?.discountCode || '', 80).toUpperCase();
    const policy = hasResolvedStack
        ? stackedDiscounts.stacking_policy
        : buildDiscountStackingPolicy(source);
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

    if (hasResolvedStack) {
        stackedDiscounts.applied_discounts.forEach((discount, index) => {
            const discountCode = normalizeText(discount?.code, 80).toUpperCase();
            const rowAmount = Math.max(0, normalizeMoney(discount?.discount_amount, 0));
            if (!(rowAmount > 0)) {
                return;
            }

            const rowPolicy = discount?.is_exclusive !== false
                ? buildDiscountStackingPolicy(discount)
                : buildDiscountStackingPolicy(discount);
            rows.push({
                key: stackedDiscounts.applied_discounts.length === 1 ? 'discount' : `discount_${index + 1}`,
                label: discountCode ? `优惠券 ${discountCode}` : '优惠券抵扣',
                amount: rowAmount,
                display_amount: -rowAmount,
                detail: `${rowPolicy.apply_stage_label} · ${rowPolicy.exclusivity_label} · 优先级 ${rowPolicy.stack_priority}`,
                tone: 'discount'
            });
        });
    } else if (discountAmount > 0) {
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
        detail: hasResolvedStack
            ? `已包含 ${stackedDiscounts.applied_discounts.length} 张卡券抵扣`
            : (discountAmount > 0 ? '已包含优惠抵扣' : '未使用优惠'),
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
    normalizeMaxDiscountQuantity,
    resolveDiscountEligibleSubtotal,
    buildDiscountStackingPolicy,
    normalizeDiscountSelection,
    sortDiscountSelections,
    resolveDiscountStacking,
    buildPricingWaterfall
};
