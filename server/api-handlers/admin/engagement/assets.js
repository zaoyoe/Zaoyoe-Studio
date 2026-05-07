const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');

const CONFIG_KEY = 'engagement_asset_style_center';
const VALID_ASSET_TYPES = Object.freeze(new Set(['icon', 'image', 'badge', 'illustration']));
const VALID_TONES = Object.freeze(new Set(['info', 'success', 'warning', 'alert', 'error', 'welcome', 'creative', 'calm', 'commerce', 'assistive', 'community']));
const VALID_DENSITIES = Object.freeze(new Set(['compact', 'comfortable', 'spacious']));
const VALID_SHADOWS = Object.freeze(new Set(['none', 'soft', 'elevated']));
const VALID_ANIMATIONS = Object.freeze(new Set(['none', 'gentle', 'lively']));
const VALID_ROBOT_VARIANTS = Object.freeze(new Set(['default', 'rounded', 'minimal']));
const DEFAULT_ACCENT = '#6b9ece';

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

function normalizeHexColor(value = '', fallback = DEFAULT_ACCENT) {
    const normalized = sanitizeText(value, 24).toLowerCase();
    return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : fallback;
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

function slugify(value = '', fallback = 'asset') {
    const slug = sanitizeText(value, 120)
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return slug || `${fallback}-${Date.now().toString(36)}`;
}

function normalizeStyle(style = {}) {
    const density = normalizeToken(style.density, 'comfortable');
    const shadow = normalizeToken(style.shadow, 'soft');
    const animation = normalizeToken(style.animation, 'gentle');
    const robotVariant = normalizeToken(style.robot_variant || style.robotVariant, 'default');
    return {
        enabled: normalizeBoolean(style.enabled, true),
        preset: normalizeToken(style.preset, 'studio_blue'),
        accent_color: normalizeHexColor(style.accent_color || style.accentColor, DEFAULT_ACCENT),
        title_color: normalizeHexColor(style.title_color || style.titleColor, '#5f95cc'),
        bubble_background: normalizeHexColor(style.bubble_background || style.bubbleBackground, '#ffffff'),
        text_color: normalizeHexColor(style.text_color || style.textColor, '#1f2937'),
        radius_px: normalizeInteger(style.radius_px || style.radiusPx, 22, { min: 12, max: 32 }),
        max_width_px: normalizeInteger(style.max_width_px || style.maxWidthPx, 520, { min: 260, max: 560 }),
        density: VALID_DENSITIES.has(density) ? density : 'comfortable',
        shadow: VALID_SHADOWS.has(shadow) ? shadow : 'soft',
        animation: VALID_ANIMATIONS.has(animation) ? animation : 'gentle',
        robot_variant: VALID_ROBOT_VARIANTS.has(robotVariant) ? robotVariant : 'default'
    };
}

function normalizeAsset(asset = {}) {
    const type = normalizeToken(asset.type, 'icon');
    const tone = normalizeToken(asset.tone, 'info');
    const name = sanitizeText(asset.name || asset.title || '未命名素材', 120) || '未命名素材';
    return {
        id: sanitizeText(asset.id, 120) || slugify(asset.key || name, 'asset'),
        key: sanitizeText(asset.key, 120),
        name,
        description: sanitizeText(asset.description || asset.desc, 500),
        type: VALID_ASSET_TYPES.has(type) ? type : 'icon',
        icon: sanitizeText(asset.icon || 'fa-robot', 80) || 'fa-robot',
        url: sanitizeText(asset.url || asset.image_url || asset.imageUrl, 1000),
        tone: VALID_TONES.has(tone) ? tone : 'info',
        page_ids: normalizeStringArray(asset.page_ids || asset.pageIds || ['all']),
        enabled: normalizeBoolean(asset.enabled, true)
    };
}

function getDefaultAssetCenter() {
    return {
        style: normalizeStyle({}),
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
            }),
            normalizeAsset({
                id: 'reply-badge',
                name: '回复提醒',
                description: '留言和评论回复场景的社区提醒素材。',
                type: 'badge',
                icon: 'fa-comments',
                tone: 'community',
                page_ids: ['guestbook', 'prompts'],
                enabled: true
            })
        ]
    };
}

function normalizeAssetCenter(value = {}) {
    const defaults = getDefaultAssetCenter();
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const assets = Array.isArray(source.assets) ? source.assets.map(normalizeAsset) : defaults.assets;
    return {
        style: normalizeStyle(source.style || {}),
        assets: Array.from(new Map(assets.map((asset) => [asset.id, asset])).values()).slice(0, 80),
        updated_at: sanitizeText(source.updated_at, 120)
    };
}

async function loadAssetCenter(supabase) {
    const { data, error } = await supabase
        .from('system_config')
        .select('config_value')
        .eq('config_key', CONFIG_KEY)
        .maybeSingle();
    if (error) throw error;
    return normalizeAssetCenter(data?.config_value || {});
}

async function saveAssetCenter({ supabase, user, body }) {
    const current = await loadAssetCenter(supabase);
    const action = normalizeToken(body.action, 'save_style');
    let nextCenter = current;

    if (action === 'save_asset') {
        const asset = normalizeAsset(body.asset || body);
        const assetMap = new Map(current.assets.map((item) => [item.id, item]));
        assetMap.set(asset.id, asset);
        nextCenter = {
            ...current,
            assets: Array.from(assetMap.values())
        };
    } else if (action === 'delete_asset') {
        const assetId = sanitizeText(body.id || body.asset_id || body.assetId, 120);
        nextCenter = {
            ...current,
            assets: current.assets.filter((asset) => asset.id !== assetId)
        };
    } else if (action === 'save_all') {
        nextCenter = normalizeAssetCenter(body.asset_center || body.assetCenter || body);
    } else {
        nextCenter = {
            ...current,
            style: normalizeStyle(body.style || body)
        };
    }

    const payload = {
        ...normalizeAssetCenter(nextCenter),
        updated_at: new Date().toISOString()
    };

    const { error } = await supabase
        .from('system_config')
        .upsert({
            config_key: CONFIG_KEY,
            config_value: payload,
            description: '客服系统素材与样式中心配置',
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
        actionType: `engagement.assets.${action}`,
        details: {
            config_key: CONFIG_KEY,
            style: payload.style,
            asset_count: payload.assets.length,
            asset_id: sanitizeText(body.id || body.asset_id || body.assetId || body.asset?.id, 120)
        }
    });

    return payload;
}

module.exports = async function engagementAssetsHandler(req, res) {
    try {
        const { supabase, user } = await requireAdmin(req, {
            anyOf: ['chat.manage', 'settings.manage']
        });

        if (req.method === 'GET') {
            const assetCenter = await loadAssetCenter(supabase);
            return sendJson(res, 200, {
                success: true,
                asset_center: assetCenter
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
        const assetCenter = await saveAssetCenter({ supabase, user, body });
        return sendJson(res, 200, {
            success: true,
            asset_center: assetCenter
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Failed to manage engagement assets'
        });
    }
};
