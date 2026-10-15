'use strict';

function isChatGptAuthFailure(error, status) {
    const code = error?.code;
    return ['CHATGPT_SESSION_EXPIRED', 'CHECKOUT_AUTH_ERROR'].includes(code)
        || Number(status ?? error?.httpStatus ?? error?.status) === 401
        || /\[(?:CHATGPT_SESSION_EXPIRED|CHECKOUT_AUTH_ERROR)\]|\b(?:token_expired|invalid_token|expired_token|session_expired)\b|(?:authentication|access) token has expired|your session has expired/i.test(String(error?.message ?? error ?? ''));
}

function buildChatGptAuthError(code = 'CHATGPT_SESSION_EXPIRED') {
    const messages = {
        CHATGPT_SESSION_EXPIRED: 'Session 已失效或过期，请重新登录 ChatGPT 并获取最新 Session 后重试',
        CHATGPT_AUTH_UNCONFIRMED: '无法确认官方账号鉴权状态，已停止充值',
        CHATGPT_ACCOUNT_MISMATCH: '官方确认的账号与提交凭证中的账号不一致，已停止充值'
    };
    return Object.assign(new Error(`${messages[code]} [${code}]`), { code });
}

function assertLocalSessionFresh(accessToken, sessionJson = {}, now = Date.now()) {
    let payload;
    try { payload = JSON.parse(Buffer.from(String(accessToken).split('.')[1], 'base64url').toString('utf8')); } catch (_) { /* opaque credentials require online verification */ }
    const exp = Number(payload?.exp);
    const sessionExpiry = Date.parse(sessionJson?.expires);
    if ((Number.isFinite(exp) && exp * 1000 <= now) || (Number.isFinite(sessionExpiry) && sessionExpiry <= now)) {
        throw buildChatGptAuthError();
    }
    // An unexpired timestamp is only an input check, never proof of authentication.
}

async function verifyChatGptAccessToken(page, accessToken) {
    let result;
    let timeout;
    try {
        result = await Promise.race([page.evaluate(async (token) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 10000);
            try {
                // This endpoint is read only and is never fulfilled by the Session bootstrap patch.
                const response = await fetch('/backend-api/me', {
                    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
                    credentials: 'include', cache: 'no-store', redirect: 'error', signal: controller.signal
                });
                const text = await response.text();
                let data;
                try { if (text.length <= 32768) data = JSON.parse(text); } catch (_) { /* no identity */ }
                return {
                    status: response.status,
                    expired: (response.status !== 200 || !data?.id)
                        && /\b(?:token_expired|invalid_token|expired_token|session_expired)\b|authentication token has expired/i.test(text),
                    id: typeof data?.id === 'string' ? data.id : '',
                    email: typeof data?.email === 'string' ? data.email : ''
                };
            } finally { clearTimeout(timer); }
        }, accessToken), new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Official auth verification deadline')), 12000);
        })]);
    } catch (_) {
        throw buildChatGptAuthError('CHATGPT_AUTH_UNCONFIRMED');
    } finally { clearTimeout(timeout); }
    if (result?.expired || isChatGptAuthFailure(null, result?.status)) throw buildChatGptAuthError();
    if (result?.status !== 200 || !result.id) throw buildChatGptAuthError('CHATGPT_AUTH_UNCONFIRMED');
    return result;
}

module.exports = { isChatGptAuthFailure, buildChatGptAuthError, assertLocalSessionFresh, verifyChatGptAccessToken };
