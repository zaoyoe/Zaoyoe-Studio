'use strict';

const { PLATFORM_CONFIG, REGION_CONFIG, SUPPORTED_REGIONS, DEFAULT_REGION } = require('./region-config');
const { resolveActivationInput, buildActivationCredentialEnv } = require('./activation-routing');
const { resolvePlanName } = require('./cdk-plan-catalog');
const { plans: grokPlans } = require('./public/grok-plan-catalog');
const { extractEmailFromSession } = require('./session-auth');
const { redactSensitiveText } = require('./session-security');

const PLAN_KEYS = Object.freeze({
    chatgpt: ['go', 'plus', 'pro_100', 'pro_200', 'pro_500'],
    claude: ['claude_pro', 'claude_pro_annual', 'claude_max_100', 'claude_max_200'],
    grok: Object.keys(grokPlans)
});
const MODES = Object.freeze([{ id: 'checkout', label: '完整结账检查' }, { id: 'link', label: '仅生成链接' }]);
const CHECK_STATUSES = new Set(['running', 'passed', 'failed', 'skipped', 'unconfirmed']);
const MARKER = 'CHECKOUT_DIAGNOSTIC:';

function diagnosticError(code, message) {
    return Object.assign(new Error(message), { code, statusCode: 400 });
}
function getDiagnosticCatalog(defaultRegion = DEFAULT_REGION) {
    return {
        version: 1,
        defaultRegion: SUPPORTED_REGIONS.includes(defaultRegion) ? defaultRegion : DEFAULT_REGION,
        scope: 'local_card_pool',
        scopeLabel: '检查本地银行卡充值链路；不创建第三方代充订单，不预留银行卡或提交支付',
        modes: MODES.map(mode => ({ ...mode })),
        regions: SUPPORTED_REGIONS.map(id => ({ id, label: REGION_CONFIG[id].label, currency: REGION_CONFIG[id].currency })),
        platforms: Object.entries(PLAN_KEYS).map(([id, keys]) => ({
            id, name: PLATFORM_CONFIG[id].name,
            modes: MODES.filter(mode => id === 'chatgpt' || mode.id === 'checkout').map(mode => ({ ...mode })),
            regions: id === 'chatgpt' ? [...SUPPORTED_REGIONS] : ['US'],
            plans: keys.map(key => ({ id: key, label: PLATFORM_CONFIG[id].plans[key].label,
                planName: resolvePlanName(key), amount: PLATFORM_CONFIG[id].plans[key].amount,
                currency: 'USD', interval: grokPlans[key]?.interval || (key === 'claude_pro_annual' ? 'year' : 'month') }))
        }))
    };
}

function resolveDiagnosticInput({ body = {}, defaultRegion = DEFAULT_REGION, validateChatGpt } = {}) {
    const platform = String(body.platform || 'chatgpt').trim().toLowerCase();
    const planType = String(body.plan_type || body.planType || (platform === 'chatgpt' ? 'plus' : '')).trim().toLowerCase();
    if (!PLAN_KEYS[platform]?.includes(planType)) throw diagnosticError('DIAGNOSTIC_PLAN_INVALID', '请选择该平台当前支持的明确套餐和计费周期');
    const mode = String(body.mode || 'checkout').trim().toLowerCase();
    if (!['checkout', 'link'].includes(mode) || mode === 'link' && platform !== 'chatgpt') {
        throw diagnosticError('DIAGNOSTIC_MODE_INVALID', '该平台不支持所选诊断模式');
    }
    if (body.region && body.country && String(body.region).trim().toUpperCase() !== String(body.country).trim().toUpperCase()) {
        throw diagnosticError('DIAGNOSTIC_REGION_INVALID', '诊断地区参数不一致');
    }
    const region = String(body.region || body.country || (platform === 'chatgpt' ? defaultRegion : 'US')).trim().toUpperCase();
    if (!SUPPORTED_REGIONS.includes(region) || platform !== 'chatgpt' && region !== 'US') {
        throw diagnosticError('DIAGNOSTIC_REGION_INVALID', '该平台当前不支持所选诊断地区');
    }
    const rawSession = typeof body.session === 'string' ? body.session.trim() : '';
    if (!rawSession || rawSession.length > 128 * 1024) throw diagnosticError('DIAGNOSTIC_CREDENTIAL_INVALID', '请输入有效的登录凭证');
    if (platform === 'chatgpt' && typeof validateChatGpt !== 'function') throw new Error('ChatGPT 凭证校验器未配置');
    const activation = resolveActivationInput({ cdkDetails: { plan_type: planType, platform }, requestedPlatform: platform,
        rawSession, validateChatGpt });
    const override = String(body.plan_name || body.planNameOverride || '').trim();
    if (override && (!/^[a-zA-Z0-9_-]{1,80}$/.test(override) || platform !== 'chatgpt'
        || mode !== 'link' && override !== activation.planName)) {
        throw diagnosticError('DIAGNOSTIC_OVERRIDE_INVALID', '自定义 plan_name 仅适用于 ChatGPT 的仅生成链接模式');
    }
    return { ...activation, region, currency: REGION_CONFIG[region].currency, mode,
        email: extractEmailFromSession(rawSession) || '', planNameOverride: override || '',
        scope: 'local_card_pool' };
}

function buildDiagnosticRuntimeEnv(input, baseEnv = {}, jobKey) {
    if (!jobKey || !/^[a-zA-Z0-9_-]{1,80}$/.test(jobKey)) throw new Error('诊断任务标识无效');
    return { ...baseEnv,
        ...buildActivationCredentialEnv({ platform: input.platform, token: input.token, sessionRaw: input.storedSession }),
        JOB_KEY: jobKey, CDK_CODE: '', CDK_PLAN_TYPE: input.planType,
        CHATGPT_SESSION_COOKIE: '', CHATGPT_SESSION_TOKEN: '',
        ACTIVATION_EMAIL: '', PAYMENT_REGION_OVERRIDE: input.region,
        CHECKOUT_DEBUG_ONLY: '1', CHECKOUT_DIAGNOSTIC_MODE: input.mode,
        CHECKOUT_MODE: input.mode === 'link' ? 'api' : 'auto',
        PLAN_NAME_OVERRIDE: input.planNameOverride || '', RECORD_VIDEO: '1'
    };
}

function safeDiagnosticMessage(value, max = 700) {
    return redactSensitiveText(String(value ?? ''))
        .replace(/(["']?(?:password|client[_-]?secret|secret|session[_-]?key|claude_session_key|grok_token|sso(?:-rw)?|auth_token|token|cvv|cvc)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, '$1[REDACTED]')
        .replace(/\b(?:sk-ant-|sk-|cs_|pi_|pm_|sess_)[A-Za-z0-9_-]+\b/g, '[ID_REDACTED]')
        .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[OPAQUE_REDACTED]')
        .replace(/https?:\/\/[^\s<>"']+/gi, '[链接已隐藏]')
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[邮箱已隐藏]')
        .replace(/(?:CHECKOUT_DIAGNOSTIC|CHECKOUT_URL|CHECKOUT_DEBUG_SUCCESS|PAYMENT_SUCCESS|PAYMENT_STATE|VIDEO_FILE|FAILURE_SCREENSHOT|SUCCESS_SCREENSHOT)/g, '[标记已隐藏]')
        .replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
}
function trustedCheckoutUrl(value, platform) {
    if (typeof value !== 'string' || value.length > 12000) return null;
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.port || url.username || url.password) return null;
        const allowed = platform === 'chatgpt' ? ['chatgpt.com', 'pay.openai.com', 'checkout.stripe.com']
            : platform === 'claude' ? ['claude.ai', 'checkout.stripe.com'] : ['grok.com', 'checkout.stripe.com'];
        if (!allowed.includes(url.hostname)) return null;
        if (url.hostname === 'chatgpt.com' && !/^\/checkout(?:\/|$)/.test(url.pathname)) return null;
        if (url.hostname === 'claude.ai' && !/^\/upgrade(?:\/|$)/.test(url.pathname)) return null;
        if (url.hostname === 'grok.com' && url.pathname !== '/plans') return null;
        return url.href;
    } catch (_) { return null; }
}

// Only whitelisted fields enter stored/admin reports. Upstream error bodies cannot
// supply arbitrary credentials, card values, HTML or a successful payment result.
function sanitizeDiagnosticReport(raw) {
    if (!raw || raw.version !== 1 || !PLAN_KEYS[raw.platform]?.includes(raw.planType)
        || !['checkout', 'link'].includes(raw.mode) || raw.platform !== 'chatgpt' && raw.mode === 'link'
        || !SUPPORTED_REGIONS.includes(raw.region) || raw.platform !== 'chatgpt' && raw.region !== 'US'
        || raw.paymentSubmitted !== false) return null;
    const report = { version: 1, platform: raw.platform, planType: raw.planType, mode: raw.mode,
        region: raw.region, currency: REGION_CONFIG[raw.region].currency, paymentSubmitted: false,
        scope: 'local_card_pool', phase: safeDiagnosticMessage(raw.phase || 'unknown', 80),
        checks: [] };
    for (const field of ['startedAt', 'finishedAt']) {
        if (typeof raw[field] === 'string' && Number.isFinite(Date.parse(raw[field]))) report[field] = raw[field];
    }
    if (Number.isFinite(raw.elapsedMs) && raw.elapsedMs >= 0) report.elapsedMs = raw.elapsedMs;
    if (typeof raw.success === 'boolean') report.success = raw.success;
    if (raw.code) report.code = safeDiagnosticMessage(raw.code, 100);
    if (raw.message) report.message = safeDiagnosticMessage(raw.message);
    for (const check of Array.isArray(raw.checks) ? raw.checks.slice(0, 30) : []) {
        if (!check || !/^[a-zA-Z0-9_.-]{1,80}$/.test(check.id || '') || !CHECK_STATUSES.has(check.status)) continue;
        const item = { id: check.id, label: safeDiagnosticMessage(check.label, 100), status: check.status,
            message: safeDiagnosticMessage(check.message) };
        if (Number.isFinite(check.durationMs) && check.durationMs >= 0) item.durationMs = check.durationMs;
        report.checks.push(item);
    }
    const checkout = raw.checkout || {};
    const url = trustedCheckoutUrl(checkout.url, raw.platform);
    report.checkout = { kind: ['hosted', 'native', 'link'].includes(checkout.kind) ? checkout.kind : 'native',
        confirmed: checkout.confirmed === true && raw.mode === 'checkout', expiresAt: null };
    if (url) report.checkout.url = url;
    for (const field of ['amount', 'expectedAmount']) {
        report.checkout[field] = Number.isFinite(checkout[field]) && checkout[field] >= 0 ? checkout[field] : null;
    }
    for (const field of ['currency', 'expectedCurrency']) {
        report.checkout[field] = /^[A-Z]{3}$/.test(checkout[field] || '') ? checkout[field] : null;
    }
    if (checkout.product) report.checkout.product = safeDiagnosticMessage(checkout.product, 120);
    if (['month', 'year'].includes(checkout.interval)) report.checkout.interval = checkout.interval;
    // Successful link creation and successful form checks are distinct. A bare
    // success marker or an unconfirmed/missing report is never enough.
    if (report.success === true && (!url || raw.mode === 'checkout' && (!report.checkout.confirmed
        || !report.checkout.product || !report.checkout.interval || !(report.checkout.amount > 0)
        || report.checkout.currency !== report.currency
        || report.checkout.interval !== (grokPlans[raw.planType]?.interval || (raw.planType === 'claude_pro_annual' ? 'year' : 'month'))
        || report.checks.some(check => ['failed', 'unconfirmed', 'running'].includes(check.status))
        || !['session', 'form', 'product', 'amount', 'currency', 'interval'].every(id => report.checks.some(check => check.id === id && check.status === 'passed'))))) return null;
    return report;
}
function parseDiagnosticOutput(output) {
    let latest = null;
    for (const line of String(output || '').split(/\r?\n/)) {
        if (!line.startsWith(MARKER) || line.length > 65536) continue;
        try { const report = sanitizeDiagnosticReport(JSON.parse(line.slice(MARKER.length))); if (report) latest = report; } catch (_) {}
    }
    return latest;
}

function createDiagnosticReporter(input, emit = line => console.log(line), now = () => Date.now()) {
    const start = now();
    const plan = getDiagnosticCatalog(input.region).platforms.find(platform => platform.id === input.platform)
        ?.plans.find(plan => plan.id === input.planType);
    const report = { version: 1, platform: input.platform, planType: input.planType, region: input.region,
        currency: REGION_CONFIG[input.region]?.currency, mode: input.mode, scope: 'local_card_pool',
        startedAt: new Date(start).toISOString(), elapsedMs: 0, phase: 'browser', paymentSubmitted: false,
        checks: [], checkout: { kind: input.mode === 'link' ? 'link' : 'native', confirmed: false,
            expectedAmount: input.region === 'US' ? plan?.amount ?? null : null,
            expectedCurrency: REGION_CONFIG[input.region]?.currency, expiresAt: null } };
    const timings = new Map();
    function publish() {
        report.elapsedMs = Math.max(0, now() - start);
        const clean = sanitizeDiagnosticReport(report);
        if (clean) emit(MARKER + JSON.stringify(clean));
    }
    return {
        report,
        check(id, label, status, message = '') {
            if (status === 'running') timings.set(id, now());
            const item = { id, label, status, message };
            if (status !== 'running' && timings.has(id)) item.durationMs = Math.max(0, now() - timings.get(id));
            const at = report.checks.findIndex(check => check.id === id);
            if (at < 0) report.checks.push(item); else report.checks[at] = item;
            report.phase = id; publish();
        },
        checkout(value) { report.checkout = { ...report.checkout, ...value }; publish(); },
        finish(success, message, code = '') {
            report.finishedAt = new Date(now()).toISOString(); report.success = success;
            report.message = message; report.code = code; report.phase = success ? 'complete' : 'failed'; publish();
        }
    };
}

module.exports = { getDiagnosticCatalog, resolveDiagnosticInput, buildDiagnosticRuntimeEnv, parseDiagnosticOutput,
    sanitizeDiagnosticReport, safeDiagnosticMessage, trustedCheckoutUrl, createDiagnosticReporter };
