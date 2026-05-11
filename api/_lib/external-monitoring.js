const crypto = require('crypto');

const DEFAULT_MONITORING_TIMEOUT_MS = 1200;
const DEFAULT_MAX_TEXT_LENGTH = 2000;
const REDACTED_VALUE = '[REDACTED]';
const SENTRY_DSN_ENV_NAMES = Object.freeze([
    'SENTRY_DSN',
    'SERVER_SENTRY_DSN',
    'NEXT_PUBLIC_SENTRY_DSN',
    'PUBLIC_SENTRY_DSN'
]);
const SENSITIVE_KEY_PATTERN = /(authorization|cookie|password|passwd|secret|token|api[_-]?key|service[_-]?role|refresh[_-]?token|access[_-]?token|webhook|signature|private[_-]?key)/i;
const SENSITIVE_VALUE_PATTERN = /(bearer\s+[a-z0-9._-]+|eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+|sb_secret_[a-zA-Z0-9_-]+)/i;

function normalizeText(value = '', maxLength = DEFAULT_MAX_TEXT_LENGTH) {
    return String(value || '').trim().slice(0, Math.max(0, maxLength));
}

function normalizeLevel(value = '') {
    const normalized = normalizeText(value, 40).toLowerCase();
    if (['fatal', 'error', 'warning', 'info', 'debug'].includes(normalized)) {
        return normalized;
    }
    if (normalized === 'warn') {
        return 'warning';
    }
    return 'info';
}

function readEnv(env = process.env, name = '') {
    return normalizeText(env?.[name] || '');
}

function readFirstEnv(env = process.env, names = []) {
    for (const name of names) {
        const value = readEnv(env, name);
        if (value) {
            return { name, value };
        }
    }
    return { name: '', value: '' };
}

function parseJsonObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function sanitizeStringValue(value = '', maxLength = DEFAULT_MAX_TEXT_LENGTH) {
    const normalized = normalizeText(value, maxLength);
    if (!normalized) {
        return '';
    }
    return SENSITIVE_VALUE_PATTERN.test(normalized) ? REDACTED_VALUE : normalized;
}

function redactMonitoringPayload(value, options = {}) {
    const maxDepth = Number.isFinite(Number(options.maxDepth)) ? Number(options.maxDepth) : 5;
    const maxArrayItems = Number.isFinite(Number(options.maxArrayItems)) ? Number(options.maxArrayItems) : 20;

    function visit(input, depth, key = '') {
        if (SENSITIVE_KEY_PATTERN.test(key)) {
            return REDACTED_VALUE;
        }

        if (input == null) {
            return input;
        }

        if (typeof input === 'string') {
            return sanitizeStringValue(input);
        }

        if (typeof input === 'number' || typeof input === 'boolean') {
            return input;
        }

        if (typeof input === 'bigint') {
            return String(input);
        }

        if (input instanceof Error) {
            return {
                name: sanitizeStringValue(input.name, 160),
                message: sanitizeStringValue(input.message),
                stack: sanitizeStringValue(input.stack, 4000)
            };
        }

        if (depth >= maxDepth) {
            return '[Truncated]';
        }

        if (Array.isArray(input)) {
            return input.slice(0, maxArrayItems).map((item) => visit(item, depth + 1, key));
        }

        if (typeof input === 'object') {
            return Object.fromEntries(
                Object.entries(input)
                    .slice(0, 80)
                    .map(([entryKey, entryValue]) => [
                        sanitizeStringValue(entryKey, 120),
                        visit(entryValue, depth + 1, entryKey)
                    ])
            );
        }

        return sanitizeStringValue(String(input));
    }

    return visit(value, 0);
}

function buildMonitoringEvent(input = {}, options = {}) {
    const env = options.env || process.env;
    const tags = redactMonitoringPayload(parseJsonObject(input.tags || {}), { maxDepth: 2 });
    const extra = redactMonitoringPayload(parseJsonObject(input.extra || {}));
    const timestamp = normalizeText(input.timestamp, 80) || new Date().toISOString();
    const type = normalizeText(input.type || 'application_event', 120) || 'application_event';
    const message = sanitizeStringValue(input.message || type, 1000) || type;
    const level = normalizeLevel(input.level || input.severity || 'info');
    const environment = normalizeText(input.environment || env.SENTRY_ENVIRONMENT || env.DATADOG_ENV || env.DD_ENV || env.NODE_ENV || 'production', 80);
    const release = normalizeText(input.release || env.SENTRY_RELEASE || env.VERCEL_GIT_COMMIT_SHA || env.RAILWAY_GIT_COMMIT_SHA, 160);
    const service = normalizeText(input.service || env.DATADOG_SERVICE || env.DD_SERVICE || 'zaoyoe-studio', 120);

    return {
        event_id: normalizeText(input.event_id, 64) || crypto.randomBytes(16).toString('hex'),
        timestamp,
        type,
        level,
        message,
        service,
        environment,
        release,
        tags,
        extra
    };
}

function getSentryDsn(env = process.env) {
    return readFirstEnv(env, SENTRY_DSN_ENV_NAMES);
}

function parseSentryDsn(dsn = '') {
    try {
        const parsed = new URL(dsn);
        const projectId = parsed.pathname.split('/').filter(Boolean).pop() || '';
        if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.username || !projectId) {
            return null;
        }
        return {
            dsn,
            host: parsed.host,
            project_id: projectId,
            endpoint: `${parsed.origin}/api/${encodeURIComponent(projectId)}/envelope/`
        };
    } catch (_) {
        return null;
    }
}

function getAxiomConfig(env = process.env) {
    const token = readFirstEnv(env, ['AXIOM_TOKEN', 'AXIOM_API_TOKEN']);
    const dataset = readFirstEnv(env, ['AXIOM_DATASET', 'AXIOM_LOG_DATASET']);
    const baseUrl = readEnv(env, 'AXIOM_INGEST_URL') || 'https://api.axiom.co/v1';
    if (!token.value || !dataset.value) {
        return null;
    }
    return {
        token: token.value,
        dataset: dataset.value,
        endpoint: `${baseUrl.replace(/\/+$/, '')}/datasets/${encodeURIComponent(dataset.value)}/ingest`
    };
}

function getDatadogConfig(env = process.env) {
    const apiKey = readFirstEnv(env, ['DATADOG_API_KEY', 'DD_API_KEY']);
    if (!apiKey.value) {
        return null;
    }

    const site = readFirstEnv(env, ['DATADOG_SITE', 'DD_SITE']).value || 'datadoghq.com';
    if (!/^[A-Za-z0-9.-]+$/.test(site) || /^https?:\/\//i.test(site)) {
        return null;
    }

    return {
        apiKey: apiKey.value,
        site,
        endpoint: `https://http-intake.logs.${site}/api/v2/logs`
    };
}

async function postMonitoringPayload(url, body, options = {}) {
    const fetchImpl = options.fetchImpl || global.fetch;
    if (typeof fetchImpl !== 'function') {
        return {
            ok: false,
            status: 0,
            error: 'fetch_unavailable'
        };
    }

    const timeoutMs = Math.max(250, Number(options.timeoutMs || DEFAULT_MONITORING_TIMEOUT_MS));
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
        const response = await fetchImpl(url, {
            method: 'POST',
            headers: options.headers || {},
            body,
            signal: controller?.signal
        });
        const text = await response.text().catch(() => '');
        return {
            ok: response.ok,
            status: response.status,
            body: normalizeText(text, 1000) || null
        };
    } catch (error) {
        return {
            ok: false,
            status: 0,
            error: normalizeText(error?.message || error, 1000) || 'monitoring_post_failed'
        };
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

function buildSentryEnvelope(event = {}, dsn = '') {
    const envelopeHeader = {
        event_id: event.event_id,
        dsn,
        sent_at: event.timestamp
    };
    const itemHeader = {
        type: 'event'
    };
    const payload = {
        event_id: event.event_id,
        timestamp: event.timestamp,
        platform: 'javascript',
        logger: 'zaoyoe.external-monitoring',
        level: event.level,
        message: event.message,
        environment: event.environment,
        release: event.release || undefined,
        tags: {
            event_type: event.type,
            service: event.service,
            ...event.tags
        },
        extra: event.extra
    };

    return [
        JSON.stringify(envelopeHeader),
        JSON.stringify(itemHeader),
        JSON.stringify(payload)
    ].join('\n');
}

async function sendSentryEvent(event = {}, env = process.env, options = {}) {
    const dsn = getSentryDsn(env);
    const sentry = parseSentryDsn(dsn.value);
    if (!sentry) {
        return {
            provider: 'sentry',
            skipped: true,
            reason: dsn.value ? 'invalid_dsn' : 'not_configured',
            env_name: dsn.name || null,
            expected_env_names: SENTRY_DSN_ENV_NAMES
        };
    }

    return {
        provider: 'sentry',
        env_name: dsn.name || null,
        dsn_host: sentry.host,
        dsn_project_id: sentry.project_id,
        ...(await postMonitoringPayload(
            sentry.endpoint,
            buildSentryEnvelope(event, sentry.dsn),
            {
                ...options,
                headers: {
                    'Content-Type': 'application/x-sentry-envelope'
                }
            }
        ))
    };
}

async function sendAxiomEvent(event = {}, env = process.env, options = {}) {
    const axiom = getAxiomConfig(env);
    if (!axiom) {
        return {
            provider: 'axiom',
            skipped: true,
            reason: 'not_configured'
        };
    }

    return {
        provider: 'axiom',
        ...(await postMonitoringPayload(
            axiom.endpoint,
            JSON.stringify([event]),
            {
                ...options,
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    Authorization: `Bearer ${axiom.token}`
                }
            }
        ))
    };
}

async function sendDatadogEvent(event = {}, env = process.env, options = {}) {
    const datadog = getDatadogConfig(env);
    if (!datadog) {
        return {
            provider: 'datadog',
            skipped: true,
            reason: 'not_configured'
        };
    }

    const tagPairs = Object.entries({
        env: event.environment,
        service: event.service,
        event_type: event.type,
        ...event.tags
    })
        .filter(([, value]) => value !== undefined && value !== null && String(value || '').trim() !== '')
        .map(([key, value]) => `${normalizeText(key, 80)}:${normalizeText(value, 160)}`);

    return {
        provider: 'datadog',
        ...(await postMonitoringPayload(
            datadog.endpoint,
            JSON.stringify([{
                ddsource: 'nodejs',
                service: event.service,
                status: event.level,
                message: event.message,
                ddtags: tagPairs.join(','),
                timestamp: event.timestamp,
                event_id: event.event_id,
                event_type: event.type,
                environment: event.environment,
                release: event.release || undefined,
                tags: event.tags,
                extra: event.extra
            }]),
            {
                ...options,
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    'DD-API-KEY': datadog.apiKey
                }
            }
        ))
    };
}

async function emitExternalMonitoringEvent(input = {}, options = {}) {
    const env = options.env || process.env;
    const event = buildMonitoringEvent(input, { env });
    const senders = [
        sendSentryEvent,
        sendAxiomEvent,
        sendDatadogEvent
    ];
    const results = [];

    for (const sender of senders) {
        try {
            results.push(await sender(event, env, options));
        } catch (error) {
            results.push({
                provider: sender.name || 'unknown',
                ok: false,
                status: 0,
                error: normalizeText(error?.message || error, 1000) || 'monitoring_sender_failed'
            });
        }
    }

    return {
        event,
        results,
        configured: results.filter((item) => item.skipped !== true).length,
        delivered: results.filter((item) => item.ok === true).length,
        failed: results.filter((item) => item.skipped !== true && item.ok !== true).length
    };
}

function emitExternalMonitoringEventFailOpen(input = {}, options = {}) {
    return emitExternalMonitoringEvent(input, options).catch((error) => ({
        event: buildMonitoringEvent({
            type: input.type || 'monitoring_emit_failed',
            level: 'warning',
            message: error?.message || 'External monitoring emit failed'
        }, { env: options.env || process.env }),
        results: [],
        configured: 0,
        delivered: 0,
        failed: 0,
        suppressed_error: normalizeText(error?.message || error, 1000)
    }));
}

module.exports = {
    DEFAULT_MONITORING_TIMEOUT_MS,
    REDACTED_VALUE,
    SENTRY_DSN_ENV_NAMES,
    buildMonitoringEvent,
    buildSentryEnvelope,
    emitExternalMonitoringEvent,
    emitExternalMonitoringEventFailOpen,
    getAxiomConfig,
    getDatadogConfig,
    getSentryDsn,
    normalizeLevel,
    normalizeText,
    parseSentryDsn,
    redactMonitoringPayload,
    sendAxiomEvent,
    sendDatadogEvent,
    sendSentryEvent
};
