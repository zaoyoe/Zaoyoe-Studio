const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
    buildSupabaseRuntimeScript,
    hasSupabasePublicClientConfig,
    resolvePublicGoogleClientConfig,
    resolvePublicSupabaseConfig
} = require('../api/_lib/public-runtime-config');

async function withEnv(patch, callback) {
    const previous = {};

    for (const [key, value] of Object.entries(patch || {})) {
        previous[key] = process.env[key];
        if (value === undefined || value === null) {
            delete process.env[key];
        } else {
            process.env[key] = String(value);
        }
    }

    try {
        return await callback();
    } finally {
        for (const key of Object.keys(patch || {})) {
            if (previous[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = previous[key];
            }
        }
    }
}

function createMockResponse() {
    const state = {
        statusCode: 200,
        headers: {},
        body: ''
    };

    return {
        status(code) {
            state.statusCode = code;
            return this;
        },
        setHeader(name, value) {
            state.headers[String(name).toLowerCase()] = value;
            return this;
        },
        end(payload = '') {
            state.body = String(payload || '');
            return this;
        },
        get statusCode() {
            return state.statusCode;
        },
        get headers() {
            return state.headers;
        },
        get body() {
            return state.body;
        }
    };
}

test('public runtime config resolves Supabase env aliases', () => {
    const config = resolvePublicSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: 'https://preview.supabase.co/',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'preview-key'
    });

    assert.deepEqual(config, {
        url: 'https://preview.supabase.co',
        publishableKey: 'preview-key',
        site: 'cn',
        auth: {
            google: {
                site: 'cn',
                clientId: '1017068787594-ep4bj8cdirkllqlpbmlfk436br0vbifp.apps.googleusercontent.com',
                clientIds: {
                    cn: '1017068787594-ep4bj8cdirkllqlpbmlfk436br0vbifp.apps.googleusercontent.com',
                    intl: '1017068787594-ep4bj8cdirkllqlpbmlfk436br0vbifp.apps.googleusercontent.com'
                },
                source: 'legacy'
            }
        }
    });
    assert.equal(hasSupabasePublicClientConfig({
        NEXT_PUBLIC_SUPABASE_URL: 'https://preview.supabase.co',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'preview-key'
    }), true);
});

test('public runtime config resolves site-scoped Google client ids from env', () => {
    const config = resolvePublicGoogleClientConfig({
        GOOGLE_CLIENT_ID_CN: 'google-cn-client',
        GOOGLE_CLIENT_ID_INTL: 'google-intl-client'
    }, {
        site: 'intl'
    });

    assert.deepEqual(config, {
        site: 'intl',
        clientId: 'google-intl-client',
        clientIds: {
            cn: 'google-cn-client',
            intl: 'google-intl-client'
        },
        source: 'site'
    });
});

test('public runtime config script exports globals for legacy browser scripts', () => {
    const script = buildSupabaseRuntimeScript({
        SUPABASE_URL: 'https://runtime.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'runtime-key',
        GOOGLE_CLIENT_ID_CN: 'google-cn-client',
        GOOGLE_CLIENT_ID_INTL: 'google-intl-client'
    });
    const context = {
        globalThis: {},
        window: {}
    };

    vm.runInNewContext(script, context);

    assert.deepEqual(JSON.parse(JSON.stringify(context.window.__ZAOYOE_SUPABASE_CONFIG__)), {
        url: 'https://runtime.supabase.co',
        publishableKey: 'runtime-key',
        site: 'cn',
        auth: {
            google: {
                site: 'cn',
                clientId: 'google-cn-client',
                clientIds: {
                    cn: 'google-cn-client',
                    intl: 'google-intl-client'
                },
                source: 'site'
            }
        }
    });
    assert.equal(context.window.SUPABASE_URL, 'https://runtime.supabase.co');
    assert.equal(context.window.SUPABASE_KEY, 'runtime-key');
    assert.equal(context.window.__ZAOYOE_RUNTIME_SITE__, 'cn');
    assert.deepEqual(JSON.parse(JSON.stringify(context.window.__ZAOYOE_GOOGLE_AUTH_CONFIG__)), {
        site: 'cn',
        clientId: 'google-cn-client',
        clientIds: {
            cn: 'google-cn-client',
            intl: 'google-intl-client'
        },
        source: 'site'
    });
    assert.equal(Object.prototype.hasOwnProperty.call(context.window, '__ZAOYOE_TRAFFIC_RUNTIME_DEFAULT_ENABLED__'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(context.window, '__ZAOYOE_EXPERIMENT_RUNTIME_DEFAULT_ENABLED__'), false);
});

test('browser runtime helper resolves the current site Google client id', () => {
    const helperSource = fs.readFileSync(
        path.resolve(__dirname, '../js/runtime-supabase-config.js'),
        'utf8'
    );
    const runtimeScript = buildSupabaseRuntimeScript({
        SUPABASE_URL: 'https://runtime.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'runtime-key',
        GOOGLE_CLIENT_ID_CN: 'google-cn-client',
        GOOGLE_CLIENT_ID_INTL: 'google-intl-client'
    }, {
        site: 'intl'
    });
    const context = {
        globalThis: {},
        window: {
            location: {
                hostname: 'zaoyoe.xyz',
                search: ''
            }
        }
    };
    context.globalThis = context.window;
    context.window.window = context.window;

    vm.runInNewContext(runtimeScript, context);
    vm.runInNewContext(helperSource, context);

    assert.equal(context.window.getZaoyoeGoogleClientId(), 'google-intl-client');
    assert.deepEqual(JSON.parse(JSON.stringify(context.window.getZaoyoeGoogleAuthConfig())), {
        site: 'intl',
        clientId: 'google-intl-client',
        clientIds: {
            cn: 'google-cn-client',
            intl: 'google-intl-client'
        },
        source: 'site'
    });
});

test('runtime Supabase config endpoint returns executable JavaScript', async () => {
    const handlerPath = path.resolve(__dirname, '../api/runtime/supabase-config.js');
    delete require.cache[handlerPath];
    const handler = require(handlerPath);

    await withEnv({
        SUPABASE_URL: 'https://runtime.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'runtime-key',
        SUPABASE_SERVICE_ROLE_KEY: null,
        SUPABASE_SERVICE_KEY: null
    }, async () => {
        const req = { method: 'GET' };
        const res = createMockResponse();

        await handler(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.headers['content-type'], 'application/javascript; charset=utf-8');
        assert.equal(res.headers['cache-control'], 'public, max-age=60, s-maxage=60');
        assert.match(res.body, /__ZAOYOE_SUPABASE_CONFIG__/);
        assert.doesNotMatch(res.body, /__ZAOYOE_TRAFFIC_RUNTIME_DEFAULT_ENABLED__/);
        assert.doesNotMatch(res.body, /__ZAOYOE_EXPERIMENT_RUNTIME_DEFAULT_ENABLED__/);
        assert.match(res.body, /SUPABASE_URL/);
        assert.match(res.body, /SUPABASE_KEY/);
    });
});

test('runtime Supabase config endpoint rejects non-GET requests', async () => {
    const handlerPath = path.resolve(__dirname, '../api/runtime/supabase-config.js');
    delete require.cache[handlerPath];
    const handler = require(handlerPath);
    const req = { method: 'POST' };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, 'GET');
});
