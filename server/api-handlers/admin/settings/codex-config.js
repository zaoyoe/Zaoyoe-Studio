const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    CODEX_SECRET_KEY,
    deleteStoredAdminSecret,
    resolveCodexRuntimeConfig,
    upsertStoredAdminSecret
} = require('../../../../api/_lib/secrets');
const {
    redactSensitiveText,
    redactSensitiveValue
} = require('../_ai-shared');

function normalizeBaseUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
}

function isValidHttpUrl(value) {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

function normalizeCodexApiFormat(value) {
    return String(value || '').trim().toLowerCase() === 'responses'
        ? 'responses'
        : 'chat.completions';
}

function resolveUpstreamUrl(baseUrl, apiFormat) {
    const normalizedBaseUrl = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (!normalizedBaseUrl) {
        return '';
    }

    const endpoint = apiFormat === 'responses' ? 'responses' : 'chat/completions';

    try {
        const parsedUrl = new URL(normalizedBaseUrl);
        const pathname = parsedUrl.pathname.replace(/\/+$/, '');

        if (/\/(chat\/completions|responses)$/i.test(pathname)) {
            return parsedUrl.toString().replace(/\/+$/, '');
        }

        if (!pathname || pathname === '/') {
            parsedUrl.pathname = `/v1/${endpoint}`;
            return parsedUrl.toString();
        }

        parsedUrl.pathname = `${pathname}/${endpoint}`;
        return parsedUrl.toString();
    } catch (_) {
        if (/\/(chat\/completions|responses)$/i.test(normalizedBaseUrl)) {
            return normalizedBaseUrl;
        }

        if (/\/v\d+$/i.test(normalizedBaseUrl)) {
            return `${normalizedBaseUrl}/${endpoint}`;
        }

        return `${normalizedBaseUrl}/v1/${endpoint}`;
    }
}

function extractChatMessageText(content) {
    if (typeof content === 'string') {
        return content.trim();
    }

    if (!Array.isArray(content)) {
        return '';
    }

    return content
        .map((part) => {
            if (typeof part === 'string') {
                return part;
            }

            if (part && typeof part === 'object') {
                return String(part.text || part.output_text || '').trim();
            }

            return '';
        })
        .filter(Boolean)
        .join('\n')
        .trim();
}

function extractResponsesText(output = {}) {
    if (typeof output.output_text === 'string' && output.output_text.trim()) {
        return output.output_text.trim();
    }

    const responseOutput = Array.isArray(output.output) ? output.output : [];
    const textParts = [];

    responseOutput.forEach((item) => {
        const contentItems = Array.isArray(item?.content) ? item.content : [];
        contentItems.forEach((contentItem) => {
            const text = String(contentItem?.text || contentItem?.output_text || '').trim();
            if (text) {
                textParts.push(text);
            }
        });
    });

    return textParts.join('\n').trim();
}

function extractText(payload, apiFormat) {
    if (!payload || typeof payload !== 'object') {
        return '';
    }

    if (apiFormat === 'responses') {
        return extractResponsesText(payload);
    }

    return extractChatMessageText(payload?.choices?.[0]?.message?.content);
}

function buildConnectivityProbeBody(model, apiFormat) {
    if (apiFormat === 'responses') {
        return {
            model,
            input: [{
                role: 'user',
                content: [{
                    type: 'input_text',
                    text: 'Reply with OK.'
                }]
            }],
            max_output_tokens: 24
        };
    }

    return {
        model,
        messages: [{
            role: 'user',
            content: 'Reply with OK.'
        }],
        stream: false,
        max_tokens: 24
    };
}

async function runConnectivityProbe({ apiKey, baseUrl, model, apiFormat }) {
    const upstreamUrl = resolveUpstreamUrl(baseUrl, apiFormat);

    if (!upstreamUrl) {
        const error = new Error('Codex upstream URL 无效');
        error.statusCode = 400;
        throw error;
    }

    const response = await fetch(upstreamUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(buildConnectivityProbeBody(model, apiFormat))
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(redactSensitiveText(payload?.error?.message || `Codex request failed (${response.status})`));
        error.statusCode = response.status;
        error.details = redactSensitiveValue(payload?.error || payload || null);
        throw error;
    }

    return {
        upstreamUrl,
        text: extractText(payload, apiFormat),
        payload
    };
}

module.exports = async (req, res) => {
    try {
        const { supabase, user } = await requireAdmin(req, { permission: 'settings.manage' });

        if (req.method === 'GET') {
            const config = await resolveCodexRuntimeConfig(supabase);
            return sendJson(res, 200, {
                success: true,
                configured: config.configured,
                source: config.source,
                model: config.model,
                baseUrl: config.baseUrl,
                apiFormat: config.apiFormat,
                updatedAt: config.updatedAt,
                decryptErrorMessage: config.decryptErrorMessage || ''
            });
        }

        if (req.method === 'POST') {
            const body = await parseJsonBody(req);
            const testOnly = body.testOnly === true;
            const apiKey = String(body.apiKey || '').trim();
            const currentConfig = await resolveCodexRuntimeConfig(supabase);
            const baseUrl = normalizeBaseUrl(body.baseUrl || currentConfig.baseUrl);
            const model = String(body.model || '').trim() || 'gpt-5.4';
            const apiFormat = normalizeCodexApiFormat(body.apiFormat || 'responses');

            if (testOnly) {
                const resolvedApiKey = apiKey || String(currentConfig.apiKey || '').trim();

                if (resolvedApiKey.length < 10) {
                    return sendJson(res, 400, {
                        success: false,
                        message: '请先录入有效的 Codex API Key，再测试连通性'
                    });
                }

                if (!baseUrl || !isValidHttpUrl(baseUrl)) {
                    return sendJson(res, 400, {
                        success: false,
                        message: '请输入有效的 Codex API Base URL'
                    });
                }

                const probe = await runConnectivityProbe({
                    apiKey: resolvedApiKey,
                    baseUrl,
                    model,
                    apiFormat
                });

                await writeAdminAuditLog({
                    supabase,
                    adminId: user.id,
                    actionType: 'admin.codex_config.test',
                    details: {
                        source: apiKey ? 'manual_probe' : (currentConfig.source || 'runtime_config'),
                        baseUrl,
                        model,
                        apiFormat,
                        upstreamUrl: probe.upstreamUrl
                    }
                });

                return sendJson(res, 200, {
                    success: true,
                    message: 'Codex Relay 连通性测试通过。',
                    configured: currentConfig.configured,
                    source: currentConfig.source,
                    model,
                    baseUrl,
                    apiFormat,
                    upstreamUrl: probe.upstreamUrl,
                    text: probe.text
                });
            }

            const resolvedApiKey = apiKey || (
                currentConfig.source === 'stored'
                    ? String(currentConfig.apiKey || '').trim()
                    : ''
            );

            if (resolvedApiKey.length < 10) {
                return sendJson(res, 400, {
                    success: false,
                    message: '请先录入有效的 Codex API Key'
                });
            }

            if (!baseUrl || !isValidHttpUrl(baseUrl)) {
                return sendJson(res, 400, {
                    success: false,
                    message: '请输入有效的 Codex API Base URL'
                });
            }

            await upsertStoredAdminSecret({
                supabase,
                secretKey: CODEX_SECRET_KEY,
                secretValue: resolvedApiKey,
                adminId: user.id,
                description: 'Codex relay API key managed from Admin Studio',
                metadata: {
                    provider: 'codex',
                    baseUrl,
                    model,
                    apiFormat,
                    saved_via: 'admin_studio'
                }
            });

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                actionType: 'admin.codex_config.upsert',
                details: {
                    source: 'admin_studio',
                    baseUrl,
                    model,
                    apiFormat
                }
            });

            const config = await resolveCodexRuntimeConfig(supabase);
            return sendJson(res, 200, {
                success: true,
                message: 'Codex 配置已安全保存到服务端。',
                configured: config.configured,
                source: config.source,
                model: config.model,
                baseUrl: config.baseUrl,
                apiFormat: config.apiFormat,
                decryptErrorMessage: config.decryptErrorMessage || ''
            });
        }

        if (req.method === 'DELETE') {
            const currentConfig = await resolveCodexRuntimeConfig(supabase);

            if (currentConfig.source !== 'stored') {
                return sendJson(res, 400, {
                    success: false,
                    message: '当前没有可删除的后台存储 Codex 配置'
                });
            }

            await deleteStoredAdminSecret(supabase, CODEX_SECRET_KEY);

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                actionType: 'admin.codex_config.delete',
                details: {
                    removed_source: 'stored'
                }
            });

            const nextConfig = await resolveCodexRuntimeConfig(supabase);
            return sendJson(res, 200, {
                success: true,
                message: nextConfig.source === 'environment'
                    ? '已删除后台存储 Codex 配置，当前回退到环境变量。'
                    : '已删除后台存储 Codex 配置。',
                configured: nextConfig.configured,
                source: nextConfig.source,
                model: nextConfig.model,
                baseUrl: nextConfig.baseUrl,
                apiFormat: nextConfig.apiFormat
            });
        }

        res.setHeader('Allow', 'GET, POST, DELETE');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: redactSensitiveText(error.message || 'Codex config management failed'),
            error: redactSensitiveValue(error.details || null)
        });
    }
};
