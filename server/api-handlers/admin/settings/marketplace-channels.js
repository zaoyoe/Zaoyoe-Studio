const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    buildMarketplaceChannelManifest,
    buildMarketplaceChannelSecretKey,
    deleteMarketplaceChannelSecret,
    loadMarketplaceChannelSecretStatus,
    loadMarketplaceChannelsConfig,
    parseMarketplaceSecretKey,
    normalizeMarketplaceChannelsConfig,
    upsertMarketplaceChannelSecret,
    upsertMarketplaceChannelsConfig
} = require('../../../../api/_lib/marketplace-channels');
const {
    sanitizeText
} = require('../../../../api/_lib/marketplace-channels');

function getSearchParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

function normalizeSecretEntries(rawSecrets = {}) {
    if (!rawSecrets || typeof rawSecrets !== 'object' || Array.isArray(rawSecrets)) {
        return [];
    }

    return Object.entries(rawSecrets)
        .map(([secretKey, secretValue]) => ({
            secretKey: sanitizeText(secretKey, 200),
            secretValue: sanitizeText(secretValue, 4000)
        }))
        .filter((entry) => entry.secretKey && entry.secretValue);
}

async function loadRuntimeSnapshot(supabase, rawConfig = {}) {
    const config = normalizeMarketplaceChannelsConfig(rawConfig);
    const manifest = buildMarketplaceChannelManifest(config);
    const secretStatus = await loadMarketplaceChannelSecretStatus(supabase, config).catch((error) => {
        return {
            __error__: {
                error: sanitizeText(error?.message, 200) || 'Failed to load marketplace secrets'
            }
        };
    });

    return {
        config,
        manifest,
        secret_status: secretStatus
    };
}

function buildSummary(config = {}, manifest = [], secretStatus = {}) {
    const normalized = normalizeMarketplaceChannelsConfig(config);
    const channelCount = Array.isArray(normalized.channels) ? normalized.channels.length : 0;
    const accountCount = (normalized.channels || []).reduce((total, channel) => total + (Array.isArray(channel.accounts) ? channel.accounts.length : 0), 0);
    const configuredSecretCount = manifest.reduce((total, entry) => {
        const status = secretStatus?.[entry.secret_key];
        return total + (status?.configured === true ? 1 : 0);
    }, 0);

    return {
        channel_count: channelCount,
        account_count: accountCount,
        secret_count: manifest.length,
        configured_secret_count: configuredSecretCount,
        enabled_channel_count: (normalized.channels || []).filter((channel) => channel.enabled === true).length
    };
}

async function saveIncomingSecrets(supabase, manifest, incomingSecrets, adminId) {
    const secretEntries = normalizeSecretEntries(incomingSecrets);
    const manifestKeys = new Set(manifest.map((entry) => entry.secret_key));
    const savedSecretKeys = [];
    const secretErrors = [];

    for (const entry of secretEntries) {
        if (!manifestKeys.has(entry.secretKey)) {
            continue;
        }

        const secretMeta = parseMarketplaceSecretKey(entry.secretKey);
        const channelKey = secretMeta?.channel_key || '';
        const accountKey = secretMeta?.account_key || '';
        const secretName = secretMeta?.secret_name || '';

        try {
            await upsertMarketplaceChannelSecret({
                supabase,
                channelKey,
                accountKey,
                secretName,
                secretValue: entry.secretValue,
                adminId,
                metadata: {
                    secret_key: entry.secretKey
                }
            });
            savedSecretKeys.push(entry.secretKey);
        } catch (error) {
            secretErrors.push({
                secret_key: entry.secretKey,
                message: sanitizeText(error?.message, 200) || 'Failed to save secret'
            });
        }
    }

    return {
        savedSecretKeys,
        secretErrors
    };
}

module.exports = async function adminMarketplaceChannelsHandler(req, res) {
    if (!['GET', 'POST', 'DELETE'].includes(String(req.method || '').toUpperCase())) {
        res.setHeader('Allow', 'GET, POST, DELETE');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase, user } = await requireAdmin(req, { permission: 'settings.manage' });

        if (req.method === 'GET') {
            const url = new URL(req.url || '', 'http://localhost');
            const view = normalizeMarketplaceChannelsConfig(
                await loadMarketplaceChannelsConfig(supabase, process.env)
            );
            const runtime = await loadRuntimeSnapshot(supabase, view);
            const summary = buildSummary(runtime.config, runtime.manifest, runtime.secret_status);

            return sendJson(res, 200, {
                success: true,
                view: url.searchParams.get('view') || 'registry',
                config: runtime.config,
                manifest: runtime.manifest,
                secret_status: runtime.secret_status,
                summary
            });
        }

        if (req.method === 'POST') {
            const body = await parseJsonBody(req);
            const nextConfig = normalizeMarketplaceChannelsConfig(body.config || body.value || {});
            const savedConfig = await upsertMarketplaceChannelsConfig(supabase, nextConfig, user.id);
            const runtime = await loadRuntimeSnapshot(supabase, savedConfig);
            const { savedSecretKeys, secretErrors } = await saveIncomingSecrets(
                supabase,
                runtime.manifest,
                body.secrets || {},
                user.id
            );

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                actionType: 'admin.marketplace_channels.upsert',
                details: {
                    default_channel_key: savedConfig.default_channel_key,
                    enabled: savedConfig.enabled === true,
                    inventory_mode: savedConfig.inventory_mode,
                    channel_count: Array.isArray(savedConfig.channels) ? savedConfig.channels.length : 0,
                    updated_secret_keys: savedSecretKeys,
                    secret_error_count: secretErrors.length
                }
            });

            const refreshedRuntime = await loadRuntimeSnapshot(supabase, savedConfig);
            const summary = buildSummary(refreshedRuntime.config, refreshedRuntime.manifest, refreshedRuntime.secret_status);

            return sendJson(res, 200, {
                success: true,
                message: secretErrors.length
                    ? '商城渠道注册表已保存，部分密钥需要补录。'
                    : '商城渠道注册表已保存。',
                config: refreshedRuntime.config,
                manifest: refreshedRuntime.manifest,
                secret_status: refreshedRuntime.secret_status,
                summary,
                saved_secret_keys: savedSecretKeys,
                secret_errors: secretErrors
            });
        }

        if (req.method === 'DELETE') {
            const body = await parseJsonBody(req);
            const secretKey = sanitizeText(body.secretKey || body.secret_key, 200);
            const channelKey = sanitizeText(body.channelKey || body.channel_key, 80);
            const accountKey = sanitizeText(body.accountKey || body.account_key, 80);
            const secretName = sanitizeText(body.secretName || body.secret_name, 80);
            const computedSecretKey = secretKey || buildMarketplaceChannelSecretKey(channelKey, accountKey, secretName);

            if (!computedSecretKey) {
                return sendJson(res, 400, {
                    success: false,
                    message: 'secretKey, or channelKey/accountKey/secretName is required'
                });
            }

            await deleteMarketplaceChannelSecret(supabase, computedSecretKey);

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                actionType: 'admin.marketplace_channels.secret.delete',
                details: {
                    secret_key: computedSecretKey
                }
            });

            const config = await loadMarketplaceChannelsConfig(supabase, process.env);
            const runtime = await loadRuntimeSnapshot(supabase, config);
            const summary = buildSummary(runtime.config, runtime.manifest, runtime.secret_status);

            return sendJson(res, 200, {
                success: true,
                message: '密钥已删除。',
                config: runtime.config,
                manifest: runtime.manifest,
                secret_status: runtime.secret_status,
                summary
            });
        }
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Marketplace channel settings failed'
        });
    }
};
