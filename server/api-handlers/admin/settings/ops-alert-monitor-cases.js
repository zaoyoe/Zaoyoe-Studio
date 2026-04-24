const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    notifyUsers
} = require('../../../../api/_lib/admin-notifications');
const {
    insertOpsAlertCaseEvents,
    isMissingTableAccessError
} = require('./_ops-alert-case-events');
const {
    sanitizeText,
    normalizeJsonObject,
    buildOwnerLabel,
    normalizeCategoryKey,
    buildCaseResponse,
    isMissingOpsAlertCasesTableError,
    fetchExistingCase,
    applyCaseAction,
    persistCase
} = require('./_ops-alert-cases');

const VALID_ACTIONS = new Set(['claim', 'assign', 'add_note', 'resolve', 'reopen']);

function buildActionMessage(action, results = [], skippedCount = 0) {
    const processedCount = Array.isArray(results) ? results.length : 0;
    const targetId = sanitizeText(results?.[0]?.target_id, 160) || '目标';
    const suffix = skippedCount > 0 ? `，跳过 ${skippedCount} 条无效记录` : '';

    if (processedCount > 1) {
        switch (action) {
        case 'claim':
        case 'assign':
            return `已批量指派 ${processedCount} 条集中告警${suffix}`;
        case 'add_note':
            return `已批量记录 ${processedCount} 条告警备注${suffix}`;
        case 'resolve':
            return `已批量关闭 ${processedCount} 条集中告警${suffix}`;
        case 'reopen':
            return `已批量重新打开 ${processedCount} 条集中告警${suffix}`;
        default:
            return `已批量更新 ${processedCount} 条集中告警${suffix}`;
        }
    }

    switch (action) {
    case 'claim':
    case 'assign':
        return `已指派负责人 ${targetId}`;
    case 'add_note':
        return `已记录处理备注 ${targetId}`;
    case 'resolve':
        return `已关闭集中告警 ${targetId}`;
    case 'reopen':
        return `已重新打开集中告警 ${targetId}`;
    default:
        return '集中告警案例已更新';
    }
}

function buildAuditActionType(categoryKey, action, isBatch = false) {
    const normalizedCategoryKey = sanitizeText(categoryKey, 80).toLowerCase();
    if (normalizedCategoryKey === 'shop_risk') {
        return isBatch
            ? `admin.shop_risk_case.batch.${action}`
            : `admin.shop_risk_case.${action}`;
    }
    return isBatch
        ? `admin.ops_alert_case.batch.${action}`
        : `admin.ops_alert_case.${action}`;
}

function getOpsAlertNotificationTargetLabel(item = {}) {
    const referenceLabel = sanitizeText(item.reference_label, 120);
    const referenceValue = sanitizeText(item.reference_value, 240);
    const title = sanitizeText(item.title, 240);
    const targetId = sanitizeText(item.target_id, 200);

    if (referenceLabel && referenceValue) {
        return `${referenceLabel}：${referenceValue}`;
    }
    return title || targetId || '站内代办';
}

function buildAssignmentNotificationPayload({
    actor = {},
    ownerInput = {},
    results = [],
    items = [],
    isBatch = false,
    skippedCount = 0
}) {
    const ownerAdminId = sanitizeText(ownerInput.owner_admin_id || ownerInput.ownerAdminId, 160);
    if (!ownerAdminId || ownerAdminId === sanitizeText(actor.id, 160)) {
        return null;
    }

    const ownerLabel = sanitizeText(ownerInput.owner_label || ownerInput.ownerLabel, 255) || ownerAdminId;
    const actorLabel = buildOwnerLabel(actor);
    const normalizedItems = Array.isArray(items) ? items : [];
    const processedCount = Array.isArray(results) ? results.length : 0;
    if (processedCount <= 0) {
        return null;
    }

    const preview = normalizedItems
        .slice(0, 3)
        .map((item) => getOpsAlertNotificationTargetLabel(item))
        .filter(Boolean);
    const overflowCount = Math.max(0, processedCount - preview.length);
    const title = isBatch || processedCount > 1 ? '站内代办已批量转交给你' : '站内代办已转交给你';
    const lines = [
        `${actorLabel} 刚刚给你转交了 ${processedCount} 条站内代办。`
    ];

    if (preview.length) {
        lines.push(`涉及对象：${preview.join(' / ')}${overflowCount > 0 ? ` 等 ${overflowCount} 条` : ''}`);
    }
    if (skippedCount > 0) {
        lines.push(`本次有 ${skippedCount} 条无效记录被跳过。`);
    }
    lines.push(`当前负责人：${ownerLabel}`);
    lines.push('处理入口：客服消息 -> 站内代办');

    return {
        userIds: [ownerAdminId],
        title,
        content: lines.join('\n'),
        type: 'info',
        scope: 'admin_personal',
        category: 'assignment',
        dedupeWindowMinutes: 10
    };
}

function normalizeRequestItems(body = {}) {
    const items = Array.isArray(body.items) ? body.items : null;

    if (items && items.length) {
        return items.map((item) => ({
            category_key: normalizeCategoryKey(item?.category_key || item?.categoryKey || body.category_key || body.categoryKey, item?.target_id || item?.targetId),
            target_id: sanitizeText(item?.target_id || item?.targetId, 200),
            alert_type: sanitizeText(item?.alert_type || item?.alertType || body.alert_type || body.alertType, 120).toLowerCase(),
            title: sanitizeText(item?.title, 240),
            reference_label: sanitizeText(item?.reference_label || item?.referenceLabel, 120),
            reference_value: sanitizeText(item?.reference_value || item?.referenceValue, 240),
            metadata: normalizeJsonObject(item?.metadata)
        })).filter((item) => item.category_key && item.target_id);
    }

    const categoryKey = normalizeCategoryKey(
        body.category_key || body.categoryKey || body?.metadata?.category,
        body.target_id || body.targetId
    );
    const targetId = sanitizeText(body.target_id || body.targetId, 200);

    if (!categoryKey || !targetId) {
        return [];
    }

    return [{
        category_key: categoryKey,
        target_id: targetId,
        alert_type: sanitizeText(body.alert_type || body.alertType || body?.metadata?.alert_type, 120).toLowerCase(),
        title: sanitizeText(body.title || body?.metadata?.title, 240),
        reference_label: sanitizeText(body?.metadata?.reference_label, 120),
        reference_value: sanitizeText(body?.metadata?.reference_value, 240),
        metadata: normalizeJsonObject(body.metadata)
    }];
}

module.exports = async (req, res) => {
    try {
        const { supabase, user } = await requireAdmin(req, { permission: 'ops_alerts.manage' });

        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const body = await parseJsonBody(req);
        const action = sanitizeText(body.action, 80).toLowerCase();
        const note = sanitizeText(body.note, 4000);
        const resolution = sanitizeText(body.resolution, 4000) || note;
        const metadata = normalizeJsonObject(body.metadata);
        const items = normalizeRequestItems(body);
        const isBatch = items.length > 1 || Array.isArray(body.items);

        if (!VALID_ACTIONS.has(action)) {
            return sendJson(res, 400, {
                success: false,
                message: '未识别的集中告警处理动作'
            });
        }

        if (!items.length) {
            return sendJson(res, 400, {
                success: false,
                message: '缺少集中告警标识'
            });
        }

        if (action === 'add_note' && !note) {
            return sendJson(res, 400, {
                success: false,
                message: '请先填写备注内容'
            });
        }

        if (action === 'resolve' && !resolution) {
            return sendJson(res, 400, {
                success: false,
                message: '关闭告警时需要填写处理结论'
            });
        }

        const results = [];
        const eventEntries = [];
        const skipped = [];
        const nowIso = new Date().toISOString();
        const ownerInput = {
            owner_label: body.owner_label || body.ownerLabel,
            owner_admin_id: body.owner_admin_id || body.ownerAdminId
        };

        for (const item of items) {
            const existingCase = await fetchExistingCase(supabase, item.category_key, item.target_id);

            if (!existingCase && action === 'reopen') {
                skipped.push({
                    ...item,
                    reason: 'missing_case'
                });
                continue;
            }

            const nextRecord = applyCaseAction(existingCase, action, item, {
                note,
                resolution,
                metadata,
                user,
                nowIso,
                owner: ownerInput
            });
            const persisted = await persistCase(supabase, nextRecord);
            eventEntries.push({
                action,
                item,
                record: persisted,
                user,
                note,
                resolution: action === 'resolve' ? resolution : '',
                metadata,
                owner: ownerInput,
                nowIso
            });
            results.push(buildCaseResponse(persisted));
        }

        if (!results.length) {
            return sendJson(res, 404, {
                success: false,
                message: action === 'reopen'
                    ? '所选告警尚未建立处置记录，无法重新打开'
                    : '没有可更新的集中告警记录'
            });
        }

        await insertOpsAlertCaseEvents(supabase, eventEntries);

        let assignmentNotification = {
            recipients: 0,
            created: 0,
            skipped: 0
        };
        if (action === 'assign') {
            const notificationPayload = buildAssignmentNotificationPayload({
                actor: user,
                ownerInput,
                results,
                items,
                isBatch,
                skippedCount: skipped.length
            });
            if (notificationPayload) {
                try {
                    assignmentNotification = await notifyUsers(supabase, notificationPayload);
                } catch (notificationError) {
                    console.warn('[AdminAPI] Failed to notify assigned ops alert owner:', notificationError.message || notificationError);
                }
            }
        }

        const primaryCategoryKey = results.length === 1
            ? sanitizeText(results[0].category_key, 80).toLowerCase()
            : 'all';

        await writeAdminAuditLog({
            supabase,
            adminId: user.id,
            actionType: buildAuditActionType(primaryCategoryKey, action, isBatch),
            details: {
                action,
                target_count: results.length,
                skipped_count: skipped.length,
                targets: results.map((item) => ({
                    category_key: item.category_key,
                    target_id: item.target_id,
                    alert_type: item.alert_type || null,
                    status: item.status,
                    owner_admin_id: item.owner_admin_id,
                    owner_label: item.owner_label
                })).slice(0, 50),
                note: ['claim', 'assign', 'add_note'].includes(action) ? note || null : null,
                resolution: action === 'resolve' ? resolution || null : null,
                assignment_notification_created: assignmentNotification.created || 0,
                assignment_notification_skipped: assignmentNotification.skipped || 0
            }
        });

        return sendJson(res, 200, {
            success: true,
            message: buildActionMessage(action, results, skipped.length),
            case: results[0],
            cases: results,
            summary: {
                processed_count: results.length,
                skipped_count: skipped.length,
                assignment_notification_created: assignmentNotification.created || 0,
                assignment_notification_skipped: assignmentNotification.skipped || 0
            },
            assignmentNotification
        });
    } catch (error) {
        if (isMissingOpsAlertCasesTableError(error)) {
            return sendJson(res, 503, {
                success: false,
                message: '集中告警处置表尚未完成迁移，请先执行最新数据库迁移后再试'
            });
        }
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Ops alert case action failed'
        });
    }
};
