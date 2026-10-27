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

function collectCookieSpecs(sessionData, sessionJson) {
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

    for (const header of [sessionData?.cookieHeader, sessionData?.cookie_header, sessionJson?.cookieHeader, sessionJson?.cookie_header]) {
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
        if (chunks.length > 1) {
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

    const deviceId = String(sessionData?.deviceId || sessionData?.device_id || sessionData?.['oai-did'] || '').trim();
    if (deviceId && !seenNames.has('oai-did')) {
        push('oai-did', deviceId);
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
    const cookieSpecs = collectCookieSpecs(sessionData, sessionJson);

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
    if (injectResult.hasSessionToken && !options.skipOnlineProbe) {
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

    assertLocalSessionFresh(accessToken, cookieVerified ? { expires: sessionData.expires } : sessionJson);
    const sessionBody = JSON.stringify(sessionData);

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

    await context.route('**/*', async (route) => {
        const url = route.request().url();
        const resourceType = route.request().resourceType();

        // 核心保护：Stripe 收银台、hCaptcha 人机验证及其 CDN 资源绝对直通，严禁拦截或篡改 Header，
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
        if (url.includes('auth.openai.com') || url.includes('chatgpt.com')) {
            await route.continue({
                headers: {
                    ...route.request().headers(),
                    Authorization: `Bearer ${accessToken}`
                }
            });
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

    const cookieSpecs = collectCookieSpecs(sessionData, sessionJson);
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
        || sessionData?.deviceId
        || sessionData?.device_id
        || sessionData?.['oai-did']
        || ''
    ).trim();
    const hasSessionCookie = hasStoredSessionToken(cookieSpecs);

    const proxyStr = String(options.proxy || '').trim();
    const timeoutMs = Number(options.timeoutMs || 10000);
    const userAgent = options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

    let impitClient = null;
    try {
        const { Impit } = require('impit');
        impitClient = new Impit({
            browser: 'chrome',
            proxyUrl: proxyStr || undefined,
            ignoreTlsErrors: true,
            timeout: timeoutMs
        });
    } catch (_) {}

    let undiciFetch = null;
    let dispatcher = undefined;
    if (!impitClient) {
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
        'sec-ch-ua': '"Not)A;Brand";v="8", "Chromium";v="147", "Google Chrome";v="147"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
        ...(deviceId ? { 'oai-device-id': deviceId } : {})
    });

    const fetchJson = async (url, customHeaders = null) => {
        const reqHeaders = customHeaders || buildHeaders(accessToken);
        for (let attempt = 1; attempt <= 2; attempt += 1) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const resp = impitClient
                    ? await impitClient.fetch(url, { method: 'GET', headers: reqHeaders })
                    : await undiciFetch(url, {
                        method: 'GET',
                        headers: reqHeaders,
                        dispatcher,
                        signal: controller.signal
                    });
                const text = await resp.text();
                let data = null;
                try {
                    if (text.length <= 65536) data = JSON.parse(text);
                } catch (_) {}
                return { status: resp.status, text, data };
            } catch (err) {
                if (attempt < 2) {
                    await new Promise((r) => setTimeout(r, 300));
                    continue;
                }
                return { status: 0, text: '', data: null, error: err.message };
            } finally {
                clearTimeout(timer);
            }
        }
    };

    let activeToken = accessToken;
    let activeSessionData = sessionData;

    try {
        console.log('🔐 [步骤] 正在通过纯协议 (Chrome TLS 指纹) 快速核验 ChatGPT Session 与订阅状态...');
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

        const status = meRes.status !== 200 ? meRes.status : accRes.status;
        const isChallenge = status === 403 || /just a moment|cloudflare|challenge/i.test(`${meRes.text} ${accRes.text}`);
        return {
            ok: false,
            challenge: isChallenge,
            status,
            error: meRes.error || accRes.error || `HTTP ${status}`,
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
    isLoginRedirectUrl,
    isHardLoginRedirectUrl,
    isCheckoutPageUrl,
    isLoginPageContent
};
