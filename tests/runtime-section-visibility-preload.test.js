const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');

const {
    RUNTIME_SECTION_VISIBILITY_CACHE_CONTROL,
    buildDefaultVisibilityConfig,
    buildSectionVisibilityPreloadScript,
    createRuntimeSectionVisibilityPreloadHandler,
    detectRequestSite,
    mapHomepageRowsToVisibility
} = require('../server/api-handlers/public/runtime-section-visibility-preload');

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

function executeRuntimeScript(script) {
    const localStorageWrites = new Map();
    const appliedConfigs = [];
    const windowObject = {
        localStorage: {
            setItem(key, value) {
                localStorageWrites.set(key, String(value));
            }
        },
        SectionVisibilityPreload: {
            applyConfig(config) {
                appliedConfigs.push(JSON.parse(JSON.stringify(config)));
            }
        }
    };
    const context = vm.createContext({
        window: windowObject,
        globalThis: windowObject
    });

    vm.runInContext(script, context);

    return {
        windowObject,
        localStorageWrites,
        appliedConfigs
    };
}

test('section visibility runtime preload script writes cache and applies the config immediately', () => {
    const script = buildSectionVisibilityPreloadScript({
        site: 'intl',
        config: {
            hero: true,
            prompts: false,
            shop: true,
            gongyi: false,
            verify: true,
            guestbook: false,
            ticker: true,
            footer: true
        },
        updatedAt: '2026-05-08T07:00:00.000Z'
    });
    const runtime = executeRuntimeScript(script);

    assert.equal(runtime.windowObject.__ZAOYOE_SECTION_VISIBILITY_PRELOADED_SITE__, 'intl');
    assert.deepEqual(JSON.parse(JSON.stringify(runtime.windowObject.__ZAOYOE_SECTION_VISIBILITY_PRELOADED_CONFIG__)), {
        hero: true,
        prompts: false,
        shop: true,
        gongyi: false,
        verify: true,
        guestbook: false,
        ticker: true,
        footer: true
    });
    assert.equal(runtime.localStorageWrites.get('zaoyoe_section_vis_intl'), JSON.stringify({
        hero: true,
        prompts: false,
        shop: true,
        gongyi: false,
        verify: true,
        guestbook: false,
        ticker: true,
        footer: true
    }));
    assert.deepEqual(runtime.appliedConfigs, [{
        hero: true,
        prompts: false,
        shop: true,
        gongyi: false,
        verify: true,
        guestbook: false,
        ticker: true,
        footer: true
    }]);
});

test('section visibility runtime site detection respects local preview referer overrides', () => {
    assert.equal(detectRequestSite({
        url: '/api/runtime/section-visibility-preload',
        headers: {
            host: '127.0.0.1:8000',
            referer: 'http://127.0.0.1:8000/shop.html?site=intl'
        }
    }), 'intl');
    assert.equal(detectRequestSite({
        url: '/api/runtime/section-visibility-preload',
        headers: {
            host: 'www.fatherkey.com'
        }
    }), 'cn');
    assert.equal(detectRequestSite({
        url: '/api/runtime/section-visibility-preload',
        headers: {
            host: 'zaoyoe.xyz'
        }
    }), 'intl');
});

test('section visibility runtime visibility mapping keeps hidden homepage rows hidden', () => {
    const config = mapHomepageRowsToVisibility([
        { section: 'prompts', is_visible: false },
        { section: 'gallery', is_visible: true },
        { section: 'guestbook', is_visible: false }
    ]);

    assert.deepEqual(config, {
        ...buildDefaultVisibilityConfig(),
        prompts: true,
        guestbook: false
    });
});

test('section visibility runtime handler returns executable javascript for the detected site', async () => {
    let rpcArgs = null;
    const handler = createRuntimeSectionVisibilityPreloadHandler({
        admin: {
            getOptionalSupabaseAdmin() {
                return {
                    async rpc(name, params) {
                        rpcArgs = { name, params };
                        return {
                            data: [
                                { section: 'prompts', is_visible: false, updated_at: '2026-05-08T08:00:00.000Z' },
                                { section: 'shop', is_visible: true, updated_at: '2026-05-08T08:00:00.000Z' },
                                { section: 'guestbook', is_visible: false, updated_at: '2026-05-08T08:00:00.000Z' }
                            ],
                            error: null
                        };
                    }
                };
            }
        }
    });
    const req = {
        method: 'GET',
        url: '/api/runtime/section-visibility-preload',
        headers: {
            host: 'zaoyoe.xyz'
        }
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.deepEqual(rpcArgs, {
        name: 'fn_get_homepage_config',
        params: {
            p_site: 'intl',
            p_include_hidden: true
        }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'application/javascript; charset=utf-8');
    assert.equal(res.headers['cache-control'], RUNTIME_SECTION_VISIBILITY_CACHE_CONTROL);

    const runtime = executeRuntimeScript(res.body);
    assert.equal(runtime.windowObject.__ZAOYOE_SECTION_VISIBILITY_PRELOADED_SITE__, 'intl');
    assert.deepEqual(JSON.parse(JSON.stringify(runtime.windowObject.__ZAOYOE_SECTION_VISIBILITY_PRELOADED_CONFIG__)), {
        hero: true,
        prompts: false,
        shop: true,
        gongyi: true,
        verify: true,
        guestbook: false,
        ticker: true,
        footer: true
    });
});

test('section visibility runtime handler rejects non-GET requests', async () => {
    const handlerPath = path.resolve(__dirname, '../api/runtime/section-visibility-preload.js');
    delete require.cache[handlerPath];
    const handler = require(handlerPath);
    const req = {
        method: 'POST',
        url: '/api/runtime/section-visibility-preload',
        headers: {}
    };
    const res = createMockResponse();

    await handler(req, res);

    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, 'GET');
});
