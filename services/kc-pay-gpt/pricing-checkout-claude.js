'use strict';

/**
 * Claude (Anthropic) 升级至 Pro / Stripe 结账唤起模块
 */

const { prepareClaudeCheckout } = require('./claude-checkout-recovery');

async function ensureClaudeCheckoutTier(page, planType) {
    return prepareClaudeCheckout(page, planType, { phase: 'before_card_entry', paymentState: 'not_started' });
}

/**
 * 在 /upgrade 套餐对比页中精确点击对应套餐的升级按钮（支持中英文、a/button/div 各种现代变体）
 */
async function clickUpgradePlanButton(page, { isMaxPlan, isAnnual }) {
    const planKeyword = isMaxPlan ? 'Max' : 'Pro';

    // 1. 若目标为按年，先尝试切换页面顶部的计费周期开关
    if (isAnnual && !isMaxPlan) {
        try {
            const annualSwitch = page.locator('button, [role="tab"], div').filter({ hasText: /按年计费|Annual/i }).first();
            if (await annualSwitch.isVisible().catch(() => false)) {
                await annualSwitch.click({ timeout: 2000 }).catch(() => {});
                console.log('📅 [Claude] 已切换定价卡片为“按年计费”');
            }
        } catch (_) {}
    }

    // 2. 精准定位器候选列表（包含当前页面实际展示的“获取 Pro 套餐”与“获取 Max 套餐”）
    const candidates = isMaxPlan ? [
        page.locator('button, a, [role="button"]').filter({ hasText: /获取\s*Max\s*套餐|Get\s*Max\s*plan|获取\s*Max|Get\s*Max|Upgrade to Max/i }).first(),
        page.getByRole('button', { name: /获取\s*Max|Get\s*Max|Upgrade to Max/i }).first(),
        page.getByRole('link', { name: /获取\s*Max|Get\s*Max|Upgrade to Max/i }).first(),
        page.locator('div').filter({ hasText: /Max/ }).filter({ hasText: /\$100/ }).locator('button, a, [role="button"]').first(),
        page.locator('a[href*="/upgrade/max"]').first()
    ] : [
        page.locator('button, a, [role="button"]').filter({ hasText: /获取\s*Pro\s*套餐|Get\s*Pro\s*plan|获取\s*Pro|Get\s*Pro|Upgrade to Pro/i }).first(),
        page.getByRole('button', { name: /获取\s*Pro|Get\s*Pro|Upgrade to Pro/i }).first(),
        page.getByRole('link', { name: /获取\s*Pro|Get\s*Pro|Upgrade to Pro/i }).first(),
        page.locator('button:has-text("获取 Pro 套餐"), a:has-text("获取 Pro 套餐")').first(),
        page.locator('button:has-text("Get Pro"), a:has-text("Get Pro")').first(),
        // 卡片范围限定（含 Pro 和 $20 的卡片内任意点击元素）
        page.locator('div').filter({ hasText: /Pro/ }).filter({ hasText: /\$20/ }).locator('button, a, [role="button"]').first(),
        page.locator('a[href*="/upgrade/pro"]').first()
    ];

    for (const loc of candidates) {
        try {
            // 使用 waitFor 确保 React 组件挂载完成，避免 isVisible() 瞬时返回 false
            await loc.waitFor({ state: 'visible', timeout: 2500 });
            await loc.scrollIntoViewIfNeeded().catch(() => {});
            const text = (await loc.innerText().catch(() => 'Button')).trim();
            console.log(`👆 [Claude] 点击套餐升级按钮: ${text}`);
            await loc.click({ timeout: 6000 });
            console.log(`✅ [Claude] 已点击套餐升级按钮 (${text})`);
            return true;
        } catch (_) {}
    }

    // 3. 兜底方案：通过 DOM 遍历查找包含目标文本的可见按钮或链接
    try {
        const clickedByDom = await page.evaluate((keyword) => {
            const re = keyword === 'Max'
                ? /获取\s*Max\s*套餐|Get\s*Max|Upgrade to Max/i
                : /获取\s*Pro\s*套餐|Get\s*Pro|Upgrade to Pro/i;
            const elements = Array.from(document.querySelectorAll('button, a, [role="button"], div[role="button"]'));
            for (const el of elements) {
                if (re.test(el.textContent || '')) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        el.click();
                        return true;
                    }
                }
            }
            return false;
        }, planKeyword);
        if (clickedByDom) {
            console.log(`✅ [Claude] 通过 DOM 评估快速点击套餐按钮 (${planKeyword})`);
            return true;
        }
    } catch (_) {}

    return false;
}

async function openClaudeCheckout(page, options = {}) {
    const planType = options.planType || 'claude_pro';
    const isAnnual = /annual|yearly|年/i.test(planType);
    const isMaxPlan = planType.toLowerCase().includes('max');
    const planDesc = isMaxPlan ? (/200|20x/i.test(planType) ? 'Max 200 (20x) $200' : 'Max 100 (5x) $100') : (isAnnual ? 'Pro 年费 $200' : 'Pro 月费 $20');
    console.log(`[Claude] 正在唤起 ${planType} (${planDesc}) 的 Stripe Checkout 页面...`);

    let capturedStripeUrl = '';

    // 监听网络响应以捕获 Stripe 支付链接
    const responseHandler = async (res) => {
        try {
            const url = res.url();
            if (res.status() >= 200 && res.status() < 300) {
                if (url.includes('/billing/checkout') || url.includes('/checkout')) {
                    const data = await res.json().catch(() => null);
                    if (data && (data.url || data.checkout_url || data.checkoutUrl)) {
                        const targetUrl = data.url || data.checkout_url || data.checkoutUrl;
                        if (targetUrl.includes('stripe.com')) {
                            capturedStripeUrl = targetUrl;
                            console.log(`✅ [Claude] 成功从 API 捕获 Stripe Checkout 链接: ${capturedStripeUrl.slice(0, 60)}...`);
                        }
                    }
                }
            }
        } catch (_) {}
    };

    page.on('response', responseHandler);

    try {
        // 1. 计算目标升级 URL（月付与年付均可优先直达原生结账页）
        const targetUpgradeUrl = isMaxPlan
            ? 'https://claude.ai/upgrade/max'
            : (isAnnual ? 'https://claude.ai/upgrade/pro?interval=annual' : 'https://claude.ai/upgrade/pro');

        const currentUrl = page.url();
        const alreadyOnUpgradeRoute = currentUrl.includes('/upgrade');

        // 若当前页面不在升级相关路由上，才发起页面导航
        if (!alreadyOnUpgradeRoute) {
            console.log(`🔗 [Claude] 打开套餐选择/结账页 (${targetUpgradeUrl})...`);
            await page.goto(targetUpgradeUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 35000
            }).catch(async () => {
                console.log('⚠️ [Claude] 目标升级页加载超时，尝试打开 upgrade 备用页...');
                return page.goto('https://claude.ai/upgrade', { waitUntil: 'domcontentloaded', timeout: 30000 });
            });
        } else {
            console.log(`⚡ [Claude] 当前已在升级路由 (${currentUrl})，跳过重复导航`);
        }

        // 2. 检查是否已经处于 Stripe 结账页或 Claude 原生结账页
        if (page.url().includes('checkout.stripe.com')) {
            console.log('✅ [Claude] 页面已自动跳转至 Stripe Checkout');
            return { success: true, url: page.url() };
        }
        if (/\/upgrade\/(pro|max)/i.test(page.url())) {
            await ensureClaudeCheckoutTier(page, planType);
            console.log(`✅ [Claude] 页面已处于 Claude 原生结账页: ${page.url()}`);
            return { success: true, url: page.url(), isCustomCheckout: true };
        }

        // 3. 若处于 3 卡片营销页 (/upgrade)，执行精准按钮点击
        const planKeyword = isMaxPlan ? 'Max' : 'Pro';
        console.log(`🔍 [Claude] 寻找“${planKeyword}”套餐升级按钮 (中英文匹配)...`);
        await clickUpgradePlanButton(page, { isMaxPlan, isAnnual });

        // 4. 等待跳转至 Stripe 或进入内嵌收银台（带主动补偿重试机制）
        console.log('⏳ [Claude] 等待跳转至 Stripe Checkout 或加载内嵌收银台...');
        const deadline = Date.now() + 35000;
        let lastRetryClickTime = Date.now();

        while (Date.now() < deadline) {
            if (page.url().includes('checkout.stripe.com')) {
                console.log(`✅ [Claude] 成功进入 Stripe 结账页: ${page.url().slice(0, 60)}...`);
                return { success: true, url: page.url() };
            }
            if (capturedStripeUrl) {
                console.log(`🔗 [Claude] 打开已捕获的 Stripe 链接: ${capturedStripeUrl.slice(0, 60)}...`);
                await page.goto(capturedStripeUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
                return { success: true, url: capturedStripeUrl };
            }
            if (/\/upgrade\/(pro|max)/i.test(page.url())) {
                await ensureClaudeCheckoutTier(page, planType);
                console.log(`✅ [Claude] 成功进入 Claude 原生结账页: ${page.url()}`);
                return { success: true, url: page.url(), isCustomCheckout: true };
            }
            const hasCheckoutForm = await page.locator('button:has-text("订阅"), button:has-text("Subscribe")').first().isVisible({ timeout: 500 }).catch(() => false);
            if (hasCheckoutForm && page.url().includes('/upgrade')) {
                await ensureClaudeCheckoutTier(page, planType);
                console.log(`✅ [Claude] 检测到内嵌结账表单与订阅按钮: ${page.url()}`);
                return { success: true, url: page.url(), isCustomCheckout: true };
            }

            // 🌟 核心补偿机制：如果仍在 /upgrade 对比页且未跳转，每 2.5 秒主动再次触发点击
            if (page.url().endsWith('/upgrade') || page.url().includes('/upgrade?')) {
                if (Date.now() - lastRetryClickTime >= 2500) {
                    console.log('🔄 [Claude] 仍在套餐对比页，再次尝试定位并点击目标套餐按钮...');
                    await clickUpgradePlanButton(page, { isMaxPlan, isAnnual });
                    lastRetryClickTime = Date.now();
                }
            }

            await page.waitForTimeout(600);
        }

        throw new Error('未能在预期时间内唤起 Claude 的 Stripe 结账页面，请确认账号当前是否已有活跃订阅或受风控限制');
    } finally {
        page.off('response', responseHandler);
    }
}

module.exports = {
    openClaudeCheckout
};
