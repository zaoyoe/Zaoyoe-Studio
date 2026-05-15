const {
    getPaymentProviderAdapter,
    roundCurrencyAmount,
    amountsMatch
} = require('./provider-adapters');
const {
    reconcileCheckoutSessionForPaymentOrder,
    sanitizeSite
} = require('./orders');
const {
    normalizeNowpaymentsPaymentStatus
} = require('./nowpayments');
const {
    rechargePointsForPayment
} = require('./rpc');
const {
    maybeIssueAffiliateDiscountAssetsForRecharge,
    maybeIssueRechargeDiscountAssets
} = require('../discount-trigger-linkage');
const {
    applyRateLimitHeaders,
    explainClientIpResolution,
    isIpAllowed,
    resolveClientIp,
    splitIpRules,
    takeRateLimitToken
} = require('../request-security');

const PAYMENT_ORDER_SNAPSHOT_SELECT = 'id, user_id, provider, provider_order_no, checkout_session_id, site, package_id, package_name, expected_amount, paid_amount, points_amount, status, sign_verified, amount_verified, provider_metadata, raw_payload, created_at, paid_at, claimed_at, verified_at, last_error';
const nowpaymentsProvider = getPaymentProviderAdapter('nowpayments');

function sanitizeText(value, fallback = '', maxLength = 240) {
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim();
    return normalized ? normalized.slice(0, maxLength) : fallback;
}

function getRequestHostName(req) {
    const rawHost = String(req?.headers?.host || req?.headers?.Host || '').trim().toLowerCase();
    if (!rawHost) return '';
    return rawHost.replace(/^\[|\]$/g, '').split(':')[0];
}

function getCurrentSite(req, explicitSite) {
    if (explicitSite) {
        return sanitizeSite(explicitSite);
    }

    const requestHints = [
        req?.headers?.origin,
        req?.headers?.referer,
        req?.headers?.['x-forwarded-host'],
        req?.headers?.host,
        req?.hostname
    ];

    for (const hint of requestHints) {
        const normalizedHint = String(hint || '').trim().toLowerCase();
        if (!normalizedHint) continue;
        if (normalizedHint.includes('zaoyoe.xyz')) return 'intl';
        if (normalizedHint.includes('zaoyoe.com')) return 'cn';
    }

    return 'cn';
}

function isProductionLikeRuntime(env = process.env) {
    const vercelEnv = String(env?.VERCEL_ENV || '').trim().toLowerCase();
    const railwayEnv = String(env?.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase();
    const deploymentTier = String(env?.DEPLOYMENT_TIER || env?.APP_ENV || '').trim().toLowerCase();

    return vercelEnv === 'production'
        || railwayEnv === 'production'
        || deploymentTier === 'production';
}

function getNowpaymentsWebhookTrustedProxies(env = process.env) {
    return env.NOWPAYMENTS_WEBHOOK_TRUSTED_PROXIES
        || env.TRUSTED_PROXY_IPS
        || env.TRUSTED_PROXY_CIDRS
        || '';
}

function getHeaderValue(req, headerName) {
    const headers = req?.headers || {};
    const normalizedName = String(headerName || '').trim().toLowerCase();
    return String(headers[normalizedName] || headers[headerName] || '').trim();
}

function getForwardingHeaderSnapshot(req) {
    const headers = req?.headers || {};
    const snapshot = {};

    for (const headerName of [
        'cf-connecting-ip',
        'x-real-ip',
        'true-client-ip',
        'x-forwarded-for',
        'forwarded'
    ]) {
        const value = String(headers[headerName] || '').trim();
        if (value) {
            snapshot[headerName] = value;
        }
    }

    return snapshot;
}

function buildRequestNetworkContext(req, {
    env = process.env,
    trustedProxies = '',
    allowedIps = ''
} = {}) {
    const diagnostic = explainClientIpResolution(req, {
        env,
        trustedProxies
    });
    const normalizedAllowedIps = splitIpRules(allowedIps);

    return {
        host: getRequestHostName(req) || null,
        forwarding_headers: getForwardingHeaderSnapshot(req),
        socket_ip: diagnostic.socketIp || null,
        forwarded_ips: diagnostic.forwardedIps,
        resolved_client_ip: diagnostic.resolvedClientIp || null,
        trusted_proxies: diagnostic.trustedProxies,
        allowlist_rules: normalizedAllowedIps,
        allowlist_configured: normalizedAllowedIps.length > 0,
        would_pass_allowlist: !normalizedAllowedIps.length
            || Boolean(diagnostic.resolvedClientIp && isIpAllowed(diagnostic.resolvedClientIp, normalizedAllowedIps))
    };
}

async function applyRequestRateLimit(req, res, {
    supabase,
    env = process.env,
    keyPrefix,
    limit,
    windowMs,
    trustedProxies = ''
} = {}) {
    const clientIp = resolveClientIp(req, {
        env,
        trustedProxies
    });
    const rateLimit = await takeRateLimitToken({
        supabase,
        env,
        key: `${keyPrefix}:${clientIp || 'unknown'}`,
        limit,
        windowMs
    });

    applyRateLimitHeaders(res, rateLimit);

    return {
        clientIp,
        rateLimit
    };
}

async function recordPaymentEvent(supabase, eventPayload) {
    const { data, error } = await supabase
        .from('payment_events')
        .insert(eventPayload)
        .select('id')
        .limit(1);

    if (error) {
        if (error.code === '23505') {
            return { duplicate: true, id: null };
        }
        throw error;
    }

    return {
        duplicate: false,
        id: data?.[0]?.id || null
    };
}

async function finalizePaymentEvent(supabase, eventKey, patch = {}) {
    const payload = {
        ...patch,
        processed_at: new Date().toISOString()
    };

    const { error } = await supabase
        .from('payment_events')
        .update(payload)
        .eq('event_key', eventKey);

    if (error) {
        console.warn('[NOWPayments] Failed to finalize payment event:', error.message);
    }
}

async function deletePaymentEvent(supabase, eventKey) {
    const normalizedEventKey = String(eventKey || '').trim();
    if (!normalizedEventKey) return;

    const { error } = await supabase
        .from('payment_events')
        .delete()
        .eq('event_key', normalizedEventKey);

    if (error) {
        console.warn('[NOWPayments] Failed to delete payment event:', error.message);
    }
}

function mergePaymentObjects(baseValue, patchValue) {
    const base = baseValue && typeof baseValue === 'object' && !Array.isArray(baseValue) ? baseValue : {};
    const patch = patchValue && typeof patchValue === 'object' && !Array.isArray(patchValue) ? patchValue : {};
    return {
        ...base,
        ...patch
    };
}

async function loadPaymentOrderSnapshotByProviderOrderNo(supabase, provider, providerOrderNo) {
    const normalizedProvider = String(provider || '').trim().toLowerCase();
    const normalizedOrderNo = String(providerOrderNo || '').trim();
    if (!normalizedProvider || !normalizedOrderNo) {
        return null;
    }

    const { data, error } = await supabase
        .from('payment_orders')
        .select(PAYMENT_ORDER_SNAPSHOT_SELECT)
        .eq('provider', normalizedProvider)
        .eq('provider_order_no', normalizedOrderNo)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw new Error(error.message || 'Failed to inspect payment order snapshot');
    }

    return data || null;
}

function setResponseStatus(res, statusCode) {
    if (typeof res?.status === 'function') {
        res.status(statusCode);
        return res;
    }

    if (res) {
        res.statusCode = statusCode;
    }
    return res;
}

function sendPlainText(res, statusCode, body = '') {
    setResponseStatus(res, statusCode);
    if (typeof res?.setHeader === 'function') {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    }
    res.end(String(body || ''));
}

function normalizeRequestObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? { ...value }
        : {};
}

async function readRawRequestBody(req) {
    if (!req || typeof req[Symbol.asyncIterator] !== 'function') {
        return '';
    }

    const chunks = [];
    for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return chunks.length
        ? Buffer.concat(chunks).toString('utf8')
        : '';
}

async function collectWebhookPayload(req) {
    if (req?.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
        return normalizeRequestObject(req.body);
    }
    if (typeof req?.body === 'string' && req.body.trim()) {
        try {
            return normalizeRequestObject(JSON.parse(req.body));
        } catch (_) {
            return {};
        }
    }
    if (Buffer.isBuffer(req?.body)) {
        try {
            return normalizeRequestObject(JSON.parse(req.body.toString('utf8')));
        } catch (_) {
            return {};
        }
    }

    const rawBody = await readRawRequestBody(req);
    if (!rawBody.trim()) return {};
    try {
        return normalizeRequestObject(JSON.parse(rawBody));
    } catch (_) {
        return {};
    }
}

function deriveNowpaymentsPointBreakdown(paymentOrder = {}) {
    const metadata = paymentOrder.provider_metadata && typeof paymentOrder.provider_metadata === 'object'
        ? paymentOrder.provider_metadata
        : {};
    const paidPoints = Number(metadata.paid_points);
    const bonusPoints = Number(metadata.bonus_points);

    if (Number.isFinite(paidPoints) || Number.isFinite(bonusPoints)) {
        return {
            paidPoints: Number.isFinite(paidPoints) ? paidPoints : 0,
            bonusPoints: Number.isFinite(bonusPoints) ? bonusPoints : 0
        };
    }

    return {
        paidPoints: Number(paymentOrder.points_amount) || 0,
        bonusPoints: 0
    };
}

function pickNowpaymentsTransactionId(payload = {}) {
    return sanitizeText(
        payload.payment_id
        || payload.purchase_id
        || payload.parent_payment_id
        || payload.invoice_id,
        '',
        120
    );
}

async function handleNowpaymentsWebhook({
    req,
    res,
    supabase,
    env = process.env
} = {}) {
    const method = String(req?.method || 'GET').trim().toUpperCase();
    if (method !== 'POST') {
        if (typeof res?.setHeader === 'function') {
            res.setHeader('Allow', 'POST');
        }
        return sendPlainText(res, 405, 'method not allowed');
    }

    console.log('[NOWPayments] Webhook received');

    const webhookTrustedProxies = getNowpaymentsWebhookTrustedProxies(env);
    const webhookAllowedIps = String(env.NOWPAYMENTS_WEBHOOK_ALLOWED_IPS || '').trim();
    if (isProductionLikeRuntime(env) && !webhookAllowedIps) {
        console.warn('[NOWPayments] Webhook blocked because NOWPAYMENTS_WEBHOOK_ALLOWED_IPS is missing in a production-like runtime');
        return sendPlainText(res, 503, 'webhook source allowlist not configured');
    }
    const webhookContext = buildRequestNetworkContext(req, {
        env,
        trustedProxies: webhookTrustedProxies,
        allowedIps: webhookAllowedIps
    });
    const webhookClientIp = webhookContext.resolved_client_ip;
    if (webhookAllowedIps && (!webhookClientIp || !isIpAllowed(webhookClientIp, webhookAllowedIps))) {
        console.warn('[NOWPayments] Webhook blocked due to IP allowlist mismatch:', JSON.stringify(webhookContext));
        return sendPlainText(res, 403, 'forbidden');
    }

    if (!supabase || typeof supabase.from !== 'function') {
        return sendPlainText(res, 503, 'payment webhook not configured');
    }

    if (!nowpaymentsProvider || typeof nowpaymentsProvider.resolveRuntimeContext !== 'function') {
        return sendPlainText(res, 503, 'payment webhook unavailable');
    }

    const webhookRateLimit = await applyRequestRateLimit(req, res, {
        supabase,
        env,
        keyPrefix: 'nowpayments-webhook',
        limit: Math.max(1, Number(env.NOWPAYMENTS_WEBHOOK_RATE_LIMIT_MAX || 180)),
        windowMs: Math.max(10_000, Number(env.NOWPAYMENTS_WEBHOOK_RATE_LIMIT_WINDOW_MS || 60_000)),
        trustedProxies: webhookTrustedProxies
    });
    if (!webhookRateLimit.rateLimit.allowed) {
        return sendPlainText(res, 429, 'rate limited');
    }

    const payload = await collectWebhookPayload(req);
    const orderNo = sanitizeText(payload.order_id, '', 160);
    const invoiceId = sanitizeText(payload.invoice_id, '', 120);
    const transactionId = pickNowpaymentsTransactionId(payload);
    const statusRaw = sanitizeText(payload.payment_status, '', 40).toLowerCase();
    const eventKey = nowpaymentsProvider.buildEventKey({
        providerOrderNo: orderNo || invoiceId,
        transactionId,
        status: statusRaw,
        payload
    });

    try {
        const eventInsert = await recordPaymentEvent(supabase, {
            provider: 'nowpayments',
            provider_order_no: orderNo || null,
            event_key: eventKey,
            event_type: 'webhook',
            signature_valid: false,
            payload,
            processing_result: 'received'
        });

        if (eventInsert.duplicate) {
            console.log('[NOWPayments] Duplicate webhook ignored:', eventKey);
            return sendPlainText(res, 200, 'success');
        }

        if (!orderNo) {
            await finalizePaymentEvent(supabase, eventKey, {
                processing_result: 'invalid_order_no',
                error_message: 'missing order_id',
                response_status: 400
            });
            return sendPlainText(res, 400, 'missing order_id');
        }

        const paymentOrder = await loadPaymentOrderSnapshotByProviderOrderNo(supabase, 'nowpayments', orderNo);
        const metadata = paymentOrder?.provider_metadata && typeof paymentOrder.provider_metadata === 'object'
            ? paymentOrder.provider_metadata
            : {};
        const currentSite = getCurrentSite(req, metadata.site || paymentOrder?.site);
        const runtimeContext = await nowpaymentsProvider.resolveRuntimeContext({
            supabase,
            env,
            site: currentSite
        });
        const signatureCheck = nowpaymentsProvider.verifyWebhook({
            payload,
            runtimeContext,
            receivedSignature: getHeaderValue(req, 'x-nowpayments-sig')
        });
        if (signatureCheck.supported === false && signatureCheck.reason === 'missing_secret') {
            await finalizePaymentEvent(supabase, eventKey, {
                processing_result: 'missing_nowpayments_ipn_secret',
                error_message: 'NOWPAYMENTS_IPN_SECRET is not configured',
                response_status: 503
            });
            return sendPlainText(res, 503, 'payment webhook not configured');
        }

        const signatureValid = signatureCheck.valid === true;
        const paymentState = normalizeNowpaymentsPaymentStatus(payload.payment_status);
        const expectedPriceAmount = roundCurrencyAmount(metadata.price_amount ?? 0);
        const webhookPriceAmount = roundCurrencyAmount(payload.price_amount ?? 0);
        const expectedPayCurrency = sanitizeText(metadata.pay_currency, 'usdtbsc', 40).toLowerCase();
        const webhookPayCurrency = sanitizeText(payload.pay_currency, '', 40).toLowerCase();
        const expectedPriceCurrency = sanitizeText(metadata.price_currency, 'usd', 20).toLowerCase();
        const webhookPriceCurrency = sanitizeText(payload.price_currency, '', 20).toLowerCase();
        const amountValid = expectedPriceAmount > 0
            ? amountsMatch(expectedPriceAmount, webhookPriceAmount, 0.01)
            : false;
        const currencyValid = (!webhookPayCurrency || webhookPayCurrency === expectedPayCurrency)
            && (!webhookPriceCurrency || webhookPriceCurrency === expectedPriceCurrency);
        let processingResult = paymentState === 'paid' ? 'pending_review' : `ignored_${paymentState}`;
        let errorMessage = null;
        let responseStatus = 200;
        let rechargeBreakdown = null;

        if (!signatureValid) {
            processingResult = 'signature_mismatch';
            errorMessage = 'signature_mismatch';
            responseStatus = 401;
        } else if (paymentState !== 'paid') {
            if (paymentState === 'partially_paid') {
                processingResult = 'pending_review';
                errorMessage = 'partially_paid';
            } else if (paymentState === 'wrong_asset') {
                processingResult = 'pending_review';
                errorMessage = 'wrong_asset_confirmed';
            } else {
                processingResult = `ignored_${paymentState}`;
            }
        } else if (!paymentOrder?.id) {
            console.warn('[NOWPayments] Local payment order was not ready for webhook:', orderNo);
            await deletePaymentEvent(supabase, eventKey);
            return sendPlainText(res, 503, 'payment order not ready');
        } else if (!paymentOrder?.user_id) {
            processingResult = 'pending_review';
            errorMessage = 'missing_payment_owner';
        } else if (!amountValid) {
            processingResult = 'amount_mismatch';
            errorMessage = `amount_mismatch_expected_${expectedPriceAmount}_${expectedPriceCurrency}`;
        } else if (!currencyValid) {
            processingResult = 'pending_review';
            errorMessage = 'currency_mismatch';
        } else {
            rechargeBreakdown = deriveNowpaymentsPointBreakdown(paymentOrder);
            const currentOrderStatus = String(paymentOrder.status || '').trim().toLowerCase();
            if (!['paid', 'redeemed'].includes(currentOrderStatus)) {
                const { error: rechargeError } = await rechargePointsForPayment({
                    supabase,
                    userId: paymentOrder.user_id,
                    paidPoints: rechargeBreakdown.paidPoints,
                    bonusPoints: rechargeBreakdown.bonusPoints,
                    reason: metadata.charge_type === 'custom'
                        ? 'custom_recharge'
                        : `USDT-BEP20充值: ${String(paymentOrder.package_name || '充值订单').trim() || '充值订单'}`,
                    referenceId: `nowpayments_${orderNo}`,
                    site: paymentOrder.site || currentSite
                });

                if (rechargeError) {
                    throw new Error(rechargeError.message || 'Failed to credit NOWPayments payment points');
                }
            }

            processingResult = 'processed_paid';
        }

        if (paymentOrder?.id) {
            const nowIso = new Date().toISOString();
            const existingMetadata = paymentOrder.provider_metadata && typeof paymentOrder.provider_metadata === 'object'
                ? paymentOrder.provider_metadata
                : {};
            const existingRawPayload = paymentOrder.raw_payload && typeof paymentOrder.raw_payload === 'object'
                ? paymentOrder.raw_payload
                : {};
            const isAmountMismatch = processingResult === 'amount_mismatch';
            const isPendingReview = processingResult === 'pending_review';
            const nextStatus = processingResult === 'processed_paid'
                ? 'redeemed'
                : (isAmountMismatch
                    ? 'amount_mismatch'
                    : (isPendingReview ? 'pending_review' : paymentOrder.status));
            const localPaidAmount = roundCurrencyAmount(paymentOrder.expected_amount ?? existingMetadata.local_amount ?? 0);

            const orderPatch = {
                status: nextStatus,
                sign_verified: signatureValid,
                amount_verified: paymentState === 'paid'
                    ? (processingResult === 'processed_paid'
                        ? true
                        : (isAmountMismatch ? false : paymentOrder.amount_verified === true))
                    : paymentOrder.amount_verified === true,
                paid_amount: paymentState === 'paid'
                    ? localPaidAmount
                    : paymentOrder.paid_amount,
                paid_at: processingResult === 'processed_paid'
                    ? (paymentOrder.paid_at || nowIso)
                    : paymentOrder.paid_at,
                verified_at: signatureValid
                    ? (paymentOrder.verified_at || nowIso)
                    : paymentOrder.verified_at,
                claimed_at: processingResult === 'processed_paid'
                    ? (paymentOrder.claimed_at || nowIso)
                    : paymentOrder.claimed_at,
                last_error: errorMessage,
                raw_payload: mergePaymentObjects(existingRawPayload, {
                    nowpayments_webhook: payload
                }),
                provider_metadata: mergePaymentObjects(existingMetadata, {
                    provider_order_no: orderNo,
                    invoice_id: invoiceId || existingMetadata.invoice_id || null,
                    payment_id: sanitizeText(payload.payment_id, '', 120) || null,
                    parent_payment_id: sanitizeText(payload.parent_payment_id, '', 120) || null,
                    purchase_id: sanitizeText(payload.purchase_id, '', 120) || null,
                    payment_status: paymentState,
                    payment_status_raw: statusRaw || null,
                    pay_currency: webhookPayCurrency || existingMetadata.pay_currency || null,
                    price_currency: webhookPriceCurrency || existingMetadata.price_currency || null,
                    price_amount_webhook: webhookPriceAmount || null,
                    pay_amount: roundCurrencyAmount(payload.pay_amount ?? 0) || null,
                    actually_paid: roundCurrencyAmount(payload.actually_paid ?? 0) || null,
                    outcome_amount: roundCurrencyAmount(payload.outcome_amount ?? 0) || null,
                    outcome_currency: sanitizeText(payload.outcome_currency, '', 40).toLowerCase() || null,
                    webhook_received_at: nowIso
                })
            };

            const { error: orderUpdateError } = await supabase
                .from('payment_orders')
                .update(orderPatch)
                .eq('id', paymentOrder.id);

            if (orderUpdateError) {
                throw new Error(orderUpdateError.message || 'Failed to update NOWPayments payment order');
            }

            if (processingResult === 'processed_paid') {
                try {
                    await reconcileCheckoutSessionForPaymentOrder({
                        supabase,
                        providerKey: 'nowpayments',
                        paymentOrderId: paymentOrder.id,
                        providerOrderNo: orderNo,
                        userId: paymentOrder.user_id,
                        site: paymentOrder.site || currentSite,
                        packageId: paymentOrder.package_id,
                        packageName: paymentOrder.package_name,
                        expectedAmount: paymentOrder.expected_amount,
                        paidAmount: localPaidAmount,
                        pointsAmount: paymentOrder.points_amount,
                        orderStatus: 'redeemed',
                        linkedBy: 'nowpayments_webhook',
                        allowHeuristic: true,
                        lookbackMinutes: 1440
                    });
                } catch (linkError) {
                    console.warn('[NOWPayments] Failed to link checkout session from webhook:', linkError.message);
                }

                await maybeIssueRechargeDiscountAssets({
                    supabase,
                    userId: paymentOrder.user_id,
                    site: paymentOrder.site || currentSite,
                    paidPoints: rechargeBreakdown?.paidPoints || 0,
                    bonusPoints: rechargeBreakdown?.bonusPoints || 0,
                    paidAmount: localPaidAmount,
                    paymentOrderId: paymentOrder.id,
                    paymentProvider: 'nowpayments',
                    paymentOrderNo: orderNo
                });
                await maybeIssueAffiliateDiscountAssetsForRecharge({
                    supabase,
                    site: paymentOrder.site || currentSite,
                    rechargeReferenceId: `nowpayments_${orderNo}`
                });
            }
        }

        await finalizePaymentEvent(supabase, eventKey, {
            payment_order_id: paymentOrder?.id || null,
            signature_valid: signatureValid,
            amount_valid: paymentState === 'paid'
                ? (processingResult === 'processed_paid'
                    ? true
                    : (processingResult === 'amount_mismatch' ? false : null))
                : null,
            processing_result: processingResult,
            error_message: errorMessage,
            response_status: responseStatus
        });

        if (!signatureValid) {
            return sendPlainText(res, 401, 'invalid signature');
        }

        return sendPlainText(res, 200, 'success');
    } catch (error) {
        console.error('[NOWPayments] Webhook error:', error);
        await finalizePaymentEvent(supabase, eventKey, {
            processing_result: 'webhook_exception',
            error_message: error.message,
            response_status: 500
        });
        return sendPlainText(res, 500, 'error');
    }
}

function createNowpaymentsWebhookHandler({
    supabase = null,
    getSupabase = null,
    env = process.env
} = {}) {
    return async function nowpaymentsWebhookHandler(req, res) {
        const resolvedSupabase = typeof getSupabase === 'function'
            ? await getSupabase({ req, res })
            : supabase;

        return handleNowpaymentsWebhook({
            req,
            res,
            supabase: resolvedSupabase,
            env
        });
    };
}

module.exports = {
    createNowpaymentsWebhookHandler,
    handleNowpaymentsWebhook,
    _private: {
        buildRequestNetworkContext,
        collectWebhookPayload,
        deriveNowpaymentsPointBreakdown,
        getCurrentSite,
        getNowpaymentsWebhookTrustedProxies,
        getRequestHostName,
        isProductionLikeRuntime,
        mergePaymentObjects,
        readRawRequestBody
    }
};
