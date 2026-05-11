const {
    parseJsonBody,
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const {
    emitExternalMonitoringEventFailOpen,
    normalizeText
} = require('../../../../api/_lib/external-monitoring');

function normalizeSmokeSource(value = '') {
    const normalized = normalizeText(value, 80).toLowerCase();
    if (['admin-studio', 'manual', 'readiness-panel'].includes(normalized)) {
        return normalized;
    }
    return 'admin-studio';
}

function normalizeSmokeProviderResult(entry = {}) {
    const expectedEnvNames = Array.isArray(entry.expected_env_names)
        ? entry.expected_env_names
            .map((name) => normalizeText(name, 80))
            .filter(Boolean)
            .slice(0, 6)
        : [];

    return {
        provider: normalizeText(entry.provider, 80) || 'unknown',
        ok: entry.ok === true,
        skipped: entry.skipped === true,
        status: Number.isFinite(Number(entry.status)) ? Number(entry.status) : 0,
        reason: normalizeText(entry.reason || entry.error || '', 240) || null,
        env_name: normalizeText(entry.env_name, 80) || null,
        dsn_host: normalizeText(entry.dsn_host, 180) || null,
        dsn_project_id: normalizeText(entry.dsn_project_id, 80) || null,
        expected_env_names: expectedEnvNames
    };
}

module.exports = async (req, res) => {
    try {
        const { user } = await requireAdmin(req, {
            anyOf: ['settings.manage', 'ops_alerts.manage']
        });

        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const body = await parseJsonBody(req);
        const source = normalizeSmokeSource(body.source);
        const message = normalizeText(
            body.message || 'Admin Studio external monitoring smoke test',
            500
        ) || 'Admin Studio external monitoring smoke test';
        const result = await emitExternalMonitoringEventFailOpen({
            type: 'external_monitoring_smoke_test',
            level: 'info',
            message,
            tags: {
                source,
                route: 'admin.settings.external-monitoring-smoke',
                protected_by: 'admin_session'
            },
            extra: {
                runtime_dependency: 'none',
                pro_fallback: true,
                admin_id: normalizeText(user?.id, 160) || null
            }
        }, {
            timeoutMs: 1200
        });
        const configured = Number(result.configured || 0) || 0;
        const delivered = Number(result.delivered || 0) || 0;
        const failed = Number(result.failed || 0) || 0;

        return sendJson(res, 202, {
            success: true,
            accepted: true,
            status: delivered > 0 ? 'delivered' : (configured > 0 ? 'attempted' : 'not_configured'),
            configured,
            delivered,
            failed,
            providers: (Array.isArray(result.results) ? result.results : []).map(normalizeSmokeProviderResult),
            event: {
                type: result.event?.type || 'external_monitoring_smoke_test',
                level: result.event?.level || 'info',
                message: result.event?.message || message,
                event_id: result.event?.event_id || ''
            },
            runtime_dependency: 'none',
            pro_fallback: true,
            message: delivered > 0
                ? `外部监控测试事件已送达 ${delivered} 个通道。`
                : (configured > 0
                    ? '外部监控测试事件已尝试发送，请查看通道诊断。'
                    : '外部监控未配置，站内告警和现有降级逻辑继续可用。')
        });
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'External monitoring smoke failed'
        });
    }
};

module.exports._private = {
    normalizeSmokeProviderResult,
    normalizeSmokeSource
};
