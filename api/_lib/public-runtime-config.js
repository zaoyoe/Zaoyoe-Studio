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

function resolvePublicSupabaseConfig(env = process.env) {
    return {
        url: getSupabaseUrl(env),
        publishableKey: getSupabasePublishableKey(env)
    };
}

function buildSupabaseRuntimeScript(env = process.env) {
    const config = resolvePublicSupabaseConfig(env);
    const serializedConfig = JSON.stringify(config);
    const serializedUrl = JSON.stringify(config.url);
    const serializedKey = JSON.stringify(config.publishableKey);

    return [
        '(function (global) {',
        `  var config = ${serializedConfig};`,
        '  global.__ZAOYOE_SUPABASE_CONFIG__ = config;',
        `  global.SUPABASE_URL = ${serializedUrl};`,
        `  global.SUPABASE_KEY = ${serializedKey};`,
        '}(typeof window !== "undefined" ? window : globalThis));'
    ].join('\n');
}

module.exports = {
    PUBLIC_SUPABASE_KEY_ENV_NAMES,
    PUBLIC_SUPABASE_URL_ENV_NAMES,
    buildSupabaseRuntimeScript,
    getFirstEnvValue,
    getSupabasePublishableKey,
    getSupabaseUrl,
    hasSupabasePublicClientConfig,
    resolvePublicSupabaseConfig
};
