const {
    requireAdmin,
    sendJson,
    getOptionalSupabaseAdmin
} = require('../../../../api/_lib/admin');
const {
    buildVerifyMonitorProxyHeaders
} = require('../../../../api/_lib/verify-monitor-internal-access');
const {
    fetchDirectVerifyQuotaState
} = require('../../_verify-provider-runtime');

const DEFAULT_VERIFY_SERVER_URL = 'https://verify-api.fatherkey.com';
const VERIFY_MONITOR_PROXY_TIMEOUT_MS = 15000;

function getVerifyServerUrl() {
    return String(process.env.VERIFY_SERVER_URL || DEFAULT_VERIFY_SERVER_URL).trim().replace(/\/+$/, '');
}

function normalizeVerifyMonitorSite(value = '', fallback = 'cn') {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'intl') return 'intl';
    if (normalized === 'cn') return 'cn';
    return fallback === 'intl' ? 'intl' : 'cn';
}

function toFiniteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function getRemainingJobCount(payload = {}, jobKey = '', remainingUses = 0, costKey = '') {
    const explicitJobs = Number(payload?.[jobKey]);
    if (Number.isFinite(explicitJobs)) {
        return Math.max(0, Math.floor(explicitJobs));
    }

    const unitCost = Number(payload?.[costKey]);
    if (!Number.isFinite(unitCost) || unitCost <= 0) {
        return 0;
    }

    return Math.max(0, Math.floor((Number(remainingUses) + 1e-9) / unitCost));
}

function buildForwardHeaders(req) {
    const headers = buildVerifyMonitorProxyHeaders(process.env);
    if (headers) {
        return headers;
    }

    const authorization = String(req?.headers?.authorization || '').trim();
    if (authorization) {
        return {
            Accept: 'application/json',
            Authorization: authorization
        };
    }

    return null;
}

function getForwardHeaders(req) {
    const headers = buildForwardHeaders(req);
    if (headers) {
        return headers;
    }

    const error = new Error('验证运维内部凭证未配置，且当前管理员会话不可转发');
    error.statusCode = 500;
    throw error;
}

module.exports = async (req, res) => {
    try {
        const adminContext = await requireAdmin(req, { permission: 'settings.manage' });

        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }
        const url = new URL(req.url || '', 'http://localhost');
        const siteHint = url.searchParams.get('site') || req.adminSite || adminContext?.site || '';
        const site = normalizeVerifyMonitorSite(siteHint);

        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timeoutId = controller
            ? setTimeout(() => controller.abort(), VERIFY_MONITOR_PROXY_TIMEOUT_MS)
            : 0;

        try {
            const supabase = typeof getOptionalSupabaseAdmin === 'function'
                ? getOptionalSupabaseAdmin()
                : null;
            let directState = null;
            if (supabase) {
                directState = await fetchDirectVerifyQuotaState(supabase, {
                    fetchImpl: global.fetch,
                    timeoutMs: VERIFY_MONITOR_PROXY_TIMEOUT_MS,
                    site
                });

                if (directState?.success) {
                    return sendJson(res, 200, directState);
                }
            }

            const forwardHeaders = buildForwardHeaders(req);
            if (!forwardHeaders && directState) {
                return sendJson(res, Number(directState.status || 502) || 502, {
                    ...directState,
                    success: false,
                    checked_at: directState.checked_at || new Date().toISOString(),
                    message: directState.message || '查询 API 余额失败'
                });
            }

            const upstreamUrl = `${getVerifyServerUrl()}/api/quota${siteHint ? `?site=${encodeURIComponent(site)}` : ''}`;
            const upstreamResponse = await fetch(upstreamUrl, {
                method: 'GET',
                headers: forwardHeaders || getForwardHeaders(req),
                signal: controller?.signal
            });
            const payload = await upstreamResponse.json().catch(() => ({}));
            const remainingUses = toFiniteNumber(payload?.remaining_uses ?? payload?.balance ?? payload?.credits);
            const remainingExtractUses = toFiniteNumber(payload?.remaining_extract_uses ?? remainingUses);
            const remainingFullUses = toFiniteNumber(payload?.remaining_full_uses ?? remainingUses);

            return sendJson(res, upstreamResponse.status, {
                success: Boolean(payload?.success),
                provider: String(payload?.provider || '').trim(),
                provider_label: String(payload?.provider_label || payload?.providerLabel || '').trim(),
                adapter: String(payload?.adapter || payload?.provider_adapter || '').trim(),
                capabilities: payload?.capabilities && typeof payload.capabilities === 'object'
                    ? payload.capabilities
                    : {},
                balance: toFiniteNumber(payload?.balance ?? payload?.credits ?? remainingUses),
                remaining_uses: remainingUses,
                remaining_extract_uses: remainingExtractUses,
                remaining_full_uses: remainingFullUses,
                remaining_extract_jobs: getRemainingJobCount(payload, 'remaining_extract_jobs', remainingExtractUses, 'extract_cost_per_job'),
                remaining_full_jobs: getRemainingJobCount(payload, 'remaining_full_jobs', remainingFullUses, 'full_cost_per_job'),
                total_used: toFiniteNumber(payload?.total_used),
                cost_per_job: toFiniteNumber(payload?.cost_per_job),
                extract_cost_per_job: toFiniteNumber(payload?.extract_cost_per_job),
                full_cost_per_job: toFiniteNumber(payload?.full_cost_per_job),
                key_name: String(payload?.key_name || payload?.name || '').trim(),
                key_count: toFiniteNumber(payload?.key_count),
                healthy_key_count: toFiniteNumber(payload?.healthy_key_count),
                key_states: Array.isArray(payload?.key_states) ? payload.key_states : [],
                api_base_url: String(payload?.api_base_url || payload?.apiBaseUrl || '').trim(),
                checked_at: new Date().toISOString(),
                message: payload?.message || ''
            });
        } catch (error) {
            if (error?.name === 'AbortError') {
                return sendJson(res, 504, {
                    success: false,
                    checked_at: new Date().toISOString(),
                    message: '查询 API 余额超时，请稍后重试'
                });
            }

            return sendJson(res, error?.statusCode || 502, {
                success: false,
                checked_at: new Date().toISOString(),
                message: error.message || '查询 API 余额失败'
            });
        } finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Verify monitor quota proxy failed'
        });
    }
};
