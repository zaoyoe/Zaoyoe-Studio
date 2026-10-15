'use strict';

const sharedAdmin = require('../../api/_lib/admin');
const { _private: { isProductionLikeRuntime } } = require('../../api/_lib/request-security');

const TG_ADMIN_ORIGIN = 'https://tg.adm.fatherkey.com';

function requireTgAdminWriteRequest(req, env = process.env) {
    const headers = req?.headers || {};
    const origin = String(headers.origin || headers.Origin || '').trim();
    let allowed = origin === TG_ADMIN_ORIGIN;
    if (!allowed && !isProductionLikeRuntime(env) && String(env.NODE_ENV || '').toLowerCase() !== 'production') {
        try {
            const parsed = new URL(origin);
            const host = String(headers.host || headers.Host || '').trim();
            const protocol = req.socket?.encrypted === true ? 'https:' : 'http:';
            allowed = ['localhost', '127.0.0.1'].includes(parsed.hostname)
                && parsed.origin === origin
                && parsed.origin === `${protocol}//${host}`;
        } catch (_) { /* A missing or malformed Origin is never trusted. */ }
    }
    if (!allowed) {
        throw Object.assign(new Error('TG 管理操作的请求来源无效'), { statusCode: 403, code: 'tg_admin_origin_required' });
    }
    const contentType = String(headers['content-type'] || headers['Content-Type'] || '').split(';', 1)[0].trim().toLowerCase();
    if (contentType !== 'application/json') {
        throw Object.assign(new Error('TG 管理操作仅接受 JSON 请求'), { statusCode: 415, code: 'tg_admin_json_required' });
    }
}

// TG is an independent administration domain. Its role namespace is not yet
// delegated to ordinary shop administrators, so the first release is limited
// to the existing, verified super-administrator role.
async function requireTgAdmin(req, admin = sharedAdmin) {
    const context = req.adminContext || await admin.requireAdmin(req);
    if (context?.isSuperAdmin !== true) {
        const error = new Error('仅超级管理员可以管理 Telegram 业务');
        error.statusCode = 403;
        error.code = 'tg_super_admin_required';
        throw error;
    }
    return context;
}

function secureAdminResponse(res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
}

function adminErrorResponse(admin, res, error, fallback) {
    const status = Number(error?.statusCode) || 500;
    return admin.sendJson(res, status, {
        success: false,
        code: status < 500 ? error?.code || undefined : 'tg_service_error',
        message: status < 500 ? error?.message || fallback : fallback
    });
}

module.exports = { requireTgAdmin, requireTgAdminWriteRequest, secureAdminResponse, adminErrorResponse };
