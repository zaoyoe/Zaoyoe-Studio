const {
    parseJsonBody,
    requireAdmin,
    sendJson
} = require('../../../api/_lib/admin');
const { resolveCodexRuntimeConfig } = require('../../../api/_lib/secrets');

function normalizeCodexApiFormat(value) {
    return String(value || '').trim().toLowerCase() === 'responses'
        ? 'responses'
        : 'chat.completions';
}

function normalizeMessages(messages = []) {
    if (!Array.isArray(messages)) {
        return [];
    }

    return messages
        .filter((message) => message && typeof message === 'object' && !Array.isArray(message))
        .map((message) => ({
            ...message,
            role: String(message.role || 'user').trim() || 'user'
        }));
}

function normalizeContentParts(parts = []) {
    if (!Array.isArray(parts)) {
        return [];
    }

    return parts
        .filter((part) => part && typeof part === 'object' && !Array.isArray(part))
        .map((part) => {
            if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
                return {
                    type: 'text',
                    text: part.text
                };
            }

            if (part.type === 'image' && String(part.data || '').trim()) {
                return {
                    type: 'image',
                    mimeType: String(part.mimeType || part.mime_type || 'image/png').trim() || 'image/png',
                    data: String(part.data || '').trim()
                };
            }

            if (typeof part.text === 'string' && part.text.trim()) {
                return {
                    type: 'text',
                    text: part.text
                };
            }

            const inlineData = part.inline_data && typeof part.inline_data === 'object'
                ? part.inline_data
                : null;
            const imageBase64 = String(inlineData?.data || '').trim();
            if (imageBase64) {
                return {
                    type: 'image',
                    mimeType: String(inlineData?.mime_type || 'image/png').trim() || 'image/png',
                    data: imageBase64
                };
            }

            return null;
        })
        .filter(Boolean);
}

function normalizeGeminiContents(contents = []) {
    if (!Array.isArray(contents)) {
        return [];
    }

    return contents
        .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
        .map((item) => ({
            role: String(item.role || 'user').trim() || 'user',
            parts: normalizeContentParts(item.parts)
        }))
        .filter((item) => item.parts.length > 0);
}

function toDataUrl(mimeType, base64Data) {
    const normalizedMimeType = String(mimeType || 'image/png').trim() || 'image/png';
    return `data:${normalizedMimeType};base64,${String(base64Data || '').trim()}`;
}

function normalizeResponseInput(messages = [], contents = []) {
    const normalizedContents = normalizeGeminiContents(contents);
    if (normalizedContents.length) {
        return normalizedContents.map((message) => ({
            role: message.role,
            content: message.parts.map((part) => (
                part.type === 'text'
                    ? { type: 'input_text', text: part.text }
                    : { type: 'input_image', image_url: toDataUrl(part.mimeType, part.data) }
            ))
        }));
    }

    return messages.map((message) => ({
        role: message.role,
        content: typeof message.content === 'undefined'
            ? ''
            : message.content
    }));
}

function normalizeChatMessages(messages = [], contents = []) {
    const normalizedContents = normalizeGeminiContents(contents);
    if (normalizedContents.length) {
        return normalizedContents.map((message) => ({
            role: message.role,
            content: message.parts.map((part) => (
                part.type === 'text'
                    ? { type: 'text', text: part.text }
                    : { type: 'image_url', image_url: { url: toDataUrl(part.mimeType, part.data) } }
            ))
        }));
    }

    return messages;
}

function buildMessagesFromBody(body = {}) {
    const normalizedMessages = normalizeMessages(body.messages);
    if (normalizedMessages.length) {
        return normalizedMessages;
    }

    const prompt = String(body.prompt || '').trim();
    if (!prompt) {
        return [];
    }

    return [{
        role: 'user',
        content: prompt
    }];
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
                if (typeof part.text === 'string' && part.text.trim()) {
                    return part.text.trim();
                }

                if (typeof part.output_text === 'string' && part.output_text.trim()) {
                    return part.output_text.trim();
                }

                if (typeof part.content === 'string' && part.content.trim()) {
                    return part.content.trim();
                }
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

    if (typeof output.response?.output_text === 'string' && output.response.output_text.trim()) {
        return output.response.output_text.trim();
    }

    const responseOutput = Array.isArray(output.output) ? output.output : [];
    const textParts = [];

    responseOutput.forEach((item) => {
        const contentItems = Array.isArray(item?.content) ? item.content : [];
        contentItems.forEach((contentItem) => {
            const text = String(
                contentItem?.text
                || contentItem?.output_text
                || contentItem?.content
                || ''
            ).trim();
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

    const responsesText = extractResponsesText(payload);
    const chatText = extractChatMessageText(
        payload?.choices?.[0]?.message?.content
        || payload?.message?.content
    );

    if (apiFormat === 'responses') {
        return responsesText || chatText;
    }

    return chatText || responsesText;
}

function extractStreamEventText(payload = {}) {
    if (!payload || typeof payload !== 'object') {
        return '';
    }

    return extractResponsesText(payload)
        || extractChatMessageText(
            payload?.choices?.[0]?.delta?.content
            || payload?.choices?.[0]?.message?.content
            || payload?.message?.content
            || payload?.delta?.content
            || payload?.content
        )
        || String(payload?.delta || payload?.text || payload?.output_text || '').trim()
        || '';
}

async function readUpstreamBody(response) {
    const rawText = typeof response?.text === 'function'
        ? await response.text().catch(() => '')
        : '';
    const trimmedText = String(rawText || '').trim();

    if (!trimmedText) {
        return {
            payload: {},
            rawText: ''
        };
    }

    try {
        return {
            payload: JSON.parse(trimmedText),
            rawText: trimmedText
        };
    } catch (_) {
        // Fall through and try to recover common SSE relay formats.
    }

    const eventPayloads = [];
    const eventTexts = [];
    const lines = trimmedText.split(/\r?\n/);

    for (const line of lines) {
        const normalizedLine = String(line || '').trim();
        if (!normalizedLine.startsWith('data:')) {
            continue;
        }

        const data = normalizedLine.slice('data:'.length).trim();
        if (!data || data === '[DONE]') {
            continue;
        }

        try {
            const parsed = JSON.parse(data);
            eventPayloads.push(parsed);
            const eventText = extractStreamEventText(parsed);
            if (eventText) {
                eventTexts.push(eventText);
            }
        } catch (_) {
            eventTexts.push(data);
        }
    }

    if (eventPayloads.length) {
        return {
            payload: eventPayloads[eventPayloads.length - 1],
            rawText: eventTexts.join('').trim() || trimmedText
        };
    }

    return {
        payload: {},
        rawText: trimmedText
    };
}

function isPlainObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function applyGenerationConfig(upstreamBody, generationConfig = {}, apiFormat = 'chat.completions') {
    const normalizedConfig = isPlainObject(generationConfig) ? generationConfig : {};

    if (typeof normalizedConfig.temperature !== 'undefined' && typeof upstreamBody.temperature === 'undefined') {
        upstreamBody.temperature = normalizedConfig.temperature;
    }

    if (typeof normalizedConfig.topP !== 'undefined' && typeof upstreamBody.top_p === 'undefined') {
        upstreamBody.top_p = normalizedConfig.topP;
    }

    if (typeof normalizedConfig.topK !== 'undefined' && typeof upstreamBody.top_k === 'undefined') {
        upstreamBody.top_k = normalizedConfig.topK;
    }

    if (typeof normalizedConfig.maxOutputTokens !== 'undefined') {
        if (apiFormat === 'responses') {
            if (typeof upstreamBody.max_output_tokens === 'undefined') {
                upstreamBody.max_output_tokens = normalizedConfig.maxOutputTokens;
            }
        } else if (typeof upstreamBody.max_tokens === 'undefined') {
            upstreamBody.max_tokens = normalizedConfig.maxOutputTokens;
        }
    }

    if (typeof normalizedConfig.stopSequences !== 'undefined' && typeof upstreamBody.stop === 'undefined') {
        upstreamBody.stop = normalizedConfig.stopSequences;
    }

    return upstreamBody;
}

module.exports = async (req, res) => {
    try {
        const { supabase, user } = await requireAdmin(req, {
            anyOf: ['prompts.manage', 'content.moderate']
        });

        if (req.method === 'GET') {
            const config = await resolveCodexRuntimeConfig(supabase);
            return sendJson(res, 200, {
                success: true,
                configured: config.configured,
                source: config.source,
                model: config.model,
                baseUrl: config.baseUrl,
                apiFormat: config.apiFormat,
                adminId: user.id
            });
        }

        if (req.method !== 'POST') {
            res.setHeader('Allow', 'GET, POST');
            return sendJson(res, 405, { success: false, message: 'Method not allowed' });
        }

        const runtimeConfig = await resolveCodexRuntimeConfig(supabase);
        const apiKey = String(runtimeConfig.apiKey || '').trim();
        const body = await parseJsonBody(req);
        const model = String(body.model || runtimeConfig.model || 'gpt-5.4').trim() || 'gpt-5.4';
        const apiFormat = normalizeCodexApiFormat(body.apiFormat || runtimeConfig.apiFormat || 'responses');
        const messages = buildMessagesFromBody(body);
        const contents = normalizeGeminiContents(body.contents);
        const upstreamUrl = resolveUpstreamUrl(runtimeConfig.baseUrl, apiFormat);

        if (!apiKey) {
            return sendJson(res, 400, {
                success: false,
                message: 'Codex API Key 未配置'
            });
        }

        if (!runtimeConfig.baseUrl) {
            return sendJson(res, 400, {
                success: false,
                message: 'Codex API Base URL 未配置'
            });
        }

        if (!upstreamUrl) {
            return sendJson(res, 400, {
                success: false,
                message: 'Codex upstream URL 无效'
            });
        }

        if (!messages.length && !contents.length) {
            return sendJson(res, 400, { success: false, message: 'messages, prompt, or contents is required' });
        }

        const upstreamBody = apiFormat === 'responses'
            ? {
                model,
                input: normalizeResponseInput(messages, contents)
            }
            : {
                model,
                messages: normalizeChatMessages(messages, contents),
                stream: false
            };

        [
            'temperature',
            'top_p',
            'frequency_penalty',
            'presence_penalty',
            'max_tokens',
            'max_output_tokens',
            'reasoning_effort',
            'response_format',
            'metadata',
            'tools',
            'tool_choice'
        ].forEach((field) => {
            if (typeof body[field] !== 'undefined') {
                upstreamBody[field] = body[field];
            }
        });

        applyGenerationConfig(upstreamBody, body.generationConfig, apiFormat);

        if (typeof body.maxTokens !== 'undefined' && typeof upstreamBody.max_tokens === 'undefined') {
            upstreamBody.max_tokens = body.maxTokens;
        }

        if (apiFormat === 'responses') {
            delete upstreamBody.max_tokens;
            if (typeof body.max_output_tokens === 'undefined' && typeof body.maxTokens !== 'undefined') {
                upstreamBody.max_output_tokens = body.maxTokens;
            }
            if (isPlainObject(body.text)) {
                upstreamBody.text = body.text;
            }
        }

        const upstreamResponse = await fetch(upstreamUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify(upstreamBody)
        });

        const {
            payload,
            rawText
        } = await readUpstreamBody(upstreamResponse);

        if (!upstreamResponse.ok) {
            return sendJson(res, upstreamResponse.status, {
                success: false,
                message: payload?.error?.message || rawText || `Codex request failed (${upstreamResponse.status})`,
                error: payload?.error || payload || null
            });
        }

        const resolvedText = extractText(payload, apiFormat) || rawText;

        return sendJson(res, 200, {
            success: true,
            model,
            apiFormat,
            text: resolvedText,
            result: payload,
            rawText: rawText && rawText !== resolvedText ? rawText : ''
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Codex proxy failed'
        });
    }
};
