'use strict';

const { redactSensitiveText } = require('./session-security');
const { isChatGptAuthFailure } = require('./chatgpt-auth-state');

const MAX_BODY_BYTES = 32768;
const MAX_DETAIL_CHARS = 700;
const ERROR_FIELDS = ['code', 'type', 'message', 'msg', 'detail', 'error', 'errors'];

function safeDiagnosticText(value) {
    // Redact before shortening: truncation must not expose a partial credential.
    return redactSensitiveText(value)
        .replace(/https?:\/\/[^\s<>"']+/gi, '[URL_REDACTED]')
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL_REDACTED]')
        .replace(/(["']?(?:password|client[_-]?secret|secret|(?:access|refresh|id|session)[_-]?token|token|session|cvv|cvc)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, '$1[REDACTED]')
        .replace(/\b(?:sk-|cs_|pi_|pm_|cus_|acct_|seti_|sess_)[A-Za-z0-9_-]+\b/g, '[ID_REDACTED]')
        .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[OPAQUE_REDACTED]')
        // Upstream text is data, never a worker success/payment/media protocol marker.
        .replace(/PAYMENT_(?:SUCCESS|STATE)|CHECKOUT_(?:DIAGNOSTIC|DEBUG_SUCCESS|URL)|(?:SUCCESS|FAILURE)_SCREENSHOT|VIDEO_FILE|支付结果未知|支付成功/g, '[LOG_MARKER_REDACTED]')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function summarizeCheckoutErrorBody(bodyText, contentType = '') {
    const text = String(bodyText || '');
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return '错误响应过大，未记录响应内容';
    if (!text.trim()) return '上游未返回错误详情';
    if (/text\/html/i.test(contentType) || /^\s*<(?:!doctype|html|head|body)/i.test(text)) {
        return /cloudflare|cf-ray|just a moment/i.test(text)
            ? '上游返回 Cloudflare HTML 页面，未提供结构化错误详情'
            : '上游返回 HTML 错误页，未提供结构化错误详情';
    }
    let data;
    try { data = JSON.parse(text); } catch (_) {
        // Do not copy malformed JSON, HTML fragments, or arbitrarily long raw bodies.
        if (/application\/json/i.test(contentType) || /^[\s]*[\[{<]/.test(text) || text.length > 2048) {
            return '上游错误响应无法解析，未记录响应内容';
        }
        return Array.from(safeDiagnosticText(text)).slice(0, MAX_DETAIL_CHARS).join('') || '上游未返回错误详情';
    }
    const parts = [];
    const collect = (value, depth = 0) => {
        if (depth > 5 || parts.length >= 8) return;
        if (typeof value === 'string' || typeof value === 'number') {
            const safe = safeDiagnosticText(value);
            if (safe && !parts.includes(safe)) parts.push(safe);
        } else if (Array.isArray(value)) {
            value.slice(0, 5).forEach(item => collect(item, depth + 1));
        } else if (value && typeof value === 'object') {
            // Validation payloads can echo tokens/card input. Only error explanation fields are read.
            for (const key of ERROR_FIELDS) {
                if (Object.hasOwn(value, key)) collect(value[key], depth + 1);
            }
        }
    };
    collect(data);
    return Array.from(parts.join('; ')).slice(0, MAX_DETAIL_CHARS).join('') || '上游响应未包含可记录的错误说明';
}

function summarizeCheckoutRequest(request) {
    try {
        let payload;
        if (typeof request.postData === 'function') {
            const raw = request.postData();
            if (!raw || Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return '';
            payload = JSON.parse(raw);
        } else if (typeof request.postDataJSON === 'function') {
            payload = request.postDataJSON();
        }
        if (!payload || typeof payload !== 'object') return '';
        const fields = [];
        const plan = payload.plan_name;
        if (typeof plan === 'string' && /^chatgpt(?:goplan|plusplan|prolite|pro|promax|teamplan|businessplan|freeplan)$/.test(plan)) fields.push(`plan=${plan}`);
        const billing = payload.billing_details;
        if (billing && typeof billing === 'object') {
            if (typeof billing.country === 'string' && /^[A-Z]{2}$/.test(billing.country)) fields.push(`country=${billing.country}`);
            if (typeof billing.currency === 'string' && /^[A-Z]{3}$/.test(billing.currency)) fields.push(`currency=${billing.currency}`);
        }
        if (['custom', 'hosted', 'embedded'].includes(payload.checkout_ui_mode)) fields.push(`ui=${payload.checkout_ui_mode}`);
        return fields.join(', ');
    } catch (_) { return ''; }
}

async function readCheckoutErrorDetail(response, { timeout = 1200 } = {}) {
    let headers = {};
    try { headers = response.headers?.() || {}; } catch (_) { /* detail read remains optional */ }
    const declaredSize = Number(headers['content-length']);
    if (Number.isFinite(declaredSize) && declaredSize > MAX_BODY_BYTES) return '错误响应过大，未记录响应内容';
    if (typeof response.text !== 'function') return '错误响应详情不可读取';
    let timer;
    try {
        return await Promise.race([
            Promise.resolve().then(() => response.text())
                .then(text => summarizeCheckoutErrorBody(text, headers['content-type']))
                .catch(() => '错误响应详情读取失败'),
            new Promise(resolve => { timer = setTimeout(() => resolve('错误响应详情读取超时'), timeout); })
        ]);
    } finally { clearTimeout(timer); }
}

function isCheckoutUnusualActivityError(error) {
    return error?.code === 'CHECKOUT_UNUSUAL_ACTIVITY'
        || /\bunusual[\s_-]+activity\b/i.test(String(error?.message ?? error ?? ''));
}

function buildCheckoutHttpFailure(status, detail = '', requestSummary = '') {
    const authFailure = isChatGptAuthFailure(detail, status);
    const unusualActivity = isCheckoutUnusualActivityError(detail);
    const explanation = detail ? `：${detail}` : '';
    const request = requestSummary ? `（请求 ${requestSummary}）` : '';
    const hint = unusualActivity ? '。上游检测到异常活动，未进入银行卡支付；请稍后再试' : '';
    return {
        code: authFailure ? 'CHECKOUT_AUTH_ERROR' : (unusualActivity ? 'CHECKOUT_UNUSUAL_ACTIVITY' : 'CHECKOUT_HTTP_ERROR'),
        message: `Checkout 创建接口返回 HTTP ${status}${explanation}${request}${hint}`
    };
}

module.exports = {
    summarizeCheckoutErrorBody, summarizeCheckoutRequest, readCheckoutErrorDetail,
    isCheckoutUnusualActivityError, buildCheckoutHttpFailure
};
