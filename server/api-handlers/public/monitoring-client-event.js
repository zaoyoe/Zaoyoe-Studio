const crypto = require('crypto');
const {
    emitExternalMonitoringEventFailOpen,
    normalizeText,
    redactMonitoringPayload
} = require('../../../api/_lib/external-monitoring');
const {
    applyRateLimitHeaders,
    isAllowedRequestOrigin,
    resolveClientIp,
    takeRateLimitToken
} = require('../../../api/_lib/request-security');

const MAX_CLIENT_EVENT_BODY_BYTES = 32 * 1024;
const CLIENT_EVENT_IP_LIMIT = 30;
const CLIENT_EVENT_IP_WINDOW_MS = 60 * 1000;
const CLIENT_EVENT_FINGERPRINT_LIMIT = 10;
const CLIENT_EVENT_FINGERPRINT_WINDOW_MS = 60 * 1000;
const clientEventRateLimitStore = new Map();

function sendJson(res, status, payload) {
    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.end(JSON.stringify(payload));
}

function createHttpError(statusCode, message, code) {
    const error = new Error(message);
    error.statusCode = statusCode;
    if (code) {
        error.code = code;
    }
    return error;
}

function buildClientEventFingerprint(body = {}) {
    const kind = normalizeText(body?.kind, 80).toLowerCase() || 'runtime_error';
    const message = normalizeText(body?.message, 160).toLowerCase() || '';
    const digest = crypto.createHash('sha256').update(`${kind}|${message}`).digest('hex').slice(0, 16);
    return `${kind}:${digest}`;
}

async function checkClientEventRateLimit(req, body, options = {}) {
    const store = options.rateLimitStore || clientEventRateLimitStore;
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
    const env = options.env || process.env;
    const resolved = resolveClientIp(req, { env });
    const clientIp = (typeof resolved === 'string' ? resolved : resolved?.ip) || 'unknown';

    const ipResult = await takeRateLimitToken({
        store,
        key: `client-event:ip:${clientIp}`,
        limit: Number(options.ipLimit) || CLIENT_EVENT_IP_LIMIT,
        windowMs: Number(options.ipWindowMs) || CLIENT_EVENT_IP_WINDOW_MS,
        now,
        env
    });

    if (!ipResult.allowed) {
        return ipResult;
    }

    const fingerprint = buildClientEventFingerprint(body);
    return takeRateLimitToken({
        store,
        key: `client-event:fp:${clientIp}:${fingerprint}`,
        limit: Number(options.fingerprintLimit) || CLIENT_EVENT_FINGERPRINT_LIMIT,
        windowMs: Number(options.fingerprintWindowMs) || CLIENT_EVENT_FINGERPRINT_WINDOW_MS,
        now,
        env
    });
}

async function readJsonBody(req) {
    const declaredLength = Number(req?.headers?.['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_CLIENT_EVENT_BODY_BYTES) {
        throw createHttpError(413, 'client monitoring event is too large', 'payload_too_large');
    }

    if (req.body && typeof req.body === 'object') {
        if (Array.isArray(req.body)) {
            throw createHttpError(400, 'invalid JSON body', 'invalid_json');
        }
        const serializedBytes = Buffer.byteLength(JSON.stringify(req.body), 'utf8');
        if (serializedBytes > MAX_CLIENT_EVENT_BODY_BYTES) {
            throw createHttpError(413, 'client monitoring event is too large', 'payload_too_large');
        }
        return req.body;
    }

    const chunks = [];
    let total = 0;

    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.length;
        if (total > MAX_CLIENT_EVENT_BODY_BYTES) {
            throw createHttpError(413, 'client monitoring event is too large', 'payload_too_large');
        }
        chunks.push(buffer);
    }

    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) {
        return {};
    }

    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw createHttpError(400, 'invalid JSON body', 'invalid_json');
        }
        return parsed;
    } catch (error) {
        if (error?.statusCode) {
            throw error;
        }
        throw createHttpError(400, 'invalid JSON body', 'invalid_json');
    }
}

function normalizeClientEventBody(body = {}) {
    const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const tags = redactMonitoringPayload({
        source: 'client',
        kind: normalizeText(source.kind, 80) || 'runtime_error',
        site: normalizeText(source.site, 40) || null,
        page: normalizeText(source.page, 160) || null,
        path: normalizeText(source.path, 240) || null,
        user_agent_family: normalizeText(source.userAgentFamily, 160) || null
    }, { maxDepth: 2 });
    const extra = redactMonitoringPayload({
        stack: normalizeText(source.stack, 4000) || null,
        filename: normalizeText(source.filename, 500) || null,
        lineno: Number.isFinite(Number(source.lineno)) ? Number(source.lineno) : null,
        colno: Number.isFinite(Number(source.colno)) ? Number(source.colno) : null,
        href: normalizeText(source.href, 500) || null,
        referrer: normalizeText(source.referrer, 500) || null,
        component: normalizeText(source.component, 160) || null,
        metadata: source.metadata && typeof source.metadata === 'object' ? source.metadata : null
    });

    return {
        type: 'frontend_runtime_error',
        level: normalizeText(source.level, 40) || 'error',
        message: normalizeText(source.message, 1000) || 'Frontend runtime error',
        tags,
        extra
    };
}

async function clientMonitoringEventHandler(req, res, options = {}) {
    if (req.method === 'OPTIONS') {
        res.setHeader('Allow', 'POST, OPTIONS');
        return sendJson(res, 204, {});
    }

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST, OPTIONS');
        return sendJson(res, 405, {
            success: false,
            message: 'Method not allowed'
        });
    }

    const originCheck = isAllowedRequestOrigin(req, {
        allowMissingOrigin: true,
        env: options?.env || process.env
    });
    if (!originCheck.allowed) {
        return sendJson(res, 403, {
            success: false,
            accepted: false,
            code: originCheck.reason || 'origin_forbidden',
            message: 'Forbidden origin'
        });
    }

    try {
        const body = await readJsonBody(req);
        if (!normalizeText(body?.message, 1000) && !normalizeText(body?.kind, 80)) {
            return sendJson(res, 400, {
                success: false,
                accepted: false,
                code: 'missing_event_payload',
                message: 'Client monitoring event requires message or kind'
            });
        }

        const rateLimitResult = await checkClientEventRateLimit(req, body, options);
        applyRateLimitHeaders(res, rateLimitResult);
        if (!rateLimitResult.allowed) {
            return sendJson(res, 429, {
                success: false,
                accepted: false,
                code: 'rate_limit_exceeded',
                message: 'Too many client monitoring events'
            });
        }

        const event = normalizeClientEventBody(body);
        const result = await emitExternalMonitoringEventFailOpen(event, {
            timeoutMs: 900
        });

        return sendJson(res, 202, {
            success: true,
            accepted: true,
            configured: result.configured,
            delivered: result.delivered
        });
    } catch (error) {
        const status = Number(error?.statusCode || 0) || 202;
        return sendJson(res, status >= 500 ? 202 : status, {
            success: status < 400,
            accepted: status < 400,
            code: error?.code || undefined,
            message: error?.message || 'Client monitoring event accepted with diagnostics only'
        });
    }
}

module.exports = {
    MAX_CLIENT_EVENT_BODY_BYTES,
    buildClientEventFingerprint,
    checkClientEventRateLimit,
    clientMonitoringEventHandler,
    normalizeClientEventBody,
    readJsonBody,
    _resetRateLimitStore: () => clientEventRateLimitStore.clear()
};
