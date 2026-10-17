'use strict';

// Exact allowlisted messages, including documented errors and compatibility variants.
// Official contract: https://gramix.io/resellers/api/documentation.
// Never echo arbitrary provider messages, request data, keys, or URLs.
const REJECTIONS = Object.freeze({
    bad_request: { status: 400, provider: 'Bad Request', label: '上游请求参数无效', action: '核对接收账号、产品权益与请求参数。' },
    idempotency_key_required: { status: 400, provider: 'Idempotency-Key header is required', label: '上游请求缺少提交标识', action: '保留原任务，由维护人员核对上游提交标识的传递。' },
    idempotency_key_length: { status: 400, provider: 'Idempotency-Key must be between 8 and 64 characters', label: '原任务提交标识长度无效', action: '保留原任务，由维护人员核对提交标识长度。' },
    idempotency_key_characters: { status: 400, provider: 'Idempotency-Key contains invalid characters', label: '原任务提交标识包含无效字符', action: '保留原任务，由维护人员核对提交标识格式。' },
    premium_duration_unsupported: { status: 400, provider: 'Duration must be one of: 3, 6, 12', label: '会员时长不受上游支持', action: '核对商品的会员时长配置，保留原任务并交由维护人员处理。' },
    unauthorized: { status: 401, provider: 'Unauthorized', label: '上游 API 身份验证失败', action: '核对当前运行环境的 Gramix API Key 是否有效。' },
    forbidden: { status: 403, provider: 'Forbidden', label: '上游拒绝访问', action: '核对上游账号权限和 API 访问配置。' },
    insufficient_balance: { status: 403, provider: 'Insufficient balance', label: '上游余额不足', action: '核对当前 API Key 对应的 Gramix 账户及订单扣款币种，并补足对应余额；原任务仍需核对后恢复。' },
    invalid_recipient: { status: 403, provider: 'Invalid recipient', label: 'Telegram 接收账号无效', action: '核对接收用户名是否正确、有效且可接收所购产品。' },
    invalid_idempotency_key: { status: 403, provider: 'Invalid idempotency key', label: '原任务提交标识无效', action: '核对原任务的提交标识与上游要求，保留原任务并交由维护人员处理。' },
    idempotency_key_reused: { status: 403, provider: 'Idempotency key has already been used', label: '原任务提交标识已被使用', action: '查询原任务对应的上游订单和扣款记录，确认原请求结果。' },
    not_found: { status: 404, provider: 'Not Found', label: '上游资源不存在', action: '核对上游订单号、接口地址和所属账户。' },
    method_not_allowed: { status: 405, provider: 'Method Not Allowed', label: '上游接口不支持当前请求方法', action: '核对当前运行环境的上游接口地址和请求方法。' },
    rate_limited: { status: 429, provider: 'Too many requests', label: '上游请求频率受限', action: '稍后重新查询原任务状态。' },
    internal_error: { status: 500, provider: 'Internal server error', variants: ['Internal error'], label: '上游服务内部错误', action: '稍后重新查询原任务状态，必要时联系上游核对受理结果。' }
});
const SAFE_CODES = new Set(['gramix_http_error', 'gramix_timeout', 'gramix_network_error', 'gramix_invalid_response', 'gramix_configuration_error']);
const FALLBACKS = {
    gramix_http_error: ['上游返回 HTTP 错误，具体原因未识别', '核对上游账户、订单及扣款记录；HTTP 状态本身不能证明原请求未扣款。'],
    gramix_timeout: ['上游请求超时', '查询原任务的上游订单和扣款记录，确认原请求是否受理。'],
    gramix_network_error: ['连接上游失败', '核对网络连通性，并查询原任务的上游订单和扣款记录。'],
    gramix_invalid_response: ['上游返回的数据格式不符合约定', '核对上游接口兼容性和原任务受理结果。'],
    gramix_configuration_error: ['当前运行环境的上游配置无效或缺失', '核对当前运行环境的 Gramix API 配置。'],
    tg_provider_request_failed: ['上游请求未完成，具体原因未识别', '核对上游订单和扣款记录，确认原任务结果。']
};

function httpStatus(value) {
    return Number.isInteger(value) && value >= 400 && value <= 599 ? value : null;
}

function providerReason(status, payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || payload.statusCode !== status || typeof payload.message !== 'string' || payload.message.length > 128) return null;
    return Object.entries(REJECTIONS).find(([, spec]) => spec.status === status && (spec.provider === payload.message.trim() || spec.variants?.includes(payload.message.trim())))?.[0] || null;
}

function describeGramixError(error) {
    const code = SAFE_CODES.has(error?.code) ? error.code : 'tg_provider_request_failed';
    const status = code === 'gramix_http_error' ? httpStatus(error?.statusCode) : null;
    const spec = code === 'gramix_http_error' && Object.hasOwn(REJECTIONS, error?.providerReason)
        && REJECTIONS[error.providerReason].status === status ? REJECTIONS[error.providerReason] : null;
    return {
        error_code: spec ? `gramix_${error.providerReason}` : code,
        reason: spec ? error.providerReason : null,
        http_status: status,
        message: `${status ? `[HTTP ${status}] ` : ''}${spec ? `${spec.label}（${spec.provider}）` : FALLBACKS[code][0]}`,
        action: spec ? spec.action : FALLBACKS[code][1]
    };
}

function recordedErrorDiagnostic(order) {
    if (!order?.last_error_code) return null;
    const code = order.last_error_code;
    const reason = Object.keys(REJECTIONS).find((key) => code === `gramix_${key}`);
    if (!reason && !SAFE_CODES.has(code)) return null;
    const status = /^\[HTTP ([45]\d{2})\] /.exec(String(order.last_error_message || '').slice(0, 32));
    const error = describeGramixError({ code: reason ? 'gramix_http_error' : code,
        providerReason: reason, statusCode: status ? Number(status[1]) : undefined });
    const missing = code === 'gramix_http_error' && !error.http_status;
    return { ...error, historical_details_missing: missing,
        ...(missing ? { message: '历史记录仅保留通用错误码，具体 HTTP 状态和上游原因未留存。' } : {}) };
}

module.exports = { providerReason, describeGramixError, recordedErrorDiagnostic };
