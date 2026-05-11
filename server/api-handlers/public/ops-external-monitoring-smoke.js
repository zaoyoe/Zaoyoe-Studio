const {
    emitExternalMonitoringEventFailOpen,
    normalizeText
} = require('../../../api/_lib/external-monitoring');
const {
    hasCronAccess
} = require('./ops-recovery-readiness-sweep');

function sendJson(res, status, payload) {
    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.end(JSON.stringify(payload));
}

function getRequestUrl(req) {
    return new URL(req?.url || '/api/ops/external-monitoring-smoke', 'http://localhost');
}

function getSmokeMessage(req) {
    const url = getRequestUrl(req);
    const body = req?.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? req.body
        : {};
    return normalizeText(
        body.message
        || url.searchParams.get('message')
        || 'Zaoyoe external monitoring smoke test',
        500
    );
}

function getSmokeSource(req) {
    const url = getRequestUrl(req);
    const body = req?.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? req.body
        : {};
    return normalizeText(
        body.source
        || url.searchParams.get('source')
        || 'manual',
        80
    );
}

function createExternalMonitoringSmokeHandler({
    env = process.env,
    emit = emitExternalMonitoringEventFailOpen
} = {}) {
    return async function externalMonitoringSmokeHandler(req, res) {
        if (req.method === 'OPTIONS') {
            res.setHeader('Allow', 'GET, POST, OPTIONS');
            return sendJson(res, 204, {});
        }

        if (!['GET', 'POST'].includes(String(req.method || '').toUpperCase())) {
            res.setHeader('Allow', 'GET, POST, OPTIONS');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const access = hasCronAccess(req, env);
        if (!access.ok) {
            return sendJson(res, access.status, {
                success: false,
                message: access.reason === 'cron_secret_not_configured'
                    ? 'External monitoring smoke secret is not configured'
                    : 'Unauthorized',
                reason: access.reason
            });
        }

        const message = getSmokeMessage(req);
        const source = getSmokeSource(req);
        const result = await emit({
            type: 'external_monitoring_smoke_test',
            level: 'info',
            message,
            tags: {
                source,
                route: 'ops.external-monitoring-smoke',
                protected_by: 'cron_secret'
            },
            extra: {
                runtime_dependency: 'none',
                pro_fallback: true,
                manual_smoke: source === 'manual'
            }
        }, {
            env,
            timeoutMs: 1200
        });

        return sendJson(res, 202, {
            success: true,
            accepted: true,
            status: result.delivered > 0 ? 'delivered' : (result.configured > 0 ? 'attempted' : 'not_configured'),
            configured: result.configured,
            delivered: result.delivered,
            failed: result.failed,
            providers: result.results.map((entry) => ({
                provider: entry.provider,
                ok: entry.ok === true,
                skipped: entry.skipped === true,
                status: Number.isFinite(Number(entry.status)) ? Number(entry.status) : 0,
                reason: normalizeText(entry.reason || entry.error || '', 200) || null,
                env_name: normalizeText(entry.env_name, 80) || null,
                dsn_host: normalizeText(entry.dsn_host, 180) || null,
                dsn_project_id: normalizeText(entry.dsn_project_id, 80) || null,
                expected_env_names: Array.isArray(entry.expected_env_names)
                    ? entry.expected_env_names
                        .map((name) => normalizeText(name, 80))
                        .filter(Boolean)
                        .slice(0, 6)
                    : []
            })),
            event: {
                type: result.event?.type,
                level: result.event?.level,
                message: result.event?.message,
                event_id: result.event?.event_id
            },
            runtime_dependency: 'none',
            pro_fallback: true
        });
    };
}

module.exports = {
    createExternalMonitoringSmokeHandler,
    getSmokeMessage,
    getSmokeSource
};
