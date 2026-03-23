(function () {
    'use strict';

    const config = window.getZaoyoeSupabaseConfig?.() || null;
    if (!config) {
        console.warn('Supabase runtime config is missing for admin-studio.html.bak. Load /api/runtime/supabase-config before using this backup page.');
        return;
    }

    window.supabaseClient = supabase.createClient(config.url, config.publishableKey);
}());
