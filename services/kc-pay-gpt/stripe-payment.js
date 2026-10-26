/**
 * Stripe Payment Automation Module
 *
 * 在 Stripe Checkout 页面自动完成信用卡支付：
 * - 选择信用卡支付方式
 * - 填写卡号、有效期、CVC（通过 Stripe iframe）
 * - 填写持卡人姓名和账单地址
 * - 模拟人类输入行为（逐字符、随机延迟 50-200ms）
 * - 勾选服务协议、提交支付表单
 * - 检测支付结果（redirect_status=succeeded）
 */

const fs = require('fs');
const path = require('path');
const {
    isHumanVerificationVisible,
    clearHumanVerification,
    buildCaptchaRequiredError,
    hasCheckoutCaptchaOverlayText,
    isCheckoutOverlayCaptchaVisible,
    hasAnyCheckoutCaptchaSignal
} = require('./human-verification');
const { ensureClaudePlanSelection, assertClaudeCheckoutReady } = require('./claude-checkout-state');
const { observeClaudePayment, readClaudePaymentSnapshot, hasNewClaudeProEntitlement, waitForClaudePaymentOutcome } = require('./claude-payment-observer');
const { getClaudeAccountSnapshot, readClaudeAccountInBrowser } = require('./claude-auth');

const { assertGrokCheckoutReady, waitForGrokCheckoutReady, grokError } = require('./grok-checkout-state');
const { fillGrokBilling, assertGrokBillingReady } = require('./grok-billing');
const { observeGrokPayment, readGrokPaymentSnapshot, clickGrokSubmitOnce, waitForGrokPaymentOutcome } = require('./grok-payment-observer');
const { isBundle: isGrokBundle } = require('./public/grok-plan-catalog');
const { completeGrokCommercePayment } = require('./grok-native-payment');
const { createOpenAiCardMethodGuard } = require('./openai-payment-method');
const { isTrustedStripeFrame, isExcludedCardFrame } = require('./stripe-payment-frame');

// ==================== Helper Functions ====================

/**
 * 返回 50-200 之间的随机整数（含两端），用于模拟人类打字延迟
 * @returns {number}
 */
function getTypingDelay() {
    return Math.floor(Math.random() * 21) + 15; // 15ms to 35ms (realistic human typing cadence with micro-jitter)
}

function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 生成随机英文姓名（First + Last）
 * @returns {string}
 */
function generateRandomName() {
    const firstNames = [
        'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer',
        'Michael', 'Linda', 'David', 'Elizabeth', 'William', 'Barbara',
        'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah',
        'Christopher', 'Karen', 'Charles', 'Lisa', 'Daniel', 'Nancy',
        'Matthew', 'Betty', 'Anthony', 'Margaret', 'Mark', 'Sandra'
    ];
    const lastNames = [
        'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia',
        'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez',
        'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore',
        'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White',
        'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson'
    ];
    const first = firstNames[Math.floor(Math.random() * firstNames.length)];
    const last = lastNames[Math.floor(Math.random() * lastNames.length)];
    return `${first} ${last}`;
}

/**
 * 模拟人类逐字符输入：每个字符之间随机延迟 50-200ms
 * @param {import('playwright').Page | import('playwright').Frame} context - Playwright Page 或 Frame
 * @param {string} selector - CSS 选择器
 * @param {string} text - 要输入的文本
 */
async function humanType(context, selector, text) {
    await context.click(selector);
    for (const char of text) {
        await context.type(selector, char, { delay: 0 });
        const delay = getTypingDelay();
        await context.waitForTimeout(delay);
    }
}

/**
 * 在 Stripe iframe 内逐字符输入（用于卡号、有效期、CVC）
 * @param {import('playwright').Frame} frame - Stripe iframe frame
 * @param {string} selector - iframe 内的 CSS 选择器
 * @param {string} text - 要输入的文本
 */
async function humanTypeInFrame(frame, selector, text) {
    await frame.click(selector);
    for (const char of text) {
        await frame.type(selector, char, { delay: 0 });
        const delay = getTypingDelay();
        await frame.waitForTimeout(delay);
    }
}

/**
 * 安全滚动元素到可视区域（优先使用 DOM scrollIntoView，避免 Playwright scrollIntoViewIfNeeded 因稳定性检查超时）
 * @param {import('playwright').Locator} locator
 */
async function safeScrollIntoView(locator) {
    if (!locator) return;
    try {
        const target = locator.first ? locator.first() : locator;
        await target.evaluate((node) => {
            if (node && typeof node.scrollIntoView === 'function') {
                node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
            }
        }, undefined, { timeout: 1000 }).catch(() => {});
    } catch (_) {
        try {
            const target = locator.first ? locator.first() : locator;
            await target.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
        } catch (_) { /* ignore */ }
    }
}

// ==================== Screenshot Helper ====================

/**
 * 保存调试截图
 * @param {import('playwright').Page} page
 * @param {string} prefix
 * @returns {string|null} 截图路径
 */
async function saveDebugScreenshot(page, prefix) {
    try {
        const screenshotDir = path.join(__dirname, 'debug_screenshots', 'stripe');
        fs.mkdirSync(screenshotDir, { recursive: true });
        const filePath = path.join(screenshotDir, `${prefix}_${Date.now()}.png`);
        const shotOpts = { path: filePath, animations: 'disabled', timeout: 8000 };
        try {
            await page.screenshot({ ...shotOpts, fullPage: false });
        } catch (_) {
            await page.screenshot({ ...shotOpts, fullPage: true, timeout: 15000 });
        }
        console.log(`📸 [Stripe] 截图已保存: ${filePath}`);
        return filePath;
    } catch (e) {
        console.warn(`⚠️ [Stripe] 截图保存失败: ${e.message}`);
        return null;
    }
}

function normalizeCardExpiry(expiry) {
    const raw = String(expiry || '').trim();
    if (/^\d{4}$/.test(raw)) {
        return `${raw.slice(0, 2)}/${raw.slice(2)}`;
    }
    return raw;
}

function normalizeCardNumber(number) {
    return String(number || '').replace(/\s+/g, '');
}

/**
 * 在 page 及所有 iframe 中查找第一个可见的输入框
 */
async function findVisibleInput(contexts, selectors) {
    for (const ctx of contexts) {
        try {
            const candidates = ctx.locator(selectors.join(', '));
            const count = await candidates.count();
            for (let i = 0; i < count; i += 1) {
                const locator = candidates.nth(i);
                if (await locator.isVisible() && await locator.isEnabled()
                    && await locator.getAttribute('readonly', { timeout: 200 }) === null) {
                    return { context: ctx, locator };
                }
            }
        } catch (_) { /* A frame/control can be replaced while checkout renders. */ }
    }
    return null;
}

async function scanCardInputs(page) {
    const contexts = [page];
    for (const frame of page.frames()) {
        if (frame === page.mainFrame() || frame.isDetached()) continue;
        if (!isTrustedStripeFrame(frame.url()) || isExcludedCardFrame(frame.url())) continue;
        const element = await frame.frameElement().catch(() => null);
        if (element && await element.isVisible().catch(() => false)) contexts.push(frame);
    }
    const card = await findVisibleInput(contexts, [
        '#payment-numberInput', 'input[autocomplete="cc-number"]', 'input[name="cardnumber"]',
        'input[name="number"]', 'input[placeholder*="1234" i]',
        'input[aria-label*="Card number" i]', 'input[data-elements-stable-field-name="cardNumber"]'
    ]);
    const expiry = await findVisibleInput(contexts, [
        '#payment-expiryInput', 'input[autocomplete="cc-exp"]', 'input[name="exp-date"]',
        'input[name="expiry"]', 'input[placeholder*="MM" i]', 'input[aria-label*="Expiration" i]',
        'input[aria-label*="expir" i]', 'input[data-elements-stable-field-name="cardExpiry"]'
    ]);
    const cvc = await findVisibleInput(contexts, [
        '#payment-cvcInput', 'input[autocomplete="cc-csc"]', 'input[name="cvc"]',
        'input[name="card-cvc"]', 'input[name="cardCvc"]', 'input[placeholder*="CVC" i]',
        'input[aria-label*="CVC" i]', 'input[aria-label*="security code" i]',
        'input[data-elements-stable-field-name="cardCvc"]'
    ]);
    return { card, expiry, cvc };
}

/** Find all three card fields together, including main-document and split iframe forms. */
async function discoverCardInputs(page, timeout = 45000) {
    const deadline = Date.now() + timeout;
    await prepareCheckoutCardSection(page);
    do {
        if (page.isClosed()) throw new Error('[CHECKOUT_PAGE_CLOSED] 查找信用卡字段时支付页面已关闭');
        const fields = await scanCardInputs(page);
        if (fields.card && fields.expiry && fields.cvc) return fields;
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await page.waitForTimeout(Math.min(200, remaining));
    } while (Date.now() < deadline);
    return null;
}

async function prepareCheckoutCardSection(page) {
    await page.waitForURL(/checkout\/openai_llc|pay\.openai|checkout\.stripe|stripe\.com|claude\.ai/i, { timeout: 3000 }).catch(() => {});
    await page.getByText(/Configure your plan|Card number|Pay with|设置您的套餐|账单信息|付款方式|卡号|支付信息|今日应付/i).first()
        .waitFor({ state: 'visible', timeout: 800 }).catch(() => {});

    const cardLabel = page.getByText(/^(Card number|卡号)$/i).first();
    if (await cardLabel.isVisible({ timeout: 300 }).catch(() => false)) {
        await safeScrollIntoView(cardLabel);
    }

    const orSep = page.getByText(/^OR$/i).first();
    if (await orSep.isVisible({ timeout: 300 }).catch(() => false)) {
        await orSep.click({ timeout: 500 }).catch(() => {});
    }
}

/** Single scan for older Stripe forms with unnamed, separate iframe inputs. */
async function collectStripeInputFrameLocators(page) {
    const iframeCount = await page.locator('iframe').count();
    const frames = [];
    for (let i = 0; i < iframeCount; i += 1) {
        const iframeLoc = page.locator('iframe').nth(i);
        if (!await iframeLoc.isVisible().catch(() => false)) continue;
        const src = (await iframeLoc.getAttribute('src', { timeout: 200 }).catch(() => '')) || '';
        let stripeHost = false;
        try { stripeHost = isTrustedStripeFrame(new URL(src, page.url()).href); } catch (_) { /* Not a Stripe URL. */ }
        if (!stripeHost || /elements-inner-(?:address|accessory)|hcaptcha|captcha|challenge/i.test(src)) continue;
        const fl = page.frameLocator('iframe').nth(i);
        try {
            const inputs = fl.locator('input:not([type="hidden"]):not([disabled]):not([readonly])');
            const input = inputs.first();
            if (!await input.isVisible()) continue;
            const inputName = (await input.getAttribute('name', { timeout: 200 })) || '';
            const inputId = (await input.getAttribute('id', { timeout: 200 })) || '';
            if (/name|email|address|line1|city|state|zip|postal|country/i.test(inputName + inputId)) continue;
            frames.push(inputs);
        } catch (_) { /* Frame was replaced. Rescan on the next poll. */ }
    }
    return frames;
}

async function legacyCardInputLocators(page) {
    const frames = await collectStripeInputFrameLocators(page);
    if (frames.length === 3 && (await Promise.all(frames.map(frame => frame.count()))).every(count => count === 1)) {
        return frames.map(frame => frame.first());
    }
    if (frames.length === 1 && await frames[0].count() === 3) return [0, 1, 2].map(i => frames[0].nth(i));
    return null;
}

async function assertOpenAiCardFieldsReady(page, cardInfo) {
    const fields = await scanCardInputs(page);
    const inputs = fields.card && fields.expiry && fields.cvc
        ? [fields.card.locator, fields.expiry.locator, fields.cvc.locator]
        : !fields.card && !fields.expiry && !fields.cvc ? await legacyCardInputLocators(page) : null;
    const expected = [normalizeCardNumber(cardInfo.number), normalizeCardExpiry(cardInfo.expiry), String(cardInfo.cvc || '').trim()];
    let valid = Boolean(inputs);
    if (inputs) {
        for (let i = 0; i < inputs.length; i++) {
            valid = valid && await inputs[i].isVisible().catch(() => false) && await inputs[i].isEnabled().catch(() => false)
                && await inputs[i].inputValue({ timeout: 500 }).then(value => value.replace(/\D/g, '') === expected[i].replace(/\D/g, '')).catch(() => false);
        }
    }
    if (!valid) throw Object.assign(new Error('ChatGPT 信用卡字段已变化或填写不完整，尚未提交付款 [OPENAI_CARD_FIELDS_CHANGED]'), { code: 'OPENAI_CARD_FIELDS_CHANGED' });
}

async function fillCardFieldsOpenAiCheckout(page, cardInfo, timeout = 45000) {
    const startedAt = Date.now();
    const deadline = startedAt + timeout;
    const values = [normalizeCardNumber(cardInfo.number), normalizeCardExpiry(cardInfo.expiry), String(cardInfo.cvc || '').trim()];
    let formRetryCount = 0;
    let nextFormRetryAt = 0;
    let lastWaitLog = startedAt;
    const methodGuard = isOpenAiCustomCheckout(page) ? createOpenAiCardMethodGuard(page, deadline) : null;
    await prepareCheckoutCardSection(page);

    do {
        if (page.isClosed()) throw new Error('[CHECKOUT_PAGE_CLOSED] 等待信用卡字段时支付页面已关闭');
        // Inspect actual controls on every poll. URL-based iframe detection must
        // never keep an already rendered main-document or split-frame form waiting.
        const fields = await scanCardInputs(page);
        let inputs = fields.card && fields.expiry && fields.cvc
            ? [fields.card.locator, fields.expiry.locator, fields.cvc.locator] : null;
        if (methodGuard) {
            try {
                if (!await methodGuard.prepare(Boolean(inputs))) {
                    const remaining = deadline - Date.now();
                    if (remaining <= 0) break;
                    await page.waitForTimeout(Math.min(200, remaining));
                    continue;
                }
            } catch (error) { return { ok: false, error: error.message }; }
        }
        const layout = inputs ? (fields.card.context === page ? '页面字段' : 'iframe 字段') : '旧版 Stripe iframe';
        // Preserve unnamed legacy Stripe forms, but do not use positional filling
        // when semantic fields are present and still incomplete.
        if (!inputs && !fields.card && !fields.expiry && !fields.cvc) {
            inputs = await legacyCardInputLocators(page);
        }
        if (inputs && !(await Promise.all(inputs.map(async input =>
            await input.isVisible().catch(() => false) && await input.isEnabled().catch(() => false)
        ))).every(Boolean)) inputs = null;
        if (inputs) {
            if (Date.now() >= deadline) break;
            if (methodGuard) {
                try { await methodGuard.assertReady({ fieldsReady: true }); } catch (error) { return { ok: false, error: error.message }; }
            }
            for (let i = 0; i < inputs.length; i += 1) {
                const remaining = () => Math.max(1, deadline - Date.now());
                await inputs[i].click({ timeout: remaining() });
                await inputs[i].fill('', { timeout: remaining() });
                await inputs[i].pressSequentially(values[i], { delay: 20, timeout: remaining() });
                const actual = await inputs[i].inputValue({ timeout: remaining() });
                if (actual.replace(/\D/g, '') !== values[i].replace(/\D/g, '')) {
                    const code = methodGuard ? 'OPENAI_CARD_FIELDS_INCOMPLETE' : 'CARD_FIELDS_INCOMPLETE';
                    return { ok: false, error: `信用卡字段未完整写入，已停止后续操作，尚未提交付款 [${code}]` };
                }
            }
            console.log(`[Stripe] ✅ 卡号/有效期/CVC 已填写 (${layout}，探测与填写 ${Date.now() - startedAt}ms)`);
            return { ok: true };
        }

        // 官方收银台表单/整页错误边界（如 ChatGPT 的 “Content failed to load”）：尚未填卡，可安全点击官方重试入口
        const formLoadError = page.getByText(/支付表单加载失败|Failed to load payment form|Error loading payment form|Content failed to load|内容加载失败/i).first();
        if (await formLoadError.isVisible().catch(() => false)) {
            const retryBtn = page.getByRole('button', { name: /^\s*(?:重试|Retry|Try again|再试一次)\s*$/i }).first();
            if (formRetryCount < 2 && Date.now() >= nextFormRetryAt && Date.now() < deadline && await retryBtn.isVisible().catch(() => false)) {
                formRetryCount += 1;
                console.log(`[Stripe] ⚠️ 检测到官方表单加载失败，第 ${formRetryCount} 次点击「重试」按钮恢复...`);
                await retryBtn.click({ timeout: Math.min(2000, Math.max(1, deadline - Date.now())) });
                nextFormRetryAt = Date.now() + 2500;
            } else if (formRetryCount >= 2 && Date.now() >= nextFormRetryAt) break;
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        if (Date.now() - lastWaitLog >= 5000) {
            console.log(`[Stripe] 等待信用卡字段就绪 (${Math.round((Date.now() - startedAt) / 1000)}s/${Math.round(timeout / 1000)}s，卡号=${!!fields.card}，有效期=${!!fields.expiry}，安全码=${!!fields.cvc})`);
            lastWaitLog = Date.now();
        }
        await page.waitForTimeout(Math.min(200, remaining));
    } while (Date.now() < deadline);

    const hasFormError = await page.getByText(/支付表单加载失败|Failed to load payment form|Error loading payment form|Content failed to load|内容加载失败/i).first().isVisible().catch(() => false);
    if (hasFormError) return { ok: false, error: '官方收银台支付表单加载失败 (Failed to load payment form / Content failed to load)，尚未提交付款' };
    if (methodGuard) {
        try { await methodGuard.assertReady(); } catch (error) { return { ok: false, error: error.message }; }
    }
    const code = methodGuard ? 'OPENAI_CARD_FIELDS_NOT_READY' : 'CARD_FIELDS_NOT_READY';
    return { ok: false, error: `无法定位完整的信用卡输入框（卡号/有效期/CVC），尚未提交付款 [${code}]` };
}

function isOpenAiCustomCheckout(page) {
    const url = String(page?.url ? page.url() : page || '');
    return /chatgpt\.com\/checkout/i.test(url)
        || /pay\.openai\.com/i.test(url)
        || /checkout\/openai_llc/i.test(url)
        || /oaics_/i.test(url)
        || (/checkout/i.test(url) && /openai/i.test(url));
}

function isClaudeCustomCheckout(page) {
    return /claude\.ai\/upgrade/i.test(page.url());
}

/**
 * 修复 Claude 卡号不完整的行内提示；提交前另行核对当前 iframe 字段。
 */
async function verifyAndFixClaudeCard(page, cardInfo) {
    const cardNumber = normalizeCardNumber(cardInfo.number);
    const inlineErr = await checkStripeCardInlineError(page);
    if (inlineErr.hasError && /卡号|number|incomplete|不完整/i.test(inlineErr.message)) {
        console.warn(`[Claude] ⚠️ 检测到卡号输入不完整或行内错误 (${inlineErr.message})，正在重新聚焦并补填卡号...`);
        const cardFrame = page.frames().find(f => f.url().includes('elements-inner-payment'));
        if (cardFrame) {
            try {
                const numInp = cardFrame.locator('#payment-numberInput, input[name="number"]').first();
                if (await numInp.isVisible({ timeout: 2000 })) {
                    await numInp.click();
                    await page.keyboard.press('Meta+A').catch(() => {});
                    await page.keyboard.press('Control+A').catch(() => {});
                    await page.keyboard.press('Backspace').catch(() => {});
                    await numInp.pressSequentially(cardNumber, { delay: 35 });
                    await page.keyboard.press('Tab').catch(() => {});
                    await page.waitForTimeout(600);
                    console.log('[Claude] ✅ 已重新补填卡号并触发失焦校验');
                }
            } catch (e) {
                console.warn('[Claude] 重新填写卡号异常:', e.message);
            }
        }
    }
}

async function assertGrokCardFieldsReady(page, cardInfo) {
    const fields = await scanCardInputs(page);
    if (!fields.card || !fields.expiry || !fields.cvc
        || (await fields.card.locator.inputValue()).replace(/\D/g, '') !== normalizeCardNumber(cardInfo.number)
        || (await fields.expiry.locator.inputValue()).replace(/\D/g, '') !== normalizeCardExpiry(cardInfo.expiry).replace(/\D/g, '')
        || (await fields.cvc.locator.inputValue()).replace(/\D/g, '') !== String(cardInfo.cvc)) {
        throw grokError('GROK_FORM_UNCONFIRMED', '信用卡字段在提交前发生变化，已停止支付');
    }
}

async function assertClaudeCardFieldsReady(page, cardInfo) {
    const frames = page.frames().filter(frame => /elements-inner-(payment|card)/.test(frame.url())).reverse();
    const expected = { number: normalizeCardNumber(cardInfo.number),
        expiry: normalizeCardExpiry(cardInfo.expiry).replace(/\D/g, ''), cvc: String(cardInfo.cvc || '').trim() };
    for (const frame of frames) {
        const element = await frame.frameElement().catch(() => null);
        if (!element || !await element.isVisible().catch(() => false)) continue;
        const matches = await frame.evaluate(values => {
            const read = selector => String(document.querySelector(selector)?.value || '').replace(/\D/g, '');
            return read('#payment-numberInput, input[name="number"], input[name="cardnumber"], input[autocomplete="cc-number"]') === values.number
                && read('#payment-expiryInput, input[name="expiry"], input[name="exp-date"], input[autocomplete="cc-exp"]') === values.expiry
                && read('#payment-cvcInput, input[name="cvc"], input[name="card-cvc"], input[autocomplete="cc-csc"]') === values.cvc;
        }, expected).catch(() => false);
        if (matches) return true;
    }
    throw Object.assign(new Error('Claude 信用卡字段在提交前发生变化，已停止提交，请重试'), { code: 'CLAUDE_CARD_FIELDS_CHANGED' });
}

async function fillClaudeCheckoutBilling(page, address, fullName) {
    console.log('[Claude] 开始填写 Claude 账单信息（Stripe Address Element）...');
    const countryCode = String(address.country || 'US').trim().toUpperCase() || 'US';
    const stateFullName = normalizeStateFullName(address.state) || address.state;

    // 定位 Stripe 账单地址 iframe (elements-inner-accessory-target 或 elements-inner-address)
    let addrFrame = page.frames().find(f => f.url().includes('elements-inner-accessory') || f.url().includes('elements-inner-address'));
    if (!addrFrame) {
        const deadline = Date.now() + 6000;
        while (!addrFrame && Date.now() < deadline) {
            await page.waitForTimeout(150);
            addrFrame = page.frames().find(f => f.url().includes('elements-inner-accessory') || f.url().includes('elements-inner-address'));
        }
    }

    const context = addrFrame || page;
    console.log(`[Claude] 使用 ${addrFrame ? 'Stripe 独立 Address iframe' : '主页面上下文'} 填充账单...`);

    // 1. 全名 (Full Name)
    const nameInp = context.locator('#billingAddress-nameInput, input[name="name"], input[autocomplete="billing name"]').first();
    if (await nameInp.isVisible({ timeout: 5000 }).catch(() => false)) {
        await nameInp.fill(fullName);
        console.log(`  [Claude] ✅ 姓名已填写: ${fullName}`);
    } else {
        console.warn('  [Claude] ⚠️ 未能定位到姓名输入框');
    }

    // 2. 国家 (Country)
    if (countryCode !== 'US') {
        const countrySelect = context.locator('#billingAddress-countryInput, select[name="country"]').first();
        if (await countrySelect.isVisible({ timeout: 2000 }).catch(() => false)) {
            await countrySelect.selectOption({ label: countryCode }).catch(() => {});
        }
    }

    // 3. 街道地址 (Address Line 1)
    const line1Inp = context.locator('#billingAddress-addressLine1Input, input[name="addressLine1"], input[autocomplete="billing address-line1"]').first();
    if (await line1Inp.isVisible({ timeout: 5000 }).catch(() => false)) {
        await line1Inp.fill(address.line1);
        console.log(`  [Claude] ✅ 街道地址已填写: ${address.line1}`);
    } else {
        console.warn('  [Claude] ⚠️ 未能定位到街道地址输入框');
    }

    // 4. 城市 (City)
    const cityInp = context.locator('#billingAddress-localityInput, input[name="locality"], input[autocomplete="billing address-level2"]').first();
    if (await cityInp.isVisible({ timeout: 2000 }).catch(() => false)) {
        await cityInp.fill(address.city);
        console.log(`  [Claude] ✅ 城市已填写: ${address.city}`);
    }

    // 5. 州 (State)
    const stateSelect = context.locator('#billingAddress-administrativeAreaInput, select[name="administrativeArea"]').first();
    if (await stateSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
        await stateSelect.selectOption({ label: stateFullName }).catch(() => {
            return stateSelect.selectOption({ value: address.state });
        }).catch(() => {});
        console.log(`  [Claude] ✅ 州已选择: ${stateFullName}`);
    }

    // 6. 邮编 (Postal Code)
    const postalInp = context.locator('#billingAddress-postalCodeInput, input[name="postalCode"], input[autocomplete="billing postal-code"]').first();
    if (await postalInp.isVisible({ timeout: 2000 }).catch(() => false)) {
        await postalInp.fill(address.postal_code);
        console.log(`  [Claude] ✅ 邮编已填写: ${address.postal_code}`);
    }

    await page.keyboard.press('Tab').catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    return { ok: true };
}

async function checkClaudeAgreement(page) {
    const scoped = page.locator('div').filter({ hasText: /You agree that Anthropic|Anthropic will charge|您同意|Anthropic 将/i })
        .locator('[role="checkbox"]').first();
    const target = await scoped.isVisible().catch(() => false) ? scoped
        : page.locator('[data-cds="Checkbox"][role="checkbox"], span[role="checkbox"]').first();
    if (!await target.isVisible().catch(() => false)) throw new Error('Claude 订阅条款控件未就绪，已停止提交');
    if (await target.getAttribute('aria-checked') !== 'true') {
        await target.click({ timeout: 3000 });
        await target.and(page.locator('[aria-checked="true"]')).waitFor({ state: 'visible', timeout: 3000 });
    }
    console.log('[Claude] ✅ Anthropic 订阅条款已确认勾选');
    return true;
}

/**
 * 检查 Stripe 信用卡字段是否存在行内校验错误（如卡号无效、不完整等）
 * 跨主页面及所有 iframe 深度扫描
 * @param {import('playwright').Page} page
 * @returns {Promise<{ hasError: boolean, message?: string }>}
 */
async function checkStripeCardInlineError(page) {
    const errorPatterns = [
        /your card number is invalid/i,
        /the card number is incomplete/i,
        /invalid card number/i,
        /enter a valid card number/i,
        /check your card number/i,
        /your card's security code is invalid/i,
        /security code is incomplete/i,
        /your card's expiration date is incomplete/i,
        /your card's expiration year is in the past/i,
        /expiration date is in the past/i,
        /您的卡号无效/,
        /卡号无效/,
        /卡号不完整/,
        /安全码无效/,
        /安全码不完整/,
        /有效期无效/,
        /卡片已过期/
    ];

    // 1. 快速在与 Stripe 相关的 iframe 中单次 evaluate 扫描（避免 10 个无关 iframe 的几百次跨 CDP roundtrip）
    const frames = page.frames();
    const relevantFrames = frames.filter(f => /stripe|elements|checkout/i.test(f.url()) || f.url().includes('__stripe'));
    const targetFrames = relevantFrames.length > 0 ? relevantFrames : frames;

    for (const frame of targetFrames) {
        try {
            const errResult = await frame.evaluate(() => {
                const errorSelectors = [
                    '.p-FieldError',
                    '[id*="-error"]',
                    '[id*="Error"]',
                    '[role="alert"]',
                    '.FieldError',
                    '.ElementsApp [class*="error" i]',
                    '.ElementsApp [class*="Error"]'
                ];
                for (const sel of errorSelectors) {
                    const els = document.querySelectorAll(sel);
                    for (const el of els) {
                        const style = window.getComputedStyle(el);
                        if (style && style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0) {
                            const txt = (el.textContent || '').trim();
                            if (txt) return { hasError: true, message: txt };
                        }
                    }
                }
                const invalidInps = document.querySelectorAll('input[aria-invalid="true"]');
                for (const inp of invalidInps) {
                    const describedBy = inp.getAttribute('aria-describedby');
                    if (describedBy) {
                        const errEl = document.getElementById(describedBy);
                        if (errEl) {
                            const txt = (errEl.textContent || '').trim();
                            if (txt) return { hasError: true, message: txt };
                        }
                    }
                    return { hasError: true, message: '信用卡输入框校验未通过 (aria-invalid=true)' };
                }
                return null;
            }).catch(() => null);

            if (errResult && errResult.hasError) {
                const msg = errResult.message;
                if (errorPatterns.some(re => re.test(msg)) || /invalid|incomplete|error|无效|不完整/i.test(msg)) {
                    return { hasError: true, message: msg };
                }
            }
        } catch (_) { /* continue */ }
    }

    // 2. 快速扫描主页面可见的错误提示（单次 evaluate，耗时 < 5ms）
    try {
        const pageErr = await page.evaluate(() => {
            const alerts = document.querySelectorAll('[role="alert"], [class*="error" i]');
            for (const el of alerts) {
                const style = window.getComputedStyle(el);
                if (style && style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0) {
                    const txt = (el.textContent || '').trim();
                    if (txt) return txt;
                }
            }
            return null;
        }).catch(() => null);

        if (pageErr && errorPatterns.some(re => re.test(pageErr))) {
            return { hasError: true, message: pageErr };
        }
    } catch (_) { /* ignore */ }

    return { hasError: false };
}

/**
 * 从 Checkout 页面读取「今日应付」金额（随汇率浮动）
 * @returns {Promise<{ amount: number, currency: string }|null>}
 */
async function readCheckoutDueAmount(page) {
    try {
        const bodyText = String(await page.textContent('body', { timeout: 8000 }).catch(() => '') || '');
        const currencyToken = '(?:US\\$|CL\\$|S\\$|E£|LE|₱|[$€£]|[A-Z]{3})';
        const patterns = [
            new RegExp(`(?:Due today|Total due|Pay today|今日应付总额|今日应付|应付总额)[^\\d₱$€£]{0,48}?(${currencyToken})\\s*([\\d,]+(?:\\.\\d{1,2})?)`, 'i'),
            new RegExp(`(?:Due today|Total due|Pay today|今日应付总额|今日应付|应付总额)[^\\d₱$€£]{0,48}?([\\d,]+(?:\\.\\d{1,2})?)\\s*(${currencyToken})`, 'i'),
        ];
        const currencyMap = {
            '₱': 'PHP', '$': 'USD', '€': 'EUR', '£': 'GBP', 'USD': 'USD', 'US$': 'USD',
            'CL$': 'CLP', 'S$': 'SGD', 'E£': 'EGP', 'LE': 'EGP',
            PHP: 'PHP', EGP: 'EGP', CLP: 'CLP', SGD: 'SGD', MYR: 'MYR'
        };
        for (const re of patterns) {
            const match = bodyText.match(re);
            if (!match) continue;
            let sym = match[1];
            let amountStr = match[2];
            if (/^\d/.test(sym)) {
                amountStr = match[1];
                sym = match[2];
            }
            const amount = parseFloat(String(amountStr || '').replace(/,/g, ''));
            if (Number.isFinite(amount) && amount > 0) {
                const normalized = currencyMap[sym] || currencyMap[sym.toUpperCase()]
                    || (/^[A-Z]{3}$/i.test(sym) ? sym.toUpperCase() : null);
                if (normalized) return { amount, currency: normalized };
            }
        }
    } catch (_) { /* ignore */ }
    return null;
}

async function waitForCheckoutDueAmount(page, {
    timeoutMs = Number(process.env.CHECKOUT_AMOUNT_READY_WAIT_MS || process.env.CHECKOUT_READY_WAIT_MS || 75000),
    pollIntervalMs = 500
} = {}) {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    let lastLogAt = Date.now();
    const startWait = Date.now();
    do {
        const due = await readCheckoutDueAmount(page);
        if (due?.amount && due.currency) return due;
        if (page?.isClosed?.() || Date.now() >= deadline) return null;

        // 快速检测页面是否已经进入不可逆的错误/失效状态（例如 "There was an error processing your payment"）
        const fatalError = await page?.evaluate?.(() => {
            const body = document.body?.innerText || '';
            if (/There was an error processing your payment|Payment failed|Unable to process payment|This checkout session has expired/i.test(body)) {
                return 'There was an error processing your payment';
            }
            return null;
        }).catch(() => null);
        if (fatalError) {
            console.warn(`[Checkout] 页面显示支付处理错误/会话已失效: ${fatalError}`);
            throw Object.assign(new Error(`收银台页面报错: ${fatalError} [CHECKOUT_SESSION_FAILED]`), {
                code: 'CHECKOUT_SESSION_FAILED',
                declined: true
            });
        }

        // 周期性输出加载日志，感知骨架屏加载进度（避免盲目刷新打断慢速代理下的正常资源下载）
        if (Date.now() - lastLogAt >= 10000) {
            lastLogAt = Date.now();
            const elapsed = Math.round((Date.now() - startWait) / 1000);
            const totalSec = Math.round(timeoutMs / 1000);
            const isPlanReady = await page?.evaluate?.(() => {
                const text = (document.body?.innerText || '');
                return /Getting your plan ready|正在准备你的套餐|Making room for even more files|Unlocking access|Warming up/i.test(text);
            }).catch(() => false);
            if (isPlanReady) {
                console.log(`[Checkout] 官方收银台骨架屏仍在加载中 (${elapsed}s/${totalSec}s，正在通过代理拉取 Stripe 资源)...`);
            }
        }

        const interval = Math.max(0, Number(pollIntervalMs) || 0);
        await page.waitForTimeout(Math.min(interval, Math.max(0, deadline - Date.now())));
    } while (Date.now() <= deadline);
    return null;
}

function checkoutCurrencyError(code, message) {
    return Object.assign(new Error(`${message}，尚未提交支付 [${code}]`), { code });
}

async function assertCheckoutDueCurrency(page, expectedCurrency, stage = 'Checkout') {
    const expected = String(expectedCurrency || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(expected)) {
        throw checkoutCurrencyError('CHECKOUT_CURRENCY_UNCONFIRMED', '卡密支付币种无效，无法确认 Checkout 应付币种');
    }
    const due = await readCheckoutDueAmount(page);
    if (!due?.amount || !due.currency) {
        throw checkoutCurrencyError('CHECKOUT_CURRENCY_UNCONFIRMED', `${stage}应付金额或币种无法确认，已停止支付`);
    }
    if (due.currency !== expected) {
        throw checkoutCurrencyError('PAYMENT_CURRENCY_MISMATCH', `${stage}币种 ${due.currency} 与卡密支付币种 ${expected} 不一致，已停止支付`);
    }
    return due;
}

/** 菲律宾 VAT 12%：含税标价 → 净价免税 (俄勒冈免税州 0% 税率) */
const PH_VAT_RATE = 0.12;

/**
 * ChatGPT 菲律宾官方套餐已知免税净价（12% VAT 标价 / 1.12）：
 * Plus: 1,100 PHP / 1.12 ≈ 982.14 PHP
 * Pro 100 (Standard): 6,490 PHP / 1.12 ≈ 5,794.64 PHP
 * Pro 200 (More usage): 9,990 PHP / 1.12 ≈ 8,919.64 PHP
 * Pro 500 (Max usage): 32,490 PHP / 1.12 ≈ 29,008.93 PHP
 */
const KNOWN_PH_NET_PRICES = [
    982.14,
    5794.64,
    8919.64,
    29008.93,
];

/**
 * 判断金额是否已经是免税后的菲律宾净价
 * 1. 匹配已知套餐净价字典
 * 2. 算术逆向检验：菲律宾标价含 12% VAT（通常为整百整十数，如 1100, 6490, 9990, 32490）。
 *    若金额 n 逆算含税值 (n * 1.12) 非常接近整十数，且 n 本身非整数，说明已被去税一次，避免二次除以 1.12。
 */
function isPhTaxFreeNet(amount) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return false;
    if (KNOWN_PH_NET_PRICES.some(net => Math.abs(n - net) < 2.0)) {
        return true;
    }
    const gross = n * (1 + PH_VAT_RATE);
    const roundGross = Math.round(gross);
    if (Math.abs(gross - roundGross) < 0.08 && roundGross % 10 === 0 && Math.abs(n - Math.round(n)) > 0.05) {
        return true;
    }
    return false;
}

function estimateTaxFreeAmount(taxedAmount, currency = null) {
    const n = Number(taxedAmount);
    if (!Number.isFinite(n) || n <= 0) return null;
    const curr = String(currency || '').toUpperCase();
    if (curr === 'USD' || curr === '$') {
        // 美元标价本身为税前基准价（Plus $20 / Pro $200），免税州税率为 0%，应付金额等于基准价
        return n;
    }
    if (curr === 'PHP' || curr === '₱' || (!curr && n > 500)) {
        // 若已为免税后净价（如 Plus 982.14 / Pro 100 5794.64 / Pro 200 8919.64 / Pro 500 29008.93 等），直接返回，避免二次折算
        const matchedKnown = KNOWN_PH_NET_PRICES.find(net => Math.abs(n - net) < 2.0);
        if (matchedKnown !== undefined) {
            return matchedKnown;
        }
        if (isPhTaxFreeNet(n)) {
            return n;
        }
        // 菲律宾订单标价含 12% VAT（例如 Plus 1100 PHP / Pro 9990 PHP）
        // 在俄勒冈等 0% 免税州地址下，Stripe Tax 消除 12% 增值税，应付为净价: 标价 / 1.12
        return Math.round((n / (1 + PH_VAT_RATE)) * 100) / 100;
    }
    return n;
}

function isTaxFreeDueAmount(due, baselineAmount, currency = null) {
    const amount = Number(due?.amount);
    const baseline = Number(baselineAmount);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(baseline) || baseline <= 0) return false;

    const curr = String(currency || due?.currency || '').toUpperCase();
    if (curr === 'USD' || curr === '$') return Math.abs(amount - baseline) <= 0.05;
    if (curr === 'PHP' || curr === '₱') {
        const target = estimateTaxFreeAmount(baseline, curr);
        // Compare against this Checkout's own baseline only. A known net price
        // from another plan must not make an unexpectedly high amount pass.
        return Boolean(target && Math.abs(amount - target) <= 0.05);
    }
    return false;
}

function getCheckoutTaxFreeGuard(baselineAmount, currency, address) {
    const curr = String(currency || '').toUpperCase();
    const country = String(address?.country || '').toUpperCase();
    if (country !== 'US' || !Number.isFinite(Number(baselineAmount)) || Number(baselineAmount) <= 0) return null;
    if (curr !== 'USD' && curr !== '$' && curr !== 'PHP' && curr !== '₱') return null;
    return { baselineAmount: Number(baselineAmount), currency: curr === '$' ? 'USD' : (curr === '₱' ? 'PHP' : curr) };
}

function assertCheckoutTaxFreeDue(due, guard, stage) {
    if (!guard || isTaxFreeDueAmount(due, guard.baselineAmount, guard.currency)) return due;
    const target = estimateTaxFreeAmount(guard.baselineAmount, guard.currency);
    throw checkoutCurrencyError(
        'BILLING_TAX_NOT_REMOVED',
        `${stage}应付 ${due?.currency || ''} ${due?.amount ?? '未知'} 与账单地区免税目标 ${guard.currency} ${target ?? '未知'} 不一致，已停止支付`
    );
}

/**
 * 检查 Checkout 页面订单明细是否已显式显示 0% 税率或 0 元税额
 * 例如：Sales Tax (0%): ₱0.00 / Tax (0%) / Estimated tax: ₱0.00 / $0.00 / 预估税费: ₱0.00
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function isCheckoutTaxZero(page) {
    if (!page) return false;
    try {
        const bodyText = String(await page.textContent('body', { timeout: 3000 }).catch(() => '') || '');
        if (bodyText) {
            // 1. 显式 0% 税率标识：Sales Tax (0%), Tax (0%), VAT (0%), 销售税 (0%)
            if (/(?:Sales\s+Tax|Estimated\s+tax|Tax|VAT|预估税费|销售税|税费)\s*\(\s*0(?:\.0+)?%\s*\)/i.test(bodyText)) {
                return true;
            }
            // 2. 税额为 0.00：例如 "Sales Tax: ₱0.00", "Estimated tax: $0.00", "Tax ₱0.00", "Estimated tax\n₱0.00"
            if (/(?:Sales\s+Tax|Estimated\s+tax|Tax|VAT|预估税费|销售税|税费)[^₱$€£\d]{0,40}?([₱$€£])\s*0(?:\.00)?(?!\d)/i.test(bodyText)) {
                return true;
            }
        }

        // 检查所有 frame 中是否有明确的 0% 税费标识
        const frames = page.frames?.() || [];
        for (const frame of frames) {
            try {
                const frameText = String(await frame.textContent('body', { timeout: 800 }).catch(() => '') || '');
                if (frameText) {
                    if (/(?:Sales\s+Tax|Estimated\s+tax|Tax|VAT|预估税费|销售税|税费)\s*\(\s*0(?:\.0+)?%\s*\)/i.test(frameText) ||
                        /(?:Sales\s+Tax|Estimated\s+tax|Tax|VAT|预估税费|销售税|税费)[^₱$€£\d]{0,40}?([₱$€£])\s*0(?:\.00)?(?!\d)/i.test(frameText)) {
                        return true;
                    }
                }
            } catch (_) { /* continue */ }
        }
    } catch (_) { /* ignore */ }
    return false;
}

async function blurActiveBillingField(page) {
    try {
        await page.keyboard.press('Tab');
    } catch (_) { /* ignore */ }
    await page.waitForTimeout(350);
}

/**
 * 填写美国免税州后等待 Stripe 重算「Due today」
 */
async function waitForCheckoutTaxRecalculation(page, options = {}) {
    const {
        baselineAmount = null,
        currency = null,
        maxWaitMs = 18000,
        pollMs = 700,
    } = options;

    const started = Date.now();
    let lastLogged = null;

    while (Date.now() - started < maxWaitMs) {
        const taxIsZero = await isCheckoutTaxZero(page);
        const due = await readCheckoutDueAmount(page);
        if (taxIsZero && isTaxFreeDueAmount(due, baselineAmount, currency || due?.currency)) {
            console.log(`  [Stripe] ✅ 页面税额为零且应付达到免税目标: ${due.currency} ${due.amount}`);
            return { ok: true, due };
        }
        if (due?.amount) {
            const activeCurrency = currency || due.currency;
            const curr = String(activeCurrency || '').toUpperCase();
            const isUsd = curr === 'USD' || curr === '$' || (!curr && baselineAmount <= 500);
            const isPhp = curr === 'PHP' || curr === '₱';

            if (isUsd) {
                if (isTaxFreeDueAmount(due, baselineAmount, activeCurrency)) {
                    console.log(`  [Stripe] ✅ 税区已更新（免税），应付: ${due.currency || ''} ${due.amount}`);
                    return { ok: true, due };
                }
            } else if (isPhp) {
                if (isTaxFreeDueAmount(due, baselineAmount, activeCurrency)) {
                    console.log(`  [Stripe] ✅ 税区已更新（PHP 俄勒冈免税），应付: ${due.currency || ''} ${due.amount}`);
                    return { ok: true, due };
                }
            } else {
                // 非美元非PHP地区标价即为合法应付金额，直接返回
                return { ok: true, due };
            }

            if (lastLogged !== due.amount) {
                console.log(`  [Stripe] 等待税区重算… 当前应付: ${due.currency || ''} ${due.amount}`);
                lastLogged = due.amount;
            }
        }
        await page.waitForTimeout(pollMs);
    }

    const finalDue = await readCheckoutDueAmount(page);
    const activeCurrency = currency || finalDue?.currency;
    const curr = String(activeCurrency || '').toUpperCase();
    const isUsd = curr === 'USD' || curr === '$' || (!curr && baselineAmount <= 500);
    const isPhp = curr === 'PHP' || curr === '₱';

    if (isUsd || isPhp) return { ok: isTaxFreeDueAmount(finalDue, baselineAmount, activeCurrency), due: finalDue };
    return { ok: true, due: finalDue };
}

async function ensureCheckoutTaxFreeAmount(page, address, baselineAmount, currency = null, expectedCurrency = null) {
    let due = await readCheckoutDueAmount(page);
    if (expectedCurrency) {
        const expected = String(expectedCurrency).trim().toUpperCase();
        if (!due?.amount || !due.currency) {
            return { ok: false, due, code: 'CHECKOUT_CURRENCY_UNCONFIRMED', error: '税费重算后 Checkout 应付金额或币种无法确认 [CHECKOUT_CURRENCY_UNCONFIRMED]' };
        }
        if (due.currency !== expected) {
            return { ok: false, due, code: 'PAYMENT_CURRENCY_MISMATCH', error: `税费重算后 Checkout 币种 ${due.currency} 与卡密支付币种 ${expected} 不一致 [PAYMENT_CURRENCY_MISMATCH]` };
        }
    }
    const activeCurrency = currency || due?.currency;
    const curr = String(activeCurrency || '').toUpperCase();
    const countryUpper = String(address?.country || '').toUpperCase();
    const isUsd = (curr === 'USD' || curr === '$' || (!curr && baselineAmount <= 500)) && (countryUpper === 'US' || !countryUpper);
    const isPhp = curr === 'PHP' || curr === '₱';
    const isUsAddress = countryUpper === 'US' || !countryUpper;
    const requiresTaxFreeAmount = isUsAddress && (isUsd || isPhp);

    if (!requiresTaxFreeAmount) {
        if (!baselineAmount || !due?.amount) return { ok: true, due };
        console.log(`  [Stripe] ✅ 非免税核验区 (${countryUpper || curr})，当前应付金额 ${due.currency || ''} ${due.amount} 为官方标准金额，免税重算校验跳过`);
        return { ok: true, due };
    }
    if (!baselineAmount || !due?.amount) {
        return { ok: false, due, code: 'CHECKOUT_AMOUNT_UNCONFIRMED', error: '免税校验所需的 Checkout 基准金额或应付金额无法确认，已停止支付 [CHECKOUT_AMOUNT_UNCONFIRMED]' };
    }

    const taxFreeGuard = getCheckoutTaxFreeGuard(baselineAmount, activeCurrency, address);
    if (isTaxFreeDueAmount(due, baselineAmount, activeCurrency)) {
        console.log(`  [Stripe] ✅ 免税应付金额确认: ${due.currency || ''} ${due.amount}`);
        return { ok: true, due, taxFreeGuard };
    }

    // 先给 Stripe Tax 的异步去税计算留出平滑等待窗口（500ms~3.5s），避免在失焦后瞬间误判进入重试
    const initialWait = await waitForCheckoutTaxRecalculation(page, { baselineAmount, currency: activeCurrency, maxWaitMs: 3500 });
    if (initialWait.due?.amount) {
        due = initialWait.due;
        if (expectedCurrency && (!due?.amount || !due.currency)) {
            return { ok: false, due, code: 'CHECKOUT_CURRENCY_UNCONFIRMED', error: '税费重算后 Checkout 应付金额或币种无法确认 [CHECKOUT_CURRENCY_UNCONFIRMED]' };
        }
        if (expectedCurrency && due.currency !== String(expectedCurrency).trim().toUpperCase()) {
            return { ok: false, due, code: 'PAYMENT_CURRENCY_MISMATCH',
                error: `税费重算后 Checkout 币种 ${due.currency} 与卡密支付币种 ${expectedCurrency} 不一致 [PAYMENT_CURRENCY_MISMATCH]` };
        }
    }
    if (isTaxFreeDueAmount(due, baselineAmount, activeCurrency)) {
        console.log(`  [Stripe] ✅ 免税应付金额确认: ${due.currency || ''} ${due.amount}`);
        return { ok: true, due, taxFreeGuard };
    }

    const taxIsZero = await isCheckoutTaxZero(page);
    console.warn(
        `  [Stripe] ⚠️ ${taxIsZero ? '页面虽显示零税，但应付金额' : '应付金额'} ${due.amount} 仍高于免税目标，重试州/邮编…`
    );
    const stateFullName = normalizeStateFullName(address.state);
    await selectBillingState(page, stateFullName, address.state);
    await fillBillingTextField(page, 'postal', address.postal_code, '邮编');
    await blurActiveBillingField(page);
    const retry = await waitForCheckoutTaxRecalculation(page, { baselineAmount, currency: activeCurrency, maxWaitMs: 15000 });
    const retryDue = retry.due || due;
    if (expectedCurrency && (!retryDue?.amount || !retryDue.currency)) {
        return { ok: false, due: retryDue, code: 'CHECKOUT_CURRENCY_UNCONFIRMED', error: '税费重算后 Checkout 应付金额或币种无法确认 [CHECKOUT_CURRENCY_UNCONFIRMED]' };
    }
    if (expectedCurrency && retryDue.currency !== String(expectedCurrency).trim().toUpperCase()) {
        return { ok: false, due: retryDue, code: 'PAYMENT_CURRENCY_MISMATCH',
            error: `税费重算后 Checkout 币种 ${retryDue.currency} 与卡密支付币种 ${expectedCurrency} 不一致 [PAYMENT_CURRENCY_MISMATCH]` };
    }
    if (isTaxFreeDueAmount(retryDue, baselineAmount, activeCurrency)) {
        return { ...retry, ok: true, due: retryDue, taxFreeGuard };
    }

    const finalDue = retry.due || due;
    const expected = estimateTaxFreeAmount(baselineAmount, activeCurrency);
    return {
        ok: false,
        due: finalDue,
        code: 'BILLING_TAX_NOT_REMOVED',
        error: `账单税区未生效，应付仍为 ${finalDue.currency || ''} ${finalDue.amount}`
            + (expected ? `（免税应约 ${expected}）` : ''),
    };
}

async function captureCheckoutDueAmount(page, existing = null) {
    if (existing?.amount > 0) {
        return existing;
    }
    const due = await readCheckoutDueAmount(page);
    if (due?.amount > 0) {
        return { amount: due.amount, currency: due.currency || null };
    }
    return existing;
}

async function resolveBillingDueResult(page, taxCheck) {
    const captured = await captureCheckoutDueAmount(
        page,
        taxCheck?.due?.amount
            ? { amount: taxCheck.due.amount, currency: taxCheck.due.currency || null }
            : null
    );
    return {
        dueAmount: captured?.amount,
        dueCurrency: captured?.currency,
    };
}


/**
 * 在 Stripe Checkout 页面完成信用卡支付
 * @param {import('playwright').Page} page - Playwright Page 实例
 * @param {object} cardInfo - { number, expiry, cvc, holder }
 * @param {object} address - { line1, city, state, postal_code, country }
 * @param {object} [options] - { cardAttempt?: number, holderName?: string }
 * @returns {Promise<{ success: boolean, error?: string, screenshot?: string, declined?: boolean, canRetryCard?: boolean }>}
 */
async function completeStripeCardPayment(page, cardInfo, address, options = {}) {
    if (options.platform === 'grok' && isGrokBundle(options.planType)) {
        return completeGrokCommercePayment(page, cardInfo, address, options, { normalizeCardNumber, normalizeCardExpiry });
    }
    const ELEMENT_TIMEOUT = 45000;
    const cardAttempt = Number(options.cardAttempt) || 1;
    const isCardRetry = cardAttempt > 1;
    let holderName = String(options.holderName || '').trim();
    const accountEmail = String(options.email || cardInfo.email || '').trim();
    let checkoutDue = null;
    let checkoutTaxFreeGuard = null;
    let submissionAttempted = false;
    let requireDetailedBilling = false;
    const grokCheckout = options.platform === 'grok';
    let grokBilling;

    try {
        const openAiCheckout = isOpenAiCustomCheckout(page);
        const claudeCheckout = isClaudeCustomCheckout(page);
        const requiresPaymentCurrencyGuard = options.platform === 'chatgpt' || !options.platform;
        const expectedPaymentCurrency = String(options.paymentCurrency || '').trim().toUpperCase();
        if (grokCheckout && !options.grokAccount?.ok) throw grokError('GROK_AUTH_UNCONFIRMED', 'Grok 官方账号未确认，已停止支付');
        if (grokCheckout && isCardRetry) await waitForGrokCheckoutReady(page, options.planType);
        if (requiresPaymentCurrencyGuard) {
            checkoutDue = await assertCheckoutDueCurrency(page, expectedPaymentCurrency, '付款前 Checkout');
        }

        if (isCardRetry) {
            console.log(`[Stripe] 换卡重试 #${cardAttempt}：更换卡号并重新提交...`);
            await dismissCheckoutPaymentError(page);
            await prepareCheckoutCardSection(page);
            await page.waitForTimeout(800);
            console.log('[Stripe] Step 2 (重试): 填写新信用卡...');
            const retryFill = await fillCardFieldsOpenAiCheckout(page, cardInfo, ELEMENT_TIMEOUT);
            if (!retryFill.ok) {
                const screenshotPath = await saveDebugScreenshot(page, 'card_fields_not_found');
                return { success: false, error: retryFill.error || '无法定位信用卡输入框', screenshot: screenshotPath };
            }
        } else {
            console.log('[Stripe] Step 0: 等待 Checkout 支付页就绪...');
            const captchaClear = await clearHumanVerification(page, {
                phase: 'pre-fill-card',
                ...(grokCheckout ? { useVisualSolver: false } : {}),
                maxWaitMs: Number(process.env.CAPTCHA_CLEAR_TIMEOUT_MS || 90000),
                maxBypassRounds: 3,
                requireCheckoutReady: true,
                checkoutReadyWaitMs: Number(process.env.CHECKOUT_READY_WAIT_MS || 45000)
            });
            if (!captchaClear.cleared) {
                const screenshotPath = await saveDebugScreenshot(page, captchaClear.checkoutNotReady ? 'checkout_not_ready' : 'captcha_before_card_fill');
                if (captchaClear.checkoutNotReady) {
                    return {
                        success: false,
                        error: 'Checkout 支付表单未能加载',
                        screenshot: screenshotPath
                    };
                }
                return {
                    success: false,
                    error: buildCaptchaRequiredError(),
                    screenshot: screenshotPath,
                    captchaRequired: true
                };
            }
            await prepareCheckoutCardSection(page);
            await page.waitForTimeout(100);

            // Step 0.5: 优先在进入信用卡填写前，把位于页面最顶端的 Email 填写完毕（自然自顶向下顺序）
            if (accountEmail && !grokCheckout) {
                await fillCheckoutEmail(page, accountEmail).catch(() => {});
            }

            if (!openAiCheckout && !claudeCheckout) {
                // 仅 Stripe hosted 页需要选择支付方式 tab
                console.log('[Stripe] Step 1: 选择信用卡支付方式...');
                try {
                    const cardMethodSelectors = [
                        '[data-testid="card-tab"]',
                        '[data-testid="CARD-tab"]',
                        'button:has-text("Credit or debit card")',
                        'button:has-text("信用卡")',
                        '[data-testid="payment-method-card"]'
                    ];
                    const el = page.locator(cardMethodSelectors.join(', ')).first();
                    if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
                        await el.click().catch(() => {});
                        console.log('[Stripe] ✅ 已选择信用卡支付方式');
                        await page.waitForTimeout(300);
                    }
                } catch (e) {
                    console.log('[Stripe] 支付方式选择跳过:', e.message);
                }
            } else if (openAiCheckout) {
                console.log('[Stripe] OpenAI checkout 页面，核验 Card 付款方式后再填卡');
            } else if (claudeCheckout) {
                console.log('[Stripe] Claude checkout 页面：在填写卡号前，核验并锁定套餐周期...');
                await ensureClaudePlanSelection(page, options.planType);
            }

            if (grokCheckout) await waitForGrokCheckoutReady(page, options.planType);
            console.log('[Stripe] Step 2: 填写信用卡字段（iframe 自动识别）...');
            const fillResult = await fillCardFieldsOpenAiCheckout(page, cardInfo, ELEMENT_TIMEOUT);
            if (!fillResult.ok) {
                const screenshotPath = await saveDebugScreenshot(page, 'card_fields_not_found');
                return { success: false, error: fillResult.error || '无法定位信用卡输入框', screenshot: screenshotPath };
            }
        }

        // 填完卡后让输入框失焦，触发 Stripe 客户端即时格式校验
        await page.keyboard.press('Tab').catch(() => {});
        await page.waitForTimeout(150);

        // 检查卡号、有效期、CVC 是否存在行内校验错误（如“Your card number is invalid.”）
        const inlineError = await checkStripeCardInlineError(page);
        if (inlineError.hasError) {
            console.log(`[Stripe] ❌ 检测到卡片行内错误: ${inlineError.message}`);
            const screenshotPath = await saveDebugScreenshot(page, 'card_inline_error');
            return {
                success: false,
                error: `银行卡信息无效: ${inlineError.message}`,
                screenshot: screenshotPath,
                declined: true,
                canRetryCard: true,
                submitted: false
            };
        }

        // 填完卡后让输入框平滑失焦
        await page.evaluate(() => {
            try {
                if (document.activeElement && document.activeElement !== document.body) {
                    document.activeElement.blur();
                }
            } catch (_) {}
        }).catch(() => {});

        // 自顶向下流向：在进入账单地址前，快速确保位于卡片下方的 Email 已经填写完毕
        if (accountEmail && !grokCheckout) {
            await fillCheckoutEmail(page, accountEmail).catch(() => {});
        }

        if (!holderName) {
            holderName = generateRandomName();
        }

        if (claudeCheckout) {
            console.log('[Stripe] Step 5: 填写 Claude 账单信息（姓名/地址）...');
            const stripeHolderName = (cardInfo.holder && cardInfo.holder.trim()) ? cardInfo.holder.trim() : holderName;
            if (!isCardRetry) {
                await fillClaudeCheckoutBilling(page, address, stripeHolderName);
            }
        } else if (openAiCheckout) {
            // chatgpt.com/checkout 在卡号有效后，如果是美国等需税区地区才会展开账单地址表单
            const isUsCheckout = String(address?.country || '').toUpperCase() === 'US';
            console.log(`[Stripe] Step 5: 等待账单地址表单展示 (${isUsCheckout ? '美区需详细地址' : '非美极简表单'})...`);
            const billingTimeout = isUsCheckout ? 10000 : 2500;
            const billingReady = await waitForBillingFields(page, billingTimeout);
            if (!billingReady) {
                // 检查卡片是否有行内错误
                const lateInlineError = await checkStripeCardInlineError(page);
                if (lateInlineError.hasError) {
                    console.log(`[Stripe] ❌ 账单地址未展开且卡片校验失败: ${lateInlineError.message}`);
                    const screenshotPath = await saveDebugScreenshot(page, 'card_invalid_no_billing');
                    return {
                        success: false,
                        error: `卡号无效导致账单地址未显示: ${lateInlineError.message}`,
                        screenshot: screenshotPath,
                        declined: true,
                        canRetryCard: true,
                        submitted: false
                    };
                }

                if (isUsCheckout) {
                    console.warn('[Stripe] ❌ 账单地址表单未加载，页面未返回卡片拒绝原因');
                    const screenshotPath = await saveDebugScreenshot(page, 'billing_address_never_appeared');
                    return {
                        success: false,
                        error: '[BILLING_FORM_NOT_READY] 填卡后账单地址表单未加载',
                        code: 'BILLING_FORM_NOT_READY',
                        screenshot: screenshotPath,
                        declined: false,
                        canRetryCard: false,
                        submitted: false
                    };
                }
                console.log(`[Stripe] ℹ️ 当前收银台无独立账单地址区域（${address?.country || '非美'}），跳过详细地址等待`);
            }

            if (!isUsCheckout) {
                const billingValues = await readBillingInputValues(page);
                if (!billingValues.present.includes('line1')) {
                    console.log(`[Stripe] ℹ️ 当前收银台无需填写街道/城市详细地址，跳过 Step 6`);
                } else {
                    requireDetailedBilling = true;
                    console.log('[Stripe] Step 6: 核验账单地址与免税金额...');
                    const billingResult = await fillOpenAiCheckoutBilling(page, address, holderName, expectedPaymentCurrency);
                    if (!billingResult.ok) {
                        const screenshotPath = await saveDebugScreenshot(page, 'billing_address_not_filled');
                        return {
                            success: false,
                            error: billingResult.error || '账单地址填写失败',
                            code: billingResult.code,
                            screenshot: screenshotPath
                        };
                    }
                    checkoutTaxFreeGuard = billingResult.taxFreeGuard || null;
                    if (billingResult.dueAmount) {
                        checkoutDue = {
                            amount: billingResult.dueAmount,
                            currency: billingResult.dueCurrency || null,
                        };
                        console.log(`[Stripe] ✅ 免税后应付: ${checkoutDue.currency || ''} ${checkoutDue.amount}`);
                    }
                    await dismissAddressAutocomplete(page);
                    console.log(`[Stripe] ✅ OpenAI 账单地址及免税金额校验通过，姓名: ${holderName}`);
                }
            } else {
                requireDetailedBilling = true;
                console.log('[Stripe] Step 6: 核验账单地址与免税金额...');
                const billingResult = await fillOpenAiCheckoutBilling(page, address, holderName, expectedPaymentCurrency);
                if (!billingResult.ok) {
                    const screenshotPath = await saveDebugScreenshot(page, 'billing_address_not_filled');
                    return {
                        success: false,
                        error: billingResult.error || '账单地址填写失败',
                        code: billingResult.code,
                        screenshot: screenshotPath
                    };
                }
                checkoutTaxFreeGuard = billingResult.taxFreeGuard || null;
                if (billingResult.dueAmount) {
                    checkoutDue = {
                        amount: billingResult.dueAmount,
                        currency: billingResult.dueCurrency || null,
                    };
                    console.log(
                        `[Stripe] ✅ 免税后应付: ${checkoutDue.currency || ''} ${checkoutDue.amount}`
                    );
                }
                await dismissAddressAutocomplete(page);
                console.log(`[Stripe] ✅ OpenAI 账单地址及免税金额校验通过，姓名: ${holderName}`);
            }
            if (accountEmail) {
                await fillCheckoutEmail(page, accountEmail);
            }
        } else if (grokCheckout) {
            console.log('[Grok] 按国家、地址、账号邮箱顺序填写并核验账单字段...');
            grokBilling = await fillGrokBilling(page, address, cardInfo.holder || holderName, options.grokAccount.email || accountEmail);
        } else {
            // Stripe hosted 页面
            if (!isCardRetry) {
                console.log('[Stripe] Step 6: 填写账单地址...');
                await fillBillingAddress(page, address);
                console.log('[Stripe] ✅ 账单地址已填写');

                console.log('[Stripe] Step 7: 填写持卡人姓名（如有）...');
                const stripeHolderName = (cardInfo.holder && cardInfo.holder.trim()) ? cardInfo.holder.trim() : holderName;
                const nameSelectors = [
                    '#billingName',
                    'input[name="billingName"]',
                    'input[name="name"]',
                    'input[autocomplete="cc-name"]',
                    'input[autocomplete="name"]',
                    'input[placeholder*="name" i]',
                    'input[placeholder*="Name" i]',
                    'input[placeholder*="全名" i]',
                    '[data-testid="billingName"]'
                ];

                const el = page.locator(nameSelectors.join(', ')).first();
                if (await el.isVisible({ timeout: 600 }).catch(() => false)) {
                    await el.fill('').catch(() => {});
                    await humanType(page, nameSelectors.join(', '), stripeHolderName);
                    console.log(`[Stripe] ✅ 持卡人姓名已填写: ${stripeHolderName}`);
                }
            }
        }

        // Step 8: Check service agreement checkbox if present
        console.log('[Stripe] Step 8: 检查服务协议...');
        if (claudeCheckout) {
            await checkClaudeAgreement(page);
        } else {
            try {
                // 确保取消勾选「保存支付信息/Link」复选框，防止触发短信验证码和多余表单
                const saveCb = page.locator('input[type="checkbox"][name*="save" i], input[type="checkbox"][id*="save" i], input[type="checkbox"][aria-label*="save" i]').first();
                if (await saveCb.isVisible({ timeout: 500 }).catch(() => false)) {
                    if (await saveCb.isChecked().catch(() => false)) {
                        await saveCb.uncheck().catch(() => {});
                        console.log('[Stripe] ⚠️ 已取消勾选「保存支付信息」复选框');
                    }
                }

                const checkboxSelectors = [
                    'input[type="checkbox"][name*="agree" i]',
                    'input[type="checkbox"][name*="terms" i]',
                    'input[type="checkbox"][id*="agree" i]',
                    'input[type="checkbox"][id*="terms" i]',
                    '.CheckboxInput input[type="checkbox"]',
                    '[data-testid*="agreement"] input[type="checkbox"]',
                    '[data-testid*="terms"] input[type="checkbox"]'
                ];

                const checkbox = page.locator(checkboxSelectors.join(', ')).first();
                if (await checkbox.isVisible({ timeout: 500 }).catch(() => false)) {
                    const isChecked = await checkbox.isChecked().catch(() => false);
                    if (!isChecked) {
                        await checkbox.check().catch(() => {});
                        console.log('[Stripe] ✅ 已勾选服务协议');
                    }
                }
            } catch (e) {
                console.log('[Stripe] 未发现服务协议复选框，继续...');
            }
        }

        // 提交前再次确保 Email 已填写
        if (accountEmail && !grokCheckout) {
            await fillCheckoutEmail(page, accountEmail);
        }

        if (requiresPaymentCurrencyGuard) {
            checkoutDue = await assertCheckoutDueCurrency(page, expectedPaymentCurrency, '最终提交前 Checkout');
            checkoutDue = assertCheckoutTaxFreeDue(checkoutDue, checkoutTaxFreeGuard, '最终提交前');
        } else if (claudeCheckout) {
            await verifyAndFixClaudeCard(page, cardInfo);
            checkoutDue = await assertClaudeCheckoutReady(page, options.planType);
        } else if (grokCheckout) {
            checkoutDue = await assertGrokCheckoutReady(page, options.planType);
        } else {
            checkoutDue = await captureCheckoutDueAmount(page, checkoutDue);
        }
        if (checkoutDue?.amount) {
            console.log(`[Stripe] 提交前确认应付: ${checkoutDue.currency || ''} ${checkoutDue.amount}`);
        }

        const payResult = await finalizeCheckoutPayment(page, holderName, async () => {
            if (requireDetailedBilling) await assertOpenAiBillingReady(page, address, holderName);
            if (openAiCheckout) {
                await assertOpenAiCardFieldsReady(page, cardInfo);
                await createOpenAiCardMethodGuard(page, Date.now()).assertReady({ fieldsReady: true });
            }
            if (requiresPaymentCurrencyGuard) {
                checkoutDue = await assertCheckoutDueCurrency(page, expectedPaymentCurrency, '点击付款前 Checkout');
                checkoutDue = assertCheckoutTaxFreeDue(checkoutDue, checkoutTaxFreeGuard, '点击付款前');
            }
            if (claudeCheckout) {
                checkoutDue = await assertClaudeCheckoutReady(page, options.planType);
                await assertClaudeCardFieldsReady(page, cardInfo);
            }
            if (grokCheckout) {
                checkoutDue = await assertGrokCheckoutReady(page, options.planType);
                await assertGrokBillingReady(page, grokBilling.filled, grokBilling.expected);
                await assertGrokCardFieldsReady(page, cardInfo);
            }
            if (typeof options.onPaymentAttemptStarted === 'function') {
                await options.onPaymentAttemptStarted();
            }
            submissionAttempted = true;
        }, accountEmail, options.planType, options);
        payResult.submitted = payResult.submitted !== false && submissionAttempted;
        payResult.submissionAttempted = submissionAttempted;
        if (checkoutDue?.amount) {
            payResult.dueAmount = checkoutDue.amount;
            payResult.dueCurrency = checkoutDue.currency;
        }
        return payResult;

    } catch (error) {
        console.error(`[Stripe] ❌ 支付流程异常: ${error.message}`);
        const screenshotPath = await saveDebugScreenshot(page, 'payment_exception');
        const isDeclined = !grokCheckout && PAYMENT_DECLINE_PATTERNS.some((re) => re.test(error.message));
        const isCaptchaOrNonCard = Boolean(
            /安全验证|人机验证|hcaptcha|cloudflare|turnstile|captcha|verification|购买未成功|timeout|closed|destroyed/i.test(error.message)
        );
        return {
            success: false,
            error: error.message,
            code: error.code,
            screenshot: screenshotPath,
            submitted: Boolean(submissionAttempted),
            submissionAttempted: Boolean(submissionAttempted),
            declined: isDeclined,
            canRetryCard: isDeclined,
            captchaRequired: isCaptchaOrNonCard,
            ...(grokCheckout && submissionAttempted ? { code: 'PAYMENT_RESULT_UNKNOWN' } : {})
        };
    }
}

// ==================== Payment Result Wait =================

const PAYMENT_RESULT_TIMEOUT_MS = Number(process.env.PAYMENT_RESULT_TIMEOUT_MS) || 180000;
const PAYMENT_RESULT_POLL_MS = 2000;

const PAYMENT_SUCCESS_PATTERNS = [
    /redirect_status=succeeded/i,
    /thank you for subscribing/i,
    /subscription is active/i,
    /subscription active/i,
    /you.?re all set/i,
    /订阅成功/i,
    /支付成功/i,
    /welcome to plus/i,
    /welcome to pro/i,
    /已成功订阅/i
];

const PAYMENT_DECLINE_PATTERNS = [
    /无法完成此(次)?购买/i,
    /unable to complete this purchase/i,
    /未能完成购买/i,
    /your card was declined/i,
    /your card has been declined/i,
    /card was declined/i,
    /card has been declined/i,
    /payment was not approved/i,
    /payment was declined/i,
    /payment could not be processed/i,
    /payment method could not be verified/i,
    /your bank may have declined/i,
    /payment details may be incorrect/i,
    /we are unable to authenticate your payment method/i,
    /payment failed/i,
    /payment was not successful/i,
    /could not be completed/i,
    /transaction (was )?(declined|failed)/i,
    /insufficient funds/i,
    /do not honor/i,
    /incorrect.*cvc/i,
    /expired card/i,
    /card number is (incorrect|invalid)/i,
    /银行卡被拒绝/i,
    /支付未(通过|成功|获批)/i,
    /未获批准/i,
    /拒付/i,
    /被拒绝/i,
    /try another (payment )?method/i,
    /try a different (card|payment)/i,
    /unable to authenticate/i
];

function buildDeclinedPaymentResult(page, msg, screenshotPath) {
    return {
        success: false,
        error: `银行卡被拒绝: ${msg}`,
        screenshot: screenshotPath,
        declined: true,
        canRetryCard: true
    };
}

/**
 * 扫描页面是否已出现 Stripe/OpenAI 拒付文案
 * @returns {Promise<string|null>}
 */
async function detectPaymentDeclineOnPage(page) {
    try {
        const alerts = page.getByRole('alert');
        const alertCount = await alerts.count().catch(() => 0);
        for (let i = 0; i < alertCount; i += 1) {
            const el = alerts.nth(i);
            if (await el.isVisible({ timeout: 200 }).catch(() => false)) {
                const alertText = String(await el.innerText({ timeout: 500 }).catch(() => '') || '').trim();
                if (!alertText) continue;
                if (PAYMENT_DECLINE_PATTERNS.some((re) => re.test(alertText))) {
                    return alertText;
                }
            }
        }

        const visibleText = String(await page.locator('body').innerText({ timeout: 3000 }).catch(() => '') || '');
        for (const re of PAYMENT_DECLINE_PATTERNS) {
            if (re.test(visibleText)) {
                const match = visibleText.match(re);
                return match ? match[0] : 'card declined';
            }
        }
    } catch (_) { /* ignore */ }
    return null;
}

async function dismissCheckoutPaymentError(page) {
    const dismissSelectors = [
        '[role="alert"] button',
        '[role="alert"] [aria-label="Close"]',
        'button[aria-label="Close"]',
        'button[aria-label="Dismiss"]'
    ];
    for (const sel of dismissSelectors) {
        try {
            const btn = page.locator(sel).first();
            if (await btn.isVisible({ timeout: 800 })) {
                await btn.click({ timeout: 2000 });
                console.log('[Stripe] 已关闭拒付提示条');
                await page.waitForTimeout(400);
                return;
            }
        } catch (_) { /* try next */ }
    }
}

/**
 * 提交后并行等待：hCaptcha 弹层 vs 直接拒付（避免无验证拒付时空等 45s）
 */
async function handlePostSubmitPhase(page) {
    const overlayWaitMs = Number(process.env.CAPTCHA_OVERLAY_WAIT_MS || 45000);
    const pollMs = Number(process.env.POST_SUBMIT_POLL_MS || 500);
    const startedAt = Date.now();
    const deadline = startedAt + overlayWaitMs;
    let captchaDetected = false;
    let lastLogSec = -1;

    console.log(`[Stripe] Step 9.5: 并行等待 hCaptcha 弹层或拒付结果（最长 ${Math.round(overlayWaitMs / 1000)}s）...`);

    while (Date.now() < deadline) {
        const declineMsg = await detectPaymentDeclineOnPage(page);
        if (declineMsg) {
            console.log(`[Stripe] ❌ 提交后快速检测到拒付（未出现验证）: ${declineMsg}`);
            const screenshotPath = await saveDebugScreenshot(page, 'payment_declined');
            return {
                action: 'declined',
                declineMsg,
                screenshot: screenshotPath
            };
        }

        const inlineError = await checkStripeCardInlineError(page);
        if (inlineError.hasError) {
            console.log(`[Stripe] ❌ 提交后检测到信用卡字段错误拦截: ${inlineError.message}`);
            const screenshotPath = await saveDebugScreenshot(page, 'card_inline_error_after_submit');
            return {
                action: 'declined',
                declineMsg: `银行卡信息无效: ${inlineError.message}`,
                screenshot: screenshotPath
            };
        }

        if (await hasAnyCheckoutCaptchaSignal(page)) {
            captchaDetected = true;
            console.log('[Stripe] 检测到 hCaptcha 弹层，开始自动处理...');
            break;
        }

        const url = page.url();
        if (url.includes('redirect_status=succeeded')) {
            return { action: 'success' };
        }
        if (/chatgpt\.com/i.test(url) && !/\/checkout\//i.test(url)) {
            return { action: 'success' };
        }
        if (/claude\.ai/i.test(url) && !/\/upgrade/i.test(url)) {
            console.log(`[Stripe] ✅ Claude 已成功跳转离开升级页面: ${url}`);
            return { action: 'success' };
        }

        const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
        if (elapsedSec >= lastLogSec + 5) {
            lastLogSec = elapsedSec;
            console.log(`[Captcha/overlay-wait][INFO] 仍在等待 hCaptcha 或拒付结果… (${elapsedSec}s)`);
        }

        await page.waitForTimeout(pollMs);
    }

    if (!captchaDetected) {
        console.log('[Stripe] 等待期内未检测到 hCaptcha，继续等待支付结果');
        return { action: 'continue' };
    }

    const postCaptcha = await clearHumanVerification(page, {
        phase: 'post_submit',
        maxWaitMs: Number(process.env.CAPTCHA_POST_SUBMIT_TIMEOUT_MS || 180000),
        maxBypassRounds: Number(process.env.CAPTCHA_POST_SUBMIT_MAX_ROUNDS || 8),
        requireCheckoutReady: false,
        useVisualSolver: true,
        overlayWaitMs: 0
    });

    if (postCaptcha.paymentDeclined) {
        console.log(`[Stripe] ❌ 提交后检测到拒付/无法完成购买: ${postCaptcha.declineMsg}`);
        const screenshotPath = await saveDebugScreenshot(page, 'payment_declined');
        return {
            action: 'declined',
            declineMsg: postCaptcha.declineMsg,
            screenshot: screenshotPath
        };
    }

    const postDeclineMsg = await detectPaymentDeclineOnPage(page);
    if (postDeclineMsg) {
        console.log(`[Stripe] ❌ 提交后页面已显示拒付/无法完成购买: ${postDeclineMsg}`);
        const screenshotPath = await saveDebugScreenshot(page, 'payment_declined');
        return {
            action: 'declined',
            declineMsg: postDeclineMsg,
            screenshot: screenshotPath
        };
    }

    if (!postCaptcha.cleared) {
        if (postCaptcha.browserVerificationFailed) {
            const screenshotPath = await saveDebugScreenshot(page, 'captcha_post_submit');
            console.log(`[Stripe] ❌ 官方收银台拦截：${postCaptcha.message || '我们无法验证您的浏览器'}`);
            return {
                action: 'captcha_failed',
                error: postCaptcha.message || '触发官方高频人机验证拦截（我们无法验证您的浏览器）。卡密资产未核销并已自动回滚，请稍后重试',
                screenshot: screenshotPath
            };
        }
        const overlayStill = await hasAnyCheckoutCaptchaSignal(page);
        if (overlayStill) {
            const screenshotPath = await saveDebugScreenshot(page, 'captcha_post_submit');
            console.log('[Stripe] ❌ 提交后人机验证未能自动通过');
            return {
                action: 'captcha_failed',
                error: buildCaptchaRequiredError(),
                screenshot: screenshotPath
            };
        }
        console.log('[Stripe] ⚠️ 提交后验证未能自动清除（无可见弹层）');
    }

    const postBodyText = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
    if (/无法验证.*浏览器|未能验证.*浏览器|我们无法验证您的浏览器|unable to verify (your )?browser|failed to verify (your )?browser/i.test(postBodyText)) {
        const screenshotPath = await saveDebugScreenshot(page, 'captcha_browser_verification_failed');
        console.log('[Stripe] ❌ 官方收银台拦截：我们无法验证您的浏览器');
        return {
            action: 'captcha_failed',
            error: '触发官方高频人机验证拦截（我们无法验证您的浏览器）。卡密资产未核销并已自动回滚，请稍后重试',
            screenshot: screenshotPath
        };
    }

    if (postCaptcha.cleared) {
        if (postCaptcha.via === 'visual-solver') {
            console.log('[Stripe] ✅ 提交后 hCaptcha 已由视觉求解器通过');
        } else if (!postCaptcha.skipped) {
            console.log('[Stripe] ✅ 提交后人机验证已通过');
        }
    }

    return { action: 'continue', captcha: postCaptcha };
}

async function finalizeCheckoutPayment(page, holderName, onBeforeSubmit = null, accountEmail = '', planType = 'claude_pro', options = {}) {
    if (options.platform === 'grok') {
        const observer = observeGrokPayment(page, planType);
        try {
            const beforeSubmit = await readGrokPaymentSnapshot(page);
            console.log('[Grok] 单次提交支付并观察本次 Checkout 结果...');
            await clickGrokSubmitOnce(page, async () => { await onBeforeSubmit(); observer.arm(); });
            return await waitForGrokPaymentOutcome(page, {
                observer, beforeSubmit, timeoutMs: options.resultTimeoutMs || PAYMENT_RESULT_TIMEOUT_MS,
                hasCaptcha: () => hasAnyCheckoutCaptchaSignal(page),
                checkInlineError: () => checkStripeCardInlineError(page),
                clearCaptcha: maxWaitMs => clearHumanVerification(page, {
                    phase: 'grok-post-submit', maxWaitMs, requireCheckoutReady: false,
                    useVisualSolver: false, overlayWaitMs: 0
                }),
                screenshot: name => saveDebugScreenshot(page, name)
            });
        } finally { observer.dispose(); }
    }
    if (isClaudeCustomCheckout(page)) {
        const observer = observeClaudePayment(page);
        try {
            const beforeSubmit = await readClaudePaymentSnapshot(page);
            const accountBeforeSubmit = getClaudeAccountSnapshot(page);
            console.log('[Stripe] Step 9: 单次提交 Claude 支付，已开启状态观测...');
            const submitted = await clickCheckoutSubmitButton(page, accountEmail, onBeforeSubmit);
            if (!submitted) return { success: false, submitted: false, error: 'Claude 提交按钮未就绪' };
            const outcome = await waitForClaudePaymentOutcome(page, {
                observer, beforeSubmit,
                timeoutMs: PAYMENT_RESULT_TIMEOUT_MS,
                captchaTimeoutMs: Number(process.env.CAPTCHA_POST_SUBMIT_TIMEOUT_MS || 180000),
                hasCaptcha: () => hasAnyCheckoutCaptchaSignal(page),
                checkInlineError: () => checkStripeCardInlineError(page),
                clearCaptcha: maxWaitMs => clearHumanVerification(page, {
                    phase: 'post_submit', maxWaitMs,
                    maxBypassRounds: Number(process.env.CAPTCHA_POST_SUBMIT_MAX_ROUNDS || 8),
                    requireCheckoutReady: false, useVisualSolver: true, overlayWaitMs: 0
                }),
                screenshot: name => saveDebugScreenshot(page, name),
                confirmEntitlement: async () => {
                    if (!accountBeforeSubmit) return false;
                    const { account } = await readClaudeAccountInBrowser(page, 1500).catch(() => ({ account: null }));
                    return hasNewClaudeProEntitlement(accountBeforeSubmit, account, planType);
                }
            });
            return { ...outcome, holderName };
        } finally {
            observer.dispose();
        }
    }
    console.log('[Stripe] Step 9: 点击订阅/支付...');
    const submitted = await clickCheckoutSubmitButton(page, accountEmail, onBeforeSubmit);
    if (!submitted) {
        const screenshotPath = await saveDebugScreenshot(page, 'submit_not_found');
        return { success: false, error: '无法找到提交/支付按钮', screenshot: screenshotPath, submitted: false };
    }

    // 🌟 提交后快速检查信用卡行内错误（如“您的银行卡卡号不完整”导致表单被客户端拦截）
    await page.waitForTimeout(400);
    const inlineErrorAfterClick = await checkStripeCardInlineError(page);
    if (inlineErrorAfterClick.hasError) {
        console.log(`[Stripe] ❌ 提交后检测到信用卡字段错误拦截: ${inlineErrorAfterClick.message}`);
        const screenshotPath = await saveDebugScreenshot(page, 'card_inline_error_after_submit');
        return {
            success: false,
            error: `银行卡信息无效导致提交被拦截: ${inlineErrorAfterClick.message}`,
            screenshot: screenshotPath,
            declined: true,
            canRetryCard: true,
            submitted: false
        };
    }

    const postResult = await handlePostSubmitPhase(page);
    if (postResult.action === 'declined') {
        return buildDeclinedPaymentResult(page, postResult.declineMsg, postResult.screenshot);
    }
    if (postResult.action === 'captcha_failed') {
        return {
            success: false,
            error: postResult.error,
            screenshot: postResult.screenshot,
            captchaRequired: true,
            submitted: false
        };
    }
    if (postResult.action === 'success') {
        console.log('[Stripe] ✅ 支付成功！');
        const screenshotPath = await saveDebugScreenshot(page, 'payment_success');
        return { success: true, holderName, screenshot: screenshotPath };
    }

    const paymentOutcome = await waitForPaymentResult(page, holderName);
    if (paymentOutcome.success) {
        console.log('[Stripe] ✅ 支付成功！');
        return {
            success: true,
            holderName: paymentOutcome.holderName,
            screenshot: paymentOutcome.screenshot
        };
    }
    if (paymentOutcome.error && PAYMENT_DECLINE_PATTERNS.some((re) => re.test(paymentOutcome.error))) {
        return {
            ...paymentOutcome,
            declined: true,
            canRetryCard: true
        };
    }
    return paymentOutcome;
}

/**
 * 点击 Subscribe 后轮询等待：处理加载中、成功跳转、拒付文案
 */
async function buildPaymentSuccessResult(page, holderName) {
    const screenshotPath = await saveDebugScreenshot(page, 'payment_success');
    return { success: true, holderName, screenshot: screenshotPath };
}

async function waitForPaymentResult(page, holderName) {
    const maxSec = Math.round(PAYMENT_RESULT_TIMEOUT_MS / 1000);
    console.log(`[Stripe] Step 10: 等待支付结果（最长 ${maxSec}s，含 Stripe 处理中）...`);
    page.setDefaultTimeout(Math.max(PAYMENT_RESULT_TIMEOUT_MS, 120000));

    const deadline = Date.now() + PAYMENT_RESULT_TIMEOUT_MS;
    let lastProgressLog = 0;
    let lastLiveShot = 0;
    let captchaAttempts = 0;

    while (Date.now() < deadline) {
        const url = page.url();

        const captchaBlocking = await hasAnyCheckoutCaptchaSignal(page)
            || await isHumanVerificationVisible(page);

        if (captchaBlocking) {
            captchaAttempts += 1;
            console.log(`[Stripe] 检测到人机验证弹层，开始第 ${captchaAttempts} 次自动处理...`);
            const captchaResult = await clearHumanVerification(page, {
                phase: `payment-poll-${captchaAttempts}`,
                maxWaitMs: Number(process.env.CAPTCHA_POST_SUBMIT_TIMEOUT_MS || 180000),
                maxBypassRounds: Number(process.env.CAPTCHA_POST_SUBMIT_MAX_ROUNDS || 8),
                requireCheckoutReady: false,
                useVisualSolver: true,
                overlayWaitMs: 0
            });
            if (captchaResult.cleared) {
                console.log('[Stripe] ✅ 人机验证已通过，继续等待支付结果');
                continue;
            }
            if (captchaResult.browserVerificationFailed) {
                const screenshotPath = await saveDebugScreenshot(page, 'captcha_browser_verification_failed');
                console.log(`[Stripe] ❌ 官方收银台拦截：${captchaResult.message || '我们无法验证您的浏览器'}`);
                return {
                    success: false,
                    error: captchaResult.message || '触发官方高频人机验证拦截（我们无法验证您的浏览器）。卡密资产未核销并已自动回滚，请稍后重试',
                    screenshot: screenshotPath,
                    captchaRequired: true,
                    submitted: false
                };
            }
            const screenshotPath = await saveDebugScreenshot(page, 'captcha_challenge_required');
            console.log('[Stripe] ❌ 人机验证无法自动通过，需人工处理（hCaptcha/Cloudflare）');
            return {
                success: false,
                error: buildCaptchaRequiredError(),
                screenshot: screenshotPath,
                captchaRequired: true,
                submitted: false
            };
        }

        if (url.includes('redirect_status=succeeded')) {
            console.log('[Stripe] ✅ URL 含 redirect_status=succeeded');
            return buildPaymentSuccessResult(page, holderName);
        }

        if (/chatgpt\.com/i.test(url) && !/\/checkout\//i.test(url)) {
            console.log('[Stripe] ✅ 已离开 checkout 页面');
            return buildPaymentSuccessResult(page, holderName);
        }

        if (/claude\.ai/i.test(url) && !/\/upgrade/i.test(url)) {
            console.log(`[Stripe] ✅ Claude 支付成功，已离开 upgrade 页面: ${url}`);
            return buildPaymentSuccessResult(page, holderName);
        }

        const bodyText = String(await page.textContent('body', { timeout: 8000 }).catch(() => '') || '');

        if (/无法验证.*浏览器|未能验证.*浏览器|我们无法验证您的浏览器|unable to verify (your )?browser|failed to verify (your )?browser/i.test(bodyText)) {
            console.log('[Stripe] ❌ 官方收银台拦截：我们无法验证您的浏览器');
            const screenshotPath = await saveDebugScreenshot(page, 'captcha_browser_verification_failed');
            return {
                success: false,
                error: '触发官方高频人机验证拦截（我们无法验证您的浏览器）。建议更换纯净代理 IP 稍后重试',
                screenshot: screenshotPath,
                captchaRequired: true,
                submitted: false
            };
        }

        if (/安全验证未完成|安全检查未完成|人机验证未完成|购买未成功.*重试|verification.*not completed/i.test(bodyText)) {
            console.log('[Claude/Stripe] ⚠️ 页面提示「安全验证未完成，因此您的购买未成功。您可以重试。」');
            if (captchaAttempts < 4) {
                captchaAttempts += 1;
                console.log(`[Claude/Stripe] 重新点击提交按钮唤起人机验证 (尝试 ${captchaAttempts}/4)...`);
                await clickCheckoutSubmitButton(page);
                await page.waitForTimeout(1500);

                console.log('[Claude/Stripe] 唤起人机验证处理（含用户交互透传）...');
                const captchaResult = await clearHumanVerification(page, {
                    phase: `claude-retry-${captchaAttempts}`,
                    maxWaitMs: 90000,
                    maxBypassRounds: 2,
                    requireCheckoutReady: false,
                    useVisualSolver: true,
                    overlayWaitMs: 0
                });
                if (captchaResult.cleared) {
                    console.log('[Claude/Stripe] ✅ 重新验证已通过，继续等待支付跳转');
                    await page.waitForTimeout(3000);
                    continue;
                }
            } else {
                const screenshotPath = await saveDebugScreenshot(page, 'captcha_verification_failed');
                return {
                    success: false,
                    error: '安全验证未完成，因此购买未成功。请使用前端交互式透传完成点击验证',
                    screenshot: screenshotPath,
                    captchaRequired: true,
                    submitted: false
                };
            }
        }

        for (const re of PAYMENT_DECLINE_PATTERNS) {
            if (re.test(bodyText)) {
                const match = bodyText.match(re);
                const msg = match ? match[0] : 'card declined';
                console.log(`[Stripe] ❌ 检测到拒付/失败: ${msg}`);
                const screenshotPath = await saveDebugScreenshot(page, 'payment_declined');
                return buildDeclinedPaymentResult(page, msg, screenshotPath);
            }
        }

        for (const re of PAYMENT_SUCCESS_PATTERNS) {
            if (re.test(bodyText)) {
                console.log(`[Stripe] ✅ 页面文案确认支付成功`);
                return buildPaymentSuccessResult(page, holderName);
            }
        }

        try {
            const alerts = page.getByRole('alert');
            const alertCount = await alerts.count();
            for (let i = 0; i < alertCount; i += 1) {
                const alertText = String(await alerts.nth(i).textContent({ timeout: 500 }).catch(() => '') || '');
                if (!alertText.trim()) continue;
                if (PAYMENT_DECLINE_PATTERNS.some((re) => re.test(alertText))) {
                    console.log(`[Stripe] ❌ Alert 拒付: ${alertText.trim()}`);
                    const screenshotPath = await saveDebugScreenshot(page, 'payment_declined');
                    return buildDeclinedPaymentResult(page, alertText.trim(), screenshotPath);
                }
            }
        } catch (_) { /* no alerts */ }

        const now = Date.now();
        if (now - lastProgressLog >= 15000) {
            const processing = await page.locator(
                '[aria-busy="true"], button[disabled]:has-text("Subscribe"), button[disabled]:has-text("订阅")'
            ).first().isVisible({ timeout: 800 }).catch(() => false);
            const elapsed = Math.round((now - (deadline - PAYMENT_RESULT_TIMEOUT_MS)) / 1000);
            console.log(`[Stripe] 等待支付结果 ${elapsed}s/${maxSec}s${processing ? '（Stripe 处理中…）' : ''}`);
            lastProgressLog = now;
        }

        // 等待期间每 15s 保存一次实时截图，供后台刷新查看当前页面状态
        if (now - lastLiveShot >= 15000) {
            lastLiveShot = now;
            const livePath = await saveDebugScreenshot(page, 'payment_live');
            if (livePath) {
                console.log(`LIVE_SCREENSHOT: ${livePath}`);
            }
        }

        await page.waitForTimeout(PAYMENT_RESULT_POLL_MS);
    }

    const screenshotPath = await saveDebugScreenshot(page, 'payment_result_timeout');
    const submitBtnStillVisible = await page.getByRole('button', { name: /^Subscribe$|^Upgrade to|^订阅$/i }).first().isVisible({ timeout: 500 }).catch(() => false);
    const hasRealCaptcha = await hasAnyCheckoutCaptchaSignal(page)
        || await isHumanVerificationVisible(page);

    if (hasRealCaptcha && !submitBtnStillVisible) {
        return {
            success: false,
            error: buildCaptchaRequiredError(),
            screenshot: screenshotPath,
            captchaRequired: true,
            submitted: false
        };
    }
    return {
        success: false,
        error: submitBtnStillVisible
            ? `支付提交未响应（页面停留在收银台，可能因表单必填字段未通过校验或 Stripe 响应超时），当前 URL: ${page.url()}`
            : `支付结果等待超时（${maxSec}s），当前 URL: ${page.url()}`,
        screenshot: screenshotPath,
        submitted: false
    };
}

// ==================== Internal Helpers ====================

/**
 * 等待并获取 Stripe iframe 的 Frame 对象
 * @param {import('playwright').Page} page
 * @param {string[]} selectors - iframe 选择器列表
 * @param {number} timeout - 超时时间 ms
 * @returns {Promise<import('playwright').Frame|null>}
 */
async function waitForStripeFrame(page, selectors, timeout) {
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
        for (const sel of selectors) {
            try {
                const iframeEl = page.locator(sel).first();
                if (await iframeEl.isVisible({ timeout: 1000 })) {
                    const elementHandle = await iframeEl.elementHandle();
                    if (elementHandle) {
                        const frame = await elementHandle.contentFrame();
                        if (frame) {
                            // Wait for the input inside the iframe to be ready
                            try {
                                await frame.waitForSelector('input', { timeout: 5000 });
                                return frame;
                            } catch (_) {
                                // iframe visible but input not ready yet, continue waiting
                            }
                        }
                    }
                }
            } catch (_) { /* try next selector */ }
        }
        await page.waitForTimeout(500);
    }

    return null;
}

async function waitForBillingFields(page, timeout = 20000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (page.isClosed()) throw new Error('[CHECKOUT_PAGE_CLOSED] 等待账单字段时支付页面已关闭');
        // Use the same billing scope as value validation, including rendered iframes.
        // A heading, hidden select, or contact/shipping field alone is not ready.
        for (const frame of page.frames()) {
            if (frame.isDetached()) continue;
            const items = await getBillingInputsBelowHeading(frame);
            if (items.some((item) => billingFieldKey(item))) return true;
        }
        await page.waitForTimeout(250);
    }
    console.warn('[Stripe] ⚠️ 账单地址字段未在超时内出现');
    return false;
}

const OPENAI_BILLING_FIELD_SELECTORS = {
    name: [
        '#billingAddress-nameInput',
        'input[name="name"][autocomplete="billing name"]',
        'input[autocomplete="billing name"]'
    ],
    country: [
        '#billingAddress-countryInput',
        'select[name="country"][autocomplete="billing country"]',
        'select[name="country"]'
    ],
    line1: [
        '#billingAddress-addressLine1Input',
        '#billingAddressLine1',
        'input[name="addressLine1"]',
        'input[name="billingAddressLine1"]',
        'input[autocomplete="billing address-line1"]',
        'input[autocomplete="address-line1"]',
        'input.pac-target-input',
        'input[placeholder*="Address line 1" i]',
        'input[placeholder*="Street" i]'
    ],
    city: [
        '#billingAddress-localityInput',
        'input[name="locality"]',
        'input[autocomplete="billing address-level2"]'
    ],
    postal: [
        '#billingAddress-postalCodeInput',
        'input[name="postalCode"]',
        'input[autocomplete="billing postal-code"]'
    ],
    state: [
        '#billingAddress-administrativeAreaInput',
        'select[name="administrativeArea"]',
        'select[autocomplete="billing address-level1"]'
    ]
};

async function resolveElementTag(el) {
    return el.evaluate((node) => node.tagName.toLowerCase()).catch(() => '');
}

async function fillFirstVisibleSelector(page, selectors, value, logLabel, waitMs = 8000) {
    if (value === undefined || value === null || String(value) === '') return false;
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
        for (const sel of selectors) {
            try {
                const el = page.locator(sel).first();
                if ((await el.count()) === 0) continue;
                const tag = await resolveElementTag(el);
                if (tag === 'select') continue;
                if (!(await el.isVisible({ timeout: 300 }).catch(() => false))) continue;
                const current = String(await el.inputValue({ timeout: 500 }).catch(() => '')).trim();
                if (current && current.toLowerCase() === String(value).trim().toLowerCase()) {
                    console.log(`  [Stripe] ⏭️ ${logLabel} 已有正确值，跳过`);
                    return true;
                }
                if (current) {
                    console.log(`  [Stripe] 🔄 ${logLabel} 现有值 (${current}) 与目标值 (${value}) 不一致，正在覆写...`);
                    await el.fill('');
                }
                await safeScrollIntoView(el);
                await el.click({ timeout: 2000 }).catch(() => {});
                await el.fill(String(value));
                console.log(`  [Stripe] ✅ ${logLabel}: ${value}`);
                return true;
            } catch (_) { /* next selector */ }
        }
        await page.waitForTimeout(500);
    }
    return false;
}

async function selectFirstVisibleSelect(page, selectors, optionLabels, logLabel, waitMs = 8000) {
    const options = [...new Set(optionLabels.map(String).filter(Boolean))];
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
        for (const sel of selectors) {
            try {
                const el = page.locator(sel).first();
                if ((await el.count()) === 0) continue;
                const tag = await resolveElementTag(el);
                if (tag !== 'select') {
                    if (!(await el.isVisible({ timeout: 300 }).catch(() => false))) continue;
                    const ok = await selectBillingComboboxItem(page, { el }, options, logLabel);
                    if (ok) return true;
                    continue;
                }
                // 原生 <select> 常被视觉隐藏（自定义下拉覆盖），不要求 visible，直接 selectOption
                for (const opt of options) {
                    try {
                        await el.selectOption({ label: opt }, { timeout: 2000 });
                        console.log(`  [Stripe] ✅ ${logLabel}: ${opt}`);
                        await page.waitForTimeout(600);
                        return true;
                    } catch (_) { /* next */ }
                    try {
                        await el.selectOption({ value: opt }, { timeout: 2000 });
                        console.log(`  [Stripe] ✅ ${logLabel}: ${opt} (value)`);
                        await page.waitForTimeout(600);
                        return true;
                    } catch (_) { /* next */ }
                }
            } catch (_) { /* next selector */ }
        }
        await page.waitForTimeout(500);
    }
    return false;
}

async function getCurrentBillingCountryValue(page) {
    const group = await getAuthoritativeBillingGroup(page);
    const item = group?.items.find((item) => billingFieldKey(item) === 'country');
    if (!item) return { value: '', label: '' };
    const label = await readControlValue(item);
    return { value: billingCountryCode(label), label };
}

function billingCountryOptions(country) {
    const code = billingCountryCode(country || 'US');
    return {
        US: ['United States', '美国', 'US'],
        PH: ['Philippines', '菲律宾', 'PH'],
        SG: ['Singapore', '新加坡', 'SG'],
        MY: ['Malaysia', '马来西亚', 'MY']
    }[code] || [code];
}

async function billingCountryFailure(page, address, filled) {
    const current = await getCurrentBillingCountryValue(page);
    const actual = /^[A-Z]{2}$/.test(current.value) ? current.value : '未确认';
    return {
        ok: false,
        error: `账单国家切换失败：目标 ${billingCountryCode(address.country || 'US')}，当前 ${actual}；已停止后续地址填写，未提交付款 [BILLING_COUNTRY_MISMATCH]`,
        filled
    };
}

const US_STATE_LABELS = {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
    CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
    HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
    KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
    MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
    MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
    NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
    ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
    RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
    TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
    WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia'
};

function normalizeStateText(value) {
    return normalizeBillingValue(value)
        .replace(/^(?:billing\s+)?(?:state|province|state\/province|region|州|省份)\s*[:：-]?\s*/i, '')
        .replace(/[()[\],]/g, ' ')
        .replace(/\s*[-–—]\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function stateCodeForValue(value) {
    const normalized = normalizeStateText(value);
    if (!normalized) return '';
    const upper = normalized.toUpperCase();
    if (US_STATE_LABELS[upper]) return upper;

    for (const [code, name] of Object.entries(US_STATE_LABELS)) {
        const fullName = normalizeBillingValue(name);
        if (normalized === fullName || normalized === `${fullName} state`) return code;
        // Stripe sometimes renders values such as "OR - Oregon" or
        // "Oregon (OR)". Accept a short decorated value, but never a whole
        // menu's text containing an unrelated state.
        if (normalized.length <= fullName.length + 16
            && normalized.includes(fullName)
            && new RegExp(`(?:^|\\s)${code.toLowerCase()}(?:$|\\s)`).test(normalized)) return code;
    }
    return '';
}

function stateValuesMatch(actual, expected) {
    const actualText = normalizeStateText(actual);
    const expectedText = normalizeStateText(expected);
    if (!actualText || !expectedText) return false;
    if (actualText === expectedText) return true;
    const actualCode = stateCodeForValue(actualText);
    const expectedCode = stateCodeForValue(expectedText);
    return Boolean(actualCode && expectedCode && actualCode === expectedCode);
}

function normalizeStateFullName(state) {
    const raw = String(state || '').trim();
    if (!raw) return raw;
    const code = stateCodeForValue(raw);
    return code ? US_STATE_LABELS[code] : raw;
}

async function fillInputLocator(locator, value, label = '字段') {
    if (!value) return false;
    try {
        console.log(`  [Stripe] 填写 ${label}...`);
        await locator.waitFor({ state: 'visible', timeout: 3000 });
        await locator.scrollIntoViewIfNeeded();
        await locator.click({ timeout: 2000 });
        await locator.fill(String(value));
        return true;
    } catch (_) {
        console.log(`  [Stripe] ⚠️ ${label} 跳过（未找到或不可填）`);
        return false;
    }
}

/**
 * 在 page 及所有 frame 中按多种策略查找可填控件
 */
// 禁用 Google Places 地址联想下拉（分字段填地址时不能选建议项，否则会卡住支付）
async function suppressGoogleAddressAutocomplete(page) {
    await page.evaluate(() => {
        if (!document.getElementById('stripe-hide-pac')) {
            const style = document.createElement('style');
            style.id = 'stripe-hide-pac';
            style.textContent = '.pac-container{display:none!important;visibility:hidden!important;pointer-events:none!important;}';
            (document.head || document.documentElement).appendChild(style);
        }
        document.querySelectorAll('.pac-container').forEach((el) => {
            el.style.display = 'none';
            el.style.visibility = 'hidden';
        });
    }).catch(() => { });
}

// 关闭 Address line 1 触发的 Google Places 自动补全下拉（我们分字段填地址，不能选建议项）
async function dismissAddressAutocomplete(page) {
    try {
        const suggestion = page.getByText(/Suggestions powered by Google/i).first();
        const hadDropdown = await suggestion.isVisible({ timeout: 800 }).catch(() => false);
        if (hadDropdown) {
            console.log('  [Stripe] 检测到 Google 地址联想下拉，正在关闭...');
        }

        // 1) 优先点击下拉里的关闭按钮（× icon）
        if (hadDropdown) {
            const closeBtn = page.locator('[aria-label*="close" i], [aria-label*="关闭" i], [aria-label*="dismiss" i], button:has-text("×"), button:has-text("x")').first();
            if (await closeBtn.isVisible({ timeout: 400 }).catch(() => false)) {
                await closeBtn.click({ timeout: 1000 }).catch(() => { });
                await page.waitForTimeout(200);
            }
        }

        // 2) 主动让当前聚焦元素失焦 + 隐藏/移除 Google 注入的 pac-container 及地址联想列表
        await page.evaluate(() => {
            try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (_) { }
            try {
                document.querySelectorAll('.pac-container, [role="listbox"]:has(.pac-item), [class*="autocomplete-dropdown"]').forEach((el) => {
                    el.style.display = 'none';
                });
            } catch (_) { }
        }).catch(() => { });

        // 3) 连按两次 Escape
        await page.keyboard.press('Escape').catch(() => { });
        await page.waitForTimeout(100);
        await page.keyboard.press('Escape').catch(() => { });

        if (!hadDropdown) return;

        // 4) 点击中性区域（右侧套餐卡 / 账单标题）彻底收起下拉
        const heading = page.getByText(/^\s*Billing address\s*$|^\s*账单地址\s*$/i).first();
        if (await heading.isVisible({ timeout: 600 }).catch(() => false)) {
            await heading.click({ timeout: 1000 }).catch(() => { });
        }
        await page.waitForTimeout(300);

        // 5) 终检：仍在则再 Escape + 隐藏
        if (await suggestion.isVisible({ timeout: 400 }).catch(() => false)) {
            await page.keyboard.press('Escape').catch(() => { });
            await page.evaluate(() => {
                document.querySelectorAll('.pac-container').forEach((el) => { el.style.display = 'none'; });
            }).catch(() => { });
            await page.waitForTimeout(200);
            const still = await suggestion.isVisible({ timeout: 300 }).catch(() => false);
            console.log(`  [Stripe] ${still ? '⚠️ 地址联想下拉仍可见' : '✅ 地址联想下拉已关闭'}`);
        } else if (hadDropdown) {
            console.log('  [Stripe] ✅ 地址联想下拉已关闭');
        }
    } catch (_) { /* best-effort */ }
}

async function focusOpenAiBillingSection(page) {
    const group = await getAuthoritativeBillingGroup(page);
    const frame = group?.frame || page;
    // 平滑失焦：仅使当前焦点元素失焦，严禁点击 (12,12) 导致页面剧烈上滚跳动
    await page.evaluate(() => {
        try {
            if (document.activeElement && document.activeElement !== document.body) {
                document.activeElement.blur();
            }
        } catch (_) {}
    }).catch(() => {});
    await page.keyboard.press('Escape').catch(() => { });
    const heading = await locateOpenAiBillingHeading(page, group);
    if (heading) {
        await heading.click({ timeout: 2000 }).catch(() => { });
    } else {
        const street = group?.items.find((item) => billingFieldKey(item) === 'line1');
        await safeScrollIntoView(street?.el);
    }
    await page.waitForTimeout(100);
}

async function getBillingInputsBelowHeading(page, { includeHiddenSelects = false } = {}) {
    const controls = page.locator([
        'input:visible',
        includeHiddenSelects ? 'select' : 'select:visible',
        'textarea:visible',
        '[role="combobox"]:visible',
        'button:visible[aria-haspopup="listbox"]',
        'button:visible[aria-expanded]',
        'button:visible[id*="state" i]',
        'button:visible[name*="state" i]',
        'button:visible[aria-label*="state" i]',
        'button:visible[aria-label*="Country" i]',
        'button:visible[id*="country" i]'
    ].join(', '));
    const items = [];
    for (let i = 0, count = await controls.count(); i < count; i += 1) {
        const el = controls.nth(i);
        let box = await el.boundingBox().catch(() => null);
        if (includeHiddenSelects && !(await el.isVisible().catch(() => false))) box = null;
        if (!box && !(includeHiddenSelects && await resolveElementTag(el) === 'select')) continue;
        const meta = await el.evaluate((node) => {
            const shown = (el) => Boolean(el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';
            const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
            const isBillingHeading = (el) => shown(el) && /^Billing address$|^账单地址$/i.test(text(el));
            const heading = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"],legend')].find(isBillingHeading)
                || [...document.querySelectorAll('label,p,span,div')].find((el) => isBillingHeading(el)
                    && ![...el.children].some(isBillingHeading));
            const explicitBilling = /billing/i.test(`${node.id} ${node.name || ''} ${node.getAttribute('autocomplete') || ''}`);
            const follows = (first, second) => Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
            if (!heading && !explicitBilling) return null;
            if (heading) {
                const group = heading.closest('fieldset,section,[role="group"]');
                if (group && group.querySelector('input,select,textarea,[role="combobox"]') && !group.contains(node) && !explicitBilling) return null;
                if (!follows(heading, node) && !explicitBilling) return null;
                const boundaries = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"],legend,p,span')]
                    .filter((el) => shown(el) && el !== heading && !el.contains(heading) && !heading.contains(el) && follows(heading, el)
                        && (/^(?:Personal information(?: \(optional\))?|Save (?:my|your) (?:info|information).*|Link|Contact information|Shipping address|Payment method)$/i.test(text(el))
                            || (el.matches('h1,h2,h3,h4,h5,h6,[role="heading"],legend')
                                && !(group && group.contains(el))
                                && !/^(?:Name|Full name|Address|Country|Country or region|City|State|Province|Postal code|ZIP code)$/i.test(text(el)))));
                if (boundaries.some((boundary) => follows(boundary, node) || boundary.contains(node))) return null;
            }

            const labelFromFor = () => {
                const id = node.id;
                if (!id) return '';
                const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
                return lbl ? (lbl.textContent || '').trim() : '';
            };
            const labelFromWrap = () => {
                const lbl = node.closest('label');
                return lbl ? (lbl.textContent || '').trim() : '';
            };
            const labelFromAria = () => {
                const labelledBy = node.getAttribute('aria-labelledby');
                if (!labelledBy) return '';
                const parts = labelledBy.split(/\s+/).map((id) => {
                    const n = document.getElementById(id);
                    return n ? (n.textContent || '').trim() : '';
                }).filter(Boolean);
                return parts.join(' ');
            };
            const labelFromParent = () => {
                let parent = node.parentElement;
                for (let depth = 0; depth < 4 && parent; depth += 1) {
                    // A group label must not be inherited by all sibling fields.
                    const fields = [...parent.querySelectorAll('input:not([type="hidden"]),select,textarea,[role="combobox"]')].filter(shown);
                    if (fields.length !== 1 || fields[0] !== node) return '';
                    const lbl = parent.querySelector(':scope > label, :scope > span, :scope > div');
                    const forId = lbl?.getAttribute('for');
                    const text = lbl && (!forId || forId === node.id) ? (lbl.textContent || '').trim() : '';
                    if (text && text.length < 80) return text;
                    parent = parent.parentElement;
                }
                return '';
            };
            return {
                tag: node.tagName.toLowerCase(),
                type: node.getAttribute('type') || '',
                autocomplete: node.getAttribute('autocomplete') || '',
                placeholder: node.getAttribute('placeholder') || '',
                ariaLabel: node.getAttribute('aria-label') || '',
                name: node.getAttribute('name') || '',
                role: node.getAttribute('role') || '',
                id: node.id || '',
                className: node.className || '',
                title: node.getAttribute('title') || '',
                dataTestId: node.getAttribute('data-testid') || '',
                text: text(node),
                labelText: labelFromFor() || labelFromWrap() || labelFromAria() || labelFromParent()
            };
        }).catch(() => null);
        if (!meta) continue;
        const hay = `${meta.autocomplete} ${meta.placeholder} ${meta.ariaLabel} ${meta.name} ${meta.labelText} ${meta.id} ${meta.className} ${meta.title} ${meta.dataTestId} ${meta.text}`.toLowerCase();
        if (/^(email|tel|password|checkbox|radio)$/.test(meta.type)) continue;
        if (/email|phone|mobile|card|cvc|cc-|expir|security code|contact|optional/.test(hay)) continue;
        items.push({ el, box, meta, hay, y: box?.y ?? Infinity, x: box?.x ?? Infinity });
    }
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    return items;
}

async function fillBillingTextItem(item, value, logLabel) {
    if (!item?.el || value === undefined || value === null || value === '') return false;
    try {
        await safeScrollIntoView(item.el);
        await item.el.click({ timeout: 2000 }).catch(() => {});
        await item.el.fill(String(value));
        console.log(`  [Stripe] ✅ ${logLabel}: ${value}`);
        return true;
    } catch (error) {
        console.log(`  [Stripe] ⚠️ ${logLabel} 填写失败: ${error.message}`);
        return false;
    }
}

async function pickBillingItem(items, matchers) {
    for (const item of items) {
        if (matchers.some((re) => re.test(item.hay))) {
            return item;
        }
    }
    return null;
}

function billingOptionMatches(value, optionLabels, isState = false) {
    const actual = String(value || '').trim();
    if (!actual) return false;
    return optionLabels.some((option) => isState
        ? stateValuesMatch(actual, option)
        : normalizeBillingValue(actual) === normalizeBillingValue(option));
}

async function selectNativeBillingOption(el, optionLabels, logLabel, timeoutMs = 1200, isState = false) {
    const options = [...new Set(optionLabels.map(String).filter(Boolean))];
    if (!options.length) return false;

    // Inspect existing options first: selectOption waits for absent options until
    // its timeout, which previously accumulated into several minutes per state.
    const match = await el.evaluate((node) => {
        if (node.disabled) return null;
        return [...node.options]
            .filter((option) => !option.disabled && option.value)
            .map((option) => ({ value: option.value, label: option.textContent || '' }));
    }).catch(() => null);
    const option = match?.find((candidate) =>
        billingOptionMatches(candidate.value, options, isState)
        || billingOptionMatches(candidate.label, options, isState));
    if (!option) return false;

    try {
        // change may replace this control immediately. The caller re-reads the
        // live billing group instead of querying this stale locator again.
        const selected = await el.selectOption({ value: option.value }, { force: true, timeout: timeoutMs });
        if (!selected.includes(option.value)) return false;
        console.log(`  [Stripe] ✅ ${logLabel}: ${option.label || option.value}`);
        return true;
    } catch (_) { return false; }
}

const BILLING_OPTION_SELECTOR = [
    '[role="option"]',
    '[role="menuitem"]',
    '[role="menuitemradio"]',
    '[data-value]',
    '[value]',
    'button',
    'li',
    '[role="listbox"] > div',
    '[role="listbox"] > span',
    '[role="menu"] > div',
    '[role="menu"] > span',
    'div',
    'span'
].join(',');

function escapeCssIdentifier(value) {
    return String(value || '').replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function getBillingPopupScopes(frame, item) {
    const scopes = [];
    const controlledIds = await item.el.evaluate((node) =>
        `${node.getAttribute('aria-controls') || ''} ${node.getAttribute('aria-owns') || ''}`
            .trim().split(/\s+/).filter(Boolean)
    ).catch(() => []);

    for (const id of controlledIds) {
        const scope = frame.locator(`#${escapeCssIdentifier(id)}`).first();
        if (await scope.count().catch(() => 0)) scopes.push(scope);
    }

    // Stripe and its UI primitives often render the listbox in a portal instead
    // of under the combobox. Search only visible popup-like containers in the
    // current frame so phone/shipping controls are not borrowed accidentally.
    for (const selector of [
        '[role="listbox"]:visible',
        '[role="menu"]:visible',
        '[data-radix-popper-content-wrapper]:visible',
        '[data-floating-ui-portal]:visible',
        '[class*="popover"]:visible',
        '[class*="dropdown"]:visible',
        '[class*="menu"]:visible'
    ]) {
        const scope = frame.locator(selector);
        if (await scope.count().catch(() => 0)) scopes.push(scope);
    }

    // A plain div menu may have no role or identifying class. Once the control
    // is open, exact text matching below is still restricted to this frame.
    if (!scopes.length) scopes.push(frame.locator('body'));
    return scopes;
}

async function getBillingCandidateValues(locator) {
    return locator.evaluate((node) => [
        node.textContent || '',
        node.innerText || '',
        node.getAttribute('data-value') || '',
        node.getAttribute('value') || '',
        node.getAttribute('aria-label') || '',
        node.getAttribute('title') || ''
    ].map((value) => String(value).trim()).filter(Boolean)).catch(() => []);
}

async function findVisibleBillingOption(frame, item, optionLabels, isState) {
    // 1. Direct fast query for matching options in common select popups/portals
    for (const opt of optionLabels) {
        const re = new RegExp(`^\\s*${escapeRegex(opt)}\\s*$|\\b${escapeRegex(opt)}\\b`, 'i');
        for (const selector of [
            '[role="listbox"] [role="option"]:visible',
            '[role="option"]:visible',
            '[data-radix-popper-content-wrapper] [role="option"]:visible',
            '[data-floating-ui-portal] [role="option"]:visible',
            '[role="menu"] [role="menuitem"]:visible',
            'ul[role="listbox"] > li:visible',
            '.select-options li:visible',
            '.dropdown-menu li:visible',
            'button[role="option"]:visible'
        ]) {
            try {
                const loc = frame.locator(selector).filter({ hasText: re }).first();
                if ((await loc.count().catch(() => 0)) > 0 && (await loc.isVisible().catch(() => false))) {
                    return { candidate: loc, value: opt };
                }
            } catch (_) {}
        }
    }

    // 2. Scoped candidates search
    const scopes = await getBillingPopupScopes(frame, item);
    for (const scope of scopes) {
        const candidates = scope.locator(BILLING_OPTION_SELECTOR);
        const count = await candidates.count().catch(() => 0);
        const limit = Math.min(count, 120);
        for (let i = 0; i < limit; i += 1) {
            const candidate = candidates.nth(i);
            if (!(await candidate.isVisible().catch(() => false))) continue;
            if (!(await candidate.isEnabled().catch(() => true))) continue;
            const values = await getBillingCandidateValues(candidate);
            if (values.some((value) => billingOptionMatches(value, optionLabels, isState))) {
                return { candidate, value: values.find((value) => billingOptionMatches(value, optionLabels, isState)) || optionLabels[0] };
            }
        }
    }
    return null;
}

async function readActiveBillingOption(frame, item, optionLabels, isState) {
    const activeId = await item.el.getAttribute('aria-activedescendant').catch(() => '');
    if (!activeId) return null;
    const active = frame.locator(`#${escapeCssIdentifier(activeId)}`).first();
    if (!(await active.count().catch(() => 0)) || !(await active.isVisible().catch(() => false))) return null;
    const values = await getBillingCandidateValues(active);
    return values.some((value) => billingOptionMatches(value, optionLabels, isState)) ? active : null;
}

async function selectBillingComboboxItem(frame, item, optionLabels, logLabel, timeoutMs = 3000) {
    if (!item?.el) return false;
    const options = [...new Set(optionLabels.map(String).filter(Boolean))];
    if (!options.length) return false;
    const deadline = Date.now() + timeoutMs;
    const remaining = () => Math.max(1, deadline - Date.now());
    const isState = billingFieldKey(item) === 'state';
    let opened = false;

    const clickCandidate = async () => {
        const found = await findVisibleBillingOption(frame, item, options, isState);
        if (!found) return false;
        await found.candidate.click({ timeout: remaining() });
        console.log(`  [Stripe] ✅ ${logLabel}: ${found.value}`);
        return true;
    };

    try {
        const tag = item.meta?.tag || await resolveElementTag(item.el);
        if (tag === 'select') return selectNativeBillingOption(item.el, options, logLabel, remaining(), isState);

        if (tag === 'input' || tag === 'textarea') {
            // Typeahead controls can expose either the full state name or its
            // code. Try both, because Stripe has changed this widget several
            // times between checkout versions.
            for (const search of options) {
                if (Date.now() >= deadline) break;
                await item.el.fill(search, { timeout: remaining() });
                await frame.waitForTimeout(Math.min(60, remaining()));
                if (await clickCandidate()) return true;

                await item.el.press('ArrowDown', { timeout: remaining() }).catch(() => {});
                await frame.waitForTimeout(Math.min(60, remaining()));
                const active = await readActiveBillingOption(frame, item, options, isState);
                if (active) {
                    await item.el.press('Enter', { timeout: remaining() });
                    console.log(`  [Stripe] ✅ ${logLabel}: ${search}`);
                    return true;
                }
                // Some comboboxes do not expose aria-activedescendant but do
                // expose their exact candidate after ArrowDown.
                if (await clickCandidate()) return true;
                await item.el.press('Escape', { timeout: 300 }).catch(() => {});
            }
            const typedValue = await item.el.inputValue({ timeout: 300 }).catch(() => '');
            if (billingOptionMatches(typedValue, options, isState)) return true;
            return false;
        }

        await item.el.click({ timeout: remaining() });
        opened = true;
        if (await clickCandidate()) return true;

        // 优化：如果弹层包含搜索框（如国家/地区搜索），直接填入关键词秒级过滤，避免逐个 ArrowDown 遍历 200 个国家
        try {
            const popupSearch = frame.locator('input[type="search"]:visible, input[placeholder*="search" i]:visible, input[aria-label*="search" i]:visible').first();
            if ((await popupSearch.count().catch(() => 0)) > 0) {
                await popupSearch.fill(options[0]).catch(() => {});
                await frame.waitForTimeout(50);
                if (await clickCandidate()) return true;
            }
        } catch (_) {}

        let keyboardStarted = false;
        while (Date.now() < deadline) {
            if (await clickCandidate()) return true;

            if (!keyboardStarted) {
                await item.el.press('Home', { timeout: remaining() }).catch(() => {});
                keyboardStarted = true;
            } else {
                await item.el.press('ArrowDown', { timeout: remaining() }).catch(() => {});
            }
            await frame.waitForTimeout(Math.min(50, remaining()));
            const active = await readActiveBillingOption(frame, item, options, isState);
            if (active) {
                await item.el.press('Enter', { timeout: remaining() });
                console.log(`  [Stripe] ✅ ${logLabel}: ${options[0]}`);
                return true;
            }
        }
    } catch (_) { /* detached controls or a refused selection are verified by the caller */ }
    if (opened) await item.el.press('Escape', { timeout: 500 }).catch(() => {});
    return false;
}

/**
 * 快速填充单个表单字段（直连定位 + 原生 fill / 事件分发，耗时 ~30ms，杜绝慢速模拟打字与超时）
 */
async function quickFillField(page, candidates, value, label) {
    if (!value) return false;
    for (const getter of candidates) {
        try {
            const el = typeof getter === 'function' ? getter(page) : page.locator(getter).first();
            if ((await el.count()) === 0) continue;
            if (!(await el.isVisible({ timeout: 400 }).catch(() => false))) continue;

            await safeScrollIntoView(el);
            const cur = String(await el.inputValue({ timeout: 200 }).catch(() => '')).trim();
            if (cur && cur.toLowerCase() === String(value).trim().toLowerCase()) {
                console.log(`  [Stripe] ⏭️ ${label} 已有正确值: ${cur}`);
                return true;
            }

            await el.click({ timeout: 1000 }).catch(() => {});
            await el.fill('');
            await el.fill(String(value));

            let val = String(await el.inputValue({ timeout: 300 }).catch(() => '')).trim();
            if (!val) {
                // React 受控输入兜底分发 input / change 事件
                await el.evaluate((input, text) => {
                    const proto = window.HTMLInputElement.prototype;
                    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
                    if (desc && desc.set) desc.set.call(input, text);
                    else input.value = text;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }, String(value)).catch(() => {});
                val = String(await el.inputValue({ timeout: 300 }).catch(() => '')).trim();
            }

            if (val) {
                console.log(`  [Stripe] ⚡ ${label}: ${val}`);
                return true;
            }
        } catch (_) { /* try next candidate */ }
    }
    return false;
}

/**
 * 快速选择下拉/组合框字段
 */
async function quickSelectField(page, candidates, optionLabels, label) {
    const options = [...new Set(optionLabels.map(String).filter(Boolean))];
    for (const getter of candidates) {
        try {
            const el = typeof getter === 'function' ? getter(page) : page.locator(getter).first();
            if ((await el.count()) === 0) continue;

            const tag = await resolveElementTag(el);
            if (tag === 'select') {
                for (const opt of options) {
                    try {
                        await el.selectOption({ label: opt }, { timeout: 1000 });
                        console.log(`  [Stripe] ⚡ ${label}: ${opt}`);
                        return true;
                    } catch (_) {}
                    try {
                        await el.selectOption({ value: opt }, { timeout: 1000 });
                        console.log(`  [Stripe] ⚡ ${label}: ${opt} (value)`);
                        return true;
                    } catch (_) {}
                }
            } else {
                // Combobox / text typeahead
                await safeScrollIntoView(el);
                const cur = String(await el.inputValue({ timeout: 200 }).catch(() => '')).trim();
                if (cur && options.some(o => o.toLowerCase() === cur.toLowerCase())) {
                    console.log(`  [Stripe] ⏭️ ${label} 已选: ${cur}`);
                    return true;
                }
                const ok = await selectBillingComboboxItem(page, { el }, options, label);
                if (ok) return true;
            }
        } catch (_) { /* try next candidate */ }
    }
    return false;
}

async function fillBillingTextField(page, key, value, logLabel) {
    const group = await getAuthoritativeBillingGroup(page);
    const item = group?.items.find((item) => billingFieldKey(item) === key);
    if (!item || !['input', 'textarea'].includes(item.meta.tag)) return false;
    if (normalizeBillingValue(await readControlValue(item)) === normalizeBillingValue(value)) return Boolean(value);
    if (!(await fillBillingTextItem(item, value, logLabel))) return false;

    // Input events can clear or replace a control. Read the live billing field
    // again before reporting success so the retry/fallback path can run.
    const liveGroup = await getAuthoritativeBillingGroup(page);
    const liveItem = liveGroup?.items.find((item) => billingFieldKey(item) === key);
    const retained = Boolean(liveItem)
        && normalizeBillingValue(await readControlValue(liveItem)) === normalizeBillingValue(value);
    if (!retained) console.warn(`  [Stripe] ⚠️ ${logLabel} 填写后未保留目标值，需补填`);
    return retained;
}

async function fillOpenAiBillingDirect(page, address, fullName) {
    const filled = { name: false, country: false, line1: false, city: false, postal: false, state: false };
    console.log('  [Stripe] ⚡ 启用账单区 DOM 填充模式...');

    // Switching country can replace/reset the form. Confirm it first, then
    // re-find each live billing field, including fields inside a checkout iframe.
    filled.country = await selectBillingCountry(page, billingCountryOptions(address.country));
    if (!filled.country) return filled;

    // 性能优化：切完国家后，等待新表单（包含 state / postal / line1）完成挂载（通常只需 100~300ms），
    // 避免因瞬间未挂载完成跌入逐字段超时的慢速分支！
    let group = null;
    const settleDeadline = Date.now() + 2500;
    while (Date.now() < settleDeadline) {
        group = await getAuthoritativeBillingGroup(page);
        if (group?.items?.some((item) => ['state', 'postal', 'line1'].includes(billingFieldKey(item)))) break;
        await page.waitForTimeout(80);
    }

    if (group?.items?.length) {
        const getItem = (key) => group.items.find((item) => billingFieldKey(item) === key);

        // 关键时序优化：改国家后立刻填写州（State）与邮编（Postal Code），立即触发 Stripe 后台计算销售税！
        // 在随后填入姓名、街道、城市这 1~2 秒的过程中，Stripe 正在并行算税；
        // 等全部字段填完进入提交步骤时，算税早已完成，无需在提交按钮处原地等待 6 秒。
        filled.state = await selectBillingState(page, normalizeStateFullName(address.state), address.state);
        const postalItem = getItem('postal');
        if (postalItem) filled.postal = await fillBillingTextItem(postalItem, address.postal_code, '邮编');

        const nameItem = getItem('name');
        if (nameItem) filled.name = await fillBillingTextItem(nameItem, fullName, '账单全名');

        await suppressGoogleAddressAutocomplete(page);
        const line1Item = getItem('line1');
        if (line1Item) filled.line1 = await fillBillingTextItem(line1Item, address.line1, '街道地址');
        await dismissAddressAutocomplete(page);

        const cityItem = getItem('city');
        if (cityItem) filled.city = await fillBillingTextItem(cityItem, address.city, '城市');

        await blurActiveBillingField(page);
        return filled;
    }

    filled.name = await fillBillingTextField(page, 'name', fullName, '账单全名');
    await suppressGoogleAddressAutocomplete(page);
    filled.line1 = await fillBillingTextField(page, 'line1', address.line1, '街道地址');
    await dismissAddressAutocomplete(page);
    filled.city = await fillBillingTextField(page, 'city', address.city, '城市');
    filled.state = await selectBillingState(page, normalizeStateFullName(address.state), address.state);
    filled.postal = await fillBillingTextField(page, 'postal', address.postal_code, '邮编');
    await blurActiveBillingField(page);
    return filled;
}

async function fillOpenAiBillingBySectionMeta(page, address, fullName) {
    const filled = { name: false, country: false, line1: false, city: false, postal: false, state: false };

    await focusOpenAiBillingSection(page);
    filled.country = await selectBillingCountry(page, billingCountryOptions(address.country));
    if (!filled.country) return filled;
    filled.name = await fillBillingTextField(page, 'name', fullName, '账单全名');

    // Keep the street-entry fallback in the same live billing frame. Country
    // selection or address completion can replace any of its sibling controls.
    const group = await getAuthoritativeBillingGroup(page);
    const line1Item = group && await findBillingLine1ItemAfterCountry(group.frame);
    if (line1Item?.el) {
        filled.line1 = await fillBillingLine1Element(line1Item.el, address.line1, 'section-meta');
    } else {
        filled.line1 = await fillBillingTextField(page, 'line1', address.line1, '街道地址');
    }
    await dismissAddressAutocomplete(page);
    filled.city = await fillBillingTextField(page, 'city', address.city, '城市');
    filled.state = await selectBillingState(page, normalizeStateFullName(address.state), address.state);
    filled.postal = await fillBillingTextField(page, 'postal', address.postal_code, '邮编');
    await blurActiveBillingField(page);
    return filled;
}

async function findBillingControl(page, labelPatterns, role = 'textbox') {
    const patterns = Array.isArray(labelPatterns) ? labelPatterns : [labelPatterns];

    for (const pat of patterns) {
        try {
            const byPlaceholder = page.getByPlaceholder(pat, { exact: false });
            const phCount = await byPlaceholder.count();
            for (let i = phCount - 1; i >= 0; i -= 1) {
                const el = byPlaceholder.nth(i);
                if (await el.isVisible({ timeout: 800 }).catch(() => false)) {
                    return el;
                }
            }
        } catch (_) { /* next */ }

        try {
            const byLabel = page.getByLabel(pat, { exact: false });
            const count = await byLabel.count();
            for (let i = count - 1; i >= 0; i -= 1) {
                const el = byLabel.nth(i);
                if (await el.isVisible({ timeout: 800 }).catch(() => false)) {
                    return el;
                }
            }
        } catch (_) { /* next */ }

        try {
            const byRole = page.getByRole(role, { name: pat });
            const count = await byRole.count();
            for (let i = count - 1; i >= 0; i -= 1) {
                const el = byRole.nth(i);
                if (await el.isVisible({ timeout: 800 }).catch(() => false)) {
                    return el;
                }
            }
        } catch (_) { /* next */ }

        try {
            const fieldBox = page.locator('div, fieldset, label').filter({ hasText: pat }).last();
            const nested = fieldBox.locator('input:visible, select:visible, [role="combobox"]:visible, textarea:visible').first();
            if (await nested.isVisible({ timeout: 800 }).catch(() => false)) {
                return nested;
            }
            const following = fieldBox.locator('xpath=following::input[not(@type="hidden")][1] | following::select[1]');
            if (await following.first().isVisible({ timeout: 800 }).catch(() => false)) {
                return following.first();
            }
        } catch (_) { /* next */ }
    }

    for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        for (const pat of patterns) {
            try {
                const el = frame.getByLabel(pat, { exact: false }).first();
                if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
                    return el;
                }
            } catch (_) { /* next */ }
        }
    }
    return null;
}

async function fillBillingControl(page, labelPatterns, value, logLabel) {
    if (value === undefined || value === null || String(value) === '') {
        return false;
    }

    const isLine1 = /街道|line\s*1|address line/i.test(logLabel);
    const fieldPatterns = isLine1
        ? [/address line 1/i, /^address line 1$/i, /street address/i, /^address$/i]
        : (Array.isArray(labelPatterns) ? labelPatterns : [labelPatterns]);

    console.log(`  [Stripe] 填写 ${logLabel}...`);
    const field = await findBillingControl(page, fieldPatterns, 'textbox');
    if (!field) {
        console.log(`  [Stripe] ⚠️ ${logLabel} 未找到`);
        return false;
    }
    try {
        const tag = await resolveElementTag(field);
        if (tag === 'select') {
            return selectBillingComboboxItem(page, { el: field }, [String(value)], logLabel);
        }

        const current = String(await field.inputValue({ timeout: 1000 }).catch(() => '')).trim();
        if (current && current.toLowerCase() === String(value).trim().toLowerCase()) {
            console.log(`  [Stripe] ⏭️ ${logLabel} 已有正确值 (${current.slice(0, 24)}...)，跳过`);
            return true;
        }
        if (current) {
            console.log(`  [Stripe] 🔄 ${logLabel} 现有值 (${current}) 与目标值 (${value}) 不一致，正在覆写...`);
            await field.fill('');
        }

        await safeScrollIntoView(field);
        await dismissAddressAutocomplete(page);
        if (isLine1) {
            await suppressGoogleAddressAutocomplete(page);
            const ok = await fillBillingLine1Element(field, value, 'fillBillingControl');
            if (ok) {
                await dismissAddressAutocomplete(page);
            }
            return ok;
        }
        await field.click({ timeout: 2000 }).catch(() => {});
        await field.fill(String(value));

        let val = String(await field.inputValue({ timeout: 1000 }).catch(() => '')).trim();
        if (!val) {
            // React 受控组件兜底分发事件
            await field.evaluate((input, text) => {
                const proto = window.HTMLInputElement.prototype;
                const desc = Object.getOwnPropertyDescriptor(proto, 'value');
                if (desc && desc.set) desc.set.call(input, text);
                else input.value = text;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }, String(value)).catch(() => {});
            val = String(await field.inputValue({ timeout: 1000 }).catch(() => '')).trim();
        }
        if (!val) {
            console.log(`  [Stripe] ⚠️ ${logLabel} 填写后仍为空`);
            return false;
        }
        console.log(`  [Stripe] ✅ ${logLabel}: ${value}`);
        return true;
    } catch (e) {
        console.log(`  [Stripe] ⚠️ ${logLabel} 填写失败: ${e.message}`);
        return false;
    }
}

async function selectBillingCountry(page, optionLabels, waitMs = 5000) {
    const target = billingCountryCode(optionLabels.find(Boolean));
    if (!target) return false;
    const deadline = Date.now() + waitMs;
    let attempted = false;
    let matchedSince = null;
    while (Date.now() < deadline) {
        const group = await getAuthoritativeBillingGroup(page);
        const item = group?.items.find((item) => billingFieldKey(item) === 'country');
        if (item) {
            const current = billingCountryCode(await readControlValue(item));
            if (current === target) {
                // A change can asynchronously replace/reset address fields. Re-find
                // the live group while it settles, then verify its selected country.
                if (!attempted) return true;
                matchedSince ??= Date.now();
                if (Date.now() - matchedSince >= Math.min(300, waitMs / 3)) {
                    console.log(`  [Stripe] 🌐 已确认账单国家: ${target}`);
                    return true;
                }
            } else {
                matchedSince = null;
                if (!attempted) {
                    console.log(`  [Stripe] 选择账单国家: ${target}...`);
                    const selected = await selectBillingComboboxItem(group.frame, item, optionLabels, '账单国家', Math.min(2000, deadline - Date.now()));
                    if (!selected) return false;
                    attempted = true;
                }
            }
        } else {
            matchedSince = null;
        }
        await page.waitForTimeout(100);
    }
    console.warn(`  [Stripe] ⚠️ 无法确认账单国家已切换为 ${target}`);
    return false;
}

async function selectBillingState(page, stateFullName, stateRaw, waitMs = 3000) {
    const code = stateCodeForValue(stateFullName || stateRaw) || 'OR';
    const full = US_STATE_LABELS[code] || stateFullName || 'Oregon';
    const options = [...new Set([
        full,
        code,
        `${full} (${code})`,
        `${code} - ${full}`,
        `${full} - ${code}`,
        stateFullName,
        stateRaw
    ].filter(Boolean))];
    if (!options.length) return false;

    // Fast-path: 优先检测原生 <select> 直选（Stripe 收银台大部分情况下渲染原生 select，避免等待 combobox 超时）
    const frames = typeof page.frames === 'function' ? page.frames() : [page];
    const selectSels = [
        'select[name*="administrative" i]',
        'select[name*="state" i]',
        'select[id*="administrative" i]',
        'select[id*="state" i]',
        'select[autocomplete*="address-level1" i]',
        '#billingAddress-administrativeAreaInput',
        'select:has(option[value="OR"])',
        'select:has(option:has-text("Oregon"))'
    ];
    for (const frame of frames) {
        if (frame.isDetached?.()) continue;
        for (const sel of selectSels) {
            try {
                const selectEl = frame.locator(sel).first();
                if ((await selectEl.count().catch(() => 0)) > 0) {
                    const targetOpt = await selectEl.evaluate((node, { codeVal, fullVal }) => {
                        if (!node.options) return null;
                        const match = Array.from(node.options).find(o =>
                            !o.disabled && (o.value === codeVal || o.value === fullVal || /oregon/i.test(o.textContent || ''))
                        );
                        return match ? { value: match.value, label: match.textContent || match.value } : null;
                    }, { codeVal: code, fullVal: full }).catch(() => null);

                    if (targetOpt) {
                        await selectEl.selectOption({ value: targetOpt.value }, { force: true, timeout: 1000 }).catch(() => []);
                        await selectEl.evaluate((node, val) => {
                            const proto = window.HTMLSelectElement.prototype;
                            const desc = Object.getOwnPropertyDescriptor(proto, 'value');
                            if (desc && desc.set) desc.set.call(node, val);
                            else node.value = val;
                            node.dispatchEvent(new Event('input', { bubbles: true }));
                            node.dispatchEvent(new Event('change', { bubbles: true }));
                        }, targetOpt.value).catch(() => {});
                        console.log(`  [Stripe] ✅ 州/省 (原生 select 直选): ${targetOpt.label || targetOpt.value}`);
                        return true;
                    }
                }
            } catch (_) {}
        }
    }

    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
        const group = await getAuthoritativeBillingGroup(page);
        const item = group?.items.find((item) => billingFieldKey(item) === 'state');
        if (item) {
            const current = await readControlValue(item);
            if (options.some((option) => stateValuesMatch(current, option))) return true;
            const selected = await selectBillingComboboxItem(group.frame, item, options, '州/省', Math.max(1, deadline - Date.now()));
            if (selected) {
                // Country/state changes can replace the billing group. Always read the
                // authoritative live group again before reporting success.
                const liveGroup = await getAuthoritativeBillingGroup(page);
                const liveItem = liveGroup?.items.find((item) => billingFieldKey(item) === 'state');
                const actual = await readControlValue(liveItem);
                if (options.some((option) => stateValuesMatch(actual, option))) return true;
            }
        }
        await page.waitForTimeout(100);
    }

    // Direct multi-layer fallbacks: native select & combobox/button
    // Only attempt if wait budget was not an ultra-short probe (<800ms)
    if (waitMs >= 800) {
        const frames = typeof page.frames === 'function' ? page.frames() : [page];
        for (const frame of frames) {
            if (frame.isDetached?.()) continue;

            // 1. Native <select> in frame: check if target option exists before calling selectOption
            const selectSels = [
                'select[name*="administrative" i]',
                'select[name*="state" i]',
                'select[id*="administrative" i]',
                'select[id*="state" i]',
                'select[autocomplete*="address-level1" i]',
                '#billingAddress-administrativeAreaInput',
                'select:has(option[value="OR"])',
                'select:has(option:has-text("Oregon"))'
            ];
            for (const sel of selectSels) {
                try {
                    const selectEl = frame.locator(sel).first();
                    if ((await selectEl.count().catch(() => 0)) > 0) {
                        const targetOpt = await selectEl.evaluate((node, { codeVal, fullVal }) => {
                            if (!node.options) return null;
                            const match = Array.from(node.options).find(o =>
                                !o.disabled && (o.value === codeVal || o.value === fullVal || /oregon/i.test(o.textContent || ''))
                            );
                            return match ? { value: match.value, label: match.textContent || match.value } : null;
                        }, { codeVal: code, fullVal: full }).catch(() => null);

                        if (targetOpt) {
                            const res = await selectEl.selectOption({ value: targetOpt.value }, { force: true, timeout: 1000 }).catch(() => []);
                            await selectEl.evaluate((node, val) => {
                                const proto = window.HTMLSelectElement.prototype;
                                const desc = Object.getOwnPropertyDescriptor(proto, 'value');
                                if (desc && desc.set) desc.set.call(node, val);
                                else node.value = val;
                                node.dispatchEvent(new Event('input', { bubbles: true }));
                                node.dispatchEvent(new Event('change', { bubbles: true }));
                            }, targetOpt.value).catch(() => {});
                            console.log(`  [Stripe] ✅ 州/省 (原生 select 直选): ${targetOpt.label || targetOpt.value}`);
                            return true;
                        }
                    }
                } catch (_) {}
            }

            // 2. Custom Combobox / Button click in frame
            const triggerLocators = [
                frame.getByRole('combobox', { name: /state|州/i }),
                frame.getByLabel(/^State$/i),
                frame.locator('button:visible, [role="combobox"]:visible').filter({ hasText: /^State(\s+Select)?$/i }),
                frame.locator('button:visible[aria-haspopup="listbox"], button:visible[aria-expanded]').filter({ hasText: /state|select/i }),
                frame.locator('div, fieldset').filter({ hasText: /^State$/i }).locator('button:visible, [role="combobox"]:visible').first(),
                frame.locator('div:has-text("ZIP code")').locator('xpath=preceding-sibling::div[1]//button | preceding-sibling::div[1]//[role="combobox"]').first()
            ];
            for (const loc of triggerLocators) {
                try {
                    if ((await loc.count().catch(() => 0)) > 0 && (await loc.isVisible().catch(() => false))) {
                        await loc.click({ timeout: 1500 }).catch(() => {});
                        await frame.waitForTimeout(300);
                        const optLoc = frame.locator('[role="option"]:visible, [role="listbox"] *:visible, [data-radix-popper-content-wrapper] *:visible, li:visible')
                            .filter({ hasText: /^(?:Oregon|OR)$/i })
                            .first();
                        if ((await optLoc.count().catch(() => 0)) > 0 && (await optLoc.isVisible().catch(() => false))) {
                            await optLoc.click({ timeout: 1500 });
                            console.log(`  [Stripe] ✅ 州/省 (下拉弹层选中): Oregon`);
                            return true;
                        }
                        await frame.keyboard.press('Escape').catch(() => {});
                    }
                } catch (_) {}
            }
        }

        // 3. Deep DOM evaluation across document
        try {
            const evaluated = await page.evaluate(({ codeVal, fullVal }) => {
                const selects = Array.from(document.querySelectorAll('select'));
                for (const select of selects) {
                    const targetOpt = Array.from(select.options || []).find(o =>
                        !o.disabled && (o.value === codeVal || o.value === fullVal || /oregon/i.test(o.textContent || ''))
                    );
                    if (targetOpt) {
                        const proto = window.HTMLSelectElement.prototype;
                        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
                        if (desc && desc.set) desc.set.call(select, targetOpt.value);
                        else select.value = targetOpt.value;
                        select.dispatchEvent(new Event('input', { bubbles: true }));
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                        return targetOpt.value;
                    }
                }
                return null;
            }, { codeVal: code, fullVal: full });
            if (evaluated) {
                console.log(`  [Stripe] ✅ 州/省 (底层 DOM 穿透): ${evaluated}`);
                return true;
            }
        } catch (_) {}
    }

    console.warn('  [Stripe] ⚠️ 账单州/省中未找到或无法选中目标选项');
    return false;
}

async function locateOpenAiBillingHeading(page, group = null) {
    const billingGroup = group || await getAuthoritativeBillingGroup(page);
    const frames = billingGroup ? [billingGroup.frame] : (typeof page.frames === 'function' ? page.frames() : [page]);
    for (const frame of frames) {
        if (frame.isDetached?.()) continue;
        const heading = frame.getByText(/^Billing address$|^账单地址$/i).first();
        if (!(await heading.isVisible().catch(() => false))) continue;
        await safeScrollIntoView(heading);
        return heading;
    }
    return null;
}

/** 按 Billing address 标题下方的 DOM 顺序兜底填写 */
async function fillBillingByDomOrder(page, fullName, address, stateFullName) {
    console.log('  [Stripe] 尝试按 DOM 顺序兜底填写...');
    const items = await getBillingInputsBelowHeading(page);
    const result = { name: false, country: false, line1: false, city: false, postal: false, state: false };
    if (items.length === 0) return result;

    const textQueue = [
        { key: 'name', value: fullName },
        { key: 'line1', value: address.line1 },
        { key: 'city', value: address.city },
        { key: 'postal', value: address.postal_code }
    ];
    let textIdx = 0;
    let countryDone = false;

    for (const item of items) {
        const tag = item.meta?.tag || '';
        const role = item.meta?.role || '';
        const isSelectLike = tag === 'select' || role === 'combobox';

        if (!countryDone && isSelectLike && !result.country) {
            const ok = await selectBillingComboboxItem(
                page,
                item,
                ['United States', '美国', 'US'],
                '国家'
            );
            if (ok) {
                result.country = true;
                countryDone = true;
                await page.waitForTimeout(900);
            }
            continue;
        }

        if (isSelectLike && !result.state) {
            const ok = await selectBillingComboboxItem(
                page,
                item,
                [stateFullName, address.state].filter(Boolean),
                '州'
            );
            if (ok) {
                result.state = true;
            }
            continue;
        }

        if (textIdx >= textQueue.length) continue;
        const current = textQueue[textIdx];
        const ok = await fillBillingTextItem(item, current.value, `[兜底] ${current.key}`);
        if (ok) {
            result[current.key] = true;
            textIdx += 1;
        }
    }

    return result;
}

async function hasBillingValidationError(page) {
    const patterns = [
        /your billing address is required/i,
        /please provide your full name/i,
        /this field is incomplete/i,
        /请提供.*全名/i,
        /此字段不完整/i,
        /您的账单地址/i
    ];
    for (const re of patterns) {
        try {
            const el = page.getByText(re).first();
            if (await el.isVisible({ timeout: 300 })) {
                return true;
            }
        } catch (_) { /* next */ }
    }
    return false;
}

/**
 * OpenAI custom checkout 账单区 — getByLabel / combobox 为主
 */
async function verifyBillingAfterTax(page, address, fullName, result) {
    const status = getBillingFieldStatus(await readBillingInputValues(page), {}, address?.country, address, fullName);
    const missing = listBillingMissing(status);
    if (missing.length) return { ...result, ok: false, error: `税费刷新后账单字段缺失或不一致: ${missing.join(', ')}` };
    return result;
}

async function assertOpenAiBillingReady(page, address, fullName) {
    const status = getBillingFieldStatus(await readBillingInputValues(page), {}, address?.country, address, fullName);
    const missing = listBillingMissing(status);
    if (!missing.length) return;
    const error = new Error(`提交前账单字段缺失或与目标地址不一致: ${missing.join(', ')} [BILLING_FORM_CHANGED]`);
    error.code = 'BILLING_FORM_CHANGED';
    throw error;
}

async function fillOpenAiCheckoutBilling(page, address, fullName, expectedCurrency = null) {
    const stateFullName = normalizeStateFullName(address.state);
    let filled = { name: false, country: false, line1: false, city: false, postal: false, state: false };

    console.log('  [Stripe] 开始填写账单地址（必填项）...');
    await suppressGoogleAddressAutocomplete(page);
    await dismissAddressAutocomplete(page);

    const preBillingDue = await readCheckoutDueAmount(page);
    if (expectedCurrency && (!preBillingDue?.amount || !preBillingDue.currency)) {
        const code = 'CHECKOUT_CURRENCY_UNCONFIRMED';
        return {
            ok: false,
            code,
            error: `账单填写前 Checkout 应付金额或币种无法确认 [${code}]`,
            filled,
        };
    }
    if (expectedCurrency && preBillingDue.currency !== String(expectedCurrency).trim().toUpperCase()) {
        const code = 'PAYMENT_CURRENCY_MISMATCH';
        return {
            ok: false,
            code,
            error: `账单填写前 Checkout 币种 ${preBillingDue.currency} 与卡密支付币种 ${expectedCurrency} 不一致 [${code}]`,
            filled,
        };
    }
    const baselineAmount = preBillingDue?.amount || null;
    const billingCurrency = preBillingDue?.currency || null;
    if (baselineAmount) {
        const taxFree = estimateTaxFreeAmount(baselineAmount, billingCurrency);
        console.log(
            `  [Stripe] 填地址前应付: ${billingCurrency || ''} ${baselineAmount}`
            + (taxFree && taxFree !== baselineAmount ? `（免税州目标约 ${taxFree.toFixed(2)}）` : '')
        );
    }

    if (await isOpenAiBillingFormComplete(page, {}, address, fullName)) {
        console.log('  [Stripe] ✅ 账单表单已完整，跳过重复填写');
        const taxCheck = await ensureCheckoutTaxFreeAmount(page, address, baselineAmount, billingCurrency, expectedCurrency);
        if (!taxCheck.ok) {
            return { ok: false, error: taxCheck.error, code: taxCheck.code, filled, skipped: true };
        }
        return verifyBillingAfterTax(page, address, fullName, {
            ok: true,
            filled,
            skipped: true,
            taxFreeGuard: taxCheck.taxFreeGuard || null,
            ...(await resolveBillingDueResult(page, taxCheck)),
        });
    }

    try {
        const heading = await locateOpenAiBillingHeading(page);
        console.log(heading
            ? '  [Stripe] ✅ 已定位账单地址区块'
            : '  [Stripe] 账单标题不可见，使用实际账单字段定位');
    } catch (e) {
        console.warn(`  [Stripe] ⚠️ 账单标题不可见: ${e.message}`);
    }

    await focusOpenAiBillingSection(page);
    filled = await fillOpenAiBillingDirect(page, address, fullName);
    filled = await syncFilledFlags(page, filled);
    await dismissAddressAutocomplete(page);
    if (!getBillingFieldStatus(await readBillingInputValues(page), filled, address.country || 'US').country) {
        return billingCountryFailure(page, address, filled);
    }

    if (await isOpenAiBillingFormComplete(page, filled, address, fullName)) {
        console.log('  [Stripe] ✅ 账单地址校验通过（直连填写）');
        const taxCheck = await ensureCheckoutTaxFreeAmount(page, address, baselineAmount, billingCurrency, expectedCurrency);
        if (!taxCheck.ok) {
            return { ok: false, error: taxCheck.error, code: taxCheck.code, filled };
        }
        return verifyBillingAfterTax(page, address, fullName, {
            ok: true,
            filled,
            taxFreeGuard: taxCheck.taxFreeGuard || null,
            ...(await resolveBillingDueResult(page, taxCheck)),
        });
    }

    let status = getBillingFieldStatus(await readBillingInputValues(page), filled, address?.country, address, fullName);
    let missing = listBillingMissing(status);

    if (missing.length > 0) {
        console.log(`  [Stripe] 仍需补填: ${missing.join(', ')}`);

        if (!status.name) {
            filled.name = await fillBillingTextField(page, 'name', fullName, '账单全名');
        }
        if (!status.country) {
            filled.country = await selectBillingCountry(page, billingCountryOptions(address.country));
            if (!filled.country) return billingCountryFailure(page, address, filled);
            status = getBillingFieldStatus(await readBillingInputValues(page), filled, address.country || 'US', address, fullName);
            // Country changes may also reset a previously correct full name.
            if (!status.name) filled.name = await fillBillingTextField(page, 'name', fullName, '账单全名');
        }
        if (!status.line1) {
            filled.line1 = await fillBillingTextField(page, 'line1', address.line1, '街道地址');
        }
        if (!filled.line1 && !status.line1) {
            console.log('  [Stripe] 街道地址仍失败，尝试 section-meta 兜底...');
            const sectionFilled = await fillOpenAiBillingBySectionMeta(page, address, fullName);
            filled.line1 = filled.line1 || sectionFilled.line1;
            filled = await syncFilledFlags(page, filled);
        }
        if (!status.city) {
            filled.city = await fillBillingTextField(page, 'city', address.city, '城市');
        }
        if (!status.postal) {
            filled.postal = await fillBillingTextField(page, 'postal', address.postal_code, '邮编');
        }
        if (!status.state) {
            filled.state = await selectBillingState(page, stateFullName, address.state);
        }
        filled = await syncFilledFlags(page, filled);
        await dismissAddressAutocomplete(page);
    }

    status = getBillingFieldStatus(await readBillingInputValues(page), filled, address?.country, address, fullName);
    missing = listBillingMissing(status);

    if (missing.length > 0) {
        console.warn(`  [Stripe] ⚠️ 账单字段未全部填写: ${missing.join(', ')}`);
        return {
            ok: false,
            error: `账单字段缺失或与目标地址不一致: ${missing.join(', ')}`,
            filled
        };
    }

    console.log('  [Stripe] ✅ 账单地址校验通过');

    const taxCheck = await ensureCheckoutTaxFreeAmount(page, address, baselineAmount, billingCurrency, expectedCurrency);
    if (!taxCheck.ok) {
        return { ok: false, error: taxCheck.error, code: taxCheck.code, filled };
    }
    return verifyBillingAfterTax(page, address, fullName, {
        ok: true,
        filled,
        taxFreeGuard: taxCheck.taxFreeGuard || null,
        ...(await resolveBillingDueResult(page, taxCheck)),
    });
}

const BILLING_FULL_NAME_SELECTORS = [
    '#billingAddress-nameInput',
    'input[name="billingName"]',
    'input[autocomplete="billing name"]'
];

async function readControlValue(item) {
    if (!item?.el) return '';
    return String(await item.el.evaluate((node) => {
        if (node.tagName === 'SELECT') {
            if (!node.value) return '';
            return node.options?.[node.selectedIndex]?.textContent || node.value;
        }
        if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') return node.value;
        const ariaValue = node.getAttribute('aria-valuetext');
        if (ariaValue) return ariaValue;
        // Combobox textContent can contain every hidden option, including phone
        // countries. Read only the visible display outside the dropdown list.
        const texts = [];
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
            const parent = walker.currentNode.parentElement;
            if (!parent || parent.closest('select,option,[role="listbox"],[role="option"],[aria-hidden="true"]')) continue;
            const label = parent.closest('label');
            if (label && node.contains(label)) continue;
            if (!parent.getClientRects().length || getComputedStyle(parent).visibility === 'hidden') continue;
            texts.push(walker.currentNode.textContent);
        }
        return texts.join(' ').replace(/\s+/g, ' ').trim()
            .replace(/^(?:country(?: or region)?|国家或地区|国家|地区|state|province|州|省份)\s*[:：]?\s+/i, '');
    }).catch(() => '')).trim();
}

function billingFieldKey(item) {
    const hay = item.hay;
    if (/^(?:section-\S+\s+)?(?:billing\s+)?name$/i.test(item.meta?.autocomplete || '')
        || /^name$/i.test(item.meta?.name || '')
        || /full.?name|billing.?name|billingAddress-name|billing name|姓名/i.test(hay)
        || /^name$/i.test(item.meta?.labelText || item.meta?.ariaLabel || '')) return 'name';
    if (/address.?line.?1|line1|street|街道/i.test(hay) && !/line.?2/i.test(hay)) return 'line1';
    if (/locality|address-level2|\bcity\b|城市/i.test(hay)) return 'city';
    if (/postal|zip|邮政|邮编/i.test(hay)) return 'postal';
    if (/country|region|国家|地区/i.test(hay)) return 'country';
    if (/address-level1|administrative|\bstate\b|province|省份|州/i.test(hay)) return 'state';
    return null;
}

async function getAuthoritativeBillingGroup(page) {
    const frames = typeof page.frames === 'function' ? page.frames() : [page];
    let fallback = null;
    for (const frame of frames) {
        if (frame.isDetached?.()) continue;
        const items = await getBillingInputsBelowHeading(frame, { includeHiddenSelects: true });
        if (items.some((item) => billingFieldKey(item) === 'line1')) return { frame, items };
        if (!fallback && items.some((item) => ['country', 'postal', 'state'].includes(billingFieldKey(item)))) {
            fallback = { frame, items };
        }
    }
    return fallback;
}

async function readBillingInputValues(page) {
    const result = { name: '', line1: '', city: '', postal: '', state: '', country: '', present: [] };
    // One rendered billing group is authoritative. Empty values are evidence too;
    // never substitute fields from Link, shipping or a different iframe.
    const group = await getAuthoritativeBillingGroup(page);
    for (const item of group?.items || []) {
        const key = billingFieldKey(item);
        if (!key || result.present.includes(key)) continue;
        result.present.push(key);
        result[key] = await readControlValue(item);
    }
    // If state wasn't recognized by item metadata but exists in the billing group frame
    if (!result.state && group?.frame) {
        const fallbackState = await group.frame.evaluate(() => {
            const selects = Array.from(document.querySelectorAll('select'));
            for (const select of selects) {
                if (/state|administrative/i.test(`${select.name} ${select.id} ${select.getAttribute('autocomplete') || ''}`)
                    || Array.from(select.options).some(o => o.value === 'OR')) {
                    if (select.value) {
                        return select.options?.[select.selectedIndex]?.textContent || select.value;
                    }
                }
            }
            const btn = document.querySelector('button[aria-haspopup="listbox"], [role="combobox"]');
            if (btn) {
                const text = (btn.textContent || '').replace(/\s+/g, ' ').trim();
                const m = text.match(/\b(Oregon|OR)\b/i);
                if (m) return m[1];
            }
            return '';
        }).catch(() => '');
        if (fallbackState) {
            result.state = fallbackState;
            if (!result.present.includes('state')) result.present.push('state');
        }
    }
    return result;
}

function normalizeBillingValue(value) {
    return String(value || '').normalize('NFKC').toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
}

function billingCountryCode(value) {
    const normalized = normalizeBillingValue(value);
    for (const [code, pattern] of Object.entries({
        US: /^(?:us|usa|united states(?: of america)?|美国)$/,
        PH: /^(?:ph|philippines|pilipinas|菲律宾)$/,
        SG: /^(?:sg|singapore|新加坡)$/,
        MY: /^(?:my|malaysia|马来西亚)$/
    })) {
        if (pattern.test(normalized)) return code;
    }
    return normalized.toUpperCase();
}

function getBillingFieldStatus(actual, filled = {}, targetCountry = null, targetAddress = null, fullName = null) {
    const country = billingCountryCode(actual.country);
    const expected = billingCountryCode(targetCountry || targetAddress?.country);
    const isSg = country === 'SG';
    const matches = (key, expectedValue) => Boolean(String(actual[key] || '').trim())
        && (!expectedValue || normalizeBillingValue(actual[key]) === normalizeBillingValue(expectedValue));
    const optionalAbsent = (key) => isSg && !(actual.present || Object.keys(actual).filter((k) => actual[k])).includes(key);
    const stateMatches = country === 'US'
        ? stateValuesMatch(actual.state, targetAddress?.state)
        : Boolean(String(actual.state || '').trim())
            && (!targetAddress?.state
                || normalizeBillingValue(actual.state) === normalizeBillingValue(targetAddress.state));
    return {
        name: matches('name', fullName),
        line1: matches('line1', targetAddress?.line1),
        city: optionalAbsent('city') || matches('city', targetAddress?.city),
        postal: matches('postal', targetAddress?.postal_code),
        state: optionalAbsent('state') || stateMatches,
        country: Boolean(country) && (!expected || country === expected),
        actual
    };
}

function listBillingMissing(status) {
    return ['name', 'line1', 'city', 'postal', 'state', 'country'].filter((key) => !status[key]);
}

async function syncFilledFlags(page, filled) {
    const actual = await readBillingInputValues(page);
    for (const key of ['name', 'line1', 'city', 'postal', 'state', 'country']) filled[key] = Boolean(actual[key]);
    return filled;
}

async function isOpenAiBillingFormComplete(page, filled = {}, targetAddress = null, fullName = null) {
    const values = await readBillingInputValues(page);
    return listBillingMissing(getBillingFieldStatus(values, filled, targetAddress?.country, targetAddress, fullName)).length === 0;
}

async function billingFullNameHasValue(page) {
    const values = await readBillingInputValues(page);
    if (values.name) return true;
    for (const sel of BILLING_FULL_NAME_SELECTORS) {
        try {
            const el = page.locator(sel).first();
            if ((await el.count()) === 0) continue;
            const val = await el.inputValue({ timeout: 1000 }).catch(() => '');
            if (val && val.trim()) return true;
        } catch (_) { /* next */ }
    }
    return false;
}

async function billingLine1HasValue(page, expectedValue = '') {
    const values = await readBillingInputValues(page);
    if (values.line1) {
        if (expectedValue) {
            return values.line1.toLowerCase() === String(expectedValue).trim().toLowerCase();
        }
        return true;
    }
    try {
        const input = await locateBillingLine1Input(page);
        if (!input) return false;
        const val = String(await input.inputValue({ timeout: 800 }).catch(() => '')).trim();
        if (expectedValue) {
            return val.toLowerCase() === String(expectedValue).trim().toLowerCase();
        }
        return Boolean(val);
    } catch (_) {
        return false;
    }
}

async function fillBillingLine1Element(el, value, via = '') {
    if (!el || value === undefined || value === null || String(value) === '') return false;
    try {
        await safeScrollIntoView(el);
        await el.click({ timeout: 2000 }).catch(() => {});
        await el.fill('');
        await el.fill(String(value));
        let val = String(await el.inputValue({ timeout: 1000 }).catch(() => '')).trim();
        if (!val) {
            await el.click({ timeout: 2000 }).catch(() => { });
            await el.pressSequentially(String(value), { delay: 35 });
            val = String(await el.inputValue({ timeout: 1000 }).catch(() => '')).trim();
        }
        if (!val) {
            await el.evaluate((node, text) => {
                node.value = text;
                node.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
                node.dispatchEvent(new Event('change', { bubbles: true }));
            }, String(value));
            val = String(await el.inputValue({ timeout: 1000 }).catch(() => '')).trim();
        }
        if (val) {
            console.log(`  [Stripe] ✅ 街道地址: ${value}${via ? ` (${via})` : ''}`);
            return true;
        }
        console.log(`  [Stripe] ⚠️ 街道地址填写后仍为空 (${via || 'unknown'})`);
    } catch (error) {
        console.log(`  [Stripe] ⚠️ 街道地址填写失败 (${via || 'unknown'}): ${error.message}`);
    }
    return false;
}

async function locateBillingLine1Input(page) {
    const labelPatterns = [/^Address line 1$/i, /^地址行\s*1$/i, /^街道地址$/i];
    for (const pat of labelPatterns) {
        try {
            const byLabel = page.getByLabel(pat).first();
            if (await byLabel.isVisible({ timeout: 600 }).catch(() => false)) {
                return byLabel;
            }
        } catch (_) { /* next */ }

        try {
            const label = page.getByText(pat, { exact: true }).first();
            if (!(await label.isVisible({ timeout: 600 }).catch(() => false))) continue;
            const inParent = label.locator('xpath=ancestor::*[self::div or self::fieldset or self::label][1]//input[not(@type="hidden")]').first();
            if (await inParent.isVisible({ timeout: 600 }).catch(() => false)) {
                return inParent;
            }
            const following = label.locator('xpath=following::input[not(@type="hidden")][1]');
            if (await following.isVisible({ timeout: 600 }).catch(() => false)) {
                return following;
            }
        } catch (_) { /* next */ }

        try {
            const container = page.locator('div, fieldset, section, label').filter({
                has: page.getByText(pat, { exact: true })
            }).last();
            const input = container.locator('input:not([type="hidden"])').first();
            if (await input.isVisible({ timeout: 600 }).catch(() => false)) {
                return input;
            }
        } catch (_) { /* next */ }
    }

    const directSels = [
        '#billingAddress-addressLine1Input',
        '#billingAddressLine1',
        'input[name="addressLine1"]',
        'input[name="billingAddressLine1"]',
        'input[autocomplete="billing address-line1"]',
        'input[autocomplete="address-line1"]',
        'input.pac-target-input'
    ];
    for (const sel of directSels) {
        try {
            const input = page.locator(sel).first();
            if (await input.isVisible({ timeout: 400 }).catch(() => false)) {
                return input;
            }
        } catch (_) { /* next */ }
    }

    const item = await findBillingLine1ItemAfterCountry(page);
    return item?.el || null;
}

async function findBillingLine1ItemAfterCountry(page) {
    const items = await getBillingInputsBelowHeading(page);
    if (!items.length) return null;

    const labeled = items.find((item) => {
        const hay = `${item.hay} ${item.meta?.labelText || ''}`.toLowerCase();
        return /address line 1|address-line1|billing address-line|line1|street address/.test(hay)
            && !/line\s*2|optional/.test(hay);
    });
    if (labeled) return labeled;

    const countryIndex = items.findIndex((item) => {
        const hay = `${item.hay} ${item.meta?.labelText || ''}`.toLowerCase();
        return /country|region|国家|地区/.test(hay)
            || (item.meta?.tag === 'select' && /country/.test(item.meta?.name || ''));
    });

    const start = countryIndex >= 0 ? countryIndex + 1 : 0;
    for (let i = start; i < items.length; i += 1) {
        const item = items[i];
        const tag = String(item.meta?.tag || '').toLowerCase();
        if (tag !== 'input' && tag !== 'textarea') continue;
        const hay = `${item.hay} ${item.meta?.labelText || ''}`.toLowerCase();
        if (/line\s*2|optional|city|locality|postal|zip|state|province|name|country|region|email|phone|card/.test(hay)) {
            continue;
        }
        return item;
    }
    return null;
}

async function fillBillingLine1InFrame(frame, value) {
    const labelPatterns = [/^Address line 1$/i, /^地址行\s*1$/i];
    for (const pat of labelPatterns) {
        for (const getter of ['getByLabel', 'getByPlaceholder']) {
            try {
                const loc = frame[getter](pat);
                const count = await loc.count();
                for (let i = 0; i < count; i += 1) {
                    const el = loc.nth(i);
                    if (!(await el.isVisible({ timeout: 400 }).catch(() => false))) continue;
                    if (await fillBillingLine1Element(el, value, getter)) return true;
                }
            } catch (_) { /* next */ }
        }
    }

    try {
        const heading = frame.getByText(/^\s*Billing address\s*$|^\s*账单地址\s*$/i).first();
        if ((await heading.count()) > 0) {
            const headBox = await heading.boundingBox().catch(() => null);
            const minY = headBox ? headBox.y - 4 : 0;
            const inputs = frame.locator('input[type="text"], input:not([type]), input[type="search"]');
            const total = await inputs.count();
            let seenCountry = false;
            for (let i = 0; i < total; i += 1) {
                const el = inputs.nth(i);
                if (!(await el.isVisible({ timeout: 250 }).catch(() => false))) continue;
                const box = await el.boundingBox().catch(() => null);
                if (box && box.y < minY) continue;
                const meta = await el.evaluate((node) => ({
                    tag: node.tagName.toLowerCase(),
                    name: node.getAttribute('name') || '',
                    ac: node.getAttribute('autocomplete') || '',
                    ph: node.getAttribute('placeholder') || '',
                    val: node.value || ''
                })).catch(() => null);
                if (!meta) continue;
                const hay = `${meta.name} ${meta.ac} ${meta.ph}`.toLowerCase();
                if (meta.tag === 'select' || /country|region/.test(hay)) {
                    seenCountry = true;
                    continue;
                }
                if (!seenCountry) continue;
                if (/line\s*2|optional|city|locality|postal|zip|state|province|name|email|phone|card/.test(hay)) continue;
                if (String(meta.val).trim()) continue;
                if (await fillBillingLine1Element(el, value, 'frame-after-country')) return true;
            }
        }
    } catch (_) { /* next */ }

    return false;
}

async function fillBillingLine1Strict(page, value) {
    if (!value) return false;
    if (await billingLine1HasValue(page, value)) {
        console.log('  [Stripe] ⏭️ Address line 1 已有正确值，跳过');
        return true;
    }

    await suppressGoogleAddressAutocomplete(page);
    await dismissAddressAutocomplete(page);

    const directSels = [
        'input[autocomplete="billing address-line1"]',
        'input[autocomplete="address-line1"]',
        'input[name="addressLine1"]',
        'input[name="billingAddressLine1"]',
        '#billingAddress-addressLine1Input',
        '#billingAddressLine1',
        'input.pac-target-input',
        'input[placeholder*="Address line 1" i]'
    ];
    if (await fillFirstVisibleSelector(page, directSels, value, '街道地址', 3000)) {
        await dismissAddressAutocomplete(page);
        return true;
    }

    try {
        const located = await locateBillingLine1Input(page);
        if (located) {
            await dismissAddressAutocomplete(page);
            if (await fillBillingLine1Element(located, value, 'label-locate')) {
                await dismissAddressAutocomplete(page);
                return true;
            }
        }
    } catch (error) {
        console.log(`  [Stripe] ⚠️ 街道地址 label 定位失败: ${error.message}`);
    }

    try {
        const line1Item = await findBillingLine1ItemAfterCountry(page);
        if (line1Item?.el) {
            await dismissAddressAutocomplete(page);
            if (await fillBillingLine1Element(line1Item.el, value, 'after-country')) {
                await dismissAddressAutocomplete(page);
                return true;
            }
        } else {
            const items = await getBillingInputsBelowHeading(page);
            console.log(`  [Stripe] 街道地址 DOM 扫描: ${items.length} 个控件`);
        }
    } catch (error) {
        console.log(`  [Stripe] ⚠️ 街道地址 DOM 填写失败: ${error.message}`);
    }

    if (await fillBillingLine1InFrame(page, value)) {
        await dismissAddressAutocomplete(page);
        return true;
    }
    for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        try {
            if (await fillBillingLine1InFrame(frame, value)) {
                await dismissAddressAutocomplete(page);
                return true;
            }
        } catch (_) { /* next frame */ }
    }

    const byPlaceholder = page.getByPlaceholder(/address line 1/i).first();
    if (await byPlaceholder.isVisible({ timeout: 1000 }).catch(() => false)) {
        if (await fillBillingLine1Element(byPlaceholder, value, 'placeholder')) {
            await dismissAddressAutocomplete(page);
            return true;
        }
    }

    const ok = await fillBillingControl(page, [/address line 1/i], value, '街道地址');
    if (ok) {
        await dismissAddressAutocomplete(page);
    }
    return ok;
}

/**
 * 自动填充收银台中的 Email 输入框（如 Stripe Link / 客户邮箱输入框）
 */
async function fillCheckoutEmail(page, email) {
    if (!email || !String(email).trim()) {
        return false;
    }
    const targetEmail = String(email).trim();

    const emailSelector = 'input[type="email"], #email, input[name="email" i], input[autocomplete*="email" i], input[id*="email" i], input[placeholder*="email" i], input[aria-label*="email" i], input[placeholder*="邮箱" i], input[aria-label*="邮箱" i]';

    const contexts = [page, ...page.frames().filter(f => f !== page.mainFrame())];
    for (const ctx of contexts) {
        try {
            // 先通过毫秒级 DOM 查询快速探测该 frame 是否存在可见 email 输入框，避免 Playwright locator 逐个等待超时的累积延迟
            const hasVisibleEmail = await ctx.evaluate((sel) => {
                const el = document.querySelector(sel);
                if (!el) return false;
                const style = window.getComputedStyle(el);
                return style && style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0;
            }, emailSelector).catch(() => false);

            if (!hasVisibleEmail) continue;

            const loc = ctx.locator(emailSelector).first();
            const currentVal = (await loc.inputValue({ timeout: 400 }).catch(() => '')).trim();
            if (currentVal && currentVal.includes('@')) {
                console.log(`[Stripe] ✅ Email 输入框已有值: ${currentVal}`);
                return true;
            }
            await safeScrollIntoView(loc);
            await loc.click({ timeout: 1000 }).catch(() => {});
            await loc.fill('');
            await loc.fill(targetEmail);
            let val = (await loc.inputValue({ timeout: 400 }).catch(() => '')).trim();
            if (!val) {
                await loc.pressSequentially(targetEmail, { delay: 20 }).catch(() => {});
                val = (await loc.inputValue({ timeout: 400 }).catch(() => '')).trim();
            }
            await loc.blur().catch(() => {});
            console.log(`[Stripe] ✅ 收银台 Email 已填写: ${val || targetEmail}`);
            return true;
        } catch (_) { /* next frame */ }
    }
    return false;
}

/**
 * 检查表单前端校验错误
 */
async function checkFormValidationErrors(page) {
    try {
        const pageFormErr = await page.evaluate(() => {
            const invalidInputs = document.querySelectorAll('input:invalid, [aria-invalid="true"]');
            let isEmailMissing = false;
            let errMsg = '';
            for (const inp of invalidInputs) {
                const type = (inp.getAttribute('type') || '').toLowerCase();
                const name = (inp.getAttribute('name') || '').toLowerCase();
                const id = (inp.getAttribute('id') || '').toLowerCase();
                const placeholder = (inp.getAttribute('placeholder') || '').toLowerCase();
                if (type === 'email' || name.includes('email') || id.includes('email') || placeholder.includes('email')) {
                    isEmailMissing = true;
                    errMsg = 'Email 字段必填且未填写或格式无效';
                    break;
                }
                errMsg = `字段校验未通过: ${name || id || placeholder || type}`;
            }
            if (errMsg) {
                return { hasError: true, message: errMsg, isEmailMissing };
            }

            const errorEls = document.querySelectorAll('.p-FieldError, .FieldError, [role="alert"]');
            for (const el of errorEls) {
                if (el.offsetHeight > 0) {
                    const txt = (el.textContent || '').trim();
                    if (txt) {
                        const emailRelated = /email|邮箱/i.test(txt);
                        return { hasError: true, message: txt, isEmailMissing: emailRelated };
                    }
                }
            }

            const emailInp = document.querySelector('input[type="email"], input[name="email" i], #email');
            if (emailInp && emailInp.offsetHeight > 0 && !(emailInp.value || '').trim()) {
                return { hasError: true, message: '收银台 Email 输入框为空', isEmailMissing: true };
            }

            return { hasError: false };
        });

        if (pageFormErr && pageFormErr.hasError) {
            return pageFormErr;
        }

        const inlineCardErr = await checkStripeCardInlineError(page);
        if (inlineCardErr && inlineCardErr.hasError) {
            return { hasError: true, message: inlineCardErr.message, isCardError: true };
        }

        return { hasError: false };
    } catch (_) {
        return { hasError: false };
    }
}

async function clickCheckoutSubmitButton(page, accountEmail = '', onBeforeSubmit = null) {
    await dismissAddressAutocomplete(page);
    if (isClaudeCustomCheckout(page)) {
        const button = page.getByRole('button', { name: /^Subscribe$|^订阅$|^开始订阅$|^Upgrade to (Pro|Max)\b|^升级[至到]\s*(Pro|Max)/i }).first();
        // Let Playwright wait for visible/enabled/stable, then revalidate immediately
        // before the one real click. A dispatched click never falls back to another.
        await button.click({ trial: true, timeout: 10000 });
        if (onBeforeSubmit) await onBeforeSubmit();
        await button.click({ timeout: 8000 });
        console.log('[Stripe] ✅ 已单次点击 Claude 提交按钮');
        return true;
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.evaluate(() => {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
    });
    await page.waitForTimeout(400);

    const maxDisabledWaitMs = Number(process.env.CHECKOUT_SUBMIT_DISABLED_WAIT_MS || 25000);
    const tryClick = async (locator, label) => {
        let actionStarted = false;
        try {
            const target = locator.first ? locator.first() : locator;
            if (!(await target.isVisible({ timeout: 2000 }).catch(() => false))) {
                return false;
            }

            let isTargetDisabled = await target.isDisabled().catch(() => false);
            if (!isTargetDisabled) {
                const ariaDisabled = await target.getAttribute('aria-disabled').catch(() => null);
                const hasSpinner = await target.locator('.Spinner, svg, [role="progressbar"], [data-testid*="spinner"]').isVisible().catch(() => false);
                if (ariaDisabled === 'true' || hasSpinner) {
                    isTargetDisabled = true;
                }
            }

            if (isTargetDisabled) {
                console.log(`[Stripe] ⏳ 提交按钮处于后台加载/算税中，等待就绪 (${label})...`);
                const disabledStart = Date.now();
                while (Date.now() - disabledStart < maxDisabledWaitMs) {
                    await page.waitForTimeout(150);

                    const disabled = await target.isDisabled().catch(() => false);
                    const ariaDisabled = await target.getAttribute('aria-disabled').catch(() => null);
                    const hasSpinner = await target.locator('.Spinner, svg, [role="progressbar"], [data-testid*="spinner"]').isVisible().catch(() => false);

                    if (!disabled && ariaDisabled !== 'true' && !hasSpinner) {
                        isTargetDisabled = false;
                        const waitedSec = ((Date.now() - disabledStart) / 1000).toFixed(1);
                        console.log(`[Stripe] ✅ 提交按钮后台就绪 (等待了 ${waitedSec} 秒)`);
                        break;
                    }
                }
            }

            if (isTargetDisabled) {
                console.log(`[Stripe] ⚠️ 提交按钮在等待超时后仍不可用 (${label})`);
                return false;
            }

            await safeScrollIntoView(target);
            await page.waitForTimeout(randomBetween(150, 350));
            // Validate after scroll/button waits, immediately before each submit action.
            actionStarted = true;
            if (onBeforeSubmit) await onBeforeSubmit();
            await target.click({ timeout: 8000, delay: randomBetween(40, 120) });
            console.log(`[Stripe] ✅ 已点击提交按钮 (${label})`);

            // 点击后等待 800ms 检查是否有表单校验阻止了提交
            await page.waitForTimeout(800);
            const formValidation = await checkFormValidationErrors(page);
            if (formValidation.hasError) {
                console.warn(`[Stripe] ⚠️ 提交后检测到表单校验拦截: ${formValidation.message}`);
                if (formValidation.isEmailMissing && accountEmail) {
                    console.log(`[Stripe] 正在自动补填 Email (${accountEmail}) 并重试提交...`);
                    await fillCheckoutEmail(page, accountEmail);
                    await page.waitForTimeout(500);
                    if (onBeforeSubmit) await onBeforeSubmit();
                    await target.click({ timeout: 5000, delay: 60 });
                    console.log(`[Stripe] ✅ 补填 Email 后已再次点击提交按钮`);
                }
            }
            return true;
        } catch (error) {
            // A dispatched click may already have charged; never try another button.
            if (actionStarted) throw error;
            console.log(`[Stripe] 提交按钮点击失败 (${label}): ${error.message}`);
            return false;
        }
    };

    const strategies = [
        () => tryClick(page.getByRole('button', { name: /^Upgrade to (Pro|Plus)$/i }), 'role=Upgrade to Pro/Plus'),
        () => tryClick(page.locator('button').filter({ hasText: /^Upgrade to (Pro|Plus)$/i }), 'button Upgrade to Pro/Plus'),
        () => tryClick(page.getByRole('button', { name: /^升级至\s*(Pro|Plus)|升级到\s*(Pro|Plus)|开始订阅$/i }), 'role=中文升级/订阅'),
        () => tryClick(page.locator('button').filter({ hasText: /^升级至\s*(Pro|Plus)|升级到\s*(Pro|Plus)|开始订阅$/i }), 'button 中文升级/订阅'),
        () => tryClick(page.getByRole('button', { name: /^Subscribe$/i }), 'role=Subscribe'),
        () => tryClick(page.getByRole('button', { name: /^订阅$/ }), 'role=订阅'),
        () => tryClick(page.getByRole('button', { name: /upgrade to (pro|plus)|upgrade|subscribe|订阅|pay|升级/i }), 'role=subscribe/upgrade'),
        () => tryClick(page.locator('button').filter({ hasText: /^Upgrade/i }), 'button Upgrade'),
        () => tryClick(page.locator('button').filter({ hasText: /^Subscribe$/i }), 'button Subscribe'),
        () => tryClick(page.locator('button').filter({ hasText: /^订阅$/ }), 'button 订阅'),
        () => tryClick(page.locator('[role="button"]').filter({ hasText: /upgrade to (pro|plus)|subscribe|升级|订阅/i }), 'role=button Upgrade/Subscribe'),
        () => tryClick(page.locator('button[type="submit"]'), 'type=submit'),
        () => tryClick(page.locator('.SubmitButton'), 'SubmitButton'),
        () => tryClick(
            page.locator('div').filter({ hasText: /Due today/i }).first()
                .locator('xpath=ancestor::div[1]')
                .getByRole('button', { name: /upgrade|subscribe|订阅|升级/i }),
            'summary Subscribe'
        ),
        () => tryClick(page.getByText(/^Upgrade to (Pro|Plus)$/i), 'text Upgrade to Pro/Plus'),
        () => tryClick(page.getByText(/^Subscribe$/i), 'text Subscribe'),
        () => tryClick(page.getByText(/^订阅$/), 'text 订阅')
    ];

    for (const strategy of strategies) {
        if (await strategy()) {
            return true;
        }
    }
    return false;
}

async function fillBillingNameElement(el, fullName, via) {
    try {
        await safeScrollIntoView(el);
        await el.click({ timeout: 2000 }).catch(() => {});
        await el.fill('');
        await el.fill(String(fullName));
        let val = await el.inputValue({ timeout: 1000 }).catch(() => '');
        if (!val || !val.trim()) {
            // 某些 React 受控输入忽略 fill，改用真实键入
            await el.click({ timeout: 2000 }).catch(() => { });
            await el.pressSequentially(String(fullName), { delay: 40 }).catch(() => { });
            val = await el.inputValue({ timeout: 1000 }).catch(() => '');
        }
        if (val && val.trim()) {
            console.log(`  [Stripe] ✅ 账单全名: ${fullName}${via ? ` (${via})` : ''}`);
            return true;
        }
    } catch (_) { /* next */ }
    return false;
}

// 在单个 frame 内，定位 "Billing address" 标题下方的第一个空文本输入框（即 Full name）
async function fillBillingNameInFrame(frame, fullName) {
    // 1) 锚定 placeholder/label，排除 "Full name (optional)"
    const exact = [/^\s*Full name\s*$/i, /^\s*全名\s*$/i];
    for (const pat of exact) {
        for (const getter of ['getByPlaceholder', 'getByLabel']) {
            try {
                const loc = frame[getter](pat);
                const c = await loc.count();
                for (let i = c - 1; i >= 0; i -= 1) {
                    const el = loc.nth(i);
                    if (!(await el.isVisible({ timeout: 400 }).catch(() => false))) continue;
                    if (await fillBillingNameElement(el, fullName, getter)) return true;
                }
            } catch (_) { /* next */ }
        }
    }

    // 2) 定位 Billing address 标题，取其后方按位置排序的第一个空文本输入框
    try {
        const heading = frame.getByText(/^\s*Billing address\s*$|^\s*账单地址\s*$/i).first();
        if ((await heading.count()) > 0) {
            const headBox = await heading.boundingBox().catch(() => null);
            const minY = headBox ? headBox.y - 4 : 0;
            const inputs = frame.locator('input[type="text"], input:not([type]), input[type="search"]');
            const total = await inputs.count();
            const candidates = [];
            for (let i = 0; i < total; i += 1) {
                const el = inputs.nth(i);
                if (!(await el.isVisible({ timeout: 300 }).catch(() => false))) continue;
                const box = await el.boundingBox().catch(() => null);
                if (!box || box.y < minY) continue;
                const meta = await el.evaluate((n) => ({
                    ph: (n.getAttribute('placeholder') || '').toLowerCase(),
                    aria: (n.getAttribute('aria-label') || '').toLowerCase(),
                    name: (n.getAttribute('name') || '').toLowerCase(),
                    ac: (n.getAttribute('autocomplete') || '').toLowerCase(),
                    val: n.value || ''
                })).catch(() => null);
                if (!meta) continue;
                const hay = `${meta.ph} ${meta.aria} ${meta.name} ${meta.ac}`;
                if (/optional|email|phone|mobile|card|cvc|cc-|expir|security|line\s*2|address-line2|postal|zip|city|locality|state|province|country|region/.test(hay)) continue;
                candidates.push({ el, y: box.y, x: box.x, empty: !String(meta.val).trim(), hay });
            }
            candidates.sort((a, b) => a.y - b.y || a.x - b.x);
            console.log(`  [Stripe] Full name 候选输入框: ${candidates.length} 个`);
            // 优先选「明确含 full name/name 且非 optional」的，其次选第一个空文本框
            const named = candidates.find((c) => /full name|full_name|^name$|\bname\b/.test(c.hay));
            if (named && await fillBillingNameElement(named.el, fullName, 'heading-named')) return true;
            const firstEmpty = candidates.find((c) => c.empty);
            if (firstEmpty && await fillBillingNameElement(firstEmpty.el, fullName, 'heading-first-empty')) return true;
            if (candidates[0] && await fillBillingNameElement(candidates[0].el, fullName, 'heading-first')) return true;
        }
    } catch (_) { /* next */ }

    return false;
}

// 仅针对 Billing address 区块的必填 Full name，避免误填上方的 "Full name (optional)"
async function fillBillingFullNameStrict(page, fullName) {
    if (!fullName) return false;

    // 1) billing 专属选择器（若该页面使用了对应 id/name）
    if (await fillFirstVisibleSelector(page, BILLING_FULL_NAME_SELECTORS, fullName, '账单全名', 2000)) {
        return true;
    }

    // 2) 主页面 + 所有子 frame 内查找
    if (await fillBillingNameInFrame(page, fullName)) return true;
    for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        try {
            if (await fillBillingNameInFrame(frame, fullName)) return true;
        } catch (_) { /* next frame */ }
    }

    console.log('  [Stripe] ⚠️ 全 frame 扫描仍未找到账单 Full name 输入框');
    return false;
}

/**
 * 填写账单地址字段
 * @param {import('playwright').Page} page
 * @param {object} address - { line1, city, state, postal_code, country }
 */
async function fillBillingAddress(page, address) {
    // Address line 1
    const line1Selectors = [
        '#billingAddressLine1',
        'input[name="billingAddressLine1"]',
        'input[name="addressLine1"]',
        'input[name="line1"]',
        'input[autocomplete="address-line1"]',
        'input[placeholder*="Address" i]',
        'input[placeholder*="Street" i]',
        '[data-testid="billingAddressLine1"]'
    ];
    await fillField(page, line1Selectors, address.line1, '街道地址');

    // City
    const citySelectors = [
        '#billingLocality',
        'input[name="billingLocality"]',
        'input[name="billingAddressCity"]',
        'input[name="city"]',
        'input[name="locality"]',
        'input[autocomplete="address-level2"]',
        'input[placeholder*="City" i]',
        '[data-testid="billingLocality"]'
    ];
    await fillField(page, citySelectors, address.city, '城市');

    // State / Province
    const stateSelectors = [
        '#billingAdministrativeArea',
        'input[name="billingAdministrativeArea"]',
        'input[name="billingAddressState"]',
        'input[name="state"]',
        'input[name="administrativeArea"]',
        'input[autocomplete="address-level1"]',
        'select[name="billingAdministrativeArea"]',
        'select[name="state"]',
        'input[placeholder*="State" i]',
        'input[placeholder*="Province" i]',
        '[data-testid="billingAdministrativeArea"]'
    ];
    await fillFieldOrSelect(page, stateSelectors, address.state, '州/省');

    // Postal code
    const postalSelectors = [
        '#billingPostalCode',
        'input[name="billingPostalCode"]',
        'input[name="billingAddressZip"]',
        'input[name="postal_code"]',
        'input[name="postalCode"]',
        'input[name="zip"]',
        'input[autocomplete="postal-code"]',
        'input[placeholder*="ZIP" i]',
        'input[placeholder*="Postal" i]',
        '[data-testid="billingPostalCode"]'
    ];
    await fillField(page, postalSelectors, address.postal_code, '邮编');

    // Country (usually a dropdown/select)
    const countrySelectors = [
        '#billingCountry',
        'select[name="billingCountry"]',
        'select[name="billingAddressCountry"]',
        'select[name="country"]',
        'select[autocomplete="country"]',
        '[data-testid="billingCountry"]'
    ];
    await selectCountry(page, countrySelectors, address.country);
}

/**
 * 填写普通文本输入字段
 * @param {import('playwright').Page} page
 * @param {string[]} selectors
 * @param {string} value
 * @param {string} fieldName
 */
async function fillField(page, selectors, value, fieldName) {
    if (!value) return;

    for (const sel of selectors) {
        try {
            const el = page.locator(sel).first();
            if ((await el.count().catch(() => 0)) === 0) continue;
            if (await el.isVisible({ timeout: 500 })) {
                await el.fill(''); // clear existing
                await humanType(page, sel, value);
                console.log(`  [Stripe] ✅ ${fieldName}: ${value}`);
                return;
            }
        } catch (_) { /* try next */ }
    }
    console.warn(`  [Stripe] ⚠️ 未找到${fieldName}字段`);
}

/**
 * 填写字段（支持 input 和 select）
 * @param {import('playwright').Page} page
 * @param {string[]} selectors
 * @param {string} value
 * @param {string} fieldName
 */
async function fillFieldOrSelect(page, selectors, value, fieldName) {
    if (!value) return;

    for (const sel of selectors) {
        try {
            const el = page.locator(sel).first();
            if ((await el.count().catch(() => 0)) === 0) continue;
            if (await el.isVisible({ timeout: 500 })) {
                const tagName = await el.evaluate(node => node.tagName.toLowerCase()).catch(() => '');
                if (tagName === 'select') {
                    await el.selectOption({ label: value }).catch(() =>
                        el.selectOption({ value: value })
                    );
                } else {
                    await el.fill('').catch(() => {});
                    await humanType(page, sel, value);
                }
                console.log(`  [Stripe] ✅ ${fieldName}: ${value}`);
                return;
            }
        } catch (_) { /* try next */ }
    }
    console.warn(`  [Stripe] ⚠️ 未找到${fieldName}字段`);
}

/**
 * 选择国家下拉框
 * @param {import('playwright').Page} page
 * @param {string[]} selectors
 * @param {string} countryCode - ISO 3166-1 alpha-2
 */
async function selectCountry(page, selectors, countryCode) {
    if (!countryCode) return;

    for (const sel of selectors) {
        try {
            const el = page.locator(sel).first();
            if ((await el.count().catch(() => 0)) === 0) continue;
            if (await el.isVisible({ timeout: 500 })) {
                // Try selecting by value (country code) first, then by label
                try {
                    await el.selectOption({ value: countryCode });
                } catch (_) {
                    try {
                        await el.selectOption(countryCode);
                    } catch (__) {
                        // Some Stripe forms use custom dropdowns, try clicking and searching
                        await el.click();
                        await page.waitForTimeout(500);
                        // Look for option with country code
                        const option = page.locator(`option[value="${countryCode}"]`).first();
                        if (await option.isVisible({ timeout: 1000 })) {
                            await option.click();
                        }
                    }
                }
                console.log(`  [Stripe] ✅ 国家: ${countryCode}`);
                return;
            }
        } catch (_) { /* try next */ }
    }
    console.warn(`  [Stripe] ⚠️ 未找到国家选择框`);
}

// ==================== Exports ====================

module.exports = {
    completeStripeCardPayment,
    humanType,
    generateRandomName,
    getTypingDelay,
    normalizeCardExpiry,
    normalizeCardNumber,
    readBillingInputValues,
    getBillingFieldStatus,
    listBillingMissing,
    syncFilledFlags,
    isOpenAiBillingFormComplete,
    assertOpenAiBillingReady,
    verifyBillingAfterTax,
    clickCheckoutSubmitButton,
    // Internal helpers exported for testing
    humanTypeInFrame,
    saveDebugScreenshot,
    waitForStripeFrame,
    waitForBillingFields,
    fillBillingAddress,
    fillOpenAiCheckoutBilling,
    getCurrentBillingCountryValue,
    selectBillingCountry,
    selectBillingState,
    discoverCardInputs,
    fillCardFieldsOpenAiCheckout,
    prepareCheckoutCardSection,
    readCheckoutDueAmount,
    waitForCheckoutDueAmount,
    assertCheckoutDueCurrency,
    estimateTaxFreeAmount,
    waitForCheckoutTaxRecalculation,
    ensureCheckoutTaxFreeAmount,
    captureCheckoutDueAmount,
    isTaxFreeDueAmount,
    assertClaudeCardFieldsReady,
    fillCheckoutEmail,
    isCheckoutTaxZero,
    isPhTaxFreeNet,
    KNOWN_PH_NET_PRICES
};
