const {
    normalizeSiteValue
} = require('../site');

function normalizeSite(site = 'cn') {
    return normalizeSiteValue(site);
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

    let { data, error } = await supabase.rpc('fn_deduct_points_admin_site', adminSiteRpcParams);

    if (error) {
        ({ data, error } = await supabase.rpc('fn_deduct_points', {
            p_target_user_id: userId,
            p_amount: amount,
            p_reason: reason,
            p_reference_id: referenceId
        }));
    }

    return { data, error };
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

async function processAfdianPayment({
    supabase,
    orderNo,
    afdianUserId = '',
    planId = null,
    paidAmount,
    expectedAmount,
    points,
    packageId = null,
    packageName = null,
    site = 'cn',
    signatureValid = false,
    amountValid = false,
    payload = {},
    processError = '',
    paymentOrderId = null
}) {
    return supabase.rpc('fn_process_afdian_payment', {
        p_order_no: orderNo,
        p_afdian_user_id: String(afdianUserId || ''),
        p_plan_id: planId || null,
        p_paid_amount: paidAmount,
        p_expected_amount: expectedAmount,
        p_points: points,
        p_package_id: packageId || null,
        p_package_name: packageName || null,
        p_site: normalizeSite(site),
        p_signature_valid: signatureValid,
        p_amount_valid: amountValid,
        p_payload: payload,
        p_error: processError,
        p_payment_order_id: paymentOrderId || null
    });
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

async function finalizeAfdianCustomPayment({
    supabase,
    orderNo,
    userId,
    site = 'cn',
    points,
    expectedAmount,
    quoteId,
    packageName = '自定义充值'
}) {
    return supabase.rpc('fn_finalize_afdian_custom_payment', {
        p_order_no: orderNo,
        p_user_id: userId,
        p_site: normalizeSite(site),
        p_points: points,
        p_expected_amount: expectedAmount,
        p_quote_id: quoteId,
        p_package_name: packageName
    });
}

module.exports = {
    applyPaymentOrderReview,
    deductPointsForService,
    finalizeAfdianCustomPayment,
    getUserBalance,
    processAfdianPayment,
    rechargePointsForPayment
};
