(function () {
    'use strict';

    const CACHE_KEY = 'cached_user_profile';

    function isGeneratedAvatarUrl(url) {
        return /ui-avatars\.com|dicebear\.com/i.test(String(url || ''));
    }

    function isTransientAvatarUrl(url) {
        return /googleusercontent\.com|lh3\.googleusercontent\.com/i.test(String(url || ''));
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
            if (!['http:', 'https:'].includes(parsed.protocol)) {
                return '';
            }

            const parts = String(parsed.pathname || '').split('/').filter(Boolean);
            const isR2Asset = parsed.hostname.endsWith('.r2.dev')
                && ['affiliate-posters', 'avatars', 'chat', 'comments', 'guestbook', 'products', 'prompts'].includes(parts[0]);
            if (isR2Asset) {
                const hostname = String(window.location?.hostname || '').toLowerCase();
                const cdnOrigin = hostname === 'zaoyoe.xyz' || hostname.endsWith('.zaoyoe.xyz')
                    ? 'https://cdn.zaoyoe.xyz'
                    : 'https://cdn.zaoyoe.com';
                const targetOrigin = new URL(cdnOrigin);
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

            if (profile.avatarUrl && (isGeneratedAvatarUrl(profile.avatarUrl) || isTransientAvatarUrl(profile.avatarUrl))) {
                delete profile.avatarUrl;
                localStorage.setItem(CACHE_KEY, JSON.stringify(profile));
            }

            return profile;
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
    }

    function buildAuthButton(profile) {
        const isLoggedIn = !!profile;
        const avatarSeed = profile?.email || profile?.username || profile?.nickname || 'User';
        const cachedAvatarUrl = normalizeFastPaintAvatarUrl(profile?.avatarUrl);
        const avatarUrl = cachedAvatarUrl || (isLoggedIn ? getInstantFallbackAvatarUrl(avatarSeed) : '');
        const hasAvatar = !!(isLoggedIn && avatarUrl);

        const button = document.createElement('button');
        button.id = 'authBtn';
        button.type = 'button';
        button.className = `login-trigger-btn${isLoggedIn ? ' logged-in' : ''}`;
        button.dataset.authFastPaint = '1';
        button.setAttribute('aria-label', 'Open account menu');

        appendDefaultIcon(button, hasAvatar);

        const avatar = document.createElement('img');
        avatar.id = 'navUserAvatar';
        avatar.className = `nav-user-avatar${hasAvatar ? ' show' : ' auth-display-none'}`;
        avatar.alt = 'Avatar';
        avatar.loading = 'eager';
        avatar.decoding = 'sync';
        avatar.fetchPriority = 'high';
        if (avatarUrl) {
            avatar.src = avatarUrl;
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
