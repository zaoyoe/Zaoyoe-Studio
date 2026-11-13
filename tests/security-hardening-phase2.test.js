const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const vm = require('node:vm');

const remoteHttpSecurity = require('../api/_lib/remote-http-security');
const {
    buildVerifyKeyFingerprint
} = require('../server/api-handlers/_verify-provider-runtime');
const {
    clientMonitoringEventHandler,
    _resetRateLimitStore
} = require('../server/api-handlers/public/monitoring-client-event');

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
        json() {
            return state.body ? JSON.parse(state.body) : {};
        },
        get statusCode() {
            return state.statusCode;
        },
        get headers() {
            return state.headers;
        }
    };
}

function createFakeHttpRequestFactory(handler) {
    return function fakeRequest(url, options, onResponse) {
        const req = new EventEmitter();
        req.end = () => {
            queueMicrotask(() => {
                try {
                    const spec = handler(url, options);
                    const res = new EventEmitter();
                    res.statusCode = spec.statusCode || 200;
                    res.headers = spec.headers || {};
                    res.destroy = () => {
                        res.destroyed = true;
                    };
                    res[Symbol.asyncIterator] = async function* iterateChunks() {
                        if (spec.body != null) {
                            yield Buffer.isBuffer(spec.body) ? spec.body : Buffer.from(spec.body);
                        }
                    };
                    onResponse(res);
                } catch (error) {
                    req.emit('error', error);
                }
            });
            return req;
        };
        return req;
    };
}

test('remote-http-security blocks loopback, shorthand, IPv6-mapped, metadata, internal TLDs, and credentials', () => {
    const blockedUrls = [
        'http://127.0.0.1/secret',
        'http://127.1/secret',
        'http://0177.0.0.1/secret',
        'http://[::1]/secret',
        'http://[::ffff:127.0.0.1]/secret',
        'http://169.254.169.254/latest/meta-data/',
        'http://100.64.0.1/internal',
        'https://metadata.google.internal/computeMetadata/v1/',
        'https://service.local/health',
        'https://user:pass@93.184.216.34/secret',
        'file:///etc/passwd',
        'https://93.184.216.34:8443/custom-port'
    ];

    for (const candidate of blockedUrls) {
        assert.throws(
            () => remoteHttpSecurity.validatePublicHttpUrl(candidate),
            (err) => Number(err?.statusCode) === 400,
            `Expected ${candidate} to be rejected`
        );
    }

    const customPort = remoteHttpSecurity.validatePublicHttpUrl('https://93.184.216.34:8443/v1', {
        allowCustomPorts: true
    });
    assert.equal(customPort.port, '8443');
});

test('remote-http-security resolvePublicAddresses rejects private DNS answers and accepts public IPs', async () => {
    await assert.rejects(
        () => remoteHttpSecurity.resolvePublicAddresses('rebind.example.com', {
            lookup: async () => [{ address: '10.0.0.12', family: 4 }]
        }),
        (err) => err?.statusCode === 400
    );

    await assert.rejects(
        () => remoteHttpSecurity.resolvePublicAddresses('mapped.example.com', {
            lookup: async () => [{ address: '::ffff:127.0.0.1', family: 6 }]
        }),
        (err) => err?.statusCode === 400
    );

    const publicAddresses = await remoteHttpSecurity.resolvePublicAddresses('cdn.example.com', {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }]
    });
    assert.deepEqual(publicAddresses, [{ address: '93.184.216.34', family: 4 }]);
});

test('remote-http-security fetchWithPinnedSsrfGuard blocks unsafe redirects and HTTPS downgrades', async () => {
    const fetcher = remoteHttpSecurity.createSafeRemoteFetcher({
        lookup: async (hostname) => {
            if (hostname === 'rebind-target.example') {
                return [{ address: '192.168.1.50', family: 4 }];
            }
            return [{ address: '93.184.216.34', family: 4 }];
        },
        requestHttps: createFakeHttpRequestFactory((url) => {
            if (url.pathname === '/to-private') {
                return {
                    statusCode: 302,
                    headers: { location: 'https://rebind-target.example/secret' }
                };
            }
            if (url.pathname === '/downgrade') {
                return {
                    statusCode: 301,
                    headers: { location: 'http://cdn.example/asset.png' }
                };
            }
            if (url.pathname === '/to-loopback') {
                return {
                    statusCode: 302,
                    headers: { location: 'http://127.0.0.1/admin' }
                };
            }
            return {
                statusCode: 200,
                headers: { 'content-type': 'image/png' },
                body: Buffer.from([
                    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
                    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
                ])
            };
        }),
        requestHttp: createFakeHttpRequestFactory(() => ({
            statusCode: 200,
            body: 'should never reach http downgrade'
        }))
    });

    await assert.rejects(() => fetcher('https://cdn.example/to-private'), (err) => err?.statusCode === 400);
    await assert.rejects(() => fetcher('https://cdn.example/downgrade'), (err) => err?.code === 'remote_redirect_downgrade');
    await assert.rejects(() => fetcher('https://cdn.example/to-loopback'), (err) => err?.statusCode === 400);

    const valid = await fetcher('https://cdn.example/ok.png');
    assert.equal(valid.status, 200);
    assert.equal(remoteHttpSecurity.detectImageMimeFromMagic(valid.buffer), 'image/png');
});

test('image-base64, image-thumbnail, and prompts/imports reject non-image disguised payloads with 415 and accept PNG magic bytes', async () => {
    const pngBuffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52
    ]);
    let nextResponse = {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        buffer: Buffer.from('{"not":"an-image"}')
    };

    const base64Path = path.resolve(__dirname, '../server/api-handlers/admin/prompts/image-base64.js');
    const thumbnailPath = path.resolve(__dirname, '../server/api-handlers/admin/prompts/image-thumbnail.js');
    const importsPath = path.resolve(__dirname, '../server/api-handlers/admin/prompts/imports.js');
    const originalLoad = Module._load;

    delete require.cache[base64Path];
    delete require.cache[thumbnailPath];
    delete require.cache[importsPath];

    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === '../../../../api/_lib/remote-http-security') {
            return {
                ...remoteHttpSecurity,
                async fetchWithPinnedSsrfGuard() {
                    return nextResponse;
                }
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    let imageBase64;
    let imageThumbnail;
    let importsHandler;
    try {
        imageBase64 = require(base64Path);
        imageThumbnail = require(thumbnailPath);
        importsHandler = require(importsPath);
    } finally {
        Module._load = originalLoad;
    }

    try {
        await assert.rejects(
            () => imageBase64._private.fetchRemoteImageBuffer('https://cdn.example/fake.png'),
            (err) => Number(err?.statusCode) === 415
        );
        await assert.rejects(
            () => imageThumbnail._private.fetchImageBuffer('https://cdn.example/fake.png'),
            (err) => Number(err?.statusCode) === 415
        );
        assert.equal(importsHandler._private.isBlockedImportHostname('127.1'), true);
        assert.equal(importsHandler._private.isBlockedImportHostname('::ffff:127.0.0.1'), true);
        assert.equal(importsHandler._private.isSupportedImageBuffer(Buffer.from('{"not":"an-image"}'), 'image/jpeg'), false);
        assert.equal(importsHandler._private.isSupportedImageBuffer(pngBuffer, 'application/octet-stream'), true);

        nextResponse = {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'image/png' }),
            buffer: pngBuffer
        };
        const base64Result = await imageBase64._private.fetchImageAsBase64('https://cdn.example/real.png');
        assert.equal(base64Result.mime_type, 'image/png');
        assert.equal(base64Result.base64, pngBuffer.toString('base64'));
        assert.equal(base64Result.byte_size, pngBuffer.length);

        const mp4Buffer = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
        assert.equal(remoteHttpSecurity.detectVideoMimeFromMagic(mp4Buffer), 'video/mp4');
        assert.equal(importsHandler._private.isSupportedVideoBuffer(mp4Buffer, 'video/mp4'), true);
    } finally {
        delete require.cache[base64Path];
        delete require.cache[thumbnailPath];
        delete require.cache[importsPath];
    }
});

test('monitoring-client-event enforces Content-Length cap, allowed origins, payload validation, and sliding rate limits', async () => {
    _resetRateLimitStore();

    const oversizedRes = createMockResponse();
    await clientMonitoringEventHandler({
        method: 'POST',
        headers: {
            'content-length': String(64 * 1024)
        }
    }, oversizedRes);
    assert.equal(oversizedRes.statusCode, 413);

    const badOriginRes = createMockResponse();
    await clientMonitoringEventHandler({
        method: 'POST',
        headers: {
            origin: 'https://evil-attacker.example'
        },
        body: {
            kind: 'window_error',
            message: 'boom'
        }
    }, badOriginRes);
    assert.equal(badOriginRes.statusCode, 403);
    assert.equal(badOriginRes.json().code, 'unauthorized_origin');

    const emptyPayloadRes = createMockResponse();
    await clientMonitoringEventHandler({
        method: 'POST',
        headers: {
            origin: 'https://www.fatherkey.com'
        },
        body: {}
    }, emptyPayloadRes);
    assert.equal(emptyPayloadRes.statusCode, 400);
    assert.equal(emptyPayloadRes.json().code, 'missing_event_payload');

    const rateLimitStore = new Map();
    for (let i = 0; i < 10; i += 1) {
        const res = createMockResponse();
        await clientMonitoringEventHandler({
            method: 'POST',
            headers: {
                origin: 'https://www.fatherkey.com',
                'x-forwarded-for': '203.0.113.99'
            },
            socket: { remoteAddress: '203.0.113.99' },
            body: {
                kind: 'window_error',
                message: 'repeated crash'
            }
        }, res, { rateLimitStore, now: 1700000000000 });
        assert.equal(res.statusCode, 202);
    }

    const throttledRes = createMockResponse();
    await clientMonitoringEventHandler({
        method: 'POST',
        headers: {
            origin: 'https://www.fatherkey.com',
            'x-forwarded-for': '203.0.113.99'
        },
        socket: { remoteAddress: '203.0.113.99' },
        body: {
            kind: 'window_error',
            message: 'repeated crash'
        }
    }, throttledRes, { rateLimitStore, now: 1700000001000 });
    assert.equal(throttledRes.statusCode, 429);
    assert.equal(throttledRes.json().code, 'rate_limit_exceeded');
    assert.equal(Boolean(throttledRes.headers['retry-after']), true);

    _resetRateLimitStore();
});

test('admin-config.js matches verify quota key_states by SHA-256 fingerprint without plaintext api_key', async () => {
    const adminConfigSource = fs.readFileSync(path.resolve(__dirname, '../admin-config.js'), 'utf8');
    assert.equal(adminConfigSource.includes('async function buildVerifyKeyFingerprintClient('), true);
    assert.equal(adminConfigSource.includes('function normalizeVerifyQuotaKeyStates('), true);

    const startIdx = adminConfigSource.indexOf('async function buildVerifyKeyFingerprintClient(');
    const endIdx = adminConfigSource.indexOf('function getZeroBalanceVerifyQuotaKeyStates(');
    assert.notEqual(startIdx, -1);
    assert.notEqual(endIdx, -1);

    const snippet = adminConfigSource.slice(startIdx, endIdx);
    const context = {
        window: { crypto: globalThis.crypto },
        crypto: globalThis.crypto,
        TextEncoder
    };
    vm.runInNewContext(snippet, context);

    const sampleKey = 'sk-verify-sample-secret-123456';
    const clientFingerprint = await context.buildVerifyKeyFingerprintClient(sampleKey);
    const serverFingerprint = buildVerifyKeyFingerprint(sampleKey);
    assert.equal(clientFingerprint, serverFingerprint);
    assert.match(clientFingerprint, /^sha256:[0-9a-f]{24}$/);

    const normalizedStates = context.normalizeVerifyQuotaKeyStates([
        {
            masked_key: 'sk-v...3456',
            key_fingerprint: serverFingerprint,
            key_name: 'Primary Key',
            remaining_uses: 0,
            ok: true
        }
    ]);
    assert.equal(normalizedStates.length, 1);
    assert.equal(normalizedStates[0].api_key, '');
    assert.equal(normalizedStates[0].key_fingerprint, serverFingerprint);
    assert.equal(normalizedStates[0].masked_key, 'sk-v...3456');
});
