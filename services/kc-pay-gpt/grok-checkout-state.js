'use strict';

const { PLATFORM_CONFIG } = require('./region-config');
const { plans: bundlePlans } = require('./public/grok-plan-catalog');
const aliases = { grok_lite: 'supergrok_lite', grok_super: 'supergrok', grok_plus: 'supergrok_plus', grok_heavy: 'supergrok_heavy' };
const names = { supergrok_lite: 'SuperGrok Lite', supergrok: 'SuperGrok', supergrok_plus: 'SuperGrok Plus',
    supergrok_heavy: 'SuperGrok Heavy', grok_premium: 'Premium', grok_premium_plus: 'Premium+' };

function grokError(code, message) {
    return Object.assign(new Error(`${message} [${code}]`), { code });
}

function getGrokPlan(planType = 'supergrok') {
    if (Object.hasOwn(bundlePlans, planType)) return bundlePlans[planType];
    const key = aliases[planType] || planType;
    if (!names[key]) throw grokError('GROK_PLAN_UNSUPPORTED', '无法识别 Grok 目标套餐，已停止');
    return { key, name: names[key], amount: PLATFORM_CONFIG.grok.plans[key].amount, currency: 'USD',
        interval: 'month', platformMode: key.startsWith('supergrok') ? 'grok_web' : 'x_premium' };
}

function isGrokCheckoutUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.port
            && url.hostname === 'checkout.stripe.com' && /^\/c\/pay\/cs_(?:live|test)_[a-zA-Z0-9]+\/?$/.test(url.pathname);
    } catch (_) { return false; }
}

function checkoutSessionId(value) {
    if (!isGrokCheckoutUrl(value)) return '';
    return new URL(value).pathname.split('/').filter(Boolean).at(-1);
}

// Run inside the browser. Read only visible, bounded order-summary containers;
// prices in ads or other plan cards cannot establish what is being purchased.
function readGrokSummaryInBrowser(plan) {
    const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    const text = el => String(el?.innerText || '').replace(/\u00a0/g, ' ').trim();
    const normalize = value => value.replace(/^Subscribe to\s+|^订阅\s*/i, '').trim().toLowerCase();
    const titles = [...document.querySelectorAll('h1,h2,h3,[data-testid="product-name"],.ProductSummary-name')].filter(visible);
    const matching = titles.filter(el => normalize(text(el)) === plan.name.toLowerCase());
    const containers = new Set([...document.querySelectorAll('aside,[data-testid="order-summary"],[data-testid="product-summary"],.ProductSummary,.OrderSummary')].filter(visible));
    for (const title of matching) {
        let parent = title.parentElement;
        for (let depth = 0; parent && parent !== document.body && depth < 4; depth++, parent = parent.parentElement) {
            const content = text(parent);
            if (content.length < 2200 && /(?:USD|US\$|\$)\s*\d/.test(content) && /month|月|年|year/i.test(content)) {
                containers.add(parent); break;
            }
        }
    }
    const summaries = [...containers].map(text).filter(value => value.length < 3000 && value.includes(plan.name));
    const monthly = /(?:per\s+month|\/\s*(?:month|mo)\b|monthly|每月|按月|月付|\/月)/i;
    const yearly = /(?:per\s+year|\/\s*(?:year|yr)\b|annually|annual|yearly|每年|按年|年付|\/年)/i;
    const productNames = value => [...value.matchAll(/SuperGrok(?:\s+(?:Lite|Plus|Heavy))?|Premium\+?/gi)].map(m => m[0].toLowerCase());
    const selected = summaries.filter(value => monthly.test(value) && !yearly.test(value)
        && productNames(value).every(name => name === plan.name.toLowerCase()));
    const money = value => [...value.matchAll(/(USD|US\$|\$|EUR|GBP|CAD|AUD|SGD|PHP|€|£)\s*([\d,]+(?:\.\d{1,2})?)/gi)]
        .map(m => ({ currency: m[1].toUpperCase(), amount: Number(m[2].replace(/,/g, '')) }));
    const body = text(document.body);
    const currencies = [...new Set([...body.matchAll(/\b(USD|EUR|GBP|CAD|AUD|SGD|PHP)\b/g)].map(m => m[1]))];
    const amounts = [];
    for (const el of document.querySelectorAll('p,div,span,dt,label')) {
        if (!visible(el) || !/^(?:Due today|Total due(?: today)?|Amount due|Pay today|今日应付|今天应付|应付总额|总计|Total)\s*[:：]?$/i.test(text(el))) continue;
        const parent = el.parentElement;
        if (!parent || text(parent).length > 240) continue;
        const nearby = money(text(parent));
        if (nearby.length === 1) amounts.push(nearby[0]);
    }
    // Stripe sometimes labels the payable total directly through a test id.
    for (const el of document.querySelectorAll('[data-testid="total-amount"],[data-testid="amount-due"]')) {
        if (visible(el)) amounts.push(...money(text(el)));
    }
    return { hasTitle: matching.length > 0, selected: selected.length > 0,
        annual: summaries.some(value => yearly.test(value)),
        baseAmounts: selected.flatMap(money), amounts, currencies,
        loading: [...document.querySelectorAll('[aria-busy="true"],[data-testid*="skeleton"]')].some(visible) };
}

async function assertGrokCheckoutReady(page, planType, { final = true } = {}) {
    const plan = getGrokPlan(planType);
    if (!isGrokCheckoutUrl(page.url())) throw grokError('GROK_CHECKOUT_UNTRUSTED', 'Grok 支付页面地址无法确认，已停止');
    const snapshot = await page.evaluate(readGrokSummaryInBrowser, plan);
    const isUsd = item => ['USD', 'US$'].includes(item.currency)
        || item.currency === '$' && snapshot.currencies.length === 1 && snapshot.currencies[0] === 'USD';
    const correct = item => isUsd(item) && Math.abs(item.amount - plan.amount) < 0.005;
    if (!snapshot.hasTitle || !snapshot.selected || snapshot.annual || snapshot.loading
        || !snapshot.baseAmounts.some(correct) || snapshot.baseAmounts.some(item => !isUsd(item))
        || final && (!snapshot.amounts.length || !snapshot.amounts.every(correct))) {
        throw grokError('GROK_PRICE_UNCONFIRMED', `无法确认 ${plan.name} 月付与应付 USD ${plan.amount} 一致，已停止支付`);
    }
    return { amount: plan.amount, currency: plan.currency };
}

async function waitForGrokCheckoutReady(page, planType, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    do {
        try { return await assertGrokCheckoutReady(page, planType, { final: false }); }
        catch (error) {
            if (error.code !== 'GROK_PRICE_UNCONFIRMED' || Date.now() >= deadline) throw error;
        }
        await page.waitForTimeout(Math.min(150, Math.max(1, deadline - Date.now())));
    } while (Date.now() < deadline);
    return assertGrokCheckoutReady(page, planType, { final: false });
}

module.exports = { getGrokPlan, grokError, isGrokCheckoutUrl, checkoutSessionId, assertGrokCheckoutReady, waitForGrokCheckoutReady, readGrokSummaryInBrowser };
