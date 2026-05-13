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
    normalizeZpayPaymentStatus,
    parseZpayParam
} = require('./zpay');
const {
    deriveZpayPointBreakdown
} = require('./zpay-points');
const {
    rechargePointsForPayment
} = require('./rpc');
const {
    maybeIssueAffiliateDiscountAssetsForRecharge,
    maybeIssueRechargeDiscountAssets
} = require('../discount-trigger-linkage');
const {
    syncPaymentStatusUserTags
} = require('../user-tags');
const {
    applyRateLimitHeaders,
    explainClientIpResolution,
    isIpAllowed,
    resolveClientIp,
    splitIpRules,
    takeRateLimitToken
} = require('../request-security');

const PAYMENT_ORDER_SNAPSHOT_SELECT = 'id, user_id, provider, provider_order_no, checkout_session_id, site, package_id, package_name, expected_amount, paid_amount, points_amount, status, sign_verified, amount_verified, provider_metadata, raw_payload, created_at, paid_at, claimed_at, verified_at, last_error';
const zpayProvider = getPaymentProviderAdapter('zpay');
const INTERNAL_PUBLIC_ROUTE_QUERY_KEYS = new Set(['scope', 'route', 'path']);

async function safeSyncPaymentStatusUserTags(supabase, options = {}) {
    try {
        return await syncPaymentStatusUserTags(supabase, options);
    } catch (error) {
        console.warn('[ZPAY] Failed to sync engagement user tags:', error?.message || error);
        return {
            ok: false,
            skipped: 'tag_sync_failed'
        };
    }
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

function getZpayWebhookTrustedProxies(env = process.env) {
    return env.ZPAY_WEBHOOK_TRUSTED_PROXIES
        || env.TRUSTED_PROXY_IPS
        || env.TRUSTED_PROXY_CIDRS
        || '';
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
        trust_all_proxies: diagnostic.trustAllProxies,
        direct_peer_trusted: diagnostic.directPeerTrusted,
        direct_peer_trust_reason: diagnostic.directPeerTrustReason,
        used_forwarded_chain: diagnostic.usedForwardedChain,
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
        console.warn('[ZPAY] Failed to finalize payment event:', error.message);
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
        console.warn('[ZPAY] Failed to delete payment event:', error.message);
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

function parseSearchParamsObject(searchParams) {
    const payload = {};
    searchParams.forEach((value, key) => {
        payload[key] = value;
    });
    return payload;
}

function stripInternalRouteQueryKeys(payload = {}) {
    const sanitized = normalizeRequestObject(payload);

    for (const key of INTERNAL_PUBLIC_ROUTE_QUERY_KEYS) {
        if (Object.prototype.hasOwnProperty.call(sanitized, key)) {
            delete sanitized[key];
        }
    }

    return sanitized;
}

function parseBodyByContentType(rawBody = '', contentType = '') {
    const normalizedRawBody = String(rawBody || '').trim();
    if (!normalizedRawBody) {
        return {};
    }

    const normalizedContentType = String(contentType || '').trim().toLowerCase();
    if (normalizedContentType.includes('application/json')) {
        try {
            const parsed = JSON.parse(normalizedRawBody);
            return normalizeRequestObject(parsed);
        } catch (_) {
            return {};
        }
    }

    if (
        normalizedContentType.includes('application/x-www-form-urlencoded')
        || normalizedContentType.includes('text/plain')
        || normalizedContentType === ''
    ) {
        return parseSearchParamsObject(new URLSearchParams(normalizedRawBody));
    }

    return {};
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
    const queryPayloadFromUrl = (() => {
        const host = getRequestHostName(req) || 'localhost';
        try {
            const parsedUrl = new URL(String(req?.url || ''), `http://${host}`);
            return stripInternalRouteQueryKeys(parseSearchParamsObject(parsedUrl.searchParams));
        } catch (_) {
            return {};
        }
    })();

    const queryPayload = {
        ...queryPayloadFromUrl,
        ...stripInternalRouteQueryKeys(normalizeRequestObject(req?.query))
    };

    let bodyPayload = {};
    if (req?.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
        bodyPayload = normalizeRequestObject(req.body);
    } else if (typeof req?.body === 'string') {
        bodyPayload = parseBodyByContentType(req.body, req?.headers?.['content-type']);
    } else if (Buffer.isBuffer(req?.body)) {
        bodyPayload = parseBodyByContentType(req.body.toString('utf8'), req?.headers?.['content-type']);
    } else if (!['GET', 'HEAD'].includes(String(req?.method || '').toUpperCase())) {
        const rawBody = await readRawRequestBody(req);
        bodyPayload = parseBodyByContentType(rawBody, req?.headers?.['content-type']);
    }

    return {
        ...queryPayload,
        ...bodyPayload
    };
}

async function handleZpayWebhook({
    req,
    res,
    supabase,
    env = process.env
} = {}) {
    const method = String(req?.method || 'GET').trim().toUpperCase();
    if (!['GET', 'POST'].includes(method)) {
        if (typeof res?.setHeader === 'function') {
            res.setHeader('Allow', 'GET, POST');
        }
        return sendPlainText(res, 405, 'method not allowed');
    }

    console.log('[ZPAY] Webhook received');

    const webhookTrustedProxies = getZpayWebhookTrustedProxies(env);
    const webhookAllowedIps = String(env.ZPAY_WEBHOOK_ALLOWED_IPS || '').trim();
    if (isProductionLikeRuntime(env) && !webhookAllowedIps) {
        console.warn('[ZPAY] ZPAY_WEBHOOK_ALLOWED_IPS is missing; falling back to strict query verification mode');
    }
    const webhookContext = buildRequestNetworkContext(req, {
        env,
        trustedProxies: webhookTrustedProxies,
        allowedIps: webhookAllowedIps
    });
    const webhookClientIp = webhookContext.resolved_client_ip;
    if (webhookAllowedIps && (!webhookClientIp || !isIpAllowed(webhookClientIp, webhookAllowedIps))) {
        console.warn('[ZPAY] Webhook blocked due to IP allowlist mismatch:', JSON.stringify(webhookContext));
        return sendPlainText(res, 403, 'forbidden');
    }

    if (!supabase || typeof supabase.from !== 'function') {
        return sendPlainText(res, 503, 'payment webhook not configured');
    }

    if (!zpayProvider || typeof zpayProvider.resolveRuntimeContext !== 'function') {
        return sendPlainText(res, 503, 'payment webhook unavailable');
    }

    const webhookRateLimit = await applyRequestRateLimit(req, res, {
        supabase,
        env,
        keyPrefix: 'zpay-webhook',
        limit: Math.max(1, Number(env.ZPAY_WEBHOOK_RATE_LIMIT_MAX || 180)),
        windowMs: Math.max(10_000, Number(env.ZPAY_WEBHOOK_RATE_LIMIT_WINDOW_MS || 60_000)),
        trustedProxies: webhookTrustedProxies
    });
    if (!webhookRateLimit.rateLimit.allowed) {
        return sendPlainText(res, 429, 'rate limited');
    }

    const payload = await collectWebhookPayload(req);
    const orderNo = String(payload.out_trade_no || '').trim();
    const tradeNo = String(payload.trade_no || '').trim();
    const statusRaw = String(payload.trade_status || payload.status || '').trim().toUpperCase();
    const eventKey = zpayProvider.buildEventKey({
        providerOrderNo: orderNo,
        transactionId: tradeNo,
        status: statusRaw,
        payload
    });

    try {
        const eventInsert = await recordPaymentEvent(supabase, {
            provider: 'zpay',
            provider_order_no: orderNo || null,
            event_key: eventKey,
            event_type: 'webhook',
            signature_valid: false,
            payload,
            processing_result: 'received'
        });

        if (eventInsert.duplicate) {
            console.log('[ZPAY] Duplicate webhook ignored:', eventKey);
            return sendPlainText(res, 200, 'success');
        }

        if (!orderNo) {
            await finalizePaymentEvent(supabase, eventKey, {
                processing_result: 'invalid_order_no',
                error_message: 'missing out_trade_no',
                response_status: 400
            });
            return sendPlainText(res, 400, 'missing out_trade_no');
        }

        const attachData = parseZpayParam(payload.param);
        const currentSite = getCurrentSite(req, attachData.site);
        const runtimeContext = await zpayProvider.resolveRuntimeContext({
            supabase,
            env,
            site: currentSite
        });
        const signatureCheck = zpayProvider.verifyWebhook({
            payload,
            runtimeContext
        });
        if (signatureCheck.supported === false && signatureCheck.reason === 'missing_secret') {
            await finalizePaymentEvent(supabase, eventKey, {
                processing_result: 'missing_zpay_pkey',
                error_message: 'ZPAY_PKEY is not configured',
                response_status: 503
            });
            return sendPlainText(res, 503, 'payment webhook not configured');
        }

        const signatureValid = signatureCheck.valid === true;
        const paymentState = normalizeZpayPaymentStatus(payload.trade_status, payload.status);
        const amount = roundCurrencyAmount(payload.money || 0);
        const paymentOrder = await loadPaymentOrderSnapshotByProviderOrderNo(supabase, 'zpay', orderNo);
        const expectedAmount = roundCurrencyAmount(paymentOrder?.expected_amount ?? 0);
        const amountValid = expectedAmount > 0
            ? amountsMatch(expectedAmount, amount)
            : false;
        const ownerMatches = !paymentOrder?.user_id
            || !attachData?.user_id
            || String(paymentOrder.user_id || '').trim() === String(attachData.user_id || '').trim();
        let processingResult = paymentState === 'paid' ? 'pending_review' : `ignored_${paymentState}`;
        let errorMessage = null;
        let responseStatus = 200;
        let rechargeBreakdown = null;
        let queryVerification = null;
        let verifiedPaidAmount = amount;

        if (!signatureValid) {
            processingResult = 'signature_mismatch';
            errorMessage = 'signature_mismatch';
            responseStatus = 401;
        } else if (paymentState !== 'paid') {
            processingResult = `ignored_${paymentState}`;
        } else if (!paymentOrder?.id) {
            console.warn('[ZPAY] Local payment order was not ready for webhook:', orderNo);
            await deletePaymentEvent(supabase, eventKey);
            return sendPlainText(res, 503, 'payment order not ready');
        } else if (!paymentOrder?.user_id) {
            processingResult = 'pending_review';
            errorMessage = 'missing_payment_owner';
        } else if (!ownerMatches) {
            processingResult = 'pending_review';
            errorMessage = 'payment_owner_mismatch';
        } else if (!amountValid) {
            processingResult = 'amount_mismatch';
            errorMessage = `amount_mismatch_expected_${expectedAmount}`;
        } else {
            try {
                queryVerification = await zpayProvider.queryOrder({
                    runtimeContext,
                    providerOrderNo: orderNo,
                    tradeNo
                });
            } catch (queryError) {
                console.warn('[ZPAY] Active order verification failed:', queryError.message);
                await deletePaymentEvent(supabase, eventKey);
                return sendPlainText(res, 503, 'query verification unavailable');
            }

            if (queryVerification?.supported === false || queryVerification?.success !== true) {
                console.warn('[ZPAY] Active order verification was unavailable:', queryVerification?.message || 'unknown_error');
                await deletePaymentEvent(supabase, eventKey);
                return sendPlainText(res, 503, 'query verification unavailable');
            }

            const queryPaidAmount = roundCurrencyAmount(queryVerification?.paidAmount ?? amount);
            const queryAmountValid = expectedAmount > 0
                ? amountsMatch(expectedAmount, queryPaidAmount)
                : false;
            const queryState = String(queryVerification?.status || '').trim().toLowerCase();
            const queryProviderOrderNo = String(queryVerification?.providerOrderNo || '').trim();
            const queryTradeNo = String(queryVerification?.tradeNo || '').trim();

            verifiedPaidAmount = queryPaidAmount > 0 ? queryPaidAmount : amount;

            if (queryState !== 'paid') {
                console.warn('[ZPAY] Active order verification is not paid yet:', queryState || 'unknown');
                await deletePaymentEvent(supabase, eventKey);
                return sendPlainText(res, 503, 'query verification pending');
            } else if (queryProviderOrderNo && queryProviderOrderNo !== orderNo) {
                processingResult = 'pending_review';
                errorMessage = 'query_order_mismatch';
            } else if (tradeNo && queryTradeNo && queryTradeNo !== tradeNo) {
                processingResult = 'pending_review';
                errorMessage = 'query_trade_mismatch';
            } else if (!queryAmountValid) {
                processingResult = 'amount_mismatch';
                errorMessage = `query_amount_mismatch_expected_${expectedAmount}`;
            } else {
            rechargeBreakdown = deriveZpayPointBreakdown(paymentOrder, attachData);
            const currentOrderStatus = String(paymentOrder.status || '').trim().toLowerCase();
            if (!['paid', 'redeemed'].includes(currentOrderStatus)) {
                const { error: rechargeError } = await rechargePointsForPayment({
                    supabase,
                    userId: paymentOrder.user_id,
                    paidPoints: rechargeBreakdown.paidPoints,
                    bonusPoints: rechargeBreakdown.bonusPoints,
                    reason: attachData.charge_type === 'custom'
                        ? 'custom_recharge'
                        : `易支付充值: ${String(paymentOrder.package_name || '充值订单').trim() || '充值订单'}`,
                    referenceId: `zpay_${orderNo}`,
                    site: paymentOrder.site || currentSite
                });

                if (rechargeError) {
                    throw new Error(rechargeError.message || 'Failed to credit ZPAY payment points');
                }
            }

            processingResult = 'processed_paid';
            }
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
            const nextStatus = processingResult === 'processed_paid'
                ? 'redeemed'
                : (isAmountMismatch
                    ? 'amount_mismatch'
                    : (paymentState === 'paid' && signatureValid ? 'pending_review' : paymentOrder.status));

            const orderPatch = {
                status: nextStatus,
                sign_verified: signatureValid,
                amount_verified: paymentState === 'paid'
                    ? (processingResult === 'processed_paid'
                        ? true
                        : (isAmountMismatch
                            ? false
                            : (paymentOrder.amount_verified === true || (amountValid && queryVerification?.success === true))))
                    : paymentOrder.amount_verified === true,
                paid_amount: paymentState === 'paid'
                    ? verifiedPaidAmount
                    : (paymentOrder.paid_amount ?? verifiedPaidAmount),
                expected_amount: expectedAmount > 0
                    ? expectedAmount
                    : paymentOrder.expected_amount,
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
                    zpay_webhook: payload,
                    attach: attachData,
                    zpay_query: queryVerification?.responsePayload || null
                }),
                provider_metadata: mergePaymentObjects(existingMetadata, {
                    provider_order_no: orderNo,
                    trade_no: tradeNo || null,
                    checkout_session_id: paymentOrder.checkout_session_id || attachData.checkout_session_id || null,
                    checkout_session_key: existingMetadata.checkout_session_key || attachData.checkout_session_key || null,
                    merchant_pid: String(payload.pid || '').trim() || null,
                    payment_type: String(payload.type || existingMetadata.payment_type || '').trim() || null,
                    buyer: String(payload.buyer || '').trim() || null,
                    payment_status: paymentState,
                    payment_status_raw: statusRaw || null,
                    query_trade_no: String(queryVerification?.tradeNo || '').trim() || null,
                    query_status: String(queryVerification?.status || '').trim() || null,
                    query_status_raw: String(queryVerification?.statusRaw || '').trim() || null,
                    query_verified_at: queryVerification ? nowIso : null,
                    webhook_received_at: nowIso
                })
            };

            const { error: orderUpdateError } = await supabase
                .from('payment_orders')
                .update(orderPatch)
                .eq('id', paymentOrder.id);

            if (orderUpdateError) {
                throw new Error(orderUpdateError.message || 'Failed to update ZPAY payment order');
            }

            if (processingResult === 'processed_paid') {
                try {
                    await reconcileCheckoutSessionForPaymentOrder({
                        supabase,
                        providerKey: 'zpay',
                        paymentOrderId: paymentOrder.id,
                        providerOrderNo: orderNo,
                        userId: paymentOrder.user_id,
                        site: paymentOrder.site || currentSite,
                        packageId: paymentOrder.package_id,
                        packageName: paymentOrder.package_name,
                        expectedAmount,
                        paidAmount: verifiedPaidAmount,
                        pointsAmount: paymentOrder.points_amount,
                        orderStatus: 'redeemed',
                        linkedBy: 'zpay_webhook',
                        allowHeuristic: true,
                        lookbackMinutes: 1440
                    });
                } catch (linkError) {
                    console.warn('[ZPAY] Failed to link checkout session from webhook:', linkError.message);
                }

                await maybeIssueRechargeDiscountAssets({
                    supabase,
                    userId: paymentOrder.user_id,
                    site: paymentOrder.site || currentSite,
                    paidPoints: rechargeBreakdown?.paidPoints || 0,
                    bonusPoints: rechargeBreakdown?.bonusPoints || 0,
                    paidAmount: verifiedPaidAmount,
                    paymentOrderId: paymentOrder.id,
                    paymentProvider: 'zpay',
                    paymentOrderNo: orderNo
                });
                await maybeIssueAffiliateDiscountAssetsForRecharge({
                    supabase,
                    site: paymentOrder.site || currentSite,
                    rechargeReferenceId: `zpay_${orderNo}`
                });

                await safeSyncPaymentStatusUserTags(supabase, {
                    userId: paymentOrder.user_id,
                    status: 'completed',
                    site: paymentOrder.site || currentSite || 'cn',
                    sourceEventId: paymentOrder.id,
                    sourceModule: 'payments.zpay_webhook'
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
        console.error('[ZPAY] Webhook error:', error);
        await finalizePaymentEvent(supabase, eventKey, {
            processing_result: 'webhook_exception',
            error_message: error.message,
            response_status: 500
        });
        return sendPlainText(res, 500, 'error');
    }
}

function createZpayWebhookHandler({
    supabase = null,
    getSupabase = null,
    env = process.env
} = {}) {
    return async function zpayWebhookHandler(req, res) {
        const resolvedSupabase = typeof getSupabase === 'function'
            ? await getSupabase({ req, res })
            : supabase;

        return handleZpayWebhook({
            req,
            res,
            supabase: resolvedSupabase,
            env
        });
    };
}

module.exports = {
    createZpayWebhookHandler,
    handleZpayWebhook,
    _private: {
        buildRequestNetworkContext,
        collectWebhookPayload,
        getCurrentSite,
        getRequestHostName,
        getZpayWebhookTrustedProxies,
        isProductionLikeRuntime,
        mergePaymentObjects,
        parseBodyByContentType,
        readRawRequestBody
    }
};
