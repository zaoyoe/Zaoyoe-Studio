(async () => {
    'use strict';

    const setStatus = () => {};
    const GOOGLE_POPUP_MESSAGE_TYPE = 'zaoyoe:google-auth-popup';
    const GOOGLE_POPUP_WINDOW_NAME = 'google_login';
    const GOOGLE_POPUP_RESULT_STORAGE_KEY = 'zaoyoe_google_popup_auth_result_v1';
    const GOOGLE_POPUP_STATE_PREFIX = 'zaoyoe_google_popup:';
    const POST_LOGIN_REDIRECT_STORAGE_KEY = 'zaoyoe_post_login_redirect_v1';
    const POST_LOGIN_REDIRECT_TTL_MS = 15 * 60 * 1000;
    const { url: SUPABASE_URL, publishableKey: SUPABASE_KEY } = window.requireZaoyoeSupabaseConfig();
    const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: {
            persistSession: true,
            autoRefreshToken: false,
            detectSessionInUrl: false,
            flowType: 'implicit'
        }
    });

    function resolveSafeRedirectTarget(rawTarget = '/') {
        let target = String(rawTarget || '').trim() || '/';
        try {
            const url = new URL(target, window.location.origin);
            if (url.origin !== window.location.origin || /\/auth-callback\.html$/i.test(url.pathname)) {
                target = '/';
            } else {
                target = `${url.pathname}${url.search}${url.hash}`;
            }
        } catch (error) {
            target = '/';
        }
        return target;
    }

    function readPendingPostLoginRedirectTarget() {
        try {
            const raw = localStorage.getItem(POST_LOGIN_REDIRECT_STORAGE_KEY);
            if (!raw) {
                return null;
            }

            const parsed = JSON.parse(raw);
            const savedAt = Number(parsed?.savedAt || 0);
            const ttlMs = Number(parsed?.ttlMs || POST_LOGIN_REDIRECT_TTL_MS);
            const safeTarget = resolveSafeRedirectTarget(parsed?.target || '');

            if (!safeTarget || !Number.isFinite(savedAt) || !Number.isFinite(ttlMs) || savedAt + ttlMs <= Date.now()) {
                localStorage.removeItem(POST_LOGIN_REDIRECT_STORAGE_KEY);
                return null;
            }

            return safeTarget;
        } catch (error) {
            localStorage.removeItem(POST_LOGIN_REDIRECT_STORAGE_KEY);
            return null;
        }
    }

    function consumePendingPostLoginRedirectTarget() {
        const target = readPendingPostLoginRedirectTarget();
        try {
            localStorage.removeItem(POST_LOGIN_REDIRECT_STORAGE_KEY);
        } catch (error) {
            // ignore cleanup failure
        }
        return target;
    }

    function redirectBack() {
        const url = new URL(window.location.href);
        const nextTarget = url.searchParams.get('next') || '';
        const pendingTarget = consumePendingPostLoginRedirectTarget();
        let target = nextTarget || pendingTarget || localStorage.getItem('oauth_post_login_redirect') || '/';
        localStorage.removeItem('oauth_post_login_redirect');
        target = resolveSafeRedirectTarget(target);
        window.location.replace(target);
    }

    const isPopupWindow = () => Boolean(
        (window.opener && window.opener !== window)
        || window.name === GOOGLE_POPUP_WINDOW_NAME
    );

    const isGooglePopupState = (value) => (
        typeof value === 'string' && value.startsWith(GOOGLE_POPUP_STATE_PREFIX)
    );

    const broadcastPopupResult = (payload) => {
        try {
            const envelope = JSON.stringify({
                type: GOOGLE_POPUP_MESSAGE_TYPE,
                emittedAt: Date.now(),
                ...payload
            });
            localStorage.setItem(GOOGLE_POPUP_RESULT_STORAGE_KEY, envelope);
            setTimeout(() => {
                try {
                    if (localStorage.getItem(GOOGLE_POPUP_RESULT_STORAGE_KEY) === envelope) {
                        localStorage.removeItem(GOOGLE_POPUP_RESULT_STORAGE_KEY);
                    }
                } catch (error) {
                    // ignore cleanup failure
                }
            }, 1500);
        } catch (error) {
            console.warn('Failed to broadcast popup auth result:', error);
        }
    };

    const notifyOpener = (payload, options = {}) => {
        const { broadcast = true } = options;
        const message = {
            type: GOOGLE_POPUP_MESSAGE_TYPE,
            emittedAt: Date.now(),
            ...payload
        };

        if (broadcast) {
            broadcastPopupResult(message);
        }
        if (!window.opener || window.opener === window) {
            return;
        }
        try {
            window.opener.postMessage(message, window.location.origin);
        } catch (error) {
            console.warn('Failed to notify opener from auth callback:', error);
        }
    };

    const attemptClosePopup = () => {
        if (!isPopupWindow()) {
            return false;
        }

        const tryClose = () => {
            try {
                window.close();
            } catch (error) {
                // ignore
            }
        };

        tryClose();
        setTimeout(() => {
            if (window.closed) {
                return;
            }
            try {
                window.open('', '_self');
            } catch (error) {
                // ignore
            }
            tryClose();
        }, 120);

        return true;
    };

    try {
        const url = new URL(window.location.href);
        const hash = window.location.hash || '';
        const code = url.searchParams.get('code');
        const hashParams = new URLSearchParams(hash.replace(/^#/, ''));
        const popupState = hashParams.get('state') || url.searchParams.get('state') || '';
        const isPopupMode = url.searchParams.get('popup') === '1' || isGooglePopupState(popupState);
        const isCloseOnlyMode = url.searchParams.get('close') === '1';
        const hasAccessToken = Boolean(hashParams.get('access_token'));
        const hasRefreshToken = Boolean(hashParams.get('refresh_token'));
        const idToken = hashParams.get('id_token');
        const hashError = hashParams.get('error') || url.searchParams.get('error');
        const hashErrorDescription = hashParams.get('error_description') || url.searchParams.get('error_description');

        if (isCloseOnlyMode) {
            setStatus();
            attemptClosePopup();
            return;
        }

        if (hashError) {
            throw new Error(hashErrorDescription || hashError);
        }

        if (idToken && isPopupMode && window.opener && window.opener !== window) {
            notifyOpener({
                status: 'credential',
                credential: idToken
            }, {
                broadcast: false
            });
            setTimeout(() => {
                attemptClosePopup();
            }, 0);
            return;
        }

        if (code) {
            setStatus();
            const { error } = await client.auth.exchangeCodeForSession(code);
            if (error) {
                throw error;
            }
        } else if (idToken) {
            setStatus();
            const { error } = await client.auth.signInWithIdToken({
                provider: 'google',
                token: idToken
            });
            if (error) {
                throw error;
            }
        } else if (hasAccessToken && hasRefreshToken) {
            setStatus();
            const access_token = hashParams.get('access_token');
            const refresh_token = hashParams.get('refresh_token');
            if (access_token && refresh_token) {
                const { error } = await client.auth.setSession({ access_token, refresh_token });
                if (error) {
                    throw error;
                }
            }
        }

        const waitForSession = async (timeoutMs = 9000, intervalMs = 250) => {
            const started = Date.now();
            while (Date.now() - started < timeoutMs) {
                const { data: { session } } = await client.auth.getSession();
                if (session) {
                    return session;
                }
                await new Promise((resolve) => setTimeout(resolve, intervalMs));
            }
            return null;
        };

        const session = await waitForSession();
        if (!session) {
            const debugFlags = [
                code ? 'code=1' : 'code=0',
                hasAccessToken ? 'access=1' : 'access=0',
                hasRefreshToken ? 'refresh=1' : 'refresh=0',
                hashError ? `err=${hashError}` : 'err=0'
            ].join(',');
            console.warn('OAuth callback debug:', debugFlags, window.location.href);
            throw new Error(`登录会话未建立 (${debugFlags})`);
        }

        setStatus();
        if (isPopupWindow() || isPopupMode) {
            const { data: { user } } = await client.auth.getUser().catch(() => ({ data: { user: null } }));
            notifyOpener({
                status: 'success',
                userId: user?.id || null
            });
            setTimeout(() => {
                attemptClosePopup();
            }, 120);
            return;
        }

        setTimeout(redirectBack, 120);
    } catch (error) {
        console.error('OAuth callback failed:', error);
        const url = new URL(window.location.href);
        const isPopupMode = url.searchParams.get('popup') === '1';
        if (isPopupWindow() || isPopupMode) {
            notifyOpener({
                status: 'error',
                message: error.message || '未知错误'
            });
            setTimeout(() => {
                attemptClosePopup();
            }, 200);
            return;
        }
        setStatus();
        localStorage.removeItem('oauth_post_login_redirect');
        setTimeout(() => window.location.replace('/'), 1400);
    }
})();
