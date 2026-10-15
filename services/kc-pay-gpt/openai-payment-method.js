'use strict';

const { isTrustedStripeFrame, isExcludedCardFrame, isStripePaymentAccessoryFrame } = require('./stripe-payment-frame');

const CARD_NAME = /^(?:Card|Credit or debit card|Debit or credit card|信用卡|银行卡|借记卡或信用卡|信用卡或借记卡)$/i;
const OTHER_NAME = /^(?:PayPal|Apple Pay|Google Pay|Link)$/i;
const OTHER_SELECTED = /^(?:PayPal|Apple Pay|Google Pay|Link)\s+(?:is\s+)?selected(?:[.。!]|$)|^(?:已选择|已選擇)\s*(?:PayPal|Apple Pay|Google Pay|Link)(?:[。.\s]|$)/i;

function methodError(code, message) {
    return Object.assign(new Error(`${message}，尚未提交付款 [${code}]`), { code });
}

async function methodContexts(page) {
    const contexts = [page];
    for (const frame of page.frames()) {
        if (frame === page.mainFrame() || frame.isDetached()) continue;
        if (!isTrustedStripeFrame(frame.url()) || isExcludedCardFrame(frame.url())) continue;
        const element = await frame.frameElement().catch(() => null);
        if (element && await element.isVisible().catch(() => false)) contexts.push(frame);
    }
    return contexts;
}

async function visibleOptions(context, name, card = false) {
    let locator = context.getByRole('button', { name }).or(context.getByRole('tab', { name }))
        .or(context.getByRole('radio', { name })).or(context.locator('label').filter({ hasText: name }));
    if (card) locator = locator.or(context.locator('[data-testid="card-tab"], [data-testid="CARD-tab"], [data-testid="payment-method-card"]'));
    // Icon text or a nested description may make the control's accessible name
    // longer than "Card". Resolve an exact visible label to its closest control;
    // never use a general ancestor container or checkout submit button.
    const labelledControl = context.getByText(name).locator('xpath=ancestor-or-self::*[self::button or self::label or @role="button" or @role="tab" or @role="radio"][1]');
    locator = locator.or(labelledControl);
    const options = [];
    for (let i = 0, count = await locator.count(); i < count; i++) {
        const target = locator.nth(i);
        if (!await target.isVisible().catch(() => false)) continue;
        // Prefer the labelled control's wrapper so hidden radios remain clickable,
        // while avoiding two candidates for the same label/input pair.
        const insideLabel = await target.evaluate(el => el.tagName === 'INPUT' && el.labels?.length > 0).catch(() => false);
        if (insideLabel) continue;
        const selected = await target.evaluate(el => {
            const input = el.matches('input[type="radio"]') ? el : el.tagName === 'LABEL' ? el.control : null;
            if (input?.type === 'radio') return input.checked;
            for (const attr of ['aria-selected', 'aria-checked', 'aria-pressed', 'aria-expanded', 'data-selected']) {
                if (el.getAttribute(attr) === 'true') return true;
                if (el.getAttribute(attr) === 'false') return false;
            }
            const state = el.getAttribute('data-state');
            if (['active', 'checked', 'selected'].includes(state)) return true;
            if (['inactive', 'unchecked', 'unselected'].includes(state)) return false;
            return null;
        }).catch(() => null);
        options.push({ target, selected });
    }
    return options;
}

async function readOpenAiPaymentMethod(page) {
    const cards = [];
    let otherSelected = false;
    const contexts = await methodContexts(page);
    for (const context of contexts) {
        cards.push(...await visibleOptions(context, CARD_NAME, true));
        const other = await visibleOptions(context, OTHER_NAME);
        if (other.some(option => option.selected === true)) otherSelected = true;
        const copy = context.getByText(OTHER_SELECTED);
        for (let i = 0, count = await copy.count(); i < count; i++) {
            if (await copy.nth(i).isVisible().catch(() => false)) otherSelected = true;
        }
    }
    return { cards, otherSelected, contextCount: contexts.length,
        paymentAccessoryCount: contexts.filter(context => context !== page && isStripePaymentAccessoryFrame(context.url())).length };
}

// One native Card click per fill attempt. Rendering and filling share the caller's
// deadline; changing a payment method never clicks a checkout/submit button.
function createOpenAiCardMethodGuard(page, deadline) {
    let clicked = false;
    let methodDeadline = null;
    let lastDiagnostic = '';
    let confirmed = false;
    return {
        async prepare(fieldsReady) {
            const { cards, otherSelected, contextCount, paymentAccessoryCount } = await readOpenAiPaymentMethod(page);
            const diagnostic = `contexts=${contextCount}, paymentAccessory=${paymentAccessoryCount}, cardOptions=${cards.length}, otherSelected=${otherSelected}`;
            if (diagnostic !== lastDiagnostic) {
                console.log(`[Stripe/Card-method] ${diagnostic}`);
                lastDiagnostic = diagnostic;
            }
            if (cards.length > 1) throw methodError('OPENAI_CARD_METHOD_AMBIGUOUS', '无法唯一确认 ChatGPT 的 Card 付款方式');
            const card = cards[0];
            const needsSelection = otherSelected || card?.selected === false
                || (card && card.selected !== true && !fieldsReady && !clicked);
            if (!needsSelection) {
                if (fieldsReady && !confirmed) {
                    console.log('[Stripe] ✅ Card 可用银行卡表单已确认');
                    confirmed = true;
                }
                return true;
            }
            methodDeadline ??= Math.min(deadline, Date.now() + 5000);
            if (!clicked && card && await card.target.isEnabled().catch(() => false)) {
                if (Date.now() >= deadline) return false;
                console.log('[Stripe] 正在单次选择 ChatGPT 的 Card 付款方式...');
                clicked = true;
                try {
                    await card.target.click({ timeout: Math.max(1, Math.min(2000, deadline - Date.now())) });
                } catch (_) {
                    throw methodError('OPENAI_CARD_METHOD_NOT_SELECTED', 'ChatGPT 收银台无法切换至 Card');
                }
                return false;
            }
            if (Date.now() >= methodDeadline) {
                throw methodError(card ? 'OPENAI_CARD_METHOD_NOT_SELECTED' : 'OPENAI_CARD_METHOD_NOT_FOUND',
                    card ? 'ChatGPT 收银台尚未确认切换至 Card' : 'ChatGPT 收银台选择了其他付款方式，未找到可用的 Card 入口');
            }
            return false;
        },
        async assertReady({ fieldsReady = false } = {}) {
            const { cards, otherSelected } = await readOpenAiPaymentMethod(page);
            if (cards.length > 1 || otherSelected || cards[0]?.selected === false) {
                throw methodError('OPENAI_CARD_METHOD_CHANGED', 'ChatGPT 收银台付款方式已变化或无法确认 Card');
            }
            if (cards[0]?.selected !== true && !fieldsReady) {
                throw methodError(cards.length ? 'OPENAI_CARD_METHOD_NOT_SELECTED' : 'OPENAI_CARD_METHOD_NOT_FOUND',
                    '未确认 ChatGPT 的 Card 付款方式或可用银行卡表单');
            }
        }
    };
}

module.exports = { createOpenAiCardMethodGuard };
