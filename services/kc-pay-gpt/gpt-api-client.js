'use strict';

/**
 * GPT 外包代充渠道客户端（协议见 对接api.md）
 *
 * 基础 URL:   管理员明确配置供应商的完整 HTTPS API 路径
 * 认证:       Authorization: Bearer gptk_...
 * 幂等键:     Idempotency-Key（提交代充必须带上）
 *
 * 本模块仅做轻量封装：提交代充、查询订单/任务状态、查询套餐/余额、测试连通。
 */

const axios = require('axios');
const { normalizeOutsourceBaseUrl, normalizeOutsourceProxy, safeProtocolCode,
    sanitizeOutsourceSnapshot, classifyOutsourceResult, safeStatus } = require('./gpt-outsourcing');
const { sanitizeProviderPlan } = require('./gpt-outsourcing');

// A missing endpoint must never silently send credentials to a default supplier.
const DEFAULT_BASE_URL = '';

function normalizeBaseUrl(raw) {
    return normalizeOutsourceBaseUrl(raw);
}

function maskApiKey(key) {
    const k = String(key || '').trim();
    if (!k) return '';
    if (k.length <= 8) return '****';
    return `${k.slice(0, 6)}\u2026${k.slice(-4)}`;
}
function safeInspectResponse(data) {
    const out = {};
    for (const key of ['ok', 'verified']) if (typeof data?.[key] === 'boolean') out[key] = data[key];
    if (['Free', 'Go', 'Plus', 'Pro', 'free', 'go', 'plus', 'pro', 'pro_100', 'pro_200', 'pro_500'].includes(data?.current_plan)) out.current_plan = data.current_plan;
    for (const key of ['error', 'reason']) {
        const code = safeProtocolCode(data?.[key]);
        if (code) out[key] = code;
    }
    if (Number.isSafeInteger(data?.upstream_status)) out.upstream_status = data.upstream_status;
    return out;
}

/**
 * 统一请求封装，始终返回 { success, status?, data?, error? }
 */
async function request(method, path, cfg, { body, headers: extraHeaders, timeoutMs } = {}) {
    let base;
    try { base = normalizeBaseUrl(cfg?.base_url); } catch (_) {
        return { success: false, error: '供应商 API 地址配置不完整或不安全', category: 'configuration',
            errorCode: 'GPT_OUTSOURCE_CONFIG_INVALID', ambiguousWrite: false };
    }
    const apiKey = String(cfg?.api_key || '').trim();
    if (!apiKey || /[\r\n]/.test(apiKey)) {
        return { success: false, error: '缺少有效 API Key', category: 'configuration',
            errorCode: 'GPT_OUTSOURCE_CONFIG_INVALID', ambiguousWrite: false };
    }
    const isWrite = !['GET', 'HEAD'].includes(String(method).toUpperCase());
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /[\r\n?#]/.test(path)) {
        return { success: false, error: '供应商接口路径无效', category: 'configuration',
            errorCode: 'GPT_OUTSOURCE_PATH_INVALID', ambiguousWrite: false };
    }
    const headers = {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
    };
    if (extraHeaders?.['Idempotency-Key']) headers['Idempotency-Key'] = extraHeaders['Idempotency-Key'];

    try {
        const response = await axios.request({
            method,
            url: `${base}${path}`,
            headers,
            data: body == null ? undefined : body,
            validateStatus: () => true,
            maxRedirects: 0,
            timeout: Number(timeoutMs) || 30000
        });
        let data = response.data;
        const contentType = String(response.headers?.['content-type'] || '').toLowerCase();
        if (contentType && !/^application\/(?:[a-z0-9.+-]+\+)?json(?:;|$)/.test(contentType)) {
            return protocolFailure(response.status, isWrite);
        }
        if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch (_) { return protocolFailure(response.status, isWrite); }
        }
        if (!data || typeof data !== 'object') {
            return protocolFailure(response.status, isWrite);
        }
        const ok = response.status >= 200 && response.status < 300;
        const errorCode = extractErrorCode(data);
        const category = response.status === 401 ? 'authentication' : response.status === 403 ? 'permission'
            : response.status === 429 ? 'rate_limit' : response.status >= 300 && response.status < 400 ? 'protocol'
                : response.status >= 500 ? 'http' : 'business';
        return {
            success: ok,
            status: response.status,
            data: ok ? data : sanitizeOutsourceSnapshot(data),
            error: ok ? undefined : extractErrorDetail(data, response.status),
            errorCode: ok ? undefined : errorCode || `HTTP_${response.status}`,
            category: ok ? undefined : category,
            ambiguousWrite: !ok && isWrite && (response.status >= 500 || response.status === 408
                || response.status >= 300 && response.status < 400 || errorCode === 'idempotency_conflict' || !errorCode)
        };
    } catch (error) {
        const timeout = ['ECONNABORTED', 'ETIMEDOUT'].includes(error?.code);
        const tls = ['EPROTO', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'DEPTH_ZERO_SELF_SIGNED_CERT'].includes(error?.code);
        return { success: false, error: timeout ? '供应商请求超时' : tls ? '供应商 TLS 连接未通过验证' : '供应商网络请求失败',
            category: 'transport', errorCode: timeout ? 'TRANSPORT_TIMEOUT' : tls ? 'TRANSPORT_TLS' : 'TRANSPORT_ERROR',
            ambiguousWrite: isWrite };
    }
}
function protocolFailure(status, ambiguousWrite) {
    return { success: false, status, error: '供应商返回了非 JSON 或无效协议响应',
        category: 'protocol', errorCode: 'PROTOCOL_INVALID_RESPONSE', ambiguousWrite: Boolean(ambiguousWrite) };
}
function extractErrorCode(data) {
    const detail = data?.detail;
    return safeProtocolCode(typeof detail === 'string' ? detail : detail?.error || detail?.code)
        || safeProtocolCode(data?.error || data?.error_code);
}

/**
 * 从第三方代充 API 响应中提取可读的错误信息（兼容 detail/message/error 等常见字段）
 */
function extractErrorDetail(data, status) {
    // Supplier validation errors may echo Session, CVC and card input values.
    // Only documented codes are suitable for logs and admin responses.
    const code = extractErrorCode(data);
    if (code) return code;
    if (Array.isArray(data?.detail)) return '供应商请求字段校验失败';
    return `供应商接口返回 HTTP ${Number(status) || '错误'}`;
}

/**
 * 查询可用 GPT 套餐 (GET /plans)
 */
async function fetchPlans(cfg) {
    const res = await request('GET', '/plans', cfg);
    if (!res.success) return res;
    const raw = res.data;
    const gptPlans = Array.isArray(raw)
        ? raw
        : (Array.isArray(raw?.gpt) ? raw.gpt : (raw?.plans || raw?.data || []));
    const creditPlans = Array.isArray(raw?.credit) ? raw.credit : [];
    if (!Array.isArray(raw) && !Array.isArray(raw?.gpt) && !Array.isArray(raw?.plans) && !Array.isArray(raw?.data)) {
        return protocolFailure(res.status, false);
    }
    return {
        success: true,
        status: res.status,
        plans: Array.isArray(gptPlans) ? gptPlans.map(sanitizeProviderPlan) : [],
        gptPlans: Array.isArray(gptPlans) ? gptPlans.map(sanitizeProviderPlan) : [],
        creditPlans: creditPlans.filter(plan => plan && typeof plan === 'object').map(plan => ({
            id: Number.isSafeInteger(Number(plan.id)) ? Number(plan.id) : undefined,
            name: typeof plan.name === 'string' && /^[\w $.-]{1,64}$/.test(plan.name) ? plan.name : undefined,
            credits: Number.isSafeInteger(Number(plan.credits)) ? Number(plan.credits) : undefined,
            price: Number.isSafeInteger(Number(plan.price)) ? Number(plan.price) : undefined,
            price_usd: typeof plan.price_usd === 'string' && /^\d{1,10}(?:\.\d{1,4})?$/.test(plan.price_usd) ? plan.price_usd : undefined
        }))
    };
}

/**
 * 建單前驗證 Session 與當前套餐 (POST /pay/inspect)
 */
async function inspectPay(cfg, { planKey, session, sessionToken }) {
    const sessionBody = session && typeof session === 'object'
        ? session
        : (sessionToken ? { access_token: sessionToken } : {});
    const body = {
        plan_key: planKey,
        session: sessionBody
    };
    if (!planKey || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(planKey)) return inputFailure('缺少明确的供应商套餐 key');
    const res = await request('POST', '/pay/inspect', cfg, { body, timeoutMs: 30000 });
    if (!res.success) return res;
    return {
        success: res.data?.verified === true && res.data?.ok === true,
        status: res.status,
        data: safeInspectResponse(res.data),
        error: safeProtocolCode(res.data?.error) || (res.data?.verified === true && res.data?.ok === true ? undefined : '供应商未确认账号凭证'),
        reason: safeProtocolCode(res.data?.reason) || undefined,
        upstreamStatus: res.data?.upstream_status ?? null
    };
}

/**
 * 提交 GPT 代充 (POST /pay)
 * @returns { success, orderId?, taskId?, data, error? }
 */
async function submitPay(cfg, { planKey, session, sessionToken, country, currency, newCard, cardId, cvc, acceptWarnings, billingAddress, proxy, clientRef, idempotencyKey }) {
    if (!planKey || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(planKey)) return inputFailure('缺少明确的供应商套餐 key');
    if (!idempotencyKey || !/^[a-zA-Z0-9:_-]{1,128}$/.test(String(idempotencyKey))) return inputFailure('必须提供稳定的幂等键');
    const hasNewCard = Boolean(newCard && typeof newCard === 'object' && !Array.isArray(newCard));
    const hasSavedCard = Number.isInteger(Number(cardId)) && Number(cardId) > 0;
    if (hasNewCard === hasSavedCard) return inputFailure('新银行卡与供应商已存卡须且只能选择一种');
    if (hasSavedCard && !/^\d{3,4}$/.test(String(cvc || ''))) return inputFailure('供应商已存卡需要有效 CVC');
    const body = {
        plan_key: planKey,
        country: country || 'PH',
        currency: currency || 'PHP'
    };
    if (newCard && typeof newCard === 'object') {
        body.new_card = newCard;
    } else if (Number.isInteger(Number(cardId)) && Number(cardId) > 0) {
        body.card_id = Number(cardId);
        if (cvc) body.cvc = String(cvc);
        if (acceptWarnings === true) body.accept_warnings = true;
    }
    if (billingAddress && typeof billingAddress === 'object') body.billing_address = billingAddress;
    if (clientRef) body.client_ref = String(clientRef);
    if (proxy) {
        try { body.proxy = normalizeOutsourceProxy(proxy); } catch (_) { return inputFailure('代理地址不符合供应商公网 IP 协议'); }
    }
    if (session && typeof session === 'object') {
        body.session = session;
    } else if (sessionToken) {
        body.session = { access_token: sessionToken };
    }
    const headers = {};
    if (idempotencyKey) {
        headers['Idempotency-Key'] = idempotencyKey;
    }

    const res = await request('POST', '/pay', cfg, { body, headers, timeoutMs: 60000 });
    if (!res.success) return res;

    const orderId = extractOrderId(res.data);
    const taskId = extractTaskId(res.data);
    if (res.data?.ok !== true || (!orderId && !taskId)) {
        return { ...protocolFailure(res.status, true), error: '供应商已响应建单但缺少订单号和任务号，结果待确认', data: sanitizeOutsourceSnapshot(res.data) };
    }
    return {
        success: true,
        status: res.status,
        orderId,
        taskId,
        id: orderId || taskId || extractId(res.data) || null,
        alreadySubmitted: Boolean(res.data?.already_submitted),
        topupCode: extractTopupCode(res.data),
        data: sanitizeOutsourceSnapshot(res.data)
    };
}
function inputFailure(error) {
    return { success: false, error, category: 'configuration', errorCode: 'GPT_OUTSOURCE_INPUT_INVALID', ambiguousWrite: false };
}

function extractId(data) {
    if (!data || typeof data !== 'object') return null;
    return data.id ?? data.order_id ?? data.task_id ?? data._id ?? null;
}

function extractOrderId(data) {
    if (!data || typeof data !== 'object') return null;
    return validReferenceId(data.order_id
        ?? data.order?.id
        ?? data.orderId
        ?? data.pay_order_id
        ?? null);
}

function extractTaskId(data) {
    if (!data || typeof data !== 'object') return null;
    return validReferenceId(data.task_id
        ?? data.task?.id
        ?? data.taskId
        ?? null);
}
function validReferenceId(raw) {
    if (typeof raw === 'number') return Number.isSafeInteger(raw) && raw > 0 ? raw : null;
    if (typeof raw !== 'string' || !/^\d{1,40}$/.test(raw) || /^0+$/.test(raw)) return null;
    const id = Number(raw);
    return Number.isSafeInteger(id) ? id : raw;
}

function extractTopupCode(data) {
    if (!data || typeof data !== 'object') return null;
    const code = data.topup_code ?? data.order?.topup_code ?? null;
    return code == null || String(code).trim() === '' ? null : String(code).trim();
}

/**
 * 查询单笔代充订单状态 (GET /pay/orders/{order_id})
 */
async function queryOrder(cfg, orderId) {
    if (!validReferenceId(orderId)) {
        return { success: false, error: '缺少订单号' };
    }
    const res = await request('GET', `/pay/orders/${encodeURIComponent(orderId)}`, cfg);
    if (!res.success) return res;
    return {
        success: true,
        status: res.status,
        data: sanitizeOutsourceSnapshot(res.data),
        rawStatus: extractStatus(res.data),
        outcome: classifyOutsourceResult(res.data, 'order')
    };
}

/**
 * 查询任务状态 (GET /tasks/{task_id})
 */
async function queryTask(cfg, taskId) {
    if (!validReferenceId(taskId)) {
        return { success: false, error: '缺少任务号' };
    }
    const res = await request('GET', `/tasks/${encodeURIComponent(taskId)}`, cfg);
    if (!res.success) return res;
    return {
        success: true,
        status: res.status,
        data: sanitizeOutsourceSnapshot(res.data),
        rawStatus: extractStatus(res.data),
        outcome: classifyOutsourceResult(res.data, 'task')
    };
}

/**
 * 查询积分与账户余额 (GET /balance)
 */
async function queryBalance(cfg) {
    const res = await request('GET', '/balance', cfg);
    if (!res.success) return res;
    const balance = sanitizeBalance(res.data);
    if (!Object.keys(balance).length) return protocolFailure(res.status, false);
    return {
        success: true,
        status: res.status,
        data: balance,
        credits: balance.credits ?? null,
        balance: balance.balance ?? null,
        balanceUsd: balance.balance_usd ?? null
    };
}

function extractStatus(data) {
    if (!data || typeof data !== 'object') return '';
    const resultStatus = data.result && typeof data.result === 'object' ? data.result.status : '';
    if (resultStatus) return safeStatus(resultStatus);
    const outer = data.status ?? data.state ?? data.order?.status ?? data.task?.status ?? '';
    if (String(outer).toLowerCase() === 'done' && data.result && data.result.ok === false) return 'failed';
    return safeStatus(outer);
}
function sanitizeBalance(data) {
    const out = {};
    for (const key of ['credits', 'balance']) {
        const value = data?.[key];
        if (typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && /^\d{1,12}(?:\.\d{1,4})?$/.test(value)) out[key] = value;
    }
    if (typeof data?.balance_usd === 'string' && /^\d{1,12}(?:\.\d{1,4})?$/.test(data.balance_usd)) out.balance_usd = data.balance_usd;
    return out;
}

/**
 * 测试连接：查询套餐 + 余额，返回摘要
 */
async function testConnection(cfg) {
    const [plansRes, balanceRes] = await Promise.all([
        fetchPlans(cfg),
        queryBalance(cfg)
    ]);

    const checks = [
        { key: 'plans', label: '套餐目录读取', state: plansRes.success ? 'passed' : 'failed',
            error: plansRes.error || undefined, code: plansRes.errorCode || undefined },
        { key: 'balance', label: '服务积分与余额读取', state: balanceRes.success ? 'passed' : 'failed',
            error: balanceRes.error || undefined, code: balanceRes.errorCode || undefined },
        { key: 'inspect', label: '凭证检查权限', state: 'unverified' },
        { key: 'create', label: '建单与付款权限', state: 'unverified' },
        { key: 'order', label: '订单查询权限', state: 'unverified' },
        { key: 'task', label: '任务查询权限', state: 'unverified' },
        { key: 'credentials', label: '补交凭证权限', state: 'unverified' }
    ];
    const success = plansRes.success && balanceRes.success;
    return {
        success,
        message: success ? '供应商套餐和余额读取通过；建单、付款与订单查询权限尚未验证' : '供应商只读检查未全部通过',
        error: success ? undefined : [plansRes.error, balanceRes.error].filter(Boolean).join('；'),
        checks,
        plans: plansRes.plans || [],
        gptPlans: plansRes.gptPlans || [],
        creditPlans: plansRes.creditPlans || [],
        balance: balanceRes.success ? sanitizeBalance(balanceRes.data) : null
    };
}

async function supplementCredentials(cfg, orderId, { cvc, session, ttl = 900 } = {}) {
    if (!validReferenceId(orderId) || !/^\d{3,4}$/.test(String(cvc || '')) || !Number.isInteger(ttl) || ttl < 30 || ttl > 3600) {
        return inputFailure('补交凭证需要原订单号、有效 CVC 和 30 至 3600 秒有效期');
    }
    const body = { cvc: String(cvc), ttl };
    if (session && typeof session === 'object' && !Array.isArray(session)) body.session = session;
    const res = await request('POST', `/orders/${encodeURIComponent(orderId)}/credentials`, cfg, { body });
    if (!res.success) return res;
    if (res.data.ok !== true || String(res.data.order_id) !== String(orderId)) return protocolFailure(res.status, true);
    return { ...res, data: sanitizeOutsourceSnapshot(res.data) };
}

module.exports = {
    DEFAULT_BASE_URL,
    normalizeBaseUrl,
    maskApiKey,
    request,
    fetchPlans,
    inspectPay,
    submitPay,
    queryOrder,
    queryTask,
    queryBalance,
    supplementCredentials,
    testConnection,
    extractOrderId,
    extractTaskId,
    extractTopupCode,
    extractStatus,
    extractErrorDetail,
    sanitizeBalance
};
