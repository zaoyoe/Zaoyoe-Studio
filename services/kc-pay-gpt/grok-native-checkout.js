'use strict';

const { grokError } = require('./grok-checkout-state');
async function visibleMatches(locator) {
    const matches = [];
    for (let i = 0, count = await locator.count(); i < count; i++) if (await locator.nth(i).isVisible()) matches.push(locator.nth(i));
    return matches;
}
async function uniqueVisible(locator, description) {
    const matches = await visibleMatches(locator);
    if (matches.length !== 1) throw grokError('GROK_ENTRY_AMBIGUOUS', `${description} 无法唯一确认，尚未提交支付`);
    return matches[0];
}
async function checkoutDialog(page) {
    if (page.isClosed()) throw grokError('GROK_CHECKOUT_UNTRUSTED', '官方结账页面已关闭，已停止后续操作');
    let url;
    try { url = new URL(page.url()); } catch (_) { /* reject unknown locations */ }
    if (!url || url.protocol !== 'https:' || url.hostname !== 'grok.com' || url.pathname !== '/plans'
        || url.port || url.username || url.password) {
        throw grokError('GROK_CHECKOUT_UNTRUSTED', '官方结账页面已离开可信套餐页，已停止后续操作');
    }
    return uniqueVisible(page.getByRole('dialog', { name: /^(结账|Checkout)$/i }), '官方结账弹窗');
}
function readNativeSummary(dialog) {
    const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
    const text = el => String(el?.innerText || '').replace(/[\u200e\u200f\u2066-\u2069\u00a0]/g, '').trim();
    const summaries = [...dialog.querySelectorAll('aside.x-commerce-summary')].filter(visible);
    if (summaries.length !== 1) return null;
    const summary = summaries[0];
    const pair = pattern => [...summary.querySelectorAll('dt')].filter(visible).filter(el => pattern.test(text(el)))
        .map(el => text(el.nextElementSibling));
    const money = (value, allowPeriod = false) => {
        const match = /^(USD|US\$|\$)\s*((?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d{1,2})?)(?:\s*\/\s*(月|month|mo|年|year|yr))?$/i.exec(value || '');
        if (!match || !allowPeriod && match[3]) return null;
        return { amount: Number(match[2].replace(/,/g, '')), currency: match[1] === '$' ? '$' : 'USD',
            interval: match[3] ? /^(年|year|yr)$/i.test(match[3]) ? 'year' : 'month' : null };
    };
    const bases = [...summary.querySelectorAll('dt')].filter(visible)
        .filter(el => /^(计划价格|Plan price|年度订阅|Yearly subscription|月度订阅|Monthly subscription)$/i.test(text(el)))
        .map(el => {
            const label = text(el), value = text(el.nextElementSibling);
            const parsed = money(value, true);
            const labelInterval = /^(年度订阅|Yearly subscription)$/i.test(label) ? 'year'
                : /^(月度订阅|Monthly subscription)$/i.test(label) ? 'month' : null;
            const valueInterval = parsed?.interval;
            return { amount: parsed?.amount ?? null, currency: parsed?.currency,
                interval: !parsed || labelInterval && valueInterval && labelInterval !== valueInterval
                    ? null : valueInterval || labelInterval };
        });
    const dues = pair(/^(今日到期|今日应付|今天应付|Due today|Total due today)$/i);
    const due = dues.length === 1 ? money(dues[0]) : null;
    const taxes = pair(/^(预计税费|預估稅費|Estimated tax)$/i);
    const tax = taxes.length === 1 ? money(taxes[0]) : null;
    const content = text(summary);
    return { titles: [...summary.querySelectorAll('h1,h2,h3')].filter(visible).map(text),
        base: bases.length === 1 ? bases[0].amount : null, due: due?.amount ?? null,
        tax: tax?.amount ?? null, taxCurrency: tax?.currency,
        currencies: [bases.length === 1 ? bases[0].currency : null, due?.currency],
        interval: bases.length === 1 ? bases[0].interval : null,
        otherCurrency: /\b(?:EUR|GBP|CAD|AUD|SGD|PHP)\b|[€£]/.test(content),
        migration: /迁移|合并账号|统一账号|取消.*(?:现有|已有|旧).*订阅|migrat|merge accounts|unify accounts|cancel.*existing subscription/i.test(text(dialog)),
        offerReview: [...dialog.querySelectorAll('[role="alert"]')].filter(visible).some(el =>
            /优惠需要审核|offer.*(?:review|reselect)|return.*select.*plan/i.test(text(el))),
        busy: [...dialog.querySelectorAll('[aria-busy="true"],[data-testid*="skeleton"]')].some(visible),
        bundleTerms: [...dialog.querySelectorAll('a[href]')].some(el => visible(el)
            && el.getAttribute('href') === 'https://x.ai/legal/bundled-subscription-terms?us=unified') };
}
async function assertNativeCheckoutReady(page, observer, { final = false } = {}) {
    const dialog = await checkoutDialog(page), summary = await dialog.evaluate(readNativeSummary);
    if (summary?.migration) throw grokError('GROK_MIGRATION_REQUIRED', '官方要求迁移订阅或统一账号，请联系客服处理');
    if (summary?.offerReview) throw grokError('GROK_OFFER_REVIEW_REQUIRED', '官方提示此优惠需要审核，请返回官网重新选择计划，尚未提交支付');
    const contract = observer.contract({ final });
    // A bare dollar symbol is a locale display format, never currency evidence
    // by itself. The correlated official US SKU/cart/tax must first confirm USD.
    if (!summary || !summary.bundleTerms || summary.busy || summary.otherCurrency
        || contract.currency !== 'USD' || !summary.currencies.every(currency => currency === 'USD' || currency === '$')
        || summary.titles.filter(title => title === observer.plan.name).length !== 1
        || summary.base !== contract.recurringAmount || summary.interval !== contract.interval
        || summary.due !== contract.amount
        || final && (summary.tax !== contract.tax || !['USD', '$'].includes(summary.taxCurrency))) {
        throw grokError('GROK_PRICE_UNCONFIRMED', '官方可见订单汇总与本次套餐、周期或应付金额不一致');
    }
    return contract;
}
async function waitNativeCheckoutReady(page, observer, { final = false, timeoutMs = 12000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    do {
        try { return await assertNativeCheckoutReady(page, observer, { final }); }
        catch (error) {
            if (!['GROK_PRICE_UNCONFIRMED', 'GROK_COMMERCE_UNCONFIRMED', 'GROK_ENTRY_AMBIGUOUS'].includes(error.code) || Date.now() >= deadline) throw error;
        }
        await page.waitForTimeout(Math.min(120, Math.max(1, deadline - Date.now())));
    } while (Date.now() < deadline);
    return assertNativeCheckoutReady(page, observer, { final });
}
async function openNativeGrokCheckout(page, options) {
    const observer = options.commerceObserver;
    if (!observer || observer.plan.key !== options.planType) throw grokError('GROK_COMMERCE_UNCONFIRMED', '新版 Commerce 观测未在导航前启动');
    const plan = observer.plan, annual = plan.interval === 'year';
    if (new URL(page.url()).hostname !== 'grok.com' || new URL(page.url()).pathname !== '/plans') {
        throw grokError('GROK_ENTRY_MISSING', '尚未打开新版官方套餐页');
    }
    const periodName = annual ? /^(每年|年度|年付|按年|Annual|Annually|Yearly)$/i : /^(每月|月付|按月|Monthly)$/i;
    const periodGroups = page.getByRole('radiogroup', { name: /^(计费周期|Billing interval|Billing period|Billing cycle)$/i });
    const deadline = Date.now() + (options.entryTimeoutMs ?? 12000);
    let period = null;
    do {
        const candidates = await visibleMatches(periodGroups.getByRole('radio', { name: periodName }));
        if (candidates.length > 1) throw grokError('GROK_ENTRY_AMBIGUOUS', '官方计费周期存在多个匹配');
        period = candidates[0];
        if (period) break;
        await page.waitForTimeout(Math.min(120, Math.max(1, deadline - Date.now())));
    } while (Date.now() < deadline);
    if (!period) throw grokError('GROK_ENTRY_MISSING', '新版计费周期入口未就绪');
    if (await period.getAttribute('aria-checked') !== 'true') await period.click({ timeout: 3000 });
    const selectionDeadline = Date.now() + 3000;
    do {
        if (await period.getAttribute('aria-checked') === 'true') break;
        if (Date.now() >= selectionDeadline) throw grokError('GROK_PRICE_UNCONFIRMED', '官方计费周期未生效');
        await page.waitForTimeout(Math.min(120, Math.max(1, selectionDeadline - Date.now())));
    } while (true);
    const periodText = annual ? '(?:每年|年付|yearly|annually|annual)' : '(?:每月|月付|monthly)';
    const actionName = new RegExp(`^(?:订阅|Subscribe(?: to)?)\\s+${plan.name}\\s+${periodText}(?:[,，].*)?$`, 'i');
    const actions = page.locator('ul[role="list"] > li button[data-sku-id]').and(page.getByRole('button', { name: actionName }));
    await actions.first().waitFor({ state: 'visible', timeout: 4000 }).catch(() => { throw grokError('GROK_ENTRY_MISSING', '目标套餐入口未就绪'); });
    const action = await uniqueVisible(actions, '目标套餐入口');
    await action.click({ trial: true, timeout: 4000 });
    observer.bindSku(await action.getAttribute('data-sku-id'));
    await action.click({ timeout: 8000 });
    console.log(`[Grok] 已单次选择 The X Subscription ${plan.name} ${annual ? '年付' : '月付'}，核验本次官方购物车...`);
    await waitNativeCheckoutReady(page, observer, { timeoutMs: options.checkoutTimeoutMs ?? 20000 });
    return { success: true, url: page.url(), plan: plan.key, commerceObserver: observer, native: true };
}
module.exports = { visibleMatches, uniqueVisible, checkoutDialog, readNativeSummary, assertNativeCheckoutReady,
    waitNativeCheckoutReady, openNativeGrokCheckout };
