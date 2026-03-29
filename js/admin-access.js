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

    async function createAdminStudioSession(options = {}) {
        const supabaseClient = options.supabaseClient || globalScope?.supabaseClient || null;
        if (!supabaseClient?.auth?.getSession) {
            return {
                ok: false,
                status: 0,
                reason: 'supabase_unavailable'
            };
        }

        const { data: { session } = {}, error } = await supabaseClient.auth.getSession();
        if (error || !session?.access_token) {
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
                    Authorization: `Bearer ${session.access_token}`,
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
            const { data: { user: currentUser } = {}, error } = await supabaseClient.auth.getUser();
            if (error || !currentUser) {
                clearAccessCache();
                return {
                    user: null,
                    isAdmin: false,
                    isSuperAdmin: false,
                    permissions: [],
                    error: error || null
                };
            }
            user = currentUser;
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
            const { data, error } = await supabaseClient
                .rpc('get_user_permissions', { p_user_id: user.id });

            if (error) {
                throw error;
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
