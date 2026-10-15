'use strict';

const { getGrokPlan, grokError } = require('./grok-checkout-state');

function cookieDomain(cookie) {
    if (!cookie || typeof cookie !== 'object') return null;
    if (cookie.domain) return String(cookie.domain).replace(/^\./, '').toLowerCase();
    if (cookie.url) {
        try { return new URL(cookie.url).hostname; } catch (_) { return null; }
    }
    return '';
}

function cookieBelongsTo(cookie, domains) {
    const domain = cookieDomain(cookie);
    return domain !== null && (!domain || domains.some(root => domain === root || domain.endsWith(`.${root}`)));
}

// A manual Cookie header has no browser domain/path enforcement. Apply those
// boundaries before sending an exported cookie jar to this fixed endpoint.
function grokSessionCookieHeader(cookies) {
    const requestPath = '/api/auth/session';
    return (cookies || []).filter(cookie => {
        const domain = cookieDomain(cookie);
        if (domain === null || domain && domain !== 'grok.com') return false;
        if (typeof cookie.name !== 'string' || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(cookie.name)
            || typeof cookie.value !== 'string' || !cookie.value || /[;\r\n]/.test(cookie.value)) return false;
        const path = typeof cookie.path === 'string' && cookie.path.startsWith('/') ? cookie.path : '/';
        if (requestPath !== path && !(requestPath.startsWith(path) && (path.endsWith('/') || requestPath[path.length] === '/'))) return false;
        const expiry = cookie.expires ?? cookie.expirationDate;
        return typeof expiry !== 'number' || expiry < 0 || expiry > Date.now() / 1000;
    }).sort((a, b) => (b.path || '/').length - (a.path || '/').length)
        .map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
}

/**
 * Grok / X(Twitter) 认证与凭证提取模块
 *
 * Grok 包含两条主要订阅链路：
 * 1. grok.com 独立站（SuperGrok Lite / SuperGrok / Plus / Heavy）：
 *    通行凭证：浏览器 Cookie（包含 sso, __Secure-next-auth.session-token 等）
 * 2. X.com Premium / Premium+ 订阅：
 *    通行凭证：auth_token Cookie
 */

/**
 * 解析 Cookie 字符串为结构化数组
 * @param {string} str
 * @param {string} defaultDomain
 * @returns {Array<{ name: string, value: string, domain: string, path: string }>}
 */
function parseCookieString(str, defaultDomain = '.grok.com') {
    const cookies = [];
    if (!str || typeof str !== 'string') return cookies;

    let cleanStr = str.trim();
    // 支持直接从 cURL 命令行或 fetch 请求中提取 Cookie
    const curlHeaderMatch = cleanStr.match(/(?:-H|--header)\s+['"\^]*[Cc]ookie:\s*([^'"\^]+)['"\^]*/i);
    const fetchHeaderMatch = cleanStr.match(/['"]cookie['"]\s*:\s*['"]([^'"]+)['"]/i);
    const genericHeaderMatch = cleanStr.match(/(?:^|;\s*|\n)[Cc]ookie:\s*(.+)$/im);

    if (curlHeaderMatch) {
        cleanStr = curlHeaderMatch[1].trim();
    } else if (fetchHeaderMatch) {
        cleanStr = fetchHeaderMatch[1].trim();
    } else if (genericHeaderMatch) {
        cleanStr = genericHeaderMatch[1].trim();
    }

    const parts = cleanStr.split(';');
    for (const part of parts) {
        const trimmed = part.trim();
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
            const name = trimmed.slice(0, eqIdx).trim();
            const value = trimmed.slice(eqIdx + 1).trim();
            if (name && value && !['path', 'domain', 'samesite', 'expires', 'max-age', 'secure', 'httponly'].includes(name.toLowerCase())) {
                cookies.push({
                    name,
                    value,
                    domain: defaultDomain,
                    path: '/'
                });
            }
        }
    }
    return cookies;
}

/**
 * 从用户输入的各种格式中解析提取 Grok / X 凭据
 * @param {string|object} raw
 * @returns {{ type: 'x_auth_token'|'grok_cookie'|'grok_session'|'unknown', value: string, cookies?: Array<object>, sessionId?: string, userId?: string, email?: string, rawJson?: object }}
 */
function extractGrokCredential(raw) {
    if (!raw) return { type: 'unknown', value: '' };

    // 1. 如果传入的是 Cookie 数组 (如 Cookie-Editor 导出的 JSON)
    if (Array.isArray(raw)) {
        const textEmail = JSON.stringify(raw).match(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/)?.[0]?.trim() || '';
        const foundAuth = raw.find(c => cookieBelongsTo(c, ['x.com', 'twitter.com']) && (c.name === 'auth_token' || c.name === 'authToken'));
        if (foundAuth && foundAuth.value) {
            return { type: 'x_auth_token', value: String(foundAuth.value).trim(), cookies: raw, email: textEmail };
        }
        return { type: 'grok_cookie', value: JSON.stringify(raw), cookies: raw, email: textEmail };
    }

    if (typeof raw === 'object') {
        const textEmail = JSON.stringify(raw).match(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/)?.[0]?.trim() || '';
        if (Array.isArray(raw.cookies)) {
            const foundAuth = raw.cookies.find(c => cookieBelongsTo(c, ['x.com', 'twitter.com']) && (c.name === 'auth_token' || c.name === 'authToken'));
            if (foundAuth && foundAuth.value) {
                return { type: 'x_auth_token', value: String(foundAuth.value).trim(), cookies: raw.cookies, rawJson: raw, email: textEmail };
            }
            return { type: 'grok_cookie', value: JSON.stringify(raw.cookies), cookies: raw.cookies, rawJson: raw, email: textEmail };
        }

        // Explicit login cookies take precedence over profile metadata. A session
        // endpoint's userId/sessionId alone is account data, not a login token.
        if (raw.auth_token || raw.authToken) {
            return { type: 'x_auth_token', value: String(raw.auth_token || raw.authToken).trim(), rawJson: raw, email: textEmail };
        }
        if (raw.sessionToken || raw.session_token || raw['__Secure-next-auth.session-token'] || raw.sso) {
            const key = ['sessionToken', 'session_token', '__Secure-next-auth.session-token', 'sso'].find(key => raw[key]);
            const val = String(raw[key]).trim();
            const name = key === '__Secure-next-auth.session-token' ? key : 'sso';
            return { type: 'grok_session', value: val, sessionId: val,
                userId: String(raw.session?.userId || raw.userId || '').trim(),
                email: String(raw.email || raw.googleEmail || raw.session?.email || raw.session?.googleEmail || '').trim(),
                cookies: [{ name, value: val, domain: '.grok.com', path: '/' }], rawJson: raw };
        }

        // grok.com/api/auth/session 响应格式（仅用于账号预览）
        if (raw.status === 'authenticated' || (raw.session && (raw.session.userId || raw.session.sessionId || raw.session.email))) {
            const s = raw.session || {};
            const email = String(s.email || s.googleEmail || '').trim();
            const sessionId = String(s.sessionId || s.userId || '').trim();
            const userId = String(s.userId || '').trim();
            return {
                type: 'grok_session',
                value: sessionId || userId || JSON.stringify(raw),
                sessionId,
                userId,
                email,
                rawJson: raw
            };
        }

        if (raw.sessionId || raw.userId) {
            const sid = String(raw.sessionId || raw.userId).trim();
            return {
                type: 'grok_session',
                value: sid,
                sessionId: sid,
                userId: String(raw.userId || '').trim(),
                email: String(raw.email || raw.googleEmail || '').trim(),
                rawJson: raw
            };
        }
    }

    const str = String(raw).trim();
    const emailMatch = str.match(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/);
    const textEmail = emailMatch ? emailMatch[0].trim() : '';

    // 2. 如果是 JSON 字符串，尝试解析
    if ((str.startsWith('{') && str.endsWith('}')) || (str.startsWith('[') && str.endsWith(']'))) {
        try {
            const parsed = JSON.parse(str);
            const extracted = extractGrokCredential(parsed);
            if (extracted.type !== 'unknown') {
                if (!extracted.email && textEmail) extracted.email = textEmail;
                return extracted;
            }
        } catch (_) {}
        return { type: 'unknown', value: '' };
    }

    // 3. 优先匹配特定认证键值对
    const headerCookies = parseCookieString(str);
    const xCookie = headerCookies.find(cookie => cookie.name === 'auth_token' && /^[a-f0-9]{32,64}$/i.test(cookie.value));
    const sessionCookie = headerCookies.find(cookie => /^(?:sso|sso-rw|(?:__Secure-)?next-auth\.session-token(?:\.\d+)?)$/.test(cookie.name));

    if (xCookie) {
        return { type: 'x_auth_token', value: xCookie.value, cookies: parseCookieString(str, '.x.com'), email: textEmail };
    }

    // 4. 包含多键 Cookie 字符串（形如 a=b; c=d）
    if (str.includes(';') && str.includes('=')) {
        const parsedCookies = parseCookieString(str);
        const attributeNames = new Set(['path', 'domain', 'samesite', 'expires', 'max-age', 'secure', 'httponly']);
        const businessCookies = parsedCookies.filter(c => !attributeNames.has(c.name.toLowerCase()));

        // 如果只包含单个业务 Cookie 且是 session-token 或 sso
        if (businessCookies.length === 1 && sessionCookie) {
            const tokenVal = sessionCookie.value;
            return {
                type: 'grok_session',
                value: tokenVal,
                sessionId: tokenVal,
                cookies: parsedCookies,
                email: textEmail
            };
        }

        if (businessCookies.length > 0) {
            return { type: 'grok_cookie', value: str, cookies: parsedCookies, email: textEmail };
        }
    }

    if (sessionCookie) {
        return { type: 'grok_session', value: sessionCookie.value, cookies: headerCookies, email: textEmail };
    }
    // 5.5 JWT 格式凭证（典型的 Grok sso / sso-rw Cookie 对应的值）
    const jwtMatch = str.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    if (jwtMatch) {
        let sid = '';
        let jwtEmail = '';
        let jwtName = '';
        try {
            const [, payloadB64] = jwtMatch[0].split('.');
            const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
            sid = payload.session_id || payload.sub || '';
            jwtEmail = String(payload.email || payload.googleEmail || '').trim();
            jwtName = String(payload.name || payload.username || '').trim();
        } catch (_) {}
        return {
            type: 'grok_session',
            value: jwtMatch[0],
            sessionId: sid || jwtMatch[0],
            email: jwtEmail || textEmail,
            name: jwtName
        };
    }

    // 6. 纯 40 位左右的十六进制字符串（典型的 X auth_token）
    if (/^[a-f0-9]{36,44}$/i.test(str)) {
        return { type: 'x_auth_token', value: str.toLowerCase(), email: textEmail };
    }

    // 7. 纯 UUID 格式
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)) {
        return { type: 'grok_session', value: str, sessionId: str, email: textEmail };
    }

    // 8. 兜底当做通配凭证
    if (/^[A-Za-z0-9._-]{20,}$/.test(str)) {
        return { type: 'grok_session', value: str, email: textEmail };
    }

    return { type: 'unknown', value: '' };
}

/**
 * 校验 Grok 凭据是否有效
 * @param {string|object} raw
 * @returns {boolean}
 */
function isValidGrokCredential(raw) {
    if (!raw) return false;
    const cred = extractGrokCredential(raw);
    if (!cred || cred.type === 'unknown' || !cred.value) return false;
    if (cred.rawJson && !cred.cookies?.length && !['sessionToken', 'session_token', '__Secure-next-auth.session-token', 'auth_token', 'authToken', 'sso'].some(key => cred.rawJson[key])) return false;
    if (cred.type === 'x_auth_token') {
        return /^[a-f0-9]{32,64}$/i.test(cred.value);
    }
    if (cred.type === 'grok_cookie') {
        return Boolean(cred.cookies?.some(cookie => cookie && typeof cookie.value === 'string' && cookie.value.trim().length >= 10
            && /^(?:sso|sso-rw|(?:__Secure-)?next-auth\.session-token(?:\.\d+)?)$/.test(cookie.name)
            && cookieBelongsTo(cookie, ['grok.com', 'x.ai'])));
    }
    if (cred.type === 'grok_session') {
        return cred.value.length >= 10;
    }
    return false;
}

/**
 * 注入 Grok 或 X 凭证到 Playwright BrowserContext 中
 * @param {import('playwright').BrowserContext} context
 * @param {string|object} rawCredential
 */
async function injectGrokSession(context, rawCredential) {
    const cred = extractGrokCredential(rawCredential);
    if (!cred || !cred.value) {
        throw new Error('未提供有效的 Grok / X 凭证');
    }

    if (cred.rawJson && !cred.cookies?.length && !['sessionToken', 'session_token', '__Secure-next-auth.session-token', 'auth_token', 'authToken', 'sso'].some(key => cred.rawJson[key])) {
        throw grokError('GROK_AUTH_REQUIRED', '账号资料 JSON 不能代替登录 Cookie，请复制完整 Cookie');
    }
    if (!isValidGrokCredential(rawCredential)) throw grokError('GROK_AUTH_REQUIRED', '未识别到登录 Cookie，请提供最新完整凭据');

    if (cred.type === 'x_auth_token') {
        const cookies = [
            {
                name: 'auth_token',
                value: cred.value,
                domain: '.x.com',
                path: '/',
                httpOnly: true,
                secure: true,
                sameSite: 'None'
            },
            {
                name: 'auth_token',
                value: cred.value,
                domain: '.twitter.com',
                path: '/',
                httpOnly: true,
                secure: true,
                sameSite: 'None'
            }
        ];
        for (const c of cred.cookies || []) {
            if (!cookieBelongsTo(c, ['x.com', 'twitter.com'])) continue;
            if (!c.name || !c.value || c.name === 'auth_token') continue;
            const domain = c.domain || cookieDomain(c) || '.x.com';
            cookies.push({ name: c.name, value: c.value, domain, path: c.path || '/',
                secure: c.secure ?? true, httpOnly: c.httpOnly ?? true,
                sameSite: ['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : 'Lax' });
        }
        await context.addCookies(cookies);
        console.log('🍪 [Grok/X] auth_token 已注入到浏览器 Cookie (.x.com / .twitter.com)');
    } else if (cred.type === 'grok_cookie' || (cred.cookies && cred.cookies.length > 0)) {
        // 多键 Cookie 完整注入
        const cookiesToInject = [];
        for (const c of cred.cookies) {
            if (!cookieBelongsTo(c, ['grok.com', 'x.ai'])) continue;
            if (!c.name || !c.value) continue;
            cookiesToInject.push({
                name: c.name,
                value: c.value,
                domain: c.domain || cookieDomain(c) || '.grok.com',
                path: c.path || '/',
                httpOnly: c.httpOnly ?? true,
                secure: c.secure ?? true,
                sameSite: ['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : 'Lax'
            });
            if (['sso', 'sso-rw'].includes(c.name) && cookieBelongsTo(c, ['grok.com'])) {
                cookiesToInject.push({
                    name: c.name,
                    value: c.value,
                    domain: '.x.ai',
                    path: c.path || '/',
                    httpOnly: c.httpOnly ?? true,
                    secure: c.secure ?? true,
                    sameSite: ['Strict', 'Lax', 'None'].includes(c.sameSite) ? c.sameSite : 'Lax'
                });
            }
        }
        await context.addCookies(cookiesToInject);
        console.log(`🍪 [Grok] 已注入 ${cred.cookies.length} 个完整 Cookie (.grok.com / .x.ai)`);
    } else {
        const rawToken = String(cred.value || cred.sessionId || '').trim();
        const cookies = [
            {
                name: 'sso',
                value: rawToken,
                domain: '.grok.com',
                path: '/',
                httpOnly: true,
                secure: true,
                sameSite: 'Lax'
            },
            {
                name: 'sso-rw',
                value: rawToken,
                domain: '.grok.com',
                path: '/',
                httpOnly: true,
                secure: true,
                sameSite: 'Lax'
            },
            {
                name: 'sso',
                value: rawToken,
                domain: '.x.ai',
                path: '/',
                httpOnly: true,
                secure: true,
                sameSite: 'Lax'
            },
            {
                name: 'sso-rw',
                value: rawToken,
                domain: '.x.ai',
                path: '/',
                httpOnly: true,
                secure: true,
                sameSite: 'Lax'
            },
            {
                name: '__Secure-next-auth.session-token',
                value: rawToken,
                domain: '.grok.com',
                path: '/',
                httpOnly: true,
                secure: true,
                sameSite: 'Lax'
            },
            {
                name: 'next-auth.session-token',
                value: rawToken,
                domain: '.grok.com',
                path: '/',
                httpOnly: true,
                secure: true,
                sameSite: 'Lax'
            }
        ];
        await context.addCookies(cookies);
        console.log('🍪 [Grok] sso / session-token 已注入到浏览器 Cookie (.grok.com / .x.ai)');


    }
}

/**
 * 在 Playwright 页面中验证 Grok 登录状态
 * @param {import('playwright').Page} page
 * @param {string|object} rawCredential
 */
function parseOfficialGrokSession(data) {
    if (!data || data.status && data.status !== 'authenticated') return null;
    const session = data.session;
    if (!session || typeof session.userId !== 'string' || !session.userId.trim()) return null;
    return { accountId: session.userId, email: String(session.email || session.googleEmail || '').trim(),
        name: String(session.givenName || '').trim() };
}

async function readOfficialGrokSession(page, timeoutMs = 6000) {
    return page.evaluate(async timeout => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch('/api/auth/session', { credentials: 'include', cache: 'no-store',
                redirect: 'error', headers: { accept: 'application/json' }, signal: controller.signal });
            if (!response.ok) return { status: response.status };
            return { status: response.status, data: await response.json() };
        } catch (_) { return { status: 0 }; }
        finally { clearTimeout(timer); }
    }, timeoutMs);
}

async function bootstrapGrokSession(page, rawCredential, options = {}) {
    const cred = extractGrokCredential(rawCredential);
    if (!cred?.value) throw grokError('GROK_AUTH_REQUIRED', '缺少有效的 Grok 凭证');
    const mode = cred.type === 'x_auth_token' ? 'x_premium' : 'grok_web';
    if (getGrokPlan(options.planType).platformMode !== mode) {
        throw grokError('GROK_AUTH_PLAN_MISMATCH', '登录凭据的平台与目标套餐不一致，请使用对应平台的 Cookie');
    }
    // /plans is an official route. Navigate once, then independently confirm auth.
    const target = mode === 'grok_web' ? 'https://grok.com/plans' : 'https://x.com/settings/premium';
    console.log(`[Grok] 直接打开官方套餐页并核验真实登录状态...`);
    try { await page.goto(target, { waitUntil: 'domcontentloaded', timeout: options.navigationTimeoutMs || 35000 }); }
    catch (_) { throw grokError('GROK_NAVIGATION_TIMEOUT', '官方套餐页未能加载，尚未提交支付'); }
    const url = new URL(page.url());
    if (url.hostname !== (mode === 'grok_web' ? 'grok.com' : 'x.com') || /\/(?:login|sign-in|sign-up|i\/flow\/login)(?:\/|$)/.test(url.pathname)) {
        throw grokError('GROK_AUTH_REQUIRED', '官方登录态校验未通过，请提供最新完整 Cookie');
    }
    if (mode === 'x_premium') {
        const switcher = page.locator('[data-testid="SideNav_AccountSwitcher_Button"]');
        await switcher.waitFor({ state: 'visible', timeout: options.authTimeoutMs || 6000 }).catch(() => {});
        const text = await switcher.innerText({ timeout: 500 }).catch(() => '');
        const screenName = text.match(/@([a-zA-Z0-9_]+)/)?.[1];
        if (!screenName) throw grokError('GROK_AUTH_UNCONFIRMED', 'X 页面未确认登录账号，已停止');
        return { ok: true, url: page.url(), platformMode: mode, screenName, accountId: screenName, email: '' };
    }
    const result = await readOfficialGrokSession(page, options.authTimeoutMs || 6000);
    const account = parseOfficialGrokSession(result.data);
    if (!account) throw grokError(result.status === 0 || result.status >= 500 ? 'GROK_AUTH_UNAVAILABLE' : 'GROK_AUTH_REQUIRED',
        '官方账号接口未确认有效登录，请检查网络或使用最新完整 Cookie');
    if (cred.userId && cred.userId !== account.accountId || cred.email && account.email && cred.email.toLowerCase() !== account.email.toLowerCase()) {
        throw grokError('GROK_AUTH_IDENTITY_MISMATCH', '官方账号与输入账号不一致，已停止充值');
    }
    console.log('✅ [Grok] 官方接口已确认登录账号，套餐页已打开');
    return { ok: true, url: page.url(), platformMode: mode, ...account };
}

module.exports = { extractGrokCredential, isValidGrokCredential, injectGrokSession, bootstrapGrokSession,
    parseCookieString, parseOfficialGrokSession, readOfficialGrokSession, grokSessionCookieHeader };
