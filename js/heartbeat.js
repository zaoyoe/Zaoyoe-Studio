/**
 * User Activity Heartbeat Tracker
 * 每分钟上报一次用户活动，用于追踪在线用户
 */
(function () {
    'use strict';

    const HEARTBEAT_INTERVAL = 60 * 1000; // 1 minute
    let heartbeatTimer = null;
    let lastHeartbeat = 0;

    // Generate or get session ID
    function getSessionId() {
        let sessionId = sessionStorage.getItem('session_id');
        if (!sessionId) {
            sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            sessionStorage.setItem('session_id', sessionId);
        }
        return sessionId;
    }

    // Send heartbeat
    async function sendHeartbeat() {
        // Prevent too frequent calls
        const now = Date.now();
        if (now - lastHeartbeat < 30000) return;
        lastHeartbeat = now;

        try {
            // Check if Supabase client exists and user is logged in
            if (typeof supabaseClient === 'undefined') return;

            const { data: { user } } = await supabaseClient.auth.getUser();
            if (!user) return;

            // Use RPC if available, otherwise direct insert
            try {
                await supabaseClient.rpc('track_event', {
                    p_event_type: 'heartbeat',
                    p_event_name: 'page_view',
                    p_event_data: {
                        page: window.location.pathname,
                        referrer: document.referrer || null
                    },
                    p_page_url: window.location.href,
                    p_session_id: getSessionId()
                });
            } catch (rpcError) {
                // Fallback: direct insert to user_events
                await supabaseClient.from('user_events').insert({
                    user_id: user.id,
                    session_id: getSessionId(),
                    event_type: 'heartbeat',
                    event_name: 'page_view',
                    event_data: { page: window.location.pathname },
                    page_url: window.location.href,
                    created_at: new Date().toISOString()
                });
            }

            console.log('[Heartbeat] Sent');
        } catch (err) {
            // Silently fail - don't interrupt user experience
            console.debug('[Heartbeat] Failed:', err.message);
        }
    }

    // Start heartbeat
    function startHeartbeat() {
        if (heartbeatTimer) return;

        // Send first heartbeat after 2 seconds (let page load)
        setTimeout(sendHeartbeat, 2000);

        // Then every minute
        heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

        // Also send on visibility change (user comes back to tab)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                sendHeartbeat();
            }
        });
    }

    // Stop heartbeat
    function stopHeartbeat() {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
    }

    // Auto-start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startHeartbeat);
    } else {
        startHeartbeat();
    }

    // Clean up on page unload
    window.addEventListener('beforeunload', stopHeartbeat);

    // Expose for external control
    window.UserHeartbeat = {
        start: startHeartbeat,
        stop: stopHeartbeat,
        send: sendHeartbeat
    };
})();
