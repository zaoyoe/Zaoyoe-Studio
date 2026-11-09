'use strict';
const crypto = require('node:crypto');
const auth = require('./admin-auth');
const qrcode = require('./lib/qrcode-generator');
const STEP_UP_TTL_MS = 5 * 60_000;
const challenges = new Map();
const digest = value => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const failure = (res, status, message, code) => res.status(status).json({ success: false, message, code });

function createAdminSecurity({ store, ensureStoreReady, sendTelegramLoginCode }) {
    async function challenge(req, res) {
        const meta = auth.getClientMeta(req);
        if (!auth.checkLoginRateLimit(`${meta.ip}:step-up`).allowed) return failure(res, 429, '验证过于频繁，请稍后重试');
        try {
            await ensureStoreReady();
            const config = await store.getAdminAuthConfig();
            if (config.passwordVersion !== req.admin.pv) return failure(res, 403, '登录状态已变更');
            const password = req.body?.password;
            if (typeof password !== 'string' || password.length > 1024 || !auth.verifyPassword(password, config.passwordHash)) {
                return failure(res, 401, '登录密码错误');
            }
            const methods = auth.resolveLogin2faMethods(config, await store.getTelegramConfig());
            // A configured factor must never silently disappear from the step-up policy.
            if (config.totpEnabled && !config.totpSecret) return failure(res, 503, '验证配置异常');
            const method = methods.includes('totp') ? 'totp' : (methods[0] || '');
            const now = Date.now();
            for (const [id, item] of challenges) if (item.exp <= now) challenges.delete(id);
            if (challenges.size >= 128) return failure(res, 429, '待验证请求过多');
            const id = crypto.randomBytes(24).toString('hex');
            const code = method === 'telegram' ? auth.generateTelegramLoginCode() : '';
            challenges.set(id, { binding: digest(req.adminToken), ip: meta.ip, pv: config.passwordVersion,
                exp: now + STEP_UP_TTL_MS, attempts: 0, method, code });
            if (method === 'telegram') {
                const sent = await sendTelegramLoginCode(store, code, { email: config.email, ip: meta.ip });
                if (!sent.ok) { challenges.delete(id); return failure(res, 503, 'Telegram 验证码发送失败'); }
            }
            res.setHeader('Cache-Control', 'no-store');
            return res.json({ success: true, challengeId: id, method });
        } catch (_) { return failure(res, 503, '安全验证暂时不可用'); }
    }
    async function verify(req, res) {
        const id = req.body?.challengeId;
        const item = typeof id === 'string' && challenges.get(id);
        const meta = auth.getClientMeta(req);
        if (!item || item.exp <= Date.now() || item.attempts >= 5
            || item.binding !== digest(req.adminToken) || item.ip !== meta.ip) return failure(res, 403, '验证已过期，请重新验证');
        item.attempts += 1; // Reserved before any await; concurrent guesses share the budget.
        try {
            const config = await store.getAdminAuthConfig();
            if (item.pv !== config.passwordVersion) return failure(res, 403, '登录状态已变更');
            const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
            const valid = item.method === 'totp' ? auth.verifyTotpCode(config.totpSecret, code)
                : item.method === 'telegram' ? /^\d{6}$/.test(code) && digest(code) === digest(item.code) : true;
            if (!valid) return failure(res, 403, '验证码错误');
            // Consume atomically after the async read: only one concurrent verifier may issue a proof.
            if (challenges.get(id) !== item || item.exp <= Date.now()) return failure(res, 403, '验证已使用或过期');
            challenges.delete(id);
            const issued = auth.issueSecondaryToken(config.passwordVersion, meta.ip, req.adminToken);
            res.setHeader('Cache-Control', 'no-store');
            return res.json({ success: true, secondaryToken: issued.token, expiresAt: issued.payload.exp });
        } catch (_) { return failure(res, 503, '安全验证暂时不可用'); }
    }
    async function setup(req, res) {
        try {
            const config = await store.getAdminAuthConfig();
            if (config.passwordVersion !== req.admin.pv) return failure(res, 403, '登录状态已变更');
            const secret = auth.generateTotpSecret();
            const pendingId = crypto.randomBytes(24).toString('hex');
            await store.savePendingAdminTotp({ secret, pendingId, binding: digest(req.adminToken),
                passwordVersion: config.passwordVersion, expiresAt: Date.now() + STEP_UP_TTL_MS });
            const qr = qrcode(0, 'M');
            qr.addData(auth.getTotpUri(config.email, secret)); qr.make();
            res.setHeader('Cache-Control', 'no-store');
            return res.json({ success: true, secret, pendingId, qrCodeUrl: qr.createDataURL(5, 20),
                message: '旧验证方式保持有效；扫描后输入新验证码确认，确认成功后需重新登录' });
        } catch (_) { return failure(res, 503, '绑定暂时不可用'); }
    }
    async function confirm(req, res) {
        try {
            const pending = await store.getPendingAdminTotp();
            if (!pending || pending.pendingId !== req.body?.pendingId || pending.binding !== digest(req.adminToken)
                || pending.expiresAt <= Date.now() || pending.passwordVersion !== req.admin.pv) return failure(res, 400, '待绑定验证已过期');
            if (!auth.checkLoginRateLimit(`${auth.getClientMeta(req).ip}:totp-confirm`).allowed) return failure(res, 429, '验证过于频繁');
            if (!auth.verifyTotpCode(pending.secret, req.body?.code)) return failure(res, 400, '新验证码错误');
            await store.commitPendingAdminTotp(pending);
            return res.json({ success: true, reauthenticate: true, message: 'Authenticator 已启用，请重新登录' });
        } catch (_) { return failure(res, 409, '安全配置已变化，请重新发起绑定'); }
    }
    return { challenge, verify, setup, confirm };
}
module.exports = { createAdminSecurity, digest, STEP_UP_TTL_MS };
