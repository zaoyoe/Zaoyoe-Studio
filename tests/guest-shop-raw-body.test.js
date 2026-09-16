'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { Readable } = require('node:stream');
const express = require('express');

const {
    captureGuestShopWebhookRawBody,
    guestWorkerRequestDeclaresBody,
    parseMaxBytes,
    isGuestShopWebhookRequest,
    isGuestShopWorkerRequest,
    readRequestRawBody,
} = require('../api/_lib/guest-shop/raw-body');

const verifyServerSource = fs.readFileSync(path.resolve(__dirname, '../server/index.js'), 'utf8');
const localPreviewSource = fs.readFileSync(path.resolve(__dirname, '../scripts/local-preview-server.js'), 'utf8');

function request(body, path = '/api/shop/guest/webhooks/zpay', headers = {}) {
    const stream = Readable.from([Buffer.from(body)]);
    stream.method = 'POST';
    stream.url = path;
    stream.originalUrl = path;
    stream.path = path.split('?')[0];
    stream.headers = { 'content-length': String(Buffer.byteLength(body)), ...headers };
    return stream;
}

test('guest webhook route detection covers direct and shared dispatcher paths only', () => {
    assert.equal(isGuestShopWebhookRequest({ method: 'POST', path: '/api/shop/guest/webhooks/zpay' }), true);
    assert.equal(isGuestShopWebhookRequest({ method: 'POST', path: '/api/shop/guest/webhooks/nowpayments/' }), true);
    assert.equal(isGuestShopWebhookRequest({
        method: 'POST', path: '/api/public', query: { scope: 'shop', route: 'guest/webhooks/zpay' }
    }), true);
    assert.equal(isGuestShopWebhookRequest({ method: 'GET', path: '/api/shop/guest/webhooks/zpay' }), false);
    assert.equal(isGuestShopWebhookRequest({ method: 'POST', path: '/api/shop/guest/orders' }), false);
});

test('guest worker route detection bypasses global parsers and rejects body-bearing calls', () => {
    assert.equal(isGuestShopWorkerRequest({ method: 'POST', path: '/api/shop/guest/worker' }), true);
    assert.equal(isGuestShopWorkerRequest({ method: 'GET', path: '/api/shop/guest/worker/' }), true);
    assert.equal(isGuestShopWorkerRequest({
        method: 'POST', path: '/api/public', query: { scope: 'shop', route: 'guest/worker' }
    }), true);
    assert.equal(isGuestShopWorkerRequest({ method: 'POST', path: '/api/shop/guest/orders' }), false);
    assert.equal(guestWorkerRequestDeclaresBody({ headers: { 'content-length': '0' } }), false);
    assert.equal(guestWorkerRequestDeclaresBody({ headers: { 'content-length': '12' } }), true);
    assert.equal(guestWorkerRequestDeclaresBody({ headers: { 'transfer-encoding': 'chunked' } }), true);
});

test('raw-body reader preserves exact signed bytes and capture middleware stores them', async () => {
    const body = 'money=1.20&out_trade_no=GS%2B001&sign=abc';
    const req = request(body);
    const raw = await readRequestRawBody(req, { maxBytes: 1024 });
    assert.deepEqual(raw, Buffer.from(body));

    const captured = request(body);
    let called = 0;
    await new Promise((resolve, reject) => {
        captureGuestShopWebhookRawBody({ maxBytes: 1024 })(captured, {}, (error) => {
            if (error) reject(error);
            else { called += 1; resolve(); }
        });
    });
    assert.equal(called, 1);
    assert.deepEqual(captured.rawBody, Buffer.from(body));
});

test('oversized guest webhook is rejected before the handler can parse it', async () => {
    const req = request('0123456789');
    await assert.rejects(
        readRequestRawBody(req, { maxBytes: 4 }),
        (error) => error?.statusCode === 413 && error?.code === 'payload_too_large'
    );
});

test('raw-body limit parser rejects explicit coercion traps instead of clamping/defaulting', () => {
    assert.equal(parseMaxBytes(undefined), 256 * 1024);
    assert.equal(parseMaxBytes('1024'), 1024);
    assert.equal(parseMaxBytes(1024), 1024);
    for (const value of [null, '', 'NaN', 'Infinity', '-1', '0', '1.5', '1e3', 0, -1, 1.5, 4 * 1024 * 1024 + 1]) {
        assert.throws(
            () => parseMaxBytes(value),
            (error) => error?.code === 'guest_body_limit_invalid'
                && error.statusCode === 503
                && error.expose === false
        );
    }
});

test('verify server installs route-specific capture before and around global parsers', () => {
    const captureIndex = verifyServerSource.indexOf('app.use(captureGuestShopWebhookRawBody());');
    const jsonIndex = verifyServerSource.indexOf('const defaultJsonBodyParser = express.json();');
    const jsonInstallIndex = verifyServerSource.indexOf('const parser = isAiImageReferenceUploadRequest(req)', jsonIndex);
    const jsonMiddlewareIndex = verifyServerSource.lastIndexOf('app.use((req, res, next) => {', jsonInstallIndex);
    const jsonSkipIndex = verifyServerSource.indexOf('if (isGuestShopWebhookRequest(req) || isGuestShopWorkerRequest(req)) return next();', jsonMiddlewareIndex);
    const urlencodedIndex = verifyServerSource.indexOf('const defaultUrlencodedBodyParser = express.urlencoded({ extended: false });');
    const urlencodedSkipIndex = verifyServerSource.indexOf('if (isGuestShopWebhookRequest(req) || isGuestShopWorkerRequest(req)) return next();', urlencodedIndex);

    assert.ok(captureIndex >= 0, 'guest raw-body middleware must be installed');
    assert.ok(jsonInstallIndex > captureIndex, 'raw-body capture must run before JSON parser');
    assert.ok(jsonSkipIndex > jsonMiddlewareIndex, 'JSON parser must skip guest webhooks');
    assert.ok(urlencodedIndex > jsonSkipIndex, 'urlencoded parser must remain after JSON parser');
    assert.ok(urlencodedSkipIndex > urlencodedIndex, 'urlencoded parser must skip guest webhooks');
});

test('local preview server captures guest webhook raw body before parsers', () => {
    const captureIndex = localPreviewSource.indexOf('app.use(captureGuestShopWebhookRawBody());');
    const jsonParserIndex = localPreviewSource.indexOf('const defaultJsonBodyParser = express.json({');
    const jsonSkipIndex = localPreviewSource.indexOf('if (isGuestShopWebhookRequest(req) || isGuestShopWorkerRequest(req)) return next();', jsonParserIndex);
    const urlencodedIndex = localPreviewSource.indexOf('const defaultUrlencodedBodyParser = express.urlencoded({');
    const urlencodedSkipIndex = localPreviewSource.indexOf('if (isGuestShopWebhookRequest(req) || isGuestShopWorkerRequest(req)) return next();', urlencodedIndex);

    assert.ok(captureIndex >= 0, 'local preview must install guest raw-body middleware');
    assert.ok(jsonParserIndex >= 0, 'local preview must keep a JSON parser');
    assert.ok(captureIndex < jsonSkipIndex, 'raw-body capture must run before JSON parser skip');
    assert.ok(jsonSkipIndex > jsonParserIndex, 'JSON parser must skip guest webhooks');
    assert.ok(urlencodedIndex > jsonSkipIndex, 'urlencoded parser must remain after JSON parser skip');
    assert.ok(urlencodedSkipIndex > urlencodedIndex, 'urlencoded parser must skip guest webhooks');
});

function requestJson({ port, path: requestPath, body, contentType = 'application/json' }) {
    return new Promise((resolve, reject) => {
        const payload = Buffer.from(body);
        const request = http.request({
            port,
            method: 'POST',
            path: requestPath,
            headers: {
                'Content-Type': contentType,
                'Content-Length': payload.length
            }
        }, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve({
                statusCode: response.statusCode,
                headers: response.headers,
                body: Buffer.concat(chunks).toString('utf8')
            }));
        });
        request.on('error', reject);
        request.end(payload);
    });
}

test('capture middleware preserves signed bytes/content type and leaves ordinary JSON routes parsed', async () => {
    const app = express();
    app.use(captureGuestShopWebhookRawBody({ maxBytes: 1024 }));
    const jsonParser = express.json();
    app.use((req, res, next) => {
        if (isGuestShopWebhookRequest(req)) return next();
        return jsonParser(req, res, next);
    });
    app.post('/api/shop/guest/webhooks/zpay', (req, res) => {
        res.json({
            rawBody: req.rawBody?.toString('utf8') || '',
            bodyType: Buffer.isBuffer(req.body) ? 'buffer' : typeof req.body,
            contentType: req.headers['content-type']
        });
    });
    app.post('/api/shop/guest/orders', (req, res) => res.json({ body: req.body }));
    app.use((error, _req, res, _next) => res.status(error.statusCode || error.status || 500).json({
        code: error.code || 'error'
    }));

    const server = await new Promise((resolve) => {
        const instance = app.listen(0, () => resolve(instance));
    });
    try {
        const signedBody = 'money=1.20&out_trade_no=GS%2B001&sign=a%2Bb';
        const webhookResponse = await requestJson({
            port: server.address().port,
            path: '/api/shop/guest/webhooks/zpay',
            body: signedBody,
            contentType: 'application/x-www-form-urlencoded; charset=UTF-8'
        });
        assert.equal(webhookResponse.statusCode, 200);
        const webhookPayload = JSON.parse(webhookResponse.body);
        assert.equal(webhookPayload.rawBody, signedBody);
        assert.equal(webhookPayload.bodyType, 'undefined');
        assert.equal(webhookPayload.contentType, 'application/x-www-form-urlencoded; charset=UTF-8');

        const ordinaryResponse = await requestJson({
            port: server.address().port,
            path: '/api/shop/guest/orders',
            body: JSON.stringify({ sku: 'demo', quantity: 1 })
        });
        assert.equal(ordinaryResponse.statusCode, 200);
        assert.deepEqual(JSON.parse(ordinaryResponse.body).body, { sku: 'demo', quantity: 1 });
    } finally {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
});

test('capture middleware returns a 413 error for oversized bodies', async () => {
    const app = express();
    app.use(captureGuestShopWebhookRawBody({ maxBytes: 4 }));
    app.post('/api/shop/guest/webhooks/nowpayments', (_req, res) => res.status(500).end('handler reached'));
    app.use((error, _req, res, _next) => res.status(error.statusCode || error.status || 500).json({
        code: error.code || 'error'
    }));
    const server = await new Promise((resolve) => {
        const instance = app.listen(0, () => resolve(instance));
    });
    try {
        const response = await requestJson({
            port: server.address().port,
            path: '/api/shop/guest/webhooks/nowpayments',
            body: '12345',
            contentType: 'application/json'
        });
        assert.equal(response.statusCode, 413);
        assert.equal(JSON.parse(response.body).code, 'payload_too_large');
    } finally {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
});
