'use strict';

const { getRegionConfig } = require('./region-config');
const { summarizeCheckoutRequest, readCheckoutErrorDetail, buildCheckoutHttpFailure } = require('./checkout-diagnostics');
const { assertChatGptLoggedIn } = require('./session-auth');
const { assertNoExpiredSession } = require('./auth-page-detect');
const { clearHumanVerification } = require('./human-verification');
const { readCheckoutDueAmount } = require('./stripe-payment');

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
    PH: [/£\s*[\d,.]+/, /[\d,.]+\s*£/, /\bGBP\b/i, /United Kingdom/i, /Great Britain/i, /€\s*[\d,.]+/, /[\d,.]+\s*€/, /\bEUR\b/i, /[¥￥]\s*[\d,.]+/, /[\d,.]+\s*[¥￥]/, /\bCNY\b/i, /\bRMB\b/i],
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
        /Rejoin Plus/i,
        /✦\s*Rejoin Plus/i,
        /重新加入\s*Plus/i,
        /重新订阅\s*Plus/i,
        /Start now/i,
        /^Start$/i,
        /✦\s*Start now/i,
        /^Upgrade$/i,
        /Buy now/i,
        /立即购买/i
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
    // 1. 优先检查是否有明确的个人套餐升级按钮（如 + Upgrade to Plus, Rejoin Plus, Upgrade to Pro 等）
    const actions = scope.getByRole('button').filter({ hasText: /(?:Upgrade to|Get|Subscribe to|Rejoin|重新加入|重新订阅|升级至)\s*(?:Plus|Pro)\b/i });
    for (let i = 0, count = await actions.count(); i < count; i += 1) {
        const action = actions.nth(i);
        if (await visible(action) && !await action.evaluate(node => Boolean(node.closest('[data-message-author-role]')))) return true;
    }

    // 2. 检查标题（包含 h1-h6、role=heading 以及卡片顶部独立的 Plus / Pro 标签）
    const titles = scope.locator('h1,h2,h3,h4,h5,h6,[role="heading"],div,span').filter({ hasText: /^(?:ChatGPT\s+)?(?:Plus|Pro)$/i });
    for (let i = 0, count = await titles.count(); i < count; i += 1) {
        const title = titles.nth(i);
        if (await visible(title) && !await title.evaluate(node => Boolean(node.closest('[data-message-author-role]')))) return true;
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

async function waitForPersonalPlanView(page, timeout = 2500) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (await isPersonalPlanView(page)) return true;
        await page.waitForTimeout(200);
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
    // 快速旁路检查：如果页面已在个人套餐视图（有 Upgrade to Plus/Pro 按钮），直接 0ms 秒级放行
    if (await isPersonalPlanView(page)) {
        console.log('✅ [步骤] 已在个人套餐 (Personal/Individual) 视图');
        return;
    }

    // 给 React 卡片异步挂载留出至多 1 秒的就绪轮询，避免前几百毫秒因渲染时差误判进入 Business 切换
    for (let i = 0; i < 5; i += 1) {
        await page.waitForTimeout(200);
        if (await isPersonalPlanView(page)) {
            console.log('✅ [步骤] 已在个人套餐 (Personal/Individual) 视图');
            return;
        }
    }

    console.log(await isBusinessTabActive(page)
        ? '🔄 [步骤] 检测到 Business 标签，正在切换到 Personal/Individual...'
        : '🔄 [步骤] 正在切换到「个人 / Personal / Individual」套餐...');

    // First try a directly rendered Personal/Individual tab or option.
    const clickedDirectPersonal = await clickFirstVisiblePersonalControl(page);
    if (clickedDirectPersonal && await waitForPersonalPlanView(page, 2000)) {
        console.log('✅ [步骤] 已切换到个人套餐 (Personal/Individual)');
        return;
    }

    // On newer pricing surfaces Personal is inside the Business dropdown.
    await openPlanSwitcher(page);
    if (await waitForPersonalPlanView(page, 2000)) {
        console.log('✅ [步骤] 已通过套餐切换器进入个人套餐 (Personal/Individual)');
        return;
    }

    // One final direct attempt handles delayed menu rendering and portals.
    const clickedFinalPersonal = await clickFirstVisiblePersonalControl(page);
    if (clickedFinalPersonal && await waitForPersonalPlanView(page, 1500)) {
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
    const textPattern = /^(?:See|View|Show)\s+all\s+plans$|^查看(?:所有|全部)(?:套餐|方案|计划)$/i;
    const candidates = [
        page.getByRole('link', { name: textPattern }).first(),
        page.getByRole('button', { name: textPattern }).first(),
        page.getByText(textPattern).first(),
        page.locator('button, a, [role="button"], span, p').filter({ hasText: textPattern }).first()
    ];

    for (const candidate of candidates) {
        if ((await candidate.count().catch(() => 0)) === 0) continue;
        if (!(await candidate.isVisible({ timeout: 400 }).catch(() => false))) continue;
        try {
            await candidate.scrollIntoViewIfNeeded().catch(() => {});
            await candidate.click({ timeout: 2000 });
            await page.waitForTimeout(600);
            console.log('✅ [步骤] 已点击「See all plans」，正在展开完整套餐页');
            return true;
        } catch (_) { /* try the next representation */ }
    }

    // DOM 原生 evaluate 穿透点击兜底
    const domClicked = await page.evaluate(() => {
        const re = /^(?:See|View|Show)\s+all\s+plans$|^查看(?:所有|全部)(?:套餐|方案|计划)$/i;
        const all = Array.from(document.querySelectorAll('a, button, [role="button"], span, p, div'));
        for (const el of all) {
            const text = (el.textContent || '').trim();
            if (re.test(text) && el.children.length <= 1) {
                el.scrollIntoView({ block: 'center' });
                el.click();
                return true;
            }
        }
        return false;
    }).catch(() => false);

    if (domClicked) {
        await page.waitForTimeout(600);
        console.log('✅ [步骤] DOM 原生已触发「See all plans」点击，已展开完整套餐页');
        return true;
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
    const maxProfileAttempts = 8;
    const maxMenuAttempts = 5;
    const retryCooldownMs = Number(process.env.PRICING_RETRY_COOLDOWN_MS || 1500);
    let nextActionAt = startedAt + 300;

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
    const profileLocator = page.locator('button[data-testid*="profile" i], button[data-testid="accounts-profile-button"], [data-testid*="user-menu" i], button[aria-label*="profile" i], button:has-text("Free"), div[role="button"]:has-text("Free")');
    const menuLocator = page.locator('[role="menuitem"]:has-text("Upgrade"), [role="menuitem"]:has-text("升级"), [data-testid*="upgrade" i]')
        .or(page.getByRole('menuitem', { name: /Upgrade|升级/i }));

    assertOpen();
    await assertNoExpiredSession(page);
    if (await isPricingDialogVisible(page)) return true;
    console.log(`[Info] 正在唤起定价弹窗（最多等待 ${Math.ceil(maxWaitMs / 1000)} 秒）...`);
    // The caller has already navigated. Re-trigger hash to notify Next.js if already on #pricing
    await page.evaluate(async () => {
        try {
            if (window.location.hash === '#pricing') {
                window.location.hash = '';
                await new Promise(r => setTimeout(r, 60));
            }
            window.location.hash = '#pricing';
            window.dispatchEvent(new HashChangeEvent('hashchange'));
            window.dispatchEvent(new PopStateEvent('popstate'));
        } catch (_) {}
    }).catch(() => {});
    while (remaining()) {
        assertOpen();
        await assertNoExpiredSession(page);
        if (await isPricingDialogVisible(page)) return true;
        const canTryEntry = Date.now() >= nextActionAt;
        if (canTryEntry || attempts.profile && !attempts.menu) {
            let candidate = null;
            let action = 'entry';
            if (attempts.profile && attempts.menu < maxMenuAttempts) {
                candidate = await firstActionable(menuLocator);
                if (candidate) action = 'menu';
            }
            if (!candidate && canTryEntry && attempts.entry < maxEntryAttempts) {
                for (const locator of entryLocators) {
                    candidate = await firstActionable(locator);
                    if (candidate) break;
                }
            }
            // 只要账号菜单尚未弹出且未超最大次数，允许在页面就绪后点击账号菜单唤起
            const isMenuOpen = await menuLocator.first().isVisible({ timeout: 150 }).catch(() => false);
            if (!candidate && canTryEntry && (!attempts.profile || (!isMenuOpen && attempts.profile < maxProfileAttempts))) {
                candidate = await firstActionable(profileLocator);
                if (candidate) action = 'profile';
            }
            assertOpen();
            if (await isPricingDialogVisible(page)) return true;
            if (candidate && remaining()) {
                const label = { entry: '升级套餐入口', profile: '账号菜单', menu: '账号菜单中的升级入口' }[action];
                console.log(`[Info] 唤起定价弹窗：点击${label}（第 ${attempts[action] + 1} 次）`);
                try {
                    await candidate.click({ timeout: Math.min(3500, remaining()) });
                    attempts[action] += 1;
                    if (action === 'profile') {
                        // 账号菜单点击后，微等下拉菜单渲染，快速锁定菜单升级入口
                        await menuLocator.first().waitFor({ state: 'visible', timeout: 1200 }).catch(() => {});
                    }
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
    const currentUrl = page.url ? page.url() : '';
    const alreadyVisible = currentUrl.includes('chatgpt.com') && await isPricingDialogVisible(page).catch(() => false);
    if (alreadyVisible) {
        console.log('✅ [步骤] 定价弹窗已就绪，直接复用当前页面');
    } else {
        await page.goto(PRICING_URL, { waitUntil: 'commit', timeout });
        await clearHumanVerification(page, { phase: 'pricing-page', maxWaitMs: 120000 });
        await assertChatGptLoggedIn(page, '定价页');

        // 极速激活：通知 SPA 挂载 #pricing 弹窗
        await page.evaluate(() => {
            try {
                if (window.location.hash !== '#pricing') {
                    window.location.hash = '#pricing';
                }
                window.dispatchEvent(new HashChangeEvent('hashchange'));
                window.dispatchEvent(new PopStateEvent('popstate'));
            } catch (_) {}
        }).catch(() => {});

        const opened = await ensurePricingDialogVisible(page, timeout);
        if (!opened) {
            throw new Error('定价弹窗未能成功弹出（页面停留在聊天首页，未展示 Plus/Pro 定价对话框）');
        }
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
async function selectPricingRegion(page, regionCode, options = {}) {
    const code = String(regionCode || 'PH').toUpperCase();
    const explicitPlan = options.planType ? String(options.planType).toLowerCase() : null;
    const regionConfig = getRegionConfig(code);
    console.log(`🌏 [步骤] 正在选择账单地区: ${regionConfig?.label || code}...`);

    await waitForPricingContentReady(page, 15000);

    // 1. 等待定价卡片价格真正加载出来（骨架屏消失）
    // 说明：使用海外代理时，ChatGPT 异步拉取 /backend-api/payments/pricing 可能需要 5~15 秒；
    // 在骨架屏未消失前，页面上没有任何价格和地区选择器，必须等待真实价格渲染后才能进行后续匹配。
    const priceLoadTimeout = Number(process.env.PRICING_LOAD_TIMEOUT_MS || (process.env.NODE_ENV === 'test' ? 1000 : 35000));
    const priceLoadDeadline = Date.now() + priceLoadTimeout;
    let initialStatus = await pagePricingStatus(page, code);
    if (!initialStatus.hasPrice) {
        console.log('⏳ [步骤] 定价卡片仍处于骨架加载中 (Skeleton)，等待真实金额与币种渲染...');
        while (Date.now() < priceLoadDeadline) {
            await page.waitForTimeout(400);
            initialStatus = await pagePricingStatus(page, code);
            if (initialStatus.hasPrice) {
                console.log('✅ [步骤] 定价卡片金额与币种已成功渲染');
                break;
            }
        }
    }

    // 等待定价页动态渲染目标地区币种（如 ₱ / PHP）
    // 说明：ChatGPT 前端挂载定价弹窗时，需要向后台异步获取定价配置并完成 Cloudflare / Arkose 反爬遥测 Token 握手；
    // 一旦目标价格（如 ₱1,100）渲染出来，立即秒级放行，既保证反爬 Token 充分就绪避免 HTTP 400 unusual activity，又无多余等待。
    const pollAttempts = Number(process.env.PRICING_REGION_POLL_COUNT || 32);
    const startWaitTime = Date.now();
    for (let wait = 0; wait < pollAttempts; wait += 1) {
        const status = await pagePricingStatus(page, code);
        if (status.matches) {
            // 确保定价弹窗具备足够的反爬握手与 PoW 算力计算时间（至少 2~2.5 秒）
            // 当地区无需切换（如默认 US）时，瞬时放行容易因 Turnstile/Arkose Token 尚未就绪而触发 HTTP 400 unusual activity
            const minSettleMs = Number(process.env.PRICING_SETTLE_MIN_MS ?? (process.env.NODE_ENV === 'test' ? 10 : 2200));
            const elapsed = Date.now() - startWaitTime;
            if (elapsed < minSettleMs) {
                await page.waitForTimeout(minSettleMs - elapsed);
            }
            console.log(`✅ [步骤] 定价页已显示目标地区价格 (${code})，秒级放行`);
            return;
        }
        if (status.wrongCurrency) {
            break;
        }
        await page.waitForTimeout(250);
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
            const switchDeadline = Date.now() + (process.env.NODE_ENV === 'test' ? 1000 : 15000);
            while (Date.now() < switchDeadline) {
                if (await pageShowsTargetRegionPricing(page, code)) {
                    console.log(`✅ [步骤] 已在定价页切换到目标地区: ${regionConfig?.label || code}`);
                    return;
                }
                await page.waitForTimeout(300);
            }
        }
    }

    const finalText = (await readPricingSurfaceText(page)).replace(/\s+/g, ' ').slice(0, 160);
    if (await pageShowsTargetRegionPricing(page, code)) {
        console.log(`✅ [步骤] 地区选择器不可用，但定价币种已确认与目标地区 ${code} 一致`);
        return;
    }
    const reason = !initialStatus.hasPrice
        ? `定价卡片价格加载超时（页面仍处于骨架屏状态，未返回真实金额与币种）`
        : `无法确认定价页面显示的是卡密目标地区 ${code} 的价格`;
    throw Object.assign(
        new Error(`${reason}，已停止套餐升级 [PRICING_REGION_UNCONFIRMED]。当前页面: ${finalText}`),
        { code: 'PRICING_REGION_UNCONFIRMED' }
    );
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
        await ensureChatGptProUsageTier(page, plan, { immediateOnly: true }).catch(() => {});
    }

    const target = plan.startsWith('pro') ? 'Pro' : plan === 'go' ? 'Go' : 'Plus';
    const precise = new RegExp(`(?:[✦★]\\s*)?(?:Upgrade to|Get|Subscribe to|Rejoin|重新加入|重新订阅|升级至)\\s*(?:ChatGPT\\s*)?${target}\\b`, 'i');
    const deadline = Date.now() + 20000;

    let expandedAllPlans = false;
    // 如果目标套餐不是 Plus (如 Pro / Go)，弹窗默认只展示 Free 和 Plus 两张卡片，需主动点击「See all plans」展开完整方案
    if (target.toLowerCase() !== 'plus') {
        console.log(`🔍 [步骤] 目标套餐为 ${target}，优先检查并点击「See all plans」展开完整套餐卡片...`);
        expandedAllPlans = await clickSeeAllPlans(page);
    }

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
                        const match = (el.textContent || '').match(/(?:[✦★]\s*)?(?:Upgrade to|Get|Subscribe to|Rejoin|重新加入|重新订阅|升级至)\s*(Go|Plus|Pro)\b/i);
                        return match && match[1].toLowerCase() !== wanted.toLowerCase();
                    });
                    const leafTitles = [...node.querySelectorAll('*')].filter((el) => el.children.length === 0 && el.getClientRects().length)
                        .map((el) => (el.textContent || '').replace(/^ChatGPT\s+/i, '').trim())
                        .filter((text) => /^(Free|Go|Plus|Pro|Business)$/i.test(text));
                    return !conflictingActions && [...titles, ...leafTitles].every((text) => text.toLowerCase() === wanted.toLowerCase());
                }, target, { timeout: 1500 });
                if (!cardSafe) continue;
                const generic = card.getByRole('button', { name: /^(?:[✦★]\s*)?(?:Start(?: now)?|Get started|Upgrade|Subscribe|Rejoin(?: now)?|Buy now|立即购买|Get\s*(?:ChatGPT\s*)?(?:Pro|Plus|Go)|Rejoin\s*(?:ChatGPT\s*)?(?:Pro|Plus|Go)|升级|订阅|重新加入|重新订阅)$/i });
                for (let j = 0, n = await generic.count(); j < n; j += 1) {
                    if (await visible(generic.nth(j)) && await generic.nth(j).isEnabled()) { chosen = generic.nth(j); break; }
                }
            }
        }
        if (!chosen && !expandedAllPlans) {
            expandedAllPlans = await clickSeeAllPlans(page);
            if (expandedAllPlans) {
                await page.waitForTimeout(500);
                continue;
            }
        }
        if (chosen) {
            // One action only: a click timeout may still have created a Checkout request.
            await chosen.scrollIntoViewIfNeeded().catch(() => {});
            // 模拟真实用户交互轨迹：平滑划向按钮并 hover，满足 Cloudflare / Arkose 遥测要求
            const box = await chosen.boundingBox().catch(() => null);
            if (box && page.mouse) {
                await page.mouse.move(box.x + box.width / 2, box.y - 30, { steps: 5 }).catch(() => {});
                await page.waitForTimeout(100);
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 }).catch(() => {});
            }
            await chosen.hover().catch(() => {});
            const dwellMs = Number(options.dwellMs ?? (process.env.NODE_ENV === 'test' ? 10 : 700));
            if (dwellMs > 0) {
                await page.waitForTimeout(dwellMs);
            }
            const clickTimeout = Math.max(5000, Math.min(10000, deadline - Date.now()));
            await chosen.click({ timeout: clickTimeout });
            console.log(`✅ [步骤] 已点击 ${target} 套餐升级按钮`);
            return;
        }
        await page.waitForTimeout(Math.min(250, Math.max(1, deadline - Date.now())));
    }

    const scopeCheck = await getPricingSurface(page).catch(() => null);
    const alreadySubscribedCard = scopeCheck
        ? await scopeCheck.getByText(/Your current plan|Current plan|当前套餐|当前计划|Manage subscription|Manage my subscription|管理我的订阅/i).first().isVisible().catch(() => false)
        : false;
    if (alreadySubscribedCard) {
        const err = new Error(`该账号已有有效 ${target} 订阅，无需重复充值，请更换其他未订阅账号 [ACCOUNT_ALREADY_SUBSCRIBED]`);
        err.code = 'ACCOUNT_ALREADY_SUBSCRIBED';
        throw err;
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

async function readCheckoutSuccessUrl(response, { timeout = 1500 } = {}) {
    if (!response || (typeof response.text !== 'function' && typeof response.json !== 'function')) return null;
    let timer;
    try {
        return await Promise.race([
            Promise.resolve().then(async () => {
                let data = null;
                if (typeof response.json === 'function') {
                    data = await response.json().catch(() => null);
                }
                if (!data && typeof response.text === 'function') {
                    const text = await response.text().catch(() => '');
                    try { data = JSON.parse(text); } catch (_) { data = null; }
                }
                if (!data || typeof data !== 'object') return null;
                const apiUrl = String(data.url || '').trim();
                if (apiUrl.startsWith('http')) return apiUrl;
                const sessionId = data.checkout_session_id
                    || data.session_id
                    || JSON.stringify(data).match(/cs_(?:live|test)_[A-Za-z0-9]+/)?.[0];
                if (sessionId) {
                    return `https://chatgpt.com/checkout/openai_llc/${sessionId}`;
                }
                return null;
            }).catch(() => null),
            new Promise(resolve => { timer = setTimeout(() => resolve(null), timeout); })
        ]);
    } finally {
        clearTimeout(timer);
    }
}

function observeCheckout(page) {
    const context = page.context();
    const pages = new Set([page]);
    const requests = new Set();
    const responses = new Map();
    const failures = new Map();
    let capturedCheckoutUrl = null;
    let urlResolvingPromise = null;
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
            const record = { status: response.status(), requestSummary: '', detail: '', response };
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
        hasSuccessResponse() {
            return [...responses.values()].some((record) => record.status === 200);
        },
        async resolveCheckoutUrl() {
            if (capturedCheckoutUrl) return capturedCheckoutUrl;
            if (urlResolvingPromise) return urlResolvingPromise;
            const successRecord = [...responses.values()].find((record) => record.status === 200 && record.response);
            if (!successRecord) return null;
            urlResolvingPromise = (async () => {
                const url = await readCheckoutSuccessUrl(successRecord.response);
                if (url) capturedCheckoutUrl = url;
                return url;
            })();
            return urlResolvingPromise;
        },
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
    let directNavAttempted = false;
    let successResponseSeenAt = 0;
    const hijackGraceMs = Number(process.env.CHECKOUT_HIJACK_GRACE_MS || (process.env.NODE_ENV === 'test' ? 300 : 2000));
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

            // 智能优化：如果 Checkout API 已响应 200 但前端 SPA 路由迟缓超过阈值，主动导航至目标链接
            if (!directNavAttempted && monitor.hasSuccessResponse?.() && !page.isClosed()) {
                // 预先解析 Checkout 目标 URL，避免超时后临时 await 产生额外延迟
                monitor.resolveCheckoutUrl?.().catch(() => {});
                if (!successResponseSeenAt) {
                    successResponseSeenAt = Date.now();
                } else if (Date.now() - successResponseSeenAt >= hijackGraceMs) {
                    directNavAttempted = true;
                    monitor.resolveCheckoutUrl?.().then((capturedUrl) => {
                        if (capturedUrl && !page.isClosed()) {
                            const current = page.url();
                            if (!isCheckoutDestination(current)) {
                                console.log(`🚀 [Checkout] 检测到 Checkout 接口已返回但前端路由迟缓，主动导航至: ${capturedUrl.slice(0, 80)}...`);
                                page.goto(capturedUrl, { waitUntil: 'commit', timeout: 30000 }).catch((err) => {
                                    console.warn(`[Checkout] 主动导航异常: ${err.message}`);
                                });
                            }
                        }
                    }).catch(() => {});
                }
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
            amountUsd: 500,
            amountPhp: 32490
        };
    }
    if (/200|20x|more/i.test(raw)) {
        return {
            id: 'more',
            label: 'More usage',
            nameRegex: /More\s*usage|较高用量|更多用量/i,
            priceHints: ['9,990', '9990', '200'],
            amountUsd: 200,
            amountPhp: 9990
        };
    }
    return {
        id: 'standard',
        label: 'Standard',
        nameRegex: /\bStandard\b|标准/i,
        priceHints: ['6,490', '6490', '100'],
        amountUsd: 100,
        amountPhp: 6490
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

    const isStandardTier = tier.id === 'standard';

    const isTargetCheckedInPage = async () => {
        // 1. 优先使用已成熟的 readCheckoutDueAmount 直接跨行精准读取应付金额（覆盖 Due today\n$200.00）
        try {
            const due = await readCheckoutDueAmount(page);
            if (due && typeof due.amount === 'number' && due.amount > 0) {
                if (tier.amountUsd && Math.abs(due.amount - tier.amountUsd) < 0.01) {
                    return true;
                }
                if (tier.amountPhp && Math.abs(due.amount - tier.amountPhp) < 0.01) {
                    return true;
                }
                const dueStr = String(due.amount);
                if (tier.priceHints && tier.priceHints.some((h) => dueStr === h.replace(/,/g, ''))) {
                    return true;
                }
            }
        } catch (_) {}

        // 2. 页面文本与卡片 evaluate 检查
        return page.evaluate(({ nameReStr, priceHints, amountUsd }) => {
            const re = new RegExp(nameReStr, 'i');
            const text = document.body ? document.body.innerText : '';
            // 2.1 价格联动确认（如 Due today\n$200.00 / Monthly subscription\n$200 等）
            // 允许跨最多 64 字符（包含换行符），切勿使用 [^\n]*
            const hasPrice = priceHints.some((hint) => {
                const escapedHint = hint.replace(/,/g, '[,.]?');
                const priceRe = new RegExp(`(?:Due today|Total due|Monthly subscription|今日应付|应付)[^\\d₱$€£]{0,64}?${escapedHint}`, 'i');
                return priceRe.test(text);
            });
            if (hasPrice) return true;

            // 2.2 只有在页面不存在右侧明细栏时（如纯组件单测环境），才降级检查卡片属性
            const hasDueSection = /(?:Due today|Total due|Monthly subscription|今日应付|应付)/i.test(text);
            if (!hasDueSection) {
                const elements = Array.from(document.querySelectorAll('button, [role="radio"], [role="button"], [data-state], div, span'));
                const match = elements.find((el) => {
                    const t = (el.textContent || '').trim();
                    const hasName = re.test(t);
                    const hasP = priceHints.some(p => t.includes(p) || t.includes(String(amountUsd)));
                    if (!hasName || !hasP) return false;
                    if (/ChatGPT Pro|Top features/i.test(t)) return false;
                    const otherTiers = ['Standard', 'More usage', 'Max usage'].filter(name => !re.test(name));
                    if (otherTiers.some(other => (new RegExp(other, 'i')).test(t))) return false;
                    return true;
                });
                if (match) {
                    const card = match.closest('button, [role="radio"], [role="button"], [data-state], [aria-checked], div[class*="rounded"], div[class*="border"]') || match;
                    if (card.getAttribute('aria-checked') === 'true'
                        || card.getAttribute('data-state') === 'checked'
                        || card.getAttribute('aria-selected') === 'true'
                        || card.classList.contains('border-black')) {
                        return true;
                    }
                }
            }
            return false;
        }, { nameReStr: tier.nameRegex.source, priceHints: tier.priceHints, amountUsd: tier.amountUsd }).catch(() => false);
    };

    if (page.__chatgpt_pro_tier_confirmed === tier.id) {
        const stillConfirmed = await isTargetCheckedInPage();
        if (stillConfirmed) {
            console.log(`✅ [ChatGPT] Pro 用量档位已在之前步骤确认 (${tier.label}): ${tier.id}，且页面状态一致，直接跳过重复检测`);
            return { handled: true, tier: tier.id, selected: true, cached: true };
        }
        delete page.__chatgpt_pro_tier_confirmed;
    }

    const currentUrl = page.url ? page.url() : '';
    if (currentUrl.includes('stripe.com') || currentUrl.includes('/pay/')) {
        return { handled: false, reason: 'already_at_stripe' };
    }

    const immediateOnly = Boolean(options.immediateOnly);
    const timeout = options.timeout || 12000;
    const deadline = Date.now() + timeout;

    console.log(`⚡ [ChatGPT] 检查 Pro 套餐用量档位 (目标: ${tier.label} / ${tier.id}, planType: ${planType})...`);

    while (Date.now() < deadline) {
        // 判断当前页面是否已处于 Checkout / Configure your plan / 档位选择状态
        const pageText = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
        const hasUsageSection = /Choose your usage level|Configure your plan|More usage|Max usage|Standard|设置您的套餐|选择您的用量/i.test(pageText);

        if (!hasUsageSection) {
            if (immediateOnly) {
                return { handled: false, reason: 'not_found' };
            }
            await page.waitForTimeout(300);
            continue;
        }

        // 检查页面当前是否已经切实处于目标档位状态（通过页面价格联动或选中状态确认）
        if (await isTargetCheckedInPage()) {
            console.log(`✅ [ChatGPT] Pro 用量档位已在目标档位 (页面状态确认 ${tier.label}): ${tier.id}`);
            page.__chatgpt_pro_tier_confirmed = tier.id;
            return { handled: true, tier: tier.id, selected: true };
        }

        let clicked = false;

        // 策略 1: 真实鼠标物理点击（通过 Playwright boundingBox 获取卡片几何中心）
        const priceRegex = new RegExp(`(?:[₱$]\\s*)?(?:${tier.priceHints.join('|')})\\b`, 'i');
        const cardLocators = [
            page.locator('button, [role="radio"], [role="button"], [data-state], div[class*="rounded"], div[class*="border"]').filter({ hasText: tier.nameRegex }).filter({ hasText: priceRegex }),
            page.locator('button, [role="radio"], [role="button"]').filter({ hasText: tier.nameRegex }),
            page.getByText(tier.nameRegex).locator('xpath=ancestor::*[self::button or @role="radio" or @role="button" or @data-state or contains(@class, "rounded") or contains(@class, "border")][1]')
        ];

        for (const loc of cardLocators) {
            const count = await loc.count().catch(() => 0);
            for (let i = 0; i < count; i += 1) {
                const el = loc.nth(i);
                if (!await el.isVisible({ timeout: 200 }).catch(() => false)) continue;
                const box = await el.boundingBox().catch(() => null);
                if (box && box.width >= 35 && box.height >= 25) {
                    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                    clicked = true;
                    break;
                }
            }
            if (clicked) break;
        }

        // 策略 2: 直接通过 Playwright 定位器点击文字与卡片
        if (!clicked) {
            const textLoc = page.getByText(tier.nameRegex).first();
            if (await textLoc.isVisible({ timeout: 300 }).catch(() => false)) {
                await textLoc.click({ timeout: 2000, force: true }).catch(() => {});
                clicked = true;
            }
        }

        // 策略 3: DOM 原生深度遍历并触发 Pointer/Mouse/Click 全套事件链（仅在前序点击未命中时兜底）
        if (!clicked) {
            const evalClicked = await page.evaluate(({ targetRegexStr, priceHints, amountUsd }) => {
                const re = new RegExp(targetRegexStr, 'i');
                const allElements = Array.from(document.querySelectorAll('button, [role="radio"], [role="button"], [data-state], div, span'));
                const match = allElements.find((el) => {
                    const text = (el.textContent || '').trim();
                    const hasName = re.test(text);
                    const hasPrice = priceHints.some(p => text.includes(p) || text.includes(String(amountUsd)));
                    if (!hasName || !hasPrice) return false;
                    if (/ChatGPT Pro|Top features/i.test(text)) return false;
                    const otherTiers = ['Standard', 'More usage', 'Max usage'].filter(name => !re.test(name));
                    if (otherTiers.some(other => (new RegExp(other, 'i')).test(text))) return false;
                    return text.length < 60;
                });

                if (match) {
                    let clickTarget = match;
                    let p = match;
                    while (p && p !== document.body && p !== document.documentElement) {
                        if (p.tagName === 'BUTTON' || p.getAttribute('role') === 'radio' || p.getAttribute('role') === 'button' || p.hasAttribute('data-state')) {
                            clickTarget = p;
                            break;
                        }
                        const r = p.getBoundingClientRect();
                        if (r.width >= 40 && r.width <= 350 && r.height >= 30 && r.height <= 200) {
                            clickTarget = p;
                        }
                        p = p.parentElement;
                    }
                    clickTarget.scrollIntoView({ behavior: 'instant', block: 'center' });
                    clickTarget.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
                    clickTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                    clickTarget.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
                    clickTarget.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                    clickTarget.click();
                    return true;
                }
                return false;
            }, { targetRegexStr: tier.nameRegex.source, priceHints: tier.priceHints, amountUsd: tier.amountUsd }).catch(() => false);

            if (evalClicked) {
                clicked = true;
            }
        }

        if (clicked) {
            console.log(`👉 [ChatGPT] 已触发切换 Pro 用量档位卡片: ${tier.label} (${tier.id})，等待页面价格联动...`);
            // 点击后主动轮询等待右侧应付金额联动更新（包含后台 API 计算时差与按钮 spinner）
            // 采用 3.5 秒等待上限，若首轮因页面水合未生效可快速触发二轮点击，避免无谓空等
            const verifyDeadline = Date.now() + 3500;
            while (Date.now() < verifyDeadline) {
                await page.waitForTimeout(250);
                if (await isTargetCheckedInPage()) {
                    console.log(`✅ [ChatGPT] Pro 用量档位已成功切换并确认 (页面金额联动确认): ${tier.label}`);
                    page.__chatgpt_pro_tier_confirmed = tier.id;
                    return { handled: true, tier: tier.id, clicked: true, selected: true };
                }
            }
            console.warn(`⚠️ [ChatGPT] 已点击 ${tier.label}，但页面金额尚未联动更新，继续重试...`);
        }

        await page.waitForTimeout(400);
    }

    if (!isStandardTier) {
        throw Object.assign(
            new Error(`Pro 用量档位切换失败：已尝试切换至 ${tier.label}，但页面应付金额仍未变为 ${tier.label} 对应价格 [PRO_TIER_SELECTION_FAILED]`),
            { code: 'PRO_TIER_SELECTION_FAILED' }
        );
    }

    console.warn(`⚠️ [ChatGPT] 未在当前页面检测到 Pro 用量选择卡片（可能处于不同页面结构）`);
    return { handled: false, reason: 'not_found' };
}

async function openPricingCheckout(page, { region, planType, onCheckoutPage, skipPreflight = false, checkoutTimeout = null } = {}) {
    if (!skipPreflight) {
        await waitForPricingPage(page);
        await switchToPersonalPlans(page);
        await selectPricingRegion(page, region, { planType });
    }

    const maxAttempts = Number(process.env.CHECKOUT_CLICK_MAX_ATTEMPTS || 2);
    const timeout = Number(checkoutTimeout || (process.env.NODE_ENV === 'test' ? 3000 : 35000));
    let firstError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const observer = observeCheckout(page);
        try {
            await clickPlanUpgrade(page, planType, { skipPreflight: true });
            const checkoutUrl = await waitForCheckoutPage(page, timeout, { observer, onCheckoutPage });
            await ensureChatGptProUsageTier(page, planType).catch((err) => {
                console.warn('⚠️ [Checkout] Pro 档位选择异常 (非阻塞):', err.message);
            });
            return checkoutUrl;
        } catch (err) {
            observer.dispose();
            if (!firstError) firstError = err;

            const isRetryable = attempt < maxAttempts
                && (err.code === 'CHECKOUT_UNUSUAL_ACTIVITY' || err.code === 'CHECKOUT_PAGE_ERROR' || err.code === 'CHECKOUT_HTTP_ERROR')
                && !page.isClosed();

            if (isRetryable) {
                const cooldownMs = process.env.NODE_ENV === 'test' ? 50 : 5000;
                console.warn(`⚠️ [Checkout] 创建遇到异常 (${err.message})，正在进行冷却重试 (${attempt}/${maxAttempts - 1})...`);
                await page.waitForTimeout(cooldownMs);

                // 智能自愈：如果是因为 unusual activity 导致的 400，当前弹窗和会话状态往往已污染
                // 主动关闭并重新唤起定价弹窗，重置 Cloudflare Turnstile 会话和 PoW 算力上下文
                if (err.code === 'CHECKOUT_UNUSUAL_ACTIVITY' && !page.isClosed()) {
                    console.log('🔄 [Checkout] 遇到风控异常，主动刷新/重开定价弹窗以重置反爬会话...');
                    await page.keyboard.press('Escape').catch(() => {});
                    await page.waitForTimeout(1000);
                    await waitForPricingPage(page).catch(() => {});
                    await switchToPersonalPlans(page).catch(() => {});
                    await selectPricingRegion(page, region, { planType }).catch(() => {});
                }

                const modalVisible = await page.locator('#pricing, [role="dialog"]').first().isVisible().catch(() => false);
                if (modalVisible) {
                    console.log(`🔄 [Checkout] 定价弹窗仍处于开启状态，发起第 ${attempt + 1} 次点击升级...`);
                    continue;
                }
            }
            if (err.code === 'CHECKOUT_NO_REQUEST' && firstError && firstError.code !== 'CHECKOUT_NO_REQUEST') {
                throw firstError;
            }
            throw err;
        }
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
