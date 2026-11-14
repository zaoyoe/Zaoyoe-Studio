'use strict';
const crypto = require('node:crypto');
const auth = require('./admin-auth');
const qrcode = require('./lib/qrcode-generator');
const webauthn = require('./webauthn-security');
const STEP_UP_TTL_MS = 5 * 60_000;
const challenges = new Map();
const webauthnChallenges = new Map();
const digest = value => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const failure = (res, status, message, code) => res.status(status).json({ success: false, message, code });
function rateLimitFailure(res, rate) {
    const retryAfterSec = Math.max(1, Number(rate.retryAfterSec) || 60);
    res.setHeader('Retry-After', String(retryAfterSec));
    return failure(res, 429, `验证过于频繁，请 ${retryAfterSec} 秒后再试`, 'STEP_UP_RATE_LIMITED');
}

function createAdminSecurity({ store, ensureStoreReady, sendTelegramLoginCode }) {
    async function challenge(req, res) {
        const meta = auth.getClientMeta(req);
        try {
            await ensureStoreReady();
            const config = await store.getAdminAuthConfig();
            if (config.passwordVersion !== req.admin.pv) return failure(res, 403, '登录状态已变更');
            const passwordRate = auth.checkLoginRateLimit(`${meta.ip}:step-up-password`);
            if (!passwordRate.allowed) return rateLimitFailure(res, passwordRate);
            const password = req.body?.password;
            if (typeof password !== 'string' || password.length > 1024 || !auth.verifyPassword(password, config.passwordHash)) {
                return failure(res, 401, '登录密码错误');
            }
            auth.clearLoginAttempts(passwordRate.key);
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
        const factorRate = item.method === 'totp' || item.method === 'telegram'
            ? auth.checkLoginRateLimit(`${meta.ip}:step-up-factor`) : null;
        if (factorRate && !factorRate.allowed) return rateLimitFailure(res, factorRate);
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
            if (factorRate) auth.clearLoginAttempts(factorRate.key);
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
    async function webauthnStatus(req, res) {
        try {
            await ensureStoreReady();
            const passkeys = typeof store.getAdminPasskeys === 'function' ? await store.getAdminPasskeys() : [];
            res.setHeader('Cache-Control', 'no-store');
            return res.json({
                success: true,
                enrolled: passkeys.length > 0,
                passkeys: passkeys.map(k => ({ id: k.id, name: k.name, createdAt: k.createdAt }))
            });
        } catch (_) {
            return failure(res, 503, 'Passkey 状态查询失败');
        }
    }
    async function webauthnRegisterOptions(req, res) {
        const meta = auth.getClientMeta(req);
        try {
            await ensureStoreReady();
            const config = await store.getAdminAuthConfig();
            if (config.passwordVersion !== req.admin?.pv) return failure(res, 403, '登录状态已变更');
            const now = Date.now();
            for (const [id, item] of webauthnChallenges) if (item.exp <= now) webauthnChallenges.delete(id);
            if (webauthnChallenges.size >= 128) return failure(res, 429, '待验证请求过多');

            const options = webauthn.createRegistrationOptions({
                rpId: webauthn.getRpId(req),
                userEmail: config.email,
                userId: config.email
            });
            webauthnChallenges.set(options.challenge, {
                type: 'register',
                binding: digest(req.adminToken),
                ip: meta.ip,
                pv: config.passwordVersion,
                exp: now + STEP_UP_TTL_MS
            });
            res.setHeader('Cache-Control', 'no-store');
            return res.json({ success: true, options });
        } catch (_) {
            return failure(res, 503, '初始化 Passkey 注册失败');
        }
    }
    async function webauthnRegisterConfirm(req, res) {
        const meta = auth.getClientMeta(req);
        const challenge = req.body?.challenge;
        const item = typeof challenge === 'string' && webauthnChallenges.get(challenge);
        if (!item || item.type !== 'register' || item.exp <= Date.now()
            || item.binding !== digest(req.adminToken) || item.ip !== meta.ip) {
            return failure(res, 403, '注册挑战已过期，请重试');
        }
        webauthnChallenges.delete(challenge);
        try {
            await ensureStoreReady();
            const config = await store.getAdminAuthConfig();
            if (item.pv !== config.passwordVersion) return failure(res, 403, '登录状态已变更');

            const verified = webauthn.verifyRegistration({
                expectedChallenge: challenge,
                expectedOrigin: webauthn.getExpectedOrigin(req),
                clientDataJSON: req.body?.clientDataJSON,
                publicKeySpki: req.body?.publicKeySpki,
                attestationObject: req.body?.attestationObject
            });

            const id = String(req.body?.id || '');
            if (!id) return failure(res, 400, '缺少凭据 ID');
            await store.saveAdminPasskey({
                id,
                publicKey: verified.publicKeyPem,
                name: String(req.body?.name || 'Mac Touch ID').slice(0, 64),
                createdAt: Date.now()
            });

            res.setHeader('Cache-Control', 'no-store');
            return res.json({ success: true, message: 'Mac Touch ID / Passkey 绑定成功' });
        } catch (err) {
            return failure(res, 400, err.message || 'Passkey 注册验证失败');
        }
    }
    async function webauthnChallenge(req, res) {
        const meta = auth.getClientMeta(req);
        try {
            await ensureStoreReady();
            const config = await store.getAdminAuthConfig();
            if (config.passwordVersion !== req.admin?.pv) return failure(res, 403, '登录状态已变更');

            const passkeys = typeof store.getAdminPasskeys === 'function' ? await store.getAdminPasskeys() : [];
            if (!passkeys.length) return failure(res, 400, '尚未绑定 Passkey', 'NO_PASSKEY');

            const now = Date.now();
            for (const [id, item] of webauthnChallenges) if (item.exp <= now) webauthnChallenges.delete(id);
            if (webauthnChallenges.size >= 128) return failure(res, 429, '待验证请求过多');

            const options = webauthn.createAuthenticationOptions({
                rpId: webauthn.getRpId(req),
                credentials: passkeys
            });
            webauthnChallenges.set(options.challenge, {
                type: 'auth',
                binding: digest(req.adminToken),
                ip: meta.ip,
                pv: config.passwordVersion,
                exp: now + STEP_UP_TTL_MS,
                attempts: 0
            });
            res.setHeader('Cache-Control', 'no-store');
            return res.json({ success: true, options });
        } catch (_) {
            return failure(res, 503, '安全验证暂时不可用');
        }
    }
    async function webauthnVerify(req, res) {
        const meta = auth.getClientMeta(req);
        const challenge = req.body?.challenge;
        const item = typeof challenge === 'string' && webauthnChallenges.get(challenge);
        if (!item || item.type !== 'auth' || item.exp <= Date.now() || item.attempts >= 5
            || item.binding !== digest(req.adminToken) || item.ip !== meta.ip) {
            return failure(res, 403, '验证已过期，请重新验证');
        }
        const rate = auth.checkLoginRateLimit(`${meta.ip}:step-up-passkey`);
        if (!rate.allowed) return rateLimitFailure(res, rate);
        item.attempts += 1;
        try {
            await ensureStoreReady();
            const config = await store.getAdminAuthConfig();
            if (item.pv !== config.passwordVersion) return failure(res, 403, '登录状态已变更');

            const passkeys = typeof store.getAdminPasskeys === 'function' ? await store.getAdminPasskeys() : [];
            const credId = String(req.body?.id || '');
            const passkey = passkeys.find(k => k.id === credId);
            if (!passkey) return failure(res, 403, '未找到对应的 Passkey 凭据');

            webauthn.verifyAuthentication({
                expectedChallenge: challenge,
                expectedRpId: webauthn.getRpId(req),
                expectedOrigin: webauthn.getExpectedOrigin(req),
                clientDataJSON: req.body?.clientDataJSON,
                authenticatorData: req.body?.authenticatorData,
                signature: req.body?.signature,
                storedPublicKeyPem: passkey.publicKey
            });

            webauthnChallenges.delete(challenge);
            auth.clearLoginAttempts(rate.key);
            const issued = auth.issueSecondaryToken(config.passwordVersion, meta.ip, req.adminToken);
            res.setHeader('Cache-Control', 'no-store');
            return res.json({ success: true, secondaryToken: issued.token, expiresAt: issued.payload.exp });
        } catch (err) {
            return failure(res, 403, err.message || '指纹验证失败');
        }
    }
    async function webauthnDelete(req, res) {
        try {
            await ensureStoreReady();
            const id = String(req.params.id || '');
            if (!id) return failure(res, 400, '缺少凭据 ID');
            await store.deleteAdminPasskey(id);
            res.setHeader('Cache-Control', 'no-store');
            return res.json({ success: true, message: '已移除该 Passkey' });
        } catch (_) {
            return failure(res, 503, '操作失败');
        }
    }
    return {
        challenge,
        verify,
        setup,
        confirm,
        webauthnStatus,
        webauthnRegisterOptions,
        webauthnRegisterConfirm,
        webauthnChallenge,
        webauthnVerify,
        webauthnDelete
    };
}
module.exports = { createAdminSecurity, digest, STEP_UP_TTL_MS };
