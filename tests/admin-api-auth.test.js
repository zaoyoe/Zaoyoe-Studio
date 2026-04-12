const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../js/admin-api-auth.js');

function loadAdminApiWithSupabase({ session = null, getSession } = {}) {
    delete require.cache[modulePath];
    delete globalThis.AdminApi;
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
