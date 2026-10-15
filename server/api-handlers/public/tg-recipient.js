'use strict';

const crypto = require('node:crypto');
const sharedRequestSecurity = require('../../../api/_lib/request-security');
const { _private: { allowedOrigin, sendJson } } = require('./tg');
const { createTelegramProfileClient, normalizeUsername } = require('../../tg/recipient-profile');

const ERRORS = Object.freeze({
    invalid_username: { status: 400, message: '请输入正确的 Telegram 用户名' },
    recipient_not_found: { status: 404, message: '未找到公开账号资料，请检查用户名' },
    recipient_timeout: { status: 504, message: '账号资料加载超时，请稍后重试' },
    recipient_unavailable: { status: 503, message: '暂时无法加载账号资料，请稍后重试' }
});

function createTgRecipientHandler({ admin, env = process.env, requestSecurity = sharedRequestSecurity, profileClient = createTelegramProfileClient() } = {}) {
    return async function recipient(req, res) {
        if (String(req.method || '').toUpperCase() !== 'GET') {
            res.setHeader('Allow', 'GET');
            return sendJson(res, 405, { success: false, message: 'Method not allowed' });
        }
        try {
            if (!allowedOrigin(req, env)) return sendJson(res, 403, { success: false, code: 'origin_denied', message: '当前请求来源不可用' });
            const params = new URL(req.url || '/', 'http://tg.internal').searchParams;
            if (params.getAll('username').length !== 1) throw Object.assign(new Error(), { code: 'invalid_username' });
            const username = normalizeUsername(params.get('username'));
            const ip = requestSecurity.resolveClientIp(req, { env }) || 'unknown';
            const rate = await requestSecurity.takeRateLimitToken({
                supabase: admin?.getOptionalSupabaseAdmin?.(), env,
                key: `tg:recipient:ip:${crypto.createHash('sha256').update(ip).digest('hex')}`,
                limit: 30, windowMs: 60_000,
                requirePersistent: requestSecurity._private.isProductionLikeRuntime(env)
            });
            requestSecurity.applyRateLimitHeaders(res, rate);
            if (!rate.allowed) return sendJson(res, rate.unavailable ? 503 : 429, {
                success: false, code: rate.unavailable ? 'security_unavailable' : 'rate_limited',
                message: rate.unavailable ? '账号查询暂不可用，请稍后重试' : '查询过于频繁，请稍后重试'
            });
            const recipient = await profileClient.lookup(username);
            return sendJson(res, 200, { success: true, recipient });
        } catch (error) {
            const code = Object.hasOwn(ERRORS, error?.code) ? error.code : 'recipient_unavailable';
            return sendJson(res, ERRORS[code].status, { success: false, code, message: ERRORS[code].message });
        }
    };
}

module.exports = { createTgRecipientHandler };
