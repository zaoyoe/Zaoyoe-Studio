'use strict';

/**
 * Grok / X 组合订阅自动取消续订模块
 * 
 * 核心目标：
 * 在充值/订阅成功后，自动执行官方取消自动续费操作，
 * 确保当前购买周期的权益不受影响（持续生效至到期日），同时终止下一周期的自动扣费。
 */

function formatTimestamp(timestampObj) {
    if (!timestampObj) return '';
    try {
        if (typeof timestampObj === 'string') {
            const d = new Date(timestampObj);
            return Number.isNaN(d.getTime()) ? timestampObj : d.toLocaleDateString('zh-CN');
        }
        if (typeof timestampObj.seconds === 'string' || typeof timestampObj.seconds === 'number') {
            const sec = Number(timestampObj.seconds);
            if (Number.isFinite(sec)) {
                return new Date(sec * 1000).toLocaleDateString('zh-CN');
            }
        }
    } catch (_) {}
    return '';
}

/**
 * 在 Playwright 页面上下文中执行取消自动续订
 * @param {import('playwright').Page} page
 * @param {object} options
 * @returns {Promise<{ ok: boolean, cancelled?: boolean, alreadyCancelled?: boolean, autoRenewRaw?: boolean, effectiveAt?: string, message: string, error?: string, verificationUnknown?: boolean }>}
 */
async function cancelGrokAutoRenew(page, options = {}) {
    if (!page || typeof page.evaluate !== 'function') {
        return {
            ok: false,
            verificationUnknown: true,
            error: '缺少可用的 Grok 浏览器页面上下文'
        };
    }

    const timeoutMs = options.timeoutMs ?? 15000;
    const initialSubId = options.subscriptionId ? String(options.subscriptionId).trim() : '';

    try {
        const result = await page.evaluate(async ({ subId, timeout }) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeout);

            const rpcHeaders = {
                'content-type': 'application/json',
                'connect-protocol-version': '1',
                accept: 'application/json'
            };

            try {
                let targetSubId = subId;

                // 1. 若外部未直接提供 subscriptionId，从官方 GetSubscriptions 查询
                if (!targetSubId) {
                    for (let attempt = 0; attempt < 3; attempt++) {
                        try {
                            const getSubResp = await fetch('/commerce.subscription.v1.SubscriptionService/GetSubscriptions', {
                                method: 'POST',
                                headers: rpcHeaders,
                                credentials: 'include',
                                body: JSON.stringify({ includeTerminated: false }),
                                signal: controller.signal
                            });

                            if (getSubResp.ok) {
                                const subData = await getSubResp.json();
                                const list = subData?.subscriptions || [];
                                // 优先找 ACTIVE 或处于有效期的订阅
                                const activeSub = list.find(s => {
                                    const st = s?.state?.status || s?.status;
                                    return st === 'ACTIVE' || st === 'ACQUISITION_STATUS_SUCCEEDED';
                                }) || list[0];

                                if (activeSub?.subscriptionId) {
                                    targetSubId = activeSub.subscriptionId;
                                    break;
                                }
                            }
                        } catch (_) {}
                        await new Promise(r => setTimeout(r, 1200));
                    }
                }

                if (!targetSubId) {
                    return {
                        ok: false,
                        notFound: true,
                        error: '未能在官方账号下检索到活跃订阅 ID'
                    };
                }

                // 2. 调用 CancelAcquisition 关闭自动续费
                const idempotencyKey = `cancel_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
                const cancelResp = await fetch('/commerce.billing.v1.AcquisitionService/CancelAcquisition', {
                    method: 'POST',
                    headers: rpcHeaders,
                    credentials: 'include',
                    body: JSON.stringify({
                        subscriptionId: targetSubId,
                        idempotencyKey
                    }),
                    signal: controller.signal
                });

                let cancelData = null;
                try {
                    cancelData = await cancelResp.json();
                } catch (_) {}

                if (cancelResp.ok) {
                    const errCode = cancelData?.error?.code;
                    if (errCode === 'SUBSCRIPTION_ALREADY_CANCELED') {
                        return {
                            ok: true,
                            alreadyCancelled: true,
                            subscriptionId: targetSubId,
                            message: '自动续费先前已关闭，下月不会自动扣款'
                        };
                    }
                    return {
                        ok: true,
                        cancelled: true,
                        subscriptionId: targetSubId,
                        effectiveAt: cancelData?.effectiveAt || null,
                        storeManagementUrl: cancelData?.storeManagementUrl || '',
                        message: '已成功关闭次月自动续订，本周期内权益继续有效'
                    };
                }

                // 官方返回非 200
                const errCode = cancelData?.error?.code;
                if (errCode === 'SUBSCRIPTION_ALREADY_CANCELED') {
                    return {
                        ok: true,
                        alreadyCancelled: true,
                        subscriptionId: targetSubId,
                        message: '自动续费先前已关闭，下月不会自动扣款'
                    };
                }

                return {
                    ok: false,
                    subscriptionId: targetSubId,
                    statusCode: cancelResp.status,
                    errorCode: errCode || 'RPC_ERROR',
                    error: cancelData?.error?.message || `取消请求返回 HTTP ${cancelResp.status}`
                };
            } finally {
                clearTimeout(timer);
            }
        }, { subId: initialSubId, timeout: timeoutMs });

        if (result.ok) {
            const dateStr = formatTimestamp(result.effectiveAt);
            const msg = dateStr
                ? `已成功关闭次月自动续费，当前订阅权益有效至 ${dateStr}`
                : (result.message || '已成功关闭次月自动续订');
            return {
                ok: true,
                cancelled: Boolean(result.cancelled),
                alreadyCancelled: Boolean(result.alreadyCancelled),
                autoRenewRaw: false,
                subscriptionId: result.subscriptionId,
                effectiveAt: dateStr || result.effectiveAt,
                message: msg
            };
        }

        return {
            ok: false,
            verificationUnknown: true,
            subscriptionId: result.subscriptionId,
            error: result.error || '取消自动续费请求未能确认'
        };

    } catch (err) {
        return {
            ok: false,
            verificationUnknown: true,
            error: `取消自动续订操作异常: ${err.message}`
        };
    }
}

module.exports = {
    cancelGrokAutoRenew,
    formatTimestamp
};
