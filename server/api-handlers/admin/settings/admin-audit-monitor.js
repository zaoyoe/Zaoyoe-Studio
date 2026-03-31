const {
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const {
    ADMIN_ACCESS_AUDIT_ACTION,
    buildAdminLoginAnomalyAlerts,
    normalizeAdminLoginAnomalyMonitorConfig
} = require('../../../../api/_lib/admin-login-anomaly-alerts');
const {
    buildPaymentConfigChangedAlerts,
    normalizePaymentConfigChangeMonitorConfig
} = require('../../../../api/_lib/payment-config-change-alerts');

const PAYMENT_CONFIG_AUDIT_ACTIONS = Object.freeze([
    'admin.payment_channels.upsert',
    'admin.payment_channels.secret.delete'
]);
const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_QUERY_LIMIT = 80;

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeJsonObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}

function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((item) => normalizeText(item))
        .filter(Boolean);
}

function summarizeUserAgent(value) {
    const normalized = normalizeText(value);
    if (!normalized) return '';
    return normalized.length > 88 ? `${normalized.slice(0, 85)}...` : normalized;
}

function sortRowsDesc(rows = []) {
    return rows
        .slice()
        .sort((left, right) => Date.parse(normalizeText(right.created_at)) - Date.parse(normalizeText(left.created_at)));
}

async function fetchAuditRowsByAction(supabase, actionType, sinceIso, limit = DEFAULT_QUERY_LIMIT) {
    const { data, error } = await supabase
        .from('admin_audit_logs_view')
        .select('id, action_type, details, created_at, admin_id, admin_email')
        .eq('action_type', actionType)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) {
        throw error;
    }

    return Array.isArray(data) ? data : [];
}

async function fetchRecentAdminAccessRows(supabase, sinceIso) {
    return fetchAuditRowsByAction(supabase, ADMIN_ACCESS_AUDIT_ACTION, sinceIso, DEFAULT_QUERY_LIMIT);
}

async function fetchRecentPaymentConfigAuditRows(supabase, sinceIso) {
    const batches = await Promise.all(
        PAYMENT_CONFIG_AUDIT_ACTIONS.map((actionType) => fetchAuditRowsByAction(supabase, actionType, sinceIso, DEFAULT_QUERY_LIMIT))
    );
    return sortRowsDesc(batches.flat());
}

function buildAccessSummary(rows = [], anomalies = []) {
    const sortedRows = sortRowsDesc(rows);
    const distinctAdmins = new Set(sortedRows.map((row) => normalizeText(row.admin_email) || normalizeText(row.admin_id)).filter(Boolean));
    const distinctIps = new Set(sortedRows.map((row) => normalizeText(normalizeJsonObject(row.details).client_ip)).filter(Boolean));

    return {
        access_count: sortedRows.length,
        distinct_admin_count: distinctAdmins.size,
        distinct_ip_count: distinctIps.size,
        anomaly_count: Array.isArray(anomalies) ? anomalies.length : 0,
        latest_access_at: normalizeText(sortedRows[0]?.created_at) || null
    };
}

function buildConfigSummary(configEvents = []) {
    const events = Array.isArray(configEvents) ? configEvents : [];
    return {
        config_change_count: events.length,
        secret_delete_count: events.filter((item) => normalizeText(item.action_type).toLowerCase() === 'admin.payment_channels.secret.delete').length,
        mock_switch_count: events.filter((item) => (item.risk_flags || []).includes('当前活动通道已切换为模拟支付')).length,
        latest_config_change_at: normalizeText(events[0]?.created_at) || null
    };
}

function mapAccessRow(row = {}) {
    const details = normalizeJsonObject(row.details);
    return {
        id: normalizeText(row.id),
        created_at: normalizeText(row.created_at) || null,
        admin_id: normalizeText(row.admin_id) || null,
        admin_email: normalizeText(row.admin_email) || normalizeText(details.admin_email) || null,
        client_ip: normalizeText(details.client_ip) || null,
        user_agent: normalizeText(details.user_agent) || null,
        user_agent_summary: summarizeUserAgent(details.user_agent),
        origin: normalizeText(details.origin) || null,
        referer: normalizeText(details.referer) || null,
        granted: details.granted === true
    };
}

function mapAnomalyAlert(alert = {}) {
    const payload = normalizeJsonObject(alert.payload);
    return {
        id: normalizeText(payload.audit_id) || normalizeText(alert.dedupeKey) || null,
        title: normalizeText(alert.title) || '管理员异常登录',
        created_at: normalizeText(payload.created_at) || null,
        admin_id: normalizeText(payload.admin_id) || null,
        admin_email: normalizeText(payload.admin_email) || null,
        client_ip: normalizeText(payload.client_ip) || null,
        user_agent: normalizeText(payload.user_agent) || null,
        user_agent_summary: summarizeUserAgent(payload.user_agent),
        anomaly_reasons: normalizeStringArray(payload.anomaly_reasons),
        origin: normalizeText(payload.origin) || null,
        referer: normalizeText(payload.referer) || null
    };
}

function mapPaymentConfigAlert(alert = {}) {
    const payload = normalizeJsonObject(alert.payload);
    return {
        id: normalizeText(payload.audit_id) || null,
        title: normalizeText(alert.title) || '支付配置变更',
        severity: normalizeText(alert.severity) || 'warning',
        created_at: normalizeText(payload.created_at) || null,
        admin_id: normalizeText(payload.admin_id) || null,
        admin_email: normalizeText(payload.admin_email) || null,
        action_type: normalizeText(payload.action_type) || null,
        action_label: normalizeText(payload.action_label) || null,
        active_provider: normalizeText(payload.active_provider) || null,
        active_provider_label: normalizeText(payload.active_provider_label) || null,
        updated_providers: normalizeStringArray(payload.updated_providers),
        updated_provider_labels: normalizeStringArray(payload.updated_provider_labels),
        updated_secrets: normalizeStringArray(payload.updated_secrets),
        secret_name: normalizeText(payload.secret_name) || null,
        risk_flags: normalizeStringArray(payload.risk_flags)
    };
}

module.exports = async function adminAuditMonitorHandler(req, res) {
    try {
        const method = String(req.method || 'GET').toUpperCase();
        if (method !== 'GET') {
            res.setHeader('Allow', 'GET');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const { supabase } = await requireAdmin(req, { permission: 'settings.manage' });
        const nowDate = new Date();
        const sinceIso = new Date(nowDate.getTime() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

        const [accessRows, paymentConfigRows] = await Promise.all([
            fetchRecentAdminAccessRows(supabase, sinceIso),
            fetchRecentPaymentConfigAuditRows(supabase, sinceIso)
        ]);

        const sortedAccessRows = sortRowsDesc(accessRows);
        const anomalyAnchor = sortedAccessRows[0]?.created_at || nowDate.toISOString();
        const anomalyAlerts = buildAdminLoginAnomalyAlerts(
            sortedAccessRows.slice().reverse(),
            normalizeAdminLoginAnomalyMonitorConfig(),
            { now: anomalyAnchor }
        );
        const paymentConfigEvents = buildPaymentConfigChangedAlerts(
            paymentConfigRows,
            normalizePaymentConfigChangeMonitorConfig(),
            { now: nowDate }
        ).map(mapPaymentConfigAlert);

        return sendJson(res, 200, {
            success: true,
            fetched_at: nowDate.toISOString(),
            access_summary: buildAccessSummary(sortedAccessRows, anomalyAlerts),
            config_summary: buildConfigSummary(paymentConfigEvents),
            recent_accesses: sortedAccessRows.slice(0, 8).map(mapAccessRow),
            access_anomalies: anomalyAlerts.slice(0, 6).map(mapAnomalyAlert),
            payment_config_events: paymentConfigEvents.slice(0, 8)
        });
    } catch (error) {
        const statusCode = Number(error?.statusCode) || 500;
        return sendJson(res, statusCode, {
            success: false,
            message: error?.message || 'Failed to load admin audit monitor'
        });
    }
};
