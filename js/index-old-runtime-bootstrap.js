(function () {
    'use strict';

    function ensureChatSessionId() {
        let sessionId = localStorage.getItem('chat_session_id');
        if (!sessionId) {
            const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
                : Math.random().toString(36).slice(2, 14);
            sessionId = `guest_${randomId}`;
            localStorage.setItem('chat_session_id', sessionId);
        }
        return sessionId;
    }

    const config = window.getZaoyoeSupabaseConfig?.() || null;
    const chatSessionId = ensureChatSessionId();
    window.chatSessionId = chatSessionId;

    if (!config) {
        console.warn('Supabase runtime config is missing for index_old.html. Load /api/runtime/supabase-config before using this legacy page.');
        return;
    }

    window.supabaseClient = supabase.createClient(config.url, config.publishableKey, {
        global: {
            headers: { 'x-session-id': chatSessionId }
        }
    });
    console.log('Supabase browser client initialized');
}());
