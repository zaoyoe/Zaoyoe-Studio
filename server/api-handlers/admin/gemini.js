const {
    parseJsonBody,
    requireAdmin,
    sendJson
} = require('../../../api/_lib/admin');
const { resolveGeminiRuntimeConfig } = require('../../../api/_lib/secrets');
const {
    applyBudgetToGeminiContents,
    buildBudgetMeta,
    clampInteger,
    hasExplicitBudgetTier,
    redactSensitiveText,
    redactSensitiveValue,
    resolveRequestBudget
} = require('./_ai-shared');

const GEMINI_REQUEST_BODY_CHAR_LIMIT = 6_000_000;

function getSerializedBodySize(body = {}) {
    try {
        return JSON.stringify(body || {}).length;
    } catch (_) {
        return 0;
    }
}

function extractGeminiText(payload = {}) {
    const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
    const textParts = [];

    candidates.forEach((candidate) => {
        const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
        parts.forEach((part) => {
            const text = String(part?.text || '').trim();
            if (text) {
                textParts.push(text);
            }
        });
    });

    return textParts.join('\n').trim();
}

module.exports = async (req, res) => {
    try {
        const { supabase, user } = await requireAdmin(req, {
            anyOf: ['prompts.manage', 'content.moderate']
        });

        if (req.method === 'GET') {
            const config = await resolveGeminiRuntimeConfig(supabase);
            return sendJson(res, 200, {
                success: true,
                configured: config.configured,
                source: config.source,
                model: config.model,
                adminId: user.id,
                decryptErrorMessage: config.decryptErrorMessage || ''
            });
        }

        if (req.method !== 'POST') {
            res.setHeader('Allow', 'GET, POST');
            return sendJson(res, 405, { success: false, message: 'Method not allowed' });
        }

        const runtimeConfig = await resolveGeminiRuntimeConfig(supabase);
        const apiKey = String(runtimeConfig.apiKey || '').trim();
        const body = await parseJsonBody(req);
        const requestBodyChars = getSerializedBodySize(body);
        if (requestBodyChars > GEMINI_REQUEST_BODY_CHAR_LIMIT) {
            return sendJson(res, 413, {
                success: false,
                message: 'Gemini 请求体过大，请减少上下文或图片数量后重试',
                budget: {
                    requestBodyChars,
                    maxRequestBodyChars: GEMINI_REQUEST_BODY_CHAR_LIMIT
                }
            });
        }

        const model = String(body.model || runtimeConfig.model || process.env.GEMINI_MODEL || 'gemini-2.0-flash').trim();
        const rawContents = Array.isArray(body.contents) ? body.contents : [];
        if (!rawContents.length) {
            return sendJson(res, 400, { success: false, message: 'contents is required' });
        }

        const rawBudget = body?.budget || body?.tokenBudget || body?.generationConfig?.budget || null;
        if (!hasExplicitBudgetTier(rawBudget)) {
            return sendJson(res, 400, {
                success: false,
                message: 'AI budget tier is required for Gemini admin requests'
            });
        }

        const requestBudget = resolveRequestBudget(rawBudget);
        const budgetedContents = applyBudgetToGeminiContents(rawContents, requestBudget);
        const budgetMeta = buildBudgetMeta(requestBudget, budgetedContents.state);
        const generationConfig = body.generationConfig && typeof body.generationConfig === 'object'
            ? { ...body.generationConfig }
            : {};
        delete generationConfig.budget;
        generationConfig.maxOutputTokens = clampInteger(
            generationConfig.maxOutputTokens,
            1,
            requestBudget.maxOutputTokens,
            requestBudget.maxOutputTokens
        );

        if (!apiKey) {
            return sendJson(res, 400, {
                success: false,
                message: 'Gemini API Key 未配置'
            });
        }

        if (!model.startsWith('gemini-')) {
            return sendJson(res, 400, { success: false, message: 'Unsupported Gemini model' });
        }

        const upstreamResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: budgetedContents.items,
                    generationConfig
                })
            }
        );

        const payload = await upstreamResponse.json().catch(() => ({}));

        if (!upstreamResponse.ok) {
            const retryAfter = String(upstreamResponse.headers?.get?.('retry-after') || '').trim();
            if (retryAfter) {
                res.setHeader('Retry-After', retryAfter);
            }
            return sendJson(res, upstreamResponse.status, {
                success: false,
                message: redactSensitiveText(payload?.error?.message || `Gemini request failed (${upstreamResponse.status})`),
                error: redactSensitiveValue(payload?.error || payload || null),
                budget: budgetMeta
            });
        }

        return sendJson(res, 200, {
            success: true,
            model,
            text: extractGeminiText(payload),
            result: payload,
            budget: budgetMeta
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: redactSensitiveText(error.message || 'Gemini proxy failed'),
            error: redactSensitiveValue(error.details || null)
        });
    }
};
