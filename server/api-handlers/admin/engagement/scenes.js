const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');

const CONFIG_KEY = 'engagement_page_scenes';
const VALID_SCENE_PAGES = Object.freeze(new Set(['home', 'prompts', 'gongyi', 'shop', 'verify', 'guestbook']));
const VALID_SCENE_TONES = Object.freeze(new Set(['info', 'success', 'warning', 'alert', 'welcome', 'creative', 'calm', 'commerce', 'assistive', 'community']));
const VALID_SCENE_PLACEMENTS = Object.freeze(new Set(['robot_bubble', 'top_banner', 'inline_card', 'modal', 'floating_badge']));
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

function sanitizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeBoolean(value, fallback = true) {
    if (value === true || value === 'true' || value === 1 || value === '1') return true;
    if (value === false || value === 'false' || value === 0 || value === '0') return false;
    return fallback;
}

function normalizeToken(value = '', fallback = '') {
    return sanitizeText(value, 80).toLowerCase().replace(/[^a-z0-9_-]/g, '') || fallback;
}

function normalizeStringArray(value) {
    const source = Array.isArray(value) ? value : String(value || '').split(/[\n,;|]+/);
    return [...new Set(source.map((item) => normalizeToken(item, '')).filter(Boolean))];
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

function normalizeScene(scene = {}) {
    const pageId = normalizeToken(scene.id || scene.page_id || scene.pageId, 'home');
    const safePageId = VALID_SCENE_PAGES.has(pageId) ? pageId : 'home';
    const tone = normalizeToken(scene.tone, 'info');
    const placement = normalizeToken(scene.default_placement || scene.defaultPlacement || scene.placement, 'robot_bubble');
    return {
        id: safePageId,
        page_id: safePageId,
        label: sanitizeText(scene.label || '', 80),
        tone: VALID_SCENE_TONES.has(tone) ? tone : 'info',
        safe_zone: sanitizeText(scene.safe_zone || scene.safeZone || 'bottom-right', 80) || 'bottom-right',
        default_placement: VALID_SCENE_PLACEMENTS.has(placement) ? placement : 'robot_bubble',
        allow_marketing: normalizeBoolean(scene.allow_marketing ?? scene.allowMarketing, true),
        events: normalizeStringArray(scene.events),
        event_priority_center: normalizeSceneEventPriorityCenter(scene.event_priority_center || scene.eventPriorityCenter || {})
    };
}

async function loadScenes(supabase) {
    const { data, error } = await supabase
        .from('system_config')
        .select('config_value')
        .eq('config_key', CONFIG_KEY)
        .maybeSingle();
    if (error) throw error;
    return {
        scenes: (Array.isArray(data?.config_value?.scenes) ? data.config_value.scenes : []).map(normalizeScene),
        event_priority_center: normalizeEventPriorityCenter(data?.config_value?.event_priority_center || {})
    };
}

async function saveScenes({ supabase, user, body }) {
    const existingConfig = await loadScenes(supabase);
    const incomingScenes = (Array.isArray(body.scenes) ? body.scenes : [body.scene || body])
        .map(normalizeScene)
        .filter((scene) => VALID_SCENE_PAGES.has(scene.id));
    const sceneMap = new Map(existingConfig.scenes.map((scene) => [scene.id, scene]));
    incomingScenes.forEach((scene) => {
        sceneMap.set(scene.id, scene);
    });
    const uniqueScenes = Array.from(sceneMap.values());
    const payload = {
        scenes: uniqueScenes,
        event_priority_center: existingConfig.event_priority_center,
        updated_at: new Date().toISOString()
    };

    const { error } = await supabase
        .from('system_config')
        .upsert({
            config_key: CONFIG_KEY,
            config_value: payload,
            description: '客服系统页面场景配置',
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
        actionType: 'engagement.scene.update',
        details: {
            config_key: CONFIG_KEY,
            pages: uniqueScenes.map((scene) => scene.id)
        }
    });

    return uniqueScenes;
}

async function saveEventPriorityCenter({ supabase, user, body }) {
    const existingConfig = await loadScenes(supabase);
    const payload = {
        scenes: existingConfig.scenes,
        event_priority_center: normalizeEventPriorityCenter(body.event_priority_center || body.eventPriorityCenter || {}),
        updated_at: new Date().toISOString()
    };

    const { error } = await supabase
        .from('system_config')
        .upsert({
            config_key: CONFIG_KEY,
            config_value: payload,
            description: '客服系统页面场景配置',
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
        actionType: 'engagement.event_priority.update',
        details: {
            config_key: CONFIG_KEY,
            priority_groups: Object.keys(payload.event_priority_center || {})
        }
    });

    return payload.event_priority_center;
}

module.exports = async function engagementScenesHandler(req, res) {
    try {
        const { supabase, user } = await requireAdmin(req, {
            anyOf: ['chat.manage', 'settings.manage']
        });

        if (req.method === 'GET') {
            const config = await loadScenes(supabase);
            return sendJson(res, 200, {
                success: true,
                scenes: config.scenes,
                event_priority_center: config.event_priority_center
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
        if (normalizeToken(body.action || '', '') === 'save_event_priority_center') {
            const eventPriorityCenter = await saveEventPriorityCenter({ supabase, user, body });
            return sendJson(res, 200, {
                success: true,
                event_priority_center: eventPriorityCenter
            });
        }
        const scenes = await saveScenes({ supabase, user, body });
        return sendJson(res, 200, {
            success: true,
            scenes
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Failed to manage engagement page scenes'
        });
    }
};
