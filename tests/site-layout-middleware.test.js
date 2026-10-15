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
        const response = await middlewareModule.default(new Request('https://www.fatherkey.com/'));

        assert.equal(response.status, 200);
        assert.equal(response.headers.get('x-middleware-next'), '1');
        assert.equal(response.headers.get('location'), null);
    });
});

test('site layout middleware still guards admin studio with the admin-entry redirect', async () => {
    const middlewareModule = await loadFreshMiddlewareModule();
    const response = await middlewareModule.default(new Request('https://www.fatherkey.com/admin-studio?tab=homepage'));

    assert.equal(response.status, 307);
    assert.equal(
        response.headers.get('location'),
        'https://www.fatherkey.com/admin-entry?next=%2Fadmin-studio%3Ftab%3Dhomepage'
    );
});

test('TG roots never load or apply the existing cn/intl site layout and rewrite directly to TG entry pages', async () => {
    const middlewareModule = await loadFreshMiddlewareModule();
    const layouts = { cn: { root_page_key: 'shop' }, intl: { root_page_key: 'shop' } };
    const pages = [{ key: 'home', path: '/' }, { key: 'shop', path: '/shop.html' }];
    const expectedTargets = [
        ['tg.fatherkey.com', '/tg.html'],
        ['tg.adm.fatherkey.com', '/tg-admin.html']
    ];
    for (const [host, targetPath] of expectedTargets) {
        for (const pathname of ['/', '/index', '/index.html']) {
            const requestUrl = `https://${host}${pathname}?site=intl`;
            assert.equal(middlewareModule.buildSiteLayoutRedirectUrl(requestUrl, layouts, pages), null);
            assert.equal(
                middlewareModule.buildIndependentTgRootRewriteUrl(requestUrl)?.toString(),
                `https://${host}${targetPath}?site=intl`
            );
            const response = await middlewareModule.default(new Request(requestUrl));
            assert.equal(response.status, 200);
            assert.equal(response.headers.get('x-middleware-rewrite'), `https://${host}${targetPath}?site=intl`);
            assert.equal(response.headers.get('x-middleware-next'), null);
            assert.equal(response.headers.get('location'), null);
            assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
            assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
        }
    }
});

test('TG root middleware rewrite preserves order lookup and OAuth callback query parameters', async () => {
    const middlewareModule = await loadFreshMiddlewareModule();

    const storeOrdersResponse = await middlewareModule.default(
        new Request('https://tg.fatherkey.com/?view=orders&tab=redeem')
    );
    assert.equal(storeOrdersResponse.status, 200);
    assert.equal(
        storeOrdersResponse.headers.get('x-middleware-rewrite'),
        'https://tg.fatherkey.com/tg.html?view=orders&tab=redeem'
    );
    assert.equal(storeOrdersResponse.headers.get('cache-control'), 'no-store, max-age=0');
    assert.equal(storeOrdersResponse.headers.get('referrer-policy'), 'no-referrer');

    const adminCallbackResponse = await middlewareModule.default(
        new Request('https://tg.adm.fatherkey.com/?code=pkce_code_123&state=state_abc')
    );
    assert.equal(adminCallbackResponse.status, 200);
    assert.equal(
        adminCallbackResponse.headers.get('x-middleware-rewrite'),
        'https://tg.adm.fatherkey.com/tg-admin.html?code=pkce_code_123&state=state_abc'
    );
    assert.equal(adminCallbackResponse.headers.get('cache-control'), 'no-store, max-age=0');
    assert.equal(adminCallbackResponse.headers.get('referrer-policy'), 'no-referrer');
});

test('TG admin serves its login shell while protected APIs enforce administrator access', async () => {
    const middlewareModule = await loadFreshMiddlewareModule();
    for (const pathname of ['/tg-admin', '/tg-admin.html']) {
        const response = await middlewareModule.default(new Request(`https://tg.adm.fatherkey.com${pathname}`));
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('x-middleware-next'), '1');
        assert.equal(response.headers.get('location'), null);
    }
});
