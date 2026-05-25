const {
    deleteStoredAdminSecret,
    getStoredAdminSecret,
    upsertStoredAdminSecret
} = require('./secrets');

const MARKETPLACE_SECRET_NAMESPACE = 'marketplace';
const DEFAULT_MARKETPLACE_CHANNELS_CONFIG = Object.freeze({
    enabled: true,
    default_channel_key: 'website',
    inventory_mode: 'shared',
    channels: [
        {
            key: 'website',
            type: 'website',
            label: '网站',
            enabled: true,
            inventory_mode: 'shared',
            delivery_mode: 'manual',
            source_channel: 'website',
            default_account_key: '',
            multi_account: false,
            notes: '',
            accounts: []
        },
        {
            key: 'xianyu',
            type: 'xianyu',
            label: '闲鱼',
            enabled: false,
            inventory_mode: 'shared',
            delivery_mode: 'auto',
            source_channel: 'xianyu',
            default_account_key: 'main',
                multi_account: true,
                notes: '',
                product_mappings: [],
                accounts: [
                    {
                        key: 'main',
                    label: '主号',
                    enabled: true,
                    role: 'primary',
                    notes: '',
                    secret_names: ['session_cookie', 'refresh_token', 'ingest_token']
                }
            ]
        }
    ]
});

function sanitizeText(value, maxLength = 160) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeBoolean(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    const normalized = sanitizeText(value).toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
    return fallback;
}

function normalizeKeyPart(value, fallback = '', maxLength = 80) {
    const normalized = sanitizeText(value, maxLength).toLowerCase();
    if (!normalized) {
        return sanitizeText(fallback, maxLength).toLowerCase();
    }

    return normalized
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/_+/g, '_')
        .replace(/^[-_]+|[-_]+$/g, '')
        .slice(0, maxLength);
}

function toTitleCaseLabel(value) {
    const normalized = sanitizeText(value, 120);
    if (!normalized) return '';

    return normalized
        .split(/[-_\s]+/g)
        .filter(Boolean)
        .map((chunk) => `${chunk.charAt(0).toUpperCase()}${chunk.slice(1)}`)
        .join(' ');
}

function normalizeInventoryMode(value, fallback = 'shared') {
    const normalized = normalizeKeyPart(value, fallback, 40);
    const allowed = new Set(['shared', 'dedicated', 'hybrid']);
    return allowed.has(normalized) ? normalized : fallback;
}

function normalizeDeliveryMode(value, fallback = 'manual') {
    const normalized = normalizeKeyPart(value, fallback, 40);
    const allowed = new Set(['manual', 'auto', 'hybrid', 'disabled']);
    return allowed.has(normalized) ? normalized : fallback;
}

function normalizeSecretNames(value) {
    const rawEntries = Array.isArray(value)
        ? value
        : (value && typeof value === 'object'
            ? Object.keys(value)
            : (value ? [value] : []));

    return [...new Set(
        rawEntries
            .map((entry) => normalizeKeyPart(entry, '', 80))
            .filter(Boolean)
    )];
}

function normalizeMarketplaceProductMappings(value) {
    const rawEntries = Array.isArray(value)
        ? value
        : (value && typeof value === 'object'
            ? Object.entries(value).map(([xianyuItemId, productId]) => ({
                xianyu_item_id: xianyuItemId,
                product_id: productId
            }))
            : []);

    return rawEntries
        .map((entry, index) => {
            const source = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {};
            const xianyuItemId = sanitizeText(
                source.xianyu_item_id
                    || source.xianyuItemId
                    || source.item_id
                    || source.itemId,
                180
            );
            const productId = sanitizeText(
                source.product_id
                    || source.productId
                    || source.website_product_id
                    || source.websiteProductId,
                160
            );
            const productSkuId = sanitizeText(
                source.product_sku_id
                    || source.productSkuId
                    || source.website_sku_id
                    || source.websiteSkuId
                    || source.shop_sku_id
                    || source.shopSkuId,
                160
            );
            const skuId = sanitizeText(source.sku_id || source.skuId, 180);
            const skuTextContains = sanitizeText(source.sku_text_contains || source.skuTextContains, 500);
            const titleContains = sanitizeText(source.title_contains || source.titleContains, 500);
            const rawPath = sanitizeText(source.raw_path || source.rawPath, 200);
            const rawEquals = sanitizeText(source.equals ?? source.value, 500);
            const hasMatcher = Boolean(xianyuItemId || skuId || skuTextContains || titleContains || (rawPath && rawEquals));

            if (!productId && !hasMatcher) {
                return null;
            }

            return {
                label: sanitizeText(source.label || source.name || (xianyuItemId ? `闲鱼商品 ${xianyuItemId}` : `商品映射 ${index + 1}`), 120),
                enabled: normalizeBoolean(source.enabled, true),
                xianyu_item_id: xianyuItemId,
                sku_id: skuId,
                sku_text_contains: skuTextContains,
                title_contains: titleContains,
                raw_path: rawPath,
                equals: rawEquals,
                product_id: productId,
                product_sku_id: productSkuId,
                notes: sanitizeText(source.notes || source.description, 500)
            };
        })
        .filter(Boolean);
}

function cloneDefaultMarketplaceChannels() {
    return DEFAULT_MARKETPLACE_CHANNELS_CONFIG.channels.map((channel) => ({
        ...channel,
        accounts: Array.isArray(channel.accounts)
            ? channel.accounts.map((account) => ({
                ...account,
                secret_names: Array.isArray(account.secret_names) ? [...account.secret_names] : [],
                secret_keys: account.secret_keys && typeof account.secret_keys === 'object'
                    ? { ...account.secret_keys }
                    : {}
            }))
            : []
    }));
}

function buildMarketplaceSecretKey(channelKey, accountKey, secretName) {
    const parts = [
        MARKETPLACE_SECRET_NAMESPACE,
        normalizeKeyPart(channelKey, '', 80),
        normalizeKeyPart(accountKey, '', 80),
        normalizeKeyPart(secretName, '', 80)
    ].filter(Boolean);

    if (parts.length !== 4) {
        return '';
    }

    return parts.join('__');
}

function parseMarketplaceSecretKey(secretKey = '') {
    const parts = String(secretKey || '').trim().toLowerCase().split('__');
    if (parts.length < 4 || parts[0] !== MARKETPLACE_SECRET_NAMESPACE) {
        return null;
    }

    const [namespace, channelKey, accountKey, ...rest] = parts;
    const secretName = rest.join('__');
    if (!namespace || !channelKey || !accountKey || !secretName) {
        return null;
    }

    return {
        channel_key: channelKey,
        account_key: accountKey,
        secret_name: secretName
    };
}

function normalizeMarketplaceAccountConfig(raw = {}, channelKey = '', index = 0) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const key = normalizeKeyPart(source.key || source.account_key, `account-${index + 1}`, 80);
    const label = sanitizeText(source.label || source.display_name || source.displayName || source.name, 80)
        || toTitleCaseLabel(key)
        || `账号 ${index + 1}`;
    const secretNames = normalizeSecretNames(
        source.secret_names
        || source.secretNames
        || source.secrets
        || source.secret_keys
    );
    const secretKeys = secretNames.reduce((accumulator, secretName) => {
        const secretKey = buildMarketplaceSecretKey(channelKey, key, secretName);
        if (secretKey) {
            accumulator[secretName] = secretKey;
        }
        return accumulator;
    }, {});

    return {
        key,
        label,
        enabled: normalizeBoolean(source.enabled, true),
        role: normalizeKeyPart(source.role, index === 0 ? 'primary' : 'backup', 40) || 'normal',
        notes: sanitizeText(source.notes || source.description, 1000),
        secret_names: secretNames,
        secret_keys: secretKeys
    };
}

function normalizeMarketplaceChannelConfig(raw = {}, index = 0) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const type = normalizeKeyPart(source.type || source.kind || source.channel_type || source.key, 'generic', 80);
    const key = normalizeKeyPart(source.key || type, `channel-${index + 1}`, 80);
    const label = sanitizeText(source.label || source.display_name || source.displayName || source.name, 80)
        || toTitleCaseLabel(key)
        || `渠道 ${index + 1}`;
    const accountsSource = Array.isArray(source.accounts)
        ? source.accounts
        : (source.accounts && typeof source.accounts === 'object'
            ? Object.entries(source.accounts).map(([accountKey, accountValue]) => ({
                key: accountKey,
                ...(accountValue && typeof accountValue === 'object' && !Array.isArray(accountValue)
                    ? accountValue
                    : { label: accountValue })
            }))
            : []);
    const accounts = accountsSource.map((account, accountIndex) => normalizeMarketplaceAccountConfig(account, key, accountIndex));
    const defaultAccountKey = normalizeKeyPart(
        source.default_account_key || source.defaultAccountKey,
        '',
        80
    ) || accounts.find((account) => account.enabled)?.key || accounts[0]?.key || '';

    return {
        key,
        type,
        label,
        enabled: normalizeBoolean(source.enabled, true),
        inventory_mode: normalizeInventoryMode(source.inventory_mode || source.inventoryMode, 'shared'),
        delivery_mode: normalizeDeliveryMode(source.delivery_mode || source.deliveryMode, type === 'xianyu' ? 'auto' : 'manual'),
        source_channel: normalizeKeyPart(source.source_channel || source.sourceChannel, key, 80) || key,
        default_account_key: defaultAccountKey,
        multi_account: normalizeBoolean(source.multi_account || source.multiAccount, accounts.length > 1),
        notes: sanitizeText(source.notes || source.description, 1000),
        product_mappings: normalizeMarketplaceProductMappings(
            source.product_mappings
            || source.productMappings
            || source.products
            || source.product_map
            || source.productMap
        ),
        accounts
    };
}

function normalizeMarketplaceChannelCollection(rawChannels = []) {
    if (rawChannels == null) {
        return cloneDefaultMarketplaceChannels().map((channel, index) => normalizeMarketplaceChannelConfig(channel, index));
    }

    const sourceChannels = Array.isArray(rawChannels)
        ? rawChannels
        : (rawChannels && typeof rawChannels === 'object'
            ? Object.entries(rawChannels).map(([channelKey, channelValue]) => ({
                key: channelKey,
                ...(channelValue && typeof channelValue === 'object' && !Array.isArray(channelValue)
                    ? channelValue
                    : { label: channelValue })
            }))
            : []);

    const normalizedByKey = new Map();

    cloneDefaultMarketplaceChannels().map((channel, index) => normalizeMarketplaceChannelConfig(channel, index)).forEach((channel) => {
        if (channel.key) {
            normalizedByKey.set(channel.key, channel);
        }
    });

    sourceChannels.map((channel, index) => normalizeMarketplaceChannelConfig(channel, index)).forEach((channel) => {
        if (channel.key) {
            normalizedByKey.set(channel.key, channel);
        }
    });

    return [...normalizedByKey.values()];
}

function normalizeMarketplaceChannelsConfig(raw = {}, env = process.env) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const channels = normalizeMarketplaceChannelCollection(source.channels);
    const defaultChannelKey = normalizeKeyPart(
        source.default_channel_key || source.defaultChannelKey,
        DEFAULT_MARKETPLACE_CHANNELS_CONFIG.default_channel_key || channels[0]?.key || 'website',
        80
    );

    return {
        enabled: normalizeBoolean(source.enabled, true),
        default_channel_key: defaultChannelKey,
        inventory_mode: normalizeInventoryMode(source.inventory_mode || source.inventoryMode, 'shared'),
        channels
    };
}

function buildMarketplaceChannelManifest(config = {}) {
    const normalized = normalizeMarketplaceChannelsConfig(config);
    const manifest = [];

    normalized.channels.forEach((channel) => {
        (Array.isArray(channel.accounts) ? channel.accounts : []).forEach((account) => {
            (Array.isArray(account.secret_names) ? account.secret_names : []).forEach((secretName) => {
                const secretKey = buildMarketplaceSecretKey(channel.key, account.key, secretName);
                if (!secretKey) return;

                manifest.push({
                    secret_key: secretKey,
                    channel_key: channel.key,
                    channel_label: channel.label,
                    channel_type: channel.type,
                    channel_enabled: channel.enabled === true,
                    account_key: account.key,
                    account_label: account.label,
                    account_enabled: account.enabled === true,
                    secret_name: secretName,
                    secret_label: toTitleCaseLabel(secretName) || secretName
                });
            });
        });
    });

    return manifest;
}

function buildMarketplaceReadinessItem(status = 'ok', code = '', message = '', details = {}) {
    return {
        status,
        code: sanitizeText(code, 120),
        message: sanitizeText(message, 500),
        details: details && typeof details === 'object' && !Array.isArray(details) ? details : {}
    };
}

function getMarketplaceReadinessStatus(items = []) {
    const statuses = new Set((Array.isArray(items) ? items : []).map((item) => item?.status).filter(Boolean));
    if (statuses.has('error')) return 'error';
    if (statuses.has('warning')) return 'warning';
    return 'ok';
}

function validateXianyuMarketplaceReadiness(config = {}, secretStatus = {}) {
    const normalized = normalizeMarketplaceChannelsConfig(config);
    const items = [];
    const xianyu = (normalized.channels || []).find((channel) => channel.key === 'xianyu' || channel.type === 'xianyu') || null;

    if (normalized.enabled !== true) {
        items.push(buildMarketplaceReadinessItem('error', 'marketplace_disabled', '商城渠道总开关未启用。'));
    }
    if (!xianyu) {
        items.push(buildMarketplaceReadinessItem('error', 'xianyu_channel_missing', '未找到闲鱼渠道配置。'));
        return {
            status: getMarketplaceReadinessStatus(items),
            items,
            counts: { ok: 0, warning: 0, error: items.length }
        };
    }
    if (xianyu.enabled !== true) {
        items.push(buildMarketplaceReadinessItem('warning', 'xianyu_disabled', '闲鱼自动发货未启用，保存后不会处理闲鱼订单。'));
    }
    if (!['shared', 'hybrid'].includes(xianyu.inventory_mode)) {
        items.push(buildMarketplaceReadinessItem('error', 'xianyu_inventory_not_shared', '闲鱼渠道必须使用共享网站库存。'));
    }
    if (!['auto', 'hybrid'].includes(xianyu.delivery_mode)) {
        items.push(buildMarketplaceReadinessItem('error', 'xianyu_delivery_not_auto', '闲鱼渠道必须启用自动发货模式。'));
    }

    const accounts = Array.isArray(xianyu.accounts) ? xianyu.accounts : [];
    const enabledAccounts = accounts.filter((account) => account.enabled !== false);
    const accountKeys = new Set();
    const duplicateAccountKeys = new Set();
    accounts.forEach((account) => {
        const accountKey = normalizeKeyPart(account.key, '', 80);
        if (!accountKey) {
            items.push(buildMarketplaceReadinessItem('error', 'xianyu_account_key_missing', '存在未填写识别名的闲鱼账号。'));
            return;
        }
        if (accountKeys.has(accountKey)) duplicateAccountKeys.add(accountKey);
        accountKeys.add(accountKey);
    });
    duplicateAccountKeys.forEach((accountKey) => {
        items.push(buildMarketplaceReadinessItem('error', 'xianyu_account_key_duplicate', `闲鱼账号识别名重复：${accountKey}`, { account_key: accountKey }));
    });

    if (!accounts.length) {
        items.push(buildMarketplaceReadinessItem('error', 'xianyu_account_missing', '至少需要配置 1 个闲鱼账号。'));
    }
    if (!enabledAccounts.length) {
        items.push(buildMarketplaceReadinessItem('error', 'xianyu_enabled_account_missing', '至少需要启用 1 个闲鱼账号。'));
    }
    if (!accounts.some((account) => account.key === xianyu.default_account_key)) {
        items.push(buildMarketplaceReadinessItem('error', 'xianyu_default_account_missing', '默认发货账号不在账号列表中。'));
    }

    enabledAccounts.forEach((account) => {
        const secretKey = buildMarketplaceSecretKey('xianyu', account.key, 'ingest_token');
        const status = secretStatus?.[secretKey];
        if (status?.decrypt_error_message || status?.error) {
            items.push(buildMarketplaceReadinessItem('error', 'xianyu_ingest_token_unavailable', `${account.label || account.key} 的发货密钥无法读取。`, {
                account_key: account.key,
                secret_key: secretKey
            }));
            return;
        }
        if (status && status.configured !== true) {
            items.push(buildMarketplaceReadinessItem('error', 'xianyu_ingest_token_missing', `${account.label || account.key} 还没有配置发货接口密钥。`, {
                account_key: account.key,
                secret_key: secretKey
            }));
        }
    });

    const mappings = Array.isArray(xianyu.product_mappings) ? xianyu.product_mappings : [];
    const enabledMappings = mappings.filter((mapping) => mapping.enabled !== false);
    if (!enabledMappings.length) {
        items.push(buildMarketplaceReadinessItem('error', 'xianyu_mapping_missing', '至少需要启用 1 条商品发货规则。'));
    }

    const itemToProducts = new Map();
    enabledMappings.forEach((mapping, index) => {
        const label = sanitizeText(mapping.label || `发货规则 ${index + 1}`, 120);
        const itemId = sanitizeText(mapping.xianyu_item_id, 180);
        const productId = sanitizeText(mapping.product_id, 160);
        const matcher = [
            itemId,
            sanitizeText(mapping.sku_id, 180),
            sanitizeText(mapping.sku_text_contains, 500),
            sanitizeText(mapping.title_contains, 500),
            sanitizeText(mapping.raw_path, 200) && sanitizeText(mapping.equals, 500)
        ].some(Boolean);

        if (!matcher) {
            items.push(buildMarketplaceReadinessItem('error', 'xianyu_mapping_matcher_missing', `${label} 没有填写闲鱼商品编号或规格匹配条件。`, { index }));
        }
        if (!productId) {
            items.push(buildMarketplaceReadinessItem('error', 'xianyu_mapping_product_missing', `${label} 没有绑定网站商品。`, { index }));
        }
        if (itemId && productId) {
            const productSet = itemToProducts.get(itemId) || new Set();
            productSet.add(productId);
            itemToProducts.set(itemId, productSet);
        }
    });
    itemToProducts.forEach((productSet, itemId) => {
        if (productSet.size > 1) {
            items.push(buildMarketplaceReadinessItem('warning', 'xianyu_mapping_item_multiple_products', `闲鱼商品 ${itemId} 绑定了多个网站商品，请确认是否应改为同一商品下的多规格映射。`, {
                xianyu_item_id: itemId,
                product_ids: [...productSet]
            }));
        }
    });

    if (!items.length) {
        items.push(buildMarketplaceReadinessItem('ok', 'xianyu_ready', '闲鱼自动发货配置已具备试运行条件。'));
    }

    const counts = items.reduce((accumulator, item) => {
        const status = item.status || 'ok';
        accumulator[status] = (accumulator[status] || 0) + 1;
        return accumulator;
    }, { ok: 0, warning: 0, error: 0 });

    return {
        status: getMarketplaceReadinessStatus(items),
        items,
        counts
    };
}

async function loadMarketplaceChannelSecretStatus(supabase, config = {}) {
    const manifest = buildMarketplaceChannelManifest(config);
    const statusBySecretKey = {};

    await Promise.all(manifest.map(async (entry) => {
        try {
            const storedSecret = await getStoredAdminSecret(supabase, entry.secret_key, {
                allowDecryptFailure: true
            });

            statusBySecretKey[entry.secret_key] = {
                secret_key: entry.secret_key,
                channel_key: entry.channel_key,
                channel_label: entry.channel_label,
                channel_type: entry.channel_type,
                account_key: entry.account_key,
                account_label: entry.account_label,
                secret_name: entry.secret_name,
                secret_label: entry.secret_label,
                configured: Boolean(storedSecret?.value),
                updated_at: storedSecret?.updated_at || null,
                description: storedSecret?.description || null,
                metadata: storedSecret?.metadata || null,
                decrypt_error_message: storedSecret?.decryptErrorMessage || '',
                source: storedSecret?.value ? 'stored' : 'missing'
            };
        } catch (error) {
            statusBySecretKey[entry.secret_key] = {
                secret_key: entry.secret_key,
                channel_key: entry.channel_key,
                channel_label: entry.channel_label,
                channel_type: entry.channel_type,
                account_key: entry.account_key,
                account_label: entry.account_label,
                secret_name: entry.secret_name,
                secret_label: entry.secret_label,
                configured: false,
                error: sanitizeText(error?.message, 200) || 'Failed to load secret',
                source: 'error'
            };
        }
    }));

    return statusBySecretKey;
}

async function loadMarketplaceChannelsConfig(supabase, env = process.env) {
    if (!supabase) {
        return normalizeMarketplaceChannelsConfig(DEFAULT_MARKETPLACE_CHANNELS_CONFIG, env);
    }

    const { data, error } = await supabase
        .from('system_config')
        .select('config_value')
        .eq('config_key', 'marketplace_channels')
        .maybeSingle();

    if (error) {
        throw new Error(error.message || 'Failed to load marketplace channels config');
    }

    return normalizeMarketplaceChannelsConfig(data?.config_value || DEFAULT_MARKETPLACE_CHANNELS_CONFIG, env);
}

async function upsertMarketplaceChannelsConfig(supabase, config, adminId) {
    const normalized = normalizeMarketplaceChannelsConfig(config);
    const { error } = await supabase
        .from('system_config')
        .upsert({
            config_key: 'marketplace_channels',
            config_value: normalized,
            description: '商城渠道注册表',
            updated_by: adminId,
            updated_at: new Date().toISOString()
        }, { onConflict: 'config_key' });

    if (error) {
        throw new Error(error.message || 'Failed to save marketplace channels config');
    }

    return normalized;
}

async function upsertMarketplaceChannelSecret({
    supabase,
    channelKey,
    accountKey,
    secretName,
    secretValue,
    adminId,
    description = '',
    metadata = {}
}) {
    const secretKey = buildMarketplaceSecretKey(channelKey, accountKey, secretName);
    if (!secretKey) {
        throw new Error('Invalid marketplace secret key');
    }

    await upsertStoredAdminSecret({
        supabase,
        secretKey,
        secretValue,
        adminId,
        description: description || `Marketplace secret: ${secretName}`,
        metadata: {
            marketplace_channel_key: normalizeKeyPart(channelKey, '', 80),
            marketplace_account_key: normalizeKeyPart(accountKey, '', 80),
            marketplace_secret_name: normalizeKeyPart(secretName, '', 80),
            saved_via: 'admin_marketplace_channels',
            ...metadata
        }
    });

    return secretKey;
}

async function deleteMarketplaceChannelSecret(supabase, secretKey) {
    const normalizedSecretKey = String(secretKey || '').trim().toLowerCase();
    if (!parseMarketplaceSecretKey(normalizedSecretKey)) {
        throw new Error('Invalid marketplace secret key');
    }

    await deleteStoredAdminSecret(supabase, normalizedSecretKey);
}

module.exports = {
    DEFAULT_MARKETPLACE_CHANNELS_CONFIG,
    MARKETPLACE_SECRET_NAMESPACE,
    buildMarketplaceChannelManifest,
    buildMarketplaceChannelSecretKey: buildMarketplaceSecretKey,
    buildMarketplaceSecretKey,
    deleteMarketplaceChannelSecret,
    loadMarketplaceChannelSecretStatus,
    loadMarketplaceChannelsConfig,
    normalizeMarketplaceAccountConfig,
    normalizeMarketplaceChannelCollection,
    normalizeMarketplaceChannelConfig,
    normalizeMarketplaceChannelsConfig,
    normalizeMarketplaceProductMappings,
    normalizeSecretNames,
    parseMarketplaceSecretKey,
    sanitizeText,
    upsertMarketplaceChannelSecret,
    upsertMarketplaceChannelsConfig,
    validateXianyuMarketplaceReadiness
};
