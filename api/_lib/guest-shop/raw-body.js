'use strict';

// Express on the verify-api host installs body parsers globally.  Guest
// payment signatures, however, are calculated over the exact wire bytes.  A
// small route-specific middleware keeps the bytes intact while bounding the
// amount of data an unauthenticated caller can make us buffer.

const DEFAULT_GUEST_WEBHOOK_BODY_LIMIT = 256 * 1024;
const MAX_GUEST_WEBHOOK_BODY_LIMIT = 4 * 1024 * 1024;
const GUEST_WEBHOOK_ROUTE_PATTERN = /^\/api\/shop\/guest\/webhooks\/(?:zpay|nowpayments)\/?$/u;
const GUEST_WORKER_ROUTE_PATTERN = /^\/api\/shop\/guest\/worker\/?$/u;

function requestPath(req = {}) {
    const source = String(req.path || req.originalUrl || req.url || '').trim();
    if (!source) return '';
    return source.split('?', 1)[0].replace(/\/{2,}/gu, '/').replace(/\/$/u, '') || '/';
}

function isGuestShopWebhookRequest(req = {}) {
    if (String(req.method || '').toUpperCase() !== 'POST') return false;
    const path = requestPath(req);
    if (GUEST_WEBHOOK_ROUTE_PATTERN.test(`${path}/`)) return true;

    // The server also supports the shared /api/public dispatcher.  Keep this
    // query form safe if a reverse proxy routes it to Express directly.
    if (path !== '/api/public') return false;
    const query = req.query && typeof req.query === 'object' ? req.query : {};
    if (String(query.scope || '').trim() !== 'shop') return false;
    return /^guest\/webhooks\/(?:zpay|nowpayments)$/u.test(String(query.route || '').trim());
}

/**
 * The worker endpoint accepts no request body.  Detect it before Express's
 * global parsers run so an unauthenticated caller cannot make the shared
 * dispatcher allocate a large JSON/form payload.
 */
function isGuestShopWorkerRequest(req = {}) {
    const path = requestPath(req);
    if (GUEST_WORKER_ROUTE_PATTERN.test(`${path}/`)) return true;
    if (path !== '/api/public') return false;
    const query = req.query && typeof req.query === 'object' ? req.query : {};
    return String(query.scope || '').trim() === 'shop'
        && String(query.route || '').trim() === 'guest/worker';
}

function guestWorkerRequestDeclaresBody(req = {}) {
    const headers = req?.headers && typeof req.headers === 'object' ? req.headers : {};
    const contentLengthRaw = headers['content-length'] ?? headers['Content-Length'];
    if (contentLengthRaw !== undefined && contentLengthRaw !== null) {
        const contentLength = String(Array.isArray(contentLengthRaw) ? contentLengthRaw[0] : contentLengthRaw).trim();
        // Any malformed or non-zero length is treated as a body.  The worker
        // contract is intentionally bodyless, so fail closed instead of
        // guessing what a proxy meant.
        if (!/^0$/u.test(contentLength)) return true;
    }
    const transferEncoding = headers['transfer-encoding'] ?? headers['Transfer-Encoding'];
    return Boolean(String(transferEncoding || '').trim());
}

function bodyLimitError() {
    const error = new Error('请求体过大');
    error.status = 413;
    error.statusCode = 413;
    error.type = 'entity.too.large';
    error.code = 'payload_too_large';
    return error;
}

function rawBodyUnavailableError() {
    const error = new Error('无法读取回调原始请求体');
    error.status = 400;
    error.statusCode = 400;
    error.code = 'guest_webhook_raw_body_unavailable';
    return error;
}

function invalidBodyLimitError() {
    const error = new Error('guest webhook body limit configuration is invalid');
    error.status = 503;
    error.statusCode = 503;
    error.code = 'guest_body_limit_invalid';
    error.expose = false;
    error.configName = 'maxBytes';
    return error;
}

function parseMaxBytes(value, fallback = DEFAULT_GUEST_WEBHOOK_BODY_LIMIT) {
    const candidate = value === undefined ? fallback : value;
    let parsed;
    if (typeof candidate === 'number') {
        parsed = candidate;
    } else if (typeof candidate === 'string' && /^\d+$/u.test(candidate.trim())) {
        parsed = Number(candidate.trim());
    } else {
        throw invalidBodyLimitError();
    }
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_GUEST_WEBHOOK_BODY_LIMIT) {
        throw invalidBodyLimitError();
    }
    return parsed;
}

async function readRequestRawBody(req, { maxBytes = DEFAULT_GUEST_WEBHOOK_BODY_LIMIT } = {}) {
    const limit = parseMaxBytes(maxBytes);
    const contentLength = Number.parseInt(String(req?.headers?.['content-length'] || ''), 10);
    if (Number.isFinite(contentLength) && contentLength > limit) throw bodyLimitError();

    if (!req || typeof req[Symbol.asyncIterator] !== 'function') {
        throw rawBodyUnavailableError();
    }

    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        let buffer;
        if (Buffer.isBuffer(chunk)) buffer = chunk;
        else if (chunk instanceof Uint8Array) buffer = Buffer.from(chunk);
        else if (typeof chunk === 'string') buffer = Buffer.from(chunk, 'utf8');
        else throw rawBodyUnavailableError();
        total += buffer.length;
        if (total > limit) throw bodyLimitError();
        chunks.push(buffer);
    }
    return Buffer.concat(chunks, total);
}

function captureGuestShopWebhookRawBody({ maxBytes = DEFAULT_GUEST_WEBHOOK_BODY_LIMIT } = {}) {
    const limit = parseMaxBytes(maxBytes);
    return (req, res, next) => {
        if (!isGuestShopWebhookRequest(req) || req.rawBody !== undefined) return next();
        readRequestRawBody(req, { maxBytes: limit })
            .then((rawBody) => {
                req.rawBody = rawBody;
                next();
            })
            .catch(next);
    };
}

module.exports = {
    DEFAULT_GUEST_WEBHOOK_BODY_LIMIT,
    MAX_GUEST_WEBHOOK_BODY_LIMIT,
    GUEST_WEBHOOK_ROUTE_PATTERN,
    GUEST_WORKER_ROUTE_PATTERN,
    requestPath,
    isGuestShopWebhookRequest,
    isGuestShopWorkerRequest,
    guestWorkerRequestDeclaresBody,
    invalidBodyLimitError,
    parseMaxBytes,
    readRequestRawBody,
    captureGuestShopWebhookRawBody,
    bodyLimitError
};
