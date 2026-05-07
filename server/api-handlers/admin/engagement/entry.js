const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');

const CONFIG_KEY = 'engagement_support_entry_center';
const VALID_CONTEXT_IDS = Object.freeze(new Set(['default', 'home', 'prompts', 'gongyi', 'shop', 'verify', 'guestbook']));
const VALID_ACTION_IDS = Object.freeze(new Set([
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
]));
const VALID_ROOT_MENUS = Object.freeze(new Set(['exchange', 'shop', 'verify', 'human']));

function sanitizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeBoolean(value, fallback = true) {
    if (value === true || value === 'true' || value === 1 || value === '1') return true;
    if (value === false || value === 'false' || value === 0 || value === '0') return false;
    return fallback;
}

function normalizeToken(value = '', fallback = '') {
    return sanitizeText(value, 120).toLowerCase().replace(/[^a-z0-9_-]/g, '') || fallback;
}

function normalizeInteger(value, fallback, { min = 0, max = 1000 } = {}) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
}

function normalizeStringArray(value, maxLength = 80) {
    const source = Array.isArray(value) ? value : String(value || '').split(/[\n,;|]+/);
    return [...new Set(source.map((item) => sanitizeText(item, maxLength)).filter(Boolean))];
}

function normalizeActionIds(value, fallback = []) {
    const source = normalizeStringArray(value, 80);
    const normalized = source
        .map((item) => normalizeToken(item, ''))
        .filter((item) => VALID_ACTION_IDS.has(item));
    return normalized.length ? normalized : fallback.filter((item) => VALID_ACTION_IDS.has(item));
}

function normalizeRootMenus(value) {
    const normalized = normalizeStringArray(value, 80)
        .map((item) => normalizeToken(item, ''))
        .filter((item) => VALID_ROOT_MENUS.has(item));
    return normalized.length ? normalized : ['exchange', 'shop', 'verify', 'human'];
}

function normalizePageIds(value) {
    const normalized = normalizeStringArray(value, 80)
        .map((item) => normalizeToken(item, ''))
        .filter((item) => item === 'all' || VALID_CONTEXT_IDS.has(item));
    return normalized.length ? normalized : ['all'];
}

function slugify(value = '', fallback = 'guide') {
    const slug = sanitizeText(value, 120)
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return slug || `${fallback}-${Date.now().toString(36)}`;
}

function normalizeContext(context = {}) {
    const id = normalizeToken(context.id || context.context_id || context.contextId, 'default');
    const safeId = VALID_CONTEXT_IDS.has(id) ? id : 'default';
    const fallbackShortcuts = safeId === 'shop'
        ? ['shop_order_status', 'shop_order_content', 'create_ticket', 'live_chat']
        : safeId === 'verify'
            ? ['verify_task_status', 'verify_failure_help', 'verify_precheck', 'create_ticket']
            : ['code_status', 'redeem_code', 'afdian_lookup', 'create_ticket', 'live_chat'];
    return {
        id: safeId,
        label: sanitizeText(context.label || context.title || '常用入口', 80) || '常用入口',
        intro: sanitizeText(context.intro || context.description, 500),
        shortcuts: normalizeActionIds(context.shortcuts || context.action_ids || context.actionIds, fallbackShortcuts).slice(0, 8),
        enabled: normalizeBoolean(context.enabled, true)
    };
}

function normalizeGuide(guide = {}) {
    const title = sanitizeText(guide.title || guide.name || '工单引导', 120) || '工单引导';
    const actionId = normalizeToken(guide.action_id || guide.actionId, 'create_ticket');
    return {
        id: sanitizeText(guide.id, 120) || slugify(title, 'guide'),
        title,
        description: sanitizeText(guide.description || guide.desc, 500),
        page_ids: normalizePageIds(guide.page_ids || guide.pageIds || ['all']),
        action_id: VALID_ACTION_IDS.has(actionId) ? actionId : 'create_ticket',
        ticket_template: sanitizeText(guide.ticket_template || guide.ticketTemplate || guide.template, 800),
        priority: normalizeInteger(guide.priority, 0, { min: 0, max: 100 }),
        enabled: normalizeBoolean(guide.enabled, true)
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
            normalizeContext({
                id: 'default',
                label: '常用入口',
                intro: '优先帮用户处理兑换、发放和任务状态问题。',
                shortcuts: ['code_status', 'redeem_code', 'afdian_lookup', 'create_ticket', 'live_chat']
            }),
            normalizeContext({
                id: 'home',
                label: '首页快捷入口',
                intro: '给用户一个清晰的帮助入口，减少不知道从哪里问的困惑。',
                shortcuts: ['code_status', 'afdian_lookup', 'create_ticket', 'live_chat']
            }),
            normalizeContext({
                id: 'shop',
                label: '商城快捷入口',
                intro: '商城页优先处理订单发放、优惠码和工单问题。',
                shortcuts: ['shop_order_status', 'shop_order_content', 'discount_help', 'create_ticket', 'live_chat']
            }),
            normalizeContext({
                id: 'verify',
                label: '验证快捷入口',
                intro: '验证页优先处理任务进度、失败原因和重提前检查。',
                shortcuts: ['verify_task_status', 'verify_failure_help', 'verify_precheck', 'create_ticket', 'live_chat']
            })
        ],
        guides: [
            normalizeGuide({
                id: 'shop-order-missing',
                title: '订单未到账',
                description: '引导用户先查订单状态，再提交工单。',
                page_ids: ['shop'],
                action_id: 'shop_order_status',
                ticket_template: 'order:订单号 订单内容未到账',
                priority: 80,
                enabled: true
            }),
            normalizeGuide({
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
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const contexts = Array.isArray(source.contexts) && source.contexts.length
        ? source.contexts.map(normalizeContext)
        : defaults.contexts;
    const guides = Array.isArray(source.guides) && source.guides.length
        ? source.guides.map(normalizeGuide)
        : defaults.guides;
    return {
        enabled: normalizeBoolean(source.enabled, defaults.enabled),
        entry_label: sanitizeText(source.entry_label || source.entryLabel, 80) || defaults.entry_label,
        entry_label_en: sanitizeText(source.entry_label_en || source.entryLabelEn, 80) || defaults.entry_label_en,
        root_menus: normalizeRootMenus(source.root_menus || source.rootMenus || defaults.root_menus),
        telegram_url: sanitizeText(source.telegram_url || source.telegramUrl, 1000) || defaults.telegram_url,
        ticket_enabled: normalizeBoolean(source.ticket_enabled ?? source.ticketEnabled, defaults.ticket_enabled),
        live_chat_enabled: normalizeBoolean(source.live_chat_enabled ?? source.liveChatEnabled, defaults.live_chat_enabled),
        ticket_sla_hours: normalizeInteger(source.ticket_sla_hours || source.ticketSlaHours, defaults.ticket_sla_hours, { min: 1, max: 168 }),
        ticket_prompt: sanitizeText(source.ticket_prompt || source.ticketPrompt, 500) || defaults.ticket_prompt,
        ticket_placeholder: sanitizeText(source.ticket_placeholder || source.ticketPlaceholder, 160) || defaults.ticket_placeholder,
        ticket_input_hint: sanitizeText(source.ticket_input_hint || source.ticketInputHint, 500) || defaults.ticket_input_hint,
        contexts: Array.from(new Map(contexts.map((context) => [context.id, context])).values()).slice(0, 12),
        guides: Array.from(new Map(guides.map((guide) => [guide.id, guide])).values()).slice(0, 40),
        updated_at: sanitizeText(source.updated_at, 120)
    };
}

async function loadSupportEntryCenter(supabase) {
    const { data, error } = await supabase
        .from('system_config')
        .select('config_value')
        .eq('config_key', CONFIG_KEY)
        .maybeSingle();
    if (error) throw error;
    return normalizeSupportEntryCenter(data?.config_value || {});
}

async function saveSupportEntryCenter({ supabase, user, body }) {
    const current = await loadSupportEntryCenter(supabase);
    const action = normalizeToken(body.action, 'save_settings');
    let nextCenter = current;

    if (action === 'save_context') {
        const context = normalizeContext(body.context || body);
        const contextMap = new Map(current.contexts.map((item) => [item.id, item]));
        contextMap.set(context.id, context);
        nextCenter = {
            ...current,
            contexts: Array.from(contextMap.values())
        };
    } else if (action === 'delete_context') {
        const contextId = normalizeToken(body.id || body.context_id || body.contextId, '');
        nextCenter = {
            ...current,
            contexts: current.contexts.filter((context) => context.id !== contextId && context.id !== 'default')
        };
    } else if (action === 'save_guide') {
        const guide = normalizeGuide(body.guide || body);
        const guideMap = new Map(current.guides.map((item) => [item.id, item]));
        guideMap.set(guide.id, guide);
        nextCenter = {
            ...current,
            guides: Array.from(guideMap.values())
        };
    } else if (action === 'delete_guide') {
        const guideId = sanitizeText(body.id || body.guide_id || body.guideId, 120);
        nextCenter = {
            ...current,
            guides: current.guides.filter((guide) => guide.id !== guideId)
        };
    } else if (action === 'save_all') {
        nextCenter = normalizeSupportEntryCenter(body.support_entry || body.supportEntry || body);
    } else {
        nextCenter = {
            ...current,
            ...normalizeSupportEntryCenter({
                ...current,
                ...body.settings,
                ...body,
                contexts: current.contexts,
                guides: current.guides
            })
        };
    }

    const payload = {
        ...normalizeSupportEntryCenter(nextCenter),
        updated_at: new Date().toISOString()
    };

    const { error } = await supabase
        .from('system_config')
        .upsert({
            config_key: CONFIG_KEY,
            config_value: payload,
            description: '客服系统入口与工单引导配置',
            updated_by: user.id || null,
            updated_at: new Date().toISOString()
        }, {
            onConflict: 'config_key'
        });
    if (error) throw error;

    await writeAdminAuditLog({
        supabase,
        adminId: user.id,
        module: 'engagement',
        actionType: `engagement.entry.${action}`,
        details: {
            config_key: CONFIG_KEY,
            enabled: payload.enabled,
            context_count: payload.contexts.length,
            guide_count: payload.guides.length,
            target_id: sanitizeText(body.id || body.context_id || body.contextId || body.guide_id || body.guideId, 120)
        }
    });

    return payload;
}

module.exports = async function engagementEntryHandler(req, res) {
    try {
        const { supabase, user } = await requireAdmin(req, {
            anyOf: ['chat.manage', 'settings.manage']
        });

        if (req.method === 'GET') {
            const supportEntry = await loadSupportEntryCenter(supabase);
            return sendJson(res, 200, {
                success: true,
                support_entry: supportEntry
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
        const supportEntry = await saveSupportEntryCenter({ supabase, user, body });
        return sendJson(res, 200, {
            success: true,
            support_entry: supportEntry
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Failed to manage engagement support entry'
        });
    }
};
