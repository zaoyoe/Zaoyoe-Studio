'use strict';

const net = require('node:net');
const crypto = require('node:crypto');

const OUTSOURCE_PLAN_NAMES = Object.freeze({
    go: 'chatgptgoplan',
    plus: 'chatgptplusplan',
    pro_100: 'chatgptprolite',
    pro_200: 'chatgptpro',
    pro_500: 'chatgptpromax'
});
const PLAN_ALIASES = Object.freeze({
    pro_5x: 'pro_100', pro5x: 'pro_100', pro100: 'pro_100',
    pro_20x: 'pro_200', pro20x: 'pro_200', pro200: 'pro_200', pro500: 'pro_500'
});
const STATUS_CODES = new Set(['pending', 'queued', 'running', 'processing', 'success', 'failed',
    'declined', 'cancelled', 'system_error', 'stalled', 'manual', 'requires_cvc', 'needs_cvc',
    'requires_action', 'manual_review', 'done']);
const PROTOCOL_CODES = new Set([
    'not_authenticated', 'invalid_api_key', 'insufficient_scope', 'idempotency_key_required',
    'session_required', 'session_expired', 'session_unverified', 'cloudflare_challenge', 'local_check',
    'exactly_one_card_source_required', 'invalid_pan', 'invalid_expiry', 'invalid_proxy',
    'proxy_hostname_must_be_public_ip', 'private_proxy_forbidden', 'invalid_currency',
    'amount_required', 'invalid_fx_rate', 'invalid_batch_size', 'ids_required',
    'card_provider_unavailable', 'payment_cards_disabled', 'credit_purchase_disabled',
    'subscription_purchase_disabled', 'order_not_found', 'task_not_found', 'card_not_found',
    'proxy_not_found', 'request_not_found', 'api_key_not_found', 'idempotency_conflict',
    'card_already_exists', 'card_disabled', 'credentials_not_supplementable',
    'warnings_not_accepted', 'concurrency_limit', 'insufficient_credits', 'topup_code_out_of_stock',
    'already_submitted', 'transient_secret_store_unavailable', 'cf_challenge_unresolved',
    'card_declined', 'insufficient_funds', 'incorrect_cvc', 'invalid_cvc', 'expired_card',
    'do_not_honor', 'generic_decline', 'lost_card', 'stolen_card', 'transaction_not_allowed',
    'fraudulent', 'requires_cvc', 'needs_cvc'
]);
const DECLINE_CODES = new Set(['card_declined', 'insufficient_funds', 'incorrect_cvc', 'invalid_cvc',
    'expired_card', 'do_not_honor', 'generic_decline', 'lost_card', 'stolen_card',
    'transaction_not_allowed', 'fraudulent']);

function outsourcingError(message, code) {
    return Object.assign(new Error(message), { code, statusCode: 400 });
}
function canonicalizeOutsourcePlan(value) {
    const key = String(value || '').trim().toLowerCase();
    const canonical = PLAN_ALIASES[key] || key;
    if (!Object.hasOwn(OUTSOURCE_PLAN_NAMES, canonical)) {
        throw outsourcingError('该 GPT 套餐未配置受支持的外包渠道，已停止提交', 'GPT_OUTSOURCE_PLAN_UNSUPPORTED');
    }
    return canonical;
}
function normalizeOutsourceBaseUrl(raw) {
    const supplied = String(raw || '').trim();
    let url;
    try { url = new URL(supplied); } catch (_) {
        throw outsourcingError('请填写供应商提供的完整 HTTPS API 地址，包含接口路径', 'GPT_OUTSOURCE_CONFIG_INVALID');
    }
    if (/[\x00-\x20\\?#]/.test(supplied) || /\/(?:\.|\.\.)(?:\/|$)/.test(supplied)
        || url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash
        || url.pathname === '/' || /%2f|%5c|%2e|\\/i.test(url.pathname)) {
        throw outsourcingError('API 地址须使用 HTTPS 并包含明确接口路径，不能含账号、参数或片段', 'GPT_OUTSOURCE_CONFIG_INVALID');
    }
    return url.href.replace(/\/+$/, '');
}
function normalizePlanMapping(raw) {
    let mapping = raw || {};
    if (typeof mapping === 'string') {
        try { mapping = JSON.parse(mapping); } catch (_) {
            throw outsourcingError('套餐映射须为有效 JSON 对象', 'GPT_OUTSOURCE_MAPPING_INVALID');
        }
    }
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
        throw outsourcingError('套餐映射须为对象', 'GPT_OUTSOURCE_MAPPING_INVALID');
    }
    const result = {};
    for (const [local, provider] of Object.entries(mapping)) {
        const canonical = canonicalizeOutsourcePlan(local);
        if (provider == null || typeof provider === 'string' && !provider.trim()) continue;
        const key = typeof provider === 'string' ? provider.trim() : '';
        if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(key)
            || (Object.hasOwn(result, canonical) && result[canonical] !== key)) {
            throw outsourcingError('套餐映射包含无效或冲突的供应商套餐 key', 'GPT_OUTSOURCE_MAPPING_INVALID');
        }
        result[canonical] = key;
    }
    return result;
}
function validateOutsourceConfig(config, { requireKey = true } = {}) {
    const normalized = {
        ...config,
        base_url: normalizeOutsourceBaseUrl(config?.base_url),
        api_key: String(config?.api_key || '').trim(),
        plan_mapping: normalizePlanMapping(config?.plan_mapping)
    };
    if ((requireKey && !normalized.api_key) || /[\r\n]/.test(normalized.api_key)) {
        throw outsourcingError('请配置有效的供应商 API Key', 'GPT_OUTSOURCE_CONFIG_INVALID');
    }
    const regions = { US: 'USD', PH: 'PHP', EG: 'EGP', CL: 'CLP' };
    if (config?.country || config?.currency) {
        normalized.country = String(config?.country || '').trim().toUpperCase();
        normalized.currency = String(config?.currency || '').trim().toUpperCase();
        if (regions[normalized.country] !== normalized.currency) {
            throw outsourcingError('外包渠道的国家与币种不匹配', 'GPT_OUTSOURCE_REGION_INVALID');
        }
    }
    return normalized;
}
function resolveOutsourcePlan(planType, plans, mapping = {}) {
    const localPlan = canonicalizeOutsourcePlan(planType);
    const configured = normalizePlanMapping(mapping);
    const planKey = configured[localPlan];
    if (!planKey) {
        throw outsourcingError('该套餐未设置供应商映射，已停止提交', 'GPT_OUTSOURCE_MAPPING_MISSING');
    }
    const matches = (Array.isArray(plans) ? plans : []).filter(plan => plan && String(plan.key) === planKey);
    if (matches.length !== 1 || ![true, 1, '1'].includes(matches[0].enabled)) {
        throw outsourcingError('供应商未明确开放该映射套餐，已停止提交', 'GPT_OUTSOURCE_PLAN_DISABLED');
    }
    const providerPlan = matches[0];
    const planName = OUTSOURCE_PLAN_NAMES[localPlan];
    if (providerPlan.plan_name !== planName) {
        throw outsourcingError('供应商商品与本地 GPT 套餐不一致，已停止提交', 'GPT_OUTSOURCE_PLAN_MISMATCH');
    }
    return { localPlan, planKey, planName, providerPlan: sanitizeProviderPlan(providerPlan) };
}
function sanitizeProviderPlan(plan) {
    const out = {};
    if (typeof plan?.key === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(plan.key)) out.key = plan.key;
    if (Object.values(OUTSOURCE_PLAN_NAMES).includes(plan?.plan_name)) {
        out.plan_name = plan.plan_name;
        out.name = { chatgptgoplan: 'ChatGPT Go', chatgptplusplan: 'ChatGPT Plus', chatgptprolite: 'ChatGPT Pro 100',
            chatgptpro: 'ChatGPT Pro 200', chatgptpromax: 'ChatGPT Pro 500' }[plan.plan_name];
    }
    if ([true, false, 0, 1, '0', '1'].includes(plan?.enabled)) out.enabled = [true, 1, '1'].includes(plan.enabled);
    for (const field of ['id', 'success_cost', 'fail_cost', 'sort']) {
        if (Number.isSafeInteger(Number(plan?.[field])) && Number(plan[field]) >= 0) out[field] = Number(plan[field]);
    }
    return out;
}
function safeProtocolCode(raw) {
    const candidate = String(raw || '').trim().toLowerCase();
    return PROTOCOL_CODES.has(candidate) ? candidate : '';
}
function safeStatus(raw) {
    const value = String(raw || '').trim().toLowerCase();
    return STATUS_CODES.has(value) ? value : 'unknown';
}
function numericId(raw) {
    if (typeof raw === 'number') return Number.isSafeInteger(raw) && raw > 0 ? raw : undefined;
    if (typeof raw !== 'string' || !/^\d{1,40}$/.test(raw) || /^0+$/.test(raw)) return undefined;
    const value = Number(raw);
    return Number.isSafeInteger(value) ? value : raw;
}
function accountFingerprint(raw) {
    const email = String(raw || '').trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        ? crypto.createHash('sha256').update(email).digest('hex') : undefined;
}
function sanitizeOutsourceSnapshot(data, depth = 0) {
    if (depth > 3) return {};
    const input = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    const out = {};
    for (const key of ['id', 'order_id', 'task_id']) {
        const id = numericId(input[key]);
        if (id !== undefined) out[key] = id;
    }
    for (const key of ['status', 'queue_status', 'display_status', 'outcome']) {
        if (input[key] != null) out[key] = safeStatus(input[key]);
    }
    for (const key of ['plan', 'plan_key']) {
        if (typeof input[key] === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(input[key])) out[key] = input[key];
    }
    const accountHash = accountFingerprint(input.recharge_account);
    if (accountHash) out.account_fingerprint = accountHash;
    else if (/^[a-f0-9]{64}$/.test(input.account_fingerprint)) out.account_fingerprint = input.account_fingerprint;
    for (const key of ['error', 'error_code', 'decline_code', 'reason']) {
        const code = safeProtocolCode(input[key]);
        if (code) out[key] = code;
    }
    for (const key of ['ok', 'idempotent', 'already_submitted', 'payment_submitted', 'payment_charged', 'charged', 'no_charge']) {
        if (typeof input[key] === 'boolean') out[key] = input[key];
    }
    if (input.charge_id || input.has_charge === true) out.has_charge = true;
    const paymentStates = ['not_started', 'declined', 'charged', 'paid', 'succeeded', 'captured', 'unknown'];
    if (paymentStates.includes(input.payment_state)) out.payment_state = input.payment_state;
    if (['no_charge', 'charged', 'paid', 'succeeded', 'captured', 'unknown'].includes(input.settlement?.status)) {
        out.settlement = { status: input.settlement.status };
    }
    for (const key of ['credits_cost', 'amount_minor', 'attempt']) {
        if (Number.isSafeInteger(input[key]) && input[key] >= 0) out[key] = input[key];
    }
    if (typeof input.amount === 'string' && /^\d{1,12}(?:\.\d{1,4})?$/.test(input.amount)) out.amount = input.amount;
    if (['USD', 'PHP', 'EGP', 'CLP'].includes(input.currency)) out.currency = input.currency;
    if (input.result && typeof input.result === 'object') out.result = sanitizeOutsourceSnapshot(input.result, depth + 1);
    if (input.order && typeof input.order === 'object') out.order = sanitizeOutsourceSnapshot(input.order, depth + 1);
    if (input.task && typeof input.task === 'object') out.task = sanitizeOutsourceSnapshot(input.task, depth + 1);
    return out;
}
function classifyOutsourceResult(data, source = 'order') {
    if (!['order', 'task'].includes(source)) {
        throw outsourcingError('必须明确区分订单查询与任务查询', 'GPT_OUTSOURCE_RESULT_INVALID');
    }
    const outer = data && typeof data === 'object' ? data : {};
    const item = source === 'order' ? (outer.order || outer) : (outer.task || outer);
    const result = source === 'task' && item.result && typeof item.result === 'object' ? item.result : {};
    // Queue completion is deliberately not a business success state.
    const rawStatus = safeStatus(item.status);
    const evidence = source === 'task' ? [outer, item, result] : [outer, item];
    const contradictoryCharge = evidence.some(value => value.charged === true || value.payment_charged === true
        || Boolean(value.charge_id) || value.has_charge === true || ['charged', 'paid', 'succeeded', 'captured'].includes(value.payment_state)
        || ['charged', 'paid', 'succeeded', 'captured'].includes(value.settlement?.status));
    let state = 'hold';
    const contradictsSuccess = evidence.some(value => value.ok === false || value.result?.ok === false
        || value.no_charge === true || value.payment_submitted === false || value.charged === false
        || value.payment_charged === false || value.payment_state === 'not_started'
        || value.settlement?.status === 'no_charge') || (result.status != null && result.status !== 'success');
    if (rawStatus === 'success' && !contradictsSuccess && (source === 'order' || result.ok === true)) state = 'success';
    else if (['pending', 'queued', 'running', 'processing'].includes(rawStatus)) state = 'pending';
    else if (['requires_cvc', 'needs_cvc', 'requires_action'].includes(rawStatus)) state = 'requires_action';
    else if (['failed', 'declined', 'cancelled'].includes(rawStatus) && !contradictoryCharge) {
        const noCharge = evidence.some(value => value.no_charge === true || value.payment_submitted === false
            || value.charged === false || value.payment_charged === false
            || value.payment_state === 'not_started' || value.settlement?.status === 'no_charge'
            || DECLINE_CODES.has(safeProtocolCode(value.decline_code || value.error_code)));
        if (noCharge) state = 'confirmed_no_charge';
    }
    const code = safeProtocolCode(result.error || item.error_code || item.error || result.decline_code || item.decline_code);
    return {
        state, terminal: ['success', 'confirmed_no_charge'].includes(state),
        releaseAssets: state === 'confirmed_no_charge', rawStatus, code,
        snapshot: sanitizeOutsourceSnapshot(outer), source,
        accountFingerprint: accountFingerprint(item.recharge_account)
            || (/^[a-f0-9]{64}$/.test(item.account_fingerprint) ? item.account_fingerprint : null),
        planKey: /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(item.plan || item.plan_key || '') ? item.plan || item.plan_key : null,
        currency: ['USD', 'PHP', 'EGP', 'CLP'].includes(item.currency) ? item.currency : null
    };
}
function isPublicIp(hostname) {
    const ip = hostname.replace(/^\[|\]$/g, '');
    const version = net.isIP(ip);
    if (version === 4) {
        const [a, b, c] = ip.split('.').map(Number);
        return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
            || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
            || (a === 192 && b === 0) || (a === 192 && b === 0 && c === 2)
            || (a === 198 && [18, 19].includes(b)) || (a === 198 && b === 51 && c === 100)
            || (a === 203 && b === 0 && c === 113));
    }
    return version === 6 && /^[23][0-9a-f]{3}:/i.test(ip) && !/^2001:(?:db8|0*0):/i.test(ip);
}
function normalizeOutsourceProxy(raw) {
    if (raw == null || String(raw).trim() === '') return null;
    let proxy;
    try { proxy = new URL(String(raw).trim()); } catch (_) {
        throw outsourcingError('供应商协议要求带端口的公网 IP 代理地址', 'GPT_OUTSOURCE_PROXY_INVALID');
    }
    // URL.port removes default ports; preserve an explicitly supplied :80 / :443.
    const authority = String(raw).trim().split('://')[1]?.split(/[/?#]/)[0] || '';
    const explicitPort = authority.match(/:(\d+)$/)?.[1];
    if (!['http:', 'https:', 'socks5:'].includes(proxy.protocol) || !isPublicIp(proxy.hostname)
        || !explicitPort || Number(explicitPort) < 1 || Number(explicitPort) > 65535
        || proxy.search || proxy.hash || !['', '/'].includes(proxy.pathname)) {
        throw outsourcingError('供应商协议只接受 HTTP、HTTPS 或 SOCKS5 的公网 IP 代理，且必须带端口', 'GPT_OUTSOURCE_PROXY_INVALID');
    }
    return `${proxy.protocol}//${proxy.username ? `${proxy.username}${proxy.password ? `:${proxy.password}` : ''}@` : ''}${proxy.hostname}:${Number(explicitPort)}`;
}

module.exports = { OUTSOURCE_PLAN_NAMES, canonicalizeOutsourcePlan, normalizeOutsourceBaseUrl,
    normalizePlanMapping, validateOutsourceConfig, resolveOutsourcePlan, classifyOutsourceResult,
    sanitizeOutsourceSnapshot, sanitizeProviderPlan, normalizeOutsourceProxy, safeProtocolCode, accountFingerprint, safeStatus };
