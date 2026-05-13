const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    CONFIG_KEY,
    buildExternalEmbedDiagnostics,
    buildExternalEmbedSnippet,
    normalizeExternalEmbedPolicy
} = require('../../../../api/_lib/engagement-external-policy');
const {
    loadSiteScopedConfig,
    normalizeEngagementConfigSite,
    resolveEngagementConfigRequestSite,
    saveSiteScopedConfig
} = require('../../_engagement-site-config');

function sanitizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

async function loadExternalEmbedPolicy(supabase, site = 'cn') {
    return loadSiteScopedConfig(supabase, CONFIG_KEY, site, normalizeExternalEmbedPolicy, {});
}

async function saveExternalEmbedPolicy({ supabase, user, body, site }) {
    const normalizedSite = normalizeEngagementConfigSite(body.site || site, { fallback: 'cn' });
    const current = await loadExternalEmbedPolicy(supabase, normalizedSite);
    const nextPolicy = normalizeExternalEmbedPolicy({
        ...current,
        ...(body.policy || body.external_embed || body.externalEmbed || body),
        default_site: normalizedSite,
        updated_at: new Date().toISOString()
    });

    await saveSiteScopedConfig({
        supabase,
        key: CONFIG_KEY,
        site: normalizedSite,
        value: nextPolicy,
        description: '客服系统外部承载与API中转嵌入策略',
        userId: user.id
    });

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'engagement',
        site: normalizedSite,
        actionType: 'engagement.external.policy.update',
        details: {
            site: normalizedSite,
            config_key: CONFIG_KEY,
            enabled: nextPolicy.enabled,
            allowed_origin_count: nextPolicy.allowed_origins.length,
            default_page_id: nextPolicy.default_page_id,
            api_origin: nextPolicy.api_origin,
            asset_base: nextPolicy.asset_base
        }
    });

    return nextPolicy;
}

function buildExternalPayload(policy = {}) {
    const normalized = normalizeExternalEmbedPolicy(policy);
    return {
        ...normalized,
        embed_snippet: buildExternalEmbedSnippet(normalized),
        diagnostics: buildExternalEmbedDiagnostics(normalized)
    };
}

module.exports = async function engagementExternalHandler(req, res) {
    try {
        const { supabase, user } = await requireAdmin(req, {
            anyOf: ['chat.manage', 'settings.manage']
        });

        if (req.method === 'GET') {
            const url = new URL(req.url || '', 'http://localhost');
            const site = resolveEngagementConfigRequestSite(req, url, { fallback: 'cn' });
            const policy = await loadExternalEmbedPolicy(supabase, site);
            return sendJson(res, 200, {
                success: true,
                site,
                external_embed: buildExternalPayload(policy)
            });
        }

        if (req.method !== 'POST') {
            res.setHeader('Allow', 'GET, POST');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const body = await parseJsonBody(req);
        const url = new URL(req.url || '', 'http://localhost');
        const site = normalizeEngagementConfigSite(body.site || url.searchParams.get('site') || req.adminSite, { fallback: 'cn' });
        const action = sanitizeText(body.action || 'save_policy', 80).toLowerCase();
        if (action !== 'save_policy') {
            return sendJson(res, 400, {
                success: false,
                message: 'Unsupported external engagement action'
            });
        }

        const policy = await saveExternalEmbedPolicy({ supabase, user, body, site });
        return sendJson(res, 200, {
            success: true,
            site,
            external_embed: buildExternalPayload(policy)
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Failed to manage external engagement embed'
        });
    }
};
