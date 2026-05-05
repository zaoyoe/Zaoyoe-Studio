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

function sanitizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

async function loadExternalEmbedPolicy(supabase) {
    const { data, error } = await supabase
        .from('system_config')
        .select('config_value')
        .eq('config_key', CONFIG_KEY)
        .maybeSingle();
    if (error) throw error;
    return normalizeExternalEmbedPolicy(data?.config_value || {});
}

async function saveExternalEmbedPolicy({ supabase, user, body }) {
    const current = await loadExternalEmbedPolicy(supabase);
    const nextPolicy = normalizeExternalEmbedPolicy({
        ...current,
        ...(body.policy || body.external_embed || body.externalEmbed || body),
        updated_at: new Date().toISOString()
    });

    const { error } = await supabase
        .from('system_config')
        .upsert({
            config_key: CONFIG_KEY,
            config_value: nextPolicy,
            description: '客服系统外部承载与公益站嵌入策略',
            updated_by: user.id || null,
            updated_at: new Date().toISOString()
        }, {
            onConflict: 'config_key'
        });
    if (error) throw error;

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'engagement',
        actionType: 'engagement.external.policy.update',
        details: {
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
            const policy = await loadExternalEmbedPolicy(supabase);
            return sendJson(res, 200, {
                success: true,
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
        const action = sanitizeText(body.action || 'save_policy', 80).toLowerCase();
        if (action !== 'save_policy') {
            return sendJson(res, 400, {
                success: false,
                message: 'Unsupported external engagement action'
            });
        }

        const policy = await saveExternalEmbedPolicy({ supabase, user, body });
        return sendJson(res, 200, {
            success: true,
            external_embed: buildExternalPayload(policy)
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Failed to manage external engagement embed'
        });
    }
};
