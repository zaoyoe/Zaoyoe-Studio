const {
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');

const DEFAULT_VERIFY_SERVER_URL = 'https://zaoyoe-verify-server-production.up.railway.app';
const VERIFY_MONITOR_PROXY_TIMEOUT_MS = 5000;

function getVerifyServerUrl() {
    return String(process.env.VERIFY_SERVER_URL || DEFAULT_VERIFY_SERVER_URL).trim().replace(/\/+$/, '');
}

function getForwardHeaders(req) {
    const headers = {
        Accept: 'application/json'
    };
    const authHeader = String(req.headers.authorization || req.headers.Authorization || '').trim();
    if (authHeader) {
        headers.Authorization = authHeader;
    }
    return headers;
}

module.exports = async (req, res) => {
    try {
        await requireAdmin(req);

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
            const upstreamResponse = await fetch(`${getVerifyServerUrl()}/api/quota`, {
                method: 'GET',
                headers: getForwardHeaders(req),
                signal: controller?.signal
            });
            const payload = await upstreamResponse.json().catch(() => ({}));

            return sendJson(res, upstreamResponse.status, {
                success: Boolean(payload?.success),
                balance: Number(payload?.balance ?? payload?.credits ?? 0),
                total_used: Number(payload?.total_used ?? 0),
                cost_per_job: Number(payload?.cost_per_job ?? 0),
                key_name: String(payload?.key_name || payload?.name || '').trim(),
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

            return sendJson(res, 502, {
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
