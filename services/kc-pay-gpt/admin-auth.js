'use strict';

const crypto = require('crypto');
const { isIP } = require('node:net');

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const ADMIN_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const ADMIN_REFRESH_AFTER_MS = 60 * 60 * 1000;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SECONDARY_TOKEN_TTL_MS = 5 * 60 * 1000;
const TG_CODE_TTL_MS = 5 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 30 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const TG_CODE_MAX_ATTEMPTS = 5;

const loginAttempts = new Map();
const tgLoginCodes = new Map();
const loginChallenges = new Map();
const MAX_AUTH_ENTRIES = 4096;
const TG_SEND_COOLDOWN_MS = 60 * 1000;
let nextCleanupAt = 0;

function cleanupAuthState() {
    const now = Date.now();
    if (now < nextCleanupAt) return;
    nextCleanupAt = now + 60 * 1000;
    for (const [key, entry] of loginAttempts) {
        if (now >= Math.max(entry.firstAt + LOGIN_WINDOW_MS, entry.lockedUntil)) loginAttempts.delete(key);
    }
    for (const [key, entry] of loginChallenges) {
        if (now >= entry.payload.exp) { loginChallenges.delete(key); tgLoginCodes.delete(key); }
    }
    for (const [key, entry] of tgLoginCodes) {
        if (now >= entry.exp) tgLoginCodes.delete(key);
    }
}

function resolveAdminTokenSecret() {
    const secret = process.env.ADMIN_TOKEN_SECRET;
    if (typeof secret !== 'string' || Buffer.byteLength(secret.trim()) < 32 || Buffer.byteLength(secret) > 512) {
        throw new Error('ADMIN_TOKEN_SECRET must be explicitly configured with at least 32 bytes');
    }
    return secret;
}

function encodeBase64Url(input) {
    return Buffer.from(input)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function decodeBase64Url(input) {
    const normalized = String(input || '')
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(String(input || '').length / 4) * 4, '=');
    return Buffer.from(normalized, 'base64').toString('utf8');
}

function signPayload(encodedPayload, secret = resolveAdminTokenSecret()) {
    return crypto
        .createHmac('sha256', secret)
        .update(encodedPayload)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function safeEqualString(left, right) {
    const leftBuffer = Buffer.from(String(left));
    const rightBuffer = Buffer.from(String(right));
    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createPasswordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
    const parts = String(storedHash || '').split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') {
        return false;
    }
    const [, salt, expectedHash] = parts;
    const actualHash = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return safeEqualString(actualHash, expectedHash);
}

function issueSignedToken(payload, ttlMs, secret = resolveAdminTokenSecret()) {
    const now = Date.now();
    const body = {
        ...payload,
        iat: now,
        exp: now + ttlMs
    };
    const encodedPayload = encodeBase64Url(JSON.stringify(body));
    const signature = signPayload(encodedPayload, secret);
    return {
        token: `${encodedPayload}.${signature}`,
        payload: body
    };
}

function verifySignedToken(token, { expectedSub, secret = resolveAdminTokenSecret() } = {}) {
    if (typeof token !== 'string' || token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) {
        return null;
    }
    const [encodedPayload, signature] = token.split('.');
    if (!encodedPayload || !signature) {
        return null;
    }
    const expectedSignature = signPayload(encodedPayload, secret);
    if (!safeEqualString(signature, expectedSignature)) {
        return null;
    }
    try {
        const payload = JSON.parse(decodeBase64Url(encodedPayload));
        const maxTtl = { admin: ADMIN_TOKEN_TTL_MS, admin_login_challenge: CHALLENGE_TTL_MS, admin_secondary: SECONDARY_TOKEN_TTL_MS }[payload?.sub];
        if (!payload || !maxTtl || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp)
            || payload.iat > Date.now() + 30_000 || payload.exp <= payload.iat || payload.exp - payload.iat > maxTtl
            || Date.now() >= payload.exp || encodeBase64Url(JSON.stringify(payload)) !== encodedPayload) {
            return null;
        }
        if (expectedSub && payload.sub !== expectedSub) {
            return null;
        }
        return payload;
    } catch (_) {
        return null;
    }
}

function issueAdminToken(passwordVersion, email = '') {
    return issueSignedToken({
        sub: 'admin',
        permissions: ['admin'],
        pv: Math.max(1, Number(passwordVersion || 1)),
        email: String(email || '').trim().toLowerCase()
    }, ADMIN_TOKEN_TTL_MS);
}

function verifyAdminToken(token) {
    const payload = verifySignedToken(token, { expectedSub: 'admin' });
    if (!payload || !Number.isSafeInteger(payload.pv) || payload.pv < 1 || !Array.isArray(payload.permissions) || !payload.permissions.includes('admin')) {
        return null;
    }
    return payload;
}

function issueLoginChallenge({ email, passwordVersion, ip, fingerprint }) {
    cleanupAuthState();
    if (loginChallenges.size >= MAX_AUTH_ENTRIES) throw new Error('Too many pending login challenges');
    const challengeId = crypto.randomBytes(16).toString('hex');
    const issued = issueSignedToken({
        sub: 'admin_login_challenge',
        cid: challengeId,
        email: String(email || '').trim().toLowerCase(),
        pv: Math.max(1, Number(passwordVersion || 1)),
        ip: String(ip || '').slice(0, 45),
        fp: String(fingerprint || '').slice(0, 128)
    }, CHALLENGE_TTL_MS);
    loginChallenges.set(challengeId, { payload: issued.payload, attempts: 0, sends: 0, lastSentAt: 0 });
    return issued;
}

function verifyLoginChallenge(token) {
    const payload = verifySignedToken(token, { expectedSub: 'admin_login_challenge' });
    const entry = payload && loginChallenges.get(payload.cid);
    return entry && entry.attempts < LOGIN_MAX_ATTEMPTS
        && safeEqualString(JSON.stringify(entry.payload), JSON.stringify(payload)) ? payload : null;
}

function validateLoginChallenge(challenge, authConfig, clientMeta) {
    const entry = challenge && loginChallenges.get(challenge.cid);
    return Boolean(entry && Date.now() < entry.payload.exp
        && safeEqualString(JSON.stringify(entry.payload), JSON.stringify(challenge))
        && challenge.pv === authConfig.passwordVersion && challenge.email === normalizeEmail(authConfig.email)
        && challenge.ip === clientMeta.ip && challenge.fp === clientMeta.fingerprint);
}

function beginLoginChallengeAttempt(challenge, authConfig, clientMeta) {
    if (!validateLoginChallenge(challenge, authConfig, clientMeta)) return false;
    const entry = loginChallenges.get(challenge.cid);
    if (entry.attempts >= LOGIN_MAX_ATTEMPTS) return false;
    entry.attempts += 1;
    return true;
}

function consumeLoginChallenge(challenge, authConfig, clientMeta) {
    if (!validateLoginChallenge(challenge, authConfig, clientMeta)) return false;
    loginChallenges.delete(challenge.cid);
    tgLoginCodes.delete(challenge.cid);
    return true;
}

function reserveTelegramCodeSend(challenge) {
    const entry = challenge && loginChallenges.get(challenge.cid);
    const now = Date.now();
    if (!entry || now >= entry.payload.exp || entry.attempts >= LOGIN_MAX_ATTEMPTS || entry.sends >= 3) return false;
    if (entry.sends > 0 && now - entry.lastSentAt < TG_SEND_COOLDOWN_MS) return false;
    entry.sends += 1;
    entry.lastSentAt = now;
    return true;
}

function getBearerToken(req) {
    const header = req.headers?.authorization;
    if (typeof header !== 'string' || header.length > 4103) return null;
    const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43})$/i.exec(header);
    return match ? match[1] : null;
}

function resolveTrustedProxyCidrs(value = process.env.KC_TRUST_PROXY_CIDRS || '') {
    if (!value.trim()) return false;
    const entries = value.split(',').map(item => item.trim());
    if (entries.length > 32 || entries.some(item => {
        const parts = item.split('/');
        const version = isIP(parts[0]);
        return !version || parts.length > 2 || (parts.length === 2
            && (!/^\d{1,3}$/.test(parts[1]) || Number(parts[1]) < 1 || Number(parts[1]) > (version === 4 ? 32 : 128)));
    })) throw new Error('KC_TRUST_PROXY_CIDRS must contain explicit IP addresses or restricted CIDRs');
    return entries;
}

function resolveInitialAdminPasswordHash(existingHash) {
    if (existingHash !== undefined) {
        if (typeof existingHash !== 'string' || !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(existingHash)) {
            throw new Error('Existing admin password hash is invalid; explicit credential recovery is required');
        }
        return existingHash;
    }
    const password = process.env.ADMIN_PASSWORD;
    if (typeof password !== 'string' || password.trim().length < 16 || password.length > 1024) {
        throw new Error('First-time setup requires an explicit ADMIN_PASSWORD of at least 16 characters');
    }
    return createPasswordHash(password);
}

function adminTokenBinding(token) {
    return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function issueSecondaryToken(passwordVersion, ip = '', adminToken = '') {
    return issueSignedToken({ sub: 'admin_secondary', pv: passwordVersion,
        binding: adminTokenBinding(adminToken), ip: String(ip || '') }, SECONDARY_TOKEN_TTL_MS);
}

function verifySecondaryToken(token) {
    return verifySignedToken(token, { expectedSub: 'admin_secondary' });
}

function getClientMeta(req) {
    // Express resolves req.ip using the explicitly configured trusted proxy list.
    const ip = String(req.ip || req.socket?.remoteAddress || '');
    return {
        ip: ip.replace(/^::ffff:/, ''),
        userAgent: String(req.headers['user-agent'] || '').slice(0, 512),
        fingerprint: String(req.body?.fingerprint || req.headers['x-client-fingerprint'] || '').slice(0, 128)
    };
}

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function checkLoginRateLimit(ip) {
    cleanupAuthState();
    // Keep the phase suffix even for full-length IPv6 addresses.
    const key = String(ip || 'unknown').slice(0, 160);
    const now = Date.now();
    let entry = loginAttempts.get(key);
    if (!entry && loginAttempts.size >= MAX_AUTH_ENTRIES) return { allowed: false, retryAfterSec: 60, reason: 'capacity' };
    entry ||= { count: 0, firstAt: now, lockedUntil: 0 };
    if (entry.lockedUntil && now < entry.lockedUntil) {
        return { allowed: false, retryAfterSec: Math.ceil((entry.lockedUntil - now) / 1000), reason: 'locked' };
    }
    if (now - entry.firstAt >= LOGIN_WINDOW_MS || entry.lockedUntil) entry = { count: 0, firstAt: now, lockedUntil: 0 };
    if (entry.count >= LOGIN_MAX_ATTEMPTS) {
        return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((entry.firstAt + LOGIN_WINDOW_MS - now) / 1000)), reason: 'locked' };
    }
    // Reserve synchronously before database/password checks, so parallel requests share the budget.
    entry.count += 1;
    if (entry.count >= LOGIN_MAX_ATTEMPTS) entry.lockedUntil = now + LOGIN_LOCK_MS;
    loginAttempts.set(key, entry);
    return { allowed: true, entry, key };
}

function recordLoginFailure(key, entry) {
    // Attempts have already been reserved by checkLoginRateLimit.
    if (entry && entry.count >= LOGIN_MAX_ATTEMPTS) entry.lockedUntil = Math.max(entry.lockedUntil, Date.now() + LOGIN_LOCK_MS);
}

function clearLoginAttempts(key) {
    loginAttempts.delete(String(key || 'unknown'));
}

function base32Encode(buffer) {
    let bits = 0;
    let value = 0;
    let output = '';
    for (const byte of buffer) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            output += BASE32_CHARS[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) {
        output += BASE32_CHARS[(value << (5 - bits)) & 31];
    }
    return output;
}

function base32Decode(input) {
    const cleaned = String(input || '').toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
    let bits = 0;
    let value = 0;
    const output = [];
    for (const char of cleaned) {
        const idx = BASE32_CHARS.indexOf(char);
        if (idx === -1) continue;
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            output.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(output);
}

function generateTotpToken(secret, counter) {
    const key = base32Decode(secret);
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    const digest = crypto.createHmac('sha1', key).update(buf).digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const binary = ((digest[offset] & 0x7f) << 24)
        | ((digest[offset + 1] & 0xff) << 16)
        | ((digest[offset + 2] & 0xff) << 8)
        | (digest[offset + 3] & 0xff);
    return String(binary % 1_000_000).padStart(6, '0');
}

function generateTotpSecret() {
    return base32Encode(crypto.randomBytes(20));
}

function verifyTotpCode(secret, token, window = 1) {
    const normalizedSecret = String(secret || '').replace(/\s+/g, '').toUpperCase();
    const normalizedToken = String(token || '').trim();
    if (!normalizedSecret || !/^\d{6}$/.test(normalizedToken)) {
        return false;
    }
    const counter = Math.floor(Date.now() / 1000 / 30);
    for (let w = -window; w <= window; w += 1) {
        if (generateTotpToken(normalizedSecret, counter + w) === normalizedToken) {
            return true;
        }
    }
    return false;
}

function getTotpUri(email, secret, issuer = 'PlusPapay') {
    const normalizedSecret = String(secret || '').replace(/\s+/g, '').toUpperCase();
    const accountName = `${issuer}:${String(email || 'admin').trim()}`;
    const encodedAccount = encodeURIComponent(accountName);
    const encodedIssuer = encodeURIComponent(issuer);
    return `otpauth://totp/${encodedAccount}?secret=${normalizedSecret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
}

function storeTelegramLoginCode(challengeId, code) {
    const key = String(challengeId || '').trim();
    if (!key || !loginChallenges.has(key)) return;
    tgLoginCodes.set(key, {
        code: String(code),
        exp: Math.min(Date.now() + TG_CODE_TTL_MS, loginChallenges.get(key).payload.exp),
        attempts: tgLoginCodes.get(key)?.attempts || 0
    });
}

function verifyTelegramLoginCode(challengeId, inputCode) {
    const key = String(challengeId || '').trim();
    const entry = tgLoginCodes.get(key);
    if (!entry) {
        return { ok: false, reason: 'expired' };
    }
    if (Date.now() >= entry.exp) {
        tgLoginCodes.delete(key);
        return { ok: false, reason: 'expired' };
    }
    entry.attempts += 1;
    if (entry.attempts > TG_CODE_MAX_ATTEMPTS) {
        tgLoginCodes.delete(key);
        return { ok: false, reason: 'too_many_attempts' };
    }
    if (!safeEqualString(String(inputCode || '').trim(), entry.code)) {
        tgLoginCodes.set(key, entry);
        return { ok: false, reason: 'invalid' };
    }
    tgLoginCodes.delete(key);
    return { ok: true };
}

function generateTelegramLoginCode() {
    return String(crypto.randomInt(100000, 1000000));
}

function is2faRequired(authConfig = {}, telegramSettings = {}) {
    if (authConfig.totpEnabled && authConfig.totpSecret) {
        return true;
    }
    const botToken = String(telegramSettings.bot_token || '').trim();
    const adminChatId = String(telegramSettings.admin_chat_id || '').trim();
    return Boolean(botToken && adminChatId);
}

function getAvailable2faMethods(authConfig = {}, telegramSettings = {}) {
    const methods = [];
    const totpSecret = String(authConfig.totpSecret || '').trim();
    if (authConfig.totpEnabled && totpSecret) {
        methods.push('totp');
    }
    const botToken = String(telegramSettings.bot_token || '').trim();
    const adminChatId = String(telegramSettings.admin_chat_id || '').trim();
    if (botToken && adminChatId) {
        methods.push('telegram');
    }
    return methods;
}

function resolveLogin2faMethods(authConfig = {}, telegramSettings = {}) {
    const available = getAvailable2faMethods(authConfig, telegramSettings);
    const mode = String(authConfig.login2faMode || 'either').trim().toLowerCase();
    if (!['either', 'totp', 'telegram'].includes(mode)
        || (authConfig.totpEnabled && !String(authConfig.totpSecret || '').trim())
        || (mode === 'totp' && !available.includes('totp'))
        || (mode === 'telegram' && !available.includes('telegram'))
        || (Boolean(telegramSettings.bot_token) !== Boolean(telegramSettings.admin_chat_id))) {
        throw Object.assign(new Error('管理员验证配置异常'), { code: 'ADMIN_FACTOR_UNAVAILABLE' });
    }
    return mode === 'totp' || mode === 'telegram' ? [mode] : available;
}

function pickDefaultLogin2faMethod(methods = [], preferred = '') {
    const list = Array.isArray(methods) ? methods : [];
    const pref = String(preferred || '').trim().toLowerCase();
    if (pref && list.includes(pref)) {
        return pref;
    }
    if (list.includes('totp')) {
        return 'totp';
    }
    return list[0] || '';
}

function createRequireSecondaryAuth(store, ensureStoreReady) {
    return async function requireSecondaryAuth(req, res, next) {
        res.setHeader('Cache-Control', 'no-store');
        const raw = req.headers?.['x-admin-secondary-token'];
        const proof = typeof raw === 'string' ? verifySecondaryToken(raw) : null;
        if (!proof || !req.adminToken || proof.binding !== adminTokenBinding(req.adminToken)
            || proof.ip !== getClientMeta(req).ip || proof.pv !== req.admin?.pv) {
            return res.status(403).json({ success: false, code: 'STEP_UP_REQUIRED', message: '请再次验证身份后访问敏感操作' });
        }
        try {
            await ensureStoreReady();
            const config = await store.getAdminAuthConfig();
            // The store read may outlive the proof; authorize at the point of use.
            if (proof.exp <= Date.now() || proof.pv !== config.passwordVersion) return res.status(403).json({ success: false, code: 'STEP_UP_REQUIRED', message: '验证已失效' });
            req.secondaryAuth = proof;
            return next();
        } catch (_) { return res.status(503).json({ success: false, message: '安全验证暂时不可用' }); }
    };
}

module.exports = {
    ADMIN_TOKEN_TTL_MS,
    ADMIN_REFRESH_AFTER_MS,
    resolveAdminTokenSecret,
    createPasswordHash,
    verifyPassword,
    issueAdminToken,
    verifyAdminToken,
    issueLoginChallenge,
    verifyLoginChallenge,
    validateLoginChallenge,
    beginLoginChallengeAttempt,
    consumeLoginChallenge,
    reserveTelegramCodeSend,
    getBearerToken,
    resolveTrustedProxyCidrs,
    resolveInitialAdminPasswordHash,
    issueSecondaryToken,
    verifySecondaryToken,
    getClientMeta,
    normalizeEmail,
    checkLoginRateLimit,
    recordLoginFailure,
    clearLoginAttempts,
    generateTotpSecret,
    verifyTotpCode,
    getTotpUri,
    storeTelegramLoginCode,
    verifyTelegramLoginCode,
    generateTelegramLoginCode,
    is2faRequired,
    getAvailable2faMethods,
    resolveLogin2faMethods,
    pickDefaultLogin2faMethod,
    createRequireSecondaryAuth
};
