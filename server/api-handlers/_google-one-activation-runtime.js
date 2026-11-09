// 86AI is an activation-only provider. Never route these jobs through link extraction
// or the legacy "charge when accepted" workflow. Credentials live in this request only.
const { createHash, randomUUID } = require('node:crypto');
const { loadVerifyRuntimeConfig } = require('./_verify-provider-runtime');
const { resolveVerifyRequestSite } = require('./_verify-job-runtime');

const BASE_URL = 'https://86ai.one';
const RPC = 'fn_google_one_activation';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL = new Set(['success', 'failed', 'cancelled']);
const MESSAGES = Object.freeze({
    prepared: '已预留积分，等待提交；可使用相同请求编号恢复。',
    submitting: '正在提交，请勿重复提交。',
    queued: '已接单，等待开通 Pro；尚未确认权益。',
    running: '正在开通 Pro；尚未确认权益。',
    verification_pending: '等待管理员核验开通结果；尚未确认 Pro 权益，不自动结算或退款。',
    outcome_unknown: '结果待核实，已转人工处理；不会自动重提或退款。',
    success: '管理员已核实 Pro 权益开通成功。',
    failed: '已明确未开通，预留积分已原路退回。',
    cancelled: '已确认取消，预留积分已原路退回。'
});
function fault(code, status = 400) {
    const error = new Error(code);
    error.code = code;
    error.statusCode = status;
    return error;
}
function fingerprint(value) { return createHash('sha256').update(value).digest('hex'); }
function jobUuid(value) {
    const id = String(value || '').replace(/^gpro_/, '');
    if (!UUID.test(id)) throw fault('invalid_request_id');
    return id.toLowerCase();
}
function isActivationRequest(body = {}) {
    return [body.provider, body.verifyProvider, body.verify_provider].some(v => String(v || '').toLowerCase() === '86ai')
        || [body.taskType, body.task_type].includes('pro_activation');
}
function isActivationJob(id) { return String(id || '').startsWith('gpro_'); }
function validateAccount(body = {}) {
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const recovery = String(body.recoveryEmail || body.recovery_email || '').trim().toLowerCase();
    const totp = String(body.totpSecret || body.totp_secret || '').replace(/\s/g, '');
    const clean = v => !/[|\r\n\x00-\x1f\x7f]/.test(v);
    const emailValid = v => /^[^\s@|]+@[^\s@|]+\.[^\s@|]+$/.test(v);
    if (!emailValid(email) || !password || ![email, password, recovery, totp].every(clean)
        || (recovery && !emailValid(recovery)) || ![8, 32].includes(totp.length)) throw fault('invalid_account');
    const account = (recovery ? [email, password, recovery, totp] : [email, password, totp]).join('|');
    if (account.length > 2000) throw fault('invalid_account');
    return { email, account };
}
function requestSite(req, explicitSite) {
    const querySite = typeof req?.query?.get === 'function' ? req.query.get('site') : req?.query?.site;
    const urlSite = new URL(req?.url || '/', 'http://localhost').searchParams.get('site');
    return resolveVerifyRequestSite(req, explicitSite || querySite || urlSite);
}
function configuredCards(config) {
    return [...new Set((config?.apiKeys || config?.card_codes || config?.cards || []).map(v => String(v || '').trim()).filter(v => v.length > 0 && v.length <= 64 && !/[\r\n\x00-\x1f\x7f]/.test(v)))];
}
function publicJob(job = {}, { admin = false } = {}) {
    const status = Object.hasOwn(MESSAGES, job.status) ? job.status : 'outcome_unknown';
    const result = {
        job_id: `gpro_${job.id}`, request_id: job.id, provider: '86ai', task_type: 'pro_activation',
        email: job.email, site: job.site, status, billing_state: job.billing_state,
        price: Number(job.price), pointsReserved: job.billing_state === 'reserved' ? Number(job.price) : 0,
        pointsDeducted: job.billing_state === 'charged' ? Number(job.price) : 0,
        pointsRefunded: job.billing_state === 'refunded' ? Number(job.price) : 0,
        message: MESSAGES[status], created_at: job.created_at, updated_at: job.updated_at,
        next_poll_at: job.next_poll_at, terminal: TERMINAL.has(status), version: job.version
    };
    if (admin) Object.assign(result, {
        upstream_task_id: job.upstream_task_id, review_reason: job.review_reason,
        provider_key_fingerprint: job.card_fingerprint, reviewed_by: job.reviewed_by,
        reviewed_at: job.reviewed_at, evidence_ref: job.evidence_ref
    });
    return result;
}
function errorResponse(error) {
    const codes = {
        invalid_request_id: [400, '请求编号无效。'], invalid_account: [400, '请检查邮箱、密码、辅助邮箱与 2FA（8 或 32 位），字段不能含分隔符或换行。'],
        invalid_task_type: [400, '第三通道仅支持 Pro 一条龙开通，不支持提链、批量或旧任务操作。'],
        activation_disabled: [503, 'Pro 开通通道暂未启用。'], activation_unconfigured: [503, 'Pro 开通通道尚未配置完成。'],
        activation_insufficient_points: [402, '积分不足，未提交开通。'], activation_duplicate_account: [409, '该账号已有开通任务，请先查询或联系管理员。'],
        activation_request_conflict: [409, '请求编号已使用，请恢复原任务。'], activation_conflict: [409, '任务已更新，请刷新后重试。'],
        activation_wallet_sources_unavailable: [409, '积分来源待核对，未扣款、未提交；请联系管理员。'],
        activation_not_found: [404, '任务不存在或无权访问。'], activation_rate_limited: [429, '提交过于频繁，请稍后用原请求编号重试。'],
        invalid_resolution: [400, '核验操作需要有效的证据引用、版本号及明确的权益/上游关闭确认。']
    };
    const [status, message] = codes[error?.code] || [503, '开通服务暂不可用。请恢复原任务查询状态，不要重新提交。'];
    return { status, body: { success: false, code: codes[error?.code] ? error.code : 'activation_unavailable', message } };
}
function createActivationService({ supabase, env = process.env, fetchImpl = global.fetch, loadConfig = loadVerifyRuntimeConfig } = {}) {
    async function rpc(action, { id = null, userId = null, site, data = {} } = {}) {
        let response;
        try { response = await supabase.rpc(RPC, { p_action: action, p_job_id: id, p_user_id: userId, p_site: site, p_data: data }); }
        catch { throw fault('activation_unavailable', 503); }
        if (response.error) {
            const message = String(response.error.message || '');
            // Allowlist only our fixed database error codes, never return raw database/upstream errors.
            const code = ['activation_insufficient_points', 'activation_wallet_sources_unavailable', 'activation_duplicate_account', 'activation_request_conflict', 'activation_conflict'].find(c => message.includes(c));
            throw fault(code || 'activation_unavailable', 503);
        }
        if (!response.data?.ok) throw fault(response.data?.code || 'activation_unavailable');
        return response.data;
    }
    async function configFor(site) {
        const runtime = await loadConfig(supabase, env, { site });
        return { runtime, config: runtime.providers?.['86ai'] || {} };
    }
    async function request(method, path, card, body) {
        try {
            const response = await fetchImpl(`${BASE_URL}/api/v1/tasks${path}`, {
                method, redirect: 'error', signal: AbortSignal.timeout(20000),
                headers: { 'X-Card-Code': card, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
                ...(body ? { body: JSON.stringify(body) } : {})
            });
            let payload;
            try { payload = await response.json(); } catch { payload = null; }
            const rawRetry = response.headers?.get?.('retry-after');
            const delta = /^\d+$/.test(rawRetry || '') ? Number(rawRetry) : (Date.parse(rawRetry || '') - Date.now()) / 1000;
            return { status: response.status, payload, retry: Number.isFinite(delta) ? Math.min(86400, Math.max(10, Math.ceil(delta))) : 30 };
        } catch { return { status: 0, payload: null, retry: 30 }; }
    }
    async function submit({ req, user, body }) {
        const types = [body.taskType, body.task_type].filter(v => v !== undefined);
        const providers = [body.provider, body.verifyProvider, body.verify_provider].filter(v => v !== undefined);
        if (!types.length || types.some(v => v !== 'pro_activation') || providers.some(v => v !== '86ai')
            || body.accounts !== undefined || body.batch !== undefined || body.mode === 'link' || body.linkOnly === true) throw fault('invalid_task_type');
        const id = jobUuid(body.requestId || body.request_id);
        const site = requestSite(req, body.site);
        const args = { id, site, userId: user.id };
        // Recovery comes BEFORE enabled/key checks: disabling new submissions must not strand old jobs.
        const existing = await rpc('lookup', args);
        if (existing.job && existing.job.status !== 'prepared') return publicJob(existing.job);
        const { email, account } = validateAccount(body);
        if (existing.job && existing.job.email !== email) throw fault('activation_request_conflict');
        const { runtime, config } = await configFor(site);
        if (runtime.enabled === false || config.enabled !== true) throw fault('activation_disabled');
        const cards = configuredCards(config);
        const price = Number(config.pricePerProActivation);
        if (!cards.length || !Number.isFinite(price) || price <= 0 || price > 1000000 || Math.abs(price * 100 - Math.round(price * 100)) > 1e-7) throw fault('activation_unconfigured');
        // A deterministic first card is reserved once. No balance probing and no automatic card rotation.
        const card = existing.job ? cards.find(c => fingerprint(c) === existing.job.card_fingerprint) : cards[0];
        if (!card) {
            return publicJob((await rpc('card_missing', args)).job);
        }
        const prepared = await rpc('prepare', { ...args, data: { email, account_hash: fingerprint(email), card_fingerprint: fingerprint(card), price } });
        // Another process may have won prepare using a different card/config snapshot.
        if (prepared.job.email !== email) throw fault('activation_request_conflict');
        const originalCard = cards.find(c => fingerprint(c) === prepared.job.card_fingerprint);
        if (!originalCard) return publicJob((await rpc('card_missing', args)).job);
        const dispatchToken = randomUUID();
        const claim = await rpc('claim_dispatch', { ...args, data: { token: dispatchToken } });
        if (!claim.claimed) return publicJob(claim.job || prepared.job);
        const upstream = await request('POST', '', originalCard, { accounts: [account] });
        const payload = upstream.payload;
        const ids = payload?.data?.task_ids;
        const accepted = upstream.status === 201 && payload?.success === true && payload.code === 'OK'
            && payload.data?.num === 1 && Array.isArray(ids) && ids.length === 1 && Number.isSafeInteger(ids[0]) && ids[0] > 0;
        const rejections = { 400: ['INVALID_REQUEST'], 422: ['INVALID_REQUEST'], 401: ['CARD_INVALID'],
            403: ['CARD_UNAVAILABLE', 'RECHARGE_CLOSED'], 409: ['QUOTA_INSUFFICIENT'], 413: ['PAYLOAD_TOO_LARGE'] };
        const rejected = payload?.success === false && rejections[upstream.status]?.includes(payload.code);
        const result = await rpc(accepted ? 'submitted' : rejected ? 'rejected' : 'submission_unknown', {
            ...args, data: { token: dispatchToken, ...(accepted ? { upstream_task_id: ids[0] } : {}), retry_seconds: upstream.retry }
        });
        return publicJob(result.job);
    }
    async function status({ req, user, id: externalId, admin = false }) {
        const args = { id: jobUuid(externalId), site: requestSite(req), userId: user.id };
        const current = await rpc(admin ? 'admin_read' : 'read', args);
        if (!current?.job) throw fault('activation_not_found', 404);
        if (admin) args.userId = current.job.user_id;
        if (TERMINAL.has(current.job.status) || !current.job.upstream_task_id || current.job.status === 'verification_pending') return publicJob(current.job, { admin });
        const { config } = await configFor(args.site); // intentionally ignore enabled, preserve historical access
        const card = configuredCards(config).find(c => fingerprint(c) === current.job.card_fingerprint);
        if (!card) return publicJob((await rpc('card_missing', args)).job, { admin });
        const token = randomUUID();
        const claim = await rpc('claim_poll', { ...args, data: { token } });
        if (!claim.claimed) return publicJob(claim.job, { admin });
        const upstream = await request('GET', `/${claim.job.upstream_task_id}`, card);
        const payload = upstream.payload;
        const valid = upstream.status === 200 && payload?.success === true && payload.code === 'OK'
            && Number.isSafeInteger(payload.data?.id) && payload.data.id === Number(claim.job.upstream_task_id) && [1, 2, 3, 4, 5].includes(payload.data?.status);
        const result = await rpc('observe', { ...args, data: { token, upstream_status: valid ? payload.data.status : null,
            retry_seconds: upstream.retry, review_reason: upstream.status === 404 ? 'task_not_found' : upstream.status === 429 ? 'upstream_rate_limited' : 'query_unconfirmed' } });
        return publicJob(result.job, { admin });
    }
    async function list({ req, user, admin = false }) {
        const result = await rpc(admin ? 'admin_list' : 'list', { site: requestSite(req), userId: user.id });
        return (result.jobs || []).map(job => publicJob(job, { admin }));
    }
    async function resolve({ req, user, body }) {
        const version = Number(body.version);
        const evidence = String(body.evidence_ref || '').trim();
        if (!Number.isSafeInteger(version) || version < 1 || !/^(https:\/\/|ticket:|case:|ref:)\S{3,230}$/.test(evidence)
            || /[|\r\n]/.test(evidence)) throw fault('invalid_resolution');
        if (!['confirm_success', 'confirm_failed', 'bind'].includes(body.action)
            || (body.action === 'confirm_success' && body.pro_confirmed !== true)
            || (body.action === 'confirm_failed' && (body.pro_not_active !== true || body.upstream_closed !== true))
            || (body.action === 'bind' && (!Number.isSafeInteger(body.upstream_task_id) || body.upstream_task_id < 1))) throw fault('invalid_resolution');
        const result = await rpc(body.action === 'bind' ? 'admin_bind' : 'admin_resolve', {
            id: jobUuid(body.job_id), site: requestSite(req, body.site), userId: user.id,
            data: { version, evidence_ref: evidence, action: body.action, pro_confirmed: body.pro_confirmed === true,
                pro_not_active: body.pro_not_active === true, upstream_closed: body.upstream_closed === true, upstream_task_id: body.upstream_task_id }
        });
        return publicJob(result.job, { admin: true });
    }
    return { submit, status, list, resolve };
}
module.exports = { BASE_URL, RPC, createActivationService, errorResponse, fingerprint, isActivationJob, isActivationRequest, publicJob, requestSite, validateAccount };
