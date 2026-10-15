'use strict';

const { performance } = require('node:perf_hooks');
const { buildClaudeNavigationError, observeClaudeNavigation } = require('./claude-navigation');

const PLAN_RULES = Object.freeze({
    claude_pro: { key: 'pro_monthly', route: 'pro', amount: 20, currency: 'USD', label: 'Pro 月付' },
    claude_pro_annual: { key: 'pro_annual', route: 'pro', amount: 200, currency: 'USD', label: 'Pro 年付' },
    claude_pro_yearly: { key: 'pro_annual', route: 'pro', amount: 200, currency: 'USD', label: 'Pro 年付' },
    claude_max_100: { key: 'max_5x', route: 'max', amount: 100, currency: 'USD', label: 'Max 5x 月付' },
    claude_max_5x: { key: 'max_5x', route: 'max', amount: 100, currency: 'USD', label: 'Max 5x 月付' },
    claude_max5x: { key: 'max_5x', route: 'max', amount: 100, currency: 'USD', label: 'Max 5x 月付' },
    claude_max_200: { key: 'max_20x', route: 'max', amount: 200, currency: 'USD', label: 'Max 20x 月付' },
    claude_max_20x: { key: 'max_20x', route: 'max', amount: 200, currency: 'USD', label: 'Max 20x 月付' },
    claude_max20x: { key: 'max_20x', route: 'max', amount: 200, currency: 'USD', label: 'Max 20x 月付' }
});

function getClaudePlanRule(planType = 'claude_pro') {
    const rule = PLAN_RULES[String(planType).toLowerCase()];
    if (!rule) throw Object.assign(new Error('不支持的 Claude 套餐，已停止支付'), { code: 'CLAUDE_PLAN_UNSUPPORTED' });
    return rule;
}

// Runs inside the page. Return only plan/amount evidence, never form or account values.
function checkoutSnapshotInBrowser({ expected = null, waitFor = null } = {}) {
    const visible = el => Boolean(el && el.getClientRects().length
        && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none');
    const text = el => String(el?.innerText || '').replace(/\s+/g, ' ').trim();
    const labels = /^(?:Due today|Total due(?: today)?|Pay today|Amount due(?: today)?|Total|今日应付总额|今日应付|今天应付|应付总额|应付金额|总计)\s*[:：]?$/i;
    const prefix = /^(?:Due today|Total due(?: today)?|Pay today|Amount due(?: today)?|Total|今日应付总额|今日应付|今天应付|应付总额|应付金额|总计)\s*[:：]?\s*/i;
    const currencyMap = { USD: 'USD', 'US$': 'USD', '$': 'USD', EUR: 'EUR', '€': 'EUR', GBP: 'GBP', '£': 'GBP', PHP: 'PHP', '₱': 'PHP' };
    const parseAmount = value => {
        const tail = value.replace(prefix, '');
        const match = tail.match(/^(USD|US\$|\$|EUR|€|GBP|£|PHP|₱)\s*\$?\s*([\d,]+(?:\.\d{1,2})?)(?![\d.])/i)
            || tail.match(/^([\d,]+(?:\.\d{1,2})?)\s*(USD|US\$|\$|EUR|€|GBP|£|PHP|₱)(?!\w)/i);
        if (!match) return null;
        const reversed = /^\d/.test(match[1]);
        const amount = Number((reversed ? match[1] : match[2]).replace(/,/g, ''));
        const currency = currencyMap[(reversed ? match[2] : match[1]).toUpperCase()];
        return Number.isFinite(amount) && amount > 0 && currency ? { amount, currency } : null;
    };
    const amounts = [];
    const dueNodes = [];
    const nodes = Array.from(document.querySelectorAll('span, p, div, dt, dd, h2, h3, label, strong'));
    for (const node of nodes) {
        if (!visible(node)) continue;
        const value = text(node);
        if (value.length > 250 || !prefix.test(value)) continue;
        let due = parseAmount(value);
        if (!due && labels.test(value)) {
            let parent = node.parentElement;
            for (let depth = 0; parent && depth < 2; depth++, parent = parent.parentElement) {
                const parentText = text(parent);
                if (parentText.length > 250 || !prefix.test(parentText)) break;
                due = parseAmount(parentText);
                if (due) break;
            }
        }
        if (due) {
            dueNodes.push(node);
            if (!amounts.some(a => a.amount === due.amount && a.currency === due.currency)) amounts.push(due);
        }
    }
    // Two different visible totals are ambiguous; never pick a convenient amount.
    const due = amounts.length === 1 ? amounts[0] : null;
    const selector = 'input[type="radio"], [role="radio"], button[aria-pressed], [data-plan][aria-selected]';
    const allLabels = Array.from(document.querySelectorAll('label'));
    const planKey = value => {
        value = value.replace(/[_-]/g, ' ');
        const annual = /annual|yearly|year|按年|年费|年付|每年/i.test(value);
        const monthly = /monthly|month|按月|月费|月付|每月/i.test(value);
        const max20 = /(?:^|\W)20\s*[x×](?:\W|$)|max[_\s-]*200|20倍/i.test(value);
        const max5 = /(?:^|\W)5\s*[x×](?:\W|$)|max[_\s-]*100|5倍/i.test(value);
        if (max20 !== max5) return max20 ? 'max_20x' : 'max_5x';
        if (annual !== monthly) return annual ? 'pro_annual' : 'pro_monthly';
        return null;
    };
    const selectionState = el => {
        const indicators = [el, ...el.querySelectorAll('input[type="radio"], [aria-checked], [aria-pressed], [aria-selected], [data-state]')];
        const known = indicators.some(node => node.matches('input[type="radio"]')
            || ['aria-checked', 'aria-pressed', 'aria-selected'].some(attr => node.hasAttribute(attr))
            || /^(checked|unchecked)$/.test(node.getAttribute('data-state') || ''));
        const selected = indicators.some(node => node.checked === true || node.getAttribute('aria-checked') === 'true'
            || node.getAttribute('aria-pressed') === 'true' || node.getAttribute('aria-selected') === 'true'
            || node.getAttribute('data-state') === 'checked');
        return { stateKnown: known, selected };
    };
    const controls = Array.from(document.querySelectorAll(selector)).map((el, index) => {
        const label = el.labels?.[0] || el.closest('label');
        const container = el.closest('label, [role="radio"]') || el.parentElement;
        const descriptions = [text(label), text(el), text(container), el.getAttribute('aria-label'), el.getAttribute('data-plan'), el.getAttribute('value')];
        let key = null;
        for (const description of descriptions) {
            key = planKey(String(description || ''));
            if (key) break;
        }
        const labelIndex = label && visible(label) ? allLabels.indexOf(label) : -1;
        return { el, key, ...selectionState(el), index, labelIndex, visible: visible(el) || labelIndex >= 0, disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true' };
    }).filter(control => control.key && control.visible);
    // Claude also renders plain div/button plan cards without native/ARIA radios.
    // Identify a product title AND its price, within a sibling group of choices;
    // a summary title or a loose price elsewhere is never a click target.
    const titleKey = value => /^(?:Pro\s+(?:按[月年]计费|月付|年付|Monthly|Annual|Yearly|Billed\s+(?:monthly|annually))|(?:Max\s+)?(?:5|20)\s*[x×](?:\s+(?:usage|用量))?)$/i.test(value)
        ? planKey(value) : null;
    const titles = Array.from(document.querySelectorAll('div, span, p, label, button, h2, h3, h4, strong'))
        .filter(el => visible(el) && titleKey(text(el)) && !Array.from(el.children).some(child => titleKey(text(child))));
    const cardAmount = { pro_monthly: 20, pro_annual: 200, max_5x: 100, max_20x: 200 };
    const cards = [];
    for (const title of titles) {
        const key = titleKey(text(title));
        for (let el = title, depth = 0; el && depth < 5; el = el.parentElement, depth++) {
            const value = text(el);
            if (value.length > 180 || /小计|税费|subtotal|tax|今日应付|Due today|Total due/i.test(value)) break;
            const price = value.match(/(?:USD\s*\$?|US\$|\$)\s*(\d+(?:\.\d{1,2})?)(?![\d.])/i);
            const keys = [...new Set(titles.filter(candidate => el.contains(candidate)).map(candidate => titleKey(text(candidate))))];
            if (price && Number(price[1]) === cardAmount[key] && keys.length === 1 && keys[0] === key) cards.push({ el, key });
        }
    }
    const choiceCards = cards.filter(card => cards.some(other => other.key !== card.key
        && other.el.parentElement === card.el.parentElement));
    const pathFor = el => {
        const parts = [];
        for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
            const tag = node.tagName.toLowerCase();
            const siblings = node.parentElement ? Array.from(node.parentElement.children).filter(s => s.tagName === node.tagName) : [node];
            parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(node) + 1})`);
        }
        return parts.join(' > ');
    };
    for (const card of choiceCards) {
        if (controls.some(c => card.el.contains(c.el) || c.el.contains(card.el))) continue;
        controls.push({ ...card, ...selectionState(card.el), path: pathFor(card.el),
            visible: true, disabled: card.el.disabled === true || card.el.getAttribute('aria-disabled') === 'true' });
    }
    // An official summary's interval/tier is independent selection evidence for
    // nonsemantic cards. Never infer a plan merely from a matching dollar amount.
    const summaryKeys = new Set();
    for (const node of dueNodes) {
        for (let parent = node.parentElement, depth = 0; parent && depth < 5; parent = parent.parentElement, depth++) {
            if (text(parent).length > 1000 || controls.some(c => parent.contains(c.el))) break;
            const keys = [...new Set(titles.filter(title => parent.contains(title)).map(title => titleKey(text(title))))];
            if (keys.length > 1) break;
            if (keys.length === 1) { summaryKeys.add(keys[0]); break; }
        }
    }
    const summaryPlan = summaryKeys.size === 1 ? [...summaryKeys][0] : null;
    let selected = [...new Set(controls.filter(c => c.selected).map(c => c.key))];
    if (!controls.some(c => c.stateKnown) && summaryPlan) selected = [summaryPlan];
    const control = controls.find(c => c.key === expected?.key && !c.disabled);
    const pointerTarget = control?.labelIndex >= 0 ? allLabels[control.labelIndex] : control?.el;
    const rect = pointerTarget?.getBoundingClientRect();
    const hit = rect ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) : null;
    const receivesPointer = Boolean(hit && (hit === pointerTarget || pointerTarget.contains(hit)));
    const loadingSkeleton = Array.from(document.querySelectorAll('[data-cds-portal] .animate-pulse, [aria-busy="true"]'))
        .some(el => visible(el));
    const target = control ? { key: control.key, index: control.index, labelIndex: control.labelIndex, path: control.path } : null;
    const stripePaymentFrameCount = Array.from(document.querySelectorAll('iframe')).filter(el => {
        try { return visible(el) && new URL(el.src).hostname === 'js.stripe.com'
            && /elements-inner-(?:payment|card)|embedded-checkout/i.test(new URL(el.src).pathname); }
        catch (_) { return false; }
    }).length;
    const result = { due, dueConflict: amounts.length > 1, selected, target, selector, summaryPlan, summaryConflict: summaryKeys.size > 1,
        controlCount: controls.length, titleCount: titles.length, receivesPointer, loadingSkeleton, stripePaymentFrameCount,
        connectionError: /Can't reach Claude|无法连接\s*Claude/i.test(text(document.body)),
        formLoadError: /支付表单加载失败|Failed to load payment form|Error loading payment form/i.test(text(document.body)) };
    if (result.connectionError) return result;
    if (waitFor === 'controls' && !target && !result.formLoadError) return false;
    if (waitFor === 'recovered_controls' && (!target || result.formLoadError)) return false;
    if (waitFor === 'actionable' && (!target || !receivesPointer)) return false;
    if (waitFor === 'confirmed' && !(selected.length === 1 && selected[0] === expected.key && !result.summaryConflict
        && (!summaryPlan || summaryPlan === expected.key) && due
        && due.currency === expected.currency && Math.abs(due.amount - expected.amount) < 0.005)) return false;
    return result;
}

async function readClaudeCheckoutSnapshot(page, planType = 'claude_pro') {
    return page.evaluate(checkoutSnapshotInBrowser, { expected: getClaudePlanRule(planType) });
}

function assertClaudeSnapshot(snapshot, rule) {
    if (!snapshot.target || snapshot.selected.length !== 1 || snapshot.selected[0] !== rule.key || snapshot.summaryConflict
        || (snapshot.summaryPlan && snapshot.summaryPlan !== rule.key) || !snapshot.due
        || snapshot.due.currency !== rule.currency || Math.abs(snapshot.due.amount - rule.amount) >= 0.005) {
        throw Object.assign(new Error(`[Claude 资金安全拦截] 无法确认 ${rule.label} 与当前应付 ${rule.currency} ${rule.amount} 一致，已停止支付`), { code: 'CLAUDE_CHECKOUT_MISMATCH' });
    }
    return snapshot.due;
}

function assertClaudeRoute(page, rule) {
    const url = new URL(page.url());
    if (url.hostname !== 'claude.ai' || !new RegExp(`^/upgrade/${rule.route}/?$`).test(url.pathname)) {
        throw Object.assign(new Error('Claude 收银台产品路由与目标套餐不一致，已停止支付'), { code: 'CLAUDE_CHECKOUT_ROUTE_MISMATCH' });
    }
}

async function assertClaudeCheckoutReady(page, planType) {
    const rule = getClaudePlanRule(planType);
    assertClaudeRoute(page, rule);
    const snapshot = await readClaudeCheckoutSnapshot(page, planType);
    if (snapshot.connectionError) throw buildClaudeNavigationError('network');
    return assertClaudeSnapshot(snapshot, rule);
}

function buildClaudeLoadingError() {
    const code = 'CLAUDE_CHECKOUT_LOADING_TIMEOUT';
    return Object.assign(new Error(`Claude 收银台仍在加载，套餐控件或最终应付金额尚未就绪，请稍后重试；尚未提交支付 [${code}]`), { code });
}

function buildClaudeInteractionError() {
    const code = 'CLAUDE_CHECKOUT_INTERACTION_TIMEOUT';
    return Object.assign(new Error(`Claude 套餐按钮被遮挡或暂时无法操作，请稍后重试；尚未提交支付 [${code}]`), { code });
}

function planLocator(page, snapshot) {
    const target = snapshot.target;
    return target.path ? page.locator(target.path)
        : target.labelIndex >= 0 ? page.locator('label').nth(target.labelIndex) : page.locator(snapshot.selector).nth(target.index);
}

async function waitSnapshot(page, expected, waitFor, timeout, waitPolicy) {
    let handle;
    const deadline = performance.now() + timeout;
    while (!handle) {
        try {
            waitPolicy?.assertNetwork();
            const stageMs = deadline - performance.now();
            const probeMs = waitPolicy ? Math.max(1, Math.min(500, waitPolicy.remaining(), stageMs > 0 ? stageMs : 500)) : timeout;
            handle = await page.waitForFunction(checkoutSnapshotInBrowser, { expected, waitFor }, { timeout: probeMs, polling: 100 });
        } catch (error) {
            if (error.name !== 'TimeoutError' || page.isClosed()) throw error;
            const snapshot = await page.evaluate(checkoutSnapshotInBrowser, { expected });
            if (snapshot.connectionError) throw buildClaudeNavigationError('network');
            if (waitPolicy?.canContinue(snapshot, deadline, waitFor)) continue;
            console.warn(`[Claude] 就绪检查未通过: stage=${waitFor}, controls=${snapshot.controlCount}, titles=${snapshot.titleCount}, selected=${snapshot.selected.join(',') || '未确认'}, summary=${snapshot.summaryPlan || '未确认'}, due=${snapshot.due ? snapshot.due.currency + ' ' + snapshot.due.amount : '未确认'}, pointer=${snapshot.receivesPointer}, skeleton=${snapshot.loadingSkeleton}, stripePaymentFrames=${snapshot.stripePaymentFrameCount}`);
            if (waitFor === 'confirmed') {
                const planConflict = snapshot.summaryConflict || (snapshot.summaryPlan && snapshot.summaryPlan !== expected.key)
                    || snapshot.selected.length > 1 || snapshot.selected.some(key => key !== expected.key);
                // A missing final total is not a wrong total. A subtotal cannot
                // replace it, and two conflicting totals must remain a hard stop.
                if (!snapshot.due && !snapshot.dueConflict && !planConflict) throw buildClaudeLoadingError();
                assertClaudeSnapshot(snapshot, expected);
                // The official total can finish between the deadline and this read.
                return snapshot;
            }
            if (snapshot.loadingSkeleton || snapshot.formLoadError) throw buildClaudeLoadingError();
            if (waitFor === 'actionable') throw buildClaudeInteractionError();
            const code = 'CLAUDE_CHECKOUT_CONTROLS_TIMEOUT';
            throw Object.assign(new Error(`Claude 收银台套餐选项识别超时，请稍后重试；尚未提交支付 [${code}]`), { code });
        }
    }
    try {
        const snapshot = await handle.jsonValue();
        if (snapshot.connectionError) throw buildClaudeNavigationError('network');
        waitPolicy?.noteProgress(snapshot);
        return snapshot;
    } finally { await handle.dispose(); }
}

async function selectClaudePlan(page, planType = 'claude_pro', options = {}) {
    const started = performance.now();
    const rule = getClaudePlanRule(planType);
    assertClaudeRoute(page, rule);
    const readinessTimeoutMs = options.timeoutMs ?? 30000;
    const confirmationTimeoutMs = options.confirmationTimeoutMs ?? Math.min(15000, readinessTimeoutMs);
    const deadline = performance.now() + readinessTimeoutMs;
    const remaining = () => Math.max(1, deadline - performance.now());
    const actionBudget = () => options.waitPolicy ? Math.max(1, options.waitPolicy.remaining()) : remaining();
    console.log(`[Claude] 核验套餐 ${rule.label}，目标应付 ${rule.currency} ${rule.amount}...`);
    let snapshot = await waitSnapshot(page, rule, options.afterRecovery ? 'recovered_controls' : 'controls', remaining(), options.waitPolicy);
    if (snapshot.formLoadError) {
        // Initial checkout preparation owns one combined Retry/reload budget.
        // Later strict plan checks retain their existing no-reload behavior.
        if (options.waitPolicy) throw buildClaudeLoadingError();
        const retry = page.getByRole('button', { name: /^重试$|^Retry$/i }).first();
        if (!await retry.isVisible()) throw new Error('Claude 官方支付表单加载失败');
        await retry.click({ timeout: Math.min(3000, remaining()) });
        snapshot = await waitSnapshot(page, rule, 'recovered_controls', remaining());
    }
    if (!snapshot.target) throw new Error('Claude 目标套餐控件尚未就绪');
    try {
        await planLocator(page, snapshot).scrollIntoViewIfNeeded({ timeout: Math.min(3000, actionBudget()) });
    } catch (error) {
        if (error.name !== 'TimeoutError' || page.isClosed()) throw error;
        const current = await readClaudeCheckoutSnapshot(page, planType);
        if (current.connectionError) throw buildClaudeNavigationError('network');
        throw current.loadingSkeleton ? buildClaudeLoadingError() : buildClaudeInteractionError();
    }
    snapshot = await waitSnapshot(page, rule, 'actionable', remaining(), options.waitPolicy);
    if (snapshot.selected.length !== 1 || snapshot.selected[0] !== rule.key) {
        // Refresh the locator after loading/remounting. A blocker returning
        // between the hit test and click is still handled by Playwright normally.
        try {
            await planLocator(page, snapshot).click({ timeout: Math.min(8000, actionBudget()) });
        } catch (error) {
            if (error.name !== 'TimeoutError' || page.isClosed()) throw error;
            const current = await readClaudeCheckoutSnapshot(page, planType);
            if (current.connectionError) throw buildClaudeNavigationError('network');
            throw current.loadingSkeleton ? buildClaudeLoadingError() : buildClaudeInteractionError();
        }
        console.log('[Claude] 已单次点击目标套餐，等待官方金额更新...');
    }
    // Readiness and amount updates have separate bounded budgets. A plan that
    // becomes actionable near 30s still gets up to 15s to finish its official
    // total; a ready total continues immediately. Preserve the classified error
    // from waitSnapshot instead of replacing loading with a price mismatch.
    snapshot = await waitSnapshot(page, rule, 'confirmed', confirmationTimeoutMs, options.waitPolicy);
    assertClaudeRoute(page, rule);
    const due = assertClaudeSnapshot(snapshot, rule);
    console.log(`[Claude] ✅ 套餐确认完成: ${rule.label}, ${due.currency} ${due.amount}（${Math.round(performance.now() - started)}ms）`);
    return due;
}

async function ensureClaudePlanSelection(page, planType = 'claude_pro', options = {}) {
    const ownsObserver = !options.networkObserver;
    const observer = options.networkObserver || observeClaudeNavigation(page);
    try { return await selectClaudePlan(page, planType, options); }
    catch (error) {
        if (ownsObserver) console.warn(`[Claude/checkout] 官方请求诊断: ${observer.summary()}; ${observer.details()}`);
        throw error;
    } finally { if (ownsObserver) observer.dispose(); }
}

module.exports = { getClaudePlanRule, checkoutSnapshotInBrowser, readClaudeCheckoutSnapshot,
    assertClaudeCheckoutReady, ensureClaudePlanSelection };
