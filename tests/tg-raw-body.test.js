'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { createLocalPreviewApp } = require('../scripts/local-preview-server');
const { isTgNowpaymentsWebhookRequest } = require('../server/tg/raw-body');

const IPN_PATHS = [
    '/api/tg/purchase/webhooks/nowpayments',
    // Compatibility capture only: the mock handler below deliberately does
    // not claim this legacy public-path alias dispatches a real TG handler.
    '/api/public/tg/purchase/webhooks/nowpayments',
    '/api/public?scope=tg&route=purchase%2Fwebhooks%2Fnowpayments'
];
const WIRE_JSON = '{"payment_id":12345678901234567890,"actually_paid":1.123456789012345678,"payment_status":"finished"}';
function echoBody(req, res) {
    res.json({ raw: Buffer.isBuffer(req.rawBody) ? req.rawBody.toString('utf8') : null, body: req.body });
}
async function serve(app, run) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try { return await run(`http://127.0.0.1:${server.address().port}`); }
    finally {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
}
async function post(base, pathname, body) {
    return fetch(`${base}${pathname}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
}

test('TG signed-body capture follows the final public scope/route and applies only to POST', () => {
    for (const url of [
        ...IPN_PATHS,
        '/api/tg/catalog?route=purchase/webhooks/nowpayments',
        '/api/public/payments/ignored?scope=tg&route=purchase/webhooks/nowpayments',
        '/api/public?scope=%20TG%20&route=%2FPURCHASE%2FWEBHOOKS%2FNOWPAYMENTS%2F'
    ]) {
        assert.equal(isTgNowpaymentsWebhookRequest({ method: 'POST', url }), true, url);
        for (const method of ['GET', 'PUT', 'PATCH', 'OPTIONS']) assert.equal(isTgNowpaymentsWebhookRequest({ method, url }), false, `${method} ${url}`);
    }
    for (const url of [
        '/api/tg/purchase/webhooks/nowpayments?scope=payments',
        '/api/tg/purchase/webhooks/nowpayments?route=catalog',
        '/api/public/tg/purchase/webhooks/nowpayments?scope=wallet',
        '/api/public?scope=payments&route=purchase/webhooks/nowpayments',
        '/api/tg/purchase/webhooks/zpay', '/api/public?scope=tg&route=recipient',
        '/api/payments/nowpayments/webhook', '/api/shop/purchase',
        '/other/api/tg/purchase/webhooks/nowpayments'
    ]) assert.equal(isTgNowpaymentsWebhookRequest({ method: 'POST', url }), false, url);
    assert.equal(isTgNowpaymentsWebhookRequest({ method: 'POST', originalUrl: IPN_PATHS[0], url: '/internal-rewrite' }), true);
    assert.equal(isTgNowpaymentsWebhookRequest(), false);
});

async function assertRawBodyPolicy(app) {
    await serve(app, async (base) => {
        for (const pathname of IPN_PATHS) {
            const response = await post(base, pathname, WIRE_JSON);
            assert.equal(response.status, 200, pathname);
            const captured = await response.json();
            assert.equal(captured.raw, WIRE_JSON, 'wire numeric lexemes must survive the lossy JSON body parser');
            assert.deepEqual(captured.body, JSON.parse(WIRE_JSON));
            assert.notEqual(JSON.stringify(captured.body), captured.raw, 'fixture must exercise actual IEEE-754 precision loss');
        }
        const largeBody = JSON.stringify({ note: 'x'.repeat(9000) });
        for (const pathname of IPN_PATHS) {
            const response = await post(base, pathname, largeBody);
            assert.equal(response.status, 413, pathname);
        }
        for (const pathname of [
            '/api/public?scope=payments&route=test',
            '/api/tg/purchase/webhooks/nowpayments?scope=payments&route=test',
            '/api/tg/purchase/webhooks/nowpayments?route=catalog'
        ]) {
            const response = await post(base, pathname, largeBody);
            assert.equal(response.status, 200, 'the IPN size limit must not shrink ordinary API limits');
            const ordinary = await response.json();
            assert.equal(ordinary.raw, null, 'ordinary APIs retain their existing body handling');
            assert.equal(ordinary.body.note.length, 9000);
        }
    });
}

test('actual local-preview middleware retains signed TG numeric JSON with a dedicated 8 KB limit', async () => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-raw-preview-'));
    fs.mkdirSync(path.join(repoRoot, 'api'));
    fs.writeFileSync(path.join(repoRoot, 'api/public.js'), `module.exports = ${echoBody.toString()};\n`);
    try {
        const { app } = createLocalPreviewApp({ repoRoot, envFiles: [], baseEnv: {} });
        app.set('env', 'test'); // Suppress Express's expected 413 error logging.
        await assertRawBodyPolicy(app);
    } finally { fs.rmSync(repoRoot, { recursive: true, force: true }); }
});

test('actual Verify middleware retains signed TG numeric JSON while ordinary APIs keep their parser', async () => {
    const serverPath = path.resolve(__dirname, '../server/index.js');
    const originalLoad = Module._load;
    let serverModule;
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '@supabase/supabase-js') return { createClient: () => ({}) };
        if (request === '../api/public' && parent?.filename === serverPath) return echoBody;
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        delete require.cache[serverPath];
        serverModule = require(serverPath);
    } finally { Module._load = originalLoad; }
    try { await assertRawBodyPolicy(serverModule.app); }
    finally { delete require.cache[serverPath]; }
});
