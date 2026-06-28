const {
    normalizeSiteValue
} = require('../../api/_lib/site');
const {
    classifyManagedSite
} = require('../../api/_lib/payments/site-origins');

const SITE_SCOPED_SYSTEM_CONFIG_MARKER = '__site_scoped';
const SITE_SCOPED_SYSTEM_CONFIG_KEYS = new Set([
    'unlock_pricing',
    'payment_channels',
    'recharge_options',
    'discount_trigger_rules',
    'affiliate_program',
    'affiliate_poster',
    'rewards',
    'checkin_system',
    'notifications',
    'verify_settings',
    'ops_alerts',
    'ai_image_guardrails',
    'ai_image_storage_policy',
    'engagement_asset_style_center',
    'engagement_support_entry_center',
    'engagement_page_scenes',
    'engagement_external_embed_policy',
    'engagement_user_tag_center'
]);
const PUBLIC_SITE_SYSTEM_CONFIG_KEYS = new Set([
    'unlock_pricing',
    'payment_channels',
    'recharge_options',
    'affiliate_program',
    'affiliate_poster',
    'rewards',
    'checkin_system',
    'notifications'
]);

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeText(value, maxLength = 120) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function isSiteScopedSystemConfigKey(key) {
    return SITE_SCOPED_SYSTEM_CONFIG_KEYS.has(sanitizeText(key, 120));
}

function isPublicSiteSystemConfigKey(key) {
    return PUBLIC_SITE_SYSTEM_CONFIG_KEYS.has(sanitizeText(key, 120));
}

function normalizeSiteScopedSystemConfigSite(value, options = {}) {
    const allowAll = options.allowAll === true;
    const hasFallback = Object.prototype.hasOwnProperty.call(options, 'fallback');
    const fallback = allowAll && String(options.fallback || '').trim().toLowerCase() === 'all'
        ? 'all'
        : (hasFallback && sanitizeText(options.fallback, 20) === ''
            ? ''
            : normalizeSiteValue(options.fallback, { fallback: 'cn' }));
    const normalized = sanitizeText(value, 40).toLowerCase();

    if (!normalized) {
        return fallback;
    }

    if (allowAll && normalized === 'all') {
        return 'all';
    }

    return normalizeSiteValue(normalized, {
        fallback: fallback === 'all'
            ? 'cn'
            : (fallback || '')
    });
}

function detectManagedSiteFromRequest(req = {}) {
    const candidates = [
        req?.query?.site,
        req?.site,
        req?.headers?.['x-site'],
        req?.headers?.['x-forwarded-host'],
        req?.headers?.host,
        req?.headers?.Host,
        req?.headers?.origin,
        req?.headers?.referer
    ];

    for (const candidate of candidates) {
        const directSite = normalizeSiteScopedSystemConfigSite(candidate, { allowAll: false, fallback: '' });
        if (directSite === 'cn' || directSite === 'intl') {
            return directSite;
        }

        const classifiedSite = classifyManagedSite(candidate);
        if (classifiedSite === 'cn' || classifiedSite === 'intl') {
            return classifiedSite;
        }
    }

    return '';
}

function resolveSiteScopedSystemConfigRequestSite(req = {}, url = null, options = {}) {
    const allowAll = options.allowAll === true;
    const fallback = options.fallback || 'cn';
    const querySite = url?.searchParams?.get?.('site');
    const directSite = normalizeSiteScopedSystemConfigSite(querySite, {
        allowAll,
        fallback: ''
    });

    if (directSite === 'all' || directSite === 'cn' || directSite === 'intl') {
        return directSite;
    }

    const requestSite = detectManagedSiteFromRequest(req);
    return normalizeSiteScopedSystemConfigSite(requestSite, {
        allowAll,
        fallback
    });
}

function isSiteScopedSystemConfigEnvelope(value) {
    return isPlainObject(value) && value[SITE_SCOPED_SYSTEM_CONFIG_MARKER] === true;
}

function getSiteScopedSystemConfigDefaultValue(value) {
    if (!isSiteScopedSystemConfigEnvelope(value)) {
        return value ?? null;
    }

    if (Object.prototype.hasOwnProperty.call(value, 'default')) {
        return value.default;
    }

    return null;
}

function buildSiteScopedSystemConfigEnvelope(value) {
    if (isSiteScopedSystemConfigEnvelope(value)) {
        const sourceSites = isPlainObject(value.sites) ? value.sites : {};
        const sites = {};

        ['cn', 'intl'].forEach((site) => {
            if (Object.prototype.hasOwnProperty.call(sourceSites, site)) {
                sites[site] = sourceSites[site];
            }
        });

        return {
            [SITE_SCOPED_SYSTEM_CONFIG_MARKER]: true,
            default: getSiteScopedSystemConfigDefaultValue(value),
            sites
        };
    }

    return {
        [SITE_SCOPED_SYSTEM_CONFIG_MARKER]: true,
        default: value ?? null,
        sites: {}
    };
}

function resolveSiteScopedSystemConfigValue(value, site = 'cn') {
    const normalizedSite = normalizeSiteScopedSystemConfigSite(site, { fallback: 'cn' });

    if (!isSiteScopedSystemConfigEnvelope(value)) {
        return value ?? null;
    }

    const sites = isPlainObject(value.sites) ? value.sites : {};
    if (Object.prototype.hasOwnProperty.call(sites, normalizedSite)) {
        return sites[normalizedSite];
    }

    return getSiteScopedSystemConfigDefaultValue(value);
}

function resolveSiteScopedSystemConfigForRead(key, value, site = 'all') {
    if (!isSiteScopedSystemConfigKey(key)) {
        return value ?? null;
    }

    const normalizedSite = normalizeSiteScopedSystemConfigSite(site, {
        allowAll: true,
        fallback: 'all'
    });

    if (normalizedSite === 'all') {
        return getSiteScopedSystemConfigDefaultValue(value);
    }

    return resolveSiteScopedSystemConfigValue(value, normalizedSite);
}

function upsertSiteScopedSystemConfigValue(currentValue, site = 'cn', nextValue = null) {
    const normalizedSite = normalizeSiteScopedSystemConfigSite(site, { fallback: 'cn' });
    const envelope = buildSiteScopedSystemConfigEnvelope(currentValue);
    envelope.sites[normalizedSite] = nextValue;
    return envelope;
}

module.exports = {
    PUBLIC_SITE_SYSTEM_CONFIG_KEYS,
    SITE_SCOPED_SYSTEM_CONFIG_KEYS,
    SITE_SCOPED_SYSTEM_CONFIG_MARKER,
    buildSiteScopedSystemConfigEnvelope,
    detectManagedSiteFromRequest,
    getSiteScopedSystemConfigDefaultValue,
    isPublicSiteSystemConfigKey,
    isSiteScopedSystemConfigEnvelope,
    isSiteScopedSystemConfigKey,
    normalizeSiteScopedSystemConfigSite,
    resolveSiteScopedSystemConfigForRead,
    resolveSiteScopedSystemConfigRequestSite,
    resolveSiteScopedSystemConfigValue,
    upsertSiteScopedSystemConfigValue
};
