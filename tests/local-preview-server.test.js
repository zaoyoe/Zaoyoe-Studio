const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    applyPreviewEnvToProcess,
    buildLocalPreviewAdminHandlerUrl,
    buildLocalPreviewPublicHandlerUrl,
    clearRequireCacheByPrefixes,
    createSmokeResultStore,
    DEFAULT_LOCAL_PREVIEW_BODY_LIMIT,
    getDefaultEnvFiles,
    loadFreshAdminApiHandler,
    loadFreshPaymentsApiHandler,
    loadFreshPublicApiHandler,
    loadFreshShopApiHandler,
    loadFreshSupportApiHandler,
    loadFreshWalletApiHandler,
    resolveLocalPreviewListenHost,
    resolveLocalPreviewStandaloneApiRoute,
    resolveLocalPreviewRuntimeScript,
    setLocalPreviewNoStoreHeaders,
    shouldDisableLocalPreviewCache,
    withLocalPreviewEnvDefaults
} = require('../scripts/local-preview-server');

test('local preview server serves Supabase runtime config from local env files', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'local-preview-server-'));
    fs.mkdirSync(path.join(tempRoot, 'server'), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, 'server/.env.staging'), [
        'SUPABASE_URL=https://staging.supabase.co',
        'SUPABASE_PUBLISHABLE_KEY=staging-key',
        'GOOGLE_CLIENT_ID_CN=staging-google-cn'
    ].join('\n'));
    fs.writeFileSync(path.join(tempRoot, '.env.local'), [
        'SUPABASE_URL=https://local.supabase.co',
        'SUPABASE_PUBLISHABLE_KEY=local-key',
        'GOOGLE_CLIENT_ID_INTL=local-google-intl'
    ].join('\n'));
    fs.writeFileSync(path.join(tempRoot, 'index.html'), '<!doctype html><title>preview</title>');

    const body = resolveLocalPreviewRuntimeScript([
        path.join(tempRoot, 'server/.env.staging'),
        path.join(tempRoot, '.env.local')
    ], {});

    assert.match(body, /__ZAOYOE_SUPABASE_CONFIG__/);
    assert.match(body, /https:\/\/local\.supabase\.co/);
    assert.match(body, /local-key/);
    assert.match(body, /staging-google-cn/);
    assert.match(body, /local-google-intl/);
});

test('local preview server includes pulled vercel env ahead of generic local env files', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'local-preview-env-order-'));
    const envFiles = getDefaultEnvFiles(tempRoot);

    assert.deepEqual(envFiles, [
        path.join(tempRoot, 'server/.env.staging'),
        path.join(tempRoot, '.vercel/.env.production.local'),
        path.join(tempRoot, 'server/.env'),
        path.join(tempRoot, '.env'),
        path.join(tempRoot, '.env.local')
    ]);
});

test('local preview server returns executable fallback script when public config is missing', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'local-preview-server-missing-'));
    fs.writeFileSync(path.join(tempRoot, 'index.html'), '<!doctype html><title>preview</title>');

    const body = resolveLocalPreviewRuntimeScript([], {});

    assert.match(body, /Local preview runtime config error/);
    assert.match(body, /__ZAOYOE_SUPABASE_CONFIG__ = null/);
    assert.doesNotMatch(body, /__ZAOYOE_TRAFFIC_RUNTIME_DEFAULT_ENABLED__/);
    assert.doesNotMatch(body, /__ZAOYOE_EXPERIMENT_RUNTIME_DEFAULT_ENABLED__/);
});

test('local preview server rewrites nested admin routes into the shared admin handler format', () => {
    const rewrittenUrl = buildLocalPreviewAdminHandlerUrl('/api/admin/access/session?foo=bar');

    assert.equal(rewrittenUrl, '/api/admin?route=access%2Fsession&foo=bar');
});

test('local preview server preserves explicit admin query routes for shared handler urls', () => {
    const rewrittenUrl = buildLocalPreviewAdminHandlerUrl('/api/admin?route=shop/products&status=active&fields=full');

    assert.equal(rewrittenUrl, '/api/admin?route=shop%2Fproducts&status=active&fields=full');
});

test('local preview server rewrites nested public routes into the shared public handler format', () => {
    const rewrittenUrl = buildLocalPreviewPublicHandlerUrl('/api/public/config/notifications?site=cn');

    assert.equal(rewrittenUrl, '/api/public?scope=config&route=notifications&site=cn');
});

test('local preview server rewrites ops public routes into the shared public handler format', () => {
    const rewrittenUrl = buildLocalPreviewPublicHandlerUrl('/api/public/ops/recovery-readiness-sweep?dry_run=1');

    assert.equal(rewrittenUrl, '/api/public?scope=ops&route=recovery-readiness-sweep&dry_run=1');
});

test('local preview server preserves explicit public query routes for shared handler urls', () => {
    const rewrittenUrl = buildLocalPreviewPublicHandlerUrl('/api/public?scope=config&route=notifications&site=intl');

    assert.equal(rewrittenUrl, '/api/public?scope=config&route=notifications&site=intl');
});

test('local preview server resolves standalone shop api routes from legacy endpoints', () => {
    assert.equal(
        resolveLocalPreviewStandaloneApiRoute('/api/shop/purchase?site=cn', '/api/shop'),
        'purchase'
    );
    assert.equal(
        resolveLocalPreviewStandaloneApiRoute('/api/shop/validate-discount', '/api/shop'),
        'validate-discount'
    );
    assert.equal(
        resolveLocalPreviewStandaloneApiRoute('/api/public/shop/purchase', '/api/shop'),
        ''
    );
});

test('local preview server resolves standalone payments api routes from legacy endpoints', () => {
    assert.equal(
        resolveLocalPreviewStandaloneApiRoute('/api/payments/create?site=cn', '/api/payments'),
        'create'
    );
    assert.equal(
        resolveLocalPreviewStandaloneApiRoute('/api/payments/mock/complete?session=demo', '/api/payments'),
        'mock/complete'
    );
    assert.equal(
        resolveLocalPreviewStandaloneApiRoute('/api/public/payments/create', '/api/payments'),
        ''
    );
});

test('local preview server resolves standalone wallet api routes from legacy endpoints', () => {
    assert.equal(
        resolveLocalPreviewStandaloneApiRoute('/api/wallet/overview?site=cn', '/api/wallet'),
        'overview'
    );
    assert.equal(
        resolveLocalPreviewStandaloneApiRoute('/api/wallet/verify-log', '/api/wallet'),
        'verify-log'
    );
    assert.equal(
        resolveLocalPreviewStandaloneApiRoute('/api/public/wallet/overview', '/api/wallet'),
        ''
    );
});

test('local preview server reloads shared admin handler modules without requiring a restart', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'local-preview-admin-handler-'));
    const tempApiDir = path.join(tempRoot, 'api');
    const tempAdminHandlerDir = path.join(tempRoot, 'server/api-handlers/admin');
    const tempAdminEntry = path.join(tempApiDir, 'admin.js');
    const tempNestedHandler = path.join(tempAdminHandlerDir, 'route.js');

    fs.mkdirSync(tempApiDir, { recursive: true });
    fs.mkdirSync(tempAdminHandlerDir, { recursive: true });

    fs.writeFileSync(tempAdminEntry, "module.exports = require('../server/api-handlers/admin/route');\n");
    fs.writeFileSync(tempNestedHandler, "module.exports = { version: 'v1' };\n");

    const firstLoad = loadFreshAdminApiHandler(tempRoot);
    assert.equal(firstLoad.version, 'v1');

    fs.writeFileSync(tempNestedHandler, "module.exports = { version: 'v2' };\n");

    const secondLoad = loadFreshAdminApiHandler(tempRoot);
    assert.equal(secondLoad.version, 'v2');
});

test('local preview server reloads shared public handler modules without requiring a restart', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'local-preview-public-handler-'));
    const tempApiDir = path.join(tempRoot, 'api');
    const tempPublicHandlerDir = path.join(tempRoot, 'server/api-handlers/public');
    const tempPublicEntry = path.join(tempApiDir, 'public.js');
    const tempNestedHandler = path.join(tempPublicHandlerDir, 'route.js');

    fs.mkdirSync(tempApiDir, { recursive: true });
    fs.mkdirSync(tempPublicHandlerDir, { recursive: true });

    fs.writeFileSync(tempPublicEntry, "module.exports = require('../server/api-handlers/public/route');\n");
    fs.writeFileSync(tempNestedHandler, "module.exports = { version: 'v1' };\n");

    const firstLoad = loadFreshPublicApiHandler(tempRoot);
    assert.equal(firstLoad.version, 'v1');

    fs.writeFileSync(tempNestedHandler, "module.exports = { version: 'v2' };\n");

    const secondLoad = loadFreshPublicApiHandler(tempRoot);
    assert.equal(secondLoad.version, 'v2');
});

test('local preview server reloads standalone shop handlers without requiring a restart', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'local-preview-shop-handler-'));
    const tempShopHandlerDir = path.join(tempRoot, 'api/shop');
    const tempShopHandler = path.join(tempShopHandlerDir, 'purchase.js');

    fs.mkdirSync(tempShopHandlerDir, { recursive: true });
    fs.writeFileSync(tempShopHandler, "module.exports = function handler() { return 'v1'; };\n");

    const firstLoad = loadFreshShopApiHandler(tempRoot, '/api/shop/purchase');
    assert.equal(typeof firstLoad, 'function');
    assert.equal(firstLoad(), 'v1');

    fs.writeFileSync(tempShopHandler, "module.exports = function handler() { return 'v2'; };\n");

    const secondLoad = loadFreshShopApiHandler(tempRoot, '/api/shop/purchase');
    assert.equal(typeof secondLoad, 'function');
    assert.equal(secondLoad(), 'v2');
});

test('local preview server reloads standalone payments handlers without requiring a restart', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'local-preview-payments-handler-'));
    const tempPaymentsHandlerDir = path.join(tempRoot, 'api/payments/mock');
    const tempPaymentsHandler = path.join(tempPaymentsHandlerDir, 'complete.js');

    fs.mkdirSync(tempPaymentsHandlerDir, { recursive: true });
    fs.writeFileSync(tempPaymentsHandler, "module.exports = function handler() { return 'v1'; };\n");

    const firstLoad = loadFreshPaymentsApiHandler(tempRoot, '/api/payments/mock/complete');
    assert.equal(typeof firstLoad, 'function');
    assert.equal(firstLoad(), 'v1');

    fs.writeFileSync(tempPaymentsHandler, "module.exports = function handler() { return 'v2'; };\n");

    const secondLoad = loadFreshPaymentsApiHandler(tempRoot, '/api/payments/mock/complete');
    assert.equal(typeof secondLoad, 'function');
    assert.equal(secondLoad(), 'v2');
});

test('local preview server reloads standalone wallet handlers without requiring a restart', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'local-preview-wallet-handler-'));
    const tempWalletHandlerDir = path.join(tempRoot, 'api/wallet');
    const tempWalletHandler = path.join(tempWalletHandlerDir, 'overview.js');

    fs.mkdirSync(tempWalletHandlerDir, { recursive: true });
    fs.writeFileSync(tempWalletHandler, "module.exports = function handler() { return 'v1'; };\n");

    const firstLoad = loadFreshWalletApiHandler(tempRoot, '/api/wallet/overview');
    assert.equal(typeof firstLoad, 'function');
    assert.equal(firstLoad(), 'v1');

    fs.writeFileSync(tempWalletHandler, "module.exports = function handler() { return 'v2'; };\n");

    const secondLoad = loadFreshWalletApiHandler(tempRoot, '/api/wallet/overview');
    assert.equal(typeof secondLoad, 'function');
    assert.equal(secondLoad(), 'v2');
});

test('local preview server reloads the support api handler without requiring a restart', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'local-preview-support-handler-'));
    const tempApiDir = path.join(tempRoot, 'api');
    const tempSupportHandler = path.join(tempApiDir, 'support.js');

    fs.mkdirSync(tempApiDir, { recursive: true });
    fs.writeFileSync(tempSupportHandler, "module.exports = function handler() { return 'v1'; };\n");

    const firstLoad = loadFreshSupportApiHandler(tempRoot);
    assert.equal(typeof firstLoad, 'function');
    assert.equal(firstLoad(), 'v1');

    fs.writeFileSync(tempSupportHandler, "module.exports = function handler() { return 'v2'; };\n");

    const secondLoad = loadFreshSupportApiHandler(tempRoot);
    assert.equal(typeof secondLoad, 'function');
    assert.equal(secondLoad(), 'v2');
});

test('local preview server mounts the support api endpoint used by the support bot', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../scripts/local-preview-server.js'), 'utf8');

    assert.match(source, /app\.all\('\/api\/support'/);
    assert.match(source, /kind:\s*'support api'/);
    assert.match(source, /loadHandler:\s*loadFreshSupportApiHandler/);
});

test('local preview server mounts engagement feed aliases used by the robot bubble runtime', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../scripts/local-preview-server.js'), 'utf8');

    assert.match(source, /app\.all\('\/api\/engagement'/);
    assert.match(source, /app\.all\('\/api\/engagement\/\*'/);
    assert.match(source, /kind:\s*'engagement public api'/);
    assert.match(source, /\/api\/public\/engagement/);
    assert.match(source, /loadHandler:\s*loadFreshPublicApiHandler/);
});

test('local preview server seeds process env from loaded preview values without clobbering existing vars', () => {
    const originalUrl = process.env.SUPABASE_URL;
    const originalKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    const originalMarker = process.env.LOCAL_PREVIEW_TEST_MARKER;

    process.env.LOCAL_PREVIEW_TEST_MARKER = 'keep-me';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;

    try {
        applyPreviewEnvToProcess({
            SUPABASE_URL: 'https://preview.supabase.co',
            SUPABASE_PUBLISHABLE_KEY: 'preview-key',
            LOCAL_PREVIEW_TEST_MARKER: 'replace-me'
        });

        assert.equal(process.env.SUPABASE_URL, 'https://preview.supabase.co');
        assert.equal(process.env.SUPABASE_PUBLISHABLE_KEY, 'preview-key');
        assert.equal(process.env.LOCAL_PREVIEW_TEST_MARKER, 'keep-me');
    } finally {
        if (originalUrl === undefined) {
            delete process.env.SUPABASE_URL;
        } else {
            process.env.SUPABASE_URL = originalUrl;
        }

        if (originalKey === undefined) {
            delete process.env.SUPABASE_PUBLISHABLE_KEY;
        } else {
            process.env.SUPABASE_PUBLISHABLE_KEY = originalKey;
        }

        if (originalMarker === undefined) {
            delete process.env.LOCAL_PREVIEW_TEST_MARKER;
        } else {
            process.env.LOCAL_PREVIEW_TEST_MARKER = originalMarker;
        }
    }
});

test('local preview server defaults rate limiting to memory unless explicitly configured', () => {
    assert.deepEqual(withLocalPreviewEnvDefaults({
        SUPABASE_URL: 'https://preview.supabase.co'
    }), {
        SUPABASE_URL: 'https://preview.supabase.co',
        RATE_LIMIT_BACKEND: 'memory'
    });

    assert.deepEqual(withLocalPreviewEnvDefaults({
        RATE_LIMIT_BACKEND: 'supabase'
    }), {
        RATE_LIMIT_BACKEND: 'supabase'
    });

    assert.deepEqual(withLocalPreviewEnvDefaults({
        RATE_LIMIT_STORE: 'supabase'
    }), {
        RATE_LIMIT_STORE: 'supabase'
    });

    assert.deepEqual(withLocalPreviewEnvDefaults({
        DISABLE_PERSISTENT_RATE_LIMITS: '1'
    }), {
        DISABLE_PERSISTENT_RATE_LIMITS: '1'
    });
});

test('local preview server listen host defaults to localhost-compatible any-address mode', () => {
    assert.equal(resolveLocalPreviewListenHost(''), undefined);
    assert.equal(resolveLocalPreviewListenHost(undefined), undefined);
    assert.equal(resolveLocalPreviewListenHost('127.0.0.1'), '127.0.0.1');
    assert.equal(resolveLocalPreviewListenHost('::1'), '::1');
});

test('local preview server raises JSON body limit for image-analysis payloads', () => {
    assert.equal(DEFAULT_LOCAL_PREVIEW_BODY_LIMIT, '25mb');
});

test('local preview server disables cache for homepage-critical static assets', () => {
    assert.equal(shouldDisableLocalPreviewCache('/tmp/index.html'), true);
    assert.equal(shouldDisableLocalPreviewCache('/tmp/announcement-loader.js'), true);
    assert.equal(shouldDisableLocalPreviewCache('/tmp/admin-config.js'), true);
    assert.equal(shouldDisableLocalPreviewCache('/tmp/theme.css'), true);
    assert.equal(shouldDisableLocalPreviewCache('/tmp/runtime.json'), true);
    assert.equal(shouldDisableLocalPreviewCache('/tmp/logo.png'), false);
});

test('local preview server no-store helper stamps strict cache-busting headers', () => {
    const headers = new Map();
    const response = {
        setHeader(name, value) {
            headers.set(String(name), String(value));
        }
    };

    setLocalPreviewNoStoreHeaders(response);

    assert.equal(headers.get('Cache-Control'), 'no-store');
    assert.equal(headers.get('Pragma'), 'no-cache');
    assert.equal(headers.get('Expires'), '0');
});

test('local preview server smoke result store caches and expires run results', () => {
    const store = createSmokeResultStore({ ttlMs: 50 });

    assert.equal(store.get('missing-run'), null);

    const inserted = store.set('run-1', {
        status: 'passed',
        page: '/admin-studio.html',
        text: 'Local Smoke: PASSED',
        results: [{ label: 'shop smoke', pass: true, detail: '' }]
    });

    assert.equal(inserted.runId, 'run-1');
    assert.equal(inserted.status, 'passed');
    assert.deepEqual(store.get('run-1')?.results, [{ label: 'shop smoke', pass: true, detail: '' }]);

    const originalNow = Date.now;
    Date.now = () => Number(inserted.updatedAt || inserted.createdAt || 0) + 1000;
    try {
        assert.equal(store.get('run-1'), null);
    } finally {
        Date.now = originalNow;
    }
});

test('local preview server smoke result store keeps terminal status over stale running updates', () => {
    const store = createSmokeResultStore({ ttlMs: 1000 });

    const passed = store.set('run-final', {
        status: 'passed',
        page: '/smoke-notifications.html',
        text: 'Local Smoke: PASSED',
        results: [{ label: 'notification smoke', pass: true, detail: '' }]
    });
    const staleRunning = store.set('run-final', {
        status: 'running',
        page: '/smoke-notifications.html',
        text: 'Local Smoke: RUNNING',
        results: [{ label: 'notification smoke', pass: true, detail: '' }]
    });

    assert.equal(staleRunning, passed);
    assert.equal(store.get('run-final')?.status, 'passed');
    assert.equal(store.get('run-final')?.text, 'Local Smoke: PASSED');
});

test('local preview server cache clearing ignores unrelated modules', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'local-preview-cache-'));
    const targetDir = path.join(tempRoot, 'target');
    const otherDir = path.join(tempRoot, 'other');
    const targetModule = path.join(targetDir, 'module.js');
    const otherModule = path.join(otherDir, 'module.js');

    fs.mkdirSync(targetDir, { recursive: true });
    fs.mkdirSync(otherDir, { recursive: true });
    fs.writeFileSync(targetModule, "module.exports = 'target';\n");
    fs.writeFileSync(otherModule, "module.exports = 'other';\n");

    const targetModuleId = require.resolve(targetModule);
    const otherModuleId = require.resolve(otherModule);

    require(targetModuleId);
    require(otherModuleId);

    assert.ok(require.cache[targetModuleId]);
    assert.ok(require.cache[otherModuleId]);

    clearRequireCacheByPrefixes([targetDir]);

    assert.equal(Boolean(require.cache[targetModuleId]), false);
    assert.equal(Boolean(require.cache[otherModuleId]), true);
});
