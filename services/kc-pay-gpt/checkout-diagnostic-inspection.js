'use strict';

const { createOpenAiCardMethodGuard } = require('./openai-payment-method');
const { isExcludedCardFrame } = require('./stripe-payment-frame');
const { assertClaudeCheckoutReady, getClaudePlanRule } = require('./claude-checkout-state');
const { assertNativeCheckoutReady, checkoutDialog } = require('./grok-native-checkout');
const { getGrokPlan } = require('./grok-checkout-state');
const { isBundle } = require('./public/grok-plan-catalog');
const { getRegionConfig, PLATFORM_CONFIG } = require('./region-config');

// Exact HTTPS hosts only. No suffix matching, arbitrary checkout URL, or form values.
const STRIPE_CARD_HOSTS = new Set(['js.stripe.com', 'hooks.stripe.com', 'checkout.stripe.com']);
const CARD_FIELDS = [
    { id: 'card-number', label: '卡号字段', selector: 'input#payment-numberInput,input[autocomplete="cc-number"],input[name="cardnumber"],input[name="number"],input[aria-label*="Card number" i],input[data-elements-stable-field-name="cardNumber"]' },
    { id: 'card-expiry', label: '有效期字段', selector: 'input#payment-expiryInput,input[autocomplete="cc-exp"],input[name="exp-date"],input[name="expiry"],input[aria-label*="Expiration" i],input[aria-label*="expiry" i],input[data-elements-stable-field-name="cardExpiry"]' },
    { id: 'card-cvc', label: 'CVC 字段', selector: 'input#payment-cvcInput,input[autocomplete="cc-csc"],input[name="cvc"],input[name="card-cvc"],input[name="cardCvc"],input[aria-label*="CVC" i],input[aria-label*="security code" i],input[data-elements-stable-field-name="cardCvc"]' }
];
const check = (id, label, status, message) => ({ id, label, status, message });
function diagnosticError(code, message) {
    return Object.assign(new Error(`${message} [${code}]`), { code });
}
function trustedUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.port && !url.username && !url.password ? url : null;
    } catch (_) { return null; }
}
function assertOrigin(page, platform, native) {
    if (page.isClosed()) throw diagnosticError('CHECKOUT_PAGE_CLOSED', '诊断页面已关闭');
    const url = trustedUrl(page.url());
    const allowed = url && (platform === 'claude' ? url.hostname === 'claude.ai' && /^\/upgrade\/(?:pro|max)\/?$/.test(url.pathname)
        : platform === 'grok' ? url.hostname === 'grok.com' && url.pathname === '/plans'
            : url.hostname === 'chatgpt.com' && /^\/checkout(?:\/|$)/.test(url.pathname)
                    || url.hostname === 'pay.openai.com' && /^\/(?:c|checkout)\//.test(url.pathname)
                    || url.hostname === 'checkout.stripe.com' && /^\/c\/pay\//.test(url.pathname));
    if (!allowed) throw diagnosticError('CHECKOUT_DIAGNOSTIC_UNTRUSTED', '诊断仅允许官方收银台');
}

async function scanFields(page, { native = false } = {}) {
    const contexts = native ? [] : [page];
    const dialog = native ? await checkoutDialog(page) : null;
    for (const frame of page.frames()) {
        if (frame === page.mainFrame() || frame.isDetached()) continue;
        const url = trustedUrl(frame.url());
        if (!url || !STRIPE_CARD_HOSTS.has(url.hostname) || isExcludedCardFrame(frame.url())) continue;
        const element = await frame.frameElement().catch(() => null);
        if (!element || !await element.isVisible().catch(() => false)) continue;
        if (native && (url.hostname !== 'js.stripe.com'
            || !/^\/v3\/elements-inner-(?:payment|accessory-target)-[\w-]+\.html$/.test(url.pathname)
            || !await dialog.evaluate((node, iframe) => node.contains(iframe), element))) continue;
        contexts.push(frame);
    }
    const fields = [];
    for (const spec of CARD_FIELDS) {
        let visible = 0, editable = 0;
        for (const context of contexts) {
            const candidates = context.locator(spec.selector);
            for (let i = 0, count = await candidates.count(); i < count; i++) {
                const input = candidates.nth(i);
                if (!await input.isVisible().catch(() => false)) continue;
                visible++;
                if (await input.isEditable({ timeout: 200 }).catch(() => false)) editable++;
            }
        }
        fields.push({ ...spec, visible, editable });
    }
    return fields;
}

// Read bounded order-summary evidence only. No input values or account/session data.
function openAiSnapshotInBrowser({ expectedProduct, expectedTier }) {
    const visible = el => Boolean(el?.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    const text = el => String(el?.innerText || '').replace(/[\u200e\u200f\u2066-\u2069]/g, '').replace(/\u00a0/g, ' ').trim();
    const containers = [...document.querySelectorAll('aside,[data-testid="order-summary"],[data-testid="product-summary"],.ProductSummary,.OrderSummary')]
        .filter(visible).filter(el => text(el).length < 3000);
    const names = value => [...value.matchAll(/\b(?:ChatGPT\s+)?(Go|Plus|Pro)\s+(?:plan|subscription)\b|\bChatGPT\s+(Go|Plus|Pro)\b/gi)]
        .map(match => (match[1] || match[2]).toLowerCase());
    const dueLabel = /^(?:Due today|Total due(?: today)?|Amount due(?: today)?|Pay today|今日应付总额|今日应付|今天应付|应付总额|应付金额|总计|Total)\s*[:：]?\s*/i;
    const month = /per\s+month|\/\s*(?:month|mo)\b|monthly|每月|按月|月付|\/月/i;
    const year = /per\s+year|\/\s*(?:year|yr)\b|annually|annual|yearly|每年|按年|年付|\/年/i;
    const money = value => {
        const currencies = { USD: 'USD', 'US$': 'USD', PHP: 'PHP', '₱': 'PHP', EGP: 'EGP', CLP: 'CLP', SGD: 'SGD', MYR: 'MYR', EUR: 'EUR', '€': 'EUR', GBP: 'GBP', '£': 'GBP' };
        const raw = value.replace(dueLabel, '').trim();
        const match = /^(USD|US\$|PHP|₱|EGP|CLP|SGD|MYR|EUR|€|GBP|£|\$)\s*\$?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s*$/i.exec(raw)
            || /^((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s*(USD|PHP|EGP|CLP|SGD|MYR|EUR|GBP)\s*$/i.exec(raw);
        if (!match) return null;
        const reverse = /^\d/.test(match[1]), currencyText = reverse ? match[2] : match[1];
        return { amount: Number((reverse ? match[1] : match[2]).replace(/,/g, '')), currency: currencies[currencyText.toUpperCase()] || null };
    };
    const products = new Set(), intervals = new Set(), dues = [];
    let busy = false;
    for (const container of containers) {
        const content = text(container);
        for (const name of names(content)) products.add(name);
        if (month.test(content)) intervals.add('month');
        if (year.test(content)) intervals.add('year');
        busy ||= [...container.querySelectorAll('[aria-busy="true"],[data-testid*="skeleton"]')].some(visible);
        for (const node of container.querySelectorAll('span,p,div,dt,dd,strong,[data-testid="total-amount"],[data-testid="amount-due"]')) {
            if (!visible(node)) continue;
            const value = text(node);
            let due = null;
            if (value.length < 160 && dueLabel.test(value)) {
                due = money(value);
                if (!due && /[:：]?\s*$/.test(value)) due = money(text(node.nextElementSibling));
                if (!due && node.parentElement && text(node.parentElement).length < 160 && dueLabel.test(text(node.parentElement))) due = money(text(node.parentElement));
            } else if (node.matches('[data-testid="total-amount"],[data-testid="amount-due"]')) due = money(value);
            if (due && due.amount > 0 && !dues.some(item => item.amount === due.amount && item.currency === due.currency)) dues.push(due);
        }
    }
    const tierFor = value => /^Standard$|^标准$/i.test(value) ? 'standard' : /^More\s*usage$|^较高用量$|^更多用量$/i.test(value) ? 'more'
        : /^Max\s*usage$|^最高用量$|^最大用量$/i.test(value) ? 'max' : null;
    const selectedTiers = new Set();
    for (const el of document.querySelectorAll('input[type="radio"],[role="radio"],button[aria-checked],button[aria-pressed],[data-state],[aria-selected]')) {
        const label = el.labels?.[0] || el.closest('label');
        if (!visible(el) && !visible(label)) continue;
        const selected = el.checked === true || ['aria-checked', 'aria-pressed', 'aria-selected'].some(attr => el.getAttribute(attr) === 'true')
            || ['checked', 'selected', 'active'].includes(el.getAttribute('data-state'));
        if (!selected) continue;
        const labels = [el.getAttribute('aria-label'), text(el), text(label), ...[...el.querySelectorAll('span,p,div')].map(text)].filter(Boolean);
        for (const value of labels) { const tier = tierFor(value); if (tier) selectedTiers.add(tier); }
    }
    return { product: products.size === 1 ? [...products][0] : null, productConflict: products.size > 1,
        wrongProduct: products.size === 1 && !products.has(expectedProduct),
        interval: intervals.size === 1 ? [...intervals][0] : null, intervalConflict: intervals.size > 1,
        due: dues.length === 1 ? dues[0] : null, dueConflict: dues.length > 1,
        tier: selectedTiers.size === 1 ? [...selectedTiers][0] : null,
        tierMismatch: selectedTiers.size > 1 || selectedTiers.size === 1 && !selectedTiers.has(expectedTier), busy };
}

// timeoutMs covers form rendering/Card selection only (default 5s, capped at 15s).
// Never fill card/address fields, accept terms, reserve assets, or submit payment.
async function inspectDiagnosticCheckout(page, { platform, planType, region, checkoutResult, commerceObserver, timeoutMs = 5000 } = {}) {
    const checks = [];
    let activeCheck = { id: 'checkout-origin', label: '官方收银台' };
    const add = (id, label, status, message) => {
        const item = check(id, label, status, message), index = checks.findIndex(entry => entry.id === id);
        if (index >= 0) checks[index] = item;
        else checks.push(item);
    };
    try {
        if (!['chatgpt', 'claude', 'grok'].includes(platform)) throw diagnosticError('CHECKOUT_DIAGNOSTIC_PLATFORM_UNSUPPORTED', '不支持的诊断平台');
        const observer = commerceObserver || checkoutResult?.commerceObserver;
        if (platform === 'grok' && !isBundle(planType)) throw diagnosticError('GROK_PLAN_UNSUPPORTED', '诊断只支持当前新版 Grok 组合订阅');
        const native = platform === 'grok';
        assertOrigin(page, platform, native);
        add('checkout-origin', '官方收银台', 'passed', '已确认可信 HTTPS 收银台');
        let product = null, interval = null, amount = null, currency = null;
        async function readQuote() {
            activeCheck = { id: 'product', label: '套餐与订单汇总' };
            if (platform === 'claude') {
                const rule = getClaudePlanRule(planType), due = await assertClaudeCheckoutReady(page, planType);
                product = rule.route === 'pro' ? 'Claude Pro' : rule.key === 'max_5x' ? 'Claude Max 5x' : 'Claude Max 20x';
                interval = rule.key === 'pro_annual' ? 'year' : 'month';
                ({ amount, currency } = due);
                add('product', '套餐与订单汇总', 'passed', '官方选中套餐、周期和应付金额一致');
                add('interval', '计费周期', 'passed', interval === 'year' ? '年付' : '月付');
                add('amount', '当前应付金额', 'passed', `${currency} ${amount}`);
                add('currency', '币种', 'passed', currency);
            } else if (platform === 'grok') {
                const plan = getGrokPlan(planType);
                if (!observer || observer.plan?.key !== plan.key) throw diagnosticError('GROK_COMMERCE_UNCONFIRMED', '缺少与本次套餐关联的官方 Commerce 观测');
                const due = await assertNativeCheckoutReady(page, observer, { final: false });
                product = `The X Subscription ${plan.name}`;
                interval = plan.interval;
                ({ amount, currency } = due);
                add('product', '套餐与订单汇总', 'passed', '官方产品、周期和本次报价一致');
                add('interval', '计费周期', 'passed', interval === 'year' ? '年付' : '月付');
                add('amount', '当前应付金额', 'passed', `${currency} ${amount}（未填地址前的报价）`);
                add('currency', '币种', 'passed', currency);
            } else {
                const canonical = ({ pro_5x: 'pro_100', pro5x: 'pro_100', pro_20x: 'pro_200', pro20x: 'pro_200' })[planType] || planType;
                if (!['go', 'plus', 'pro_100', 'pro_200', 'pro_500'].includes(canonical)) throw diagnosticError('CHATGPT_PLAN_UNSUPPORTED', '不支持的 ChatGPT 诊断套餐');
                const expectedProduct = canonical.startsWith('pro') ? 'pro' : canonical;
                const expectedTier = ({ pro_100: 'standard', pro_200: 'more', pro_500: 'max' })[canonical];
                const snapshot = await page.evaluate(openAiSnapshotInBrowser, { expectedProduct, expectedTier });
                const expectedCurrency = getRegionConfig(region)?.currency;
                if (snapshot.productConflict || snapshot.wrongProduct || snapshot.intervalConflict || snapshot.interval === 'year'
                    || snapshot.dueConflict || expectedTier && snapshot.tierMismatch) {
                    throw diagnosticError('CHATGPT_CHECKOUT_MISMATCH', '官方订单汇总与目标套餐、周期或币种冲突');
                }
                product = snapshot.product ? `ChatGPT ${snapshot.product === 'pro' ? 'Pro' : snapshot.product === 'plus' ? 'Plus' : 'Go'}` : null;
                interval = snapshot.interval;
                amount = snapshot.due?.amount ?? null;
                currency = snapshot.due?.currency ?? null;
                const productConfirmed = Boolean(product && (!expectedTier || snapshot.tier === expectedTier) && !snapshot.busy);
                add('product', '套餐与订单汇总', productConfirmed ? 'passed' : 'unconfirmed', productConfirmed ? '已读取官方产品及选中用量档位' : '缺少唯一官方产品或选中用量档位证据');
                add('interval', '计费周期', interval && !snapshot.busy ? 'passed' : 'unconfirmed', interval === 'month' ? '月付' : '缺少唯一官方计费周期证据');
                const referenceAmount = expectedCurrency === 'USD' ? PLATFORM_CONFIG.chatgpt.plans[canonical]?.amount : null;
                const referenceMatches = referenceAmount == null || amount != null && Math.abs(amount - referenceAmount) < 0.005;
                add('amount', '当前应付金额', amount && !snapshot.busy && referenceMatches ? 'passed' : 'unconfirmed', amount
                    ? `${currency || '币种未确认'} ${amount}${referenceMatches ? '' : '；官方报价与目录参考价不同，需核对优惠/税费/价格更新'}`
                    : '未读取到唯一官方应付金额，不使用套餐配置猜测');
                const currencyConfirmed = Boolean(currency && currency === expectedCurrency && !snapshot.busy);
                add('currency', '币种', currencyConfirmed ? 'passed' : 'unconfirmed', currencyConfirmed ? currency
                    : currency ? `${currency} 与所选地区的预期币种未确认一致` : '缺少明确币种；单独 $ 符号不能确认 USD');
            }
        }
        await readQuote();

        activeCheck = { id: 'form', label: '银行卡表单' };
        const deadline = Date.now() + Math.min(15000, Math.max(0, Number(timeoutMs) || 0));
        const methodGuard = platform === 'chatgpt' ? createOpenAiCardMethodGuard(page, deadline) : null;
        let fields;
        do {
            assertOrigin(page, platform, native);
            fields = await scanFields(page, { native });
            if (fields.some(field => field.editable > 1)) throw diagnosticError('CHECKOUT_DIAGNOSTIC_CARD_FIELDS_AMBIGUOUS', '存在多个可编辑的银行卡字段');
            const fieldsReady = fields.every(field => field.editable === 1);
            const methodReady = methodGuard ? await methodGuard.prepare(fieldsReady) : true;
            if (fieldsReady && methodReady) {
                if (methodGuard) await methodGuard.assertReady({ fieldsReady: true });
                break;
            }
            if (Date.now() >= deadline) break;
            await page.waitForTimeout(Math.min(100, Math.max(1, deadline - Date.now())));
        } while (true);
        for (const field of fields) add(field.id, field.label, field.editable === 1 ? 'passed' : 'failed', field.editable === 1
            ? '字段存在、可见且可编辑；未读取或填写字段值' : field.visible ? '可见字段不可编辑' : '未发现可信的可见字段');
        if (!fields.every(field => field.editable === 1)) throw diagnosticError('CHECKOUT_DIAGNOSTIC_CARD_FIELDS_NOT_READY', '银行卡三字段未全部就绪');
        if (methodGuard) await methodGuard.assertReady({ fieldsReady: true });
        add('form', '银行卡表单', 'passed', '卡号、有效期及 CVC 三字段均存在且可编辑；未填写或提交');
        if (methodGuard) add('payment-method', '银行卡付款方式', 'passed', 'Card 表单已确认；至多选择一次 Card');
        assertOrigin(page, platform, native);
        // Method selection and async form rendering may also replace the quote.
        await readQuote();
        add('tax', '地址与最终税费', 'skipped', '诊断未填写账单地址，未确认地址税费或提交付款');
        return { kind: native || platform === 'claude' ? 'native' : 'hosted', product, interval, amount, currency,
            confirmed: checks.every(item => ['passed', 'skipped'].includes(item.status)), checks };
    } catch (error) {
        add(activeCheck.id, activeCheck.label, 'failed', '诊断检查未通过；未填写或提交付款');
        if (!error.code) error.code = 'CHECKOUT_DIAGNOSTIC_INSPECTION_FAILED';
        error.diagnosticChecks = checks;
        throw error;
    }
}

module.exports = { inspectDiagnosticCheckout };
