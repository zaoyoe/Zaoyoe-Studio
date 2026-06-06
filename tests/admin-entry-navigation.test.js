const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const adminAccessPath = path.resolve(__dirname, '../js/admin-access.js');

function createStorage(initialEntries = {}) {
    const state = new Map(Object.entries(initialEntries));
    return {
        get length() {
            return state.size;
        },
        key(index) {
            return Array.from(state.keys())[index] || null;
        },
        getItem(key) {
            return state.has(String(key)) ? state.get(String(key)) : null;
        },
        setItem(key, value) {
            state.set(String(key), String(value));
        },
        removeItem(key) {
            state.delete(String(key));
        }
    };
}

function encodeJwtPayload(payload = {}) {
    return Buffer.from(JSON.stringify(payload))
        .toString('base64url');
}

function restoreGlobalProperty(name, value) {
    if (value === undefined) {
        delete global[name];
        return;
    }

    global[name] = value;
}

function loadAdminAccess(overrides = {}) {
    const originalLocation = global.location;
    const originalFetch = global.fetch;
    const originalSupabaseClient = global.supabaseClient;
    const originalAdminAccess = global.AdminAccess;
    const originalSessionStorage = global.sessionStorage;
    const originalLocalStorage = global.localStorage;
    const originalAtob = global.atob;
    const originalAbortController = global.AbortController;
    const originalRequireConfig = global.requireZaoyoeSupabaseConfig;
    const originalAccessTimeouts = global.__adminAccessTimeouts;
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;

    if (Object.prototype.hasOwnProperty.call(overrides, 'location')) {
        global.location = overrides.location;
    }

    if (Object.prototype.hasOwnProperty.call(overrides, 'fetch')) {
        global.fetch = overrides.fetch;
    }

    if (Object.prototype.hasOwnProperty.call(overrides, 'supabaseClient')) {
        global.supabaseClient = overrides.supabaseClient;
    }

    if (Object.prototype.hasOwnProperty.call(overrides, 'adminAccess')) {
        global.AdminAccess = overrides.adminAccess;
    }

    if (Object.prototype.hasOwnProperty.call(overrides, 'sessionStorage')) {
        global.sessionStorage = overrides.sessionStorage;
    }

    if (Object.prototype.hasOwnProperty.call(overrides, 'localStorage')) {
        global.localStorage = overrides.localStorage;
    }

    if (Object.prototype.hasOwnProperty.call(overrides, 'atob')) {
        global.atob = overrides.atob;
    }

    if (Object.prototype.hasOwnProperty.call(overrides, 'AbortController')) {
        global.AbortController = overrides.AbortController;
    }

    if (Object.prototype.hasOwnProperty.call(overrides, 'requireZaoyoeSupabaseConfig')) {
        global.requireZaoyoeSupabaseConfig = overrides.requireZaoyoeSupabaseConfig;
    }

    if (Object.prototype.hasOwnProperty.call(overrides, 'accessTimeouts')) {
        global.__adminAccessTimeouts = overrides.accessTimeouts;
    }

    if (Object.prototype.hasOwnProperty.call(overrides, 'setTimeout')) {
        global.setTimeout = overrides.setTimeout;
    }

    if (Object.prototype.hasOwnProperty.call(overrides, 'clearTimeout')) {
        global.clearTimeout = overrides.clearTimeout;
    }

    delete require.cache[adminAccessPath];
    const api = require(adminAccessPath);

    return {
        api,
        restore() {
            delete require.cache[adminAccessPath];
            restoreGlobalProperty('location', originalLocation);
            restoreGlobalProperty('fetch', originalFetch);
            restoreGlobalProperty('supabaseClient', originalSupabaseClient);
            restoreGlobalProperty('AdminAccess', originalAdminAccess);
            restoreGlobalProperty('sessionStorage', originalSessionStorage);
            restoreGlobalProperty('localStorage', originalLocalStorage);
            restoreGlobalProperty('atob', originalAtob);
            restoreGlobalProperty('AbortController', originalAbortController);
            restoreGlobalProperty('requireZaoyoeSupabaseConfig', originalRequireConfig);
            restoreGlobalProperty('__adminAccessTimeouts', originalAccessTimeouts);
            restoreGlobalProperty('setTimeout', originalSetTimeout);
            restoreGlobalProperty('clearTimeout', originalClearTimeout);
        }
    };
}

test('openAdminStudio immediately redirects through the admin entry trampoline when no warm admin session is available', async () => {
    const location = {
        href: 'https://www.fatherkey.com/prompts.html'
    };

    const { api, restore } = loadAdminAccess({
        location,
        fetch() {
            throw new Error('openAdminStudio should not fetch before redirecting');
        },
        supabaseClient: {
            auth: {
                getSession() {
                    throw new Error('openAdminStudio should not read the Supabase session before redirecting');
                }
            }
        }
    });

    try {
        const result = await api.openAdminStudio('admin-studio.html');
        const redirectedUrl = new URL(location.href, 'https://www.fatherkey.com');

        assert.equal(result, true);
        assert.equal(redirectedUrl.pathname, '/admin-entry.html');
        assert.equal(redirectedUrl.searchParams.get('next'), '/admin-studio.html');
    } finally {
        restore();
    }
});

test('openAdminStudio goes straight to admin-studio when access and admin session are already warm', async () => {
    const location = {
        href: 'https://www.fatherkey.com/prompts.html'
    };
    const sessionStorage = createStorage({
        zaoyoe_admin_access_cache_v1: JSON.stringify({
            userId: 'admin-user-1',
            cachedAt: Date.now(),
            access: {
                isAdmin: true,
                isSuperAdmin: true,
                permissions: ['*']
            }
        }),
        zaoyoe_admin_studio_session_cache_v1: JSON.stringify({
            userId: 'admin-user-1',
            issuedAt: Date.now(),
            expiresAt: Date.now() + (10 * 60 * 1000)
        })
    });
    const localStorage = createStorage({
        'sb-demo-auth-token': JSON.stringify({
            currentSession: {
                access_token: `header.${encodeJwtPayload({
                    sub: 'admin-user-1',
                    email: 'admin@example.com'
                })}.signature`
            }
        })
    });

    const { api, restore } = loadAdminAccess({
        location,
        sessionStorage,
        localStorage,
        atob(value) {
            return Buffer.from(value, 'base64').toString('binary');
        },
        fetch() {
            throw new Error('openAdminStudio should not fetch when a warm session is available');
        },
        supabaseClient: {
            auth: {
                getSession() {
                    throw new Error('openAdminStudio should not read the Supabase session when a warm session is available');
                }
            }
        }
    });

    try {
        const result = await api.openAdminStudio('admin-studio.html');
        const redirectedUrl = new URL(location.href, 'https://www.fatherkey.com');

        assert.equal(result, true);
        assert.equal(redirectedUrl.pathname, '/admin-studio.html');
        assert.equal(redirectedUrl.search, '');
    } finally {
        restore();
    }
});

test('createAdminStudioSession reuses the cached short-lived admin session for the same user', async () => {
    const sessionStorage = createStorage({
        zaoyoe_admin_studio_session_cache_v1: JSON.stringify({
            userId: 'admin-user-1',
            issuedAt: Date.now(),
            expiresAt: Date.now() + (8 * 60 * 1000)
        })
    });
    let fetchCount = 0;

    const { api, restore } = loadAdminAccess({
        sessionStorage,
        fetch() {
            fetchCount += 1;
            return Promise.reject(new Error('cached admin studio session should skip issuing a new cookie'));
        },
        supabaseClient: {
            auth: {
                getSession() {
                    throw new Error('cached admin studio session should skip reading the Supabase session');
                }
            }
        }
    });

    try {
        const result = await api.createAdminStudioSession({ userId: 'admin-user-1' });
        assert.equal(result.ok, true);
        assert.equal(result.cached, true);
        assert.equal(fetchCount, 0);
        assert.equal(result.payload.granted, true);
        assert.equal(result.payload.expiresInSeconds > 0, true);
    } finally {
        restore();
    }
});

test('createAdminStudioSession schedules renewal for a cached admin studio session', async () => {
    const now = Date.now();
    const sessionStorage = createStorage({
        zaoyoe_admin_studio_session_cache_v1: JSON.stringify({
            userId: 'admin-user-1',
            issuedAt: now,
            expiresAt: now + (8 * 60 * 1000)
        })
    });
    const scheduled = [];

    const { api, restore } = loadAdminAccess({
        sessionStorage,
        setTimeout(callback, delayMs) {
            scheduled.push({ callback, delayMs });
            return { unref() {} };
        },
        clearTimeout() {},
        fetch() {
            throw new Error('cached admin studio session should schedule renewal without fetching');
        },
        supabaseClient: {
            auth: {
                getSession() {
                    throw new Error('cached admin studio session should not read Supabase while scheduling renewal');
                }
            }
        }
    });

    try {
        const result = await api.createAdminStudioSession({ userId: 'admin-user-1' });

        assert.equal(result.ok, true);
        assert.equal(result.cached, true);
        assert.equal(scheduled.length, 1);
        assert.equal(scheduled[0].delayMs > 0, true);
        assert.equal(scheduled[0].delayMs <= 8 * 60 * 1000, true);
    } finally {
        restore();
    }
});

test('renewAdminStudioSession preserves an active cache when renewal fails transiently', async () => {
    const now = Date.now();
    const sessionStorage = createStorage({
        zaoyoe_admin_studio_session_cache_v1: JSON.stringify({
            userId: 'admin-user-1',
            issuedAt: now - (7 * 60 * 1000),
            expiresAt: now + (45 * 1000)
        })
    });
    let fetchCount = 0;

    const { api, restore } = loadAdminAccess({
        sessionStorage,
        setTimeout() {
            return { unref() {} };
        },
        clearTimeout() {},
        fetch() {
            fetchCount += 1;
            return Promise.resolve({
                ok: false,
                status: 503,
                async json() {
                    return { success: false, message: 'temporary outage' };
                }
            });
        },
        supabaseClient: {
            auth: {
                async getSession() {
                    return {
                        data: {
                            session: {
                                access_token: 'live-admin-token',
                                user: { id: 'admin-user-1' }
                            }
                        }
                    };
                }
            }
        }
    });

    try {
        const result = await api.renewAdminStudioSession({ userId: 'admin-user-1', force: true });

        assert.equal(result.ok, false);
        assert.equal(result.status, 503);
        assert.equal(fetchCount, 1);
        assert.notEqual(sessionStorage.getItem('zaoyoe_admin_studio_session_cache_v1'), null);
    } finally {
        restore();
    }
});

test('admin access module preserves the local smoke AdminAccess shim loaded before it', async () => {
    let smokeSessionCalls = 0;
    const smokeAdminAccess = {
        __localSmokeAccess: true,
        async getCurrentAdminAccess() {
            return {
                user: { id: 'admin-smoke', email: 'admin-smoke@zaoyoe.invalid' },
                isAdmin: true,
                isSuperAdmin: true,
                permissions: ['users.manage']
            };
        },
        async createAdminStudioSession() {
            smokeSessionCalls += 1;
            return {
                ok: true,
                status: 200,
                payload: {
                    success: true,
                    source: 'local-smoke'
                }
            };
        },
        hasActiveAdminStudioSession() {
            return true;
        }
    };

    const { api, restore } = loadAdminAccess({
        adminAccess: smokeAdminAccess,
        fetch() {
            throw new Error('local smoke AdminAccess shim should not be replaced by the real session issuer');
        },
        supabaseClient: {
            auth: {
                getSession() {
                    throw new Error('local smoke AdminAccess shim should not read the real Supabase session');
                }
            }
        }
    });

    try {
        const session = await global.AdminAccess.createAdminStudioSession({ userId: 'admin-smoke' });

        assert.equal(global.AdminAccess.__localSmokeAccess, true);
        assert.equal(global.AdminAccess.hasActiveAdminStudioSession(), true);
        assert.equal(typeof global.AdminAccess.sanitizeAdminStudioTarget, 'function');
        assert.notEqual(global.AdminAccess.createAdminStudioSession, api.createAdminStudioSession);
        assert.equal(session.ok, true);
        assert.equal(session.payload.source, 'local-smoke');
        assert.equal(smokeSessionCalls, 1);
    } finally {
        restore();
    }
});

test('getCurrentAdminAccess times out the persisted REST fallback instead of leaving the studio gate pending', async () => {
    const localStorage = createStorage({
        'sb-demo-auth-token': JSON.stringify({
            currentSession: {
                access_token: `header.${encodeJwtPayload({
                    sub: 'admin-user-1',
                    email: 'admin@example.com'
                })}.signature`
            }
        })
    });
    let fallbackFetchCalls = 0;

    const { api, restore } = loadAdminAccess({
        localStorage,
        atob(value) {
            return Buffer.from(value, 'base64').toString('binary');
        },
        accessTimeouts: {
            restFallbackMs: 20
        },
        requireZaoyoeSupabaseConfig() {
            return {
                url: 'https://supabase.example.test',
                publishableKey: 'anon-key'
            };
        },
        fetch() {
            fallbackFetchCalls += 1;
            return new Promise(() => {});
        },
        supabaseClient: {
            auth: {
                async getUser() {
                    return {
                        data: {
                            user: {
                                id: 'admin-user-1',
                                email: 'admin@example.com'
                            }
                        }
                    };
                }
            },
            async rpc() {
                return {
                    data: null,
                    error: new Error('rpc unavailable')
                };
            }
        }
    });

    try {
        const startedAt = Date.now();
        const access = await api.getCurrentAdminAccess({ forceRefresh: true });

        assert.equal(access.user.id, 'admin-user-1');
        assert.equal(access.isAdmin, false);
        assert.equal(fallbackFetchCalls, 1);
        assert.equal(Date.now() - startedAt < 1000, true);
    } finally {
        restore();
    }
});
