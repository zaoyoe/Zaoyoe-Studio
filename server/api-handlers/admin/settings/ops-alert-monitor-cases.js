const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    insertOpsAlertCaseEvents,
    isMissingTableAccessError
} = require('./_ops-alert-case-events');

const VALID_ACTIONS = new Set(['claim', 'assign', 'add_note', 'resolve', 'reopen']);
const NOTE_REQUIRED_ACTIONS = new Set(['add_note', 'resolve']);

function sanitizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeJsonObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}

function buildOwnerLabel(user = {}) {
    return sanitizeText(user.email, 255) || sanitizeText(user.id, 160) || 'unknown';
}

function normalizeCategoryKey(value, targetId = '') {
    const normalized = sanitizeText(value, 80).toLowerCase();
    if (normalized) {
        return normalized;
    }

    if (sanitizeText(targetId, 200).toLowerCase().startsWith('shop_order_risk:')) {
        return 'shop_risk';
    }

    return '';
}

function buildCaseResponse(row = {}) {
    return {
        id: sanitizeText(row.id, 160) || null,
        category_key: sanitizeText(row.category_key, 80).toLowerCase() || null,
        target_id: sanitizeText(row.target_id, 200) || null,
        alert_type: sanitizeText(row.alert_type, 120).toLowerCase() || null,
        status: sanitizeText(row.status, 40).toLowerCase() || 'open',
        owner_admin_id: sanitizeText(row.owner_admin_id, 160) || null,
        owner_label: sanitizeText(row.owner_label, 255) || null,
        note: sanitizeText(row.note, 2000) || null,
        resolution: sanitizeText(row.resolution, 2000) || null,
        metadata: normalizeJsonObject(row.metadata),
        last_action: sanitizeText(row.last_action, 80).toLowerCase() || 'opened',
        last_action_by: sanitizeText(row.last_action_by, 160) || null,
        last_action_at: sanitizeText(row.last_action_at, 80) || null,
        created_at: sanitizeText(row.created_at, 80) || null,
        updated_at: sanitizeText(row.updated_at, 80) || null
    };
}

function isMissingOpsAlertCasesTableError(error) {
    return isMissingTableAccessError(error, 'ops_alert_cases');
}

async function fetchLegacyShopRiskCase(supabase, targetId) {
    const { data, error } = await supabase
        .from('shop_risk_cases')
        .select('*')
        .eq('target_id', targetId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    if (!data) {
        return null;
    }

    return {
        ...data,
        category_key: 'shop_risk',
        alert_type: sanitizeText(data?.alert_type || data?.metadata?.alert_type, 120).toLowerCase() || null
    };
}

async function fetchExistingCase(supabase, categoryKey, targetId) {
    try {
        const { data, error } = await supabase
            .from('ops_alert_cases')
            .select('*')
            .eq('category_key', categoryKey)
            .eq('target_id', targetId)
            .maybeSingle();

        if (error) {
            throw error;
        }

        return data || null;
    } catch (error) {
        if (categoryKey === 'shop_risk' && isMissingOpsAlertCasesTableError(error)) {
            return fetchLegacyShopRiskCase(supabase, targetId);
        }
        throw error;
    }
}

function buildCaseMetadata(existingCase = {}, item = {}, requestMetadata = {}) {
    const existingMetadata = normalizeJsonObject(existingCase?.metadata);
    const itemMetadata = normalizeJsonObject(item?.metadata);
    const nextMetadata = {
        ...existingMetadata,
        ...requestMetadata,
        ...itemMetadata
    };

    const alertType = sanitizeText(item.alert_type || requestMetadata.alert_type || existingCase?.alert_type, 120).toLowerCase();
    const title = sanitizeText(item.title || itemMetadata.title || requestMetadata.title || existingMetadata.title, 240);
    const referenceLabel = sanitizeText(
        item.reference_label || item.referenceLabel || itemMetadata.reference_label || requestMetadata.reference_label || existingMetadata.reference_label,
        120
    );
    const referenceValue = sanitizeText(
        item.reference_value || item.referenceValue || itemMetadata.reference_value || requestMetadata.reference_value || existingMetadata.reference_value,
        240
    );

    if (alertType) {
        nextMetadata.alert_type = alertType;
    }
    if (title) {
        nextMetadata.title = title;
    }
    if (referenceLabel) {
        nextMetadata.reference_label = referenceLabel;
    }
    if (referenceValue) {
        nextMetadata.reference_value = referenceValue;
    }

    return nextMetadata;
}

function resolveAssignedOwner(user = {}, ownerInput = {}) {
    const ownerLabel = sanitizeText(ownerInput.owner_label || ownerInput.ownerLabel, 255);
    const ownerAdminId = sanitizeText(ownerInput.owner_admin_id || ownerInput.ownerAdminId, 160);

    if (!ownerLabel && !ownerAdminId) {
        return {
            owner_admin_id: user.id,
            owner_label: buildOwnerLabel(user)
        };
    }

    return {
        owner_admin_id: ownerAdminId || null,
        owner_label: ownerLabel || buildOwnerLabel(user)
    };
}

function applyCaseAction(existingCase = null, action, item = {}, options = {}) {
    const categoryKey = normalizeCategoryKey(item.category_key || item.categoryKey, item.target_id || item.targetId);
    const targetId = sanitizeText(item.target_id || item.targetId, 200);
    const note = sanitizeText(options.note, 4000);
    const resolution = sanitizeText(options.resolution, 4000) || note;
    const requestMetadata = normalizeJsonObject(options.metadata);
    const user = options.user || {};
    const nowIso = options.nowIso || new Date().toISOString();
    const owner = resolveAssignedOwner(user, options.owner || {});

    const nextRecord = {
        category_key: categoryKey,
        target_id: targetId,
        alert_type: sanitizeText(item.alert_type || item.alertType || existingCase?.alert_type, 120).toLowerCase() || null,
        status: sanitizeText(existingCase?.status, 40).toLowerCase() || 'open',
        owner_admin_id: sanitizeText(existingCase?.owner_admin_id, 160) || null,
        owner_label: sanitizeText(existingCase?.owner_label, 255) || null,
        note: sanitizeText(existingCase?.note, 4000) || null,
        resolution: sanitizeText(existingCase?.resolution, 4000) || null,
        metadata: buildCaseMetadata(existingCase, item, requestMetadata),
        last_action: sanitizeText(existingCase?.last_action, 80).toLowerCase() || 'opened',
        last_action_by: sanitizeText(existingCase?.last_action_by, 160) || null,
        last_action_at: sanitizeText(existingCase?.last_action_at, 80) || nowIso
    };

    if (action === 'claim') {
        nextRecord.status = 'claimed';
        nextRecord.owner_admin_id = user.id;
        nextRecord.owner_label = buildOwnerLabel(user);
        if (note) {
            nextRecord.note = note;
        }
        nextRecord.last_action = 'claimed';
    } else if (action === 'assign') {
        nextRecord.status = 'claimed';
        nextRecord.owner_admin_id = owner.owner_admin_id;
        nextRecord.owner_label = owner.owner_label;
        if (note) {
            nextRecord.note = note;
        }
        nextRecord.last_action = 'assigned';
    } else if (action === 'add_note') {
        nextRecord.note = note;
        nextRecord.last_action = 'noted';
    } else if (action === 'resolve') {
        nextRecord.status = 'resolved';
        nextRecord.owner_admin_id = nextRecord.owner_admin_id || user.id;
        nextRecord.owner_label = nextRecord.owner_label || buildOwnerLabel(user);
        nextRecord.resolution = resolution;
        nextRecord.last_action = 'resolved';
    } else if (action === 'reopen') {
        nextRecord.status = 'open';
        nextRecord.last_action = 'reopened';
    }

    nextRecord.last_action_by = user.id;
    nextRecord.last_action_at = nowIso;

    return nextRecord;
}

async function persistCase(supabase, record = {}) {
    try {
        const { data, error } = await supabase
            .from('ops_alert_cases')
            .upsert(record, { onConflict: 'category_key,target_id' })
            .select('*')
            .single();

        if (error) {
            throw error;
        }

        return data;
    } catch (error) {
        if (record.category_key !== 'shop_risk' || !isMissingOpsAlertCasesTableError(error)) {
            throw error;
        }

        const legacyRecord = {
            target_id: sanitizeText(record.target_id, 200),
            status: sanitizeText(record.status, 40).toLowerCase() || 'open',
            owner_admin_id: sanitizeText(record.owner_admin_id, 160) || null,
            owner_label: sanitizeText(record.owner_label, 255) || null,
            note: sanitizeText(record.note, 4000) || null,
            resolution: sanitizeText(record.resolution, 4000) || null,
            metadata: normalizeJsonObject(record.metadata),
            last_action: sanitizeText(record.last_action, 80).toLowerCase() || 'opened',
            last_action_by: sanitizeText(record.last_action_by, 160) || null,
            last_action_at: sanitizeText(record.last_action_at, 80) || new Date().toISOString()
        };
        const { data, error: legacyError } = await supabase
            .from('shop_risk_cases')
            .upsert(legacyRecord, { onConflict: 'target_id' })
            .select('*')
            .single();

        if (legacyError) {
            throw legacyError;
        }

        return {
            ...data,
            category_key: 'shop_risk',
            alert_type: sanitizeText(record.alert_type || data?.alert_type || data?.metadata?.alert_type, 120).toLowerCase() || null
        };
    }
}

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
        const { supabase, user } = await requireAdmin(req);

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

        if (NOTE_REQUIRED_ACTIONS.has(action) && !note) {
            return sendJson(res, 400, {
                success: false,
                message: action === 'resolve' ? '关闭告警时需要填写处理结论' : '请先填写备注内容'
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
                resolution: action === 'resolve' ? resolution || null : null
            }
        });

        return sendJson(res, 200, {
            success: true,
            message: buildActionMessage(action, results, skipped.length),
            case: results[0],
            cases: results,
            summary: {
                processed_count: results.length,
                skipped_count: skipped.length
            }
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
