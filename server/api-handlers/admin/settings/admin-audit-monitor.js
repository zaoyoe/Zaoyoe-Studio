const {
    requireAdmin,
    sendJson,
    normalizeAdminSite
} = require('../../../../api/_lib/admin');
const {
    isMissingTableAccessError
} = require('./_ops-alert-case-events');
const {
    buildOpsAlertCaseKey,
    fetchOpsAlertCasesByTargets,
    fetchOpsAlertCaseEventsByTargets,
    buildOpsAlertItemCaseState
} = require('./_ops-alert-case-state');
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
const AUDIT_MONITOR_RAW_SCAN_LIMIT = 200;
const DEFAULT_ACCESS_PAGE_SIZE = 8;
const DEFAULT_ANOMALY_PAGE_SIZE = 6;
const DEFAULT_CONFIG_PAGE_SIZE = 8;
const MAX_PAGE_SIZE = 20;
const FACT_BREAKDOWN_LIMIT = 4;
const AUDIT_WORKSPACE_ALERT_LIMIT = 80;
const AUDIT_WORKSPACE_VISIBLE_LIMIT = 8;
const AUDIT_WORKSPACE_ALERT_TYPES = Object.freeze([
    'security_admin_login_anomaly',
    'payment_config_changed',
    'payment_config_recovered',
    'payment_config_incident',
    'payment_config_incident_recovered'
]);
const AUDIT_WORKSPACE_PROBLEM_TYPES = new Set([
    'security_admin_login_anomaly',
    'payment_config_changed',
    'payment_config_incident'
]);
const AUDIT_WORKSPACE_RECOVERY_TYPES = new Set([
    'payment_config_recovered',
    'payment_config_incident_recovered'
]);
const SUPPORTED_AUDIT_MONITOR_SITES = new Set(['cn', 'intl']);

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

function normalizeSupportedSite(value, fallback = '') {
    const normalized = normalizeText(value).toLowerCase();
    if (SUPPORTED_AUDIT_MONITOR_SITES.has(normalized)) {
        return normalized;
    }
    return fallback;
}

function normalizeSupportedSiteList(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return Array.from(new Set(
        value
            .map((item) => normalizeSupportedSite(item))
            .filter(Boolean)
    ));
}

function inferSiteFromTargetId(value = '') {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) {
        return '';
    }

    const match = normalized.match(/(?:^|:)(cn|intl)$/);
    return match ? normalizeSupportedSite(match[1]) : '';
}

function inferSiteFromContent(value = '') {
    const match = String(value || '').match(/站点：\s*(CN|INTL)\b/i);
    return match ? normalizeSupportedSite(match[1]) : '';
}

function getPaymentConfigAuditSite(row = {}) {
    const details = normalizeJsonObject(row.details);
    return normalizeSupportedSite(details.site, 'cn');
}

function shouldIncludePaymentConfigAuditRowForAdminSite(row = {}, adminSite = 'all') {
    const normalizedAdminSite = normalizeAdminSite(adminSite, { defaultValue: 'all' }) || 'all';
    if (normalizedAdminSite === 'all') {
        return true;
    }

    return getPaymentConfigAuditSite(row) === normalizedAdminSite;
}

function inferAuditWorkspaceAlertSite(job = {}) {
    const payload = normalizeJsonObject(job.payload);
    const directSite = normalizeSupportedSite(payload.site);
    if (directSite) {
        return directSite;
    }

    const siteLabels = normalizeSupportedSiteList(payload.site_labels);
    if (siteLabels.length === 1) {
        return siteLabels[0];
    }

    const targetSite = inferSiteFromTargetId(normalizeText(payload.target_id));
    if (targetSite) {
        return targetSite;
    }

    const contentSite = inferSiteFromContent(job.content);
    if (contentSite) {
        return contentSite;
    }

    const normalizedAlertType = normalizeText(job.alert_type).toLowerCase();
    if (normalizedAlertType.startsWith('payment_config_')) {
        return 'cn';
    }

    return '';
}

function shouldIncludeAuditWorkspaceAlertJobForAdminSite(job = {}, adminSite = 'all') {
    const normalizedAdminSite = normalizeAdminSite(adminSite, { defaultValue: 'all' }) || 'all';
    if (normalizedAdminSite === 'all') {
        return true;
    }

    const normalizedAlertType = normalizeText(job.alert_type).toLowerCase();
    if (!normalizedAlertType.startsWith('payment_config_')) {
        return true;
    }

    const payload = normalizeJsonObject(job.payload);
    const siteLabels = normalizeSupportedSiteList(payload.site_labels);
    if (siteLabels.length) {
        return siteLabels.includes(normalizedAdminSite);
    }

    return inferAuditWorkspaceAlertSite(job) === normalizedAdminSite;
}

function normalizePositiveIntegerParam(value, fallback, maxValue = MAX_PAGE_SIZE) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
        return fallback;
    }
    return Math.min(parsed, maxValue);
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

function buildBreakdownEntries(counts = new Map(), limit = FACT_BREAKDOWN_LIMIT) {
    return Array.from(counts.entries())
        .map(([label, count]) => ({
            label,
            count
        }))
        .sort((left, right) => {
            if (right.count !== left.count) {
                return right.count - left.count;
            }
            return String(left.label || '').localeCompare(String(right.label || ''), 'zh-Hans-CN');
        })
        .slice(0, limit);
}

function buildValueBreakdown(values = [], {
    limit = FACT_BREAKDOWN_LIMIT,
    unknownLabel = ''
} = {}) {
    const counts = new Map();

    for (const value of Array.isArray(values) ? values : []) {
        const normalizedValue = normalizeText(value) || unknownLabel;
        if (!normalizedValue) {
            continue;
        }
        counts.set(normalizedValue, (counts.get(normalizedValue) || 0) + 1);
    }

    return buildBreakdownEntries(counts, limit);
}

function buildFlattenedBreakdown(rows = [], getValues, options = {}) {
    const flattened = [];
    for (const row of Array.isArray(rows) ? rows : []) {
        const values = Array.isArray(getValues(row)) ? getValues(row) : [];
        flattened.push(...values);
    }
    return buildValueBreakdown(flattened, options);
}

function paginateRows(rows = [], page = 1, pageSize = DEFAULT_ACCESS_PAGE_SIZE) {
    const items = Array.isArray(rows) ? rows : [];
    const normalizedPageSize = Math.max(1, Number(pageSize) || DEFAULT_ACCESS_PAGE_SIZE);
    const totalItems = items.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / normalizedPageSize));
    const normalizedPage = Math.min(Math.max(1, Number(page) || 1), totalPages);
    const startIndex = (normalizedPage - 1) * normalizedPageSize;
    const pagedItems = totalItems > 0
        ? items.slice(startIndex, startIndex + normalizedPageSize)
        : [];

    return {
        items: pagedItems,
        pagination: {
            page: normalizedPage,
            page_size: normalizedPageSize,
            total_items: totalItems,
            total_pages: totalPages,
            has_prev_page: normalizedPage > 1,
            has_next_page: normalizedPage < totalPages,
            returned_items: pagedItems.length
        }
    };
}

function summarizeAuditOriginLabel(value) {
    const normalized = normalizeText(value);
    if (!normalized) {
        return '';
    }

    try {
        const parsed = new URL(normalized);
        return normalizeText(parsed.hostname) || normalized;
    } catch (error) {
        return normalized;
    }
}

function getAuditWorkspaceAlertCategoryKey(alertType = '') {
    const normalizedAlertType = normalizeText(alertType).toLowerCase();
    if (normalizedAlertType === 'security_admin_login_anomaly') {
        return 'security';
    }
    if (normalizedAlertType.startsWith('payment_config_')) {
        return 'payments';
    }
    return '';
}

function getAuditWorkspaceAlertState(alertType = '') {
    const normalizedAlertType = normalizeText(alertType).toLowerCase();
    if (AUDIT_WORKSPACE_PROBLEM_TYPES.has(normalizedAlertType)) {
        return 'problem';
    }
    if (AUDIT_WORKSPACE_RECOVERY_TYPES.has(normalizedAlertType)) {
        return 'recovered';
    }
    return 'unknown';
}

async function fetchRecentAuditWorkspaceAlertJobs(supabase, sinceIso) {
    try {
        const { data, error } = await supabase
            .from('ops_alert_jobs')
            .select('id, alert_type, severity, title, content, payload, created_at')
            .in('alert_type', AUDIT_WORKSPACE_ALERT_TYPES)
            .gte('created_at', sinceIso)
            .order('created_at', { ascending: false })
            .limit(AUDIT_WORKSPACE_ALERT_LIMIT);

        if (error) {
            throw error;
        }

        return Array.isArray(data) ? data : [];
    } catch (error) {
        if (isMissingTableAccessError(error, 'ops_alert_jobs')) {
            return [];
        }
        throw error;
    }
}

function getAuditWorkspaceAlertExcerpt(job = {}) {
    const title = normalizeText(job.title);
    const lines = normalizeText(job.content, 1200)
        .split('\n')
        .map((line) => normalizeText(line, 240))
        .filter(Boolean)
        .filter((line) => line !== title);

    return lines[0] || '';
}

function getAuditWorkspaceAlertTargetId(job = {}) {
    const payload = normalizeJsonObject(job.payload);
    return normalizeText(payload.target_id)
        || normalizeText(payload.admin_id)
        || normalizeText(payload.audit_id)
        || normalizeText(job.id)
        || 'unknown';
}

function getAuditWorkspaceAlertReference(job = {}) {
    const payload = normalizeJsonObject(job.payload);

    if (normalizeText(payload.admin_email)) {
        return {
            label: '管理员',
            value: normalizeText(payload.admin_email)
        };
    }
    if (normalizeText(payload.audit_id)) {
        return {
            label: '审计ID',
            value: normalizeText(payload.audit_id)
        };
    }
    if (normalizeText(payload.client_ip)) {
        return {
            label: '登录 IP',
            value: normalizeText(payload.client_ip)
        };
    }

    return {
        label: '目标',
        value: getAuditWorkspaceAlertTargetId(job)
    };
}

function buildAuditWorkspaceAlertDetailSummary(job = {}) {
    const payload = normalizeJsonObject(job.payload);
    const parts = [];

    if (normalizeText(payload.client_ip)) {
        parts.push(`登录 IP：${normalizeText(payload.client_ip)}`);
    }
    if (Array.isArray(payload.detected_reasons) && payload.detected_reasons.length) {
        parts.push(`判定信号：${payload.detected_reasons.map((item) => normalizeText(item, 120)).filter(Boolean).join('；')}`);
    }
    if (normalizeText(payload.action_label)) {
        parts.push(`变更类型：${normalizeText(payload.action_label)}`);
    }
    if (normalizeText(payload.active_provider_label)) {
        parts.push(`当前通道：${normalizeText(payload.active_provider_label)}`);
    }
    if (Array.isArray(payload.updated_provider_labels) && payload.updated_provider_labels.length) {
        parts.push(`启用通道：${payload.updated_provider_labels.map((item) => normalizeText(item, 80)).filter(Boolean).join('、')}`);
    }
    if (normalizeText(payload.secret_name)) {
        parts.push(`删除密钥：${normalizeText(payload.secret_name)}`);
    }
    if (Array.isArray(payload.risk_flags) && payload.risk_flags.length) {
        parts.push(`风险提示：${payload.risk_flags.map((item) => normalizeText(item, 120)).filter(Boolean).join('；')}`);
    }

    return parts.join(' · ');
}

function buildAdminAuditWorkspaceItem(job = {}, caseRecord = null, caseEventsByKey = new Map()) {
    const payload = normalizeJsonObject(job.payload);
    const alertType = normalizeText(job.alert_type).toLowerCase();
    const categoryKey = getAuditWorkspaceAlertCategoryKey(alertType);
    const targetId = getAuditWorkspaceAlertTargetId(job);
    const reference = getAuditWorkspaceAlertReference(job);
    const caseKey = buildOpsAlertCaseKey(categoryKey, targetId);
    const caseState = buildOpsAlertItemCaseState(categoryKey, targetId, caseRecord, caseEventsByKey);
    const hasCaseRecord = Boolean(caseRecord || (caseEventsByKey instanceof Map && Array.isArray(caseEventsByKey.get(caseKey)) && caseEventsByKey.get(caseKey).length));

    return {
        id: normalizeText(job.id) || null,
        category_key: categoryKey,
        alert_type: alertType || null,
        severity: normalizeText(job.severity).toLowerCase() || 'warning',
        title: normalizeText(job.title, 240) || '审计告警',
        message: getAuditWorkspaceAlertExcerpt(job),
        response_summary: buildAuditWorkspaceAlertDetailSummary(job) || null,
        created_at: normalizeText(job.created_at, 80) || null,
        site: inferAuditWorkspaceAlertSite(job) || null,
        target_id: targetId,
        reference_label: reference.label,
        reference_value: reference.value,
        admin_email: normalizeText(payload.admin_email) || null,
        client_ip: normalizeText(payload.client_ip) || null,
        alert_state: getAuditWorkspaceAlertState(alertType),
        has_case_record: hasCaseRecord,
        ...caseState
    };
}

function buildAdminAuditWorkspaceItems(alertJobs = [], caseMap = new Map(), caseEventsByKey = new Map()) {
    const latestByTarget = new Map();

    for (const job of Array.isArray(alertJobs) ? alertJobs : []) {
        const alertType = normalizeText(job.alert_type).toLowerCase();
        const categoryKey = getAuditWorkspaceAlertCategoryKey(alertType);
        const targetId = getAuditWorkspaceAlertTargetId(job);
        if (!categoryKey || !targetId) {
            continue;
        }

        const compositeKey = buildOpsAlertCaseKey(categoryKey, targetId);
        const caseRecord = caseMap instanceof Map ? caseMap.get(compositeKey) || null : null;
        const item = buildAdminAuditWorkspaceItem(job, caseRecord, caseEventsByKey);
        if (!latestByTarget.has(compositeKey)) {
            latestByTarget.set(compositeKey, item);
        }
    }

    return Array.from(latestByTarget.values())
        .filter((item) => item.alert_state === 'problem' || item.has_case_record)
        .sort((left, right) => {
            const leftOpen = left.alert_state === 'problem' ? 1 : 0;
            const rightOpen = right.alert_state === 'problem' ? 1 : 0;
            if (leftOpen !== rightOpen) {
                return rightOpen - leftOpen;
            }

            const leftClaimed = left.case_status === 'claimed' ? 1 : 0;
            const rightClaimed = right.case_status === 'claimed' ? 1 : 0;
            if (leftClaimed !== rightClaimed) {
                return rightClaimed - leftClaimed;
            }

            return Date.parse(normalizeText(right.created_at, 80)) - Date.parse(normalizeText(left.created_at, 80));
        })
        .slice(0, AUDIT_WORKSPACE_VISIBLE_LIMIT);
}

function buildAdminAuditWorkspaceSummary(items = []) {
    const rows = Array.isArray(items) ? items : [];
    return {
        visible_count: rows.length,
        active_problem_count: rows.filter((item) => (
            item.alert_state === 'problem'
            && normalizeText(item.case_status).toLowerCase() !== 'resolved'
        )).length,
        claimed_count: rows.filter((item) => normalizeText(item.case_status).toLowerCase() === 'claimed').length,
        pending_recovery_count: rows.filter((item) => item.alert_state === 'recovered' && normalizeText(item.case_status).toLowerCase() !== 'resolved').length
    };
}

async function fetchAuditRowsByAction(supabase, actionType, sinceIso, limit = AUDIT_MONITOR_RAW_SCAN_LIMIT) {
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
    return fetchAuditRowsByAction(supabase, ADMIN_ACCESS_AUDIT_ACTION, sinceIso, AUDIT_MONITOR_RAW_SCAN_LIMIT);
}

async function fetchRecentPaymentConfigAuditRows(supabase, sinceIso) {
    const batches = await Promise.all(
        PAYMENT_CONFIG_AUDIT_ACTIONS.map((actionType) => fetchAuditRowsByAction(supabase, actionType, sinceIso, AUDIT_MONITOR_RAW_SCAN_LIMIT))
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
    const anomalyReasons = normalizeStringArray(payload.anomaly_reasons);
    return {
        id: normalizeText(payload.audit_id) || normalizeText(alert.dedupeKey) || null,
        title: normalizeText(alert.title) || '管理员异常登录',
        created_at: normalizeText(payload.created_at) || null,
        admin_id: normalizeText(payload.admin_id) || null,
        admin_email: normalizeText(payload.admin_email) || null,
        client_ip: normalizeText(payload.client_ip) || null,
        user_agent: normalizeText(payload.user_agent) || null,
        user_agent_summary: summarizeUserAgent(payload.user_agent),
        anomaly_reasons: anomalyReasons.length
            ? anomalyReasons
            : normalizeStringArray(payload.detected_reasons),
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
        site: normalizeSupportedSite(payload.site, 'cn'),
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

function buildAdminAuditFacts(accessRows = [], anomalies = [], configEvents = []) {
    const rows = Array.isArray(accessRows) ? accessRows : [];
    const anomalyRows = Array.isArray(anomalies) ? anomalies : [];
    const configRows = Array.isArray(configEvents) ? configEvents : [];
    const issuedAccessCount = rows.filter((row) => row?.granted === true).length;
    const anomalyAdmins = new Set(
        anomalyRows
            .map((row) => normalizeText(row.admin_email) || normalizeText(row.admin_id))
            .filter(Boolean)
    );

    return {
        access_sample_count: rows.length,
        anomaly_sample_count: anomalyRows.length,
        config_sample_count: configRows.length,
        issued_access_count: issuedAccessCount,
        recorded_only_access_count: Math.max(0, rows.length - issuedAccessCount),
        anomaly_admin_count: anomalyAdmins.size,
        top_access_admins: buildValueBreakdown(
            rows.map((row) => row.admin_email || row.admin_id),
            { unknownLabel: '未知管理员' }
        ),
        top_access_origins: buildValueBreakdown(
            rows.map((row) => summarizeAuditOriginLabel(row.origin || row.referer)),
            { unknownLabel: '直接入口' }
        ),
        top_access_ips: buildValueBreakdown(
            rows.map((row) => row.client_ip),
            { unknownLabel: '未记录 IP' }
        ),
        anomaly_reason_breakdown: buildFlattenedBreakdown(
            anomalyRows,
            (row) => row.anomaly_reasons,
            { unknownLabel: '未记录判定信号' }
        ),
        config_action_breakdown: buildValueBreakdown(
            configRows.map((row) => row.action_label || row.action_type),
            { unknownLabel: '配置变更' }
        ),
        config_risk_breakdown: buildFlattenedBreakdown(
            configRows,
            (row) => row.risk_flags,
            { unknownLabel: '未记录风险提示' }
        ),
        config_operator_breakdown: buildValueBreakdown(
            configRows.map((row) => row.admin_email || row.admin_id),
            { unknownLabel: '未知管理员' }
        )
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
        const requestUrl = new URL(req.url || '/api/admin/settings/admin-audit-monitor', 'http://localhost');
        const adminSite = normalizeAdminSite(requestUrl.searchParams.get('site') || req.adminSite, { defaultValue: 'all' }) || 'all';
        const accessPage = normalizePositiveIntegerParam(requestUrl.searchParams.get('accessPage'), 1);
        const accessPageSize = normalizePositiveIntegerParam(requestUrl.searchParams.get('accessPageSize'), DEFAULT_ACCESS_PAGE_SIZE);
        const anomalyPage = normalizePositiveIntegerParam(requestUrl.searchParams.get('anomalyPage'), 1);
        const anomalyPageSize = normalizePositiveIntegerParam(requestUrl.searchParams.get('anomalyPageSize'), DEFAULT_ANOMALY_PAGE_SIZE);
        const configPage = normalizePositiveIntegerParam(requestUrl.searchParams.get('configPage'), 1);
        const configPageSize = normalizePositiveIntegerParam(requestUrl.searchParams.get('configPageSize'), DEFAULT_CONFIG_PAGE_SIZE);
        const nowDate = new Date();
        const sinceIso = new Date(nowDate.getTime() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

        const [accessRows, paymentConfigRows, auditWorkspaceAlertJobs] = await Promise.all([
            fetchRecentAdminAccessRows(supabase, sinceIso),
            fetchRecentPaymentConfigAuditRows(supabase, sinceIso),
            fetchRecentAuditWorkspaceAlertJobs(supabase, sinceIso)
        ]);

        const sortedAccessRows = sortRowsDesc(accessRows);
        const anomalyAnchor = sortedAccessRows[0]?.created_at || nowDate.toISOString();
        const anomalyAlerts = buildAdminLoginAnomalyAlerts(
            sortedAccessRows.slice().reverse(),
            normalizeAdminLoginAnomalyMonitorConfig(),
            { now: anomalyAnchor }
        );
        const mappedAccessRows = sortedAccessRows.map(mapAccessRow);
        const mappedAnomalyRows = sortRowsDesc(anomalyAlerts.map(mapAnomalyAlert));
        const scopedPaymentConfigRows = paymentConfigRows.filter((row) => shouldIncludePaymentConfigAuditRowForAdminSite(row, adminSite));
        const paymentConfigEvents = sortRowsDesc(buildPaymentConfigChangedAlerts(
            scopedPaymentConfigRows,
            normalizePaymentConfigChangeMonitorConfig(),
            { now: nowDate }
        ).map(mapPaymentConfigAlert));
        const scopedAuditWorkspaceAlertJobs = auditWorkspaceAlertJobs.filter((job) => shouldIncludeAuditWorkspaceAlertJobForAdminSite(job, adminSite));
        const auditWorkspaceTargets = scopedAuditWorkspaceAlertJobs.map((job) => ({
            category_key: getAuditWorkspaceAlertCategoryKey(job.alert_type),
            target_id: getAuditWorkspaceAlertTargetId(job)
        })).filter((item) => item.category_key && item.target_id);
        const [auditCaseMap, auditCaseEventsByKey] = await Promise.all([
            fetchOpsAlertCasesByTargets(supabase, auditWorkspaceTargets),
            fetchOpsAlertCaseEventsByTargets(supabase, auditWorkspaceTargets)
        ]);
        const alertItems = buildAdminAuditWorkspaceItems(scopedAuditWorkspaceAlertJobs, auditCaseMap, auditCaseEventsByKey);
        const accessResult = paginateRows(mappedAccessRows, accessPage, accessPageSize);
        const anomalyResult = paginateRows(mappedAnomalyRows, anomalyPage, anomalyPageSize);
        const configResult = paginateRows(paymentConfigEvents, configPage, configPageSize);

        return sendJson(res, 200, {
            success: true,
            site_context: adminSite,
            fetched_at: nowDate.toISOString(),
            access_summary: buildAccessSummary(sortedAccessRows, mappedAnomalyRows),
            config_summary: buildConfigSummary(paymentConfigEvents),
            alert_summary: buildAdminAuditWorkspaceSummary(alertItems),
            facts: buildAdminAuditFacts(mappedAccessRows, mappedAnomalyRows, paymentConfigEvents),
            alert_items: alertItems,
            recent_accesses: accessResult.items,
            recent_access_pagination: accessResult.pagination,
            access_anomalies: anomalyResult.items,
            anomaly_pagination: anomalyResult.pagination,
            payment_config_events: configResult.items,
            config_event_pagination: configResult.pagination
        });
    } catch (error) {
        const statusCode = Number(error?.statusCode) || 500;
        return sendJson(res, statusCode, {
            success: false,
            message: error?.message || 'Failed to load admin audit monitor'
        });
    }
};
