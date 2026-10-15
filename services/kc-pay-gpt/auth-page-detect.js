'use strict';

/** 页面 URL / 登录态检测（无依赖，避免 session-auth ↔ human-verification 循环引用） */

const SESSION_COOKIE_HINT = '请粘贴完整 Session JSON（含 sessionToken 字段，超长会自动分块），或从浏览器导出 chatgpt.com 的 cookies[]（含 __Secure-next-auth.session-token.0/.1）';
const { buildChatGptAuthError } = require('./chatgpt-auth-state');

async function hasVisibleExpiredSession(page) {
    if (!page || page.isClosed?.()) return false;
    const matches = page.getByText(/^(?:Your session has expired|Please log in again to continue using the app\.?|Session expired|会话已过期|您的会话已过期|登录状态已(?:过期|失效))$/i);
    for (let i = 0, count = await matches.count(); i < Math.min(count, 20); i += 1) {
        const candidate = matches.nth(i);
        if (await candidate.isVisible().catch(() => false)
            && await candidate.evaluate(node => !node.closest('[data-message-author-role], [contenteditable], textarea')).catch(() => false)) return true;
    }
    return false;
}

async function assertNoExpiredSession(page) {
    if (await hasVisibleExpiredSession(page)) throw buildChatGptAuthError();
}

function isHardLoginRedirectUrl(url) {
    const value = String(url || '').toLowerCase();
    return value.includes('accounts.google.com')
        || value.includes('login.microsoftonline.com')
        || value.includes('/auth/login')
        || value.includes('/auth/error')
        || value.includes('/auth/signin');
}

function isLoginRedirectUrl(url) {
    const value = String(url || '').toLowerCase();
    return isHardLoginRedirectUrl(url) || value.includes('auth.openai.com');
}

function isCheckoutPageUrl(url) {
    return /chatgpt\.com\/checkout\//i.test(String(url || ''));
}

const TELEMETRY_HOSTS = [
    'statsig.com',
    'statsigapi.net',
    'segment.io',
    'segment.com',
    'browser-intake-datadoghq.com',
    'datadoghq.com',
    'intercom.io',
    'intercomcdn.com',
    'sentry.io',
    'launchdarkly.com',
    'clarity.ms',
    'google-analytics.com',
    'googletagmanager.com'
];

function shouldBlockLoginNavigation(url, resourceType = '') {
    const value = String(url || '').toLowerCase();
    if (value.includes('accounts.google.com') || value.includes('login.microsoftonline.com')) {
        return true;
    }
    if (resourceType === 'document' && isHardLoginRedirectUrl(url) && !isCheckoutPageUrl(url)) {
        return true;
    }
    // 拦截无意义音视频媒体请求，节省代理带宽
    if (resourceType === 'media') {
        return true;
    }
    // 拦截高耗时第三方埋点分析/遥测（完全不影响 OpenAI 与 Stripe 核心业务，显著加速网络与页面就绪）
    if (TELEMETRY_HOSTS.some(host => value.includes(host))) {
        return true;
    }
    return false;
}

async function isLoginPageContent(page) {
    try {
        const bodyText = String(await page.textContent('body', { timeout: 5000 }).catch(() => '') || '');
        return /Sign in with Google/i.test(bodyText)
            || /Sign in to continue/i.test(bodyText)
            || /to continue to OpenAI/i.test(bodyText)
            || /登录\s*ChatGPT/i.test(bodyText)
            || /使用 Google 登录/i.test(bodyText)
            || (/\bLog in\b/i.test(bodyText) && /\bSign up\b/i.test(bodyText));
    } catch (_) {
        return false;
    }
}

/** 未登录访客 UI：仅检测可见的 Log in / Sign up 控件，不用 body 全文（已登录页 HTML 里也可能含这些词） */
async function hasVisibleLoginChrome(page) {
    if (!page || (typeof page.isClosed === 'function' && page.isClosed())) {
        return false;
    }
    const probes = [
        () => page.getByRole('button', { name: /^Log in$/i }).first().isVisible({ timeout: 800 }),
        () => page.getByRole('link', { name: /^Log in$/i }).first().isVisible({ timeout: 800 }),
        () => page.getByRole('button', { name: /^Sign up for free$/i }).first().isVisible({ timeout: 800 }),
        () => page.getByRole('link', { name: /^Sign up for free$/i }).first().isVisible({ timeout: 800 }),
        () => page.getByText(/^Sign up for free$/i).first().isVisible({ timeout: 800 }),
        () => page.getByText(/Get responses tailored to you/i).first().isVisible({ timeout: 800 })
    ];
    for (const probe of probes) {
        if (await probe().catch(() => false)) {
            return true;
        }
    }
    return false;
}

async function hasLoggedInChatUi(page) {
    if (await hasVisibleExpiredSession(page) || await hasVisibleLoginChrome(page)) {
        return false;
    }
    const probes = [
        () => page.getByRole('button', { name: /^New chat$/i }).first().isVisible({ timeout: 1500 }),
        () => page.getByText(/Ready when you are/i).first().isVisible({ timeout: 1500 }),
        () => page.getByText(/Ask anything/i).first().isVisible({ timeout: 1500 }),
        () => page.locator('textarea[placeholder*="Ask"], textarea#prompt-textarea, div[contenteditable="true"]').first().isVisible({ timeout: 1500 }),
        () => page.getByRole('navigation').first().isVisible({ timeout: 1500 }),
        () => page.getByText(/Configure your plan/i).first().isVisible({ timeout: 1500 }),
        () => page.getByText(/^Card number$/i).first().isVisible({ timeout: 1500 }),
        () => page.getByText(/Due today/i).first().isVisible({ timeout: 1500 })
    ];
    for (const probe of probes) {
        if (await probe().catch(() => false)) {
            return true;
        }
    }
    return false;
}

/** 等待已登录 UI 出现（首页 hydration 可能较慢） */
async function waitForLoggedInChatUi(page, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await assertNoExpiredSession(page);
        if (await hasLoggedInChatUi(page)) {
            return true;
        }
        await page.waitForTimeout(500);
    }
    return false;
}

async function hasLoggedInSessionApi(page) {
    try {
        const data = await page.evaluate(async () => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 10000);
            try {
                const response = await fetch('/backend-api/me', { credentials: 'include', cache: 'no-store', signal: controller.signal });
                return response.status === 200 ? await response.json() : null;
            } finally { clearTimeout(timer); }
        });
        return Boolean(typeof data?.id === 'string' && data.id);
    } catch (_) {
        return false;
    }
}

async function isCheckoutLoginGate(page) {
    if (!isCheckoutPageUrl(page.url())) {
        return false;
    }
    if (await hasVisibleLoginChrome(page)) {
        return true;
    }
    try {
        return await page.getByText(/Sign in to continue|Log in to continue|登录后继续/i).first()
            .isVisible({ timeout: 800 });
    } catch (_) {
        return false;
    }
}

function buildSessionNotLoggedInError(contextLabel = '页面', reason = '') {
    const reasonText = reason ? `【${reason}】` : '';
    return `Session 未在${contextLabel}生效（仍显示 Log in 访客界面）。${reasonText}${SESSION_COOKIE_HINT}`;
}

module.exports = {
    hasVisibleExpiredSession,
    assertNoExpiredSession,
    SESSION_COOKIE_HINT,
    isLoginRedirectUrl,
    isHardLoginRedirectUrl,
    isCheckoutPageUrl,
    shouldBlockLoginNavigation,
    isLoginPageContent,
    hasVisibleLoginChrome,
    hasLoggedInChatUi,
    waitForLoggedInChatUi,
    hasLoggedInSessionApi,
    isCheckoutLoginGate,
    buildSessionNotLoggedInError
};
