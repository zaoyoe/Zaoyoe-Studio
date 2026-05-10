(function initAdminAccessModule(globalScope) {
    const CACHE_KEY = 'zaoyoe_admin_access_cache_v1';
    const CACHE_TTL_MS = 5 * 60 * 1000;
    const ADMIN_STUDIO_SESSION_CACHE_KEY = 'zaoyoe_admin_studio_session_cache_v1';
    const ADMIN_STUDIO_SESSION_SKEW_MS = 20 * 1000;
    const ADMIN_STUDIO_SESSION_ENDPOINT = '/api/admin/access/session';
    const DEFAULT_ADMIN_ACCESS_REST_TIMEOUT_MS = 6000;
    const DEFAULT_ADMIN_STUDIO_SESSION_TIMEOUT_MS = 6000;
    const ADMIN_PRESENCE_CHANNEL = 'zaoyoe-admin-presence';
    const ADMIN_PRESENCE_HEARTBEAT_MS = 120000;
    const ADMIN_PRESENCE_TAB_KEY = 'zaoyoe_admin_presence_tab_v1';
    const USER_PRESENCE_CHANNEL = 'zaoyoe-user-presence';
    const USER_PRESENCE_HEARTBEAT_MS = 120000;
    const USER_PRESENCE_TAB_KEY = 'zaoyoe_user_presence_tab_v1';
    let pendingAdminStudioSessionPromise = null;
    let pendingAdminStudioSessionUserId = '';
    let pendingWarmAdminStudioPromise = null;
    let pendingWarmAdminStudioUserId = '';
    let adminPresenceChannel = null;
    let adminPresenceHeartbeatTimer = null;
    let adminPresenceStartedAt = '';
    let adminPresenceClient = null;
    let userPresenceChannel = null;
    let userPresenceHeartbeatTimer = null;
    let userPresenceStartedAt = '';
    let userPresenceClient = null;
    let userPresenceIdentity = null;
    let userPresenceActivityPersistWarningShown = false;

    function normalizeAccessPayload(payload = {}) {
        return {
            isAdmin: Boolean(payload?.is_admin || payload?.is_super_admin),
            isSuperAdmin: Boolean(payload?.is_super_admin),
            permissions: Array.isArray(payload?.permissions) ? payload.permissions : []
        };
    }

    function getAdminAccessTimeout(name = '', fallbackMs = 4000) {
        const override = Number(globalScope?.__adminAccessTimeouts?.[name]);
        if (Number.isFinite(override) && override > 0) {
            return override;
        }
        return Math.max(250, Number(fallbackMs) || 4000);
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

    async function fetchWithTimeout(input, init = {}, timeoutMs = DEFAULT_ADMIN_ACCESS_REST_TIMEOUT_MS) {
        if (typeof fetch !== 'function') {
            return null;
        }

        const controller = typeof globalScope.AbortController === 'function'
            ? new globalScope.AbortController()
            : typeof AbortController === 'function'
                ? new AbortController()
                : null;
        const nextInit = {
            ...(init || {})
        };
        if (controller && !nextInit.signal) {
            nextInit.signal = controller.signal;
        }

        let timeoutId = 0;
        try {
            return await Promise.race([
                Promise.resolve().then(() => fetch(input, nextInit)),
                new Promise((resolve) => {
                    timeoutId = globalScope.setTimeout(() => {
                        try {
                            controller?.abort?.();
                        } catch (_) {
                            // ignore abort failures
                        }
                        resolve(null);
                    }, Math.max(250, Number(timeoutMs) || DEFAULT_ADMIN_ACCESS_REST_TIMEOUT_MS));
                })
            ]);
        } catch (error) {
            if (error?.name === 'AbortError') {
                return null;
            }
            throw error;
        } finally {
            if (timeoutId && typeof globalScope.clearTimeout === 'function') {
                globalScope.clearTimeout(timeoutId);
            }
        }
    }

    async function fetchPersistedAdminAccess(session = null, user = null) {
        const accessToken = String(session?.access_token || '').trim();
        const userId = String(user?.id || '').trim();
        const runtimeConfig = globalScope.requireZaoyoeSupabaseConfig?.();

        if (!accessToken || !userId || !runtimeConfig?.url || !runtimeConfig?.publishableKey || typeof fetch !== 'function') {
            return null;
        }

        const response = await fetchWithTimeout(
            `${runtimeConfig.url.replace(/\/+$/, '')}/rest/v1/rpc/get_user_permissions`,
            {
                method: 'POST',
                headers: {
                    apikey: runtimeConfig.publishableKey,
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    p_user_id: userId
                })
            },
            getAdminAccessTimeout('restFallbackMs', DEFAULT_ADMIN_ACCESS_REST_TIMEOUT_MS)
        );

        if (!response?.ok) {
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

    function readAdminStudioSessionCache() {
        try {
            const raw = globalScope?.sessionStorage?.getItem(ADMIN_STUDIO_SESSION_CACHE_KEY);
            if (!raw) return null;

            const parsed = JSON.parse(raw);
            const expiresAt = Number(parsed?.expiresAt || 0);
            if (!parsed?.userId || !expiresAt) return null;

            if ((expiresAt - Date.now()) <= ADMIN_STUDIO_SESSION_SKEW_MS) {
                clearCachedAdminStudioSession();
                return null;
            }

            return parsed;
        } catch (_) {
            return null;
        }
    }

    function writeAdminStudioSessionCache(userId, payload = {}) {
        const normalizedUserId = String(userId || '').trim();
        const expiresInSeconds = Number(payload?.expiresInSeconds || 0);
        if (!normalizedUserId || !Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
            clearCachedAdminStudioSession();
            return;
        }

        try {
            const issuedAt = Date.now();
            globalScope?.sessionStorage?.setItem(ADMIN_STUDIO_SESSION_CACHE_KEY, JSON.stringify({
                userId: normalizedUserId,
                issuedAt,
                expiresAt: issuedAt + (expiresInSeconds * 1000)
            }));
        } catch (_) {
            // ignore cache write failures
        }
    }

    function clearCachedAdminStudioSession() {
        try {
            globalScope?.sessionStorage?.removeItem(ADMIN_STUDIO_SESSION_CACHE_KEY);
        } catch (_) {
            // ignore cache clear failures
        }
    }

    function getCachedAdminStudioSessionResult(userId = '') {
        const cached = readAdminStudioSessionCache();
        const normalizedUserId = String(userId || '').trim();
        if (!cached) {
            return null;
        }

        if (normalizedUserId && cached.userId !== normalizedUserId) {
            return null;
        }

        return {
            ok: true,
            status: 200,
            cached: true,
            payload: {
                success: true,
                granted: true,
                expiresInSeconds: Math.max(1, Math.floor((Number(cached.expiresAt || 0) - Date.now()) / 1000))
            }
        };
    }

    function hasActiveAdminStudioSession(userId = '') {
        return Boolean(getCachedAdminStudioSessionResult(userId));
    }

    function hasWarmAdminStudioRoute() {
        const cachedAccess = readAccessCache();
        const cachedSession = readAdminStudioSessionCache();
        const persistedUser = buildPersistedSessionUser(readPersistedSupabaseSession()?.session || null);
        const currentUserId = String(persistedUser?.id || '').trim();
        if (!currentUserId || !cachedAccess || !cachedSession) {
            return false;
        }

        return cachedAccess.userId === currentUserId &&
            cachedSession.userId === currentUserId &&
            Boolean(cachedAccess.access?.isAdmin);
    }

    function scheduleDeferredTask(task, timeoutMs = 1500) {
        return new Promise((resolve) => {
            const runTask = () => {
                Promise.resolve()
                    .then(task)
                    .then(resolve)
                    .catch((error) => resolve({
                        access: null,
                        session: null,
                        error
                    }));
            };

            if (typeof globalScope.requestIdleCallback === 'function') {
                globalScope.requestIdleCallback(runTask, {
                    timeout: Math.max(200, Number(timeoutMs) || 1500)
                });
                return;
            }

            globalScope.setTimeout(runTask, 180);
        });
    }

    function getAdminPresenceTabKey() {
        try {
            const existing = globalScope?.sessionStorage?.getItem(ADMIN_PRESENCE_TAB_KEY);
            if (existing) return existing;

            const generated = `admin-tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
            globalScope?.sessionStorage?.setItem(ADMIN_PRESENCE_TAB_KEY, generated);
            return generated;
        } catch (_) {
            return `admin-tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        }
    }

    function getUserPresenceTabKey() {
        try {
            const existing = globalScope?.sessionStorage?.getItem(USER_PRESENCE_TAB_KEY);
            if (existing) return existing;

            const generated = `user-tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
            globalScope?.sessionStorage?.setItem(USER_PRESENCE_TAB_KEY, generated);
            return generated;
        } catch (_) {
            return `user-tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        }
    }

    function normalizeUserPresenceIdentity(options = {}) {
        const user = options.user && typeof options.user === 'object' ? options.user : null;
        const userId = String(options.userId || options.user_id || user?.id || '').trim();
        const email = String(options.email || user?.email || '').trim().toLowerCase();
        const sessionId = String(options.sessionId || options.session_id || '').trim();
        const sessionIds = [
            sessionId,
            ...(Array.isArray(options.sessionIds) ? options.sessionIds : []),
            ...(Array.isArray(options.session_ids) ? options.session_ids : [])
        ]
            .map((value) => String(value || '').trim())
            .filter(Boolean);
        const uniqueSessionIds = [...new Set(sessionIds)];

        if (!userId && !email && !uniqueSessionIds.length) {
            return null;
        }

        return {
            userId,
            email,
            sessionId: uniqueSessionIds[0] || '',
            sessionIds: uniqueSessionIds,
            site: String(options.site || globalScope?.SiteConfig?.getCurrentSite?.() || globalScope?.SiteConfig?.site || '').trim(),
            path: String(globalScope?.location?.pathname || '').trim()
        };
    }

    function normalizePresencePageId(path = '') {
        const normalized = String(path || globalScope?.location?.pathname || '/')
            .trim()
            .toLowerCase()
            .replace(/[#?].*$/, '')
            .replace(/\.html$/i, '')
            .replace(/^\/+|\/+$/g, '');
        const page = normalized.split('/').filter(Boolean).pop() || 'home';
        const aliases = {
            '': 'home',
            index: 'home',
            homepage: 'home',
            prompts: 'prompts',
            prompt: 'prompts',
            shop: 'shop',
            verify: 'verify',
            guestbook: 'guestbook',
            privacy: 'privacy',
            'reset-password': 'reset-password'
        };
        return (aliases[page] || page || 'home').slice(0, 80);
    }

    function getPresenceSite(identity = {}) {
        return String(
            identity.site
            || globalScope?.SiteConfig?.getCurrentSite?.()
            || globalScope?.SiteConfig?.site
            || 'cn'
        ).trim() || 'cn';
    }

    async function persistUserPresenceActivityHeartbeat(payload = {}) {
        const userId = String(payload.user_id || payload.userId || '').trim();
        if (!userId || !userPresenceClient) {
            return false;
        }

        const pageId = normalizePresencePageId(payload.page_path || payload.path);
        const site = getPresenceSite(userPresenceIdentity || payload);
        const lastActiveAt = String(payload.last_seen_at || new Date().toISOString()).trim();

        try {
            if (typeof userPresenceClient.rpc === 'function') {
                const { error } = await userPresenceClient.rpc('fn_record_user_activity_heartbeat', {
                    p_page_id: pageId,
                    p_site: site,
                    p_source_module: 'presence.heartbeat'
                });
                if (!error) {
                    return true;
                }
            }

            const { error } = await userPresenceClient
                .from('engagement_user_activity')
                .upsert({
                    user_id: userId,
                    last_active_at: lastActiveAt,
                    last_page_id: pageId,
                    site,
                    source_module: 'presence.heartbeat'
                }, { onConflict: 'user_id' });

            if (error) throw error;
            return true;
        } catch (error) {
            if (!userPresenceActivityPersistWarningShown) {
                userPresenceActivityPersistWarningShown = true;
                console.warn('[UserPresence] Failed to persist activity heartbeat:', error?.message || error);
            }
            return false;
        }
    }

    function buildAdminPresencePayload() {
        const now = new Date().toISOString();
        if (!adminPresenceStartedAt) {
            adminPresenceStartedAt = now;
        }

        return {
            role: 'admin',
            online_at: adminPresenceStartedAt,
            last_seen_at: now
        };
    }

    function buildUserPresencePayload() {
        const now = new Date().toISOString();
        if (!userPresenceStartedAt) {
            userPresenceStartedAt = now;
        }

        const identity = userPresenceIdentity || {};
        return {
            role: 'user',
            user_id: identity.userId || '',
            email: identity.email || '',
            session_id: identity.sessionId || '',
            session_ids: Array.isArray(identity.sessionIds) ? identity.sessionIds : [],
            site: identity.site || '',
            page_path: identity.path || '',
            online_at: userPresenceStartedAt,
            last_seen_at: now
        };
    }

    function markAdminPresenceActive() {
        if (!adminPresenceChannel?.track) {
            return Promise.resolve(false);
        }

        return Promise.resolve(adminPresenceChannel.track(buildAdminPresencePayload()))
            .then(() => true)
            .catch((error) => {
                console.warn('[AdminPresence] Failed to update admin presence:', error);
                return false;
            });
    }

    function markUserPresenceActive() {
        if (!userPresenceChannel?.track || !userPresenceIdentity) {
            return Promise.resolve(false);
        }

        const payload = buildUserPresencePayload();
        return Promise.resolve(userPresenceChannel.track(payload))
            .then(async () => {
                await persistUserPresenceActivityHeartbeat(payload);
                return true;
            })
            .catch((error) => {
                console.warn('[UserPresence] Failed to update user presence:', error);
                return false;
            });
    }

    function stopAdminPresence() {
        if (adminPresenceHeartbeatTimer && typeof globalScope.clearInterval === 'function') {
            globalScope.clearInterval(adminPresenceHeartbeatTimer);
            adminPresenceHeartbeatTimer = null;
        }

        const channel = adminPresenceChannel;
        adminPresenceChannel = null;
        adminPresenceStartedAt = '';

        try {
            channel?.untrack?.();
        } catch (_) {
            // ignore best-effort presence cleanup
        }

        try {
            adminPresenceClient?.removeChannel?.(channel);
        } catch (_) {
            // ignore best-effort channel cleanup
        }

        adminPresenceClient = null;
    }

    function stopUserPresence() {
        if (userPresenceHeartbeatTimer && typeof globalScope.clearInterval === 'function') {
            globalScope.clearInterval(userPresenceHeartbeatTimer);
            userPresenceHeartbeatTimer = null;
        }

        const channel = userPresenceChannel;
        userPresenceChannel = null;
        userPresenceStartedAt = '';
        userPresenceIdentity = null;

        try {
            channel?.untrack?.();
        } catch (_) {
            // ignore best-effort presence cleanup
        }

        try {
            userPresenceClient?.removeChannel?.(channel);
        } catch (_) {
            // ignore best-effort channel cleanup
        }

        userPresenceClient = null;
    }

    function startAdminPresence(supabaseClient = globalScope?.supabaseClient || null) {
        if (!supabaseClient?.channel) {
            return null;
        }

        if (adminPresenceChannel) {
            void markAdminPresenceActive();
            return adminPresenceChannel;
        }

        adminPresenceClient = supabaseClient;
        adminPresenceChannel = supabaseClient.channel(ADMIN_PRESENCE_CHANNEL, {
            config: {
                presence: {
                    key: getAdminPresenceTabKey()
                }
            }
        });

        adminPresenceChannel.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                void markAdminPresenceActive();
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                console.warn('[AdminAccess] Admin presence realtime degraded; heartbeat updates continue:', status);
            }
        });

        if (typeof globalScope.setInterval === 'function') {
            adminPresenceHeartbeatTimer = globalScope.setInterval(() => {
                if (typeof document !== 'undefined' && document.hidden) return;
                void markAdminPresenceActive();
            }, ADMIN_PRESENCE_HEARTBEAT_MS);
        }

        return adminPresenceChannel;
    }

    function startUserPresence(supabaseClient = globalScope?.supabaseClient || null, options = {}) {
        const identity = normalizeUserPresenceIdentity(options);
        if (!supabaseClient?.channel || !identity) {
            return null;
        }

        userPresenceIdentity = identity;

        if (userPresenceChannel) {
            void markUserPresenceActive();
            return userPresenceChannel;
        }

        userPresenceClient = supabaseClient;
        userPresenceChannel = supabaseClient.channel(USER_PRESENCE_CHANNEL, {
            config: {
                presence: {
                    key: getUserPresenceTabKey()
                }
            }
        });

        userPresenceChannel.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                void markUserPresenceActive();
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                console.warn('[AdminAccess] User presence realtime degraded; heartbeat updates continue:', status);
            }
        });

        if (typeof globalScope.setInterval === 'function') {
            userPresenceHeartbeatTimer = globalScope.setInterval(() => {
                if (typeof document !== 'undefined' && document.hidden) return;
                void markUserPresenceActive();
            }, USER_PRESENCE_HEARTBEAT_MS);
        }

        return userPresenceChannel;
    }

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

    async function createAdminStudioSession(options = {}) {
        const persistedSession = readPersistedSupabaseSession()?.session || null;
        const explicitUserId = String(
            options?.userId ||
            options?.user?.id ||
            buildPersistedSessionUser(persistedSession)?.id ||
            ''
        ).trim();
        const forceRefresh = options.forceRefresh === true;
        if (!forceRefresh) {
            const cachedSession = getCachedAdminStudioSessionResult(explicitUserId);
            if (cachedSession) {
                return cachedSession;
            }

            if (explicitUserId && pendingAdminStudioSessionPromise && pendingAdminStudioSessionUserId === explicitUserId) {
                return pendingAdminStudioSessionPromise;
            }
        }

        const supabaseClient = options.supabaseClient || globalScope?.supabaseClient || null;
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
            clearCachedAdminStudioSession();
            return {
                ok: false,
                status: 401,
                reason: 'missing_session',
                error: error || null
            };
        }

        const resolvedUserId = explicitUserId || String(session?.user?.id || buildPersistedSessionUser(persistedSession)?.id || '').trim();
        const sessionRequest = (async () => {
            try {
                const response = await fetchWithTimeout(
                    ADMIN_STUDIO_SESSION_ENDPOINT,
                    {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                            'Content-Type': 'application/json'
                        }
                    },
                    getAdminAccessTimeout('sessionIssueMs', DEFAULT_ADMIN_STUDIO_SESSION_TIMEOUT_MS)
                );

                if (!response) {
                    clearCachedAdminStudioSession();
                    return {
                        ok: false,
                        status: 0,
                        reason: 'request_timeout'
                    };
                }

                const payload = await response.json().catch(() => ({}));
                const result = {
                    ok: response.ok && payload?.success !== false,
                    status: response.status,
                    payload
                };

                if (result.ok) {
                    writeAdminStudioSessionCache(resolvedUserId, payload);
                } else {
                    clearCachedAdminStudioSession();
                }

                return result;
            } catch (requestError) {
                clearCachedAdminStudioSession();
                return {
                    ok: false,
                    status: 0,
                    reason: 'network_error',
                    error: requestError
                };
            }
        })();

        if (resolvedUserId && !forceRefresh) {
            pendingAdminStudioSessionPromise = sessionRequest;
            pendingAdminStudioSessionUserId = resolvedUserId;
            sessionRequest.finally(() => {
                if (pendingAdminStudioSessionPromise === sessionRequest) {
                    pendingAdminStudioSessionPromise = null;
                    pendingAdminStudioSessionUserId = '';
                }
            });
        }

        return sessionRequest;
    }

    async function clearAdminStudioSession() {
        clearCachedAdminStudioSession();
        try {
            const response = await fetchWithTimeout(
                ADMIN_STUDIO_SESSION_ENDPOINT,
                {
                    method: 'DELETE',
                    credentials: 'same-origin'
                },
                getAdminAccessTimeout('sessionClearMs', DEFAULT_ADMIN_STUDIO_SESSION_TIMEOUT_MS)
            );
            return response.ok;
        } catch (_) {
            return false;
        }
    }

    async function openAdminStudio(target = 'admin-studio.html') {
        const safeTarget = sanitizeAdminStudioTarget(target);
        if (hasWarmAdminStudioRoute()) {
            globalScope.location.href = safeTarget;
            return true;
        }

        const entryUrl = new URL('admin-entry.html', globalScope.location?.href || 'https://www.zaoyoe.com/');
        entryUrl.searchParams.set('next', safeTarget);
        globalScope.location.href = `${entryUrl.pathname}${entryUrl.search}${entryUrl.hash}`;
        return true;
    }

    async function warmAdminStudioEntry(options = {}) {
        const normalizedUser = options?.user?.id
            ? {
                id: String(options.user.id || '').trim(),
                email: String(options.user.email || '').trim()
            }
            : null;
        const warmUserId = String(options?.access?.user?.id || normalizedUser?.id || '').trim();

        const runWarmup = async () => {
            const access = options?.access?.user
                ? options.access
                : await getCurrentAdminAccess({
                    user: normalizedUser,
                    supabaseClient: options.supabaseClient,
                    forceRefresh: options.forceRefresh === true
                });

            if (!access?.user || !access.isAdmin) {
                return {
                    access,
                    session: null
                };
            }

            const session = await createAdminStudioSession({
                supabaseClient: options.supabaseClient,
                userId: access.user.id,
                forceRefresh: options.forceRefresh === true
            });

            return {
                access,
                session
            };
        };

        if (!options.forceRefresh && warmUserId && pendingWarmAdminStudioPromise && pendingWarmAdminStudioUserId === warmUserId) {
            return pendingWarmAdminStudioPromise;
        }

        const warmPromise = options.defer === true
            ? scheduleDeferredTask(runWarmup, options.timeoutMs)
            : Promise.resolve().then(runWarmup);

        if (!options.forceRefresh && warmUserId) {
            pendingWarmAdminStudioPromise = warmPromise;
            pendingWarmAdminStudioUserId = warmUserId;
            warmPromise.finally(() => {
                if (pendingWarmAdminStudioPromise === warmPromise) {
                    pendingWarmAdminStudioPromise = null;
                    pendingWarmAdminStudioUserId = '';
                }
            });
        }

        return warmPromise;
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
        adminPresenceChannelName: ADMIN_PRESENCE_CHANNEL,
        userPresenceChannelName: USER_PRESENCE_CHANNEL,
        clearAccessCache,
        clearCachedAdminStudioSession,
        clearAdminStudioSession,
        createAdminStudioSession,
        getCurrentAdminAccess,
        hasActiveAdminStudioSession,
        normalizeAccessPayload,
        openAdminStudio,
        sanitizeAdminStudioTarget,
        startAdminPresence,
        markAdminPresenceActive,
        stopAdminPresence,
        startUserPresence,
        markUserPresenceActive,
        stopUserPresence,
        warmAdminStudioEntry
    };

    globalScope.ZaoyoeAdminPresence = {
        channelName: ADMIN_PRESENCE_CHANNEL,
        start: startAdminPresence,
        markActive: markAdminPresenceActive,
        stop: stopAdminPresence
    };

    globalScope.ZaoyoeUserPresence = {
        channelName: USER_PRESENCE_CHANNEL,
        start: startUserPresence,
        markActive: markUserPresenceActive,
        stop: stopUserPresence
    };

    if (typeof globalScope.addEventListener === 'function') {
        globalScope.addEventListener('pagehide', () => {
            stopAdminPresence();
            stopUserPresence();
        });
        globalScope.addEventListener('beforeunload', () => {
            stopAdminPresence();
            stopUserPresence();
        });
        globalScope.addEventListener('visibilitychange', () => {
            if (globalScope.document?.visibilityState === 'visible') {
                void markAdminPresenceActive();
                void markUserPresenceActive();
            }
        });
    }

    const existingAdminAccess = globalScope.AdminAccess;
    if (existingAdminAccess?.__localSmokeAccess === true) {
        globalScope.AdminAccess = {
            ...api,
            ...existingAdminAccess,
            __localSmokeAccess: true
        };
    } else {
        globalScope.AdminAccess = api;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
