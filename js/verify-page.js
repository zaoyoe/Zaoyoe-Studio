(function () {
    'use strict';

    window.VERIFY_SERVER_URL = window.VERIFY_SERVER_URL || 'https://zaoyoe-verify-server-production.up.railway.app';

    const CACHE_KEY = 'cached_user_profile';

    function decodeStoredJwtPayload(token) {
        try {
            const part = String(token || '').split('.')[1];
            if (!part) return null;
            const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
            const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
            return JSON.parse(atob(padded));
        } catch (_) {
            return null;
        }
    }

    function getCachedProfileIdentity(profile) {
        return {
            id: String(profile?.objectId || profile?.id || profile?.user_id || '').trim(),
            email: String(profile?.email || '').trim().toLowerCase()
        };
    }

    function doesStoredSessionMatchCachedProfile(payload, profile) {
        const cached = getCachedProfileIdentity(profile);
        const tokenId = String(payload?.sub || payload?.user_id || payload?.user?.id || '').trim();
        const tokenEmail = String(
            payload?.email ||
            payload?.user?.email ||
            payload?.user_metadata?.email ||
            ''
        ).trim().toLowerCase();

        if (cached.id && tokenId && cached.id === tokenId) return true;
        if (cached.email && tokenEmail && cached.email === tokenEmail) return true;
        return false;
    }

    function getUsableStoredSessionPayload(token) {
        if (!token) return null;
        const payload = decodeStoredJwtPayload(token);
        if (!payload) return null;

        if (payload.exp) {
            const now = Math.floor(Date.now() / 1000);
            if (payload.exp <= now + 60) return null;
        }

        return payload;
    }

    function hasStoredAuthSessionCandidate(profile) {
        try {
            return Object.keys(localStorage).some((key) => {
                if (!key || !key.startsWith('sb-') || !key.endsWith('-auth-token')) return false;
                const raw = localStorage.getItem(key);
                if (!raw) return false;
                const parsed = JSON.parse(raw);
                const token = parsed?.access_token || parsed?.currentSession?.access_token || parsed?.session?.access_token;
                const payload = getUsableStoredSessionPayload(token);
                return payload ? doesStoredSessionMatchCachedProfile(payload, profile) : false;
            });
        } catch (_) {
            return false;
        }
    }

    function applyLoggedInPrerenderState() {
        try {
            const cached = localStorage.getItem(CACHE_KEY);
            if (!cached) {
                return;
            }

            const user = JSON.parse(cached);
            if (!user || !(user.objectId || user.id || user.user_id || user.email) || !hasStoredAuthSessionCandidate(user)) {
                localStorage.removeItem(CACHE_KEY);
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
