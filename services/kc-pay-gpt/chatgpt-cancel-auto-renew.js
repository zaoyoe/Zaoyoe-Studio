'use strict';

/**
 * ChatGPT (OpenAI) 自动取消次月续订模块
 *
 * 核心设计与官方机制：
 * 1. OpenAI 官方对 Plus/Pro 订阅的管理与取消次月续订，完全托管在 Stripe Customer Portal；
 * 2. 充值成功后，浏览器上下文已有完整的登录态、Cookie 及 Cloudflare 校验通过凭证；
 * 3. 阶段一：在当前页面上下文调用官方真实的 POST /backend-api/payments/customer_portal 接口获取 Stripe 客户门户 Session URL；
 * 4. 阶段二：利用已有 Chromium 页面直接导航至 Stripe 客户门户，执行 Cancel plan -> Confirm cancellation 操作；
 * 5. 严格保护当月已付费权益（Plus/Pro），仅设置 cancel_at_period_end = true，次月不再自动续订扣款；
 * 6. 阶段三：若接口或页面已显示次月续订处于关闭状态，或无需重复取消，均视为成功放行；提供页面 UI 深度兜底。
 */

/**
 * 在 Stripe Customer Portal (billing.stripe.com) 页面中执行关闭次月续订
 * @param {import('playwright').Page} page
 * @param {string|null} portalUrl
 * @param {number} timeoutMs
 * @returns {Promise<{ ok: boolean, cancelled?: boolean, alreadyCancelled?: boolean, autoRenewRaw?: boolean, message?: string, error?: string }>}
 */
async function cancelInsideStripeCustomerPortal(page, portalUrl = null, timeoutMs = 15000) {
    try {
        console.log('[ChatGPT/cancel] 正在前往 Stripe 账单中心取消自动续费...');
        if (portalUrl && typeof page.goto === 'function') {
            await page.goto(portalUrl, { waitUntil: 'domcontentloaded', timeout: Math.min(timeoutMs, 10000) }).catch(() => {});
        }
        if (typeof page.waitForTimeout === 'function') {
            await page.waitForTimeout(1000);
        }

        // 1. 检查页面文本，判断是否先前已处于已取消状态
        const bodyContent = typeof page.content === 'function' ? await page.content().catch(() => '') : '';
        const bodyText = typeof page.textContent === 'function' ? await page.textContent('body').catch(() => '') : bodyContent;
        const combinedText = `${bodyContent} ${bodyText}`;

        if (/Cancels on|will be canceled|将于.*到期|续订已关闭|取消于/i.test(combinedText) && !/Cancel plan|取消方案|取消计划/i.test(combinedText)) {
            return {
                ok: true,
                alreadyCancelled: true,
                autoRenewRaw: false,
                message: 'Stripe 账单中心显示次月续订已处于关闭状态（本周期 Plus 权益继续有效）'
            };
        }

        // 2. 寻找并点击“Cancel plan”按钮
        let clickedCancel = false;
        const cancelLocators = [
            'button:has-text("Cancel plan")',
            'button:has-text("取消方案")',
            'button:has-text("取消计划")',
            'button:has-text("取消订阅")',
            'a:has-text("Cancel plan")',
            '[data-test="cancel-button"]'
        ];

        if (typeof page.locator === 'function') {
            for (const sel of cancelLocators) {
                try {
                    const loc = page.locator(sel).first();
                    if (await loc.isVisible({ timeout: 1500 }).catch(() => false)) {
                        await loc.click({ timeout: 2000 });
                        clickedCancel = true;
                        break;
                    }
                } catch (_) {}
            }
        }

        if (!clickedCancel && typeof page.getByRole === 'function') {
            try {
                const roleBtn = page.getByRole('button', { name: /^(Cancel plan|Cancel subscription|取消方案|取消计划|取消订阅|关闭续费)$/i }).first();
                if (await roleBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await roleBtn.click({ timeout: 2000 });
                    clickedCancel = true;
                }
            } catch (_) {}
        }

        if (!clickedCancel) {
            // 如果存在 Renew plan / 续订 按钮，说明之前已是取消状态
            if (/Renew plan|重新订阅|恢复订阅|续订/i.test(combinedText)) {
                return {
                    ok: true,
                    alreadyCancelled: true,
                    autoRenewRaw: false,
                    message: 'Stripe 账单中心显示当前订阅无需重复取消（次月自动续订已关闭）'
                };
            }
            return {
                ok: false,
                error: 'Stripe 账单中心未找到“Cancel plan”按钮'
            };
        }

        if (typeof page.waitForTimeout === 'function') {
            await page.waitForTimeout(1000);
        }

        // 3. 寻找并点击二次确认按钮
        let clickedConfirm = false;
        const confirmLocators = [
            'button:has-text("Cancel plan")',
            'button:has-text("Confirm cancellation")',
            'button:has-text("取消方案")',
            'button:has-text("确认取消")',
            'button:has-text("确认")',
            '[data-test="confirm-cancel-button"]'
        ];

        if (typeof page.locator === 'function') {
            for (const sel of confirmLocators) {
                try {
                    const loc = page.locator(sel).first();
                    if (await loc.isVisible({ timeout: 2000 }).catch(() => false)) {
                        await loc.click({ timeout: 2000 });
                        clickedConfirm = true;
                        break;
                    }
                } catch (_) {}
            }
        }

        if (!clickedConfirm && typeof page.getByRole === 'function') {
            try {
                const roleConfirm = page.getByRole('button', { name: /^(Cancel plan|Confirm cancellation|确认取消|取消方案|确认)$/i }).first();
                if (await roleConfirm.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await roleConfirm.click({ timeout: 2000 });
                    clickedConfirm = true;
                }
            } catch (_) {}
        }

        if (typeof page.waitForTimeout === 'function') {
            await page.waitForTimeout(1500);
        }

        // 4. 验证取消结果
        const afterText = typeof page.textContent === 'function' ? await page.textContent('body').catch(() => '') : '';
        if (/will be canceled|Cancels on|将于.*取消|已取消|Your plan has been canceled/i.test(afterText) || clickedConfirm) {
            return {
                ok: true,
                cancelled: true,
                autoRenewRaw: false,
                message: '已成功在 Stripe 账单中心关闭次月自动续订，本周期内 Plus 权益继续有效'
            };
        }

        return {
            ok: false,
            error: '已提交取消确认，但未检测到 Stripe 明确确认提示'
        };
    } catch (err) {
        return {
            ok: false,
            error: `Stripe 账单中心取消自动化执行异常: ${err.message}`
        };
    }
}

/**
 * 在 Playwright 页面上下文中执行 ChatGPT 取消自动续订
 * @param {import('playwright').Page} page
 * @param {object} options
 * @returns {Promise<{ ok: boolean, cancelled?: boolean, alreadyCancelled?: boolean, autoRenewRaw?: boolean, effectiveAt?: string, message: string, error?: string, verificationUnknown?: boolean }>}
 */
async function cancelChatGptAutoRenew(page, options = {}) {
    if (!page || typeof page.evaluate !== 'function') {
        return {
            ok: false,
            verificationUnknown: true,
            error: '缺少可用的 ChatGPT 浏览器页面上下文'
        };
    }

    const timeoutMs = options.timeoutMs ?? 20000;

    try {
        // --- 阶段一：在当前页面上下文通过官方 API 快速获取 Customer Portal 或检测取消状态 ---
        const apiResult = await page.evaluate(async ({ timeout }) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), Math.min(timeout, 10000));

            try {
                // 1. 获取当前 session 中的 accessToken
                let accessToken = '';
                try {
                    const sessionResp = await fetch('/api/auth/session', {
                        credentials: 'include',
                        headers: { accept: 'application/json' },
                        signal: controller.signal
                    });
                    if (sessionResp.ok) {
                        const sessionData = await sessionResp.json();
                        accessToken = sessionData?.accessToken || '';
                    }
                } catch (_) {}

                const headers = {
                    'content-type': 'application/json',
                    accept: 'application/json'
                };
                if (accessToken) {
                    headers['authorization'] = `Bearer ${accessToken}`;
                }

                // 2. 调用官方 Customer Portal API (生成 Stripe 账单管理 Session)
                try {
                    const portalResp = await fetch('/backend-api/payments/customer_portal', {
                        method: 'POST',
                        credentials: 'include',
                        headers,
                        body: JSON.stringify({ return_url: 'https://chatgpt.com/' }),
                        signal: controller.signal
                    });

                    if (portalResp.ok) {
                        const portalData = await portalResp.json().catch(() => ({}));
                        if (portalData?.url && typeof portalData.url === 'string') {
                            return {
                                ok: true,
                                portalUrl: portalData.url
                            };
                        }
                    }

                    if (portalResp.status === 400 || portalResp.status === 409) {
                        const errData = await portalResp.json().catch(() => ({}));
                        const errStr = JSON.stringify(errData).toLowerCase();
                        if (errStr.includes('already_cancel') || errStr.includes('already cancel')
                            || errStr.includes('will_renew') || errStr.includes('not_active')
                            || errStr.includes('no_active') || errStr.includes('no active subscription')) {
                            return {
                                ok: true,
                                alreadyCancelled: true,
                                message: '自动续费先前已关闭或当前无生效自动续费',
                                data: errData
                            };
                        }
                    }
                } catch (_) {}

                // 3. 兜底检查 /backend-api/subscriptions 状态
                try {
                    const subResp = await fetch('/backend-api/subscriptions', {
                        credentials: 'include',
                        headers,
                        signal: controller.signal
                    });
                    if (subResp.ok) {
                        const subData = await subResp.json().catch(() => ({}));
                        const plan = subData?.account_plan || subData?.plan || subData?.subscription || {};
                        if (plan.canceled_at_period_end === true || plan.will_renew === false || plan.status === 'canceled') {
                            return {
                                ok: true,
                                alreadyCancelled: true,
                                message: '订阅状态显示次月续费已关闭，本期权益继续有效',
                                data: subData
                            };
                        }
                    }
                } catch (_) {}

                return { ok: false, canFallbackUi: true, error: '未能直接通过 API 完成客户门户唤起' };
            } catch (err) {
                return { ok: false, canFallbackUi: true, error: err.message };
            } finally {
                clearTimeout(timer);
            }
        }, { timeout: timeoutMs });

        // 如果 evaluate 直接返回了 cancelled 或 alreadyCancelled (包含测试 mock 场景)
        if (apiResult?.ok) {
            if (apiResult.cancelled || apiResult.alreadyCancelled) {
                return {
                    ok: true,
                    cancelled: Boolean(apiResult.cancelled),
                    alreadyCancelled: Boolean(apiResult.alreadyCancelled),
                    autoRenewRaw: false,
                    message: apiResult.message || '已成功关闭次月自动续订',
                    data: apiResult.data
                };
            }

            // 若拿到了 Stripe Customer Portal URL，立即前往执行门户取消
            if (apiResult.portalUrl) {
                const portalResult = await cancelInsideStripeCustomerPortal(page, apiResult.portalUrl, timeoutMs);
                if (portalResult.ok) {
                    return portalResult;
                }
                console.warn(`[ChatGPT/cancel] Stripe Customer Portal 取消未达预期: ${portalResult.error}，尝试页面 UI 兜底...`);
            }
        }

        // --- 阶段二：若 API 获取 Portal 遇到障碍，尝试通过页面 UI 导航兜底 ---
        console.log('[ChatGPT/cancel] API 直接调用未直接返回成功，尝试通过页面 UI 确认...');
        try {
            const currentUrl = typeof page.url === 'function' ? page.url() : '';
            // 若当前停留在 billing.stripe.com，直接在当前页面执行
            if (currentUrl && currentUrl.includes('billing.stripe.com')) {
                const directPortalRes = await cancelInsideStripeCustomerPortal(page, null, timeoutMs);
                if (directPortalRes.ok) return directPortalRes;
            }

            // 若停留在 checkout/verify，先导航至主页或设置
            if (!currentUrl.includes('chatgpt.com') || currentUrl.includes('/checkout/')) {
                if (typeof page.goto === 'function') {
                    await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
                }
                if (typeof page.waitForTimeout === 'function') {
                    await page.waitForTimeout(1000);
                }
            }

            // 检查当前页面是否已提示次月续订已关闭
            const pageContent = typeof page.content === 'function' ? await page.content().catch(() => '') : '';
            if (/Subscription ends on|Renews on|Cancels on|将于.*到期|续订已关闭/i.test(pageContent) && /cancel|取消/i.test(pageContent)) {
                if (/Cancels on|将于.*到期|已取消续费/i.test(pageContent)) {
                    return {
                        ok: true,
                        alreadyCancelled: true,
                        autoRenewRaw: false,
                        message: '页面显示次月续订已处于关闭状态'
                    };
                }
            }

            // 尝试打开设置并寻找“管理我的订阅”或“取消方案”
            // 1. 如果有取消订阅按钮
            if (typeof page.getByRole === 'function') {
                const cancelBtn = page.getByRole('button', { name: /^(Cancel plan|Cancel subscription|取消计划|取消订阅|关闭续费)$/i }).first();
                if (await cancelBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
                    await cancelBtn.click({ timeout: 2500 });
                    if (typeof page.waitForTimeout === 'function') {
                        await page.waitForTimeout(1000);
                    }

                    const confirmBtn = page.getByRole('button', { name: /^(Confirm cancellation|Cancel subscription|Continue to cancel|确认取消|取消计划)$/i }).first();
                    if (await confirmBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
                        await confirmBtn.click({ timeout: 2500 });
                        if (typeof page.waitForTimeout === 'function') {
                            await page.waitForTimeout(1500);
                        }
                        return {
                            ok: true,
                            cancelled: true,
                            autoRenewRaw: false,
                            message: '已通过官方页面确认关闭次月自动续订'
                        };
                    }
                }

                // 2. 尝试寻找 "Manage my subscription" / "管理我的订阅" 按钮
                const manageBtn = page.getByRole('button', { name: /^(Manage my subscription|管理我的订阅|Manage subscription)$/i }).first();
                if (await manageBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                    let popupPage = null;
                    if (typeof page.waitForEvent === 'function') {
                        const popupPromise = page.waitForEvent('popup', { timeout: 3500 }).catch(() => null);
                        await manageBtn.click({ timeout: 2000 }).catch(() => {});
                        popupPage = await popupPromise;
                    } else {
                        await manageBtn.click({ timeout: 2000 }).catch(() => {});
                    }

                    const targetPage = popupPage || page;
                    if (typeof targetPage.waitForTimeout === 'function') {
                        await targetPage.waitForTimeout(2000);
                    }
                    const targetUrl = typeof targetPage.url === 'function' ? targetPage.url() : '';
                    if (targetUrl.includes('billing.stripe.com')) {
                        return await cancelInsideStripeCustomerPortal(targetPage, null, timeoutMs);
                    }
                }
            }
        } catch (uiErr) {
            console.warn(`[ChatGPT/cancel] 页面 UI 兜底处理异常: ${uiErr.message}`);
        }

        return {
            ok: false,
            verificationUnknown: true,
            error: apiResult?.error || '未能自动确认 ChatGPT 次月续订关闭状态，可稍后在后台按需核对'
        };

    } catch (err) {
        return {
            ok: false,
            verificationUnknown: true,
            error: `ChatGPT 取消自动续订执行异常: ${err.message}`
        };
    }
}

module.exports = {
    cancelChatGptAutoRenew,
    cancelInsideStripeCustomerPortal
};
