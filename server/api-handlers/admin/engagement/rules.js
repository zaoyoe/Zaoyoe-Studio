const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');

const VALID_RULE_SITES = Object.freeze(new Set(['all', 'cn', 'intl']));
const VALID_RULE_STATUSES = Object.freeze(new Set(['draft', 'published', 'paused', 'archived']));
const VALID_RULE_PAGES = Object.freeze(new Set(['all', 'home', 'prompts', 'gongyi', 'shop', 'verify', 'guestbook']));
const VALID_RULE_TONES = Object.freeze(new Set(['info', 'success', 'warning', 'alert', 'error', 'welcome', 'creative', 'calm', 'commerce', 'assistive', 'community']));

function sanitizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeBoolean(value, fallback = false) {
    if (value === true || value === 'true' || value === 1 || value === '1') return true;
    if (value === false || value === 'false' || value === 0 || value === '0') return false;
    return fallback;
}

function normalizeInteger(value, fallback = 0, { min = -1000, max = 1000 } = {}) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
}

function normalizeSite(value = 'all') {
    const normalized = sanitizeText(value, 20).toLowerCase() || 'all';
    return VALID_RULE_SITES.has(normalized) ? normalized : 'all';
}

function normalizeStatus(value = 'draft') {
    const normalized = sanitizeText(value, 40).toLowerCase() || 'draft';
    return VALID_RULE_STATUSES.has(normalized) ? normalized : 'draft';
}

function normalizeTone(value = 'info') {
    const normalized = sanitizeText(value, 40).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'info';
    return VALID_RULE_TONES.has(normalized) ? normalized : 'info';
}

function normalizePageIds(value) {
    const source = Array.isArray(value)
        ? value
        : String(value || '').split(/[\s,;|]+/);
    const normalized = [...new Set(source
        .map((item) => sanitizeText(item, 80).toLowerCase())
        .filter((item) => VALID_RULE_PAGES.has(item)))];
    if (!normalized.length || normalized.includes('all')) {
        return ['all'];
    }
    return normalized;
}

function normalizeMetadata(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function isMissingEngagementSchemaError(error) {
    const text = [
        error?.code,
        error?.message,
        error?.details,
        error?.hint
    ].filter(Boolean).join(' ').toLowerCase();
    return error?.code === '42P01'
        || error?.code === '42703'
        || error?.code === 'PGRST205'
        || text.includes('engagement_rules')
        || text.includes('schema cache');
}

function normalizeRule(row = {}) {
    return {
        id: sanitizeText(row.id, 160),
        name: sanitizeText(row.name || '未命名触达规则', 160) || '未命名触达规则',
        description: sanitizeText(row.description, 800),
        site: normalizeSite(row.site),
        page_ids: normalizePageIds(row.page_ids),
        placement: sanitizeText(row.placement || 'robot_bubble', 80) || 'robot_bubble',
        trigger_type: sanitizeText(row.trigger_type || 'page_view', 80) || 'page_view',
        title: sanitizeText(row.title, 160),
        content: sanitizeText(row.content, 1200),
        action_label: sanitizeText(row.action_label, 80),
        action_url: sanitizeText(row.action_url, 1000),
        tone: normalizeTone(row.tone),
        icon: sanitizeText(row.icon || 'robot', 40) || 'robot',
        priority: normalizeInteger(row.priority, 0),
        frequency: sanitizeText(row.frequency || 'once_per_day', 80) || 'once_per_day',
        dismiss_ttl_hours: normalizeInteger(row.dismiss_ttl_hours, 24, { min: 1, max: 720 }),
        enabled: row.enabled === true,
        status: normalizeStatus(row.status),
        starts_at: sanitizeText(row.starts_at, 120),
        ends_at: sanitizeText(row.ends_at, 120),
        metadata: normalizeMetadata(row.metadata),
        updated_at: sanitizeText(row.updated_at, 120),
        created_at: sanitizeText(row.created_at, 120)
    };
}

function buildRulePayload(body = {}, userId = '') {
    const name = sanitizeText(body.name, 160);
    const content = sanitizeText(body.content, 1200);
    const title = sanitizeText(body.title || name || '小助手提醒', 160);
    if (!name || !content) {
        const error = new Error('规则名称和气泡内容不能为空');
        error.statusCode = 400;
        throw error;
    }

    let status = normalizeStatus(body.status);
    const enabled = normalizeBoolean(body.enabled, status === 'published');
    if (enabled && status !== 'published') {
        status = 'published';
    } else if (!enabled && status === 'published') {
        status = 'paused';
    }
    return {
        name,
        description: sanitizeText(body.description, 800),
        site: normalizeSite(body.site),
        page_ids: normalizePageIds(body.page_ids || body.pageIds),
        placement: 'robot_bubble',
        trigger_type: sanitizeText(body.trigger_type || body.triggerType || 'page_view', 80) || 'page_view',
        audience: normalizeMetadata(body.audience),
        title,
        content,
        action_label: sanitizeText(body.action_label || body.actionLabel, 80),
        action_url: sanitizeText(body.action_url || body.actionUrl, 1000),
        tone: normalizeTone(body.tone),
        icon: sanitizeText(body.icon || 'robot', 40) || 'robot',
        priority: normalizeInteger(body.priority, 0),
        frequency: sanitizeText(body.frequency || 'once_per_day', 80) || 'once_per_day',
        dismiss_ttl_hours: normalizeInteger(body.dismiss_ttl_hours || body.dismissTtlHours, 24, { min: 1, max: 720 }),
        enabled,
        status,
        starts_at: sanitizeText(body.starts_at || body.startsAt, 120) || null,
        ends_at: sanitizeText(body.ends_at || body.endsAt, 120) || null,
        metadata: normalizeMetadata(body.metadata),
        updated_by: userId || null
    };
}

async function listRules(supabase, { site = 'all' } = {}) {
    let query = supabase
        .from('engagement_rules')
        .select('id,name,description,site,page_ids,placement,trigger_type,title,content,action_label,action_url,tone,icon,priority,frequency,dismiss_ttl_hours,enabled,status,starts_at,ends_at,metadata,created_at,updated_at')
        .order('updated_at', { ascending: false })
        .limit(100);

    const normalizedSite = normalizeSite(site);
    if (normalizedSite !== 'all') {
        query = query.in('site', ['all', normalizedSite]);
    }

    const { data, error } = await query;
    if (error) throw error;
    return (Array.isArray(data) ? data : []).map(normalizeRule);
}

async function saveRule({ supabase, user, body }) {
    const id = sanitizeText(body.id || body.rule_id || body.ruleId, 160);
    const payload = buildRulePayload(body, user.id);

    let response;
    if (id) {
        response = await supabase
            .from('engagement_rules')
            .update(payload)
            .eq('id', id)
            .select('id,name,description,site,page_ids,placement,trigger_type,title,content,action_label,action_url,tone,icon,priority,frequency,dismiss_ttl_hours,enabled,status,starts_at,ends_at,metadata,created_at,updated_at')
            .single();
    } else {
        response = await supabase
            .from('engagement_rules')
            .insert({
                ...payload,
                created_by: user.id || null
            })
            .select('id,name,description,site,page_ids,placement,trigger_type,title,content,action_label,action_url,tone,icon,priority,frequency,dismiss_ttl_hours,enabled,status,starts_at,ends_at,metadata,created_at,updated_at')
            .single();
    }

    if (response.error) throw response.error;
    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'engagement',
        site: payload.site,
        actionType: id ? 'engagement.rule.update' : 'engagement.rule.create',
        details: {
            rule_id: response.data?.id || id,
            name: payload.name,
            status: payload.status,
            enabled: payload.enabled,
            page_ids: payload.page_ids
        }
    });

    return normalizeRule(response.data);
}

async function setRuleEnabled({ supabase, user, body }) {
    const id = sanitizeText(body.id || body.rule_id || body.ruleId, 160);
    if (!id) {
        const error = new Error('rule id is required');
        error.statusCode = 400;
        throw error;
    }

    const enabled = normalizeBoolean(body.enabled, false);
    const patch = {
        enabled,
        status: enabled ? 'published' : 'paused',
        updated_by: user.id || null
    };
    const { data, error } = await supabase
        .from('engagement_rules')
        .update(patch)
        .eq('id', id)
        .select('id,name,description,site,page_ids,placement,trigger_type,title,content,action_label,action_url,tone,icon,priority,frequency,dismiss_ttl_hours,enabled,status,starts_at,ends_at,metadata,created_at,updated_at')
        .single();
    if (error) throw error;

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'engagement',
        site: data?.site,
        actionType: enabled ? 'engagement.rule.publish' : 'engagement.rule.pause',
        details: {
            rule_id: id,
            enabled
        }
    });

    return normalizeRule(data);
}

async function archiveRule({ supabase, user, body }) {
    const id = sanitizeText(body.id || body.rule_id || body.ruleId, 160);
    if (!id) {
        const error = new Error('rule id is required');
        error.statusCode = 400;
        throw error;
    }

    const { data, error } = await supabase
        .from('engagement_rules')
        .update({
            enabled: false,
            status: 'archived',
            updated_by: user.id || null
        })
        .eq('id', id)
        .select('id,name,description,site,page_ids,placement,trigger_type,title,content,action_label,action_url,tone,icon,priority,frequency,dismiss_ttl_hours,enabled,status,starts_at,ends_at,metadata,created_at,updated_at')
        .single();
    if (error) throw error;

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'engagement',
        site: data?.site,
        actionType: 'engagement.rule.archive',
        details: {
            rule_id: id
        }
    });

    return normalizeRule(data);
}

module.exports = async function engagementRulesHandler(req, res) {
    try {
        const { supabase, user } = await requireAdmin(req, {
            anyOf: ['chat.manage', 'settings.manage']
        });

        if (req.method === 'GET') {
            const url = new URL(req.url || '', 'http://localhost');
            const rules = await listRules(supabase, {
                site: url.searchParams.get('site') || 'all'
            });
            return sendJson(res, 200, {
                success: true,
                rules
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
        const action = sanitizeText(body.action || 'save_rule', 80).toLowerCase();
        let rule;
        if (action === 'set_enabled' || action === 'toggle_rule') {
            rule = await setRuleEnabled({ supabase, user, body });
        } else if (action === 'archive_rule' || action === 'delete_rule') {
            rule = await archiveRule({ supabase, user, body });
        } else {
            rule = await saveRule({ supabase, user, body });
        }

        return sendJson(res, 200, {
            success: true,
            rule
        });
    } catch (error) {
        const schemaMissing = isMissingEngagementSchemaError(error);
        return sendJson(res, schemaMissing ? 409 : (error.statusCode || 500), {
            success: false,
            message: schemaMissing
                ? '客服系统数据表尚未完成迁移，请先执行 engagement migration'
                : (error.message || 'Failed to update engagement rules')
        });
    }
};
