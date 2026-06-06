function normalizeText(value, maxLength = 200) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function roundNumber(value, decimals = 2) {
    const numeric = normalizeNumber(value, 0);
    const factor = 10 ** Math.max(0, Number(decimals) || 0);
    return Math.round((numeric + Number.EPSILON) * factor) / factor;
}

function isMissingPointLotSchemaError(error = {}) {
    const text = [
        error?.message,
        error?.details,
        error?.hint,
        error?.code
    ].filter(Boolean).join(' ').toLowerCase();

    return text.includes('wallet_point_lot')
        && (
            text.includes('does not exist')
            || text.includes('undefined table')
            || text.includes('could not find')
            || text.includes('schema cache')
            || text.includes('42p01')
            || text.includes('pgrst205')
        );
}

function getPointSourceCashTreatment(sourceType = '', cashValueCny = null) {
    const normalized = normalizeText(sourceType, 40).toLowerCase();
    if (normalized === 'recharge' || normalized === 'redemption_code') return 'cash_backed';
    if (normalized === 'refund_return') {
        return normalizeNumber(cashValueCny, 0) > 0 ? 'cash_backed' : 'non_cash';
    }
    if (normalized === 'migration') {
        return normalizeNumber(cashValueCny, 0) > 0 ? 'cash_backed' : 'non_cash';
    }
    if ([
        'checkin',
        'activity_bonus',
        'admin_grant',
        'affiliate_commission'
    ].includes(normalized)) {
        return 'non_cash';
    }
    return 'unknown';
}

function normalizePointLotConsumptionRow(row = {}) {
    const pointsAmount = roundNumber(row.points_amount, 2);
    const cashValueCny = roundNumber(row.cash_value_cny, 4);
    const sourceType = normalizeText(row.source_type, 40).toLowerCase() || 'unknown';
    const cashTreatment = getPointSourceCashTreatment(sourceType, cashValueCny);

    return {
        id: normalizeText(row.id, 160) || null,
        point_lot_id: normalizeText(row.point_lot_id, 160) || null,
        order_id: normalizeText(row.order_id, 160) || null,
        order_item_id: normalizeText(row.order_item_id, 160) || null,
        ledger_id: normalizeText(row.ledger_id, 160) || null,
        source_type: sourceType,
        source_label: normalizeText(row.source_label, 160) || null,
        points_amount: pointsAmount,
        cash_value_cny: cashValueCny,
        cash_treatment: cashTreatment,
        consumed_at: row.consumed_at || null,
        metadata: row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
            ? row.metadata
            : {}
    };
}

function summarizePointLotConsumptions(rows = [], expectedPoints = 0) {
    const items = (Array.isArray(rows) ? rows : [])
        .filter(Boolean)
        .map(normalizePointLotConsumptionRow);
    const totalPoints = roundNumber(items.reduce((sum, item) => sum + item.points_amount, 0), 2);
    const cashBackedPoints = roundNumber(items
        .filter((item) => item.cash_treatment === 'cash_backed')
        .reduce((sum, item) => sum + item.points_amount, 0), 2);
    const nonCashPoints = roundNumber(items
        .filter((item) => item.cash_treatment === 'non_cash')
        .reduce((sum, item) => sum + item.points_amount, 0), 2);
    const unknownPoints = roundNumber(items
        .filter((item) => item.cash_treatment === 'unknown')
        .reduce((sum, item) => sum + item.points_amount, 0), 2);
    const cashValueCny = roundNumber(items
        .filter((item) => item.cash_treatment === 'cash_backed')
        .reduce((sum, item) => sum + item.cash_value_cny, 0), 4);
    const expected = roundNumber(Math.max(0, normalizeNumber(expectedPoints, 0)), 2);
    const untrackedPoints = roundNumber(Math.max(0, expected - totalPoints), 2);
    const sourceTypes = [...new Set(items.map((item) => item.source_type).filter(Boolean))];

    return {
        status: items.length
            ? (untrackedPoints > 0.01 ? 'partial' : 'exact')
            : 'empty',
        basis: 'wallet_point_lot_consumptions',
        item_count: items.length,
        total_points: totalPoints,
        cash_backed_points: cashBackedPoints,
        non_cash_points: nonCashPoints,
        unknown_points: unknownPoints,
        untracked_points: untrackedPoints,
        cash_value_cny: cashValueCny,
        source_types: sourceTypes,
        items
    };
}

async function loadPointLotConsumptionsByOrderIds(supabase, orderIds = []) {
    const ids = [...new Set(
        (Array.isArray(orderIds) ? orderIds : [])
            .map((value) => normalizeText(value, 160))
            .filter(Boolean)
    )];
    const empty = new Map(ids.map((id) => [id, []]));

    if (!supabase?.from || !ids.length) {
        return empty;
    }

    try {
        const { data, error } = await supabase
            .from('wallet_point_lot_consumptions')
            .select('id, point_lot_id, user_id, site, order_id, order_item_id, ledger_id, consumption_reference_id, points_amount, cash_value_cny, source_type, source_label, consumed_at, metadata')
            .in('order_id', ids)
            .order('consumed_at', { ascending: true });

        if (error) {
            if (isMissingPointLotSchemaError(error)) {
                return empty;
            }
            throw error;
        }

        const grouped = new Map(empty);
        (Array.isArray(data) ? data : []).forEach((row) => {
            const orderId = normalizeText(row?.order_id, 160);
            if (!orderId) return;
            if (!grouped.has(orderId)) {
                grouped.set(orderId, []);
            }
            grouped.get(orderId).push(row);
        });

        return grouped;
    } catch (error) {
        if (isMissingPointLotSchemaError(error)) {
            return empty;
        }
        throw error;
    }
}

module.exports = {
    getPointSourceCashTreatment,
    isMissingPointLotSchemaError,
    loadPointLotConsumptionsByOrderIds,
    normalizePointLotConsumptionRow,
    summarizePointLotConsumptions
};
