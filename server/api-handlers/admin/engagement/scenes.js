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
        events: normalizeStringArray(scene.events)
    };
}

async function loadScenes(supabase) {
    const { data, error } = await supabase
        .from('system_config')
        .select('config_value')
        .eq('config_key', CONFIG_KEY)
        .maybeSingle();
    if (error) throw error;
    const rows = Array.isArray(data?.config_value?.scenes) ? data.config_value.scenes : [];
    return rows.map(normalizeScene);
}

async function saveScenes({ supabase, user, body }) {
    const incomingScenes = (Array.isArray(body.scenes) ? body.scenes : [body.scene || body])
        .map(normalizeScene)
        .filter((scene) => VALID_SCENE_PAGES.has(scene.id));
    const existingScenes = await loadScenes(supabase);
    const sceneMap = new Map(existingScenes.map((scene) => [scene.id, scene]));
    incomingScenes.forEach((scene) => {
        sceneMap.set(scene.id, scene);
    });
    const uniqueScenes = Array.from(sceneMap.values());
    const payload = {
        scenes: uniqueScenes,
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

module.exports = async function engagementScenesHandler(req, res) {
    try {
        const { supabase, user } = await requireAdmin(req, {
            anyOf: ['chat.manage', 'settings.manage']
        });

        if (req.method === 'GET') {
            const scenes = await loadScenes(supabase);
            return sendJson(res, 200, {
                success: true,
                scenes
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
