'use strict';

const CHATGPT_ORIGIN = 'https://chatgpt.com';
const PRICING_URL = `${CHATGPT_ORIGIN}/#pricing`;
const {
    isLoginRedirectUrl,
    isHardLoginRedirectUrl,
    isCheckoutPageUrl,
    shouldBlockLoginNavigation,
    isLoginPageContent,
    hasVisibleLoginChrome,
    hasLoggedInChatUi,
    waitForLoggedInChatUi,
    assertNoExpiredSession,
    buildSessionNotLoggedInError
} = require('./auth-page-detect');
const { assertLocalSessionFresh, verifyChatGptAccessToken, buildChatGptAuthError } = require('./chatgpt-auth-state');

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
async function installChatGptSession(context, sessionRaw) {
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

    let cookieVerified = false;
    if (injectResult.hasSessionToken) {
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
        if (shouldBlockLoginNavigation(url, resourceType)) {
            await route.abort();
            return;
        }
        if (/\/api\/auth\/(session|csrf)/.test(url)) {
            await route.continue();
            return;
        }
        if (url.includes('auth.openai.com') || url.includes('chatgpt.com') || url.includes('openai.com') || url.includes('pay.openai.com')) {
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

    await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 90000
    });
    if (isPricingTarget) {
        // 定价页快速唤起：通知 Next.js SPA 挂载 #pricing 弹窗，不再停留聊天首页
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
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
        await page.waitForTimeout(1500);
    }

    await assertChatGptLoggedIn(page, pageLabel);

    const cookieVerified = options.cookieVerified === true;
    let uiReady = true;
    if (!options.skipChatUiWait && !isPricingTarget) {
        uiReady = await waitForLoggedInChatUi(page, cookieVerified ? 4000 : 8000);
        await assertNoExpiredSession(page);
    }

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

module.exports = {
    CHATGPT_ORIGIN,
    PRICING_URL,
    installChatGptSession,
    setupChatGptSessionAuth,
    bootstrapChatGptSession,
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
