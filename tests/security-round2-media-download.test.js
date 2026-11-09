'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { isPublicAddress, validateMediaUrl, createMediaDownloader } = require('../server/api-handlers/admin/shop/_remote-media-security');
const { syncHtmlMediaToR2, uploadRemoteMediaToR2 } = require('../server/api-handlers/admin/shop/_r2-media');
const png = Buffer.from('89504e470d0a1a0a0000000049454e44', 'hex');
function fixture(replies, answers = [{ address: '93.184.216.34', family: 4 }]) {
    const calls = [], resolutions = [];
    const request = (url, options, callback) => {
        const req = new EventEmitter();
        const reply = replies[calls.length];
        assert.ok(reply, 'unexpected request');
        calls.push({ url: String(url), options });
        req.end = () => queueMicrotask(() => {
            const stream = Readable.from(reply.chunks || [png]);
            stream.statusCode = reply.status || 200;
            stream.headers = { 'content-type': 'image/png', ...reply.headers };
            const abort = () => stream.destroy(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            options.signal?.addEventListener('abort', abort, { once: true });
            stream.on('close', () => options.signal?.removeEventListener('abort', abort));
            callback(stream);
        });
        return req;
    };
    const download = createMediaDownloader({
        lookup: async host => { resolutions.push(host); return typeof answers === 'function' ? answers(host) : answers; },
        requestHttp: request, requestHttps: request
    });
    return { download, calls, resolutions };
}
for (const address of ['127.0.0.1', '10.1.2.3', '172.16.1.1', '192.168.1.1', '169.254.169.254', '100.64.1.1', '0.0.0.0', '192.88.99.1', '198.18.0.1', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:8.8.8.8', '2002:0808:0808::1']) {
    test(`media rejects nonpublic address ${address}`, () => assert.equal(isPublicAddress(address), false));
}
for (const url of ['http://2130706433/image', 'http://0x7f000001/', 'http://127.1/', 'http://[::1]/', 'https://user:pass@example.com/x', 'http://example.com:8080/x', 'file:///etc/passwd', 'http://metadata.internal/x', 'http://localhost/x', 'https://example.com./x']) {
    test(`media rejects unsafe URL ${url}`, () => assert.throws(() => validateMediaUrl(url)));
}
test('media pins the validated address and preserves HTTPS hostname', async () => {
    const f = fixture([{}]);
    const result = await f.download('https://images.example.com/photo');
    assert.deepEqual(result.buffer, png);
    assert.equal(result.mimeType, 'image/png');
    assert.equal(result.extension, 'png');
    assert.deepEqual(f.resolutions, ['images.example.com']);
    assert.equal(f.calls[0].url, 'https://images.example.com/photo');
    assert.equal(f.calls[0].options.agent, false);
    const pinned = await new Promise((resolve, reject) => f.calls[0].options.lookup('images.example.com', {}, (e, ip, family) => e ? reject(e) : resolve({ ip, family })));
    assert.deepEqual(pinned, { ip: '93.184.216.34', family: 4 });
});
test('media refuses mixed public/private DNS answers before connecting', async () => {
    const f = fixture([], [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }]);
    await assert.rejects(f.download('https://images.example.com/a'), /unsafe_media_address/);
    assert.equal(f.calls.length, 0);
});
test('media revalidates every redirect DNS answer', async () => {
    const f = fixture([{ status: 302, headers: { location: 'https://internal.example.com/secret' } }], host => [{ address: host.startsWith('internal') ? '10.0.0.1' : '93.184.216.34', family: 4 }]);
    await assert.rejects(f.download('https://images.example.com/a'), /unsafe_media_address/);
    assert.equal(f.calls.length, 1);
});
test('media refuses literal private redirect and HTTPS downgrade', async () => {
    for (const location of ['http://169.254.169.254/latest', 'http://images.example.com/a']) {
        const f = fixture([{ status: 302, headers: { location } }]);
        await assert.rejects(f.download('https://images.example.com/a'), /unsafe_media_url|media_redirect_downgrade/);
        assert.equal(f.calls.length, 1);
    }
});
test('media caps redirect chains even with an excessive caller limit', async () => {
    const f = fixture(Array.from({ length: 4 }, () => ({ status: 302, headers: { location: '/next' } })));
    await assert.rejects(f.download('https://images.example.com/a', { maxRedirects: 1000 }), /media_redirect_limit/);
    assert.equal(f.calls.length, 4);
});
test('media checks declared and streamed sizes including chunked responses', async () => {
    const declared = fixture([{ headers: { 'content-length': '99999' } }]);
    await assert.rejects(declared.download('https://images.example.com/a', { maxBytes: 16 }), /media_too_large/);
    const chunks = fixture([{ chunks: [png, png] }]);
    await assert.rejects(chunks.download('https://images.example.com/a', { maxBytes: png.length }), /media_too_large/);
});
test('media refuses compressed responses, active content, and fake MIME', async () => {
    for (const reply of [
        { headers: { 'content-encoding': 'gzip' } },
        { chunks: [Buffer.from('<svg onload="alert(1)"/>')], headers: { 'content-type': 'image/svg+xml' } },
        { chunks: [Buffer.from('<html>private content</html>')] }
    ]) await assert.rejects(fixture([reply]).download('https://images.example.com/a'), /invalid_media_response|unsupported_media_content/);
});
test('media supports ordinary JPEG and MP4 assets', async () => {
    for (const [bytes, mime, extension] of [[Buffer.from('ffd8ffe00000', 'hex'), 'image/jpeg', 'jpg'], [Buffer.from('000000186674797069736f6d00000000', 'hex'), 'video/mp4', 'mp4']]) {
        const result = await fixture([{ chunks: [bytes], headers: { 'content-type': mime } }]).download('https://images.example.com/a');
        assert.equal(result.extension, extension);
    }
});
test('media honors abort before and after DNS resolution', async () => {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(fixture([]).download('https://images.example.com/a', { signal: controller.signal }), { name: 'AbortError' });
    const during = new AbortController();
    const f = fixture([], () => { during.abort(); return [{ address: '93.184.216.34', family: 4 }]; });
    await assert.rejects(f.download('https://images.example.com/a', { signal: during.signal }), { name: 'AbortError' });
    assert.equal(f.calls.length, 0);
});
test('HTML media sync removes rejected attributes without replacing visible text', async () => {
    const html = '<p>http://127.0.0.1/secret</p><img src="http://127.0.0.1/secret"><video poster="https://good.example.com/a.png"></video>';
    const result = await syncHtmlMediaToR2(html, { env: {} });
    assert.match(result, /<p>http:\/\/127\.0\.0\.1\/secret<\/p>/);
    assert.doesNotMatch(result, /src="http:\/\/127/);
    assert.match(result, /poster="https:\/\/good\.example\.com\/a.png"/);
});
test('HTML sync bounds media batch count and escapes attribute quotes', async () => {
    const result = await syncHtmlMediaToR2(Array.from({ length: 41 }, (_, i) => `<img src="https://images.example.com/${i}.png">`).join(''), { env: {} });
    assert.equal((result.match(/src=/g) || []).length, 40);
    const quoted = await syncHtmlMediaToR2('<img src="https://images.example.com/a?x=\'onerror=bad">', { env: {} });
    assert.match(quoted, /x=%27onerror=bad/);
    assert.doesNotMatch(quoted, /[\s'"]onerror=/);
    assert.equal((quoted.match(/src=/g) || []).length, 1);
    assert.equal(await uploadRemoteMediaToR2('http://127.0.0.1/a', { env: {} }), '');
});

const sharp = require('sharp');
const { createProductImageImporter } = require('../server/api-handlers/admin/shop/_product-image-assets');
const r2Env = { R2_ENDPOINT: 'https://storage.example.com', R2_ACCESS_KEY_ID: 'synthetic', R2_SECRET_ACCESS_KEY: 'synthetic', R2_BUCKET_NAME: 'synthetic', R2_PUBLIC_URL: 'https://cdn.example.com' };
test('cover importer rejects private URLs even without storage and never invokes the downloader', async () => {
    let downloads = 0;
    const importer = createProductImageImporter({ downloadImage: async () => { downloads++; throw new Error('unexpected'); } });
    assert.equal(await importer('http://127.0.0.1/secret', { env: {} }), null);
    assert.deepEqual(await importer('https://images.example.com/a.png', { env: {} }), { original: 'https://images.example.com/a.png' });
    assert.equal(downloads, 0);
});
test('cover importer uses DNS and redirect protections without restoring failed source URLs', async () => {
    for (const f of [
        fixture([{ status: 302, headers: { location: 'http://169.254.169.254/private' } }]),
        fixture([], [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }]),
        fixture([{ headers: { 'content-type': 'image/png' }, chunks: [Buffer.from('<svg onload=bad()>')] }]),
        fixture([{ headers: { 'content-type': 'video/mp4' }, chunks: [Buffer.from('000000186674797069736f6d00000000', 'hex')] }])
    ]) {
        let uploads = 0;
        const importer = createProductImageImporter({ downloadImage: f.download, upload: async () => { uploads++; return {}; } });
        assert.equal(await importer('https://images.example.com/a.png', { env: r2Env }), null);
        assert.equal(uploads, 0);
    }
});
test('cover deadline bounds stalled DNS and uploads, aborts and clears failed cache', async () => {
    const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).png().toBuffer();
    for (const stage of ['dns', 'upload']) {
        let capturedSignal, attempts = 0;
        const importer = createProductImageImporter({
            downloadImage: async (_, { signal }) => {
                attempts++; capturedSignal = signal;
                if (stage === 'dns') return new Promise(() => {});
                return { buffer: bytes, mimeType: 'image/png', extension: 'png' };
            },
            upload: async (_, { signal }) => { capturedSignal = signal; return new Promise(() => {}); }
        });
        assert.equal(await importer('https://images.example.com/a.png', { env: r2Env, timeoutMs: 100 }), null);
        assert.equal(capturedSignal.aborted, true);
        assert.equal(await importer('https://images.example.com/a.png', { env: r2Env, timeoutMs: 100 }), null);
        assert.equal(attempts, 2);
    }
});
test('safe remote cover still uploads all three WebP variants with cancellation signal', async () => {
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toBuffer();
    const f = fixture([{ chunks: [bytes] }]);
    const uploads = [];
    const importer = createProductImageImporter({ downloadImage: f.download, upload: async (buffer, options) => {
        uploads.push(options); assert.equal((await sharp(buffer).metadata()).format, 'webp');
        return { publicUrl: `https://cdn.example.com/${uploads.length}.webp` };
    } });
    const result = await importer('https://images.example.com/a.png', { env: r2Env });
    assert.deepEqual(Object.keys(result), ['original', 'card', 'thumb']);
    assert.equal(uploads.length, 3);
    assert.ok(uploads.every(options => options.signal && !options.signal.aborted));
});
