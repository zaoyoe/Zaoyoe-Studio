const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    GEMINI_SECRET_KEY,
    deleteStoredAdminSecret,
    resolveGeminiRuntimeConfig,
    upsertStoredAdminSecret
} = require('../../../../api/_lib/secrets');

module.exports = async (req, res) => {
    try {
        const { supabase, user } = await requireAdmin(req);

        if (req.method === 'GET') {
            const config = await resolveGeminiRuntimeConfig(supabase);
            return sendJson(res, 200, {
                success: true,
                configured: config.configured,
                source: config.source,
                model: config.model,
                updatedAt: config.updatedAt
            });
        }

        if (req.method === 'POST') {
            const body = await parseJsonBody(req);
            const apiKey = String(body.apiKey || '').trim();

            if (apiKey.length < 20) {
                return sendJson(res, 400, {
                    success: false,
                    message: '请输入有效的 Gemini API Key'
                });
            }

            await upsertStoredAdminSecret({
                supabase,
                secretKey: GEMINI_SECRET_KEY,
                secretValue: apiKey,
                adminId: user.id,
                description: 'Gemini API key managed from Admin Studio',
                metadata: {
                    provider: 'gemini',
                    saved_via: 'admin_studio'
                }
            });

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                actionType: 'admin.gemini_key.upsert',
                details: {
                    source: 'admin_studio'
                }
            });

            const config = await resolveGeminiRuntimeConfig(supabase);
            return sendJson(res, 200, {
                success: true,
                message: 'Gemini Key 已安全保存到服务端。',
                configured: config.configured,
                source: config.source,
                model: config.model
            });
        }

        if (req.method === 'DELETE') {
            const currentConfig = await resolveGeminiRuntimeConfig(supabase);

            if (currentConfig.source !== 'stored') {
                return sendJson(res, 400, {
                    success: false,
                    message: '当前没有可删除的后台存储 Gemini Key'
                });
            }

            await deleteStoredAdminSecret(supabase, GEMINI_SECRET_KEY);

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                actionType: 'admin.gemini_key.delete',
                details: {
                    removed_source: 'stored'
                }
            });

            const nextConfig = await resolveGeminiRuntimeConfig(supabase);
            return sendJson(res, 200, {
                success: true,
                message: nextConfig.source === 'environment'
                    ? '已删除后台存储 Key，当前回退到 Vercel 环境变量。'
                    : '已删除后台存储 Key。',
                configured: nextConfig.configured,
                source: nextConfig.source,
                model: nextConfig.model
            });
        }

        res.setHeader('Allow', 'GET, POST, DELETE');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Gemini key management failed'
        });
    }
};
