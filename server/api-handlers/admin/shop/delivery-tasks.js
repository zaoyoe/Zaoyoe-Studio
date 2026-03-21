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
const DEAD_LETTER_REASON_KEYS = new Set(['all', 'manual', 'missing_target', 'timeout', 'upstream_4xx', 'upstream_5xx', 'max_attempts', 'network_failure', 'unknown']);
const LOCK_STATE_KEYS = new Set(['all', 'active', 'stale']);
const OPEN_TASK_STATUSES = ['pending', 'processing', 'retry_waiting', 'requeued'];
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
    worker_name,
    delivered_at,
    dead_lettered_at,
    manual_replay_requested_at,
    manual_replay_requested_by,
    manual_replay_count,
    locked_at,
    lock_expires_at,
    lock_token,
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

function classifyDeadLetterReason(task = {}) {
    const message = String(task?.last_error || '').trim();
    const normalized = message.toLowerCase();
    const responseStatus = Number(task?.last_response_status || 0);
    const attemptCount = Number(task?.attempt_count || 0);
    const maxAttempts = Number(task?.max_attempts || 0);

    if (normalized.includes('人工死信') || normalized.includes('人工标记') || normalized.includes('manually marked')) {
        return { key: 'manual', label: '人工标记', tone: 'muted' };
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

function summarizeDeadLetterTasks(tasks = []) {
    const counts = {
        total: Number(tasks.length || 0),
        missing_target: 0,
        timeout: 0,
        upstream_4xx: 0,
        upstream_5xx: 0,
        max_attempts: 0,
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
        `dedupe_key.ilike.%${escapedQuery}%`,
        `worker_name.ilike.%${escapedQuery}%`,
        `last_error.ilike.%${escapedQuery}%`
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
        dead_letter_reason: String(task?.status || '').toLowerCase() === 'dead_letter'
            ? classifyDeadLetterReason(task)
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

        const deadLetterPage = parsePositiveInt(url.searchParams.get('deadLetterPage'), 1, 100000);
        const deadLetterPageSize = parsePositiveInt(url.searchParams.get('deadLetterPageSize'), 5, 20);
        const deadLetterReason = normalizeFilterValue(url.searchParams.get('deadLetterReason'), DEAD_LETTER_REASON_KEYS, 'all');
        const lockPage = parsePositiveInt(url.searchParams.get('lockPage'), 1, 100000);
        const lockPageSize = parsePositiveInt(url.searchParams.get('lockPageSize'), 5, 20);
        const replayPage = parsePositiveInt(url.searchParams.get('replayPage'), 1, 100000);
        const replayPageSize = parsePositiveInt(url.searchParams.get('replayPageSize'), 5, 20);

        const [mainPage, deadLetterPageData, lockPageData, replayPageData] = await Promise.all([
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
            })
        ]);

        const replayDetails = (replayPageData.logs || []).map((log) => ({
            ...log,
            details: normalizeLogDetails(log.details)
        }));
        const replayTaskIds = replayDetails.map((row) => row.details?.task_id);
        const replayOrderIds = replayDetails.map((row) => row.details?.order_id);

        const orderIds = unique([
            ...mainPage.tasks.map((task) => task.order_id),
            ...deadLetterPageData.tasks.map((task) => task.order_id),
            ...lockPageData.tasks.map((task) => task.order_id),
            ...replayOrderIds
        ]);

        const missingReplayTaskIds = replayTaskIds.filter((taskId) => (
            !mainPage.tasks.some((task) => task.id === taskId)
            && !deadLetterPageData.tasks.some((task) => task.id === taskId)
            && !lockPageData.tasks.some((task) => task.id === taskId)
        ));

        const [ordersById, extraTasksById] = await Promise.all([
            fetchOrdersByIds(supabase, orderIds),
            fetchTasksByIds(supabase, missingReplayTaskIds)
        ]);

        const taskIdsForAttempts = unique([
            ...mainPage.tasks.map((task) => task.id),
            ...deadLetterPageData.tasks.map((task) => task.id),
            ...lockPageData.tasks.map((task) => task.id),
            ...Object.keys(extraTasksById)
        ]);

        const attemptsByTask = await fetchTaskAttempts(supabase, taskIdsForAttempts);
        const mainTasks = enrichTasks(mainPage.tasks, ordersById, attemptsByTask);
        const deadLetterTasks = enrichTasks(deadLetterPageData.tasks, ordersById, attemptsByTask);
        const lockTasks = enrichTasks(lockPageData.tasks, ordersById, attemptsByTask);
        const replayTasksById = Object.fromEntries(
            Object.entries(extraTasksById).map(([id, task]) => [
                id,
                {
                    ...task,
                    order: task.order_id ? (ordersById[task.order_id] || null) : null,
                    attempts: attemptsByTask[task.id] || []
                }
            ])
        );

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

        const summaryCounts = await Promise.all(SUMMARY_STATUSES.map(async (status) => {
            const taskCount = await countTasksByStatus(supabase, status);
            return [status, taskCount];
        }));

        const [activeLocks, staleLocks, manualReplays] = await Promise.all([
            countTasksByLockState(supabase, 'active'),
            countTasksByLockState(supabase, 'stale'),
            countManualReplayTasks(supabase)
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

        const deadLetterSummary = summarizeDeadLetterTasks(deadLetterPageData.allTasks || []);
        const lockSummary = summarizeLockConflictTasks(lockPageData.allTasks || []);
        const replaySummary = summarizeReplayRecords(replayRecords);

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
            replay: {
                page: replayPageData.page,
                pageSize: replayPageData.pageSize,
                total: replayPageData.total,
                summary: replaySummary,
                records: replayRecords
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
