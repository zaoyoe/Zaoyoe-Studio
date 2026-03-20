const {
    parseJsonBody,
    requireAuthenticatedUser,
    sendJson
} = require('../../_lib/admin');
const {
    getPaymentProviderAdapter
} = require('../../_lib/payments/provider-adapters');

const mockProvider = getPaymentProviderAdapter('mock');

function sanitizeSite(value) {
    const site = String(value || '').trim().toLowerCase();
    return site || 'cn';
}

function normalizePointValue(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed * 10) / 10 : fallback;
}

function normalizeCurrency(value, fallback = null) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.round(parsed * 100) / 100;
}

function buildMockOrderNo(explicitOrderNo = '') {
    return mockProvider.buildOrderNo({ explicitOrderNo });
}

module.exports = async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        const { supabase, user } = await requireAuthenticatedUser(req);
        const body = await parseJsonBody(req);
        const site = sanitizeSite(body.site);
        const packageId = body.package_id ? String(body.package_id).trim() : '';
        const orderNo = buildMockOrderNo(body.order_no);
        const isCustomRecharge = !packageId;

        let packageName = '自定义充值';
        let paidPoints = normalizePointValue(body.points_amount, 0);
        let bonusPoints = 0;
        let paidAmount = normalizeCurrency(body.paid_amount, null);

        if (packageId) {
            const { data: pkg, error: packageError } = await supabase
                .from('points_packages')
                .select('id, name, points_amount, bonus_points, price_cny, is_active')
                .eq('id', packageId)
                .eq('is_active', true)
                .maybeSingle();

            if (packageError) {
                throw new Error(packageError.message || 'Failed to load package');
            }

            if (!pkg) {
                throw new Error('套餐不存在或已下架');
            }

            packageName = String(pkg.name || '模拟充值套餐');
            paidPoints = normalizePointValue(pkg.points_amount, 0);
            bonusPoints = normalizePointValue(pkg.bonus_points, 0);
            paidAmount = normalizeCurrency(pkg.price_cny, paidAmount);
        }

        if (!Number.isFinite(paidPoints) || paidPoints <= 0) {
            throw new Error('充值积分必须大于 0');
        }

        const grantedPoints = normalizePointValue(paidPoints + bonusPoints, 0);
        const reason = isCustomRecharge ? 'custom_recharge' : `模拟充值: ${packageName}`;
        const referenceId = `mock_${orderNo}`;
        const eventKey = mockProvider.buildEventKey({ orderNo, stage: 'completed' });
        const nowIso = new Date().toISOString();
        const providerMetadata = mockProvider.buildProviderMetadata({
            site,
            isCustomRecharge,
            packageName,
            paidPoints,
            bonusPoints,
            grantedPoints,
            paidAmount
        });

        const { data: existingOrder, error: existingOrderError } = await supabase
            .from('payment_orders')
            .select('id, user_id, status, provider_order_no, points_amount, paid_amount')
            .eq('provider', 'mock')
            .eq('provider_order_no', orderNo)
            .maybeSingle();

        if (existingOrderError) {
            throw new Error(existingOrderError.message || 'Failed to inspect mock payment order');
        }

        if (existingOrder?.user_id && existingOrder.user_id !== user.id) {
            const forbiddenError = new Error('该模拟订单已归属于其他账号');
            forbiddenError.statusCode = 403;
            throw forbiddenError;
        }

        if (existingOrder && ['paid', 'redeemed'].includes(String(existingOrder.status || '').trim())) {
            return sendJson(res, 200, {
                success: true,
                order_no: orderNo,
                provider: 'mock',
                status: existingOrder.status,
                points_amount: normalizePointValue(existingOrder.points_amount, grantedPoints),
                paid_amount: normalizeCurrency(existingOrder.paid_amount, paidAmount)
            });
        }

        const baseOrderPayload = {
            provider: 'mock',
            provider_order_no: orderNo,
            provider_user_id: user.id,
            user_id: user.id,
            site,
            package_id: packageId || null,
            package_name: packageName,
            expected_amount: paidAmount,
            paid_amount: paidAmount,
            points_amount: grantedPoints,
            status: 'pending',
            sign_verified: true,
            amount_verified: true,
            raw_payload: {
                source: 'mock_payment_api',
                request: {
                    package_id: packageId || null,
                    points_amount: paidPoints,
                    bonus_points: bonusPoints,
                    site
                }
            },
            provider_metadata: providerMetadata,
            claimed_at: nowIso
        };

        const { data: pendingOrder, error: pendingOrderError } = await supabase
            .from('payment_orders')
            .upsert(baseOrderPayload, { onConflict: 'provider,provider_order_no' })
            .select('id, provider_order_no')
            .single();

        if (pendingOrderError) {
            throw new Error(pendingOrderError.message || 'Failed to create mock payment order');
        }

        try {
            const { error: rechargeError } = await supabase.rpc('fn_recharge_points', {
                target_user_id: user.id,
                p_paid: paidPoints,
                p_bonus: bonusPoints,
                p_reason: reason,
                p_reference_id: referenceId,
                p_site: site
            });

            if (rechargeError) {
                throw new Error(rechargeError.message || 'Failed to credit mock payment points');
            }

            const { error: orderUpdateError } = await supabase
                .from('payment_orders')
                .update({
                    status: 'redeemed',
                    paid_at: nowIso,
                    verified_at: nowIso,
                    claimed_at: nowIso,
                    last_error: null,
                    provider_metadata: {
                        ...providerMetadata,
                        completed_at: nowIso
                    }
                })
                .eq('id', pendingOrder.id);

            if (orderUpdateError) {
                throw new Error(orderUpdateError.message || 'Failed to finalize mock payment order');
            }

            const { error: eventError } = await supabase
                .from('payment_events')
                .upsert({
                    payment_order_id: pendingOrder.id,
                    provider: 'mock',
                    provider_order_no: orderNo,
                    event_key: eventKey,
                    event_type: 'mock_payment',
                    signature_valid: true,
                    amount_valid: true,
                    processing_result: 'processed_paid',
                    payload: {
                        mode: 'mock',
                        order_no: orderNo,
                        user_id: user.id,
                        site,
                        points_amount: grantedPoints,
                        paid_amount: paidAmount
                    },
                    error_message: null,
                    processed_at: nowIso
                }, { onConflict: 'event_key' });

            if (eventError) {
                throw new Error(eventError.message || 'Failed to record mock payment event');
            }
        } catch (runtimeError) {
            await supabase
                .from('payment_orders')
                .update({
                    status: 'rejected',
                    last_error: runtimeError.message || 'mock payment failed',
                    verified_at: nowIso,
                    provider_metadata: {
                        ...providerMetadata,
                        failed_at: nowIso
                    }
                })
                .eq('id', pendingOrder.id);

            await supabase
                .from('payment_events')
                .upsert({
                    payment_order_id: pendingOrder.id,
                    provider: 'mock',
                    provider_order_no: orderNo,
                    event_key,
                    event_type: 'mock_payment',
                    signature_valid: true,
                    amount_valid: false,
                    processing_result: 'mock_failed',
                    payload: {
                        mode: 'mock',
                        order_no: orderNo,
                        user_id: user.id,
                        site,
                        points_amount: grantedPoints,
                        paid_amount: paidAmount
                    },
                    error_message: runtimeError.message || 'mock payment failed',
                    processed_at: nowIso
                }, { onConflict: 'event_key' });

            throw runtimeError;
        }

        return sendJson(res, 200, {
            success: true,
            order_no: orderNo,
            provider: 'mock',
            status: 'redeemed',
            points_amount: grantedPoints,
            paid_amount: paidAmount
        });
    } catch (error) {
        return sendJson(res, error?.statusCode || 500, {
            success: false,
            message: error.message || 'Failed to complete mock payment'
        });
    }
};
