const {
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const {
    buildVerifyMonitorProxyHeaders
} = require('../../../../api/_lib/verify-monitor-internal-access');

const DEFAULT_VERIFY_SERVER_URL = 'https://zaoyoe-verify-server-production.up.railway.app';
const VERIFY_MONITOR_PROXY_TIMEOUT_MS = 5000;

function getVerifyServerUrl() {
    return String(process.env.VERIFY_SERVER_URL || DEFAULT_VERIFY_SERVER_URL).trim().replace(/\/+$/, '');
}

function getForwardHeaders() {
    const headers = buildVerifyMonitorProxyHeaders(process.env);
    if (!headers) {
        const error = new Error('验证运维内部凭证未配置');
        error.statusCode = 500;
        throw error;
    }

    return headers;
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
            const upstreamResponse = await fetch(`${getVerifyServerUrl()}/api/queue`, {
                method: 'GET',
                headers: getForwardHeaders(),
                signal: controller?.signal
            });
            const payload = await upstreamResponse.json().catch(() => ({}));

            return sendJson(res, upstreamResponse.status, {
                success: Boolean(payload?.success),
                queue_size: Number(payload?.queue_size ?? 0),
                running_jobs: Number(payload?.running_jobs ?? 0),
                key_name: String(payload?.key_name || '').trim(),
                api_base_url: String(payload?.api_base_url || '').trim(),
                checked_at: new Date().toISOString(),
                message: payload?.message || ''
            });
        } catch (error) {
            if (error?.name === 'AbortError') {
                return sendJson(res, 504, {
                    success: false,
                    checked_at: new Date().toISOString(),
                    message: '查询验证队列超时，请稍后重试'
                });
            }

            return sendJson(res, error?.statusCode || 502, {
                success: false,
                checked_at: new Date().toISOString(),
                message: error.message || '查询验证队列失败'
            });
        } finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Verify monitor queue proxy failed'
        });
    }
};
