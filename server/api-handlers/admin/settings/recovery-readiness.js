const {
    requireAdmin,
    sendJson
} = require('../../../../api/_lib/admin');
const {
    runReadiness: runFinancialRecoveryDrillReadiness
} = require('../../../../scripts/financial-recovery-drill-readiness');
const {
    runReadiness: runExternalMonitoringReadiness
} = require('../../../../scripts/external-monitoring-readiness');
const {
    runReadinessGate: runPaymentRecoveryReadinessGate
} = require('../../../../scripts/payment-readiness-gate');

const DEFAULT_READINESS_CHECK_TIMEOUT_MS = 1800;
const PAYMENT_READINESS_CHECK_TIMEOUT_MS = 4500;

function normalizeText(value, maxLength = 500) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function buildUnavailableSection(key, label, error = null) {
    return {
        key,
        label,
        ok: true,
        status: 'unavailable_fallback',
        tone: 'warning',
        runtime_dependency: 'none',
        summary_text: `${label} 暂时不可用，线上继续使用原有读取和降级逻辑。`,
        message: normalizeText(error?.message || error || 'Readiness check unavailable'),
        findings: [],
        advisories: [{
            severity: 'info',
            key: `${key}_fallback`,
            message: `${label} 检查失败时不会阻断 Admin Studio 或生产运行。`
        }]
    };
}

function getSectionTone(ok, findingCount = 0, advisoryCount = 0) {
    if (ok !== true || findingCount > 0) return 'danger';
    if (advisoryCount > 0) return 'warning';
    return 'success';
}

function normalizeFindingList(items = [], limit = 6) {
    return (Array.isArray(items) ? items : [])
        .filter(Boolean)
        .slice(0, Math.max(0, limit))
        .map((item) => ({
            severity: normalizeText(item.severity, 40) || 'info',
            key: normalizeText(item.key, 120),
            message: normalizeText(item.message || item.status || item.key, 500),
            status: normalizeText(item.status, 80)
        }));
}

function normalizeFinancialRecoveryDrillSection(summary = {}) {
    const findings = normalizeFindingList(summary.findings);
    const advisories = normalizeFindingList(summary.advisories);
    const ok = summary.ok === true;
    const configuredLayers = Array.isArray(summary.configured_recovery_layers)
        ? summary.configured_recovery_layers.map((item) => normalizeText(item, 80)).filter(Boolean)
        : [];

    return {
        key: 'financial_recovery_drill',
        label: '恢复演练',
        ok,
        status: ok ? 'ready' : 'needs_attention',
        tone: getSectionTone(ok, findings.length, advisories.length),
        runtime_dependency: normalizeText(summary.runtime_dependency, 80) || 'none',
        checked_at: normalizeText(summary.checked_at, 80),
        summary_text: ok
            ? '演练脚本、审计视图和降级规则已就位。'
            : '恢复演练 readiness 发现需要处理的问题。',
        configured_recovery_layers: configuredLayers,
        finding_count: findings.length,
        advisory_count: advisories.length,
        findings,
        advisories
    };
}

function normalizePaymentRecoverySection(summary = {}) {
    const findings = normalizeFindingList(summary.findings);
    const capabilities = Object.values(summary.capabilities || {});
    const relations = Object.values(summary.recovery_audit_relations || {});
    const ok = summary.ok === true;
    const availableRpcCount = capabilities.filter((item) => item?.available === true).length;
    const availableRelationCount = relations.filter((item) => item?.available === true).length;

    return {
        key: 'payment_recovery_live',
        label: '支付积分库存链路',
        ok,
        status: ok ? 'ready' : 'needs_attention',
        tone: getSectionTone(ok, findings.length, 0),
        runtime_dependency: 'none',
        checked_at: normalizeText(summary.checked_at, 80),
        project_host: normalizeText(summary.project_host, 160),
        summary_text: ok
            ? `关键 RPC ${availableRpcCount}/${capabilities.length}、审计视图 ${availableRelationCount}/${relations.length} 可用。`
            : '关键 RPC 或恢复审计视图存在缺口，请按 findings 补 migration / 权限。',
        available_rpc_count: availableRpcCount,
        total_rpc_count: capabilities.length,
        available_relation_count: availableRelationCount,
        total_relation_count: relations.length,
        findings,
        advisories: []
    };
}

function normalizeExternalMonitoringSection(summary = {}) {
    const findings = normalizeFindingList(summary.findings);
    const configuredProviders = Array.isArray(summary.configured_providers)
        ? summary.configured_providers.map((item) => normalizeText(item, 80)).filter(Boolean)
        : [];
    const ok = summary.ok === true;
    const optional = summary.optional === true;

    return {
        key: 'external_monitoring',
        label: '外部监控',
        ok,
        status: ok ? (optional ? 'optional_not_configured' : 'ready') : 'needs_attention',
        tone: ok ? (optional ? 'neutral' : 'success') : 'warning',
        runtime_dependency: 'none',
        checked_at: normalizeText(summary.checked_at, 80),
        summary_text: optional
            ? '外部监控未配置，站内告警继续可用。'
            : `已配置 ${configuredProviders.length} 个外部监控通道。`,
        configured_providers: configuredProviders,
        finding_count: findings.length,
        findings,
        advisories: optional
            ? [{
                severity: 'info',
                key: 'external_monitoring_optional',
                message: 'Sentry / Axiom / Datadog / Log Drain 都是可选增强，不影响生产主链路。'
            }]
            : []
    };
}

function buildProFallbackSection(sections = []) {
    const degradedCount = sections.filter((section) => (
        section?.status === 'unavailable_fallback'
        || section?.status === 'optional_not_configured'
    )).length;

    return {
        key: 'pro_fallback',
        label: 'Pro 到期降级',
        ok: true,
        status: 'ready',
        tone: degradedCount > 0 ? 'warning' : 'success',
        runtime_dependency: 'none',
        summary_text: 'Realtime / PITR / 外部监控都按可选能力处理，缺失时回到现有读取、轮询和站内告警逻辑。',
        finding_count: 0,
        advisory_count: degradedCount,
        findings: [],
        advisories: [{
            severity: 'info',
            key: 'supabase_pro_fallback',
            message: 'Pro/PITR 不存在时会失去恢复便利性，但不应阻断前台、支付、钱包、订单或 Admin Studio。'
        }]
    };
}

function buildReadinessTimeoutError(label = 'Readiness', timeoutMs = 0) {
    const error = new Error(`${label} 检查超过 ${timeoutMs}ms，已切换为降级可用。`);
    error.code = 'readiness_check_timeout';
    return error;
}

async function runWithReadinessTimeout(label, task, timeoutMs = DEFAULT_READINESS_CHECK_TIMEOUT_MS) {
    const normalizedTimeoutMs = Math.max(0, Number(timeoutMs || 0));
    if (normalizedTimeoutMs <= 0) {
        return task();
    }

    let timeoutId = 0;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(buildReadinessTimeoutError(label, normalizedTimeoutMs));
        }, normalizedTimeoutMs);
    });

    try {
        return await Promise.race([
            Promise.resolve().then(task),
            timeoutPromise
        ]);
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}

async function runOptionalCheck(key, label, task, options = {}) {
    try {
        return await runWithReadinessTimeout(label, task, options.timeoutMs);
    } catch (error) {
        return buildUnavailableSection(key, label, error);
    }
}

async function buildRecoveryReadinessPayload({
    env = process.env,
    now = new Date(),
    defaultTimeoutMs = DEFAULT_READINESS_CHECK_TIMEOUT_MS,
    paymentTimeoutMs = PAYMENT_READINESS_CHECK_TIMEOUT_MS
} = {}) {
    const [financialRecoveryDrill, paymentRecoveryLive, externalMonitoring] = await Promise.all([
        runOptionalCheck('financial_recovery_drill', '恢复演练', () => normalizeFinancialRecoveryDrillSection(
            runFinancialRecoveryDrillReadiness({ env })
        ), { timeoutMs: defaultTimeoutMs }),
        runOptionalCheck('payment_recovery_live', '支付积分库存链路', async () => normalizePaymentRecoverySection(
            await runPaymentRecoveryReadinessGate({ envFile: '' })
        ), { timeoutMs: paymentTimeoutMs }),
        runOptionalCheck('external_monitoring', '外部监控', () => normalizeExternalMonitoringSection(
            runExternalMonitoringReadiness({ env })
        ), { timeoutMs: defaultTimeoutMs })
    ]);
    const sections = [
        financialRecoveryDrill,
        paymentRecoveryLive,
        externalMonitoring
    ];
    const fallbackSection = buildProFallbackSection(sections);
    const allSections = [
        fallbackSection,
        ...sections
    ];
    const blockingFindings = allSections.reduce((sum, section) => (
        sum + (section.ok === true ? 0 : 1)
    ), 0);

    return {
        success: true,
        fetched_at: now instanceof Date && Number.isFinite(now.getTime())
            ? now.toISOString()
            : new Date().toISOString(),
        runtime_dependency: 'none',
        pro_fallback: true,
        status: blockingFindings > 0 ? 'needs_attention' : 'ready',
        summary: {
            section_count: allSections.length,
            blocking_finding_count: blockingFindings,
            advisory_count: allSections.reduce((sum, section) => sum + Number(section.advisory_count || section.advisories?.length || 0), 0)
        },
        sections: allSections
    };
}

module.exports = async (req, res) => {
    try {
        const accessRequirement = String(req.method || '').toUpperCase() === 'GET'
            ? { anyOf: ['settings.manage', 'ops_alerts.manage', 'analytics.view', 'payments.manage'] }
            : { permission: 'settings.manage' };
        await requireAdmin(req, accessRequirement);

        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        return sendJson(res, 200, await buildRecoveryReadinessPayload());
    } catch (error) {
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Recovery readiness settings failed'
        });
    }
};

module.exports._private = {
    DEFAULT_READINESS_CHECK_TIMEOUT_MS,
    PAYMENT_READINESS_CHECK_TIMEOUT_MS,
    buildRecoveryReadinessPayload,
    buildProFallbackSection,
    buildReadinessTimeoutError,
    buildUnavailableSection,
    normalizeExternalMonitoringSection,
    normalizeFinancialRecoveryDrillSection,
    normalizePaymentRecoverySection
};
