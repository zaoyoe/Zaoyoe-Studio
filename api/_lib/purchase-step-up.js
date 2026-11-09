'use strict';

// This client is freshly created for this verification, without a bearer header.
// Never return/log the session or reuse it as a database client.
async function verifyPurchasePassword({ user, password, captchaToken = '', createClient } = {}) {
    if (typeof password !== 'string' || !password.length || password.length > 4096) {
        return { ok: false, status: 401, code: 'step_up_password_invalid' };
    }
    if (!user?.id || !user.email || typeof createClient !== 'function') {
        return { ok: false, status: 503, code: 'step_up_unavailable' };
    }
    try {
        const client = createClient();
        if (typeof client?.auth?.signInWithPassword !== 'function') {
            return { ok: false, status: 503, code: 'step_up_unavailable' };
        }
        const result = await client.auth.signInWithPassword({
            email: user.email, password,
            ...(typeof captchaToken === 'string' && captchaToken.length <= 4096 && captchaToken
                ? { options: { captchaToken } } : {})
        });
        // This verification creates a temporary Auth session. Revoke only that session.
        if (result?.data?.session && typeof client.auth.signOut === 'function') {
            try { await client.auth.signOut({ scope: 'local' }); } catch (_) { /* No session is exposed to the caller. */ }
        }
        if (result?.error || result?.data?.user?.id !== user.id) {
            return { ok: false, status: 401, code: 'step_up_password_invalid' };
        }
        return { ok: true };
    } catch (_) {
        return { ok: false, status: 503, code: 'step_up_unavailable' };
    }
}

module.exports = { verifyPurchasePassword };
