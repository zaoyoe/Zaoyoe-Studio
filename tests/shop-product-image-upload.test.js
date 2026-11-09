const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');
const sharp = require('sharp');

const source = fs.readFileSync(path.join(__dirname, '../supabase/functions/upload-avatar/index.ts'), 'utf8');
const script = stripTypeScriptTypes(source.replace(/^import .*\n/gm, ''), { mode: 'strip' });
const dataUrl = (bytes, type = 'image/webp') => `data:${type};base64,${bytes.toString('base64')}`;

function createUploadHarness({ authenticated = true, permitted = true, rateAllowed = true } = {}) {
    let handler;
    const uploads = [];
    const audits = [];
    const env = {
        SUPABASE_URL: 'https://test.supabase.invalid',
        SUPABASE_ANON_KEY: 'test-public',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service',
        R2_ACCOUNT_ID: 'test-account', R2_ACCESS_KEY_ID: 'test-access', R2_SECRET_ACCESS_KEY: 'test-secret',
        R2_BUCKET_NAME: 'test-images', R2_PUBLIC_URL: 'https://cdn.fatherkey.com'
    };
    const client = {
        auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'test-user' } : null }, error: null }) },
        rpc: async name => {
            if (name === 'get_user_permissions') return { data: { permissions: permitted ? ['shop.manage'] : [] }, error: null };
            if (name === 'take_rate_limit_token') return { data: { allowed: rateAllowed, retry_after_seconds: 60 }, error: null };
            throw new Error(`Unexpected RPC: ${name}`);
        },
        from: table => {
            if (table === 'admin_roles') return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
            if (table === 'admin_audit_logs') return { insert: async entry => { audits.push(entry); return { error: null }; } };
            throw new Error(`Unexpected table: ${table}`);
        }
    };
    vm.runInNewContext(script, {
        serve: callback => { handler = callback; },
        Deno: { env: { get: key => env[key] } },
        S3Client: class { async send(command) { uploads.push(command.input); } },
        PutObjectCommand: class { constructor(input) { this.input = input; } },
        createClient: () => client,
        Request, Response, URL, Uint8Array, ArrayBuffer, atob, btoa, crypto: webcrypto,
        setTimeout, clearTimeout, AbortController,
        console: { log() {}, warn() {}, error() {} },
        fetch: () => { throw new Error('Unexpected network access'); }
    });
    return {
        uploads, audits,
        async upload(payload, authorized = true) {
            const response = await handler(new Request('https://upload.test.invalid', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(authorized ? { Authorization: 'Bearer test-token' } : {}) },
                body: JSON.stringify({ type: 'product', userId: 'test-user', ...payload })
            }));
            return { status: response.status, body: await response.json() };
        }
    };
}

const image = sharp({ create: { width: 160, height: 160, channels: 3, background: '#56789a' } }).webp().toBuffer();

test('manual product uploads reuse immutable rendition URLs across different products', async () => {
    const bytes = await image;
    const harness = createUploadHarness();
    const payload = { imageData: dataUrl(bytes), cardImageData: dataUrl(bytes), thumbImageData: dataUrl(bytes) };
    const first = await harness.upload({ ...payload, productId: 'product-a' });
    const second = await harness.upload({ ...payload, productId: 'product-b' });
    assert.equal(first.status, 200);
    assert.deepEqual(first.body.imageAsset, second.body.imageAsset);
    for (const variant of ['original', 'card', 'thumb']) {
        assert.match(first.body.imageAsset[variant], new RegExp(`/products/${variant}/[a-f0-9]{20}\\.webp$`));
    }
    assert.equal(harness.uploads.length, 6);
    assert.ok(harness.uploads.every(upload => upload.CacheControl.endsWith('immutable')));
    assert.equal(harness.audits.length, 2);
    const different = await sharp({ create: { width: 160, height: 160, channels: 3, background: '#123456' } }).webp().toBuffer();
    const changed = await harness.upload({ imageData: dataUrl(different), thumbImageData: dataUrl(different) });
    assert.notEqual(changed.body.imageAsset.thumb, first.body.imageAsset.thumb);
});

test('invalid or oversized thumbnails fall back without losing a valid original and card', async () => {
    const bytes = await image;
    for (const thumbImageData of [dataUrl(bytes, 'image/png'), dataUrl(Buffer.alloc(32)), dataUrl(Buffer.concat([bytes, Buffer.alloc(256 * 1024)]))]) {
        const harness = createUploadHarness();
        const result = await harness.upload({ imageData: dataUrl(bytes), cardImageData: dataUrl(bytes), thumbImageData });
        assert.equal(result.status, 200);
        assert.ok(result.body.imageAsset.original);
        assert.ok(result.body.imageAsset.card);
        assert.equal(result.body.imageAsset.thumb, undefined);
        assert.equal(harness.uploads.length, 2);
    }
});

test('product image authentication, permissions and rate limit still reject before any upload', async () => {
    const bytes = await image;
    for (const options of [{ authenticated: false }, { permitted: false }, { rateAllowed: false }]) {
        const harness = createUploadHarness(options);
        const result = await harness.upload({ imageData: dataUrl(bytes), thumbImageData: dataUrl(bytes) });
        assert.equal(result.status, 400);
        assert.equal(result.body.success, false);
        assert.equal(harness.uploads.length, 0);
    }
    const harness = createUploadHarness();
    assert.equal((await harness.upload({ imageData: dataUrl(bytes) }, false)).status, 400);
    assert.equal(harness.uploads.length, 0);
});
