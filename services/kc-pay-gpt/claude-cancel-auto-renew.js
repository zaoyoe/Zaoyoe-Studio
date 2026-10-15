'use strict';

/**
 * Claude (Anthropic) 自动取消次月续订模块
 * 
 * 核心设计：
 * 1. 优先调用官方 /api/organizations/{orgId}/billing/cancel_subscription 接口；
 * 2. 若 API 需要跳转 Stripe Billing Portal 或前端交互，则自动导航至账单管理页完成取消流程；
 * 3. 严格保护当月已付费权益（Pro/Max），仅关闭次月自动续订（Cancel at period end）。
 */

/**
 * 在 Playwright 页面上下文中执行 Claude 取消自动续订
 * @param {import('playwright').Page} page
 * @param {object} options
 * @returns {Promise<{ ok: boolean, cancelled?: boolean, alreadyCancelled?: boolean, autoRenewRaw?: boolean, effectiveAt?: string, message: string, error?: string, verificationUnknown?: boolean }>}
 */
async function cancelClaudeAutoRenew(page, options = {}) {
    if (!page || typeof page.evaluate !== 'function') {
        return {
            ok: false,
            verificationUnknown: true,
            error: '缺少可用的 Claude 浏览器页面上下文'
        };
    }

    const timeoutMs = options.timeoutMs ?? 20000;
    const initialOrgId = options.orgId || options.claudeAccount?.orgId || '';

    try {
        // --- 阶段一：在当前页面上下文通过官方 API 快速尝试关闭续费 ---
        const apiResult = await page.evaluate(async ({ orgId, timeout }) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), Math.min(timeout, 8000));

            try {
                let targetOrgId = orgId;
                if (!targetOrgId) {
                    try {
                        const accResp = await fetch('/api/auth/current_account', {
                            credentials: 'include',
                            headers: { accept: 'application/json' },
                            signal: controller.signal
                        });
                        if (accResp.ok) {
                            const accData = await accResp.json();
                            const memberships = accData?.memberships || accData?.account?.memberships || [];
                            targetOrgId = memberships[0]?.organization?.id || '';
                        }
                    } catch (_) {}
                }

                if (!targetOrgId) {
                    return { ok: false, canFallbackUi: true, error: '未能获取当前账号 Organization ID' };
                }

                // 尝试直接调用取消订阅 API
                const cancelEndpoints = [
                    `/api/organizations/${targetOrgId}/billing/cancel_subscription`,
                    `/api/organizations/${targetOrgId}/billing/cancel`
                ];

                for (const endpoint of cancelEndpoints) {
                    try {
                        const cancelResp = await fetch(endpoint, {
                            method: 'POST',
                            credentials: 'include',
                            headers: {
                                'content-type': 'application/json',
                                accept: 'application/json'
                            },
                            body: JSON.stringify({}),
                            signal: controller.signal
                        });

                        if (cancelResp.ok) {
                            const data = await cancelResp.json().catch(() => ({}));
                            return {
                                ok: true,
                                cancelled: true,
                                orgId: targetOrgId,
                                effectiveAt: data?.current_period_end || data?.effective_at || null,
                                message: '已成功关闭次月自动续订，本周期内 Pro 权益继续有效'
                            };
                        }

                        if (cancelResp.status === 400 || cancelResp.status === 409) {
                            const errData = await cancelResp.json().catch(() => ({}));
                            const errStr = JSON.stringify(errData).toLowerCase();
                            if (errStr.includes('already_cancel') || errStr.includes('already cancel')) {
                                return {
                                    ok: true,
                                    alreadyCancelled: true,
                                    orgId: targetOrgId,
                                    message: '自动续费先前已关闭，下月不会自动扣款'
                                };
                            }
                        }
                    } catch (_) {}
                }

                return { ok: false, canFallbackUi: true, orgId: targetOrgId };
            } finally {
                clearTimeout(timer);
            }
        }, { orgId: initialOrgId, timeout: timeoutMs });

        if (apiResult.ok) {
            return {
                ok: true,
                cancelled: Boolean(apiResult.cancelled),
                alreadyCancelled: Boolean(apiResult.alreadyCancelled),
                autoRenewRaw: false,
                effectiveAt: apiResult.effectiveAt || null,
                message: apiResult.message || '已成功关闭次月自动续订'
            };
        }

        // --- 阶段二：若 API 未直接完成，降级到账单页面 UI 执行取消操作 ---
        console.log('[Claude/cancel] API 直接调用未直接返回成功，尝试通过账单管理页面进行确认...');
        const billingUrl = 'https://claude.ai/settings/billing';
        try {
            await page.goto(billingUrl, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
            await page.waitForTimeout(1500);

            // 检查页面是否提示已经处于已取消状态
            const pageContent = await page.content().catch(() => '');
            if (/Subscription ends on|Renews on|Cancels on|将于.*到期|续订已关闭/i.test(pageContent) && /cancel|取消/i.test(pageContent)) {
                if (/Cancels on|将于.*到期|已取消续费/i.test(pageContent)) {
                    return {
                        ok: true,
                        alreadyCancelled: true,
                        autoRenewRaw: false,
                        message: '账单页面显示次月续订已处于关闭状态'
                    };
                }
            }

            // 查找 "Cancel plan" 或 "取消订阅" 按钮
            const cancelBtn = page.getByRole('button', { name: /^(Cancel plan|Cancel subscription|取消计划|取消订阅|关闭续费)$/i }).first();
            if (await cancelBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
                await cancelBtn.click({ timeout: 3000 });
                await page.waitForTimeout(1000);

                // 确认弹窗中的二次确认按钮
                const confirmBtn = page.getByRole('button', { name: /^(Confirm cancellation|Cancel subscription|Continue to cancel|确认取消|取消计划)$/i }).first();
                if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
                    await confirmBtn.click({ timeout: 3000 });
                    await page.waitForTimeout(2000);
                    return {
                        ok: true,
                        cancelled: true,
                        autoRenewRaw: false,
                        message: '已通过官方账单设置页面确认关闭次月自动续订'
                    };
                }
            }
        } catch (uiErr) {
            console.warn(`[Claude/cancel] 页面 UI 兜底处理异常: ${uiErr.message}`);
        }

        return {
            ok: false,
            verificationUnknown: true,
            error: apiResult.error || '未能自动确认 Claude 次月续订关闭状态，可稍后在后台按需核对'
        };

    } catch (err) {
        return {
            ok: false,
            verificationUnknown: true,
            error: `Claude 取消自动续订执行异常: ${err.message}`
        };
    }
}

module.exports = {
    cancelClaudeAutoRenew
};
