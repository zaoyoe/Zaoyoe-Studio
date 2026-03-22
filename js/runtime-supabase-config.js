(function (global) {
    'use strict';

    function normalizeConfig(rawConfig) {
        const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
        const url = String(source.url || global.SUPABASE_URL || '').trim().replace(/\/+$/, '');
        const publishableKey = String(
            source.publishableKey
            || source.anonKey
            || global.SUPABASE_KEY
            || ''
        ).trim();

        if (!url || !publishableKey) {
            return null;
        }

        return {
            url,
            publishableKey
        };
    }

    function getZaoyoeSupabaseConfig() {
        return normalizeConfig(global.__ZAOYOE_SUPABASE_CONFIG__);
    }

    function requireZaoyoeSupabaseConfig() {
        const config = getZaoyoeSupabaseConfig();
        if (!config) {
            throw new Error('Supabase runtime config is unavailable');
        }
        return config;
    }

    function getZaoyoeSupabaseFunctionUrl(functionName) {
        const config = requireZaoyoeSupabaseConfig();
        const normalizedName = String(functionName || '').trim().replace(/^\/+/, '');
        if (!normalizedName) {
            throw new Error('Supabase function name is required');
        }
        return `${config.url}/functions/v1/${normalizedName}`;
    }

    global.getZaoyoeSupabaseConfig = getZaoyoeSupabaseConfig;
    global.requireZaoyoeSupabaseConfig = requireZaoyoeSupabaseConfig;
    global.getZaoyoeSupabaseFunctionUrl = getZaoyoeSupabaseFunctionUrl;
}(typeof window !== 'undefined' ? window : globalThis));
