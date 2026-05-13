const {
    buildOpsAlertCaseKey,
    fetchOpsAlertCaseEventsByTargets,
    getOpsAlertCaseEventActionLabel,
    isMissingTableAccessError,
    mapCaseLastActionToEventAction,
    resolveOpsAlertCaseSite
} = require('./_ops-alert-case-events');

const OPS_ALERT_CASES_SELECT_FIELDS = 'site, category_key, target_id, alert_type, status, owner_admin_id, owner_label, note, resolution, metadata, last_action, last_action_at, updated_at';
const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_MAX_PAGES = 5;
const OPS_ALERT_TARGET_CHUNK_SIZE = 50;

function normalizeText(value, maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizePayload(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}

function chunkValues(values = [], chunkSize = OPS_ALERT_TARGET_CHUNK_SIZE) {
    const normalizedValues = Array.isArray(values) ? values : [];
    const normalizedChunkSize = Math.max(1, Number(chunkSize) || OPS_ALERT_TARGET_CHUNK_SIZE);
    const chunks = [];

    for (let index = 0; index < normalizedValues.length; index += normalizedChunkSize) {
        chunks.push(normalizedValues.slice(index, index + normalizedChunkSize));
    }

    return chunks;
}

function buildOpsAlertCaseRecord(row = {}, categoryKeyFallback = '') {
    return {
        site: resolveOpsAlertCaseSite(row, 'cn'),
        category_key: normalizeText(row.category_key, 80).toLowerCase() || normalizeText(categoryKeyFallback, 80).toLowerCase() || null,
        target_id: normalizeText(row.target_id, 200) || null,
        alert_type: normalizeText(row.alert_type, 120).toLowerCase() || null,
        status: normalizeText(row.status, 40).toLowerCase() || 'open',
        owner_admin_id: normalizeText(row.owner_admin_id, 160) || null,
        owner_label: normalizeText(row.owner_label, 255) || null,
        note: normalizeText(row.note, 2000) || null,
        resolution: normalizeText(row.resolution, 2000) || null,
        metadata: normalizePayload(row.metadata),
        last_action: normalizeText(row.last_action, 80).toLowerCase() || 'opened',
        last_action_at: normalizeText(row.last_action_at, 80) || null,
        updated_at: normalizeText(row.updated_at, 80) || null
    };
}

function buildOpsAlertCaseEventView(event = {}) {
    return {
        id: normalizeText(event.id, 160) || null,
        action: normalizeText(event.action, 80).toLowerCase() || null,
        action_label: normalizeText(event.action_label, 120) || null,
        summary: normalizeText(event.summary, 2000) || null,
        status: normalizeText(event.status, 40).toLowerCase() || null,
        owner_admin_id: normalizeText(event.owner_admin_id, 160) || null,
        owner_label: normalizeText(event.owner_label, 255) || null,
        actor_admin_id: normalizeText(event.actor_admin_id, 160) || null,
        actor_label: normalizeText(event.actor_label, 255) || null,
        note: normalizeText(event.note, 2000) || null,
        resolution: normalizeText(event.resolution, 2000) || null,
        metadata: normalizePayload(event.metadata),
        created_at: normalizeText(event.created_at, 80) || null
    };
}

function buildFallbackOpsAlertCaseEvent(caseRecord = {}) {
    const fallbackCreatedAt = normalizeText(caseRecord?.last_action_at, 80) || normalizeText(caseRecord?.updated_at, 80);
    const mappedAction = mapCaseLastActionToEventAction(caseRecord?.last_action);
    if (!mappedAction && !fallbackCreatedAt) {
        return null;
    }

    const resolution = normalizeText(caseRecord?.resolution, 2000) || null;
    const note = normalizeText(caseRecord?.note, 2000) || null;
    const ownerLabel = normalizeText(caseRecord?.owner_label, 255) || null;
    let summary = '';

    if (mappedAction === 'resolve' && resolution) {
        summary = resolution;
    } else if (note) {
        summary = note;
    } else if (ownerLabel && ['claim', 'assign'].includes(mappedAction)) {
        summary = `负责人 ${ownerLabel}`;
    }

    return {
        id: null,
        site: resolveOpsAlertCaseSite(caseRecord, 'cn'),
        category_key: normalizeText(caseRecord?.category_key, 80).toLowerCase() || null,
        target_id: normalizeText(caseRecord?.target_id, 200) || null,
        alert_type: normalizeText(caseRecord?.alert_type, 120).toLowerCase() || null,
        action: mappedAction || null,
        action_label: getOpsAlertCaseEventActionLabel(mappedAction),
        summary: summary || null,
        status: normalizeText(caseRecord?.status, 40).toLowerCase() || null,
        owner_admin_id: normalizeText(caseRecord?.owner_admin_id, 160) || null,
        owner_label: ownerLabel,
        actor_admin_id: normalizeText(caseRecord?.last_action_by, 160) || null,
        actor_label: null,
        note,
        resolution,
        metadata: normalizePayload(caseRecord?.metadata),
        created_at: fallbackCreatedAt || null
    };
}

async function fetchPagedRows(buildQuery, pageSize = DEFAULT_PAGE_SIZE, maxPages = DEFAULT_MAX_PAGES) {
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

async function fetchOpsAlertCasesByTargets(supabase, targets = []) {
    const normalizedTargets = Array.from(new Map(
        (Array.isArray(targets) ? targets : [])
            .map((item) => ({
                site: resolveOpsAlertCaseSite(item, 'cn'),
                category_key: normalizeText(item?.category_key || item?.categoryKey, 80).toLowerCase(),
                target_id: normalizeText(item?.target_id || item?.targetId, 200)
            }))
            .filter((item) => item.category_key && item.target_id)
            .map((item) => [buildOpsAlertCaseKey(item.category_key, item.target_id, item.site), item])
    ).values());

    if (!normalizedTargets.length) {
        return new Map();
    }

    const groupedTargets = normalizedTargets.reduce((accumulator, item) => {
        const groupKey = buildOpsAlertCaseKey(item.category_key, '', item.site);
        if (!accumulator.has(groupKey)) {
            accumulator.set(groupKey, {
                site: item.site,
                category_key: item.category_key,
                target_ids: []
            });
        }
        accumulator.get(groupKey).target_ids.push(item.target_id);
        return accumulator;
    }, new Map());

    const caseMap = new Map();

    try {
        for (const group of groupedTargets.values()) {
            const uniqueTargetIds = Array.from(new Set(group.target_ids));
            for (const targetChunk of chunkValues(uniqueTargetIds)) {
                const rows = await fetchPagedRows(() => supabase
                    .from('ops_alert_cases')
                    .select(OPS_ALERT_CASES_SELECT_FIELDS)
                    .in('site', [group.site])
                    .in('category_key', [group.category_key])
                    .in('target_id', targetChunk)
                    .order('updated_at', { ascending: false }), Math.max(targetChunk.length, 1), 1);

                rows.forEach((row) => {
                    const caseRecord = buildOpsAlertCaseRecord(row, group.category_key);
                    caseMap.set(
                        buildOpsAlertCaseKey(caseRecord.category_key, caseRecord.target_id, caseRecord.site),
                        caseRecord
                    );
                });
            }
        }

        return caseMap;
    } catch (error) {
        if (!isMissingTableAccessError(error, 'ops_alert_cases')) {
            throw error;
        }
    }

    return caseMap;
}

function buildOpsAlertItemCaseState(categoryKey = '', targetId = '', caseRecord = null, caseEventsByKey = new Map(), options = {}) {
    const normalizedCategoryKey = normalizeText(categoryKey, 80).toLowerCase();
    const normalizedTargetId = normalizeText(targetId, 200);
    const normalizedSite = resolveOpsAlertCaseSite({
        ...caseRecord,
        site: options.site || caseRecord?.site,
        target_id: normalizedTargetId || caseRecord?.target_id
    }, 'cn');
    const caseKey = buildOpsAlertCaseKey(normalizedCategoryKey, normalizedTargetId, normalizedSite);
    const eventLimit = Number.isFinite(Number(options.eventLimit)) && Number(options.eventLimit) > 0
        ? Number(options.eventLimit)
        : 3;
    const rawEvents = caseEventsByKey instanceof Map ? caseEventsByKey.get(caseKey) : null;
    const timeline = Array.isArray(rawEvents) && rawEvents.length
        ? rawEvents.map((event) => buildOpsAlertCaseEventView(event)).slice(0, eventLimit)
        : [];
    const fallbackEvent = timeline.length ? null : buildFallbackOpsAlertCaseEvent({
        ...caseRecord,
        site: normalizedSite,
        category_key: normalizedCategoryKey || caseRecord?.category_key,
        target_id: normalizedTargetId || caseRecord?.target_id
    });
    const recentEvents = timeline.length
        ? timeline
        : (fallbackEvent ? [buildOpsAlertCaseEventView(fallbackEvent)] : []);
    const latestEvent = recentEvents[0] || null;
    const latestNoteEvent = recentEvents.find((event) => normalizeText(event?.note, 2000));

    return {
        case_site: normalizedSite,
        case_status: normalizeText(caseRecord?.status || latestEvent?.status, 40).toLowerCase() || 'open',
        case_owner_admin_id: normalizeText(caseRecord?.owner_admin_id || latestEvent?.owner_admin_id, 160) || null,
        case_owner_label: normalizeText(caseRecord?.owner_label || latestEvent?.owner_label, 255) || null,
        case_note: normalizeText(caseRecord?.note, 2000) || null,
        case_resolution: normalizeText(caseRecord?.resolution, 2000) || null,
        case_last_action: normalizeText(caseRecord?.last_action, 80).toLowerCase()
            || normalizeText(latestEvent?.action, 80).toLowerCase()
            || null,
        case_last_action_at: normalizeText(caseRecord?.last_action_at, 80)
            || normalizeText(latestEvent?.created_at, 80)
            || null,
        case_updated_at: normalizeText(caseRecord?.updated_at, 80) || null,
        case_recent_note: normalizeText(latestNoteEvent?.note, 2000) || null,
        case_recent_note_at: normalizeText(latestNoteEvent?.created_at, 80) || null,
        case_latest_event_action: normalizeText(latestEvent?.action, 80).toLowerCase() || null,
        case_latest_event_label: normalizeText(latestEvent?.action_label, 120) || null,
        case_latest_event_summary: normalizeText(latestEvent?.summary, 2000) || null,
        case_latest_event_at: normalizeText(latestEvent?.created_at, 80) || null,
        case_latest_event_by_label: normalizeText(latestEvent?.actor_label, 255) || null,
        case_latest_event_owner_label: normalizeText(latestEvent?.owner_label, 255) || null,
        case_recent_events: recentEvents.map((event) => ({
            id: normalizeText(event.id, 160) || null,
            action: normalizeText(event.action, 80).toLowerCase() || null,
            action_label: normalizeText(event.action_label, 120) || null,
            summary: normalizeText(event.summary, 2000) || null,
            status: normalizeText(event.status, 40).toLowerCase() || null,
            owner_label: normalizeText(event.owner_label, 255) || null,
            actor_label: normalizeText(event.actor_label, 255) || null,
            note: normalizeText(event.note, 2000) || null,
            resolution: normalizeText(event.resolution, 2000) || null,
            created_at: normalizeText(event.created_at, 80) || null,
            metadata: normalizePayload(event.metadata)
        }))
    };
}

module.exports = {
    normalizeText,
    normalizePayload,
    buildOpsAlertCaseKey,
    buildOpsAlertCaseRecord,
    fetchOpsAlertCasesByTargets,
    fetchOpsAlertCaseEventsByTargets,
    buildOpsAlertItemCaseState
};
