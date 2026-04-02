(function initAdminApiAuth(globalScope) {
    async function resolveWithTimeout(factory, timeoutMs = 4000, fallback = null) {
        try {
            return await Promise.race([
                Promise.resolve().then(factory),
                new Promise((resolve) => {
                    globalScope.setTimeout(() => resolve(fallback), timeoutMs);
                })
            ]);
        } catch (_) {
            return fallback;
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

    async function getAccessToken() {
        const authClient = globalScope?.supabaseClient?.auth || globalScope?.supabase?.auth;
        if (authClient?.getSession) {
            const sessionResult = await resolveWithTimeout(() => authClient.getSession(), 4000, null);
            const accessToken = String(sessionResult?.data?.session?.access_token || '').trim();
            if (accessToken) {
                return accessToken;
            }
        }

        return String(readPersistedSession()?.access_token || '').trim();
    }

    async function buildRequestInit(init = {}) {
        const nextInit = {
            credentials: 'include',
            ...init
        };
        const headers = new Headers(init?.headers || {});
        const token = await getAccessToken();

        if (token && !headers.has('Authorization')) {
            headers.set('Authorization', `Bearer ${token}`);
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
        buildRequestInit
    };

    globalScope.AdminApi = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
