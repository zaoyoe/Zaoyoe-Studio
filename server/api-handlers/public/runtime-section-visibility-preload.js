const DEFAULT_SITE = 'cn';
const INTL_HOST_TOKENS = Object.freeze(['zaoyoe.xyz']);
const VISIBILITY_SECTION_ORDER = Object.freeze(['hero', 'prompts', 'shop', 'gongyi', 'verify', 'guestbook', 'ticker', 'footer']);
const VISIBILITY_SECTION_SET = new Set(VISIBILITY_SECTION_ORDER);
const VISIBILITY_SECTION_ALIASES = Object.freeze({
    gallery: 'prompts'
});
const RUNTIME_SECTION_VISIBILITY_CACHE_CONTROL = 'no-store';

function sanitizeText(value, maxLength = 240) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeSiteValue(value, fallback = DEFAULT_SITE) {
    return value === 'intl' ? 'intl' : fallback;
}

function normalizeVisibilitySection(section) {
    const normalized = VISIBILITY_SECTION_ALIASES[sanitizeText(section, 80).toLowerCase()]
        || sanitizeText(section, 80).toLowerCase();
    return VISIBILITY_SECTION_SET.has(normalized) ? normalized : '';
}

function buildDefaultVisibilityConfig() {
    return VISIBILITY_SECTION_ORDER.reduce((config, section) => {
        config[section] = true;
        return config;
    }, {});
}

function mapHomepageRowsToVisibility(rows = []) {
    const config = buildDefaultVisibilityConfig();

    (Array.isArray(rows) ? rows : []).forEach((row) => {
        const section = normalizeVisibilitySection(row?.section);
        if (!section) {
            return;
        }

        config[section] = row?.is_visible !== false;
    });

    return config;
}

function getHeaderValue(headers, name) {
    if (!headers || !name) {
        return '';
    }

    if (typeof headers.get === 'function') {
        return String(headers.get(name) || '').trim();
    }

    const direct = headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()];
    if (Array.isArray(direct)) {
        return String(direct[0] || '').trim();
    }
    return String(direct || '').trim();
}

function parseUrlLike(value, fallbackOrigin = 'http://localhost') {
    const normalized = sanitizeText(value, 2048);
    if (!normalized) {
        return null;
    }

    try {
        return new URL(normalized, fallbackOrigin);
    } catch (_error) {
        return null;
    }
}

function normalizeHostLike(value) {
    const normalizedValue = sanitizeText(value, 255);
    if (!normalizedValue) {
        return '';
    }

    if (!/^https?:\/\//i.test(normalizedValue)) {
        return normalizedValue
            .toLowerCase()
            .split('/')[0]
            .split('?')[0]
            .split('#')[0]
            .split(':')[0];
    }

    const urlLike = parseUrlLike(normalizedValue, 'http://localhost');
    if (urlLike?.hostname) {
        return sanitizeText(urlLike.hostname, 255).toLowerCase();
    }

    return '';
}

function detectRequestSite(req) {
    const requestUrl = parseUrlLike(req?.url || '/', 'http://localhost');
    const requestedSite = sanitizeText(requestUrl?.searchParams?.get('site'), 16).toLowerCase();
    if (requestedSite === 'intl' || requestedSite === 'cn') {
        return requestedSite;
    }

    const refererUrl = parseUrlLike(getHeaderValue(req?.headers, 'referer') || getHeaderValue(req?.headers, 'referrer'));
    const refererSite = sanitizeText(refererUrl?.searchParams?.get('site'), 16).toLowerCase();
    if (refererSite === 'intl' || refererSite === 'cn') {
        return refererSite;
    }

    const hostCandidates = [
        getHeaderValue(req?.headers, 'x-forwarded-host'),
        getHeaderValue(req?.headers, 'host'),
        getHeaderValue(req?.headers, 'origin'),
        getHeaderValue(req?.headers, 'referer'),
        getHeaderValue(req?.headers, 'referrer')
    ];

    for (const candidate of hostCandidates) {
        const host = normalizeHostLike(candidate);
        if (!host) {
            continue;
        }

        if (INTL_HOST_TOKENS.some((token) => host === token || host.endsWith(`.${token}`))) {
            return 'intl';
        }
    }

    return DEFAULT_SITE;
}

function buildSectionVisibilityPreloadScript({
    site = DEFAULT_SITE,
    config = buildDefaultVisibilityConfig(),
    updatedAt = null
} = {}) {
    const normalizedSite = normalizeSiteValue(site);
    const serializedSite = JSON.stringify(normalizedSite);
    const serializedConfig = JSON.stringify(config && typeof config === 'object' ? config : buildDefaultVisibilityConfig());
    const serializedUpdatedAt = JSON.stringify(updatedAt ? String(updatedAt) : null);

    return [
        '(function (global) {',
        `  var site = ${serializedSite};`,
        `  var config = ${serializedConfig};`,
        `  var updatedAt = ${serializedUpdatedAt};`,
        '  global.__ZAOYOE_SECTION_VISIBILITY_PRELOADED_SITE__ = site;',
        '  global.__ZAOYOE_SECTION_VISIBILITY_PRELOADED_CONFIG__ = config;',
        '  global.__ZAOYOE_SECTION_VISIBILITY_PRELOADED_UPDATED_AT__ = updatedAt;',
        '  try {',
        "    if (global.localStorage && typeof global.localStorage.setItem === 'function') {",
        "      global.localStorage.setItem('zaoyoe_section_vis_' + site, JSON.stringify(config));",
        '    }',
        '  } catch (_error) {}',
        '  try {',
        "    if (global.SectionVisibilityPreload && typeof global.SectionVisibilityPreload.applyConfig === 'function') {",
        '      global.SectionVisibilityPreload.applyConfig(config);',
        '    }',
        '  } catch (_error) {}',
        '}(typeof window !== "undefined" ? window : globalThis));'
    ].join('\n');
}

function createRuntimeSectionVisibilityPreloadHandler({
    admin
} = {}) {
    const getOptionalSupabaseAdmin = admin?.getOptionalSupabaseAdmin;

    return async function runtimeSectionVisibilityPreloadHandler(req, res) {
        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            res.status(405).setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end('Method not allowed');
            return;
        }

        const site = detectRequestSite(req);
        let config = buildDefaultVisibilityConfig();
        let updatedAt = null;

        try {
            const supabase = typeof getOptionalSupabaseAdmin === 'function'
                ? getOptionalSupabaseAdmin()
                : null;

            if (supabase?.rpc) {
                const { data, error } = await supabase.rpc('fn_get_homepage_config', {
                    p_site: site,
                    p_include_hidden: true
                });

                if (!error) {
                    config = mapHomepageRowsToVisibility(data || []);
                    updatedAt = Array.isArray(data)
                        ? (data.find((row) => row?.updated_at)?.updated_at || null)
                        : null;
                }
            }
        } catch (_error) {
            // Fall back to an all-visible config so public pages still render.
        }

        const script = buildSectionVisibilityPreloadScript({
            site,
            config,
            updatedAt
        });

        res.status(200);
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', RUNTIME_SECTION_VISIBILITY_CACHE_CONTROL);
        res.end(script);
    };
}

module.exports = {
    DEFAULT_SITE,
    RUNTIME_SECTION_VISIBILITY_CACHE_CONTROL,
    VISIBILITY_SECTION_ORDER,
    buildDefaultVisibilityConfig,
    buildSectionVisibilityPreloadScript,
    createRuntimeSectionVisibilityPreloadHandler,
    detectRequestSite,
    mapHomepageRowsToVisibility,
    normalizeVisibilitySection
};
