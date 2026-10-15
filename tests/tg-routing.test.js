'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const http = require('node:http');
const { createLocalPreviewApp } = require('../scripts/local-preview-server');

async function serve(app, run) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
        return await run(`http://127.0.0.1:${server.address().port}`);
    } finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
}

function getWithHost(url, host) {
    return new Promise((resolve, reject) => {
        const request = http.get(url, { headers: { Host: host } }, (response) => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => { body += chunk; });
            response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
        });
        request.on('error', reject);
    });
}

test('TG host rewrites and private cache headers do not alter the existing site entry', () => {
    const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../vercel.json'), 'utf8'));
    for (const [host, destination] of [['tg.fatherkey.com', '/tg.html'], ['tg.adm.fatherkey.com', '/tg-admin.html']]) {
        for (const source of ['/', '/index', '/index.html']) {
            const rule = config.rewrites.find((entry) => entry.source === source && entry.has?.some((item) => item.type === 'host' && item.value === host));
            assert.equal(rule?.destination, destination);
            const cacheRule = config.headers.find((entry) => entry.source === source && entry.has?.some((item) => item.value === host));
            assert.equal(cacheRule?.headers.find((item) => item.key === 'Cache-Control')?.value, 'no-store, max-age=0');
        }
        const privateReferrer = config.headers.find((entry) => entry.source === '/:path*' && entry.has?.some((item) => item.value === host));
        assert.equal(privateReferrer?.headers.find((item) => item.key === 'Referrer-Policy')?.value, 'no-referrer');
    }
    assert.ok(config.rewrites.some((entry) => entry.source === '/api/tg/:path*' && entry.destination === 'https://verify-api.fatherkey.com/api/tg/:path*'));
    for (const entry of ['api/admin.js', 'api/public.js']) assert.match(config.functions[entry].includeFiles, /server\/tg\/\*\*/);
    assert.ok(!config.rewrites.some((entry) => entry.source === '/' && !entry.has));
});

test('Verify archive and image include TG runtime while scheduler artifacts remain host-only', () => {
    const root = path.resolve(__dirname, '..');
    const deploy = fs.readFileSync(path.join(root, 'scripts/deploy-kvm4-verify-server.sh'), 'utf8');
    const vercelIgnore = fs.readFileSync(path.join(root, '.vercelignore'), 'utf8');
    assert.match(vercelIgnore, /^!server\/tg\/$/m, 'Vercel upload must retain TG function inputs');
    assert.match(vercelIgnore, /^!server\/tg\/\*\*$/m, 'Vercel upload must retain TG helper modules');
    assert.match(vercelIgnore, /^\/deploy\/$/m, 'Vercel upload must exclude host scheduler material');
    const packageBlock = deploy.match(/PACKAGE_PATHS=\(([\s\S]*?)\)/)?.[1];
    assert.ok(packageBlock, 'release archive must declare its input paths');
    const packagePaths = packageBlock.split('\n').map((line) => line.trim()).filter(Boolean);
    const image = fs.readFileSync(path.join(root, 'deploy/kvm4/verify-server.Dockerfile'), 'utf8');
    const imageCopies = [...image.matchAll(/^COPY\s+(\S+)\s+\.\/(\S+)\s*$/gm)].map((match) => match[1]);
    const coveredBy = (file, roots) => roots.some((base) => file === base || file.startsWith(`${base}/`));
    for (const file of [
        'api/public.js', 'api/admin.js', 'server/api-handlers/public/tg.js',
        'server/api-handlers/public/tg-purchase.js', 'server/api-handlers/public/tg-recipient.js',
        'server/api-handlers/admin/tg/codes.js', 'server/api-handlers/admin/tg/orders.js',
        'server/api-handlers/admin/tg/provider.js', 'server/api-handlers/admin/tg/products.js',
        'server/api-handlers/admin/tg/purchases.js', 'server/tg/payment-gateway.js', 'server/tg/admin-access.js',
        'server/tg/code-secrets.js', 'server/tg/gramix-client.js', 'server/tg/worker.js',
        'server/tg/recipient-profile.js', 'server/tg/nowpayments-gateway.js', 'server/tg/raw-body.js',
        'scripts/tg-fulfillment-worker.js', 'scripts/tg-readiness.js',
        'supabase/migrations/20261015_add_tg_premium_redemption_domain.sql',
        'supabase/migrations/20261015_tg_redemption_worker.sql',
        'supabase/migrations/20261015_tg_stars_redemption.sql',
        'supabase/migrations/20261015_tg_purchase_domain.sql',
        'supabase/migrations/20261015_verify_tg_stars_purchase_domain.sql',
        'supabase/migrations/20261015_tg_purchase_usdt_payments.sql'
    ]) {
        assert.ok(fs.statSync(path.join(root, file)).isFile(), `${file} must exist`);
        assert.ok(coveredBy(file, packagePaths), `${file} must reach the release archive`);
        assert.ok(coveredBy(file, imageCopies), `${file} must reach the Verify image`);
    }
    assert.ok(packagePaths.includes('deploy/kvm4/tg-worker'), 'scheduler sources must reach the matching host release');
    assert.ok(!imageCopies.some((base) => base === 'deploy' || base.startsWith('deploy/')), 'host scheduler artifacts must stay outside the compact API image');
    assert.ok(!packagePaths.includes('tg.html') && !packagePaths.includes('tg-admin.html'), 'TG pages belong to the Vercel static release');
});

test('local preview serves TG pages by host and dispatches TG/auth APIs without the main shop', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-preview-routing-'));
    fs.mkdirSync(path.join(repoRoot, 'api'));
    for (const [name, body] of [['index.html', 'MAIN'], ['tg.html', 'TG_REDEEM'], ['tg-admin.html', 'TG_ADMIN']]) {
        fs.writeFileSync(path.join(repoRoot, name), body);
    }
    fs.writeFileSync(path.join(repoRoot, 'api/public.js'), 'module.exports = (req, res) => res.json({ url: req.url });');
    try {
        const { app } = createLocalPreviewApp({ repoRoot, envFiles: [], baseEnv: {} });
        await serve(app, async (base) => {
            for (const [host, expected] of [['www.fatherkey.com', 'MAIN'], ['tg.fatherkey.com', 'TG_REDEEM'], ['tg.adm.fatherkey.com', 'TG_ADMIN']]) {
                for (const pathname of ['/', '/index.html']) {
                    const response = await getWithHost(`${base}${pathname}`, host);
                    assert.equal(response.status, 200);
                    assert.equal(response.body, expected);
                    assert.equal(response.headers['cache-control'], 'no-store');
                }
            }
            const catalog = await fetch(`${base}/api/tg/catalog`);
            assert.equal((await catalog.json()).url, '/api/public?scope=tg&route=catalog');
            const redeem = await fetch(`${base}/api/tg/redeem`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            assert.equal((await redeem.json()).url, '/api/public?scope=tg&route=redeem');
            for (const route of ['recipient', 'purchase/quote', 'purchase/orders', 'purchase/status', 'purchase/webhooks/zpay', 'purchase/webhooks/nowpayments']) {
                const response = await fetch(`${base}/api/tg/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
                const routed = new URL((await response.json()).url, base);
                assert.equal(routed.pathname, '/api/public');
                assert.equal(routed.searchParams.get('scope'), 'tg');
                assert.equal(routed.searchParams.get('route'), route);
            }
            const security = await fetch(`${base}/api/auth/login-security`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            assert.equal((await security.json()).url, '/api/public?scope=auth&route=login-security');
        });
    } finally {
        fs.rmSync(repoRoot, { recursive: true, force: true });
    }
});

test('verify CORS grants TG hosts only TG and required admin login endpoints', async () => {
    const serverPath = path.resolve(__dirname, '../server/index.js');
    const originalLoad = Module._load;
    let serverModule;
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '@supabase/supabase-js') return { createClient: () => ({}) };
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        delete require.cache[serverPath];
        serverModule = require(serverPath);
    } finally {
        Module._load = originalLoad;
    }
    try {
        await serve(serverModule.app, async (base) => {
            const cases = [
                ['/api/tg/catalog', 'https://tg.fatherkey.com', true],
                ['/api/public?scope=tg&route=status', 'https://tg.fatherkey.com', true],
                ['/api/tg/purchase/quote', 'https://tg.fatherkey.com', true],
                ['/api/tg/purchase/orders', 'https://tg.fatherkey.com', true],
                ['/api/tg/purchase/status', 'https://tg.fatherkey.com', true],
                ['/api/admin/tg/orders', 'https://tg.adm.fatherkey.com', true],
                ['/api/admin/tg/products', 'https://tg.adm.fatherkey.com', true],
                ['/api/admin/tg/purchases', 'https://tg.adm.fatherkey.com', true],
                ['/api/admin?route=tg/codes', 'https://tg.adm.fatherkey.com', true],
                ['/api/admin/access/session', 'https://tg.adm.fatherkey.com', true],
                ['/api/auth/login-security', 'https://tg.adm.fatherkey.com', true],
                ['/api/public?scope=auth&route=login-security', 'https://tg.adm.fatherkey.com', true],
                ['/api/admin/tg/orders', 'https://tg.fatherkey.com', false],
                ['/api/auth/login-security', 'https://tg.fatherkey.com', false],
                ['/api/shop/purchase', 'https://tg.fatherkey.com', false],
                ['/api/wallet/overview', 'https://tg.adm.fatherkey.com', false],
                ['/api/admin/shop/orders', 'https://tg.adm.fatherkey.com', false],
                ['/api/tg/catalog?scope=wallet&route=overview', 'https://tg.fatherkey.com', false],
                ['/api/admin/tg/orders?route=shop/orders', 'https://tg.adm.fatherkey.com', false],
                ['/api/public?scope=payments&route=create', 'https://tg.adm.fatherkey.com', false],
                ['/api/shop/purchase', 'https://www.fatherkey.com', true]
            ];
            for (const [pathname, origin, allowed] of cases) {
                const response = await fetch(`${base}${pathname}`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } });
                assert.equal(response.status, 204);
                assert.equal(response.headers.get('access-control-allow-origin'), allowed ? origin : null, `${origin} ${pathname}`);
            }
        });
    } finally {
        delete require.cache[serverPath];
    }
});
