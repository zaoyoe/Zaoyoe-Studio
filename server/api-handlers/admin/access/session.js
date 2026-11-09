const { randomUUID } = require('node:crypto');
const {
    requireAdmin, getAuthenticatedUser, getAdminStudioCookiePayload,
    getSupabaseAdmin, sendJson, writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const { callSessionRpc, verifiedBearerSession, sessionError } = require('../../../../api/_lib/admin-session-store');
const { resolveClientIp, _private: { isProductionLikeRuntime } } = require('../../../../api/_lib/request-security');

const ADMIN_ORIGINS = new Set([
    'https://fatherkey.com', 'https://www.fatherkey.com',
    'https://zaoyoe.xyz', 'https://www.zaoyoe.xyz',
    'https://zaoyoe.com', 'https://www.zaoyoe.com',
    'https://tg-adm.fatherkey.com'
]);
function requestPolicy(req, env = process.env) {
    const origin = String(req.headers?.origin || '').trim();
    let localHttp = false;
    if (!isProductionLikeRuntime(env) && String(env.NODE_ENV || '').toLowerCase() !== 'production') {
        try {
            const url = new URL(origin);
            const protocol = req.socket?.encrypted === true ? 'https:' : 'http:';
            localHttp = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
                && url.origin === origin && url.origin === `${protocol}//${req.headers?.host || ''}`;
            if (localHttp) return { secure: protocol !== 'http:' };
        } catch (_) { /* Reject missing and malformed origins. */ }
    }
    // Browser origins are explicit; the reverse proxy's upstream Host may differ.
    if (!ADMIN_ORIGINS.has(origin)) {
        throw Object.assign(new Error('Admin request origin required'), { statusCode: 403, code: 'admin_origin_required' });
    }
    return { secure: true };
}

module.exports = async function adminAccessSessionHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
        const method = String(req.method || 'GET').toUpperCase();
        if (!['POST', 'DELETE'].includes(method)) {
            res.setHeader('Allow', 'POST, DELETE');
            return sendJson(res, 405, { success: false, message: 'Method not allowed' });
        }
        const { secure } = requestPolicy(req);
        const helpers = await import('../../../../api/_lib/admin-studio-access.mjs');
        if (method === 'DELETE') {
            // Revoke both identities when a tab has changed accounts while an old
            // Cookie is still present. Role loss must never prevent self-revocation.
            const cookie = await getAdminStudioCookiePayload(req);
            const targets = [];
            if (cookie) targets.push({ p_user_id: cookie.sub, p_id: cookie.sid, p_source_session_id: null });
            const auth = await getAuthenticatedUser(req, { bearerOnly: true });
            if (auth.error?.statusCode === 503) throw sessionError(true);
            if (auth.user && auth.token) {
                const source = verifiedBearerSession(auth.token, auth.user.id);
                targets.push({ p_user_id: source.userId, p_id: null, p_source_session_id: source.sourceSessionId });
            }
            for (const target of targets) {
                const revoked = await callSessionRpc(getSupabaseAdmin(), 'admin_studio_session_revoke', target);
                if (revoked !== true) throw sessionError(true);
            }
            res.setHeader('Set-Cookie', helpers.buildClearAdminStudioCookie({ secure }));
            return sendJson(res, 200, { success: true, cleared: true });
        }

        const { user, supabase, adminSupabase, adminSession } = await requireAdmin(req, { bearerOnly: true });
        if (!adminSession) throw sessionError();
        const now = Math.floor(Date.now() / 1000);
        const exp = Math.min(now + helpers.getAdminStudioTtlSeconds(), adminSession.expiresAt);
        if (exp <= now) throw sessionError();
        const sid = randomUUID();
        const store = adminSupabase || supabase;
        const created = await callSessionRpc(store, 'admin_studio_session_create', {
            p_id: sid, p_user_id: user.id, p_source_session_id: adminSession.sourceSessionId,
            p_expires_at: new Date(exp * 1000).toISOString()
        });
        if (created !== true) throw sessionError();
        try {
            const token = await helpers.issueAdminStudioToken({ sub: user.id, sid, exp });
            const audited = await writeAdminAuditLog({
                supabase, adminId: user.id, actionType: 'admin.access.session.issue',
                details: {
                    client_ip: resolveClientIp(req, { env: process.env }) || null,
                    user_agent: String(req.headers?.['user-agent'] || '').slice(0, 512) || null,
                    origin: String(req.headers?.origin || ''), granted: true
                }
            });
            if (audited !== true) throw sessionError(true);
            res.setHeader('Set-Cookie', helpers.buildAdminStudioSetCookie(token, { secure, maxAge: exp - now }));
            return sendJson(res, 200, { success: true, granted: true, expiresInSeconds: exp - now });
        } catch (error) {
            // Revoke just this failed grant; a failed audit must never log the user out globally.
            try {
                await callSessionRpc(store, 'admin_studio_session_discard', { p_id: sid, p_user_id: user.id });
            } catch (_) { /* No Cookie was issued; all sessions are bounded by expiry. */ }
            throw error;
        }
    } catch (error) {
        const statusCode = [401, 403, 415, 503].includes(Number(error?.statusCode)) ? Number(error.statusCode) : 500;
        return sendJson(res, statusCode, {
            success: false,
            code: statusCode >= 500 ? 'admin_session_unavailable' : error?.code,
            message: statusCode >= 500 ? 'Admin session service unavailable' : error?.message || 'Admin access denied'
        });
    }
};
