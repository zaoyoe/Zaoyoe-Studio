(function initAdminApiAuth(globalScope) {
    const ACCESS_TOKEN_CACHE_TTL_MS = 10000;
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
        const nextInit = {
            credentials: 'include',
            ...init
        };
        const headers = new Headers(init?.headers || {});
        if (!headers.has('Authorization')) {
            const token = await getAccessToken();

            if (token) {
                headers.set('Authorization', `Bearer ${token}`);
            }
        }

        nextInit.headers = headers;
        return nextInit;
    }

    async function adminFetch(input, init = {}) {
        return fetch(input, await buildRequestInit(init));
    }

    const api = {
        fetch: adminFetch,
        getAccessToken,
        clearAccessTokenCache,
        buildRequestInit
    };

    globalScope.AdminApi = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
