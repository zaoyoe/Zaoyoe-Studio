'use strict';

const { getRegionConfig } = require('./region-config');
const { summarizeCheckoutRequest, readCheckoutErrorDetail, buildCheckoutHttpFailure } = require('./checkout-diagnostics');
const { assertChatGptLoggedIn } = require('./session-auth');
const { assertNoExpiredSession } = require('./auth-page-detect');
const { clearHumanVerification } = require('./human-verification');

const PRICING_URL = 'https://chatgpt.com/#pricing';

const REGION_UI_LABELS = {
    PH: ['菲律宾', 'Philippines', 'Pilipinas'],
    US: ['美国', 'United States'],
    SG: ['新加坡', 'Singapore'],
    MY: ['马来西亚', 'Malaysia']
};

const REGION_CURRENCY_HINTS = {
    PH: ['₱', 'PHP'],
    US: ['$20', '$ 20', 'USD'],
    SG: ['S$', 'SGD'],
    MY: ['RM', 'MYR']
};

const REGION_PRICE_PATTERNS = {
    PH: [/₱\s*[\d,.]+/, /[\d,.]+\s*₱/, /PHP\s*[\d,.]+/i, /[\d,.]+\s*PHP/i],
    US: [/\$\s*20(?:\.00)?/, /USD\s*20/i, /\$\s*[\d,.]+(?:\s*\/)?\s*(?:month|mo)/i],
    SG: [/S\$\s*[\d,.]+/, /[\d,.]+\s*SGD/i],
    MY: [/RM\s*[\d,.]+/, /[\d,.]+\s*MYR/i]
};

const REGION_WRONG_CURRENCY = {
    PH: [/£\s*[\d,.]+/, /[\d,.]+\s*£/, /\bGBP\b/i, /United Kingdom/i, /Great Britain/i, /€\s*[\d,.]+/, /[\d,.]+\s*€/, /\bEUR\b/i],
    US: [/£\s*[\d,.]+/, /₱\s*[\d,.]+/, /\bGBP\b/i, /\bPHP\b/i, /S\$\s*[\d,.]+/, /RM\s*[\d,.]+/],
    SG: [/£\s*[\d,.]+/, /₱\s*[\d,.]+/, /\$\s*20(?:\.00)?\s*(?:USD|\/)/i, /RM\s*[\d,.]+/],
    MY: [/£\s*[\d,.]+/, /₱\s*[\d,.]+/, /S\$\s*[\d,.]+/, /\$\s*20(?:\.00)?/]
};

const REGION_CURRENT_COUNTRY_HINTS = {
    PH: [/菲律宾|Philippines|Pilipinas/i],
    US: [/United States|美国(?!地区)/i],
    SG: [/Singapore|新加坡/i],
    MY: [/Malaysia|马来西亚/i]
};

const SKIP_REGION_BUTTON_TEXT = /^(Upgrade|Personal|Business|Free|Plus|Pro|Subscribe|Close|Your current plan|Start|Start now|升级|订阅|关闭)$/i;

const PLAN_UPGRADE_PATTERNS = {
    go: [
        /升级至\s*Go/i,
        /Upgrade to Go/i,
        /Get Go/i,
        /Subscribe to Go/i,
        /ChatGPT\s*Go/i,
        /^Start$/i,
        /^Upgrade$/i
    ],
    plus: [
        /Upgrade to Plus/i,
        /升级至\s*Plus/i,
        /✦\s*Upgrade to Plus/i,
        /Get Plus/i,
        /Subscribe to Plus/i,
        /Start now/i,
        /^Start$/i,
        /✦\s*Start now/i,
        /^Upgrade$/i
    ],
    pro: [/升级至\s*Pro/i, /Upgrade to Pro/i, /Get Pro/i, /^Upgrade$/i, /Start now/i],
    pro_100: [/升级至\s*Pro/i, /Upgrade to Pro/i, /Get Pro/i, /^Upgrade$/i, /Start now/i, /100/i],
    pro_200: [/升级至\s*Pro/i, /Upgrade to Pro/i, /Get Pro/i, /^Upgrade$/i, /Start now/i, /200/i],
    pro_500: [/升级至\s*Pro/i, /Upgrade to Pro/i, /Get Pro/i, /^Upgrade$/i, /Start now/i, /500/i],
    pro_5x: [/升级至\s*Pro/i, /Upgrade to Pro/i, /Get Pro/i, /^Upgrade$/i, /Start now/i, /100/i],
    pro_20x: [/升级至\s*Pro/i, /Upgrade to Pro/i, /Get Pro/i, /^Upgrade$/i, /Start now/i, /200/i],
    pro100: [/升级至\s*Pro/i, /Upgrade to Pro/i, /Get Pro/i, /^Upgrade$/i, /Start now/i, /100/i],
    pro200: [/升级至\s*Pro/i, /Upgrade to Pro/i, /Get Pro/i, /^Upgrade$/i, /Start now/i, /200/i],
    pro500: [/升级至\s*Pro/i, /Upgrade to Pro/i, /Get Pro/i, /^Upgrade$/i, /Start now/i, /500/i],
    pro5x: [/升级至\s*Pro/i, /Upgrade to Pro/i, /Get Pro/i, /^Upgrade$/i, /Start now/i, /100/i],
    pro20x: [/升级至\s*Pro/i, /Upgrade to Pro/i, /Get Pro/i, /^Upgrade$/i, /Start now/i, /200/i]
};

function normalizeOptionText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}

function matchesCountryLabel(text, labels) {
    const normalized = normalizeOptionText(text).toLowerCase();
    return labels.some((label) => {
        const wanted = String(label).toLowerCase();
        return normalized === wanted || normalized.includes(wanted);
    });
}

const PERSONAL_PLAN_LABEL = /^(?:Personal(?:\s+plans?)?|Individual(?:s)?(?:\s+plans?)?|For individuals|个人|个人版|个人套餐)$/i;
const BUSINESS_PLAN_LABEL = /^(?:Business(?:\s*&\s*Enterprise)?(?:\s+plan)?|Team|企业|团队|商业版(?:套餐)?|企业版)$/i;
const PERSONAL_PLAN_TEXT = /(?:ChatGPT\s+)?(?:Plus|\bPro\b)|升级至\s*(?:Plus|\bPro\b)|Upgrade\s+to\s+(?:Plus|\bPro\b)|Get\s+(?:Plus|\bPro\b)|Subscribe\s+to\s+(?:Plus|\bPro\b)/i;
const BUSINESS_PLAN_TEXT = /ChatGPT\s+Business|Business\s+plan|企业版|商业版/i;
const PLAN_CONTROL_SELECTOR = 'button,[role="tab"],[role="radio"],[role="option"],[role="menuitem"],[role="button"],[role="combobox"],[aria-haspopup="menu"],[aria-haspopup="listbox"],select';


async function visible(locator, timeout = 800) {
    return locator.isVisible({ timeout }).catch(() => false);
}

async function readControlLabel(locator) {
    const [text, aria, title] = await Promise.all([
        locator.innerText().catch(() => ''),
        locator.getAttribute('aria-label').catch(() => ''),
        locator.getAttribute('title').catch(() => '')
    ]);
    return normalizeOptionText(aria || text || title || '');
}

async function getVisiblePlanControls(page, pattern = null) {
    const controls = page.locator(PLAN_CONTROL_SELECTOR);
    const count = await controls.count().catch(() => 0);
    const result = [];
    for (let index = 0; index < Math.min(count, 160); index += 1) {
        const control = controls.nth(index);
        if (!(await visible(control, 150))) continue;
        const label = await readControlLabel(control);
        if (!label || (pattern && !pattern.test(label))) continue;
        result.push({ control, label, index });
    }
    return result;
}

async function isBusinessTabActive(page) {
    const selectedBusiness = page.locator('[aria-selected="true"],[aria-pressed="true"],[data-state="active"]');
    const selectedCount = await selectedBusiness.count().catch(() => 0);
    for (let index = 0; index < Math.min(selectedCount, 80); index += 1) {
        const control = selectedBusiness.nth(index);
        if (!(await visible(control, 150))) continue;
        const label = await readControlLabel(control);
        if (BUSINESS_PLAN_LABEL.test(label)) return true;
    }

    const businessControls = await getVisiblePlanControls(page, BUSINESS_PLAN_LABEL);
    if (businessControls.length > 0) {
        // Some current pricing surfaces expose the active choice only as a
        // plain button with aria-expanded, so treat the visible Business
        // switcher as active only when no personal plan action is visible.
        const personalAction = await hasVisiblePersonalPlanAction(page);
        return !personalAction;
    }

    const businessCard = await visible(page.getByText(BUSINESS_PLAN_TEXT).first(), 500);
    const personalAction = await hasVisiblePersonalPlanAction(page);
    return businessCard && !personalAction;
}

async function hasVisiblePersonalPlanAction(page) {
    const scope = await getPricingSurface(page);
    const titles = scope.locator('h1,h2,h3,h4,[role="heading"]').filter({ hasText: /^(?:ChatGPT\s+)?(?:Plus|Pro)$/i });
    for (let i = 0, count = await titles.count(); i < count; i += 1) {
        if (await visible(titles.nth(i)) && !await titles.nth(i).evaluate(node => Boolean(node.closest('[data-message-author-role]')))) return true;
    }
    const actions = scope.getByRole('button', { name: /^(?:[✦★]\s*)?(?:Upgrade to|Get|Subscribe to|升级至)\s*(?:Plus|Pro)$/i });
    for (let i = 0, count = await actions.count(); i < count; i += 1) {
        if (await visible(actions.nth(i)) && !await actions.nth(i).evaluate(node => Boolean(node.closest('[data-message-author-role]')))) return true;
    }
    return false;
}

async function isPersonalPlanView(page) {
    // Check the rendered plan/action first. The Business heading can remain
    // mounted in the DOM during a tab transition, so checking Business first
    // creates a false negative after a successful click.
    if (await hasVisiblePersonalPlanAction(page)) return true;

    const selectedControls = await getVisiblePlanControls(page, PERSONAL_PLAN_LABEL);
    for (const { control } of selectedControls) {
        const selected = await control.getAttribute('aria-selected').catch(() => null);
        const pressed = await control.getAttribute('aria-pressed').catch(() => null);
        const state = await control.getAttribute('data-state').catch(() => null);
        if (selected === 'true' || pressed === 'true' || state === 'active') return true;
    }

    return false;
}

async function isBusinessPlanView(page) {
    const businessTitle = await visible(page.getByText(BUSINESS_PLAN_TEXT).first(), 800);
    const onPersonal = await isPersonalPlanView(page);
    return businessTitle && !onPersonal;
}

async function clickFirstVisiblePersonalControl(page) {
    const candidates = [
        page.getByRole('option', { name: PERSONAL_PLAN_LABEL }).first(),
        page.getByRole('menuitem', { name: PERSONAL_PLAN_LABEL }).first(),
        page.getByRole('tab', { name: PERSONAL_PLAN_LABEL }).first(),
        page.getByRole('radio', { name: PERSONAL_PLAN_LABEL }).first(),
        page.getByRole('button', { name: PERSONAL_PLAN_LABEL }).first(),
        page.getByText(PERSONAL_PLAN_LABEL).first(),
        page.locator('select').first()
    ];

    for (const candidate of candidates) {
        if (!(await visible(candidate, 700))) continue;
        const tagName = await candidate.evaluate((node) => node.tagName).catch(() => '');
        if (tagName === 'SELECT') {
            const options = await candidate.locator('option').allTextContents().catch(() => []);
            const option = options.find((text) => PERSONAL_PLAN_LABEL.test(normalizeOptionText(text)));
            if (option) {
                await candidate.selectOption({ label: option }).catch(() => {});
                return true;
            }
        }

        const selected = await candidate.getAttribute('aria-selected').catch(() => null);
        const pressed = await candidate.getAttribute('aria-pressed').catch(() => null);
        const state = await candidate.getAttribute('data-state').catch(() => null);
        if (selected === 'true' || pressed === 'true' || state === 'active') return true;

        await candidate.scrollIntoViewIfNeeded().catch(() => {});
        await candidate.click({ timeout: 8000 }).catch(() => {});
        return true;
    }
    return false;
}

async function openPlanSwitcher(page) {
    const candidates = [
        page.getByRole('tab', { name: BUSINESS_PLAN_LABEL }).first(),
        page.getByRole('button', { name: BUSINESS_PLAN_LABEL }).first(),
        page.getByRole('combobox').first(),
        page.locator('[aria-haspopup="menu"],[aria-haspopup="listbox"]').filter({ hasText: BUSINESS_PLAN_LABEL }).first(),
        page.getByText(BUSINESS_PLAN_LABEL).first()
    ];

    for (const candidate of candidates) {
        if (!(await visible(candidate, 700))) continue;
        const expanded = await candidate.getAttribute('aria-expanded').catch(() => null);
        if (expanded === 'true') return true;
        await candidate.scrollIntoViewIfNeeded().catch(() => {});
        await candidate.click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(350);
        if (await clickFirstVisiblePersonalControl(page)) return true;
        const nowExpanded = await candidate.getAttribute('aria-expanded').catch(() => null);
        if (nowExpanded === 'true') return true;
    }
    return false;
}

async function waitForPersonalPlanView(page, timeout = 8000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (await isPersonalPlanView(page)) return true;
        await page.waitForTimeout(350);
    }
    return false;
}

async function describePlanControls(page) {
    const controls = await getVisiblePlanControls(page);
    return controls
        .map(({ label }) => label)
        .filter((label, index, labels) => labels.indexOf(label) === index)
        .slice(0, 16)
        .join(' | ');
}

/**
 * 定价页顶部 Personal / Individual / Business 切换（Plus/Pro 都在个人视图下）。
 * ChatGPT 当前不同账号/地区会使用 tab、下拉菜单或原生 select 三种结构，
 * 因此这里先尝试直达目标，再打开 Business/Team 切换器后选择个人入口。
 */
async function switchToPersonalPlans(page) {
    if (await isPersonalPlanView(page)) {
        console.log('✅ [步骤] 已在个人套餐 (Personal/Individual) 视图');
        return;
    }

    console.log(await isBusinessTabActive(page)
        ? '🔄 [步骤] 检测到 Business 标签，正在切换到 Personal/Individual...'
        : '🔄 [步骤] 正在切换到「个人 / Personal / Individual」套餐...');

    // First try a directly rendered Personal/Individual tab or option.
    const clickedDirectPersonal = await clickFirstVisiblePersonalControl(page);
    if (clickedDirectPersonal && await waitForPersonalPlanView(page)) {
        console.log('✅ [步骤] 已切换到个人套餐 (Personal/Individual)');
        return;
    }

    // On newer pricing surfaces Personal is inside the Business dropdown.
    await openPlanSwitcher(page);
    if (await waitForPersonalPlanView(page)) {
        console.log('✅ [步骤] 已通过套餐切换器进入个人套餐 (Personal/Individual)');
        return;
    }

    // One final direct attempt handles delayed menu rendering and portals.
    const clickedFinalPersonal = await clickFirstVisiblePersonalControl(page);
    if (clickedFinalPersonal && await waitForPersonalPlanView(page, 4000)) {
        console.log('✅ [步骤] 已切换到个人套餐 (Personal/Individual)');
        return;
    }

    const controls = await describePlanControls(page);
    if (await isBusinessPlanView(page)) {
        throw new Error(`定价页停留在 Business 套餐，未能切换到 Personal/Individual，无法购买 Plus/Pro。可见控件: ${controls || '无'}`);
    }

    console.warn(`[Warn] 未能确认 Personal/Individual 切换，将继续查找升级按钮。可见控件: ${controls || '无'}`);
}

async function pricingSurfaceState(surface) {
    return surface.evaluate((root) => {
        const shown = (node) => Boolean(node.getClientRects().length) && getComputedStyle(node).visibility !== 'hidden';
        const nodes = [...root.querySelectorAll('h1,h2,h3,h4,[role="heading"],button,[role="button"],[role="tab"],[role="radio"],select')]
            .filter((node) => shown(node) && !node.closest('[data-message-author-role]')
                && (root.matches('[role="dialog"]') || !node.closest('[role="dialog"]')));
        const labels = nodes.map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim());
        const planTitle = nodes.some((node, i) => node.matches('h1,h2,h3,h4,[role="heading"]')
            && /^(?:ChatGPT\s+)?(?:Free|Go|Plus|Pro|Business)$/i.test(labels[i]));
        const pricingTitle = nodes.some((node, i) => node.matches('h1,h2,h3,h4,[role="heading"]')
            && /^(?:Upgrade your plan|Choose your plan|See all plans|All plans|升级套餐|选择套餐)$/i.test(labels[i]));
        const controls = nodes.some((node) => node.matches('button,[role="button"],[role="tab"],[role="radio"],select'));
        const loading = [...root.querySelectorAll('*')].some((node) => shown(node) && node.children.length === 0
            && /Getting your plan ready|Giving your chat a little turbo boost|正在准备你的套餐|正在准备/i.test(node.textContent || ''));
        const identified = planTitle || pricingTitle;
        return { identified, ready: identified && controls && !loading, loading };
    }).catch(() => ({ identified: false, ready: false, loading: false }));
}

async function getPricingSurface(page) {
    const dialogs = page.locator('[role="dialog"]');
    for (let i = 0, count = await dialogs.count(); i < count; i += 1) {
        const dialog = dialogs.nth(i);
        if (await visible(dialog) && (await pricingSurfaceState(dialog)).identified) return dialog;
    }
    const main = page.locator('main').first();
    if (await visible(main) && (await pricingSurfaceState(main)).identified) return main;
    return page.locator('body');
}

async function readPricingSurfaceText(page) {
    const surface = await getPricingSurface(page);
    const surfaceText = await surface.innerText({ timeout: 4000 }).catch(() => '');
    if (surfaceText && surfaceText.trim().length > 0) {
        return String(surfaceText);
    }
    const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    return String(bodyText || '');
}

async function scrollPricingSurface(page) {
    const surface = await getPricingSurface(page);
    await surface.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
    }).catch(() => {});
    await page.locator('body').evaluate((node) => {
        node.scrollTop = node.scrollHeight;
    }).catch(() => {});
    await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
    }).catch(() => {});
    await page.waitForTimeout(600);
}

async function pagePricingStatus(page, regionCode) {
    const code = String(regionCode || 'PH').toUpperCase();
    const text = await readPricingSurfaceText(page);
    const positive = REGION_PRICE_PATTERNS[code] || [];
    const negative = REGION_WRONG_CURRENCY[code] || [];
    const countryHints = REGION_CURRENT_COUNTRY_HINTS[code] || [];

    const hasPositivePrice = positive.some((pattern) => pattern.test(text));
    const hasWrongCurrency = negative.some((pattern) => pattern.test(text));
    const hasCountryLabel = countryHints.some((pattern) => pattern.test(text));

    if (hasWrongCurrency) {
        return { matches: false, wrongCurrency: true, hasPrice: true, text };
    }
    if (hasPositivePrice) {
        return { matches: true, wrongCurrency: false, hasPrice: true, text };
    }
    if (hasCountryLabel && !hasWrongCurrency) {
        const looseHints = REGION_CURRENCY_HINTS[code] || [];
        if (looseHints.some((hint) => text.includes(hint))) {
            return { matches: true, wrongCurrency: false, hasPrice: true, text };
        }
    }
    const anyPrice = /[₱$¥€£]|(?:RMB|CNY|PHP|USD|SGD|MYR|\b(?:month|mo|year|yr)\b)/i.test(text);
    return { matches: false, wrongCurrency: false, hasPrice: anyPrice, text };
}

async function pageShowsTargetRegionPricing(page, regionCode) {
    const status = await pagePricingStatus(page, regionCode);
    return status.matches;
}

const ALL_COUNTRY_NAME_PATTERN = /^(United Kingdom|Philippines|United States|Singapore|Malaysia|Afghanistan|Algeria|Andorra|Albania|Australia|Canada|Japan|China|菲律宾)$/i;
const REGION_ENTRY_HINT = /billing|country|countries|region|currency|地区|账单|国家|货币|更改地区|更改国家|change country|change region|¥|₱|RMB|CNY|PHP|USD|SGD|MYR/i;
const REGION_OPTION_CONTAINER_HINT = /billing\s+(?:country|region)|country(?:\s+or\s+region)?|select country|choose country|地区|账单地区|国家|货币/i;
const REGION_COUNTRY_OPTION_SELECTOR = '[role="option"],[role="menuitem"],[role="radio"],button,a,li,[data-country],[data-value]';

async function isRegionMenuOpen(page) {
    const structuredMenus = [
        page.locator('[data-radix-scroll-area-viewport]').last(),
        page.locator('[role="listbox"]').first(),
        page.locator('[role="menu"]').last(),
        page.locator('[data-radix-popper-content-wrapper]').last()
    ];

    for (const menu of structuredMenus) {
        if ((await menu.count().catch(() => 0)) === 0) continue;
        if (await menu.isVisible({ timeout: 500 }).catch(() => false)) {
            const text = await menu.innerText().catch(() => '');
            const isIrrelevantMenu = /(?:Share|Rename|Delete|Archive|Pinned|Unpin|Log out|Settings|Custom instructions|分享|重命名|删除|归档|退出|设置)/i.test(text);
            if (isIrrelevantMenu) continue;
            return true;
        }
    }

    // Newer pricing pages render the country picker as a plain portal/dialog
    // without listbox/menu semantics. Only treat a dialog as the picker when
    // it exposes country text or a country search field; the pricing surface
    // itself may also be a dialog.
    const dialogs = page.locator('[role="dialog"], dialog');
    const count = await dialogs.count().catch(() => 0);
    for (let index = 0; index < Math.min(count, 12); index += 1) {
        const dialog = dialogs.nth(index);
        if (!(await dialog.isVisible({ timeout: 300 }).catch(() => false))) continue;
        const text = normalizeOptionText(await dialog.innerText().catch(() => ''));
        const searchInputs = dialog.locator('input[type="search"], input[placeholder*="search" i], input[placeholder*="搜索" i]');
        const searchCount = await searchInputs.count().catch(() => 0);
        let hasVisibleSearch = false;
        for (let searchIndex = 0; searchIndex < Math.min(searchCount, 8); searchIndex += 1) {
            if (await visible(searchInputs.nth(searchIndex), 250)) {
                hasVisibleSearch = true;
                break;
            }
        }
        const countryOptions = dialog.locator(REGION_COUNTRY_OPTION_SELECTOR).filter({ hasText: /Philippines|United States|Singapore|Malaysia|菲律宾|国家|地区/i });
        const optionCount = await countryOptions.count().catch(() => 0);
        let hasVisibleCountryOption = false;
        for (let optionIndex = 0; optionIndex < Math.min(optionCount, 40); optionIndex += 1) {
            if (await visible(countryOptions.nth(optionIndex), 250)) {
                hasVisibleCountryOption = true;
                break;
            }
        }
        if ((REGION_OPTION_CONTAINER_HINT.test(text) && (hasVisibleSearch || hasVisibleCountryOption))
            || hasVisibleSearch || hasVisibleCountryOption) {
            return true;
        }
    }

    const search = page.locator('[role="listbox"] input, [data-radix-popper-content-wrapper] input, [role="dialog"]:not(#upgrade) input[type="search"]').first();
    return search.isVisible({ timeout: 300 }).catch(() => false);
}

async function closeRegionMenuIfOpen(page) {
    if (!(await isRegionMenuOpen(page))) {
        return;
    }
    const popperOrListbox = page.locator('[data-radix-popper-content-wrapper], [role="listbox"], [data-radix-scroll-area-viewport]').first();
    if (await popperOrListbox.isVisible({ timeout: 250 }).catch(() => false)) {
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(400);
    }
}

async function clickSeeAllPlans(page) {
    const candidates = [
        page.getByRole('link', { name: /^See all plans$/i }).first(),
        page.getByRole('button', { name: /^See all plans$/i }).first(),
        page.getByText(/^See all plans$/i).first(),
        page.getByText(/^查看全部套餐$/i).first(),
        page.getByText(/^查看所有方案$/i).first()
    ];

    for (const candidate of candidates) {
        if ((await candidate.count().catch(() => 0)) === 0) continue;
        if (!(await candidate.isVisible({ timeout: 400 }).catch(() => false))) continue;
        try {
            await candidate.scrollIntoViewIfNeeded().catch(() => {});
            await candidate.click({ timeout: 2000 });
            await page.waitForTimeout(500);
            console.log('[Info] 已点击「See all plans」，正在重新扫描完整套餐页');
            return true;
        } catch (_) { /* try the next representation */ }
    }
    return false;
}

async function openRegionPicker(page, { allowExpandAllPlans = true } = {}) {
    if (await isRegionMenuOpen(page)) {
        console.log('[Info] 地区选择器已打开');
        return true;
    }

    await scrollPricingSurface(page);
    const surface = await getPricingSurface(page);
    const triggerCandidates = [
        surface.locator('[aria-haspopup="listbox"],[aria-haspopup="menu"],[role="combobox"]').last(),
        surface.locator('button[aria-expanded], [role="button"][aria-expanded]').filter({ hasText: ALL_COUNTRY_NAME_PATTERN }).last(),
        page.locator('[role="dialog"] button').filter({ hasText: ALL_COUNTRY_NAME_PATTERN }).last()
    ];

    // The current pricing UI can expose only a currency button such as
    // “Your current plan ¥”, or a plain button labelled “Billing country”.
    // Locate those controls by their visible/accessible label rather than by
    // one particular DOM role or Radix implementation detail.
    const genericControls = page.locator('button,[role="button"],[role="combobox"],a,[data-testid],select');
    // 性能优化：通过单次 page.evaluate 在浏览器内完成全量控件筛选（<5ms），杜绝 260 次 CDP 跨进程往返拖死 88 秒
    const matchingIndices = await page.evaluate(({ skipReStr, entryReStr, countryReStr }) => {
        const skip = new RegExp(skipReStr, 'i');
        const entry = new RegExp(entryReStr, 'i');
        const country = new RegExp(countryReStr, 'i');
        const els = document.querySelectorAll('button,[role="button"],[role="combobox"],a,[data-testid],select');
        const items = [];
        for (let i = 0; i < Math.min(els.length, 200); i += 1) {
            const el = els[i];
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            // 严禁将聊天记录侧边栏或对话项中的按钮误判为地区选择器
            if (el.closest('nav, aside, [data-testid*="sidebar" i], [aria-label*="history" i], [aria-label*="conversation" i], ol, ul')) {
                continue;
            }
            const ariaLabel = el.getAttribute('aria-label') || '';
            const label = (ariaLabel || el.innerText || el.textContent || el.getAttribute('title') || '').trim();
            if (!label || skip.test(label)) continue;
            // 过滤对话历史操作按钮（如 "Open conversation options for ..."）
            if (/conversation|chat history|sidebar|pinned|unpin|rename|delete|archive|share/i.test(label)) {
                continue;
            }
            if (!entry.test(label) && !country.test(label)) continue;
            let score = 0;
            if (/(billing|country|region|currency|地区|账单地区|国家|货币)/i.test(label)) score += 10;
            if (/[¥₱]|RMB|CNY|PHP|USD|SGD|MYR/i.test(label)) score += 6;
            if (el.getAttribute('role') === 'combobox') score += 4;
            items.push({ index: i, score });
        }
        items.sort((a, b) => b.score - a.score);
        return items.slice(0, 10).map(item => item.index);
    }, {
        skipReStr: SKIP_REGION_BUTTON_TEXT.source,
        entryReStr: REGION_ENTRY_HINT.source,
        countryReStr: ALL_COUNTRY_NAME_PATTERN.source
    }).catch(() => []);

    for (const idx of matchingIndices) {
        triggerCandidates.push(genericControls.nth(idx));
    }

    const seen = new Set();
    for (const trigger of triggerCandidates) {
        try {
            if ((await trigger.count().catch(() => 0)) === 0) continue;
            if (!(await trigger.isVisible({ timeout: 1200 }).catch(() => false))) continue;
            const inPicker = await trigger.evaluate((node) => Boolean(node.closest('[role="listbox"], [role="menu"]'))).catch(() => false);
            if (inPicker) continue;
            const text = normalizeOptionText(await readControlLabel(trigger));
            if (!text || seen.has(text)) continue;
            seen.add(text);
            if (SKIP_REGION_BUTTON_TEXT.test(text)) continue;
            await trigger.scrollIntoViewIfNeeded().catch(() => {});
            await trigger.click({ timeout: 1500 });
            await page.waitForTimeout(500);
            if (await isRegionMenuOpen(page)) {
                console.log(`[Info] 已打开地区选择器 (${text.slice(0, 60)})`);
                return true;
            }
        } catch (_) { /* try next */ }
    }

    // The current upgrade modal can hide the billing-country control until the
    // user opens the complete plan catalogue. This is the visible "See all
    // plans" link at the bottom of the modal shown in the latest UI. Do this
    // once, then rescan the newly rendered surface rather than guessing a
    // hidden selector or treating the account currency as the target region.
    if (allowExpandAllPlans && await clickSeeAllPlans(page)) {
        if (await isRegionMenuOpen(page)) {
            return true;
        }
        return openRegionPicker(page, { allowExpandAllPlans: false });
    }

    return false;
}

async function getCountryScrollViewport(page) {
    const candidates = [
        page.locator('[data-radix-scroll-area-viewport]').last(),
        page.locator('[role="listbox"]').first(),
        page.locator('[role="menu"]').last(),
        page.locator('[role="dialog"], dialog').last(),
        page.locator('[data-radix-popper-content-wrapper]').last()
    ];
    for (const candidate of candidates) {
        if ((await candidate.count().catch(() => 0)) === 0) continue;
        if (await candidate.isVisible({ timeout: 1000 }).catch(() => false)) {
            return candidate;
        }
    }
    return null;
}

async function clickExactCountryInViewport(viewport, labels) {
    return viewport.evaluate((root, labelList) => {
        const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const wanted = labelList.map(normalize);
        const elements = Array.from(root.querySelectorAll('[role="option"], [data-index], button, li, div'));

        for (const el of elements) {
            if (!root.contains(el)) {
                continue;
            }
            const lines = String(el.innerText || '').split('\n').map((line) => line.trim()).filter(Boolean);
            if (lines.length !== 1) {
                continue;
            }
            const text = normalize(lines[0]);
            if (!wanted.includes(text)) {
                continue;
            }
            const childHasSame = Array.from(el.children).some((child) => {
                const childLines = String(child.innerText || '').split('\n').map((line) => line.trim()).filter(Boolean);
                return childLines.length === 1 && normalize(childLines[0]) === text;
            });
            if (childHasSame) {
                continue;
            }
            el.scrollIntoView({ block: 'center' });
            el.click();
            return lines[0];
        }
        return '';
    }, labels).catch(() => '');
}

async function scrollVirtualCountryList(page, labels) {
    const targets = (labels || []).map((item) => String(item || '').trim()).filter(Boolean);
    if (!targets.length) {
        return false;
    }

    const viewport = await getCountryScrollViewport(page);
    if (!viewport) {
        console.warn('[Warn] 未找到可滚动的国家列表容器');
        return false;
    }

    await viewport.evaluate((node) => {
        node.scrollTop = 0;
    }).catch(() => {});
    await page.waitForTimeout(250);

    const jumpRatio = targets.some((label) => /philippines|pilipinas|菲律宾/i.test(label)) ? 0.58 : 0.5;
    await viewport.evaluate((node, ratio) => {
        node.scrollTop = Math.floor(node.scrollHeight * ratio);
    }, jumpRatio).catch(() => {});
    await page.waitForTimeout(300);

    // A non-virtual portal/dialog may already contain the target option. Check
    // all aliases in one DOM pass before entering the expensive scroll loop;
    // this also avoids waiting through 160 iterations when the UI uses English
    // labels while the configured region has a Chinese alias first.
    const directPicked = await clickExactCountryInViewport(viewport, targets);
    if (directPicked) {
        console.log(`✅ [步骤] 直接选中地区: ${directPicked}`);
        return true;
    }

    for (let step = 0; step < 160; step += 1) {
        for (const label of targets) {
            const opt = viewport.getByText(new RegExp(`^${escapeRegExp(label)}$`, 'i')).first();
            if ((await opt.count()) > 0) {
                try {
                    await opt.scrollIntoViewIfNeeded({ timeout: 4000 }).catch(() => {});
                    if (await opt.isVisible({ timeout: 300 }).catch(() => false)) {
                        await opt.click({ timeout: 8000 });
                        console.log(`✅ [步骤] Playwright 文本匹配选中: ${label}`);
                        return true;
                    }
                } catch (_) { /* continue scrolling */ }
            }
        }

        const picked = await clickExactCountryInViewport(viewport, targets);
        if (picked) {
            console.log(`✅ [步骤] 虚拟列表第 ${step + 1} 步选中: ${picked}`);
            return true;
        }

        const visibleTexts = await viewport.evaluate((root) => {
            return Array.from(root.querySelectorAll('[role="option"], button, li'))
                .map((el) => String(el.innerText || '').split('\n')[0].trim())
                .filter(Boolean)
                .slice(0, 8);
        }).catch(() => []);
        if (step === 0 || step % 15 === 0) {
            console.log(`[Info] 滚动第 ${step + 1} 步，可见: ${visibleTexts.join(' | ') || '(empty)'}`);
        }
        if (step >= 2 && visibleTexts.length === 0) {
            console.warn('[Warn] 滚动容器内无可识别选项，提前退出无效滚动');
            break;
        }

        const atBottom = await viewport.evaluate((node) => {
            const before = node.scrollTop;
            node.scrollTop += Math.max(72, Math.floor(node.clientHeight * 0.32));
            return node.scrollTop <= before;
        }).catch(() => true);

        await page.waitForTimeout(90);
        if (atBottom) {
            break;
        }
    }

    await viewport.hover().catch(() => {});
    for (let wheel = 0; wheel < 80; wheel += 1) {
        const picked = await clickExactCountryInViewport(viewport, targets);
        if (picked) {
            console.log(`✅ [步骤] 滚轮后选中: ${picked}`);
            return true;
        }
        await page.mouse.wheel(0, 280);
        await page.waitForTimeout(60);
    }

    return false;
}

async function scrollAndSelectCountryOption(page, labels) {
    const targets = (labels || []).map((item) => String(item || '').trim()).filter(Boolean);
    if (!targets.length) {
        return false;
    }

    if (!(await isRegionMenuOpen(page))) {
        return false;
    }

    console.log(`[Info] 开始在虚拟列表中查找: ${targets.join(' / ')}`);

    if (await scrollVirtualCountryList(page, targets)) {
        return true;
    }

    for (const label of targets) {
        if (await tryKeyboardCountryFilter(page, label)) {
            return true;
        }
    }

    return false;
}

async function clickRegionOption(page, label, { allowScroll = true } = {}) {
    const optionLocators = [
        page.getByRole('option', { name: new RegExp(`^${escapeRegExp(label)}$`, 'i') }),
        page.getByRole('menuitem', { name: new RegExp(escapeRegExp(label), 'i') }),
        page.getByRole('radio', { name: new RegExp(escapeRegExp(label), 'i') }),
        page.getByRole('button', { name: new RegExp(`^${escapeRegExp(label)}$`, 'i') }),
        page.locator(`[role="option"]:has-text("${label}")`),
        page.locator(`[role="menuitem"]:has-text("${label}")`),
        page.locator(`li:has-text("${label}")`)
    ];

    // Prefer a directly rendered/portal option. This is both faster and more
    // reliable than entering the virtual-list loop when the target is already
    // in the DOM but the list has no Radix viewport semantics.
    for (const locator of optionLocators) {
        try {
            const el = locator.first();
            if ((await el.count()) === 0) continue;
            const inPicker = await el.evaluate((node) => Boolean(node.closest('[role="listbox"], [role="menu"], [role="dialog"]'))).catch(() => false);
            if (!inPicker) continue;
            await el.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
            if (await el.isVisible({ timeout: 500 })) {
                await el.click({ timeout: 2000 });
                return true;
            }
        } catch (_) { /* try next */ }
    }

    if (allowScroll && await scrollAndSelectCountryOption(page, [label])) {
        return true;
    }
    return false;
}

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function tryKeyboardCountryFilter(page, label) {
    const typeText = String(label || '').trim();
    if (!typeText) {
        return false;
    }

    const viewport = await getCountryScrollViewport(page);
    if (!viewport) {
        return false;
    }

    try {
        await viewport.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(150);
        await page.keyboard.press('Home').catch(() => {});
        await page.waitForTimeout(100);
        await page.keyboard.type(typeText, { delay: 60 });
        await page.waitForTimeout(500);

        const picked = await clickExactCountryInViewport(viewport, [label]);
        if (picked) {
            console.log(`✅ [步骤] 键盘筛选后已选择: ${picked}`);
            return true;
        }

        const option = page.getByRole('option', { name: new RegExp(`^${escapeRegExp(label)}$`, 'i') }).first();
        if (await option.isVisible({ timeout: 1200 }).catch(() => false)) {
            await option.click({ timeout: 8000 });
            console.log(`✅ [步骤] 键盘筛选后已选择: ${label}`);
            return true;
        }
    } catch (_) { /* ignore */ }

    return false;
}

async function readSelectedCountryLabel(page) {
    const candidates = page.locator('button,[role="button"],[role="combobox"],a,[data-testid],label');
    const count = await candidates.count().catch(() => 0);
    for (let index = Math.min(count, 260) - 1; index >= 0; index -= 1) {
        const candidate = candidates.nth(index);
        if (!(await visible(candidate, 250))) continue;
        const isExcluded = await candidate.evaluate((node) => {
            if (node.closest('[role="listbox"], [role="menu"]')) return false;
            if (node.closest('nav, aside, [data-testid*="sidebar" i], [aria-label*="history" i], [aria-label*="conversation" i], ol, ul')) {
                return true;
            }
            return false;
        }).catch(() => false);
        if (isExcluded) continue;
        const label = await readControlLabel(candidate);
        if (!label) continue;
        if (/conversation|chat history|sidebar|pinned|unpin|rename|delete|archive|share|谷歌账号|google account/i.test(label)) {
            continue;
        }
        if (ALL_COUNTRY_NAME_PATTERN.test(label) || (REGION_ENTRY_HINT.test(label) && /country|region|地区|国家|账单/i.test(label))) {
            return label;
        }
    }
    return '';
}

async function selectRegionOption(page, regionCode) {
    const code = String(regionCode || 'PH').toUpperCase();
    const labels = REGION_UI_LABELS[code] || [];
    const preferredLabels = labels.filter((label) => label.length > 2);

    const search = page.locator('input[type="search"], input[placeholder*="Search" i], input[placeholder*="搜索" i]').first();
    if (await search.isVisible({ timeout: 1500 }).catch(() => false)) {
        for (const label of preferredLabels) {
            await search.fill('').catch(() => {});
            await search.fill(label).catch(() => {});
            await page.waitForTimeout(700);
            const viewport = await getCountryScrollViewport(page);
            const picked = viewport
                ? await clickExactCountryInViewport(viewport, [label])
                : '';
            if (picked) {
                console.log(`✅ [步骤] 已通过搜索框选择地区: ${picked}`);
                return verifySelectedCountry(page, preferredLabels);
            }
        }
    }

    // Non-virtual custom pickers often expose the option directly in a portal
    // and do not provide a listbox or Radix scroll viewport. Try the exact
    // accessible option before resorting to long virtual-list scrolling.
    for (const label of preferredLabels) {
        if (await clickRegionOption(page, label, { allowScroll: false })) {
            console.log(`✅ [步骤] 已直接选择地区: ${label}`);
            return verifySelectedCountry(page, preferredLabels);
        }
    }

    if (await scrollAndSelectCountryOption(page, preferredLabels)) {
        return verifySelectedCountry(page, preferredLabels);
    }

    return false;
}

async function verifySelectedCountry(page, labels) {
    await page.waitForTimeout(800);
    const selected = await readSelectedCountryLabel(page);
    if (selected && matchesCountryLabel(selected, labels)) {
        console.log(`✅ [步骤] 地区选择已确认: ${selected}`);
        return true;
    }
    if (selected) {
        console.warn(`[Warn] 地区选择校验失败，当前显示: ${selected}，期望: ${labels.join(' / ')}`);
        return false;
    }
    return true;
}

/** @deprecated 使用 pageShowsTargetRegionPricing */
async function pageShowsCurrency(page, regionCode) {
    return pageShowsTargetRegionPricing(page, regionCode);
}

async function isPricingDialogVisible(page) {
    return (await pricingSurfaceState(await getPricingSurface(page))).identified;
}

async function ensurePricingDialogVisible(page, maxWaitMs = 60000) {
    const startedAt = Date.now();
    const deadline = startedAt + maxWaitMs;
    const remaining = () => Math.max(0, deadline - Date.now());
    const assertOpen = () => {
        if (page.isClosed()) throw new Error('定价页面已关闭，停止唤起套餐弹窗');
    };
    const pause = async (ms) => {
        assertOpen();
        if (remaining()) await page.waitForTimeout(Math.min(ms, remaining()));
    };
    const upgradeLabel = /^(?:Upgrade plan|Upgrade your plan|升级套餐)$/i;
    const attempts = { entry: 0, profile: 0, menu: 0 };
    const maxEntryAttempts = 3;
    const retryCooldownMs = 4000;
    let nextActionAt = startedAt + 500;

    // isVisible is an immediate check. Rescan every candidate on each poll so
    // hydration, a hidden first match, and delayed portal menus are handled.
    const firstActionable = async (locator) => {
        const count = await locator.count();
        for (let i = 0; i < Math.min(count, 40) && remaining(); i += 1) {
            assertOpen();
            const candidate = locator.nth(i);
            if (!await visible(candidate)) continue;
            const allowed = await candidate.evaluate((node) => {
                if (node.closest('[data-message-author-role], [contenteditable], textarea, [role="textbox"], [role="dialog"]')) return false;
                if (!node.matches('button, a[href], [role="button"], [role="menuitem"], [aria-haspopup="menu"]')) return false;
                if (node.matches('a[href]')) {
                    const target = new URL(node.getAttribute('href'), window.location.href);
                    if (target.origin !== window.location.origin || target.pathname !== window.location.pathname
                        || target.hash !== '#pricing') return false;
                }
                return true;
            }, undefined, { timeout: Math.min(500, remaining()) }).catch(() => false);
            if (!allowed || !remaining()) continue;
            if (await candidate.isEnabled({ timeout: Math.min(500, remaining()) }).catch(() => false)) return candidate;
        }
        return null;
    };
    const entryLocators = [
        page.locator('a[href$="#pricing"]'),
        page.getByRole('button', { name: upgradeLabel }),
        page.getByRole('link', { name: upgradeLabel })
    ];
    const profileLocator = page.locator('button[aria-label*="profile" i], [data-testid*="profile" i], [data-testid*="user-menu" i]');
    const menuLocator = page.getByRole('menuitem', { name: /^(?:Upgrade plan|Upgrade your plan|Upgrade|升级套餐|升级)$/i });

    assertOpen();
    await assertNoExpiredSession(page);
    if (await isPricingDialogVisible(page)) return true;
    console.log(`[Info] 正在唤起定价弹窗（最多等待 ${Math.ceil(maxWaitMs / 1000)} 秒）...`);
    // The caller has already navigated. A second goto here would discard a
    // slowly hydrating page and its pending menu/dialog state.
    await page.evaluate(() => {
        window.location.hash = '#pricing';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        window.dispatchEvent(new PopStateEvent('popstate'));
    });
    while (remaining()) {
        assertOpen();
        await assertNoExpiredSession(page);
        if (await isPricingDialogVisible(page)) return true;
        const canTryEntry = Date.now() >= nextActionAt;
        if (canTryEntry || attempts.profile && !attempts.menu) {
            let candidate = null;
            let action = 'entry';
            if (attempts.profile && attempts.menu < maxEntryAttempts) {
                candidate = await firstActionable(menuLocator);
                if (candidate) action = 'menu';
            }
            if (!candidate && canTryEntry && attempts.entry < maxEntryAttempts) {
                for (const locator of entryLocators) {
                    candidate = await firstActionable(locator);
                    if (candidate) break;
                }
            }
            // Open the account menu once and keep waiting for its items. Toggling
            // it again could close a menu that is still being rendered.
            if (!candidate && canTryEntry && !attempts.profile) {
                candidate = await firstActionable(profileLocator);
                if (candidate) action = 'profile';
            }
            assertOpen();
            if (await isPricingDialogVisible(page)) return true;
            if (candidate && remaining()) {
                attempts[action] += 1;
                const label = { entry: '升级套餐入口', profile: '账号菜单', menu: '账号菜单中的升级入口' }[action];
                console.log(`[Info] 唤起定价弹窗：点击${label}（第 ${attempts[action]} 次）`);
                try {
                    await candidate.click({ timeout: Math.min(1500, remaining()) });
                } catch (_) {
                    assertOpen();
                    console.warn(`[Warn] 唤起定价弹窗：${label}暂不可点击，继续等待页面就绪`);
                }
                nextActionAt = Date.now() + retryCooldownMs;
            }
        }
        await pause(250);
    }
    assertOpen();
    if (await isPricingDialogVisible(page)) return true;
    console.warn(`[Warn] 定价弹窗等待超时：已等待 ${((Date.now() - startedAt) / 1000).toFixed(1)} 秒；升级入口 ${attempts.entry} 次，账号菜单 ${attempts.profile} 次，菜单升级入口 ${attempts.menu} 次`);
    return false;
}

async function waitForPricingContentReady(page, timeoutMs = 25000) {
    const deadline = Date.now() + timeoutMs;
    let state;
    do {
        if (page.isClosed()) throw new Error('定价页面已关闭，停止选择套餐');
        await assertNoExpiredSession(page);
        state = await pricingSurfaceState(await getPricingSurface(page));
        if (state.ready) return true;
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await page.waitForTimeout(Math.min(250, remaining));
    } while (Date.now() < deadline);
    throw new Error(state?.loading
        ? '定价内容加载超时（Getting your plan ready），已停止地区选择和套餐点击'
        : '未检测到可用定价内容，已停止地区选择和套餐点击');
}

async function waitForPricingPage(page, timeout = 60000) {
    await page.goto(PRICING_URL, { waitUntil: 'domcontentloaded', timeout });
    await clearHumanVerification(page, { phase: 'pricing-page', maxWaitMs: 120000 });
    await assertChatGptLoggedIn(page, '定价页');

    const opened = await ensurePricingDialogVisible(page, timeout);
    if (!opened) {
        throw new Error('定价弹窗未能成功弹出（页面停留在聊天首页，未展示 Plus/Pro 定价对话框）');
    }

    const url = page.url();
    if (!url.includes('chatgpt.com')) {
        throw new Error(`定价页打开失败，当前 URL: ${url}`);
    }
    console.log('✅ [步骤] 已打开 ChatGPT 定价页 (#pricing)');
    await waitForPricingContentReady(page, 20000);
}

/**
 * 在定价页选择账单地区（Personal 视图下，右下角/弹窗内地区切换）
 */
async function selectPricingRegion(page, regionCode) {
    const code = String(regionCode || 'PH').toUpperCase();
    const regionConfig = getRegionConfig(code);
    console.log(`🌏 [步骤] 正在选择账单地区: ${regionConfig?.label || code}...`);

    await waitForPricingContentReady(page, 15000);

    // 性能优化：轮询等待页面异步渲染价格与货币符号（最多等待 3 秒，每 200ms 检测一次）
    // 真实海外网络下，ChatGPT 客户端通过 API 异步获取区域定价通常需要 1~2 秒。
    // 1. 如果已渲染目标币种（₱ / PHP），立即秒级放行；
    // 2. 如果已明确渲染错误币种（如 ¥），则无需等待空白，立即尝试检测是否有可用选择器。
    for (let wait = 0; wait < 15; wait += 1) {
        const status = await pagePricingStatus(page, code);
        if (status.matches) {
            console.log(`✅ [步骤] 定价页已显示目标地区价格 (${code})，秒级放行`);
            return;
        }
        if (status.wrongCurrency) {
            break;
        }
        await page.waitForTimeout(200);
    }

    const surfacePreview = (await readPricingSurfaceText(page)).replace(/\s+/g, ' ').slice(0, 120);
    console.log(`[Info] 当前定价页片段: ${surfacePreview}`);

    // 快速检测是否存在地区选择器（如测试桩或历史版本弹窗）
    let menuOpen = await isRegionMenuOpen(page);
    if (!menuOpen) {
        menuOpen = await openRegionPicker(page);
    }

    if (menuOpen || await isRegionMenuOpen(page)) {
        const selected = await selectRegionOption(page, code);
        if (selected) {
            await page.waitForTimeout(500);
            if (await pageShowsTargetRegionPricing(page, code)) {
                console.log(`✅ [步骤] 已在定价页切换到目标地区: ${regionConfig?.label || code}`);
                return;
            }
        }
    }

    // 现代 ChatGPT 的定价弹窗根据 IP/现有账户自动展示币种，内部不提供地区选择入口。
    // 账单国家和详细地址将在下一步由 Stripe 收银台 (chatgpt.com/checkout) 准确填写并核算。
    // 非阻塞设计：切勿在此抛出致命异常阻断流程，亦无需无谓死等 30 秒。
    const finalText = (await readPricingSurfaceText(page)).replace(/\s+/g, ' ').slice(0, 160);
    console.warn(`[Warn] 定价页未提供地区选择入口（现代 ChatGPT 账单地区将在 Stripe 收银台选择，当前页面: ${finalText}）。继续进入套餐升级...`);
}

/**
 * 点击对应套餐的升级按钮
 */
async function clickPlanUpgrade(page, planType, options = {}) {
    const plan = String(planType || 'plus').toLowerCase();
    if (!PLAN_UPGRADE_PATTERNS[plan]) throw new Error(`不支持的套餐: ${plan}`);
    console.log(`📦 [步骤] 正在点击升级按钮 (套餐: ${plan})...`);

    if (!options.skipPreflight) {
        await assertChatGptLoggedIn(page, '升级前');
        await waitForPricingContentReady(page, 20000);
        await switchToPersonalPlans(page);
        await page.waitForTimeout(600);
    }

    // 如果是 Pro 系列套餐，检查页面是否有 100/200/500 档位选择框（如“配置你的套餐”页面）
    if (plan.startsWith('pro')) {
        await ensureChatGptProUsageTier(page, plan, { timeout: 2000 }).catch(() => {});
    }

    const target = plan.startsWith('pro') ? 'Pro' : plan === 'go' ? 'Go' : 'Plus';
    const precise = new RegExp(`(?:Upgrade to|Get|Subscribe to|升级至)\\s*${target}\\b`, 'i');
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
        await waitForPricingContentReady(page, Math.min(2000, Math.max(1, deadline - Date.now())));
        const scope = await getPricingSurface(page);
        let chosen = null;
        const buttons = scope.getByRole('button');
        for (let i = 0, count = await buttons.count(); i < count; i += 1) {
            const button = buttons.nth(i);
            if (!await visible(button) || !await button.isEnabled()) continue;
            const label = normalizeOptionText(await button.innerText());
            if (precise.test(label)) { chosen = button; break; }
        }
        if (!chosen) {
            // A generic action is safe only in the nearest card with one exact plan title.
            const titles = scope.getByText(new RegExp(`^(?:ChatGPT\\s+)?${target}$`, 'i'));
            for (let i = 0, count = await titles.count(); i < count && !chosen; i += 1) {
                const title = titles.nth(i);
                if (!await visible(title)) continue;
                const card = title.locator('xpath=ancestor::*[.//button][1]');
                if (!(await card.count())) continue;
                const cardSafe = await card.evaluate((node, wanted) => {
                    const titles = [...node.querySelectorAll('h1,h2,h3,h4,[role="heading"]')]
                        .filter((el) => el.getClientRects().length)
                        .map((el) => (el.textContent || '').replace(/^ChatGPT\s+/i, '').trim())
                        .filter((text) => /^(Free|Go|Plus|Pro|Business)$/i.test(text));
                    const conflictingActions = [...node.querySelectorAll('button')].some((el) => {
                        const match = (el.textContent || '').match(/(?:Upgrade to|Get|Subscribe to|升级至)\s*(Go|Plus|Pro)\b/i);
                        return match && match[1].toLowerCase() !== wanted.toLowerCase();
                    });
                    const leafTitles = [...node.querySelectorAll('*')].filter((el) => el.children.length === 0 && el.getClientRects().length)
                        .map((el) => (el.textContent || '').replace(/^ChatGPT\s+/i, '').trim())
                        .filter((text) => /^(Free|Go|Plus|Pro|Business)$/i.test(text));
                    return !conflictingActions && [...titles, ...leafTitles].every((text) => text.toLowerCase() === wanted.toLowerCase());
                }, target, { timeout: 1500 });
                if (!cardSafe) continue;
                const generic = card.getByRole('button', { name: /^(?:[✦★]\s*)?(?:Start(?: now)?|Upgrade|Subscribe|升级|订阅)$/i });
                for (let j = 0, n = await generic.count(); j < n; j += 1) {
                    if (await visible(generic.nth(j)) && await generic.nth(j).isEnabled()) { chosen = generic.nth(j); break; }
                }
            }
        }
        if (chosen) {
            // One action only: a click timeout may still have created a Checkout request.
            await chosen.click({ timeout: Math.min(10000, Math.max(1, deadline - Date.now())) });
            console.log(`✅ [步骤] 已点击 ${target} 套餐升级按钮`);
            return;
        }
        await page.waitForTimeout(Math.min(250, Math.max(1, deadline - Date.now())));
    }
    throw new Error(`未找到可明确归属 ${target} 套餐的升级按钮，已停止点击`);
}

function isCheckoutDestination(url) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' && (
            (parsed.hostname === 'chatgpt.com' && /^\/checkout(?:\/|$)/.test(parsed.pathname))
            || (parsed.hostname === 'checkout.stripe.com' && /^\/c\//.test(parsed.pathname))
            || (parsed.hostname === 'pay.openai.com' && /^\/(?:c|checkout)\//.test(parsed.pathname))
        );
    } catch (_) { return false; }
}

function observeCheckout(page) {
    const context = page.context();
    const pages = new Set([page]);
    const requests = new Set();
    const responses = new Map();
    const failures = new Map();
    const matches = (request) => {
        try {
            const url = new URL(request.url());
            return request.method() === 'POST' && url.hostname === 'chatgpt.com'
                && url.pathname === '/backend-api/payments/checkout' && pages.has(request.frame().page());
        } catch (_) { return false; }
    };
    const onPopup = (popup) => pages.add(popup);
    const onRequest = (request) => { if (matches(request)) requests.add(request); };
    const onResponse = (response) => {
        const request = response.request();
        if (matches(request)) {
            requests.add(request);
            const record = { status: response.status(), requestSummary: '', detail: '' };
            responses.set(request, record);
            if (record.status >= 400) {
                record.requestSummary = summarizeCheckoutRequest(request);
                // Response events arrive at headers; wait briefly for the error body before reporting.
                record.detailPromise = readCheckoutErrorDetail(response).then(detail => { record.detail = detail; });
            }
        }
    };
    const onFailed = (request) => { if (matches(request)) { requests.add(request); failures.set(request, true); } };
    page.on('popup', onPopup);
    context.on('request', onRequest);
    context.on('response', onResponse);
    context.on('requestfailed', onFailed);
    return {
        pages,
        failure() {
            const failedHttp = [...responses.values()].find((record) => record.status >= 400);
            if (failedHttp) {
                return buildCheckoutHttpFailure(failedHttp.status, failedHttp.detail, failedHttp.requestSummary);
            }
            if (failures.size) return { code: 'CHECKOUT_NETWORK_ERROR', message: 'Checkout 创建请求发生网络错误' };
            return null;
        },
        async resolveFailure() {
            const failedHttp = [...responses.values()].find((record) => record.status >= 400);
            if (failedHttp?.detailPromise) await failedHttp.detailPromise;
            return this.failure();
        },
        timeoutReason() {
            return this.failure() || (!requests.size
                ? { code: 'CHECKOUT_NO_REQUEST', message: '点击后未观察到 Checkout 创建请求或跳转' }
                : [...requests].some((request) => !responses.has(request) && !failures.has(request))
                    ? { code: 'CHECKOUT_REQUEST_PENDING', message: 'Checkout 创建请求尚未返回' }
                    : { code: 'CHECKOUT_NAVIGATION_TIMEOUT', message: 'Checkout 创建接口已响应，但未打开 Checkout 页面' });
        },
        dispose() {
            page.off('popup', onPopup);
            context.off('request', onRequest);
            context.off('response', onResponse);
            context.off('requestfailed', onFailed);
        }
    };
}

function checkoutError(reason) {
    const error = new Error(`${reason.message} [${reason.code}]`);
    error.code = reason.code;
    return error;
}

async function waitForCheckoutPage(page, timeout = 35000, { observer, onCheckoutPage } = {}) {
    const monitor = observer || observeCheckout(page);
    const deadline = Date.now() + timeout;
    console.log('💳 [步骤] 等待 Checkout 页面...');
    try {
        do {
            for (const candidate of monitor.pages) {
                if (candidate.isClosed()) continue;
                const url = candidate.url();
                if (isCheckoutDestination(url)) {
                    await candidate.waitForLoadState('domcontentloaded', { timeout: Math.max(1, Math.min(5000, deadline - Date.now())) }).catch(() => {});
                    await assertChatGptLoggedIn(candidate, 'Checkout');
                    if (onCheckoutPage) await onCheckoutPage(candidate);
                    console.log('✅ [步骤] Checkout 页面已打开');
                    return url;
                }
                if (/^https:\/\/accounts\.google\.com\//.test(url)) throw checkoutError({ code: 'CHECKOUT_AUTH_REQUIRED', message: '升级后跳转到 Google 登录页，Session 未生效' });
            }
            const failure = monitor.failure();
            if (failure) throw checkoutError(await monitor.resolveFailure());
            if ([...monitor.pages].every((candidate) => candidate.isClosed())) {
                throw checkoutError({ code: 'CHECKOUT_PAGE_CLOSED', message: '等待 Checkout 时页面已关闭' });
            }
            if (!page.isClosed()) {
                const pageError = await page.evaluate(() => [...document.querySelectorAll('[role="alert"],[data-sonner-toast],[role="status"]')]
                    .some((node) => node.getClientRects().length && /unusual activity|try again later|something went wrong|failed|blocked|异常|失败/i.test(node.textContent || ''))).catch(() => false);
                if (pageError) throw checkoutError({ code: 'CHECKOUT_PAGE_ERROR', message: '套餐页面显示创建失败提示' });
            }
            const remaining = deadline - Date.now();
            if (remaining <= 0) break;
            // Timer remains usable even when the original tab closes after opening a popup.
            await new Promise((resolve) => setTimeout(resolve, Math.min(200, remaining)));
        } while (Date.now() < deadline);
        throw checkoutError(await monitor.resolveFailure() || monitor.timeoutReason());
    } finally {
        if (!observer) monitor.dispose();
    }
}

/**
 * 解析 ChatGPT Pro 用量档位与界面卡片特征
 * - Pro 500 (max)    -> Max usage   (如 ₱32,490 / $500)
 * - Pro 200 (more)   -> More usage  (如 ₱9,990 / $200)
 * - Pro 100 (standard / 默认) -> Standard (如 ₱6,490 / $100)
 */
function resolveChatGptProUsageTier(planType) {
    const raw = String(planType || '').toLowerCase().trim();
    if (!raw.includes('pro') || raw.startsWith('claude') || raw.startsWith('grok')) {
        return null;
    }
    if (/500|max/i.test(raw)) {
        return {
            id: 'max',
            label: 'Max usage',
            nameRegex: /Max\s*usage|最高用量|最大用量/i,
            priceHints: ['32,490', '32490', '500'],
            amountUsd: 500
        };
    }
    if (/200|20x|more/i.test(raw)) {
        return {
            id: 'more',
            label: 'More usage',
            nameRegex: /More\s*usage|较高用量|更多用量/i,
            priceHints: ['9,990', '9990', '200'],
            amountUsd: 200
        };
    }
    return {
        id: 'standard',
        label: 'Standard',
        nameRegex: /^Standard$|标准/i,
        priceHints: ['6,490', '6490', '100'],
        amountUsd: 100
    };
}

/**
 * 确保在 ChatGPT Pro 结账或套餐配置页面中选中目标用量档位
 * 对应用户规范：
 * - pro 500 对应 max usage   (₱32,490 / $500)
 * - pro 200 对应 more usage  (₱9,990 / $200)
 * - pro 100 对应 standard    (₱6,490 / $100)
 */
async function ensureChatGptProUsageTier(page, planType, options = {}) {
    const tier = resolveChatGptProUsageTier(planType);
    if (!tier) {
        return { handled: false, reason: 'not_pro' };
    }

    const timeout = options.timeout || 12000;
    const deadline = Date.now() + timeout;
    const isStandardTier = tier.id === 'standard';

    console.log(`⚡ [ChatGPT] 检查 Pro 套餐用量档位 (目标: ${tier.label} / ${tier.id}, planType: ${planType})...`);

    while (Date.now() < deadline) {
        // 判断当前页面是否已处于 Checkout / Configure your plan / 档位选择状态
        const pageText = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
        const hasUsageSection = /Choose your usage level|Configure your plan|More usage|Max usage|Standard|设置您的套餐|选择您的用量/i.test(pageText);

        if (!hasUsageSection) {
            await page.waitForTimeout(300);
            continue;
        }

        // 检查页面当前是否已经切实处于目标档位状态（通过页面价格联动确认）
        if (!isStandardTier) {
            const hasTargetPrice = tier.priceHints.some((hint) => {
                const re = new RegExp(`(?:Due today|Total due|Monthly subscription|今日应付|应付)[^\\n]*${hint.replace(/,/g, '[,.]?')}`, 'i');
                return re.test(pageText);
            });
            if (hasTargetPrice) {
                console.log(`✅ [ChatGPT] Pro 用量档位已在目标档位 (页面价格已更新为 ${tier.label}): ${tier.id}`);
                return { handled: true, tier: tier.id, selected: true };
            }
        }

        let clicked = false;

        // 1. 通过 evaluate 在浏览器内部执行原生点击穿透（不受任何外层样式或指针遮挡干扰）
        const evalClicked = await page.evaluate((targetRegexStr) => {
            const re = new RegExp(targetRegexStr, 'i');
            const elements = [...document.querySelectorAll('button, [role="radio"], [role="button"], div, span')];
            const match = elements.find((el) => {
                if (el.children.length > 2) return false;
                const text = (el.textContent || '').trim();
                return re.test(text) && !/ChatGPT Pro|Top features/i.test(text);
            });

            if (match) {
                const card = match.closest('button, [role="radio"], [role="button"], div[class*="rounded"], div[class*="border"]') || match;
                card.scrollIntoView({ behavior: 'instant', block: 'center' });
                card.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                card.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                card.click();
                return true;
            }
            return false;
        }, tier.nameRegex.source).catch(() => false);

        if (evalClicked) {
            console.log(`👉 [ChatGPT] 原生点击切换 Pro 用量档位卡片: ${tier.label} (${tier.id})`);
            clicked = true;
        }

        // 2. 同时使用 Playwright 的定位器执行点击，实现双重保障
        const textLoc = page.getByText(tier.nameRegex).first();
        if (await textLoc.isVisible({ timeout: 400 }).catch(() => false)) {
            const cardParent = textLoc.locator('xpath=ancestor::*[self::button or @role="radio" or @role="button" or contains(@class, "rounded") or contains(@class, "cursor-pointer")][1]');
            if (await cardParent.count() > 0 && await cardParent.isVisible().catch(() => false)) {
                await cardParent.click({ timeout: 2000, force: true }).catch(() => {});
            } else {
                await textLoc.click({ timeout: 2000, force: true }).catch(() => {});
            }
            clicked = true;
        }

        // 3. 价格特征定位兜底
        if (!clicked && tier.priceHints.length) {
            for (const hint of tier.priceHints) {
                const priceRegex = new RegExp(`(?:[₱$€£S]|RM)?\\s*${hint}`, 'i');
                const byPrice = page.locator('button, [role="radio"], [role="button"], div').filter({ hasText: priceRegex }).first();
                if (await byPrice.isVisible({ timeout: 300 }).catch(() => false)) {
                    await byPrice.click({ timeout: 2000, force: true }).catch(() => {});
                    clicked = true;
                    break;
                }
            }
        }

        if (clicked) {
            // 等待页面 React 状态渲染及金额联动
            await page.waitForTimeout(800);
            console.log(`✅ [ChatGPT] 已成功切换并确认 Pro 用量档位: ${tier.label}`);
            return { handled: true, tier: tier.id, clicked: true, selected: true };
        }

        await page.waitForTimeout(400);
    }

    console.warn(`⚠️ [ChatGPT] 未在当前页面检测到 Pro 用量选择卡片（可能处于不同页面结构）`);
    return { handled: false, reason: 'not_found' };
}

async function openPricingCheckout(page, { region, planType, onCheckoutPage }) {
    await waitForPricingPage(page);
    await switchToPersonalPlans(page);
    await selectPricingRegion(page, region);
    const observer = observeCheckout(page);
    try {
        await clickPlanUpgrade(page, planType, { skipPreflight: true });
        const checkoutUrl = await waitForCheckoutPage(page, 35000, { observer, onCheckoutPage });
        await ensureChatGptProUsageTier(page, planType).catch((err) => {
            console.warn('⚠️ [Checkout] Pro 档位选择异常 (非阻塞):', err.message);
        });
        return checkoutUrl;
    } finally {
        observer.dispose();
    }
}

module.exports = {
    PRICING_URL,
    waitForPricingContentReady,
    ensurePricingDialogVisible,
    observeCheckout,
    isCheckoutDestination,
    openPricingCheckout,
    waitForPricingPage,
    selectPricingRegion,
    switchToPersonalPlans,
    clickPlanUpgrade,
    waitForCheckoutPage,
    pageShowsTargetRegionPricing,
    resolveChatGptProUsageTier,
    ensureChatGptProUsageTier
};
