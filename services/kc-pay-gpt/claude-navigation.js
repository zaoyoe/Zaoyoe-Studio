'use strict';

const { performance } = require('node:perf_hooks');

// This is a navigation boundary, not authentication or payment evidence.
// The plan controller and final payment guards still run independently.
function claudeNavigationStateInBrowser({ wait = false } = {}) {
    const visible = el => el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    const body = String(document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    let failure = null;
    if (location.hostname !== 'claude.ai') failure = 'site';
    else if (/^\/(login|signup)(\/|$)/i.test(location.pathname)) failure = 'auth';
    else if (/Can't reach Claude|无法连接\s*Claude/i.test(body)) failure = 'network';
    else if (/App unavailable in your region|Claude is not available/i.test(body)) failure = 'region';
    const checkout = /^\/upgrade\/(pro|max)\/?$/.test(location.pathname)
        && /设置您的套餐|Configure your plan/i.test(body)
        && Array.from(document.querySelectorAll('input, [role="radio"], button')).some(visible);
    const ready = document.readyState !== 'loading' || checkout;
    const result = { failure, ready, boundary: checkout ? 'checkout' : document.readyState,
        hasBody: Boolean(body) };
    return wait && !failure && !ready ? false : result;
}

function buildClaudeNavigationError(kind) {
    const details = {
        network: ['NETWORK_ERROR', '当前代理无法稳定连接 Claude 官方服务，请稍后重试'],
        timeout: ['NAVIGATION_TIMEOUT', 'Claude 官方页面加载超时，请稍后重试'],
        http: ['HTTP_ERROR', 'Claude 官方页面返回访问错误，请稍后检查'],
        auth: ['AUTH_REQUIRED', 'Claude 会话校验失败：页面被重定向至登录页，请重新获取 sessionKey'],
        region: ['REGION_UNAVAILABLE', 'Claude 地区不可用，请检查代理地区'],
        site: ['SITE_MISMATCH', 'Claude 登录导航离开官方站点，已停止流程']
    };
    const [suffix, message] = details[kind] || details.network;
    const code = `CLAUDE_NAV_${suffix}`;
    return Object.assign(new Error(`${message}；尚未提交支付 [${code}]`), { code });
}

function safeNetworkCode(error) {
    const text = String(error?.message || error || '');
    if (/timeout|timed out/i.test(text)) return 'TIMEOUT';
    return text.match(/\b(?:net::)?(ERR_[A-Z_]+)\b/)?.[1] || 'TRANSPORT_ERROR';
}

function observeClaudeNavigation(page) {
    const facts = new Map();
    const pending = new Map();
    const timings = new Map();
    let transportFailure = null;
    const category = request => {
        try {
            const url = new URL(request.url());
            const type = request.resourceType();
            if (url.hostname === 'claude.ai') {
                if (request.isNavigationRequest() && request.frame() === page.mainFrame()) return 'document';
                if (url.pathname === '/api/auth/current_account') return 'account';
                if (url.pathname.startsWith('/api/') && /\/(?:billing|checkout|payment[^/]*)(?:\/|$)/i.test(url.pathname)) return 'billing';
                if (url.pathname.startsWith('/api/')) return 'api';
                if (['script', 'stylesheet'].includes(type)) return type;
            }
            if (url.hostname === 'assets.claude.ai' && ['script', 'stylesheet'].includes(type)) return type;
            if (url.hostname === 'js.stripe.com') {
                if (type === 'script') return 'stripe_script';
                if (type === 'document' && /elements-inner|embedded-checkout/i.test(url.pathname)) return 'stripe_frame';
            }
            if (url.hostname === 'api.stripe.com' && ['fetch', 'xhr'].includes(type)) return 'stripe_api';
        } catch (_) {}
        return null;
    };
    const record = (request, value) => {
        const key = category(request);
        if (key) facts.set(`${key}:${value}`, (facts.get(`${key}:${value}`) || 0) + 1);
    };
    const finishTiming = (request, phase) => {
        const item = pending.get(request);
        if (!item) return;
        const elapsed = Math.round(performance.now() - item.started);
        const key = `${item.category}:${phase}`;
        const timing = timings.get(key) || { count: 0, total: 0, max: 0 };
        timing.count++; timing.total += elapsed; timing.max = Math.max(timing.max, elapsed);
        timings.set(key, timing);
    };
    const onRequest = request => {
        record(request, 'requested');
        const key = category(request);
        if (key) pending.set(request, { category: key, started: performance.now() });
    };
    const onResponse = response => {
        record(response.request(), `HTTP${response.status()}`);
        finishTiming(response.request(), 'headers');
    };
    const onFinished = request => { finishTiming(request, 'complete'); pending.delete(request); };
    const onFailed = request => {
        const code = safeNetworkCode(request.failure()?.errorText);
        record(request, code);
        finishTiming(request, 'failed'); pending.delete(request);
        // A cancelled request during an official plan remount is not a broken
        // proxy. Only explicit transport failures of core Claude requests exit
        // page recovery and hand control back to the task-level proxy retry.
        if (['document', 'billing'].includes(category(request))
            && /^(?:TIMEOUT|ERR_(?:CONNECTION_\w+|TIMED_OUT|NAME_NOT_RESOLVED|PROXY_\w+|TUNNEL_\w+|SSL_\w+|CERT_\w+))$/.test(code)) transportFailure = code;
    };
    page.on('request', onRequest);
    page.on('response', onResponse);
    page.on('requestfailed', onFailed);
    page.on('requestfinished', onFinished);
    return {
        summary: () => [...facts].slice(0, 16).map(([key, count]) => `${key}=${count}`).join(', ') || '尚无官方请求证据',
        details: () => {
            const ages = new Map();
            for (const item of pending.values()) {
                const age = ages.get(item.category) || { count: 0, oldest: 0 };
                age.count++; age.oldest = Math.max(age.oldest, Math.round(performance.now() - item.started));
                ages.set(item.category, age);
            }
            return [...timings].map(([key, value]) => `${key}(count=${value.count}, avg=${Math.round(value.total / value.count)}ms, max=${value.max}ms)`)
                .concat([...ages].map(([key, value]) => `${key}:pending(count=${value.count}, oldest=${value.oldest}ms)`)).join(', ') || '尚无耗时证据';
        },
        networkFailure: () => transportFailure,
        dispose: () => {
            page.off('request', onRequest); page.off('response', onResponse);
            page.off('requestfailed', onFailed); page.off('requestfinished', onFinished);
            pending.clear();
        }
    };
}

async function assertClaudeNavigationHealthy(page) {
    const state = await page.evaluate(claudeNavigationStateInBrowser);
    if (state.failure) throw buildClaudeNavigationError(state.failure);
    return state;
}

async function navigateClaudeUpgrade(page, targetUrl, options = {}) {
    const target = new URL(targetUrl);
    if (target.origin !== 'https://claude.ai' || !/^\/upgrade\/(pro|max)\/?$/.test(target.pathname)) {
        throw buildClaudeNavigationError('site');
    }
    const log = options.log || console.log;
    // Preserve the original 35s + 30s tolerance, but share each step's budget
    // across response commitment and real page readiness, never double it.
    const primaryMs = options.primaryTimeoutMs ?? 35000;
    const fallbackMs = options.fallbackTimeoutMs ?? 30000;
    const ownsObserver = !options.networkObserver;
    const observer = options.networkObserver || observeClaudeNavigation(page);
    const step = async (url, timeoutMs) => {
        const deadline = performance.now() + timeoutMs;
        const remaining = () => Math.max(1, deadline - performance.now());
        try {
            const response = await page.goto(url, { waitUntil: 'commit', timeout: remaining() });
            if (response && response.status() >= 400) {
                const state = await page.evaluate(claudeNavigationStateInBrowser).catch(() => null);
                throw buildClaudeNavigationError(state?.failure || 'http');
            }
            const handle = await page.waitForFunction(claudeNavigationStateInBrowser, { wait: true }, { timeout: remaining(), polling: 100 });
            let state;
            try { state = await handle.jsonValue(); } finally { await handle.dispose(); }
            if (state.failure) throw buildClaudeNavigationError(state.failure);
            log(`[Claude/navigation] 页面边界已就绪（${state.boundary}），继续独立核验账号、套餐与金额`);
            return state;
        } catch (error) {
            if (page.isClosed()) throw error;
            if (String(error.code || '').startsWith('CLAUDE_NAV_')) throw error;
            const state = await page.evaluate(claudeNavigationStateInBrowser).catch(() => null);
            if (state?.failure && state.failure !== 'site') throw buildClaudeNavigationError(state.failure);
            if (state?.boundary === 'checkout' && !state.failure) return state;
            log(`[Claude/navigation] 导航未完成（${safeNetworkCode(error)}）`);
            throw buildClaudeNavigationError(safeNetworkCode(error) === 'TIMEOUT' ? 'timeout' : 'network');
        }
    };
    try {
        try {
            return await step(targetUrl, primaryMs);
        } catch (error) {
            // A known connection/auth/region error is not repaired by changing
            // the path on the same origin. Only uncertain loading gets fallback.
            if (error.code !== 'CLAUDE_NAV_NAVIGATION_TIMEOUT' || !fallbackMs) throw error;
            log('⚠️ [Claude] 目标升级页加载未完成，尝试 upgrade 备用页...');
            return await step('https://claude.ai/upgrade', fallbackMs);
        }
    } catch (error) {
        if (ownsObserver) log(`[Claude/navigation] 官方请求诊断: ${observer.summary()}`);
        throw error;
    } finally { if (ownsObserver) observer.dispose(); }
}

module.exports = { claudeNavigationStateInBrowser, buildClaudeNavigationError,
    observeClaudeNavigation, assertClaudeNavigationHealthy, navigateClaudeUpgrade };
