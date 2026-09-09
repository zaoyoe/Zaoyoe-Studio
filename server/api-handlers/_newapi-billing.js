const NEWAPI_GATEWAY_HOSTNAMES = Object.freeze(new Set([
    'new.fatherkey.com',
    'sub2api.fatherkey.com',
    'sub2api.zaoyoe.com',
    'sub2api.zaoyoe.xyz'
]));

const QUOTA_PER_UNIT_CACHE_TTL_MS = 5 * 60 * 1000;
const quotaPerUnitCache = new Map();

function normalizeText(value, maxLength = 4000) {
    const normalized = String(value ?? '').trim();
    return normalized ? normalized.slice(0, maxLength) : '';
}

function normalizeNonNegativeNumber(value, fallback = null) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function isNewApiGatewayBaseUrl(value = '') {
    try {
        return NEWAPI_GATEWAY_HOSTNAMES.has(new URL(String(value || '')).hostname.toLowerCase());
    } catch (_) {
        return false;
    }
}

function buildNewApiEndpointUrl(baseUrl = '', pathname = '') {
    try {
        const url = new URL(String(baseUrl || ''));
        url.pathname = `/${String(pathname || '').replace(/^\/+/, '')}`;
        url.search = '';
        url.hash = '';
        return url.toString();
    } catch (_) {
        return '';
    }
}

function getResponseHeader(response = null, name = '') {
    const normalizedName = String(name || '').toLowerCase();
    const headers = response?.headers;
    if (!headers || !normalizedName) return '';
    if (typeof headers.get === 'function') {
        return normalizeText(headers.get(name) || headers.get(normalizedName), 1000);
    }
    if (typeof headers === 'object') {
        return normalizeText(headers[name] || headers[normalizedName], 1000);
    }
    return '';
}

function getNewApiRequestRecords(payload = {}) {
    const payloadNewApi = payload?.newapi && typeof payload.newapi === 'object' ? payload.newapi : {};
    const payloadTokenNewApi = payload?.token_usage?.newapi && typeof payload.token_usage.newapi === 'object'
        ? payload.token_usage.newapi
        : {};
    return [
        ...(Array.isArray(payloadNewApi.records) ? payloadNewApi.records : []),
        ...(Array.isArray(payloadNewApi.request_records) ? payloadNewApi.request_records : []),
        ...(Array.isArray(payloadTokenNewApi.records) ? payloadTokenNewApi.records : [])
    ].slice(0, 20);
}

function getNewApiRecordRequestId(record = {}) {
    return normalizeText(
        record?.request_id
        || record?.requestId
        || record?.oneapi_request_id
        || record?.oneapiRequestId,
        240
    );
}

function getNewApiRequestIds(response = null, payload = {}) {
    const recordRequestIds = getNewApiRequestRecords(payload).map(getNewApiRecordRequestId);
    const candidates = [
        getResponseHeader(response, 'x-oneapi-request-id'),
        getResponseHeader(response, 'x-request-id'),
        getResponseHeader(response, 'request-id'),
        payload?.request_id,
        payload?.requestId,
        payload?.oneapi_request_id,
        payload?.oneapiRequestId,
        payload?.response?.request_id,
        payload?.response?.requestId,
        payload?.newapi?.request_id,
        payload?.newapi?.requestId,
        payload?.sub2api?.request_id,
        payload?.sub2api?.requestId,
        ...recordRequestIds
    ];
    return [...new Set(candidates.map((value) => normalizeText(value, 240)).filter(Boolean))].slice(0, 20);
}

function readPositiveIntEnv(env = {}, names = [], fallback = 0, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    for (const name of names) {
        const parsed = Number.parseInt(String(env?.[name] ?? '').trim(), 10);
        if (Number.isFinite(parsed)) return Math.min(max, Math.max(min, parsed));
    }
    return Math.min(max, Math.max(min, fallback));
}

function sleep(ms = 0) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = 0) {
    if (typeof fetchImpl !== 'function') throw new Error('fetch_unavailable');
    const normalizedTimeoutMs = Math.max(0, Number(timeoutMs) || 0);
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const externalSignal = options.signal;
    let timer = null;
    let timedOut = false;
    const abortFromExternal = () => controller?.abort();
    if (controller && externalSignal) {
        if (externalSignal.aborted) controller.abort();
        else externalSignal.addEventListener?.('abort', abortFromExternal, { once: true });
    }
    if (controller && normalizedTimeoutMs > 0) {
        timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, normalizedTimeoutMs);
    }
    try {
        return await fetchImpl(url, {
            ...options,
            ...(controller ? { signal: controller.signal } : {})
        });
    } catch (error) {
        if (timedOut) {
            const timeoutError = new Error('NewAPI 扣费明细查询超时');
            timeoutError.code = 'newapi_billing_lookup_timeout';
            throw timeoutError;
        }
        throw error;
    } finally {
        if (timer) clearTimeout(timer);
        externalSignal?.removeEventListener?.('abort', abortFromExternal);
    }
}

async function readJsonPayload(response = null) {
    if (!response) return {};
    if (typeof response.json === 'function') {
        try {
            const payload = await response.json();
            return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
        } catch (_) {
        }
    }
    if (typeof response.text !== 'function') return {};
    try {
        const text = await response.text();
        const payload = JSON.parse(text || '{}');
        return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    } catch (_) {
        return {};
    }
}

function getQuotaPerUnitFromPayload(payload = {}) {
    return normalizeNonNegativeNumber(
        payload?.data?.quota_per_unit
        ?? payload?.data?.quotaPerUnit
        ?? payload?.quota_per_unit
        ?? payload?.quotaPerUnit,
        null
    );
}

async function loadNewApiQuotaPerUnit({ baseUrl = '', fetchImpl = globalThis.fetch, env = process.env, signal = null } = {}) {
    const statusUrl = buildNewApiEndpointUrl(baseUrl, '/api/status');
    if (!statusUrl || typeof fetchImpl !== 'function') return null;
    let cacheKey = '';
    try {
        cacheKey = new URL(statusUrl).origin;
    } catch (_) {
    }
    const cached = cacheKey ? quotaPerUnitCache.get(cacheKey) : null;
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const timeoutMs = readPositiveIntEnv(env, ['AI_IMAGE_NEWAPI_BILLING_LOOKUP_TIMEOUT_MS'], 1000, {
        min: 50,
        max: 30000
    });
    try {
        const response = await fetchWithTimeout(fetchImpl, statusUrl, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            ...(signal ? { signal } : {})
        }, timeoutMs);
        if (!response?.ok) return null;
        const quotaPerUnit = getQuotaPerUnitFromPayload(await readJsonPayload(response));
        if (!quotaPerUnit || quotaPerUnit <= 0) return null;
        if (cacheKey) quotaPerUnitCache.set(cacheKey, {
            value: quotaPerUnit,
            expiresAt: Date.now() + QUOTA_PER_UNIT_CACHE_TTL_MS
        });
        return quotaPerUnit;
    } catch (_) {
        return null;
    }
}

function getNewApiLogItems(payload = {}) {
    const data = payload?.data;
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(payload?.items)) return payload.items;
    return [];
}

function normalizeNewApiTokenLogRecord(record = {}, requestIds = [], quotaPerUnit = 0) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    const requestId = normalizeText(
        record.request_id
        || record.requestId
        || record.oneapi_request_id
        || record.oneapiRequestId,
        240
    );
    if (!requestId || !requestIds.includes(requestId)) return null;
    if (record.type !== undefined && record.type !== null && record.type !== '' && Number(record.type) !== 2) return null;
    const quota = normalizeNonNegativeNumber(record.quota ?? record.quota_used ?? record.quotaUsed, null);
    if (quota === null || !quotaPerUnit || quotaPerUnit <= 0) return null;
    return {
        gateway: 'newapi',
        request_id: requestId,
        actual_cost: Math.round((quota / quotaPerUnit) * 1000000) / 1000000,
        quota,
        quota_per_unit: quotaPerUnit,
        actual_cost_source: 'newapi_token_log',
        cost_field: 'quota'
    };
}

function aggregateNewApiTokenLogRecords(records = []) {
    if (!Array.isArray(records) || !records.length) return null;
    if (records.length === 1) return records[0];
    const quotaPerUnit = normalizeNonNegativeNumber(records[0]?.quota_per_unit, null);
    if (!quotaPerUnit || quotaPerUnit <= 0) return null;
    const quota = records.reduce((total, record) => total + normalizeNonNegativeNumber(record?.quota, 0), 0);
    const actualCost = Math.round(records.reduce((total, record) => total + normalizeNonNegativeNumber(record?.actual_cost, 0), 0) * 1000000) / 1000000;
    return {
        gateway: 'newapi',
        request_id: records[0].request_id,
        request_ids: records.map((record) => record.request_id),
        requestIds: records.map((record) => record.request_id),
        actual_cost: actualCost,
        quota,
        quota_per_unit: quotaPerUnit,
        actual_cost_source: 'newapi_token_log',
        cost_field: 'quota',
        records
    };
}

async function fetchNewApiTokenUsageRecord({
    baseUrl = '',
    apiKey = '',
    response = null,
    payload = {},
    fetchImpl = globalThis.fetch,
    env = process.env,
    signal = null,
    returnLookupResult = false
} = {}) {
    const finish = (record = null, status = 'not_found', extra = {}) => (
        returnLookupResult ? { record, status, ...extra } : record
    );
    if (!apiKey || !isNewApiGatewayBaseUrl(baseUrl) || typeof fetchImpl !== 'function') {
        return finish(null, 'unavailable');
    }
    const requestIds = getNewApiRequestIds(response, payload);
    if (getNewApiRequestRecords(payload).some((record) => !getNewApiRecordRequestId(record))) {
        return finish(null, 'no_request_id', { requestIds });
    }
    if (!requestIds.length) return finish(null, 'no_request_id', { requestIds });

    const attempts = readPositiveIntEnv(env, ['AI_IMAGE_NEWAPI_BILLING_LOOKUP_ATTEMPTS'], 5, {
        min: 1,
        max: 20
    });
    const intervalMs = readPositiveIntEnv(env, ['AI_IMAGE_NEWAPI_BILLING_LOOKUP_INTERVAL_MS'], 300, {
        min: 0,
        max: 3000
    });
    const timeoutMs = readPositiveIntEnv(env, ['AI_IMAGE_NEWAPI_BILLING_LOOKUP_TIMEOUT_MS'], 1000, {
        min: 50,
        max: 30000
    });
    const logsUrl = buildNewApiEndpointUrl(baseUrl, '/api/log/token');
    let sawUnavailable = false;
    let sawTimeout = false;
    if (!logsUrl) return finish(null, 'unavailable', { requestIds });

    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            const responseForLogs = await fetchWithTimeout(fetchImpl, logsUrl, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    Accept: 'application/json'
                },
                ...(signal ? { signal } : {})
            }, timeoutMs);
            if (!responseForLogs?.ok) {
                sawUnavailable = true;
            } else {
                const logPayload = await readJsonPayload(responseForLogs);
                if (logPayload.success === false) {
                    sawUnavailable = true;
                } else {
                    const items = getNewApiLogItems(logPayload);
                    const matchedRecords = requestIds.map((requestId) => items.find((item) => normalizeText(
                        item?.request_id || item?.requestId || item?.oneapi_request_id || item?.oneapiRequestId,
                        240
                    ) === requestId)).filter(Boolean);
                    if (matchedRecords.length === requestIds.length) {
                        const quotaPerUnit = await loadNewApiQuotaPerUnit({ baseUrl, fetchImpl, env, signal });
                        const record = aggregateNewApiTokenLogRecords(matchedRecords.map((matchedRecord) => (
                            normalizeNewApiTokenLogRecord(matchedRecord, requestIds, quotaPerUnit)
                        )).filter(Boolean));
                        if (record) return finish(record, 'found', { requestIds });
                        sawUnavailable = true;
                    }
                }
            }
        } catch (error) {
            if (error?.code === 'newapi_billing_lookup_timeout') sawTimeout = true;
            else sawUnavailable = true;
        }
        if (attempt < attempts - 1 && intervalMs > 0) {
            await sleep(intervalMs);
        }
    }
    if (sawTimeout) return finish(null, 'timeout', { requestIds });
    if (sawUnavailable) return finish(null, 'unavailable', { requestIds });
    return finish(null, 'not_found', { requestIds });
}

function clearNewApiQuotaPerUnitCache() {
    quotaPerUnitCache.clear();
}

module.exports = {
    clearNewApiQuotaPerUnitCache,
    fetchNewApiTokenUsageRecord,
    getNewApiRequestIds,
    isNewApiGatewayBaseUrl
};
