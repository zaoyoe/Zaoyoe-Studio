(function initAdminAccessModule(globalScope) {
    const CACHE_KEY = 'zaoyoe_admin_access_cache_v1';
    const CACHE_TTL_MS = 30 * 1000;
    const ADMIN_STUDIO_SESSION_ENDPOINT = '/api/admin/access/session';

    function normalizeAccessPayload(payload = {}) {
        return {
            isAdmin: Boolean(payload?.is_admin || payload?.is_super_admin),
            isSuperAdmin: Boolean(payload?.is_super_admin),
            permissions: Array.isArray(payload?.permissions) ? payload.permissions : []
        };
    }

    function sanitizeAdminStudioTarget(rawTarget = 'admin-studio.html') {
        try {
            const fallback = 'admin-studio.html';
            const baseUrl = new URL(globalScope?.location?.href || 'https://www.zaoyoe.com/');
            const candidate = new URL(String(rawTarget || fallback), baseUrl);

            if (candidate.origin !== baseUrl.origin) {
                return fallback;
            }

            const normalizedPath = candidate.pathname.replace(/\/+$/, '') || '/';
            const allowedPaths = new Set(['/admin-studio', '/admin-studio.html']);
            if (!allowedPaths.has(normalizedPath)) {
                return fallback;
            }

            return `${candidate.pathname}${candidate.search}${candidate.hash}`;
        } catch (_) {
            return 'admin-studio.html';
        }
    }

    function decodeJwtPayload(token = '') {
        const raw = String(token || '').trim();
        if (!raw || raw.split('.').length < 2) {
            return null;
        }

        try {
            const encoded = raw.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            const padded = encoded + '='.repeat((4 - (encoded.length % 4)) % 4);
            return JSON.parse(globalScope.atob(padded));
        } catch (_) {
            return null;
        }
    }

    function readPersistedSupabaseSession() {
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
                    return {
                        storageKey: key,
                        session
                    };
                }
            }
        } catch (_) {
            return null;
        }

        return null;
    }

    function buildPersistedSessionUser(session = null) {
        const payload = decodeJwtPayload(session?.access_token || '');
        const userId = String(payload?.sub || session?.user?.id || '').trim();
        if (!userId) {
            return null;
        }

        return {
            id: userId,
            email: String(payload?.email || session?.user?.email || '').trim()
        };
    }

    async function fetchPersistedAdminAccess(session = null, user = null) {
        const accessToken = String(session?.access_token || '').trim();
        const userId = String(user?.id || '').trim();
        const runtimeConfig = globalScope.requireZaoyoeSupabaseConfig?.();

        if (!accessToken || !userId || !runtimeConfig?.url || !runtimeConfig?.publishableKey || typeof fetch !== 'function') {
            return null;
        }

        const response = await fetch(`${runtimeConfig.url.replace(/\/+$/, '')}/rest/v1/rpc/get_user_permissions`, {
            method: 'POST',
            headers: {
                apikey: runtimeConfig.publishableKey,
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                p_user_id: userId
            })
        });

        if (!response.ok) {
            return null;
        }

        const payload = await response.json().catch(() => null);
        if (!payload || (payload?.is_admin !== true && payload?.is_super_admin !== true)) {
            return null;
        }

        return normalizeAccessPayload(payload);
    }

    function readAccessCache() {
        try {
            const raw = globalScope?.sessionStorage?.getItem(CACHE_KEY);
            if (!raw) return null;

            const parsed = JSON.parse(raw);
            if (!parsed?.userId || !parsed?.cachedAt) return null;
            if ((Date.now() - Number(parsed.cachedAt)) > CACHE_TTL_MS) return null;
            return parsed;
        } catch (_) {
            return null;
        }
    }

    function writeAccessCache(userId, access = {}) {
        try {
            globalScope?.sessionStorage?.setItem(CACHE_KEY, JSON.stringify({
                userId: String(userId || ''),
                cachedAt: Date.now(),
                access: {
                    isAdmin: Boolean(access.isAdmin),
                    isSuperAdmin: Boolean(access.isSuperAdmin),
                    permissions: Array.isArray(access.permissions) ? access.permissions : []
                }
            }));
        } catch (_) {
            // ignore cache write failures
        }
    }

    function clearAccessCache() {
        try {
            globalScope?.sessionStorage?.removeItem(CACHE_KEY);
        } catch (_) {
            // ignore cache clear failures
        }
    }

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

    async function createAdminStudioSession(options = {}) {
        const supabaseClient = options.supabaseClient || globalScope?.supabaseClient || null;
        const persistedSession = readPersistedSupabaseSession()?.session || null;
        if (!supabaseClient?.auth?.getSession && !persistedSession?.access_token) {
            return {
                ok: false,
                status: 0,
                reason: 'supabase_unavailable'
            };
        }

        const sessionResult = supabaseClient?.auth?.getSession
            ? await resolveWithTimeout(() => supabaseClient.auth.getSession(), 4000, null)
            : null;
        const session = sessionResult?.data?.session || null;
        const error = sessionResult?.error || null;
        const accessToken = String(session?.access_token || persistedSession?.access_token || '').trim();
        if (error || !accessToken) {
            return {
                ok: false,
                status: 401,
                reason: 'missing_session',
                error: error || null
            };
        }

        try {
            const response = await fetch(ADMIN_STUDIO_SESSION_ENDPOINT, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            const payload = await response.json().catch(() => ({}));
            return {
                ok: response.ok && payload?.success !== false,
                status: response.status,
                payload
            };
        } catch (requestError) {
            return {
                ok: false,
                status: 0,
                reason: 'network_error',
                error: requestError
            };
        }
    }

    async function clearAdminStudioSession() {
        try {
            const response = await fetch(ADMIN_STUDIO_SESSION_ENDPOINT, {
                method: 'DELETE',
                credentials: 'same-origin'
            });
            return response.ok;
        } catch (_) {
            return false;
        }
    }

    async function openAdminStudio(target = 'admin-studio.html') {
        const safeTarget = sanitizeAdminStudioTarget(target);
        const entryUrl = new URL('admin-entry.html', globalScope.location?.href || 'https://www.zaoyoe.com/');
        entryUrl.searchParams.set('next', safeTarget);
        globalScope.location.href = `${entryUrl.pathname}${entryUrl.search}${entryUrl.hash}`;
        return true;
    }

    async function getCurrentAdminAccess(options = {}) {
        const supabaseClient = options.supabaseClient || globalScope?.supabaseClient || null;
        const forceRefresh = options.forceRefresh === true;
        let user = options.user || null;

        if (!supabaseClient?.auth?.getUser || typeof supabaseClient.rpc !== 'function') {
            return {
                user: null,
                isAdmin: false,
                isSuperAdmin: false,
                permissions: [],
                error: new Error('Supabase client unavailable')
            };
        }

        if (!user) {
            const userResult = await resolveWithTimeout(() => supabaseClient.auth.getUser(), 4000, null);
            const currentUser = userResult?.data?.user || null;
            const error = userResult?.error || null;
            if (error || !currentUser) {
                const persistedSession = readPersistedSupabaseSession()?.session || null;
                const persistedUser = buildPersistedSessionUser(persistedSession);
                if (!persistedUser) {
                    clearAccessCache();
                    return {
                        user: null,
                        isAdmin: false,
                        isSuperAdmin: false,
                        permissions: [],
                        error: error || null
                    };
                }
                user = persistedUser;
            } else {
                user = currentUser;
            }
        }

        if (!forceRefresh) {
            const cached = readAccessCache();
            if (cached?.userId === String(user.id || '')) {
                return {
                    user,
                    isAdmin: Boolean(cached.access?.isAdmin),
                    isSuperAdmin: Boolean(cached.access?.isSuperAdmin),
                    permissions: Array.isArray(cached.access?.permissions) ? cached.access.permissions : [],
                    error: null,
                    cached: true
                };
            }
        }

        try {
            const rpcResult = await resolveWithTimeout(
                () => supabaseClient.rpc('get_user_permissions', { p_user_id: user.id }),
                5000,
                null
            );
            const data = rpcResult?.data;
            const error = rpcResult?.error || (!rpcResult ? new Error('Admin access RPC timed out') : null);

            if (error) {
                const persistedSession = readPersistedSupabaseSession()?.session || null;
                const fallbackAccess = await fetchPersistedAdminAccess(persistedSession, user);
                if (!fallbackAccess) {
                    throw error;
                }
                writeAccessCache(user.id, fallbackAccess);
                return {
                    user,
                    ...fallbackAccess,
                    error: null,
                    cached: false
                };
            }

            const access = normalizeAccessPayload(data || {});
            writeAccessCache(user.id, access);
            return {
                user,
                ...access,
                error: null,
                cached: false
            };
        } catch (error) {
            clearAccessCache();
            return {
                user,
                isAdmin: false,
                isSuperAdmin: false,
                permissions: [],
                error
            };
        }
    }

    const api = {
        clearAccessCache,
        clearAdminStudioSession,
        createAdminStudioSession,
        getCurrentAdminAccess,
        normalizeAccessPayload,
        openAdminStudio,
        sanitizeAdminStudioTarget
    };

    globalScope.AdminAccess = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
