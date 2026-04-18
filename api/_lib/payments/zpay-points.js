function normalizePointValue(value, fallback = 0) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return fallback;
    return Math.max(0, Math.round(numericValue * 100) / 100);
}

function normalizeJsonObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}

function deriveZpayPointBreakdown(paymentOrder = null, attachData = {}) {
    const requestPayload = paymentOrder?.raw_payload?.request && typeof paymentOrder.raw_payload.request === 'object'
        ? paymentOrder.raw_payload.request
        : {};
    const providerMetadata = normalizeJsonObject(paymentOrder?.provider_metadata);
    const normalizedAttachData = normalizeJsonObject(attachData);
    const storedGrantedPoints = normalizePointValue(
        paymentOrder?.points_amount
        ?? providerMetadata.credited_points
        ?? providerMetadata.granted_points
        ?? normalizedAttachData.granted_points
        ?? 0,
        0
    );

    let paidPoints = Number(
        requestPayload.points_amount
        ?? providerMetadata.paid_points
        ?? normalizedAttachData.paid_points
    );
    let bonusPoints = Number(
        requestPayload.bonus_points
        ?? providerMetadata.bonus_points
        ?? normalizedAttachData.bonus_points
    );

    if (!Number.isFinite(paidPoints) || paidPoints < 0) {
        paidPoints = storedGrantedPoints;
    } else {
        paidPoints = normalizePointValue(paidPoints, storedGrantedPoints);
    }

    if (!Number.isFinite(bonusPoints) || bonusPoints < 0) {
        bonusPoints = Math.max(0, storedGrantedPoints - paidPoints);
    } else {
        bonusPoints = normalizePointValue(bonusPoints, Math.max(0, storedGrantedPoints - paidPoints));
    }

    if (paidPoints + bonusPoints !== storedGrantedPoints && storedGrantedPoints > 0) {
        if (paidPoints > storedGrantedPoints) {
            paidPoints = storedGrantedPoints;
            bonusPoints = 0;
        } else {
            bonusPoints = Math.max(0, storedGrantedPoints - paidPoints);
        }
    }

    return {
        paidPoints,
        bonusPoints,
        grantedPoints: Math.max(storedGrantedPoints, paidPoints + bonusPoints)
    };
}

module.exports = {
    deriveZpayPointBreakdown
};
