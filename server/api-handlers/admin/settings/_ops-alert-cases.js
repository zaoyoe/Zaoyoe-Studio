const {
    isMissingTableAccessError,
    normalizeOpsAlertCaseSite,
    resolveOpsAlertCaseSite
} = require('./_ops-alert-case-events');

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

function inferOpsAlertCategoryKey(alertType = '', targetId = '') {
    const normalizedTargetId = sanitizeText(targetId, 200).toLowerCase();
    if (normalizedTargetId.startsWith('shop_order_risk:')) {
        return 'shop_risk';
    }

    const normalizedAlertType = sanitizeText(alertType, 120).toLowerCase();
    const categoryMap = {
        customer_chat_message_received: 'customer_engagement',
        customer_chat_message_summary: 'customer_engagement',
        shop_purchase_succeeded: 'commerce',
        shop_purchase_summary: 'commerce',
        wallet_recharge_succeeded: 'commerce',
        wallet_recharge_summary: 'commerce',
        shop_inventory_summary: 'inventory',
        shop_inventory_low: 'inventory',
        shop_inventory_empty: 'inventory',
        shop_inventory_recovered: 'inventory',
        payment_gateway_summary: 'payments',
        payment_gateway_degraded: 'payments',
        payment_gateway_recovered: 'payments',
        payment_refund_ops: 'payments',
        payment_refund_alert: 'payments',
        payment_config_changed: 'payments',
        payment_config_recovered: 'payments',
        payment_config_incident: 'payments',
        payment_config_incident_recovered: 'payments',
        shop_order_risk_anomaly: 'shop_risk',
        shop_order_risk_recovered: 'shop_risk',
        verify_quota_summary: 'verify',
        verify_quota_low: 'verify',
        verify_service_disabled: 'verify',
        verify_failure_summary: 'verify',
        verify_failure_rate_spike: 'verify',
        verify_queue_summary: 'verify',
        verify_queue_backlog: 'verify',
        verify_incident_escalated: 'verify',
        verify_incident_recovered: 'verify',
        ticket_new: 'tickets',
        ticket_sla_summary: 'tickets',
        ticket_sla_overdue: 'tickets',
        ticket_sla_recovered: 'tickets',
        shop_order_delivery_summary: 'fulfillment',
        shop_order_delivery_failed: 'fulfillment',
        shop_order_delivery_recovered: 'fulfillment',
        shop_order_delivery_incident: 'fulfillment',
        shop_order_delivery_incident_recovered: 'fulfillment',
        security_admin_login_anomaly: 'security'
    };

    return categoryMap[normalizedAlertType] || '';
}

function buildCaseResponse(row = {}) {
    return {
        id: sanitizeText(row.id, 160) || null,
        site: resolveOpsAlertCaseSite(row, 'cn'),
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
        site: 'cn',
        category_key: 'shop_risk',
        alert_type: sanitizeText(data?.alert_type || data?.metadata?.alert_type, 120).toLowerCase() || null
    };
}

async function fetchExistingCase(supabase, categoryKey, targetId, site = 'cn') {
    const normalizedSite = normalizeOpsAlertCaseSite(site, 'cn');
    try {
        const { data, error } = await supabase
            .from('ops_alert_cases')
            .select('*')
            .eq('site', normalizedSite)
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
    nextMetadata.site = resolveOpsAlertCaseSite(item, resolveOpsAlertCaseSite(existingCase, 'cn'));

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
    const site = resolveOpsAlertCaseSite(item, resolveOpsAlertCaseSite(existingCase, 'cn'));
    const note = sanitizeText(options.note, 4000);
    const resolution = sanitizeText(options.resolution, 4000) || note;
    const requestMetadata = normalizeJsonObject(options.metadata);
    const user = options.user || {};
    const nowIso = options.nowIso || new Date().toISOString();
    const owner = resolveAssignedOwner(user, options.owner || {});

    const nextRecord = {
        site,
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
            .upsert({
                ...record,
                site: normalizeOpsAlertCaseSite(record.site, 'cn')
            }, { onConflict: 'site,category_key,target_id' })
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
            site: 'cn',
            category_key: 'shop_risk',
            alert_type: sanitizeText(record.alert_type || data?.alert_type || data?.metadata?.alert_type, 120).toLowerCase() || null
        };
    }
}

module.exports = {
    sanitizeText,
    normalizeJsonObject,
    buildOwnerLabel,
    normalizeCategoryKey,
    inferOpsAlertCategoryKey,
    buildCaseResponse,
    isMissingOpsAlertCasesTableError,
    fetchExistingCase,
    buildCaseMetadata,
    resolveAssignedOwner,
    applyCaseAction,
    persistCase
};
