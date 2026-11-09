'use strict';
const crypto = require('node:crypto');
const MAX_CAPTCHA_STATES = 128;
const CAPTCHA_TTL_MS = 5 * 60_000;
const validJobKey = key => typeof key === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(key);
function createInternalCaptchaAuth(token) {
    if (typeof token !== 'string' || Buffer.byteLength(token) < 32) throw new Error('Invalid internal captcha key');
    const expected = crypto.createHash('sha256').update(token).digest();
    return (req, res, next) => {
        const ip = req.socket?.remoteAddress;
        const supplied = req.headers?.['x-kc-internal-token'];
        const ok = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)
            && typeof supplied === 'string' && supplied.length <= 256
            && crypto.timingSafeEqual(expected, crypto.createHash('sha256').update(supplied).digest());
        res.setHeader('Cache-Control', 'no-store');
        return ok ? next() : res.status(403).json({ success: false, message: 'Internal access denied' });
    };
}
function validPrompt(body = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
    if (!validJobKey(body.jobKey)) return false;
    if (body.image && (typeof body.image !== 'string' || body.image.length > 1_500_000
        || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(body.image))) return false;
    if (!body.image && body.loading !== true) return false;
    for (const key of ['title', 'message', 'promptZh', 'promptEn']) {
        if (body[key] !== undefined && (typeof body[key] !== 'string' || body[key].length > 2000)) return false;
    }
    for (const key of ['width', 'height']) {
        if (body[key] !== undefined && (!Number.isInteger(body[key]) || body[key] < 0 || body[key] > 8192)) return false;
    }
    return body.expiresAt === undefined || (Number.isFinite(body.expiresAt) && body.expiresAt > Date.now());
}
function expireStates(states, now = Date.now()) {
    for (const [key, state] of states) {
        if ((state.expiresAt || state.updatedAt + CAPTCHA_TTL_MS) > now) continue;
        for (const waiter of state.waitingRequests || []) {
            clearTimeout(waiter.timer);
            if (!waiter.res.headersSent) waiter.res.json({ success: true, clicked: false, cancelled: true });
        }
        states.delete(key);
    }
}
module.exports = { createInternalCaptchaAuth, validJobKey, validPrompt, expireStates, MAX_CAPTCHA_STATES, CAPTCHA_TTL_MS };
