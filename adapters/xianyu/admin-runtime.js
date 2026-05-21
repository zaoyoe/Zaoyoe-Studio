const {
    getSupabaseAdmin
} = require('../../api/_lib/admin');
const {
    buildMarketplaceSecretKey,
    loadMarketplaceChannelsConfig,
    normalizeMarketplaceChannelsConfig
} = require('../../api/_lib/marketplace-channels');
const {
    getStoredAdminSecret
} = require('../../api/_lib/secrets');
const {
    DEFAULT_INGEST_TOKEN_ENV,
    normalizeBaseUrl
} = require('./core');

function sanitizeText(value, maxLength = 500) {
    if (value === null || value === undefined) return '';
    return String(value).trim().slice(0, Math.max(0, maxLength));
}

function normalizeKey(value, fallback = '') {
    const source = sanitizeText(value || fallback, 80).toLowerCase();
    return source
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/_+/g, '_')
        .replace(/^[-_]+|[-_]+$/g, '');
}

function resolveWebsiteBaseUrl(options = {}, env = process.env) {
    return normalizeBaseUrl(
        options.website_base_url
        || options.websiteBaseUrl
        || options.base_url
        || options.baseUrl
        || env.XIANYU_WEBSITE_BASE_URL
        || env.MARKETPLACE_WEBSITE_BASE_URL
        || env.MARKETPLACE_INGEST_BASE_URL
        || env.APP_BASE_URL
        || env.PAYMENT_SMOKE_BASE_URL
        || ''
    );
}

function findXianyuChannel(config = {}) {
    return (Array.isArray(config.channels) ? config.channels : [])
        .find((channel) => channel?.key === 'xianyu' || channel?.type === 'xianyu') || null;
}

function resolveXianyuAccount(channel = {}, accountKey = '') {
    const accounts = Array.isArray(channel.accounts) ? channel.accounts : [];
    const requestedKey = normalizeKey(accountKey, '');
    const fallbackKey = normalizeKey(
        channel.default_account_key
        || accounts.find((account) => account?.enabled !== false)?.key
        || accounts[0]?.key
        || 'main',
        'main'
    );
    const resolvedKey = requestedKey || fallbackKey;
    const account = accounts.find((entry) => normalizeKey(entry?.key, '') === resolvedKey) || null;

    if (!account) {
        throw Object.assign(new Error(`Admin Studio 中未找到闲鱼账号: ${resolvedKey}`), {
            code: 'xianyu_admin_account_not_found'
        });
    }

    if (account.enabled === false) {
        throw Object.assign(new Error(`Admin Studio 中闲鱼账号已停用: ${resolvedKey}`), {
            code: 'xianyu_admin_account_disabled'
        });
    }

    return {
        account,
        accountKey: resolvedKey
    };
}

function buildXianyuAdapterConfigFromAdmin({
    marketplaceConfig = {},
    accountKey = '',
    websiteBaseUrl = '',
    site = '',
    ingestToken = '',
    dryRun
} = {}) {
    const normalizedConfig = normalizeMarketplaceChannelsConfig(marketplaceConfig);
    if (normalizedConfig.enabled !== true) {
        throw Object.assign(new Error('Admin Studio 中商城渠道总开关未启用'), {
            code: 'xianyu_admin_marketplace_disabled'
        });
    }

    const channel = findXianyuChannel(normalizedConfig);
    if (!channel) {
        throw Object.assign(new Error('Admin Studio 中未找到闲鱼渠道'), {
            code: 'xianyu_admin_channel_not_found'
        });
    }
    if (channel.enabled !== true) {
        throw Object.assign(new Error('Admin Studio 中闲鱼自动发货未启用'), {
            code: 'xianyu_admin_channel_disabled'
        });
    }

    const { account, accountKey: resolvedAccountKey } = resolveXianyuAccount(channel, accountKey);
    const productMappings = Array.isArray(channel.product_mappings) ? channel.product_mappings : [];

    return {
        website_base_url: normalizeBaseUrl(websiteBaseUrl),
        channel: 'xianyu',
        account: resolvedAccountKey,
        account_label: sanitizeText(account.label || account.name || resolvedAccountKey, 120),
        site: sanitizeText(site || 'cn', 20).toLowerCase() === 'intl' ? 'intl' : 'cn',
        dry_run: dryRun !== false,
        ingest_token_env: DEFAULT_INGEST_TOKEN_ENV,
        ingest_token: sanitizeText(ingestToken, 4000),
        product_mappings: productMappings
    };
}

async function loadXianyuIngestToken({
    supabase,
    accountKey = '',
    getStoredSecret = getStoredAdminSecret
} = {}) {
    const secretKey = buildMarketplaceSecretKey('xianyu', accountKey, 'ingest_token');
    const storedSecret = await getStoredSecret(supabase, secretKey, {
        allowDecryptFailure: true
    });

    if (storedSecret?.decryptErrorMessage) {
        throw Object.assign(new Error(storedSecret.decryptErrorMessage), {
            code: 'xianyu_admin_ingest_token_decrypt_failed'
        });
    }
    if (!storedSecret?.value) {
        throw Object.assign(new Error(`Admin Studio 中账号 ${accountKey} 还没有发货接口 Token`), {
            code: 'xianyu_admin_ingest_token_missing'
        });
    }

    return storedSecret.value;
}

async function loadXianyuAdminAdapterConfig({
    accountKey = '',
    websiteBaseUrl = '',
    site = '',
    dryRun,
    includeSecret = false,
    env = process.env,
    supabase,
    loadMarketplaceConfig = loadMarketplaceChannelsConfig,
    getStoredSecret = getStoredAdminSecret
} = {}) {
    const resolvedSupabase = supabase || getSupabaseAdmin();
    const marketplaceConfig = await loadMarketplaceConfig(resolvedSupabase, env);
    const baseConfig = buildXianyuAdapterConfigFromAdmin({
        marketplaceConfig,
        accountKey,
        websiteBaseUrl: websiteBaseUrl || resolveWebsiteBaseUrl({}, env),
        site,
        dryRun
    });

    if (!includeSecret) {
        return baseConfig;
    }

    const ingestToken = await loadXianyuIngestToken({
        supabase: resolvedSupabase,
        accountKey: baseConfig.account,
        getStoredSecret
    });

    return {
        ...baseConfig,
        ingest_token: ingestToken
    };
}

module.exports = {
    buildXianyuAdapterConfigFromAdmin,
    loadXianyuAdminAdapterConfig,
    loadXianyuIngestToken,
    resolveWebsiteBaseUrl,
    resolveXianyuAccount
};
