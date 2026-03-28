const VALID_OPS_ALERT_CASE_EVENT_ACTIONS = Object.freeze([
    'claim',
    'assign',
    'add_note',
    'resolve',
    'reopen',
    'batch_mute'
]);

const OPS_ALERT_CASE_EVENT_SELECT_FIELDS = [
    'id',
    'category_key',
    'target_id',
    'alert_type',
    'action',
    'status',
    'owner_admin_id',
    'owner_label',
    'actor_admin_id',
    'actor_label',
    'note',
    'resolution',
    'metadata',
    'created_at'
].join(', ');

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

function buildOpsAlertCaseKey(categoryKey, targetId) {
    return `${normalizeCategoryKey(categoryKey, targetId)}::${sanitizeText(targetId, 200)}`;
}

function getOpsAlertCaseEventActionLabel(action) {
    const normalizedAction = sanitizeText(action, 80).toLowerCase();
    const labelMap = {
        claim: '认领处理',
        assign: '转交负责人',
        add_note: '记录备注',
        resolve: '关闭告警',
        reopen: '重新打开',
        batch_mute: '批量静默'
    };
    return labelMap[normalizedAction] || normalizedAction || '处置更新';
}

function buildOpsAlertCaseEventSummary(row = {}) {
    const action = sanitizeText(row.action, 80).toLowerCase();
    const metadata = normalizeJsonObject(row.metadata);
    const resolution = sanitizeText(row.resolution, 2000);
    const note = sanitizeText(row.note, 2000);
    const ownerLabel = sanitizeText(row.owner_label, 255);
    const muteUntil = sanitizeText(metadata.mute_until, 120);

    if (action === 'batch_mute' && muteUntil) {
        return `已静默至 ${muteUntil}`;
    }
    if (action === 'resolve' && resolution) {
        return resolution;
    }
    if (note) {
        return note;
    }
    if (['claim', 'assign'].includes(action) && ownerLabel) {
        return `负责人 ${ownerLabel}`;
    }
    return '';
}

function buildOpsAlertCaseEventRecord(row = {}) {
    const action = sanitizeText(row.action, 80).toLowerCase();
    const metadata = normalizeJsonObject(row.metadata);
    return {
        id: sanitizeText(row.id, 160) || null,
        category_key: normalizeCategoryKey(row.category_key, row.target_id) || null,
        target_id: sanitizeText(row.target_id, 200) || null,
        alert_type: sanitizeText(row.alert_type, 120).toLowerCase() || null,
        action,
        action_label: getOpsAlertCaseEventActionLabel(action),
        summary: buildOpsAlertCaseEventSummary(row) || null,
        status: sanitizeText(row.status, 40).toLowerCase() || null,
        owner_admin_id: sanitizeText(row.owner_admin_id, 160) || null,
        owner_label: sanitizeText(row.owner_label, 255) || null,
        actor_admin_id: sanitizeText(row.actor_admin_id, 160) || null,
        actor_label: sanitizeText(row.actor_label, 255) || null,
        note: sanitizeText(row.note, 2000) || null,
        resolution: sanitizeText(row.resolution, 2000) || null,
        metadata,
        created_at: sanitizeText(row.created_at, 80) || null
    };
}

function buildOpsAlertCaseEventPayload({ action, item = {}, record = {}, user = {}, note = '', resolution = '', metadata = {}, owner = {}, nowIso = '' }) {
    const normalizedAction = sanitizeText(action, 80).toLowerCase();
    const categoryKey = normalizeCategoryKey(item.category_key || record.category_key, item.target_id || record.target_id);
    const targetId = sanitizeText(item.target_id || record.target_id, 200);
    const existingMetadata = normalizeJsonObject(record.metadata);
    const itemMetadata = normalizeJsonObject(item.metadata);
    const requestMetadata = normalizeJsonObject(metadata);
    const ownerAdminId = sanitizeText(owner.owner_admin_id || record.owner_admin_id, 160) || null;
    const ownerLabel = sanitizeText(owner.owner_label || record.owner_label, 255) || null;
    const payloadMetadata = {
        ...existingMetadata,
        ...requestMetadata,
        ...itemMetadata
    };
    const alertType = sanitizeText(item.alert_type || record.alert_type || payloadMetadata.alert_type, 120).toLowerCase();
    const title = sanitizeText(item.title || payloadMetadata.title, 240);
    const referenceLabel = sanitizeText(item.reference_label || item.referenceLabel || payloadMetadata.reference_label, 120);
    const referenceValue = sanitizeText(item.reference_value || item.referenceValue || payloadMetadata.reference_value, 240);

    if (alertType) payloadMetadata.alert_type = alertType;
    if (title) payloadMetadata.title = title;
    if (referenceLabel) payloadMetadata.reference_label = referenceLabel;
    if (referenceValue) payloadMetadata.reference_value = referenceValue;

    return {
        category_key: categoryKey,
        target_id: targetId,
        alert_type: alertType || null,
        action: normalizedAction,
        status: sanitizeText(record.status || item.status, 40).toLowerCase() || null,
        owner_admin_id: ownerAdminId,
        owner_label: ownerLabel,
        actor_admin_id: sanitizeText(user.id, 160) || null,
        actor_label: buildOwnerLabel(user),
        note: sanitizeText(note, 4000) || null,
        resolution: sanitizeText(resolution, 4000) || null,
        metadata: payloadMetadata,
        created_at: sanitizeText(nowIso, 80) || new Date().toISOString()
    };
}

function normalizeOpsAlertCaseTargetItems(items = [], defaults = {}) {
    return (Array.isArray(items) ? items : [])
        .map((item) => ({
            category_key: normalizeCategoryKey(item?.category_key || item?.categoryKey || defaults.category_key || defaults.categoryKey, item?.target_id || item?.targetId),
            target_id: sanitizeText(item?.target_id || item?.targetId, 200),
            alert_type: sanitizeText(item?.alert_type || item?.alertType || defaults.alert_type || defaults.alertType, 120).toLowerCase(),
            title: sanitizeText(item?.title || defaults.title, 240),
            reference_label: sanitizeText(item?.reference_label || item?.referenceLabel || defaults.reference_label || defaults.referenceLabel, 120),
            reference_value: sanitizeText(item?.reference_value || item?.referenceValue || defaults.reference_value || defaults.referenceValue, 240),
            metadata: normalizeJsonObject(item?.metadata)
        }))
        .filter((item) => item.category_key && item.target_id);
}

function isMissingOpsAlertCaseEventsTableError(error) {
    const message = sanitizeText(error?.message || error?.details || error?.hint, 500).toLowerCase();
    return message.includes('ops_alert_case_events')
        && (
            message.includes('does not exist')
            || message.includes('undefined table')
            || message.includes('unexpected table access')
        );
}

function isMissingTableAccessError(error, tableName = '') {
    const normalizedTableName = sanitizeText(tableName, 120).toLowerCase();
    const message = sanitizeText(error?.message || error?.details || error?.hint, 500).toLowerCase();
    if (!normalizedTableName || !message.includes(normalizedTableName)) {
        return false;
    }

    return (
        message.includes('does not exist')
        || message.includes('undefined table')
        || message.includes('unexpected table access')
    );
}

async function insertOpsAlertCaseEvents(supabase, events = []) {
    const payload = (Array.isArray(events) ? events : [])
        .map((event) => buildOpsAlertCaseEventPayload(event))
        .filter((event) => (
            event.category_key
            && event.target_id
            && VALID_OPS_ALERT_CASE_EVENT_ACTIONS.includes(event.action)
        ));

    if (!supabase || !payload.length) {
        return [];
    }

    try {
        const { data, error } = await supabase
            .from('ops_alert_case_events')
            .insert(payload)
            .select(OPS_ALERT_CASE_EVENT_SELECT_FIELDS);

        if (error) {
            throw error;
        }

        return (Array.isArray(data) ? data : []).map((row) => buildOpsAlertCaseEventRecord(row));
    } catch (error) {
        if (isMissingOpsAlertCaseEventsTableError(error)) {
            return [];
        }
        throw error;
    }
}

async function fetchPagedRows(buildQuery, pageSize = 1000, maxPages = 10) {
    const rows = [];

    for (let page = 0; page < maxPages; page += 1) {
        const from = page * pageSize;
        const to = from + pageSize - 1;
        const { data, error } = await buildQuery().range(from, to);

        if (error) {
            throw error;
        }

        const batch = Array.isArray(data) ? data : [];
        rows.push(...batch);
        if (batch.length < pageSize) {
            break;
        }
    }

    return rows;
}

async function fetchOpsAlertCaseEventsByTargets(supabase, targets = []) {
    const normalizedTargets = Array.from(new Map(
        normalizeOpsAlertCaseTargetItems(targets)
            .map((item) => [buildOpsAlertCaseKey(item.category_key, item.target_id), item])
    ).values());

    if (!supabase || !normalizedTargets.length) {
        return new Map();
    }

    const groupedTargets = normalizedTargets.reduce((accumulator, item) => {
        if (!accumulator.has(item.category_key)) {
            accumulator.set(item.category_key, []);
        }
        accumulator.get(item.category_key).push(item.target_id);
        return accumulator;
    }, new Map());

    const eventMap = new Map();

    try {
        for (const [categoryKey, targetIds] of groupedTargets.entries()) {
            const rows = await fetchPagedRows(() => supabase
                .from('ops_alert_case_events')
                .select(OPS_ALERT_CASE_EVENT_SELECT_FIELDS)
                .in('category_key', [categoryKey])
                .in('target_id', Array.from(new Set(targetIds)))
                .order('created_at', { ascending: false }));

            rows.forEach((row) => {
                const eventRecord = buildOpsAlertCaseEventRecord(row);
                const eventKey = buildOpsAlertCaseKey(eventRecord.category_key, eventRecord.target_id);
                if (!eventMap.has(eventKey)) {
                    eventMap.set(eventKey, []);
                }
                eventMap.get(eventKey).push(eventRecord);
            });
        }
    } catch (error) {
        if (!isMissingOpsAlertCaseEventsTableError(error)) {
            throw error;
        }
    }

    return eventMap;
}

async function fetchAssignableOpsAlertAdmins({ supabase, adminSupabase, currentUserId = '' } = {}) {
    if (!supabase) {
        return [];
    }

    let roleRows = [];
    try {
        const { data, error } = await supabase
            .from('admin_roles')
            .select('user_id, role_name, expires_at');

        if (error) {
            throw error;
        }
        roleRows = Array.isArray(data) ? data : [];
    } catch (error) {
        if (isMissingTableAccessError(error, 'admin_roles')) {
            return [];
        }
        throw error;
    }

    const nowTime = Date.now();
    const activeRoleRows = roleRows
        .filter((row) => {
            const expiresAt = sanitizeText(row?.expires_at, 80);
            return !expiresAt || Date.parse(expiresAt) > nowTime;
        });

    const adminRoleMap = new Map();
    activeRoleRows.forEach((row) => {
        const userId = sanitizeText(row?.user_id, 160);
        if (!userId || adminRoleMap.has(userId)) {
            return;
        }
        adminRoleMap.set(userId, sanitizeText(row?.role_name, 80).toLowerCase() || 'admin');
    });

    const adminIds = Array.from(adminRoleMap.keys());
    if (!adminIds.length) {
        return [];
    }

    const profileMap = new Map();
    try {
        for (let index = 0; index < adminIds.length; index += 200) {
            const chunk = adminIds.slice(index, index + 200);
            const { data, error } = await supabase
                .from('profiles')
                .select('id, email, username, display_name, avatar_url')
                .in('id', chunk);

            if (error) {
                throw error;
            }

            (Array.isArray(data) ? data : []).forEach((row) => {
                const id = sanitizeText(row?.id, 160);
                if (!id) return;
                profileMap.set(id, {
                    id,
                    email: sanitizeText(row?.email, 255) || null,
                    username: sanitizeText(row?.username, 120) || null,
                    display_name: sanitizeText(row?.display_name, 120) || null,
                    avatar_url: sanitizeText(row?.avatar_url, 500) || null
                });
            });
        }
    } catch (error) {
        if (!isMissingTableAccessError(error, 'profiles')) {
            throw error;
        }
    }

    const authUserMap = new Map();
    if (adminSupabase?.auth?.admin?.listUsers) {
        for (let page = 1; page <= 20; page += 1) {
            const { data, error } = await adminSupabase.auth.admin.listUsers({
                page,
                perPage: 200
            });

            if (error) {
                break;
            }

            const users = Array.isArray(data?.users) ? data.users : [];
            users.forEach((user) => {
                const id = sanitizeText(user?.id, 160);
                if (!id || !adminRoleMap.has(id)) return;
                authUserMap.set(id, {
                    id,
                    email: sanitizeText(user?.email, 255) || null
                });
            });

            if (users.length < 200) {
                break;
            }
        }
    }

    return adminIds
        .map((adminId) => {
            const profile = profileMap.get(adminId) || {};
            const authUser = authUserMap.get(adminId) || {};
            const email = sanitizeText(authUser.email || profile.email, 255) || null;
            const displayName = sanitizeText(profile.display_name, 120)
                || sanitizeText(profile.username, 120)
                || email
                || adminId;
            return {
                id: adminId,
                email,
                display_name: sanitizeText(profile.display_name, 120) || null,
                username: sanitizeText(profile.username, 120) || null,
                avatar_url: sanitizeText(profile.avatar_url, 500) || null,
                role_name: adminRoleMap.get(adminId) || 'admin',
                label: displayName,
                is_current: adminId === sanitizeText(currentUserId, 160)
            };
        })
        .sort((left, right) => {
            if (left.is_current && !right.is_current) return -1;
            if (!left.is_current && right.is_current) return 1;
            if (left.role_name === 'super_admin' && right.role_name !== 'super_admin') return -1;
            if (left.role_name !== 'super_admin' && right.role_name === 'super_admin') return 1;
            return sanitizeText(left.email || left.label, 255).localeCompare(sanitizeText(right.email || right.label, 255));
        });
}

function mapCaseLastActionToEventAction(lastAction = '') {
    const normalizedAction = sanitizeText(lastAction, 80).toLowerCase();
    const actionMap = {
        claimed: 'claim',
        assigned: 'assign',
        noted: 'add_note',
        resolved: 'resolve',
        reopened: 'reopen'
    };
    return actionMap[normalizedAction] || '';
}

module.exports = {
    VALID_OPS_ALERT_CASE_EVENT_ACTIONS,
    sanitizeText,
    normalizeJsonObject,
    buildOwnerLabel,
    normalizeCategoryKey,
    buildOpsAlertCaseKey,
    getOpsAlertCaseEventActionLabel,
    buildOpsAlertCaseEventRecord,
    buildOpsAlertCaseEventPayload,
    normalizeOpsAlertCaseTargetItems,
    isMissingOpsAlertCaseEventsTableError,
    isMissingTableAccessError,
    insertOpsAlertCaseEvents,
    fetchOpsAlertCaseEventsByTargets,
    fetchAssignableOpsAlertAdmins,
    mapCaseLastActionToEventAction
};
