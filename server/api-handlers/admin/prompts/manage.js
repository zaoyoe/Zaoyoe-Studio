const {
    normalizeAdminSite,
    parseJsonBody,
    requireAdmin,
    requireWritableAdminSite,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');

const PROMPT_REQUIRED_SELECT_FIELDS = [
    'id',
    'title',
    'tags',
    'description',
    'prompt_text',
    'images',
    'created_at'
];

const PROMPT_OPTIONAL_SELECT_FIELDS = [
    'dominant_colors',
    'ai_tags',
    'quality_score',
    'updated_at'
];

const PROMPT_BILINGUAL_SELECT_FIELDS = [
    'title_en',
    'title_zh',
    'description_en',
    'description_zh',
    'prompt_text_en',
    'prompt_text_zh'
];

const PROMPT_SELECT_FIELDS = [
    ...PROMPT_REQUIRED_SELECT_FIELDS,
    ...PROMPT_OPTIONAL_SELECT_FIELDS,
    ...PROMPT_BILINGUAL_SELECT_FIELDS
].join(', ');

const PROMPT_LEGACY_SELECT_FIELDS = PROMPT_REQUIRED_SELECT_FIELDS.join(', ');
const OPTIONAL_PROMPT_COLUMN_FIELDS = [
    ...PROMPT_OPTIONAL_SELECT_FIELDS,
    ...PROMPT_BILINGUAL_SELECT_FIELDS
];
const OPTIONAL_PROMPT_MUTATION_FIELDS = new Set([
    ...OPTIONAL_PROMPT_COLUMN_FIELDS,
    'updated_at'
]);

function getSearchParams(req) {
    const url = new URL(req.url || '', 'http://localhost');
    return url.searchParams;
}

function normalizePromptId(value) {
    return String(value || '').trim();
}

function normalizePromptSiteContext(value) {
    return normalizeAdminSite(value, { defaultValue: 'all' }) || 'all';
}

function normalizePromptMetricSite(value) {
    return String(value || '').trim().toLowerCase() === 'intl' ? 'intl' : 'cn';
}

function isMissingOptionalPromptColumnError(error) {
    const message = String(error?.message || '').toLowerCase();
    if (!message) return false;

    return OPTIONAL_PROMPT_COLUMN_FIELDS.some((field) => (
        message.includes(`column ${field}`) ||
        message.includes(`prompts.${field}`) ||
        message.includes(`"${field}"`)
    ));
}

function isMissingOptionalPromptMetricSiteError(error, table) {
    const message = String(error?.message || '').toLowerCase();
    if (!message) return false;

    return (
        message.includes('column site') ||
        message.includes(`${table}.site`) ||
        message.includes('"site"')
    );
}

function isMissingPromptMetricTableError(error, table) {
    const message = String(error?.message || '').toLowerCase();
    if (!message) return false;

    return (
        message.includes(`relation "${table}" does not exist`) ||
        message.includes(`relation '${table}' does not exist`) ||
        message.includes(`${table} does not exist`) ||
        message.includes(`could not find the table '${table}'`) ||
        message.includes(`could not find the table "${table}"`)
    );
}

function toUniqueStringArray(value) {
    const values = Array.isArray(value)
        ? value
        : (typeof value === 'string' && value.trim() ? [value] : []);

    return [...new Set(
        values
            .map((item) => String(item || '').trim())
            .filter(Boolean)
    )];
}

function normalizeOptionalText(value) {
    if (value === undefined) return undefined;
    if (value === null) return '';
    return String(value);
}

function normalizeOptionalStringArray(value, fieldName) {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) {
        const error = new Error(`${fieldName} must be an array`);
        error.statusCode = 400;
        throw error;
    }

    return value
        .map((item) => String(item || '').trim())
        .filter(Boolean);
}

function normalizeOptionalObject(value, fieldName) {
    if (value === undefined) return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        const error = new Error(`${fieldName} must be an object`);
        error.statusCode = 400;
        throw error;
    }
    return value;
}

function applyPromptFieldFallbacks(row = {}) {
    const safeRow = row && typeof row === 'object' ? { ...row } : {};

    if (!Object.prototype.hasOwnProperty.call(safeRow, 'dominant_colors')) {
        safeRow.dominant_colors = [];
    }

    if (!Object.prototype.hasOwnProperty.call(safeRow, 'ai_tags')) {
        safeRow.ai_tags = {};
    }

    if (!Object.prototype.hasOwnProperty.call(safeRow, 'quality_score')) {
        safeRow.quality_score = null;
    }

    for (const fieldName of PROMPT_BILINGUAL_SELECT_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(safeRow, fieldName)) {
            safeRow[fieldName] = '';
        }
    }

    return safeRow;
}

function stripUnsupportedPromptPayloadFields(payload = {}) {
    const safePayload = payload && typeof payload === 'object' ? { ...payload } : {};
    let removed = false;

    for (const fieldName of OPTIONAL_PROMPT_MUTATION_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(safePayload, fieldName)) {
            delete safePayload[fieldName];
            removed = true;
        }
    }

    return {
        payload: safePayload,
        removed
    };
}

function buildPromptMutationPayload(body, { action = 'create' } = {}) {
    const payload = {};
    const normalizedAction = String(action || 'create').trim().toLowerCase();
    const partial = normalizedAction === 'patch';

    if (Object.prototype.hasOwnProperty.call(body, 'title') || !partial) {
        const title = normalizeOptionalText(body.title);
        if (!partial && !String(title || '').trim()) {
            const error = new Error('title is required');
            error.statusCode = 400;
            throw error;
        }
        if (title !== undefined) payload.title = title || '';
    }

    if (Object.prototype.hasOwnProperty.call(body, 'tags') || Object.prototype.hasOwnProperty.call(body, 'category') || !partial) {
        const rawTags = Object.prototype.hasOwnProperty.call(body, 'tags')
            ? body.tags
            : (body.category ? [body.category] : []);
        const tags = toUniqueStringArray(rawTags);
        if (!partial && !tags.length) {
            const error = new Error('tags are required');
            error.statusCode = 400;
            throw error;
        }
        payload.tags = tags;
    }

    const textFields = [
        'description',
        'prompt_text',
        'title_en',
        'title_zh',
        'description_en',
        'description_zh',
        'prompt_text_en',
        'prompt_text_zh'
    ];

    for (const fieldName of textFields) {
        if (!Object.prototype.hasOwnProperty.call(body, fieldName)) continue;
        payload[fieldName] = normalizeOptionalText(body[fieldName]) || '';
    }

    const images = normalizeOptionalStringArray(body.images, 'images');
    if (images !== undefined) payload.images = images;

    const dominantColors = normalizeOptionalStringArray(body.dominant_colors ?? body.dominantColors, 'dominant_colors');
    if (dominantColors !== undefined) payload.dominant_colors = dominantColors;

    const aiTags = normalizeOptionalObject(body.ai_tags ?? body.aiTags, 'ai_tags');
    if (aiTags !== undefined) payload.ai_tags = aiTags;

    if (Object.prototype.hasOwnProperty.call(body, 'quality_score')) {
        if (body.quality_score === null || body.quality_score === '') {
            payload.quality_score = null;
        } else {
            const parsedScore = Number(body.quality_score);
            if (!Number.isFinite(parsedScore)) {
                const error = new Error('quality_score must be a number');
                error.statusCode = 400;
                throw error;
            }
            payload.quality_score = parsedScore;
        }
    }

    if (!Object.keys(payload).length) {
        const error = new Error('No prompt fields to save');
        error.statusCode = 400;
        throw error;
    }

    if (normalizedAction === 'update' || normalizedAction === 'patch') {
        payload.updated_at = new Date().toISOString();
    }

    return payload;
}

async function loadPromptList(supabase) {
    const primaryResult = await supabase
        .from('prompts')
        .select(PROMPT_SELECT_FIELDS)
        .order('created_at', { ascending: false });

    if (!primaryResult?.error) {
        return (primaryResult.data || []).map((row) => applyPromptFieldFallbacks(row));
    }

    if (!isMissingOptionalPromptColumnError(primaryResult.error)) {
        throw primaryResult.error;
    }

    const fallbackResult = await supabase
        .from('prompts')
        .select(PROMPT_LEGACY_SELECT_FIELDS)
        .order('created_at', { ascending: false });

    if (fallbackResult.error) throw fallbackResult.error;
    return (fallbackResult.data || []).map((row) => applyPromptFieldFallbacks(row));
}

async function loadPromptById(supabase, id) {
    const primaryResult = await supabase
        .from('prompts')
        .select(PROMPT_SELECT_FIELDS)
        .eq('id', id)
        .single();

    if (!primaryResult?.error) {
        return applyPromptFieldFallbacks(primaryResult.data);
    }

    if (isMissingOptionalPromptColumnError(primaryResult.error)) {
        const fallbackResult = await supabase
            .from('prompts')
            .select(PROMPT_LEGACY_SELECT_FIELDS)
            .eq('id', id)
            .single();

        if (!fallbackResult?.error) {
            return applyPromptFieldFallbacks(fallbackResult.data);
        }

        if (fallbackResult.error.code === 'PGRST116') {
            const notFoundError = new Error('Prompt not found');
            notFoundError.statusCode = 404;
            throw notFoundError;
        }
        throw fallbackResult.error;
    }

    if (primaryResult.error.code === 'PGRST116') {
        const notFoundError = new Error('Prompt not found');
        notFoundError.statusCode = 404;
        throw notFoundError;
    }

    throw primaryResult.error;
}

function createEmptyPromptSiteMetrics() {
    return {
        cn: { unlock_count: 0, comment_count: 0 },
        intl: { unlock_count: 0, comment_count: 0 },
        total: { unlock_count: 0, comment_count: 0 }
    };
}

async function loadPromptMetricRows(supabase, table, promptIds) {
    if (!promptIds.length) return [];

    const primaryResult = await supabase
        .from(table)
        .select('prompt_id, site')
        .in('prompt_id', promptIds);

    if (!primaryResult?.error) {
        return primaryResult.data || [];
    }

    if (isMissingPromptMetricTableError(primaryResult.error, table)) {
        return [];
    }

    if (!isMissingOptionalPromptMetricSiteError(primaryResult.error, table)) {
        throw primaryResult.error;
    }

    const fallbackResult = await supabase
        .from(table)
        .select('prompt_id')
        .in('prompt_id', promptIds);

    if (fallbackResult.error) {
        if (isMissingPromptMetricTableError(fallbackResult.error, table)) {
            return [];
        }
        throw fallbackResult.error;
    }

    return (fallbackResult.data || []).map((row) => ({
        ...row,
        site: 'cn'
    }));
}

async function attachPromptSiteMetrics(supabase, rows) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const promptIds = [...new Set(
        safeRows
            .map((row) => normalizePromptId(row?.id))
            .filter(Boolean)
    )];

    if (!promptIds.length) return safeRows;

    const metricsById = new Map(
        promptIds.map((id) => [id, createEmptyPromptSiteMetrics()])
    );

    const [unlockRows, commentRows] = await Promise.all([
        loadPromptMetricRows(supabase, 'prompt_unlocks', promptIds),
        loadPromptMetricRows(supabase, 'prompt_comments', promptIds)
    ]);

    for (const row of unlockRows) {
        const promptId = normalizePromptId(row?.prompt_id);
        const metrics = metricsById.get(promptId);
        if (!metrics) continue;
        const site = normalizePromptMetricSite(row?.site);
        metrics[site].unlock_count += 1;
        metrics.total.unlock_count += 1;
    }

    for (const row of commentRows) {
        const promptId = normalizePromptId(row?.prompt_id);
        const metrics = metricsById.get(promptId);
        if (!metrics) continue;
        const site = normalizePromptMetricSite(row?.site);
        metrics[site].comment_count += 1;
        metrics.total.comment_count += 1;
    }

    return safeRows.map((row) => ({
        ...row,
        site_metrics: metricsById.get(normalizePromptId(row?.id)) || createEmptyPromptSiteMetrics()
    }));
}

async function insertPromptRow(supabase, payload) {
    const primaryResult = await supabase
        .from('prompts')
        .insert(payload)
        .select(PROMPT_SELECT_FIELDS)
        .single();

    if (!primaryResult?.error) {
        return applyPromptFieldFallbacks(primaryResult.data);
    }

    if (!isMissingOptionalPromptColumnError(primaryResult.error)) {
        throw primaryResult.error;
    }

    const { payload: fallbackPayload, removed } = stripUnsupportedPromptPayloadFields(payload);
    if (!removed) {
        throw primaryResult.error;
    }

    const fallbackResult = await supabase
        .from('prompts')
        .insert(fallbackPayload)
        .select(PROMPT_LEGACY_SELECT_FIELDS)
        .single();

    if (fallbackResult.error) {
        throw fallbackResult.error;
    }

    return applyPromptFieldFallbacks(fallbackResult.data);
}

async function updatePromptRow(supabase, id, payload) {
    const primaryResult = await supabase
        .from('prompts')
        .update(payload)
        .eq('id', id)
        .select(PROMPT_SELECT_FIELDS)
        .single();

    if (!primaryResult?.error) {
        return applyPromptFieldFallbacks(primaryResult.data);
    }

    if (!isMissingOptionalPromptColumnError(primaryResult.error)) {
        throw primaryResult.error;
    }

    const { payload: fallbackPayload, removed } = stripUnsupportedPromptPayloadFields(payload);
    if (!removed) {
        throw primaryResult.error;
    }

    const fallbackResult = await supabase
        .from('prompts')
        .update(fallbackPayload)
        .eq('id', id)
        .select(PROMPT_LEGACY_SELECT_FIELDS)
        .single();

    if (fallbackResult.error) {
        throw fallbackResult.error;
    }

    return applyPromptFieldFallbacks(fallbackResult.data);
}

module.exports = async (req, res) => {
    const method = String(req.method || 'GET').toUpperCase();

    if (!['GET', 'POST', 'DELETE'].includes(method)) {
        res.setHeader('Allow', 'GET, POST, DELETE');
        return sendJson(res, 405, { success: false, message: 'Method not allowed' });
    }

    try {
        const accessOptions = method === 'GET'
            ? { anyOf: ['prompts.manage', 'content.moderate'] }
            : { permission: 'prompts.manage' };
        const { supabase, user } = await requireAdmin(req, accessOptions);
        const searchParams = getSearchParams(req);
        const readSite = normalizePromptSiteContext(searchParams.get('site') || req.adminSite);

        if (method === 'GET') {
            const id = normalizePromptId(searchParams.get('id'));
            if (id) {
                const [rowWithMetrics] = await attachPromptSiteMetrics(supabase, [
                    await loadPromptById(supabase, id)
                ]);
                return sendJson(res, 200, {
                    success: true,
                    siteContext: readSite,
                    row: rowWithMetrics
                });
            }

            const rows = await attachPromptSiteMetrics(supabase, await loadPromptList(supabase));
            return sendJson(res, 200, {
                success: true,
                siteContext: readSite,
                rows
            });
        }

        const body = await parseJsonBody(req);
        const site = requireWritableAdminSite(body.site || req.adminSite, { fieldName: 'site' });

        if (method === 'DELETE') {
            const ids = toUniqueStringArray(body.ids || body.id);
            if (!ids.length) {
                return sendJson(res, 400, { success: false, message: 'id or ids is required' });
            }

            const { data, error } = await supabase
                .from('prompts')
                .delete()
                .in('id', ids)
                .select('id, title');

            if (error) throw error;

            const deletedRows = data || [];
            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'prompts',
                site,
                actionType: ids.length > 1 ? 'prompt.delete_many' : 'prompt.delete',
                details: {
                    prompt_ids: deletedRows.map((row) => row.id),
                    prompt_titles: deletedRows.map((row) => row.title).filter(Boolean),
                    deleted_count: deletedRows.length
                }
            });

            return sendJson(res, 200, {
                success: true,
                site,
                deletedCount: deletedRows.length,
                ids: deletedRows.map((row) => row.id)
            });
        }

        const action = String(body.action || (body.id ? 'update' : 'create')).trim().toLowerCase();
        if (!['create', 'update', 'patch'].includes(action)) {
            return sendJson(res, 400, { success: false, message: 'Unsupported prompt action' });
        }

        const payload = buildPromptMutationPayload(body, { action });

        if (action === 'create') {
            const data = await insertPromptRow(supabase, payload);

            await writeAdminAuditLog({
                supabase,
                adminId: user.id,
                module: 'prompts',
                site,
                actionType: 'prompt.create',
                details: {
                    prompt_id: data.id,
                    title: data.title,
                    tags: data.tags || []
                }
            });

            return sendJson(res, 200, {
                success: true,
                site,
                row: data
            });
        }

        const id = normalizePromptId(body.id);
        if (!id) {
            return sendJson(res, 400, { success: false, message: 'id is required' });
        }

        let data;
        try {
            data = await updatePromptRow(supabase, id, payload);
        } catch (error) {
            if (error.code === 'PGRST116') {
                return sendJson(res, 404, { success: false, message: 'Prompt not found' });
            }
            throw error;
        }

        await writeAdminAuditLog({
            supabase,
            adminId: user.id,
            module: 'prompts',
            site,
            actionType: action === 'patch' ? 'prompt.patch' : 'prompt.update',
            details: {
                prompt_id: data.id,
                title: data.title,
                tags: data.tags || [],
                updated_fields: Object.keys(payload).filter((field) => field !== 'updated_at')
            }
        });

        return sendJson(res, 200, {
            success: true,
            site,
            row: data
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Prompt manage request failed'
        });
    }
};
