const {
    normalizeSiteValue
} = require('../site');

function normalizeSite(site = 'cn') {
    return normalizeSiteValue(site);
}

function isMissingDeductWithBreakdownRpc(error) {
    const code = String(error?.code || '').trim().toUpperCase();
    const message = [
        error?.message,
        error?.details,
        error?.hint
    ].filter(Boolean).join(' ').toLowerCase();

    return code === '42883'
        || code === 'PGRST202'
        || message.includes('fn_deduct_points_admin_site_with_breakdown')
        || message.includes('schema cache')
        || message.includes('could not find the function')
        || message.includes('invalid input syntax for type integer');
}

async function getUserBalance({
    supabase,
    userId,
    site = 'cn'
}) {
    return supabase
        .rpc('fn_get_user_balance', {
            p_user_id: userId,
            p_site: normalizeSite(site)
        })
        .single();
}

async function deductPointsForService({
    supabase,
    userId,
    amount,
    reason,
    referenceId,
    site = 'cn'
}) {
    const adminSiteRpcParams = {
        p_target_user_id: userId,
        p_amount: amount,
        p_reason: reason,
        p_reference_id: referenceId,
        p_site: normalizeSite(site)
    };

    let { data, error } = await supabase.rpc('fn_deduct_points_admin_site_with_breakdown', adminSiteRpcParams);

    if (error && isMissingDeductWithBreakdownRpc(error)) {
        ({ data, error } = await supabase.rpc('fn_deduct_points_admin_site', adminSiteRpcParams));
    }

    if (error && isMissingDeductWithBreakdownRpc(error)) {
        ({ data, error } = await supabase.rpc('fn_deduct_points', {
            p_target_user_id: userId,
            p_amount: amount,
            p_reason: reason,
            p_reference_id: referenceId
        }));
    }

    return { data, error };
}

async function deductPointsForRefundReclaim({
    supabase,
    userId,
    amount,
    reason,
    referenceId,
    site = 'cn'
}) {
    return supabase.rpc('fn_deduct_points_admin_site_with_breakdown', {
        p_target_user_id: userId,
        p_amount: amount,
        p_reason: reason,
        p_reference_id: referenceId,
        p_site: normalizeSite(site)
    });
}

async function rechargePointsForPayment({
    supabase,
    userId,
    paidPoints = 0,
    bonusPoints = 0,
    reason,
    referenceId,
    site = ''
}) {
    const rpcParams = {
        target_user_id: userId,
        p_paid: paidPoints,
        p_bonus: bonusPoints,
        p_reason: reason,
        p_reference_id: referenceId
    };

    const normalizedSite = String(site || '').trim();
    if (normalizedSite) {
        rpcParams.p_site = normalizeSite(normalizedSite);
    }

    return supabase.rpc('fn_recharge_points', rpcParams);
}

async function applyPaymentOrderReview({
    supabase,
    paymentOrderId,
    action,
    note = null,
    actorId = null
}) {
    return supabase.rpc('fn_apply_payment_order_review', {
        p_payment_order_id: paymentOrderId,
        p_action: action,
        p_note: note,
        p_actor_id: actorId
    });
}

module.exports = {
    applyPaymentOrderReview,
    deductPointsForRefundReclaim,
    deductPointsForService,
    getUserBalance,
    isMissingDeductWithBreakdownRpc,
    rechargePointsForPayment
};
