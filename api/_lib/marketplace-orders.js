const {
    loadMarketplaceChannelsConfig,
    normalizeMarketplaceChannelsConfig,
    sanitizeText
} = require('./marketplace-channels');
const {
    safeSyncOrderProfitLedgerByOrderId
} = require('../../server/api-handlers/admin/shop/_profit-ledger');

function normalizeKeyPart(value, fallback = '', maxLength = 80) {
    const normalized = sanitizeText(value, maxLength).toLowerCase();
    const source = normalized || sanitizeText(fallback, maxLength).toLowerCase();
    if (!source) return '';

    return source
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/_+/g, '_')
        .replace(/^[-_]+|[-_]+$/g, '')
        .slice(0, maxLength);
}

function normalizeUuid(value) {
    const normalized = sanitizeText(value, 120);
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized)
        ? normalized
        : '';
}

function normalizeQuantity(value, fallback = 1) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(99, Math.max(1, parsed));
}

function normalizeOptionalAmount(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return null;
    }

    return Math.round(parsed * 100) / 100;
}

function normalizeSite(value) {
    const normalized = sanitizeText(value, 20).toLowerCase();
    return normalized === 'intl' ? 'intl' : 'cn';
}

function normalizeSnapshot(value) {
    if (!value || typeof value !== 'object') {
        return value == null || value === ''
            ? {}
            : { raw: value };
    }

    return Array.isArray(value) ? { raw: value } : value;
}

function resolveLocalizedUsageInstructions(product = {}, site = 'cn') {
    const usageInstructions = sanitizeText(product?.usage_instructions, 4000);
    const usageInstructionsZh = sanitizeText(product?.usage_instructions_zh, 4000);
    const usageInstructionsEn = sanitizeText(product?.usage_instructions_en, 4000);
    const usageInstructionsIntl = sanitizeText(product?.usage_instructions_intl, 4000);
    const usageInstructionsIntlZh = sanitizeText(product?.usage_instructions_intl_zh, 4000);

    if (normalizeSite(site) === 'intl') {
        const showIntl = Object.prototype.hasOwnProperty.call(product, 'show_usage_instructions_intl')
            ? product.show_usage_instructions_intl === true
            : product?.show_usage_instructions === true;
        if (!showIntl) return '';
        return usageInstructionsIntlZh || usageInstructionsIntl || usageInstructionsEn;
    }

    if (product?.show_usage_instructions !== true) return '';
    return usageInstructionsZh || usageInstructions;
}

function isMissingGuidanceColumnError(error) {
    const message = sanitizeText(error?.message, 500).toLowerCase();
    return error?.code === '42703'
        || /column .* does not exist/.test(message)
        || message.includes('could not find')
        || message.includes('schema cache');
}

async function loadMarketplaceProductUsageInstructions(supabase, productId, site = 'cn') {
    if (!supabase?.from || !normalizeUuid(productId)) {
        return {
            show_usage_instructions: false,
            usage_instructions: ''
        };
    }

    const selects = [
        'id, show_usage_instructions, show_usage_instructions_intl, usage_instructions, usage_instructions_zh, usage_instructions_en, usage_instructions_intl, usage_instructions_intl_zh',
        'id, show_usage_instructions, usage_instructions, usage_instructions_zh, usage_instructions_en',
        'id, show_usage_instructions, usage_instructions'
    ];

    for (const selectClause of selects) {
        const query = supabase
            .from('shop_products')
            .select(selectClause)
            .eq('id', productId);
        const { data, error } = await query.maybeSingle();

        if (!error) {
            const usageInstructions = resolveLocalizedUsageInstructions(data || {}, site);
            return {
                show_usage_instructions: Boolean(usageInstructions),
                usage_instructions: usageInstructions
            };
        }

        if (!isMissingGuidanceColumnError(error)) {
            return {
                show_usage_instructions: false,
                usage_instructions: ''
            };
        }
    }

    return {
        show_usage_instructions: false,
        usage_instructions: ''
    };
}

async function enrichMarketplaceOrderResultWithUsageInstructions({
    supabase,
    result = {},
    request = {}
} = {}) {
    if (result?.success !== true || !result?.data || typeof result.data !== 'object') {
        return result;
    }

    const existingUsageInstructions = sanitizeText(result.data.usage_instructions, 4000);
    if (result.data.show_usage_instructions === true && existingUsageInstructions) {
        return result;
    }

    const productId = normalizeUuid(result.data.product_id || request.product_id);
    if (!productId) return result;

    const guidance = await loadMarketplaceProductUsageInstructions(supabase, productId, result.data.site || request.site);
    if (!guidance.usage_instructions) {
        return {
            ...result,
            data: {
                ...result.data,
                show_usage_instructions: false,
                usage_instructions: null
            }
        };
    }

    return {
        ...result,
        data: {
            ...result.data,
            show_usage_instructions: true,
            usage_instructions: guidance.usage_instructions
        }
    };
}

function findMarketplaceChannel(config = {}, channelKey = '') {
    const normalizedConfig = normalizeMarketplaceChannelsConfig(config);
    const normalizedChannelKey = normalizeKeyPart(channelKey, normalizedConfig.default_channel_key || 'xianyu');
    const channel = (normalizedConfig.channels || []).find((entry) => entry.key === normalizedChannelKey);

    return {
        config: normalizedConfig,
        channel: channel || null,
        channelKey: normalizedChannelKey
    };
}

function resolveMarketplaceAccount(channel = {}, rawAccountKey = '') {
    const accounts = Array.isArray(channel.accounts) ? channel.accounts : [];
    const fallbackAccountKey = channel.default_account_key || accounts.find((account) => account.enabled)?.key || accounts[0]?.key || 'main';
    const accountKey = normalizeKeyPart(rawAccountKey, fallbackAccountKey || 'main');
    const account = accounts.find((entry) => entry.key === accountKey) || null;

    return {
        account,
        accountKey,
        hasAccountRegistry: accounts.length > 0
    };
}

function resolveMarketplaceOrderChannelContext(payload = {}, config = {}) {
    const source = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload
        : {};
    const requestedChannelKey = normalizeKeyPart(
        source.channel_key
            || source.channelKey
            || source.channel
            || source.marketplace
            || source.source_channel
            || source.sourceChannel,
        'xianyu'
    );
    const { config: normalizedConfig, channel, channelKey } = findMarketplaceChannel(config, requestedChannelKey);

    if (normalizedConfig.enabled !== true) {
        throw Object.assign(new Error('商城渠道注册表未启用'), { statusCode: 409, code: 'marketplace_channels_disabled' });
    }

    if (!channel) {
        throw Object.assign(new Error(`未找到渠道: ${channelKey}`), { statusCode: 404, code: 'marketplace_channel_not_found' });
    }

    if (channel.enabled !== true) {
        throw Object.assign(new Error(`渠道未启用: ${channelKey}`), { statusCode: 409, code: 'marketplace_channel_disabled' });
    }

    if (!['shared', 'hybrid'].includes(channel.inventory_mode)) {
        throw Object.assign(new Error(`渠道未配置共享库存: ${channelKey}`), { statusCode: 409, code: 'marketplace_channel_not_shared' });
    }

    const { account, accountKey, hasAccountRegistry } = resolveMarketplaceAccount(
        channel,
        source.channel_account_key
            || source.channelAccountKey
            || source.account_key
            || source.accountKey
            || source.account
    );

    if (hasAccountRegistry && !account) {
        throw Object.assign(new Error(`未找到渠道账号: ${channelKey}/${accountKey}`), { statusCode: 404, code: 'marketplace_account_not_found' });
    }

    if (account && account.enabled !== true) {
        throw Object.assign(new Error(`渠道账号未启用: ${channelKey}/${accountKey}`), { statusCode: 409, code: 'marketplace_account_disabled' });
    }

    return {
        config: normalizedConfig,
        channel,
        channelKey,
        account,
        accountKey,
        hasAccountRegistry
    };
}

function buildMarketplaceOrderRpcParams(payload = {}, config = {}) {
    const source = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload
        : {};
    const productId = normalizeUuid(source.product_id || source.productId);
    const productSkuId = normalizeUuid(
        source.product_sku_id
            || source.productSkuId
            || source.website_sku_id
            || source.websiteSkuId
            || source.shop_sku_id
            || source.shopSkuId
    );
    const {
        channel,
        channelKey,
        accountKey
    } = resolveMarketplaceOrderChannelContext(source, config);

    const externalOrderId = sanitizeText(
        source.external_order_id
            || source.externalOrderId
            || source.order_id
            || source.orderId
            || source.trade_id
            || source.tradeId,
        180
    );

    if (!productId) {
        throw Object.assign(new Error('product_id is required'), { statusCode: 400, code: 'marketplace_product_id_required' });
    }

    if (!externalOrderId) {
        throw Object.assign(new Error('external_order_id is required'), { statusCode: 400, code: 'marketplace_external_order_id_required' });
    }

    const snapshot = normalizeSnapshot(
        source.external_order_snapshot
            || source.externalOrderSnapshot
            || source.snapshot
            || source.raw
            || source
    );
    const sourceChannel = normalizeKeyPart(source.source_channel || source.sourceChannel, channel.source_channel || channel.key);
    const quantity = normalizeQuantity(source.quantity || source.qty || source.count, 1);

    return {
        normalized: {
            product_id: productId,
            product_sku_id: productSkuId || null,
            quantity,
            channel_key: channelKey,
            source_channel: sourceChannel,
            channel_account_key: accountKey,
            external_order_id: externalOrderId,
            external_order_snapshot: snapshot,
            site: normalizeSite(source.site),
            user_id: normalizeUuid(source.user_id || source.userId || source.local_user_id || source.localUserId) || null,
            price_paid: normalizeOptionalAmount(source.price_paid || source.pricePaid || source.amount_paid || source.amountPaid),
            total_price: normalizeOptionalAmount(source.total_price || source.totalPrice || source.gross_amount || source.grossAmount),
            external_buyer_id: sanitizeText(source.external_buyer_id || source.externalBuyerId || source.buyer_id || source.buyerId, 180),
            external_buyer_name: sanitizeText(source.external_buyer_name || source.externalBuyerName || source.buyer_name || source.buyerName || source.buyerNick, 180)
        },
        rpcParams: {
            p_product_id: productId,
            p_quantity: quantity,
            p_source_channel: sourceChannel,
            p_channel_account_key: accountKey,
            p_external_order_id: externalOrderId,
            p_external_order_snapshot: snapshot,
            p_site: normalizeSite(source.site),
            p_user_id: normalizeUuid(source.user_id || source.userId || source.local_user_id || source.localUserId) || null,
            p_price_paid: normalizeOptionalAmount(source.price_paid || source.pricePaid || source.amount_paid || source.amountPaid),
            p_total_price: normalizeOptionalAmount(source.total_price || source.totalPrice || source.gross_amount || source.grossAmount),
            p_external_buyer_id: sanitizeText(source.external_buyer_id || source.externalBuyerId || source.buyer_id || source.buyerId, 180),
            p_external_buyer_name: sanitizeText(source.external_buyer_name || source.externalBuyerName || source.buyer_name || source.buyerName || source.buyerNick, 180),
            p_sku_id: productSkuId || null
        }
    };
}

async function createMarketplaceShopOrder({
    supabase,
    payload = {},
    config = null,
    env = process.env
} = {}) {
    if (!supabase?.rpc) {
        throw Object.assign(new Error('Marketplace order service is unavailable'), { statusCode: 503, code: 'marketplace_order_service_unavailable' });
    }

    const runtimeConfig = config || await loadMarketplaceChannelsConfig(supabase, env);
    const { normalized, rpcParams } = buildMarketplaceOrderRpcParams(payload, runtimeConfig);
    const { data, error } = await supabase.rpc('fn_create_marketplace_shop_order', rpcParams);

    if (error) {
        throw Object.assign(new Error(error.message || 'Marketplace order RPC failed'), {
            statusCode: Number(error.statusCode || error.status) || 500,
            code: error.code || 'marketplace_order_rpc_failed'
        });
    }

    const result = await enrichMarketplaceOrderResultWithUsageInstructions({
        supabase,
        result: data || {
            success: false,
            message: 'Marketplace order RPC returned no data'
        },
        request: normalized
    });

    if (result?.success === true && result?.data?.order_id && supabase?.from) {
        await safeSyncOrderProfitLedgerByOrderId(supabase, result.data.order_id, {
            userId: normalized.user_id || null,
            reason: 'marketplace_order_success'
        });
    }

    return {
        request: normalized,
        result
    };
}

module.exports = {
    buildMarketplaceOrderRpcParams,
    createMarketplaceShopOrder,
    enrichMarketplaceOrderResultWithUsageInstructions,
    findMarketplaceChannel,
    loadMarketplaceProductUsageInstructions,
    normalizeKeyPart,
    normalizeOptionalAmount,
    normalizeQuantity,
    normalizeSite,
    normalizeUuid,
    resolveLocalizedUsageInstructions,
    resolveMarketplaceAccount,
    resolveMarketplaceOrderChannelContext
};
