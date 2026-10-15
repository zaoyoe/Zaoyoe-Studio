'use strict';

const crypto = require('crypto');
const defaultClient = require('./gpt-api-client');
const domain = require('./gpt-outsourcing');

const digest = value => crypto.createHash('sha256').update(String(value || '')).digest('hex');
const error = (code, message, statusCode = 409) => Object.assign(new Error(message), { code, statusCode });

function parseExpiry(value) {
    const match = String(value || '').trim().match(/^(0?[1-9]|1[0-2])\s*\/?\s*(\d{2}|\d{4})$/);
    if (!match) throw error('OUTSOURCE_CARD_INVALID', '银行卡有效期格式无效', 400);
    return { month: Number(match[1]), year: Number(match[2].length === 2 ? `20${match[2]}` : match[2]) };
}

function safeCode(value, fallback = 'OUTSOURCE_UNCONFIRMED') {
    const code = String(value || '');
    return /^[a-z][a-z0-9_]{2,80}$/i.test(code) ? code : fallback;
}

// A transport failure is never proof that the provider did not accept a POST.
function rejectedBeforeOrder(response) {
    const codes = new Set(['session_required', 'session_expired', 'exactly_one_card_source_required',
        'invalid_pan', 'invalid_expiry', 'invalid_proxy', 'proxy_hostname_must_be_public_ip',
        'private_proxy_forbidden', 'invalid_currency', 'not_authenticated', 'invalid_api_key',
        'insufficient_scope', 'payment_cards_disabled', 'insufficient_credits', 'topup_code_out_of_stock']);
    return response?.ambiguousWrite === false && [400, 401, 403, 409, 422].includes(response?.status)
        && codes.has(String(response?.errorCode || ''));
}

function createGptOutsourcingService({ store, client = defaultClient, onUpdate = () => {}, onLog = () => {},
    onOutcome = () => {}, wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
    now = Date.now, maxPolls = 120, pollIntervalMs = 5000, maxElapsedMs = 10 * 60 * 1000 } = {}) {
    const busy = new Set();
    const bounds = { maxPolls: Math.max(1, Math.min(1200, Number(maxPolls) || 120)),
        pollIntervalMs: Math.max(1000, Math.min(60000, Number(pollIntervalMs) || 5000)),
        maxElapsedMs: Math.max(1000, Math.min(30 * 60 * 1000, Number(maxElapsedMs) || 600000)) };

    async function exclusive(jobKey, action) {
        if (busy.has(jobKey)) throw error('OUTSOURCE_BUSY', '该订单正在核查，请稍后再试');
        busy.add(jobKey);
        try { return await action(); } finally { busy.delete(jobKey); }
    }

    function publish(attempt, status, message) {
        onUpdate(attempt.jobKey, { status, message, paymentState: attempt.paymentState,
            recoveryRequired: Boolean(attempt.recoveryRequired), progress: attempt.progress || 0 });
    }

    async function stage(jobKey, patch, message, progress = 35) {
        const attempt = await store.saveGptApiAttempt(jobKey, patch);
        const paymentState = attempt.dispatchStarted ? 'unknown' : 'not_started';
        await store.updateTaskLog(jobKey, { status: 'running', progress, message,
            paymentState,
            recoveryRequired: Boolean(attempt.dispatchStarted),
            gptApiOrderId: attempt.orderId, gptApiTaskId: attempt.taskId,
            cardLast4: attempt.cardLast4 });
        publish({ ...attempt, progress, paymentState }, 'running', message);
        return attempt;
    }

    async function finish(jobKey, outcome, record, message) {
        const paymentState = outcome === 'success' ? 'succeeded'
            : (outcome === 'hold' ? 'unknown' : (record.dispatchStarted ? 'declined' : 'not_started'));
        const result = await store.finalizeGptApiAttempt(jobKey, { outcome, record, message, paymentState });
        const attempt = result.attempt || { ...record, jobKey };
        const status = result.assetsHeld ? 'manual' : (outcome === 'success' ? 'success' : 'failed');
        publish({ ...attempt, paymentState: result.assetsHeld ? 'unknown' : paymentState,
            recoveryRequired: Boolean(result.assetsHeld) }, status,
        result.guardCode ? '订单归属未确认，已保留资产，请人工复核' : message);
        if (result.applied && outcome !== 'hold' && !result.assetsHeld) onOutcome(jobKey, status, message, attempt);
        return result;
    }

    async function pinnedConfig(attempt) {
        if (attempt.legacy || !attempt.endpoint || !attempt.apiKeyFingerprint) {
            throw error('OUTSOURCE_LEGACY_UNCONFIRMED', '历史订单缺少供应商绑定信息，请人工核对');
        }
        const cfg = domain.validateOutsourceConfig(await store.getGptApiConfig());
        if (cfg.base_url !== attempt.endpoint || digest(cfg.api_key) !== attempt.apiKeyFingerprint) {
            throw error('OUTSOURCE_CHANNEL_CHANGED', '订单原供应商配置已变更，请恢复原渠道后核查');
        }
        return cfg;
    }

    function evidenceMatches(attempt, response, source) {
        if (attempt.existingOrderReused) return false;
        const outer = response?.data || {};
        const data = (source === 'order' ? outer.order : outer.task) || outer;
        const product = data.plan || data.plan_key || data.plan_type;
        if (product != null && String(product) !== attempt.planKey) return false;
        if (data.currency != null && String(data.currency).toUpperCase() !== attempt.currency) return false;
        if (data.account_fingerprint && attempt.accountFingerprint
            && data.account_fingerprint !== attempt.accountFingerprint) return false;
        const returnedId = data.id ?? (source === 'order' ? data.order_id : data.task_id);
        const expectedId = source === 'order' ? attempt.orderId : attempt.taskId;
        if (!returnedId || !expectedId || String(returnedId) !== String(expectedId)) return false;
        if (source === 'order' && (!product || String(product) !== attempt.planKey
            || !data.currency || String(data.currency).toUpperCase() !== attempt.currency
            || (attempt.accountFingerprint && data.account_fingerprint !== attempt.accountFingerprint))) return false;
        return true;
    }

    async function query(attempt, cfg) {
        // IDs are distinct: a task ID is never sent to the order endpoint.
        if (attempt.orderId) return { source: 'order', response: await client.queryOrder(cfg, attempt.orderId) };
        if (attempt.taskId) return { source: 'task', response: await client.queryTask(cfg, attempt.taskId) };
        throw error('OUTSOURCE_ORDER_ID_UNKNOWN', '上游建单结果待确认，缺少原订单号，请人工核对');
    }

    async function inspectOriginal(attempt, cfg) {
        const { source, response } = await query(attempt, cfg);
        if (!response.success) return { unavailable: true,
            code: safeCode(response.errorCode || response.category, 'OUTSOURCE_QUERY_UNAVAILABLE'),
            attempt: await store.saveGptApiAttempt(attempt.jobKey, { lastCheckedAt: new Date(now()).toISOString(),
                lastErrorCode: safeCode(response.errorCode || response.category, 'OUTSOURCE_QUERY_UNAVAILABLE') }) };
        const result = response.outcome || domain.classifyOutsourceResult(response.data, source);
        const item = (source === 'order' ? response.data?.order : response.data?.task) || response.data || {};
        if (source === 'task' && item.order_id && !attempt.orderId && evidenceMatches(attempt, response, source)) {
            const bound = await store.saveGptApiAttempt(attempt.jobKey, { orderId: String(item.order_id) });
            return inspectOriginal({ ...attempt, ...bound }, cfg);
        }
        const patch = { lastCheckedAt: new Date(now()).toISOString(), lastErrorCode: result.code || null,
            lastResponse: domain.sanitizeOutsourceSnapshot(response.data), upstreamStatus: result.rawStatus,
            resultSource: source };
        if (!evidenceMatches(attempt, response, source)) {
            return { result: { state: 'hold' }, attempt: { ...attempt, ...patch, state: 'unknown',
                lastErrorCode: 'OUTSOURCE_ORDER_MISMATCH' } };
        }
        return { result, attempt: { ...attempt, ...patch } };
    }

    async function applyObservation(observation) {
        const { result, attempt } = observation;
        if (observation.unavailable) return observation;
        if (result.state === 'success') return { finished: true,
            result: await finish(attempt.jobKey, 'success', { ...attempt, state: 'finished', settlement: 'success' }, '外包代充已成功') };
        if (result.state === 'confirmed_no_charge') return { finished: true,
            result: await finish(attempt.jobKey, 'no_charge', { ...attempt, state: 'finished', settlement: 'no_charge' },
                '外包代充已确认未扣款，卡密未使用') };
        if (result.state === 'requires_action') return { finished: true,
            result: await finish(attempt.jobKey, 'hold', { ...attempt, state: 'awaiting_credentials', settlement: 'hold' },
                '上游订单需要补交凭证，已保留 CDK 和银行卡，请在后台处理原订单') };
        if (result.state === 'hold') return { finished: true,
            result: await finish(attempt.jobKey, 'hold', { ...attempt, state: 'unknown', settlement: 'hold' },
                '上游支付结果待确认，已保留 CDK 和银行卡，请勿重复充值') };
        return { attempt: await stage(attempt.jobKey, { ...attempt, state: 'polling', dispatchStarted: true },
            '外包代充正在处理中，正在核查原订单', 50) };
    }

    async function pollOriginal(attempt, cfg) {
        const deadline = now() + bounds.maxElapsedMs;
        for (let poll = 0; poll < bounds.maxPolls && now() < deadline; poll++) {
            const observation = await inspectOriginal(attempt, cfg);
            attempt = observation.attempt;
            const applied = await applyObservation(observation);
            if (applied.finished) return applied.result;
            attempt = applied.attempt || attempt;
            if (poll + 1 < bounds.maxPolls && now() < deadline) {
                const delay = observation.unavailable ? Math.min(30000, bounds.pollIntervalMs * (2 ** Math.min(poll, 3)))
                    : bounds.pollIntervalMs;
                await wait(Math.min(delay, Math.max(0, deadline - now())));
            }
        }
        return finish(attempt.jobKey, 'hold', { ...attempt, state: 'unknown',
            lastErrorCode: 'OUTSOURCE_POLL_DEADLINE', settlement: 'hold' },
        '上游支付结果待确认，核查暂未完成，已保留 CDK 和银行卡');
    }

    async function run({ task, token, session, cdk, planType }) {
        const jobKey = task.jobKey;
        return exclusive(jobKey, async () => {
            let attempt = await store.getGptApiAttempt(jobKey);
            const freshTask = attempt?.version === 0 && !attempt.orderId && !attempt.taskId;
            try {
                if ((attempt?.version === 1 && attempt?.dispatchStarted) || attempt?.orderId || attempt?.taskId) {
                    return await pollOriginal(attempt, await pinnedConfig(attempt));
                }
                if (attempt?.version === 1) throw error('OUTSOURCE_ATTEMPT_EXISTS', '已有未派发的处理记录，请核查原任务');
                attempt = null;
                planType = domain.canonicalizeOutsourcePlan(planType);
                const attemptId = crypto.randomUUID();
                attempt = await store.saveGptApiAttempt(jobKey, { version: 1, jobKey, attemptId,
                    clientRef: `kc-${attemptId}`, idempotencyKey: `kc-${attemptId}`,
                    planType, state: 'preflight', dispatchStarted: false, recoveryRequired: false });
                const cfg = domain.validateOutsourceConfig(await store.getGptApiConfig());
                if (!cfg.enabled) throw error('OUTSOURCE_DISABLED', 'GPT 外包代充渠道未启用', 400);
                const plans = await client.fetchPlans(cfg);
                if (!plans.success) throw error('OUTSOURCE_PLANS_UNAVAILABLE', '无法核验供应商套餐，已停止建单', 503);
                const selection = domain.resolveOutsourcePlan(planType, plans.plans, cfg.plan_mapping);
                const sessionPayload = session && typeof session === 'object' ? session : { access_token: token };
                const account = String(sessionPayload.user?.email || '').trim().toLowerCase();
                attempt = await stage(jobKey, { endpoint: cfg.base_url, apiKeyFingerprint: digest(cfg.api_key),
                    planType: selection.localPlan, planKey: selection.planKey, planName: selection.planName,
                    country: cfg.country, currency: cfg.currency, accountFingerprint: account ? digest(account) : null,
                    state: 'preflight', dispatchStarted: false }, '正在核验外包渠道套餐与账号凭证格式', 10);
                const inspected = await client.inspectPay(cfg, { planKey: selection.planKey, session: sessionPayload });
                if (!inspected.success) throw error(safeCode(inspected.data?.error, 'OUTSOURCE_SESSION_INVALID'),
                    '账号凭证格式或有效期检查未通过，尚未提交代充', 400);
                onLog(jobKey, 'Session 格式/有效期检查通过；这不代表官方账号已经登录成功');
                const proxy = domain.normalizeOutsourceProxy(await store.getActiveProxy());
                const reserved = await store.reserveGptApiCard(jobKey, {});
                if (!reserved?.card) throw error('OUTSOURCE_CARD_UNAVAILABLE', '银行卡池暂无可用卡片，尚未建单', 503);
                attempt = reserved.attempt;
                const expiry = parseExpiry(reserved.card.card_expiry);
                const card = { number: reserved.card.card_number, exp_month: expiry.month,
                    exp_year: expiry.year, cvc: reserved.card.card_cvc,
                    name: reserved.card.card_holder || 'API User', country: cfg.country };
                const requestFingerprint = digest(JSON.stringify({ planKey: selection.planKey, country: cfg.country,
                    currency: cfg.currency, card, session: sessionPayload, proxy, clientRef: attempt.clientRef }));
                // Durable write precedes dispatch. A crash between this write and POST stays held.
                attempt = await stage(jobKey, { requestFingerprint, state: 'submitting', dispatchStarted: true,
                    recoveryRequired: true }, '正在向外包供应商提交订单', 20);
                const submitted = await client.submitPay(cfg, { planKey: selection.planKey, session: sessionPayload,
                    country: cfg.country, currency: cfg.currency, newCard: card, proxy,
                    clientRef: attempt.clientRef, idempotencyKey: attempt.idempotencyKey });
                if (!submitted.success) {
                    if (rejectedBeforeOrder(submitted)) return await finish(jobKey, 'no_charge', { ...attempt,
                        state: 'finished', settlement: 'no_charge', lastErrorCode: safeCode(submitted.errorCode) },
                    '供应商已拒绝建单，卡密未使用');
                    throw error('OUTSOURCE_SUBMISSION_UNKNOWN', '供应商建单响应未确认，请人工核查原请求');
                }
                if (!submitted.orderId && !submitted.taskId) throw error('OUTSOURCE_ORDER_ID_UNKNOWN', '供应商未返回原订单号');
                attempt = await stage(jobKey, { orderId: submitted.orderId || null, taskId: submitted.taskId || null,
                    existingOrderReused: Boolean(submitted.alreadySubmitted),
                    state: 'polling', dispatchStarted: true, recoveryRequired: true,
                    lastResponse: domain.sanitizeOutsourceSnapshot(submitted.data) }, '外包订单已受理，正在核查充值结果', 35);
                return await pollOriginal(attempt, cfg);
            } catch (failure) {
                const latest = await store.getGptApiAttempt(jobKey).catch(() => null);
                attempt = (freshTask && latest?.version === 0 ? null : latest) || attempt
                    || { jobKey, planType, state: 'preflight', dispatchStarted: false };
                const dispatched = Boolean(attempt.dispatchStarted || attempt.orderId || attempt.taskId || attempt.legacy);
                onLog(jobKey, `外包渠道处理未完成 code=${safeCode(failure.code)}`);
                try {
                    return await finish(jobKey, dispatched ? 'hold' : 'no_charge', { ...attempt,
                        state: dispatched ? 'unknown' : 'finished', lastErrorCode: safeCode(failure.code),
                        settlement: dispatched ? 'hold' : 'no_charge' }, dispatched
                        ? '外包支付结果待确认，已保留 CDK 和银行卡，请勿重复充值'
                        : '外包渠道预检未通过，尚未提交支付，卡密未使用');
                } catch (persistenceFailure) {
                    // Failure to persist a resolution must never trigger an unguarded release.
                    onLog(jobKey, '外包订单状态未能持久化，保留现有锁并等待人工核对');
                    throw error('OUTSOURCE_PERSISTENCE_UNAVAILABLE', '订单状态待核对，已保留资产', 503);
                }
            }
        });
    }

    async function recheck(jobKey) {
        return exclusive(jobKey, async () => {
            let attempt = await store.getGptApiAttempt(jobKey);
            if (!attempt) throw error('OUTSOURCE_ORDER_NOT_FOUND', '订单不存在', 404);
            if (attempt.state === 'finished' && !attempt.recoveryRequired) return { attempt, finished: true };
            if (attempt.version === 1 && !attempt.dispatchStarted && !attempt.orderId && !attempt.taskId) {
                return finish(jobKey, 'no_charge', { ...attempt, state: 'finished' }, '原任务尚未派发，卡密未使用');
            }
            try {
                const observed = await inspectOriginal(attempt, await pinnedConfig(attempt));
                const applied = await applyObservation(observed);
                if (observed.unavailable) return finish(jobKey, 'hold', { ...observed.attempt, state: 'unknown' },
                    '原订单暂时无法核查，已保留 CDK 和银行卡');
                return applied.result || { attempt: applied.attempt, finished: false };
            } catch (failure) {
                return finish(jobKey, 'hold', { ...attempt, state: 'unknown', lastErrorCode: safeCode(failure.code) },
                    '原订单暂时无法核查，已保留 CDK 和银行卡');
            }
        });
    }

    async function supplement(jobKey, { cvc, session } = {}) {
        return exclusive(jobKey, async () => {
            if (!/^\d{3,4}$/.test(String(cvc || ''))) throw error('OUTSOURCE_CVC_INVALID', '请填写有效的安全码', 400);
            const attempt = await store.getGptApiAttempt(jobKey);
            if (!attempt || !attempt.orderId) throw error('OUTSOURCE_ORDER_NOT_FOUND', '未找到可补交凭证的原订单', 404);
            const cfg = await pinnedConfig(attempt);
            const observed = await inspectOriginal(attempt, cfg);
            if (observed.unavailable || observed.result?.rawStatus !== 'requires_cvc'
                || observed.result?.state !== 'requires_action') {
                if (!observed.unavailable) await applyObservation(observed);
                throw error('OUTSOURCE_CREDENTIALS_NOT_REQUIRED', '原订单当前不允许补交凭证，请先核查结果');
            }
            if (session != null && (!session || typeof session !== 'object' || Array.isArray(session))) {
                throw error('OUTSOURCE_SESSION_INVALID', 'Session 必须是完整 JSON 对象', 400);
            }
            if (session != null) {
                const account = String(session.user?.email || '').trim().toLowerCase();
                if (!attempt.accountFingerprint || !account || digest(account) !== attempt.accountFingerprint) {
                    throw error('OUTSOURCE_ACCOUNT_MISMATCH', '新 Session 必须属于原订单的同一账号', 400);
                }
            }
            await stage(jobKey, { state: 'supplementing', dispatchStarted: true, recoveryRequired: true },
                '正在向原订单补交凭证，尚未确认充值结果', 50);
            const response = await client.supplementCredentials(cfg, attempt.orderId, { cvc: String(cvc), session });
            const result = await finish(jobKey, 'hold', { ...attempt, state: response.success ? 'polling' : 'unknown',
                lastErrorCode: response.success ? null : 'OUTSOURCE_CREDENTIALS_RESPONSE_UNKNOWN',
                lastResponse: domain.sanitizeOutsourceSnapshot(response.data) }, response.success
                ? '凭证已发送给原订单，等待上游确认，请勿重复充值'
                : '补交凭证结果待确认，已保留原订单和资产');
            return { ...result, accepted: response.success };
        });
    }

    return { run, recheck, supplement, isBusy: jobKey => busy.has(jobKey), digest };
}

module.exports = { createGptOutsourcingService, parseExpiry, rejectedBeforeOrder };
