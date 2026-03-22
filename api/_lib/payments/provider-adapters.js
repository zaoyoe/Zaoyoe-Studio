const crypto = require('crypto');
const {
    normalizeSiteValue
} = require('../site');
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
            createCheckout: false,
            webhook: false,
            queryOrder: false,
            autoCredit: false
        },
        async resolveRuntimeContext({ supabase, env = process.env, config = null } = {}) {
            const loaded = config
                ? { paymentChannels: config }
                : await loadStoredPaymentConfigs(supabase, {
                    origin: env.APP_BASE_URL,
                    afdianCheckoutUrl: env.PAYMENT_AFDIAN_URL
                });
            const secrets = await resolvePaymentProviderSecrets(supabase, 'hupijiao', env);

            return {
                provider: 'hupijiao',
                channelConfig: loaded.paymentChannels.providers.hupijiao,
                activeProvider: loaded.paymentChannels.active_provider,
                implemented: false,
                secretValues: {
                    hupijiao_api_key: secrets.hupijiao_api_key?.value || '',
                    hupijiao_secret_key: secrets.hupijiao_secret_key?.value || ''
                },
                secretMeta: secrets
            };
        },
        createCheckoutContext({ runtimeContext } = {}) {
            const channelConfig = runtimeContext?.channelConfig || {};
            return {
                supported: false,
                action: 'redirect',
                displayName: channelConfig.display_name || '虎皮椒',
                message: '虎皮椒通道尚未完成统一落单、验签回调和查单闭环，已默认禁止拉起真实支付。请先切换到爱发电或完成虎皮椒全链路接入后再启用。'
            };
        },
        verifyWebhook() {
            return {
                supported: false,
                valid: false,
                reason: 'not_implemented'
            };
        },
        queryOrder() {
            return {
                supported: false,
                message: '虎皮椒订单查询能力待接入。'
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
