'use strict';

/**
 * ChatGPT (OpenAI) 自动取消次月续订模块
 *
 * 核心设计：
 * 1. 充值成功后，浏览器上下文已有完整的登录态、Cookie 及 Cloudflare 校验通过凭证；
 * 2. 优先在当前页面上下文通过官方 /backend-api/subscriptions/cancel 接口快速关闭续费；
 * 3. 严格保护当月已付费权益（Plus/Pro），仅关闭次月自动续订（Cancel at period end）；
 * 4. 若接口返回已取消或无需重复取消，均视为成功放行。
 */

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
        // --- 阶段一：在当前页面上下文通过官方 API 快速尝试关闭续费 ---
        const apiResult = await page.evaluate(async ({ timeout }) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), Math.min(timeout, 12000));

            try {
                // 1. 获取当前 session 中的 accountId 与 accessToken
                let accountId = '';
                let accessToken = '';

                try {
                    const sessionResp = await fetch('/api/auth/session', {
                        credentials: 'include',
                        headers: { accept: 'application/json' },
                        signal: controller.signal
                    });
                    if (sessionResp.ok) {
                        const sessionData = await sessionResp.json();
                        accountId = sessionData?.account?.id || sessionData?.user?.id || '';
                        accessToken = sessionData?.accessToken || '';
                    }
                } catch (_) {}

                // 2. 如果未能从 /api/auth/session 获取 accountId，尝试从 /backend-api/me 获取
                if (!accountId) {
                    try {
                        const meHeaders = { accept: 'application/json' };
                        if (accessToken) meHeaders['authorization'] = `Bearer ${accessToken}`;
                        const meResp = await fetch('/backend-api/me', {
                            credentials: 'include',
                            headers: meHeaders,
                            signal: controller.signal
                        });
                        if (meResp.ok) {
                            const meData = await meResp.json();
                            accountId = meData?.account?.id || meData?.id || '';
                        }
                    } catch (_) {}
                }

                // 3. 调用官方取消订阅 API
                const headers = {
                    'content-type': 'application/json',
                    accept: 'application/json'
                };
                if (accessToken) {
                    headers['authorization'] = `Bearer ${accessToken}`;
                }

                const cancelEndpoints = [
                    '/backend-api/subscriptions/cancel',
                    '/backend-api/payments/cancel'
                ];

                for (const endpoint of cancelEndpoints) {
                    try {
                        const cancelResp = await fetch(endpoint, {
                            method: 'POST',
                            credentials: 'include',
                            headers,
                            body: JSON.stringify(accountId ? { account_id: accountId } : {}),
                            signal: controller.signal
                        });

                        if (cancelResp.ok) {
                            const data = await cancelResp.json().catch(() => ({}));
                            return {
                                ok: true,
                                cancelled: true,
                                message: '已成功关闭次月自动续订，本周期内 Plus 权益继续有效',
                                data
                            };
                        }

                        if (cancelResp.status === 400 || cancelResp.status === 409) {
                            const errData = await cancelResp.json().catch(() => ({}));
                            const errStr = JSON.stringify(errData).toLowerCase();
                            if (errStr.includes('already_cancel') || errStr.includes('already cancel')
                                || errStr.includes('will_renew') || errStr.includes('not_active')
                                || errStr.includes('no_active')) {
                                return {
                                    ok: true,
                                    alreadyCancelled: true,
                                    message: '自动续费先前已关闭，下月不会自动扣款',
                                    data: errData
                                };
                            }
                            return {
                                ok: false,
                                canFallbackUi: true,
                                status: cancelResp.status,
                                error: errData.detail || errData.message || '取消订阅接口返回 400/409'
                            };
                        }
                    } catch (_) {}
                }

                return { ok: false, canFallbackUi: true, error: '取消订阅接口请求未完成' };
            } catch (err) {
                return { ok: false, canFallbackUi: true, error: err.message };
            } finally {
                clearTimeout(timer);
            }
        }, { timeout: timeoutMs });

        if (apiResult?.ok) {
            return {
                ok: true,
                cancelled: Boolean(apiResult.cancelled),
                alreadyCancelled: Boolean(apiResult.alreadyCancelled),
                autoRenewRaw: false,
                message: apiResult.message || '已成功关闭次月自动续订',
                data: apiResult.data
            };
        }

        // --- 阶段二：若 API 未直接返回成功，尝试通过前端管理页面执行 UI 确认 ---
        console.log('[ChatGPT/cancel] API 直接调用未直接返回成功，尝试通过页面 UI 确认...');
        try {
            const currentUrl = page.url() || '';
            // 若当前停留在 checkout/verify，先导航至主页或管理页
            if (!currentUrl.includes('chatgpt.com') || currentUrl.includes('/checkout/')) {
                await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
                await page.waitForTimeout(1000);
            }

            // 检查页面是否已提示次月续订已关闭
            const pageContent = await page.content().catch(() => '');
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

            // 寻找可能的取消订阅按钮
            const cancelBtn = page.getByRole('button', { name: /^(Cancel plan|Cancel subscription|取消计划|取消订阅|关闭续费)$/i }).first();
            if (await cancelBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
                await cancelBtn.click({ timeout: 2500 });
                await page.waitForTimeout(1000);

                const confirmBtn = page.getByRole('button', { name: /^(Confirm cancellation|Cancel subscription|Continue to cancel|确认取消|取消计划)$/i }).first();
                if (await confirmBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
                    await confirmBtn.click({ timeout: 2500 });
                    await page.waitForTimeout(1500);
                    return {
                        ok: true,
                        cancelled: true,
                        autoRenewRaw: false,
                        message: '已通过官方页面确认关闭次月自动续订'
                    };
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
    cancelChatGptAutoRenew
};
