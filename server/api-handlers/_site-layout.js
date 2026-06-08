const SITE_LAYOUT_CONFIG_KEY = 'site_layouts';

const SITE_LAYOUT_PAGE_OPTIONS = Object.freeze([
    Object.freeze({
        key: 'home',
        label: '首页',
        path: '/'
    }),
    Object.freeze({
        key: 'shop',
        label: '商城',
        path: '/shop.html'
    }),
    Object.freeze({
        key: 'prompts',
        label: '提示词',
        path: '/prompts.html'
    }),
    Object.freeze({
        key: 'verify',
        label: 'Gemini Pro',
        path: '/verify.html'
    }),
    Object.freeze({
        key: 'guestbook',
        label: '留言板',
        path: '/guestbook.html'
    }),
    Object.freeze({
        key: 'gongyi',
        label: 'API中转',
        path: 'https://sub2api.fatherkey.com'
    })
]);

const SITE_LAYOUT_PAGE_KEY_SET = new Set(SITE_LAYOUT_PAGE_OPTIONS.map((option) => option.key));
const SITE_LAYOUT_LOGO_MODE_SET = new Set(['follow_root', 'custom']);
const SITE_LAYOUT_SUPPORT_ACTION_SET = new Set(['link', 'email', 'copy', 'chat', 'detail']);
const SITE_LAYOUT_SUPPORT_ICON_SET = new Set([
    'none',
    'telegram',
    'wechat',
    'qq',
    'email',
    'discord',
    'whatsapp',
    'x',
    'github',
    'instagram',
    'tiktok',
    'youtube',
    'bilibili',
    'xiaohongshu',
    'weibo',
    'support_bot',
    'heart',
    'link'
]);
const SITE_LAYOUT_SUPPORT_PLACEMENT_SET = new Set([
    'nav',
    'mobile_nav',
    'footer_brand',
    'footer_resources',
    'footer_about',
    'footer_bottom'
]);
const DEFAULT_FOOTER_CONTACTS = Object.freeze({
    support_url: 'https://afdian.com/a/zaoyoe',
    telegram_url: 'https://t.me/zaoyoe',
    telegram_group_url: 'https://t.me/+I86eX5sPF1c0OTc1',
    contact_email: 'zaoyoe@gmail.com'
});

const DEFAULT_SITE_LAYOUTS = Object.freeze({
    cn: Object.freeze({
        root_page_key: 'home',
        logo_target_mode: 'follow_root',
        logo_page_key: 'home',
        footer_contacts: DEFAULT_FOOTER_CONTACTS
    }),
    intl: Object.freeze({
        root_page_key: 'shop',
        logo_target_mode: 'follow_root',
        logo_page_key: 'shop',
        footer_contacts: DEFAULT_FOOTER_CONTACTS
    })
});

function normalizeSiteLayoutSite(site) {
    return site === 'intl' ? 'intl' : 'cn';
}

function sanitizeText(value, maxLength = 120) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeSiteLayoutPageKey(value, fallback = 'home') {
    const normalized = sanitizeText(value, 80).toLowerCase();
    if (SITE_LAYOUT_PAGE_KEY_SET.has(normalized)) {
        return normalized;
    }
    return SITE_LAYOUT_PAGE_KEY_SET.has(fallback) ? fallback : 'home';
}

function normalizeSiteLayoutUrl(value, fallback) {
    const source = sanitizeText(value, 500);
    const fallbackValue = sanitizeText(fallback, 500);
    if (!source) return fallbackValue;

    try {
        const parsed = new URL(source);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return parsed.toString();
        }
    } catch (_error) {
        return fallbackValue;
    }

    return fallbackValue;
}

function normalizeSiteLayoutSupportActionUrl(value, fallback = '') {
    const source = sanitizeText(value, 800);
    const fallbackValue = sanitizeText(fallback, 800);
    if (!source) return fallbackValue;

    if (source.startsWith('/') || source.startsWith('#')) {
        return source;
    }

    try {
        const parsed = new URL(source);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return parsed.toString();
        }
    } catch (_error) {
        return fallbackValue;
    }

    return fallbackValue;
}

function normalizeSiteLayoutSupportImageUrl(value, fallback = '') {
    const source = sanitizeText(value, 800);
    const fallbackValue = sanitizeText(fallback, 800);
    if (!source) return fallbackValue;

    if (source.startsWith('/')) {
        return source;
    }

    try {
        const parsed = new URL(source);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return parsed.toString();
        }
    } catch (_error) {
        return fallbackValue;
    }

    return fallbackValue;
}

function normalizeSiteLayoutEmail(value, fallback = '') {
    const source = sanitizeText(value, 320);
    const fallbackValue = sanitizeText(fallback, 320);
    if (!source) return fallbackValue;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(source) ? source : fallbackValue;
}

function normalizeSiteLayoutFooterContacts(value, fallback = DEFAULT_FOOTER_CONTACTS) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
    const defaults = fallback && typeof fallback === 'object' && !Array.isArray(fallback)
        ? fallback
        : DEFAULT_FOOTER_CONTACTS;

    return {
        support_url: normalizeSiteLayoutUrl(source.support_url, defaults.support_url),
        telegram_url: normalizeSiteLayoutUrl(source.telegram_url, defaults.telegram_url),
        telegram_group_url: normalizeSiteLayoutUrl(source.telegram_group_url, defaults.telegram_group_url),
        contact_email: normalizeSiteLayoutEmail(source.contact_email, defaults.contact_email)
    };
}

function buildDefaultSiteLayoutSupportChannels(footerContacts = DEFAULT_FOOTER_CONTACTS) {
    const contacts = normalizeSiteLayoutFooterContacts(footerContacts);
    return [
        {
            id: 'sponsor',
            name: '赞助支持',
            short_name: '赞助',
            description: '跳转到赞助支持页面',
            icon: 'heart',
            action: 'link',
            target_url: contacts.support_url,
            target_email: '',
            copy_text: '',
            detail_title: '',
            detail_body: '',
            detail_image_url: '',
            detail_copy_label: '',
            detail_link_label: '',
            enabled: true,
            order: 10,
            placements: ['footer_resources', 'footer_bottom']
        },
        {
            id: 'telegram',
            name: 'TG',
            short_name: 'TG',
            description: 'Telegram 联系入口',
            icon: 'telegram',
            action: 'link',
            target_url: contacts.telegram_url,
            target_email: '',
            copy_text: '',
            detail_title: '',
            detail_body: '',
            detail_image_url: '',
            detail_copy_label: '',
            detail_link_label: '',
            enabled: true,
            order: 20,
            placements: ['nav', 'mobile_nav', 'footer_brand']
        },
        {
            id: 'telegram_group',
            name: 'TG群组',
            short_name: 'TG群组',
            description: 'Telegram 社群入口',
            icon: 'telegram',
            action: 'link',
            target_url: contacts.telegram_group_url,
            target_email: '',
            copy_text: '',
            detail_title: '',
            detail_body: '',
            detail_image_url: '',
            detail_copy_label: '',
            detail_link_label: '',
            enabled: true,
            order: 30,
            placements: ['nav', 'mobile_nav', 'footer_about']
        },
        {
            id: 'email',
            name: '邮箱',
            short_name: '邮箱',
            description: '公开联系邮箱',
            icon: 'email',
            action: 'email',
            target_url: '',
            target_email: contacts.contact_email,
            copy_text: '',
            detail_title: '',
            detail_body: '',
            detail_image_url: '',
            detail_copy_label: '',
            detail_link_label: '',
            enabled: true,
            order: 40,
            placements: ['footer_about']
        }
    ];
}

function normalizeSiteLayoutSupportPlacements(value, fallback = []) {
    const source = Array.isArray(value) ? value : fallback;
    const placements = Array.from(new Set(source
        .map((entry) => sanitizeText(entry, 80).toLowerCase())
        .filter((entry) => SITE_LAYOUT_SUPPORT_PLACEMENT_SET.has(entry))));
    return placements.length ? placements : [];
}

function normalizeSiteLayoutSupportChannel(value, index = 0, fallback = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
    const defaults = fallback && typeof fallback === 'object' && !Array.isArray(fallback)
        ? fallback
        : {};
    const action = SITE_LAYOUT_SUPPORT_ACTION_SET.has(sanitizeText(source.action, 80).toLowerCase())
        ? sanitizeText(source.action, 80).toLowerCase()
        : (SITE_LAYOUT_SUPPORT_ACTION_SET.has(defaults.action) ? defaults.action : 'link');
    const icon = SITE_LAYOUT_SUPPORT_ICON_SET.has(sanitizeText(source.icon, 80).toLowerCase())
        ? sanitizeText(source.icon, 80).toLowerCase()
        : (SITE_LAYOUT_SUPPORT_ICON_SET.has(defaults.icon) ? defaults.icon : 'link');
    const name = sanitizeText(source.name, 120) || sanitizeText(defaults.name, 120) || `站点入口 ${index + 1}`;
    const shortName = sanitizeText(source.short_name || source.shortName, 80)
        || sanitizeText(defaults.short_name || defaults.shortName, 80)
        || name;
    const id = sanitizeText(source.id, 100).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
        || sanitizeText(defaults.id, 100).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
        || `support-${index + 1}`;
    const hasTargetUrl = Object.prototype.hasOwnProperty.call(source, 'target_url')
        || Object.prototype.hasOwnProperty.call(source, 'url');
    const hasTargetEmail = Object.prototype.hasOwnProperty.call(source, 'target_email')
        || Object.prototype.hasOwnProperty.call(source, 'email');
    const hasCopyText = Object.prototype.hasOwnProperty.call(source, 'copy_text')
        || Object.prototype.hasOwnProperty.call(source, 'copyText');
    const hasDetailTitle = Object.prototype.hasOwnProperty.call(source, 'detail_title')
        || Object.prototype.hasOwnProperty.call(source, 'detailTitle');
    const hasDetailBody = Object.prototype.hasOwnProperty.call(source, 'detail_body')
        || Object.prototype.hasOwnProperty.call(source, 'detailBody')
        || Object.prototype.hasOwnProperty.call(source, 'content')
        || Object.prototype.hasOwnProperty.call(source, 'body');
    const hasDetailImageUrl = Object.prototype.hasOwnProperty.call(source, 'detail_image_url')
        || Object.prototype.hasOwnProperty.call(source, 'detailImageUrl')
        || Object.prototype.hasOwnProperty.call(source, 'qr_code_url')
        || Object.prototype.hasOwnProperty.call(source, 'qrCodeUrl');
    const hasDetailCopyLabel = Object.prototype.hasOwnProperty.call(source, 'detail_copy_label')
        || Object.prototype.hasOwnProperty.call(source, 'detailCopyLabel');
    const hasDetailLinkLabel = Object.prototype.hasOwnProperty.call(source, 'detail_link_label')
        || Object.prototype.hasOwnProperty.call(source, 'detailLinkLabel');

    return {
        id,
        name,
        short_name: shortName,
        description: sanitizeText(source.description, 240) || sanitizeText(defaults.description, 240),
        icon,
        action,
        target_url: normalizeSiteLayoutSupportActionUrl(source.target_url || source.url, hasTargetUrl ? '' : (defaults.target_url || defaults.url || '')),
        target_email: normalizeSiteLayoutEmail(source.target_email || source.email, hasTargetEmail ? '' : (defaults.target_email || defaults.email || '')),
        copy_text: sanitizeText(source.copy_text || source.copyText, 800) || (hasCopyText ? '' : sanitizeText(defaults.copy_text || defaults.copyText, 800)),
        detail_title: sanitizeText(source.detail_title || source.detailTitle, 120) || (hasDetailTitle ? '' : sanitizeText(defaults.detail_title || defaults.detailTitle, 120)),
        detail_body: sanitizeText(source.detail_body || source.detailBody || source.content || source.body, 1200) || (hasDetailBody ? '' : sanitizeText(defaults.detail_body || defaults.detailBody || defaults.content || defaults.body, 1200)),
        detail_image_url: normalizeSiteLayoutSupportImageUrl(source.detail_image_url || source.detailImageUrl || source.qr_code_url || source.qrCodeUrl, hasDetailImageUrl ? '' : (defaults.detail_image_url || defaults.detailImageUrl || defaults.qr_code_url || defaults.qrCodeUrl || '')),
        detail_copy_label: sanitizeText(source.detail_copy_label || source.detailCopyLabel, 80) || (hasDetailCopyLabel ? '' : sanitizeText(defaults.detail_copy_label || defaults.detailCopyLabel, 80)),
        detail_link_label: sanitizeText(source.detail_link_label || source.detailLinkLabel, 80) || (hasDetailLinkLabel ? '' : sanitizeText(defaults.detail_link_label || defaults.detailLinkLabel, 80)),
        enabled: source.enabled !== false,
        order: Number.isFinite(Number(source.order)) ? Math.max(0, Math.min(999, Math.round(Number(source.order)))) : (Number(defaults.order) || (index + 1) * 10),
        placements: normalizeSiteLayoutSupportPlacements(source.placements, defaults.placements || [])
    };
}

function normalizeSiteLayoutSupportChannels(value, footerContacts = DEFAULT_FOOTER_CONTACTS) {
    const defaults = buildDefaultSiteLayoutSupportChannels(footerContacts);
    const source = Array.isArray(value) ? value : defaults;
    const seenIds = new Set();

    return source
        .map((entry, index) => normalizeSiteLayoutSupportChannel(entry, index, defaults[index] || {}))
        .map((channel, index) => {
            let id = channel.id || `support-${index + 1}`;
            let suffix = 2;
            while (seenIds.has(id)) {
                id = `${channel.id || 'support'}-${suffix}`;
                suffix += 1;
            }
            seenIds.add(id);
            return {
                ...channel,
                id
            };
        })
        .sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

function buildDefaultSiteLayout(site = 'cn') {
    const normalizedSite = normalizeSiteLayoutSite(site);
    const defaults = DEFAULT_SITE_LAYOUTS[normalizedSite] || DEFAULT_SITE_LAYOUTS.cn;
    return {
        root_page_key: defaults.root_page_key,
        logo_target_mode: defaults.logo_target_mode,
        logo_page_key: defaults.logo_page_key,
        footer_contacts: normalizeSiteLayoutFooterContacts(defaults.footer_contacts),
        support_channels: normalizeSiteLayoutSupportChannels(null, defaults.footer_contacts)
    };
}

function normalizeSiteLayoutRecord(value, site = 'cn') {
    const normalizedSite = normalizeSiteLayoutSite(site);
    const defaults = buildDefaultSiteLayout(normalizedSite);
    const source = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
    const rootPageKey = normalizeSiteLayoutPageKey(source.root_page_key, defaults.root_page_key);
    const logoTargetMode = SITE_LAYOUT_LOGO_MODE_SET.has(sanitizeText(source.logo_target_mode, 80).toLowerCase())
        ? sanitizeText(source.logo_target_mode, 80).toLowerCase()
        : defaults.logo_target_mode;
    const logoPageKey = normalizeSiteLayoutPageKey(
        source.logo_page_key,
        logoTargetMode === 'custom' ? defaults.logo_page_key : rootPageKey
    );

    const footerContacts = normalizeSiteLayoutFooterContacts(source.footer_contacts, defaults.footer_contacts);

    return {
        root_page_key: rootPageKey,
        logo_target_mode: logoTargetMode,
        logo_page_key: logoTargetMode === 'custom' ? logoPageKey : rootPageKey,
        footer_contacts: footerContacts,
        support_channels: normalizeSiteLayoutSupportChannels(source.support_channels, footerContacts)
    };
}

function normalizeSiteLayouts(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};

    return {
        cn: normalizeSiteLayoutRecord(source.cn, 'cn'),
        intl: normalizeSiteLayoutRecord(source.intl, 'intl')
    };
}

module.exports = {
    DEFAULT_FOOTER_CONTACTS,
    DEFAULT_SITE_LAYOUTS,
    SITE_LAYOUT_CONFIG_KEY,
    SITE_LAYOUT_PAGE_OPTIONS,
    SITE_LAYOUT_SUPPORT_ACTION_SET,
    SITE_LAYOUT_SUPPORT_ICON_SET,
    SITE_LAYOUT_SUPPORT_PLACEMENT_SET,
    buildDefaultSiteLayoutSupportChannels,
    buildDefaultSiteLayout,
    normalizeSiteLayoutFooterContacts,
    normalizeSiteLayoutPageKey,
    normalizeSiteLayoutRecord,
    normalizeSiteLayoutSupportChannels,
    normalizeSiteLayouts,
    normalizeSiteLayoutSite
};
