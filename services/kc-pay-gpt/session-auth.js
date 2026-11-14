'use strict';

const CHATGPT_ORIGIN = 'https://chatgpt.com';
const PRICING_URL = `${CHATGPT_ORIGIN}/#pricing`;
const {
    isLoginRedirectUrl,
    isHardLoginRedirectUrl,
    isCheckoutPageUrl,
    isTelemetryUrl,
    shouldBlockLoginNavigation,
    isLoginPageContent,
    hasVisibleLoginChrome,
    hasLoggedInChatUi,
    waitForLoggedInChatUi,
    hasVisibleExpiredSession,
    assertNoExpiredSession,
    buildSessionNotLoggedInError
} = require('./auth-page-detect');
const { assertLocalSessionFresh, verifyChatGptAccessToken, assertChatGptAccountEligible, buildChatGptAuthError } = require('./chatgpt-auth-state');
const { handleStaticAssetCache } = require('./static-asset-cache');
const { probeFailureKind, proxyConnectStatus } = require('./proxy-preflight');

function decodeJwtPayload(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) {
        return null;
    }
    try {
        const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), '=');
        return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    } catch (_) {
        return null;
    }
}

function extractProfileFromToken(accessToken) {
    const payload = decodeJwtPayload(accessToken);
    if (!payload) {
        return { email: '', accountId: '', userId: '' };
    }
    const authInfo = payload['https://api.openai.com/auth'] || {};
    const profile = payload['https://api.openai.com/profile'] || {};
    return {
        email: profile.email || '',
        accountId: authInfo.chatgpt_account_id || '',
        userId: authInfo.chatgpt_user_id || ''
    };
}

function buildSessionPayload(accessToken, sessionJson = null) {
    const token = String(accessToken || '').trim();
    const profile = extractProfileFromToken(token);
    const base = sessionJson && typeof sessionJson === 'object' ? { ...sessionJson } : {};
    const user = base.user || (profile.email || profile.userId ? {
        id: profile.userId || `user-${profile.accountId || 'session'}`,
        email: profile.email || undefined,
        name: profile.email || undefined
    } : null);

    const exp = Number(decodeJwtPayload(token)?.exp);
    const expires = base.expires || (Number.isFinite(exp) && exp > 0 ? new Date(exp * 1000).toISOString() : undefined);

    return {
        ...base,
        user,
        expires,
        accessToken: base.accessToken || base.access_token || token,
        authProvider: base.authProvider || 'google-oauth2'
    };
}

function mergeVerifiedSessionPayload(sessionData, verifiedSession) {
    const accessToken = String(verifiedSession?.accessToken || '').trim();
    const tokenExpiry = Number(decodeJwtPayload(accessToken)?.exp);
    const merged = {
        ...sessionData,
        ...verifiedSession,
        accessToken,
        user: {
            ...(sessionData?.user || {}),
            ...(verifiedSession?.user || {})
        }
    };

    if (!verifiedSession?.expires && Number.isFinite(tokenExpiry) && tokenExpiry > 0) {
        merged.expires = new Date(tokenExpiry * 1000).toISOString();
    } else if (!verifiedSession?.expires) {
        delete merged.expires;
    }
    return merged;
}

function assertSameSessionAccount(sessionJson, inputToken, verifiedSession) {
    const inputUser = sessionJson?.user || {};
    const verifiedUser = verifiedSession?.user || {};
    const inputProfile = extractProfileFromToken(inputToken);
    const verifiedProfile = extractProfileFromToken(verifiedSession?.accessToken);
    const inputId = String(inputUser.id || inputProfile.userId || '').trim();
    const verifiedId = String(verifiedUser.id || verifiedProfile.userId || '').trim();
    const inputEmail = String(inputUser.email || inputProfile.email || '').trim();
    const verifiedEmail = String(verifiedUser.email || verifiedProfile.email || '').trim();

    if ((inputId && verifiedId && inputId !== verifiedId)
        || (inputEmail && verifiedEmail && inputEmail.toLowerCase() !== verifiedEmail.toLowerCase())) {
        throw buildChatGptAuthError('CHATGPT_ACCOUNT_MISMATCH');
    }
}

function parseSessionJson(raw) {
    const content = String(raw || '').trim();
    if (!content || !content.startsWith('{')) {
        return null;
    }
    try {
        const data = JSON.parse(content);
        if (data?.accessToken || data?.access_token || data?.user) {
            return data;
        }
    } catch (_) {
        return null;
    }
    return null;
}

const CHATGPT_COOKIE_URL = 'https://chatgpt.com';
const SESSION_TOKEN_BASE = '__Secure-next-auth.session-token';
/** 与 NextAuth SessionStore 一致：4096 - 160 */
const SESSION_COOKIE_CHUNK_SIZE = 3936;

function isSessionTokenCookieName(name) {
    return name === SESSION_TOKEN_BASE || name.startsWith(`${SESSION_TOKEN_BASE}.`);
}

/** 超长 sessionToken 按 NextAuth 规则拆成 .0 / .1 / … 多块 Cookie */
function expandSessionTokenCookies(value) {
    const token = sanitizeCookieValue(value);
    if (!token) {
        return [];
    }
    if (token.length <= SESSION_COOKIE_CHUNK_SIZE) {
        return [{ name: SESSION_TOKEN_BASE, value: token }];
    }
    const chunkCount = Math.ceil(token.length / SESSION_COOKIE_CHUNK_SIZE);
    const chunks = [];
    for (let i = 0; i < chunkCount; i++) {
        chunks.push({
            name: `${SESSION_TOKEN_BASE}.${i}`,
            value: token.substr(i * SESSION_COOKIE_CHUNK_SIZE, SESSION_COOKIE_CHUNK_SIZE)
        });
    }
    return chunks;
}

function hasStoredSessionToken(cookies) {
    return (cookies || []).some((item) => isSessionTokenCookieName(item.name));
}

function parseCookieHeader(header) {
    const pairs = [];
    for (const rawPart of String(header || '').split(';')) {
        const part = rawPart.trim();
        if (!part || !part.includes('=')) continue;
        const eq = part.indexOf('=');
        const name = part.slice(0, eq).trim();
        const value = part.slice(eq + 1).trim();
        if (name && value) {
            pairs.push({ name, value });
        }
    }
    return pairs;
}

function isChatGptCookieDomain(domain) {
    const value = String(domain || '').toLowerCase();
    return !value || value.includes('chatgpt.com');
}

function normalizeSameSite(raw) {
    const value = String(raw || '').trim().toLowerCase();
    if (value === 'no_restriction' || value === 'none') {
        return 'None';
    }
    if (value === 'strict') {
        return 'Strict';
    }
    return 'Lax';
}

function sanitizeCookieValue(value) {
    return String(value || '')
        .replace(/^["']+|["']+$/g, '')
        .replace(/[\r\n\0]/g, '')
        .trim();
}

function isValidCookieName(name) {
    return /^[!#$%&'*+\-.0-9A-Z^_`a-z|~]+$/.test(name);
}

function toPlaywrightCookie(spec) {
    if (!spec || typeof spec !== 'object') {
        return null;
    }
    const name = String(spec.name || '').trim();
    const value = sanitizeCookieValue(spec.value);
    if (!name || !value || !isValidCookieName(name)) {
        return null;
    }

    const sameSite = normalizeSameSite(spec.sameSite);
    const secure = sameSite === 'None' || name.startsWith('__Host-') || name.startsWith('__Secure-')
        ? true
        : spec.secure !== false;
    const httpOnly = spec.httpOnly !== false;

    const base = { name, value, secure, httpOnly, sameSite };

    // __Host- / __Secure- 前缀：只能用 url，不能带 domain/path
    if (name.startsWith('__Host-') || name.startsWith('__Secure-')) {
        return { ...base, url: CHATGPT_COOKIE_URL };
    }

    const hostOnly = spec.hostOnly === true;
    const rawDomain = String(spec.domain || 'chatgpt.com').trim().toLowerCase() || 'chatgpt.com';
    const bareDomain = rawDomain.replace(/^\./, '');
    const domain = hostOnly ? bareDomain : (rawDomain.startsWith('.') ? rawDomain : `.${bareDomain}`);
    const path = String(spec.path || '/').trim() || '/';

    return { ...base, domain, path };
}

function toPlaywrightCookieFallback(cookie) {
    if (!cookie?.name || !cookie?.value) {
        return null;
    }
    const { name, value, secure, httpOnly, sameSite } = cookie;
    if (name.startsWith('__Host-')) {
        return { name, value, path: '/', secure: true, httpOnly, sameSite, url: CHATGPT_COOKIE_URL };
    }
    if (name.startsWith('__Secure-')) {
        return { name, value, domain: 'chatgpt.com', path: '/', secure: true, httpOnly, sameSite };
    }
    return null;
}

async function addCookieSafe(context, cookie) {
    try {
        await context.addCookies([cookie]);
        return null;
    } catch (primaryErr) {
        const fallback = toPlaywrightCookieFallback(cookie);
        if (!fallback) {
            return primaryErr.message;
        }
        try {
            await context.addCookies([fallback]);
            return null;
        } catch (fallbackErr) {
            return fallbackErr.message || primaryErr.message;
        }
    }
}

async function injectChatGptCookies(context, cookieSpecs) {
    if (!cookieSpecs.length) {
        return { injected: 0, hasSessionToken: false, failed: [] };
    }

    const playwrightCookies = cookieSpecs
        .map((spec) => toPlaywrightCookie(spec))
        .filter(Boolean);

    const failed = [];
    let injected = 0;
    for (const cookie of playwrightCookies) {
        const error = await addCookieSafe(context, cookie);
        if (error) {
            failed.push({ name: cookie.name, error });
            console.warn(`[Session] Cookie 注入跳过 ${cookie.name}: ${error}`);
            continue;
        }
        injected += 1;
    }

    if (failed.length) {
        console.warn(`[Session] ${failed.length}/${playwrightCookies.length} 个 Cookie 注入失败`);
    }

    const stored = await context.cookies(CHATGPT_COOKIE_URL);
    const hasSessionToken = hasStoredSessionToken(stored);

    return {
        injected,
        hasSessionToken,
        storedNames: stored.map((c) => c.name),
        failed
    };
}

function deriveDeterministicDeviceId(seed) {
    const normalizedSeed = String(seed || '').trim();
    const bytes = new Array(16);
    if (normalizedSeed) {
        let h1 = 0x811c9dc5;
        let h2 = 0x9e3779b1;
        let h3 = 0x85ebca77;
        let h4 = 0xc2b2ae3d;
        for (let i = 0; i < normalizedSeed.length; i += 1) {
            const ch = normalizedSeed.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0;
            h2 = Math.imul(h2 ^ ((ch + i) & 0xff), 0x85ebca6b) >>> 0;
            h3 = Math.imul(h3 ^ (ch + (h1 & 0xff)), 0xc2b2ae35) >>> 0;
            h4 = Math.imul(h4 ^ (ch + (h2 & 0xff)), 0x27d4eb2f) >>> 0;
        }
        const words = [h1, h2, h3, h4];
        for (let w = 0; w < 4; w += 1) {
            let word = words[w];
            word ^= word >>> 16;
            word = Math.imul(word, 0x85ebca6b) >>> 0;
            word ^= word >>> 13;
            word = Math.imul(word, 0xc2b2ae35) >>> 0;
            word ^= word >>> 16;
            bytes[w * 4] = (word >>> 24) & 0xff;
            bytes[w * 4 + 1] = (word >>> 16) & 0xff;
            bytes[w * 4 + 2] = (word >>> 8) & 0xff;
            bytes[w * 4 + 3] = word & 0xff;
        }
    } else {
        for (let i = 0; i < 16; i += 1) {
            bytes[i] = Math.floor(Math.random() * 256) & 0xff;
        }
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function findDeviceIdInSources(sessionData, sessionJson, extraOptions = {}) {
    const directCandidates = [
        extraOptions?.deviceId,
        extraOptions?.device_id,
        extraOptions?.['oai-did'],
        sessionData?.deviceId,
        sessionData?.device_id,
        sessionData?.['oai-did'],
        sessionJson?.deviceId,
        sessionJson?.device_id,
        sessionJson?.['oai-did']
    ];
    for (const candidate of directCandidates) {
        const val = String(candidate || '').trim();
        if (val) return val;
    }

    for (const list of [sessionJson?.cookies, sessionData?.cookies]) {
        if (!Array.isArray(list)) continue;
        const found = list.find((c) => String(c?.name || '').trim() === 'oai-did' && String(c?.value || '').trim());
        if (found) return String(found.value).trim();
    }

    for (const header of [
        extraOptions?.cookieHeader,
        sessionData?.cookieHeader,
        sessionData?.cookie_header,
        sessionJson?.cookieHeader,
        sessionJson?.cookie_header
    ]) {
        const pair = parseCookieHeader(header).find((p) => p.name === 'oai-did');
        if (pair?.value) return pair.value;
    }

    return '';
}

function resolveSessionDeviceId(raw, extraOptions = {}) {
    const resolved = (raw && typeof raw === 'object' && !Array.isArray(raw))
        ? { accessToken: raw.accessToken || raw.access_token || '', sessionJson: raw, sessionData: raw }
        : resolveSessionInput(raw);
    const sessionData = resolved?.sessionData || null;
    const sessionJson = resolved?.sessionJson || null;
    const existing = findDeviceIdInSources(sessionData, sessionJson, extraOptions);
    if (existing) {
        return existing;
    }
    const seed = String(
        sessionData?.user?.id
        || sessionJson?.user?.id
        || sessionData?.user?.email
        || sessionJson?.user?.email
        || resolved?.accessToken
        || (typeof raw === 'string' ? raw : '')
    ).trim();
    return deriveDeterministicDeviceId(seed);
}

function resolveSessionCookieHeader(raw, extraOptions = {}) {
    const resolved = (raw && typeof raw === 'object' && !Array.isArray(raw))
        ? { accessToken: raw.accessToken || raw.access_token || '', sessionJson: raw, sessionData: raw }
        : resolveSessionInput(raw);
    if (!resolved) return '';
    const cookieSpecs = collectCookieSpecs(resolved.sessionData, resolved.sessionJson, { ...extraOptions, silent: true });
    return cookieSpecs.map((c) => `${c.name}=${c.value}`).join('; ');
}

function collectCookieSpecs(sessionData, sessionJson, extraOptions = {}) {
    const specs = [];
    const seen = new Set();
    const seenNames = new Set();

    const push = (name, value, extra = {}) => {
        const n = String(name || '').trim();
        const v = String(value || '').trim();
        if (!n || !v) return;
        const key = `${n}\0${v}`;
        if (seen.has(key)) return;
        seen.add(key);
        seenNames.add(n);
        specs.push({ name: n, value: v, ...extra });
    };

    for (const source of [sessionJson?.cookies, sessionData?.cookies]) {
        if (!Array.isArray(source)) continue;
        for (const item of source) {
            if (!item || typeof item !== 'object') continue;
            const name = String(item.name || '').trim();
            const value = String(item.value || '').trim();
            if (!name || !value) continue;
            if (!isChatGptCookieDomain(item.domain)) continue;
            push(name, value, {
                domain: item.domain,
                path: item.path,
                secure: item.secure,
                httpOnly: item.httpOnly,
                sameSite: item.sameSite,
                hostOnly: item.hostOnly
            });
        }
    }

    for (const header of [sessionData?.cookieHeader, sessionData?.cookie_header, sessionJson?.cookieHeader, sessionJson?.cookie_header, extraOptions?.cookieHeader]) {
        for (const pair of parseCookieHeader(header)) {
            push(pair.name, pair.value);
        }
    }

    const hasExportedSessionToken = [...seenNames].some((name) => isSessionTokenCookieName(name));

    const sessionToken = String(
        process.env.CHATGPT_SESSION_COOKIE
        || process.env.CHATGPT_SESSION_TOKEN
        || sessionData?.sessionToken
        || sessionData?.session_token
        || sessionData?.['__Secure-next-auth.session-token']
        || ''
    ).trim();

    if (sessionToken && !hasExportedSessionToken) {
        const chunks = expandSessionTokenCookies(sessionToken);
        if (chunks.length > 1 && !extraOptions?.silent) {
            console.log(`[Session] session-token 长度 ${sessionToken.length}，按 NextAuth 分 ${chunks.length} 块注入`);
        }
        for (const chunk of chunks) {
            push(chunk.name, chunk.value);
        }
    }

    const csrfToken = String(
        sessionData?.csrfToken
        || sessionData?.csrf_token
        || sessionData?.['__Host-next-auth.csrf-token']
        || ''
    ).trim();
    if (csrfToken && !seenNames.has('__Host-next-auth.csrf-token')) {
        push('__Host-next-auth.csrf-token', csrfToken);
    }

    const existingDidCookie = specs.find((c) => c.name === 'oai-did')?.value;
    const deviceId = String(
        existingDidCookie
        || findDeviceIdInSources(sessionData, sessionJson, extraOptions)
        || deriveDeterministicDeviceId(
            sessionData?.user?.id
            || sessionJson?.user?.id
            || sessionData?.user?.email
            || sessionJson?.user?.email
            || sessionData?.accessToken
            || sessionJson?.accessToken
            || ''
        )
    ).trim();
    if (deviceId && !seenNames.has('oai-did')) {
        push('oai-did', deviceId, { httpOnly: false });
    }

    return specs;
}

async function verifyRealSessionApi(context) {
    const probe = await context.newPage();
    try {
        const timeout = Number(process.env.SESSION_PROBE_TIMEOUT_MS || (process.env.NODE_ENV === 'test' ? 60000 : 3500));
        const response = await probe.goto(`${CHATGPT_COOKIE_URL}/api/auth/session`, {
            waitUntil: 'commit',
            timeout
        });
        const status = response?.status() || 0;
        const headers = response?.headers?.() || {};
        const headerText = Object.keys(headers).map((k) => `${k}:${headers[k]}`).join('\n').toLowerCase();
        const bodyText = await response?.text?.().catch(() => '') || await probe.evaluate(() => document.body?.innerText || '').catch(() => '');
        let data = null;
        try {
            data = JSON.parse(bodyText);
        } catch (_) {
            data = null;
        }
        if (status === 401) return { ok: false, status, expired: true };
        if (status === 200 && data?.accessToken && (data?.user?.email || data?.user?.id)) {
            return { ok: true, data, status };
        }
        const isCloudflareChallenge = status === 403
            || headerText.includes('cf-mitigated: challenge')
            || /just a moment|verify you are human|forbidden|access denied/i.test(bodyText);
        if (isCloudflareChallenge) {
            return {
                ok: false,
                status,
                challenge: true,
                error: `Cloudflare/地区风控拦截（HTTP ${status}）`
                    + '。当前出口/代理 IP 被 ChatGPT 风控，请配置干净的海外代理后重试'
            };
        }
        const snippet = String(bodyText || '').replace(/\s+/g, ' ').slice(0, 120);
        return {
            ok: false,
            status,
            error: `session-token 未被 ChatGPT 接受（/api/auth/session 无用户信息，HTTP ${status}${snippet ? `，响应: ${snippet}` : ''}）`
        };
    } catch (err) {
        return { ok: false, error: `无法验证 session Cookie: ${err.message}` };
    } finally {
        await probe.close().catch(() => {});
    }
}

function extractAccessTokenFromRaw(raw) {
    const content = String(raw || '').trim();
    if (!content) {
        return '';
    }

    const sessionJson = parseSessionJson(content);
    if (sessionJson) {
        return String(sessionJson.accessToken || sessionJson.access_token || '').trim();
    }

    const jwtMatch = content.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    if (jwtMatch) {
        return jwtMatch[0];
    }

    return content;
}

/**
 * 统一解析用户输入：优先完整 Session JSON，其次裸 AccessToken
 */
function resolveSessionInput(raw) {
    const content = String(raw || '').trim();
    if (!content) {
        return null;
    }

    const sessionJson = parseSessionJson(content);
    if (sessionJson) {
        const accessToken = extractAccessTokenFromRaw(content);
        if (!accessToken) {
            return null;
        }
        return {
            accessToken,
            sessionJson,
            sessionData: buildSessionPayload(accessToken, sessionJson),
            rawJson: JSON.stringify(sessionJson)
        };
    }

    const accessToken = extractAccessTokenFromRaw(content);
    if (!accessToken) {
        return null;
    }

    const sessionData = buildSessionPayload(accessToken, null);
    return {
        accessToken,
        sessionJson: null,
        sessionData,
        rawJson: JSON.stringify(sessionData)
    };
}

async function assertChatGptLoggedIn(page, label = '页面') {
    await assertNoExpiredSession(page);
    const url = page.url();
    if (isLoginRedirectUrl(url)) {
        throw new Error(`Session 未生效：${label} 跳转到 Google/登录页 (${url.slice(0, 80)})`);
    }
    if (await isLoginPageContent(page)) {
        throw new Error(`Session 未生效：${label} 显示 Google 登录界面，请粘贴完整 Session JSON`);
    }
}

/**
 * 在浏览器上下文安装 Session：拦截 auth API + 注入 fetch 补丁
 * 注意：__Secure-next-auth.session-token 是加密 cookie，不能用 accessToken 冒充
 */
async function installChatGptSession(context, sessionRaw, options = {}) {
    const resolved = resolveSessionInput(sessionRaw);
    if (!resolved?.accessToken) {
        throw new Error('缺少 Session：请粘贴完整 Session JSON（来自 chatgpt.com/api/auth/session）');
    }

    const { accessToken: token, sessionJson } = resolved;
    let accessToken = token;
    let sessionData = resolved.sessionData;
    const cookieSpecs = collectCookieSpecs(sessionData, sessionJson, options);

    if (!hasStoredSessionToken(cookieSpecs)) {
        assertLocalSessionFresh(token, sessionJson);
    }

    const sessionTokenValue = String(
        process.env.CHATGPT_SESSION_COOKIE
        || process.env.CHATGPT_SESSION_TOKEN
        || sessionData?.sessionToken
        || sessionData?.session_token
        || sessionData?.['__Secure-next-auth.session-token']
        || cookieSpecs.find((c) => c.name === SESSION_TOKEN_BASE)?.value
        || ''
    ).trim();

    if (sessionTokenValue && sessionTokenValue === token) {
        throw new Error(
            'sessionToken 与 accessToken 相同：请从浏览器 DevTools → Application → Cookies 复制 '
            + '__Secure-next-auth.session-token（不是 /api/auth/session JSON 里的 accessToken）'
        );
    }

    const injectResult = await injectChatGptCookies(context, cookieSpecs);

    const sessionTokenFailed = injectResult.failed?.filter((item) => isSessionTokenCookieName(item.name)) || [];

    if (sessionTokenValue && sessionTokenFailed.length) {
        throw new Error(
            `session-token Cookie 注入失败: ${sessionTokenFailed.map((item) => `${item.name}(${item.error})`).join('; ')}`
        );
    }

    if (!injectResult.hasSessionToken) {
        console.warn('[Session] 未提供 session-token Cookie，Checkout 会停留在登录页；'
            + '请导出 __Secure-next-auth.session-token，或粘贴完整 cookies[] / cookieHeader');
    } else {
        console.log(
            `[Session] 已注入 ${injectResult.injected} 个 Cookie（session-token ${sessionTokenValue ? `${sessionTokenValue.length} 字符` : '来自 cookies[]'}）`
        );
    }

    let cookieVerified = Boolean(options.cookieVerified);
    let localSessionFresh = false;
    try {
        assertLocalSessionFresh(accessToken, cookieVerified ? { expires: sessionData.expires } : sessionJson);
        localSessionFresh = true;
    } catch {}
    const shouldSkipOnlineProbe = Boolean(options.skipOnlineProbe)
        || (Boolean(options.skipOnlineProbeWhenFresh) && localSessionFresh);
    if (injectResult.hasSessionToken && !shouldSkipOnlineProbe) {
        const apiCheck = await verifyRealSessionApi(context);
        if (apiCheck.expired) throw buildChatGptAuthError();
        if (apiCheck.ok) {
            assertSameSessionAccount(sessionJson, token, apiCheck.data);
            sessionData = mergeVerifiedSessionPayload(sessionData, apiCheck.data);
            accessToken = sessionData.accessToken;
            assertLocalSessionFresh(accessToken, { expires: sessionData.expires });
            cookieVerified = true;
            const email = apiCheck.data?.user?.email || '';
            console.log(`[Session] Cookie 校验通过${email ? `: ${email}` : ''}`);
        } else if (apiCheck.status === 200) {
            throw new Error(
                `session-token 未被 ChatGPT 接受（/api/auth/session 返回空用户）。请确认 Cookie 未过期，并尽量粘贴浏览器全部 chatgpt.com Cookies（cookies[] 或 cookieHeader）`
            );
        } else {
            console.warn(`[Session] Cookie 在线预检跳过（HTTP ${apiCheck.status || 'unknown'}: ${apiCheck.error || ''}），转由后续首页流程验证`);
        }
    }

    if (options.accessToken && typeof options.accessToken === 'string' && options.accessToken.split('.').length === 3) {
        accessToken = options.accessToken;
        sessionData = {
            ...sessionData,
            accessToken
        };
    }
    if (options.sessionData && typeof options.sessionData === 'object') {
        sessionData = {
            ...sessionData,
            ...options.sessionData
        };
        if (sessionData.accessToken) {
            accessToken = sessionData.accessToken;
        }
    }

    assertLocalSessionFresh(accessToken, cookieVerified ? { expires: sessionData.expires } : sessionJson);
    const sessionBody = JSON.stringify(sessionData);

    if (!injectResult.hasSessionToken) {
        await context.addInitScript((payload) => {
            const sessionStr = JSON.stringify(payload);
            try {
                window.__CHATGPT_BOOTSTRAP_SESSION__ = payload;
                localStorage.setItem('oai/apps/chat/bootstrap-session', sessionStr);
            } catch (_) { /* ignore */ }

            const originalFetch = window.fetch.bind(window);
            window.fetch = async function patchedFetch(input, init) {
                const url = typeof input === 'string' ? input : (input && input.url) || '';
                if (url.includes('/api/auth/session')) {
                    return new Response(sessionStr, {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
                if (url.includes('/api/auth/csrf')) {
                    return new Response(JSON.stringify({ csrfToken: 'bootstrap-csrf-token' }), {
                        status: 200,
                        headers: { 'Content-Type': 'application/json' }
                    });
                }
                return originalFetch(input, init);
            };
        }, sessionData);

        await context.route(/\/api\/auth\/session(\?.*)?$/, async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: sessionBody
            });
        });

        await context.route(/\/api\/auth\/csrf(\?.*)?$/, async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ csrfToken: 'bootstrap-csrf-token' })
            });
        });
    } else {
        await context.addInitScript((payload) => {
            try {
                window.__CHATGPT_BOOTSTRAP_SESSION__ = payload;
                localStorage.setItem('oai/apps/chat/bootstrap-session', JSON.stringify(payload));
            } catch (_) { /* ignore */ }
        }, sessionData);
    }

    await context.route('**/*', async (route) => {
        const url = route.request().url();
        const resourceType = route.request().resourceType();

        // ⚡ 超级智能离线资源包：不可变公共前端静态资产由本地镜像 0ms 瞬间提供 (读穿写入，零代理流量)
        // 优先拦截不可变静态资源（含 ChatGPT/Claude/Grok 静态包及 js.stripe.com/v3 静态 SDK）
        const handledByCache = await handleStaticAssetCache(route).catch(() => false);
        if (handledByCache) {
            return;
        }

        // 核心保护：Stripe 收银台 API、m.stripe.network 遥测、hCaptcha 人机验证及其 CDN 资源绝对直通，严禁拦截或篡改 Header，
        // 彻底杜绝 hCaptcha 出现 "Oops, something went wrong. If you're using an adblocker..."
        if (
            url.includes('hcaptcha.com') ||
            url.includes('stripe.com') ||
            url.includes('stripecdn.com') ||
            url.includes('pay.openai.com') ||
            url.includes('stripethirdparty')
        ) {
            await route.continue();
            return;
        }

        if (isTelemetryUrl(url)) {
            await route.fulfill({
                status: 200,
                contentType: resourceType === 'script' ? 'application/javascript' : 'application/json',
                body: resourceType === 'script' ? '' : '{}'
            });
            return;
        }
        if (shouldBlockLoginNavigation(url, resourceType)) {
            await route.abort();
            return;
        }
        if (/\/api\/auth\/(session|csrf)/.test(url)) {
            await route.continue();
            return;
        }
        if ((url.includes('chatgpt.com/backend-api/') && !url.includes('/backend-anon/')) || url.includes('auth.openai.com/api/')) {
            const reqHeaders = { ...route.request().headers() };
            const existingAuth = reqHeaders.authorization || reqHeaders.Authorization;
            if (!injectResult.hasSessionToken || !existingAuth) {
                delete reqHeaders.Authorization;
                reqHeaders.authorization = `Bearer ${accessToken}`;
                await route.continue({
                    headers: reqHeaders
                });
                return;
            }
            if (reqHeaders.Authorization && !reqHeaders.authorization) {
                reqHeaders.authorization = reqHeaders.Authorization;
                delete reqHeaders.Authorization;
                await route.continue({
                    headers: reqHeaders
                });
                return;
            }
            await route.continue();
            return;
        }
        await route.continue();
    });

    return { sessionData, cookieVerified, hasSessionToken: Boolean(injectResult.hasSessionToken) };
}

/**
 * @deprecated 使用 installChatGptSession(context, sessionRaw)
 */
function setupChatGptSessionAuth(context, accessToken) {
    return installChatGptSession(context, accessToken);
}

/**
 * 稳健导航到 ChatGPT 页面：优先等待 commit（响应头到达），并竞态轮询核心 UI 状态，
 * 避免在动态住宅代理环境下因后台挂起的遥测长连接而死等 domcontentloaded 导致 90s 超时
 */
async function navigateChatGptSessionPage(page, targetUrl, options = {}) {
    const isPricingTarget = options.isPricingTarget || targetUrl.includes('#pricing');
    const navTimeout = Number(process.env.CHATGPT_NAV_TIMEOUT_MS || (process.env.NODE_ENV === 'test' ? 10000 : 45000));
    const deadline = Date.now() + navTimeout;
    const remaining = () => Math.max(1000, deadline - Date.now());

    try {
        await page.goto(targetUrl, {
            waitUntil: 'commit',
            timeout: Math.min(30000, remaining())
        });
    } catch (gotoErr) {
        if (await hasLoggedInChatUi(page).catch(() => false)) {
            console.log('[Session] 页面导航事件异常，但检测到已登录 UI 存在，继续执行流程');
            return;
        }
        throw Object.assign(
            new Error(`ChatGPT 页面连接超时（${gotoErr.message}）[CHATGPT_NAV_TIMEOUT]`),
            { code: 'CHATGPT_NAV_TIMEOUT', cause: gotoErr }
        );
    }

    if (isPricingTarget) {
        await page.evaluate(() => {
            try {
                if (window.location.hash !== '#pricing') {
                    window.location.hash = '#pricing';
                }
                window.dispatchEvent(new HashChangeEvent('hashchange'));
                window.dispatchEvent(new PopStateEvent('popstate'));
            } catch (_) {}
        }).catch(() => {});
    }

    while (Date.now() < deadline) {
        if (page.isClosed()) {
            throw new Error('页面在加载过程中被意外关闭 [CHATGPT_NAV_TIMEOUT]');
        }
        if (await hasLoggedInChatUi(page).catch(() => false)) {
            return;
        }
        if (await hasVisibleLoginChrome(page).catch(() => false) || await isLoginPageContent(page).catch(() => false)) {
            return;
        }
        if (await hasVisibleExpiredSession(page).catch(() => false)) {
            return;
        }
        const isCf = await page.evaluate(() => {
            const text = document.body ? document.body.innerText : '';
            return /Verify you are human|Just a moment|Cloudflare/i.test(text);
        }).catch(() => false);
        if (isCf) {
            return;
        }
        const domReady = await page.evaluate(() => {
            return Boolean(document.body && (document.readyState === 'interactive' || document.readyState === 'complete') && document.body.childElementCount > 0);
        }).catch(() => false);
        if (domReady) {
            await page.waitForTimeout(options.cookieVerified ? 200 : 500);
            return;
        }
        await page.waitForTimeout(300);
    }

    if (await hasLoggedInChatUi(page).catch(() => false)) {
        return;
    }
    throw Object.assign(
        new Error('ChatGPT 页面加载超时（未能在时限内呈现有效界面）[CHATGPT_NAV_TIMEOUT]'),
        { code: 'CHATGPT_NAV_TIMEOUT' }
    );
}

/**
 * 打开 ChatGPT 并验证 Session 在浏览器 UI 中生效
 */
async function bootstrapChatGptSession(page, sessionRaw, options = {}) {
    const resolved = resolveSessionInput(sessionRaw);
    if (!resolved?.accessToken) {
        throw new Error('缺少 Session：请粘贴完整 Session JSON');
    }

    const sessionData = options.sessionData || resolved.sessionData;
    const accessToken = sessionData?.accessToken || resolved.accessToken;
    assertLocalSessionFresh(accessToken, options.cookieVerified
        ? { expires: sessionData?.expires }
        : resolved.sessionJson);
    const email = sessionData?.user?.email || extractProfileFromToken(accessToken).email || '';

    if (!email && !sessionData?.user?.id) {
        throw new Error('Session 无效：JSON 中缺少 user 信息，请从 chatgpt.com/api/auth/session 复制完整内容');
    }

    console.log('🔐 [步骤] 正在使用 Session 登录 ChatGPT...');

    const targetUrl = options.targetUrl || CHATGPT_ORIGIN;
    const isPricingTarget = targetUrl.includes('#pricing');
    const pageLabel = isPricingTarget ? '定价页' : '首页';

    await navigateChatGptSessionPage(page, targetUrl, {
        isPricingTarget,
        cookieVerified: options.cookieVerified
    });
    await page.waitForTimeout(options.cookieVerified ? 400 : 800);
    await assertNoExpiredSession(page);

    const { clearHumanVerification } = require('./human-verification');
    const captchaResult = await clearHumanVerification(page, {
        phase: 'session-bootstrap',
        maxWaitMs: Number(process.env.CAPTCHA_CLEAR_TIMEOUT_MS || 180000),
        maxBypassRounds: 6
    });
    if (!captchaResult.cleared) {
        throw new Error('Cloudflare 人机验证未能通过，请换住宅代理 IP 或 HEADFUL=1 人工勾选');
    }

    if (await hasVisibleLoginChrome(page)) {
        await page.reload({ waitUntil: 'commit', timeout: 25000 }).catch(() => {});
        await page.waitForTimeout(1500);
    }

    await assertChatGptLoggedIn(page, pageLabel);

    const cookieVerified = options.cookieVerified === true;
    let uiReady = true;
    if (!options.skipChatUiWait && !isPricingTarget) {
        uiReady = await waitForLoggedInChatUi(page, cookieVerified ? 4000 : 8000);
        await assertNoExpiredSession(page);
    }

    const eligibilityPromise = !options.skipSubscriptionCheck
        ? assertChatGptAccountEligible(page, accessToken, { deadlineMs: 15000 }).then(
            (res) => ({ ok: true, res }),
            (err) => ({ ok: false, err })
        )
        : null;

    let officialAccount;
    try {
        officialAccount = await verifyChatGptAccessToken(page, accessToken, { deadlineMs: 20000 });
    } catch (err) {
        if (err?.code === 'CHATGPT_AUTH_UNCONFIRMED' && !page.isClosed()) {
            console.warn('[Session] 官方鉴权首次确认未通过，等待页面稳定后重试一次...');
            await page.waitForTimeout(1500);
            await assertNoExpiredSession(page);
            officialAccount = await verifyChatGptAccessToken(page, accessToken, { deadlineMs: 20000 });
        } else {
            throw err;
        }
    }

    if (email && officialAccount.email && email.toLowerCase() !== officialAccount.email.toLowerCase()) {
        throw buildChatGptAuthError('CHATGPT_ACCOUNT_MISMATCH');
    }

    if (eligibilityPromise) {
        const elig = await eligibilityPromise;
        if (!elig.ok) throw elig.err;
    }

    const hasSessionToken = options.hasSessionToken ?? (Array.isArray(sessionData?.cookies) || Boolean(sessionData?.sessionToken || sessionData?.session_token || sessionData?.['__Secure-next-auth.session-token']));
    const failureReason = !hasSessionToken
        ? '未检测到 sessionToken / __Secure-next-auth.session-token Cookie，请补充复制 sessionToken'
        : 'sessionToken 凭证已在 OpenAI 端失效或过期，请在浏览器中重新登录并导出最新 Session';

    if (await hasVisibleLoginChrome(page)) {
        throw new Error(buildSessionNotLoggedInError(`ChatGPT ${pageLabel}`, failureReason));
    }
    if (!uiReady) {
        console.log(`[Session] ${pageLabel} UI 尚未就绪，官方只读账号接口已确认凭证有效，继续流程`);
    }

    const resolvedEmail = officialAccount.email || email;
    console.log(`✅ [步骤] Session 登录成功（官方鉴权已确认）: ${resolvedEmail}`);
    return {
        email: resolvedEmail,
        session: sessionData,
        hasSessionCookie: Boolean(
            process.env.CHATGPT_SESSION_COOKIE
            || process.env.CHATGPT_SESSION_TOKEN
            || sessionData.sessionToken
            || sessionData.session_token
            || sessionData['__Secure-next-auth.session-token']
            || (Array.isArray(sessionData.cookies) && sessionData.cookies.length > 0)
            || sessionData.cookieHeader
            || sessionData.cookie_header
        )
    };
}

function extractSessionPreview(raw) {
    if (typeof raw === 'object' && raw) {
        if (raw.session?.email || raw.session?.googleEmail) return String(raw.session.email || raw.session.googleEmail).trim();
        if (raw.user?.email) return String(raw.user.email).trim();
    }
    if (typeof raw === 'string' && raw.trim().startsWith('{')) {
        try {
            const data = JSON.parse(raw);
            if (data.session?.email || data.session?.googleEmail) return String(data.session.email || data.session.googleEmail).trim();
            if (data.user?.email) return String(data.user.email).trim();
        } catch (_) {}
    }
    const resolved = resolveSessionInput(raw);
    if (!resolved) {
        return String(raw || '').slice(0, 32);
    }
    const email = resolved.sessionData?.user?.email;
    if (email) {
        return email;
    }
    return `${resolved.accessToken.slice(0, 12)}...`;
}

function extractEmailFromSession(raw) {
    if (typeof raw === 'object' && raw) {
        if (raw.session?.email || raw.session?.googleEmail) return String(raw.session.email || raw.session.googleEmail).trim();
        if (raw.user?.email) return String(raw.user.email).trim();
    }
    if (typeof raw === 'string' && raw.trim().startsWith('{')) {
        try {
            const data = JSON.parse(raw);
            if (data.session?.email || data.session?.googleEmail) return String(data.session.email || data.session.googleEmail).trim();
            if (data.user?.email) return String(data.user.email).trim();
        } catch (_) {}
    }
    const resolved = resolveSessionInput(raw);
    if (!resolved) {
        return '';
    }
    return String(
        resolved.sessionData?.user?.email
        || resolved.sessionJson?.user?.email
        || extractProfileFromToken(resolved.accessToken).email
        || ''
    ).trim();
}

/**
 * 0 浏览器纯协议模式：并发核验 ChatGPT 官方账号身份 (/backend-api/me) 与订阅资格 (/backend-api/accounts/check)
 * 若遇到 403 Cloudflare 挑战或网络异常，返回 { ok: false, challenge: true } 供外层按需懒加载浏览器。
 * 若遇到 401 过期、账号不匹配或已订阅，直接抛出对应强安全拦截异常。
 */
async function verifyChatGptSessionProtocol(sessionRaw, options = {}) {
    const resolved = resolveSessionInput(sessionRaw);
    if (!resolved?.accessToken) {
        throw new Error('缺少 Session：请粘贴完整 Session JSON');
    }

    const { accessToken, sessionJson, sessionData } = resolved;
    assertLocalSessionFresh(accessToken, sessionJson);

    const email = sessionData?.user?.email || extractProfileFromToken(accessToken).email || '';
    if (!email && !sessionData?.user?.id) {
        throw new Error('Session 无效：JSON 中缺少 user 信息，请从 chatgpt.com/api/auth/session 复制完整内容');
    }

    const cookieSpecs = collectCookieSpecs(sessionData, sessionJson, options);
    const sessionTokenValue = String(
        process.env.CHATGPT_SESSION_COOKIE
        || process.env.CHATGPT_SESSION_TOKEN
        || sessionData?.sessionToken
        || sessionData?.session_token
        || sessionData?.['__Secure-next-auth.session-token']
        || cookieSpecs.find((c) => c.name === SESSION_TOKEN_BASE)?.value
        || ''
    ).trim();

    if (sessionTokenValue && sessionTokenValue === accessToken) {
        throw new Error(
            'sessionToken 与 accessToken 相同：请从浏览器 DevTools → Application → Cookies 复制 '
            + '__Secure-next-auth.session-token（不是 /api/auth/session JSON 里的 accessToken）'
        );
    }

    const cookieHeader = cookieSpecs.map((c) => `${c.name}=${c.value}`).join('; ');
    const deviceId = String(
        cookieSpecs.find((c) => c.name === 'oai-did')?.value
        || resolveSessionDeviceId(sessionRaw, options)
        || ''
    ).trim();
    const hasSessionCookie = hasStoredSessionToken(cookieSpecs);

    const proxyStr = String(options.proxy || '').trim();
    const timeoutMs = Number(options.timeoutMs || 10000);
    const userAgent = options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';
    const browserPage = (
        options.page
        && !options.page.isClosed?.()
        && typeof options.page.evaluate === 'function'
        && typeof options.page.url === 'function'
        && /^https:\/\/chatgpt\.com/i.test(String(options.page.url() || ''))
    ) ? options.page : null;

    let impitClient = null;
    if (!browserPage) {
        try {
            const { Impit } = require('impit');
            impitClient = new Impit({
                browser: 'chrome',
                proxyUrl: proxyStr || undefined,
                ignoreTlsErrors: true,
                timeout: timeoutMs
            });
        } catch (_) {}
    }

    let undiciFetch = null;
    let dispatcher = undefined;
    if (!browserPage && !impitClient) {
        const undici = require('undici');
        undiciFetch = undici.fetch;
        dispatcher = proxyStr ? new undici.ProxyAgent(proxyStr) : undefined;
    }

    const buildHeaders = (tokenVal) => ({
        'Authorization': `Bearer ${tokenVal}`,
        'Accept': 'application/json',
        'User-Agent': userAgent,
        'Referer': 'https://chatgpt.com/',
        'Origin': 'https://chatgpt.com',
        'sec-ch-ua': '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
        ...(deviceId ? { 'oai-device-id': deviceId } : {})
    });

    const filterBrowserFetchHeaders = (rawHeaders = {}) => {
        const clean = {};
        for (const [k, v] of Object.entries(rawHeaders || {})) {
            if (v == null || v === '') continue;
            const lower = k.toLowerCase();
            if (lower === 'cookie' || lower === 'user-agent' || lower === 'referer' || lower === 'origin' || lower.startsWith('sec-')) {
                continue;
            }
            clean[k] = String(v);
        }
        return clean;
    };

    const fetchJson = async (url, customHeaders = null) => {
        const reqHeaders = customHeaders || buildHeaders(accessToken);
        const endpoint = url === 'https://chatgpt.com/backend-api/me' ? 'identity'
            : url.startsWith('https://chatgpt.com/backend-api/accounts/check/') ? 'subscription' : 'session_refresh';
        for (let attempt = 1; attempt <= 2; attempt += 1) {
            const start = Date.now();
            const diagnostic = {
                endpoint,
                transport: browserPage ? 'browser_fetch' : (impitClient ? 'impit' : 'undici'),
                attempt,
                timeoutMs,
                httpStatus: null,
                connectStatus: null,
                result: 'connection'
            };
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                let statusCode = 0;
                let text = '';
                if (browserPage) {
                    const browserHeaders = filterBrowserFetchHeaders(reqHeaders);
                    const fetchEval = browserPage.evaluate(async ({ targetUrl, headers, budgetMs }) => {
                        const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
                        const t = ctrl ? setTimeout(() => ctrl.abort(), budgetMs) : null;
                        try {
                            const r = await fetch(targetUrl, {
                                method: 'GET',
                                credentials: 'include',
                                referrerPolicy: 'same-origin',
                                headers,
                                signal: ctrl ? ctrl.signal : undefined
                            });
                            const body = await r.text().catch(() => '');
                            return { ok: true, status: r.status, text: body };
                        } catch (err) {
                            return { ok: false, error: String(err?.message || err || 'browser fetch failed') };
                        } finally {
                            if (t) clearTimeout(t);
                        }
                    }, { targetUrl: url, headers: browserHeaders, budgetMs: timeoutMs });
                    const evalRes = await Promise.race([
                        fetchEval,
                        new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: 'browser fetch timed out' }), timeoutMs + 1500))
                    ]);
                    if (!evalRes?.ok) {
                        throw new Error(evalRes?.error || 'browser fetch failed');
                    }
                    statusCode = Number(evalRes.status || 0);
                    text = String(evalRes.text || '');
                } else {
                    const resp = impitClient
                        ? await impitClient.fetch(url, { method: 'GET', headers: reqHeaders })
                        : await undiciFetch(url, {
                            method: 'GET',
                            headers: reqHeaders,
                            dispatcher,
                            signal: controller.signal
                        });
                    statusCode = resp.status;
                    text = await resp.text();
                }
                diagnostic.httpStatus = statusCode;
                let data = null;
                try {
                    if (text.length <= 65536) data = JSON.parse(text);
                } catch (_) {}
                diagnostic.result = statusCode === 200 ? (data ? 'json_response' : 'invalid_json') : 'http_error';
                return { status: statusCode, text, data };
            } catch (err) {
                const kind = probeFailureKind(err);
                const connectStatus = proxyConnectStatus(err);
                diagnostic.connectStatus = connectStatus;
                diagnostic.result = kind;
                if (attempt < 2 && !['proxy_auth', 'certificate'].includes(kind)
                    && !(connectStatus >= 400 && connectStatus < 500)) {
                    await new Promise((r) => setTimeout(r, 300));
                    continue;
                }
                const detail = connectStatus ? `代理 CONNECT 隧道建立失败 (HTTP ${connectStatus})`
                    : kind === 'proxy_auth' ? '代理认证失败'
                        : kind === 'certificate' ? '代理连接证书校验失败'
                            : kind === 'timeout' ? '核验请求超时'
                                : kind === 'tls_protocol' ? 'TLS 连接失败' : '核验网络连接失败';
                return { status: 0, text: '', data: null, error: detail, failureKind: kind, connectStatus };
            } finally {
                clearTimeout(timer);
                try {
                    (options.log || console.log)(`[Session/http] ${JSON.stringify({ ...diagnostic, elapsedMs: Date.now() - start })}`);
                } catch (_) { /* optional diagnostics must not change authentication */ }
            }
        }
    };

    let activeToken = accessToken;
    let activeSessionData = sessionData;

    try {
        console.log('🔐 [步骤] 正在通过纯协议 (Chrome TLS 指纹) 快速核验 ChatGPT Session 与订阅状态...');

        // ⚡ 性能优化：先在本地 0ms 解析 JWT 载荷的过期时间 (exp)
        // 若 AccessToken 明确已过期且拥有 Session Cookie，直接请求刷新接口，无需发起明知会 401 的慢速网络往返！
        const tokenJwtPayload = decodeJwtPayload(activeToken);
        const isExpiringSoon = Boolean(tokenJwtPayload?.exp && (Date.now() / 1000) >= (tokenJwtPayload.exp - 60));
        if (isExpiringSoon && hasSessionCookie) {
            console.log('🔄 [Session] 本地检测到 AccessToken 已到期，直接通过 Cookie 刷新最新 Token...');
            const sessionRes = await fetchJson('https://chatgpt.com/api/auth/session', {
                'Accept': 'application/json',
                'User-Agent': userAgent,
                'Referer': 'https://chatgpt.com/',
                'Cookie': cookieHeader
            });
            if (sessionRes.status === 200 && sessionRes.data?.accessToken && (sessionRes.data?.user?.email || sessionRes.data?.user?.id)) {
                assertSameSessionAccount(sessionJson, accessToken, sessionRes.data);
                activeSessionData = mergeVerifiedSessionPayload(sessionData, sessionRes.data);
                activeToken = activeSessionData.accessToken;
                console.log('✅ [Session] 已预先无感刷新最新 AccessToken');
            }
        }

        let [meRes, accRes] = await Promise.all([
            fetchJson('https://chatgpt.com/backend-api/me', buildHeaders(activeToken)),
            options.skipSubscriptionCheck
                ? Promise.resolve({ status: 200, data: { skipped: true } })
                : fetchJson('https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27?timezone_offset_min=0', buildHeaders(activeToken))
        ]);

        const isExpiredText = (txt) => /\b(?:token_expired|invalid_token|expired_token|session_expired)\b|authentication token has expired/i.test(String(txt || ''));

        if ((meRes.status === 401 || accRes.status === 401 || isExpiredText(meRes.text) || isExpiredText(accRes.text)) && hasSessionCookie) {
            const sessionRes = await fetchJson('https://chatgpt.com/api/auth/session', {
                'Accept': 'application/json',
                'User-Agent': userAgent,
                'Referer': 'https://chatgpt.com/',
                'Cookie': cookieHeader
            });
            if (sessionRes.status === 200 && sessionRes.data?.accessToken && (sessionRes.data?.user?.email || sessionRes.data?.user?.id)) {
                assertSameSessionAccount(sessionJson, accessToken, sessionRes.data);
                activeSessionData = mergeVerifiedSessionPayload(sessionData, sessionRes.data);
                activeToken = activeSessionData.accessToken;
                assertLocalSessionFresh(activeToken, { expires: activeSessionData.expires });
                [meRes, accRes] = await Promise.all([
                    fetchJson('https://chatgpt.com/backend-api/me', buildHeaders(activeToken)),
                    options.skipSubscriptionCheck
                        ? Promise.resolve({ status: 200, data: { skipped: true } })
                        : fetchJson('https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27?timezone_offset_min=0', buildHeaders(activeToken))
                ]);
            }
        }

        if (meRes.status === 401 || accRes.status === 401 || isExpiredText(meRes.text) || isExpiredText(accRes.text)) {
            throw buildChatGptAuthError('CHATGPT_SESSION_EXPIRED');
        }

        if (meRes.status === 200 && meRes.data?.id) {
            const officialEmail = typeof meRes.data.email === 'string' ? meRes.data.email : '';
            if (email && officialEmail && email.toLowerCase() !== officialEmail.toLowerCase()) {
                throw buildChatGptAuthError('CHATGPT_ACCOUNT_MISMATCH');
            }
        }

        let resolvedAccountId = '';
        if (accRes.status === 200 && accRes.data?.accounts) {
            const accounts = accRes.data.accounts || {};
            const entry = accounts.default || Object.values(accounts)[0] || {};
            const account = entry.account || {};
            resolvedAccountId = String(
                account.account_id
                || accRes.data.account_ordering?.[0]
                || Object.keys(accounts).find((k) => k !== 'default')
                || ''
            ).trim();
            if (!options.skipSubscriptionCheck) {
                const entitlement = entry.entitlement || {};
                const lastActive = entry.last_active_subscription || {};
                const hasActive = Boolean(entitlement.has_active_subscription);
                const planType = String(account.plan_type || '').toLowerCase();
                const expiresAt = entitlement.expires_at || lastActive.expires_at || null;
                const isExpired = expiresAt ? (Date.parse(expiresAt) <= Date.now()) : false;
                const isActivelySubscribed = hasActive && planType !== 'free' && !isExpired;

                if (isActivelySubscribed) {
                    const planName = (planType && planType !== 'free') ? planType.toUpperCase() : 'Plus';
                    const error = new Error(`该账号已有有效 ${planName} 订阅，无需重复充值，请更换其他未订阅账号 [ACCOUNT_ALREADY_SUBSCRIBED]`);
                    error.code = 'ACCOUNT_ALREADY_SUBSCRIBED';
                    throw error;
                }
            }
        }

        if (meRes.status === 200 && meRes.data?.id && (options.skipSubscriptionCheck || (accRes.status === 200 && accRes.data?.accounts))) {
            const resolvedEmail = (typeof meRes.data.email === 'string' && meRes.data.email) || email;
            console.log(`✅ [步骤] Session 协议鉴权成功（官方接口已确认账号有效且未订阅）: ${resolvedEmail}`);
            return {
                ok: true,
                email: resolvedEmail,
                accountId: resolvedAccountId,
                accessToken: activeToken,
                session: activeSessionData,
                cookieHeader,
                deviceId,
                hasSessionCookie
            };
        }

        const failed = [meRes, accRes].find(res => res.status && res.status !== 200)
            || [meRes, accRes].find(res => res.status !== 200) || meRes;
        const status = failed.status;
        const isChallenge = [meRes, accRes].some(res => res.status === 403)
            || /just a moment|cloudflare|challenge/i.test(`${meRes.text} ${accRes.text}`);
        return {
            ok: false,
            challenge: isChallenge,
            status,
            error: failed.error || (status === 200 ? '官方核验接口未返回完整身份或订阅数据 (HTTP 200)' : `HTTP ${status}`),
            failureKind: failed.failureKind || (isChallenge ? 'challenge' : 'http_response'),
            connectStatus: failed.connectStatus || null,
            email,
            accessToken: activeToken,
            session: activeSessionData,
            cookieHeader,
            deviceId,
            hasSessionCookie
        };
    } finally {
        await dispatcher?.close?.().catch(() => {});
    }
}

module.exports = {
    CHATGPT_ORIGIN,
    PRICING_URL,
    installChatGptSession,
    setupChatGptSessionAuth,
    bootstrapChatGptSession,
    verifyChatGptSessionProtocol,
    assertChatGptLoggedIn,
    parseSessionJson,
    resolveSessionInput,
    extractAccessTokenFromRaw,
    extractProfileFromToken,
    extractSessionPreview,
    extractEmailFromSession,
    buildSessionPayload,
    resolveSessionDeviceId,
    resolveSessionCookieHeader,
    isLoginRedirectUrl,
    isHardLoginRedirectUrl,
    isCheckoutPageUrl,
    isLoginPageContent
};
