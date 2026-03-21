const {
    parseJsonBody,
    requireAdmin,
    sendJson
} = require('../../../api/_lib/admin');
const { resolveGeminiRuntimeConfig } = require('../../../api/_lib/secrets');

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
                adminId: user.id
            });
        }

        if (req.method !== 'POST') {
            res.setHeader('Allow', 'GET, POST');
            return sendJson(res, 405, { success: false, message: 'Method not allowed' });
        }

        const runtimeConfig = await resolveGeminiRuntimeConfig(supabase);
        const apiKey = String(runtimeConfig.apiKey || '').trim();
        const body = await parseJsonBody(req);
        const model = String(body.model || runtimeConfig.model || process.env.GEMINI_MODEL || 'gemini-2.0-flash').trim();
        const contents = Array.isArray(body.contents) ? body.contents : [];
        const generationConfig = body.generationConfig && typeof body.generationConfig === 'object'
            ? body.generationConfig
            : undefined;

        if (!apiKey) {
            return sendJson(res, 400, {
                success: false,
                message: 'Gemini API Key 未配置'
            });
        }

        if (!model.startsWith('gemini-')) {
            return sendJson(res, 400, { success: false, message: 'Unsupported Gemini model' });
        }

        if (!contents.length) {
            return sendJson(res, 400, { success: false, message: 'contents is required' });
        }

        const upstreamResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents,
                    generationConfig
                })
            }
        );

        const payload = await upstreamResponse.json().catch(() => ({}));

        if (!upstreamResponse.ok) {
            return sendJson(res, upstreamResponse.status, {
                success: false,
                message: payload?.error?.message || `Gemini request failed (${upstreamResponse.status})`,
                error: payload?.error || null
            });
        }

        return sendJson(res, 200, {
            success: true,
            result: payload
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Gemini proxy failed'
        });
    }
};
