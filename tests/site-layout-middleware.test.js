const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const middlewarePath = path.resolve(__dirname, '../middleware.js');
const SITE_LAYOUT_ENV_KEYS = Object.freeze([
    'SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SERVICE_KEY'
]);

async function loadFreshMiddlewareModule() {
    const moduleUrl = `${pathToFileURL(middlewarePath).href}?t=${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return import(moduleUrl);
}

async function withClearedSiteLayoutEnv(run) {
    const previousValues = new Map();

    SITE_LAYOUT_ENV_KEYS.forEach((key) => {
        previousValues.set(key, process.env[key]);
        delete process.env[key];
    });

    try {
        return await run();
    } finally {
        SITE_LAYOUT_ENV_KEYS.forEach((key) => {
            const previousValue = previousValues.get(key);
            if (typeof previousValue === 'undefined') {
                delete process.env[key];
            } else {
                process.env[key] = previousValue;
            }
        });
    }
}

test('site layout middleware registers root routes alongside admin studio protection', async () => {
    const middlewareModule = await loadFreshMiddlewareModule();

    assert.deepEqual(middlewareModule.config.matcher, ['/', '/index.html', '/admin-studio', '/admin-studio.html']);
    assert.equal(middlewareModule.config.runtime, 'nodejs');
});

test('site layout middleware redirects intl root requests to the shop before HTML is served', async () => {
    await withClearedSiteLayoutEnv(async () => {
        const middlewareModule = await loadFreshMiddlewareModule();
        const response = await middlewareModule.default(new Request('https://zaoyoe.xyz/?utm_source=codex'));

        assert.equal(response.status, 307);
        assert.equal(response.headers.get('location'), 'https://zaoyoe.xyz/shop.html?utm_source=codex');
    });
});

test('site layout middleware respects query-driven intl previews on local roots', async () => {
    await withClearedSiteLayoutEnv(async () => {
        const middlewareModule = await loadFreshMiddlewareModule();
        const response = await middlewareModule.default(new Request('http://127.0.0.1:8000/?site=intl&preview=1'));

        assert.equal(response.status, 307);
        assert.equal(response.headers.get('location'), 'http://127.0.0.1:8000/shop.html?site=intl&preview=1');
    });
});

test('site layout middleware lets cn root requests pass through when the homepage remains the root entry', async () => {
    await withClearedSiteLayoutEnv(async () => {
        const middlewareModule = await loadFreshMiddlewareModule();
        const response = await middlewareModule.default(new Request('https://www.zaoyoe.com/'));

        assert.equal(response.status, 200);
        assert.equal(response.headers.get('x-middleware-next'), '1');
        assert.equal(response.headers.get('location'), null);
    });
});

test('site layout middleware still guards admin studio with the admin-entry redirect', async () => {
    const middlewareModule = await loadFreshMiddlewareModule();
    const response = await middlewareModule.default(new Request('https://www.zaoyoe.com/admin-studio?tab=homepage'));

    assert.equal(response.status, 307);
    assert.equal(
        response.headers.get('location'),
        'https://www.zaoyoe.com/admin-entry?next=%2Fadmin-studio%3Ftab%3Dhomepage'
    );
});
