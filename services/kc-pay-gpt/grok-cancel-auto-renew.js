'use strict';

const { decodeRpc } = require('./grok-commerce-wire');

/**
 * Grok / X 组合订阅自动取消续订模块
 * 
 * 核心目标：
 * 在充值/订阅成功后，自动执行官方取消自动续费操作，
 * 确保当前购买周期的权益不受影响（持续生效至到期日），同时终止下一周期的自动扣费。
 */

function encodeVarint(value) {
    let n = BigInt.asUintN(64, BigInt(value));
    const bytes = [];
    do {
        const b = Number(n & 127n);
        n >>= 7n;
        bytes.push(b | (n ? 128 : 0));
    } while (n);
    return Buffer.from(bytes);
}

function encodeGrpcWebEnvelope(payload) {
    const header = Buffer.alloc(5);
    header[0] = 0;
    header.writeUInt32BE(payload.length, 1);
    return Buffer.concat([header, payload]);
}

function encodeCancelAcquisitionGrpcWeb(subscriptionId, idempotencyKey) {
    const chunks = [];
    for (const [fieldNo, str] of [[1, subscriptionId], [2, idempotencyKey]]) {
        if (!str) continue;
        const data = Buffer.from(String(str), 'utf8');
        chunks.push(encodeVarint((fieldNo << 3) | 2), encodeVarint(data.length), data);
    }
    return encodeGrpcWebEnvelope(Buffer.concat(chunks));
}

async function cancelGrokAutoRenewGrpcWeb(page, initialSubId, timeoutMs) {
    const invokeGrpcWeb = async (path, reqBytes) => {
        return page.evaluate(async ({ rpcPath, bodyBytes, timeout }) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeout);
            try {
                const resp = await fetch(rpcPath, {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/grpc-web+proto',
                        'x-grpc-web': '1',
                        accept: 'application/grpc-web+proto'
                    },
                    credentials: 'include',
                    body: new Uint8Array(bodyBytes),
                    signal: controller.signal
                });
                const buf = new Uint8Array(await resp.arrayBuffer());
                return {
                    ok: resp.ok,
                    status: resp.status,
                    headers: {
                        'content-type': resp.headers.get('content-type') || '',
                        'grpc-status': resp.headers.get('grpc-status')
                    },
                    bytes: Array.from(buf)
                };
            } finally {
                clearTimeout(timer);
            }
        }, { rpcPath: path, bodyBytes: Array.from(reqBytes), timeout: timeoutMs });
    };

    let targetSubId = initialSubId;
    if (!targetSubId) {
        const emptyEnvelope = encodeGrpcWebEnvelope(Buffer.alloc(0));
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const raw = await invokeGrpcWeb('/commerce.subscription.v1.SubscriptionService/GetSubscriptions', emptyEnvelope);
                if (raw?.ok && Array.isArray(raw.bytes)) {
                    const subData = decodeRpc(
                        'commerce.subscription.v1.SubscriptionService/GetSubscriptions',
                        'output',
                        Buffer.from(raw.bytes),
                        raw.headers
                    );
                    const list = subData?.subscriptions || [];
                    const activeSub = list.find(s => {
                        const st = s?.state?.status || s?.status;
                        return st === 'SUBSCRIPTION_STATUS_ACTIVE' || st === 'ACTIVE' || st === 'ACQUISITION_STATUS_SUCCEEDED';
                    }) || list[0];
                    if (activeSub?.subscriptionId) {
                        targetSubId = activeSub.subscriptionId;
                        break;
                    }
                    if (activeSub?.state?.status === 'SUBSCRIPTION_STATUS_EXPIRING' && activeSub?.subscriptionId) {
                        return {
                            ok: true,
                            alreadyCancelled: true,
                            subscriptionId: activeSub.subscriptionId,
                            effectiveAt: activeSub.state.expiryTimeTs || null,
                            message: '自动续费先前已关闭，下月不会自动扣款'
                        };
                    }
                }
            } catch (_) {}
        }
    }

    if (!targetSubId) {
        return null;
    }

    const idempotencyKey = `cancel_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const cancelEnvelope = encodeCancelAcquisitionGrpcWeb(targetSubId, idempotencyKey);
    const rawCancel = await invokeGrpcWeb('/commerce.billing.v1.AcquisitionService/CancelAcquisition', cancelEnvelope);
    if (!rawCancel?.ok || !Array.isArray(rawCancel.bytes)) {
        return null;
    }
    const cancelData = decodeRpc(
        'commerce.billing.v1.AcquisitionService/CancelAcquisition',
        'output',
        Buffer.from(rawCancel.bytes),
        rawCancel.headers
    );
    const errCode = cancelData?.error?.code;
    if (errCode === 'SUBSCRIPTION_ALREADY_CANCELED') {
        return {
            ok: true,
            alreadyCancelled: true,
            subscriptionId: targetSubId,
            message: '自动续费先前已关闭，下月不会自动扣款'
        };
    }
    if (errCode || cancelData?.error?.message) {
        return {
            ok: false,
            subscriptionId: targetSubId,
            errorCode: errCode || 'RPC_ERROR',
            error: cancelData?.error?.message || `取消请求返回错误 ${errCode}`
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
                                    return st === 'SUBSCRIPTION_STATUS_ACTIVE' || st === 'ACTIVE' || st === 'ACQUISITION_STATUS_SUCCEEDED';
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

        let finalResult = result;
        if (!finalResult?.ok) {
            try {
                const grpcFallback = await cancelGrokAutoRenewGrpcWeb(
                    page,
                    finalResult?.subscriptionId || initialSubId,
                    timeoutMs
                );
                if (grpcFallback) {
                    finalResult = grpcFallback;
                }
            } catch (_) {}
        }

        if (finalResult.ok) {
            const dateStr = formatTimestamp(finalResult.effectiveAt);
            const msg = dateStr
                ? `已成功关闭次月自动续费，当前订阅权益有效至 ${dateStr}`
                : (finalResult.message || '已成功关闭次月自动续订');
            return {
                ok: true,
                cancelled: Boolean(finalResult.cancelled),
                alreadyCancelled: Boolean(finalResult.alreadyCancelled),
                autoRenewRaw: false,
                subscriptionId: finalResult.subscriptionId,
                effectiveAt: dateStr || finalResult.effectiveAt,
                message: msg
            };
        }

        return {
            ok: false,
            verificationUnknown: true,
            subscriptionId: finalResult.subscriptionId,
            error: finalResult.error || '取消自动续费请求未能确认'
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
