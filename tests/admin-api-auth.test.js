const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../js/admin-api-auth.js');

function loadAdminApiWithSupabase(session = null) {
    delete require.cache[modulePath];
    globalThis.supabaseClient = {
        auth: {
            async getSession() {
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
    const api = loadAdminApiWithSupabase({ access_token: 'token-123' });
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
    const api = loadAdminApiWithSupabase(null);
    const init = await api.buildRequestInit({
        headers: {
            Accept: 'application/json'
        }
    });

    assert.equal(init.credentials, 'include');
    assert.equal(init.headers.get('Accept'), 'application/json');
    assert.equal(init.headers.get('Authorization'), null);
});
