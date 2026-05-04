const { requireAdmin, sendJson } = require('../../../../api/_lib/admin');

const PAGE_SCENES = Object.freeze([
    {
        id: 'home',
        label: '首页',
        tone: 'welcome',
        safe_zone: 'bottom-right',
        events: ['new_user_welcome', 'points_low_balance', 'permission_changed']
    },
    {
        id: 'prompts',
        label: '提示词',
        tone: 'creative',
        safe_zone: 'bottom-right',
        events: ['points_insufficient', 'comment_replied', 'prompt_unlocked']
    },
    {
        id: 'gongyi',
        label: '公益站',
        tone: 'calm',
        safe_zone: 'bottom-right',
        events: ['service_status', 'usage_rules', 'maintenance_notice']
    },
    {
        id: 'shop',
        label: '商城',
        tone: 'commerce',
        safe_zone: 'bottom-right',
        events: ['coupon_available', 'product_discount', 'product_restocked', 'points_insufficient', 'order_status']
    },
    {
        id: 'verify',
        label: '验证',
        tone: 'assistive',
        safe_zone: 'bottom-right',
        events: ['verify_failed', 'verify_queue', 'points_insufficient', 'service_status']
    },
    {
        id: 'guestbook',
        label: '留言板',
        tone: 'community',
        safe_zone: 'bottom-right',
        events: ['comment_replied', 'message_replied', 'community_rule', 'content_featured']
    }
]);

function sanitizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
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
        || text.includes('engagement_')
        || text.includes('schema cache');
}

function normalizeRule(row = {}) {
    return {
        id: sanitizeText(row.id, 160),
        name: sanitizeText(row.name || '未命名触达规则', 160) || '未命名触达规则',
        description: sanitizeText(row.description, 800),
        site: sanitizeText(row.site || 'all', 20) || 'all',
        page_ids: Array.isArray(row.page_ids) ? row.page_ids.map((item) => sanitizeText(item, 80)).filter(Boolean) : ['all'],
        placement: sanitizeText(row.placement || 'robot_bubble', 80) || 'robot_bubble',
        trigger_type: sanitizeText(row.trigger_type || 'page_view', 80) || 'page_view',
        title: sanitizeText(row.title, 160),
        content: sanitizeText(row.content, 800),
        action_label: sanitizeText(row.action_label, 80),
        action_url: sanitizeText(row.action_url, 1000),
        tone: sanitizeText(row.tone || 'info', 40) || 'info',
        icon: sanitizeText(row.icon || 'robot', 40) || 'robot',
        priority: Number(row.priority || 0) || 0,
        frequency: sanitizeText(row.frequency || 'once_per_day', 80) || 'once_per_day',
        dismiss_ttl_hours: Number(row.dismiss_ttl_hours || 24) || 24,
        enabled: row.enabled === true,
        status: sanitizeText(row.status || 'draft', 40) || 'draft',
        starts_at: sanitizeText(row.starts_at, 120),
        ends_at: sanitizeText(row.ends_at, 120),
        metadata: row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata : {},
        updated_at: sanitizeText(row.updated_at, 120)
    };
}

function normalizeTemplate(row = {}) {
    return {
        id: sanitizeText(row.id, 160),
        key: sanitizeText(row.key, 160),
        name: sanitizeText(row.name, 160),
        category: sanitizeText(row.category || 'general', 80) || 'general',
        page_ids: Array.isArray(row.page_ids) ? row.page_ids.map((item) => sanitizeText(item, 80)).filter(Boolean) : ['all'],
        title: sanitizeText(row.title, 160),
        content: sanitizeText(row.content, 800),
        action_label: sanitizeText(row.action_label, 80),
        action_url: sanitizeText(row.action_url, 1000),
        tone: sanitizeText(row.tone || 'info', 40) || 'info'
    };
}

async function fetchEngagementOverview(supabase) {
    const [rulesResult, templatesResult, eventsResult] = await Promise.all([
        supabase
            .from('engagement_rules')
            .select('id,name,description,site,page_ids,placement,trigger_type,title,content,action_label,action_url,tone,icon,priority,frequency,dismiss_ttl_hours,enabled,status,starts_at,ends_at,metadata,updated_at')
            .order('updated_at', { ascending: false })
            .limit(12),
        supabase
            .from('engagement_templates')
            .select('id,key,name,category,page_ids,title,content,action_label,action_url,tone')
            .order('created_at', { ascending: true })
            .limit(24),
        supabase
            .from('engagement_events')
            .select('event_type,page_id,created_at')
            .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
            .limit(500)
    ]);

    if (rulesResult.error && !isMissingEngagementSchemaError(rulesResult.error)) throw rulesResult.error;
    if (templatesResult.error && !isMissingEngagementSchemaError(templatesResult.error)) throw templatesResult.error;
    if (eventsResult.error && !isMissingEngagementSchemaError(eventsResult.error)) throw eventsResult.error;

    const eventRows = Array.isArray(eventsResult.data) ? eventsResult.data : [];
    const eventCounts = eventRows.reduce((accumulator, row) => {
        const type = sanitizeText(row?.event_type || 'unknown', 40) || 'unknown';
        accumulator[type] = (accumulator[type] || 0) + 1;
        return accumulator;
    }, {});

    return {
        schema_ready: !rulesResult.error && !templatesResult.error && !eventsResult.error,
        page_scenes: PAGE_SCENES,
        rules: (Array.isArray(rulesResult.data) ? rulesResult.data : []).map(normalizeRule),
        templates: (Array.isArray(templatesResult.data) ? templatesResult.data : []).map(normalizeTemplate),
        metrics: {
            last_24h_events: eventRows.length,
            views: Number(eventCounts.view || 0),
            clicks: Number(eventCounts.click || 0),
            dismisses: Number(eventCounts.dismiss || 0),
            conversions: Number(eventCounts.conversion || 0)
        }
    };
}

module.exports = async function engagementOverviewHandler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    try {
        const { supabase } = await requireAdmin(req, {
            anyOf: ['chat.manage', 'settings.manage']
        });
        const overview = await fetchEngagementOverview(supabase);
        return sendJson(res, 200, {
            success: true,
            ...overview
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Failed to load engagement overview'
        });
    }
};
