const crypto = require('node:crypto');

const {
    deductPointsForService,
    getUserBalance
} = require('../../api/_lib/payments/rpc');
const {
    loadVerifyRuntimeConfig,
    selectVerifyCredentialForTask
} = require('./_verify-provider-runtime');

const DEFAULT_VERIFY_TASK_TYPE = 'extract';
const VERIFY_TASK_UNIT_COSTS = Object.freeze({
    extract: 0.5,
    full: 1
});
const ACTIVE_TRACKED_JOB_STATUSES = Object.freeze(['queued', 'running', 'processing', 'pending']);
const TERMINAL_TRACKED_JOB_STATUSES = Object.freeze(['success', 'failed']);
const jobSyncLocks = new Map();

function getApiErrorDetail(payload) {
    if (!payload || typeof payload !== 'object') return null;
    return payload.detail && typeof payload.detail === 'object' ? payload.detail : null;
}

function getApiErrorCode(payload) {
    const detail = getApiErrorDetail(payload);
    return detail?.code || payload?.code || payload?.error || '';
}

function getApiErrorMessage(payload, fallback) {
    const detail = getApiErrorDetail(payload);
    return detail?.message || payload?.message || payload?.error || fallback;
}

function normalizeVerifyApiBaseUrl(value) {
    const normalized = String(value || '').trim().replace(/\/+$/, '');
    if (!normalized) return '';
    return /\/openapi$/i.test(normalized) ? normalized : `${normalized}/openapi`;
}

function normalizeVerifyTaskType(value, fallback = DEFAULT_VERIFY_TASK_TYPE) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'full') return 'full';
    if (normalized === 'extract') return 'extract';
    return fallback;
}

function normalizeVerifyCredentialCandidates(values = []) {
    const list = Array.isArray(values) ? values : [values];
    const flattened = [];

    list.forEach((value) => {
        if (Array.isArray(value)) {
            value.forEach((entry) => flattened.push(entry));
            return;
        }
        flattened.push(value);
    });

    return [...new Set(
        flattened
            .map((value) => String(value || '').trim())
            .filter(Boolean)
    )];
}

function buildVerifyCredentialFingerprint(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function resolveVerifyApiKeyByFingerprint(config = {}, fingerprint = '') {
    const normalizedFingerprint = String(fingerprint || '').trim().toLowerCase();
    const apiKeys = Array.isArray(config.apiKeys) ? config.apiKeys : [config.apiKey];
    if (!normalizedFingerprint) return '';

    return apiKeys.find((apiKey) => buildVerifyCredentialFingerprint(apiKey) === normalizedFingerprint) || '';
}

function getVerifyPriceForTaskType(config = {}, taskType = DEFAULT_VERIFY_TASK_TYPE) {
    return normalizeVerifyTaskType(taskType) === 'full'
        ? Number(config.pricePerVerifyFull || config.pricePerVerifyExtract || config.pricePerVerify || 20)
        : Number(config.pricePerVerifyExtract || config.pricePerVerify || 10);
}

function normalizeVerifyUpstreamStatus(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return 'queued';
    if (['success', 'completed', 'done', 'ok'].includes(normalized)) return 'success';
    if (['failed', 'fail', 'error', 'timeout', 'cancelled', 'canceled'].includes(normalized)) return 'failed';
    if (['running', 'processing', 'working', 'in_progress'].includes(normalized)) return 'running';
    if (['queued', 'queueing', 'waiting', 'pending'].includes(normalized)) return 'queued';
    return normalized;
}

function normalizeOptionalNumber(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function extractVerifyProviderPayload(payload) {
    if (payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
        return payload.data;
    }

    return payload && typeof payload === 'object' ? payload : {};
}

function normalizeVerifyJobPayload(payload = {}, fallback = {}) {
    const source = extractVerifyProviderPayload(payload);
    const offerUrl = String(source.offer_url || source.url || fallback.offer_url || fallback.url || '').trim();
    const queuePositionValue = normalizeOptionalNumber(source.queue_position ?? fallback.queue_position);
    const waitSecondsValue = normalizeOptionalNumber(source.estimated_wait_seconds ?? fallback.estimated_wait_seconds);
    const elapsedSecondsValue = normalizeOptionalNumber(source.elapsed_seconds ?? fallback.elapsed_seconds);

    return {
        ...source,
        job_id: String(source.job_id || source.task_id || fallback.job_id || fallback.task_id || '').trim(),
        task_id: String(source.task_id || source.job_id || fallback.task_id || fallback.job_id || '').trim(),
        status: normalizeVerifyUpstreamStatus(source.status || source.raw_status || fallback.status),
        task_type: normalizeVerifyTaskType(source.task_type || fallback.task_type),
        provider_key_fingerprint: String(source.provider_key_fingerprint || fallback.provider_key_fingerprint || '').trim().toLowerCase(),
        provider_key_name: String(source.provider_key_name || fallback.provider_key_name || '').trim(),
        url: offerUrl,
        offer_url: offerUrl,
        has_offer_url: source.has_offer_url === true || fallback.has_offer_url === true || Boolean(offerUrl),
        error: String(source.error_code || source.error || fallback.error || '').trim(),
        message: String(source.message || fallback.message || '').trim(),
        stage_label: String(source.stage_label || fallback.stage_label || '').trim(),
        queue_position: queuePositionValue,
        estimated_wait_seconds: waitSecondsValue,
        elapsed_seconds: elapsedSecondsValue,
        created_at: String(source.completed_at || source.created_at || fallback.created_at || '').trim() || null
    };
}

function buildVerifyFetchOptions(timeoutMs = 0) {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' && Number(timeoutMs) > 0) {
        return {
            signal: AbortSignal.timeout(Number(timeoutMs))
        };
    }

    return {};
}

async function postVerifyProviderAction(config = {}, payload = {}, options = {}) {
    const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : global.fetch;
    const endpoint = normalizeVerifyApiBaseUrl(config.apiBaseUrl || config.api_base_url);
    const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        ...buildVerifyFetchOptions(options.timeoutMs)
    });
    const responsePayload = await response.json().catch(() => ({}));

    return {
        ok: response.ok && responsePayload?.success !== false,
        status: response.status,
        endpoint,
        payload: responsePayload
    };
}

function isLocalRequestOrigin(req) {
    const origin = String(req?.headers?.origin || req?.headers?.Origin || '').trim().toLowerCase();
    const host = String(req?.headers?.host || req?.headers?.Host || '').trim().toLowerCase();
    return origin.includes('localhost')
        || origin.includes('127.0.0.1')
        || host.includes('localhost')
        || host.includes('127.0.0.1');
}

function resolveVerifyRequestSite(req, explicitSite = '') {
    const normalizedExplicitSite = String(explicitSite || '').trim().toLowerCase();
    const origin = String(req?.headers?.origin || req?.headers?.Origin || '').trim().toLowerCase();
    const host = String(req?.headers?.host || req?.headers?.Host || '').trim().toLowerCase();
    const derivedSite = origin.includes('zaoyoe.xyz') || host.includes('zaoyoe.xyz') ? 'intl' : 'cn';

    if (isLocalRequestOrigin(req) && ['cn', 'intl'].includes(normalizedExplicitSite)) {
        return normalizedExplicitSite;
    }

    return derivedSite;
}

async function validateUserBalance({ supabase, userId, requiredPoints, site = 'cn' }) {
    if (!userId) {
        return { valid: false, error: '请先登录', status: 400 };
    }

    const { data: balanceData, error: balanceError } = await getUserBalance({
        supabase,
        userId,
        site
    });

    if (balanceError) {
        return { valid: false, error: '查询积分失败', status: 500 };
    }

    const currentBalance = Number(balanceData?.total_balance || 0) || 0;
    if (currentBalance < requiredPoints) {
        return {
            valid: false,
            error: `积分不足，需要 ${requiredPoints} 积分，当前余额 ${currentBalance}`,
            status: 400,
            balance: currentBalance
        };
    }

    return { valid: true, balance: currentBalance };
}

function buildClientStatusMessage(job) {
    const status = String(job?.status || '').toLowerCase();
    const taskType = normalizeVerifyTaskType(job?.task_type || job?.taskType);
    const offerUrl = String(job?.offer_url || job?.url || '').trim();

    if (status === 'queued') {
        const queuePosition = Number(job?.queue_position);
        const waitSeconds = Number(job?.estimated_wait_seconds);
        const queueLabel = Number.isFinite(queuePosition) && queuePosition >= 0
            ? `排队中（队列位置 ${queuePosition}）`
            : '排队中';
        return Number.isFinite(waitSeconds) && waitSeconds > 0
            ? `${queueLabel}，预计等待 ${waitSeconds} 秒`
            : queueLabel;
    }

    if (status === 'running') {
        return job?.stage_label ? `当前阶段：${job.stage_label}` : '任务执行中';
    }

    if (status === 'success') {
        if (taskType === 'full') {
            return String(job?.message || '').trim() || '绑卡流程完成';
        }
        return offerUrl ? '链接获取成功' : (String(job?.message || '').trim() || '提链任务完成');
    }

    if (status === 'failed') {
        return job?.error || '任务失败';
    }

    return job?.message || job?.status || '处理中';
}

function buildHistoryMessage(payload) {
    return JSON.stringify({
        kind: 'google_one_job',
        ...payload
    });
}

function parseHistoryMessage(message) {
    if (typeof message !== 'string' || !message.trim().startsWith('{')) {
        return null;
    }

    try {
        const parsed = JSON.parse(message);
        return parsed?.kind === 'google_one_job' ? parsed : null;
    } catch (_) {
        return null;
    }
}

function isTerminalTrackedStatus(status) {
    return TERMINAL_TRACKED_JOB_STATUSES.includes(String(status || '').toLowerCase());
}

function buildTrackedJobPayload({ email, jobId, apiData = {}, status = '', pointsDeducted = 0 }) {
    const queuePosition = Number(apiData?.queue_position);
    const estimatedWait = Number(apiData?.estimated_wait_seconds);
    const elapsedSeconds = Number(apiData?.elapsed_seconds);
    const offerUrl = String(apiData?.offer_url || apiData?.url || '').trim();

    return {
        email: email || '',
        job_id: jobId || '',
        provider_key_fingerprint: String(apiData?.provider_key_fingerprint || '').trim().toLowerCase(),
        provider_key_name: String(apiData?.provider_key_name || '').trim(),
        url: offerUrl,
        offer_url: offerUrl,
        has_offer_url: apiData?.has_offer_url === true || Boolean(offerUrl),
        task_type: normalizeVerifyTaskType(apiData?.task_type),
        error_code: apiData?.error || '',
        message: apiData?.message || '',
        error_message: buildClientStatusMessage(apiData),
        stage_label: apiData?.stage_label || '',
        raw_status: apiData?.status || status || '',
        queue_position: Number.isFinite(queuePosition) ? queuePosition : null,
        estimated_wait_seconds: Number.isFinite(estimatedWait) ? estimatedWait : null,
        elapsed_seconds: Number.isFinite(elapsedSeconds) ? elapsedSeconds : null,
        points_deducted: pointsDeducted,
        logged_at: new Date().toISOString()
    };
}

async function withJobSyncLock(lockKey, task) {
    const previous = jobSyncLocks.get(lockKey) || Promise.resolve();
    let releaseCurrent;
    const current = new Promise((resolve) => {
        releaseCurrent = resolve;
    });
    const tail = previous.finally(() => current);
    jobSyncLocks.set(lockKey, tail);

    await previous;

    try {
        return await task();
    } finally {
        releaseCurrent();
        if (jobSyncLocks.get(lockKey) === tail) {
            jobSyncLocks.delete(lockKey);
        }
    }
}

async function findTrackedJobLog({ supabase, userId, jobId, site = 'cn', scanLimit = 80 }) {
    if (!supabase?.from || !userId || !jobId) return null;

    try {
        const { data: exactData, error: exactError } = await supabase
            .from('verification_logs')
            .select('*')
            .eq('user_id', userId)
            .eq('site', site)
            .eq('verification_id', jobId)
            .order('created_at', { ascending: false })
            .limit(1);

        if (!exactError && exactData?.length) {
            return exactData[0];
        }

        const { data, error } = await supabase
            .from('verification_logs')
            .select('*')
            .eq('user_id', userId)
            .eq('site', site)
            .order('created_at', { ascending: false })
            .limit(scanLimit);

        if (error) {
            return null;
        }

        return (data || []).find((row) => parseHistoryMessage(row.message)?.job_id === jobId) || null;
    } catch (_) {
        return null;
    }
}

async function upsertTrackedJobLog({
    supabase,
    existingRecord = null,
    userId,
    site = 'cn',
    email,
    jobId,
    status,
    apiData = {},
    pointsDeducted = 0
}) {
    if (!supabase?.from || !userId || !jobId) return existingRecord;

    const normalizedStatus = String(status || apiData?.status || 'queued').toLowerCase();
    const payload = {
        verification_id: jobId,
        status: normalizedStatus,
        message: buildHistoryMessage(buildTrackedJobPayload({
            email,
            jobId,
            apiData,
            status: normalizedStatus,
            pointsDeducted
        })),
        points_deducted: pointsDeducted,
        batch_count: 1,
        batch_success: normalizedStatus === 'success' ? 1 : 0,
        batch_failed: normalizedStatus === 'failed' ? 1 : 0,
        site
    };

    try {
        if (existingRecord?.id) {
            const { data, error } = await supabase
                .from('verification_logs')
                .update(payload)
                .eq('id', existingRecord.id)
                .select('*')
                .limit(1);

            if (error) return existingRecord;
            return data?.[0] || existingRecord;
        }

        const { data, error } = await supabase
            .from('verification_logs')
            .insert({
                user_id: userId,
                ...payload
            })
            .select('*')
            .limit(1);

        if (error) return existingRecord;
        return data?.[0] || existingRecord;
    } catch (_) {
        return existingRecord;
    }
}

async function findExistingJobDeduction({ supabase, userId, jobId, site = 'cn' }) {
    if (!supabase?.from || !userId || !jobId) return 0;

    const runQuery = async (withSite) => {
        let query = supabase
            .from('points_ledger')
            .select('amount')
            .eq('user_id', userId)
            .eq('reference_id', jobId)
            .lt('amount', 0)
            .order('created_at', { ascending: false })
            .limit(1);

        if (withSite) {
            query = query.eq('site', site);
        }

        return query;
    };

    try {
        let { data, error } = await runQuery(true);
        if (error) {
            ({ data, error } = await runQuery(false));
        }

        if (error) return 0;
        const amount = Number(data?.[0]?.amount);
        return Number.isFinite(amount) ? Math.abs(amount) : 0;
    } catch (_) {
        return 0;
    }
}

async function deductPointsForJob({
    supabase,
    userId,
    jobId,
    amount,
    site = 'cn',
    taskType = DEFAULT_VERIFY_TASK_TYPE
}) {
    const existingDeduction = await findExistingJobDeduction({ supabase, userId, jobId, site });
    if (existingDeduction > 0) {
        return existingDeduction;
    }

    const normalizedTaskType = normalizeVerifyTaskType(taskType);
    const { data: deductData, error } = await deductPointsForService({
        supabase,
        userId,
        amount,
        reason: normalizedTaskType === 'full'
            ? 'Google One 全流程包绑卡服务'
            : 'Google One 试用链接提取服务',
        referenceId: jobId,
        site
    });

    if (error) {
        return 0;
    }

    return Number(deductData?.deducted) || amount;
}

async function syncTrackedJobStatus({
    supabase,
    userId,
    site = 'cn',
    email = '',
    jobId,
    apiData = {},
    config = null
}) {
    if (!supabase?.from || !userId || !jobId) {
        return { pointsDeducted: 0, record: null };
    }

    const lockKey = `${site}:${userId}:${jobId}`;
    return withJobSyncLock(lockKey, async () => {
        let existingRecord = await findTrackedJobLog({ supabase, userId, jobId, site });
        const existingPayload = parseHistoryMessage(existingRecord?.message) || {};
        const normalizedApiData = normalizeVerifyJobPayload(apiData, {
            job_id: jobId,
            task_type: existingPayload.task_type || DEFAULT_VERIFY_TASK_TYPE,
            provider_key_fingerprint: existingPayload.provider_key_fingerprint || '',
            provider_key_name: existingPayload.provider_key_name || ''
        });
        const upstreamStatus = String(normalizedApiData?.status || '').toLowerCase();
        const taskType = normalizeVerifyTaskType(normalizedApiData?.task_type || existingPayload.task_type);

        if (!upstreamStatus) {
            return {
                pointsDeducted: Number(existingRecord?.points_deducted) || 0,
                record: existingRecord
            };
        }

        if (!isTerminalTrackedStatus(upstreamStatus)) {
            existingRecord = await upsertTrackedJobLog({
                supabase,
                existingRecord,
                userId,
                site,
                email,
                jobId,
                status: upstreamStatus,
                apiData: normalizedApiData,
                pointsDeducted: Number(existingRecord?.points_deducted) || 0
            });

            return {
                pointsDeducted: Number(existingRecord?.points_deducted) || 0,
                record: existingRecord
            };
        }

        if (existingRecord && isTerminalTrackedStatus(existingRecord.status)) {
            const existingTerminalStatus = String(existingRecord.status || '').toLowerCase();
            if (existingTerminalStatus === 'success' || upstreamStatus !== 'success') {
                return {
                    pointsDeducted: Number(existingRecord.points_deducted) || 0,
                    record: existingRecord
                };
            }
        }

        const runtimeConfig = config || await loadVerifyRuntimeConfig(supabase);
        let pointsDeducted = Number(existingRecord?.points_deducted) || 0;
        if (upstreamStatus === 'success') {
            pointsDeducted = await deductPointsForJob({
                supabase,
                userId,
                jobId,
                amount: getVerifyPriceForTaskType(runtimeConfig, taskType),
                site,
                taskType
            });
        }

        existingRecord = await upsertTrackedJobLog({
            supabase,
            existingRecord,
            userId,
            site,
            email,
            jobId,
            status: upstreamStatus === 'success' ? 'success' : 'failed',
            apiData: normalizedApiData,
            pointsDeducted
        });

        return { pointsDeducted, record: existingRecord };
    });
}

async function fetchUpstreamJobStatus(config, jobId, options = {}) {
    const candidateApiKeys = normalizeVerifyCredentialCandidates([
        options.apiKey,
        config.apiKeys,
        config.apiKey
    ]);
    let lastError = null;
    let lastNotFound = null;

    for (const apiKey of candidateApiKeys) {
        const upstream = await postVerifyProviderAction(config, {
            action: 'get_status',
            cdkey: apiKey,
            task_id: jobId
        }, {
            ...options,
            apiKey
        });

        if (upstream.ok) {
            return {
                ok: true,
                data: normalizeVerifyJobPayload(upstream.payload, {
                    job_id: jobId,
                    task_type: DEFAULT_VERIFY_TASK_TYPE,
                    provider_key_fingerprint: buildVerifyCredentialFingerprint(apiKey),
                    provider_key_name: String(config?.provider_key_name || '').trim()
                })
            };
        }

        const errorCode = getApiErrorCode(upstream.payload);
        const errorMessage = getApiErrorMessage(upstream.payload, '查询状态失败');
        const currentError = {
            status: upstream.status || 502,
            code: errorCode,
            message: errorMessage
        };

        if (upstream.status === 404 || errorCode === 'job_not_found' || /任务不存在|not found/i.test(errorMessage)) {
            lastNotFound = currentError;
            continue;
        }

        lastError = currentError;
    }

    if (lastError) {
        return {
            ok: false,
            status: lastError.status,
            code: lastError.code,
            message: lastError.message
        };
    }

    const missingJobError = lastNotFound || {
        status: 404,
        code: 'job_not_found',
        message: '任务不存在'
    };

    return {
        ok: true,
        data: normalizeVerifyJobPayload({
            job_id: jobId,
            status: 'failed',
            error: missingJobError.code || 'job_not_found',
            message: missingJobError.message || '任务不存在'
        }, {
            task_type: DEFAULT_VERIFY_TASK_TYPE
        })
    };
}

module.exports = {
    ACTIVE_TRACKED_JOB_STATUSES,
    DEFAULT_VERIFY_TASK_TYPE,
    buildClientStatusMessage,
    buildVerifyCredentialFingerprint,
    fetchUpstreamJobStatus,
    findTrackedJobLog,
    getApiErrorCode,
    getApiErrorMessage,
    getVerifyPriceForTaskType,
    normalizeVerifyJobPayload,
    normalizeVerifyTaskType,
    parseHistoryMessage,
    postVerifyProviderAction,
    resolveVerifyRequestSite,
    resolveVerifyApiKeyByFingerprint,
    selectVerifyCredentialForTask,
    syncTrackedJobStatus,
    validateUserBalance
};
