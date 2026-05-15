const {
    parseJsonBody,
    requireAdmin,
    sendJson
} = require('../../../api/_lib/admin');
const { resolveCodexRuntimeConfig } = require('../../../api/_lib/secrets');
const {
    applyBudgetToGeminiContents: applySharedBudgetToGeminiContents,
    applyBudgetToMessages: applySharedBudgetToMessages,
    buildBudgetMeta: buildSharedBudgetMeta,
    hasExplicitBudgetTier,
    mergeBudgetStates: mergeSharedBudgetStates,
    redactSensitiveText: redactSharedSensitiveText,
    redactSensitiveValue: redactSharedSensitiveValue,
    resolveRequestBudget
} = require('./_ai-shared');

const CODEX_REQUEST_BODY_CHAR_LIMIT = 6_000_000;
const CODEX_MAX_OUTPUT_TOKENS = 4096;
const CODEX_BUDGET_PRESETS = Object.freeze({
    lean: {
        tier: 'lean',
        maxInputChars: 6000,
        maxOutputTokens: 600
    },
    balanced: {
        tier: 'balanced',
        maxInputChars: 12000,
        maxOutputTokens: 900
    },
    expanded: {
        tier: 'expanded',
        maxInputChars: 24000,
        maxOutputTokens: 1600
    }
});
const CODEX_BUDGET_ALIASES = Object.freeze({
    compact: 'lean',
    concise: 'lean',
    low: 'lean',
    lean: 'lean',
    normal: 'balanced',
    balanced: 'balanced',
    standard: 'balanced',
    deep: 'expanded',
    expanded: 'expanded'
});
const RESPONSES_REASONING_EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh']);

function normalizeCodexApiFormat(value) {
    return String(value || '').trim().toLowerCase() === 'responses'
        ? 'responses'
        : 'chat.completions';
}

function clampInteger(value, min, max, fallback = min) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, Math.floor(numberValue)));
}

function estimateTokenCountFromChars(charCount = 0) {
    return Math.max(0, Math.ceil((Number(charCount) || 0) / 4));
}

function getSerializedBodySize(body = {}) {
    try {
        return JSON.stringify(body || {}).length;
    } catch (_) {
        return 0;
    }
}

function resolveCodexRequestBudget(body = {}) {
    const rawBudget = body?.budget || body?.tokenBudget || null;
    if (!rawBudget) {
        return null;
    }

    const rawTier = typeof rawBudget === 'string'
        ? rawBudget
        : (rawBudget.tier || rawBudget.mode || rawBudget.level || rawBudget.preset);
    const tier = CODEX_BUDGET_ALIASES[String(rawTier || '').trim().toLowerCase()] || 'balanced';
    const preset = CODEX_BUDGET_PRESETS[tier] || CODEX_BUDGET_PRESETS.balanced;
    const requestedMaxInputChars = typeof rawBudget === 'object' && rawBudget
        ? rawBudget.maxInputChars || rawBudget.max_input_chars
        : undefined;
    const requestedMaxOutputTokens = typeof rawBudget === 'object' && rawBudget
        ? rawBudget.maxOutputTokens || rawBudget.max_output_tokens
        : undefined;

    return {
        tier,
        maxInputChars: clampInteger(
            requestedMaxInputChars,
            1000,
            preset.maxInputChars,
            preset.maxInputChars
        ),
        maxOutputTokens: clampInteger(
            requestedMaxOutputTokens,
            64,
            preset.maxOutputTokens,
            preset.maxOutputTokens
        )
    };
}

function createBudgetState(budget) {
    return {
        maxInputChars: budget?.maxInputChars || 0,
        inputChars: 0,
        truncatedChars: 0,
        truncated: false
    };
}

function applyTextBudget(value, state) {
    const source = String(value || '');
    if (!source || !state?.maxInputChars) {
        return source;
    }

    const remainingChars = Math.max(0, state.maxInputChars - state.inputChars);
    const nextValue = source.slice(0, remainingChars);
    state.inputChars += nextValue.length;

    if (source.length > nextValue.length) {
        state.truncated = true;
        state.truncatedChars += source.length - nextValue.length;
    }

    return nextValue;
}

function applyBudgetToContent(content, state) {
    if (typeof content === 'string') {
        return applyTextBudget(content, state);
    }

    if (!Array.isArray(content)) {
        return content;
    }

    return content.map((part) => {
        if (!part || typeof part !== 'object' || Array.isArray(part)) {
            return part;
        }

        const nextPart = { ...part };
        if (typeof nextPart.text === 'string') {
            nextPart.text = applyTextBudget(nextPart.text, state);
        } else if (typeof nextPart.output_text === 'string') {
            nextPart.output_text = applyTextBudget(nextPart.output_text, state);
        } else if (typeof nextPart.content === 'string') {
            nextPart.content = applyTextBudget(nextPart.content, state);
        }

        return nextPart;
    });
}

function applyBudgetToMessages(messages = [], budget = null) {
    if (!budget) {
        return {
            items: messages,
            state: null
        };
    }

    const state = createBudgetState(budget);
    const items = messages.map((message) => ({
        ...message,
        content: applyBudgetToContent(message?.content, state)
    }));

    return {
        items,
        state
    };
}

function applyBudgetToGeminiContents(contents = [], budget = null) {
    if (!budget) {
        return {
            items: contents,
            state: null
        };
    }

    const state = createBudgetState(budget);
    const items = contents.map((message) => ({
        ...message,
        parts: (Array.isArray(message.parts) ? message.parts : []).map((part) => {
            if (!part || typeof part !== 'object' || Array.isArray(part)) {
                return part;
            }

            if (part.type !== 'text') {
                return part;
            }

            return {
                ...part,
                text: applyTextBudget(part.text, state)
            };
        })
    }));

    return {
        items,
        state
    };
}

function mergeBudgetStates(...states) {
    return states
        .filter(Boolean)
        .reduce((accumulator, state) => ({
            inputChars: accumulator.inputChars + (Number(state.inputChars) || 0),
            truncatedChars: accumulator.truncatedChars + (Number(state.truncatedChars) || 0),
            truncated: accumulator.truncated || state.truncated === true
        }), {
            inputChars: 0,
            truncatedChars: 0,
            truncated: false
        });
}

function buildBudgetMeta(budget = null, state = null) {
    if (!budget) {
        return null;
    }

    const inputChars = Number(state?.inputChars) || 0;
    return {
        tier: budget.tier,
        maxInputChars: budget.maxInputChars,
        maxOutputTokens: budget.maxOutputTokens,
        inputChars,
        estimatedInputTokens: estimateTokenCountFromChars(inputChars),
        truncated: state?.truncated === true,
        truncatedChars: Number(state?.truncatedChars) || 0
    };
}

function redactSensitiveText(value = '') {
    return String(value || '')
        .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]')
        .replace(/sk-[A-Za-z0-9._-]{8,}/gi, 'sk-[redacted]');
}

function redactSensitiveValue(value, depth = 0) {
    if (depth > 4) {
        return '[redacted-depth]';
    }

    if (typeof value === 'string') {
        return redactSensitiveText(value);
    }

    if (Array.isArray(value)) {
        return value.map((item) => redactSensitiveValue(item, depth + 1));
    }

    if (value && typeof value === 'object') {
        return Object.entries(value).reduce((accumulator, [key, item]) => {
            if (/authorization|api[_-]?key|token|secret/i.test(key)) {
                accumulator[key] = '[redacted]';
            } else {
                accumulator[key] = redactSensitiveValue(item, depth + 1);
            }
            return accumulator;
        }, {});
    }

    return value;
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

function normalizeReasoningEffort(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return RESPONSES_REASONING_EFFORTS.has(normalized) ? normalized : '';
}

function applyReasoningConfig(upstreamBody, body = {}, apiFormat = 'chat.completions') {
    if (apiFormat !== 'responses') {
        if (typeof body.reasoning_effort !== 'undefined' && typeof upstreamBody.reasoning_effort === 'undefined') {
            upstreamBody.reasoning_effort = body.reasoning_effort;
        }
        if (typeof body.reasoning !== 'undefined' && typeof upstreamBody.reasoning === 'undefined') {
            upstreamBody.reasoning = body.reasoning;
        }
        return upstreamBody;
    }

    const rawReasoning = isPlainObject(body.reasoning)
        ? body.reasoning
        : {};
    const effort = normalizeReasoningEffort(rawReasoning.effort || body.reasoning_effort);
    if (effort) {
        upstreamBody.reasoning = {
            ...rawReasoning,
            effort
        };
    } else if (Object.keys(rawReasoning).length) {
        upstreamBody.reasoning = rawReasoning;
    }

    delete upstreamBody.reasoning_effort;
    return upstreamBody;
}

function capOutputTokens(upstreamBody, budget = null, apiFormat = 'chat.completions') {
    const field = apiFormat === 'responses' ? 'max_output_tokens' : 'max_tokens';
    const alternateField = apiFormat === 'responses' ? 'max_tokens' : 'max_output_tokens';
    const maxAllowed = budget?.maxOutputTokens || CODEX_MAX_OUTPUT_TOKENS;
    const currentValue = upstreamBody[field];

    if (typeof currentValue === 'undefined' || currentValue === null || currentValue === '') {
        if (budget?.maxOutputTokens) {
            upstreamBody[field] = budget.maxOutputTokens;
        }
    } else {
        upstreamBody[field] = clampInteger(currentValue, 1, maxAllowed, maxAllowed);
    }

    delete upstreamBody[alternateField];
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
                adminId: user.id,
                decryptErrorMessage: config.decryptErrorMessage || ''
            });
        }

        if (req.method !== 'POST') {
            res.setHeader('Allow', 'GET, POST');
            return sendJson(res, 405, { success: false, message: 'Method not allowed' });
        }

        const runtimeConfig = await resolveCodexRuntimeConfig(supabase);
        const apiKey = String(runtimeConfig.apiKey || '').trim();
        const body = await parseJsonBody(req);
        const requestBodyChars = getSerializedBodySize(body);
        if (requestBodyChars > CODEX_REQUEST_BODY_CHAR_LIMIT) {
            return sendJson(res, 413, {
                success: false,
                message: 'Codex 请求体过大，请减少上下文或图片数量后重试',
                budget: {
                    requestBodyChars,
                    maxRequestBodyChars: CODEX_REQUEST_BODY_CHAR_LIMIT
                }
            });
        }

        const model = String(body.model || runtimeConfig.model || 'gpt-5.4').trim() || 'gpt-5.4';
        const apiFormat = normalizeCodexApiFormat(body.apiFormat || runtimeConfig.apiFormat || 'responses');
        let messages = buildMessagesFromBody(body);
        let contents = normalizeGeminiContents(body.contents);
        const rawRequestBudget = body?.budget || body?.tokenBudget || body?.generationConfig?.budget || null;
        const hasInput = messages.length > 0 || contents.length > 0;

        if (hasInput && !hasExplicitBudgetTier(rawRequestBudget)) {
            return sendJson(res, 400, {
                success: false,
                message: 'AI budget tier is required for Codex admin requests'
            });
        }

        const requestBudget = hasInput
            ? resolveRequestBudget(rawRequestBudget)
            : null;
        let budgetState = null;
        if (requestBudget) {
            const budgetedMessages = applySharedBudgetToMessages(messages, requestBudget);
            const budgetedContents = applySharedBudgetToGeminiContents(contents, requestBudget);
            messages = budgetedMessages.items;
            contents = budgetedContents.items;
            budgetState = mergeSharedBudgetStates(budgetedMessages.state, budgetedContents.state);
        }
        const budgetMeta = buildSharedBudgetMeta(requestBudget, budgetState);
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
        } else {
            delete upstreamBody.max_output_tokens;
        }

        applyReasoningConfig(upstreamBody, body, apiFormat);
        capOutputTokens(upstreamBody, requestBudget, apiFormat);

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
                message: redactSharedSensitiveText(payload?.error?.message || rawText || `Codex request failed (${upstreamResponse.status})`),
                error: redactSharedSensitiveValue(payload?.error || payload || null),
                budget: budgetMeta
            });
        }

        const resolvedText = extractText(payload, apiFormat) || rawText;

        return sendJson(res, 200, {
            success: true,
            model,
            apiFormat,
            text: resolvedText,
            result: payload,
            rawText: rawText && rawText !== resolvedText ? rawText : '',
            budget: budgetMeta
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: redactSharedSensitiveText(error.message || 'Codex proxy failed'),
            error: redactSharedSensitiveValue(error.details || null)
        });
    }
};
