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

const DEFAULT_VERIFY_SERVER_URL = 'https://zaoyoe-verify-server-production.up.railway.app';
const VERIFY_MONITOR_PROXY_TIMEOUT_MS = 5000;

function getVerifyServerUrl() {
    return String(process.env.VERIFY_SERVER_URL || DEFAULT_VERIFY_SERVER_URL).trim().replace(/\/+$/, '');
}

function getForwardHeaders(req) {
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

    const error = new Error('验证运维内部凭证未配置，且当前管理员会话不可转发');
    error.statusCode = 500;
    throw error;
}

module.exports = async (req, res) => {
    try {
        await requireAdmin(req, { permission: 'settings.manage' });

        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timeoutId = controller
            ? setTimeout(() => controller.abort(), VERIFY_MONITOR_PROXY_TIMEOUT_MS)
            : 0;

        try {
            const supabase = typeof getOptionalSupabaseAdmin === 'function'
                ? getOptionalSupabaseAdmin()
                : null;
            if (supabase) {
                const directState = await fetchDirectVerifyQuotaState(supabase, {
                    fetchImpl: global.fetch,
                    timeoutMs: VERIFY_MONITOR_PROXY_TIMEOUT_MS
                });

                if (directState?.success) {
                    return sendJson(res, 200, directState);
                }
            }

            const upstreamResponse = await fetch(`${getVerifyServerUrl()}/api/quota`, {
                method: 'GET',
                headers: getForwardHeaders(req),
                signal: controller?.signal
            });
            const payload = await upstreamResponse.json().catch(() => ({}));

            return sendJson(res, upstreamResponse.status, {
                success: Boolean(payload?.success),
                balance: Number(payload?.balance ?? payload?.credits ?? 0),
                remaining_uses: Number(payload?.remaining_uses ?? payload?.balance ?? payload?.credits ?? 0),
                remaining_extract_jobs: Number(payload?.remaining_extract_jobs ?? 0),
                remaining_full_jobs: Number(payload?.remaining_full_jobs ?? 0),
                total_used: Number(payload?.total_used ?? 0),
                cost_per_job: Number(payload?.cost_per_job ?? 0),
                extract_cost_per_job: Number(payload?.extract_cost_per_job ?? 0),
                full_cost_per_job: Number(payload?.full_cost_per_job ?? 0),
                key_name: String(payload?.key_name || payload?.name || '').trim(),
                key_count: Number(payload?.key_count ?? 0),
                healthy_key_count: Number(payload?.healthy_key_count ?? 0),
                key_states: Array.isArray(payload?.key_states) ? payload.key_states : [],
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
