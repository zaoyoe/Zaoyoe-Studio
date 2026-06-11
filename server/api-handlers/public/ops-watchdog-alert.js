const crypto = require('crypto');
const {
    enqueueOpsAlertJob,
    loadOpsAlertsRuntimeConfig,
    normalizeOpsAlertsConfig
} = require('../../../api/_lib/ops-alerts');

const SECRET_ENV_NAMES = Object.freeze([
    'OPS_WATCHDOG_ALERT_SECRET',
    'RECOVERY_READINESS_CRON_SECRET',
    'CRON_SECRET'
]);
const SECRET_HEADER_NAMES = Object.freeze([
    'x-ops-watchdog-secret',
    'x-cron-secret'
]);
const MAX_BODY_BYTES = 32 * 1024;
const ALLOWED_ALERT_TYPES = new Set([
    'kvm4_watchdog_incident',
    'kvm4_watchdog_recovered'
]);

function sendJson(res, status, payload) {
    res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.end(JSON.stringify(payload));
}

function normalizeText(value = '', maxLength = 4000) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeSecret(value = '') {
    return normalizeText(value, 4000);
}

function getHeader(req, name) {
    const headers = req?.headers || {};
    const target = String(name || '').toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (String(key || '').toLowerCase() === target) {
            return Array.isArray(value) ? value[0] : value;
        }
    }
    return '';
}

function getExpectedSecret(env = process.env) {
    for (const name of SECRET_ENV_NAMES) {
        const value = normalizeSecret(env?.[name]);
        if (value) return value;
    }
    return '';
}

function getProvidedSecret(req) {
    const authorization = normalizeSecret(getHeader(req, 'authorization'));
    const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
    if (bearerMatch) {
        return normalizeSecret(bearerMatch[1]);
    }

    for (const headerName of SECRET_HEADER_NAMES) {
        const value = normalizeSecret(getHeader(req, headerName));
        if (value) return value;
    }
    return '';
}

function constantTimeEqual(left, right) {
    const normalizedLeft = normalizeSecret(left);
    const normalizedRight = normalizeSecret(right);
    if (!normalizedLeft || !normalizedRight) return false;

    const leftBuffer = Buffer.from(normalizedLeft);
    const rightBuffer = Buffer.from(normalizedRight);
    if (leftBuffer.length !== rightBuffer.length) return false;
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function hasWatchdogAccess(req, env = process.env) {
    const expectedSecret = getExpectedSecret(env);
    if (!expectedSecret) {
        return {
            ok: false,
            status: 503,
            reason: 'watchdog_secret_not_configured'
        };
    }

    if (!constantTimeEqual(getProvidedSecret(req), expectedSecret)) {
        return {
            ok: false,
            status: 401,
            reason: 'invalid_watchdog_secret'
        };
    }

    return {
        ok: true,
        status: 200,
        reason: 'authorized'
    };
}

async function readJsonBody(req) {
    if (req.body && typeof req.body === 'object') {
        return req.body;
    }

    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.length;
        if (total > MAX_BODY_BYTES) {
            const error = new Error('watchdog alert body is too large');
            error.statusCode = 413;
            throw error;
        }
        chunks.push(buffer);
    }

    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) return {};

    try {
        return JSON.parse(raw);
    } catch (_) {
        const error = new Error('invalid JSON body');
        error.statusCode = 400;
        throw error;
    }
}

function normalizeSeverity(value = '') {
    const normalized = normalizeText(value, 40).toLowerCase();
    if (['info', 'warning', 'critical'].includes(normalized)) {
        return normalized;
    }
    return 'warning';
}

function normalizeAlertBody(body = {}) {
    const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    const alertType = normalizeText(source.alert_type || source.alertType, 120).toLowerCase();
    if (!ALLOWED_ALERT_TYPES.has(alertType)) {
        const error = new Error('unsupported alert type');
        error.statusCode = 400;
        throw error;
    }

    const metadata = source.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata)
        ? source.metadata
        : {};
    const payload = source.payload && typeof source.payload === 'object' && !Array.isArray(source.payload)
        ? source.payload
        : {};
    const site = normalizeText(source.site || payload.site, 40).toLowerCase() || 'cn';
    const targetId = normalizeText(
        source.target_id
        || source.targetId
        || payload.target_id
        || payload.guard_key
        || payload.container_name
        || payload.service_name
        || 'kvm4-watchdog',
        200
    );

    return {
        alert_type: alertType,
        severity: normalizeSeverity(source.severity),
        title: normalizeText(source.title, 240) || (alertType === 'kvm4_watchdog_recovered' ? 'KVM4 watchdog 已恢复' : 'KVM4 watchdog 触发告警'),
        content: normalizeText(source.content, 4000) || (alertType === 'kvm4_watchdog_recovered' ? 'KVM4 watchdog 检测到服务已恢复。' : 'KVM4 watchdog 检测到服务异常并已触发自愈。'),
        source: normalizeText(source.source, 120) || 'kvm4_watchdog',
        dedupe_key: normalizeText(source.dedupe_key || source.dedupeKey, 255),
        site,
        payload: {
            site,
            site_labels: [site],
            target_id: targetId,
            guard_key: normalizeText(source.guard_key || source.guardKey || payload.guard_key, 160) || null,
            guard_label: normalizeText(source.guard_label || source.guardLabel || payload.guard_label, 160) || null,
            service_name: normalizeText(source.service_name || source.serviceName || payload.service_name, 160) || null,
            container_name: normalizeText(source.container_name || source.containerName || payload.container_name, 160) || null,
            host: normalizeText(source.host || payload.host, 160) || null,
            state: normalizeText(source.state || payload.state, 120) || null,
            children: Number.isFinite(Number(source.children ?? payload.children)) ? Number(source.children ?? payload.children) : null,
            zombies: Number.isFinite(Number(source.zombies ?? payload.zombies)) ? Number(source.zombies ?? payload.zombies) : null,
            cpu_percent: Number.isFinite(Number(source.cpu_percent ?? source.cpuPercent ?? payload.cpu_percent)) ? Number(source.cpu_percent ?? source.cpuPercent ?? payload.cpu_percent) : null,
            incident_started_at: normalizeText(source.incident_started_at || source.incidentStartedAt || payload.incident_started_at, 80) || null,
            incident_recovered_at: normalizeText(source.incident_recovered_at || source.incidentRecoveredAt || payload.incident_recovered_at, 80) || null,
            incident_duration_minutes: Number.isFinite(Number(source.incident_duration_minutes ?? source.incidentDurationMinutes ?? payload.incident_duration_minutes))
                ? Number(source.incident_duration_minutes ?? source.incidentDurationMinutes ?? payload.incident_duration_minutes)
                : null,
            entry_path: normalizeText(source.entry_path || source.entryPath || payload.entry_path, 240) || '/admin-studio.html?module=ops-alerts&view=workspace',
            metadata
        }
    };
}

function ensureWatchdogRoutingEnabled(runtime = {}) {
    const baseConfig = runtime && typeof runtime.config === 'object' && !Array.isArray(runtime.config)
        ? runtime.config
        : {};
    const nextRouting = {
        ...(baseConfig.routing && typeof baseConfig.routing === 'object' ? baseConfig.routing : {}),
        kvm4_watchdog: {
            telegram: true,
            feishu: true,
            email: true,
            ...((baseConfig.routing && typeof baseConfig.routing.kvm4_watchdog === 'object')
                ? baseConfig.routing.kvm4_watchdog
                : {})
        }
    };

    return {
        ...runtime,
        config: {
            ...baseConfig,
            routing: nextRouting
        }
    };
}

function createWatchdogAlertHandler({
    admin,
    env = process.env,
    enqueue = enqueueOpsAlertJob,
    loadRuntime = loadOpsAlertsRuntimeConfig
} = {}) {
    return async function watchdogAlertHandler(req, res) {
        if (req.method === 'OPTIONS') {
            res.setHeader('Allow', 'POST, OPTIONS');
            return sendJson(res, 204, {});
        }

        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST, OPTIONS');
            return sendJson(res, 405, {
                success: false,
                message: 'Method not allowed'
            });
        }

        const access = hasWatchdogAccess(req, env);
        if (!access.ok) {
            return sendJson(res, access.status, {
                success: false,
                message: access.reason === 'watchdog_secret_not_configured'
                    ? 'Watchdog alert secret is not configured'
                    : 'Unauthorized',
                reason: access.reason
            });
        }

        try {
            const body = await readJsonBody(req);
            const normalized = normalizeAlertBody(body);
            const supabase = typeof admin?.getOptionalSupabaseAdmin === 'function'
                ? admin.getOptionalSupabaseAdmin()
                : (typeof admin?.getSupabaseAdmin === 'function' ? admin.getSupabaseAdmin() : null);
            if (!supabase?.from) {
                return sendJson(res, 503, {
                    success: false,
                    message: 'Supabase admin client unavailable'
                });
            }

            const runtime = ensureWatchdogRoutingEnabled(await loadRuntime(supabase, env, {
                site: normalized.site
            }));
            const result = await enqueue(supabase, {
                alert_type: normalized.alert_type,
                alertType: normalized.alert_type,
                severity: normalized.severity,
                title: normalized.title,
                content: normalized.content,
                payload: normalized.payload,
                source: normalized.source,
                dedupeKey: normalized.dedupe_key || undefined,
                allowedChannels: ['telegram', 'feishu', 'email']
            }, {
                env,
                site: normalized.site,
                runtime,
                skipSummary: true
            });

            return sendJson(res, 202, {
                success: true,
                accepted: true,
                queued: result?.queued === true,
                reason: result?.reason || null,
                dedupe_key: result?.dedupeKey || normalized.dedupe_key || null,
                alert_type: normalized.alert_type
            });
        } catch (error) {
            const status = Number(error?.statusCode || 0) || 500;
            return sendJson(res, status, {
                success: false,
                message: error?.message || 'Watchdog alert enqueue failed'
            });
        }
    };
}

module.exports = {
    createWatchdogAlertHandler,
    hasWatchdogAccess,
    normalizeAlertBody
};
