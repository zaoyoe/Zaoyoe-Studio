const SITE_CANONICAL_ORIGINS = Object.freeze({
    cn: 'https://www.fatherkey.com',
    intl: 'https://www.zaoyoe.xyz'
});

const MANAGED_SITE_HOSTS = Object.freeze({
    cn: Object.freeze(['fatherkey.com', 'zaoyoe.com']),
    intl: Object.freeze(['zaoyoe.xyz'])
});

function normalizeUrl(value = '') {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(normalized) ? normalized : `https://${normalized}`;
    return candidate.replace(/\/+$/, '');
}

function normalizeOrigin(value = '') {
    const normalized = normalizeUrl(value);
    if (!normalized) return '';

    try {
        return new URL(normalized).origin;
    } catch (_) {
        return '';
    }
}

function extractHostname(value = '') {
    const normalized = String(value || '').trim();
    if (!normalized) return '';

    try {
        const candidate = normalized.includes('://')
            ? normalized
            : `http://${normalized.replace(/^\/*/, '')}`;
        return String(new URL(candidate).hostname || '').trim().toLowerCase();
    } catch (_) {
        return normalized
            .replace(/^[a-z]+:\/\//i, '')
            .replace(/^\/+/, '')
            .split('/')[0]
            .split(':')[0]
            .trim()
            .toLowerCase();
    }
}

function isLocalHostname(value = '') {
    const hostname = extractHostname(value);
    return hostname === 'localhost' || hostname === '127.0.0.1';
}

function classifyManagedSite(value = '') {
    const hostname = extractHostname(value);
    if (!hostname) return '';
    if (MANAGED_SITE_HOSTS.cn.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) return 'cn';
    if (MANAGED_SITE_HOSTS.intl.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) return 'intl';
    return '';
}

function buildOriginFromHost(value = '') {
    const normalized = String(value || '').trim();
    if (!normalized) return '';

    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)) {
        return normalizeOrigin(normalized);
    }

    const protocol = isLocalHostname(normalized) ? 'http' : 'https';
    return normalizeOrigin(`${protocol}://${normalized}`);
}

function resolveSiteRequestOrigin({
    site = 'cn',
    requestHost = '',
    appBaseUrl = ''
} = {}) {
    const normalizedSite = String(site || '').trim().toLowerCase() === 'intl' ? 'intl' : 'cn';
    const candidates = [
        buildOriginFromHost(requestHost),
        normalizeOrigin(appBaseUrl),
        SITE_CANONICAL_ORIGINS[normalizedSite]
    ].filter(Boolean);

    for (const candidate of candidates) {
        if (isLocalHostname(candidate)) {
            return candidate;
        }

        if (classifyManagedSite(candidate) === normalizedSite) {
            return candidate;
        }
    }

    return candidates[0] || SITE_CANONICAL_ORIGINS[normalizedSite];
}

function rewriteManagedUrlForOrigin(
    configuredUrl = '',
    requestOrigin = '',
    fallbackPath = ''
) {
    const normalizedRequestOrigin = normalizeOrigin(requestOrigin);
    const normalizedConfiguredUrl = normalizeUrl(configuredUrl);

    if (!normalizedRequestOrigin) {
        return normalizedConfiguredUrl;
    }

    const requestSite = classifyManagedSite(normalizedRequestOrigin);
    if (!normalizedConfiguredUrl) {
        if (!fallbackPath) {
            return normalizedRequestOrigin;
        }
        return normalizeUrl(new URL(fallbackPath, normalizedRequestOrigin).toString());
    }

    let parsedConfiguredUrl;
    try {
        parsedConfiguredUrl = new URL(normalizedConfiguredUrl);
    } catch (_) {
        return normalizedConfiguredUrl;
    }

    const configuredSite = classifyManagedSite(parsedConfiguredUrl.hostname);
    if (!requestSite || !configuredSite || configuredSite === requestSite) {
        return normalizedConfiguredUrl;
    }

    const nextUrl = new URL(normalizedRequestOrigin);
    nextUrl.pathname = parsedConfiguredUrl.pathname || '/';
    nextUrl.search = parsedConfiguredUrl.search || '';
    nextUrl.hash = parsedConfiguredUrl.hash || '';
    return normalizeUrl(nextUrl.toString());
}

module.exports = {
    MANAGED_SITE_HOSTS,
    SITE_CANONICAL_ORIGINS,
    buildOriginFromHost,
    classifyManagedSite,
    extractHostname,
    isLocalHostname,
    normalizeOrigin,
    normalizeUrl,
    resolveSiteRequestOrigin,
    rewriteManagedUrlForOrigin
};
