(function () {
    'use strict';

    window.VERIFY_SERVER_URL = 'https://zaoyoe-verify-server-production.up.railway.app';

    function applyLoggedInPrerenderState() {
        try {
            const cached = localStorage.getItem('cached_user_profile');
            if (!cached) {
                return;
            }

            const user = JSON.parse(cached);
            if (!user || !(user.id || user.user_id)) {
                return;
            }

            if (document.getElementById('verify-prerender-style')) {
                return;
            }

            const style = document.createElement('style');
            style.id = 'verify-prerender-style';
            style.textContent = '#verifyBalance{display:flex!important}';
            document.head.appendChild(style);
            console.log('[VerifyPreRender] Injected logged-in CSS into head');
        } catch (error) {
            console.warn('[VerifyPreRender] Error:', error);
        }
    }

    async function syncVerifyDisplayPrice() {
        try {
            const { data } = await window.supabaseClient
                .from('system_config')
                .select('config_value')
                .eq('config_key', 'verify_settings')
                .single();

            if (data?.config_value?.price_per_verify) {
                const element = document.getElementById('displayPrice');
                if (element) {
                    element.textContent = data.config_value.price_per_verify;
                }
            }
        } catch (error) {
            // Config load is optional, widget handles its own config.
        }
    }

    applyLoggedInPrerenderState();

    document.addEventListener('DOMContentLoaded', () => {
        syncVerifyDisplayPrice();
    }, { once: true });
}());
