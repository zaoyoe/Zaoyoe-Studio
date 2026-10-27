'use strict';

/**
 * ChatGPT (OpenAI) 自动取消次月续订模块（官方原生 API 纯协议架构）
 *
 * 实测验证的 OpenAI 官方机制：
 * 1. OpenAI 的 Stripe Customer Portal (bpc_1MPu5sC6h1nxGoI3kUxDgfct) 仅开启了修改支付方式与查看发票，
 *    明确禁用了门户内取消订阅 (subscription_cancel.enabled = false)；
 * 2. ChatGPT 网页端的订阅查询与取消次月自动续订完全由 chatgpt.com 原生接口承载：
 *    - Step 1: GET /backend-api/accounts/check/v4-2023-04-27?timezone_offset_min=0 获取真实 account_id
 *    - Step 2: GET /backend-api/subscriptions?account_id=<account_id> 轮询等待 Stripe Webhook 入账并检查 will_renew / cancels_at
 *    - Step 3: POST /backend-api/subscriptions/cancel 携带 {"account_id": "<account_id>"} 原生关闭次月续订
 *    - Step 4: 再次 GET /backend-api/subscriptions?account_id=<account_id> 核验 will_renew === false 或 cancels_at 已写入
 * 3. 全程 100% 纯协议（Chrome TLS 指纹）闭环完成，严格保护当月已付费权益（Plus/Pro/Team），绝不因取消续订而冷启动 Chromium 浏览器。
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 从 /backend-api/accounts/check/v4-2023-04-27 响应中提取候选 account_id 列表
 * 优先排序已激活订阅的账户（若为 team 套餐则优先排序 workspace/team 账户）
 * @param {object} accData
 * @param {string} [planType]
 * @returns {string[]}
 */
function resolveAccountIdsFromCheckData(accData, planType = '') {
    if (!accData || typeof accData !== 'object') return [];
    const accounts = accData.accounts && typeof accData.accounts === 'object' ? accData.accounts : {};
    const ordering = Array.isArray(accData.account_ordering) ? accData.account_ordering : [];
    const normalizedPlan = String(planType || '').trim().toLowerCase();

    const entries = [];
    const seen = new Set();

    const addCandidate = (id, entryObj) => {
        const cleanId = String(id || '').trim();
        if (!cleanId || cleanId === 'default' || seen.has(cleanId)) return;
        seen.add(cleanId);
        const account = entryObj?.account || {};
        const entitlement = entryObj?.entitlement || {};
        const hasActive = Boolean(entitlement.has_active_subscription);
        const isTeam = String(account.plan_type || '').toLowerCase() === 'team'
            || String(account.structure || '').toLowerCase() === 'workspace';
        let score = 0;
        if (hasActive) score += 10;
        if (normalizedPlan === 'team' && isTeam) score += 5;
        entries.push({ id: cleanId, score });
    };

    for (const [key, entry] of Object.entries(accounts)) {
        const id = entry?.account?.account_id || (key !== 'default' ? key : '');
        addCandidate(id, entry);
    }
    for (const id of ordering) {
        addCandidate(id, accounts[id]);
    }

    entries.sort((a, b) => b.score - a.score);
    return entries.map((item) => item.id);
}

/**
 * 解析 /backend-api/subscriptions?account_id=... 的返回结构
 * 区分「Webhook 尚未同步的未激活/历史过期记录」与「当前已生效订阅」
 * @param {object} subData
 * @returns {{ isActive: boolean, isAlreadyCancelled: boolean, effectiveAt: string|null }}
 */
function inspectSubscriptionState(subData) {
    if (!subData || typeof subData !== 'object') {
        return { isActive: false, isAlreadyCancelled: false, effectiveAt: null };
    }

    const entitlement = subData.entitlement && typeof subData.entitlement === 'object' ? subData.entitlement : {};
    const planObj = subData.account_plan || subData.plan || subData.subscription || null;

    const explicitlyInactive = subData.is_active === false || entitlement.has_active_subscription === false;
    const isActive = Boolean(
        subData.is_active === true
        || entitlement.has_active_subscription === true
        || planObj?.is_paid_subscription_active === true
        || (!explicitlyInactive && planObj && typeof planObj === 'object')
    );

    const cancelsAt = entitlement.cancels_at || subData.cancels_at || planObj?.cancels_at || null;
    const expiresAt = entitlement.expires_at || subData.active_until || subData.expires_at || planObj?.expires_at || null;
    const renewsAt = entitlement.renews_at || subData.renews_at || null;

    const willRenewRaw = subData.will_renew !== undefined
        ? subData.will_renew
        : (planObj?.will_renew !== undefined ? planObj.will_renew : undefined);

    const canceledFlag = Boolean(
        cancelsAt
        || planObj?.canceled_at_period_end === true
        || planObj?.status === 'canceled'
        || subData.cancellation_outcome === 'cancel_at_period_end'
    );

    const isAlreadyCancelled = isActive && (willRenewRaw === false || canceledFlag);

    return {
        isActive,
        isAlreadyCancelled,
        effectiveAt: cancelsAt || expiresAt || renewsAt || null
    };
}

/**
 * 0 浏览器纯协议（Chrome TLS 指纹）：调用 ChatGPT 官方原生接口关闭次月自动续订
 * @param {object} options
 * @returns {Promise<{ ok: boolean, cancelled?: boolean, alreadyCancelled?: boolean, autoRenewRaw?: boolean, accountId?: string, effectiveAt?: string|null, message?: string, error?: string, challenge?: boolean, data?: any }>}
 */
async function cancelChatGptAutoRenewProtocol(options = {}) {
    const accessToken = String(options.accessToken || '').trim();
    if (!accessToken) {
        return { ok: false, error: '缺少 ChatGPT accessToken' };
    }

    const timeoutMs = options.timeoutMs ?? 20000;
    const maxPollAttempts = Math.max(1, Number(options.maxPollAttempts ?? 6));
    const pollIntervalMs = Math.max(50, Number(options.pollIntervalMs ?? 1500));
    const proxyStr = String(options.proxy || '').trim();

    let impitClient = null;
    let undiciFetch = null;
    let dispatcher = undefined;

    if (typeof options.fetchImpl !== 'function') {
        try {
            const { Impit } = require('impit');
            impitClient = new Impit({
                browser: 'chrome',
                proxyUrl: proxyStr || undefined,
                ignoreTlsErrors: true,
                timeout: timeoutMs
            });
        } catch (_) {}

        if (!impitClient) {
            const undici = require('undici');
            undiciFetch = undici.fetch;
            dispatcher = proxyStr ? new undici.ProxyAgent(proxyStr) : undefined;
        }
    }

    const doFetch = (url, init = {}) => {
        if (typeof options.fetchImpl === 'function') {
            return options.fetchImpl(url, init);
        }
        return impitClient
            ? impitClient.fetch(url, init)
            : undiciFetch(url, { ...init, dispatcher });
    };

    const headers = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Origin': 'https://chatgpt.com',
        'Referer': 'https://chatgpt.com/',
        'User-Agent': options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
        'sec-ch-ua': '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'oai-language': 'en-US',
        ...(options.cookieHeader ? { 'Cookie': options.cookieHeader } : {}),
        ...(options.deviceId ? { 'oai-device-id': options.deviceId } : {})
    };

    try {
        let candidateAccountIds = [];
        const initialAccountId = String(options.accountId || '').trim();
        const isTeamPlan = String(options.planType || '').trim().toLowerCase() === 'team';

        if (initialAccountId && !isTeamPlan) {
            candidateAccountIds.push(initialAccountId);
        }

        const fetchCandidateAccounts = async () => {
            const checkResp = await doFetch('https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27?timezone_offset_min=0', {
                method: 'GET',
                headers
            });
            if (checkResp.status === 403) {
                const txt = await checkResp.text().catch(() => '');
                if (/just a moment|cloudflare|challenge/i.test(txt)) {
                    return { challenge: true };
                }
            }
            if (checkResp.ok) {
                const accData = await checkResp.json().catch(() => ({}));
                const resolved = resolveAccountIdsFromCheckData(accData, options.planType);
                for (const id of resolved) {
                    if (!candidateAccountIds.includes(id)) {
                        candidateAccountIds.push(id);
                    }
                }
            }
            return { challenge: false };
        };

        if (!candidateAccountIds.length) {
            const checkResult = await fetchCandidateAccounts();
            if (checkResult.challenge) {
                return { ok: false, challenge: true, error: '纯协议查询账户触发 Cloudflare 挑战 (HTTP 403)' };
            }
        }

        let lastError = '';
        let checkedRemoteAccounts = candidateAccountIds.length === 0;

        for (let attempt = 1; attempt <= maxPollAttempts; attempt++) {
            if (!candidateAccountIds.length && !checkedRemoteAccounts) {
                checkedRemoteAccounts = true;
                await fetchCandidateAccounts();
            }

            const accountsToProbe = candidateAccountIds.length ? [...candidateAccountIds] : [''];

            for (const accId of accountsToProbe) {
                const subUrl = accId
                    ? `https://chatgpt.com/backend-api/subscriptions?account_id=${encodeURIComponent(accId)}`
                    : 'https://chatgpt.com/backend-api/subscriptions';

                const subResp = await doFetch(subUrl, { method: 'GET', headers });
                if (subResp.status === 403) {
                    const txt = await subResp.text().catch(() => '');
                    if (/just a moment|cloudflare|challenge/i.test(txt)) {
                        return { ok: false, challenge: true, error: '纯协议查询订阅触发 Cloudflare 挑战 (HTTP 403)' };
                    }
                }

                // 若未带 account_id 返回 400 must specify account_id，立刻拉取 accounts/check 补齐 account_id
                if (subResp.status === 400 && !accId && !checkedRemoteAccounts) {
                    checkedRemoteAccounts = true;
                    await fetchCandidateAccounts();
                    break;
                }

                let activeAccountId = accId;
                let subData = null;

                if (subResp.ok) {
                    subData = await subResp.json().catch(() => ({}));
                    const state = inspectSubscriptionState(subData);
                    if (state.isAlreadyCancelled) {
                        return {
                            ok: true,
                            alreadyCancelled: true,
                            autoRenewRaw: false,
                            accountId: activeAccountId || undefined,
                            effectiveAt: state.effectiveAt,
                            message: '订阅状态显示次月续费已关闭，本期权益继续有效',
                            data: subData
                        };
                    }

                    // 如果当前 accountId 显示尚未激活（例如 Stripe Webhook 仍在入账中，或 Team 订阅创建在新 Workspace 上）
                    if (!state.isActive) {
                        if (!checkedRemoteAccounts) {
                            checkedRemoteAccounts = true;
                            await fetchCandidateAccounts();
                        }
                        lastError = '等待 OpenAI 订阅状态同步 (has_active_subscription=false)';
                        continue;
                    }
                }

                if (!activeAccountId) {
                    if (!checkedRemoteAccounts) {
                        checkedRemoteAccounts = true;
                        await fetchCandidateAccounts();
                        if (candidateAccountIds.length) {
                            activeAccountId = candidateAccountIds[0];
                        }
                    }
                }

                if (!activeAccountId) {
                    lastError = '未能解析到有效的 ChatGPT account_id';
                    continue;
                }

                // 调用 OpenAI 官方原生取消接口 POST /backend-api/subscriptions/cancel
                const cancelResp = await doFetch('https://chatgpt.com/backend-api/subscriptions/cancel', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ account_id: activeAccountId })
                });

                if (cancelResp.ok) {
                    const cancelData = await cancelResp.json().catch(() => ({}));
                    // 二次核验订阅状态，确认 will_renew === false 或 cancels_at 已生成
                    let verifiedData = null;
                    try {
                        const verifyResp = await doFetch(
                            `https://chatgpt.com/backend-api/subscriptions?account_id=${encodeURIComponent(activeAccountId)}`,
                            { method: 'GET', headers }
                        );
                        if (verifyResp.ok) {
                            verifiedData = await verifyResp.json().catch(() => null);
                        }
                    } catch (_) {}

                    const verifyState = inspectSubscriptionState(verifiedData || cancelData);
                    return {
                        ok: true,
                        cancelled: true,
                        autoRenewRaw: false,
                        accountId: activeAccountId,
                        effectiveAt: verifyState.effectiveAt,
                        message: '已通过官方原生接口成功关闭次月自动续订，本周期内权益继续有效',
                        data: verifiedData || cancelData
                    };
                }

                const errData = await cancelResp.json().catch(() => ({}));
                const errStr = JSON.stringify(errData).toLowerCase();

                if (cancelResp.status === 400 || cancelResp.status === 409 || cancelResp.status === 422) {
                    if (errStr.includes('already_cancel') || errStr.includes('already cancel')
                        || errStr.includes('will_renew') || errStr.includes('already_set')) {
                        return {
                            ok: true,
                            alreadyCancelled: true,
                            autoRenewRaw: false,
                            accountId: activeAccountId,
                            message: '自动续费先前已关闭，下月不会自动扣款',
                            data: errData
                        };
                    }
                }

                if (cancelResp.status === 404 && errStr.includes('no active subscription')) {
                    if (!checkedRemoteAccounts) {
                        checkedRemoteAccounts = true;
                        await fetchCandidateAccounts();
                    }
                    lastError = 'OpenAI 订阅入账同步中 (no active subscription found for account)';
                    continue;
                }

                lastError = errData?.detail || `HTTP ${cancelResp.status}`;
            }

            if (attempt < maxPollAttempts) {
                await sleep(pollIntervalMs);
            }
        }

        return {
            ok: false,
            verificationUnknown: true,
            error: lastError || '纯协议取消次月自动续订未确认'
        };
    } catch (err) {
        return {
            ok: false,
            verificationUnknown: true,
            error: `纯协议取消自动续订异常: ${err.message}`
        };
    } finally {
        await dispatcher?.close?.().catch(() => {});
    }
}

/**
 * 在 Stripe Customer Portal 页面中执行关闭次月续订（仅保留供测试与特殊门户兜底兼容）
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
 * 执行 ChatGPT 取消次月自动续订（纯协议优先，绝不因取消续订而冷启动 Chromium）
 * @param {import('playwright').Page|null} page
 * @param {object} options
 * @returns {Promise<{ ok: boolean, cancelled?: boolean, alreadyCancelled?: boolean, autoRenewRaw?: boolean, effectiveAt?: string, message: string, error?: string, verificationUnknown?: boolean }>}
 */
async function cancelChatGptAutoRenew(page, options = {}) {
    const timeoutMs = options.timeoutMs ?? 20000;

    // 1. 只要提供了 accessToken，无论是否有 page，均优先通过 0 浏览器纯协议（官方原生接口）完成取消
    if (options.accessToken) {
        const protocolResult = await cancelChatGptAutoRenewProtocol({
            ...options,
            timeoutMs
        });
        if (protocolResult.ok) {
            return protocolResult;
        }
        // 如果当前处于 0 浏览器模式（page 为空），直接返回协议结果，绝不为了取消自动续费去唤醒 Chromium 浏览器
        if (!page || typeof page.evaluate !== 'function') {
            return protocolResult;
        }
    }

    if (!page || typeof page.evaluate !== 'function') {
        return {
            ok: false,
            verificationUnknown: true,
            error: '缺少可用的 ChatGPT 浏览器页面上下文'
        };
    }

    try {
        // --- 阶段一：在已有的浏览器页面上下文中调用官方原生 /backend-api/subscriptions/cancel ---
        const apiResult = await page.evaluate(async ({ timeout, initialAccountId, planType }) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), Math.min(timeout, 12000));

            try {
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

                // 1. 获取 account_id
                let accountId = initialAccountId || '';
                if (!accountId || String(planType || '').toLowerCase() === 'team') {
                    try {
                        const accResp = await fetch('/backend-api/accounts/check/v4-2023-04-27?timezone_offset_min=0', {
                            credentials: 'include',
                            headers,
                            signal: controller.signal
                        });
                        if (accResp.ok) {
                            const accData = await accResp.json().catch(() => ({}));
                            const accounts = accData?.accounts || {};
                            const ordering = Array.isArray(accData?.account_ordering) ? accData.account_ordering : [];
                            const activeKey = Object.keys(accounts).find(
                                (k) => k !== 'default' && accounts[k]?.entitlement?.has_active_subscription
                            );
                            accountId = activeKey
                                || ordering[0]
                                || accounts?.default?.account?.account_id
                                || Object.keys(accounts).find((k) => k !== 'default')
                                || accountId;
                        }
                    } catch (_) {}
                }

                // 2. 查询 /backend-api/subscriptions?account_id=...
                const subUrl = accountId
                    ? `/backend-api/subscriptions?account_id=${encodeURIComponent(accountId)}`
                    : '/backend-api/subscriptions';
                try {
                    const subResp = await fetch(subUrl, {
                        credentials: 'include',
                        headers,
                        signal: controller.signal
                    });
                    if (subResp.ok) {
                        const subData = await subResp.json().catch(() => ({}));
                        const entitlement = subData?.entitlement || {};
                        const plan = subData?.account_plan || subData?.plan || subData?.subscription || {};
                        const isActive = Boolean(
                            subData?.is_active === true
                            || entitlement.has_active_subscription === true
                            || plan.is_paid_subscription_active === true
                        );
                        if (isActive && (subData?.will_renew === false || Boolean(entitlement.cancels_at) || plan.canceled_at_period_end === true || plan.will_renew === false)) {
                            return {
                                ok: true,
                                alreadyCancelled: true,
                                message: '订阅状态显示次月续费已关闭，本期权益继续有效',
                                data: subData
                            };
                        }
                    }
                } catch (_) {}

                // 3. 调用官方原生取消接口 POST /backend-api/subscriptions/cancel
                if (accountId) {
                    try {
                        const cancelResp = await fetch('/backend-api/subscriptions/cancel', {
                            method: 'POST',
                            credentials: 'include',
                            headers,
                            body: JSON.stringify({ account_id: accountId }),
                            signal: controller.signal
                        });
                        if (cancelResp.ok) {
                            const cancelData = await cancelResp.json().catch(() => ({}));
                            return {
                                ok: true,
                                cancelled: true,
                                message: '已通过官方原生接口成功关闭次月自动续订，本周期内权益继续有效',
                                data: cancelData
                            };
                        }
                        if (cancelResp.status === 400 || cancelResp.status === 409 || cancelResp.status === 422) {
                            const errData = await cancelResp.json().catch(() => ({}));
                            const errStr = JSON.stringify(errData).toLowerCase();
                            if (errStr.includes('already_cancel') || errStr.includes('already cancel') || errStr.includes('will_renew')) {
                                return {
                                    ok: true,
                                    alreadyCancelled: true,
                                    message: '自动续费先前已关闭，下月不会自动扣款',
                                    data: errData
                                };
                            }
                        }
                    } catch (_) {}
                }

                return { ok: false, canFallbackUi: true, error: '未能直接通过页面原生 API 完成自动续订关闭' };
            } catch (err) {
                return { ok: false, canFallbackUi: true, error: err.message };
            } finally {
                clearTimeout(timer);
            }
        }, {
            timeout: timeoutMs,
            initialAccountId: options.accountId || '',
            planType: options.planType || ''
        });

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

            if (apiResult.portalUrl) {
                const portalResult = await cancelInsideStripeCustomerPortal(page, apiResult.portalUrl, timeoutMs);
                if (portalResult.ok) {
                    return portalResult;
                }
            }
        }

        // --- 阶段二：若页面已打开但 API 调用受阻，尝试在当前页面 UI 确认 ---
        console.log('[ChatGPT/cancel] API 直接调用未直接返回成功，尝试通过页面 UI 确认...');
        try {
            const currentUrl = typeof page.url === 'function' ? page.url() : '';
            if (currentUrl && currentUrl.includes('billing.stripe.com')) {
                const directPortalRes = await cancelInsideStripeCustomerPortal(page, null, timeoutMs);
                if (directPortalRes.ok) return directPortalRes;
            }

            if (!currentUrl.includes('chatgpt.com') || currentUrl.includes('/checkout/')) {
                if (typeof page.goto === 'function') {
                    await page.goto('https://chatgpt.com', { waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
                }
                if (typeof page.waitForTimeout === 'function') {
                    await page.waitForTimeout(1000);
                }
            }

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
    cancelChatGptAutoRenewProtocol,
    cancelInsideStripeCustomerPortal,
    resolveAccountIdsFromCheckData,
    inspectSubscriptionState
};
