const {
    emitExternalMonitoringEventFailOpen,
    normalizeText,
    redactMonitoringPayload
} = require('../../../api/_lib/external-monitoring');

const MAX_CLIENT_EVENT_BODY_BYTES = 32 * 1024;

function sendJson(res, status, payload) {
    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
    if (req.body && typeof req.body === 'object') {
        return req.body;
    }

    const chunks = [];
    let total = 0;

    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.length;
        if (total > MAX_CLIENT_EVENT_BODY_BYTES) {
            const error = new Error('client monitoring event is too large');
            error.statusCode = 413;
            throw error;
        }
        chunks.push(buffer);
    }

    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) {
        return {};
    }

    try {
        return JSON.parse(raw);
    } catch (_) {
        const error = new Error('invalid JSON body');
        error.statusCode = 400;
        throw error;
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

async function clientMonitoringEventHandler(req, res) {
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

    try {
        const body = await readJsonBody(req);
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
            message: error?.message || 'Client monitoring event accepted with diagnostics only'
        });
    }
}

module.exports = {
    clientMonitoringEventHandler,
    normalizeClientEventBody,
    readJsonBody
};
