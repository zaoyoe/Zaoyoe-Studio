const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');

const VALID_TEMPLATE_PAGES = Object.freeze(new Set(['all', 'home', 'prompts', 'gongyi', 'shop', 'verify', 'guestbook']));
const VALID_TEMPLATE_TONES = Object.freeze(new Set(['info', 'success', 'warning', 'alert', 'error', 'welcome', 'creative', 'calm', 'commerce', 'assistive', 'community']));

function sanitizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function slugify(value = '', fallback = 'template') {
    const slug = sanitizeText(value, 120)
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return slug || `${fallback}-${Date.now().toString(36)}`;
}

function normalizePageIds(value) {
    const source = Array.isArray(value)
        ? value
        : String(value || '').split(/[\s,;|]+/);
    const normalized = [...new Set(source
        .map((item) => sanitizeText(item, 80).toLowerCase())
        .filter((item) => VALID_TEMPLATE_PAGES.has(item)))];
    if (!normalized.length || normalized.includes('all')) return ['all'];
    return normalized;
}

function normalizeTone(value = 'info') {
    const normalized = sanitizeText(value, 40).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'info';
    return VALID_TEMPLATE_TONES.has(normalized) ? normalized : 'info';
}

function normalizeMetadata(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeTemplate(row = {}) {
    return {
        id: sanitizeText(row.id, 160),
        key: sanitizeText(row.key, 160),
        name: sanitizeText(row.name || '未命名模板', 160) || '未命名模板',
        description: sanitizeText(row.description, 800),
        category: sanitizeText(row.category || 'general', 80) || 'general',
        page_ids: normalizePageIds(row.page_ids),
        title: sanitizeText(row.title, 160),
        content: sanitizeText(row.content, 1200),
        action_label: sanitizeText(row.action_label, 80),
        action_url: sanitizeText(row.action_url, 1000),
        tone: normalizeTone(row.tone),
        metadata: normalizeMetadata(row.metadata),
        updated_at: sanitizeText(row.updated_at, 120),
        created_at: sanitizeText(row.created_at, 120)
    };
}

function buildTemplatePayload(body = {}) {
    const name = sanitizeText(body.name, 160);
    const title = sanitizeText(body.title || name, 160);
    const content = sanitizeText(body.content, 1200);
    if (!name || !title || !content) {
        const error = new Error('模板名称、标题和内容不能为空');
        error.statusCode = 400;
        throw error;
    }
    return {
        key: slugify(body.key || name || title, 'template'),
        name,
        description: sanitizeText(body.description, 800),
        category: sanitizeText(body.category || 'general', 80).toLowerCase() || 'general',
        page_ids: normalizePageIds(body.page_ids || body.pageIds),
        title,
        content,
        action_label: sanitizeText(body.action_label || body.actionLabel, 80),
        action_url: sanitizeText(body.action_url || body.actionUrl, 1000),
        tone: normalizeTone(body.tone),
        metadata: normalizeMetadata(body.metadata)
    };
}

async function listTemplates(supabase) {
    const { data, error } = await supabase
        .from('engagement_templates')
        .select('id,key,name,description,category,page_ids,title,content,action_label,action_url,tone,metadata,created_at,updated_at')
        .order('updated_at', { ascending: false })
        .limit(100);
    if (error) throw error;
    return (Array.isArray(data) ? data : []).map(normalizeTemplate);
}

async function saveTemplate({ supabase, user, body }) {
    const id = sanitizeText(body.id || body.template_id || body.templateId, 160);
    const payload = buildTemplatePayload(body);
    const query = id
        ? supabase.from('engagement_templates').update(payload).eq('id', id)
        : supabase.from('engagement_templates').insert(payload);
    const { data, error } = await query
        .select('id,key,name,description,category,page_ids,title,content,action_label,action_url,tone,metadata,created_at,updated_at')
        .single();
    if (error) throw error;

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'engagement',
        actionType: id ? 'engagement.template.update' : 'engagement.template.create',
        details: {
            template_id: data?.id || id,
            key: payload.key,
            name: payload.name,
            category: payload.category,
            page_ids: payload.page_ids
        }
    });

    return normalizeTemplate(data);
}

async function deleteTemplate({ supabase, user, body }) {
    const id = sanitizeText(body.id || body.template_id || body.templateId, 160);
    if (!id) {
        const error = new Error('template id is required');
        error.statusCode = 400;
        throw error;
    }
    const { data, error } = await supabase
        .from('engagement_templates')
        .delete()
        .eq('id', id)
        .select('id,key,name')
        .maybeSingle();
    if (error) throw error;
    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'engagement',
        actionType: 'engagement.template.delete',
        details: {
            template_id: id,
            key: data?.key,
            name: data?.name
        }
    });
    return { id };
}

module.exports = async function engagementTemplatesHandler(req, res) {
    try {
        const { supabase, user } = await requireAdmin(req, {
            anyOf: ['chat.manage', 'settings.manage']
        });

        if (req.method === 'GET') {
            const templates = await listTemplates(supabase);
            return sendJson(res, 200, {
                success: true,
                templates
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
        const action = sanitizeText(body.action || 'save', 40).toLowerCase();
        if (action === 'delete') {
            const result = await deleteTemplate({ supabase, user, body });
            return sendJson(res, 200, {
                success: true,
                deleted: result.id
            });
        }

        const template = await saveTemplate({ supabase, user, body });
        return sendJson(res, 200, {
            success: true,
            template
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Failed to manage engagement templates'
        });
    }
};
