const CONFIG_KEY = 'engagement_external_embed_policy';
const EMBED_VERSION = '20260505_GONGYI_EXTERNAL_ENGAGEMENT_1';
const DEFAULT_ASSET_BASE = 'https://www.zaoyoe.com/';
const DEFAULT_API_ORIGIN = 'https://www.zaoyoe.com';
const DEFAULT_EXTERNAL_EMBED_ORIGINS = Object.freeze([
    'https://gongyi.zaoyoe.com',
    'https://www.gongyi.zaoyoe.com',
    'https://zaoyoe.com',
    'https://www.zaoyoe.com'
]);

function sanitizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeToken(value = '', fallback = '') {
    return sanitizeText(value, 120).toLowerCase().replace(/[^a-z0-9_-]/g, '') || fallback;
}

function normalizeBoolean(value, fallback = true) {
    if (value === true || value === 'true' || value === 1 || value === '1') return true;
    if (value === false || value === 'false' || value === 0 || value === '0') return false;
    return fallback;
}

function normalizeOrigin(value = '') {
    const raw = sanitizeText(value, 240);
    if (!raw) return '';
    try {
        return new URL(raw).origin;
    } catch (_) {
        return '';
    }
}

function normalizeOriginArray(value) {
    const source = Array.isArray(value) ? value : String(value || '').split(/[\n,;|]+/);
    return [...new Set(source.map(normalizeOrigin).filter(Boolean))];
}

function normalizeBaseUrl(value = '', fallback = DEFAULT_ASSET_BASE) {
    const raw = sanitizeText(value, 1000) || fallback;
    try {
        return new URL(raw).toString().replace(/\/?$/, '/');
    } catch (_) {
        return fallback;
    }
}

function normalizeApiOrigin(value = '', fallback = DEFAULT_API_ORIGIN) {
    return normalizeOrigin(value) || normalizeOrigin(fallback) || DEFAULT_API_ORIGIN;
}

function getDefaultExternalEmbedPolicy() {
    return {
        enabled: true,
        allowed_origins: [...DEFAULT_EXTERNAL_EMBED_ORIGINS],
        allow_local_preview: true,
        api_origin: DEFAULT_API_ORIGIN,
        asset_base: DEFAULT_ASSET_BASE,
        default_page_id: 'gongyi',
        default_site: 'cn',
        script_version: EMBED_VERSION,
        updated_at: ''
    };
}

function normalizeExternalEmbedPolicy(value = {}) {
    const defaults = getDefaultExternalEmbedPolicy();
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const allowedOrigins = normalizeOriginArray(source.allowed_origins || source.allowedOrigins || defaults.allowed_origins);
    const pageId = normalizeToken(source.default_page_id || source.defaultPageId, defaults.default_page_id);
    const site = normalizeToken(source.default_site || source.defaultSite, defaults.default_site);
    return {
        enabled: normalizeBoolean(source.enabled, defaults.enabled),
        allowed_origins: allowedOrigins.length ? allowedOrigins : defaults.allowed_origins,
        allow_local_preview: normalizeBoolean(source.allow_local_preview ?? source.allowLocalPreview, defaults.allow_local_preview),
        api_origin: normalizeApiOrigin(source.api_origin || source.apiOrigin, defaults.api_origin),
        asset_base: normalizeBaseUrl(source.asset_base || source.assetBase, defaults.asset_base),
        default_page_id: ['home', 'prompts', 'gongyi', 'shop', 'verify', 'guestbook'].includes(pageId) ? pageId : defaults.default_page_id,
        default_site: site === 'intl' ? 'intl' : 'cn',
        script_version: sanitizeText(source.script_version || source.scriptVersion || defaults.script_version, 120) || defaults.script_version,
        updated_at: sanitizeText(source.updated_at || source.updatedAt, 120)
    };
}

function buildExternalEmbedScriptUrl(policy = {}) {
    const normalized = normalizeExternalEmbedPolicy(policy);
    return new URL(`js/engagement-external-embed.js?v=${encodeURIComponent(normalized.script_version)}`, normalized.asset_base).toString();
}

function buildExternalEmbedPreflightUrl(policy = {}) {
    const normalized = normalizeExternalEmbedPolicy(policy);
    const params = new URLSearchParams({
        page_id: normalized.default_page_id,
        site: normalized.default_site,
        reader_key: 'external_probe',
        trigger_type: 'page_view',
        limit: '1'
    });
    return `${normalized.api_origin}/api/engagement/feed?${params.toString()}`;
}

function buildExternalEmbedSnippet(policy = {}) {
    const normalized = normalizeExternalEmbedPolicy(policy);
    return [
        '<script',
        `  src="${buildExternalEmbedScriptUrl(normalized)}"`,
        `  data-page-id="${normalized.default_page_id}"`,
        `  data-site="${normalized.default_site}"`,
        `  data-api-origin="${normalized.api_origin}"`,
        `  data-asset-base="${normalized.asset_base}"`,
        '  async></script>'
    ].join('\n');
}

function buildExternalEmbedDiagnostics(policy = {}) {
    const normalized = normalizeExternalEmbedPolicy(policy);
    const gongyiOrigins = ['https://gongyi.zaoyoe.com', 'https://www.gongyi.zaoyoe.com'];
    const hasGongyiOrigin = gongyiOrigins.some((origin) => normalized.allowed_origins.includes(origin));
    return {
        status: normalized.enabled && hasGongyiOrigin ? 'ready' : 'attention',
        script_url: buildExternalEmbedScriptUrl(normalized),
        preflight_url: buildExternalEmbedPreflightUrl(normalized),
        smoke_command: 'npm run smoke:engagement-external',
        deployment_steps: [
            '复制后台生成的嵌入代码到API中转公共页',
            '确认浏览器 Network 中 engagement-external-embed.js、chat-widget-loader.js、ChatWidget.js 均加载成功',
            '运行 npm run smoke:engagement-external 做外部 origin 模拟验收',
            '真实API中转访问后，在客服系统效果分析中确认 view/click/dismiss 回流'
        ],
        allowed_origin_count: normalized.allowed_origins.length,
        has_gongyi_origin: hasGongyiOrigin,
        allow_local_preview: normalized.allow_local_preview,
        checks: [
            {
                id: 'enabled',
                label: '外部承载开关',
                status: normalized.enabled ? 'ok' : 'blocked',
                detail: normalized.enabled ? '外部域名可以请求触达 feed 和事件接口' : '外部嵌入已关闭'
            },
            {
                id: 'gongyi_origin',
                label: 'API中转白名单',
                status: hasGongyiOrigin ? 'ok' : 'warning',
                detail: hasGongyiOrigin ? 'API中转域名已在 CORS 白名单内' : '需要加入 https://gongyi.zaoyoe.com'
            },
            {
                id: 'asset_base',
                label: '素材地址',
                status: normalized.asset_base ? 'ok' : 'blocked',
                detail: normalized.asset_base || '缺少主站静态资源地址'
            },
            {
                id: 'api_origin',
                label: 'API 地址',
                status: normalized.api_origin ? 'ok' : 'blocked',
                detail: normalized.api_origin || '缺少主站 API origin'
            }
        ]
    };
}

module.exports = {
    CONFIG_KEY,
    EMBED_VERSION,
    DEFAULT_EXTERNAL_EMBED_ORIGINS,
    getDefaultExternalEmbedPolicy,
    normalizeExternalEmbedPolicy,
    buildExternalEmbedScriptUrl,
    buildExternalEmbedPreflightUrl,
    buildExternalEmbedSnippet,
    buildExternalEmbedDiagnostics
};
