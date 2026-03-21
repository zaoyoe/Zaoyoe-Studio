/**
 * Google One User API Proxy Server
 * Proxies requests to the upstream Google One job API
 * Handles Supabase auth + points deduction
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const {
    getPaymentProviderAdapter,
    roundCurrencyAmount: roundPaymentCurrencyAmount,
    amountsMatch: paymentAmountsMatch
} = require('../api/_lib/payments/provider-adapters');
const {
    reconcileCheckoutSessionForPaymentOrder
} = require('../api/_lib/payments/orders');

const app = express();
const PORT = process.env.PORT || 3001;

// Upstream API base URL
const VERIFY_API_BASE = process.env.VERIFY_API_BASE_URL || 'https://iqless.icu';
const ACTIVE_TRACKED_JOB_STATUSES = ['queued', 'running', 'processing', 'pending'];
const TERMINAL_TRACKED_JOB_STATUSES = ['success', 'failed'];
const PENDING_JOB_SWEEP_INTERVAL_MS = Math.max(2000, Number(process.env.VERIFY_PENDING_SWEEP_INTERVAL_MS || 5000));
const PENDING_JOB_SWEEP_BATCH_SIZE = Math.max(1, Number(process.env.VERIFY_PENDING_SWEEP_BATCH_SIZE || 20));
const SHOP_DELIVERY_SWEEP_INTERVAL_MS = Math.max(4000, Number(process.env.SHOP_DELIVERY_SWEEP_INTERVAL_MS || 10000));
const SHOP_DELIVERY_SWEEP_BATCH_SIZE = Math.max(1, Number(process.env.SHOP_DELIVERY_SWEEP_BATCH_SIZE || 10));
const SHOP_DELIVERY_LEASE_SECONDS = Math.max(30, Number(process.env.SHOP_DELIVERY_LEASE_SECONDS || 120));
const SHOP_DELIVERY_HTTP_TIMEOUT_MS = Math.max(3000, Number(process.env.SHOP_DELIVERY_HTTP_TIMEOUT_MS || 15000));
const SHOP_DELIVERY_MAX_BACKOFF_SECONDS = Math.max(60, Number(process.env.SHOP_DELIVERY_MAX_BACKOFF_SECONDS || 1800));
const jobSyncLocks = new Map();
let pendingJobSweepTimer = null;
let pendingJobSweepRunning = false;
let shopDeliverySweepTimer = null;
let shopDeliverySweepRunning = false;
const afdianProvider = getPaymentProviderAdapter('afdian');

// Initialize Supabase
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Middleware — merge env var origins WITH code defaults (env var alone used to override defaults)
const defaultOrigins = [
    'http://localhost:8000',
    'http://127.0.0.1:8000',
    'https://zaoyoe.com',
    'https://www.zaoyoe.com',
    'https://zaoyoe.xyz',
    'https://www.zaoyoe.xyz'
];
const envOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(s => s.trim()) || [];
const allOrigins = [...new Set([...defaultOrigins, ...envOrigins])];
app.use(cors({
    origin: allOrigins,
    credentials: true
}));
app.use(express.json());

// Health check
app.get('/health', async (req, res) => {
    try {
        const upstream = await fetch(`${String(VERIFY_API_BASE).replace(/\/+$/, '')}/api/health`);
        const payload = await upstream.json();
        return res.status(upstream.status).json(payload);
    } catch (error) {
        return res.json({
            status: 'degraded',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// =============================================
// Helpers
// =============================================
async function getVerifyConfig() {
    const { data: configData } = await supabase
        .from('system_config')
        .select('config_value')
        .eq('config_key', 'verify_settings')
        .single();

    const config = configData?.config_value || {};
    return {
        pricePerVerify: Number(config.price_per_verify) || 10,
        apiKey: String(config.verify_api_key || process.env.VERIFY_API_KEY || '').trim(),
        apiBaseUrl: String(config.verify_api_base_url || process.env.VERIFY_API_BASE_URL || VERIFY_API_BASE).replace(/\/+$/, '')
    };
}

function getCurrentSite(req, explicitSite) {
    return explicitSite || (req.headers.origin?.includes('zaoyoe.xyz') ? 'intl' : 'cn');
}

function getApiErrorDetail(payload) {
    if (!payload || typeof payload !== 'object') return null;
    return (payload.detail && typeof payload.detail === 'object') ? payload.detail : null;
}

function getApiErrorCode(payload) {
    const detail = getApiErrorDetail(payload);
    return detail?.code || payload?.code || payload?.error || '';
}

function getApiErrorMessage(payload, fallback) {
    const detail = getApiErrorDetail(payload);
    return detail?.message || payload?.message || payload?.error || fallback;
}

const LEGACY_AFDIAN_PRICE_TO_POINTS = {
    5: 5,
    20: 20,
    50: 50
};

function roundCurrencyAmount(value) {
    return roundPaymentCurrencyAmount(value);
}

function amountsMatch(expected, actual, epsilon = 0.01) {
    return paymentAmountsMatch(expected, actual, epsilon);
}

function buildAfdianEventKey(orderNo, status, payload) {
    return afdianProvider.buildEventKey({ orderNo, status, payload });
}

function getBearerToken(req) {
    const authHeader = req.headers.authorization || req.headers.Authorization || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    return match?.[1] || '';
}

async function getAuthenticatedUser(req) {
    const token = getBearerToken(req);
    if (!token) return null;

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
        return null;
    }

    return data.user;
}

async function recordPaymentEvent(eventPayload) {
    const { data, error } = await supabase
        .from('payment_events')
        .insert(eventPayload)
        .select('id')
        .limit(1);

    if (error) {
        if (error.code === '23505') {
            return { duplicate: true, id: null };
        }
        throw error;
    }

    return {
        duplicate: false,
        id: data?.[0]?.id || null
    };
}

async function finalizePaymentEvent(eventKey, patch = {}) {
    const payload = {
        ...patch,
        processed_at: new Date().toISOString()
    };

    const { error } = await supabase
        .from('payment_events')
        .update(payload)
        .eq('event_key', eventKey);

    if (error) {
        console.warn('[Payments] Failed to finalize payment event:', error.message);
    }
}

async function resolveAfdianPackage({ planId, amount }) {
    const resolvedPackage = await afdianProvider.resolvePackage({
        supabase,
        planId,
        amount
    });
    if (resolvedPackage) {
        return resolvedPackage;
    }

    const normalizedAmount = roundCurrencyAmount(amount);
    const legacyPoints = LEGACY_AFDIAN_PRICE_TO_POINTS[Math.round(normalizedAmount)];
    if (legacyPoints) {
        return {
            packageId: null,
            packageName: `Afdian ${normalizedAmount} CNY`,
            expectedAmount: normalizedAmount,
            pointsTotal: legacyPoints,
            matchType: 'legacy_amount'
        };
    }

    return null;
}

function buildClientStatusMessage(job) {
    const status = String(job?.status || '').toLowerCase();

    if (status === 'queued') {
        const queuePosition = Number(job?.queue_position);
        const waitSeconds = Number(job?.estimated_wait_seconds);
        const queueLabel = Number.isFinite(queuePosition) && queuePosition >= 0
            ? `排队中（队列位置 ${queuePosition}）`
            : '排队中';
        return Number.isFinite(waitSeconds) && waitSeconds > 0
            ? `${queueLabel}，预计等待 ${waitSeconds} 秒`
            : queueLabel;
    }

    if (status === 'running') {
        return job?.stage_label ? `当前阶段：${job.stage_label}` : '任务执行中';
    }

    if (status === 'success') {
        return job?.url ? '链接获取成功' : '任务成功完成';
    }

    if (status === 'failed') {
        return job?.error || '任务失败';
    }

    return job?.message || job?.status || '处理中';
}

function buildHistoryMessage(payload) {
    return JSON.stringify({
        kind: 'google_one_job',
        ...payload
    });
}

function parseHistoryMessage(message) {
    if (typeof message !== 'string' || !message.trim().startsWith('{')) {
        return null;
    }

    try {
        const parsed = JSON.parse(message);
        if (parsed?.kind === 'google_one_job') {
            return parsed;
        }
    } catch (_) {
        return null;
    }

    return null;
}

function isTerminalTrackedStatus(status) {
    return TERMINAL_TRACKED_JOB_STATUSES.includes(String(status || '').toLowerCase());
}

function isActiveTrackedStatus(status) {
    return ACTIVE_TRACKED_JOB_STATUSES.includes(String(status || '').toLowerCase());
}

function buildTrackedJobPayload({ email, jobId, apiData = {}, status = '', pointsDeducted = 0 }) {
    const queuePosition = Number(apiData?.queue_position);
    const estimatedWait = Number(apiData?.estimated_wait_seconds);
    const elapsedSeconds = Number(apiData?.elapsed_seconds);

    return {
        email: email || '',
        job_id: jobId || '',
        url: apiData?.url || '',
        error_code: apiData?.error || '',
        error_message: buildClientStatusMessage(apiData),
        stage_label: apiData?.stage_label || '',
        raw_status: apiData?.status || status || '',
        queue_position: Number.isFinite(queuePosition) ? queuePosition : null,
        estimated_wait_seconds: Number.isFinite(estimatedWait) ? estimatedWait : null,
        elapsed_seconds: Number.isFinite(elapsedSeconds) ? elapsedSeconds : null,
        points_deducted: pointsDeducted,
        logged_at: new Date().toISOString()
    };
}

async function withJobSyncLock(lockKey, task) {
    const previous = jobSyncLocks.get(lockKey) || Promise.resolve();
    let releaseCurrent;
    const current = new Promise((resolve) => {
        releaseCurrent = resolve;
    });
    const tail = previous.finally(() => current);
    jobSyncLocks.set(lockKey, tail);

    await previous;

    try {
        return await task();
    } finally {
        releaseCurrent();
        if (jobSyncLocks.get(lockKey) === tail) {
            jobSyncLocks.delete(lockKey);
        }
    }
}

function applyTrackedLogMatch(query, existingRecord, { userId, site, jobId }) {
    if (existingRecord?.id) {
        return query.eq('id', existingRecord.id);
    }

    if (existingRecord?.created_at && existingRecord?.verification_id) {
        return query
            .eq('user_id', userId)
            .eq('site', site)
            .eq('verification_id', existingRecord.verification_id)
            .eq('created_at', existingRecord.created_at);
    }

    return query
        .eq('user_id', userId)
        .eq('site', site)
        .eq('verification_id', jobId);
}

async function findTrackedJobLog(userId, jobId, site = 'cn') {
    if (!userId || !jobId) return null;

    try {
        const { data: exactData, error: exactError } = await supabase
            .from('verification_logs')
            .select('*')
            .eq('user_id', userId)
            .eq('site', site)
            .eq('verification_id', jobId)
            .order('created_at', { ascending: false })
            .limit(1);

        if (exactError) {
            console.warn('[Verify] Failed to query tracked job log by verification_id:', exactError.message);
        } else if (exactData?.length) {
            return exactData[0];
        }

        const { data, error } = await supabase
            .from('verification_logs')
            .select('*')
            .eq('user_id', userId)
            .eq('site', site)
            .order('created_at', { ascending: false })
            .limit(80);

        if (error) {
            console.warn('[Verify] Failed to query tracked job logs:', error.message);
            return null;
        }

        return (data || []).find((row) => parseHistoryMessage(row.message)?.job_id === jobId) || null;
    } catch (error) {
        console.warn('[Verify] Tracked job log lookup failed:', error.message);
        return null;
    }
}

async function upsertTrackedJobLog({
    existingRecord = null,
    userId,
    site = 'cn',
    email,
    jobId,
    status,
    apiData = {},
    pointsDeducted = 0
}) {
    if (!userId || !jobId) return existingRecord;

    const normalizedStatus = String(status || apiData?.status || 'queued').toLowerCase();
    const message = buildHistoryMessage(buildTrackedJobPayload({
        email,
        jobId,
        apiData,
        status: normalizedStatus,
        pointsDeducted
    }));
    const payload = {
        verification_id: jobId,
        status: normalizedStatus,
        message,
        points_deducted: pointsDeducted,
        batch_count: 1,
        batch_success: normalizedStatus === 'success' ? 1 : 0,
        batch_failed: normalizedStatus === 'failed' ? 1 : 0,
        site
    };

    try {
        if (existingRecord) {
            let query = supabase
                .from('verification_logs')
                .update(payload);
            query = applyTrackedLogMatch(query, existingRecord, { userId, site, jobId });
            const { data, error } = await query.select('*').limit(1);

            if (error) {
                console.warn('[Verify] Failed to update tracked job log:', error.message);
                return existingRecord;
            }

            return data?.[0] || existingRecord;
        }

        const { data, error } = await supabase
            .from('verification_logs')
            .insert({
                user_id: userId,
                ...payload
            })
            .select('*')
            .limit(1);

        if (error) {
            console.warn('[Verify] Failed to insert tracked job log:', error.message);
            return null;
        }

        return data?.[0] || null;
    } catch (error) {
        console.warn('[Verify] Tracked job log upsert failed:', error.message);
        return existingRecord;
    }
}

async function findExistingJobDeduction(userId, jobId, site = 'cn') {
    if (!userId || !jobId) return 0;

    const runQuery = async (withSite) => {
        let query = supabase
            .from('points_ledger')
            .select('amount')
            .eq('user_id', userId)
            .eq('reference_id', jobId)
            .lt('amount', 0)
            .order('created_at', { ascending: false })
            .limit(1);

        if (withSite) {
            query = query.eq('site', site);
        }

        return query;
    };

    try {
        let { data, error } = await runQuery(true);
        if (error) {
            ({ data, error } = await runQuery(false));
        }

        if (error) {
            console.warn('[Verify] Failed to inspect points ledger:', error.message);
            return 0;
        }

        const amount = Number(data?.[0]?.amount);
        return Number.isFinite(amount) ? Math.abs(amount) : 0;
    } catch (error) {
        console.warn('[Verify] Points ledger lookup failed:', error.message);
        return 0;
    }
}

async function deductPointsForJob(userId, jobId, amount, site = 'cn') {
    const existingDeduction = await findExistingJobDeduction(userId, jobId, site);
    if (existingDeduction > 0) {
        return existingDeduction;
    }

    const adminSiteRpcParams = {
        p_target_user_id: userId,
        p_amount: amount,
        p_reason: 'Google One 链接获取服务',
        p_reference_id: jobId,
        p_site: site
    };

    let { data: deductData, error: deductError } = await supabase.rpc('fn_deduct_points_admin_site', adminSiteRpcParams);

    if (deductError) {
        console.warn('[Verify] fn_deduct_points_admin_site unavailable, falling back:', deductError.message);
        ({ data: deductData, error: deductError } = await supabase.rpc('fn_deduct_points', {
            p_target_user_id: userId,
            p_amount: amount,
            p_reason: 'Google One 链接获取服务',
            p_reference_id: jobId
        }));
    }

    if (deductError) {
        console.error('[Verify] Failed to deduct points:', deductError);
        return 0;
    }

    return Number(deductData?.deducted) || amount;
}

async function syncTrackedJobStatus({
    userId,
    site = 'cn',
    email = '',
    jobId,
    apiData = {},
    config = null
}) {
    if (!userId || !jobId) {
        return { pointsDeducted: 0, record: null };
    }

    const lockKey = `${site}:${userId}:${jobId}`;
    return withJobSyncLock(lockKey, async () => {
        let existingRecord = await findTrackedJobLog(userId, jobId, site);
        const upstreamStatus = String(apiData?.status || '').toLowerCase();

        if (!upstreamStatus) {
            return {
                pointsDeducted: Number(existingRecord?.points_deducted) || 0,
                record: existingRecord
            };
        }

        if (!isTerminalTrackedStatus(upstreamStatus)) {
            existingRecord = await upsertTrackedJobLog({
                existingRecord,
                userId,
                site,
                email,
                jobId,
                status: upstreamStatus,
                apiData,
                pointsDeducted: Number(existingRecord?.points_deducted) || 0
            });

            return {
                pointsDeducted: Number(existingRecord?.points_deducted) || 0,
                record: existingRecord
            };
        }

        if (existingRecord && isTerminalTrackedStatus(existingRecord.status)) {
            return {
                pointsDeducted: Number(existingRecord.points_deducted) || 0,
                record: existingRecord
            };
        }

        let pointsDeducted = Number(existingRecord?.points_deducted) || 0;
        const runtimeConfig = config || await getVerifyConfig();

        if (upstreamStatus === 'success') {
            pointsDeducted = await deductPointsForJob(userId, jobId, runtimeConfig.pricePerVerify, site);
        }

        existingRecord = await upsertTrackedJobLog({
            existingRecord,
            userId,
            site,
            email,
            jobId,
            status: upstreamStatus === 'success' ? 'success' : 'failed',
            apiData,
            pointsDeducted
        });

        return { pointsDeducted, record: existingRecord };
    });
}

async function fetchUpstreamJobStatus(config, jobId) {
    const apiRes = await fetch(`${config.apiBaseUrl}/api/jobs/${jobId}`, {
        method: 'GET',
        headers: {
            'X-API-Key': config.apiKey
        }
    });

    const apiData = await apiRes.json().catch(() => ({}));

    if (!apiRes.ok) {
        const errorCode = getApiErrorCode(apiData);
        if (apiRes.status === 404 || errorCode === 'job_not_found') {
            return {
                ok: true,
                data: {
                    job_id: jobId,
                    status: 'failed',
                    error: errorCode || 'job_not_found',
                    message: getApiErrorMessage(apiData, '任务不存在')
                }
            };
        }

        return {
            ok: false,
            status: apiRes.status,
            code: errorCode,
            message: getApiErrorMessage(apiData, '查询状态失败')
        };
    }

    return { ok: true, data: apiData };
}

async function loadPendingTrackedJobs(limit = PENDING_JOB_SWEEP_BATCH_SIZE) {
    try {
        const { data, error } = await supabase
            .from('verification_logs')
            .select('*')
            .in('status', ACTIVE_TRACKED_JOB_STATUSES)
            .order('created_at', { ascending: true })
            .limit(limit);

        if (error) {
            console.warn('[VerifyWorker] Failed to load pending jobs:', error.message);
            return [];
        }

        const seen = new Set();
        const jobs = [];

        for (const row of data || []) {
            const payload = parseHistoryMessage(row.message) || {};
            const jobId = String(payload.job_id || row.verification_id || '').trim();
            const userId = String(row.user_id || '').trim();
            const site = String(row.site || 'cn').trim() || 'cn';
            const email = String(payload.email || '').trim().toLowerCase();
            if (!jobId || !userId) continue;

            const uniqueKey = `${site}:${userId}:${jobId}`;
            if (seen.has(uniqueKey)) continue;
            seen.add(uniqueKey);
            jobs.push({ jobId, userId, site, email });
        }

        return jobs;
    } catch (error) {
        console.warn('[VerifyWorker] Pending job load failed:', error.message);
        return [];
    }
}

async function sweepPendingJobs() {
    if (pendingJobSweepRunning) return;
    pendingJobSweepRunning = true;

    try {
        const config = await getVerifyConfig();
        if (!config.apiKey) return;

        const pendingJobs = await loadPendingTrackedJobs();

        for (const job of pendingJobs) {
            const upstream = await fetchUpstreamJobStatus(config, job.jobId);
            if (!upstream.ok) {
                console.warn(`[VerifyWorker] Failed to poll ${job.jobId}: ${upstream.message}`);
                continue;
            }

            await syncTrackedJobStatus({
                userId: job.userId,
                site: job.site,
                email: job.email,
                jobId: job.jobId,
                apiData: upstream.data,
                config
            });
        }
    } catch (error) {
        console.error('[VerifyWorker] Pending job sweep failed:', error);
    } finally {
        pendingJobSweepRunning = false;
    }
}

function startPendingJobSweep() {
    if (pendingJobSweepTimer) return;

    pendingJobSweepTimer = setInterval(() => {
        sweepPendingJobs().catch((error) => {
            console.error('[VerifyWorker] Sweep tick failed:', error);
        });
    }, PENDING_JOB_SWEEP_INTERVAL_MS);

    setTimeout(() => {
        sweepPendingJobs().catch((error) => {
            console.error('[VerifyWorker] Initial sweep failed:', error);
        });
    }, 1200);
}

function getShopDeliveryWorkerName() {
    return String(
        process.env.SHOP_DELIVERY_WORKER_NAME
        || process.env.RAILWAY_SERVICE_NAME
        || `shop-delivery-worker:${process.pid}`
    ).trim();
}

function clampDeliveryText(value, limit = 4000) {
    if (value == null) return null;
    const text = String(value);
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function buildShopDeliveryBackoffSeconds(attemptCount) {
    const safeAttempt = Math.max(1, Number(attemptCount || 1));
    return Math.min(
        SHOP_DELIVERY_MAX_BACKOFF_SECONDS,
        Math.max(15, Math.pow(2, safeAttempt - 1) * 30)
    );
}

function isRetryableDeliveryStatus(status) {
    const code = Number(status || 0);
    return !code || code === 408 || code === 409 || code === 425 || code === 429 || code >= 500;
}

async function claimShopDeliveryTasks(limit = SHOP_DELIVERY_SWEEP_BATCH_SIZE) {
    const { data, error } = await supabase.rpc('fn_claim_shop_webhook_tasks', {
        p_limit: Math.max(1, Number(limit || SHOP_DELIVERY_SWEEP_BATCH_SIZE)),
        p_lock_seconds: SHOP_DELIVERY_LEASE_SECONDS,
        p_worker_name: getShopDeliveryWorkerName()
    });

    if (error) {
        throw error;
    }

    return Array.isArray(data) ? data : [];
}

async function loadShopDeliveryContext(orderId) {
    if (!orderId) return null;

    const { data: order, error: orderError } = await supabase
        .from('shop_orders')
        .select('id, user_id, product_id, total_price, item_count, snapshot_product_name, delivery_status, delivery_attempt_count, delivery_last_error, created_at')
        .eq('id', orderId)
        .single();

    if (orderError || !order) {
        return null;
    }

    const { data: items } = await supabase
        .from('shop_order_items')
        .select('id, snapshot_product_name, price_paid, inventory_id')
        .eq('order_id', orderId)
        .order('created_at', { ascending: true });

    return {
        ...order,
        items: Array.isArray(items) ? items : []
    };
}

function buildShopDeliveryPayload(task, orderContext) {
    const basePayload = task && typeof task.payload === 'object' && task.payload !== null
        ? task.payload
        : {};

    return {
        ...basePayload,
        _meta: {
            source: 'zaoyoe_shop_delivery_worker',
            task_id: task.id,
            order_id: task.order_id,
            dedupe_key: task.dedupe_key,
            attempt_no: task.attempt_count,
            worker_name: task.worker_name || getShopDeliveryWorkerName(),
            requested_at: new Date().toISOString()
        },
        order: orderContext ? {
            id: orderContext.id,
            user_id: orderContext.user_id,
            product_id: orderContext.product_id,
            product_name: orderContext.snapshot_product_name,
            total_price: orderContext.total_price,
            item_count: orderContext.item_count,
            created_at: orderContext.created_at
        } : undefined,
        items: orderContext?.items || []
    };
}

async function recordShopDeliveryAttempt({
    task,
    success,
    responseStatus = null,
    responseBody = null,
    errorMessage = null,
    startedAt,
    finishedAt,
    durationMs
}) {
    try {
        await supabase
            .from('shop_webhook_task_attempts')
            .insert({
                task_id: task.id,
                attempt_no: Number(task.attempt_count || 0),
                worker_name: task.worker_name || getShopDeliveryWorkerName(),
                started_at: startedAt,
                finished_at: finishedAt,
                success,
                response_status: responseStatus,
                response_body: clampDeliveryText(responseBody, 4000),
                error_message: clampDeliveryText(errorMessage, 1000),
                duration_ms: durationMs
            });
    } catch (error) {
        console.warn('[ShopDeliveryWorker] Failed to record task attempt:', error.message);
    }
}

async function markShopDeliveryTaskSuccess(task, responseStatus, responseBody) {
    const now = new Date().toISOString();
    const updatePayload = {
        status: 'delivered',
        last_response_status: responseStatus,
        last_response_body: clampDeliveryText(responseBody, 4000),
        last_error: null,
        delivered_at: now,
        executed_at: now,
        updated_at: now,
        locked_at: null,
        lock_expires_at: null,
        lock_token: null
    };

    const { error: taskError } = await supabase
        .from('shop_webhook_tasks')
        .update(updatePayload)
        .eq('id', task.id)
        .eq('lock_token', task.lock_token);

    if (taskError) {
        throw taskError;
    }

    const { error: orderError } = await supabase
        .from('shop_orders')
        .update({
            delivery_status: 'delivered',
            delivery_task_id: task.id,
            delivery_attempt_count: Number(task.attempt_count || 0),
            delivery_last_error: null,
            delivery_completed_at: now,
            delivery_updated_at: now
        })
        .eq('id', task.order_id);

    if (orderError) {
        throw orderError;
    }
}

async function markShopDeliveryTaskFailure(task, failure = {}) {
    const now = new Date();
    const retryable = failure.retryable !== false && isRetryableDeliveryStatus(failure.status);
    const maxAttempts = Math.max(1, Number(task.max_attempts || 5));
    const attemptCount = Math.max(1, Number(task.attempt_count || 1));
    const exhausted = attemptCount >= maxAttempts;
    const shouldDeadLetter = !retryable || exhausted;
    const nextAttemptAt = new Date(now.getTime() + buildShopDeliveryBackoffSeconds(attemptCount) * 1000).toISOString();
    const status = shouldDeadLetter ? 'dead_letter' : 'retry_waiting';
    const errorMessage = clampDeliveryText(failure.message || '履约推送失败', 1000);
    const responseBody = clampDeliveryText(failure.body, 4000);

    const { error: taskError } = await supabase
        .from('shop_webhook_tasks')
        .update({
            status,
            next_attempt_at: shouldDeadLetter ? nextAttemptAt : nextAttemptAt,
            last_error: errorMessage,
            last_response_status: failure.status || null,
            last_response_body: responseBody,
            updated_at: now.toISOString(),
            dead_lettered_at: shouldDeadLetter ? now.toISOString() : null,
            locked_at: null,
            lock_expires_at: null,
            lock_token: null
        })
        .eq('id', task.id)
        .eq('lock_token', task.lock_token);

    if (taskError) {
        throw taskError;
    }

    const { error: orderError } = await supabase
        .from('shop_orders')
        .update({
            delivery_status: status,
            delivery_task_id: task.id,
            delivery_attempt_count: attemptCount,
            delivery_last_error: errorMessage,
            delivery_updated_at: now.toISOString()
        })
        .eq('id', task.order_id);

    if (orderError) {
        throw orderError;
    }
}

async function executeShopDeliveryTask(task) {
    const startedAt = new Date();
    const orderContext = await loadShopDeliveryContext(task.order_id);

    if (orderContext?.delivery_status === 'delivered') {
        const finishedAt = new Date();
        await markShopDeliveryTaskSuccess(task, 208, 'order already marked delivered');
        await recordShopDeliveryAttempt({
            task,
            success: true,
            responseStatus: 208,
            responseBody: 'order already marked delivered',
            startedAt: startedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
            durationMs: finishedAt.getTime() - startedAt.getTime()
        });
        return;
    }

    if (!task.target_url) {
        const finishedAt = new Date();
        await markShopDeliveryTaskFailure(task, {
            status: 400,
            retryable: false,
            message: '未配置履约目标地址'
        });
        await recordShopDeliveryAttempt({
            task,
            success: false,
            responseStatus: 400,
            errorMessage: '未配置履约目标地址',
            startedAt: startedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
            durationMs: finishedAt.getTime() - startedAt.getTime()
        });
        return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SHOP_DELIVERY_HTTP_TIMEOUT_MS);
    let responseStatus = null;
    let responseBody = '';

    try {
        const response = await fetch(task.target_url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Zaoyoe-Shop-Delivery-Worker/1.0',
                'X-Zaoyoe-Delivery-Task': String(task.id),
                'X-Zaoyoe-Order-Id': String(task.order_id),
                'Idempotency-Key': task.dedupe_key || `shop_delivery:${task.order_id}`
            },
            body: JSON.stringify(buildShopDeliveryPayload(task, orderContext)),
            signal: controller.signal
        });

        responseStatus = response.status;
        responseBody = await response.text();
        clearTimeout(timeout);

        if (response.ok) {
            const finishedAt = new Date();
            await markShopDeliveryTaskSuccess(task, responseStatus, responseBody);
            await recordShopDeliveryAttempt({
                task,
                success: true,
                responseStatus,
                responseBody,
                startedAt: startedAt.toISOString(),
                finishedAt: finishedAt.toISOString(),
                durationMs: finishedAt.getTime() - startedAt.getTime()
            });
            return;
        }

        const finishedAt = new Date();
        await markShopDeliveryTaskFailure(task, {
            status: responseStatus,
            body: responseBody,
            retryable: isRetryableDeliveryStatus(responseStatus),
            message: `履约接口返回 ${responseStatus}`
        });
        await recordShopDeliveryAttempt({
            task,
            success: false,
            responseStatus,
            responseBody,
            errorMessage: `履约接口返回 ${responseStatus}`,
            startedAt: startedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
            durationMs: finishedAt.getTime() - startedAt.getTime()
        });
    } catch (error) {
        clearTimeout(timeout);
        const finishedAt = new Date();
        const isAbort = error?.name === 'AbortError';
        await markShopDeliveryTaskFailure(task, {
            status: isAbort ? 408 : null,
            retryable: true,
            message: isAbort ? '履约请求超时' : (error?.message || '履约请求失败')
        });
        await recordShopDeliveryAttempt({
            task,
            success: false,
            responseStatus: isAbort ? 408 : null,
            errorMessage: isAbort ? '履约请求超时' : (error?.message || '履约请求失败'),
            startedAt: startedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
            durationMs: finishedAt.getTime() - startedAt.getTime()
        });
    }
}

async function sweepShopDeliveryTasks() {
    if (shopDeliverySweepRunning) return;
    shopDeliverySweepRunning = true;

    try {
        const tasks = await claimShopDeliveryTasks();
        for (const task of tasks) {
            try {
                await executeShopDeliveryTask(task);
            } catch (error) {
                console.error(`[ShopDeliveryWorker] Task ${task.id} failed unexpectedly:`, error);
            }
        }
    } catch (error) {
        console.error('[ShopDeliveryWorker] Sweep failed:', error);
    } finally {
        shopDeliverySweepRunning = false;
    }
}

function startShopDeliverySweep() {
    if (shopDeliverySweepTimer) return;

    shopDeliverySweepTimer = setInterval(() => {
        sweepShopDeliveryTasks().catch((error) => {
            console.error('[ShopDeliveryWorker] Sweep tick failed:', error);
        });
    }, SHOP_DELIVERY_SWEEP_INTERVAL_MS);

    setTimeout(() => {
        sweepShopDeliveryTasks().catch((error) => {
            console.error('[ShopDeliveryWorker] Initial sweep failed:', error);
        });
    }, 1800);
}

async function hasLoggedJobResult(userId, jobId, site = 'cn') {
    if (!userId || !jobId) return false;

    try {
        const { data, error } = await supabase
            .from('verification_logs')
            .select('message')
            .eq('user_id', userId)
            .eq('site', site)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) {
            console.warn('[Verify] Failed to inspect history for dedupe:', error.message);
            return false;
        }

        return (data || []).some((row) => parseHistoryMessage(row.message)?.job_id === jobId);
    } catch (error) {
        console.warn('[Verify] History dedupe check failed:', error.message);
        return false;
    }
}

async function logVerificationResult({
    userId,
    site = 'cn',
    email,
    jobId,
    status,
    url = '',
    errorCode = '',
    errorMessage = '',
    stageLabel = '',
    rawStatus = '',
    pointsDeducted = 0
}) {
    if (!userId) return;

    const message = buildHistoryMessage({
        email: email || '',
        job_id: jobId || '',
        url: url || '',
        error_code: errorCode || '',
        error_message: errorMessage || '',
        stage_label: stageLabel || '',
        raw_status: rawStatus || status || '',
        logged_at: new Date().toISOString()
    });

    try {
        await supabase.from('verification_logs').insert({
            user_id: userId,
            verification_id: email || jobId || '--',
            status,
            message,
            points_deducted: pointsDeducted,
            batch_count: 1,
            batch_success: status === 'success' ? 1 : 0,
            batch_failed: status === 'success' ? 0 : 1,
            site
        });
    } catch (error) {
        console.warn('[Verify] Failed to log verification result:', error.message);
    }
}

async function validateUserBalance(userId, requiredPoints, site = 'cn') {
    if (!userId) {
        return { valid: false, error: '请先登录', status: 400 };
    }

    const { data: balanceData, error: balanceError } = await supabase
        .rpc('fn_get_user_balance', { p_user_id: userId, p_site: site })
        .single();

    if (balanceError) {
        console.error('[Verify] Balance check error:', balanceError);
        return { valid: false, error: '查询积分失败', status: 500 };
    }

    const currentBalance = balanceData?.total_balance || 0;

    if (currentBalance < requiredPoints) {
        return {
            valid: false,
            error: `积分不足，需要 ${requiredPoints} 积分，当前余额 ${currentBalance}`,
            status: 400,
            balance: currentBalance
        };
    }

    return { valid: true, balance: currentBalance };
}

// =============================================
// POST /api/verify — Submit a Google One job
// =============================================
app.post('/api/verify', async (req, res) => {
    const { email, password, totpSecret, totp_secret, priority, userId, site } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedPassword = String(password || '');
    const normalizedTotpSecret = String(totpSecret || totp_secret || '').trim();
    const normalizedPriority = Number(priority) === 1 ? 1 : 0;
    const currentSite = getCurrentSite(req, site);

    if (!normalizedEmail || !normalizedPassword || !normalizedTotpSecret) {
        return res.status(400).json({
            success: false,
            message: '请提供邮箱、密码和 TOTP 密钥',
            code: 'missing_fields'
        });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return res.status(400).json({
            success: false,
            message: '邮箱格式无效',
            code: 'invalid_email'
        });
    }

    try {
        const config = await getVerifyConfig();

        if (!config.apiKey) {
            return res.status(500).json({
                success: false,
                message: 'Google One API Key 未配置',
                code: 'api_key_missing'
            });
        }

        const balanceCheck = await validateUserBalance(userId, config.pricePerVerify, currentSite);
        if (!balanceCheck.valid) {
            return res.status(balanceCheck.status).json({ success: false, message: balanceCheck.error });
        }

        console.log(`[Verify] Submitting Google One job: ${normalizedEmail}`);

        const apiRes = await fetch(`${config.apiBaseUrl}/api/jobs`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': config.apiKey
            },
            body: JSON.stringify({
                email: normalizedEmail,
                password: normalizedPassword,
                totp_secret: normalizedTotpSecret,
                priority: normalizedPriority
            })
        });

        const apiData = await apiRes.json().catch(() => ({}));

        if (!apiRes.ok) {
            console.error('[Verify] API error:', apiData);
            return res.status(apiRes.status).json({
                success: false,
                message: getApiErrorMessage(apiData, '任务提交失败'),
                code: getApiErrorCode(apiData)
            });
        }

        const jobId = String(apiData.job_id || '').trim();
        if (jobId && userId) {
            await syncTrackedJobStatus({
                userId,
                site: currentSite,
                email: normalizedEmail,
                jobId,
                apiData: {
                    ...apiData,
                    status: apiData.status || 'queued'
                },
                config
            });
        }

        return res.json({
            success: true,
            task_id: jobId,
            job_id: jobId,
            status: apiData.status || 'queued',
            queue_position: apiData.queue_position ?? -1,
            estimated_wait_seconds: apiData.estimated_wait_seconds ?? 0,
            message: '任务已提交',
            pricePerVerify: config.pricePerVerify
        });

    } catch (error) {
        console.error('[Verify] Submit error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || '验证服务暂时不可用'
        });
    }
});

// =============================================
// GET /api/verify/status/:taskId — Poll job status
// =============================================
app.get('/api/verify/status/:taskId', async (req, res) => {
    const { taskId } = req.params;
    const { userId, site, email } = req.query;
    const currentSite = getCurrentSite(req, site);

    try {
        const config = await getVerifyConfig();

        if (!config.apiKey) {
            return res.status(500).json({ success: false, message: '验证服务未配置', code: 'api_key_missing' });
        }

        const upstream = await fetchUpstreamJobStatus(config, taskId);
        if (!upstream.ok) {
            return res.status(upstream.status).json({
                success: false,
                message: upstream.message,
                code: upstream.code
            });
        }

        const apiData = upstream.data;
        let pointsDeducted = 0;

        if (userId) {
            const syncResult = await syncTrackedJobStatus({
                userId: String(userId),
                site: currentSite,
                email: String(email || ''),
                jobId: taskId,
                apiData,
                config
            });
            pointsDeducted = Number(syncResult?.pointsDeducted) || 0;
        }

        return res.json({
            success: apiData.status === 'success',
            job_id: apiData.job_id || taskId,
            status: apiData.status,
            stage: apiData.stage,
            total_stages: apiData.total_stages,
            stage_label: apiData.stage_label,
            url: apiData.url || '',
            error: apiData.error || '',
            created_at: apiData.created_at,
            elapsed_seconds: apiData.elapsed_seconds,
            queue_position: apiData.queue_position,
            estimated_wait_seconds: apiData.estimated_wait_seconds,
            message: buildClientStatusMessage(apiData),
            pointsDeducted
        });

    } catch (error) {
        console.error('[Verify] Status check error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || '查询状态失败'
        });
    }
});

// =============================================
// GET /api/quota — Check current API key balance
// =============================================
app.get('/api/quota', async (req, res) => {
    try {
        const config = await getVerifyConfig();

        if (!config.apiKey) {
            return res.status(500).json({ success: false, message: '验证服务未配置 API Key' });
        }

        const apiRes = await fetch(`${config.apiBaseUrl}/api/balance`, {
            method: 'GET',
            headers: { 'X-API-Key': config.apiKey }
        });

        const apiData = await apiRes.json().catch(() => ({}));

        if (!apiRes.ok) {
            return res.status(apiRes.status).json({
                success: false,
                message: getApiErrorMessage(apiData, '查询额度失败'),
                code: getApiErrorCode(apiData)
            });
        }

        return res.json({
            success: true,
            credits: Number(apiData.balance || 0),
            balance: Number(apiData.balance || 0),
            total_used: apiData.total_used || 0,
            cost_per_job: apiData.cost_per_job || 1,
            key_name: apiData.name || ''
        });

    } catch (error) {
        console.error('[Verify] Quota check error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || '查询额度失败'
        });
    }
});

// =============================================
// GET /api/queue — Inspect upstream queue status
// =============================================
app.get('/api/queue', async (req, res) => {
    try {
        const config = await getVerifyConfig();

        if (!config.apiKey) {
            return res.status(500).json({ success: false, message: '验证服务未配置 API Key' });
        }

        const apiRes = await fetch(`${config.apiBaseUrl}/api/queue`, {
            method: 'GET',
            headers: { 'X-API-Key': config.apiKey }
        });

        const apiData = await apiRes.json().catch(() => ({}));

        if (!apiRes.ok) {
            return res.status(apiRes.status).json({
                success: false,
                message: getApiErrorMessage(apiData, '查询队列失败'),
                code: getApiErrorCode(apiData)
            });
        }

        return res.json({ success: true, ...apiData });

    } catch (error) {
        console.error('[Verify] Queue check error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || '查询队列失败'
        });
    }
});

// =============================================
// POST /api/redeem — Legacy endpoint kept for compatibility
// =============================================
app.post('/api/redeem', async (req, res) => {
    return res.status(410).json({
        success: false,
        message: '新版 Google One API 不再支持卡密兑换，请在上游后台管理 API Key 余额。',
        code: 'redeem_not_supported'
    });
});

// =============================================
// POST /api/cancel — Legacy endpoint kept for compatibility
// =============================================
app.post('/api/cancel', async (req, res) => {
    return res.status(410).json({
        success: false,
        message: '新版 Google One API 不支持取消已提交任务，请等待任务结束。',
        code: 'cancel_not_supported'
    });
});

// POST /api/afdian/webhook
app.post('/api/afdian/webhook', async (req, res) => {
    console.log('[Afdian] Webhook received');

    const payload = req.body || {};
    const data = payload.data || {};
    const order = data.order || {};
    const orderNo = String(order.out_trade_no || '').trim();
    const status = Number(order.status);
    const eventKey = buildAfdianEventKey(orderNo, status, payload);

    try {
        console.log('[Afdian] Raw payload:', JSON.stringify(payload).substring(0, 500));

        const eventInsert = await recordPaymentEvent({
            provider: 'afdian',
            provider_order_no: orderNo || null,
            event_key: eventKey,
            event_type: 'webhook',
            signature_valid: false,
            payload,
            processing_result: 'received'
        });

        if (eventInsert.duplicate) {
            console.log('[Afdian] Duplicate webhook ignored:', eventKey);
            return res.json({ ec: 200, em: '' });
        }

        if (!orderNo) {
            await finalizePaymentEvent(eventKey, {
                processing_result: 'invalid_order_no',
                error_message: 'missing out_trade_no'
            });
            return res.status(400).json({ ec: 400, em: 'missing order number' });
        }

        if (payload.ec !== 200) {
            console.warn('[Afdian] Non-success payload:', payload.ec, payload.em);
            await finalizePaymentEvent(eventKey, {
                processing_result: 'ignored_non_success_ec',
                error_message: payload.em || 'non-success ec'
            });
            return res.json({ ec: 200, em: '' });
        }

        if (data?.type !== 'order' || !data?.order) {
            await finalizePaymentEvent(eventKey, {
                processing_result: 'ignored_non_order_event'
            });
            return res.json({ ec: 200, em: '' });
        }

        if (status !== 2) {
            await finalizePaymentEvent(eventKey, {
                processing_result: 'ignored_non_paid_status'
            });
            return res.json({ ec: 200, em: '' });
        }

        const afdianRuntime = await afdianProvider.resolveRuntimeContext({
            supabase,
            env: process.env
        });
        const afdianToken = afdianRuntime.secretValues?.afdian_token || process.env.AFDIAN_TOKEN;
        if (!afdianToken) {
            await finalizePaymentEvent(eventKey, {
                processing_result: 'missing_afdian_token',
                error_message: 'AFDIAN_TOKEN is not configured'
            });
            return res.status(503).json({ ec: 503, em: 'payment webhook not configured' });
        }

        if (!payload.sign) {
            await finalizePaymentEvent(eventKey, {
                processing_result: 'missing_signature',
                error_message: 'missing sign'
            });
            return res.status(401).json({ ec: 401, em: 'missing signature' });
        }

        const signatureCheck = afdianProvider.verifyWebhook({
            payload,
            token: afdianToken
        });
        const signatureValid = signatureCheck.valid;
        const amount = roundCurrencyAmount(order.total_amount || 0);
        const resolvedPackage = await resolveAfdianPackage({
            planId: order.plan_id,
            amount
        });
        const amountValid = !!resolvedPackage && amountsMatch(resolvedPackage.expectedAmount, amount);
        const processError = afdianProvider.deriveProcessError({
            signatureValid,
            resolvedPackage,
            amount,
            amountValid
        });

        const { data: processResult, error: processRpcError } = await supabase.rpc('fn_process_afdian_payment', {
            p_order_no: orderNo,
            p_afdian_user_id: String(order.user_id || ''),
            p_plan_id: order.plan_id || null,
            p_paid_amount: amount,
            p_expected_amount: resolvedPackage?.expectedAmount ?? amount,
            p_points: resolvedPackage?.pointsTotal ?? 0,
            p_package_id: resolvedPackage?.packageId ?? null,
            p_package_name: resolvedPackage?.packageName ?? null,
            p_site: getCurrentSite(req),
            p_signature_valid: signatureValid,
            p_amount_valid: amountValid,
            p_payload: payload,
            p_error: processError
        });

        if (processRpcError) {
            await finalizePaymentEvent(eventKey, {
                processing_result: 'process_rpc_failed',
                error_message: processRpcError.message
            });
            console.error('[Afdian] Failed to process payment:', processRpcError);
            return res.status(500).json({ ec: 500, em: 'internal error' });
        }

        if (processResult?.payment_order_id) {
            try {
                await reconcileCheckoutSessionForPaymentOrder({
                    supabase,
                    providerKey: 'afdian',
                    paymentOrderId: processResult.payment_order_id,
                    providerOrderNo: orderNo,
                    site: getCurrentSite(req),
                    packageId: resolvedPackage?.packageId ?? null,
                    packageName: resolvedPackage?.packageName ?? null,
                    expectedAmount: resolvedPackage?.expectedAmount ?? amount,
                    paidAmount: amount,
                    pointsAmount: resolvedPackage?.pointsTotal ?? 0,
                    orderStatus: processResult?.status || (signatureValid && amountValid ? 'paid' : 'pending_review'),
                    linkedBy: 'afdian_webhook',
                    allowHeuristic: true,
                    lookbackMinutes: 120
                });
            } catch (linkError) {
                console.warn('[Afdian] Failed to link checkout session from webhook:', linkError.message);
            }
        }

        await finalizePaymentEvent(eventKey, {
            payment_order_id: processResult?.payment_order_id || null,
            signature_valid: signatureValid,
            amount_valid: amountValid,
            processing_result: signatureValid && amountValid ? 'processed_paid' : (processResult?.status || 'pending_review'),
            error_message: processError || null
        });

        if (!signatureValid) {
            return res.status(401).json({ ec: 401, em: 'invalid signature' });
        }

        if (!amountValid) {
            return res.json({ ec: 200, em: 'pending review' });
        }

        return res.json({ ec: 200, em: '' });
    } catch (error) {
        console.error('[Afdian] Webhook error:', error);
        await finalizePaymentEvent(eventKey, {
            processing_result: 'webhook_exception',
            error_message: error.message
        });
        return res.status(500).json({ ec: 500, em: 'internal error' });
    }
});

// GET /api/afdian/query - Query redemption code by order number
app.get('/api/afdian/query', async (req, res) => {
    const orderNo = String(req.query.order_no || '').trim();

    if (!orderNo) {
        return res.status(400).json({ success: false, message: '请输入订单号' });
    }

    try {
        const user = await getAuthenticatedUser(req);
        if (!user) {
            return res.status(401).json({ success: false, message: '请先登录后再查询订单' });
        }

        const { data, error } = await supabase.rpc('fn_claim_and_query_afdian_code', {
            p_order_no: orderNo,
            p_user_id: user.id
        });

        if (error) {
            console.error('[Afdian] Query error:', error);
            if (/Access denied/i.test(error.message || '')) {
                return res.status(403).json({ success: false, message: '该订单已归属其他账号，无法查询' });
            }
            return res.status(500).json({ success: false, message: '查询失败' });
        }

        if (!data || data.length === 0) {
            return res.json({ success: false, message: '未找到该订单' });
        }

        const orderInfo = data[0];
        try {
            const { data: paymentOrder } = await supabase
                .from('payment_orders')
                .select('id, site, package_id, package_name, expected_amount, paid_amount, points_amount, status')
                .eq('provider', 'afdian')
                .eq('provider_order_no', orderNo)
                .maybeSingle();

            if (paymentOrder?.id) {
                await reconcileCheckoutSessionForPaymentOrder({
                    supabase,
                    providerKey: 'afdian',
                    paymentOrderId: paymentOrder.id,
                    providerOrderNo: orderNo,
                    userId: user.id,
                    site: paymentOrder.site,
                    packageId: paymentOrder.package_id,
                    packageName: paymentOrder.package_name,
                    expectedAmount: paymentOrder.expected_amount,
                    paidAmount: paymentOrder.paid_amount,
                    pointsAmount: paymentOrder.points_amount,
                    orderStatus: paymentOrder.status,
                    linkedBy: 'afdian_query_claim',
                    allowHeuristic: true,
                    lookbackMinutes: 1440
                });
            }
        } catch (linkError) {
            console.warn('[Afdian] Failed to link checkout session from query claim:', linkError.message);
        }

        if (!orderInfo.code) {
            const currentStatus = String(orderInfo.payment_status || 'pending_review');
            const message = currentStatus === 'rejected'
                ? '订单验签失败，已拦截，请联系客服'
                : currentStatus === 'amount_mismatch'
                    ? '订单金额校验异常，正在审核'
                    : '订单已记录，兑换码生成中，请稍后再试';
            return res.json({
                success: false,
                message,
                status: currentStatus
            });
        }

        return res.json({
            success: true,
            code: orderInfo.code,
            points: orderInfo.points,
            is_redeemed: orderInfo.is_redeemed,
            created_at: orderInfo.created_at,
            payment_status: orderInfo.payment_status
        });

    } catch (error) {
        console.error('[Afdian] Query exception:', error);
        return res.status(500).json({ success: false, message: '服务暂时不可用' });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Verify proxy server running on port ${PORT}`);
    startPendingJobSweep();
    startShopDeliverySweep();
});
