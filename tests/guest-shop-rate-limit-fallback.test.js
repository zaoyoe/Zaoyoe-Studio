'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createGuestShopHandlers } = require('../server/api-handlers/public/guest-shop');

function createResponse() {
    const state = { statusCode: 200, headers: {}, body: '' };
    return {
        setHeader(name, value) {
            state.headers[String(name).toLowerCase()] = value;
            return this;
        },
        status(code) {
            state.statusCode = code;
            return this;
        },
        end(body = '') {
            state.body = String(body);
            return this;
        },
        get statusCode() { return state.statusCode; },
        get payload() { return state.body ? JSON.parse(state.body) : null; }
    };
}

test('guest handlers fail closed in production when request security injection is missing', async () => {
    const handlers = createGuestShopHandlers({
        admin: {
            getOptionalSupabaseAdmin() { return null; },
            sendJson(res, status, payload) {
                res.status(status);
                res.end(JSON.stringify(payload));
            }
        },
        requestSecurity: {},
        env: { VERCEL_ENV: 'production' }
    });
    const res = createResponse();

    await handlers.preview({ method: 'GET', headers: {}, query: {} }, res);

    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.success, false);
    assert.equal(res.payload.code, 'rate_limit_unavailable');
});

test('guest handlers fail closed when the injected limiter throws before reading the request', async () => {
    let bodyRead = false;
    const handlers = createGuestShopHandlers({
        admin: {
            getOptionalSupabaseAdmin() { return null; },
            sendJson(res, status, payload) {
                res.status(status);
                res.end(JSON.stringify(payload));
            }
        },
        requestSecurity: {
            async takeRateLimitToken() {
                throw new Error('persistent limiter unavailable');
            },
            resolveClientIp() { return '198.51.100.10'; },
            applyRateLimitHeaders() {}
        },
        env: { VERCEL_ENV: 'production' }
    });
    const res = createResponse();
    const req = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        query: {},
        async *[Symbol.asyncIterator]() {
            bodyRead = true;
            yield Buffer.from('{"site":"cn"}');
        }
    };

    await handlers.orders(req, res);

    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.code, 'rate_limit_unavailable');
    assert.equal(bodyRead, false);
});

test('guest handlers reject malformed limiter results instead of treating them as allowed', async () => {
    const handlers = createGuestShopHandlers({
        admin: {
            getOptionalSupabaseAdmin() { return null; },
            sendJson(res, status, payload) {
                res.status(status);
                res.end(JSON.stringify(payload));
            }
        },
        requestSecurity: {
            async takeRateLimitToken() { return {}; },
            resolveClientIp() { return '198.51.100.10'; },
            applyRateLimitHeaders() {}
        },
        env: { APP_ENV: 'test' }
    });
    const res = createResponse();

    await handlers.preview({ method: 'GET', headers: {}, query: {} }, res);

    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.code, 'rate_limit_unavailable');
});

test('guest webhook rejects limiter failures before reading or auditing the raw callback', async () => {
    let bodyRead = false;
    const handlers = createGuestShopHandlers({
        admin: {
            getOptionalSupabaseAdmin() { return null; },
            sendJson(res, status, payload) {
                res.status(status);
                res.end(JSON.stringify(payload));
            }
        },
        requestSecurity: {
            async takeRateLimitToken() {
                throw new Error('persistent limiter unavailable');
            },
            resolveClientIp() { return '198.51.100.10'; },
            applyRateLimitHeaders() {}
        },
        env: { VERCEL_ENV: 'production' }
    });
    const res = createResponse();
    const req = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        query: {},
        async *[Symbol.asyncIterator]() {
            bodyRead = true;
            yield Buffer.from('{}');
        }
    };

    await handlers.webhook(req, res, 'zpay');

    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.code, 'rate_limit_unavailable');
    assert.equal(bodyRead, false);
});
