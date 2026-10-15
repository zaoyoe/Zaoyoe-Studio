'use strict';

const axios = require('axios');
const { ProxyAgent } = require('proxy-agent');
const { navigateClaudeUpgrade, assertClaudeNavigationHealthy, observeClaudeNavigation } = require('./claude-navigation');
const accountSnapshots = new WeakMap();

/**
 * Claude (Anthropic) 认证与 Session 提取模块
 *
 * Claude Web 采用 sessionKey 作为主要身份凭证（存储于 .claude.ai Cookie 中）
 * 格式通常为：sk-ant-sid01-xxxxxxxx...
 */

/**
 * 从用户输入的各种格式中解析提取出纯净的 sessionKey
 * @param {string|object} raw - 用户输入（纯密钥、Cookie 字符串、JSON 或书签导出对象）
 * @returns {string} 提取到的 sessionKey，未提取到返回空字符串
 */
function extractClaudeSessionKey(raw) {
    if (!raw) return '';

    if (typeof raw === 'object') {
        if (raw.sessionKey) return String(raw.sessionKey).trim();
        if (raw.session_key) return String(raw.session_key).trim();
        if (raw.key) return String(raw.key).trim();
        if (raw.token) return String(raw.token).trim();
        if (Array.isArray(raw.cookies)) {
            const found = raw.cookies.find(c => c && (c.name === 'sessionKey' || c.name === 'session_key'));
            if (found && found.value) return String(found.value).trim();
        }
    }

    const str = String(raw).trim();

    // 1. 如果是 JSON 字符串，尝试解析
    if (str.startsWith('{') && str.endsWith('}')) {
        try {
            const parsed = JSON.parse(str);
            const extracted = extractClaudeSessionKey(parsed);
            if (extracted) return extracted;
        } catch (_) {}
    }

    // 2. 如果包含 Cookie 键值对：sessionKey=sk-ant-sid01-...
    const cookieMatch = str.match(/(?:^|;\s*)sessionKey=([^;]+)/i);
    if (cookieMatch) {
        return decodeURIComponent(cookieMatch[1].trim());
    }

    // 3. 如果是以 sk-ant-sid 开头的直接密钥
    const directMatch = str.match(/sk-ant-sid0?[0-9a-zA-Z_-]{20,}/);
    if (directMatch) {
        return directMatch[0].trim();
    }

    // 4. 兜底直接返回
    if (str.length >= 30 && !str.includes(' ') && !str.includes('\n')) {
        return str;
    }

    return '';
}

/**
 * 校验 sessionKey 格式是否合法
 * @param {string} sessionKey
 * @returns {boolean}
 */
function isValidClaudeSessionKey(sessionKey) {
    const key = extractClaudeSessionKey(sessionKey);
    if (!key) return false;
    return key.startsWith('sk-ant-sid') && key.length >= 40;
}

/**
 * 通过 Claude 官方接口校验 sessionKey 并获取账号信息
 * @param {string} sessionKey
 * @param {object} options - { proxyUrl, timeout }
 * @returns {Promise<{ ok: boolean, email?: string, accountId?: string, orgId?: string, isPro?: boolean, error?: string }>}
 */
async function fetchClaudeAccount(sessionKey, options = {}) {
    const key = extractClaudeSessionKey(sessionKey);
    if (!key) {
        return { ok: false, error: '未识别到有效的 Claude sessionKey' };
    }

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': `sessionKey=${key}`,
        'Referer': 'https://claude.ai/',
        'Origin': 'https://claude.ai'
    };

    const agent = options.proxyUrl ? new ProxyAgent({ getProxyForUrl: () => options.proxyUrl }) : null;
    try {
        const res = await axios.get('https://claude.ai/api/auth/current_account', {
            headers,
            timeout: options.timeout || 12000,
            ...(agent ? { httpAgent: agent, httpsAgent: agent, proxy: false } : {}),
            validateStatus: () => true
        });

        if (res.status === 200 && res.data) {
            const acc = res.data.account || res.data;
            const memberships = res.data.memberships || acc.memberships || [];
            const primaryOrg = memberships[0]?.organization || {};
            const capabilities = primaryOrg.capabilities || [];
            const isPro = capabilities.includes('claude_pro') || capabilities.includes('pro');

            return {
                ok: true,
                email: acc.email_address || acc.email || '',
                accountId: acc.id || '',
                orgId: primaryOrg.id || '',
                isPro,
                raw: res.data
            };
        }

        if (res.status === 401 || res.status === 403) {
            return { ok: false, error: `Claude 登录已失效或 sessionKey 错误 (HTTP ${res.status})` };
        }

        return {
            ok: false,
            formatValid: isValidClaudeSessionKey(key),
            email: '',
            error: `API 响应状态 HTTP ${res.status}`
        };
    } catch (e) {
        // 网络/代理超时等情况下，只要 sessionKey 格式符合特征，仍允许继续尝试浏览器自动化
        if (isValidClaudeSessionKey(key)) {
            return {
                ok: false,
                formatValid: true,
                email: '',
                warning: '账号接口暂不可用，需要由浏览器结账状态继续确认'
            };
        }
        return { ok: false, error: e.message };
    } finally {
        agent?.destroy();
    }
}

/**
 * 将 Claude sessionKey 注入到 Playwright BrowserContext 中，并配置轻量化路由拦截
 * @param {import('playwright').BrowserContext} context
 * @param {string} sessionKey
 */
async function injectClaudeSession(context, sessionKey) {
    const key = extractClaudeSessionKey(sessionKey);
    if (!key) {
        throw new Error('缺少有效的 Claude sessionKey，无法注入浏览器会话');
    }

    const cookies = [
        {
            name: 'sessionKey',
            value: key,
            domain: '.claude.ai',
            path: '/',
            httpOnly: true,
            secure: true,
            sameSite: 'Lax'
        },
        {
            name: 'activitySessionKey',
            value: key,
            domain: '.claude.ai',
            path: '/',
            httpOnly: false,
            secure: true,
            sameSite: 'Lax'
        }
    ];

    await context.addCookies(cookies);
    console.log('🍪 [Claude] sessionKey 已注入到浏览器 Cookie (.claude.ai)');

    // 挂载网络层埋点遥测与多媒体请求拦截，大幅节省海外代理带宽并加速页面就绪
    try {
        const { shouldBlockLoginNavigation } = require('./auth-page-detect');
        await context.route('**/*', async (route) => {
            const url = route.request().url();
            const resourceType = route.request().resourceType();
            if (shouldBlockLoginNavigation(url, resourceType)) {
                await route.abort().catch(() => {});
                return;
            }
            await route.continue().catch(() => {});
        });
        console.log('🌐 [Claude] 网络层已开启遥测埋点拦截与媒体资源瘦身');
    } catch (_) {}
}

/**
 * 在 Playwright 页面中验证 Claude 登录状态（直达目标升级页面，消除 /chats 漫长跳转）
 * @param {import('playwright').Page} page
 * @param {string} sessionKey
 * @param {object} [options] - { planType, targetUrl }
 * @returns {Promise<{ ok: boolean, email?: string, orgId?: string, isPro?: boolean }>}
 */
function normalizeClaudeAccount(data) {
    if (!data || typeof data !== 'object') return null;
    const acc = data.account || data;
    const memberships = data.memberships || acc.memberships || [];
    const organizations = memberships.map(membership => membership.organization).filter(Boolean);
    const org = organizations[0] || {};
    const accountId = acc.id || acc.uuid || '';
    if (!accountId) return null;
    return { accountId, email: acc.email_address || acc.email || '', accountName: acc.name || '',
        orgId: org.id || org.uuid || '', organizationCount: organizations.length,
        capabilities: Array.isArray(org.capabilities) ? org.capabilities : [] };
}

function getClaudeAccountSnapshot(page) {
    return accountSnapshots.get(page) || null;
}

async function readClaudeAccountInBrowser(page, timeoutMs = 1500) {
    const result = await page.evaluate(async timeout => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch('/api/auth/current_account', { signal: controller.signal, cache: 'no-store' });
            return { status: response.status, data: response.ok ? await response.json() : null };
        } catch (_) { return { status: 0, data: null }; }
        finally { clearTimeout(timer); }
    }, timeoutMs);
    const account = normalizeClaudeAccount(result.data);
    if (account) accountSnapshots.set(page, account);
    return { status: result.status, account };
}

async function bootstrapClaudeSession(page, sessionKey, options = {}) {
    if (!extractClaudeSessionKey(sessionKey)) throw new Error('未提供有效的 Claude sessionKey');
    accountSnapshots.delete(page);
    const rawPlan = String(options.planType || '').toLowerCase();
    const isMaxPlan = rawPlan.includes('max');
    const isAnnual = /annual|yearly|年/i.test(rawPlan);
    const targetUrl = options.targetUrl || (isMaxPlan ? 'https://claude.ai/upgrade/max'
        : (isAnnual ? 'https://claude.ai/upgrade/pro?interval=annual' : 'https://claude.ai/upgrade/pro'));
    let observedAccount = null;
    let requestSeen = false;
    let resolveObserved;
    const observedResult = new Promise(resolve => { resolveObserved = resolve; });
    const isAccountUrl = value => {
        try { const url = new URL(value); return url.hostname === 'claude.ai' && url.pathname === '/api/auth/current_account'; }
        catch (_) { return false; }
    };
    const onRequest = request => { if (isAccountUrl(request.url())) requestSeen = true; };
    const onFailed = request => { if (isAccountUrl(request.url())) resolveObserved({ status: 0, account: null }); };
    const onResponse = async response => {
        try {
            if (!isAccountUrl(response.url())) return;
            const account = response.status() === 200 ? normalizeClaudeAccount(await response.json()) : null;
            if (account) { observedAccount = account; accountSnapshots.set(page, account); }
            resolveObserved({ status: response.status(), account });
        } catch (_) {}
    };
    page.on('response', onResponse);
    page.on('request', onRequest);
    page.on('requestfailed', onFailed);
    const networkObserver = observeClaudeNavigation(page);
    try {
        console.log(`🚀 [Claude] 正在直达目标结账/升级页验证登录状态 (${targetUrl})...`);
        await navigateClaudeUpgrade(page, targetUrl, { ...options, networkObserver });
        const currentUrl = page.url();
        if (new URL(currentUrl).hostname !== 'claude.ai') throw new Error('Claude 登录导航离开官方站点，已停止流程');
        if (/\/(?:login|signup)(?:[/?]|$)/i.test(new URL(currentUrl).pathname)) {
            throw new Error('Claude 会话校验失败：页面被重定向至登录页，请检查 sessionKey 是否已过期');
        }
        await assertClaudeNavigationHealthy(page);
        let account = observedAccount;
        if (!account) {
            const timeoutMs = options.accountTimeoutMs || 1500;
            let timer;
            let result;
            try {
                result = requestSeen ? await Promise.race([observedResult,
                    new Promise(resolve => { timer = setTimeout(() => resolve({ status: 0, account: null }), timeoutMs); })])
                    : await readClaudeAccountInBrowser(page, timeoutMs).catch(() => ({ status: 0, account: null }));
            } finally { clearTimeout(timer); }
            if (result.status === 401) throw new Error('Claude 在线会话校验失败：登录已失效');
            account = observedAccount || result.account;
        }
        await assertClaudeNavigationHealthy(page);
        console.log(account ? '✅ [Claude] 在线账号已确认，继续等待结账就绪' : '🧭 [Claude] 页面已打开，账号接口暂未确认，将以结账就绪状态继续核验');
        return { ok: true, url: currentUrl, email: account?.email || '', orgId: account?.orgId || '', accountName: account?.accountName || '' };
    } catch (error) {
        (options.log || console.log)(`[Claude/navigation] 官方请求诊断: ${networkObserver.summary()}`);
        throw error;
    } finally {
        networkObserver.dispose();
        page.off('response', onResponse);
        page.off('request', onRequest);
        page.off('requestfailed', onFailed);
    }
}

module.exports = {
    extractClaudeSessionKey,
    isValidClaudeSessionKey,
    fetchClaudeAccount,
    injectClaudeSession,
    bootstrapClaudeSession,
    readClaudeAccountInBrowser,
    getClaudeAccountSnapshot,
    normalizeClaudeAccount
};
