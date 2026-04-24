const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../js/admin-api-auth.js');

function createSessionStorage(seed = {}) {
    const store = new Map(Object.entries(seed || {}).map(([key, value]) => [key, String(value)]));
    return {
        getItem(key) {
            return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
            store.set(String(key), String(value));
        },
        removeItem(key) {
            store.delete(String(key));
        }
    };
}

function loadAdminApiWithSupabase({ session = null, getSession, sessionStorage, adminAccess } = {}) {
    delete require.cache[modulePath];
    delete globalThis.AdminApi;
    globalThis.sessionStorage = sessionStorage || undefined;
    globalThis.AdminAccess = adminAccess || undefined;
    globalThis.supabaseClient = {
        auth: {
            async getSession() {
                if (typeof getSession === 'function') {
                    return getSession();
                }
                return {
                    data: {
                        session
                    }
                };
            }
        }
    };
    return require(modulePath);
}

function restoreGlobalProperty(name, value) {
    if (value === undefined) {
        delete globalThis[name];
        return;
    }

    globalThis[name] = value;
}

test('admin api auth helper adds bearer token from current supabase session', async () => {
    const api = loadAdminApiWithSupabase({ session: { access_token: 'token-123' } });
    const init = await api.buildRequestInit({
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    });

    assert.equal(init.credentials, 'include');
    assert.equal(init.headers.get('Content-Type'), 'application/json');
    assert.equal(init.headers.get('Authorization'), 'Bearer token-123');
});

test('admin api auth helper leaves authorization empty when no session exists', async () => {
    const api = loadAdminApiWithSupabase({ session: null });
    const init = await api.buildRequestInit({
        headers: {
            Accept: 'application/json'
        }
    });

    assert.equal(init.credentials, 'include');
    assert.equal(init.headers.get('Accept'), 'application/json');
    assert.equal(init.headers.get('Authorization'), null);
});

test('admin api auth helper reuses in-flight and cached session token lookups', async () => {
    let getSessionCalls = 0;
    const api = loadAdminApiWithSupabase({
        async getSession() {
            getSessionCalls += 1;
            return {
                data: {
                    session: {
                        access_token: 'cached-token-456'
                    }
                }
            };
        }
    });

    const [tokenA, tokenB, init] = await Promise.all([
        api.getAccessToken(),
        api.getAccessToken(),
        api.buildRequestInit({ method: 'GET' })
    ]);

    assert.equal(tokenA, 'cached-token-456');
    assert.equal(tokenB, 'cached-token-456');
    assert.equal(init.headers.get('Authorization'), 'Bearer cached-token-456');
    assert.equal(getSessionCalls, 1);
});

test('admin api auth helper keeps explicit authorization headers without session lookup', async () => {
    let getSessionCalls = 0;
    const api = loadAdminApiWithSupabase({
        async getSession() {
            getSessionCalls += 1;
            return {
                data: {
                    session: {
                        access_token: 'unused-token'
                    }
                }
            };
        }
    });

    const init = await api.buildRequestInit({
        headers: {
            Authorization: 'Bearer manual-token',
            Accept: 'application/json'
        }
    });

    assert.equal(init.headers.get('Authorization'), 'Bearer manual-token');
    assert.equal(init.headers.get('Accept'), 'application/json');
    assert.equal(getSessionCalls, 0);
});

test('admin api auth helper prefers an active admin studio cookie session before bearer fallback', async () => {
    let getSessionCalls = 0;
    const api = loadAdminApiWithSupabase({
        sessionStorage: createSessionStorage({
            zaoyoe_admin_studio_session_cache_v1: JSON.stringify({
                userId: 'admin-user-1',
                issuedAt: Date.now(),
                expiresAt: Date.now() + 60_000
            })
        }),
        async getSession() {
            getSessionCalls += 1;
            return {
                data: {
                    session: {
                        access_token: 'token-should-not-be-used'
                    }
                }
            };
        }
    });

    const init = await api.buildRequestInit({
        method: 'GET',
        headers: {
            Accept: 'application/json'
        }
    });

    assert.equal(api.hasActiveAdminStudioSession(), true);
    assert.equal(init.credentials, 'include');
    assert.equal(init.headers.get('Accept'), 'application/json');
    assert.equal(init.headers.get('Authorization'), null);
    assert.equal(getSessionCalls, 0);
});

test('admin api auth helper falls back to bearer token when the admin studio session is stale', async () => {
    let getSessionCalls = 0;
    const api = loadAdminApiWithSupabase({
        sessionStorage: createSessionStorage({
            zaoyoe_admin_studio_session_cache_v1: JSON.stringify({
                userId: 'admin-user-1',
                issuedAt: Date.now() - 120_000,
                expiresAt: Date.now() + 5_000
            })
        }),
        async getSession() {
            getSessionCalls += 1;
            return {
                data: {
                    session: {
                        access_token: 'fallback-token-789'
                    }
                }
            };
        }
    });

    const init = await api.buildRequestInit({
        method: 'GET'
    });

    assert.equal(api.hasActiveAdminStudioSession(), false);
    assert.equal(init.headers.get('Authorization'), 'Bearer fallback-token-789');
    assert.equal(getSessionCalls, 1);
});

test('admin api auth helper retries with bearer auth after a cookie-priority request is rejected', async () => {
    const originalFetch = globalThis.fetch;
    const sessionStorage = createSessionStorage({
        zaoyoe_admin_studio_session_cache_v1: JSON.stringify({
            userId: 'admin-user-1',
            issuedAt: Date.now(),
            expiresAt: Date.now() + 60_000
        })
    });
    const adminAccessCalls = [];
    const fetchCalls = [];
    let getSessionCalls = 0;

    globalThis.fetch = async (input, init = {}) => {
        const headers = init?.headers instanceof Headers
            ? init.headers
            : new Headers(init?.headers || {});

        fetchCalls.push({
            input,
            authorization: headers.get('Authorization'),
            credentials: init?.credentials || null
        });

        return {
            status: fetchCalls.length === 1 ? 401 : 200,
            ok: fetchCalls.length !== 1
        };
    };

    const api = loadAdminApiWithSupabase({
        sessionStorage,
        adminAccess: {
            hasActiveAdminStudioSession() {
                return sessionStorage.getItem('zaoyoe_admin_studio_session_cache_v1') !== null;
            },
            clearCachedAdminStudioSession() {
                adminAccessCalls.push('clearCachedAdminStudioSession');
                sessionStorage.removeItem('zaoyoe_admin_studio_session_cache_v1');
            }
        },
        async getSession() {
            getSessionCalls += 1;
            return {
                data: {
                    session: {
                        access_token: 'retry-bearer-token'
                    }
                }
            };
        }
    });

    try {
        const response = await api.fetch('/api/admin?route=settings');

        assert.equal(response.status, 200);
        assert.equal(fetchCalls.length, 2);
        assert.equal(fetchCalls[0].authorization, null);
        assert.equal(fetchCalls[1].authorization, 'Bearer retry-bearer-token');
        assert.equal(fetchCalls[0].credentials, 'include');
        assert.equal(fetchCalls[1].credentials, 'include');
        assert.deepEqual(adminAccessCalls, ['clearCachedAdminStudioSession']);
        assert.equal(sessionStorage.getItem('zaoyoe_admin_studio_session_cache_v1'), null);
        assert.equal(getSessionCalls, 1);
    } finally {
        restoreGlobalProperty('fetch', originalFetch);
    }
});

test('admin api auth helper does not retry explicit bearer requests after auth failures', async () => {
    const originalFetch = globalThis.fetch;
    const fetchCalls = [];

    globalThis.fetch = async (input, init = {}) => {
        const headers = init?.headers instanceof Headers
            ? init.headers
            : new Headers(init?.headers || {});

        fetchCalls.push({
            input,
            authorization: headers.get('Authorization')
        });

        return {
            status: 401,
            ok: false
        };
    };

    const api = loadAdminApiWithSupabase({
        session: {
            access_token: 'unused-token'
        }
    });

    try {
        const response = await api.fetch('/api/admin?route=settings', {
            authMode: 'bearer',
            headers: {
                Authorization: 'Bearer manual-token'
            }
        });

        assert.equal(response.status, 401);
        assert.equal(fetchCalls.length, 1);
        assert.equal(fetchCalls[0].authorization, 'Bearer manual-token');
    } finally {
        restoreGlobalProperty('fetch', originalFetch);
    }
});
