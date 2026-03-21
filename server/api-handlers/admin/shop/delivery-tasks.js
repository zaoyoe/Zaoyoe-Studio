const {
    parseJsonBody,
    requireAdmin,
    sendJson,
    writeAdminAuditLog
} = require('../../../../api/_lib/admin');
const {
    loadShopDeliveryStrategyConfig,
    normalizeShopDeliveryStrategyConfig,
    upsertShopDeliveryStrategyConfig
} = require('../../../../api/_lib/payments/shop-delivery-strategy');

const SUMMARY_STATUSES = ['pending', 'processing', 'retry_waiting', 'requeued', 'dead_letter', 'delivered'];
const DEAD_LETTER_REASON_KEYS = new Set(['all', 'manual', 'missing_target', 'timeout', 'upstream_4xx', 'upstream_5xx', 'max_attempts', 'network_failure', 'conflict_strategy', 'unknown']);
const LOCK_STATE_KEYS = new Set(['all', 'active', 'stale']);
const OPEN_TASK_STATUSES = ['pending', 'processing', 'retry_waiting', 'requeued'];
const ANALYTICS_WINDOW_PRESETS = Object.freeze({
    '24h': {
        key: '24h',
        label: '24h',
        description: '近 24 小时',
        hours: 24,
        bucket_hours: 1
    },
    '72h': {
        key: '72h',
        label: '72h',
        description: '近 72 小时',
        hours: 72,
        bucket_hours: 3
    },
    '7d': {
        key: '7d',
        label: '7d',
        description: '近 7 天',
        hours: 24 * 7,
        bucket_hours: 12
    }
});
const TASK_SELECT = `
    id,
    order_id,
    target_url,
    payload,
    status,
    attempt_count,
    max_attempts,
    next_attempt_at,
    last_attempt_at,
    last_error,
    last_response_status,
    last_response_body,
    dedupe_key,
    target_key,
    channel_key,
    worker_name,
    conflict_count,
    last_conflict_at,
    last_conflict_reason,
    last_conflict_scope,
    last_conflict_note,
    delivered_at,
    dead_lettered_at,
    manual_replay_requested_at,
    manual_replay_requested_by,
    manual_replay_count,
    locked_at,
    lock_expires_at,
    lock_token,
    reservation_acquired_at,
    reservation_lock_token,
    reservation_worker_name,
    executed_at,
    updated_at,
    created_at
`;
const ORDER_SELECT = `
    id,
    user_id,
    snapshot_product_name,
    price_paid,
    total_price,
    delivery_status,
    delivery_attempt_count,
    delivery_last_error,
    delivery_completed_at,
    created_at,
    item_count,
    refund_status
`;
const ATTEMPT_SELECT = `
    id,
    task_id,
    attempt_no,
    worker_name,
    started_at,
    finished_at,
    success,
    response_status,
    error_message,
    duration_ms
`;
const CONFLICT_AUDIT_SELECT = `
    id,
    task_id,
    order_id,
    scope,
    reason_key,
    detail,
    strategy_snapshot,
    target_key,
    channel_key,
    worker_name,
    lock_token,
    task_status,
    next_attempt_at,
    created_at
`;

function parsePositiveInt(value, fallback, max = 100) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, max);
}

function normalizeFilterValue(value, allowedValues = null, fallback = 'all') {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return fallback;
    if (allowedValues && !allowedValues.has(normalized)) return fallback;
    return normalized;
}

function isUuidLike(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function unique(values = []) {
    return [...new Set(values.filter(Boolean))];
}

function resolveAnalyticsWindow(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return ANALYTICS_WINDOW_PRESETS[normalized] || ANALYTICS_WINDOW_PRESETS['24h'];
}

function getConflictAnalyticsWindowRange(windowPreset) {
    const analyticsWindow = resolveAnalyticsWindow(windowPreset?.key || windowPreset);
    const bucketHours = Math.max(1, Number(analyticsWindow.bucket_hours || 1));
    const bucketCount = Math.max(1, Math.ceil(Number(analyticsWindow.hours || 24) / bucketHours));
    const end = new Date();
    end.setMinutes(0, 0, 0);
    end.setHours(end.getHours() - (end.getHours() % bucketHours), 0, 0, 0);

    const start = new Date(end.getTime() - (bucketCount - 1) * bucketHours * 60 * 60 * 1000);

    return {
        ...analyticsWindow,
        bucket_hours: bucketHours,
        bucket_count: bucketCount,
        start_at: start.toISOString(),
        end_at: end.toISOString()
    };
}

async function fetchAllRows(buildQuery, pageSize = 200, maxPages = 20) {
    const rows = [];

    for (let page = 0; page < maxPages; page += 1) {
        const from = page * pageSize;
        const to = from + pageSize - 1;
        const { data, error } = await buildQuery().range(from, to);

        if (error) throw error;

        const batch = Array.isArray(data) ? data : [];
        rows.push(...batch);

        if (batch.length < pageSize) {
            break;
        }
    }

    return rows;
}

function paginateRows(rows = [], page = 1, pageSize = 20) {
    const normalizedPageSize = Math.max(1, Number(pageSize || 20));
    const normalizedPage = Math.max(1, Number(page || 1));
    const total = rows.length;
    const from = (normalizedPage - 1) * normalizedPageSize;
    const to = from + normalizedPageSize;

    return {
        page: normalizedPage,
        pageSize: normalizedPageSize,
        total,
        tasks: rows.slice(from, to)
    };
}

function groupAttemptsByTask(attempts = []) {
    const map = {};
    attempts.forEach((attempt) => {
        if (!attempt?.task_id) return;
        if (!map[attempt.task_id]) map[attempt.task_id] = [];
        if (map[attempt.task_id].length < 3) {
            map[attempt.task_id].push(attempt);
        }
    });
    return map;
}

function getLockState(task = {}) {
    if (!task?.lock_token) {
        return String(task?.status || '').toLowerCase() === 'processing' ? 'lock_missing' : 'unlocked';
    }
    const expiresAt = task.lock_expires_at ? new Date(task.lock_expires_at).getTime() : 0;
    if (!Number.isFinite(expiresAt) || !expiresAt) return 'locked_unknown';
    return expiresAt > Date.now() ? 'locked_active' : 'locked_stale';
}

function hasReservationSnapshot(task = {}) {
    return Boolean(
        task?.reservation_acquired_at
        || task?.reservation_lock_token
        || task?.reservation_worker_name
    );
}

function classifyReservationState(task = {}) {
    if (!hasReservationSnapshot(task)) {
        return { key: 'none', label: '无占位', tone: 'muted' };
    }

    const status = String(task?.status || '').trim().toLowerCase();
    const lockToken = String(task?.lock_token || '').trim();
    const reservationLockToken = String(task?.reservation_lock_token || '').trim();
    const workerName = String(task?.worker_name || '').trim();
    const reservationWorkerName = String(task?.reservation_worker_name || '').trim();
    const expiresAt = task?.lock_expires_at ? new Date(task.lock_expires_at).getTime() : 0;
    const hasActiveLease = Boolean(lockToken)
        && Number.isFinite(expiresAt)
        && expiresAt > Date.now();

    if (reservationLockToken && lockToken && reservationLockToken !== lockToken) {
        return { key: 'token_drift', label: 'Token 漂移', tone: 'danger' };
    }
    if (reservationWorkerName && workerName && reservationWorkerName !== workerName) {
        return { key: 'worker_drift', label: 'Worker 漂移', tone: 'danger' };
    }
    if (status !== 'processing') {
        return { key: 'released_pending_cleanup', label: '占位残留', tone: 'warn' };
    }
    if (!lockToken) {
        return { key: 'missing_lock', label: '占位缺锁', tone: 'danger' };
    }
    if (!hasActiveLease) {
        return { key: 'stale_lock', label: '占位过期', tone: 'danger' };
    }
    if (!reservationLockToken || !task?.reservation_acquired_at) {
        return { key: 'incomplete', label: '占位不完整', tone: 'warn' };
    }

    return { key: 'active', label: '全局占位生效', tone: 'processing' };
}

function classifyDeadLetterReason(task = {}) {
    const message = String(task?.last_error || '').trim();
    const normalized = message.toLowerCase();
    const responseStatus = Number(task?.last_response_status || 0);
    const attemptCount = Number(task?.attempt_count || 0);
    const maxAttempts = Number(task?.max_attempts || 0);
    const lastConflictReason = String(task?.last_conflict_reason || '').trim().toLowerCase();

    if (normalized.includes('人工死信') || normalized.includes('人工标记') || normalized.includes('manually marked')) {
        return { key: 'manual', label: '人工标记', tone: 'muted' };
    }
    if (normalized.includes('冲突保护') || lastConflictReason.includes('manual_force_unlock') || lastConflictReason.includes('target_') || lastConflictReason.includes('channel_')) {
        return { key: 'conflict_strategy', label: '冲突策略', tone: 'warn' };
    }
    if (normalized.includes('未配置履约目标地址')) {
        return { key: 'missing_target', label: '目标地址缺失', tone: 'danger' };
    }
    if (normalized.includes('超时') || responseStatus === 408) {
        return { key: 'timeout', label: '请求超时', tone: 'warn' };
    }
    if (responseStatus >= 500) {
        return { key: 'upstream_5xx', label: `上游 ${responseStatus}`, tone: 'danger' };
    }
    if (responseStatus >= 400) {
        return { key: 'upstream_4xx', label: `上游 ${responseStatus}`, tone: 'danger' };
    }
    if (maxAttempts > 0 && attemptCount >= maxAttempts) {
        return { key: 'max_attempts', label: '达到最大重试次数', tone: 'warn' };
    }
    if (normalized.includes('履约请求失败')) {
        return { key: 'network_failure', label: '网络失败', tone: 'warn' };
    }

    return { key: 'unknown', label: '未知原因', tone: 'muted' };
}

function matchesDeadLetterReason(task = {}, reasonKey = 'all') {
    const normalizedReason = normalizeFilterValue(reasonKey, DEAD_LETTER_REASON_KEYS, 'all');
    if (normalizedReason === 'all') return true;
    return classifyDeadLetterReason(task).key === normalizedReason;
}

function summarizeLockConflictTasks(tasks = []) {
    const counts = {
        total: Number(tasks.length || 0),
        active: 0,
        stale: 0,
        missing: 0,
        unknown: 0,
        manual_replay_requested: 0,
        force_unlock_candidates: 0
    };

    tasks.forEach((task) => {
        const state = getLockState(task);
        if (state === 'locked_active') {
            counts.active += 1;
        } else if (state === 'locked_stale') {
            counts.stale += 1;
            counts.force_unlock_candidates += 1;
        } else if (state === 'lock_missing') {
            counts.missing += 1;
            counts.force_unlock_candidates += 1;
        } else {
            counts.unknown += 1;
        }

        if (task?.manual_replay_requested_at) {
            counts.manual_replay_requested += 1;
        }
    });

    return counts;
}

function summarizeReservationTasks(tasks = []) {
    const counts = {
        total: Number(tasks.length || 0),
        active: 0,
        token_drift: 0,
        worker_drift: 0,
        missing_lock: 0,
        stale_lock: 0,
        released_pending_cleanup: 0,
        incomplete: 0,
        drift_total: 0,
        distinct_targets: 0,
        distinct_channels: 0,
        oldest_active_at: null,
        latest_active_at: null
    };
    const activeTargets = new Set();
    const activeChannels = new Set();
    let oldestActiveAt = 0;
    let latestActiveAt = 0;

    tasks.forEach((task) => {
        const reservationState = task?.reservation_state || classifyReservationState(task);
        const key = String(reservationState?.key || 'none').trim().toLowerCase();
        if (Object.prototype.hasOwnProperty.call(counts, key)) {
            counts[key] += 1;
        }
        if (key !== 'active') {
            counts.drift_total += 1;
            return;
        }

        if (task?.target_key) activeTargets.add(task.target_key);
        if (task?.channel_key) activeChannels.add(task.channel_key);

        const acquiredAt = Number(new Date(task?.reservation_acquired_at || 0).getTime());
        if (acquiredAt > 0 && (!oldestActiveAt || acquiredAt < oldestActiveAt)) {
            oldestActiveAt = acquiredAt;
        }
        if (acquiredAt > latestActiveAt) {
            latestActiveAt = acquiredAt;
        }
    });

    counts.distinct_targets = activeTargets.size;
    counts.distinct_channels = activeChannels.size;
    counts.oldest_active_at = oldestActiveAt ? new Date(oldestActiveAt).toISOString() : null;
    counts.latest_active_at = latestActiveAt ? new Date(latestActiveAt).toISOString() : null;
    return counts;
}

function summarizeDeadLetterTasks(tasks = []) {
    const counts = {
        total: Number(tasks.length || 0),
        missing_target: 0,
        timeout: 0,
        upstream_4xx: 0,
        upstream_5xx: 0,
        max_attempts: 0,
        conflict_strategy: 0,
        manual: 0,
        unknown: 0
    };

    tasks.forEach((task) => {
        const reason = task?.dead_letter_reason?.key || classifyDeadLetterReason(task).key || 'unknown';
        if (Object.prototype.hasOwnProperty.call(counts, reason)) {
            counts[reason] += 1;
        } else {
            counts.unknown += 1;
        }
    });

    return counts;
}

function classifyConflictReason(record = {}) {
    const reasonKey = String(record?.reason_key || record?.last_conflict_reason || '').trim().toLowerCase();

    if (reasonKey.includes('target_max_inflight')) {
        return { key: 'target_max_inflight', label: '目标并发打满', tone: 'warn' };
    }
    if (reasonKey.includes('target_min_interval')) {
        return { key: 'target_min_interval', label: '目标触发间隔限流', tone: 'warn' };
    }
    if (reasonKey.includes('channel_max_inflight')) {
        return { key: 'channel_max_inflight', label: '通道并发打满', tone: 'danger' };
    }
    if (reasonKey.includes('channel_min_interval')) {
        return { key: 'channel_min_interval', label: '通道触发间隔限流', tone: 'warn' };
    }
    if (reasonKey.includes('manual_force_unlock')) {
        return { key: 'manual_force_unlock', label: '人工强制解锁', tone: 'processing' };
    }

    return { key: 'unknown_conflict', label: '其他冲突', tone: 'muted' };
}

function summarizeConflictAudits(records = []) {
    const counts = {
        total: Number(records.length || 0),
        target_max_inflight: 0,
        target_min_interval: 0,
        channel_max_inflight: 0,
        channel_min_interval: 0,
        manual_force_unlock: 0,
        dead_letter: 0,
        latest_conflict_at: null
    };
    let latestAt = 0;

    records.forEach((record) => {
        const classified = record?.conflict_reason || classifyConflictReason(record);
        if (Object.prototype.hasOwnProperty.call(counts, classified.key)) {
            counts[classified.key] += 1;
        }
        if (String(record?.task_status || '').toLowerCase() === 'dead_letter') {
            counts.dead_letter += 1;
        }

        const createdAt = Number(new Date(record?.created_at || 0).getTime());
        if (createdAt > latestAt) {
            latestAt = createdAt;
        }
    });

    counts.latest_conflict_at = latestAt ? new Date(latestAt).toISOString() : null;
    return counts;
}

function formatConflictTrendLabel(date, bucketHours = 1) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    if (Number(bucketHours || 1) >= 24) {
        return `${month}-${day}`;
    }
    return `${month}-${day} ${hour}:00`;
}

function buildConflictTrend(records = [], windowPreset = ANALYTICS_WINDOW_PRESETS['24h']) {
    const analyticsWindow = getConflictAnalyticsWindowRange(windowPreset);
    const bucketHours = Math.max(1, Number(analyticsWindow.bucket_hours || 1));
    const bucketCount = Math.max(1, Number(analyticsWindow.bucket_count || 1));
    const start = new Date(analyticsWindow.start_at);
    const hourMs = 60 * 60 * 1000;
    const buckets = Array.from({ length: bucketCount }, (_, index) => {
        const bucketAt = new Date(start.getTime() + index * bucketHours * hourMs);
        return {
            bucket_at: bucketAt.toISOString(),
            label: formatConflictTrendLabel(bucketAt, bucketHours),
            total: 0,
            target: 0,
            channel: 0,
            manual: 0,
            dead_letter: 0
        };
    });

    records.forEach((record) => {
        const createdAt = new Date(record?.created_at || 0);
        if (Number.isNaN(createdAt.getTime())) return;
        createdAt.setMinutes(0, 0, 0);
        const deltaHours = Math.floor((createdAt.getTime() - start.getTime()) / hourMs);
        if (deltaHours < 0) return;
        const bucketIndex = Math.floor(deltaHours / bucketHours);
        const bucket = buckets[bucketIndex];
        if (!bucket) return;

        bucket.total += 1;
        const scope = String(record?.scope || '').trim().toLowerCase();
        if (scope === 'target') {
            bucket.target += 1;
        } else if (scope === 'channel') {
            bucket.channel += 1;
        } else if (scope === 'manual') {
            bucket.manual += 1;
        }

        if (String(record?.task_status || '').trim().toLowerCase() === 'dead_letter') {
            bucket.dead_letter += 1;
        }
    });

    const maxTotal = buckets.reduce((max, bucket) => Math.max(max, Number(bucket.total || 0)), 1);
    const hottest = buckets.reduce((current, bucket) => (
        Number(bucket.total || 0) > Number(current?.total || 0) ? bucket : current
    ), null);
    const totals = buckets.reduce((acc, bucket) => {
        acc.total_conflicts += Number(bucket.total || 0);
        acc.target_conflicts += Number(bucket.target || 0);
        acc.channel_conflicts += Number(bucket.channel || 0);
        acc.manual_conflicts += Number(bucket.manual || 0);
        acc.dead_letter_conflicts += Number(bucket.dead_letter || 0);
        return acc;
    }, {
        total_conflicts: 0,
        target_conflicts: 0,
        channel_conflicts: 0,
        manual_conflicts: 0,
        dead_letter_conflicts: 0
    });

    return {
        window_key: analyticsWindow.key,
        window_label: analyticsWindow.label,
        window_description: analyticsWindow.description,
        hours: Number(analyticsWindow.hours || 24),
        bucket_hours: bucketHours,
        bucket_count: bucketCount,
        range_start_at: analyticsWindow.start_at,
        range_end_at: analyticsWindow.end_at,
        max_total: maxTotal,
        hottest_hour_label: hottest?.label || null,
        hottest_hour_total: Number(hottest?.total || 0),
        ...totals,
        buckets
    };
}

function buildConflictHotspots(records = [], reservationTasks = [], keyField = 'target_key', limit = 6) {
    const map = new Map();

    const touchItem = (key) => {
        const normalizedKey = String(key || '').trim().toLowerCase();
        if (!normalizedKey) return null;
        if (!map.has(normalizedKey)) {
            map.set(normalizedKey, {
                key: normalizedKey,
                total_conflicts: 0,
                dead_letter_count: 0,
                manual_count: 0,
                active_reservations: 0,
                latest_at: null,
                latest_reason_label: null,
                reason_counts: {}
            });
        }
        return map.get(normalizedKey);
    };

    records.forEach((record) => {
        const item = touchItem(record?.[keyField]);
        if (!item) return;

        item.total_conflicts += 1;
        if (String(record?.task_status || '').trim().toLowerCase() === 'dead_letter') {
            item.dead_letter_count += 1;
        }
        if (
            String(record?.scope || '').trim().toLowerCase() === 'manual'
            || String(record?.reason_key || '').trim().toLowerCase().includes('manual')
        ) {
            item.manual_count += 1;
        }

        const reason = record?.conflict_reason || classifyConflictReason(record);
        item.reason_counts[reason.key] = Number(item.reason_counts[reason.key] || 0) + 1;

        const createdAt = Number(new Date(record?.created_at || 0).getTime());
        const latestAt = Number(new Date(item.latest_at || 0).getTime());
        if (createdAt > latestAt) {
            item.latest_at = record.created_at;
            item.latest_reason_label = reason.label || null;
        }
    });

    reservationTasks.forEach((task) => {
        const reservationState = task?.reservation_state || classifyReservationState(task);
        if (reservationState?.key !== 'active') return;
        const item = touchItem(task?.[keyField]);
        if (!item) return;
        item.active_reservations += 1;
    });

    return [...map.values()]
        .map((item) => {
            const topReason = Object.entries(item.reason_counts || {})
                .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0))[0]?.[0] || null;
            return {
                key: item.key,
                total_conflicts: item.total_conflicts,
                dead_letter_count: item.dead_letter_count,
                manual_count: item.manual_count,
                active_reservations: item.active_reservations,
                latest_at: item.latest_at,
                latest_reason_label: item.latest_reason_label
                    || (topReason ? classifyConflictReason({ reason_key: topReason }).label : null)
                    || '其他冲突'
            };
        })
        .sort((left, right) => (
            Number(right.total_conflicts || 0) - Number(left.total_conflicts || 0)
            || Number(right.active_reservations || 0) - Number(left.active_reservations || 0)
            || Number(new Date(right.latest_at || 0).getTime()) - Number(new Date(left.latest_at || 0).getTime())
        ))
        .slice(0, Math.max(1, Math.min(Number(limit || 6), 12)));
}

function buildConflictAnalytics(records = [], reservationTasks = [], windowPreset = ANALYTICS_WINDOW_PRESETS['24h'], hotspotLimit = 6) {
    const analyticsWindow = getConflictAnalyticsWindowRange(windowPreset);
    const trend = buildConflictTrend(records, analyticsWindow);
    const targets = buildConflictHotspots(records, reservationTasks, 'target_key', hotspotLimit);
    const channels = buildConflictHotspots(records, reservationTasks, 'channel_key', hotspotLimit);

    return {
        window: {
            key: analyticsWindow.key,
            label: analyticsWindow.label,
            description: analyticsWindow.description,
            hours: analyticsWindow.hours,
            bucket_hours: analyticsWindow.bucket_hours,
            bucket_count: analyticsWindow.bucket_count,
            start_at: analyticsWindow.start_at,
            end_at: analyticsWindow.end_at
        },
        summary: {
            window_key: analyticsWindow.key,
            window_label: analyticsWindow.label,
            window_description: analyticsWindow.description,
            hours: trend.hours,
            bucket_hours: trend.bucket_hours,
            bucket_count: trend.bucket_count,
            total_conflicts: trend.total_conflicts,
            target_conflicts: trend.target_conflicts,
            channel_conflicts: trend.channel_conflicts,
            manual_conflicts: trend.manual_conflicts,
            dead_letter_conflicts: trend.dead_letter_conflicts,
            hottest_hour_label: trend.hottest_hour_label,
            hottest_hour_total: trend.hottest_hour_total,
            target_hotspots: targets.length,
            channel_hotspots: channels.length
        },
        trend,
        hotspots: {
            targets,
            channels
        }
    };
}

function summarizeReplayRecords(records = []) {
    const uniqueAdmins = new Set();
    const states = {
        total: Number(records.length || 0),
        delivered: 0,
        dead_letter: 0,
        pending: 0,
        retry_waiting: 0,
        missing_task: 0
    };
    let latestReplayAt = null;

    records.forEach((record) => {
        if (record?.admin_id || record?.admin_email) {
            uniqueAdmins.add(record.admin_email || record.admin_id);
        }

        const createdAt = record?.created_at ? new Date(record.created_at).getTime() : 0;
        if (createdAt && (!latestReplayAt || createdAt > latestReplayAt)) {
            latestReplayAt = createdAt;
        }

        const status = String(record?.task?.status || '').toLowerCase();
        if (!status) {
            states.missing_task += 1;
            return;
        }
        if (Object.prototype.hasOwnProperty.call(states, status)) {
            states[status] += 1;
        }
    });

    states.admin_count = uniqueAdmins.size;
    states.latest_replay_at = latestReplayAt ? new Date(latestReplayAt).toISOString() : null;
    return states;
}

function normalizeLogDetails(details) {
    if (!details) return {};
    if (typeof details === 'object') return details;

    try {
        return JSON.parse(details);
    } catch (_) {
        return {};
    }
}

function applyTaskLockStateFilter(taskQuery, lockState) {
    const normalized = normalizeFilterValue(lockState, LOCK_STATE_KEYS, 'all');
    const nowIso = new Date().toISOString();

    if (normalized === 'active') {
        return taskQuery
            .eq('status', 'processing')
            .not('lock_token', 'is', null)
            .gt('lock_expires_at', nowIso);
    }

    if (normalized === 'stale') {
        return taskQuery
            .eq('status', 'processing')
            .not('lock_token', 'is', null)
            .lte('lock_expires_at', nowIso);
    }

    return taskQuery;
}

function applyTaskSearch(taskQuery, query) {
    const trimmed = String(query || '').trim();
    if (!trimmed) return taskQuery;

    if (isUuidLike(trimmed)) {
        return taskQuery.eq('order_id', trimmed);
    }

    const escapedQuery = trimmed.replace(/,/g, ' ');
    return taskQuery.or([
        `target_url.ilike.%${escapedQuery}%`,
        `target_key.ilike.%${escapedQuery}%`,
        `channel_key.ilike.%${escapedQuery}%`,
        `dedupe_key.ilike.%${escapedQuery}%`,
        `worker_name.ilike.%${escapedQuery}%`,
        `last_error.ilike.%${escapedQuery}%`,
        `last_conflict_reason.ilike.%${escapedQuery}%`,
        `last_conflict_note.ilike.%${escapedQuery}%`
    ].join(','));
}

async function countTasksByStatus(supabase, status) {
    const { count, error } = await supabase
        .from('shop_webhook_tasks')
        .select('*', { count: 'exact', head: true })
        .eq('status', status);

    if (error) throw error;
    return Number(count || 0);
}

async function countTasksByLockState(supabase, mode) {
    const nowIso = new Date().toISOString();
    let query = supabase
        .from('shop_webhook_tasks')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'processing');

    if (mode === 'active') {
        query = query
            .not('lock_token', 'is', null)
            .gt('lock_expires_at', nowIso);
    } else if (mode === 'stale') {
        query = query
            .not('lock_token', 'is', null)
            .lte('lock_expires_at', nowIso);
    } else if (mode === 'missing') {
        query = query.is('lock_token', null);
    } else {
        query = query.not('lock_token', 'is', null);
    }

    const { count, error } = await query;
    if (error) throw error;
    return Number(count || 0);
}

async function countManualReplayTasks(supabase) {
    const { count, error } = await supabase
        .from('shop_webhook_tasks')
        .select('*', { count: 'exact', head: true })
        .gt('manual_replay_count', 0);

    if (error) throw error;
    return Number(count || 0);
}

async function countTasksWithConflicts(supabase) {
    const { count, error } = await supabase
        .from('shop_webhook_tasks')
        .select('*', { count: 'exact', head: true })
        .gt('conflict_count', 0);

    if (error) throw error;
    return Number(count || 0);
}

async function fetchTaskPage({ supabase, page, pageSize, status, query, lockState = 'all', sortColumn = 'created_at', ascending = false }) {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let taskQuery = supabase
        .from('shop_webhook_tasks')
        .select(TASK_SELECT, { count: 'exact' })
        .order(sortColumn, { ascending })
        .order('created_at', { ascending: false });

    if (status && status !== 'all') {
        taskQuery = taskQuery.eq('status', status);
    }

    taskQuery = applyTaskSearch(taskQuery, query);
    taskQuery = applyTaskLockStateFilter(taskQuery, lockState);

    const { data, count, error } = await taskQuery.range(from, to);
    if (error) throw error;

    return {
        page,
        pageSize,
        total: Number(count || 0),
        tasks: data || []
    };
}

async function fetchDeadLetterPage({ supabase, page, pageSize, reason }) {
    const allDeadLetters = await fetchAllRows(() => supabase
        .from('shop_webhook_tasks')
        .select(TASK_SELECT)
        .eq('status', 'dead_letter')
        .order('dead_lettered_at', { ascending: false })
        .order('created_at', { ascending: false }));

    const filtered = (allDeadLetters || []).filter((task) => matchesDeadLetterReason(task, reason));
    return {
        ...paginateRows(filtered, page, pageSize),
        allTasks: filtered
    };
}

async function fetchLockConflictPage({ supabase, page, pageSize, lockState }) {
    const allLockTasks = await fetchAllRows(() => {
        let query = supabase
            .from('shop_webhook_tasks')
            .select(TASK_SELECT)
            .eq('status', 'processing')
            .order('lock_expires_at', { ascending: true })
            .order('created_at', { ascending: false });

        query = applyTaskLockStateFilter(query, lockState);
        return query;
    });

    const filtered = (allLockTasks || []).filter((task) => {
        const state = getLockState(task);
        const normalized = normalizeFilterValue(lockState, LOCK_STATE_KEYS, 'all');
        if (normalized === 'all') {
            return ['locked_active', 'locked_stale', 'locked_unknown', 'lock_missing'].includes(state);
        }
        if (normalized === 'active') return state === 'locked_active';
        if (normalized === 'stale') return state === 'locked_stale' || state === 'lock_missing';
        return true;
    });

    return {
        ...paginateRows(filtered, page, pageSize),
        allTasks: filtered
    };
}

function compareReservationTasks(left = {}, right = {}) {
    const weights = {
        token_drift: 0,
        worker_drift: 1,
        missing_lock: 2,
        stale_lock: 3,
        released_pending_cleanup: 4,
        incomplete: 5,
        active: 6,
        none: 7
    };
    const leftState = classifyReservationState(left);
    const rightState = classifyReservationState(right);
    const leftWeight = weights[leftState.key] ?? 99;
    const rightWeight = weights[rightState.key] ?? 99;

    if (leftWeight !== rightWeight) {
        return leftWeight - rightWeight;
    }

    const leftAcquiredAt = Number(new Date(left?.reservation_acquired_at || 0).getTime());
    const rightAcquiredAt = Number(new Date(right?.reservation_acquired_at || 0).getTime());
    if (leftAcquiredAt !== rightAcquiredAt) {
        if (leftState.key === 'active' && rightState.key === 'active') {
            return leftAcquiredAt - rightAcquiredAt;
        }
        return rightAcquiredAt - leftAcquiredAt;
    }

    return Number(new Date(right?.updated_at || right?.created_at || 0).getTime())
        - Number(new Date(left?.updated_at || left?.created_at || 0).getTime());
}

async function fetchReservationOverview({ supabase, limit = 8 }) {
    const allTasks = await fetchAllRows(() => supabase
        .from('shop_webhook_tasks')
        .select(TASK_SELECT)
        .not('reservation_acquired_at', 'is', null)
        .order('reservation_acquired_at', { ascending: false })
        .order('created_at', { ascending: false }));

    const sorted = [...(allTasks || [])].sort(compareReservationTasks);
    return {
        total: sorted.length,
        tasks: sorted.slice(0, Math.max(1, Math.min(limit, 20))),
        allTasks: sorted
    };
}

async function fetchReplayLogs({ supabase, page, pageSize }) {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let logs = [];
    let count = 0;

    const primary = await supabase
        .from('admin_audit_logs_view')
        .select('id, action_type, details, created_at, target_user_id, admin_id, admin_email', { count: 'exact' })
        .eq('action_type', 'shop.delivery.replay')
        .order('created_at', { ascending: false })
        .range(from, to);

    if (!primary.error) {
        logs = primary.data || [];
        count = Number(primary.count || 0);
    } else {
        const fallback = await supabase
            .from('admin_audit_logs')
            .select('id, action_type, details, created_at, target_user_id, admin_id', { count: 'exact' })
            .eq('action_type', 'shop.delivery.replay')
            .order('created_at', { ascending: false })
            .range(from, to);

        if (fallback.error) throw fallback.error;

        logs = (fallback.data || []).map((row) => ({ ...row, admin_email: null }));
        count = Number(fallback.count || 0);
    }

    return {
        page,
        pageSize,
        total: count,
        logs
    };
}

async function fetchRecentConflictAudits({ supabase, limit = 12 }) {
    const { data, error } = await supabase
        .from('shop_webhook_task_conflicts')
        .select(CONFLICT_AUDIT_SELECT)
        .order('created_at', { ascending: false })
        .limit(Math.max(1, Math.min(limit, 30)));

    if (error) throw error;

    const records = (data || []).map((record) => ({
        ...record,
        conflict_reason: classifyConflictReason(record)
    }));

    return {
        total: records.length,
        records
    };
}

async function fetchConflictAnalyticsWindow({ supabase, analyticsWindow = ANALYTICS_WINDOW_PRESETS['24h'], pageSize = 300, maxPages = 20 }) {
    const windowRange = getConflictAnalyticsWindowRange(analyticsWindow);
    const records = await fetchAllRows(() => supabase
        .from('shop_webhook_task_conflicts')
        .select(CONFLICT_AUDIT_SELECT)
        .gte('created_at', windowRange.start_at)
        .order('created_at', { ascending: false }), pageSize, maxPages);

    return (records || []).map((record) => ({
        ...record,
        conflict_reason: classifyConflictReason(record)
    }));
}

async function fetchOrdersByIds(supabase, orderIds = []) {
    const ids = unique(orderIds);
    if (!ids.length) return {};

    const { data, error } = await supabase
        .from('shop_orders')
        .select(ORDER_SELECT)
        .in('id', ids);

    if (error) throw error;
    return Object.fromEntries((data || []).map((order) => [order.id, order]));
}

async function fetchTaskAttempts(supabase, taskIds = []) {
    const ids = unique(taskIds);
    if (!ids.length) return {};

    const { data, error } = await supabase
        .from('shop_webhook_task_attempts')
        .select(ATTEMPT_SELECT)
        .in('task_id', ids)
        .order('started_at', { ascending: false });

    if (error) throw error;
    return groupAttemptsByTask(data || []);
}

async function fetchTasksByIds(supabase, taskIds = []) {
    const ids = unique(taskIds);
    if (!ids.length) return {};

    const { data, error } = await supabase
        .from('shop_webhook_tasks')
        .select(TASK_SELECT)
        .in('id', ids);

    if (error) throw error;
    return Object.fromEntries((data || []).map((task) => [task.id, task]));
}

function enrichTasks(tasks = [], ordersById = {}, attemptsByTask = {}) {
    return tasks.map((task) => ({
        ...task,
        lock_state: getLockState(task),
        reservation_state: classifyReservationState(task),
        dead_letter_reason: String(task?.status || '').toLowerCase() === 'dead_letter'
            ? classifyDeadLetterReason(task)
            : null,
        conflict_reason: task?.last_conflict_reason
            ? classifyConflictReason(task)
            : null,
        order: task.order_id ? (ordersById[task.order_id] || null) : null,
        attempts: attemptsByTask[task.id] || []
    }));
}

async function handleDeliveryStrategyRequest(req, res, supabase, user) {
    if (req.method === 'GET') {
        const config = await loadShopDeliveryStrategyConfig(supabase);
        return sendJson(res, 200, {
            success: true,
            config
        });
    }

    if (req.method === 'POST') {
        const body = await parseJsonBody(req);
        const nextConfig = normalizeShopDeliveryStrategyConfig(body.config || {});
        const applyToOpenTasks = body.applyToOpenTasks !== false;

        const savedConfig = await upsertShopDeliveryStrategyConfig(supabase, nextConfig, user.id);

        let syncedTaskCount = 0;
        if (applyToOpenTasks) {
            const { data, error } = await supabase
                .from('shop_webhook_tasks')
                .update({
                    max_attempts: savedConfig.max_attempts,
                    updated_at: new Date().toISOString()
                })
                .in('status', OPEN_TASK_STATUSES)
                .select('id');

            if (error) {
                throw new Error(error.message || 'Failed to sync delivery tasks with strategy');
            }

            syncedTaskCount = Array.isArray(data) ? data.length : 0;
        }

        await writeAdminAuditLog({
            supabase,
            adminId: user.id,
            actionType: 'shop.delivery.strategy.update',
            details: {
                config: savedConfig,
                apply_to_open_tasks: applyToOpenTasks,
                synced_task_count: syncedTaskCount
            }
        });

        return sendJson(res, 200, {
            success: true,
            message: applyToOpenTasks
                ? `履约策略已保存，并同步到 ${syncedTaskCount} 条未完成任务。`
                : '履约策略已保存。',
            config: savedConfig,
            synced_task_count: syncedTaskCount
        });
    }

    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { success: false, message: 'Method not allowed' });
}

module.exports = async (req, res) => {
    try {
        const { supabase, user } = await requireAdmin(req);
        const url = new URL(req.url || '', 'http://localhost');
        const routeName = String(url.searchParams.get('route') || '').trim().toLowerCase();
        const isDeliveryStrategyRequest = url.searchParams.get('deliveryStrategy') === '1'
            || routeName === 'delivery-strategy';

        if (isDeliveryStrategyRequest) {
            return await handleDeliveryStrategyRequest(req, res, supabase, user);
        }

        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            return sendJson(res, 405, { success: false, message: 'Method not allowed' });
        }

        const page = parsePositiveInt(url.searchParams.get('page'), 1, 100000);
        const pageSize = parsePositiveInt(url.searchParams.get('pageSize'), 8, 50);
        const statusFilter = String(url.searchParams.get('status') || 'all').trim().toLowerCase();
        const query = String(url.searchParams.get('query') || '').trim();
        const lockState = normalizeFilterValue(url.searchParams.get('lockState'), LOCK_STATE_KEYS, 'all');
        const analyticsWindow = resolveAnalyticsWindow(url.searchParams.get('analyticsWindow'));

        const deadLetterPage = parsePositiveInt(url.searchParams.get('deadLetterPage'), 1, 100000);
        const deadLetterPageSize = parsePositiveInt(url.searchParams.get('deadLetterPageSize'), 5, 20);
        const deadLetterReason = normalizeFilterValue(url.searchParams.get('deadLetterReason'), DEAD_LETTER_REASON_KEYS, 'all');
        const lockPage = parsePositiveInt(url.searchParams.get('lockPage'), 1, 100000);
        const lockPageSize = parsePositiveInt(url.searchParams.get('lockPageSize'), 5, 20);
        const replayPage = parsePositiveInt(url.searchParams.get('replayPage'), 1, 100000);
        const replayPageSize = parsePositiveInt(url.searchParams.get('replayPageSize'), 5, 20);

        const [mainPage, deadLetterPageData, lockPageData, replayPageData, conflictAuditData, reservationOverviewData, conflictAnalyticsRecords] = await Promise.all([
            fetchTaskPage({
                supabase,
                page,
                pageSize,
                status: statusFilter,
                query,
                lockState
            }),
            fetchDeadLetterPage({
                supabase,
                page: deadLetterPage,
                pageSize: deadLetterPageSize,
                reason: deadLetterReason
            }),
            fetchLockConflictPage({
                supabase,
                page: lockPage,
                pageSize: lockPageSize,
                lockState
            }),
            fetchReplayLogs({
                supabase,
                page: replayPage,
                pageSize: replayPageSize
            }),
            fetchRecentConflictAudits({
                supabase,
                limit: 12
            }),
            fetchReservationOverview({
                supabase,
                limit: 8
            }),
            fetchConflictAnalyticsWindow({
                supabase,
                analyticsWindow
            })
        ]);

        const replayDetails = (replayPageData.logs || []).map((log) => ({
            ...log,
            details: normalizeLogDetails(log.details)
        }));
        const replayTaskIds = replayDetails.map((row) => row.details?.task_id);
        const replayOrderIds = replayDetails.map((row) => row.details?.order_id);
        const conflictTaskIds = (conflictAuditData.records || []).map((row) => row.task_id);
        const conflictOrderIds = (conflictAuditData.records || []).map((row) => row.order_id);
        const reservationTaskIds = (reservationOverviewData.tasks || []).map((task) => task.id);
        const reservationOrderIds = (reservationOverviewData.tasks || []).map((task) => task.order_id);

        const orderIds = unique([
            ...mainPage.tasks.map((task) => task.order_id),
            ...deadLetterPageData.tasks.map((task) => task.order_id),
            ...lockPageData.tasks.map((task) => task.order_id),
            ...replayOrderIds,
            ...conflictOrderIds,
            ...reservationOrderIds
        ]);

        const missingReplayTaskIds = replayTaskIds.filter((taskId) => (
            !mainPage.tasks.some((task) => task.id === taskId)
            && !deadLetterPageData.tasks.some((task) => task.id === taskId)
            && !lockPageData.tasks.some((task) => task.id === taskId)
        ));
        const missingConflictTaskIds = conflictTaskIds.filter((taskId) => (
            !mainPage.tasks.some((task) => task.id === taskId)
            && !deadLetterPageData.tasks.some((task) => task.id === taskId)
            && !lockPageData.tasks.some((task) => task.id === taskId)
        ));
        const missingReservationTaskIds = reservationTaskIds.filter((taskId) => (
            !mainPage.tasks.some((task) => task.id === taskId)
            && !deadLetterPageData.tasks.some((task) => task.id === taskId)
            && !lockPageData.tasks.some((task) => task.id === taskId)
        ));

        const [ordersById, extraTasksById] = await Promise.all([
            fetchOrdersByIds(supabase, orderIds),
            fetchTasksByIds(supabase, unique([
                ...missingReplayTaskIds,
                ...missingConflictTaskIds,
                ...missingReservationTaskIds
            ]))
        ]);

        const taskIdsForAttempts = unique([
            ...mainPage.tasks.map((task) => task.id),
            ...deadLetterPageData.tasks.map((task) => task.id),
            ...lockPageData.tasks.map((task) => task.id),
            ...conflictTaskIds,
            ...reservationTaskIds,
            ...Object.keys(extraTasksById)
        ]);

        const attemptsByTask = await fetchTaskAttempts(supabase, taskIdsForAttempts);
        const mainTasks = enrichTasks(mainPage.tasks, ordersById, attemptsByTask);
        const deadLetterTasks = enrichTasks(deadLetterPageData.tasks, ordersById, attemptsByTask);
        const lockTasks = enrichTasks(lockPageData.tasks, ordersById, attemptsByTask);
        const replayTasksById = Object.fromEntries(
            enrichTasks(Object.values(extraTasksById), ordersById, attemptsByTask)
                .map((task) => [task.id, task])
        );
        const reservationTasks = (reservationOverviewData.tasks || []).map((task) => (
            mainTasks.find((item) => item.id === task.id)
            || deadLetterTasks.find((item) => item.id === task.id)
            || lockTasks.find((item) => item.id === task.id)
            || replayTasksById[task.id]
            || enrichTasks([task], ordersById, attemptsByTask)[0]
        ));

        const replayRecords = replayDetails.map((log) => {
            const taskId = log.details?.task_id || null;
            const orderId = log.details?.order_id || null;
            const task = taskId
                ? (mainTasks.find((item) => item.id === taskId)
                    || deadLetterTasks.find((item) => item.id === taskId)
                    || lockTasks.find((item) => item.id === taskId)
                    || replayTasksById[taskId]
                    || null)
                : null;

            return {
                id: log.id,
                created_at: log.created_at,
                admin_id: log.admin_id || null,
                admin_email: log.admin_email || null,
                task_id: taskId,
                order_id: orderId,
                previous_status: log.details?.previous_status || null,
                next_status: log.details?.next_status || null,
                note: log.details?.note || null,
                previous_lock: log.details?.previous_lock || null,
                task_snapshot: log.details?.task_snapshot || null,
                manual_replay_count: Number(log.details?.manual_replay_count || task?.manual_replay_count || 0),
                lock_state: getLockState(task || {}),
                dedupe_key: task?.dedupe_key || null,
                lock_token: task?.lock_token || null,
                worker_name: task?.worker_name || null,
                task,
                order: orderId ? (ordersById[orderId] || task?.order || null) : (task?.order || null)
            };
        });
        const conflictRecords = (conflictAuditData.records || []).map((record) => {
            const task = record.task_id
                ? (mainTasks.find((item) => item.id === record.task_id)
                    || deadLetterTasks.find((item) => item.id === record.task_id)
                    || lockTasks.find((item) => item.id === record.task_id)
                    || replayTasksById[record.task_id]
                    || null)
                : null;

            return {
                ...record,
                task,
                order: record.order_id
                    ? (ordersById[record.order_id] || task?.order || null)
                    : (task?.order || null)
            };
        });

        const summaryCounts = await Promise.all(SUMMARY_STATUSES.map(async (status) => {
            const taskCount = await countTasksByStatus(supabase, status);
            return [status, taskCount];
        }));

        const [activeLocks, staleLocks, manualReplays, conflictTasks] = await Promise.all([
            countTasksByLockState(supabase, 'active'),
            countTasksByLockState(supabase, 'stale'),
            countManualReplayTasks(supabase),
            countTasksWithConflicts(supabase)
        ]);
        const missingLocks = await countTasksByLockState(supabase, 'missing');

        const summary = Object.fromEntries(summaryCounts);
        summary.total = SUMMARY_STATUSES.reduce((acc, status) => acc + Number(summary[status] || 0), 0);
        summary.retryable = Number(summary.pending || 0)
            + Number(summary.processing || 0)
            + Number(summary.retry_waiting || 0)
            + Number(summary.requeued || 0);
        summary.locked_active = activeLocks;
        summary.locked_stale = staleLocks;
        summary.lock_missing = missingLocks;
        summary.force_unlock_candidates = staleLocks + missingLocks;
        summary.manual_replays = manualReplays;
        summary.conflict_tasks = conflictTasks;

        const deadLetterSummary = summarizeDeadLetterTasks(deadLetterPageData.allTasks || []);
        const lockSummary = summarizeLockConflictTasks(lockPageData.allTasks || []);
        const replaySummary = summarizeReplayRecords(replayRecords);
        const conflictSummary = summarizeConflictAudits(conflictRecords);
        const reservationSummary = summarizeReservationTasks(reservationOverviewData.allTasks || reservationTasks);
        const conflictAnalytics = buildConflictAnalytics(
            conflictAnalyticsRecords,
            reservationOverviewData.allTasks || reservationTasks,
            analyticsWindow,
            6
        );
        summary.reservation_active = reservationSummary.active;
        summary.reservation_drift = reservationSummary.drift_total;
        summary.reservation_targets = reservationSummary.distinct_targets;
        summary.reservation_channels = reservationSummary.distinct_channels;
        summary.recent_conflicts = conflictAnalytics.summary.total_conflicts;
        summary.recent_conflicts_label = `${conflictAnalytics.summary.window_label} 冲突`;

        return sendJson(res, 200, {
            success: true,
            page,
            pageSize,
            total: mainPage.total,
            summary,
            tasks: mainTasks,
            deadLetter: {
                page: deadLetterPageData.page,
                pageSize: deadLetterPageData.pageSize,
                total: deadLetterPageData.total,
                summary: deadLetterSummary,
                reason: deadLetterReason,
                tasks: deadLetterTasks
            },
            lockConflicts: {
                page: lockPageData.page,
                pageSize: lockPageData.pageSize,
                total: lockPageData.total,
                summary: lockSummary,
                lockState,
                tasks: lockTasks
            },
            reservations: {
                total: reservationOverviewData.total,
                summary: reservationSummary,
                tasks: reservationTasks
            },
            analytics: conflictAnalytics,
            replay: {
                page: replayPageData.page,
                pageSize: replayPageData.pageSize,
                total: replayPageData.total,
                summary: replaySummary,
                records: replayRecords
            },
            conflicts: {
                total: conflictAuditData.total,
                summary: conflictSummary,
                records: conflictRecords
            }
        });
    } catch (error) {
        console.error('[shop/delivery-tasks] failed:', error);
        return sendJson(res, error.statusCode || 500, {
            success: false,
            message: error.message || 'Failed to load delivery tasks'
        });
    }
};
