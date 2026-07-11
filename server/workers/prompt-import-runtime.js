const sharp = require('sharp');
const { resolveGeminiRuntimeConfig } = require('../../api/_lib/secrets');
const importsHandler = require('../api-handlers/admin/prompts/imports');

const ANALYSIS_PROMPT = `Analyze these AI-generated images and the source prompt for a prompt gallery. Return ONLY valid JSON with: title, title_en, title_zh, description, description_en, description_zh, prompt_text_en, prompt_text_zh, category, objects, scenes, styles, mood, useCase, commercial, difficulty, dominantColors. Arrays must be compact and searchable. category must be Photography, Illustration, 3D Art, Miniature, Creative, or Animation. difficulty must be beginner, intermediate, or advanced.`;

function parseJsonText(value = '') {
    const text = String(value || '').trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    return JSON.parse(text);
}

async function fetchAnalysisImage(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Image fetch failed (${response.status})`);
    const input = Buffer.from(await response.arrayBuffer());
    return sharp(input).rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 }).toBuffer();
}

async function callGeminiAnalysis(supabase, prompt = {}) {
    const config = await resolveGeminiRuntimeConfig(supabase);
    if (!config?.apiKey) throw new Error('Gemini API Key 未配置');
    const imageUrls = [...new Set([...(prompt.images || []), ...((prompt.image_assets || []).map((item) => item?.original || item?.url))].filter(Boolean))].slice(0, 4);
    const images = (await Promise.allSettled(imageUrls.map(fetchAnalysisImage)))
        .filter((result) => result.status === 'fulfilled').map((result) => result.value);
    if (!images.length) throw new Error('Image fetch failed: no readable images');
    const parts = [
        { text: `${ANALYSIS_PROMPT}\nSource prompt:\n${String(prompt.prompt_text || '').slice(0, 20000)}` },
        ...images.map((buffer) => ({ inline_data: { mime_type: 'image/webp', data: buffer.toString('base64') } }))
    ];
    const model = config.model || 'gemini-2.5-flash';
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.25, maxOutputTokens: 4096, responseMimeType: 'application/json' } }),
        signal: AbortSignal.timeout(90000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || `Gemini request failed (${response.status})`);
    const text = (payload.candidates || []).flatMap((candidate) => candidate?.content?.parts || []).map((part) => part?.text || '').join('\n');
    return parseJsonText(text);
}

function buildPromptPatch(prompt = {}, result = {}) {
    const existingAiTags = prompt.ai_tags && typeof prompt.ai_tags === 'object' ? prompt.ai_tags : {};
    return {
        title: String(result.title || result.title_en || 'Creative Prompt').trim(),
        title_en: String(result.title_en || result.title || '').trim(),
        title_zh: String(result.title_zh || '').trim(),
        description: String(result.description || result.description_en || '').trim(),
        description_en: String(result.description_en || result.description || '').trim(),
        description_zh: String(result.description_zh || '').trim(),
        prompt_text_en: String(result.prompt_text_en || '').trim(),
        prompt_text_zh: String(result.prompt_text_zh || '').trim(),
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

function validateAnalysisResult(result = {}) {
    const requiredText = ['title_en', 'title_zh', 'description_en', 'description_zh', 'prompt_text_en', 'prompt_text_zh'];
    const missing = requiredText.filter((field) => !String(result?.[field] || '').trim());
    const requiredGroups = ['objects', 'scenes', 'styles', 'mood'];
    requiredGroups.forEach((field) => {
        const group = result?.[field];
        if (!Array.isArray(group?.en) || !group.en.length || !Array.isArray(group?.zh) || !group.zh.length) missing.push(field);
    });
    if (missing.length) throw new Error(`分析结果不完整：${missing.join(', ')}`);
    return result;
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

async function processPromptImportItem(supabase, item, { workerName = 'prompt-import-worker' } = {}) {
    const batch = await importsHandler._private.loadImportBatch(supabase, item.batch_id);
    const user = { id: batch.created_by };
    let imported;
    if (item.final_prompt_id) {
        const { data: existingPrompt, error: existingPromptError } = await supabase.from('prompts').select('*').eq('id', item.final_prompt_id).single();
        if (existingPromptError) throw existingPromptError;
        imported = { prompt: existingPrompt, item };
    } else {
        imported = await importsHandler._private.importSingleItem(supabase, user, item.id, {
            site: batch.site,
            default_status: 'review',
            cleanup_after_pipeline: true
        });
    }
    if (!imported.prompt?.id) return imported;
    try {
        await supabase.from('prompt_import_items').update({
            status: 'queued',
            pipeline_stage: 'analysis',
            updated_at: new Date().toISOString()
        }).eq('id', item.id);
        const analysis = validateAnalysisResult(await callGeminiAnalysis(supabase, imported.prompt));
        const patch = buildPromptPatch(imported.prompt, analysis);
        const { data: prompt, error: promptError } = await supabase.from('prompts').update(patch).eq('id', imported.prompt.id).select('*').single();
        if (promptError) throw promptError;
        const cleaned = importsHandler._private.buildCleanedImportedItemPayload({
            finalPromptId: imported.prompt.id,
            finalImageAssets: imported.item?.final_image_assets || []
        });
        const { data: updatedItem, error: itemError } = await supabase.from('prompt_import_items').update({
            ...cleaned,
            worker_name: workerName,
            lease_expires_at: null,
            pipeline_stage: 'completed'
        }).eq('id', item.id).select('*').single();
        if (itemError) throw itemError;
        await importsHandler._private.updateBatchStats(supabase, item.batch_id);
        return { ...imported, prompt, item: updatedItem };
    } catch (error) {
        const retryable = /429|5\d\d|timeout|timed out|fetch failed|network|gateway|rate limit/i.test(String(error?.message || error));
        await supabase.from('prompt_import_items').update({
            status: 'failed',
            error_summary: error.message || '服务端处理失败',
            pipeline_stage: 'analysis',
            lease_expires_at: null,
            next_attempt_at: retryable ? new Date(Date.now() + 15000).toISOString() : null,
            updated_at: new Date().toISOString()
        }).eq('id', item.id);
        throw error;
    }
}

async function runPromptImportWorkerBatch(supabase, options = {}) {
    const items = await claimPromptImportItems(supabase, options);
    const results = await Promise.allSettled(items.map((item) => processPromptImportItem(supabase, item, options)));
    return { claimed: items.length, results };
}

module.exports = { buildPromptPatch, callGeminiAnalysis, claimPromptImportItems, processPromptImportItem, runPromptImportWorkerBatch, validateAnalysisResult };
