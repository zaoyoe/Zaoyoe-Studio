const crypto = require('crypto');
const {
    notifyActiveAdmins
} = require('./admin-notifications');
const {
    enqueueOpsAlertJob
} = require('./ops-alerts');
const {
    SUPPORTED_SITES
} = require('./site');
const {
    _private: recoveryReadiness
} = require('../../server/api-handlers/admin/settings/recovery-readiness');

const ALERT_TYPE = 'recovery_readiness_degraded';
const SOURCE_MODULE = 'recovery_readiness_sweep';
const DEFAULT_DEDUPE_WINDOW_MINUTES = 6 * 60;
const MAX_ISSUES_IN_MESSAGE = 6;

function normalizeText(value = '', maxLength = 1000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeSeverity(value = '') {
    const normalized = normalizeText(value, 40).toLowerCase();
    if (['critical', 'fatal'].includes(normalized)) return 'critical';
    if (['error', 'danger', 'high'].includes(normalized)) return 'error';
    if (['warn', 'warning', 'medium'].includes(normalized)) return 'warning';
    if (['success', 'ok'].includes(normalized)) return 'info';
    return normalized || 'info';
}

function compareSeverity(left = 'info', right = 'info') {
    const rank = {
        info: 0,
        warning: 1,
        error: 2,
        critical: 3
    };
    return (rank[normalizeSeverity(left)] || 0) - (rank[normalizeSeverity(right)] || 0);
}

function getWorstSeverity(items = []) {
    return (Array.isArray(items) ? items : []).reduce((worst, item) => (
        compareSeverity(item?.severity, worst) > 0 ? normalizeSeverity(item.severity) : worst
    ), 'info');
}

function shouldIgnoreSection(section = {}) {
    if (!section || typeof section !== 'object') return true;
    if (section.key === 'pro_fallback') return true;
    if (section.key === 'external_monitoring' && section.status === 'optional_not_configured') return true;
    return false;
}

function buildSectionIssue(section = {}) {
    const findings = Array.isArray(section.findings) ? section.findings.filter(Boolean) : [];
    const hasProblem = section.ok !== true
        || section.status === 'needs_attention'
        || section.status === 'unavailable_fallback'
        || findings.length > 0;

    if (!hasProblem || shouldIgnoreSection(section)) {
        return null;
    }

    const findingSeverity = getWorstSeverity(findings);
    const sectionSeverity = section.key === 'payment_recovery_live' && section.ok !== true
        ? 'critical'
        : normalizeSeverity(findingSeverity === 'info' ? 'warning' : findingSeverity);
    const firstFinding = findings[0] || {};
    const label = normalizeText(section.label || section.key, 120);
    const status = normalizeText(section.status || 'needs_attention', 80);
    const message = normalizeText(
        firstFinding.message
        || section.summary_text
        || section.message
        || `${label} 需要关注。`,
        500
    );

    return {
        key: normalizeText(firstFinding.key || `${section.key}:${status}`, 180),
        section_key: normalizeText(section.key, 120),
        label,
        status,
        severity: sectionSeverity,
        message,
        finding_count: findings.length || Number(section.finding_count || 0) || 0
    };
}

function collectRecoveryReadinessIssues(sections = []) {
    return (Array.isArray(sections) ? sections : [])
        .map(buildSectionIssue)
        .filter(Boolean);
}

function buildIssueHash(issues = []) {
    return crypto
        .createHash('sha256')
        .update((issues || [])
            .map((issue) => `${issue.section_key}:${issue.key}:${issue.status}:${issue.severity}`)
            .sort()
            .join('|'))
        .digest('hex')
        .slice(0, 16);
}

function getIsoDateBucket(now = new Date()) {
    const date = now instanceof Date ? now : new Date(now);
    const safeDate = Number.isFinite(date.getTime()) ? date : new Date();
    return safeDate.toISOString().slice(0, 10);
}

function buildReadinessAlert(issues = [], readinessPayload = {}, options = {}) {
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    const issueCount = issues.length;
    const worstSeverity = getWorstSeverity(issues);
    const severity = worstSeverity === 'critical' || worstSeverity === 'error'
        ? 'critical'
        : 'warning';
    const shownIssues = issues.slice(0, MAX_ISSUES_IN_MESSAGE);
    const hiddenCount = Math.max(0, issueCount - shownIssues.length);
    const issueLines = shownIssues.map((issue) => (
        `- ${issue.label}: ${issue.message}`
    ));
    if (hiddenCount > 0) {
        issueLines.push(`- 另有 ${hiddenCount} 项未展开，请进入 Admin Studio 查看。`);
    }

    return {
        alertType: ALERT_TYPE,
        severity,
        title: '恢复 readiness 需要关注',
        content: [
            `恢复 readiness 巡检发现 ${issueCount} 项需要关注。`,
            ...issueLines,
            '生产主链路已按 fail-open 策略保留原有读取、轮询和站内告警逻辑。'
        ].join('\n'),
        dedupeKey: `recovery-readiness:${getIsoDateBucket(now)}:${buildIssueHash(issues)}`,
        dedupeWindowMinutes: DEFAULT_DEDUPE_WINDOW_MINUTES,
        payload: {
            issue_count: issueCount,
            issues,
            readiness_status: normalizeText(readinessPayload.status, 80) || 'unknown',
            checked_at: normalizeText(readinessPayload.fetched_at, 80) || now.toISOString(),
            runtime_dependency: 'none',
            pro_fallback: true,
            sections: (Array.isArray(readinessPayload.sections) ? readinessPayload.sections : []).map((section) => ({
                key: normalizeText(section.key, 120),
                status: normalizeText(section.status, 80),
                ok: section.ok === true,
                tone: normalizeText(section.tone, 40),
                finding_count: Number(section.finding_count || section.findings?.length || 0) || 0,
                advisory_count: Number(section.advisory_count || section.advisories?.length || 0) || 0
            }))
        }
    };
}

async function safeQueueOpsAlert(supabase, alert, options = {}) {
    if (!supabase?.from) {
        return {
            queued: false,
            reason: 'supabase_unavailable'
        };
    }

    try {
        return await enqueueOpsAlertJob(supabase, {
            ...alert,
            source: SOURCE_MODULE
        }, {
            env: options.env,
            now: options.now,
            skipSummary: true
        });
    } catch (error) {
        return {
            queued: false,
            reason: 'failed',
            message: normalizeText(error?.message || error, 500)
        };
    }
}

async function safeNotifyAdminsForSite(supabase, alert, site) {
    try {
        return await notifyActiveAdmins(supabase, {
            site,
            title: alert.title,
            content: alert.content,
            type: 'alert',
            category: 'admin_notice',
            actionUrl: '/admin-studio.html',
            actionLabel: '查看 readiness',
            priority: alert.severity === 'critical' ? 3 : 2,
            metadata: {
                site,
                source: SOURCE_MODULE,
                alert_type: alert.alertType,
                severity: alert.severity,
                issue_count: alert.payload.issue_count,
                issues: alert.payload.issues,
                runtime_dependency: 'none',
                pro_fallback: true
            },
            dedupeKey: `${alert.dedupeKey}:${site}`,
            sourceModule: SOURCE_MODULE,
            sourceEventId: alert.dedupeKey,
            dedupeWindowMinutes: alert.dedupeWindowMinutes
        });
    } catch (error) {
        return {
            recipients: 0,
            created: 0,
            skipped: 0,
            failed: true,
            message: normalizeText(error?.message || error, 500)
        };
    }
}

async function safeNotifyAdmins(supabase, alert) {
    const results = [];
    for (const site of SUPPORTED_SITES) {
        results.push({
            site,
            result: await safeNotifyAdminsForSite(supabase, alert, site)
        });
    }

    return {
        sites: results,
        recipients: results.reduce((sum, entry) => sum + Number(entry.result?.recipients || 0), 0),
        created: results.reduce((sum, entry) => sum + Number(entry.result?.created || 0), 0),
        skipped: results.reduce((sum, entry) => sum + Number(entry.result?.skipped || 0), 0),
        failed: results.some((entry) => entry.result?.failed === true)
    };
}

function buildSweepFallbackPayload(error = null, now = new Date()) {
    const checkedAt = now instanceof Date && Number.isFinite(now.getTime())
        ? now.toISOString()
        : new Date().toISOString();
    return {
        success: true,
        fetched_at: checkedAt,
        runtime_dependency: 'none',
        pro_fallback: true,
        status: 'ready',
        summary: {
            section_count: 1,
            blocking_finding_count: 0,
            advisory_count: 1
        },
        sections: [{
            key: 'recovery_readiness_sweep',
            label: '恢复 readiness 巡检',
            ok: true,
            status: 'unavailable_fallback',
            tone: 'warning',
            runtime_dependency: 'none',
            summary_text: '恢复 readiness 巡检暂时不可用，生产继续使用原有读取、轮询和站内告警逻辑。',
            message: normalizeText(error?.message || error || 'Recovery readiness sweep unavailable', 500),
            findings: [],
            advisories: [{
                severity: 'info',
                key: 'recovery_readiness_sweep_fallback',
                message: '巡检失败不会阻断前台、支付、钱包、订单或 Admin Studio。'
            }]
        }]
    };
}

async function runRecoveryReadinessSweep(supabase, options = {}) {
    const env = options.env || process.env;
    const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
    let readinessPayload;
    try {
        readinessPayload = await recoveryReadiness.buildRecoveryReadinessPayload({
            env,
            now
        });
    } catch (error) {
        readinessPayload = buildSweepFallbackPayload(error, now);
    }

    const issues = collectRecoveryReadinessIssues(readinessPayload.sections);
    if (!issues.length) {
        return {
            success: true,
            status: 'ready',
            checked_at: readinessPayload.fetched_at || now.toISOString(),
            runtime_dependency: 'none',
            pro_fallback: true,
            issue_count: 0,
            issues: [],
            readiness: readinessPayload,
            ops_alert: {
                queued: false,
                reason: 'no_issues'
            },
            admin_notifications: {
                recipients: 0,
                created: 0,
                skipped: 0,
                reason: 'no_issues'
            }
        };
    }

    const alert = buildReadinessAlert(issues, readinessPayload, { now });
    const opsAlert = await safeQueueOpsAlert(supabase, alert, { env, now });
    const adminNotifications = supabase
        ? await safeNotifyAdmins(supabase, alert)
        : {
            recipients: 0,
            created: 0,
            skipped: 0,
            failed: false,
            reason: 'supabase_unavailable'
        };

    return {
        success: true,
        status: 'needs_attention',
        checked_at: readinessPayload.fetched_at || now.toISOString(),
        runtime_dependency: 'none',
        pro_fallback: true,
        issue_count: issues.length,
        issues,
        readiness: readinessPayload,
        ops_alert: opsAlert,
        admin_notifications: adminNotifications
    };
}

module.exports = {
    ALERT_TYPE,
    SOURCE_MODULE,
    buildIssueHash,
    buildReadinessAlert,
    collectRecoveryReadinessIssues,
    runRecoveryReadinessSweep,
    __testUtils: {
        buildSectionIssue,
        buildSweepFallbackPayload,
        getWorstSeverity,
        normalizeSeverity,
        shouldIgnoreSection
    }
};
