(function () {
    'use strict';

    const CACHE_KEY = 'cached_user_profile';
    const FAST_PAINT_ASSET_CDN_HOSTS = new Set([
        'cdn.fatherkey.com',
        'cdn.zaoyoe.com',
        'cdn.zaoyoe.xyz'
    ]);
    const FAST_PAINT_ASSET_CDN_PATH_PREFIXES = new Set([
        'affiliate-posters',
        'avatars',
        'chat',
        'comments',
        'guestbook',
        'homepage',
        'products',
        'prompts'
    ]);

    function isGeneratedAvatarUrl(url) {
        return /ui-avatars\.com|dicebear\.com/i.test(String(url || ''));
    }

    function isTransientAvatarUrl(url) {
        return /googleusercontent\.com|lh3\.googleusercontent\.com/i.test(String(url || ''));
    }

    function getFastPaintAssetCdnOrigin() {
        try {
            const siteOrigin = window.SiteConfig?.getAssetCdnOrigin?.();
            if (siteOrigin) {
                return new URL(siteOrigin, window.location.origin).origin;
            }
        } catch (_) {
            // Early paint can run before SiteConfig on some pages.
        }

        const hostname = String(window.location?.hostname || '').toLowerCase();
        return hostname === 'zaoyoe.xyz' || hostname.endsWith('.zaoyoe.xyz')
            ? 'https://cdn.zaoyoe.xyz'
            : 'https://cdn.fatherkey.com';
    }

    function normalizeFastPaintAvatarUrl(url) {
        const value = String(url || '').trim();
        if (!value || /^https?:\/\/[^/]*supabase\.co\/storage\/v1\//i.test(value)) {
            return '';
        }

        if (value.startsWith('data:image/') && value.length > 100) {
            return value;
        }

        try {
            const parsed = new URL(value, window.location.origin);
            if (!['http:', 'https:', 'blob:'].includes(parsed.protocol)) {
                return '';
            }

            const siteNormalized = window.SiteConfig?.normalizeAssetUrlForCurrentSite?.(parsed.href);
            if (siteNormalized) {
                return siteNormalized;
            }

            if (parsed.protocol === 'blob:') {
                return parsed.href;
            }

            const parts = String(parsed.pathname || '').split('/').filter(Boolean);
            const hostname = parsed.hostname.toLowerCase();
            const isKnownAssetHost = FAST_PAINT_ASSET_CDN_HOSTS.has(hostname) || hostname.endsWith('.r2.dev');
            if (isKnownAssetHost && FAST_PAINT_ASSET_CDN_PATH_PREFIXES.has(parts[0])) {
                const targetOrigin = new URL(getFastPaintAssetCdnOrigin());
                parsed.protocol = targetOrigin.protocol;
                parsed.host = targetOrigin.host;
            }

            return parsed.href;
        } catch (_) {
            return '';
        }
    }

    function isUsableAvatarUrl(url) {
        return Boolean(normalizeFastPaintAvatarUrl(url));
    }

    function escapeSvgText(value) {
        return String(value || '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&apos;'
        }[char]));
    }

    function getInstantFallbackAvatarUrl(seed) {
        const raw = String(seed || 'User').trim();
        const initial = escapeSvgText((Array.from(raw)[0] || 'U').toUpperCase());
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#6b9ece"/><text x="50%" y="53%" dominant-baseline="middle" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="28" font-weight="700" fill="#fff">${initial}</text></svg>`;
        return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
    }

    function readCachedProfile() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return null;

            const profile = JSON.parse(raw);
            if (!profile || typeof profile !== 'object') return null;
            if (!hasCachedProfileIdentity(profile) || !hasStoredAuthSessionCandidate(profile)) {
                localStorage.removeItem(CACHE_KEY);
                return null;
            }

            if (profile.avatarUrl && (isGeneratedAvatarUrl(profile.avatarUrl) || isTransientAvatarUrl(profile.avatarUrl))) {
                delete profile.avatarUrl;
                localStorage.setItem(CACHE_KEY, JSON.stringify(profile));
            }

            return profile;
        } catch (_) {
            return null;
        }
    }

    function hasCachedProfileIdentity(profile) {
        if (!profile || typeof profile !== 'object') return false;
        return !!(profile.objectId || profile.id || profile.user_id || profile.email);
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

    function hasStoredAuthSessionCandidate(profile = null) {
        try {
            return Object.keys(localStorage).some((key) => {
                if (!key || !key.startsWith('sb-') || !key.endsWith('-auth-token')) return false;
                const raw = localStorage.getItem(key);
                if (!raw) return false;
                const parsed = JSON.parse(raw);
                const token = parsed?.access_token || parsed?.currentSession?.access_token;
                const payload = getUsableStoredSessionPayload(token);
                if (!payload) return false;
                return profile ? doesStoredSessionMatchCachedProfile(payload, profile) : true;
            });
        } catch (_) {
            return false;
        }
    }

    function decodeStoredJwtPayload(token) {
        try {
            if (!token || typeof token !== 'string') return null;
            const parts = token.split('.');
            if (parts.length < 2) return null;
            const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
            return JSON.parse(atob(padded));
        } catch (_) {
            return null;
        }
    }

    function appendDefaultIcon(button, hidden) {
        const icon = document.createElement('span');
        icon.id = 'defaultAuthIcon';
        icon.className = `default-auth-icon${hidden ? ' auth-display-none' : ''}`;
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path fill="currentColor" d="M12 12.25c2.35 0 4.25-1.9 4.25-4.25S14.35 3.75 12 3.75 7.75 5.65 7.75 8s1.9 4.25 4.25 4.25Zm0 2c-3.32 0-6.25 2.03-7.5 5.07-.24.58.2 1.18.82 1.18h13.36c.62 0 1.06-.6.82-1.18-1.25-3.04-4.18-5.07-7.5-5.07Z"></path></svg>';
        button.appendChild(icon);
        return icon;
    }

    function buildAuthButton(profile) {
        const isLoggedIn = !!profile;
        const avatarSeed = profile?.email || profile?.username || profile?.nickname || 'User';
        const cachedAvatarUrl = normalizeFastPaintAvatarUrl(profile?.avatarUrl);
        const avatarUrl = cachedAvatarUrl || (isLoggedIn ? getInstantFallbackAvatarUrl(avatarSeed) : '');

        const button = document.createElement('button');
        button.id = 'authBtn';
        button.type = 'button';
        button.className = `login-trigger-btn${isLoggedIn ? ' logged-in' : ''}`;
        button.dataset.authFastPaint = '1';
        button.setAttribute('aria-label', 'Open account menu');

        const defaultIcon = appendDefaultIcon(button, false);

        const avatar = document.createElement('img');
        avatar.id = 'navUserAvatar';
        avatar.className = 'nav-user-avatar auth-display-none';
        avatar.alt = 'Avatar';
        avatar.loading = 'eager';
        avatar.decoding = 'sync';
        avatar.fetchPriority = 'high';
        avatar.referrerPolicy = 'no-referrer';
        const showAvatar = () => {
            avatar.classList.add('show');
            avatar.classList.remove('auth-display-none');
            defaultIcon.classList.add('auth-display-none');
        };
        const showFallbackIcon = () => {
            avatar.classList.remove('show');
            avatar.classList.add('auth-display-none');
            defaultIcon.classList.remove('auth-display-none');
        };
        avatar.addEventListener('load', showAvatar);
        avatar.addEventListener('error', () => {
            if (avatar.dataset.fallbackApplied !== '1' && isLoggedIn) {
                const fallbackAvatarUrl = getInstantFallbackAvatarUrl(avatarSeed);
                if (avatar.getAttribute('src') !== fallbackAvatarUrl) {
                    avatar.dataset.fallbackApplied = '1';
                    avatar.src = fallbackAvatarUrl;
                    return;
                }
            }
            showFallbackIcon();
        });
        if (avatarUrl) {
            avatar.src = avatarUrl;
        } else {
            showFallbackIcon();
        }
        button.appendChild(avatar);

        const text = document.createElement('span');
        text.id = 'authBtnText';
        text.className = 'auth-display-none';
        text.textContent = isLoggedIn ? (profile.nickname || profile.username || 'User') : 'Sign In';
        button.appendChild(text);

        const badge = document.createElement('span');
        badge.id = 'avatarUnreadBadge';
        badge.className = 'avatar-unread-badge';
        button.appendChild(badge);

        return button;
    }

    function fastPaintNavAuth() {
        if (document.getElementById('authBtn')) return;

        const authContainer = document.getElementById('auth-container');
        if (!authContainer) return;

        const profile = readCachedProfile();
        authContainer.replaceChildren(buildAuthButton(profile));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fastPaintNavAuth, { once: true });
    } else {
        fastPaintNavAuth();
    }
})();
