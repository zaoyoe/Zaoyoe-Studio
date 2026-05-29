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

function normalizeSiteLayoutEmail(value, fallback) {
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

function buildDefaultSiteLayout(site = 'cn') {
    const normalizedSite = normalizeSiteLayoutSite(site);
    const defaults = DEFAULT_SITE_LAYOUTS[normalizedSite] || DEFAULT_SITE_LAYOUTS.cn;
    return {
        root_page_key: defaults.root_page_key,
        logo_target_mode: defaults.logo_target_mode,
        logo_page_key: defaults.logo_page_key,
        footer_contacts: normalizeSiteLayoutFooterContacts(defaults.footer_contacts)
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

    return {
        root_page_key: rootPageKey,
        logo_target_mode: logoTargetMode,
        logo_page_key: logoTargetMode === 'custom' ? logoPageKey : rootPageKey,
        footer_contacts: normalizeSiteLayoutFooterContacts(source.footer_contacts, defaults.footer_contacts)
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
    buildDefaultSiteLayout,
    normalizeSiteLayoutFooterContacts,
    normalizeSiteLayoutPageKey,
    normalizeSiteLayoutRecord,
    normalizeSiteLayouts,
    normalizeSiteLayoutSite
};
