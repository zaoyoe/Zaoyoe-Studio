/**
 * 人机验证统一处理：Cloudflare Turnstile / hCaptcha / Stripe challenge
 */

const { solveHcaptchaOnPage, isHcaptchaSolverEnabled } = require('./hcaptcha-solver');
const {
    isCaptchaPlatformEnabled,
    extractHcaptchaParamsFromPage,
    solveHcaptchaViaPlatform,
    injectHcaptchaTokenOnPage,
    clickCheckoutContinueAfterCaptcha
} = require('./captcha-platform');
const { isLoginPageContent, isHardLoginRedirectUrl, isCheckoutPageUrl, hasVisibleLoginChrome, isCheckoutLoginGate, buildSessionNotLoggedInError } = require('./auth-page-detect');
const axios = require('axios');
const { inspectCaptchaContent, waitForCaptchaContentReady } = require('./captcha-content');

const BLOCKING_TEXT_PATTERNS = [
    /one more step before you'?re done/i,
    /select the checkbox below/i,
    /verify you are human/i,
    /are you a human/i,
    /i am human/i,
    /cf-turnstile/i,
    /cloudflare security check/i,
    /protected by hcaptcha/i,
    /performing security verification/i,
    /just a moment/i,
    /checking your browser/i,
    /完成验证/i,
    /人机验证/i,
    /请勾选/i
];

/** @deprecated 仅保留兼容；请用 isBlockingHumanVerificationVisible */
const CAPTCHA_CHALLENGE_PATTERNS = BLOCKING_TEXT_PATTERNS;

function captchaLog(phase, message, level = 'info') {
    const tag = level === 'warn' ? 'WARN' : level === 'error' ? 'ERROR' : 'INFO';
    const line = `[Captcha/${phase}][${tag}] ${message}`;
    console.log(`CAPTCHA_LOG: ${line}`);
}

function randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isCheckoutOrUpgradeUrl(url) {
    return /checkout|upgrade|subscribe|billing/i.test(String(url || ''));
}

const CAPTCHA_FAILURE_TEXT_PATTERNS = [
    /安全验证未完成/i,
    /安全检查未通过/i,
    /人机验证未通过/i,
    /人机验证未完成/i,
    /您的购买未成功/i,
    /购买未成功.*您可以重试/i,
    /无法完成结账/i,
    /请检查您的信息后重试/i,
    /无法验证.*浏览器/i,
    /未能验证.*浏览器/i,
    /我们无法验证您的浏览器/i,
    /unable to verify (your )?browser/i,
    /failed to verify (your )?browser/i,
    /could not verify (your )?browser/i,
    /联系支持团队/i,
    /contact (our )?support team/i,
    /unable to complete checkout/i,
    /your card was declined/i,
    /verification (was )?(not completed|failed|incomplete)/i,
    /unable to verify/i,
    /failed human verification/i
];

async function hasVerificationFailureText(page) {
    try {
        const bodyText = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
        return CAPTCHA_FAILURE_TEXT_PATTERNS.some((re) => re.test(bodyText));
    } catch (_) {
        return false;
    }
}

function isInvisibleStripeHcaptchaUrl(url) {
    const u = String(url || '').toLowerCase();
    if (!u) {
        return false;
    }
    // 如果包含 challenge 或是可见 checkbox，绝非隐形帧
    if (u.includes('frame=challenge') || (u.includes('frame=checkbox') && !u.includes('invisible'))) {
        return false;
    }
    if (u.includes('hcaptcha-invisible') || u.includes('hcaptchainvisible') || u.includes('frame=checkbox-invisible')) {
        return true;
    }
    if (u.includes('stripecdn.com') && u.includes('hcaptcha')) {
        return true;
    }
    if (u.includes('js.stripe.com') && u.includes('hcaptcha')) {
        return true;
    }
    if (u.includes('#debugmod')) {
        return true;
    }
    return false;
}

function isBlockingCaptchaFrameUrl(url) {
    const u = String(url || '').toLowerCase();
    if (isInvisibleStripeHcaptchaUrl(url)) {
        return false;
    }
    if (u.includes('/static/') || u.includes('/assets/')) {
        return false;
    }
    if (u.includes('frame=challenge')) {
        return true;
    }
    if (u.includes('frame=checkbox') && !u.includes('invisible')) {
        return true;
    }
    return u.includes('challenges.cloudflare')
        || u.includes('turnstile')
        || u.includes('cdn-cgi/challenge-platform');
}

function isCaptchaFrameUrl(url) {
    return isBlockingCaptchaFrameUrl(url) || isInvisibleStripeHcaptchaUrl(url);
}

function isHcaptchaCheckboxFrameUrl(url) {
    const u = String(url || '').toLowerCase();
    if (isInvisibleStripeHcaptchaUrl(u) || u.includes('frame=challenge')) {
        return false;
    }
    return u.includes('frame=checkbox')
        || u.includes('frame=anchor')
        || u.includes('hcaptcha.html')
        || u.includes('hcaptchainvisible.html');
}

function isHcaptchaChallengeFrameUrl(url) {
    const u = String(url || '').toLowerCase();
    if (isInvisibleStripeHcaptchaUrl(u) || u.includes('frame=checkbox') || u.includes('frame=anchor')) {
        return false;
    }
    return u.includes('frame=challenge');
}

async function hasHcaptchaImageChallenge(page) {
    for (const frame of page.frames()) {
        if (isHcaptchaChallengeFrameUrl(frame.url() || '')) {
            return true;
        }
    }
    for (const frame of page.frames()) {
        const url = String(frame.url() || '').toLowerCase();
        if (isInvisibleStripeHcaptchaUrl(url)) {
            continue;
        }
        if (!/hcaptcha|newassets/i.test(url)) {
            continue;
        }
        try {
            const looksLikeChallenge = await frame.evaluate(() => {
                const body = String(document.body?.innerText || '').toLowerCase();
                if (/click the|please click|please select|drag the|different from|matching shape|choose all|identify/i.test(body)) {
                    return true;
                }
                if (document.querySelector('.challenge-container, .task-grid')) {
                    return true;
                }
                return false;
            });
            if (looksLikeChallenge) {
                return true;
            }
        } catch (_) { /* cross-origin frame */ }
    }
    try {
        const mainHasChallenge = await page.evaluate(() => {
            const body = String(document.body?.innerText || '').toLowerCase();
            return /click the .+ (different|arrow|select)/i.test(body)
                || /please click|please select|drag the matching|that are different/i.test(body);
        });
        if (mainHasChallenge) {
            return true;
        }
    } catch (_) { /* ignore */ }
    return false;
}

async function hasHcaptchaSolverTarget(page) {
    return await hasHcaptchaImageChallenge(page);
}

async function waitForPassiveCheckboxClear(page, phase, verifyOpts, timeoutMs = 45000) {
    captchaLog(phase, `仅 checkbox 验证，等待被动通过（最长 ${Math.round(timeoutMs / 1000)}s）...`);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        await clickHcaptchaCheckboxFrames(page, `${phase}-passive`);
        if (await isVerificationCleared(page, verifyOpts)) {
            captchaLog(phase, 'checkbox 被动验证已通过');
            return true;
        }
        await page.waitForTimeout(1200);
    }
    return false;
}

async function logCaptchaFrameSnapshot(page, phase) {
    const urls = page.frames()
        .map((frame) => frame.url() || '')
        .filter((url) => isBlockingCaptchaFrameUrl(url));
    const invisible = page.frames()
        .map((frame) => frame.url() || '')
        .filter((url) => isInvisibleStripeHcaptchaUrl(url));
    if (invisible.length > 0) {
        captchaLog(phase, `Stripe 隐形 hCaptcha 帧 ${invisible.length} 个（已忽略，非可见验证）`);
    }
    if (urls.length > 0) {
        captchaLog(phase, `可见拦截 frames: ${urls.map((url) => url.slice(0, 90)).join(' | ')}`);
    }
}

async function clickHcaptchaCheckboxFrames(page, phase = 'hcaptcha-checkbox') {
    let clicked = false;
    const selectors = ['#checkbox', '#anchor', '[id="checkbox"]', '[role="checkbox"]', 'div[aria-checked]', '.checkbox', '[aria-label*="human" i]', '[aria-label*="checkbox" i]'];

    // 0. 优先检测主页面是否有 Checkout 的「One more step」复选框弹层，直接对其内部 iframe 执行精准点击
    try {
        const modal = page.locator('div:has-text("One more step"), div:has-text("Select the checkbox below")').first();
        if (await modal.isVisible({ timeout: 500 }).catch(() => false)) {
            const modalIframe = modal.locator('iframe').first();
            if (await modalIframe.isVisible({ timeout: 500 }).catch(() => false)) {
                if (await humanClickLocator(page, modalIframe, 'checkbox-left')) {
                    captchaLog(phase, '已点击 Checkout hCaptcha 弹层中的 checkbox iframe');
                    clicked = true;
                }
            }
        }
    } catch (_) {}

    // 1. 遍历 frame 寻找真实的 checkbox 元素并点击
    for (const frame of page.frames()) {
        const url = frame.url() || '';
        if (isHcaptchaChallengeFrameUrl(url) || isInvisibleStripeHcaptchaUrl(url)) {
            continue;
        }
        for (const sel of selectors) {
            try {
                const loc = frame.locator(sel).first();
                if (!(await loc.isVisible({ timeout: 400 }).catch(() => false))) {
                    continue;
                }
                const box = await loc.boundingBox({ timeout: 1000 }).catch(() => null);
                if (box && box.width > 5 && box.height > 5) {
                    await humanClickBoundingBox(page, box, 'center');
                }
                await loc.click({ timeout: 2000, delay: randomBetween(40, 120) }).catch(() => {});
                captchaLog(phase, `已点击 hCaptcha checkbox frame (${url.slice(0, 70)}...) [sel=${sel}]`);
                clicked = true;
                break;
            } catch (_) { /* next selector */ }
        }
        if (clicked) break;
    }

    if (!clicked) {
        const iframes = await collectCaptchaIframeLocators(page);
        for (const iframe of iframes) {
            const src = await iframe.getAttribute('src').catch(() => '') || '';
            if (isHcaptchaChallengeFrameUrl(src) || isInvisibleStripeHcaptchaUrl(src)) {
                continue;
            }
            if (await humanClickLocator(page, iframe, 'checkbox-left')) {
                captchaLog(phase, `已点击 hCaptcha iframe bbox (${src.slice(0, 70)}...)`);
                clicked = true;
                break;
            }
        }
    }
    return clicked;
}

async function waitForHcaptchaSolverTarget(page, phase, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await hasHcaptchaSolverTarget(page)) {
            return true;
        }
        await clickHcaptchaCheckboxFrames(page, `${phase}-warmup`);
        await page.waitForTimeout(900);
    }
    return false;
}

const CHECKOUT_CAPTCHA_TEXT_RE = /one more step|select the checkbox below|i am human|are you a human/i;

/** 从 body / 可见节点判断 Checkout hCaptcha 弹层 */
async function hasCheckoutCaptchaOverlayText(page) {
    if (!isCheckoutOrUpgradeUrl(page.url() || '')) {
        return false;
    }
    try {
        return await page.evaluate(() => {
            const normalize = (s) => String(s || '').replace(/\s+/g, ' ').trim();
            const captchaRe = /one more step|select the checkbox below|i am human|are you a human/i;
            const body = normalize(document.body?.innerText);
            if (captchaRe.test(body)) {
                return true;
            }
            const nodes = document.querySelectorAll('div, p, span, h1, h2, h3, [role="dialog"], section, article');
            for (const el of nodes) {
                if (!(el instanceof HTMLElement)) continue;
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
                    continue;
                }
                const rect = el.getBoundingClientRect();
                if (rect.width < 8 || rect.height < 8) continue;
                const text = normalize(el.innerText);
                if (!text || text.length > 320) continue;
                if (captchaRe.test(text)) {
                    return true;
                }
            }
            const iframes = document.querySelectorAll('iframe');
            for (const iframe of iframes) {
                const src = String(iframe.getAttribute('src') || '').toLowerCase();
                const title = String(iframe.getAttribute('title') || '').toLowerCase();
                if (!src.includes('hcaptcha') && !title.includes('hcaptcha')) continue;
                if (src.includes('hcaptcha-invisible') || src.includes('hcaptchainvisible')) continue;
                // 忽略非 challenge/checkbox 的静态资产预加载 iframe
                if ((src.includes('newassets') || src.includes('hcaptcha')) && !src.includes('frame=challenge') && !src.includes('frame=checkbox')) continue;
                const style = window.getComputedStyle(iframe);
                if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
                const rect = iframe.getBoundingClientRect();
                if (rect.width > 40 && rect.height > 20) {
                    return true;
                }
            }
            return false;
        });
    } catch (_) {
        return false;
    }
}

async function hasVisiblePostSubmitHcaptchaWidget(page) {
    if (!isCheckoutOrUpgradeUrl(page.url() || '')) {
        return false;
    }
    try {
        const iframes = page.locator('iframe');
        const count = await iframes.count().catch(() => 0);
        for (let i = 0; i < count; i += 1) {
            const iframe = iframes.nth(i);
            const src = String(await iframe.getAttribute('src').catch(() => '') || '').toLowerCase();
            const title = String(await iframe.getAttribute('title').catch(() => '') || '').toLowerCase();
            if (isInvisibleStripeHcaptchaUrl(src)) continue;
            // 必须明确含有 checkbox 或 challenge 标记
            const isHcaptcha = (src.includes('frame=checkbox') || src.includes('frame=challenge'))
                || (title.includes('hcaptcha') && (src.includes('frame=checkbox') || src.includes('frame=challenge')));
            if (!isHcaptcha) continue;
            if (!(await iframe.isVisible({ timeout: 250 }).catch(() => false))) continue;
            const box = await iframe.boundingBox().catch(() => null);
            if (box && box.width > 36 && box.height > 18) {
                return true;
            }
        }
    } catch (_) { /* ignore */ }

    for (const frame of page.frames()) {
        if (frame.isDetached()) continue;
        const url = String(frame.url() || '').toLowerCase();
        if (isInvisibleStripeHcaptchaUrl(url)) continue;
        if (/hcaptcha\.com.*frame=(checkbox|challenge)/i.test(url)) {
            try {
                const frameEl = await frame.frameElement().catch(() => null);
                if (frameEl && await frameEl.isVisible({ timeout: 150 }).catch(() => false)) {
                    return true;
                }
            } catch (_) {}
        }
    }
    return false;
}

async function hasAnyCheckoutCaptchaSignal(page) {
    if (!isCheckoutOrUpgradeUrl(page.url() || '')) {
        return false;
    }
    if (await hasVerificationFailureText(page)) {
        return true;
    }
    if (await hasCheckoutCaptchaOverlayText(page)) {
        return true;
    }
    if (await hasVisiblePostSubmitHcaptchaWidget(page)) {
        return true;
    }
    for (const re of [/one more step/i, /select the checkbox/i, /i am human/i]) {
        try {
            if (await page.getByText(re).first().isVisible({ timeout: 300 })) {
                return true;
            }
        } catch (_) { /* next */ }
    }
    return false;
}

async function waitForCheckoutOverlayCaptcha(page, timeoutMs = 45000) {
    const deadline = Date.now() + timeoutMs;
    let lastLog = 0;
    while (Date.now() < deadline) {
        if (await hasAnyCheckoutCaptchaSignal(page)) {
            return true;
        }
        const now = Date.now();
        if (now - lastLog >= 5000) {
            captchaLog('overlay-wait', `仍在等待 hCaptcha 弹层… (${Math.round((now - (deadline - timeoutMs)) / 1000)}s)`);
            lastLog = now;
        }
        await page.waitForTimeout(500);
    }
    return false;
}

/** Checkout 上「One more step」hCaptcha 弹层 */
async function isCheckoutOverlayCaptchaVisible(page) {
    if (!(await hasAnyCheckoutCaptchaSignal(page))) {
        return false;
    }
    return true;
}

async function isBlockingHumanVerificationVisible(page) {
    if (await hasVerificationFailureText(page)) {
        return true;
    }
    if (await isCheckoutOverlayCaptchaVisible(page)) {
        return true;
    }

    const textPatterns = [
        /one more step/i,
        /select the checkbox below/i,
        /i am human/i,
        /are you a human/i,
        /verify you are human/i,
        /performing security verification/i,
        /just a moment/i,
        /checking your browser/i
    ];
    for (const re of textPatterns) {
        try {
            if (await page.getByText(re).first().isVisible({ timeout: 400 })) {
                return true;
            }
        } catch (_) { /* next */ }
    }

    const bodyText = String(await page.textContent('body', { timeout: 3000 }).catch(() => '') || '');
    if (/one more step|select the checkbox below|i am human/i.test(bodyText)) {
        return true;
    }
    if (BLOCKING_TEXT_PATTERNS.some((re) => re.test(bodyText))) {
        return true;
    }

    const captchaSelectors = [
        'iframe[src*="hcaptcha.com"][src*="frame=checkbox"]',
        'iframe[src*="hcaptcha.com"][src*="frame=challenge"]',
        'div:has-text("One more step") iframe',
        'div:has-text("I am human") iframe',
        'iframe[src*="challenges.cloudflare"]',
        'iframe[src*="turnstile"]',
        'iframe[title*="Cloudflare" i]',
        '.cf-turnstile',
        '#challenge-running',
        '#challenge-stage',
        'div:has-text("Verify you are human") iframe'
    ];
    for (const sel of captchaSelectors) {
        try {
            if (await page.locator(sel).first().isVisible({ timeout: 400 })) {
                return true;
            }
        } catch (_) { /* next */ }
    }

    for (const frame of page.frames()) {
        if (frame.isDetached()) continue;
        if (isBlockingCaptchaFrameUrl(frame.url())) {
            try {
                const el = await frame.frameElement().catch(() => null);
                if (el && await el.isVisible({ timeout: 150 }).catch(() => false)) {
                    const box = await el.boundingBox().catch(() => null);
                    if (box && box.width > 36 && box.height > 18) {
                        return true;
                    }
                }
            } catch (_) {}
        }
    }

    // 支付表单在弹层背后仍可见 — 不能据此判定「无验证」
    if (isCheckoutOrUpgradeUrl(page.url() || '')) {
        return false;
    }

    if (await isCheckoutPaymentReady(page)) {
        return false;
    }

    if (/configure your plan|card number|due today|subscribe now|billing address|设置您的套餐|账单信息|今日应付/i.test(bodyText)) {
        return false;
    }
    return false;
}

async function isHumanVerificationVisible(page) {
    return isBlockingHumanVerificationVisible(page);
}

/** Cloudflare 全页拦截（OpenAI logo + Verify you are human） */
async function isCloudflareWallPage(page) {
    try {
        const info = await page.evaluate(() => {
            const text = (document.body?.innerText || '').replace(/\s+/g, ' ');
            const lower = text.toLowerCase();
            const hasVerify = lower.includes('verify you are human')
                || lower.includes('i am human')
                || lower.includes('select the checkbox');
            const hasCfBrand = lower.includes('cloudflare');
            const hasCheckoutUi = /card number|configure your plan|subscribe|billing address|支付|订阅/i.test(text);
            const hasChallengeEl = Boolean(
                document.querySelector(
                    'iframe[src*="challenges.cloudflare"], iframe[src*="turnstile"], .cf-turnstile, #challenge-running, #challenge-stage, [id*="turnstile"]'
                )
            );
            return { hasVerify, hasCfBrand, hasCheckoutUi, hasChallengeEl, textSample: text.slice(0, 280) };
        });
        if (info.hasChallengeEl) {
            return true;
        }
        if (info.hasVerify && !info.hasCheckoutUi) {
            return true;
        }
        if (info.hasVerify && info.hasCfBrand) {
            return true;
        }
    } catch (_) { /* ignore */ }
    return false;
}

/** Checkout 支付表单是否已真正加载（不仅是 URL 对了） */
async function hasVisibleStripeCardInputs(page) {
    const iframeCount = await page.locator('iframe').count().catch(() => 0);
    for (let i = 0; i < iframeCount; i += 1) {
        const src = await page.locator('iframe').nth(i).getAttribute('src').catch(() => '') || '';
        if (isInvisibleStripeHcaptchaUrl(src)) {
            continue;
        }
        const fl = page.frameLocator('iframe').nth(i);
        try {
            const input = fl.locator('input:not([type="hidden"])').first();
            if (await input.isVisible({ timeout: 500 })) {
                return true;
            }
        } catch (_) { /* next iframe */ }
    }
    return false;
}

async function isCheckoutPaymentReady(page) {
    if (await hasVisibleStripeCardInputs(page)) {
        return true;
    }

    const probes = [
        () => page.getByText(/^(Card number|卡号)$/i).first().isVisible({ timeout: 250 }),
        () => page.getByText(/Configure your plan|Due today|今日应付|付款方式|支付详细信息|付款详情|账单信息/i).first().isVisible({ timeout: 250 }),
        () => page.getByText(/Plus plan|Pro plan|Monthly subscription|Pro 套餐|按月计费/i).first().isVisible({ timeout: 250 }),
        () => page.getByRole('button', { name: /subscribe|订阅|pay|升级/i }).first().isVisible({ timeout: 250 }),
        () => page.locator('input[autocomplete="cc-number"]').first().isVisible({ timeout: 250 })
    ];
    for (const probe of probes) {
        if (await probe().catch(() => false)) {
            return true;
        }
    }

    for (const frame of page.frames()) {
        if (isInvisibleStripeHcaptchaUrl(frame.url())) {
            continue;
        }
        if (!/js\.stripe\.com|stripe\.com|elements-inner/i.test(frame.url())) {
            continue;
        }
        try {
            const input = frame.locator('input[autocomplete="cc-number"], input[name="cardnumber"], input[name="number"]').first();
            if (await input.isVisible({ timeout: 250 })) {
                return true;
            }
        } catch (_) { /* next frame */ }
    }
    return false;
}

async function waitForCheckoutPaymentReady(page, timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await isCheckoutLoginGate(page) || await hasVisibleLoginChrome(page)) {
            return 'login_required';
        }
        const url = page.url() || '';
        if (isHardLoginRedirectUrl(url) && !isCheckoutPageUrl(url)) {
            return 'login_redirect';
        }
        if (await isCheckoutPaymentReady(page)) {
            return true;
        }
        await page.waitForTimeout(300);
    }
    if (await isCheckoutLoginGate(page) || await hasVisibleLoginChrome(page)) {
        return 'login_required';
    }
    return false;
}

async function isVerificationCleared(page, options = {}) {
    const pageUrl = page.url() || '';
    if (/redirect_status=succeeded/i.test(pageUrl) || /checkout\/verify/i.test(pageUrl)) {
        return true;
    }

    // 严禁误判：若页面明确显示安全验证未完成/购买未成功，绝不能判定为通过
    if (await hasVerificationFailureText(page)) {
        return false;
    }

    const requireCheckoutReady = options.requireCheckoutReady
        ?? isCheckoutOrUpgradeUrl(pageUrl);

    if (await hasAnyCheckoutCaptchaSignal(page)) {
        return false;
    }
    if (await isCheckoutOverlayCaptchaVisible(page)) {
        return false;
    }

    if (requireCheckoutReady && await isCheckoutPaymentReady(page)) {
        return true;
    }

    if (await isBlockingHumanVerificationVisible(page)) {
        return false;
    }
    if (await isCloudflareWallPage(page)) {
        return false;
    }
    if (requireCheckoutReady) {
        return await isCheckoutPaymentReady(page);
    }
    return true;
}

async function isPageBlocked(page, options = {}) {
    return !(await isVerificationCleared(page, options));
}

async function humanPause(page, minMs = 80, maxMs = 220) {
    await page.waitForTimeout(randomBetween(minMs, maxMs));
}

async function humanMouseMove(page, targetX, targetY) {
    const startX = targetX + randomBetween(-100, 100);
    const startY = targetY + randomBetween(-70, 70);
    const steps = randomBetween(14, 24);
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const ease = 1 - Math.pow(1 - t, 3);
        const x = startX + (targetX - startX) * ease + randomBetween(-2, 2);
        const y = startY + (targetY - startY) * ease + randomBetween(-2, 2);
        await page.mouse.move(x, y);
        await page.waitForTimeout(randomBetween(6, 22));
    }
}

async function humanClickAt(page, x, y) {
    const jitterX = x + randomBetween(-4, 4);
    const jitterY = y + randomBetween(-4, 4);
    await humanMouseMove(page, jitterX, jitterY);
    await humanPause(page, 50, 160);
    await page.mouse.down();
    await humanPause(page, 35, 110);
    await page.mouse.up();
}

async function humanClickBoundingBox(page, box, profile = 'center') {
    if (!box || box.width <= 0 || box.height <= 0) {
        return false;
    }
    let x;
    let y;
    if (profile === 'checkbox-left') {
        x = box.x + Math.min(38, box.width * 0.2) + randomBetween(-2, 3);
        y = box.y + box.height / 2 + randomBetween(-5, 5);
    } else if (profile === 'modal-below-text') {
        x = box.x + box.width / 2 + randomBetween(-20, 20);
        y = box.y + box.height * 0.72 + randomBetween(-8, 8);
    } else {
        x = box.x + box.width / 2 + randomBetween(-6, 6);
        y = box.y + box.height / 2 + randomBetween(-5, 5);
    }
    await humanClickAt(page, x, y);
    return true;
}

async function humanClickLocator(page, locator, profile = 'center') {
    try {
        await locator.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
        const box = await locator.boundingBox({ timeout: 2000 });
        return humanClickBoundingBox(page, box, profile);
    } catch (_) {
        return false;
    }
}

async function collectCaptchaIframeLocators(page) {
    const selectors = [
        'div:has-text("One more step") iframe',
        'div:has-text("I am human") iframe',
        'div:has-text("Verify you are human") iframe',
        'div:has-text("Select the checkbox") iframe',
        'iframe[src*="hcaptcha.com"][src*="frame=checkbox"]',
        'iframe[src*="hcaptcha.com"][src*="frame=challenge"]',
        'iframe[src*="challenges.cloudflare.com"]',
        'iframe[src*="turnstile"]',
        'iframe[title*="Cloudflare" i]',
        '.cf-turnstile iframe'
    ];
    const seen = new Set();
    const locators = [];

    for (const sel of selectors) {
        try {
            const items = page.locator(sel);
            const count = await items.count().catch(() => 0);
            for (let i = 0; i < count; i++) {
                const item = items.nth(i);
                const visible = await item.isVisible({ timeout: 400 }).catch(() => false);
                if (!visible) continue;
                const src = await item.getAttribute('src').catch(() => '') || '';
                if (isInvisibleStripeHcaptchaUrl(src)) continue;
                const title = await item.getAttribute('title').catch(() => '') || '';
                const key = `${sel}::${src}::${title}::${i}`;
                if (seen.has(key)) continue;
                seen.add(key);
                locators.push(item);
            }
        } catch (_) { /* next */ }
    }

    try {
        const allIframes = page.locator('iframe');
        const count = await allIframes.count().catch(() => 0);
        for (let i = 0; i < count; i += 1) {
            const item = allIframes.nth(i);
            if (!(await item.isVisible({ timeout: 300 }).catch(() => false))) continue;
            const src = await item.getAttribute('src').catch(() => '') || '';
            const title = await item.getAttribute('title').catch(() => '') || '';
            if (isInvisibleStripeHcaptchaUrl(src)) continue;
            if (!isBlockingCaptchaFrameUrl(src)
                && !/cloudflare|turnstile|hcaptcha|verify you are human/i.test(`${title} ${src}`)) continue;
            const key = `all::${src}::${title}::${i}`;
            if (seen.has(key)) continue;
            seen.add(key);
            locators.push(item);
        }
    } catch (_) { /* ignore */ }

    return locators;
}

async function dispatchSyntheticClickInFrame(frame) {
    return frame.evaluate(() => {
        const pickTarget = () => {
            const selectors = [
                'input[type="checkbox"]',
                'label.ctp-checkbox-label',
                'label',
                '#challenge-stage',
                '[role="checkbox"]',
                '.mark',
                'span',
                'body'
            ];
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el) return el;
            }
            return document.body;
        };
        const el = pickTarget();
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const x = rect.left + Math.min(rect.width * 0.2, 30);
        const y = rect.top + rect.height / 2;
        const eventInit = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
        for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mousemove', 'mousedown', 'mouseup', 'click']) {
            el.dispatchEvent(new MouseEvent(type, eventInit));
        }
        if (typeof PointerEvent !== 'undefined') {
            el.dispatchEvent(new PointerEvent('pointerdown', { ...eventInit, pointerId: 1, pointerType: 'mouse' }));
            el.dispatchEvent(new PointerEvent('pointerup', { ...eventInit, pointerId: 1, pointerType: 'mouse' }));
        }
        if (el.click) {
            try { el.click(); } catch (_) { /* ignore */ }
        }
        return true;
    }).catch(() => false);
}

async function clickTurnstileIframeByBBox(page) {
    const iframes = await collectCaptchaIframeLocators(page);
    for (const iframe of iframes) {
        const box = await iframe.boundingBox({ timeout: 2000 }).catch(() => null);
        if (!box || box.width < 24 || box.height < 20) {
            continue;
        }
        const clickPoints = [
            [box.x + Math.min(30, box.width * 0.14), box.y + box.height / 2],
            [box.x + box.width * 0.22, box.y + box.height / 2],
            [box.x + box.width / 2, box.y + box.height / 2]
        ];
        for (const [x, y] of clickPoints) {
            captchaLog('click', `Turnstile iframe 物理坐标点击 (${Math.round(x)}, ${Math.round(y)})`);
            await humanClickAt(page, x, y);
            await humanPause(page, 1800, 3000);
            return true;
        }
    }
    return false;
}

async function humanClickInsideFrame(page, frame) {
    const innerTargets = [
        '#checkbox', '#anchor', '[id="checkbox"]', 'input[type="checkbox"]',
        'label.ctp-checkbox-label', '[role="checkbox"]', '.checkbox', 'label',
        '#challenge-stage', '.mark'
    ];
    for (const target of innerTargets) {
        try {
            const el = frame.locator(target).first();
            if (!(await el.isVisible({ timeout: 800 }))) continue;
            const box = await el.boundingBox({ timeout: 1000 });
            if (box) {
                await humanClickBoundingBox(page, box, target.includes('checkbox') ? 'checkbox-left' : 'center');
                captchaLog('click', `iframe 内点击 ${target}`);
                return true;
            }
            await el.click({ timeout: 2000, delay: randomBetween(40, 120) });
            captchaLog('click', `iframe 内 direct 点击 ${target}`);
            return true;
        } catch (_) { /* next */ }
    }
    return dispatchSyntheticClickInFrame(frame);
}

async function clickMainPageCloudflareCheckbox(page) {
    const patterns = [/verify you are human/i, /i am human/i, /select the checkbox/i];
    for (const re of patterns) {
        try {
            const label = page.getByText(re).first();
            if (!(await label.isVisible({ timeout: 800 }).catch(() => false))) continue;

            const container = label.locator('xpath=ancestor::div[contains(@class,"cb") or contains(@class,"challenge") or contains(@class,"cf-")][1]');
            const checkbox = container.locator('input[type="checkbox"], [role="checkbox"]').first();
            if (await checkbox.isVisible({ timeout: 600 }).catch(() => false)) {
                if (await humanClickLocator(page, checkbox, 'checkbox-left')) {
                    captchaLog('click', `主页面 Cloudflare 勾选框 (${re})`);
                    return true;
                }
            }

            const labelBox = await label.boundingBox({ timeout: 1000 }).catch(() => null);
            if (labelBox && await humanClickBoundingBox(page, {
                x: labelBox.x - 28,
                y: labelBox.y,
                width: Math.max(labelBox.width + 36, 40),
                height: labelBox.height
            }, 'checkbox-left')) {
                captchaLog('click', `主页面 Cloudflare 标签左侧 (${re})`);
                return true;
            }

            await label.click({ timeout: 2000, delay: randomBetween(50, 120) }).catch(() => {});
            captchaLog('click', `主页面 Cloudflare 标签点击 (${re})`);
            return true;
        } catch (_) { /* next */ }
    }
    return false;
}

async function waitForTurnstileReady(page, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const locators = await collectCaptchaIframeLocators(page);
        if (locators.length > 0 || await isHumanVerificationVisible(page)) {
            return locators;
        }
        await page.waitForTimeout(350);
    }
    return collectCaptchaIframeLocators(page);
}

async function attemptBypassHumanVerification(page, options = {}) {
    const { phase = 'poll' } = options;

    if (await hasHcaptchaImageChallenge(page)) {
        captchaLog(phase, '当前已处于 hCaptcha 图片题界面，跳过盲目点击以保护题图...');
        return { attempted: false, skipped: true };
    }

    captchaLog(phase, '尝试模拟人类点击绕过验证...');

    const strategies = [
        'checkout-hcaptcha-modal',
        'turnstile-bbox',
        'hcaptcha-checkbox-frame',
        'main-page-cloudflare',
        'iframe-checkbox-left',
        'iframe-center',
        'frame-inner-elements',
        'modal-below-text',
        'dispatch-events',
        'all-iframes-scan'
    ];

    await waitForTurnstileReady(page, phase === 'post_submit' ? 12000 : 8000);
    await humanPause(page, 300, 700);

    const iframeLocators = await collectCaptchaIframeLocators(page);

    for (const strategy of strategies) {
        try {
            if (strategy === 'checkout-hcaptcha-modal') {
                if (!(await isCheckoutOverlayCaptchaVisible(page))) {
                    continue;
                }
                captchaLog(phase, '检测到 Checkout hCaptcha 弹层，优先点击 checkbox...');
                if (await clickHcaptchaCheckboxFrames(page, phase)) {
                    await humanPause(page, 2200, 3800);
                    return { attempted: true, strategy };
                }
                const modalIframe = page.locator(
                    'div:has-text("One more step") iframe, div:has-text("I am human") iframe'
                ).first();
                if (await humanClickLocator(page, modalIframe, 'checkbox-left')) {
                    captchaLog(phase, '策略 checkout-hcaptcha-modal 已点击弹层 iframe');
                    await humanPause(page, 2200, 3800);
                    return { attempted: true, strategy };
                }
                const modal = page.getByText(/one more step|select the checkbox/i).first();
                const modalBox = await modal.locator('xpath=ancestor::*[contains(@class,"Modal") or @role="dialog"][1]')
                    .boundingBox({ timeout: 1500 })
                    .catch(() => null);
                if (modalBox && await humanClickBoundingBox(page, modalBox, 'modal-below-text')) {
                    captchaLog(phase, '策略 checkout-hcaptcha-modal 已点击弹层下方');
                    await humanPause(page, 2200, 3800);
                    return { attempted: true, strategy };
                }
                continue;
            }

            if (strategy === 'turnstile-bbox') {
                if (await clickTurnstileIframeByBBox(page)) {
                    captchaLog(phase, '策略 turnstile-bbox 已执行');
                    return { attempted: true, strategy };
                }
                continue;
            }

            if (strategy === 'hcaptcha-checkbox-frame') {
                if (await clickHcaptchaCheckboxFrames(page, phase)) {
                    await humanPause(page, 1800, 3200);
                    return { attempted: true, strategy };
                }
                continue;
            }

            if (strategy === 'main-page-cloudflare') {
                if (await clickMainPageCloudflareCheckbox(page)) {
                    await humanPause(page, 1500, 2800);
                    return { attempted: true, strategy };
                }
                continue;
            }

            if (strategy === 'iframe-checkbox-left' || strategy === 'iframe-center') {
                const profile = strategy === 'iframe-checkbox-left' ? 'checkbox-left' : 'center';
                for (const iframe of iframeLocators) {
                    if (await humanClickLocator(page, iframe, profile)) {
                        captchaLog(phase, `策略 ${strategy} 已执行`);
                        await humanPause(page, 1200, 2200);
                        return { attempted: true, strategy };
                    }
                }
                continue;
            }

            if (strategy === 'frame-inner-elements') {
                for (const frame of page.frames()) {
                    if (!isBlockingCaptchaFrameUrl(frame.url())) continue;
                    if (await humanClickInsideFrame(page, frame)) {
                        captchaLog(phase, `策略 ${strategy} (${frame.url().slice(0, 60)}...)`);
                        await humanPause(page, 1200, 2200);
                        return { attempted: true, strategy };
                    }
                }
                for (const iframe of iframeLocators) {
                    const frame = iframe.contentFrame();
                    if (!frame) continue;
                    if (await humanClickInsideFrame(page, frame)) {
                        captchaLog(phase, `策略 ${strategy} (locator frame)`);
                        await humanPause(page, 1200, 2200);
                        return { attempted: true, strategy };
                    }
                }
                continue;
            }

            if (strategy === 'modal-below-text') {
                const modal = page.getByText(/one more step|select the checkbox|i am human|verify you are human/i).first();
                if (await modal.isVisible({ timeout: 800 }).catch(() => false)) {
                    const modalBox = await modal.locator('xpath=ancestor::*[contains(@class,"Modal") or contains(@role,"dialog")][1]').boundingBox({ timeout: 1500 }).catch(() => null)
                        || await modal.locator('xpath=ancestor::div[1]').boundingBox({ timeout: 1500 }).catch(() => null);
                    if (modalBox && await humanClickBoundingBox(page, modalBox, 'modal-below-text')) {
                        captchaLog(phase, `策略 ${strategy} 已执行`);
                        await humanPause(page, 1200, 2200);
                        return { attempted: true, strategy };
                    }
                }
                continue;
            }

            if (strategy === 'dispatch-events') {
                for (const frame of page.frames()) {
                    if (!isBlockingCaptchaFrameUrl(frame.url())) continue;
                    if (await dispatchSyntheticClickInFrame(frame)) {
                        captchaLog(phase, `策略 ${strategy} 已执行`);
                        await humanPause(page, 1500, 2500);
                        return { attempted: true, strategy };
                    }
                }
                continue;
            }

            if (strategy === 'all-iframes-scan') {
                const allIframes = page.locator('iframe');
                const count = await allIframes.count().catch(() => 0);
                for (let i = 0; i < count; i++) {
                    const iframe = allIframes.nth(i);
                    if (!(await iframe.isVisible({ timeout: 400 }).catch(() => false))) continue;
                    const src = String(await iframe.getAttribute('src').catch(() => '') || '').toLowerCase();
                    const title = String(await iframe.getAttribute('title').catch(() => '') || '').toLowerCase();
                    const name = String(await iframe.getAttribute('name').catch(() => '') || '').toLowerCase();

                    // 必须满足：是验证码相关的 iframe
                    const isCaptcha = isBlockingCaptchaFrameUrl(src)
                        || /hcaptcha|cloudflare|turnstile|recaptcha|challenge/i.test(`${src} ${title} ${name}`);

                    // 排除：Stripe 支付、卡号、CVC、地址等正常表单 iframe（严禁盲点导致失焦或误触关闭）
                    const isStripeForm = /stripe\.com\/v3\/elements|__privatestripecontroller|elements-inner/i.test(`${src} ${name} ${title}`);

                    if (!isCaptcha || isStripeForm) {
                        continue;
                    }

                    for (const profile of ['checkbox-left', 'center']) {
                        if (await humanClickLocator(page, iframe, profile)) {
                            captchaLog(phase, `策略 ${strategy} iframe #${i} ${profile}`);
                            await humanPause(page, 1200, 2200);
                            return { attempted: true, strategy: `${strategy}-${i}` };
                        }
                    }
                }
            }
        } catch (err) {
            captchaLog(phase, `策略 ${strategy} 失败: ${err.message}`, 'warn');
        }
    }

    captchaLog(phase, '所有模拟点击策略均未命中', 'warn');
    return { attempted: false };
}

async function attemptCaptchaPlatformSolver(page, phase = 'platform', verifyOpts = {}) {
    if (!isCaptchaPlatformEnabled()) {
        captchaLog(phase, '打码平台未配置，跳过', 'warn');
        return false;
    }

    const imageChallenge = await hasHcaptchaImageChallenge(page);
    captchaLog(phase, `尝试打码平台（createTask/getTaskResult）解题 (当前状态: ${imageChallenge ? '九宫格图片题' : '被动/弹层验证'})…`);
    const params = await extractHcaptchaParamsFromPage(page);
    const userAgent = String(
        await page.evaluate(() => navigator.userAgent).catch(() => '')
        || process.env.HCAPTCHA_USER_AGENT
        || ''
    ).trim();
    captchaLog(
        phase,
        `提取参数 siteKey=${params.siteKey.slice(0, 12)}… rqdata=${params.rqdata ? 'yes' : 'no'} urls=${params.websiteUrls.length} ua=${userAgent ? 'yes' : 'no'}`
    );

    const solveResult = await solveHcaptchaViaPlatform({
        siteKey: params.siteKey,
        rqdata: params.rqdata,
        websiteUrls: params.websiteUrls,
        isInvisible: !imageChallenge,
        userAgent
    });

    if (!solveResult.ok) {
        captchaLog(phase, `打码平台失败: ${solveResult.error || 'unknown'}`, 'error');
        return false;
    }

    captchaLog(phase, `打码平台返回 token（${solveResult.token.length} chars），注入页面…`);
    await injectHcaptchaTokenOnPage(page, solveResult.token, solveResult.ekey);
    await page.waitForTimeout(2000);

    // 若当前仍有可见的 challenge frame，尝试点击其提交/验证按钮以触发关闭
    for (const frame of page.frames()) {
        const frameUrl = frame.url() || '';
        if (/hcaptcha.*challenge|challenge/i.test(frameUrl)) {
            try {
                const btn = frame.locator('.button-submit, input[type="submit"]').first();
                if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
                    await btn.click({ timeout: 1000 }).catch(() => {});
                }
            } catch (_) {}
        }
    }

    await clickCheckoutContinueAfterCaptcha(page);

    const deadline = Date.now() + 35000;
    while (Date.now() < deadline) {
        const pageUrl = page.url() || '';
        if (/redirect_status=succeeded|checkout\/verify/i.test(pageUrl)) {
            captchaLog(phase, '打码平台 token 注入后支付已跳转成功页');
            return true;
        }
        if (await isVerificationCleared(page, verifyOpts)) {
            captchaLog(phase, '打码平台 token 注入后验证已通过');
            return true;
        }
        await page.waitForTimeout(1500);
    }

    captchaLog(phase, '打码平台 token 注入后验证仍在', 'warn');
    return false;
}

async function attemptHcaptchaVisualSolver(page, phase = 'visual') {
    captchaLog(phase, 'ChatGPT VLM 视觉求解器已停用，已全面切换为 Capsolver 打码平台与前端用户透传', 'info');
    return false;
}

const HCAPTCHA_PROMPT_EXACT_DICT = {
    'click all the animals that match the example and count shown': '请点击所有符合下方示例及其数量的动物',
    'click all the objects that match the example and count shown': '请点击所有符合下方示例及其数量的物体',
    'click all the images that match the example and count shown': '请点击所有符合下方示例及其数量的图片',
    'select all the animals that match the example and count shown': '请选择所有符合下方示例及其数量的动物',
    'select all the objects that match the example and count shown': '请选择所有符合下方示例及其数量的物体',
    'click all animals that match the example and count shown': '请点击所有符合下方示例及其数量的动物',
    'click all objects that match the example and count shown': '请点击所有符合下方示例及其数量的物体',
    'select all animals that match the example and count shown': '请选择所有符合下方示例及其数量的动物',
    'select all objects that match the example and count shown': '请选择所有符合下方示例及其数量的物体',

    'animals looking away from you': '背对你（看向别处）的动物',
    'animal looking away from you': '背对你（看向别处）的动物',
    'select animals looking away from you': '请选择背对你（看向别处）的动物',
    'select all animals looking away from you': '请选择所有背对你（看向别处）的动物',
    'please click each image containing an animal looking away from you': '请点击每张包含背对你（看向别处）动物的图片',
    'please select all animals looking away from you': '请选择所有背对你（看向别处）的动物',
    'click each image containing an animal looking away from you': '请点击每张包含背对你（看向别处）动物的图片',
    'click all images containing an animal looking away from you': '请点击所有包含背对你（看向别处）动物的图片',

    'tap on each vehicle that is made for water travel': '请点击能在水上行驶的交通工具（如船只）',
    'tap on each vehicle made for water travel': '请点击能在水上行驶的交通工具（如船只）',
    'select all vehicles that are made for water travel': '请选择所有能在水上行驶的交通工具（如船只）',
    'select all objects that can float on water': '请选择所有能在水上漂浮的物体',
    'click each image containing an object that can float on water': '请点击每张包含能在水上漂浮物体的图片',

    'tap on the item that travels in the same area as the example': '【交通环境匹配】请点击与示例在同一环境中行驶的物体',
    'click on the item that travels in the same area as the example': '【交通环境匹配】请点击与示例在同一环境中行驶的物体',
    'select the item that travels in the same area as the example': '【交通环境匹配】请选择与示例在同一环境中行驶的物体',
    'tap on the object that travels in the same area as the example': '【交通环境匹配】请点击与示例在同一环境中行驶的物体',
    'click the object that travels in the same area as the example': '【交通环境匹配】请点击与示例在同一环境中行驶的物体',
    'tap on the item that travels in the same environment as the example': '【交通环境匹配】请点击与示例在同一环境中行驶的物体',

    'please click on the object that is different from the others': '请点击与其他物体不同的图案',
    'click on the object that is different from the others': '请点击与其他物体不同的图案',
    'click the one that is different': '请点击与其他图案不同的那一项',
    'select the image that does not belong': '请选择不属于同类的图片',
    'please click on the two shapes that are different from the others': '请点击与其他图形不同的【两个形状】',
    'click on the two shapes that are different from the others': '请点击与其他图形不同的【两个形状】',
    'please click on the two objects that are different from the others': '请点击与其他物体不同的【两个物体】',
    'click on the two objects that are different from the others': '请点击与其他物体不同的【两个物体】',
    'please click on the shape that is different from the others': '请点击与其他图形不同的【形状】',
    'click on the shape that is different from the others': '请点击与其他图形不同的【形状】',
    'select the shape that is different from the others': '请选择与其他图形不同的【形状】',
    'please select the two shapes that are different from the others': '请选择与其他图形不同的【两个形状】',
    'select the two shapes that are different from the others': '请选择与其他图形不同的【两个形状】',
    'please click on the two shapes that are different': '请点击不同的【两个形状】',
    'click on the two shapes that are different': '请点击不同的【两个形状】',
    'please click on the shapes that are different from the others': '请点击与其他图形不同的【形状】',
    'click on the shapes that are different from the others': '请点击与其他图形不同的【形状】',
    'select the shapes that are different from the others': '请选择与其他图形不同的【形状】',
    'please click on the two identical shapes': '请点击完全相同的【两个形状】',
    'click on the two identical shapes': '请点击完全相同的【两个形状】',
    'select the two identical shapes': '请选择完全相同的【两个形状】',
    'please click on the two identical objects': '请点击完全相同的【两个物体】',
    'click on the two identical objects': '请点击完全相同的【两个物体】',
    'tap all objects that can be completely concealed by the item shown': '请选出所有能被所示物品（完全遮蔽）的物体',
    'click all objects that can be completely concealed by the item shown': '请选出所有能被所示物品（完全遮蔽）的物体',
    'select all objects that can be completely concealed by the item shown': '请选出所有能被所示物品（完全遮蔽）的物体',
    'tap all objects that can fit inside the item shown': '请选出所有能完全装进所示物品内部的物体',
    'click all objects that can fit inside the item shown': '请选出所有能完全装进所示物品内部的物体',
    'select all objects that can fit inside the item shown': '请选出所有能完全装进所示物品内部的物体',

    'select all animals that do not meet your eye': '请选择所有背对你（不看向你 / 避开目光）的动物',
    'select animals that do not meet your eye': '请选择背对你（不看向你 / 避开目光）的动物',
    'click all animals that do not meet your eye': '请点击所有背对你（不看向你 / 避开目光）的动物',
    'please select all animals that do not meet your eye': '请选择所有背对你（不看向你 / 避开目光）的动物',
    'animals that do not meet your eye': '背对你（不看向你 / 避开目光）的动物',
    'animal that does not meet your eye': '背对你（不看向你 / 避开目光）的动物',
    'select all animals that meet your eye': '请选择所有直视你（与你目光对视）的动物',
    'select animals that meet your eye': '请选择直视你（与你目光对视）的动物',
    'animals that meet your eye': '直视你（与你目光对视）的动物',

    'please drag the object to complete the pair': '请拖动目标物体完成配对',
    'drag the object to complete the pair': '请拖动目标物体完成配对',
    'please drag the letter to the place where it fits': '请拖动【字母】到适合的位置',
    'drag the letter to the place where it fits': '请拖动【字母】到适合的位置',
    'drag the matching shape': '请拖动相匹配的形状',
    'drag the shape to the matching outline': '请将形状拖动到相符的轮廓中',
    'please drag the missing puzzle piece': '请拖动缺失的拼图碎片',
    'drag the missing puzzle piece': '请拖动缺失的拼图碎片',
    'drag the slider to complete the puzzle': '请拖动滑块完成拼图',
    'slide to complete the puzzle': '请拖动滑块完成拼图',

    'please click the center of the object': '请点击物体的中心位置',
    'click on the center of the image': '请点击图片中心',
    'select the largest animal': '请选择体型最大的动物',
    'select the smallest animal': '请选择体型最小的动物',
    'select the largest object': '请选择体积最大的物体',
    'select the smallest object': '请选择体积最小的物体',

    'click on things that spin when you use them': '请点击【使用时会旋转的物品】',
    'click on all things that spin when you use them': '请点击【所有使用时会旋转的物品】',
    'click things that spin when you use them': '请点击【使用时会旋转的物品】',
    'click all things that spin when you use them': '请点击【所有使用时会旋转的物品】',
    'select things that spin when you use them': '请选择【使用时会旋转的物品】',
    'select all things that spin when you use them': '请选择【所有使用时会旋转的物品】',
    'things that spin when you use them': '使用时会旋转的物品',
    'things that spin': '会旋转的物品',
    'objects that spin when you use them': '使用时会旋转的物品',
    'objects that spin': '会旋转的物品',

    'click on all materials that absorb liquid': '请点击【所有能吸收液体的材料】',
    'click on materials that absorb liquid': '请点击【能吸收液体的材料】',
    'click all materials that absorb liquid': '请点击【所有能吸收液体的材料】',
    'click materials that absorb liquid': '请点击【能吸收液体的材料】',
    'select all materials that absorb liquid': '请选择【所有能吸收液体的材料】',
    'select materials that absorb liquid': '请选择【能吸收液体的材料】',
    'all materials that absorb liquid': '能吸收液体的材料',
    'materials that absorb liquid': '能吸收液体的材料',
    'objects that absorb liquid': '能吸收液体的物体',
    'things that absorb liquid': '能吸收液体的物品',

    'find all items that are typically kept outside': '请选出所有【通常放置在室外的物品】',
    'find all items typically kept outside': '请选出所有【通常放置在室外的物品】',
    'find all objects that are typically kept outside': '请选出所有【通常放置在室外的物品】',
    'find all things that are typically kept outside': '请选出所有【通常放置在室外的物品】',
    'find items that are typically kept outside': '请选出【通常放置在室外的物品】',
    'click all items that are typically kept outside': '请点击【所有通常放置在室外的物品】',
    'click on all items that are typically kept outside': '请点击【所有通常放置在室外的物品】',
    'select all items that are typically kept outside': '请选择【所有通常放置在室外的物品】',
    'items that are typically kept outside': '通常放置在室外的物品',
    'objects that are typically kept outside': '通常放置在室外的物品',
    'things that are typically kept outside': '通常放置在室外的物品',

    'find all items that are typically kept indoors': '请选出所有【通常放置在室内的物品】',
    'find all items typically kept indoors': '请选出所有【通常放置在室内的物品】',
    'find all items that are typically kept inside': '请选出所有【通常放置在室内的物品】',
    'items that are typically kept indoors': '通常放置在室内的物品',
    'items that are typically kept inside': '通常放置在室内的物品',
    'objects that are typically kept indoors': '通常放置在室内的物品',
    'objects that are typically kept inside': '通常放置在室内的物品',

    'find all things with on and off states': '请选出所有【有开关状态的物品】',
    'find all items with on and off states': '请选出所有【有开关状态的物品】',
    'find all objects with on and off states': '请选出所有【有开关状态的物品】',
    'find all devices with on and off states': '请选出所有【有开关状态的设备】',
    'find things with on and off states': '请选出【有开关状态的物品】',
    'click on all things with on and off states': '请点击【所有有开关状态的物品】',
    'click all things with on and off states': '请点击【所有有开关状态的物品】',
    'select all things with on and off states': '请选择【所有有开关状态的物品】',
    'things with on and off states': '有开关状态的物品',
    'items with on and off states': '有开关状态的物品',
    'objects with on and off states': '有开关状态的物品',
    'devices with on and off states': '有开关状态的设备'
};

const HCAPTCHA_NOUN_DICT = {
    'letter': '字母', 'letters': '字母',
    'puzzle piece': '拼图碎片', 'puzzle pieces': '拼图碎片',
    'slider': '滑块', 'shape': '形状', 'shapes': '形状',
    'outline': '轮廓', 'shadow': '阴影', 'silhouette': '剪影',

    'things that spin when you use them': '使用时会旋转的物品',
    'all things that spin when you use them': '所有使用时会旋转的物品',
    'things that spin': '会旋转的物品',
    'objects that spin when you use them': '使用时会旋转的物品',
    'objects that spin': '会旋转的物品',

    'all materials that absorb liquid': '能吸收液体的材料',
    'materials that absorb liquid': '能吸收液体的材料',
    'objects that absorb liquid': '能吸收液体的物体',
    'things that absorb liquid': '能吸收液体的物品',

    'all items that are typically kept outside': '通常放置在室外的物品',
    'items that are typically kept outside': '通常放置在室外的物品',
    'objects that are typically kept outside': '通常放置在室外的物品',
    'things that are typically kept outside': '通常放置在室外的物品',
    'all items that are typically kept indoors': '通常放置在室内的物品',
    'items that are typically kept indoors': '通常放置在室内的物品',
    'items that are typically kept inside': '通常放置在室内的物品',
    'objects that are typically kept indoors': '通常放置在室内的物品',
    'objects that are typically kept inside': '通常放置在室内的物品',

    'all things with on and off states': '所有有开关状态的物品',
    'things with on and off states': '有开关状态的物品',
    'items with on and off states': '有开关状态的物品',
    'objects with on and off states': '有开关状态的物品',
    'devices with on and off states': '有开关状态的设备',
    'things that have on and off states': '有开关状态的物品',
    'objects that have on and off states': '有开关状态的物品',
    'things that can be turned on and off': '有开关状态的物品',
    'objects that can be turned on and off': '有开关状态的物品',

    'animals looking away from you': '背对你（看向别处）的动物',
    'animal looking away from you': '背对你（看向别处）的动物',
    'animals facing away': '背对你的动物',
    'animal facing away': '背对你的动物',
    'vehicles that are made for water travel': '水上交通工具（如船只）',
    'vehicle that is made for water travel': '水上交通工具（如船只）',
    'objects that can float on water': '能在水上漂浮的物体',
    'object that can float on water': '能在水上漂浮的物体',

    'dog': '狗', 'dogs': '狗',
    'cat': '猫', 'cats': '猫',
    'horse': '马', 'horses': '马',
    'bird': '鸟', 'birds': '鸟',
    'lion': '狮子', 'lions': '狮子',
    'elephant': '大象', 'elephants': '大象',
    'zebra': '斑马', 'zebras': '斑马',
    'panda': '大熊猫', 'pandas': '大熊猫',
    'bear': '熊', 'bears': '熊',
    'duck': '鸭子', 'ducks': '鸭子',
    'cow': '牛', 'cows': '牛',
    'sheep': '绵羊',
    'rabbit': '兔子', 'rabbits': '兔子',
    'turtle': '乌龟', 'turtles': '乌龟',
    'fish': '鱼',
    'frog': '青蛙', 'frogs': '青蛙',
    'monkey': '猴子', 'monkeys': '猴子',
    'butterfly': '蝴蝶', 'butterflies': '蝴蝶',
    'insect': '昆虫', 'insects': '昆虫',
    'animal': '动物', 'animals': '动物',

    'bicycle': '自行车', 'bicycles': '自行车', 'bike': '自行车', 'bikes': '自行车',
    'motorcycle': '摩托车', 'motorcycles': '摩托车', 'motorbike': '摩托车', 'motorbikes': '摩托车',
    'car': '小汽车', 'cars': '小汽车', 'automobile': '小汽车', 'automobiles': '小汽车',
    'bus': '公交车 / 巴士', 'buses': '公交车 / 巴士',
    'truck': '卡车', 'trucks': '卡车',
    'boat': '船只', 'boats': '船只', 'ship': '轮船', 'ships': '轮船',
    'airplane': '飞机', 'airplanes': '飞机', 'aeroplane': '飞机', 'aeroplanes': '飞机', 'plane': '飞机', 'planes': '飞机',
    'train': '火车', 'trains': '火车',
    'tractor': '拖拉机', 'tractors': '拖拉机',
    'helicopter': '直升机', 'helicopters': '直升机',
    'submarine': '潜艇', 'submarines': '潜艇',
    'fire truck': '消防车', 'fire engine': '消防车',
    'ambulance': '救护车',
    'vehicle': '交通工具 / 车辆', 'vehicles': '交通工具 / 车辆',

    'traffic light': '红绿灯 / 交通信号灯', 'traffic lights': '红绿灯 / 交通信号灯',
    'fire hydrant': '消防栓', 'fire hydrants': '消防栓',
    'crosswalk': '斑马线 / 人行横道', 'crosswalks': '斑马线 / 人行横道',
    'bridge': '桥梁', 'bridges': '桥梁',
    'mountain': '山峰', 'mountains': '山峰',
    'stair': '楼梯', 'stairs': '楼梯', 'staircase': '楼梯',
    'chimney': '烟囱', 'chimneys': '烟囱',
    'parking meter': '停车咪表', 'parking meters': '停车咪表',
    'street sign': '路标 / 街道标志', 'street signs': '路标 / 街道标志',
    'stop sign': '停车标志', 'stop signs': '停车标志',
    'umbrella': '雨伞', 'umbrellas': '雨伞',
    'guitar': '吉他', 'guitars': '吉他',
    'violin': '小提琴', 'violins': '小提琴',
    'piano': '钢琴', 'pianos': '钢琴',
    'shoe': '鞋子', 'shoes': '鞋子',
    'hat': '帽子', 'hats': '帽子',
    'sunglasses': '太阳镜 / 墨镜', 'glasses': '眼镜',
    'watch': '手表', 'watches': '手表',
    'clock': '钟表', 'clocks': '钟表',
    'chair': '椅子', 'chairs': '椅子',
    'table': '桌子', 'tables': '桌子',
    'couch': '沙发', 'couches': '沙发', 'sofa': '沙发', 'sofas': '沙发',
    'bed': '床', 'beds': '床',
    'lamp': '台灯', 'lamps': '台灯',
    'cup': '杯子', 'cups': '杯子', 'mug': '马克杯', 'mugs': '马克杯',
    'bottle': '瓶子', 'bottles': '瓶子',
    'backpack': '背包', 'backpacks': '背包',
    'plant': '植物', 'plants': '植物',
    'flower': '花朵', 'flowers': '花朵',
    'tree': '树木', 'trees': '树木',
    'cactus': '仙人掌', 'cacti': '仙人掌',
    'fruit': '水果', 'fruits': '水果',
    'apple': '苹果', 'apples': '苹果',
    'banana': '香蕉', 'bananas': '香蕉',
    'orange': '橙子', 'oranges': '橙子',

    'living room': '客厅', 'living rooms': '客厅',
    'bedroom': '卧室', 'bedrooms': '卧室',
    'kitchen': '厨房', 'kitchens': '厨房',
    'bathroom': '浴室 / 卫生间', 'bathrooms': '浴室 / 卫生间',
    'dining room': '餐厅', 'dining rooms': '餐厅',
    'office': '办公室', 'offices': '办公室',
    'beach': '海滩', 'beaches': '海滩',
    'forest': '森林', 'forests': '森林',
    'desert': '沙漠', 'deserts': '沙漠'
};

function translateHcaptchaPrompt(prompt) {
    if (!prompt || typeof prompt !== 'string') return '';
    const clean = prompt.replace(/\s+/g, ' ').trim().replace(/[.:?!。？！]+$/, '');
    if (!clean) return '';

    if (/[\u4e00-\u9fa5]/.test(clean)) {
        return clean;
    }

    const lower = clean.toLowerCase();

    // 1. 精确匹配
    if (HCAPTCHA_PROMPT_EXACT_DICT[lower]) {
        return HCAPTCHA_PROMPT_EXACT_DICT[lower];
    }

    // “TWO ends” is part of the instruction, not an untranslated object name.
    if (/^(?:please\s+)?(?:click|tap|select)(?:\s+on)?\s+(?:the\s+)?(?:two|both)\s+(?:ends|end\s*points)\s+of\s+(?:the\s+|a\s+)?line(?:\s+segment)?$/.test(lower)) {
        return '请点击线条的两个端点';
    }

    if (/^(?:please\s+)?(?:point\s+to|click(?:\s+on)?|tap(?:\s+on)?|select)\s+all\s+(?:the\s+)?machines\s+(?:containing|(?:that\s+)?(?:contain|have))\s+moving\s+parts$/.test(lower)) {
        return '请点选所有含有运动部件的机器';
    }

    // 针对“找不同”几何图形/物体（如 "Please click on the TWO shapes that are different from the others"）
    const diffMatch = lower.match(/(?:click|select|tap)(?:\s+on)?\s+(?:the\s+)?(?:(\w+)\s+)?(shapes?|objects?|items?|patterns?)\s+that\s+are\s+different(?:\s+from\s+the\s+others)?/i);
    if (diffMatch) {
        const numWord = (diffMatch[1] || '').toLowerCase();
        const noun = (diffMatch[2] || '').toLowerCase();
        const numZhMap = { 'two': '两个', 'three': '三个', 'four': '四个', 'five': '五个', 'one': '一个' };
        const numZh = numZhMap[numWord] || (numWord ? `${numWord}个` : '');
        const nounZh = /shape/i.test(noun) ? '形状' : (/pattern/i.test(noun) ? '图案' : '物体');
        return `请点击与其他图形不同的【${numZh ? numZh : ''}${nounZh}】`;
    }
    if (lower.includes('different from the others') || lower.includes('different from each other') || lower.includes('that are different')) {
        if (lower.includes('two')) return '请点击与其他图形不同的【两个形状】';
        if (lower.includes('three')) return '请点击与其他图形不同的【三个形状】';
        return '请点击与其他项不同的【形状/物体】';
    }
    if (lower.includes('identical') || lower.includes('that are the same')) {
        if (lower.includes('two')) return '请点击完全相同的【两个形状】';
        return '请点击完全相同的形状';
    }

    // 场所与情境匹配（如 "Tap the thing you can take inside the place"）
    if (lower.includes('take inside the place') || lower.includes('take inside') || lower.includes('bring inside') || lower.includes('take into the place')) {
        return '【场景匹配】请点击能带进右上角场所的物品';
    }
    if (lower.includes('wear inside the place') || lower.includes('wear in the place') || lower.includes('wear inside')) {
        return '【场景穿戴】请点击适合在该场所穿戴的衣物';
    }
    if (lower.includes('belongs in the place') || lower.includes('belong in the place') || lower.includes('belongs to the place') || lower.includes('belongs inside')) {
        return '【场景归属】请点击属于右上角场所的设施/物品';
    }
    if (lower.includes('water travel') || lower.includes('water transport')) {
        return '【水上交通】请点击所有水上交通工具（轮船/艇等）';
    }
    if (/(?:travel|move|drive|fly|float)/i.test(lower)
        && /same\s+(?:area|environment|place)\s+as\s+(?:the\s+)?example/i.test(lower)) {
        return '【交通环境匹配】请点击与示例在同一环境中行驶的物体';
    }
    if (lower.includes('air travel') || lower.includes('air transport')) {
        return '【空中交通】请点击所有空中交通工具（飞机/直升机等）';
    }
    if (lower.includes('land travel') || lower.includes('land transport')) {
        return '【陆地交通】请点击所有陆地交通工具（汽车/自行车等）';
    }
    if (lower.includes('shadow') || lower.includes('silhouette')) {
        return '【影子匹配】请选出正确的投影/影子';
    }
    if (lower.includes('complete the pair') || lower.includes('complete the puzzle')) {
        return '【配对拼图】请拖动物体完成拼图配对';
    }

    // 特殊高频抽象题型翻译（如 "Tap all objects that can be completely concealed by the item shown"）
    if (lower.includes('concealed by the item shown') || lower.includes('concealed by')) {
        return '请选出所有能被所示物品（完全遮蔽/藏匿）的物体';
    }
    if (lower.includes('fit inside the item shown') || lower.includes('fit inside')) {
        return '请选出所有能完全装进所示物品内部的物体';
    }
    if (lower.includes('larger than the item shown') || lower.includes('larger than')) {
        return '请选出所有比所示物品体积更大的物体';
    }
    if (lower.includes('smaller than the item shown') || lower.includes('smaller than')) {
        return '请选出所有比所示物品体积更小的物体';
    }
    if (lower.includes('heavier than the item shown') || lower.includes('heavier than')) {
        return '请选出所有比所示物品更重的物体';
    }
    if (lower.includes('lighter than the item shown') || lower.includes('lighter than')) {
        return '请选出所有比所示物品更轻的物体';
    }

    // 动物眼神/对视朝向题型（如 "Select all animals that do not meet your eye"）
    if (lower.includes('do not meet your eye') || lower.includes('does not meet your eye') || lower.includes("don't meet your eye")) {
        return '请选择所有背对你（不看向你 / 避开目光）的动物';
    }
    if (lower.includes('meet your eye')) {
        return '请选择所有直视你（与你目光对视）的动物';
    }

    // 旋转/功能特性题型（如 "Click on things that spin when you use them"）
    if (/spin\s+when\s+(?:you\s+)?use\s+them|spin\s+when\s+used|things?\s+that\s+spin|objects?\s+that\s+spin/i.test(lower)) {
        return '请点击【使用时会旋转的物品】';
    }

    // 材质吸收液体题型（如 "Click on all materials that absorb liquid"）
    if (/absorb(?:s)?\s+(?:liquid|water)/i.test(lower)) {
        return '请点击【所有能吸收液体的材料】';
    }

    // 室内/室外物品题型（如 "Find all items that are typically kept outside"）
    if (/kept\s+outside|found\s+outside|placed\s+outside|kept\s+outdoors/i.test(lower)) {
        return '请选出所有【通常放置在室外的物品】';
    }
    if (/kept\s+(?:indoors|inside)|found\s+(?:indoors|inside)|placed\s+(?:indoors|inside)/i.test(lower)) {
        return '请选出所有【通常放置在室内的物品】';
    }

    // 开关状态题型（如 "Find all things with on and off states"）
    if (/on\s+and\s+off\s+states?|turned\s+on\s+and\s+off|on\s*\/\s*off\s+states?/i.test(lower)) {
        return '请选出所有【有开关状态的物品】';
    }

    // 2. 句式模式匹配
    // 匹配: Click all the animals that match the example and count shown
    let m = lower.match(/^(?:please\s+)?(?:click|select)\s+(?:on\s+)?(?:all\s+)?(?:\b(?:an?|the)\b\s*)?(.+?)\s+(?:that\s+)?match\s+(?:the\s+)?example(?:\s+and\s+count\s+shown)?$/i);
    if (m) {
        const noun = m[1].trim();
        const nounZh = HCAPTCHA_NOUN_DICT[noun] || noun;
        return `请点击所有符合下方示例及其数量的【${nounZh}】`;
    }

    m = lower.match(/^(?:please\s+)?(?:click|select)\s+(?:on\s+)?(?:each|all)\s+images?\s+(?:containing|with)\s+(?:\b(?:an?|the)\b\s*)?(.+)$/i);
    if (m) {
        const noun = m[1].trim();
        const nounZh = HCAPTCHA_NOUN_DICT[noun] || noun;
        return `请点击每张包含【${nounZh}】的图片`;
    }

    m = lower.match(/^(?:please\s+)?tap\s+on\s+each\s+(?:\b(?:an?|the)\b\s*)?(.+)$/i);
    if (m) {
        const noun = m[1].trim();
        const nounZh = HCAPTCHA_NOUN_DICT[noun] || noun;
        return `请点击每个【${nounZh}】`;
    }

    m = lower.match(/^(?:please\s+)?select\s+all\s+(?:\b(?:an?|the)\b\s*)?(.+)$/i);
    if (m) {
        const noun = m[1].trim();
        const nounZh = HCAPTCHA_NOUN_DICT[noun] || noun;
        return `请选择所有【${nounZh}】`;
    }

    m = lower.match(/^(?:please\s+)?select\s+(?:\b(?:an?|the)\b\s*)?(.+)$/i);
    if (m) {
        const noun = m[1].trim();
        const nounZh = HCAPTCHA_NOUN_DICT[noun] || noun;
        return `请选择【${nounZh}】`;
    }

    m = lower.match(/^(?:please\s+)?click\s+(?:on\s+)?each\s+(?:image|picture)\s+(?:containing|with)?\s*(?:\b(?:an?|the)\b\s*)?(.+)$/i);
    if (m) {
        const noun = m[1].trim();
        const nounZh = HCAPTCHA_NOUN_DICT[noun] || noun;
        return `请点击包含【${nounZh}】的图片`;
    }

    m = lower.match(/^(?:please\s+)?click\s+(?:on\s+)?(?:\b(?:an?|the)\b\s*)?(.+)$/i);
    if (m) {
        const noun = m[1].trim();
        const nounZh = HCAPTCHA_NOUN_DICT[noun] || noun;
        return `请点击【${nounZh}】`;
    }

    m = lower.match(/^(?:please\s+)?find\s+(?:all\s+)?(?:\b(?:an?|the)\b\s*)?(.+)$/i);
    if (m) {
        const noun = m[1].trim();
        const nounZh = HCAPTCHA_NOUN_DICT[noun] || noun;
        return `请选出所有【${nounZh}】`;
    }

    m = lower.match(/^(?:please\s+)?drag\s+(?:the\s+)?(.+?)\s+(?:to\s+(?:the\s+)?(?:place\s+where\s+it\s+fits|missing\s+spot|missing\s+place|empty\s+slot|correct\s+position|matching\s+outline)|where\s+it\s+fits|to\s+fit)/i);
    if (m) {
        const item = m[1].trim();
        const itemZh = HCAPTCHA_NOUN_DICT[item] || (item === 'letter' ? '字母' : (item === 'puzzle piece' ? '拼图碎片' : item));
        return `请拖动【${itemZh}】到适合的位置`;
    }

    m = lower.match(/^(?:please\s+)?drag\s+(?:\b(?:an?|the)\b\s*)?(.+)$/i);
    if (m) {
        let noun = m[1].trim();
        if (noun.includes('where it fits') || noun.includes('to the place') || noun.includes('to the missing') || noun.includes('missing spot') || noun.includes('to fit')) {
            const cleanNoun = noun.replace(/\s+to\s+(?:the\s+)?(?:place\s+where\s+it\s+fits|missing\s+spot|missing\s+place|empty\s+slot|correct\s+position).*$/i, '')
                                  .replace(/\s+where\s+it\s+fits.*$/i, '')
                                  .replace(/\s+to\s+fit.*$/i, '')
                                  .trim();
            const itemZh = HCAPTCHA_NOUN_DICT[cleanNoun] || (cleanNoun === 'letter' ? '字母' : (cleanNoun === 'puzzle piece' ? '拼图碎片' : cleanNoun));
            return `请拖动【${itemZh}】到适合的位置`;
        }
        const nounZh = HCAPTCHA_NOUN_DICT[noun] || noun;
        return `请拖动【${nounZh}】`;
    }

    if (HCAPTCHA_NOUN_DICT[lower]) {
        return `请选择【${HCAPTCHA_NOUN_DICT[lower]}】`;
    }

    return clean;
}

/**
 * 从 hCaptcha 验证码 frame 或页面中提取英文/原始题目文本
 */
async function extractHcaptchaChallengePrompt(frame, page) {
    const promptSelectors = [
        '#prompt-question',
        '[data-theme="challenge-container"] h2',
        '[data-theme="challenge-container"] .prompt-text',
        '.prompt-text',
        '.challenge-example .prompt-text',
        'h2.prompt-text',
        '.prompt-text-container'
    ];
    if (frame) {
        for (const sel of promptSelectors) {
            try {
                const loc = frame.locator(sel).first();
                if (await loc.isVisible({ timeout: 200 }).catch(() => false)) {
                    const txt = String(await loc.innerText({ timeout: 250 }).catch(() => '') || '').trim();
                    if (txt && txt.length >= 4 && !/套餐|升级|账单|订阅|upgrade|billing|pricing/i.test(txt)) {
                        return txt.replace(/\s+/g, ' ').trim();
                    }
                }
            } catch (_) {}
        }
        try {
            const body = String(await frame.evaluate(() => document.body ? document.body.innerText : '').catch(() => '') || '');
            const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
            for (const line of lines) {
                const lower = line.toLowerCase();
                if (lower.startsWith('please try again') || lower.startsWith('verify') || lower.startsWith('submit')) continue;
                if (/套餐|升级|账单|订阅|upgrade|billing|pricing/i.test(line)) continue;
                if (/^(select|please\s+(?:click|select|drag|choose)|tap\s+on|click\s+the|click\s+each)/i.test(line) && line.length >= 8) {
                    return line.replace(/\s+/g, ' ').trim();
                }
            }
        } catch (_) {}
    }
    if (page) {
        for (const sel of ['#prompt-question', '[data-theme="challenge-container"] .prompt-text', '.challenge-container .prompt-text']) {
            try {
                const loc = page.locator(sel).first();
                if (await loc.isVisible({ timeout: 200 }).catch(() => false)) {
                    const txt = String(await loc.innerText({ timeout: 250 }).catch(() => '') || '').trim();
                    if (txt && txt.length >= 4 && !/套餐|升级|账单|订阅|upgrade|billing|pricing/i.test(txt)) {
                        return txt.replace(/\s+/g, ' ').trim();
                    }
                }
            } catch (_) {}
        }
    }
    return '';
}

function formatCaptchaGuideMessage(promptZh, promptEn) {
    const parts = [];
    const fullText = `${promptZh || ''} ${promptEn || ''}`.toLowerCase();
    if (promptEn && promptEn !== promptZh) {
        parts.push(`<div class="captcha-prompt-en">英文原题：${promptEn}</div>`);
    }

    if (fullText.includes('take inside') || fullText.includes('带进') || fullText.includes('bring inside')) {
        parts.push(
            `<div class="captcha-prompt-guide">` +
            `操作指引：请观察右上角小图所示地点（例如电影院放映厅、公园、海滩等），在下方点击所有【符合常理能带进去/携带入场】的随身物品（如外套、背包、雨伞等；切勿选择洗衣机、大型家具等无关物体）！选好后点击右下角按钮提交。` +
            `</div>`
        );
    } else if (fullText.includes('wear inside') || fullText.includes('穿戴')) {
        parts.push(
            `<div class="captcha-prompt-guide">` +
            `操作指引：请观察右上角地点，在下方点击所有适合在当前场合穿戴的衣物/配饰（如泳衣、正装等）。选好后点击右下角按钮提交。` +
            `</div>`
        );
    } else if (fullText.includes('belongs in') || fullText.includes('场景归属')) {
        parts.push(
            `<div class="captcha-prompt-guide">` +
            `操作指引：请观察右上角地点，在下方点击所有通常属于该场所内部配置的物品。选好后点击右下角按钮提交。` +
            `</div>`
        );
    } else if (fullText.includes('water travel') || fullText.includes('水上交通')) {
        parts.push(
            `<div class="captcha-prompt-guide">` +
            `操作指引：请在下方选出所有航行于水上的船只、快艇或水上载具。选好后点击右下角按钮提交。` +
            `</div>`
        );
    } else if ((fullText.includes('same area') || fullText.includes('same environment') || fullText.includes('same place') || fullText.includes('交通环境匹配'))
        && fullText.includes('example') && /(?:travel|move|drive|fly|float|行驶|移动)/i.test(fullText)) {
        parts.push(
            `<div class="captcha-prompt-guide">` +
            `操作指引：请观察右上角示例是在水上、陆地还是空中行驶，然后在下方点击所有与示例处于同一行驶环境的物体。选好后点击右下角按钮提交。` +
            `</div>`
        );
    } else if (fullText.includes('drag') || fullText.includes('拖动') || fullText.includes('拖拽') || fullText.includes('slide') || (fullText.includes('fit') && !fullText.includes('fit inside'))) {
        parts.push(
            `<div class="captcha-prompt-guide">` +
            `操作指引：请按住目标元素拖动至虚线位置释放；若操作不便，可点击左下方「⟳」刷新按钮自动换题。` +
            `</div>`
        );
    } else if (fullText.includes('concealed') || fullText.includes('遮蔽') || fullText.includes('藏匿') || fullText.includes('完全遮盖')) {
        parts.push(
            `<div class="captcha-prompt-guide">` +
            `操作指引：请观察右上角所示物品，在下方点击所有【体积比它小、能被它完全盖住】的物体（注意：绝对不能选大象、长颈鹿、大鲸鱼等比它大的物体！）。选全后点击右下角按钮继续。` +
            `</div>`
        );
    } else if (fullText.includes('fit inside') || fullText.includes('装进')) {
        parts.push(
            `<div class="captcha-prompt-guide">` +
            `操作指引：请观察右上角所示物品，在下方点击所有【能完全装进它内部】的小物件。选全后点击右下角按钮继续。` +
            `</div>`
        );
    } else if (fullText.includes('different') || fullText.includes('不同') || fullText.includes('shapes that are different')) {
        parts.push(
            `<div class="captcha-prompt-guide">` +
            `操作指引：请观察图中的几何图形，找出其中与其他项形状/特征明显不同的目标点击选定，确认选好后务必点击右下角「Verify / 提交」按钮完成验证。` +
            `</div>`
        );
    } else if (fullText.includes('meet your eye') || fullText.includes('目光') || fullText.includes('对视')) {
        if (fullText.includes('not meet') || fullText.includes('不看向') || fullText.includes('避开')) {
            parts.push(
                `<div class="captcha-prompt-guide">` +
                `操作指引：请仔细观察动物的眼神与朝向，点击所有【没有直视你、看向其他方向或背对你】的动物。选全后点击右下角按钮继续。` +
                `</div>`
            );
        } else {
            parts.push(
                `<div class="captcha-prompt-guide">` +
                `操作指引：请仔细观察动物的眼神，点击所有【正在正视你、与你目光对视】的动物。选全后点击右下角按钮继续。` +
                `</div>`
            );
        }
    } else if (fullText.includes('on and off state') || fullText.includes('turned on and off') || fullText.includes('开关状态')) {
        parts.push(
            `<div class="captcha-prompt-guide">` +
            `操作指引：请在下方选出所有具备开启/关闭（On/Off）状态的物品（如手机、电脑、台灯等电子或带开关设备，排除水果、衣物等普通物品）。选全后务必点击右下角的「Verify / 提交」按钮完成验证。` +
            `</div>`
        );
    } else if (fullText.includes('count shown') || fullText.includes('示例及其数量') || fullText.includes('example and count')) {
        parts.push(
            `<div class="captcha-prompt-guide">` +
            `操作指引：请观察题目底部示例图与对应数量（如 1x 🐟、1x 🦔），在上方找出对应数量的目标点击。选全后点击右下角「Next / 下一步」（若是第 2 页则点击「Verify / 提交」）。` +
            `</div>`
        );
    } else {
        parts.push(
            `<div class="captcha-prompt-guide">` +
            `操作指引：请在下方选出所有符合条件的图片，确定选全后务必点击右下角的「Verify / 提交」按钮完成验证（多页验证请先点击右下角「Next / 下一步」）。` +
            `</div>`
        );
    }
    return parts.join('');
}

/**
 * 寻找当前页面中可见的人机验证元素并计算精确裁剪区域。
 * 严禁向充值用户发送包含银行卡、CVC、账单地址的完整收银台页面截图。
 * 仅当识别到人机验证弹层/复选框时，裁剪该独立区域透传给用户。
 */
async function findVisibleCaptchaClip(page) {
    let viewport = page.viewportSize();
    if (!viewport || !viewport.width || !viewport.height) {
        viewport = await page.evaluate(() => ({
            width: window.innerWidth || 1280,
            height: window.innerHeight || 800
        })).catch(() => ({ width: 1280, height: 800 }));
    }

    // 0. 优先遍历所有 frame 检查是否有活动的 challenge frame（直接检测 frame 元素与 body）
    for (const frame of page.frames()) {
        const u = String(frame.url() || '').toLowerCase();
        if (isInvisibleStripeHcaptchaUrl(u)) continue;
        if (u.includes('frame=challenge') || (u.includes('hcaptcha') && !u.includes('invisible') && !u.includes('frame=checkbox'))) {
            try {
                const frameEl = await frame.frameElement().catch(() => null);
                if (frameEl && !(await frameEl.isVisible().catch(() => false))) {
                    continue;
                }
                let box = null;
                if (frameEl) {
                    box = await frameEl.boundingBox().catch(() => null);
                }
                const bodyLoc = frame.locator('body');
                if (!box || box.width < 50 || box.height < 50) {
                    box = await bodyLoc.boundingBox({ timeout: 400 }).catch(() => null);
                }
                if (box && box.width >= 50 && box.height >= 30) {
                    const promptEn = await extractHcaptchaChallengePrompt(frame, page).catch(() => '');
                    const hasChallengeElements = await frame.locator('.challenge-container, .button-submit, .task-grid, canvas, .challenge-view, iframe[src*="hcaptcha.html"]').count().catch(() => 0) > 0;
                    if (!promptEn && !hasChallengeElements) {
                        continue;
                    }
                    const promptZh = translateHcaptchaPrompt(promptEn);
                    if (/套餐|升级|账单|订阅|upgrade|billing/i.test(promptZh || promptEn)) {
                        continue;
                    }

                    // 顶底绝对视口双锚定算法：确保顶部深青色条与底部控制栏 100% 完整捕获，绝不切顶或切底！
                    let clipTop = box.y;
                    let clipBottom = box.y + box.height;

                    try {
                        // 寻找顶部青色横幅容器，以其实际视口 y 坐标往上 14px 为起点，彻底解决顶部被裁切的问题
                        const headerEl = frame.locator('h2, .prompt-text, .challenge-header, [data-theme="challenge-container"] header, .prompt-text-container').first();
                        if (await headerEl.isVisible({ timeout: 150 }).catch(() => false)) {
                            const headerBbox = await headerEl.boundingBox().catch(() => null);
                            if (headerBbox && headerBbox.y > 0) {
                                clipTop = Math.min(clipTop, headerBbox.y - 14);
                            }
                        }
                    } catch (_) {}

                    try {
                        // 寻找底部操作条（Verify / Skip / Next / 刷新按钮），确保完整包含到底部
                        const footerEl = frame.locator('.button-submit, [aria-label*="skip" i], button:has-text("Skip"), button:has-text("Next"), button:has-text("Verify"), .refresh, .reload').first();
                        if (await footerEl.isVisible({ timeout: 150 }).catch(() => false)) {
                            const footerBbox = await footerEl.boundingBox().catch(() => null);
                            if (footerBbox && footerBbox.y > 0 && footerBbox.height > 0) {
                                clipBottom = Math.max(clipBottom, footerBbox.y + footerBbox.height + 18);
                            }
                        }
                    } catch (_) {}

                    // 深度测量内部真实 scrollHeight 保护
                    try {
                        const frameScrollHeight = await frame.evaluate(() => {
                            const b = document.body ? Math.max(document.body.scrollHeight, document.body.offsetHeight) : 0;
                            const d = document.documentElement ? Math.max(document.documentElement.scrollHeight, document.documentElement.offsetHeight) : 0;
                            const c = document.querySelector('.challenge-container') ? document.querySelector('.challenge-container').scrollHeight : 0;
                            return Math.max(b, d, c);
                        }).catch(() => 0);
                        if (frameScrollHeight && (clipTop + frameScrollHeight + 20) > clipBottom) {
                            clipBottom = clipTop + frameScrollHeight + 20;
                        }
                    } catch (_) {}

                    if (clipBottom - clipTop < 580) {
                        clipBottom = clipTop + 590;
                    }

                    const padX = 6;
                    const x = Math.max(0, Math.floor(box.x - padX));
                    const y = Math.max(0, Math.floor(clipTop));
                    const width = Math.min(viewport.width - x, Math.ceil(box.width + padX * 2));
                    const height = Math.min(viewport.height - y, Math.ceil(clipBottom - y));
                    return {
                        clip: { x, y, width, height },
                        title: promptZh || '人机验证',
                        message: formatCaptchaGuideMessage(promptZh, promptEn),
                        promptZh,
                        promptEn,
                        type: 'challenge',
                        frame,
                        frameElementLocator: frameEl || null,
                        frameElementHandle: frameEl || null,
                        frameBodyLocator: bodyLoc
                    };
                }
            } catch (_) {}
        }
    }

    // 1. 寻找可见的 hCaptcha challenge 图片九宫格 / 选图题弹层
    const challengeSelectors = [
        'iframe[src*="frame=challenge"]',
        'iframe[title*="Main content of the hCaptcha challenge" i]',
        'iframe[title*="hCaptcha challenge" i]',
        'div.challenge-container:has(iframe)',
        'div[data-theme="challenge-container"]'
    ];
    for (const sel of challengeSelectors) {
        try {
            const locators = await page.locator(sel).all().catch(() => []);
            for (const loc of locators) {
                if (await loc.isVisible({ timeout: 200 }).catch(() => false)) {
                    // 安全过滤：绝对不能把收银台、套餐、卡片信息或抽屉误当成人机验证弹窗截取！
                    const locText = String(await loc.innerText({ timeout: 200 }).catch(() => '') || '');
                    if (/设置您的套餐|Pro 套餐|Pro 按|账单信息|订阅|无法完成此|payment method|billing address|升级|upgrade/i.test(locText)) {
                        continue;
                    }
                    const box = await loc.boundingBox().catch(() => null);
                    if (box && box.width >= 60 && box.height >= 40) {
                        let promptEn = '';
                        let matchedFrame = null;
                        try {
                            matchedFrame = await loc.contentFrame().catch(() => null);
                            if (!matchedFrame) {
                                const subFrames = page.frames().filter(f => isHcaptchaChallengeFrameUrl(f.url()));
                                if (subFrames.length > 0) {
                                    matchedFrame = subFrames[0];
                                }
                            }
                            if (matchedFrame) {
                                promptEn = await extractHcaptchaChallengePrompt(matchedFrame, page).catch(() => '');
                            } else {
                                promptEn = await extractHcaptchaChallengePrompt(null, page).catch(() => '');
                            }
                        } catch (_) {}
                        const promptZh = translateHcaptchaPrompt(promptEn);
                        if (/套餐|升级|账单|订阅|upgrade|billing/i.test(promptZh || promptEn)) {
                            continue;
                        }

                        // 顶底绝对视口双锚定算法：确保顶部深青色条与底部控制栏 100% 完整捕获
                        let clipTop = box.y;
                        let clipBottom = box.y + box.height;

                        if (matchedFrame) {
                            try {
                                const headerEl = matchedFrame.locator('h2, .prompt-text, .challenge-header, [data-theme="challenge-container"] header, .prompt-text-container').first();
                                if (await headerEl.isVisible({ timeout: 150 }).catch(() => false)) {
                                    const headerBbox = await headerEl.boundingBox().catch(() => null);
                                    if (headerBbox && headerBbox.y > 0) {
                                        clipTop = Math.min(clipTop, headerBbox.y - 14);
                                    }
                                }
                            } catch (_) {}

                            try {
                                const footerEl = matchedFrame.locator('.button-submit, [aria-label*="skip" i], button:has-text("Skip"), button:has-text("Next"), button:has-text("Verify"), .refresh, .reload').first();
                                if (await footerEl.isVisible({ timeout: 150 }).catch(() => false)) {
                                    const footerBbox = await footerEl.boundingBox().catch(() => null);
                                    if (footerBbox && footerBbox.y > 0 && footerBbox.height > 0) {
                                        clipBottom = Math.max(clipBottom, footerBbox.y + footerBbox.height + 18);
                                    }
                                }
                            } catch (_) {}

                            try {
                                const frameScrollHeight = await matchedFrame.evaluate(() => {
                                    const b = document.body ? Math.max(document.body.scrollHeight, document.body.offsetHeight) : 0;
                                    const d = document.documentElement ? Math.max(document.documentElement.scrollHeight, document.documentElement.offsetHeight) : 0;
                                    const c = document.querySelector('.challenge-container') ? document.querySelector('.challenge-container').scrollHeight : 0;
                                    return Math.max(b, d, c);
                                }).catch(() => 0);
                                if (frameScrollHeight && (clipTop + frameScrollHeight + 20) > clipBottom) {
                                    clipBottom = clipTop + frameScrollHeight + 20;
                                }
                            } catch (_) {}
                        }

                        if (clipBottom - clipTop < 580) {
                            clipBottom = clipTop + 590;
                        }

                        const padX = 6;
                        const x = Math.max(0, Math.floor(box.x - padX));
                        const y = Math.max(0, Math.floor(clipTop));
                        const width = Math.min(viewport.width - x, Math.ceil(box.width + padX * 2));
                        const height = Math.min(viewport.height - y, Math.ceil(clipBottom - y));
                        let matchedFrameEl = null;
                        if (matchedFrame) {
                            matchedFrameEl = await matchedFrame.frameElement().catch(() => null);
                        }
                        if (!matchedFrameEl) {
                            matchedFrameEl = await loc.elementHandle().catch(() => null);
                        }
                        return {
                            clip: { x, y, width, height },
                            title: promptZh || '人机验证',
                            message: formatCaptchaGuideMessage(promptZh, promptEn),
                            promptZh,
                            promptEn,
                            type: 'challenge',
                            frame: matchedFrame,
                            frameElementHandle: matchedFrameEl || null,
                            frameElementLocator: loc || matchedFrameEl || null
                        };
                    }
                }
            }
        } catch (_) {}
    }

    // 2. 寻找明确带有 "One more step" 或人机验证文字的弹窗 / 对话框容器（严禁误匹配主收银台抽屉）
    const modalDialogSelectors = [
        'div[role="dialog"]:has-text("One more step"):has(iframe)',
        'div[role="dialog"]:has-text("Select the checkbox"):has(iframe)',
        'div[role="dialog"]:has-text("I am human"):has(iframe)',
        'div[role="dialog"]:has-text("Verify you are human"):has(iframe)',
        'div:has-text("One more step"):has(iframe)',
        'div:has-text("Select the checkbox"):has(iframe)',
        'div:has-text("I am human"):has(iframe)'
    ];
    for (const sel of modalDialogSelectors) {
        try {
            const locators = await page.locator(sel).all().catch(() => []);
            for (const loc of locators) {
                if (await loc.isVisible({ timeout: 200 }).catch(() => false)) {
                    // 安全过滤：绝对不能把包含收银台、套餐、卡片信息的抽屉误当成人机验证弹窗截取！
                    const dialogText = String(await loc.innerText({ timeout: 250 }).catch(() => '') || '');
                    if (/设置您的套餐|Pro 套餐|Pro 按|账单信息|订阅|无法完成此|payment method|billing address|升级|upgrade/i.test(dialogText)) {
                        continue;
                    }
                    const box = await loc.boundingBox().catch(() => null);
                    if (box && box.width >= 100 && box.width <= 750 && box.height >= 50 && box.height <= 600) {
                        const x = Math.max(0, Math.floor(box.x));
                        const y = Math.max(0, Math.floor(box.y));
                        const width = Math.min(viewport.width - x, Math.ceil(box.width));
                        const height = Math.min(viewport.height - y, Math.ceil(box.height));
                        return {
                            clip: { x, y, width, height },
                            title: '请协助勾选人机验证',
                            message: '请点击下方复选框完成「我是人类 / One more step」安全验证',
                            type: 'checkbox_modal'
                        };
                    }
                }
            }
        } catch (_) {}
    }

    // 3. 寻找单独的 hCaptcha checkbox frame / Cloudflare Turnstile
    const checkboxSelectors = [
        'iframe[src*="frame=checkbox"]',
        'iframe[title*="checkbox for hCaptcha" i]',
        'iframe[src*="challenges.cloudflare"]',
        'iframe[src*="turnstile"]',
        '.cf-turnstile iframe',
        '#challenge-stage'
    ];
    for (const sel of checkboxSelectors) {
        try {
            const locators = await page.locator(sel).all().catch(() => []);
            for (const loc of locators) {
                if (await loc.isVisible({ timeout: 200 }).catch(() => false)) {
                    const box = await loc.boundingBox().catch(() => null);
                    if (box && box.width >= 50 && box.height >= 25) {
                        const pad = 16;
                        const x = Math.max(0, Math.floor(box.x - pad));
                        const y = Math.max(0, Math.floor(box.y - pad));
                        const width = Math.min(viewport.width - x, Math.ceil(box.width + pad * 2));
                        const height = Math.min(viewport.height - y, Math.ceil(box.height + pad * 2));
                        return {
                            clip: { x, y, width, height },
                            title: '请点击复选框完成验证',
                            message: '请点击下方复选框完成人机身份验证',
                            type: 'checkbox_frame'
                        };
                    }
                }
            }
        } catch (_) {}
    }

    // 4. 检查是否为全页 Cloudflare 拦截页（OpenAI / Cloudflare 拦截且非 checkout 页面）
    if (await isCloudflareWallPage(page)) {
        const cx = Math.max(0, Math.floor(viewport.width * 0.15));
        const cy = Math.max(0, Math.floor(viewport.height * 0.1));
        const cw = Math.min(viewport.width - cx, Math.floor(viewport.width * 0.7));
        const ch = Math.min(viewport.height - cy, Math.floor(viewport.height * 0.8));
        return {
            clip: { x: cx, y: cy, width: cw, height: ch },
            title: '请完成 Cloudflare 验证',
            message: '请点击下方画面中的「Verify you are human」完成验证',
            type: 'cloudflare_wall'
        };
    }

    // 严禁泄露：若页面上没有检测到任何合法的人机验证元素，绝对不截图返回
    return null;
}

/**
 * 判断是否为拖拽型题目（如 "Drag the letter to the place where it fits"）
 */
function isDragChallenge(targetInfo) {
    if (!targetInfo) return false;
    const combined = `${targetInfo.promptEn || ''} ${targetInfo.promptZh || ''} ${targetInfo.title || ''}`.toLowerCase();
    return /\bdrag(?:ging)?\b|拖动|拖拽|拖曳|\bslide\s+(?:the\s+)?slider\b|滑动滑块|\b(?:letter|shape|piece|object)\b.*\b(?:where it fits|to the matching outline|to complete the pair)\b/i.test(combined);
}

/**
 * 通过官方刷新按钮换题。自动筛选题型时禁止使用猜测坐标。
 */
async function reloadHcaptchaChallenge(page, targetInfo, options = {}) {
    if (!targetInfo) return false;

    // 1. 优先搜集所有可能的 challenge frame（首选 targetInfo.frame）
    const framesToTry = [];
    if (targetInfo.frame && !targetInfo.frame.isDetached()) {
        framesToTry.push(targetInfo.frame);
    }
    for (const f of page.frames()) {
        if (!f.isDetached() && !framesToTry.includes(f) && isHcaptchaChallengeFrameUrl(f.url())) {
            framesToTry.push(f);
        }
    }

    // 2. 在目标 frame 内部精准执行 DOM 点击刷新按钮（绝不误触 Skip / Verify）
    for (const frame of framesToTry) {
        try {
            const clicked = await frame.evaluate(({ allowCoordinateFallback }) => {
                const selectors = [
                    '.refresh',
                    '.reload',
                    'div.refresh.button',
                    'div.reload.button',
                    '[aria-label*="refresh" i]',
                    '[aria-label*="reload" i]',
                    '[aria-label*="new challenge" i]',
                    '[title*="refresh" i]',
                    '[title*="reload" i]',
                    '[title*="new challenge" i]'
                ];
                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el) {
                        if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
                        const txt = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase();
                        if (/skip|next|verify|提交|下一步|跳过/i.test(txt)) continue;
                        if (el.offsetParent !== null || el.getBoundingClientRect().width > 0) {
                            el.click();
                            return true;
                        }
                    }
                }

                if (!allowCoordinateFallback) return false;
                // 检查底部控制栏中处于刷新位置 (宽度的 18% ~ 42% 之间，高度底部 25%) 的可点击元素
                const w = window.innerWidth || document.documentElement.clientWidth || 400;
                const h = window.innerHeight || document.documentElement.clientHeight || 600;
                const clickables = Array.from(document.querySelectorAll('div[role="button"], button, [tabindex="0"], div.button'));
                for (const btn of clickables) {
                    const rect = btn.getBoundingClientRect();
                    if (rect.top >= h * 0.75 && rect.height > 10 && rect.height < 60) {
                        if (rect.left >= w * 0.18 && rect.right <= w * 0.44) {
                            const txt = (btn.innerText || btn.getAttribute('aria-label') || '').toLowerCase();
                            if (!/skip|next|verify|提交|下一步|跳过/i.test(txt)) {
                                btn.click();
                                return true;
                            }
                        }
                    }
                }
                return false;
            }, { allowCoordinateFallback: options.allowCoordinateFallback !== false }).catch(() => false);

            if (clicked) {
                return true;
            }

            // 备用：通过 Playwright locator 显式点击
            const reloadLocators = [
                frame.locator('[aria-label*="reload" i], [aria-label*="refresh" i], [title*="reload" i], [title*="refresh" i], .reload, .refresh, div.refresh.button').first()
            ];
            for (const loc of reloadLocators) {
                if (await loc.isVisible({ timeout: 250 }).catch(() => false)) {
                    const clicked = await loc.click({ timeout: 1000 }).then(() => true).catch(() => false);
                    if (clicked) return true;
                }
            }
        } catch (_) {}
    }

    // 3. 尝试在主页面或 iframe 包装器中查找
    try {
        const reloadBtn = page.locator('iframe[title*="hCaptcha challenge" i], iframe[src*="captcha"]').contentFrame()
            .locator('[aria-label*="reload" i], [aria-label*="refresh" i], [title*="reload" i], [title*="refresh" i], .reload, .refresh, div.refresh.button').first();
        if (await reloadBtn.isVisible({ timeout: 250 }).catch(() => false)) {
            const clicked = await reloadBtn.click({ timeout: 1000 }).then(() => true).catch(() => false);
            if (clicked) return true;
        }
    } catch (_) {}

    // 4. 兜底视口物理坐标精准点击：位于底部工具栏圆圈刷新箭头 (x: ~31%, y: ~93%)，绝不点 18%（菜单）或 85%（Skip）
    if (options.allowCoordinateFallback !== false && targetInfo.clip) {
        const rx = Math.round(targetInfo.clip.x + targetInfo.clip.width * 0.31);
        const ry = Math.round(targetInfo.clip.y + targetInfo.clip.height * 0.93);
        try {
            await humanClickAt(page, rx, ry);
            return true;
        } catch (_) {}
    }
    return false;
}

/**
 * 在素材与DOM完全就绪后，基于真实 iframe 元素动态测量并锚定完整弹窗区域
 * 无论题目类型（单图几何、九宫格、十六宫格），确保青色横幅与操作控制栏 100% 完整无遮挡
 */
async function refreshCaptchaGeometry(page, targetInfo) {
    if (!targetInfo) return targetInfo;
    try {
        let viewport = page.viewportSize();
        if (!viewport || !viewport.width || !viewport.height) {
            viewport = await page.evaluate(() => ({
                width: window.innerWidth || 1280,
                height: window.innerHeight || 800
            })).catch(() => ({ width: 1280, height: 800 }));
        }

        // 0. 重置 iframe 内部可能存在的滚动偏移，确保顶部横幅始终贴合顶边 (scrollTop=0)
        if (targetInfo.frame) {
            try {
                await targetInfo.frame.evaluate(() => {
                    window.scrollTo(0, 0);
                    if (document.documentElement) document.documentElement.scrollTop = 0;
                    if (document.body) document.body.scrollTop = 0;
                    const c = document.querySelector('.challenge-container, [data-theme="challenge-container"], .challenge-view');
                    if (c) c.scrollTop = 0;
                });
            } catch (_) {}
        }

        // 1. 获取 frameElement（即外部 <iframe>）
        let frameEl = targetInfo.frameElementHandle || null;
        if (!frameEl && targetInfo.frame) {
            frameEl = await targetInfo.frame.frameElement().catch(() => null);
            targetInfo.frameElementHandle = frameEl;
        }

        let frameBox = null;
        if (frameEl) {
            frameBox = await frameEl.boundingBox().catch(() => null);
        }

        let bodyBox = null;
        if (targetInfo.frame) {
            bodyBox = await targetInfo.frame.locator('body').boundingBox().catch(() => null);
        }

        // 2. 测量顶部大标题/青色横幅真实视口位置，双重保障绝不切顶
        let headerTop = null;
        if (targetInfo.frame) {
            try {
                const headerEl = targetInfo.frame.locator('h2, .prompt-text, .challenge-header, [data-theme="challenge-container"] header, .prompt-text-container').first();
                if (await headerEl.isVisible({ timeout: 150 }).catch(() => false)) {
                    const headerBbox = await headerEl.boundingBox().catch(() => null);
                    if (headerBbox && headerBbox.y > 0) {
                        headerTop = headerBbox.y - 24;
                    }
                }
            } catch (_) {}
        }

        // 3. 测量底部操作控制栏（Verify / Skip / Reload）真实视口位置，双重保障绝不切底
        let footerBottom = null;
        if (targetInfo.frame) {
            try {
                const footerEl = targetInfo.frame.locator('.button-submit, .challenge-interface, .challenge-toolbar, [aria-label*="skip" i], button:has-text("Verify"), button:has-text("Submit"), button:has-text("Next"), button:has-text("Skip"), .reload, .refresh').first();
                if (await footerEl.isVisible({ timeout: 150 }).catch(() => false)) {
                    const footerBbox = await footerEl.boundingBox().catch(() => null);
                    if (footerBbox && footerBbox.y > 0 && footerBbox.height > 0) {
                        footerBottom = footerBbox.y + footerBbox.height + 24;
                    }
                }
            } catch (_) {}
        }

        let topY = frameBox ? frameBox.y : (bodyBox ? bodyBox.y : (targetInfo.clip ? targetInfo.clip.y : 0));
        if (headerTop !== null) {
            topY = Math.min(topY, headerTop);
        }

        let bottomY = frameBox ? (frameBox.y + frameBox.height) : (topY + 600);
        if (footerBottom !== null) {
            bottomY = Math.max(bottomY, footerBottom);
        }
        if (bottomY - topY < 600) {
            bottomY = topY + 610;
        }

        const baseBox = frameBox || bodyBox || targetInfo.clip;
        const padX = 6;
        const leftX = Math.max(0, Math.floor((baseBox ? baseBox.x : 0) - padX));
        const width = baseBox ? Math.ceil(baseBox.width + padX * 2) : 420;
        const height = Math.ceil(bottomY - topY);

        targetInfo.clip = {
            x: leftX,
            y: Math.max(0, Math.floor(topY)),
            width: Math.min(viewport.width - leftX, width),
            height: Math.min(viewport.height - Math.max(0, Math.floor(topY)), height)
        };
    } catch (_) {}
    return targetInfo;
}

// 执行用户请求的验证提交，优先使用官方按钮的实时位置。
async function clickInteractiveCaptchaSubmit(page, targetInfo, submitPoint) {
    // 只在已识别的验证 iframe 内定位，避免把支付按钮误当成验证提交。
    if (targetInfo.frame) {
        for (const selector of ['.button-submit', 'button:has-text("Verify"), button:has-text("Next"), button:has-text("Skip"), [role="button"][aria-label*="verify" i]']) {
            const button = targetInfo.frame.locator(selector).first();
            if (!await button.isVisible({ timeout: 150 }).catch(() => false)) continue;
            try {
                await button.click({ timeout: 2000 });
                return;
            } catch (_) {}
        }
    }
    // 未识别按钮时按用户坐标点击；选图后 iframe 可能移动，重新测量边界。
    const frameElement = targetInfo.frameElementHandle;
    const clip = (frameElement && await frameElement.boundingBox().catch(() => null)) || targetInfo.clip;
    const x = Math.round(clip.x + Number(submitPoint.ratioX) * clip.width);
    const y = Math.round(clip.y + Number(submitPoint.ratioY) * clip.height);
    await page.mouse.click(x, y);
}

/**
 * 仅裁剪验证区域供用户交互，严禁透传包含卡号、CVC、账单地址的收银台页面。
 */
async function attemptInteractiveUserCaptcha(page, phase = 'interactive', options = {}) {
    const jobKey = options.jobKey || process.env.JOB_KEY;
    if (!jobKey) {
        captchaLog(phase, '未配置 JOB_KEY，跳过前端交互式人机验证透传', 'info');
        return false;
    }

    if (process.env.INTERACTIVE_CAPTCHA_ENABLED === 'false') {
        captchaLog(phase, 'INTERACTIVE_CAPTCHA_ENABLED=false，已禁用交互式透传', 'info');
        return false;
    }

    const serverPort = process.env.PORT || 3100;
    const baseUrl = `http://127.0.0.1:${serverPort}`;
    const verifyOpts = options.verifyOpts || {};
    const timeoutMs = Number(options.maxWaitMs || process.env.CAPTCHA_INTERACTIVE_TIMEOUT_MS || 90000);
    const deadline = Date.now() + timeoutMs;

    captchaLog(phase, `[Interactive] 启动前端交互式人机验证透传（jobKey=${jobKey}，最长 ${Math.round(timeoutMs / 1000)}s）...`);

    let clickCount = 0;
    let autoReloadCount = 0;
    let userRefreshCount = 0;
    let lastRefreshTs = 0;
    let noTargetCount = 0;
    let lastLoadingLogTs = 0;
    async function replaceDragChallenge(targetInfo) {
        if (!isDragChallenge(targetInfo)) return false;
        // 不透传拖动题的截图；换题与用户操作共用原会话截止时间。
        await axios.post(`${baseUrl}/api/internal/captcha-prompt`, {
            jobKey, image: null, loading: true, contentReady: false,
            expiresAt: deadline,
            title: '正在更换题型…',
            message: '正在为你切换到点选题，请稍候。'
        }, { timeout: 5000 }).catch(() => {});
        const cooldownMs = Math.max(0, 2000 - (Date.now() - lastRefreshTs));
        if (cooldownMs) await page.waitForTimeout(Math.min(cooldownMs, Math.max(0, deadline - Date.now())));
        if (Date.now() >= deadline) return true;
        lastRefreshTs = Date.now();
        const reloaded = await reloadHcaptchaChallenge(page, targetInfo, { allowCoordinateFallback: false });
        if (reloaded) {
            autoReloadCount += 1;
            captchaLog(phase, `[Interactive] 检测到拖动题，已通过官方刷新按钮申请点选题（第 ${autoReloadCount} 次，无次数配额）`);
        } else {
            captchaLog(phase, '[Interactive] 检测到拖动题，但官方刷新按钮暂不可用；继续等待并重试，不推送拖动题图', 'warn');
        }
        await page.waitForTimeout(Math.min(2000, Math.max(0, deadline - Date.now())));
        return true;
    }
    // 用户操作只受会话时间约束；选图、换题和多页提交不消耗次数配额。
    while (Date.now() < deadline) {
        if (await isVerificationCleared(page, verifyOpts)) {
            captchaLog(phase, '[Interactive] 验证已通过，退出交互透传');
            await axios.post(`${baseUrl}/api/internal/captcha-status`, { jobKey, cleared: true }, { timeout: 5000 }).catch(() => {});
            return true;
        }

        // 定位当前可见的验证区域（严禁全页截屏）
        let targetInfo = await findVisibleCaptchaClip(page);
        if (!targetInfo) {
            await page.waitForTimeout(1000);
            if (await isVerificationCleared(page, verifyOpts)) {
                captchaLog(phase, '[Interactive] 验证已自行通过');
                await axios.post(`${baseUrl}/api/internal/captcha-status`, { jobKey, cleared: true }, { timeout: 5000 }).catch(() => {});
                return true;
            }
            targetInfo = await findVisibleCaptchaClip(page);
            if (!targetInfo && (await isCheckoutOverlayCaptchaVisible(page))) {
                await clickHcaptchaCheckboxFrames(page, `${phase}-retrigger`);
                await page.waitForTimeout(1000);
                targetInfo = await findVisibleCaptchaClip(page);
            }
        }

        // 关键状态检查 1：若收银台已明确提示“无法验证您的浏览器”，说明官方风控直接拦截，人机验证已失败并关闭，立即熔断！
        try {
            const browserVerifyFailedLoc = page.getByText(/无法验证.*浏览器|unable to verify your browser|failed to verify your browser|未能验证.*浏览器/i).first();
            if (await browserVerifyFailedLoc.isVisible({ timeout: 150 }).catch(() => false)) {
                const failText = String(await browserVerifyFailedLoc.innerText().catch(() => '') || '官方收银台提示：我们无法验证您的浏览器').trim();
                captchaLog(phase, `[Interactive] 官方收银台已明确提示浏览器验证失败（${failText}），立即熔断退出交互透传`);
                await axios.post(`${baseUrl}/api/internal/captcha-status`, {
                    jobKey,
                    cleared: false,
                    failed: true,
                    reason: 'browser_verification_failed',
                    message: '官方浏览器安全验证未通过（我们无法验证您的浏览器）。卡密资产未核销并已自动回滚，请稍后重试'
                }, { timeout: 5000 }).catch(() => {});
                return {
                    cleared: false,
                    browserVerificationFailed: true,
                    failMsg: '官方浏览器安全验证未通过（我们无法验证您的浏览器）。卡密资产未核销并已自动回滚，请稍后重试'
                };
            }
        } catch (_) {}

        // 关键状态检查 2：若页面已显示“无法完成此次购买”等拒付信息，说明人机验证已通过，支付被银行/Stripe拒绝，立即结束交互协助
        try {
            const declineLoc = page.getByText(/无法完成此(次)?购买|unable to complete this purchase|未能完成购买|your card was declined|card was declined/i).first();
            if (await declineLoc.isVisible({ timeout: 200 }).catch(() => false)) {
                const declineText = String(await declineLoc.innerText().catch(() => '') || '无法完成此次购买').trim();
                captchaLog(phase, `[Interactive] 收银台已明确提示拒付（${declineText}），人机验证实际已通过，立即结束协助并转交卡池换卡`);
                await axios.post(`${baseUrl}/api/internal/captcha-status`, { jobKey, cleared: true }, { timeout: 5000 }).catch(() => {});
                return { cleared: true, paymentDeclined: true, declineMsg: declineText };
            }
        } catch (_) {}

        if (!targetInfo) {
            noTargetCount += 1;
            captchaLog(phase, `[Interactive] 当前无可见人机验证弹窗 (${noTargetCount}/5)，严禁推送收银台页面（防止泄露卡密信息）`, 'info');
            if (noTargetCount >= 5) {
                captchaLog(phase, '[Interactive] 连续 5 次未检测到可见验证弹窗，判定当前无阻断性人机验证，安全退出交互透传', 'warn');
                await axios.post(`${baseUrl}/api/internal/captcha-status`, { jobKey, cleared: true }, { timeout: 5000 }).catch(() => {});
                return { cleared: true, skipped: true, via: 'no-visible-captcha-timeout' };
            }
            try {
                await axios.post(`${baseUrl}/api/internal/captcha-prompt`, {
                    jobKey,
                    image: null,
                    loading: true,
                    contentReady: false,
                    expiresAt: deadline,
                    title: '正在等待安全验证加载...',
                    message: '正在检测官方人机验证弹窗，请稍候...'
                }, { timeout: 5000 });
            } catch (_) {}
            await page.waitForTimeout(2000);
            continue;
        } else {
            noTargetCount = 0;
        }

        // 素材未全部就绪时只发送加载状态，不能把空白题图作为可操作画面。
        let contentReady = true;
        let contentStatus = { ready: true, reason: 'no_image_frame' };
        if (targetInfo.frame) {
            contentStatus = await waitForCaptchaContentReady(targetInfo.frame, 2500, targetInfo.promptEn);
            contentReady = contentStatus.ready;
            if (!contentReady && Date.now() - lastLoadingLogTs >= 10000) {
                lastLoadingLogTs = Date.now();
                const count = contentStatus.total ? `，已加载 ${contentStatus.loaded}/${contentStatus.total}` : '';
                captchaLog(phase, `[Interactive] 题图未完整就绪（${contentStatus.reason}${count}），继续等待素材，不发送空白题图`);
            }
        }

        await page.waitForTimeout(250); // 渲染与动画稳定缓冲

        // 核心优化 2：重置滚动条并在内容就绪后动态双锚定测量真实几何边界
        targetInfo = await refreshCaptchaGeometry(page, targetInfo);

        // 核心优化 3：每次必须从当前 frame 提取最新题目并翻译，确保题目与画面严格一致，杜绝上一题残留！
        if (targetInfo.frame) {
            let freshPromptEn = '';
            for (let r = 0; r < 3; r++) {
                freshPromptEn = await extractHcaptchaChallengePrompt(targetInfo.frame, page).catch(() => '');
                if (freshPromptEn) break;
                await page.waitForTimeout(200);
            }
            if (freshPromptEn) {
                targetInfo.promptEn = freshPromptEn;
                targetInfo.promptZh = translateHcaptchaPrompt(freshPromptEn);
                targetInfo.message = formatCaptchaGuideMessage(targetInfo.promptZh, targetInfo.promptEn);
                targetInfo.title = targetInfo.promptZh || '人机验证';
            }
        }

        // 依据刚读取的题目识别题型，取消原先最多自动换两次的限制。
        if (await replaceDragChallenge(targetInfo)) continue;
        if (Date.now() >= deadline) break;

        // 仅截图已识别的验证区域；加载状态不发送旋转圈或缺图截图。
        let currentClip = targetInfo.clip;
        let screenshotBase64 = null;
        if (contentReady) try {
            let buf = null;

            // 元素截图与点击坐标使用同一个 iframe 边界。
            let frameEl = targetInfo.frameElementHandle || null;
            if (!frameEl && targetInfo.frame) {
                frameEl = await targetInfo.frame.frameElement().catch(() => null);
                targetInfo.frameElementHandle = frameEl;
            }

            if (frameEl) {
                try {
                    buf = await frameEl.screenshot({
                        type: 'jpeg',
                        quality: 88,
                        timeout: 3000
                    }).catch(() => null);
                    if (buf) {
                        const fb = await frameEl.boundingBox().catch(() => null);
                        if (fb && fb.width >= 100 && fb.height >= 150) {
                            currentClip = fb;
                            targetInfo.clip = fb;
                        }
                    }
                } catch (_) {}
            }

            // 备选 1：若元素级截屏不可用，使用视口双锚定裁剪
            if (!buf && currentClip && currentClip.width > 50 && currentClip.height > 50) {
                buf = await page.screenshot({
                    type: 'jpeg',
                    quality: 88,
                    clip: currentClip
                }).catch(() => null);
            }

            // 备选 2：尝试 Locator 截屏
            if (!buf && targetInfo.frameElementLocator) {
                buf = await targetInfo.frameElementLocator.screenshot({
                    type: 'jpeg',
                    quality: 88,
                    timeout: 2500
                }).catch(() => null);
            }

            if (!buf) {
                buf = await page.screenshot({
                    type: 'jpeg',
                    quality: 88,
                    clip: currentClip
                });
            }
            screenshotBase64 = `data:image/jpeg;base64,${buf.toString('base64')}`;
            if (targetInfo.frame) {
                // 截图期间换题/素材仍可能变化，推送前再次检查。
                contentStatus = await inspectCaptchaContent(targetInfo.frame, targetInfo.promptEn);
                contentReady = contentStatus.ready;
                if (!contentReady) screenshotBase64 = null;
                const latestPrompt = await extractHcaptchaChallengePrompt(targetInfo.frame, page).catch(() => '');
                // 截图时题型可能切换；丢弃旧截图，下一轮重新识别再透传。
                if (latestPrompt && latestPrompt !== targetInfo.promptEn) continue;
            }
        } catch (err) {
            captchaLog(phase, `[Interactive] 验证区域裁剪截图失败: ${err.message}`, 'warn');
            await page.waitForTimeout(1500);
            continue;
        }

        // 推送精准裁剪后的验证画面至前端（用户仅能看到验证码本身，并填满前端视窗）
        try {
            await axios.post(`${baseUrl}/api/internal/captcha-prompt`, {
                jobKey,
                image: screenshotBase64,
                loading: !contentReady,
                contentReady,
                expiresAt: deadline,
                width: currentClip.width,
                height: currentClip.height,
                title: targetInfo.title,
                message: contentReady ? targetInfo.message : '官方题图尚未完整加载，系统正在重试。请稍候，或点击「换一题」。',
                promptZh: targetInfo.promptZh || '',
                promptEn: targetInfo.promptEn || ''
            }, { timeout: 8000 });
        } catch (err) {
            captchaLog(phase, `[Interactive] 推送验证画面失败: ${err.message}`, 'warn');
        }

        // 挂起等待前端用户点击（长轮询）
        // 加载截图必须及时替换，不能在一张旋转圈截图上长轮询 30 秒。
        const waitTimeoutMs = Math.min(contentReady ? 30000 : 1500, deadline - Date.now());
        if (waitTimeoutMs <= 0) break;

        let waitResult = null;
        try {
            const res = await axios.get(`${baseUrl}/api/internal/captcha-wait-click/${jobKey}?timeout=${waitTimeoutMs}`, {
                timeout: waitTimeoutMs + 5000
            });
            waitResult = res.data;
        } catch (err) {
            waitResult = { clicked: false, timeout: true };
        }

        if (waitResult && waitResult.clicked) {
            if (waitResult.action === 'drag') {
                clickCount += 1;
                const fromX = Math.round(currentClip.x + Number(waitResult.fromRatioX || 0) * currentClip.width);
                const fromY = Math.round(currentClip.y + Number(waitResult.fromRatioY || 0) * currentClip.height);
                const toX = Math.round(currentClip.x + Number(waitResult.toRatioX || 0) * currentClip.width);
                const toY = Math.round(currentClip.y + Number(waitResult.toRatioY || 0) * currentClip.height);

                captchaLog(phase, `[Interactive] 收到前端用户拖拽手势: 视口坐标(${fromX}, ${fromY}) -> (${toX}, ${toY})`);

                try {
                    await humanMouseMove(page, fromX, fromY);
                    await page.waitForTimeout(randomBetween(60, 120));
                    await page.mouse.down();
                    await page.waitForTimeout(randomBetween(80, 150));
                    const steps = randomBetween(12, 18);
                    for (let s = 1; s <= steps; s++) {
                        const curX = Math.round(fromX + (toX - fromX) * (s / steps) + (Math.random() - 0.5) * 4);
                        const curY = Math.round(fromY + (toY - fromY) * (s / steps) + (Math.random() - 0.5) * 4);
                        await page.mouse.move(curX, curY);
                        await page.waitForTimeout(randomBetween(10, 25));
                    }
                    await page.mouse.move(toX, toY);
                    await page.waitForTimeout(randomBetween(120, 250));
                    await page.mouse.up();
                } catch (dragErr) {
                    captchaLog(phase, `[Interactive] 模拟拖拽失败: ${dragErr.message}`, 'warn');
                }
                await page.waitForTimeout(randomBetween(800, 1500));
            } else if (waitResult.points && Array.isArray(waitResult.points) && waitResult.points.length > 0) {
                // 核心优化 5：前端批量多选一次性提交，彻底解决“点一下传一下”的漫长卡顿！
                clickCount += waitResult.points.length;
                captchaLog(phase, `[Interactive] 收到前端批量点选任务（共 ${waitResult.points.length} 个目标图片）...`);
                for (let i = 0; i < waitResult.points.length; i++) {
                    const pt = waitResult.points[i];
                    const targetX = Math.round(currentClip.x + Number(pt.ratioX) * currentClip.width);
                    const targetY = Math.round(currentClip.y + Number(pt.ratioY) * currentClip.height);
                    captchaLog(phase, `[Interactive] 正在点击第 ${i + 1}/${waitResult.points.length} 项: 比例(${Number(pt.ratioX).toFixed(3)}, ${Number(pt.ratioY).toFixed(3)}) -> 视口(${targetX}, ${targetY})`);
                    try {
                        await humanMouseMove(page, targetX, targetY);
                        await page.waitForTimeout(randomBetween(40, 80));
                        await page.mouse.down();
                        await page.waitForTimeout(randomBetween(50, 90));
                        await page.mouse.up();
                    } catch (clickErr) {
                        captchaLog(phase, `[Interactive] 模拟点击第 ${i + 1} 项失败: ${clickErr.message}`, 'warn');
                    }
                    await page.waitForTimeout(randomBetween(120, 200));
                }

                // 批量选图点击完毕后，触发提交/Verify/下一步按钮
                if (waitResult.submitPoint) {
                    const subX = Math.round(currentClip.x + Number(waitResult.submitPoint.ratioX) * currentClip.width);
                    const subY = Math.round(currentClip.y + Number(waitResult.submitPoint.ratioY) * currentClip.height);
                    captchaLog(phase, `[Interactive] 正在点击提交/Verify按钮: 比例(${Number(waitResult.submitPoint.ratioX).toFixed(3)}, ${Number(waitResult.submitPoint.ratioY).toFixed(3)}) -> 视口(${subX}, ${subY})`);
                    try {
                        await clickInteractiveCaptchaSubmit(page, targetInfo, waitResult.submitPoint);
                    } catch (subErr) {
                        captchaLog(phase, `[Interactive] 模拟点击提交按钮失败: ${subErr.message}`, 'warn');
                    }
                    await page.waitForTimeout(randomBetween(1400, 2000));
                }
            } else if (waitResult.action === 'refresh' || (Number(waitResult.ratioY) >= 0.78 && Number(waitResult.ratioX) <= 0.44)) {
                clickCount += 1;
                const now = Date.now();
                if (now - lastRefreshTs < 1200) {
                    captchaLog(phase, `[Interactive] 收到频繁换题请求（距上次不足 1.2s），跳过重复触发`);
                } else {
                    userRefreshCount += 1;
                    lastRefreshTs = now;
                    captchaLog(phase, `[Interactive] 收到前端用户换题请求 (第 ${userRefreshCount} 次)，正在触发官方换题...`);
                    await reloadHcaptchaChallenge(page, targetInfo);
                    await page.waitForTimeout(randomBetween(1400, 1900)); // 预留时间让官方卸载旧题并挂载新题
                }
            } else {
                clickCount += 1;
                const ratioX = Number(waitResult.ratioX);
                const ratioY = Number(waitResult.ratioY);

                // 精准映射回浏览器视口实际坐标
                const targetX = Math.round(currentClip.x + ratioX * currentClip.width);
                const targetY = Math.round(currentClip.y + ratioY * currentClip.height);

                captchaLog(phase, `[Interactive] 收到前端用户第 ${clickCount} 次单点点击: 验证区域比例(${ratioX.toFixed(3)}, ${ratioY.toFixed(3)}) -> 视口坐标(${targetX}, ${targetY})`);

                try {
                    if (waitResult.action === 'submit') {
                        await clickInteractiveCaptchaSubmit(page, targetInfo, waitResult.submitPoint || { ratioX, ratioY });
                    } else {
                        await humanMouseMove(page, targetX, targetY);
                        await page.waitForTimeout(randomBetween(50, 120));
                        await page.mouse.down();
                        await page.waitForTimeout(randomBetween(60, 150));
                        await page.mouse.up();
                    }
                } catch (clickErr) {
                    captchaLog(phase, `[Interactive] 模拟点击失败: ${clickErr.message}`, 'warn');
                }

                // 判断是否为底部操作按钮（右下角提交/下一步，或左下角 ⟳ 刷新换题）
                const isBottomActionBtn = (ratioY >= 0.78 && ratioX >= 0.58);
                const isRefreshBtn = (ratioY >= 0.78 && ratioX <= 0.44) || waitResult.action === 'refresh';
                if (isRefreshBtn) {
                    userRefreshCount += 1;
                    lastRefreshTs = Date.now();
                    await page.waitForTimeout(randomBetween(1600, 2200));
                } else if (isBottomActionBtn) {
                    await page.waitForTimeout(randomBetween(1400, 2000));
                } else {
                    await page.waitForTimeout(randomBetween(320, 480));
                }
            }

            if (await isVerificationCleared(page, verifyOpts)) {
                captchaLog(phase, `[Interactive] 用户操作后验证已通过！`);
                await axios.post(`${baseUrl}/api/internal/captcha-status`, { jobKey, cleared: true }, { timeout: 5000 }).catch(() => {});
                return true;
            }
        } else {
            // 超时或未点击
            if (await isVerificationCleared(page, verifyOpts)) {
                captchaLog(phase, '[Interactive] 验证已自行通过');
                await axios.post(`${baseUrl}/api/internal/captcha-status`, { jobKey, cleared: true }, { timeout: 5000 }).catch(() => {});
                return true;
            }
        }
    }

    const finalCleared = await isVerificationCleared(page, verifyOpts);
    await axios.post(`${baseUrl}/api/internal/captcha-status`, {
        jobKey,
        cleared: finalCleared
    }, { timeout: 5000 }).catch(() => {});

    return finalCleared;
}

function buildCaptchaRequiredError() {
    const parts = [];
    if (isCaptchaPlatformEnabled()) {
        parts.push('打码平台');
    }
    if (isHcaptchaSolverEnabled()) {
        parts.push('视觉求解');
    }
    const solverHint = parts.length
        ? `已尝试自动点击与${parts.join('、')}仍失败，`
        : '自动化无法可靠通过，';
    const configHint = isCaptchaPlatformEnabled()
        ? ''
        : '请在后台配置打码平台 API Key（推荐）或 VLM API Key，';
    return `需要人工验证：触发 Cloudflare/hCaptcha 人机验证，${solverHint}`
        + `${configHint}或换住宅代理 IP，或 HEADFUL=1 有头模式人工勾选`;
}

/**
 * 统一清除人机验证（登录、Checkout、支付各阶段调用）
 */
async function clearHumanVerification(page, options = {}) {
    const {
        phase = 'page',
        maxWaitMs = Number(process.env.CAPTCHA_CLEAR_TIMEOUT_MS || 120000),
        maxBypassRounds = 4,
        useVisualSolver = true,
        requireCheckoutReady = /checkout/i.test(page.url() || ''),
        checkoutReadyWaitMs = Number(process.env.CHECKOUT_READY_WAIT_MS || 60000)
    } = options;

    const verifyOpts = { requireCheckoutReady };
    const effectiveMaxRounds = requireCheckoutReady
        ? Math.max(maxBypassRounds, Number(process.env.CAPTCHA_CHECKOUT_MAX_ROUNDS || 15))
        : maxBypassRounds;

    const onCheckout = /checkout/i.test(page.url() || '');
    const waitOverlayMs = Number(options.overlayWaitMs || 0);
    const isPostSubmitCheckout = onCheckout && String(phase).startsWith('post_submit');
    if (onCheckout && (isPostSubmitCheckout || waitOverlayMs > 0)) {
        const overlayMs = waitOverlayMs || Number(process.env.CAPTCHA_OVERLAY_WAIT_MS || 45000);
        captchaLog(phase, `等待 Checkout 提交后 hCaptcha 弹层（最长 ${Math.round(overlayMs / 1000)}s，弹层可能延迟 15–35s）...`);
        const appeared = await waitForCheckoutOverlayCaptcha(page, overlayMs);
        if (appeared) {
            captchaLog(phase, '已检测到 hCaptcha 弹层');
        } else {
            captchaLog(phase, '等待期内未检测到弹层，仍将尝试自动处理', 'warn');
        }
    }

    const captchaStill = await hasAnyCheckoutCaptchaSignal(page);
    if (await isVerificationCleared(page, verifyOpts)) {
        if (!isPostSubmitCheckout || !captchaStill) {
            return { cleared: true, skipped: true };
        }
        captchaLog(phase, '提交后 checkout 仍有人机验证信号，进入自动处理', 'warn');
    }

    if (requireCheckoutReady) {
        captchaLog(phase, `等待 Checkout 支付表单加载（最长 ${Math.round(checkoutReadyWaitMs / 1000)}s）...`);
        const ready = await waitForCheckoutPaymentReady(page, checkoutReadyWaitMs);
        if (ready === true) {
            captchaLog(phase, '支付表单已就绪，无需验证处理');
            return { cleared: true, skipped: true, via: 'checkout-ready' };
        }
        if (ready === 'login_required' || ready === 'login_redirect') {
            captchaLog(phase, 'Checkout 出现登录页，Session 未在支付页生效', 'error');
            return {
                cleared: false,
                sessionRequired: true,
                checkoutNotReady: true,
                message: buildSessionNotLoggedInError('Checkout 支付页')
            };
        }
    }

    await logCaptchaFrameSnapshot(page, phase);

    const cloudflareWall = await isCloudflareWallPage(page);
    const blockingVisible = await isBlockingHumanVerificationVisible(page);

    if (requireCheckoutReady && !blockingVisible && !cloudflareWall) {
        captchaLog(phase, '未发现可见人机验证（已忽略 Stripe 隐形 hCaptcha），继续等待支付表单...', 'warn');
        const slowDeadline = Date.now() + maxWaitMs;
        while (Date.now() < slowDeadline) {
            if (await isCheckoutLoginGate(page) || await hasVisibleLoginChrome(page)) {
                captchaLog(phase, 'Checkout 显示登录界面，停止空等', 'error');
                return {
                    cleared: false,
                    sessionRequired: true,
                    checkoutNotReady: true,
                    message: buildSessionNotLoggedInError('Checkout 支付页')
                };
            }
            if (await isCheckoutPaymentReady(page)) {
                captchaLog(phase, '支付表单已加载（慢加载）');
                return { cleared: true, via: 'checkout-slow-load' };
            }
            await page.waitForTimeout(1500);
        }
        captchaLog(phase, '支付表单长时间未出现（非验证拦截）', 'error');
        return { cleared: false, checkoutNotReady: true, captchaRequired: false };
    }

    if (cloudflareWall) {
        captchaLog(phase, '检测到 Cloudflare 全页验证墙');
    } else if (blockingVisible || await hasCheckoutCaptchaOverlayText(page)) {
        captchaLog(phase, 'Checkout 被可见人机验证拦截（hCaptcha/Cloudflare）');
    } else if (requireCheckoutReady) {
        captchaLog(phase, 'Checkout 被可见人机验证拦截');
    }

    captchaLog(phase, `开始处理可见人机验证（最长 ${Math.round(maxWaitMs / 1000)}s，maxRounds=${effectiveMaxRounds}）...`);
    const deadline = Date.now() + maxWaitMs;
    // 保留原先“主等待 + 最后人工协助”的时间预算，改为同一个连续会话。
    // 多页题沿用原有总时间预算，避免因轮次切换而中断用户操作。
    const interactiveDeadline = deadline + Number(process.env.CAPTCHA_INTERACTIVE_TIMEOUT_MS || 90000);
    let round = 0;
    let userAssistanceStarted = false;
    let visualSolverFailed = false;

    while (Date.now() < deadline) {
        // 关键检查 1：若页面已明确提示“无法验证您的浏览器”，立即熔断退出，避免多轮空等
        try {
            const bodyTextCheck = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
            if (/无法验证.*浏览器|未能验证.*浏览器|我们无法验证您的浏览器|unable to verify (your )?browser|failed to verify (your )?browser/i.test(bodyTextCheck)) {
                captchaLog(phase, '收银台已显示浏览器验证失败拦截（我们无法验证您的浏览器），立即熔断', 'error');
                return {
                    cleared: false,
                    browserVerificationFailed: true,
                    message: '官方浏览器安全验证未通过（我们无法验证您的浏览器）。卡密资产未核销并已自动回滚，请稍后重试',
                    rounds: round
                };
            }
            const browserVerifyFailedLoc = page.getByText(/无法验证.*浏览器|unable to verify your browser|failed to verify your browser|未能验证.*浏览器/i).first();
            if (await browserVerifyFailedLoc.isVisible({ timeout: 150 }).catch(() => false)) {
                const failText = String(await browserVerifyFailedLoc.innerText().catch(() => '') || '官方收银台提示：我们无法验证您的浏览器').trim();
                captchaLog(phase, `收银台已显示浏览器验证失败拦截（${failText}），立即熔断`);
                return {
                    cleared: false,
                    browserVerificationFailed: true,
                    message: '官方浏览器安全验证未通过（我们无法验证您的浏览器）。卡密资产未核销并已自动回滚，请稍后重试',
                    rounds: round
                };
            }
        } catch (_) {}

        // 关键检查 2：若页面已出现拒付/无法完成购买（Stripe 明确提示），人机验证实际已成功通过！
        try {
            const declineLoc = page.getByText(/无法完成此(次)?购买|unable to complete this purchase|未能完成购买/i).first();
            if (await declineLoc.isVisible({ timeout: 150 }).catch(() => false)) {
                const declineMsg = String(await declineLoc.innerText().catch(() => '') || '无法完成此次购买').trim();
                captchaLog(phase, `收银台已显示支付结果（${declineMsg}），人机验证实际已通过`);
                return { cleared: true, paymentDeclined: true, declineMsg, rounds: round };
            }
        } catch (_) {}

        if (await isVerificationCleared(page, verifyOpts)) {
            captchaLog(phase, '验证已清除，页面内容就绪');
            return { cleared: true, rounds: round };
        }

        round += 1;
        const interactiveJobKey = options.jobKey || process.env.JOB_KEY;

        // 如果用户交互式协助已在上一轮启动，后续轮次直接无缝继续由前端用户协助，跳过重复的自动绕过和模型求解
        if (userAssistanceStarted && interactiveJobKey) {
            captchaLog(phase, `用户交互式协助已在进行中，第 ${round} 轮直接由前端用户继续操作...`);
            const interactiveCleared = await attemptInteractiveUserCaptcha(page, `${phase}-interactive-${round}`, {
                jobKey: interactiveJobKey,
                verifyOpts,
                maxWaitMs: Math.max(1, interactiveDeadline - Date.now())
            });
            if (interactiveCleared && typeof interactiveCleared === 'object') {
                if (interactiveCleared.paymentDeclined) {
                    return { cleared: true, paymentDeclined: true, declineMsg: interactiveCleared.declineMsg, rounds: round };
                }
                if (interactiveCleared.browserVerificationFailed) {
                    return {
                        cleared: false,
                        browserVerificationFailed: true,
                        message: interactiveCleared.failMsg || '官方浏览器安全验证未通过（我们无法验证您的浏览器）。卡密资产未核销并已自动回滚，请稍后重试',
                        rounds: round
                    };
                }
            }
            if (interactiveCleared && await isVerificationCleared(page, verifyOpts)) {
                return { cleared: true, rounds: round, via: 'user-interactive' };
            }
            if (round >= effectiveMaxRounds && !process.env.HEADFUL) {
                break;
            }
            await page.waitForTimeout(1000);
            continue;
        }

        const prioritizeUserInteractive = (
            process.env.INTERACTIVE_CAPTCHA_PRIORITY === 'true'
            || process.env.HCAPTCHA_SOLVER_ENABLED === '0'
            || !isCaptchaPlatformEnabled()
        ) && Boolean(interactiveJobKey);

        let overlayCaptcha = await hasAnyCheckoutCaptchaSignal(page);
        let imageChallenge = await hasHcaptchaImageChallenge(page);

        // 如果检测到弹出了 Checkout hCaptcha 复选框弹层（One more step...），但尚未展开图片题：
        // 必须先自动点击复选框！很多时候一点击就直接勾选通过，无需打码或人工
        if (overlayCaptcha && !imageChallenge) {
            captchaLog(phase, '检测到 Checkout hCaptcha 复选框弹层，正在自动点击「I am human」复选框...');
            await clickHcaptchaCheckboxFrames(page, `${phase}-checkbox-click`);
            await page.waitForTimeout(2000);
            if (await isVerificationCleared(page, verifyOpts)) {
                captchaLog(phase, '点击复选框后验证直接静默通过！');
                return { cleared: true, rounds: round, via: 'checkbox-passive-pass' };
            }
            // 重新刷新图片题状态
            imageChallenge = await hasHcaptchaImageChallenge(page);
        }

        // 若优先使用前端人工交互透传（自动求解已关闭、未配置打码平台或指定优先），立即唤起协助，跳过被动等待
        if (prioritizeUserInteractive && (imageChallenge || overlayCaptcha)) {
            captchaLog(phase, '[交互透传优先] 自动求解已关闭/未配置打码平台，立即唤起前端用户协助...');
            userAssistanceStarted = true;
            const interactiveCleared = await attemptInteractiveUserCaptcha(page, `${phase}-user-priority-${round}`, {
                jobKey: interactiveJobKey,
                verifyOpts,
                maxWaitMs: Math.max(1, interactiveDeadline - Date.now())
            });
            if (interactiveCleared && typeof interactiveCleared === 'object') {
                if (interactiveCleared.paymentDeclined) {
                    return { cleared: true, paymentDeclined: true, declineMsg: interactiveCleared.declineMsg, rounds: round };
                }
                if (interactiveCleared.browserVerificationFailed) {
                    return {
                        cleared: false,
                        browserVerificationFailed: true,
                        message: interactiveCleared.failMsg || '官方浏览器安全验证未通过（我们无法验证您的浏览器）。卡密资产未核销并已自动回滚，请稍后重试',
                        rounds: round
                    };
                }
            }
            if (interactiveCleared && await isVerificationCleared(page, verifyOpts)) {
                return { cleared: true, rounds: round, via: 'user-interactive-priority' };
            }
            if (round >= effectiveMaxRounds && !process.env.HEADFUL) {
                break;
            }
            await page.waitForTimeout(1000);
            continue;
        }

        captchaLog(phase, `第 ${round} 轮自动绕过...`);

        await attemptBypassHumanVerification(page, { phase: `${phase}-r${round}` });
        await page.waitForTimeout(cloudflareWall ? 10000 : 5000);

        if (await isVerificationCleared(page, verifyOpts)) {
            captchaLog(phase, `第 ${round} 轮模拟点击后验证已通过`);
            return { cleared: true, rounds: round };
        }

        overlayCaptcha = await hasAnyCheckoutCaptchaSignal(page);
        imageChallenge = await hasHcaptchaImageChallenge(page);
        if (overlayCaptcha && !imageChallenge) {
            const passiveOk = await waitForPassiveCheckboxClear(page, `${phase}-r${round}`, verifyOpts, 35000);
            if (passiveOk) {
                return { cleared: true, rounds: round, via: 'passive-checkbox' };
            }
        }

        if (await isVerificationCleared(page, verifyOpts)) {
            captchaLog(phase, `被动验证等待后页面已就绪`);
            return { cleared: true, rounds: round };
        }

        overlayCaptcha = await hasAnyCheckoutCaptchaSignal(page);
        imageChallenge = await hasHcaptchaImageChallenge(page);

        // 优先调用 Capsolver 打码平台极速解题（全面支持被动与图片题，移除 ChatGPT VLM 视觉求解）
        if ((overlayCaptcha || imageChallenge) && isCaptchaPlatformEnabled()) {
            captchaLog(phase, `检测到 hCaptcha 验证（图片题=${imageChallenge ? '是' : '否'}），优先调用 Capsolver 打码平台...`);
            const platformOk = await attemptCaptchaPlatformSolver(page, `${phase}-capsolver-${round}`, verifyOpts);
            if (platformOk && await isVerificationCleared(page, verifyOpts)) {
                return { cleared: true, rounds: round, via: 'captcha-platform' };
            }
            captchaLog(phase, 'Capsolver 打码平台本轮未通过，准备回退至前端用户交互协助', 'warn');
        }

        // 若存在图片题或验证未清除，直接唤起前端“用户交互协助”透传，绝不卡死
        if (interactiveJobKey && imageChallenge && !await isVerificationCleared(page, verifyOpts)) {
            captchaLog(phase, '检测到九宫格图片题且打码平台未通过，立即唤起前端用户交互协助...');
            userAssistanceStarted = true;
            const interactiveCleared = await attemptInteractiveUserCaptcha(page, `${phase}-img-interactive-${round}`, {
                jobKey: interactiveJobKey,
                verifyOpts,
                maxWaitMs: Math.max(1, interactiveDeadline - Date.now())
            });
            if (interactiveCleared && typeof interactiveCleared === 'object') {
                if (interactiveCleared.paymentDeclined) {
                    return { cleared: true, paymentDeclined: true, declineMsg: interactiveCleared.declineMsg, rounds: round };
                }
                if (interactiveCleared.browserVerificationFailed) {
                    return {
                        cleared: false,
                        browserVerificationFailed: true,
                        message: interactiveCleared.failMsg || '官方浏览器安全验证未通过（我们无法验证您的浏览器）。卡密资产未核销并已自动回滚，请稍后重试',
                        rounds: round
                    };
                }
            }
            if (interactiveCleared && await isVerificationCleared(page, verifyOpts)) {
                return { cleared: true, rounds: round, via: 'user-interactive-image' };
            }
        }

        if (interactiveJobKey && !await isVerificationCleared(page, verifyOpts)) {
            captchaLog(phase, `自动绕过未通过，唤起前端用户交互式协助 (第 ${round} 轮)...`);
            userAssistanceStarted = true;
            const interactiveCleared = await attemptInteractiveUserCaptcha(page, `${phase}-interactive-${round}`, {
                jobKey: interactiveJobKey,
                verifyOpts,
                maxWaitMs: Math.max(1, interactiveDeadline - Date.now())
            });
            if (interactiveCleared && typeof interactiveCleared === 'object') {
                if (interactiveCleared.paymentDeclined) {
                    return { cleared: true, paymentDeclined: true, declineMsg: interactiveCleared.declineMsg, rounds: round };
                }
                if (interactiveCleared.browserVerificationFailed) {
                    return {
                        cleared: false,
                        browserVerificationFailed: true,
                        message: interactiveCleared.failMsg || '官方浏览器安全验证未通过（我们无法验证您的浏览器）。卡密资产未核销并已自动回滚，请稍后重试',
                        rounds: round
                    };
                }
            }
            if (interactiveCleared && await isVerificationCleared(page, verifyOpts)) {
                return { cleared: true, rounds: round, via: 'user-interactive' };
            }
        }

        if (process.env.HEADFUL === '1') {
            captchaLog(phase, '有头模式：等待人工勾选（10s）...');
            await page.waitForTimeout(10000);
            if (await isVerificationCleared(page, verifyOpts)) {
                captchaLog(phase, '人工勾选后验证已通过');
                return { cleared: true, rounds: round, via: 'manual-headful' };
            }
        }

        if (round >= effectiveMaxRounds && !process.env.HEADFUL) {
            break;
        }
        await page.waitForTimeout(2000);
    }

    if (await isVerificationCleared(page, verifyOpts)) {
        return { cleared: true, rounds: round };
    }

    const currentJobKey = options.jobKey || process.env.JOB_KEY;
    if (currentJobKey && !userAssistanceStarted) {
        captchaLog(phase, '常规自动轮询无法通过，启动前端交互式人机验证透传协助...');
        const interactiveCleared = await attemptInteractiveUserCaptcha(page, `${phase}-interactive`, {
            jobKey: currentJobKey,
            verifyOpts,
            maxWaitMs: Math.max(1, interactiveDeadline - Date.now())
        });
        if (interactiveCleared && typeof interactiveCleared === 'object') {
            if (interactiveCleared.paymentDeclined) {
                return { cleared: true, paymentDeclined: true, declineMsg: interactiveCleared.declineMsg, rounds: round };
            }
            if (interactiveCleared.browserVerificationFailed) {
                return {
                    cleared: false,
                    browserVerificationFailed: true,
                    message: interactiveCleared.failMsg || '官方浏览器安全验证未通过（我们无法验证您的浏览器）。卡密资产未核销并已自动回滚，请稍后重试',
                    rounds: round
                };
            }
        }
        if (interactiveCleared && await isVerificationCleared(page, verifyOpts)) {
            captchaLog(phase, '前端用户协助点击完成，验证已通过！');
            return { cleared: true, rounds: round, via: 'user-interactive' };
        }
    }

    captchaLog(phase, '验证未能自动通过（页面仍无支付表单）', 'error');
    return { cleared: false, captchaRequired: true, rounds: round };
}

module.exports = {
    isCheckoutOverlayCaptchaVisible,
    hasCheckoutCaptchaOverlayText,
    hasAnyCheckoutCaptchaSignal,
    hasVisiblePostSubmitHcaptchaWidget,
    waitForCheckoutOverlayCaptcha,
    isBlockingHumanVerificationVisible,
    isHumanVerificationVisible,
    isInvisibleStripeHcaptchaUrl,
    waitForCheckoutPaymentReady,
    isCloudflareWallPage,
    isCheckoutPaymentReady,
    isVerificationCleared,
    isPageBlocked,
    attemptBypassHumanVerification,
    attemptHcaptchaVisualSolver,
    attemptCaptchaPlatformSolver,
    attemptInteractiveUserCaptcha,
    clearHumanVerification,
    buildCaptchaRequiredError,
    isCaptchaFrameUrl,
    collectCaptchaIframeLocators,
    hasHcaptchaSolverTarget,
    hasHcaptchaImageChallenge,
    waitForPassiveCheckboxClear,
    clickHcaptchaCheckboxFrames,
    translateHcaptchaPrompt,
    extractHcaptchaChallengePrompt,
    formatCaptchaGuideMessage,
    clickInteractiveCaptchaSubmit,
    isDragChallenge,
    reloadHcaptchaChallenge
};
