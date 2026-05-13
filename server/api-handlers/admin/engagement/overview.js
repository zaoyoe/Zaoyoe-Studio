const { requireAdmin, sendJson } = require('../../../../api/_lib/admin');
const {
    CONFIG_KEY: EXTERNAL_EMBED_POLICY_CONFIG_KEY,
    buildExternalEmbedDiagnostics,
    buildExternalEmbedSnippet,
    normalizeExternalEmbedPolicy
} = require('../../../../api/_lib/engagement-external-policy');
const {
    loadSiteScopedConfig,
    normalizeEngagementConfigSite
} = require('../../_engagement-site-config');
const ASSET_STYLE_CONFIG_KEY = 'engagement_asset_style_center';
const SUPPORT_ENTRY_CONFIG_KEY = 'engagement_support_entry_center';
const PAGE_SCENE_CONFIG_KEY = 'engagement_page_scenes';
const TAG_CENTER_CONFIG_KEY = 'engagement_user_tag_center';
const OVERVIEW_TASK_TIMEOUT_MS = 6500;
const OVERVIEW_AUTH_TIMEOUT_MS = 9000;
const RULE_MANAGEMENT_LIST_LIMIT = 500;
const VALID_TAG_SOURCES = Object.freeze(new Set(['manual', 'profile_metadata', 'auth_metadata', 'purchase', 'wallet', 'behavior', 'support']));
const PAGE_SCENES = Object.freeze([
    {
        id: 'home',
        label: '首页',
        tone: 'welcome',
        safe_zone: 'bottom-right',
        events: ['new_user_welcome', 'profile_incomplete', 'daily_checkin_available', 'inactive_user_return', 'points_low_balance', 'points_adjusted', 'wallet_recharge_success', 'permission_changed', 'login_risk']
    },
    {
        id: 'prompts',
        label: '提示词',
        tone: 'creative',
        safe_zone: 'bottom-right',
        events: ['points_insufficient', 'comment_replied', 'prompt_unlocked', 'search_no_result', 'content_featured', 'content_moderated']
    },
    {
        id: 'gongyi',
        label: 'API中转',
        tone: 'calm',
        safe_zone: 'bottom-right',
        events: ['service_status', 'usage_rules', 'maintenance_notice', 'community_rule', 'support_reply', 'ticket_updated']
    },
    {
        id: 'shop',
        label: '商城',
        tone: 'commerce',
        safe_zone: 'bottom-right',
        events: ['coupon_available', 'coupon_expiring', 'product_discount', 'product_discount_available', 'product_restocked', 'cart_abandoned', 'points_insufficient', 'payment_failed', 'order_paid', 'order_status', 'order_delivered', 'refund_status']
    },
    {
        id: 'verify',
        label: '验证',
        tone: 'assistive',
        safe_zone: 'bottom-right',
        events: ['verify_failed', 'verify_success', 'verify_queue', 'verification_expiring', 'points_insufficient', 'service_status', 'support_reply', 'ticket_updated']
    },
    {
        id: 'guestbook',
        label: '留言板',
        tone: 'community',
        safe_zone: 'bottom-right',
        events: ['comment_replied', 'message_replied', 'guestbook_mention', 'community_rule', 'content_featured', 'content_moderated']
    }
]);
const DEFAULT_EVENT_PRIORITY_CENTER = Object.freeze({
    first_wave: {
        label: '首波优先',
        events: ['login_risk', 'payment_failed', 'wallet_recharge_failed', 'verify_failed', 'support_reply', 'ticket_updated', 'refund_status', 'order_status', 'order_paid', 'order_delivered', 'content_moderated']
    },
    service: {
        label: '常规服务',
        events: ['verification_expiring', 'permission_changed', 'points_adjusted', 'points_insufficient', 'verify_queue', 'message_replied', 'comment_replied', 'guestbook_mention', 'service_status', 'maintenance_notice', 'usage_rules', 'community_rule']
    },
    marketing: {
        label: '延后营销',
        events: ['coupon_available', 'coupon_expiring', 'product_discount', 'product_discount_available', 'product_restocked', 'cart_abandoned', 'inactive_user_return']
    },
    guidance: {
        label: '体验引导',
        events: ['verify_success', 'prompt_unlocked', 'search_no_result', 'profile_incomplete', 'daily_checkin_available', 'new_user_welcome', 'points_low_balance', 'content_featured', 'wallet_recharge_success']
    }
});
const NOTIFICATION_BRIDGE_EVENT_LABELS = Object.freeze({
    comment_replied: '提示词评论回复',
    message_replied: '留言板新评论',
    guestbook_mention: '留言板评论回复',
    coupon_available: '可领优惠券',
    permission_changed: '账号权限变更',
    points_adjusted: '积分变动',
    content_featured: '内容精选',
    ticket_updated: '工单进展',
    refund_status: '退款进度'
});
const NOTIFICATION_BRIDGE_EVENT_TYPES = Object.freeze(new Set(Object.keys(NOTIFICATION_BRIDGE_EVENT_LABELS)));

function sanitizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeOverviewTaskError(error, label = 'overview') {
    if (!error) return null;
    return {
        label: sanitizeText(label, 80) || 'overview',
        code: sanitizeText(error.code || error.name || 'OVERVIEW_TASK_ERROR', 80),
        statusCode: Number(error.statusCode || error.status || 0) || 0,
        message: sanitizeText(error.message || error.details || String(error), 600),
        details: sanitizeText(error.details || error.hint || '', 600)
    };
}

async function runOverviewTask(label, taskFactory, fallbackValue, timeoutMs = OVERVIEW_TASK_TIMEOUT_MS) {
    let timeoutId = 0;
    const timeoutError = new Error(`${label} query timeout`);
    timeoutError.code = 'ENGAGEMENT_OVERVIEW_TIMEOUT';
    const taskPromise = Promise.resolve()
        .then(taskFactory)
        .then((value) => ({
            ok: true,
            label,
            value,
            error: null,
            timed_out: false
        }))
        .catch((error) => ({
            ok: false,
            label,
            value: fallbackValue,
            error: normalizeOverviewTaskError(error, label),
            timed_out: false
        }));
    const timeoutPromise = new Promise((resolve) => {
        timeoutId = setTimeout(() => {
            resolve({
                ok: false,
                label,
                value: fallbackValue,
                error: normalizeOverviewTaskError(timeoutError, label),
                timed_out: true
            });
        }, timeoutMs);
    });
    try {
        return await Promise.race([taskPromise, timeoutPromise]);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

function getOverviewQueryResult(task = {}, fallbackData = []) {
    const value = task && task.value && typeof task.value === 'object' ? task.value : {};
    if (Object.prototype.hasOwnProperty.call(value, 'data') || Object.prototype.hasOwnProperty.call(value, 'error')) {
        return {
            data: Array.isArray(value.data) ? value.data : fallbackData,
            error: value.error || task.error || null
        };
    }
    return {
        data: fallbackData,
        error: task.error || null
    };
}

function buildOverviewHealth(tasks = [], queryResults = {}) {
    const taskErrors = [];
    tasks.forEach((task) => {
        if (task?.error) taskErrors.push(task.error);
    });
    Object.entries(queryResults || {}).forEach(([label, result]) => {
        if (result?.error) {
            taskErrors.push(normalizeOverviewTaskError(result.error, label));
        }
    });
    const uniqueErrors = Array.from(new Map(taskErrors
        .filter(Boolean)
        .map((error) => [`${error.label}:${error.code}:${error.message}`, error])).values());
    return {
        status: uniqueErrors.length ? 'degraded' : 'ready',
        timeout_ms: OVERVIEW_TASK_TIMEOUT_MS,
        degraded_tasks: uniqueErrors,
        timed_out_tasks: tasks
            .filter((task) => task?.timed_out)
            .map((task) => sanitizeText(task.label, 80))
            .filter(Boolean)
    };
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
    const metadata = normalizeMetadata(row.metadata);
    const repeatIntervalMinutes = normalizeRepeatIntervalMinutes(
        metadata.repeat_interval_minutes ?? metadata.repeatIntervalMinutes,
        2
    );
    const normalized = {
        id: sanitizeText(row.id, 160),
        name: sanitizeText(row.name || '未命名触达规则', 160) || '未命名触达规则',
        description: sanitizeText(row.description, 800),
        site: sanitizeText(row.site || 'all', 20) || 'all',
        page_ids: Array.isArray(row.page_ids) ? row.page_ids.map((item) => sanitizeText(item, 80)).filter(Boolean) : ['all'],
        placement: sanitizeText(row.placement || 'robot_bubble', 80) || 'robot_bubble',
        trigger_type: sanitizeText(row.trigger_type || 'page_view', 80) || 'page_view',
        audience: row.audience && typeof row.audience === 'object' && !Array.isArray(row.audience) ? row.audience : {},
        title: sanitizeText(row.title, 160),
        content: sanitizeText(row.content, 800),
        action_label: sanitizeText(row.action_label, 80),
        action_url: sanitizeText(row.action_url, 1000),
        tone: sanitizeText(row.tone || 'info', 40) || 'info',
        icon: sanitizeText(row.icon || 'robot', 40) || 'robot',
        priority: Number(row.priority || 0) || 0,
        frequency: sanitizeText(row.frequency || 'once_per_day', 80) || 'once_per_day',
        dismiss_ttl_hours: Number(row.dismiss_ttl_hours || 24) || 24,
        repeat_interval_minutes: repeatIntervalMinutes,
        enabled: row.enabled === true,
        status: sanitizeText(row.status || 'draft', 40) || 'draft',
        starts_at: sanitizeText(row.starts_at, 120),
        ends_at: sanitizeText(row.ends_at, 120),
        metadata,
        updated_at: sanitizeText(row.updated_at, 120)
    };
    normalized.governance = normalizeMetadata(metadata.governance);
    if (!normalized.governance.risk_level) {
        normalized.governance = buildRuleGovernance(normalized);
    }
    return normalized;
}

function normalizeTemplate(row = {}) {
    return {
        id: sanitizeText(row.id, 160),
        key: sanitizeText(row.key, 160),
        name: sanitizeText(row.name, 160),
        description: sanitizeText(row.description, 800),
        category: sanitizeText(row.category || 'general', 80) || 'general',
        page_ids: Array.isArray(row.page_ids) ? row.page_ids.map((item) => sanitizeText(item, 80)).filter(Boolean) : ['all'],
        title: sanitizeText(row.title, 160),
        content: sanitizeText(row.content, 800),
        action_label: sanitizeText(row.action_label, 80),
        action_url: sanitizeText(row.action_url, 1000),
        tone: sanitizeText(row.tone || 'info', 40) || 'info',
        metadata: normalizeMetadata(row.metadata),
        created_at: sanitizeText(row.created_at, 120),
        updated_at: sanitizeText(row.updated_at, 120)
    };
}

function normalizeMetadata(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeStringArray(value, maxLength = 80) {
    const source = Array.isArray(value) ? value : String(value || '').split(/[\n,;|]+/);
    return [...new Set(source.map((item) => sanitizeText(item, maxLength)).filter(Boolean))];
}

function normalizeEventPriorityCenter(value = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const fallback = DEFAULT_EVENT_PRIORITY_CENTER;
    return {
        first_wave: {
            label: sanitizeText(source.first_wave?.label || fallback.first_wave.label, 80) || fallback.first_wave.label,
            events: normalizeStringArray(source.first_wave?.events || fallback.first_wave.events)
        },
        service: {
            label: sanitizeText(source.service?.label || fallback.service.label, 80) || fallback.service.label,
            events: normalizeStringArray(source.service?.events || fallback.service.events)
        },
        marketing: {
            label: sanitizeText(source.marketing?.label || fallback.marketing.label, 80) || fallback.marketing.label,
            events: normalizeStringArray(source.marketing?.events || fallback.marketing.events)
        },
        guidance: {
            label: sanitizeText(source.guidance?.label || fallback.guidance.label, 80) || fallback.guidance.label,
            events: normalizeStringArray(source.guidance?.events || fallback.guidance.events)
        }
    };
}

function getNotificationBridgeEventLabel(eventType = '') {
    const normalized = sanitizeText(eventType, 80) || '';
    return NOTIFICATION_BRIDGE_EVENT_LABELS[normalized] || normalized || '未命名事件';
}

function buildNotificationBridgeDiagnostics(rules = []) {
    const runningEventRules = (Array.isArray(rules) ? rules : [])
        .filter((rule) => isRuleRunningNow(rule))
        .filter((rule) => sanitizeText(rule?.trigger_type || 'page_view', 80) !== 'page_view');
    const eventMap = new Map();

    runningEventRules.forEach((rule) => {
        const triggerType = sanitizeText(rule?.trigger_type, 80);
        if (!NOTIFICATION_BRIDGE_EVENT_TYPES.has(triggerType)) return;
        const pageIds = Array.isArray(rule?.page_ids)
            ? rule.page_ids.map((pageId) => sanitizeText(pageId, 80)).filter(Boolean)
            : [];
        const existing = eventMap.get(triggerType) || {
            event_type: triggerType,
            label: getNotificationBridgeEventLabel(triggerType),
            running_rules: 0,
            page_ids: new Set(),
            rule_names: []
        };
        existing.running_rules += 1;
        pageIds.forEach((pageId) => existing.page_ids.add(pageId));
        if (existing.rule_names.length < 4) {
            existing.rule_names.push(sanitizeText(rule?.name || rule?.title || triggerType, 120) || triggerType);
        }
        eventMap.set(triggerType, existing);
    });

    const events = Array.from(eventMap.values())
        .map((entry) => ({
            event_type: entry.event_type,
            label: entry.label,
            running_rules: entry.running_rules,
            page_ids: Array.from(entry.page_ids).sort(),
            rule_names: [...new Set(entry.rule_names)].slice(0, 4)
        }))
        .sort((left, right) => {
            const ruleDelta = Number(right.running_rules || 0) - Number(left.running_rules || 0);
            if (ruleDelta) return ruleDelta;
            return String(left.label || left.event_type || '').localeCompare(String(right.label || right.event_type || ''), 'zh-CN');
        });

    const multiRuleEvents = events.filter((entry) => Number(entry.running_rules || 0) > 1);
    return {
        status: multiRuleEvents.length > 0 ? 'warning' : (events.length > 0 ? 'ok' : 'idle'),
        event_types_count: events.length,
        running_rule_count: events.reduce((sum, entry) => sum + (Number(entry.running_rules || 0) || 0), 0),
        multi_rule_event_types_count: multiRuleEvents.length,
        events
    };
}

function normalizeSceneEventPriorityCenter(value = {}, fallbackCenter = DEFAULT_EVENT_PRIORITY_CENTER) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const fallback = normalizeEventPriorityCenter(fallbackCenter);
    return {
        enabled: source.enabled === true,
        first_wave: {
            label: sanitizeText(source.first_wave?.label || fallback.first_wave.label, 80) || fallback.first_wave.label,
            events: normalizeStringArray(source.first_wave?.events || fallback.first_wave.events)
        },
        service: {
            label: sanitizeText(source.service?.label || fallback.service.label, 80) || fallback.service.label,
            events: normalizeStringArray(source.service?.events || fallback.service.events)
        },
        marketing: {
            label: sanitizeText(source.marketing?.label || fallback.marketing.label, 80) || fallback.marketing.label,
            events: normalizeStringArray(source.marketing?.events || fallback.marketing.events)
        },
        guidance: {
            label: sanitizeText(source.guidance?.label || fallback.guidance.label, 80) || fallback.guidance.label,
            events: normalizeStringArray(source.guidance?.events || fallback.guidance.events)
        }
    };
}

function normalizeToken(value = '', fallback = '') {
    return sanitizeText(value, 120).toLowerCase().replace(/[^a-z0-9_-]/g, '') || fallback;
}

function normalizeTagKey(value = '', fallback = '') {
    return sanitizeText(value, 120)
        .toLowerCase()
        .replace(/[^a-z0-9_\-\u4e00-\u9fa5]+/g, '_')
        .replace(/^_+|_+$/g, '')
        || fallback;
}

function normalizeBoolean(value, fallback = true) {
    if (typeof value === 'boolean') return value;
    const normalized = sanitizeText(value, 40).toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
    return fallback;
}

function normalizeEmailArray(value, maxLength = 240) {
    return normalizeStringArray(value, maxLength)
        .map((item) => item.toLowerCase())
        .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item));
}

function normalizeHexColor(value = '', fallback = '#6b9ece') {
    const normalized = sanitizeText(value, 24).toLowerCase();
    return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : fallback;
}

function normalizeInteger(value, fallback, { min = 0, max = 1000 } = {}) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
}

function normalizeRepeatIntervalMinutes(value, fallback = 2) {
    return normalizeInteger(value, fallback, { min: 0, max: 1440 });
}

function isRuleScheduledForFuture(rule = {}, now = new Date()) {
    if (sanitizeText(rule.status || 'draft', 40) !== 'published') return false;
    const startsAt = rule.starts_at ? new Date(rule.starts_at) : null;
    return Boolean(startsAt && Number.isFinite(startsAt.getTime()) && startsAt > now);
}

function isRuleRunningNow(rule = {}, now = new Date()) {
    return rule.enabled === true
        && sanitizeText(rule.status || 'draft', 40) === 'published'
        && !isRuleScheduledForFuture(rule, now);
}

function normalizeAssetStyle(style = {}) {
    const source = normalizeMetadata(style);
    return {
        enabled: source.enabled !== false,
        preset: sanitizeText(source.preset || 'studio_blue', 80) || 'studio_blue',
        accent_color: normalizeHexColor(source.accent_color || source.accentColor, '#6b9ece'),
        title_color: normalizeHexColor(source.title_color || source.titleColor, '#5f95cc'),
        bubble_background: normalizeHexColor(source.bubble_background || source.bubbleBackground, '#ffffff'),
        text_color: normalizeHexColor(source.text_color || source.textColor, '#1f2937'),
        radius_px: normalizeInteger(source.radius_px || source.radiusPx, 22, { min: 12, max: 32 }),
        max_width_px: normalizeInteger(source.max_width_px || source.maxWidthPx, 520, { min: 260, max: 560 }),
        density: sanitizeText(source.density || 'comfortable', 40) || 'comfortable',
        shadow: sanitizeText(source.shadow || 'soft', 40) || 'soft',
        animation: sanitizeText(source.animation || 'gentle', 40) || 'gentle',
        robot_variant: sanitizeText(source.robot_variant || source.robotVariant || 'default', 40) || 'default'
    };
}

function normalizeAsset(asset = {}) {
    return {
        id: sanitizeText(asset.id || asset.key, 120),
        key: sanitizeText(asset.key, 120),
        name: sanitizeText(asset.name || asset.title || '未命名素材', 120) || '未命名素材',
        description: sanitizeText(asset.description || asset.desc, 500),
        type: sanitizeText(asset.type || 'icon', 40) || 'icon',
        icon: sanitizeText(asset.icon || 'fa-robot', 80) || 'fa-robot',
        url: sanitizeText(asset.url || asset.image_url || asset.imageUrl, 1000),
        tone: sanitizeText(asset.tone || 'info', 40) || 'info',
        page_ids: normalizeStringArray(asset.page_ids || asset.pageIds || ['all']),
        enabled: asset.enabled !== false
    };
}

function getDefaultAssetCenter() {
    return {
        style: normalizeAssetStyle({}),
        assets: [
            normalizeAsset({
                id: 'robot-default',
                name: '默认机器人',
                description: '公共页右下角客服机器人，适合通用提醒。',
                type: 'icon',
                icon: 'fa-robot',
                tone: 'info',
                page_ids: ['all'],
                enabled: true
            }),
            normalizeAsset({
                id: 'coupon-badge',
                name: '优惠券角标',
                description: '商城领券和折扣提醒使用的轻量素材。',
                type: 'badge',
                icon: 'fa-ticket',
                tone: 'commerce',
                page_ids: ['shop'],
                enabled: true
            })
        ]
    };
}

function normalizeAssetCenter(value = {}) {
    const defaults = getDefaultAssetCenter();
    const source = normalizeMetadata(value);
    return {
        style: normalizeAssetStyle(source.style || defaults.style),
        assets: Array.isArray(source.assets) && source.assets.length
            ? source.assets.map(normalizeAsset)
            : defaults.assets,
        updated_at: sanitizeText(source.updated_at, 120)
    };
}

function normalizeSupportActionIds(value, fallback = []) {
    const validActions = new Set([
        'code_status',
        'redeem_code',
        'afdian_lookup',
        'shop_order_status',
        'shop_order_content',
        'discount_help',
        'verify_task_status',
        'verify_failure_help',
        'verify_precheck',
        'ticket_history',
        'create_ticket',
        'tg_support',
        'live_chat'
    ]);
    const source = normalizeStringArray(value, 80)
        .map((item) => sanitizeText(item, 80).toLowerCase().replace(/[^a-z0-9_-]/g, ''))
        .filter((item) => validActions.has(item));
    return source.length ? source : fallback.filter((item) => validActions.has(item));
}

function normalizeSupportContext(context = {}) {
    const id = sanitizeText(context.id || context.context_id || context.contextId || 'default', 80)
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '') || 'default';
    const fallbackShortcuts = id === 'shop'
        ? ['shop_order_status', 'shop_order_content', 'discount_help', 'create_ticket', 'live_chat']
        : id === 'verify'
            ? ['verify_task_status', 'verify_failure_help', 'verify_precheck', 'create_ticket', 'live_chat']
            : ['code_status', 'redeem_code', 'afdian_lookup', 'create_ticket', 'live_chat'];
    return {
        id,
        label: sanitizeText(context.label || context.title || '常用入口', 80) || '常用入口',
        intro: sanitizeText(context.intro || context.description, 500),
        shortcuts: normalizeSupportActionIds(context.shortcuts || context.action_ids || context.actionIds, fallbackShortcuts).slice(0, 8),
        enabled: context.enabled !== false
    };
}

function normalizeSupportGuide(guide = {}) {
    return {
        id: sanitizeText(guide.id || guide.key, 120),
        title: sanitizeText(guide.title || guide.name || '工单引导', 120) || '工单引导',
        description: sanitizeText(guide.description || guide.desc, 500),
        page_ids: normalizeStringArray(guide.page_ids || guide.pageIds || ['all']),
        action_id: sanitizeText(guide.action_id || guide.actionId || 'create_ticket', 80).toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'create_ticket',
        ticket_template: sanitizeText(guide.ticket_template || guide.ticketTemplate || guide.template, 800),
        priority: Number(guide.priority || 0) || 0,
        enabled: guide.enabled !== false
    };
}

function getDefaultSupportEntryCenter() {
    return {
        enabled: true,
        entry_label: '常用入口',
        entry_label_en: 'Quick Help',
        root_menus: ['exchange', 'shop', 'verify', 'human'],
        telegram_url: 'https://t.me/zaoyoe',
        ticket_enabled: true,
        live_chat_enabled: true,
        ticket_sla_hours: 24,
        ticket_prompt: '把“关联 ID + 问题描述”发我，我会帮你生成一条客服工单。',
        ticket_placeholder: '输入关联 ID 和问题描述',
        ticket_input_hint: '示例：order:订单号 卡密未到账、task:任务号 一直失败、code:兑换码 显示已使用',
        contexts: [
            normalizeSupportContext({
                id: 'default',
                label: '常用入口',
                intro: '优先帮用户处理兑换、发放和任务状态问题。',
                shortcuts: ['code_status', 'redeem_code', 'afdian_lookup', 'create_ticket', 'live_chat']
            }),
            normalizeSupportContext({
                id: 'shop',
                label: '商城快捷入口',
                intro: '商城页优先处理订单发放、优惠码和工单问题。',
                shortcuts: ['shop_order_status', 'shop_order_content', 'discount_help', 'create_ticket', 'live_chat']
            }),
            normalizeSupportContext({
                id: 'verify',
                label: '验证快捷入口',
                intro: '验证页优先处理任务进度、失败原因和重提前检查。',
                shortcuts: ['verify_task_status', 'verify_failure_help', 'verify_precheck', 'create_ticket', 'live_chat']
            })
        ],
        guides: [
            normalizeSupportGuide({
                id: 'shop-order-missing',
                title: '订单未到账',
                description: '引导用户先查订单状态，再提交工单。',
                page_ids: ['shop'],
                action_id: 'shop_order_status',
                ticket_template: 'order:订单号 订单内容未到账',
                priority: 80,
                enabled: true
            }),
            normalizeSupportGuide({
                id: 'verify-failed',
                title: '验证失败',
                description: '引导用户先查失败原因，再提交人工工单。',
                page_ids: ['verify'],
                action_id: 'verify_failure_help',
                ticket_template: 'task:任务号 验证一直失败',
                priority: 70,
                enabled: true
            })
        ]
    };
}

function normalizeSupportEntryCenter(value = {}) {
    const defaults = getDefaultSupportEntryCenter();
    const source = normalizeMetadata(value);
    return {
        enabled: source.enabled !== false,
        entry_label: sanitizeText(source.entry_label || source.entryLabel || defaults.entry_label, 80) || defaults.entry_label,
        entry_label_en: sanitizeText(source.entry_label_en || source.entryLabelEn || defaults.entry_label_en, 80) || defaults.entry_label_en,
        root_menus: normalizeStringArray(source.root_menus || source.rootMenus || defaults.root_menus),
        telegram_url: sanitizeText(source.telegram_url || source.telegramUrl || defaults.telegram_url, 1000) || defaults.telegram_url,
        ticket_enabled: source.ticket_enabled !== false && source.ticketEnabled !== false,
        live_chat_enabled: source.live_chat_enabled !== false && source.liveChatEnabled !== false,
        ticket_sla_hours: normalizeInteger(source.ticket_sla_hours || source.ticketSlaHours, defaults.ticket_sla_hours, { min: 1, max: 168 }),
        ticket_prompt: sanitizeText(source.ticket_prompt || source.ticketPrompt || defaults.ticket_prompt, 500) || defaults.ticket_prompt,
        ticket_placeholder: sanitizeText(source.ticket_placeholder || source.ticketPlaceholder || defaults.ticket_placeholder, 160) || defaults.ticket_placeholder,
        ticket_input_hint: sanitizeText(source.ticket_input_hint || source.ticketInputHint || defaults.ticket_input_hint, 500) || defaults.ticket_input_hint,
        contexts: Array.isArray(source.contexts) && source.contexts.length
            ? source.contexts.map(normalizeSupportContext)
            : defaults.contexts,
        guides: Array.isArray(source.guides) && source.guides.length
            ? source.guides.map(normalizeSupportGuide)
            : defaults.guides,
        updated_at: sanitizeText(source.updated_at, 120)
    };
}

function normalizeTagDefinition(tag = {}) {
    const name = sanitizeText(tag.name || tag.title || '未命名标签', 120) || '未命名标签';
    const key = normalizeTagKey(tag.key || tag.id || name, 'tag');
    const source = normalizeToken(tag.source || 'manual', 'manual');
    return {
        id: key,
        key,
        name,
        description: sanitizeText(tag.description || tag.desc, 500),
        source: VALID_TAG_SOURCES.has(source) ? source : 'manual',
        auto_rule: sanitizeText(tag.auto_rule || tag.autoRule, 800),
        enabled: tag.enabled !== false
    };
}

function getDefaultTagCenter() {
    return {
        sources: ['manual', 'profile_metadata', 'auth_metadata', 'purchase', 'wallet', 'behavior', 'support'],
        tags: [
            normalizeTagDefinition({
                key: 'paid_user',
                name: '已充值用户',
                description: '有成功充值、购买或积分到账记录。',
                source: 'purchase',
                auto_rule: '支付成功、订单完成或积分充值到账后写入 paid_user'
            }),
            normalizeTagDefinition({
                key: 'high_value',
                name: '高价值用户',
                description: '累计消费或积分消耗达到高价值阈值。',
                source: 'purchase',
                auto_rule: '累计消费达到阈值后写入 high_value'
            }),
            normalizeTagDefinition({
                key: 'payment_failed',
                name: '支付失败用户',
                description: '近期出现支付失败或订单未完成。',
                source: 'behavior',
                auto_rule: '支付失败事件写入 payment_failed，成功支付后可移除'
            }),
            normalizeTagDefinition({
                key: 'verify_failed',
                name: '验证失败用户',
                description: '验证任务失败或多次重试。',
                source: 'behavior',
                auto_rule: '验证失败事件写入 verify_failed'
            }),
            normalizeTagDefinition({
                key: 'inactive_user',
                name: '长期未活跃用户',
                description: '超过站长设置的未活跃天数后写入，用于回流提醒和唤醒优惠。',
                source: 'behavior',
                auto_rule: '公共页机器人记录最近活跃时间，超过阈值后写入 inactive_user，用户回来后移除'
            })
        ],
        automation: {
            high_value: {
                enabled: true,
                min_paid_amount: 500,
                min_points: 5000,
                min_order_count: 5
            },
            payment_failed: {
                enabled: true,
                window_days: 7,
                min_count: 1
            },
            verify_failed: {
                enabled: true,
                window_days: 7,
                min_count: 1
            },
            inactive: {
                enabled: false,
                inactive_days: 30
            }
        },
        updated_at: ''
    };
}

function normalizeTagAutomation(value = {}) {
    const defaults = getDefaultTagCenter().automation;
    const source = normalizeMetadata(value);
    return {
        high_value: {
            enabled: normalizeBoolean(source.high_value?.enabled, defaults.high_value.enabled),
            min_paid_amount: normalizeInteger(source.high_value?.min_paid_amount ?? source.high_value?.minPaidAmount, defaults.high_value.min_paid_amount, { min: 0, max: 1000000 }),
            min_points: normalizeInteger(source.high_value?.min_points ?? source.high_value?.minPoints, defaults.high_value.min_points, { min: 0, max: 100000000 }),
            min_order_count: normalizeInteger(source.high_value?.min_order_count ?? source.high_value?.minOrderCount, defaults.high_value.min_order_count, { min: 0, max: 100000 })
        },
        payment_failed: {
            enabled: normalizeBoolean(source.payment_failed?.enabled, defaults.payment_failed.enabled),
            window_days: normalizeInteger(source.payment_failed?.window_days ?? source.payment_failed?.windowDays, defaults.payment_failed.window_days, { min: 1, max: 365 }),
            min_count: normalizeInteger(source.payment_failed?.min_count ?? source.payment_failed?.minCount, defaults.payment_failed.min_count, { min: 1, max: 1000 })
        },
        verify_failed: {
            enabled: normalizeBoolean(source.verify_failed?.enabled, defaults.verify_failed.enabled),
            window_days: normalizeInteger(source.verify_failed?.window_days ?? source.verify_failed?.windowDays, defaults.verify_failed.window_days, { min: 1, max: 365 }),
            min_count: normalizeInteger(source.verify_failed?.min_count ?? source.verify_failed?.minCount, defaults.verify_failed.min_count, { min: 1, max: 1000 })
        },
        inactive: {
            enabled: normalizeBoolean(source.inactive?.enabled, defaults.inactive.enabled),
            inactive_days: normalizeInteger(source.inactive?.inactive_days ?? source.inactive?.inactiveDays, defaults.inactive.inactive_days, { min: 1, max: 3650 })
        }
    };
}

function normalizeTagCenter(value = {}) {
    const defaults = getDefaultTagCenter();
    const source = normalizeMetadata(value);
    const hiddenUserTags = normalizeStringArray(source.hidden_user_tags || source.hiddenUserTags || [], 120)
        .map((item) => normalizeTagKey(item, ''))
        .filter(Boolean);
    const hiddenTagSet = new Set(hiddenUserTags);
    const tagMap = new Map(defaults.tags
        .filter((tag) => !hiddenTagSet.has(tag.key))
        .map((tag) => [tag.key, tag]));
    if (Array.isArray(source.tags)) {
        source.tags.map(normalizeTagDefinition).forEach((tag) => {
            if (hiddenTagSet.has(tag.key)) return;
            tagMap.set(tag.key, tag);
        });
    }
    const tags = Array.from(tagMap.values());
    const sources = normalizeStringArray(source.sources || defaults.sources, 80)
        .map((item) => normalizeToken(item, ''))
        .filter((item) => VALID_TAG_SOURCES.has(item));
    return {
        sources: sources.length ? sources : defaults.sources,
        tags: tags.slice(0, 80),
        hidden_user_tags: Array.from(hiddenTagSet).slice(0, 240),
        automation: normalizeTagAutomation(source.automation || {}),
        updated_at: sanitizeText(source.updated_at, 120)
    };
}

function normalizeSegment(row = {}) {
    const definition = normalizeMetadata(row.definition);
    const key = sanitizeText(row.key, 160);
    const name = sanitizeText(row.name || '未命名分群', 160) || '未命名分群';
    return {
        id: sanitizeText(row.id, 160),
        key,
        site: normalizeEngagementConfigSite(row.site || 'all', { allowAll: true, fallback: 'all' }),
        name,
        title: name,
        description: sanitizeText(row.description, 800),
        desc: sanitizeText(row.description, 800),
        definition,
        enabled: row.enabled !== false,
        scope: sanitizeText(definition.scope || key || 'all', 80) || 'all',
        icon: sanitizeText(definition.icon || 'fa-users', 80) || 'fa-users',
        pageIds: normalizeStringArray(definition.page_ids || definition.pageIds || ['all']),
        examples: normalizeStringArray(definition.examples || [], 120),
        emails: normalizeEmailArray(definition.email_targets || definition.emails || []),
        tags: normalizeStringArray(definition.tag_targets || definition.tags || [], 80),
        created_at: sanitizeText(row.created_at, 120),
        updated_at: sanitizeText(row.updated_at, 120)
    };
}

function normalizeSceneOverride(scene = {}) {
    const pageId = sanitizeText(scene.id || scene.page_id || scene.pageId, 80).toLowerCase();
    if (!pageId) return null;
    return {
        id: pageId,
        label: sanitizeText(scene.label, 80),
        tone: sanitizeText(scene.tone, 40),
        safe_zone: sanitizeText(scene.safe_zone || scene.safeZone, 80),
        default_placement: sanitizeText(scene.default_placement || scene.defaultPlacement || scene.placement, 80),
        allow_marketing: scene.allow_marketing ?? scene.allowMarketing,
        events: normalizeStringArray(scene.events),
        event_priority_center: normalizeSceneEventPriorityCenter(scene.event_priority_center || scene.eventPriorityCenter || {})
    };
}

function mergePageSceneConfig(baseScenes = [], overrides = []) {
    const overrideMap = new Map((Array.isArray(overrides) ? overrides : [])
        .map(normalizeSceneOverride)
        .filter(Boolean)
        .map((scene) => [scene.id, scene]));

    return baseScenes.map((scene) => {
        const override = overrideMap.get(scene.id) || {};
        return {
            ...scene,
            label: sanitizeText(override.label, 80) || scene.label,
            tone: sanitizeText(override.tone, 40) || scene.tone,
            safe_zone: sanitizeText(override.safe_zone, 80) || scene.safe_zone,
            default_placement: sanitizeText(override.default_placement, 80) || scene.default_placement || 'robot_bubble',
            allow_marketing: typeof override.allow_marketing === 'boolean' ? override.allow_marketing : true,
            events: Array.isArray(override.events) && override.events.length ? override.events : scene.events,
            event_priority_center: normalizeSceneEventPriorityCenter(override.event_priority_center || scene.event_priority_center || {})
        };
    });
}

async function fetchPageSceneConfig(supabase, site = 'all') {
    return loadSiteScopedConfig(supabase, PAGE_SCENE_CONFIG_KEY, site, (value = {}) => ({
        scenes: Array.isArray(value?.scenes) ? value.scenes : [],
        event_priority_center: normalizeEventPriorityCenter(value?.event_priority_center || {})
    }), {});
}

async function fetchAssetStyleConfig(supabase, site = 'all') {
    return loadSiteScopedConfig(supabase, ASSET_STYLE_CONFIG_KEY, site, normalizeAssetCenter, {});
}

async function fetchSupportEntryConfig(supabase, site = 'all') {
    return loadSiteScopedConfig(supabase, SUPPORT_ENTRY_CONFIG_KEY, site, normalizeSupportEntryCenter, {});
}

async function fetchTagCenterConfig(supabase, site = 'all') {
    return loadSiteScopedConfig(supabase, TAG_CENTER_CONFIG_KEY, site, normalizeTagCenter, {});
}

async function fetchExternalEmbedPolicyConfig(supabase, site = 'all') {
    return loadSiteScopedConfig(supabase, EXTERNAL_EMBED_POLICY_CONFIG_KEY, site, normalizeExternalEmbedPolicy, {});
}

function isExternalEngagementEvent(row = {}) {
    const metadata = getEventMetadata(row);
    const explicitExternal = normalizeBoolean(
        metadata.external_host
            ?? metadata.externalHost
            ?? metadata.is_external
            ?? metadata.isExternal,
        false
    ) === true;
    const externalApiOrigin = sanitizeText(metadata.external_api_origin || metadata.externalApiOrigin || '', 240);
    return explicitExternal || Boolean(externalApiOrigin);
}

function getExternalEventHost(row = {}) {
    const metadata = getEventMetadata(row);
    const explicit = sanitizeText(
        metadata.page_host
            || metadata.pageHost
            || metadata.external_host_name
            || metadata.externalHostName
            || metadata.host,
        160
    );
    if (explicit && !['true', 'false'].includes(explicit.toLowerCase())) return explicit;

    const origin = sanitizeText(metadata.page_origin || metadata.pageOrigin || metadata.origin, 240);
    if (origin) {
        try {
            return new URL(origin).host;
        } catch (_) {
            return origin.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
        }
    }

    const apiOrigin = sanitizeText(metadata.external_api_origin || metadata.externalApiOrigin || '', 240);
    if (apiOrigin) {
        try {
            return new URL(apiOrigin).host;
        } catch (_) {
            return apiOrigin.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
        }
    }

    return isExternalEngagementEvent(row) ? 'external-host' : 'internal';
}

function normalizeExternalEventOrigin(value = '') {
    const raw = sanitizeText(value, 240);
    if (!raw) return '';
    try {
        return new URL(raw).origin;
    } catch (_) {
        return raw.replace(/\/+$/, '');
    }
}

function getExternalEventApiOrigin(row = {}) {
    const metadata = getEventMetadata(row);
    return normalizeExternalEventOrigin(metadata.external_api_origin || metadata.externalApiOrigin || metadata.api_origin || metadata.apiOrigin);
}

function getHostFromOrigin(value = '') {
    const raw = sanitizeText(value, 240);
    if (!raw) return '';
    try {
        return new URL(raw).host;
    } catch (_) {
        return raw.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    }
}

function buildExternalDeploymentAnalytics(eventRows = []) {
    const externalRows = (Array.isArray(eventRows) ? eventRows : []).filter(isExternalEngagementEvent);
    const counter = externalRows.reduce((accumulator, row) => {
        addEventToCounter(accumulator, row?.event_type);
        return accumulator;
    }, createEventCounter());
    const hostMap = new Map();
    const pageMap = new Map();
    const apiOriginMap = new Map();
    const lastEvent = externalRows
        .map((row) => new Date(row?.created_at))
        .filter((date) => Number.isFinite(date.getTime()))
        .sort((first, second) => second.getTime() - first.getTime())[0];

    externalRows.forEach((row) => {
        const eventType = sanitizeText(row?.event_type || '', 40);
        const host = getExternalEventHost(row);
        const pageId = sanitizeText(row?.page_id || 'unknown', 80) || 'unknown';
        const apiOrigin = getExternalEventApiOrigin(row);
        addEventToCounter(getCounterFromMap(hostMap, host, { host }), eventType);
        addEventToCounter(getCounterFromMap(pageMap, pageId, { page_id: pageId }), eventType);
        if (apiOrigin) {
            addEventToCounter(getCounterFromMap(apiOriginMap, apiOrigin, { api_origin: apiOrigin }), eventType);
        }
    });

    const finalized = finalizePerformanceCounter(counter);
    const status = externalRows.length <= 0
        ? 'waiting'
        : (finalized.views > 0 ? 'active' : 'seen');
    return {
        status,
        last_event_at: lastEvent ? lastEvent.toISOString() : '',
        event_count: externalRows.length,
        funnel: finalized,
        ...finalized,
        host_breakdown: Array.from(hostMap.values())
            .map(finalizePerformanceCounter)
            .sort((first, second) => (second.views - first.views) || (second.clicks - first.clicks))
            .slice(0, 6),
        page_breakdown: Array.from(pageMap.values())
            .map(finalizePerformanceCounter)
            .sort((first, second) => (second.views - first.views) || (second.clicks - first.clicks))
            .slice(0, 6),
        api_origin_breakdown: Array.from(apiOriginMap.values())
            .map(finalizePerformanceCounter)
            .sort((first, second) => (second.views - first.views) || (second.clicks - first.clicks))
            .slice(0, 6)
    };
}

function buildExternalDeploymentTroubleshooting(policy = {}, deployment = {}) {
    const normalized = normalizeExternalEmbedPolicy(policy);
    const allowedHosts = new Set((Array.isArray(normalized.allowed_origins) ? normalized.allowed_origins : [])
        .map(getHostFromOrigin)
        .filter(Boolean));
    const hostRows = Array.isArray(deployment.host_breakdown) ? deployment.host_breakdown : [];
    const apiRows = Array.isArray(deployment.api_origin_breakdown) ? deployment.api_origin_breakdown : [];
    const eventCount = Number(deployment.event_count || 0) || 0;
    const views = Number(deployment.views || deployment.funnel?.views || 0) || 0;
    const lastEventDate = deployment.last_event_at ? new Date(deployment.last_event_at) : null;
    const lastEventAgeHours = lastEventDate && Number.isFinite(lastEventDate.getTime())
        ? Math.round(((Date.now() - lastEventDate.getTime()) / (60 * 60 * 1000)) * 10) / 10
        : null;
    const hasUnknownHost = hostRows.some((row) => sanitizeText(row.host || row.key, 160) === 'external-host');
    const unlistedHosts = hostRows
        .map((row) => sanitizeText(row.host || row.key, 160))
        .filter((host) => host && host !== 'external-host' && allowedHosts.size > 0 && !allowedHosts.has(host));
    const expectedApiOrigin = normalizeExternalEventOrigin(normalized.api_origin);
    const unexpectedApiOrigins = apiRows
        .map((row) => normalizeExternalEventOrigin(row.api_origin || row.key))
        .filter((origin) => origin && expectedApiOrigin && origin !== expectedApiOrigin);
    const checks = [];
    const addCheck = (id, label, status, detail, action = '') => {
        checks.push({
            id,
            label,
            status,
            detail,
            action
        });
    };

    addCheck(
        'external_runtime_events',
        '真实事件回流',
        eventCount > 0 ? 'ok' : (normalized.enabled ? 'warning' : 'idle'),
        eventCount > 0 ? `近 24 小时收到 ${eventCount} 条外部事件` : '近 24 小时还没有外部页面事件回流',
        '在API中转页面打开，确认 Network 中 /api/engagement/feed 与 /api/engagement/event 返回 2xx'
    );
    addCheck(
        'external_runtime_views',
        '外部曝光上报',
        views > 0 ? 'ok' : (eventCount > 0 ? 'warning' : 'idle'),
        views > 0 ? `已收到 ${views} 次外部曝光` : '有外部事件时应至少看到 view 曝光事件',
        '检查当前页面是否命中已发布规则，以及机器人气泡是否被频率冷却拦截'
    );
    addCheck(
        'external_event_freshness',
        '最近事件新鲜度',
        lastEventAgeHours === null ? 'idle' : (lastEventAgeHours > 6 ? 'warning' : 'ok'),
        lastEventAgeHours === null ? '暂无可判断的真实外部事件' : `最后外部事件距离现在约 ${lastEventAgeHours} 小时`,
        '如果真实页面仍在访问但没有新事件，请优先检查脚本是否被缓存、拦截或移除'
    );
    addCheck(
        'external_origin_identity',
        '来源域名识别',
        hasUnknownHost || unlistedHosts.length ? 'warning' : (hostRows.length ? 'ok' : 'idle'),
        hasUnknownHost
            ? '外部事件缺少 page_host/page_origin，无法准确识别来源域名'
            : (unlistedHosts.length ? `发现未在白名单中的来源：${unlistedHosts.slice(0, 3).join('、')}` : '外部来源域名识别正常'),
        '确认外部 embed 使用最新版脚本，并把真实API中转域名加入 CORS 白名单'
    );
    addCheck(
        'external_api_origin_match',
        'API Origin 一致性',
        unexpectedApiOrigins.length ? 'warning' : (apiRows.length ? 'ok' : 'idle'),
        unexpectedApiOrigins.length
            ? `发现事件使用了不同 API Origin：${unexpectedApiOrigins.slice(0, 3).join('、')}`
            : (apiRows.length ? '事件回传使用的 API Origin 与当前配置一致' : '暂无事件可判断 API Origin'),
        '如切换了主站域名，请重新复制后台生成的API中转嵌入代码'
    );

    const status = checks.some((item) => item.status === 'blocked')
        ? 'blocked'
        : (checks.some((item) => item.status === 'warning') ? 'attention' : 'ready');

    return {
        status,
        summary: status === 'ready'
            ? '外部承载链路暂无异常'
            : '外部承载链路需要排查',
        recommended_actions: checks
            .filter((item) => ['blocked', 'warning'].includes(item.status) && item.action)
            .map((item) => item.action)
            .slice(0, 5),
        checks
    };
}

function buildExternalEmbedOverview(policy = {}, eventRows = []) {
    const normalized = normalizeExternalEmbedPolicy(policy);
    const diagnostics = buildExternalEmbedDiagnostics(normalized);
    const deployment = buildExternalDeploymentAnalytics(eventRows);
    const troubleshooting = buildExternalDeploymentTroubleshooting(normalized, deployment);
    const status = diagnostics.status === 'ready' && troubleshooting.status === 'ready'
        ? 'ready'
        : (troubleshooting.status === 'blocked' ? 'blocked' : 'attention');
    return {
        ...normalized,
        embed_snippet: buildExternalEmbedSnippet(normalized),
        diagnostics: {
            ...diagnostics,
            status,
            troubleshooting,
            recommended_actions: troubleshooting.recommended_actions,
            checks: [
                ...(Array.isArray(diagnostics.checks) ? diagnostics.checks : []),
                ...troubleshooting.checks
            ]
        },
        deployment
    };
}

function buildRuleGovernance(rule = {}) {
    const pageIds = Array.isArray(rule.page_ids) ? rule.page_ids.map((item) => sanitizeText(item, 80)).filter(Boolean) : ['all'];
    const placement = sanitizeText(rule.placement || 'robot_bubble', 80) || 'robot_bubble';
    const tone = sanitizeText(rule.tone || 'info', 40) || 'info';
    const priority = Number(rule.priority || 0) || 0;
    const actionLabel = sanitizeText(rule.action_label, 80);
    const actionUrl = sanitizeText(rule.action_url, 1000);
    const reasons = [];

    if (pageIds.includes('all')) reasons.push('全站触达');
    if (priority >= 30) reasons.push('高优先级');
    if (['modal', 'top_banner'].includes(placement)) reasons.push('强展示形式');
    if (['warning', 'alert', 'error'].includes(tone)) reasons.push('警示语气');
    if (actionLabel && !actionUrl) reasons.push('按钮缺少链接');

    const riskLevel = reasons.length >= 3 ? 'high' : (reasons.length >= 1 ? 'medium' : 'low');
    return {
        risk_level: riskLevel,
        requires_review: riskLevel === 'high',
        reasons
    };
}

function getEventMetadata(row = {}) {
    return normalizeMetadata(row.metadata);
}

function percentage(part = 0, total = 0) {
    const safePart = Number(part || 0) || 0;
    const safeTotal = Number(total || 0) || 0;
    if (safeTotal <= 0) return 0;
    return Math.round((safePart / safeTotal) * 1000) / 10;
}

function createEventCounter(seed = {}) {
    return {
        views: Number(seed.views || 0) || 0,
        clicks: Number(seed.clicks || 0) || 0,
        dismisses: Number(seed.dismisses || 0) || 0,
        conversions: Number(seed.conversions || 0) || 0
    };
}

function addEventToCounter(counter = {}, eventType = '') {
    const normalizedType = sanitizeText(eventType || '', 40);
    if (normalizedType === 'view') counter.views += 1;
    if (normalizedType === 'click') counter.clicks += 1;
    if (normalizedType === 'dismiss') counter.dismisses += 1;
    if (normalizedType === 'conversion') counter.conversions += 1;
}

function finalizePerformanceCounter(counter = {}) {
    return {
        ...counter,
        ctr: percentage(counter.clicks, counter.views),
        dismiss_rate: percentage(counter.dismisses, counter.views),
        conversion_rate: percentage(counter.conversions, counter.views)
    };
}

function getCounterFromMap(map, key, seed = {}) {
    const normalizedKey = sanitizeText(key || 'unknown', 240) || 'unknown';
    if (!map.has(normalizedKey)) {
        map.set(normalizedKey, {
            key: normalizedKey,
            ...seed,
            ...createEventCounter()
        });
    }
    return map.get(normalizedKey);
}

function getEventPlacement(row = {}, rule = {}) {
    const metadata = getEventMetadata(row);
    return sanitizeText(
        metadata.placement
            || metadata.display_type
            || metadata.displayType
            || rule.placement
            || 'robot_bubble',
        80
    ) || 'robot_bubble';
}

function getEventActionDescriptor(row = {}, rule = {}) {
    const metadata = getEventMetadata(row);
    const actionUrl = sanitizeText(
        metadata.action_url
            || metadata.action_path_url
            || metadata.route_url
            || metadata.target_url
            || rule.action_url,
        1000
    );
    const walletView = sanitizeText(metadata.wallet_view || metadata.walletView || metadata.action_wallet_view, 80);
    const label = sanitizeText(
        metadata.route_label
            || metadata.action_path_label
            || metadata.action_label
            || rule.action_label
            || (walletView ? `wallet://${walletView}` : '')
            || (actionUrl ? '未命名入口' : ''),
        160
    );
    if (!label && !actionUrl) return null;
    return {
        key: `${label || '未命名入口'}|${actionUrl || walletView || 'no-url'}`,
        label: label || '未命名入口',
        action_url: actionUrl || (walletView ? `wallet://${walletView}` : '')
    };
}

function getEventDevice(row = {}) {
    const metadata = getEventMetadata(row);
    const explicit = sanitizeText(
        metadata.device
            || metadata.client_device
            || metadata.clientDevice
            || metadata.viewport_device
            || metadata.viewportDevice,
        40
    ).toLowerCase();
    if (['mobile', 'tablet', 'desktop'].includes(explicit)) return explicit;
    const width = Number(metadata.viewport_width || metadata.viewportWidth || metadata.screen_width || metadata.screenWidth || 0) || 0;
    if (width > 0 && width <= 720) return 'mobile';
    if (width > 720 && width <= 1100) return 'tablet';
    if (width > 1100) return 'desktop';
    return 'unknown';
}

function getEventTheme(row = {}) {
    const metadata = getEventMetadata(row);
    const explicit = sanitizeText(
        metadata.theme
            || metadata.client_theme
            || metadata.clientTheme
            || metadata.color_scheme
            || metadata.colorScheme,
        40
    ).toLowerCase();
    return ['light', 'dark'].includes(explicit) ? explicit : 'unknown';
}

function getEventViewportBucket(row = {}) {
    const metadata = getEventMetadata(row);
    const width = Number(
        metadata.viewport_width
            || metadata.viewportWidth
            || metadata.visual_viewport_width
            || metadata.visualViewportWidth
            || metadata.screen_width
            || metadata.screenWidth
            || 0
    ) || 0;
    if (width > 0 && width <= 480) return 'compact_mobile';
    if (width > 480 && width <= 720) return 'mobile';
    if (width > 720 && width <= 1100) return 'tablet';
    if (width > 1100) return 'desktop';
    return 'unknown';
}

function normalizeEventBoolean(value) {
    if (value === true || value === 'true' || value === 1 || value === '1') return true;
    if (value === false || value === 'false' || value === 0 || value === '0') return false;
    return null;
}

function getEventExperienceMetrics(row = {}) {
    const metadata = getEventMetadata(row);
    const bubbleWidth = Number(metadata.bubble_width || metadata.surface_width || metadata.element_width || 0) || 0;
    const bubbleHeight = Number(metadata.bubble_height || metadata.surface_height || metadata.element_height || 0) || 0;
    const edgeGap = Number(metadata.viewport_edge_gap || metadata.edge_gap || 0);
    const overflowsViewport = normalizeEventBoolean(metadata.overflows_viewport || metadata.overflowsViewport);
    return {
        measured: bubbleWidth > 0 || bubbleHeight > 0,
        bubble_width: bubbleWidth,
        bubble_height: bubbleHeight,
        viewport_edge_gap: Number.isFinite(edgeGap) ? edgeGap : 0,
        overflows_viewport: overflowsViewport === true
    };
}

function getEventAudienceScope(row = {}, rule = {}) {
    const metadata = getEventMetadata(row);
    const audience = normalizeMetadata(rule.audience);
    return sanitizeText(
        metadata.audience_scope
            || metadata.audienceScope
            || metadata.segment
            || metadata.segment_key
            || metadata.segmentKey
            || audience.scope
            || audience.segment
            || audience.type
            || 'all',
        80
    ) || 'all';
}

function getJourneyKey(row = {}) {
    const metadata = getEventMetadata(row);
    const actorKey = sanitizeText(row.user_id, 160)
        || sanitizeText(row.reader_key, 160)
        || sanitizeText(metadata.reader_key, 160)
        || 'anonymous';
    const targetKey = sanitizeText(row.rule_id, 160)
        || sanitizeText(row.notification_id, 160)
        || sanitizeText(row.source_event_id, 160)
        || sanitizeText(metadata.source_event_id, 160)
        || sanitizeText(row.source_module, 80)
        || 'engagement';
    return `${actorKey}:${targetKey}`;
}

function buildAttributionSummary(eventRows = [], funnel = createEventCounter()) {
    const journeys = new Map();
    const sortedRows = eventRows
        .slice()
        .sort((first, second) => new Date(first?.created_at).getTime() - new Date(second?.created_at).getTime());
    const summary = {
        conversions: Number(funnel.conversions || 0) || 0,
        attributed_conversions: 0,
        click_assisted_conversions: 0,
        unattributed_conversions: 0,
        view_to_conversion_rate: 0,
        click_to_conversion_rate: 0
    };

    sortedRows.forEach((row) => {
        const key = getJourneyKey(row);
        if (!journeys.has(key)) {
            journeys.set(key, {
                views: 0,
                clicks: 0
            });
        }
        const journey = journeys.get(key);
        const eventType = sanitizeText(row?.event_type || '', 40);
        if (eventType === 'conversion') {
            if (journey.views > 0) summary.attributed_conversions += 1;
            if (journey.clicks > 0) summary.click_assisted_conversions += 1;
        }
        if (eventType === 'view') journey.views += 1;
        if (eventType === 'click') journey.clicks += 1;
    });

    summary.unattributed_conversions = Math.max(0, summary.conversions - summary.attributed_conversions);
    summary.view_to_conversion_rate = percentage(summary.attributed_conversions, funnel.views);
    summary.click_to_conversion_rate = percentage(summary.click_assisted_conversions, funnel.clicks);
    return summary;
}

function normalizeAuditRow(row = {}) {
    return {
        id: sanitizeText(row.id, 160),
        action_type: sanitizeText(row.action_type, 120),
        admin_id: sanitizeText(row.admin_id, 160),
        admin_email: sanitizeText(row.admin_email, 240),
        target_user_id: sanitizeText(row.target_user_id, 160),
        details: row.details && typeof row.details === 'object' && !Array.isArray(row.details) ? row.details : {},
        created_at: sanitizeText(row.created_at, 120)
    };
}

async function fetchEngagementAuditLogs(supabase) {
    async function queryAuditTable(tableName, selection) {
        const { data, error } = await supabase
            .from(tableName)
            .select(selection)
            .like('action_type', 'engagement.%')
            .order('created_at', { ascending: false })
            .limit(24);
        if (error) throw error;
        return Array.isArray(data) ? data.map(normalizeAuditRow) : [];
    }

    try {
        return await queryAuditTable('admin_audit_logs_view', 'id, action_type, details, created_at, admin_id, admin_email, target_user_id');
    } catch (error) {
        if (!isMissingEngagementSchemaError(error) && !sanitizeText(error?.message, 400).includes('admin_audit_logs_view')) {
            throw error;
        }
    }

    try {
        return await queryAuditTable('admin_audit_logs', 'id, action_type, details, created_at, admin_id, target_user_id');
    } catch (error) {
        if (!isMissingEngagementSchemaError(error) && !sanitizeText(error?.message, 400).includes('admin_audit_logs')) {
            throw error;
        }
        return [];
    }
}

function buildEngagementAnalytics(eventRows = [], rules = []) {
    const pageMap = new Map();
    const ruleMap = new Map();
    const placementMap = new Map();
    const actionMap = new Map();
    const sourceMap = new Map();
    const triggerMap = new Map();
    const audienceMap = new Map();
    const deviceMap = new Map();
    const themeMap = new Map();
    const viewportMap = new Map();
    const experienceQuality = {
        measured_views: 0,
        overflow_views: 0,
        tight_edge_views: 0,
        mobile_views: 0,
        dark_views: 0,
        max_bubble_width: 0,
        max_bubble_height: 0,
        overflow_rate: 0,
        tight_edge_rate: 0,
        mobile_view_rate: 0,
        dark_view_rate: 0
    };
    const ruleLookup = new Map(rules.map((rule) => [sanitizeText(rule.id, 160), rule]));

    eventRows.forEach((row) => {
        const eventType = sanitizeText(row?.event_type || '', 40);
        const pageId = sanitizeText(row?.page_id || 'unknown', 80) || 'unknown';
        const ruleId = sanitizeText(row?.rule_id, 160);
        const rule = ruleLookup.get(ruleId) || {};
        const placement = getEventPlacement(row, rule);
        const sourceModule = sanitizeText(row?.source_module || getEventMetadata(row).source || 'engagement', 80) || 'engagement';
        const triggerType = sanitizeText(getEventMetadata(row).trigger_type || getEventMetadata(row).triggerType || rule.trigger_type || 'page_view', 80) || 'page_view';
        const audienceScope = getEventAudienceScope(row, rule);
        const device = getEventDevice(row);
        const theme = getEventTheme(row);
        const viewportBucket = getEventViewportBucket(row);

        if (!pageMap.has(pageId)) {
            pageMap.set(pageId, {
                page_id: pageId,
                ...createEventCounter()
            });
        }
        addEventToCounter(pageMap.get(pageId), eventType);

        const placementCounter = getCounterFromMap(placementMap, placement, {
            placement
        });
        addEventToCounter(placementCounter, eventType);

        const sourceCounter = getCounterFromMap(sourceMap, sourceModule, {
            source_module: sourceModule
        });
        addEventToCounter(sourceCounter, eventType);

        const triggerCounter = getCounterFromMap(triggerMap, triggerType, {
            trigger_type: triggerType
        });
        addEventToCounter(triggerCounter, eventType);

        const audienceCounter = getCounterFromMap(audienceMap, audienceScope, {
            audience_scope: audienceScope
        });
        addEventToCounter(audienceCounter, eventType);

        const deviceCounter = getCounterFromMap(deviceMap, device, {
            device
        });
        addEventToCounter(deviceCounter, eventType);

        const themeCounter = getCounterFromMap(themeMap, theme, {
            theme
        });
        addEventToCounter(themeCounter, eventType);

        const viewportCounter = getCounterFromMap(viewportMap, viewportBucket, {
            viewport_bucket: viewportBucket
        });
        addEventToCounter(viewportCounter, eventType);

        if (eventType === 'view') {
            const eventMetrics = getEventExperienceMetrics(row);
            if (eventMetrics.measured) experienceQuality.measured_views += 1;
            if (eventMetrics.overflows_viewport) experienceQuality.overflow_views += 1;
            if (eventMetrics.measured && eventMetrics.viewport_edge_gap < 8) experienceQuality.tight_edge_views += 1;
            if (device === 'mobile' || viewportBucket === 'compact_mobile' || viewportBucket === 'mobile') experienceQuality.mobile_views += 1;
            if (theme === 'dark') experienceQuality.dark_views += 1;
            experienceQuality.max_bubble_width = Math.max(experienceQuality.max_bubble_width, Math.round(eventMetrics.bubble_width || 0));
            experienceQuality.max_bubble_height = Math.max(experienceQuality.max_bubble_height, Math.round(eventMetrics.bubble_height || 0));
        }

        const action = getEventActionDescriptor(row, rule);
        if (action) {
            const actionCounter = getCounterFromMap(actionMap, action.key, {
                label: action.label,
                action_url: action.action_url
            });
            addEventToCounter(actionCounter, eventType);
        }

        if (ruleId) {
            if (!ruleMap.has(ruleId)) {
                ruleMap.set(ruleId, {
                    rule_id: ruleId,
                    rule_name: sanitizeText(rule.name || '未命名规则', 160) || '未命名规则',
                    page_ids: Array.isArray(rule.page_ids) ? rule.page_ids : [],
                    trigger_type: sanitizeText(rule.trigger_type || 'page_view', 80) || 'page_view',
                    ...createEventCounter()
                });
            }
            addEventToCounter(ruleMap.get(ruleId), eventType);
        }
    });

    const funnel = eventRows.reduce((counter, row) => {
        addEventToCounter(counter, row?.event_type);
        return counter;
    }, createEventCounter());
    experienceQuality.overflow_rate = percentage(experienceQuality.overflow_views, experienceQuality.measured_views);
    experienceQuality.tight_edge_rate = percentage(experienceQuality.tight_edge_views, experienceQuality.measured_views);
    experienceQuality.mobile_view_rate = percentage(experienceQuality.mobile_views, funnel.views);
    experienceQuality.dark_view_rate = percentage(experienceQuality.dark_views, funnel.views);

    return {
        funnel: finalizePerformanceCounter(funnel),
        attribution: buildAttributionSummary(eventRows, funnel),
        page_breakdown: Array.from(pageMap.values())
            .map(finalizePerformanceCounter)
            .sort((first, second) => (second.views - first.views) || (second.clicks - first.clicks))
            .slice(0, 8),
        placement_breakdown: Array.from(placementMap.values())
            .map(finalizePerformanceCounter)
            .sort((first, second) => (second.views - first.views) || (second.clicks - first.clicks))
            .slice(0, 8),
        action_breakdown: Array.from(actionMap.values())
            .map(finalizePerformanceCounter)
            .sort((first, second) => (second.clicks - first.clicks) || (second.conversions - first.conversions))
            .slice(0, 8),
        source_breakdown: Array.from(sourceMap.values())
            .map(finalizePerformanceCounter)
            .sort((first, second) => (second.views - first.views) || (second.conversions - first.conversions))
            .slice(0, 8),
        trigger_breakdown: Array.from(triggerMap.values())
            .map(finalizePerformanceCounter)
            .sort((first, second) => (second.views - first.views) || (second.clicks - first.clicks))
            .slice(0, 8),
        audience_breakdown: Array.from(audienceMap.values())
            .map(finalizePerformanceCounter)
            .sort((first, second) => (second.views - first.views) || (second.clicks - first.clicks))
            .slice(0, 8),
        device_breakdown: Array.from(deviceMap.values())
            .map(finalizePerformanceCounter)
            .sort((first, second) => (second.views - first.views) || (second.clicks - first.clicks))
            .slice(0, 8),
        theme_breakdown: Array.from(themeMap.values())
            .map(finalizePerformanceCounter)
            .sort((first, second) => (second.views - first.views) || (second.clicks - first.clicks))
            .slice(0, 8),
        viewport_breakdown: Array.from(viewportMap.values())
            .map(finalizePerformanceCounter)
            .sort((first, second) => (second.views - first.views) || (second.clicks - first.clicks))
            .slice(0, 8),
        experience_quality: experienceQuality,
        rule_breakdown: Array.from(ruleMap.values())
            .map(finalizePerformanceCounter)
            .sort((first, second) => (second.views - first.views) || (second.clicks - first.clicks))
            .slice(0, 8)
    };
}

function buildGovernanceSummary(rules = [], auditLogs = []) {
    const now = new Date();
    const runningRules = rules.filter((rule) => isRuleRunningNow(rule, now));
    const scheduledRules = rules.filter((rule) => isRuleScheduledForFuture(rule, now));
    const draftRules = rules.filter((rule) => rule.status === 'draft');
    const pausedRules = rules.filter((rule) => rule.status === 'paused');
    const archivedRules = rules.filter((rule) => rule.status === 'archived');
    const eventRules = rules.filter((rule) => sanitizeText(rule.trigger_type || 'page_view', 80) !== 'page_view');
    const highRiskRules = runningRules.filter((rule) => sanitizeText(rule.governance?.risk_level, 20) === 'high');
    const reviewRequiredRules = rules.filter((rule) => rule.governance?.requires_review === true);
    const missingActionRules = runningRules.filter((rule) => sanitizeText(rule.action_label, 80) && !sanitizeText(rule.action_url, 1000));
    const last24h = Date.now() - 24 * 60 * 60 * 1000;
    const recentAudits = auditLogs.filter((row) => {
        const createdAt = new Date(row.created_at);
        return Number.isFinite(createdAt.getTime()) && createdAt.getTime() >= last24h;
    });

    return {
        running_rules: runningRules.length,
        scheduled_rules: scheduledRules.length,
        draft_rules: draftRules.length,
        paused_rules: pausedRules.length,
        archived_rules: archivedRules.length,
        event_rules: eventRules.length,
        page_view_rules: rules.length - eventRules.length,
        high_risk_rules: highRiskRules.length,
        review_required_rules: reviewRequiredRules.length,
        missing_action_rules: missingActionRules.length,
        recent_audit_logs: recentAudits.length,
        can_pause_all: runningRules.length > 0,
        risk_rules: highRiskRules.slice(0, 6).map((rule) => ({
            id: rule.id,
            name: rule.name,
            risk_level: rule.governance?.risk_level || 'low',
            reasons: Array.isArray(rule.governance?.reasons) ? rule.governance.reasons : [],
            page_ids: rule.page_ids,
            placement: rule.placement,
            priority: rule.priority
        }))
    };
}

function buildLifecycleDiagnostics({ schemaReady = false, rules = [], eventRows = [], auditLogs = [] } = {}) {
    const runningRules = rules.filter((rule) => isRuleRunningNow(rule));
    const runningPageViewRules = runningRules.filter((rule) => sanitizeText(rule.trigger_type || 'page_view', 80) === 'page_view');
    const runningEventRules = runningRules.filter((rule) => sanitizeText(rule.trigger_type || 'page_view', 80) !== 'page_view');
    const eventCounts = eventRows.reduce((counter, row) => {
        addEventToCounter(counter, row?.event_type);
        return counter;
    }, createEventCounter());
    const lastEventAt = eventRows
        .map((row) => new Date(row?.created_at))
        .filter((date) => Number.isFinite(date.getTime()))
        .sort((first, second) => second.getTime() - first.getTime())[0];
    const hasRules = rules.length > 0;
    const hasPublishedPageRule = runningPageViewRules.length > 0;
    const hasViews = eventCounts.views > 0;
    const hasInteraction = eventCounts.clicks > 0 || eventCounts.dismisses > 0 || eventCounts.conversions > 0;
    const dismissRate = percentage(eventCounts.dismisses, eventCounts.views);
    const notificationBridge = buildNotificationBridgeDiagnostics(rules);

    const checklist = [
        {
            id: 'schema',
            label: '数据表可用',
            status: schemaReady ? 'ok' : 'blocked',
            detail: schemaReady ? '触达规则、模板和事件表已可读取' : '需要先执行客服系统迁移 SQL'
        },
        {
            id: 'rules',
            label: '已有规则',
            status: hasRules ? 'ok' : 'idle',
            detail: hasRules ? `${rules.length} 条规则已进入触达中心` : '还没有创建触达规则'
        },
        {
            id: 'published',
            label: '页面规则运行',
            status: hasPublishedPageRule ? 'ok' : 'warning',
            detail: hasPublishedPageRule ? `${runningPageViewRules.length} 条页面访问规则正在运行` : '普通页面访问不会展示事件型规则'
        },
        {
            id: 'notification_bridge',
            label: '通知桥接收口',
            status: notificationBridge.status === 'warning' ? 'warning' : (notificationBridge.status === 'ok' ? 'ok' : 'idle'),
            detail: notificationBridge.event_types_count > 0
                ? (notificationBridge.multi_rule_event_types_count > 0
                    ? `${notificationBridge.event_types_count} 类双通道事件已接入，其中 ${notificationBridge.multi_rule_event_types_count} 类仍挂了多条运行规则`
                    : `${notificationBridge.event_types_count} 类双通道事件已接入，前台会按 source_event_id 收口展示`)
                : '当前运行规则里暂无通知桥接事件'
        },
        {
            id: 'views',
            label: '前台曝光回流',
            status: hasViews ? 'ok' : (hasPublishedPageRule ? 'warning' : 'idle'),
            detail: hasViews ? `${eventCounts.views} 次曝光已回传` : '近 24 小时暂无曝光事件'
        },
        {
            id: 'interaction',
            label: '用户互动回流',
            status: hasInteraction ? 'ok' : (hasViews ? 'warning' : 'idle'),
            detail: hasInteraction ? `${eventCounts.clicks} 点击 / ${eventCounts.dismisses} 关闭 / ${eventCounts.conversions} 转化` : '暂无点击、关闭或转化事件'
        }
    ];

    const tips = [];
    if (!schemaReady) {
        tips.push({
            tone: 'warning',
            title: '先确认 SQL 迁移',
            detail: '数据表不可读时，前台和后台都会降级，无法形成完整闭环。'
        });
    } else if (!hasRules) {
        tips.push({
            tone: 'info',
            title: '先创建一条页面访问规则',
            detail: '建议用首页或提示词页创建 page_view 规则，发布后再去公共页观察机器人气泡。'
        });
    } else if (!hasPublishedPageRule) {
        tips.push({
            tone: 'warning',
            title: '当前没有页面访问规则',
            detail: `${runningEventRules.length} 条事件型规则需要业务事件触发，不会在普通打开页面时显示。`
        });
    } else if (!hasViews) {
        tips.push({
            tone: 'warning',
            title: '规则运行但没有曝光',
            detail: '请检查目标页面、站点 CN/INTL、用户范围、关闭冷却，以及公共页机器人是否已加载。'
        });
    } else if (!hasInteraction) {
        tips.push({
            tone: 'info',
            title: '已有曝光但没有互动',
            detail: '可以提高按钮文案清晰度，或把可跳转路径写成“我的钱包 > 卡券”这类可点击入口。'
        });
    }
    if (dismissRate >= 60) {
        tips.push({
            tone: 'warning',
            title: '关闭率偏高',
            detail: `当前关闭率 ${dismissRate}%，建议降低频率、缩短文案或减少全站触达。`
        });
    }
    if (notificationBridge.multi_rule_event_types_count > 0) {
        const examples = notificationBridge.events
            .filter((entry) => Number(entry.running_rules || 0) > 1)
            .slice(0, 3)
            .map((entry) => `${entry.label}（${entry.running_rules} 条规则）`)
            .join('、');
        tips.push({
            tone: 'warning',
            title: '双通道事件仍有多规则并行',
            detail: `${examples || '部分通知桥接事件'}会先写入通知，再桥接成规则气泡。建议统一文案、动作路径，并把同事件运行规则收敛到 1 条。`
        });
    } else if (notificationBridge.event_types_count > 0) {
        const examples = notificationBridge.events
            .slice(0, 4)
            .map((entry) => entry.label)
            .join('、');
        tips.push({
            tone: 'info',
            title: '已识别通知桥接事件',
            detail: `${notificationBridge.event_types_count} 类事件会同时经过通知与规则通道：${examples}${notificationBridge.event_types_count > 4 ? ' 等' : ''}。前台已做去重收口，后续建议统一两端文案语义。`
        });
    }
    if (auditLogs.length <= 0) {
        tips.push({
            tone: 'info',
            title: '暂无审计记录',
            detail: '创建、发布、暂停或归档规则后，审计记录会显示在治理页。'
        });
    }

    return {
        status: checklist.some((item) => item.status === 'blocked')
            ? 'blocked'
            : (checklist.some((item) => item.status === 'warning') ? 'attention' : 'ready'),
        last_event_at: lastEventAt ? lastEventAt.toISOString() : '',
        running_page_view_rules: runningPageViewRules.length,
        running_event_rules: runningEventRules.length,
        notification_bridge: notificationBridge,
        checklist,
        tips: tips.slice(0, 4)
    };
}

function applyOverviewSiteFilter(query, site = 'all') {
    const normalizedSite = normalizeEngagementConfigSite(site, { allowAll: true, fallback: 'all' });
    if (normalizedSite === 'all') {
        return query;
    }
    if (typeof query?.in !== 'function') {
        return query;
    }
    return query.in('site', ['all', normalizedSite]);
}

function overviewRowMatchesSite(row = {}, site = 'all') {
    const normalizedSite = normalizeEngagementConfigSite(site, { allowAll: true, fallback: 'all' });
    if (normalizedSite === 'all') return true;
    const rowSite = normalizeEngagementConfigSite(row.site || 'all', { allowAll: true, fallback: 'all' });
    return rowSite === 'all' || rowSite === normalizedSite;
}

function compareOverviewSitePriority(left = {}, right = {}, site = 'all') {
    const normalizedSite = normalizeEngagementConfigSite(site, { allowAll: true, fallback: 'all' });
    if (normalizedSite === 'all') return 0;
    const siteRank = (row) => (
        normalizeEngagementConfigSite(row.site || 'all', { allowAll: true, fallback: 'all' }) === normalizedSite ? 1 : 0
    );
    return siteRank(left) - siteRank(right);
}

async function fetchEngagementOverview(supabase, site = 'all') {
    const normalizedSite = normalizeEngagementConfigSite(site, { allowAll: true, fallback: 'all' });
    const taskRows = await Promise.all([
        runOverviewTask('rules', () => applyOverviewSiteFilter(supabase
            .from('engagement_rules')
            .select('id,name,description,site,page_ids,placement,trigger_type,audience,title,content,action_label,action_url,tone,icon,priority,frequency,dismiss_ttl_hours,enabled,status,starts_at,ends_at,metadata,updated_at'), normalizedSite)
            .order('updated_at', { ascending: false })
            .limit(RULE_MANAGEMENT_LIST_LIMIT), { data: [], error: null }),
        runOverviewTask('templates', () => supabase
            .from('engagement_templates')
            .select('id,key,name,description,category,page_ids,title,content,action_label,action_url,tone,metadata,created_at,updated_at')
            .order('updated_at', { ascending: false })
            .limit(24), { data: [], error: null }),
        runOverviewTask('segments', () => applyOverviewSiteFilter(supabase
            .from('engagement_segments')
            .select('id,key,site,name,description,definition,enabled,created_at,updated_at'), normalizedSite)
            .order('updated_at', { ascending: false })
            .limit(50), { data: [], error: null }),
        runOverviewTask('events', () => {
            let query = supabase
                .from('engagement_events')
                .select('event_type,page_id,site,rule_id,notification_id,user_id,reader_key,source_module,source_event_id,metadata,created_at')
                .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
            if (normalizedSite !== 'all') {
                query = typeof query?.eq === 'function'
                    ? query.eq('site', normalizedSite)
                    : query;
            }
            return query
                .order('created_at', { ascending: false })
                .limit(1000);
        }, { data: [], error: null }),
        runOverviewTask('audit_logs', () => fetchEngagementAuditLogs(supabase), []),
        runOverviewTask('page_scenes', () => fetchPageSceneConfig(supabase, normalizedSite), {}),
        runOverviewTask('asset_center', () => fetchAssetStyleConfig(supabase, normalizedSite), getDefaultAssetCenter()),
        runOverviewTask('support_entry', () => fetchSupportEntryConfig(supabase, normalizedSite), getDefaultSupportEntryCenter()),
        runOverviewTask('tag_center', () => fetchTagCenterConfig(supabase, normalizedSite), getDefaultTagCenter()),
        runOverviewTask('external_embed', () => fetchExternalEmbedPolicyConfig(supabase, normalizedSite), normalizeExternalEmbedPolicy({}))
    ]);
    const taskMap = Object.fromEntries(taskRows.map((task) => [task.label, task]));
    const rulesResult = getOverviewQueryResult(taskMap.rules);
    const templatesResult = getOverviewQueryResult(taskMap.templates);
    const segmentsResult = getOverviewQueryResult(taskMap.segments);
    const eventsResult = getOverviewQueryResult(taskMap.events);

    const eventRows = Array.isArray(eventsResult.data) ? eventsResult.data : [];
    const rules = (Array.isArray(rulesResult.data) ? rulesResult.data : []).map(normalizeRule);
    const templates = (Array.isArray(templatesResult.data) ? templatesResult.data : []).map(normalizeTemplate);
    const segments = (Array.isArray(segmentsResult.data) ? segmentsResult.data : [])
        .filter((row) => overviewRowMatchesSite(row, normalizedSite))
        .sort((left, right) => compareOverviewSitePriority(left, right, normalizedSite))
        .map(normalizeSegment);
    const auditLogs = Array.isArray(taskMap.audit_logs?.value) ? taskMap.audit_logs.value : [];
    const sceneOverrides = taskMap.page_scenes?.value && typeof taskMap.page_scenes.value === 'object' ? taskMap.page_scenes.value : {};
    const assetCenter = taskMap.asset_center?.value || getDefaultAssetCenter();
    const supportEntry = taskMap.support_entry?.value || getDefaultSupportEntryCenter();
    const tagCenter = taskMap.tag_center?.value || getDefaultTagCenter();
    const externalEmbed = taskMap.external_embed?.value || normalizeExternalEmbedPolicy({});
    const overviewHealth = buildOverviewHealth(taskRows, {
        rules: rulesResult,
        templates: templatesResult,
        segments: segmentsResult,
        events: eventsResult
    });
    const eventCounts = eventRows.reduce((accumulator, row) => {
        const type = sanitizeText(row?.event_type || 'unknown', 40) || 'unknown';
        accumulator[type] = (accumulator[type] || 0) + 1;
        return accumulator;
    }, {});

    const schemaReady = !rulesResult.error && !templatesResult.error && !segmentsResult.error && !eventsResult.error;

    return {
        schema_ready: schemaReady,
        site: normalizedSite,
        page_scenes: mergePageSceneConfig(PAGE_SCENES, sceneOverrides.scenes || sceneOverrides),
        event_priority_center: normalizeEventPriorityCenter(sceneOverrides.event_priority_center || {}),
        asset_center: assetCenter,
        support_entry: supportEntry,
        tag_center: tagCenter,
        external_embed: buildExternalEmbedOverview(externalEmbed, eventRows),
        overview_health: overviewHealth,
        rules,
        templates,
        segments,
        metrics: {
            last_24h_events: eventRows.length,
            views: Number(eventCounts.view || 0),
            clicks: Number(eventCounts.click || 0),
            dismisses: Number(eventCounts.dismiss || 0),
            conversions: Number(eventCounts.conversion || 0)
        },
        analytics: buildEngagementAnalytics(eventRows, rules),
        audit_logs: Array.isArray(auditLogs) ? auditLogs : [],
        governance: buildGovernanceSummary(rules, Array.isArray(auditLogs) ? auditLogs : []),
        diagnostics: buildLifecycleDiagnostics({
            schemaReady,
            rules,
            eventRows,
            auditLogs: Array.isArray(auditLogs) ? auditLogs : []
        }),
        degraded: overviewHealth.status === 'degraded'
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
        const authTask = await runOverviewTask('admin_auth', () => requireAdmin(req, {
            anyOf: ['chat.manage', 'settings.manage']
        }), null, OVERVIEW_AUTH_TIMEOUT_MS);
        if (!authTask.ok || !authTask.value?.supabase) {
            const statusCode = authTask.timed_out ? 503 : (Number(authTask.error?.statusCode || 0) || 503);
            return sendJson(res, statusCode, {
                success: false,
                message: authTask.timed_out
                    ? '客服系统鉴权超时，请刷新页面或重新登录后再试'
                    : (authTask.error?.message || '客服系统鉴权失败'),
                overview_health: {
                    status: 'blocked',
                    degraded_tasks: authTask.error ? [authTask.error] : [],
                    timed_out_tasks: authTask.timed_out ? ['admin_auth'] : []
                }
            });
        }
        const { supabase } = authTask.value;
        const url = new URL(req.url || '', 'http://localhost');
        const site = normalizeEngagementConfigSite(url.searchParams.get('site') || req.adminSite, {
            allowAll: true,
            fallback: 'all'
        });
        const overview = await fetchEngagementOverview(supabase, site);
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
