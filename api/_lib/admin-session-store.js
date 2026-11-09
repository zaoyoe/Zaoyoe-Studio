// Call only after Auth getUser has verified the bearer JWT. Decoding is not authentication.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function sessionError(unavailable = false) {
    return Object.assign(new Error(unavailable ? 'Admin session service unavailable' : 'Admin login session expired'),
        { statusCode: unavailable ? 503 : 401, code: unavailable ? 'admin_session_unavailable' : 'admin_session_expired' });
}
function verifiedBearerSession(token, userId) {
    try {
        if (typeof token !== 'string' || token.length > 16384 || token.split('.').length !== 3) throw sessionError();
        const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
        if (!UUID.test(userId) || claims.sub !== userId || !UUID.test(claims.session_id || '')
            || !Number.isSafeInteger(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) throw sessionError();
        return { userId, sourceSessionId: claims.session_id, expiresAt: claims.exp };
    } catch (_) { throw sessionError(); }
}
async function callSessionRpc(supabase, name, params) {
    try {
        const { data, error } = await supabase.rpc(name, params);
        if (error) throw sessionError(true);
        return data;
    } catch (_) { throw sessionError(true); }
}
async function requireActiveBearerSession(supabase, token, userId) {
    const session = verifiedBearerSession(token, userId);
    const active = await callSessionRpc(supabase, 'admin_auth_session_active', {
        p_user_id: userId, p_source_session_id: session.sourceSessionId
    });
    if (active !== true) throw sessionError();
    return session;
}
async function validateStudioSession(supabase, payload) {
    const active = await callSessionRpc(supabase, 'admin_studio_session_active', {
        p_id: payload.sid, p_user_id: payload.sub, p_expires_at: new Date(payload.exp * 1000).toISOString()
    });
    if (active !== true) throw sessionError();
}
module.exports = { sessionError, verifiedBearerSession, callSessionRpc, requireActiveBearerSession, validateStudioSession };
