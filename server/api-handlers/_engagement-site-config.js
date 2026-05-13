const {
    normalizeSiteScopedSystemConfigSite,
    resolveSiteScopedSystemConfigForRead,
    resolveSiteScopedSystemConfigRequestSite,
    upsertSiteScopedSystemConfigValue
} = require('./_site-scoped-system-config');

function normalizeEngagementConfigSite(value = '', options = {}) {
    return normalizeSiteScopedSystemConfigSite(value, {
        allowAll: options.allowAll === true,
        fallback: Object.prototype.hasOwnProperty.call(options, 'fallback')
            ? options.fallback
            : (options.allowAll === true ? 'all' : 'cn')
    });
}

function resolveEngagementConfigRequestSite(req = {}, url = null, options = {}) {
    return resolveSiteScopedSystemConfigRequestSite(req, url, {
        allowAll: options.allowAll === true,
        fallback: Object.prototype.hasOwnProperty.call(options, 'fallback')
            ? options.fallback
            : (options.allowAll === true ? 'all' : 'cn')
    });
}

async function fetchSystemConfigValue(supabase, key) {
    const query = supabase
        .from('system_config')
        .select('config_value')
        .eq('config_key', key);
    const { data, error } = await (typeof query.maybeSingle === 'function'
        ? query.maybeSingle()
        : query.single());
    const text = [
        error?.code,
        error?.message,
        error?.details,
        error?.hint
    ].filter(Boolean).join(' ');
    const isMissingSystemConfig = error?.code === 'PGRST116'
        || error?.code === '42P01'
        || error?.code === 'PGRST205'
        || /system_config/i.test(text);
    if (error && !isMissingSystemConfig) {
        throw error;
    }
    return data?.config_value;
}

async function loadSiteScopedConfig(supabase, key, site, normalizeValue, fallbackValue = {}) {
    const rawValue = await fetchSystemConfigValue(supabase, key);
    const resolved = resolveSiteScopedSystemConfigForRead(key, rawValue || {}, site);
    return normalizeValue(resolved || fallbackValue);
}

async function saveSiteScopedConfig({
    supabase,
    key,
    site,
    value,
    description,
    userId
}) {
    const normalizedSite = normalizeEngagementConfigSite(site, { fallback: 'cn' });
    const rawValue = await fetchSystemConfigValue(supabase, key);
    const storedValue = upsertSiteScopedSystemConfigValue(rawValue, normalizedSite, value);
    const { error } = await supabase
        .from('system_config')
        .upsert({
            config_key: key,
            config_value: storedValue,
            description,
            updated_by: userId || null,
            updated_at: new Date().toISOString()
        }, {
            onConflict: 'config_key'
        });
    if (error) {
        throw error;
    }
    return storedValue;
}

module.exports = {
    loadSiteScopedConfig,
    normalizeEngagementConfigSite,
    resolveEngagementConfigRequestSite,
    saveSiteScopedConfig
};
