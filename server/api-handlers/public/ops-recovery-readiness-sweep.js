const crypto = require('crypto');
const {
    runRecoveryReadinessSweep
} = require('../../../api/_lib/recovery-readiness-sweep');

const SECRET_ENV_NAMES = Object.freeze([
    'RECOVERY_READINESS_CRON_SECRET',
    'CRON_SECRET'
]);
const SECRET_HEADER_NAMES = Object.freeze([
    'x-recovery-readiness-cron-secret',
    'x-cron-secret'
]);

function sendJson(res, status, payload) {
    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.end(JSON.stringify(payload));
}

function normalizeSecret(value = '') {
    return String(value || '').trim();
}

function getHeader(req, name) {
    const headers = req?.headers || {};
    const target = String(name || '').toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (String(key || '').toLowerCase() === target) {
            return Array.isArray(value) ? value[0] : value;
        }
    }
    return '';
}

function getExpectedSecret(env = process.env) {
    for (const name of SECRET_ENV_NAMES) {
        const value = normalizeSecret(env?.[name]);
        if (value) return value;
    }
    return '';
}

function getProvidedSecret(req) {
    const authorization = normalizeSecret(getHeader(req, 'authorization'));
    const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
    if (bearerMatch) {
        return normalizeSecret(bearerMatch[1]);
    }

    for (const headerName of SECRET_HEADER_NAMES) {
        const value = normalizeSecret(getHeader(req, headerName));
        if (value) return value;
    }
    return '';
}

function constantTimeEqual(left, right) {
    const normalizedLeft = normalizeSecret(left);
    const normalizedRight = normalizeSecret(right);
    if (!normalizedLeft || !normalizedRight) return false;

    const leftBuffer = Buffer.from(normalizedLeft);
    const rightBuffer = Buffer.from(normalizedRight);
    if (leftBuffer.length !== rightBuffer.length) return false;
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function hasCronAccess(req, env = process.env) {
    const expectedSecret = getExpectedSecret(env);
    if (!expectedSecret) {
        return {
            ok: false,
            status: 503,
            reason: 'cron_secret_not_configured'
        };
    }

    if (!constantTimeEqual(getProvidedSecret(req), expectedSecret)) {
        return {
            ok: false,
            status: 401,
            reason: 'invalid_cron_secret'
        };
    }

    return {
        ok: true,
        status: 200,
        reason: 'authorized'
    };
}

function resolveOptionalSupabaseAdmin(admin) {
    if (typeof admin?.getOptionalSupabaseAdmin === 'function') {
        return admin.getOptionalSupabaseAdmin();
    }

    try {
        return typeof admin?.getSupabaseAdmin === 'function'
            ? admin.getSupabaseAdmin()
            : null;
    } catch (_) {
        return null;
    }
}

function createRecoveryReadinessSweepHandler({
    admin,
    env = process.env,
    sweep = runRecoveryReadinessSweep
} = {}) {
    return async function recoveryReadinessSweepHandler(req, res) {
        if (req.method === 'OPTIONS') {
            res.setHeader('Allow', 'GET, POST, OPTIONS');
            return sendJson(res, 204, {});
        }

        if (!['GET', 'POST'].includes(String(req.method || '').toUpperCase())) {
            res.setHeader('Allow', 'GET, POST, OPTIONS');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const access = hasCronAccess(req, env);
        if (!access.ok) {
            return sendJson(res, access.status, {
                success: false,
                message: access.reason === 'cron_secret_not_configured'
                    ? 'Recovery readiness cron secret is not configured'
                    : 'Unauthorized',
                reason: access.reason
            });
        }

        try {
            const supabase = resolveOptionalSupabaseAdmin(admin);
            const payload = await sweep(supabase, { env });
            return sendJson(res, 200, {
                ...payload,
                accepted: true,
                protected_by: 'cron_secret',
                runtime_dependency: 'none',
                pro_fallback: true
            });
        } catch (error) {
            return sendJson(res, 202, {
                success: true,
                accepted: true,
                status: 'unavailable_fallback',
                runtime_dependency: 'none',
                pro_fallback: true,
                message: error?.message || 'Recovery readiness sweep accepted with fallback'
            });
        }
    };
}

module.exports = {
    createRecoveryReadinessSweepHandler,
    getExpectedSecret,
    getProvidedSecret,
    hasCronAccess
};
