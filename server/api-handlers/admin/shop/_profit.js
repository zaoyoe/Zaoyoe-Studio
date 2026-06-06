function normalizeText(value, maxLength = 200) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeNullableNumber(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function roundNumber(value, decimals = 2) {
    const numeric = normalizeNumber(value, 0);
    const factor = 10 ** Math.max(0, Number(decimals) || 0);
    return Math.round((numeric + Number.EPSILON) * factor) / factor;
}

function isRefundedOrder(order = {}) {
    const status = normalizeText(order?.refund_status, 40).toLowerCase();
    return status === 'refunded' || status === 'full_refund';
}

function resolveDiscountPoints(order = {}, paidPoints = 0, grossPoints = 0) {
    const explicitDiscount = normalizeNullableNumber(order?.discount_amount);
    if (explicitDiscount !== null) {
        return roundNumber(Math.max(0, explicitDiscount), 2);
    }

    if (grossPoints > paidPoints) {
        return roundNumber(grossPoints - paidPoints, 2);
    }

    return 0;
}

function normalizeJsonObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizePointLotSummary(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function buildPointSourceTraceability(spendBreakdown = {}, expectedPoints = 0) {
    const expected = roundNumber(Math.max(0, normalizeNumber(expectedPoints, 0)), 2);
    const basis = normalizeText(spendBreakdown?.basis, 80) || 'unknown';
    const confidence = normalizeText(spendBreakdown?.confidence, 40) || 'estimated';
    const pointLotSummary = normalizePointLotSummary(spendBreakdown?.point_lot_consumption_summary);
    const paidPoints = roundNumber(Math.max(0, normalizeNumber(spendBreakdown?.paid_points_spent, 0)), 2);
    const bonusPoints = roundNumber(Math.max(0, normalizeNumber(spendBreakdown?.bonus_points_spent, 0)), 2);
    const untrackedPoints = roundNumber(Math.max(0, normalizeNumber(spendBreakdown?.untracked_points, 0)), 2);

    if (expected <= 0) {
        return {
            status: 'empty',
            tone: 'neutral',
            label: '无需追踪',
            description: '本单没有实际消耗积分。',
            action_required: false,
            basis,
            confidence,
            expected_points: 0,
            source_lot_points: 0,
            balance_split_points: 0,
            cash_backed_points: 0,
            non_cash_points: 0,
            unknown_points: 0,
            untracked_points: 0,
            source_types: [],
            item_count: 0
        };
    }

    if (pointLotSummary?.item_count > 0) {
        const sourceLotPoints = roundNumber(Math.max(0, normalizeNumber(pointLotSummary.total_points, 0)), 2);
        const cashBackedPoints = roundNumber(Math.max(0, normalizeNumber(pointLotSummary.cash_backed_points, 0)), 2);
        const nonCashPoints = roundNumber(Math.max(0, normalizeNumber(pointLotSummary.non_cash_points, 0)), 2);
        const unknownPoints = roundNumber(Math.max(0, normalizeNumber(pointLotSummary.unknown_points, 0)), 2);
        const lotUntrackedPoints = roundNumber(Math.max(0, normalizeNumber(pointLotSummary.untracked_points, 0)), 2);
        const hasGap = lotUntrackedPoints > 0.01 || unknownPoints > 0.01;
        const status = hasGap ? 'partial_lot_gap' : 'source_lot_exact';

        return {
            status,
            tone: hasGap ? 'warning' : 'ready',
            label: hasGap ? '部分缺来源批次' : '来源批次完整',
            description: hasGap
                ? '订单已写入部分积分批次消耗，但仍有积分未匹配到明确来源或来源类型未知。'
                : '订单已按积分批次完整追踪，可直接用于现金/非现金收入归因。',
            action_required: hasGap,
            action_label: hasGap ? '复核旧余额或补齐批次回填' : null,
            basis,
            confidence: hasGap ? 'partial' : 'exact',
            expected_points: expected,
            source_lot_points: sourceLotPoints,
            balance_split_points: roundNumber(paidPoints + bonusPoints, 2),
            cash_backed_points: cashBackedPoints,
            non_cash_points: nonCashPoints,
            unknown_points: unknownPoints,
            untracked_points: lotUntrackedPoints,
            source_types: Array.isArray(pointLotSummary.source_types) ? pointLotSummary.source_types.filter(Boolean) : [],
            item_count: Math.max(0, normalizeNumber(pointLotSummary.item_count, 0))
        };
    }

    if (basis === 'paid_balance_cash_revenue') {
        return {
            status: untrackedPoints > 0.01 ? 'balance_split_gap' : 'balance_split_only',
            tone: untrackedPoints > 0.01 ? 'warning' : 'info',
            label: untrackedPoints > 0.01 ? '余额拆分不完整' : '仅余额拆分',
            description: untrackedPoints > 0.01
                ? '订单只记录了部分付费/奖励余额拆分，还没有具体积分批次消耗明细。'
                : '订单已记录付费/奖励余额拆分，但尚未追踪到具体积分来源批次。',
            action_required: untrackedPoints > 0.01,
            action_label: untrackedPoints > 0.01 ? '补齐缺口后再确认收入' : '可在历史回填时补齐批次',
            basis,
            confidence,
            expected_points: expected,
            source_lot_points: 0,
            balance_split_points: roundNumber(paidPoints + bonusPoints, 2),
            cash_backed_points: paidPoints,
            non_cash_points: bonusPoints,
            unknown_points: 0,
            untracked_points: untrackedPoints,
            source_types: [],
            item_count: 0
        };
    }

    return {
        status: 'legacy_untracked',
        tone: 'warning',
        label: '历史未拆分',
        description: '订单创建时尚未记录付费/奖励积分拆分，也没有积分批次消耗明细。',
        action_required: true,
        action_label: '需要历史回填或保留旧口径估算标记',
        basis,
        confidence,
        expected_points: expected,
        source_lot_points: 0,
        balance_split_points: 0,
        cash_backed_points: 0,
        non_cash_points: 0,
        unknown_points: 0,
        untracked_points: expected,
        source_types: [],
        item_count: 0
    };
}

function resolveSpendBreakdown(order = {}, revenuePoints = 0, options = {}) {
    const expectedPoints = roundNumber(Math.max(0, normalizeNumber(revenuePoints, 0)), 2);
    const pointLotSummary = normalizePointLotSummary(options.pointLotSummary || order?.point_lot_consumption_summary);
    if (pointLotSummary?.item_count > 0) {
        const cashBackedPoints = roundNumber(Math.max(0, normalizeNumber(pointLotSummary.cash_backed_points, 0)), 2);
        const nonCashPoints = roundNumber(Math.max(0, normalizeNumber(pointLotSummary.non_cash_points, 0)), 2);
        const untrackedPoints = roundNumber(Math.max(0, normalizeNumber(pointLotSummary.untracked_points, 0)), 2);
        const unknownPoints = roundNumber(Math.max(0, normalizeNumber(pointLotSummary.unknown_points, 0)), 2);
        const cashValueCny = roundNumber(Math.max(0, normalizeNumber(pointLotSummary.cash_value_cny, cashBackedPoints + unknownPoints)), 4);
        const confidence = untrackedPoints > 0.01 || unknownPoints > 0.01 ? 'partial' : 'exact';

        return {
            status: confidence === 'exact' ? 'exact' : 'partial',
            basis: 'wallet_point_lot_consumptions',
            confidence,
            paid_points_spent: cashBackedPoints,
            bonus_points_spent: nonCashPoints,
            untracked_points: roundNumber(untrackedPoints + unknownPoints, 2),
            non_cash_points: roundNumber(nonCashPoints + untrackedPoints + unknownPoints, 2),
            recognized_cash_revenue_cny: cashValueCny,
            point_lot_consumption_summary: pointLotSummary,
            notes: [
                '确认收入按积分来源批次的现金价值确认；充值/兑换码积分计入现金收入，活动/赠送/返佣等非现金积分不直接确认为收入。',
                ...(nonCashPoints > 0 ? [`本单使用 ${nonCashPoints.toLocaleString('zh-CN')} 非现金来源积分，已从现金收入中剔除。`] : []),
                ...(unknownPoints > 0 ? [`有 ${unknownPoints.toLocaleString('zh-CN')} 积分来源类型未知，暂列为待追踪。`] : []),
                ...(untrackedPoints > 0 ? [`有 ${untrackedPoints.toLocaleString('zh-CN')} 积分未匹配到来源批次，需要补齐消耗明细。`] : [])
            ]
        };
    }

    const metadata = normalizeJsonObject(order?.points_spend_breakdown);
    const metadataPaidPoints = normalizeNullableNumber(metadata.paid_points);
    const metadataBonusPoints = normalizeNullableNumber(metadata.bonus_points);
    const explicitPaidPoints = normalizeNullableNumber(order?.paid_points_spent);
    const explicitBonusPoints = normalizeNullableNumber(order?.bonus_points_spent);
    const hasExplicitBreakdown = explicitPaidPoints !== null || explicitBonusPoints !== null
        || metadataPaidPoints !== null || metadataBonusPoints !== null;

    if (!hasExplicitBreakdown) {
        return {
            status: 'estimated_legacy',
            basis: 'points_to_cny_parity',
            confidence: 'estimated',
            paid_points_spent: null,
            bonus_points_spent: null,
            untracked_points: expectedPoints,
            non_cash_points: 0,
            recognized_cash_revenue_cny: expectedPoints,
            notes: [
                '历史订单未记录付费/奖励积分扣款拆分，确认收入沿用 1 积分≈1 元估算。'
            ]
        };
    }

    let paidPoints = roundNumber(Math.max(0, explicitPaidPoints ?? metadataPaidPoints ?? 0), 2);
    let bonusPoints = roundNumber(Math.max(0, explicitBonusPoints ?? metadataBonusPoints ?? 0), 2);
    let untrackedPoints = 0;
    let confidence = 'exact';
    const spentTotal = roundNumber(paidPoints + bonusPoints, 2);
    const delta = roundNumber(expectedPoints - spentTotal, 2);

    if (Math.abs(delta) > 0.01) {
        confidence = 'partial';
        if (delta > 0) {
            untrackedPoints = delta;
        } else if (spentTotal > 0) {
            paidPoints = roundNumber(expectedPoints * (paidPoints / spentTotal), 2);
            bonusPoints = roundNumber(Math.max(0, expectedPoints - paidPoints), 2);
        }
    }

    return {
        status: confidence === 'exact' ? 'exact' : 'partial',
        basis: 'paid_balance_cash_revenue',
        confidence,
        paid_points_spent: paidPoints,
        bonus_points_spent: bonusPoints,
        untracked_points: untrackedPoints,
        non_cash_points: roundNumber(bonusPoints + untrackedPoints, 2),
        recognized_cash_revenue_cny: roundNumber(paidPoints + untrackedPoints, 4),
        notes: [
            '确认收入按订单实际消耗的付费积分确认；奖励/赠送积分不直接确认为现金收入。',
            ...(bonusPoints > 0 ? [`本单使用 ${bonusPoints.toLocaleString('zh-CN')} 奖励/赠送积分，已从现金收入中剔除。`] : []),
            ...(untrackedPoints > 0 ? [`有 ${untrackedPoints.toLocaleString('zh-CN')} 积分缺少来源拆分，暂按旧口径估算现金收入。`] : [])
        ]
    };
}

function getInventoryCostCny(item = {}) {
    const directCost = normalizeNullableNumber(item?.purchase_unit_cost_cny);
    if (directCost !== null) {
        return Math.max(0, directCost);
    }

    const procurementCost = normalizeNullableNumber(item?.procurement_unit_cost_cny);
    if (procurementCost !== null) {
        return Math.max(0, procurementCost);
    }

    return null;
}

function getProfitTone(netProfitCny, refunded) {
    if (refunded) {
        return 'refunded';
    }
    if (netProfitCny > 0) {
        return 'profit';
    }
    if (netProfitCny < 0) {
        return 'loss';
    }
    return 'break_even';
}

function getCostCoverage({ inventoryItemCount, costedItemCount }) {
    if (inventoryItemCount <= 0) {
        return 'no_inventory';
    }
    if (costedItemCount <= 0) {
        return 'no_cost';
    }
    if (costedItemCount < inventoryItemCount) {
        return 'partial';
    }
    return 'complete';
}

function buildCostItems(linkedInventoryItems = []) {
    return (Array.isArray(linkedInventoryItems) ? linkedInventoryItems : [])
        .filter(Boolean)
        .map((item) => {
            const inventoryId = normalizeText(item?.id || item?.inventory_id, 160) || null;
            const costCny = getInventoryCostCny(item);
            return {
                inventory_id: inventoryId,
                product_name: normalizeText(item?.product_name || item?.snapshot_product_name, 200) || null,
                order_item_id: normalizeText(item?.order_item_id, 160) || null,
                sku_id: normalizeText(item?.sku_id, 160) || null,
                sku_name: normalizeText(item?.sku_name, 160) || null,
                sku_code: normalizeText(item?.sku_code, 80) || null,
                source_batch_id: normalizeText(item?.source_batch_id, 160) || null,
                item_revenue_points: normalizeNullableNumber(item?.price_paid),
                purchase_currency: normalizeText(item?.purchase_currency, 12).toUpperCase() || null,
                purchase_unit_cost: normalizeNullableNumber(item?.purchase_unit_cost),
                purchase_exchange_rate_to_cny: normalizeNullableNumber(item?.purchase_exchange_rate_to_cny),
                purchase_unit_cost_cny: costCny === null ? null : roundNumber(costCny, 4),
                cost_status: costCny === null ? 'missing' : 'costed'
            };
        });
}

function createProfitAdjustmentItem(type, title, amountCny, points, options = {}) {
    const normalizedAmount = roundNumber(Math.max(0, normalizeNumber(amountCny, 0)), 4);
    const normalizedPoints = roundNumber(Math.max(0, normalizeNumber(points, 0)), 2);
    if (normalizedAmount <= 0 && normalizedPoints <= 0) {
        return null;
    }

    return {
        type,
        title,
        amount_cny: normalizedAmount,
        points: normalizedPoints,
        status: normalizeText(options.status, 40) || 'tracked',
        tone: normalizeText(options.tone, 40) || 'info',
        treatment: normalizeText(options.treatment, 220) || null,
        description: normalizeText(options.description, 260) || null,
        affects_net_profit: Boolean(options.affects_net_profit)
    };
}

function buildProfitAdjustments({ discountPoints = 0, spendBreakdown = {}, refunded = false, refundedPoints = 0 } = {}) {
    const bonusPoints = normalizeNumber(spendBreakdown.bonus_points_spent, 0);
    const untrackedPoints = normalizeNumber(spendBreakdown.untracked_points, 0);
    const items = [
        createProfitAdjustmentItem('coupon_discount', '优惠/折扣承担', discountPoints, discountPoints, {
            status: 'tracked_income_deduction',
            tone: 'info',
            treatment: '已通过实付积分降低现金收入，不重复扣减。',
            description: '用于衡量优惠券、折扣活动对原价收入的让利影响。'
        }),
        createProfitAdjustmentItem('bonus_points_excluded', '赠送/活动积分剔除', bonusPoints, bonusPoints, {
            status: 'tracked_revenue_exclusion',
            tone: 'info',
            treatment: '不确认为现金收入，后续可接入营销成本分录。',
            description: '用户消耗的奖励、赠送或活动积分已从现金确认收入中剔除。'
        }),
        createProfitAdjustmentItem('untracked_points_estimated', '历史积分来源待拆分', untrackedPoints, untrackedPoints, {
            status: 'review_required',
            tone: 'warning',
            treatment: '暂按旧口径估算现金收入，需要后续用积分批次补齐。',
            description: '历史订单没有记录付费/赠送积分扣款结构，净利润仍存在口径风险。',
            affects_net_profit: true
        }),
        createProfitAdjustmentItem('refund_reversal', '退款冲销', refunded ? refundedPoints : 0, refunded ? refundedPoints : 0, {
            status: 'tracked_reversal',
            tone: 'info',
            treatment: '退款订单收入与成本归零，退款流水仍需闭环核对。',
            description: '用于标记本期已退款商城订单对收入确认的冲销影响。',
            affects_net_profit: true
        })
    ].filter(Boolean);

    return {
        status: items.some((item) => item.status === 'review_required') ? 'review' : (items.length ? 'tracked' : 'none'),
        discount_points: roundNumber(Math.max(0, normalizeNumber(discountPoints, 0)), 2),
        coupon_discount_cny: roundNumber(Math.max(0, normalizeNumber(discountPoints, 0)), 4),
        bonus_points_excluded_cny: roundNumber(Math.max(0, bonusPoints), 4),
        untracked_points_estimated_cny: roundNumber(Math.max(0, untrackedPoints), 4),
        refunded_revenue_reversal_cny: roundNumber(refunded ? Math.max(0, normalizeNumber(refundedPoints, 0)) : 0, 4),
        point_lot_consumption_summary: spendBreakdown.point_lot_consumption_summary || null,
        items
    };
}

function createProfitLedgerEntry(type, title, amountCny, options = {}) {
    const pointsAmount = normalizeNullableNumber(options.points_amount);
    const normalizedAmount = roundNumber(normalizeNumber(amountCny, 0), 4);
    const normalizedPoints = pointsAmount === null ? null : roundNumber(pointsAmount, 2);
    const inventoryId = normalizeText(options.inventory_id, 160) || null;
    const sourceBatchId = normalizeText(options.source_batch_id, 160) || null;
    const entryIdParts = [
        normalizeText(options.order_id, 160),
        normalizeText(options.order_item_id, 160),
        inventoryId,
        type,
        normalizeText(options.index, 40)
    ].filter(Boolean);

    if (normalizedAmount === 0 && (normalizedPoints === null || normalizedPoints === 0) && !inventoryId) {
        return null;
    }

    return {
        entry_id: entryIdParts.join(':') || null,
        entry_type: type,
        title,
        amount_cny: normalizedAmount,
        currency: 'CNY',
        points_amount: normalizedPoints,
        status: normalizeText(options.status, 40) || 'settled',
        confidence: normalizeText(options.confidence, 40) || 'exact',
        group: normalizeText(options.group, 40) || 'adjustment',
        tone: normalizeText(options.tone, 40) || 'info',
        treatment: normalizeText(options.treatment, 220) || null,
        order_id: normalizeText(options.order_id, 160) || null,
        order_item_id: normalizeText(options.order_item_id, 160) || null,
        inventory_id: inventoryId,
        source_batch_id: sourceBatchId,
        occurred_at: options.occurred_at || null,
        snapshot: normalizeJsonObject(options.snapshot)
    };
}

function buildProfitLedgerEntries({
    order = {},
    spendBreakdown = {},
    costItems = [],
    discountPoints = 0,
    refunded = false,
    refundedPoints = 0,
    purchaseCostCny = 0
} = {}) {
    const orderId = normalizeText(order?.id, 160) || null;
    const occurredAt = order?.created_at || null;
    const paidPoints = normalizeNumber(spendBreakdown.paid_points_spent, 0);
    const bonusPoints = normalizeNumber(spendBreakdown.bonus_points_spent, 0);
    const untrackedPoints = normalizeNumber(spendBreakdown.untracked_points, 0);
    const cashRevenueCny = roundNumber(Math.max(0, normalizeNumber(spendBreakdown.recognized_cash_revenue_cny, paidPoints + untrackedPoints)), 4);
    const entries = [
        createProfitLedgerEntry('revenue_points_paid', '付费积分收入', paidPoints, {
            order_id: orderId,
            occurred_at: occurredAt,
            points_amount: paidPoints,
            group: 'revenue',
            status: refunded ? 'reversed' : 'settled',
            confidence: paidPoints > 0 ? spendBreakdown.confidence : 'none',
            tone: 'ready',
            treatment: refunded ? '本单已退款，收入随后由退款分录冲销。' : '按实际消耗的付费积分确认为现金收入。'
        }),
        createProfitLedgerEntry('revenue_points_untracked', '历史未拆分积分收入', untrackedPoints, {
            order_id: orderId,
            occurred_at: occurredAt,
            points_amount: untrackedPoints,
            group: 'revenue',
            status: refunded ? 'reversed_estimated' : 'estimated',
            confidence: 'estimated',
            tone: 'warning',
            treatment: refunded ? '本单已退款，历史估算收入随后冲销。' : '历史订单暂按旧口径估算现金收入，待积分批次补齐。'
        }),
        createProfitLedgerEntry('revenue_points_bonus', '赠送积分收入剔除', 0, {
            order_id: orderId,
            occurred_at: occurredAt,
            points_amount: bonusPoints,
            group: 'adjustment',
            status: 'excluded',
            confidence: spendBreakdown.confidence,
            tone: 'info',
            treatment: '奖励/赠送积分不确认为现金收入。'
        }),
        createProfitLedgerEntry('coupon_cost', '优惠/折扣影响', 0, {
            order_id: orderId,
            occurred_at: occurredAt,
            points_amount: discountPoints,
            group: 'adjustment',
            status: 'excluded',
            confidence: 'exact',
            tone: 'info',
            treatment: '优惠已体现在实付积分减少中，不在当前净利润中重复扣减。'
        })
    ].filter(Boolean);

    (Array.isArray(costItems) ? costItems : []).forEach((item, index) => {
        const costCny = item.cost_status === 'costed'
            ? normalizeNumber(item.purchase_unit_cost_cny, 0)
            : 0;
        entries.push(createProfitLedgerEntry(
            item.cost_status === 'costed' ? 'inventory_cost' : 'inventory_cost_missing',
            item.cost_status === 'costed' ? '采购成本' : '采购成本缺失',
            item.cost_status === 'costed' ? -costCny : 0,
            {
                order_id: orderId,
                order_item_id: item.order_item_id,
                inventory_id: item.inventory_id,
                source_batch_id: item.source_batch_id,
                occurred_at: occurredAt,
                index,
                group: 'cost',
                status: item.cost_status === 'costed'
                    ? (refunded ? 'reversed' : 'settled')
                    : 'incomplete',
                confidence: item.cost_status === 'costed' ? 'exact' : 'missing',
                tone: item.cost_status === 'costed' ? 'ready' : 'warning',
                treatment: item.cost_status === 'costed'
                    ? (refunded ? '本单已退款，成本随后由成本冲回分录抵消。' : '按库存导入时的采购成本快照确认。')
                    : '缺少采购成本，不能按 0 成本确认为利润。',
                snapshot: {
                    product_name: item.product_name,
                    sku_id: item.sku_id,
                    sku_name: item.sku_name,
                    sku_code: item.sku_code,
                    purchase_unit_cost_cny: item.purchase_unit_cost_cny
                }
            }
        ));
    });

    if (refunded) {
        entries.push(createProfitLedgerEntry('refund_reversal', '退款收入冲销', -cashRevenueCny, {
            order_id: orderId,
            occurred_at: occurredAt,
            points_amount: refundedPoints,
            group: 'reversal',
            status: 'settled',
            confidence: spendBreakdown.confidence,
            tone: 'info',
            treatment: '冲销本单已确认或估算的现金收入。'
        }));

        if (purchaseCostCny > 0) {
            entries.push(createProfitLedgerEntry('inventory_cost_reversal', '退款成本冲回', purchaseCostCny, {
                order_id: orderId,
                occurred_at: occurredAt,
                group: 'reversal',
                status: 'settled',
                confidence: 'exact',
                tone: 'info',
                treatment: '退款订单不在本单继续确认采购成本。'
            }));
        }
    }

    return entries.filter(Boolean).map((entry, index) => ({
        ...entry,
        entry_id: entry.entry_id || `${orderId || 'order'}:${entry.entry_type}:${index}`
    }));
}

function buildOrderProfitAttribution(order = {}, linkedInventoryItems = [], options = {}) {
    const paidPoints = roundNumber(Math.max(0, normalizeNumber(order?.price_paid, normalizeNumber(order?.total_price, 0))), 2);
    const grossPoints = roundNumber(Math.max(paidPoints, normalizeNumber(order?.total_price, paidPoints)), 2);
    const discountPoints = resolveDiscountPoints(order, paidPoints, grossPoints);
    const spendBreakdown = resolveSpendBreakdown(order, paidPoints, options);
    const refunded = isRefundedOrder(order);
    const refundedPoints = refunded ? paidPoints : 0;
    const costItems = buildCostItems(linkedInventoryItems);
    const inventoryItemCount = costItems.length;
    const costedItems = costItems.filter((item) => item.cost_status === 'costed');
    const costedItemCount = costedItems.length;
    const purchaseCostCny = roundNumber(
        costedItems.reduce((sum, item) => sum + normalizeNumber(item.purchase_unit_cost_cny, 0), 0),
        4
    );
    const recognizedRevenueCny = refunded ? 0 : spendBreakdown.recognized_cash_revenue_cny;
    const recognizedCostCny = refunded ? 0 : purchaseCostCny;
    const netProfitCny = roundNumber(recognizedRevenueCny - recognizedCostCny, 4);
    const marginRate = recognizedRevenueCny > 0
        ? roundNumber(netProfitCny / recognizedRevenueCny, 4)
        : null;
    const costCoverage = getCostCoverage({ inventoryItemCount, costedItemCount });
    const missingCostItemCount = Math.max(0, inventoryItemCount - costedItemCount);
    const pointSourceTraceability = buildPointSourceTraceability(spendBreakdown, paidPoints);
    const profitLedgerEntries = buildProfitLedgerEntries({
        order,
        spendBreakdown,
        costItems,
        discountPoints,
        refunded,
        refundedPoints,
        purchaseCostCny
    });
    const notes = [];

    spendBreakdown.notes.forEach((note) => notes.push(note));
    if (pointSourceTraceability.action_required && pointSourceTraceability.action_label) {
        notes.push(`积分来源追踪：${pointSourceTraceability.action_label}。`);
    }
    if (discountPoints > 0) {
        notes.push('优惠券已通过实际支付积分扣减收入，优惠影响单独展示。');
    }
    if (refunded) {
        notes.push('退款订单收入与成本暂不确认为本单净利润，库存后续状态需在库存详情核对。');
    }
    if (costCoverage === 'partial') {
        notes.push(`有 ${missingCostItemCount} 个关联库存缺少采购成本，净利润可能被高估。`);
    } else if (costCoverage === 'no_cost') {
        notes.push('关联库存尚未记录采购成本，当前净利润只反映收入侧。');
    } else if (costCoverage === 'no_inventory') {
        notes.push('订单没有精确关联库存，无法归因采购成本。');
    }

    return {
        basis: spendBreakdown.basis,
        points_to_cny_rate: 1,
        revenue_recognition_status: spendBreakdown.status,
        revenue_recognition_confidence: spendBreakdown.confidence,
        currency: 'CNY',
        gross_points: grossPoints,
        revenue_points: paidPoints,
        paid_points_spent: spendBreakdown.paid_points_spent,
        bonus_points_spent: spendBreakdown.bonus_points_spent,
        untracked_revenue_points: spendBreakdown.untracked_points,
        non_cash_points: spendBreakdown.non_cash_points,
        discount_points: discountPoints,
        refunded_points: refundedPoints,
        recognized_revenue_cny: roundNumber(recognizedRevenueCny, 4),
        purchase_cost_cny: purchaseCostCny,
        recognized_cost_cny: roundNumber(recognizedCostCny, 4),
        net_profit_cny: netProfitCny,
        margin_rate: marginRate,
        profit_adjustments: buildProfitAdjustments({
            discountPoints,
            spendBreakdown,
            refunded,
            refundedPoints
        }),
        point_lot_consumption_summary: spendBreakdown.point_lot_consumption_summary || null,
        point_source_traceability: pointSourceTraceability,
        profit_ledger_entries: profitLedgerEntries,
        profit_ledger_status: profitLedgerEntries.some((entry) => entry.status === 'incomplete')
            ? 'incomplete'
            : (profitLedgerEntries.some((entry) => entry.confidence === 'estimated') ? 'estimated' : 'settled'),
        inventory_item_count: inventoryItemCount,
        costed_item_count: costedItemCount,
        missing_cost_item_count: missingCostItemCount,
        cost_coverage: costCoverage,
        tone: getProfitTone(netProfitCny, refunded),
        refunded,
        item_costs: costItems,
        notes
    };
}

module.exports = {
    buildOrderProfitAttribution,
    buildPointSourceTraceability,
    resolveSpendBreakdown,
    isRefundedOrder
};
