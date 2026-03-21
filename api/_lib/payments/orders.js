const {
    getPaymentProviderAdapter,
    normalizePointValue,
    roundCurrencyAmount
} = require('./provider-adapters');
const {
    loadStoredPaymentConfigs
} = require('./providers');

const mockProvider = getPaymentProviderAdapter('mock');

function sanitizeSite(value) {
    const site = String(value || '').trim().toLowerCase();
    return site || 'cn';
}

function sanitizeText(value, fallback = '', maxLength = 240) {
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim();
    return normalized ? normalized.slice(0, maxLength) : fallback;
}

function normalizeCurrency(value, fallback = null) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.round(parsed * 100) / 100;
}

function buildMockOrderNo(explicitOrderNo = '') {
    return mockProvider.buildOrderNo({ explicitOrderNo });
}

async function loadPointsPackage(supabase, packageId) {
    const normalizedPackageId = String(packageId || '').trim();
    if (!normalizedPackageId) {
        return null;
    }

    const { data: pkg, error } = await supabase
        .from('points_packages')
        .select('id, name, points_amount, bonus_points, price_cny, is_active')
        .eq('id', normalizedPackageId)
        .eq('is_active', true)
        .maybeSingle();

    if (error) {
        throw new Error(error.message || 'Failed to load package');
    }

    if (!pkg) {
        throw new Error('套餐不存在或已下架');
    }

    return {
        id: pkg.id,
        name: sanitizeText(pkg.name, '充值套餐', 120),
        paidPoints: normalizePointValue(pkg.points_amount, 0),
        bonusPoints: normalizePointValue(pkg.bonus_points, 0),
        grantedPoints: normalizePointValue((pkg.points_amount || 0) + (pkg.bonus_points || 0), 0),
        paidAmount: normalizeCurrency(pkg.price_cny, null)
    };
}

function resolveRequestedProviderKey({
    requestedProviderKey,
    paymentChannels,
    rechargeOptions,
    requestHost = ''
}) {
    const normalizedRequested = String(requestedProviderKey || '').trim().toLowerCase();
    const activeProviderKey = String(paymentChannels?.active_provider || 'afdian').trim().toLowerCase() || 'afdian';

    if (!normalizedRequested || normalizedRequested === activeProviderKey) {
        return activeProviderKey;
    }

    if (normalizedRequested === 'mock') {
        const mockEnabled = rechargeOptions?.mock_payment_enabled === true
            || paymentChannels?.active_provider === 'mock';
        const isLocalRequest = /(^|:)(localhost|127\.0\.0\.1)(:\d+)?$/i.test(String(requestHost || '').trim());
        if (mockEnabled || isLocalRequest) {
            return 'mock';
        }
        throw new Error('当前未开启模拟支付，请使用真实支付流程');
    }

    throw new Error('当前支付通道与前端请求不一致，请刷新页面后重试');
}

async function completeMockPayment({
    supabase,
    user,
    body = {}
}) {
    const site = sanitizeSite(body.site);
    const packageId = body.package_id ? String(body.package_id).trim() : '';
    const orderNo = buildMockOrderNo(body.order_no);
    const isCustomRecharge = !packageId;

    let packageName = '自定义充值';
    let paidPoints = normalizePointValue(body.points_amount, 0);
    let bonusPoints = 0;
    let paidAmount = normalizeCurrency(body.paid_amount, null);

    if (packageId) {
        const pkg = await loadPointsPackage(supabase, packageId);
        packageName = pkg.name;
        paidPoints = pkg.paidPoints;
        bonusPoints = pkg.bonusPoints;
        paidAmount = pkg.paidAmount;
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
        return {
            success: true,
            provider: 'mock',
            mode: 'completed',
            order_no: orderNo,
            status: existingOrder.status,
            points_amount: normalizePointValue(existingOrder.points_amount, grantedPoints),
            paid_amount: normalizeCurrency(existingOrder.paid_amount, paidAmount),
            message: `已使用模拟支付完成「${packageName}」`
        };
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
            source: 'payment_create_api',
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

    return {
        success: true,
        provider: 'mock',
        mode: 'completed',
        order_no: orderNo,
        status: 'redeemed',
        points_amount: grantedPoints,
        paid_amount: paidAmount,
        package_name: packageName,
        message: `已使用模拟支付完成「${packageName}」`
    };
}

async function createPaymentRequest({
    supabase,
    user,
    body = {},
    env = process.env,
    requestHost = ''
}) {
    const site = sanitizeSite(body.site);
    const requestedProviderKey = String(body.provider_key || '').trim().toLowerCase();
    const packageId = body.package_id ? String(body.package_id).trim() : '';
    const isCustomRecharge = !packageId;

    const { paymentChannels, rechargeOptions } = await loadStoredPaymentConfigs(supabase, {
        origin: env.APP_BASE_URL,
        afdianCheckoutUrl: env.PAYMENT_AFDIAN_URL
    });

    const providerKey = resolveRequestedProviderKey({
        requestedProviderKey,
        paymentChannels,
        rechargeOptions,
        requestHost
    });

    const adapter = getPaymentProviderAdapter(providerKey);
    if (!adapter) {
        throw new Error('当前支付通道不可用');
    }

    let packageName = '自定义充值';
    let paidPoints = normalizePointValue(body.points_amount, 0);
    let bonusPoints = 0;
    let grantedPoints = paidPoints;
    let paidAmount = normalizeCurrency(body.paid_amount, null);

    if (packageId) {
        const pkg = await loadPointsPackage(supabase, packageId);
        packageName = pkg.name;
        paidPoints = pkg.paidPoints;
        bonusPoints = pkg.bonusPoints;
        grantedPoints = pkg.grantedPoints;
        paidAmount = pkg.paidAmount;
    }

    if (!Number.isFinite(grantedPoints) || grantedPoints <= 0) {
        throw new Error('充值积分必须大于 0');
    }

    if (providerKey === 'mock') {
        return completeMockPayment({
            supabase,
            user,
            body: {
                ...body,
                site,
                package_id: packageId || null,
                points_amount: paidPoints,
                paid_amount: paidAmount,
                package_name: packageName
            }
        });
    }

    const runtimeContext = await adapter.resolveRuntimeContext({
        supabase,
        env,
        config: paymentChannels
    });

    const checkoutContext = adapter.createCheckoutContext({
        runtimeContext,
        paymentChannels,
        site,
        isCustomRecharge,
        packageId,
        packageName,
        paidPoints,
        bonusPoints,
        grantedPoints,
        paidAmount
    });

    if (!checkoutContext?.supported) {
        throw new Error(checkoutContext?.message || `${adapter.label || '当前支付通道'}暂未完成接入`);
    }

    return {
        success: true,
        provider: providerKey,
        mode: checkoutContext.action || 'redirect',
        display_name: checkoutContext.displayName || adapter.label || '当前支付通道',
        checkout_url: checkoutContext.checkoutUrl || '',
        package_name: packageName,
        points_amount: grantedPoints,
        paid_amount: paidAmount,
        query_mode: checkoutContext.queryMode || '',
        message: checkoutContext.message || `${checkoutContext.displayName || adapter.label || '当前支付通道'}已准备就绪。`,
        provider_summary: checkoutContext.summary || {}
    };
}

module.exports = {
    completeMockPayment,
    createPaymentRequest,
    loadPointsPackage,
    sanitizeSite
};
