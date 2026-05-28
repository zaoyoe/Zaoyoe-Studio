const { normalizeSiteValue } = require('./site');

const PUBLIC_SUPABASE_URL_ENV_NAMES = Object.freeze([
    'SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'PUBLIC_SUPABASE_URL'
]);

const PUBLIC_SUPABASE_KEY_ENV_NAMES = Object.freeze([
    'SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY'
]);

const LEGACY_PUBLIC_GOOGLE_CLIENT_ID = '1017068787594-ep4bj8cdirkllqlpbmlfk436br0vbifp.apps.googleusercontent.com';
const INTL_HOST_TOKENS = Object.freeze(['zaoyoe.xyz']);

const PUBLIC_GOOGLE_CLIENT_ID_ENV_NAMES = Object.freeze([
    'GOOGLE_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_ID',
    'NEXT_PUBLIC_GOOGLE_CLIENT_ID',
    'NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID',
    'PUBLIC_GOOGLE_CLIENT_ID',
    'PUBLIC_GOOGLE_OAUTH_CLIENT_ID'
]);

const PUBLIC_GOOGLE_CLIENT_ID_CN_ENV_NAMES = Object.freeze([
    'GOOGLE_CLIENT_ID_CN',
    'GOOGLE_OAUTH_CLIENT_ID_CN',
    'NEXT_PUBLIC_GOOGLE_CLIENT_ID_CN',
    'NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_CN',
    'PUBLIC_GOOGLE_CLIENT_ID_CN',
    'PUBLIC_GOOGLE_OAUTH_CLIENT_ID_CN'
]);

const PUBLIC_GOOGLE_CLIENT_ID_INTL_ENV_NAMES = Object.freeze([
    'GOOGLE_CLIENT_ID_INTL',
    'GOOGLE_OAUTH_CLIENT_ID_INTL',
    'NEXT_PUBLIC_GOOGLE_CLIENT_ID_INTL',
    'NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_INTL',
    'PUBLIC_GOOGLE_CLIENT_ID_INTL',
    'PUBLIC_GOOGLE_OAUTH_CLIENT_ID_INTL'
]);

function getFirstEnvValue(names = [], env = process.env) {
    for (const name of names) {
        const value = String(env?.[name] || '').trim();
        if (value) {
            return value;
        }
    }

    return '';
}

function getSupabaseUrl(env = process.env) {
    const value = getFirstEnvValue(PUBLIC_SUPABASE_URL_ENV_NAMES, env);
    if (!value) {
        throw new Error('Missing required environment variable: SUPABASE_URL');
    }
    return value.replace(/\/+$/, '');
}

function getSupabasePublishableKey(env = process.env) {
    const value = getFirstEnvValue(PUBLIC_SUPABASE_KEY_ENV_NAMES, env);
    if (!value) {
        throw new Error('Missing required environment variable: SUPABASE_PUBLISHABLE_KEY');
    }
    return value;
}

function hasSupabasePublicClientConfig(env = process.env) {
    return Boolean(
        getFirstEnvValue(PUBLIC_SUPABASE_URL_ENV_NAMES, env)
        && getFirstEnvValue(PUBLIC_SUPABASE_KEY_ENV_NAMES, env)
    );
}

function inferPublicRuntimeSite(options = {}) {
    const explicitSite = normalizeSiteValue(options.site, { fallback: '', allowEmpty: true });
    if (explicitSite) {
        return explicitSite;
    }

    const req = options.req && typeof options.req === 'object' ? options.req : null;
    const headers = req?.headers && typeof req.headers === 'object' ? req.headers : {};

    try {
        const requestUrl = String(req?.url || '').trim();
        if (requestUrl) {
            const host = String(headers.host || headers.Host || 'www.fatherkey.com').trim();
            const url = new URL(requestUrl, `https://${host}`);
            const querySite = normalizeSiteValue(url.searchParams.get('site'), { fallback: '', allowEmpty: true });
            if (querySite) {
                return querySite;
            }
        }
    } catch (_) {
        // ignore malformed request URLs
    }

    const hostHints = [
        headers.host,
        headers.Host,
        headers['x-forwarded-host'],
        headers['x-forwarded-origin'],
        headers.origin,
        headers.referer
    ]
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
        .join(' ');

    if (INTL_HOST_TOKENS.some((token) => hostHints.includes(token))) {
        return 'intl';
    }

    return 'cn';
}

function resolvePublicGoogleClientConfig(env = process.env, options = {}) {
    const inferredSite = inferPublicRuntimeSite(options);
    const sharedClientId = getFirstEnvValue(PUBLIC_GOOGLE_CLIENT_ID_ENV_NAMES, env) || LEGACY_PUBLIC_GOOGLE_CLIENT_ID;
    const cnClientId = getFirstEnvValue(PUBLIC_GOOGLE_CLIENT_ID_CN_ENV_NAMES, env) || sharedClientId;
    const intlClientId = getFirstEnvValue(PUBLIC_GOOGLE_CLIENT_ID_INTL_ENV_NAMES, env) || sharedClientId;
    const clientIds = {
        cn: cnClientId,
        intl: intlClientId
    };

    let source = 'legacy';
    if (getFirstEnvValue(PUBLIC_GOOGLE_CLIENT_ID_ENV_NAMES, env)) {
        source = 'global';
    }
    if (
        (inferredSite === 'cn' && getFirstEnvValue(PUBLIC_GOOGLE_CLIENT_ID_CN_ENV_NAMES, env))
        || (inferredSite === 'intl' && getFirstEnvValue(PUBLIC_GOOGLE_CLIENT_ID_INTL_ENV_NAMES, env))
    ) {
        source = 'site';
    }

    return {
        site: inferredSite,
        clientId: clientIds[inferredSite] || sharedClientId || '',
        clientIds,
        source
    };
}

function resolvePublicSupabaseConfig(env = process.env, options = {}) {
    const google = resolvePublicGoogleClientConfig(env, options);
    return {
        url: getSupabaseUrl(env),
        publishableKey: getSupabasePublishableKey(env),
        site: google.site,
        auth: {
            google
        }
    };
}

function buildSupabaseRuntimeScript(env = process.env, options = {}) {
    const config = resolvePublicSupabaseConfig(env, options);
    const serializedConfig = JSON.stringify(config);
    const serializedUrl = JSON.stringify(config.url);
    const serializedKey = JSON.stringify(config.publishableKey);
    const serializedSite = JSON.stringify(config.site || 'cn');
    const serializedGoogleAuth = JSON.stringify(config.auth?.google || null);

    return [
        '(function (global) {',
        `  var config = ${serializedConfig};`,
        '  global.__ZAOYOE_SUPABASE_CONFIG__ = config;',
        `  global.SUPABASE_URL = ${serializedUrl};`,
        `  global.SUPABASE_KEY = ${serializedKey};`,
        `  global.__ZAOYOE_RUNTIME_SITE__ = ${serializedSite};`,
        `  global.__ZAOYOE_GOOGLE_AUTH_CONFIG__ = ${serializedGoogleAuth};`,
        '}(typeof window !== "undefined" ? window : globalThis));'
    ].join('\n');
}

module.exports = {
    PUBLIC_GOOGLE_CLIENT_ID_CN_ENV_NAMES,
    PUBLIC_GOOGLE_CLIENT_ID_ENV_NAMES,
    PUBLIC_GOOGLE_CLIENT_ID_INTL_ENV_NAMES,
    PUBLIC_SUPABASE_KEY_ENV_NAMES,
    PUBLIC_SUPABASE_URL_ENV_NAMES,
    buildSupabaseRuntimeScript,
    getFirstEnvValue,
    getSupabasePublishableKey,
    getSupabaseUrl,
    hasSupabasePublicClientConfig,
    inferPublicRuntimeSite,
    resolvePublicGoogleClientConfig,
    resolvePublicSupabaseConfig
};
