const DEFAULT_SITE = 'cn';
const SUPPORTED_SITES = Object.freeze(['cn', 'intl']);
const SUPPORTED_SITE_SET = new Set(SUPPORTED_SITES);

function normalizeSiteValue(value, {
    fallback = DEFAULT_SITE,
    allowEmpty = false
} = {}) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
        return allowEmpty ? '' : fallback;
    }

    if (SUPPORTED_SITE_SET.has(normalized)) {
        return normalized;
    }

    return fallback;
}

function isSupportedSite(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return SUPPORTED_SITE_SET.has(normalized);
}

function requireSupportedSite(value, {
    fieldName = 'site',
    fallback = DEFAULT_SITE,
    allowEmpty = false
} = {}) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
        return allowEmpty ? '' : fallback;
    }

    if (!SUPPORTED_SITE_SET.has(normalized)) {
        const error = new Error(`${fieldName} 不支持，当前仅允许 ${SUPPORTED_SITES.join(' / ')}`);
        error.statusCode = 400;
        throw error;
    }

    return normalized;
}

module.exports = {
    DEFAULT_SITE,
    SUPPORTED_SITES,
    isSupportedSite,
    normalizeSiteValue,
    requireSupportedSite
};
