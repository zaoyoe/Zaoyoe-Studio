'use strict';

/**
 * Durable worker for the isolated guest-shop cash channel.
 *
 * The worker intentionally has no process-local queue.  Every retry marker is
 * persisted in guest_shop_orders.metadata and every stock transition is made
 * by the SECURITY DEFINER RPCs from the guest-shop migration.  A cron request
 * (or a long-running process) can therefore stop and restart without losing a
 * paid order or silently releasing stock.
 */

const crypto = require('node:crypto');
const {
    guestWorkerRequestDeclaresBody
} = require('../api/_lib/guest-shop/raw-body');
const {
    parseRuntimeNumericSetting
} = require('../api/_lib/guest-shop/runtime-config');
const {
    parseBuyerCredentialSwitch
} = require('../api/_lib/guest-shop/buyer-credentials');

const FULFILLMENT_STATE_KEY = '__guest_shop_worker';
// A guest worker is a financial side-effect endpoint.  It must not inherit a
// broad application/cron credential: a leaked CRON_SECRET could otherwise
// trigger inventory consumption or refunds.  Legacy names remain listed only
// for migration diagnostics; authorization never falls back to them.
const WORKER_SECRET_ENV_NAMES = Object.freeze([
    'GUEST_SHOP_WORKER_SECRET'
]);
const WORKER_SECRET_HEADER_NAMES = Object.freeze([
    'x-guest-shop-worker-secret'
]);

const DEFAULT_BATCH_SIZE = 20;
const MAX_BATCH_SIZE = 100;
const DEFAULT_MAX_ATTEMPTS = 8;
const DEFAULT_REFUND_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_BACKOFF_MS = 15_000;
const DEFAULT_MAX_BACKOFF_MS = 30 * 60 * 1000;
const DEFAULT_LEASE_MS = 2 * 60 * 1000;
const DEFAULT_RETRY_JITTER_RATIO = 0.2;
const MAX_ERROR_MESSAGE_LENGTH = 500;
const ACCESS_AUDIT_RETENTION_SWITCH_ENV = 'GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_ENABLED';
const ACCESS_AUDIT_RETENTION_ENV = 'GUEST_SHOP_BUYER_ACCESS_AUDIT_RETENTION_DAYS';
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const ACCESS_AUDIT_SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const ACCESS_AUDIT_PURGE_BATCH_SIZE = 1000;
const ACCESS_AUDIT_PURGE_MAX_BATCHES = 10;
const TRUE_ENV_VALUES = new Set(['1', 'true', 'yes', 'y', 'on', 'enabled']);
const FALSE_ENV_VALUES = new Set(['0', 'false', 'no', 'n', 'off', 'disabled']);

const FULFILLMENT_CANDIDATE_STATUSES = Object.freeze([
    'pending',
    'fulfilling',
    'failed',
    'paid_unfulfillable'
]);
const REFUND_CANDIDATE_STATUSES = Object.freeze([
    'pending',
    'failed'
]);
// Promo L1 reads `quantity` so the fulfillment loop knows how many cards the
// order paid for. It is a bound on the loop, never on an amount: the money was
// committed by fn_guest_shop_create_order and is not recomputed here.
const CANDIDATE_SELECT = 'id,order_no,site,currency,total_amount,quantity,payment_status,reservation_status,fulfillment_status,refund_status,expires_at,paid_at,fulfilled_at,updated_at,metadata';
// Mirror of guest_shop_orders_quantity_check. Raising it is a migration, not an
// env change, so the loop bound can never be widened at runtime.
const GUEST_ORDER_QUANTITY_CEILING = 5;

const PRODUCTION_MARKER_NAMES = Object.freeze([
    'VERCEL_ENV',
    'RAILWAY_ENVIRONMENT_NAME',
    'DEPLOYMENT_TIER',
    'APP_ENV'
]);

function isProductionLikeRuntime(env = process.env) {
    return PRODUCTION_MARKER_NAMES.some((name) => String(env?.[name] || '').trim().toLowerCase() === 'production');
}

function workerRuntimeConfigError(name, range = '') {
    const error = new Error(`invalid guest worker runtime configuration: ${String(name || 'unknown')}${range ? ` (${range})` : ''}`);
    error.statusCode = 503;
    error.code = 'guest_worker_runtime_config_invalid';
    error.expose = false;
    error.configName = String(name || 'unknown');
    return error;
}

function parseWorkerInteger(env, name, { defaultValue, min, max } = {}) {
    const rawValue = env?.[name];
    const raw = rawValue === undefined || rawValue === null ? '' : String(rawValue).trim();
    if (!raw) return defaultValue;
    if (!/^\d+$/u.test(raw)) throw workerRuntimeConfigError(name, `${min}-${max}`);
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
        throw workerRuntimeConfigError(name, `${min}-${max}`);
    }
    return parsed;
}

function parseWorkerRatio(env, name, { defaultValue, min, max } = {}) {
    const rawValue = env?.[name];
    const raw = rawValue === undefined || rawValue === null ? '' : String(rawValue).trim();
    if (!raw) return defaultValue;
    // Ratios are deliberately decimal-only; exponent notation and Infinity
    // make operational limits difficult to audit and are rejected.
    if (!/^(?:0|[0-9]+(?:\.[0-9]+)?)$/u.test(raw)) {
        throw workerRuntimeConfigError(name, `${min}-${max}`);
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
        throw workerRuntimeConfigError(name, `${min}-${max}`);
    }
    return parsed;
}

function normalizeText(value, maxLength = 200) {
    return String(value == null ? '' : value).trim().slice(0, Math.max(0, Number(maxLength) || 0));
}

function normalizePositiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return Math.min(max, Math.max(min, fallback));
    return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function normalizeNonNegativeInteger(value, fallback, { max = Number.MAX_SAFE_INTEGER } = {}) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return Math.min(max, Math.max(0, fallback));
    return Math.min(max, Math.max(0, Math.floor(parsed)));
}

function resolveWorkerConfig(env = process.env) {
    const config = {
        batchSize: parseWorkerInteger(env, 'GUEST_SHOP_WORKER_BATCH_SIZE', {
            defaultValue: DEFAULT_BATCH_SIZE,
            min: 1,
            max: MAX_BATCH_SIZE
        }),
        maxAttempts: parseWorkerInteger(env, 'GUEST_SHOP_WORKER_MAX_ATTEMPTS', {
            defaultValue: DEFAULT_MAX_ATTEMPTS,
            min: 1,
            max: 50
        }),
        refundMaxAttempts: parseWorkerInteger(env, 'GUEST_SHOP_WORKER_REFUND_MAX_ATTEMPTS', {
            defaultValue: DEFAULT_REFUND_MAX_ATTEMPTS,
            min: 1,
            max: 50
        }),
        baseBackoffMs: parseWorkerInteger(env, 'GUEST_SHOP_WORKER_BASE_BACKOFF_MS', {
            defaultValue: DEFAULT_BASE_BACKOFF_MS,
            min: 1000,
            max: 24 * 60 * 60 * 1000
        }),
        maxBackoffMs: parseWorkerInteger(env, 'GUEST_SHOP_WORKER_MAX_BACKOFF_MS', {
            defaultValue: DEFAULT_MAX_BACKOFF_MS,
            min: 1000,
            max: 7 * 24 * 60 * 60 * 1000
        }),
        leaseMs: parseWorkerInteger(env, 'GUEST_SHOP_WORKER_LEASE_MS', {
            defaultValue: DEFAULT_LEASE_MS,
            min: 10_000,
            max: 30 * 60 * 1000
        }),
        retryJitterRatio: parseWorkerRatio(env, 'GUEST_SHOP_WORKER_RETRY_JITTER_RATIO', {
            defaultValue: DEFAULT_RETRY_JITTER_RATIO,
            min: 0,
            max: 0.5
        })
    };
    if (config.maxBackoffMs < config.baseBackoffMs) {
        throw workerRuntimeConfigError(
            'GUEST_SHOP_WORKER_MAX_BACKOFF_MS',
            '>= GUEST_SHOP_WORKER_BASE_BACKOFF_MS'
        );
    }
    return Object.freeze(config);
}

function parseAccessAuditRetentionSwitch(env = process.env) {
    const raw = String(env?.[ACCESS_AUDIT_RETENTION_SWITCH_ENV] ?? '').trim().toLowerCase();
    if (!raw) return Object.freeze({ present: false, valid: true, enabled: false });
    if (TRUE_ENV_VALUES.has(raw)) return Object.freeze({ present: true, valid: true, enabled: true });
    if (FALSE_ENV_VALUES.has(raw)) return Object.freeze({ present: true, valid: true, enabled: false });
    return Object.freeze({ present: true, valid: false, enabled: false });
}

function resolveAccessAuditRetention(env = process.env) {
    const retentionSwitch = parseAccessAuditRetentionSwitch(env);
    if (!retentionSwitch.valid) {
        return Object.freeze({
            enabled: false,
            valid: false,
            retentionDays: null,
            reason: 'access_audit_retention_switch_invalid'
        });
    }
    if (!retentionSwitch.enabled) {
        const credentialsEnabled = parseBuyerCredentialSwitch(env).enabled;
        return Object.freeze({
            enabled: false,
            valid: !credentialsEnabled,
            retentionDays: null,
            reason: credentialsEnabled
                ? 'access_audit_retention_required'
                : 'access_audit_retention_disabled'
        });
    }

    const retention = parseRuntimeNumericSetting(env, ACCESS_AUDIT_RETENTION_ENV);
    if (!retention.valid) {
        return Object.freeze({
            enabled: true,
            valid: false,
            retentionDays: null,
            reason: 'access_audit_retention_invalid'
        });
    }

    return Object.freeze({
        enabled: true,
        valid: true,
        retentionDays: retention.value,
        reason: 'enabled'
    });
}

function getGuestShopWorkerSecret(env = process.env) {
    // Deliberately do not iterate CRON_SECRET/GUEST_SHOP_CRON_SECRET.  Those
    // credentials are used by unrelated maintenance endpoints and must never
    // authorize a money-moving guest worker.
    return normalizeText(env?.GUEST_SHOP_WORKER_SECRET, 4096);
}

function isStrongWorkerSecret(value, minimumBytes = 32) {
    const normalized = normalizeText(value, 4096);
    if (!normalized || Buffer.byteLength(normalized, 'utf8') < minimumBytes) return false;
    if (/[\u0000-\u001f\u007f]/u.test(normalized)) return false;
    if (/^(?:mock|test|fake|changeme|change[-_ ]?me|placeholder|example)(?:$|[-_ :])/iu.test(normalized)) return false;
    return true;
}

function getHeader(req, name) {
    const wanted = String(name || '').toLowerCase();
    for (const [key, value] of Object.entries(req?.headers || {})) {
        if (String(key || '').toLowerCase() !== wanted) continue;
        return Array.isArray(value) ? String(value[0] || '') : String(value || '');
    }
    return '';
}

function getProvidedWorkerSecret(req) {
    const authorization = normalizeText(getHeader(req, 'authorization'), 4096);
    const bearer = authorization.match(/^Bearer\s+(.+)$/iu);
    if (bearer) return normalizeText(bearer[1], 4096);
    for (const headerName of WORKER_SECRET_HEADER_NAMES) {
        const value = normalizeText(getHeader(req, headerName), 4096);
        if (value) return value;
    }
    return '';
}

function constantTimeEqual(left, right) {
    const a = Buffer.from(String(left || ''));
    const b = Buffer.from(String(right || ''));
    return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function authorizeGuestShopWorkerRequest(req, env = process.env) {
    const expected = getGuestShopWorkerSecret(env);
    if (!expected) return { ok: false, status: 503, reason: 'worker_secret_not_configured' };
    if (isProductionLikeRuntime(env) && !isStrongWorkerSecret(expected)) {
        return { ok: false, status: 503, reason: 'worker_secret_invalid' };
    }
    if (!constantTimeEqual(getProvidedWorkerSecret(req), expected)) {
        return { ok: false, status: 401, reason: 'invalid_worker_secret' };
    }
    return { ok: true, status: 200, reason: 'authorized' };
}

function calculateGuestShopBackoffMs(attempt, options = {}) {
    const safeAttempt = normalizePositiveInteger(attempt, 1, { min: 1, max: 50 });
    const base = normalizePositiveInteger(options.baseBackoffMs, DEFAULT_BASE_BACKOFF_MS, {
        min: 1,
        max: 7 * 24 * 60 * 60 * 1000
    });
    const max = Math.max(
        base,
        normalizePositiveInteger(options.maxBackoffMs, DEFAULT_MAX_BACKOFF_MS, {
            min: 1,
            max: 30 * 24 * 60 * 60 * 1000
        })
    );
    const deterministic = Math.min(max, base * (2 ** Math.min(safeAttempt - 1, 30)));
    const jitterRatio = Math.min(0.5, Math.max(0, Number(options.jitterRatio ?? 0)));
    if (!jitterRatio) return deterministic;
    // A bounded jitter prevents a fleet of cron invocations from retrying the
    // same order in lock-step.  It is deliberately applied after the cap.
    const random = typeof options.random === 'function' ? Number(options.random()) : Math.random();
    const unit = Number.isFinite(random) ? Math.min(1, Math.max(0, random)) : 0.5;
    // Jitter only shortens a retry window.  It must never extend the
    // configured exponential schedule, otherwise operators cannot reason
    // about the maximum retry latency and the contract becomes asymmetric.
    const factor = 1 - jitterRatio + (jitterRatio * unit);
    return Math.max(1, Math.min(deterministic, Math.round(deterministic * factor)));
}

function isPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function cloneMetadata(value) {
    if (!isPlainObject(value)) return {};
    // Metadata is small and must remain JSON serialisable.  Do not retain
    // references supplied by a caller/test double.
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (_) {
        return {};
    }
}

function getWorkerMetadata(order) {
    const metadata = cloneMetadata(order?.metadata);
    const state = isPlainObject(metadata[FULFILLMENT_STATE_KEY])
        ? metadata[FULFILLMENT_STATE_KEY]
        : {};
    return { metadata, state };
}

function setWorkerState(metadata, state) {
    const next = cloneMetadata(metadata);
    next[FULFILLMENT_STATE_KEY] = {
        version: 1,
        ...state
    };
    return next;
}

function parseIsoMs(value) {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

function isRetryDue(state, nowMs) {
    const next = parseIsoMs(state?.next_attempt_at);
    return !next || next <= nowMs;
}

function getActiveLeaseKind(state, nowMs, kinds = ['fulfillment', 'refund']) {
    for (const kind of kinds) {
        const token = normalizeText(state?.[`${kind}_lease_token`], 200);
        const expiresAt = parseIsoMs(state?.[`${kind}_lease_expires_at`]);
        if (token && expiresAt > nowMs) return kind;
    }
    return '';
}

function safeErrorCode(error, fallback = 'guest_worker_error') {
    const raw = normalizeText(error?.code || error?.name || fallback, 120).toLowerCase();
    return /^[a-z0-9][a-z0-9._:-]{0,119}$/u.test(raw) ? raw : fallback;
}

function safeErrorMessage(error, fallback = '游客订单后台处理失败') {
    const source = normalizeText(error?.message || error || fallback, MAX_ERROR_MESSAGE_LENGTH)
        // Provider/RPC errors occasionally echo an opaque payload.  Keep only
        // a short single-line diagnostic and never persist a secret/content.
        .replace(/[\r\n\t]+/gu, ' ')
        .replace(/(?:bearer\s+|sk-|claim[_ -]?secret|password|api[_ -]?key|content\s*[:=]).{0,180}/igu, '[redacted]');
    return source || fallback;
}

function classifyRetryable(error) {
    if (typeof error?.retryable === 'boolean') return error.retryable;
    const status = Number(error?.status || error?.statusCode || error?.status_code || 0);
    if ([408, 409, 425, 429].includes(status) || status >= 500) return true;
    const code = String(error?.code || '').toLowerCase();
    if (/not_found|not_fulfillable|invalid_|mismatch|unsupported|disabled|expired|inconsistent|forbidden/.test(code)) return false;
    return /timeout|timed out|network|fetch failed|connection|econn|socket|temporar|unavailable|gateway|rate.?limit|deadlock|serialization/i.test(
        String(error?.message || error || '')
    );
}

function firstRow(data) {
    return Array.isArray(data) ? (data[0] || null) : (data || null);
}

function getMutationResult(result) {
    if (!result) return { data: null, error: null };
    return {
        data: firstRow(result.data),
        error: result.error || null
    };
}

function createWorkerToken(randomBytes = crypto.randomBytes) {
    try {
        return randomBytes(18).toString('hex');
    } catch (_) {
        return crypto.createHash('sha256').update(`${Date.now()}:${process.pid}:${Math.random()}`).digest('hex').slice(0, 36);
    }
}

function createGuestShopWorker({
    supabase,
    paymentAdapter = null,
    env = process.env,
    workerName = '',
    now = () => new Date(),
    logger = console,
    randomBytes = crypto.randomBytes
} = {}) {
    const config = resolveWorkerConfig(env);
    const accessAuditRetention = resolveAccessAuditRetention(env);
    const trace = isGuestShopFulfillmentTraceEnabled(env);
    const name = normalizeText(
        workerName || env?.GUEST_SHOP_WORKER_NAME || `guest-shop-worker:${process.pid}`,
        160
    );

    function currentDate() {
        const value = typeof now === 'function' ? now() : now;
        const date = value instanceof Date ? value : new Date(value);
        return Number.isFinite(date.getTime()) ? date : new Date();
    }

    function requireDb() {
        if (!supabase || typeof supabase.from !== 'function' || typeof supabase.rpc !== 'function') {
            const error = new Error('游客履约数据库不可用');
            error.code = 'guest_worker_database_unavailable';
            error.retryable = true;
            throw error;
        }
        return supabase;
    }

    async function callRpc(name, params) {
        const db = requireDb();
        const result = await db.rpc(name, params);
        if (result?.error) throw result.error;
        return firstRow(result?.data);
    }

    async function fetchCandidateRows(limit, filters = []) {
        const db = requireDb();
        let query = db.from('guest_shop_orders').select(CANDIDATE_SELECT);
        for (const filter of filters) {
            if (filter.type === 'eq') {
                if (typeof query.eq !== 'function') return [];
                query = query.eq(filter.field, filter.value);
            } else if (filter.type === 'in') {
                // The worker mock and some thin clients have no `.or()`.
                // Missing `.in()` must fail closed to an empty scan rather
                // than loading every guest order.
                if (typeof query.in !== 'function') return [];
                query = query.in(filter.field, filter.value);
            }
        }
        if (typeof query.order === 'function') query = query.order('updated_at', { ascending: true });
        if (typeof query.limit === 'function') query = query.limit(limit);
        const result = await query;
        if (result?.error) throw result.error;
        return Array.isArray(result?.data) ? result.data : [];
    }

    async function loadCandidates(limit) {
        // Two queries, then merge by id.  A single `.or()` would miss
        // delivered/dead_letter orders that an admin queued for refund,
        // and the current worker mock does not implement `.or()`.
        const [fulfillmentRows, refundRows] = await Promise.all([
            fetchCandidateRows(limit, [
                { type: 'eq', field: 'payment_status', value: 'confirmed' },
                { type: 'in', field: 'fulfillment_status', value: FULFILLMENT_CANDIDATE_STATUSES }
            ]),
            fetchCandidateRows(limit, [
                { type: 'in', field: 'refund_status', value: REFUND_CANDIDATE_STATUSES }
            ])
        ]);
        const byId = new Map();
        for (const row of [...fulfillmentRows, ...refundRows]) {
            const id = String(row?.id || '').trim();
            if (!id || byId.has(id)) continue;
            byId.set(id, row);
        }
        return Array.from(byId.values())
            .sort((left, right) => String(left.updated_at || '').localeCompare(String(right.updated_at || '')))
            .slice(0, limit);
    }

    async function loadPayment(orderId) {
        const db = requireDb();
        let query = db.from('guest_shop_payment_orders')
            .select('id,guest_order_id,merchant_order_no,purpose,provider,channel,provider_order_no,site,currency,expected_amount,paid_amount,status,provider_metadata,checkout_reference,expires_at');
        if (typeof query.eq === 'function') query = query.eq('guest_order_id', orderId);
        if (typeof query.eq === 'function') query = query.eq('purpose', 'shop_direct');
        if (typeof query.maybeSingle === 'function') query = query.maybeSingle();
        const result = await query;
        if (result?.error) throw result.error;
        return result?.data || null;
    }

    async function updateOrder(order, patch = {}, metadata = undefined, {
        leaseToken = '',
        checkPaymentStatus = true
    } = {}) {
        const db = requireDb();
        const payload = {
            ...patch,
            ...(metadata === undefined ? {} : { metadata }),
            updated_at: currentDate().toISOString()
        };
        let query = db.from('guest_shop_orders').update(payload).eq('id', order.id);
        // Do not let an old worker overwrite a newer terminal state.  The
        // status predicate is intentionally conservative; RPCs remain the
        // final authority for stock/payment transitions.
        // A provider/RPC transition can legitimately change payment_status
        // between lease acquisition and completion (e.g. a successful refund
        // changes confirmed -> refunded).  Lease-owned writes therefore use
        // the lease token as the authoritative CAS and must not retain the
        // stale payment-status predicate.
        if (checkPaymentStatus && order.payment_status && typeof query.eq === 'function') {
            query = query.eq('payment_status', order.payment_status);
        }
        if (leaseToken) {
            if (typeof query.contains !== 'function') {
                const error = new Error('游客履约数据库不支持租约 CAS');
                error.code = 'guest_worker_lease_filter_unavailable';
                error.retryable = true;
                throw error;
            }
            query = query.contains('metadata', {
                [FULFILLMENT_STATE_KEY]: {
                    // JSON containment is recursive and permits the update to
                    // preserve unrelated worker metadata while ensuring this
                    // exact lease token still owns the row.
                    [`${leaseToken.kind || 'fulfillment'}_lease_token`]: leaseToken.value
                }
            });
        }
        if (typeof query.select === 'function') {
            query = query.select('id,metadata,updated_at,payment_status,fulfillment_status,refund_status').maybeSingle();
        }
        const result = await query;
        if (result?.error) throw result.error;
        return result?.data || null;
    }

    async function acquireLease(order, kind, state, nowDate) {
        const activeKind = getActiveLeaseKind(state, nowDate.getTime());
        if (activeKind) {
            // A non-expired lease belongs to another in-flight invocation (or
            // to this process after a re-entrant scheduling attempt).  Never
            // steal it merely because a cron tick saw the same row.  Once the
            // persisted expiry passes, the updated_at CAS below permits safe
            // crash recovery.
            return null;
        }
        const nowIso = nowDate.toISOString();
        const leaseToken = createWorkerToken(randomBytes);
        const nextState = {
            ...state,
            version: 1,
            [kind]: 'processing',
            [`${kind}_attempt_count`]: normalizeNonNegativeInteger(state?.[`${kind}_attempt_count`], 0) + 1,
            [`${kind}_last_attempt_at`]: nowIso,
            [`${kind}_lease_expires_at`]: new Date(nowDate.getTime() + config.leaseMs).toISOString(),
            [`${kind}_worker`]: name,
            [`${kind}_lease_token`]: leaseToken,
            next_attempt_at: null
        };
        const { metadata } = getWorkerMetadata(order);
        const nextMetadata = setWorkerState(metadata, nextState);
        let query = requireDb().from('guest_shop_orders').update({
            metadata: nextMetadata,
            fulfillment_status: kind === 'fulfillment' ? 'fulfilling' : order.fulfillment_status,
            updated_at: nowIso
        }).eq('id', order.id);

        // updated_at is an optimistic compare-and-swap.  If another worker
        // won the lease, PostgREST returns no row and this invocation skips it.
        // A worker that already owns the order may perform a second lease for
        // compensation after the claim RPC updates `updated_at`.  In that
        // case the original compare-and-swap timestamp is intentionally not
        // reused; the order lock/RPC and provider idempotency remain the
        // authority for that same execution.
        if (order.updated_at && !order._workerLeaseOwned && typeof query.eq === 'function') {
            query = query.eq('updated_at', order.updated_at);
        }
        if (typeof query.select === 'function') query = query.select('id,metadata,updated_at,fulfillment_status,payment_status,refund_status').maybeSingle();
        const result = await query;
        if (result?.error) throw result.error;
        if (order.updated_at && !result?.data) return null;
        return {
            token: leaseToken,
            state: nextState,
            metadata: nextMetadata,
            order: { ...order, ...(result?.data || {}), metadata: nextMetadata, _workerLeaseOwned: true }
        };
    }

    async function releaseLease(order, kind, statePatch = {}, { terminal = false, patch = {} } = {}) {
        const { metadata, state } = getWorkerMetadata(order);
        const nextState = {
            ...state,
            ...statePatch,
            [`${kind}_lease_token`]: null,
            [`${kind}_lease_expires_at`]: null,
            [`${kind}_worker`]: null
        };
        if (terminal) nextState[`${kind}_terminal`] = true;
        const leaseToken = normalizeText(state?.[`${kind}_lease_token`], 200);
        if (!leaseToken) return null;
        return updateOrder(order, patch, setWorkerState(metadata, nextState), {
            leaseToken: { kind, value: leaseToken },
            checkPaymentStatus: false
        });
    }

    async function markRetry(order, kind, attempt, error, { forceDeadLetter = false, patch = {} } = {}) {
        const retryable = !forceDeadLetter && classifyRetryable(error);
        const maxAttempts = kind === 'refund' ? config.refundMaxAttempts : config.maxAttempts;
        const exhausted = attempt >= maxAttempts;
        const deadLetter = !retryable || exhausted;
        const date = currentDate();
        const message = safeErrorMessage(error);
        const code = safeErrorCode(error, `guest_${kind}_failed`);
        const delay = calculateGuestShopBackoffMs(attempt, {
            baseBackoffMs: config.baseBackoffMs,
            maxBackoffMs: config.maxBackoffMs,
            jitterRatio: config.retryJitterRatio,
            random: () => {
                try { return randomBytes(4).readUInt32BE(0) / 0xffffffff; } catch (_) { return 0.5; }
            }
        });
        const { metadata, state } = getWorkerMetadata(order);
        const nextState = {
            ...state,
            [`${kind}_attempt_count`]: attempt,
            [`${kind}_last_error_code`]: code,
            [`${kind}_last_error_message`]: message,
            [`${kind}_status`]: deadLetter ? 'dead_letter' : 'retry_waiting',
            [`${kind}_next_attempt_at`]: deadLetter ? null : new Date(date.getTime() + delay).toISOString(),
            [`${kind}_lease_token`]: null,
            [`${kind}_lease_expires_at`]: null,
            [`${kind}_worker`]: null,
            [`${kind}_dead_lettered_at`]: deadLetter ? date.toISOString() : null
        };
        const orderPatch = {
            ...patch,
            last_error_code: code,
            last_error_message: message
        };
        // `failed` is retryable; dead_letter is terminal and visible in the
        // existing admin view.  Never downgrade delivered/refunded orders.
        if (kind === 'fulfillment' && !['delivered', 'refunded', 'paid_unfulfillable', 'dead_letter'].includes(order.fulfillment_status)) {
            orderPatch.fulfillment_status = deadLetter ? 'dead_letter' : 'failed';
        }
        if (kind === 'refund' && deadLetter && !['delivered', 'refunded'].includes(order.fulfillment_status)) {
            // The refund RPC is called before this path when possible.  A
            // dead-letter marker makes an unresolved compensation visible to
            // operators without pretending that money was returned.
            orderPatch.fulfillment_status = 'dead_letter';
        }
        const leaseToken = normalizeText(state?.[`${kind}_lease_token`], 200);
        if (!leaseToken) return { status: 'skipped', reason: 'lease_lost' };
        try {
            const persisted = await updateOrder(order, orderPatch, setWorkerState(metadata, nextState), {
                leaseToken: { kind, value: leaseToken },
                checkPaymentStatus: false
            });
            if (!persisted) return { status: 'skipped', reason: 'lease_lost' };
        } catch (updateError) {
            logger?.error?.('[GuestShopWorker] failed to persist retry state', safeErrorMessage(updateError));
            throw updateError;
        }
        return {
            status: deadLetter ? 'dead_letter' : 'retry_waiting',
            retryable,
            exhausted,
            attempt,
            next_attempt_at: nextState[`${kind}_next_attempt_at`],
            error_code: code
        };
    }

    async function recordRefund(order, status, providerRef, errorCode, errorMessage) {
        return callRpc('fn_guest_shop_record_refund_result', {
            p_order_id: order.id,
            p_refund_status: status,
            p_provider_ref: providerRef || null,
            p_error_code: errorCode || null,
            p_error_message: errorMessage || null
        });
    }

    async function releaseTerminalRefundLease(order, statePatch, options) {
        try {
            const released = await releaseLease(order, 'refund', statePatch, options);
            if (!released) {
                logger?.warn?.('[GuestShopWorker] terminal refund recorded but lease release was not confirmed', {
                    order_id: normalizeText(order.id, 80),
                    refund_status: normalizeText(statePatch?.refund_status, 40)
                });
            }
        } catch (error) {
            // The refund RPC is the financial source of truth. Lease cleanup is
            // housekeeping: if it fails, let the lease expire naturally rather
            // than re-entering the provider-error path and rewriting a terminal
            // refund as failed/retry_waiting.
            logger?.error?.('[GuestShopWorker] terminal refund recorded but lease release failed', {
                order_id: normalizeText(order.id, 80),
                refund_status: normalizeText(statePatch?.refund_status, 40),
                error: safeErrorMessage(error)
            });
        }
    }

    async function processRefund(order, context = {}) {
        if (order.refund_status === 'succeeded' || order.refund_status === 'manual_review') {
            return { status: 'skipped', reason: 'refund_terminal' };
        }
        if (!['confirmed', 'refunded', 'chargeback'].includes(String(order.payment_status || '').toLowerCase())) {
            return { status: 'skipped', reason: 'payment_not_confirmed' };
        }
        if (order.payment_status === 'refunded' || order.payment_status === 'chargeback') {
            return { status: 'skipped', reason: 'payment_terminal' };
        }

        const { state } = getWorkerMetadata(order);
        const attempt = normalizeNonNegativeInteger(state.refund_attempt_count, 0);
        if (state.refund_terminal || (state.refund_next_attempt_at && !isRetryDue({ next_attempt_at: state.refund_next_attempt_at }, currentDate().getTime()))) {
            return { status: 'skipped', reason: 'refund_backoff' };
        }
        const lease = await acquireLease(order, 'refund', state, currentDate());
        if (!lease) return { status: 'skipped', reason: 'lease_lost' };
        const workingOrder = lease.order;
        const nextAttempt = attempt + 1;

        let payment;
        try {
            payment = context.payment || await loadPayment(order.id);
            if (!payment) {
                const error = new Error('游客支付订单不存在，无法自动退款');
                error.code = 'guest_refund_payment_missing';
                error.retryable = false;
                throw error;
            }
            if (payment.purpose !== 'shop_direct') {
                const error = new Error('支付用途不是 shop_direct');
                error.code = 'guest_refund_purpose_mismatch';
                error.retryable = false;
                throw error;
            }
            if (!paymentAdapter || typeof paymentAdapter.refundGuestPayment !== 'function') {
                const error = new Error('当前支付通道不支持自动退款');
                error.code = 'guest_refund_not_supported';
                error.retryable = false;
                throw error;
            }
            const result = await paymentAdapter.refundGuestPayment({
                order: {
                    id: order.id,
                    order_no: order.order_no,
                    site: order.site,
                    currency: order.currency,
                    total_amount: order.total_amount
                },
                payment,
                provider: payment.provider,
                channel: payment.channel,
                site: order.site,
                currency: order.currency,
                providerOrderNo: payment.provider_order_no || '',
                merchantOrderNo: payment.merchant_order_no || order.order_no,
                tradeNo: payment.provider_order_no || '',
                paymentId: payment.provider_metadata?.payment_id || payment.provider_metadata?.provider_payment_id || '',
                money: order.total_amount,
                metadata: isPlainObject(payment.provider_metadata) ? payment.provider_metadata : {},
                env
            });
            const success = result?.success === true || ['refunded', 'succeeded', 'success'].includes(String(result?.status || '').toLowerCase());
            if (success) {
                await recordRefund(order, 'succeeded', result?.provider_ref || result?.provider_order_no || result?.transaction_id || payment.provider_order_no, null, null);
                await releaseTerminalRefundLease(workingOrder, {
                    refund_status: 'succeeded',
                    refund_next_attempt_at: null,
                    refund_last_error_code: null,
                    refund_last_error_message: null
                }, { terminal: true, patch: { last_error_code: null, last_error_message: null } });
                return { status: 'refunded', attempt: nextAttempt };
            }

            if (result?.supported === false || result?.code === 'guest_refund_not_supported' || result?.status === 'blocked') {
                await recordRefund(order, 'manual_review', result?.provider_ref || null, result?.code || 'guest_refund_not_supported', result?.message || '需人工退款核验');
                await releaseTerminalRefundLease(workingOrder, {
                    refund_status: 'manual_review',
                    refund_next_attempt_at: null,
                    refund_last_error_code: result?.code || 'guest_refund_not_supported',
                    refund_last_error_message: result?.message || '需人工退款核验'
                }, { terminal: true, patch: { last_error_code: result?.code || 'guest_refund_not_supported', last_error_message: result?.message || '需人工退款核验' } });
                return { status: 'manual_review', attempt: nextAttempt };
            }

            const error = new Error(result?.message || '支付渠道未确认退款结果');
            error.code = result?.code || 'guest_refund_result_unknown';
            error.retryable = true;
            throw error;
        } catch (error) {
            const code = safeErrorCode(error, 'guest_refund_failed');
            // A missing/unsupported provider is a durable manual queue item,
            // not a hot retry loop.  The RPC records this terminal decision.
            if (code === 'guest_refund_not_supported' || code === 'guest_refund_payment_missing' || code === 'guest_refund_purpose_mismatch') {
                try {
                    await recordRefund(order, 'manual_review', null, code, safeErrorMessage(error, '需人工退款核验'));
                } catch (recordError) {
                    logger?.error?.('[GuestShopWorker] failed to record manual refund queue', safeErrorMessage(recordError));
                }
                return markRetry(workingOrder, 'refund', nextAttempt, error, {
                    forceDeadLetter: true,
                    patch: { last_error_code: code, last_error_message: '需人工退款核验' }
                });
            }
            try {
                // Keep the financial state explicit while retrying.  This RPC
                // does not call the provider and is idempotent.
                await recordRefund(order, 'failed', null, code, safeErrorMessage(error));
            } catch (recordError) {
                logger?.warn?.('[GuestShopWorker] failed to persist refund attempt', safeErrorMessage(recordError));
            }
            return markRetry(workingOrder, 'refund', nextAttempt, error);
        }
    }

    async function processFulfillment(order) {
        if (['delivered', 'refunded', 'dead_letter'].includes(order.fulfillment_status)) {
            return { status: 'skipped', reason: 'fulfillment_terminal' };
        }
        if (order.payment_status !== 'confirmed') {
            return { status: 'skipped', reason: 'payment_not_confirmed' };
        }
        const { state } = getWorkerMetadata(order);

        // Fast-path optimization: skip backoff check for recently confirmed orders
        // on their first attempt. This accelerates delivery from ~15s to <1s for
        // immediate webhook confirmations, while preserving exponential backoff
        // for genuine retry scenarios (network errors, transient failures).
        const fulfillmentStartMs = currentDate().getTime();
        const attempt = normalizeNonNegativeInteger(state.fulfillment_attempt_count, 0) + 1;
        const isFirstAttempt = attempt === 1;
        const paidAtMs = Date.parse(String(order.paid_at || '').trim());
        const isRecentlyConfirmed = Number.isFinite(paidAtMs) && (currentDate().getTime() - paidAtMs) < 10000;
        const shouldSkipBackoff = isFirstAttempt && isRecentlyConfirmed;

        if (trace) {
            logger?.info?.('[GuestShopWorker] fulfillment attempt planned', {
                order_id: normalizeText(order.id, 80),
                attempt,
                first_attempt: isFirstAttempt,
                recently_confirmed: isRecentlyConfirmed,
                skip_backoff: shouldSkipBackoff,
                payment_age_ms: Number.isFinite(paidAtMs) ? Math.max(0, fulfillmentStartMs - paidAtMs) : null
            });
        }

        if (!shouldSkipBackoff) {
            if (state.fulfillment_terminal || (state.fulfillment_next_attempt_at && !isRetryDue({ next_attempt_at: state.fulfillment_next_attempt_at }, currentDate().getTime()))) {
                return { status: 'skipped', reason: 'fulfillment_backoff' };
            }
        }

        const lease = await acquireLease(order, 'fulfillment', state, currentDate());
        if (!lease) return { status: 'skipped', reason: 'lease_lost' };
        const workingOrder = lease.order;

        const leaseAcquiredMs = currentDate().getTime();

        try {
            const claimStartMs = currentDate().getTime();
            // Promo L1: an order can hold up to 5 reservations and
            // fn_guest_shop_claim_fulfillment hands over exactly ONE row per call
            // (held rows first, then a stable created_at/id order, so a retry can
            // never be given the same live card twice while another stays held).
            // The worker therefore loops until every card of THIS order is
            // consumed. Supplying a reservation id fetched in a separate HTTP
            // round-trip would add latency and create a stale-read window, so the
            // RPC keeps resolving the row itself.
            //
            // Termination is bounded twice. (1) The committed order quantity, so
            // the loop can never claim more cards than were paid for. (2) A
            // repeated reservation id: re-reading an already-consumed row returns
            // that same row again (with its content) rather than signalling "no
            // held row left", so without this the loop would spin whenever the
            // reservation set and quantity disagree. fn_guest_shop_mark_fulfilled
            // stays the authority - it refuses to write 'delivered' unless EVERY
            // reservation is consumed - so a bounded early exit can never mark a
            // partially delivered order as finished.
            const expectedItems = normalizePositiveInteger(order.quantity, 1, {
                min: 1,
                max: GUEST_ORDER_QUANTITY_CEILING
            });
            const seenReservationIds = new Set();
            let claim = null;
            let claimedItems = 0;
            for (let item = 0; item <= expectedItems; item += 1) {
                const row = await callRpc('fn_guest_shop_claim_fulfillment', {
                    p_order_id: order.id,
                    p_reservation_id: null
                }) || {};
                claim = row;
                // The RPC persists paid_unfulfillable before returning this row,
                // and for a multi-card order it has already released the remaining
                // held cards, because one lost card makes the whole order
                // undeliverable. Never retry with a replacement inventory row:
                // that would break the payment-to-reservation audit boundary.
                if (row.fulfillment_status === 'paid_unfulfillable'
                    || row.reservation_status === 'released'
                    || row.content == null) {
                    break;
                }
                if (typeof row.content !== 'string' || !row.content.length) {
                    const error = new Error('履约 RPC 未返回可交付库存');
                    error.code = 'guest_fulfillment_content_missing';
                    error.retryable = false;
                    throw error;
                }
                const rowReservationId = normalizeText(row.reservation_id, 160);
                if (!rowReservationId) {
                    const error = new Error('履约 RPC 未返回库存预留引用');
                    error.code = 'guest_fulfillment_reservation_missing';
                    error.retryable = true;
                    throw error;
                }
                if (seenReservationIds.has(rowReservationId)) break;
                seenReservationIds.add(rowReservationId);
                claimedItems += 1;
                if (claimedItems >= expectedItems) break;
            }
            const claimEndMs = currentDate().getTime();

            if (!claim) {
                const error = new Error('履约 RPC 未返回结果');
                error.code = 'guest_fulfillment_claim_missing';
                error.retryable = true;
                throw error;
            }
            // The RPC persists paid_unfulfillable before returning this row.
            // Never retry with a replacement inventory row: that would break
            // the payment-to-reservation audit boundary.
            if (claim.fulfillment_status === 'paid_unfulfillable' || claim.reservation_status === 'released' || claim.content == null) {
                // The claim RPC has already made the stock decision and may
                // have changed updated_at.  Close the fulfillment lease before
                // entering the refund path so another worker cannot observe a
                // permanently "processing" fulfillment lease, and so the
                // refund lease can be acquired without two kinds running at
                // once.  The returned row carries the newest metadata/status
                // snapshot for the compensation attempt.
                const released = await releaseLease(workingOrder, 'fulfillment', {
                    fulfillment_status: claim.fulfillment_status || 'paid_unfulfillable',
                    fulfillment_next_attempt_at: null,
                    fulfillment_last_error_code: null,
                    fulfillment_last_error_message: null
                }, {
                    terminal: true,
                    patch: {
                        fulfillment_status: claim.fulfillment_status || 'paid_unfulfillable',
                        reservation_status: claim.reservation_status || 'released'
                    }
                });
                if (!released) return { status: 'skipped', reason: 'lease_lost' };
                const compensationOrder = {
                    ...workingOrder,
                    ...released,
                    metadata: released.metadata || workingOrder.metadata,
                    fulfillment_status: released.fulfillment_status || claim.fulfillment_status || 'paid_unfulfillable',
                    reservation_status: claim.reservation_status || released.reservation_status || 'released',
                    refund_status: released.refund_status || order.refund_status,
                    _workerLeaseOwned: false
                };
                const refund = await processRefund(compensationOrder);
                return { status: 'paid_unfulfillable', refund };
            }

            if (typeof claim.content !== 'string' || !claim.content.length) {
                const error = new Error('履约 RPC 未返回可交付库存');
                error.code = 'guest_fulfillment_content_missing';
                error.retryable = false;
                throw error;
            }

            const reservationId = normalizeText(claim.reservation_id, 160);
            if (!reservationId) {
                const error = new Error('履约 RPC 未返回库存预留引用');
                error.code = 'guest_fulfillment_reservation_missing';
                error.retryable = true;
                throw error;
            }
            // mark_fulfilled is an ORDER-level transition: the reservation id only
            // proves the caller is talking about this order, it does not narrow the
            // decision. It writes 'delivered' solely when every reservation of the
            // order is consumed and every card is sold and non-shared, so a 1-of-3
            // delivery raises guest_reservation_not_consumed instead of finishing.
            const marked = await callRpc('fn_guest_shop_mark_fulfilled', {
                p_order_id: order.id,
                p_reservation_id: reservationId
            });
            const markEndMs = currentDate().getTime();

            if (!marked || (marked.fulfilled !== true && marked.fulfillment_status !== 'delivered')) {
                const error = new Error('履约标记未确认');
                error.code = 'guest_fulfillment_mark_unconfirmed';
                error.retryable = true;
                throw error;
            }
            await releaseLease(workingOrder, 'fulfillment', {
                fulfillment_status: 'delivered',
                fulfillment_next_attempt_at: null,
                fulfillment_last_error_code: null,
                fulfillment_last_error_message: null
            }, {
                terminal: true,
                patch: {
                    fulfillment_status: 'delivered',
                    fulfilled_at: marked.fulfilled_at || currentDate().toISOString(),
                    last_error_code: null,
                    last_error_message: null
                }
            });
            const fulfillmentEndMs = currentDate().getTime();
            // One durable line per delivered guest order.  This is the evidence
            // used to prove payment-to-delivery latency, so it stays on by
            // default; the per-stage breakdown is trace-only.  No inventory
            // content, claim secret, or provider payload is logged.
            logger?.info?.('[GuestShopWorker] order fulfilled', {
                order_id: normalizeText(order.id, 80),
                attempt,
                duration_ms: fulfillmentEndMs - fulfillmentStartMs,
                paid_to_delivered_ms: Number.isFinite(paidAtMs)
                    ? Math.max(0, fulfillmentEndMs - paidAtMs)
                    : null
            });
            if (trace) {
                logger?.info?.('[GuestShopWorker] fulfillment timing breakdown', {
                    order_id: normalizeText(order.id, 80),
                    total_ms: fulfillmentEndMs - fulfillmentStartMs,
                    lease_ms: leaseAcquiredMs - fulfillmentStartMs,
                    claim_ms: claimEndMs - claimStartMs,
                    mark_ms: markEndMs - claimEndMs,
                    release_ms: fulfillmentEndMs - markEndMs,
                    // Cards actually handed over in this pass. Never a card
                    // content, a claim secret or a provider payload.
                    items: claimedItems,
                    items_expected: expectedItems
                });
            }
            return { status: 'delivered', attempt };
        } catch (error) {
            const result = await markRetry(workingOrder, 'fulfillment', attempt, error);
            return { ...result, status: result.status };
        }
    }

    async function releaseExpiredReservations(limit) {
        try {
            return await callRpc('fn_guest_shop_release_expired_reservations', { p_limit: limit });
        } catch (error) {
            logger?.error?.('[GuestShopWorker] expired reservation sweep failed', safeErrorMessage(error));
            return { processed_count: 0, released_count: 0, unfulfillable_count: 0, error: safeErrorCode(error) };
        }
    }

    async function purgeExpiredAccessAttempts() {
        const base = {
            enabled: accessAuditRetention.enabled,
            retention_days: accessAuditRetention.retentionDays,
            cutoff_at: null,
            batch_size: ACCESS_AUDIT_PURGE_BATCH_SIZE,
            max_batches: ACCESS_AUDIT_PURGE_MAX_BATCHES,
            batches: 0,
            deleted_count: 0,
            has_more: false,
            backlog_degraded: false,
            error: null
        };
        if (!accessAuditRetention.enabled) {
            return {
                ...base,
                error: accessAuditRetention.valid ? null : accessAuditRetention.reason,
                backlog_degraded: !accessAuditRetention.valid
            };
        }
        if (!accessAuditRetention.valid) {
            return { ...base, error: accessAuditRetention.reason, backlog_degraded: true };
        }

        const cutoffAt = new Date(
            currentDate().getTime() - (accessAuditRetention.retentionDays * MILLISECONDS_PER_DAY)
        ).toISOString();

        let batches = 0;
        let deletedCount = 0;
        let hasMore = false;
        try {
            for (let batch = 0; batch < ACCESS_AUDIT_PURGE_MAX_BATCHES; batch += 1) {
                const result = await callRpc('fn_guest_shop_purge_access_attempts', {
                    p_cutoff: cutoffAt,
                    p_limit: ACCESS_AUDIT_PURGE_BATCH_SIZE
                });
                const batchDeletedCount = Number(result?.deleted_count);
                const batchHasMore = result?.has_more;
                if (!Number.isSafeInteger(batchDeletedCount)
                    || batchDeletedCount < 0
                    || batchDeletedCount > ACCESS_AUDIT_PURGE_BATCH_SIZE
                    || typeof batchHasMore !== 'boolean'
                    || (batchHasMore && batchDeletedCount !== ACCESS_AUDIT_PURGE_BATCH_SIZE)) {
                    throw Object.assign(new Error('游客访问审计清理结果无效'), { code: 'access_audit_purge_result_invalid' });
                }
                batches += 1;
                deletedCount += batchDeletedCount;
                hasMore = batchHasMore;
                if (!hasMore) break;
            }

            return {
                ...base,
                cutoff_at: cutoffAt,
                batches,
                deleted_count: deletedCount,
                has_more: hasMore,
                backlog_degraded: hasMore
            };
        } catch (error) {
            logger?.error?.('[GuestShopWorker] access audit retention sweep failed', {
                code: safeErrorCode(error),
                message: safeErrorMessage(error),
                batches,
                deleted_count: deletedCount
            });
            return {
                ...base,
                cutoff_at: cutoffAt,
                batches,
                deleted_count: deletedCount,
                has_more: true,
                backlog_degraded: true,
                error: safeErrorCode(error, 'access_audit_retention_failed')
            };
        }
    }

    async function loadOrderById(orderId) {
        const id = normalizeText(orderId, 160);
        if (!id) return null;
        const db = requireDb();
        let query = db.from('guest_shop_orders').select(CANDIDATE_SELECT).eq('id', id);
        if (typeof query.maybeSingle === 'function') query = query.maybeSingle();
        const result = await query;
        if (result?.error) throw result.error;
        return result?.data || null;
    }

    async function processOrder(order) {
        if (!order || !normalizeText(order.id, 160)) {
            return { status: 'skipped', reason: 'order_missing' };
        }
        const workerInfo = getWorkerMetadata(order).state;
        const needsRefund = REFUND_CANDIDATE_STATUSES.includes(String(order.refund_status || '').toLowerCase());
        if (workerInfo.refund_status === 'manual_review') {
            return { status: 'skipped', reason: 'refund_manual_review' };
        }
        // A dead-lettered fulfillment must not hide an admin-queued refund.
        // Only skip when there is no pending/failed refund.
        if (workerInfo.fulfillment_status === 'dead_letter' && !needsRefund) {
            return { status: 'skipped', reason: 'fulfillment_dead_letter' };
        }
        if (order.fulfillment_status === 'paid_unfulfillable' || needsRefund) {
            const result = await processRefund(order);
            return { ...result, processed_kind: 'refund' };
        }
        const result = await processFulfillment(order);
        return { ...result, processed_kind: 'fulfillment' };
    }

    async function processOrderById(orderId) {
        const order = await loadOrderById(orderId);
        if (!order) return { status: 'skipped', reason: 'order_not_found' };
        return processOrder(order);
    }

    async function runOnce(options = {}) {
        const started = currentDate();
        const limit = normalizePositiveInteger(options.limit, config.batchSize, { min: 1, max: MAX_BATCH_SIZE });
        const expiry = await releaseExpiredReservations(limit);
        const accessAuditCleanup = options.runAccessAuditCleanup === true
            ? await purgeExpiredAccessAttempts()
            : {
                enabled: accessAuditRetention.enabled,
                retention_days: accessAuditRetention.retentionDays,
                cutoff_at: null,
                batch_size: ACCESS_AUDIT_PURGE_BATCH_SIZE,
                max_batches: ACCESS_AUDIT_PURGE_MAX_BATCHES,
                batches: 0,
                deleted_count: 0,
                has_more: false,
                backlog_degraded: !accessAuditRetention.valid,
                error: accessAuditRetention.valid ? null : accessAuditRetention.reason,
                skipped: 'not_scheduled'
            };
        const orders = await loadCandidates(limit);
        const summary = {
            success: true,
            worker_name: name,
            scanned: orders.length,
            processed: 0,
            delivered: 0,
            retry_waiting: 0,
            dead_lettered: 0,
            paid_unfulfillable: 0,
            refunded: 0,
            manual_review: 0,
            skipped: 0,
            errors: 0,
            expired_reservations: Number(expiry?.released_count || 0),
            expiry_unfulfillable: Number(expiry?.unfulfillable_count || 0),
            access_audit_cleanup: accessAuditCleanup,
            duration_ms: 0
        };

        // Process sequentially by default.  The SQL RPCs lock order ->
        // reservation -> inventory, and serial execution keeps provider
        // refund calls within a predictable rate envelope.
        for (const order of orders) {
            const orderStartMs = currentDate().getTime();
            if (trace) {
                logger?.info?.('[GuestShopWorker] order processing started', {
                    order_id: normalizeText(order.id, 80),
                    payment_status: normalizeText(order.payment_status, 40),
                    fulfillment_status: normalizeText(order.fulfillment_status, 40)
                });
            }

            try {
                const result = await processOrder(order);
                if (trace) {
                    logger?.info?.('[GuestShopWorker] order processing finished', {
                        order_id: normalizeText(order.id, 80),
                        status: normalizeText(result?.status, 40),
                        duration_ms: Math.max(0, currentDate().getTime() - orderStartMs)
                    });
                }

                if (result.status === 'skipped'
                    && ['refund_manual_review', 'fulfillment_dead_letter'].includes(result.reason)) {
                    summary.skipped += 1;
                    continue;
                }
                if (result.status === 'refunded') summary.refunded += 1;
                if (result.status === 'manual_review') summary.manual_review += 1;
                if (result.status === 'delivered') summary.delivered += 1;
                if (result.status === 'paid_unfulfillable') {
                    summary.paid_unfulfillable += 1;
                    if (result.refund?.status === 'refunded') summary.refunded += 1;
                    if (result.refund?.status === 'manual_review') summary.manual_review += 1;
                }
                summary.processed += 1;
                if (result.status === 'retry_waiting') summary.retry_waiting += 1;
                if (result.status === 'dead_letter' || result.refund?.status === 'dead_letter') summary.dead_lettered += 1;
                if (result.status === 'skipped') summary.skipped += 1;
            } catch (error) {
                summary.errors += 1;
                logger?.error?.('[GuestShopWorker] order processing failed', {
                    order_id: normalizeText(order.id, 80),
                    code: safeErrorCode(error),
                    message: safeErrorMessage(error)
                });
            }
        }
        summary.duration_ms = Math.max(0, currentDate().getTime() - started.getTime());
        return summary;
    }

    return Object.freeze({
        runOnce,
        loadOrderById,
        processOrder,
        processOrderById,
        processFulfillment,
        processRefund,
        releaseExpiredReservations,
        purgeExpiredAccessAttempts,
        loadCandidates,
        config,
        workerName: name
    });
}

function isGuestShopImmediateFulfillmentEnabled(env = process.env) {
    const enabled = isTruthyEnvFlag(env?.GUEST_SHOP_IMMEDIATE_FULFILLMENT_ENABLED);
    const vercelRuntime = String(env?.VERCEL_ENV || '').trim().length > 0
        || String(env?.VERCEL || '').trim().toLowerCase() === '1';
    const sharedWorkerRuntime = isTruthyEnvFlag(env?.VERIFY_SERVER_WORKERS_ENABLED);
    // The kicker is deliberately restricted to the long-running verify-server
    // process. Vercel/serverless handlers and standalone API modules keep the
    // durable timer as their only fulfillment fallback.
    return enabled && !vercelRuntime && sharedWorkerRuntime;
}

function isTruthyEnvFlag(value) {
    return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

// Fine-grained fulfillment tracing is opt-in and never writes files.  The tick
// runs every 10 seconds and its run summary is already returned to the systemd
// helper (so it lands in the journal), so per-tick container logs stay quiet by
// default.  Turn this on only while measuring payment-to-delivery latency.
function isGuestShopFulfillmentTraceEnabled(env = process.env) {
    return isTruthyEnvFlag(env?.GUEST_SHOP_IMMEDIATE_FULFILLMENT_DEBUG);
}

function createGuestShopFulfillmentKicker({
    supabase,
    paymentAdapter = null,
    env = process.env,
    workerFactory = createGuestShopWorker,
    logger = console
} = {}) {
    const enabled = isGuestShopImmediateFulfillmentEnabled(env);
    // Tracing is opt-in. It never writes files, and it never logs order
    // contents, claim secrets, or provider payloads.
    const debug = isGuestShopFulfillmentTraceEnabled(env);
    const inFlight = new Map();
    let worker = null;

    function getWorker() {
        if (worker) return worker;
        worker = workerFactory({
            supabase,
            paymentAdapter,
            env,
            logger
        });
        return worker;
    }

    function kick(orderId) {
        const id = normalizeText(orderId, 160);
        if (!enabled) {
            if (debug) {
                logger?.info?.('[GuestShopWorker] immediate fulfillment kick skipped', {
                    order_id: id,
                    reason: 'immediate_fulfillment_disabled'
                });
            }
            return Promise.resolve({ status: 'skipped', reason: 'immediate_fulfillment_disabled' });
        }
        if (!id) return Promise.resolve({ status: 'skipped', reason: 'order_id_missing' });
        // Dedupe before any logging: a confirmed order is re-kicked by every
        // status poll until it reaches `delivered`, so log volume must not
        // scale with buyer polling traffic.
        if (inFlight.has(id)) return inFlight.get(id);

        const kickStartMs = Date.now();
        if (debug) {
            logger?.info?.('[GuestShopWorker] immediate fulfillment kick started', { order_id: id });
        }

        const task = Promise.resolve()
            .then(() => getWorker().processOrderById(id))
            .then((result) => {
                if (debug) {
                    logger?.info?.('[GuestShopWorker] immediate fulfillment kick finished', {
                        order_id: id,
                        status: normalizeText(result?.status, 40) || 'unknown',
                        duration_ms: Date.now() - kickStartMs
                    });
                }
                return result;
            })
            .catch((error) => {
                // A kick is an optimization over the durable timer. Never
                // reject into the payment callback/status request, and never
                // log order contents, claim secrets, or card material.
                logger?.error?.('[GuestShopWorker] immediate fulfillment failed', {
                    order_id: id,
                    code: safeErrorCode(error, 'guest_immediate_fulfillment_failed')
                });
                return { status: 'error', error_code: safeErrorCode(error, 'guest_immediate_fulfillment_failed') };
            })
            .finally(() => {
                inFlight.delete(id);
            });
        inFlight.set(id, task);
        return task;
    }

    return Object.freeze({
        enabled,
        kick,
        pendingCount: () => inFlight.size
    });
}

function sendWorkerJson(res, status, payload) {
    if (typeof res?.status === 'function') {
        res.status(status);
        res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
        res.setHeader?.('Cache-Control', 'no-store, max-age=0');
        res.setHeader?.('Referrer-Policy', 'no-referrer');
        res.setHeader?.('X-Content-Type-Options', 'nosniff');
        return res.end(JSON.stringify(payload));
    }
    res.statusCode = status;
    res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
    res.setHeader?.('Cache-Control', 'no-store, max-age=0');
    res.setHeader?.('Referrer-Policy', 'no-referrer');
    res.setHeader?.('X-Content-Type-Options', 'nosniff');
    return res.end(JSON.stringify(payload));
}

function resolveWorkerSupabase(admin) {
    if (typeof admin?.getOptionalSupabaseAdmin === 'function') return admin.getOptionalSupabaseAdmin();
    try {
        return typeof admin?.getSupabaseAdmin === 'function' ? admin.getSupabaseAdmin() : null;
    } catch (_) {
        return null;
    }
}

function createGuestShopWorkerHandler({
    admin,
    env = process.env,
    workerFactory = createGuestShopWorker,
    paymentAdapter = null,
    logger = console,
    now = () => new Date()
} = {}) {
    let nextAccessAuditSweepAtMs = 0;

    return async function guestShopWorkerHandler(req, res) {
        const method = String(req?.method || '').toUpperCase();
        if (method === 'OPTIONS') {
            res.setHeader?.('Allow', 'GET, POST, OPTIONS');
            return sendWorkerJson(res, 204, {});
        }
        if (guestWorkerRequestDeclaresBody(req)) {
            // The worker scans durable rows and never accepts caller-supplied
            // JSON, order IDs, or inventory.  Close a body-bearing request so
            // an untrusted stream cannot be handed to a shared parser or kept
            // alive for a second request.
            res.setHeader?.('Connection', 'close');
            return sendWorkerJson(res, 400, {
                success: false,
                code: 'worker_body_not_allowed',
                message: '履约 worker 不接受请求体'
            });
        }
        if (!['GET', 'POST'].includes(method)) {
            res.setHeader?.('Allow', 'GET, POST, OPTIONS');
            return sendWorkerJson(res, 405, { success: false, code: 'method_not_allowed', message: 'Method not allowed' });
        }
        const access = authorizeGuestShopWorkerRequest(req, env);
        if (!access.ok) {
            return sendWorkerJson(res, access.status, {
                success: false,
                code: access.reason,
                message: access.reason === 'worker_secret_not_configured' ? '履约 worker 密钥未配置' : 'Unauthorized'
            });
        }
        const supabase = resolveWorkerSupabase(admin);
        if (!supabase) {
            return sendWorkerJson(res, 503, { success: false, code: 'guest_worker_database_unavailable', message: '履约数据库不可用' });
        }
        let limit = Number(req?.query?.limit || req?.query?.batch_size || DEFAULT_BATCH_SIZE);
        if (!Number.isFinite(limit)) limit = DEFAULT_BATCH_SIZE;
        limit = normalizePositiveInteger(limit, DEFAULT_BATCH_SIZE, { min: 1, max: MAX_BATCH_SIZE });
        try {
            const workerStartMs = Date.now();
            const trace = isGuestShopFulfillmentTraceEnabled(env);
            if (trace) {
                logger?.info?.('[GuestShopWorker] run started', { batch_size: limit });
            }

            const worker = workerFactory({
                supabase,
                paymentAdapter,
                env,
                logger
            });
            const clockValue = typeof now === 'function' ? now() : now;
            const clockDate = clockValue instanceof Date ? clockValue : new Date(clockValue);
            const clockMs = Number.isFinite(clockDate.getTime()) ? clockDate.getTime() : Date.now();
            const runAccessAuditCleanup = clockMs >= nextAccessAuditSweepAtMs;
            if (runAccessAuditCleanup) {
                // Advance before the RPC. A database outage should retry after
                // ten minutes, not turn the 10-second fulfillment timer into a
                // tight retention-query loop.
                nextAccessAuditSweepAtMs = clockMs + ACCESS_AUDIT_SWEEP_INTERVAL_MS;
            }
            const result = await worker.runOnce({ limit, runAccessAuditCleanup });
            const accessAuditCleanup = result?.access_audit_cleanup;
            const maintenanceDegraded = Boolean(
                accessAuditCleanup?.error || accessAuditCleanup?.backlog_degraded
            );

            if (trace) {
                // The same summary is returned to the systemd helper, which
                // prints it to the journal; the container does not need a
                // second copy on every 10-second tick.
                logger?.info?.('[GuestShopWorker] run finished', {
                    duration_ms: Date.now() - workerStartMs,
                    fulfillment: result?.fulfillment?.summary,
                    refund: result?.refund?.summary,
                    access_audit_cleanup: accessAuditCleanup
                });
            }

            if (maintenanceDegraded) {
                const code = accessAuditCleanup?.error
                    ? 'guest_access_audit_cleanup_failed'
                    : 'guest_access_audit_backlog_degraded';
                logger?.error?.('[GuestShopWorker] maintenance degraded', {
                    code,
                    batches: Number(accessAuditCleanup?.batches || 0),
                    deleted_count: Number(accessAuditCleanup?.deleted_count || 0),
                    has_more: accessAuditCleanup?.has_more === true
                });
                return sendWorkerJson(res, 503, {
                    ...result,
                    success: false,
                    worker_run_success: result?.success === true,
                    degraded: true,
                    code,
                    message: '履约已按幂等规则处理，但访问审计清理需要运维关注'
                });
            }

            return sendWorkerJson(res, 200, result);
        } catch (error) {
            logger?.error?.('[GuestShopWorker] endpoint failed', safeErrorMessage(error));
            return sendWorkerJson(res, 503, {
                success: false,
                code: 'guest_worker_unavailable',
                message: '履约 worker 暂时不可用'
            });
        }
    };
}

module.exports = {
    FULFILLMENT_STATE_KEY,
    FULFILLMENT_CANDIDATE_STATUSES,
    REFUND_CANDIDATE_STATUSES,
    WORKER_SECRET_ENV_NAMES,
    WORKER_SECRET_HEADER_NAMES,
    DEFAULT_BATCH_SIZE,
    MAX_BATCH_SIZE,
    ACCESS_AUDIT_RETENTION_SWITCH_ENV,
    ACCESS_AUDIT_PURGE_BATCH_SIZE,
    ACCESS_AUDIT_PURGE_MAX_BATCHES,
    ACCESS_AUDIT_SWEEP_INTERVAL_MS,
    isProductionLikeRuntime,
    isStrongWorkerSecret,
    parseWorkerInteger,
    parseWorkerRatio,
    parseAccessAuditRetentionSwitch,
    resolveWorkerConfig,
    resolveAccessAuditRetention,
    workerRuntimeConfigError,
    getGuestShopWorkerSecret,
    getProvidedWorkerSecret,
    authorizeGuestShopWorkerRequest,
    calculateGuestShopBackoffMs,
    getActiveLeaseKind,
    classifyRetryable,
    safeErrorCode,
    safeErrorMessage,
    createGuestShopWorker,
    isGuestShopImmediateFulfillmentEnabled,
    isGuestShopFulfillmentTraceEnabled,
    createGuestShopFulfillmentKicker,
    createGuestShopWorkerHandler
};
