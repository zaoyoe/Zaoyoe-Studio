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

    if (Object.prototype.hasOwnProperty.call(overrides, 'location')) {
        global.location = overrides.location;
    }

    if (Object.prototype.hasOwnProperty.call(overrides, 'fetch')) {
        global.fetch = overrides.fetch;
    }

    if (Object.prototype.hasOwnProperty.call(overrides, 'supabaseClient')) {
        global.supabaseClient = overrides.supabaseClient;
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
        }
    };
}

test('openAdminStudio immediately redirects through the admin entry trampoline when no warm admin session is available', async () => {
    const location = {
        href: 'https://www.zaoyoe.com/prompts.html'
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
        const redirectedUrl = new URL(location.href, 'https://www.zaoyoe.com');

        assert.equal(result, true);
        assert.equal(redirectedUrl.pathname, '/admin-entry.html');
        assert.equal(redirectedUrl.searchParams.get('next'), '/admin-studio.html');
    } finally {
        restore();
    }
});

test('openAdminStudio goes straight to admin-studio when access and admin session are already warm', async () => {
    const location = {
        href: 'https://www.zaoyoe.com/prompts.html'
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
        const redirectedUrl = new URL(location.href, 'https://www.zaoyoe.com');

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
