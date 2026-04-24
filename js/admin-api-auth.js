(function initAdminApiAuth(globalScope) {
    const ACCESS_TOKEN_CACHE_TTL_MS = 10000;
    const ADMIN_STUDIO_SESSION_CACHE_KEY = 'zaoyoe_admin_studio_session_cache_v1';
    const ADMIN_STUDIO_SESSION_SKEW_MS = 20 * 1000;
    let cachedAccessToken = '';
    let cachedAccessTokenExpiresAt = 0;
    let inFlightAccessTokenPromise = null;

    async function resolveWithTimeout(factory, timeoutMs = 4000, fallback = null) {
        let timeoutId = 0;
        try {
            return await Promise.race([
                Promise.resolve().then(factory),
                new Promise((resolve) => {
                    timeoutId = globalScope.setTimeout(() => resolve(fallback), timeoutMs);
                })
            ]);
        } catch (_) {
            return fallback;
        } finally {
            if (timeoutId && typeof globalScope.clearTimeout === 'function') {
                globalScope.clearTimeout(timeoutId);
            }
        }
    }

    function readPersistedSession() {
        try {
            if (!globalScope?.localStorage) {
                return null;
            }

            for (let index = 0; index < globalScope.localStorage.length; index += 1) {
                const key = globalScope.localStorage.key(index);
                if (!key || !key.startsWith('sb-') || !key.endsWith('-auth-token')) {
                    continue;
                }

                const raw = globalScope.localStorage.getItem(key);
                if (!raw) {
                    continue;
                }

                const parsed = JSON.parse(raw);
                const session = parsed?.currentSession || parsed?.session || parsed;
                if (session?.access_token) {
                    return session;
                }
            }
        } catch (_) {
            return null;
        }

        return null;
    }

    function rememberAccessToken(token = '', ttlMs = ACCESS_TOKEN_CACHE_TTL_MS) {
        const normalizedToken = String(token || '').trim();
        cachedAccessToken = normalizedToken;
        cachedAccessTokenExpiresAt = normalizedToken
            ? Date.now() + Math.max(500, Number(ttlMs) || ACCESS_TOKEN_CACHE_TTL_MS)
            : 0;
        return normalizedToken;
    }

    function getCachedAccessToken() {
        if (!cachedAccessToken) {
            return '';
        }

        if (Date.now() >= cachedAccessTokenExpiresAt) {
            cachedAccessToken = '';
            cachedAccessTokenExpiresAt = 0;
            return '';
        }

        return cachedAccessToken;
    }

    function clearAccessTokenCache() {
        cachedAccessToken = '';
        cachedAccessTokenExpiresAt = 0;
        inFlightAccessTokenPromise = null;
    }

    function readAdminStudioSessionCache() {
        try {
            const raw = globalScope?.sessionStorage?.getItem(ADMIN_STUDIO_SESSION_CACHE_KEY);
            if (!raw) return null;

            const parsed = JSON.parse(raw);
            const expiresAt = Number(parsed?.expiresAt || 0);
            if (!parsed?.userId || !expiresAt) return null;

            if ((expiresAt - Date.now()) <= ADMIN_STUDIO_SESSION_SKEW_MS) {
                globalScope?.sessionStorage?.removeItem(ADMIN_STUDIO_SESSION_CACHE_KEY);
                return null;
            }

            return parsed;
        } catch (_) {
            return null;
        }
    }

    function hasActiveAdminStudioSession() {
        if (typeof globalScope?.AdminAccess?.hasActiveAdminStudioSession === 'function') {
            try {
                return globalScope.AdminAccess.hasActiveAdminStudioSession();
            } catch (_) {
                return false;
            }
        }

        return Boolean(readAdminStudioSessionCache());
    }

    function clearCachedAdminStudioSession() {
        try {
            globalScope?.AdminAccess?.clearCachedAdminStudioSession?.();
        } catch (_) {
            // Fall through to direct storage cleanup.
        }

        try {
            globalScope?.sessionStorage?.removeItem(ADMIN_STUDIO_SESSION_CACHE_KEY);
        } catch (_) {
            // ignore cache clear failures
        }

        if (Object.prototype.hasOwnProperty.call(globalScope || {}, 'adminStudioSessionGranted')) {
            globalScope.adminStudioSessionGranted = false;
        }
    }

    async function getAccessToken(options = {}) {
        const forceRefresh = options?.force === true;
        if (!forceRefresh) {
            const cachedToken = getCachedAccessToken();
            if (cachedToken) {
                return cachedToken;
            }

            if (inFlightAccessTokenPromise) {
                return inFlightAccessTokenPromise;
            }
        }

        const authClient = globalScope?.supabaseClient?.auth || globalScope?.supabase?.auth;
        const tokenPromise = (async () => {
            if (authClient?.getSession) {
                const sessionResult = await resolveWithTimeout(() => authClient.getSession(), 4000, null);
                const accessToken = rememberAccessToken(sessionResult?.data?.session?.access_token || '');
                if (accessToken) {
                    return accessToken;
                }
            }

            return rememberAccessToken(readPersistedSession()?.access_token || '', 3000);
        })();

        if (!forceRefresh) {
            inFlightAccessTokenPromise = tokenPromise;
        }

        try {
            return await tokenPromise;
        } finally {
            if (!forceRefresh && inFlightAccessTokenPromise === tokenPromise) {
                inFlightAccessTokenPromise = null;
            }
        }
    }

    async function buildRequestInit(init = {}) {
        const {
            authMode = '',
            forceBearerToken = false,
            ...fetchInit
        } = init || {};
        const nextInit = {
            credentials: 'include',
            ...fetchInit
        };
        const headers = new Headers(fetchInit?.headers || {});
        const shouldAttachBearerToken = forceBearerToken === true
            || String(authMode || '').trim().toLowerCase() === 'bearer'
            || !hasActiveAdminStudioSession();

        if (!headers.has('Authorization') && shouldAttachBearerToken) {
            const token = await getAccessToken();

            if (token) {
                headers.set('Authorization', `Bearer ${token}`);
            }
        }

        nextInit.headers = headers;
        return nextInit;
    }

    async function adminFetch(input, init = {}) {
        const requestInit = await buildRequestInit(init);
        const headers = requestInit?.headers instanceof Headers
            ? requestInit.headers
            : new Headers(requestInit?.headers || {});
        const explicitAuthMode = String(init?.authMode || '').trim().toLowerCase();
        const usedBearerToken = headers.has('Authorization');
        const usedAdminCookieSession = !usedBearerToken
            && explicitAuthMode !== 'bearer'
            && init?.forceBearerToken !== true;

        const response = await fetch(input, requestInit);
        const shouldRetryWithBearer = usedAdminCookieSession
            && (Number(response?.status || 0) === 401 || Number(response?.status || 0) === 403);

        if (!shouldRetryWithBearer) {
            return response;
        }

        clearCachedAdminStudioSession();
        clearAccessTokenCache();

        return fetch(input, await buildRequestInit({
            ...(init || {}),
            forceBearerToken: true
        }));
    }

    const api = {
        fetch: adminFetch,
        getAccessToken,
        hasActiveAdminStudioSession,
        clearAccessTokenCache,
        buildRequestInit
    };

    globalScope.AdminApi = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
