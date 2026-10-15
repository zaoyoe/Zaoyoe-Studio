'use strict';

const { getGrokPlan, grokError, isGrokCheckoutUrl, checkoutSessionId } = require('./grok-checkout-state');

// Verified in the official /plans frontend, not inferred from homepage ads.
const planIds = { supergrok_lite: 'supergrok-lite', supergrok: 'supergrok', supergrok_plus: 'supergrok-plus', supergrok_heavy: 'supergrok-heavy' };
const requestedTiers = { supergrok_lite: 'REQUESTED_TIER_SUPER_GROK_LITE', supergrok: 'REQUESTED_TIER_GROK_PRO',
    supergrok_plus: 'REQUESTED_TIER_SUPER_GROK_PLUS', supergrok_heavy: 'REQUESTED_TIER_SUPER_GROK_PRO' };
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function visibleLocators(locator) {
    const result = [];
    for (let i = 0, count = await locator.count(); i < count; i++) {
        const candidate = locator.nth(i);
        if (await candidate.isVisible().catch(() => false)) result.push(candidate);
    }
    return result;
}

async function findPlanAction(page, plan) {
    if (planIds[plan.key]) {
        const cards = await visibleLocators(page.getByTestId(`plan-card-${planIds[plan.key]}`));
        const actions = [];
        for (const card of cards) {
            const headings = await visibleLocators(card.getByRole('heading', { name: plan.name, exact: true }));
            if (headings.length === 1) actions.push(...await visibleLocators(card.getByTestId(`plan-cta-${planIds[plan.key]}`).and(page.getByRole('button'))));
        }
        if (actions.length > 1) throw grokError('GROK_ENTRY_AMBIGUOUS', '官方套餐入口有多个匹配，已停止，避免误选');
        if (actions.length === 1) return actions[0];
    }
    const name = escapeRegex(plan.name);
    const exact = new RegExp(`^(?:Upgrade to|Get|Subscribe to|升级到|升级至|订阅)\\s*${name}$`, 'i');
    let candidates = await visibleLocators(page.getByRole('button', { name: exact }));
    if (!candidates.length) {
        // Generic "Subscribe" is only valid inside a unique exact-name plan card.
        const headings = await visibleLocators(page.getByRole('heading', { name: plan.name, exact: true }));
        const handles = [];
        for (const heading of headings) {
            const handle = await heading.evaluateHandle((title, expected) => {
                const visible = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
                for (let parent = title.parentElement, depth = 0; parent && parent !== document.body && depth < 5; parent = parent.parentElement, depth++) {
                    const titles = [...parent.querySelectorAll('h1,h2,h3')].filter(visible);
                    if (titles.some(el => /SuperGrok|Premium/i.test(el.innerText) && el.innerText.trim() !== expected)) break;
                    const buttons = [...parent.querySelectorAll('button')].filter(el => visible(el)
                        && /^(Subscribe(?: & Pay)?|订阅(?:并支付)?|Upgrade|升级)$/.test(el.innerText.trim()));
                    if (buttons.length === 1) return buttons[0];
                    if (buttons.length > 1) break;
                }
                return null;
            }, plan.name);
            if (handle.asElement()) handles.push(handle.asElement());
            else await handle.dispose();
        }
        candidates = handles;
    }
    if (candidates.length > 1) throw grokError('GROK_ENTRY_AMBIGUOUS', '官方套餐入口有多个匹配，已停止，避免误选');
    return candidates[0] || null;
}

async function openGrokCheckout(page, options = {}) {
    const plan = getGrokPlan(options.planType);
    if (options.platformMode && options.platformMode !== plan.platformMode) {
        throw grokError('GROK_AUTH_PLAN_MISMATCH', '登录平台与目标套餐不一致');
    }
    if (plan.productFamily === 'x_subscription') {
        return require('./grok-native-checkout').openNativeGrokCheckout(page, options);
    }
    const officialHost = plan.platformMode === 'grok_web' ? 'grok.com' : 'x.com';
    const route = plan.platformMode === 'grok_web' ? '/plans' : '/settings/premium';
    const target = `https://${officialHost}${route}`;
    const context = page.context();
    let armed = false;
    let capturedUrl = '';
    let apiFailure = '';
    let apiStarted = false;
    let navigating = false;
    let pagesBeforeClick = new Map();
    const currentRequests = new Set();
    const relatedPage = async candidate => candidate === page || await candidate.opener().catch(() => null) === page;
    const isCreate = request => {
        try {
            const url = new URL(request.url());
            return request.method() === 'POST' && url.protocol === 'https:' && url.hostname === officialHost
                && url.pathname === '/rest/subscriptions/subscribe/new';
        } catch (_) { return false; }
    };
    const onRequest = request => {
        if (!armed || !isCreate(request)) return;
        try {
            if (request.frame().page() !== page) return;
            currentRequests.add(request); apiStarted = true;
            const body = request.postDataJSON();
            if (body?.subscriptionType && body.subscriptionType !== 'MONTHLY'
                || requestedTiers[plan.key] && body?.requestedTier && body.requestedTier !== requestedTiers[plan.key]) {
                apiFailure = 'GROK_CHECKOUT_PLAN_MISMATCH';
            }
        } catch (_) { /* A service-worker request cannot establish this page's checkout. */ }
    };
    const onResponse = async response => {
        if (!currentRequests.has(response.request())) return;
        if (!response.ok()) {
            apiFailure = [401, 403].includes(response.status()) ? 'GROK_AUTH_REQUIRED' : 'GROK_CHECKOUT_HTTP_ERROR';
            return;
        }
        try {
            const data = await response.json();
            if (isGrokCheckoutUrl(data?.url)) capturedUrl = data.url;
            else apiFailure = 'GROK_CHECKOUT_RESPONSE_UNSUPPORTED';
        } catch (_) { apiFailure = 'GROK_CHECKOUT_RESPONSE_UNSUPPORTED'; }
    };
    const onFailed = request => { if (currentRequests.has(request)) apiFailure = 'GROK_CHECKOUT_NETWORK_ERROR'; };
    context.on('request', onRequest);
    context.on('response', onResponse);
    context.on('requestfailed', onFailed);
    try {
        const current = new URL(page.url());
        if (current.hostname !== officialHost || current.pathname !== route) {
            console.log('[Grok] 直接导航官方套餐页，跳过首页升级按钮探测...');
            try { await page.goto(target, { waitUntil: 'domcontentloaded', timeout: options.navigationTimeoutMs || 35000 }); }
            catch (_) { throw grokError('GROK_NAVIGATION_TIMEOUT', '官方套餐页加载未完成'); }
        }
        if (new URL(page.url()).hostname !== officialHost || /login|sign-in/.test(new URL(page.url()).pathname)) {
            throw grokError('GROK_AUTH_REQUIRED', '官方套餐页要求重新登录');
        }
        console.log(`[Grok] 等待 ${plan.name} 的精确入口（目标为月付）...`);
        const entryDeadline = Date.now() + (options.entryTimeoutMs ?? 12000);
        let monthlySelected = false;
        let action;
        do {
            if (!monthlySelected) {
                // Official /plans switch is checked for YEARLY. Explicitly turn
                // it off; there need not be a "Monthly" tab on the page.
                const annual = await visibleLocators(page.getByRole('switch', { name: /^Save with annual$|^Billed annually$/i }));
                if (annual.length > 1) throw grokError('GROK_ENTRY_AMBIGUOUS', '存在多个年付开关，已停止');
                if (annual.length === 1) {
                    await annual[0].setChecked(false, { timeout: 3000 });
                    monthlySelected = true;
                }
            }
            if (!monthlySelected) {
                const monthly = await visibleLocators(page.getByRole('button', { name: /^Monthly$|^按月$|^月付$/i })
                    .or(page.getByRole('tab', { name: /^Monthly$|^按月$|^月付$/i }))
                    .or(page.getByRole('radio', { name: /^Monthly$|^按月$|^月付$/i })));
                if (monthly.length > 1) throw grokError('GROK_ENTRY_AMBIGUOUS', '存在多个计费周期入口，已停止');
                if (monthly.length === 1) {
                    const selected = await monthly[0].evaluate(el => el.getAttribute('aria-selected') === 'true'
                        || el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true'
                        || el.dataset.state === 'active' || el.checked === true);
                    if (!selected) await monthly[0].click({ timeout: 3000 });
                    monthlySelected = true;
                }
            }
            action = await findPlanAction(page, plan);
            if (action && await action.isEnabled()) break;
            await page.waitForTimeout(Math.min(150, Math.max(1, entryDeadline - Date.now())));
        } while (Date.now() < entryDeadline);
        if (!action || !await action.isEnabled()) {
            throw grokError('GROK_ENTRY_MISSING', `${plan.name} 套餐入口未就绪，尚未创建 Checkout；请检查官方页面结构或账号状态`);
        }
        await action.click({ trial: true, timeout: 4000 });
        pagesBeforeClick = new Map(context.pages().map(candidate => [candidate, candidate.url()]));
        armed = true;
        await action.click({ timeout: 8000 });
        console.log('[Grok] 已单次点击目标套餐，等待本次官方 Checkout 响应或跳转...');
        const deadline = Date.now() + (options.checkoutTimeoutMs ?? 20000);
        do {
            if (apiFailure) throw grokError(apiFailure, '本次官方 Checkout 请求未能生成可确认的支付页面，尚未提交支付');
            for (const candidate of context.pages()) {
                if (candidate.isClosed() || !await relatedPage(candidate) || !isGrokCheckoutUrl(candidate.url())) continue;
                if (pagesBeforeClick.get(candidate) === candidate.url()) continue;
                if (capturedUrl && checkoutSessionId(candidate.url()) !== checkoutSessionId(capturedUrl)) continue;
                if (options.onCheckoutPage) options.onCheckoutPage(candidate);
                return { success: true, url: candidate.url(), sessionId: checkoutSessionId(candidate.url()), plan: plan.key };
            }
            if (capturedUrl && !navigating) {
                // Only the official create response's URL is navigable; Stripe assets
                // and old responses are never interpreted as checkout links.
                navigating = true;
                try { await page.goto(capturedUrl, { waitUntil: 'domcontentloaded', timeout: Math.max(1, deadline - Date.now()) }); }
                catch (_) { throw grokError('GROK_CHECKOUT_NAVIGATION_TIMEOUT', '本次 Stripe Checkout 页面加载未完成'); }
                continue;
            }
            if (page.isClosed()) throw grokError('GROK_CHECKOUT_PAGE_CLOSED', '套餐页面已关闭，未确认 Checkout');
            await page.waitForTimeout(Math.min(150, Math.max(1, deadline - Date.now())));
        } while (Date.now() < deadline);
        throw grokError(apiStarted ? 'GROK_CHECKOUT_PENDING' : 'GROK_CHECKOUT_NO_REQUEST',
            apiStarted ? '官方 Checkout 请求仍未完成，尚未提交支付' : '点击目标套餐后未观察到 Checkout 请求或支付跳转');
    } finally {
        context.off('request', onRequest);
        context.off('response', onResponse);
        context.off('requestfailed', onFailed);
        currentRequests.clear();
    }
}

module.exports = { openGrokCheckout, findPlanAction };
