/**
 * User Activity Heartbeat Tracker
 * 每分钟上报一次用户活动，用于追踪在线用户
 */
(function () {
    'use strict';

    const HEARTBEAT_INTERVAL = 60 * 1000; // 1 minute
    let heartbeatTimer = null;
    let lastHeartbeat = 0;

    // Send heartbeat
    async function sendHeartbeat() {
        // Prevent too frequent calls
        const now = Date.now();
        if (now - lastHeartbeat < 30000) return;
        lastHeartbeat = now;

        try {
            if (window.UserEventTracker && typeof window.UserEventTracker.heartbeat === 'function') {
                await window.UserEventTracker.heartbeat({
                    metadata: {
                        source_page: window.location.pathname
                    }
                });
            }
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
