const sharp = require('sharp');
const { resolveCodexRuntimeConfig, resolveGeminiRuntimeConfig } = require('../../api/_lib/secrets');
const importsHandler = require('../api-handlers/admin/prompts/imports');

const ANALYSIS_PROMPT = `Analyze these AI-generated images and the source prompt for a prompt gallery. Return ONLY valid JSON with: title, title_en, title_zh, description, description_en, description_zh, prompt_text_en, prompt_text_zh, category, objects, scenes, styles, mood, useCase, commercial, difficulty, dominantColors. objects, scenes, styles, and mood MUST each be an object shaped exactly as {"en":["English tags"],"zh":["中文标签"]}; both arrays must contain at least one compact searchable tag. dominantColors must be a compact string array. category must be Photography, Illustration, 3D Art, Miniature, Creative, or Animation. difficulty must be beginner, intermediate, or advanced. prompt_text_en and prompt_text_zh are complete translations of the source prompt, not summaries: translate every sentence and line without shortening, omitting, paraphrasing, or adding instructions. Preserve all headings, shot numbers, P## markers, timestamps, durations, aspect ratios, numeric parameters, and formatting structure. If the source prompt contains canonical media section headers such as [IMAGE · 1] or [VIDEO · 2], prompt_text_en and prompt_text_zh MUST preserve every header exactly and in the same order, translate each section independently, and never merge image and video sections.`;
const RETRYABLE_IMAGE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);
const RETRYABLE_ANALYSIS_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);
const MAX_ANALYSIS_SOURCE_LENGTH = 20000;
const MAX_ANALYSIS_OUTPUT_TOKENS = 16000;

function getAnalysisSourcePrompt(value = '') {
    return String(value || '').trim().slice(0, MAX_ANALYSIS_SOURCE_LENGTH);
}

function parseJsonText(value = '') {
    const text = String(value || '').trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    return JSON.parse(text);
}

async function resolvePromptImportAiService(supabase) {
    const { data, error } = await supabase
        .from('system_config')
        .select('config_value')
        .eq('config_key', 'integrations')
        .maybeSingle();
    if (error) throw error;
    const service = String(data?.config_value?.ai_service || '').trim().toLowerCase();
    return service === 'codex' || service === 'openai' ? 'codex' : 'gemini';
}

function resolveCodexUpstreamUrl(baseUrl = '', apiFormat = 'responses') {
    const normalizedBaseUrl = String(baseUrl || '').trim().replace(/\/+$/, '');
    const endpoint = apiFormat === 'responses' ? 'responses' : 'chat/completions';
    const url = new URL(normalizedBaseUrl);
    const pathname = url.pathname.replace(/\/+$/, '');
    if (/\/(chat\/completions|responses)$/i.test(pathname)) return url.toString().replace(/\/+$/, '');
    url.pathname = !pathname || pathname === '/' ? `/v1/${endpoint}` : `${pathname}/${endpoint}`;
    return url.toString();
}

function extractCodexAnalysisText(payload = {}) {
    if (typeof payload.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();
    const outputText = (Array.isArray(payload.output) ? payload.output : [])
        .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
        .map((item) => String(item?.text || item?.output_text || '').trim())
        .filter(Boolean)
        .join('\n');
    if (outputText) return outputText;
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content.trim();
    return (Array.isArray(content) ? content : [])
        .map((item) => String(item?.text || item?.output_text || '').trim())
        .filter(Boolean)
        .join('\n');
}

async function callCodexAnalysis(supabase, prompt = {}, options = {}) {
    const config = await resolveCodexRuntimeConfig(supabase);
    if (!config?.configured) throw new Error(config?.decryptErrorMessage || 'Codex Relay 未配置');
    const imageUrls = getAnalysisImageUrls(prompt, options.sourceItems || []);
    const images = await loadAnalysisImages(imageUrls, { fetchImage: options.fetchImage, limit: 2 });
    const text = `${ANALYSIS_PROMPT}\nSource prompt:\n${getAnalysisSourcePrompt(prompt.prompt_text)}`;
    const apiFormat = config.apiFormat === 'responses' ? 'responses' : 'chat.completions';
    const imageDataUrls = images.map((buffer) => `data:image/webp;base64,${buffer.toString('base64')}`);
    const body = apiFormat === 'responses'
        ? {
            model: config.model,
            input: [{
                role: 'user',
                content: [
                    { type: 'input_text', text },
                    ...imageDataUrls.map((imageUrl) => ({ type: 'input_image', image_url: imageUrl }))
                ]
            }],
            max_output_tokens: MAX_ANALYSIS_OUTPUT_TOKENS
        }
        : {
            model: config.model,
            messages: [{
                role: 'user',
                content: [
                    { type: 'text', text },
                    ...imageDataUrls.map((imageUrl) => ({ type: 'image_url', image_url: { url: imageUrl } }))
                ]
            }],
            max_tokens: MAX_ANALYSIS_OUTPUT_TOKENS,
            temperature: 0.25
        };
    let response;
    try {
        response = await fetch(resolveCodexUpstreamUrl(config.baseUrl, apiFormat), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(150000)
        });
    } catch (cause) {
        const error = new Error(`Codex Relay request timed out or failed: ${cause.message || cause}`);
        error.retryable = true;
        error.retryAfterMs = 30000;
        error.cause = cause;
        throw error;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(payload?.error?.message || `Codex Relay request failed (${response.status})`);
        error.status = response.status;
        error.retryable = RETRYABLE_ANALYSIS_STATUS_CODES.has(response.status);
        const retryAfterSeconds = Number(response.headers.get('retry-after') || 0);
        if (retryAfterSeconds > 0) error.retryAfterMs = retryAfterSeconds * 1000;
        throw error;
    }
    return parseJsonText(extractCodexAnalysisText(payload));
}

async function fetchAnalysisImage(url) {
    const hostname = (() => {
        try {
            return new URL(url).hostname;
        } catch (_) {
            return 'invalid-url';
        }
    })();
    let response;
    try {
        response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    } catch (cause) {
        const error = new Error(`Image request failed (${hostname}): ${cause.message || cause}`);
        error.retryable = true;
        error.cause = cause;
        throw error;
    }
    if (!response.ok) {
        const error = new Error(`Image request failed (${response.status}, ${hostname})`);
        error.retryable = RETRYABLE_IMAGE_STATUS_CODES.has(response.status);
        throw error;
    }
    const input = Buffer.from(await response.arrayBuffer());
    try {
        return await sharp(input).rotate().resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 74 }).toBuffer();
    } catch (cause) {
        const error = new Error(`Image decode failed (${hostname}): ${cause.message || cause}`);
        error.retryable = false;
        error.cause = cause;
        throw error;
    }
}

function normalizeAnalysisImageUrl(value) {
    if (value && typeof value === 'object') {
        return String(value.url || value.original || '').trim();
    }
    return String(value || '').trim();
}

function getAnalysisImageUrls(prompt = {}, sourceItems = []) {
    const candidates = [];
    const append = (values = []) => {
        (Array.isArray(values) ? values : []).forEach((value) => {
            const url = normalizeAnalysisImageUrl(value);
            if (url) candidates.push(url);
        });
    };
    sourceItems.filter(Boolean).forEach((item) => append(item.image_sources));
    append(prompt.images);
    append(prompt.image_assets);
    sourceItems.filter(Boolean).forEach((item) => append(item.final_image_assets));
    const unique = [...new Set(candidates)];
    return unique
        .map((url, index) => ({ url, index, avif: /\.avif(?:$|[?#])/i.test(url) }))
        .sort((left, right) => Number(left.avif) - Number(right.avif) || left.index - right.index)
        .slice(0, 12)
        .map((item) => item.url);
}

async function loadAnalysisImages(imageUrls = [], { fetchImage = fetchAnalysisImage, limit = 4 } = {}) {
    const results = await Promise.allSettled(imageUrls.map(fetchImage));
    const images = results
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value)
        .slice(0, limit);
    if (images.length) return images;
    const failures = results
        .filter((result) => result.status === 'rejected')
        .map((result) => result.reason);
    const details = failures.map((error) => String(error?.message || error || 'unknown image error')).slice(0, 3);
    const error = new Error(`Image processing failed: ${details.join(' | ') || 'no image candidates'}`);
    error.retryable = failures.some((failure) => failure?.retryable === true);
    error.details = { image_failures: details };
    throw error;
}

async function callGeminiAnalysis(supabase, prompt = {}, options = {}) {
    const config = await resolveGeminiRuntimeConfig(supabase);
    if (!config?.apiKey) throw new Error('Gemini API Key 未配置');
    const imageUrls = getAnalysisImageUrls(prompt, options.sourceItems || []);
    const images = await loadAnalysisImages(imageUrls, { fetchImage: options.fetchImage, limit: 4 });
    const parts = [
        { text: `${ANALYSIS_PROMPT}\nSource prompt:\n${getAnalysisSourcePrompt(prompt.prompt_text)}` },
        ...images.map((buffer) => ({ inline_data: { mime_type: 'image/webp', data: buffer.toString('base64') } }))
    ];
    const model = config.model || 'gemini-2.5-flash';
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.25, maxOutputTokens: MAX_ANALYSIS_OUTPUT_TOKENS, responseMimeType: 'application/json' } }),
        signal: AbortSignal.timeout(90000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || `Gemini request failed (${response.status})`);
    const text = (payload.candidates || []).flatMap((candidate) => candidate?.content?.parts || []).map((part) => part?.text || '').join('\n');
    return parseJsonText(text);
}

async function callConfiguredAnalysis(supabase, prompt = {}, options = {}) {
    const service = await resolvePromptImportAiService(supabase);
    return service === 'codex'
        ? callCodexAnalysis(supabase, prompt, options)
        : callGeminiAnalysis(supabase, prompt, options);
}

function buildPromptPatch(prompt = {}, result = {}) {
    const existingAiTags = prompt.ai_tags && typeof prompt.ai_tags === 'object' ? prompt.ai_tags : {};
    const sourcePrompt = String(prompt.prompt_text || '').trim();
    const sourceLanguage = getSourcePromptLanguage(sourcePrompt);
    return {
        title: String(result.title || result.title_en || 'Creative Prompt').trim(),
        title_en: String(result.title_en || result.title || '').trim(),
        title_zh: String(result.title_zh || '').trim(),
        description: String(result.description || result.description_en || '').trim(),
        description_en: String(result.description_en || result.description || '').trim(),
        description_zh: String(result.description_zh || '').trim(),
        prompt_text_en: sourceLanguage === 'en' ? sourcePrompt : String(result.prompt_text_en || '').trim(),
        prompt_text_zh: sourceLanguage === 'zh' ? sourcePrompt : String(result.prompt_text_zh || '').trim(),
        tags: [String(result.category || 'Creative').trim()],
        dominant_colors: Array.isArray(result.dominantColors) ? result.dominantColors.slice(0, 4) : [],
        ai_tags: {
            ...existingAiTags,
            objects: result.objects || { en: [], zh: [] },
            scenes: result.scenes || { en: [], zh: [] },
            styles: result.styles || { en: [], zh: [] },
            mood: result.mood || { en: [], zh: [] },
            useCase: result.useCase || {},
            commercial: result.commercial || {},
            difficulty: result.difficulty || '',
            admin: { ...(existingAiTags.admin || {}), status: 'live', source: 'prompt_import_worker' }
        },
        updated_at: new Date().toISOString()
    };
}

function getSourcePromptLanguage(value = '') {
    const text = String(value || '');
    const cjkCount = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
    const latinCount = (text.match(/[a-z]/gi) || []).length;
    if (cjkCount >= 4 && cjkCount >= latinCount * 0.15) return 'zh';
    if (latinCount >= 8) return 'en';
    return cjkCount > 0 ? 'zh' : '';
}

function extractCanonicalMediaHeaders(value = '') {
    return Array.from(String(value || '').matchAll(/\[(?:IMAGE|VIDEO)\s*·\s*\d{1,3}\]/gi))
        .map((match) => match[0]);
}

function extractPromptStructureTokens(value = '') {
    const text = String(value || '');
    const patterns = [
        /\bP(?:\d{1,3}|#{1,3})\b/gi,
        /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
        /\b\d+(?:\.\d+)?\s*(?:ms|s|sec|secs|second|seconds|秒|毫秒)\b/gi,
        /\b\d+(?:\.\d+)?%\b/g,
        /\b\d{1,2}:\d{1,2}\b/g
    ];
    return [...new Set(patterns.flatMap((pattern) => text.match(pattern) || []).map((token) => token.toLowerCase()))];
}

function createAnalysisCompletenessError(message, details = {}) {
    const error = new Error(message);
    error.code = 'analysis_prompt_incomplete';
    error.retryable = true;
    error.retryAfterMs = 30000;
    error.details = details;
    return error;
}

function validateTranslatedPromptCompleteness(sourcePrompt = '', translatedPrompt = '', field = '') {
    const source = getAnalysisSourcePrompt(sourcePrompt);
    const translated = String(translatedPrompt || '').trim();
    if (!source || !translated) return;

    const sourceHeaders = extractCanonicalMediaHeaders(source);
    const translatedHeaders = extractCanonicalMediaHeaders(translated);
    if (sourceHeaders.length && JSON.stringify(translatedHeaders) !== JSON.stringify(sourceHeaders)) {
        throw createAnalysisCompletenessError(`分析结果提示词段落不完整：${field}`, {
            field,
            expected_media_headers: sourceHeaders,
            actual_media_headers: translatedHeaders
        });
    }

    if (/(?:\.{3}|…)\s*$/.test(translated)) {
        throw createAnalysisCompletenessError(`分析结果提示词疑似截断：${field}`, { field });
    }

    const sourceLength = source.replace(/\s/g, '').length;
    const translatedLength = translated.replace(/\s/g, '').length;
    if (sourceLength >= 240 && translatedLength < Math.ceil(sourceLength * 0.2)) {
        throw createAnalysisCompletenessError(`分析结果提示词明显短于原文：${field}`, {
            field,
            source_length: sourceLength,
            translated_length: translatedLength
        });
    }

    const missingTokens = extractPromptStructureTokens(source)
        .filter((token) => !translated.toLowerCase().includes(token));
    if (missingTokens.length) {
        throw createAnalysisCompletenessError(`分析结果提示词丢失结构标记：${field}`, {
            field,
            missing_tokens: missingTokens.slice(0, 30)
        });
    }
}

function validateAnalysisResult(result = {}, sourcePrompt = '') {
    const normalizeBilingualGroup = (value) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) return value;
        const items = (Array.isArray(value) ? value : [value]).map((item) => String(item || '').trim()).filter(Boolean);
        return { en: items, zh: items };
    };
    const normalized = {
        ...result,
        objects: normalizeBilingualGroup(result.objects),
        scenes: normalizeBilingualGroup(result.scenes),
        styles: normalizeBilingualGroup(result.styles),
        mood: normalizeBilingualGroup(result.mood)
    };
    const requiredText = ['title_en', 'title_zh', 'description_en', 'description_zh', 'prompt_text_en', 'prompt_text_zh'];
    const missing = requiredText.filter((field) => !String(normalized?.[field] || '').trim());
    const requiredGroups = ['objects', 'scenes', 'styles', 'mood'];
    requiredGroups.forEach((field) => {
        const group = normalized?.[field];
        if (!Array.isArray(group?.en) || !group.en.length || !Array.isArray(group?.zh) || !group.zh.length) missing.push(field);
    });
    if (missing.length) throw createAnalysisCompletenessError(`分析结果不完整：${missing.join(', ')}`, { missing_fields: missing });
    const sourceLanguage = getSourcePromptLanguage(sourcePrompt);
    const translatedFields = sourceLanguage === 'en'
        ? ['prompt_text_zh']
        : sourceLanguage === 'zh'
            ? ['prompt_text_en']
            : ['prompt_text_en', 'prompt_text_zh'];
    translatedFields.forEach((field) => validateTranslatedPromptCompleteness(sourcePrompt, normalized[field], field));
    return normalized;
}

async function claimPromptImportItems(supabase, { workerName, limit = 4, leaseSeconds = 300 } = {}) {
    const { data, error } = await supabase.rpc('claim_prompt_import_items', {
        p_worker_name: workerName,
        p_limit: limit,
        p_lease_seconds: leaseSeconds
    });
    if (error) throw error;
    return data || [];
}

async function isPromptImportItemCancelled(supabase, itemId) {
    const { data, error } = await supabase
        .from('prompt_import_items')
        .select('status')
        .eq('id', itemId)
        .maybeSingle();
    if (error) throw error;
    return !data || String(data.status || '') === 'cleaned';
}

async function processPromptImportItem(supabase, item, { workerName = 'prompt-import-worker' } = {}) {
    const batch = await importsHandler._private.loadImportBatch(supabase, item.batch_id);
    const user = { id: batch.created_by };
    if (await isPromptImportItemCancelled(supabase, item.id)) {
        return { item, cancelled: true };
    }
    let imported;
    if (item.final_prompt_id) {
        const { data: existingPrompt, error: existingPromptError } = await supabase.from('prompts').select('*').eq('id', item.final_prompt_id).single();
        if (existingPromptError) throw existingPromptError;
        imported = { prompt: existingPrompt, item };
    } else {
        imported = await importsHandler._private.importSingleItem(supabase, user, item.id, {
            site: batch.site,
            default_status: 'review',
            cleanup_after_pipeline: false
        });
    }
    if (imported.cancelled || await isPromptImportItemCancelled(supabase, item.id)) {
        return { ...imported, cancelled: true };
    }
    if (!imported.prompt?.id) return imported;
    try {
        await supabase.from('prompt_import_items').update({
            status: 'queued',
            pipeline_stage: 'analysis',
            updated_at: new Date().toISOString()
        }).eq('id', item.id).neq('status', 'cleaned');
        const analysis = validateAnalysisResult(await callConfiguredAnalysis(supabase, imported.prompt, {
            sourceItems: [item, imported.item]
        }), imported.prompt.prompt_text);
        if (await isPromptImportItemCancelled(supabase, item.id)) {
            return { ...imported, cancelled: true };
        }
        const patch = buildPromptPatch(imported.prompt, analysis);
        const { data: prompt, error: promptError } = await supabase.from('prompts').update(patch).eq('id', imported.prompt.id).select('*').single();
        if (promptError) throw promptError;
        const cleaned = importsHandler._private.buildCleanedImportedItemPayload({
            finalPromptId: imported.prompt.id,
            finalImageAssets: imported.item?.final_image_assets || [],
            finalVideoAssets: imported.item?.final_video_assets || []
        });
        const { data: updatedItem, error: itemError } = await supabase.from('prompt_import_items').update({
            ...cleaned,
            worker_name: workerName,
            lease_expires_at: null,
            pipeline_stage: 'completed'
        }).eq('id', item.id).neq('status', 'cleaned').select('*').maybeSingle();
        if (itemError) throw itemError;
        if (!updatedItem) return { ...imported, prompt, cancelled: true };
        await importsHandler._private.updateBatchStats(supabase, item.batch_id);
        return { ...imported, prompt, item: updatedItem };
    } catch (error) {
        if (await isPromptImportItemCancelled(supabase, item.id).catch(() => false)) {
            return { ...imported, cancelled: true };
        }
        const retryable = typeof error.retryable === 'boolean'
            ? error.retryable
            : /429|5\d\d|timeout|timed out|fetch failed|network|gateway|rate limit/i.test(String(error?.message || error));
        const status = Number(error.status || error.statusCode || 0);
        const retryAttempt = Math.max(1, Number(item.error_details?.retry_count || 0) + 1);
        const shouldRetry = retryable && retryAttempt <= 8;
        const baseDelayMs = status === 429 || /rate limit|no available accounts/i.test(String(error?.message || ''))
            ? 60000
            : 30000;
        const retryDelayMs = Math.max(
            Number(error.retryAfterMs || 0),
            Math.min(15 * 60 * 1000, baseDelayMs * (2 ** Math.min(retryAttempt - 1, 4)))
        );
        await supabase.from('prompt_import_items').update({
            status: 'failed',
            error_summary: error.message || '服务端处理失败',
            error_details: { ...(error.details || {}), retry_count: retryAttempt, upstream_status: status || null },
            pipeline_stage: 'analysis',
            lease_expires_at: null,
            processing_attempts: shouldRetry ? Math.max(0, Number(item.processing_attempts || 1) - 1) : 3,
            next_attempt_at: shouldRetry ? new Date(Date.now() + retryDelayMs).toISOString() : null,
            updated_at: new Date().toISOString()
        }).eq('id', item.id).neq('status', 'cleaned');
        throw error;
    }
}

async function runPromptImportWorkerBatch(supabase, options = {}) {
    const items = await claimPromptImportItems(supabase, options);
    const results = await Promise.allSettled(items.map((item) => processPromptImportItem(supabase, item, options)));
    return { claimed: items.length, items, results };
}

module.exports = {
    buildPromptPatch,
    callGeminiAnalysis,
    callCodexAnalysis,
    callConfiguredAnalysis,
    resolvePromptImportAiService,
    claimPromptImportItems,
    fetchAnalysisImage,
    getAnalysisImageUrls,
    getAnalysisSourcePrompt,
    getSourcePromptLanguage,
    loadAnalysisImages,
    isPromptImportItemCancelled,
    processPromptImportItem,
    runPromptImportWorkerBatch,
    validateAnalysisResult,
    validateTranslatedPromptCompleteness
};
