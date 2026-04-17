const crypto = require('crypto');
const {
    normalizeSiteValue
} = require('../site');
const {
    buildHupijiaoTradeOrderId,
    createHupijiaoPayment,
    getHupijiaoGatewayOrderId,
    normalizeHupijiaoConfig,
    normalizeHupijiaoPaymentStatus,
    queryHupijiaoPayment,
    refundHupijiaoPayment,
    verifyHupijiaoHash
} = require('./hupijiao');
const {
    loadStoredPaymentConfigs,
    resolvePaymentProviderSecrets
} = require('./providers');

function normalizePointValue(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed * 10) / 10 : fallback;
}

function roundCurrencyAmount(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? Math.round(numericValue * 100) / 100 : 0;
}

function amountsMatch(expected, actual, epsilon = 0.01) {
    const left = roundCurrencyAmount(expected);
    const right = roundCurrencyAmount(actual);
    return Math.abs(left - right) <= epsilon;
}

function sanitizeText(value, fallback = '', maxLength = 240) {
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim();
    return normalized ? normalized.slice(0, maxLength) : fallback;
}

function pickFirstText(...values) {
    for (const value of values) {
        const normalized = sanitizeText(value, '', 240);
        if (normalized) return normalized;
    }
    return '';
}

function pickFirstCurrencyAmount(...values) {
    for (const value of values) {
        const amount = roundCurrencyAmount(value);
        if (amount > 0) return amount;
    }
    return null;
}

function buildHashedEventKey(provider, keyParts = [], payload = null) {
    const hash = crypto
        .createHash('sha256')
        .update(JSON.stringify(payload || {}))
        .digest('hex')
        .slice(0, 24);

    return [provider, ...keyParts.filter(Boolean), hash].join(':');
}

function buildMockOrderNo(explicitOrderNo = '') {
    const normalized = String(explicitOrderNo || '').trim();
    if (normalized) return normalized.slice(0, 120);
    return `MOCK_${Date.now()}_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

async function resolvePointsPackageBySkuOrAmount(supabase, { planId, amount }) {
    const normalizedAmount = roundCurrencyAmount(amount);

    if (planId) {
        const { data, error } = await supabase
            .from('points_packages')
            .select('id, name, points_amount, bonus_points, price_cny, sku_id, is_active')
            .eq('is_active', true)
            .eq('sku_id', planId)
            .maybeSingle();

        if (!error && data) {
            const paidPoints = Number(data.points_amount) || 0;
            const bonusPoints = Number(data.bonus_points) || 0;
            return {
                packageId: data.id,
                packageName: data.name,
                expectedAmount: roundCurrencyAmount(data.price_cny),
                pointsTotal: paidPoints + bonusPoints,
                matchType: 'sku'
            };
        }
    }

    const { data: packages, error: packagesError } = await supabase
        .from('points_packages')
        .select('id, name, points_amount, bonus_points, price_cny, sku_id, is_active')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

    if (packagesError) {
        return null;
    }

    const matchedPackage = (packages || []).find((pkg) => amountsMatch(pkg.price_cny, normalizedAmount));
    if (!matchedPackage) {
        return null;
    }

    const paidPoints = Number(matchedPackage.points_amount) || 0;
    const bonusPoints = Number(matchedPackage.bonus_points) || 0;
    return {
        packageId: matchedPackage.id,
        packageName: matchedPackage.name,
        expectedAmount: roundCurrencyAmount(matchedPackage.price_cny),
        pointsTotal: paidPoints + bonusPoints,
        matchType: 'amount'
    };
}

const providerRegistry = {
    mock: {
        key: 'mock',
        label: '模拟支付',
        supports: {
            createCheckout: true,
            webhook: false,
            queryOrder: false,
            autoCredit: true
        },
        async resolveRuntimeContext({ supabase, env = process.env, config = null } = {}) {
            const loaded = config
                ? { paymentChannels: config }
                : await loadStoredPaymentConfigs(supabase, {
                    origin: env.APP_BASE_URL,
                    afdianCheckoutUrl: env.PAYMENT_AFDIAN_URL
                });
            return {
                provider: 'mock',
                channelConfig: loaded.paymentChannels.providers.mock,
                activeProvider: loaded.paymentChannels.active_provider,
                secretValues: {}
            };
        },
        buildOrderNo({ explicitOrderNo = '' } = {}) {
            return buildMockOrderNo(explicitOrderNo);
        },
        buildEventKey({ orderNo, stage = 'completed' } = {}) {
            return `mock:${String(orderNo || '').trim() || 'unknown'}:${stage}`;
        },
        buildProviderMetadata({
            site,
            isCustomRecharge,
            packageName,
            paidPoints,
            bonusPoints,
            grantedPoints,
            paidAmount
        } = {}) {
            return {
                mode: 'mock',
                charge_type: isCustomRecharge ? 'custom' : 'package',
                paid_points: normalizePointValue(paidPoints, 0),
                bonus_points: normalizePointValue(bonusPoints, 0),
                credited_points: normalizePointValue(grantedPoints, 0),
                display_name: String(packageName || '自定义充值'),
                currency_amount: roundCurrencyAmount(paidAmount),
                site: normalizeSiteValue(site)
            };
        },
        createCheckoutContext({ runtimeContext, packageName, grantedPoints, isCustomRecharge } = {}) {
            const channelConfig = runtimeContext?.channelConfig || {};
            return {
                supported: true,
                action: 'inline_complete',
                displayName: channelConfig.display_name || '模拟支付',
                message: channelConfig.description
                    || (isCustomRecharge
                        ? `将使用模拟支付为账号直接充值 ${normalizePointValue(grantedPoints, 0)}。`
                        : `将使用模拟支付为账号直接充值「${String(packageName || '模拟支付套餐').trim()}」。`)
            };
        }
    },
    afdian: {
        key: 'afdian',
        label: '爱发电',
        supports: {
            createCheckout: true,
            webhook: true,
            queryOrder: true,
            autoCredit: false
        },
        async resolveRuntimeContext({ supabase, env = process.env, config = null } = {}) {
            const loaded = config
                ? { paymentChannels: config }
                : await loadStoredPaymentConfigs(supabase, {
                    origin: env.APP_BASE_URL,
                    afdianCheckoutUrl: env.PAYMENT_AFDIAN_URL
                });
            const secrets = await resolvePaymentProviderSecrets(supabase, 'afdian', env);
            return {
                provider: 'afdian',
                channelConfig: loaded.paymentChannels.providers.afdian,
                activeProvider: loaded.paymentChannels.active_provider,
                secretValues: {
                    afdian_token: secrets.afdian_token?.value || ''
                },
                secretMeta: secrets
            };
        },
        buildEventKey({ orderNo, status, payload } = {}) {
            return buildHashedEventKey('afdian', [
                String(orderNo || '').trim() || 'unknown',
                status ?? 'na'
            ], payload);
        },
        verifyWebhook({ payload, token } = {}) {
            const normalizedToken = String(token || '').trim();
            if (!normalizedToken) {
                return {
                    valid: false,
                    reason: 'missing_token',
                    expectedSign: ''
                };
            }

            if (!payload?.sign) {
                return {
                    valid: false,
                    reason: 'missing_signature',
                    expectedSign: ''
                };
            }

            const paramsJson = JSON.stringify(payload.data || {});
            const expectedSign = crypto
                .createHash('md5')
                .update(normalizedToken + paramsJson)
                .digest('hex');

            return {
                valid: payload.sign === expectedSign,
                reason: payload.sign === expectedSign ? '' : 'signature_mismatch',
                expectedSign
            };
        },
        async resolvePackage({ supabase, planId, amount } = {}) {
            return resolvePointsPackageBySkuOrAmount(supabase, { planId, amount });
        },
        deriveProcessError({ signatureValid, resolvedPackage, amount, amountValid } = {}) {
            if (!signatureValid) return 'signature_mismatch';
            if (!resolvedPackage) return 'package_not_found';
            if (!amountValid) {
                return `amount_mismatch_expected_${resolvedPackage.expectedAmount ?? roundCurrencyAmount(amount)}`;
            }
            return null;
        },
        createCheckoutContext({ runtimeContext, packageName, grantedPoints, isCustomRecharge, paidAmount, customQuote } = {}) {
            const channelConfig = runtimeContext?.channelConfig || {};
            const checkoutUrl = String(channelConfig.checkout_url || '').trim();

            if (!checkoutUrl) {
                return {
                    supported: false,
                    action: 'redirect',
                    message: '爱发电支付链接尚未配置。'
                };
            }

            return {
                supported: true,
                action: 'redirect',
                displayName: channelConfig.display_name || '爱发电',
                checkoutUrl,
                queryMode: 'order_no',
                message: (isCustomRecharge
                    ? channelConfig.custom_amount_hint
                    : channelConfig.package_hint)
                    || (isCustomRecharge
                        ? `请按页面报价支付 ¥${roundCurrencyAmount(paidAmount).toFixed(2)}，支付后返回钱包输入订单号领取兑换码。`
                        : `请在爱发电完成「${String(packageName || '').trim() || '当前套餐'}」支付后，返回钱包输入订单号领取兑换码。`),
                summary: {
                    grantedPoints: normalizePointValue(grantedPoints, 0),
                    expectedAmount: roundCurrencyAmount(paidAmount),
                    quoteExpiresAt: customQuote?.expiresAt || null
                }
            };
        }
    },
    hupijiao: {
        key: 'hupijiao',
        label: '虎皮椒',
        supports: {
            createCheckout: true,
            webhook: true,
            queryOrder: true,
            refundOrder: true,
            autoCredit: true
        },
        async resolveRuntimeContext({ supabase, env = process.env, config = null } = {}) {
            const loaded = config
                ? { paymentChannels: config }
                : await loadStoredPaymentConfigs(supabase, {
                    origin: env.APP_BASE_URL,
                    afdianCheckoutUrl: env.PAYMENT_AFDIAN_URL
                });
            const secrets = await resolvePaymentProviderSecrets(supabase, 'hupijiao', env);
            const integration = normalizeHupijiaoConfig({
                channelConfig: loaded.paymentChannels.providers.hupijiao,
                secretValues: {
                    hupijiao_api_key: secrets.hupijiao_api_key?.value || '',
                    hupijiao_secret_key: secrets.hupijiao_secret_key?.value || ''
                },
                requestOrigin: env.APP_BASE_URL
            });

            return {
                provider: 'hupijiao',
                channelConfig: loaded.paymentChannels.providers.hupijiao,
                activeProvider: loaded.paymentChannels.active_provider,
                implemented: true,
                integration,
                requestOrigin: env.APP_BASE_URL,
                secretValues: {
                    hupijiao_api_key: secrets.hupijiao_api_key?.value || '',
                    hupijiao_secret_key: secrets.hupijiao_secret_key?.value || ''
                },
                secretMeta: secrets
            };
        },
        buildEventKey({ providerOrderNo, transactionId, status, payload } = {}) {
            return buildHashedEventKey('hupijiao', [
                String(providerOrderNo || '').trim() || 'unknown',
                String(transactionId || '').trim() || 'na',
                String(status || '').trim().toUpperCase() || 'na'
            ], payload);
        },
        async createCheckoutContext({
            runtimeContext,
            checkoutSession,
            site,
            packageId,
            packageName,
            paidPoints,
            bonusPoints,
            grantedPoints,
            paidAmount,
            isCustomRecharge,
            customQuote
        } = {}) {
            const channelConfig = runtimeContext?.channelConfig || {};
            const integration = runtimeContext?.integration || normalizeHupijiaoConfig({
                channelConfig,
                secretValues: runtimeContext?.secretValues || {},
                requestOrigin: ''
            });
            const missingFields = Array.isArray(integration?.missingFields)
                ? integration.missingFields
                : [];
            if (missingFields.length) {
                return {
                    supported: false,
                    action: 'redirect',
                    displayName: channelConfig.display_name || '虎皮椒',
                    message: `当前还缺少：${missingFields.join(', ')}。请先补齐 APPID / SECRET / notify_url 后再启用虎皮椒真实支付。`
                };
            }

            const normalizedAmount = roundCurrencyAmount(paidAmount);
            if (!(normalizedAmount > 0)) {
                return {
                    supported: false,
                    action: 'redirect',
                    displayName: channelConfig.display_name || '虎皮椒',
                    message: '虎皮椒订单金额无效，暂时无法拉起支付。'
                };
            }

            const sessionId = String(checkoutSession?.id || '').trim();
            const sessionKey = String(checkoutSession?.session_key || '').trim();
            const tradeOrderId = buildHupijiaoTradeOrderId(sessionKey || sessionId || `${site}:${packageName}`);
            const normalizedSite = normalizeSiteValue(site);
            const title = isCustomRecharge
                ? `积分充值 ${normalizePointValue(grantedPoints, 0)} 点`
                : (String(packageName || '').trim() || `积分充值 ${normalizePointValue(grantedPoints, 0)} 点`);
            const attach = {
                provider: 'hupijiao',
                user_id: sanitizeText(checkoutSession?.user_id, '', 80),
                site: normalizedSite,
                checkout_session_id: sessionId || null,
                checkout_session_key: sessionKey || null,
                package_id: sanitizeText(packageId, '', 80) || null,
                package_name: sanitizeText(packageName, '', 120) || null,
                paid_points: normalizePointValue(paidPoints, 0),
                bonus_points: normalizePointValue(bonusPoints, 0),
                granted_points: normalizePointValue(grantedPoints, 0),
                expected_amount: normalizedAmount,
                charge_type: isCustomRecharge ? 'custom' : 'package',
                custom_quote_id: sanitizeText(customQuote?.quoteId, '', 120) || null
            };

            const paymentResult = await createHupijiaoPayment({
                channelConfig,
                secretValues: runtimeContext?.secretValues || {},
                requestOrigin: runtimeContext?.requestOrigin || '',
                tradeOrderId,
                amount: normalizedAmount,
                title,
                attach
            });
            const gatewayPayload = paymentResult.response?.data || {};
            const gatewayErrcode = Number(gatewayPayload.errcode ?? 0);
            const gatewayErrmsg = sanitizeText(gatewayPayload.errmsg, '', 240);
            if (gatewayErrcode !== 0) {
                return {
                    supported: false,
                    action: 'redirect',
                    displayName: channelConfig.display_name || '虎皮椒',
                    message: gatewayErrmsg || '虎皮椒下单失败，请稍后重试。'
                };
            }

            const checkoutUrl = sanitizeText(
                gatewayPayload.url || gatewayPayload.url_qrcode || channelConfig.checkout_url,
                '',
                1000
            );
            if (!checkoutUrl) {
                return {
                    supported: false,
                    action: 'redirect',
                    displayName: channelConfig.display_name || '虎皮椒',
                    message: '虎皮椒未返回可用支付链接，请检查网关配置。'
                };
            }

            const openOrderId = getHupijiaoGatewayOrderId(gatewayPayload);
            const qrcodeUrl = sanitizeText(gatewayPayload.url_qrcode, '', 1000) || null;
            return {
                supported: true,
                action: 'redirect',
                displayName: channelConfig.display_name || '虎皮椒',
                checkoutUrl,
                queryMode: 'provider_order_no',
                providerOrderNo: tradeOrderId,
                providerMetadata: {
                    provider_order_no: tradeOrderId,
                    gateway_open_order_id: openOrderId || null,
                    qrcode_url: qrcodeUrl,
                    gateway_errcode: gatewayErrcode,
                    gateway_errmsg: gatewayErrmsg || null,
                    charge_type: isCustomRecharge ? 'custom' : 'package'
                },
                summary: {
                    grantedPoints: normalizePointValue(grantedPoints, 0),
                    expectedAmount: normalizedAmount,
                    trade_order_id: tradeOrderId,
                    open_order_id: openOrderId || null,
                    qrcode_url: qrcodeUrl
                },
                message: (isCustomRecharge
                    ? channelConfig.custom_amount_hint
                    : channelConfig.package_hint)
                    || `虎皮椒支付链接已生成，请在新窗口完成支付后返回页面查看状态。`
            };
        },
        verifyWebhook({ payload, runtimeContext, secret } = {}) {
            const integration = runtimeContext?.integration || normalizeHupijiaoConfig({
                channelConfig: runtimeContext?.channelConfig || {},
                secretValues: runtimeContext?.secretValues || {},
                requestOrigin: runtimeContext?.requestOrigin || ''
            });
            const secretValue = sanitizeText(secret || integration.appSecret, '', 240);
            if (!secretValue) {
                return {
                    supported: false,
                    valid: false,
                    reason: 'missing_secret',
                    expectedHash: '',
                    receivedHash: sanitizeText(payload?.hash, '', 120).toLowerCase()
                };
            }

            const verification = verifyHupijiaoHash(payload || {}, secretValue);
            return {
                supported: true,
                valid: verification.valid,
                reason: verification.valid
                    ? ''
                    : (verification.receivedHash ? 'signature_mismatch' : 'missing_signature'),
                ...verification
            };
        },
        async queryOrder({ runtimeContext, providerOrderNo = '', openOrderId = '' } = {}) {
            const integration = runtimeContext?.integration || normalizeHupijiaoConfig({
                channelConfig: runtimeContext?.channelConfig || {},
                secretValues: runtimeContext?.secretValues || {},
                requestOrigin: runtimeContext?.requestOrigin || ''
            });
            if (!integration?.appId || !integration?.appSecret) {
                return {
                    supported: false,
                    message: '虎皮椒查询配置不完整，请先补齐 APPID / SECRET。'
                };
            }

            const queryResult = await queryHupijiaoPayment({
                channelConfig: runtimeContext?.channelConfig || {},
                secretValues: runtimeContext?.secretValues || {},
                requestOrigin: runtimeContext?.requestOrigin || '',
                tradeOrderId: providerOrderNo,
                openOrderId
            });
            const gatewayPayload = queryResult.response?.data || {};
            const gatewayErrcode = Number(gatewayPayload.errcode ?? 0);
            const orderData = gatewayPayload.data && typeof gatewayPayload.data === 'object'
                ? gatewayPayload.data
                : {};
            const statusRaw = sanitizeText(orderData.status, '', 12).toUpperCase();
            const paidAmount = pickFirstCurrencyAmount(
                orderData.total_fee,
                orderData.pay_price,
                orderData.realprice,
                orderData.order_price,
                gatewayPayload.total_fee,
                gatewayPayload.pay_price,
                gatewayPayload.realprice,
                gatewayPayload.order_price
            );
            const transactionId = pickFirstText(
                orderData.transaction_id,
                orderData.trade_no,
                orderData.pay_order_id,
                gatewayPayload.transaction_id,
                gatewayPayload.trade_no,
                gatewayPayload.pay_order_id
            ) || null;
            return {
                supported: true,
                success: gatewayErrcode === 0,
                providerOrderNo: sanitizeText(orderData.out_trade_order || providerOrderNo, '', 120) || null,
                openOrderId: sanitizeText(orderData.open_order_id || openOrderId, '', 120) || null,
                status: normalizeHupijiaoPaymentStatus(statusRaw),
                statusRaw,
                paidAmount,
                transactionId,
                message: sanitizeText(gatewayPayload.errmsg, gatewayErrcode === 0 ? 'success' : '虎皮椒查单失败', 240),
                responsePayload: gatewayPayload
            };
        },
        async refundOrder({ runtimeContext, providerOrderNo = '', openOrderId = '', reason = '' } = {}) {
            const integration = runtimeContext?.integration || normalizeHupijiaoConfig({
                channelConfig: runtimeContext?.channelConfig || {},
                secretValues: runtimeContext?.secretValues || {},
                requestOrigin: runtimeContext?.requestOrigin || ''
            });
            if (!integration?.appId || !integration?.appSecret) {
                return {
                    supported: false,
                    message: '虎皮椒退款配置不完整，请先补齐 APPID / SECRET。'
                };
            }

            const refundResult = await refundHupijiaoPayment({
                channelConfig: runtimeContext?.channelConfig || {},
                secretValues: runtimeContext?.secretValues || {},
                requestOrigin: runtimeContext?.requestOrigin || '',
                tradeOrderId: providerOrderNo,
                openOrderId,
                reason
            });
            const gatewayPayload = refundResult.response?.data || {};
            const gatewayErrcode = Number(gatewayPayload.errcode ?? 0);
            const orderData = gatewayPayload.data && typeof gatewayPayload.data === 'object'
                ? gatewayPayload.data
                : {};
            const statusRaw = sanitizeText(
                orderData.status || gatewayPayload.status,
                '',
                12
            ).toUpperCase();
            const normalizedStatus = statusRaw
                ? normalizeHupijiaoPaymentStatus(statusRaw)
                : (gatewayErrcode === 0 ? 'refunded' : 'unknown');

            return {
                supported: true,
                success: gatewayErrcode === 0,
                providerOrderNo: sanitizeText(
                    orderData.out_trade_order || gatewayPayload.trade_order_id || providerOrderNo,
                    '',
                    120
                ) || null,
                openOrderId: sanitizeText(
                    orderData.open_order_id || gatewayPayload.open_order_id || openOrderId,
                    '',
                    120
                ) || null,
                status: normalizedStatus,
                statusRaw: statusRaw || (gatewayErrcode === 0 ? 'CD' : ''),
                message: sanitizeText(gatewayPayload.errmsg, gatewayErrcode === 0 ? 'success' : '虎皮椒退款失败', 240),
                responsePayload: gatewayPayload
            };
        }
    }
};

function getPaymentProviderAdapter(providerKey) {
    return providerRegistry[providerKey] || null;
}

function listPaymentProviderAdapters() {
    return Object.values(providerRegistry);
}

module.exports = {
    PROVIDER_REGISTRY: providerRegistry,
    amountsMatch,
    getPaymentProviderAdapter,
    listPaymentProviderAdapters,
    normalizePointValue,
    roundCurrencyAmount
};
